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
  let modalDeviceId = '';
  let busy = false;
  let lastScreenshotObjectUrl = null;
  const instanceStates = new Map();
  let pauseStatesSeeded = false;
  let pauseNotifyAsked = false;

  const STATE_LABEL = {
    posting: 'Posting',
    paused: 'Paused',
    idle: 'Idle',
    offline: 'Offline',
  };

  const TONE_LABEL = {
    live: 'Live',
    paused: 'Paused',
    error: 'Error',
    idle: 'Idle',
    offline: 'Offline',
  };

  /** Color de tarjeta: live=verde, paused=amarillo, error=rojo, idle/offline=gris */
  function cardTone(inst) {
    const st = inst.state || 'offline';
    const reason = String(inst.stopReason || '');
    if (st === 'posting') return 'live';
    if (st === 'offline') return 'offline';
    if (st === 'idle') return 'idle';
    if (st === 'paused') {
      if (reason === 'post_failure_pause') return 'error';
      return 'paused';
    }
    return 'idle';
  }

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
    toast._t = setTimeout(() => { el.hidden = true; }, 4500);
  }

  function isModalOpen() {
    const modal = document.getElementById('fleetModal');
    return !!(modal && !modal.hidden);
  }

  function setBusy(on, msg, opts) {
    busy = !!on;
    const fromModal = !!opts?.fromModal;
    const el = document.getElementById('busyOverlay');
    const text = document.getElementById('busyText');
    if (el) el.hidden = !on || (fromModal && isModalOpen());
    if (text && msg) text.textContent = msg;
    document.querySelectorAll('.card__actions [data-cmd], .toolbar [data-cmd]').forEach((b) => {
      b.disabled = on;
    });
  }

  function setModalShotLoading(on) {
    const bodyEl = document.getElementById('modalBody');
    const btn = bodyEl?.querySelector('.modal__action[data-cmd="screenshot"]');
    if (!btn) return;
    btn.disabled = !!on;
    btn.textContent = on ? '⏳ Capturando…' : '📸 Capturar pantalla';
  }

  function setSummaryLine(text) {
    const el = document.getElementById('summaryLine');
    if (el) el.textContent = text;
  }

  function pauseNotifyBody(inst) {
    const r = String(inst.stopReason || '');
    if (r === 'post_failure_pause') return 'Fallo al publicar — revisa en Irishka';
    if (r === 'user_pause') return 'Pausada manualmente';
    if (r === 'daily_limit') return 'Límite diario alcanzado';
    const p = inst.progress || {};
    return `Progreso: ${p.done || 0}/${p.total || 0} (${p.ok || 0} ok)`;
  }

  async function ensurePauseNotifyPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied' || pauseNotifyAsked) return false;
    pauseNotifyAsked = true;
    try {
      const r = await Notification.requestPermission();
      return r === 'granted';
    } catch (_) {
      return false;
    }
  }

  async function syncFleetAuthToServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sw = reg.active || reg.waiting;
      if (!sw) return;
      sw.postMessage({
        type: 'fleet-auth',
        fleetKey: fleetKey || '',
        initData: initData || '',
      });
    } catch (_) {}
  }

  function notifyInstancePaused(inst) {
    const name = inst.instanceName || 'Irishka';
    const title = `${name} pausada`;
    const body = pauseNotifyBody(inst);
    const tag = `pause-${inst.deviceId}`;

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, {
          body,
          icon: '/fleet/icon-192.png',
          tag,
          renotify: true,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch (_) {}
    }

    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'irishka-pause',
        title,
        body,
        tag,
      });
    }

    if (tg && typeof tg.HapticFeedback?.notificationOccurred === 'function') {
      try {
        tg.HapticFeedback.notificationOccurred('warning');
      } catch (_) {}
    }

    toast(`⏸ ${title}`);
  }

  function detectPauseTransitions(instances) {
    if (!Array.isArray(instances)) return;
    if (!pauseStatesSeeded) {
      instances.forEach((inst) => {
        if (inst?.deviceId) instanceStates.set(inst.deviceId, inst.state || 'idle');
      });
      pauseStatesSeeded = true;
      return;
    }
    instances.forEach((inst) => {
      if (!inst?.deviceId) return;
      const prev = instanceStates.get(inst.deviceId);
      const cur = inst.state || 'idle';
      if (cur === 'paused' && prev === 'posting') {
        notifyInstancePaused(inst);
      }
      instanceStates.set(inst.deviceId, cur);
    });
  }

  function pct(done, total) {
    if (!total) return 0;
    return Math.min(100, Math.round((done / total) * 100));
  }

  function openModal(title, html, deviceId) {
    const modal = document.getElementById('fleetModal');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    if (!modal || !titleEl || !bodyEl) return;
    modalDeviceId = deviceId || '';
    titleEl.textContent = title;
    bodyEl.innerHTML = html;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function revokeScreenshotObjectUrl() {
    if (lastScreenshotObjectUrl) {
      URL.revokeObjectURL(lastScreenshotObjectUrl);
      lastScreenshotObjectUrl = null;
    }
  }

  function closeModal() {
    const modal = document.getElementById('fleetModal');
    if (!modal) return;
    modal.hidden = true;
    modalDeviceId = '';
    document.body.style.overflow = '';
    revokeScreenshotObjectUrl();
  }

  function modalActionsHtml(deviceId, inst) {
    const id = escapeAttr(deviceId);
    const lastShot = inst?.hasScreenshot
      ? `<button type="button" class="btn btn--ghost modal__action" data-cmd="viewshot" data-target="${id}">🖼 Ver captura</button>`
      : '';
    return `<div class="modal__actions">
      <button type="button" class="btn btn--ok modal__action modal__action--primary" data-cmd="screenshot" data-target="${id}">📸 Capturar pantalla</button>
      ${lastShot}
      <button type="button" class="btn btn--ghost modal__action" data-cmd="consolidate_fb" data-target="${id}">🧹 Cerrar FB duplicadas</button>
      <button type="button" class="btn btn--warn modal__action" data-cmd="stop" data-target="${id}">⏸ Pausar</button>
      <button type="button" class="btn btn--ghost modal__action" data-cmd="resume" data-target="${id}">▶ Reanudar</button>
    </div>`;
  }

  function statusHtml(inst) {
    const p = inst.progress || {};
    const fbLine = inst.facebookConnected
      ? (inst.facebookUserName || 'Connected')
      : (inst.facebookReason || 'Not connected');
    const fbTabs = Number(inst.facebookTabCount) || 0;
    const fbTabsLabel = fbTabs > 1
      ? `⚠️ ${fbTabs} abiertas — se cierran duplicadas al capturar`
      : String(fbTabs);
    const rows = [
      ['State', STATE_LABEL[inst.state] || inst.state],
      ['Facebook', inst.facebookConnected ? `✓ ${fbLine}` : `✗ ${fbLine}`],
      ['FB tabs open', fbTabsLabel],
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
      const tone = cardTone(inst);
      const p = inst.progress || {};
      const done = p.done || 0;
      const total = p.total || 0;
      const ok = p.ok || 0;
      const bar = pct(done, total);
      const id = escapeAttr(inst.deviceId);
      const name = escapeHtml(inst.instanceName || 'Irishka');
      const fbTabs = Number(inst.facebookTabCount) || 0;
      const fbTitle = inst.facebookConnected
        ? (inst.facebookUserName || 'Facebook OK')
        : (inst.facebookReason || 'Facebook offline');
      const fbClass = inst.facebookConnected ? 'card__fb-dot--ok' : 'card__fb-dot--bad';
      const meta = st === 'offline'
        ? formatAgo(inst.offlineSinceMs)
        : (total > 0 ? `${done}/${total} · ${ok}ok` : '—');
      const groupTip = p.currentGroup ? escapeAttr(p.currentGroup) : '';
      const groupMark = p.currentGroup ? `<span class="card__pin" title="${groupTip}">📍</span>` : '';
      const progress = total > 0
        ? `<div class="progress progress--thin progress--${tone}"><div class="progress__bar" style="width:${bar}%"></div></div>`
        : '';
      return `
        <article class="card card--dense card--tone-${tone}" data-id="${id}" data-tone="${tone}">
          <div class="card__body">
            <div class="card__main">
              <div class="card__head">
                <span class="card__title" title="${name}">${name}</span>
                <span class="card__badge card__badge--${tone}">${TONE_LABEL[tone] || tone}</span>
              </div>
              <div class="card__sub">
                <span class="card__stat">${meta}</span>
                ${groupMark}
                <span class="card__fb-dot ${fbClass}" title="${escapeAttr(fbTitle)}${fbTabs > 1 ? ` · ${fbTabs} tabs` : ''}">📘</span>
              </div>
              ${progress}
            </div>
          </div>
          <div class="card__actions card__actions--bar">
            <button type="button" class="btn btn--action btn--ghost" data-cmd="status" data-target="${id}" title="Status">📊</button>
            <button type="button" class="btn btn--action btn--warn" data-cmd="stop" data-target="${id}" title="Pause">⏸</button>
            <button type="button" class="btn btn--action btn--ok" data-cmd="resume" data-target="${id}" title="Resume">▶</button>
            <button type="button" class="btn btn--action btn--ghost" data-cmd="screenshot" data-target="${id}" title="Screenshot">📸</button>
            <button type="button" class="btn btn--action btn--danger" data-cmd="remove" data-target="${id}" title="Remove">🗑</button>
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
      detectPauseTransitions(data.instances || []);
      void syncFleetAuthToServiceWorker();
      void ensurePauseNotifyPermission();
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
    openModal(`${inst.instanceName || 'Irishka'} — Status`, statusHtml(inst) + modalActionsHtml(deviceId, inst), deviceId);
  }

  async function fetchScreenshotPayload(deviceId) {
    const imgUrl = `${API_BASE}/api/fleet/screenshot/img?deviceId=${encodeURIComponent(deviceId)}`;
    try {
      const res = await fetch(imgUrl, { headers: headers(), cache: 'no-store' });
      if (res.ok) {
        const ct = String(res.headers.get('content-type') || '');
        if (ct.includes('image')) {
          const blob = await res.blob();
          if (blob && blob.size > 0) {
            revokeScreenshotObjectUrl();
            lastScreenshotObjectUrl = URL.createObjectURL(blob);
            return {
              capturedAt: res.headers.get('X-Captured-At') || null,
              imageSrc: lastScreenshotObjectUrl,
            };
          }
        }
      }
    } catch (_) {}

    const shot = await apiGet(`/api/fleet/screenshot?deviceId=${encodeURIComponent(deviceId)}`);
    if (shot.ok && shot.imageBase64) {
      const b64 = String(shot.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      return {
        capturedAt: shot.capturedAt || null,
        imageSrc: `data:image/jpeg;base64,${b64}`,
      };
    }
    return null;
  }

  function showScreenshotModal(deviceId, name, payload) {
    const when = payload.capturedAt
      ? new Date(payload.capturedAt).toLocaleString()
      : 'Now';
    openModal(
      `${name} — Screenshot`,
      `<p style="color:var(--muted);margin:0 0 8px">${escapeHtml(when)}</p>` +
      `<img class="modal__shot" src="${payload.imageSrc}" alt="Screenshot">` +
      modalActionsHtml(deviceId, { hasScreenshot: true }),
      deviceId
    );
  }

  async function presentScreenshot(deviceId, name) {
    const payload = await fetchScreenshotPayload(deviceId);
    if (!payload) return false;
    showScreenshotModal(deviceId, name, payload);
    return true;
  }

  async function waitAndShowScreenshot(deviceId, name, opts) {
    const beforeAt = String(opts?.beforeAt || '');
    const maxAttempts = opts?.maxAttempts || 24;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 700 : 1500));
      try {
        if (await presentScreenshot(deviceId, name)) {
          await refresh();
          return true;
        }
      } catch (e) {
        if (e.status && e.status !== 404) {
          // keep polling on transient errors
        }
      }
      const data = await refresh();
      const inst = (data?.instances || []).find((x) => x.deviceId === deviceId);
      const lr = inst?.lastCommandResult;
      if (lr?.command === 'screenshot' && lr.at && lr.ok === false) {
        const msg = lr.message || 'Screenshot failed';
        toast(/dragging a tab|cannot be edited/i.test(msg)
          ? 'Chrome bloqueó el cambio de pestaña — suelta la pestaña, haz clic en Facebook y reintenta'
          : msg);
        return false;
      }
      if (inst?.hasScreenshot && inst.lastScreenshotAt && inst.lastScreenshotAt !== beforeAt) {
        try {
          if (await presentScreenshot(deviceId, name)) {
            await refresh();
            return true;
          }
        } catch (_) {}
      }
      if (lr?.command === 'screenshot' && lr.at && lr.ok) {
        try {
          if (await presentScreenshot(deviceId, name)) {
            await refresh();
            return true;
          }
        } catch (_) {}
      }
    }
    return false;
  }

  async function viewLastScreenshot(deviceId) {
    const inst = findInstance(deviceId);
    const name = inst?.instanceName || 'Irishka';
    setBusy(true, `Cargando captura de ${name}…`);
    try {
      if (await presentScreenshot(deviceId, name)) return;
      toast('No hay captura guardada');
    } catch (e) {
      toast(e.status === 404 ? 'No hay captura guardada' : 'No se pudo cargar la captura');
    } finally {
      setBusy(false);
    }
  }

  async function requestScreenshot(deviceId) {
    const id = deviceId || modalDeviceId;
    if (!id) return;
    const fromModal = isModalOpen() && modalDeviceId === id;
    if (busy && !fromModal) return;
    const inst = findInstance(id);
    const name = inst?.instanceName || 'Irishka';
    const beforeAt = inst?.lastScreenshotAt || '';
    setBusy(true, `📸 Capturando ${name}…`, { fromModal });
    if (fromModal) setModalShotLoading(true);
    toast(`📸 Capturando ${name}…`);
    try {
      await apiPost('/api/fleet/command', { command: 'screenshot', deviceId: id, target: id });
      const opened = await waitAndShowScreenshot(id, name, { beforeAt });
      if (!opened) {
        const data = await refresh();
        const lr = (data?.instances || []).find((x) => x.deviceId === id)?.lastCommandResult;
        if (lr?.command === 'screenshot' && lr.ok) {
          toast('Captura guardada — pulsa 🖼 Ver captura');
        } else if (lr?.message) {
          toast(lr.message);
        } else {
          toast('No se pudo mostrar la captura — reintenta');
        }
      }
    } catch (e) {
      toast(e.status === 401 ? 'Unauthorized' : 'Screenshot command failed');
    } finally {
      setModalShotLoading(false);
      setBusy(false);
    }
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

  async function waitForCommandResult(deviceId, command, timeoutMs) {
    const before = findInstance(deviceId)?.lastCommandResult?.at || '';
    const max = Math.ceil((timeoutMs || 25000) / 2000);
    for (let i = 0; i < max; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 1200 : 2000));
      const data = await refresh();
      const inst = (data?.instances || []).find((x) => x.deviceId === deviceId);
      const lr = inst?.lastCommandResult;
      if (lr?.command === command && lr.at && lr.at !== before) {
        return lr;
      }
    }
    return null;
  }

  async function sendCommand(command, target) {
    if (busy && command === 'screenshot' && !(isModalOpen() && modalDeviceId === target)) return;
    if (command === 'status' && target !== 'all') {
      await showStatus(target);
      return;
    }
    if (command === 'viewshot' && target !== 'all') {
      await viewLastScreenshot(target);
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
    if ((command === 'stop' || command === 'resume' || command === 'consolidate_fb' || command === 'cleanfb') && target !== 'all') {
      const inst = findInstance(target);
      const name = inst?.instanceName || 'Irishka';
      const labels = { stop: '⏸ Pausando', resume: '▶ Reanudando', consolidate_fb: '🧹 Limpiando FB', cleanfb: '🧹 Limpiando FB' };
      setBusy(true, `${labels[command] || command} ${name}…`);
      try {
        await apiPost('/api/fleet/command', { command, deviceId: target, target });
        const lr = await waitForCommandResult(target, command, 30000);
        if (lr?.message) toast(lr.ok ? lr.message : lr.message);
        else toast(`${command} enviado — esperando respuesta…`);
        if (modalDeviceId === target) await showStatus(target);
        else await refresh();
      } catch (e) {
        toast(e.status === 401 ? 'Unauthorized' : 'Command failed');
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      await apiPost('/api/fleet/command', { command, deviceId: target, target });
      const label = target === 'all' ? 'all instances' : 'instance';
      toast(`${command} → ${label}`);
      if (command === 'stop' || command === 'resume') {
        setTimeout(async () => {
          await refresh();
          if (modalDeviceId && modalDeviceId === target) await showStatus(target);
        }, 1200);
      } else {
        setTimeout(refresh, 800);
      }
    } catch (e) {
      toast(e.status === 401 ? 'Unauthorized' : 'Command failed');
    }
  }

  function bindActions() {
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const cmd = btn.getAttribute('data-cmd');
      const target = btn.getAttribute('data-target') || 'all';
      sendCommand(cmd, target).catch((err) => {
        console.error('[fleet]', err);
        toast('Error — try again');
        setBusy(false);
      });
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
      void syncFleetAuthToServiceWorker();
      void ensurePauseNotifyPermission();
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

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/fleet/sw.js', { scope: '/fleet/' });
      await reg.update();
      await syncFleetAuthToServiceWorker();
    } catch (_) {}
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
    void syncFleetAuthToServiceWorker();
    void ensurePauseNotifyPermission();
    refreshTimer = setInterval(refresh, 12000);
  }

  init();
})();
