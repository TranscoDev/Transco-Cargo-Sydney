// Staff upload of a "TRANSCO DASHBOARD 2026 - Shipment#NN" sheet (Excel or
// CSV) — the same ledger layout Shipment 57 and 58 were imported from.
// Creates, for every HBL on the sheet: the shipment, the sender as a
// customer (matched by phone, never duplicated), the receiver, the
// invoice and its payments, all under the shipment group ("Shipment NN").
//
// Always previewed first (commit = false writes nothing). Safe to run
// again on the same or a longer sheet: an HBL that's already in the
// system is skipped, never changed or duplicated.
//
// Sheet layout (Google Sheets export or Excel):
//   header row     "Sender Name", "Mob", "Receiver Name", "TC", ... "GROSS PROFIT"
//   totals row     the shipment's totals (boxes, payments, income/expense)
//   per HBL:       a row with the date, sender, receiver, boxes, payments
//                  and costs, then a row starting with the HBL number that
//                  holds INCOME / EXPENSE / GROSS PROFIT.

const crypto = require('crypto');
const XLSX = require('xlsx');
const { normalizePhoneNumber } = require('./normalizePhone');

const clean = v => String(v ?? '').replace(/\[\d+\]?/g, '').replace(/\s+/g, ' ').trim();
const key = v => clean(v).toLowerCase();
const money = v => {
  const s = clean(v).replace(/[$,\s]/g, '');
  if (!s || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const isHbl = v => /^\d{5,7}$/.test(clean(v));

// "2026-06-13", "7/13/26" (Google Sheets CSV), "13/07/2026" → "2026-07-13".
function toIsoDate(v) {
  const s = clean(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    // The sheets are month/day (US) unless the first part can't be a month.
    const [mo, d] = Number(a) > 12 ? [b, a] : [a, b];
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

const BOX_NAMES = { tc: 'Tea Chest', gb: 'Gift Box', ob: 'Odd Box', wb: 'Wine Box', quarterCbm: '1/4 CBM box', halfCbm: '1/2 CBM box', oneCbm: '1 CBM box' };
const PAYMENT_COLUMNS = { cash: 'cash', zeller: 'zeller', eftpos: 'eftpos', bank: 'bank_transfer' };
const COST_COLUMNS = ['tcCost', 'obCost', 'gbCost', 'wbCost', 'otherCost', 'sydCollect', 'd2dZ1', 'd2dZ2', 'd2dZ3'];

// Finds each column by its header text, so a sheet with an extra or moved
// column still reads right. "Address" / "Mob" / "Email" appear twice:
// the first set belongs to the sender, the set after "Receiver Name" to
// the receiver.
function mapColumns(header) {
  const cols = {};
  let side = null;
  header.forEach((h, i) => {
    const k = key(h);
    if (!k) return;
    const set = (name) => { if (cols[name] === undefined) cols[name] = i; };
    if (k.startsWith('door delivery')) return set('dd');
    if (k === 'sender name') { side = 'sender'; return set('senderName'); }
    if (k === 'receiver name') { side = 'receiver'; return set('receiverName'); }
    if (k === 'nic') return set('nic');
    if (k.startsWith('passport')) return set('passport');
    if (k === 'address') return side && set(`${side}Address`);
    if (k === 'mob' || k === 'mobile' || k === 'phone') return side && set(`${side}Phone`);
    if (k === 'email' || k === 'e mail' || k === 'e-mail') return side && set(`${side}Email`);
    const simple = {
      tc: 'tc', gb: 'gb', ob: 'ob', wb: 'wb', '1/4 cbm': 'quarterCbm', '1/2 cbm': 'halfCbm', '1 cbm': 'oneCbm',
      'total cbm': 'totalCbm', 'total boxes': 'totalBoxes', memo: 'memo', cash: 'cash', zeller: 'zeller', eftpos: 'eftpos',
      income: 'income', 'tc cost': 'tcCost', 'ob cost': 'obCost', 'gb cost': 'gbCost', 'wb cost': 'wbCost',
      'other cost': 'otherCost', 'syd collect': 'sydCollect', 'd2d z1': 'd2dZ1', 'd2d z2': 'd2dZ2', 'd2d z3': 'd2dZ3',
      expense: 'expense', 'gross profit': 'grossProfit',
    };
    if (simple[k]) return set(simple[k]);
    if (k.startsWith('dd / bank') || k.startsWith('bank trans')) return set('bank');
    if (k.startsWith('other charges')) return set('otherCharges');
  });
  return cols;
}

function batchNumberFromName(...names) {
  for (const n of names) {
    const m = String(n || '').match(/shipment\s*#?\s*(\d{1,4})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Reads the uploaded file into HBL records. Never touches the database. */
function parseShipmentSheet(buffer, fileName = '') {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  // Prefer a tab named like "Shipment#56"; otherwise the first tab.
  const sheetName = wb.SheetNames.find(n => /shipment\s*#?\s*\d/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });

  const headerIdx = rows.findIndex(r => r.some(c => key(c) === 'sender name'));
  if (headerIdx === -1) {
    throw new Error('This doesn\'t look like a shipment sheet: no "Sender Name" column found. Use the "Shipment#NN" tab of the TRANSCO DASHBOARD sheet.');
  }
  const cols = mapColumns(rows[headerIdx]);
  const missing = ['senderName', 'senderPhone', 'receiverName'].filter(c => cols[c] === undefined);
  if (missing.length) throw new Error(`The sheet is missing these columns: ${missing.join(', ')}.`);
  const at = (r, c) => (cols[c] === undefined ? '' : r[cols[c]]);
  const num = (r, c) => money(at(r, c));

  const records = [];
  let totals = null;
  let pending = null;
  const flush = () => { if (pending) records.push(pending); pending = null; };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => !clean(c))) continue;
    const first = clean(r[0]);
    const senderName = clean(at(r, 'senderName'));

    if (senderName) {
      flush();
      const boxes = {};
      for (const b of Object.keys(BOX_NAMES)) { const n = num(r, b); if (n) boxes[b] = n; }
      const payments = {};
      for (const p of Object.keys(PAYMENT_COLUMNS)) { const n = num(r, p); if (n) payments[p] = n; }
      const costs = {};
      for (const c of COST_COLUMNS) { const n = num(r, c); if (n) costs[c] = n; }
      pending = {
        sheetRow: i + 1,
        hbl: isHbl(first) ? first : null,
        date: toIsoDate(first),
        ddDestination: clean(at(r, 'dd')) || null,
        sender: { name: senderName, address: clean(at(r, 'senderAddress')), rawPhone: clean(at(r, 'senderPhone')), email: clean(at(r, 'senderEmail')).toLowerCase() },
        receiver: {
          name: clean(at(r, 'receiverName')),
          nic: clean(at(r, 'nic')), passport: clean(at(r, 'passport')),
          address: clean(at(r, 'receiverAddress')), rawPhone: clean(at(r, 'receiverPhone')), email: clean(at(r, 'receiverEmail')).toLowerCase(),
        },
        boxes, totalCbm: num(r, 'totalCbm'), totalBoxes: num(r, 'totalBoxes'),
        memo: clean(at(r, 'memo')), payments, otherCharges: num(r, 'otherCharges'), costs,
        income: num(r, 'income') || null, expense: num(r, 'expense') || null, grossProfit: num(r, 'grossProfit') || null,
      };
      continue;
    }

    if (isHbl(first)) {
      if (pending && !pending.hbl) {
        pending.hbl = first;
        pending.income = num(r, 'income') || pending.income;
        pending.expense = num(r, 'expense') || pending.expense;
        pending.grossProfit = num(r, 'grossProfit') || pending.grossProfit;
        flush();
      }
      continue;
    }

    // The totals row sits between the header and the first customer.
    if (!totals && !records.length && !pending) {
      totals = {
        dd: num(r, 'dd'), tc: num(r, 'tc'), gb: num(r, 'gb'), ob: num(r, 'ob'), wb: num(r, 'wb'),
        totalCbm: num(r, 'totalCbm'), totalBoxes: num(r, 'totalBoxes'),
        cash: num(r, 'cash'), zeller: num(r, 'zeller'), eftpos: num(r, 'eftpos'), bank: num(r, 'bank'),
        income: num(r, 'income'), expense: num(r, 'expense'), grossProfit: num(r, 'grossProfit'),
      };
    }
  }
  flush();

  return { fileName, sheetName, batchNumber: batchNumberFromName(fileName, sheetName), totals, records };
}

function boxesText(boxes) {
  return Object.entries(boxes).map(([k, n]) => `${n}x ${BOX_NAMES[k]}`).join(', ');
}

/**
 * Checks every record against the database and, when commit is true,
 * writes the new ones. Returns the same preview either way.
 */
async function runShipmentImport(parsed, { db, batchNumber, label, commit = false, importedBy = null }) {
  const col = n => db.collection(n);
  const now = new Date().toISOString();
  const batch = Number(batchNumber || parsed.batchNumber);
  if (!Number.isInteger(batch) || batch <= 0) throw new Error('Enter the shipment number (for example 56).');

  const existingCons = await col('consolidations').findOne({ batchNumber: batch });
  const hbls = parsed.records.map(r => r.hbl).filter(Boolean);
  const existingHbls = new Set((await col('shipments').find({ hblNumber: { $in: hbls } }, { projection: { hblNumber: 1 } }).toArray()).map(s => s.hblNumber));
  const seen = new Set();
  const customerByPhone = new Map();

  const rows = [];
  for (const rec of parsed.records) {
    const problems = [];
    const senderPhone = normalizePhoneNumber(rec.sender.rawPhone, '61');
    if (!rec.hbl) problems.push('No HBL number under this customer');
    else if (seen.has(rec.hbl)) problems.push(`HBL ${rec.hbl} appears twice in the sheet`);
    if (!senderPhone) problems.push(`Sender mobile "${rec.sender.rawPhone || '(blank)'}" isn't a valid number`);
    if (rec.hbl) seen.add(rec.hbl);

    let customer = senderPhone ? customerByPhone.get(senderPhone) : null;
    if (senderPhone && customer === undefined) {
      customer = await col('customers').findOne({ phoneNumber: senderPhone }, { projection: { name: 1 } });
      customerByPhone.set(senderPhone, customer);
    }
    const paid = Object.values(rec.payments).reduce((a, b) => a + b, 0);
    rows.push({
      rec, senderPhone,
      view: {
        sheetRow: rec.sheetRow, hbl: rec.hbl, date: rec.date,
        sender: rec.sender.name, senderPhone: senderPhone || rec.sender.rawPhone,
        customer: customer ? 'existing' : 'new', existingCustomerName: customer?.name || null,
        receiver: rec.receiver.name, boxes: boxesText(rec.boxes), totalBoxes: rec.totalBoxes,
        income: rec.income, paid,
        state: problems.length ? 'problem' : existingHbls.has(rec.hbl) ? 'already imported' : 'new',
        problems,
      },
    });
  }

  const toImport = rows.filter(r => r.view.state === 'new');
  const newCustomerPhones = new Set(toImport.filter(r => r.view.customer === 'new').map(r => r.senderPhone));
  const summary = {
    batchNumber: batch,
    shipmentGroup: existingCons ? 'existing' : 'new',
    rowsInSheet: rows.length,
    newHbls: toImport.length,
    alreadyImported: rows.filter(r => r.view.state === 'already imported').length,
    problems: rows.filter(r => r.view.state === 'problem').length,
    newCustomers: newCustomerPhones.size,
    existingCustomers: new Set(toImport.filter(r => r.view.customer === 'existing').map(r => r.senderPhone)).size,
    income: Math.round(toImport.reduce((a, r) => a + (r.rec.income || 0), 0) * 100) / 100,
    paid: Math.round(toImport.reduce((a, r) => a + r.view.paid, 0) * 100) / 100,
  };

  if (!commit || !toImport.length) {
    return { committed: false, summary, rows: rows.map(r => r.view), sheetTotals: parsed.totals, fileName: parsed.fileName };
  }

  // ---- Write ----
  const allHbls = rows.map(r => r.rec.hbl).filter(Boolean).sort();
  let consolidationId;
  if (existingCons) {
    consolidationId = existingCons._id;
    const range = existingCons.hblRange || {};
    const from = [range.from, allHbls[0]].filter(Boolean).sort()[0];
    const to = [range.to, allHbls[allHbls.length - 1]].filter(Boolean).sort().pop();
    await col('consolidations').updateOne({ _id: consolidationId }, { $set: { hblRange: { from, to }, updatedAt: now, ...(label && !existingCons.label ? { label } : {}) } });
  } else {
    const t = parsed.totals || {};
    const ins = await col('consolidations').insertOne({
      batchNumber: batch,
      label: label || null,
      peNumber: null,
      hblRange: { from: allHbls[0] || null, to: allHbls[allHbls.length - 1] || null },
      totals: { hbl: rows.length, tc: t.tc || 0, gb: t.gb || 0, ob: t.ob || 0, wb: t.wb || 0, dd: t.dd || 0, totalCbm: t.totalCbm || 0, totalBoxes: t.totalBoxes || 0 },
      paymentTotals: { cash: t.cash || 0, zeller: t.zeller || 0, eftpos: t.eftpos || 0, eft: t.bank || 0 },
      financials: { grossIncome: t.income || 0, totalExpenses: t.expense || 0, grossProfit: t.grossProfit || 0 },
      dates: {},
      source: { ledgerFile: parsed.fileName || null, importedVia: 'console', importedBy },
      createdAt: now, updatedAt: now,
    });
    consolidationId = ins.insertedId;
  }

  let created = 0;
  for (const { rec, senderPhone } of toImport) {
    // Customer: matched by phone; only blank details are filled in.
    const custRes = await col('customers').findOneAndUpdate(
      { phoneNumber: senderPhone },
      {
        $setOnInsert: { phoneNumber: senderPhone, name: rec.sender.name, mode: 'CHATBOT', status: 'HISTORICAL', importedAt: now },
        $addToSet: { sources: 'historical' },
      },
      { upsert: true, returnDocument: 'after' }
    );
    const customer = custRes.value || custRes;
    const fill = {};
    if (!customer.email && rec.sender.email.includes('@')) fill.email = rec.sender.email;
    if (!customer.address && rec.sender.address) fill.address = { raw: rec.sender.address };
    if (Object.keys(fill).length) await col('customers').updateOne({ _id: customer._id }, { $set: fill });

    // Receiver: one record per receiver phone (or name + address).
    const receiverPhone = normalizePhoneNumber(rec.receiver.rawPhone, '94');
    const identityDocument = rec.receiver.nic ? { type: 'NIC', number: rec.receiver.nic }
      : rec.receiver.passport ? { type: 'Passport', number: rec.receiver.passport } : null;
    const receiverInfo = { name: rec.receiver.name, phone: receiverPhone || rec.receiver.rawPhone || null, email: rec.receiver.email.includes('@') ? rec.receiver.email : null, identityDocument, address: rec.receiver.address || null };
    const dedupeKey = receiverPhone || `${rec.receiver.name}|${rec.receiver.address}`.toLowerCase().replace(/\s+/g, ' ');
    const recvRes = await col('receivers').findOneAndUpdate(
      { dedupeKey },
      { $setOnInsert: { dedupeKey, ...receiverInfo, createdAt: now }, $addToSet: { hblNumbers: rec.hbl }, $set: { updatedAt: now } },
      { upsert: true, returnDocument: 'after' }
    );
    const receiver = recvRes.value || recvRes;

    const boxes = { tc: rec.boxes.tc || 0, gb: rec.boxes.gb || 0, ob: rec.boxes.ob || 0, wb: rec.boxes.wb || 0 };
    for (const extra of ['quarterCbm', 'halfCbm', 'oneCbm']) if (rec.boxes[extra]) boxes[extra] = rec.boxes[extra];
    const ship = await col('shipments').insertOne({
      shipmentNumber: `SHP-${now.slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      hblNumber: rec.hbl,
      batchNumber: batch,
      consolidationId,
      customerId: customer._id,
      bookingId: null,
      originDate: rec.date,
      receiver: { name: receiverInfo.name, identityDocument, address: receiverInfo.address, phone: receiverInfo.phone, email: receiverInfo.email },
      receiverId: receiver._id,
      boxes,
      totalCbm: rec.totalCbm,
      totalBoxes: rec.totalBoxes,
      doorDeliveryDestination: rec.ddDestination,
      serviceType: null,
      status: 'booked',
      warehouseStatus: null,
      history: [{ status: 'booked', at: now, note: null }],
      importMeta: { source: 'shipment_sheet_upload', sourceFile: parsed.fileName || null, sheetRow: rec.sheetRow, hblNumber: rec.hbl, batchNumber: batch, importedAt: now, importedBy },
      createdAt: now, updatedAt: now,
    });

    // Invoice + payments, only when the sheet has money for this HBL.
    const total = rec.income || 0;
    const paid = Object.values(rec.payments).reduce((a, b) => a + b, 0);
    if (total || paid) {
      const invoiceNumber = `INV-${rec.hbl}`;
      if (!(await col('invoices').findOne({ invoiceNumber }, { projection: { _id: 1 } }))) {
        const expense = rec.expense ?? Object.values(rec.costs).reduce((a, b) => a + b, 0);
        const lineItems = [{ serviceCode: 'SHIPMENT', description: boxesText(rec.boxes) || 'Shipment', quantity: rec.totalBoxes || 1, unitPrice: null, amount: Math.round((total - (rec.otherCharges || 0)) * 100) / 100 }];
        if (rec.otherCharges) lineItems.push({ serviceCode: 'OTHER', description: 'Other charges', quantity: 1, unitPrice: null, amount: rec.otherCharges });
        if (rec.memo) lineItems.push({ serviceCode: 'OTHER', description: rec.memo, quantity: 1, unitPrice: null, amount: null });
        const inv = await col('invoices').insertOne({
          invoiceNumber, customerId: customer._id, shipmentId: ship.insertedId, consolidationId,
          lineItems, subtotal: Math.round((total - (rec.otherCharges || 0)) * 100) / 100, otherCharges: rec.otherCharges || 0, total, currency: 'AUD',
          costBreakdown: rec.costs, expenseTotal: expense, grossProfit: rec.grossProfit ?? Math.round((total - expense) * 100) / 100,
          status: paid >= total && total > 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid',
          issuedAt: rec.date, dueAt: rec.date,
          sourceHblRollupRow: { income: total, expense, grossProfit: rec.grossProfit ?? null },
          createdAt: now, updatedAt: now,
        });
        for (const [k, amount] of Object.entries(rec.payments)) {
          await col('payments').insertOne({
            invoiceId: inv.insertedId, customerId: customer._id, shipmentId: ship.insertedId, amount,
            method: PAYMENT_COLUMNS[k], direction: 'in', date: rec.date, source: 'shipment_ledger_import',
            reconciliation: { searchKey: rec.hbl, merchantFee: null, gst: null, verifiedBy: null, historical: true },
            createdAt: now,
          });
        }
      }
    }
    created++;
  }

  return { committed: true, created, summary, rows: rows.map(r => r.view), sheetTotals: parsed.totals, fileName: parsed.fileName };
}

module.exports = { parseShipmentSheet, runShipmentImport, toIsoDate, money };
