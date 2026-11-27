// Short greetings and quick buttons on bot answers (WhatsApp + website).
//
// - A NEW customer who only says "Hi" still gets the full welcome menu.
// - A NEW customer whose first message is a question gets one short
//   welcome line on top of the answer (SHORT_WELCOME), nothing more.
// - A REGULAR customer (chatted before, signed in, or has a booking/BL)
//   gets no welcome; a bare "Hi" from them gets "Hi [name] 👋, how can I
//   help?" (shortHi).
// - Every bot answer ends with 📝 Book and ☰ Menu, plus one button that
//   fits the question when one does (pickFitButton).

const { hasRealName } = require('./customerTools');
const agentKnowledge = require('./agentKnowledge');

const SITE_URL = (process.env.PORTAL_SITE_URL || 'https://my.transcosydney.com.au').replace(/\/$/, '');
const BOOK_URL = SITE_URL + '/account.html#/book';

const SHORT_WELCOME = '👋 *Welcome to Transco Cargo Sydney!*';

// The whole message is just a greeting (any punctuation/emoji ignored).
const GREETING_RE = /^(hi+|hey+|hello+|helo|hallo|hai|hii+ya|good (morning|afternoon|evening|day)|g'?day|ayubowan|ආයුබෝවන්|හායි|හෙලෝ|හලෝ|vanakkam|வணக்கம்|namaste)( (there|all|team|transco|sir|madam|miss|ji))?$/u;

function isGreetingOnly(text) {
  const s = String(text || '').toLowerCase()
    .replace(/[^\p{L}\p{M}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Boolean(s) && GREETING_RE.test(s);
}

// The one extra button that fits the customer's question, or null.
// First match wins, so the more specific kinds come first.
const FIT_RULES = [
  ['track', /\btrack|\bbl\b|\b\d{6}\b|where('?s| is) my|status of my|my (box|boxes|shipment|cargo|parcel) (arrived|reached)/i],
  ['calendar', /schedule|cut ?-?off|next (ship|shipment|container|vessel|sailing)|shipping dates?|calendar|\beta\b|when (does|will|is) (the )?(next )?(ship|container|shipment)/i],
  ['prices', /price|cost|how much|\brates?\b|charge|\bfees?\b|\$|quote/i],
  ['directions', /address|location|directions?|where (are|r) (you|u)|where is (your|the) (warehouse|office|place)|drop ?-?off|\bbring\b|come (to|in|over)|opening|open (on|today|tomorrow)|what time|\bhours\b|saturday|sunday|weekend|warehouse/i]
];

function pickFitButton(question) {
  const q = String(question || '');
  const hit = FIT_RULES.find(([, re]) => re.test(q));
  return hit ? hit[0] : null;
}

// "Hi Nimal 👋, how can I help?" — no name on file → "Hi 👋, how can I help?"
function shortHi(customer, account) {
  const who = account && hasRealName(account) ? account : customer;
  const first = who && hasRealName(who) ? String(who.name).trim().split(/\s+/)[0] : '';
  return first ? `Hi ${first} 👋, how can I help?` : 'Hi 👋, how can I help?';
}

// Staff-editable warehouse map link (console → Agent Transco).
async function warehouseMapLink() {
  try {
    const doc = await agentKnowledge.current();
    const saved = doc.details && doc.details.warehouse_map;
    if (typeof saved === 'string' && saved.trim()) return saved.trim();
  } catch (err) {
    console.error('Warehouse map link lookup failed:', err.message);
  }
  return agentKnowledge.DETAILS.find(d => d.key === 'warehouse_map').default;
}

// WhatsApp "📍 Directions" tap: the warehouse address + map link.
async function directionsText() {
  let address = agentKnowledge.DETAILS.find(d => d.key === 'warehouse_address').default;
  try {
    const doc = await agentKnowledge.current();
    const saved = doc.details && doc.details.warehouse_address;
    if (typeof saved === 'string' && saved.trim()) address = saved.trim();
  } catch (err) {
    console.error('Warehouse address lookup failed:', err.message);
  }
  return `📍 Our Sydney warehouse:\n${address}\n\n🗺️ Directions: ${await warehouseMapLink()}`;
}

// Website chat: links the chat window turns into buttons (chat-links.js).
// Book always; the fitting one first. Calendar has no page of its own, so
// it adds nothing extra here. Links already in the answer aren't repeated.
async function websiteLinks(question, answer) {
  const text = String(answer || '');
  const lines = [];
  const fit = pickFitButton(question);
  if (fit === 'directions') {
    const map = await warehouseMapLink();
    if (!text.includes(map)) lines.push(map);
  } else if (fit === 'prices' && !/box-info/.test(text)) {
    lines.push(SITE_URL + '/box-info.html');
  } else if (fit === 'track' && !/account(\.html)?#\/(shipments|track)/.test(text)) {
    lines.push(SITE_URL + '/account.html#/shipments');
  }
  if (!/#\/book/.test(text)) lines.push(BOOK_URL);
  return lines.join('\n');
}

// WhatsApp reply buttons (max 3, titles max 20 characters). Ids are
// handled by the webhook in server.js (QUICK_BUTTON_IDS).
const WA_FIT_BUTTONS = {
  directions: { id: 'qb_directions', title: '📍 Directions' },
  prices: { id: 'qb_prices', title: '💰 Prices' },
  track: { id: 'qb_track', title: '📦 Track' },
  calendar: { id: 'qb_calendar', title: '🗓️ Shipping dates' }
};
const WA_BOOK_BUTTON = { id: 'qb_book', title: '📝 Book' };
const WA_MENU_BUTTON = { id: 'qb_menu', title: '☰ Menu' };

function whatsappButtons(question) {
  const fit = WA_FIT_BUTTONS[pickFitButton(question)];
  return [fit, WA_BOOK_BUTTON, WA_MENU_BUTTON].filter(Boolean);
}

module.exports = {
  SITE_URL,
  BOOK_URL,
  SHORT_WELCOME,
  isGreetingOnly,
  pickFitButton,
  shortHi,
  warehouseMapLink,
  directionsText,
  websiteLinks,
  whatsappButtons
};
