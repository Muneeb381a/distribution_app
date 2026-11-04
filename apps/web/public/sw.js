// Distribution — service worker. Keeps the app shell so billing opens with no connection.
// API calls go to another origin and are never cached here; offline data lives in IndexedDB.

const VERSION = 'v2';
const PAGES = `dist-pages-${VERSION}`;
const STATIC = `dist-static-${VERSION}`;
const OFFLINE_PATHS = ['/sales/new', '/outbox'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![PAGES, STATIC].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

const isStatic = (url) => url.pathname.startsWith('/_next/static/') || /\.(woff2?|svg|png|ico|webmanifest)$/.test(url.pathname);
const isRsc = (req, url) => req.headers.get('RSC') === '1' || url.searchParams.has('_rsc');

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(STATIC)).put(req, res.clone());
  return res;
}

async function networkFirst(req, key) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') (await caches.open(PAGES)).put(key ?? req, res.clone());
    return res;
  } catch (e) {
    const hit = await caches.match(key ?? req, { ignoreSearch: !key });
    if (hit) return hit;
    throw e;
  }
}

function offlinePage(path) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Distribution</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f6f3;color:#121815;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
@media (prefers-color-scheme:dark){body{background:#0d1110;color:#e7ece9}a{color:#6fd6c8}}
main{max-width:420px}h1{font-size:22px;margin:0 0 8px}p{color:#5f6a64;line-height:1.5}a{color:#0b5e57;font-weight:600;margin-right:16px}</style></head>
<body><main><h1>This page needs a connection</h1><p>${path} isn't saved on this PC. Billing and the outbox work offline.</p>
<p><a href="/sales/new">New bill</a><a href="/outbox">Offline outbox</a></p></main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (isStatic(url)) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === 'navigate') {
    // One cached copy per page path; query strings (e.g. ?customer=) don't change the shell.
    const key = new Request(url.origin + url.pathname);
    event.respondWith(networkFirst(req, key).catch(() => offlinePage(url.pathname)));
  } else if (isRsc(req, url)) {
    // Client-side navigation data. Offline, failing makes Next fall back to a full page load (served above).
    event.respondWith(networkFirst(req).catch(() => Response.error()));
  } else {
    event.respondWith(networkFirst(req).catch(() => Response.error()));
  }
});

/** Cache the offline pages and every script, style and font they load. */
async function warm(urls) {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  for (const path of [...new Set([...OFFLINE_PATHS, ...urls])]) {
    try {
      const res = await fetch(path, { credentials: 'same-origin' });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await pages.put(new Request(self.location.origin + path), res);
      const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? []);
      for (const a of assets) {
        if (await statics.match(a)) continue;
        try {
          const r = await fetch(a);
          if (r.ok) await statics.put(a, r);
        } catch { /* next time */ }
      }
    } catch { /* offline right now */ }
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'warm') event.waitUntil(warm(event.data.urls ?? []));
});
