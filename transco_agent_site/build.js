// Wraps every *.html file in this folder into a single Cloudflare
// Worker (worker.js) that routes by URL path — index.html serves at
// both "/" and "/index.html", every other file serves at its own
// "/<name>.html". Run `node build.js` after editing any page, then
// `npx wrangler deploy` from this same folder to push the update live.
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

const outFile = previewOrigin ? 'worker-preview.js' : 'worker.js';
fs.writeFileSync(path.join(__dirname, outFile), worker);
console.log(`${outFile} written, length:`, worker.length, '— routes:', Object.keys(pages).concat(Object.keys(scripts)).join(', '),
  previewOrigin ? `— API: ${previewOrigin}` : '');
