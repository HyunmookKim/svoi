// Свои 0.1 — 캐시 이름은 앱 버전(APP_VER)과 반드시 같아야 한다
const CACHE = 'svoi-0.1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 앱 파일은 「인터넷 먼저, 안 되면 저장본」 — 새 버전이 바로 보이게 한다
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
    return res;
  }).catch(() => caches.match(req)));
});
