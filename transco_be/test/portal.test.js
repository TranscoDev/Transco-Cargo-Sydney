// My Transco (customer portal) end-to-end tests: spawns the real
// server.js against an isolated Mongo database, with WhatsApp, Flowise
// and the PEBL tracker redirected to local stubs — same approach as
// integration.test.js. Focus: sign-in, one-customer-per-phone, booking
// creation with backend references, staff BL assignment, and — above
// all — that no customer can ever reach another customer's data.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');

require('dotenv').config({ quiet: true });

const TEST_DB_NAME = `transco_portal_test_${Date.now()}`;
const TEST_PORT = 3197;
const STUB_WHATSAPP_PORT = 3198;
const STUB_FLOWISE_PORT = 3199;
const STUB_PEBL_PORT = 3196;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_STAFF_EMAIL = 'portal.test@transco.lk';
const TEST_STAFF_PASSWORD = 'portal-test-password';

let serverProcess;
let mongoClient;
let db;
let staffToken;

let whatsappRequests = [];
let flowiseRequests = [];
let flowiseReplyText = 'Stubbed Flowise reply';
let peblMode = 'found'; // 'found' | 'missing' | 'down'

function collectBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

const stubWhatsApp = http.createServer(async (req, res) => {
  const body = await collectBody(req);
  whatsappRequests.push({ url: req.url, body: JSON.parse(body || '{}') });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ messages: [{ id: 'wamid.STUB' }] }));
});

const stubFlowise = http.createServer(async (req, res) => {
  const body = await collectBody(req);
  flowiseRequests.push(JSON.parse(body || '{}'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ text: flowiseReplyText }));
});

const stubPebl = http.createServer((req, res) => {
  if (peblMode === 'down') {
    res.writeHead(503);
    return res.end('down');
  }
  if (peblMode === 'missing') {
    res.writeHead(404);
    return res.end('No shipment found');
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    '<dl><dt>Shipment #</dt><dd>PE-57</dd><dt>Port of loading</dt><dd>Sydney</dd>' +
    '<dt>Port of discharge</dt><dd>Colombo</dd><dt>Estimated arrival date</dt><dd>12 Nov 2026</dd></dl>'
  );
});

function waitForPort(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function attempt() {
      const req = http.get(`http://localhost:${port}/webhook`, () => resolve());
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for port ${port}`));
        else setTimeout(attempt, 150);
      });
    })();
  });
}

async function api(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

function lastCodeSentTo(phoneNumber) {
  const sent = [...whatsappRequests].reverse().find(r => r.body.to === phoneNumber);
  assert.ok(sent, `no WhatsApp message was sent to ${phoneNumber}`);
  const text = sent.body.text ? sent.body.text.body : '';
  const match = text.match(/\b(\d{6})\b/);
  assert.ok(match, 'sign-in message contains a 6-digit code');
  return match[1];
}

// Clears the per-phone resend cooldown between sign-ins in one test run.
async function clearOtps(phoneNumber) {
  await db.collection('customerOtps').deleteMany({ phoneNumber });
}

async function signIn(localPhone, countryCode = '61', source) {
  const requested = await api('POST', '/api/portal/auth/request-code', { body: { countryCode, phone: localPhone } });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  const intl = countryCode + localPhone.replace(/^0/, '');
  const code = lastCodeSentTo(intl);
  const verified = await api('POST', '/api/portal/auth/verify-code', { body: { countryCode, phone: localPhone, code, source } });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return { token: verified.body.token, profile: verified.body.profile, needsName: verified.body.needsName, phoneNumber: intl };
}

// Sender + receiver details every online booking now carries (they are
// the declaration). The town is the booking's destination.
function decl(town, overrides = {}) {
  return {
    sender: { isMe: true, fullName: 'Alpha Sender', address: '1 Test St, Seven Hills NSW 2147', mobile: '+61 400 000 001', email: 'sender@example.com', ...(overrides.sender || {}) },
    receiver: { fullName: 'Rita Receiver', address: '12 Temple Rd', town, mobile: '+94 77 123 4567', email: 'rita@example.com', idNumber: '199012345678', ...(overrides.receiver || {}) }
  };
}

function nextDropOff(options) {
  const d = options.dropOffDates.find(x => !x.full);
  return { date: d.date, time: d.slots[0] };
}

async function chat(sessionId, payload, token) {
  return api('POST', '/api/web-chat', { token, body: { sessionId, ...payload } });
}

before(async () => {
  await new Promise((r) => stubWhatsApp.listen(STUB_WHATSAPP_PORT, r));
  await new Promise((r) => stubFlowise.listen(STUB_FLOWISE_PORT, r));
  await new Promise((r) => stubPebl.listen(STUB_PEBL_PORT, r));

  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      MONGODB_DB_NAME: TEST_DB_NAME,
      FLOWISE_URL: `http://localhost:${STUB_FLOWISE_PORT}`,
      WHATSAPP_API_BASE_URL: `http://localhost:${STUB_WHATSAPP_PORT}`,
      WHATSAPP_TOKEN: 'test-token',
      PHONE_NUMBER_ID: 'test-phone-id',
      WHATSAPP_OTP_TEMPLATE: '',
      PEBL_TRACKER_BASE_URL: `http://localhost:${STUB_PEBL_PORT}`,
      STAFF_EMAIL: TEST_STAFF_EMAIL,
      STAFF_PASSWORD: TEST_STAFF_PASSWORD,
      STAFF_NOTIFICATION_PHONE: '',
      RESEND_API_KEY: '',
      GOOGLE_SERVICE_ACCOUNT_JSON: '',
      SESSION_SECRET: 'portal-test-secret',
      PORTAL_AUTH_IP_LIMIT: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stderr.on('data', (d) => process.env.DEBUG_PORTAL_TESTS && console.error('[server:err]', d.toString()));

  await waitForPort(TEST_PORT);

  mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db(TEST_DB_NAME);

  const login = await api('POST', '/api/auth/login', { body: { email: TEST_STAFF_EMAIL, password: TEST_STAFF_PASSWORD } });
  assert.equal(login.status, 200);
  staffToken = login.body.token;
});

after(async () => {
  if (db) await db.dropDatabase();
  if (mongoClient) await mongoClient.close();
  if (serverProcess) serverProcess.kill();
  await new Promise((r) => stubWhatsApp.close(r));
  await new Promise((r) => stubFlowise.close(r));
  await new Promise((r) => stubPebl.close(r));
});

// ---------- public chat ----------

test('scenario 1: a general question works without signing in and goes to the assistant', async () => {
  flowiseRequests = [];
  flowiseReplyText = 'We are open Saturdays 11am-3pm.';
  const res = await chat('agentsite-public-1', { message: 'What time are you open?' });
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /Saturdays 11am-3pm/);
  assert.equal(flowiseRequests.length, 1);
  assert.deepEqual(res.body.actions, []);
});

test('scenario 2: asking for personal bookings while signed out asks to sign in, without calling the assistant', async () => {
  flowiseRequests = [];
  const res = await chat('agentsite-public-2', { message: 'Show my bookings' });
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /sign in/i);
  assert.equal(res.body.actions[0].kind, 'login');
  assert.equal(flowiseRequests.length, 0);
});

test('signed-out tracking still reaches the public BL tracker flow, with a sign-in suggestion added', async () => {
  flowiseRequests = [];
  flowiseReplyText = 'Please send me your BL number.';
  const res = await chat('agentsite-public-3', { message: 'I want to track my shipment' });
  assert.equal(res.status, 200);
  assert.equal(flowiseRequests.length, 1);
  assert.match(res.body.reply, /BL number/);
  assert.equal(res.body.actions[0].kind, 'login');
});

// ---------- sign in / accounts ----------

test('scenario 3: a new customer can create an account with no shipment, and gets a CUS code', async () => {
  const a = await signIn('0400111001', '61', 'warehouse_qr');
  assert.match(a.profile.customerCode, /^CUS-\d{6}$/);
  assert.equal(a.needsName, true);

  const customer = await db.collection('customers').findOne({ phoneNumber: '61400111001' });
  assert.ok(customer);
  assert.equal(customer.acquisitionSource, 'warehouse_qr');
  assert.equal(await db.collection('bookings').countDocuments({ customerId: customer._id }), 0);
});

test('a wrong code is rejected, and a code only works once', async () => {
  await clearOtps('61400111002');
  await api('POST', '/api/portal/auth/request-code', { body: { countryCode: '61', phone: '0400111002' } });
  const code = lastCodeSentTo('61400111002');
  const wrong = code === '000000' ? '111111' : '000000';

  const bad = await api('POST', '/api/portal/auth/verify-code', { body: { countryCode: '61', phone: '0400111002', code: wrong } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /isn't right/);

  const good = await api('POST', '/api/portal/auth/verify-code', { body: { countryCode: '61', phone: '0400111002', code } });
  assert.equal(good.status, 200);

  const replay = await api('POST', '/api/portal/auth/verify-code', { body: { countryCode: '61', phone: '0400111002', code } });
  assert.equal(replay.status, 400);
});

test('asking for codes too quickly is rate limited', async () => {
  await clearOtps('61400111003');
  const first = await api('POST', '/api/portal/auth/request-code', { body: { countryCode: '61', phone: '0400111003' } });
  assert.equal(first.status, 200);
  const second = await api('POST', '/api/portal/auth/request-code', { body: { countryCode: '61', phone: '0400111003' } });
  assert.equal(second.status, 429);
});

test('scenario 4: a returning customer gets the same record and customer code — no duplicate', async () => {
  await clearOtps('61400111004');
  const first = await signIn('0400111004');
  await clearOtps('61400111004');
  const second = await signIn('0400111004');
  assert.equal(first.profile.customerCode, second.profile.customerCode);
  assert.equal(await db.collection('customers').countDocuments({ phoneNumber: '61400111004' }), 1);
});

test('an existing WhatsApp customer signing in reuses their record (no duplicate), and a Sri Lankan number works', async () => {
  const { insertedId } = await db.collection('customers').insertOne({
    phoneNumber: '94771234567', name: 'Nimal Perera', mode: 'CHATBOT', status: 'ACTIVE', sources: ['whatsapp']
  });
  const a = await signIn('0771234567', '94');
  assert.equal(a.profile.name, 'Nimal Perera');
  assert.equal(a.needsName, false);
  const all = await db.collection('customers').find({ phoneNumber: '94771234567' }).toArray();
  assert.equal(all.length, 1);
  assert.equal(String(all[0]._id), String(insertedId));
  assert.deepEqual(all[0].sources.sort(), ['portal', 'whatsapp']);
});

test('profile: saves valid details and rejects bad input with a friendly message', async () => {
  await clearOtps('61400111005');
  const a = await signIn('0400111005');

  const bad = await api('PATCH', '/api/portal/me', { token: a.token, body: { email: 'not-an-email' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'email');

  const saved = await api('PATCH', '/api/portal/me', {
    token: a.token,
    body: {
      name: 'Tharushi Silva',
      email: 'T@Example.com',
      address: { line1: '1 Station Rd', suburb: 'Seven Hills', state: 'nsw', postcode: '2147' },
      preferredLanguage: 'si'
    }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.name, 'Tharushi Silva');
  assert.equal(saved.body.profile.email, 't@example.com');
  assert.equal(saved.body.profile.address.state, 'NSW');
  assert.equal(saved.body.needsName, false);
  // Never exposes internal ids/keys.
  assert.equal(saved.body.profile._id, undefined);
  assert.equal(saved.body.profile.portalTokenVersion, undefined);
});

// ---------- auth boundaries ----------

test('staff and customer tokens are not interchangeable, and tampered/revoked tokens are rejected', async () => {
  await clearOtps('61400111006');
  const a = await signIn('0400111006');

  assert.equal((await api('GET', '/api/portal/me', { token: staffToken })).status, 401);
  assert.equal((await api('GET', '/api/customers', { token: a.token })).status, 401);
  assert.equal((await api('GET', '/api/bookings', { token: a.token })).status, 401);
  assert.equal((await api('GET', '/api/portal/me')).status, 401);

  const [body, sig] = a.token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  payload.sub = new ObjectId().toString();
  const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
  assert.equal((await api('GET', '/api/portal/me', { token: forged })).status, 401);

  assert.equal((await api('POST', '/api/portal/auth/logout-all', { token: a.token })).status, 200);
  assert.equal((await api('GET', '/api/portal/me', { token: a.token })).status, 401);
});

// ---------- bookings, BL, shipments, privacy ----------

let custA;
let custB;
let bookingA;
let bookingB;

test('scenario 5 + 11: a booking belongs to the signed-in customer and its reference comes from the backend', async () => {
  await clearOtps('61400222001');
  await clearOtps('61400222002');
  custA = await signIn('0400222001');
  custB = await signIn('0400222002');
  await api('PATCH', '/api/portal/me', { token: custA.token, body: { name: 'Customer Alpha' } });
  await api('PATCH', '/api/portal/me', { token: custB.token, body: { name: 'Customer Beta' } });

  const options = await api('GET', '/api/portal/booking-options', { token: custA.token });
  assert.equal(options.status, 200);
  assert.ok(options.body.dropOffDates.length > 0);

  const invalid = await api('POST', '/api/portal/bookings', {
    token: custA.token,
    body: { country: 'sri_lanka', service: 'sea', items: [], ...decl('Kandy'), deliveryType: 'door', dropOff: nextDropOff(options.body) }
  });
  assert.equal(invalid.status, 400);

  const created = await api('POST', '/api/portal/bookings', {
    token: custA.token,
    body: {
      country: 'sri_lanka', service: 'sea',
      items: [{ type: 'tea_chest', qty: 2 }],
      ...decl('Kandy'), deliveryType: 'door',
      dropOff: nextDropOff(options.body),
      // A browser-supplied owner must be ignored.
      customerId: String(new ObjectId())
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  bookingA = created.body.booking;
  assert.match(bookingA.code, /^BK-\d{6}$/);
  assert.equal(bookingA.items, '2 Tea Chests');
  assert.equal(bookingA.blNumber, null);
  assert.equal(bookingA.steps.find(s => s.key === 'bl_assigned').done, false);

  const stored = await db.collection('bookings').findOne({ _id: new ObjectId(bookingA.id) });
  const ownerA = await db.collection('customers').findOne({ phoneNumber: '61400222001' });
  assert.equal(String(stored.customerId), String(ownerA._id));
  assert.equal(stored.bookingCode, bookingA.code);

  const createdB = await api('POST', '/api/portal/bookings', {
    token: custB.token,
    body: {
      country: 'sri_lanka', service: 'air', items: [{ type: 'gift_box', qty: 1 }],
      ...decl('Colombo'), deliveryType: 'collect', dropOff: nextDropOff(options.body)
    }
  });
  assert.equal(createdB.status, 201);
  bookingB = createdB.body.booking;
});

test('scenario 8: a customer cannot read, cancel or track another customer\'s booking', async () => {
  const read = await api('GET', `/api/portal/bookings/${bookingA.id}`, { token: custB.token });
  assert.equal(read.status, 404);

  const cancel = await api('POST', `/api/portal/bookings/${bookingA.id}/cancel`, { token: custB.token });
  assert.equal(cancel.status, 404);

  const listB = await api('GET', '/api/portal/bookings', { token: custB.token });
  assert.ok(!listB.body.bookings.some(b => b.id === bookingA.id));

  const own = await api('GET', `/api/portal/bookings/${bookingA.id}`, { token: custA.token });
  assert.equal(own.status, 200);
});

test('scenario 6 + 7: staff assign BLs; each customer sees only their own BL, even in the same bulk shipment', async () => {
  await db.collection('consolidations').insertOne({ batchNumber: 57 });

  const noAuth = await api('POST', `/api/bookings/${bookingA.id}/bl`, { body: { hblNumber: '203115' } });
  assert.equal(noAuth.status, 401);
  const asCustomer = await api('POST', `/api/bookings/${bookingA.id}/bl`, { token: custA.token, body: { hblNumber: '203115' } });
  assert.equal(asCustomer.status, 401);

  const assignA = await api('POST', `/api/bookings/${bookingA.id}/bl`, { token: staffToken, body: { hblNumber: '203115', batchNumber: 57 } });
  assert.equal(assignA.status, 201, JSON.stringify(assignA.body));
  const assignB = await api('POST', `/api/bookings/${bookingB.id}/bl`, { token: staffToken, body: { hblNumber: '203116', batchNumber: 57 } });
  assert.equal(assignB.status, 201);

  const clash = await api('POST', `/api/bookings/${bookingB.id}/bl`, { token: staffToken, body: { hblNumber: '203115' } });
  assert.equal(clash.status, 409);

  const shipmentsA = await api('GET', '/api/portal/shipments', { token: custA.token });
  assert.equal(shipmentsA.body.shipments.length, 1);
  assert.equal(shipmentsA.body.shipments[0].blNumber, '203115');
  assert.equal(shipmentsA.body.shipments[0].batchLabel, 'Shipment 57');
  assert.ok(!JSON.stringify(shipmentsA.body).includes('203116'));
  assert.ok(!JSON.stringify(shipmentsA.body).includes('Customer Beta'));

  const bookingNow = await api('GET', `/api/portal/bookings/${bookingA.id}`, { token: custA.token });
  assert.equal(bookingNow.body.booking.blNumber, '203115');
  const steps = Object.fromEntries(bookingNow.body.booking.steps.map(s => [s.key, s.done]));
  assert.equal(steps.warehouse_received, true);
  assert.equal(steps.bl_assigned, true);
  assert.equal(steps.in_transit, false);
  // Submitted online with the booking — the customer's part is done.
  assert.equal(steps.declaration, true);
  assert.equal(bookingNow.body.booking.declaration.status, 'submitted');

  const shipmentBId = (await api('GET', '/api/portal/shipments', { token: custB.token })).body.shipments[0].id;
  assert.equal((await api('GET', `/api/portal/shipments/${shipmentBId}`, { token: custA.token })).status, 404);
  assert.equal((await api('GET', `/api/portal/shipments/${shipmentBId}/tracking`, { token: custA.token })).status, 404);
});

test('staff can record the declaration as received after checking it', async () => {
  const res = await api('PATCH', `/api/bookings/${bookingA.id}`, { token: staffToken, body: { declarationStatus: 'received' } });
  assert.equal(res.status, 200);
  const bad = await api('PATCH', `/api/bookings/${bookingA.id}`, { token: staffToken, body: { declarationStatus: 'maybe' } });
  assert.equal(bad.status, 400);
  const view = await api('GET', `/api/portal/bookings/${bookingA.id}`, { token: custA.token });
  assert.equal(view.body.booking.declaration.status, 'received');
});

test('a booking can no longer be cancelled online once a BL is assigned; a fresh one can', async () => {
  const locked = await api('POST', `/api/portal/bookings/${bookingA.id}/cancel`, { token: custA.token });
  assert.equal(locked.status, 409);

  const options = await api('GET', '/api/portal/booking-options', { token: custA.token });
  const fresh = await api('POST', '/api/portal/bookings', {
    token: custA.token,
    body: { country: 'india', service: 'sea', items: [{ type: 'general', qty: 1 }], ...decl('Chennai'), deliveryType: 'collect', dropOff: nextDropOff(options.body) }
  });
  assert.equal(fresh.status, 201);
  const cancelled = await api('POST', `/api/portal/bookings/${fresh.body.booking.id}/cancel`, { token: custA.token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.booking.status.key, 'cancelled');
});

// ---------- signed-in chat ----------

test('signed-in chat: "what is my BL?" is answered from the database, not the assistant', async () => {
  flowiseRequests = [];
  const res = await chat('agentsite-a-1', { message: "What's my BL number?" }, custA.token);
  assert.equal(res.status, 200);
  assert.equal(flowiseRequests.length, 0);
  assert.equal(res.body.cards[0].title, 'BL 203115');
  assert.ok(!JSON.stringify(res.body).includes('203116'));

  const transcript = await db.collection('customers').findOne({ sessionId: 'agentsite-a-1' });
  const owner = await db.collection('customers').findOne({ phoneNumber: '61400222001' });
  assert.equal(String(transcript.linkedCustomerId), String(owner._id));
});

test('scenario 10: tracking uses the real tracker result and never invents dates when it is unavailable', async () => {
  const shipmentAId = (await api('GET', '/api/portal/shipments', { token: custA.token })).body.shipments[0].id;

  peblMode = 'found';
  const found = await chat('agentsite-a-2', { action: 'track_shipment', shipmentId: shipmentAId, label: 'Track this' }, custA.token);
  assert.match(found.body.reply, /BL\): 203115/);
  assert.match(found.body.reply, /12 Nov 2026/);

  peblMode = 'down';
  const down = await chat('agentsite-a-2', { action: 'track_shipment', shipmentId: shipmentAId }, custA.token);
  assert.match(down.body.reply, /couldn't reach the shipping line tracker/);
  assert.doesNotMatch(down.body.reply, /Estimated arrival/);

  peblMode = 'missing';
  const missing = await api('GET', `/api/portal/shipments/${shipmentAId}/tracking`, { token: custA.token });
  assert.equal(missing.body.live.state, 'not_found');
  peblMode = 'found';
});

test('signed-in chat cannot be used to track someone else\'s shipment', async () => {
  const shipmentBId = (await api('GET', '/api/portal/shipments', { token: custB.token })).body.shipments[0].id;
  const res = await chat('agentsite-a-3', { action: 'track_shipment', shipmentId: shipmentBId }, custA.token);
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /couldn't find that shipment/);
  assert.ok(!JSON.stringify(res.body).includes('203116'));

  const anon = await chat('agentsite-anon-4', { action: 'track_shipment', shipmentId: shipmentBId });
  assert.match(anon.body.reply, /sign in/i);
  assert.ok(!JSON.stringify(anon.body).includes('203116'));
});

test('signed-in chat booking via the assistant is saved to the account with a backend reference', async () => {
  // Not the session's first message (a brand-new session's first reply
  // gets the welcome text prepended — see webChatRoutes.js).
  flowiseReplyText = 'Sure, which day suits you?';
  await chat('agentsite-b-1', { message: 'I want to drop off boxes' }, custB.token);
  flowiseReplyText = '[[BOOK_DROPOFF:day=saturday;time=12:00;date=;boxes=3 Tea Chest boxes]]Great, see you Saturday at 12pm!';
  const res = await chat('agentsite-b-1', { message: 'Book me in for Saturday at 12' }, custB.token);
  assert.equal(res.status, 200);
  const ref = res.body.reply.match(/Booking reference: \*(BK-\d{6})\*/);
  assert.ok(ref, res.body.reply);

  const stored = await db.collection('bookings').findOne({ bookingCode: ref[1] });
  const ownerB = await db.collection('customers').findOne({ phoneNumber: '61400222002' });
  assert.equal(String(stored.customerId), String(ownerB._id));
  assert.equal(stored.customerName, 'Customer Beta');
  flowiseReplyText = 'Stubbed Flowise reply';
});

test('anonymous chat with a forged customer token behaves like the public chat', async () => {
  flowiseRequests = [];
  const res = await chat('agentsite-forged', { message: 'Show my bookings' }, 'abc.def');
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /sign in/i);
});

// ---------- phone + password ----------

test('password sign-up: a new number gets an account straight away and can book', async () => {
  const reg = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400333001', name: 'Priya Nadarajah', password: 'harbour-lights-9' }
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.match(reg.body.profile.customerCode, /^CUS-\d{6}$/);
  assert.equal(reg.body.profile.phoneVerified, false);
  assert.equal(reg.body.profile.hasPassword, true);

  const stored = await db.collection('customers').findOne({ phoneNumber: '61400333001' });
  assert.notEqual(stored.passwordHash, 'harbour-lights-9');

  const options = await api('GET', '/api/portal/booking-options', { token: reg.body.token });
  const created = await api('POST', '/api/portal/bookings', {
    token: reg.body.token,
    body: { country: 'sri_lanka', service: 'sea', items: [{ type: 'tea_chest', qty: 1 }], ...decl('Jaffna'), deliveryType: 'door', dropOff: nextDropOff(options.body) }
  });
  assert.equal(created.status, 201);
  const list = await api('GET', '/api/portal/bookings', { token: reg.body.token });
  assert.equal(list.body.bookings.length, 1);
});

test('password sign-up is refused for a number that already has history, and for weak input', async () => {
  await db.collection('customers').insertOne({ phoneNumber: '61400333002', name: 'Existing WhatsApp', mode: 'CHATBOT', status: 'ACTIVE', sources: ['whatsapp'] });
  const known = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400333002', name: 'Someone Else', password: 'long-enough-pw' }
  });
  assert.equal(known.status, 409);
  assert.equal(known.body.reason, 'known_number');
  const unchanged = await db.collection('customers').findOne({ phoneNumber: '61400333002' });
  assert.equal(unchanged.name, 'Existing WhatsApp');
  assert.equal(unchanged.passwordHash, undefined);

  const short = await api('POST', '/api/portal/auth/register', { body: { countryCode: '61', phone: '0400333003', name: 'Ann Lee', password: 'short' } });
  assert.equal(short.status, 400);
  assert.equal(short.body.field, 'password');

  const again = await api('POST', '/api/portal/auth/register', { body: { countryCode: '61', phone: '0400333001', name: 'Priya N', password: 'another-password' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.reason, 'has_account');
});

test('password sign-in works, gives one message for every failure, and locks after 5 wrong tries', async () => {
  const ok = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400 333 001', password: 'harbour-lights-9' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const wrong = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400333001', password: 'nope-nope-nope' } });
  const unknown = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400999999', password: 'nope-nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error, unknown.body.error);

  for (let i = 0; i < 4; i++) {
    await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400333001', password: 'still-wrong-pw' } });
  }
  const locked = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400333001', password: 'harbour-lights-9' } });
  assert.equal(locked.status, 429);
  await db.collection('customers').updateOne({ phoneNumber: '61400333001' }, { $unset: { portalLockedUntil: '' }, $set: { portalLoginFailures: 0 } });
});

test('an unproven password account never sees other history on its number; a WhatsApp code by the real owner removes the impostor', async () => {
  const reg = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400333004', name: 'Impostor', password: 'impostor-pass-1' }
  });
  assert.equal(reg.status, 201);
  const record = await db.collection('customers').findOne({ phoneNumber: '61400333004' });

  // The real owner later books over WhatsApp / gets a BL — lands on the same number.
  const { insertedId: waBooking } = await db.collection('bookings').insertOne({
    customerId: record._id, customerName: 'Real Owner', phoneNumber: '61400333004',
    requestedDay: 'saturday', requestedTime: '12:00', requestedDateISO: '2026-10-03', channel: 'whatsapp', status: 'pending', createdAt: new Date()
  });
  await db.collection('shipments').insertOne({ customerId: record._id, hblNumber: '777001', status: 'in_transit', createdAt: new Date().toISOString() });

  const seen = await api('GET', '/api/portal/bookings', { token: reg.body.token });
  assert.equal(seen.body.bookings.length, 0);
  const seenShip = await api('GET', '/api/portal/shipments', { token: reg.body.token });
  assert.equal(seenShip.body.shipments.length, 0);
  assert.equal((await api('GET', `/api/portal/bookings/${waBooking}`, { token: reg.body.token })).status, 404);
  const chatBl = await chat('agentsite-impostor', { message: "What's my BL number?" }, reg.body.token);
  assert.ok(!JSON.stringify(chatBl.body).includes('777001'));

  // Real owner proves the number with a WhatsApp code (signed out).
  await clearOtps('61400333004');
  const owner = await signIn('0400333004');
  assert.equal(owner.profile.phoneVerified, true);
  assert.equal(owner.profile.hasPassword, false);
  assert.equal((await api('GET', '/api/portal/me', { token: reg.body.token })).status, 401);
  const impostorLogin = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400333004', password: 'impostor-pass-1' } });
  assert.equal(impostorLogin.status, 401);
  const ownerSees = await api('GET', '/api/portal/shipments', { token: owner.token });
  assert.equal(ownerSees.body.shipments[0].blNumber, '777001');
});

test('a signed-in password customer verifying their own number keeps their password', async () => {
  const reg = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400333005', name: 'Kavya Raj', password: 'kavya-password-1' }
  });
  await clearOtps('61400333005');
  await api('POST', '/api/portal/auth/request-code', { body: { countryCode: '61', phone: '0400333005' } });
  const code = lastCodeSentTo('61400333005');
  const verified = await api('POST', '/api/portal/auth/verify-code', { token: reg.body.token, body: { countryCode: '61', phone: '0400333005', code } });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.profile.phoneVerified, true);
  assert.equal(verified.body.profile.hasPassword, true);
  const login = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400333005', password: 'kavya-password-1' } });
  assert.equal(login.status, 200);
});

test('customers can set/change their password; staff can reset one (and customers cannot)', async () => {
  await clearOtps('61400333006');
  const a = await signIn('0400333006');
  const set = await api('PUT', '/api/portal/me/password', { token: a.token, body: { newPassword: 'first-password-1' } });
  assert.equal(set.status, 200);
  const badChange = await api('PUT', '/api/portal/me/password', { token: a.token, body: { currentPassword: 'wrong', newPassword: 'second-password-2' } });
  assert.equal(badChange.status, 400);
  assert.equal(badChange.body.field, 'currentPassword');

  await db.collection('customers').insertOne({ phoneNumber: '61400333007', name: 'Called In', mode: 'CHATBOT', status: 'ACTIVE', sources: ['whatsapp'] });
  const target = await db.collection('customers').findOne({ phoneNumber: '61400333007' });
  const asCustomer = await api('POST', `/api/customers/${target._id}/portal-password`, { token: a.token, body: { password: 'temp-pass-123' } });
  assert.equal(asCustomer.status, 401);
  const reset = await api('POST', `/api/customers/${target._id}/portal-password`, { token: staffToken, body: { password: 'temp-pass-123' } });
  assert.equal(reset.status, 200);
  assert.match(reset.body.customerCode, /^CUS-\d{6}$/);
  const login = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400333007', password: 'temp-pass-123' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.profile.phoneVerified, true);
});

// ---------- staff live event stream (WebSocket) ----------

function openWs(protocols) {
  const WebSocket = require('ws');
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`, protocols);
    const events = [];
    ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve({ ok: true, ws, events }));
    ws.on('unexpected-response', (req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on('error', () => resolve({ ok: false, status: 'error' }));
  });
}

test('the staff live event stream refuses anonymous and customer connections, and delivers to staff', async () => {
  const anon = await openWs();
  assert.equal(anon.ok, false);
  assert.equal(anon.status, 401);

  const fake = await openWs(['transco-staff', 'abc.def']);
  assert.equal(fake.ok, false);

  await clearOtps('61400444001');
  const customer = await signIn('0400444001');
  const asCustomer = await openWs(['transco-staff', customer.token]);
  assert.equal(asCustomer.ok, false);
  assert.equal(asCustomer.status, 401);

  const staff = await openWs(['transco-staff', staffToken]);
  assert.equal(staff.ok, true);
  assert.equal(staff.ws.protocol, 'transco-staff');

  // A live event reaches the staff connection.
  flowiseReplyText = 'Live event check';
  await chat('agentsite-ws-check', { message: 'Hello there' });
  await new Promise(r => setTimeout(r, 500));
  assert.ok(staff.events.some(e => e.type === 'message.created'), JSON.stringify(staff.events.map(e => e.type)));
  staff.ws.close();
});

// ---------- CRM → My Transco (staff) ----------

test('staff My Transco list: staff only; lists accounts, not website visitors or WhatsApp-only contacts', async () => {
  const reg = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400555001', name: 'Crm Listed', password: 'crm-listed-pass' }
  });
  assert.equal(reg.status, 201);
  await db.collection('customers').insertOne({ phoneNumber: '61400555099', name: 'WhatsApp Only', mode: 'CHATBOT', status: 'ACTIVE', sources: ['whatsapp'] });

  assert.equal((await api('GET', '/api/my-transco/customers')).status, 401);
  assert.equal((await api('GET', '/api/my-transco/customers', { token: reg.body.token })).status, 401);

  const list = await api('GET', '/api/my-transco/customers', { token: staffToken });
  assert.equal(list.status, 200);
  const phones = list.body.customers.map(c => c.phoneNumber);
  assert.ok(phones.includes('61400555001'));
  assert.ok(!phones.includes('61400555099'));
  assert.ok(!list.body.customers.some(c => /^agentsite-/.test(c.phoneNumber)));
  const row = list.body.customers.find(c => c.phoneNumber === '61400555001');
  assert.equal(row.phoneVerified, false);
  assert.equal(row.hasPassword, true);
  assert.match(row.customerCode, /^CUS-\d{6}$/);
  assert.ok(list.body.stats.accounts >= 1);
  assert.equal(JSON.stringify(list.body).includes('passwordHash'), false);
});

test('staff profile shows the full history; staff verify / sign-out / unlock / edit work', async () => {
  const reg = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400555002', name: 'Crm Profile', password: 'crm-profile-pass' }
  });
  const record = await db.collection('customers').findOne({ phoneNumber: '61400555002' });
  await db.collection('bookings').insertOne({
    customerId: record._id, customerName: 'Crm Profile', phoneNumber: '61400555002',
    requestedDay: 'saturday', requestedTime: '12:00', requestedDateISO: '2026-10-03', channel: 'whatsapp', status: 'pending', createdAt: new Date()
  });

  // Customer (unverified) can't see the WhatsApp booking; staff can.
  assert.equal((await api('GET', '/api/portal/bookings', { token: reg.body.token })).body.bookings.length, 0);
  const detail = await api('GET', `/api/my-transco/customers/${record._id}`, { token: staffToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.bookings.length, 1);
  assert.equal(detail.body.bookings[0].channel, 'whatsapp');
  assert.equal(detail.body.bookings[0].declarationStatus, 'not_received');
  assert.ok(Array.isArray(detail.body.bookings[0].steps));
  assert.equal(detail.body.customer.phoneVerified, false);

  // Edit (validated the same way as the customer's own form).
  assert.equal((await api('PATCH', `/api/my-transco/customers/${record._id}`, { token: staffToken, body: { email: 'bad' } })).status, 400);
  assert.equal((await api('PATCH', `/api/my-transco/customers/${record._id}`, { token: staffToken, body: { email: 'crm@example.com', preferredLanguage: 'ta' } })).status, 200);

  // Verify phone -> customer now sees the history.
  assert.equal((await api('POST', `/api/my-transco/customers/${record._id}/verify-phone`, { token: staffToken })).status, 200);
  assert.equal((await api('GET', '/api/portal/bookings', { token: reg.body.token })).body.bookings.length, 1);

  // Sign out everywhere -> token dead.
  assert.equal((await api('POST', `/api/my-transco/customers/${record._id}/sign-out`, { token: staffToken })).status, 200);
  assert.equal((await api('GET', '/api/portal/me', { token: reg.body.token })).status, 401);

  // Unlock after lockout.
  await db.collection('customers').updateOne({ _id: record._id }, { $set: { portalLockedUntil: new Date(Date.now() + 600000) } });
  assert.equal((await api('GET', `/api/my-transco/customers/${record._id}`, { token: staffToken })).body.customer.locked, true);
  assert.equal((await api('POST', `/api/my-transco/customers/${record._id}/unlock`, { token: staffToken })).status, 200);
  const login = await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400555002', password: 'crm-profile-pass' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.profile.email, 'crm@example.com');
});

// ---------- email sign-in + phone change ----------

test('email: sign up with an email, then sign in with it (any case); wrong password is refused', async () => {
  const reg = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400666001', name: 'Email User', password: 'email-user-pass', email: 'Email.User@Example.com' }
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.profile.email, 'email.user@example.com');

  const ok = await api('POST', '/api/portal/auth/login', { body: { email: ' EMAIL.user@example.COM ', password: 'email-user-pass' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile.phoneNumber, '61400666001');

  const bad = await api('POST', '/api/portal/auth/login', { body: { email: 'email.user@example.com', password: 'nope-nope-nope' } });
  const unknown = await api('POST', '/api/portal/auth/login', { body: { email: 'nobody@example.com', password: 'nope-nope-nope' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, unknown.body.error);
});

test('email: one account per email — refused at sign-up and on profile/staff edits', async () => {
  const dup = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400666002', name: 'Second User', password: 'second-user-pass', email: 'email.user@example.com' }
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.reason, 'email_taken');
  assert.equal(await db.collection('customers').countDocuments({ phoneNumber: '61400666002' }), 0);

  const other = await api('POST', '/api/portal/auth/register', {
    body: { countryCode: '61', phone: '0400666003', name: 'Third User', password: 'third-user-pass' }
  });
  const clash = await api('PATCH', '/api/portal/me', { token: other.body.token, body: { email: 'EMAIL.USER@example.com' } });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.field, 'email');

  const record = await db.collection('customers').findOne({ phoneNumber: '61400666003' });
  const staffClash = await api('PATCH', `/api/my-transco/customers/${record._id}`, { token: staffToken, body: { email: 'email.user@example.com' } });
  assert.equal(staffClash.status, 409);

  // Keeping your own email is fine.
  const same = await api('POST', '/api/portal/auth/login', { body: { email: 'email.user@example.com', password: 'email-user-pass' } });
  assert.equal((await api('PATCH', '/api/portal/me', { token: same.body.token, body: { email: 'email.user@example.com' } })).status, 200);
});

test('staff can change a customer\'s phone number; history stays; clashes are refused; email sign-in keeps working', async () => {
  const login = await api('POST', '/api/portal/auth/login', { body: { email: 'email.user@example.com', password: 'email-user-pass' } });
  const record = await db.collection('customers').findOne({ phoneNumber: '61400666001' });
  await db.collection('bookings').insertOne({
    customerId: record._id, customerName: 'Email User', phoneNumber: '61400666001',
    requestedDay: 'saturday', requestedTime: '12:00', requestedDateISO: '2026-10-03', channel: 'portal', createdByAccount: true, status: 'pending', createdAt: new Date()
  });

  assert.equal((await api('POST', `/api/my-transco/customers/${record._id}/change-phone`, { token: login.body.token, body: { countryCode: '61', phone: '0400666099' } })).status, 401);

  const clash = await api('POST', `/api/my-transco/customers/${record._id}/change-phone`, { token: staffToken, body: { countryCode: '61', phone: '0400666003' } });
  assert.equal(clash.status, 409);

  const changed = await api('POST', `/api/my-transco/customers/${record._id}/change-phone`, { token: staffToken, body: { countryCode: '94', phone: '0771112233' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.phoneNumber, '94771112233');

  const after = await db.collection('customers').findOne({ _id: record._id });
  assert.equal(after.phoneNumber, '94771112233');
  assert.equal(after.previousPhoneNumbers[0].phoneNumber, '61400666001');

  // Same session still works and still sees the booking.
  assert.equal((await api('GET', '/api/portal/bookings', { token: login.body.token })).body.bookings.length, 1);
  // Email and new number both sign in; the old number no longer does.
  assert.equal((await api('POST', '/api/portal/auth/login', { body: { email: 'email.user@example.com', password: 'email-user-pass' } })).status, 200);
  assert.equal((await api('POST', '/api/portal/auth/login', { body: { countryCode: '94', phone: '0771112233', password: 'email-user-pass' } })).status, 200);
  assert.equal((await api('POST', '/api/portal/auth/login', { body: { countryCode: '61', phone: '0400666001', password: 'email-user-pass' } })).status, 401);
});

test('website country pages: the country reaches the assistant once, never as a saved message', async () => {
  const sessionId = `agentsite-country-${Date.now()}`;
  const ask = async (message, country) => {
    flowiseRequests = [];
    const res = await chat(sessionId, country ? { message, country } : { message });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(flowiseRequests.length, 1);
    return flowiseRequests[0].question;
  };

  // First question from the Sri Lanka page carries the country…
  assert.equal(await ask('How much for door delivery?', 'sri_lanka'), "I'm shipping to Sri Lanka. How much for door delivery?");
  // …follow-ups (or another visit to the same page) don't repeat it.
  assert.equal(await ask('And for 2 boxes?', 'sri_lanka'), 'And for 2 boxes?');
  // Switching to the India page tells the assistant once more.
  assert.equal(await ask('What about India?', 'india'), "I'm shipping to India. What about India?");
  // Saying the country themselves counts — no doubled phrase afterwards.
  assert.equal(await ask("I'm shipping to Sri Lanka"), "I'm shipping to Sri Lanka");
  assert.equal(await ask('Door delivery price?', 'sri_lanka'), 'Door delivery price?');
  // Unknown values from an old/odd page are ignored, not an error.
  assert.equal(await ask('Hello again', 'narnia'), 'Hello again');

  // The transcript holds only what the visitor actually typed.
  const visitor = await db.collection('customers').findOne({ sessionId, channel: 'website' });
  const said = (await db.collection('messages').find({ customerId: visitor._id, senderType: 'CUSTOMER' }).toArray()).map(m => m.content);
  assert.deepEqual(said, ['How much for door delivery?', 'And for 2 boxes?', 'What about India?', "I'm shipping to Sri Lanka", 'Door delivery price?', 'Hello again']);
});

test('declaration: sender details are remembered only for the account holder, receivers are suggested next time, staff can print it', async () => {
  await clearOtps('61400777001');
  const me = await signIn('0400777001');
  await api('PATCH', '/api/portal/me', { token: me.token, body: { name: 'Decla Ration', email: 'decla@example.com' } });

  // First booking: nothing saved yet, so the form is pre-filled from the profile.
  let options = await api('GET', '/api/portal/booking-options', { token: me.token });
  assert.equal(options.body.declaration.senderSaved, false);
  assert.equal(options.body.declaration.sender.fullName, 'Decla Ration');
  assert.equal(options.body.declaration.sender.email, 'decla@example.com');
  assert.equal(options.body.declaration.sender.mobile, '+61400777001');
  assert.deepEqual(options.body.declaration.receivers, []);

  // Every field is required — a missing receiver email is refused and named.
  const noEmail = await api('POST', '/api/portal/bookings', {
    token: me.token,
    body: { country: 'sri_lanka', service: 'sea', items: [{ type: 'tea_chest', qty: 1 }], ...decl('Kandy', { receiver: { email: '' } }), deliveryType: 'collect', dropOff: nextDropOff(options.body) }
  });
  assert.equal(noEmail.status, 400);
  assert.equal(noEmail.body.field, 'receiver.email');
  const badId = await api('POST', '/api/portal/bookings', {
    token: me.token,
    body: { country: 'sri_lanka', service: 'sea', items: [{ type: 'tea_chest', qty: 1 }], ...decl('Kandy', { receiver: { idNumber: '12' } }), deliveryType: 'collect', dropOff: nextDropOff(options.body) }
  });
  assert.equal(badId.body.field, 'receiver.idNumber');

  // Collect from warehouse: no separate delivery location — the receiver's town is the destination.
  const first = await api('POST', '/api/portal/bookings', {
    token: me.token,
    body: {
      country: 'sri_lanka', service: 'sea', items: [{ type: 'tea_chest', qty: 1 }], deliveryType: 'collect', dropOff: nextDropOff(options.body),
      ...decl('Kandy', { sender: { fullName: 'Decla Ration Perera', address: '5 Home St, Blacktown NSW 2148' } })
    }
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.booking.destination, 'Kandy');
  assert.equal(first.body.booking.declaration.status, 'submitted');
  assert.equal(first.body.booking.declaration.receiver.fullName, 'Rita Receiver');
  // The customer's own view never echoes the receiver's ID number back.
  assert.ok(!JSON.stringify(first.body).includes('199012345678'));

  // Second booking: the account holder's details are now the saved ones, and the receiver is suggested.
  options = await api('GET', '/api/portal/booking-options', { token: me.token });
  assert.equal(options.body.declaration.senderSaved, true);
  assert.equal(options.body.declaration.sender.fullName, 'Decla Ration Perera');
  assert.equal(options.body.declaration.receivers.length, 1);
  const saved = options.body.declaration.receivers[0];
  assert.equal(saved.idNumber, '199012345678');
  assert.equal(saved.country, 'sri_lanka');

  // Someone else sends this time: their details must not replace the saved ones.
  // Same receiver again (by ID number) updates the entry instead of duplicating it.
  const second = await api('POST', '/api/portal/bookings', {
    token: me.token,
    body: {
      country: 'sri_lanka', service: 'sea', items: [{ type: 'gift_box', qty: 1 }], deliveryType: 'door', dropOff: nextDropOff(options.body),
      ...decl('Kandy', { sender: { isMe: false, fullName: 'Cousin Sender', email: 'cousin@example.com' }, receiver: { address: '14 New Temple Rd' } })
    }
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  options = await api('GET', '/api/portal/booking-options', { token: me.token });
  assert.equal(options.body.declaration.sender.fullName, 'Decla Ration Perera');
  assert.equal(options.body.declaration.receivers.length, 1);
  assert.equal(options.body.declaration.receivers[0].address, '14 New Temple Rd');

  // Staff: full details on the customer page and a print endpoint; customers can't reach it.
  const record = await db.collection('customers').findOne({ phoneNumber: '61400777001' });
  const detail = await api('GET', `/api/my-transco/customers/${record._id}`, { token: staffToken });
  const staffBooking = detail.body.bookings.find(b => b.id === second.body.booking.id);
  assert.equal(staffBooking.sender.fullName, 'Cousin Sender');
  assert.equal(staffBooking.senderIsAccountHolder, false);
  assert.equal(staffBooking.receiver.idNumber, '199012345678');
  assert.ok(staffBooking.declarationSubmittedAt);

  assert.equal((await api('GET', `/api/my-transco/bookings/${second.body.booking.id}/declaration`, { token: me.token })).status, 401);
  const print = await api('GET', `/api/my-transco/bookings/${second.body.booking.id}/declaration`, { token: staffToken });
  assert.equal(print.status, 200, JSON.stringify(print.body));
  assert.equal(print.body.declaration.bookingCode, second.body.booking.code);
  assert.equal(print.body.declaration.sender.fullName, 'Cousin Sender');
  assert.equal(print.body.declaration.receiver.town, 'Kandy');
  assert.equal(print.body.declaration.delivery, 'Door delivery');
  assert.deepEqual(print.body.declaration.items, [{ label: 'Gift Box', qty: 1 }]);
  assert.equal(print.body.declaration.customer.phoneNumber, '61400777001');
  assert.equal(print.body.declaration.customer.id, String(record._id));
  assert.equal((await api('GET', `/api/my-transco/bookings/${new ObjectId()}/declaration`, { token: staffToken })).status, 404);
});

test('dashboard: counts declarations to check and BLs to assign from real bookings', async () => {
  const before = (await api('GET', '/api/dashboard/summary', { token: staffToken })).body;
  assert.equal(typeof before.declarationsToCheck, 'number');
  assert.equal(typeof before.blsToAssign, 'number');
  assert.equal(typeof before.conversationsWaiting, 'number');
  assert.ok(Array.isArray(before.todaysDropOffs));

  // A fresh online booking adds one declaration to check…
  await clearOtps('61400777002');
  const me = await signIn('0400777002');
  const options = await api('GET', '/api/portal/booking-options', { token: me.token });
  const made = await api('POST', '/api/portal/bookings', {
    token: me.token,
    body: { country: 'sri_lanka', service: 'sea', items: [{ type: 'tea_chest', qty: 1 }], ...decl('Galle'), deliveryType: 'collect', dropOff: nextDropOff(options.body) }
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  let now = (await api('GET', '/api/dashboard/summary', { token: staffToken })).body;
  assert.equal(now.declarationsToCheck, before.declarationsToCheck + 1);

  // …checking it removes it; boxes received without a BL adds one BL to assign.
  await api('PATCH', `/api/bookings/${made.body.booking.id}`, { token: staffToken, body: { declarationStatus: 'received', warehouseStatus: 'received' } });
  now = (await api('GET', '/api/dashboard/summary', { token: staffToken })).body;
  assert.equal(now.declarationsToCheck, before.declarationsToCheck);
  assert.equal(now.blsToAssign, before.blsToAssign + 1);

  // Staff only.
  assert.equal((await api('GET', '/api/dashboard/summary', { token: me.token })).status, 401);
});

test('staff customer endpoints never send sign-in secrets, and flag online accounts', async () => {
  const record = await db.collection('customers').findOne({ passwordHash: { $exists: true } });
  assert.ok(record, 'a customer with a password exists from earlier tests');

  const list = await api('GET', '/api/customers', { token: staffToken });
  assert.equal(list.status, 200);
  const raw = JSON.stringify(list.body);
  assert.ok(!raw.includes('passwordHash'), 'list must not include password hashes');
  assert.ok(!raw.includes('portalTokenVersion'));
  const listed = (list.body.customers || list.body).find(c => String(c._id) === String(record._id));
  assert.equal(listed.hasOnlineAccount, true);

  const profile = await api('GET', `/api/customers/${record._id}/profile`, { token: staffToken });
  assert.equal(profile.status, 200);
  assert.ok(!JSON.stringify(profile.body).includes('passwordHash'));
  assert.equal(profile.body.customer.hasOnlineAccount, true);
  assert.ok(profile.body.customer.customerCode);
});

test('staff can edit a booking after drop-off (boxes, receiver), with validation and a change record', async () => {
  await clearOtps('61400777003');
  const me = await signIn('0400777003');
  const options = await api('GET', '/api/portal/booking-options', { token: me.token });
  const made = await api('POST', '/api/portal/bookings', {
    token: me.token,
    body: { country: 'sri_lanka', service: 'sea', items: [{ type: 'tea_chest', qty: 1 }], ...decl('Kandy'), deliveryType: 'collect', dropOff: nextDropOff(options.body) }
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.booking.id;

  // Customers can't reach the staff edit endpoints.
  assert.equal((await api('GET', `/api/my-transco/bookings/${id}/edit`, { token: me.token })).status, 401);
  assert.equal((await api('PATCH', `/api/my-transco/bookings/${id}/details`, { token: me.token, body: { items: [] } })).status, 401);

  const edit = await api('GET', `/api/my-transco/bookings/${id}/edit`, { token: staffToken });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.booking.country, 'sri_lanka');
  assert.ok(edit.body.booking.itemTypes.some(t => t.key === 'gift_box'));
  assert.deepEqual(edit.body.booking.items, [{ type: 'tea_chest', qty: 1 }]);

  // Bad input is refused and nothing changes.
  const bad = await api('PATCH', `/api/my-transco/bookings/${id}/details`, { token: staffToken, body: { items: [{ type: 'tv_huge', qty: 1 }] } });
  assert.equal(bad.status, 400);
  const badPerson = await api('PATCH', `/api/my-transco/bookings/${id}/details`, { token: staffToken, body: { receiver: { ...decl('Kandy').receiver, idNumber: '1' } } });
  assert.equal(badPerson.body.field, 'receiver.idNumber');

  // The customer brought 2 tea chests + a gift box, and a different town.
  const saved = await api('PATCH', `/api/my-transco/bookings/${id}/details`, {
    token: staffToken,
    body: { items: [{ type: 'tea_chest', qty: 2 }, { type: 'gift_box', qty: 1 }], receiver: { ...decl('Galle').receiver, fullName: 'Rita Receiver-Perera' }, deliveryType: 'door' }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.changed.sort(), ['boxes', 'delivery', 'receiver']);

  const stored = await db.collection('bookings').findOne({ _id: new ObjectId(id) });
  assert.equal(stored.boxSummary, '2 Tea Chests, 1 Gift Box');
  assert.equal(stored.boxCount, 3);
  assert.equal(stored.destination, 'Galle');
  assert.equal(stored.receiver.fullName, 'Rita Receiver-Perera');
  assert.equal(stored.staffEdits.length, 1);
  assert.deepEqual(stored.staffEdits[0].changed.sort(), ['boxes', 'delivery', 'receiver']);

  // The printout and the customer's own view both show the new details.
  const print = await api('GET', `/api/my-transco/bookings/${id}/declaration`, { token: staffToken });
  assert.equal(print.body.declaration.receiver.town, 'Galle');
  assert.equal(print.body.declaration.itemsText, '2 Tea Chests, 1 Gift Box');
  const mine = await api('GET', `/api/portal/bookings/${id}`, { token: me.token });
  assert.equal(mine.body.booking.items, '2 Tea Chests, 1 Gift Box');
});

test('a signed-in website chat is recognised in Conversations: real name, phone and customer number, kept in sync', async () => {
  await clearOtps('61400777004');
  const me = await signIn('0400777004');
  await api('PATCH', '/api/portal/me', { token: me.token, body: { name: 'Web Chatter' } });
  const sessionId = `agentsite-linked-${Date.now()}`;

  flowiseReplyText = 'Hello!';
  assert.equal((await chat(sessionId, { message: 'hi there' }, me.token)).status, 200);

  const list = await api('GET', '/api/customers', { token: staffToken });
  const rows = list.body.customers || list.body;
  const session = rows.find(c => c.sessionId === sessionId);
  assert.ok(session, 'the website chat appears in Conversations');
  assert.equal(session.name, 'Web Chatter');
  assert.equal(session.linkedAccount.phoneNumber, '61400777004');
  assert.equal(session.linkedAccount.name, 'Web Chatter');
  assert.ok(session.linkedAccount.customerCode);
  assert.ok(!JSON.stringify(list.body).includes('passwordHash'));

  // The customer renames themselves in My Transco — the chat follows.
  await api('PATCH', '/api/portal/me', { token: me.token, body: { name: 'Web Chatter Perera' } });
  await chat(sessionId, { message: 'one more question' }, me.token);
  const again = (await api('GET', '/api/customers', { token: staffToken })).body;
  const renamed = (again.customers || again).find(c => c.sessionId === sessionId);
  assert.equal(renamed.name, 'Web Chatter Perera');

  // The profile of the chat record points at the real account.
  const profile = await api('GET', `/api/customers/${session._id}/profile`, { token: staffToken });
  assert.equal(profile.body.customer.linkedAccount.phoneNumber, '61400777004');
});

test('shipping calendar: staff manage dates, the website reads upcoming ones without signing in', async () => {
  const iso = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

  // Staff only for management.
  assert.equal((await api('GET', '/api/schedule?country=sri_lanka')).status, 401);
  assert.equal((await api('POST', '/api/schedule', { body: { country: 'sri_lanka', cutoff: iso(10) } })).status, 401);

  const add = (body) => api('POST', '/api/schedule', { token: staffToken, body });
  const a = await add({ country: 'sri_lanka', cutoff: iso(10), seaArrival: iso(45), airArrival: iso(20) });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await add({ country: 'sri_lanka', cutoff: iso(40), seaArrival: iso(75), airArrival: null, note: 'Christmas run' });
  assert.equal(b.status, 201);
  await add({ country: 'sri_lanka', cutoff: iso(-5), seaArrival: iso(30) }); // already past
  await add({ country: 'india', cutoff: iso(12), seaArrival: iso(50) });

  // Validation and duplicates.
  assert.equal((await add({ country: 'sri_lanka', cutoff: iso(10) })).status, 409);
  const early = await add({ country: 'sri_lanka', cutoff: iso(20), seaArrival: iso(5) });
  assert.equal(early.status, 400);
  assert.equal(early.body.field, 'seaArrival');
  assert.equal((await add({ country: 'nowhere', cutoff: iso(20) })).status, 400);
  assert.equal((await add({ country: 'sri_lanka', cutoff: '2026-02-31' })).status, 400);

  // Website: no sign-in, upcoming only, soonest first, just this country.
  const pub = await api('GET', '/api/public/schedule?country=sri_lanka');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.body.dates.map(d => d.cutoff), [iso(10), iso(40)]);
  assert.equal(pub.body.dates[0].airArrival, iso(20));
  assert.equal(pub.body.dates[1].airArrival, null);
  assert.equal(pub.body.dates[1].note, 'Christmas run');

  // Edit + delete.
  const edited = await api('PATCH', `/api/schedule/${a.body.date.id}`, { token: staffToken, body: { airArrival: iso(22) } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.date.airArrival, iso(22));
  assert.equal((await api('DELETE', `/api/schedule/${b.body.date.id}`, { token: staffToken })).status, 204);
  const after = await api('GET', '/api/public/schedule?country=sri_lanka');
  assert.deepEqual(after.body.dates.map(d => d.cutoff), [iso(10)]);

  // Staff list includes the recent past (for reference).
  const staffList = await api('GET', '/api/schedule?country=sri_lanka', { token: staffToken });
  assert.ok(staffList.body.dates.some(d => d.cutoff === iso(-5)));
});

test('chat answers schedule questions from the shipping calendar, not the AI', async () => {
  // Uses the calendar entries added in the previous test (Sri Lanka + India).
  const sessionId = `agentsite-schedule-${Date.now()}`;

  flowiseRequests = [];
  const sl = await chat(sessionId, { message: 'What is your shipping schedule?', country: 'sri_lanka' });
  assert.equal(sl.status, 200, JSON.stringify(sl.body));
  assert.equal(flowiseRequests.length, 0, 'the AI is not asked');
  assert.match(sl.body.reply, /Shipping calendar — Sri Lanka/);
  assert.match(sl.body.reply, /Next cutoff:/);
  assert.match(sl.body.reply, /Sea freight arrives/);
  assert.match(sl.body.reply, /Air freight arrives/);
  assert.doesNotMatch(sl.body.reply, /India/);

  // A country named in the question wins over the page.
  const india = await chat(sessionId, { message: 'when is the next shipment to India?', country: 'sri_lanka' });
  assert.match(india.body.reply, /Shipping calendar — India/);

  // Asked in Sinhala → answered in Sinhala.
  const si = await chat(sessionId, { message: 'ඔබේ shipping කාලසටහන මොකක්ද?', country: 'sri_lanka' });
  assert.match(si.body.reply, /Shipping දින දර්ශනය/);
  assert.equal(flowiseRequests.length, 0);

  // Not schedule questions → the AI, as before.
  flowiseReplyText = 'AI reply';
  await chat(sessionId, { message: 'When will my shipment arrive?', country: 'sri_lanka' });
  await chat(sessionId, { message: 'How much for 2 tea chests?', country: 'sri_lanka' });
  assert.equal(flowiseRequests.length, 2);

  // The answer is in the transcript staff see.
  const visitor = await db.collection('customers').findOne({ sessionId, channel: 'website' });
  const botMessages = await db.collection('messages').find({ customerId: visitor._id, senderType: 'CHATBOT' }).toArray();
  assert.ok(botMessages.some(m => /Shipping calendar — Sri Lanka/.test(m.content)));
});
