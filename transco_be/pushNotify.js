// ============================================================
// PUSH NOTIFICATIONS — phone/computer pop-ups, even with the page closed
// ============================================================
//
// Staff (console): a new booking (warehouse team + admin by default) and
// tasks for them. My Transco customers: a staff message in their chat.
// Each browser that tapped "Allow" is one record in pushSubscriptions:
//   { kind: 'staff', userId, prefs: { bookings, tasks } }
//   { kind: 'customer', customerId }
// Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; without them nothing is sent
// and nothing else changes. Sending never blocks or breaks the caller.
//
//   GET    /api/push/key                  public key (no sign-in)
//   GET    /api/push/staff                this browser's settings (?endpoint=)
//   POST   /api/push/staff                save { subscription, prefs }
//   DELETE /api/push/staff                { endpoint } — stop on this browser
// Customers subscribe through the portal routes (subscribeCustomer).

const express = require('express');
const { ObjectId } = require('mongodb');
const webpush = require('web-push');
const { getDb, users } = require('./db');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const enabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (enabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:transcosydney@gmail.com', PUBLIC_KEY, PRIVATE_KEY);

const store = () => getDb().collection('pushSubscriptions');

// A browser subscription as the Push API gives it.
function cleanSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return null;
  const keys = s.keys || {};
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  return { endpoint: s.endpoint, keys: { p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) } };
}

async function sendTo(filter, payload) {
  if (!enabled) return;
  try {
    const subs = await store().find(filter).limit(500).toArray();
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(s =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 24 * 60 * 60 })
        .catch(err => {
          // Gone = the person turned it off or the browser was reset.
          if (err.statusCode === 404 || err.statusCode === 410) return store().deleteOne({ _id: s._id });
          console.error('Push failed:', err.statusCode || err.message);
        })
    ));
  } catch (err) {
    console.error('Push send error:', err.message);
  }
}

// ---------- staff ----------

const isBookingRole = role => role === 'warehouse' || role === 'admin';

function createPushRouter({ isStaffAdmin }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  router.get('/key', (req, res) => res.json({ key: enabled ? PUBLIC_KEY : null }));

  // Staff routes need a signed-in staff member (set by the auth middleware).
  const staffOnly = (req, res, next) => (req.user && req.user.sub ? next() : res.status(401).json({ error: 'Please sign in.' }));

  // Default for someone who hasn't chosen: tasks on; bookings for the
  // warehouse team and admin.
  async function defaults(req) {
    const record = ObjectId.isValid(req.user.sub) ? await users().findOne({ _id: new ObjectId(req.user.sub) }, { projection: { role: 1 } }) : null;
    return { tasks: true, bookings: isBookingRole(record && record.role) || await isStaffAdmin(req) };
  }

  router.get('/staff', staffOnly, wrap(async (req, res) => {
    const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : '';
    const sub = endpoint ? await store().findOne({ kind: 'staff', endpoint, userId: String(req.user.sub) }) : null;
    res.json({ subscribed: Boolean(sub), prefs: sub ? sub.prefs : await defaults(req) });
  }));

  router.post('/staff', staffOnly, wrap(async (req, res) => {
    const sub = cleanSubscription(req.body && req.body.subscription);
    if (!sub) return res.status(400).json({ error: "This browser didn't give a notification address. Please try again." });
    const p = (req.body && req.body.prefs) || {};
    const fallback = await defaults(req);
    const prefs = {
      tasks: typeof p.tasks === 'boolean' ? p.tasks : fallback.tasks,
      bookings: typeof p.bookings === 'boolean' ? p.bookings : fallback.bookings
    };
    // One browser = one record; signing in as someone else moves it to them.
    await store().updateOne(
      { endpoint: sub.endpoint },
      { $set: { kind: 'staff', userId: String(req.user.sub), keys: sub.keys, prefs, updatedAt: new Date() }, $unset: { customerId: '' }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    res.json({ subscribed: true, prefs });
  }));

  router.delete('/staff', staffOnly, wrap(async (req, res) => {
    const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint : '';
    if (endpoint) await store().deleteOne({ kind: 'staff', endpoint, userId: String(req.user.sub) });
    res.json({ subscribed: false });
  }));

  return router;
}

// A new booking, from any channel (hooked on the booking.created event).
function notifyBooking(b) {
  if (!b) return;
  const name = String(b.customerName || b.senderName || 'A customer').slice(0, 60);
  const what = String(b.boxSummary || '').slice(0, 80);
  const kind = b.channel === 'walk_in' ? 'Walk-in' : 'New booking';
  const id = b._id ? String(b._id) : '';
  sendTo({ kind: 'staff', 'prefs.bookings': true }, {
    title: `📦 ${kind} — ${name}`,
    body: what || 'Open the console to see the details.',
    url: id ? `/console/bookings/${id}` : '/console/bookings',
    tag: `booking-${id || Date.now()}`
  });
}

// A task for someone: the chosen person, the warehouse team, or everyone —
// never the person who made it.
function notifyTask(task, opts) {
  taskPush(task, opts).catch(err => console.error('Task push failed:', err.message));
}
async function taskPush(task, { byId, reassigned = false } = {}) {
  if (!enabled || !task || task.assignTo === 'me') return;
  let userIds;
  if (task.assignTo === 'person') userIds = [String(task.assigneeId)];
  else {
    const filter = task.team === 'all' ? {} : { role: { $in: ['warehouse', 'admin'] } };
    userIds = (await users().find(filter, { projection: { _id: 1 } }).toArray()).map(u => String(u._id));
  }
  userIds = userIds.filter(id => id && id !== String(byId || ''));
  if (!userIds.length) return;
  const from = task.createdByName ? ` from ${task.createdByName}` : '';
  sendTo({ kind: 'staff', userId: { $in: userIds }, 'prefs.tasks': true }, {
    title: reassigned ? '✅ A task was given to you' : `✅ New task${from}`,
    body: String(task.title || '').slice(0, 120) + (task.dueDate ? ` · due ${task.dueDate}${task.dueTime ? ' ' + task.dueTime : ''}` : ''),
    url: '/console/tasks',
    tag: `task-${task._id}`
  });
}

// ---------- My Transco customers ----------

async function subscribeCustomer(customerId, subscription) {
  const sub = cleanSubscription(subscription);
  if (!sub) return false;
  await store().updateOne(
    { endpoint: sub.endpoint },
    { $set: { kind: 'customer', customerId: String(customerId), keys: sub.keys, updatedAt: new Date() }, $unset: { userId: '', prefs: '' }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  return true;
}

async function unsubscribeCustomer(customerId, endpoint) {
  if (typeof endpoint === 'string' && endpoint) await store().deleteOne({ kind: 'customer', endpoint, customerId: String(customerId) });
}

async function customerSubscribed(customerId, endpoint) {
  if (typeof endpoint !== 'string' || !endpoint) return false;
  return Boolean(await store().findOne({ kind: 'customer', endpoint, customerId: String(customerId) }, { projection: { _id: 1 } }));
}

// A staff message in a website chat linked to a My Transco account.
function notifyCustomer(accountId, text) {
  if (!accountId) return;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  sendTo({ kind: 'customer', customerId: String(accountId) }, {
    title: '💬 Transco team',
    body: clean ? clean.slice(0, 140) : 'You have a new message.',
    url: '/account.html#/chat',
    tag: 'transco-chat'
  });
}

module.exports = { enabled, createPushRouter, notifyBooking, notifyTask, subscribeCustomer, unsubscribeCustomer, customerSubscribed, notifyCustomer };
