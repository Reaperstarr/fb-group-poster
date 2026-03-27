// ═══════════════════════════════════════════
// Irishka Group Master by SBS — popup.js (CSP compliant)
// ═══════════════════════════════════════════

'use strict';

let groups = [];
let images = [];
let isRunning = false;
let cdInterval = null;
let timerUnit = 'min'; // 'sec' or 'min'
let spPreviewOpen = false;
let checkTimer = null;

// ─── INIT ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindAll();
  loadGroups();
  updateTimerUI();
  checkFB();
  checkTimer = setInterval(checkFB, 6000);

  chrome.storage.local.get(['posterRunning', 'posterConfig', 'posterResults'], d => {
    if (d.posterRunning && d.posterConfig) {
      setRunning(true);
      initSteps(d.posterConfig.groups);
      if (d.posterResults?.length) updateProgress(d.posterResults, d.posterConfig.groups.length, 0);
    }
  });
});

// ─── BIND ALL EVENT LISTENERS ────────────────
function bindAll() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => goTab(t.dataset.tab))
  );

  // Toolbar buttons
  document.getElementById('tb-bold').addEventListener('click', () => execCmd('bold'));
  document.getElementById('tb-italic').addEventListener('click', () => execCmd('italic'));
  document.getElementById('tb-underline').addEventListener('click', () => execCmd('underline'));
  document.getElementById('tb-ul').addEventListener('click', () => execCmd('insertUnorderedList'));
  document.getElementById('tb-ol').addEventListener('click', () => execCmd('insertOrderedList'));
  document.getElementById('tb-center').addEventListener('click', () => execCmd('justifyCenter'));
  document.getElementById('tb-link').addEventListener('click', insertLink);
  document.getElementById('tb-clear').addEventListener('click', () => execCmd('removeFormat'));

  // Emoji buttons — delegate via data-emoji
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => insertEmoji(btn.dataset.emoji));
  });

  // Spintax buttons
  document.getElementById('spInsert').addEventListener('click', spInsertTemplate);
  document.getElementById('spPreview').addEventListener('click', toggleSpPreview);
  document.getElementById('spRespin').addEventListener('click', refreshSpPreview);

  // Image upload area
  document.getElementById('imgUploadArea').addEventListener('click', () => {
    document.getElementById('imgInput').click();
  });
  document.getElementById('imgInput').addEventListener('change', handleImages);

  // Editor char count
  document.getElementById('editor').addEventListener('input', () => {
    updateCC();
    if (spPreviewOpen) refreshSpPreview();
  });

  // Groups tab — open FB
  document.getElementById('btnOpenFb').addEventListener('click', openFacebook);

  // Scan button
  document.getElementById('btnScan').addEventListener('click', scanGroups);

  // Groups controls
  document.getElementById('btnSelectAll').addEventListener('click', selectAll);
  document.getElementById('btnDeselectAll').addEventListener('click', deselectAll);
  document.getElementById('btnClearAll').addEventListener('click', clearAll);
  document.getElementById('btnAddGroup').addEventListener('click', addGroup);
  document.getElementById('groupUrl').addEventListener('keydown', e => { if (e.key === 'Enter') addGroup(); });

  // Timer
  document.getElementById('timerEnabled').addEventListener('change', updateTimerUI);
  document.getElementById('timerSec').addEventListener('input', updateTimerUI);
  document.getElementById('timerVar').addEventListener('input', updateTimerUI);

  // Timer unit selector
  document.getElementById('unitSec').addEventListener('click', () => setTimerUnit('sec'));
  document.getElementById('unitMin').addEventListener('click', () => setTimerUnit('min'));

  // Footer
  document.getElementById('btnReset').addEventListener('click', resetAll);
  document.getElementById('btnStart').addEventListener('click', startPosting);
  document.getElementById('btnStop').addEventListener('click', stopPosting);
}

// ─── TABS ─────────────────────────────────────
function goTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

// ─── FB CONNECTION CHECK ──────────────────────
async function checkFB() {
  setPill('checking', 'Verificando...');

  const tabs = await qTabs(['*://www.facebook.com/*', '*://web.facebook.com/*']);

  if (!tabs.length) {
    setPill('offline', 'Facebook cerrado');
    showConnected(false);
    return;
  }

  const tab = tabs[0];

  let loginInfo = null;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectFBLogin
    });
    loginInfo = res?.[0]?.result;
  } catch (err) {
    setPill('offline', 'No se pudo verificar');
    showConnected(false);
    return;
  }

  if (loginInfo && loginInfo.loggedIn) {
    const name = loginInfo.name || 'Usuario de Facebook';
    setPill('online', name);
    document.getElementById('fbUserName').textContent = name;
    document.getElementById('fbUserSub').textContent = '✅ Conectado · ' + tab.url.split('/')[2];
    showConnected(true);
  } else {
    setPill('offline', loginInfo?.reason || 'No logueado');
    showConnected(false);
  }
}

// Runs INSIDE the Facebook page — must be self-contained, no closures
function detectFBLogin() {
  try {
    // If login form exists → not logged in
    if (document.querySelector('#email, input[name="email"], [data-testid="royal_email"]')) {
      return { loggedIn: false, reason: 'Formulario de login visible' };
    }
    if (window.location.pathname.startsWith('/login')) {
      return { loggedIn: false, reason: 'Página de login' };
    }

    // Try to find user name from nav bar
    function cleanText(t) {
      return t && t.trim().length > 1 && t.trim().length < 60
          && !t.includes('Facebook') && !/^\d/.test(t.trim())
          && !t.includes('·') && !t.toLowerCase().includes('search')
          && !t.toLowerCase().includes('buscar');
    }

    // Method 1: profile / account links with name spans
    const profileSels = [
      'a[href*="/me"] span', 'a[aria-label*="perfil"] span',
      'a[aria-label*="profile"] span', 'a[aria-label*="cuenta"] span',
      '[data-testid="blue_bar_profile_link"] span'
    ];
    for (const sel of profileSels) {
      const el = document.querySelector(sel);
      if (el && cleanText(el.textContent)) return { loggedIn: true, name: el.textContent.trim() };
    }

    // Method 2: scan banner / nav for a name-like span
    const nav = document.querySelector('[role="banner"], [data-pagelet="NavBar"], header');
    if (nav) {
      const spans = nav.querySelectorAll('span');
      for (const s of spans) {
        const t = s.textContent?.trim();
        if (cleanText(t) && t.split(' ').length >= 1 && t.split(' ').length <= 5) {
          return { loggedIn: true, name: t };
        }
      }
    }

    // Method 3: page has main content → user is logged in (can't read name)
    const hasMain = document.querySelector(
      '[role="main"], [data-pagelet="GroupFeed"], [data-pagelet="ProfileTimeline"], [data-pagelet="Feed"]'
    );
    if (hasMain) return { loggedIn: true, name: null };

    // Method 4: cookies contain c_user (Facebook user ID cookie)
    if (document.cookie.includes('c_user=')) return { loggedIn: true, name: null };

    return { loggedIn: false, reason: 'Sin sesión detectada' };
  } catch (e) {
    return { loggedIn: false, reason: e.message };
  }
}

// Runs INSIDE the Facebook page — extracts group links
function extractGroupLinks() {
  const results = [];
  const seen = new Set();
  const EXCLUDED = new Set([
    'feed','discover','create','search','joins','highlights',
    'videos','photos','members','events','files','store',
    'about','rooms','bookmark','notifications','invite'
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

// ─── OPEN FACEBOOK ────────────────────────────
function openFacebook() {
  chrome.tabs.create({ url: 'https://www.facebook.com/', active: true }, () => {
    setPill('checking', 'Abriendo...');
    setTimeout(checkFB, 4000);
  });
}

// ─── SCAN GROUPS ─────────────────────────────
async function scanGroups() {
  const btn = document.getElementById('btnScan');
  const icon = document.getElementById('scanIcon');
  const txt = document.getElementById('scanTxt');
  const log = document.getElementById('scanLog');

  btn.disabled = true;
  icon.textContent = '⏳';
  txt.textContent = 'Escaneando...';
  setLog(log, 'inf', 'Buscando pestaña de Facebook...');

  try {
    const tabs = await qTabs(['*://www.facebook.com/*', '*://web.facebook.com/*']);

    if (!tabs.length) {
      setLog(log, 'err', '❌ Abre Facebook primero en otra pestaña.');
      resetScanBtn(btn, icon, txt); return;
    }

    const fbTab = tabs[0];
    setLog(log, 'inf', 'Navegando a tus grupos...');

    // Navigate to groups feed
    await new Promise(resolve => {
      chrome.tabs.update(fbTab.id, { url: 'https://www.facebook.com/groups/feed/', active: true }, t => {
        const onLoad = (tabId, info) => {
          if (tabId === t.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(onLoad);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onLoad);
        setTimeout(resolve, 9000);
      });
    });

    await sleep(3000); // let React render
    setLog(log, 'inf', 'Leyendo grupos...');

    let res = await chrome.scripting.executeScript({ target: { tabId: fbTab.id }, func: extractGroupLinks });
    let found = res?.[0]?.result || [];

    if (found.length < 4) {
      setLog(log, 'inf', `${found.length} encontrados. Cargando más...`);
      await chrome.scripting.executeScript({ target: { tabId: fbTab.id }, func: () => window.scrollTo(0, 3000) });
      await sleep(2500);
      res = await chrome.scripting.executeScript({ target: { tabId: fbTab.id }, func: extractGroupLinks });
      found = res?.[0]?.result || [];
    }

    let added = 0;
    found.forEach(g => {
      if (!groups.find(e => e.url === g.url)) { groups.push({ ...g, selected: true }); added++; }
    });

    saveGroups();
    renderGroups();

    if (!found.length) {
      setLog(log, 'err', '⚠️ Sin resultados. Ve a facebook.com/groups y escanea de nuevo.');
    } else {
      setLog(log, 'ok', `✅ ${found.length} grupos · ${added} nuevos agregados.`);
    }

  } catch (e) {
    setLog(log, 'err', '❌ ' + (e.message || 'Error desconocido'));
  }

  resetScanBtn(btn, icon, txt);
}

function resetScanBtn(btn, icon, txt) {
  btn.disabled = false;
  icon.textContent = '🔍';
  txt.textContent = 'Leer mis grupos desde Facebook';
}

function setLog(el, cls, msg) { el.className = 'scan-log ' + cls; el.textContent = msg; }

// ─── GROUPS CRUD ──────────────────────────────
function loadGroups() {
  chrome.storage.local.get('fbGroups', d => { groups = d.fbGroups || []; renderGroups(); });
}
function saveGroups() { chrome.storage.local.set({ fbGroups: groups }); }

function addGroup() {
  const inp = document.getElementById('groupUrl');
  let url = inp.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  if (!url.includes('facebook.com/groups/')) {
    alert('URL inválida. Ej: https://www.facebook.com/groups/mi-grupo'); return;
  }
  const m = url.match(/groups\/([^/?#\s]+)/);
  if (!m) { alert('No se pudo detectar el ID del grupo.'); return; }
  const cleanUrl = 'https://www.facebook.com/groups/' + m[1];
  if (groups.find(g => g.url === cleanUrl)) { alert('Este grupo ya está en la lista.'); return; }
  groups.push({ url: cleanUrl, name: m[1].replace(/[-_]/g, ' '), selected: true });
  saveGroups(); renderGroups(); inp.value = '';
}

function removeGroup(i) { groups.splice(i, 1); saveGroups(); renderGroups(); }
function toggleGroup(i) { groups[i].selected = !groups[i].selected; saveGroups(); }
function selectAll() { groups.forEach(g => g.selected = true); saveGroups(); renderGroups(); }
function deselectAll() { groups.forEach(g => g.selected = false); saveGroups(); renderGroups(); }
function clearAll() {
  if (!groups.length || !confirm('¿Eliminar todos los grupos?')) return;
  groups = []; saveGroups(); renderGroups();
}

function renderGroups() {
  const list = document.getElementById('groupsList');
  document.getElementById('groupCount').textContent = groups.length;
  if (!groups.length) {
    list.innerHTML = '<div class="empty-note">Sin grupos todavía.<br>Usa el escáner o agrega manualmente abajo.</div>';
    return;
  }
  list.innerHTML = '';
  groups.forEach((g, i) => {
    // Build DOM safely — no inline handlers
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

    info.appendChild(nameEl);
    info.appendChild(urlEl);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.title = 'Eliminar';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => removeGroup(i));

    item.appendChild(cb);
    item.appendChild(info);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

// ─── EDITOR ───────────────────────────────────
function execCmd(cmd, v = null) {
  document.getElementById('editor').focus();
  document.execCommand(cmd, false, v);
  updateCC();
}
function insertLink() {
  const u = prompt('URL del enlace:');
  if (u) execCmd('createLink', u);
}
function insertEmoji(e) {
  document.getElementById('editor').focus();
  document.execCommand('insertText', false, e);
  updateCC();
}
function updateCC() {
  const n = (document.getElementById('editor').innerText || '').length;
  const el = document.getElementById('charCount');
  el.textContent = n + ' caracteres';
  el.className = 'char-count' + (n > 60000 ? ' over' : n > 50000 ? ' warn' : '');
}

// ─── IMAGES ───────────────────────────────────
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
    rm.textContent = '✕';
    rm.addEventListener('click', () => removeImage(i));

    wrap.appendChild(im);
    wrap.appendChild(rm);
    p.appendChild(wrap);
  });
}

// ─── TIMER UI ─────────────────────────────────
function setTimerUnit(unit) {
  timerUnit = unit;
  const secBtn = document.getElementById('unitSec');
  const minBtn = document.getElementById('unitMin');
  secBtn.classList.toggle('active', unit === 'sec');
  minBtn.classList.toggle('active', unit === 'min');

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
  document.getElementById('timerVarVal').textContent = '±' + v + u;

  const minVal = Math.max(0, val - v);
  const maxVal = val + v;
  document.getElementById('tMin').textContent = minVal;
  document.getElementById('tMax').textContent = maxVal;

  const lbl = timerUnit === 'min' ? 'min' : 'seg';
  document.getElementById('tMinLbl').textContent = lbl + ' mínimo';
  document.getElementById('tMaxLbl').textContent = lbl + ' máximo';
}

// ─── START / STOP ─────────────────────────────
async function startPosting() {
  const text = document.getElementById('editor').innerText.trim();
  if (!text) { alert('Escribe un mensaje primero.'); return; }
  const sel = groups.filter(g => g.selected);
  if (!sel.length) { alert('Selecciona al menos un grupo.'); return; }

  const config = {
    // Apply spintax — each group gets a unique spin
    _rawText: document.getElementById('editor').innerText,
    _rawHtml: document.getElementById('editor').innerHTML,
    html: document.getElementById('editor').innerHTML,
    text,           // will be re-spun per group in background
    useSpintax: countSpinGroups(document.getElementById('editor').innerText) > 0,
    images,
    groups: sel,
    timerEnabled: document.getElementById('timerEnabled').checked,
    timerSeconds: timerUnit === 'min' ? +document.getElementById('timerSec').value * 60 : +document.getElementById('timerSec').value,
    timerVariation: timerUnit === 'min' ? +document.getElementById('timerVar').value * 60 : +document.getElementById('timerVar').value,
    notifyEnd: document.getElementById('notifyEnd').checked
  };

  chrome.storage.local.set({ posterConfig: config, posterRunning: true, posterResults: [] });
  setRunning(true);
  goTab('progress');
  initSteps(sel);
  chrome.runtime.sendMessage({ action: 'startPosting', config });
}

function stopPosting() {
  chrome.runtime.sendMessage({ action: 'stopPosting' });
  setRunning(false);
}

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
  if (isRunning && !confirm('¿Detener el proceso?')) return;
  stopPosting();
  document.getElementById('editor').innerHTML = '';
  images = []; renderImgs(); updateCC(); initSteps([]);
}

// ─── PROGRESS ─────────────────────────────────
function initSteps(grps) {
  const el = document.getElementById('progSteps');
  document.getElementById('progLabel').textContent = grps.length ? 'En proceso...' : 'Sin iniciar';
  document.getElementById('progFrac').textContent = `0/${grps.length}`;
  document.getElementById('progBar').style.width = '0%';
  if (!grps.length) {
    el.innerHTML = '<div class="empty-note">Inicia el proceso para ver el estado.</div>';
    return;
  }
  el.innerHTML = '';
  grps.forEach((g, i) => {
    const d = document.createElement('div');
    d.className = 'step-item pending';
    d.id = 'step-' + i;
    const icon = document.createElement('span'); icon.textContent = '⏳';
    const name = document.createElement('span'); name.textContent = g.name;
    d.appendChild(icon); d.appendChild(name);
    el.appendChild(d);
  });
}

function updateProgress(results, total, countdown) {
  const done = results.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById('progFrac').textContent = `${done}/${total}`;
  document.getElementById('progBar').style.width = pct + '%';
  document.getElementById('progLabel').textContent = (done === total && total) ? '✅ Completado' : `Publicando... ${pct}%`;
  const rb = document.getElementById('runBarText');
  if (rb) rb.textContent = `Publicando grupo ${Math.min(done + 1, total)} de ${total}...`;

  results.forEach((r, i) => {
    const el = document.getElementById('step-' + i);
    if (!el) return;
    el.className = 'step-item ' + (r.success ? 'done' : 'error');
    el.innerHTML = '';
    const icon = document.createElement('span'); icon.textContent = r.success ? '✅' : '❌';
    const txt = document.createElement('span'); txt.textContent = r.name + ' — ' + (r.success ? 'Publicado' : (r.error || 'Error'));
    el.appendChild(icon); el.appendChild(txt);
  });

  if (done < total) {
    const cur = document.getElementById('step-' + done);
    if (cur) {
      const prevName = cur.querySelector('span:last-child')?.textContent || '';
      cur.className = 'step-item current';
      cur.innerHTML = '';
      const i2 = document.createElement('span'); i2.textContent = '⏳';
      const t2 = document.createElement('span'); t2.textContent = prevName + ' — publicando...';
      cur.appendChild(i2); cur.appendChild(t2);
    }
  }

  const cdBox = document.getElementById('cdBox');
  if (countdown > 0 && done < total) {
    cdBox.style.display = 'block';
    startCD(countdown);
  } else {
    cdBox.style.display = 'none';
  }
}

function startCD(sec) {
  if (cdInterval) clearInterval(cdInterval);
  let r = sec;
  document.getElementById('cdNum').textContent = r;
  cdInterval = setInterval(() => {
    r--;
    document.getElementById('cdNum').textContent = r;
    if (r <= 0) {
      clearInterval(cdInterval); cdInterval = null;
      document.getElementById('cdBox').style.display = 'none';
    }
  }, 1000);
}

// ─── MESSAGES FROM BACKGROUND ─────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'progressUpdate') updateProgress(msg.results, msg.total, msg.countdown || 0);
  if (msg.action === 'postingFinished') {
    setRunning(false);
    updateProgress(msg.results, msg.total, 0);
    document.getElementById('progLabel').textContent = '✅ ¡Todo publicado!';
  }
  if (msg.action === 'postingStopped') setRunning(false);
});


// ─── SPINTAX ENGINE ───────────────────────────

function spinText(text) {
  let result = text;
  let maxPasses = 20;
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
  const editor = document.getElementById('editor');
  editor.focus();
  document.execCommand('insertText', false, '{opción1|opción2|opción3}');
  updateCC();
  if (spPreviewOpen) refreshSpPreview();
}

function toggleSpPreview() {
  spPreviewOpen = !spPreviewOpen;
  const wrap = document.getElementById('spintaxPreviewWrap');
  const hint = document.getElementById('spHint');
  const btn = document.getElementById('spPreview');
  wrap.style.display = spPreviewOpen ? 'block' : 'none';
  hint.style.display = spPreviewOpen ? 'none' : 'block';
  btn.classList.toggle('sp-highlight', spPreviewOpen);
  btn.textContent = spPreviewOpen ? '👁 Cerrar vista' : '👁 Vista previa';
  if (spPreviewOpen) refreshSpPreview();
}

function refreshSpPreview() {
  const raw = document.getElementById('editor').innerText || '';
  const body = document.getElementById('spintaxPreviewBody');
  const label = document.getElementById('spVariantLabel');
  if (!raw.trim()) {
    body.innerHTML = '<span style="color:var(--muted)">El editor está vacío...</span>';
    label.textContent = '';
    return;
  }
  const spinCount = countSpinGroups(raw);
  label.textContent = spinCount > 0 ? spinCount + ' grupo(s) de variación' : 'Sin spintax';
  if (spinCount === 0) {
    body.textContent = raw;
    return;
  }
  // Apply spin with highlights
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

// ─── HELPERS ──────────────────────────────────
function qTabs(patterns) { return new Promise(r => chrome.tabs.query({ url: patterns }, r)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function showConnected(on) {
  document.getElementById('stateOff').style.display = on ? 'none' : 'block';
  document.getElementById('stateOn').style.display = on ? 'block' : 'none';
}
function setPill(cls, name) {
  document.getElementById('connPill').className = 'conn-pill ' + cls;
  document.getElementById('connName').textContent = name;
}
