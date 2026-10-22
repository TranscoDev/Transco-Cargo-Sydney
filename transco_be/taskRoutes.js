// ============================================================
// STAFF TASKS — to-dos for yourself, a colleague or the warehouse team
// ============================================================
//
// One task is one record, seen from both sides: the person who sent it
// ("Sent by me") and whoever it's for ("My tasks" / "Team tasks"). Any
// update — claim, start, done, a comment — is the same record, so both
// sides always agree.
//
// Who it's for (assignTo):
//   me     — a private to-do; only the creator ever sees it
//   person — one staff member
//   team   — the warehouse team; ONE person claims it, then it's theirs
//
// A due date/time is optional. Nothing here touches any other collection.
//
//   GET    /api/tasks                 tasks this staff member can see
//   GET    /api/tasks/people          staff list for the "A person" picker
//   GET    /api/tasks/all             admin: every task except private ones
//   POST   /api/tasks                 create
//   PATCH  /api/tasks/:id             { action: claim|unclaim|start|done|reopen } or edit fields
//   POST   /api/tasks/:id/comments    add a comment
//   PATCH  /api/tasks/:id/reassign    admin: give it to the team or a person
//   DELETE /api/tasks/:id             creator or admin

const express = require('express');
const { ObjectId } = require('mongodb');
const { staffTasks, users } = require('./db');

const ASSIGN_TO = ['me', 'person', 'team'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Done tasks stay on the board a little while, then drop off the lists.
const DONE_VISIBLE_MS = 2 * 24 * 60 * 60 * 1000;
const ADMIN_DONE_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COMMENTS = 100;

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function shape(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    note: doc.note || null,
    assignTo: doc.assignTo,
    team: doc.team || null,
    assigneeId: doc.assigneeId || null,
    assigneeName: doc.assigneeName || null,
    createdById: doc.createdById,
    createdByName: doc.createdByName || 'Staff',
    claimedById: doc.claimedById || null,
    claimedByName: doc.claimedByName || null,
    status: doc.status,
    dueDate: doc.dueDate || null,
    dueTime: doc.dueTime || null,
    customerId: doc.customerId || null,
    customerName: doc.customerName || null,
    bookingId: doc.bookingId || null,
    context: doc.context || null,
    comments: (doc.comments || []).map(c => ({ id: c.id, byId: c.byId, byName: c.byName, text: c.text, at: c.at })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    doneAt: doc.doneAt || null,
    doneByName: doc.doneByName || null
  };
}

module.exports = function createTaskRouter({ broadcast, isStaffAdmin, canDeleteChats }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const me = req => ({ id: String(req.user.sub), name: String(req.user.name || req.user.email || 'Staff').trim() });

  // Only an id goes out on the live stream — private to-dos never leave
  // the API; each console re-reads the tasks it may see.
  const changed = id => {
    try { broadcast('task.changed', { id: String(id) }); } catch { /* live update is optional */ }
  };

  // Tasks this person may see: their own, ones for them, and team tasks.
  function visibleTo(userId) {
    return { $or: [{ createdById: userId }, { assigneeId: userId }, { assignTo: 'team' }] };
  }

  function canSee(task, userId) {
    return task.createdById === userId || task.assigneeId === userId || task.assignTo === 'team';
  }

  // The person doing the work: the creator of a private to-do, the chosen
  // person, or whoever claimed a team task. The sender may also close or
  // reopen what they sent.
  function canWork(task, userId) {
    if (task.assignTo === 'me') return task.createdById === userId;
    if (task.assignTo === 'person') return task.assigneeId === userId || task.createdById === userId;
    return !task.claimedById || task.claimedById === userId || task.createdById === userId;
  }

  async function loadTask(req, res) {
    if (!ObjectId.isValid(req.params.id)) { res.status(400).json({ error: 'That task was not found.' }); return null; }
    const task = await staffTasks().findOne({ _id: new ObjectId(req.params.id) });
    // The admin may open any task except someone's private to-do.
    const allowed = task && (canSee(task, me(req).id) || (task.assignTo !== 'me' && await isStaffAdmin(req)));
    if (!allowed) { res.status(404).json({ error: 'That task was not found — it may have been deleted.' }); return null; }
    return task;
  }

  async function personById(id) {
    if (!ObjectId.isValid(id)) return null;
    return users().findOne({ _id: new ObjectId(id) }, { projection: { name: 1, email: 1, role: 1 } });
  }

  const nameOf = record => String((record && (record.name || record.email)) || 'Staff').trim();

  // Checks the due date/time (both optional; a time needs a date).
  function cleanDue(body) {
    const dueDate = body.dueDate === undefined || body.dueDate === null || body.dueDate === '' ? null : body.dueDate;
    const dueTime = body.dueTime === undefined || body.dueTime === null || body.dueTime === '' ? null : body.dueTime;
    if (dueDate !== null && !isRealDate(dueDate)) return { error: 'That date isn\'t a real date.', field: 'dueDate' };
    if (dueTime !== null && !TIME_RE.test(dueTime)) return { error: 'Enter the time like 10:30.', field: 'dueTime' };
    if (dueTime && !dueDate) return { error: 'Pick a day for that time.', field: 'dueDate' };
    return { value: { dueDate, dueTime } };
  }

  // ---------- read ----------

  router.get('/', wrap(async (req, res) => {
    const user = me(req);
    const since = new Date(Date.now() - DONE_VISIBLE_MS);
    const docs = await staffTasks()
      .find({ $and: [visibleTo(user.id), { $or: [{ status: { $ne: 'done' } }, { doneAt: { $gte: since } }] }] })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    const record = await personById(user.id);
    res.json({
      tasks: docs.map(shape),
      me: { id: user.id, name: user.name, isAdmin: await isStaffAdmin(req), isWarehouse: Boolean(record && record.role === 'warehouse'), canDeleteChats: await canDeleteChats(req) }
    });
  }));

  router.get('/people', wrap(async (req, res) => {
    const staff = await users().find({}, { projection: { name: 1, email: 1, role: 1 } }).sort({ name: 1, email: 1 }).toArray();
    res.json({ people: staff.map(s => ({ id: String(s._id), name: nameOf(s), role: s.role || null })) });
  }));

  router.get('/all', wrap(async (req, res) => {
    if (!(await isStaffAdmin(req))) return res.status(403).json({ error: 'Only the admin can see every task.' });
    const since = new Date(Date.now() - ADMIN_DONE_VISIBLE_MS);
    // Private "me only" to-dos stay private, even from the admin.
    const docs = await staffTasks()
      .find({ assignTo: { $ne: 'me' }, $or: [{ status: { $ne: 'done' } }, { doneAt: { $gte: since } }] })
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();
    res.json({ tasks: docs.map(shape) });
  }));

  // ---------- create ----------

  router.post('/', wrap(async (req, res) => {
    const body = req.body || {};
    const user = me(req);
    const title = text(body.title, 120);
    if (!title) return res.status(400).json({ error: 'Write what needs doing.', field: 'title' });
    const assignTo = ASSIGN_TO.includes(body.assignTo) ? body.assignTo : 'me';

    const due = cleanDue(body);
    if (due.error) return res.status(400).json(due);

    let assigneeId = null, assigneeName = null;
    if (assignTo === 'me') { assigneeId = user.id; assigneeName = user.name; }
    if (assignTo === 'person') {
      const person = await personById(body.personId);
      if (!person) return res.status(400).json({ error: 'Choose who the task is for.', field: 'personId' });
      assigneeId = String(person._id); assigneeName = nameOf(person);
    }

    const now = new Date();
    const doc = {
      title,
      note: text(body.note, 500) || null,
      assignTo,
      // A team task is for the warehouse, or for everyone ('all').
      team: assignTo === 'team' ? (body.team === 'all' ? 'all' : 'warehouse') : null,
      assigneeId,
      assigneeName,
      createdById: user.id,
      createdByName: user.name,
      claimedById: null,
      claimedByName: null,
      status: 'open',
      ...due.value,
      customerId: text(body.customerId, 64) || null,
      customerName: text(body.customerName, 120) || null,
      bookingId: text(body.bookingId, 64) || null,
      // Customer/booking details when made from a chat, booking or profile
      // (e.g. "CUS-000005 · 0412 345 678 · Pickup 12 Nov · 3 boxes").
      context: text(body.context, 300) || null,
      comments: [],
      createdAt: now,
      updatedAt: now
    };
    const { insertedId } = await staffTasks().insertOne(doc);
    changed(insertedId);
    res.status(201).json({ task: shape({ ...doc, _id: insertedId }) });
  }));

  // ---------- update ----------

  router.patch('/:id', wrap(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const user = me(req);
    const admin = await isStaffAdmin(req);
    const body = req.body || {};
    const now = new Date();
    let set = null;
    let filter = { _id: task._id };

    switch (body.action) {
      case 'claim':
        if (task.assignTo !== 'team') return res.status(400).json({ error: 'Only team tasks can be claimed.' });
        if (task.claimedById && task.claimedById !== user.id) return res.status(409).json({ error: `${task.claimedByName || 'Someone'} already claimed this task.` });
        // Only one person can win a claim, even if two tap at once.
        filter = { _id: task._id, $or: [{ claimedById: null }, { claimedById: user.id }] };
        set = { claimedById: user.id, claimedByName: user.name };
        break;
      case 'unclaim':
        if (task.claimedById !== user.id && !admin) return res.status(403).json({ error: 'Only the person who claimed it can let it go.' });
        set = { claimedById: null, claimedByName: null, status: task.status === 'done' ? 'done' : 'open' };
        break;
      case 'start':
      case 'done':
      case 'reopen':
        if (!admin && !canWork(task, user.id)) return res.status(403).json({ error: `${task.claimedByName || 'Someone else'} is working on this task.` });
        if (body.action === 'start') set = { status: 'in_progress', startedAt: now };
        if (body.action === 'done') set = { status: 'done', doneAt: now, doneById: user.id, doneByName: user.name };
        if (body.action === 'reopen') set = { status: 'open', doneAt: null, doneById: null, doneByName: null };
        // Starting or finishing an unclaimed team task claims it.
        if (task.assignTo === 'team' && !task.claimedById && body.action !== 'reopen') {
          set.claimedById = user.id; set.claimedByName = user.name;
        }
        break;
      case undefined: {
        // Editing the words or due time: the sender (or admin).
        if (task.createdById !== user.id && !admin) return res.status(403).json({ error: 'Only the person who made this task can change it.' });
        set = {};
        if ('title' in body) {
          const title = text(body.title, 120);
          if (!title) return res.status(400).json({ error: 'Write what needs doing.', field: 'title' });
          set.title = title;
        }
        if ('note' in body) set.note = text(body.note, 500) || null;
        if ('dueDate' in body || 'dueTime' in body) {
          const due = cleanDue({ dueDate: 'dueDate' in body ? body.dueDate : task.dueDate, dueTime: 'dueTime' in body ? body.dueTime : task.dueTime });
          if (due.error) return res.status(400).json(due);
          Object.assign(set, due.value);
        }
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown action.' });
    }

    set.updatedAt = now;
    const result = await staffTasks().findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' });
    const updated = result && result.value !== undefined ? result.value : result;
    if (!updated) return res.status(409).json({ error: 'Someone else claimed this task first.' });
    changed(task._id);
    res.json({ task: shape(updated) });
  }));

  router.post('/:id/comments', wrap(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const body = text((req.body || {}).text, 500);
    if (!body) return res.status(400).json({ error: 'Write a comment first.' });
    if ((task.comments || []).length >= MAX_COMMENTS) return res.status(400).json({ error: 'This task has too many comments — make a new task.' });
    const user = me(req);
    const comment = { id: new ObjectId().toString(), byId: user.id, byName: user.name, text: body, at: new Date() };
    const result = await staffTasks().findOneAndUpdate(
      { _id: task._id },
      { $push: { comments: comment }, $set: { updatedAt: comment.at } },
      { returnDocument: 'after' }
    );
    const updated = result && result.value !== undefined ? result.value : result;
    changed(task._id);
    res.status(201).json({ task: shape(updated) });
  }));

  router.patch('/:id/reassign', wrap(async (req, res) => {
    if (!(await isStaffAdmin(req))) return res.status(403).json({ error: 'Only the admin can reassign tasks.' });
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'That task was not found.' });
    const task = await staffTasks().findOne({ _id: new ObjectId(req.params.id) });
    if (!task || task.assignTo === 'me') return res.status(404).json({ error: 'That task was not found.' });
    const body = req.body || {};
    let set;
    if (body.assignTo === 'team') {
      set = { assignTo: 'team', team: 'warehouse', assigneeId: null, assigneeName: null };
    } else if (body.assignTo === 'person') {
      const person = await personById(body.personId);
      if (!person) return res.status(400).json({ error: 'Choose who the task is for.' });
      set = { assignTo: 'person', team: null, assigneeId: String(person._id), assigneeName: nameOf(person) };
    } else {
      return res.status(400).json({ error: 'Choose the warehouse team or a person.' });
    }
    Object.assign(set, { claimedById: null, claimedByName: null, status: task.status === 'done' ? 'done' : 'open', updatedAt: new Date() });
    const result = await staffTasks().findOneAndUpdate({ _id: task._id }, { $set: set }, { returnDocument: 'after' });
    const updated = result && result.value !== undefined ? result.value : result;
    changed(task._id);
    res.json({ task: shape(updated) });
  }));

  router.delete('/:id', wrap(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    if (task.createdById !== me(req).id && !(await isStaffAdmin(req))) {
      return res.status(403).json({ error: 'Only the person who made this task can delete it.' });
    }
    await staffTasks().deleteOne({ _id: task._id });
    changed(task._id);
    res.status(204).send();
  }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    console.error('Tasks error:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return router;
};
