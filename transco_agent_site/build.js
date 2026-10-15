// Wraps every *.html file in this folder into a single Cloudflare
// Worker (pages-dist/_worker.js) that routes by URL path — index.html
// serves at both "/" and "/index.html", every other file serves at its
// own "/<name>.html". Run `node build.js` after editing any page, then
// `npx wrangler pages deploy pages-dist --project-name transco-site --branch main`
// from this same folder to push the update live (see the end of this file).
//
// Private preview build: `PREVIEW_API_ORIGIN=https://... node build.js`
// writes worker-preview.js instead, with every page pointed at that
// backend (not the live one) and marked noindex — deploy it under its
// own name, e.g. `npx wrangler deploy worker-preview.js --name
// transco-agent-site-preview`. worker.js is not touched by a preview build.
const fs = require('fs');
const path = require('path');

const LIVE_API_ORIGIN = 'https://transco-backend-production.up.railway.app';
const previewOrigin = process.env.PREVIEW_API_ORIGIN || null;

const htmlFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));

const pages = {};
for (const file of htmlFiles) {
  let content = fs.readFileSync(path.join(__dirname, file), 'utf8');
  if (previewOrigin) content = content.split(LIVE_API_ORIGIN).join(previewOrigin);
  pages['/' + file] = content;
  if (file === 'index.html') pages['/'] = content;
}

// Shared scripts the pages load (e.g. i18n.js — the site's Sinhala/Tamil
// translations). Everything except this build script and its output.
const NOT_SERVED = ['build.js', 'worker.js', 'worker-preview.js'];
const scripts = {};
for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !NOT_SERVED.includes(f))) {
  scripts['/' + file] = fs.readFileSync(path.join(__dirname, file), 'utf8');
}
// Sri Lanka districts → towns: one list, kept in the backend (the chat's
// price menu uses it too) and served here for the booking forms.
scripts['/sl-cities.js'] = fs.readFileSync(path.join(__dirname, '..', 'transco_be', 'slCities.js'), 'utf8');

const extraHeaders = previewOrigin ? { 'x-robots-tag': 'noindex, nofollow' } : {};

// Pages that were removed or renamed — old links and bookmarks land on
// the replacement instead of a 404.
const redirects = { '/prices.html': '/box-info.html' };

const worker = `const PAGES = ${JSON.stringify(pages)};
const SCRIPTS = ${JSON.stringify(scripts)};
const EXTRA_HEADERS = ${JSON.stringify(extraHeaders)};
const REDIRECTS = ${JSON.stringify(redirects)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const moved = REDIRECTS[url.pathname];
    if (moved) {
      return new Response(null, { status: 301, headers: { location: moved, ...EXTRA_HEADERS } });
    }
    const script = SCRIPTS[url.pathname];
    if (script) {
      return new Response(script, {
        headers: { "content-type": "application/javascript; charset=UTF-8", "cache-control": "public, max-age=300", ...EXTRA_HEADERS }
      });
    }
    const page = PAGES[url.pathname];
    if (!page) {
      return new Response("Not found", { status: 404, headers: EXTRA_HEADERS });
    }
    return new Response(page, {
      headers: { "content-type": "text/html; charset=UTF-8", ...EXTRA_HEADERS }
    });
  }
};
`;

// The live site is the Cloudflare Pages project behind
// https://my.transcosydney.com.au (pages-dist/_worker.js). Deploy with
// `npx wrangler pages deploy pages-dist --project-name transco-site --branch main`.
//
// worker.js (transco-agent-site.transcocargo.workers.dev, the old test
// address) only sends visitors on to the same page on the live address,
// so links already shared keep working. Browsers carry the #/... part
// of a link (e.g. #/join/<token>) across the redirect themselves.
// 302, not 301, so browsers don't remember it and it can be undone.
const LIVE_SITE = 'https://my.transcosydney.com.au';
const redirectWorker = `export default {
  fetch(request) {
    const url = new URL(request.url);
    return new Response(null, { status: 302, headers: { location: ${JSON.stringify(LIVE_SITE)} + url.pathname + url.search } });
  }
};
`;

if (previewOrigin) {
  fs.writeFileSync(path.join(__dirname, 'worker-preview.js'), worker);
} else {
  const pagesDir = path.join(__dirname, 'pages-dist');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, '_worker.js'), worker);
  fs.writeFileSync(path.join(__dirname, 'worker.js'), redirectWorker);
}
console.log(`${previewOrigin ? 'worker-preview.js' : 'pages-dist/_worker.js (+ redirect worker.js)'} written, length:`, worker.length,
  '— routes:', Object.keys(pages).concat(Object.keys(scripts)).join(', '), previewOrigin ? `— API: ${previewOrigin}` : '');
