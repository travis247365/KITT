// How a spoken brief is put together (Run 2 of docs/RUN_PLAN_3X.md): a short greeting, then the number of decisions waiting as the
// second sentence, then the items with decision-bearing ones first, each clipped to a sentence boundary, then a sign-off.
// Pure and deterministic so the structure is tested; skills only report `decisions` (a count) next to what they say.
import { clipWords, plural } from './voice.js';

export const BRIEF_SIGN_OFF = "That's the brief.";

export function assembleBrief({ kind, greet, parts, hubDecisions = 0, maxWordsPerItem = 80 }) {
  const items = parts
    .map((p, i) => (typeof p === 'string' ? { speak: p, decisions: 0, i } : p ? { speak: p.speak, decisions: Math.max(0, Number(p.decisions) || 0), i } : null))
    .filter((p) => p && p.speak);
  if (!items.length && !hubDecisions) return `${greet} Nothing to report yet; the skills are still being connected.`;
  items.sort((a, b) => Number(b.decisions > 0) - Number(a.decisions > 0) || a.i - b.i);
  const decisions = items.reduce((s, p) => s + p.decisions, 0) + Math.max(0, hubDecisions);
  const second = decisions > 0 ? `${plural(decisions, 'thing needs', 'things need')} your decision.` : 'Nothing needs your decision.';
  const body = items.map((p) => clipWords(p.speak, maxWordsPerItem)).join(' ');
  return [greet, second, body, BRIEF_SIGN_OFF].filter(Boolean).join(' ');
}
