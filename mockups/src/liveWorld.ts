// The hub's data in the shape the designed screens read (World, src/data.ts), so the iPhone, iPad and Apple TV surfaces draw it unchanged.
// Everything the hub does not report is empty or zero: nothing here is invented. Field names follow the skills' own tables
// (src/skills/*/index.js in the hub) with tolerant fallbacks for the ones that vary.
import { SKILLS, type Device, type Finding, type Idea, type LinkItem, type Pending, type SkillId, type Tx, type World } from './data';
import type { Prov } from './kit';
import type { Live } from './live';
import { coveragePct, first, firstNum, firstStr, fmtDay, fmtTime, fmtWhen, isObj, levelOf, num, objs, parseDate, str, type Obj } from './model';

const SKILL_IDS = SKILLS.map((s) => s.id as string);
const view = (live: Live, id: string): Obj => (live.views[id]?.view ?? {});
const provOf = (c: unknown): Prov => { const s = str(c).toUpperCase(); return s === 'INFERRED' || s === 'MODELLED' ? 'modelled' : s === 'ASSUMED' ? 'assumed' : 'measured'; };
const deviceOf = (source: unknown): Device => { const s = str(source).toLowerCase(); return /car|siri|shortcut/.test(s) ? 'car' : /watch/.test(s) ? 'watch' : /web|api|tv|pad|mac/.test(s) ? 'pad' : 'phone'; };
const CAT: Record<string, string> = { NEEDS_REPLY: 'Needs reply', FYI: 'FYI', RECEIPT: 'Receipt', EVENT: 'Event', LINKEDIN_DM: 'LinkedIn' };
const humanCat = (c: string) => CAT[c.toUpperCase()] ?? (c ? c.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase()) : '–');
const monthsOf = (cadence: unknown): number => { const c = str(cadence).toLowerCase(); return /year|annual/.test(c) ? 12 : /quarter/.test(c) ? 3 : /week/.test(c) ? 0.23 : 1; };
const EMPTY_TRIP = { title: '', dates: '', flight: 0, hotel: 0, nights: 0, perDiem: 0, days: 0, total: 0, visa: '' };

export function buildLiveWorld(live: Live): World {
  const st = live.state; const tz = st?.tz; const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const offline = live.status === 'offline';
  const asOf = live.lastOk ? fmtTime(new Date(live.lastOk).toISOString(), tz) : '–';

  // Money: balances per wallet, the recent transactions, 30 days of debits by day (from those transactions), categories.
  const m = view(live, 'money');
  const wallets = objs(m.balances).map((b) => ({ name: firstStr(b, ['wallet', 'name']) || 'Wallet', balance: firstNum(b, ['balance', 'amount']), asOf: fmtWhen(first(b, ['as_of', 'ts']), tz, now) || '–' }));
  const cashTotal = wallets.reduce((a, w) => a + w.balance, 0);
  const recent = objs(m.recent);
  const txs: Tx[] = recent.slice(0, 50).map((t) => ({ ts: fmtWhen(t.ts, tz, now), wallet: firstStr(t, ['wallet']) || '–', who: firstStr(t, ['counterparty', 'kind']) || 'Transaction', cat: firstStr(t, ['category', 'kind']) || 'Other', amount: (str(t.direction) === 'in' ? 1 : -1) * Math.abs(num(t.amount)), prov: provOf(t.confidence) }));
  const daily = new Array<number>(30).fill(0);
  for (const t of recent) {
    if (str(t.direction) !== 'out') continue;
    const d = parseDate(t.ts); if (!d) continue;
    const age = Math.floor((now - d.getTime()) / 86400000);
    if (age >= 0 && age < 30) daily[29 - age] += Math.abs(num(t.amount)) + Math.abs(num(t.fee));
  }
  const categories = objs(m.categories_30d).map((c) => ({ label: firstStr(c, ['category', 'label', 'name']) || 'Other', value: Math.abs(firstNum(c, ['s', 'total', 'amount', 'value'])) })).filter((c) => c.value > 0);

  // Subscriptions: the hub already gives kwacha per month; `usd × fx / months` must reproduce it, whatever the rate.
  const s = view(live, 'subscriptions'); const totals = isObj(s.totals) ? s.totals : {};
  const fx = firstNum(totals, ['fx', 'usd_zmw']) || 25;
  const subs = objs(s.merchants).filter((x) => str(x.status) !== 'cancelled').map((x) => {
    const months = monthsOf(first(x, ['cadence', 'cycle', 'period'])); const monthly = firstNum(x, ['monthly_zmw', 'monthly', 'amount_zmw']);
    const pastDue = /past_due|overdue|declined|unpaid/.test(str(x.status).toLowerCase());
    return { name: firstStr(x, ['display', 'merchant', 'name']) || 'Subscription', usd: (monthly * months) / fx, months, next: pastDue ? 'Overdue' : fmtDay(first(x, ['next_renewal', 'next', 'next_charge']), tz) || '–', status: (pastDue ? 'past_due' : 'active') as 'active' | 'past_due' };
  });
  const subsMonthly = firstNum(totals, ['monthly_zmw', 'monthly']) || subs.reduce((a, x) => a + (x.usd * fx) / x.months, 0);
  const pastDue = subs.filter((x) => x.status === 'past_due').length;

  // Security: the hub's findings carry `severity` (CRITICAL / HIGH / MEDIUM / LOW / INFO).
  const sec = view(live, 'security');
  const findings: Finding[] = objs(sec.findings).map((f) => ({ level: levelOf(first(f, ['level', 'severity'])) ?? 'info', title: firstStr(f, ['title', 'summary', 'id']) || 'Finding', provider: firstStr(f, ['provider', 'source']) || '–', detail: firstStr(f, ['detail', 'description', 'remediation', 'fix']), since: fmtDay(first(f, ['first_seen', 'since', 'created_at', 'ts']), tz) || '–' }));
  const actionable = findings.filter((f) => f.level === 'critical' || f.level === 'high' || f.level === 'medium').length;
  const critical = findings.find((f) => f.level === 'critical') ?? null;

  // Board (chief): plate().display → overdue, due_soon, blocked, high_open, incidents, downtime, approvals.
  const ch = view(live, 'chief');
  const item = (o: Obj) => ({ ref: firstStr(o, ['ref', 'key', 'code', 'id']).slice(0, 8), title: firstStr(o, ['title', 'name', 'summary', 'text']) || 'Item', client: firstStr(o, ['client', 'owner', 'assignee', 'project', 'lane', 'category']) || '–' });
  const dueOf = (o: Obj) => parseDate(first(o, ['due_date', 'due', 'deadline']));
  const overdue = objs(ch.overdue).map((o) => ({ ...item(o), late: Math.max(0, Math.round((now - (dueOf(o)?.getTime() ?? now)) / 86400000)) }));
  const blocked = objs(ch.blocked).map(item);
  const dueSoon = objs(first(ch, ['due_soon', 'dueSoon'])).map((o) => ({ ...item(o), due: fmtDay(dueOf(o) ?? first(o, ['due_date', 'due']), tz) || '–' }));

  // Inbox (receptionist): counts by category, the open items per category.
  const r = view(live, 'receptionist');
  const counts: Record<string, number> = {};
  if (Array.isArray(r.counts)) for (const c of objs(r.counts)) counts[firstStr(c, ['category', 'cat']).toUpperCase()] = firstNum(c, ['n', 'count']);
  else if (isObj(r.counts)) for (const [k, v] of Object.entries(r.counts)) counts[k.toUpperCase()] = num(v);
  const needsRows = objs(r.needs_reply);
  const needsReply = needsRows.length || counts.NEEDS_REPLY || 0;
  const fyi = counts.FYI ?? objs(r.fyi).length; const receipts = counts.RECEIPT ?? counts.RECEIPTS ?? objs(r.receipts).length; const events = counts.EVENT ?? objs(r.events).length;
  const drafts = needsRows.filter((x) => x.draft_id || x.has_draft || x.draft).length;
  const sample = [...needsRows, ...objs(r.linkedin), ...objs(r.fyi), ...objs(r.receipts)].slice(0, 8)
    .map((x) => ({ from: firstStr(x, ['from', 'sender', 'from_name', 'from_email']) || '–', subject: firstStr(x, ['subject', 'title', 'snippet']) || '(no subject)', cat: humanCat(firstStr(x, ['category', 'cat'])) }));

  // WhatsApp: unread per chat from the listener.
  const wa = view(live, 'whatsapp');
  const unread = objs(wa.unread).map((u) => ({ name: firstStr(u, ['name', 'chat_name', 'chat_jid']) || 'Chat', n: Math.max(1, firstNum(u, ['n', 'count', 'unread'])), vip: Boolean(u.vip), group: Boolean(first(u, ['is_group', 'group'])) }));
  const online = wa.online === true || str(wa.state) === 'running';

  // Trips: events and the latest plan.
  const tr = view(live, 'trips');
  const concerts = objs(tr.events).map((e) => ({ who: firstStr(e, ['artist', 'who', 'title', 'name']) || 'Event', date: fmtDay(first(e, ['date', 'start', 'start_date']), tz) || '–', venue: firstStr(e, ['venue']), city: firstStr(e, ['city', 'location']) }));
  const plan = objs(tr.plans)[0];
  let trip = EMPTY_TRIP;
  if (plan) {
    const flight = firstNum(plan, ['flight', 'flight_zmw', 'flights']); const hotel = firstNum(plan, ['hotel', 'hotel_zmw', 'hotel_per_night']); const nights = firstNum(plan, ['nights']) || 1;
    const perDiem = firstNum(plan, ['per_diem', 'perDiem', 'per_diem_zmw']); const days = firstNum(plan, ['days']) || 1;
    trip = { title: firstStr(plan, ['title', 'name']) || 'Trip plan', dates: firstStr(plan, ['dates']) || [fmtDay(first(plan, ['start_date', 'start']), tz), fmtDay(first(plan, ['end_date', 'end']), tz)].filter(Boolean).join(' – '), flight, hotel, nights, perDiem, days, total: firstNum(plan, ['total', 'total_zmw', 'budget']) || flight + hotel * nights + perDiem * days, visa: firstStr(plan, ['visa', 'visa_note']) };
  }

  // Comments, collabs, links, shop log, ideas.
  const comments = objs(view(live, 'comments').fresh).map((c) => ({ user: `@${firstStr(c, ['username', 'user', 'author']).replace(/^@/, '') || 'someone'}`, text: firstStr(c, ['text', 'comment']), needs: Boolean(first(c, ['needs_reply', 'needs'])) }));
  const collab = objs(view(live, 'collab').top).map((c) => ({ name: firstStr(c, ['name', 'handle', 'display']) || 'Creator', where: firstStr(c, ['country', 'where', 'location', 'geo']) || '–', platform: firstStr(c, ['platform', 'channel']) || '–', fit: Math.round(firstNum(c, ['fit', 'score', 'fit_score'])), why: firstStr(c, ['why', 'reasons', 'reason', 'topics']) }));
  const links: LinkItem[] = objs(view(live, 'linktree').links).map((l, i) => ({ id: firstStr(l, ['id']) || String(i), title: firstStr(l, ['title', 'url']) || 'Link', clicks: firstNum(l, ['clicks']), hidden: l.active === 0 || l.active === false }));
  const shoplog = objs(view(live, 'shoplog').entries).map((e) => ({ kind: firstStr(e, ['kind', 'type']) || 'entry', title: firstStr(e, ['title', 'text', 'summary']) || 'Entry', status: (str(first(e, ['visibility', 'status'])) === 'public' ? 'public' : 'private') as 'public' | 'private', when: fmtWhen(first(e, ['created_at', 'ts', 'when']), tz, now) || '–' }));
  const ideas: Idea[] = objs(view(live, 'ideas').ideas).map((x, i) => ({ id: Number(first(x, ['id'])) || i + 1, title: firstStr(x, ['title', 'text', 'idea']) || 'Idea', next: firstStr(x, ['next', 'next_step', 'next_action']) || '–', project: firstStr(x, ['project', 'area', 'tag']) || '–', ts: fmtWhen(first(x, ['created_at', 'ts']), tz, now) || '–' }));

  // The hub itself.
  const routines = st?.routines ?? []; const ok = routines.filter((x) => x.last_status === 'ok').length;
  const cov = coveragePct(st?.coverage) ?? 0;
  const onAc = isObj(st?.coverage) ? num((st.coverage as Obj).on_ac_pct) : NaN;
  const hub = { coverage: cov, onAc, siri: NaN, brainSec: NaN, routinesOk: ok, routinesTotal: routines.length, spark: new Array<number>(7).fill(cov), version: st?.version, brainOk: st?.brain?.ok !== false, brainDetail: st?.brain?.detail };
  const health: World['health'] = {};
  for (const [id, h] of Object.entries(st?.skills ?? {})) health[id] = { ok: !(h.unavailable || h.ok === false), detail: h.detail };

  // One decision at a time on the screens (the hub keeps them all; the Feed lists them).
  const p = live.pending[0] ?? st?.pending?.[0];
  const created = p ? (parseDate(p.created_at)?.getTime() ?? now) : now;
  const expires = p ? (parseDate(p.expires_at)?.getTime() ?? created + 600000) : now;
  const pending: Pending | null = p ? {
    id: p.code, kind: p.skill === 'money' ? 'log_cash' : 'draft', skill: (SKILL_IDS.includes(p.skill) ? p.skill : 'receptionist') as SkillId,
    summary: p.summary, speak: p.speak || 'Say “Kit, confirm” to do it, or “Kit, cancel”.', source: deviceOf(p.source), createdAt: created, ttlSec: Math.max(1, Math.round((expires - created) / 1000)),
  } : null;
  const audit = live.audit.slice(0, 12).map((a) => ({ ts: fmtWhen(a.ts, tz, now), source: a.source, intent: [a.skill, a.intent].filter(Boolean).join('.') || a.outcome, outcome: a.outcome }));

  return {
    scenario: 'morning', offline, asOf, clock: fmtTime(nowIso, tz), date: fmtDay(nowIso, tz),
    wallets, cashTotal, txs, spendDaily: daily, spend7: num(m.spend_7d), spend30: num(m.spend_30d), income30: num(m.income_30d), categories, unparsed: num(m.unparsed),
    subs, fx, subsMonthly, pastDue,
    findings, actionable, critical,
    board: { overdue, blocked, dueSoon, incidents: objs(ch.incidents).length, approvals: objs(ch.approvals).length },
    inbox: { needsReply, fyi, receipts, events, drafts, sample },
    wa: { unread, online },
    concerts, trip, comments, collab, links, shoplog, ideas, hub, pending, audit, live: true, health,
  };
}
