// Transaction-message parsers for the Money Dashboard. Zambian mobile money and bank SMS formats vary by release;
// every parser is tolerant, unit-tested on representative samples, and tags its confidence. Unknown formats are kept raw.
// Negative lookbehind: a bare "K" must not be the tail of a word (e.g. the "k" in a merchant name like "Black 810000000101") -
// without it this swallowed a merchant/reference number as the amount (seen for real on an FNB "reserved for purchase @ Black ...").
const AMT = '(?<![A-Za-z])(?:ZMW|ZK|K)\\s?([\\d,]+(?:\\.\\d{1,2})?)';
const num = (s) => Number(String(s).replace(/,/g, ''));

function pick(text, res) { for (const re of res) { const m = re.exec(text); if (m) return m; } return null; }

/** MTN MoMo Zambia — payments, transfers, cash-outs, receipts, balance lines. */
export function parseMtnMomo(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const bal = pick(t, [new RegExp(`(?:new|available|current|your)?\\s*(?:bal(?:ance)?)\\s*(?:is|:)?\\s*${AMT}`, 'i')]);
  const fee = pick(t, [new RegExp(`(?:fee|charge|charges|commission)\\s*(?:of|:)?\\s*${AMT}`, 'i')]);
  const ref = pick(t, [/(?:transaction id|txn id|trans id|ref(?:erence)?(?: no)?|financial transaction id|fin\.? trans\.? id)\s*[:#]?\s*([A-Za-z0-9.-]{5,}?[A-Za-z0-9])(?=[.,;\s]|$)/i]);
  let direction = null; let amount = null; let counterparty = null; let kind = 'other';
  let m;
  if ((m = pick(t, [new RegExp(`(?:you have )?(?:received|credited with)\\s*${AMT}\\s*(?:from)?\\s*([^.]+?)(?=\\.|\\s(?:on|your|ref|trans|fee|bal)|$)`, 'i')]))) { direction = 'in'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'transfer_in'; }
  else if ((m = pick(t, [new RegExp(`(?:payment of|paid|you have paid|you paid)\\s*${AMT}\\s*(?:to|for)\\s*([^.]+?)(?=\\.|\\s(?:on|your|ref|trans|fee|bal)|$)`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'payment'; }
  else if ((m = pick(t, [new RegExp(`(?:transferred|sent|you have sent|transfer of)\\s*${AMT}\\s*(?:to)?\\s*([^.]+?)(?=\\.|\\s(?:on|your|ref|trans|fee|bal)|$)`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'transfer_out'; }
  else if ((m = pick(t, [new RegExp(`(?:withdrawn|withdrawal of|cash ?out of|you have withdrawn)\\s*${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'cash_out'; counterparty = 'agent'; }
  else if ((m = pick(t, [new RegExp(`(?:deposit of|deposited|cash ?in of)\\s*${AMT}`, 'i')]))) { direction = 'in'; amount = num(m[1]); kind = 'cash_in'; counterparty = 'agent'; }
  // "...has successfully refunded ZMW 700.00 to your mobile money account..." - money coming back from a bundle/data purchase.
  else if ((m = pick(t, [new RegExp(`refunded\\s*${AMT}\\s*to your (?:mobile money )?account`, 'i')]))) { direction = 'in'; amount = num(m[1]); kind = 'refund'; }
  else if ((m = pick(t, [new RegExp(`(?:bought|purchased|airtime|bundle)[^.]{0,30}?${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'airtime'; counterparty = 'MTN'; }
  // excludes promotional "You're eligible for ... Loan up to K100,000. Dial 115# ..." offers - a marketing text, not a disbursement.
  else if (!/eligible for/i.test(t) && (m = pick(t, [new RegExp(`(?:loan|repaid|repayment)[^.]{0,30}?${AMT}`, 'i')]))) { direction = /repa/i.test(t) ? 'out' : 'in'; amount = num(m[1]); kind = 'loan'; }
  if (amount == null && !bal) return null;
  return { provider: 'mtn_momo', wallet: 'MTN MoMo', kind, direction, amount, fee: fee ? num(fee[1]) : null, balance_after: bal ? num(bal[1]) : null, counterparty, ref: ref ? ref[1] : null, confidence: amount != null && direction ? 'EXTRACTED' : 'INFERRED' };
}

/** Airtel Money Zambia */
export function parseAirtelMoney(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const bal = pick(t, [new RegExp(`(?:bal(?:ance)?|avail(?:able)? bal(?:ance)?)\\s*(?:is|:)?\\s*${AMT}`, 'i')]);
  const fee = pick(t, [new RegExp(`(?:fee|charge|charges)\\s*(?:of|:)?\\s*${AMT}`, 'i')]);
  const ref = pick(t, [/(?:txn ?id|trans(?:action)? id|ref(?:erence)?)\s*[:#]?\s*([A-Za-z0-9.-]{5,}?[A-Za-z0-9])(?=[.,;\s]|$)/i]);
  let direction = null; let amount = null; let counterparty = null; let kind = 'other'; let m;
  if ((m = pick(t, [new RegExp(`(?:received|credited)\\s*${AMT}\\s*(?:from)?\\s*([^.]+?)(?=\\.|\\s(?:on|your|ref|txn|fee|bal)|$)`, 'i')]))) { direction = 'in'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'transfer_in'; }
  // "REVERSAL of ZMW 8000.00 is successful. Amount ZMW 8000.00 has been added to your account." / "SUCCESS. ZMW 10.00 has been
  // reversed into your account." - two different wordings for the same event; money coming back, not an "out".
  else if ((m = pick(t, [new RegExp(`reversal of\\s*${AMT}\\s*is successful`, 'i'), new RegExp(`${AMT}\\s*has been reversed into your account`, 'i')]))) { direction = 'in'; amount = num(m[1]); kind = 'reversal'; }
  // "Your account has been debited by ZMW 1285.00." - usually the clawback side of an earlier reversal.
  else if ((m = pick(t, [new RegExp(`account has been debited by\\s*${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'payment'; }
  // merchant/till payment: "Payment of ZMW 3000.00 Till Number BANKWALLET NFS SETTLEMENT ACCOUNT." - a noun ("Payment of"), not the
  // verb the next branch looks for ("paid"), so it needs its own branch or it falls through to the balance-only line below.
  else if ((m = pick(t, [new RegExp(`payment of\\s*${AMT}\\s*(?:till number\\s*)?([^.]+?)(?=\\.|\\s(?:on|your|ref|txn|fee|bal|tid)|$)`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'payment'; }
  // "Payment to AMMOBILE Account NA of ZMW 20.00 is successful." - same noun form, amount sits after "of", not after "Payment of".
  else if ((m = pick(t, [new RegExp(`payment to\\s*([^.]+?)\\s*account\\s*\\S+\\s*of\\s*${AMT}\\s*is successful`, 'i')]))) { direction = 'out'; amount = num(m[2]); counterparty = (m[1] || '').trim(); kind = 'payment'; }
  // "Money sent to ROYDAH BWALYA on 976618051. Amount ZMW 150.00." / "You have sent Money to X on PHONE.Amount K700." - the amount
  // sits in its own clause after the name+phone, outside the same-clause window the generic "sent...${AMT}" branch below looks in.
  else if ((m = pick(t, [new RegExp(`(?:you have sent money to|money sent to)\\s*([^.]+?)\\s*on\\s*\\d{6,}\\s*\\.?\\s*amount\\s*${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[2]); counterparty = (m[1] || '').trim(); kind = 'transfer_out'; }
  else if ((m = pick(t, [new RegExp(`(?:money sent to|sent|transferred|paid)\\s*(?:to)?\\s*([^.]*?)\\s*${AMT}`, 'i'), new RegExp(`(?:sent|transferred|paid)\\s*${AMT}\\s*(?:to)?\\s*([^.]+?)(?=\\.|\\s(?:on|your|ref|txn|fee|bal)|$)`, 'i')]))) {
    direction = 'out'; const a = m[1] && /^[\d,.]+$/.test(m[1]) ? m[1] : m[2]; const cp = a === m[1] ? m[2] : m[1]; amount = num(a); counterparty = String(cp || '').trim(); kind = /paid/i.test(m[0]) ? 'payment' : 'transfer_out';
  }
  // "Funds transfer to bank account is successful. Transaction Amount: ZMW 300.00."
  else if ((m = pick(t, [new RegExp(`funds transfer to bank account is successful\\.?\\s*transaction amount\\s*:?\\s*${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = 'bank account'; kind = 'transfer_out'; }
  else if ((m = pick(t, [new RegExp(`(?:withdrawn|withdrawal|cash ?out)[^.]{0,20}?${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'cash_out'; counterparty = 'agent'; }
  else if ((m = pick(t, [new RegExp(`(?:deposit|cash ?in)[^.]{0,20}?${AMT}`, 'i')]))) { direction = 'in'; amount = num(m[1]); kind = 'cash_in'; counterparty = 'agent'; }
  else if ((m = pick(t, [new RegExp(`(?:airtime|bundle|data)[^.]{0,30}?${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'airtime'; counterparty = 'Airtel'; }
  // "Your ZMW 45.00 airtime top-up is successful." - amount comes before the keyword here, unlike the generic branch above.
  else if ((m = pick(t, [new RegExp(`${AMT}\\s*airtime top-?up is successful`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'airtime'; counterparty = 'Airtel'; }
  if (amount == null && !bal) return null;
  return { provider: 'airtel_money', wallet: 'Airtel Money', kind, direction, amount, fee: fee ? num(fee[1]) : null, balance_after: bal ? num(bal[1]) : null, counterparty, ref: ref ? ref[1] : null, confidence: amount != null && direction ? 'EXTRACTED' : 'INFERRED' };
}

/** FNB Zambia inContact: "FNB :-) R/K123.45 paid to ... from a/c..*1234 ... Avail K..." */
export function parseFnb(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const acct = pick(t, [/(?:a\/c|acc(?:ount)?|card)\s*(?:no\.?)?\s*\.{0,2}\*{0,2}(\d{4})\b/i]);
  const bal = pick(t, [new RegExp(`(?:avail(?:able)?(?: bal(?:ance)?)?|bal(?:ance)?)\\s*(?:is|:)?\\s*${AMT}`, 'i')]);
  let direction = null; let amount = null; let counterparty = null; let kind = 'other'; let m;
  if ((m = pick(t, [
    // "reserved for purchase at" was literal text here, but the real messages use "@" ("...reserved for purchase @ Black ...") -
    // that mismatch sent every one of these to the fallback branch below, which scavenged a merchant reference as the amount.
    new RegExp(`${AMT}\\s*(?:paid to|sent to|transferred to|debited|withdrawn at|reserved for purchase (?:at|@)|paid at)\\s*([^.]+?)(?=\\.|\\s(?:from|avail|ref)|$)`, 'i'),
    // "ZK400.00 paid from Fusion a/c..315708 @ Smartapp." / "ZK1000.00 withdrawn from Fusion a/c..315708 @ 09815058 ATM." -
    // the real payee/location is after the @, not the account before it.
    new RegExp(`${AMT}\\s*(?:paid|withdrawn) from\\s*.*?@\\s*([^.]+?)(?=\\.|\\s(?:avail|ref)|$)`, 'i'),
  ]))) { direction = 'out'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = /withdrawn/i.test(m[0]) ? 'cash_out' : 'payment'; }
  else if ((m = pick(t, [new RegExp(`${AMT}\\s*(?:paid into|received into|credited to|deposited into|received from)\\s*([^.]+?)(?=\\.|\\s(?:avail|ref)|$)`, 'i')]))) { direction = 'in'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'transfer_in'; }
  else if ((m = pick(t, [new RegExp(`(?:paid|debit|debited|purchase)[^.]{0,20}?${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'payment'; }
  else if ((m = pick(t, [new RegExp(`(?:credit|credited|received)[^.]{0,20}?${AMT}`, 'i')]))) { direction = 'in'; amount = num(m[1]); kind = 'transfer_in'; }
  if (amount == null && !bal) return null;
  return { provider: 'fnb', wallet: `FNB ${acct ? '*' + acct[1] : ''}`.trim(), kind, direction, amount, fee: null, balance_after: bal ? num(bal[1]) : null, counterparty, ref: null, confidence: amount != null && direction ? 'EXTRACTED' : 'INFERRED' };
}

/** Stanbic Bank Zambia alerts */
export function parseStanbic(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const acct = pick(t, [/(?:a\/c|acc(?:ount)?)\s*(?:no\.?)?\s*[^\d]{0,3}(\d{4})\b/i]);
  const bal = pick(t, [new RegExp(`(?:avail(?:able)?(?: bal(?:ance)?)?|bal(?:ance)?)\\s*(?:is|:)?\\s*${AMT}`, 'i')]);
  let direction = null; let amount = null; let kind = 'other'; let counterparty = null; let m;
  // "ZMW 940.00 has been reserved from Acc: XX4239 for purchase via POS BONANZA 100000 on 09/02/24 ..." - a card hold, unhandled
  // before this: fell through with no amount/direction even though the Bal: line meant it still got kept as a row.
  if ((m = pick(t, [new RegExp(`${AMT}\\s*has been reserved from\\s*(?:acc\\.?:?|account)[^.]*?for purchase via pos\\s*([^.]+?)(?=\\s+on\\s+\\d|\\.|$)`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = 'payment'; counterparty = (m[2] || '').trim(); }
  else if ((m = pick(t, [new RegExp(`(?:debited|debit of|withdrawal of|payment of)\\s*(?:with|by)?\\s*${AMT}`, 'i')]))) { direction = 'out'; amount = num(m[1]); kind = /loan|instal|repay/i.test(t) ? 'loan' : 'payment'; }
  else if ((m = pick(t, [new RegExp(`(?:credited|credit of|deposit of)\\s*(?:with|by)?\\s*${AMT}`, 'i')]))) { direction = 'in'; amount = num(m[1]); kind = 'transfer_in'; }
  if (amount == null && !bal) return null;
  return { provider: 'stanbic', wallet: `Stanbic ${acct ? '*' + acct[1] : ''}`.trim(), kind, direction, amount, fee: null, balance_after: bal ? num(bal[1]) : null, counterparty, ref: null, confidence: amount != null && direction ? 'EXTRACTED' : 'INFERRED' };
}

const SENDERS = [
  { re: /mtn|momo|mobilemoney|mobile money/i, fn: parseMtnMomo },
  { re: /airtel/i, fn: parseAirtelMoney },
  { re: /fnb|first national/i, fn: parseFnb },
  { re: /stanbic|standard bank/i, fn: parseStanbic },
];

/** Route by sender id first, then by body hints. Returns null when nothing money-like is found. */
export function parseSms({ sender = '', body = '' }) {
  const s = String(sender || '');
  for (const { re, fn } of SENDERS) if (re.test(s)) return fn(body);
  const b = String(body || '');
  if (/momo|mtn/i.test(b)) return parseMtnMomo(b);
  if (/airtel/i.test(b)) return parseAirtelMoney(b);
  if (/fnb/i.test(b)) return parseFnb(b);
  if (/stanbic/i.test(b)) return parseStanbic(b);
  // unknown sender (the iPhone automation only forwards the text): accept the first parser that finds an amount AND a direction
  for (const fn of [parseAirtelMoney, parseMtnMomo, parseFnb, parseStanbic]) { const r = fn(b); if (r && r.amount != null && r.direction) return { ...r, confidence: 'INFERRED' }; }
  return null;
}
