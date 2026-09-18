// ============================================================
// WEBSITE CHAT WIDGET — POST /api/web-chat
// ============================================================
//
// Fully additive and isolated from the WhatsApp flow: separate
// customer-lookup function (findOrCreateWebCustomer, keyed by a
// browser-generated sessionId instead of a phone number), and its own
// copy of the marker-stripping logic instead of reusing
// sendAndTrackOutbound (which is tightly coupled to sending an actual
// WhatsApp message). Nothing in this file is imported by, or modifies,
// anything on the WhatsApp path.
//
// Reused as-is from server.js (passed in, not re-implemented):
// getFlowiseReply, saveMessage, markNeedsAttention,
// broadcastMessageCreated, broadcast — all already channel-agnostic.
// The six menu item arrays (WELCOME_MENU_ITEMS etc.) are also passed
// in from server.js rather than duplicated here, so a menu edited on
// the WhatsApp side (new item, changed phrase) never drifts out of
// sync with what the website offers.

const express = require('express');
const { customers, bookings } = require('./db');

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
const BOOK_DROPOFF_RE = /^\[\[BOOK_DROPOFF:day=([a-z]+);time=([0-9:]+)(?:;date=([0-9-]*))?(?:;boxes=([^;\]]*))?(?:;name=([^;\]]*))?(?:;phone=([^;\]]*))?\]\]/i;
const SET_NAME_RE = /^\[\[SET_NAME:([^\]]+)\]\]/;

// Shown once, prepended to a brand-new visitor's real answer when
// their very first message is itself a real question rather than a
// greeting (a plain "hi" already gets the full greeting on its own,
// via the SHOW_MENU_MARKER branch below). Kept in sync by hand with
// request_type=7 in the Flowise tool — deliberately duplicated rather
// than triggered by a second, synthetic Flowise call, which would
// pollute that customer's conversation memory with a "hi" they never
// actually sent. Ends without "How can I help you today?", since the
// real answer follows immediately in the same message.
const WEB_GREETING_TEXT =
  "👋 *Welcome to Transco Cargo Sydney!*\n\n" +
  "I'm your dedicated Transco Cargo agent, here to make shipping to Sri Lanka.\n\n" +
  "📦 Shipping & Pricing\n" +
  "🔎 Shipment Tracking\n" +
  "🕐 Opening Hours & Bookings\n" +
  "🚚 Shipping Information\n\n" +
  "💬 Happy to chat in English, සිංහල, or தமிழ் — just write in whichever you're comfortable with.\n\n" +
  "🎉 *Current Promotion:* Send 2 boxes and get the 3rd one FREE! (Sea Freight only)\n\n" +
  "🌐 Website: https://transcosydney.com.au/\n" +
  "📋 Declaration Form: https://transcosydney.com.au/declaration-form";

// One "customer" document per website visitor session. Separate query
// shape (sessionId, not phoneNumber) so this can never collide with or
// be picked up by any WhatsApp-side lookup.
//
// phoneNumber is set to the sessionId itself, NOT null. The customers
// collection has a UNIQUE index on phoneNumber (for WhatsApp numbers),
// and a plain (non-sparse) unique index treats every null the same —
// so a literal null here would let only the very first web visitor
// ever be created; every visitor after that would collide with it and
// fail outright. sessionId is already guaranteed unique per browser
// (see getSessionId() in web-chat-widget.html) and already reads
// clearly as "not a real phone number", so it doubles as a safe,
// collision-free placeholder without needing any database migration.
async function findOrCreateWebCustomer(sessionId) {
  // A short, readable tag so staff can tell different visitors apart
  // in the console instead of seeing an identical "Website Visitor"
  // for everyone. Taken from the end of sessionId, which is always
  // "web-<timestamp>-<random>" (see getSessionId() in
  // web-chat-widget.html) — the last 4 characters always fall within
  // the random part, never the timestamp, so this stays readable and
  // effectively unique per browser. Overwritten with their real name
  // below once they complete a booking and we actually know who they
  // are (see the BOOK DROPOFF handling further down).
  const visitorTag = sessionId.slice(-4).toUpperCase();

  const result = await customers().findOneAndUpdate(
    { sessionId, channel: 'website' },
    {
      $setOnInsert: {
        sessionId,
        phoneNumber: sessionId,
        name: `Website Visitor #${visitorTag}`,
        mode: 'CHATBOT',
        channel: 'website',
        createdAt: new Date()
      }
    },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true }
  );

  return {
    customer: result.value,
    isNewCustomer: Boolean(result.lastErrorObject?.upserted)
  };
}

module.exports = function createWebChatRouter({
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
  PICKUP_DELIVERY_MENU_ITEMS
}) {
  const router = express.Router();

  // Three menu items have no real phrase to feed Flowise — same three
  // special cases the WhatsApp webhook handles by ID (see the
  // interactive-message handling in server.js). Resolving a tap here
  // mirrors that exactly: these three bypass Flowise entirely, every
  // other tapped item resolves to its phrase and flows through the
  // normal pipeline below, same as a typed message would.
  function resolveMenuTap(menuItemId) {
    if (menuItemId === 'menu_price') {
      return { bypass: 'box_type_menu', title: '💰 Get a Price Quote' };
    }
    if (menuItemId === 'qty_10plus') {
      return { bypass: 'ask_typed_quantity', title: '10 or more' };
    }
    if (menuItemId === 'menu_website') {
      return { bypass: 'website_link', title: '🌐 Our Website' };
    }

    const item =
      (WELCOME_MENU_ITEMS || []).find(i => i.id === menuItemId) ||
      (BOX_TYPE_MENU_ITEMS || []).find(i => i.id === menuItemId) ||
      (QUANTITY_MENU_ITEMS || []).find(i => i.id === menuItemId) ||
      (AIR_FREIGHT_MENU_ITEMS || []).find(i => i.id === menuItemId) ||
      (SEA_FREIGHT_MENU_ITEMS || []).find(i => i.id === menuItemId) ||
      (FREIGHT_MODE_MENU_ITEMS || []).find(i => i.id === menuItemId) ||
      (PICKUP_DELIVERY_MENU_ITEMS || []).find(i => i.id === menuItemId);

    if (!item) return null;
    return { bypass: null, title: item.title, phrase: item.phrase };
  }

  router.post('/', async (req, res) => {
    try {
      const { sessionId, message, menuItemId } = req.body || {};

      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'sessionId is required' });
      }

      // Either a typed message OR a tapped menu item id — never both,
      // never neither.
      let resolvedTap = null;
      if (menuItemId !== undefined) {
        if (typeof menuItemId !== 'string' || !menuItemId.trim()) {
          return res.status(400).json({ error: 'menuItemId must be a non-empty string' });
        }
        resolvedTap = resolveMenuTap(menuItemId.trim());
        if (!resolvedTap) {
          return res.status(400).json({ error: 'Unrecognized menuItemId' });
        }
      } else if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }

      const { customer, isNewCustomer } = await findOrCreateWebCustomer(sessionId);

      // What the customer "said", for the transcript and for staff to
      // read back later — the tapped item's readable title for a menu
      // tap (e.g. "🎁 Gift Box"), or the typed text otherwise. Mirrors
      // tappedMenuLabel || text on the WhatsApp side.
      const displayedCustomerText = resolvedTap ? resolvedTap.title : message.trim();

      const incoming = await saveMessage({
        customerId: customer._id,
        senderType: 'CUSTOMER',
        content: displayedCustomerText,
        isRead: false,
        replyToMessageId: null,
        whatsappStatus: null
      });

      await broadcastMessageCreated(customer, incoming);

      // A human already took over this session — same rule as
      // WhatsApp: don't call Flowise, let staff handle it directly via
      // the console.
      if (customer.mode !== 'CHATBOT') {
        return res.json({
          reply: null,
          handedOff: true,
          note: 'A staff member is handling this conversation.'
        });
      }

      // Maintenance Mode (website side): skip Flowise entirely and
      // send the same friendly pause notice, without flagging the
      // conversation for staff attention (they already know, they're
      // the ones who turned it on). Checks ONLY the website flag —
      // independent of the WhatsApp flag checked in server.js, so
      // staff can pause the publicly-exposed website widget without
      // silencing WhatsApp for genuine customers.
      if (await isWebsitePausedOn()) {
        const pauseMessage = await saveMessage({
          customerId: customer._id,
          senderType: 'CHATBOT',
          content: MAINTENANCE_MESSAGE,
          isRead: true,
          replyToMessageId: incoming._id,
          whatsappStatus: null
        });

        await broadcastMessageCreated(customer, pauseMessage);

        return res.json({
          reply: MAINTENANCE_MESSAGE,
          media: null,
          menu: null,
          handedOff: false
        });
      }

      // The three Flowise-bypass taps — same three special cases the
      // WhatsApp webhook short-circuits on (menu_price, qty_10plus,
      // menu_website). No AI round-trip, no booking/media handling
      // below applies to these; reply immediately and return.
      if (resolvedTap && resolvedTap.bypass) {
        let bypassReply;
        let bypassMenu = null;

        if (resolvedTap.bypass === 'box_type_menu') {
          bypassReply = '📦 What type of box are you sending?';
          bypassMenu = { items: BOX_TYPE_MENU_ITEMS };
        } else if (resolvedTap.bypass === 'ask_typed_quantity') {
          bypassReply = "No problem! Just type in the exact number of boxes you're sending (up to 30) and I'll work out the price.";
        } else {
          bypassReply = '🌐 Here\'s our website: https://transcosydney.com.au/';
        }

        const outgoing = await saveMessage({
          customerId: customer._id,
          senderType: 'CHATBOT',
          content: bypassReply,
          isRead: true,
          replyToMessageId: incoming._id,
          whatsappStatus: null
        });

        await broadcastMessageCreated(customer, outgoing);

        return res.json({
          reply: bypassReply,
          media: null,
          menu: bypassMenu,
          handedOff: false
        });
      }

      // Either the tapped item's phrase (e.g. "I'd like a price for a
      // Gift Box"), or the customer's own typed text.
      const outgoingText = resolvedTap ? resolvedTap.phrase : message.trim();

      const rawReply = await getFlowiseReply(outgoingText, sessionId);

      if (!rawReply) {
        return res.status(502).json({ error: 'No reply from assistant — please try again.' });
      }

      const needsAttention = rawReply.startsWith(HANDOFF_MARKER);
      let cleanContent = needsAttention
        ? rawReply.slice(HANDOFF_MARKER.length).trimStart()
        : rawReply;

      // The customer stated (or corrected) their real name in
      // conversation — not necessarily as part of completing a
      // booking (that case is handled separately below, in case both
      // somehow overlap). Update the console's display name right
      // away rather than leaving it as the generic "Website Visitor
      // #XXXX" tag until/unless a booking happens to go through.
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

      // Menu markers now carry real tappable options for the website
      // widget too — not just WhatsApp. SHOW_MENU/ASK_QUANTITY are
      // PREFIX markers whose accompanying text is the whole message
      // (the welcome question / the "how many boxes" question), so
      // nothing else needs stripping alongside them. The other four
      // are markers appended after an already-complete message (e.g.
      // a price quote or comparison ending in "tap an option below"),
      // so their menu is attached to that same reply instead of a
      // separate message, which is the simplest mapping onto a single
      // chat bubble with buttons underneath it.
      let menu = null;

      if (cleanContent.startsWith(SHOW_MENU_MARKER)) {
        cleanContent = cleanContent.slice(SHOW_MENU_MARKER.length).trimStart();
        menu = { items: WELCOME_MENU_ITEMS };

      } else if (cleanContent.includes(ASK_QUANTITY_MARKER)) {
        cleanContent = cleanContent.split(ASK_QUANTITY_MARKER).join('').trim();
        menu = { items: QUANTITY_MENU_ITEMS };

      } else if (cleanContent.includes(SHOW_PICKUP_DELIVERY_MENU_MARKER)) {
        cleanContent = cleanContent.split(SHOW_PICKUP_DELIVERY_MENU_MARKER).join('').trim();
        menu = { items: PICKUP_DELIVERY_MENU_ITEMS };

      } else if (isNewCustomer) {
        // A brand-new visitor whose first message was a real question,
        // not a greeting (that case is handled above) — show the
        // welcome message and the answer together as one reply, rather
        // than answering with no greeting at all. Same welcome text as
        // the SHOW_MENU_MARKER branch above, so it should carry the
        // exact same tappable menu buttons too — this was previously
        // missed, leaving a new visitor with the welcome text but no
        // way to tap through it.
        cleanContent = WEB_GREETING_TEXT + "\n\n" + cleanContent;
        menu = { items: WELCOME_MENU_ITEMS };
      }

      if (cleanContent.includes(SHOW_BOX_MENU_MARKER)) {
        cleanContent = cleanContent.split(SHOW_BOX_MENU_MARKER).join('').trim();
        menu = { items: BOX_TYPE_MENU_ITEMS };
      }
      if (cleanContent.includes(SHOW_AIR_MENU_MARKER)) {
        cleanContent = cleanContent.split(SHOW_AIR_MENU_MARKER).join('').trim();
        menu = { items: AIR_FREIGHT_MENU_ITEMS };
      }
      if (cleanContent.includes(SHOW_SEA_MENU_MARKER)) {
        cleanContent = cleanContent.split(SHOW_SEA_MENU_MARKER).join('').trim();
        menu = { items: SEA_FREIGHT_MENU_ITEMS };
      }
      if (cleanContent.includes(SHOW_FREIGHT_MODE_MENU_MARKER)) {
        cleanContent = cleanContent.split(SHOW_FREIGHT_MODE_MENU_MARKER).join('').trim();
        menu = { items: FREIGHT_MODE_MENU_ITEMS };
      }

      // Strip the booking marker so it never leaks to the customer as
      // raw text. If the customer gave a name + phone for this booking
      // (now asked for on both channels — see booking_contact_name/
      // booking_contact_phone in the system prompt), create a REAL
      // booking here, identical to the WhatsApp path: calendar sync +
      // staff email/WhatsApp notification. Only falls back to a plain
      // "flag for follow-up" (no real booking) in the rare case the
      // never-get-stuck path confirmed without contact info ever being
      // given — there's nothing to call back on in that case.
      const bookMatch = cleanContent.match(BOOK_DROPOFF_RE);
      let bookingRequested = false;
      let bookingCreated = false;

      if (bookMatch) {
        const [fullMarker, requestedDay, requestedTime, requestedDateISO, boxSummary, contactName, contactPhone] = bookMatch;
        cleanContent = cleanContent.slice(fullMarker.length).trimStart();
        bookingRequested = true;

        const finalName = contactName && contactName.trim();
        const finalPhone = contactPhone && contactPhone.trim();

        if (finalName && finalPhone) {
          const booking = {
            customerId: customer._id,
            customerName: finalName,
            phoneNumber: finalPhone,
            requestedDay: requestedDay.toLowerCase(),
            requestedTime,
            requestedDateISO: requestedDateISO || null,
            boxSummary: boxSummary ? boxSummary.trim() : null,
            channel: 'website',
            status: 'pending',
            createdAt: new Date()
          };

          // Now that we actually know who this visitor is, replace the
          // generic "Website Visitor #XXXX" tag with their real name —
          // takes effect the next time the console loads this
          // conversation (doesn't repaint an already-open chat live).
          await customers().updateOne(
            { _id: customer._id },
            { $set: { name: finalName } }
          );

          const { insertedId } = await bookings().insertOne(booking);

          broadcast('booking.created', { _id: insertedId, ...booking });

          await sendBookingEmail(booking);
          await sendStaffBookingWhatsApp(booking);

          const calendarEventId = await createCalendarEvent(booking);
          if (calendarEventId) {
            await bookings().updateOne({ _id: insertedId }, { $set: { calendarEventId } });
          }

          bookingCreated = true;
        }
      }

      // No WhatsApp-style "send a video message" equivalent for a
      // JSON reply — hand back direct media URLs instead so the widget
      // can render them inline.
      let media = null;
      if (cleanContent.includes(BOX_MEDIA_MARKER)) {
        cleanContent = cleanContent.split(BOX_MEDIA_MARKER).join('').trim();
        media = MEDIA_BASE_URL
          ? {
              videoUrl: `${MEDIA_BASE_URL}/media/BOX_Promo_video.mp4`,
              flyerUrl: `${MEDIA_BASE_URL}/media/Box_Flyer.jpg`
            }
          : null;
      } else if (cleanContent.includes(FLYER_ONLY_MARKER)) {
        cleanContent = cleanContent.split(FLYER_ONLY_MARKER).join('').trim();
        media = MEDIA_BASE_URL
          ? { flyerUrl: `${MEDIA_BASE_URL}/media/Box_Flyer.jpg` }
          : null;
      }

      // Safety net: by this point every real marker the tool can return
      // has already been matched and handled above. Anything still
      // shaped like [[SOMETHING]] here is either a marker the LLM
      // hallucinated on its own (has happened — e.g. a made-up
      // [[ASK_DESTINATION]] that isn't one this system defines) or a
      // typo in a real one — either way it must never reach the
      // customer as visible bracket text.
      if (/\[\[[^\]]*\]\]/.test(cleanContent)) {
        console.warn('Unrecognized [[...]] marker in web chat reply, stripping before send:', cleanContent);
        cleanContent = cleanContent.replace(/\[\[[^\]]*\]\]/g, '').trim();
      }

      const outgoing = await saveMessage({
        customerId: customer._id,
        senderType: 'CHATBOT',
        content: cleanContent || '📦',
        isRead: true,
        replyToMessageId: incoming._id,
        whatsappStatus: null
      });

      await broadcastMessageCreated(customer, outgoing);

      // A successfully created real booking doesn't need a generic
      // "needs attention" flag too — staff already got the proper
      // booking email/WhatsApp notification for it. Only flag here for
      // an actual [[HANDOFF]], or a booking request that couldn't be
      // completed (no contact info ever given, despite asking).
      if (needsAttention || (bookingRequested && !bookingCreated)) {
        await markNeedsAttention(
          customer,
          bookingRequested
            ? { content: '📅 Requested a drop-off booking via website chat, but no contact info was given', senderType: 'CHATBOT', createdAt: new Date() }
            : outgoing
        );
      }

      res.json({
        reply: cleanContent,
        media,
        menu,
        handedOff: false
      });

    } catch (err) {
      console.error('Web chat error:', err.response?.data ?? err.message ?? err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  return router;
};
