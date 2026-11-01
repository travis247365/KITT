// LLM brain via the Anthropic Messages API (used only when KITT_ANTHROPIC_API_KEY is set).
import { BrainError } from './claude-cli.js';
import { log } from '../log.js';

export function createAnthropicApi({ apiKey, defaultModel = 'claude-haiku-5-5', timeoutMs = 60000 }) {
  async function complete({ prompt, system, schema, model, maxTokens = 1024, timeoutMs: t = timeoutMs }) {
    const body = { model: model || defaultModel, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
    if (system) body.system = system;
    if (schema) {
      body.tools = [{ name: 'emit', description: 'Emit the structured answer.', input_schema: schema }];
      body.tool_choice = { type: 'tool', name: 'emit' };
    }
    const started = Date.now();
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(t),
      });
    } catch (e) { throw new BrainError(`anthropic fetch failed: ${e.message}`, /timeout|abort/i.test(e.message) ? 'timeout' : 'error'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new BrainError(`anthropic HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`, r.status === 429 || r.status === 529 ? 'rate_limit' : r.status === 401 ? 'auth' : 'error');
    const ms = Date.now() - started;
    let text = ''; let structured = null;
    for (const block of j.content || []) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') structured = block.input;
    }
    log.debug('brain call', { ms, provider: 'anthropic-api', model: body.model, usage: j.usage });
    return { text, structured, sessionId: null, costUsd: null, ms, apiMs: ms, provider: 'anthropic-api' };
  }
  return { name: 'anthropic-api', complete };
}
