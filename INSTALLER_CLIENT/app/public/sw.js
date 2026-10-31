const CACHE_NAME = 'pesanrahasia-pwa-v3';
const PRECACHE_ASSETS = [
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
  '/admin-manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Network-first (no-store) agar halaman utama, Admin, dan API selalu real-time
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request))
  );
});

// Handler Web Push Notification (Ketika ada pendaftar baru masuk ke aplikasi)
self.addEventListener('push', (event) => {
  let payload = {
    title: '🆕 Pendaftar Baru PesanRahasia!',
    body: 'Ada pengguna Gmail baru yang baru saja mendaftar di aplikasi.',
    url: '/admin',
    tag: 'new-user-registration'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const options = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 300],
    tag: payload.tag || 'pesanrahasia-push',
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.url || '/admin',
      machineId: payload.machineId || '',
      email: payload.email || ''
    },
    actions: [
      { action: 'open_admin', title: '📊 Buka Dashboard Admin' },
      { action: 'open_vocml', title: '🔑 Buka VOC ML' }
    ]
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (const client of windowClients) {
          client.postMessage({
            type: 'PUSH_NEW_USER',
            payload
          });
        }
      })
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    event.action === 'open_vocml'
      ? 'https://vocml.vocpos.id'
      : event.notification.data?.url || '/admin';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
