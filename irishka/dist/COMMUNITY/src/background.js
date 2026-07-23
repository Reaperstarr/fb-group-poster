importScripts('build-flags.js');
importScripts('schedule-diagnostics.js');
importScripts('schedule-engine.js');
importScripts('device-health-logic.js');
importScripts('poster-image-idb.js');
importScripts('poster-session-storage.js');
importScripts('facebook-host.js');
importScripts('facebook-detect.js');
importScripts('telegram-bridge.js');
importScripts('fleet-hub-client.js');
importScripts('fleet-remote.js');
importScripts('group-queues.js');
importScripts('join-queue-logic.js');

const DEVICE_HEALTH_KEY = 'irishka_device_health_v1';

async function touchDeviceHealth(patch) {
  try {
    const d = await chrome.storage.local.get([DEVICE_HEALTH_KEY]);
    const prev = d[DEVICE_HEALTH_KEY] && typeof d[DEVICE_HEALTH_KEY] === 'object' ? d[DEVICE_HEALTH_KEY] : {};
    const next = {
      ...prev,
      ...(patch || {}),
      updatedAtMs: Date.now(),
    };
    await chrome.storage.local.set({ [DEVICE_HEALTH_KEY]: next });
  } catch (_) {}
}

async function buildDeviceHealthSnapshot() {
  if (typeof FLEET !== 'undefined' && typeof FLEET.collectStatus === 'function') {
    try {
      await FLEET.init(chrome.storage.local);
    } catch (_) {}
    try {
      const st = await FLEET.collectStatus(chrome.storage.local, RUNSTATE_KEY);
      return {
        ok: true,
        health: st.health || null,
        summary: st.healthSummary || null,
        facebookConnected: st.facebookConnected,
        facebookUserName: st.facebookUserName || '',
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e).slice(0, 120) };
    }
  }
  if (typeof DeviceHealthLogic === 'undefined') {
    return { ok: false, error: 'health_logic_missing' };
  }
  const d = await chrome.storage.local.get([
    'posterRunning',
    RUNSTATE_KEY,
    'posterResults',
    DEVICE_HEALTH_KEY,
    JOIN_QUEUE_KEY,
  ]);
  const rs = d[RUNSTATE_KEY] || null;
  const results = d.posterResults || rs?.results || [];
  const jq = d[JOIN_QUEUE_KEY] || null;
  const joinActive = !!(jq && jq.active && Array.isArray(jq.urls) && (Number(jq.cursor) || 0) < jq.urls.length);
  const healthStore = d[DEVICE_HEALTH_KEY] && typeof d[DEVICE_HEALTH_KEY] === 'object' ? d[DEVICE_HEALTH_KEY] : {};
  const health = DeviceHealthLogic.assess({
    nowMs: Date.now(),
    posterRunning: !!d.posterRunning,
    joinActive,
    facebookConnected: null,
    stopReason: d.posterRunning ? null : (rs?.stopReason || null),
    lastProgressAtMs: healthStore.lastProgressAtMs || null,
    lastError: healthStore.lastError || '',
    plannedStartAtMs: rs?.plannedStartAt || null,
    resumeHint: rs?.resumeHint || '',
    progress: {
      done: results.length,
      total: rs?.config?.groups?.length || 0,
      ok: results.filter((r) => r.success).length,
      currentGroup: '',
    },
    joinQueue: joinActive
      ? {
          cursor: Number(jq.cursor) || 0,
          total: jq.urls.length,
          joinedToday: Number(jq.joinedToday) || 0,
          dailyMax: Number(jq.dailyMax) || 5,
        }
      : {},
  });
  return { ok: true, health, summary: DeviceHealthLogic.formatSummary(health) };
}

function isCommunityFreeBuildBg() {
  return typeof IGM_COMMUNITY_FREE !== 'undefined' && IGM_COMMUNITY_FREE;
}

/** Primero timeline del usuario (facebook.com/me); solo build community. */
function makeProfileTimelineSlotBg() {
  return {
    name: 'My profile (timeline)',
    url: 'https://www.facebook.com/me',
    selected: true,
    canPost: true,
    isProfileTimelineSlot: true
  };
}

function groupsForProgressBroadcast(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map((g) => ({
    name: g.name,
    url: g.url,
    isProfileTimelineSlot: !!g.isProfileTimelineSlot
  }));
}

/** Same key as src/i18n.js — synced when user changes language in the app. */
const LANG_KEY_BG = 'fartmily_lang';
const MAX_POST_IMAGES = 3;

function notificationFinishMessage(lang, ok, total) {
  const M = {
    en: 'Done: {ok}/{total} posts published.',
    es: 'Completado: {ok}/{total} posts publicados.',
    pt: 'Concluído: {ok}/{total} posts publicados.',
    fr: 'Terminé : {ok}/{total} posts publiés.',
    de: 'Fertig: {ok}/{total} Beiträge veröffentlicht.',
    it: 'Completato: {ok}/{total} post pubblicati.',
    ru: 'Готово: {ok}/{total} публикаций.',
    nl: 'Klaar: {ok}/{total} posts gepubliceerd.',
    pl: 'Gotowe: {ok}/{total} postów opublikowanych.',
    tr: 'Tamamlandı: {ok}/{total} gönderi yayınlandı.',
    hi: 'पूर्ण: {ok}/{total} पोस्ट प्रकाशित।',
    tl: 'Tapos: {ok}/{total} na-publish na post.',
    ur: 'مکمل: {ok}/{total} پوسٹس شائع ہوئیں۔',
    bn: 'সম্পন্ন: {ok}/{total}টি পোস্ট প্রকাশিত।',
    id: 'Selesai: {ok}/{total} postingan dipublikasikan.',
    ha: 'An gama: {ok}/{total} posts an wallafa.',
    ar: 'تم: تم نشر {ok}/{total} من المنشورات.',
    vi: 'Xong: đã đăng {ok}/{total} bài.',
    ro: 'Gata: {ok}/{total} postări publicate.'
  };
  return (M[lang] || M.en).replace(/\{ok\}/g, String(ok)).replace(/\{total\}/g, String(total));
}

const PENDING_UPDATE_RELOAD_KEY = 'fartmily_pending_update_reload';
const UPDATE_FROM_VER_KEY = 'fartmily_update_from_version';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'update') return;
  const to = chrome.runtime.getManifest().version;
  const from = details.previousVersion || '';
  chrome.storage.local.set({
    [PENDING_UPDATE_RELOAD_KEY]: true,
    [UPDATE_FROM_VER_KEY]: from,
    fartmily_update_to_version: to
  });
});

// Open app as tab when icon clicked
chrome.action.onClicked.addListener(() => {
  const appUrl = chrome.runtime.getURL('app.html');
  chrome.tabs.query({ url: appUrl }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: appUrl, active: true });
    }
  });
});

// Spintax engine
function spinText(text) {
  let result = text, passes = 20;
  while (passes-- > 0) {
    const prev = result;
    result = result.replace(/\{([^{}]+)\}/g, (_, inner) => {
      const opts = inner.split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
    if (result === prev) break;
  }
  return result;
}

let posterRunning = false;
let stopRequested = false;
let runState = null;
/** Abort in-flight join queue chunk (Stop join / Reset). */
let joinQueueAbortRequested = false;
/** Prevent overlapping join chunks (start + alarm). */
let joinQueueChunkRunning = false;
const RUNSTATE_KEY = 'poster_run_state';
/** Cola de “Unirse a grupos” con tope diario y reanudación a la hora fija. */
const JOIN_QUEUE_KEY = 'irishka_join_queue_v1';
/** POSTER_SESSION_IMAGES_KEY y POSTER_PERSISTED_IMAGES_KEY → poster-session-storage.js */
const PAUSE_BEFORE_PUBLISH = false; // Pausa desactivada por defecto.
const LICENSE_BG_LICENSE_KEY = 'proLicenseKey';
const LICENSE_BG_STATUS_KEY = 'proLicenseStatus';
const LICENSE_BG_INSTALL_KEY = 'installDeviceId';
const LICENSE_BG_VALIDATE_URL = 'https://fb-group-poster-production.up.railway.app/api/license/validate';

function bgNormalizeLicenseKey(input) {
  const hex = String(input || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length === 16) return hex;
  if (hex.length > 16) return hex.slice(0, 16);
  return '';
}

function bgMakeInstallId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bgGetOrCreateInstallId() {
  const data = await chrome.storage.local.get([LICENSE_BG_INSTALL_KEY]);
  let id = String(data[LICENSE_BG_INSTALL_KEY] || '').trim();
  if (!id) {
    id = bgMakeInstallId();
    await chrome.storage.local.set({ [LICENSE_BG_INSTALL_KEY]: id });
  }
  return id;
}

async function runLicenseCheckAlarm() {
  if (typeof IGM_COMMUNITY_FREE !== 'undefined' && IGM_COMMUNITY_FREE) return;
  const data = await chrome.storage.local.get([LICENSE_BG_LICENSE_KEY]);
  const key = bgNormalizeLicenseKey(data[LICENSE_BG_LICENSE_KEY] || '');
  if (!key) return;
  const deviceId = await bgGetOrCreateInstallId();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch(LICENSE_BG_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: key,
        deviceId,
        app: 'irishka-group-master',
        source: 'chrome-extension'
      }),
      signal: ctrl.signal
    });
  } catch {
    clearTimeout(timeout);
    return;
  }
  clearTimeout(timeout);
  if (!res.ok) return;
  let j = {};
  try {
    j = await res.json();
  } catch {
    return;
  }
  const valid = Boolean(j.valid ?? j.ok ?? j.active);
  const status = {
    valid,
    checkedAt: new Date().toISOString(),
    plan: j.plan || j.tier || '',
    message: j.message || '',
    code: j.code || ''
  };
  await chrome.storage.local.set({ [LICENSE_BG_LICENSE_KEY]: key, [LICENSE_BG_STATUS_KEY]: status });
}

function ensureLicenseRecheckAlarm() {
  if (typeof IGM_COMMUNITY_FREE !== 'undefined' && IGM_COMMUNITY_FREE) {
    chrome.alarms.clear('irishka_license_check');
    return;
  }
  chrome.alarms.create('irishka_license_check', { periodInMinutes: 15 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureLicenseRecheckAlarm();
  scheduleIrishkaBridgeAlarm().catch(() => {});
  recoverPostingAfterExtensionReload().catch(() => {});
  initRemoteControl().catch(() => {});
  if (typeof ScheduleEngine !== 'undefined') {
    ScheduleEngine.bootstrap().catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(() => {
  ensureLicenseRecheckAlarm();
  scheduleIrishkaBridgeAlarm().catch(() => {});
  recoverPostingAfterExtensionReload().catch(() => {});
  initRemoteControl().catch(() => {});
  if (typeof ScheduleEngine !== 'undefined') {
    ScheduleEngine.bootstrap().catch(() => {});
  }
});

async function isFleetHubMode() {
  const d = await chrome.storage.local.get(['settings']);
  return !!(d.settings || {}).fleetHubEnabled;
}

async function initRemoteControl() {
  await rehydratePosterImageStoresFromIdb().catch(() => {});
  if (typeof FLEET !== 'undefined') {
    await FLEET.init(chrome.storage.local);
    FLEET.onCommand(handleFleetCommand);
    if (FLEET.isEnabled()) {
      if (typeof TG !== 'undefined') await TG.stopPolling(chrome.alarms);
      await FLEET.startSync(chrome.alarms);
      const ver = chrome.runtime.getManifest().version;
      FLEET.syncNow(chrome.storage.local, RUNSTATE_KEY, ver).catch(() => {});
      return;
    }
    await FLEET.stopSync(chrome.alarms);
  }
  await initTelegramBridge();
}

async function initTelegramBridge() {
  if (typeof TG === 'undefined') return;
  if (await isFleetHubMode()) return;
  await TG.init(chrome.storage.local);
  TG.on(handleTelegramCommand);
  await TG.startPolling(chrome.alarms);
}

async function queryFacebookTabs() {
  return chrome.tabs.query({ url: FACEBOOK_TAB_URL_PATTERNS });
}

/** Never mass-close the user's Facebook tabs — only report which tab to prefer. */
async function consolidateFacebookTabs(preferredTabId) {
  const tabs = await queryFacebookTabs();
  if (!tabs.length) {
    return { kept: null, closed: 0, tabCount: 0 };
  }
  const workerId = runState?.workerTabId || null;
  let keep = null;
  if (workerId && posterRunning) {
    keep = tabs.find((t) => t.id === workerId) || null;
  }
  if (!keep && preferredTabId) {
    keep = tabs.find((t) => t.id === preferredTabId) || null;
  }
  if (!keep) {
    keep = await pickBestFacebookTab(tabs);
  }
  // Closing sibling Facebook tabs was closing user sessions / Fleet "online" tabs.
  return { kept: keep || tabs[0] || null, closed: 0, tabCount: tabs.length };
}

async function probeFacebookTabForFleet(tab) {
  if (!tab?.id) return null;
  if (typeof isChromeErrorTab === 'function' && isChromeErrorTab(tab)) {
    return { connected: false, reason: 'FB tab shows Chrome error page — reload facebook.com' };
  }
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectFBLogin,
    });
    const loginInfo = res?.[0]?.result;
    if (loginInfo?.loggedIn) {
      return {
        connected: true,
        userName: loginInfo.name || '',
        tabId: tab.id,
        windowId: tab.windowId,
        reason: '',
      };
    }
    return {
      connected: false,
      reason: loginInfo?.reason || 'Not logged in',
    };
  } catch (e) {
    const msg = chromeErrMsg(e);
    if (typeof isTabScriptableError === 'function' && isTabScriptableError(msg)) {
      return { connected: false, reason: 'FB tab shows Chrome error page — reload facebook.com' };
    }
    throw e;
  }
}

async function probeFacebookForFleet() {
  try {
    let tabs = await queryFacebookTabs();
    if (tabs.length > 1) {
      const pref = runState?.workerTabId || null;
      await consolidateFacebookTabs(pref);
      tabs = await queryFacebookTabs();
    }
    if (!tabs.length) {
      return { connected: false, userName: '', tabCount: 0, reason: 'No Facebook tab open' };
    }
    const best = await pickBestFacebookTab(tabs);
    const ordered = [];
    if (best?.id) ordered.push(best);
    for (const t of tabs) {
      if (t?.id && !ordered.some((x) => x.id === t.id)) ordered.push(t);
    }
    let lastReason = 'No Facebook tab';
    for (const tab of ordered) {
      const probe = await probeFacebookTabForFleet(tab);
      if (!probe) continue;
      if (probe.connected) {
        return {
          connected: true,
          userName: probe.userName || '',
          tabCount: tabs.length,
          tabId: probe.tabId,
          windowId: probe.windowId,
          reason: '',
        };
      }
      lastReason = probe.reason || lastReason;
    }
    return {
      connected: false,
      userName: '',
      tabCount: tabs.length,
      reason: lastReason,
    };
  } catch (e) {
    return { connected: false, userName: '', tabCount: 0, reason: String(e?.message || e).slice(0, 120) };
  }
}

const FLEET_SCREENSHOT_MAX_B64 = 900000;

async function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function chromeErrMsg(err) {
  return String(err?.message || err || '');
}

function isTabEditBlockedMsg(msg) {
  return /cannot be edited|dragging a tab/i.test(String(msg || ''));
}

function chromeTabsApi(apiFn, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      fn(val);
    };
    try {
      const ret = apiFn(...args, (result) => {
        const err = chrome.runtime.lastError;
        if (err) done(reject, new Error(err.message));
        else done(resolve, result);
      });
      if (ret && typeof ret.then === 'function') {
        ret.then((v) => done(resolve, v)).catch((e) => done(reject, e));
      }
    } catch (e) {
      done(reject, e);
    }
  });
}

async function tryCaptureTabDirect(tabId, quality) {
  if (typeof chrome.tabs.captureTab !== 'function') {
    return { dataUrl: null, err: 'captureTab unavailable' };
  }
  const options = { format: 'jpeg', quality };
  try {
    const maybe = chrome.tabs.captureTab(tabId, options);
    if (maybe && typeof maybe.then === 'function') {
      const dataUrl = await maybe;
      if (dataUrl && typeof dataUrl === 'string') return { dataUrl, err: null };
    }
  } catch (e) {
    const msg = chromeErrMsg(e);
    if (msg) return { dataUrl: null, err: msg };
  }
  try {
    const dataUrl = await chromeTabsApi(chrome.tabs.captureTab, tabId, options);
    if (dataUrl && typeof dataUrl === 'string') return { dataUrl, err: null };
    return { dataUrl: null, err: 'empty captureTab result' };
  } catch (e) {
    return { dataUrl: null, err: chromeErrMsg(e) || 'captureTab failed' };
  }
}

async function tryCaptureVisibleWindow(tab, quality) {
  if (tab.windowId == null) return { dataUrl: null, err: 'missing windowId' };
  try {
    const dataUrl = await chromeTabsApi(
      chrome.tabs.captureVisibleTab,
      tab.windowId,
      { format: 'jpeg', quality }
    );
    if (dataUrl && typeof dataUrl === 'string') return { dataUrl, err: null };
    return { dataUrl: null, err: 'empty captureVisibleTab result' };
  } catch (e) {
    return { dataUrl: null, err: chromeErrMsg(e) || 'captureVisibleTab failed' };
  }
}

async function waitTabReady(tabId, maxMs = 10000) {
  let tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return tab;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      chrome.tabs.get(tabId).then(resolve).catch(() => resolve(tab));
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(onUpd);
    const timer = setTimeout(finish, maxMs);
  });
}

async function prepareWindowAndTabForCapture(tab) {
  let current = tab;
  if (current.windowId != null) {
    try {
      const win = await chrome.windows.get(current.windowId);
      if (win.state === 'minimized') {
        await chromeTabsApi(chrome.windows.update, current.windowId, { state: 'normal', focused: true });
        await sleepMs(500);
      } else {
        await chromeTabsApi(chrome.windows.update, current.windowId, { focused: true, drawAttention: false });
        await sleepMs(300);
      }
    } catch (e) {
      if (!isTabEditBlockedMsg(chromeErrMsg(e))) throw e;
      await sleepMs(700);
    }
  }
  current = await activateTabForCapture(current);
  current = await waitTabReady(current.id);
  await sleepMs(900);
  return current;
}

async function activateTabForCapture(tab) {
  let current = tab;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      current = await chrome.tabs.get(current.id);
    } catch (e) {
      throw new Error(chromeErrMsg(e) || 'Tab closed');
    }
    if (current.active) return current;
    try {
      await chromeTabsApi(chrome.tabs.update, current.id, { active: true });
      await sleepMs(250 + attempt * 200);
      current = await chrome.tabs.get(current.id);
      if (current.active) return current;
    } catch (e) {
      const msg = chromeErrMsg(e);
      if (isTabEditBlockedMsg(msg) && attempt < 5) {
        await sleepMs(500 + attempt * 350);
        continue;
      }
      throw e;
    }
  }
  return current;
}

async function captureTabImage(tab, quality) {
  const attempts = [];
  let direct = await tryCaptureTabDirect(tab.id, quality);
  if (direct.dataUrl) return direct.dataUrl;
  if (direct.err) attempts.push(`captureTab: ${direct.err}`);

  if (tab.active) {
    const visible = await tryCaptureVisibleWindow(tab, quality);
    if (visible.dataUrl) return visible.dataUrl;
    if (visible.err) attempts.push(`visible(active): ${visible.err}`);
  }

  const readyTab = await prepareWindowAndTabForCapture(tab);

  direct = await tryCaptureTabDirect(readyTab.id, quality);
  if (direct.dataUrl) return direct.dataUrl;
  if (direct.err) attempts.push(`captureTab(focused): ${direct.err}`);

  const visibleAfter = await tryCaptureVisibleWindow(readyTab, quality);
  if (visibleAfter.dataUrl) return visibleAfter.dataUrl;
  if (visibleAfter.err) attempts.push(`visible(focused): ${visibleAfter.err}`);

  throw new Error(attempts.join(' · ') || 'Capture failed — keep Facebook visible and retry');
}

async function captureFacebookScreenshot(fbProbe) {
  let lastErr = '';
  try {
    const pref = runState?.workerTabId || fbProbe?.tabId || null;
    const merged = await consolidateFacebookTabs(pref);
    let tabs = await queryFacebookTabs();
    if (!tabs.length && merged.kept?.id) {
      try {
        tabs = [await chrome.tabs.get(merged.kept.id)];
      } catch (_) {}
    }
    if (!tabs.length) return { ok: false, error: 'No Facebook tab open' };

    const ordered = tabs.slice().sort((a, b) => {
      const workerId = runState?.workerTabId;
      if (workerId) {
        if (a.id === workerId) return -1;
        if (b.id === workerId) return 1;
      }
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (b.lastAccessed || 0) - (a.lastAccessed || 0);
    });

    for (const tab of ordered) {
      if (!tab?.id) continue;
      const qualities = [32, 24, 18, 12, 8];
      for (const q of qualities) {
        try {
          const dataUrl = await captureTabImage(tab, q);
          if (!dataUrl || typeof dataUrl !== 'string') continue;
          const b64Len = dataUrl.replace(/^data:image\/\w+;base64,/, '').length;
          if (b64Len <= FLEET_SCREENSHOT_MAX_B64) return { ok: true, dataUrl };
          lastErr = `Image too large (${Math.round(b64Len / 1024)}KB) at q=${q}`;
        } catch (e) {
          lastErr = chromeErrMsg(e).slice(0, 180);
          if (isTabEditBlockedMsg(lastErr)) {
            lastErr = 'Chrome blocked tab switch — release tab drag, click Facebook, retry';
          }
        }
      }
    }

    if (fbProbe?.tabId) {
      try {
        const tab = await chrome.tabs.get(fbProbe.tabId);
        const dataUrl = await captureTabImage(tab, 8);
        if (dataUrl) return { ok: true, dataUrl };
      } catch (e) {
        lastErr = chromeErrMsg(e).slice(0, 180);
      }
    }

    return { ok: false, error: lastErr || 'Capture failed — keep Facebook visible and retry' };
  } catch (e) {
    return { ok: false, error: chromeErrMsg(e).slice(0, 180) };
  }
}

async function doFleetSkipGroupAndResume() {
  const d = await chrome.storage.local.get([RUNSTATE_KEY, 'posterResults']);
  const saved = runState || d[RUNSTATE_KEY];
  if (!saved?.config) {
    return { ok: false, message: 'No saved run state' };
  }
  runState = { ...saved };
  const total = runState.config.groups?.length || 0;
  if (total && runState.index < total) {
    runState.index = Math.min(total, Number(runState.index || 0) + 1);
    persistRunState();
  }
  const ok = await doResumePostingAfterPause();
  return { ok, message: ok ? 'Skipped group + resumed' : 'Could not resume' };
}

async function fleetVisionCaptureAfterPause(stopReason, pauseDetail) {
  try {
    if (typeof FLEET === 'undefined') return;
    await FLEET.init(chrome.storage.local);
    if (!FLEET.isEnabled()) return;
    if (typeof FLEET.visionAutoEnabled === 'function' && !FLEET.visionAutoEnabled()) return;
    if (stopReason !== 'post_failure_pause') return;
    await sleep(1800);
    const fb = await probeFacebookForFleet();
    if (!fb.connected) return;
    let domHint = '';
    if (fb.tabId) {
      try {
        const inj = await chrome.scripting.executeScript({
          target: { tabId: fb.tabId },
          func: () => {
            const t = (document.body?.innerText || '').slice(0, 5000).toLowerCase();
            const hits = [];
            if (/automat(ed|ic)|automated behavior|actividad automatizada|comportamiento automatizado/.test(t)) {
              hits.push('automation_text');
            }
            if (/only admins can post|solo los administradores pueden publicar|solo administradores/.test(t)) {
              hits.push('admin_only');
            }
            if (/can'?t post|no puedes publicar|cannot post|no se puede publicar/.test(t)) {
              hits.push('cannot_post');
            }
            if (/checkpoint|confirm your identity|captcha|unusual activity/.test(t)) {
              hits.push('checkpoint');
            }
            if (/content not found|group isn'?t available|grupo no est/.test(t)) {
              hits.push('group_gone');
            }
            return hits.join(',');
          },
        });
        domHint = String(inj?.[0]?.result || '');
      } catch (_) {}
    }
    const shot = await Promise.race([
      captureFacebookScreenshot(fb),
      sleepMs(25000).then(() => ({ ok: false, error: 'timeout' })),
    ]);
    if (!shot.ok) return;
    await FLEET.uploadScreenshot(shot.dataUrl, {
      visionGuard: true,
      pauseContext: {
        stopReason,
        groupName: String(pauseDetail?.groupName || '').slice(0, 120),
        lastError: String(pauseDetail?.error || '').slice(0, 240),
        domHint,
      },
    });
    const ver = chrome.runtime.getManifest().version;
    if (typeof FLEET.syncNow === 'function') {
      await FLEET.syncNow(chrome.storage.local, RUNSTATE_KEY, ver);
    }
  } catch (_) {}
}

async function doFleetPausePosting() {
    if (posterRunning && runState) {
    stopRequested = true;
    runState.stopReason = 'user_pause';
    runState.resumeHint = 'user_pause';
    return { ok: true, message: 'Pausing…' };
  }
  const d = await chrome.storage.local.get([RUNSTATE_KEY]);
  const saved = runState || d[RUNSTATE_KEY];
  if (saved?.config) {
    runState = { ...saved, stopReason: 'user_pause', resumeHint: 'user_pause' };
    stopRequested = true;
    posterRunning = false;
    await chrome.storage.local.set({ posterRunning: false });
    persistRunState();
    broadcastToApp({ action: 'postingStopped', stopReason: 'user_pause' });
    return { ok: true, message: 'Paused' };
  }
  posterRunning = false;
  await chrome.storage.local.set({ posterRunning: false });
  return { ok: true, message: 'Already idle' };
}

async function handleFleetCommand(cmd) {
  const command = String(cmd?.command || '').toLowerCase();
  if (!command) return { ok: false, message: 'empty command' };
  try {
    if (command === 'stop') {
      return await doFleetPausePosting();
    }
    if (command === 'resume') {
      const ok = await doResumePostingAfterPause();
      return { ok, message: ok ? 'Resumed' : 'No saved run state — start posting in Irishka first' };
    }
    if (command === 'skip_group') {
      return await doFleetSkipGroupAndResume();
    }
    if (command === 'reload_extension') {
      setTimeout(() => { chrome.runtime.reload(); }, 300);
      return { ok: true, message: 'Reloading extension' };
    }
    if (command === 'status') {
      const d = await chrome.storage.local.get(['posterRunning', RUNSTATE_KEY, 'posterResults']);
      const running = !!d.posterRunning;
      const rs = d[RUNSTATE_KEY] || null;
      const results = d.posterResults || rs?.results || [];
      const total = rs?.config?.groups?.length || 0;
      const done = results.length;
      const ok = results.filter((r) => r.success).length;
      const fb = await probeFacebookForFleet();
      const fbLabel = fb.connected ? (fb.userName || 'connected') : (fb.reason || 'offline');
      return {
        ok: true,
        message: `${running ? 'posting' : rs ? 'paused' : 'idle'} ${done}/${total} ok=${ok} | FB: ${fbLabel}`,
      };
    }
    if (command === 'screenshot') {
      const fb = await probeFacebookForFleet();
      if (!fb.connected) {
        return { ok: false, message: fb.reason || 'Facebook not connected' };
      }
      const shot = await Promise.race([
        captureFacebookScreenshot(fb),
        sleepMs(25000).then(() => ({ ok: false, error: 'Capture timeout (25s)' })),
      ]);
      if (!shot.ok) {
        const hint = /blocked tab switch|dragging a tab/i.test(shot.error || '')
          ? ' — si Facebook pide confirmar salir de la página, haz clic en la pestaña FB y acepta una vez'
          : '';
        return { ok: false, message: (shot.error || 'Capture failed') + hint };
      }
      if (typeof FLEET !== 'undefined') {
        const d = await chrome.storage.local.get([RUNSTATE_KEY]);
        const rs = runState || d[RUNSTATE_KEY];
        const last = rs?.results?.length ? rs.results[rs.results.length - 1] : null;
        const visionMeta = cmd?.meta?.visionGuard
          ? {
              visionGuard: true,
              pauseContext: {
                stopReason: rs?.stopReason || cmd.meta.stopReason || 'post_failure_pause',
                groupName: last?.name || rs?.progress?.currentGroup || '',
                lastError: last?.error || '',
                domHint: '',
              },
            }
          : undefined;
        const up = await FLEET.uploadScreenshot(shot.dataUrl, visionMeta);
        return { ok: up.ok, message: up.ok ? 'Screenshot sent' : (up.message || 'Upload failed') };
      }
      return { ok: false, message: 'Fleet client missing' };
    }
    if (command === 'consolidate_fb' || command === 'cleanfb') {
      const fb = await probeFacebookForFleet();
      const n = fb.tabCount || 0;
      return {
        ok: true,
        message: n
          ? `Auto-close disabled — ${n} Facebook tab(s) left open (close extras manually if needed)`
          : 'No Facebook tabs open',
      };
    }
    if (typeof FLEET_REMOTE !== 'undefined') {
      const remote = await FLEET_REMOTE.handleRemoteCommand(cmd, RUNSTATE_KEY);
      if (remote) return remote;
    }
    return { ok: false, message: 'Unknown command' };
  } catch (e) {
    return { ok: false, message: String(e?.message || e).slice(0, 120) };
  }
}

function doStopPosting(stopReason) {
  stopRequested = true;
  posterRunning = false;
  runState = null;
  chrome.alarms.clear('fartmily_resume');
  if (typeof ScheduleEngine !== 'undefined') {
    ScheduleEngine.cancelSchedule(stopReason || 'user_stop').catch(() => {});
  } else {
    try { chrome.alarms.clear('irishka_poster_wake'); } catch (_) {}
  }
  chrome.storage.local.remove(RUNSTATE_KEY);
  chrome.storage.local.remove(['fartmily_pending_images']);
  clearPosterSessionStorage(false);
  chrome.storage.local.set({ posterRunning: false });
  broadcastToApp({ action: 'postingStopped', stopReason: stopReason || 'user_stop' });
}

async function ensureRunStateForConfigPatch() {
  if (runState && runState.config) return true;
  const d = await chrome.storage.local.get([RUNSTATE_KEY]);
  const saved = d[RUNSTATE_KEY];
  if (!saved || !saved.config) return false;
  runState = { ...saved };
  if (runState.postIndex === undefined) runState.postIndex = 0;
  return true;
}

async function doResumePostingAfterPause() {
  try {
    const d = await chrome.storage.local.get([RUNSTATE_KEY]);
    const saved = runState || d[RUNSTATE_KEY];
    if (!saved || !saved.config) return false;
    runState = { ...saved, stopReason: null };
    delete runState.resumeHint;
    stopRequested = false;
    posterRunning = true;
    await syncRunningConfigFromStorage(runState.config);
    await chrome.storage.local.set({ posterRunning: true });
    persistRunState();
    const numPosts = normalizePosts(runState.config).length;
    broadcastToApp({
      action: 'postRunStateResumed',
      groupsForProgress: groupsForProgressBroadcast(runState.config.groups || []),
      postIndex: runState.postIndex || 0,
      totalPosts: numPosts,
      loopInfinite: !!runState.config.loopInfinite,
    });
    await hydratePosterImagesFromSession(runState.config);
    runPostingLoop().catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

async function handleTelegramCommand(payload) {
  const cmd = String(payload?.command || '').toLowerCase();
  if (!cmd || typeof TG === 'undefined') return;
  try {
    if (cmd === 'stop' || cmd === 'stop_all') {
      doStopPosting('user_stop_remote');
      await TG.notifyAlert({ title: 'Stopped', body: `Posting stopped on [${TG.instanceName()}].` });
      return;
    }
    if (cmd === 'resume' || cmd === 'resume_all') {
      const ok = await doResumePostingAfterPause();
      await TG.notifyAlert({
        title: ok ? 'Resumed' : 'Resume failed',
        body: ok ? `Posting resumed on [${TG.instanceName()}].` : `No saved run state found on [${TG.instanceName()}].`,
      });
      return;
    }
    if (cmd === 'status' || cmd === 'active' || cmd === 'help' || cmd === 'start') {
      const d = await chrome.storage.local.get(['posterRunning', RUNSTATE_KEY, 'posterResults']);
      const running = !!d.posterRunning;
      const rs = d[RUNSTATE_KEY] || null;
      const results = d.posterResults || rs?.results || [];
      const total = rs?.config?.groups?.length || 0;
      const done = results.length;
      const ok = results.filter((r) => r.success).length;
      await TG.notifyAlert({
        title: `Status [${TG.instanceName()}]`,
        body:
          `State: ${running ? 'posting' : rs ? 'paused' : 'idle'}\n` +
          `Progress: ${done}/${total}\n` +
          `Successful: ${ok}\n` +
          'Commands: /status /resume /stop',
      });
    }
  } catch (e) {
    try {
      await TG.notifyAlert({ title: 'Command error', body: String(e?.message || e).slice(0, 180) });
    } catch (_) {}
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startPosting') {
    // return true + sendResponse when done keeps the MV3 service worker alive for the whole run.
    // Config se lee desde storage (evita límite/tamaño de sendMessage con posts + data URLs).
    startPostingProcess(msg.config, msg.groupsSnapshot, {
      startGroupIndex: msg.startGroupIndex,
      startGroupUrl: msg.startGroupUrl,
    })
      .then(() => {
        try {
          sendResponse({ ok: true });
        } catch (_) {}
      })
      .catch(() => {
        try {
          sendResponse({ ok: false });
        } catch (_) {}
      });
    return true;
  }
  if (msg.action === 'stopPosting') {
    const stopReason = (msg && msg.stopReason) || 'user_stop';
    stopRequested = true;
    if (stopReason === 'user_pause') {
      if (runState) {
        runState.stopReason = 'user_pause';
        runState.resumeHint = 'user_pause';
      }
      posterRunning = false;
      chrome.storage.local.set({ posterRunning: false });
      persistRunState();
    } else {
      posterRunning = false;
      runState = null;
      chrome.alarms.clear('fartmily_resume');
      if (typeof ScheduleEngine !== 'undefined') {
        ScheduleEngine.cancelSchedule(stopReason).catch(() => {});
      } else {
        try { chrome.alarms.clear('irishka_poster_wake'); } catch (_) {}
      }
      chrome.storage.local.remove(RUNSTATE_KEY);
      chrome.storage.local.remove(['fartmily_pending_images']);
      clearPosterSessionStorage(false);
      chrome.storage.local.set({ posterRunning: false });
      broadcastToApp({ action: 'postingStopped', stopReason });
    }
  }
  if (msg.action === 'resumePostingAfterPause') {
    doResumePostingAfterPause()
      .then((ok) => {
        try { sendResponse({ ok: !!ok }); } catch (_) {}
      })
      .catch(() => {
        try { sendResponse({ ok: false }); } catch (_) {}
      });
    return true;
  }
  if (msg.action === 'resumeProgrammedPosting') {
    resumePostingFromStoredRunState()
      .then((r) => {
        try {
          sendResponse(r);
        } catch (_) {}
      })
      .catch(() => {
        try {
          sendResponse({ ok: false, error: 'exception' });
        } catch (_) {}
      });
    return true;
  }
  if (msg.action === 'startJoinQueue') {
    (async () => {
      try {
        const r = await beginJoinQueueFromMessage(msg);
        try {
          sendResponse(r);
        } catch (_) {}
      } catch (e) {
        try {
          sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
        } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === 'stopJoinQueue') {
    (async () => {
      try {
        await stopJoinQueueInternal();
        sendResponse({ ok: true });
      } catch (e) {
        try {
          sendResponse({ ok: false, error: String(e?.message || e) });
        } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === 'irishkaBridgePollNow') {
    if (!isCommunityFreeBuildBg()) {
      try {
        sendResponse({ ok: false });
      } catch (_) {}
      return false;
    }
    pollIrishkaBridgeOnce()
      .then(() => {
        try {
          sendResponse({ ok: true });
        } catch (_) {}
      })
      .catch(() => {
        try {
          sendResponse({ ok: false });
        } catch (_) {}
      });
    return true;
  }
  if (msg.action === 'schedulePostingAt') {
    schedulePostingAtFromApp(Number(msg.atMs))
      .then((r) => {
        try {
          sendResponse(r);
        } catch (_) {}
      })
      .catch(() => {
        try {
          sendResponse({ ok: false, error: 'exception' });
        } catch (_) {}
      });
    return true;
  }
  if (msg.action === 'checkScheduledDue') {
    const run = typeof ScheduleEngine !== 'undefined'
      ? ScheduleEngine.tick({ source: 'ui_poll' })
      : maybeResumeProgrammedIfDue().then((started) => ({ ok: true, started: !!started }));
    run
      .then((r) => {
        try {
          sendResponse({ ok: true, started: !!(r && r.started) });
        } catch (_) {}
      })
      .catch(() => {
        try {
          sendResponse({ ok: false, started: false });
        } catch (_) {}
      });
    return true;
  }
  if (msg.action === 'getScheduleDiagnostics') {
    (async () => {
      try {
        if (typeof ScheduleDiag === 'undefined') {
          sendResponse({ ok: false, error: 'no_diag' });
          return;
        }
        if (msg.clearFirst) await ScheduleDiag.clear();
        const dump = await ScheduleDiag.dump();
        sendResponse({ ok: true, dump });
      } catch (e) {
        try {
          sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
        } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === 'clearScheduleDiagnostics') {
    (async () => {
      try {
        if (typeof ScheduleDiag !== 'undefined') await ScheduleDiag.clear();
        sendResponse({ ok: true });
      } catch (_) {
        try { sendResponse({ ok: false }); } catch (__) {}
      }
    })();
    return true;
  }
  if (msg.action === 'cancelScheduledPosting') {
    (async () => {
      const r = await cancelScheduledPostingFromApp();
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'setPosterLoopInfinite') {
    (async () => {
      const r = await setPosterLoopInfiniteFromApp(Boolean(msg.loopInfinite));
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'skipCurrentPosterPost') {
    (async () => {
      const r = await requestSkipCurrentPosterPost();
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'appendPostToRunningLoop') {
    (async () => {
      const r = await appendPostToRunningLoopFromMessage(msg.post);
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'appendGroupsToRunningActive') {
    (async () => {
      const r = await appendGroupsToRunningActiveFromMessage(msg.groups);
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'getPosterQueueStatus') {
    try {
      sendResponse({
        ok: true,
        running: !!posterRunning,
        activeCount: Array.isArray(runState?.config?.groups) ? runState.config.groups.length : 0,
        retryCount: Array.isArray(runState?.retryGroups) ? runState.retryGroups.length : 0,
        index: runState?.index ?? 0,
        retryGroups: Array.isArray(runState?.retryGroups) ? runState.retryGroups : [],
      });
    } catch (_) {
      try { sendResponse({ ok: false }); } catch (__) {}
    }
    return false;
  }
  if (msg.action === 'fleetQueuePost') {
    (async () => {
      const r = await fleetQueuePostFromMessage(msg.post, {
        replaceQueue: msg.replaceQueue === true,
      });
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'fleetRemovePost') {
    (async () => {
      const r = await fleetRemovePostFromMessage(msg.index);
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'fleetStartPosting') {
    (async () => {
      const r = await fleetStartPostingFromMessage();
      try {
        sendResponse(r);
      } catch (_) {}
    })();
    return true;
  }
  if (msg.action === 'tgTestConnection') {
    (async () => {
      try {
        await TG.init(chrome.storage.local);
        const r = await TG.testConnection();
        sendResponse(r);
      } catch (e) {
        try { sendResponse({ ok: false, error: String(e?.message || e) }); } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === 'tgSettingsChanged') {
    (async () => {
      try {
        await initRemoteControl();
        sendResponse({ ok: true });
      } catch (e) {
        try { sendResponse({ ok: false, error: String(e?.message || e) }); } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === 'fleetHubSettingsChanged') {
    (async () => {
      try {
        await initRemoteControl();
        sendResponse({ ok: true });
      } catch (e) {
        try { sendResponse({ ok: false, error: String(e?.message || e) }); } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === 'fleetHubTest') {
    (async () => {
      try {
        if (typeof FLEET === 'undefined') {
          sendResponse({ ok: false, error: 'Fleet client missing' });
          return;
        }
        await FLEET.init(chrome.storage.local);
        if (!FLEET.isEnabled()) {
          sendResponse({ ok: false, error: 'Enable Fleet Hub + secret' });
          return;
        }
        if (typeof FLEET.fleetFetch !== 'function') {
          sendResponse({ ok: false, error: 'Fleet client broken (fleetFetch missing)' });
          return;
        }
        const ver = chrome.runtime.getManifest().version;
        const hb = await FLEET.sendHeartbeat(chrome.storage.local, RUNSTATE_KEY, ver);
        const health = await buildDeviceHealthSnapshot().catch(() => null);
        sendResponse({
          ok: !!hb?.ok,
          error: hb?.ok ? '' : 'Heartbeat failed — check secret/URL',
          healthSummary: health?.summary || '',
        });
      } catch (e) {
        try { sendResponse({ ok: false, error: String(e?.message || e) }); } catch (_) {}
      }
    })();
    return true;
  }
  if (msg.action === 'getDeviceHealth') {
    (async () => {
      try {
        const r = await buildDeviceHealthSnapshot();
        sendResponse(r);
      } catch (e) {
        try { sendResponse({ ok: false, error: String(e?.message || e).slice(0, 120) }); } catch (_) {}
      }
    })();
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (typeof ScheduleDiag !== 'undefined') {
    ScheduleDiag.log('alarm.fired', {
      name: alarm && alarm.name,
      scheduledTime: alarm && alarm.scheduledTime,
      scheduledIso: alarm && alarm.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : null
    });
  }
  if (typeof FLEET !== 'undefined' && alarm.name === FLEET.fastAlarmName()) {
    const ver = chrome.runtime.getManifest().version;
    return FLEET.tickFast(chrome.storage.local, RUNSTATE_KEY, ver, chrome.alarms).catch(() => {});
  }
  if (typeof FLEET !== 'undefined' && alarm.name === FLEET.alarmName()) {
    const ver = chrome.runtime.getManifest().version;
    return (async () => {
      await FLEET.syncNow(chrome.storage.local, RUNSTATE_KEY, ver).catch(() => {});
      await FLEET.scheduleFastPoll(chrome.alarms).catch(() => {});
    })();
  }
  if (typeof TG !== 'undefined' && alarm.name === TG.pollAlarmName()) {
    return TG.pollNow().catch(() => {});
  }
  if (alarm.name === 'irishka_license_check') {
    if (typeof IGM_COMMUNITY_FREE !== 'undefined' && IGM_COMMUNITY_FREE) return;
    return runLicenseCheckAlarm().catch(() => {});
  }
  if (alarm.name === 'irishka_bridge_poll') {
    return (async () => {
      if (isCommunityFreeBuildBg()) await pollIrishkaBridgeOnce().catch(() => {});
      if (typeof ScheduleEngine !== 'undefined') await ScheduleEngine.tick({ source: 'bridge_poll' }).catch(() => {});
    })();
  }
  if (alarm.name === 'irishka_join_resume') {
    return runJoinQueueChunk().catch(() => {});
  }
  // Canonical schedule wake ( + legacy alarm names during migration )
  if (typeof ScheduleEngine !== 'undefined' && ScheduleEngine.isEngineAlarm(alarm.name)) {
    return ScheduleEngine.onAlarm(alarm);
  }
  return undefined;
});

async function startPostingProcess(msgConfig, groupsSnapshot, startOpts) {
  const stored = await chrome.storage.local.get(['posterConfig']);
  const base = stored.posterConfig && typeof stored.posterConfig === 'object' ? { ...stored.posterConfig } : {};
  const config = { ...base };
  if (Array.isArray(groupsSnapshot) && groupsSnapshot.length > 0) {
    config.groups = groupsSnapshot;
  }
  if (!Array.isArray(config.groups) || config.groups.length === 0) {
    const mc = msgConfig && typeof msgConfig === 'object' ? msgConfig : null;
    if (mc && Array.isArray(mc.groups) && mc.groups.length > 0) {
      Object.assign(config, mc);
      config.groups = mc.groups;
    }
  }
  if (!Array.isArray(config.groups) || config.groups.length === 0) {
    posterRunning = false;
    await chrome.storage.local.set({ posterRunning: false });
    broadcastToApp({ action: 'postingStopped', stopReason: 'bad_config' });
    return;
  }

  // Default OFF: unattended runs quarantine failures into retryGroups instead of pausing.
  if (typeof config.pauseOnFailedPublication !== 'boolean') {
    config.pauseOnFailedPublication = false;
  }

  if (isCommunityFreeBuildBg() && config.communityProfileFirst !== false) {
    config.groups = [makeProfileTimelineSlotBg(), ...config.groups];
  }

  await hydratePosterImagesFromSession(config);

  const Q = typeof IrishkaGroupQueues !== 'undefined' ? IrishkaGroupQueues : null;
  let startIndex = 0;
  const opts = startOpts && typeof startOpts === 'object' ? startOpts : {};
  if (opts.startGroupUrl && Q) {
    const idx = Q.findIndexByUrl(config.groups, opts.startGroupUrl);
    if (idx >= 0) startIndex = idx;
  } else if (Number.isFinite(Number(opts.startGroupIndex))) {
    startIndex = Q
      ? Q.clampStartIndex(config.groups, opts.startGroupIndex)
      : Math.max(0, Math.min(config.groups.length - 1, Math.floor(Number(opts.startGroupIndex))));
  }

  posterRunning = true;
  stopRequested = false;
  try { chrome.alarms.clear('fartmily_resume'); } catch (_) {}
  try { chrome.alarms.clear('fartmily_resume_watch'); } catch (_) {}
  try { chrome.alarms.clear('irishka_poster_wake'); } catch (_) {}
  if (typeof ScheduleEngine !== 'undefined') {
    ScheduleEngine.cancelSchedule('replaced_by_start').catch(() => {});
  }
  chrome.storage.local.remove(RUNSTATE_KEY);
  const now = Date.now();
  const plannedStartAt = null;
  runState = {
    config,
    results: [],
    index: startIndex,
    postIndex: 0,
    dailySuccessCount: 0,
    dailyKey: dayKey(now),
    startedOnce: false,
    plannedStartAt,
    stopReason: null,
    workerTabId: null,
    retryGroups: [],
    // Snapshot order is the walk — do not replace from fbGroups mid-campaign.
    lockGroupWalkOrder: true,
  };
  chrome.storage.local.set({ posterRunning: true, posterResults: [] });
  persistRunState();
  await runPostingLoop();
}

/** Re-read checked groups from storage each loop round (same rules as app start). */
async function refreshGroupsForLoop(config) {
  const d = await chrome.storage.local.get(['fbGroups']);
  const raw = d.fbGroups || [];
  let sel = raw.filter(g => g.selected);
  if (config.verifiedOnlyEnabled) {
    sel = sel.filter(g => g.canPost === true);
  }
  // If storage is empty or not flushed yet (race with UI), use groups from the start message.
  if (!sel.length && Array.isArray(config.groups) && config.groups.length) {
    sel = config.verifiedOnlyEnabled
      ? config.groups.filter(g => g.canPost === true)
      : [...config.groups];
  }
  return sel;
}

async function verifyUnverifiedGroupsForInfiniteLoop(tabId, config) {
  const d = await chrome.storage.local.get(['fbGroups']);
  const groups = Array.isArray(d.fbGroups) ? d.fbGroups.map((g) => ({ ...g })) : [];
  const targets = groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g && g.selected && g.canPost !== true && g.canPost !== false);
  if (!targets.length) return { checked: 0, newlyVerified: 0 };

  broadcastToApp({
    action: 'loopVerifyProgress',
    current: 0,
    total: targets.length,
    groupName: '',
  });

  let newlyVerified = 0;
  let activeTabId = tabId;
  for (let k = 0; k < targets.length; k++) {
    if (stopRequested) break;
    const { g, i } = targets[k];
    broadcastToApp({
      action: 'loopVerifyProgress',
      current: k + 1,
      total: targets.length,
      groupName: g.name || g.url || '',
    });
    try {
      const nav = await navigateWorker(activeTabId, g.url, config);
      if (nav?.tabId) activeTabId = nav.tabId;
      await sleep(5200);
      const inj = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: detectGroupPostabilityInPage,
      });
      const result = inj?.[0]?.result || {};
      groups[i].canPost = !!result.canPost;
      if (typeof result.isMember === 'boolean') groups[i].isMember = result.isMember;
      groups[i].postabilityCheckedAt = Date.now();
      if (groups[i].canPost) newlyVerified++;
    } catch (_) {}
  }
  await chrome.storage.local.set({ fbGroups: groups });
  broadcastToApp({ action: 'groupsListChanged' });
  return { checked: targets.length, newlyVerified, tabId: activeTabId };
}

async function applyRefreshedGroupsForNextLoop(config) {
  const fresh = await refreshGroupsForLoop(config);
  if (!fresh.length) return [];
  let groupsForRun = fresh;
  if (isCommunityFreeBuildBg() && config.communityProfileFirst !== false) {
    groupsForRun = [makeProfileTimelineSlotBg(), ...fresh];
  }
  runState.config.groups = groupsForRun;
  await mergePosterConfigGroups(fresh);
  persistRunState();
  return groupsForRun;
}

/** Al cerrar una vuelta del loop infinito: re-verifica retry, luego pendientes, y actualiza la cola. */
async function processRetryGroupsAtRoundEnd(tabId, config) {
  const Q = typeof IrishkaGroupQueues !== 'undefined' ? IrishkaGroupQueues : null;
  const retry = Array.isArray(runState?.retryGroups) ? runState.retryGroups.slice() : [];
  if (!retry.length) {
    return { restored: 0, removed: 0, restoredUrls: [], removedUrls: [] };
  }

  broadcastToApp({
    action: 'loopRetryProgress',
    current: 0,
    total: retry.length,
    groupName: '',
  });

  const d = await chrome.storage.local.get(['fbGroups']);
  const groups = Array.isArray(d.fbGroups) ? d.fbGroups.map((g) => ({ ...g })) : [];
  const restoredUrls = [];
  const removedUrls = [];
  let activeTabId = tabId;

  for (let k = 0; k < retry.length; k++) {
    if (stopRequested) break;
    const row = retry[k];
    const url = row?.url || '';
    broadcastToApp({
      action: 'loopRetryProgress',
      current: k + 1,
      total: retry.length,
      groupName: row?.name || url || '',
    });
    const idx = Q ? Q.findIndexByUrl(groups, url) : groups.findIndex((g) => g.url === url);
    try {
      const nav = await navigateWorker(activeTabId, url, config);
      if (nav?.tabId) activeTabId = nav.tabId;
      await sleep(5200);
      const inj = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: detectGroupPostabilityInPage,
      });
      const result = inj?.[0]?.result || {};
      const canPost = !!result.canPost;
      if (idx >= 0) {
        groups[idx].canPost = canPost;
        if (typeof result.isMember === 'boolean') groups[idx].isMember = result.isMember;
        groups[idx].postabilityCheckedAt = Date.now();
        if (canPost) {
          groups[idx].selected = true;
          restoredUrls.push(url);
        } else {
          groups[idx].selected = false;
          removedUrls.push(url);
        }
      } else if (canPost) {
        restoredUrls.push(url);
      } else {
        removedUrls.push(url);
      }
    } catch (_) {
      if (idx >= 0) {
        groups[idx].canPost = false;
        groups[idx].selected = false;
        groups[idx].postabilityCheckedAt = Date.now();
      }
      removedUrls.push(url);
    }
  }

  if (runState) runState.retryGroups = [];
  await chrome.storage.local.set({ fbGroups: groups });
  broadcastToApp({ action: 'groupsListChanged' });
  broadcastToApp({
    action: 'retryQueueUpdated',
    retryCount: 0,
    restored: restoredUrls.length,
    removed: removedUrls.length,
  });
  return {
    restored: restoredUrls.length,
    removed: removedUrls.length,
    restoredUrls,
    removedUrls,
  };
}

function moveUrlsToEndOfGroups(list, urls) {
  const Q = typeof IrishkaGroupQueues !== 'undefined' ? IrishkaGroupQueues : null;
  const keys = new Set((urls || []).map((u) => (Q ? Q.normUrl(u) : String(u || '').toLowerCase())).filter(Boolean));
  if (!keys.size) return Array.isArray(list) ? list.slice() : [];
  const head = [];
  const tail = [];
  for (const g of list || []) {
    const k = Q ? Q.groupKey(g) : String(g?.url || '').toLowerCase();
    if (keys.has(k)) tail.push(g);
    else head.push(g);
  }
  return head.concat(tail);
}

async function finalizeInfiniteLoopRound(workerTab, config) {
  // End of round is the only place we rebuild the walk from storage.
  if (runState) runState.lockGroupWalkOrder = false;
  const retryStats = await processRetryGroupsAtRoundEnd(workerTab.id, config);
  const verifyStats = await verifyUnverifiedGroupsForInfiniteLoop(workerTab.id, config);
  let groupsForRun = await applyRefreshedGroupsForNextLoop(config);
  if (retryStats.restoredUrls && retryStats.restoredUrls.length) {
    groupsForRun = moveUrlsToEndOfGroups(groupsForRun, retryStats.restoredUrls);
    if (runState?.config) runState.config.groups = groupsForRun;
  }
  if (runState) {
    runState.lockGroupWalkOrder = true;
    persistRunState();
  }
  return { groupsForRun, verifyStats, retryStats };
}

async function mergePosterConfigGroups(groups) {
  const d = await chrome.storage.local.get(['posterConfig']);
  const pc = { ...(d.posterConfig || {}), groups };
  await chrome.storage.local.set({ posterConfig: pc });
}

/** Pull current posts + loop flags from storage so resume/pause stays in sync with the app UI. */
function mergePostsFromRunAndStorage(runPosts, storagePosts) {
  const a = Array.isArray(runPosts) ? runPosts : [];
  const b = Array.isArray(storagePosts) ? storagePosts : [];
  const len = Math.max(a.length, b.length);
  if (!len) return [];
  const out = [];
  for (let i = 0; i < len; i++) {
    const ra = a[i] || { text: '', images: [] };
    const rb = b[i] || { text: '', images: [] };
    const textA = String(ra.text || '').trim();
    const textB = String(rb.text || '').trim();
    const pick = textA ? ra : (textB ? rb : ra);
    const imgsA = Array.isArray(ra.images) ? ra.images : [];
    const imgsB = Array.isArray(rb.images) ? rb.images : [];
    const aHasPixels = imgsA.some((img) => String(img?.dataUrl || '').length > 80);
    const images = aHasPixels ? imgsA : (imgsB.length ? imgsB : imgsA);
    out.push({
      text: String(pick.text || ra.text || rb.text || ''),
      images: images.map((img) => ({
        name: (img && img.name) || '',
        type: (img && img.type) || 'image/jpeg',
        dataUrl: (img && img.dataUrl) || ''
      }))
    });
  }
  return out;
}

async function syncRunningConfigFromStorage(config) {
  if (!config || typeof config !== 'object') return config;
  const d = await chrome.storage.local.get(['posterConfig']);
  const pc = d.posterConfig && typeof d.posterConfig === 'object' ? d.posterConfig : null;
  if (!pc) return config;

  if (typeof pc.loopInfinite === 'boolean') config.loopInfinite = pc.loopInfinite;
  if (typeof pc.verifiedOnlyEnabled === 'boolean') config.verifiedOnlyEnabled = pc.verifiedOnlyEnabled;
  if (typeof pc.pauseOnFailedPublication === 'boolean') {
    config.pauseOnFailedPublication = pc.pauseOnFailedPublication;
  }

  const existingPosts = Array.isArray(config.posts) ? config.posts.length : 0;
  if (Array.isArray(pc.posts) && pc.posts.length) {
    const merged = mergePostsFromRunAndStorage(config.posts, pc.posts);
    config.posts = merged.map((p) => ({
      text: String((p && p.text) || ''),
      images: (p && Array.isArray(p.images) ? p.images : []).map((img) => ({
        name: (img && img.name) || '',
        type: (img && img.type) || 'image/jpeg',
        dataUrl: (img && img.dataUrl) || ''
      }))
    }));
    config.text = String(config.posts[0]?.text || '');
    config.images = (config.posts[0]?.images || []).slice(0, MAX_POST_IMAGES);
    await hydratePosterImagesFromSession(config);
    return config;
  }
  if (existingPosts <= 1 && typeof pc.text === 'string' && (!Array.isArray(config.posts) || config.posts.length <= 1)) {
    config.posts = [{
      text: String(pc.text || ''),
      images: Array.isArray(pc.images) ? pc.images.slice(0, MAX_POST_IMAGES) : []
    }];
    config.text = config.posts[0].text;
    config.images = config.posts[0].images;
    await hydratePosterImagesFromSession(config);
  }
  return config;
}

/** Pull current posts from storage so newly added posts join the running queue in real time. */
async function refreshPostsForLoop(config) {
  return syncRunningConfigFromStorage(config);
}

function normalizePosts(config) {
  if (Array.isArray(config.posts) && config.posts.length) {
    return config.posts.map(p => ({
      text: String(p.text || ''),
      images: (p.images || []).slice(0, MAX_POST_IMAGES).map(img => ({
        dataUrl: img.dataUrl,
        name: img.name || '',
        type: img.type || 'image/jpeg'
      }))
    }));
  }
  return [{
    text: String(config.text || ''),
    images: (config.images || []).slice(0, MAX_POST_IMAGES).map(img => ({
      dataUrl: img.dataUrl,
      name: img.name || '',
      type: img.type || 'image/jpeg'
    }))
  }];
}

async function runPostingLoop() {
  if (!runState || !posterRunning || stopRequested) return;
  if (runState.postIndex === undefined) runState.postIndex = 0;

  let config = runState.config;

  let workerTab = null;
  const savedTabId = runState.workerTabId;
  if (savedTabId != null) {
    try {
      const ex = await chrome.tabs.get(savedTabId);
      if (ex && ex.id) workerTab = ex;
    } catch (_) {}
  }
  try {
    if (!workerTab) {
      workerTab = await getOrCreateWorkerTab(config);
      runState.workerTabId = workerTab.id;
      persistRunState();
    }
  } catch (e) {
    posterRunning = false;
    chrome.storage.local.set({ posterRunning: false });
    const errLine = '[BG] No se pudo abrir la pestaña de Facebook: ' + (e && e.message ? e.message : String(e));
    const r = [{ name: '—', url: '', success: false, error: e && e.message ? e.message : 'Tab error', log: [errLine] }];
    const n = (config.groups && config.groups.length) || 1;
    broadcastToApp({ action: 'postingFinished', results: r, total: n, notifyEnd: config.notifyEnd });
    return;
  }

  while (!stopRequested) {
    config = runState.config;
    await syncRunningConfigFromStorage(config);
    runState.config = config;
    persistRunState();
    const posts = normalizePosts(config);
    const numPosts = posts.length;
    if (!numPosts) break;

    const pi = runState.postIndex;
    if (pi >= numPosts) {
      if (config.loopInfinite && numPosts > 0) {
        runState.postIndex = 0;
        runState.results = [];
        runState.index = 0;
        persistRunState();
        await chrome.storage.local.set({ posterResults: [] });
        const { groupsForRun, verifyStats, retryStats } = await finalizeInfiniteLoopRound(workerTab, config);
        workerTab = await resolveWorkerTab(workerTab);
        broadcastToApp({
          action: 'loopRoundRestart',
          total: groupsForRun.length,
          groupsForProgress: groupsForProgressBroadcast(groupsForRun),
          verifyChecked: verifyStats.checked,
          newlyVerified: verifyStats.newlyVerified,
          retryRestored: retryStats?.restored || 0,
          retryRemoved: retryStats?.removed || 0,
        });
        const waitSec = computeWaitSeconds(config);
        const tg = groupsForRun.length || runState.config.groups?.length || 0;
        for (let left = waitSec; left > 0; left--) {
          if (stopRequested) break;
          if (runState?.skipCurrentPostSweep) break;
          broadcastToApp({
            action: 'progressUpdate',
            results: [],
            total: tg,
            countdown: left,
            postIndex: 0,
            totalPosts: numPosts
          });
          await sleep(1000);
        }
        if (stopRequested) break;
        if (runState?.skipCurrentPostSweep) runState.skipCurrentPostSweep = false;
        continue;
      }
      break;
    }

    const currentPost = posts[pi];
    const results = runState.results;
    // Fresh sweep for this post: never replace the walk order once locked.
    // New can-post groups join only via append-at-end (joiner / hot-add).
    const isFreshPostSweep = results.length === 0;
    const mayRefreshGroups =
      isFreshPostSweep && runState.index === 0 && runState.lockGroupWalkOrder === false;

    if (mayRefreshGroups) {
      const fresh = await refreshGroupsForLoop(config);
      if (!fresh.length) {
        stopRequested = true;
        if (runState) runState.stopReason = 'no_groups';
        break;
      }
      let groupsForRun = fresh;
      if (isCommunityFreeBuildBg() && config.communityProfileFirst !== false) {
        groupsForRun = [makeProfileTimelineSlotBg(), ...fresh];
      }
      runState.config.groups = groupsForRun;
      runState.lockGroupWalkOrder = true;
      await mergePosterConfigGroups(fresh);
    } else if (isFreshPostSweep && runState.lockGroupWalkOrder !== false) {
      // Pull any newly verified can-post groups to the END without reshuffling.
      try {
        await syncCanPostGroupsIntoCampaign();
      } catch (_) {}
    }

    if (!runState.config.groups?.length) {
      stopRequested = true;
      if (runState) runState.stopReason = 'no_groups';
      break;
    }

    if (isFreshPostSweep) {
      broadcastToApp({
        action: 'postSweepStart',
        postIndex: pi,
        totalPosts: numPosts,
        total: runState.config.groups.length,
        groupsForProgress: groupsForProgressBroadcast(runState.config.groups),
        retryCount: Array.isArray(runState.retryGroups) ? runState.retryGroups.length : 0,
      });
    }
    broadcastToApp({
      action: 'progressUpdate',
      results: [...results],
      total: runState.config.groups.length,
      countdown: 0,
      postIndex: pi,
      totalPosts: numPosts,
      retryCount: Array.isArray(runState.retryGroups) ? runState.retryGroups.length : 0,
    });

    // Dynamic length so hot-appended groups join the current walk without Stop/Play.
    while (!stopRequested && runState.index < runState.config.groups.length) {
      const i = runState.index;
      const total = runState.config.groups.length;
      if (runState.skipCurrentPostSweep) {
        runState.skipCurrentPostSweep = false;
        for (let j = i; j < total; j++) {
          const g = runState.config.groups[j];
          results.push({
            name: g.name || '—',
            url: g.url || '',
            success: false,
            error: 'skipped_by_user',
            log: []
          });
        }
        runState.index = total;
        chrome.storage.local.set({ posterResults: results });
        persistRunState();
        broadcastToApp({
          action: 'progressUpdate',
          results: [...results],
          total,
          countdown: 0,
          postIndex: pi,
          totalPosts: numPosts,
          retryCount: Array.isArray(runState.retryGroups) ? runState.retryGroups.length : 0,
        });
        break;
      }

      resetDailyCounterIfNeeded();
      const dailyLimit = Number(config.dailySuccessLimit);
      if (config.dailyLimitEnabled && Number.isFinite(dailyLimit) && dailyLimit >= 1
          && runState.dailySuccessCount >= dailyLimit) {
        const resumeAt = computeNextDailyResume(config.dailyResumeTime || '09:00');
        runState.plannedStartAt = resumeAt;
        runState.resumeHint = 'daily_limit';
        runState.lockGroupWalkOrder = true;
        runState.stopReason = 'daily_limit';
        await persistRunState();
        let lockedWhen = resumeAt;
        if (typeof ScheduleEngine !== 'undefined') {
          const arm = await ScheduleEngine.armSchedule({
            atMs: resumeAt,
            kind: 'daily_limit',
            reason: 'Pausa diaria por limite alcanzado'
          });
          if (arm && arm.ok && arm.schedule) lockedWhen = Number(arm.schedule.atMs) || resumeAt;
        } else {
          lockedWhen = await scheduleResume(resumeAt, 'Pausa diaria por limite alcanzado');
        }
        runState.plannedStartAt = lockedWhen;
        await persistRunState();
        posterRunning = false;
        await chrome.storage.local.set({ posterRunning: false });
        broadcastToApp({
          action: 'postingStopped',
          stopReason: 'daily_limit',
          plannedStartAt: lockedWhen,
          resumeIndex: runState.index,
          totalGroups: runState.config?.groups?.length || 0,
        });
        // Keep disk state; clear only in-memory pointer (resume reads RUNSTATE_KEY).
        runState = null;
        return;
      }

      const group = runState.config.groups[i];
      const postText = config.useSpintax ? spinText(currentPost.text) : currentPost.text;
      const imagesToPass = (currentPost.images || []).slice(0, MAX_POST_IMAGES).map(img => ({
        dataUrl: img.dataUrl,
        name: img.name,
        type: img.type
      }));
      await setPendingImagesForInject(imagesToPass);

      broadcastToApp({
        action: 'progressUpdate',
        results: [...results],
        total: runState.config.groups.length,
        countdown: 0,
        postIndex: pi,
        totalPosts: numPosts,
        retryCount: Array.isArray(runState.retryGroups) ? runState.retryGroups.length : 0,
      });

      let success = false, error = '', log = [];
      let pausedBeforePublish = false;
      const bgLog = [];
      const bg = (m) => bgLog.push('[BG] ' + m);

      try {
        bg('Grupo: ' + (group.name || '') + ' | tabId=' + workerTab.id);
        bg('URL destino: ' + (group.url || '').slice(0, 120));
        await navigateWorker(workerTab.id, group.url, config);
        workerTab = await resolveWorkerTab(workerTab);
        bg('Navegación enviada');
        await focusWorkerWindow(workerTab.id, config);
        bg(config.bgTabsEnabled ? 'Modo silencioso: sin foco en FB' : 'Pestaña enfocada');
        await sleep(7000);
        if (stopRequested) break;

        await focusWorkerWindow(workerTab.id, config);
        await sleep(400);

        const expectedImgN = imagesToPass.length;
        let inlineImgs = imagesToPass;
        const imgBytesEst = imagesToPass.reduce((s, x) => s + String(x?.dataUrl || '').length, 0);
        if (imgBytesEst > 1_200_000) {
          inlineImgs = [];
          bg('Imágenes demasiado grandes para args (' + imgBytesEst + ' chars dataUrl); fallback storage en página');
        } else if (expectedImgN) {
          bg('Pasar ' + expectedImgN + ' imagen(es) en args de inyección');
        }

        bg('Ejecutando fbPostInPage…');
        const injResult = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId: workerTab.id },
            func: fbPostInPage,
            args: [postText, inlineImgs, PAUSE_BEFORE_PUBLISH, expectedImgN]
          }),
          60000,
          'Automation timeout (grupo sin respuesta)'
        );

        const raw = injResult?.[0];
        bg('Resultado inject: err=' + (raw?.error || 'ninguno') + ' hasResult=' + (raw?.result != null));
        const res = raw?.result;
        if (res == null && raw?.error) {
          error = String(raw.error);
          success = false;
          log = [...bgLog, '[BG] Fallo capa inject: ' + raw.error];
        } else {
          success = res?.success === true;
          error = res?.error || (success ? '' : 'Sin resultado');
          const pageLog = Array.isArray(res?.log) ? res.log.map((x) => String(x)) : [];
          if (!pageLog.length && res != null) bg('(Script sin array log; revisa consola de la pestaña Facebook)');
          log = [...bgLog, ...pageLog];
          if (res == null) log.push('[BG] result es null (¿error de serialización o script sin retorno?)');
          if (res?.pausedBeforePublish) {
            pausedBeforePublish = true;
            stopRequested = true;
            success = false;
            error = res?.error || 'Pausa de seguridad antes de publicar';
            runState.stopReason = 'post_failure_pause';
          }
        }
      } catch (e) {
        error = e.message || 'Error de inyeccion';
        success = false;
        log = [...bgLog, '[BG] Excepción: ' + (e.message || e)];
      }

      results.push({ name: group.name, url: group.url, success, error, log });
      if (success) runState.dailySuccessCount++;
      if (!success && !pausedBeforePublish) {
        const Q = typeof IrishkaGroupQueues !== 'undefined' ? IrishkaGroupQueues : null;
        if (Q) {
          runState.retryGroups = Q.moveToRetry(runState.retryGroups || [], group, error);
        } else {
          runState.retryGroups = Array.isArray(runState.retryGroups) ? runState.retryGroups : [];
          runState.retryGroups.push({
            name: group.name || '',
            url: group.url || '',
            reason: String(error || 'unknown').slice(0, 240),
            failedAt: Date.now(),
            attempts: 1,
          });
        }
        broadcastToApp({
          action: 'retryQueueUpdated',
          retryCount: runState.retryGroups.length,
          lastFailed: { name: group.name, url: group.url, error },
        });
      }
      // Opt-in only: default is continue + quarantine (unattended).
      if (config.pauseOnFailedPublication === true && !success) {
        stopRequested = true;
        runState.stopReason = 'post_failure_pause';
      }
      runState.index = i + 1;
      chrome.storage.local.set({ posterResults: results });
      persistRunState();
      const liveTotal = runState.config.groups.length;
      broadcastToApp({
        action: 'progressUpdate',
        results: [...results],
        total: liveTotal,
        countdown: 0,
        postIndex: pi,
        totalPosts: numPosts,
        retryCount: Array.isArray(runState.retryGroups) ? runState.retryGroups.length : 0,
      });

      if (pausedBeforePublish) break;
      if (stopRequested) break;

      if (runState.index < runState.config.groups.length && !stopRequested) {
        const waitSec = computeWaitSeconds(config);
        for (let left = waitSec; left > 0; left--) {
          if (stopRequested) break;
          if (runState?.skipCurrentPostSweep) break;
          broadcastToApp({
            action: 'progressUpdate',
            results: [...results],
            total: runState.config.groups.length,
            countdown: left,
            postIndex: pi,
            totalPosts: numPosts,
            retryCount: Array.isArray(runState.retryGroups) ? runState.retryGroups.length : 0,
          });
          await sleep(1000);
        }
      }
    }

    if (stopRequested) break;

    runState.postIndex += 1;

    if (runState.postIndex >= numPosts) {
      if (config.loopInfinite && numPosts > 0) {
        runState.postIndex = 0;
        runState.results = [];
        runState.index = 0;
        persistRunState();
        await chrome.storage.local.set({ posterResults: [] });
        const { groupsForRun, verifyStats, retryStats } = await finalizeInfiniteLoopRound(workerTab, config);
        workerTab = await resolveWorkerTab(workerTab);
        broadcastToApp({
          action: 'loopRoundRestart',
          total: groupsForRun.length,
          groupsForProgress: groupsForProgressBroadcast(groupsForRun),
          verifyChecked: verifyStats.checked,
          newlyVerified: verifyStats.newlyVerified,
          retryRestored: retryStats?.restored || 0,
          retryRemoved: retryStats?.removed || 0,
        });
        const waitSec = computeWaitSeconds(config);
        const tg = groupsForRun.length || runState.config.groups?.length || 0;
        for (let left = waitSec; left > 0; left--) {
          if (stopRequested) break;
          if (runState?.skipCurrentPostSweep) break;
          broadcastToApp({
            action: 'progressUpdate',
            results: [],
            total: tg,
            countdown: left,
            postIndex: 0,
            totalPosts: numPosts
          });
          await sleep(1000);
        }
        if (stopRequested) break;
        if (runState?.skipCurrentPostSweep) runState.skipCurrentPostSweep = false;
        continue;
      }
      break;
    }

    runState.results = [];
    runState.index = 0;
    persistRunState();
    await chrome.storage.local.set({ posterResults: [] });

    const waitBetweenPosts = computeWaitSeconds(config);
    for (let left = waitBetweenPosts; left > 0; left--) {
      if (stopRequested) break;
      if (runState?.skipCurrentPostSweep) break;
      broadcastToApp({
        action: 'progressUpdate',
        results: [],
        total,
        countdown: left,
        postIndex: runState.postIndex,
        totalPosts: numPosts
      });
      await sleep(1000);
    }
  }

  if (stopRequested) {
    posterRunning = false;
    chrome.storage.local.set({ posterRunning: false });
    const stopReason = runState?.stopReason || 'session_interrupted';
    const pauseDetail = stopReason === 'post_failure_pause' && runState?.results?.length
      ? (() => {
          const last = runState.results[runState.results.length - 1];
          return {
            groupName: last.name || '',
            groupUrl: last.url || '',
            error: last.error || ''
          };
        })()
      : null;
    const keepRunState = stopReason === 'post_failure_pause' || stopReason === 'user_pause';
    if (!keepRunState) {
      chrome.storage.local.remove(RUNSTATE_KEY);
      chrome.storage.local.remove(['fartmily_pending_images']);
      clearPosterSessionStorage(false);
      runState = null;
    } else {
      if (stopReason === 'user_pause') runState.resumeHint = 'user_pause';
      else if (stopReason === 'post_failure_pause') runState.resumeHint = 'post_failure_pause';
      if (runState) runState.lockGroupWalkOrder = true;
      persistRunState();
    }
    if (runState) runState.stopReason = null;
    broadcastToApp({
      action: 'postingStopped',
      stopReason,
      pauseDetail
    });
    void fleetVisionCaptureAfterPause(stopReason, pauseDetail);
    return;
  }

  const results = runState.results;
  const cfg = runState.config;
  posterRunning = false;
  chrome.storage.local.remove(RUNSTATE_KEY);
  runState = null;
  chrome.storage.local.set({ posterRunning: false });
  chrome.storage.local.remove(['fartmily_pending_images']);
  clearPosterSessionStorage(false);
  broadcastToApp({ action: 'postingFinished', results, total: results.length, notifyEnd: cfg.notifyEnd });

  if (cfg.notifyEnd) {
    const ok = results.filter(r => r.success).length;
    const n = results.length;
    chrome.storage.local.get([LANG_KEY_BG], (data) => {
      const allowed = new Set([
        'en', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'nl', 'pl', 'tr',
        'hi', 'tl', 'ur', 'bn', 'id', 'ha', 'ar', 'vi', 'ro'
      ]);
      let lang = data[LANG_KEY_BG] || 'en';
      if (!allowed.has(String(lang).toLowerCase())) lang = 'en';
      const msg = notificationFinishMessage(lang, ok, n);
      chrome.notifications?.create({
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: 'Irishka Group Master by SBS',
        message: msg
      });
    });
  }
}

function getOrCreateWorkerTab(config) {
  return new Promise((resolve, reject) => {
    const url = (config.groups && config.groups[0] && config.groups[0].url) ? config.groups[0].url : 'https://www.facebook.com/groups/';
    // Igual que backup: visible salvo "modo silencioso" (bgTabsEnabled = pestañas en segundo plano).
    const active = config.bgTabsEnabled === false;
    chrome.tabs.create({ url, active }, (tab) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message || 'tabs.create failed'));
      }
      if (!tab || !tab.id) return reject(new Error('No se pudo crear la pestaña worker'));
      waitTabComplete(tab.id, 20000).then(() => resolve(tab)).catch(() => resolve(tab));
    });
  });
}

async function focusWorkerWindow(tabId, cfg) {
  if (cfg && cfg.bgTabsEnabled) return;
  try {
    await chrome.tabs.update(tabId, { active: true });
    const t = await chrome.tabs.get(tabId);
    if (t.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
  } catch (e) {}
}

/** Navega la pestaña worker; con modo silencioso no activa la pestaña ni roba el foco.
 *  Si la tab queda bloqueada por "Leave site?", abre una nueva y actualiza runState.workerTabId.
 */
async function navigateWorker(tabId, url, cfg) {
  const preferred =
    (runState && runState.workerTabId != null) ? runState.workerTabId : tabId;
  const r = await safeNavigateTab(preferred, url, cfg);
  if (runState && r.tabId != null) {
    runState.workerTabId = r.tabId;
    try { persistRunState(); } catch (_) {}
  }
  return r;
}

async function resolveWorkerTab(fallback) {
  const id = (runState && runState.workerTabId != null)
    ? runState.workerTabId
    : (fallback && fallback.id);
  if (id == null) return fallback || null;
  try {
    return await chrome.tabs.get(id);
  } catch (_) {
    return { id };
  }
}

/** Injected: strip beforeunload so Chrome "Leave site?" does not block close/navigate. */
function disarmBeforeUnloadInPage() {
  // Run in page JS world via <script> so it clears Facebook's real handlers
  // even when this function is injected in the extension isolated world.
  try {
    const code = `(function () {
      try { window.onbeforeunload = null; } catch (e) {}
      try { window.onunload = null; } catch (e) {}
      try {
        window.addEventListener('beforeunload', function (e) {
          try { e.stopImmediatePropagation(); } catch (err) {}
          try { e.preventDefault(); } catch (err) {}
          try { delete e.returnValue; } catch (err) {}
        }, true);
      } catch (e) {}
    })();`;
    const s = document.createElement('script');
    s.textContent = code;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
  } catch (_) {}
  try {
    window.onbeforeunload = null;
    window.onunload = null;
  } catch (_) {}
  return true;
}

async function disarmTabBeforeUnload(tabId) {
  if (tabId == null) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: disarmBeforeUnloadInPage,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Close a tab we own without hanging on Chrome leave-site dialogs.
 * Returns { closed: boolean, abandoned: boolean }.
 */
async function safeRemoveTab(tabId, timeoutMs) {
  if (tabId == null) return { closed: false, abandoned: false };
  const ms = Math.max(800, Number(timeoutMs) || 4500);
  try {
    await disarmTabBeforeUnload(tabId);
  } catch (_) {}
  await sleep(120);
  const closed = await new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), ms);
    try {
      chrome.tabs.remove(tabId, () => {
        clearTimeout(timer);
        finish(!chrome.runtime.lastError);
      });
    } catch (_) {
      clearTimeout(timer);
      finish(false);
    }
  });
  if (closed) return { closed: true, abandoned: false };
  // Tab likely stuck on native dialog — leave it; caller should open a fresh tab.
  return { closed: false, abandoned: true };
}

/** Navigate without leave-site popup; falls back to a fresh tab if update hangs. */
async function safeNavigateTab(tabId, url, cfg) {
  const silent = !!(cfg && cfg.bgTabsEnabled);
  if (tabId != null) {
    try {
      await disarmTabBeforeUnload(tabId);
    } catch (_) {}
    const navigated = await new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 12000);
      try {
        chrome.tabs.update(tabId, { url, active: !silent }, () => {
          if (chrome.runtime.lastError) {
            clearTimeout(timer);
            finish(false);
            return;
          }
          waitTabComplete(tabId, 20000)
            .then(() => {
              clearTimeout(timer);
              finish(true);
            })
            .catch(() => {
              clearTimeout(timer);
              finish(true); // loaded enough / timed out waiting complete — still usable
            });
        });
      } catch (_) {
        clearTimeout(timer);
        finish(false);
      }
    });
    if (navigated) return { tabId, recycled: false };
    // Stuck — open a replacement and abandon the old tab.
    await safeRemoveTab(tabId, 2500);
  }
  const active = cfg && cfg.bgTabsEnabled === false;
  const tab = await new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: !!active }, (t) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'tabs.create failed'));
        return;
      }
      resolve(t);
    });
  });
  try {
    await waitTabComplete(tab.id, 20000);
  } catch (_) {}
  return { tabId: tab.id, recycled: true, tab };
}

/** Create or reuse a single background worker tab for join/verify batches. */
async function getOrCreateOwnedBgTab(preferredTabId, url) {
  if (preferredTabId != null) {
    try {
      const ex = await chrome.tabs.get(preferredTabId);
      if (ex?.id) {
        const nav = await safeNavigateTab(ex.id, url, { bgTabsEnabled: true });
        return { id: nav.tabId, tab: nav.tab || ex };
      }
    } catch (_) {}
  }
  const tab = await new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (t) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message || 'tabs.create failed'));
      else resolve(t);
    });
  });
  try {
    await waitTabComplete(tab.id, 28000);
  } catch (_) {}
  return { id: tab.id, tab };
}

function waitTabComplete(tabId, maxMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const onUpd = (id, info) => {
      if (id === tabId && info.status === 'complete' && !done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpd);
    setTimeout(() => {
      if (!done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(onUpd);
        reject(new Error('tab load timeout'));
      }
    }, maxMs);
  });
}

function slimPosterConfigForDisk(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const c = { ...cfg };
  if (Array.isArray(c.posts)) {
    c.posts = c.posts.map((p) => ({
      ...p,
      images: (p.images || []).map((img) => ({
        name: img.name || '',
        type: img.type || 'image/jpeg'
      }))
    }));
  }
  if (Array.isArray(c.images)) {
    c.images = c.images.map((img) => ({
      name: img.name || '',
      type: img.type || 'image/jpeg'
    }));
  }
  return c;
}

function mergeLayerRowIntoPostImages(p, row) {
  if (!p || typeof p !== 'object') return p;
  const metaSlots = Array.isArray(p.images) ? p.images : [];
  const layerRow = Array.isArray(row) ? row : [];
  const n = Math.max(metaSlots.length, layerRow.length, 0);
  if (!n) return { ...p, images: [] };
  const out = [];
  for (let j = 0; j < n; j++) {
    const meta = metaSlots[j] || { name: '', type: 'image/jpeg' };
    const cell = layerRow[j];
    out.push({
      ...meta,
      dataUrl: (cell && cell.dataUrl) || meta.dataUrl || ''
    });
  }
  return { ...p, images: out };
}

async function hydratePosterImagesFromSession(config) {
  if (!config) return;
  try {
    let layers = null;
    if (typeof posterImageIdbLoadLayers === 'function') {
      try {
        const fromIdb = await posterImageIdbLoadLayers();
        if (fromIdb && Array.isArray(fromIdb) && fromIdb.length) layers = fromIdb;
      } catch (_) {}
    }
    let pack = null;
    if (!layers || !layers.length) {
      if (chrome.storage?.session) {
        try {
          const s = await chrome.storage.session.get([POSTER_SESSION_IMAGES_KEY]);
          const sp = s[POSTER_SESSION_IMAGES_KEY];
          if (sp && Array.isArray(sp.layers) && sp.layers.length) pack = sp;
        } catch (_) {}
      }
      if (!pack || !Array.isArray(pack.layers) || !pack.layers.length) {
        const d = await chrome.storage.local.get([POSTER_PERSISTED_IMAGES_KEY]);
        const lp = d[POSTER_PERSISTED_IMAGES_KEY];
        if (lp && Array.isArray(lp.layers) && lp.layers.length) pack = lp;
      }
      if (pack && Array.isArray(pack.layers) && pack.layers.length) layers = pack.layers;
    }
    if (!Array.isArray(layers) || !layers.length) return;
    pack = { layers };
    if (chrome.storage?.session && pack) {
      try {
        await chrome.storage.session.set({ [POSTER_SESSION_IMAGES_KEY]: pack });
      } catch (_) {}
    }
    if (Array.isArray(config.posts) && config.posts.length) {
      config.posts = config.posts.map((p, i) => mergeLayerRowIntoPostImages(p, layers[i]));
    }
    if (Array.isArray(config.images) && layers[0]) {
      const merged = mergeLayerRowIntoPostImages({ images: config.images }, layers[0]);
      config.images = merged.images;
    }
  } catch (e) {}
}

function clearPosterSessionStorage(clearComposeLayers) {
  try {
    if (chrome.storage.session) {
      chrome.storage.session.remove(['fartmily_pending_images']);
      if (clearComposeLayers) {
        chrome.storage.session.remove([POSTER_SESSION_IMAGES_KEY]);
      }
    }
  } catch (e) {}
  if (!clearComposeLayers) return;
  try {
    if (typeof posterImageIdbClear === 'function') {
      posterImageIdbClear().catch(() => {});
    }
  } catch (e) {}
  try {
    chrome.storage.local.remove([POSTER_PERSISTED_IMAGES_KEY]);
  } catch (e) {}
}

function setPendingImagesForInject(imagesToPass) {
  return new Promise((resolve) => {
    const done = () => resolve();
    // Backup: siempre local antes del inject; el page script lee igual que allí.
    // Si local falla por cuota, usar session como respaldo.
    chrome.storage.local.set({ fartmily_pending_images: imagesToPass }, () => {
      if (chrome.runtime.lastError) {
        if (chrome.storage?.session) {
          chrome.storage.session.set({ fartmily_pending_images: imagesToPass }, done);
        } else {
          done();
        }
        return;
      }
      if (chrome.storage?.session) {
        chrome.storage.session.remove(['fartmily_pending_images'], done);
      } else {
        done();
      }
    });
  });
}

function persistRunState() {
  try {
    if (!runState) return Promise.resolve();
    // Store the current loop state so MV3 sleep doesn't break "resume".
    const payload = {
      [RUNSTATE_KEY]: {
        config: slimPosterConfigForDisk(runState.config),
        results: runState.results,
        index: runState.index,
        postIndex: runState.postIndex,
        dailySuccessCount: runState.dailySuccessCount,
        dailyKey: runState.dailyKey,
        startedOnce: runState.startedOnce,
        plannedStartAt: runState.plannedStartAt || null,
        workerTabId: runState.workerTabId != null ? runState.workerTabId : null,
        resumeHint: runState.resumeHint || null,
        stopReason: runState.stopReason || null,
        retryGroups: Array.isArray(runState.retryGroups) ? runState.retryGroups : [],
        lockGroupWalkOrder: runState.lockGroupWalkOrder !== false,
      }
    };
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(payload, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  } catch (e) {
    return Promise.resolve();
  }
}

/** True if a posting campaign should be continued (not restarted from group 1). */
function campaignHasProgress(rs) {
  if (!rs || !rs.config) return false;
  if (rs.lockGroupWalkOrder === true) return true;
  if ((Number(rs.index) || 0) > 0) return true;
  if ((Number(rs.postIndex) || 0) > 0) return true;
  if (Array.isArray(rs.results) && rs.results.length > 0) return true;
  const hint = String(rs.resumeHint || '');
  if (hint === 'daily_limit' || hint === 'scheduled_start' || hint === 'user_pause') return true;
  return false;
}

function mapGroupRowForWalk(g) {
  return {
    url: g.url,
    name: g.name || '',
    selected: true,
    canPost: typeof g.canPost === 'boolean' ? g.canPost : null,
    isMember: typeof g.isMember === 'boolean' ? g.isMember : undefined,
    postabilityCheckedAt: g.postabilityCheckedAt || null,
    pendingPostsCount: g.pendingPostsCount || 0,
    isProfileTimelineSlot: !!g.isProfileTimelineSlot,
  };
}

/**
 * Append groups to the end of the campaign walk (memory or disk).
 * Never changes index / postIndex / results / order of existing rows.
 */
async function appendGroupsToCampaignQueue(incoming) {
  const listIn = Array.isArray(incoming) ? incoming : [];
  if (!listIn.length) return { ok: false, error: 'empty', added: 0 };

  let rs = runState;
  let fromDiskOnly = false;
  if (!rs?.config) {
    const d = await chrome.storage.local.get([RUNSTATE_KEY]);
    rs = d[RUNSTATE_KEY];
    fromDiskOnly = true;
  }
  if (!rs?.config) return { ok: false, error: 'no_campaign', added: 0 };

  const Q = typeof IrishkaGroupQueues !== 'undefined' ? IrishkaGroupQueues : null;
  const mapped = listIn.map(mapGroupRowForWalk).filter((g) => g.url && !g.isProfileTimelineSlot);
  if (!mapped.length) return { ok: true, added: 0, total: (rs.config.groups || []).length };

  let added = mapped;
  if (Q) {
    const r = Q.appendUnique(rs.config.groups || [], mapped);
    rs.config.groups = r.list;
    added = r.added;
  } else {
    const seen = new Set((rs.config.groups || []).map((g) => String(g.url || '').toLowerCase()));
    added = [];
    if (!Array.isArray(rs.config.groups)) rs.config.groups = [];
    for (const g of mapped) {
      const k = String(g.url || '').toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      rs.config.groups.push(g);
      added.push(g);
    }
  }

  rs.lockGroupWalkOrder = true;

  try {
    const d = await chrome.storage.local.get(['fbGroups', 'posterConfig']);
    const groups = Array.isArray(d.fbGroups) ? d.fbGroups.map((g) => ({ ...g })) : [];
    const keyOf = (u) => (Q ? Q.normUrl(u) : String(u || '').toLowerCase());
    for (const g of added) {
      const idx = groups.findIndex((x) => keyOf(x.url) === keyOf(g.url));
      if (idx >= 0) {
        groups[idx].selected = true;
        if (typeof g.canPost === 'boolean') groups[idx].canPost = g.canPost;
      } else if (added.length) {
        groups.push({ ...g, selected: true });
      }
    }
    if (added.length) await chrome.storage.local.set({ fbGroups: groups });
    const pc = { ...(d.posterConfig || {}), groups: rs.config.groups };
    await chrome.storage.local.set({ posterConfig: slimPosterConfigForDisk(pc) });
  } catch (_) {}

  if (fromDiskOnly && !posterRunning) {
    await chrome.storage.local.set({ [RUNSTATE_KEY]: {
      ...rs,
      config: slimPosterConfigForDisk(rs.config),
      lockGroupWalkOrder: true,
    } });
  } else {
    runState = rs;
    await persistRunState();
  }

  if (added.length) {
    broadcastToApp({
      action: 'activeQueueAppended',
      added: added.length,
      total: rs.config.groups.length,
      groupsForProgress: groupsForProgressBroadcast(rs.config.groups),
      retryCount: Array.isArray(rs.retryGroups) ? rs.retryGroups.length : 0,
      campaignContinued: true,
    });
    if (posterRunning) {
      broadcastToApp({
        action: 'progressUpdate',
        results: [...(rs.results || [])],
        total: rs.config.groups.length,
        countdown: 0,
        postIndex: rs.postIndex || 0,
        totalPosts: normalizePosts(rs.config).length,
        retryCount: Array.isArray(rs.retryGroups) ? rs.retryGroups.length : 0,
      });
    }
  }
  return { ok: true, added: added.length, total: (rs.config.groups || []).length };
}

/** Pull selected canPost groups from fbGroups into the campaign queue (append-only). */
async function syncCanPostGroupsIntoCampaign() {
  const d = await chrome.storage.local.get(['fbGroups', RUNSTATE_KEY]);
  const hasCampaign = !!(runState?.config || d[RUNSTATE_KEY]?.config);
  if (!hasCampaign) return { ok: false, error: 'no_campaign', added: 0 };
  const raw = Array.isArray(d.fbGroups) ? d.fbGroups : [];
  const canPost = raw.filter((g) => g && g.selected !== false && g.canPost === true && g.url);
  if (!canPost.length) return { ok: true, added: 0 };
  return appendGroupsToCampaignQueue(canPost);
}

/**
 * Reanuda la cola guardada (p. ej. tras límite diario + alarma, o si la alarma no disparó con el PC apagado).
 */
let resumePostingLock = null;

/**
 * Reanuda la cola guardada (schedule / daily_limit / pause).
 * CRITICAL MV3: when awaitLoop=true (schedule wake), await the posting loop so the
 * alarm callback keeps the service worker alive. Message handlers use awaitLoop=false
 * so the UI gets a prompt response while the loop continues.
 */
async function resumePostingFromStoredRunState(opts) {
  if (resumePostingLock) return resumePostingLock;
  const awaitLoop = !!(opts && opts.awaitLoop);
  resumePostingLock = (async () => {
    try {
      if (posterRunning) return { ok: false, error: 'already_running' };
      const d = await chrome.storage.local.get([RUNSTATE_KEY, 'posterRunning']);
      if (d.posterRunning) {
        await chrome.storage.local.set({ posterRunning: false });
      }
      const saved = d[RUNSTATE_KEY];
      if (!saved || !saved.config) {
        if (typeof ScheduleDiag !== 'undefined') {
          await ScheduleDiag.log('resume.nothing_to_resume', { awaitLoop });
        }
        return { ok: false, error: 'nothing_to_resume' };
      }

      if (typeof ScheduleDiag !== 'undefined') {
        await ScheduleDiag.log('resume.begin', {
          awaitLoop,
          hint: saved.resumeHint || null,
          plannedStartAt: saved.plannedStartAt || null,
          index: saved.index,
          postIndex: saved.postIndex,
          groups: Array.isArray(saved.config?.groups) ? saved.config.groups.length : 0
        });
      }

      try { await chrome.alarms.clear('fartmily_resume'); } catch (_) {}
      try { await chrome.alarms.clear('fartmily_resume_watch'); } catch (_) {}
      try { await chrome.alarms.clear('irishka_poster_wake'); } catch (_) {}

      posterRunning = true;
      stopRequested = false;
      runState = { ...saved, stopReason: null };
      if (runState.postIndex === undefined) runState.postIndex = 0;
      if (!Array.isArray(runState.retryGroups)) runState.retryGroups = [];
      // Resumed campaigns always keep walk order (append-only for new groups).
      runState.lockGroupWalkOrder = true;
      if (runState.config?.dailyLimitEnabled) runState.startedOnce = true;
      const priorHint = runState.resumeHint;
      const priorAt = runState.plannedStartAt;
      delete runState.resumeHint;
      runState.plannedStartAt = null;
      try {
        await syncRunningConfigFromStorage(runState.config);
      } catch (_) {}
      // Merge any can-post groups joined while we were paused — append only.
      try {
        await syncCanPostGroupsIntoCampaign();
      } catch (_) {}
      await chrome.storage.local.set({ posterRunning: true });
      await persistRunState();
      const numPosts = normalizePosts(runState.config).length;
      broadcastToApp({
        action: 'postRunStateResumed',
        groupsForProgress: groupsForProgressBroadcast(runState.config.groups || []),
        postIndex: runState.postIndex || 0,
        totalPosts: numPosts,
        loopInfinite: !!runState.config.loopInfinite,
        resumedFrom: priorHint || null,
        wasPlannedAt: priorAt || null,
        resumeIndex: runState.index || 0,
        totalGroups: Array.isArray(runState.config?.groups) ? runState.config.groups.length : 0,
      });
      try {
        await hydratePosterImagesFromSession(runState.config);
      } catch (_) {}

      const loopPromise = runPostingLoop();
      if (typeof ScheduleDiag !== 'undefined') {
        await ScheduleDiag.log('resume.loop_started', { awaitLoop, posterRunning: true });
      }
      if (awaitLoop) {
        try {
          await loopPromise;
          if (typeof ScheduleDiag !== 'undefined') {
            await ScheduleDiag.log('resume.loop_finished', {});
          }
        } catch (e) {
          if (typeof ScheduleDiag !== 'undefined') {
            await ScheduleDiag.log('resume.loop_error', { error: String(e && e.message ? e.message : e) });
          }
        }
      } else {
        loopPromise.catch((e) => {
          if (typeof ScheduleDiag !== 'undefined') {
            ScheduleDiag.log('resume.loop_error_bg', { error: String(e && e.message ? e.message : e) });
          }
        });
      }
      return { ok: true };
    } finally {
      // Release lock only after setup; if awaitLoop, retain until loop ends.
      if (!awaitLoop) resumePostingLock = null;
      else resumePostingLock = null;
    }
  })();
  return resumePostingLock;
}

async function rehydratePosterImageStoresFromIdb() {
  try {
    let layers = null;
    if (typeof posterImageIdbLoadLayers === 'function') {
      try {
        layers = await posterImageIdbLoadLayers();
      } catch (_) {}
    }
    if (!layers || !layers.length) return;
    const pack = { layers };
    if (chrome.storage?.session) {
      try {
        await chrome.storage.session.set({ [POSTER_SESSION_IMAGES_KEY]: pack });
      } catch (_) {}
    }
    try {
      await chrome.storage.local.set({ [POSTER_PERSISTED_IMAGES_KEY]: pack });
    } catch (_) {}
  } catch (_) {}
}

async function recoverPostingAfterExtensionReload() {
  if (posterRunning) return;
  await rehydratePosterImageStoresFromIdb();

  if (typeof ScheduleEngine !== 'undefined') {
    await ScheduleEngine.bootstrap().catch(() => {});
    const due = await ScheduleEngine.tick({ source: 'recover' }).catch(() => null);
    if (due && due.started) return;
  }

  const d = await chrome.storage.local.get([RUNSTATE_KEY, 'posterRunning']);
  const saved = d[RUNSTATE_KEY];
  if (!saved || !saved.config) {
    if (d.posterRunning) await chrome.storage.local.set({ posterRunning: false });
    return;
  }

  const hint = String(saved.resumeHint || '');
  const futureAt = typeof saved.plannedStartAt === 'number' && saved.plannedStartAt > Date.now();

  if (futureAt && (hint === 'scheduled_start' || hint === 'daily_limit')) {
    const label = hint === 'daily_limit' ? 'Pausa diaria · reanuda programado' : 'Scheduled posting';
    await scheduleResume(saved.plannedStartAt, label);
    posterRunning = false;
    await chrome.storage.local.set({ posterRunning: false });
    return;
  }

  if (hint === 'user_pause' || hint === 'post_failure_pause') {
    posterRunning = false;
    await chrome.storage.local.set({ posterRunning: false });
    return;
  }

  if (hint === 'scheduled_start' || hint === 'daily_limit') {
    await resumePostingFromStoredRunState();
    return;
  }

  const midRun =
    !!d.posterRunning ||
    (Number(saved.index) || 0) > 0 ||
    (Array.isArray(saved.results) && saved.results.length > 0);
  if (midRun) {
    await resumePostingFromStoredRunState();
  } else if (d.posterRunning) {
    await chrome.storage.local.set({ posterRunning: false });
  }
}

function resetDailyCounterIfNeeded() {
  if (!runState) return;
  const nowKey = dayKey(Date.now());
  if (runState.dailyKey !== nowKey) {
    runState.dailyKey = nowKey;
    runState.dailySuccessCount = 0;
  }
}

/** Mínimo 5 minutos (300 s) entre grupos, aunque venga config antigua o variación alta. */
const MIN_WAIT_SECONDS = 300;

function computeWaitSeconds(config) {
  const jitter = Math.floor(Math.random() * (config.timerVariation * 2 + 1)) - config.timerVariation;
  const base = Number(config.timerSeconds) || MIN_WAIT_SECONDS;
  return Math.max(MIN_WAIT_SECONDS, base + jitter);
}

function computeStartAt(startDay, hhmm) {
  const now = new Date();
  const [hh, mm] = parseHHMM(hhmm);
  const base = new Date(now);
  base.setHours(hh, mm, 0, 0);
  if (startDay === 'tomorrow') {
    base.setDate(base.getDate() + 1);
    return base.getTime();
  }
  if (base.getTime() < now.getTime()) base.setDate(base.getDate() + 1);
  return base.getTime();
}

function computeNextDailyResume(hhmm) {
  const [hh, mm] = parseHHMM(hhmm);
  // Prefer Europe/Amsterdam when the service worker timezone is UTC (Chrome quirk),
  // so "07:50" means 07:50 on the user's Dutch wall clock.
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_) {}
  const offsetMin = new Date().getTimezoneOffset();
  if (tz === 'UTC' || offsetMin === 0) {
    tz = 'Europe/Amsterdam';
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Build tomorrow's Y-M-D in Amsterdam, then attach hh:mm.
    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = dateFmt.formatToParts(tomorrow);
    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    const y = Number(map.year);
    const mo = Number(map.month) - 1;
    const day = Number(map.day);
    const desiredAsUtc = Date.UTC(y, mo, day, hh, mm, 0, 0);
    let t = desiredAsUtc;
    for (let i = 0; i < 4; i++) {
      const fp = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date(t));
      const fm = {};
      fp.forEach((p) => {
        if (p.type !== 'literal') fm[p.type] = p.value;
      });
      const asUtc = Date.UTC(
        Number(fm.year),
        Number(fm.month) - 1,
        Number(fm.day),
        Number(fm.hour),
        Number(fm.minute),
        0,
        0
      );
      const delta = desiredAsUtc - asUtc;
      if (delta === 0) break;
      t += delta;
    }
    // Ensure it's still in the future
    if (t <= Date.now() + 30_000) t += 24 * 60 * 60 * 1000;
    return t;
  }
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

function parseHHMM(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  if (!m) return [9, 0];
  return [Math.min(23, Math.max(0, Number(m[1]))), Math.min(59, Math.max(0, Number(m[2])))];
}

/** Wall-clock zone for daily caps / resumes (matches poster schedule UI). */
function scheduleWallTimeZone() {
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_) {}
  const offsetMin = new Date().getTimezoneOffset();
  if (tz === 'UTC' || offsetMin === 0) return 'Europe/Amsterdam';
  return tz;
}

function dayKey(ts) {
  const tz = scheduleWallTimeZone();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ts));
    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    if (map.year && map.month && map.day) {
      return `${map.year}-${map.month}-${map.day}`;
    }
  } catch (_) {}
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** Join daily resume: same wall-clock policy as poster dailyResumeTime. */
function computeNextJoinResumeMs(hhmm) {
  return computeNextDailyResume(hhmm || '07:00');
}

/** Clasifica el estado de unión en la página del grupo (inyectado — debe ser autónomo). */
function classifyJoinPageStateInjected() {
  const bodyText = (document.body?.innerText || '').slice(0, 80000).toLowerCase();
  const txt = (el) => ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
  const visible = () =>
    Array.from(document.querySelectorAll('[role="button"],button,a[role="button"]')).filter((el) => el && el.offsetParent);

  const joinHints = [
    'join group', 'join', 'unirte al grupo', 'unirse al grupo', 'unirse', 'solicitar unirse',
    'request to join', 'ask to join', 'participar', 'beitreten', 'rejoindre le groupe', 'rejoindre'
  ];
  const memberHints = [
    "you're a member", 'you are a member', 'member of this group', 'joined',
    'eres miembro', 'miembro del grupo', 'ya eres miembro', 'abandonar grupo',
    'leave group', 'salir del grupo', 'abandonar'
  ];
  const pendingHints = [
    'cancel request', 'cancelar solicitud', 'request sent', 'solicitud enviada',
    'awaiting approval', 'pending approval', 'solicitud pendiente', 'espera de aprobación',
    'requested', 'has solicitado', 'you requested to join'
  ];

  const joinVisible = visible().some((el) => {
    const t = txt(el);
    if (memberHints.some((h) => t.includes(h))) return false;
    if (pendingHints.some((h) => t.includes(h))) return false;
    return joinHints.some((h) => t.includes(h));
  });
  const memberVisible = visible().some((el) => memberHints.some((h) => txt(el).includes(h)));
  const pendingVisible = visible().some((el) => pendingHints.some((h) => txt(el).includes(h)));
  const memberInBody = memberHints.some((h) => bodyText.includes(h));
  const pendingInBody = pendingHints.some((h) => bodyText.includes(h));

  if (!joinVisible && (memberVisible || memberInBody)) {
    return { outcome: 'joined_confirmed', isMember: true, reason: 'member_signals' };
  }
  if (pendingVisible || pendingInBody) {
    return { outcome: 'request_pending', isMember: false, reason: 'pending_request' };
  }
  if (joinVisible) {
    return { outcome: 'failed', isMember: false, reason: 'join_still_available' };
  }
  if (memberInBody) {
    return { outcome: 'joined_confirmed', isMember: true, reason: 'body_member_hint' };
  }
  return { outcome: 'failed', isMember: null, reason: 'unclear' };
}

/** Inyectado: intenta pulsar Unirse / Join (autónomo; no confirma membresía). */
async function joinGroupInPageInjected() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bodyText = (document.body?.innerText || '').slice(0, 80000).toLowerCase();
  const txt = (el) => ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
  const visible = () =>
    Array.from(document.querySelectorAll('[role="button"],button,a[role="button"]')).filter((el) => el && el.offsetParent);

  const joinHints = [
    'join group', 'join', 'unirte al grupo', 'unirse al grupo', 'unirse', 'solicitar unirse',
    'request to join', 'ask to join', 'participar', 'beitreten', 'rejoindre le groupe', 'rejoindre'
  ];
  const memberHints = [
    "you're a member", 'you are a member', 'member of this group', 'joined',
    'eres miembro', 'miembro del grupo', 'ya eres miembro', 'abandonar grupo',
    'leave group', 'salir del grupo', 'abandonar'
  ];
  const pendingHints = [
    'cancel request', 'cancelar solicitud', 'request sent', 'solicitud enviada',
    'awaiting approval', 'pending approval', 'solicitud pendiente', 'espera de aprobación',
    'requested', 'has solicitado', 'you requested to join'
  ];

  function classify() {
    const joinVisible = visible().some((el) => {
      const t = txt(el);
      if (memberHints.some((h) => t.includes(h))) return false;
      if (pendingHints.some((h) => t.includes(h))) return false;
      return joinHints.some((h) => t.includes(h));
    });
    const memberVisible = visible().some((el) => memberHints.some((h) => txt(el).includes(h)));
    const pendingVisible = visible().some((el) => pendingHints.some((h) => txt(el).includes(h)));
    const memberInBody = memberHints.some((h) => bodyText.includes(h));
    const pendingInBody = pendingHints.some((h) => bodyText.includes(h));
    if (!joinVisible && (memberVisible || memberInBody)) {
      return { outcome: 'joined_confirmed', isMember: true, reason: 'member_signals' };
    }
    if (pendingVisible || pendingInBody) {
      return { outcome: 'request_pending', isMember: false, reason: 'pending_request' };
    }
    if (joinVisible) return { outcome: 'failed', isMember: false, reason: 'join_still_available' };
    if (memberInBody) return { outcome: 'joined_confirmed', isMember: true, reason: 'body_member_hint' };
    return { outcome: 'failed', isMember: null, reason: 'unclear' };
  }

  const pre = classify();
  if (pre.outcome === 'joined_confirmed') {
    return { clicked: false, alreadyMember: true, pendingBefore: false, pre };
  }
  if (pre.outcome === 'request_pending') {
    return { clicked: false, alreadyMember: false, pendingBefore: true, pre };
  }

  function looksMember(btn) {
    const t = txt(btn);
    return memberHints.some((h) => t.includes(h));
  }
  function pickJoin() {
    for (const el of visible()) {
      if (looksMember(el)) continue;
      const t = txt(el);
      if (joinHints.some((h) => t.includes(h))) return el;
    }
    return null;
  }
  for (let attempt = 0; attempt < 18; attempt++) {
    const j = pickJoin();
    if (j) {
      j.scrollIntoView({ block: 'center', inline: 'center' });
      j.click();
      await wait(1400);
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => d.offsetParent);
      for (const dlg of dialogs) {
        const btns = Array.from(dlg.querySelectorAll('[role="button"],button')).filter((b) => b.offsetParent);
        const confirm = btns.find((b) => {
          const t = txt(b);
          return joinHints.some((h) => t.includes(h)) || t.includes('confirm') || t.includes('solicitar') || t.includes('request');
        });
        if (confirm) {
          confirm.click();
          await wait(1200);
        }
      }
      await wait(800);
      return { clicked: true, alreadyMember: false, pendingBefore: false, pre };
    }
    await wait(550);
  }
  return { clicked: false, alreadyMember: false, pendingBefore: false, reason: 'no_join_button', pre };
}

function normalizeJoinGroupUrl(url) {
  const m = String(url || '').match(/facebook\.com\/groups\/([^/?&#\s]+)/i);
  if (!m) return String(url || '').trim();
  return 'https://www.facebook.com/groups/' + m[1];
}

function joinGroupUrlKey(url) {
  const m = String(url || '').match(/facebook\.com\/groups\/([^/?&#\s]+)/i);
  return m ? String(m[1]).toLowerCase() : '';
}

async function upsertFbGroupAfterConfirmedJoin(url) {
  const cleanUrl = normalizeJoinGroupUrl(url);
  const key = joinGroupUrlKey(cleanUrl);
  if (!key) return;
  const d = await chrome.storage.local.get(['fbGroups']);
  const groups = Array.isArray(d.fbGroups) ? d.fbGroups.map((g) => ({ ...g })) : [];
  const idx = groups.findIndex((g) => joinGroupUrlKey(g.url) === key);
  if (idx >= 0) {
    groups[idx].selected = true;
    groups[idx].isMember = true;
    groups[idx].membershipCheckedAt = Date.now();
    if (groups[idx].canPost !== true && groups[idx].canPost !== false) {
      groups[idx].canPost = null;
    }
  } else {
    groups.push({
      url: cleanUrl,
      name: key.replace(/[-_]/g, ' '),
      selected: true,
      canPost: null,
      isMember: true,
      membershipCheckedAt: Date.now(),
      postabilityCheckedAt: null,
      pendingPostsCount: 0,
    });
  }
  await chrome.storage.local.set({ fbGroups: groups });
  broadcastToApp({ action: 'groupsListChanged' });
}

/** Tras el cupo diario (o fin de cola): verificar canPost en los joins confirmados de hoy. */
async function runPostJoinPostabilityPass(urls) {
  const list = [...new Set((urls || []).map(normalizeJoinGroupUrl).filter(Boolean))];
  if (!list.length) {
    return { checked: 0, canPost: 0, removed: 0 };
  }

  broadcastToApp({
    action: 'joinQueuePostabilityPass',
    phase: 'start',
    total: list.length,
    current: 0,
  });

  const d = await chrome.storage.local.get(['fbGroups']);
  const groups = Array.isArray(d.fbGroups) ? d.fbGroups.map((g) => ({ ...g })) : [];
  let canPostCount = 0;
  let removed = 0;
  let workerId = null;

  try {
    for (let i = 0; i < list.length; i++) {
      const url = list[i];
      broadcastToApp({
        action: 'joinQueuePostabilityPass',
        phase: 'item',
        total: list.length,
        current: i + 1,
        url,
      });
      try {
        const owned = await getOrCreateOwnedBgTab(workerId, url);
        workerId = owned.id;
        await sleep(4200);
        const inj = await chrome.scripting.executeScript({
          target: { tabId: workerId },
          func: detectGroupPostabilityInPage,
        });
        const result = inj?.[0]?.result || {};
        const canPost = !!result.canPost;
        const key = joinGroupUrlKey(url);
        let idx = groups.findIndex((g) => joinGroupUrlKey(g.url) === key);
        if (idx < 0) {
          groups.push({
            url,
            name: key.replace(/[-_]/g, ' '),
            selected: canPost,
            canPost,
            isMember: result.isMember !== false,
            postabilityCheckedAt: Date.now(),
            membershipCheckedAt: Date.now(),
            pendingPostsCount: Number(result.pendingPostsCount) || 0,
          });
        } else {
          groups[idx].canPost = canPost;
          if (typeof result.isMember === 'boolean') groups[idx].isMember = result.isMember;
          groups[idx].postabilityCheckedAt = Date.now();
          groups[idx].pendingPostsCount = Number(result.pendingPostsCount) || 0;
          groups[idx].selected = !!canPost;
        }
        if (canPost) canPostCount++;
        else removed++;
      } catch (_) {
        const key = joinGroupUrlKey(url);
        const idx = groups.findIndex((g) => joinGroupUrlKey(g.url) === key);
        if (idx >= 0) {
          groups[idx].canPost = false;
          groups[idx].selected = false;
          groups[idx].postabilityCheckedAt = Date.now();
        }
        removed++;
      }
      await sleep(2200);
    }
  } finally {
    if (workerId != null) await safeRemoveTab(workerId, 5000);
  }

  await chrome.storage.local.set({ fbGroups: groups });
  broadcastToApp({ action: 'groupsListChanged' });
  return { checked: list.length, canPost: canPostCount, removed };
}

async function maybeRunJoinPostabilityPass(st) {
  if (!st || !Array.isArray(st.confirmedToday) || !st.confirmedToday.length) {
    return { ran: false, checked: 0, canPost: 0, removed: 0, skippedAlreadyOk: 0 };
  }
  const passRunId = st.runId || null;
  const dk = st.dayKey || dayKey(Date.now());
  if (st.postabilityPassDoneDay === dk) {
    return { ran: false, checked: 0, canPost: 0, removed: 0, skipped: true, skippedAlreadyOk: 0 };
  }

  // Only re-check unverified (null) or failed (false). Never re-check canPost === true.
  const d = await chrome.storage.local.get(['fbGroups']);
  const groups = Array.isArray(d.fbGroups) ? d.fbGroups : [];
  const needsPostabilityCheck = (url) => {
    const key = joinGroupUrlKey(url);
    if (!key) return false;
    const g = groups.find((x) => joinGroupUrlKey(x.url) === key);
    if (!g) return true; // new row — never verified
    return g.canPost !== true;
  };

  const allUrls = st.confirmedToday.map((r) => r.url).filter(Boolean);
  const urls = [];
  let skippedAlreadyOk = 0;
  for (const u of allUrls) {
    if (needsPostabilityCheck(u)) urls.push(u);
    else skippedAlreadyOk++;
  }

  const writePassState = async (patchSt) => {
    if (passRunId && !(await joinQueueStillOwns(passRunId))) return false;
    if (passRunId) patchSt.runId = passRunId;
    await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: patchSt });
    return true;
  };

  if (!urls.length) {
    st.postabilityPassDoneDay = dk;
    if (await writePassState(st)) {
      broadcastToApp({
        action: 'joinQueuePostabilityPass',
        phase: 'done',
        checked: 0,
        canPost: 0,
        removed: 0,
        skippedAlreadyOk,
      });
      try {
        await syncCanPostGroupsIntoCampaign();
      } catch (_) {}
    }
    return { ran: false, checked: 0, canPost: 0, removed: 0, skippedAlreadyOk };
  }

  const summary = await runPostJoinPostabilityPass(urls);
  if (passRunId && !(await joinQueueStillOwns(passRunId))) {
    return { ran: true, ...summary, skippedAlreadyOk, abortedOwnership: true };
  }
  st.postabilityPassDoneDay = dk;
  if (await writePassState(st)) {
    broadcastToApp({
      action: 'joinQueuePostabilityPass',
      phase: 'done',
      ...summary,
      skippedAlreadyOk,
    });
    try {
      await syncCanPostGroupsIntoCampaign();
    } catch (_) {}
  }
  return { ran: true, ...summary, skippedAlreadyOk };
}

async function stopJoinQueueInternal() {
  joinQueueAbortRequested = true;
  try {
    await chrome.alarms.clear('irishka_join_resume');
  } catch (_) {}
  try {
    const d = await chrome.storage.local.get([JOIN_QUEUE_KEY]);
    const st = d[JOIN_QUEUE_KEY];
    if (st && typeof st === 'object') {
      st.active = false;
      await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: st });
    }
  } catch (_) {}
  try {
    await chrome.storage.local.remove([JOIN_QUEUE_KEY]);
  } catch (_) {}
  const deadline = Date.now() + 45_000;
  while (joinQueueChunkRunning && Date.now() < deadline) {
    await sleep(80);
  }
}

function newJoinQueueRunId() {
  return 'jq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

async function joinQueueStillOwns(runId) {
  if (!runId) return false;
  const live = (await chrome.storage.local.get([JOIN_QUEUE_KEY]))[JOIN_QUEUE_KEY];
  return !!(live && live.active && live.runId === runId);
}

async function beginJoinQueueFromMessage(msg) {
  const urls = Array.isArray(msg.urls) ? msg.urls.map((u) => String(u || '').trim()).filter(Boolean) : [];
  if (!urls.length) return { ok: false, error: 'no_urls' };
  const dailyMax = Math.max(1, Math.min(500, Number(msg.dailyMax) || 5));
  const resumeHhmm = String(msg.resumeHhmm || '07:00').trim() || '07:00';

  // Abort any in-flight chunk/pass so it cannot overwrite this new run.
  if (joinQueueChunkRunning) {
    await stopJoinQueueInternal();
  } else {
    joinQueueAbortRequested = false;
    try { await chrome.alarms.clear('irishka_join_resume'); } catch (_) {}
  }

  joinQueueAbortRequested = false;
  const st = {
    active: true,
    runId: newJoinQueueRunId(),
    urls,
    cursor: 0,
    joinedToday: 0,
    dayKey: dayKey(Date.now()),
    dailyMax,
    resumeHhmm,
    confirmedToday: [],
    postabilityPassDoneDay: null,
  };
  await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: st });
  chrome.alarms.clear('irishka_join_resume');
  await runJoinQueueChunk();
  return { ok: true };
}

async function runJoinQueueChunk() {
  if (joinQueueChunkRunning) return;
  joinQueueChunkRunning = true;
  try {
    await runJoinQueueChunkInner();
  } finally {
    joinQueueChunkRunning = false;
  }
}

async function runJoinQueueChunkInner() {
  const d = await chrome.storage.local.get([JOIN_QUEUE_KEY]);
  let st = d[JOIN_QUEUE_KEY];
  if (!st || !st.active || !Array.isArray(st.urls) || !st.urls.length) return;

  const myRunId = st.runId || null;
  if (!myRunId) {
    // Legacy state without runId — assign one so ownership checks work for this chunk.
    st.runId = newJoinQueueRunId();
    await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: st });
  }
  const runId = st.runId;

  const resetDayCounters = (state, dk) => {
    state.dayKey = dk;
    state.joinedToday = 0;
    state.confirmedToday = [];
    state.postabilityPassDoneDay = null;
  };

  const dk = dayKey(Date.now());
  if (st.dayKey !== dk) resetDayCounters(st, dk);
  if (!Array.isArray(st.confirmedToday)) st.confirmedToday = [];

  const dailyMax = Math.max(1, Number(st.dailyMax) || 5);
  let idx = Math.max(0, Number(st.cursor) || 0);
  let workerId = null;

  /**
   * Quota = real join actions: new membership, join request after click, or Join click
   * when DOM is unclear. Already-member / already-pending do NOT burn quota.
   * (Strict "joined_confirmed only" caused runaway: quota stayed 0 forever.)
   * isMember upsert only when decision.upsertMember (joined_confirmed).
   */
  try {
    while (idx < st.urls.length) {
      const live = await chrome.storage.local.get([JOIN_QUEUE_KEY]);
      st = live[JOIN_QUEUE_KEY];
      if (!st || st.runId !== runId) {
        joinQueueAbortRequested = true;
        break;
      }
      st.cursor = idx;
      if (!Array.isArray(st.confirmedToday)) st.confirmedToday = [];

      const dkNow = dayKey(Date.now());
      if (st.dayKey !== dkNow) resetDayCounters(st, dkNow);

      const gate =
        typeof JoinQueueLogic !== 'undefined' && JoinQueueLogic.shouldStopBeforeStep
          ? JoinQueueLogic.shouldStopBeforeStep(st, { abortRequested: joinQueueAbortRequested })
          : {
              stop: joinQueueAbortRequested || !st.active || (Number(st.joinedToday) || 0) >= dailyMax,
              why: '',
            };
      if (gate.stop) {
        if (gate.why === 'abort' || joinQueueAbortRequested || !st.active) {
          joinQueueAbortRequested = true;
        }
        break;
      }
      const used = Number(st.joinedToday) || 0;

      const url = st.urls[idx];
      let outcome = 'failed';
      let reason = '';
      let countsTowardQuota = false;
      let recordConfirmed = false;
      let upsertMember = false;

      try {
        const owned = await getOrCreateOwnedBgTab(workerId, url);
        workerId = owned.id;
        if (joinQueueAbortRequested) break;
        await sleep(1800);

        const joinInj = await chrome.scripting.executeScript({
          target: { tabId: workerId },
          func: joinGroupInPageInjected,
        });
        const joinRes = joinInj?.[0]?.result || {};

        let conf = null;
        if (
          joinRes.clicked &&
          !joinRes.alreadyMember &&
          !joinRes.pendingBefore &&
          joinRes.pre?.outcome !== 'joined_confirmed' &&
          joinRes.pre?.outcome !== 'request_pending'
        ) {
          await sleep(3200);
          const confInj = await chrome.scripting.executeScript({
            target: { tabId: workerId },
            func: classifyJoinPageStateInjected,
          });
          conf = confInj?.[0]?.result || {};
        }

        const decision =
          typeof JoinQueueLogic !== 'undefined' && JoinQueueLogic.decideJoinStep
            ? JoinQueueLogic.decideJoinStep(joinRes, conf)
            : {
                outcome: 'failed',
                reason: 'no_join_logic',
                countsTowardQuota: false,
                recordConfirmed: false,
                upsertMember: false,
              };
        outcome = decision.outcome;
        reason = decision.reason;
        countsTowardQuota = !!decision.countsTowardQuota;
        recordConfirmed = !!decision.recordConfirmed;
        upsertMember = !!decision.upsertMember;

        idx++;
        st.cursor = idx;
        st.runId = runId;

        if (countsTowardQuota) {
          st.joinedToday = used + 1;
        }
        if (recordConfirmed) {
          const cleanUrl = normalizeJoinGroupUrl(url);
          const exists = st.confirmedToday.some(
            (r) => joinGroupUrlKey(r.url) === joinGroupUrlKey(cleanUrl)
          );
          if (!exists) {
            st.confirmedToday.push({
              url: cleanUrl,
              at: Date.now(),
              outcome,
              reason,
            });
          }
          if (upsertMember) {
            await upsertFbGroupAfterConfirmedJoin(cleanUrl);
          }
        }

        if (joinQueueAbortRequested) break;
        if (!(await joinQueueStillOwns(runId))) {
          joinQueueAbortRequested = true;
          break;
        }
        await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: st });
        broadcastToApp({
          action: 'joinQueueProgress',
          joinedTotal: idx,
          listTotal: st.urls.length,
          joinedToday: st.joinedToday,
          dailyMax,
          lastUrl: url,
          lastOk: countsTowardQuota || outcome === 'joined_confirmed',
          lastOutcome: outcome,
          lastReason: reason,
          confirmedToday: st.joinedToday,
        });
      } catch (e) {
        idx++;
        st.cursor = idx;
        st.runId = runId;
        if (!joinQueueAbortRequested && (await joinQueueStillOwns(runId))) {
          await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: st });
          broadcastToApp({
            action: 'joinQueueProgress',
            joinedTotal: idx,
            listTotal: st.urls.length,
            joinedToday: st.joinedToday,
            dailyMax,
            lastUrl: url,
            lastOk: false,
            lastOutcome: 'failed',
            lastReason: String(e?.message || e || 'error').slice(0, 120),
          });
        } else {
          joinQueueAbortRequested = true;
        }
        if (workerId != null) {
          await safeRemoveTab(workerId, 2500);
          workerId = null;
        }
      }

      if ((Number(st.joinedToday) || 0) >= dailyMax) break;
      if (joinQueueAbortRequested) break;
      await sleep(3500);
    }
  } finally {
    if (workerId != null) await safeRemoveTab(workerId, 5000);
  }

  if (joinQueueAbortRequested) {
    joinQueueAbortRequested = false;
    // Only clear storage/alarm if this chunk still owns the queue (never wipe a newer run).
    const live = (await chrome.storage.local.get([JOIN_QUEUE_KEY]))[JOIN_QUEUE_KEY];
    if (!live || live.runId === runId) {
      try { await chrome.alarms.clear('irishka_join_resume'); } catch (_) {}
      try { await chrome.storage.local.remove([JOIN_QUEUE_KEY]); } catch (_) {}
      broadcastToApp({ action: 'joinQueueFinished', total: idx, aborted: true });
    }
    return;
  }

  st = (await chrome.storage.local.get([JOIN_QUEUE_KEY]))[JOIN_QUEUE_KEY];
  if (!st || !st.active || st.runId !== runId) return;

  const hitDailyCap = (Number(st.joinedToday) || 0) >= Math.max(1, Number(st.dailyMax) || 5);
  const queueDone = (st.cursor || 0) >= st.urls.length;

  if (hitDailyCap || queueDone) {
    try {
      await maybeRunJoinPostabilityPass(st);
      st = (await chrome.storage.local.get([JOIN_QUEUE_KEY]))[JOIN_QUEUE_KEY] || st;
    } catch (_) {}
  }

  if (!st || !st.active || st.runId !== runId) return;

  if ((st.cursor || 0) >= st.urls.length) {
    st.active = false;
    await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: st });
    chrome.alarms.clear('irishka_join_resume');
    broadcastToApp({ action: 'joinQueueFinished', total: st.urls.length });
    return;
  }

  if (hitDailyCap) {
    if (!(await joinQueueStillOwns(runId))) return;
    const when = computeNextJoinResumeMs(st.resumeHhmm || '07:00');
    chrome.alarms.clear('irishka_join_resume');
    chrome.alarms.create('irishka_join_resume', { when });
    await chrome.storage.local.set({ [JOIN_QUEUE_KEY]: st });
    broadcastToApp({
      action: 'joinQueueScheduled',
      when,
      nextIndex: st.cursor,
      listTotal: st.urls.length,
      joinedToday: st.joinedToday,
      dailyMax: st.dailyMax,
    });
  }
}

/**
 * Arm wake via ScheduleEngine (canonical). Falls back to legacy alarm name if needed.
 */
async function scheduleResume(whenMs, reason) {
  const kind =
    reason && String(reason).toLowerCase().includes('daily') ? 'daily_limit' : 'scheduled_start';
  if (typeof ScheduleEngine !== 'undefined') {
    const arm = await ScheduleEngine.armSchedule({
      atMs: whenMs,
      kind,
      reason: reason || 'Scheduled'
    });
    const when = arm && arm.ok && arm.schedule ? Number(arm.schedule.atMs) : Number(whenMs);
    const d = new Date(when);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const msg = (reason || 'Scheduled') + ' · reanuda ' + d.toLocaleDateString() + ' ' + hh + ':' + mm;
    broadcastToApp({
      action: 'plannerStatus',
      message: msg,
      plannedStartAt: when,
      resumeHint: kind
    });
    return when;
  }
  // Extreme fallback
  const when = Math.max(Math.round(Number(whenMs) || 0), Date.now() + 2000);
  try {
    await chrome.alarms.create('irishka_poster_wake', { when });
  } catch (_) {}
  return when;
}

async function maybeResumeProgrammedIfDue() {
  if (typeof ScheduleEngine !== 'undefined') {
    const r = await ScheduleEngine.tick({ source: 'maybe_due' });
    return !!(r && r.started);
  }
  return false;
}

async function schedulePostingAtFromApp(atMs) {
  const when = Number(atMs);
  if (typeof ScheduleDiag !== 'undefined') {
    await ScheduleDiag.log('ui.schedulePostingAt.enter', {
      atMs: when,
      atIso: Number.isFinite(when) ? new Date(when).toISOString() : null,
      now: Date.now(),
      posterRunning
    });
  }
  if (!Number.isFinite(when) || when <= Date.now()) {
    if (typeof ScheduleDiag !== 'undefined') {
      await ScheduleDiag.log('ui.schedulePostingAt.bad_time', { when, now: Date.now() });
    }
    return { ok: false, error: 'bad_time' };
  }
  if (posterRunning) return { ok: false, error: 'already_running' };

  const stored = await chrome.storage.local.get([RUNSTATE_KEY, 'posterConfig', 'fbGroups']);
  const pc = stored.posterConfig && typeof stored.posterConfig === 'object' ? { ...stored.posterConfig } : {};
  const existing = runState && runState.config ? runState : (stored[RUNSTATE_KEY] || null);
  const continuing = campaignHasProgress(existing);

  // Always need posts in current posterConfig (or existing campaign).
  const draftConfig = { ...pc };
  await hydratePosterImagesFromSession(draftConfig);
  const posts = normalizePosts(draftConfig);
  if (!posts.length || !posts.some((p) => String(p.text || '').trim())) {
    if (continuing && existing?.config) {
      const existingPosts = normalizePosts(existing.config);
      if (!existingPosts.length || !existingPosts.some((p) => String(p.text || '').trim())) {
        if (typeof ScheduleDiag !== 'undefined') {
          await ScheduleDiag.log('ui.schedulePostingAt.no_posts', {});
        }
        return { ok: false, error: 'no_posts' };
      }
    } else {
      if (typeof ScheduleDiag !== 'undefined') {
        await ScheduleDiag.log('ui.schedulePostingAt.no_posts', {});
      }
      return { ok: false, error: 'no_posts' };
    }
  }

  posterRunning = false;
  stopRequested = false;
  const now = Date.now();

  if (continuing && existing?.config) {
    // CONTINUE campaign: keep cursor, results, order. Only refresh posts/flags + append can-post.
    const cfg = { ...existing.config };
    try {
      await syncRunningConfigFromStorage(cfg);
    } catch (_) {}
    if (posts.length && posts.some((p) => String(p.text || '').trim())) {
      cfg.posts = posts;
      cfg.text = String(posts[0]?.text || cfg.text || '');
      cfg.images = (posts[0]?.images || []).slice(0, MAX_POST_IMAGES);
    }
    if (typeof pc.pauseOnFailedPublication === 'boolean') {
      cfg.pauseOnFailedPublication = pc.pauseOnFailedPublication;
    }
    if (typeof pc.loopInfinite === 'boolean') cfg.loopInfinite = pc.loopInfinite;
    if (typeof pc.verifiedOnlyEnabled === 'boolean') cfg.verifiedOnlyEnabled = pc.verifiedOnlyEnabled;
    if (typeof pc.dailyLimitEnabled === 'boolean') cfg.dailyLimitEnabled = pc.dailyLimitEnabled;
    if (pc.dailySuccessLimit != null) cfg.dailySuccessLimit = Number(pc.dailySuccessLimit) || cfg.dailySuccessLimit;
    if (pc.dailyResumeTime) cfg.dailyResumeTime = String(pc.dailyResumeTime);

    runState = {
      ...existing,
      config: cfg,
      index: Number(existing.index) || 0,
      postIndex: Number(existing.postIndex) || 0,
      results: Array.isArray(existing.results) ? existing.results : [],
      retryGroups: Array.isArray(existing.retryGroups) ? existing.retryGroups : [],
      dailySuccessCount: Number(existing.dailySuccessCount) || 0,
      dailyKey: existing.dailyKey || dayKey(now),
      startedOnce: true,
      plannedStartAt: when,
      resumeHint: existing.resumeHint === 'daily_limit' ? 'daily_limit' : 'scheduled_start',
      stopReason: null,
      workerTabId: existing.workerTabId != null ? existing.workerTabId : null,
      lockGroupWalkOrder: true,
    };
    await chrome.storage.local.set({
      posterRunning: false,
      posterResults: Array.isArray(runState.results) ? runState.results : [],
    });
    await persistRunState();
    try {
      await syncCanPostGroupsIntoCampaign();
    } catch (_) {}
    const lockedWhen = await scheduleResume(
      when,
      runState.resumeHint === 'daily_limit'
        ? 'Pausa diaria · reanuda programado'
        : 'Scheduled posting (continue)'
    );
    if (runState) runState.plannedStartAt = lockedWhen;
    await persistRunState();
    if (typeof ScheduleDiag !== 'undefined') {
      const alarms = await ScheduleDiag.listAlarms();
      await ScheduleDiag.log('ui.schedulePostingAt.armed_continue', {
        lockedWhen,
        lockedIso: new Date(lockedWhen).toISOString(),
        index: runState.index,
        postIndex: runState.postIndex,
        groups: runState.config?.groups?.length || 0,
        alarms
      });
    }
    return {
      ok: true,
      atMs: lockedWhen,
      continued: true,
      resumeIndex: runState.index || 0,
      totalGroups: runState.config?.groups?.length || 0,
    };
  }

  // Fresh schedule (no mid-campaign): build walk once and lock it.
  const config = { ...draftConfig };
  if (!Array.isArray(config.groups) || !config.groups.length) {
    const fb = Array.isArray(stored.fbGroups) ? stored.fbGroups : [];
    let sel = fb.filter((g) => g?.selected);
    if (config.verifiedOnlyEnabled) sel = sel.filter((g) => g.canPost === true);
    config.groups = sel.map(mapGroupRowForWalk);
  }
  if (!Array.isArray(config.groups) || !config.groups.length) {
    if (typeof ScheduleDiag !== 'undefined') {
      await ScheduleDiag.log('ui.schedulePostingAt.no_groups', {});
    }
    return { ok: false, error: 'no_groups' };
  }
  if (isCommunityFreeBuildBg() && config.communityProfileFirst !== false) {
    const hasSlot = (config.groups || []).some((g) => g && g.isProfileTimelineSlot);
    if (!hasSlot) {
      config.groups = [makeProfileTimelineSlotBg(), ...config.groups];
    }
  }
  runState = {
    config,
    results: [],
    index: 0,
    postIndex: 0,
    dailySuccessCount: 0,
    dailyKey: dayKey(now),
    startedOnce: false,
    plannedStartAt: when,
    resumeHint: 'scheduled_start',
    stopReason: null,
    workerTabId: null,
    retryGroups: [],
    lockGroupWalkOrder: true,
  };
  await chrome.storage.local.set({ posterRunning: false, posterResults: [] });
  await persistRunState();
  const lockedWhen = await scheduleResume(when, 'Scheduled posting');
  if (runState) runState.plannedStartAt = lockedWhen;
  await persistRunState();
  if (typeof ScheduleDiag !== 'undefined') {
    const alarms = await ScheduleDiag.listAlarms();
    await ScheduleDiag.log('ui.schedulePostingAt.armed', {
      lockedWhen,
      lockedIso: new Date(lockedWhen).toISOString(),
      groups: config.groups.length,
      posts: posts.length,
      alarms
    });
  }
  return {
    ok: true,
    atMs: lockedWhen,
    continued: false,
    resumeIndex: 0,
    totalGroups: config.groups.length,
  };
}

async function cancelScheduledPostingFromApp() {
  const d = await chrome.storage.local.get([RUNSTATE_KEY]);
  const saved = d[RUNSTATE_KEY];
  const hadLegacy = !!(saved && saved.resumeHint === 'scheduled_start');
  let hadEngine = false;
  if (typeof ScheduleEngine !== 'undefined') {
    const st = await ScheduleEngine.getStatus();
    hadEngine = !!(st && st.schedule && st.schedule.status === 'armed' && st.schedule.kind === 'scheduled_start');
    await ScheduleEngine.cancelSchedule('user_cancel');
  }
  if (!hadLegacy && !hadEngine) {
    return { ok: false, error: 'nothing_to_cancel' };
  }
  // Never wipe a mid-campaign cursor just because the wake was cancelled.
  if (saved && campaignHasProgress(saved)) {
    const kept = {
      ...saved,
      plannedStartAt: null,
      resumeHint: saved.resumeHint === 'daily_limit' ? 'daily_limit' : null,
      lockGroupWalkOrder: true,
    };
    await chrome.storage.local.set({ [RUNSTATE_KEY]: kept });
    if (runState) {
      runState.plannedStartAt = null;
      if (runState.resumeHint === 'scheduled_start') delete runState.resumeHint;
      runState.lockGroupWalkOrder = true;
    }
  } else if (hadLegacy || (saved && saved.resumeHint === 'scheduled_start')) {
    await chrome.storage.local.remove(RUNSTATE_KEY);
    runState = null;
  }
  broadcastToApp({ action: 'plannerStatus', message: '' });
  return { ok: true };
}

if (typeof ScheduleEngine !== 'undefined') {
  ScheduleEngine.setResumeHandler(async (meta) => {
    const src = String((meta && meta.source) || '');
    // Keep SW alive for autonomous wakes. UI poll keepsalive via repeated messages.
    const awaitLoop = src === 'alarm' || src === 'bootstrap_overdue' || src === 'recover' || src === 'bridge_poll';
    return resumePostingFromStoredRunState({ awaitLoop });
  });
  ScheduleEngine.bootstrap().catch(() => {});
}

async function setPosterLoopInfiniteFromApp(loopInfinite) {
  const ok = await ensureRunStateForConfigPatch();
  if (!ok || !runState?.config) return { ok: false, error: 'not_running' };
  runState.config.loopInfinite = !!loopInfinite;
  const d = await chrome.storage.local.get(['posterConfig']);
  const pc = d.posterConfig && typeof d.posterConfig === 'object' ? { ...d.posterConfig } : {};
  pc.loopInfinite = !!loopInfinite;
  await chrome.storage.local.set({ posterConfig: pc });
  persistRunState();
  broadcastToApp({ action: 'posterLoopModeChanged', loopInfinite: !!loopInfinite });
  return { ok: true };
}

async function requestSkipCurrentPosterPost() {
  if (!runState || !posterRunning) return { ok: false, error: 'not_running' };
  runState.skipCurrentPostSweep = true;
  return { ok: true };
}

async function loadPosterImageLayers() {
  if (typeof posterImageIdbLoadLayers !== 'function') return [];
  try {
    const layers = await posterImageIdbLoadLayers();
    return Array.isArray(layers) ? layers : [];
  } catch (_) {
    return [];
  }
}

async function persistPosterConfigWithImages(config) {
  const layers = await loadPosterImageLayers();
  const cfg = {
    ...config,
    posts: (Array.isArray(config.posts) ? config.posts : []).map((p, i) =>
      mergeLayerRowIntoPostImages(p, layers[i] || [])
    ),
  };
  if (cfg.posts[0]?.images) {
    cfg.images = (cfg.posts[0].images || []).slice(0, MAX_POST_IMAGES);
  }
  return new Promise((resolve, reject) => {
    const finish = (slim) => {
      chrome.storage.local.set({ posterConfig: slim }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    };
    if (typeof writePosterImagesSessionThenSlim !== 'function') {
      finish(slimPosterConfigForDisk(cfg));
      return;
    }
    writePosterImagesSessionThenSlim(cfg, (r) => {
      if (!r.ok) {
        const hasPixels = (cfg.posts || []).some((p) =>
          (p.images || []).some((img) => String(img?.dataUrl || '').length > 80)
        );
        if (hasPixels) {
          reject(new Error(r.error || 'image_persist_failed'));
          return;
        }
      }
      finish(r.slim || slimPosterConfigForDisk(cfg));
    });
  });
}

async function fleetQueuePostFromMessage(post, options) {
  const p = post && typeof post === 'object' ? post : null;
  const text = String(p?.text || '').trim();
  if (!text) return { ok: false, error: 'bad_post', message: 'text required' };
  const images = (Array.isArray(p?.images) ? p.images : []).slice(0, MAX_POST_IMAGES).map((img) => ({
    dataUrl: String(img?.dataUrl || ''),
    name: String(img?.name || ''),
    type: String(img?.type || 'image/jpeg'),
  }));
  const row = { text, images };
  const replaceQueue = options?.replaceQueue === true && !posterRunning;

  if (posterRunning && runState?.config) {
    const r = await appendPostToRunningLoopFromMessage(row);
    return {
      ok: !!r?.ok,
      message: r?.ok ? 'Post added to running queue' : (r?.error || 'append failed'),
    };
  }

  const d = await chrome.storage.local.get(['posterConfig']);
  const pc = d.posterConfig && typeof d.posterConfig === 'object' ? { ...d.posterConfig } : {};
  const existingLayers = await loadPosterImageLayers();
  let posts;
  if (replaceQueue) {
    posts = [row];
  } else {
    posts = Array.isArray(pc.posts) && pc.posts.length
      ? pc.posts.map((item, i) => mergeLayerRowIntoPostImages({
          text: String(item?.text || ''),
          images: (Array.isArray(item?.images) ? item.images : []).slice(0, MAX_POST_IMAGES),
        }, existingLayers[i] || []))
      : (pc.text ? [mergeLayerRowIntoPostImages({
          text: String(pc.text),
          images: pc.images || [],
        }, existingLayers[0] || [])] : []);
    posts.push(mergeLayerRowIntoPostImages(row, []));
  }
  const fullPc = {
    ...pc,
    posts,
  };
  fullPc.text = String(fullPc.posts[0]?.text || '');
  fullPc.images = (fullPc.posts[0]?.images || []).slice(0, MAX_POST_IMAGES);
  if (fullPc.posts.some((item) => /\{[^{}]*\|[^{}]*\}/.test(item.text || ''))) {
    fullPc.useSpintax = true;
  }
  try {
    await persistPosterConfigWithImages(fullPc);
  } catch (e) {
    return {
      ok: false,
      error: 'persist_failed',
      message: String(e?.message || e).slice(0, 120),
    };
  }
  broadcastToApp({ action: 'fleetRemoteAction', fleetAction: 'postsChanged' });
  const withImg = row.images.some((img) => String(img?.dataUrl || '').length > 80);
  return {
    ok: true,
    message: withImg
      ? `Post con imagen en cola (${posts.length})`
      : (replaceQueue ? 'Post reemplazado en cola' : `Post en cola (${posts.length})`),
  };
}

async function fleetResetIdlePostsFromMessage(meta) {
  if (posterRunning) {
    return { ok: false, error: 'posting', message: 'No se puede limpiar mientras publica' };
  }
  const d = await chrome.storage.local.get(['posterConfig']);
  const pc = d.posterConfig && typeof d.posterConfig === 'object' ? { ...d.posterConfig } : {};
  const layers = await loadPosterImageLayers();
  const posts = Array.isArray(pc.posts) && pc.posts.length
    ? pc.posts.map((item, i) => mergeLayerRowIntoPostImages({
        text: String(item?.text || ''),
        images: (Array.isArray(item?.images) ? item.images : []).slice(0, MAX_POST_IMAGES),
      }, layers[i] || []))
    : (pc.text ? [mergeLayerRowIntoPostImages({
        text: String(pc.text),
        images: pc.images || [],
      }, layers[0] || [])] : []);
  if (!posts.length) return { ok: true, message: 'Cola ya vacía' };
  if (posts.length === 1) return { ok: true, message: 'Un solo post en cola' };

  const mode = String(meta?.keep || 'with_image').toLowerCase();
  let keepIdx = posts.length - 1;
  if (mode === 'with_image' || mode === 'image') {
    const imgIdx = posts.findIndex((p) =>
      (p.images || []).some((img) => String(img?.dataUrl || '').length > 80 || String(img?.name || '').trim())
    );
    if (imgIdx >= 0) keepIdx = imgIdx;
  } else if (mode === 'first') {
    keepIdx = 0;
  }

  const kept = mergeLayerRowIntoPostImages(posts[keepIdx], layers[keepIdx] || []);
  const fullPc = {
    ...pc,
    posts: [kept],
    text: String(kept.text || ''),
    images: (kept.images || []).slice(0, MAX_POST_IMAGES),
  };
  try {
    await persistPosterConfigWithImages(fullPc);
  } catch (e) {
    return { ok: false, message: String(e?.message || e).slice(0, 120) };
  }
  broadcastToApp({ action: 'fleetRemoteAction', fleetAction: 'postsChanged' });
  return { ok: true, message: `Cola reducida a 1 post (había ${posts.length})` };
}

async function fleetRemovePostFromMessage(index) {
  const idx = Number(index);
  if (!Number.isFinite(idx) || idx < 0) return { ok: false, error: 'bad_index', message: 'index required' };

  if (posterRunning && runState?.config) {
    const posts = Array.isArray(runState.config.posts) ? [...runState.config.posts] : [];
    if (idx >= posts.length) return { ok: false, error: 'out_of_range', message: 'index out of range' };
    if (posts.length <= 1) {
      return { ok: false, error: 'last_post', message: 'Cannot remove the only post while posting' };
    }
    posts.splice(idx, 1);
    runState.config.posts = posts;
    if (typeof runState.postIndex === 'number') {
      if (runState.postIndex > idx) runState.postIndex -= 1;
      else if (runState.postIndex >= posts.length) runState.postIndex = 0;
    }
    runState.config.text = String(posts[0]?.text || '');
    runState.config.images = (posts[0]?.images || []).slice(0, MAX_POST_IMAGES);
    const d = await chrome.storage.local.get(['posterConfig']);
    const prev = d.posterConfig && typeof d.posterConfig === 'object' ? d.posterConfig : {};
    await chrome.storage.local.set({
      posterConfig: {
        ...prev,
        ...runState.config,
        posts: [...posts],
      },
    });
    persistRunState();
    broadcastToApp({
      action: 'runningPostsQueueChanged',
      totalPosts: posts.length,
    });
    return { ok: true, message: `Post removed (${posts.length} left)` };
  }

  const d = await chrome.storage.local.get(['posterConfig']);
  const pc = d.posterConfig && typeof d.posterConfig === 'object' ? { ...d.posterConfig } : {};
  const posts = Array.isArray(pc.posts) && pc.posts.length
    ? [...pc.posts]
    : (pc.text ? [{ text: String(pc.text), images: pc.images || [] }] : []);
  if (!posts.length) return { ok: false, error: 'empty', message: 'No posts in queue' };
  if (idx >= posts.length) return { ok: false, error: 'out_of_range', message: 'index out of range' };
  posts.splice(idx, 1);
  const layers = await loadPosterImageLayers();
  if (layers.length) layers.splice(idx, 1);
  const fullPosts = posts.map((p, i) => mergeLayerRowIntoPostImages(p, layers[i] || []));
  pc.posts = fullPosts;
  pc.text = String(fullPosts[0]?.text || '');
  pc.images = (fullPosts[0]?.images || []).slice(0, MAX_POST_IMAGES);
  if (!fullPosts.length) {
    delete pc.text;
    pc.images = [];
  }
  try {
    await persistPosterConfigWithImages(pc);
  } catch (e) {
    await chrome.storage.local.set({ posterConfig: slimPosterConfigForDisk(pc) });
  }
  broadcastToApp({ action: 'fleetRemoteAction', fleetAction: 'postsChanged' });
  return { ok: true, message: fullPosts.length ? `Post removed (${fullPosts.length} left)` : 'Queue cleared' };
}

async function fleetStartPostingFromMessage() {
  if (posterRunning) return { ok: false, error: 'already_running', message: 'Already posting' };
  const d = await chrome.storage.local.get(['posterConfig', 'fbGroups']);
  const pc = d.posterConfig && typeof d.posterConfig === 'object' ? { ...d.posterConfig } : {};
  const posts = Array.isArray(pc.posts) && pc.posts.length
    ? pc.posts
    : (pc.text ? [{ text: pc.text, images: pc.images || [] }] : []);
  if (!posts.some((p) => String(p?.text || '').trim())) {
    return { ok: false, error: 'no_posts', message: 'Add at least one post first' };
  }
  const raw = Array.isArray(d.fbGroups) ? d.fbGroups : [];
  let sel = raw.filter((g) => g?.selected);
  if (pc.verifiedOnlyEnabled) sel = sel.filter((g) => g.canPost === true);
  if (!sel.length) return { ok: false, error: 'no_groups', message: 'No selected groups' };
  const hasSpintax = posts.some((p) => /\{[^{}]*\|[^{}]*\}/.test(p.text || ''));
  const config = {
    ...pc,
    posts,
    text: String(posts[0]?.text || ''),
    images: (posts[0]?.images || []).slice(0, MAX_POST_IMAGES),
    useSpintax: hasSpintax,
    groups: sel,
    timerEnabled: pc.timerEnabled !== false,
    timerSeconds: Number(pc.timerSeconds) || 180,
    timerVariation: Number(pc.timerVariation) || 0,
    dailyLimitEnabled: pc.dailyLimitEnabled !== false,
    dailySuccessLimit: Number(pc.dailySuccessLimit) || 3,
    dailyResumeTime: String(pc.dailyResumeTime || '09:00'),
    bgTabsEnabled: pc.bgTabsEnabled !== false,
    closeTabAfterPost: pc.closeTabAfterPost !== false,
    notifyEnd: !!pc.notifyEnd,
    loopInfinite: !!pc.loopInfinite,
    verifiedOnlyEnabled: !!pc.verifiedOnlyEnabled,
    pauseOnFailedPublication: pc.pauseOnFailedPublication === true,
    communityProfileFirst: pc.communityProfileFirst !== false,
  };
  await chrome.storage.local.set({ posterConfig: config });
  // Fire-and-forget like resume: awaiting the full campaign blocks Fleet
  // heartbeat/poll and freezes the Fleet panel for the whole run.
  startPostingProcess(config, sel).catch((e) => {
    console.warn('[Irishka] fleetStartPosting failed', e);
  });
  return {
    ok: true,
    message: `Posting started (${posts.length} post${posts.length === 1 ? '' : 's'})`,
  };
}

self.FLEET_BG_HANDLERS = {
  fleetQueuePost: (msg) => fleetQueuePostFromMessage(msg.post, { replaceQueue: msg.replaceQueue === true }),
  fleetRemovePost: (msg) => fleetRemovePostFromMessage(msg.index),
  fleetStartPosting: () => fleetStartPostingFromMessage(),
  fleetResetIdlePosts: (msg) => fleetResetIdlePostsFromMessage(msg.meta || {}),
  startJoinQueue: (msg) => beginJoinQueueFromMessage(msg),
  stopJoinQueue: async () => {
    await stopJoinQueueInternal();
    return { ok: true };
  },
};

async function appendPostToRunningLoopFromMessage(post) {
  if (!runState || !posterRunning || !runState.config) return { ok: false, error: 'not_running' };
  const p = post && typeof post === 'object' ? post : null;
  if (!p || !String(p.text || '').trim()) return { ok: false, error: 'bad_post' };
  const images = (Array.isArray(p.images) ? p.images : []).slice(0, MAX_POST_IMAGES).map((img) => ({
    dataUrl: String(img?.dataUrl || ''),
    name: String(img?.name || ''),
    type: String(img?.type || 'image/jpeg')
  }));
  const row = { text: String(p.text || ''), images };
  if (!Array.isArray(runState.config.posts)) runState.config.posts = [];
  runState.config.posts.push(row);
  const d = await chrome.storage.local.get(['posterConfig']);
  const prev = d.posterConfig && typeof d.posterConfig === 'object' ? d.posterConfig : {};
  const merged = {
    ...prev,
    ...runState.config,
    posts: [...(Array.isArray(runState.config.posts) ? runState.config.posts : [])]
  };
  try {
    await persistPosterConfigWithImages(merged);
  } catch (e) {
    await chrome.storage.local.set({ posterConfig: slimPosterConfigForDisk(merged) });
  }
  persistRunState();
  broadcastToApp({
    action: 'runningPostsQueueChanged',
    totalPosts: runState.config.posts.length
  });
  return { ok: true };
}

/** Hot-append verified groups to the end of the campaign walk without resetting the cursor. */
async function appendGroupsToRunningActiveFromMessage(incoming) {
  return appendGroupsToCampaignQueue(incoming);
}

function openOrNavigateTab(url, opts) {
  const options = opts || {};
  const active = options.active !== false;
  const reuse = options.reuse !== false;
  return new Promise((resolve) => {
    const appUrl = chrome.runtime.getURL('app.html');
    chrome.tabs.query({}, (allTabs) => {
      const fbTab = reuse ? allTabs.find(t =>
        t.url && !t.url.startsWith(appUrl) &&
        (t.url.includes('facebook.com') || t.url.includes('web.facebook.com'))
      ) : null;
      const waitLoad = (tab) => {
        let done = false;
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === 'complete' && !done) {
            done = true;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(tab);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          if (!done) { done = true; chrome.tabs.onUpdated.removeListener(listener); resolve(tab); }
        }, 15000);
      };
      if (fbTab) {
        chrome.tabs.update(fbTab.id, { url, active }, waitLoad);
      } else {
        chrome.tabs.create({ url, active }, waitLoad);
      }
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function broadcastToApp(msg) {
  try {
    const action = msg && msg.action;
    if (action === 'progressUpdate' || action === 'joinQueueProgress' || action === 'postSweepStart') {
      touchDeviceHealth({ lastProgressAtMs: Date.now(), lastError: '' });
    } else if (action === 'postingStopped') {
      const reason = String(msg.stopReason || '').trim();
      const patch = { lastStopReason: reason || null };
      if (reason && reason !== 'user_stop' && reason !== 'daily_limit' && reason !== 'user_pause') {
        patch.lastError = reason;
        patch.lastErrorAtMs = Date.now();
      }
      if (reason === 'user_stop' || reason === 'daily_limit') {
        patch.lastError = '';
      }
      touchDeviceHealth(patch);
    } else if (action === 'joinQueueFinished' || action === 'joinQueueScheduled') {
      touchDeviceHealth({ lastProgressAtMs: Date.now() });
    }
  } catch (_) {}
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function withTimeout(promise, ms, label) {
  let t = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(label || 'Timeout')), ms);
    })
  ]).finally(() => {
    if (t) clearTimeout(t);
  });
}

// Injected into Facebook page (args: text, inlineImages[], pauseFlag, expectedImageCount)
async function fbPostInPage(text, inlineImages, pauseBeforePublish, expectedImageCount) {
  const log = [];
  const pauseBeforePublishEffective = !!pauseBeforePublish; // Respeta flag pasado desde background.
  const W = (ms) => new Promise(r => setTimeout(r, ms));
  const L = (m) => {
    log.push(String(m));
    console.log("[Fartmily]", m);
  };
  L("[Inject] T=" + new Date().toISOString());
  L("[Inject] URL=" + String(location.href || "").slice(0, 220));
  L("[Inject] UA móvil=" + /Mobile|Android|iPhone/i.test(navigator.userAgent || ""));
  /** FB usa mucho position:fixed → offsetParent es null y antes ignorábamos el compositor. */
  function isLikelyVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < -80 || r.top > window.innerHeight + 120) return false;
      return true;
    } catch (e) {
      return false;
    }
  }
  function querySelectorAllDeep(sel) {
    const out = [];
    const seen = new Set();
    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      try {
        root.querySelectorAll(sel).forEach((e) => out.push(e));
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      } catch (e) {}
    }
    walk(document);
    return out;
  }
  function forEachShadowRoot(callback) {
    const seen = new Set();
    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      try {
        callback(root);
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      } catch (e) {}
    }
    walk(document);
  }
  let images = Array.isArray(inlineImages)
    ? inlineImages.filter((i) => i && i.dataUrl).slice(0, 3)
    : [];
  const needFromStorage = (Number(expectedImageCount) || 0) > 0 && images.length === 0;
  if (needFromStorage) {
    L("[Inject] Sin imágenes en args; leyendo fartmily_pending_images (local → session)…");
    try {
      if (typeof chrome !== "undefined" && chrome.storage) {
        const stored = await new Promise((resolve, reject) => {
          const finish = (arr) => resolve(Array.isArray(arr) ? arr.slice(0, 3) : []);
          try {
            chrome.storage.local.get("fartmily_pending_images", (r) => {
              const err = chrome.runtime && chrome.runtime.lastError;
              if (!err && r && Array.isArray(r.fartmily_pending_images) && r.fartmily_pending_images.length) {
                return finish(r.fartmily_pending_images);
              }
              if (chrome.storage.session) {
                chrome.storage.session.get("fartmily_pending_images", (r2) => {
                  const err2 = chrome.runtime && chrome.runtime.lastError;
                  if (err2) reject(new Error(err2.message || "storage"));
                  else finish((r2 && r2.fartmily_pending_images) || []);
                });
              } else {
                finish((!err && r && r.fartmily_pending_images) || []);
              }
            });
          } catch (e) {
            reject(e);
          }
        });
        images = stored;
        L("[Inject] Storage imágenes: " + images.length);
      } else {
        L("[Inject] chrome.storage no disponible (mundo aislado sin API?)");
      }
    } catch (e) {
      L("[Inject] Error storage: " + (e.message || e));
    }
  } else {
    L("[Inject] Imágenes en args: " + images.length);
  }

  const humanDelay = () => Math.floor(Math.random() * 40) + 20;
  const textForPost = text;
  const expectedCompactLen = String(textForPost || "").replace(/\s/g, "").length;

  async function openComposer() {
    const keywords = [
      "escribe algo", "escribe un", "escribe", "en que estas pensando", "en qué estás pensando",
      "crea una publicacion", "crear publicacion", "crear publicación", "publicación", "publicar",
      "comenzar publicacion", "añade una publicación", "añade una publicacion", "comparte con el grupo",
      "create a post", "create post", "new post", "write something", "what's on your mind", "what is on your mind",
      "whats on your mind", "something on your mind", "on your mind", "start a discussion", "start discussion",
      "add a post", "share with the group", "write here", "new discussion", "nueva discusion", "publica", "postear",
      "créer une publication", "créer publication", "publier", "écrire quelque chose", "schreib etwas",
      "beitrag erstellen", "nuovo post", "crea post", "comporre", "напишите", "напиши что", "добавить пост",
      "bir şey yaz", "gönderi oluştur", "iets delen", "deel iets", "napisz coś", "utwórz post"
    ];

    const placeholderHint =
      /write|escribe|mind|pensando|something|publica|publicar|\bpost\b|postear|compart|share|discussion|discusi|anuncia|announce|thoughts|piensa|delen|deel|publier|beitrag|publicação/i;

    const testIdHint = /composer|compose|creation|create.?post|new.?post|feed.?story|status.?composer|open.?composer|story.?box|composer.?entry|inline.?composer|mdoc/i;

    const txtOf = (el) => (
      (el?.textContent || "") + " " +
      (el?.getAttribute?.("aria-label") || "") + " " +
      (el?.getAttribute?.("aria-placeholder") || "") + " " +
      (el?.getAttribute?.("placeholder") || "") + " " +
      (el?.getAttribute?.("title") || "")
    ).toLowerCase();

    const isSearchLike = (s) => {
      const x = (s || "").toLowerCase();
      return x.includes("search") || x.includes("buscar") || x.includes("pesquisar") || x.includes("recherch");
    };

    /** Evita abrir flujo Reel / Historia / Stories al buscar el compositor de publicación en perfil. */
    const isReelStoryChrome = (el) => {
      try {
        const h = (el.getAttribute?.("href") || "").toLowerCase();
        if (h && (h.includes("mdoc_stories") || h.includes("/stories/") || /\/reels?\//i.test(h) || h.includes("/reel?"))) return true;
        const al = (el.getAttribute?.("aria-label") || "").trim().toLowerCase();
        if (al) {
          if (/^(crear|create)\s+reel\b/.test(al)) return true;
          if (al === "reel" || /^reel\s*$/i.test(al)) return true;
          if (/\breel\b/.test(al) && !/\bpublic|post|publica|publicación|write|mind|pensando|beitrag|publier\b/i.test(al)) return true;
        }
        const tx = (el.textContent || "").trim().toLowerCase();
        if (tx.length > 0 && tx.length <= 28 && /^(reel|crear reel|create reel|historia|story)$/i.test(tx)) return true;
      } catch (e) {}
      return false;
    };

    const isLikelyOwnProfileTimelineUrl = () => {
      try {
        const u = new URL(location.href);
        const p = (u.pathname || "").replace(/\/+$/, "").toLowerCase() || "/";
        if (p === "/me" || p.startsWith("/me/")) return true;
        if (p === "/profile.php" || p.startsWith("/profile.php")) return true;
        const seg = p.split("/").filter(Boolean);
        if (seg.length === 1) {
          const r = /^(groups|reel|reels|watch|marketplace|events|gaming|ads|pages|notifications|messages|settings|login|account|help|privacy|policies|share|dialog|photo|videos|friends|saved|jobs|docs)$/i;
          if (!r.test(seg[0])) return true;
        }
      } catch (e) {}
      return false;
    };

    const clickVisible = async (el, tag) => {
      if (!el || !isLikelyVisible(el) || isReelStoryChrome(el)) return false;
      try {
        el.scrollIntoView({ block: "center", inline: "center" });
      } catch (e) {}
      L(tag);
      try {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      } catch (e) {}
      el.click();
      await W(700);
      return true;
    };

    const mainEl = document.querySelector('[role="main"]');

    const textNodeHints = [
      "what's on your mind", "whats on your mind", "write something", "write here",
      "crea una publicación", "crear publicación", "escribe algo", "en qué estás pensando",
      "comparte con el grupo", "publicar en el grupo", "add a post", "create post",
      "start a discussion", "publier", "écrire", "beitrag", "nuovo post", "напишите"
    ];

    function findClickableFromTextNodes(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const seenEls = new Set();
      let n;
      while ((n = walker.nextNode())) {
        const s = (n.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (s.length < 8 || s.length > 200) continue;
        if (!textNodeHints.some((h) => s.includes(h))) continue;
        let el = n.parentElement;
        for (let d = 0; d < 14 && el; d++) {
          if (seenEls.has(el)) break;
          seenEls.add(el);
          const role = (el.getAttribute && el.getAttribute("role")) || "";
          const tab = el.getAttribute && el.getAttribute("tabindex");
          if (role === "button" || role === "link" || el.tagName === "A" || el.tagName === "BUTTON") {
            if (isLikelyVisible(el) && !isReelStoryChrome(el)) return el;
          }
          if (el.tagName === "DIV" && tab === "0" && isLikelyVisible(el) && (el.textContent || "").trim().length < 200) {
            if (!isReelStoryChrome(el)) return el;
          }
          el = el.parentElement;
        }
      }
      return null;
    }

    const tryOpenOnce = async () => {
      const main = mainEl || document.body;
      const feedRoot = document.querySelector('[role="feed"]') || main;

      // Perfil propio: priorizar CTA de publicación en línea de tiempo (no Reel / Historia).
      if (isLikelyOwnProfileTimelineUrl()) {
        const mindHints = [
          "what's on your mind", "whats on your mind", "write something", "write here",
          "en qué estás pensando", "en que estas pensando", "qué estás pensando", "que estas pensando",
          "crea una publicación", "crear publicación", "crear una publicacion", "crea una publicacion",
          "add a post", "create post", "start a discussion", "comparte con el grupo"
        ];
        const profCandidates = querySelectorAllDeep('[role="button"],div[role="button"],[role="textbox"],a[href*="composer"]');
        for (const el of profCandidates) {
          if (!isLikelyVisible(el)) continue;
          const t = txtOf(el);
          if (!mindHints.some((h) => t.includes(h))) continue;
          if (await clickVisible(el, "Perfil timeline CTA: " + t.trim().slice(0, 50))) return true;
        }
      }

      // 0) Texto visible en el DOM (y shadow) → subir al botón contenedor.
      let hit = null;
      forEachShadowRoot((root) => {
        if (hit) return;
        try {
          hit = findClickableFromTextNodes(root);
        } catch (e) {}
      });
      if (hit && (await clickVisible(hit, "Compositor por texto visible: " + (hit.textContent || "").trim().slice(0, 50)))) return true;

      // A) data-testid en documento + shadow.
      for (const el of querySelectorAllDeep("[data-testid]")) {
        if (!isLikelyVisible(el)) continue;
        const tid = String(el.getAttribute("data-testid") || "");
        if (!testIdHint.test(tid)) continue;
        if (/comment|search|messenger|marketplace|notification|nav|sidebar|header|menu/i.test(tid)) continue;
        if (/reel|mdoc_story|story_tray|stories_tray|broadcast|live_producer/i.test(tid)) continue;
        if (await clickVisible(el, "Compositor data-testid: " + tid.slice(0, 80))) return true;
      }

      // B) Enlaces al compositor de publicación (sin /stories/ ni mdoc_stories → abrían Reel/Historia).
      for (const a of querySelectorAllDeep('a[href*="composer"], a[href*="quick_composer"]')) {
        if (!isLikelyVisible(a)) continue;
        const h = (a.getAttribute("href") || "").toLowerCase();
        if (h.includes("comment") || h.includes("photo.php")) continue;
        if (await clickVisible(a, "Compositor enlace: " + h.slice(0, 60))) return true;
      }

      // C) role=textbox con placeholder.
      const phBoxes = Array.from(
        querySelectorAllDeep('[role="textbox"][aria-placeholder], [role="textbox"][aria-label], div[role="textbox"]')
      ).filter((el) => isLikelyVisible(el));
      for (const el of phBoxes) {
        const ph = ((el.getAttribute("aria-placeholder") || "") + " " + (el.getAttribute("aria-label") || "")).trim();
        if (!ph || ph.length < 3) continue;
        if (isSearchLike(ph)) continue;
        if (!placeholderHint.test(ph)) continue;
        if (await clickVisible(el, "Compositor textbox aria: " + ph.slice(0, 60))) return true;
      }

      // D) aria-label con keyword.
      for (const el of querySelectorAllDeep("[aria-label]")) {
        if (!isLikelyVisible(el)) continue;
        const al = (el.getAttribute("aria-label") || "").toLowerCase();
        if (!al || isSearchLike(al)) continue;
        if (!keywords.some((k) => al.includes(k))) continue;
        const role = (el.getAttribute("role") || "").toLowerCase();
        if (role !== "button" && role !== "link" && role !== "textbox" && el.tagName !== "A") {
          const btn = el.closest('[role="button"],[role="link"],a,button');
          if (btn && isLikelyVisible(btn) && (await clickVisible(btn, "Compositor aria-label→closest: " + al.slice(0, 50)))) return true;
          continue;
        }
        if (await clickVisible(el, "Compositor aria-label: " + al.slice(0, 50))) return true;
      }

      // E) Botones en feed / main.
      const candidates = Array.from(feedRoot.querySelectorAll('[role="button"],button,[role="link"],a,[contenteditable="true"]'));
      for (const b of candidates) {
        if (!isLikelyVisible(b)) continue;
        const t = txtOf(b);
        if (isSearchLike(t)) continue;
        if (!keywords.some((k) => t.includes(k))) continue;
        const rect = b.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 16) continue;
        if (await clickVisible(b, "Compositor boton texto: " + t.trim().slice(0, 50))) return true;
      }

      // F) Heurística feed (fixed/sticky ok).
      const feedButtons = Array.from(feedRoot.querySelectorAll('[role="button"][tabindex="0"], div[role="button"]')).filter((el) =>
        isLikelyVisible(el)
      );
      feedButtons.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.top - rb.top;
      });
      for (const b of feedButtons.slice(0, 18)) {
        const inner = (b.textContent || "").trim();
        if (inner.length > 120) continue;
        if (inner.length < 2 && !(b.getAttribute("aria-label") || "").trim()) continue;
        const combined = txtOf(b);
        if (isSearchLike(combined)) continue;
        const rect = b.getBoundingClientRect();
        if (rect.top > 620) continue;
        if (placeholderHint.test(combined) || keywords.some((k) => combined.includes(k))) {
          if (await clickVisible(b, "Compositor heuristica feed: " + inner.slice(0, 40))) return true;
        }
      }

      // G) Ray casting vertical en el centro del feed (capas superpuestas).
      const cx = Math.floor(Math.min(window.innerWidth - 24, Math.max(24, window.innerWidth * 0.5)));
      for (let y = 140; y < Math.min(560, window.innerHeight - 100); y += 32) {
        try {
          const stack = document.elementsFromPoint(cx, y);
          for (const el of stack) {
            if (!(el instanceof Element)) continue;
            if (el.closest('[role="dialog"]')) break;
            if (el.closest("nav") || el.closest('[role="navigation"]')) continue;
            const role = el.getAttribute("role");
            const tag = el.tagName;
            if (role === "button" || role === "textbox" || tag === "BUTTON") {
              if (isLikelyVisible(el) && (await clickVisible(el, "Compositor elementsFromPoint " + cx + "," + y + " " + (role || tag)))) return true;
              break;
            }
          }
        } catch (e5) {}
      }

      return false;
    };

    try {
      window.scrollTo(0, 0);
      if (mainEl) try { mainEl.scrollTop = 0; } catch (e) {}
    } catch (e) {}

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        L("Compositor reintento " + (attempt + 1));
        try {
          window.scrollBy(0, -400);
          await W(500);
          if (mainEl) mainEl.scrollTop = Math.max(0, mainEl.scrollTop - 300);
        } catch (e3) {}
      }
      if (await tryOpenOnce()) return true;
      await W(800);
    }

    try {
      const nTid = querySelectorAllDeep("[data-testid]").length;
      const nLab = querySelectorAllDeep("[aria-label]").length;
      L("Diagnostico final: URL=" + String(location.href || "").slice(0, 120));
      L("Diagnostico final: data-testid=" + nTid + " aria-label=" + nLab + " role_main=" + !!document.querySelector('[role="main"]'));
    } catch (e4) {}

    return false;
  }

  async function getEditor(maxMs) {
    function pickBestEditor(scope) {
      const candidates = Array.from((scope || document).querySelectorAll('[contenteditable="true"], [role="textbox"]'))
        .filter((el) => el && isLikelyVisible(el));
      if (!candidates.length) return null;
      const scored = candidates.map(el => {
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const role = (el.getAttribute("role") || "").toLowerCase();
        const multiline = (el.getAttribute("aria-multiline") || "").toLowerCase() === "true";
        const cls = (el.className || "").toString().toLowerCase();
        let score = 0;
        if (role === "textbox") score += 4;
        if (multiline) score += 4;
        if (aria.includes("escribe") || aria.includes("write") || aria.includes("public")) score += 3;
        if (aria.includes("comment") || aria.includes("coment")) score -= 6;
        if (aria.includes("search") || aria.includes("buscar")) score -= 8;
        if (cls.includes("lexical")) score += 2;
        if (el.closest('[role="dialog"]')) score += 2;
        return { el, score };
      }).sort((a, b) => b.score - a.score);
      return scored[0]?.el || null;
    }

    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await W(400);
      for (const dlg of document.querySelectorAll("[role=dialog]")) {
        const bestInDlg = pickBestEditor(dlg);
        if (bestInDlg) { L("Editor en dialogo"); return bestInDlg; }
      }
      const lex = document.querySelector("[data-lexical-editor=true]");
      if (lex && isLikelyVisible(lex)) { L("Lexical editor"); return lex; }
      const bestGlobal = pickBestEditor(document);
      if (bestGlobal) { L("Editor generico"); return bestGlobal; }
    }
    return null;
  }
  async function resolveActiveEditor(maxMs) {
    const ed = await getEditor(maxMs || 5000);
    if (!ed) return null;
    // Some FB flows replace the composer after media upload.
    // Ensure we always type in the latest visible editor node.
    if (!document.body.contains(ed) || !isLikelyVisible(ed)) {
      return await getEditor(3000);
    }
    return ed;
  }

  async function typeText(editor, txt) {
    const raw = String(txt ?? "");
    const firstLine = (raw.split("\n")[0] || "").trim();
    const lineCount = raw.split("\n").length;
    L("typeText(start): " + raw.length + " chars, " + lineCount + " lineas");

    function getEditorText() {
      return String(editor.innerText || editor.textContent || "").trim();
    }

    function selectEditorContents() {
      const sel = window.getSelection();
      if (!sel) return false;
      const r = document.createRange();
      r.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }

    function clearEditor() {
      editor.focus();
      try { selectEditorContents(); document.execCommand("delete", false, null); } catch (e) {}
      try { editor.textContent = ""; } catch (e) {}
      try { editor.innerHTML = ""; } catch (e) {}
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function isOkText(text) {
      if (!text || text.length < 1) return false;
      if (firstLine && !text.includes(firstLine)) return false;
      if (firstLine) {
        const occ = text.split(firstLine).length - 1;
        L("Primera linea occurrences: " + occ);
        if (occ > 1) return false;
      }
      return true;
    }

    // Method 1: synthetic paste (preserve line breaks)
    clearEditor();
    await W(250);
    let dt = new DataTransfer();
    dt.setData("text/plain", raw);
    try {
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      editor.focus();
      selectEditorContents();
      editor.dispatchEvent(ev);
      L("PasteEvent enviado");
    } catch (e) {
      L("PasteEvent falló");
    }
    await W(900);
    let got = getEditorText();
    L("Texto post-paste: " + got.length + " chars");
    if (isOkText(got)) return true;

    // Method 2: insertHTML with <br> (one shot)
    clearEditor();
    await W(250);
    const html = escapeHtml(raw).replace(/\n/g, "<br>");
    try {
      editor.focus();
      selectEditorContents();
      document.execCommand("insertHTML", false, html);
      L("insertHTML ejecutado");
    } catch (e) {
      L("insertHTML falló");
    }
    await W(900);
    got = getEditorText();
    L("Texto post-insertHTML: " + got.length + " chars");
    if (isOkText(got)) return true;

    // Method 3: insertText fallback
    clearEditor();
    await W(250);
    try {
      editor.focus();
      selectEditorContents();
      document.execCommand("insertText", false, raw);
      L("insertText ejecutado (fallback)");
    } catch (e) {
      L("insertText fallback falló");
    }
    await W(900);
    got = getEditorText();
    L("Texto post-insertText: " + got.length + " chars");
    return isOkText(got);
  }

  async function validateDecodableImage(file) {
    if (!file || file.size < 1024) return false;
    try {
      const bmp = await createImageBitmap(file);
      const ok = bmp.width > 32 && bmp.height > 32;
      try { bmp.close(); } catch (_) {}
      return ok;
    } catch (e) {
      return false;
    }
  }

  function randomUploadJpgName() {
    return String(Math.floor(100000000 + Math.random() * 900000000)) + ".jpg";
  }

  /** Re-encode to a fresh JPEG File so each retry looks like a new manual pick. */
  async function blobToFreshJpegFile(blob, nameHint) {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(bitmap, 0, 0);
      const jpegBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob"))),
          "image/jpeg",
          0.88
        );
      });
      const name = /\.jpe?g$/i.test(String(nameHint || ""))
        ? String(nameHint)
        : randomUploadJpgName();
      return new File([jpegBlob], name, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } finally {
      try { if (bitmap) bitmap.close(); } catch (_) {}
    }
  }

  async function prepareFilesFromImages(imgs) {
    const files = [];
    for (const img of imgs) {
      const dataUrl = String(img?.dataUrl || "").trim();
      if (!dataUrl.startsWith("data:image/") || dataUrl.length < 120) {
        L("dataUrl invalido o vacio: " + (img?.name || "?"));
        continue;
      }
      try {
        const blob = await fetch(dataUrl).then((r) => r.blob());
        if (blob.size < 1024) {
          L("Blob demasiado pequeno, omitiendo");
          continue;
        }
        let file;
        try {
          file = await blobToFreshJpegFile(blob, img.name || randomUploadJpgName());
        } catch (reEncErr) {
          L("Re-encode JPEG falló, usando blob original: " + (reEncErr && reEncErr.message));
          file = new File([blob], img.name || randomUploadJpgName(), {
            type: blob.type || img.type || "image/jpeg",
            lastModified: Date.now(),
          });
        }
        L("Blob: " + file.name + " " + file.size + "b type=" + (file.type || "?"));
        const decodable = await validateDecodableImage(file);
        if (!decodable) {
          L("Imagen no decodificable antes de subir: " + file.name);
          continue;
        }
        files.push(file);
      } catch (e) {
        L("Error blob: " + (e && e.message ? e.message : e));
      }
    }
    return files;
  }

  const FB_UPLOAD_ERR_RE =
    /no se puede subir el archivo|can't upload|cannot upload|couldn't upload|could not upload|no se pudo subir|upload failed|failed to upload|couldn't add|could not add|no se pudo agregar|unable to upload/i;

  /** Only look inside the composer dialog — never whole document.body (stale toasts). */
  function hasFacebookMediaUploadError(root) {
    const scopes = [];
    if (root && root !== document && root !== document.body) scopes.push(root);
    for (const dlg of document.querySelectorAll("[role=dialog]")) {
      if (dlg && (!root || root.contains?.(dlg) || dlg.contains?.(root) || dlg === root)) {
        scopes.push(dlg);
      }
    }
    if (!scopes.length && root) scopes.push(root);
    for (const scope of scopes) {
      if (!scope) continue;
      const t = String(scope.innerText || scope.textContent || "");
      if (FB_UPLOAD_ERR_RE.test(t)) return true;
    }
    return false;
  }

  function visibleComposerImgs(scope, srcPart) {
    const root = scope || document;
    return Array.from(root.querySelectorAll("img[src*='" + srcPart + "']")).filter(
      (img) => img && img.offsetParent !== null && img.naturalWidth > 0
    );
  }

  function hasCdnMediaPreview(root) {
    const scope = root || document;
    return (
      visibleComposerImgs(scope, "scontent").length > 0 ||
      visibleComposerImgs(scope, "fbcdn").length > 0
    );
  }

  function hasBlobMediaPreview(root) {
    return visibleComposerImgs(root || document, "blob:").length > 0;
  }

  function previewImagesInScope(scope) {
    const root = scope || document;
    return Array.from(
      root.querySelectorAll("img[src*='blob:'], img[src*='scontent'], img[src*='fbcdn']")
    ).filter((img) => img && img.offsetParent !== null);
  }

  function waitForImageNode(img, maxMs) {
    return new Promise((resolve) => {
      if (!img) return resolve(false);
      if (img.complete && img.naturalWidth > 0) return resolve(true);
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(!!ok);
      };
      img.onload = () => finish(img.naturalWidth > 0);
      img.onerror = () => finish(false);
      setTimeout(() => finish(img.complete && img.naturalWidth > 0), maxMs);
    });
  }

  /**
   * FB often shows a local blob preview for ~1s then flips to upload error.
   * Do NOT treat early blob as success — wait for CDN or a settle window without error.
   */
  async function waitForHealthyMediaPreview(root, maxMs) {
    const t0 = Date.now();
    const SETTLE_MS = 4000;
    let blobSeenAt = 0;
    while (Date.now() - t0 < maxMs) {
      if (hasFacebookMediaUploadError(root)) {
        L("Facebook reporto error de subida de imagen");
        return false;
      }
      if (hasCdnMediaPreview(root)) {
        L("Preview CDN (scontent/fbcdn) confirmado");
        return true;
      }
      if (hasBlobMediaPreview(root)) {
        if (!blobSeenAt) {
          blobSeenAt = Date.now();
          L("Preview blob local; esperando CDN o error de FB…");
        } else if (Date.now() - blobSeenAt >= SETTLE_MS) {
          if (!hasFacebookMediaUploadError(root)) {
            L("Preview blob estable sin error tras settle");
            return true;
          }
        }
      } else if (
        root &&
        root.querySelector("[data-visualcompletion='media-vc-image']") &&
        !hasFacebookMediaUploadError(root) &&
        blobSeenAt &&
        Date.now() - blobSeenAt >= SETTLE_MS
      ) {
        L("media-vc-image estable sin error");
        return true;
      }
      await W(400);
    }
    if (hasFacebookMediaUploadError(root)) return false;
    if (hasCdnMediaPreview(root)) return true;
    if (hasBlobMediaPreview(root) && blobSeenAt && Date.now() - blobSeenAt >= SETTLE_MS) {
      return !hasFacebookMediaUploadError(root);
    }
    return false;
  }

  async function isMediaPreviewHealthy(root) {
    if (hasFacebookMediaUploadError(root)) return false;
    if (hasCdnMediaPreview(root)) return true;
    if (hasBlobMediaPreview(root)) return true;
    return !!(
      root &&
      root.querySelector("[data-visualcompletion='media-vc-image']") &&
      !hasFacebookMediaUploadError(root)
    );
  }

  async function removeComposerMediaAttachment(root) {
    const scope = root || document;
    const labels = [
      "eliminar", "remove", "quitar", "remove photo", "remove image",
      "cerrar", "close", "descartar", "discard", "try again", "reintentar", "intentar de nuevo"
    ];
    let removed = false;
    for (const btn of scope.querySelectorAll("[role=button],button,[aria-label]")) {
      if (!btn.offsetParent) continue;
      const al = String(btn.getAttribute("aria-label") || btn.title || btn.textContent || "").toLowerCase().trim();
      if (!labels.some((w) => al.includes(w))) continue;
      if (al.includes("public") || al.includes("post") || al.includes("cerrar public")) continue;
      if (al.length > 48) continue;
      try {
        btn.click();
        await W(600);
        removed = true;
        L("Clic limpieza media/error: " + al.slice(0, 40));
      } catch (_) {}
    }
    if (removed) await W(500);
    return removed;
  }

  /** @deprecated use isMediaPreviewHealthy */
  function hasMediaPreview(root) {
    const scope = root || document;
    return !!(
      scope.querySelector("img[src*='blob:']") ||
      scope.querySelector("img[src*='scontent']") ||
      scope.querySelector("img[src*='fbcdn']") ||
      scope.querySelector("[data-visualcompletion='media-vc-image']")
    );
  }

  async function waitForMediaPreview(root, maxMs) {
    return waitForHealthyMediaPreview(root, maxMs);
  }

  /** No usar el primer dialog del documento (cookies, otros modales): solo el del compositor. */
  function composerSearchRoot(editorEl) {
    if (editorEl && editorEl.closest) {
      const dlg = editorEl.closest('[role="dialog"]');
      if (dlg) return dlg;
      const main = editorEl.closest('[role="main"]');
      if (main) return main;
    }
    return document;
  }

  function findImageFileInputDeep() {
    const list = querySelectorAllDeep('input[type=file]');
    for (const inp of list) {
      try {
        const acc = (inp.getAttribute('accept') || '').toLowerCase();
        if (acc && !acc.includes('image') && !acc.includes('*')) continue;
        return inp;
      } catch (e) {}
    }
    return null;
  }

  function getInputReactOnChange(fi) {
    if (!fi) return null;
    const pk = Object.keys(fi).find((k) => k.startsWith('__reactProps'));
    if (pk) {
      const p = fi[pk];
      if (p && typeof p.onChange === 'function') return p.onChange;
    }
    const fk = Object.keys(fi).find((k) => k.startsWith('__reactFiber'));
    if (fk) {
      let fiber = fi[fk];
      for (let d = 0; d < 45 && fiber; d++) {
        const mp = fiber.memoizedProps;
        if (mp && typeof mp.onChange === 'function') return mp.onChange;
        fiber = fiber.return;
      }
    }
    return null;
  }

  function assignFilesToInput(fi, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));

    try {
      const nativeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      if (nativeDesc && nativeDesc.set) nativeDesc.set.call(fi, dt.files);
    } catch (e) {}

    try {
      Object.defineProperty(fi, "files", { value: dt.files, configurable: true, writable: true });
    } catch (e) {}

    const syntheticEvent = {
      target: fi,
      currentTarget: fi,
      nativeEvent: new Event("change", { bubbles: true }),
      bubbles: true,
      cancelable: false,
      defaultPrevented: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      persist: () => {},
      isPersistent: () => true,
    };

    const onCh = getInputReactOnChange(fi);
    if (onCh) {
      L("React onChange encontrado, invocando…");
      try {
        onCh(syntheticEvent);
      } catch (e) {
        L("onChange error: " + (e && e.message));
      }
      return true;
    }

    L("No se encontro onChange en input (props/fiber), usando events");
    fi.dispatchEvent(new Event("input", { bubbles: true }));
    fi.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function attemptImageUploadOnce(files, editorEl) {
    const root = composerSearchRoot(editorEl);

    L("Buscando boton Foto/Video...");
    const photoLabels = [
      "foto/video", "photo/video", "photo", "foto", "add photo", "agregar foto",
      "añade fotos", "añade foto", "add photos", "media", "imagen", "image"
    ];
    let photoBtn = null;
    for (const lbl of photoLabels) {
      photoBtn = root.querySelector("[aria-label*='" + lbl + "' i]");
      if (photoBtn && photoBtn.offsetParent) { L("Boton foto: " + lbl); break; }
    }
    if (!photoBtn) {
      for (const btn of root.querySelectorAll("[role=button],button")) {
        const t = (btn.getAttribute("aria-label") || btn.title || btn.textContent || "").toLowerCase();
        if ((t.includes("photo") || t.includes("foto")) && btn.offsetParent) {
          photoBtn = btn; L("Boton foto texto: " + t.slice(0, 30)); break;
        }
      }
    }
    // Prefer an already-open file input (retry after FB error) before re-clicking Photo.
    let fi = root.querySelector("input[type=file][accept*='image']")
      || root.querySelector("input[type=file]")
      || findImageFileInputDeep();

    if (!fi) {
      if (!photoBtn) { L("Boton foto no encontrado"); return false; }
      L("Clic en boton foto...");
      photoBtn.click();
      await W(1200);
      for (let wait = 0; !fi && wait < 14; wait++) {
        await W(400);
        fi = root.querySelector("input[type=file][accept*='image']")
          || root.querySelector("input[type=file]")
          || findImageFileInputDeep();
      }
    } else {
      L("input[type=file] ya presente (reintento sin reabrir foto)");
    }

    if (!fi) { L("input[type=file] no encontrado"); return false; }
    L("input[type=file] encontrado");

    assignFilesToInput(fi, files);

    // FB often fails on attempt 1 and succeeds later — wait long enough to see error OR CDN.
    if (await waitForHealthyMediaPreview(root, 20000)) {
      L("IMAGEN CARGADA correctamente");
      return true;
    }

    if (hasFacebookMediaUploadError(root)) {
      L("Facebook rechazo la imagen en este intento (igual que a mano a veces)");
    } else {
      L("No se detecto preview sano de imagen");
    }
    return false;
  }

  // Upload image(s): validate, inject FileList, detect FB upload errors, retry like manual 2nd/3rd try
  async function uploadImage(imgs, editorEl) {
    if (!imgs || !imgs.length) return false;

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        L("Reintento subida imagen " + attempt + "/" + maxAttempts + " (FB a menudo falla el 1ro)");
        const root = composerSearchRoot(editorEl);
        await removeComposerMediaAttachment(root);
        // Human-like backoff: 2s, 3s, 4s, 5s…
        await W(1000 + attempt * 1000);
      }

      const attemptFiles = await prepareFilesFromImages(imgs);
      if (!attemptFiles.length) {
        L("Ninguna imagen valida en intento " + attempt);
        continue;
      }

      const ok = await attemptImageUploadOnce(attemptFiles, editorEl);
      if (ok) return true;
      await W(800);
    }

    return false;
  }

  async function findPostBtn(maxMs) {
    const words = ["post", "publicar", "postar", "compartir", "share", "publish", "enviar"];
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await W(500);
      for (const dlg of document.querySelectorAll("[role=dialog]")) {
        for (const btn of dlg.querySelectorAll("button,[role=button]")) {
          if (!btn.offsetParent || btn.disabled || btn.getAttribute("aria-disabled") === "true") continue;
          const t = (btn.textContent || btn.getAttribute("aria-label") || "").trim().toLowerCase();
          if (words.includes(t)) { L("Boton publicar: " + t); return btn; }
        }
      }
      for (const btn of document.querySelectorAll("button,[role=button]")) {
        if (!btn.offsetParent || btn.disabled || btn.getAttribute("aria-disabled") === "true") continue;
        const t = (btn.textContent || btn.getAttribute("aria-label") || "").trim().toLowerCase();
        if (words.includes(t)) { L("Boton publicar global: " + t); return btn; }
      }
    }
    return null;
  }

  async function waitClose(el, maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await W(600);
      if (!document.body.contains(el)) { L("Dialogo cerrado"); return true; }
      if (!el.offsetParent)            { L("Editor oculto");   return true; }
      if (!(el.textContent || "").trim()) { L("Editor vacio"); return true; }
    }
    return false;
  }
  async function waitPublishSuccess(editorEl, postBtn, maxMs) {
    const t0 = Date.now();
    const successHints = [
      'post published', 'your post is now', 'shared to group', 'posted',
      'publicado', 'publicación', 'publicacion', 'se ha publicado', 'compartido'
    ];
    const errorHints = [
      'try again', 'something went wrong', 'couldn’t post', "couldn't post",
      'no se pudo', 'error al publicar'
    ];
    while (Date.now() - t0 < maxMs) {
      await W(500);
      // Primary signal: editor/dialog closes or hides.
      if (!document.body.contains(editorEl) || !editorEl.offsetParent) return { ok: true, why: 'editor-closed' };

      const body = (document.body?.innerText || '').toLowerCase();
      if (successHints.some(h => body.includes(h))) return { ok: true, why: 'success-hint' };
      if (errorHints.some(h => body.includes(h))) return { ok: false, why: 'error-hint' };

      // Secondary signal: publish button becomes unavailable after click.
      if (postBtn) {
        const gone = !document.body.contains(postBtn) || !postBtn.offsetParent;
        const disabled = postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true';
        if (gone || disabled) return { ok: true, why: 'button-gone-disabled' };
      }
    }
    return { ok: false, why: 'timeout' };
  }

  // Main flow
  try {
    await W(2500);
    L("Iniciando... imagenes=" + images.length + " texto=" + text.length + " chars");

    L("Paso 1: abriendo compositor");
    const opened = await openComposer();
    if (!opened) return { success: false, error: "No se encontro el compositor", log };
    await W(4000);

    L("Paso 2: buscando editor");
    let editor = await resolveActiveEditor(8000);
    if (!editor) return { success: false, error: "No se encontro el editor", log };

    // Upload image FIRST via photo button
    if (images && images.length > 0) {
      L("Paso 3: subiendo imagen...");
      const imgOk = await uploadImage(images, editor);
      L("Imagen: " + (imgOk ? "ok" : "fallo"));
      if (!imgOk) {
        return {
          success: false,
          error: "Facebook rechazo o no cargo la imagen (revisa el log de inyeccion)",
          log
        };
      }
      await W(2000);
      editor = await resolveActiveEditor(7000);
      if (!editor) return { success: false, error: "No se encontro editor luego de cargar imagen", log };
      editor.focus();
      await W(500);
    }

    // Type text — single pass, no retries that could duplicate content
    L("Paso 4: escribiendo texto");
    editor = await resolveActiveEditor(5000) || editor;
    L("Editor: role=" + (editor.getAttribute("role") || "") + " multiline=" + (editor.getAttribute("aria-multiline") || ""));
    await typeText(editor, textForPost);
    await W(800);

    // Safety: if Facebook/Lexical duplicated the text multiple times,
    // stop here (don't even search/click the publish button).
    try {
      const firstLine = (textForPost.split("\n")[0] || "").trim();
      const got = String(editor.innerText || editor.textContent || "");
      const gotTrim = got.trim();

      if (!gotTrim || gotTrim.length < 3) {
        L("PAUSA: texto no escrito en el editor, detenido antes de publicar");
        return {
          success: false,
          pausedBeforePublish: true,
          error: "Texto no escrito en el editor",
          log
        };
      }

      const gotCompactLen = got.replace(/\s/g, "").length;
      if (expectedCompactLen && gotCompactLen > expectedCompactLen * 1.4) {
        L("PAUSA: tamaño anormal en el editor (got=" + gotCompactLen + " exp=" + expectedCompactLen + "), detenido antes de publicar");
        return {
          success: false,
          pausedBeforePublish: true,
          error: "Duplicacion/tamano anormal en el editor",
          log
        };
      }

      if (firstLine) {
        if (!got.includes(firstLine)) {
          L("PAUSA: texto no coincide (primera linea no encontrada), detenido antes de publicar");
          return {
            success: false,
            pausedBeforePublish: true,
            error: "Texto no coincide en el editor (primera linea)",
            log
          };
        }
        const occ = got.split(firstLine).length - 1;
        if (occ > 1) {
          L("PAUSA: duplicacion detectada en el editor (occ=" + occ + "), detenido antes de publicar");
          return {
            success: false,
            pausedBeforePublish: true,
            error: "Duplicacion detectada en el editor (occ=" + occ + ")",
            log
          };
        }
      }
    } catch (e) {}

    L("Paso 5: buscando Publicar");
    const postBtn = await findPostBtn(8000);
    if (!postBtn) return { success: false, error: "No se encontro boton Publicar", log };

    if (pauseBeforePublishEffective) {
      L("PAUSA DE SEGURIDAD: listo para publicar, detenido antes del click");
      // Hard block any publish click that might be triggered elsewhere.
      try {
        postBtn.addEventListener('click', (e) => {
          try { e.preventDefault(); } catch (err) {}
          try { e.stopImmediatePropagation(); } catch (err) {}
          try { e.stopPropagation(); } catch (err) {}
          L("Bloqueado click en Publicar (safety)");
        }, true);
      } catch (e) {}
      return { success: false, pausedBeforePublish: true, error: "Pausa de seguridad antes de publicar", log };
    }

    L("Paso 6: publicando...");
    postBtn.click();

    const firstTry = await waitPublishSuccess(editor, postBtn, 16000);
    if (!firstTry.ok) {
      postBtn.click();
      const secondTry = await waitPublishSuccess(editor, postBtn, 8000);
      if (!secondTry.ok) return { success: false, error: "Post incierto", log };
    }

    L("Post publicado!");
    return { success: true, log };

  } catch(e) {
    L("ERROR: " + e.message);
    return { success: false, error: e.message, log };
  }
}

// --- LAN bridge (MatchMaker / otros → cola → pestaña Mensaje) ---
const IRISHKA_BRIDGE_CFG_KEY = 'irishkaBridgeConfig';
const IRISHKA_BRIDGE_PENDING_KEY = 'irishkaBridgePendingCompose';

function decodeBridgeUtf8Base64Maybe(input) {
  const s = String(input || '').trim();
  if (!s || !/^[A-Za-z0-9+/=_-]+$/.test(s) || s.length < 16) return '';
  try {
    const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    const raw = atob(padded);
    const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
    const out = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    return out;
  } catch {
    return '';
  }
}

function normalizeBridgeText(raw) {
  const text = String(raw || '');
  const trimmed = text.trim();
  if (!trimmed) return '';
  const b64Decoded = decodeBridgeUtf8Base64Maybe(trimmed);
  if (b64Decoded) return b64Decoded;
  if (/%[0-9a-fA-F]{2}/.test(trimmed)) {
    try {
      return decodeURIComponent(trimmed.replace(/\+/g, '%20')).trim();
    } catch {}
  }
  return trimmed;
}

function parseBridgeEnvelope(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  let base64Payload = '';
  if (txt.startsWith('MM_PAYLOAD::')) {
    base64Payload = txt.slice('MM_PAYLOAD::'.length).trim();
  } else if (txt.startsWith('MM_POST::')) {
    base64Payload = txt.slice('MM_POST::'.length).trim();
  } else if (txt.startsWith('{') && txt.endsWith('}')) {
    try { return JSON.parse(txt); } catch { return null; }
  }
  if (!base64Payload) return null;
  const jsonText = decodeBridgeUtf8Base64Maybe(base64Payload);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function dataUrlFromBridgeImage(raw, mimeHint, nameHint) {
  if (raw == null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const val = String(raw).trim();
  if (!val) return null;
  if (val.startsWith('data:image/')) {
    return { dataUrl: val, name: String(nameHint || 'bridge-image.jpg'), type: String(mimeHint || '') || 'image/jpeg' };
  }
  const cleaned = val.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(cleaned)) return null;
  const mime = String(mimeHint || 'image/jpeg').trim() || 'image/jpeg';
  return {
    dataUrl: `data:${mime};base64,${cleaned}`,
    name: String(nameHint || 'bridge-image.jpg'),
    type: mime
  };
}

function normalizeBridgeComposePayload(data) {
  const envFromString = typeof data === 'string' ? parseBridgeEnvelope(data) : null;
  const baseObj = (envFromString && typeof envFromString === 'object') ? envFromString : data;
  if (!baseObj || typeof baseObj !== 'object') return { text: '', images: [] };
  const envInText = parseBridgeEnvelope(
    baseObj.text ?? baseObj.message ?? baseObj.caption ?? baseObj.postText ?? baseObj.body ?? ''
  );
  const dataObj = (envInText && typeof envInText === 'object') ? envInText : baseObj;
  const text = normalizeBridgeText(
    dataObj.text ?? dataObj.message ?? dataObj.caption ?? dataObj.postText ?? dataObj.body ?? ''
  );
  const bucket = [];
  if (Array.isArray(dataObj.images)) bucket.push(...dataObj.images);
  if (Array.isArray(dataObj.imageList)) bucket.push(...dataObj.imageList);
  if (dataObj.image != null) bucket.push(dataObj.image);
  if (dataObj.imageDataUrl != null) bucket.push(dataObj.imageDataUrl);
  if (dataObj.imageData != null) bucket.push(dataObj.imageData);
  if (dataObj.imageBase64 != null) bucket.push(dataObj.imageBase64);
  if (dataObj.image_data != null) bucket.push(dataObj.image_data);
  const images = bucket
    .map((img, i) => {
      if (img && typeof img === 'object') {
        return dataUrlFromBridgeImage(
          img.dataUrl ?? img.base64 ?? img.imageBase64 ?? img.data ?? '',
          img.type ?? img.mimeType ?? dataObj.imageMimeType ?? dataObj.imageType,
          img.name || `bridge-image-${i + 1}.jpg`
        );
      }
      return dataUrlFromBridgeImage(img, dataObj.imageMimeType ?? dataObj.imageType, `bridge-image-${i + 1}.jpg`);
    })
    .filter(Boolean)
    .slice(0, 3);
  const mode = String(dataObj.mode || '').trim();
  const postId = String(dataObj.postId || dataObj.id || '').trim();
  return { text, images, mode, postId };
}

async function pollIrishkaBridgeOnce() {
  if (!isCommunityFreeBuildBg()) return;
  const d = await chrome.storage.local.get([IRISHKA_BRIDGE_CFG_KEY]);
  const cfg = d[IRISHKA_BRIDGE_CFG_KEY];
  if (!cfg || !cfg.enabled) return;
  const base = String(cfg.baseUrl || '')
    .trim()
    .replace(/\/$/, '');
  const dev = String(cfg.deviceId || '').trim();
  if (!base || !dev) return;
  const q = encodeURIComponent(dev);
  const url = `${base}/poll?deviceId=${q}`;
  const headers = {};
  const sec = String(cfg.sharedSecret || '').trim();
  if (sec) headers.Authorization = `Bearer ${sec}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
  } catch {
    return;
  }
  if (res.status === 204) return;
  if (!res.ok) return;
  let data;
  try {
    data = await res.json();
  } catch {
    return;
  }
  const compose = normalizeBridgeComposePayload(data);
  if (!compose.text && !compose.images.length) return;
  await chrome.storage.local.set({
    [IRISHKA_BRIDGE_PENDING_KEY]: { ...compose, receivedAt: Date.now() },
  });
  broadcastToApp({ action: 'bridgeIncomingCompose', ...compose });
  try {
    const appUrl = chrome.runtime.getURL('app.html');
    const tabs = await chrome.tabs.query({ url: appUrl });
    if (tabs[0]?.id) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId != null) {
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    }
  } catch {}
}

async function scheduleIrishkaBridgeAlarm() {
  await chrome.alarms.clear('irishka_bridge_poll');
  if (!isCommunityFreeBuildBg()) return;
  const d = await chrome.storage.local.get([IRISHKA_BRIDGE_CFG_KEY]);
  const cfg = d[IRISHKA_BRIDGE_CFG_KEY];
  if (!cfg || !cfg.enabled) return;
  const base = String(cfg.baseUrl || '').trim();
  const dev = String(cfg.deviceId || '').trim();
  if (!base || !dev) return;
  chrome.alarms.create('irishka_bridge_poll', { periodInMinutes: 1 });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[IRISHKA_BRIDGE_CFG_KEY]) return;
  scheduleIrishkaBridgeAlarm().catch(() => {});
});

scheduleIrishkaBridgeAlarm().catch(() => {});
