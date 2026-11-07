// Card ordering, layout resolution and the deterministic "intent grammar" the mockups answer with.
// The point of the mockup is that none of this is canned: change a scenario and the stack re-ranks.
import { zmw, plural, needVerb, skillMeta, type Device, type Pending, type SkillId, type World, SKILLS } from './data';
import type { Prov } from './kit';
import type { IconName } from './icons';

export interface CardModel {
  id: string; skill: SkillId | 'confirm'; icon: IconName; eyebrow: string; headline: string; sub: string; speak: string;
  prov?: Prov; level: 0 | 1 | 2 | 3 | 4; score: number; why: string[]; stale?: string; inverse?: boolean; delta?: { text: string; good: boolean };
}

const sevWord = (n: number) => (n >= 4 ? 'critical' : n === 3 ? 'high' : n === 2 ? 'attention' : n === 1 ? 'minor' : 'clear');
export { sevWord };

export function buildCards(w: World): CardModel[] {
  const cards: CardModel[] = [];
  const stale = w.offline ? `as of ${w.asOf}` : undefined;
  const push = (c: Omit<CardModel, 'icon' | 'eyebrow' | 'stale' | 'score' | 'why'> & { skill: SkillId; base: number; bumps: [string, number][] }) => {
    const m = skillMeta(c.skill);
    // live only: a skill the hub reports as unhealthy outranks its own (possibly stale) numbers
    const h = w.health?.[c.skill];
    const bumps = h && !h.ok ? [...c.bumps, ['skill health is red', 40] as [string, number]] : c.bumps;
    const level = h && !h.ok ? (Math.max(c.level, 2) as CardModel['level']) : c.level;
    const detail = (h?.detail || 'the skill reported a problem').replace(/\s+/g, ' ');
    const sub = h && !h.ok ? `Needs attention: ${detail.length > 140 ? `${detail.slice(0, 140)}…` : detail}` : c.sub;
    const score = c.base + bumps.reduce((a, [, n]) => a + n, 0);
    cards.push({ ...c, level, sub, icon: m.icon, eyebrow: m.name, stale, score, why: [`${c.base} base`, ...bumps.map(([t, n]) => `${n >= 0 ? '+' : ''}${n} ${t}`)] });
  };

  if (w.pending) {
    cards.push({ id: 'pending', skill: 'confirm', icon: 'check', eyebrow: 'Waiting for your OK', headline: w.pending.summary, sub: w.pending.speak, speak: w.pending.speak, level: 4, score: 1000, why: ['1000 a pending action outranks everything', 'expires in 10 minutes'], inverse: true, stale });
  }

  const crit = w.critical;
  push({ id: 'security', skill: 'security', level: crit ? 4 : w.actionable ? 2 : 0, prov: 'measured',
    headline: crit ? 'Critical: a repository became public' : w.actionable ? `${plural(w.actionable, 'finding')} ${w.actionable === 1 ? 'needs' : 'need'} attention` : 'Security is clear',
    sub: crit ? crit.detail : w.actionable ? (w.findings.find((f) => f.level === 'high' || f.level === 'medium') ?? w.findings[0])?.title ?? 'Findings open' : w.live ? 'No findings open' : 'Last sweep 07:00 · four providers checked',
    speak: crit ? `Security: critical. ${crit.title}.` : w.actionable ? `Security: ${plural(w.actionable, 'finding')} ${w.actionable === 1 ? 'needs' : 'need'} attention.` : 'Security is clear.',
    base: 5, bumps: crit ? [['critical finding', 945]] : w.actionable ? [['medium finding', 50]] : [] });

  const od = w.board.overdue.length; const bl = w.board.blocked.length;
  push({ id: 'chief', skill: 'chief', level: od ? 2 : 0, prov: 'measured',
    headline: od || bl ? `${od} overdue · ${bl} blocked` : 'Nothing overdue or blocked',
    sub: `${w.board.dueSoon.length} due this week · ${plural(w.board.incidents, 'open incident')}`,
    speak: od || bl ? `Board: ${plural(od, 'overdue item')}, ${bl} blocked, ${plural(w.board.incidents, 'open incident')}.` : `Board is clear; ${plural(w.board.dueSoon.length, 'item')} due this week.`,
    base: 10, bumps: [...(od ? [[`overdue ×${od}`, od * 4] as [string, number]] : []), ...(bl ? [[`blocked ×${bl}`, bl * 3] as [string, number]] : []), ...(w.board.incidents ? [['open incidents', 8] as [string, number]] : [])] });

  push({ id: 'subscriptions', skill: 'subscriptions', level: w.pastDue ? 2 : 0, prov: 'modelled',
    headline: w.pastDue ? `${w.pastDue} past due · ${zmw(w.subsMonthly)} a month` : `${zmw(w.subsMonthly)} a month`,
    sub: w.live ? `${plural(w.subs.length, 'merchant')} from receipt e-mails · foreign charges converted at an assumed rate` : `Converted at K${w.fx} per US dollar (assumed rate)`,
    speak: w.pastDue ? `Subscriptions: ${w.pastDue} past due, about ${zmw(w.subsMonthly)} a month.` : `Subscriptions steady at about ${zmw(w.subsMonthly)} a month.`,
    base: 6, bumps: w.pastDue ? [[`past due ×${w.pastDue}`, w.pastDue * 22]] : [] });

  push({ id: 'money', skill: 'money', level: 1, prov: 'measured', headline: w.wallets.length ? `Cash position ${zmw(w.cashTotal)}` : 'No balances yet', sub: `Spent ${zmw(w.spend7)} in 7 days · ${plural(w.unparsed, 'alert')} not parsed`,
    delta: w.live ? undefined : { text: '+12% vs last week', good: false }, speak: `Money: cash position about ${zmw(w.cashTotal)}. Spent ${zmw(w.spend7)} this week.`, base: 14, bumps: [['spend watch', 6]] });

  const unread = w.wa.unread.reduce((a, u) => a + u.n, 0); const vip = w.wa.unread.some((u) => u.vip);
  const topChats = w.wa.unread.slice(0, 2).map((u) => `${u.name} ${u.n}`).join(' · ');
  push({ id: 'whatsapp', skill: 'whatsapp', level: vip ? 1 : 0, prov: 'measured', headline: unread ? `${unread} unread in ${plural(w.wa.unread.length, 'chat')}` : w.wa.online ? 'No unread messages' : 'Listener not running',
    sub: unread ? (w.live ? topChats : 'CEO (VIP) first, then groups') : w.wa.online ? 'Linked device online' : 'Start the listener on the Mac',
    speak: unread ? `WhatsApp: ${unread} unread in ${plural(w.wa.unread.length, 'chat')}${vip ? ', one from a VIP' : ''}.` : 'WhatsApp is quiet.', base: 8, bumps: unread ? [['unread', Math.min(60, unread * 2)], ...(vip ? [['VIP sender', 12] as [string, number]] : [])] : [] });

  push({ id: 'receptionist', skill: 'receptionist', level: w.inbox.drafts ? 1 : 0, prov: 'measured', headline: w.inbox.needsReply ? `${w.inbox.needsReply} ${needVerb(w.inbox.needsReply)} a reply` : 'Nothing needs a reply',
    sub: `${w.inbox.fyi} for information · ${plural(w.inbox.receipts, 'receipt')}${w.inbox.drafts ? ` · ${plural(w.inbox.drafts, 'draft')} waiting` : ''}`, speak: w.inbox.needsReply ? `Inbox: ${w.inbox.needsReply} ${needVerb(w.inbox.needsReply)} a reply.` : `Inbox is quiet; ${w.inbox.fyi} for information.`, base: 6, bumps: w.inbox.drafts ? [['draft waiting', 30]] : [] });

  const needs = w.comments.filter((c) => c.needs).length;
  push({ id: 'comments', skill: 'comments', level: needs ? 1 : 0, prov: 'measured', headline: w.comments.length ? `${w.comments.length} new · ${needs} ${needVerb(needs)} a reply` : 'No new comments', sub: w.comments.length ? (w.live ? (needs ? `${plural(needs, 'question')} to answer` : 'Nothing flagged for a reply') : 'One question about booking') : w.live ? 'Nothing new' : 'Checked 07:10',
    speak: w.comments.length ? `${plural(w.comments.length, 'new comment')}, ${needs} ${needVerb(needs)} a reply.` : 'No new comments.', base: 4, bumps: needs ? [['question to answer', 10]] : [] });

  const next = w.concerts[0];
  push({ id: 'trips', skill: 'trips', level: 0, prov: 'assumed', headline: next ? `${plural(w.concerts.length, 'event')} · next ${next.date}` : 'No events on file',
    sub: w.trip.total ? `${w.trip.title}: ${zmw(w.trip.total)} (assumed budget)` : 'Concerts and away events turn into trip plans',
    speak: next ? `Trips: ${plural(w.concerts.length, 'event')}. Next is ${next.who} on ${next.date}.` : 'No trips on file.', base: 4, bumps: [] });
  push({ id: 'ideas', skill: 'ideas', level: 0, headline: `${plural(w.ideas.length, 'idea')} this month`, sub: w.ideas[0]?.title ?? 'Say “idea:” and what you thought of.', speak: w.ideas[0] ? `Ideas: ${w.ideas.length} this month. Latest: ${w.ideas[0].title}.` : 'No ideas captured this month.', base: 3, bumps: [] });
  push({ id: 'collab', skill: 'collab', level: 0, prov: 'modelled', headline: w.collab.length ? `${w.collab.length} creators matched` : 'No matches yet', sub: w.collab[0] ? `Top fit ${w.collab[0].fit} · weekly list on Monday` : 'The weekly list runs on Monday', speak: `${w.collab.length} creator matches ready.`, base: 2, bumps: [] });
  push({ id: 'linktree', skill: 'linktree', level: 0, prov: 'measured', headline: `${w.links.filter((l) => !l.hidden).length} links live`, sub: w.links[0] ? `Top link: ${w.links[0].title}` : 'Link page not synced yet', speak: `Link page has ${w.links.length} links.`, base: 2, bumps: [] });
  push({ id: 'shoplog', skill: 'shoplog', level: 0, headline: `${w.shoplog.length} entries this week`, sub: `${w.shoplog.filter((e) => e.status === 'private').length} still private`, speak: 'Shop log has entries waiting to be published.', base: 1, bumps: [] });

  return cards.sort((a, b) => b.score - a.score);
}

export type LayoutPref = 'auto' | 'drive' | 'glance' | 'desk';
export type Layout = 'comfort' | 'drive' | 'glance' | 'desk';
/** Layout is an axis of its own (density + interaction budget); appearance is a separate axis. */
export function resolveLayout(device: Device, pref: LayoutPref): Layout {
  if (device === 'watch') return 'glance';
  if (device === 'car') return 'drive';
  if (device === 'pad') return pref === 'glance' ? 'glance' : pref === 'drive' ? 'drive' : 'desk';
  return pref === 'drive' ? 'drive' : pref === 'glance' ? 'glance' : 'comfort';
}

export interface Answer { speak: string; via: 'pattern' | 'confirm' | 'unknown'; intent: string; needsConfirm?: Pending; effect?: { type: 'confirm' | 'cancel' | 'idea'; text?: string }; open?: SkillId }

let pid = 0;
/** Deterministic pattern grammar, mirroring the hub: regex first; anything else is an honest "I didn't catch that". */
export function answer(raw: string, w: World, device: Device, now: number): Answer {
  const res = answerInner(raw, w, device, now);
  if (w.offline) {
    if (res.effect || res.needsConfirm) return { speak: "The hub is unreachable, so I can't save, send or confirm anything right now. Reads still work from the cached copy.", via: 'unknown', intent: 'offline' };
    if (res.via === 'pattern') return { ...res, speak: `Hub unreachable. Reading the cached copy from ${w.asOf}. ${res.speak}` };
  }
  return res;
}

function answerInner(raw: string, w: World, device: Device, now: number): Answer {
  const t = raw.toLowerCase().replace(/^(hey |ok |okay )?(kitt|kit)[,.! ]*/i, '').replace(/[.?!]+$/g, '').trim();
  const cards = buildCards(w);
  const plate = () => `${plural(w.board.overdue.length, 'overdue item')}, ${w.board.blocked.length} blocked, ${plural(w.board.incidents, 'open incident')}. ${w.board.dueSoon.length ? `Due this week: ${w.board.dueSoon.map((d) => d.title).join(' and ')}.` : 'Nothing due this week.'}`;
  if (/^(confirm|yes do it|go ahead|do it)$/.test(t)) return w.pending ? { speak: w.pending.kind === 'draft' ? 'Draft saved in Gmail, not sent. Review it on your phone before sending.' : `Logged ${zmw(w.pending.payload?.amount ?? 0)} cash for ${w.pending.payload?.note ?? 'cash'}.`, via: 'confirm', intent: 'confirm', effect: { type: 'confirm' } } : { speak: 'There is nothing waiting for confirmation.', via: 'confirm', intent: 'confirm' };
  if (/^(cancel|never mind|nevermind|abort)$/.test(t)) return w.pending ? { speak: `Cancelled: ${w.pending.summary}`, via: 'confirm', intent: 'cancel', effect: { type: 'cancel' } } : { speak: 'Nothing to cancel.', via: 'confirm', intent: 'cancel' };
  let m = /^log cash (\d+)(?: kwacha)?(?: (?:for|on))? ?(.*)$/.exec(t);
  if (m) { const amount = Number(m[1]); const note = m[2] || 'cash'; return { speak: `Log ${zmw(amount)} cash for ${note}? Say 'Kit, confirm' within 10 minutes, or 'Kit, cancel'.`, via: 'pattern', intent: 'money.log_cash', needsConfirm: { id: `p${++pid}`, kind: 'log_cash', skill: 'money', summary: `Log ${zmw(amount)} cash for ${note}`, speak: `Say 'Kit, confirm' to log it, or 'Kit, cancel'.`, source: device, createdAt: now, ttlSec: 600, payload: { amount, note } } }; }
  m = /^(?:idea|note to self|remember)[: ]+(.+)$/.exec(t);
  if (m) return { speak: `Captured idea: ${m[1]}. Structured and filed in the Ideas notebook.`, via: 'pattern', intent: 'ideas.capture', effect: { type: 'idea', text: m[1] }, open: 'ideas' };
  if (/(on my plate|priorities|what needs (my )?attention)/.test(t)) return { speak: `Board: ${plate()}`, via: 'pattern', intent: 'chief.plate', open: 'chief' };
  if (/(cash position|balance|how much (money|cash))/.test(t)) return { speak: `Cash position about ${zmw(w.cashTotal)} across ${w.wallets.length} wallets. Spent ${zmw(w.spend7)} in the last seven days.`, via: 'pattern', intent: 'money.position', open: 'money' };
  if (/(past due|renew|subscription)/.test(t)) return { speak: w.pastDue ? `${plural(w.pastDue, 'subscription')} past due: ${w.subs.filter((s) => s.status === 'past_due').map((s) => s.name).join(' and ')}. About ${zmw(w.subsMonthly)} a month in total.` : `No subscriptions past due. About ${zmw(w.subsMonthly)} a month.`, via: 'pattern', intent: 'subscriptions.past_due', open: 'subscriptions' };
  if (/security/.test(t)) return { speak: w.critical ? `Critical: ${w.critical.title}.` : w.actionable ? `Security: ${plural(w.actionable, 'finding')} ${w.actionable === 1 ? 'needs' : 'need'} attention. ${(w.findings.find((f) => f.level === 'high' || f.level === 'medium') ?? w.findings[0])?.title ?? ''}`.trim() : 'Security is clear.', via: 'pattern', intent: 'security.brief', open: 'security' };
  if (/(inbox|email|mail)/.test(t)) return { speak: `Nothing needs a reply; ${w.inbox.fyi} for information and ${w.inbox.receipts} receipts.${w.inbox.drafts ? ' One draft is waiting for your confirmation.' : ''}`, via: 'pattern', intent: 'receptionist.brief', open: 'receptionist' };
  if (/(concert|trip|travel)/.test(t)) return { speak: w.concerts[0] ? `${plural(w.concerts.length, 'event')} on file. Next: ${w.concerts[0].who} on ${w.concerts[0].date}, ${w.concerts[0].city}.${w.trip.total ? ` ${w.trip.title} is drafted, about ${zmw(w.trip.total)}, assumed.` : ''}` : 'No trips or concerts on file.', via: 'pattern', intent: 'trips.concerts', open: 'trips' };
  if (/(whatsapp)/.test(t)) return { speak: w.wa.unread.length ? `${w.wa.unread.reduce((a, u) => a + u.n, 0)} unread. ${w.wa.unread.map((u) => `${u.name} ${u.n}`).join(', ')}.` : 'WhatsApp is quiet.', via: 'pattern', intent: 'whatsapp.new', open: 'whatsapp' };
  if (/(good morning|morning brief|brief me)/.test(t)) return { speak: `Good morning, Travis. ${cards.filter((c) => c.skill !== 'confirm').slice(0, 4).map((c) => c.speak).join(' ')}`, via: 'pattern', intent: 'kitt.morning' };
  if (/^(help|what can you do)$/.test(t)) return { speak: `I can help with ${SKILLS.slice(0, 6).map((s) => s.name).join(', ')} and more. Try: what's on my plate, cash position, anything past due, log cash 200 fuel.`, via: 'pattern', intent: 'kitt.help' };
  return { speak: "I didn't catch a command I know. Say 'Kit, help' for options.", via: 'unknown', intent: 'none' };
}

export const SUGGESTIONS = ["What's on my plate", 'Cash position', 'Anything past due', 'Security status', 'Log cash 200 fuel', 'Idea: voice briefs for the car'];
