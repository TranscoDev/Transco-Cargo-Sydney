// ============================================================
// ACCOUNT-AWARE WEB CHAT — deterministic answers for questions about a
// customer's OWN bookings / BLs / shipments / declaration.
// ============================================================
//
// Why this is not handed to the LLM: every fact in these replies (a
// booking reference, a BL number, a status, an arrival date) must come
// from the database or PEBL, verbatim. So the web chat route checks for
// one of these account questions first; if it is one, the reply is
// built here from customerTools.js results (scoped to the signed-in
// customer) and Flowise is never called for it. Everything else —
// prices (Flowise's pricing tool), general questions, the drop-off
// booking conversation — still flows to Flowise exactly as before.
//
// Not signed in + an account question = a friendly sign-in prompt,
// never an attempt to guess who they are. Public BL tracking by number
// (typing a BL) is untouched and still works without an account.

// Typed-English detection only; the tappable buttons send an explicit
// `action` instead, which works in every language. Deliberately narrow
// ("my"/"our" + noun) so general questions like "how does tracking
// work?" still reach the normal assistant.
const INTENT_PATTERNS = [
  { intent: 'my_bl', re: /\b(my|our)\s+(bl|hbl|b\/l|bill of lading|shipment reference|reference number|tracking number)\b|\bwhat('?s| is)\s+my\s+(bl|hbl)\b/i },
  { intent: 'track', re: /\btrack\s+(my|our)\b|\bwhere('?s| is| are)\s+(my|our)\s+(shipment|shipments|boxes|box|cargo|parcel|goods)\b|\b(status of|has)\s+(my|our)\s+(shipment|boxes|cargo|parcel)\b|\bmy\s+(shipment|boxes|cargo)\s+(arrived|status)\b|\blatest shipment\b/i },
  { intent: 'my_shipments', re: /\b(show|see|view|list)\s+(me\s+)?(all\s+)?(my|our)\s+shipments?\b|\bmy shipments\b|\bprevious shipments?\b|\blast shipment\b/i },
  { intent: 'my_bookings', re: /\b(my|our)\s+bookings?\b|\bshow\s+(me\s+)?(my\s+)?bookings\b|\bprevious booking\b|\blast booking\b/i },
  { intent: 'declaration', re: /\b(my|our)\s+declarations?\b|\bdeclaration status\b|\bdid you (get|receive) my declaration\b/i },
  { intent: 'my_documents', re: /\b(my|our)\s+(documents?|docs|invoices?|receipts?)\b/i },
  { intent: 'my_profile', re: /\b(my|our)\s+(profile|account|details)\b/i },
  { intent: 'new_booking', re: /\b(make|create|new|start)\s+(a\s+)?booking\b|\bbook\s+(a\s+)?(shipment|boxes|drop.?off)\b/i }
];

const ACTION_INTENTS = ['my_bl', 'track', 'my_shipments', 'my_bookings', 'declaration', 'my_documents', 'my_profile', 'new_booking', 'track_shipment'];

function detectAccountIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const hit = INTENT_PATTERNS.find(p => p.re.test(text));
  return hit ? hit.intent : null;
}

function languageFor(customer, text) {
  if (/[඀-෿]/.test(text || '')) return 'si';
  if (/[஀-௿]/.test(text || '')) return 'ta';
  const pref = customer && customer.preferredLanguage;
  return ['en', 'si', 'ta'].includes(pref) ? pref : 'en';
}

// Sinhala/Tamil copy follows the bot's own register (English loanwords
// like booking/shipment kept as-is, as customers write them).
const T = {
  en: {
    signInNeeded: "To show your {what}, I need to know it's you. Sign in with your phone number — it takes less than a minute, and you'll only need to do it once on this device.",
    signInNeededTrack: 'Tip: sign in with your phone number and I can find all your shipments for you — no BL number needed.',
    signInNeededBooking: 'Tip: sign in with your phone number to book online and keep all your bookings in one place.',
    what: { my_bl: 'shipment reference (BL)', track: 'shipments', my_shipments: 'shipments', my_bookings: 'bookings', declaration: 'declaration status', my_documents: 'documents', my_profile: 'profile', new_booking: 'booking' },
    signIn: 'Sign in',
    noShipments: "I can't see any shipments on your account yet.\n\nYour shipment reference (BL) is assigned once our Sydney warehouse receives and checks your boxes — it will appear here automatically after that.\n\nIf you already have a BL number, just type it and I'll look it up.",
    noShipmentsButBookings: "Your boxes haven't been assigned a shipment reference (BL) yet — that happens once our Sydney warehouse receives and checks them. Here's where your latest booking is up to:",
    pickShipment: 'You have {n} shipments with us. Which one would you like to track?',
    trackThis: 'Track this',
    trackingHeader: '📦 *Shipment reference (BL): {bl}*',
    status: 'Status: {s}',
    liveFound: 'Latest from the shipping line tracker:',
    eta: 'Estimated arrival: {d}',
    clearance: 'Estimated customs clearance: {d}',
    delivery: 'Estimated delivery: {d}',
    route: 'Route: {a} → {b}',
    liveNotFound: "The shipping line tracker doesn't have details for this BL yet — this is normal until the container is on its way.",
    liveUnavailable: "I couldn't reach the shipping line tracker just now, so I don't have the latest arrival dates. Please try again in a little while.",
    noBl: "This shipment doesn't have a BL number yet, so there's no live tracking to show. It will appear once our warehouse team assigns it.",
    noBls: "You don't have a shipment reference (BL) yet. It's assigned by our warehouse team after they receive and check your boxes — you don't need to do anything, it will show up on your account automatically.",
    blList: 'Your shipment reference (BL) numbers:',
    noBookings: "You don't have any bookings yet. When you're ready, you can book online in about a minute.",
    bookingsHeader: 'Here are your latest bookings:',
    viewAll: 'View all',
    newBooking: 'Start a booking',
    newBookingText: "Great! You can book online in about a minute — choose your boxes, destination and a drop-off time, then check everything before you confirm.\n\nWant a price first? Just ask me, e.g. \"How much for 2 tea chests to Kandy?\"",
    declarationNone: "You don't have any open bookings, so there's no declaration to complete right now.",
    declarationHeader: 'Declaration status for your bookings:',
    declReceived: '✓ Received',
    declNeeded: '⚠ Still needed',
    declarationWhy: 'The declaration lists what is in your boxes — customs needs it before your shipment can travel.',
    openForm: 'Open declaration form',
    documentsText: 'Your declaration form and booking details are in My Transco. Invoices and receipts are provided by our team — ask us any time and we\'ll send you a copy.',
    openDocuments: 'My documents',
    profileText: 'You can check and update your details (name, email, address, language) in your profile.',
    openProfile: 'My profile',
    notFound: "I couldn't find that shipment on your account.",
    viewBooking: 'View booking'
  },
  si: {
    signInNeeded: 'ඔයාගේ {what} පෙන්නන්න, මේ ඔයාමද කියලා දැනගන්න ඕන. ඔයාගේ phone number එකෙන් sign in වෙන්න — විනාඩියකටත් අඩුයි, මේ device එකේ එක පාරක් විතරයි.',
    signInNeededTrack: 'Tip: ඔයාගේ phone number එකෙන් sign in වුණොත්, BL number එකක් නැතුවම ඔයාගේ shipments ඔක්කොම මට හොයලා දෙන්න පුළුවන්.',
    signInNeededBooking: 'Tip: ඔයාගේ phone number එකෙන් sign in වුණොත් online book කරලා, ඔයාගේ bookings ඔක්කොම එක තැනක තියාගන්න පුළුවන්.',
    what: { my_bl: 'shipment reference (BL)', track: 'shipments', my_shipments: 'shipments', my_bookings: 'bookings', declaration: 'declaration status', my_documents: 'documents', my_profile: 'profile', new_booking: 'booking' },
    signIn: 'Sign in',
    noShipments: 'ඔයාගේ account එකේ තවම shipments පේන්නේ නෑ.\n\nඅපේ Sydney warehouse එකට ඔයාගේ පෙට්ටි ලැබිලා check කළාට පස්සේ shipment reference (BL) එක දෙනවා — ඊට පස්සේ ඒක මෙතන automatically පෙන්නයි.\n\nඔයා ළඟ දැනටමත් BL number එකක් තියෙනවා නම්, ඒක type කරන්න, මම බලලා කියන්නම්.',
    noShipmentsButBookings: 'ඔයාගේ පෙට්ටි වලට තවම shipment reference (BL) එකක් දීලා නෑ — අපේ Sydney warehouse එකට ලැබිලා check කළාට පස්සේ තමයි ඒක දෙන්නේ. ඔයාගේ අලුත්ම booking එක මේ වෙලාවේ තියෙන තැන:',
    pickShipment: 'ඔයාට අප එක්ක shipments {n}ක් තියෙනවා. මොකක්ද track කරන්න ඕන?',
    trackThis: 'මේක track කරන්න',
    trackingHeader: '📦 *Shipment reference (BL): {bl}*',
    status: 'තත්ත්වය: {s}',
    liveFound: 'Shipping line tracker එකේ අලුත්ම තොරතුරු:',
    eta: 'ලැබෙන්න බලාපොරොත්තු දිනය: {d}',
    clearance: 'Customs clearance බලාපොරොත්තු දිනය: {d}',
    delivery: 'Delivery බලාපොරොත්තු දිනය: {d}',
    route: 'මාර්ගය: {a} → {b}',
    liveNotFound: 'Shipping line tracker එකේ මේ BL එකට තවම තොරතුරු නෑ — container එක ගමන් පටන් ගන්නකම් මේක සාමාන්‍යයි.',
    liveUnavailable: 'Shipping line tracker එකට දැන් connect වෙන්න බැරි වුණා, ඒ නිසා අලුත්ම දින මට නෑ. ටිකකින් ආයෙත් try කරන්න.',
    noBl: 'මේ shipment එකට තවම BL number එකක් නෑ, ඒ නිසා live tracking පෙන්නන්න බෑ. අපේ warehouse team එක ඒක දුන්නම මෙතන පෙන්නයි.',
    noBls: 'ඔයාට තවම shipment reference (BL) එකක් නෑ. ඔයාගේ පෙට්ටි ලැබිලා check කළාට පස්සේ අපේ warehouse team එක ඒක දෙනවා — ඔයාට මුකුත් කරන්න ඕන නෑ, ඒක ඔයාගේ account එකේ automatically පෙන්නයි.',
    blList: 'ඔයාගේ shipment reference (BL) numbers:',
    noBookings: 'ඔයාට තවම bookings නෑ. ලෑස්ති වුණාම, විනාඩියකින් විතර online book කරන්න පුළුවන්.',
    bookingsHeader: 'ඔයාගේ අලුත්ම bookings:',
    viewAll: 'ඔක්කොම බලන්න',
    newBooking: 'Booking එකක් පටන් ගන්න',
    newBookingText: 'නියමයි! විනාඩියකින් විතර online book කරන්න පුළුවන් — පෙට්ටි, යවන තැන සහ drop-off වෙලාවක් තෝරලා, confirm කරන්න කලින් ඔක්කොම check කරන්න පුළුවන්.\n\nකලින් මිල දැනගන්න ඕනද? මගෙන් අහන්න, උදා: "Kandy වලට tea chests 2ක් කීයද?"',
    declarationNone: 'ඔයාට open bookings නැති නිසා දැන් declaration එකක් fill කරන්න ඕන නෑ.',
    declarationHeader: 'ඔයාගේ bookings වල declaration තත්ත්වය:',
    declReceived: '✓ ලැබුණා',
    declNeeded: '⚠ තවම ඕන',
    declarationWhy: 'Declaration එකේ තියෙන්නේ ඔයාගේ පෙට්ටි වල මොනවද තියෙන්නේ කියලා — shipment එක යවන්න කලින් customs වලට ඒක ඕන.',
    openForm: 'Declaration form එක open කරන්න',
    documentsText: 'ඔයාගේ declaration form එක සහ booking විස්තර My Transco එකේ තියෙනවා. Invoices සහ receipts අපේ team එකෙන් දෙනවා — ඕනම වෙලාවක අහන්න, copy එකක් එවන්නම්.',
    openDocuments: 'මගේ documents',
    profileText: 'ඔයාගේ විස්තර (නම, email, ලිපිනය, භාෂාව) profile එකෙන් බලලා update කරන්න පුළුවන්.',
    openProfile: 'මගේ profile',
    notFound: 'ඔයාගේ account එකේ ඒ shipment එක හොයාගන්න බැරි වුණා.',
    viewBooking: 'Booking එක බලන්න'
  },
  ta: {
    signInNeeded: 'உங்கள் {what} ஐக் காட்ட, இது நீங்கள்தான் என்று உறுதிசெய்ய வேண்டும். உங்கள் phone number மூலம் sign in செய்யுங்கள் — ஒரு நிமிடத்துக்கும் குறைவு, இந்த device இல் ஒரு முறை மட்டுமே.',
    signInNeededTrack: 'Tip: உங்கள் phone number மூலம் sign in செய்தால், BL number இல்லாமலே உங்கள் எல்லா shipments ஐயும் நான் கண்டுபிடித்துத் தருவேன்.',
    signInNeededBooking: 'Tip: உங்கள் phone number மூலம் sign in செய்தால் online இல் book செய்து, உங்கள் எல்லா bookings ஐயும் ஒரே இடத்தில் வைத்திருக்கலாம்.',
    what: { my_bl: 'shipment reference (BL)', track: 'shipments', my_shipments: 'shipments', my_bookings: 'bookings', declaration: 'declaration நிலை', my_documents: 'documents', my_profile: 'profile', new_booking: 'booking' },
    signIn: 'Sign in',
    noShipments: 'உங்கள் account இல் இன்னும் shipments எதுவும் இல்லை.\n\nஎங்கள் Sydney கிடங்கு உங்கள் பெட்டிகளைப் பெற்று சரிபார்த்த பிறகு shipment reference (BL) வழங்கப்படும் — அதன் பிறகு அது இங்கே தானாகவே தோன்றும்.\n\nஏற்கனவே BL number இருந்தால், அதை type செய்யுங்கள், நான் பார்த்துச் சொல்கிறேன்.',
    noShipmentsButBookings: 'உங்கள் பெட்டிகளுக்கு இன்னும் shipment reference (BL) வழங்கப்படவில்லை — எங்கள் Sydney கிடங்கு அவற்றைப் பெற்று சரிபார்த்த பிறகே அது வழங்கப்படும். உங்கள் சமீபத்திய booking இப்போது இருக்கும் நிலை:',
    pickShipment: 'எங்களிடம் உங்களுக்கு {n} shipments உள்ளன. எதை track செய்ய வேண்டும்?',
    trackThis: 'இதை track செய்',
    trackingHeader: '📦 *Shipment reference (BL): {bl}*',
    status: 'நிலை: {s}',
    liveFound: 'Shipping line tracker இன் சமீபத்திய தகவல்:',
    eta: 'எதிர்பார்க்கப்படும் வருகை: {d}',
    clearance: 'எதிர்பார்க்கப்படும் customs clearance: {d}',
    delivery: 'எதிர்பார்க்கப்படும் delivery: {d}',
    route: 'பாதை: {a} → {b}',
    liveNotFound: 'Shipping line tracker இல் இந்த BL க்கு இன்னும் தகவல் இல்லை — container பயணம் தொடங்கும் வரை இது வழக்கமானதே.',
    liveUnavailable: 'இப்போது shipping line tracker ஐ அணுக முடியவில்லை, அதனால் சமீபத்திய தேதிகள் என்னிடம் இல்லை. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.',
    noBl: 'இந்த shipment க்கு இன்னும் BL number இல்லை, அதனால் live tracking காட்ட முடியாது. எங்கள் கிடங்கு குழு வழங்கியதும் இங்கே தோன்றும்.',
    noBls: 'உங்களுக்கு இன்னும் shipment reference (BL) இல்லை. உங்கள் பெட்டிகளைப் பெற்று சரிபார்த்த பிறகு எங்கள் கிடங்கு குழு அதை வழங்கும் — நீங்கள் எதுவும் செய்ய வேண்டியதில்லை, அது உங்கள் account இல் தானாகவே தோன்றும்.',
    blList: 'உங்கள் shipment reference (BL) numbers:',
    noBookings: 'உங்களுக்கு இன்னும் bookings இல்லை. தயாரானதும், ஒரு நிமிடத்தில் online இல் book செய்யலாம்.',
    bookingsHeader: 'உங்கள் சமீபத்திய bookings:',
    viewAll: 'அனைத்தையும் பார்',
    newBooking: 'Booking ஐத் தொடங்கு',
    newBookingText: 'அருமை! ஒரு நிமிடத்தில் online இல் book செய்யலாம் — பெட்டிகள், சேருமிடம், drop-off நேரம் தேர்ந்தெடுத்து, confirm செய்வதற்கு முன் அனைத்தையும் சரிபார்க்கலாம்.\n\nமுதலில் விலை தெரிய வேண்டுமா? என்னிடம் கேளுங்கள், உதா: "Kandy க்கு 2 tea chests எவ்வளவு?"',
    declarationNone: 'உங்களுக்கு open bookings இல்லாததால், இப்போது declaration நிரப்பத் தேவையில்லை.',
    declarationHeader: 'உங்கள் bookings இன் declaration நிலை:',
    declReceived: '✓ பெறப்பட்டது',
    declNeeded: '⚠ இன்னும் தேவை',
    declarationWhy: 'Declaration இல் உங்கள் பெட்டிகளில் என்ன உள்ளது என்பது இருக்கும் — shipment அனுப்புவதற்கு முன் customs க்கு அது தேவை.',
    openForm: 'Declaration form ஐத் திற',
    documentsText: 'உங்கள் declaration form மற்றும் booking விவரங்கள் My Transco இல் உள்ளன. Invoices மற்றும் receipts எங்கள் குழுவால் வழங்கப்படும் — எப்போது வேண்டுமானாலும் கேளுங்கள், copy அனுப்புவோம்.',
    openDocuments: 'என் documents',
    profileText: 'உங்கள் விவரங்களை (பெயர், email, முகவரி, மொழி) profile இல் பார்த்து update செய்யலாம்.',
    openProfile: 'என் profile',
    notFound: 'உங்கள் account இல் அந்த shipment ஐக் கண்டுபிடிக்க முடியவில்லை.',
    viewBooking: 'Booking ஐப் பார்'
  }
};

function fmt(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function bookingCard(b, t) {
  const lines = [b.items, b.destination && b.country ? `→ ${b.destination}, ${b.country}` : (b.destination ? `→ ${b.destination}` : null)]
    .filter(Boolean);
  if (b.blNumber) lines.push(`BL ${b.blNumber}`);
  return {
    kind: 'booking',
    title: b.code || 'Booking',
    lines,
    status: b.status,
    href: `/account.html#/bookings/${b.id}`,
    linkLabel: t.viewBooking
  };
}

function shipmentCard(s, t, withTrackAction) {
  return {
    kind: 'shipment',
    title: s.blNumber ? `BL ${s.blNumber}` : 'Shipment',
    lines: [s.items, s.destination ? `→ ${s.destination}` : null, s.bookingCode].filter(Boolean),
    status: s.status,
    href: `/account.html#/shipments/${s.id}`,
    action: withTrackAction ? { label: t.trackThis, action: 'track_shipment', shipmentId: s.id } : null
  };
}

async function trackingReply(tools, customerId, shipmentId, t) {
  const tracking = await tools.getShipmentTracking(customerId, shipmentId);
  if (!tracking) return { reply: t.notFound };
  const { shipment, live } = tracking;
  const parts = [];
  if (shipment.blNumber) parts.push(fmt(t.trackingHeader, { bl: shipment.blNumber }));
  if (shipment.items || shipment.destination) {
    parts.push([shipment.items, shipment.destination ? `→ ${shipment.destination}` : null].filter(Boolean).join(' '));
  }
  parts.push(fmt(t.status, { s: shipment.status.label }));

  if (live.state === 'found') {
    const liveLines = [t.liveFound];
    if (live.portOfLoading && live.portOfDischarge) liveLines.push(fmt(t.route, { a: live.portOfLoading, b: live.portOfDischarge }));
    if (live.estimatedArrivalDate) liveLines.push(fmt(t.eta, { d: live.estimatedArrivalDate }));
    if (live.estimatedClearanceDate) liveLines.push(fmt(t.clearance, { d: live.estimatedClearanceDate }));
    if (live.estimatedDeliveryDate) liveLines.push(fmt(t.delivery, { d: live.estimatedDeliveryDate }));
    if (liveLines.length > 1) parts.push(liveLines.join('\n'));
  } else if (live.state === 'not_found') {
    parts.push(t.liveNotFound);
  } else if (live.state === 'unavailable') {
    parts.push(t.liveUnavailable);
  } else if (live.state === 'no_bl') {
    parts.push(t.noBl);
  }

  return { reply: parts.join('\n\n'), cards: [shipmentCard(shipment, t, false)] };
}

// Returns { reply, cards?, actions? } — or null when this message isn't
// an account question at all (caller falls through to Flowise).
async function handleAccountIntent({ intent, shipmentId, account, tools, text }) {
  const lang = languageFor(account, text);
  const t = T[lang];

  if (!account) {
    if (intent === 'track' || intent === 'new_booking') {
      // Public tracking by BL number and the drop-off booking
      // conversation both keep working through Flowise without an
      // account — the caller just appends this sign-in suggestion.
      return {
        passThrough: true,
        actions: [{ label: t.signIn, href: '/account.html?next=chat', kind: 'login' }],
        note: intent === 'track' ? t.signInNeededTrack : t.signInNeededBooking
      };
    }
    return {
      reply: fmt(t.signInNeeded, { what: t.what[intent] || t.what.my_bookings }),
      actions: [{ label: t.signIn, href: '/account.html?next=chat', kind: 'login' }]
    };
  }

  const customerId = account._id;

  switch (intent) {
    case 'track_shipment':
      return trackingReply(tools, customerId, shipmentId, t);

    case 'track':
    case 'my_shipments': {
      const list = await tools.getCustomerShipments(customerId, { limit: 5 });
      if (list.length === 0) {
        const bookingsList = await tools.getCustomerBookings(customerId, { limit: 1 });
        const open = bookingsList.find(b => b.status.key !== 'cancelled');
        if (open) {
          return { reply: t.noShipmentsButBookings, cards: [bookingCard(open, t)] };
        }
        return { reply: t.noShipments, actions: [{ label: t.newBooking, href: '/account.html#/book' }] };
      }
      if (intent === 'track' && list.length === 1) {
        return trackingReply(tools, customerId, list[0].id, t);
      }
      return {
        reply: fmt(t.pickShipment, { n: list.length }),
        cards: list.slice(0, 3).map(s => shipmentCard(s, t, true)),
        actions: list.length > 3 ? [{ label: t.viewAll, href: '/account.html#/shipments' }] : []
      };
    }

    case 'my_bl': {
      const withBl = await tools.getCustomerBLs(customerId);
      if (withBl.length === 0) return { reply: t.noBls };
      return {
        reply: t.blList,
        cards: withBl.slice(0, 5).map(s => shipmentCard(s, t, true))
      };
    }

    case 'my_bookings': {
      const list = await tools.getCustomerBookings(customerId, { limit: 3 });
      if (list.length === 0) {
        return { reply: t.noBookings, actions: [{ label: t.newBooking, href: '/account.html#/book' }] };
      }
      return {
        reply: t.bookingsHeader,
        cards: list.map(b => bookingCard(b, t)),
        actions: [{ label: t.viewAll, href: '/account.html#/bookings' }]
      };
    }

    case 'new_booking':
      return { reply: t.newBookingText, actions: [{ label: t.newBooking, href: '/account.html#/book' }] };

    case 'declaration': {
      const docs = await tools.getCustomerDocuments(customerId);
      if (docs.declarations.length === 0) return { reply: t.declarationNone };
      const lines = docs.declarations.slice(0, 5).map(d =>
        `${d.bookingCode || 'Booking'}${d.items ? ` (${d.items})` : ''}: ${d.status === 'received' ? t.declReceived : t.declNeeded}`
      );
      const needsForm = docs.declarations.some(d => d.status === 'needed');
      return {
        reply: `${t.declarationHeader}\n\n${lines.join('\n')}${needsForm ? `\n\n${t.declarationWhy}` : ''}`,
        actions: needsForm ? [{ label: t.openForm, href: docs.declarationFormUrl, external: true }] : []
      };
    }

    case 'my_documents':
      return { reply: t.documentsText, actions: [{ label: t.openDocuments, href: '/account.html#/documents' }] };

    case 'my_profile':
      return { reply: t.profileText, actions: [{ label: t.openProfile, href: '/account.html#/profile' }] };

    default:
      return null;
  }
}

module.exports = { detectAccountIntent, handleAccountIntent, ACTION_INTENTS, languageFor };
