/*
 * Transco website — English / සිංහල / தமிழ் for every public page.
 *
 * The language is chosen on the landing page and remembered in the
 * browser ("transco_lang", the same setting My Transco uses), so every
 * page — and My Transco — opens in it.
 *
 * Pages are written in English. This script swaps each piece of visible
 * text for its translation (matched by its English text), including text
 * the page adds later (chat buttons, calendar, box list). Elements with
 * data-i18n="key" are translated as a whole (for sentences that contain
 * styled words). Chat messages themselves are never touched.
 *
 * Sinhala and Tamil follow the same everyday style as My Transco:
 * common English shipping words (booking, BL, Tea Chest…) stay English.
 */
(function () {
  var KEY = "transco_lang";
  var LANGS = ["en", "si", "ta"];
  var LOCALES = { en: "en-AU", si: "si-LK", ta: "ta-LK" };

  // ---------------------------------------------------------------
  // Whole-element translations (data-i18n="key") — may contain markup.
  // ---------------------------------------------------------------
  var HTML = {
    si: {
      "hero.title": '<span class="accent">Transco</span> සමඟ Sydney සිට ශ්‍රී ලංකාවට සහ ඉන්දියාවට යවන්න.',
      "sl.promo": "<strong>Tea Chests 2ක් යවන්න, 3 වැන්න නොමිලේ</strong> — එකම ලබන්නා, එක Bill of Lading එකක්. Sea freight වලට පමණයි.",
      "sl.dutyfree": "<strong>Duty-Free Allowance</strong> — ඔබේ පාර්සල් භාර දෙන්න කලින් අපේ warehouse කාර්ය මණ්ඩලයෙන් වර්තමාන විස්තර අහන්න.",
      "in.flat": "<strong>එකම flat rate එකක්</strong> — door delivery සහ warehouse pickup දෙකටම එකම මිල; ඉන්දියාව ඇතුළත නගරය අනුව මිල වෙනස් වෙන්නේ නෑ (ශ්‍රී ලංකාවේ zone ක්‍රමය වගේ නොවෙයි).",
      "in.filling": "<strong>තවම සම්පූර්ණ කරමින්</strong> — ශ්‍රී ලංකාවට වගේ ඉන්දියාවට තවම නම් කළ destination warehouse එකක් හෝ duty-free allowance සටහනක් නෑ. ඒ දෙකෙන් එකක් ඕන නම්, Transco Agent අනුමාන නොකර ඔබව කෙලින්ම අපේ කණ්ඩායමට සම්බන්ධ කරයි.",
      "box.note": "<strong>ශ්‍රී ලංකාව:</strong> මිල ගණන් අපේ Wattala warehouse එකෙන් ගන්නා විට — door delivery zone අනුව. Tea Chests 2ක් යවන්න, 3 වැන්න නොමිලේ.<br><strong>ඉන්දියාව:</strong> pickup හෝ door delivery දෙකටම එකම මිල. General cargo box එකක් (30kg දක්වා) <span class=\"tabular\">$400</span>.<br><strong>TV freight</strong> ශ්‍රී ලංකාවට: <span class=\"tabular\">$280</span>.",
      "contact.hours": "<strong>ව්‍යාපාරික වේලාවන්</strong> — පරණ වෙන්න පුළුවන් වේලාවක් මෙතන දානවා වෙනුවට, අපේ වර්තමාන වේලාවන් Transco Agent ගෙන් අහන්න; එය හැමවිටම යාවත්කාලීනයි."
    },
    ta: {
      "hero.title": 'Sydney இலிருந்து இலங்கை மற்றும் இந்தியாவுக்கு <span class="accent">Transco</span> உடன் அனுப்புங்கள்.',
      "sl.promo": "<strong>2 Tea Chests அனுப்புங்கள், 3வது இலவசம்</strong> — ஒரே பெறுநர், ஒரே Bill of Lading. Sea freight க்கு மட்டும்.",
      "sl.dutyfree": "<strong>Duty-Free Allowance</strong> — உங்கள் பொதிகளை ஒப்படைப்பதற்கு முன் தற்போதைய விவரங்களை எங்கள் warehouse ஊழியர்களிடம் கேளுங்கள்.",
      "in.flat": "<strong>ஒரே flat rate</strong> — door delivery க்கும் warehouse pickup க்கும் ஒரே விலை; இந்தியாவுக்குள் நகரத்தைப் பொறுத்து விலை மாறாது (இலங்கையின் zone முறை போலல்ல).",
      "in.filling": "<strong>இன்னும் சேர்க்கப்படுகிறது</strong> — இலங்கையைப் போல இந்தியாவுக்கு இன்னும் பெயரிடப்பட்ட destination warehouse அல்லது duty-free allowance குறிப்பு இல்லை. இவற்றில் எதுவும் தேவைப்பட்டால், Transco Agent ஊகிக்காமல் உங்களை நேரடியாக எங்கள் குழுவுடன் இணைக்கும்.",
      "box.note": "<strong>இலங்கை:</strong> விலைகள் எங்கள் Wattala warehouse இல் பெற்றுக்கொள்வதற்கானவை — door delivery zone அடிப்படையில். 2 Tea Chests அனுப்புங்கள், 3வது இலவசம்.<br><strong>இந்தியா:</strong> pickup அல்லது door delivery இரண்டுக்கும் ஒரே விலை. ஒரு General cargo box (30kg வரை) <span class=\"tabular\">$400</span>.<br><strong>TV freight</strong> இலங்கைக்கு: <span class=\"tabular\">$280</span>.",
      "contact.hours": "<strong>வணிக நேரம்</strong> — காலாவதியாகக்கூடிய நேரத்தை இங்கே போடுவதற்குப் பதிலாக, எங்கள் தற்போதைய நேரத்தை Transco Agent இடம் கேளுங்கள்; அது எப்போதும் புதுப்பிக்கப்பட்டிருக்கும்."
    }
  };

  // ---------------------------------------------------------------
  // Text translations, keyed by the English text (spaces normalised).
  // ---------------------------------------------------------------
  var DICT = {
    si: {
      // navigation + footer
      "Chat with Transco Agent": "Transco Agent සමඟ chat කරන්න",
      "Sri Lanka": "ශ්‍රී ලංකාව",
      "India": "ඉන්දියාව",
      "Box Info": "පෙට්ටි විස්තර",
      "About": "අප ගැන",
      "Contact": "සම්බන්ධ වන්න",
      "Open menu": "මෙනුව විවෘත කරන්න",
      "Navigation": "සංචාලනය",
      "Sydney → Sri Lanka": "Sydney → ශ්‍රී ලංකාව",
      "Sydney → India": "Sydney → ඉන්දියාව",
      "Fast, reliable, and secure cargo services from Australia to Sri Lanka and India. Your goods, our commitment.": "ඕස්ට්‍රේලියාවේ සිට ශ්‍රී ලංකාවට සහ ඉන්දියාවට වේගවත්, විශ්වාසදායක සහ ආරක්ෂිත cargo සේවා. ඔබේ භාණ්ඩ, අපේ කැපවීම.",
      "© 2026 Transco Cargo Sydney. All rights reserved.": "© 2026 Transco Cargo Sydney. සියලු හිමිකම් ඇවිරිණි.",
      "Transco Agent": "Transco Agent",

      // landing page
      "Get instant shipping information, quotes and pickup assistance through our AI-powered Transco Agent.": "අපේ AI බලයෙන් ක්‍රියා කරන Transco Agent හරහා shipping තොරතුරු, මිල ගණන් සහ pickup සහාය ක්ෂණිකව ලබා ගන්න.",
      "Ship to Sri Lanka": "ශ්‍රී ලංකාවට යවන්න",
      "Ship to India": "ඉන්දියාවට යවන්න",
      "Years Experience": "අවුරුදු පළපුරුද්ද",
      "Destinations": "ගමනාන්ත",
      "AI Assistance": "AI සහාය",
      "Meet Your Bot": "ඔබේ Bot හමුවන්න",
      "One conversation. Every answer.": "එක කතාබහක්. හැම පිළිතුරක්ම.",
      "Transco Agent handles pricing, tracking, pickup bookings and general questions — in English, Sinhala or Tamil — and hands off to our real team the moment something needs a human.": "Transco Agent මිල ගණන්, tracking, pickup bookings සහ සාමාන්‍ය ප්‍රශ්න ඉංග්‍රීසි, සිංහල හෝ දෙමළෙන් බලාගන්නවා — මිනිසෙක් ඕන වෙන මොහොතේම අපේ සැබෑ කණ්ඩායමට භාර දෙනවා.",
      "Ask anything below — pricing, tracking, pickup bookings, or just say hi.": "පහළින් ඕනෑම දෙයක් අහන්න — මිල, tracking, pickup bookings, නැත්නම් hi කියන්න.",
      "💰 Get a Price Quote": "💰 මිලක් ගන්න",
      "📦 Track a Shipment": "📦 Shipment එකක් track කරන්න",
      "🗓️ Shipping Calendar": "🗓️ Shipping දින දර්ශනය",
      "📋 Declaration Form": "📋 Declaration form එක",
      "🇱🇰 Shipping to Sri Lanka": "🇱🇰 ශ්‍රී ලංකාවට යවනවා",
      "🇮🇳 Shipping to India": "🇮🇳 ඉන්දියාවට යවනවා",
      "Sign in to see your bookings & shipments": "ඔබේ bookings සහ shipments බලන්න sign in වන්න",
      "Sign in": "Sign in",
      "Prefer WhatsApp? Chat there instead": "WhatsApp කැමතිද? එතනින් chat කරන්න",
      "English · සිංහල · தமிழ்": "English · සිංහල · தமிழ்",
      "How can I help you today?": "අද මම ඔබට උදව් කරන්නේ කොහොමද?",
      "Type your question": "ඔබේ ප්‍රශ්නය type කරන්න",
      "Type your question…": "ඔබේ ප්‍රශ්නය type කරන්න…",
      "Type your question...": "ඔබේ ප්‍රශ්නය type කරන්න...",
      "Send": "යවන්න",
      "Close chat": "Chat එක වසන්න",
      "Shipping Calculator": "Shipping ගණකය",
      "Track a Shipment": "Shipment එකක් track කරන්න",
      "Shipping Calendar": "Shipping දින දර්ශනය",
      "Declaration Form": "Declaration form එක",
      "Shipping to Sri Lanka": "ශ්‍රී ලංකාවට යවනවා",
      "Shipping to India": "ඉන්දියාවට යවනවා",
      "Our Services": "අපේ සේවා",
      "Where we ship, and how": "අපි යවන්නේ කොහෙටද, කොහොමද",
      "Shipping services": "Shipping සේවා",
      "Sea Freight": "Sea Freight",
      "Air Freight": "Air Freight",
      "See Sri Lanka pricing →": "ශ්‍රී ලංකා මිල ගණන් බලන්න →",
      "General Cargo Shipping": "General Cargo shipping",
      "See India pricing →": "ඉන්දියා මිල ගණන් බලන්න →",
      "Get a price": "මිලක් ගන්න",
      "Track a shipment": "Shipment එකක් track කරන්න",
      "Shipping calendar": "Shipping දින දර්ශනය",
      "Declaration form": "Declaration form එක",
      "Track my shipment": "මගේ shipment එක track කරන්න",
      "My bookings": "මගේ bookings",
      "New booking": "අලුත් booking",
      "Book": "Book කරන්න",
      "Book a drop-off for this shipment": "මේ shipment එකට drop-off එකක් book කරන්න",
      "Make a booking": "Booking එකක් කරන්න",
      "My BL number": "මගේ BL අංකය",
      "Declaration status": "Declaration තත්ත්වය",
      "Your chat is still open": "ඔබේ chat එක තවම විවෘතයි",
      "Continue chat": "Chat එක දිගටම කරන්න",
      "Promotional flyer": "Promotion flyer එක",
      "Sorry, something went wrong. Please try again in a moment.": "සමාවෙන්න, යමක් වැරදුණා. ටිකකින් නැවත උත්සාහ කරන්න.",
      "Sorry, something went wrong. Please try again.": "සමාවෙන්න, යමක් වැරදුණා. නැවත උත්සාහ කරන්න.",
      "A staff member will be with you shortly.": "කාර්ය මණ්ඩල සාමාජිකයෙක් ඉක්මනින් ඔබ සමඟ සම්බන්ධ වේවි.",
      "Sorry, I couldn't reach our server. Please check your connection and try again.": "සමාවෙන්න, server එකට සම්බන්ධ වෙන්න බැරි වුණා. ඔබේ සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.",
      "Sorry, I couldn't reach our server. Please check your connection.": "සමාවෙන්න, server එකට සම්බන්ධ වෙන්න බැරි වුණා. ඔබේ සම්බන්ධතාවය පරීක්ෂා කරන්න.",

      // country pages
      "Sri Lanka shipments": "ශ්‍රී ලංකා shipments",
      "Fixed box rates, not per-kg — pick up from our Wattala warehouse or have it delivered anywhere island-wide.": "Kg අනුව නොවේ, පෙට්ටියකට ස්ථාවර මිලක් — අපේ Wattala warehouse එකෙන් ගන්න, නැත්නම් දිවයින පුරා ඕනෑම තැනකට ගෙනත් දෙන්න.",
      "Hand your boxes over in Sydney by the date on the left to make that shipment.": "ඒ shipment එකට යවන්න නම්, වම් පැත්තේ දිනයට කලින් Sydney වල ඔබේ පෙට්ටි භාර දෙන්න.",
      "🚢 Sea freight": "🚢 Sea freight",
      "✈️ Air freight": "✈️ Air freight",
      "Freight type": "Freight වර්ගය",
      "Box prices": "පෙට්ටි මිල ගණන්",
      "Per box, sea freight, collected from our Wattala warehouse.": "පෙට්ටියකට, sea freight, අපේ Wattala warehouse එකෙන් ගන්නා විට.",
      "Max 20kg": "උපරිම 20kg",
      "Max 30kg": "උපරිම 30kg",
      "Max 50kg": "උපරිම 50kg",
      "Most Popular": "වැඩිපුරම තෝරන",
      "Compare box sizes →": "පෙට්ටි ප්‍රමාණ සසඳන්න →",
      "Pickup from Wattala Warehouse": "Wattala Warehouse එකෙන් ගැනීම",
      "The cheaper option — the receiver collects the box(es) themselves.": "ලාභම විකල්පය — ලබන්නා පෙට්ටි තමන්ම ගන්නවා.",
      "Boxes": "පෙට්ටි",
      "Weight": "බර",
      "Price": "මිල",
      "1 Box": "පෙට්ටි 1",
      "2 Boxes": "පෙට්ටි 2",
      "3 Boxes": "පෙට්ටි 3",
      "1 Box:": "පෙට්ටි 1:",
      "2 Boxes:": "පෙට්ටි 2:",
      "3 Boxes:": "පෙට්ටි 3:",
      "Door Delivery": "Door delivery",
      "Priced by zone — road distance from Colombo Fort.": "Zone අනුව මිල — කොළඹ කොටුවේ සිට පාරේ දුර.",
      "Zone 1 — Up to 20km from Colombo Fort": "Zone 1 — කොළඹ කොටුවේ සිට 20km දක්වා",
      "Zone 2 — 21–100km from Colombo Fort": "Zone 2 — කොළඹ කොටුවේ සිට 21–100km",
      "Zone 3 — Over 100km from Colombo Fort": "Zone 3 — කොළඹ කොටුවේ සිට 100km ට වැඩි",
      "e.g. Moratuwa, Pannipitiya, Kaduwela, Ja-Ela": "උදා: Moratuwa, Pannipitiya, Kaduwela, Ja-Ela",
      "e.g. Kurunegala, Gampola, Hatton, Ambalangoda": "උදා: Kurunegala, Gampola, Hatton, Ambalangoda",
      "e.g. Jaffna, Vavuniya, Kandy, Batticaloa, Hambantota": "උදා: Jaffna, Vavuniya, Kandy, Batticaloa, Hambantota",
      "Good to know": "දැනගන්න හොඳයි",
      "Worth checking before you drop off.": "පෙට්ටි ගේන්න කලින් බලන්න වටිනවා.",
      "Ask about Sri Lanka shipping": "ශ්‍රී ලංකා shipping ගැන අහන්න",
      "Ask anything, or try:": "ඕනෑම දෙයක් අහන්න, නැත්නම්:",
      "🏭 Warehouse Pickup Price": "🏭 Warehouse pickup මිල",
      "🚚 Door Delivery Zones": "🚚 Door delivery zones",
      "📅 Shipping Schedule": "📅 Shipping කාලසටහන",
      "👤 Talk to Our Team": "👤 අපේ කණ්ඩායම සමඟ කතා කරන්න",
      "Transco Agent chat": "Transco Agent chat",
      "Chat with Transco Agent ": "Transco Agent සමඟ chat කරන්න",
      "Hand over by": "භාර දිය යුතු දිනය",
      "Arrives Colombo (est.)": "කොළඹට එන දිනය (ඇස්තමේන්තු)",
      "Arrives India (est.)": "ඉන්දියාවට එන දිනය (ඇස්තමේන්තු)",
      "Next": "ඊළඟ",
      "To be confirmed": "තවම තහවුරු කර නෑ",
      "Next sea freight dates are being confirmed": "ඊළඟ sea freight දින තහවුරු කරමින් පවතී",
      "Next air freight dates are being confirmed": "ඊළඟ air freight දින තහවුරු කරමින් පවතී",
      "Ask us and we'll tell you the next hand-over date.": "අපෙන් අහන්න, ඊළඟ භාර දෙන දිනය කියන්නම්.",
      "Ask for the next date": "ඊළඟ දිනය අහන්න",
      "Hand your boxes over in Sydney by the cutoff date. Arrival dates are estimates.": "Cutoff දිනයට කලින් Sydney වල ඔබේ පෙට්ටි භාර දෙන්න. එන දින ඇස්තමේන්තු පමණයි.",
      "Delivery to your home anywhere in Sri Lanka": "ශ්‍රී ලංකාවේ ඕනෑම තැනක ඔබේ නිවසටම ගෙනත් දෙනවා",
      "Delivery to your home anywhere in India": "ඉන්දියාවේ ඕනෑම තැනක ඔබේ නිවසටම ගෙනත් දෙනවා",
      "Got an odd-sized item? Check here": "සාමාන්‍ය ප්‍රමාණයට වෙනස් බඩුවක් තියෙනවද? මෙතනින් බලන්න",
      "Custom-sized box, TV, bicycle or anything else — ask here.": "විශේෂ ප්‍රමාණයේ පෙට්ටියක්, TV එකක්, බයිසිකලයක් හෝ වෙන ඕනෑම දෙයක් — මෙතනින් අහන්න.",
      "Custom size box": "විශේෂ ප්‍රමාණයේ පෙට්ටියක්",
      "TV": "TV",
      "Bicycle": "බයිසිකලය",
      "Something else": "වෙන දෙයක්",
      "I have a custom-sized box. How much would it cost to send it to Sri Lanka?": "මට විශේෂ ප්‍රමාණයේ පෙට්ටියක් තියෙනවා. ඒක ලංකාවට යවන්න කීයක් යයිද?",
      "How much does it cost to send a TV to Sri Lanka?": "TV එකක් ලංකාවට යවන්න කීයක් යයිද?",
      "How much does it cost to send a bicycle to Sri Lanka?": "බයිසිකලයක් ලංකාවට යවන්න කීයක් යයිද?",
      "I have an odd-sized item to send to Sri Lanka.": "මට ලංකාවට යවන්න සාමාන්‍ය ප්‍රමාණයට වෙනස් බඩුවක් තියෙනවා.",
      "Next cutoff": "ඊළඟ cutoff",
      "Upcoming": "ඉදිරියට",
      "Sea freight": "Sea freight",
      "Air freight": "Air freight",
      "Next dates are being confirmed": "ඊළඟ දින තහවුරු කරමින් පවතී",
      "Couldn't load the dates right now": "දැන් දින load කරන්න බැරි වුණා",
      "India shipments": "ඉන්දියා shipments",
      "Flat-rate pricing by box type — pickup from our Seven Hills location or door delivery, at the same price either way.": "පෙට්ටි වර්ගය අනුව flat-rate මිල — අපේ Seven Hills ස්ථානයෙන් ගන්න හෝ door delivery, දෙකටම එකම මිල.",
      "Flat rate from Seven Hills — the same price for pickup or door delivery, anywhere in India.": "Seven Hills සිට flat rate — ඉන්දියාවේ ඕනෑම තැනකට pickup හෝ door delivery දෙකටම එකම මිල.",
      "General cargo box": "General cargo box",
      "· up to 30kg each": "· එකකට 30kg දක්වා",
      "Best Value": "හොඳම වටිනාකම",
      "Tea Chest or Quarter CBM": "Tea Chest හෝ Quarter CBM",
      "· up to 50kg each, same price": "· එකකට 50kg දක්වා, එකම මිල",
      "India's setup is simpler than Sri Lanka's, on purpose — but a couple of things are worth being upfront about.": "ඉන්දියාවේ ක්‍රමය හිතාමතාම ශ්‍රී ලංකාවට වඩා සරලයි — නමුත් කලින්ම කියන්න ඕන දේවල් කිහිපයක් තියෙනවා.",
      "Ask about India shipping": "ඉන්දියා shipping ගැන අහන්න",
      "🧮 Get a Price Quote": "🧮 මිලක් ගන්න",
      "🏭 Seven Hills Pickup": "🏭 Seven Hills pickup",
      "🚚 Door Delivery": "🚚 Door delivery",

      // box info
      "Box sizes & prices": "පෙට්ටි ප්‍රමාණ සහ මිල",
      "Compare every box by size, weight limit and price — then pick the one that fits what you're sending.": "හැම පෙට්ටියක්ම ප්‍රමාණය, බර සීමාව සහ මිල අනුව සසඳන්න — ඔබ යවන දේට ගැලපෙන එක තෝරන්න.",
      "Which box fits?": "ගැලපෙන්නේ කුමන පෙට්ටියද?",
      "Smallest to largest. Price is per box, sea freight.": "කුඩාම සිට විශාලම දක්වා. මිල පෙට්ටියකට, sea freight.",
      "Box & size": "පෙට්ටිය සහ ප්‍රමාණය",
      "🇱🇰 Sri Lanka": "🇱🇰 ශ්‍රී ලංකාව",
      "🇮🇳 India": "🇮🇳 ඉන්දියාව",
      "Ask us": "අපෙන් අහන්න",
      "🇱🇰 Sri Lanka prices & dates": "🇱🇰 ශ්‍රී ලංකා මිල සහ දින",
      "🇮🇳 India prices & dates": "🇮🇳 ඉන්දියා මිල සහ දින",
      "Ask about boxes & prices": "පෙට්ටි සහ මිල ගැන අහන්න",
      "📦 Which Box Should I Use?": "📦 මම පාවිච්චි කරන්න ඕන කුමන පෙට්ටියද?",
      "🚫 What Can't I Send?": "🚫 මට යවන්න බැරි මොනවද?",

      // about
      "Your trusted cargo service partner": "ඔබ විශ්වාස කරන cargo සේවා හවුල්කරු",
      "Fast, reliable, and secure cargo services from Australia to Sri Lanka and India.": "ඕස්ට්‍රේලියාවේ සිට ශ්‍රී ලංකාවට සහ ඉන්දියාවට වේගවත්, විශ්වාසදායක සහ ආරක්ෂිත cargo සේවා.",
      "Transco Cargo Sydney moves everyday shipments — from family care packages to household goods — between Australia and two destinations: Sri Lanka and India. Boxes are handed over at our Sydney warehouse and tracked through to pickup or door delivery at the other end.": "Transco Cargo Sydney ඕස්ට්‍රේලියාව සහ ගමනාන්ත දෙකක් — ශ්‍රී ලංකාව සහ ඉන්දියාව — අතර, පවුලේ අයට යවන පාර්සල් සිට ගෘහ භාණ්ඩ දක්වා, දෛනික shipments ගෙන යනවා. පෙට්ටි අපේ Sydney warehouse එකේ භාර දී, අනෙක් පැත්තේ pickup හෝ door delivery දක්වා track කරනවා.",
      "We keep pricing simple and fixed by box, not by complicated per-kilogram calculations, and Transco Agent is here to answer pricing, tracking, and booking questions directly — in English, Sinhala, or Tamil — with our team just a call or WhatsApp message away for anything it can't handle.": "අපි මිල ගණන් සරලව, සංකීර්ණ කිලෝ ගණන් නොවී පෙට්ටිය අනුව ස්ථාවරව තියනවා. Transco Agent මිල, tracking සහ booking ප්‍රශ්නවලට ඉංග්‍රීසි, සිංහල හෝ දෙමළෙන් කෙලින්ම පිළිතුරු දෙනවා — එයට බැරි දේකට අපේ කණ්ඩායම call එකක් හෝ WhatsApp පණිවිඩයක් දුරින්.",
      "Years of experience": "අවුරුදු පළපුරුද්ද",
      "Destinations served": "සේවා දෙන ගමනාන්ත",
      "Sri Lanka & India": "ශ්‍රී ලංකාව සහ ඉන්දියාව",
      "Fixed, transparent pricing": "ස්ථාවර, විනිවිද පෙනෙන මිල ගණන්",
      "Rates set by box and destination zone, not a black box — you know the price before you commit.": "පෙට්ටිය සහ ගමනාන්ත zone අනුව මිල — කලින්ම ඔබ මිල දන්නවා.",
      "Answers in your language": "ඔබේ භාෂාවෙන් පිළිතුරු",
      "Transco Agent and our team work in English, Sinhala, and Tamil, on WhatsApp or the website.": "Transco Agent සහ අපේ කණ්ඩායම WhatsApp හෝ website එකේ ඉංග්‍රීසි, සිංහල සහ දෙමළෙන් වැඩ කරනවා.",
      "Pickup or door delivery": "Pickup හෝ door delivery",
      "Collect from our warehouse yourself, or have it delivered — whichever suits the receiver best.": "අපේ warehouse එකෙන් ඔබම ගන්න, නැත්නම් ගෙනත් දෙන්න — ලබන්නාට වඩාත් ගැලපෙන විදිය.",
      "A real team behind the bot": "Bot පිටුපස සැබෑ කණ්ඩායමක්",
      "Transco Agent hands off to our staff the moment something needs a human touch.": "මිනිස් උදව්වක් ඕන වෙන මොහොතේම Transco Agent අපේ කාර්ය මණ්ඩලයට භාර දෙනවා.",
      "Questions about your shipment?": "ඔබේ shipment එක ගැන ප්‍රශ්න තියෙනවද?",
      "Transco Agent can give you a real price right now.": "Transco Agent ට දැන්ම ඔබට සැබෑ මිලක් දෙන්න පුළුවන්.",

      // contact
      "Get in touch": "සම්බන්ධ වන්න",
      "Call us directly, message us on WhatsApp, or just ask Transco Agent — whichever's easiest.": "අපට කෙලින්ම call කරන්න, WhatsApp පණිවිඩයක් එවන්න, නැත්නම් Transco Agent ගෙන් අහන්න — ඔබට ලේසි විදිය.",
      "Prefer to just ask?": "නිකන්ම අහන්න කැමතිද?",
      "Transco Agent can answer pricing, tracking, and booking questions right now — no waiting for a callback.": "Transco Agent ට මිල, tracking සහ booking ප්‍රශ්නවලට දැන්ම පිළිතුරු දෙන්න පුළුවන් — callback එකක් එනකම් ඉන්න ඕන නෑ.",
      "💬 WhatsApp": "💬 WhatsApp",
      "Call Us": "අපට call කරන්න",
      "Visit Us": "අප වෙත එන්න",
      "Online": "Online",
      "Business hours": "ව්‍යාපාරික වේලාවන්",

      // questions the chat buttons send (the bot replies in the same language)
      "How much for warehouse pickup?": "Warehouse pickup වලට කීයද?",
      "How much for door delivery?": "Door delivery වලට කීයද?",
      "What is your shipping schedule?": "ඔබේ shipping කාලසටහන මොකක්ද?",
      "I'd like to talk to a staff member": "මට කාර්ය මණ්ඩල සාමාජිකයෙක් සමඟ කතා කරන්න ඕන",
      "I want a price quote": "මට මිලක් ඕන",
      "Which box should I use for my items?": "මගේ භාණ්ඩ වලට පාවිච්චි කරන්න ඕන කුමන පෙට්ටියද?",
      "What items can I not send?": "මට යවන්න බැරි භාණ්ඩ මොනවද?",
      "When is the next Air Freight shipment?": "ඊළඟ Air Freight shipment එක කවදාද?",
      "I want to track my shipment": "මට මගේ shipment එක track කරන්න ඕන",
      "Send me the Declaration Form": "මට Declaration Form එක එවන්න"
    },

    ta: {
      "Chat with Transco Agent": "Transco Agent உடன் chat செய்யுங்கள்",
      "Sri Lanka": "இலங்கை",
      "India": "இந்தியா",
      "Box Info": "பெட்டி விவரம்",
      "About": "எங்களைப் பற்றி",
      "Contact": "தொடர்பு",
      "Open menu": "மெனுவைத் திற",
      "Navigation": "வழிசெலுத்தல்",
      "Sydney → Sri Lanka": "Sydney → இலங்கை",
      "Sydney → India": "Sydney → இந்தியா",
      "Fast, reliable, and secure cargo services from Australia to Sri Lanka and India. Your goods, our commitment.": "அவுஸ்திரேலியாவிலிருந்து இலங்கை மற்றும் இந்தியாவுக்கு வேகமான, நம்பகமான, பாதுகாப்பான cargo சேவைகள். உங்கள் பொருட்கள், எங்கள் அர்ப்பணிப்பு.",
      "© 2026 Transco Cargo Sydney. All rights reserved.": "© 2026 Transco Cargo Sydney. அனைத்து உரிமைகளும் பாதுகாக்கப்பட்டவை.",
      "Transco Agent": "Transco Agent",

      "Get instant shipping information, quotes and pickup assistance through our AI-powered Transco Agent.": "எங்கள் AI இயக்கும் Transco Agent மூலம் shipping தகவல், விலை மதிப்பீடுகள் மற்றும் pickup உதவியை உடனடியாகப் பெறுங்கள்.",
      "Ship to Sri Lanka": "இலங்கைக்கு அனுப்புங்கள்",
      "Ship to India": "இந்தியாவுக்கு அனுப்புங்கள்",
      "Years Experience": "ஆண்டு அனுபவம்",
      "Destinations": "சேருமிடங்கள்",
      "AI Assistance": "AI உதவி",
      "Meet Your Bot": "உங்கள் Bot ஐச் சந்தியுங்கள்",
      "One conversation. Every answer.": "ஒரே உரையாடல். எல்லா பதில்களும்.",
      "Transco Agent handles pricing, tracking, pickup bookings and general questions — in English, Sinhala or Tamil — and hands off to our real team the moment something needs a human.": "Transco Agent விலை, tracking, pickup bookings மற்றும் பொதுக் கேள்விகளை ஆங்கிலம், சிங்களம் அல்லது தமிழில் கையாள்கிறது — மனிதர் தேவைப்படும் அந்த நொடியே எங்கள் உண்மையான குழுவிடம் ஒப்படைக்கிறது.",
      "Ask anything below — pricing, tracking, pickup bookings, or just say hi.": "கீழே எதையும் கேளுங்கள் — விலை, tracking, pickup bookings, அல்லது hi சொல்லுங்கள்.",
      "💰 Get a Price Quote": "💰 விலை மதிப்பீடு பெறுங்கள்",
      "📦 Track a Shipment": "📦 Shipment ஐ track செய்யுங்கள்",
      "🗓️ Shipping Calendar": "🗓️ Shipping நாட்காட்டி",
      "📋 Declaration Form": "📋 Declaration form",
      "🇱🇰 Shipping to Sri Lanka": "🇱🇰 இலங்கைக்கு அனுப்புகிறேன்",
      "🇮🇳 Shipping to India": "🇮🇳 இந்தியாவுக்கு அனுப்புகிறேன்",
      "Sign in to see your bookings & shipments": "உங்கள் bookings மற்றும் shipments பார்க்க sign in செய்யுங்கள்",
      "Sign in": "Sign in",
      "Prefer WhatsApp? Chat there instead": "WhatsApp விருப்பமா? அங்கே chat செய்யுங்கள்",
      "English · සිංහල · தமிழ்": "English · සිංහල · தமிழ்",
      "How can I help you today?": "இன்று நான் உங்களுக்கு எப்படி உதவலாம்?",
      "Type your question": "உங்கள் கேள்வியை type செய்யுங்கள்",
      "Type your question…": "உங்கள் கேள்வியை type செய்யுங்கள்…",
      "Type your question...": "உங்கள் கேள்வியை type செய்யுங்கள்...",
      "Send": "அனுப்பு",
      "Close chat": "Chat ஐ மூடு",
      "Shipping Calculator": "Shipping கணக்கி",
      "Track a Shipment": "Shipment ஐ track செய்யுங்கள்",
      "Shipping Calendar": "Shipping நாட்காட்டி",
      "Declaration Form": "Declaration form",
      "Shipping to Sri Lanka": "இலங்கைக்கு அனுப்புதல்",
      "Shipping to India": "இந்தியாவுக்கு அனுப்புதல்",
      "Our Services": "எங்கள் சேவைகள்",
      "Where we ship, and how": "நாங்கள் எங்கே, எப்படி அனுப்புகிறோம்",
      "Shipping services": "Shipping சேவைகள்",
      "Sea Freight": "Sea Freight",
      "Air Freight": "Air Freight",
      "See Sri Lanka pricing →": "இலங்கை விலைகளைப் பாருங்கள் →",
      "General Cargo Shipping": "General Cargo shipping",
      "See India pricing →": "இந்திய விலைகளைப் பாருங்கள் →",
      "Get a price": "விலை பெறுங்கள்",
      "Track a shipment": "Shipment ஐ track செய்யுங்கள்",
      "Shipping calendar": "Shipping நாட்காட்டி",
      "Declaration form": "Declaration form",
      "Track my shipment": "என் shipment ஐ track செய்",
      "My bookings": "என் bookings",
      "New booking": "புதிய booking",
      "Book": "Book செய்யுங்கள்",
      "Book a drop-off for this shipment": "இந்த shipment க்கு drop-off ஒன்றை book செய்யுங்கள்",
      "Make a booking": "Booking செய்யுங்கள்",
      "My BL number": "என் BL எண்",
      "Declaration status": "Declaration நிலை",
      "Your chat is still open": "உங்கள் chat இன்னும் திறந்திருக்கிறது",
      "Continue chat": "Chat ஐத் தொடருங்கள்",
      "Promotional flyer": "Promotion flyer",
      "Sorry, something went wrong. Please try again in a moment.": "மன்னிக்கவும், ஏதோ தவறு நடந்தது. சிறிது நேரத்தில் மீண்டும் முயற்சிக்கவும்.",
      "Sorry, something went wrong. Please try again.": "மன்னிக்கவும், ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.",
      "A staff member will be with you shortly.": "எங்கள் ஊழியர் ஒருவர் விரைவில் உங்களுடன் இணைவார்.",
      "Sorry, I couldn't reach our server. Please check your connection and try again.": "மன்னிக்கவும், server ஐ அடைய முடியவில்லை. உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
      "Sorry, I couldn't reach our server. Please check your connection.": "மன்னிக்கவும், server ஐ அடைய முடியவில்லை. உங்கள் இணைப்பைச் சரிபார்க்கவும்.",

      "Sri Lanka shipments": "இலங்கை shipments",
      "Fixed box rates, not per-kg — pick up from our Wattala warehouse or have it delivered anywhere island-wide.": "Kg கணக்கில் அல்ல, பெட்டிக்கு நிலையான விலை — எங்கள் Wattala warehouse இல் பெற்றுக்கொள்ளுங்கள், அல்லது தீவு முழுவதும் எங்கும் விநியோகம் பெறுங்கள்.",
      "Hand your boxes over in Sydney by the date on the left to make that shipment.": "அந்த shipment இல் செல்ல, இடதுபுறம் உள்ள தேதிக்குள் Sydney இல் உங்கள் பெட்டிகளை ஒப்படையுங்கள்.",
      "🚢 Sea freight": "🚢 Sea freight",
      "✈️ Air freight": "✈️ Air freight",
      "Freight type": "Freight வகை",
      "Box prices": "பெட்டி விலைகள்",
      "Per box, sea freight, collected from our Wattala warehouse.": "ஒரு பெட்டிக்கு, sea freight, எங்கள் Wattala warehouse இல் பெற்றுக்கொள்ளும்போது.",
      "Max 20kg": "அதிகபட்சம் 20kg",
      "Max 30kg": "அதிகபட்சம் 30kg",
      "Max 50kg": "அதிகபட்சம் 50kg",
      "Most Popular": "மிகவும் பிரபலம்",
      "Compare box sizes →": "பெட்டி அளவுகளை ஒப்பிடுங்கள் →",
      "Pickup from Wattala Warehouse": "Wattala Warehouse இல் பெற்றுக்கொள்ளல்",
      "The cheaper option — the receiver collects the box(es) themselves.": "மலிவான தெரிவு — பெறுநரே பெட்டிகளைப் பெற்றுக்கொள்வார்.",
      "Boxes": "பெட்டிகள்",
      "Weight": "எடை",
      "Price": "விலை",
      "1 Box": "1 பெட்டி",
      "2 Boxes": "2 பெட்டிகள்",
      "3 Boxes": "3 பெட்டிகள்",
      "1 Box:": "1 பெட்டி:",
      "2 Boxes:": "2 பெட்டிகள்:",
      "3 Boxes:": "3 பெட்டிகள்:",
      "Door Delivery": "Door delivery",
      "Priced by zone — road distance from Colombo Fort.": "Zone அடிப்படையில் விலை — கொழும்பு கோட்டையிலிருந்து சாலை தூரம்.",
      "Zone 1 — Up to 20km from Colombo Fort": "Zone 1 — கொழும்பு கோட்டையிலிருந்து 20km வரை",
      "Zone 2 — 21–100km from Colombo Fort": "Zone 2 — கொழும்பு கோட்டையிலிருந்து 21–100km",
      "Zone 3 — Over 100km from Colombo Fort": "Zone 3 — கொழும்பு கோட்டையிலிருந்து 100km க்கு மேல்",
      "e.g. Moratuwa, Pannipitiya, Kaduwela, Ja-Ela": "உதா: Moratuwa, Pannipitiya, Kaduwela, Ja-Ela",
      "e.g. Kurunegala, Gampola, Hatton, Ambalangoda": "உதா: Kurunegala, Gampola, Hatton, Ambalangoda",
      "e.g. Jaffna, Vavuniya, Kandy, Batticaloa, Hambantota": "உதா: Jaffna, Vavuniya, Kandy, Batticaloa, Hambantota",
      "Good to know": "தெரிந்துகொள்ள வேண்டியவை",
      "Worth checking before you drop off.": "பெட்டிகளைக் கொண்டுவருவதற்கு முன் பார்க்க வேண்டியவை.",
      "Ask about Sri Lanka shipping": "இலங்கை shipping பற்றிக் கேளுங்கள்",
      "Ask anything, or try:": "எதையும் கேளுங்கள், அல்லது:",
      "🏭 Warehouse Pickup Price": "🏭 Warehouse pickup விலை",
      "🚚 Door Delivery Zones": "🚚 Door delivery zones",
      "📅 Shipping Schedule": "📅 Shipping அட்டவணை",
      "👤 Talk to Our Team": "👤 எங்கள் குழுவுடன் பேசுங்கள்",
      "Transco Agent chat": "Transco Agent chat",
      "Hand over by": "ஒப்படைக்க வேண்டிய தேதி",
      "Arrives Colombo (est.)": "கொழும்பு வந்தடையும் (மதிப்பீடு)",
      "Arrives India (est.)": "இந்தியா வந்தடையும் (மதிப்பீடு)",
      "Next": "அடுத்தது",
      "To be confirmed": "இன்னும் உறுதிப்படுத்தப்படவில்லை",
      "Next sea freight dates are being confirmed": "அடுத்த sea freight தேதிகள் உறுதிப்படுத்தப்படுகின்றன",
      "Next air freight dates are being confirmed": "அடுத்த air freight தேதிகள் உறுதிப்படுத்தப்படுகின்றன",
      "Ask us and we'll tell you the next hand-over date.": "எங்களிடம் கேளுங்கள், அடுத்த ஒப்படைப்புத் தேதியைச் சொல்வோம்.",
      "Ask for the next date": "அடுத்த தேதியைக் கேளுங்கள்",
      "Hand your boxes over in Sydney by the cutoff date. Arrival dates are estimates.": "Cutoff தேதிக்குள் Sydney இல் உங்கள் பெட்டிகளை ஒப்படையுங்கள். வந்தடையும் தேதிகள் மதிப்பீடுகள் மட்டுமே.",
      "Delivery to your home anywhere in Sri Lanka": "இலங்கையில் எங்கும் உங்கள் வீட்டுக்கே விநியோகம்",
      "Delivery to your home anywhere in India": "இந்தியாவில் எங்கும் உங்கள் வீட்டுக்கே விநியோகம்",
      "Got an odd-sized item? Check here": "வழக்கத்துக்கு மாறான அளவில் பொருள் உள்ளதா? இங்கே பாருங்கள்",
      "Custom-sized box, TV, bicycle or anything else — ask here.": "தனி அளவுப் பெட்டி, TV, சைக்கிள் அல்லது வேறு எதுவாக இருந்தாலும் — இங்கே கேளுங்கள்.",
      "Custom size box": "தனி அளவுப் பெட்டி",
      "TV": "TV",
      "Bicycle": "சைக்கிள்",
      "Something else": "வேறு ஏதாவது",
      "I have a custom-sized box. How much would it cost to send it to Sri Lanka?": "என்னிடம் தனி அளவுப் பெட்டி ஒன்று உள்ளது. அதை இலங்கைக்கு அனுப்ப எவ்வளவு செலவாகும்?",
      "How much does it cost to send a TV to Sri Lanka?": "ஒரு TV யை இலங்கைக்கு அனுப்ப எவ்வளவு செலவாகும்?",
      "How much does it cost to send a bicycle to Sri Lanka?": "ஒரு சைக்கிளை இலங்கைக்கு அனுப்ப எவ்வளவு செலவாகும்?",
      "I have an odd-sized item to send to Sri Lanka.": "இலங்கைக்கு அனுப்ப வழக்கத்துக்கு மாறான அளவில் ஒரு பொருள் என்னிடம் உள்ளது.",
      "Next cutoff": "அடுத்த cutoff",
      "Upcoming": "வரவிருப்பவை",
      "Sea freight": "Sea freight",
      "Air freight": "Air freight",
      "Next dates are being confirmed": "அடுத்த தேதிகள் உறுதிப்படுத்தப்படுகின்றன",
      "Couldn't load the dates right now": "இப்போது தேதிகளை load செய்ய முடியவில்லை",
      "India shipments": "இந்திய shipments",
      "Flat-rate pricing by box type — pickup from our Seven Hills location or door delivery, at the same price either way.": "பெட்டி வகைக்கு flat-rate விலை — எங்கள் Seven Hills இடத்தில் பெற்றுக்கொள்ளுங்கள் அல்லது door delivery, இரண்டுக்கும் ஒரே விலை.",
      "Flat rate from Seven Hills — the same price for pickup or door delivery, anywhere in India.": "Seven Hills இலிருந்து flat rate — இந்தியாவில் எங்கும் pickup அல்லது door delivery க்கு ஒரே விலை.",
      "General cargo box": "General cargo box",
      "· up to 30kg each": "· ஒவ்வொன்றும் 30kg வரை",
      "Best Value": "சிறந்த மதிப்பு",
      "Tea Chest or Quarter CBM": "Tea Chest அல்லது Quarter CBM",
      "· up to 50kg each, same price": "· ஒவ்வொன்றும் 50kg வரை, ஒரே விலை",
      "India's setup is simpler than Sri Lanka's, on purpose — but a couple of things are worth being upfront about.": "இந்தியாவின் முறை வேண்டுமென்றே இலங்கையைவிட எளிமையானது — ஆனால் முன்கூட்டியே சொல்ல வேண்டிய சில விஷயங்கள் உள்ளன.",
      "Ask about India shipping": "இந்திய shipping பற்றிக் கேளுங்கள்",
      "🧮 Get a Price Quote": "🧮 விலை மதிப்பீடு பெறுங்கள்",
      "🏭 Seven Hills Pickup": "🏭 Seven Hills pickup",
      "🚚 Door Delivery": "🚚 Door delivery",

      "Box sizes & prices": "பெட்டி அளவுகள் மற்றும் விலைகள்",
      "Compare every box by size, weight limit and price — then pick the one that fits what you're sending.": "ஒவ்வொரு பெட்டியையும் அளவு, எடை வரம்பு மற்றும் விலையால் ஒப்பிடுங்கள் — நீங்கள் அனுப்புவதற்குப் பொருந்துவதைத் தேர்ந்தெடுங்கள்.",
      "Which box fits?": "எந்தப் பெட்டி பொருந்தும்?",
      "Smallest to largest. Price is per box, sea freight.": "சிறியதிலிருந்து பெரியது வரை. விலை ஒரு பெட்டிக்கு, sea freight.",
      "Box & size": "பெட்டி மற்றும் அளவு",
      "🇱🇰 Sri Lanka": "🇱🇰 இலங்கை",
      "🇮🇳 India": "🇮🇳 இந்தியா",
      "Ask us": "எங்களிடம் கேளுங்கள்",
      "🇱🇰 Sri Lanka prices & dates": "🇱🇰 இலங்கை விலைகள் மற்றும் தேதிகள்",
      "🇮🇳 India prices & dates": "🇮🇳 இந்திய விலைகள் மற்றும் தேதிகள்",
      "Ask about boxes & prices": "பெட்டிகள் மற்றும் விலைகள் பற்றிக் கேளுங்கள்",
      "📦 Which Box Should I Use?": "📦 நான் எந்தப் பெட்டியைப் பயன்படுத்த வேண்டும்?",
      "🚫 What Can't I Send?": "🚫 நான் எதை அனுப்ப முடியாது?",

      "Your trusted cargo service partner": "நீங்கள் நம்பும் cargo சேவைப் பங்காளர்",
      "Fast, reliable, and secure cargo services from Australia to Sri Lanka and India.": "அவுஸ்திரேலியாவிலிருந்து இலங்கை மற்றும் இந்தியாவுக்கு வேகமான, நம்பகமான, பாதுகாப்பான cargo சேவைகள்.",
      "Transco Cargo Sydney moves everyday shipments — from family care packages to household goods — between Australia and two destinations: Sri Lanka and India. Boxes are handed over at our Sydney warehouse and tracked through to pickup or door delivery at the other end.": "Transco Cargo Sydney அவுஸ்திரேலியாவுக்கும் இரண்டு சேருமிடங்களுக்கும் — இலங்கை மற்றும் இந்தியா — இடையே, குடும்பப் பொதிகள் முதல் வீட்டுப் பொருட்கள் வரை அன்றாட shipments ஐ எடுத்துச் செல்கிறது. பெட்டிகள் எங்கள் Sydney warehouse இல் ஒப்படைக்கப்பட்டு, மறுமுனையில் pickup அல்லது door delivery வரை track செய்யப்படுகின்றன.",
      "We keep pricing simple and fixed by box, not by complicated per-kilogram calculations, and Transco Agent is here to answer pricing, tracking, and booking questions directly — in English, Sinhala, or Tamil — with our team just a call or WhatsApp message away for anything it can't handle.": "சிக்கலான கிலோ கணக்குகள் இல்லாமல், பெட்டிக்கு நிலையான எளிய விலைகளை வைத்திருக்கிறோம். Transco Agent விலை, tracking மற்றும் booking கேள்விகளுக்கு ஆங்கிலம், சிங்களம் அல்லது தமிழில் நேரடியாகப் பதிலளிக்கிறது — அதனால் முடியாதவற்றுக்கு எங்கள் குழு ஒரு call அல்லது WhatsApp செய்தி தூரத்தில்.",
      "Years of experience": "ஆண்டு அனுபவம்",
      "Destinations served": "சேவை வழங்கும் சேருமிடங்கள்",
      "Sri Lanka & India": "இலங்கை மற்றும் இந்தியா",
      "Fixed, transparent pricing": "நிலையான, வெளிப்படையான விலைகள்",
      "Rates set by box and destination zone, not a black box — you know the price before you commit.": "பெட்டி மற்றும் சேருமிட zone அடிப்படையில் விலைகள் — உறுதிசெய்வதற்கு முன்பே விலை உங்களுக்குத் தெரியும்.",
      "Answers in your language": "உங்கள் மொழியில் பதில்கள்",
      "Transco Agent and our team work in English, Sinhala, and Tamil, on WhatsApp or the website.": "Transco Agent மற்றும் எங்கள் குழு WhatsApp அல்லது website இல் ஆங்கிலம், சிங்களம், தமிழில் செயல்படுகிறது.",
      "Pickup or door delivery": "Pickup அல்லது door delivery",
      "Collect from our warehouse yourself, or have it delivered — whichever suits the receiver best.": "எங்கள் warehouse இல் நீங்களே பெற்றுக்கொள்ளுங்கள், அல்லது விநியோகம் பெறுங்கள் — பெறுநருக்கு எது வசதியோ அது.",
      "A real team behind the bot": "Bot க்குப் பின்னால் உண்மையான குழு",
      "Transco Agent hands off to our staff the moment something needs a human touch.": "மனித உதவி தேவைப்படும் அந்த நொடியே Transco Agent எங்கள் ஊழியர்களிடம் ஒப்படைக்கிறது.",
      "Questions about your shipment?": "உங்கள் shipment பற்றிக் கேள்விகளா?",
      "Transco Agent can give you a real price right now.": "Transco Agent இப்போதே உங்களுக்கு உண்மையான விலையைத் தர முடியும்.",

      "Get in touch": "தொடர்பு கொள்ளுங்கள்",
      "Call us directly, message us on WhatsApp, or just ask Transco Agent — whichever's easiest.": "எங்களை நேரடியாக அழையுங்கள், WhatsApp இல் செய்தி அனுப்புங்கள், அல்லது Transco Agent இடம் கேளுங்கள் — எது எளிதோ அது.",
      "Prefer to just ask?": "வெறுமனே கேட்க விருப்பமா?",
      "Transco Agent can answer pricing, tracking, and booking questions right now — no waiting for a callback.": "Transco Agent விலை, tracking, booking கேள்விகளுக்கு இப்போதே பதிலளிக்கும் — callback க்காகக் காத்திருக்க வேண்டாம்.",
      "💬 WhatsApp": "💬 WhatsApp",
      "Call Us": "எங்களை அழையுங்கள்",
      "Visit Us": "எங்களிடம் வாருங்கள்",
      "Online": "Online",
      "Business hours": "வணிக நேரம்",

      "How much for warehouse pickup?": "Warehouse pickup க்கு எவ்வளவு?",
      "How much for door delivery?": "Door delivery க்கு எவ்வளவு?",
      "What is your shipping schedule?": "உங்கள் shipping அட்டவணை என்ன?",
      "I'd like to talk to a staff member": "நான் ஊழியர் ஒருவருடன் பேச விரும்புகிறேன்",
      "I want a price quote": "எனக்கு விலை மதிப்பீடு வேண்டும்",
      "Which box should I use for my items?": "என் பொருட்களுக்கு எந்தப் பெட்டியைப் பயன்படுத்த வேண்டும்?",
      "What items can I not send?": "நான் அனுப்ப முடியாத பொருட்கள் எவை?",
      "When is the next Air Freight shipment?": "அடுத்த Air Freight shipment எப்போது?",
      "I want to track my shipment": "நான் என் shipment ஐ track செய்ய வேண்டும்",
      "Send me the Declaration Form": "எனக்கு Declaration Form ஐ அனுப்புங்கள்"
    }
  };

  // Text built from pieces in code ("up to 30kg", "≈ 116 litres", …).
  var PATTERNS = [
    [/^up to (\d+)kg$/, { si: "$1kg දක්වා", ta: "$1kg வரை" }],
    [/^≈ (\d+) litres$/, { si: "≈ ලීටර් $1", ta: "≈ $1 லிட்டர்" }],
    [/^Hi (.+)! How can I help\?$/, { si: "ආයුබෝවන් $1! මම කොහොමද උදව් කරන්නේ?", ta: "வணக்கம் $1! நான் எப்படி உதவலாம்?" }],
    [/^(\d+) × (.+)$/, { si: "$1 × $2", ta: "$1 × $2" }]
  ];

  // ---------------------------------------------------------------
  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return LANGS.indexOf(v) >= 0 ? v : "en";
    } catch (e) {
      return "en";
    }
  }
  var lang = read();

  function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

  function lookup(en) {
    if (lang === "en") return en;
    var k = norm(en);
    var d = DICT[lang];
    if (d && Object.prototype.hasOwnProperty.call(d, k)) return d[k];
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i][0].test(k)) return k.replace(PATTERNS[i][0], PATTERNS[i][1][lang]);
    }
    return null;
  }

  // Never translate the conversation itself.
  var SKIP = "script, style, [data-no-i18n], #ta-messages, #cs-messages, .cs-msg, .ta-msg, .ta-bubble, textarea";
  function skipped(el) { return !el || (el.closest && el.closest(SKIP)); }

  var textOrig = new WeakMap(); // text node -> { en, shown }
  function doText(node) {
    var el = node.parentElement;
    if (skipped(el)) return;
    var rec = textOrig.get(node);
    if (!rec || rec.shown !== node.nodeValue) rec = { en: node.nodeValue, shown: null }; // new or changed by page code
    if (!/[A-Za-z]/.test(rec.en)) return;
    var out = rec.en;
    if (lang !== "en") {
      var t = lookup(rec.en);
      if (t != null) out = (rec.en.match(/^\s*/)[0]) + t + (rec.en.match(/\s*$/)[0]);
    }
    rec.shown = out;
    textOrig.set(node, rec);
    if (node.nodeValue !== out) node.nodeValue = out;
  }

  var ATTRS = ["placeholder", "aria-label", "title"];
  var attrOrig = new WeakMap(); // element -> { attr: { en, shown } }
  function doAttrs(el) {
    if (skipped(el)) return;
    var map = attrOrig.get(el) || {};
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a);
      var rec = map[a];
      if (!rec || rec.shown !== cur) rec = { en: cur, shown: null };
      var out = lang === "en" ? rec.en : (lookup(rec.en) || rec.en);
      rec.shown = out;
      map[a] = rec;
      if (cur !== out) el.setAttribute(a, out);
    }
    attrOrig.set(el, map);
  }

  var htmlOrig = new WeakMap(); // element -> English innerHTML
  function doHtml(el) {
    var key = el.getAttribute("data-i18n");
    if (!htmlOrig.has(el)) htmlOrig.set(el, el.innerHTML);
    var out = lang !== "en" && HTML[lang] && HTML[lang][key] ? HTML[lang][key] : htmlOrig.get(el);
    if (el.innerHTML !== out) el.innerHTML = out;
  }

  var applying = false;
  function apply(root) {
    if (!root) return;
    applying = true;
    try {
      if (root.nodeType === 3) { doText(root); return; }
      if (root.nodeType !== 1) return;
      var htmlEls = root.matches && root.matches("[data-i18n]") ? [root] : [];
      htmlEls = htmlEls.concat([].slice.call(root.querySelectorAll("[data-i18n]")));
      htmlEls.forEach(doHtml);
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        if (n.parentElement && n.parentElement.closest("[data-i18n]")) continue;
        doText(n);
      }
      if (root.matches) doAttrs(root);
      [].slice.call(root.querySelectorAll("[placeholder], [aria-label], [title]")).forEach(doAttrs);
    } finally {
      applying = false;
    }
  }

  function setLang(next) {
    if (LANGS.indexOf(next) < 0) return;
    lang = next;
    try { localStorage.setItem(KEY, next); } catch (e) {}
    document.documentElement.lang = next;
    apply(document.body);
    syncSwitches();
    try { window.dispatchEvent(new CustomEvent("transco:lang", { detail: { lang: next } })); } catch (e) {}
  }

  function syncSwitches() {
    [].slice.call(document.querySelectorAll("[data-lang-option]")).forEach(function (b) {
      var on = b.getAttribute("data-lang-option") === lang;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("active", on);
    });
  }

  window.TranscoI18n = {
    get lang() { return lang; },
    set: setLang,
    /** Translate one English string (returns it unchanged in English or if unknown). */
    t: function (en) { return lang === "en" ? en : (lookup(en) || en); },
    locale: function () { return LOCALES[lang] || "en-AU"; }
  };

  // Sinhala/Tamil words run longer than English: keep the top menu on one
  // line with slightly tighter spacing instead of wrapping.
  function addStyles() {
    var css =
      'html[lang="si"] .nav-links a, html[lang="ta"] .nav-links a { white-space: nowrap; }' +
      'html[lang="si"] .nav-links, html[lang="ta"] .nav-links { gap: 16px; font-size: 13px; }' +
      'html[lang="ta"] .nav-brand { white-space: nowrap; }';
    var el = document.createElement("style");
    el.setAttribute("data-i18n-style", "");
    el.textContent = css;
    document.head.appendChild(el);
  }

  function start() {
    addStyles();
    document.documentElement.lang = lang;
    [].slice.call(document.querySelectorAll("[data-lang-option]")).forEach(function (b) {
      b.addEventListener("click", function () { setLang(b.getAttribute("data-lang-option")); });
    });
    syncSwitches();
    if (lang !== "en") apply(document.body);
    // Text the page adds later (chat buttons, calendar, box list…).
    new MutationObserver(function (records) {
      if (applying || lang === "en") return;
      records.forEach(function (r) {
        if (r.type === "childList") r.addedNodes.forEach(apply);
        else if (r.type === "attributes") apply(r.target);
        else if (r.type === "characterData") doText(r.target);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
