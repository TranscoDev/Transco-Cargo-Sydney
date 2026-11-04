// ============================================================
// RECEIPT PDF — one A4 receipt for a fully paid booking
// ============================================================
//
// Made from the booking's costing sheet (booking.costing: lines, discount,
// total, payments). Same layout as the sample the office agreed: logo and
// warehouse details, Receipt no. / Date / BL number, sender and receiver,
// Item | Qty | Amount (the price each and any free items are written in
// the item name, so every amount adds up at a glance), how it was paid,
// and the totals ending with "Paid". No booking or shipment codes and no
// customer number — customers know their BL.
//
// Only for a booking that is paid in full (receiptProblem() says why not).

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const COMPANY = {
  name: 'Transco Cargo Sydney',
  address: 'Unit 1, No 79 Station Road, Seven Hills NSW 2147',
  phone: '0434 842 023',
  email: 'transcosydney@gmail.com',
  web: 'my.transcosydney.com.au'
};
const LOGO_FILE = path.join(__dirname, 'media', 'transco-logo.png');

const COUNTRY = { sri_lanka: 'Sri Lanka', india: 'India' };
const SERVICE = { sea: 'Sea freight', air: 'Air freight' };
const DELIVERY = { door: 'Door delivery', collect: 'Collect from warehouse' };
const PAY_METHOD = { cash: 'Cash', zeller: 'Zeller', payid: 'PayID', eftpos: 'EFTPOS', bank: 'Bank transfer', other: 'Other' };
const FREE_THIRD = / \(every 3rd free\)$/;

const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = hex('#182233');
const MUTED = hex('#4a5566');
const LINE = hex('#dde3ea');
const SOFT = hex('#f4f6f9');
const GREEN = hex('#0b5a46');
const GREEN_BG = hex('#e6f5f0');
const GREEN_EDGE = hex('#9fd6c6');
const LINK = hex('#0c7d6b');
const WHITE = rgb(1, 1, 1);

const r2 = n => Math.round(n * 100) / 100;
const dollars = n => `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Standard PDF fonts only have Latin letters: keep those (and — – × ·),
// anything else (e.g. a Sinhala name) becomes "?".
function printable(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/−/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF—–]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function sydneyDate(d) {
  return d.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Why this booking can't have a receipt yet, or null. */
function receiptProblem(booking) {
  const c = booking && booking.costing;
  if (!c || !Array.isArray(c.lines) || !c.lines.length) return 'Save the costing first — the receipt is made from it.';
  const total = Number(c.total) || 0;
  if (total <= 0) return 'The costing total is $0, so there is nothing to put on a receipt.';
  const paid = r2((c.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  if (paid + 0.005 < total) return `Not fully paid yet (${dollars(paid)} of ${dollars(total)}). Add the payments under "Paid by" and save the costing — the receipt is for bookings paid in full.`;
  return null;
}

/** "Tea Chest — $75 each, 1 free" — a line's name with its price each written in. */
function itemName(l) {
  const qty = Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 1;
  const freeThird = FREE_THIRD.test(l.label);
  let name = l.label.replace(FREE_THIRD, '');
  if (qty > 1) {
    const free = freeThird ? Math.floor(qty / 3) : 0;
    const each = l.amount / (qty - free);
    // Only when it divides evenly — a made-up "each" would start arguments.
    if (each > 0 && Math.abs(each * 100 - Math.round(each * 100)) < 1e-6) {
      name += ` — ${dollars(each).replace(/\.00$/, '')} each${free ? `, ${free} free` : ''}`;
    }
  }
  return { name, qty };
}

/** Everything printed on the receipt, from the booking (+ BL and customer). */
function receiptData(booking, { blNumber, customer, now = new Date() }) {
  const c = booking.costing;
  const sender = booking.sender || {};
  const receiver = booking.receiver || {};
  const lines = c.lines.map(l => ({ ...itemName(l), amount: Number(l.amount) || 0 }));
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const ref = blNumber || booking.bookingCode || String(booking._id).slice(-6).toUpperCase();
  const place = [receiver.town, COUNTRY[booking.country]].filter(Boolean).join(', ');
  return {
    number: `REC-${ref}`,
    date: sydneyDate(now),
    blNumber: blNumber || null,
    sender: {
      name: sender.fullName || (customer && customer.name) || '',
      phone: sender.mobile || (customer && customer.phoneNumber ? `+${customer.phoneNumber}` : ''),
      email: sender.email || (customer && customer.email) || ''
    },
    receiver: {
      name: receiver.fullName || '',
      place,
      service: [SERVICE[booking.serviceType], DELIVERY[booking.deliveryType]].filter(Boolean).join(' · ')
    },
    lines,
    subtotal,
    discount: Number(c.discount) || 0,
    total: Number(c.total) || 0,
    payments: (c.payments || []).map(p => ({ method: PAY_METHOD[p.method] || 'Other', amount: Number(p.amount) || 0 })),
    paid: r2((c.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0))
  };
}

function fileName(r) {
  return `Transco receipt ${r.blNumber ? `BL ${r.blNumber}` : r.number}.pdf`;
}

async function receiptPdf(r) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${r.number}`);
  doc.setAuthor(COMPANY.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The logo file is really a JPEG despite its .png name — go by its bytes.
  const logoBytes = fs.existsSync(LOGO_FILE) ? fs.readFileSync(LOGO_FILE) : null;
  const logo = !logoBytes ? null : logoBytes[0] === 0xff && logoBytes[1] === 0xd8 ? await doc.embedJpg(logoBytes) : await doc.embedPng(logoBytes);

  const W = 595.28, H = 841.89, M = 42, RIGHT = W - M;
  let page = doc.addPage([W, H]);
  // y = distance from the top of the page, like the sample's layout.
  let y = 40;

  const width = (s, f, size) => f.widthOfTextAtSize(printable(s), size);
  const text = (s, x, top, { size = 9.5, f = font, color = INK, align = 'left' } = {}) => {
    const t = printable(s);
    if (!t) return;
    const w = f.widthOfTextAtSize(t, size);
    const left = align === 'right' ? x - w : x;
    page.drawText(t, { x: left, y: H - top - size, size, font: f, color });
  };
  const rect = (x, top, w, h, opts) => page.drawRectangle({ x, y: H - top - h, width: w, height: h, ...opts });
  const hline = (x1, x2, top, color = LINE, thickness = 0.75) =>
    page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, color, thickness });
  // Word-wrap to a width; long single words are cut.
  const wrap = (s, f, size, maxW) => {
    const out = [];
    let cur = '';
    for (const word of printable(s).split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) <= maxW || !cur) cur = next;
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    return out;
  };
  const label = (s, x, top) => text(s.toUpperCase(), x, top, { size: 7.5, color: MUTED });

  // ---------- header ----------
  const LOGO = 66;
  if (logo) page.drawImage(logo, { x: M, y: H - y - LOGO, width: LOGO, height: LOGO });
  const tx = logo ? M + LOGO + 12 : M;
  text(COMPANY.name, tx, y + 10, { size: 15, f: bold });
  text(COMPANY.address, tx, y + 30, { size: 8.5, color: MUTED });
  text(`${COMPANY.phone} · ${COMPANY.email} · ${COMPANY.web}`, tx, y + 43, { size: 8.5, color: MUTED });
  text('RECEIPT', RIGHT, y + 4, { size: 20, f: bold, align: 'right' });
  const badge = 'PAID IN FULL';
  const bw = width(badge, bold, 9.5) + 18;
  rect(RIGHT - bw, y + 32, bw, 20, { color: GREEN_BG, borderColor: GREEN_EDGE, borderWidth: 0.75 });
  text(badge, RIGHT - 9, y + 37.5, { size: 9.5, f: bold, color: GREEN, align: 'right' });
  y += LOGO + 18;

  // ---------- receipt no. / date / BL ----------
  rect(M, y, RIGHT - M, 42, { color: SOFT });
  const col = (RIGHT - M - 24) / 3;
  [['Receipt no.', r.number], ['Date', r.date], ['BL number', r.blNumber || '—']].forEach(([k, v], i) => {
    const x = M + 12 + i * col;
    label(k, x, y + 9);
    text(v, x, y + 22, { size: i === 2 ? 11.5 : 10, f: bold });
  });
  y += 42 + 14;

  // ---------- sender / receiver ----------
  const half = (RIGHT - M - 12) / 2;
  const person = (x, title, rows) => {
    rect(x, y, half, 62, { borderColor: LINE, borderWidth: 0.75 });
    label(title, x + 11, y + 9);
    rows.forEach((row, i) => {
      const t = wrap(row, i === 0 ? bold : font, 9.5, half - 22)[0] || '';
      text(t, x + 11, y + 22 + i * 13, { f: i === 0 ? bold : font, color: i === 0 ? INK : MUTED });
    });
  };
  person(M, 'Sender', [r.sender.name, [r.sender.phone, r.sender.email].filter(Boolean).join(' · ')]);
  person(M + half + 12, 'Receiver', [r.receiver.name, r.receiver.place, r.receiver.service]);
  y += 62 + 18;

  // ---------- items ----------
  const QTY_X = RIGHT - 110, AMT_X = RIGHT - 10, NAME_W = QTY_X - M - 30;
  const tableHead = () => {
    rect(M, y, RIGHT - M, 22, { color: INK });
    text('Item', M + 10, y + 7, { size: 9, f: bold, color: WHITE });
    text('Qty', QTY_X, y + 7, { size: 9, f: bold, color: WHITE, align: 'right' });
    text('Amount', AMT_X, y + 7, { size: 9, f: bold, color: WHITE, align: 'right' });
    y += 22;
  };
  tableHead();
  for (const l of r.lines) {
    const rows = wrap(l.name, font, 9.5, NAME_W);
    const h = 10 + rows.length * 12.5;
    if (y + h > H - 150) {
      page = doc.addPage([W, H]);
      y = 40;
      tableHead();
    }
    rows.forEach((row, i) => text(row, M + 10, y + 7 + i * 12.5));
    text(String(l.qty), QTY_X, y + 7, { align: 'right' });
    text(dollars(l.amount), AMT_X, y + 7, { align: 'right' });
    y += h;
    hline(M, RIGHT, y);
  }
  y += 18;

  // ---------- paid by + totals ----------
  const totalsRows = 2 + (r.discount ? 1 : 0);
  const blockH = Math.max(30 + r.payments.length * 15, totalsRows * 16 + 40);
  if (y + blockH > H - 110) {
    page = doc.addPage([W, H]);
    y = 40;
  }
  const TW = 200, TX = RIGHT - TW;
  const boxW = TX - M - 24;
  const payH = 26 + Math.max(1, r.payments.length) * 15;
  rect(M, y, boxW, payH, { borderColor: LINE, borderWidth: 0.75 });
  label('Paid by', M + 11, y + 9);
  r.payments.forEach((p, i) => {
    text(p.method, M + 11, y + 23 + i * 15);
    text(dollars(p.amount), M + boxW - 11, y + 23 + i * 15, { align: 'right' });
  });

  let ty = y;
  const totalRow = (k, v, opts = {}) => {
    text(k, TX, ty, { color: opts.color || MUTED, f: opts.f || font, size: opts.size || 9.5 });
    text(v, RIGHT, ty, { f: opts.f || font, size: opts.size || 9.5, color: opts.color || INK, align: 'right' });
    ty += 16;
  };
  totalRow('Subtotal', dollars(r.subtotal));
  if (r.discount) totalRow('Discount', `-${dollars(r.discount)}`);
  hline(TX, RIGHT, ty + 1, INK, 1.5);
  ty += 8;
  totalRow('Total', dollars(r.total), { f: bold, size: 12, color: INK });
  rect(TX, ty, TW, 24, { color: GREEN_BG });
  text('Paid', TX + 9, ty + 7, { f: bold, size: 11, color: GREEN });
  text(dollars(r.paid), RIGHT - 9, ty + 7, { f: bold, size: 11, color: GREEN, align: 'right' });

  // ---------- footer (bottom of the last page) ----------
  const FY = H - 96;
  hline(M, RIGHT, FY);
  const thanks = `Thank you for shipping with Transco. Track your boxes any time in My Transco${r.blNumber ? ` with your BL number ${r.blNumber}` : ''}.`;
  wrap(thanks, font, 9, 300).forEach((row, i) => text(row, M, FY + 12 + i * 12.5, { size: 9, color: MUTED }));
  const CX = RIGHT - 150;
  text(`Questions? ${COMPANY.phone}`, CX, FY + 12, { size: 9, color: MUTED });
  text(COMPANY.email, CX, FY + 24.5, { size: 9, color: MUTED });
  text(COMPANY.web, CX, FY + 37, { size: 9, color: LINK });

  return Buffer.from(await doc.save());
}

module.exports = { receiptProblem, receiptData, receiptPdf, fileName, COMPANY };
