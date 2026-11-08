import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSms } from '../../src/skills/money/parsers.js';
import { categorise } from '../../src/skills/money/index.js';

test('MTN MoMo samples', () => {
  const a = parseSms({ sender: 'MTNMoMo', body: 'Payment of K150.00 to ZESCO LIMITED Ref 12345 was successful. Fee K2.50. Your new balance is K1,234.56. Transaction ID 98765432.' });
  assert.equal(a.provider, 'mtn_momo'); assert.equal(a.direction, 'out'); assert.equal(a.amount, 150); assert.equal(a.fee, 2.5); assert.equal(a.balance_after, 1234.56); assert.match(a.counterparty, /ZESCO/); assert.equal(a.confidence, 'EXTRACTED');
  const b = parseSms({ sender: 'MobileMoney', body: 'You have received K2,000.00 from JOHN DOE 0970000001. Your new balance is K3,234.56. Financial Transaction Id: 11223344.' });
  assert.equal(b.direction, 'in'); assert.equal(b.amount, 2000); assert.match(b.counterparty, /JOHN DOE/); assert.equal(b.ref, '11223344');
  const c = parseSms({ sender: 'MTN', body: 'You have withdrawn K500.00 from agent MARKET SHOP. Fee K12.00. Your new balance is K734.56.' });
  assert.equal(c.kind, 'cash_out'); assert.equal(c.amount, 500); assert.equal(c.fee, 12);
});

test('Airtel Money, FNB and Stanbic samples', () => {
  const a = parseSms({ sender: 'AirtelMoney', body: 'Trans ID: PP240731.1412.A12345. Money Sent to Jane Mwila K1,000.00. Fee K0.00. Bal K250.00' });
  assert.equal(a.provider, 'airtel_money'); assert.equal(a.direction, 'out'); assert.equal(a.amount, 1000); assert.equal(a.balance_after, 250); assert.match(a.counterparty, /Jane Mwila/);
  const d = parseSms({ sender: 'AirtelMoney', body: 'Payment of ZMW 450.00 Till Number SAMPLE MERCHANT LTD. Airtel Money bal is ZMW 84.93. TID : MP240731.1412.A99999.' });
  assert.equal(d.direction, 'out'); assert.equal(d.amount, 450); assert.equal(d.kind, 'payment'); assert.match(d.counterparty, /SAMPLE MERCHANT/); assert.equal(d.balance_after, 84.93);
  const b = parseSms({ sender: 'FNB', body: 'FNB :-) K1,200.00 paid to SHOPRITE from a/c..*0001 using card..*0002 on 26Oct. Avail K9,999.99' });
  assert.equal(b.provider, 'fnb'); assert.equal(b.direction, 'out'); assert.equal(b.amount, 1200); assert.match(b.counterparty, /SHOPRITE/); assert.equal(b.balance_after, 9999.99); assert.equal(b.wallet, 'FNB *0001');
  const c = parseSms({ sender: 'Stanbic', body: 'Dear Customer, your account ****0003 has been debited with ZMW 5,000.00 for loan instalment on 26/10/2026. Available balance ZMW 2,000.00' });
  assert.equal(c.provider, 'stanbic'); assert.equal(c.direction, 'out'); assert.equal(c.amount, 5000); assert.equal(c.kind, 'loan'); assert.equal(c.balance_after, 2000);
  assert.equal(parseSms({ sender: 'Mom', body: 'see you at 6' }), null);
  assert.equal(categorise({ counterparty: 'TOTAL STATION', direction: 'out' }), 'fuel');
  assert.equal(categorise({ counterparty: 'LOANCO', direction: 'out' }), 'lenders');
  assert.equal(categorise({ counterparty: 'EMPLOYER LIMITED', direction: 'in' }), 'income');
});

test('MTN MoMo promotional loan offer is not logged as a transaction', () => {
  const d = parseSms({ sender: 'MTN', body: "Yello! You're eligible for MTN Salary Base Loan up to K100,000. Dial 115#, choose 6 > 5 and access your loan instantly today!" });
  assert.equal(d, null);
});

test('Airtel Money: sent-with-separate-amount-clause, payment-to-account, bank transfer, reversal, amount-first airtime', () => {
  const a = parseSms({ sender: 'AirtelMoney', body: 'Money sent to SAMPLE RECEIVER on 976000111. Amount ZMW 150.00. Your balance is ZMW 373.95. Txn. ID: PP231007.1034.H09137. To reverse dial *115#, option 1, then 5.' });
  assert.equal(a.direction, 'out'); assert.equal(a.amount, 150); assert.match(a.counterparty, /SAMPLE RECEIVER/); assert.equal(a.kind, 'transfer_out');
  const b = parseSms({ sender: 'AirtelMoney', body: 'You have sent Money to SAMPLE PERSON on 0965000222.Amount K700. Txn. ID : MP231125.1812.H51887.Your available balance is K19.13' });
  assert.equal(b.direction, 'out'); assert.equal(b.amount, 700); assert.match(b.counterparty, /SAMPLE PERSON/);
  const c = parseSms({ sender: 'AirtelMoney', body: 'Payment to SAMPLE MERCHANT Account NA of ZMW 20.00 is successful. Your Airtel Money balance is ZMW 24.12' });
  assert.equal(c.direction, 'out'); assert.equal(c.amount, 20); assert.match(c.counterparty, /SAMPLE MERCHANT/); assert.equal(c.kind, 'payment');
  const e = parseSms({ sender: 'AirtelMoney', body: 'Txn ID: WB231112.0725.J00936. Funds transfer to bank account is successful. Transaction Amount: ZMW 300.00. Your available balance is ZMW 1009.23' });
  assert.equal(e.direction, 'out'); assert.equal(e.amount, 300); assert.equal(e.kind, 'transfer_out');
  const f = parseSms({ sender: 'AirtelMoney', body: 'REVERSAL of ZMW 8000.00 is successful. Amount ZMW 8000.00 has been added to your account. New balance ZMW 8150.40. Txn. ID: WB240217.0748.H01919' });
  assert.equal(f.direction, 'in'); assert.equal(f.amount, 8000); assert.equal(f.kind, 'reversal');
  const g = parseSms({ sender: 'AirtelMoney', body: 'Your ZMW 45.00 airtime top-up is successful. Your new Airtel Money balance is ZMW 1.50.Txn ID : RC240216.0003.J91610' });
  assert.equal(g.direction, 'out'); assert.equal(g.amount, 45); assert.equal(g.kind, 'airtime');
});

test('FNB: reserved-for-purchase uses @ not literal "at", and does not scavenge a merchant reference number as the amount', () => {
  const a = parseSms({ sender: 'FNB', body: 'FNB:-) ZK2500.00 reserved for purchase @ Black 810000000101 from Fusion a/c..315708 using card..2155. Avail ZK288.  5Oct 00:16' });
  assert.equal(a.direction, 'out'); assert.equal(a.amount, 2500);
  const b = parseSms({ sender: 'FNB', body: 'FNB:-) ZK145.00 reserved for purchase @ Shakwa Distribut0048 from Fusion a/c..315708 using card..6674. Avail ZK1223.' });
  assert.equal(b.direction, 'out'); assert.equal(b.amount, 145);
  const c = parseSms({ sender: 'FNB', body: 'FNB:-) ZK400.00 paid from Fusion a/c..315708 @ Smartapp. Avail ZK31. Ref.Tpm. 12May 14:50' });
  assert.equal(c.direction, 'out'); assert.equal(c.amount, 400); assert.match(c.counterparty, /Smartapp/);
});

test('Stanbic: POS card-hold reservation is logged as a real out transaction', () => {
  const a = parseSms({ sender: 'Stanbic', body: 'ZMW 940.00 has been reserved from Acc: XX4239 for purchase via POS SAMPLE STORE on 09/02/24 17:49:06. Bal: ZMW 466.27. Helpline: 260 971 288 200' });
  assert.equal(a.direction, 'out'); assert.equal(a.amount, 940); assert.match(a.counterparty, /SAMPLE STORE/); assert.equal(a.balance_after, 466.27);
});

test('FNB: ATM withdrawal word order ("withdrawn from account @ location")', () => {
  const a = parseSms({ sender: 'FNB', body: 'FNB:-) ZK1000.00 withdrawn from Fusion a/c..315708 @ 09815058 ATM. Avail ZK3014. 10Oct 16:24' });
  assert.equal(a.direction, 'out'); assert.equal(a.amount, 1000); assert.equal(a.kind, 'cash_out'); assert.match(a.counterparty, /ATM/);
});

test('Airtel Money: second reversal wording, and a bank-initiated debit', () => {
  const a = parseSms({ sender: 'AirtelMoney', body: 'SUCCESS. ZMW 10.00 has been reversed into your account. BAL ZMW 914.55. TXN ID:MP250522.1547.C05534' });
  assert.equal(a.direction, 'in'); assert.equal(a.amount, 10); assert.equal(a.kind, 'reversal');
  const b = parseSms({ sender: 'AirtelMoney', body: 'Your account has been debited by ZMW 1285.00. Wed Oct 08 13:30:05 CAT 2025. Reason: MP250901.1948.O83992. Bal: ZMW 414.06.' });
  assert.equal(b.direction, 'out'); assert.equal(b.amount, 1285);
});

test('MTN MoMo: a bundle/data refund is a real credit', () => {
  const a = parseSms({ sender: 'MTN', body: "Y'ello. Mobile Money Data Bundle (cis.sp) has successfully refunded ZMW 700.00 to your mobile money account at 2025-11-03 23:08:51. Your new balance:ZMW 3415.37." });
  assert.equal(a.direction, 'in'); assert.equal(a.amount, 700); assert.equal(a.kind, 'refund');
});

test('MTN MoMo: amount-before-currency wording (0.3.3)', () => {
  const a = parseSms({ sender: 'MoMo', body: 'You have transferred 150 ZMW to SAMPLE PERSON (100200300) from your mobile money account 100200400 at 2025-03-02 10:11:12. Your new balance: 1,234.50 ZMW. Message from sender: Taxi. Message to receiver: Taxi. Financial Transaction Id: 12345678901.' });
  assert.equal(a.direction, 'out'); assert.equal(a.amount, 150); assert.equal(a.kind, 'transfer_out'); assert.equal(a.counterparty, 'SAMPLE PERSON'); assert.equal(a.balance_after, 1234.5); assert.equal(a.ref, '12345678901');
  const b = parseSms({ sender: 'MoMo', body: 'Your payment of 120 ZMW to SAMPLE LODGE (100200) has been completed at 2025-04-01 09:00:00. Your new balance: 80 ZMW. Fee was 2 ZMW. Financial Transaction Id: 22334455667.' });
  assert.equal(b.direction, 'out'); assert.equal(b.amount, 120); assert.equal(b.kind, 'payment'); assert.equal(b.counterparty, 'SAMPLE LODGE'); assert.equal(b.fee, 2); assert.equal(b.dedupe_s, 180);
  const c = parseSms({ sender: 'MoMo', body: 'You have withdrawn 500 ZMW from your mobile money account at SAMPLE SHOP on 2025-05-01 12:00:00. Your new balance:20 ZMW. Financial Transaction Id: 33445566778.' });
  assert.equal(c.kind, 'cash_out'); assert.equal(c.amount, 500); assert.equal(c.balance_after, 20);
  const d = parseSms({ sender: 'MoMo', body: "Y'ello. A voucher 123456 of 200 ZMW has been created. A fee of 4 ZMW was charged and your new balance is 96 ZMW." });
  assert.equal(d.direction, 'out'); assert.equal(d.amount, 200); assert.equal(d.fee, 4);
  // the older wording with the currency on both sides keeps its old reading (no ledger id may change)
  const e = parseSms({ sender: 'MoMo', body: "Y'ello. You have received ZMW 300 ZMW from SAMPLE SENDER at 2024-01-01 08:00:00. Your balance is 310 ZMW. Thank you for using MTN Mobile Money." });
  assert.equal(e.direction, 'in'); assert.equal(e.amount, 300); assert.equal(e.balance_after, 310);
});

test('MTN MoMo: failed payments, second confirmations and notices are not transactions (0.3.3)', () => {
  assert.equal(parseSms({ sender: 'MoMo', body: "Y'ello. Payment of ZMW 100 to SAMPLE NFS failed at 2025-01-01 10:00:00. Message: - Card Issuer or Switch Inoperative. Financial Transaction ID: 123456789." }), null);
  assert.equal(parseSms({ sender: 'MoMo', body: "Y'ello, the transaction with amount 50 ZMW for SAMPLE MERCHANT (12345) with message: x failed at 2025-01-01 10:00:00 . Please check your balance." }), null);
  assert.equal(parseSms({ sender: 'MoMo', body: "Y'ello, You have paid ZMW 85. Your Mobile Money account balance is now ZMW 20. Reference: Goods. Time: 2025-01-01 10:00. Fee ZMW 1 to Merchant Code: 123456. Transaction ID 998877." }), null);
  assert.equal(parseSms({ sender: 'MoMo', body: 'Yello. ZMW 200 has been deducted , Voucher is created. Token ID: 123.Remember to send Token ID and secret code to the receiver. Your current balance is 96 ZMW.' }), null);
  assert.equal(parseSms({ sender: 'MoMo', body: "Y'ello.You have received airtime Amount: 10 ZMW from 100200300." }), null);
  assert.equal(parseSms({ sender: 'MoMo', body: 'Your loan  with id 12345 of 500 ZMW has been closed.' }), null);
});

test('Airtel Money: loans in and out, loyalty credits; tokens, pick-ups and refusals are not counted (0.3.3)', () => {
  const a = parseSms({ sender: 'AirtelMoney', body: 'Dear customer you have been credited with a NaSova loan of 500 ZMW from SAMPLE LENDER. New balance 520 ZMW. Txn. Id: LN250101.1200.A12345' });
  assert.equal(a.direction, 'in'); assert.equal(a.amount, 500); assert.equal(a.kind, 'loan'); assert.equal(a.balance_after, 520); assert.equal(categorise(a), 'lenders');
  const b = parseSms({ sender: 'AirtelMoney', body: 'You have repaid  300 ZMW towards your NASOVA loan. Your new available balance is 20 ZMW. Txn ID.LR250101.1200.B12345' });
  assert.equal(b.direction, 'out'); assert.equal(b.amount, 300); assert.equal(b.kind, 'loan'); assert.equal(categorise(b), 'lenders');
  const c = parseSms({ sender: 'AirtelMoney', body: '5 ZMW received from SAMPLE PROMO in ref to your loyalty to Airtel Money. Bal is 25 ZMW, Remarks : your loyalty to Airtel Money.TID:ER250101.1200.C12345.' });
  assert.equal(c.direction, 'in'); assert.equal(c.amount, 5); assert.equal(c.counterparty, 'SAMPLE PROMO'); assert.equal(c.balance_after, 25);
  const d = parseSms({ sender: 'AirtelMoney', body: 'Txn Id:ER250101.1200.D12345, You have received 5 ZMW from SAMPLE PROMO in reference to your loyalty to Airtel Money. Your available balance is 25 ZMW' });
  assert.equal(d.direction, 'in'); assert.equal(d.amount, 5); assert.equal(d.counterparty, 'SAMPLE PROMO');
  assert.equal(parseSms({ sender: 'AirtelMoney', body: 'ZESCO Token 1234-5678-9012-3456-7890 Units: KWh 85.3 Meter: 04000000000 Amount: K200 TrxID: MP250101.1200.E12345.' }), null);
  assert.equal(parseSms({ sender: 'AirtelMoney', body: 'You have received 100 ZMW from 100200500.Your PIN is 1234. Visit any Airtel money agent within 7 days.Txn ID: GO250101.1200.F12345' }), null);
  assert.equal(parseSms({ sender: 'AirtelMoney', body: 'REVERSAL of ZMW 50 is initiated from your account. Amount is frozen and will be debited from your account on confirmation. Txn. ID: TC250101.1200.G12345' }), null);
  assert.equal(parseSms({ sender: 'AirtelMoney', body: 'Dear Customer, Your transaction cannot be completed Id : CO250101.1200.H12345 Dear Customer, you have insufficient funds to complete this transaction.' }), null);
});

test('FNB card-hold reversal and approved purchase; Stanbic loan recovery (0.3.3)', () => {
  const a = parseSms({ sender: '+13622', body: 'FNB:-) REVERSAL of ZK250.00 for goods purchased from Fusion a/c..123456. 5Oct 10:12' });
  assert.equal(a.provider, 'fnb'); assert.equal(a.direction, 'in'); assert.equal(a.amount, 250); assert.equal(a.kind, 'reversal');
  const b = parseSms({ sender: '+13622', body: 'FNB :-) ZMW 120.00 Approved for Purchase at SAMPLE SHOP using 400000******1234, Ref: 1a2b3c on 01-01-2025 10:00:00.' });
  assert.equal(b.direction, 'out'); assert.equal(b.amount, 120); assert.equal(b.counterparty, 'SAMPLE SHOP');
  // a transfer between the owner's own accounts is not spend: it keeps the old balance-only reading
  const c = parseSms({ sender: '+13622', body: 'FNB:-) ZK500.00 t/fer from Fusion a/c..123456 to SAMPLE SAVER AC..7890 @ Smartapp. Avail ZK100. 9Oct 10:00' });
  assert.equal(c.amount, null); assert.equal(c.balance_after, 100);
  const d = parseSms({ sender: 'Stanbic', body: 'A loan recovery transaction for ZMW 4,500.00, AccNr XX1234 has been completed 12/05/25 10:00:00.Helpline: 260 000 000 000' });
  assert.equal(d.provider, 'stanbic'); assert.equal(d.direction, 'out'); assert.equal(d.amount, 4500); assert.equal(d.kind, 'loan'); assert.equal(d.wallet, 'Stanbic *1234');
});

test('ledger: a payment confirmed twice in two wordings is kept once; a re-read message is not logged raw twice (0.3.3)', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { migrateCore, migrate } = await import('../../src/db.js');
  const define = (await import('../../src/skills/money/index.js')).default;
  const db = new DatabaseSync(':memory:'); migrateCore(db);
  const skill = define({ db, config: {}, log: { info() {}, warn() {}, error() {}, debug() {} }, paths: { dataDir: '/tmp' } }); migrate(db, skill.id, skill.migrations);
  const first = { sender: 'MoMo', body: "Y'ello, Your Payment of K 85 to (SAMPLE LENDER ) has Successfully Completed. Reason:123.A Fee of K 1 was charged. Your New Balance is 20. Thank You for using MoMo.", received_at: '2025-01-01T10:00:00Z' };
  const second = { sender: 'MoMo', body: 'Your payment of 85 ZMW to SAMPLE LENDER . has been completed at 2025-01-01 10:00:20. Your new balance: 20 ZMW. Fee was 1 ZMW. Financial Transaction Id: 55667788990.', received_at: '2025-01-01T10:00:30Z' };
  const r1 = skill.ingestSms(first, { source: 'test' }); const r2 = skill.ingestSms(second, { source: 'test' });
  assert.equal(r1.parsed, true); assert.equal(r2.parsed, true); assert.equal(r2.duplicate, true);
  assert.equal(db.prepare('SELECT count(*) n FROM money_tx').get().n, 1);
  // the same amount to the same wallet an hour later is a new payment
  skill.ingestSms({ ...second, received_at: '2025-01-01T11:00:30Z', body: second.body.replace('10:00:20', '11:00:20').replace('55667788990', '55667788991') }, { source: 'test' });
  assert.equal(db.prepare('SELECT count(*) n FROM money_tx').get().n, 2);
  // reading the same messages again (a backfill re-run) adds nothing, raw or ledger
  const raw = db.prepare('SELECT count(*) n FROM money_raw').get().n;
  skill.ingestSms(first, { source: 'test' }); skill.ingestSms(second, { source: 'test' });
  assert.equal(db.prepare('SELECT count(*) n FROM money_raw').get().n, raw);
  assert.equal(db.prepare('SELECT count(*) n FROM money_tx').get().n, 2);
});

test('FNB alert naming MTN as the merchant is read as FNB (0.3.3)', () => {
  const a = parseSms({ sender: '+13622', body: 'FNB:-) ZK100.00 reserved for purchase @ Mtn from Fusion a/c..123456 using card..1234. Avail ZK900. 9Jul 10:00' });
  assert.equal(a.provider, 'fnb'); assert.equal(a.direction, 'out'); assert.equal(a.amount, 100); assert.equal(a.balance_after, 900);
});

test('FNB airtime purchase is FNB spend on telecom, not MTN MoMo (0.3.3)', () => {
  const a = parseSms({ sender: '+13622', body: 'FNB :-) Transaction successful. Purchased K20 MTN Zambia airtime for 097 000 0000 from Fusion. Ref ABCD12XY. For queries, call 0000.' });
  assert.equal(a.provider, 'fnb'); assert.equal(a.amount, 20); assert.equal(a.kind, 'airtime'); assert.equal(categorise(a), 'telecom');
});
