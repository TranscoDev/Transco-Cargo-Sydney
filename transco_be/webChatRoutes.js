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

const express = require('express');
const { customers, bookings } = require('./db');

const HANDOFF_MARKER = '[[HANDOFF]]';
const BOX_MEDIA_MARKER = '[[SEND_VIDEO]]';
const SHOW_MENU_MARKER = '[[SHOW_MENU]]';
const BOOK_DROPOFF_RE = /^\[\[BOOK_DROPOFF:day=([a-z]+);time=([0-9:]+)(?:;boxes=([^;\]]*))?(?:;name=([^;\]]*))?(?:;phone=([^;\]]*))?\]\]/i;

// One "customer" document per website visitor session. Separate query
// shape (sessionId, not phoneNumber) so this can never collide with or
// be picked up by any WhatsApp-side lookup.
async function findOrCreateWebCustomer(sessionId) {
  return customers().findOneAndUpdate(
    { sessionId, channel: 'website' },
    {
      $setOnInsert: {
        sessionId,
        phoneNumber: null,
        name: 'Website Visitor',
        mode: 'CHATBOT',
        channel: 'website',
        createdAt: new Date()
      }
    },
    { upsert: true, returnDocument: 'after' }
  );
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
  MEDIA_BASE_URL
}) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const { sessionId, message } = req.body || {};

      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'sessionId is required' });
      }
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
      }

      const customer = await findOrCreateWebCustomer(sessionId);

      const incoming = await saveMessage({
        customerId: customer._id,
        senderType: 'CUSTOMER',
        content: message.trim(),
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

      const rawReply = await getFlowiseReply(message.trim(), sessionId);

      if (!rawReply) {
        return res.status(502).json({ error: 'No reply from assistant — please try again.' });
      }

      const needsAttention = rawReply.startsWith(HANDOFF_MARKER);
      let cleanContent = needsAttention
        ? rawReply.slice(HANDOFF_MARKER.length).trimStart()
        : rawReply;

      // The website has no tappable-menu UI — just drop the marker and
      // show the plain greeting underneath exactly as before. Only the
      // WhatsApp channel (server.js) does anything special with this.
      if (cleanContent.startsWith(SHOW_MENU_MARKER)) {
        cleanContent = cleanContent.slice(SHOW_MENU_MARKER.length).trimStart();
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
        const [fullMarker, requestedDay, requestedTime, boxSummary, contactName, contactPhone] = bookMatch;
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
            boxSummary: boxSummary ? boxSummary.trim() : null,
            channel: 'website',
            status: 'pending',
            createdAt: new Date()
          };

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
        handedOff: false
      });

    } catch (err) {
      console.error('Web chat error:', err.response?.data ?? err.message ?? err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  return router;
};
