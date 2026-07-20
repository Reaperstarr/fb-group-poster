/**
 * Irishka Fleet Hub — central registry for Community instances.
 * Extensions heartbeat + poll commands; Telegram Web App controls the fleet.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  analyzeScreenshot,
  shouldAutoAct,
  visionEnabled,
  minConfidence,
} = require('./fleet-vision-guard');

const FLEET_STORE_FILE = process.env.FLEET_STORE_FILE
  ? path.resolve(process.env.FLEET_STORE_FILE)
  : path.join(__dirname, 'fleet-store.json');

const FLEET_SECRET = String(process.env.IRISHKA_FLEET_SECRET || '').trim();
const BOT_TOKEN = String(process.env.IRISHKA_FLEET_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ALLOWED_USER_IDS = String(process.env.IRISHKA_FLEET_ADMIN_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OFFLINE_MS = Math.max(60000, Number(process.env.IRISHKA_FLEET_OFFLINE_MS || 120000));
const PUBLIC_DIR = path.join(__dirname, 'public');

/** @type {{ instances: Record<string, object>, queues: Record<string, object[]>, deviceStates: Record<string, object>, postAssets: Record<string, object>, tgOffset: number }} */
let store = { instances: {}, queues: {}, deviceStates: {}, postAssets: {}, tgOffset: 0 };
let tgPollTimer = null;

function loadFleetStore() {
  if (!fs.existsSync(FLEET_STORE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(FLEET_STORE_FILE, 'utf8') || '{}');
    store.instances = raw.instances && typeof raw.instances === 'object' ? raw.instances : {};
    store.queues = raw.queues && typeof raw.queues === 'object' ? raw.queues : {};
    store.deviceStates = raw.deviceStates && typeof raw.deviceStates === 'object' ? raw.deviceStates : {};
    store.postAssets = raw.postAssets && typeof raw.postAssets === 'object' ? raw.postAssets : {};
    store.tgOffset = Number(raw.tgOffset) || 0;
  } catch (e) {
    console.error('[fleet-hub] load error:', e.message);
  }
}

function saveFleetStore() {
  try {
    fs.writeFileSync(
      FLEET_STORE_FILE,
      JSON.stringify({
        instances: store.instances,
        queues: store.queues,
        deviceStates: store.deviceStates,
        postAssets: store.postAssets,
        tgOffset: store.tgOffset,
      }, null, 2),
      'utf8'
    );
  } catch (e) {
    console.error('[fleet-hub] save error:', e.message);
  }
}

function fleetJson(res, code, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function getBearer(req) {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) return '';
  return h.slice(7).trim();
}

function fleetAuthOk(req) {
  if (!FLEET_SECRET) return false;
  return getBearer(req) === FLEET_SECRET;
}

function safeDeviceId(id) {
  const d = String(id || '').trim();
  if (!d || d.length < 8 || d.length > 128) return '';
  if (!/^[a-zA-Z0-9_-]+$/.test(d)) return '';
  return d;
}

function safeInstanceName(name) {
  const n = String(name || '').trim().slice(0, 60);
  return n || 'Irishka';
}

function collectJson(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 6_000_000) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function resolveState(body) {
  const posterRunning = !!body.posterRunning;
  const hasRunState = !!body.hasRunState;
  const stopReason = String(body.stopReason || '').trim() || null;
  if (posterRunning) return 'posting';
  if (hasRunState && stopReason === 'daily_limit') return 'paused';
  if (hasRunState) return 'paused';
  return 'idle';
}

/** Normalize optional health payload from Irishka Community (≥1.2.29). */
function normalizeHealth(raw, summaryRaw) {
  if (!raw || typeof raw !== 'object') {
    const summary = String(summaryRaw || '').trim().slice(0, 240);
    return summary ? { health: null, healthSummary: summary } : { health: null, healthSummary: null };
  }
  const status = String(raw.status || '').trim().toLowerCase().slice(0, 24);
  const allowed = new Set(['ok', 'stalled', 'degraded', 'paused', 'waiting', 'idle']);
  const safeStatus = allowed.has(status) ? status : 'idle';
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.map((r) => String(r || '').slice(0, 80)).filter(Boolean).slice(0, 8)
    : [];
  const health = {
    status: safeStatus,
    label: String(raw.label || '').slice(0, 80) || null,
    rank: Number.isFinite(Number(raw.rank)) ? Number(raw.rank) : 0,
    reasons,
    ageMs: Number.isFinite(Number(raw.ageMs)) ? Number(raw.ageMs) : null,
    lastProgressAtMs: Number.isFinite(Number(raw.lastProgressAtMs)) ? Number(raw.lastProgressAtMs) : null,
    lastError: String(raw.lastError || '').slice(0, 120) || null,
    stopReason: String(raw.stopReason || '').slice(0, 80) || null,
    resumeHint: String(raw.resumeHint || '').slice(0, 40) || null,
    posterRunning: !!raw.posterRunning,
    joinActive: !!raw.joinActive,
    facebookConnected:
      raw.facebookConnected === true ? true : raw.facebookConnected === false ? false : null,
    assessedAtMs: Number.isFinite(Number(raw.assessedAtMs)) ? Number(raw.assessedAtMs) : Date.now(),
  };
  const healthSummary = String(summaryRaw || raw.label || '').trim().slice(0, 240) || null;
  return { health, healthSummary };
}

function isAttentionHealth(health) {
  if (!health || typeof health !== 'object') return false;
  return health.status === 'stalled' || health.status === 'degraded';
}

function enrichInstance(row) {
  const last = row.lastHeartbeatAt ? Date.parse(row.lastHeartbeatAt) : 0;
  const offline = !last || Date.now() - last > OFFLINE_MS;
  const state = offline ? 'offline' : row.state || 'idle';
  return { ...row, state, offline, offlineSinceMs: offline && last ? Date.now() - last : 0 };
}

function listInstances() {
  return Object.values(store.instances)
    .map(enrichInstance)
    .sort((a, b) => String(a.instanceName).localeCompare(String(b.instanceName)));
}

function publicInstance(row) {
  const enriched = enrichInstance(row);
  const hasScreenshot = !!enriched.lastScreenshotB64;
  const { lastScreenshotB64, ...rest } = enriched;
  return { ...rest, hasScreenshot, remoteSnapshot: enriched.remoteSnapshot || null };
}

function listInstancesPublic() {
  return listInstances().map(publicInstance);
}

function removeInstance(deviceId) {
  delete store.instances[deviceId];
  delete store.queues[deviceId];
  if (store.deviceStates) delete store.deviceStates[deviceId];
  saveFleetStore();
}

const QUEUE_POST_TTL_MS = Math.max(30_000, Number(process.env.IRISHKA_FLEET_QUEUE_POST_TTL_MS || 90_000));

function pruneStaleCommands(deviceId, maxAgeMs) {
  const ttl = maxAgeMs || 12 * 60 * 1000;
  const q = store.queues[deviceId];
  if (!Array.isArray(q) || !q.length) return;
  const now = Date.now();
  const kept = q.filter((item) => {
    const t = Date.parse(String(item.createdAt || ''));
    if (!Number.isFinite(t)) return false;
    if (item.command === 'queue_post' && now - t > QUEUE_POST_TTL_MS) return false;
    return now - t <= ttl;
  });
  if (kept.length !== q.length) {
    store.queues[deviceId] = kept;
    saveFleetStore();
  }
}

/** At most one pending queue_post per device — drops older backlog from failed Fleet sends. */
function pruneQueuePostsKeepLatest(deviceId) {
  const q = store.queues[deviceId];
  if (!Array.isArray(q) || q.length < 2) return;
  const queuePosts = q.filter((item) => item.command === 'queue_post');
  if (queuePosts.length <= 1) return;
  let newest = queuePosts[0];
  let newestTs = Date.parse(String(newest.createdAt || '')) || 0;
  queuePosts.slice(1).forEach((item) => {
    const ts = Date.parse(String(item.createdAt || '')) || 0;
    if (ts >= newestTs) {
      newest = item;
      newestTs = ts;
    }
  });
  const next = q.filter((item) => item.command !== 'queue_post' || item.id === newest.id);
  if (next.length !== q.length) {
    store.queues[deviceId] = next;
    saveFleetStore();
  }
}

function enqueueCommand(deviceId, command, meta) {
  pruneStaleCommands(deviceId);
  if (!store.queues[deviceId]) store.queues[deviceId] = [];
  let cmdMeta = meta || {};
  if (command === 'queue_post' || command === 'push_post') {
    cmdMeta = hydratePostMetaImages(cmdMeta);
    const opId = String(cmdMeta.fleetOpId || '').trim();
    if (opId) {
      const dup = (store.queues[deviceId] || []).find((item) => item.meta?.fleetOpId === opId);
      if (dup) return dup;
    }
    const pendingPosts = (store.queues[deviceId] || []).filter((item) => item.command === 'queue_post');
    if (pendingPosts.length >= 20) {
      const drop = pendingPosts.length - 19;
      let removed = 0;
      store.queues[deviceId] = (store.queues[deviceId] || []).filter((item) => {
        if (item.command === 'queue_post' && removed < drop) {
          removed += 1;
          return false;
        }
        return true;
      });
      saveFleetStore();
    }
  }
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    command,
    createdAt: new Date().toISOString(),
    meta: cmdMeta,
  };
  store.queues[deviceId].push(item);
  saveFleetStore();
  return item;
}

/** Inline uploaded post image into command meta so the extension does not need a second fetch. */
function hydratePostMetaImages(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = { ...meta };
  const hasInline = Array.isArray(out.imagesBase64) && out.imagesBase64.some((b) => String(b || '').length > 80);
  if (hasInline) return out;
  const assetId = String(out.imageAssetId || '').trim();
  if (!assetId) return out;
  const asset = store.postAssets?.[assetId];
  if (!asset?.imageBase64) return out;
  out.imagesBase64 = [String(asset.imageBase64)];
  out.imageMime = asset.mime || 'image/jpeg';
  out.imageName = asset.name || 'fleet-image.jpg';
  return out;
}

function drainCommandsForDevice(deviceId, max) {
  pruneStaleCommands(deviceId);
  const limit = Math.max(1, Math.min(Number(max) || 5, 10));
  const q = store.queues[deviceId] || [];
  if (!q.length) return [];
  const out = [];
  let queuePostsIncluded = 0;
  while (q.length && out.length < limit) {
    const item = q[0];
    if (item.command === 'queue_post') {
      if (queuePostsIncluded >= 1) break;
      queuePostsIncluded += 1;
    }
    out.push(q.shift());
  }
  saveFleetStore();
  return out;
}

function enqueueAll(command, meta) {
  const ids = Object.keys(store.instances);
  ids.forEach((id) => enqueueCommand(id, command, meta));
  return { count: ids.length, ids };
}

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return { ok: false, reason: 'missing_config' };
  const params = new URLSearchParams(String(initData));
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calculated !== hash) return { ok: false, reason: 'bad_hash' };
  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch (_) {}
  if (ALLOWED_USER_IDS.length && user && !ALLOWED_USER_IDS.includes(String(user.id))) {
    return { ok: false, reason: 'user_not_allowed', userId: user.id };
  }
  return { ok: true, user };
}

function extractInitData(req, url) {
  const fromHeader = String(req.headers['x-telegram-init-data'] || '').trim();
  if (fromHeader) return fromHeader;
  if (url && typeof url.searchParams?.get === 'function') {
    return String(url.searchParams.get('initData') || '').trim();
  }
  return '';
}

function webAppAuthOk(req, url) {
  const initData = extractInitData(req, url);
  if (initData) {
    const v = validateTelegramInitData(initData);
    if (v.ok) return true;
  }
  if (FLEET_SECRET && getBearer(req) === FLEET_SECRET) return true;
  return false;
}

function tgRequest(method, body) {
  if (!BOT_TOKEN) return Promise.resolve(null);
  const payload = JSON.stringify(body || {});
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

function formatPauseReasonLabel(stopReason) {
  const r = String(stopReason || '').trim();
  if (r === 'post_failure_pause') return 'Fallo al publicar';
  if (r === 'user_pause') return 'Pausada manualmente';
  if (r === 'daily_limit') return 'Límite diario';
  return r || 'Pausada';
}

const VISION_SKIP_STOP_REASONS = new Set(['user_pause', 'daily_limit']);

function isVisionAutoEnabled(inst) {
  if (!inst || typeof inst !== 'object') return true;
  return inst.visionAutoEnabled !== false;
}

function shouldRunVisionGuard(stopReason, inst) {
  if (!visionEnabled()) return false;
  if (!isVisionAutoEnabled(inst)) return false;
  const r = String(stopReason || '').trim();
  if (!r || VISION_SKIP_STOP_REASONS.has(r)) return false;
  return true;
}

function queueHasPendingCommand(deviceId, command) {
  const q = store.queues[deviceId] || [];
  return q.some((item) => String(item.command || '').toLowerCase() === command);
}

function scheduleVisionGuardScreenshot(deviceId, stopReason, progress, extensionVersion) {
  const inst = store.instances[deviceId];
  if (!inst) return;
  if (!shouldRunVisionGuard(stopReason, inst)) return;
  inst.visionGuardPending = true;
  inst.visionGuardStopReason = stopReason;
  inst.visionGuardProgress = progress || null;
  inst.visionGuardRequestedAt = new Date().toISOString();
  // v1.2.0+ extensions auto-upload screenshot on pause; older builds need Fleet command.
  const ver = String(extensionVersion || '0');
  const autoUpload = ver >= '1.2.0';
  if (autoUpload || queueHasPendingCommand(deviceId, 'screenshot')) return;
  enqueueCommand(deviceId, 'screenshot', { source: 'vision_guard', visionGuard: true });
}

async function actOnVisionGuardAnalysis(deviceId, inst, analysisResult, imageBase64) {
  const chatId = process.env.IRISHKA_FLEET_CHAT_ID || '';
  const name = safeInstanceName(inst?.instanceName);
  const analysis = analysisResult?.analysis;
  const now = new Date().toISOString();

  if (!isVisionAutoEnabled(inst)) {
    inst.visionGuardPending = false;
    return;
  }

  inst.visionGuardPending = false;
  inst.lastVisionAnalysisAt = now;
  inst.lastVisionAnalysis = analysis || null;

  if (!analysis) {
    if (chatId && imageBase64) {
      await sendTelegramPhoto(
        chatId,
        imageBase64,
        `⚠️ [${name}] Vision Guard — análisis fallido\nQueda en pausa. Revisá manualmente.`
      );
    }
    return;
  }

  const confPct = Math.round(analysis.confidence * 100);
  const autoAct = shouldAutoAct(analysis);
  const header =
    analysis.action === 'stop'
      ? `🛑 [${name}] CRÍTICO — queda en pausa`
      : autoAct
        ? `▶️ [${name}] OK — auto-resume`
        : `❓ [${name}] incierto — queda en pausa`;

  const caption =
    `${header}\n` +
    `Categoría: ${analysis.category}\n` +
    `${analysis.summary || '—'}\n` +
    `Confianza: ${confPct}%` +
    (analysis.visibleText ? `\nTexto: ${analysis.visibleText.slice(0, 120)}` : '');

  if (chatId && imageBase64) {
    await sendTelegramPhoto(chatId, imageBase64, caption.slice(0, 1020));
  } else if (chatId) {
    await sendTelegramMessage(chatId, caption);
  }

  if (!autoAct) return;

  if (analysis.action === 'resume') {
    if (!queueHasPendingCommand(deviceId, 'resume')) {
      enqueueCommand(deviceId, 'resume', {
        source: 'vision_guard',
        category: analysis.category,
      });
    }
  }
  // action stop → stay paused, human decides (Fleet play when ready)
}

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN || !chatId || !text) return;
  return tgRequest('sendMessage', {
    chat_id: chatId,
    text: String(text).slice(0, 4000),
    disable_web_page_preview: true,
  });
}

async function notifyIrishkaPausedOnServer(instanceName, stopReason, progress) {
  const chatId = process.env.IRISHKA_FLEET_CHAT_ID || '';
  if (!chatId) return;
  const p = progress || {};
  const reason = formatPauseReasonLabel(stopReason);
  const line =
    `⏸ [${safeInstanceName(instanceName)}] pausada\n` +
    `${reason}\n` +
    `Progreso: ${Number(p.done) || 0}/${Number(p.total) || 0} (${Number(p.ok) || 0} ok)`;
  await sendTelegramMessage(chatId, line);
}

async function sendTelegramPhoto(chatId, photoBase64, caption) {
  if (!BOT_TOKEN || !chatId || !photoBase64) return;
  const b64 = String(photoBase64).replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > 4_000_000) return;
  const boundary = `----Irishka${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="shot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
  );
  const capPart = caption
    ? Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`)
    : Buffer.alloc(0);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buf, capPart, tail]);
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendPhoto`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => resolve(d));
      }
    );
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

function fleetPanelUrl() {
  const base = String(process.env.IRISHKA_FLEET_PUBLIC_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (base) return `${base.replace(/\/$/, '')}/fleet/panel.html`;
  return 'https://fb-group-poster-production.up.railway.app/fleet/panel.html';
}

async function pollTelegramBot() {
  if (!BOT_TOKEN) return;
  const j = await tgRequest('getUpdates', {
    offset: store.tgOffset,
    timeout: 0,
    limit: 20,
    allowed_updates: ['message'],
  });
  if (!j || !j.ok || !Array.isArray(j.result)) return;
  for (const up of j.result) {
    store.tgOffset = Math.max(store.tgOffset, Number(up.update_id || 0) + 1);
    const msg = up.message;
    if (msg && typeof msg.text === 'string') {
      const text = msg.text.trim().toLowerCase();
      if (text === '/start' || text === '/panel' || text === '/help') {
        await tgRequest('sendMessage', {
          chat_id: msg.chat.id,
          text: '📱 Irishka Fleet — open the control panel:',
          reply_markup: {
            inline_keyboard: [[{ text: '📊 Fleet Panel', web_app: { url: fleetPanelUrl() } }]],
          },
        });
      }
    }
  }
  saveFleetStore();
}

async function setupTelegramMenuButton() {
  if (!BOT_TOKEN) return;
  await tgRequest('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Fleet Panel', web_app: { url: fleetPanelUrl() } },
  });
}

function startTelegramPolling() {
  if (!BOT_TOKEN || tgPollTimer) return;
  setupTelegramMenuButton().catch(() => {});
  tgPollTimer = setInterval(() => { pollTelegramBot().catch(() => {}); }, 2500);
  console.log('[fleet-hub] Telegram bot polling started');
}

function serveCommunityStatic(req, res, urlPath, url) {
  if (!urlPath.startsWith('/community')) return false;
  // Private Community build — same auth as Fleet API (Bearer IRISHKA_FLEET_SECRET or Telegram admin).
  if (!fleetAuthOk(req) && !webAppAuthOk(req, url)) {
    res.writeHead(401, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end('Unauthorized — Fleet secret required for Community downloads');
    return true;
  }
  let rel = urlPath.replace(/^\/community\/?/, '') || 'version.json';
  if (rel.includes('..')) {
    res.writeHead(400);
    res.end('bad path');
    return true;
  }
  const base = path.join(PUBLIC_DIR, 'community');
  const filePath = path.join(base, rel);
  if (!filePath.startsWith(base)) {
    res.writeHead(403);
    res.end('forbidden');
    return true;
  }
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.zip': 'application/zip',
    '.ps1': 'text/plain; charset=utf-8',
  };
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.end(body);
  return true;
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath.replace(/^\/fleet\/?/, '') || 'panel.html';
  if (rel.includes('..')) {
    res.writeHead(400);
    res.end('bad path');
    return true;
  }
  const filePath = path.join(PUBLIC_DIR, 'fleet', rel);
  if (!filePath.startsWith(path.join(PUBLIC_DIR, 'fleet'))) {
    res.writeHead(403);
    res.end('forbidden');
    return true;
  }
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
  };
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
  return true;
}

async function handleHeartbeat(req, res) {
  if (!fleetAuthOk(req)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  try {
    const body = await collectJson(req);
    const deviceId = safeDeviceId(body.deviceId);
    if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'Invalid deviceId' });
    const instanceName = safeInstanceName(body.instanceName);
    const prev = store.instances[deviceId] || {};
    const prevState = String(prev.state || '').trim()
      || (prev.posterRunning ? 'posting' : (prev.hasRunState ? 'paused' : 'idle'));
    const state = resolveState(body);
    const { health, healthSummary } = normalizeHealth(body.health, body.healthSummary);
    store.instances[deviceId] = {
      ...prev,
      deviceId,
      instanceName,
      state,
      posterRunning: !!body.posterRunning,
      hasRunState: !!body.hasRunState,
      stopReason: body.stopReason || null,
      progress: {
        done: Number(body.progress?.done) || 0,
        total: Number(body.progress?.total) || 0,
        ok: Number(body.progress?.ok) || 0,
        currentGroup: String(body.progress?.currentGroup || '').slice(0, 120),
      },
      version: String(body.version || '').slice(0, 20),
      extensionVersion: String(body.extensionVersion || '').slice(0, 20),
      lastHeartbeatAt: new Date().toISOString(),
      lastCommandResult: body.lastCommandResult || prev.lastCommandResult || null,
      facebookConnected: !!body.facebookConnected,
      facebookUserName: String(body.facebookUserName || '').slice(0, 80),
      facebookTabCount: Number(body.facebookTabCount) || 0,
      facebookReason: String(body.facebookReason || '').slice(0, 120),
      visionAutoEnabled: prev.visionAutoEnabled !== false,
      health: health || prev.health || null,
      healthSummary: healthSummary || prev.healthSummary || null,
      remoteSnapshot: body.remoteSnapshot && typeof body.remoteSnapshot === 'object'
        ? body.remoteSnapshot
        : (prev.remoteSnapshot || null),
    };
    if (prevState === 'posting' && state === 'paused') {
      notifyIrishkaPausedOnServer(instanceName, body.stopReason, body.progress).catch(() => {});
      scheduleVisionGuardScreenshot(deviceId, body.stopReason, body.progress, body.extensionVersion);
    }
    saveFleetStore();
    const commands = drainCommandsForDevice(deviceId, 5);
    const inst = store.instances[deviceId];
    return fleetJson(res, 200, {
      ok: true,
      state,
      commands,
      visionAutoEnabled: isVisionAutoEnabled(inst),
      visionGlobalEnabled: visionEnabled(),
    });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

async function handlePoll(req, res, url) {
  if (!fleetAuthOk(req)) return fleetJson(res, 401, { ok: false });
  const deviceId = safeDeviceId(url.searchParams.get('deviceId'));
  if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'deviceId required' });
  pruneStaleCommands(deviceId);
  const q = store.queues[deviceId] || [];
  const item = q.shift();
  saveFleetStore();
  if (!item) {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }
  return fleetJson(res, 200, item);
}

async function handleCommand(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  try {
    const body = await collectJson(req);
    const command = String(body.command || '').toLowerCase();
    const target = String(body.deviceId || body.target || 'all');
    if (!['stop', 'resume', 'screenshot', 'status', 'skip_group', 'consolidate_fb', 'get_state', 'push_post', 'queue_post', 'remove_post', 'start_posting', 'open_app', 'verify_groups', 'scan_groups', 'start_join', 'stop_join', 'toggle_groups', 'clear_queue_posts', 'reset_idle_posts'].includes(command)) {
      return fleetJson(res, 400, { ok: false, message: 'Invalid command' });
    }
    if (target === 'all') {
      const r = enqueueAll(command, { source: 'webapp' });
      return fleetJson(res, 200, { ok: true, ...r, command });
    }
    const deviceId = safeDeviceId(target);
    if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'Invalid deviceId' });
    const meta = {
      source: 'webapp',
      ...(body.meta && typeof body.meta === 'object' ? body.meta : {}),
    };
    if (command === 'clear_queue_posts') {
      const q = store.queues[deviceId] || [];
      const removed = q.filter((item) => item.command === 'queue_post').length;
      store.queues[deviceId] = q.filter((item) => item.command !== 'queue_post');
      saveFleetStore();
      return fleetJson(res, 200, { ok: true, removed, command });
    }
    if (command === 'reset_idle_posts') {
      const item = enqueueCommand(deviceId, command, meta);
      return fleetJson(res, 200, { ok: true, queued: item });
    }
    if (command === 'status') {
      const inst = publicInstance(store.instances[deviceId] || {});
      const item = enqueueCommand(deviceId, command, meta);
      return fleetJson(res, 200, { ok: true, queued: item, instance: inst });
    }
    const item = enqueueCommand(deviceId, command, meta);
    return fleetJson(res, 200, { ok: true, queued: item });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

async function handleDashboard(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  const instances = listInstancesPublic();
  const summary = {
    total: instances.length,
    posting: instances.filter((i) => i.state === 'posting').length,
    paused: instances.filter((i) => i.state === 'paused').length,
    idle: instances.filter((i) => i.state === 'idle').length,
    offline: instances.filter((i) => i.state === 'offline').length,
    attention: instances.filter((i) => i.state !== 'offline' && isAttentionHealth(i.health)).length,
  };
  return fleetJson(res, 200, {
    ok: true,
    summary,
    instances,
    visionGlobalEnabled: visionEnabled(),
  });
}

async function handleScreenshot(req, res) {
  if (!fleetAuthOk(req)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  try {
    const body = await collectJson(req);
    const deviceId = safeDeviceId(body.deviceId);
    const b64 = String(body.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (!deviceId || !b64) return fleetJson(res, 400, { ok: false, message: 'deviceId and image required' });
    const MAX_B64 = 1_200_000;
    if (b64.length > MAX_B64) {
      return fleetJson(res, 413, {
        ok: false,
        message: `Screenshot too large (${Math.round(b64.length / 1024)}KB)`,
      });
    }
    const inst = store.instances[deviceId];
    if (!inst) {
      return fleetJson(res, 404, { ok: false, message: 'Unknown deviceId — run heartbeat first' });
    }
    inst.lastScreenshotAt = new Date().toISOString();
    inst.lastScreenshotB64 = b64;
    const pauseContext = body.pauseContext && typeof body.pauseContext === 'object' ? body.pauseContext : null;
    const isVisionGuard = !!body.visionGuard || !!inst.visionGuardPending;
    if (isVisionGuard) {
      inst.lastVisionScreenshotAt = inst.lastScreenshotAt;
      if (pauseContext) inst.visionGuardPauseContext = pauseContext;
    }
    saveFleetStore();

    const chatId = process.env.IRISHKA_FLEET_CHAT_ID || '';
    if (isVisionGuard) {
      inst.visionGuardPending = false;
      if (!visionEnabled() || !isVisionAutoEnabled(inst)) {
        saveFleetStore();
        return fleetJson(res, 200, { ok: true, vision: false, visionSkipped: true });
      }
    }
    if (isVisionGuard && visionEnabled()) {
      const context = {
        stopReason: pauseContext?.stopReason || inst.visionGuardStopReason || inst.stopReason || '',
        currentGroup: pauseContext?.groupName || inst.progress?.currentGroup || '',
        lastError: pauseContext?.lastError || '',
        domHint: pauseContext?.domHint || '',
      };
      const result = await analyzeScreenshot(b64, context);
      await actOnVisionGuardAnalysis(deviceId, inst, result, b64);
      saveFleetStore();
      return fleetJson(res, 200, {
        ok: true,
        vision: true,
        analysis: result.analysis || null,
        visionOk: result.ok,
      });
    }

    if (chatId && BOT_TOKEN) {
      await sendTelegramPhoto(chatId, b64, `[${safeInstanceName(inst?.instanceName)}] screenshot`);
    }
    return fleetJson(res, 200, { ok: true });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

async function handleGetScreenshot(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  const deviceId = safeDeviceId(url.searchParams.get('deviceId'));
  if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'deviceId required' });
  const inst = store.instances[deviceId];
  if (!inst?.lastScreenshotB64) return fleetJson(res, 404, { ok: false, message: 'No screenshot' });
  return fleetJson(res, 200, {
    ok: true,
    deviceId,
    instanceName: inst.instanceName,
    capturedAt: inst.lastScreenshotAt || null,
    imageBase64: inst.lastScreenshotB64,
  });
}

async function handleGetScreenshotImage(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  const deviceId = safeDeviceId(url.searchParams.get('deviceId'));
  if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'deviceId required' });
  const inst = store.instances[deviceId];
  if (!inst?.lastScreenshotB64) return fleetJson(res, 404, { ok: false, message: 'No screenshot' });
  const buf = Buffer.from(inst.lastScreenshotB64, 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': buf.length,
    'X-Captured-At': inst.lastScreenshotAt || '',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

async function handleDeviceState(req, res) {
  if (!fleetAuthOk(req)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  try {
    const body = await collectJson(req);
    const deviceId = safeDeviceId(body.deviceId);
    if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'Invalid deviceId' });
    const state = body.state && typeof body.state === 'object' ? body.state : null;
    if (!state) return fleetJson(res, 400, { ok: false, message: 'state required' });
    if (!store.deviceStates) store.deviceStates = {};
    const { health, healthSummary } = normalizeHealth(state.health, state.healthSummary);
    store.deviceStates[deviceId] = {
      ...state,
      health: health || state.health || null,
      healthSummary: healthSummary || state.healthSummary || null,
      updatedAt: state.updatedAt || new Date().toISOString(),
    };
    const inst = store.instances[deviceId];
    if (inst && state.remoteSnapshot && typeof state.remoteSnapshot === 'object') {
      inst.remoteSnapshot = state.remoteSnapshot;
    }
    if (inst && (health || healthSummary)) {
      if (health) inst.health = health;
      if (healthSummary) inst.healthSummary = healthSummary;
    }
    if (inst && Array.isArray(state.posts)) {
      inst.remoteSnapshot = {
        ...(inst.remoteSnapshot || {}),
        totalPosts: state.posts.length,
        postsPreview: state.posts.map((p, i) => ({
          index: i,
          preview: String(p.preview || p.text || '').slice(0, 140),
          hasImages: !!(p.hasImages || (Array.isArray(p.images) && p.images.length)),
        })),
      };
    }
    saveFleetStore();
    return fleetJson(res, 200, { ok: true });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

async function handleGetDeviceState(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  const deviceId = safeDeviceId(url.searchParams.get('deviceId'));
  if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'deviceId required' });
  const state = store.deviceStates?.[deviceId] || null;
  if (!state) return fleetJson(res, 404, { ok: false, message: 'No state yet — request get_state' });
  return fleetJson(res, 200, { ok: true, deviceId, state });
}

async function handlePostAssetUpload(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  try {
    const body = await collectJson(req);
    const b64 = String(body.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (!b64) return fleetJson(res, 400, { ok: false, message: 'imageBase64 required' });
    if (b64.length > 2_400_000) {
      return fleetJson(res, 413, { ok: false, message: 'Image too large (max ~1.8MB)' });
    }
    const id = crypto.randomBytes(10).toString('hex');
    if (!store.postAssets) store.postAssets = {};
    store.postAssets[id] = {
      id,
      imageBase64: b64,
      mime: String(body.mime || 'image/jpeg').slice(0, 40),
      name: String(body.name || 'fleet-image.jpg').slice(0, 80),
      createdAt: new Date().toISOString(),
    };
    saveFleetStore();
    return fleetJson(res, 200, { ok: true, assetId: id });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

async function handlePostAssetGet(req, res, url) {
  if (!fleetAuthOk(req) && !webAppAuthOk(req, url)) {
    return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  }
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id || !/^[a-f0-9]{16,24}$/i.test(id)) {
    return fleetJson(res, 400, { ok: false, message: 'Invalid asset id' });
  }
  const asset = store.postAssets?.[id];
  if (!asset) return fleetJson(res, 404, { ok: false, message: 'Asset not found' });
  return fleetJson(res, 200, {
    ok: true,
    assetId: id,
    imageBase64: asset.imageBase64,
    mime: asset.mime || 'image/jpeg',
    name: asset.name || 'fleet-image.jpg',
  });
}

async function handleRemove(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  try {
    const body = await collectJson(req);
    const deviceId = safeDeviceId(body.deviceId);
    if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'Invalid deviceId' });
    if (!store.instances[deviceId]) return fleetJson(res, 404, { ok: false, message: 'Not found' });
    removeInstance(deviceId);
    return fleetJson(res, 200, { ok: true, removed: deviceId });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

function handleFleetConfig(req, res) {
  return fleetJson(res, 200, {
    ok: true,
    panelUrl: fleetPanelUrl(),
    fleetEnabled: !!FLEET_SECRET,
    botConfigured: !!BOT_TOKEN,
    visionEnabled: visionEnabled(),
    visionMinConfidence: minConfidence(),
  });
}

async function handleInstanceSettings(req, res, url) {
  if (!webAppAuthOk(req, url)) return fleetJson(res, 401, { ok: false, message: 'Unauthorized' });
  try {
    const body = await collectJson(req);
    const deviceId = safeDeviceId(body.deviceId);
    if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'Invalid deviceId' });
    const inst = store.instances[deviceId];
    if (!inst) return fleetJson(res, 404, { ok: false, message: 'Instance not found' });
    if (typeof body.visionAutoEnabled === 'boolean') {
      inst.visionAutoEnabled = body.visionAutoEnabled;
      if (!body.visionAutoEnabled) inst.visionGuardPending = false;
      saveFleetStore();
    }
    return fleetJson(res, 200, {
      ok: true,
      instance: publicInstance(inst),
      visionGlobalEnabled: visionEnabled(),
    });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

function handleValidateInit(req, res) {
  const initData = String(req.headers['x-telegram-init-data'] || '');
  const v = validateTelegramInitData(initData);
  return fleetJson(res, v.ok ? 200 : 401, v);
}

/**
 * @returns {Promise<boolean>} true if handled
 */
async function handleFleetRequest(req, res, urlPath, url) {
  if (req.method === 'OPTIONS' && urlPath.startsWith('/api/fleet')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return true;
  }

  if (req.method === 'GET' && urlPath.startsWith('/fleet')) {
    if (serveStatic(req, res, urlPath)) return true;
  }
  if (req.method === 'GET' && urlPath.startsWith('/community')) {
    if (serveCommunityStatic(req, res, urlPath, url)) return true;
  }

  if (req.method === 'POST' && urlPath === '/api/fleet/heartbeat') {
    await handleHeartbeat(req, res);
    return true;
  }
  if (req.method === 'GET' && urlPath === '/api/fleet/poll') {
    await handlePoll(req, res, url);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/command') {
    await handleCommand(req, res, url);
    return true;
  }
  if (req.method === 'GET' && urlPath === '/api/fleet/dashboard') {
    await handleDashboard(req, res, url);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/screenshot') {
    await handleScreenshot(req, res);
    return true;
  }
  if (req.method === 'GET' && urlPath === '/api/fleet/screenshot/img') {
    await handleGetScreenshotImage(req, res, url);
    return true;
  }
  if (req.method === 'GET' && urlPath === '/api/fleet/screenshot') {
    await handleGetScreenshot(req, res, url);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/remove') {
    await handleRemove(req, res, url);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/instance-settings') {
    await handleInstanceSettings(req, res, url);
    return true;
  }
  if (req.method === 'GET' && urlPath === '/api/fleet/config') {
    handleFleetConfig(req, res);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/validate') {
    handleValidateInit(req, res);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/device-state') {
    await handleDeviceState(req, res);
    return true;
  }
  if (req.method === 'GET' && urlPath === '/api/fleet/device-state') {
    await handleGetDeviceState(req, res, url);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/post-asset') {
    await handlePostAssetUpload(req, res, url);
    return true;
  }
  if (req.method === 'GET' && urlPath === '/api/fleet/post-asset') {
    await handlePostAssetGet(req, res, url);
    return true;
  }
  return false;
}

function initFleetHub() {
  loadFleetStore();
  if (FLEET_SECRET) {
    console.log('[fleet-hub] enabled, store:', FLEET_STORE_FILE);
    startTelegramPolling();
  } else {
    console.log('[fleet-hub] disabled (set IRISHKA_FLEET_SECRET to enable)');
  }
}

module.exports = {
  initFleetHub,
  handleFleetRequest,
  fleetPanelUrl,
};
