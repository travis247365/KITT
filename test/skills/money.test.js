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
