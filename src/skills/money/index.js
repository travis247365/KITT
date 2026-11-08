// Skill 2 — Money Dashboard: a local ledger fed by forwarded transaction SMS (MTN MoMo, Airtel Money, FNB, Stanbic),
// voice cash entries and bank statement CSVs. Nothing leaves the Mac; the LLM never sees amounts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseSms } from './parsers.js';
import { smsWatchOnce } from './smswatch.js';
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS money_tx (
     id TEXT PRIMARY KEY, ts TEXT NOT NULL, source TEXT NOT NULL, provider TEXT, wallet TEXT NOT NULL, kind TEXT, direction TEXT, amount REAL, fee REAL, balance_after REAL,
     counterparty TEXT, category TEXT, ref TEXT, note TEXT, confidence TEXT NOT NULL DEFAULT 'EXTRACTED', raw TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS money_tx_ts ON money_tx(ts);
   CREATE TABLE IF NOT EXISTS money_raw (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')), sender TEXT, body TEXT, parsed INTEGER NOT NULL DEFAULT 0, tx_id TEXT);
   CREATE TABLE IF NOT EXISTS money_balances (wallet TEXT PRIMARY KEY, balance REAL, as_of TEXT, source TEXT, confidence TEXT);`,
  // 0.3.3: ingestSms looks a message up by its text before logging it raw
  `CREATE INDEX IF NOT EXISTS money_raw_sender_body ON money_raw(sender, body);`,
];

const CATEGORY_RULES = [
  [/fuel|petrol|diesel|total|puma|engen|mount meru/i, 'fuel'], [/shoprite|pick n pay|spar|choppies|food|grocer|market|kfc|hungry lion|nando|debonair|restaurant|cafe|coffee/i, 'food'],
  [/airtime|bundle|data|zamtel|mtn|airtel/i, 'telecom'], [/zesco|water|lwsc|dstv|multichoice|showmax|netflix|spotify/i, 'utilities'], [/school|fees|tuition|uniform/i, 'education'],
  [/loan|repay|lender|credit/i, 'lenders'], [/instal|asset finance/i, 'vehicle_finance'], [/rent|landlord/i, 'rent'],
  [/pharm|clinic|hospital|medical|doctor|medic/i, 'health'], [/salary|payroll|invoice|consult/i, 'income'], [/agent|cash ?out|withdraw/i, 'cash'],
];
export function categorise(tx, extraIncome = []) { const hay = `${tx.counterparty || ''} ${tx.note || ''} ${tx.kind || ''}`; if (tx.direction === 'in' && extraIncome.some((re) => re.test(hay))) return 'income'; for (const [re, c] of CATEGORY_RULES) if (re.test(hay)) return c; return tx.direction === 'in' ? 'income' : 'other'; }

export default function define(ctx) {
  const { db, config, log } = ctx;
  const cfg = { wallets: ['MTN MoMo', 'Airtel Money', 'FNB', 'Stanbic', 'Cash'], ...(config.money || {}) };
  const extraIncome = (cfg.income_patterns || []).map((p) => new RegExp(p, 'i'));
  // the Mac-side SMS feed (smswatch.js): on unless `money.sms_watch` is false in kitt.json; only macOS has Messages
  const watchOn = process.platform === 'darwin' && cfg.sms_watch !== false;
  const cursorFile = path.join(ctx.paths?.configDir || path.join(process.env.HOME || '', '.config/kitt'), 'sms-watch-cursor.json');
  const feedState = () => ctx.kv?.get('money', 'sms_watch', null); // employer/client names live in ~/.config/kitt/kitt.json
  const txId = (t) => crypto.createHash('sha1').update(`${t.provider}|${t.ts}|${t.amount}|${t.direction}|${t.ref || t.counterparty || ''}|${(t.raw || '').slice(0, 60)}`).digest('hex').slice(0, 16);

  function insertTx(t) {
    const id = txId(t);
    let exists = db.prepare('SELECT 1 FROM money_tx WHERE id = ?').get(id);
    // a confirmation the provider sends twice in two wordings (the parser sets dedupe_s): the same wallet, direction and amount
    // within that many seconds is the same payment, unless both carry a reference and the references differ
    if (!exists && t.dedupe_s && t.amount != null) {
      const twin = db.prepare("SELECT id FROM money_tx WHERE provider = ? AND direction = ? AND amount = ? AND ABS(julianday(ts) - julianday(?)) * 86400 <= ? AND (ref IS NULL OR ? IS NULL OR ref = ?) LIMIT 1")
        .get(t.provider || null, t.direction || null, t.amount, t.ts, t.dedupe_s, t.ref || null, t.ref || null);
      if (twin) return { id: twin.id, duplicate: true };
    }
    // a message seen again that now yields the balance it carries fills it in (never overwrites)
    if (exists && t.balance_after != null) db.prepare('UPDATE money_tx SET balance_after = ? WHERE id = ? AND balance_after IS NULL').run(t.balance_after, id);
    if (!exists) db.prepare('INSERT INTO money_tx(id, ts, source, provider, wallet, kind, direction, amount, fee, balance_after, counterparty, category, ref, note, confidence, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, t.ts, t.source, t.provider || null, t.wallet, t.kind || null, t.direction || null, t.amount ?? null, t.fee ?? null, t.balance_after ?? null, t.counterparty || null, t.category || categorise(t, extraIncome), t.ref || null, t.note || null, t.confidence || 'EXTRACTED', (t.raw || '').slice(0, 1000));
    if (t.balance_after != null) db.prepare("INSERT INTO money_balances(wallet, balance, as_of, source, confidence) VALUES (?, ?, ?, ?, 'EXTRACTED') ON CONFLICT(wallet) DO UPDATE SET balance = CASE WHEN excluded.as_of >= money_balances.as_of THEN excluded.balance ELSE money_balances.balance END, as_of = MAX(excluded.as_of, money_balances.as_of), source = excluded.source").run(t.wallet, t.balance_after, t.ts, t.source);
    return { id, duplicate: Boolean(exists) };
  }

  /** POST /v1/sms from the iPhone "Message" automation (sender + body). Never throws; keeps the raw text when unparsed. */
  function ingestSms({ sender, body, received_at }, c) {
    const ts = received_at ? new Date(received_at).toISOString() : new Date().toISOString();
    const s = String(sender || ''); const b = String(body || '');
    // the raw log keeps each distinct message once: a re-run of the backfill, or the watcher re-reading a message, reuses its row
    // (and marks it parsed when a newer parser now understands it) instead of adding another copy
    const rawRow = db.prepare('SELECT id, parsed FROM money_raw WHERE sender = ? AND body = ? ORDER BY parsed DESC, id LIMIT 1').get(s, b)
      || db.prepare('INSERT INTO money_raw(sender, body) VALUES (?, ?) RETURNING id, parsed').get(s, b);
    const p = parseSms({ sender, body });
    if (!p) { log.info('sms kept raw (unparsed)', { sender }); return { ok: true, parsed: false, raw_id: rawRow.id }; }
    const tx = { ...p, ts, source: c?.source || 'sms', raw: body };
    const r = insertTx(tx);
    if (!rawRow.parsed) db.prepare('UPDATE money_raw SET parsed = 1, tx_id = ? WHERE id = ?').run(r.id, rawRow.id);
    return { ok: true, parsed: true, duplicate: r.duplicate, tx: { ...tx, id: r.id, raw: undefined } };
  }

  function logCash(amount, note, c) { const t = { ts: new Date().toISOString(), source: c?.source || 'cli', provider: 'cash', wallet: 'Cash', kind: 'payment', direction: 'out', amount, counterparty: note || null, note: note || null, confidence: 'EXTRACTED', raw: `voice: ${amount} ${note || ''}` }; return insertTx(t); }

  const kw = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-GB')} kwacha`;
  const balances = () => db.prepare('SELECT * FROM money_balances ORDER BY wallet').all();
  const sumWhere = (where, params) => db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(fee, 0)), 0) s, COUNT(*) n FROM money_tx WHERE ${where}`).get(...params);
  const windowSpend = (days) => sumWhere("direction = 'out' AND ts >= datetime('now', ?)", [`-${days} days`]);
  const windowIncome = (days) => sumWhere("direction = 'in' AND ts >= datetime('now', ?)", [`-${days} days`]);
  const byCategory = (days) => db.prepare("SELECT category, COALESCE(SUM(amount + COALESCE(fee,0)),0) s, COUNT(*) n FROM money_tx WHERE direction = 'out' AND ts >= datetime('now', ?) GROUP BY category ORDER BY s DESC").all(`-${days} days`);
  const bigDebits = (days, min) => db.prepare("SELECT * FROM money_tx WHERE direction = 'out' AND amount >= ? AND ts >= datetime('now', ?) ORDER BY amount DESC LIMIT 5").all(min, `-${days} days`);

  function position() {
    const b = balances();
    if (!b.length) return { speak: 'No wallet balances yet. Balances arrive from forwarded transaction messages; set up the iPhone automation first.', display: {} };
    const total = b.reduce((s, x) => s + (x.balance || 0), 0);
    const stale = b.filter((x) => Date.now() - new Date(x.as_of).getTime() > 7 * 86400000);
    return { speak: `Cash position about ${kw(total)} across ${spokenList(b.map((x) => `${x.wallet} ${kw(x.balance)}`), { max: 5 })}.${stale.length ? ` ${spokenList(stale.map((x) => x.wallet))} ${stale.length === 1 ? 'is' : 'are'} more than a week old.` : ''}`, display: { total, wallets: b } };
  }

  return {
    id: 'money', name: 'Money Dashboard', aliases: ['cash', 'finance'],
    description: 'wallet balances and spend from forwarded mobile-money and bank messages, plus voice cash entries',
    migrations: MIGRATIONS,
    intents: [
      { name: 'position', description: 'cash position across wallets', examples: ["what's my cash position"], patterns: ["(what's|what is|whats) my (cash )?(position|balance|balances)", '(my )?cash position', 'how much (money|cash) do i have', 'wallet balances', 'balances'] },
      { name: 'spend', description: 'spend over a period', examples: ['how much did I spend this week'], patterns: ['how much (did i|have i) (spend|spent) (this|the last|last|today|yesterday)( {period})?', '(my )?(spend|spending) (this|last) {period}', 'what did i spend (this|last|today|yesterday)( {period})?', 'how much (did i|have i) (spend|spent) {period}'], slots: ['period'] },
      { name: 'big', description: 'large debits recently', examples: ['any big debits today'], patterns: ['any (big|large) (debits|payments|spends?)( today| this week)?', 'biggest (payments|debits)( this week| today)?', 'what went out today'] },
      { name: 'log_cash', description: 'log a cash spend', examples: ['log cash 200 fuel'], patterns: ['log cash {amount} (kwacha )?(for |on )?{note}', 'log cash {amount}', 'i (spent|paid) {amount} (kwacha )?(cash )?(on|for) {note}', 'cash out {amount} (for |on )?{note}'], slots: ['amount', 'note'], write: true },
      { name: 'lenders', description: 'what went to digital lenders', examples: ['what did I pay lenders this month'], patterns: ['(what|how much) (did i pay|went to) (the )?lenders( this month)?', 'lender (payments|flows)'] },
      { name: 'income', description: 'money in over a period', examples: ['what came in this month'], patterns: ['what came in (this|last) {period}', '(my )?income (this|last) {period}', 'money in (this|last) {period}'], slots: ['period'] },
    ],
    routines: [
      { name: 'money.sms_watch', cron: '*/10 * * * *', enabled: watchOn, description: 'new mobile-money and bank SMS from Messages on this Mac into the ledger', run: async (c) => {
        const at = new Date().toISOString();
        try { const r = smsWatchOnce({ money: { ingestSms }, cursorFile, ctx: c }); ctx.kv?.set('money', 'sms_watch', { at, ok: true, detail: r.summary, read: r.read }); return { summary: r.summary }; }
        catch (e) { ctx.kv?.set('money', 'sms_watch', { at, ok: false, detail: e.message, code: e.code || null }); throw e; }
      } },
      { name: 'money.daily_summary', cron: '0 20 * * *', description: 'evening spend summary (counts only in the push)', catchUpMinutes: 180, run: async () => { const d = windowSpend(1); const w = windowSpend(7); return { summary: `today ${Math.round(d.s)} ZMW (${d.n} tx); 7d ${Math.round(w.s)}`, notify: d.n ? { push: { title: 'KITT money', body: `${d.n} debits today, ${Math.round(d.s).toLocaleString('en-GB')} ZMW · 7 days ${Math.round(w.s).toLocaleString('en-GB')} ZMW`, tags: 'moneybag' } } : undefined }; } },
    ],
    ingestSms, logCash,
    async handle(intent, slots, c) {
      if (intent === 'position') return position();
      if (intent === 'spend' || intent === 'income') { const p = String(slots.period || 'week').toLowerCase(); const days = /day|today/.test(p) ? 1 : /month/.test(p) ? 30 : /year/.test(p) ? 365 : 7; const r = intent === 'spend' ? windowSpend(days) : windowIncome(days); if (!r.n) return { speak: `No ${intent === 'spend' ? 'debits' : 'credits'} recorded in the last ${plural(days, 'day')}.` }; const cats = intent === 'spend' ? byCategory(days).slice(0, 3) : []; return { speak: `${intent === 'spend' ? 'Spent' : 'Received'} about ${kw(r.s)} over ${plural(r.n, 'transaction')} in the last ${plural(days, 'day')}${cats.length ? `. Biggest categories: ${spokenList(cats.map((x) => `${x.category} ${kw(x.s)}`))}` : ''}.`, display: { total: r.s, count: r.n, categories: cats } }; }
      if (intent === 'big') { const rows = bigDebits(/week/i.test(c.norm || '') ? 7 : 1, cfg.big_debit_zmw || 500); return { speak: rows.length ? `${plural(rows.length, 'large debit')}: ${spokenList(rows.map((t) => `${kw(t.amount)} to ${t.counterparty || t.kind} from ${t.wallet}`), { max: 4 })}.` : 'No large debits recorded.', display: rows }; }
      if (intent === 'log_cash') { const amount = Number(String(slots.amount || '').replace(/[^\d.]/g, '')); if (!amount) return { speak: 'How much was it?' }; return { speak: `Log ${kw(amount)} cash for ${slots.note || 'unspecified'}?`, confirm: { summary: `log cash ${amount} ${slots.note || ''}`, action: { type: 'log_cash', amount, note: slots.note || '' } } }; }
      if (intent === 'lenders') { const r = db.prepare("SELECT COALESCE(SUM(amount + COALESCE(fee,0)),0) s, COUNT(*) n FROM money_tx WHERE direction = 'out' AND category = 'lenders' AND ts >= datetime('now', '-30 days')").get(); const inr = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM money_tx WHERE direction = 'in' AND category = 'lenders' AND ts >= datetime('now', '-30 days')").get(); return { speak: r.n ? `Lenders in the last 30 days: ${kw(r.s)} out over ${plural(r.n, 'payment')}${inr.s ? `, ${kw(inr.s)} drawn` : ''}.` : 'No lender flows recorded in the last 30 days.', display: { out: r, in: inr } }; }
      return { speak: "I didn't catch which money question that was." };
    },
    async execute(action, c) { if (action.type === 'log_cash') { logCash(action.amount, action.note, c); return { speak: `Logged ${kw(action.amount)} cash${action.note ? ` for ${action.note}` : ''}.` }; } return { speak: 'Unknown action.' }; },
    async brief({ kind }) { const b = balances(); if (!b.length) return null; if (kind === 'morning') { const y = windowSpend(1); const big = bigDebits(1, cfg.big_debit_zmw || 500); return { speak: `Money: ${position().speak.replace(/^Cash position /, 'cash position ')}${y.n ? ` Yesterday ${kw(y.s)} out.` : ''}${big.length ? ` Largest: ${kw(big[0].amount)} to ${big[0].counterparty || big[0].kind}.` : ''}` }; } const t = windowSpend(1); return t.n ? { speak: `Money today: ${kw(t.s)} out over ${plural(t.n, 'transaction')}.` } : null; },
    async view() { return { balances: balances(), spend_7d: windowSpend(7), spend_30d: windowSpend(30), income_30d: windowIncome(30), categories_30d: byCategory(30), big_7d: bigDebits(7, cfg.big_debit_zmw || 500), recent: db.prepare('SELECT id, ts, wallet, kind, direction, amount, fee, balance_after, counterparty, category, confidence FROM money_tx ORDER BY ts DESC LIMIT 50').all(), unparsed: db.prepare('SELECT count(*) n FROM money_raw WHERE parsed = 0').get().n }; },
    async health() {
      const n = db.prepare('SELECT count(*) n FROM money_tx').get().n; const raw = db.prepare('SELECT count(*) n FROM money_raw WHERE parsed = 0').get().n;
      const ledger = `${n} transactions, ${raw} unparsed messages; ${balances().length} wallet balances`;
      const f = watchOn ? feedState() : null;
      // the ledger is only as fresh as its feed: a feed that cannot read Messages makes the skill red, with the reason
      if (f && !f.ok) return { ok: false, detail: `SMS feed down since ${f.at.slice(0, 16).replace('T', ' ')} UTC: ${f.detail}. ${ledger}` };
      return { ok: true, detail: `${ledger}${f ? `; SMS feed ${f.at.slice(0, 16).replace('T', ' ')} UTC: ${f.detail}` : ''}` };
    },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); const b = balances(); const tx = db.prepare('SELECT * FROM money_tx ORDER BY ts DESC LIMIT 40').all(); const cats = byCategory(30); return `<div class="grid">${b.map((x) => `<div class="tile"><span>${esc(x.wallet)} <small>${esc(x.confidence)} · ${esc((x.as_of || '').slice(0, 10))}</small></span><b>${esc(Math.round(x.balance).toLocaleString('en-GB'))} ZMW</b></div>`).join('')}</div><h3>Spend by category, 30 days</h3><table><tr><th>Category</th><th>ZMW</th><th>#</th></tr>${cats.map((x) => `<tr><td>${esc(x.category)}</td><td>${esc(Math.round(x.s).toLocaleString('en-GB'))}</td><td>${x.n}</td></tr>`).join('')}</table><h3>Recent transactions</h3><table><tr><th>When</th><th>Wallet</th><th>Dir</th><th>ZMW</th><th>Counterparty</th><th>Category</th><th>Conf.</th></tr>${tx.map((t) => `<tr><td>${esc(t.ts.slice(0, 16))}</td><td>${esc(t.wallet)}</td><td>${esc(t.direction)}</td><td>${esc(t.amount)}</td><td>${esc(t.counterparty || '')}</td><td>${esc(t.category)}</td><td>${esc(t.confidence)}</td></tr>`).join('')}</table>`; },
    routes: [{ method: 'POST', path: '/import-csv', scope: 'admin', handler: async (c) => { const { file: name, wallet } = c.body || {}; const dir = path.join(ctx.paths.dataDir, 'imports'); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, path.basename(String(name || ''))); if (!name || path.basename(String(name)) !== String(name) || !fs.existsSync(file)) throw new Error(`file must be the name of a CSV inside ${dir}`); const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter(Boolean); let n = 0; for (const line of rows) { const [date, desc, debit, credit, balance] = line.split(','); const amt = Number(debit) || Number(credit); if (!amt) continue; insertTx({ ts: new Date(date).toISOString(), source: 'csv', provider: 'statement', wallet: wallet || 'FNB', kind: 'statement', direction: Number(debit) ? 'out' : 'in', amount: amt, balance_after: Number(balance) || null, counterparty: desc, confidence: 'EXTRACTED', raw: line }); n++; } return { imported: n }; } }],
    _internal: { parseSms, insertTx, categorise, windowSpend, balances },
  };
}
