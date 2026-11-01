// Brain facade: deterministic code first, LLM only for language. Provider = claude-cli (Max plan) or anthropic-api.
import { createClaudeCli, BrainError } from './claude-cli.js';
import { createAnthropicApi } from './anthropic-api.js';
import { log } from '../log.js';

export { BrainError };

export const PERSONA = `You are KITT, the in-car assistant of the owner (Lusaka, Zambia): calm, precise, dry wit, never chatty. You speak through car speakers, so: short sentences, plain words, no markdown, no lists with symbols, no URLs, numbers rounded sensibly, currency as "kwacha" or "dollars". Never invent facts; if data is missing say so in one sentence. Keep answers under 80 words unless asked for detail.`;

export function createBrain({ secrets, config, paths }) {
  const cfg = config.brain || {};
  const models = { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5', best: 'claude-opus-5-5', ...(cfg.models || {}) };
  const apiKey = secrets.KITT_ANTHROPIC_API_KEY || secrets.ANTHROPIC_API_KEY;
  const want = secrets.KITT_BRAIN || cfg.provider || 'auto';
  let provider;
  if (want === 'api' || (want === 'auto' && apiKey && cfg.preferApi)) provider = createAnthropicApi({ apiKey, defaultModel: models.fast, timeoutMs: cfg.timeoutMs });
  else provider = createClaudeCli({ brainDir: paths.brainDir, defaultModel: models.fast, timeoutMs: cfg.timeoutMs || 90000 });
  const fallback = provider.name === 'claude-cli' && apiKey ? createAnthropicApi({ apiKey, defaultModel: models.fast }) : null;

  let healthCache = { at: 0, ok: null, detail: '' };

  async function ask(opts) {
    const o = { ...opts, model: models[opts.tier] || opts.model || models.fast };
    try { return await provider.complete(o); }
    catch (e) {
      if (fallback && (e.kind === 'rate_limit' || e.kind === 'auth' || e.kind === 'spawn')) {
        log.warn('brain primary failed; using API fallback', { kind: e.kind, err: e.message });
        return fallback.complete(o);
      }
      throw e;
    }
  }

  /** Classify free text into one of the known intents. Returns {skill,intent,slots,confidence}. */
  async function classify(text, catalog, { timeoutMs = 45000 } = {}) {
    const schema = { type: 'object', properties: { skill: { type: 'string' }, intent: { type: 'string' }, slots: { type: 'object', additionalProperties: { type: 'string' } }, confidence: { type: 'number' } }, required: ['skill', 'intent', 'confidence'] };
    const lines = catalog.map((c) => `- ${c.skill}.${c.name}: ${c.description}${c.examples?.length ? ` (e.g. "${c.examples.slice(0, 2).join('", "')}")` : ''}${c.slots?.length ? ` slots: ${c.slots.join(', ')}` : ''}`).join('\n');
    const system = 'You map a spoken command from a driver to exactly one intent from the catalog. Output JSON only. If nothing fits, use skill "none", intent "unknown", confidence 0. Slots are short strings taken from the utterance.';
    const prompt = `Catalog:\n${lines}\n\nUtterance: "${text}"`;
    const r = await ask({ system, prompt, schema, tier: 'fast', timeoutMs });
    const s = r.structured || safeParse(r.text) || { skill: 'none', intent: 'unknown', confidence: 0 };
    return { skill: s.skill, intent: s.intent, slots: s.slots || {}, confidence: Number(s.confidence) || 0, costUsd: r.costUsd };
  }

  /** Spoken-style summary of arbitrary text/data. */
  async function speak(prompt, { tier = 'fast', maxWords = 80, system = PERSONA } = {}) {
    const r = await ask({ system: `${system}\nHard limit: ${maxWords} words.`, prompt, tier, timeoutMs: 60000 });
    return r.text.trim();
  }

  /** Structured extraction with a JSON schema. */
  async function extract(prompt, schema, { tier = 'fast', system = 'You extract structured data from text. Output JSON only; leave unknown fields out.' } = {}) {
    const r = await ask({ system, prompt, schema, tier, timeoutMs: 60000 });
    return r.structured || safeParse(r.text);
  }

  async function health(force = false) {
    if (!force && Date.now() - healthCache.at < 10 * 60 * 1000 && healthCache.ok !== null) return healthCache;
    try {
      const r = await ask({ system: 'Reply with exactly: OK', prompt: 'ping', tier: 'fast', timeoutMs: 45000 });
      healthCache = { at: Date.now(), ok: /OK/.test(r.text), detail: `${provider.name} ${r.ms} ms`, provider: provider.name };
    } catch (e) { healthCache = { at: Date.now(), ok: false, detail: `${e.kind}: ${e.message}`, provider: provider.name }; }
    return healthCache;
  }

  return { provider: provider.name, models, ask, classify, speak, extract, health, raw: provider };
}

function safeParse(t) { try { return JSON.parse(String(t).replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()); } catch { return null; } }
