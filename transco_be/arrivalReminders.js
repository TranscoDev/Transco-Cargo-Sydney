// "Your goods arrive in about a week" — a My Transco reminder for each BL
// collected from our Wattala warehouse, about 7 days before PEBL's
// estimated arrival date in Sri Lanka. The customer then books a date and
// time with the Wattala warehouse themselves (their contact details are in
// the message) — we don't book it.
//
// Once a day per BL: look it up on PEBL (lookupPebl), keep the estimated
// arrival date on the shipment (peblEta), and when it is 0–7 days away send
// the reminder once (arrivalReminder). If PEBL then moves the date later by
// 3+ days, one short update follows. Only My Transco accounts get it (a
// message in their My Transco chat, which also sends the phone
// notification); door deliveries and other countries are skipped.

const { shipments, bookings, customers } = require('./db');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RECHECK_AFTER_MS = 20 * 60 * 60 * 1000;
const REMIND_DAYS = 7;
const MOVED_DAYS = 3;
const DONE_STATUSES = ['booked', 'delivered'];

const WAREHOUSE =
  '🏢 Colombo (Wattala) Warehouse\n' +
  '📍 176/2 Alwis Town, Hendala, Wattala, Sri Lanka\n' +
  '🗺️ https://share.google/nrNXsTdOG7CJSatZg\n' +
  '📞 070 644 0604 / 070 644 0601 / 011 298 1910\n' +
  '📞 Hotline: +94 70 644 0330';

const TEXT = {
  en: {
    remind: (bl, day) => `${TEXT.en.short(bl, day)}\n\n⚠️ Please wait until they have arrived. On or after ${day}, contact our Wattala warehouse to book a date and time to collect them:\n\n${WAREHOUSE}`,
    short: (bl, day) => `📦 Your goods (BL ${bl}) are expected to arrive in Sri Lanka in about a week — around ${day}.`,
    moved: (bl, day) => `📦 Update: the arrival date of your goods (BL ${bl}) in Sri Lanka has changed to around ${day}.\n\nPlease contact our Wattala warehouse only after that date to book your collection:\n\n${WAREHOUSE}`
  },
  si: {
    remind: (bl, day) => `${TEXT.si.short(bl, day)}\n\n⚠️ කරුණාකර භාණ්ඩ පැමිණෙන තුරු රැඳී සිටින්න. ${day} දින හෝ ඉන් පසුව, ඒවා ලබා ගැනීමට දිනයක් සහ වේලාවක් වෙන් කරගැනීමට අපගේ වත්තල ගබඩාව අමතන්න:\n\n${WAREHOUSE}`,
    short: (bl, day) => `📦 ඔබේ භාණ්ඩ (BL ${bl}) තව සතියකින් පමණ — ${day} දින පමණ — ශ්‍රී ලංකාවට පැමිණීමට නියමිතයි.`,
    moved: (bl, day) => `📦 යාවත්කාලීන කිරීම: ඔබේ භාණ්ඩ (BL ${bl}) ශ්‍රී ලංකාවට පැමිණෙන දිනය ${day} දින පමණ දක්වා වෙනස් වී ඇත.\n\nභාණ්ඩ ලබා ගැනීමට වෙන් කරගැනීමට, කරුණාකර එම දිනයෙන් පසුව පමණක් අපගේ වත්තල ගබඩාව අමතන්න:\n\n${WAREHOUSE}`
  },
  ta: {
    remind: (bl, day) => `${TEXT.ta.short(bl, day)}\n\n⚠️ பொருட்கள் வந்து சேரும் வரை காத்திருக்கவும். ${day} அன்று அல்லது அதற்குப் பின்னர், அவற்றைப் பெற்றுக்கொள்ள ஒரு திகதியும் நேரமும் முன்பதிவு செய்ய எங்கள் வத்தளை களஞ்சியசாலையைத் தொடர்பு கொள்ளுங்கள்:\n\n${WAREHOUSE}`,
    short: (bl, day) => `📦 உங்கள் பொருட்கள் (BL ${bl}) சுமார் ஒரு வாரத்தில் — ${day} அளவில் — இலங்கைக்கு வந்து சேரும் என எதிர்பார்க்கப்படுகிறது.`,
    moved: (bl, day) => `📦 புதுப்பிப்பு: உங்கள் பொருட்கள் (BL ${bl}) இலங்கைக்கு வந்து சேரும் திகதி ${day} அளவுக்கு மாறியுள்ளது.\n\nபொருட்களைப் பெற முன்பதிவு செய்ய, அந்தத் திகதிக்குப் பின்னரே எங்கள் வத்தளை களஞ்சியசாலையைத் தொடர்பு கொள்ளுங்கள்:\n\n${WAREHOUSE}`
  }
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');

// PEBL's date ("12 Nov 2026", "2026-11-12" or "12/11/2026") → "2026-11-12".
function parsePeblDate(raw) {
  const s = String(raw || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

const sydneyToday = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const dayNumber = (ymd) => { const [y, mo, d] = ymd.split('-').map(Number); return Date.UTC(y, mo - 1, d) / 86400000; };
const showDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function createArrivalReminders({ lookupPebl, sendToMyTransco }) {
  let running = false;

  async function isCollection(s) {
    if (s.doorDeliveryDestination) return false;
    if (!s.bookingId) return true;
    const b = await bookings().findOne({ _id: s.bookingId }, { projection: { deliveryType: 1, country: 1 } });
    if (!b) return true;
    return b.deliveryType !== 'door' && (!b.country || b.country === 'sri_lanka');
  }

  async function runOnce(now = new Date()) {
    if (running) return { skipped: 'already running' };
    running = true;
    const result = { checked: 0, reminded: 0, updated: 0 };
    try {
      const today = sydneyToday(now);
      const list = await shipments().find({
        hblNumber: { $exists: true, $ne: '' },
        customerId: { $ne: null },
        status: { $nin: DONE_STATUSES },
        'arrivalReminder.updatedAt': { $exists: false }
      }).toArray();

      for (const s of list) {
        if (s.peblEta && s.peblEta.checkedAt && now - new Date(s.peblEta.checkedAt) < RECHECK_AFTER_MS) continue;
        const account = await customers().findOne({ _id: s.customerId });
        if (!account || (!account.passwordHash && !account.portalJoinedAt)) continue;
        if (account.status === 'DO_NOT_CONTACT' || account.status === 'BLOCKED') continue;
        if (!(await isCollection(s))) continue;

        result.checked += 1;
        const { found, pebl } = await lookupPebl(s.hblNumber);
        const eta = found && pebl ? parsePeblDate(pebl.estimatedArrivalDate) : null;
        const toSriLanka = !pebl || !pebl.portOfDischarge || /colombo|sri\s*lanka/i.test(pebl.portOfDischarge);
        await shipments().updateOne({ _id: s._id }, { $set: { peblEta: { date: eta, checkedAt: now } } });
        if (!eta || !toSriLanka) continue;

        const daysLeft = dayNumber(eta) - dayNumber(today);
        const text = TEXT[account.preferredLanguage] || TEXT.en;
        const r = s.arrivalReminder;
        if (!r && daysLeft >= 0 && daysLeft <= REMIND_DAYS) {
          await sendToMyTransco(account, text.remind(s.hblNumber, showDay(eta)));
          await shipments().updateOne({ _id: s._id }, { $set: { arrivalReminder: { eta, sentAt: now } } });
          result.reminded += 1;
        } else if (r && daysLeft >= 0 && dayNumber(eta) - dayNumber(r.eta) >= MOVED_DAYS) {
          await sendToMyTransco(account, text.moved(s.hblNumber, showDay(eta)));
          await shipments().updateOne({ _id: s._id }, { $set: { 'arrivalReminder.updatedEta': eta, 'arrivalReminder.updatedAt': now } });
          result.updated += 1;
        }
      }
    } finally {
      running = false;
    }
    if (result.reminded || result.updated) console.log('[arrival] reminders sent', result);
    return result;
  }

  function start() {
    const run = () => runOnce().catch(err => console.error('[arrival] reminder run failed:', err.message));
    setTimeout(() => { run(); setInterval(run, CHECK_EVERY_MS).unref(); }, 5 * 60 * 1000).unref();
  }

  return { runOnce, start };
}

// For My Transco's BL cards: the reminder's arrival date while it's still
// ahead (today counts), else null — { date: "2026-01-11", label: "Mon, 11 Jan" }.
function arrivingSoon(shipment, now = new Date()) {
  const r = shipment && shipment.arrivalReminder;
  const eta = r && (r.updatedEta || r.eta);
  if (!eta || dayNumber(eta) < dayNumber(sydneyToday(now))) return null;
  return { date: eta, label: showDay(eta) };
}

module.exports = { createArrivalReminders, parsePeblDate, arrivingSoon };
