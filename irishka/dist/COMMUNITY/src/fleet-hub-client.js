// ============================================================
// Irishka Fleet Hub client (Community — service worker helper)
// ============================================================
(function () {
  'use strict';

  const FLEET_ALARM = 'irishka_fleet_sync';
  const FLEET_FAST_ALARM = 'irishka_fleet_fast';
  const FLEET_FAST_MS = 5000;
  const DEFAULT_BASE = 'https://fb-group-poster-production.up.railway.app';
  const INSTALL_KEY = 'installDeviceId';

  let _config = {
    enabled: false,
    secret: '',
    baseUrl: DEFAULT_BASE,
    instanceName: 'Irishka',
  };
  let _lastCommandResult = null;
  let _commandHandler = null;
  let _storage = null;
  let _visionAutoEnabled = true;
  const _processedCommandIds = new Set();

  async function processOneCommand(cmd) {
    if (!cmd?.command || !_commandHandler) return;
    if (cmd.id && _processedCommandIds.has(cmd.id)) return;
    const result = await _commandHandler(cmd);
    if (cmd.id) {
      _processedCommandIds.add(cmd.id);
      if (_processedCommandIds.size > 300) {
        const drop = [..._processedCommandIds].slice(0, 100);
        drop.forEach((id) => _processedCommandIds.delete(id));
      }
    }
    _lastCommandResult = {
      id: cmd.id,
      command: cmd.command,
      ok: !!result?.ok,
      message: String(result?.message || '').slice(0, 180),
      at: new Date().toISOString(),
    };
  }

  function alarmName() {
    return FLEET_ALARM;
  }

  function fastAlarmName() {
    return FLEET_FAST_ALARM;
  }

  async function scheduleFastPoll(alarms) {
    if (!isEnabled()) {
      await alarms.clear(FLEET_FAST_ALARM);
      return;
    }
    await alarms.clear(FLEET_FAST_ALARM);
    alarms.create(FLEET_FAST_ALARM, { when: Date.now() + FLEET_FAST_MS });
  }

  function isEnabled() {
    return !!_config.enabled && !!_config.secret && !!_config.baseUrl;
  }

  async function init(storage) {
    _storage = storage;
    const d = await storage.get(['settings', INSTALL_KEY]);
    const s = d.settings || {};
    _config = {
      enabled: !!s.fleetHubEnabled,
      secret: String(s.fleetHubSecret || '').trim(),
      baseUrl: String(s.fleetHubBaseUrl || DEFAULT_BASE).trim().replace(/\/$/, '') || DEFAULT_BASE,
      instanceName: String(s.tgInstanceName || s.fleetInstanceName || '').trim() || 'Irishka',
      deviceId: String(d[INSTALL_KEY] || '').trim(),
    };
  }

  function onCommand(handler) {
    _commandHandler = typeof handler === 'function' ? handler : null;
  }

  async function ensureDeviceId(storage) {
    if (_config.deviceId) return _config.deviceId;
    const d = await storage.get([INSTALL_KEY]);
    let id = String(d[INSTALL_KEY] || '').trim();
    if (!id) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      await storage.set({ [INSTALL_KEY]: id });
    }
    _config.deviceId = id;
    return id;
  }

  async function startSync(alarms) {
    if (!isEnabled()) {
      await stopSync(alarms);
      return;
    }
    await alarms.clear(FLEET_ALARM);
    // Chrome min period is ~1 min; keep the fast alarm chain for heartbeats.
    alarms.create(FLEET_ALARM, { periodInMinutes: 1 });
    await scheduleFastPoll(alarms);
    // Immediate heartbeat so Fleet shows online without waiting for the first alarm.
    try {
      const ver = chrome.runtime.getManifest().version;
      await syncNow(_storage || chrome.storage.local, 'poster_run_state', ver);
    } catch (_) {}
  }

  async function stopSync(alarms) {
    await alarms.clear(FLEET_ALARM);
    await alarms.clear(FLEET_FAST_ALARM);
  }

  async function fleetFetch(path, options) {
    const url = `${_config.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${_config.secret}`,
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      cache: 'no-store',
    });
    return res;
  }

  async function collectStatus(storage, runStateKey) {
    const HEALTH_KEY = 'irishka_device_health_v1';
    const JOIN_QUEUE_KEY = 'irishka_join_queue_v1';
    const d = await storage.get(['posterRunning', runStateKey, 'posterResults', HEALTH_KEY, JOIN_QUEUE_KEY]);
    const running = !!d.posterRunning;
    const rs = d[runStateKey] || null;
    const results = d.posterResults || rs?.results || [];
    const total = rs?.config?.groups?.length || 0;
    const done = results.length;
    const ok = results.filter((r) => r.success).length;
    let currentGroup = '';
    if (running && rs && typeof rs.index === 'number' && rs.config?.groups) {
      const g = rs.config.groups[rs.index];
      currentGroup = g?.name || g?.url || '';
    }
    let facebookConnected = false;
    let facebookUserName = '';
    let facebookTabCount = 0;
    let facebookReason = '';
    if (typeof probeFacebookForFleet === 'function') {
      try {
        const fb = await probeFacebookForFleet();
        facebookConnected = !!fb.connected;
        facebookUserName = String(fb.userName || '').slice(0, 80);
        facebookTabCount = Number(fb.tabCount) || 0;
        facebookReason = String(fb.reason || '').slice(0, 120);
      } catch (_) {}
    }
    const jq = d[JOIN_QUEUE_KEY] || null;
    const joinActive = !!(jq && jq.active && Array.isArray(jq.urls) && (Number(jq.cursor) || 0) < jq.urls.length);
    const healthStore = d[HEALTH_KEY] && typeof d[HEALTH_KEY] === 'object' ? d[HEALTH_KEY] : {};
    const progress = { done, total, ok, currentGroup };
    const joinQueue = joinActive
      ? {
          cursor: Number(jq.cursor) || 0,
          total: jq.urls.length,
          joinedToday: Number(jq.joinedToday) || 0,
          dailyMax: Number(jq.dailyMax) || 5,
        }
      : { cursor: 0, total: 0, joinedToday: 0, dailyMax: 0 };
    const health =
      typeof DeviceHealthLogic !== 'undefined'
        ? DeviceHealthLogic.assess({
            nowMs: Date.now(),
            posterRunning: running,
            joinActive,
            facebookConnected,
            stopReason: running ? null : (rs?.stopReason || null),
            lastProgressAtMs: healthStore.lastProgressAtMs || null,
            lastError: healthStore.lastError || '',
            plannedStartAtMs: rs?.plannedStartAt || null,
            resumeHint: rs?.resumeHint || '',
            progress,
            joinQueue,
          })
        : null;
    return {
      posterRunning: running,
      hasRunState: !!rs,
      stopReason: running ? null : (rs?.stopReason || null),
      progress,
      facebookConnected,
      facebookUserName,
      facebookTabCount,
      facebookReason,
      health,
      healthSummary: health && typeof DeviceHealthLogic !== 'undefined'
        ? DeviceHealthLogic.formatSummary(health)
        : null,
      remoteSnapshot: typeof FLEET_REMOTE !== 'undefined'
        ? await FLEET_REMOTE.buildRemoteSnapshot(storage, runStateKey)
        : null,
    };
  }

  async function sendHeartbeat(storage, runStateKey, manifestVersion) {
    if (!isEnabled()) return { ok: false, error: 'Fleet Hub disabled or missing secret' };
    await ensureDeviceId(storage);
    const status = await collectStatus(storage, runStateKey);
    try {
      const res = await fleetFetch('/api/fleet/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: _config.deviceId,
          instanceName: _config.instanceName,
          extensionVersion: manifestVersion || '',
          lastCommandResult: _lastCommandResult,
          ...status,
        }),
      });
      let payload = {};
      try {
        payload = await res.json();
      } catch (_) {}
      if (!res.ok) return { ok: false };

      if (typeof payload.visionAutoEnabled === 'boolean') {
        _visionAutoEnabled = payload.visionAutoEnabled;
      }

      _lastCommandResult = null;
      const cmds = Array.isArray(payload.commands) ? payload.commands : [];
      for (const cmd of cmds) {
        await processOneCommand(cmd);
        // One queue_post per heartbeat tick — do not skip already-dequeued cmds.
        if (cmd?.command === 'queue_post') break;
      }

      if (cmds.length && _lastCommandResult) {
        const res2 = await fleetFetch('/api/fleet/heartbeat', {
          method: 'POST',
          body: JSON.stringify({
            deviceId: _config.deviceId,
            instanceName: _config.instanceName,
            extensionVersion: manifestVersion || '',
            lastCommandResult: _lastCommandResult,
            ...status,
          }),
        });
        if (res2.ok) _lastCommandResult = null;
      }

      return { ok: true, commandsProcessed: cmds.length };
    } catch {
      return { ok: false };
    }
  }

  async function pollCommands(storage, runStateKey, manifestVersion) {
    if (!isEnabled()) return;
    const st = storage || _storage;
    if (st) await ensureDeviceId(st);
    if (!_config.deviceId) return;
    let gotCmd = false;
    try {
      for (let n = 0; n < 8; n++) {
        const res = await fleetFetch(`/api/fleet/poll?deviceId=${encodeURIComponent(_config.deviceId)}`, {
          method: 'GET',
        });
        if (res.status === 204) break;
        if (!res.ok) break;
        const cmd = await res.json();
        await processOneCommand(cmd);
        gotCmd = true;
        // Poll already dequeued — never continue past a queue_post (would drop it).
        if (cmd?.command === 'queue_post') break;
      }
      if (gotCmd && st && _lastCommandResult) {
        await sendHeartbeat(st, runStateKey, manifestVersion).catch(() => {});
      }
    } catch (_) {}
  }

  async function uploadScreenshot(imageBase64, meta) {
    if (!isEnabled() || !_config.deviceId || !imageBase64) {
      return { ok: false, message: 'missing screenshot data' };
    }
    const body = {
      deviceId: _config.deviceId,
      imageBase64,
    };
    if (meta && typeof meta === 'object') {
      if (meta.visionGuard) body.visionGuard = true;
      if (meta.pauseContext) body.pauseContext = meta.pauseContext;
    }
    try {
      const res = await fleetFetch('/api/fleet/screenshot', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      let result = {};
      try {
        result = await res.json();
      } catch (_) {}
      return {
        ok: !!res.ok && result.ok !== false,
        message: result.message || (res.ok ? '' : `HTTP ${res.status}`),
      };
    } catch (e) {
      return { ok: false, message: String(e?.message || e).slice(0, 80) };
    }
  }

  async function syncNow(storage, runStateKey, manifestVersion) {
    if (!isEnabled()) return;
    await sendHeartbeat(storage, runStateKey, manifestVersion);
    await pollCommands(storage, runStateKey, manifestVersion);
  }

  async function tickFast(storage, runStateKey, manifestVersion, alarms) {
    if (!isEnabled()) return;
    // Keep heartbeats while posting so Fleet panel does not look hung/offline.
    await pollCommands(storage, runStateKey, manifestVersion);
    await sendHeartbeat(storage, runStateKey, manifestVersion);
    await scheduleFastPoll(alarms);
  }

  function visionAutoEnabled() {
    return _visionAutoEnabled !== false;
  }

  self.FLEET = {
    init,
    onCommand,
    startSync,
    stopSync,
    syncNow,
    tickFast,
    scheduleFastPoll,
    sendHeartbeat,
    pollCommands,
    uploadScreenshot,
    /** Used by fleet-remote for device-state + post-asset (must stay public). */
    fleetFetch,
    collectStatus,
    alarmName,
    fastAlarmName,
    isEnabled,
    visionAutoEnabled,
    config: () => ({ ..._config }),
  };
})();
