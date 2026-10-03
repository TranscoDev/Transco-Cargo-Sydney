// ============================================================
// WALK-IN DROP-OFFS — Saturday (or any) customers who arrive without a
// booking fill the declaration on their own phone (QR code at the counter
// → dropoff.html on the website). It replaces the outside Fillout form so
// walk-ins land in the CRM like every other booking.
// ============================================================
//
// Public:  POST /api/public/dropoff          (customer's phone, rate-limited)
// Staff:   POST /api/walk-ins/:bookingId/finalise
//
// A submission is only a CLAIM until staff finalise it at the counter:
// the link is public, so nothing is linked to (or creates) a customer
// record, and nothing counts as dropped off, until a staff member has
// checked the boxes. Finalise then links the booking to the customer by
// phone number (creating them if new), assigns the BL number (the
// declaration is confirmed once its BL is assigned), records weight/CBM/
// office-use charges, marks it received, and emails the customer their
// copy with their BL number.

const express = require('express');
const { ObjectId } = require('mongodb');
const { customers, bookings, shipments } = require('./db');
const {
  validatePerson, validateItems, validateContents, validateSignOff, validateDangerousGoods, validateLithiumDoc, cleanText, hasRealName,
  COUNTRIES, SERVICE_LABELS, ITEM_TYPES, ITEM_LABELS, DELIVERY_LABELS, itemDetail
} = require('./customerTools');
const { normalizePhoneNumber } = require('./normalizePhone');
const { shippingDeclarationPdf, declarationFileName, allFormsPdf, formAttachments, singleFormPdf, formsFor, refOf } = require('./formsPdf');

const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_SUBMISSIONS = Number(process.env.WALKIN_IP_LIMIT) || 8;

// ---------- small helpers ----------

const ipHits = new Map();
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}
function tooManyFromIp(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (ipHits.get(ip) || []).filter(t => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_MAX_SUBMISSIONS) {
    ipHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  // Keep the map from growing forever.
  if (ipHits.size > 5000) {
    for (const [key, times] of ipHits) if (!times.some(t => now - t < IP_WINDOW_MS)) ipHits.delete(key);
  }
  return false;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function money(n) {
  return typeof n === 'number' ? `$${n.toFixed(2).replace(/\.00$/, '')}` : '';
}

// "Unit 3, 18 Sorrell St" etc. never needs more than one line here.
function oneLine(value, max) {
  return cleanText(String(value || '').replace(/\s*\n\s*/g, ', '), max);
}

// ---------- validation ----------

// Staff's value for each item, in list order. Every item needs one
// (0 is allowed) before a walk-in can be confirmed.
function validateContentValues(raw, contents) {
  if (!Array.isArray(raw) || raw.length !== contents.length) {
    return { error: 'Enter a value for every item before confirming.', field: 'contentValues' };
  }
  const values = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    const n = v === '' || v === null || v === undefined ? NaN : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      return { error: `Enter the value of "${contents[i].description}" in dollars.`, field: 'contentValues', index: i };
    }
    values.push(Math.round(n * 100) / 100);
  }
  return { value: values };
}

function validateDropOff(input) {
  const body = input || {};
  const country = body.country;
  if (!COUNTRIES[country]) return { error: 'Please choose where you are sending to.', field: 'country' };
  const serviceType = body.service;
  if (!COUNTRIES[country].services.includes(serviceType)) return { error: 'Please choose Sea or Air freight.', field: 'service' };

  const sender = validatePerson(body.sender, 'sender', { idNumber: country === 'sri_lanka' ? 'required' : 'optional', homePhone: true });
  if (sender.error) return sender;
  const receiver = validatePerson(body.receiver, 'receiver', { withId: true, homePhone: true });
  if (receiver.error) return receiver;

  const items = validateItems(country, body.items, { requireDetails: true });
  if (items.error) return { error: items.error, field: 'items' };

  if (!DELIVERY_LABELS[body.deliveryType]) return { error: 'Please choose door delivery or collection.', field: 'deliveryType' };

  const contents = validateContents(body.contents);
  if (contents.error) return contents;

  const signOff = validateSignOff(body);
  if (signOff.error) return signOff;
  let dangerousGoods = null;
  if (serviceType === 'air') {
    const dg = validateDangerousGoods(body.dangerousGoods, { requireAck: true });
    if (dg.error) return dg;
    dangerousGoods = dg.value;
  }

  const notes = typeof body.notes === 'string' ? oneLine(body.notes, 300) : '';

  return {
    value: {
      country, serviceType,
      sender: sender.value, receiver: receiver.value,
      items: items.value, deliveryType: body.deliveryType,
      contents: contents.value, insurance: signOff.value.insurance,
      signedName: signOff.value.signedName, signatureImage: signOff.value.signatureImage, dangerousGoods, notes: notes || null
    }
  };
}

function numberOrNull(v, label) {
  if (v === undefined || v === null || v === '') return { value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) return { error: `${label} must be a number of 0 or more.` };
  return { value: Math.round(n * 1000) / 1000 };
}

// ---------- email ----------

function itemsLine(items) {
  return items.map(i => {
    const [one, many] = ITEM_LABELS[i.type] || [i.type, i.type];
    return `${i.qty} ${i.qty === 1 ? one : many}${itemDetail(i)}`;
  }).join(', ');
}

function summaryHtml(b) {
  const person = (title, p, withId) => p ? `
    <h3 style="margin:16px 0 4px;font-size:14px">${title}</h3>
    <p style="margin:0;line-height:1.5">${esc(p.fullName)}<br>${esc([p.address, p.town].filter(Boolean).join(', '))}<br>
    Mobile: ${esc(p.mobile)}${p.homePhone ? ` · Home: ${esc(p.homePhone)}` : ''}<br>Email: ${esc(p.email)}
    ${p.idNumber ? `<br>Passport / NIC: ${esc(p.idNumber)}` : ''}</p>` : '';
  const rows = (b.contents || []).map((c, i) =>
    `<tr><td style="padding:4px 8px;border:1px solid #ddd">${i + 1}</td><td style="padding:4px 8px;border:1px solid #ddd">${esc(c.description)} (${c.condition})</td>` +
    `<td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${c.qty}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${money(c.value)}</td></tr>`
  ).join('');
  return `
    ${b.hblNumber ? `<p style="margin:0 0 4px"><strong>BL number:</strong> ${esc(b.hblNumber)}</p>` : ''}
    <p style="margin:0 0 4px"><strong>Form no.:</strong> ${esc(b.bookingCode)}</p>
    <p style="margin:0 0 4px"><strong>Sending to:</strong> ${esc(COUNTRIES[b.country] ? COUNTRIES[b.country].label : '')} · ${esc(SERVICE_LABELS[b.serviceType] || '')} · ${esc(DELIVERY_LABELS[b.deliveryType] || '')}</p>
    <p style="margin:0 0 4px"><strong>Boxes:</strong> ${esc(itemsLine(b.items || []))}</p>
    <p style="margin:0 0 4px"><strong>Insurance wanted:</strong> ${b.insurance ? 'Yes' : 'No'}</p>
    ${person('Sender', b.sender, false)}
    ${person('Receiver', b.receiver, true)}
    <h3 style="margin:16px 0 4px;font-size:14px">What's inside</h3>
    <table style="border-collapse:collapse;font-size:13px"><tr><th style="padding:4px 8px;border:1px solid #ddd">#</th><th style="padding:4px 8px;border:1px solid #ddd">Item</th><th style="padding:4px 8px;border:1px solid #ddd">Qty</th><th style="padding:4px 8px;border:1px solid #ddd">Value</th></tr>${rows}</table>`;
}

// ---------- routers ----------

module.exports = function createWalkInRouters({
  tools, assignBl, getSydneyNow, broadcast, withoutSignInSecrets, sendEmail, staffEmail
}) {
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ----- public: the customer's phone -----
  const publicRouter = express.Router();

  // What the form offers — box types per country, from the same lists
  // the online booking form uses.
  publicRouter.get('/dropoff/options', (req, res) => {
    res.json({
      countries: Object.entries(COUNTRIES).map(([key, c]) => ({
        key,
        label: c.label,
        services: c.services.map(s => ({ key: s, label: SERVICE_LABELS[s] })),
        itemTypes: ITEM_TYPES[key].map(t => ({ key: t, label: ITEM_LABELS[t][0] }))
      })),
      deliveryTypes: Object.entries(DELIVERY_LABELS).map(([key, label]) => ({ key, label }))
    });
  });

  publicRouter.post('/dropoff', wrap(async (req, res) => {
    if (tooManyFromIp(req)) {
      return res.status(429).json({ error: 'Too many forms sent from this phone. Please ask our staff for help.' });
    }
    const checked = validateDropOff(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error, field: checked.field || null });
    const v = checked.value;

    const now = new Date();
    const sydney = getSydneyNow();
    const pad = n => String(n).padStart(2, '0');
    const dateISO = `${sydney.getUTCFullYear()}-${pad(sydney.getUTCMonth() + 1)}-${pad(sydney.getUTCDate())}`;
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][sydney.getUTCDay()];
    const phoneNumber = normalizePhoneNumber(v.sender.mobile) || v.sender.mobile.replace(/\D/g, '');
    // Staff-only hint for the Walk-ins page ("Returning" vs "New") — nothing
    // is linked and nothing about that customer is sent back to the phone.
    const returning = Boolean(await customers().findOne({ phoneNumber }, { projection: { _id: 1 } }));

    const booking = {
      bookingCode: await tools.newBookingCode(),
      // Linked to a customer only when staff finalise — see top of file.
      customerId: null,
      customerName: v.sender.fullName,
      phoneNumber,
      requestedDay: dayName,
      requestedTime: `${pad(sydney.getUTCHours())}:${pad(sydney.getUTCMinutes())}`,
      requestedDateISO: dateISO,
      boxSummary: tools.itemsSummary(v.items),
      country: v.country,
      serviceType: v.serviceType,
      origin: 'Sydney',
      destination: v.receiver.town,
      deliveryType: v.deliveryType,
      items: v.items,
      boxCount: v.items.reduce((n, i) => n + i.qty, 0),
      customerNotes: v.notes,
      sender: v.sender,
      senderIsAccountHolder: true,
      receiver: v.receiver,
      contents: v.contents,
      insurance: v.insurance,
      declarationAccepted: true,
      signature: { name: v.signedName, image: v.signatureImage, signedAt: now },
      ...(v.dangerousGoods ? { dangerousGoods: v.dangerousGoods } : {}),
      declarationSubmittedAt: now,
      declarationStatus: 'not_received',
      warehouseStatus: 'not_received',
      channel: 'walk_in',
      walkIn: { status: 'submitted', submittedAt: now, returning },
      status: 'pending',
      createdAt: now
    };

    const { insertedId } = await bookings().insertOne(booking);
    booking._id = insertedId;

    // Live in the console straight away (no signature image — it's only
    // loaded when the booking is opened or printed).
    const { signature, ...forList } = booking;
    broadcast('booking.created', { ...forList, signature: { name: signature.name }, resolvedDate: dateISO });

    // No email here: the office gets the forms only when staff click
    // "Send email" after the BL is assigned (see /:bookingId/send-email).
    res.status(201).json({ bookingCode: booking.bookingCode, submittedAt: now });
  }));

  // ----- staff: finalise at the counter -----
  const staffRouter = express.Router();

  staffRouter.post('/:bookingId/finalise', wrap(async (req, res) => {
    const { bookingId } = req.params;
    if (!ObjectId.isValid(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    const _id = new ObjectId(bookingId);
    const b = await bookings().findOne({ _id });
    // Walk-ins, and any booking whose full declaration was filled online
    // (My Transco) — staff confirm both the same way at drop-off.
    const isWalkIn = Boolean(b && b.channel === 'walk_in');
    const hasDeclaration = Boolean(b && b.declarationSubmittedAt && Array.isArray(b.contents) && b.contents.length);
    if (!b || (!isWalkIn && !hasDeclaration)) return res.status(404).json({ error: 'No declaration to confirm on this booking' });
    if (b.status === 'cancelled') return res.status(400).json({ error: 'This booking was cancelled. Restore it first.' });

    // Only what's sent is changed, so finalising again to fix one figure
    // never wipes the others.
    const body = req.body || {};
    const weight = 'weight' in body ? numberOrNull(body.weight, 'Weight') : { value: b.weight ?? null };
    const cbm = 'cbm' in body ? numberOrNull(body.cbm, 'CBM') : { value: b.cbm ?? null };
    if (weight.error || cbm.error) return res.status(400).json({ error: weight.error || cbm.error });

    const sentOffice = body.officeUse && typeof body.officeUse === 'object' ? body.officeUse : null;
    const office = { ...(b.officeUse || {}) };
    if (sentOffice) {
      for (const [key, label] of [['freight', 'Freight'], ['pickup', 'Pickup'], ['doorToDoor', 'D to D'], ['discount', 'Discount'], ['total', 'Total due']]) {
        const n = numberOrNull(sentOffice[key], label);
        if (n.error) return res.status(400).json({ error: n.error });
        office[key] = n.value;
      }
      // Total = freight + pickup + D to D − discount, unless staff typed one.
      if (office.total === null && [office.freight, office.pickup, office.doorToDoor].some(n => n !== null && n !== undefined)) {
        office.total = Math.round(((office.freight || 0) + (office.pickup || 0) + (office.doorToDoor || 0) - (office.discount || 0)) * 100) / 100;
      }
    }
    const collectionCentre = 'collectionCentre' in body ? (oneLine(body.collectionCentre, 60) || null) : (b.collectionCentre || null);

    // Staff value every item (the customer never enters values) — and can
    // change the list itself at the counter (the customer adds or takes out
    // something), plus the insurance answer. Changes are logged.
    let contents = (b.contents || []).map(c => ({ ...c }));
    const staffChanged = [];
    if (Array.isArray(body.contents)) {
      const list = validateContents(body.contents);
      if (list.error) return res.status(400).json(list);
      const values = validateContentValues(body.contents.map(c => (c ? c.value : null)), list.value);
      if (values.error) return res.status(400).json(values);
      const edited = list.value.map((c, i) => ({ ...c, value: values.value[i] }));
      const sameItems = edited.length === contents.length && edited.every((c, i) =>
        c.description === contents[i].description && c.condition === contents[i].condition && c.qty === contents[i].qty);
      if (!sameItems) staffChanged.push('items inside');
      contents = edited;
    } else if ('contentValues' in body) {
      const values = validateContentValues(body.contentValues, contents);
      if (values.error) return res.status(400).json(values);
      values.value.forEach((v, i) => { contents[i].value = v; });
    }
    if (!contents.length) return res.status(400).json({ error: 'Add at least one item that is inside the boxes.', field: 'contents' });
    const missing = contents.findIndex(c => typeof c.value !== 'number');
    if (missing !== -1) {
      return res.status(400).json({ error: `Enter the value of "${contents[missing].description}" before confirming.`, field: 'contentValues', index: missing });
    }
    let insurance = typeof b.insurance === 'boolean' ? b.insurance : null;
    if (typeof body.insurance === 'boolean' && body.insurance !== insurance) {
      insurance = body.insurance;
      staffChanged.push('insurance');
    }

    // The declaration is confirmed once its BL is assigned, so the first
    // Finalise needs the BL number. It's checked BEFORE anything changes
    // (format, already used, shipment number), so a typo never leaves a
    // half-finalised walk-in behind.
    const existingShipment = await shipments().findOne({ bookingId: _id });
    const hasBl = Boolean(existingShipment && (existingShipment.hblNumber || existingShipment.blNumber));
    const blInput = typeof body.hblNumber === 'string' ? body.hblNumber.trim() : '';
    if (!hasBl && !blInput) {
      return res.status(400).json({ error: 'Enter the BL number — the declaration is confirmed once its BL is assigned.', field: 'hblNumber' });
    }
    const blRequest = blInput ? { hblNumber: blInput, batchNumber: body.batchNumber } : null;
    if (blRequest) {
      const check = await assignBl(b, blRequest, { dryRun: true });
      if (check.error) return res.status(check.status).json({ error: check.error, field: 'hblNumber' });
    }

    // Link to the customer by the sender's phone — the same one-customer-
    // per-phone rule as WhatsApp and My Transco. New number → new customer.
    // Every confirmed walk-in customer gets a My Transco account (they sign
    // in with their mobile number + a WhatsApp code, no password needed),
    // and their profile is brought up to date with the details staff just
    // checked at the counter.
    // An online booking is already linked to its My Transco account (and
    // its sender may be someone else), so only walk-ins are linked here.
    let customer = null;
    const phoneNumber = isWalkIn ? normalizePhoneNumber(b.sender && b.sender.mobile) : null;
    if (phoneNumber) {
      const now = new Date();
      const result = await customers().findOneAndUpdate(
        { phoneNumber },
        {
          $setOnInsert: {
            phoneNumber,
            mode: 'CHATBOT',
            status: 'ACTIVE',
            createdAt: now,
            acquisitionSource: 'walk_in'
          },
          $addToSet: { sources: { $each: ['walk_in', 'portal'] } }
        },
        { upsert: true, returnDocument: 'after' }
      );
      customer = result;
      const fill = {
        name: b.sender.fullName,
        address: { line1: b.sender.address, suburb: '', state: '', postcode: '' }
      };
      if (!customer.portalJoinedAt) fill.portalJoinedAt = now;
      // Email signs in to My Transco too — never take one another account uses.
      if (b.sender.email && b.sender.email !== customer.email) {
        const taken = await customers().findOne({ email: b.sender.email, _id: { $ne: customer._id }, channel: { $ne: 'website' } }, { projection: { _id: 1 } });
        if (!taken) fill.email = b.sender.email;
      }
      await customers().updateOne({ _id: customer._id }, { $set: fill });
      Object.assign(customer, fill);
      try {
        await tools.ensureCustomerCode(customer);
      } catch (err) {
        console.error('Customer code for walk-in failed:', err.message);
      }
      try {
        await tools.rememberDeclarationDetails(customer, { sender: b.sender, senderIsMe: true, receiver: b.receiver, country: b.country });
      } catch (err) {
        console.error('Saving walk-in declaration details failed:', err.message);
      }
      broadcast('customer.contact_updated', { customerId: customer._id, customer: withoutSignInSecrets(customer) });
    }

    const now = new Date();
    const confirmedBefore = isWalkIn ? Boolean(b.walkIn && b.walkIn.status === 'finalised') : Boolean(b.staffConfirm && b.staffConfirm.status === 'finalised');
    const firstTime = !confirmedBefore;
    const by = req.user && req.user.email ? req.user.email : 'staff';
    const confirmedAt = firstTime ? now : ((isWalkIn ? b.walkIn.finalisedAt : b.staffConfirm.finalisedAt) || now);
    const set = {
      weight: weight.value,
      cbm: cbm.value,
      officeUse: office,
      collectionCentre,
      contents,
      status: 'completed',
      warehouseStatus: 'received',
      declarationStatus: 'received',
      ...(isWalkIn
        ? { 'walkIn.status': 'finalised', 'walkIn.finalisedAt': confirmedAt, 'walkIn.finalisedBy': by }
        : { staffConfirm: { status: 'finalised', finalisedAt: confirmedAt, finalisedBy: by } }),
      ...(sentOffice && typeof office.total === 'number' ? { price: office.total } : {})
    };
    if (customer) {
      set.customerId = customer._id;
      set.customerName = hasRealName(customer) ? customer.name : b.sender.fullName;
      set.phoneNumber = customer.phoneNumber;
    }

    // Assign the BL (creates/updates this customer's shipment) — needs the
    // customer link, so it comes after it and before the booking is marked done.
    let hblNumber = hasBl ? (existingShipment.hblNumber || existingShipment.blNumber) : null;
    let shipmentId = existingShipment ? String(existingShipment._id) : (b.shipmentId || null);
    if (blRequest) {
      const assigned = await assignBl({ ...b, customerId: customer ? customer._id : b.customerId }, blRequest);
      if (assigned.error) return res.status(assigned.status).json({ error: assigned.error, field: 'hblNumber' });
      hblNumber = assigned.shipment.hblNumber;
      shipmentId = String(assigned.shipment._id);
    }

    if (insurance !== null) set.insurance = insurance;
    const update = { $set: set };
    if (staffChanged.length) {
      update.$set.staffEditedAt = now;
      update.$push = { staffEdits: { $each: [{ at: now, by, changed: staffChanged }], $slice: -50 } };
    }
    await bookings().updateOne({ _id }, update);

    broadcast('booking.walk_in_finalised', {
      _id: bookingId,
      customerId: customer ? String(customer._id) : null,
      customerName: set.customerName || b.customerName,
      phoneNumber: set.phoneNumber || b.phoneNumber,
      weight: set.weight,
      cbm: set.cbm,
      price: set.price ?? b.price ?? null,
      shipmentId,
      hblNumber,
      staffConfirmed: true,
      status: 'completed',
      warehouseStatus: 'received',
      declarationStatus: 'received'
    });

    // No email to the customer. Staff send the forms to the office inbox
    // themselves with "Send email" (below).
    res.json({ ok: true, customerId: customer ? String(customer._id) : null, hblNumber, shipmentId, firstTime });
  }));

  // ----- staff: the filled forms, for any booking -----
  // Mounted at /api/forms (behind staff auth).
  const formsRouter = express.Router();

  async function loadForPrint(req, res) {
    const d = await tools.getDeclarationForPrint(req.params.bookingId);
    if (!d) { res.status(404).json({ error: 'Booking not found' }); return null; }
    return d;
  }

  // The filled Shipping Declaration — what the console's Print opens.
  formsRouter.get('/:bookingId/declaration.pdf', wrap(async (req, res) => {
    const d = await loadForPrint(req, res);
    if (!d) return;
    const pdf = await shippingDeclarationPdf(d);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${declarationFileName(d)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }));

  // Every form this booking gets (declaration, + UPB and delivery
  // agreement for Sri Lanka, + packing list for India) — what Print opens.
  formsRouter.get('/:bookingId/forms.pdf', wrap(async (req, res) => {
    const d = await loadForPrint(req, res);
    if (!d) return;
    const pdf = await allFormsPdf(d);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Transco-forms-${refOf(d)}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }));

  // Air Freight: staff update the dangerous goods answers (the customer
  // changed something at the counter) and choose the lithium battery
  // configuration for the transport document. Logged like other edits.
  formsRouter.put('/:bookingId/dangerous-goods', wrap(async (req, res) => {
    const { bookingId } = req.params;
    if (!ObjectId.isValid(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    const _id = new ObjectId(bookingId);
    const b = await bookings().findOne({ _id });
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (b.serviceType !== 'air') return res.status(400).json({ error: 'Dangerous goods forms are for Air Freight bookings.' });
    const body = req.body || {};
    const set = {};
    const changed = [];
    if ('dangerousGoods' in body) {
      const dg = validateDangerousGoods(body.dangerousGoods);
      if (dg.error) return res.status(400).json(dg);
      set.dangerousGoods = dg.value;
      changed.push('dangerous goods');
    }
    if ('lithiumDoc' in body) {
      const l = validateLithiumDoc(body.lithiumDoc);
      if (l.error) return res.status(400).json(l);
      set.lithiumDoc = l.value;
      changed.push('lithium battery document');
    }
    if (!changed.length) return res.status(400).json({ error: 'Nothing to save.' });
    const now = new Date();
    const by = req.user && req.user.email ? req.user.email : 'staff';
    await bookings().updateOne({ _id }, {
      $set: { ...set, staffEditedAt: now },
      $push: { staffEdits: { $each: [{ at: now, by, changed }], $slice: -50 } }
    });
    res.json({ ok: true });
  }));

  // Which forms this booking gets, for the console's Forms list.
  formsRouter.get('/:bookingId/list', wrap(async (req, res) => {
    const d = await loadForPrint(req, res);
    if (!d) return;
    res.json({ forms: formsFor(d).map(x => ({ key: x.key, title: x.title })) });
  }));

  // One form on its own (preview / print just that one).
  formsRouter.get('/:bookingId/forms/:key', wrap(async (req, res) => {
    const d = await loadForPrint(req, res);
    if (!d) return;
    const one = await singleFormPdf(d, req.params.key);
    if (!one) return res.status(404).json({ error: 'This booking does not have that form.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${one.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(one.content);
  }));

  // "Send email": the office inbox only (never the customer), only once
  // the BL is assigned, with the filled forms attached. Staff can send it
  // again (e.g. after a correction); every send is recorded.
  formsRouter.post('/:bookingId/send-email', wrap(async (req, res) => {
    const d = await loadForPrint(req, res);
    if (!d) return;
    if (!d.blNumber) return res.status(400).json({ error: 'Assign the BL number first — the forms are sent once the BL is assigned.' });
    const files = await formAttachments(d);
    const name = d.sender ? d.sender.fullName : (d.customer && d.customer.name) || 'Customer';
    const booking = await bookings().findOne({ _id: new ObjectId(d.bookingId) });
    let sent;
    try {
      sent = await sendEmail({
        to: staffEmail,
        subject: `BL ${d.blNumber} — ${name} — forms`,
        html: `<p><strong>BL ${esc(d.blNumber)}</strong> — forms for ${esc(name)}, attached as PDF: ${files.map(f => esc(f.filename)).join(', ')}.</p>${summaryHtml({ ...booking, hblNumber: d.blNumber })}`,
        attachments: files.map(f => ({ filename: f.filename, content: f.content.toString('base64') }))
      });
    } catch (err) {
      console.error('Forms email failed:', err.response && err.response.data ? JSON.stringify(err.response.data) : err.message);
      return res.status(502).json({ error: 'The email service refused the email, so nothing was sent. Please try again in a minute.' });
    }
    if (!sent) return res.status(503).json({ error: 'Email sending is not set up on the server, so nothing was sent.' });
    const entry = { at: new Date(), by: req.user && req.user.email ? req.user.email : 'staff', to: staffEmail, files: files.map(f => f.filename) };
    await bookings().updateOne({ _id: booking._id }, { $push: { formEmails: { $each: [entry], $slice: -20 } } });
    res.json({ ok: true, sentAt: entry.at, to: staffEmail });
  }));

  return { publicRouter, staffRouter, formsRouter };
};

module.exports.validateDropOff = validateDropOff;
