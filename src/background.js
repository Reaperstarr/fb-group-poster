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
const RUNSTATE_KEY = 'poster_run_state';
const PAUSE_BEFORE_PUBLISH = false; // Pausa desactivada por defecto.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'startPosting') startPostingProcess(msg.config);
  if (msg.action === 'stopPosting') {
    stopRequested = true;
    posterRunning = false;
    runState = null;
    chrome.alarms.clear('fartmily_resume');
    chrome.storage.local.remove(RUNSTATE_KEY);
    chrome.storage.local.set({ posterRunning: false });
    broadcastToApp({ action: 'postingStopped' });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'fartmily_resume') return;

  // In MV3, the service worker can be suspended; in that case, runState in memory is lost.
  // Rehydrate the state from storage, then resume.
  chrome.storage.local.get([RUNSTATE_KEY, 'posterRunning'], (d) => {
    if (!d?.posterRunning) return;

    posterRunning = true;
    stopRequested = false;
    runState = d[RUNSTATE_KEY] || runState;
    if (runState && runState.config?.dailyLimitEnabled) {
      // When the alarm fires, we should resume now; don't re-evaluate
      // "today vs tomorrow" again from stored ms differences.
      runState.startedOnce = true;
    }
    if (runState) runPostingLoop().catch(() => {});
  });
});

async function startPostingProcess(config) {
  posterRunning = true;
  stopRequested = false;
  chrome.alarms.clear('fartmily_resume');
  chrome.storage.local.remove(RUNSTATE_KEY);
  const now = Date.now();
  const plannedStartAt = null;
  runState = {
    config,
    results: [],
    index: 0,
    dailySuccessCount: 0,
    dailyKey: dayKey(now),
    startedOnce: false,
    plannedStartAt
  };
  chrome.storage.local.set({ posterRunning: true, posterResults: [] });
  persistRunState();
  await runPostingLoop();
}

async function runPostingLoop() {
  if (!runState || !posterRunning || stopRequested) return;
  const config = runState.config;
  const results = runState.results;
  const total = config.groups.length;

  // Planner removed: start immediately.

  // Use a single worker tab in the background (FewFeed-like).
  // Reuse the same tab for all groups to avoid opening dozens of tabs.
  let workerTab = null;
  try {
    workerTab = await getOrCreateWorkerTab(config);
  } catch (e) {
    // If we can't create a worker tab, we can't proceed.
    posterRunning = false;
    chrome.storage.local.set({ posterRunning: false });
    broadcastToApp({ action: 'postingFinished', results, total, notifyEnd: config.notifyEnd });
    return;
  }

  for (let i = runState.index; i < total; i++) {
    if (stopRequested) break;

    resetDailyCounterIfNeeded();
    if (config.dailyLimitEnabled && runState.dailySuccessCount >= config.dailySuccessLimit) {
      const resumeAt = computeNextDailyResume(config.dailyResumeTime || '09:00');
      runState.plannedStartAt = resumeAt;
      persistRunState();
      scheduleResume(resumeAt, 'Pausa diaria por limite alcanzado');
      return;
    }

    runState.index = i;
    const group = config.groups[i];
    broadcastToApp({ action: 'progressUpdate', results: [...results], total, countdown: 0 });
    const postText = config.useSpintax ? spinText(config.text) : config.text;
    let success = false, error = '', log = [];
    let pausedBeforePublish = false;

    try {
      await navigateWorker(workerTab.id, group.url);
      await sleep(6000);
      if (stopRequested) break;

      const imagesToPass = (config.images || []).map(img => ({
        dataUrl: img.dataUrl,
        name: img.name,
        type: img.type
      }));
      await chrome.storage.local.set({ fartmily_pending_images: imagesToPass });

      const injResult = await withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: workerTab.id },
          func: fbPostInPage,
          args: [postText, imagesToPass.length, PAUSE_BEFORE_PUBLISH, group.name, i]
        }),
        60000,
        'Automation timeout (grupo sin respuesta)'
      );

      const res = injResult?.[0]?.result;
      success = res?.success === true;
      error   = res?.error || (success ? '' : 'Sin resultado');
      log     = res?.log   || [];
      if (res?.pausedBeforePublish) {
        pausedBeforePublish = true;
        stopRequested = true;
        success = false;
        error = res?.error || 'Pausa de seguridad antes de publicar';
      }
    } catch (e) {
      error = e.message || 'Error de inyeccion';
      success = false;
    }

    results.push({ name: group.name, url: group.url, success, error, log });
    if (success) runState.dailySuccessCount++;
    runState.index = i + 1;
    chrome.storage.local.set({ posterResults: results });
    persistRunState();
    broadcastToApp({ action: 'progressUpdate', results: [...results], total, countdown: 0 });

    if (pausedBeforePublish) {
      // Stop immediately after pause detection (avoid any remaining scheduling).
      break;
    }

    if (i < total - 1 && !stopRequested) {
      const waitSec = computeWaitSeconds(config);
      for (let left = waitSec; left > 0; left--) {
        if (stopRequested) break;
        broadcastToApp({ action: 'progressUpdate', results: [...results], total, countdown: left });
        await sleep(1000);
      }
    }
  }

  if (stopRequested) {
    posterRunning = false;
    chrome.storage.local.set({ posterRunning: false });
    broadcastToApp({ action: 'postingStopped' });
    return;
  }

  posterRunning = false;
  chrome.storage.local.remove(RUNSTATE_KEY);
  runState = null;
  chrome.storage.local.set({ posterRunning: false });
  broadcastToApp({ action: 'postingFinished', results, total, notifyEnd: config.notifyEnd });

  if (config.notifyEnd) {
    const ok = results.filter(r => r.success).length;
    chrome.notifications?.create({
      type: 'basic', iconUrl: 'icons/icon48.png',
      title: 'Irishka Group Master by SBS',
      message: 'Completado: ' + ok + '/' + results.length + ' posts publicados.'
    });
  }
}

function getOrCreateWorkerTab(config) {
  return new Promise((resolve, reject) => {
    const url = (config.groups && config.groups[0] && config.groups[0].url) ? config.groups[0].url : 'https://www.facebook.com/groups/';
    chrome.tabs.create({ url, active: config.bgTabsEnabled === false }, (tab) => {
      if (!tab || !tab.id) return reject(new Error('No se pudo crear la pestaña worker'));
      waitTabComplete(tab.id, 20000).then(() => resolve(tab)).catch(() => resolve(tab));
    });
  });
}

function navigateWorker(tabId, url) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { url, active: false }, () => {
      waitTabComplete(tabId, 20000).then(resolve).catch(resolve);
    });
  });
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

function persistRunState() {
  try {
    if (!runState) return;
    // Store the current loop state so MV3 sleep doesn't break "resume".
    chrome.storage.local.set({ [RUNSTATE_KEY]: {
      config: runState.config,
      results: runState.results,
      index: runState.index,
      dailySuccessCount: runState.dailySuccessCount,
      dailyKey: runState.dailyKey,
      startedOnce: runState.startedOnce,
      plannedStartAt: runState.plannedStartAt || null
    }});
  } catch (e) {}
}

function resetDailyCounterIfNeeded() {
  if (!runState) return;
  const nowKey = dayKey(Date.now());
  if (runState.dailyKey !== nowKey) {
    runState.dailyKey = nowKey;
    runState.dailySuccessCount = 0;
  }
}

function computeWaitSeconds(config) {
  if (config.timerEnabled) {
    const jitter = Math.floor(Math.random() * (config.timerVariation * 2 + 1)) - config.timerVariation;
    return Math.max(5, config.timerSeconds + jitter);
  }
  return 5;
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
  const now = new Date();
  const [hh, mm] = parseHHMM(hhmm);
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

function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function scheduleResume(whenMs, reason) {
  chrome.alarms.clear('fartmily_resume');
  chrome.alarms.create('fartmily_resume', { when: whenMs });
  const d = new Date(whenMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const msg = reason + ' · reanuda ' + d.toLocaleDateString() + ' ' + hh + ':' + mm;
  broadcastToApp({ action: 'plannerStatus', message: msg });
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
function broadcastToApp(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }

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

// Injected into Facebook page
async function fbPostInPage(text, imageCount, pauseBeforePublish, logGroupName, logIdx) {
  const log = [];
  const sendLiveLog = (m) => {
    try {
      chrome.runtime.sendMessage({
        action: 'sessionLogLine',
        idx: logIdx,
        group: logGroupName,
        line: m
      });
    } catch (e) {}
  };
  const pauseBeforePublishEffective = !!pauseBeforePublish; // Respeta flag pasado desde background.
  const W = (ms) => new Promise(r => setTimeout(r, ms));
  const L = (m) => {
    log.push(m);
    sendLiveLog(m);
    console.log("[Fartmily]", m);
  };
  // Load images from storage
  let images = [];
  if (imageCount > 0) {
    const stored = await new Promise(resolve =>
      chrome.storage.local.get("fartmily_pending_images", r => resolve(r.fartmily_pending_images || []))
    );
    images = stored;
  }

  const humanDelay = () => Math.floor(Math.random() * 40) + 20;
  const textForPost = text;
  const expectedCompactLen = String(textForPost || "").replace(/\s/g, "").length;

  async function openComposer() {
    const keywords = [
      // Spanish / Portuguese
      "escribe algo", "escribe un", "escribe", "en que estas pensando", "en qué estás pensando",
      "crea una publicacion", "crear publicacion", "crear publicación", "publicación", "publicar",
      // English
      "create a post", "create post", "new post", "write something", "what's on your mind", "what is on your mind",
      // Other
      "new discussion", "nueva discusion", "publica", "postear"
    ];

    const txt = (el) => (
      (el?.textContent || "") + " " +
      (el?.getAttribute?.("aria-label") || "") + " " +
      (el?.getAttribute?.("placeholder") || "")
    ).toLowerCase();

    // 1) Try clicking explicit “create post/new post” buttons first.
    const btns = Array.from(document.querySelectorAll('[role="button"],button'));
    for (const b of btns) {
      const t = txt(b);
      if (!keywords.some(k => t.includes(k))) continue;
      try { b.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
      if (!b.offsetParent) continue;
      L("Compositor encontrado (boton): " + t.slice(0, 40));
      b.click();
      return true;
    }

    // 2) Fallback: click any visible element matching keywords.
    const els = Array.from(document.querySelectorAll("[role=button],[role=textbox],[contenteditable]"));
    for (const el of els) {
      const t = txt(el);
      if (!keywords.some(k => t.includes(k))) continue;
      try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
      if (!el.offsetParent) continue;
      L("Compositor encontrado (fallback): " + t.slice(0, 40));
      el.click();
      return true;
    }

    // 3) aria-label contains fallback
    for (const kw of keywords) {
      const el = document.querySelector("[aria-label*='" + kw + "' i]");
      if (el) {
        try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
        if (!el.offsetParent) continue;
        L("Compositor aria: " + kw);
        el.click();
        return true;
      }
    }

    return false;
  }

  async function getEditor(maxMs) {
    function pickBestEditor(scope) {
      const candidates = Array.from((scope || document).querySelectorAll('[contenteditable="true"], [role="textbox"]'))
        .filter(el => el && el.offsetParent);
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
      if (lex && lex.offsetParent) { L("Lexical editor"); return lex; }
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
    if (!document.body.contains(ed) || !ed.offsetParent) {
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

  function hasMediaPreview(root) {
    const scope = root || document;
    return !!(
      scope.querySelector("img[src*='blob:']") ||
      scope.querySelector("img[src*='scontent']") ||
      scope.querySelector("[data-visualcompletion='media-vc-image']") ||
      scope.querySelector("[aria-label*='foto' i], [aria-label*='photo' i]")
    );
  }

  async function waitForMediaPreview(root, maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (hasMediaPreview(root)) return true;
      await W(500);
    }
    return false;
  }

  // Upload image(s): click photo button, set FileList, trigger React/native events
  async function uploadImage(imgs) {
    if (!imgs || !imgs.length) return false;
    const root = document.querySelector("[role=dialog]") || document;

    // Build blobs/files from base64
    const files = [];
    for (const img of imgs) {
      try {
        const blob = await fetch(img.dataUrl).then(r => r.blob());
        const file = new File([blob], img.name || "image.jpg", { type: blob.type || "image/jpeg" });
        files.push(file);
        L("Blob: " + (img.name || "image.jpg") + " " + blob.size + "b");
      } catch(e) {
        L("Error blob: " + e.message);
      }
    }
    if (!files.length) return false;

    // Click photo button to expand upload section
    L("Buscando boton Foto/Video...");
    const photoLabels = ["foto/video", "photo/video", "photo", "foto", "add photo", "agregar foto"];
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
    if (!photoBtn) { L("Boton foto no encontrado"); return false; }

    L("Clic en boton foto...");
    photoBtn.click();
    await W(3000);

    // Find file input
    const fi = root.querySelector("input[type=file][accept*='image']")
            || root.querySelector("input[type=file]")
            || document.querySelector("input[type=file][accept*='image']")
            || document.querySelector("input[type=file]");
    if (!fi) { L("input[type=file] no encontrado"); return false; }
    L("input[type=file] encontrado");

    // Try all known ways to trigger React's file handler
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));

    // Method 1: Override via prototype setter
    try {
      const nativeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      if (nativeDesc && nativeDesc.set) {
        nativeDesc.set.call(fi, dt.files);
      }
    } catch(e) {}

    // Method 2: defineProperty
    try {
      Object.defineProperty(fi, "files", { value: dt.files, configurable: true, writable: true });
    } catch(e) {}

    // Method 3: Find React's internal event handler via __reactProps
    // This is the key — find __reactPropsXXXXX key on the element
    const reactPropsKey = Object.keys(fi).find(k => k.startsWith("__reactProps"));
    if (reactPropsKey) {
      L("React props encontrado: " + reactPropsKey);
      const reactProps = fi[reactPropsKey];
      if (reactProps && reactProps.onChange) {
        L("Llamando React onChange directamente...");
        // Create a synthetic React event
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
        reactProps.onChange(syntheticEvent);
        if (await waitForMediaPreview(root, 9000)) {
          L("IMAGEN CARGADA via React props!");
          return true;
        }
        L("React onChange llamado, sin preview");
      } else {
        L("React props encontrado pero sin onChange. Keys: " + Object.keys(reactProps || {}).slice(0,5).join(","));
      }
    } else {
      L("No se encontro __reactProps en el input");
      // Log all keys that start with __ to see what React keys exist
      const reactKeys = Object.keys(fi).filter(k => k.startsWith("__react")).slice(0, 5);
      L("React keys en input: " + (reactKeys.join(", ") || "ninguno"));
    }

    // Method 4: fire all events as last attempt
    fi.dispatchEvent(new Event("input",  { bubbles: true }));
    fi.dispatchEvent(new Event("change", { bubbles: true }));
    if (await waitForMediaPreview(root, 10000)) { L("Imagen via events!"); return true; }

    L("No se detecto preview de imagen");
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
    await W(2000);
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
      const imgOk = await uploadImage(images);
      L("Imagen: " + (imgOk ? "ok" : "fallo"));
      if (!imgOk) return { success: false, error: "No se pudo cargar la imagen en Facebook", log };
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
