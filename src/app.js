'use strict';

/** Replace {placeholders} in i18n strings. */
function tfmt(key, vars) {
  let s = typeof t === 'function' ? t(key) : key;
  if (!vars) return s;
  for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
}

let groups = [];
let images = [];
let isRunning = false;
let cdInterval = null;
let timerUnit = 'min';
let spPreviewOpen = false;
let checkTimer = null;
let sessionLog = [];
let activePostingGroupUrls = null;
let lastGroupStatusRenderAt = 0;
let waitCountdownSec = 0;
let isProLicenseValid = false;

const HISTORY_KEY = 'fartmily_post_history';
const HISTORY_MAX = 5;
const GROUP_SET_KEY = 'fbGroupSelectionSets';
const TEXT_PRESET_KEY = 'fbTextPresets';
const LICENSE_KEY = 'proLicenseKey';
const LICENSE_STATUS_KEY = 'proLicenseStatus';
const LICENSE_ENDPOINT_KEY = 'licenseValidateUrl';
const INSTALL_ID_KEY = 'installDeviceId';
const DEFAULT_LICENSE_VALIDATE_URL = '';
const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/5kQ6oI4IhcjkeGR8aX4F200';

// Init
document.addEventListener('DOMContentLoaded', () => {
  buildLangBar();
  initLang();
  bindAll();
  loadGroups();
  updateTimerUI();
  checkFB();
  checkTimer = setInterval(checkFB, 6000);
  loadHistory();
  loadGroupSets();
  loadTextPresets();
  loadSavedLicense();

  chrome.storage.local.get(['posterRunning', 'posterConfig', 'posterResults'], d => {
    if (d.posterRunning && d.posterConfig) {
      setRunning(true);
      initSteps(d.posterConfig.groups);
      if (d.posterResults?.length) updateProgress(d.posterResults, d.posterConfig.groups.length, 0);
    }
  });
});

// Bind all event listeners
function bindAll() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => goTab(t.dataset.tab))
  );

  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => insertEmoji(btn.dataset.emoji));
  });

  document.getElementById('imgUploadArea').addEventListener('click', () => {
    document.getElementById('imgInput').click();
  });
  document.getElementById('imgInput').addEventListener('change', handleImages);

  document.getElementById('editor').addEventListener('input', () => {
    updateCC();
    if (spPreviewOpen) refreshSpPreview();
  });

  document.getElementById('spInsert').addEventListener('click', spInsertTemplate);
  document.getElementById('spPreview').addEventListener('click', toggleSpPreview);
  document.getElementById('spRespin').addEventListener('click', refreshSpPreview);

  document.getElementById('btnOpenFb').addEventListener('click', openFacebook);
  document.getElementById('btnScan').addEventListener('click', scanGroups);
  document.getElementById('btnVerifyGroups').addEventListener('click', verifyGroupsPostability);
  document.getElementById('btnLeaveUnpostable').addEventListener('click', () => requireProLicense(leaveUnpostableGroups));
  document.getElementById('btnCheckModeration').addEventListener('click', () => requireProLicense(checkModerationForAllGroups));
  document.getElementById('btnDeletePendingPosts').addEventListener('click', () => requireProLicense(deletePendingPostsFromGroups));
  document.getElementById('btnSelectAll').addEventListener('click', selectAll);
  document.getElementById('btnDeselectAll').addEventListener('click', deselectAll);
  document.getElementById('btnClearAll').addEventListener('click', clearAll);
  document.getElementById('btnAddGroup').addEventListener('click', addGroup);
  document.getElementById('groupUrl').addEventListener('keydown', e => { if (e.key === 'Enter') addGroup(); });
  document.getElementById('btnSaveGroupSet').addEventListener('click', saveCurrentGroupSet);
  document.getElementById('btnLoadGroupSet').addEventListener('click', loadSelectedGroupSet);
  document.getElementById('btnDeleteGroupSet').addEventListener('click', deleteSelectedGroupSet);
  document.getElementById('btnSaveTextPreset').addEventListener('click', saveCurrentTextPreset);
  document.getElementById('btnLoadTextPreset').addEventListener('click', loadSelectedTextPreset);
  document.getElementById('btnDeleteTextPreset').addEventListener('click', deleteSelectedTextPreset);

  document.getElementById('timerEnabled').addEventListener('change', updateTimerUI);
  document.getElementById('timerSec').addEventListener('input', updateTimerUI);
  document.getElementById('timerVar').addEventListener('input', updateTimerUI);
  document.getElementById('unitSec').addEventListener('click', () => setTimerUnit('sec'));
  document.getElementById('unitMin').addEventListener('click', () => setTimerUnit('min'));
  document.getElementById('dailyLimitEnabled').addEventListener('change', updateTimerUI);

  document.getElementById('btnReset').addEventListener('click', resetAll);
  document.getElementById('btnStart').addEventListener('click', startPosting);
  document.getElementById('btnStop').addEventListener('click', stopPosting);
  const upgradeBtn = document.getElementById('btnUpgrade');
  if (upgradeBtn) upgradeBtn.addEventListener('click', openUpgradeCheckout);
  const checkoutBtn = document.getElementById('btnOpenCheckoutLicense');
  if (checkoutBtn) checkoutBtn.addEventListener('click', openUpgradeCheckout);
  const saveLicenseBtn = document.getElementById('btnSaveLicense');
  if (saveLicenseBtn) saveLicenseBtn.addEventListener('click', saveLicenseKey);
  const validateLicenseBtn = document.getElementById('btnValidateLicense');
  if (validateLicenseBtn) validateLicenseBtn.addEventListener('click', validateLicenseOnline);
  const saveEndpointBtn = document.getElementById('btnSaveEndpoint');
  if (saveEndpointBtn) saveEndpointBtn.addEventListener('click', saveLicenseEndpoint);

  document.getElementById('btnCopyLog').addEventListener('click', copyLog);
  document.getElementById('btnClearHistory').addEventListener('click', clearHistory);
}

function goTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

function openUpgradeCheckout() {
  if (!STRIPE_CHECKOUT_URL) return;
  chrome.tabs.create({ url: STRIPE_CHECKOUT_URL, active: true });
}

function refreshPremiumButtons() {
  const btnIds = ['btnCheckModeration', 'btnDeletePendingPosts', 'btnLeaveUnpostable'];
  btnIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const locked = !isProLicenseValid;
    el.disabled = locked;
    el.style.opacity = locked ? '0.65' : '';
    el.style.cursor = locked ? 'not-allowed' : '';
    el.title = locked ? t('premium_locked_tooltip') : '';
  });
}

function refreshUpgradeCtas() {
  const headerBtn = document.getElementById('btnUpgrade');
  const licenseBtn = document.getElementById('btnOpenCheckoutLicense');

  if (headerBtn) {
    headerBtn.textContent = t('btn_go_pro_unlimited');
    headerBtn.style.display = isProLicenseValid ? 'none' : '';
  }

  if (licenseBtn) {
    if (isProLicenseValid) {
      licenseBtn.textContent = t('pro_active_label');
      licenseBtn.disabled = true;
      licenseBtn.style.opacity = '0.65';
      licenseBtn.style.cursor = 'not-allowed';
    } else {
      licenseBtn.textContent = t('btn_go_pro_unlimited');
      licenseBtn.disabled = false;
      licenseBtn.style.opacity = '';
      licenseBtn.style.cursor = '';
    }
  }
}

function requireProLicense(fn) {
  if (isProLicenseValid) return fn();
  alert(t('premium_locked_msg'));
  goTab('license');
}

function refreshMonetizationUI() {
  const badge = document.getElementById('planLimitBadge');
  const dailyToggle = document.getElementById('dailyLimitEnabled');
  const dailyLimitInput = document.getElementById('dailySuccessLimit');
  const dailyResumeInput = document.getElementById('dailyResumeTime');
  if (!dailyToggle || !dailyLimitInput) return;

  if (isProLicenseValid) {
    dailyToggle.checked = false;
    dailyToggle.disabled = true;
    dailyLimitInput.value = '0';
    dailyLimitInput.disabled = true;
    if (dailyResumeInput) dailyResumeInput.disabled = true;
    if (badge) badge.textContent = t('plan_badge_pro');
  } else {
    dailyToggle.checked = true;
    dailyToggle.disabled = true;
    dailyLimitInput.value = '3';
    dailyLimitInput.disabled = true;
    if (dailyResumeInput) dailyResumeInput.disabled = false;
    if (badge) badge.textContent = t('plan_badge_free');
  }
  updateTimerUI();
}

function readLicenseStatus() {
  return new Promise((resolve) => {
    chrome.storage.local.get([LICENSE_STATUS_KEY], (data) => {
      const valid = Boolean(data?.[LICENSE_STATUS_KEY]?.valid === true);
      isProLicenseValid = valid;
      refreshPremiumButtons();
      refreshMonetizationUI();
      refreshUpgradeCtas();
      resolve(valid);
    });
  });
}

function normalizeLicense(input) {
  return String(input || '').trim();
}

function normalizeEndpoint(input) {
  return String(input || '').trim();
}

function makeInstallId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getOrCreateInstallId() {
  return new Promise((resolve) => {
    chrome.storage.local.get([INSTALL_ID_KEY], (data) => {
      const existing = String(data?.[INSTALL_ID_KEY] || '').trim();
      if (existing) return resolve(existing);
      const next = makeInstallId();
      chrome.storage.local.set({ [INSTALL_ID_KEY]: next }, () => resolve(next));
    });
  });
}

function updateLicenseStatusBox(msg) {
  const box = document.getElementById('licenseStatusBox');
  if (box) box.textContent = msg;
}

function getLicenseValidateUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get([LICENSE_ENDPOINT_KEY], (data) => {
      const url = normalizeEndpoint(data?.[LICENSE_ENDPOINT_KEY] || DEFAULT_LICENSE_VALIDATE_URL);
      resolve(url);
    });
  });
}

function formatCheckedAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  } catch {
    return '';
  }
}

function renderSavedLicenseStatus(key, statusObj) {
  isProLicenseValid = Boolean(statusObj && statusObj.valid === true);
  refreshPremiumButtons();
  refreshMonetizationUI();
  refreshUpgradeCtas();
  if (!key) {
    updateLicenseStatusBox(t('license_status_empty'));
    return;
  }
  if (!statusObj || typeof statusObj !== 'object') {
    updateLicenseStatusBox(tfmt('license_status_saved', { key }));
    return;
  }
  const checkedAt = formatCheckedAt(statusObj.checkedAt);
  if (statusObj.valid === true) {
    const plan = statusObj.plan || 'PRO';
    updateLicenseStatusBox(tfmt('license_status_valid', { plan, checkedAt }));
    return;
  }
  if (statusObj.valid === false) {
    const reason = statusObj.message || t('license_invalid_reason_default');
    updateLicenseStatusBox(tfmt('license_status_invalid', { reason, checkedAt }));
    return;
  }
  updateLicenseStatusBox(tfmt('license_status_saved', { key }));
}

function loadSavedLicense() {
  chrome.storage.local.get([LICENSE_KEY, LICENSE_STATUS_KEY, LICENSE_ENDPOINT_KEY], (data) => {
    const key = normalizeLicense(data[LICENSE_KEY] || '');
    const endpoint = normalizeEndpoint(data[LICENSE_ENDPOINT_KEY] || DEFAULT_LICENSE_VALIDATE_URL);
    const input = document.getElementById('licenseKeyInput');
    if (input && key) input.value = key;
    const endpointInput = document.getElementById('licenseEndpointInput');
    if (endpointInput && endpoint) endpointInput.value = endpoint;
    renderSavedLicenseStatus(key, data[LICENSE_STATUS_KEY]);
  });
}

function saveLicenseKey() {
  const input = document.getElementById('licenseKeyInput');
  const key = normalizeLicense(input?.value);
  if (!key) {
    alert(t('license_enter_key'));
    return;
  }
  chrome.storage.local.set({ [LICENSE_KEY]: key, [LICENSE_STATUS_KEY]: null }, () => {
    isProLicenseValid = false;
    refreshPremiumButtons();
    refreshMonetizationUI();
    refreshUpgradeCtas();
    updateLicenseStatusBox(tfmt('license_status_saved', { key }));
  });
}

function saveLicenseEndpoint() {
  const input = document.getElementById('licenseEndpointInput');
  const endpoint = normalizeEndpoint(input?.value);
  if (!endpoint) {
    alert(t('license_endpoint_required'));
    return;
  }
  try {
    const u = new URL(endpoint);
    if (!/^https?:$/.test(u.protocol)) throw new Error('Invalid protocol');
  } catch {
    alert(t('license_endpoint_invalid'));
    return;
  }
  chrome.storage.local.set({ [LICENSE_ENDPOINT_KEY]: endpoint }, () => {
    updateLicenseStatusBox(tfmt('license_endpoint_saved', { endpoint }));
  });
}

async function validateLicenseOnline() {
  const input = document.getElementById('licenseKeyInput');
  const key = normalizeLicense(input?.value);
  if (!key) {
    alert(t('license_enter_key'));
    return;
  }
  const validateUrl = await getLicenseValidateUrl();
  if (!validateUrl) {
    updateLicenseStatusBox(t('license_no_endpoint'));
    return;
  }
  updateLicenseStatusBox(t('license_validating'));
  try {
    const deviceId = await getOrCreateInstallId();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(validateUrl, {
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
    clearTimeout(timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json().catch(() => ({}));
    const valid = Boolean(data.valid ?? data.ok ?? data.active);
    const status = {
      valid,
      checkedAt: new Date().toISOString(),
      plan: data.plan || data.tier || '',
      message: data.message || ''
    };
    chrome.storage.local.set({ [LICENSE_KEY]: key, [LICENSE_STATUS_KEY]: status }, () => {
      renderSavedLicenseStatus(key, status);
    });
  } catch (err) {
    chrome.storage.local.set({
      [LICENSE_KEY]: key,
      [LICENSE_STATUS_KEY]: {
        valid: false,
        checkedAt: new Date().toISOString(),
        plan: '',
        message: String(err?.message || 'Network error')
      }
    }, () => {
      const reason = String(err?.message || 'Network error');
      updateLicenseStatusBox(tfmt('license_status_invalid', { reason, checkedAt: formatCheckedAt(new Date().toISOString()) }));
    });
  }
}

// Facebook connection check
async function checkFB() {
  setPill('checking', t('verifying'));
  const tabs = await qTabs(['*://www.facebook.com/*', '*://web.facebook.com/*']);
  if (!tabs.length) { setPill('offline', t('no_connection')); showConnected(false); return; }

  const tab = tabs[0];
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: detectFBLogin });
    const loginInfo = res?.[0]?.result;
    if (loginInfo && loginInfo.loggedIn) {
      const name = loginInfo.name || 'Facebook user';
      setPill('online', t('online_label'));
      document.getElementById('fbUserName').textContent = t('connection_active');
      document.getElementById('fbUserSub').textContent = t('connection_verified');
      const avatar = document.querySelector('.fb-user-avatar');
      if (avatar) avatar.textContent = '✅';
      document.title = 'Irishka Group Master by SBS - ' + name;
      showConnected(true);
    } else {
      setPill('offline', t('no_connection'));
      showConnected(false);
    }
  } catch (err) {
    setPill('offline', t('no_connection'));
    showConnected(false);
  }
}

function detectFBLogin() {
  try {
    if (document.querySelector('#email, input[name="email"], [data-testid="royal_email"]')) {
      return { loggedIn: false, reason: 'Formulario de login visible' };
    }
    if (window.location.pathname.startsWith('/login')) {
      return { loggedIn: false, reason: 'Pagina de login' };
    }
    function cleanText(t) {
      return t && t.trim().length > 1 && t.trim().length < 60
        && !t.includes('Facebook') && !/^\d/.test(t.trim())
        && !t.includes('·') && !t.toLowerCase().includes('search')
        && !t.toLowerCase().includes('buscar');
    }
    const profileSels = [
      'a[href*="/me"] span', 'a[aria-label*="perfil"] span',
      'a[aria-label*="profile"] span', '[data-testid="blue_bar_profile_link"] span'
    ];
    for (const sel of profileSels) {
      const el = document.querySelector(sel);
      if (el && cleanText(el.textContent)) return { loggedIn: true, name: el.textContent.trim() };
    }
    const nav = document.querySelector('[role="banner"], [data-pagelet="NavBar"], header');
    if (nav) {
      for (const s of nav.querySelectorAll('span')) {
        const t = s.textContent?.trim();
        if (cleanText(t) && t.split(' ').length >= 1 && t.split(' ').length <= 5) {
          return { loggedIn: true, name: t };
        }
      }
    }
    const hasMain = document.querySelector('[role="main"], [data-pagelet="GroupFeed"], [data-pagelet="Feed"]');
    if (hasMain) return { loggedIn: true, name: null };
    if (document.cookie.includes('c_user=')) return { loggedIn: true, name: null };
    return { loggedIn: false, reason: 'Sin sesion detectada' };
  } catch (e) {
    return { loggedIn: false, reason: e.message };
  }
}

function extractGroupLinks() {
  const results = [];
  const seen = new Set();
  const EXCLUDED = new Set([
    'feed', 'discover', 'create', 'search', 'joins', 'highlights',
    'videos', 'photos', 'members', 'events', 'files', 'store',
    'about', 'rooms', 'bookmark', 'notifications', 'invite'
  ]);
  document.querySelectorAll('a[href*="/groups/"]').forEach(link => {
    const href = link.href || '';
    const m = href.match(/facebook\.com\/groups\/([^/?&#\s]+)/i);
    if (!m) return;
    const id = m[1];
    if (EXCLUDED.has(id.toLowerCase()) || /^\d{0,3}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    let name = '';
    link.querySelectorAll('span').forEach(s => {
      const t = s.textContent?.trim();
      if (!name && t && t.length > 2 && t.length < 80 && !t.match(/^\d+[KkMm]?$/) && !t.includes('·')) name = t;
    });
    if (!name) name = link.getAttribute('aria-label') || link.textContent?.trim() || '';
    if (!name || name.length < 2) name = id.replace(/[-_]/g, ' ');
    results.push({ url: 'https://www.facebook.com/groups/' + id, name: name.substring(0, 80).trim() });
  });
  return results;
}

function openFacebook() {
  chrome.tabs.create({ url: 'https://www.facebook.com/', active: true }, () => {
    setPill('checking', 'Abriendo...');
    setTimeout(checkFB, 4000);
  });
}

async function scanGroups() {
  const btn = document.getElementById('btnScan');
  const icon = document.getElementById('scanIcon');
  const txt = document.getElementById('scanTxt');
  const logEl = document.getElementById('scanLog');
  let scanTab = null;

  btn.disabled = true;
  icon.textContent = '⏳';
  txt.textContent = t('scanning');
  setLog(logEl, 'inf', t('searching_fb_tab'));

  try {
    const tabs = await qTabs(['*://www.facebook.com/*', '*://web.facebook.com/*']);
    if (!tabs.length) { setLog(logEl, 'err', t('open_fb_first')); resetScanBtn(btn, icon, txt); return; }

    const fbTab = tabs[0];
    setLog(logEl, 'inf', t('opening_groups_page'));

    // Open a dedicated background tab for scanning (so we don't hijack user's tab).
    const isWeb = (fbTab.url || '').includes('web.facebook.com');
    const targetUrl = isWeb
      ? 'https://web.facebook.com/groups/joins/?nav_source=tab'
      : 'https://www.facebook.com/groups/joins/?nav_source=tab';
    scanTab = await createTabAndWait(targetUrl, true);

    await sleep(3000);
    setLog(logEl, 'inf', t('reading_all_groups'));
    await chrome.scripting.executeScript({
      target: { tabId: scanTab.id },
      func: () => {
        const id = 'igs-scan-timer';
        let box = document.getElementById(id);
        if (!box) {
          box = document.createElement('div');
          box.id = id;
          box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:rgba(8,11,19,.92);color:#dde3f0;border:1px solid rgba(59,130,246,.45);border-radius:10px;padding:10px 12px;min-width:180px;font:12px Inter,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)';
          box.innerHTML = '<div style=\"font-weight:700;color:#60a5fa\">Scanning groups...</div><div id=\"igs-scan-groups\" style=\"margin-top:4px\">Detected: 0</div><div id=\"igs-scan-left\" style=\"margin-top:2px;color:#9fb0d6\">Time left: --</div>';
          document.body.appendChild(box);
        }
      }
    });

    const foundMap = new Map();
    let noGrowth = 0;
    // Iterar más para capturar la lista completa (la carga es incremental/infinita).
    for (let i = 0; i < 120; i++) {
      const res = await chrome.scripting.executeScript({ target: { tabId: scanTab.id }, func: extractGroupLinks });
      const pageFound = res?.[0]?.result || [];
      const prevCount = foundMap.size;
      pageFound.forEach(g => foundMap.set(g.url, g));
      const growth = foundMap.size - prevCount;
      setLog(logEl, 'inf', foundMap.size + ' ' + t('groups_detected'));
      const remainingSec = Math.max(0, (120 - i - 1) * 3);
      await chrome.scripting.executeScript({
        target: { tabId: scanTab.id },
        args: [foundMap.size, remainingSec],
        func: (detected, leftSec) => {
          const g = document.getElementById('igs-scan-groups');
          const l = document.getElementById('igs-scan-left');
          if (g) g.textContent = 'Detected: ' + detected;
          if (l) l.textContent = 'Time left: ' + leftSec + 's';
        }
      });
      if (growth === 0) noGrowth++;
      else noGrowth = 0;
      if (noGrowth >= 10) break;
      // Scroll agresivo hacia el final del documento para forzar carga de más elementos.
      await chrome.scripting.executeScript({
        target: { tabId: scanTab.id },
        func: () => {
          const y = Math.max(0, document.body.scrollHeight || document.documentElement.scrollHeight || 0);
          window.scrollTo(0, y);
        }
      });
      await sleep(2500);
    }
    const found = Array.from(foundMap.values());
    await chrome.scripting.executeScript({
      target: { tabId: scanTab.id },
      func: () => { const b = document.getElementById('igs-scan-timer'); if (b) b.remove(); }
    });
    try { chrome.tabs.remove(scanTab.id); } catch (e) {}

    let added = 0;
    found.forEach(g => {
      if (!groups.find(e => e.url === g.url)) { groups.push({ ...g, selected: true, canPost: null, postabilityCheckedAt: null, pendingPostsCount: 0 }); added++; }
    });

    saveGroups();
    renderGroups();

    if (!found.length) {
      setLog(logEl, 'err', t('no_results_scan'));
    } else {
      setLog(logEl, 'ok', found.length + ' ' + t('groups_total') + ' · ' + added + ' ' + t('groups_added'));
    }
  } catch (e) {
    setLog(logEl, 'err', t('error_label') + ': ' + (e.message || t('unknown')));
    try {
      if (scanTab?.id) {
        await chrome.scripting.executeScript({
          target: { tabId: scanTab.id },
          func: () => { const b = document.getElementById('igs-scan-timer'); if (b) b.remove(); }
        });
      }
    } catch (_) {}
  }
  resetScanBtn(btn, icon, txt);
}

function resetScanBtn(btn, icon, txt) {
  btn.disabled = false;
  icon.textContent = '🔍';
  txt.textContent = t('btn_scan');
}
function setLog(el, cls, msg) { el.className = 'scan-log ' + cls; el.textContent = msg; }

// Groups CRUD
function loadGroups() {
  chrome.storage.local.get('fbGroups', d => {
    groups = (d.fbGroups || []).map(g => ({
      ...g,
      canPost: typeof g.canPost === 'boolean' ? g.canPost : null,
      postabilityCheckedAt: g.postabilityCheckedAt || null,
      postStatus: g.postStatus || null, // 'ok'|'err'|'pending'
      postError: g.postError || '',
      pendingPostsCount: Number.isFinite(g.pendingPostsCount) ? g.pendingPostsCount : 0,
      moderationStats: g.moderationStats || { pending: 0, approved: 0, rejected: 0, deleted: 0 }
    }));
    renderGroups();
  });
}
function saveGroups() { chrome.storage.local.set({ fbGroups: groups }); }
function loadGroupSets() {
  chrome.storage.local.get(GROUP_SET_KEY, d => renderGroupSets(d[GROUP_SET_KEY] || []));
}
function renderGroupSets(setsArg) {
  const select = document.getElementById('groupSetSelect');
  if (!select) return;
  const sets = Array.isArray(setsArg) ? setsArg : [];
  select.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = typeof t === 'function' ? t('group_sets_ph') : 'Saved lists';
  select.appendChild(opt0);
  sets.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name + ' (' + (s.urls?.length || 0) + ')';
    select.appendChild(opt);
  });
}
function saveCurrentGroupSet() {
  const inp = document.getElementById('groupSetName');
  const name = (inp?.value || '').trim();
  if (!name) { alert('Escribe un nombre para la lista.'); return; }
  const urls = groups.filter(g => g.selected).map(g => g.url);
  if (!urls.length) { alert('Select at least one group to save the list.'); return; }
  chrome.storage.local.get(GROUP_SET_KEY, d => {
    const sets = d[GROUP_SET_KEY] || [];
    const next = sets.filter(s => s.name !== name);
    next.unshift({ name, urls, updatedAt: Date.now() });
    chrome.storage.local.set({ [GROUP_SET_KEY]: next }, () => {
      renderGroupSets(next);
      if (inp) inp.value = '';
    });
  });
}
function loadSelectedGroupSet() {
  const select = document.getElementById('groupSetSelect');
  const name = select?.value;
  if (!name) return;
  chrome.storage.local.get(GROUP_SET_KEY, d => {
    const sets = d[GROUP_SET_KEY] || [];
    const set = sets.find(s => s.name === name);
    if (!set) return;
    const wanted = new Set(set.urls || []);
    groups.forEach(g => { g.selected = wanted.has(g.url); });
    saveGroups();
    renderGroups();
  });
}
function deleteSelectedGroupSet() {
  const select = document.getElementById('groupSetSelect');
  const name = select?.value;
  if (!name) return;
  if (!confirm('Delete saved list "' + name + '"?')) return;
  chrome.storage.local.get(GROUP_SET_KEY, d => {
    const sets = d[GROUP_SET_KEY] || [];
    const next = sets.filter(s => s.name !== name);
    chrome.storage.local.set({ [GROUP_SET_KEY]: next }, () => renderGroupSets(next));
  });
}

function loadTextPresets() {
  chrome.storage.local.get(TEXT_PRESET_KEY, d => renderTextPresets(d[TEXT_PRESET_KEY] || []));
}

function renderTextPresets(presetsArg) {
  const select = document.getElementById('textPresetSelect');
  if (!select) return;
  const presets = Array.isArray(presetsArg) ? presetsArg : [];
  select.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = typeof t === 'function' ? t('text_presets_ph') : 'Saved texts';
  select.appendChild(opt0);
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

function saveCurrentTextPreset() {
  const nameInp = document.getElementById('textPresetName');
  const name = (nameInp?.value || '').trim();
  const text = document.getElementById('editor').value || '';
  if (!name) { alert('Escribe un nombre para guardar el texto.'); return; }
  if (!text.trim()) { alert('No text to save.'); return; }
  chrome.storage.local.get(TEXT_PRESET_KEY, d => {
    const presets = d[TEXT_PRESET_KEY] || [];
    const next = presets.filter(p => p.name !== name);
    next.unshift({ name, text, updatedAt: Date.now() });
    chrome.storage.local.set({ [TEXT_PRESET_KEY]: next }, () => {
      renderTextPresets(next);
      if (nameInp) nameInp.value = '';
    });
  });
}

function loadSelectedTextPreset() {
  const select = document.getElementById('textPresetSelect');
  const name = select?.value;
  if (!name) return;
  chrome.storage.local.get(TEXT_PRESET_KEY, d => {
    const presets = d[TEXT_PRESET_KEY] || [];
    const preset = presets.find(p => p.name === name);
    if (!preset) return;
    document.getElementById('editor').value = preset.text || '';
    updateCC();
    goTab('compose');
  });
}
function deleteSelectedTextPreset() {
  const select = document.getElementById('textPresetSelect');
  const name = select?.value;
  if (!name) return;
  if (!confirm('Delete saved text "' + name + '"?')) return;
  chrome.storage.local.get(TEXT_PRESET_KEY, d => {
    const presets = d[TEXT_PRESET_KEY] || [];
    const next = presets.filter(p => p.name !== name);
    chrome.storage.local.set({ [TEXT_PRESET_KEY]: next }, () => renderTextPresets(next));
  });
}

async function leaveUnpostableGroups() {
  const btn = document.getElementById('btnLeaveUnpostable');
  const logEl = document.getElementById('scanLog');
  const targets = groups.filter(g => g.canPost === false);
  if (!targets.length) { setLog(logEl, 'inf', t('log_leave_none')); return; }
  if (!confirm(tfmt('log_leave_confirm', { total: targets.length }))) return;
  btn.disabled = true;
  try {
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const g = targets[i];
      setLog(logEl, 'inf', tfmt('log_leave_item', { current: i + 1, total: targets.length, name: g.name }));
      const tab = await createTabAndWait(g.url, true);
      await sleep(3500);
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: leaveGroupInPage
      });
      const left = !!res?.[0]?.result?.left;
      if (left) {
        ok++;
        groups = groups.filter(x => x.url !== g.url);
        saveGroups();
        renderGroups();
      } else {
        fail++;
      }
      try { chrome.tabs.remove(tab.id); } catch (e) {}
      await sleep(1200);
    }
    setLog(logEl, 'ok', tfmt('log_leave_done', { ok, fail }));
  } catch (e) {
    setLog(logEl, 'err', t('log_leave_error') + ' ' + (e.message || t('unknown')));
  } finally {
    btn.disabled = false;
    await focusAppTab();
  }
}

async function leaveGroupInPage() {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const words = ['joined', 'miembro', 'member', 'unido'];
  const leaveWords = ['leave group', 'abandonar grupo', 'salir del grupo', 'salir de este grupo'];
  const confirmWords = ['leave', 'abandonar', 'salir', 'confirm'];
  const joinWords = ['join group', 'unirte', 'unirse', 'join'];

  const visible = () => Array.from(document.querySelectorAll('[role=button],button,[role=menuitem]')).filter(el => el.offsetParent);
  const txt = (el) => ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
  const pick = (arr, dict) => arr.find(el => dict.some(w => txt(el).includes(w)));

  function isStillMember() {
    const buttons = visible();
    return !!pick(buttons, words) && !pick(buttons, joinWords);
  }

  async function confirmLeavePopup() {
    // Facebook often opens a dialog that requires a second explicit confirmation.
    for (let i = 0; i < 8; i++) {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(d => d.offsetParent);
      for (const d of dialogs) {
        const btns = Array.from(d.querySelectorAll('[role=button],button')).filter(b => b.offsetParent);
        // Prefer exact destructive wording first.
        const exact = btns.find(b => {
          const t = txt(b);
          return t.includes('leave group') || t.includes('abandonar grupo') || t.includes('salir del grupo');
        });
        if (exact) {
          exact.click();
          await wait(900);
          return true;
        }
        const generic = pick(btns, confirmWords);
        if (generic) {
          generic.click();
          await wait(900);
          return true;
        }
      }
      await wait(500);
    }
    return false;
  }

  for (let tries = 0; tries < 4; tries++) {
    const buttons = visible();
    const joinedBtn = pick(buttons, words);
    if (!joinedBtn) { await wait(1000); continue; }
    joinedBtn.click();
    await wait(900);
    const leaveBtn = pick(visible(), leaveWords);
    if (!leaveBtn) { await wait(900); continue; }
    leaveBtn.click();
    await wait(1100);
    await confirmLeavePopup();
    // Fallback for UIs where confirm appears as a regular button outside dialog.
    for (let k = 0; k < 2; k++) {
      const c = pick(visible(), confirmWords);
      if (c) { c.click(); await wait(800); }
    }
    await wait(1500);
    if (!isStillMember()) return { left: true };
  }
  return { left: false };
}

async function deletePendingPostsFromGroups() {
  const btn = document.getElementById('btnDeletePendingPosts');
  const logEl = document.getElementById('scanLog');
  const selected = groups.filter(g => g.selected);
  if (!selected.length) { setLog(logEl, 'err', t('log_clean_select_groups')); return; }
  const targets = selected.filter(g => {
    const st = g.moderationStats || {};
    return Number(st.pending || 0) + Number(st.rejected || 0) + Number(st.deleted || 0) > 0;
  });
  if (!targets.length) { setLog(logEl, 'inf', t('log_clean_nothing_selected')); return; }
  if (!confirm(tfmt('log_clean_confirm', { total: targets.length }))) return;
  btn.disabled = true;
  try {
    let removedTotal = 0;
    for (let i = 0; i < targets.length; i++) {
      const g = targets[i];
      setLog(logEl, 'inf', tfmt('log_clean_group', { current: i + 1, total: targets.length, name: g.name }));
      const tab = await createTabAndWait(toDeclinedContentUrl(g.url), true);
      let removed = 0;
      const st = g.moderationStats || {};
      const paths = [];
      // Requested order: rejected -> deleted -> pending
      if (Number(st.rejected || 0) > 0) paths.push({ mode: 'rejected', url: toDeclinedContentUrl(g.url) });
      if (Number(st.deleted || 0) > 0) paths.push({ mode: 'deleted',  url: toRemovedContentUrl(g.url) });
      if (Number(st.pending || 0) > 0) paths.push({ mode: 'pending',  url: toPendingContentUrl(g.url) });
      for (const p of paths) {
        await openTabAndWait(tab.id, p);
        await sleep(1500);
        const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: deletePendingPostsInPage, args: [p.mode] });
        removed += Number(res?.[0]?.result?.removed || 0);
      }
      removedTotal += removed;
      const idx = groups.findIndex(x => x.url === g.url);
      if (idx >= 0) {
        groups[idx].pendingPostsCount = Math.max(0, Number(groups[idx].pendingPostsCount || 0) - removed);
        const st = groups[idx].moderationStats || { pending: 0, approved: 0, rejected: 0, deleted: 0 };
        const oldPending = Number(st.pending || 0);
        const oldRejected = Number(st.rejected || 0);
        const oldDeleted = Number(st.deleted || 0);
        let left = removed;
        const takePending = Math.min(left, oldPending); left -= takePending;
        const takeRejected = Math.min(left, oldRejected); left -= takeRejected;
        const takeDeleted = Math.min(left, oldDeleted); left -= takeDeleted;
        st.pending = Math.max(0, oldPending - takePending);
        st.rejected = Math.max(0, oldRejected - takeRejected);
        st.deleted = Math.max(0, oldDeleted - takeDeleted);
        groups[idx].moderationStats = st;
      }
      try { chrome.tabs.remove(tab.id); } catch (e) {}
      await sleep(900);
    }
    saveGroups();
    renderGroups();
    setLog(logEl, 'ok', tfmt('log_clean_done', { total: removedTotal }));
  } catch (e) {
    setLog(logEl, 'err', t('log_clean_error') + ' ' + (e.message || t('unknown')));
  } finally {
    btn.disabled = false;
    await focusAppTab();
  }
}

function deletePendingPostsInPage(mode) {
  const modeKey = String(mode || '').toLowerCase();
  const byMode = {
    pending: ['delete post', 'eliminar publicación', 'eliminar publicacion', 'cancel request', 'cancelar solicitud', 'delete', 'eliminar'],
    rejected: ['delete post', 'eliminar publicación', 'eliminar publicacion', 'delete', 'eliminar', 'remove', 'quitar'],
    deleted: ['delete', 'eliminar', 'remove', 'quitar']
  };
  const deleteWords = byMode[modeKey] || byMode.pending;
  let removed = 0;
  const buttons = Array.from(document.querySelectorAll('[role=button],button,[role=menuitem]'));
  for (let pass = 0; pass < 2; pass++) {
    for (const b of buttons) {
      if (!b || !b.offsetParent) continue;
      const t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
      if (deleteWords.some(w => t.includes(w))) {
        try { b.scrollIntoView({ block: 'center' }); } catch (e) {}
        b.click();
        removed++;
        if (removed >= 30) break;
      }
    }
    if (removed >= 30) break;
  }
  return { removed };
}

function addGroup() {
  const inp = document.getElementById('groupUrl');
  let url = inp.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  if (!url.includes('facebook.com/groups/')) { alert('URL invalida. Ej: https://www.facebook.com/groups/mi-grupo'); return; }
  const m = url.match(/groups\/([^/?#\s]+)/);
  if (!m) { alert('No se pudo detectar el ID del grupo.'); return; }
  const cleanUrl = 'https://www.facebook.com/groups/' + m[1];
  if (groups.find(g => g.url === cleanUrl)) { alert('Este grupo ya esta en la lista.'); return; }
  groups.push({ url: cleanUrl, name: m[1].replace(/[-_]/g, ' '), selected: true, canPost: null, postabilityCheckedAt: null, pendingPostsCount: 0 });
  saveGroups(); renderGroups(); inp.value = '';
}

function removeGroup(i) { groups.splice(i, 1); saveGroups(); renderGroups(); }
function toggleGroup(i) { groups[i].selected = !groups[i].selected; saveGroups(); }
function selectAll() { groups.forEach(g => g.selected = true); saveGroups(); renderGroups(); }
function deselectAll() { groups.forEach(g => g.selected = false); saveGroups(); renderGroups(); }
function clearAll() {
  if (!groups.length || !confirm('Delete all groups?')) return;
  groups = []; saveGroups(); renderGroups();
}

function renderGroups() {
  const list = document.getElementById('groupsList');
  document.getElementById('groupCount').textContent = groups.length;
  if (!groups.length) {
    list.innerHTML = '<div class="empty-note">' + (typeof t === 'function' ? t('groups_empty') : 'No groups yet.') + '</div>';
    return;
  }
  list.innerHTML = '';
  groups.forEach((g, i) => {
    const item = document.createElement('div');
    item.className = 'group-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = g.selected;
    cb.addEventListener('change', () => toggleGroup(i));
    const info = document.createElement('div');
    info.className = 'group-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'group-name';
    nameEl.textContent = g.name;
    const urlEl = document.createElement('div');
    urlEl.className = 'group-url-txt';
    urlEl.textContent = g.url;
    const meta = document.createElement('div');
    meta.className = 'group-meta';
    const b = document.createElement('span');
    const canPost = g.canPost;
    b.className = 'group-badge ' + (canPost === true ? 'ok' : canPost === false ? 'no' : 'unk');
    b.textContent = canPost === true
      ? t('group_badge_can_post')
      : canPost === false
        ? t('group_badge_no_permission')
        : t('group_badge_unverified');
    meta.appendChild(b);
    const postS = g.postStatus;
    if (postS) {
      const pb = document.createElement('span');
      pb.className = 'group-post-badge ' + (postS === 'ok' ? 'ok' : postS === 'err' ? 'err' : 'pend');
      pb.textContent = postS === 'ok' ? t('post_status_ok') : postS === 'err' ? t('post_status_err') : t('post_status_pending');
      pb.title = postS === 'err' ? (g.postError || t('post_status_err')) : '';
      meta.appendChild(pb);
    }
    const stats = g.moderationStats || { pending: 0, approved: 0, rejected: 0, deleted: 0 };
    const mk = (label, value) => {
      const s = document.createElement('span');
      s.className = 'group-post-badge info';
      s.textContent = label + ': ' + Number(value || 0);
      return s;
    };
    meta.appendChild(mk(t('mod_pending'), stats.pending));
    meta.appendChild(mk(t('mod_approved'), stats.approved));
    meta.appendChild(mk(t('mod_rejected'), stats.rejected));
    meta.appendChild(mk(t('mod_deleted'), stats.deleted));
    info.appendChild(nameEl);
    info.appendChild(urlEl);
    info.appendChild(meta);
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.title = t('group_btn_remove_title');
    delBtn.textContent = 'x';
    delBtn.addEventListener('click', () => removeGroup(i));
    const goBtn = document.createElement('button');
    goBtn.className = 'btn btn-secondary btn-sm';
    goBtn.style.marginLeft = '6px';
    goBtn.textContent = t('group_btn_open');
    goBtn.addEventListener('click', () => chrome.tabs.create({ url: g.url, active: true }));
    item.appendChild(cb);
    item.appendChild(info);
    item.appendChild(goBtn);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

async function verifyGroupsPostability() {
  const btn = document.getElementById('btnVerifyGroups');
  const logEl = document.getElementById('scanLog');
  if (!groups.length) { setLog(logEl, 'err', t('log_groups_need_first')); return; }
  btn.disabled = true;
  setLog(logEl, 'inf', t('log_verify_start'));
  try {
    const tabs = await qTabs(['*://www.facebook.com/*', '*://web.facebook.com/*']);
    if (!tabs.length) { setLog(logEl, 'err', t('open_fb_first')); return; }
    const fbTab = tabs[0];
    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      setLog(logEl, 'inf', tfmt('log_verify_item', { current: i + 1, total: groups.length, name: g.name }));
      await openTabAndWait(fbTab.id, g.url);
      await sleep(3500);
      const res = await chrome.scripting.executeScript({ target: { tabId: fbTab.id }, func: detectGroupPostabilityInPage });
      const canPost = !!res?.[0]?.result?.canPost;
      groups[i].canPost = canPost;
      groups[i].postabilityCheckedAt = Date.now();
      if (canPost) okCount++; else failCount++;
      saveGroups();
      renderGroups();
    }
    setLog(logEl, 'ok', tfmt('log_verify_done', { ok: okCount, noperm: failCount }));
  } catch (e) {
    setLog(logEl, 'err', t('log_verify_error') + ' ' + (e.message || t('unknown')));
  } finally {
    btn.disabled = false;
    await focusAppTab();
  }
}

async function checkModerationForAllGroups() {
  const logEl = document.getElementById('scanLog');
  if (!groups.length) { setLog(logEl, 'err', t('log_groups_need_first')); return; }
  const mode = document.getElementById('moderationCheckMode')?.value === 'deep' ? 'deep' : 'fast';
  const deep = mode === 'deep';
  const idxs = groups.map((_, i) => i);
  const btn = document.getElementById('btnCheckModeration');
  btn.disabled = true;
  setLog(logEl, 'inf', t('log_moderation_start') + ' [' + mode.toUpperCase() + ']');
  try {
    const tabs = await qTabs(['*://www.facebook.com/*', '*://web.facebook.com/*']);
    if (!tabs.length) { setLog(logEl, 'err', t('open_fb_first')); return; }
    const fbTab = tabs[0];
    let okCount = 0;
    let failCount = 0;
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      const g = groups[i];
      setLog(logEl, 'inf', tfmt('log_moderation_item', { current: k + 1, total: idxs.length, name: g.name }));
      const canPost = typeof g.canPost === 'boolean' ? g.canPost : null;
      let pendingPostsCount = Number(g.pendingPostsCount || 0);
      const statsFromGroup = g.moderationStats || { pending: pendingPostsCount, approved: 0, rejected: 0, deleted: 0 };
      const pendingUrl = toPendingContentUrl(g.url);
      const pendingRes = await readPendingStatsAt(fbTab.id, pendingUrl, deep ? 2 : 1);
      const pendingFromPage = Number(pendingRes?.pendingPostsCount || 0);
      const statsFromPending = pendingRes?.moderationStats || { pending: pendingFromPage, approved: 0, rejected: 0, deleted: 0 };
      if (pendingFromPage > pendingPostsCount) pendingPostsCount = pendingFromPage;

      const postedCount = await readContentCountAt(fbTab.id, toPostedContentUrl(g.url), 'approved', deep ? 2 : 1);
      const declinedCount = await readContentCountAt(fbTab.id, toDeclinedContentUrl(g.url), 'rejected', deep ? 2 : 1);
      const removedCount = await readContentCountAt(fbTab.id, toRemovedContentUrl(g.url), 'deleted', deep ? 2 : 1);

      const moderationStats = {
        pending: Math.max(Number(statsFromGroup.pending || 0), Number(statsFromPending.pending || 0), pendingPostsCount),
        approved: Math.max(Number(statsFromGroup.approved || 0), Number(statsFromPending.approved || 0), postedCount),
        rejected: Math.max(Number(statsFromGroup.rejected || 0), Number(statsFromPending.rejected || 0), declinedCount),
        deleted: Math.max(Number(statsFromGroup.deleted || 0), Number(statsFromPending.deleted || 0), removedCount)
      };
      groups[i].canPost = canPost;
      groups[i].pendingPostsCount = pendingPostsCount;
      groups[i].moderationStats = moderationStats;
      groups[i].postabilityCheckedAt = Date.now();
      if (canPost === true) okCount++;
      else if (canPost === false) failCount++;
      saveGroups();
      renderGroups();
    }
    setLog(logEl, 'ok', tfmt('log_moderation_done', { ok: okCount, noperm: failCount }));
  } catch (e) {
    setLog(logEl, 'err', t('log_moderation_error') + ' ' + (e.message || t('unknown')));
  } finally {
    btn.disabled = false;
    await focusAppTab();
  }
}

function toPendingContentUrl(groupUrl) {
  const m = String(groupUrl || '').match(/facebook\.com\/groups\/([^/?#\s]+)/i);
  if (!m) return groupUrl;
  return 'https://www.facebook.com/groups/' + m[1] + '/my_pending_content/';
}
function toPostedContentUrl(groupUrl) {
  const m = String(groupUrl || '').match(/facebook\.com\/groups\/([^/?#\s]+)/i);
  if (!m) return groupUrl;
  return 'https://www.facebook.com/groups/' + m[1] + '/my_posted_content';
}
function toDeclinedContentUrl(groupUrl) {
  const m = String(groupUrl || '').match(/facebook\.com\/groups\/([^/?#\s]+)/i);
  if (!m) return groupUrl;
  return 'https://www.facebook.com/groups/' + m[1] + '/my_declined_content';
}
function toRemovedContentUrl(groupUrl) {
  const m = String(groupUrl || '').match(/facebook\.com\/groups\/([^/?#\s]+)/i);
  if (!m) return groupUrl;
  return 'https://www.facebook.com/groups/' + m[1] + '/my_removed_content';
}

async function readContentCountAt(tabId, url, mode, attempts) {
  let max = 0;
  const tries = Math.max(1, Number(attempts || 1));
  for (let attempt = 0; attempt < tries; attempt++) {
    await openTabAndWait(tabId, url);
    await sleep(1200 + attempt * 400);
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))
    });
    await sleep(500 + attempt * 200);
    const res = await chrome.scripting.executeScript({ target: { tabId }, func: detectContentPageCount, args: [mode || ''] });
    const count = Number(res?.[0]?.result?.count || 0);
    if (count > max) max = count;
    if (max > 0 && tries === 1) break;
  }
  return max;
}

async function readPendingStatsAt(tabId, url, attempts) {
  let best = { pendingPostsCount: 0, moderationStats: { pending: 0, approved: 0, rejected: 0, deleted: 0 } };
  const tries = Math.max(1, Number(attempts || 1));
  for (let i = 0; i < tries; i++) {
    await openTabAndWait(tabId, url);
    await sleep(1200 + i * 400);
    const res = await chrome.scripting.executeScript({ target: { tabId }, func: detectPendingPostsInPendingPage });
    const next = res?.[0]?.result || {};
    const nextPending = Number(next.pendingPostsCount || 0);
    if (nextPending >= Number(best.pendingPostsCount || 0)) best = next;
    if (nextPending > 0 && tries === 1) break;
  }
  return best;
}

function extractCountByPatterns(text, regexes) {
  let max = 0;
  (regexes || []).forEach(re => {
    const m = String(text || '').match(re);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  });
  return max;
}

function detectPendingPostsInPendingPage() {
  function countByPatterns(text, regexes) {
    let max = 0;
    (regexes || []).forEach(re => {
      const m = String(text || '').match(re);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return max;
  }
  const body = (document.body?.innerText || '').toLowerCase();
  const noPendingHints = [
    'no tienes publicaciones pendientes',
    'no pending posts',
    'no pending content',
    'sin publicaciones pendientes'
  ];
  if (noPendingHints.some(h => body.includes(h))) return { pendingPostsCount: 0 };

  // Heuristic 1: pending list items usually render as articles/cards.
  const articleCount = document.querySelectorAll('div[role="article"], article').length;

  // Heuristic 2: one delete/remove action per pending item on this page.
  const btns = Array.from(document.querySelectorAll('[role=button],button,[role=menuitem]'));
  const delCount = btns.filter(b => {
    if (!b.offsetParent) return false;
    const t = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
    return t.includes('eliminar') || t.includes('delete') || t.includes('cancel request') || t.includes('cancelar solicitud');
  }).length;

  // Heuristic 3: explicit numeric label on page.
  const m = body.match(/(?:publicaciones pendientes|pending posts|pending content)\D{0,20}(\d{1,4})/i)
         || body.match(/(\d{1,4})\D{0,20}(?:publicaciones pendientes|pending posts|pending content)/i);
  const explicit = m ? (Number(m[1]) || 0) : 0;

  const pendingPostsCount = Math.max(explicit, articleCount, delCount);
  const moderationStats = {
    pending: pendingPostsCount,
    approved: countByPatterns(body, [/aprobad[oa]s?\D{0,25}(\d{1,4})/i, /approved\D{0,25}(\d{1,4})/i]),
    rejected: countByPatterns(body, [/rechazad[oa]s?\D{0,25}(\d{1,4})/i, /rejected\D{0,25}(\d{1,4})/i, /declined\D{0,25}(\d{1,4})/i]),
    deleted: countByPatterns(body, [/eliminad[oa]s?\D{0,25}(\d{1,4})/i, /deleted\D{0,25}(\d{1,4})/i, /removed\D{0,25}(\d{1,4})/i])
  };
  return { pendingPostsCount, moderationStats };
}

function detectContentPageCount(mode) {
  const body = (document.body?.innerText || '').toLowerCase();
  const emptyHints = [
    'no hay publicaciones',
    'no posts yet',
    'sin contenido publicado',
    'nothing to show'
  ];
  if (emptyHints.some(h => body.includes(h))) return { count: 0 };
  const modeMap = {
    approved: ['approved', 'posted', 'published', 'aprobad', 'publicad'],
    rejected: ['rejected', 'declined', 'rechazad', 'refused', 'denied'],
    deleted: ['deleted', 'removed', 'eliminad', 'borrad']
  };
  const words = modeMap[String(mode || '').toLowerCase()] || [];
  let explicit = 0;
  if (words.length) {
    for (const w of words) {
      const r1 = new RegExp(w + '\\D{0,25}(\\d{1,4})', 'i');
      const r2 = new RegExp('(\\d{1,4})\\D{0,25}' + w, 'i');
      const m1 = body.match(r1);
      const m2 = body.match(r2);
      explicit = Math.max(explicit, Number(m1?.[1] || 0), Number(m2?.[1] || 0));
    }
  }
  if (explicit > 0) return { count: explicit };
  const articleCount = document.querySelectorAll('div[role="article"], article').length;
  const rowCount = document.querySelectorAll('[role="feed"] > div, [data-pagelet*="FeedUnit"], [aria-posinset]').length;
  return { count: Math.max(articleCount, rowCount) };
}

function detectGroupPostabilityInPage() {
  function countByPatterns(text, regexes) {
    let max = 0;
    (regexes || []).forEach(re => {
      const m = String(text || '').match(re);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return max;
  }
  function extractPendingPostsCount() {
    const samples = [];
    const nodes = document.querySelectorAll(
      'a[href*="pending"], a[href*="pending_posts"], [aria-label*="pendiente" i], [aria-label*="pending" i]'
    );
    nodes.forEach(n => {
      const t = ((n.textContent || '') + ' ' + (n.getAttribute('aria-label') || '')).trim();
      if (t) samples.push(t);
      const p = n.parentElement?.textContent || '';
      if (p) samples.push(p);
    });
    samples.push(document.body?.innerText || '');

    const patterns = [
      /publicaciones pendientes\D{0,25}(\d{1,4})/i,
      /pending posts\D{0,25}(\d{1,4})/i,
      /(\d{1,4})\D{0,25}publicaciones pendientes/i,
      /(\d{1,4})\D{0,25}pending posts/i
    ];
    let max = 0;
    for (const s of samples) {
      for (const re of patterns) {
        const m = s.match(re);
        if (m) max = Math.max(max, Number(m[1]) || 0);
      }
    }
    // If FB shows only text without number ("tienes publicaciones pendientes"), mark as 1.
    if (max === 0) {
      const joined = samples.join(' ').toLowerCase();
      if (
        joined.includes('publicaciones pendientes') ||
        joined.includes('publicacion pendiente') ||
        joined.includes('pending post') ||
        joined.includes('pending posts')
      ) {
        max = 1;
      }
    }
    return max;
  }

  const words = ['escribe algo', 'write something', 'create a post', 'crear publicación', 'crear publicacion', 'nueva discusion', 'new discussion', 'publicar'];
  const bodyText = (document.body?.innerText || '').toLowerCase();
  const moderationStats = {
    pending: extractPendingPostsCount(),
    approved: countByPatterns(bodyText, [/aprobad[oa]s?\D{0,25}(\d{1,4})/i, /approved\D{0,25}(\d{1,4})/i]),
    rejected: countByPatterns(bodyText, [/rechazad[oa]s?\D{0,25}(\d{1,4})/i, /rejected\D{0,25}(\d{1,4})/i, /declined\D{0,25}(\d{1,4})/i]),
    deleted: countByPatterns(bodyText, [/eliminad[oa]s?\D{0,25}(\d{1,4})/i, /deleted\D{0,25}(\d{1,4})/i, /removed\D{0,25}(\d{1,4})/i])
  };
  const selectors = ['[role=button]', '[role=textbox]', '[contenteditable=true]'];
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      if (!el.offsetParent) continue;
      const txt = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '')).toLowerCase();
      if (words.some(w => txt.includes(w))) {
        return { canPost: true, pendingPostsCount: moderationStats.pending, moderationStats };
      }
    }
  }
  // Fallback: if member controls exist, assume posting is possible (sometimes composer is lazy-loaded).
  const memberSignals = Array.from(document.querySelectorAll('[role=button],button')).some(el => {
    if (!el.offsetParent) return false;
    const t = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    return t.includes('miembro') || t.includes('member') || t.includes('joined');
  });
  if (memberSignals) return { canPost: true, pendingPostsCount: moderationStats.pending, moderationStats };
  return { canPost: false, pendingPostsCount: moderationStats.pending, moderationStats };
}

function openTabAndWait(tabId, url) {
  return new Promise(resolve => {
    chrome.tabs.update(tabId, { url, active: true }, () => {
      const done = () => {
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve();
      };
      const onUpd = (id, info) => {
        if (id === tabId && info.status === 'complete') done();
      };
      chrome.tabs.onUpdated.addListener(onUpd);
      setTimeout(done, 12000);
    });
  });
}

// Editor
function insertEmoji(emoji) {
  const ta = document.getElementById('editor');
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + emoji + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + emoji.length;
  ta.focus();
  updateCC();
  if (spPreviewOpen) refreshSpPreview();
}

function updateCC() {
  const n = document.getElementById('editor').value.length;
  const el = document.getElementById('charCount');
  el.textContent = n + ' caracteres';
  el.className = 'char-count' + (n > 60000 ? ' over' : n > 50000 ? ' warn' : '');
}

// Images
function handleImages(ev) {
  Array.from(ev.target.files).slice(0, 5 - images.length).forEach(f => {
    const r = new FileReader();
    r.onload = e => { images.push({ dataUrl: e.target.result, name: f.name, type: f.type }); renderImgs(); };
    r.readAsDataURL(f);
  });
  ev.target.value = '';
}
function removeImage(i) { images.splice(i, 1); renderImgs(); }
function renderImgs() {
  const p = document.getElementById('imgPreview');
  p.innerHTML = '';
  images.forEach((img, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-thumb';
    const im = document.createElement('img');
    im.src = img.dataUrl;
    im.alt = img.name;
    const rm = document.createElement('button');
    rm.className = 'remove-img';
    rm.textContent = 'x';
    rm.addEventListener('click', () => removeImage(i));
    wrap.appendChild(im);
    wrap.appendChild(rm);
    p.appendChild(wrap);
  });
}

// Timer
function setTimerUnit(unit) {
  timerUnit = unit;
  document.getElementById('unitSec').classList.toggle('active', unit === 'sec');
  document.getElementById('unitMin').classList.toggle('active', unit === 'min');
  const slider = document.getElementById('timerSec');
  const varSlider = document.getElementById('timerVar');
  if (unit === 'sec') {
    slider.min = 5; slider.max = 300; slider.value = 30;
    varSlider.min = 0; varSlider.max = 60; varSlider.value = 10;
  } else {
    slider.min = 1; slider.max = 60; slider.value = 5;
    varSlider.min = 0; varSlider.max = 30; varSlider.value = 2;
  }
  updateTimerUI();
}

function updateTimerUI() {
  const on = document.getElementById('timerEnabled').checked;
  const opts = document.getElementById('timerOpts');
  opts.style.opacity = on ? '1' : '0.4';
  opts.style.pointerEvents = on ? 'auto' : 'none';
  const val = +document.getElementById('timerSec').value;
  const v = +document.getElementById('timerVar').value;
  const u = timerUnit === 'min' ? ' min' : 's';
  document.getElementById('timerSecVal').textContent = val + u;
  document.getElementById('timerVarVal').textContent = '+-' + v + u;
  document.getElementById('tMin').textContent = Math.max(0, val - v);
  document.getElementById('tMax').textContent = val + v;
  document.getElementById('tMinLbl').textContent = 'MIN';
  document.getElementById('tMaxLbl').textContent = 'MAX';
  const dailyOn = document.getElementById('dailyLimitEnabled').checked;
  const dailyOpts = document.getElementById('dailyLimitOpts');
  if (dailyOpts) {
    dailyOpts.style.opacity = dailyOn ? '1' : '0.45';
    dailyOpts.style.pointerEvents = dailyOn ? 'auto' : 'none';
  }
}

// Start/stop posting
async function startPosting() {
  const rawText = document.getElementById('editor').value;
  if (!rawText || !rawText.trim()) { alert('Escribe un mensaje primero.'); return; }
  let selBase = groups.filter(g => g.selected);
  if (!selBase.length) { alert('Select at least one group.'); return; }
  const verifiedOnlyEnabled = document.getElementById('verifiedOnlyEnabled')?.checked;
  const sel = verifiedOnlyEnabled ? selBase.filter(g => g.canPost === true) : selBase;
  if (!sel.length) {
    if (verifiedOnlyEnabled) alert('No verified groups with posting permission. Verify groups first and/or disable this filter.');
    else alert('Select at least one group.');
    return;
  }
  activePostingGroupUrls = new Set(sel.map(g => g.url));
  // Mark all selected groups as pending until we get results from background.
  sel.forEach(g => {
    g.postStatus = 'pending';
    g.postError = '';
  });
  saveGroups();
  renderGroups();

  const hasSpintax = /\{[^{}]*\|[^{}]*\}/.test(rawText);
  const proActive = await readLicenseStatus();
  const uiDailyLimitEnabled = document.getElementById('dailyLimitEnabled').checked;
  const uiDailySuccessLimit = parseInt(document.getElementById('dailySuccessLimit').value, 10);
  let dailyLimitEnabled = uiDailyLimitEnabled;
  let dailySuccessLimit = uiDailySuccessLimit;
  const dailyResumeTime = (document.getElementById('dailyResumeTime')?.value || '09:00').trim();
  if (proActive) {
    // Pro = unlimited posting, ignore daily cap.
    dailyLimitEnabled = false;
    dailySuccessLimit = 0;
  } else {
    // Free tier = hard cap 3 successful posts per day.
    dailyLimitEnabled = true;
    dailySuccessLimit = 3;
    const dailyLimitInput = document.getElementById('dailySuccessLimit');
    if (dailyLimitInput) dailyLimitInput.value = '3';
    const dailyToggle = document.getElementById('dailyLimitEnabled');
    if (dailyToggle) dailyToggle.checked = true;
    refreshMonetizationUI();
    alert(t('free_daily_limit_forced'));
  }
  if (dailyLimitEnabled && (!Number.isFinite(dailySuccessLimit) || dailySuccessLimit < 1)) {
    alert('El limite diario de posteos exitosos debe ser mayor a 0.');
    return;
  }
  if (dailyLimitEnabled && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(dailyResumeTime)) {
    alert('La hora de reanudacion debe tener formato 24h (HH:MM).');
    return;
  }
  const config = {
    text: rawText,
    useSpintax: hasSpintax,
    images,
    groups: sel,
    timerEnabled: document.getElementById('timerEnabled').checked,
    timerSeconds: timerUnit === 'min' ? +document.getElementById('timerSec').value * 60 : +document.getElementById('timerSec').value,
    timerVariation: timerUnit === 'min' ? +document.getElementById('timerVar').value * 60 : +document.getElementById('timerVar').value,
    dailyLimitEnabled,
    dailySuccessLimit,
    dailyResumeTime,
    bgTabsEnabled: document.getElementById('bgTabsEnabled')?.checked !== false,
    closeTabAfterPost: document.getElementById('closeTabAfterPost')?.checked !== false,
    notifyEnd: document.getElementById('notifyEnd').checked
  };

  chrome.storage.local.set({ posterConfig: config, posterRunning: true, posterResults: [] });
  setRunning(true);
  sessionLog = [];
  updateLogDisplay();
  goTab('progress');
  initSteps(sel);
  saveToHistory(rawText, '', sel.length);
  chrome.runtime.sendMessage({ action: 'startPosting', config });
}

function createTabAndWait(url, active) {
  return new Promise(resolve => {
    chrome.tabs.create({ url, active: !!active }, (tab) => {
      const tabId = tab.id;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve(tab);
      };
      const onUpd = (id, info) => {
        if (id === tabId && info.status === 'complete') finish();
      };
      chrome.tabs.onUpdated.addListener(onUpd);
      setTimeout(finish, 15000);
    });
  });
}

function stopPosting() { chrome.runtime.sendMessage({ action: 'stopPosting' }); setRunning(false); }

function setRunning(on) {
  isRunning = on;
  document.getElementById('btnStart').style.display = on ? 'none' : 'flex';
  document.getElementById('btnStop').style.display = on ? 'flex' : 'none';
  const bar = document.getElementById('runBar');
  if (bar) bar.className = 'run-bar' + (on ? ' show' : '');
  if (!on) {
    const cd = document.getElementById('cdBox');
    if (cd) cd.style.display = 'none';
    if (cdInterval) { clearInterval(cdInterval); cdInterval = null; }
  }
}

function resetAll() {
  if (isRunning && !confirm('Stop current process?')) return;
  stopPosting();
  groups = [];
  saveGroups();
  renderGroups();
  document.getElementById('editor').value = '';
  images = [];
  renderImgs();
  updateCC();
  sessionLog = [];
  updateLogDisplay();
  initSteps([]);
  setLog(document.getElementById('scanLog'), 'inf', '');
  chrome.storage.local.remove(['posterConfig', 'posterResults', HISTORY_KEY], () => {
    renderHistory([]);
  });
}

// Progress
function initSteps(grps) {
  const el = document.getElementById('progSteps');
  document.getElementById('progLabel').textContent = grps.length ? (t('in_progress') || 'In progress...') : t('prog_not_started');
  document.getElementById('progFrac').textContent = '0/' + grps.length;
  document.getElementById('progBar').style.width = '0%';
  if (!grps.length) {
    el.innerHTML = '<div class="empty-note">' + (t('prog_empty') || 'Start the process to view status.') + '</div>';
    return;
  }
  el.innerHTML = '';
  grps.forEach((g, i) => {
    const d = document.createElement('div');
    d.className = 'step-item pending';
    d.id = 'step-' + i;
    const icon = document.createElement('span'); icon.textContent = '...';
    const name = document.createElement('span'); name.textContent = g.name;
    d.appendChild(icon); d.appendChild(name);
    el.appendChild(d);
  });
}

// Session log
function appendToSessionLog(results) {
  results.forEach((r, i) => {
    const existing = sessionLog.find(e => e.group === r.name && e.idx === i);
    if (!existing) {
      sessionLog.push({ idx: i, group: r.name, success: r.success, error: r.error, log: r.log || [], time: new Date().toLocaleTimeString() });
      return;
    }
    // Merge final log with any streamed lines already collected.
    existing.success = r.success;
    existing.error = r.error;
    if (r.log && r.log.length) {
      const have = new Set(existing.log || []);
      r.log.forEach(l => {
        if (!have.has(l)) (existing.log = existing.log || []).push(l);
      });
    }
  });
  updateLogDisplay();
}

function updateLogDisplay() {
  const wrap = document.getElementById('logWrap');
  const body = document.getElementById('logBody');
  if (!sessionLog.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const lines = ['=== LOG DE SESION - ' + new Date().toLocaleDateString() + ' ==='];
  if (waitCountdownSec > 0) lines.push('⏳ Next post in: ' + waitCountdownSec + 's');
  sessionLog.forEach(entry => {
    lines.push('');
    lines.push((entry.success ? 'OK' : 'ERROR') + ' [' + entry.time + '] ' + entry.group);
    if (!entry.success && entry.error) lines.push('   ERROR: ' + entry.error);
    if (entry.log && entry.log.length) entry.log.forEach(l => lines.push('   > ' + l));
  });
  body.textContent = lines.join('\n');
}

function copyLog() {
  const body = document.getElementById('logBody');
  navigator.clipboard.writeText(body.textContent).then(() => {
    const btn = document.getElementById('btnCopyLog');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = body.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function updateProgress(results, total, countdown) {
  waitCountdownSec = Math.max(0, Number(countdown || 0));
  appendToSessionLog(results);
  // Update per-group post status badges (OK / Error).
  let changed = false;
  results.forEach(r => {
    const g = groups.find(x => x.url === r.url);
    if (!g) return;
    const nextStatus = r.success ? 'ok' : 'err';
    const nextError = r.success ? '' : (r.error || '');
    if (g.postStatus !== nextStatus || g.postError !== nextError) {
      g.postStatus = nextStatus;
      g.postError = nextError;
      changed = true;
    }
  });
  if (changed) {
    // Persist and refresh badges occasionally to avoid excessive DOM work.
    chrome.storage.local.set({ fbGroups: groups });
    const now = Date.now();
    if (now - lastGroupStatusRenderAt > 2000) {
      renderGroups();
      lastGroupStatusRenderAt = now;
    }
  }
  const done = results.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById('progFrac').textContent = done + '/' + total;
  document.getElementById('progBar').style.width = pct + '%';
  if (countdown > 0 && done < total) {
    document.getElementById('progLabel').textContent = tfmt('wait_next_post', { sec: countdown });
  } else {
    document.getElementById('progLabel').textContent = (done === total && total) ? (t('all_published') || 'All posts published!') : ((t('publishing') || 'Publishing...') + ' ' + pct + '%');
  }
  const rb = document.getElementById('runBarText');
  if (rb) {
    if (countdown > 0 && done < total) rb.textContent = tfmt('wait_next_post', { sec: countdown });
    else rb.textContent = tfmt('posting_group_of', { current: Math.min(done + 1, total), total });
  }

  results.forEach((r, i) => {
    const el = document.getElementById('step-' + i);
    if (!el) return;
    el.className = 'step-item ' + (r.success ? 'done' : 'error');
    el.innerHTML = '';
    const icon = document.createElement('span'); icon.textContent = r.success ? 'OK' : 'ERR';
    const txt = document.createElement('span');
    txt.textContent = r.name + ' - ' + (r.success ? 'Published' : (r.error || 'Error'));
    el.appendChild(icon); el.appendChild(txt);
    if (!r.success && r.log && r.log.length) {
      const logBtn = document.createElement('button');
      logBtn.className = 'btn btn-secondary btn-sm';
      logBtn.style.cssText = 'padding:2px 7px;font-size:10px;margin-left:6px;';
      logBtn.textContent = 'Log';
      logBtn.addEventListener('click', () => alert('Debug log:\n' + r.log.join('\n')));
      el.appendChild(logBtn);
    }
  });

  if (done < total) {
    const cur = document.getElementById('step-' + done);
    if (cur) {
      const baseName = (results[done]?.name || groups[done]?.name || cur.querySelector('span:last-child')?.textContent || '').split(' - ')[0];
      cur.className = 'step-item current';
      cur.innerHTML = '';
      const i2 = document.createElement('span'); i2.textContent = '...';
      const t2 = document.createElement('span'); t2.textContent = baseName + ' - ' + (t('publishing') || 'Publishing...');
      cur.appendChild(i2); cur.appendChild(t2);
    }
  }

  const cdBox = document.getElementById('cdBox');
  if (countdown > 0 && done < total) { cdBox.style.display = 'block'; startCD(countdown); }
  else { cdBox.style.display = 'none'; }

}

function startCD(sec) {
  if (cdInterval) clearInterval(cdInterval);
  let r = sec;
  waitCountdownSec = r;
  updateLogDisplay();
  document.getElementById('cdNum').textContent = r;
  cdInterval = setInterval(() => {
    r--;
    waitCountdownSec = Math.max(0, r);
    updateLogDisplay();
    document.getElementById('cdNum').textContent = r;
    if (r <= 0) {
      clearInterval(cdInterval);
      cdInterval = null;
      waitCountdownSec = 0;
      updateLogDisplay();
      document.getElementById('cdBox').style.display = 'none';
    }
  }, 1000);
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'progressUpdate') updateProgress(msg.results, msg.total, msg.countdown || 0);
  if (msg.action === 'plannerStatus') {
    const text = msg.message || 'Planificador activo';
    document.getElementById('progLabel').textContent = text;
    const rb = document.getElementById('runBarText');
    if (rb) rb.textContent = text;
  }
  if (msg.action === 'postingFinished') {
    setRunning(false);
    updateProgress(msg.results, msg.total, 0);
    document.getElementById('progLabel').textContent = t('all_published') || 'All posts published!';
    if (activePostingGroupUrls) {
      // Remaining groups that weren't attempted yet stay pending.
      groups.forEach(g => {
        if (activePostingGroupUrls.has(g.url) && !msg.results.some(r => r.url === g.url)) {
          if (!g.postStatus || g.postStatus !== 'ok') g.postStatus = 'pending';
        }
      });
      activePostingGroupUrls = null;
      saveGroups();
      renderGroups();
    }
  }
  if (msg.action === 'postingStopped') {
    setRunning(false);
    if (activePostingGroupUrls) {
      groups.forEach(g => {
        if (!activePostingGroupUrls.has(g.url)) return;
        // If it wasn't reported as OK/ERR, keep it pending.
        if (g.postStatus !== 'ok' && g.postStatus !== 'err') {
          g.postStatus = 'pending';
          g.postError = '';
        }
      });
      activePostingGroupUrls = null;
      saveGroups();
      renderGroups();
    }
  }

  if (msg.action === 'sessionLogLine') {
    const idx = msg.idx;
    const group = msg.group;
    const line = msg.line;
    if (typeof idx !== 'number' || !group || !line) return;
    let entry = sessionLog.find(e => e.group === group && e.idx === idx);
    if (!entry) {
      entry = { idx, group, success: false, error: '', log: [], time: new Date().toLocaleTimeString() };
      sessionLog.push(entry);
    }
    entry.log = entry.log || [];
    const last = entry.log[entry.log.length - 1];
    if (last !== line) entry.log.push(line);
    updateLogDisplay();
  }
});

// Spintax
function spinText(text) {
  let result = text, maxPasses = 20;
  while (maxPasses-- > 0) {
    const prev = result;
    result = result.replace(/\{([^{}]+)\}/g, (match, inner) => {
      const options = inner.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
    if (result === prev) break;
  }
  return result;
}

function countSpinGroups(text) {
  const matches = text.match(/\{[^{}]*\|[^{}]*\}/g);
  return matches ? matches.length : 0;
}

function spInsertTemplate() {
  const ta = document.getElementById('editor');
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const snippet = '{opcion1|opcion2|opcion3}';
  ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
  ta.selectionStart = start + 1;
  ta.selectionEnd   = start + 8;
  ta.focus();
  updateCC();
  if (spPreviewOpen) refreshSpPreview();
}

function toggleSpPreview() {
  spPreviewOpen = !spPreviewOpen;
  const wrap = document.getElementById('spintaxPreviewWrap');
  const hint = document.getElementById('spHint');
  const btn  = document.getElementById('spPreview');
  wrap.style.display = spPreviewOpen ? 'block' : 'none';
  hint.style.display = spPreviewOpen ? 'none' : 'block';
  btn.classList.toggle('sp-highlight', spPreviewOpen);
  btn.textContent = spPreviewOpen ? 'Cerrar vista' : 'Vista previa';
  if (spPreviewOpen) refreshSpPreview();
}

function refreshSpPreview() {
  const raw = document.getElementById('editor').value || '';
  const body = document.getElementById('spintaxPreviewBody');
  const label = document.getElementById('spVariantLabel');
  if (!raw.trim()) { body.innerHTML = '<span style="color:var(--muted)">El editor esta vacio...</span>'; label.textContent = ''; return; }
  const spinCount = countSpinGroups(raw);
  label.textContent = spinCount > 0 ? spinCount + ' variaciones' : 'Sin spintax';
  if (spinCount === 0) { body.textContent = raw; return; }
  let preview = escHtml(raw);
  let passes = 20;
  while (passes-- > 0) {
    const prev = preview;
    preview = preview.replace(/\{([^{}]+)\}/g, (match, inner) => {
      const options = inner.split('|');
      const chosen = options[Math.floor(Math.random() * options.length)];
      return '<span class="sp-chosen">' + chosen + '</span>';
    });
    if (preview === prev) break;
  }
  body.innerHTML = preview;
}

// History
async function saveToHistory(text, link, groupCount) {
  const entry = { id: Date.now(), date: new Date().toLocaleString(), text, link: link || '', groupCount, charCount: text.length };
  chrome.storage.local.get(HISTORY_KEY, (data) => {
    let hist = data[HISTORY_KEY] || [];
    hist.unshift(entry);
    if (hist.length > HISTORY_MAX) hist = hist.slice(0, HISTORY_MAX);
    chrome.storage.local.set({ [HISTORY_KEY]: hist }, renderHistory);
  });
}

function loadHistory() {
  chrome.storage.local.get(HISTORY_KEY, (data) => { renderHistory(data[HISTORY_KEY] || []); });
}

function renderHistory(histArg) {
  if (histArg === undefined) { chrome.storage.local.get(HISTORY_KEY, (data) => renderHistory(data[HISTORY_KEY] || [])); return; }
  const list = document.getElementById('historyList');
  if (!histArg.length) {
    const historyEmpty = (typeof t === 'function' ? t('history_empty') : 'No messages saved yet.');
    list.innerHTML = '<div class="empty-note">' + historyEmpty + '</div>';
    return;
  }
  list.innerHTML = '';
  histArg.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const header = document.createElement('div');
    header.className = 'history-item-header';
    const dateEl = document.createElement('span');
    dateEl.className = 'history-item-date';
    dateEl.textContent = entry.date;
    const statsEl = document.createElement('span');
    statsEl.className = 'history-item-stats';
    statsEl.textContent = entry.charCount + ' chars / ' + entry.groupCount + ' grupos' + (entry.link ? ' / link' : '');
    header.appendChild(dateEl);
    header.appendChild(statsEl);

    const textEl = document.createElement('div');
    textEl.className = 'history-item-text';
    textEl.textContent = entry.text;

    const actions = document.createElement('div');
    actions.className = 'history-item-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'btn btn-primary btn-sm';
    useBtn.textContent = 'Use this text';
    useBtn.addEventListener('click', () => {
      document.getElementById('editor').value = entry.text;
      updateCC();
      goTab('compose');
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary btn-sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(entry.text).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = orig; }, 2000);
      });
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = 'X';
    delBtn.addEventListener('click', () => {
      chrome.storage.local.get(HISTORY_KEY, (data) => {
        const hist = (data[HISTORY_KEY] || []).filter(e => e.id !== entry.id);
        chrome.storage.local.set({ [HISTORY_KEY]: hist }, () => renderHistory(hist));
      });
    });

    actions.appendChild(useBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(delBtn);
    item.appendChild(header);
    item.appendChild(textEl);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function clearHistory() {
  if (!confirm('Clear entire history?')) return;
  chrome.storage.local.remove(HISTORY_KEY, () => renderHistory([]));
}

// Helpers
function qTabs(patterns) { return new Promise(r => chrome.tabs.query({ url: patterns }, r)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function buildLangBar() {
  const bar = document.getElementById('langBar');
  if (!bar || typeof LANG_FLAGS === 'undefined') return;
  const langs = [
    ['es','🇪🇸 ES'],['en','🇬🇧 EN'],['pt','🇧🇷 PT'],
    ['fr','🇫🇷 FR'],['de','🇩🇪 DE'],['it','🇮🇹 IT'],
    ['ru','🇷🇺 RU'],['nl','🇳🇱 NL'],['pl','🇵🇱 PL'],['tr','🇹🇷 TR']
  ];
  const saved = localStorage.getItem('fartmily_lang') || 'es';
  const sel = document.createElement('select');
  sel.id = 'langSelect';
  langs.forEach(([code, label]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    if (code === saved) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    applyLang(sel.value);
    loadGroupSets();
    loadTextPresets();
  });
  bar.appendChild(sel);
}

async function focusAppTab() {
  try {
    const appUrl = chrome.runtime.getURL('app.html');
    const tabs = await new Promise(r => chrome.tabs.query({ url: appUrl }, r));
    if (tabs && tabs[0]?.id) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } catch (e) {}
}
function showConnected(on) {
  document.getElementById('stateOff').style.display = on ? 'none' : 'block';
  document.getElementById('stateOn').style.display = on ? 'block' : 'none';
}
function setPill(cls, name) {
  document.getElementById('connPill').className = 'conn-pill ' + cls;
  document.getElementById('connName').textContent = name;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
