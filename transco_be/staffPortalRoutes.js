// ============================================================
// CRM → MY TRANSCO — staff view of customers' online accounts,
// mounted at /api/my-transco (behind the normal staff auth).
// ============================================================
//
// Read side: the list of every customer who has a My Transco account
// (signed in at least once, or given a password by staff) with the
// counts staff triage by, and one customer's full profile — details,
// account/security state, bookings with their customer-visible progress,
// shipments/BLs, and their signed-in website chat sessions.
//
// Write side: the account actions staff need on a phone call — edit
// details, mark the number as verified, sign the customer out
// everywhere, unlock after too many wrong passwords. (Setting a
// password is POST /api/customers/:id/portal-password in server.js;
// booking stages / BLs use the existing booking endpoints.)
//
// Staff see everything on the customer record — unlike the customer
// themselves, whose view of an unverified number is scoped down (see
// scope() in customerTools.js).

const express = require('express');
const { ObjectId } = require('mongodb');
const { customers, bookings, shipments, messages } = require('./db');
const { hasRealName, hasVerifiedPhone } = require('./customerTools');
const { profileUpdateFromBody, emailTakenByOtherAccount } = require('./portalRoutes');
const { normalizePhoneNumber } = require('./normalizePhone');

// "Has a My Transco account" = signed in at least once, or has a password.
const ACCOUNT_QUERY = {
  channel: { $ne: 'website' },
  $or: [{ portalJoinedAt: { $exists: true } }, { passwordHash: { $exists: true } }]
};

function accountSummary(c) {
  const now = new Date();
  return {
    id: String(c._id),
    customerCode: c.customerCode || null,
    name: hasRealName(c) ? c.name : null,
    phoneNumber: c.phoneNumber,
    email: c.email || null,
    phoneVerified: hasVerifiedPhone(c),
    hasPassword: Boolean(c.passwordHash),
    passwordSetByStaff: c.passwordSetByStaff ? String(c.passwordSetByStaff) : null,
    locked: Boolean(c.portalLockedUntil && c.portalLockedUntil > now),
    lockedUntil: c.portalLockedUntil && c.portalLockedUntil > now ? c.portalLockedUntil : null,
    joinedAt: c.portalJoinedAt || c.createdAt || null,
    lastSignInAt: c.lastPortalLoginAt || null,
    source: c.acquisitionSource || null,
    sources: c.sources || [],
    preferredLanguage: c.preferredLanguage || 'en',
    hasWhatsAppConversation: (c.sources || []).includes('whatsapp')
  };
}

module.exports = function createStaffPortalRouter({ tools }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  async function loadAccount(req, res) {
    const { customerId } = req.params;
    if (!ObjectId.isValid(customerId)) {
      res.status(400).json({ error: 'Invalid customer id' });
      return null;
    }
    const c = await customers().findOne({ _id: new ObjectId(customerId), channel: { $ne: 'website' } });
    if (!c) {
      res.status(404).json({ error: 'Customer not found' });
      return null;
    }
    return c;
  }

  // ---------- list ----------

  router.get('/customers', wrap(async (req, res) => {
    const docs = await customers()
      .find(ACCOUNT_QUERY)
      .sort({ portalJoinedAt: -1, createdAt: -1 })
      .limit(5000)
      .toArray();
    const ids = docs.map(c => c._id);

    const [bookingRows, shipmentRows] = ids.length
      ? await Promise.all([
          bookings().aggregate([
            { $match: { customerId: { $in: ids } } },
            {
              $group: {
                _id: '$customerId',
                total: { $sum: 1 },
                open: { $sum: { $cond: [{ $in: ['$status', ['pending', 'confirmed']] }, 1, 0] } },
                online: { $sum: { $cond: [{ $eq: ['$channel', 'portal'] }, 1, 0] } },
                needsDeclaration: {
                  $sum: {
                    $cond: [
                      { $and: [{ $ne: ['$status', 'cancelled'] }, { $ne: ['$declarationStatus', 'received'] }, { $not: ['$shipmentId'] }] },
                      1, 0
                    ]
                  }
                },
                lastBookingAt: { $max: '$createdAt' }
              }
            }
          ]).toArray(),
          shipments().aggregate([
            { $match: { customerId: { $in: ids } } },
            { $group: { _id: '$customerId', total: { $sum: 1 }, withBl: { $sum: { $cond: [{ $ifNull: ['$hblNumber', false] }, 1, 0] } } } }
          ]).toArray()
        ])
      : [[], []];

    const bookingBy = new Map(bookingRows.map(r => [String(r._id), r]));
    const shipmentBy = new Map(shipmentRows.map(r => [String(r._id), r]));
    const weekAgo = new Date(Date.now() - 7 * 86400000);

    const list = docs.map(c => {
      const b = bookingBy.get(String(c._id)) || {};
      const s = shipmentBy.get(String(c._id)) || {};
      return {
        ...accountSummary(c),
        bookings: { total: b.total || 0, open: b.open || 0, online: b.online || 0, needsDeclaration: b.needsDeclaration || 0, lastAt: b.lastBookingAt || null },
        shipments: { total: s.total || 0, withBl: s.withBl || 0 }
      };
    });

    res.json({
      stats: {
        accounts: list.length,
        joinedThisWeek: list.filter(c => c.joinedAt && new Date(c.joinedAt) >= weekAgo).length,
        verified: list.filter(c => c.phoneVerified).length,
        unverified: list.filter(c => !c.phoneVerified).length,
        withBookings: list.filter(c => c.bookings.total > 0).length,
        needsDeclaration: list.filter(c => c.bookings.needsDeclaration > 0).length,
        fromQr: list.filter(c => c.source === 'warehouse_qr').length,
        locked: list.filter(c => c.locked).length
      },
      customers: list
    });
  }));

  // ---------- one customer ----------

  router.get('/customers/:customerId', wrap(async (req, res) => {
    const c = await loadAccount(req, res);
    if (!c) return;
    await tools.ensureCustomerCode(c);

    const [bookingList, shipmentList, rawBookings, chatSessions] = await Promise.all([
      tools.getCustomerBookings(c._id, { limit: 100, staff: true }),
      tools.getCustomerShipments(c._id, { limit: 100, staff: true }),
      bookings().find({ customerId: c._id }, {
        projection: { channel: 1, declarationStatus: 1, warehouseStatus: 1, status: 1, requestedTime: 1, customerName: 1, notes: 1 }
      }).toArray(),
      customers().find({ linkedCustomerId: c._id }, { projection: { name: 1, sessionId: 1, createdAt: 1 } }).toArray()
    ]);

    // Staff-only fields the customer-shaped booking leaves out.
    const rawById = new Map(rawBookings.map(b => [String(b._id), b]));
    const staffBookings = bookingList.map(b => {
      const raw = rawById.get(b.id) || {};
      return {
        ...b,
        channel: raw.channel || null,
        rawStatus: raw.status || null,
        declarationStatus: raw.declarationStatus === 'received' ? 'received' : 'not_received',
        warehouseStatus: raw.warehouseStatus === 'received' ? 'received' : 'not_received',
        staffNotes: raw.notes || null
      };
    });

    const chatIds = chatSessions.map(s => s._id);
    const chatCounts = chatIds.length
      ? await messages().aggregate([
          { $match: { customerId: { $in: chatIds } } },
          { $group: { _id: '$customerId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } }
        ]).toArray()
      : [];
    const chatBy = new Map(chatCounts.map(r => [String(r._id), r]));

    const address = c.address || {};
    res.json({
      customer: {
        ...accountSummary(c),
        address: {
          line1: address.line1 || '',
          suburb: address.suburb || '',
          state: address.state || '',
          postcode: address.postcode || ''
        },
        contactPreference: c.contactPreference || 'whatsapp',
        createdAt: c.createdAt || null,
        profileUpdatedAt: c.profileUpdatedAt || null,
        phoneVerifiedAt: c.phoneVerifiedAt || null,
        passwordUpdatedAt: c.passwordUpdatedAt || null,
        staffNotes: c.notes || null,
        previousPhoneNumbers: (c.previousPhoneNumbers || []).map(p => ({ phoneNumber: p.phoneNumber, changedAt: p.changedAt || null }))
      },
      bookings: staffBookings,
      shipments: shipmentList,
      chatSessions: chatSessions
        .map(s => ({
          id: String(s._id),
          startedAt: s.createdAt || null,
          messageCount: (chatBy.get(String(s._id)) || {}).count || 0,
          lastMessageAt: (chatBy.get(String(s._id)) || {}).lastAt || null
        }))
        .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
    });
  }));

  router.patch('/customers/:customerId', wrap(async (req, res) => {
    const c = await loadAccount(req, res);
    if (!c) return;
    const parsed = profileUpdateFromBody(req.body || {});
    if (parsed.error) return res.status(400).json(parsed);
    if (Object.keys(parsed.set).length === 0) return res.status(400).json({ error: 'Nothing to save' });
    if (parsed.set.email && await emailTakenByOtherAccount(parsed.set.email, c._id)) {
      return res.status(409).json({ error: 'This email is already used by another My Transco account', field: 'email' });
    }
    await customers().updateOne(
      { _id: c._id },
      { $set: { ...parsed.set, profileUpdatedAt: new Date(), profileUpdatedByStaff: req.user.email || true } }
    );
    res.json({ success: true });
  }));

  // Staff confirmed the number belongs to this person (e.g. they called
  // from it): connects the full history on the number to their account.
  router.post('/customers/:customerId/verify-phone', wrap(async (req, res) => {
    const c = await loadAccount(req, res);
    if (!c) return;
    await customers().updateOne(
      { _id: c._id },
      { $set: { phoneVerified: true, phoneVerifiedAt: new Date(), phoneVerifiedByStaff: req.user.email || true } }
    );
    res.json({ success: true });
  }));

  // The customer has a new mobile number (they called in; staff confirmed
  // it's them). Everything stays on the same record — bookings, BLs,
  // chats — and the new number becomes their sign-in and WhatsApp match.
  // Refused if the new number already belongs to another customer, so two
  // people's histories are never merged by accident.
  router.post('/customers/:customerId/change-phone', wrap(async (req, res) => {
    const c = await loadAccount(req, res);
    if (!c) return;
    const countryCode = String((req.body || {}).countryCode || '61');
    if (!['61', '94', '91'].includes(countryCode)) {
      return res.status(400).json({ error: 'Choose Australia (+61), Sri Lanka (+94) or India (+91)' });
    }
    let digits = String((req.body || {}).phone || '').replace(/\D/g, '');
    if (digits.startsWith(countryCode) && digits.length > 10) digits = digits.slice(countryCode.length);
    const phoneNumber = normalizePhoneNumber(digits, countryCode);
    if (!phoneNumber) return res.status(400).json({ error: "That phone number doesn't look right" });
    if (phoneNumber === c.phoneNumber) return res.status(400).json({ error: 'That is already their number' });

    const other = await customers().findOne({ phoneNumber }, { projection: { name: 1, customerCode: 1 } });
    if (other) {
      return res.status(409).json({
        error: `+${phoneNumber} already belongs to another customer (${other.customerCode || other.name || 'no name'}). Nothing was changed.`,
        otherCustomerId: String(other._id)
      });
    }

    const now = new Date();
    try {
      await customers().updateOne(
        { _id: c._id },
        {
          $set: { phoneNumber, phoneVerified: true, phoneVerifiedAt: now, phoneChangedAt: now, phoneChangedByStaff: req.user.email || true },
          $push: { previousPhoneNumbers: { phoneNumber: c.phoneNumber, changedAt: now } },
          // Signed-in sessions stay valid (it's the same person); only
          // the number they sign in with changes.
          $unset: { portalLockedUntil: '' }
        }
      );
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ error: `+${phoneNumber} already belongs to another customer. Nothing was changed.` });
      }
      throw err;
    }
    res.json({ success: true, phoneNumber });
  }));

  router.post('/customers/:customerId/sign-out', wrap(async (req, res) => {
    const c = await loadAccount(req, res);
    if (!c) return;
    await customers().updateOne({ _id: c._id }, { $inc: { portalTokenVersion: 1 } });
    res.json({ success: true });
  }));

  router.post('/customers/:customerId/unlock', wrap(async (req, res) => {
    const c = await loadAccount(req, res);
    if (!c) return;
    await customers().updateOne({ _id: c._id }, { $set: { portalLoginFailures: 0 }, $unset: { portalLockedUntil: '' } });
    res.json({ success: true });
  }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    console.error('My Transco staff route error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return router;
};
