// ============================================================
// RECEIPT — booking page → Costing → "Receipt" (staff only)
// ============================================================
//
// Mounted at /api/my-transco (behind staff auth; the page-access check
// treats /my-transco/bookings/... as the Bookings / Walk-ins pages).
//
//   GET  /bookings/:bookingId/receipt       can it be sent, who to, sent before
//   GET  /bookings/:bookingId/receipt.pdf   the receipt itself — staff preview it
//   POST /bookings/:bookingId/receipt/send  { to } → emailed from the connected
//                                           Gmail with the PDF attached
//
// Staff always see the receipt before it goes: nothing is sent
// automatically. Every send is recorded on the booking (receiptEmails) and
// in the Emails page's sent list.

const express = require('express');
const { ObjectId } = require('mongodb');
const { bookings, customers, shipments } = require('./db');
const { hasRealName } = require('./customerTools');
const { receiptProblem, receiptData, receiptPdf, fileName, COMPANY } = require('./receiptPdf');
const { sendLoggedGmail } = require('./emailRoutes');

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = function createReceiptRouter({ broadcast }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  async function load(req, res) {
    if (!ObjectId.isValid(req.params.bookingId)) {
      res.status(404).json({ error: 'Booking not found' });
      return null;
    }
    // Only names, phones and emails are used — the ID numbers stay sealed.
    const booking = await bookings().findOne({ _id: new ObjectId(req.params.bookingId) });
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return null;
    }
    const [customer, shipment] = await Promise.all([
      booking.customerId ? customers().findOne({ _id: booking.customerId }, { projection: { name: 1, phoneNumber: 1, email: 1 } }) : null,
      shipments().findOne({ bookingId: booking._id }, { projection: { hblNumber: 1, blNumber: 1 } })
    ]);
    const blNumber = shipment ? shipment.hblNumber || shipment.blNumber || null : null;
    const named = customer && hasRealName(customer) ? customer : customer ? { ...customer, name: null } : null;
    return { booking, customer: named, blNumber };
  }

  const emailFor = ({ booking, customer }) => (booking.sender && booking.sender.email) || (customer && customer.email) || '';

  router.get('/bookings/:bookingId/receipt', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    res.json({
      problem: receiptProblem(ctx.booking),
      to: emailFor(ctx),
      blNumber: ctx.blNumber,
      sent: (ctx.booking.receiptEmails || []).map(e => ({ at: e.at, by: e.by || null, to: e.to })).reverse()
    });
  }));

  router.get('/bookings/:bookingId/receipt.pdf', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const problem = receiptProblem(ctx.booking);
    if (problem) return res.status(400).json({ error: problem });
    const r = receiptData(ctx.booking, ctx);
    const pdf = await receiptPdf(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName(r)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }));

  router.post('/bookings/:bookingId/receipt/send', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const problem = receiptProblem(ctx.booking);
    if (problem) return res.status(400).json({ error: problem });
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!EMAIL_RE.test(to) || to.length > 200) return res.status(400).json({ error: 'Enter the customer\'s email address.' });

    const r = receiptData(ctx.booking, ctx);
    const pdf = await receiptPdf(r);
    const name = (r.sender.name || '').split(' ')[0];
    const ref = r.blNumber ? `BL ${r.blNumber}` : r.number;
    const textBody = [
      `Hi${name ? ` ${name}` : ''},`,
      '',
      `Thank you for shipping with Transco. Your receipt for ${ref} is attached — paid in full, ${r.total.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}.`,
      '',
      `Track your boxes any time at https://${COMPANY.web}${r.blNumber ? ` with your BL number ${r.blNumber}` : ''}.`,
      '',
      `Questions? Call ${COMPANY.phone} or reply to this email.`,
      '',
      COMPANY.name
    ].join('\n');
    const htmlBody = textBody.split('\n').map(l => (l ? `<p style="margin:0 0 4px">${esc(l)}</p>` : '<br>')).join('');
    const sentBy = { id: String(req.user && req.user.sub || ''), name: String((req.user && (req.user.name || req.user.email)) || 'Staff').trim() };

    let sent;
    try {
      sent = await sendLoggedGmail({
        to,
        subject: `Your Transco receipt — ${ref}`,
        textBody,
        htmlBody,
        attachments: [{ filename: fileName(r), contentType: 'application/pdf', content: pdf }],
        customer: ctx.customer,
        booking: ctx.booking,
        sentBy,
        broadcast
      });
    } catch (err) {
      console.error('Receipt email failed:', err.message);
      return res.status(502).json({ error: err.message });
    }
    const entry = { at: sent.sentAt, by: sentBy.name, to, number: r.number, total: r.total };
    await bookings().updateOne({ _id: ctx.booking._id }, { $push: { receiptEmails: { $each: [entry], $slice: -20 } } });
    res.json({ ok: true, sentAt: entry.at, to, from: sent.fromAddress });
  }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    console.error('Receipt route error:', err.message);
    res.status(500).json({ error: 'Something went wrong making the receipt.' });
  });

  return router;
};
