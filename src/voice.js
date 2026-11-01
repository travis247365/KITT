// Turn text into something Siri can read aloud well in a moving car.
// Rules: no markdown, no symbols, currency and percent spelled out, short sentences, hard length cap with a continuation.

const ABBREV = [
  [/\bMoMo\b/g, 'mobile money'],
  [/\bVAF\b/g, 'vehicle finance'],
  [/\bMBR\b/g, 'monthly business review'],
  [/\bPTP\b/g, 'promise to pay'],
  [/\bRCA\b/g, 'root cause analysis'],
  [/\bETA\b/g, 'E T A'],
  [/\bDNS\b/g, 'D N S'],
  [/\bTLS\b/g, 'T L S'],
  [/\bSSL\b/g, 'S S L'],
  [/\bAPI\b/g, 'A P I'],
  [/\bURL\b/g, 'U R L'],
  [/\bPR\b/g, 'pull request'],
  [/\bZRA\b/g, 'Z R A'],
  [/\bCEO\b/g, 'C E O'],
  [/\bCOO\b/g, 'C O O'],
  [/\bKITT\b/g, 'Kit'],
];

export function speakable(input, { maxChars = 900 } = {}) {
  if (input == null) return '';
  let s = String(input);
  s = s.replace(/```[\s\S]*?```/g, ' ');                 // code blocks
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');            // images
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');         // links → text
  s = s.replace(/https?:\/\/\S+/g, 'a link');
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '');               // headings
  s = s.replace(/^\s*[-*•]\s+/gm, '');                     // bullets
  s = s.replace(/^\s*\d+[.)]\s+/gm, (m) => m.trim() + ' ');
  s = s.replace(/[*_~>|]/g, '');
  // currency
  s = s.replace(/\b(?:ZMW|K)\s?(\d[\d,]*(?:\.\d{1,2})?)\b/g, '$1 kwacha');
  s = s.replace(/\bUS\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g, '$1 US dollars');
  s = s.replace(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g, '$1 dollars');
  s = s.replace(/\bR\s?(\d[\d,]*(?:\.\d{1,2})?)\b/g, '$1 rand');
  s = s.replace(/(\d)\s?%/g, '$1 percent');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/\s*\/\s*/g, ' or ');
  s = s.replace(/\s+@\s+/g, ' at ');
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => { const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))); return Number.isNaN(dt.getTime()) ? `${y}-${m}-${d}` : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); });
  s = s.replace(/(\d+)\s*[-–]\s*(\d+)/g, '$1 to $2');
  for (const [re, rep] of ABBREV) s = s.replace(re, rep);
  s = s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/\s+([.,;:!?])/g, '$1').trim();
  s = s.replace(/\.\.+/g, '.');
  if (s.length <= maxChars) return { text: s, rest: '' };
  // cut at a sentence boundary
  const cut = s.lastIndexOf('. ', maxChars);
  const at = cut > maxChars * 0.5 ? cut + 1 : maxChars;
  return { text: s.slice(0, at).trim() + " Say 'Kit, more' for the rest.", rest: s.slice(at).trim() };
}

/** Join items into a spoken list: "a, b, and c". */
export function spokenList(items, { max = 5, more = true } = {}) {
  const arr = items.filter(Boolean).map(String);
  const head = arr.slice(0, max);
  let out = head.length <= 1 ? head.join('') : head.slice(0, -1).join(', ') + ', and ' + head[head.length - 1];
  if (more && arr.length > max) out += `, and ${arr.length - max} more`;
  return out;
}

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

/** Human time in Africa/Lusaka: "today at 3 pm", "Tuesday 11 November". */
export function spokenDate(d, { tz = 'Africa/Lusaka', now = new Date() } = {}) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  const fmtDay = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const dayKey = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  const todayKey = dayKey(now);
  const tomorrow = new Date(now.getTime() + 86400000);
  if (dayKey(date) === todayKey) return 'today';
  if (dayKey(date) === dayKey(tomorrow)) return 'tomorrow';
  return fmtDay.format(date);
}

export function spokenTime(d, { tz = 'Africa/Lusaka' } = {}) {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(date).replace(/\b0?(\d{1,2}):00\b/, '$1').replace(/\s?(am|pm)/i, ' $1');
}

/** Cut spoken text to at most `max` words, at the last sentence end that keeps most of it (never mid-sentence unless there is none). */
export function clipWords(text, max = 80) {
  const t = String(text || '').trim();
  const words = t.split(/\s+/);
  if (words.length <= max) return t;
  const cut = words.slice(0, max).join(' ');
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end >= cut.length * 0.4) return cut.slice(0, end + 1);
  return cut.replace(/[,;:\s]+$/, '') + '.';
}
