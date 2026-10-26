// Agent-style answers: replies written like a staff member's, from ONE
// fact pack built from the console pages — Prices & Promotions, the
// Agent Transco knowledge page and the shipping calendar — never from
// the model's own memory.
//
// Used for the questions Flowise passes on with [[KNOWLEDGE]] (general,
// mixed or price questions) and for photos (Gemini can see them).
//
// Safety:
// - Every $ amount and date in the reply must appear in the fact pack
//   (or be a listed price times a quantity); otherwise the question goes
//   to staff instead.
// - Anything the facts don't cover: the known part is answered and the
//   rest is passed to staff ([[HANDOFF]] at the start = staff are flagged
//   but the customer still gets the useful part).
// - Returns null when no AI is available or every call fails, so the
//   caller keeps its old behaviour.

const axios = require('axios');
const { messages, shippingSchedule } = require('./db');
const prices = require('./prices');
const knowledge = require('./agentKnowledge');
const SLCities = require('./slCities');
const { hasRealName } = require('./customerTools');

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Same figures as the website's box page (box-info.html) and the Flowise
// calculator's box info.
const BOXES = [
  { key: 'wine_box', name: 'Wine Box', dims: '20 x 23 x 20 cm', kg: 20 },
  { key: 'gift_box', name: 'Gift Box', dims: '41 x 44 x 32 cm', kg: 20 },
  { key: 'tea_chest', name: 'Tea Chest', dims: '42 x 44 x 63 cm', kg: 30 },
  { key: 'quarter_cbm', name: 'Quarter CBM', dims: '83 x 50 x 52 cm', kg: 50 }
];

// Air freight is billed at 12kg minimum (charged as a Gift Box), 23kg for
// 12–23kg (charged as a Tea Chest), then by the kg up to 30kg per box —
// the Flowise calculator's rule.
const AIR_TIERS = [12, 23];
const AIR_MAX_KG = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const money = n => '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
const round2 = n => Math.round(n * 100) / 100;

function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

function languageOf(text) {
  if (/[඀-෿]/.test(text)) return 'si';
  if (/[஀-௿]/.test(text)) return 'ta';
  return 'en';
}

// ---------- the fact pack ----------

async function nextDates(country) {
  const list = await shippingSchedule()
    .find({ country, cutoff: { $gte: sydneyToday() } })
    .sort({ cutoff: 1 })
    .limit(2)
    .toArray();
  return list.map(d => {
    const parts = [`cut-off ${fmtDate(d.cutoff)}`];
    parts.push(`sea arrival about ${d.seaArrival ? fmtDate(d.seaArrival) : 'to be confirmed'}`);
    if (country !== 'india') parts.push(`air arrival about ${d.airArrival ? fmtDate(d.airArrival) : 'to be confirmed'}`);
    return '- ' + parts.join(', ') + (d.note ? ` (${d.note})` : '');
  });
}

async function buildFacts() {
  const [priceDoc, k, slDates, inDates] = await Promise.all([
    prices.current(),
    knowledge.botKnowledge(),
    nextDates('sri_lanka'),
    nextDates('india')
  ]);
  const { values: v, promotions } = prices.botShape(priceDoc);
  const freeThird = promotions.some(p => p.type === 'free_third');
  const lines = [];
  // Correct amounts the bot may work out but that aren't listed (e.g. a
  // 26kg air box) — allowed by the reply check.
  const extraAmounts = [];

  lines.push('# SEA FREIGHT TO SRI LANKA (AUD, per box, collect from our Wattala warehouse)');
  for (const b of BOXES) lines.push(`- ${b.name} (${b.dims}, max ${b.kg}kg): ${money(v[b.key])}`);
  lines.push(`- Bicycle: ${money(v.bicycle)}`);
  lines.push(`- Odd-size / non-standard items (e.g. wheels, furniture, machines): ${money(v.cbm)} per CBM (length x width x height in metres). The final CBM is measured at our warehouse. Collected from our Wattala warehouse only (no door delivery).`);
  lines.push('- TVs (collect from our Wattala warehouse only, no door delivery): ' +
    [['tv_35', 'up to 35"'], ['tv_45', '36"-45"'], ['tv_55', '46"-55"'], ['tv_65', '60"-65"'], ['tv_75', '66"-75"']]
      .map(([key, label]) => `${label} ${money(v[key])}`).join(', '));

  lines.push('', '# DOOR DELIVERY IN SRI LANKA (added to the sea freight, per order; every box counts)');
  for (const z of [1, 2, 3]) {
    lines.push(`- Zone ${z} (${SLCities.ZONE_LABEL[z]}): first box ${money(v[`z${z}_first`])}, each extra box ${money(v[`z${z}_extra`])}`);
  }
  lines.push('- Wattala itself is our warehouse: collect there, no delivery charge.');
  const byZone = { 1: [], 2: [], 3: [] };
  for (const [town, zone] of Object.entries(SLCities.ZONES)) if (byZone[zone]) byZone[zone].push(town);
  for (const z of [1, 2, 3]) lines.push(`Zone ${z} towns: ${byZone[z].join(', ')}`);
  lines.push('A town not listed: ask the customer for the nearest main town, or let the team confirm the zone.');

  lines.push('', '# READY TOTALS, SEA FREIGHT TO SRI LANKA (freight + door delivery, promotions applied)');
  for (const b of BOXES) {
    for (let qty = 1; qty <= 3; qty++) {
      const free = b.key === 'tea_chest' && freeThird ? Math.floor(qty / 3) : 0;
      const freight = (qty - free) * v[b.key];
      const zones = [1, 2, 3].map(z => `Zone ${z} ${money(freight + v[`z${z}_first`] + (qty - 1) * v[`z${z}_extra`])}`);
      lines.push(`- ${qty} x ${b.name}: Wattala pickup ${money(freight)}, ${zones.join(', ')}` + (free ? ' (3rd Tea Chest free)' : ''));
    }
  }

  lines.push('', '# AIR FREIGHT TO SRI LANKA (per box, max 30kg per box)');
  lines.push(`- ${money(v.air_per_kg)} per kg + ${money(v.air_doc_fee)} documentation fee per box + ${money(v.air_transport)} Local transport per box.`);
  const airBox = kg => round2(kg * v.air_per_kg + v.air_doc_fee + v.air_transport);
  lines.push(`- Price per box by weight: 12kg or less = ${money(airBox(AIR_TIERS[0]))} (charged as a Gift Box); over 12kg up to 23kg = ${money(airBox(AIR_TIERS[1]))} (charged as a Tea Chest); over 23kg up to 30kg = ${money(v.air_per_kg)} per kg + the two fees (${money(airBox(AIR_TIERS[1]))} + ${money(v.air_per_kg)} for each kg above 23kg).`);
  lines.push('- When the customer gives a weight, quote ONLY that box\'s price (work it out with the rule above). When no weight is given, give the 12kg and 23kg prices and the per-kg rule, and ask the weight. Never list a price for every weight.');
  for (let kg = AIR_TIERS[1] + 1; kg <= AIR_MAX_KG; kg++) extraAmounts.push(airBox(kg));
  lines.push(`- Lithium battery surcharge: ${money(v.air_lithium)}. Documents only: first kg ${money(v.doc_first_kg)}, each extra kg ${money(v.doc_extra_kg)}.`);
  lines.push('- Included: door delivery anywhere in Sri Lanka and Sri Lanka customs clearance handling. Not included: government duty/tax, if it applies (paid by the customer directly).');
  lines.push('- Weekly air courier; usually arrives 10-14 days after the Sydney cut-off, depending on flights.');

  lines.push('', '# INDIA (sea freight only, flat rates)');
  lines.push(`- General box: 1 box ${money(v.in_general_1)}, 2 boxes ${money(v.in_general_2)}, 3 boxes ${money(v.in_general_3)}`);
  lines.push(`- Tea Chest: 1 ${money(v.in_tea_1)}, 2 ${money(v.in_tea_2)}, 3 ${money(v.in_tea_3)}`);
  lines.push(`- Quarter CBM: 1 ${money(v.in_quarter_1)}, 2 ${money(v.in_quarter_2)}, 3 ${money(v.in_quarter_3)}`);

  lines.push('', '# PROMOTIONS RUNNING TODAY');
  if (promotions.length) for (const p of promotions) lines.push(`- ${p.name}: ${p.message && p.message.en ? p.message.en : ''}`);
  else lines.push('- None.');

  lines.push('', '# NEXT SHIPPING DATES (from the shipping calendar)');
  lines.push('Sri Lanka:', ...(slDates.length ? slDates : ['- No dates published yet; the team will confirm.']));
  lines.push('India:', ...(inDates.length ? inDates : ['- No dates published yet; the team will confirm.']));

  lines.push('', '# CONTACTS & ADDRESSES');
  const d = k.details;
  lines.push(`- Sydney warehouse (drop-off): ${d.warehouse_address} (map: ${d.warehouse_map})`);
  lines.push(`- Office: ${d.office_phone}. Pickups & appointments: ${d.pickup_name} ${d.pickup_phone}. Insurance: ${d.insurance_name} ${d.insurance_phone}. Melbourne head office / India: ${d.head_office_phone}`);
  lines.push(`- Colombo (Wattala) warehouse: ${d.colombo_address}; phones ${d.colombo_phone_1}, ${d.colombo_phone_2}, ${d.colombo_phone_3}; hotline after arrival ${d.colombo_hotline}`);
  lines.push(`- Tracking website: ${d.tracking_link}`);

  for (const s of k.sections) lines.push('', `# ${s.title.toUpperCase()}`, s.text);

  return { text: lines.join('\n'), extraAmounts };
}

// ---------- checking the reply ----------

// Every number written in the facts, plus each listed price times 1–10
// (e.g. "2 Tea Chests = $150").
function allowedAmounts(facts, extra = []) {
  const set = new Set(extra.map(round2));
  const nums = (facts.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.replace(/,/g, ''))).filter(n => isFinite(n));
  for (const n of nums) set.add(round2(n));
  const unit = (facts.match(/\$\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.slice(1).replace(/,/g, '')));
  for (const n of unit) for (let q = 2; q <= 10; q++) set.add(round2(n * q));
  return set;
}

const MONTH_RE = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
function datesIn(text) {
  const out = [];
  const t = String(text);
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}`, 'gi'))) out.push(`${Number(m[1])} ${m[2].slice(0, 3).toLowerCase()}`);
  for (const m of t.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})\\b`, 'gi'))) out.push(`${Number(m[2])} ${m[1].slice(0, 3).toLowerCase()}`);
  return out;
}

// Returns null when fine, or what's wrong.
function checkReply(reply, facts, extraAmounts = []) {
  const amounts = allowedAmounts(facts, extraAmounts);
  for (const m of reply.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)) {
    const n = round2(Number(m[1].replace(/,/g, '')));
    if (!amounts.has(n)) return `amount $${m[1]} is not in the facts`;
  }
  const known = new Set(datesIn(facts));
  for (const day of datesIn(reply)) if (!known.has(day)) return `date "${day}" is not in the facts`;
  return null;
}

// ---------- writing the reply ----------

const RULES = `You are Agent Transco, a friendly staff member at Transco Cargo Sydney (sending personal effects from Sydney to Sri Lanka and India). You reply on WhatsApp / website chat.

HOW TO ANSWER
- Answer exactly what the customer asked, using ONLY the FACTS below. Short and clear, like a helpful person, not a brochure.
- Add something they did not ask ONLY when it is a rule that changes their decision: e.g. "collect from Wattala only, no door delivery", "taxable in Sri Lanka", "not allowed by air", "final CBM is measured at our warehouse", or a promotion that applies to what they are sending.
- Do NOT add cut-off dates, drop-off hours, addresses or promotions unless they asked, or they say they want to send now / ask how to proceed.
- End with at most ONE short question, only when you need it to give an exact answer (e.g. "Where in Sri Lanka is it going?"). For odd-size items you may ask a short numbered list of what you need (size / dimensions, etc.).
- Prices: only quote amounts that are written in the FACTS (use READY TOTALS for totals). If they need a total that isn't there, give the unit prices instead. Never invent a price, fee, date, weight, duty amount, phone number or rule.
- Customs duty/tax: say whether the goods are taxable if the FACTS say so, but NEVER give a duty amount; say Sri Lanka Customs assesses it and our team can advise.
- If part of the question is not answered by the FACTS: answer the parts you can, then say plainly that our team will confirm that part and get back to them here, and put [[HANDOFF]] on the last line. If nothing at all can be answered, reply with exactly [[HANDOFF]].
- If the customer is upset, complaining, or asks for a person, reply with a short kind line and [[HANDOFF]] on the last line.
- Home pickup: say yes, we can organise it, and ask in a numbered list: 1. how many boxes they're planning to send, 2. which suburb they live in, 3. whether it's a house or an apartment. Never quote a pickup fee. When they have answered (check the conversation so far), thank them, say Sajith from our team will contact them to confirm the pickup day and the fee, and put [[HANDOFF]] on the last line.
- If a photo is attached, say briefly what you see only if it helps (e.g. "the wheels with tyres in your photo"). If you can't tell what it is, ask.
- Use the conversation so far for context; never repeat what was already said, never greet twice in the same conversation.

STYLE
- Same language and script as the customer (English, Sinhala or Tamil). Prices stay as $ numbers.
- Greet only on the first reply of a conversation: "Hi <first name>, thanks for your message!" (use the name only if given below; otherwise "Hi, thanks for your message!").
- Plain text for WhatsApp: no Markdown, no ** or #. Use "• " for list items. Copy dates exactly as written in the FACTS (e.g. "Sat 7 Nov").
- Usually 2-8 short lines. Write naturally — never copy headings or labels from the FACTS (e.g. "READY TOTALS", "Ready prices").
- When you need sizes, ask in cm (length x width x height); we work out the CBM.

EXAMPLES OF GOOD ANSWERS (style only — prices and dates must come from the FACTS)
Customer: Hi, how much do you charge to send a tea chest box to Sri Lanka?
Agent: Hi Solanie, thanks for your message! A Tea Chest (max 30kg, 42 x 44 x 63 cm) by sea freight:
• Collect from our Wattala warehouse: $75
• Door delivery: $125 / $145 / $155 depending on distance from Colombo
🎉 Send 2 Tea Chests, get the 3rd free (same receiver).
Where in Sri Lanka is it going? Then I can confirm the exact price.

Customer: Do you come to pick up the tea chest box from home? What are your charges?
Agent: Hi Solanie, sure, we can organise this for you.
To get started, could you please let me know:
1. How many boxes you're planning to send
2. Which suburb you live in
3. Whether it's a house or an apartment
Thank you!

Customer: [photo of 4 alloy wheels with tyres] Can I send these 4 alloy wheels with tyres to Sri Lanka? Freight cost and rough customs tax?
Agent: Hi Shavinu, thanks for the photo! Yes, we can ship alloy wheels with tyres by sea freight.
• Freight: charged by volume at $550 per CBM (final CBM is measured at our warehouse)
• Collected from our Wattala warehouse only (no door delivery)
• Customs: vehicle spare parts are taxable in Sri Lanka. Sri Lanka Customs assesses the duty, and our team can advise what to expect.
For an exact price, could you send me:
1. The tyre size on the sidewall (e.g. 195/65 R15)
2. Are the wheels used or new?

Customer: I just want the price for air freight. I don't have a passport or NIC, I'm an Australian citizen. How can I proceed?
Agent: Hi Pearline, thanks for your message! Air freight is priced by the weight of each box, not ID:
• Up to 12kg: $250
• Over 12kg up to 23kg: $415
• Over 23kg (max 30kg): $15 more for each extra kg
This includes door delivery anywhere in Sri Lanka. How much will your box weigh?
About the declaration: our team will confirm what you can use instead of a passport/NIC and get back to you here.
[[HANDOFF]]`;

async function conversationSoFar(customerId) {
  if (!customerId) return '';
  try {
    const list = await messages()
      .find({ customerId }, { projection: { senderType: 1, content: 1 } })
      .sort({ _id: -1 })
      .limit(9)
      .toArray();
    // The newest one is the message being answered now.
    if (list.length && list[0].senderType === 'CUSTOMER') list.shift();
    return list.reverse()
      .map(m => `${m.senderType === 'CUSTOMER' ? 'Customer' : 'Transco'}: ${String(m.content || '').slice(0, 600)}`)
      .join('\n');
  } catch (err) {
    console.error('Agent answer: could not read the conversation:', err.message);
    return '';
  }
}

async function callGemini(system, ask, image) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } });
  parts.push({ text: ask });
  const r = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2500 }
    },
    { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, timeout: 30000 }
  );
  return (r.data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

async function callGroq(model, system, ask) {
  const r = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model, temperature: 0.2, max_tokens: 2500, reasoning_effort: 'low', include_reasoning: false,
      messages: [{ role: 'system', content: system }, { role: 'user', content: ask }]
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 25000 }
  );
  return r.data?.choices?.[0]?.message?.content || '';
}

const HANDOFF_TEXT = {
  en: "👍 Thanks for your question! I've passed it to our team and they'll get back to you shortly.",
  si: "👍 ඔබේ ප්‍රශ්නයට ස්තූතියි! අපි මේක අපේ team එකට යැව්වා — ඔවුන් ඉක්මනින් ඔබට පිළිතුරු දෙයි.",
  ta: "👍 உங்கள் கேள்விக்கு நன்றி! இதை எங்கள் team இடம் அனுப்பியுள்ளோம் — அவர்கள் விரைவில் உங்களைத் தொடர்புகொள்வார்கள்."
};
const handoff = question => '[[HANDOFF]]' + HANDOFF_TEXT[languageOf(String(question || ''))];

/**
 * question: the customer's message (or a photo caption).
 * customer: the customers doc (name + id for the conversation), optional.
 * image: { data: Buffer, mimeType } — only Gemini can read it.
 * Returns the reply ([[HANDOFF]] first when staff must follow up), or
 * null when no answer could be made (caller keeps its old behaviour).
 */
async function answer({ question, customer = null, image = null, history: givenHistory = null }) {
  const q = String(question || '').trim();
  if (!q && !image) return null;

  let facts, extraAmounts;
  try {
    ({ text: facts, extraAmounts } = await buildFacts());
  } catch (err) {
    console.error('Agent answer: could not build the facts:', err.message);
    return null;
  }

  const name = customer && hasRealName(customer) ? String(customer.name).trim().split(/\s+/)[0] : '';
  // `history` can be given directly (tests); normally read from the chat.
  const history = givenHistory !== null ? givenHistory : await conversationSoFar(customer && customer._id);
  const system = `${RULES}\n\nTODAY (Sydney): ${fmtDate(sydneyToday())}\n\nFACTS:\n${facts}`;
  const ask =
    (name ? `Customer's first name: ${name}\n` : 'Customer\'s name: not known\n') +
    (history ? `\nConversation so far:\n${history}\n` : '\nConversation so far: none (this is the first message).\n') +
    `\nCustomer's new message${image ? ' (with the attached photo)' : ''}:\n${q.slice(0, 2000) || '(photo only, no text)'}`;

  const attempts = [];
  if (process.env.GEMINI_API_KEY) attempts.push({ name: 'gemini', run: () => callGemini(system, ask, image) });
  // Groq can't see photos — only used for text.
  if (GROQ_API_KEY && !image) {
    for (const model of [process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
      attempts.push({ name: model, run: () => callGroq(model, system, ask) });
    }
  }

  for (const attempt of attempts) {
    let reply;
    try {
      reply = String(await attempt.run() || '').trim();
    } catch (err) {
      console.error(`Agent answer failed (${attempt.name}):`, err.response?.status || '', err.message);
      continue;
    }
    if (!reply) continue;

    const wantsStaff = reply.includes('[[HANDOFF]]');
    reply = reply
      .replace(/\[\[[A-Z_]+[^\]]*\]\]/g, '')
      .replace(/^\s*[*-]\s+/gm, '• ')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!reply) return handoff(q);

    const problem = checkReply(reply, facts, extraAmounts);
    if (problem) {
      console.warn(`Agent answer held back (${attempt.name}): ${problem}. Reply was: ${reply.slice(0, 300)}`);
      return handoff(q);
    }
    return (wantsStaff ? '[[HANDOFF]]' : '') + reply;
  }
  return null;
}

module.exports = { answer, buildFacts, checkReply };
