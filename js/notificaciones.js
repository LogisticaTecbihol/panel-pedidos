// ── Notificaciones in-app (bandeja + envío de PDFs entre usuarios) ──
// Depende de: _sb (shared.js), AUTH (auth.js), escHtml/showToast (shared.js).
// Tabla y políticas en supabase/notificaciones.sql.

var NOTIF = (function() {
  var BUCKET = 'pedidos-adjuntos';
  var PREFIX = 'notificaciones';
  var MOD_LABEL = {
    pedidos:      '📋 Pedido',
    devoluciones: '🔄 Devolución',
    cambios:      '🔁 Cambio',
    muestras:     '🧪 Muestra',
    ordenes:      '🛒 Orden de compra'
  };

  var _uid = null;
  var _bellBtn = null;
  var _badge = null;
  var _drop = null;
  var _dropOpen = false;
  var _channel = null;
  var _cache = [];
  var _stylesInjected = false;
  var _directorioPromise = null;

  // Directorio de usuarios (id, nombre, email, rol, activo) resuelto vía
  // RPC SECURITY DEFINER — la RLS estricta de `usuarios` sólo deja a un
  // no-admin verse a sí mismo. Cachea la promesa por sesión.
  function _loadDirectorio() {
    if (_directorioPromise) return _directorioPromise;
    _directorioPromise = _sb.rpc('list_usuarios_directorio').then(function(res) {
      if (res.error) {
        console.error('NOTIF list_usuarios_directorio', res.error);
        _directorioPromise = null;
        return [];
      }
      return res.data || [];
    });
    return _directorioPromise;
  }

  // ────────────────────────────────────────────────────────────
  // Estilos (inyectados una sola vez)
  // ────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var css = '' +
      '.notif-inbox-bell { position: relative; background: rgba(255,255,255,0.15); border: none; color: white; width: 34px; height: 34px; border-radius: 50%; cursor: pointer; font-size: 1.05rem; display: inline-flex; align-items: center; justify-content: center; margin-right: 6px; transition: background .2s; }' +
      '.notif-inbox-bell:hover { background: rgba(255,255,255,0.28); }' +
      '.notif-inbox-badge { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; background: #e74c3c; color: white; border-radius: 9px; font-size: 0.66rem; font-weight: 800; line-height: 18px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.3); display: none; }' +
      '.notif-inbox-badge.on { display: inline-block; }' +
      '.notif-inbox-drop { position: fixed; z-index: 1500; background: white; border: 1px solid #cbd5e0; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.22); width: 360px; max-height: 480px; overflow: hidden; display: flex; flex-direction: column; font-size: 0.86rem; color: #2d3748; }' +
      '.notif-inbox-hdr { padding: 11px 14px; background: #f7fafc; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }' +
      '.notif-inbox-hdr .t { font-weight: 700; color: #1a5276; font-size: 0.9rem; }' +
      '.notif-inbox-hdr .mark { background: none; border: none; color: #1a5276; font-size: 0.75rem; font-weight: 600; cursor: pointer; padding: 4px 8px; border-radius: 5px; }' +
      '.notif-inbox-hdr .mark:hover { background: #edf2f7; }' +
      '.notif-inbox-hdr .mark[disabled] { color: #a0aec0; cursor: default; }' +
      '.notif-inbox-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; max-height: 400px; }' +
      '.notif-inbox-list li { border-bottom: 1px solid #edf2f7; }' +
      '.notif-inbox-list li:last-child { border-bottom: none; }' +
      '.notif-inbox-list button.item { display: block; width: 100%; text-align: left; padding: 10px 14px; border: none; background: white; cursor: pointer; transition: background .12s; }' +
      '.notif-inbox-list button.item:hover { background: #f7fafc; }' +
      '.notif-inbox-list button.item.unread { background: #ebf5fb; }' +
      '.notif-inbox-list button.item.unread:hover { background: #d8ecf7; }' +
      '.notif-inbox-list .row1 { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 0.85rem; color: #2d3748; }' +
      '.notif-inbox-list .row1 .dot { width: 8px; height: 8px; border-radius: 50%; background: #e74c3c; display: none; }' +
      '.notif-inbox-list .row1.unread .dot { display: inline-block; }' +
      '.notif-inbox-list .row2 { font-size: 0.78rem; color: #4a5568; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
      '.notif-inbox-list .row3 { font-size: 0.72rem; color: #a0aec0; margin-top: 3px; display: flex; justify-content: space-between; }' +
      '.notif-inbox-empty { padding: 32px 16px; text-align: center; color: #718096; font-size: 0.84rem; }' +
      '.notif-inbox-ftr { display: block; padding: 10px 14px; background: #f7fafc; border-top: 1px solid #e2e8f0; text-align: center; font-weight: 700; color: #1a5276; text-decoration: none; font-size: 0.82rem; }' +
      '.notif-inbox-ftr:hover { background: #edf2f7; }' +

      // Modal Enviar
      '.notif-send-users { max-height: 260px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafbfc; }' +
      '.notif-send-users .u { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #edf2f7; cursor: pointer; font-size: 0.86rem; }' +
      '.notif-send-users .u:last-child { border-bottom: none; }' +
      '.notif-send-users .u:hover { background: #edf2f7; }' +
      '.notif-send-users .u input { margin: 0; cursor: pointer; }' +
      '.notif-send-users .u .name { font-weight: 600; color: #2d3748; }' +
      '.notif-send-users .u .rol { font-size: 0.72rem; color: #718096; margin-left: auto; text-transform: uppercase; letter-spacing: 0.3px; }' +
      '.notif-send-search { width: 100%; padding: 8px 12px; border: 1px solid #cbd5e0; border-radius: 7px; font-size: 0.86rem; outline: none; margin-bottom: 10px; }' +
      '.notif-send-search:focus { border-color: #1a5276; }' +
      '.notif-send-msg { width: 100%; padding: 8px 12px; border: 1px solid #cbd5e0; border-radius: 7px; font-size: 0.86rem; resize: vertical; min-height: 60px; outline: none; margin-top: 12px; font-family: inherit; }' +
      '.notif-send-msg:focus { border-color: #1a5276; }' +
      '.notif-send-label { display: block; font-size: 0.8rem; font-weight: 700; color: #1a5276; margin-bottom: 6px; }' +
      '';
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ────────────────────────────────────────────────────────────
  // Sonido de notificación (Web Audio API — sin archivos externos)
  // ────────────────────────────────────────────────────────────
  var _audioCtx = null;
  function _playNotifSound() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var ctx = _audioCtx;
      var now = ctx.currentTime;
      var gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

      // Tono 1 — nota alta
      var osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.connect(gain);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Tono 2 — nota más alta (intervalo de tercera)
      var osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1108, now + 0.15);
      osc2.connect(gain);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.35);

      // Tono 3 — cierre
      var osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(1320, now + 0.35);
      osc3.connect(gain);
      osc3.start(now + 0.35);
      osc3.stop(now + 0.6);
    } catch (e) {}
  }

  // ────────────────────────────────────────────────────────────
  // Bootstrap
  // ────────────────────────────────────────────────────────────
  async function mountBell(container) {
    if (!container) return;
    if (typeof AUTH === 'undefined' || !AUTH.getUser) return;
    var u = AUTH.getUser();
    if (!u) return;
    _uid = u.id;
    _injectStyles();

    if (_bellBtn && _bellBtn.parentElement) _bellBtn.parentElement.removeChild(_bellBtn);
    _bellBtn = document.createElement('button');
    _bellBtn.className = 'notif-inbox-bell';
    _bellBtn.title = 'Notificaciones';
    _bellBtn.innerHTML = '🔔<span class="notif-inbox-badge">0</span>';
    _badge = _bellBtn.querySelector('.notif-inbox-badge');
    _bellBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      _toggleDrop();
    });
    container.insertBefore(_bellBtn, container.firstChild);

    document.addEventListener('click', function(e) {
      if (!_dropOpen) return;
      if (_drop && (_drop === e.target || _drop.contains(e.target))) return;
      if (_bellBtn && (_bellBtn === e.target || _bellBtn.contains(e.target))) return;
      _closeDrop();
    });

    try { await loadUnread(); } catch (e) {}
    subscribe();
  }

  // ────────────────────────────────────────────────────────────
  // Datos
  // ────────────────────────────────────────────────────────────
  async function loadUnread() {
    if (!_uid) return;
    var res = await _sb.from('notificaciones')
      .select('id, created_at, de_usuario_id, modulo, referencia, titulo, mensaje, storage_path, leida')
      .eq('para_usuario_id', _uid)
      .order('created_at', { ascending: false })
      .limit(20);
    if (res.error) { console.error('NOTIF.loadUnread', res.error); return; }
    _cache = res.data || [];

    // Resolver nombres de emisores desde el directorio (RPC).
    var emisorIds = {};
    _cache.forEach(function(r) { if (r.de_usuario_id) emisorIds[r.de_usuario_id] = true; });
    if (Object.keys(emisorIds).length) {
      var dir = await _loadDirectorio();
      var byId = {};
      dir.forEach(function(x) { byId[x.id] = x; });
      _cache.forEach(function(r) {
        var em = byId[r.de_usuario_id];
        r._de_nombre = em ? (em.nombre || em.email || '—') : '—';
      });
    }
    _updateBadge();
    if (_dropOpen) _renderDrop();
  }

  function _updateBadge() {
    if (!_badge) return;
    var n = 0;
    _cache.forEach(function(r) { if (!r.leida) n++; });
    if (n > 0) {
      _badge.textContent = n > 99 ? '99+' : String(n);
      _badge.classList.add('on');
    } else {
      _badge.classList.remove('on');
    }
  }

  function subscribe() {
    if (!_uid || _channel) return;
    _channel = _sb.channel('notif-' + _uid)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: 'para_usuario_id=eq.' + _uid
      }, function() { _playNotifSound(); loadUnread(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notificaciones',
        filter: 'para_usuario_id=eq.' + _uid
      }, function() { loadUnread(); })
      .subscribe();
  }

  // ────────────────────────────────────────────────────────────
  // Dropdown
  // ────────────────────────────────────────────────────────────
  function _toggleDrop() {
    if (_dropOpen) _closeDrop(); else _openDrop();
  }
  function _openDrop() {
    if (!_drop) {
      _drop = document.createElement('div');
      _drop.className = 'notif-inbox-drop';
      document.body.appendChild(_drop);
    }
    _positionDrop();
    _renderDrop();
    _drop.style.display = 'flex';
    _dropOpen = true;
    loadUnread();
  }
  function _closeDrop() {
    if (!_drop) return;
    _drop.style.display = 'none';
    _dropOpen = false;
  }
  function _positionDrop() {
    if (!_drop || !_bellBtn) return;
    var r = _bellBtn.getBoundingClientRect();
    var w = 360;
    var left = Math.min(r.right - w, window.innerWidth - w - 12);
    if (left < 12) left = 12;
    _drop.style.top = (r.bottom + 8) + 'px';
    _drop.style.left = left + 'px';
  }
  window.addEventListener('resize', function() { if (_dropOpen) _positionDrop(); });
  window.addEventListener('scroll', function() { if (_dropOpen) _positionDrop(); }, true);

  function _renderDrop() {
    if (!_drop) return;
    var unread = _cache.filter(function(r) { return !r.leida; }).length;
    var hdr =
      '<div class="notif-inbox-hdr">' +
        '<span class="t">🔔 Notificaciones</span>' +
        '<button class="mark" ' + (unread ? '' : 'disabled') + '>Marcar todas leídas</button>' +
      '</div>';

    var body;
    if (!_cache.length) {
      body = '<div class="notif-inbox-empty">Sin notificaciones.<br><span style="font-size:0.76rem">Cuando alguien te envíe un PDF, aparecerá aquí.</span></div>';
    } else {
      body = '<ul class="notif-inbox-list">' + _cache.map(function(r, i) {
        var mod = MOD_LABEL[r.modulo] || r.modulo;
        var ref = r.referencia ? (' <span style="color:#718096;font-weight:500">#' + escHtml(r.referencia) + '</span>') : '';
        var msg = r.mensaje ? escHtml(r.mensaje) : '';
        var sub = 'De ' + escHtml(r._de_nombre || '—') + (msg ? ' · ' + msg : '');
        return '<li>' +
          '<button class="item ' + (r.leida ? '' : 'unread') + '" data-i="' + i + '">' +
            '<div class="row1 ' + (r.leida ? '' : 'unread') + '">' +
              '<span class="dot"></span>' +
              '<span>' + mod + ref + '</span>' +
            '</div>' +
            '<div class="row2">' + escHtml(r.titulo || '') + '</div>' +
            '<div class="row3"><span>' + sub + '</span><span>' + _fmtDate(r.created_at) + '</span></div>' +
          '</button>' +
        '</li>';
      }).join('') + '</ul>';
    }

    var ftr = '<a href="notificaciones.html" class="notif-inbox-ftr">Ver todas →</a>';
    _drop.innerHTML = hdr + body + ftr;

    var markBtn = _drop.querySelector('.mark');
    if (markBtn && !markBtn.disabled) {
      markBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        _markAllRead();
      });
    }
    _drop.querySelectorAll('button.item').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.stopPropagation();
        var i = Number(b.getAttribute('data-i'));
        openItem(_cache[i]);
      });
    });
  }

  function _fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return Math.floor(diff / 60) + ' min';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h';
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  }

  async function _markAllRead() {
    var ids = _cache.filter(function(r) { return !r.leida; }).map(function(r) { return r.id; });
    if (!ids.length) return;
    var res = await _sb.from('notificaciones')
      .update({ leida: true, leida_at: new Date().toISOString() })
      .in('id', ids);
    if (res.error) { showToast('Error: ' + res.error.message, '#e74c3c'); return; }
    _cache.forEach(function(r) { r.leida = true; });
    _updateBadge();
    _renderDrop();
  }

  // ────────────────────────────────────────────────────────────
  // Abrir un ítem
  // ────────────────────────────────────────────────────────────
  async function openItem(row) {
    if (!row) return;
    if (row.storage_path) {
      var sig = await _sb.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600);
      if (sig.error || !sig.data || !sig.data.signedUrl) {
        showToast('No se pudo abrir el PDF: ' + (sig.error ? sig.error.message : 'sin URL'), '#e74c3c');
        return;
      }
      window.open(sig.data.signedUrl, '_blank', 'noopener');
    }
    if (!row.leida) {
      var upd = await _sb.from('notificaciones')
        .update({ leida: true, leida_at: new Date().toISOString() })
        .eq('id', row.id);
      if (!upd.error) {
        row.leida = true;
        _updateBadge();
        if (_dropOpen) _renderDrop();
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // Subir PDF y notificar a destinatarios
  // meta: { modulo, referencia, titulo, mensaje, destinatarios: [uid, ...] }
  // ────────────────────────────────────────────────────────────
  async function compartirPDF(doc, meta) {
    if (!doc || typeof doc.output !== 'function') return { ok: false, error: 'doc inválido' };
    if (!meta || !meta.modulo || !meta.titulo) return { ok: false, error: 'meta incompleta' };
    var dests = (meta.destinatarios || []).filter(Boolean);
    if (!dests.length) return { ok: false, error: 'sin destinatarios' };
    if (!_uid && typeof AUTH !== 'undefined' && AUTH.getUser) {
      var u = AUTH.getUser(); if (u) _uid = u.id;
    }
    if (!_uid) return { ok: false, error: 'sin sesión' };

    var blob = doc.output('blob');
    var ym = new Date().toISOString().slice(0, 7);
    var errores = [];
    var ok = 0;

    for (var i = 0; i < dests.length; i++) {
      var destId = dests[i];
      var fileId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
      var path = PREFIX + '/' + destId + '/' + ym + '/' + fileId + '.pdf';
      var up = await _sb.storage.from(BUCKET).upload(path, blob, {
        contentType: 'application/pdf',
        upsert: false
      });
      if (up.error) { errores.push(up.error.message); continue; }

      var ins = await _sb.from('notificaciones').insert({
        para_usuario_id: destId,
        de_usuario_id: _uid,
        modulo: meta.modulo,
        referencia: meta.referencia || null,
        titulo: meta.titulo,
        mensaje: meta.mensaje || null,
        storage_path: path
      });
      if (ins.error) { errores.push(ins.error.message); continue; }
      ok++;
    }
    return { ok: ok > 0, sent: ok, errors: errores };
  }

  // ────────────────────────────────────────────────────────────
  // Modal Enviar a...
  // meta = { modulo, referencia, titulo, buildDoc: () => jsPDFDoc, onSent?: (result) => void }
  // ────────────────────────────────────────────────────────────
  async function openModalEnviar(meta) {
    if (!meta || typeof meta.buildDoc !== 'function') {
      showToast('Configuración de envío inválida', '#e74c3c'); return;
    }
    _injectStyles();
    if (!_uid && typeof AUTH !== 'undefined' && AUTH.getUser) {
      var u = AUTH.getUser(); if (u) _uid = u.id;
    }

    var overlay = document.createElement('div');
    overlay.className = 'overlay show';
    overlay.style.zIndex = 2000;
    overlay.innerHTML =
      '<div class="modal-box" style="max-width:520px" onclick="event.stopPropagation()">' +
        '<div class="mhdr">' +
          '<div>' +
            '<h2>📨 Enviar PDF a usuarios</h2>' +
            '<div class="meta"><span>' + escHtml(MOD_LABEL[meta.modulo] || meta.modulo) + '</span>' +
              (meta.referencia ? '<span>#' + escHtml(meta.referencia) + '</span>' : '') + '</div>' +
          '</div>' +
          '<button class="btn-close" title="Cerrar">✕</button>' +
        '</div>' +
        '<div class="mbody">' +
          '<label class="notif-send-label">Destinatarios</label>' +
          '<input type="text" class="notif-send-search" placeholder="Buscar por nombre o email…">' +
          '<div class="notif-send-users"><div style="padding:20px;text-align:center;color:#718096;font-size:0.84rem">Cargando…</div></div>' +
          '<label class="notif-send-label" style="margin-top:14px">Mensaje (opcional)</label>' +
          '<textarea class="notif-send-msg" placeholder="Escribe un mensaje breve…"></textarea>' +
        '</div>' +
        '<div class="mftr" style="justify-content:flex-end">' +
          '<div class="mftr-btns">' +
            '<button class="btn-cancel">Cancelar</button>' +
            '<button class="btn-confirm" disabled>Enviar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var box = overlay.querySelector('.modal-box');
    var search = overlay.querySelector('.notif-send-search');
    var listWrap = overlay.querySelector('.notif-send-users');
    var msg = overlay.querySelector('.notif-send-msg');
    var btnCancel = overlay.querySelector('.btn-cancel');
    var btnClose = overlay.querySelector('.btn-close');
    var btnConfirm = overlay.querySelector('.btn-confirm');

    function close() { if (overlay.parentElement) overlay.parentElement.removeChild(overlay); }
    btnCancel.addEventListener('click', close);
    btnClose.addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    var users = await _loadUsuarios();
    var seleccion = {};

    function render(filter) {
      var f = (filter || '').toLowerCase().trim();
      var visibles = users.filter(function(u) {
        if (!f) return true;
        return (u.nombre || '').toLowerCase().indexOf(f) >= 0 ||
               (u.email || '').toLowerCase().indexOf(f) >= 0;
      });
      if (!visibles.length) {
        listWrap.innerHTML = '<div style="padding:20px;text-align:center;color:#718096;font-size:0.84rem">Sin resultados.</div>';
        return;
      }
      listWrap.innerHTML = visibles.map(function(u) {
        var checked = seleccion[u.id] ? 'checked' : '';
        return '<label class="u">' +
          '<input type="checkbox" data-id="' + escHtml(u.id) + '" ' + checked + '>' +
          '<span class="name">' + escHtml(u.nombre || u.email) + '</span>' +
          '<span class="rol">' + escHtml(u.rol || '') + '</span>' +
        '</label>';
      }).join('');
      listWrap.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
        cb.addEventListener('change', function() {
          var id = cb.getAttribute('data-id');
          if (cb.checked) seleccion[id] = true; else delete seleccion[id];
          btnConfirm.disabled = Object.keys(seleccion).length === 0;
        });
      });
    }

    render('');
    search.addEventListener('input', function() { render(search.value); });

    btnConfirm.addEventListener('click', async function() {
      var dests = Object.keys(seleccion);
      if (!dests.length) return;
      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Enviando…';
      var mensaje = (msg.value || '').trim() || null;
      var totalSent = 0;
      var errores = [];
      var jobs = [{ buildDoc: meta.buildDoc, m: { modulo: meta.modulo, referencia: meta.referencia || null, titulo: meta.titulo } }];
      if (meta.extras && meta.extras.length) {
        meta.extras.forEach(function(ex) {
          if (ex && ex.buildDoc && ex.meta && ex.meta.titulo) {
            jobs.push({ buildDoc: ex.buildDoc, m: { modulo: ex.meta.modulo || meta.modulo, referencia: ex.meta.referencia || null, titulo: ex.meta.titulo } });
          }
        });
      }
      try {
        for (var i = 0; i < jobs.length; i++) {
          var job = jobs[i];
          var doc = job.buildDoc();
          if (!doc) { errores.push('No se pudo generar "' + job.m.titulo + '"'); continue; }
          var r = await compartirPDF(doc, {
            modulo: job.m.modulo,
            referencia: job.m.referencia,
            titulo: job.m.titulo,
            mensaje: mensaje,
            destinatarios: dests
          });
          if (r.ok) totalSent += r.sent;
          if (r.errors && r.errors.length) errores = errores.concat(r.errors);
        }
        if (totalSent > 0) {
          var docCount = jobs.length;
          var msgOk = '📨 ' + docCount + ' PDF' + (docCount === 1 ? '' : 's') +
                      ' enviado' + (docCount === 1 ? '' : 's') +
                      ' a ' + dests.length + ' usuario' + (dests.length === 1 ? '' : 's');
          showToast(msgOk, '#27ae60');
          close();
          if (typeof meta.onSent === 'function') meta.onSent({ ok: true, sent: totalSent, docs: docCount, errors: errores });
        } else {
          showToast('Error: ' + (errores[0] || 'sin enviar'), '#e74c3c');
          btnConfirm.disabled = false;
          btnConfirm.textContent = 'Enviar';
        }
      } catch (e) {
        showToast('Error: ' + e.message, '#e74c3c');
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Enviar';
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // Notificación de sólo texto (sin PDF).
  // meta: { para_ids:[uuid,...], modulo, referencia, titulo, mensaje }
  //   modulo debe estar en el CHECK de notificaciones.sql
  //   ('pedidos'|'devoluciones'|'cambios'|'muestras').
  // ────────────────────────────────────────────────────────────
  async function notifyUsers(meta) {
    if (!meta || !meta.modulo || !meta.titulo) return { ok: false, error: 'meta incompleta' };
    var dests = (meta.para_ids || []).filter(Boolean);
    if (!dests.length) return { ok: false, error: 'sin destinatarios' };
    if (!_uid && typeof AUTH !== 'undefined' && AUTH.getUser) {
      var u = AUTH.getUser(); if (u) _uid = u.id;
    }
    if (!_uid) return { ok: false, error: 'sin sesión' };

    // Evitar auto-notificarse.
    dests = dests.filter(function(id) { return id !== _uid; });
    if (!dests.length) return { ok: true, sent: 0 };

    var rows = dests.map(function(destId) {
      return {
        para_usuario_id: destId,
        de_usuario_id: _uid,
        modulo: meta.modulo,
        referencia: meta.referencia || null,
        titulo: meta.titulo,
        mensaje: meta.mensaje || null,
        storage_path: null
      };
    });
    var ins = await _sb.from('notificaciones').insert(rows);
    if (ins.error) return { ok: false, error: ins.error.message };
    return { ok: true, sent: rows.length };
  }

  async function _loadUsuarios() {
    var dir = await _loadDirectorio();
    var uid = _uid;
    return (dir || [])
      .filter(function(u) { return u.activo && u.id !== uid; })
      .sort(function(a, b) { return (a.nombre || '').localeCompare(b.nombre || ''); });
  }

  return {
    mountBell: mountBell,
    loadUnread: loadUnread,
    subscribe: subscribe,
    openItem: openItem,
    compartirPDF: compartirPDF,
    openModalEnviar: openModalEnviar,
    getDirectorio: _loadDirectorio,
    notifyUsers: notifyUsers
  };
})();
