// Server-driven screens: each skill returns a small descriptor ({ sections }) and ONE renderer draws all twelve.
// This is the shape the hub's GET /v1/skills/{id}/view would return once it carries a `ui` block.
import { plural, needVerb, signed, zmw, type SkillId, type World } from './data';
import type { BarItem, Col, KpiItem, Level, Prov } from './kit';

export interface ListRow { title: string; sub?: string; right?: string; level?: Level; prov?: Prov; tag?: string }
export type Section =
  | { type: 'kpis'; items: KpiItem[]; cols?: number }
  | { type: 'list'; title?: string; rows: ListRow[]; empty?: string }
  | { type: 'table'; title?: string; cols: Col[]; rows: Record<string, string>[]; total?: Record<string, string> }
  | { type: 'bars'; title?: string; unit?: string; items: BarItem[]; note?: string }
  | { type: 'line'; title?: string; points: number[]; label: string; labels?: [string, string]; note?: string }
  | { type: 'timeline'; title?: string; items: { time: string; title: string; sub?: string }[] }
  | { type: 'actions'; items: { label: string; utterance: string; kind?: 'primary' | 'ghost' }[] }
  | { type: 'notice'; tone: 'info' | 'attention' | 'offline'; text: string }
  | { type: 'links' } | { type: 'scrub' } | { type: 'map' };
export interface SkillView { id: SkillId; headline: string; sections: Section[] }

const money = (w: World): SkillView => {
  const cats = [...w.categories].sort((a, b) => b.value - a.value);
  return { id: 'money', headline: `Cash position ${zmw(w.cashTotal)}`, sections: [
    { type: 'kpis', cols: 2, items: [
      { label: 'Cash position', value: zmw(w.cashTotal), prov: 'measured', sub: `sum of ${w.wallets.length} wallets` },
      { label: 'Spent, 7 days', value: zmw(w.spend7), prov: 'measured', delta: w.live ? undefined : { text: '+12% vs last week', good: false } },
      { label: 'Spent, 30 days', value: zmw(w.spend30), prov: 'measured' },
      { label: 'Income, 30 days', value: zmw(w.income30), prov: 'measured' },
    ] },
    { type: 'table', title: 'Wallets', cols: [{ key: 'w', label: 'Wallet' }, { key: 'd', label: 'As of' }, { key: 'b', label: 'Balance', align: 'r' }],
      rows: w.wallets.map((x) => ({ w: x.name, d: x.asOf, b: zmw(x.balance) })), total: { w: 'Total', b: zmw(w.cashTotal) } },
    { type: 'line', title: 'Daily spend, 30 days', points: w.spendDaily, label: 'Daily spend over 30 days', labels: ['30 days ago', 'today'], note: w.live ? 'Drawn from the newest 50 transactions the hub returned; the 30-day total above is the hub’s own figure.' : `Daily values sum to ${zmw(w.spend30)}, the 30-day figure above.` },
    { type: 'bars', title: 'Spend by category, 30 days', unit: 'kwacha', items: cats.map((c, i) => ({ label: c.label, value: c.value, text: zmw(c.value), accent: i === 0 })), note: `Categories sum to ${zmw(cats.reduce((a, c) => a + c.value, 0))}.` },
    { type: 'list', title: 'Recent transactions', rows: w.txs.slice(0, 8).map((t) => ({ title: t.who, sub: `${t.ts} · ${t.wallet} · ${t.cat}`, right: signed(t.amount), prov: t.prov })) },
    { type: 'notice', tone: 'info', text: `${plural(w.unparsed, 'alert')} could not be parsed and was kept raw. Alerts arrive through an iOS Shortcuts automation; nothing leaves the Mac.` },
    { type: 'actions', items: [{ label: 'Log cash 200 for fuel', utterance: 'log cash 200 fuel', kind: 'ghost' }, { label: 'Read my position', utterance: 'cash position', kind: 'primary' }] },
  ] };
};

const subs = (w: World): SkillView => {
  const active = w.subs.filter((s) => s.status === 'active');
  return { id: 'subscriptions', headline: `${w.pastDue} past due · ${zmw(w.subsMonthly)} a month`, sections: [
    { type: 'kpis', cols: 2, items: [
      { label: 'Monthly total', value: zmw(w.subsMonthly), prov: 'modelled', sub: `K${w.fx} per USD, assumed` },
      { label: 'Past due', value: String(w.pastDue), sub: 'card declined or unpaid' },
    ] },
    { type: 'list', title: 'Subscriptions', rows: w.subs.map((s) => ({ title: s.name, sub: `US$${s.usd.toFixed(2)} ${s.months === 12 ? 'a year' : 'a month'} · next ${s.next}`, right: `${zmw((s.usd * w.fx) / s.months)}/mo`, level: s.status === 'past_due' ? ('high' as Level) : undefined, prov: 'modelled' as Prov })) },
    { type: 'timeline', title: 'Next renewals', items: active.map((s) => ({ time: s.next, title: s.name, sub: `US$${s.usd.toFixed(2)}` })) },
    { type: 'notice', tone: 'attention', text: 'Amounts come from receipt e-mails; kwacha figures use an assumed exchange rate and are labelled Modelled.' },
  ] };
};

const security = (w: World): SkillView => ({ id: 'security', headline: w.critical ? 'Critical finding' : w.actionable ? `${plural(w.actionable, 'finding')}` : 'Clear', sections: [
  { type: 'kpis', cols: 2, items: [
    { label: 'Need attention', value: String(w.actionable), prov: 'measured' }, { label: 'Critical', value: w.critical ? '1' : '0', prov: 'measured' },
    ...(w.live ? [{ label: 'Open findings', value: String(w.findings.length), prov: 'measured' as Prov }, { label: 'Providers', value: String(new Set(w.findings.map((f) => f.provider).filter((p) => p && p !== '–')).size || '–'), sub: 'with open findings' }]
      : [{ label: 'Providers checked', value: '4', sub: 'code, hosting, servers, CDN' }, { label: 'Last sweep', value: '07:00', sub: 'took 3 min' }]),
  ] },
  ...(w.critical ? [{ type: 'notice' as const, tone: 'attention' as const, text: `${w.critical.title}. ${w.critical.detail}` }] : []),
  { type: 'list', title: 'Open findings', rows: w.findings.map((f) => ({ title: f.title, sub: `${f.provider} · since ${f.since}`, level: f.level })) },
  { type: 'actions', items: [{ label: 'Read security status', utterance: 'security status', kind: 'primary' }] },
] });

const chief = (w: World): SkillView => ({ id: 'chief', headline: `${w.board.overdue.length} overdue · ${w.board.blocked.length} blocked`, sections: [
  { type: 'kpis', cols: 2, items: [
    { label: 'Overdue', value: String(w.board.overdue.length), prov: 'measured' }, { label: 'Blocked', value: String(w.board.blocked.length), prov: 'measured' },
    { label: 'Due this week', value: String(w.board.dueSoon.length) }, { label: 'Open incidents', value: String(w.board.incidents), sub: w.live ? undefined : 'all severity 3' },
  ] },
  { type: 'list', title: 'Overdue', empty: 'Nothing overdue.', rows: w.board.overdue.map((o) => ({ title: o.title, sub: `${o.client} · ${plural(o.late, 'day')} late`, right: o.ref })) },
  { type: 'list', title: 'Blocked', empty: 'Nothing blocked.', rows: w.board.blocked.map((o) => ({ title: o.title, sub: o.client, right: o.ref })) },
  { type: 'list', title: 'Due this week', empty: 'Nothing due this week.', rows: w.board.dueSoon.map((o) => ({ title: o.title, sub: `${o.client} · ${o.due}`, right: o.ref })) },
  { type: 'actions', items: [{ label: "What's on my plate", utterance: "what's on my plate", kind: 'primary' }] },
] });

const inbox = (w: World): SkillView => ({ id: 'receptionist', headline: w.inbox.needsReply ? `${w.inbox.needsReply} ${needVerb(w.inbox.needsReply)} a reply` : 'Nothing needs a reply', sections: [
  { type: 'kpis', cols: 2, items: [
    { label: 'Need a reply', value: String(w.inbox.needsReply), prov: 'measured' }, { label: 'For information', value: String(w.inbox.fyi) },
    { label: 'Receipts', value: String(w.inbox.receipts) }, { label: 'Drafts waiting', value: String(w.inbox.drafts), sub: 'never sent by KITT' },
  ] },
  { type: 'list', title: 'Latest triaged', rows: w.inbox.sample.map((m) => ({ title: m.subject, sub: `${m.from} · ${m.cat}` })) },
  { type: 'notice', tone: 'info', text: 'Replies are always drafts in Gmail. KITT archives or snoozes only after you confirm.' },
  { type: 'actions', items: [{ label: "What's in my inbox", utterance: "what's in my inbox", kind: 'primary' }] },
] });

const whatsapp = (w: World): SkillView => ({ id: 'whatsapp', headline: w.wa.unread.length ? `${w.wa.unread.reduce((a, u) => a + u.n, 0)} unread` : 'Quiet', sections: [
  { type: 'kpis', cols: 2, items: [{ label: 'Unread', value: String(w.wa.unread.reduce((a, u) => a + u.n, 0)), prov: 'measured' }, { label: 'Chats', value: String(w.wa.unread.length) }] },
  { type: 'list', title: 'Unread by chat', empty: 'No unread messages.', rows: w.wa.unread.map((u) => ({ title: u.name, sub: u.vip ? 'VIP' : u.group ? 'Group' : 'Direct', right: String(u.n) })) },
  { type: 'notice', tone: 'attention', text: 'Runs as a linked device, an unofficial client. KITT reads and drafts; you send from your phone.' },
] });

const trips = (w: World): SkillView => ({ id: 'trips', headline: `${plural(w.concerts.length, 'event')} on file`, sections: [
  { type: 'list', title: 'Upcoming events', empty: 'Nothing on file yet.', rows: w.concerts.map((c) => ({ title: c.who, sub: [c.date, [c.venue, c.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') })) },
  ...(w.live ? [] : [{ type: 'map' as const }]),
  ...(w.trip.total ? [
    { type: 'kpis' as const, cols: 2, items: [
      { label: 'Budget envelope', value: zmw(w.trip.total), prov: 'assumed' as Prov, sub: 'not a quote' }, { label: 'Flight', value: zmw(w.trip.flight), prov: 'assumed' as Prov },
      { label: `Hotel × ${w.trip.nights}`, value: zmw(w.trip.hotel * w.trip.nights), prov: 'assumed' as Prov }, { label: `Per diem × ${w.trip.days}`, value: zmw(w.trip.perDiem * w.trip.days), prov: 'assumed' as Prov },
    ] },
    { type: 'notice' as const, tone: 'attention' as const, text: w.trip.visa },
  ] : []),
  { type: 'actions', items: [{ label: 'Any concerts worth a trip', utterance: 'any concerts worth a trip', kind: 'primary' }] },
] });

const comments = (w: World): SkillView => ({ id: 'comments', headline: `${w.comments.length} new`, sections: [
  { type: 'kpis', cols: 2, items: [{ label: 'New comments', value: String(w.comments.length), prov: 'measured' }, { label: 'Need a reply', value: String(w.comments.filter((c) => c.needs).length) }] },
  { type: 'list', title: 'Latest', empty: 'No new comments.', rows: w.comments.map((c) => ({ title: c.user, sub: c.text, tag: c.needs ? 'Needs reply' : undefined })) },
  { type: 'notice', tone: 'info', text: 'KITT suggests a reply out loud. It never posts one.' },
] });

const collab = (w: World): SkillView => ({ id: 'collab', headline: `${w.collab.length} creators matched`, sections: [
  { type: 'list', title: 'This week', rows: w.collab.map((c) => ({ title: c.name, sub: `${c.platform} · ${c.where} · ${c.why}`, right: `fit ${c.fit}`, prov: 'modelled' as Prov })) },
  { type: 'notice', tone: 'info', text: 'Fit is a transparent score (topic, geography, audience band, format). Nobody is contacted; openers are drafts.' },
] });

const links = (w: World): SkillView => ({ id: 'linktree', headline: `${w.links.filter((l) => !l.hidden).length} links live`, sections: [
  { type: 'kpis', cols: 2, items: [{ label: 'Clicks, 7 days', value: String(w.links.reduce((a, l) => a + l.clicks, 0)), prov: 'measured' }, { label: 'Live links', value: String(w.links.filter((l) => !l.hidden).length) }] },
  w.live
    ? { type: 'list', title: 'Links', empty: 'Not synced yet.', rows: w.links.map((l, i) => ({ title: l.title, sub: `${l.clicks} clicks · ${l.hidden ? 'hidden' : 'live'}`, right: `#${i + 1}` })) }
    : { type: 'links' },
  { type: 'notice', tone: 'info', text: 'Edits go through Linktree’s official connection and always wait for “Kit, confirm”.' },
] });

const shoplog = (w: World): SkillView => ({ id: 'shoplog', headline: `${plural(w.shoplog.length, 'entry', 'entries')}`, sections: [
  { type: 'list', title: w.live ? 'Recent' : 'This week', empty: 'Nothing logged yet.', rows: w.shoplog.map((e) => ({ title: e.title, sub: `${e.kind} · ${e.when}`, tag: e.status === 'public' ? 'Public' : 'Private' })) },
  ...(w.live ? [] : [{ type: 'scrub' as const }]),
] });

const ideas = (w: World): SkillView => ({ id: 'ideas', headline: `${plural(w.ideas.length, 'idea')}`, sections: [
  { type: 'list', title: 'This month', rows: w.ideas.map((i) => ({ title: i.title, sub: `${i.project} · next: ${i.next} · ${i.ts}`, right: `#${i.id}` })) },
  { type: 'actions', items: [{ label: 'Capture: voice briefs for the car', utterance: 'idea: voice briefs for the car', kind: 'primary' }] },
] });

const BUILDERS: Record<SkillId, (w: World) => SkillView> = { money, subscriptions: subs, security, chief, receptionist: inbox, whatsapp, trips, comments, collab, linktree: links, shoplog, ideas };
export const skillView = (id: SkillId, w: World): SkillView => BUILDERS[id](w);

/** The screen for any skill id: a designed builder for the twelve, else the descriptor the hub sent (World.extra); null if neither. */
export const viewFor = (id: string, w: World): SkillView | null => {
  const b = (BUILDERS as Record<string, (w: World) => SkillView>)[id];
  if (b) return b(w);
  const x = w.extra?.find((e) => e.id === id); if (!x) return null;
  const sections = (x.ui?.sections ?? []).filter((s): s is Section => typeof s === 'object' && s !== null && typeof (s as { type?: unknown }).type === 'string');
  return { id: id as SkillId, headline: x.ui?.headline || x.headline, sections: sections.length ? sections : [{ type: 'notice', tone: 'info', text: x.detail || 'The hub sent no screen for this skill yet.' }] };
};
