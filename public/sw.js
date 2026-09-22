// WS-14: installable PWA + push. App shell is cached; data pages are network-first so nothing stale is shown.
const CACHE = 'elessons-v1'
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/login', '/manifest.webmanifest'])).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && /\/_next\/static\//.test(e.request.url)) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r })
    .catch(() => caches.match(e.request).then((m) => m ?? new Response('<h1>Offline</h1><p>Reconnect to continue.</p>', { headers: { 'content-type': 'text/html' } }))))
})
self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : { title: 'eLessons CRM', body: '' }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, data: { url: d.url ?? '/' }, icon: '/icon.svg', badge: '/icon.svg' }))
})
self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(self.clients.openWindow(e.notification.data?.url ?? '/')) })
