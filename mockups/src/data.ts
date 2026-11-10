// Synthetic demo world for the KITT mockups. Nothing here is real: names are fictional, amounts are invented,
// and every total is DERIVED from its parts so the numbers reconcile (TPCL rule).
import type { IconName } from './icons';
import type { Level, Prov } from './kit';

export type SkillId =
  | 'chief' | 'security' | 'receptionist' | 'money' | 'subscriptions' | 'whatsapp'
  | 'trips' | 'comments' | 'collab' | 'linktree' | 'shoplog' | 'ideas';

export interface SkillMeta { id: SkillId; name: string; icon: IconName; blurb: string }
export const SKILLS: SkillMeta[] = [
  { id: 'chief', name: 'Board', icon: 'board', blurb: 'Operations board: overdue, blocked, incidents' },
  { id: 'security', name: 'Security', icon: 'shield', blurb: 'Daily checks on code, hosting and servers' },
  { id: 'receptionist', name: 'Inbox', icon: 'mail', blurb: 'Triage, read-aloud, reply drafts' },
  { id: 'money', name: 'Money', icon: 'wallet', blurb: 'Wallets, banks and cash from forwarded alerts' },
  { id: 'subscriptions', name: 'Subscriptions', icon: 'repeat', blurb: 'Recurring charges found in receipts' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', blurb: 'Digest and drafts you approve' },
  { id: 'trips', name: 'Trips', icon: 'plane', blurb: 'Concerts and away events into trip plans' },
  { id: 'comments', name: 'Comments', icon: 'comment', blurb: 'Post comments, flagged for reply' },
  { id: 'collab', name: 'Collabs', icon: 'users', blurb: 'Creators worth a conversation' },
  { id: 'linktree', name: 'Links', icon: 'link', blurb: 'Link-in-bio page' },
  { id: 'shoplog', name: 'Shop log', icon: 'book', blurb: 'Build-in-public log, private until you publish' },
  { id: 'ideas', name: 'Ideas', icon: 'bulb', blurb: 'Voice-captured ideas' },
];
export const skillMeta = (id: SkillId) => SKILLS.find((s) => s.id === id)!;

/** A skill the hub runs that this app has no designed screen for (the thirteenth onwards): the hub's `view` carries a `ui`
 *  descriptor ({ headline, sections, icon? }) and the same renderer draws it, so a new skill appears without an app release. */
export interface ExtraSkill { id: string; name: string; blurb: string; icon: IconName; ok: boolean; detail?: string; headline: string; ui?: { headline: string; sections: unknown[] } }
export const metaFor = (id: string, extra?: ExtraSkill[]): SkillMeta => {
  const known = SKILLS.find((s) => s.id === id); if (known) return known;
  const x = extra?.find((e) => e.id === id);
  return { id: id as SkillId, name: x?.name ?? id, icon: x?.icon ?? 'flag', blurb: x?.blurb ?? '' };
};

export type ScenarioId = 'morning' | 'pending' | 'critical' | 'offline' | 'quiet';
export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: 'morning', label: 'Morning', hint: 'Normal day: one medium finding, items overdue' },
  { id: 'pending', label: 'Waiting for OK', hint: 'A drafted reply is waiting for confirmation on every surface' },
  { id: 'critical', label: 'Security critical', hint: 'A critical finding outranks everything' },
  { id: 'offline', label: 'Hub offline', hint: 'The Mac is asleep: cached data, nothing can be sent' },
  { id: 'quiet', label: 'All clear', hint: 'Nothing needs you' },
];

export type Device = 'phone' | 'pad' | 'watch' | 'car';

export interface Pending {
  id: string; kind: 'draft' | 'log_cash'; skill: SkillId; summary: string; speak: string; source: Device; createdAt: number; ttlSec: number;
  payload?: { amount?: number; note?: string };
}

export interface CashLog { amount: number; note: string; ts: string }
export interface IdeaAdd { text: string; ts: string }
export interface Tx { ts: string; wallet: string; who: string; cat: string; amount: number; prov: Prov }
export interface Finding { level: Level; title: string; provider: string; detail: string; since: string }
export interface LinkItem { id: string; title: string; clicks: number; hidden: boolean }
export interface Idea { id: number; title: string; next: string; project: string; ts: string }

export interface World {
  scenario: ScenarioId; offline: boolean; asOf: string; clock: string; date: string;
  wallets: { name: string; balance: number; asOf: string }[]; cashTotal: number;
  txs: Tx[]; spendDaily: number[]; spend7: number; spend30: number; income30: number;
  categories: { label: string; value: number }[]; unparsed: number;
  subs: { name: string; usd: number; months: number; next: string; status: 'active' | 'past_due' }[]; fx: number; subsMonthly: number; pastDue: number;
  findings: Finding[]; actionable: number; critical: Finding | null;
  board: { overdue: { ref: string; title: string; client: string; late: number }[]; blocked: { ref: string; title: string; client: string }[]; dueSoon: { ref: string; title: string; client: string; due: string }[]; incidents: number; approvals: number };
  inbox: { needsReply: number; fyi: number; receipts: number; events: number; drafts: number; sample: { from: string; subject: string; cat: string }[] };
  wa: { unread: { name: string; n: number; vip?: boolean; group?: boolean }[]; online: boolean };
  concerts: { who: string; date: string; venue: string; city: string }[]; trip: { title: string; dates: string; flight: number; hotel: number; nights: number; perDiem: number; days: number; total: number; visa: string };
  comments: { user: string; text: string; needs: boolean }[]; collab: { name: string; where: string; platform: string; fit: number; why: string }[];
  links: LinkItem[]; shoplog: { kind: string; title: string; status: 'public' | 'private'; when: string }[]; ideas: Idea[];
  hub: { coverage: number; onAc: number; siri: number; brainSec: number; routinesOk: number; routinesTotal: number; spark: number[]; version?: string; brainOk?: boolean; brainDetail?: string };
  pending: Pending | null; audit: { ts: string; source: string; intent: string; outcome: string }[];
  /** Live only: skills the hub runs beyond the twelve designed ones, with the screen descriptor each sent. */
  extra?: ExtraSkill[];
  /** True when the world is the hub's own data (src/liveWorld.ts), not the synthetic scenario. */
  live?: boolean;
  /** Live only: each skill's health as the hub reports it; a red skill outranks its own quiet data. */
  health?: Record<string, { ok: boolean; detail?: string }>;
}

// ---- deterministic series (mulberry32) so screenshots and totals are stable ----
function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function series(total: number, n: number, seed: number): number[] {
  const r = rng(seed); const raw = Array.from({ length: n }, () => 0.35 + r() * 1.3);
  const sum = raw.reduce((a, b) => a + b, 0); const out = raw.map((v) => Math.round((v / sum) * total));
  out[n - 1] += total - out.reduce((a, b) => a + b, 0); return out; // reconcile to the cent
}

const BASE_CATS = [
  { label: 'Food', value: 4200 }, { label: 'Fuel', value: 3900 }, { label: 'Utilities', value: 2100 },
  { label: 'Telecom', value: 1300 }, { label: 'Lenders', value: 1100 }, { label: 'Other', value: 6300 },
]; // sums to 18,900
const BASE_DAILY = series(18900, 30, 20261028);

const BASE_TXS: Tx[] = [
  { ts: 'Mon 17:40', wallet: 'MTN MoMo', who: 'Utility company', cat: 'Utilities', amount: -150, prov: 'measured' },
  { ts: 'Mon 12:05', wallet: 'Bank A', who: 'Supermarket', cat: 'Food', amount: -1200, prov: 'measured' },
  { ts: 'Mon 08:10', wallet: 'Airtel Money', who: 'Agent cash-out', cat: 'Cash', amount: -500, prov: 'measured' },
  { ts: 'Sun 19:22', wallet: 'MTN MoMo', who: 'Fuel station', cat: 'Fuel', amount: -640, prov: 'measured' },
  { ts: 'Sun 10:00', wallet: 'Bank A', who: 'Employer Ltd', cat: 'Income', amount: 8000, prov: 'measured' },
  { ts: 'Sat 14:31', wallet: 'Airtel Money', who: 'Lender (14-day cycle)', cat: 'Lenders', amount: -525, prov: 'modelled' },
  { ts: 'Sat 09:12', wallet: 'Bank A', who: 'Pharmacy', cat: 'Health', amount: -310, prov: 'measured' },
  { ts: 'Fri 18:47', wallet: 'MTN MoMo', who: 'Airtime and data', cat: 'Telecom', amount: -100, prov: 'measured' },
];

const FX = 25; // ZMW per USD — an ASSUMED rate, shown as such
const SUBS: World['subs'] = [
  { name: 'Cloud storage (2 TB)', usd: 11.99, months: 1, next: '3 Nov', status: 'past_due' },
  { name: 'Office suite', usd: 12.5, months: 1, next: 'Overdue', status: 'past_due' },
  { name: 'Music (family plan)', usd: 9.99, months: 1, next: '10 Nov', status: 'active' },
  { name: 'Developer hosting', usd: 20, months: 1, next: '14 Nov', status: 'active' },
  { name: 'Domain renewal', usd: 14.99, months: 12, next: '12 Mar', status: 'active' },
];

const FINDINGS_BASE: Finding[] = [
  { level: 'medium', title: 'Dependency alerts are off on 9 active repositories', provider: 'Code host', detail: 'Turn on in Settings, Code security, or enable for the whole account.', since: '27 Oct' },
  { level: 'low', title: '5 secret-like environment variables are readable in the dashboard', provider: 'Web hosting', detail: 'Mark them Sensitive so they cannot be read back.', since: '27 Oct' },
  { level: 'info', title: 'Two-factor state is not readable', provider: 'Code host', detail: 'The CLI token lacks the user scope; run the scope refresh to check 2FA.', since: '27 Oct' },
  { level: 'info', title: 'CDN checks are off', provider: 'CDN', detail: 'Create a read-only API token to include DNS and SSL settings.', since: '26 Oct' },
];
const CRITICAL: Finding = { level: 'critical', title: 'Repository ops-board became public', provider: 'Code host', detail: 'Visibility changed from private to public at 06:58. Make it private again, then rotate any secret it ever held.', since: 'Today 06:58' };

const LINKS: LinkItem[] = [
  { id: 'wa', title: 'Message us on WhatsApp', clicks: 42, hidden: false },
  { id: 'li', title: 'LinkedIn company page', clicks: 31, hidden: false },
  { id: 'deck', title: 'Company profile deck', clicks: 18, hidden: false },
  { id: 'fa', title: 'Freelance profile · Platform A', clicks: 12, hidden: false },
  { id: 'fb', title: 'Freelance profile · Platform B', clicks: 9, hidden: false },
  { id: 'fc', title: 'Freelance profile · Platform C', clicks: 7, hidden: false },
];

const IDEAS: Idea[] = [
  { id: 14, title: 'Turn the morning brief into a two-minute podcast', next: 'Test one run with a sample brief', project: 'KITT', ts: 'Mon 21:10' },
  { id: 13, title: 'Payment-reminder bot two days before due date', next: 'Confirm which data source holds due dates', project: 'Consulting', ts: 'Sun 08:45' },
  { id: 12, title: 'Weekly one-page insight for LinkedIn from the shop log', next: 'Draft the template', project: 'content', ts: 'Fri 17:30' },
  { id: 11, title: 'Compare lender flows month on month', next: 'Add a lender category chart', project: 'finance', ts: 'Thu 12:02' },
];

export interface ScenarioParams { overdue: number; blocked: number; dueSoon: number; incidents: number; fyi: number; unreadScale: number; offline: boolean; pastDueActive: boolean; hasMediumFinding: boolean }
const PARAMS: Record<ScenarioId, ScenarioParams> = {
  morning: { overdue: 5, blocked: 3, dueSoon: 2, incidents: 3, fyi: 19, unreadScale: 1, offline: false, pastDueActive: true, hasMediumFinding: true },
  pending: { overdue: 5, blocked: 3, dueSoon: 2, incidents: 3, fyi: 19, unreadScale: 1, offline: false, pastDueActive: true, hasMediumFinding: true },
  critical: { overdue: 5, blocked: 3, dueSoon: 2, incidents: 3, fyi: 19, unreadScale: 1, offline: false, pastDueActive: true, hasMediumFinding: true },
  offline: { overdue: 5, blocked: 3, dueSoon: 2, incidents: 3, fyi: 19, unreadScale: 1, offline: true, pastDueActive: true, hasMediumFinding: true },
  quiet: { overdue: 0, blocked: 0, dueSoon: 1, incidents: 0, fyi: 4, unreadScale: 0, offline: false, pastDueActive: false, hasMediumFinding: false },
};

const OVERDUE = [
  { ref: 'P21', title: 'Payout reconciliation', client: 'Client A', late: 9 },
  { ref: 'P12', title: 'Roster import v2', client: 'Client B', late: 6 },
  { ref: 'P07', title: 'Vendor addendum signature', client: 'Client A', late: 3 },
  { ref: 'P18', title: 'Welcome-call QA sign-off', client: 'Client C', late: 2 },
  { ref: 'P30', title: 'Compliance register refresh', client: 'Internal', late: 1 },
];
const BLOCKED = [
  { ref: 'P09', title: 'Dialler vendor change request', client: 'Client B' },
  { ref: 'P24', title: 'Data-protection registration', client: 'Internal' },
  { ref: 'P33', title: 'Quarterly pack: awaiting source file', client: 'Client C' },
];
const DUE_SOON = [
  { ref: 'P15', title: 'Scorecard v3 review', client: 'Client A', due: 'Thu 30 Oct' },
  { ref: 'P27', title: 'Staff roster publish', client: 'Internal', due: 'Fri 31 Oct' },
];

export interface WorldInput { scenario: ScenarioId; cashLogs: CashLog[]; ideasAdded: IdeaAdd[]; linkOrder: string[]; hiddenLinks: string[]; pending: Pending | null; audit: World['audit'] }

export function buildWorld(s: WorldInput): World {
  const p = PARAMS[s.scenario];
  const daily = [...BASE_DAILY]; const cats = BASE_CATS.map((c) => ({ ...c }));
  const txs = [...BASE_TXS];
  for (const log of s.cashLogs) {
    daily[daily.length - 1] += log.amount;
    const label = /fuel|petrol|diesel/i.test(log.note) ? 'Fuel' : /food|lunch|market/i.test(log.note) ? 'Food' : 'Other';
    cats.find((c) => c.label === label)!.value += log.amount;
    txs.unshift({ ts: log.ts, wallet: 'Cash', who: log.note || 'Cash spend', cat: label, amount: -log.amount, prov: 'measured' });
  }
  const spend30 = daily.reduce((a, b) => a + b, 0);
  const spend7 = daily.slice(-7).reduce((a, b) => a + b, 0);
  const cashSpent = s.cashLogs.reduce((a, l) => a + l.amount, 0);
  const wallets = [
    { name: 'MTN MoMo', balance: 1235, asOf: '26 Oct' }, { name: 'Airtel Money', balance: 390, asOf: '25 Oct' },
    { name: 'Bank A · current', balance: 23457, asOf: '26 Oct' }, { name: 'Cash', balance: 600 - cashSpent, asOf: 'today' },
  ];
  const cashTotal = wallets.reduce((a, w) => a + w.balance, 0);

  const subs = SUBS.map((x) => ({ ...x, status: !p.pastDueActive && x.status === 'past_due' ? ('active' as const) : x.status }));
  const subsMonthly = subs.reduce((a, x) => a + (x.usd * FX) / x.months, 0);

  const findings = s.scenario === 'critical' ? [CRITICAL, ...FINDINGS_BASE] : p.hasMediumFinding ? FINDINGS_BASE : FINDINGS_BASE.filter((f) => f.level === 'info');
  const actionable = findings.filter((f) => f.level === 'critical' || f.level === 'high' || f.level === 'medium').length;

  const flight = 10000; const hotel = 2800; const nights = 2; const perDiem = 1500; const days = 3;
  const trip = { title: 'Thandi Moyo · Pretoria', dates: 'Fri 8 – Sun 10 Jan', flight, hotel, nights, perDiem, days, total: flight + hotel * nights + perDiem * days, visa: 'South Africa: generally visa-exempt for short visits. Verify before booking.' };

  const order = s.linkOrder.length ? s.linkOrder : LINKS.map((l) => l.id);
  const links = order.map((id) => ({ ...LINKS.find((l) => l.id === id)!, hidden: s.hiddenLinks.includes(id) }));

  const unread = p.unreadScale ? [{ name: 'Ops leads', n: 3, group: true }, { name: 'CEO', n: 1, vip: true }, { name: 'Family', n: 2, group: true }] : [];

  const hubSpark = [88, 91, 90, 94, 97, 92, 94];
  const ideas: Idea[] = [...s.ideasAdded.map((i, k) => ({ id: 15 + k, title: i.text, next: 'Structured on arrival', project: 'KITT', ts: i.ts })).reverse(), ...IDEAS];

  return {
    scenario: s.scenario, offline: p.offline, asOf: '07:05', clock: '07:12', date: 'Tue 28 Oct',
    wallets, cashTotal, txs, spendDaily: daily, spend7, spend30, income30: 32000,
    categories: cats, unparsed: 1,
    subs, fx: FX, subsMonthly, pastDue: subs.filter((x) => x.status === 'past_due').length,
    findings, actionable, critical: findings.find((f) => f.level === 'critical') ?? null,
    board: { overdue: OVERDUE.slice(0, p.overdue), blocked: BLOCKED.slice(0, p.blocked), dueSoon: DUE_SOON.slice(0, p.dueSoon), incidents: p.incidents, approvals: 0 },
    inbox: { needsReply: 0, fyi: p.fyi, receipts: s.scenario === 'quiet' ? 1 : 4, events: s.scenario === 'quiet' ? 0 : 2, drafts: s.pending && s.pending.kind === 'draft' ? 1 : 0,
      sample: [{ from: 'Cloud provider', subject: 'Your invoice is available', cat: 'Receipt' }, { from: 'Bank A', subject: 'Statement ready', cat: 'FYI' }, { from: 'Streaming service', subject: 'Concerts near you', cat: 'Event' }, { from: 'Tax authority', subject: 'Return acknowledgement', cat: 'FYI' }] },
    wa: { unread, online: true },
    concerts: [
      { who: 'Nomsa Dube', date: 'Sat 21 Nov', venue: 'Lounge', city: 'Refilwe' }, { who: 'Kwame Adeyemi', date: 'Sat 28 Nov', venue: 'Dome', city: 'Johannesburg' },
      { who: 'Lerato & Co', date: 'Thu 17 Dec', venue: 'Arena', city: 'Pretoria' }, { who: 'Thandi Moyo', date: 'Sat 9 Jan', venue: 'Arena', city: 'Pretoria' },
    ],
    trip,
    comments: s.scenario === 'quiet' ? [] : [
      { user: '@amina.k', text: 'This changed how our team runs collections. Thank you.', needs: false },
      { user: '@j.mwansa', text: 'How do I book a session?', needs: true },
      { user: '@tendai_r', text: 'Great breakdown of the numbers.', needs: false },
      { user: '@lungu.b', text: 'Sharing this with my finance lead.', needs: false },
      { user: '@sara.n', text: 'Which dashboard tool is that?', needs: false },
      { user: '@mutale_c', text: 'Brilliant.', needs: false },
    ],
    collab: [
      { name: 'Chanda Mwila', where: 'Zambia', platform: 'LinkedIn', fit: 58, why: 'data, Zambia, LinkedIn' },
      { name: 'Faith Banda', where: 'Zambia', platform: 'Podcast', fit: 56, why: 'fintech, Zambia, podcast format' },
      { name: 'Kofi Mensah', where: 'Ghana', platform: 'YouTube', fit: 49, why: 'mobile money, Africa, YouTube' },
      { name: 'Naledi Khumalo', where: 'South Africa', platform: 'LinkedIn', fit: 46, why: 'AI automation, LinkedIn' },
      { name: 'Wanjiru Kamau', where: 'Kenya', platform: 'Newsletter', fit: 41, why: 'customer experience, Africa' },
    ],
    links, shoplog: [
      { kind: 'shipped', title: 'v1.4 of a telecom client collections dashboard', status: 'public', when: 'Fri' },
      { kind: 'learned', title: 'Why a reject list matters more than a match list', status: 'public', when: 'Wed' },
      { kind: 'building', title: 'Voice briefings for the car', status: 'private', when: 'Mon' },
      { kind: 'shipped', title: 'Security sweep with change detection', status: 'private', when: 'Mon' },
    ],
    ideas,
    hub: { coverage: 94, onAc: 71, siri: 91, brainSec: 3.6, routinesOk: 19, routinesTotal: 20, spark: hubSpark },
    pending: s.pending, audit: s.audit,
  };
}

export const zmw = (n: number) => `K${Math.round(n).toLocaleString('en-GB')}`;
export const signed = (n: number) => `${n < 0 ? '−' : '+'}K${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Subject-verb agreement for "N need(s) a reply". */
export const needVerb = (n: number) => (n === 1 ? 'needs' : 'need');
