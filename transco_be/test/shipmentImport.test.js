// Shipment sheet reader (no database needed): node --test test/shipmentImport.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseShipmentSheet, toIsoDate, money } = require('../shipmentImport');

const csv = (rows) => Buffer.from(rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
const HEADER = ['', 'Door Delivery Destination', 'Sender Name', 'Address', 'Mob', 'Email', 'Receiver Name', 'NIC', 'PASSPORT NUMBER', 'Address', 'Mob', 'E mail', 'TC [1]', 'GB [2]', 'OB [3]', 'WB', '1/4\nCBM\n[4]', '1/2 CBM', '1 CBM', 'Total CBM', 'Total Boxes', 'MEMO', 'CASH', 'ZELLER', 'EFTPOS', 'DD / BANK TRANS ', 'OTHER CHARGES [8]', 'INCOME', 'TC COST [9]', 'OB COST', 'GB COST', 'WB COST', 'OTHER COST', 'SYD COLLECT', 'D2D Z1', 'D2D Z2', 'D2D Z3', 'EXPENSE', 'GROSS PROFIT', 'WhatsApp Link'];
const blank = () => HEADER.map(() => '');
const row = (vals) => { const r = blank(); for (const [i, v] of Object.entries(vals)) r[i] = v; return r; };

test('dates and money in the formats the sheets use', () => {
  assert.equal(toIsoDate('2026-06-13'), '2026-06-13');
  assert.equal(toIsoDate('7/13/26'), '2026-07-13');
  assert.equal(toIsoDate('13/07/2026'), '2026-07-13');
  assert.equal(toIsoDate(''), null);
  assert.equal(money('$1,110'), 1110);
  assert.equal(money('-$406.00'), -406);
  assert.equal(money('$270 [17]'), 270);
  assert.equal(money(''), 0);
});

test('reads totals, pairs each customer row with its HBL row, and finds the shipment number in the file name', () => {
  const p = parseShipmentSheet(csv([
    HEADER,
    row({ 1: '1', 12: '4', 13: '1', 19: '0.54', 20: '5', 23: '$275', 27: '$275.00', 37: '$100', 38: '$175' }),
    blank(),
    row({ 0: '6/13/26', 1: 'Kandy', 2: 'Test Sender', 3: '1 Main St', 4: '0412 345 678', 5: 'S@Example.com', 6: 'Test Receiver', 7: '123456789V', 9: 'Colombo', 10: '0771234567', 12: '3', 19: '0.36', 20: '3', 21: '3TC', 23: '$150', 28: '$75' }),
    blank(),
    row({ 0: '203105', 27: '$150.00', 37: '$75.00', 38: '$75.00', 39: 'Send WhatsApp' }),
    row({ 0: '6/14/26', 2: 'Second Sender', 4: '61400000001', 6: 'R2', 8: 'N1234567', 12: '1', 13: '1', 20: '2', 25: '$125 [17]' }),
    row({ 0: '203106', 27: '$125', 37: '$25', 38: '$100' }),
    row({ 27: '-$406.00 [18]' }),
  ]), 'TRANSCO DASHBOARD 2026 - Shipment#56.csv');

  assert.equal(p.batchNumber, 56);
  assert.equal(p.totals.tc, 4);
  assert.equal(p.totals.zeller, 275);
  assert.equal(p.records.length, 2);
  const [a, b] = p.records;
  assert.equal(a.hbl, '203105');
  assert.equal(a.date, '2026-06-13');
  assert.equal(a.ddDestination, 'Kandy');
  assert.equal(a.sender.email, 's@example.com');
  assert.equal(a.receiver.nic, '123456789V');
  assert.deepEqual(a.boxes, { tc: 3 });
  assert.deepEqual(a.payments, { zeller: 150 });
  assert.deepEqual(a.costs, { tcCost: 75 });
  assert.equal(a.income, 150);
  assert.equal(a.grossProfit, 75);
  assert.equal(b.hbl, '203106');
  assert.equal(b.receiver.passport, 'N1234567');
  assert.deepEqual(b.payments, { bank: 125 });
});

test('a sheet without a "Sender Name" header is rejected with a clear message', () => {
  assert.throws(() => parseShipmentSheet(csv([['SENDERS NAME', 'SENDERS NUMBER'], ['A', '0412345678']]), 'customers.csv'), /no "Sender Name" column/);
});
