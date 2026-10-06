// ============================================================
// SHIPPING CALENDAR ANSWERS — schedule questions answered from the
// same dates the website shows (shippingSchedule, managed by staff in
// the console), never from the AI's own instructions — so the bot and
// the website can't disagree.
// ============================================================
//
// Used by both chat channels (WhatsApp in server.js, website chat in
// webChatRoutes.js) BEFORE a message would go to Flowise: a schedule
// question gets a reply built from the database; anything else returns
// null and carries on to the AI exactly as before. Questions about the
// customer's OWN shipment ("when will my boxes arrive?") are tracking,
// not the calendar, and are left alone.

const { shippingSchedule } = require('./db');

const COUNTRY_LABEL = {
  en: { sri_lanka: 'Sri Lanka', india: 'India' },
  si: { sri_lanka: 'ශ්‍රී ලංකාව', india: 'ඉන්දියාව' },
  ta: { sri_lanka: 'இலங்கை', india: 'இந்தியா' }
};
const LOCALE = { en: 'en-AU', si: 'si-LK', ta: 'ta-LK' };

const TEXT = {
  en: {
    title: c => `🗓️ *Shipping calendar — ${c}*`,
    next: d => `*Next cutoff: ${d}* (last day to hand your boxes over in Sydney)`,
    sea: d => `🚢 Sea freight arrives ≈ *${d}*`,
    air: d => `✈️ Air freight arrives ≈ *${d}*`,
    tbc: 'to be confirmed',
    later: '*Later cutoffs:*',
    footer: 'Arrival dates are estimates. Would you like to book a drop-off?',
    none: c => `🗓️ Our next ${c} shipping dates are being confirmed right now. Please check again soon — or ask me to get our team to confirm them for you.`
  },
  si: {
    title: c => `🗓️ *Shipping දින දර්ශනය — ${c}*`,
    next: d => `*ඊළඟ cutoff: ${d}* (Sydney වල පෙට්ටි භාර දෙන්න පුළුවන් අන්තිම දිනය)`,
    sea: d => `🚢 Sea freight එන දිනය ≈ *${d}*`,
    air: d => `✈️ Air freight එන දිනය ≈ *${d}*`,
    tbc: 'තවම තහවුරු කර නෑ',
    later: '*ඊට පස්සේ cutoffs:*',
    footer: 'එන දින ඇස්තමේන්තු පමණයි. Drop-off එකක් book කරන්න කැමතිද?',
    none: c => `🗓️ ${c} සඳහා ඊළඟ shipping දින දැන් තහවුරු කරමින් පවතී. ටිකකින් නැවත බලන්න — නැත්නම් අපේ කණ්ඩායමෙන් තහවුරු කරලා දෙන්න මට කියන්න.`
  },
  ta: {
    title: c => `🗓️ *Shipping நாட்காட்டி — ${c}*`,
    next: d => `*அடுத்த cutoff: ${d}* (Sydney இல் பெட்டிகளை ஒப்படைக்கக் கடைசி நாள்)`,
    sea: d => `🚢 Sea freight வந்தடையும் ≈ *${d}*`,
    air: d => `✈️ Air freight வந்தடையும் ≈ *${d}*`,
    tbc: 'இன்னும் உறுதிப்படுத்தப்படவில்லை',
    later: '*அடுத்த cutoffs:*',
    footer: 'வந்தடையும் தேதிகள் மதிப்பீடுகள் மட்டுமே. Drop-off ஒன்றை book செய்ய விரும்புகிறீர்களா?',
    none: c => `🗓️ ${c} க்கான அடுத்த shipping தேதிகள் தற்போது உறுதிப்படுத்தப்படுகின்றன. சிறிது நேரத்தில் மீண்டும் பாருங்கள் — அல்லது எங்கள் குழுவிடம் உறுதிப்படுத்தச் சொல்லுங்கள்.`
  }
};

// ---------- recognising the question ----------

const SCHEDULE_RE = [
  /\b(shipping|sailing|shipment|container|departure)\s+(schedule|calendar|dates?)\b/i,
  /\b(schedule|calendar)\b/i,
  /\bcut[\s-]?off\b/i,
  /\bnext\s+(shipment|sailing|container|ship|boat|flight|departure|air\s*freight|sea\s*freight)\b/i,
  /\bwhen\s+(is|does|do|will)\s+(the\s+)?(next|your)\s+(shipment|ship|container|sailing|boat|flight|air\s*freight|sea\s*freight)/i,
  /\blast\s+day\s+to\s+(drop|hand|send|bring)/i,
  /\bhand[\s-]?over\s+date/i,
  // Sinhala
  /කාලසටහන|දින\s*දර්ශනය|ඊළඟ.{0,25}(shipment|නැව|කන්ටේනර්|ගුවන්)/i,
  // Tamil
  /அட்டவணை|நாட்காட்டி|அடுத்த.{0,25}(shipment|கப்பல்|கண்டெய்னர்|விமான)/i
];

// About the customer's own boxes — that's tracking, not the calendar.
const OWN_SHIPMENT_RE = /\b(my|our)\s+(shipment|boxes?|parcels?|bl|booking|cargo)\b|\bBL\s*#?\s*\d|\btrack/i;

function isScheduleQuestion(text) {
  const t = String(text || '');
  if (!t.trim() || OWN_SHIPMENT_RE.test(t)) return false;
  return SCHEDULE_RE.some(re => re.test(t));
}

function languageOf(text) {
  if (/[඀-෿]/.test(text)) return 'si';
  if (/[஀-௿]/.test(text)) return 'ta';
  return 'en';
}

function countryInText(text) {
  const t = String(text || '');
  const lanka = /sri\s*lanka|\blanka\b|colombo|ශ්‍රී\s*ලංකා|ලංකා|இலங்கை|கொழும்பு/i.test(t);
  const india = /\bindia\b|chennai|ඉන්දියා|இந்தியா|சென்னை/i.test(t);
  if (lanka && !india) return 'sri_lanka';
  if (india && !lanka) return 'india';
  return null;
}

// ---------- building the answer ----------

module.exports = function createScheduleAnswerer({ getSydneyNow }) {
  function sydneyToday() {
    const now = getSydneyNow();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  }

  function fmt(iso, lang, withWeekday) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString(LOCALE[lang], {
      timeZone: 'UTC',
      ...(withWeekday ? { weekday: 'short' } : {}),
      day: 'numeric',
      month: 'short'
    });
  }

  function section(country, dates, lang) {
    const t = TEXT[lang];
    const label = COUNTRY_LABEL[lang][country];
    if (!dates.length) return { text: t.none(label), hasDates: false };
    const [first, ...rest] = dates;
    // India is sea freight only — no air line.
    const hasAir = country !== 'india';
    const lines = [
      t.title(label),
      '',
      t.next(fmt(first.cutoff, lang, true)),
      t.sea(first.seaArrival ? fmt(first.seaArrival, lang) : t.tbc)
    ];
    if (hasAir) lines.push(t.air(first.airArrival ? fmt(first.airArrival, lang) : t.tbc));
    if (first.note) lines.push(`📝 ${first.note}`);
    if (rest.length) {
      lines.push('', t.later);
      for (const d of rest.slice(0, 3)) {
        lines.push(
          `• ${fmt(d.cutoff, lang, true)} — 🚢 ${d.seaArrival ? fmt(d.seaArrival, lang) : t.tbc}` +
            (hasAir ? ` · ✈️ ${d.airArrival ? fmt(d.airArrival, lang) : t.tbc}` : '')
        );
      }
    }
    return { text: lines.join('\n'), hasDates: true };
  }

  /**
   * Returns the reply text for a schedule question, or null if the
   * message isn't one (it then goes to the AI as usual).
   * `country` is the best context we have (website page / earlier
   * choice); a country named in the message wins over it.
   */
  async function answerScheduleQuestion({ text, country = null }) {
    if (!isScheduleQuestion(text)) return null;
    const lang = languageOf(text);
    const wanted = countryInText(text) || (COUNTRY_LABEL.en[country] ? country : null);
    const countries = wanted ? [wanted] : ['sri_lanka', 'india'];
    const today = sydneyToday();

    const parts = [];
    for (const c of countries) {
      const dates = await shippingSchedule()
        .find({ country: c, cutoff: { $gte: today } })
        .sort({ cutoff: 1 })
        .limit(4)
        .toArray();
      parts.push(section(c, dates, lang));
    }
    // Only offer to book when there is at least one real date to book for.
    const anyDates = parts.some(p => p.hasDates);
    return parts.map(p => p.text).join('\n\n') + (anyDates ? `\n\n${TEXT[lang].footer}` : '');
  }

  return { answerScheduleQuestion };
};

module.exports.isScheduleQuestion = isScheduleQuestion;
module.exports.countryInText = countryInText;
module.exports.languageOf = languageOf;
