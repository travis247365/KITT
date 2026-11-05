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
