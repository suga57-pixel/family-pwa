// アプリ本体だけを保存。API、セッション、個人データはキャッシュしない。
const CACHE_PREFIX = 'family-shell-';
const CACHE = `${CACHE_PREFIX}stage2-v1`;
const SHELL = ['./', './index.html', './styles.css', './app.js', './calendar.css', './calendar-core.js', './calendar-store.js', './calendar.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './vendor/supabase.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // config.jsはキャッシュしない。未接続時は設定なしで起動する。
  if (url.pathname === new URL('./config.js', self.registration.scope).pathname) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response('window.FAMILY_CONFIG = {};', { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } })));
    return;
  }
  const allowed = SHELL.map(path => new URL(path, self.registration.scope).href);
  if (!allowed.includes(url.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
