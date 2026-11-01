// Intent routing: wake-word stripping → deterministic patterns (fast, free, predictable) → LLM classifier fallback.
const WAKE = /^(?:(?:hey|ok|okay|yo)\s+)?(?:kitt|kit|kid|kitty|kate)\b[,.!?\s]*/i;

export function normalize(text) {
  let s = String(text || '').trim().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(WAKE, '');
  s = s.replace(/^(?:please|can you|could you|would you|i want you to|i need you to|tell me)\s+/i, '');
  s = s.replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

/** Compile "status of {item}" style templates into anchored regexes with named groups. */
export function compilePattern(p) {
  if (p instanceof RegExp) return p;
  let src = String(p).trim();
  src = src.replace(/[.*+?^$()[\]\\|]/g, (m) => (m === '(' || m === ')' || m === '|' || m === '?' ? m : '\\' + m));
  src = src.replace(/\{(\w+)\}/g, '(?<$1>.+?)');
  src = src.replace(/\s+/g, '\\s+');
  return new RegExp(`^(?:${src})$`, 'i');
}

export function buildCatalog(skills) {
  const cat = [];
  for (const sk of skills) {
    for (const it of sk.intents || []) {
      cat.push({ skill: sk.id, name: it.name, description: it.description || it.name, examples: it.examples || [], slots: it.slots || [], write: Boolean(it.write), patterns: (it.patterns || []).map(compilePattern) });
    }
  }
  return cat;
}

const GLOBAL = [
  { intent: 'confirm', re: /^(?:confirm|yes do it|go ahead|proceed|do it|yes confirm|confirmed|affirmative)$/i },
  { intent: 'cancel', re: /^(?:cancel|never mind|nevermind|abort|stop|no cancel|forget it|negative)$/i },
  { intent: 'more', re: /^(?:more|continue|go on|next|keep going|rest|the rest|read the rest)$/i },
  { intent: 'repeat', re: /^(?:repeat|say that again|again|what)$/i },
  { intent: 'help', re: /^(?:help|what can you do|commands|options|capabilities)$/i },
  { intent: 'status', re: /^(?:status|are you (?:there|online|awake)|health|system status|you there|hello|hi|good (?:morning|evening|afternoon) kit)$/i },
  { intent: 'morning', re: /^(?:good morning|morning brief(?:ing)?|morning|brief me|daily brief(?:ing)?|what's happening today|what is happening today|run the morning brief)$/i },
  { intent: 'evening', re: /^(?:good evening|evening recap|evening brief(?:ing)?|recap|end of day|wrap up|how did today go)$/i },
];

export function createIntentRouter({ skills, brain, minConfidence = 0.6 }) {
  const catalog = buildCatalog(skills);

  function matchDeterministic(norm) {
    for (const g of GLOBAL) if (g.re.test(norm)) return { skill: 'kitt', intent: g.intent, slots: {}, via: 'global' };
    for (const c of catalog) {
      for (const re of c.patterns) {
        const m = re.exec(norm);
        if (m) {
          const slots = {};
          for (const [k, v] of Object.entries(m.groups || {})) if (v !== undefined) slots[k] = v.trim();
          return { skill: c.skill, intent: c.name, slots, via: 'pattern', write: c.write };
        }
      }
    }
    return null;
  }

  async function route(text) {
    const norm = normalize(text);
    if (!norm) return { skill: 'kitt', intent: 'empty', slots: {}, via: 'none', norm };
    const det = matchDeterministic(norm);
    if (det) return { ...det, norm };
    if (!brain) return { skill: 'none', intent: 'unknown', slots: {}, via: 'none', norm };
    try {
      const c = await brain.classify(norm, catalog.map(({ skill, name, description, examples, slots }) => ({ skill, name, description, examples, slots })), { timeoutMs: fast ? 15000 : 45000 });
      const known = catalog.find((k) => k.skill === c.skill && k.name === c.intent);
      if (known && c.confidence >= minConfidence) return { skill: c.skill, intent: c.intent, slots: c.slots || {}, via: 'llm', confidence: c.confidence, write: known.write, norm };
      return { skill: 'none', intent: 'unknown', slots: {}, via: 'llm', confidence: c.confidence, norm };
    } catch (e) {
      return { skill: 'none', intent: 'unknown', slots: {}, via: 'llm-error', error: e.message, kind: e.kind, norm };
    }
  }

  return { route, catalog, matchDeterministic };
}
