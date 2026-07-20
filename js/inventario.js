// ── State ──
var inventario = [];
var pedidos = [];
var editInvRow = null;
var catalogoProductos = [];
var invLineas = [];
var importInvData = [];

// ── Constants ──
function getSiglaInv(n) { return getSigla(n); }
function getSiglaClassInv(n) { return getSiglaClass(n); }

// ── Sorting ──
var sortLevelsInv = [];

var SORT_COLS_INV = [
  { id:'fecha',     label:'Fecha',        fn: function(r) { return +new Date(r.Fecha||0); } },
  { id:'empresa',   label:'Empresa',      fn: function(r) { return getSiglaInv(r.Empresa); } },
  { id:'producto',  label:'Producto',     fn: function(r) { return (r.Producto||'').toLowerCase(); } },
  { id:'unidad',    label:'Unidad',       fn: function(r) { return (r.Unidad_Medida||'').toLowerCase(); } },
  { id:'lote',      label:'Lote',         fn: function(r) { return (r.Lote||'').toLowerCase(); } },
  { id:'cantidad',  label:'Cantidad',     fn: function(r) { return Number(r.Cantidad)||0; } },
  { id:'disponible',label:'Disponible',   fn: function(r) { return Number(r._disponible)||0; } },
];

function toggleSortInv(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevelsInv.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevelsInv.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevelsInv[idx].dir === 'asc') sortLevelsInv[idx].dir = 'desc'; else sortLevelsInv.splice(idx, 1); }
  else { sortLevelsInv.push({ id: id, dir: 'asc' }); }
  renderInvTable();
}

function clearSortInv() { sortLevelsInv = []; renderInvTable(); }

function applySortInv(rows) {
  if (!sortLevelsInv.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevelsInv.length; si++) {
      var lvl = sortLevelsInv[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS_INV.length; ci++) { if (SORT_COLS_INV[ci].id === lvl.id) { col = SORT_COLS_INV[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

// ── Compute committed qty from pedidos ──
function computeComprometido() {
  var comp = {};
  pedidos.forEach(function(p) {
    var prod = norm(p.Producto);
    if (!prod) return;
    var pedida = Number(p.Cantidad) || 0;
    var entregada = Number(p.Cant_Entregada) || 0;
    var pendiente = Math.max(0, pedida - entregada);
    var estado2 = (p.Estado_2 || '').toLowerCase();
    if (estado2 === 'cerrado' || estado2 === 'anulado' || estado2 === 'bloqueado por cartera') return;
    if (!comp[prod]) comp[prod] = 0;
    comp[prod] += pendiente;
  });
  return comp;
}

function enrichInventario() {
  var comp = computeComprometido();
  inventario.forEach(function(r) {
    var prod = norm(r.Producto);
    var stock = Number(r.Cantidad) || 0;
    var comprometido = comp[prod] || 0;
    r._comprometido = comprometido;
    r._disponible = stock - comprometido;
  });
}

// ── Load from API ──
async function loadInventario() {
  await _authReady;
  populateEmpresaSelect('f-empresa', 'Todas');
  populateEmpresaSelect('inv-empresa');
  populateEmpresaSelect('import-inv-empresa');
  var loadZone = document.getElementById('load-zone');
  var mainEl = document.getElementById('main');
  var errEl = document.getElementById('load-error');
  var retryBtn = document.getElementById('btn-retry');
  var spinnerEl = document.getElementById('load-spinner');

  if (mainEl.style.display === 'block') {
    setSyncStatus('syncing', 'Actualizando datos...');
  } else {
    loadZone.style.display = 'block';
    spinnerEl.style.display = 'inline-block';
    errEl.style.display = 'none';
    retryBtn.style.display = 'none';
  }

  try {
    var results = await Promise.all([
      apiGet('getInventario'),
      apiGet('getPedidos')
    ]);

    var dataInv = results[0];
    var dataPed = results[1];

    if (!dataInv.ok) throw new Error(dataInv.error || 'Error al cargar inventario');

    inventario = (dataInv.inventario || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0,10);
      return r;
    });

    pedidos = dataPed.ok ? (dataPed.pedidos || []) : [];

    enrichInventario();
    populateInvFilters();
    renderInvTable();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + inventario.length + ' registros';
  } catch (err) {
    if (mainEl.style.display === 'block') {
      setSyncStatus('error', 'Error al actualizar: ' + err.message);
    } else {
      spinnerEl.style.display = 'none';
      errEl.textContent = '⚠️ ' + err.message;
      errEl.style.display = 'block';
      retryBtn.style.display = 'inline-block';
    }
  }
}

async function loadCatalogo() {
  try {
    var data = await apiGet('getMaestroProductos');
    if (data.ok) catalogoProductos = data.productos || [];
  } catch(e) {}
}

// ── Filters ──
var invFiltersAttached = false;
function populateInvFilters() {
  var productos = [];
  inventario.forEach(function(r) {
    if (r.Producto && productos.indexOf(r.Producto) < 0) productos.push(r.Producto);
  });
  productos.sort();

  var fp = document.getElementById('f-prod');
  fp.innerHTML = '<option value="">Todos</option>' + productos.map(function(p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');

  if (!invFiltersAttached) {
    ['f-empresa','f-prod','f-stock-alert','f-txt'].forEach(function(id) {
      document.getElementById(id).addEventListener('change', renderInvTable);
      document.getElementById(id).addEventListener('input', renderInvTable);
    });
    invFiltersAttached = true;
  }
}

function filteredInv() {
  var fe = document.getElementById('f-empresa').value;
  var fp = document.getElementById('f-prod').value;
  var fa = document.getElementById('f-stock-alert').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();
  return inventario.filter(function(r) {
    if (fe && r.Empresa !== fe) return false;
    if (fp && r.Producto !== fp) return false;
    if (fa === 'bajo' && r._disponible > 10) return false;
    if (fa === 'ok' && r._disponible <= 10) return false;
    if (ft) {
      var hay = [r.Producto, r.Presentacion, r.Lote, r.Unidad_Medida, r.Observaciones].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function clearInvFilters() {
  document.getElementById('f-empresa').value = '';
  document.getElementById('f-prod').value = '';
  document.getElementById('f-stock-alert').value = '';
  document.getElementById('f-txt').value = '';
  renderInvTable();
}

// ── Render ──
function renderInvHeader() {
  var cols = [
    { label:'#', id:null },
    { label:'Fecha', id:'fecha' },
    { label:'Empresa', id:'empresa' },
    { label:'Producto', id:'producto' },
    { label:'Presentación', id:null },
    { label:'Unidad', id:'unidad' },
    { label:'Cant/Caja', id:null },
    { label:'Lote', id:'lote' },
    { label:'Stock', id:'cantidad' },
    { label:'Comprometido', id:null },
    { label:'Disponible', id:'disponible' },
    { label:'Acción', id:null },
  ];
  document.getElementById('t-head-inv').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = sortLevelsInv.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevelsInv[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevelsInv.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSortInv(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');
  var btn = document.getElementById('btn-clear-sort-inv');
  if (btn) btn.style.display = sortLevelsInv.length ? 'inline-block' : 'none';
}

function renderInvTable() {
  var rows = applySortInv(filteredInv());

  var totalRefs = inventario.length;
  var totalStock = inventario.reduce(function(s, r) { return s + (Number(r.Cantidad)||0); }, 0);
  var totalComp = inventario.reduce(function(s, r) { return s + (r._comprometido||0); }, 0);
  var totalDisp = inventario.reduce(function(s, r) { return s + (r._disponible||0); }, 0);

  document.getElementById('s-total').textContent = totalRefs;
  document.getElementById('s-stock').textContent = totalStock.toLocaleString('es-CO');
  document.getElementById('s-comprometido').textContent = totalComp.toLocaleString('es-CO');
  document.getElementById('s-disponible').textContent = totalDisp.toLocaleString('es-CO');
  document.getElementById('row-ct-inv').textContent = '(' + rows.length + ' mostrados)';

  var alertCount = inventario.filter(function(r) { return r._disponible <= 10; }).length;
  var alertsEl = document.getElementById('stock-alerts');
  if (alertCount > 0) {
    alertsEl.style.display = 'block';
    document.getElementById('alert-count').textContent = alertCount;
  } else {
    alertsEl.style.display = 'none';
  }

  renderInvHeader();

  var tbody = document.getElementById('t-body-inv');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="empty">No hay registros de inventario con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r, i) {
    var dispClass = r._disponible <= 0 ? 'inv-disp-neg' : r._disponible <= 10 ? 'inv-disp-low' : 'inv-disp-ok';
    var compStr = r._comprometido > 0 ? r._comprometido.toLocaleString('es-CO') : '—';
    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha) + '</td>' +
      '<td title="' + (r.Empresa||'') + '"><span class="sigla-badge ' + getSiglaClassInv(r.Empresa) + '">' + getSiglaInv(r.Empresa) + '</span></td>' +
      '<td style="font-weight:700">' + (r.Producto||'—') + '</td>' +
      '<td>' + (r.Presentacion||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Unidad_Medida||'—') + '</td>' +
      '<td style="text-align:center">' + (r.Cantidad_Caja||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Lote||'—') + '</td>' +
      '<td style="text-align:center;font-weight:700">' + (Number(r.Cantidad)||0).toLocaleString('es-CO') + '</td>' +
      '<td style="text-align:center;font-size:0.82rem;color:#e67e22;font-weight:600">' + compStr + '</td>' +
      '<td style="text-align:center"><span class="inv-disp-badge ' + dispClass + '">' + r._disponible.toLocaleString('es-CO') + '</span></td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="openEditInv(' + r.__row + ')" title="Editar">✏️</button>' +
        '<button class="btn-del" onclick="openDeleteInv(' + i + ',' + (r.__row||0) + ')" title="Eliminar">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Product search/autocomplete ──
var activeAutocomplete = null;

function buildInvProductSearch(lineIdx) {
  var inp = document.querySelector('.inv-prod-search[data-line="' + lineIdx + '"]');
  if (!inp) return;

  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    var empSel = document.getElementById('inv-empresa').value;
    closeAllAutocomplete();
    if (q.length < 1) return;

    var matches = catalogoProductos.filter(function(p) {
      var matchName = (p.producto||'').toLowerCase().indexOf(q) >= 0;
      var matchEmp = !empSel || !p.empresa || p.empresa === empSel;
      return matchName && matchEmp;
    });

    var seen = {};
    matches = matches.filter(function(p) {
      var key = p.producto + '||' + p.presentacion;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    if (!matches.length) return;

    var list = document.createElement('div');
    list.className = 'autocomplete-list';
    list.style.cssText = 'position:absolute;z-index:100;background:white;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:200px;overflow-y:auto;width:100%;left:0;top:100%';

    matches.slice(0, 15).forEach(function(p) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f4f8;display:flex;justify-content:space-between;align-items:center';
      item.innerHTML = '<span style="font-weight:600">' + (p.producto||'') + '</span><span style="color:#718096;font-size:0.75rem">' + (p.presentacion||'') + '</span>';
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        inp.value = p.producto;
        var presInp = document.querySelector('.inv-pres[data-line="' + lineIdx + '"]');
        if (presInp) presInp.value = p.presentacion || '';
        invLineas[lineIdx].Producto = p.producto;
        invLineas[lineIdx].Presentacion = p.presentacion || '';
        closeAllAutocomplete();
      });
      item.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background = 'white'; });
      list.appendChild(item);
    });

    var wrapper = inp.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(list);
    activeAutocomplete = list;
  });

  inp.addEventListener('blur', function() {
    setTimeout(closeAllAutocomplete, 150);
  });
}

function closeAllAutocomplete() {
  document.querySelectorAll('.autocomplete-list').forEach(function(el) { el.remove(); });
  activeAutocomplete = null;
}

// ── Render line rows in modal ──
function renderInvLines() {
  var tbody = document.getElementById('inv-lines');
  tbody.innerHTML = invLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef inv-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto||'').replace(/"/g,'&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef inv-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion||'').replace(/"/g,'&quot;')) + '" placeholder="Pres." style="width:100px"></td>' +
      '<td><input class="ef inv-unidad" data-line="' + i + '" type="text" value="' + ((l.Unidad_Medida||'').replace(/"/g,'&quot;')) + '" placeholder="Unidad" style="width:90px"></td>' +
      '<td><input class="ef inv-cantcaja" data-line="' + i + '" type="number" min="0" value="' + (l.Cantidad_Caja||'') + '" placeholder="0" style="width:70px;text-align:right"></td>' +
      '<td><input class="ef inv-lote" data-line="' + i + '" type="text" value="' + ((l.Lote||'').replace(/"/g,'&quot;')) + '" placeholder="Lote" style="width:90px"></td>' +
      '<td><input class="ef inv-cant" data-line="' + i + '" type="number" min="0" value="' + (l.Cantidad||'') + '" placeholder="0" style="width:70px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeInvLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  invLineas.forEach(function(l, i) { buildInvProductSearch(i); });
}

function addInvLine() {
  invLineas.push({ Producto: '', Presentacion: '', Unidad_Medida: '', Cantidad_Caja: '', Lote: '', Cantidad: '' });
  renderInvLines();
  var lastInput = document.querySelector('.inv-prod-search[data-line="' + (invLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeInvLine(i) {
  if (invLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  invLineas.splice(i, 1);
  renderInvLines();
}

function readInvLines() {
  document.querySelectorAll('.inv-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (invLineas[i]) invLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.inv-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (invLineas[i]) invLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.inv-unidad').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (invLineas[i]) invLineas[i].Unidad_Medida = inp.value.trim();
  });
  document.querySelectorAll('.inv-cantcaja').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (invLineas[i]) invLineas[i].Cantidad_Caja = Number(inp.value) || 0;
  });
  document.querySelectorAll('.inv-lote').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (invLineas[i]) invLineas[i].Lote = inp.value.trim();
  });
  document.querySelectorAll('.inv-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (invLineas[i]) invLineas[i].Cantidad = Number(inp.value) || 0;
  });
}

// ── New Inventario Modal ──
function openNewInventario() {
  editInvRow = null;
  document.getElementById('inv-modal-title').textContent = '📊 Registrar Inventario';
  document.getElementById('inv-fecha').value = today();
  document.getElementById('inv-empresa').value = '';
  document.getElementById('inv-observaciones').value = '';
  document.getElementById('btn-save-inv').disabled = false;
  document.getElementById('btn-save-inv').textContent = '✓ Registrar inventario';
  document.getElementById('inv-edit-single').style.display = 'none';
  document.getElementById('inv-multi-lines').style.display = 'block';
  document.getElementById('inv-obs-new').style.display = 'block';

  invLineas = [{ Producto: '', Presentacion: '', Unidad_Medida: '', Cantidad_Caja: '', Lote: '', Cantidad: '' }];
  renderInvLines();
  document.getElementById('inv-overlay').classList.add('show');
}

function closeInvModal() {
  document.getElementById('inv-overlay').classList.remove('show');
  editInvRow = null;
  closeAllAutocomplete();
}

document.getElementById('inv-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeInvModal(); });

// ── Edit Inventario ──
function openEditInv(row) {
  var r = null;
  for (var i = 0; i < inventario.length; i++) {
    if (inventario[i].__row === row) { r = inventario[i]; break; }
  }
  if (!r) return;
  editInvRow = r;
  document.getElementById('inv-modal-title').textContent = '✏️ Editar Registro de Inventario';
  document.getElementById('inv-fecha').value = toDateInput(r.Fecha);
  document.getElementById('inv-empresa').value = r.Empresa || '';
  document.getElementById('btn-save-inv').disabled = false;
  document.getElementById('btn-save-inv').textContent = '✓ Guardar cambios';

  document.getElementById('inv-multi-lines').style.display = 'none';
  document.getElementById('inv-obs-new').style.display = 'none';
  document.getElementById('inv-edit-single').style.display = 'block';
  document.getElementById('inv-edit-producto').value = r.Producto || '';
  document.getElementById('inv-edit-presentacion').value = r.Presentacion || '';
  document.getElementById('inv-edit-unidad').value = r.Unidad_Medida || '';
  document.getElementById('inv-edit-cantcaja').value = r.Cantidad_Caja || '';
  document.getElementById('inv-edit-lote').value = r.Lote || '';
  document.getElementById('inv-edit-cantidad').value = r.Cantidad || '';
  document.getElementById('inv-edit-obs').value = r.Observaciones || '';

  document.getElementById('inv-overlay').classList.add('show');
}

// ── Save ──
async function saveInventario() {
  var fecha = document.getElementById('inv-fecha').value;
  var empresa = document.getElementById('inv-empresa').value;

  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-inv');

  if (editInvRow) {
    var prod = document.getElementById('inv-edit-producto').value.trim();
    var pres = document.getElementById('inv-edit-presentacion').value.trim();
    var unidad = document.getElementById('inv-edit-unidad').value.trim();
    var cantCaja = Number(document.getElementById('inv-edit-cantcaja').value) || 0;
    var lote = document.getElementById('inv-edit-lote').value.trim();
    var cant = Number(document.getElementById('inv-edit-cantidad').value) || 0;
    var obs = document.getElementById('inv-edit-obs').value.trim();
    if (!prod) { showToast('Ingresa el producto', '#e74c3c'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    try {
      var result = await apiPost({
        action: 'editarInventario',
        row: editInvRow.__row,
        Fecha: fecha, Empresa: empresa,
        Producto: prod, Presentacion: pres, Unidad_Medida: unidad,
        Cantidad_Caja: cantCaja, Lote: lote, Cantidad: cant,
        Observaciones: obs,
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeInvModal();
      showToast('✅ Registro de inventario actualizado');
      await loadInventario();
    } catch (err) {
      showToast('❌ Error: ' + err.message, '#e74c3c');
      btn.disabled = false;
      btn.textContent = '✓ Guardar cambios';
    }
    return;
  }

  readInvLines();
  var observaciones = document.getElementById('inv-observaciones').value.trim();
  var validLines = invLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarInventario',
      Fecha: fecha, Empresa: empresa,
      Observaciones: observaciones,
      lineas: validLines,
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeInvModal();
    showToast('✅ ' + result.added + ' línea(s) de inventario registradas');
    await loadInventario();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar inventario';
  }
}

// ── Delete ──
var deleteInvRow = null;

function openDeleteInv(idx, row) {
  deleteInvRow = row;
  var rows = filteredInv();
  var r = rows[idx] || {};
  document.getElementById('del-inv-msg').textContent = '¿Eliminar este registro de inventario?';
  document.getElementById('del-inv-detail').innerHTML =
    'Producto: <strong>' + (r.Producto||'—') + '</strong> · ' + (Number(r.Cantidad)||0).toLocaleString('es-CO') + ' uds<br>' +
    'Lote: ' + (r.Lote||'—') + ' · ' + fmtDate(r.Fecha) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará este registro de la base de datos.</span>';
  document.getElementById('btn-del-inv-confirm').disabled = false;
  document.getElementById('btn-del-inv-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-inv-overlay').classList.add('show');
}

function closeDeleteInv() {
  document.getElementById('delete-inv-overlay').classList.remove('show');
  deleteInvRow = null;
}

document.getElementById('delete-inv-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteInv(); });

async function confirmDeleteInv() {
  if (!deleteInvRow) return;
  var btn = document.getElementById('btn-del-inv-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarInventario', row: deleteInvRow });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDeleteInv();
    showToast('🗑️ Registro de inventario eliminado');
    await loadInventario();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Import Excel ──
function importInventarioExcel(fileInput) {
  var file = fileInput.files[0];
  if (!file) return;
  fileInput.value = '';

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(e.target.result, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      var headerRow = -1;
      for (var i = 0; i < Math.min(data.length, 10); i++) {
        var row = data[i].map(function(c) { return String(c).toUpperCase().trim(); });
        if (row.indexOf('REFERENCIA') >= 0 || row.indexOf('PRODUCTO') >= 0 ||
            (row.indexOf('ITEM') >= 0 && row.indexOf('CANTIDAD') >= 0)) {
          headerRow = i;
          break;
        }
      }

      if (headerRow < 0) {
        showToast('No se encontró la fila de encabezados en el Excel', '#e74c3c');
        return;
      }

      var headers = data[headerRow].map(function(c) { return String(c).toUpperCase().trim().replace(/[^A-Z0-9_]/g, ''); });
      var colRef = -1, colUnidad = -1, colCantCaja = -1, colLote = -1, colCant = -1;
      for (var h = 0; h < headers.length; h++) {
        if (colRef < 0 && (headers[h] === 'REFERENCIA' || headers[h] === 'PRODUCTO' || headers[h] === 'NOMBREPRODUCTO')) colRef = h;
        if (colUnidad < 0 && (headers[h] === 'UNIDAD_MEDIDA' || headers[h] === 'UNIDADMEDIDA' || headers[h] === 'UNIDAD')) colUnidad = h;
        if (colCantCaja < 0 && (headers[h] === 'CANTIDAD_CAJA' || headers[h] === 'CANTIDADCAJA' || headers[h] === 'CANTCAJA')) colCantCaja = h;
        if (colLote < 0 && headers[h] === 'LOTE') colLote = h;
        if (colCant < 0 && headers[h] === 'CANTIDAD') colCant = h;
      }

      if (colRef < 0) { showToast('No se encontró columna REFERENCIA o PRODUCTO', '#e74c3c'); return; }
      if (colCant < 0) { showToast('No se encontró columna CANTIDAD', '#e74c3c'); return; }

      importInvData = [];
      for (var r = headerRow + 1; r < data.length; r++) {
        var row = data[r];
        var producto = String(row[colRef] || '').trim();
        if (!producto) continue;
        var cant = Number(row[colCant]) || 0;
        if (cant <= 0) continue;
        importInvData.push({
          Producto: producto,
          Unidad_Medida: colUnidad >= 0 ? String(row[colUnidad] || '').trim() : '',
          Cantidad_Caja: colCantCaja >= 0 ? (Number(row[colCantCaja]) || 0) : 0,
          Lote: colLote >= 0 ? String(row[colLote] || '').trim() : '',
          Cantidad: cant,
        });
      }

      if (!importInvData.length) {
        showToast('No se encontraron productos válidos en el Excel', '#e74c3c');
        return;
      }

      var preview = document.getElementById('import-inv-preview');
      preview.innerHTML = importInvData.map(function(r, i) {
        return '<tr>' +
          '<td style="color:#718096">' + (i+1) + '</td>' +
          '<td style="font-weight:700">' + r.Producto + '</td>' +
          '<td>' + (r.Unidad_Medida||'—') + '</td>' +
          '<td style="text-align:center">' + (r.Cantidad_Caja||'—') + '</td>' +
          '<td>' + (r.Lote||'—') + '</td>' +
          '<td style="text-align:right;font-weight:700">' + r.Cantidad.toLocaleString('es-CO') + '</td>' +
        '</tr>';
      }).join('');

      document.getElementById('import-inv-count').textContent = importInvData.length + ' líneas detectadas';
      document.getElementById('import-inv-fecha').value = today();
      document.getElementById('import-inv-empresa').value = '';
      document.getElementById('btn-confirm-import-inv').disabled = false;
      document.getElementById('btn-confirm-import-inv').textContent = '✓ Importar inventario';
      document.getElementById('import-inv-overlay').classList.add('show');
    } catch (err) {
      showToast('Error al leer el Excel: ' + err.message, '#e74c3c');
    }
  };
  reader.readAsArrayBuffer(file);
}

function closeImportInv() {
  document.getElementById('import-inv-overlay').classList.remove('show');
  importInvData = [];
}

document.getElementById('import-inv-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeImportInv(); });

async function confirmImportInv() {
  var empresa = document.getElementById('import-inv-empresa').value;
  var fecha = document.getElementById('import-inv-fecha').value;
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }

  var btn = document.getElementById('btn-confirm-import-inv');
  btn.disabled = true;
  btn.textContent = '⏳ Importando...';

  try {
    var result = await apiPost({
      action: 'agregarInventario',
      Fecha: fecha,
      Empresa: empresa,
      Observaciones: 'Importado desde Excel',
      lineas: importInvData,
    });
    if (!result.ok) throw new Error(result.error || 'Error al importar');
    closeImportInv();
    showToast('✅ ' + result.added + ' registros de inventario importados');
    await loadInventario();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Importar inventario';
  }
}

// ── Auto-load ──
loadInventario();
loadCatalogo();
