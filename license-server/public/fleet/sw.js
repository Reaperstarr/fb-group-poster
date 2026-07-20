/* Irishka Fleet — PWA shell + background pause alerts */
const CACHE = 'irishka-fleet-v9';
const SHELL = [
  '/fleet/panel.html',
  '/fleet/panel.css',
  '/fleet/panel.js',
  '/fleet/panel-remote.js',
  '/fleet/panel-icons.js',
  '/fleet/manifest.webmanifest',
  '/fleet/icon-192.png',
];

const POLL_MS = 45000;
let pollTimer = null;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/fleet/')) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && event.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('irishka_fleet_sw_v1', 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) {
        req.result.createObjectStore('kv');
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore('kv').put(value, key);
  });
}

function pauseBodyFromInst(inst) {
  const r = String(inst.stopReason || '');
  if (r === 'post_failure_pause') return 'Fallo al publicar — revisa en Irishka';
  if (r === 'user_pause') return 'Pausada manualmente';
  if (r === 'daily_limit') return 'Límite diario alcanzado';
  const p = inst.progress || {};
  return `Progreso: ${p.done || 0}/${p.total || 0} (${p.ok || 0} ok)`;
}

async function showPauseNotification(title, body, tag) {
  try {
    await self.registration.showNotification(title, {
      body: String(body || '').slice(0, 220),
      icon: '/fleet/icon-192.png',
      badge: '/fleet/icon-192.png',
      tag: tag || 'irishka-pause',
      renotify: true,
      vibrate: [180, 90, 180],
      data: { url: '/fleet/panel.html' },
    });
  } catch (_) {}
}

async function pollDashboardFromSw() {
  const auth = await idbGet('fleetAuth');
  if (!auth || (!auth.fleetKey && !auth.initData)) return;

  const headers = { 'Content-Type': 'application/json' };
  if (auth.initData) headers['X-Telegram-Init-Data'] = auth.initData;
  else if (auth.fleetKey) headers.Authorization = `Bearer ${auth.fleetKey}`;

  let res;
  try {
    res = await fetch('/api/fleet/dashboard', { headers, cache: 'no-store' });
  } catch (_) {
    return;
  }
  if (!res.ok) return;

  let data;
  try {
    data = await res.json();
  } catch (_) {
    return;
  }

  const instances = Array.isArray(data.instances) ? data.instances : [];
  const states = (await idbGet('instanceStates')) || {};
  const seeded = !!(await idbGet('statesSeeded'));

  if (!seeded) {
    instances.forEach((inst) => {
      if (inst && inst.deviceId) states[inst.deviceId] = inst.state || 'idle';
    });
    await idbSet('instanceStates', states);
    await idbSet('statesSeeded', true);
    return;
  }

  for (const inst of instances) {
    if (!inst || !inst.deviceId) continue;
    const prev = states[inst.deviceId];
    const cur = inst.state || 'idle';
    if (cur === 'paused' && prev === 'posting') {
      const name = inst.instanceName || 'Irishka';
      await showPauseNotification(
        `${name} pausada`,
        pauseBodyFromInst(inst),
        `pause-${inst.deviceId}`
      );
    }
    states[inst.deviceId] = cur;
  }
  await idbSet('instanceStates', states);
}

function startBackgroundPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pollDashboardFromSw().catch(() => {});
  }, POLL_MS);
  pollDashboardFromSw().catch(() => {});
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'fleet-auth') {
    idbSet('fleetAuth', {
      fleetKey: String(msg.fleetKey || ''),
      initData: String(msg.initData || ''),
      savedAt: Date.now(),
    }).then(() => startBackgroundPoll()).catch(() => {});
    return;
  }
  if (msg.type === 'irishka-pause') {
    showPauseNotification(msg.title, msg.body, msg.tag || 'irishka-pause');
    return;
  }
  if (msg.type === 'fleet-poll-now') {
    pollDashboardFromSw().catch(() => {});
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url)
    || '/fleet/panel.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && c.url.includes('/fleet/') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
