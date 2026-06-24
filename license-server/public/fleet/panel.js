(function () {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const API_BASE = window.location.origin;
  const FLEET_KEY_STORAGE = 'irishka_fleet_panel_key_v1';
  let initData = '';
  let fleetKey = '';
  let refreshTimer = null;
  let installPrompt = null;
  let instancesCache = [];

  const STATE_LABEL = {
    posting: 'Posting',
    paused: 'Paused',
    idle: 'Idle',
    offline: 'Offline',
  };

  const STATE_ICON = {
    posting: '🟢',
    paused: '🟡',
    idle: '⚪',
    offline: '🔴',
  };

  function saveFleetKey(key) {
    fleetKey = key;
    try { localStorage.setItem(FLEET_KEY_STORAGE, key); } catch (_) {}
  }

  function loadFleetKey() {
    try {
      fleetKey = localStorage.getItem(FLEET_KEY_STORAGE) || '';
    } catch (_) {
      fleetKey = '';
    }
    return fleetKey;
  }

  function clearFleetKey() {
    fleetKey = '';
    try { localStorage.removeItem(FLEET_KEY_STORAGE); } catch (_) {}
  }

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (initData) h['X-Telegram-Init-Data'] = initData;
    else if (fleetKey) h.Authorization = `Bearer ${fleetKey}`;
    return h;
  }

  async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: headers(), cache: 'no-store' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function setSummaryLine(text) {
    const el = document.getElementById('summaryLine');
    if (el) el.textContent = text;
  }

  function pct(done, total) {
    if (!total) return 0;
    return Math.min(100, Math.round((done / total) * 100));
  }

  function openModal(title, html) {
    const modal = document.getElementById('fleetModal');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    if (!modal || !titleEl || !bodyEl) return;
    titleEl.textContent = title;
    bodyEl.innerHTML = html;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const modal = document.getElementById('fleetModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function statusHtml(inst) {
    const p = inst.progress || {};
    const fbLine = inst.facebookConnected
      ? (inst.facebookUserName || 'Connected')
      : (inst.facebookReason || 'Not connected');
    const rows = [
      ['State', STATE_LABEL[inst.state] || inst.state],
      ['Facebook', inst.facebookConnected ? `✓ ${fbLine}` : `✗ ${fbLine}`],
      ['FB tabs open', String(inst.facebookTabCount || 0)],
      ['Progress', `${p.done || 0}/${p.total || 0} (${p.ok || 0} ok)`],
      ['Current group', p.currentGroup || '—'],
      ['Extension', inst.extensionVersion || '—'],
      ['Last seen', inst.lastHeartbeatAt ? new Date(inst.lastHeartbeatAt).toLocaleString() : '—'],
    ];
    if (inst.stopReason) rows.push(['Stop reason', inst.stopReason]);
    if (inst.lastCommandResult?.message) {
      rows.push(['Last command', inst.lastCommandResult.message]);
    }
    return rows.map(([k, v]) =>
      `<div class="modal__row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`
    ).join('');
  }

  function renderSummary(summary) {
    const cards = [
      { n: summary.total, l: 'Total', c: '' },
      { n: summary.posting, l: 'Live', c: 'var(--green)' },
      { n: summary.paused, l: 'Paused', c: 'var(--yellow)' },
      { n: summary.offline, l: 'Off', c: 'var(--red)' },
    ];
    document.getElementById('summaryCards').innerHTML = cards.map((c) =>
      `<div class="summary-card"><div class="summary-card__n" style="color:${c.c || 'inherit'}">${c.n}</div><div class="summary-card__l">${c.l}</div></div>`
    ).join('');
    setSummaryLine(`${summary.posting} posting · ${summary.paused} paused · ${summary.offline} offline`);
  }

  function renderInstances(instances) {
    instancesCache = instances;
    const list = document.getElementById('instanceList');
    const empty = document.getElementById('emptyState');
    if (!instances.length) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'No Irishkas connected yet. Enable Fleet Hub in each extension and run Test heartbeat.';
      }
      list.innerHTML = '';
      if (empty) list.appendChild(empty);
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = instances.map((inst) => {
      const st = inst.state || 'offline';
      const p = inst.progress || {};
      const done = p.done || 0;
      const total = p.total || 0;
      const ok = p.ok || 0;
      const bar = pct(done, total);
      const meta = st === 'offline'
        ? `Last seen ${formatAgo(inst.offlineSinceMs)}`
        : `${done}/${total} groups · ${ok} ok`;
      const fbBadge = inst.facebookConnected
        ? `<div class="card__fb card__fb--ok">📘 ${escapeHtml(inst.facebookUserName || 'Facebook OK')}</div>`
        : `<div class="card__fb card__fb--bad">📘 ${escapeHtml(inst.facebookReason || 'Facebook offline')}</div>`;
      const group = p.currentGroup ? `<div class="card__group">📍 ${escapeHtml(p.currentGroup)}</div>` : '';
      return `
        <article class="card" data-id="${escapeAttr(inst.deviceId)}">
          <div class="card__top">
            <span class="status-dot status-dot--${st}"></span>
            <div class="card__title">${STATE_ICON[st] || '⚪'} ${escapeHtml(inst.instanceName || 'Irishka')}</div>
            <span class="card__badge card__badge--${st}">${STATE_LABEL[st] || st}</span>
          </div>
          <div class="card__meta">${meta}</div>
          ${fbBadge}
          ${group}
          ${total > 0 ? `<div class="progress"><div class="progress__bar" style="width:${bar}%"></div></div>` : ''}
          <div class="card__actions">
            <button type="button" class="btn btn--sm btn--ghost" data-cmd="status" data-target="${escapeAttr(inst.deviceId)}" title="Status">📊</button>
            <button type="button" class="btn btn--sm btn--warn" data-cmd="stop" data-target="${escapeAttr(inst.deviceId)}" title="Pause">⏸</button>
            <button type="button" class="btn btn--sm btn--ok" data-cmd="resume" data-target="${escapeAttr(inst.deviceId)}" title="Resume">▶</button>
            <button type="button" class="btn btn--sm btn--ghost" data-cmd="screenshot" data-target="${escapeAttr(inst.deviceId)}" title="Screenshot">📸</button>
            <button type="button" class="btn btn--sm btn--danger" data-cmd="remove" data-target="${escapeAttr(inst.deviceId)}" title="Remove">🗑</button>
          </div>
        </article>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  function formatAgo(ms) {
    if (!ms || ms < 0) return 'unknown';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  }

  function showAuthGate() {
    const gate = document.getElementById('authGate');
    const input = document.getElementById('authFleetKey');
    if (gate) gate.hidden = false;
    if (input && fleetKey) input.value = fleetKey;
    setSummaryLine('Enter fleet secret to unlock panel');
    document.getElementById('summaryCards').innerHTML = '';
    document.getElementById('instanceList').innerHTML = '';
  }

  function hideAuthGate() {
    const gate = document.getElementById('authGate');
    if (gate) gate.hidden = true;
  }

  async function refresh() {
    if (!initData && !fleetKey) {
      showAuthGate();
      return;
    }
    try {
      const data = await apiGet('/api/fleet/dashboard');
      if (!data.ok) throw new Error('dashboard failed');
      hideAuthGate();
      renderSummary(data.summary || { total: 0, posting: 0, paused: 0, idle: 0, offline: 0 });
      renderInstances(data.instances || []);
      document.getElementById('lastSync').textContent = `Updated ${new Date().toLocaleTimeString()}`;
      return data;
    } catch (e) {
      if (e.status === 401) {
        clearFleetKey();
        showAuthGate();
        toast('Unauthorized — enter fleet secret');
        return null;
      }
      setSummaryLine('Could not load fleet');
      toast('Could not load fleet');
      return null;
    }
  }

  function findInstance(deviceId) {
    return instancesCache.find((i) => i.deviceId === deviceId) || null;
  }

  async function showStatus(deviceId) {
    let inst = findInstance(deviceId);
    try {
      const resp = await apiPost('/api/fleet/command', { command: 'status', deviceId, target: deviceId });
      if (resp.instance) inst = resp.instance;
    } catch (_) {}
    if (!inst) {
      const data = await refresh();
      inst = (data?.instances || []).find((i) => i.deviceId === deviceId);
    }
    if (!inst) {
      toast('Instance not found');
      return;
    }
    openModal(`${inst.instanceName || 'Irishka'} — Status`, statusHtml(inst));
  }

  async function requestScreenshot(deviceId) {
    const inst = findInstance(deviceId);
    const name = inst?.instanceName || 'Irishka';
    toast(`📸 Capturing ${name}…`);
    const before = inst?.lastScreenshotAt || '';
    try {
      await apiPost('/api/fleet/command', { command: 'screenshot', deviceId, target: deviceId });
    } catch (e) {
      toast(e.status === 401 ? 'Unauthorized' : 'Screenshot command failed');
      return;
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const shot = await apiGet(`/api/fleet/screenshot?deviceId=${encodeURIComponent(deviceId)}`);
        if (shot.ok && shot.imageBase64) {
          openModal(
            `${name} — Screenshot`,
            `<p style="color:var(--muted);margin:0 0 8px">${shot.capturedAt ? new Date(shot.capturedAt).toLocaleString() : 'Now'}</p>` +
            `<img src="data:image/jpeg;base64,${shot.imageBase64}" alt="Screenshot">`
          );
          await refresh();
          return;
        }
      } catch (e) {
        if (e.status !== 404) break;
      }
      const data = await refresh();
      const updated = (data?.instances || []).find((x) => x.deviceId === deviceId);
      const lr = updated?.lastCommandResult;
      if (lr?.command === 'screenshot' && lr.at && lr.ok === false) {
        toast(lr.message || 'Screenshot failed');
        return;
      }
      if (updated?.lastScreenshotAt && updated.lastScreenshotAt !== before) {
        try {
          const shot = await apiGet(`/api/fleet/screenshot?deviceId=${encodeURIComponent(deviceId)}`);
          if (shot.ok && shot.imageBase64) {
            openModal(
              `${name} — Screenshot`,
              `<p style="color:var(--muted);margin:0 0 8px">${shot.capturedAt ? new Date(shot.capturedAt).toLocaleString() : 'Now'}</p>` +
              `<img src="data:image/jpeg;base64,${shot.imageBase64}" alt="Screenshot">`
            );
            await refresh();
            return;
          }
        } catch (_) {}
        break;
      }
    }
    const data = await refresh();
    const updated = (data?.instances || []).find((x) => x.deviceId === deviceId);
    const lr = updated?.lastCommandResult;
    if (lr?.command === 'screenshot' && lr.message) {
      toast(lr.ok ? 'Screenshot sent — reload panel' : lr.message);
      return;
    }
    toast('Screenshot timeout — is the PC online with Facebook open?');
  }

  async function removeInstance(deviceId) {
    const inst = findInstance(deviceId);
    const name = inst?.instanceName || deviceId;
    if (!confirm(`Remove "${name}" from the fleet list?`)) return;
    try {
      await apiPost('/api/fleet/remove', { deviceId });
      toast(`Removed ${name}`);
      closeModal();
      await refresh();
    } catch (e) {
      toast(e.status === 401 ? 'Unauthorized' : 'Could not remove');
    }
  }

  async function sendCommand(command, target) {
    if (command === 'status' && target !== 'all') {
      await showStatus(target);
      return;
    }
    if (command === 'screenshot' && target !== 'all') {
      await requestScreenshot(target);
      return;
    }
    if (command === 'remove' && target !== 'all') {
      await removeInstance(target);
      return;
    }
    try {
      await apiPost('/api/fleet/command', { command, deviceId: target, target });
      const label = target === 'all' ? 'all instances' : 'instance';
      toast(`${command} → ${label}`);
      setTimeout(refresh, 800);
    } catch (e) {
      toast(e.status === 401 ? 'Unauthorized' : 'Command failed');
    }
  }

  function bindActions() {
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      e.preventDefault();
      const cmd = btn.getAttribute('data-cmd');
      const target = btn.getAttribute('data-target') || 'all';
      sendCommand(cmd, target);
    });
    document.getElementById('btnRefresh')?.addEventListener('click', () => {
      refresh();
      toast('Refreshing…');
    });
    document.getElementById('btnInstall')?.addEventListener('click', async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        const btn = document.getElementById('btnInstall');
        if (btn) btn.hidden = true;
        return;
      }
      toast('Use browser menu → Install app / Add to Home Screen');
    });
    document.getElementById('btnAuthUnlock')?.addEventListener('click', async () => {
      const input = document.getElementById('authFleetKey');
      const key = String(input?.value || '').trim();
      if (!key) {
        toast('Paste fleet secret');
        return;
      }
      saveFleetKey(key);
      await refresh();
      if (!refreshTimer) refreshTimer = setInterval(refresh, 12000);
    });
    document.getElementById('modalClose')?.addEventListener('click', closeModal);
    document.getElementById('modalBackdrop')?.addEventListener('click', closeModal);
  }

  function setupInstallPrompt() {
    const inTelegram = !!(tg && tg.initData);
    if (inTelegram) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const hint = document.getElementById('installHint');
    const btnInstall = document.getElementById('btnInstall');

    if (isStandalone) {
      if (hint) hint.hidden = true;
      if (btnInstall) btnInstall.hidden = true;
      return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installPrompt = e;
      if (btnInstall) btnInstall.hidden = false;
      if (hint) {
        hint.hidden = false;
        hint.textContent = 'Tap ⬇ to install Irishka Fleet on this device.';
      }
    });

    if (isIos && hint) {
      hint.hidden = false;
      hint.textContent = 'iPhone: Share → Add to Home Screen to install as app.';
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/fleet/sw.js', { scope: '/fleet/' }).catch(() => {});
  }

  async function init() {
    loadFleetKey();

    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#0b1220');
      tg.setBackgroundColor('#0b1220');
      initData = tg.initData || '';
    }

    bindActions();
    registerServiceWorker();
    setupInstallPrompt();

    if (!initData && !fleetKey) {
      showAuthGate();
      return;
    }

    const input = document.getElementById('authFleetKey');
    if (input && fleetKey) input.value = fleetKey;

    await refresh();
    refreshTimer = setInterval(refresh, 12000);
  }

  init();
})();
