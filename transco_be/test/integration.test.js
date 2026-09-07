// End-to-end integration tests: spawns the real server.js against an
// isolated Mongo database (MONGODB_DB_NAME override, dropped after the run)
// with the WhatsApp Graph API and Flowise calls redirected to local stubs
// (WHATSAPP_API_BASE_URL / FLOWISE_URL overrides) so no real WhatsApp
// message is ever sent and no real Flowise instance is required.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');
const WebSocket = require('ws');

require('dotenv').config();

const TEST_DB_NAME = `transco_test_${Date.now()}`;
const TEST_PORT = 3097;
const STUB_WHATSAPP_PORT = 3098;
const STUB_FLOWISE_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const WS_URL = `ws://localhost:${TEST_PORT}`;
const TEST_STAFF_EMAIL = 'test.agent@transco.lk';
const TEST_STAFF_PASSWORD = 'test-password-123';

let serverProcess;
let mongoClient;
let db;

let whatsappRequests = [];
let flowiseReplyText = 'Stubbed Flowise reply';
let flowiseShouldFail = false;
let flowiseDelayMs = 0;

const stubWhatsApp = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    whatsappRequests.push({ url: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: [{ id: 'wamid.STUB' }] }));
  });
});

const stubFlowise = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    if (flowiseDelayMs) await sleep(flowiseDelayMs);
    if (flowiseShouldFail) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'stub failure' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: flowiseReplyText }));
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPort(port, timeoutMs = 10000) {
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

function waPayload(from, text, waName) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: waName ? [{ profile: { name: waName } }] : [],
              messages: [{ from, text: { body: text } }]
            }
          }
        ]
      }
    ]
  };
}

function waStatusPayload(status, correlationId) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: 'wamid.status', status, biz_opaque_callback_data: correlationId }]
            }
          }
        ]
      }
    ]
  };
}

async function postWebhook(payload) {
  const res = await fetch(`${BASE_URL}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(res.status, 200);
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForEvent(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('Timed out waiting for expected WS event'));
    }, timeoutMs);
    function onMessage(raw) {
      const event = JSON.parse(raw.toString());
      if (predicate(event)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(event);
      }
    }
    ws.on('message', onMessage);
  });
}

async function setMode(customerId, mode) {
  const res = await fetch(`${BASE_URL}/api/customers/${customerId}/mode`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
  assert.equal(res.status, 200);
  return (await res.json()).customer;
}

before(async () => {
  await new Promise((resolve) => stubWhatsApp.listen(STUB_WHATSAPP_PORT, resolve));
  await new Promise((resolve) => stubFlowise.listen(STUB_FLOWISE_PORT, resolve));

  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      MONGODB_DB_NAME: TEST_DB_NAME,
      FLOWISE_URL: `http://localhost:${STUB_FLOWISE_PORT}`,
      WHATSAPP_API_BASE_URL: `http://localhost:${STUB_WHATSAPP_PORT}`,
      STAFF_EMAIL: TEST_STAFF_EMAIL,
      STAFF_PASSWORD: TEST_STAFF_PASSWORD
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stderr.on('data', (d) => console.error('[server:err]', d.toString()));

  await waitForPort(TEST_PORT);

  mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db(TEST_DB_NAME);
});

after(async () => {
  if (db) await db.dropDatabase();
  if (mongoClient) await mongoClient.close();
  if (serverProcess) serverProcess.kill();
  await new Promise((resolve) => stubWhatsApp.close(resolve));
  await new Promise((resolve) => stubFlowise.close(resolve));
});

test('new WhatsApp number creates a CHATBOT customer and saves the CUSTOMER message', async () => {
  const ws = await connectWs();
  const phone = '94770000001';
  await postWebhook(waPayload(phone, 'Hello, new customer', 'Nadun Test'));
  await waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.content === 'Hello, new customer');
  ws.close();

  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  assert.ok(customer, 'customer should have been created');
  assert.equal(customer.mode, 'CHATBOT');
  assert.equal(customer.name, 'Nadun Test');

  const message = await db.collection('messages').findOne({
    customerId: customer._id,
    senderType: 'CUSTOMER',
    content: 'Hello, new customer'
  });
  assert.ok(message, 'message should be saved against the new customer');
  assert.equal(message.isRead, false);
  assert.equal(message.replyToMessageId, null);
  assert.equal(message.whatsappStatus, null);
  assert.ok(message.createdAt instanceof Date, 'createdAt must be a real Date, not a string');
});

test('an existing WhatsApp number reuses the same customerId', async () => {
  const ws = await connectWs();
  const phone = '94770000001'; // same number as the previous test
  const before = await db.collection('customers').findOne({ phoneNumber: phone });

  await postWebhook(waPayload(phone, 'Second message from same number'));
  await waitForEvent(
    ws,
    (e) => e.type === 'message.created' && e.payload.message.content === 'Second message from same number',
  );
  ws.close();

  const customerCount = await db.collection('customers').countDocuments({ phoneNumber: phone });
  assert.equal(customerCount, 1, 'no duplicate customer should be created for the same phone number');

  const message = await db
    .collection('messages')
    .findOne({ content: 'Second message from same number' });
  assert.equal(message.customerId.toString(), before._id.toString());
});

test('CHATBOT mode: CUSTOMER message goes through Flowise and the reply links back via replyToMessageId', async () => {
  flowiseReplyText = 'Here is your Flowise-generated answer';
  const ws = await connectWs();
  const phone = '94770000002';

  await postWebhook(waPayload(phone, 'What are your hours?'));
  const inboundEvent = await waitForEvent(
    ws,
    (e) => e.type === 'message.created' && e.payload.message.senderType === 'CUSTOMER',
  );
  const chatbotEvent = await waitForEvent(
    ws,
    (e) => e.type === 'message.created' && e.payload.message.senderType === 'CHATBOT',
  );
  ws.close();

  assert.equal(chatbotEvent.payload.message.content, flowiseReplyText);
  assert.equal(chatbotEvent.payload.customer._id, inboundEvent.payload.customer._id);
  assert.equal(chatbotEvent.payload.message.customerId, inboundEvent.payload.message.customerId);
  assert.equal(chatbotEvent.payload.message.replyToMessageId, inboundEvent.payload.message._id);

  const waCall = whatsappRequests.find((r) => r.body.text?.body === flowiseReplyText);
  assert.ok(waCall, 'the CHATBOT reply should have been sent through the WhatsApp stub');
});

test('CHATBOT mode: a Flowise failure does not create a fake reply', async () => {
  flowiseShouldFail = true;
  const ws = await connectWs();
  const phone = '94770000003';

  await postWebhook(waPayload(phone, 'This will fail'));
  await waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.senderType === 'CUSTOMER');
  await sleep(500); // give the (failing) Flowise retries time to finish
  ws.close();
  flowiseShouldFail = false;

  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  const chatbotMessages = await db
    .collection('messages')
    .find({ customerId: customer._id, senderType: 'CHATBOT' })
    .toArray();
  assert.equal(chatbotMessages.length, 0, 'no CHATBOT message should exist after a Flowise failure');

  const customerMessage = await db.collection('messages').findOne({ customerId: customer._id, senderType: 'CUSTOMER' });
  assert.equal(customerMessage.isRead, false, 'the original CUSTOMER message must stay unread');
  assert.equal(customer.mode, 'CHATBOT', 'mode must not auto-switch to HUMAN on Flowise failure');
});

test('HUMAN mode: CUSTOMER message is saved without calling Flowise, and unread count updates', async () => {
  const phone = '94770000004';
  const setupWs = await connectWs();
  const chatbotReplyP = waitForEvent(setupWs, (e) => e.type === 'message.created' && e.payload.message.senderType === 'CHATBOT');
  await postWebhook(waPayload(phone, 'first contact'));
  await chatbotReplyP; // let the legitimate CHATBOT exchange finish before switching modes
  setupWs.close();

  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  await setMode(customer._id.toString(), 'HUMAN');

  const requestsBefore = whatsappRequests.length;
  const ws = await connectWs();
  const eventP = waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.content === 'need a human please');
  await postWebhook(waPayload(phone, 'need a human please'));
  const event = await eventP;
  ws.close();

  assert.equal(event.payload.unreadCount, 2, 'both CUSTOMER messages (first contact + this one) are unread; the CHATBOT reply does not count');
  assert.equal(whatsappRequests.length, requestsBefore, 'Flowise/WhatsApp send must not happen for a message received in HUMAN mode');

  const chatbotMessages = await db
    .collection('messages')
    .find({ customerId: customer._id, senderType: 'CHATBOT' })
    .toArray();
  assert.equal(chatbotMessages.length, 1, 'exactly the one legitimate CHATBOT reply from before the switch, and no more');
});

test('HUMAN reply: staff send is saved, sent via WhatsApp, and status-tracked; Flowise is never called for it', async () => {
  const phone = '94770000005';
  await postWebhook(waPayload(phone, 'hi'));
  await sleep(300);
  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  await setMode(customer._id.toString(), 'HUMAN');

  const ws = await connectWs();
  const sendPromise = fetch(`${BASE_URL}/api/customers/${customer._id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'A human agent is here to help' })
  });
  const event = await waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.senderType === 'HUMAN');
  const res = await sendPromise;
  ws.close();

  assert.equal(res.status, 201);
  assert.equal(event.payload.message.whatsappStatus, 'SENT');
  const waCall = whatsappRequests.find((r) => r.body.text?.body === 'A human agent is here to help');
  assert.ok(waCall, 'HUMAN message must be sent through the WhatsApp stub');
});

test('staff cannot send a manual message while a conversation is in CHATBOT mode', async () => {
  const phone = '94770000006';
  await postWebhook(waPayload(phone, 'hi'));
  await sleep(300);
  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  assert.equal(customer.mode, 'CHATBOT');

  const res = await fetch(`${BASE_URL}/api/customers/${customer._id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'should be rejected' })
  });
  assert.equal(res.status, 409);
});

test('WhatsApp status progression updates the correct message by id, never by recency', async () => {
  const phone = '94770000007';
  await postWebhook(waPayload(phone, 'hi'));
  await sleep(300);
  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  await setMode(customer._id.toString(), 'HUMAN');

  // Send two HUMAN messages so there are two candidate messages to confuse a
  // "most recent" heuristic with.
  const ws = await connectWs();
  const firstEventP = waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.content === 'first outbound');
  await fetch(`${BASE_URL}/api/customers/${customer._id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'first outbound' })
  });
  const firstEvent = await firstEventP;

  const secondEventP = waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.content === 'second outbound');
  await fetch(`${BASE_URL}/api/customers/${customer._id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'second outbound' })
  });
  const secondEvent = await secondEventP;

  const firstId = firstEvent.payload.message._id;
  const secondId = secondEvent.payload.message._id;
  assert.notEqual(firstId, secondId);

  // Progress the FIRST (older) message through delivered -> read, and fail
  // the SECOND message, to prove they're addressed independently by id.
  const deliveredP = waitForEvent(ws, (e) => e.type === 'message.status_changed' && e.payload.whatsappStatus === 'DELIVERED');
  await postWebhook(waStatusPayload('delivered', firstId));
  const delivered = await deliveredP;
  assert.equal(delivered.payload.messageId, firstId);

  const readP = waitForEvent(ws, (e) => e.type === 'message.status_changed' && e.payload.whatsappStatus === 'READ');
  await postWebhook(waStatusPayload('read', firstId));
  const read = await readP;
  assert.equal(read.payload.messageId, firstId);

  const failedP = waitForEvent(ws, (e) => e.type === 'message.status_changed' && e.payload.whatsappStatus === 'FAILED');
  await postWebhook(waStatusPayload('failed', secondId));
  const failed = await failedP;
  assert.equal(failed.payload.messageId, secondId);
  ws.close();

  const firstDoc = await db.collection('messages').findOne({ _id: new ObjectId(firstId) });
  const secondDoc = await db.collection('messages').findOne({ _id: new ObjectId(secondId) });
  assert.equal(firstDoc.whatsappStatus, 'READ');
  assert.equal(secondDoc.whatsappStatus, 'FAILED');
});

test('mode switch: persists in the database and broadcasts to every connected client', async () => {
  const phone = '94770000008';
  await postWebhook(waPayload(phone, 'hi'));
  await sleep(300);
  const customer = await db.collection('customers').findOne({ phoneNumber: phone });

  const wsA = await connectWs();
  const wsB = await connectWs();
  const eventAP = waitForEvent(wsA, (e) => e.type === 'customer.mode_changed');
  const eventBP = waitForEvent(wsB, (e) => e.type === 'customer.mode_changed');

  await setMode(customer._id.toString(), 'HUMAN');

  const [eventA, eventB] = await Promise.all([eventAP, eventBP]);
  wsA.close();
  wsB.close();

  assert.equal(eventA.payload.mode, 'HUMAN');
  assert.equal(eventB.payload.mode, 'HUMAN');
  assert.equal(eventA.payload.customerId, customer._id.toString());

  const persisted = await db.collection('customers').findOne({ _id: customer._id });
  assert.equal(persisted.mode, 'HUMAN', 'mode change must be persisted, not just broadcast');

  // and back again
  await setMode(customer._id.toString(), 'CHATBOT');
  const persistedBack = await db.collection('customers').findOne({ _id: customer._id });
  assert.equal(persistedBack.mode, 'CHATBOT');
});

test('a Flowise call in flight when staff switches to HUMAN does not produce a stale CHATBOT reply', async () => {
  const phone = '94770000009';
  const setupWs = await connectWs();
  const firstReplyP = waitForEvent(setupWs, (e) => e.type === 'message.created' && e.payload.message.senderType === 'CHATBOT');
  await postWebhook(waPayload(phone, 'hi'));
  await firstReplyP; // let this legitimate exchange finish before the race scenario
  setupWs.close();
  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  const chatbotCountBefore = await db
    .collection('messages')
    .countDocuments({ customerId: customer._id, senderType: 'CHATBOT' });
  assert.equal(chatbotCountBefore, 1, 'sanity check: the first exchange produced exactly one legitimate CHATBOT reply');

  flowiseDelayMs = 800;
  const ws = await connectWs();
  const triggerP = postWebhook(waPayload(phone, 'trigger slow flowise'));
  await waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.content === 'trigger slow flowise');

  // Switch to HUMAN while Flowise is still "thinking".
  await setMode(customer._id.toString(), 'HUMAN');
  await triggerP;
  await sleep(1200); // let the delayed Flowise response resolve
  ws.close();
  flowiseDelayMs = 0;

  const chatbotCountAfter = await db
    .collection('messages')
    .countDocuments({ customerId: customer._id, senderType: 'CHATBOT' });
  assert.equal(
    chatbotCountAfter,
    chatbotCountBefore,
    'no additional CHATBOT reply should land after a mid-flight switch to HUMAN',
  );
});

test('unread: opening a conversation marks CUSTOMER messages read, clears the count, and notifies other clients', async () => {
  const phone = '94770000010';
  await postWebhook(waPayload(phone, 'msg 1'));
  await sleep(200);
  await postWebhook(waPayload(phone, 'msg 2'));
  await sleep(300);
  const customer = await db.collection('customers').findOne({ phoneNumber: phone });

  const unreadBefore = await db
    .collection('messages')
    .countDocuments({ customerId: customer._id, senderType: 'CUSTOMER', isRead: false });
  assert.equal(unreadBefore, 2);

  const ws = await connectWs();
  const eventP = waitForEvent(ws, (e) => e.type === 'message.read_state_changed');
  const res = await fetch(`${BASE_URL}/api/customers/${customer._id}/read`, { method: 'PATCH' });
  const event = await eventP;
  ws.close();

  assert.equal(res.status, 200);
  assert.equal(event.payload.unreadCount, 0);
  assert.equal(event.payload.messageIds.length, 2);

  const unreadAfter = await db
    .collection('messages')
    .countDocuments({ customerId: customer._id, senderType: 'CUSTOMER', isRead: false });
  assert.equal(unreadAfter, 0);
});

test('only CUSTOMER messages ever contribute to unread count', async () => {
  const phone = '94770000011';
  const ws = await connectWs();
  const inboundEventP = waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.senderType === 'CUSTOMER');
  await postWebhook(waPayload(phone, 'hi, unread test'));
  const inboundEvent = await inboundEventP;
  assert.equal(inboundEvent.payload.unreadCount, 1, 'the CUSTOMER message itself must count as unread');

  const customer = await db.collection('customers').findOne({ phoneNumber: phone });
  await setMode(customer._id.toString(), 'HUMAN');

  const humanEventP = waitForEvent(ws, (e) => e.type === 'message.created' && e.payload.message.senderType === 'HUMAN');
  await fetch(`${BASE_URL}/api/customers/${customer._id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'a human reply' })
  });
  const humanEvent = await humanEventP;
  ws.close();

  // The HUMAN message must not move the unread count at all — only the
  // still-unread CUSTOMER message from before counts.
  assert.equal(humanEvent.payload.unreadCount, 1);
  assert.equal(humanEvent.payload.message.isRead, true);
});

test('GET /api/customers returns messages in chronological order per customer', async () => {
  const phone = '94770000012';
  // HUMAN mode so a/b/c aren't interleaved with legitimate CHATBOT replies —
  // this test is only about ordering, not about the CHATBOT flow.
  const setupWs = await connectWs();
  const chatbotReplyP = waitForEvent(setupWs, (e) => e.type === 'message.created' && e.payload.message.senderType === 'CHATBOT');
  await postWebhook(waPayload(phone, 'setup'));
  await chatbotReplyP; // let the legitimate CHATBOT exchange finish before switching modes
  setupWs.close();
  const setupCustomer = await db.collection('customers').findOne({ phoneNumber: phone });
  await setMode(setupCustomer._id.toString(), 'HUMAN');

  await postWebhook(waPayload(phone, 'a'));
  await sleep(150);
  await postWebhook(waPayload(phone, 'b'));
  await sleep(150);
  await postWebhook(waPayload(phone, 'c'));
  await sleep(300);

  const res = await fetch(`${BASE_URL}/api/customers`);
  assert.equal(res.status, 200);
  const data = await res.json();
  const found = data.customers.find((c) => c.phoneNumber === phone);
  assert.ok(found);
  const contents = found.messages.map((m) => m.content);
  assert.deepEqual(contents, ['setup', flowiseReplyText, 'a', 'b', 'c']);
  for (let i = 1; i < found.messages.length; i++) {
    assert.ok(new Date(found.messages[i].createdAt) >= new Date(found.messages[i - 1].createdAt));
  }
});

test('login works with the seeded staff account and rejects bad credentials', async () => {
  const ok = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_STAFF_EMAIL, password: TEST_STAFF_PASSWORD })
  });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.ok(data.token);
  assert.equal(data.user.email, TEST_STAFF_EMAIL);

  const bad = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_STAFF_EMAIL, password: 'wrong-password' })
  });
  assert.equal(bad.status, 401);

  const session = await fetch(`${BASE_URL}/api/auth/session`, {
    headers: { Authorization: `Bearer ${data.token}` }
  });
  assert.equal(session.status, 200);

  const noSession = await fetch(`${BASE_URL}/api/auth/session`);
  assert.equal(noSession.status, 401);
});

test('CORS preflight allows the Authorization header', async () => {
  const res = await fetch(`${BASE_URL}/api/customers`, {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type'
    }
  });
  assert.equal(res.status, 204);
  const allowed = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
  assert.ok(allowed.includes('authorization'), `expected Authorization to be allowed, got: ${allowed}`);
});

test('only users, customers, and messages collections exist; senderType/mode values are constrained', async () => {
  const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
  assert.deepEqual(collections, ['customers', 'messages', 'users']);

  const badMode = await db.collection('customers').countDocuments({ mode: { $nin: ['CHATBOT', 'HUMAN'] } });
  assert.equal(badMode, 0);

  const badSender = await db
    .collection('messages')
    .countDocuments({ senderType: { $nin: ['CUSTOMER', 'CHATBOT', 'HUMAN'] } });
  assert.equal(badSender, 0);

  const nonDateTimestamps = await db
    .collection('messages')
    .countDocuments({ createdAt: { $not: { $type: 'date' } } });
  assert.equal(nonDateTimestamps, 0, 'every message.createdAt must be a BSON Date, not a string');
});
