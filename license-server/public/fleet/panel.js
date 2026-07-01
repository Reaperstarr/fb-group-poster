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
  let visionGlobalEnabled = true;

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
    document.querySelectorAll('.card__actions [data-cmd], .toolbar [data-cmd], .fleet-icon-row [data-cmd], .fleet-btn[data-cmd]').forEach((b) => {
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

  function openModal(title, html, deviceId, opts) {
    const modal = document.getElementById('fleetModal');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    const sheet = modal?.querySelector('.modal__sheet');
    if (!modal || !titleEl || !bodyEl) return;
    modalDeviceId = deviceId || '';
    titleEl.textContent = title;
    bodyEl.innerHTML = html;
    if (sheet) {
      sheet.classList.toggle('modal__sheet--wide', !!opts?.wide);
    }
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
    return `${visionAutoToggleHtml(inst)}
    <div class="modal__actions">
      <button type="button" class="btn btn--ok modal__action modal__action--primary" data-cmd="screenshot" data-target="${id}">📸 Capturar pantalla</button>
      ${lastShot}
      <button type="button" class="btn btn--ghost modal__action" data-cmd="consolidate_fb" data-target="${id}">🧹 Cerrar FB duplicadas</button>
      <button type="button" class="btn btn--warn modal__action" data-cmd="stop" data-target="${id}">⏸ Pausar</button>
      <button type="button" class="btn btn--ghost modal__action" data-cmd="resume" data-target="${id}">▶ Reanudar</button>
    </div>`;
  }

  function visionAutoToggleHtml(inst) {
    if (!inst?.deviceId) return '';
    const id = escapeAttr(inst.deviceId);
    const checked = inst.visionAutoEnabled !== false ? 'checked' : '';
    const globalOff = visionGlobalEnabled === false;
    const disabled = globalOff ? 'disabled' : '';
    const hint = globalOff
      ? 'Vision Guard desactivado en el servidor (sin OPENAI_API_KEY o IRISHKA_VISION_ENABLED=false)'
      : 'Clasifica pausas con IA y auto-resume si no es crítico';
    return `<div class="modal__settings">
      <label class="toggle-row" title="${escapeAttr(hint)}">
        <span class="toggle-row__label">🤖 AI automático</span>
        <span class="toggle">
          <input type="checkbox" class="toggle__input" data-vision-toggle="${id}" ${checked} ${disabled}>
          <span class="toggle__track" aria-hidden="true"></span>
        </span>
      </label>
      <p class="modal__hint">${escapeHtml(hint)}</p>
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
    if (inst.lastVisionAnalysis?.category) {
      rows.push(['Last AI', `${inst.lastVisionAnalysis.category} (${Math.round((inst.lastVisionAnalysis.confidence || 0) * 100)}%)`]);
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
      const aiOn = inst.visionAutoEnabled !== false;
      const aiDisabled = visionGlobalEnabled === false;
      const aiTitle = aiDisabled
        ? 'Vision Guard desactivado en el servidor'
        : (aiOn ? 'AI automático ON' : 'AI automático OFF');
      const FR = window.__fleetRemote || {};
      const snap = inst.remoteSnapshot || {};
      const postLine = FR.postPreviewLine ? FR.postPreviewLine(snap) : '';
      const groupsLine = FR.groupsLine ? FR.groupsLine(snap) : '';
      const postPreview = postLine
        ? `<p class="fleet-card__snippet" title="${escapeAttr(postLine)}">${escapeHtml(postLine)}</p>`
        : '';
      const groupsPreview = groupsLine
        ? `<span class="fleet-card__chip">${escapeHtml(groupsLine)}</span>`
        : '';
      const fbLabel = inst.facebookConnected ? 'FB' : 'FB off';
      const aiChip = `<label class="fleet-card__chip fleet-card__chip--ai" title="${escapeAttr(aiTitle)}" onclick="event.stopPropagation()">
        <input type="checkbox" class="card__ai-check" data-vision-toggle="${id}" ${aiOn ? 'checked' : ''} ${aiDisabled ? 'disabled' : ''}>
        <span>AI</span>
      </label>`;
      return `
        <article class="fleet-card fleet-card--${tone}" data-id="${id}" data-tone="${tone}">
          <button type="button" class="fleet-card__surface" data-open-remote="${id}" title="Abrir panel remoto">
            <div class="fleet-card__header">
              <span class="fleet-card__dot" aria-hidden="true"></span>
              <h2 class="fleet-card__name" title="${name}">${name}</h2>
              <span class="fleet-card__pill fleet-card__pill--${tone}">${TONE_LABEL[tone] || tone}</span>
            </div>
            <div class="fleet-card__meta">
              <span class="fleet-card__stat">${meta}</span>
              ${groupMark ? `<span class="fleet-card__chip fleet-card__chip--pin" title="${groupTip}">Grupo</span>` : ''}
              <span class="fleet-card__chip fleet-card__chip--fb ${fbClass}" title="${escapeAttr(fbTitle)}">${fbLabel}</span>
              ${groupsPreview}
              ${aiChip}
            </div>
            ${postPreview}
            ${progress}
          </button>
          <div class="fleet-card__actions">
            <button type="button" class="fleet-btn fleet-btn--primary" data-cmd="remote_panel" data-target="${id}">
              <span class="fleet-btn__label">Panel</span>
            </button>
            <div class="fleet-icon-row">
              <button type="button" class="fleet-icon-btn" data-cmd="stop" data-target="${id}" title="Pausar" aria-label="Pausar">⏸</button>
              <button type="button" class="fleet-icon-btn fleet-icon-btn--ok" data-cmd="resume" data-target="${id}" title="Reanudar" aria-label="Reanudar">▶</button>
              <button type="button" class="fleet-icon-btn" data-cmd="status" data-target="${id}" title="Estado" aria-label="Estado">ℹ</button>
              <button type="button" class="fleet-icon-btn" data-cmd="screenshot" data-target="${id}" title="Captura" aria-label="Captura">◫</button>
              <button type="button" class="fleet-icon-btn fleet-icon-btn--danger" data-cmd="remove" data-target="${id}" title="Quitar" aria-label="Quitar">✕</button>
            </div>
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
      visionGlobalEnabled = data.visionGlobalEnabled !== false;
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

  async function setVisionAutoEnabled(deviceId, enabled) {
    const resp = await apiPost('/api/fleet/instance-settings', {
      deviceId,
      visionAutoEnabled: !!enabled,
    });
    const inst = resp.instance;
    if (inst) {
      const idx = instancesCache.findIndex((i) => i.deviceId === deviceId);
      if (idx >= 0) instancesCache[idx] = { ...instancesCache[idx], ...inst };
    }
    if (resp.visionGlobalEnabled === false) visionGlobalEnabled = false;
    toast(enabled ? '🤖 AI automático ON' : '🤖 AI automático OFF');
    await refresh();
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

  async function fetchDeviceState(deviceId) {
    try {
      const data = await apiGet(`/api/fleet/device-state?deviceId=${encodeURIComponent(deviceId)}`);
      return data.ok ? data.state : null;
    } catch (_) {
      return null;
    }
  }

  async function refreshRemoteState(deviceId) {
    await apiPost('/api/fleet/command', { command: 'get_state', deviceId, target: deviceId });
    await waitForCommandResult(deviceId, 'get_state', 20000);
    return fetchDeviceState(deviceId);
  }

  async function uploadPostImage(file) {
    if (!file) return null;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const imageBase64 = btoa(binary);
    const resp = await apiPost('/api/fleet/post-asset', {
      imageBase64,
      mime: file.type || 'image/jpeg',
      name: file.name || 'fleet-image.jpg',
    });
    return resp.assetId || null;
  }

  async function showRemotePanel(deviceId) {
    const inst = findInstance(deviceId);
    if (!inst) {
      toast('Instance not found');
      return;
    }
    const name = inst.instanceName || 'Irishka';
    setBusy(true, `Cargando ${name}…`);
    let state = await fetchDeviceState(deviceId);
    if (!state) {
      try {
        state = await refreshRemoteState(deviceId);
      } catch (_) {}
    }
    setBusy(false);
    const FR = window.__fleetRemote || {};
    const html = FR.remotePanelHtml
      ? FR.remotePanelHtml(inst, state)
      : '<p>Remote panel unavailable</p>';
    openModal(`${name} — Control remoto`, html + modalActionsHtml(deviceId, inst), deviceId, { wide: true });
    if (!state) {
      toast('Estado parcial — pulsa Actualizar estado');
    }
  }

  async function saveRemoteGroupSelection(deviceId) {
    const bodyEl = document.getElementById('modalBody');
    if (!bodyEl) return;
    const checks = [...bodyEl.querySelectorAll('.remote-group__check')];
    const selectedUrls = checks.filter((c) => c.checked).map((c) => c.getAttribute('data-group-url')).filter(Boolean);
    const deselectedUrls = checks.filter((c) => !c.checked).map((c) => c.getAttribute('data-group-url')).filter(Boolean);
    setBusy(true, 'Guardando grupos…');
    try {
      if (selectedUrls.length) {
        await apiPost('/api/fleet/command', {
          command: 'toggle_groups',
          deviceId,
          target: deviceId,
          meta: { urls: selectedUrls, selected: true },
        });
      }
      if (deselectedUrls.length) {
        await apiPost('/api/fleet/command', {
          command: 'toggle_groups',
          deviceId,
          target: deviceId,
          meta: { urls: deselectedUrls, selected: false },
        });
      }
      await waitForCommandResult(deviceId, 'toggle_groups', 15000);
      toast('Selección de grupos enviada');
      await showRemotePanel(deviceId);
    } catch (e) {
      toast('No se pudo guardar grupos');
    } finally {
      setBusy(false);
    }
  }

  async function submitQueuePost(deviceId) {
    const bodyEl = document.getElementById('modalBody');
    const text = String(bodyEl?.querySelector('#remotePostText')?.value || '').trim();
    if (!text) {
      toast('Escribe el mensaje (spintax)');
      return;
    }
    const file = bodyEl?.querySelector('#remotePostImage')?.files?.[0] || null;
    setBusy(true, 'Añadiendo post…');
    try {
      let imageAssetId = null;
      if (file) imageAssetId = await uploadPostImage(file);
      await apiPost('/api/fleet/command', {
        command: 'queue_post',
        deviceId,
        target: deviceId,
        meta: { text, imageAssetId },
      });
      const lr = await waitForCommandResult(deviceId, 'queue_post', 35000);
      toast(lr?.message || (lr?.ok ? 'Post añadido' : 'Error al añadir'));
      const ta = bodyEl?.querySelector('#remotePostText');
      const fi = bodyEl?.querySelector('#remotePostImage');
      if (ta) ta.value = '';
      if (fi) fi.value = '';
      await refresh();
      await showRemotePanel(deviceId);
    } catch (e) {
      toast('No se pudo añadir el post');
    } finally {
      setBusy(false);
    }
  }

  async function submitStartPosting(deviceId) {
    setBusy(true, 'Iniciando publicación…');
    try {
      await apiPost('/api/fleet/command', {
        command: 'start_posting',
        deviceId,
        target: deviceId,
        meta: {},
      });
      const lr = await waitForCommandResult(deviceId, 'start_posting', 45000);
      toast(lr?.message || (lr?.ok ? 'Publicación iniciada' : 'No se pudo iniciar'));
      await refresh();
      await showRemotePanel(deviceId);
    } catch (e) {
      toast('Error al iniciar publicación');
    } finally {
      setBusy(false);
    }
  }

  async function submitRemovePost(deviceId, index) {
    if (!confirm('¿Eliminar este post de la cola?')) return;
    setBusy(true, 'Eliminando post…');
    try {
      await apiPost('/api/fleet/command', {
        command: 'remove_post',
        deviceId,
        target: deviceId,
        meta: { index: Number(index) },
      });
      const lr = await waitForCommandResult(deviceId, 'remove_post', 20000);
      toast(lr?.message || (lr?.ok ? 'Post eliminado' : 'No se pudo eliminar'));
      await refresh();
      await showRemotePanel(deviceId);
    } catch (e) {
      toast('Error al eliminar');
    } finally {
      setBusy(false);
    }
  }

  async function submitPushPost(deviceId) {
    await submitQueuePost(deviceId);
  }

  async function sendRemoteCommand(command, target, meta) {
    const inst = findInstance(target);
    const name = inst?.instanceName || 'Irishka';
    const labels = {
      scan_groups: '🔍 Escaneando grupos',
      verify_groups: '✅ Verificando grupos',
      start_join: '▶ Iniciando join',
      stop_join: '⏹ Parando join',
      open_app: '🍀 Abriendo Irishka',
      get_state: '↻ Sincronizando',
    };
    setBusy(true, `${labels[command] || command} ${name}…`);
    try {
      await apiPost('/api/fleet/command', {
        command,
        deviceId: target,
        target,
        meta: meta || {},
      });
      const lr = await waitForCommandResult(target, command, 45000);
      toast(lr?.message || `${command} enviado`);
      if (command === 'get_state' || command === 'scan_groups' || command === 'verify_groups') {
        await showRemotePanel(target);
      }
      await refresh();
    } catch (e) {
      toast(e.status === 401 ? 'Unauthorized' : 'Command failed');
    } finally {
      setBusy(false);
    }
  }

  async function sendCommand(command, target) {
    if (busy && command === 'screenshot' && !(isModalOpen() && modalDeviceId === target)) return;
    if (command === 'remote_panel' && target !== 'all') {
      await showRemotePanel(target);
      return;
    }
    if (command === 'push_post' && target !== 'all') {
      await submitQueuePost(target);
      return;
    }
    if (command === 'queue_post' && target !== 'all') {
      await submitQueuePost(target);
      return;
    }
    if (command === 'start_posting' && target !== 'all') {
      await submitStartPosting(target);
      return;
    }
    if (command === 'remove_post' && target !== 'all') {
      const btn = document.querySelector(`[data-cmd="remove_post"][data-target="${target}"]`);
      const idx = btn?.getAttribute('data-post-index');
      const clicked = document.activeElement?.closest?.('[data-cmd="remove_post"]');
      const postIndex = clicked?.getAttribute('data-post-index') ?? idx;
      if (postIndex == null) {
        toast('Índice de post no válido');
        return;
      }
      await submitRemovePost(target, postIndex);
      return;
    }
    if (command === 'refresh_remote' && target !== 'all') {
      await sendRemoteCommand('get_state', target);
      return;
    }
    if (['scan_groups', 'verify_groups', 'start_join', 'stop_join', 'open_app'].includes(command) && target !== 'all') {
      const btn = document.querySelector(`[data-cmd="${command}"][data-target="${target}"]`);
      const scope = btn?.getAttribute('data-scope') || 'all';
      await sendRemoteCommand(command, target, command === 'verify_groups' ? { scope } : {});
      return;
    }
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
    document.body.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-vision-toggle]');
      if (!cb || cb.disabled) return;
      e.stopPropagation();
      const deviceId = cb.getAttribute('data-vision-toggle');
      if (!deviceId) return;
      setVisionAutoEnabled(deviceId, cb.checked).catch(() => {
        cb.checked = !cb.checked;
        toast('No se pudo guardar AI automático');
      });
    });
    document.body.addEventListener('click', (e) => {
      const saveBtn = e.target.closest('#remoteSaveGroups');
      if (saveBtn) {
        e.preventDefault();
        e.stopPropagation();
        const deviceId = saveBtn.getAttribute('data-target') || modalDeviceId;
        if (deviceId) saveRemoteGroupSelection(deviceId).catch(() => toast('Error guardando grupos'));
        return;
      }
      const remoteBody = e.target.closest('[data-open-remote]');
      if (remoteBody && !e.target.closest('[data-cmd],[data-vision-toggle],button.fleet-icon-btn,a,input,label')) {
        const deviceId = remoteBody.getAttribute('data-open-remote');
        if (deviceId) {
          e.preventDefault();
          showRemotePanel(deviceId).catch(() => toast('No se pudo abrir panel'));
        }
        return;
      }
      const btn = e.target.closest('[data-cmd]');
      if (!btn || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const cmd = btn.getAttribute('data-cmd');
      const target = btn.getAttribute('data-target') || 'all';
      if (cmd === 'remove_post') {
        const postIndex = btn.getAttribute('data-post-index');
        if (target !== 'all' && postIndex != null) {
          submitRemovePost(target, postIndex).catch(() => toast('Error al eliminar'));
        }
        return;
      }
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
      tg.setHeaderColor('#070d18');
      tg.setBackgroundColor('#070d18');
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
