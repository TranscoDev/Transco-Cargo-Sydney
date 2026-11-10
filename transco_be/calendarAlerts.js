// ============================================================
// SHIPPING CALENDAR ALERTS — "add the next shipping date" tasks for admins
// ============================================================
//
// Staff type the cutoff dates into the console's Shipping calendar. When a
// country's last entered cutoff is WARN_DAYS away or less (or there are
// none ahead), the main admin account gets a task on the Task board. Once a later
// date is added, those tasks close by themselves.
//
// A task is made once per admin for each "last date" — marking it done
// without adding a date doesn't bring it back until that date changes.

const { shippingSchedule, staffTasks, users } = require('./db');
const { COUNTRIES } = require('./scheduleRoutes');
const pushNotify = require('./pushNotify');

const WARN_DAYS = 14;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const SYSTEM_ID = 'system';
const SYSTEM_NAME = 'Shipping calendar';

function createCalendarAlerts({ broadcast, getSydneyNow, adminEmails }) {
  const pad = n => String(n).padStart(2, '0');
  function sydneyToday() {
    const now = getSydneyNow();
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  }
  const dayNumber = iso => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);
  const showDay = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const changed = id => { try { broadcast('task.changed', { id: String(id) }); } catch { /* live update is optional */ } };

  // Only the main admin account(s) (ADMIN_EMAILS, e.g. admin@transco.lk) —
  // not every login with the admin role (IT has that too).
  async function admins() {
    return users().find({ email: { $in: adminEmails } }, { projection: { name: 1, email: 1 } }).toArray();
  }

  let running = false;
  async function check() {
    if (running) return;
    running = true;
    try {
      const today = sydneyToday();
      for (const [country, label] of Object.entries(COUNTRIES)) {
        const last = await shippingSchedule().find({ country, cutoff: { $gte: today } }).sort({ cutoff: -1 }).limit(1).next();
        const lastCutoff = last ? last.cutoff : null;
        const needed = !lastCutoff || dayNumber(lastCutoff) - dayNumber(today) <= WARN_DAYS;
        const open = { 'calendarAlert.country': country, status: { $ne: 'done' } };

        if (!needed) {
          const stale = await staffTasks().find(open, { projection: { _id: 1 } }).toArray();
          if (stale.length) {
            const now = new Date();
            await staffTasks().updateMany(open, { $set: { status: 'done', doneAt: now, doneById: SYSTEM_ID, doneByName: 'New date added', updatedAt: now } });
            stale.forEach(t => changed(t._id));
          }
          continue;
        }

        const key = `${country}:${lastCutoff || 'none'}`;
        const note = lastCutoff
          ? `The last ${label} cutoff on the calendar is ${showDay(lastCutoff)}. After that the website and the bot have no next shipment to show. Add the next date in Shipping calendar — this task closes by itself.`
          : `There are no upcoming ${label} cutoff dates, so the website and the bot can't show the next shipment. Add the next date in Shipping calendar — this task closes by itself.`;
        for (const admin of await admins()) {
          const adminId = String(admin._id);
          if (await staffTasks().findOne({ 'calendarAlert.key': key, assigneeId: adminId })) continue;
          // An older alert for this country (an earlier last date) is replaced by this one.
          await staffTasks().updateMany({ ...open, assigneeId: adminId }, { $set: { status: 'done', doneAt: new Date(), doneById: SYSTEM_ID, doneByName: 'Replaced', updatedAt: new Date() } });
          const now = new Date();
          const doc = {
            title: `📅 Add the next ${label} shipping date`,
            note,
            assignTo: 'person',
            team: null,
            assigneeId: adminId,
            assigneeName: String(admin.name || admin.email || 'Admin').trim(),
            createdById: SYSTEM_ID,
            createdByName: SYSTEM_NAME,
            claimedById: null,
            claimedByName: null,
            status: 'open',
            dueDate: lastCutoff,
            dueTime: null,
            customerId: null,
            customerName: null,
            bookingId: null,
            context: null,
            calendarAlert: { country, key },
            comments: [],
            createdAt: now,
            updatedAt: now
          };
          const { insertedId } = await staffTasks().insertOne(doc);
          changed(insertedId);
          pushNotify.notifyTask({ ...doc, _id: insertedId }, { byId: SYSTEM_ID });
          console.log(`[calendar] alert task for ${doc.assigneeName}: ${key}`);
        }
      }
    } finally {
      running = false;
    }
  }

  function start() {
    const run = () => check().catch(err => console.error('[calendar] alert check failed:', err.message));
    setTimeout(() => { run(); setInterval(run, CHECK_EVERY_MS).unref(); }, 2 * 60 * 1000).unref();
    return run;
  }

  return { check, start };
}

module.exports = { createCalendarAlerts };
