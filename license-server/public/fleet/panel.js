(function () {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const API_BASE = window.location.origin;
  const FLEET_KEY_STORAGE = 'irishka_fleet_panel_key';
  let initData = '';
  let fleetKey = '';
  let refreshTimer = null;

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
    toast._t = setTimeout(() => { el.hidden = true; }, 2800);
  }

  function setSummaryLine(text) {
    const el = document.getElementById('summaryLine');
    if (el) el.textContent = text;
  }

  function pct(done, total) {
    if (!total) return 0;
    return Math.min(100, Math.round((done / total) * 100));
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
      const group = p.currentGroup ? `<div class="card__group">📍 ${escapeHtml(p.currentGroup)}</div>` : '';
      return `
        <article class="card" data-id="${escapeAttr(inst.deviceId)}">
          <div class="card__top">
            <span class="status-dot status-dot--${st}"></span>
            <div class="card__title">${STATE_ICON[st] || '⚪'} ${escapeHtml(inst.instanceName || 'Irishka')}</div>
            <span class="card__badge card__badge--${st}">${STATE_LABEL[st] || st}</span>
          </div>
          <div class="card__meta">${meta}</div>
          ${group}
          ${total > 0 ? `<div class="progress"><div class="progress__bar" style="width:${bar}%"></div></div>` : ''}
          <div class="card__actions">
            <button type="button" class="btn btn--sm btn--ghost" data-cmd="status" data-target="${escapeAttr(inst.deviceId)}">📊</button>
            <button type="button" class="btn btn--sm btn--warn" data-cmd="stop" data-target="${escapeAttr(inst.deviceId)}">⏸</button>
            <button type="button" class="btn btn--sm btn--ok" data-cmd="resume" data-target="${escapeAttr(inst.deviceId)}">▶</button>
            <button type="button" class="btn btn--sm btn--ghost" data-cmd="screenshot" data-target="${escapeAttr(inst.deviceId)}">📸</button>
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
    if (gate) gate.hidden = false;
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
    } catch (e) {
      if (e.status === 401) {
        fleetKey = '';
        try { sessionStorage.removeItem(FLEET_KEY_STORAGE); } catch (_) {}
        showAuthGate();
        toast('Unauthorized — enter fleet secret');
        return;
      }
      setSummaryLine('Could not load fleet');
      toast('Could not load fleet');
    }
  }

  async function sendCommand(command, target) {
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
      const cmd = btn.getAttribute('data-cmd');
      const target = btn.getAttribute('data-target') || 'all';
      sendCommand(cmd, target);
    });
    document.getElementById('btnRefresh')?.addEventListener('click', () => {
      refresh();
      toast('Refreshing…');
    });
    document.getElementById('btnAuthUnlock')?.addEventListener('click', async () => {
      const input = document.getElementById('authFleetKey');
      const key = String(input?.value || '').trim();
      if (!key) {
        toast('Paste fleet secret');
        return;
      }
      fleetKey = key;
      try { sessionStorage.setItem(FLEET_KEY_STORAGE, key); } catch (_) {}
      await refresh();
    });
  }

  async function init() {
    try {
      fleetKey = sessionStorage.getItem(FLEET_KEY_STORAGE) || '';
    } catch (_) {
      fleetKey = '';
    }

    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#0b1220');
      tg.setBackgroundColor('#0b1220');
      initData = tg.initData || '';
    }

    bindActions();

    if (!initData && !fleetKey) {
      showAuthGate();
      return;
    }

    await refresh();
    refreshTimer = setInterval(refresh, 12000);
  }

  init();
})();
