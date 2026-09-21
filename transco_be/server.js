require('dotenv').config({ quiet: true });

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const { ObjectId } = require('mongodb');

const { connectToDatabase, customers, messages, users, bookings, settings } = require('./db');
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
// MAINTENANCE MODE (global pause)
// ============================================================
//
// A single global on/off switch, checked before every AUTOMATED
// (CHATBOT-mode) reply on both WhatsApp and the website. Deliberately
// does NOT affect conversations already in HUMAN mode — staff who've
// already taken a conversation over can keep replying manually; this
// only stops the bot from picking up new or ongoing automated
// conversations. Built for exactly one scenario: someone finds the
// bot and starts abusing it (spam, prank messages) — staff can shut
// off all automated replies instantly from the console, everywhere,
// without needing to touch Flowise or redeploy anything.
//
// Two independent flags (websitePaused, whatsappPaused) rather than
// one — the website widget is publicly discoverable by anyone who
// visits transcosydney.com.au, so it's a more likely target for abuse
// than WhatsApp (which requires already having the business number).
// Staff need to be able to shut off just the exposed channel without
// silencing WhatsApp for genuine customers at the same time. "Stop
// All"/"Resume All" in the console is just both flags set together in
// one request — there's no separate third flag for it, which would
// only invite a state where it disagrees with the two real ones.
//
// Combined English/Sinhala/Tamil text, since language isn't known yet
// at this point — the classifier that would normally detect it
// (Flowise) is exactly what's being skipped while paused. Shared by
// both channels; no reason for the wording to differ.

const MAINTENANCE_MESSAGE =
  "👋 Thanks for reaching out! Our chat assistant is temporarily paused for maintenance — we'll be back shortly. For anything urgent, please call us on 0468 382 023.\n\n" +
  "ආයුබෝවන්! අපේ chat assistant එක temporary maintenance එකක් සඳහා නවත්වලා තියෙනවා — ඉක්මනින්ම නැවත ලැබෙනවා. හදිසි නම් 0468 382 023 අමතන්න.\n\n" +
  "வணக்கம்! எங்கள் chat assistant தற்காலிகமாக maintenance காரணமாக நிறுத்தப்பட்டுள்ளது — விரைவில் மீண்டும் வரும். அவசரமெனில் 0468 382 023 ஐ அழைக்கவும்.";

async function isWebsitePausedOn() {
  const doc = await settings().findOne({ _id: 'global' });
  return Boolean(doc?.websitePaused);
}

async function isWhatsAppPausedOn() {
  const doc = await settings().findOne({ _id: 'global' });
  return Boolean(doc?.whatsappPaused);
}


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
const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatBookingDayLine(booking) {
  const dayLabel =
    booking.requestedDay.charAt(0).toUpperCase() +
    booking.requestedDay.slice(1);

  try {
    const date = resolveBookingDate(booking);
    // Built manually from the UTC-suffixed getters (matching the
    // getSydneyNow()/nextDateForWeekday() convention) rather than
    // toLocaleDateString(..., {timeZone: 'Australia/Sydney'}) — that
    // asks the runtime's own timezone database to do the conversion,
    // which is exactly the fragile pattern that caused a booking to
    // be mislabeled with the wrong date in the first place.
    const dateLabel = `${date.getUTCDate()} ${MONTH_NAMES_FULL[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
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


// Computes the current Sydney wall-clock time WITHOUT depending on the
// runtime's own Intl/timezone database. The previous approach — new
// Date(new Date().toLocaleString('en-US', {timeZone: 'Australia/
// Sydney'})) — silently breaks if the hosting environment's timezone
// data is incomplete, which is confirmed to have happened live: a
// "tomorrow" booking resolved to the wrong weekday entirely. This
// applies Sydney's own fixed DST rule directly instead: AEDT (UTC+11)
// from the first Sunday of October to the first Sunday of April, AEST
// (UTC+10) otherwise — no timezone database needed at all.
// IMPORTANT: the returned Date is deliberately shifted, so always read
// it back with the UTC-suffixed getters (getUTCDay, getUTCHours,
// getUTCDate, etc.) — never the plain local getters, which would
// apply the server's OWN timezone on top and double-shift it. Every
// function below that works with "Sydney time" follows this same
// convention, so they can all be combined safely.
function getSydneyNow() {
  const utcNow = new Date();
  const year = utcNow.getUTCFullYear();

  const firstSundayUTC = (y, monthIndex0) => {
    const d = new Date(Date.UTC(y, monthIndex0, 1));
    return new Date(Date.UTC(y, monthIndex0, 1 + ((7 - d.getUTCDay()) % 7)));
  };

  const aprFirstSunday = firstSundayUTC(year, 3);
  const octFirstSunday = firstSundayUTC(year, 9);

  const isDST = utcNow >= octFirstSunday || utcNow < aprFirstSunday;
  const offsetHours = isDST ? 11 : 10;

  return new Date(utcNow.getTime() + offsetHours * 60 * 60 * 1000);
}

// Finds the next real calendar date for a weekday name + HH:MM time,
// in Australia/Sydney time. If that day/time is later today, uses
// today; otherwise rolls forward to next week's occurrence. Returned
// Date follows the same "read with UTC getters" convention as
// getSydneyNow() above.

function nextDateForWeekday(dayName, timeHHMM) {
  const DAY_NAMES = [
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday'
  ];

  const targetDow = DAY_NAMES.indexOf(dayName.toLowerCase());

  const nowSydney = getSydneyNow();

  const [hh, mm] = timeHHMM.split(':').map(Number);

  let diff = (targetDow - nowSydney.getUTCDay() + 7) % 7;

  if (diff === 0) {
    const nowMinutes = nowSydney.getUTCHours() * 60 + nowSydney.getUTCMinutes();
    const targetMinutes = hh * 60 + mm;

    if (targetMinutes <= nowMinutes) {
      diff = 7;
    }
  }

  return new Date(Date.UTC(
    nowSydney.getUTCFullYear(),
    nowSydney.getUTCMonth(),
    nowSydney.getUTCDate() + diff,
    hh, mm, 0, 0
  ));
}

// Resolves the actual target Date for a booking. If the customer named
// an explicit date (e.g. "12th September") rather than a day name, the
// Flowise tool already resolved it to a real calendar date using its
// own clock — requestedDateISO carries that through untouched, so it's
// used directly here instead of being re-derived. This is exactly what
// a past booking was missing: re-deriving "next Thursday" from a
// guessed day name landed on a completely different, wrong date than
// what the customer actually asked for. Falls back to the day-name
// lookup only when no explicit date was captured.
function resolveBookingDate(booking) {
  if (booking.requestedDateISO) {
    const [y, m, d] = booking.requestedDateISO.split('-').map(Number);
    const [hh, mm] = booking.requestedTime.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
  }
  return nextDateForWeekday(booking.requestedDay, booking.requestedTime);
}


// Reads via the UTC-suffixed getters — date here follows the
// getSydneyNow()/nextDateForWeekday() convention (a Date object
// deliberately shifted so its UTC getters report Sydney wall-clock
// values). Produces a floating (no offset) datetime string; Google
// Calendar is told separately (see the "timeZone: 'Australia/Sydney'"
// field alongside this) how to interpret it — so this never depends
// on our own runtime's timezone database either.
function formatCalendarDateTime(date) {
  const pad = n => String(n).padStart(2, '0');

  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`
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

    const startDate = resolveBookingDate(booking);
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
  const FLYER_ONLY_MARKER = '[[SEND_FLYER]]';
  const SHOW_MENU_MARKER = '[[SHOW_MENU]]';
  const ASK_QUANTITY_MARKER = '[[ASK_QUANTITY]]';
  const SHOW_BOX_MENU_MARKER = '[[SHOW_BOX_MENU]]';
  const SHOW_AIR_MENU_MARKER = '[[SHOW_AIR_MENU]]';
  const SHOW_SEA_MENU_MARKER = '[[SHOW_SEA_MENU]]';
  const SHOW_FREIGHT_MODE_MENU_MARKER = '[[SHOW_FREIGHT_MODE_MENU]]';
  const SHOW_PICKUP_DELIVERY_MENU_MARKER = '[[SHOW_PICKUP_DELIVERY_MENU]]';
  const SHOW_PICKUP_DELIVERY_MENU_INDIA_MARKER = '[[SHOW_PICKUP_DELIVERY_MENU_INDIA]]';
  const SHOW_COUNTRY_MENU_MARKER = '[[SHOW_COUNTRY_MENU]]';
  const SET_NAME_RE = /^\[\[SET_NAME:([^\]]+)\]\]/;

  const needsAttention = content.startsWith(HANDOFF_MARKER);

  let cleanContent = needsAttention
    ? content.slice(HANDOFF_MARKER.length).trimStart()
    : content;

  // The customer stated (or corrected) their real name in
  // conversation — not necessarily as part of completing a booking
  // (that case is handled separately, wherever this reply's booking
  // marker is parsed). Update the console's display name right away,
  // rather than trusting only the WhatsApp profile display name (a
  // nickname, a shared family phone, a business name — already known
  // to be unreliable, see the booking flow's own name-capture notes).
  const setNameMatch = cleanContent.match(SET_NAME_RE);
  if (setNameMatch) {
    const statedName = setNameMatch[1].trim();
    cleanContent = cleanContent.slice(setNameMatch[0].length).trimStart();
    if (statedName) {
      await customers().updateOne(
        { _id: customer._id },
        { $set: { name: statedName } }
      );
    }
  }

  // Can appear anywhere in the reply (typically appended at the very
  // end, after a video/flyer's accompanying text, or after a Sea/Air
  // Freight info dump) — stripped up front, independent of whichever
  // branch below actually sends the content, so the relevant native
  // menu shows after it regardless of whether this reply also included
  // media.
  const wantsBoxMenu = cleanContent.includes(SHOW_BOX_MENU_MARKER);
  if (wantsBoxMenu) {
    cleanContent = cleanContent.split(SHOW_BOX_MENU_MARKER).join('').trim();
  }

  const wantsAirMenu = cleanContent.includes(SHOW_AIR_MENU_MARKER);
  if (wantsAirMenu) {
    cleanContent = cleanContent.split(SHOW_AIR_MENU_MARKER).join('').trim();
  }

  const wantsSeaMenu = cleanContent.includes(SHOW_SEA_MENU_MARKER);
  if (wantsSeaMenu) {
    cleanContent = cleanContent.split(SHOW_SEA_MENU_MARKER).join('').trim();
  }

  // Sea-vs-Air comparison (request_type=15) shouldn't nudge the
  // customer toward Sea Freight with a Sea-only menu before they've
  // actually chosen — they asked specifically to compare, so the menu
  // needs to offer both directions, not assume one.
  const wantsFreightModeMenu = cleanContent.includes(SHOW_FREIGHT_MODE_MENU_MARKER);
  if (wantsFreightModeMenu) {
    cleanContent = cleanContent.split(SHOW_FREIGHT_MODE_MENU_MARKER).join('').trim();
  }


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
  // ASK QUANTITY COMMAND
  // ==========================================================
  // Flowise's request_type=1 flow prefixes its "how many boxes?"
  // question with [[ASK_QUANTITY]] once box type and (for Tea Chest)
  // nothing else is known yet. On WhatsApp we replace that plain-text
  // question with a native tappable list (1-9 + "10 or more" — see
  // QUANTITY_MENU_ITEMS, capped at 10 rows by WhatsApp's own list
  // limit) instead of leaving it as free text. The question text
  // itself (already in the customer's language) becomes the list's
  // body, so this stays consistent across English/Sinhala/Tamil.

  if (cleanContent.includes(ASK_QUANTITY_MARKER)) {
    const bodyText = cleanContent.split(ASK_QUANTITY_MARKER).join('').trim();
    await sendQuantityMenu(customer, bodyText);
    return;
  }


  // ==========================================================
  // PICKUP OR DELIVERY MENU COMMAND
  // ==========================================================
  // Flowise's request_type=1 flow prefixes its "Wattala warehouse
  // pickup or door delivery?" question with
  // [[SHOW_PICKUP_DELIVERY_MENU]] whenever it needs to know which
  // before it can quote a price. Same pattern as ASK QUANTITY above —
  // the question text becomes the native list's body, staying
  // consistent across English/Sinhala/Tamil. Tapping "Door Delivery"
  // still leads to being asked for a destination next, same as if the
  // customer had typed it — this just saves the typing.

  if (cleanContent.includes(SHOW_PICKUP_DELIVERY_MENU_MARKER)) {
    const bodyText = cleanContent.split(SHOW_PICKUP_DELIVERY_MENU_MARKER).join('').trim();
    await sendPickupDeliveryMenu(customer, bodyText);
    return;
  }

  // India's pickup point is Seven Hills, not Wattala — a separate
  // marker (rather than reusing SHOW_PICKUP_DELIVERY_MENU_MARKER)
  // keeps the button wording correct per country instead of showing
  // an India customer a "Wattala Pickup" button.
  if (cleanContent.includes(SHOW_PICKUP_DELIVERY_MENU_INDIA_MARKER)) {
    const bodyText = cleanContent.split(SHOW_PICKUP_DELIVERY_MENU_INDIA_MARKER).join('').trim();
    await sendPickupDeliveryMenuIndia(customer, bodyText);
    return;
  }

  // Two entirely different pricing/logistics models live behind this
  // one bot (Sri Lanka vs. India) — asked as a tappable menu whenever
  // a generic "I want to send something" intent (request_type=16)
  // doesn't already make the destination clear, same reasoning as
  // pickup-vs-delivery above.
  if (cleanContent.includes(SHOW_COUNTRY_MENU_MARKER)) {
    const bodyText = cleanContent.split(SHOW_COUNTRY_MENU_MARKER).join('').trim();
    await sendCountryMenu(customer, bodyText);
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
    /^\[\[BOOK_DROPOFF:day=([a-z]+);time=([0-9:]+)(?:;date=([0-9-]*))?(?:;boxes=([^;\]]*))?(?:;name=([^;\]]*))?(?:;phone=([^;\]]*))?\]\]/i
  );

  if (bookDropoffMatch) {
    const [fullMarker, requestedDay, requestedTime, requestedDateISO, boxSummary, contactName, contactPhone] = bookDropoffMatch;

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
      requestedDateISO: requestedDateISO || null,
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

  const wantsVideo = cleanContent.includes(BOX_MEDIA_MARKER);
  const wantsFlyerOnly = !wantsVideo && cleanContent.includes(FLYER_ONLY_MARKER);

  if (wantsVideo || wantsFlyerOnly) {

    console.log(
      `${wantsVideo ? 'BOX_MEDIA' : 'FLYER_ONLY'} command detected for ${customer.phoneNumber}`
    );

    // Strip the marker itself out of the text that goes on to be sent
    // as a real message below — it was previously only ever checked
    // for, never removed, which didn't matter while this whole branch
    // discarded cleanContent anyway (see the ACCOMPANYING TEXT step
    // further down, added to fix exactly that).
    cleanContent = cleanContent.split(BOX_MEDIA_MARKER).join('').split(FLYER_ONLY_MARKER).join('').trim();

    // --------------------------------------------------------
    // 1. SEND VIDEO (skipped for a flyer-only reply, e.g. the
    // WhatsApp menu's "Sea Freight Info" option — informational,
    // not the general shipping-intent promo)
    // --------------------------------------------------------

    let videoMessage = null;

    if (wantsVideo) {
      videoMessage = await saveMessage({
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
    }


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
    // 3. ACCOMPANYING TEXT (if any)
    // --------------------------------------------------------
    // Whatever the LLM wrote alongside the marker (e.g. request_type=16's
    // promo blurb or request_type=29's Sea Freight intro) used to be
    // silently discarded — this function returned right after sending
    // the media, so the customer got a bare video/image with zero
    // explanation. That's exactly what showed up as a real bug: a
    // customer asked "what is this video about?" and got no answer at
    // all, just another unexplained flyer image.

    let textMessage = null;

    if (cleanContent) {
      textMessage = await saveMessage({
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
          textMessage._id.toString()
        );

        textMessage.whatsappStatus = 'SENT';

      } catch (err) {
        console.error(
          'WhatsApp text (accompanying media) send failed:',
          err.response?.data ?? err.message
        );

        textMessage.whatsappStatus = 'FAILED';
      }

      await messages().updateOne(
        { _id: textMessage._id },
        { $set: { whatsappStatus: textMessage.whatsappStatus } }
      );

      await broadcastMessageCreated(customer, textMessage);
    }


    // --------------------------------------------------------
    // 4. BOX / AIR / SEA FREIGHT MENU (if requested)
    // --------------------------------------------------------
    // Shown last, after the video/flyer and its explanation, so a
    // customer who's just been sold on the promo can go straight into
    // getting a quote (or another next step) with one tap instead of
    // typing it out.

    if (wantsBoxMenu) {
      await sendBoxTypeMenu(customer);
    }
    if (wantsAirMenu) {
      await sendAirFreightMenu(customer);
    }
    if (wantsSeaMenu) {
      await sendSeaFreightMenu(customer);
    }
    if (wantsFreightModeMenu) {
      await sendFreightModeMenu(customer);
    }


    // --------------------------------------------------------
    // HUMAN HANDOFF
    // --------------------------------------------------------

    if (needsAttention) {
      const attentionSource = replyToMessageId
        ? await messages().findOne({ _id: replyToMessageId })
        : null;
      await markNeedsAttention(customer, attentionSource ?? textMessage ?? flyerMessage);
    }

    return {
      type: wantsVideo ? 'BOX_MEDIA' : 'FLYER_ONLY',
      videoMessage,
      flyerMessage,
      textMessage
    };
  }


  // ==========================================================
  // SAFETY NET — STRIP ANY UNRECOGNIZED MARKER
  // ==========================================================
  // By this point every real marker the tool can return has already
  // been matched and handled above. Anything still shaped like
  // [[SOMETHING]] here is either a marker the LLM hallucinated on its
  // own (has happened — e.g. a made-up [[ASK_DESTINATION]] that isn't
  // one this system defines) or a typo in a real one — either way it
  // must never reach the customer as visible bracket text.
  if (/\[\[[^\]]*\]\]/.test(cleanContent)) {
    console.warn('Unrecognized [[...]] marker in reply, stripping before send:', cleanContent);
    cleanContent = cleanContent.replace(/\[\[[^\]]*\]\]/g, '').trim();
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

  // Shown last, in case a plain-text reply (no video/flyer) also asked
  // for a menu — same handling as the media branch above. This is the
  // path request_type=14/15/29's text replies actually go through
  // (they don't send video/flyer), so this is where Air/Sea menus
  // normally fire.
  if (wantsBoxMenu) {
    await sendBoxTypeMenu(customer);
  }
  if (wantsAirMenu) {
    await sendAirFreightMenu(customer);
  }
  if (wantsSeaMenu) {
    await sendSeaFreightMenu(customer);
  }
  if (wantsFreightModeMenu) {
    await sendFreightModeMenu(customer);
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
    // "Get a Price Quote" shows the box-type menu directly instead of
    // going through Flowise — asking box type BEFORE quantity, the
    // same order a human would ask in. See sendBoxTypeMenu above.
    let showBoxTypeMenu = false;
    // "10 or more" on the quantity menu has no fixed phrase to feed
    // Flowise (we don't know the real number) — reply directly asking
    // for a typed number instead of routing it through the AI at all.
    let askTypedQuantity = false;
    // "Our Website" is a static fact, not something that needs an AI
    // round-trip — reply directly with the link, same reasoning as
    // askTypedQuantity above.
    let askWebsiteLink = false;

    if (!text && message.type === 'interactive' && message.interactive?.list_reply) {
      const tappedId = message.interactive.list_reply.id;

      if (tappedId === 'menu_price') {
        showBoxTypeMenu = true;
        text = message.interactive.list_reply.title;
        tappedMenuLabel = message.interactive.list_reply.title;
      } else if (tappedId === 'qty_10plus') {
        askTypedQuantity = true;
        text = message.interactive.list_reply.title;
        tappedMenuLabel = message.interactive.list_reply.title;
      } else if (tappedId === 'menu_website') {
        askWebsiteLink = true;
        text = message.interactive.list_reply.title;
        tappedMenuLabel = message.interactive.list_reply.title;
      } else {
        const tappedItem =
          WELCOME_MENU_ITEMS.find(item => item.id === tappedId) ||
          BOX_TYPE_MENU_ITEMS.find(item => item.id === tappedId) ||
          QUANTITY_MENU_ITEMS.find(item => item.id === tappedId) ||
          AIR_FREIGHT_MENU_ITEMS.find(item => item.id === tappedId) ||
          SEA_FREIGHT_MENU_ITEMS.find(item => item.id === tappedId) ||
          FREIGHT_MODE_MENU_ITEMS.find(item => item.id === tappedId) ||
          PICKUP_DELIVERY_MENU_ITEMS.find(item => item.id === tappedId) ||
          PICKUP_DELIVERY_MENU_ITEMS_INDIA.find(item => item.id === tappedId) ||
          COUNTRY_MENU_ITEMS.find(item => item.id === tappedId);

        if (tappedItem) {
          text = tappedItem.phrase;
          tappedMenuLabel = message.interactive.list_reply.title;
        }
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

    if (showBoxTypeMenu && customer.mode === 'CHATBOT') {
      await sendBoxTypeMenu(customer);
      return;
    }

    if (askTypedQuantity && customer.mode === 'CHATBOT') {
      await sendAndTrackOutbound(
        customer,
        'CHATBOT',
        "No problem! Just type in the exact number of boxes you're sending (up to 30) and I'll work out the price.",
        inboundMessage._id
      );
      return;
    }

    if (askWebsiteLink && customer.mode === 'CHATBOT') {
      await sendAndTrackOutbound(
        customer,
        'CHATBOT',
        "🌐 Here's our website: https://transcosydney.com.au/",
        inboundMessage._id
      );
      return;
    }

    // Maintenance Mode (WhatsApp side): skip Flowise entirely and send
    // the same friendly pause notice to every automated conversation.
    // Checked AFTER the menu-tap shortcuts above (no point showing a
    // box-type menu just to immediately pause) but still before any
    // real AI reply. Never touches HUMAN-mode conversations. Checks
    // ONLY the WhatsApp flag — the website widget has its own,
    // independent flag checked in webChatRoutes.js.
    if (customer.mode === 'CHATBOT' && await isWhatsAppPausedOn()) {
      await sendAndTrackOutbound(
        customer,
        'CHATBOT',
        MAINTENANCE_MESSAGE,
        inboundMessage._id
      );
      return;
    }


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
// PAUSE STATE SETTING (read/write) — website and WhatsApp bots,
// independently
// ============================================================
// A single PATCH covers all of the console's "Pause Website"/"Pause
// WhatsApp"/"Stop All"/"Resume All" actions — each just sends whichever
// of the two flags it wants to change (Stop All sends both true,
// Resume All sends both false, the two per-channel toggles send one
// flag each). Whatever isn't included in the request body is left as
// it was.

app.get('/api/settings/pause-state', async (req, res) => {
  try {
    const websitePaused = await isWebsitePausedOn();
    const whatsappPaused = await isWhatsAppPausedOn();
    res.status(200).json({ websitePaused, whatsappPaused });
  } catch (err) {
    console.error('Error reading pause state:', err.message);
    res.status(500).json({ error: 'Failed to read pause state' });
  }
});

app.patch('/api/settings/pause-state', async (req, res) => {
  try {
    const { websitePaused, whatsappPaused } = req.body ?? {};

    if (websitePaused === undefined && whatsappPaused === undefined) {
      return res.status(400).json({ error: 'At least one of websitePaused/whatsappPaused is required' });
    }
    if (websitePaused !== undefined && typeof websitePaused !== 'boolean') {
      return res.status(400).json({ error: 'websitePaused must be a boolean' });
    }
    if (whatsappPaused !== undefined && typeof whatsappPaused !== 'boolean') {
      return res.status(400).json({ error: 'whatsappPaused must be a boolean' });
    }

    const update = {};
    if (websitePaused !== undefined) update.websitePaused = websitePaused;
    if (whatsappPaused !== undefined) update.whatsappPaused = whatsappPaused;

    await settings().updateOne(
      { _id: 'global' },
      { $set: update },
      { upsert: true }
    );

    const newWebsitePaused = await isWebsitePausedOn();
    const newWhatsappPaused = await isWhatsAppPausedOn();

    broadcast('settings.pause_state_changed', { websitePaused: newWebsitePaused, whatsappPaused: newWhatsappPaused });

    res.status(200).json({ websitePaused: newWebsitePaused, whatsappPaused: newWhatsappPaused });

  } catch (err) {
    console.error('Error updating pause state:', err.message);
    res.status(500).json({ error: 'Failed to update pause state' });
  }
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
      status: { $nin: ['cancelled', 'completed'] }
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
// UPDATE BOOKING STATUS
// ============================================================
//
// Lets staff mark a booking "completed" once the customer has actually
// dropped their boxes off, or move it back to "pending" if that was a
// mistake — without deleting the record (which is still available
// separately for genuine removals). Completed bookings are excluded
// from the daily cap count above (see /api/bookings/count) so a past
// visit never blocks a future week's slot.

app.patch('/api/bookings/:bookingId/status', async (req, res) => {

  try {

    const { bookingId } = req.params;
    const { status } = req.body || {};

    if (!ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        error: 'Invalid booking id'
      });
    }

    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status'
      });
    }

    const updated = await bookings().findOneAndUpdate(
      { _id: new ObjectId(bookingId) },
      { $set: { status } },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({
        error: 'Booking not found'
      });
    }

    broadcast('booking.status_changed', {
      _id: bookingId,
      status
    });

    res.status(200).json({
      success: true
    });

  } catch (err) {

    console.error(
      'Error updating booking status:',
      err.message
    );

    res.status(500).json({
      error: 'Failed to update booking status'
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
// CONTACT INFO (Contacts directory — email/notes, staff-entered)
// ============================================================
//
// email/notes aren't collected from any conversation automatically —
// nothing in the bot asks for or extracts them. This is purely staff
// filling in extra detail on a contact directly in the console, the
// same way you'd add a note to a contact card in any address book.

app.patch(
  '/api/customers/:customerId/contact-info',
  async (req, res) => {

    try {

      const { customerId } = req.params;
      const { email, notes } = req.body ?? {};

      if (!ObjectId.isValid(customerId)) {
        return res.status(400).json({ error: 'Invalid customer id' });
      }

      if (email !== undefined && typeof email !== 'string') {
        return res.status(400).json({ error: 'email must be a string' });
      }

      if (notes !== undefined && typeof notes !== 'string') {
        return res.status(400).json({ error: 'notes must be a string' });
      }

      const setFields = {};
      if (email !== undefined) setFields.email = email.trim();
      if (notes !== undefined) setFields.notes = notes.trim();

      if (Object.keys(setFields).length === 0) {
        return res.status(400).json({ error: 'email or notes is required' });
      }

      const updated = await customers().findOneAndUpdate(
        { _id: new ObjectId(customerId) },
        { $set: setFields },
        { returnDocument: 'after' }
      );

      if (!updated) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      broadcast('customer.contact_updated', {
        customerId: updated._id,
        customer: updated
      });

      res.status(200).json({ customer: updated });

    } catch (err) {

      console.error(
        'Error updating contact info:',
        err.message
      );

      res.status(500).json({
        error: 'Failed to update contact info'
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
  { id: 'menu_calendar', title: '🗓️ Shipment Calendar', phrase: 'What is your shipping schedule?' },
  { id: 'menu_track', title: '📦 Track My Shipment', phrase: 'I want to track my shipment' },
  { id: 'menu_declaration', title: '📋 Declaration Form', phrase: 'Send me the Declaration Form' },
  { id: 'menu_price', title: '💰 Get a Price Quote', phrase: "I'd like to get a price quote" },
  { id: 'menu_sea', title: '🚢 Sea Freight Info', phrase: 'Tell me about Sea Freight' },
  { id: 'menu_air', title: '✈️ Air Freight Info', phrase: 'Tell me about Air Freight' },
  { id: 'menu_staff', title: '👤 Talk to Our Team', phrase: "I'd like to talk to a staff member" },
  // Bypasses Flowise entirely — see the dedicated tap handler in the
  // webhook below (askWebsiteLink) — no phrase/AI round-trip needed
  // for something this simple and static.
  { id: 'menu_website', title: '🌐 Our Website', phrase: null }
];

// Same wording as the plain-text greeting (request_type=7 in the
// Flowise tool) minus the four-line feature list, which the tappable
// menu below now covers instead. The website link itself lives only
// in the menu now (see WELCOME_MENU_ITEMS' menu_website entry above),
// not duplicated here in the body text.
const WELCOME_BODY_TEXT =
  "👋 *Welcome to Transco Cargo Sydney!*\n\n" +
  "I'm your dedicated Transco Cargo agent, here to make shipping to Sri Lanka.\n\n" +
  "💬 Happy to chat in English, සිංහල, or தமிழ் — just write in whichever you're comfortable with.\n\n" +
  "🎉 *Current Promotion:* Send 2 boxes and get the 3rd one FREE! (Sea Freight only)\n\n" +
  "*How can I help you today?*";

// Generic native WhatsApp tappable list — shared by the welcome menu
// and the box-type menu below, rather than duplicating the WhatsApp
// API payload/call for each one.
async function sendWhatsAppInteractiveList(to, bizOpaqueCallbackData, {
  headerText = 'Transco Cargo Sydney',
  bodyText,
  footerText = 'We reply in English, Sinhala & Tamil',
  buttonLabel = 'Menu',
  sectionTitle = 'Quick Options',
  items
}) {

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: headerText },
      body: {
        text: bodyText
      },
      footer: { text: footerText },
      action: {
        button: buttonLabel,
        sections: [
          {
            title: sectionTitle,
            rows: items.map(({ id, title }) => ({ id, title }))
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
      outgoing._id.toString(),
      { bodyText: WELCOME_BODY_TEXT, items: WELCOME_MENU_ITEMS }
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

// Shown instead of routing through Flowise when "Get a Price Quote" is
// tapped on the welcome menu — asks for box type FIRST via another
// native tappable list, before quantity is ever asked. A tap here
// feeds a clear phrase into the same trusted Flowise pipeline any
// typed answer would (see the interactive-message handling in the
// webhook), so the classifier still asks for quantity/destination
// afterwards exactly as it does for a typed "Tea Chest" answer.
const BOX_TYPE_MENU_ITEMS = [
  { id: 'boxtype_gift', title: '🎁 Gift Box', phrase: "I'd like a price for a Gift Box" },
  { id: 'boxtype_tea', title: '📦 Tea Chest', phrase: "I'd like a price for a Tea Chest" },
  { id: 'boxtype_odd', title: '📐 Odd Size / Custom', phrase: "I have an oddly shaped or custom-sized item to ship" }
];

async function sendBoxTypeMenu(customer) {

  const bodyText = "📦 What type of box are you sending?";

  const summary =
    bodyText +
    "\n\n[Menu: " +
    BOX_TYPE_MENU_ITEMS.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Get a Price Quote',
        bodyText,
        buttonLabel: 'Select Box',
        sectionTitle: 'Box Types',
        items: BOX_TYPE_MENU_ITEMS
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Box type menu send failed:',
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

// Shown when Flowise's request_type=1 flow needs a box quantity — see
// the ASK_QUANTITY COMMAND handling below. WhatsApp list messages cap
// out at 10 rows total, so this can't just be "1" through "30" — the
// common case (under 10 boxes) gets one tap, and "10 or more" is
// special-cased in the webhook handler to prompt for a typed number
// instead of feeding a vague phrase back through Flowise.
const QUANTITY_MENU_ITEMS = [
  { id: 'qty_1', title: '1 box', phrase: '1 box' },
  { id: 'qty_2', title: '2 boxes', phrase: '2 boxes' },
  { id: 'qty_3', title: '3 boxes', phrase: '3 boxes' },
  { id: 'qty_4', title: '4 boxes', phrase: '4 boxes' },
  { id: 'qty_5', title: '5 boxes', phrase: '5 boxes' },
  { id: 'qty_6', title: '6 boxes', phrase: '6 boxes' },
  { id: 'qty_7', title: '7 boxes', phrase: '7 boxes' },
  { id: 'qty_8', title: '8 boxes', phrase: '8 boxes' },
  { id: 'qty_9', title: '9 boxes', phrase: '9 boxes' },
  { id: 'qty_10plus', title: '10 or more', phrase: null }
];

async function sendQuantityMenu(customer, bodyText) {

  const summary =
    bodyText +
    "\n\n[Menu: " +
    QUANTITY_MENU_ITEMS.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Get a Price Quote',
        bodyText,
        buttonLabel: 'Select Quantity',
        sectionTitle: 'How Many Boxes',
        items: QUANTITY_MENU_ITEMS
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Quantity menu send failed:',
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

// Shown after Flowise's Air Freight info reply (request_type=14, before
// weight/box type is known) — see the SHOW_AIR_MENU COMMAND handling
// below. Curated to the handful of things people actually ask right
// after reading Air Freight pricing, not every possible FAQ (WhatsApp
// caps a list at 10 rows, and past a few options it stops being quick
// to scan). Gift Box/Tea Chest feed straight into an instant quote at
// that box's minimum chargeable weight — Air Freight only prices those
// two box types (see AIR_MIN_WEIGHT_KG in the pricing tool), so Wine
// Box/Odd Size aren't offered here the way they are for Sea Freight.
const AIR_FREIGHT_MENU_ITEMS = [
  { id: 'air_gift', title: '🎁 Gift Box Quote', phrase: "I'd like an Air Freight quote for a Gift Box" },
  { id: 'air_tea', title: '📦 Tea Chest Quote', phrase: "I'd like an Air Freight quote for a Tea Chest" },
  { id: 'air_general', title: '⚖️ General Cargo', phrase: "I'd like an Air Freight quote for general cargo, priced by weight" },
  { id: 'air_banned', title: "🚫 What Can't I Send?", phrase: "What can't I send via Air Freight?" },
  { id: 'air_team', title: '👤 Talk to Our Team', phrase: "I'd like to talk to a staff member" }
];

async function sendAirFreightMenu(customer) {

  const bodyText = "✈️ What would you like to do next?";

  const summary =
    bodyText +
    "\n\n[Menu: " +
    AIR_FREIGHT_MENU_ITEMS.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Air Freight',
        bodyText,
        buttonLabel: 'Choose an Option',
        sectionTitle: 'Air Freight Options',
        items: AIR_FREIGHT_MENU_ITEMS
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Air freight menu send failed:',
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

// Shown after Flowise's plain Sea Freight info reply (request_type=29)
// — see the SHOW_SEA_MENU COMMAND handling below. NOT used for the
// Sea-vs-Air comparison (request_type=15) anymore — that one hasn't
// had the customer choose a side yet, so it gets its own combined
// menu instead (FREIGHT_MODE_MENU_ITEMS below). The box-type options
// here reuse the exact same phrases as
// BOX_TYPE_MENU_ITEMS so they feed into the identical, already-proven
// box-type -> quantity flow; the other two options are the most common
// side-questions right after reading Sea Freight info.
const SEA_FREIGHT_MENU_ITEMS = [
  { id: 'sea_gift', title: '🎁 Gift Box Quote', phrase: "I'd like a price for a Gift Box" },
  { id: 'sea_tea', title: '📦 Tea Chest Quote', phrase: "I'd like a price for a Tea Chest" },
  { id: 'sea_odd', title: '📐 Odd Size / Custom', phrase: "I have an oddly shaped or custom-sized item to ship" },
  { id: 'sea_schedule', title: '🗓️ Shipping Schedule', phrase: 'What is your shipping schedule?' },
  { id: 'sea_pickup', title: '🚚 Home Pickup Info', phrase: 'Can someone pick up my boxes from home?' },
  { id: 'sea_team', title: '👤 Talk to Our Team', phrase: "I'd like to talk to a staff member" }
];

async function sendSeaFreightMenu(customer) {

  const bodyText = "🚢 What would you like to do next?";

  const summary =
    bodyText +
    "\n\n[Menu: " +
    SEA_FREIGHT_MENU_ITEMS.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Sea Freight',
        bodyText,
        buttonLabel: 'Choose an Option',
        sectionTitle: 'Sea Freight Options',
        items: SEA_FREIGHT_MENU_ITEMS
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Sea freight menu send failed:',
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

// Shown after Flowise's Sea-vs-Air comparison reply (request_type=15)
// — see the SHOW_FREIGHT_MODE_MENU COMMAND handling below. The
// customer explicitly asked to compare the two and hasn't picked a
// side yet, so this is deliberately just the two modes themselves (not
// a jump straight to box type/weight like SEA_FREIGHT_MENU_ITEMS or
// AIR_FREIGHT_MENU_ITEMS do) — an earlier version offered 6 granular
// box-type-per-mode options here, which buried the actual Sea-or-Air
// decision the customer was trying to make under sub-choices they
// hadn't gotten to yet. Reuses the exact same phrases as the welcome
// menu's "Sea Freight Info"/"Air Freight Info" options (already
// proven), which land back on request_type=29/14 and show that mode's
// own box-type menu next.
const FREIGHT_MODE_MENU_ITEMS = [
  { id: 'mode_sea', title: '🚢 Sea Freight', phrase: 'Tell me about Sea Freight' },
  { id: 'mode_air', title: '✈️ Air Freight', phrase: 'Tell me about Air Freight' },
  { id: 'mode_team', title: '👤 Talk to Our Team', phrase: "I'd like to talk to a staff member" }
];

async function sendFreightModeMenu(customer) {

  const bodyText = "🚢✈️ Which would you like to go with?";

  const summary =
    bodyText +
    "\n\n[Menu: " +
    FREIGHT_MODE_MENU_ITEMS.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Sea vs Air',
        bodyText,
        buttonLabel: 'Choose an Option',
        sectionTitle: 'Freight Options',
        items: FREIGHT_MODE_MENU_ITEMS
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Freight mode menu send failed:',
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

// Two entirely different destinations (and pricing models) run through
// this one bot — shown whenever a generic "I want to send something"
// intent (request_type=16) doesn't already make it clear which one,
// so the reply that follows (promo video for Sri Lanka, or a plain
// intro for India) is actually the right one.
const COUNTRY_MENU_ITEMS = [
  { id: 'country_sri_lanka', title: '🇱🇰 Sri Lanka', phrase: "I'm shipping to Sri Lanka" },
  { id: 'country_india', title: '🇮🇳 India', phrase: "I'm shipping to India" }
];

async function sendCountryMenu(customer, bodyText) {

  const summary =
    bodyText +
    "\n\n[Menu: " +
    COUNTRY_MENU_ITEMS.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Which Country?',
        bodyText,
        buttonLabel: 'Choose an Option',
        sectionTitle: 'Destination',
        items: COUNTRY_MENU_ITEMS
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Country menu send failed:',
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

// Shown whenever the pricing tool needs to know pickup vs. delivery
// before it can quote a price (request_type=1's various box-type
// paths all ask this same question when $is_pickup and $delivery_tier
// are both unknown) — see the SHOW_PICKUP_DELIVERY_MENU COMMAND
// handling below. Door Delivery still needs a destination afterwards,
// same as if the customer had typed "door delivery" — this tap just
// saves them typing it out.
const PICKUP_DELIVERY_MENU_ITEMS = [
  { id: 'delivery_pickup', title: '🏭 Wattala Pickup', phrase: "I'd like to collect this from your Wattala warehouse myself" },
  { id: 'delivery_door', title: '🚚 Door Delivery', phrase: "I'd like door delivery" }
];

async function sendPickupDeliveryMenu(customer, bodyText) {

  const summary =
    bodyText +
    "\n\n[Menu: " +
    PICKUP_DELIVERY_MENU_ITEMS.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Pickup or Delivery',
        bodyText,
        buttonLabel: 'Choose an Option',
        sectionTitle: 'Collection Options',
        items: PICKUP_DELIVERY_MENU_ITEMS
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'Pickup/delivery menu send failed:',
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

// Same pattern as PICKUP_DELIVERY_MENU_ITEMS above, but for India
// orders — India's pickup point is our Seven Hills warehouse, not
// Wattala (that's Sri Lanka-only), so this needs its own wording
// rather than reusing the Sri Lanka menu.
const PICKUP_DELIVERY_MENU_ITEMS_INDIA = [
  { id: 'delivery_pickup_india', title: '🏭 Seven Hills Pickup', phrase: "I'd like to collect this from your Seven Hills warehouse myself" },
  { id: 'delivery_door_india', title: '🚚 Door Delivery', phrase: "I'd like door delivery" }
];

async function sendPickupDeliveryMenuIndia(customer, bodyText) {

  const summary =
    bodyText +
    "\n\n[Menu: " +
    PICKUP_DELIVERY_MENU_ITEMS_INDIA.map(item => item.title).join(' / ') +
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
      outgoing._id.toString(),
      {
        headerText: 'Pickup or Delivery',
        bodyText,
        buttonLabel: 'Choose an Option',
        sectionTitle: 'Collection Options',
        items: PICKUP_DELIVERY_MENU_ITEMS_INDIA
      }
    );

    outgoing.whatsappStatus = 'SENT';

  } catch (err) {
    console.error(
      'India pickup/delivery menu send failed:',
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
// WEBSITE CHAT WIDGET (transcosydney.com.au)
// ============================================================
// Fully additive — see webChatRoutes.js. Does not touch, call, or
// share state with anything on the WhatsApp path. Wired up down here
// (rather than right after the webhook routes above) because it needs
// the menu item arrays declared above — WELCOME_MENU_ITEMS through
// FREIGHT_MODE_MENU_ITEMS — passed straight through so the website
// widget can offer the exact same tappable options WhatsApp does,
// instead of silently dropping every menu marker as plain text.

// TEMPORARY: transco-widget-test.transcocargo.workers.dev added
// alongside the real site so the widget can be tested end-to-end (real
// replies, not just CORS-blocked ones) before it's pasted into
// Hostinger — see the throwaway Cloudflare Worker set up for this.
// Remove this second origin once Hostinger testing is done; the real
// site's origin below stays permanently.
const WEB_CHAT_ALLOWED_ORIGINS = [
  'https://transcosydney.com.au',
  'https://transco-widget-test.transcocargo.workers.dev'
];

app.use((req, res, next) => {
  if (req.path.startsWith('/api/web-chat')) {
    const origin = req.headers.origin;
    if (WEB_CHAT_ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
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
  MEDIA_BASE_URL,
  isWebsitePausedOn,
  MAINTENANCE_MESSAGE,
  WELCOME_MENU_ITEMS,
  BOX_TYPE_MENU_ITEMS,
  QUANTITY_MENU_ITEMS,
  AIR_FREIGHT_MENU_ITEMS,
  SEA_FREIGHT_MENU_ITEMS,
  FREIGHT_MODE_MENU_ITEMS,
  PICKUP_DELIVERY_MENU_ITEMS,
  PICKUP_DELIVERY_MENU_ITEMS_INDIA,
  COUNTRY_MENU_ITEMS
}));


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

  // Turns WhatsApp's raw error code into a plain-English reason staff
  // can actually act on, instead of just a red "failed" icon with no
  // explanation. Code 131047 is specifically the 24-hour messaging
  // window — by far the most common, and most confusing, failure
  // staff will hit when replying to a conversation that's gone quiet.
  let failureReason = null;

  if (status.status === 'failed' && status.errors?.length) {
    const firstError = status.errors[0];

    console.error(
      `WhatsApp delivery failed for ${status.recipient_id} (wamid ${status.id}):`,
      JSON.stringify(status.errors)
    );

    failureReason = firstError.code === 131047
      ? "This customer hasn't messaged in over 24 hours, so WhatsApp won't deliver a new message until they write in again."
      : (firstError.title || 'WhatsApp could not deliver this message.');
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


  const setFields = { whatsappStatus: mapped };
  if (failureReason) setFields.failureReason = failureReason;

  const updated =
    await messages().findOneAndUpdate(

      {
        _id:
          new ObjectId(
            correlationId
          )
      },

      {
        $set: setFields
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
        updated.whatsappStatus,
      failureReason:
        updated.failureReason ?? null
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