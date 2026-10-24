// Landing sheet: the one-page summary of a shipment (container) that staff
// send to the PE operations team and Supun — per HBL the date, memo, door
// delivery town (blank = collect at Wattala), box counts, CBM and boxes,
// with a totals row. Same columns as the sheet staff used to type by hand.
//
// Imported HBLs (shipment sheet) carry their own counts and CBM. An HBL
// given at drop-off is counted from its booking: Tea Chest 0.12 CBM, Gift
// Box 0.06, odd-size items from their measured size; anything that can't
// be measured (a TV) is flagged "CBM to check" instead of guessed.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const COLUMNS = [
  { key: 'tc', label: 'TC', cbm: 0.12 },
  { key: 'gb', label: 'GB', cbm: 0.06 },
  { key: 'ob', label: 'OB', cbm: null },
  { key: 'wb', label: 'WB', cbm: 0.01 },
  { key: 'quarterCbm', label: '1/4 CBM', cbm: 0.25 },
  { key: 'halfCbm', label: '1/2 CBM', cbm: 0.5 },
  { key: 'oneCbm', label: '1 CBM', cbm: 1 }
];
// TC, GB and OB always show (as on the sheet); the rest only when used.
const ALWAYS = ['tc', 'gb', 'ob'];
const BOOKING_ITEM_TO_COLUMN = { tea_chest: 'tc', gift_box: 'gb', wine_box: 'wb', quarter_cbm: 'quarterCbm' };
const CBM_OF = Object.fromEntries(COLUMNS.map(c => [c.key, c.cbm]));

const round2 = n => Math.round(n * 100) / 100;
const sydneyDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// The memo the shipment sheet had for this HBL (kept on its invoice).
function memoOf(invoice) {
  const line = invoice && Array.isArray(invoice.lineItems) ? invoice.lineItems.find(l => l.serviceCode === 'OTHER' && l.amount === null) : null;
  return line ? String(line.description || '') : '';
}

function rowFor(shipment, booking, invoice) {
  const counts = Object.fromEntries(COLUMNS.map(c => [c.key, 0]));
  let cbm = null, boxes = 0, cbmToCheck = false;
  let date = shipment.originDate || null;
  let destination = shipment.doorDeliveryDestination || '';

  if (shipment.boxes && typeof shipment.boxes === 'object') {
    for (const c of COLUMNS) counts[c.key] = Number(shipment.boxes[c.key]) || 0;
    boxes = Number(shipment.totalBoxes) || Object.values(counts).reduce((a, b) => a + b, 0);
    cbm = typeof shipment.totalCbm === 'number' ? shipment.totalCbm : null;
  } else if (booking && Array.isArray(booking.items) && booking.items.length) {
    let sum = 0;
    for (const item of booking.items) {
      const n = Number(item.qty) || 0;
      const col = BOOKING_ITEM_TO_COLUMN[item.type] || 'ob';
      counts[col] += n;
      boxes += n;
      if (CBM_OF[col] != null) sum += n * CBM_OF[col];
      else if (item.type === 'other' && Array.isArray(item.dims) && item.dims.length >= n) {
        for (const d of item.dims.slice(0, n)) sum += (d.l * d.w * d.h) / 1e6;
      } else if (n) cbmToCheck = true;
    }
    cbm = round2(sum);
  } else {
    boxes = Number(shipment.boxCount ?? (booking && booking.boxCount)) || 0;
    cbmToCheck = boxes > 0;
  }

  if (booking) {
    if (!date) date = booking.requestedDateISO || (booking.createdAt ? sydneyDay(booking.createdAt) : null);
    if (!destination && booking.deliveryType === 'door' && booking.receiver && booking.receiver.town) destination = booking.receiver.town;
  }
  if (!date && shipment.createdAt) date = sydneyDay(shipment.createdAt);

  return {
    shipmentId: String(shipment._id),
    hbl: shipment.hblNumber || '',
    date: date || '',
    memo: memoOf(invoice),
    destination,
    counts,
    cbm: cbm === null ? null : round2(cbm),
    cbmToCheck,
    boxes
  };
}

// rows sorted by HBL; columns in use; totals row.
function buildLandingSheet(consolidation, shipmentList, bookingById, invoiceByShipment) {
  const rows = shipmentList
    .filter(s => s.hblNumber)
    .map(s => rowFor(s, s.bookingId ? bookingById.get(String(s.bookingId)) : null, invoiceByShipment.get(String(s._id))))
    .sort((a, b) => a.hbl.localeCompare(b.hbl, 'en', { numeric: true }));
  const columns = COLUMNS.filter(c => ALWAYS.includes(c.key) || rows.some(r => r.counts[c.key]))
    .map(c => ({ key: c.key, label: c.cbm != null && ALWAYS.includes(c.key) ? `${c.label} = ${c.cbm}` : c.label }));
  const totals = {
    hbls: rows.length,
    doorDeliveries: rows.filter(r => r.destination).length,
    counts: Object.fromEntries(columns.map(c => [c.key, rows.reduce((a, r) => a + r.counts[c.key], 0)])),
    cbm: round2(rows.reduce((a, r) => a + (r.cbm || 0), 0)),
    cbmToCheck: rows.filter(r => r.cbmToCheck || r.cbm === null).length,
    boxes: rows.reduce((a, r) => a + r.boxes, 0)
  };
  return {
    shipment: {
      id: String(consolidation._id),
      batchNumber: consolidation.batchNumber,
      label: consolidation.label || '',
      peNumber: consolidation.peNumber || null,
      etd: consolidation.dates && consolidation.dates.sydneyCalendarEtd || null
    },
    columns,
    rows,
    totals
  };
}

// ---- PDF (A4 landscape, laid out like the hand-made sheet) ----
const BLUE = rgb(0.0, 0.2, 0.85);
const INK = rgb(0.1, 0.1, 0.12);
const GREY = rgb(0.45, 0.45, 0.5);
const LINE = rgb(0.75, 0.75, 0.78);

async function landingSheetPdf(sheet) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 36;

  // Column widths: fixed text columns, box columns share the rest.
  const heads = [
    { label: 'Date', w: 72 }, { label: 'Memo', w: 120 }, { label: 'HBL#', w: 62 }, { label: 'Door Delivery Destination', w: 130 },
    ...sheet.columns.map(c => ({ label: c.label, w: 0, box: c.key })),
    { label: 'Total CBM', w: 66 }, { label: 'Total Boxes', w: 66 }
  ];
  const fixed = heads.reduce((a, h) => a + h.w, 0);
  const boxW = Math.max(40, (W - 2 * M - fixed) / sheet.columns.length);
  heads.forEach(h => { if (h.box) h.w = boxW; });
  const scale = Math.min(1, (W - 2 * M) / heads.reduce((a, h) => a + h.w, 0));
  heads.forEach(h => { h.w *= scale; });

  const rowH = 18, headH = 30;
  const fit = (text, f, size, width) => {
    let t = String(text ?? '');
    while (t && f.widthOfTextAtSize(t, size) > width - 6) t = t.slice(0, -2) + '…';
    return t;
  };
  const cells = (page, y, values, opts = {}) => {
    let x = M;
    heads.forEach((h, i) => {
      const f = opts.bold ? bold : font, size = opts.size || 9;
      const t = fit(values[i], f, size, h.w);
      const tw = f.widthOfTextAtSize(t, size);
      const left = i === 1 && !opts.center; // memo reads left-aligned
      page.drawText(t, { x: left ? x + 4 : x + (h.w - tw) / 2, y: y + (rowH - size) / 2 + 1, size, font: f, color: opts.color || INK });
      page.drawRectangle({ x, y, width: h.w, height: rowH, borderColor: LINE, borderWidth: 0.5 });
      x += h.w;
    });
  };

  const title = `Landing sheet — Shipment ${sheet.shipment.batchNumber}${sheet.shipment.label ? ` (${sheet.shipment.label})` : ''}`;
  const pe = sheet.shipment.peNumber;
  const sub = [pe ? (/^PE/i.test(pe) ? pe : `PE ${pe}`) : null, sheet.shipment.etd ? `Leaves Sydney ${sheet.shipment.etd}` : null,
    `${sheet.totals.hbls} HBLs · ${sheet.totals.boxes} boxes · ${sheet.totals.cbm} CBM`].filter(Boolean).join('   ·   ');

  let page, y, pageNo = 0;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pageNo++;
    page.drawText(title, { x: M, y: H - M - 4, size: 15, font: bold, color: INK });
    page.drawText(sub, { x: M, y: H - M - 22, size: 9.5, font, color: GREY });
    y = H - M - 40 - headH;
    // Header row (two lines where the label is long).
    let x = M;
    for (const h of heads) {
      page.drawRectangle({ x, y, width: h.w, height: headH, borderColor: INK, borderWidth: 0.8 });
      const words = h.label.split(' ');
      const lines = bold.widthOfTextAtSize(h.label, 9) > h.w - 6 && words.length > 1
        ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [h.label];
      lines.forEach((l, i) => {
        const t = fit(l, bold, 9, h.w);
        page.drawText(t, { x: x + (h.w - bold.widthOfTextAtSize(t, 9)) / 2, y: y + headH / 2 + (lines.length === 2 ? (i === 0 ? 2 : -9) : -3), size: 9, font: bold, color: BLUE });
      });
      x += h.w;
    }
  };
  newPage();

  for (const r of sheet.rows) {
    if (y - rowH < M + 30) newPage();
    y -= rowH;
    cells(page, y, [
      r.date, r.memo, r.hbl, r.destination,
      ...sheet.columns.map(c => (r.counts[c.key] ? String(r.counts[c.key]) : '')),
      r.cbm === null ? '?' : (r.cbmToCheck ? `${r.cbm}?` : String(r.cbm)), r.boxes ? String(r.boxes) : ''
    ]);
  }
  if (y - rowH < M + 30) newPage();
  y -= rowH;
  cells(page, y, [
    'Total', '', String(sheet.totals.hbls), String(sheet.totals.doorDeliveries),
    ...sheet.columns.map(c => String(sheet.totals.counts[c.key] || 0)),
    String(sheet.totals.cbm), String(sheet.totals.boxes)
  ], { bold: true });

  const footY = M - 6;
  const notes = [`Blank destination = collect from the Wattala warehouse.`];
  if (sheet.totals.cbmToCheck) notes.push(`"?" = CBM to check (${sheet.totals.cbmToCheck} HBL${sheet.totals.cbmToCheck === 1 ? '' : 's'}: item size not measured).`);
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(notes.join('   '), { x: M, y: footY, size: 8, font, color: GREY });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 8), y: footY, size: 8, font, color: GREY });
  });
  return Buffer.from(await doc.save());
}

module.exports = { buildLandingSheet, landingSheetPdf, COLUMNS };
