// Staff page access (Settings → Staff). Each staff login can be limited
// to certain console pages; the backend blocks the API calls of pages
// they don't have, so hiding a menu item is never the only protection.
//
// Roles:
//   admin     — everything (also: an email in ADMIN_EMAILS)
//   warehouse — Bookings (everything in a booking), Walk-ins, Shipments
//   custom    — the pages ticked for them
//   (none)    — staff accounts made before roles existed: everything,
//               so nobody is locked out until an admin sets a role.

// Console page key → the API prefixes (relative to /api) its screens use.
// A request is refused only when its prefix belongs to pages the staff
// member doesn't have; shared calls (sign-in, password) are never listed.
const PAGES = {
  dashboard: { label: 'Dashboard', api: ['/dashboard'] },
  conversations: { label: 'Conversations', api: ['/customers', '/messages', '/segments', '/campaigns'] },
  customers: { label: 'Customers', api: ['/customers', '/segments', '/campaigns', '/imports'] },
  bookings: { label: 'Bookings', api: ['/bookings', '/my-transco/bookings', '/forms', '/walk-ins', '/schedule', '/shipments', '/consolidations'] },
  shipments: { label: 'Shipments', api: ['/shipments', '/consolidations', '/receivers', '/imports', '/tracking', '/packaging'] },
  'walk-ins': { label: 'Walk-ins (QR)', api: ['/walk-ins', '/bookings', '/my-transco/bookings', '/forms', '/schedule', '/shipments', '/consolidations'] },
  'pickup-delivery': { label: 'Pickup & Delivery', api: ['/bookings', '/my-transco/bookings'] },
  schedule: { label: 'Shipping calendar', api: ['/schedule'] },
  tracking: { label: 'Tracking', api: ['/tracking', '/shipments'] },
  packaging: { label: 'Packaging', api: ['/packaging'] },
  leads: { label: 'Leads', api: ['/customers', '/leads'] },
  'my-transco': { label: 'Online Accounts', api: ['/my-transco'] },
  settings: { label: 'Settings (staff list)', api: ['/settings', '/staff'] },
  'bot-controls': { label: 'Bot settings', api: ['/settings'] }
};
const PAGE_KEYS = Object.keys(PAGES);
const ROLES = ['admin', 'warehouse', 'custom'];
const WAREHOUSE_PAGES = ['bookings', 'walk-ins', 'shipments'];

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'admin@transco.lk')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// null = every page.
function effectivePages(record) {
  if (!record) return null;
  if (ADMIN_EMAILS.includes(String(record.email || '').toLowerCase())) return null;
  if (record.role === 'warehouse') return WAREHOUSE_PAGES.slice();
  if (record.role === 'custom') return (record.pages || []).filter(p => PAGE_KEYS.includes(p));
  return null; // admin, or an account from before roles
}

// The prefix of this path that pages own (longest match wins, so
// '/my-transco/bookings' isn't treated as '/my-transco').
function owningPages(path) {
  let best = '', owners = [];
  for (const [key, page] of Object.entries(PAGES)) {
    for (const prefix of page.api) {
      if (path !== prefix && !path.startsWith(prefix + '/')) continue;
      if (prefix.length > best.length) { best = prefix; owners = [key]; } else if (prefix === best) owners.push(key);
    }
  }
  return owners;
}

function canUse(pages, path) {
  if (pages === null) return true;
  const owners = owningPages(path);
  return owners.length === 0 || owners.some(o => pages.includes(o));
}

// Checks role/pages input from the Settings form.
function cleanAccess(body) {
  const role = body && body.role;
  if (!ROLES.includes(role)) return { error: 'Choose a role: Admin, Warehouse or Custom.' };
  if (role !== 'custom') return { value: { role, pages: [] } };
  const pages = Array.isArray(body.pages) ? [...new Set(body.pages.filter(p => PAGE_KEYS.includes(p)))] : [];
  if (!pages.length) return { error: 'Tick at least one page for a custom role.' };
  return { value: { role, pages } };
}

// Express middleware (after staff auth). Looks the staff record up (cached
// briefly) so a role change applies within seconds, without signing out.
function createAccessMiddleware({ users, ObjectId }) {
  const cache = new Map();
  async function pagesFor(sub) {
    const hit = cache.get(sub);
    if (hit && Date.now() - hit.at < 30 * 1000) return hit.pages;
    const record = ObjectId.isValid(sub) ? await users().findOne({ _id: new ObjectId(sub) }, { projection: { email: 1, role: 1, pages: 1 } }) : null;
    const pages = effectivePages(record);
    cache.set(sub, { at: Date.now(), pages });
    return pages;
  }
  const middleware = async (req, res, next) => {
    if (!req.user || !req.user.sub) return next();
    try {
      const pages = await pagesFor(req.user.sub);
      req.staffPages = pages;
      if (canUse(pages, req.path)) return next();
      return res.status(403).json({ error: "Your account doesn't have access to this page. Ask the admin if you need it.", reason: 'no_page_access' });
    } catch (err) {
      return next(err);
    }
  };
  middleware.forget = sub => cache.delete(String(sub));
  return middleware;
}

module.exports = { PAGES, PAGE_KEYS, ROLES, WAREHOUSE_PAGES, effectivePages, canUse, owningPages, cleanAccess, createAccessMiddleware };
