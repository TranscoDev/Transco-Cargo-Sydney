// ============================================================
// CUSTOMER TOOLS — the only way customer-facing code (My Transco
// portal routes and the signed-in web chat) reads or writes a
// customer's own operational data.
// ============================================================
//
// Every function takes the customer's _id as resolved from the signed
// session (see customerAuth.js) — never an id supplied by the browser or
// produced by the LLM — and every query is filtered by it, so one
// customer can never reach another customer's booking/BL/shipment even
// by guessing a valid record id: a record that exists but belongs to
// someone else is indistinguishable from one that doesn't exist (null).
//
// Results are SHAPED for customers: human labels, no internal fields
// (no staff notes, no receiver phone numbers, no other customers in the
// same batch). A progress step is only marked done when a stored field
// confirms it — nothing here guesses at a status.
//
// Data model reused as-is (nothing duplicated):
//   customers (one per phone)  ->  bookings (customerId)
//     ->  shipments (customerId, bookingId, hblNumber = this customer's own BL)
//       ->  consolidations (the bulk shipment / batch holding many BLs)

const { ObjectId } = require('mongodb');
const {
  customers, bookings, shipments, consolidations, nextSequence
} = require('./db');

const DECLARATION_FORM_URL = 'https://transcosydney.com.au/declaration-form';

const COUNTRIES = {
  sri_lanka: { label: 'Sri Lanka', services: ['sea', 'air'] },
  india: { label: 'India', services: ['sea'] }
};

const SERVICE_LABELS = { sea: 'Sea Freight', air: 'Air Freight' };

// Same box vocabularies the pricing tool uses (see input_schema_LATEST.json
// box_type), plus "other" for anything that isn't a standard box.
const ITEM_TYPES = {
  sri_lanka: ['tea_chest', 'gift_box', 'wine_box', 'quarter_cbm', 'tv', 'other'],
  india: ['general', 'tea_chest', 'quarter_cbm', 'other']
};

const ITEM_LABELS = {
  tea_chest: ['Tea Chest', 'Tea Chests'],
  gift_box: ['Gift Box', 'Gift Boxes'],
  wine_box: ['Wine Box', 'Wine Boxes'],
  quarter_cbm: ['Quarter CBM box', 'Quarter CBM boxes'],
  tv: ['TV', 'TVs'],
  general: ['General cargo box', 'General cargo boxes'],
  other: ['Odd-size item', 'Odd-size items']
};

const DELIVERY_LABELS = {
  door: 'Door delivery',
  collect: 'Collect from the destination warehouse'
};

// Declaration details collected in the booking form (they replace the
// external declaration form for bookings made online). Every field is
// required. The account's own sender details are remembered on the
// customer record; receivers are kept as a small address book so a
// repeat receiver is one tap next time.
const MAX_SAVED_RECEIVERS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same hours the bot quotes (calculate_price_LATEST.js): Saturday
// 11am-3pm walk-in, Tue-Fri 5-6pm by appointment with a daily cap.
const DROP_OFF_SLOTS = {
  saturday: ['11:00', '12:00', '13:00', '14:00'],
  weekday: ['17:00', '17:30']
};
const WEEKDAY_DAILY_CAP = 3;
const BOOKING_WINDOW_DAYS = 14;

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Ordered — a later status means every earlier stage has been passed,
// because staff move a shipment forward through these one at a time.
const SHIPMENT_STATUS_ORDER = [
  'booked', 'cargo_received', 'at_warehouse', 'loaded',
  'in_transit', 'arrived', 'customs', 'ready_for_collection', 'delivered'
];

const SHIPMENT_STATUS_LABELS = {
  booked: 'Booked',
  cargo_received: 'Received at our Sydney warehouse',
  at_warehouse: 'At our Sydney warehouse',
  loaded: 'Loaded into the container',
  in_transit: 'On the way',
  arrived: 'Arrived at the destination port',
  customs: 'Clearing customs',
  ready_for_collection: 'Ready for collection',
  delivered: 'Delivered'
};

function pad6(n) {
  return String(n).padStart(6, '0');
}

function statusIndex(status) {
  return SHIPMENT_STATUS_ORDER.indexOf(status);
}

// A customer created by WhatsApp with no profile name gets their phone
// number as `name`; a web visitor gets "Website Visitor #XXXX". Neither
// is something to greet a person with.
function hasRealName(customer) {
  const name = (customer.name || '').trim();
  if (!name) return false;
  if (name === customer.phoneNumber) return false;
  if (/^website visitor/i.test(name)) return false;
  if (/^\+?\d[\d\s-]+$/.test(name)) return false;
  return true;
}

// False only for a password sign-up that hasn't proven the number yet
// (records created any other way — WhatsApp, a WhatsApp code, staff,
// import — predate or imply proof, and carry no flag at all).
function hasVerifiedPhone(customer) {
  return customer.phoneVerified !== false;
}

function toObjectId(id) {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[ \t]+/g, ' ').slice(0, max);
}

// One person on the declaration. `withId` adds the town + Passport/NIC
// number (receivers). `idNumber` ('required' | 'optional') asks a sender
// for their Passport/NIC too, and `homePhone` adds the optional "Home"
// number from the paper form (both used by the walk-in drop-off form).
// Returns { error, field } or { value }.
function validatePerson(raw, who, { withId = false, idNumber = null, homePhone = false } = {}) {
  const p = raw || {};
  const fullName = cleanText(p.fullName, 80);
  if (fullName.length < 2) return { error: `Please enter the ${who}'s full name as on their passport or NIC.`, field: `${who}.fullName` };
  const address = cleanText(p.address, 200).replace(/\s*\n\s*/g, ', ');
  if (address.length < 5) return { error: `Please enter the ${who}'s full address.`, field: `${who}.address` };
  const mobile = cleanText(p.mobile, 24);
  const digits = mobile.replace(/[^\d]/g, '');
  if (!/^\+?[\d\s()-]+$/.test(mobile) || digits.length < 7 || digits.length > 15) {
    return { error: `Please enter the ${who}'s mobile number (digits only, with country code if outside Australia).`, field: `${who}.mobile` };
  }
  const email = cleanText(p.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: `Please enter the ${who}'s email address.`, field: `${who}.email` };
  const value = { fullName, address, mobile, email };
  if (withId) {
    const town = cleanText(p.town, 60);
    if (town.length < 2) return { error: "Please enter the receiver's town or city.", field: `${who}.town` };
    const idNumber = cleanText(p.idNumber, 20).replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(idNumber)) return { error: "Please enter the receiver's passport or NIC number (letters and numbers only).", field: `${who}.idNumber` };
    value.town = town;
    value.idNumber = idNumber;
  } else if (idNumber) {
    const id = cleanText(p.idNumber, 20).replace(/\s/g, '').toUpperCase();
    if (id || idNumber === 'required') {
      if (!/^[A-Z0-9]{5,20}$/.test(id)) return { error: `Please enter the ${who}'s passport or NIC number (letters and numbers only).`, field: `${who}.idNumber` };
      value.idNumber = id;
    }
  }
  if (homePhone) {
    const home = cleanText(p.homePhone, 24);
    if (home) {
      const homeDigits = home.replace(/[^\d]/g, '');
      if (!/^\+?[\d\s()-]+$/.test(home) || homeDigits.length < 7 || homeDigits.length > 15) {
        return { error: `Please check the ${who}'s home phone number, or leave it empty.`, field: `${who}.homePhone` };
      }
      value.homePhone = home;
    }
  }
  return { value };
}

// A TV's screen-size band and an odd-size item's length × width × height
// (cm) — they set the price, so the online booking asks for them. The
// bands are the bot's TV price list (calculate_price_LATEST.js); "other"
// (56–59" or over 75") is priced by our team.
const TV_SIZE_LABELS = {
  upto35: 'up to 35"', '36to45': '36–45"', '46to55': '46–55"',
  '60to65': '60–65"', '66to75': '66–75"', other: 'other size'
};
const DIM_CM = { min: 1, max: 500 };

function cleanTvSizes(raw, qty) {
  if (!Array.isArray(raw) || raw.length !== qty) return null;
  return raw.every(s => Object.prototype.hasOwnProperty.call(TV_SIZE_LABELS, s)) ? raw.slice() : null;
}

function cleanDims(raw, qty) {
  if (!Array.isArray(raw) || raw.length !== qty) return null;
  const dims = raw.map(d => ({ l: Number(d && d.l), w: Number(d && d.w), h: Number(d && d.h) }));
  const ok = dims.every(d => [d.l, d.w, d.h].every(n => Number.isFinite(n) && n >= DIM_CM.min && n <= DIM_CM.max));
  return ok ? dims.map(d => ({ l: Math.round(d.l), w: Math.round(d.w), h: Math.round(d.h) })) : null;
}

// Box list for a country — shared by the customer booking form and staff
// edits. Returns { error } or { value: [{ type, qty, sizes?, dims? }] }
// (types merged). requireDetails: TVs need each screen size and odd-size
// items each L × W × H (the online booking); otherwise they're kept when given.
function validateItems(country, rawItems, { requireDetails = false } = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 10) {
    return { error: 'Please add at least one item.' };
  }
  const items = [];
  for (const raw of rawItems) {
    const type = raw && raw.type;
    const qty = Number(raw && raw.qty);
    if (!ITEM_TYPES[country].includes(type)) return { error: 'One of the items is not a type we can book online.' };
    if (!Number.isInteger(qty) || qty < 1 || qty > 30) return { error: 'Each item quantity must be between 1 and 30.' };
    const item = { type, qty };
    if (type === 'tv' && (requireDetails || raw.sizes !== undefined)) {
      const sizes = cleanTvSizes(raw.sizes, qty);
      if (!sizes) return { error: "Please choose each TV's screen size." };
      item.sizes = sizes;
    }
    if (type === 'other' && (requireDetails || raw.dims !== undefined)) {
      const dims = cleanDims(raw.dims, qty);
      if (!dims) return { error: `Please give the length, width and height of each odd-size item in cm (${DIM_CM.min}–${DIM_CM.max}).` };
      item.dims = dims;
    }
    const existing = items.find(i => i.type === type);
    if (!existing) { items.push(item); continue; }
    existing.qty += qty;
    if (item.sizes) existing.sizes = (existing.sizes || []).concat(item.sizes);
    if (item.dims) existing.dims = (existing.dims || []).concat(item.dims);
  }
  if (items.reduce((n, i) => n + i.qty, 0) > 30) {
    return { error: 'For more than 30 items, please call us on 0434 842 023 so we can plan it with you.' };
  }
  return { value: items };
}

// " (55", 32")" for TVs, " (120×40×80 cm)" for odd-size items, else "".
function itemDetail(i) {
  if (i.type === 'tv' && Array.isArray(i.sizes) && i.sizes.length) return ` (${i.sizes.map(s => TV_SIZE_LABELS[s] || `${s}"`).join(', ')})`;
  if (i.type === 'other' && Array.isArray(i.dims) && i.dims.length) return ` (${i.dims.map(d => `${d.l}×${d.w}×${d.h} cm`).join('; ')})`;
  return '';
}

// ---------- the rest of the declaration (walk-in form + online booking) ----------

const MAX_CONTENT_ROWS = 60;
const MAX_SIGNATURE_CHARS = 250000; // a phone-drawn PNG is ~10-60k

function oneLine(value, max) {
  return cleanText(String(value || '').replace(/\s*\n\s*/g, ', '), max);
}

// The customer's own list of what's inside: description, new/used and
// quantity. The value (AUD) is a staff field — added at Confirm, never
// asked of the customer.
function validateContents(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Please add at least one item you're sending.", field: 'contents' };
  if (raw.length > MAX_CONTENT_ROWS) return { error: `Please list up to ${MAX_CONTENT_ROWS} items. For more, ask our staff.`, field: 'contents' };
  const rows = [];
  for (const r of raw) {
    const description = oneLine(r && r.description, 60);
    if (description.length < 2) return { error: 'Please describe each item (for example "Chocolate").', field: 'contents' };
    const condition = r && r.condition === 'used' ? 'used' : r && r.condition === 'new' ? 'new' : null;
    if (!condition) return { error: `Please say whether "${description}" is new or used.`, field: 'contents' };
    const qty = Number(r && r.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return { error: `Please enter how many "${description}" (1-999).`, field: 'contents' };
    rows.push({ description, condition, qty, value: null });
  }
  return { value: rows };
}

// Insurance answer, the prohibited-goods declaration, typed name and the
// optional finger-drawn signature. Returns { error, field } or { value }.
function validateSignOff(body) {
  if (typeof body.insurance !== 'boolean') return { error: 'Please answer whether you want your goods insured.', field: 'insurance' };
  if (body.declarationAccepted !== true) return { error: 'Please tick the declaration to confirm there are no prohibited goods.', field: 'declarationAccepted' };
  const signedName = oneLine(body.signedName, 80);
  if (signedName.length < 2) return { error: 'Please type your full name to sign.', field: 'signedName' };
  let signatureImage = null;
  if (body.signatureImage !== undefined && body.signatureImage !== null && body.signatureImage !== '') {
    if (typeof body.signatureImage !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body.signatureImage) || body.signatureImage.length > MAX_SIGNATURE_CHARS) {
      return { error: 'The signature could not be saved. Please clear it and sign again, or leave it empty.', field: 'signatureImage' };
    }
    signatureImage = body.signatureImage;
  }
  return { value: { insurance: body.insurance, signedName, signatureImage } };
}

// Air Freight: the Dangerous & Restricted Goods Checklist answers. The
// customer ticks all five "NO …" lines (no aerosols, flammables, batteries/
// fuel, drugs/weapons, jewellery/money/cards) and answers Yes/No for
// medications, lithium batteries in products and liquids — with the type
// and quantity when it's Yes. Returns { error, field } or { value }.
// A customer may really have one of the prohibited items — that doesn't
// stop the form: the lines they couldn't tick are kept (notInBoxes[i] =
// false) and flagged for staff to check at drop-off. Customers confirm it
// on purpose (requireAck), so a forgotten tick isn't mistaken for it.
const DG_LINE_COUNT = 5;
function validateDangerousGoods(raw, { requireAck = false } = {}) {
  const dg = raw || {};
  let notInBoxes;
  if (Array.isArray(dg.notInBoxes) && dg.notInBoxes.length === DG_LINE_COUNT && dg.notInBoxes.every(v => typeof v === 'boolean')) {
    notInBoxes = dg.notInBoxes.slice();
  } else if (dg.noProhibited === true) {
    notInBoxes = new Array(DG_LINE_COUNT).fill(true);
  } else {
    return { error: 'Please go through each "NO" line of the Air Freight checklist.', field: 'dangerousGoods.notInBoxes' };
  }
  const noProhibited = notInBoxes.every(Boolean);
  if (!noProhibited && requireAck && dg.prohibitedAcknowledged !== true) {
    return { error: 'Please confirm that your boxes may contain the items you didn\'t tick — our staff will check them with you.', field: 'dangerousGoods.prohibitedAcknowledged' };
  }
  const value = { noProhibited, notInBoxes };
  for (const [key, label] of [['medications', 'medications'], ['lithium', 'lithium batteries'], ['liquids', 'liquids']]) {
    if (typeof dg[key] !== 'boolean') return { error: `Please answer Yes or No for ${label}.`, field: `dangerousGoods.${key}` };
    value[key] = dg[key];
  }
  for (const key of ['lithium', 'liquids']) {
    const details = oneLine(dg[`${key}Details`], 160);
    if (value[key] && details.length < 2) {
      return { error: `Please write the type of product and quantity for the ${key === 'lithium' ? 'lithium batteries' : 'liquids'}.`, field: `dangerousGoods.${key}Details` };
    }
    value[`${key}Details`] = value[key] ? details : '';
  }
  return { value };
}

// The lithium battery transport document's configuration — staff choose it.
const LITHIUM_CONFIGS = ['ion_965_ii', 'ion_965_ib', 'ion_966_ii', 'ion_967_ii', 'metal_968_ii', 'metal_968_ib', 'metal_969_ii', 'metal_970_ii'];
function validateLithiumDoc(raw) {
  const l = raw || {};
  const configs = Array.isArray(l.configs) ? [...new Set(l.configs.filter(c => LITHIUM_CONFIGS.includes(c)))] : [];
  const phone = oneLine(l.phone, 30);
  if (phone && !/^\+?[\d\s()-]{7,30}$/.test(phone)) return { error: 'Please check the phone number for the batteries.', field: 'lithiumDoc.phone' };
  return { value: { configs, phone } };
}

function samePerson(a, b) {
  return (a.idNumber && a.idNumber === b.idNumber) || (a.fullName.toLowerCase() === b.fullName.toLowerCase() && a.mobile.replace(/\D/g, '') === b.mobile.replace(/\D/g, ''));
}

function createCustomerTools({
  getSydneyNow,
  resolvedDateString,
  lookupPebl,
  broadcast,
  sendBookingEmail,
  sendStaffBookingWhatsApp,
  createCalendarEvent
}) {

  // ---------- codes ----------

  async function ensureCustomerCode(customer) {
    if (customer.customerCode) return customer.customerCode;
    const code = `CUS-${pad6(await nextSequence('customerCode'))}`;
    const result = await customers().updateOne(
      { _id: customer._id, customerCode: { $exists: false } },
      { $set: { customerCode: code } }
    );
    if (result.modifiedCount === 1) {
      customer.customerCode = code;
      return code;
    }
    // Lost a race with a concurrent request — use whatever won.
    const fresh = await customers().findOne({ _id: customer._id }, { projection: { customerCode: 1 } });
    customer.customerCode = fresh.customerCode;
    return fresh.customerCode;
  }

  async function newBookingCode() {
    return `BK-${pad6(await nextSequence('bookingCode'))}`;
  }

  // Bookings made before the portal existed (via the chat bot) have no
  // bookingCode — one is assigned the first time the owner views it, so a
  // customer is only ever shown a reference the backend actually issued.
  async function ensureBookingCodes(bookingDocs) {
    for (const b of bookingDocs) {
      if (b.bookingCode) continue;
      const code = await newBookingCode();
      const result = await bookings().updateOne(
        { _id: b._id, bookingCode: { $exists: false } },
        { $set: { bookingCode: code } }
      );
      if (result.modifiedCount === 1) {
        b.bookingCode = code;
      } else {
        const fresh = await bookings().findOne({ _id: b._id }, { projection: { bookingCode: 1 } });
        b.bookingCode = fresh && fresh.bookingCode;
      }
    }
  }

  // ---------- profile ----------

  function publicProfile(customer) {
    const address = customer.address || {};
    return {
      customerCode: customer.customerCode || null,
      name: hasRealName(customer) ? customer.name : '',
      phoneNumber: customer.phoneNumber,
      email: customer.email || '',
      address: {
        line1: address.line1 || '',
        suburb: address.suburb || '',
        state: address.state || '',
        postcode: address.postcode || ''
      },
      preferredLanguage: customer.preferredLanguage || 'en',
      contactPreference: customer.contactPreference || 'whatsapp',
      memberSince: customer.portalJoinedAt || customer.createdAt || null,
      phoneVerified: hasVerifiedPhone(customer),
      hasPassword: Boolean(customer.passwordHash)
    };
  }

  // What the chat is allowed to know about the signed-in customer — the
  // minimum needed to personalise a reply, nothing else.
  function chatContext(customer) {
    return {
      customerCode: customer.customerCode || null,
      firstName: hasRealName(customer) ? customer.name.trim().split(/\s+/)[0] : null,
      preferredLanguage: customer.preferredLanguage || 'en'
    };
  }

  // ---------- shaping ----------

  function itemsSummary(items) {
    return items
      .map(i => {
        const [one, many] = ITEM_LABELS[i.type] || [i.type, i.type];
        return `${i.qty} ${i.qty === 1 ? one : many}${itemDetail(i)}`;
      })
      .join(', ');
  }

  function safeResolvedDate(booking) {
    try {
      return booking.requestedDay && booking.requestedTime ? resolvedDateString(booking) : null;
    } catch {
      return null;
    }
  }

  function buildSteps({ booking, shipment }) {
    const idx = shipment ? statusIndex(shipment.status) : -1;
    const blNumber = shipment ? (shipment.hblNumber || shipment.blNumber || null) : null;

    const steps = [
      { key: 'booking_created', label: 'Booking created', done: Boolean(booking) || Boolean(shipment) },
      // Done once the customer has submitted it online with the booking
      // (declarationSubmittedAt), or staff recorded a paper/external one.
      { key: 'declaration', label: 'Declaration form', done: Boolean(booking && (booking.declarationStatus === 'received' || booking.declarationSubmittedAt)) },
      {
        key: 'warehouse_received',
        label: 'Boxes received at our warehouse',
        done: Boolean(
          (booking && (booking.warehouseStatus === 'received' || booking.status === 'completed')) ||
          idx >= statusIndex('cargo_received')
        )
      },
      { key: 'bl_assigned', label: 'Shipment reference (BL) assigned', done: Boolean(blNumber) },
      { key: 'in_transit', label: 'On the way', done: idx >= statusIndex('in_transit') },
      { key: 'arrived', label: 'Arrived', done: idx >= statusIndex('arrived') },
      { key: 'delivered', label: 'Delivered', done: idx >= statusIndex('delivered') }
    ];

    // A shipment imported from a batch ledger has no booking record —
    // its declaration/booking stages simply aren't tracked here, so they
    // are dropped rather than shown as falsely "not done".
    const visible = booking ? steps : steps.filter(s => !['booking_created', 'declaration'].includes(s.key));

    // "Current" is the next stage after the furthest confirmed one. A
    // stage left open BEFORE a confirmed one (in practice: a declaration
    // staff haven't recorded yet, though the boxes have arrived) is
    // flagged as needing attention rather than shown as "up next".
    let lastDone = -1;
    visible.forEach((s, i) => { if (s.done) lastDone = i; });
    const currentIndex = visible.findIndex((s, i) => i > lastDone && !s.done);
    return visible.map((s, i) => ({
      ...s,
      current: i === currentIndex,
      attention: !s.done && i < lastDone
    }));
  }

  function bookingStatus(booking, shipment) {
    if (booking.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'muted' };
    if (shipment && SHIPMENT_STATUS_LABELS[shipment.status] && statusIndex(shipment.status) > 0) {
      return {
        key: shipment.status,
        label: SHIPMENT_STATUS_LABELS[shipment.status],
        tone: shipment.status === 'delivered' ? 'done' : 'active'
      };
    }
    if (booking.warehouseStatus === 'received' || booking.status === 'completed') {
      return { key: 'warehouse_received', label: 'Boxes received at our warehouse', tone: 'active' };
    }
    if (booking.status === 'confirmed') return { key: 'confirmed', label: 'Confirmed — waiting for your drop-off', tone: 'pending' };
    return { key: 'pending', label: 'Waiting for your drop-off', tone: 'pending' };
  }

  function shapeBooking(booking, shipment) {
    const country = COUNTRIES[booking.country] ? booking.country : null;
    return {
      id: String(booking._id),
      code: booking.bookingCode || null,
      createdAt: booking.createdAt || null,
      country: country ? COUNTRIES[country].label : null,
      service: SERVICE_LABELS[booking.serviceType] || null,
      items: booking.items && booking.items.length ? itemsSummary(booking.items) : (booking.boxSummary || null),
      destination: booking.destination || null,
      delivery: DELIVERY_LABELS[booking.deliveryType] || null,
      dropOff: booking.requestedDay
        ? { date: safeResolvedDate(booking), day: booking.requestedDay, time: booking.requestedTime || null }
        : null,
      notes: booking.customerNotes || null,
      // 'pickup' = our team collects from the sender (they call to arrange).
      handover: booking.handover === 'pickup' ? 'pickup' : 'dropoff',
      pickupNote: booking.pickupNote || null,
      status: bookingStatus(booking, shipment),
      declaration: {
        status: booking.declarationStatus === 'received' ? 'received' : booking.declarationSubmittedAt ? 'submitted' : 'needed',
        formUrl: DECLARATION_FORM_URL,
        // The customer's own entries, shown back to them on the booking.
        sender: booking.sender ? { fullName: booking.sender.fullName } : null,
        receiver: booking.receiver ? { fullName: booking.receiver.fullName, town: booking.receiver.town } : null
      },
      blNumber: shipment ? (shipment.hblNumber || shipment.blNumber || null) : null,
      shipmentId: shipment ? String(shipment._id) : null,
      canCancel: booking.status === 'pending' && !shipment && booking.warehouseStatus !== 'received',
      steps: buildSteps({ booking, shipment })
    };
  }

  // What the customer's Edit page starts from, for bookings made in the
  // online form (known country + item types). The declaration (sender,
  // receiver, item list) can be changed until the BL is issued; boxes,
  // delivery and drop-off only while they could still cancel.
  function editableBooking(booking, shipment) {
    const shaped = shapeBooking(booking, shipment);
    const open = !shipment && booking.status !== 'cancelled' && booking.status !== 'completed';
    if (!open || !COUNTRIES[booking.country] || !Array.isArray(booking.items)) return null;
    const person = p => p ? {
      fullName: p.fullName || '', address: p.address || '', town: p.town || '', mobile: p.mobile || '',
      email: p.email || '', idNumber: p.idNumber || '', homePhone: p.homePhone || ''
    } : null;
    return {
      canChangeBoxes: shaped.canCancel,
      canCancel: shaped.canCancel,
      sender: person(booking.sender),
      receiver: person(booking.receiver),
      contents: (booking.contents || []).map(c => ({ description: c.description, condition: c.condition, qty: c.qty })),
      country: booking.country,
      service: booking.serviceType,
      items: booking.items,
      deliveryType: booking.deliveryType || null,
      handover: shaped.handover,
      pickupNote: booking.pickupNote || '',
      dropOff: booking.requestedDateISO ? { date: booking.requestedDateISO, time: booking.requestedTime || null } : null,
      notes: booking.customerNotes || ''
    };
  }

  // The customer changes their own booking — same rules as booking. The
  // declaration (sender, receiver, item list) until the BL is issued;
  // boxes, delivery, drop-off/pickup and notes only while they could
  // still cancel. After the BL nothing can be changed online.
  async function updateOwnBooking(customerId, bookingId, input) {
    const booking = await findOwnBooking(customerId, bookingId);
    if (!booking) return { notFound: true };
    const shipment = await shipments().findOne({ customerId, bookingId: booking._id });
    const editable = editableBooking(booking, shipment);
    if (!editable) {
      return { error: 'This booking can no longer be changed online — its BL has been issued. Please call us on 0434 842 023.' };
    }
    const body = input || {};
    const sender = validatePerson(body.sender, 'sender', { idNumber: booking.country === 'sri_lanka' ? 'required' : 'optional', homePhone: true });
    if (sender.error) return sender;
    const receiver = validatePerson(body.receiver, 'receiver', { withId: true, homePhone: true });
    if (receiver.error) return receiver;
    const contents = validateContents(body.contents);
    if (contents.error) return contents;
    const set = {
      sender: sender.value,
      receiver: receiver.value,
      destination: receiver.value.town,
      contents: contents.value,
      customerEditedAt: new Date()
    };
    if (editable.canChangeBoxes) {
      const items = validateItems(booking.country, body.items, { requireDetails: true });
      if (items.error) return { error: items.error, field: 'items' };
      if (!DELIVERY_LABELS[body.deliveryType]) return { error: 'Please choose door delivery or collection.', field: 'deliveryType' };
      const handover = await validateHandover(body, { date: booking.requestedDateISO });
      if (handover.error) return handover;
      const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : '';
      Object.assign(set, {
        items: items.value,
        boxSummary: itemsSummary(items.value),
        boxCount: items.value.reduce((n, i) => n + i.qty, 0),
        deliveryType: body.deliveryType,
        customerNotes: notes || null,
        ...handover.value
      });
    }
    await bookings().updateOne({ _id: booking._id, customerId }, { $set: set });
    broadcast('booking.details_changed', { _id: String(booking._id), boxSummary: set.boxSummary || booking.boxSummary || null });
    return { booking: shapeBooking({ ...booking, ...set }, shipment) };
  }

  function shapeShipment(shipment, { booking, batch } = {}) {
    const hasStatus = Boolean(SHIPMENT_STATUS_LABELS[shipment.status]);
    return {
      id: String(shipment._id),
      blNumber: shipment.hblNumber || shipment.blNumber || null,
      bookingCode: booking ? booking.bookingCode || null : null,
      destination: shipment.destination || (booking && booking.destination) || null,
      items: shipment.cargo || (shipment.boxCount ? `${shipment.boxCount} box${shipment.boxCount === 1 ? '' : 'es'}` : null) ||
        (booking && booking.items && booking.items.length ? itemsSummary(booking.items) : null),
      receiverName: shipment.receiver && shipment.receiver.name ? shipment.receiver.name : null,
      // Only the batch's own label — never any other BL or customer in it.
      batchLabel: batch && batch.batchNumber != null ? `Shipment ${batch.batchNumber}` : null,
      status: hasStatus
        ? { key: shipment.status, label: SHIPMENT_STATUS_LABELS[shipment.status], tone: shipment.status === 'delivered' ? 'done' : 'active' }
        : { key: 'unknown', label: 'Status not updated yet', tone: 'muted' },
      updatedAt: shipment.updatedAt || shipment.createdAt || null,
      steps: buildSteps({ booking, shipment })
    };
  }

  // ---------- reads (all scoped to customerId) ----------
  //
  // An account whose number isn't proven yet (hasVerifiedPhone) only
  // sees bookings it made itself in My Transco, and the shipments of
  // those bookings — never other history that happens to sit on the
  // same phone number.

  async function scope(customerId, { staff = false } = {}) {
    if (staff) return { bookings: { customerId }, shipments: { customerId } };
    const c = await customers().findOne({ _id: customerId }, { projection: { phoneVerified: 1 } });
    const verified = !c || hasVerifiedPhone(c);
    if (verified) return { bookings: { customerId }, shipments: { customerId } };
    const own = await bookings()
      .find({ customerId, createdByAccount: true }, { projection: { _id: 1 } })
      .toArray();
    return {
      bookings: { customerId, createdByAccount: true },
      shipments: { customerId, bookingId: { $in: own.map(b => b._id) } }
    };
  }

  async function linkedShipmentsByBooking(customerId, bookingDocs) {
    const ids = bookingDocs.map(b => b._id);
    if (!ids.length) return new Map();
    const docs = await shipments()
      .find({ customerId, bookingId: { $in: ids } })
      .toArray();
    return new Map(docs.map(s => [String(s.bookingId), s]));
  }

  async function getCustomerBookings(customerId, { limit = 50, staff = false } = {}) {
    const q = await scope(customerId, { staff });
    const docs = await bookings()
      .find(q.bookings)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    await ensureBookingCodes(docs);
    const byBooking = await linkedShipmentsByBooking(customerId, docs);
    return docs.map(b => shapeBooking(b, byBooking.get(String(b._id))));
  }

  async function findOwnBooking(customerId, bookingId) {
    const _id = toObjectId(bookingId);
    if (!_id) return null;
    const q = await scope(customerId);
    return bookings().findOne({ ...q.bookings, _id });
  }

  async function getCustomerBooking(customerId, bookingId) {
    const booking = await findOwnBooking(customerId, bookingId);
    if (!booking) return null;
    await ensureBookingCodes([booking]);
    const shipment = await shipments().findOne({ customerId, bookingId: booking._id });
    return { ...shapeBooking(booking, shipment), edit: editableBooking(booking, shipment) };
  }

  async function shapeShipments(customerId, shipmentDocs) {
    const bookingIds = shipmentDocs.map(s => s.bookingId).filter(Boolean);
    const batchIds = shipmentDocs.map(s => s.consolidationId).filter(Boolean);
    const [bookingDocs, batchDocs] = await Promise.all([
      bookingIds.length ? bookings().find({ _id: { $in: bookingIds }, customerId }).toArray() : [],
      batchIds.length
        ? consolidations().find({ _id: { $in: batchIds } }, { projection: { batchNumber: 1 } }).toArray()
        : []
    ]);
    await ensureBookingCodes(bookingDocs);
    const bookingById = new Map(bookingDocs.map(b => [String(b._id), b]));
    const batchById = new Map(batchDocs.map(c => [String(c._id), c]));
    return shipmentDocs.map(s => shapeShipment(s, {
      booking: s.bookingId ? bookingById.get(String(s.bookingId)) : null,
      batch: s.consolidationId ? batchById.get(String(s.consolidationId)) : null
    }));
  }

  async function getCustomerShipments(customerId, { limit = 50, staff = false } = {}) {
    const q = await scope(customerId, { staff });
    const docs = await shipments()
      .find(q.shipments)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    return shapeShipments(customerId, docs);
  }

  async function getCustomerShipment(customerId, shipmentId) {
    const _id = toObjectId(shipmentId);
    if (!_id) return null;
    const q = await scope(customerId);
    const doc = await shipments().findOne({ ...q.shipments, _id });
    if (!doc) return null;
    const [shaped] = await shapeShipments(customerId, [doc]);
    return shaped;
  }

  // Just the BL numbers this customer owns — for "what's my BL?".
  async function getCustomerBLs(customerId) {
    const all = await getCustomerShipments(customerId, { limit: 20 });
    return all.filter(s => s.blNumber);
  }

  // Live customs/arrival info from PEBL, for one of THIS customer's own
  // shipments only. PEBL being unreachable is reported as unavailable,
  // never papered over with a guess.
  async function getShipmentTracking(customerId, shipmentId) {
    const shipment = await getCustomerShipment(customerId, shipmentId);
    if (!shipment) return null;
    if (!shipment.blNumber) {
      return { shipment, live: { state: 'no_bl' } };
    }
    const result = await lookupPebl(shipment.blNumber);
    if (result.unavailable) return { shipment, live: { state: 'unavailable' } };
    if (!result.found) return { shipment, live: { state: 'not_found' } };
    const p = result.pebl || {};
    return {
      shipment,
      live: {
        state: 'found',
        portOfLoading: p.portOfLoading || null,
        portOfDischarge: p.portOfDischarge || null,
        estimatedArrivalDate: p.estimatedArrivalDate || null,
        estimatedClearanceDate: p.estimatedClearanceDate || null,
        estimatedDeliveryDate: p.estimatedDeliveryDate || null
      }
    };
  }

  async function getSummary(customerId) {
    const [recentBookings, recentShipments, bls] = await Promise.all([
      getCustomerBookings(customerId, { limit: 3 }),
      getCustomerShipments(customerId, { limit: 3 }),
      getCustomerBLs(customerId)
    ]);
    // The BL number is how a customer's shipment is identified — the
    // newest one (shown big on the home screen) and a few earlier ones.
    const blCard = s => ({ shipmentId: s.id, blNumber: s.blNumber, batchLabel: s.batchLabel, status: s.status, destination: s.destination });
    return {
      latestBl: bls[0] ? blCard(bls[0]) : null,
      earlierBls: bls.slice(1, 6).map(blCard),
      latestBooking: recentBookings[0] || null,
      latestShipment: recentShipments[0] || null,
      needsDeclaration: recentBookings.filter(b => b.status.key !== 'cancelled' && b.declaration.status === 'needed' && !b.blNumber).length
    };
  }

  // Declaration form link plus, per open booking, whether staff have
  // recorded the declaration as received. (No invoice/receipt documents
  // are stored anywhere in the system yet — the `invoices` collection has
  // no writer — so none are returned rather than any being invented.)
  async function getCustomerDocuments(customerId) {
    const recent = await getCustomerBookings(customerId, { limit: 20 });
    return {
      declarationFormUrl: DECLARATION_FORM_URL,
      declarations: recent
        .filter(b => b.status.key !== 'cancelled')
        .map(b => ({ bookingId: b.id, bookingCode: b.code, items: b.items, status: b.declaration.status }))
    };
  }

  // ---------- declaration details ----------

  // What the booking form pre-fills: the account's saved sender details
  // (or, before the first booking, what their profile already holds),
  // plus their saved receivers, most recently used first.
  function declarationDefaults(customer) {
    const saved = customer.senderDetails;
    const address = customer.address || {};
    const profileAddress = [address.line1, address.suburb, [address.state, address.postcode].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');
    const sender = saved
      ? { fullName: saved.fullName, address: saved.address, mobile: saved.mobile, email: saved.email, idNumber: saved.idNumber || '', homePhone: saved.homePhone || '' }
      : {
          fullName: hasRealName(customer) ? customer.name : '',
          address: profileAddress,
          mobile: customer.phoneNumber ? `+${customer.phoneNumber}` : '',
          email: customer.email || ''
        };
    const receivers = (customer.savedReceivers || [])
      .slice()
      .sort((a, b) => new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0))
      .map(r => ({
        id: r.id, country: r.country, fullName: r.fullName, address: r.address,
        town: r.town, mobile: r.mobile, email: r.email, idNumber: r.idNumber, homePhone: r.homePhone || ''
      }));
    return { sender, senderSaved: Boolean(saved), receivers };
  }

  // STAFF ONLY (mounted behind staff auth in staffPortalRoutes.js): every
  // detail needed to print a booking's declaration form. Works for any
  // booking; older ones without online declaration details come back
  // with sender/receiver null so the printout leaves those to be filled
  // in by hand.
  async function getDeclarationForPrint(bookingId) {
    const _id = toObjectId(bookingId);
    if (!_id) return null;
    const booking = await bookings().findOne({ _id });
    if (!booking) return null;
    const [customer, shipment] = await Promise.all([
      booking.customerId ? customers().findOne({ _id: booking.customerId }, { projection: { customerCode: 1, name: 1, phoneNumber: 1 } }) : null,
      shipments().findOne({ bookingId: booking._id }, { projection: { hblNumber: 1, blNumber: 1, consolidationId: 1 } })
    ]);
    // Which shipment (container) the BL is in — for "Move to another shipment".
    const batch = shipment && shipment.consolidationId
      ? await consolidations().findOne({ _id: shipment.consolidationId }, { projection: { batchNumber: 1 } })
      : null;
    const country = COUNTRIES[booking.country] ? COUNTRIES[booking.country].label : null;
    return {
      bookingId: String(booking._id),
      bookingCode: booking.bookingCode || null,
      createdAt: booking.createdAt || null,
      country,
      service: SERVICE_LABELS[booking.serviceType] || null,
      delivery: DELIVERY_LABELS[booking.deliveryType] || null,
      destination: booking.destination || null,
      // Raw keys too, so the printout can tick the right boxes on the
      // original paper form (service, package type, delivery).
      countryKey: COUNTRIES[booking.country] ? booking.country : null,
      serviceKey: booking.serviceType || null,
      deliveryKey: booking.deliveryType || null,
      handover: booking.handover === 'pickup' ? 'pickup' : 'dropoff',
      pickupNote: booking.pickupNote || null,
      // Staff costing lines (null until staff save one).
      costing: booking.costing || null,
      items: (booking.items || []).map(i => ({
        type: i.type, label: (ITEM_LABELS[i.type] || [i.type])[0], qty: i.qty,
        ...(i.sizes ? { sizes: i.sizes } : {}), ...(i.dims ? { dims: i.dims } : {})
      })),
      // From the walk-in form: the customer's own item list, insurance
      // answer and signature; office-use figures staff add at Finalise.
      contents: booking.contents || [],
      insurance: typeof booking.insurance === 'boolean' ? booking.insurance : null,
      signature: booking.signature
        ? { name: booking.signature.name || null, image: booking.signature.image || null, signedAt: booking.signature.signedAt || null }
        : null,
      weight: booking.weight ?? null,
      cbm: booking.cbm ?? null,
      officeUse: booking.officeUse || null,
      collectionCentre: booking.collectionCentre || null,
      walkIn: booking.walkIn
        ? { status: booking.walkIn.status, submittedAt: booking.walkIn.submittedAt || null, finalisedAt: booking.walkIn.finalisedAt || null, finalisedBy: booking.walkIn.finalisedBy || null, returning: Boolean(booking.walkIn.returning) }
        : null,
      // Staff's drop-off confirmation (values + BL), for walk-ins and for
      // bookings whose full declaration was filled online. Null when there's
      // no declaration to confirm (e.g. older bookings made in the chat).
      confirm: booking.walkIn
        ? { status: booking.walkIn.status, finalisedAt: booking.walkIn.finalisedAt || null, finalisedBy: booking.walkIn.finalisedBy || null }
        : booking.declarationSubmittedAt && Array.isArray(booking.contents) && booking.contents.length
          ? {
              status: booking.staffConfirm && booking.staffConfirm.status === 'finalised' ? 'finalised' : 'submitted',
              finalisedAt: booking.staffConfirm ? booking.staffConfirm.finalisedAt || null : null,
              finalisedBy: booking.staffConfirm ? booking.staffConfirm.finalisedBy || null : null
            }
          : null,
      // Air Freight: the customer's dangerous goods answers, and the
      // lithium battery configuration staff chose.
      dangerousGoods: booking.dangerousGoods || null,
      lithiumDoc: booking.lithiumDoc || null,
      // "Send email" history (office inbox) — newest last.
      formEmails: (booking.formEmails || []).map(e => ({ at: e.at, by: e.by || null })),
      itemsText: booking.items && booking.items.length ? itemsSummary(booking.items) : (booking.boxSummary || null),
      boxCount: booking.boxCount || null,
      dropOff: booking.requestedDay ? { date: safeResolvedDate(booking), time: booking.requestedTime || null } : null,
      notes: booking.customerNotes || null,
      sender: booking.sender || null,
      senderIsAccountHolder: booking.senderIsAccountHolder !== false,
      receiver: booking.receiver || null,
      declarationSubmittedAt: booking.declarationSubmittedAt || null,
      declarationStatus: booking.declarationStatus === 'received' ? 'received' : 'not_received',
      blNumber: shipment ? (shipment.hblNumber || shipment.blNumber || null) : null,
      shipmentId: shipment ? String(shipment._id) : null,
      batchNumber: batch ? batch.batchNumber ?? null : null,
      channel: booking.channel || null,
      status: booking.status || null,
      customer: customer
        ? { id: String(customer._id), customerCode: customer.customerCode || null, name: hasRealName(customer) ? customer.name : null, phoneNumber: customer.phoneNumber || null }
        : { id: null, customerCode: null, name: booking.customerName || null, phoneNumber: booking.phoneNumber || null }
    };
  }

  // ---------- staff edits (STAFF ONLY — mounted behind staff auth) ----------

  // What the staff "Edit booking" panel needs: the raw editable fields plus
  // the box types allowed for this booking's country. Bookings made by the
  // chat bot have no country/items — their boxes stay free text (editable
  // in the older Edit booking sheet) and only the declaration is editable.
  async function getBookingForStaffEdit(bookingId) {
    const _id = toObjectId(bookingId);
    if (!_id) return null;
    const b = await bookings().findOne({ _id });
    if (!b) return null;
    const country = COUNTRIES[b.country] ? b.country : null;
    return {
      bookingId: String(b._id),
      bookingCode: b.bookingCode || null,
      country,
      countryLabel: country ? COUNTRIES[country].label : null,
      itemTypes: country ? ITEM_TYPES[country].map(t => ({ key: t, label: ITEM_LABELS[t][0] })) : [],
      items: b.items || [],
      boxSummary: b.boxSummary || null,
      deliveryType: DELIVERY_LABELS[b.deliveryType] ? b.deliveryType : null,
      deliveryTypes: Object.entries(DELIVERY_LABELS).map(([key, label]) => ({ key, label })),
      notes: b.customerNotes || '',
      sender: b.sender || null,
      senderIsAccountHolder: b.senderIsAccountHolder !== false,
      receiver: b.receiver || null,
      staffEdits: (b.staffEdits || []).slice(-10).reverse()
    };
  }

  // Staff change a booking after it was made (the customer changed their
  // boxes at drop-off, a name was misspelt, …). Same validation as the
  // customer form; only the parts sent are changed. Every edit is recorded
  // (who, when, what) so there's a trail of changes to the declaration.
  // Staff costing for a booking: cost lines (name + amount) they can add,
  // change or remove, a discount, and the total. The total is also saved
  // as the booking's price, so lists and reports show it.
  async function staffSaveCosting(bookingId, body, staffEmail) {
    const _id = toObjectId(bookingId);
    if (!_id) return { notFound: true };
    const b = await bookings().findOne({ _id });
    if (!b) return { notFound: true };
    const input = body || {};
    if (!Array.isArray(input.lines) || input.lines.length > 30) return { error: 'Add up to 30 cost lines.' };
    const lines = [];
    for (const l of input.lines) {
      const label = l && typeof l.label === 'string' ? l.label.trim().slice(0, 80) : '';
      const amount = Number(l && l.amount);
      if (!label) return { error: 'Each cost line needs a name.' };
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return { error: `"${label}" needs an amount of 0 or more.` };
      lines.push({ label, amount: Math.round(amount * 100) / 100 });
    }
    const discount = input.discount === null || input.discount === undefined || input.discount === '' ? 0 : Number(input.discount);
    if (!Number.isFinite(discount) || discount < 0) return { error: 'The discount must be 0 or more.' };
    const total = Math.max(0, Math.round((lines.reduce((s, l) => s + l.amount, 0) - discount) * 100) / 100);
    const costing = { lines, discount, total, updatedAt: new Date(), updatedBy: staffEmail || null };
    // Also fills the paper form's office-use boxes, so staff never enter
    // prices twice: "pickup" lines → Pickup, "door"/"delivery" lines → D to D,
    // everything else → Freight. Staff-only — never shown to customers.
    const sumWhere = test => Math.round(lines.filter(l => test(l.label.toLowerCase())).reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const isPickup = t => /pick\s*-?up/.test(t);
    const isDoor = t => !isPickup(t) && /door|delivery/.test(t);
    const pickup = sumWhere(isPickup);
    const doorToDoor = sumWhere(isDoor);
    const freight = sumWhere(t => !isPickup(t) && !isDoor(t));
    const officeUse = {
      ...(b.officeUse || {}),
      freight: freight || null, pickup: pickup || null, doorToDoor: doorToDoor || null,
      discount: discount || null, total
    };
    await bookings().updateOne({ _id }, { $set: { costing, price: total, officeUse } });
    broadcast('booking.details_changed', { _id: String(_id), boxSummary: b.boxSummary || null });
    return { costing };
  }

  async function staffUpdateBookingDetails(bookingId, body, staffEmail) {
    const _id = toObjectId(bookingId);
    if (!_id) return { notFound: true };
    const b = await bookings().findOne({ _id });
    if (!b) return { notFound: true };
    const input = body || {};
    const set = {};
    const changed = [];

    if ('items' in input) {
      if (!COUNTRIES[b.country]) return { error: 'This booking was made in the chat, so its boxes are edited as text in "Edit booking".' };
      const checked = validateItems(b.country, input.items);
      if (checked.error) return { error: checked.error, field: 'items' };
      // Keep the customer's TV sizes / odd-size measurements when the
      // edit doesn't resend them and that item's count is unchanged.
      for (const item of checked.value) {
        const before = (b.items || []).find(i => i.type === item.type && i.qty === item.qty);
        if (!before) continue;
        if (!item.sizes && before.sizes) item.sizes = before.sizes;
        if (!item.dims && before.dims) item.dims = before.dims;
      }
      set.items = checked.value;
      set.boxSummary = itemsSummary(checked.value);
      set.boxCount = checked.value.reduce((n, i) => n + i.qty, 0);
      changed.push('boxes');
    }
    if ('deliveryType' in input) {
      if (!DELIVERY_LABELS[input.deliveryType]) return { error: 'Please choose door delivery or collection.', field: 'deliveryType' };
      set.deliveryType = input.deliveryType;
      changed.push('delivery');
    }
    // Merged over what's stored, so fields this editor doesn't show (the
    // sender's Passport/NIC, home phones from the walk-in form) are kept.
    if ('sender' in input) {
      const s = validatePerson({ ...(b.sender || {}), ...(input.sender || {}) }, 'sender', { idNumber: 'optional', homePhone: true });
      if (s.error) return s;
      set.sender = s.value;
      changed.push('sender');
    }
    if ('receiver' in input) {
      const r = validatePerson({ ...(b.receiver || {}), ...(input.receiver || {}) }, 'receiver', { withId: true, homePhone: true });
      if (r.error) return r;
      set.receiver = r.value;
      set.destination = r.value.town;
      changed.push('receiver');
    }
    if ('notes' in input) {
      set.customerNotes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 300) : null;
      changed.push('notes');
    }
    if (!changed.length) return { error: 'Nothing to save.' };

    const now = new Date();
    await bookings().updateOne(
      { _id },
      {
        $set: { ...set, staffEditedAt: now },
        $push: { staffEdits: { $each: [{ at: now, by: staffEmail || 'staff', changed }], $slice: -50 } }
      }
    );
    const updated = await bookings().findOne({ _id });
    broadcast('booking.details_changed', {
      _id: String(_id),
      boxSummary: updated.boxSummary || null,
      boxCount: updated.boxCount || null,
      destination: updated.destination || null,
      deliveryType: updated.deliveryType || null,
      customerNotes: updated.customerNotes || null,
      receiver: updated.receiver
        ? { fullName: updated.receiver.fullName, town: updated.receiver.town, address: updated.receiver.address || null, mobile: updated.receiver.mobile || null }
        : null
    });
    return { ok: true, changed };
  }

  // After a booking: remember the account holder's own sender details
  // (never someone else's) and add/refresh the receiver in their list.
  async function rememberDeclarationDetails(customer, { sender, senderIsMe, receiver, country }) {
    const set = {};
    if (senderIsMe) set.senderDetails = { ...sender, updatedAt: new Date() };

    const list = (customer.savedReceivers || []).slice();
    const existing = list.find(r => r.country === country && samePerson(r, receiver));
    const entry = { ...receiver, country, lastUsedAt: new Date() };
    if (existing) {
      Object.assign(existing, entry);
    } else {
      list.push({ id: new ObjectId().toHexString(), ...entry });
    }
    list.sort((a, b) => new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0));
    set.savedReceivers = list.slice(0, MAX_SAVED_RECEIVERS);

    await customers().updateOne({ _id: customer._id }, { $set: set });
  }

  // ---------- booking options / creation ----------

  function sydneyToday() {
    const now = getSydneyNow();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  function isoDate(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  async function weekdayLoad(dates) {
    if (!dates.length) return new Map();
    const rows = await bookings().aggregate([
      // Walk-ins came without an appointment, so they never use up a slot.
      { $match: { requestedDateISO: { $in: dates }, status: { $nin: ['cancelled', 'completed'] }, channel: { $ne: 'walk_in' } } },
      { $group: { _id: '$requestedDateISO', count: { $sum: 1 } } }
    ]).toArray();
    return new Map(rows.map(r => [r._id, r.count]));
  }

  // Next BOOKING_WINDOW_DAYS days of real drop-off dates (Tue-Sat), with
  // today excluded once its last slot has passed, and full weekdays
  // marked so the form never offers a slot the backend would reject.
  async function getBookingOptions() {
    const today = sydneyToday();
    const nowSydney = getSydneyNow();
    const nowMinutes = nowSydney.getUTCHours() * 60 + nowSydney.getUTCMinutes();
    const candidates = [];
    for (let i = 0; i <= BOOKING_WINDOW_DAYS; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const dow = DAY_NAMES[d.getUTCDay()];
      if (dow === 'sunday' || dow === 'monday') continue;
      const kind = dow === 'saturday' ? 'saturday' : 'weekday';
      let slots = DROP_OFF_SLOTS[kind];
      if (i === 0) {
        slots = slots.filter(t => {
          const [h, m] = t.split(':').map(Number);
          return h * 60 + m > nowMinutes + 30;
        });
      }
      if (slots.length) candidates.push({ date: isoDate(d), day: dow, kind, slots });
    }
    const load = await weekdayLoad(candidates.filter(c => c.kind === 'weekday').map(c => c.date));
    const dropOffDates = candidates.map(c => ({
      ...c,
      full: c.kind === 'weekday' && (load.get(c.date) || 0) >= WEEKDAY_DAILY_CAP
    }));

    return {
      countries: Object.entries(COUNTRIES).map(([key, c]) => ({
        key,
        label: c.label,
        services: c.services.map(s => ({ key: s, label: SERVICE_LABELS[s] })),
        itemTypes: ITEM_TYPES[key].map(t => ({ key: t, label: ITEM_LABELS[t][0] }))
      })),
      deliveryTypes: Object.entries(DELIVERY_LABELS).map(([key, label]) => ({ key, label })),
      dropOffDates
    };
  }

  // How the boxes reach us: dropped off at the warehouse (a day + time),
  // or a home pickup — our team calls to arrange the day and confirm the
  // fee, the same as the bot offers (no fixed pickup fee yet). `keep`:
  // the booking's current slot when editing, so it isn't refused as "full"
  // because of the booking itself.
  async function validateHandover(body, keep) {
    if (body.handover === 'pickup') {
      const pickupNote = typeof body.pickupNote === 'string' ? body.pickupNote.trim().slice(0, 200) : '';
      return { value: { handover: 'pickup', pickupNote: pickupNote || null, requestedDay: null, requestedTime: null, requestedDateISO: null } };
    }
    const dropOff = body.dropOff || {};
    const options = await getBookingOptions();
    const dateOption = options.dropOffDates.find(d => d.date === dropOff.date);
    if (!dateOption) return { error: 'Please choose one of the available drop-off days.', field: 'dropOff' };
    if (!dateOption.slots.includes(dropOff.time)) return { error: 'Please choose one of the available drop-off times.', field: 'dropOff' };
    const unchanged = keep && keep.date === dateOption.date;
    if (dateOption.full && !unchanged) return { error: 'Sorry, that day just filled up. Please choose another day.', field: 'dropOff' };
    return { value: { handover: 'dropoff', pickupNote: null, requestedDay: dateOption.day, requestedTime: dropOff.time, requestedDateISO: dateOption.date } };
  }

  // Validates a booking request. Returns { error } with a customer-
  // readable message, or { value } with the clean booking fields.
  async function validateBookingInput(input) {
    const body = input || {};
    const country = body.country;
    if (!COUNTRIES[country]) return { error: 'Please choose where you are sending to.' };

    const service = body.service;
    if (!COUNTRIES[country].services.includes(service)) return { error: 'Please choose a shipping service.' };

    const itemsCheck = validateItems(country, body.items, { requireDetails: true });
    if (itemsCheck.error) return { error: itemsCheck.error, field: 'items' };
    const items = itemsCheck.value;

    // The full declaration is collected with the booking, so at drop-off
    // staff only check the boxes, value the items and assign the BL.
    const senderCheck = validatePerson(body.sender, 'sender', { idNumber: country === 'sri_lanka' ? 'required' : 'optional', homePhone: true });
    if (senderCheck.error) return senderCheck;
    const receiverCheck = validatePerson(body.receiver, 'receiver', { withId: true, homePhone: true });
    if (receiverCheck.error) return receiverCheck;
    const contentsCheck = validateContents(body.contents);
    if (contentsCheck.error) return contentsCheck;
    const signOff = validateSignOff(body);
    if (signOff.error) return signOff;
    let dangerousGoods = null;
    if (service === 'air') {
      const dg = validateDangerousGoods(body.dangerousGoods, { requireAck: true });
      if (dg.error) return dg;
      dangerousGoods = dg.value;
    }

    const deliveryType = body.deliveryType;
    if (!DELIVERY_LABELS[deliveryType]) return { error: 'Please choose door delivery or collection.' };

    // The receiver's town, whichever delivery option — a collection
    // booking no longer asks for a separate delivery location.
    const destination = receiverCheck.value.town;

    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : '';

    const handover = await validateHandover(body);
    if (handover.error) return handover;

    return {
      value: {
        country, serviceType: service, items, destination, deliveryType,
        sender: senderCheck.value,
        senderIsMe: body.sender.isMe !== false,
        receiver: receiverCheck.value,
        contents: contentsCheck.value,
        insurance: signOff.value.insurance,
        signedName: signOff.value.signedName,
        signatureImage: signOff.value.signatureImage,
        dangerousGoods,
        customerNotes: notes || null,
        ...handover.value
      }
    };
  }

  // Creates a real booking for the signed-in customer. The booking code
  // comes from the backend sequence — the caller (UI or chat) only ever
  // displays what this returns.
  async function createBooking(customer, input) {
    const { error, field, value } = await validateBookingInput(input);
    if (error) return { error, field };

    const bookingCode = await newBookingCode();
    const origin = 'Sydney';
    const boxSummary = itemsSummary(value.items);
    const booking = {
      bookingCode,
      customerId: customer._id,
      customerName: hasRealName(customer) ? customer.name : customer.phoneNumber,
      phoneNumber: customer.phoneNumber,
      requestedDay: value.requestedDay,
      requestedTime: value.requestedTime,
      requestedDateISO: value.requestedDateISO,
      handover: value.handover,
      pickupNote: value.pickupNote,
      boxSummary,
      country: value.country,
      serviceType: value.serviceType,
      origin,
      destination: value.destination,
      deliveryType: value.deliveryType,
      items: value.items,
      boxCount: value.items.reduce((n, i) => n + i.qty, 0),
      customerNotes: value.customerNotes,
      sender: value.sender,
      senderIsAccountHolder: value.senderIsMe,
      receiver: value.receiver,
      contents: value.contents,
      insurance: value.insurance,
      declarationAccepted: true,
      signature: { name: value.signedName, image: value.signatureImage, signedAt: new Date() },
      ...(value.dangerousGoods ? { dangerousGoods: value.dangerousGoods } : {}),
      // Filled online with the booking; confirmed by staff at drop-off
      // when they value the items and assign the BL.
      declarationSubmittedAt: new Date(),
      declarationStatus: 'not_received',
      warehouseStatus: 'not_received',
      channel: 'portal',
      // Marks bookings the account itself made — what an account with an
      // unproven number is limited to (see scope()).
      createdByAccount: true,
      status: 'pending',
      createdAt: new Date()
    };

    const { insertedId } = await bookings().insertOne(booking);
    booking._id = insertedId;

    try {
      await rememberDeclarationDetails(customer, {
        sender: value.sender, senderIsMe: value.senderIsMe, receiver: value.receiver, country: value.country
      });
    } catch (err) {
      // Only a convenience for next time — never undoes a real booking.
      console.error('Saving declaration details failed:', err.message);
    }

    // Same staff notifications as a chat-bot booking — best-effort, a
    // failed email/WhatsApp/calendar call never undoes a real booking.
    try {
      // (The drawn signature only loads when the booking is opened or printed.)
      broadcast('booking.created', { ...booking, signature: { name: booking.signature.name }, resolvedDate: value.requestedDateISO });
      await sendBookingEmail(booking);
      await sendStaffBookingWhatsApp(booking);
      const calendarEventId = await createCalendarEvent(booking);
      if (calendarEventId) {
        await bookings().updateOne({ _id: insertedId }, { $set: { calendarEventId } });
      }
    } catch (err) {
      console.error('Portal booking notification failed:', err.message);
    }

    return { booking: shapeBooking(booking, null) };
  }

  // A customer may cancel their own booking only while nothing has
  // happened to it yet (still pending, no boxes received, no BL).
  async function cancelBooking(customerId, bookingId) {
    const booking = await findOwnBooking(customerId, bookingId);
    if (!booking) return { notFound: true };
    const shipment = await shipments().findOne({ customerId, bookingId: booking._id });
    const shaped = shapeBooking(booking, shipment);
    if (!shaped.canCancel) {
      return { error: 'This booking can no longer be cancelled online. Please call us on 0434 842 023.' };
    }
    await bookings().updateOne(
      { _id: booking._id, customerId },
      { $set: { status: 'cancelled', cancelledBy: 'customer', cancelledAt: new Date() } }
    );
    broadcast('booking.status_changed', { _id: String(booking._id), status: 'cancelled' });
    return { booking: shapeBooking({ ...booking, status: 'cancelled' }, null) };
  }

  return {
    ensureCustomerCode,
    updateOwnBooking,
    publicProfile,
    chatContext,
    getCustomerBookings,
    getCustomerBooking,
    getCustomerShipments,
    getCustomerShipment,
    getCustomerBLs,
    getShipmentTracking,
    getSummary,
    getCustomerDocuments,
    getBookingOptions,
    declarationDefaults,
    getDeclarationForPrint,
    getBookingForStaffEdit,
    staffUpdateBookingDetails,
    staffSaveCosting,
    createBooking,
    cancelBooking,
    newBookingCode,
    itemsSummary,
    rememberDeclarationDetails
  };
}

module.exports = {
  createCustomerTools,
  hasRealName,
  hasVerifiedPhone,
  validatePerson,
  validateItems,
  validateContents,
  validateSignOff,
  validateDangerousGoods,
  validateLithiumDoc,
  LITHIUM_CONFIGS,
  cleanText,
  COUNTRIES,
  SERVICE_LABELS,
  ITEM_TYPES,
  ITEM_LABELS,
  itemDetail,
  DELIVERY_LABELS,
  DECLARATION_FORM_URL,
  SHIPMENT_STATUS_LABELS
};
