// Reads AppyJobHunter's tracker (Career Applications/00_TRACKER.md): a living markdown file, so the parser goes by section names and
// table headers, never by line numbers, and keeps whatever it cannot classify. Pure functions; no file access here.

const strip = (s) => String(s ?? '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** The first date written in `text`: 2026-10-16, 16 Oct, 16 October 2026, Fri 16 Oct. No year: `year`. ISO date or null. */
export function findDate(text, year) {
  const t = String(text || '');
  let m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s+(20\d\d))?\b/i.exec(t);
  if (!m) return null;
  const y = Number(m[3] || year); const mo = MONTHS[m[2].toLowerCase()]; const d = Number(m[1]);
  if (!y || mo === undefined || d < 1 || d > 31) return null;
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const KINDS = [
  ['holds', /\bhold/i], ['packs', /^packs?\b|\bpacks?\b/i], ['out', /already out|applications? out|submitted|\bsent\b/i],
  ['discovery', /discovery|pipeline|to (?:pack|pursue)/i], ['decisions', /decision/i], ['log', /^log\b|change.?log/i],
];
const sectionKind = (heading) => (KINDS.find(([, re]) => re.test(heading)) || ['other'])[0];

const COLS = [
  ['role', /^(role|title|position|job)\b/i], ['folder', /folder/i], ['versions', /version/i], ['fit', /^fit/i], ['pay', /pay|comp|salary/i],
  ['recommendation', /recommend|verdict|^rec\b/i], ['date', /date|clos|deadline/i], ['status', /status|state/i], ['next', /next/i], ['id', /job id|^id$|req/i],
];
const colKey = (h) => (COLS.find(([, re]) => re.test(strip(h))) || [null])[0];
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** { title, version, updated (ISO date from the title line), sections: { holds, packs, out, discovery, decisions, log, other } } */
export function parseTracker(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const head = lines.find((l) => /^#\s/.test(l)) || '';
  const year = Number((/\b(20\d\d)\b/.exec(head) || [])[1]) || new Date().getFullYear();
  const out = { title: strip(head.replace(/^#\s+/, '')), version: (/\bv(\d+(?:\.\d+)*)\b/i.exec(head) || [])[1] || null, updated: findDate(head, year), year,
    holds: [], packs: [], out: [], discovery: [], decisions: [], log: [], other: [] };
  let kind = 'other'; let header = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^##\s/.test(line)) { kind = sectionKind(line.replace(/^#+\s*/, '')); header = null; continue; }
    if (/^\|/.test(line.trim())) {
      const c = cells(line);
      if (c.every((x) => /^:?-{2,}:?$/.test(x) || x === '')) continue;            // the |---|---| rule
      if (!header) { header = c.map(colKey); continue; }
      const row = {}; c.forEach((v, i) => { const k = header[i]; if (k && !row[k]) row[k] = strip(v); });
      if (kind === 'packs' || kind === 'other') out.packs.push({ ...row, deadline: findDate(row.date, year) });
      continue;
    }
    header = null;
    const item = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!item) continue;
    const text = strip(item[2]); if (!text) continue;
    if (kind === 'holds') { const b = /^\*\*(.+?)\*\*/.exec(item[2].trim()); out.holds.push({ n: Number(item[1]) || out.holds.length + 1, title: strip(b ? b[1] : text.split(/[.:]\s/)[0]).replace(/[.:]$/, ''), text }); }
    else if (kind === 'decisions') out.decisions.push({ n: Number(item[1]) || out.decisions.length + 1, text });
    else if (kind === 'discovery') out.discovery.push({ text, deadline: findDate(text, year) });
    else if (kind === 'out') out.out.push({ text, date: findDate(text, year) });
    else if (kind === 'log') out.log.push({ text, date: findDate(text, year) });
    else out.other.push(text);
  }
  return out;
}

const ISO = (d) => d.toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Deadlines from the packs and the discovery queue: upcoming (today or later, nearest first) and passed. */
export function deadlines(t, today = ISO(new Date())) {
  const all = [
    ...t.packs.filter((p) => p.deadline).map((p) => ({ what: p.role || p.folder || 'a pack', date: p.deadline, kind: 'pack' })),
    ...t.discovery.filter((d) => d.deadline).map((d) => ({ what: d.text.split(/[:(—–-]\s/)[0].slice(0, 90), date: d.deadline, kind: 'discovery' })),
  ].map((x) => ({ ...x, in_days: days(today, x.date) }));
  return { upcoming: all.filter((x) => x.in_days >= 0).sort((a, b) => a.in_days - b.in_days), passed: all.filter((x) => x.in_days < 0) };
}

/** A pack counts as sent once its status says submitted, sent or applied. */
export const isSent = (p) => /submitted|\bsent\b|applied/i.test(`${p.status || ''}`);

// ---------- links queued from KITT for AppyJobHunter ----------
const TRACKING = /^(utm_\w+|fbclid|gclid|mc_[ce]id|trk|trkInfo|trackingId|refId|lipi|originalSubdomain|src|source|ref|referrer|eBP|recommendedFlavor|midToken|midSig|_hsenc|_hsmi)$/i;

/** The first http(s) address in the text, tracking parameters and the fragment dropped; null when there is none. */
export function cleanUrl(input) {
  const found = /https?:\/\/[^\s<>"'`]+/i.exec(String(input || '')); if (!found) return null;
  let u; try { u = new URL(found[0].replace(/[)>\].,;]+$/, '')); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = ''; u.hostname = u.hostname.toLowerCase();
  return u.toString().replace(/\?$/, '');
}

export const INBOX_HEADER = `# Job links queued from KITT

AppyJobHunter: run intake on every line that has no "→" yet, then append "→ <what happened>, <date>" to that line.
Never delete a line. KITT only appends here.
`;

/** [{ when, url, from, done, note }] from the inbox file. */
export function parseInbox(md) {
  const rows = [];
  for (const line of String(md || '').split('\n')) {
    const m = /^\s*-\s+(\d{4}-\d\d-\d\d(?: \d\d:\d\d)?)\s+·\s+(\S+)(?:\s+·\s+([^→]*?))?\s*(?:→\s*(.*))?$/.exec(line);
    if (m) rows.push({ when: m[1], url: m[2], from: (m[3] || '').trim(), done: Boolean(m[4]), note: (m[4] || '').trim() });
  }
  return rows;
}
export const inboxLine = (url, from, when) => `- ${when} · ${url} · ${from}\n`;
