// Transaction-message parsers for the Money Dashboard. Zambian mobile money and bank SMS formats vary by release;
// every parser is tolerant, unit-tested on representative samples, and tags its confidence. Unknown formats are kept raw.
// Negative lookbehind: a bare "K" must not be the tail of a word (e.g. the "k" in a merchant name like "Black 810000000101") -
// without it this swallowed a merchant/reference number as the amount (seen for real on an FNB "reserved for purchase @ Black ...").
const AMT = '(?<![A-Za-z])(?:ZMW|ZK|K)\\s?([\\d,]+(?:\\.\\d{1,2})?)';
const num = (s) => Number(String(s).replace(/,/g, ''));
// Newer MTN and Airtel messages put the currency after the amount ("You have transferred 150 ZMW to ..."); every pattern here
// reads "ZMW 150", so the MTN and Airtel parsers first turn "150 ZMW" into "ZMW 150". An amount that already has the currency
// in front ("received ZMW 150 ZMW from ...", an older MTN wording) is left alone. Checked against the 10,052-message backfill:
// no message that parsed before changes amount, direction or reference (so no ledger id changes); some gain the balance.
const currencyFirst = (t) => t.replace(/(?<![\w.,])(?<!(?:ZMW|ZK|K)\s?)(\d[\d,]*(?:\.\d{1,2})?)\s?ZMW\b/gi, 'ZMW $1');
// A message about a transaction that did not happen (failed, refused, only initiated, a scheduled order) is not a transaction.
const NOT_DONE = /\b(?:failed|unsuccessful|cannot be completed|insufficient funds|is initiated|will be debited|scheduled payment)\b/i;
const tidyName = (s) => String(s || '').replace(/\s*\(\s*\+?\d[\d\s]*\)\s*$/, '').replace(/\s+in(?: ref(?:erence)? to)?$/i, '').replace(/[\s.]+$/, '').trim();

function pick(text, res) { for (const re of res) { const m = re.exec(text); if (m) return m; } return null; }

/** MTN MoMo Zambia — payments, transfers, cash-outs, receipts, balance lines. */
export function parseMtnMomo(text) {
  const t = currencyFirst(String(text).replace(/\s+/g, ' ').trim());
  if (NOT_DONE.test(t)) return null;
  // airtime someone sent to this number arrives as airtime, not as money in the wallet; a loan application or a loan being
  // closed is a status notice (the money itself moves in its own message)
  if (/received airtime|loan application|loan\s+with id/i.test(t)) return null;
  // Second messages about a payment that is counted from another message: "You have paid ZMW 85. ... Merchant Code: 123" always
  // comes with "Your payment of 85 ZMW to <payee> has been completed" (7 of 7 in the backfill), and a voucher's "has been
  // deducted , Voucher is created" / "has been redeemed" come with "A voucher ... has been created".
  if (/you have paid\s*ZMW\s?[\d,.]+\s*\..*merchant code/i.test(t) || /voucher is created|voucher .* has been redeemed/i.test(t)) return null;
  const bal = pick(t, [new RegExp(`(?:new|available|current|your)?\\s*(?:bal(?:ance)?)\\s*(?:is(?: now)?|:)?\\s*${AMT}`, 'i')]);
  const fee = pick(t, [new RegExp(`(?:fee|charge|charges|commission)\\s*(?:of|was|:)?\\s*${AMT}`, 'i')]);
  const ref = pick(t, [/(?:transaction id|txn id|trans id|ref(?:erence)?(?: no)?|financial transaction id|fin\.? trans\.? id)\s*[:#]?\s*([A-Za-z0-9.-]{5,}?[A-Za-z0-9])(?=[.,;\s]|$)/i]);
  let direction = null; let amount = null; let counterparty = null; let kind = 'other';
  let m;
  // "You have transferred 150 ZMW to SAMPLE NAME (PHONE) from your mobile money account ... at 2025-03-02 10:11:12."
  if ((m = pick(t, [new RegExp(`you have transferred\\s*${AMT}\\s*to\\s*(.+?)\\s*from your mobile money account`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = tidyName(m[2]); kind = 'transfer_out'; }
  // "Your payment of 120 ZMW to SAMPLE LODGE has been completed at 2025-...". Fee: "Fee was 2 ZMW".
  else if ((m = pick(t, [new RegExp(`your payment of\\s*${AMT}\\s*to\\s*(.+?)\\s*has been completed`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = tidyName(m[2]); kind = 'payment'; }
  // "A voucher 123 of 200 ZMW has been created. A fee of 4 ZMW was charged". The same voucher also arrives as "ZMW 200 has been
  // deducted , Voucher is created." (dropped above), and its redemption later; only the creation is counted.
  else if ((m = pick(t, [new RegExp(`voucher\\s*\\S*\\s*of\\s*${AMT}\\s*has been created`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = 'voucher'; kind = 'transfer_out'; }
  else if ((m = pick(t, [new RegExp(`(?:you have )?(?:received|credited with)\\s*${AMT}\\s*(?:from)?\\s*([^.]+?)(?=\\.|\\s(?:on|your|ref|trans|fee|bal)|$)`, 'i')]))) { direction = 'in'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'transfer_in'; }
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
  const out = { provider: 'mtn_momo', wallet: 'MTN MoMo', kind, direction, amount, fee: fee ? num(fee[1]) : null, balance_after: bal ? num(bal[1]) : null, counterparty, ref: ref ? ref[1] : null, confidence: amount != null && direction ? 'EXTRACTED' : 'INFERRED' };
  // One merchant payment can be confirmed twice, in two wordings ("Your payment of 85 ZMW to X has been completed" and "Your
  // Payment of K 85 to (X) has Successfully Completed", 22 pairs in the backfill). The ledger keeps the first: see insertTx.
  if (kind === 'payment' && /has (?:been|successfully) completed/i.test(t)) out.dedupe_s = 180;
  return out;
}

/** Airtel Money Zambia */
export function parseAirtelMoney(text) {
  const t = currencyFirst(String(text).replace(/\s+/g, ' ').trim());
  if (NOT_DONE.test(t)) return null;
  // money sent to this number as a cash pick-up ("... Your PIN is 1234. Visit any Airtel money agent within 7 days") is not in the wallet
  if (/visit any airtel money agent within/i.test(t)) return null;
  const bal = pick(t, [new RegExp(`(?:bal(?:ance)?|avail(?:able)? bal(?:ance)?)\\s*(?:is|:)?\\s*${AMT}`, 'i')]);
  const fee = pick(t, [new RegExp(`(?:fee|charge|charges)\\s*(?:of|:)?\\s*${AMT}`, 'i')]);
  const ref = pick(t, [/(?:txn ?id|trans(?:action)? id|ref(?:erence)?)\s*[:#]?\s*([A-Za-z0-9.-]{5,}?[A-Za-z0-9])(?=[.,;\s]|$)/i]);
  let direction = null; let amount = null; let counterparty = null; let kind = 'other'; let m;
  // prepaid electricity "ZESCO Token 1234-... Units: KWh 85.3 Meter: ... Amount: K200 TrxID: MP250101.1200.A12345." is the token
  // for a payment counted from its own message ("Payment of ZMW 200 to ZESCO ZESCO, Till Number ...", same TrxID, 35 of 35).
  if (/^\S+\s+token\s+[\d\s-]+units:/i.test(t)) return null;
  // "Dear customer you have been credited with a NaSova loan of 500 ZMW from SAMPLE LENDER. New balance 520 ZMW."
  if ((m = pick(t, [new RegExp(`credited with an? (.+?) loan of\\s*${AMT}`, 'i')]))) { direction = 'in'; amount = num(m[2]); counterparty = `${m[1]} loan`; kind = 'loan'; }
  // "You have repaid 300 ZMW towards your NASOVA loan. Your new available balance is 20 ZMW."
  else if ((m = pick(t, [new RegExp(`you have repaid\\s*${AMT}\\s*towards your (.+?) loan`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = `${m[2]} loan`; kind = 'loan'; }
  // "5 ZMW received from SAMPLE in ref to your loyalty to Airtel Money. Bal is 20 ZMW" - amount first, then "received from"
  else if ((m = pick(t, [new RegExp(`${AMT}\\s*received from\\s*(.+?)(?=\\s+in ref|\\.|,|$)`, 'i')]))) { direction = 'in'; amount = num(m[1]); counterparty = tidyName(m[2]); kind = 'transfer_in'; }
  else if ((m = pick(t, [new RegExp(`(?:received|credited)\\s*${AMT}\\s*(?:from)?\\s*([^.]+?)(?=\\.|\\s(?:on|your|ref|txn|fee|bal)|$)`, 'i')]))) { direction = 'in'; amount = num(m[1]); counterparty = tidyName(m[2]); kind = 'transfer_in'; }
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
  // "FNB:-) REVERSAL of ZK250.00 for goods purchased from Fusion a/c..315708. 5Oct 10:12" - a card hold ("reserved for purchase",
  // logged as out) released again: the money is back, so it is an in.
  if ((m = pick(t, [new RegExp(`reversal of\\s*${AMT}\\s*for goods purchased`, 'i')]))) { direction = 'in'; amount = num(m[1]); counterparty = 'card purchase reversed'; kind = 'reversal'; }
  // "FNB :-) Transaction successful. Purchased K20 MTN Zambia airtime for 097 000 0000 from Fusion. Ref ..." (read as MTN before 0.3.3)
  else if ((m = pick(t, [new RegExp(`purchased\\s*${AMT}\\s*(.+?)\\s+airtime`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = `${m[2]} airtime`; kind = 'airtime'; }
  // "FNB :-) ZMW 120.00 Approved for Purchase at SAMPLE SHOP using 4000******1234, Ref: ..."
  else if ((m = pick(t, [new RegExp(`${AMT}\\s*approved for purchase at\\s*(.+?)(?=\\s+using|,|\\.\\s|$)`, 'i')]))) { direction = 'out'; amount = num(m[1]); counterparty = (m[2] || '').trim(); kind = 'payment'; }
  else if ((m = pick(t, [
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
  // "A loan recovery transaction for ZMW 4,500.00, AccNr XX4239 has been completed 12/05/25 10:00:00." - the bank taking a loan
  // instalment from the account; the account number sits after "AccNr XX", which the account pattern above does not read.
  if ((m = pick(t, [new RegExp(`loan recovery transaction for\\s*${AMT}`, 'i')]))) {
    const nr = /accnr\s*x*(\d{4})\b/i.exec(t);
    return { provider: 'stanbic', wallet: `Stanbic ${nr ? '*' + nr[1] : (acct ? '*' + acct[1] : '')}`.trim(), kind: 'loan', direction: 'out', amount: num(m[1]), fee: null, balance_after: bal ? num(bal[1]) : null, counterparty: 'Stanbic loan recovery', ref: null, confidence: 'EXTRACTED' };
  }
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
  // FNB alerts start with "FNB" and can name MTN as the merchant ("reserved for purchase @ Mtn"): read that before the MTN hint
  if (/^\s*FNB\b/i.test(b)) return parseFnb(b);
  if (/momo|mtn/i.test(b)) return parseMtnMomo(b);
  if (/airtel/i.test(b)) return parseAirtelMoney(b);
  if (/fnb/i.test(b)) return parseFnb(b);
  if (/stanbic/i.test(b)) return parseStanbic(b);
  // unknown sender (the iPhone automation only forwards the text): accept the first parser that finds an amount AND a direction
  for (const fn of [parseAirtelMoney, parseMtnMomo, parseFnb, parseStanbic]) { const r = fn(b); if (r && r.amount != null && r.direction) return { ...r, confidence: 'INFERRED' }; }
  return null;
}
