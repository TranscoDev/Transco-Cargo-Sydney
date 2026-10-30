// Finance sheet: the shipment money sheet staff used to type by hand — one
// row per BL with boxes, how the customer paid (Cash / Zeller / EFTPOS /
// DD-bank / Other), Income, what that BL costs Transco (TC, OB, GB, WB,
// Other, SYD collect, D2D by zone), Expense and Gross profit.
//
// Nothing is stored here: every row is read from the BL's costing sheet
// (booking.costing) each time, so an edit to a costing sheet shows on the
// Finance page straight away.
//   Income       = the costing total (after discount)
//   Paid columns = the costing sheet's "Paid by" lines
//   Costs        = the costing lines' counts × the cost rates (Finance →
//                  Cost rates); door delivery and home pickup cost what the
//                  costing sheet charges; wine boxes and TVs too, until a
//                  rate is set for them.
// BLs imported from the old shipment sheet (no booking) show the money that
// sheet had (their invoice + payments).

const XLSX = require('xlsx');
const SLCities = require('./slCities');
const { rowFor, COLUMNS: BOX_COLUMNS } = require('./landingSheet');

const DEFAULT_RATES = { teaChest: 25, giftBox: 20, wineBox: null, quarterCbm: 43, oddPerCbm: 200, emptyBox: 7, tv: null };
const RATE_LABELS = {
  teaChest: 'Tea Chest (each)',
  giftBox: 'Gift Box (each)',
  wineBox: 'Wine Box (each)',
  quarterCbm: 'Quarter CBM box (each)',
  oddPerCbm: 'Odd-size box (per 1 CBM)',
  emptyBox: 'Empty box (each)',
  tv: 'TV (each)'
};
// EFTPOS was replaced by PayID: its column shows only on a shipment that has some.
const PAY_KEYS = ['cash', 'zeller', 'payid', 'eftpos', 'bank', 'other'];
const PAY_LABELS = { cash: 'Cash', zeller: 'Zeller', payid: 'PayID', eftpos: 'EFTPOS', bank: 'DD / Bank trans', other: 'Other charges' };
const COST_KEYS = ['tcCost', 'obCost', 'gbCost', 'wbCost', 'otherCost', 'sydCollect', 'd2dZ1', 'd2dZ2', 'd2dZ3'];
const COST_LABELS = {
  tcCost: 'TC cost', obCost: 'OB cost', gbCost: 'GB cost', wbCost: 'WB cost', otherCost: 'Other cost',
  sydCollect: 'SYD collect', d2dZ1: 'D2D Z1', d2dZ2: 'D2D Z2', d2dZ3: 'D2D Z3'
};
// TC, GB and OB always show (as on the sheet); the rest only when used.
const ALWAYS_BOX = ['tc', 'gb', 'ob'];

const r2 = n => Math.round(n * 100) / 100;
const zeros = keys => Object.fromEntries(keys.map(k => [k, 0]));
const ODD_DIMS = /(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)/i;

function ratesFrom(doc) {
  const out = { ...DEFAULT_RATES };
  if (doc && doc.rates) for (const k of Object.keys(DEFAULT_RATES)) if (doc.rates[k] !== undefined) out[k] = doc.rates[k];
  // Items staff added (Cost rates → Add item): an "Other" costing line with
  // the same name costs qty × rate.
  out.custom = (doc && doc.rates && Array.isArray(doc.rates.custom)) ? doc.rates.custom : [];
  return out;
}

const nameKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Rates from the Cost rates form. Blank = no rate (wine box / TV then cost
// what the costing sheet charges).
function cleanRates(body) {
  const rates = { custom: [] };
  const seen = new Set();
  for (const item of (body && Array.isArray(body.custom) ? body.custom : [])) {
    const name = String((item && item.name) || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const raw = item ? item.rate : undefined;
    if (!name && (raw === undefined || raw === null || raw === '')) continue;
    if (!name) return { error: 'Each added item needs a name.' };
    if (seen.has(nameKey(name))) return { error: `"${name}" is added twice.` };
    seen.add(nameKey(name));
    const v = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(v) || v < 0 || v > 100000) return { error: `${name} must be an amount of 0 or more.` };
    rates.custom.push({ name, rate: r2(v) });
  }
  for (const k of Object.keys(DEFAULT_RATES)) {
    const raw = body ? body[k] : undefined;
    if (raw === undefined || raw === null || raw === '') { rates[k] = null; continue; }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return { error: `${RATE_LABELS[k]} must be an amount of 0 or more.` };
    rates[k] = r2(v);
  }
  return { value: rates };
}

/** One BL's costs from its costing lines; `checks` = things staff should look at. */
function costsFromCosting(costing, town, rates) {
  const costs = zeros(COST_KEYS);
  const checks = [];
  const rateOr = (rate, qty, amount) => (rate === null || rate === undefined ? amount : qty * rate);
  for (const l of (costing && costing.lines) || []) {
    const qty = Number(l.qty) || 1;
    const amount = Number(l.amount) || 0;
    const kind = l.kind || '';
    if (kind === 'tea_chest') costs.tcCost += qty * (rates.teaChest || 0);
    else if (kind === 'gift_box') costs.gbCost += qty * (rates.giftBox || 0);
    else if (kind === 'wine_box') costs.wbCost += rateOr(rates.wineBox, qty, amount);
    else if (kind === 'quarter_cbm') costs.otherCost += qty * (rates.quarterCbm || 0);
    else if (kind === 'extra_boxes') costs.otherCost += qty * (rates.emptyBox || 0);
    else if (kind === 'tv' || kind.startsWith('tv_')) costs.otherCost += rateOr(rates.tv, qty, amount);
    else if (kind === 'pickup') costs.sydCollect += amount;
    else if (kind === 'door') {
      const zone = SLCities.zoneOf(town);
      if (zone) costs[`d2dZ${zone}`] += amount;
      else {
        costs.otherCost += amount;
        checks.push(town ? `No delivery zone for "${town}"` : 'Door delivery with no town');
      }
    } else if (kind === 'odd') {
      const m = ODD_DIMS.exec(l.label || '');
      if (m) costs.obCost += qty * ((Number(m[1]) * Number(m[2]) * Number(m[3])) / 1e6) * (rates.oddPerCbm || 0);
      else checks.push('Odd-size item not measured');
    } else if (kind === 'general') costs.otherCost += amount;
    else {
      // "other" lines (and old lines with no type) are a charge to the
      // customer only — no cost — unless their name is an added item.
      const item = (rates.custom || []).find(c => nameKey(c.name) === nameKey(l.label));
      if (item) costs.otherCost += qty * item.rate;
    }
  }
  for (const k of COST_KEYS) costs[k] = r2(costs[k]);
  return { costs, checks };
}

/** Income / expense of one BL's costing sheet — for the shipment's Money card. */
function costingMoney(costing, town, rates) {
  const { costs } = costsFromCosting(costing, town, rates);
  return { income: Number(costing.total) || 0, expense: r2(COST_KEYS.reduce((a, k) => a + costs[k], 0)) };
}

function rowMoney(shipment, booking, invoice, importedPayments, rates) {
  const paid = zeros(PAY_KEYS);
  let costs = zeros(COST_KEYS);
  let income = 0, source = 'none', checks = [];
  if (booking && booking.costing) {
    source = 'costing';
    income = Number(booking.costing.total) || 0;
    for (const p of booking.costing.payments || []) if (paid[p.method] !== undefined) paid[p.method] += Number(p.amount) || 0;
    ({ costs, checks } = costsFromCosting(booking.costing, booking.receiver && booking.receiver.town, rates));
  } else if (invoice) {
    source = 'sheet';
    income = Number(invoice.total) || 0;
    for (const p of importedPayments || []) {
      const k = p.method === 'bank_transfer' ? 'bank' : p.method;
      if (paid[k] !== undefined) paid[k] += Number(p.amount) || 0;
    }
    paid.other += Number(invoice.otherCharges) || 0;
    for (const k of COST_KEYS) costs[k] = Number(invoice.costBreakdown && invoice.costBreakdown[k]) || 0;
  }
  for (const k of PAY_KEYS) paid[k] = r2(paid[k]);
  const paidTotal = r2(PAY_KEYS.reduce((a, k) => a + paid[k], 0));
  const expense = r2(COST_KEYS.reduce((a, k) => a + costs[k], 0));
  return {
    source,
    paid, paidTotal, income: r2(income),
    owing: source === 'costing' ? r2(Math.max(0, income - paidTotal)) : 0,
    costs, expense, profit: r2(income - expense),
    checks
  };
}

// Rows sorted by BL; box columns in use; totals.
function buildFinanceSheet(consolidation, shipmentList, bookingById, invoiceByShipment, paymentsByShipment, rates) {
  const rows = shipmentList
    .filter(s => s.hblNumber)
    .map(s => {
      const booking = s.bookingId ? bookingById.get(String(s.bookingId)) : null;
      const invoice = invoiceByShipment.get(String(s._id));
      const base = rowFor(s, booking, invoice);
      return { ...base, bookingId: booking ? String(booking._id) : null, ...rowMoney(s, booking, invoice, paymentsByShipment.get(String(s._id)), rates) };
    })
    .sort((a, b) => a.hbl.localeCompare(b.hbl, 'en', { numeric: true }));

  const boxColumns = BOX_COLUMNS.filter(c => ALWAYS_BOX.includes(c.key) || rows.some(r => r.counts[c.key])).map(c => ({ key: c.key, label: c.label }));
  const sum = pick => r2(rows.reduce((a, r) => a + (pick(r) || 0), 0));
  const totals = {
    hbls: rows.length,
    counts: Object.fromEntries(boxColumns.map(c => [c.key, rows.reduce((a, r) => a + r.counts[c.key], 0)])),
    cbm: sum(r => r.cbm),
    boxes: sum(r => r.boxes),
    paid: Object.fromEntries(PAY_KEYS.map(k => [k, sum(r => r.paid[k])])),
    paidTotal: sum(r => r.paidTotal),
    income: sum(r => r.income),
    owing: sum(r => r.owing),
    costs: Object.fromEntries(COST_KEYS.map(k => [k, sum(r => r.costs[k])])),
    expense: sum(r => r.expense),
    profit: sum(r => r.profit),
    noCosting: rows.filter(r => r.source === 'none').length,
    unpaid: rows.filter(r => r.owing > 0).length,
    toCheck: rows.filter(r => r.checks.length).length
  };
  return {
    shipment: {
      id: String(consolidation._id),
      batchNumber: consolidation.batchNumber,
      label: consolidation.label || '',
      peNumber: consolidation.peNumber || null
    },
    boxColumns,
    payColumns: PAY_KEYS.filter(k => k !== 'eftpos' || totals.paid.eftpos).map(k => ({ key: k, label: PAY_LABELS[k] })),
    costColumns: COST_KEYS.map(k => ({ key: k, label: COST_LABELS[k] })),
    rows,
    totals
  };
}

/** The sheet as an .xlsx, same columns as the hand-made one; BL first. */
function financeSheetXlsx(sheet) {
  const head = [
    'BL', 'Date', 'Door Delivery Destination',
    ...sheet.boxColumns.map(c => c.label), 'Total CBM', 'Total Boxes', 'Memo',
    ...sheet.payColumns.map(c => c.label), 'Income',
    ...sheet.costColumns.map(c => c.label), 'Expense', 'Gross profit'
  ];
  const money = n => (n ? n : '');
  const rows = sheet.rows.map(r => [
    r.hbl, r.date, r.destination,
    ...sheet.boxColumns.map(c => r.counts[c.key] || ''), r.cbm ?? '', r.boxes || '', r.memo,
    ...sheet.payColumns.map(c => money(r.paid[c.key])), money(r.income),
    ...sheet.costColumns.map(c => money(r.costs[c.key])), money(r.expense), r.profit
  ]);
  const t = sheet.totals;
  const total = [
    'Total', '', '',
    ...sheet.boxColumns.map(c => t.counts[c.key]), t.cbm, t.boxes, '',
    ...sheet.payColumns.map(c => t.paid[c.key]), t.income,
    ...sheet.costColumns.map(c => t.costs[c.key]), t.expense, t.profit
  ];
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows, [], total]);
  ws['!cols'] = head.map((h, i) => ({ wch: i === 2 || h === 'Memo' ? 22 : Math.max(9, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Shipment ${sheet.shipment.batchNumber}`);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { DEFAULT_RATES, RATE_LABELS, ratesFrom, cleanRates, costsFromCosting, costingMoney, buildFinanceSheet, financeSheetXlsx };
