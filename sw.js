/* 圏外でも画面の枠だけは出るようにする。会社のデータ（api.github.com）は絶対にキャッシュしない。 */
const V = 'aomushi-v14';  // 枠のファイルを触ったら必ず上げる（v14＝鍵の見分け札）
const SHELL = [
  './', './index.html', './style.css', './app.js', './config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 第4期：知らせ。係の返事が金庫に入ったとき、Macから突く。
   中身（会社の数字）は載せない。載せるのは「誰から・何について」だけ。 */
self.addEventListener('push', (e) => {
  let d = { title: 'あおむし製作所', body: '会社に動きがあった。' };
  try { d = Object.assign(d, e.data ? e.data.json() : {}); } catch (_) {
    if (e.data) d.body = e.data.text();
  }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    tag: d.tag || 'aomushi',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './',
                      self.location.href).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((ws) => {
      for (const w of ws) if ('focus' in w) return w.focus();
      return clients.openWindow(url);
    }));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;   // GitHub API と Google Fonts は素通し

  // 枠のファイルは「まず取りに行く・だめならキャッシュ」。更新が反映されないのを防ぐ。
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
