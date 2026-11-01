// Skill 11 — Subscription Auditor: finds recurring charges in Gmail receipts, keeps a ledger, converts to kwacha,
// flags past-due / expiring / price changes / duplicates, and answers "what am I paying for monthly".
import { createGmail, GMAIL_MIGRATIONS } from '../../services/gmail.js';
import { matchRule, extractAmount, extractCadence, extractRenewalDate, extractPlan, RULES, DOMAINS } from './rules.js';
import { spokenList } from '../../voice.js';

// Gmail silently returns nothing for very long boolean queries, so the sweep is split into several modest ones.
const chunk = (arr, n) => arr.reduce((acc, x, i) => { (acc[Math.floor(i / n)] ||= []).push(x); return acc; }, []);
export const RECEIPT_QUERIES = [
  'subject:(receipt OR invoice OR "order confirmation" OR renewal OR renews OR "payment received" OR "payment confirmation") -in:draft',
  'subject:("past due" OR "has been paused" OR declined OR "billing problem" OR "payment failed" OR "subscription is expiring" OR "subscription is confirmed") -in:draft',
  ...chunk(DOMAINS, 8).map((ds) => `from:(${ds.join(' OR ')}) -in:draft`),
];
export const RECEIPT_QUERY = RECEIPT_QUERIES[0];

const MIGRATIONS = [
  ...GMAIL_MIGRATIONS,
  `CREATE TABLE IF NOT EXISTS subs_charges (
     message_id TEXT PRIMARY KEY, merchant TEXT NOT NULL, kind TEXT NOT NULL, amount REAL, currency TEXT, amount_zmw REAL, fx_rate REAL,
     plan TEXT, cadence_hint TEXT, renewal_date TEXT, charged_at TEXT NOT NULL, subject TEXT, provenance TEXT NOT NULL DEFAULT 'EXTRACTED', parsed_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS subs_charges_m ON subs_charges(merchant, charged_at);
   CREATE TABLE IF NOT EXISTS subs_merchants (
     merchant TEXT PRIMARY KEY, display TEXT, category TEXT, cadence TEXT, cadence_provenance TEXT, last_amount REAL, currency TEXT, last_amount_zmw REAL, monthly_zmw REAL,
     last_seen TEXT, next_renewal TEXT, next_renewal_provenance TEXT, status TEXT NOT NULL DEFAULT 'active', charges INTEGER NOT NULL DEFAULT 0, flags TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS subs_fx (code TEXT PRIMARY KEY, rate_to_zmw REAL NOT NULL, fetched_at TEXT NOT NULL DEFAULT (datetime('now')), source TEXT);`,
];

const FALLBACK_FX = { USD: 27.0, EUR: 29.5, GBP: 34.0, ZAR: 1.5, ZMW: 1 }; // ASSUMED, replaced by live rates when reachable
const CADENCE_MONTHS = { monthly: 1, annual: 12, weekly: 0.23 };

export default function define(ctx) {
  const { db, composio, log } = ctx;
  const gmail = createGmail({ db, composio });
  let syncing = null;

  async function fx(code) {
    if (code === 'ZMW') return { rate: 1, provenance: 'EXTRACTED' };
    const row = db.prepare('SELECT * FROM subs_fx WHERE code = ?').get(code);
    if (row && Date.now() - new Date(row.fetched_at + 'Z').getTime() < 24 * 3600 * 1000) return { rate: row.rate_to_zmw, provenance: 'INFERRED' };
    try {
      const r = await fetch(`https://open.er-api.com/v6/latest/${code}`, { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      const rate = j?.rates?.ZMW;
      if (!rate) throw new Error('no ZMW rate');
      db.prepare("INSERT INTO subs_fx(code, rate_to_zmw, fetched_at, source) VALUES (?, ?, datetime('now'), 'open.er-api.com') ON CONFLICT(code) DO UPDATE SET rate_to_zmw = excluded.rate_to_zmw, fetched_at = excluded.fetched_at, source = excluded.source").run(code, rate);
      return { rate, provenance: 'INFERRED' };
    } catch (e) {
      log.warn('fx fetch failed; using cached/fallback', { code, err: e.message });
      return { rate: row?.rate_to_zmw || FALLBACK_FX[code] || null, provenance: row ? 'INFERRED' : 'ASSUMED' };
    }
  }

  /** Parse one cached mail row into a charge (or null when excluded / unmatched). Pure except for FX. */
  async function parseMessage(m) {
    const match = matchRule(m);
    if (!match || match.excluded) return null;
    const rule = match.rule;
    const text = `${m.subject || ''}\n${m.snippet || ''}\n${m.body_text || ''}`;
    const amt = extractAmount(text);
    const cadenceHint = extractCadence(text) || null;
    const renewal = extractRenewalDate(text);
    const plan = extractPlan(text);
    let amountZmw = null; let rate = null; let provenance = 'EXTRACTED';
    if (amt) { const f = await fx(amt.currency); rate = f.rate; amountZmw = rate ? Math.round(amt.amount * rate * 100) / 100 : null; if (amt.currency !== 'ZMW') provenance = f.provenance; }
    return { message_id: m.id, merchant: rule.merchant, kind: rule.kind, amount: amt?.amount ?? null, currency: amt?.currency ?? null, amount_zmw: amountZmw, fx_rate: rate, plan, cadence_hint: cadenceHint || rule.cadence || null, renewal_date: renewal, charged_at: m.ts || m.fetched_at, subject: m.subject, provenance, display: rule.display, category: rule.category };
  }

  function recomputeMerchants() {
    const rows = db.prepare('SELECT * FROM subs_charges ORDER BY merchant, charged_at').all();
    const byMerchant = new Map();
    for (const r of rows) { if (!byMerchant.has(r.merchant)) byMerchant.set(r.merchant, []); byMerchant.get(r.merchant).push(r); }
    const up = db.prepare(`INSERT INTO subs_merchants(merchant, display, category, cadence, cadence_provenance, last_amount, currency, last_amount_zmw, monthly_zmw, last_seen, next_renewal, next_renewal_provenance, status, charges, flags, updated_at)
      VALUES (@merchant, @display, @category, @cadence, @cadence_provenance, @last_amount, @currency, @last_amount_zmw, @monthly_zmw, @last_seen, @next_renewal, @next_renewal_provenance, @status, @charges, @flags, datetime('now'))
      ON CONFLICT(merchant) DO UPDATE SET display = excluded.display, category = excluded.category, cadence = excluded.cadence, cadence_provenance = excluded.cadence_provenance, last_amount = excluded.last_amount, currency = excluded.currency,
        last_amount_zmw = excluded.last_amount_zmw, monthly_zmw = excluded.monthly_zmw, last_seen = excluded.last_seen, next_renewal = excluded.next_renewal, next_renewal_provenance = excluded.next_renewal_provenance, status = excluded.status, charges = excluded.charges, flags = excluded.flags, updated_at = excluded.updated_at`);
    const now = Date.now();
    for (const [merchant, list] of byMerchant) {
      const rule = RULES.find((r) => r.merchant === merchant);
      const receipts = list.filter((c) => c.kind === 'receipt' && c.amount != null);
      const last = list[list.length - 1];
      const lastReceipt = receipts[receipts.length - 1];
      const flags = [];
      // cadence: explicit hint > median gap > rule default
      let cadence = null; let cadProv = 'ASSUMED';
      const hinted = list.map((c) => c.cadence_hint).filter(Boolean);
      if (hinted.length) { cadence = hinted[hinted.length - 1]; cadProv = 'EXTRACTED'; }
      if (receipts.length >= 3) {
        const gaps = []; for (let i = 1; i < receipts.length; i++) gaps.push((new Date(receipts[i].charged_at) - new Date(receipts[i - 1].charged_at)) / 86400000);
        gaps.sort((a, b) => a - b); const med = gaps[Math.floor(gaps.length / 2)];
        const inferred = med >= 25 && med <= 35 ? 'monthly' : med >= 350 && med <= 380 ? 'annual' : med >= 6 && med <= 8 ? 'weekly' : null;
        if (inferred && !cadence) { cadence = inferred; cadProv = 'INFERRED'; }
      }
      if (!cadence) { cadence = rule?.cadence || 'monthly'; cadProv = 'ASSUMED'; }
      // price change
      if (receipts.length >= 2) { const a = receipts[receipts.length - 2].amount, b = receipts[receipts.length - 1].amount; if (a && b && receipts[receipts.length - 2].currency === receipts[receipts.length - 1].currency && Math.abs(b - a) / a > 0.05) flags.push(`price ${a > b ? 'drop' : 'increase'} ${a} → ${b} ${receipts[receipts.length - 1].currency}`); }
      // duplicates within 3 days
      for (let i = 1; i < receipts.length; i++) if (Math.abs(new Date(receipts[i].charged_at) - new Date(receipts[i - 1].charged_at)) < 3 * 86400000 && receipts[i].amount === receipts[i - 1].amount) { flags.push('possible duplicate charge'); break; }
      const recentKinds = list.filter((c) => now - new Date(c.charged_at).getTime() < 45 * 86400000).map((c) => c.kind);
      let status = 'active';
      if (recentKinds.includes('past_due')) { status = 'past_due'; flags.push('past due notice'); }
      if (recentKinds.includes('paused')) { status = 'paused'; flags.push('paused'); }
      if (recentKinds.includes('cancelled')) status = 'cancelled';
      if (recentKinds.includes('expiring')) flags.push('expiring soon');
      // next renewal: explicit date from mail > last receipt + cadence
      let nextRenewal = null; let nrProv = 'INFERRED';
      const explicit = list.map((c) => c.renewal_date).filter(Boolean).sort().filter((d) => new Date(d) > new Date(now - 86400000)).pop();
      if (explicit) { nextRenewal = explicit; nrProv = 'EXTRACTED'; }
      else if (lastReceipt && CADENCE_MONTHS[cadence]) { const d = new Date(lastReceipt.charged_at); const months = CADENCE_MONTHS[cadence]; if (months >= 1) d.setMonth(d.getMonth() + months); else d.setDate(d.getDate() + 7); while (d.getTime() < now - 86400000 && status === 'active') { if (months >= 1) d.setMonth(d.getMonth() + months); else d.setDate(d.getDate() + 7); } nextRenewal = d.toISOString().slice(0, 10); }
      if (lastReceipt && now - new Date(lastReceipt.charged_at).getTime() > (CADENCE_MONTHS[cadence] >= 12 ? 400 : 75) * 86400000 && status === 'active') { status = 'stale'; flags.push('no receipt recently'); }
      const monthlyZmw = lastReceipt?.amount_zmw != null && status !== 'cancelled' ? Math.round(lastReceipt.amount_zmw / (CADENCE_MONTHS[cadence] || 1)) : null;
      up.run({ merchant, display: rule?.display || merchant, category: rule?.category || 'other', cadence, cadence_provenance: cadProv, last_amount: lastReceipt?.amount ?? null, currency: lastReceipt?.currency ?? null, last_amount_zmw: lastReceipt?.amount_zmw ?? null, monthly_zmw: monthlyZmw, last_seen: last.charged_at, next_renewal: nextRenewal, next_renewal_provenance: nrProv, status, charges: receipts.length, flags: JSON.stringify(flags) });
    }
  }

  async function ingest(messages) {
    let parsed = 0;
    const ins = db.prepare(`INSERT INTO subs_charges(message_id, merchant, kind, amount, currency, amount_zmw, fx_rate, plan, cadence_hint, renewal_date, charged_at, subject, provenance)
      VALUES (@message_id, @merchant, @kind, @amount, @currency, @amount_zmw, @fx_rate, @plan, @cadence_hint, @renewal_date, @charged_at, @subject, @provenance)
      ON CONFLICT(message_id) DO UPDATE SET amount = COALESCE(excluded.amount, subs_charges.amount), amount_zmw = COALESCE(excluded.amount_zmw, subs_charges.amount_zmw), plan = COALESCE(excluded.plan, subs_charges.plan), renewal_date = COALESCE(excluded.renewal_date, subs_charges.renewal_date), cadence_hint = COALESCE(excluded.cadence_hint, subs_charges.cadence_hint)`);
    for (const m of messages) {
      const c = await parseMessage(m);
      if (!c) continue;
      const { message_id, merchant, kind, amount, currency, amount_zmw, fx_rate, plan, cadence_hint, renewal_date, charged_at, subject, provenance } = c;
      ins.run({ message_id, merchant, kind, amount, currency, amount_zmw, fx_rate, plan, cadence_hint, renewal_date, charged_at, subject, provenance }); parsed++;
    }
    recomputeMerchants();
    return parsed;
  }

  async function sync({ full = false } = {}) {
    const first = !db.prepare('SELECT 1 FROM subs_charges LIMIT 1').get();
    // Composio's Gmail fetch is slow above ~40 messages per call, so each query is capped at 40 and the first sweep
    // uses a 120-day window; annual renewals surface over time (and via `kitt ask "refresh my subscriptions fully"`).
    const window = full ? '400d' : first ? '120d' : '10d';
    const seen = new Set(); const messages = [];
    for (const base of RECEIPT_QUERIES) {
      const { messages: ms } = await gmail.sync(`${base} newer_than:${window}`, { max: 40, tag: 'receipt' }).catch((e) => { log.warn('receipt query failed', { base: base.slice(0, 60), err: e.message }); return { messages: [] }; });
      for (const m of ms) if (!seen.has(m.id)) { seen.add(m.id); messages.push(m); }
    }
    // receipts with no amount in the snippet get their body pulled (bounded to 15 per run to stay polite)
    let hydrated = 0;
    for (const m of messages) {
      const match = matchRule(m);
      if (!match || match.excluded || match.rule.kind !== 'receipt') continue;
      if (!extractAmount(`${m.subject}\n${m.snippet}`) && hydrated < 15) { const h = await gmail.hydrate(m.id).catch(() => null); if (h?.body_text) { m.body_text = h.body_text; hydrated++; } }
    }
    const parsed = await ingest(messages);
    ctx.kv.set('subscriptions', 'last_sync', { at: new Date().toISOString(), fetched: messages.length, parsed, hydrated });
    return { fetched: messages.length, parsed, hydrated };
  }

  function merchants({ activeOnly = true } = {}) {
    return db.prepare(`SELECT * FROM subs_merchants ${activeOnly ? "WHERE status IN ('active','past_due','paused','stale')" : ''} ORDER BY monthly_zmw DESC NULLS LAST`).all().map((r) => ({ ...r, flags: JSON.parse(r.flags || '[]') }));
  }

  function totals() {
    const ms = merchants().filter((m) => m.status !== 'cancelled');
    const monthly = ms.reduce((s, m) => s + (m.monthly_zmw || 0), 0);
    const assumed = ms.filter((m) => m.cadence_provenance === 'ASSUMED' && m.monthly_zmw).length;
    return { monthly_zmw: Math.round(monthly), count: ms.length, assumed, provenance: assumed ? 'INFERRED' : 'EXTRACTED' };
  }

  function renewingWithin(days) {
    const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); const from = new Date().toISOString().slice(0, 10);
    return merchants().filter((m) => m.next_renewal && m.next_renewal >= from && m.next_renewal <= to);
  }

  const kw = (n) => `${Math.round(n).toLocaleString('en-GB')} kwacha`;
  const spokenMerchant = (m) => `${m.display}${m.last_amount != null ? `, ${m.last_amount} ${m.currency === 'USD' ? 'dollars' : m.currency === 'ZMW' ? 'kwacha' : m.currency} ${m.cadence}` : ''}`;

  return {
    id: 'subscriptions', name: 'Subscription Auditor', aliases: ['subs'],
    description: 'recurring charges found in your email receipts, in kwacha, with renewals and past-due flags',
    migrations: MIGRATIONS,
    intents: [
      { name: 'monthly_total', description: 'total monthly subscription spend', examples: ['what am I paying for monthly'], patterns: ['(what am i|what are we) paying (for )?(monthly|per month|a month|each month)', 'how much (are|do) my subscriptions (cost|come to)', '(my )?subscription(s)? total', 'how much do i spend on subscriptions', 'subscription spend'] },
      { name: 'renewing_soon', description: 'subscriptions renewing in the next 7 days', examples: ['anything renewing this week'], patterns: ['(is )?anything renewing (this week|soon|in the next (few|7|seven) days)', 'what renews (this week|soon)', 'upcoming renewals', 'any renewals (coming up|this week)'] },
      { name: 'past_due', description: 'past due, paused or failed subscription payments', examples: ['anything past due'], patterns: ['(is )?anything past due', 'any (failed|unsuccessful) (payments|subscriptions)', 'any (paused|suspended) (subscriptions|services)', 'overdue subscriptions'] },
      { name: 'list', description: 'list all subscriptions', examples: ['list my subscriptions'], patterns: ['list (all )?(my )?subscriptions', 'what subscriptions do i have', 'what am i subscribed to', 'show (me )?(my )?subscriptions'] },
      { name: 'merchant', description: 'details for one subscription', examples: ['how much is Spotify'], patterns: ['how much (is|am i paying for) {merchant}', 'when does {merchant} renew', 'tell me about (my )?{merchant} subscription'], slots: ['merchant'] },
      { name: 'sync', description: 'refresh subscriptions from Gmail now', examples: ['refresh my subscriptions'], patterns: ['(refresh|sync|update) (my )?subscriptions( fully| full)?', 'check (my )?(email )?receipts'] },
    ],
    routines: [
      { name: 'subscriptions.sync', cron: '30 6 * * *', description: 'pull new receipts from Gmail and recompute the subscription ledger', run: async () => { const r = await sync(); const t = totals(); const flagged = merchants().filter((m) => m.flags.length); return { summary: `fetched ${r.fetched}, parsed ${r.parsed}; ${t.count} merchants, ${t.monthly_zmw} ZMW/mo; ${flagged.length} flagged`, notify: flagged.some((m) => m.status === 'past_due') ? { push: { title: 'KITT: subscription past due', body: flagged.filter((m) => m.status === 'past_due').map((m) => m.display).join(', '), tags: 'warning,credit_card', priority: 'high' } } : undefined }; } },
    ],
    async handle(intent, slots, ctx) {
      if (intent === 'sync') {
        const full = /full/i.test(ctx.text || '');
        if (ctx.source === 'cli') { const r = await sync({ full }); return { speak: `Refreshed. ${r.fetched} receipts checked, ${r.parsed} matched. ${totals().count} subscriptions on file.` }; }
        if (syncing) return { speak: 'A receipt refresh is already running. Ask me again in a minute.' };
        syncing = sync({ full }).catch((e) => log.warn('background sync failed', { err: e.message })).finally(() => { syncing = null; });
        return { speak: `Refreshing receipts in the background; it takes about two minutes. Ask me for the total afterwards.` };
      }
      const ms = merchants();
      if (!ms.length) return { speak: "I haven't indexed any receipts yet. Say 'refresh my subscriptions' and I'll read your Gmail receipts." };
      if (intent === 'monthly_total') { const t = totals(); const top = ms.filter((m) => m.monthly_zmw).slice(0, 3).map((m) => `${m.display} ${kw(m.monthly_zmw)}`); return { speak: `About ${kw(t.monthly_zmw)} a month across ${t.count} subscriptions${t.assumed ? `, with ${t.assumed} cadence${t.assumed > 1 ? 's' : ''} assumed` : ''}. Biggest: ${spokenList(top)}.`, display: { totals: t, merchants: ms } }; }
      if (intent === 'renewing_soon') { const r = renewingWithin(7); return { speak: r.length ? `${r.length} renewing in the next week: ${spokenList(r.map((m) => `${m.display} on ${new Date(m.next_renewal).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}${m.last_amount != null ? ` for ${m.last_amount} ${m.currency === 'USD' ? 'dollars' : m.currency}` : ''}`))}.` : 'Nothing renews in the next seven days.', display: r }; }
      if (intent === 'past_due') { const bad = ms.filter((m) => ['past_due', 'paused'].includes(m.status) || m.flags.some((f) => /expiring/.test(f))); return { speak: bad.length ? `Attention on ${bad.length}: ${spokenList(bad.map((m) => `${m.display} is ${m.status === 'active' ? 'expiring soon' : m.status.replace('_', ' ')}`))}.` : 'No past-due, paused or expiring subscriptions.', display: bad }; }
      if (intent === 'list') return { speak: `${ms.length} subscriptions: ${spokenList(ms.map(spokenMerchant), { max: 12 })}.`, display: ms };
      if (intent === 'merchant') { const q = String(slots.merchant || '').toLowerCase(); const m = ms.find((x) => x.merchant.includes(q) || x.display.toLowerCase().includes(q)); if (!m) return { speak: `I don't have a subscription matching ${slots.merchant}.` }; return { speak: `${m.display}: ${m.last_amount != null ? `${m.last_amount} ${m.currency === 'USD' ? 'dollars' : m.currency} ${m.cadence}` : 'amount unknown'}${m.next_renewal ? `, next renewal ${new Date(m.next_renewal).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : ''}${m.flags.length ? `. Flags: ${m.flags.join('; ')}` : ''}. Status ${m.status.replace('_', ' ')}.`, display: m }; }
      return { speak: "I didn't catch which subscription question that was." };
    },
    async brief({ kind }) {
      const ms = merchants(); if (!ms.length) return null;
      const bad = ms.filter((m) => ['past_due', 'paused'].includes(m.status)); const soon = renewingWithin(3); const t = totals();
      const parts = [];
      if (bad.length) parts.push(`Subscriptions: ${spokenList(bad.map((m) => m.display))} ${bad.length === 1 ? 'is' : 'are'} past due or paused.`);
      if (soon.length) parts.push(`${spokenList(soon.map((m) => m.display))} renew${soon.length === 1 ? 's' : ''} within three days.`);
      const dow = new Date().getDay();
      if (!parts.length && kind === 'morning' && dow === 1) parts.push(`Subscriptions steady at about ${kw(t.monthly_zmw)} a month.`);
      return parts.length ? { speak: parts.join(' '), decisions: bad.length } : null;
    },
    async view() { return { totals: totals(), merchants: merchants({ activeOnly: false }), renewing_7d: renewingWithin(7), renewing_30d: renewingWithin(30), last_sync: ctx.kv.get('subscriptions', 'last_sync') }; },
    async health() { const ls = ctx.kv.get('subscriptions', 'last_sync'); const err = db.prepare("SELECT last_error FROM mail_sync WHERE last_error IS NOT NULL AND query LIKE '%-in:draft newer_than:%' ORDER BY last_sync_at DESC LIMIT 1").get()?.last_error; return { ok: !err, detail: ls ? `last sync ${ls.at}, ${merchants().length} merchants${err ? `; last error: ${err}` : ''}` : 'never synced' }; },
    async dashboard() {
      const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const t = totals();
      const rows = merchants({ activeOnly: false }).map((m) => `<tr><td>${esc(m.display)}</td><td>${esc(m.category)}</td><td>${m.last_amount != null ? `${esc(m.last_amount)} ${esc(m.currency)}` : '—'}</td><td>${esc(m.cadence)} <small>${esc(m.cadence_provenance)}</small></td><td>${m.monthly_zmw != null ? esc(m.monthly_zmw.toLocaleString('en-GB')) : '—'}</td><td>${esc(m.next_renewal || '—')} <small>${esc(m.next_renewal ? m.next_renewal_provenance : '')}</small></td><td class="${m.status === 'active' ? '' : 'bad'}">${esc(m.status)}</td><td>${esc(m.flags.join('; '))}</td></tr>`).join('');
      return `<p>Monthly total <b>${esc(t.monthly_zmw.toLocaleString('en-GB'))} ZMW</b> (${esc(t.provenance)}; ${t.count} merchants, ${t.assumed} with assumed cadence). FX converted amounts are INFERRED.</p><table><tr><th>Merchant</th><th>Category</th><th>Last charge</th><th>Cadence</th><th>ZMW / month</th><th>Next renewal</th><th>Status</th><th>Flags</th></tr>${rows}</table>`;
    },
    // exposed for tests and other skills
    _internal: { parseMessage, ingest, recomputeMerchants, merchants, totals, renewingWithin, sync },
  };
}
