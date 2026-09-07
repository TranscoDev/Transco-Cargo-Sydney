require('dotenv').config({ quiet: true });

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const { ObjectId } = require('mongodb');

const { connectToDatabase, customers, messages, users, bookings } = require('./db');
const { initWebSocketServer, broadcast } = require('./websocket');

const app = express();

app.use(express.json());


// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});


// ============================================================
// MEDIA
// ============================================================
//
// Files are stored in:
//
// transco_be/media/Box_Flyer.jpg
// transco_be/media/BOX_Promo_video.mp4
//
// They will be available publicly as:
//
// https://YOUR-NGROK-URL.ngrok-free.app/media/Box_Flyer.jpg
// https://YOUR-NGROK-URL.ngrok-free.app/media/BOX_Promo_video.mp4
//
// WhatsApp needs these files to be accessible through a public HTTPS URL.
//

app.use('/media', express.static('media'));


// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  FLOWISE_URL,
  FLOWISE_CHATFLOW_ID,
  PORT,
  MONGODB_URI,
  STAFF_EMAIL,
  STAFF_PASSWORD,

  // Public URL of this backend.
  // Example:
  // https://abc123.ngrok-free.app
  MEDIA_BASE_URL,

  // WhatsApp Graph API
  WHATSAPP_API_BASE_URL =
    'https://graph.facebook.com/v20.0',

  // Resend (booking notification emails)
  RESEND_API_KEY,
  STAFF_NOTIFICATION_EMAIL = 'Transcosydney@gmail.com',

  // Staff WhatsApp number to notify on new bookings, in international
  // format with no + or spaces (e.g. 94701133676). TEST NUMBER for now
  // — swap for the real staff number once confirmed.
  STAFF_NOTIFICATION_PHONE = '94701133676',

  // Groq Whisper (voice message transcription)
  GROQ_API_KEY,

  // Google Calendar (service account JSON, as a single-line string)
  GOOGLE_SERVICE_ACCOUNT_JSON,
  GOOGLE_CALENDAR_ID = 'transcosydney@gmail.com'
} = process.env;


// ============================================================
// PASSWORD FUNCTIONS
// ============================================================

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  return `${salt}:${hash}`;
}


function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');

  if (!salt || !hash) {
    return false;
  }

  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = crypto.scryptSync(password, salt, 64);

  return (
    hashBuf.length === testBuf.length &&
    crypto.timingSafeEqual(hashBuf, testBuf)
  );
}


// ============================================================
// INITIAL STAFF USER
// ============================================================

async function seedStaffUser() {
  const existing = await users().countDocuments({});

  if (existing > 0) {
    return;
  }

  if (!STAFF_EMAIL || !STAFF_PASSWORD) {
    console.warn(
      'No users exist yet and STAFF_EMAIL/STAFF_PASSWORD are not set — no staff account seeded.'
    );

    return;
  }

  const email = STAFF_EMAIL.toLowerCase();

  const name =
    email.split('@')[0]?.replace(/[._]/g, ' ') || 'Agent';

  await users().insertOne({
    email,
    passwordHash: hashPassword(STAFF_PASSWORD),
    name
  });

  console.log(`Seeded initial staff account: ${email}`);
}


// ============================================================
// SESSION
// ============================================================

const SESSION_SECRET = crypto.randomBytes(32).toString('hex');


function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}


function verifySession(token) {
  if (!token) {
    return null;
  }

  const [body, signature] = token.split('.');

  if (!body || !signature) {
    return null;
  }

  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    );
  } catch {
    return null;
  }
}


// ============================================================
// CUSTOMER
// ============================================================

async function findOrCreateCustomer(phoneNumber, waName) {
  const result = await customers().findOneAndUpdate(
    { phoneNumber },

    {
      $setOnInsert: {
        phoneNumber,
        name: waName || phoneNumber,
        mode: 'CHATBOT'
      }
    },

    {
      upsert: true,
      returnDocument: 'after',
      includeResultMetadata: true
    }
  );

  return {
    customer: result.value,
    isNewCustomer: Boolean(result.lastErrorObject?.upserted)
  };
}


// ============================================================
// SAVE MESSAGE
// ============================================================

async function saveMessage({
  customerId,
  senderType,
  content,
  isRead,
  replyToMessageId,
  whatsappStatus
}) {
  const doc = {
    customerId,
    senderType,
    content,
    isRead,
    replyToMessageId,
    whatsappStatus,
    createdAt: new Date()
  };

  const { insertedId } = await messages().insertOne(doc);

  return {
    _id: insertedId,
    ...doc
  };
}


// ============================================================
// BOOKING NOTIFICATION EMAIL
// ============================================================
//
// Fired whenever a customer books a Tue-Fri drop-off through the
// chatbot. Sent via Resend (not Gmail SMTP — see project notes on why).
// Best-effort only: a failed email should never block the booking
// itself or the customer's WhatsApp reply.

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Turns "friday" into "Friday, 5 September 2026" — the actual calendar
// date, not just the weekday name, so there's no ambiguity about which
// Friday a booking is for. Reuses nextDateForWeekday (below — function
// declarations are hoisted, so this is fine despite the definition
// order), the same date math already used for the Google Calendar
// sync. Falls back to just the weekday name if anything goes wrong,
// rather than letting a date-formatting hiccup break the notification.
function formatBookingDayLine(booking) {
  const dayLabel =
    booking.requestedDay.charAt(0).toUpperCase() +
    booking.requestedDay.slice(1);

  try {
    const date = nextDateForWeekday(booking.requestedDay, booking.requestedTime);
    const dateLabel = date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Australia/Sydney'
    });
    return `${dayLabel}, ${dateLabel}`;
  } catch (err) {
    return dayLabel;
  }
}

async function sendBookingEmail(booking) {

  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured — skipping booking email.');
    return;
  }

  const dayLabel = formatBookingDayLine(booking);

  // boxSummary is a short plain-English line the LLM itself generated
  // from the conversation (e.g. "3 Tea Chest boxes") — see
  // booking_box_summary in the system prompt. Not the raw chat log.
  const boxHtml = booking.boxSummary
    ? `<p><strong>Boxes:</strong> ${escapeHtml(booking.boxSummary)}</p>`
    : `<p><em>No box details given yet — booking made with name/day/time only.</em></p>`;

  try {

    await axios.post(

      'https://api.resend.com/emails',

      {
        from: 'Transco Bookings <onboarding@resend.dev>',
        to: STAFF_NOTIFICATION_EMAIL,
        subject: `New drop-off booking — ${dayLabel} at ${booking.requestedTime}`,
        html:
          `<p><strong>New Tue-Fri drop-off booking</strong></p>` +
          `<p>Customer: ${booking.customerName || booking.phoneNumber}</p>` +
          `<p>Phone: ${booking.phoneNumber}</p>` +
          `<p>Day: ${dayLabel}</p>` +
          `<p>Time: ${booking.requestedTime}</p>` +
          boxHtml
      },

      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }

    );

  } catch (err) {

    console.error(
      'Booking email failed:',
      err.response?.data ?? err.message
    );
  }
}


// ============================================================
// BOOKING NOTIFICATION — STAFF WHATSAPP
// ============================================================
//
// Sends a short WhatsApp message to one or more staff numbers whenever
// a booking is created, alongside the email. STAFF_NOTIFICATION_PHONE
// accepts a comma-separated list (e.g. "94701133676,61468382023") to
// notify several people — a single number still works exactly as
// before. Uses the same sendWhatsAppMessage() function used for
// customer replies — it's a generic "to any number" sender, not
// customer-specific. Best-effort per number: one failing (or one bad
// number in the list) never blocks the others or the booking itself.

async function sendStaffBookingWhatsApp(booking) {

  const staffNumbers = (STAFF_NOTIFICATION_PHONE || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean);

  if (staffNumbers.length === 0) {
    console.warn('STAFF_NOTIFICATION_PHONE not configured — skipping staff WhatsApp notification.');
    return;
  }

  const dayLabel = formatBookingDayLine(booking);

  // Kept short on purpose — this is a quick mobile alert, not the full
  // record. boxSummary (if present) is already a short line the LLM
  // generated itself, e.g. "3 Tea Chest boxes" — not a chat transcript.
  const text =
    `📅 New drop-off booking\n\n` +
    `Customer: ${booking.customerName || booking.phoneNumber}\n` +
    `Phone: ${booking.phoneNumber}\n` +
    `Day: ${dayLabel}\n` +
    `Time: ${booking.requestedTime}` +
    (booking.boxSummary ? `\nBoxes: ${booking.boxSummary}` : '');

  for (const number of staffNumbers) {
    try {
      await sendWhatsAppMessage(number, text);
    } catch (err) {
      console.error(
        `Staff booking WhatsApp notification failed (${number}):`,
        err.response?.data ?? err.message
      );
    }
  }
}


// ============================================================
// GOOGLE CALENDAR (booking events)
// ============================================================
//
// Uses a service account with the JWT bearer flow directly via axios,
// instead of the googleapis SDK — keeps the dependency footprint the
// same as the rest of this project (raw HTTP calls to WhatsApp, PEBL,
// Resend). Requires the target calendar to be manually shared with the
// service account's client_email, with "Make changes to events".

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getGoogleCalendarAccessToken(credentials) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));

  const now = Math.floor(Date.now() / 1000);

  const claimSet = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));

  const signatureInput = `${header}.${claimSet}`;

  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signatureInput), credentials.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${signatureInput}.${signature}`;

  const response = await axios.post(
    'https://oauth2.googleapis.com/token',

    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString(),

    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  return response.data.access_token;
}


// Finds the next real calendar date for a weekday name + HH:MM time,
// in Australia/Sydney time. If that day/time is later today, uses
// today; otherwise rolls forward to next week's occurrence.

function nextDateForWeekday(dayName, timeHHMM) {
  const DAY_NAMES = [
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday'
  ];

  const targetDow = DAY_NAMES.indexOf(dayName.toLowerCase());

  const nowSydney = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' })
  );

  const [hh, mm] = timeHHMM.split(':').map(Number);

  let diff = (targetDow - nowSydney.getDay() + 7) % 7;

  if (diff === 0) {
    const nowMinutes = nowSydney.getHours() * 60 + nowSydney.getMinutes();
    const targetMinutes = hh * 60 + mm;

    if (targetMinutes <= nowMinutes) {
      diff = 7;
    }
  }

  const target = new Date(nowSydney);
  target.setDate(nowSydney.getDate() + diff);
  target.setHours(hh, mm, 0, 0);

  return target;
}


function formatCalendarDateTime(date) {
  const pad = n => String(n).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}


// Returns the created event's id (to be stored on the booking so it can
// be deleted later if the booking is deleted), or null if calendar sync
// isn't configured or the call fails.

async function createCalendarEvent(booking) {

  if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.warn('GOOGLE_SERVICE_ACCOUNT_JSON not configured — skipping calendar event.');
    return null;
  }

  try {

    const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    const accessToken = await getGoogleCalendarAccessToken(credentials);

    const startDate = nextDateForWeekday(booking.requestedDay, booking.requestedTime);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

    const response = await axios.post(

      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`,

      {
        summary: `Drop-off: ${booking.customerName || booking.phoneNumber}`,
        description: `Phone: ${booking.phoneNumber}\nBooked via WhatsApp chatbot.`,

        start: {
          dateTime: formatCalendarDateTime(startDate),
          timeZone: 'Australia/Sydney'
        },

        end: {
          dateTime: formatCalendarDateTime(endDate),
          timeZone: 'Australia/Sydney'
        }
      },

      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    return response.data.id;

  } catch (err) {

    console.error(
      'Calendar event creation failed:',
      err.response?.data ?? err.message
    );

    return null;
  }
}


// Best-effort cleanup companion to createCalendarEvent — called when a
// booking with a stored calendarEventId is deleted. A 404/410 from Google
// (event already gone) is treated as success, not an error.

async function deleteCalendarEvent(eventId) {

  if (!GOOGLE_SERVICE_ACCOUNT_JSON || !eventId) {
    return;
  }

  try {

    const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    const accessToken = await getGoogleCalendarAccessToken(credentials);

    await axios.delete(

      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,

      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

  } catch (err) {

    const status = err.response?.status;

    if (status === 404 || status === 410) {
      return;
    }

    console.error(
      'Calendar event deletion failed:',
      err.response?.data ?? err.message
    );
  }
}


// ============================================================
// SEND + TRACK OUTBOUND MESSAGE
// ============================================================
//
// IMPORTANT:
//
// If Flowise returns:
//
// [[BOX_MEDIA]]
//
// we do NOT send that text to the customer.
//
// Instead:
//
// 1. Video
// 2. Flyer image
//
// No long text.
//

async function sendAndTrackOutbound(
  customer,
  senderType,
  content,
  replyToMessageId = null,
  skipShowMenu = false
) {
  const HANDOFF_MARKER = '[[HANDOFF]]';
  const BOX_MEDIA_MARKER = '[[SEND_VIDEO]]';
  const SHOW_MENU_MARKER = '[[SHOW_MENU]]';

  const needsAttention = content.startsWith(HANDOFF_MARKER);

  let cleanContent = needsAttention
    ? content.slice(HANDOFF_MARKER.length).trimStart()
    : content;


  // ==========================================================
  // SHOW MENU COMMAND
  // ==========================================================
  // Flowise's request_type=7 (greeting) now returns [[SHOW_MENU]] +
  // the plain-text greeting. On WhatsApp we discard that plain text
  // entirely and send the native tappable menu instead (the exact
  // same one new customers already get — see sendWelcomeMenu above).
  // This fires for ANY greeting, not just a customer's first-ever
  // message, so returning customers who say "hi" later get the menu
  // too. Nothing else in this reply needs sending, so we return here.
  //
  // skipShowMenu covers one specific overlap: a brand-new customer's
  // very first message already triggers its own eager welcome-menu
  // send (see the webhook handler) before Flowise is even called. If
  // that first message ALSO happens to be a plain greeting, Flowise's
  // own reply would carry this same marker again — skipShowMenu:true
  // for that one call site prevents the menu from being sent twice.

  if (cleanContent.startsWith(SHOW_MENU_MARKER)) {
    if (!skipShowMenu) {
      await sendWelcomeMenu(customer);
    }
    return;
  }


  // ==========================================================
  // BOOK DROPOFF COMMAND
  // ==========================================================
  // Flowise's request_type=12 (Tue-Fri appointment) prefixes its reply
  // with [[BOOK_DROPOFF:day=X;time=Y]] (optionally ;boxes=SUMMARY,
  // ;name=NAME, ;phone=PHONE — the LLM fills these in itself from its
  // own understanding of the conversation; see the system prompt's
  // booking_box_summary / booking_contact_name / booking_contact_phone
  // notes) once both a valid day and time are known. This saves a
  // pending booking record and notifies the console live — the marker
  // itself is always stripped before the customer sees the message,
  // same pattern as [[HANDOFF]].

  const bookDropoffMatch = cleanContent.match(
    /^\[\[BOOK_DROPOFF:day=([a-z]+);time=([0-9:]+)(?:;boxes=([^;\]]*))?(?:;name=([^;\]]*))?(?:;phone=([^;\]]*))?\]\]/i
  );

  if (bookDropoffMatch) {
    const [fullMarker, requestedDay, requestedTime, boxSummary, contactName, contactPhone] = bookDropoffMatch;

    cleanContent = cleanContent.slice(fullMarker.length).trimStart();

    // Always prefer the name/phone the customer just gave for THIS
    // booking — never reuse an old/existing name or number (a
    // WhatsApp display name is often unreliable: nicknames, a shared
    // family phone, a business name). Only fall back to what's on file
    // if the customer's reply genuinely didn't include one (the
    // never-get-stuck path still confirms the booking regardless).
    const booking = {
      customerId: customer._id,
      customerName: (contactName && contactName.trim()) || customer.name,
      phoneNumber: (contactPhone && contactPhone.trim()) || customer.phoneNumber,
      requestedDay: requestedDay.toLowerCase(),
      requestedTime,
      boxSummary: boxSummary ? boxSummary.trim() : null,
      status: 'pending',
      createdAt: new Date()
    };

    const { insertedId } = await bookings().insertOne(booking);

    broadcast('booking.created', {
      _id: insertedId,
      ...booking
    });

    await sendBookingEmail(booking);
    await sendStaffBookingWhatsApp(booking);

    const calendarEventId = await createCalendarEvent(booking);

    if (calendarEventId) {
      await bookings().updateOne(
        { _id: insertedId },
        { $set: { calendarEventId } }
      );
    }
  }


  // ==========================================================
  // BOX MEDIA COMMAND
  // ==========================================================

  if (cleanContent.includes(BOX_MEDIA_MARKER)) {

    console.log(
      `BOX_MEDIA command detected for ${customer.phoneNumber}`
    );

    // --------------------------------------------------------
    // 1. SEND VIDEO
    // --------------------------------------------------------

    const videoMessage = await saveMessage({
      customerId: customer._id,
      senderType,
      content: '[BOX PROMO VIDEO]',
      isRead: true,
      replyToMessageId,
      whatsappStatus: null
    });

    try {
      await sendWhatsAppVideo(
        customer.phoneNumber,
        videoMessage._id.toString()
      );

      videoMessage.whatsappStatus = 'SENT';

    } catch (err) {
      console.error(
        'WhatsApp video send failed:',
        err.response?.data ?? err.message
      );

      videoMessage.whatsappStatus = 'FAILED';
    }

    await messages().updateOne(
      { _id: videoMessage._id },
      {
        $set: {
          whatsappStatus: videoMessage.whatsappStatus
        }
      }
    );

    await broadcastMessageCreated(
      customer,
      videoMessage
    );


    // --------------------------------------------------------
    // 2. SEND FLYER IMAGE
    // --------------------------------------------------------

    const flyerMessage = await saveMessage({
      customerId: customer._id,
      senderType,
      content: '[BOX FLYER]',
      isRead: true,
      replyToMessageId,
      whatsappStatus: null
    });

    try {
      await sendWhatsAppImage(
        customer.phoneNumber,
        flyerMessage._id.toString()
      );

      flyerMessage.whatsappStatus = 'SENT';

    } catch (err) {
      console.error(
        'WhatsApp flyer send failed:',
        err.response?.data ?? err.message
      );

      flyerMessage.whatsappStatus = 'FAILED';
    }

    await messages().updateOne(
      { _id: flyerMessage._id },
      {
        $set: {
          whatsappStatus: flyerMessage.whatsappStatus
        }
      }
    );

    await broadcastMessageCreated(
      customer,
      flyerMessage
    );


    // --------------------------------------------------------
    // HUMAN HANDOFF
    // --------------------------------------------------------

    if (needsAttention) {
      const attentionSource = replyToMessageId
        ? await messages().findOne({ _id: replyToMessageId })
        : null;
      await markNeedsAttention(customer, attentionSource ?? flyerMessage);
    }

    return {
      type: 'BOX_MEDIA',
      videoMessage,
      flyerMessage
    };
  }


  // ==========================================================
  // NORMAL TEXT MESSAGE
  // ==========================================================

  const outgoing = await saveMessage({
    customerId: customer._id,
    senderType,
    content: cleanContent,
    isRead: true,
    replyToMessageId,
    whatsappStatus: null
  });


  try {
    await sendWhatsAppMessage(
      customer.phoneNumber,
      cleanContent,
      outgoing._id.toString()
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'WhatsApp send failed:',
      err.response?.data ?? err.message
    );

    outgoing.whatsappStatus = 'FAILED';
  }


  await messages().updateOne(
    { _id: outgoing._id },
    {
      $set: {
        whatsappStatus: outgoing.whatsappStatus
      }
    }
  );


  await broadcastMessageCreated(
    customer,
    outgoing
  );


  if (needsAttention) {
    // Flag the customer's own message (their complaint/issue) rather
    // than the bot's canned handoff reply, which is the same boilerplate
    // every time and tells staff nothing about what actually happened.
    const attentionSource = replyToMessageId
      ? await messages().findOne({ _id: replyToMessageId })
      : null;
    await markNeedsAttention(customer, attentionSource ?? outgoing);
  }


  return outgoing;
}


// ============================================================
// FLAG CUSTOMER FOR STAFF ATTENTION
// ============================================================
//
// Persisted on the customer doc (not just broadcast live) so the flag —
// and the actual message that triggered it — survives a console page
// reload or a tab that wasn't open at the time. Cleared when a staff
// member switches the conversation to HUMAN mode (see the /mode route).

async function markNeedsAttention(customer, triggerMessage) {
  const needsAttentionMessage = {
    content: triggerMessage.content,
    createdAt: triggerMessage.createdAt
  };

  await customers().updateOne(
    { _id: customer._id },
    { $set: { needsAttention: true, needsAttentionMessage } }
  );

  broadcast('customer.needs_attention', {
    customerId: customer._id,
    customer,

    lastMessage: {
      content: triggerMessage.content,
      senderType: triggerMessage.senderType,
      createdAt: triggerMessage.createdAt
    }
  });
}


// ============================================================
// BROADCAST MESSAGE
// ============================================================

async function broadcastMessageCreated(customer, message) {
  const unreadCount = await messages().countDocuments({
    customerId: customer._id,
    senderType: 'CUSTOMER',
    isRead: false
  });

  broadcast('message.created', {
    message,
    customer,
    unreadCount,

    lastMessage: {
      content: message.content,
      senderType: message.senderType,
      createdAt: message.createdAt
    },

    lastActivityAt: message.createdAt
  });
}


// ============================================================
// META WEBHOOK VERIFICATION
// ============================================================

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    token === VERIFY_TOKEN
  ) {
    console.log('Webhook verified successfully');

    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});


// ============================================================
// RECEIVE WHATSAPP MESSAGE
// ============================================================

app.post('/webhook', async (req, res) => {

  // Acknowledge immediately
  res.sendStatus(200);

  try {

    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) {
      return;
    }


    // ========================================================
    // STATUS UPDATES
    // ========================================================

    if (value.statuses?.length) {

      for (const status of value.statuses) {
        await handleStatusUpdate(status);
      }
    }


    // ========================================================
    // CUSTOMER MESSAGE
    // ========================================================

    const message = value.messages?.[0];

    if (!message) {
      return;
    }


    const from = message.from;

    const waName =
      value.contacts?.[0]?.profile?.name;

    const { customer, isNewCustomer } =
      await findOrCreateCustomer(
        from,
        waName
      );

    if (isNewCustomer) {
      await sendWelcomeMenu(customer);
    }

    let text = message.text?.body;
    let isVoiceMessage = false;

    // A tap on the welcome menu's list — translate it into a clear,
    // natural-language phrase that flows through the exact same
    // Flowise pipeline a typed question would use. This is a
    // deterministic ID-to-phrase lookup, not AI classification, so a
    // tap can never be misread the way a typed reply could be.
    let tappedMenuLabel = null;

    if (!text && message.type === 'interactive' && message.interactive?.list_reply) {
      const tappedItem = WELCOME_MENU_ITEMS.find(
        item => item.id === message.interactive.list_reply.id
      );

      if (tappedItem) {
        text = tappedItem.phrase;
        tappedMenuLabel = message.interactive.list_reply.title;
      }
    }

    if (!text && message.type === 'audio' && message.audio?.id) {

      try {
        text = await transcribeWhatsAppAudio(message.audio.id);
        isVoiceMessage = true;

      } catch (err) {
        console.error(
          'Voice transcription failed:',
          err.response?.data ?? err.message
        );

        await sendAndTrackOutbound(
          customer,
          'CHATBOT',
          "Sorry, I couldn't quite catch that voice message — could you try typing it instead, or send the voice note again?"
        );

        return;
      }
    }

    // Images/videos/documents/stickers can't be read by the bot at
    // all right now — staying silent here reads as the bot ignoring
    // the customer, which is worse than not supporting it. Say so
    // plainly and redirect them to describe it in words instead.
    if (!text && ['image', 'video', 'document', 'sticker'].includes(message.type)) {
      await sendAndTrackOutbound(
        customer,
        'CHATBOT',
        "📸 Thanks for sending that — I can't view photos or files just yet, but if you describe what it is and what you'd like to know, I can help right away!"
      );

      return;
    }

    // Skip anything else unsupported (location, contacts, etc.)
    if (!text) {
      return;
    }


    console.log(
      `Incoming from ${from}: ${tappedMenuLabel || text}`
    );


    // ========================================================
    // SAVE CUSTOMER MESSAGE
    // ========================================================

    const inboundMessage = await saveMessage({
      customerId: customer._id,
      senderType: 'CUSTOMER',
      content: isVoiceMessage ? `🎤 ${text}` : (tappedMenuLabel || text),
      isRead: false,
      replyToMessageId: null,
      whatsappStatus: null
    });


    await broadcastMessageCreated(
      customer,
      inboundMessage
    );


    // ========================================================
    // CHATBOT MODE
    // ========================================================

    if (customer.mode === 'CHATBOT') {

      await sendTypingIndicator(message.id);

      const reply =
        await getFlowiseReply(
          text,
          customer.phoneNumber
        );


      if (reply) {

        // Check if staff took over while Flowise was processing
        const stillChatbot =
          await customers().findOne({
            _id: customer._id,
            mode: 'CHATBOT'
          });


        if (stillChatbot) {

          await sendAndTrackOutbound(
            customer,
            'CHATBOT',
            reply,
            inboundMessage._id,
            isNewCustomer
          );

        } else {

          console.log(
            'Skipping CHATBOT reply — conversation switched to HUMAN while Flowise was processing.'
          );
        }
      }

    }

  } catch (err) {

    console.error(
      'Error handling incoming message:',
      err.message
    );
  }
});


// ============================================================
// LOGIN
// ============================================================

app.post('/api/auth/login', async (req, res) => {

  try {

    const {
      email,
      password
    } = req.body ?? {};


    if (
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        error: 'email and password are required'
      });
    }


    const record =
      await users().findOne({
        email: email.toLowerCase()
      });


    if (
      !record ||
      !verifyPassword(
        password,
        record.passwordHash
      )
    ) {

      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }


    const user = {
      email: record.email,
      name: record.name
    };


    const token =
      signSession({
        ...user,
        sub: record._id.toString(),
        iat: Date.now()
      });


    res.status(200).json({
      token,
      user
    });

  } catch (err) {

    console.error(
      'Error during login:',
      err.message
    );

    res.status(500).json({
      error: 'Login failed'
    });
  }
});


// ============================================================
// SESSION
// ============================================================

app.get('/api/auth/session', (req, res) => {

  const header =
    req.headers.authorization ?? '';

  const token =
    header.startsWith('Bearer ')
      ? header.slice(7)
      : null;


  const session =
    verifySession(token);


  if (!session) {

    return res.status(401).json({
      error: 'Invalid or expired session'
    });
  }


  res.status(200).json({
    user: {
      email: session.email,
      name: session.name
    }
  });
});


// ============================================================
// GET CUSTOMERS
// ============================================================

app.get('/api/customers', async (req, res) => {

  try {

    const [
      allCustomers,
      allMessages
    ] = await Promise.all([

      customers()
        .find({})
        .toArray(),

      messages()
        .find({})
        .sort({ createdAt: 1 })
        .toArray()

    ]);


    const messagesByCustomer =
      new Map();


    for (const message of allMessages) {

      const key =
        message.customerId.toString();

      const bucket =
        messagesByCustomer.get(key);


      if (bucket) {

        bucket.push(message);

      } else {

        messagesByCustomer.set(
          key,
          [message]
        );
      }
    }


    const result =
      allCustomers.map(customer => ({

        ...customer,

        messages:
          messagesByCustomer.get(
            customer._id.toString()
          ) ?? []

      }));


    res.status(200).json({
      customers: result
    });

  } catch (err) {

    console.error(
      'Error listing customers:',
      err.message
    );

    res.status(500).json({
      error: 'Failed to list customers'
    });
  }
});


// ============================================================
// WEBSITE CHAT WIDGET (transcosydney.com.au)
// ============================================================
// Fully additive — see webChatRoutes.js. Does not touch, call, or
// share state with anything on the WhatsApp path.

app.use((req, res, next) => {
  if (req.path.startsWith('/api/web-chat')) {
    res.header('Access-Control-Allow-Origin', 'https://transcosydney.com.au');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

const createWebChatRouter = require('./webChatRoutes');
app.use('/api/web-chat', createWebChatRouter({
  getFlowiseReply,
  saveMessage,
  markNeedsAttention,
  broadcastMessageCreated,
  broadcast,
  sendBookingEmail,
  sendStaffBookingWhatsApp,
  createCalendarEvent,
  MEDIA_BASE_URL
}));


// ============================================================
// LIST BOOKINGS (weekday drop-off appointments)
// ============================================================

app.get('/api/bookings', async (req, res) => {

  try {

    const allBookings = await bookings()
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      bookings: allBookings
    });

  } catch (err) {

    console.error(
      'Error listing bookings:',
      err.message
    );

    res.status(500).json({
      error: 'Failed to list bookings'
    });
  }
});


// ============================================================
// COUNT BOOKINGS FOR A DAY
// ============================================================
//
// Used by the Flowise tool to enforce the daily cap on the Tue-Fri
// 6-7pm drop-off slot before confirming a booking — see the tool's
// request_type=12 handling.

app.get('/api/bookings/count', async (req, res) => {

  try {

    const day = String(req.query.day || '').toLowerCase();

    if (!day) {

      return res.status(400).json({
        error: 'day query parameter is required'
      });
    }

    const count = await bookings().countDocuments({
      requestedDay: day,
      status: { $ne: 'cancelled' }
    });

    res.status(200).json({
      day,
      count
    });

  } catch (err) {

    console.error(
      'Error counting bookings:',
      err.message
    );

    res.status(500).json({
      error: 'Failed to count bookings'
    });
  }
});


// ============================================================
// DELETE BOOKING
// ============================================================
//
// Lets staff remove a booking — a test entry, a duplicate, or a real
// cancellation. Deletes outright rather than soft-cancelling, since the
// console only shows one weekday-grouped list with no separate archive.

app.delete('/api/bookings/:bookingId', async (req, res) => {

  try {

    const { bookingId } = req.params;

    if (!ObjectId.isValid(bookingId)) {

      return res.status(400).json({
        error: 'Invalid booking id'
      });
    }

    const deleted = await bookings().findOneAndDelete({
      _id: new ObjectId(bookingId)
    });

    if (!deleted) {

      return res.status(404).json({
        error: 'Booking not found'
      });
    }

    if (deleted.calendarEventId) {
      await deleteCalendarEvent(deleted.calendarEventId);
    }

    broadcast('booking.deleted', {
      _id: bookingId
    });

    res.status(200).json({
      success: true
    });

  } catch (err) {

    console.error(
      'Error deleting booking:',
      err.message
    );

    res.status(500).json({
      error: 'Failed to delete booking'
    });
  }
});


// ============================================================
// MARK CUSTOMER MESSAGES AS READ
// ============================================================

app.patch(
  '/api/customers/:customerId/read',
  async (req, res) => {

    try {

      const {
        customerId
      } = req.params;


      if (!ObjectId.isValid(customerId)) {

        return res.status(400).json({
          error: 'Invalid customer id'
        });
      }


      const custId =
        new ObjectId(customerId);


      const customer =
        await customers().findOne({
          _id: custId
        });


      if (!customer) {

        return res.status(404).json({
          error: 'Customer not found'
        });
      }


      const unread =
        await messages()
          .find({
            customerId: custId,
            senderType: 'CUSTOMER',
            isRead: false
          })
          .project({
            _id: 1
          })
          .toArray();


      if (unread.length > 0) {

        const messageIds =
          unread.map(m => m._id);


        await messages().updateMany(
          {
            _id: {
              $in: messageIds
            }
          },

          {
            $set: {
              isRead: true
            }
          }
        );


        broadcast(
          'message.read_state_changed',
          {
            customerId: custId,
            messageIds,
            isRead: true,
            unreadCount: 0
          }
        );
      }


      res.status(200).json({
        unreadCount: 0
      });

    } catch (err) {

      console.error(
        'Error marking messages read:',
        err.message
      );

      res.status(500).json({
        error: 'Failed to mark messages read'
      });
    }
  }
);


// ============================================================
// STAFF SENDS MESSAGE
// ============================================================

app.post(
  '/api/customers/:customerId/messages',
  async (req, res) => {

    try {

      const {
        customerId
      } = req.params;


      const {
        content,
        replyToMessageId
      } = req.body ?? {};


      if (!ObjectId.isValid(customerId)) {

        return res.status(400).json({
          error: 'Invalid customer id'
        });
      }


      if (
        typeof content !== 'string' ||
        !content.trim()
      ) {

        return res.status(400).json({
          error: 'content is required'
        });
      }


      const customer =
        await customers().findOne({
          _id: new ObjectId(customerId)
        });


      if (!customer) {

        return res.status(404).json({
          error: 'Customer not found'
        });
      }


      if (customer.mode !== 'HUMAN') {

        return res.status(409).json({
          error: 'Conversation is not in HUMAN mode'
        });
      }


      let resolvedReplyId = null;


      if (replyToMessageId) {

        if (
          !ObjectId.isValid(
            replyToMessageId
          )
        ) {

          return res.status(400).json({
            error: 'Invalid replyToMessageId'
          });
        }


        const target =
          await messages().findOne({

            _id:
              new ObjectId(
                replyToMessageId
              ),

            customerId:
              customer._id,

            senderType:
              'CUSTOMER'

          });


        if (!target) {

          return res.status(400).json({
            error:
              'replyToMessageId does not reference a customer message in this conversation'
          });
        }


        resolvedReplyId =
          target._id;
      }


      const outgoing =
        await sendAndTrackOutbound(
          customer,
          'HUMAN',
          content.trim(),
          resolvedReplyId
        );


      res.status(201).json({
        message: outgoing
      });

    } catch (err) {

      console.error(
        'Error sending human message:',
        err.message
      );

      res.status(500).json({
        error: 'Failed to send message'
      });
    }
  }
);


// ============================================================
// CUSTOMER MODE
// ============================================================

const ALLOWED_MODES = [
  'CHATBOT',
  'HUMAN'
];


app.patch(
  '/api/customers/:customerId/mode',
  async (req, res) => {

    try {

      const {
        customerId
      } = req.params;


      const {
        mode
      } = req.body ?? {};


      if (!ObjectId.isValid(customerId)) {

        return res.status(400).json({
          error: 'Invalid customer id'
        });
      }


      if (
        !ALLOWED_MODES.includes(mode)
      ) {

        return res.status(400).json({
          error:
            'mode must be CHATBOT or HUMAN'
        });
      }


      const setFields = { mode };

      if (mode === 'HUMAN') {
        setFields.needsAttention = false;
        setFields.needsAttentionMessage = null;
      }

      const updated =
        await customers().findOneAndUpdate(

          {
            _id:
              new ObjectId(customerId)
          },

          {
            $set: setFields
          },

          {
            returnDocument: 'after'
          }
        );


      if (!updated) {

        return res.status(404).json({
          error: 'Customer not found'
        });
      }


      broadcast(
        'customer.mode_changed',
        {
          customerId: updated._id,
          mode: updated.mode,
          customer: updated
        }
      );


      res.status(200).json({
        customer: updated
      });

    } catch (err) {

      console.error(
        'Error updating customer mode:',
        err.message
      );

      res.status(500).json({
        error: 'Failed to update mode'
      });
    }
  }
);


// ============================================================
// FLOWISE
// ============================================================

async function getFlowiseReply(
  text,
  chatId
) {

  const isBadReply = reply => {

    if (!reply) {
      return true;
    }


    const lower =
      reply.toLowerCase();


    return (
      lower.includes(
        'cannot read properties'
      ) ||

      lower.includes(
        'undefined'
      ) ||

      lower.includes(
        'error'
      ) ||

      lower.includes(
        'oops'
      ) ||

      lower.includes(
        'did not match'
      ) ||

      lower.includes(
        'tool input'
      ) ||

      lower.includes(
        'invalid input'
      ) ||

      lower.includes(
        'max iterations'
      ) ||

      lower.includes(
        'agent stopped'
      )
    );
  };


  for (
    let attempt = 1;
    attempt <= 2;
    attempt++
  ) {

    try {

      const response =
        await axios.post(

          `${FLOWISE_URL}/api/v1/prediction/${FLOWISE_CHATFLOW_ID}`,

          {
            question: text,
            chatId: chatId
          }

        );


      const reply =
        response.data?.text;


      if (!isBadReply(reply)) {

        return reply;
      }


      console.log(
        `Attempt ${attempt} got a bad reply, retrying...`
      );

    } catch (err) {

      console.error(
        `Attempt ${attempt} failed:`,
        err.message
      );
    }
  }


  console.error(
    'Flowise did not return a usable reply after retries; skipping CHATBOT response.'
  );


  return null;
}


// ============================================================
// TYPING INDICATOR
// ============================================================
//
// Marks the inbound message as read and shows the "typing..." bubble
// in the customer's chat for up to 25 seconds (or until we actually
// reply, whichever comes first) — masks the Flowise/media latency the
// same way a real WhatsApp conversation looks while someone types.
// Best-effort only: failures here should never block the actual reply.

async function sendTypingIndicator(inboundWhatsAppMessageId) {

  try {
    await axios.post(

      `${WHATSAPP_API_BASE_URL}/${PHONE_NUMBER_ID}/messages`,

      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: inboundWhatsAppMessageId,
        typing_indicator: {
          type: 'text'
        }
      },

      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }

    );

  } catch (err) {
    console.error(
      'Typing indicator failed:',
      err.response?.data ?? err.message
    );
  }
}


// ============================================================
// NORMAL WHATSAPP TEXT
// ============================================================

async function sendWhatsAppMessage(
  to,
  text,
  bizOpaqueCallbackData
) {

  const payload = {

    messaging_product: 'whatsapp',

    to: to,

    text: {
      body: text
    }

  };


  if (bizOpaqueCallbackData) {

    payload.biz_opaque_callback_data =
      bizOpaqueCallbackData;
  }


  await axios.post(

    `${WHATSAPP_API_BASE_URL}/${PHONE_NUMBER_ID}/messages`,

    payload,

    {
      headers: {

        Authorization:
          `Bearer ${WHATSAPP_TOKEN}`,

        'Content-Type':
          'application/json'

      }
    }

  );
}


// ============================================================
// WELCOME MENU (new customers only)
// ============================================================
//
// Sent exactly once — the very first time we ever hear from a phone
// number — BEFORE their actual message is answered. This is a native
// WhatsApp tappable list, not AI-classified text, so picking an
// option can never be misread the way a typed reply could be. A tap
// feeds a clear, natural-language phrase into the exact same Flowise
// pipeline a typed question would use (see the interactive-message
// handling in the webhook above), so there's no separate answer path
// to keep in sync with the rest of the bot's knowledge.

const WELCOME_MENU_ITEMS = [
  { id: 'menu_price', title: '💰 Get a Price Quote', phrase: "I'd like to get a price quote" },
  { id: 'menu_track', title: '📦 Track My Shipment', phrase: 'I want to track my shipment' },
  { id: 'menu_air', title: '✈️ Air Freight Info', phrase: 'Tell me about Air Freight' },
  { id: 'menu_sea', title: '🚢 Sea Freight Info', phrase: 'Tell me about Sea Freight' },
  { id: 'menu_declaration', title: '📋 Declaration Form', phrase: 'Send me the Declaration Form' },
  { id: 'menu_staff', title: '👤 Talk to Our Team', phrase: "I'd like to talk to a staff member" }
];

// Same wording as the plain-text greeting (request_type=7 in the
// Flowise tool) minus the four-line feature list, which the tappable
// menu below now covers instead.
const WELCOME_BODY_TEXT =
  "👋 *Welcome to Transco Cargo Sydney!*\n\n" +
  "I'm your dedicated Transco Cargo agent, here to make shipping to Sri Lanka.\n\n" +
  "💬 Happy to chat in English, සිංහල, or தமிழ் — just write in whichever you're comfortable with.\n\n" +
  "🎉 *Current Promotion:* Ship 3 boxes to the same receiver and the 3rd box's freight is FREE!\n\n" +
  "🌐 Website: https://transcosydney.com.au/\n\n" +
  "*How can I help you today?*";

async function sendWhatsAppInteractiveList(to, bizOpaqueCallbackData) {

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Transco Cargo Sydney' },
      body: {
        text: WELCOME_BODY_TEXT
      },
      footer: { text: 'We reply in English, Sinhala & Tamil' },
      action: {
        button: 'Menu',
        sections: [
          {
            title: 'Quick Options',
            rows: WELCOME_MENU_ITEMS.map(({ id, title }) => ({ id, title }))
          }
        ]
      }
    }
  };

  if (bizOpaqueCallbackData) {
    payload.biz_opaque_callback_data = bizOpaqueCallbackData;
  }

  await axios.post(

    `${WHATSAPP_API_BASE_URL}/${PHONE_NUMBER_ID}/messages`,

    payload,

    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }

  );
}

async function sendWelcomeMenu(customer) {

  const summary =
    WELCOME_BODY_TEXT +
    "\n\n[Menu: " +
    WELCOME_MENU_ITEMS.map(item => item.title).join(' / ') +
    ']';

  const outgoing = await saveMessage({
    customerId: customer._id,
    senderType: 'CHATBOT',
    content: summary,
    isRead: true,
    replyToMessageId: null,
    whatsappStatus: null
  });

  try {
    await sendWhatsAppInteractiveList(
      customer.phoneNumber,
      outgoing._id.toString()
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Welcome menu send failed:',
      err.response?.data ?? err.message
    );

    outgoing.whatsappStatus = 'FAILED';
  }

  await messages().updateOne(
    { _id: outgoing._id },
    { $set: { whatsappStatus: outgoing.whatsappStatus } }
  );

  await broadcastMessageCreated(customer, outgoing);
}


// ============================================================
// WHATSAPP VIDEO
// ============================================================

async function sendWhatsAppVideo(
  to,
  bizOpaqueCallbackData
) {

  if (!MEDIA_BASE_URL) {

    throw new Error(
      'MEDIA_BASE_URL is not configured in .env'
    );
  }


  const videoUrl =
    `${MEDIA_BASE_URL}/media/BOX_Promo_video.mp4`;


  console.log(
    'Sending box video:',
    videoUrl
  );


  const payload = {

    messaging_product: 'whatsapp',

    to: to,

    type: 'video',

    video: {
      link: videoUrl
    }

  };


  if (bizOpaqueCallbackData) {

    payload.biz_opaque_callback_data =
      bizOpaqueCallbackData;
  }


  await axios.post(

    `${WHATSAPP_API_BASE_URL}/${PHONE_NUMBER_ID}/messages`,

    payload,

    {
      headers: {

        Authorization:
          `Bearer ${WHATSAPP_TOKEN}`,

        'Content-Type':
          'application/json'

      }
    }

  );
}


// ============================================================
// WHATSAPP IMAGE / FLYER
// ============================================================

async function sendWhatsAppImage(
  to,
  bizOpaqueCallbackData
) {

  if (!MEDIA_BASE_URL) {

    throw new Error(
      'MEDIA_BASE_URL is not configured in .env'
    );
  }


  const imageUrl =
    `${MEDIA_BASE_URL}/media/Box_Flyer.jpg`;


  console.log(
    'Sending box flyer:',
    imageUrl
  );


  const payload = {

    messaging_product: 'whatsapp',

    to: to,

    type: 'image',

    image: {
      link: imageUrl
    }

  };


  if (bizOpaqueCallbackData) {

    payload.biz_opaque_callback_data =
      bizOpaqueCallbackData;
  }


  await axios.post(

    `${WHATSAPP_API_BASE_URL}/${PHONE_NUMBER_ID}/messages`,

    payload,

    {
      headers: {

        Authorization:
          `Bearer ${WHATSAPP_TOKEN}`,

        'Content-Type':
          'application/json'

      }
    }

  );
}


// ============================================================
// VOICE MESSAGE TRANSCRIPTION
// ============================================================
//
// WhatsApp voice notes arrive as message.type === 'audio', with no
// text.body at all. This resolves the media id to a temporary download
// URL, downloads the audio (both steps need the WhatsApp token), then
// sends it to Groq's (OpenAI-compatible) Whisper API for transcription.
// The result feeds straight into the normal getFlowiseReply() text
// flow, so language detection, request routing, everything downstream
// just works unchanged — Whisper auto-detects the spoken language.

async function transcribeWhatsAppAudio(mediaId) {

  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const mediaInfo = await axios.get(
    `${WHATSAPP_API_BASE_URL}/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    }
  );

  const audioResponse = await axios.get(
    mediaInfo.data.url,
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      },
      responseType: 'arraybuffer'
    }
  );

  const audioBuffer = Buffer.from(audioResponse.data);
  const mimeType = mediaInfo.data.mime_type || 'audio/ogg';

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimeType }), 'voice.ogg');
  form.append('model', 'whisper-large-v3');

  const transcriptionResponse = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: form
    }
  );

  if (!transcriptionResponse.ok) {
    const errText = await transcriptionResponse.text();
    throw new Error(`Groq transcription failed: ${transcriptionResponse.status} ${errText}`);
  }

  const result = await transcriptionResponse.json();
  return result.text;
}


// ============================================================
// WHATSAPP STATUS
// ============================================================

const WHATSAPP_STATUS_MAP = {

  sent: 'SENT',

  delivered: 'DELIVERED',

  read: 'READ',

  failed: 'FAILED'

};


// ============================================================
// HANDLE WHATSAPP STATUS
// ============================================================

async function handleStatusUpdate(
  status
) {

  const mapped =
    WHATSAPP_STATUS_MAP[
      status.status
    ];


  if (!mapped) {
    return;
  }

  if (status.status === 'failed' && status.errors?.length) {
    console.error(
      `WhatsApp delivery failed for ${status.recipient_id} (wamid ${status.id}):`,
      JSON.stringify(status.errors)
    );
  }


  const correlationId =
    status.biz_opaque_callback_data;


  if (
    !correlationId ||
    !ObjectId.isValid(
      correlationId
    )
  ) {

    console.warn(
      `Received WhatsApp status "${status.status}" with no correlatable message id (wamid ${status.id})`
    );

    return;
  }


  const updated =
    await messages().findOneAndUpdate(

      {
        _id:
          new ObjectId(
            correlationId
          )
      },

      {
        $set: {
          whatsappStatus: mapped
        }
      },

      {
        returnDocument: 'after'
      }

    );


  if (!updated) {
    return;
  }


  broadcast(
    'message.status_changed',
    {
      messageId: updated._id,
      customerId: updated.customerId,
      whatsappStatus:
        updated.whatsappStatus
    }
  );
}


// ============================================================
// START SERVER
// ============================================================

const httpServer =
  http.createServer(app);


initWebSocketServer(
  httpServer
);


connectToDatabase(
  MONGODB_URI,
  process.env.MONGODB_DB_NAME
)

  .then(() => seedStaffUser())

  .then(() => {

    httpServer.listen(
      PORT,
      () => {

        console.log(
          `Agent Transco bridge running on port ${PORT}`
        );

        console.log(
          `Media folder available at /media`
        );

        if (MEDIA_BASE_URL) {

          console.log(
            `Media public URL: ${MEDIA_BASE_URL}/media/`
          );

        } else {

          console.warn(
            'WARNING: MEDIA_BASE_URL is not configured.'
          );
        }

      }
    );

  });