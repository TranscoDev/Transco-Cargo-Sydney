// ============================================================
// LOGIN LINKS — My Transco for customers who find sign-up hard
// ============================================================
//
// Mostly elderly customers at the counter. Staff make the account for
// them (Quick register) and send a Login link on WhatsApp/SMS; tapping it
// opens their normal My Transco straight away — no password, no forms —
// and that phone stays signed in until they sign out. Same account and
// portal as everyone else; they can still set a password later.
//
// Every staff login can use these (not tied to a console page), so the
// warehouse team can do it at the counter.
//
//   POST   /api/login-links/quick-register   { name, phone, email? } → customer + link
//   POST   /api/login-links/:customerId      a new link (replaces the old one)
//   DELETE /api/login-links/:customerId      cancel the link

const express = require('express');
const { ObjectId } = require('mongodb');
const { customers } = require('./db');
const { normalizePhoneNumber } = require('./normalizePhone');
const { emailTakenByOtherAccount } = require('./portalRoutes');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function createLoginLinkRouter({ tools }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const staff = req => (req.user && (req.user.email || req.user.name)) || null;

  function shapeLink(customer, invite) {
    return {
      customerId: String(customer._id),
      name: customer.name || null,
      phoneNumber: customer.phoneNumber,
      customerCode: customer.customerCode || null,
      link: invite.link,
      expiresAt: invite.expiresAt
    };
  }

  router.post('/quick-register', wrap(async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    if (name.length < 2) return res.status(400).json({ error: 'Type the customer\'s name.', field: 'name' });
    // The link goes to a mobile: a local 07… number is a Sri Lankan mobile
    // (Australian mobiles are 04…/05…; an Australian 07 landline can't get
    // WhatsApp or SMS), so it gets +94, not the default +61.
    const raw = String(body.phone || '').trim();
    const local = raw.replace(/\D/g, '');
    const phoneNumber = !raw.startsWith('+') && /^07\d{8}$/.test(local) ? normalizePhoneNumber('94' + local.slice(1)) : normalizePhoneNumber(raw);
    if (!phoneNumber) return res.status(400).json({ error: 'That phone number doesn\'t look right. Use +94… for Sri Lanka.', field: 'phone' });
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email && (!EMAIL_RE.test(email) || email.length > 120)) return res.status(400).json({ error: 'That email address doesn\'t look right.', field: 'email' });

    const now = new Date();
    let customer = await customers().findOne({ phoneNumber, channel: { $ne: 'website' } });
    let existing = Boolean(customer);
    if (customer) {
      // Same person already known (a booking, WhatsApp…) — keep their
      // history; fill in what's missing.
      const set = { staffAccountAt: customer.staffAccountAt || now, staffAccountBy: customer.staffAccountBy || staff(req) };
      if (!customer.name || /^\+?\d[\d\s]*$/.test(customer.name)) set.name = name;
      if (email && !customer.email) {
        if (await emailTakenByOtherAccount(email, customer._id)) return res.status(409).json({ error: 'This email is already used by another My Transco account.', field: 'email' });
        set.email = email;
      }
      customer = await customers().findOneAndUpdate({ _id: customer._id }, { $set: set, $addToSet: { sources: 'portal' } }, { returnDocument: 'after' });
    } else {
      if (email && await emailTakenByOtherAccount(email)) return res.status(409).json({ error: 'This email is already used by another My Transco account.', field: 'email' });
      const doc = {
        phoneNumber,
        name,
        mode: 'CHATBOT',
        status: 'ACTIVE',
        createdAt: now,
        sources: ['portal'],
        phoneVerified: false,
        ...(email ? { email } : {}),
        preferredLanguage: 'en',
        acquisitionSource: 'staff',
        staffAccountAt: now,
        staffAccountBy: staff(req)
      };
      try {
        const { insertedId } = await customers().insertOne(doc);
        customer = { ...doc, _id: insertedId };
      } catch (err) {
        if (err && err.code === 11000) {
          customer = await customers().findOne({ phoneNumber });
          existing = true;
        } else {
          throw err;
        }
      }
    }
    await tools.ensureCustomerCode(customer);
    customer = await customers().findOne({ _id: customer._id });
    const invite = await tools.createInviteLink(customer, staff(req), { direct: true });
    res.status(existing ? 200 : 201).json({ ...shapeLink(customer, invite), existing });
  }));

  router.post('/:customerId', wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.customerId)) return res.status(404).json({ error: 'Customer not found' });
    let customer = await customers().findOne({ _id: new ObjectId(req.params.customerId), channel: { $ne: 'website' } });
    if (!customer) return res.status(404).json({ error: 'Customer not found. For a website chat, link it to the customer first.' });
    if (!customer.staffAccountAt && !customer.portalJoinedAt && !customer.passwordHash) {
      await customers().updateOne({ _id: customer._id }, { $set: { staffAccountAt: new Date(), staffAccountBy: staff(req) } });
    }
    await tools.ensureCustomerCode(customer);
    customer = await customers().findOne({ _id: customer._id });
    const invite = await tools.createInviteLink(customer, staff(req), { direct: true });
    res.json(shapeLink(customer, invite));
  }));

  router.delete('/:customerId', wrap(async (req, res) => {
    if (!ObjectId.isValid(req.params.customerId)) return res.status(404).json({ error: 'Customer not found' });
    await customers().updateOne({ _id: new ObjectId(req.params.customerId) }, { $unset: { invite: '' } });
    res.json({ success: true });
  }));

  return router;
};
