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

function createAskAiThreadsRouter({ getFlowiseReply }) {
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
// summary + recent messages. agentAnswer (all console facts) first; the
// Flowise bot with the chat written into the question if that can't run.
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
    reply = await agentAnswer.answer({ question, customer, history });
  } catch (err) {
    console.error('Ask AI thread: agent answer failed:', err.message);
  }
  if (!reply) {
    const asked = (history ? `Earlier in this chat with the customer:\n${history}\n\n` : '') + `The customer's new message:\n${question}`;
    reply = await getFlowiseReply(asked.slice(-6000), `staff-thread-${thread._id}-${Date.now()}`, customer);
  }
  if (!reply) return null;
  const unsure = reply.includes('[[HANDOFF]]');
  const text = reply.replace(/\[\[[A-Z_]+[^\]]*\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: unsure && (!text || text.startsWith('👍')) ? "The AI isn't sure about this one — please check with the office." : text,
    unsure
  };
}

module.exports = { createAskAiThreadsRouter };
