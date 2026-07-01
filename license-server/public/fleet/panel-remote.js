/**
 * Irishka Fleet — essential remote panel (loaded after panel.js core helpers exist in closure).
 * Patches FleetPanel API on window.__fleetRemote.
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  function postPreviewLine(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.postsPreview) || !snapshot.postsPreview.length) {
      return '';
    }
    const active = snapshot.postsPreview.find((p) => p.active) || snapshot.postsPreview[snapshot.postIndex || 0];
    if (!active?.preview) return '';
    const idx = (snapshot.postIndex || 0) + 1;
    const total = snapshot.totalPosts || snapshot.postsPreview.length;
    return `Post ${idx}/${total}: ${active.preview}`;
  }

  function groupsLine(snapshot) {
    const g = snapshot?.groupsSummary;
    if (!g) return '';
    return `${g.selected || 0}/${g.total || 0} grupos · ${g.verified || 0} verificados`;
  }

  function remotePanelHtml(inst, state) {
    const id = escapeAttr(inst.deviceId);
    const snap = state?.remoteSnapshot || inst.remoteSnapshot || {};
    const posts = state?.posts || snap.postsPreview || [];
    const groups = state?.groups || [];
    const jq = state?.joinQueue || snap.joinQueue || {};
    const postsList = posts.length
      ? posts.map((p, i) => {
          const active = i === (snap.postIndex || 0) && inst.state === 'posting';
          return `<li class="remote-post${active ? ' remote-post--active' : ''}">
            <span class="remote-post__idx">${i + 1}</span>
            <span class="remote-post__text">${escapeHtml(p.preview || p.text || '')}</span>
            ${p.hasImages ? '<span class="remote-post__img" title="Con imagen">🖼</span>' : ''}
          </li>`;
        }).join('')
      : '<li class="remote-empty">Sin posts en cola</li>';

    const groupsList = groups.length
      ? groups.slice(0, 80).map((g) => {
          const flags = [
            g.selected ? '✓' : '○',
            g.canPost === true ? '🟢' : (g.canPost === false ? '🔴' : '🟡'),
          ].join(' ');
          return `<label class="remote-group">
            <input type="checkbox" class="remote-group__check" data-group-url="${escapeAttr(g.url)}" ${g.selected ? 'checked' : ''}>
            <span class="remote-group__name" title="${escapeAttr(g.url)}">${escapeHtml(g.name || g.url)}</span>
            <span class="remote-group__flags">${flags}</span>
          </label>`;
        }).join('')
      : '<p class="remote-empty">Sin grupos — escanea desde Irishka o pulsa Cargar grupos</p>';

    const joinLine = jq.active
      ? `Join activo: ${jq.cursor || 0}/${jq.total || 0} · hoy ${jq.joinedToday || 0}/${jq.dailyMax || 5}`
      : 'Join inactivo';

    return `
      <div class="remote-panel" data-device="${id}">
        <section class="remote-section">
          <h3>Posts activos</h3>
          <ul class="remote-posts">${postsList}</ul>
        </section>

        <section class="remote-section remote-section--compose">
          <h3>Nuevo post (spintax)</h3>
          <textarea class="remote-textarea" id="remotePostText" rows="4" placeholder="{Hola|Buenos días} — tu mensaje con spintax…"></textarea>
          <label class="remote-file">
            <span>Imagen (opcional)</span>
            <input type="file" id="remotePostImage" accept="image/*">
          </label>
          <button type="button" class="btn btn--ok remote-send-post" data-cmd="push_post" data-target="${id}">▶ Publicar en esta Irishka</button>
        </section>

        <section class="remote-section">
          <h3>Grupos <span class="remote-muted">${escapeHtml(groupsLine(snap))}</span></h3>
          <div class="remote-group-actions">
            <button type="button" class="btn btn--ghost btn-sm" data-cmd="scan_groups" data-target="${id}">🔍 Cargar grupos</button>
            <button type="button" class="btn btn--ghost btn-sm" data-cmd="verify_groups" data-target="${id}" data-scope="all">✅ Verificar todos</button>
            <button type="button" class="btn btn--ghost btn-sm" data-cmd="verify_groups" data-target="${id}" data-scope="not_verified">🟡 No verificados</button>
            <button type="button" class="btn btn--ghost btn-sm" id="remoteSaveGroups" data-target="${id}">💾 Guardar selección</button>
          </div>
          <div class="remote-groups">${groupsList}</div>
        </section>

        <section class="remote-section">
          <h3>Join queue</h3>
          <p class="remote-muted">${escapeHtml(joinLine)}</p>
          <div class="remote-group-actions">
            <button type="button" class="btn btn--ok btn-sm" data-cmd="start_join" data-target="${id}">▶ Iniciar join</button>
            <button type="button" class="btn btn--warn btn-sm" data-cmd="stop_join" data-target="${id}">⏹ Parar join</button>
          </div>
        </section>

        <section class="remote-section remote-section--actions">
          <button type="button" class="btn btn--ghost" data-cmd="open_app" data-target="${id}">🍀 Abrir Irishka (esta PC)</button>
          <button type="button" class="btn btn--ghost" data-cmd="refresh_remote" data-target="${id}">↻ Actualizar estado</button>
        </section>
      </div>`;
  }

  window.__fleetRemote = {
    postPreviewLine,
    groupsLine,
    remotePanelHtml,
    escapeHtml,
    escapeAttr,
  };
})();
