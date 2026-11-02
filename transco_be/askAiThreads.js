// Ask AI customer threads (console → Ask AI): staff keep one chat per
// customer who messages the office WhatsApp phone (not connected to the
// bot). Malshani pastes what the customer wrote, the AI suggests a reply
// using that customer's earlier messages, and what we sent is kept too —
// so the AI remembers quotes, shipments and questions from before.
//
// Shared by all staff. Nothing here is sent to the customer.

const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');
const agentAnswer = require('./agentAnswer');

const store = () => getDb().collection('askAiThreads');

const MAX_TEXT = 4000;
// The AI reads the newest RECENT messages word for word; older ones are
// folded into a short summary so it stays fast and on point.
const RECENT = 30;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const digits = v => String(v || '').replace(/\D/g, '');
const staffName = req => req.user?.email || 'Staff';

function line(m) {
  return `${m.from === 'customer' ? 'Customer' : 'Transco'}: ${String(m.text || '').slice(0, 800)}`;
}

function listRow(t) {
  const last = t.messages?.length ? t.messages[t.messages.length - 1] : null;
  return {
    _id: t._id, name: t.name, phone: t.phone, updatedAt: t.updatedAt,
    last: last ? { from: last.from, text: String(last.text).slice(0, 140) } : null
  };
}

// Folds messages older than the newest RECENT into thread.summary
// (Gemini). If that can't run, the old summary stays and only the
// recent messages are used.
async function refreshSummary(thread) {
  const upTo = thread.messages.length - RECENT;
  const from = thread.summarizedCount || 0;
  if (upTo <= from || !process.env.GEMINI_API_KEY) return thread;
  const older = thread.messages.slice(from, upTo).map(line).join('\n');
  try {
    const summary = String(await agentAnswer.callGemini(
      'You keep notes for a cargo company (Transco Cargo Sydney, shipping boxes Australia → Sri Lanka/India) about one customer chat. ' +
      'Update the notes with the new messages. Keep every fact that matters later: names, BL/shipment numbers, boxes and sizes, prices quoted, ' +
      'dates, addresses, promises made, open questions. Short bullet lines, plain text, under 250 words. Never invent anything.',
      `Notes so far:\n${thread.summary || '(none)'}\n\nNew messages:\n${older}`
    ) || '').trim();
    if (!summary) return thread;
    await store().updateOne({ _id: thread._id }, { $set: { summary, summarizedCount: upTo } });
    return { ...thread, summary, summarizedCount: upTo };
  } catch (err) {
    console.error('Ask AI thread summary failed:', err.message);
    return thread;
  }
}

function createAskAiThreadsRouter({ getFlowiseReply, normalizePhoneNumber, onCustomerAdded = () => {} }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const list = await store().aggregate([
        { $match: { deleted: { $ne: true } } },
        { $sort: { updatedAt: -1 } },
        { $limit: 500 },
        { $project: { name: 1, phone: 1, updatedAt: 1, messages: { $slice: [{ $ifNull: ['$messages', []] }, -1] } } }
      ]).toArray();
      res.json({ threads: list.map(listRow) });
    } catch (err) {
      console.error('Ask AI threads list failed:', err.message);
      res.status(500).json({ error: 'Could not load the customer chats.' });
    }
  });

  // New thread. The same phone number opens the existing one instead.
  router.post('/', async (req, res) => {
    const name = clean(req.body?.name, 80);
    const phone = clean(req.body?.phone, 30);
    if (!name && !phone) return res.status(400).json({ error: 'Type the customer\'s name or phone number.' });
    try {
      if (digits(phone).length >= 6) {
        const tail = digits(phone).slice(-9);
        const same = (await store().find({ deleted: { $ne: true }, phone: { $ne: '' } }, { projection: { phone: 1 } }).toArray())
          .find(t => digits(t.phone).slice(-9) === tail);
        if (same) return res.json({ thread: { _id: same._id }, existed: true });
      }
      const now = new Date();
      const doc = { name, phone, messages: [], summary: '', summarizedCount: 0, createdAt: now, updatedAt: now, createdBy: staffName(req) };
      const { insertedId } = await store().insertOne(doc);
      res.status(201).json({ thread: { _id: insertedId } });
    } catch (err) {
      console.error('Ask AI thread create failed:', err.message);
      res.status(500).json({ error: 'Could not start the chat.' });
    }
  });

  const findThread = async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) { res.status(404).json({ error: 'Chat not found.' }); return null; }
    const t = await store().findOne({ _id: new ObjectId(req.params.id), deleted: { $ne: true } });
    if (!t) res.status(404).json({ error: 'Chat not found.' });
    return t;
  };

  router.get('/:id', async (req, res) => {
    try {
      const t = await findThread(req, res);
      if (t) res.json({ thread: t });
    } catch (err) {
      console.error('Ask AI thread read failed:', err.message);
      res.status(500).json({ error: 'Could not load the chat.' });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const t = await findThread(req, res);
      if (!t) return;
      const set = {};
      if (typeof req.body?.name === 'string') set.name = clean(req.body.name, 80);
      if (typeof req.body?.phone === 'string') set.phone = clean(req.body.phone, 30);
      if (req.body?.deleted === true) { set.deleted = true; set.deletedBy = staffName(req); set.deletedAt = new Date(); }
      await store().updateOne({ _id: t._id }, { $set: set });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Could not save.' });
    }
  });

  // Add a message. from: 'customer' (pasted from WhatsApp) or 'us' (what
  // we sent). askAi on a customer message also adds the AI's suggested
  // reply (from 'us', ai: true) — staff can edit or remove it after.
  router.post('/:id/messages', async (req, res) => {
    const text = clean(req.body?.text, MAX_TEXT);
    const from = req.body?.from === 'us' ? 'us' : 'customer';
    if (!text) return res.status(400).json({ error: 'Paste the message first.' });
    try {
      let t = await findThread(req, res);
      if (!t) return;
      const now = new Date();
      const msg = { id: new ObjectId().toString(), from, text, at: now, by: staffName(req) };
      await store().updateOne({ _id: t._id }, { $push: { messages: msg }, $set: { updatedAt: now } });
      t = { ...t, messages: [...(t.messages || []), msg] };

      let aiError = null;
      if (from === 'customer' && req.body?.askAi) {
        const reply = await suggestReply(t, getFlowiseReply);
        if (reply) {
          const aiMsg = { id: new ObjectId().toString(), from: 'us', ai: true, unsure: reply.unsure, text: reply.text, at: new Date(), by: 'AI' };
          await store().updateOne({ _id: t._id }, { $push: { messages: aiMsg }, $set: { updatedAt: aiMsg.at } });
        } else {
          aiError = 'The AI could not answer just now. The message is saved — press "Ask AI again" to retry.';
        }
      }
      const fresh = await store().findOne({ _id: t._id });
      res.json({ thread: fresh, aiError });
    } catch (err) {
      console.error('Ask AI thread message failed:', err.message);
      res.status(500).json({ error: 'Could not save the message.' });
    }
  });

  // Several messages copied from WhatsApp at once, each with its real
  // time. Messages already in the chat are skipped, so copying a few
  // older ones along with the new ones is fine. Kept in time order.
  router.post('/:id/import', async (req, res) => {
    const list = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, 300) : [];
    try {
      const t = await findThread(req, res);
      if (!t) return;
      const now = new Date();
      const existing = t.messages || [];
      const isDup = m => existing.some(e => {
        if (e.from !== m.from || e.text !== m.text) return false;
        const gap = Math.abs(new Date(e.at) - m.at);
        // Both with WhatsApp times → the same minute; otherwise the paste
        // time is only roughly the real one.
        return e.whatsappTime ? gap < 60000 : gap < 86400000;
      });
      const add = [];
      let skipped = 0;
      for (const raw of list) {
        const text = clean(raw?.text, MAX_TEXT);
        if (!text) continue;
        const at = raw?.at ? new Date(raw.at) : null;
        const real = !!at && !isNaN(at) && at <= now;
        const m = {
          id: new ObjectId().toString(), from: raw?.from === 'us' ? 'us' : 'customer', text,
          at: real ? at : now, whatsappTime: real, pastedAt: now, by: staffName(req)
        };
        if (isDup(m)) skipped++; else add.push(m);
      }
      if (add.length) {
        await store().updateOne({ _id: t._id }, { $push: { messages: { $each: add, $sort: { at: 1 } } }, $set: { updatedAt: now } });
      }

      let fresh = await store().findOne({ _id: t._id });
      let aiError = null;
      const last = fresh.messages[fresh.messages.length - 1];
      if (req.body?.askAi && add.length && last?.from === 'customer') {
        const reply = await suggestReply(fresh, getFlowiseReply);
        if (reply) {
          const aiMsg = { id: new ObjectId().toString(), from: 'us', ai: true, unsure: reply.unsure, text: reply.text, at: new Date(), by: 'AI' };
          await store().updateOne({ _id: t._id }, { $push: { messages: aiMsg }, $set: { updatedAt: aiMsg.at } });
          fresh = await store().findOne({ _id: t._id });
        } else {
          aiError = 'The AI could not answer just now. The messages are saved — press "Ask AI again" to retry.';
        }
      }
      res.json({ thread: fresh, added: add.length, skipped, aiError });
    } catch (err) {
      console.error('Ask AI thread import failed:', err.message);
      res.status(500).json({ error: 'Could not save the messages.' });
    }
  });

  // "Save as customer": the same number already saved → this chat is
  // linked to that customer (never a second one); otherwise a new
  // customer is added, as Customers → Add customer does.
  router.post('/:id/save-customer', async (req, res) => {
    try {
      const t = await findThread(req, res);
      if (!t) return;
      const name = clean(req.body?.name, 80) || t.name;
      const phoneNumber = normalizePhoneNumber(clean(req.body?.phone, 30) || t.phone);
      if (!name) return res.status(400).json({ error: 'Type the customer\'s name.' });
      if (!phoneNumber) return res.status(400).json({ error: 'Type their WhatsApp number — check the digits and country code.' });

      let customer = await getDb().collection('customers').findOne({ phoneNumber });
      const existed = !!customer;
      if (!customer) {
        const doc = { phoneNumber, name, mode: 'CHATBOT', status: 'ACTIVE', sources: ['manual'] };
        const { insertedId } = await getDb().collection('customers').insertOne(doc);
        customer = { _id: insertedId, ...doc };
        onCustomerAdded(customer);
      }
      await store().updateOne({ _id: t._id }, {
        $set: { customerId: customer._id, customerName: customer.name || name, phone: t.phone || clean(req.body?.phone, 30), name: t.name || name }
      });
      res.json({ thread: await store().findOne({ _id: t._id }), existed, customer: { id: customer._id, name: customer.name || name } });
    } catch (err) {
      console.error('Ask AI save customer failed:', err.message);
      res.status(500).json({ error: 'Could not save the customer.' });
    }
  });

  // Suggest a reply to the latest customer message again.
  router.post('/:id/suggest', async (req, res) => {
    try {
      const t = await findThread(req, res);
      if (!t) return;
      if (!t.messages?.length || t.messages[t.messages.length - 1].from !== 'customer') {
        return res.status(400).json({ error: 'The last message should be from the customer.' });
      }
      const reply = await suggestReply(t, getFlowiseReply);
      if (!reply) return res.status(502).json({ error: 'The AI could not answer just now. Please try again.' });
      const aiMsg = { id: new ObjectId().toString(), from: 'us', ai: true, unsure: reply.unsure, text: reply.text, at: new Date(), by: 'AI' };
      await store().updateOne({ _id: t._id }, { $push: { messages: aiMsg }, $set: { updatedAt: aiMsg.at } });
      res.json({ thread: await store().findOne({ _id: t._id }) });
    } catch (err) {
      console.error('Ask AI thread suggest failed:', err.message);
      res.status(500).json({ error: 'The AI could not answer just now. Please try again.' });
    }
  });

  // Edit (e.g. after changing the AI's suggestion before sending) or remove a message.
  router.patch('/:id/messages/:msgId', async (req, res) => {
    try {
      const t = await findThread(req, res);
      if (!t) return;
      const filter = { _id: t._id, 'messages.id': req.params.msgId };
      if (req.body?.remove === true) {
        await store().updateOne({ _id: t._id }, { $pull: { messages: { id: req.params.msgId } } });
      } else {
        const text = clean(req.body?.text, MAX_TEXT);
        if (!text) return res.status(400).json({ error: 'The message can\'t be empty.' });
        await store().updateOne(filter, { $set: { 'messages.$.text': text, 'messages.$.editedBy': staffName(req), 'messages.$.unsure': false } });
      }
      res.json({ thread: await store().findOne({ _id: t._id }) });
    } catch (err) {
      res.status(500).json({ error: 'Could not save.' });
    }
  });

  return router;
}

// The reply to the newest customer message(s), reading this customer's
// summary + recent messages. The same Flowise bot as WhatsApp first (staff
// trust its answers), with the chat written into the question; agentAnswer
// only if that can't run.
async function suggestReply(thread, getFlowiseReply) {
  thread = await refreshSummary(thread);
  const all = thread.messages;
  // Customer messages since our last reply are the "new message".
  let i = all.length;
  while (i > 0 && all[i - 1].from === 'customer') i--;
  const question = all.slice(i).map(m => m.text).join('\n');
  const recent = all.slice(Math.max(thread.summarizedCount || 0, all.length - RECENT), i);
  const history =
    (thread.summary ? `Notes from earlier in this chat:\n${thread.summary}\n\nRecent messages:\n` : '') +
    recent.map(line).join('\n');
  const customer = { name: thread.name };

  let reply = null;
  try {
    // No history = the exact text WhatsApp would send the bot.
    const asked = history ? `Earlier in this chat with the customer:\n${history}\n\nThe customer's new message:\n${question}` : question;
    reply = await getFlowiseReply(asked.slice(-6000), `staff-thread-${thread._id}-${Date.now()}`, customer);
  } catch (err) {
    console.error('Ask AI thread: bot reply failed:', err.message);
  }
  if (!reply) reply = await agentAnswer.answer({ question, customer, history });
  if (!reply) return null;
  let unsure = reply.includes('[[HANDOFF]]');
  let text = reply.replace(/\[\[[A-Z_]+[^\]]*\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (text) {
    const checked = await checkReply(text, question, history);
    // A hand-off the check answered from the facts isn't "unsure" any more.
    if (unsure && !/team|connect you|get back to you|check with/i.test(checked)) unsure = false;
    text = checked;
  }
  return {
    text: unsure && (!text || text.startsWith('👍')) ? "The AI isn't sure about this one — please check with the office." : text,
    unsure
  };
}

// Staff copy these replies straight to customers, so check the bot's reply
// against the Agent Transco knowledge: drop the welcome-pack extras it adds
// (it sees each question as a new customer), and correct it when it agrees
// with a wrong assumption or leaves out what the customer needs ("open
// Saturday only?" → "Yes!" without the weekday hours). The bot's reply as is
// if the check can't run.
async function checkReply(text, question, history) {
  try {
    // Prices, shipping calendar dates, contacts and the knowledge page.
    const facts = (await agentAnswer.buildFacts()).text.slice(0, 20000);
    const fixed = String(await agentAnswer.callGemini(
      'You check a cargo company\'s (Transco Cargo Sydney) WhatsApp reply before staff send it to a customer. Use ONLY the company facts given.\n' +
      '1. Keep only what answers the customer\'s new message (read the earlier chat for context). Drop extras they did not ask about: address/map, contacts, tracking, booking links, fees — unless the question is about them.\n' +
      '2. If the reply agrees with something in the question that the facts show is wrong or incomplete, correct it plainly. ' +
      'Example: "open Saturday only?" → No — Saturdays 11am–3pm, and also Tuesday to Friday 5pm–6pm by appointment; closed Sunday and Monday.\n' +
      '3. If the reply says it doesn\'t have something (dates, prices, hours…) or passes the customer to the team, but the facts DO have it, answer from the facts instead ' +
      '(e.g. shipping dates → the cut-off dates from NEXT SHIPPING DATES; confirm or correct the dates the customer mentions).\n' +
      '4. Never change or invent a fact, number, date, time, price or link. Keep the reply\'s friendly tone and WhatsApp *bold* style; short.\n' +
      'Return only the reply text.',
      `Company facts:\n${facts}\n\n` +
      (history ? `Earlier chat:\n${history.slice(-3000)}\n\n` : '') +
      `Customer's new message:\n${question}\n\nBot reply:\n${text}`
    ) || '').trim();
    return fixed || text;
  } catch (err) {
    console.error('Ask AI: reply check failed:', err.message);
    return text;
  }
}

module.exports = { createAskAiThreadsRouter, checkReply };
