// ── Bandeja de notificaciones (notificaciones.html) ──
// Depende de: _sb (shared.js), AUTH (auth.js), NOTIF (notificaciones.js),
//             escHtml/showToast/setSyncStatus (shared.js).

(function() {
  var PAGE_SIZE = 50;

  var _all = [];
  var _senders = {};
  var _filtered = [];
  var _page = 1;
  var _selected = {};
  var _channel = null;

  var MOD_LABEL = {
    pedidos:      '📋 Pedidos',
    devoluciones: '🔄 Devoluciones',
    cambios:      '🔁 Cambios',
    muestras:     '🧪 Muestras',
    ordenes:      '🛒 Órdenes',
    ingresos:     '📦 Ingresos',
    reenvases:    '🔃 Reenvases',
    kardex:       '📋 Kardex'
  };

  // ── Sorting ──
  var sortLevelsNp = [
    { id: 'fecha', dir: 'desc' }
  ];

  var SORT_COLS_NP = [
    { id: 'estado', fn: function(r) { return r.leida ? 1 : 0; } },
    { id: 'fecha',  fn: function(r) { return +new Date(r.created_at || 0); } },
    { id: 'modulo', fn: function(r) { return (r.modulo || '').toLowerCase(); } },
    { id: 'titulo', fn: function(r) { return (r.titulo || '').toLowerCase(); } },
    { id: 'para',   fn: function(r) { var s = _senders[r.para_usuario_id]; return s ? (s.nombre || s.email || '').toLowerCase() : ''; } },
    { id: 'de',     fn: function(r) { var s = _senders[r.de_usuario_id]; return s ? (s.nombre || s.email || '').toLowerCase() : ''; } }
  ];

  function toggleSortNp(id, e) {
    var shift = e && e.shiftKey;
    var idx = -1;
    for (var i = 0; i < sortLevelsNp.length; i++) { if (sortLevelsNp[i].id === id) { idx = i; break; } }
    if (shift) {
      if (idx >= 0) sortLevelsNp.splice(idx, 1);
    } else if (idx >= 0) {
      if (sortLevelsNp[idx].dir === 'asc') sortLevelsNp[idx].dir = 'desc';
      else sortLevelsNp.splice(idx, 1);
    } else {
      sortLevelsNp.push({ id: id, dir: 'asc' });
    }
    _page = 1;
    render();
  }
  window.toggleSortNp = toggleSortNp;

  function applySortNp(rows) {
    if (!sortLevelsNp.length) return rows;
    return [].concat(rows).sort(function(a, b) {
      for (var si = 0; si < sortLevelsNp.length; si++) {
        var lvl = sortLevelsNp[si];
        var col = null;
        for (var ci = 0; ci < SORT_COLS_NP.length; ci++) { if (SORT_COLS_NP[ci].id === lvl.id) { col = SORT_COLS_NP[ci]; break; } }
        if (!col) continue;
        var va = col.fn(a), vb = col.fn(b);
        var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
        if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  function updateSortIndicators() {
    document.querySelectorAll('#np-thead th.sortable').forEach(function(th) {
      th.classList.remove('sort-asc', 'sort-desc');
    });
    sortLevelsNp.forEach(function(lvl) {
      var th = document.querySelector('#np-thead th[data-sort="' + lvl.id + '"]');
      if (th) th.classList.add(lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
  }

  async function loadInbox() {
    await _authReady;
    var user = AUTH.getUser();
    if (!user) return;

    var loadZone = document.getElementById('load-zone');
    var mainEl = document.getElementById('main');
    if (mainEl.style.display === 'block') {
      setSyncStatus('syncing', 'Actualizando...');
    } else {
      loadZone.style.display = 'block';
    }

    try {
      var query = _sb.from('notificaciones')
        .select('id, created_at, para_usuario_id, de_usuario_id, modulo, referencia, titulo, mensaje, storage_path, leida, leida_at')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (!AUTH.isAdmin()) query = query.eq('para_usuario_id', user.id);
      var res = await query;
      if (res.error) throw new Error(res.error.message);
      _all = res.data || [];

      _senders = {};
      if (NOTIF && NOTIF.getDirectorio) {
        var dir = await NOTIF.getDirectorio();
        (dir || []).forEach(function(x) { _senders[x.id] = x; });
      }

      _selected = {};
      updateBulkBtn();
      applyFilters();
      renderStats();

      loadZone.style.display = 'none';
      mainEl.style.display = 'block';
      setSyncStatus('ok', 'Conectado. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    } catch (err) {
      if (mainEl.style.display === 'block') {
        setSyncStatus('error', 'Error: ' + err.message);
      } else {
        document.getElementById('load-spinner').style.display = 'none';
        var errEl = document.getElementById('load-error');
        errEl.textContent = '⚠️ ' + err.message;
        errEl.style.display = 'block';
        document.getElementById('btn-retry').style.display = 'inline-block';
      }
    }
  }
  window.loadInbox = loadInbox;

  function renderStats() {
    var total = _all.length;
    var unread = 0, week = 0;
    var senders = {};
    var weekAgo = Date.now() - 7 * 86400000;
    _all.forEach(function(r) {
      if (!r.leida) unread++;
      if (new Date(r.created_at).getTime() >= weekAgo) week++;
      if (r.de_usuario_id) senders[r.de_usuario_id] = true;
    });
    document.getElementById('s-total').textContent = total;
    document.getElementById('s-unread').textContent = unread;
    document.getElementById('s-week').textContent = week;
    document.getElementById('s-senders').textContent = Object.keys(senders).length;
  }

  function applyFilters() {
    var q = (document.getElementById('f-search').value || '').toLowerCase().trim();
    var est = document.getElementById('f-estado').value;
    var mod = document.getElementById('f-modulo').value;

    _filtered = _all.filter(function(r) {
      if (est === 'unread' && r.leida) return false;
      if (est === 'read' && !r.leida) return false;
      if (mod && r.modulo !== mod) return false;
      if (q) {
        var sDe = _senders[r.de_usuario_id];
        var sPara = _senders[r.para_usuario_id];
        var text = (r.titulo || '') + ' ' + (r.mensaje || '') + ' ' + (r.referencia || '') +
                   ' ' + (sDe ? (sDe.nombre || '') + ' ' + (sDe.email || '') : '') +
                   ' ' + (sPara ? (sPara.nombre || '') + ' ' + (sPara.email || '') : '');
        if (text.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });

    _page = 1;
    render();
  }

  function render() {
    var sorted = applySortNp(_filtered);
    var tbody = document.getElementById('np-tbody');
    var ct = document.getElementById('row-ct');
    ct.textContent = '(' + _filtered.length + ')';

    updateSortIndicators();

    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="np-empty">Sin notificaciones que coincidan con los filtros.</div></td></tr>';
      renderPager();
      return;
    }

    var start = (_page - 1) * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, sorted.length);
    var slice = sorted.slice(start, end);

    tbody.innerHTML = slice.map(function(r) {
      var sender = _senders[r.de_usuario_id];
      var senderName = sender ? escHtml(sender.nombre || sender.email || '—') : '—';
      var recipient = _senders[r.para_usuario_id];
      var recipientName = recipient ? escHtml(recipient.nombre || recipient.email || '—') : '—';
      var modLbl = MOD_LABEL[r.modulo] || r.modulo;
      var modClass = r.modulo || '';
      var checked = _selected[r.id] ? 'checked' : '';
      var titulo = escHtml(r.titulo || '');
      var mensaje = r.mensaje ? '<div class="np-msg-preview">' + escHtml(r.mensaje) + '</div>' : '';
      var refText = r.referencia ? ' <span style="color:#a0aec0;font-weight:400">· ' + escHtml(r.referencia) + '</span>' : '';
      return '<tr class="np-row ' + (r.leida ? '' : 'unread') + '" data-id="' + r.id + '">' +
        '<td onclick="event.stopPropagation()"><input type="checkbox" class="np-check" data-id="' + r.id + '" ' + checked + '></td>' +
        '<td><span class="np-state-dot ' + (r.leida ? '' : 'unread') + '"></span>' + (r.leida ? '<span style="color:#a0aec0;font-size:0.75rem">Leída</span>' : '<span style="color:#e74c3c;font-size:0.75rem;font-weight:700">Nueva</span>') + '</td>' +
        '<td>' + fmtDateTime(r.created_at) + '</td>' +
        '<td><span class="np-badge-mod ' + modClass + '">' + modLbl + '</span>' + refText + '</td>' +
        '<td>' + titulo + mensaje + '</td>' +
        '<td>' + recipientName + '</td>' +
        '<td>' + senderName + '</td>' +
        '<td onclick="event.stopPropagation()">' +
          '<button class="np-act-btn" data-open="' + r.id + '" title="Abrir PDF">📄 Abrir</button>' +
          '<button class="np-act-btn" data-toggle="' + r.id + '" title="' + (r.leida ? 'Marcar como no leída' : 'Marcar como leída') + '">' + (r.leida ? '↻' : '✓') + '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('tr.np-row').forEach(function(tr) {
      tr.addEventListener('click', function() { openItem(tr.getAttribute('data-id')); });
    });
    tbody.querySelectorAll('input.np-check').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var id = cb.getAttribute('data-id');
        if (cb.checked) _selected[id] = true; else delete _selected[id];
        updateBulkBtn();
        syncCheckAll();
      });
    });
    tbody.querySelectorAll('[data-open]').forEach(function(b) {
      b.addEventListener('click', function() { openItem(b.getAttribute('data-open')); });
    });
    tbody.querySelectorAll('[data-toggle]').forEach(function(b) {
      b.addEventListener('click', function() { toggleLeida(b.getAttribute('data-toggle')); });
    });

    renderPager();
    syncCheckAll();
  }

  function renderPager() {
    var total = _filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (_page > pages) _page = pages;
    var start = total ? (_page - 1) * PAGE_SIZE + 1 : 0;
    var end = Math.min(start + PAGE_SIZE - 1, total);
    document.getElementById('np-pager-info').textContent = total ? (start + '–' + end + ' de ' + total) : '0 de 0';
    document.getElementById('np-page').textContent = _page + ' / ' + pages;
    document.getElementById('np-prev').disabled = _page <= 1;
    document.getElementById('np-next').disabled = _page >= pages;
  }

  function syncCheckAll() {
    var cb = document.getElementById('np-check-all');
    var visible = document.querySelectorAll('input.np-check');
    if (!visible.length) { cb.checked = false; cb.indeterminate = false; return; }
    var checked = 0;
    visible.forEach(function(x) { if (x.checked) checked++; });
    cb.checked = checked === visible.length;
    cb.indeterminate = checked > 0 && checked < visible.length;
  }

  function updateBulkBtn() {
    var count = Object.keys(_selected).length;
    var btn = document.getElementById('btn-mark-selected');
    btn.disabled = count === 0;
    btn.textContent = count ? 'Marcar ' + count + ' como leída' + (count === 1 ? '' : 's') : 'Marcar seleccionadas como leídas';
  }

  async function openItem(id) {
    var row = _all.filter(function(r) { return r.id === id; })[0];
    if (!row) return;
    if (typeof NOTIF !== 'undefined' && NOTIF.openItem) {
      await NOTIF.openItem(row);
      applyFilters();
      renderStats();
    }
  }

  async function toggleLeida(id) {
    var row = _all.filter(function(r) { return r.id === id; })[0];
    if (!row) return;
    var newVal = !row.leida;
    var upd = await _sb.from('notificaciones')
      .update({ leida: newVal, leida_at: newVal ? new Date().toISOString() : null })
      .eq('id', id);
    if (upd.error) { showToast('Error: ' + upd.error.message, '#e74c3c'); return; }
    row.leida = newVal;
    row.leida_at = newVal ? new Date().toISOString() : null;
    applyFilters();
    renderStats();
  }

  async function markSelected() {
    var ids = Object.keys(_selected);
    if (!ids.length) return;
    var upd = await _sb.from('notificaciones')
      .update({ leida: true, leida_at: new Date().toISOString() })
      .in('id', ids)
      .eq('leida', false);
    if (upd.error) { showToast('Error: ' + upd.error.message, '#e74c3c'); return; }
    _all.forEach(function(r) { if (_selected[r.id] && !r.leida) { r.leida = true; r.leida_at = new Date().toISOString(); } });
    _selected = {};
    updateBulkBtn();
    applyFilters();
    renderStats();
    showToast('Marcadas como leídas', '#27ae60');
  }

  async function markAllUnread() {
    var ids = _all.filter(function(r) { return !r.leida; }).map(function(r) { return r.id; });
    if (!ids.length) { showToast('No hay notificaciones sin leer.', '#4a5568'); return; }
    var upd = await _sb.from('notificaciones')
      .update({ leida: true, leida_at: new Date().toISOString() })
      .in('id', ids);
    if (upd.error) { showToast('Error: ' + upd.error.message, '#e74c3c'); return; }
    _all.forEach(function(r) { if (!r.leida) { r.leida = true; r.leida_at = new Date().toISOString(); } });
    applyFilters();
    renderStats();
    showToast(ids.length + ' marcada' + (ids.length === 1 ? '' : 's') + ' como leída' + (ids.length === 1 ? '' : 's'), '#27ae60');
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function subscribeRealtime() {
    if (_channel) return;
    var user = AUTH.getUser();
    if (!user) return;
    var channelOpts = {
      event: '*',
      schema: 'public',
      table: 'notificaciones'
    };
    if (!AUTH.isAdmin()) channelOpts.filter = 'para_usuario_id=eq.' + user.id;
    _channel = _sb.channel('inbox-' + user.id)
      .on('postgres_changes', channelOpts, function(payload) {
        if (payload.eventType === 'INSERT' && typeof NOTIF !== 'undefined' && NOTIF.playSound) {
          NOTIF.playSound();
        }
        loadInbox();
      })
      .subscribe();
  }

  // ── Bindings ──
  document.getElementById('f-search').addEventListener('input', debounce(applyFilters, 200));
  document.getElementById('f-estado').addEventListener('change', applyFilters);
  document.getElementById('f-modulo').addEventListener('change', applyFilters);
  document.getElementById('btn-mark-selected').addEventListener('click', markSelected);
  document.getElementById('btn-mark-all').addEventListener('click', markAllUnread);
  document.getElementById('np-prev').addEventListener('click', function() { if (_page > 1) { _page--; render(); } });
  document.getElementById('np-next').addEventListener('click', function() { _page++; render(); });
  document.getElementById('np-check-all').addEventListener('change', function() {
    var checked = this.checked;
    document.querySelectorAll('input.np-check').forEach(function(cb) {
      cb.checked = checked;
      var id = cb.getAttribute('data-id');
      if (checked) _selected[id] = true; else delete _selected[id];
    });
    updateBulkBtn();
  });

  function debounce(fn, ms) {
    var t;
    return function() { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  loadInbox().then(subscribeRealtime);
})();
