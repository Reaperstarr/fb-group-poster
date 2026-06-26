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

/** @type {{ instances: Record<string, object>, queues: Record<string, object[]>, tgOffset: number }} */
let store = { instances: {}, queues: {}, tgOffset: 0 };
let tgPollTimer = null;

function loadFleetStore() {
  if (!fs.existsSync(FLEET_STORE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(FLEET_STORE_FILE, 'utf8') || '{}');
    store.instances = raw.instances && typeof raw.instances === 'object' ? raw.instances : {};
    store.queues = raw.queues && typeof raw.queues === 'object' ? raw.queues : {};
    store.tgOffset = Number(raw.tgOffset) || 0;
  } catch (e) {
    console.error('[fleet-hub] load error:', e.message);
  }
}

function saveFleetStore() {
  try {
    fs.writeFileSync(
      FLEET_STORE_FILE,
      JSON.stringify({ instances: store.instances, queues: store.queues, tgOffset: store.tgOffset }, null, 2),
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
  return { ...rest, hasScreenshot };
}

function listInstancesPublic() {
  return listInstances().map(publicInstance);
}

function removeInstance(deviceId) {
  delete store.instances[deviceId];
  delete store.queues[deviceId];
  saveFleetStore();
}

function enqueueCommand(deviceId, command, meta) {
  if (!store.queues[deviceId]) store.queues[deviceId] = [];
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    command,
    createdAt: new Date().toISOString(),
    meta: meta || {},
  };
  store.queues[deviceId].push(item);
  saveFleetStore();
  return item;
}

function drainCommandsForDevice(deviceId, max) {
  const limit = Math.max(1, Math.min(Number(max) || 5, 10));
  const q = store.queues[deviceId] || [];
  if (!q.length) return [];
  const out = q.splice(0, limit);
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

function shouldRunVisionGuard(stopReason) {
  if (!visionEnabled()) return false;
  const r = String(stopReason || '').trim();
  if (!r || VISION_SKIP_STOP_REASONS.has(r)) return false;
  return true;
}

function queueHasPendingCommand(deviceId, command) {
  const q = store.queues[deviceId] || [];
  return q.some((item) => String(item.command || '').toLowerCase() === command);
}

function scheduleVisionGuardScreenshot(deviceId, stopReason, progress, extensionVersion) {
  if (!shouldRunVisionGuard(stopReason)) return;
  const inst = store.instances[deviceId];
  if (!inst) return;
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
    store.instances[deviceId] = {
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
    };
    if (prevState === 'posting' && state === 'paused') {
      notifyIrishkaPausedOnServer(instanceName, body.stopReason, body.progress).catch(() => {});
      scheduleVisionGuardScreenshot(deviceId, body.stopReason, body.progress, body.extensionVersion);
    }
    saveFleetStore();
    const commands = drainCommandsForDevice(deviceId, 5);
    return fleetJson(res, 200, { ok: true, state, commands });
  } catch (e) {
    return fleetJson(res, 500, { ok: false, message: e.message });
  }
}

async function handlePoll(req, res, url) {
  if (!fleetAuthOk(req)) return fleetJson(res, 401, { ok: false });
  const deviceId = safeDeviceId(url.searchParams.get('deviceId'));
  if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'deviceId required' });
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
    if (!['stop', 'resume', 'screenshot', 'status', 'skip_group', 'consolidate_fb'].includes(command)) {
      return fleetJson(res, 400, { ok: false, message: 'Invalid command' });
    }
    if (target === 'all') {
      const r = enqueueAll(command, { source: 'webapp' });
      return fleetJson(res, 200, { ok: true, ...r, command });
    }
    const deviceId = safeDeviceId(target);
    if (!deviceId) return fleetJson(res, 400, { ok: false, message: 'Invalid deviceId' });
    if (command === 'status') {
      const inst = publicInstance(store.instances[deviceId] || {});
      const item = enqueueCommand(deviceId, command, { source: 'webapp' });
      return fleetJson(res, 200, { ok: true, queued: item, instance: inst });
    }
    const item = enqueueCommand(deviceId, command, { source: 'webapp' });
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
  };
  return fleetJson(res, 200, { ok: true, summary, instances });
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
  if (req.method === 'GET' && urlPath === '/api/fleet/config') {
    handleFleetConfig(req, res);
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/fleet/validate') {
    handleValidateInit(req, res);
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
