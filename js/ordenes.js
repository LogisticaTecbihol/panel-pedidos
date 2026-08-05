// ── State ──
var ordenes = [];
var editOrden = null;
var catalogoProductos = [];
var ocLineas = [];

// ── Constants ──
function getSiglaOC(n) { return getSigla(n); }
function getSiglaClassOC(n) { return getSiglaClass(n); }

function matchEmpresa(name) {
  var n = (name || '').trim().toUpperCase();
  if (!n) return '';
  for (var i = 0; i < EMPRESAS_HOLDING.length; i++) {
    var e = EMPRESAS_HOLDING[i];
    if (e.sigla.toUpperCase() === n || e.value.toUpperCase() === n ||
        e.value.toUpperCase().indexOf(n) >= 0 || n.indexOf(e.sigla.toUpperCase()) >= 0) {
      return e.value;
    }
  }
  return '';
}

// ── Sorting ──
var sortLevelsOC = [];

var SORT_COLS_OC = [
  { id:'fecha',       label:'Fecha',        fn: function(r) { return +new Date(r.Fecha||0); } },
  { id:'emp_dest',    label:'Emp. Destino', fn: function(r) { return getSiglaOC(r.Empresa_Destino); } },
  { id:'emp_orig',    label:'Emp. Origen',  fn: function(r) { return getSiglaOC(r.Empresa_Origen); } },
  { id:'consecutivo', label:'N° OC',        fn: function(r) { return (r.Consecutivo||'').toString().toLowerCase(); } },
  { id:'producto',    label:'Producto',     fn: function(r) { return (r.Producto||'').toLowerCase(); } },
  { id:'cantidad',    label:'Cantidad',     fn: function(r) { return Number(r.Cantidad)||0; } },
  { id:'valor_total', label:'Valor Total',  fn: function(r) { return Number(r.Valor_Total)||0; } },
  { id:'estado',      label:'Estado',       fn: function(r) { return (r.Estado||'').toLowerCase(); } },
];

function toggleSortOC(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevelsOC.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevelsOC.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevelsOC[idx].dir === 'asc') sortLevelsOC[idx].dir = 'desc'; else sortLevelsOC.splice(idx, 1); }
  else { sortLevelsOC.push({ id: id, dir: 'asc' }); }
  renderOCTable();
}

function clearSortOC() { sortLevelsOC = []; renderOCTable(); }

function applySortOC(rows) {
  if (!sortLevelsOC.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevelsOC.length; si++) {
      var lvl = sortLevelsOC[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS_OC.length; ci++) { if (SORT_COLS_OC[ci].id === lvl.id) { col = SORT_COLS_OC[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

// ── Load from API ──
async function loadOrdenes() {
  await _authReady;
  var ocExtras = ['CHIA ABAGO'];
  populateEmpresaSelect('f-emp-dest', 'Todas', ocExtras);
  populateEmpresaSelect('f-emp-orig', 'Todas', ocExtras);
  populateEmpresaSelect('oc-emp-dest', '— Seleccionar —', ocExtras);
  populateEmpresaSelect('oc-emp-orig', '— Seleccionar —', ocExtras);
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
    var data = await apiGet('getOrdenesCompra', { columns: 'id,Fecha,Empresa_Destino,Empresa_Origen,Consecutivo,Producto,Presentacion,Cantidad,Valor_Unitario,Valor_Total,Remision,Remision_Origen,Estado,Observaciones,Municipio,Bodega,Direccion,Tipo,Ref_Pedido,Estado_Aprobacion,Aprobada_Por,Fecha_Aprobacion,Motivo_Rechazo,creado_por' });
    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    ordenes = (data.ordenes || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0,10);
      return r;
    });

    populateOCFilters();
    renderOCTable();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + ordenes.length + ' líneas';
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
var ocFiltersAttached = false;
function populateOCFilters() {
  if (!ocFiltersAttached) {
    ['f-emp-dest','f-emp-orig','f-estado','f-aprobacion-oc','f-txt'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', renderOCTable);
      el.addEventListener('input', renderOCTable);
    });
    ocFiltersAttached = true;
  }
}

function filteredOC() {
  var fed = document.getElementById('f-emp-dest').value;
  var feo = document.getElementById('f-emp-orig').value;
  var fst = document.getElementById('f-estado').value;
  var fap = (document.getElementById('f-aprobacion-oc') || {}).value || '';
  var ft = document.getElementById('f-txt').value.toLowerCase();
  return ordenes.filter(function(r) {
    if (fed && r.Empresa_Destino !== fed) return false;
    if (feo && r.Empresa_Origen !== feo) return false;
    if (fst === '__solicitud_pendiente') {
      if (!_esSolicitudPedidoPendiente(r)) return false;
    } else if (fst && r.Estado !== fst) return false;
    if (fap && (r.Estado_Aprobacion || 'Por aprobar') !== fap) return false;
    if (ft) {
      var hay = [r.Producto, r.Presentacion, r.Consecutivo, r.Municipio, r.Observaciones, r.Bodega, r.Ref_Pedido].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function clearOCFilters() {
  document.getElementById('f-emp-dest').value = '';
  document.getElementById('f-emp-orig').value = '';
  document.getElementById('f-estado').value = '';
  var fap = document.getElementById('f-aprobacion-oc');
  if (fap) fap.value = '';
  document.getElementById('f-txt').value = '';
  renderOCTable();
}

// ── Render ──
function renderOCHeader() {
  var cols = [
    { label:'#', id:null },
    { label:'Fecha', id:'fecha' },
    { label:'Emp. Destino', id:'emp_dest' },
    { label:'Emp. Origen', id:'emp_orig' },
    { label:'N° OC', id:'consecutivo' },
    { label:'Producto', id:'producto' },
    { label:'Presentación', id:null },
    { label:'Cantidad', id:'cantidad' },
    { label:'Valor Unit.', id:null },
    { label:'Valor Total', id:'valor_total' },
    { label:'Remisión Destino', id:null },
    { label:'Remisión Origen', id:null },
    { label:'Aprobación', id:null },
    { label:'Estado', id:'estado' },
    { label:'Acción', id:null },
  ];
  document.getElementById('t-head-oc').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = sortLevelsOC.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevelsOC[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevelsOC.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSortOC(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');
  var btn = document.getElementById('btn-clear-sort-oc');
  if (btn) btn.style.display = sortLevelsOC.length ? 'inline-block' : 'none';
}

function estadoBadge(estado) {
  var e = (estado || 'Abierta').trim();
  if (e === 'Cerrada') return '<span class="badge b-cerrado">Cerrada</span>';
  if (e === 'Anulada') return '<span class="badge b-anulado">Anulada</span>';
  return '<span class="badge b-abierto">Abierta</span>';
}

// Devuelve todas las líneas de OrdenesCompra que pertenecen al
// mismo "grupo" que la fila dada. Un grupo agrupa productos que
// forman una única solicitud/orden — comparten Consecutivo,
// Empresa_Origen, Empresa_Destino, Fecha y (si aplica) Ref_Pedido.
// Todos los PDFs (solicitud + remisiones) operan sobre este grupo.
function _grupoOC(row) {
  if (!row) return [];
  var conse = String(row.Consecutivo || '').trim();
  var eDest = String(row.Empresa_Destino || '').trim();
  var eOrig = String(row.Empresa_Origen || '').trim();
  var fecha = String(row.Fecha || '').slice(0, 10);
  var refPed = String(row.Ref_Pedido || '').trim();
  return ordenes.filter(function(r) {
    if (String(r.Consecutivo || '').trim() !== conse) return false;
    if (String(r.Empresa_Destino || '').trim() !== eDest) return false;
    if (String(r.Empresa_Origen || '').trim() !== eOrig) return false;
    if (String(r.Fecha || '').slice(0, 10) !== fecha) return false;
    if (String(r.Ref_Pedido || '').trim() !== refPed) return false;
    return true;
  });
}

// Handlers de los botones "descargar solicitud" y "descargar
// remisiones" del listado y del modal de edición. Buscan la fila
// por __row (id supabase), agrupan sus hermanas y llaman al PDF.
function exportarSolicitudOC(row) {
  var r = null;
  for (var i = 0; i < ordenes.length; i++) if (ordenes[i].__row === row) { r = ordenes[i]; break; }
  if (!r) { showToast('OC no encontrada', '#e74c3c'); return; }
  if (typeof generarSolicitudOCPDF !== 'function') { showToast('PDF no disponible (jsPDF no cargó)', '#e74c3c'); return; }
  generarSolicitudOCPDF(_grupoOC(r));
}

function exportarRemisionesOC(row) {
  var r = null;
  for (var i = 0; i < ordenes.length; i++) if (ordenes[i].__row === row) { r = ordenes[i]; break; }
  if (!r) { showToast('OC no encontrada', '#e74c3c'); return; }
  if (typeof generarRemisionesTrasladoPDF !== 'function') { showToast('PDF no disponible (jsPDF no cargó)', '#e74c3c'); return; }
  generarRemisionesTrasladoPDF(_grupoOC(r));
}

// Solicitud de compra automática pendiente por legalizar:
// OC generada desde el flujo de asignación de entrega en Pedidos
// (Tipo='Traslado', con Ref_Pedido) donde aún no se ha cargado la
// Remisión Destino. Ver js/pedidos.js:persistirEntregasYTraslados.
function _esSolicitudPedidoPendiente(r) {
  if (!r) return false;
  if (String(r.Tipo || '').toLowerCase() !== 'traslado') return false;
  if (!String(r.Ref_Pedido || '').trim()) return false;
  if (String(r.Remision || '').trim()) return false;
  var est = String(r.Estado || '').toLowerCase();
  if (est === 'cerrada' || est === 'anulada') return false;
  return true;
}

function renderOCTable() {
  var rows = applySortOC(filteredOC());

  var totalLines = ordenes.length;
  var valorTotal = ordenes.reduce(function(s, r) { return s + (Number(r.Valor_Total)||0); }, 0);
  var abiertas = ordenes.filter(function(r) { return (r.Estado||'Abierta') === 'Abierta'; }).length;
  var cerradas = ordenes.filter(function(r) { return r.Estado === 'Cerrada'; }).length;
  var solicitudes = ordenes.filter(_esSolicitudPedidoPendiente).length;
  // Contamos "por aprobar" a nivel de OC (empresa_destino+empresa_origen+consecutivo),
  // no de línea, para que coincida con lo que el aprobador realmente decide.
  var seenOC = {}, porAprobarOC = 0;
  ordenes.forEach(function(r) {
    var key = (r.Empresa_Destino || '') + '|' + (r.Empresa_Origen || '') + '|' + (r.Consecutivo || r.id);
    if (seenOC[key]) return;
    seenOC[key] = true;
    if ((r.Estado_Aprobacion || 'Por aprobar') === 'Por aprobar') porAprobarOC++;
  });

  document.getElementById('s-total').textContent = totalLines;
  document.getElementById('s-valor').textContent = fmtMoney(valorTotal);
  document.getElementById('s-abiertas').textContent = abiertas;
  document.getElementById('s-cerradas').textContent = cerradas;
  var paEl = document.getElementById('s-por-aprobar-oc');
  if (paEl) paEl.textContent = porAprobarOC;
  var solEl = document.getElementById('s-solicitudes');
  if (solEl) solEl.textContent = solicitudes;
  document.getElementById('row-ct-oc').textContent = '(' + rows.length + ' mostrados)';

  renderOCHeader();

  var tbody = document.getElementById('t-body-oc');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="15"><div class="empty">No hay órdenes de compra con los filtros seleccionados.</div></td></tr>';
    return;
  }

  var canApprOC = AUTH.canApproveOC && AUTH.canApproveOC();

  tbody.innerHTML = rows.map(function(r, i) {
    var esSol = _esSolicitudPedidoPendiente(r);
    var trClass = esSol ? ' class="row-sol-pendiente"' : '';
    var solBadge = '';
    if (esSol) {
      var refEsc = String(r.Ref_Pedido || '').replace(/"/g, '&quot;');
      solBadge = ' <span class="sol-pend-badge" title="Solicitud de compra pendiente por legalizar. Origen: pedido ' + refEsc + '. Cargar Remisión Destino + Remisión Origen para que el stock entre a ' + (r.Empresa_Destino || '') + ' y se pueda emitir la remisión al cliente.">🛒 SOL. PEDIDO</span>';
    }
    var tieneRems = String(r.Remision || '').trim() || String(r.Remision_Origen || '').trim();
    var btnPdfSol = '<button class="btn-pdf-oc" onclick="exportarSolicitudOC(' + (r.__row||0) + ')" title="Descargar Solicitud de OC (PDF, agrupa todos los productos)">📄</button>';
    var btnPdfRem = '<button class="btn-pdf-oc" onclick="exportarRemisionesOC(' + (r.__row||0) + ')" title="' + (tieneRems ? 'Descargar Remisiones Destino y Origen (PDF)' : 'Aún no hay remisiones cargadas — legalizar primero') + '"' + (tieneRems ? '' : ' style="opacity:0.4"') + '>📦</button>';

    var apr = r.Estado_Aprobacion || 'Por aprobar';
    var aprBadge;
    if (apr === 'Aprobada') {
      aprBadge = '<span class="badge b-ent" title="' + escapeAttr(r.Aprobada_Por || '') + '">✅ Aprobada</span>';
    } else if (apr === 'Rechazada') {
      aprBadge = '<span class="badge b-anulado" title="' + escapeAttr(r.Motivo_Rechazo || '') + '">❌ Rechazada</span>';
    } else {
      aprBadge = '<span class="badge b-par">⏳ Por aprobar</span>';
    }

    var aprBtns = '';
    if (canApprOC && apr === 'Por aprobar') {
      var argsAR = "'" + escapeJs(r.Empresa_Destino || '') + "','" + escapeJs(r.Empresa_Origen || '') + "','" + escapeJs(String(r.Consecutivo || '')) + "'";
      aprBtns =
        '<button class="btn-edit" style="background:#27ae60;color:white;border-color:#27ae60" title="Aprobar OC" onclick="approveOC(' + argsAR + ')">✅</button>' +
        '<button class="btn-del" style="background:#e74c3c;color:white;border-color:#e74c3c" title="Rechazar OC" onclick="askRejectOC(' + argsAR + ')">❌</button>';
    }

    return '<tr' + trClass + '>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha) + '</td>' +
      '<td title="' + (r.Empresa_Destino||'') + '"><span class="sigla-badge ' + getSiglaClassOC(r.Empresa_Destino) + '">' + getSiglaOC(r.Empresa_Destino) + '</span></td>' +
      '<td title="' + (r.Empresa_Origen||'') + '"><span class="sigla-badge ' + getSiglaClassOC(r.Empresa_Origen) + '">' + getSiglaOC(r.Empresa_Origen) + '</span></td>' +
      '<td style="font-weight:600;font-size:0.82rem">' + (r.Consecutivo||'—') + solBadge + '</td>' +
      '<td style="font-weight:700">' + (r.Producto||'—') + '</td>' +
      '<td>' + (r.Presentacion||'—') + '</td>' +
      '<td style="text-align:center;font-weight:700">' + (r.Cantidad||0) + '</td>' +
      '<td style="text-align:right;font-size:0.82rem">' + fmtMoney(r.Valor_Unitario) + '</td>' +
      '<td style="text-align:right;font-weight:700;font-size:0.82rem">' + fmtMoney(r.Valor_Total) + '</td>' +
      '<td style="font-size:0.78rem;color:#4a5568">' + (r.Remision || '—') + '</td>' +
      '<td style="font-size:0.78rem;color:#4a5568">' + (r.Remision_Origen || '—') + '</td>' +
      '<td>' + aprBadge + '</td>' +
      '<td>' + estadoBadge(r.Estado) + '</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        aprBtns +
        btnPdfSol +
        btnPdfRem +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="openEditOC(' + r.__row + ')" title="Editar">✏️</button>' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="openDeleteOC(' + i + ',' + (r.__row||0) + ')" title="Eliminar">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeJs(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── Product search/autocomplete ──
var activeAutocomplete = null;

function buildOCProductSearch(lineIdx) {
  var inp = document.querySelector('.oc-prod-search[data-line="' + lineIdx + '"]');
  if (!inp) return;

  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    closeAllOCAutocomplete();
    if (q.length < 1) return;

    var matches = catalogoProductos.filter(function(p) {
      return (p.producto||'').toLowerCase().indexOf(q) >= 0;
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
        var presInp = document.querySelector('.oc-pres[data-line="' + lineIdx + '"]');
        if (presInp) presInp.value = p.presentacion || '';
        ocLineas[lineIdx].Producto = p.producto;
        ocLineas[lineIdx].Presentacion = p.presentacion || '';
        closeAllOCAutocomplete();
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
    setTimeout(closeAllOCAutocomplete, 150);
  });
}

function closeAllOCAutocomplete() {
  document.querySelectorAll('.autocomplete-list').forEach(function(el) { el.remove(); });
  activeAutocomplete = null;
}

// ── Render line rows in modal ──
function renderOCLines() {
  var tbody = document.getElementById('oc-lines');
  tbody.innerHTML = ocLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef oc-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto||'').replace(/"/g,'&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef oc-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion||'').replace(/"/g,'&quot;')) + '" placeholder="Presentación" style="width:120px"></td>' +
      '<td><input class="ef oc-cant" data-line="' + i + '" type="number" min="1" value="' + (l.Cantidad||'') + '" placeholder="0" style="width:80px;text-align:right" onchange="calcOCLineTotal(' + i + ')"></td>' +
      '<td><input class="ef oc-vunit" data-line="' + i + '" type="number" min="0" value="' + (l.Valor_Unitario||'') + '" placeholder="0" style="width:100px;text-align:right" onchange="calcOCLineTotal(' + i + ')"></td>' +
      '<td><input class="ef oc-vtotal" data-line="' + i + '" type="number" min="0" value="' + (l.Valor_Total||'') + '" placeholder="0" style="width:100px;text-align:right" onchange="updateOCTotal()"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeOCLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  ocLineas.forEach(function(l, i) { buildOCProductSearch(i); });
  updateOCTotal();
}

function calcOCLineTotal(i) {
  var cantInp = document.querySelector('.oc-cant[data-line="' + i + '"]');
  var vunitInp = document.querySelector('.oc-vunit[data-line="' + i + '"]');
  var vtotalInp = document.querySelector('.oc-vtotal[data-line="' + i + '"]');
  if (cantInp && vunitInp && vtotalInp) {
    vtotalInp.value = (Number(cantInp.value) || 0) * (Number(vunitInp.value) || 0) || '';
  }
  updateOCTotal();
}

function updateOCTotal() {
  var total = 0;
  document.querySelectorAll('.oc-vtotal').forEach(function(inp) { total += Number(inp.value) || 0; });
  document.getElementById('oc-total-display').textContent = fmtMoney(total);
}

function addOCLine() {
  ocLineas.push({ Producto: '', Presentacion: '', Cantidad: '', Valor_Unitario: '', Valor_Total: '' });
  renderOCLines();
  var lastInput = document.querySelector('.oc-prod-search[data-line="' + (ocLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeOCLine(i) {
  if (ocLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  ocLineas.splice(i, 1);
  renderOCLines();
}

function readOCLines() {
  document.querySelectorAll('.oc-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line); if (ocLineas[i]) ocLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.oc-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line); if (ocLineas[i]) ocLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.oc-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line); if (ocLineas[i]) ocLineas[i].Cantidad = Number(inp.value) || 0;
  });
  document.querySelectorAll('.oc-vunit').forEach(function(inp) {
    var i = Number(inp.dataset.line); if (ocLineas[i]) ocLineas[i].Valor_Unitario = Number(inp.value) || 0;
  });
  document.querySelectorAll('.oc-vtotal').forEach(function(inp) {
    var i = Number(inp.dataset.line); if (ocLineas[i]) ocLineas[i].Valor_Total = Number(inp.value) || 0;
  });
}

// ── Excel parser ──
function parseOCExcel(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        var oc = {
          empresa_destino: '', empresa_origen: '', fecha: '',
          direccion: '', bodega: '', municipio: '',
          observaciones: '', productos: []
        };

        var colProd = 0, colPres = 1, colCant = 5, colValUnit = 10, colValTotal = 15;
        var productStartRow = -1;

        for (var i = 0; i < data.length; i++) {
          var cellA = String(data[i][0] || '').trim().toUpperCase();
          var cellB = data[i][1] !== undefined ? data[i][1] : '';

          if (cellA.indexOf('NOMBRE') >= 0 && cellA.indexOf('EMPRESA') >= 0) {
            oc.empresa_destino = String(cellB || '').trim();
          } else if (cellA === 'PROVEEDOR') {
            oc.empresa_origen = String(cellB || '').trim();
          } else if (cellA === 'FECHA') {
            if (cellB instanceof Date) {
              oc.fecha = cellB.getFullYear() + '-' + String(cellB.getMonth()+1).padStart(2,'0') + '-' + String(cellB.getDate()).padStart(2,'0');
            } else {
              oc.fecha = String(cellB || '');
            }
          } else if (cellA.indexOf('DIRECC') >= 0) {
            oc.direccion = String(cellB || '').trim();
          } else if (cellA.indexOf('BODEGA') >= 0) {
            oc.bodega = String(cellB || '').trim();
          } else if (cellA === 'MUNICIPIO') {
            oc.municipio = String(cellB || '').trim();
          } else if (cellA === 'OBSERVACIONES') {
            for (var c = 1; c < (data[i].length || 0); c++) {
              if (data[i][c]) { oc.observaciones = String(data[i][c]).trim(); break; }
            }
          } else if (cellA === 'PRODUCTOS' || cellA === 'PRODUCTO') {
            for (var c2 = 0; c2 < data[i].length; c2++) {
              var h = String(data[i][c2] || '').trim().toUpperCase();
              if (h === 'PRODUCTOS' || h === 'PRODUCTO') colProd = c2;
              else if (h === 'PRESENTACION' || h === 'PRESENTACIÓN') colPres = c2;
              else if (h === 'CANTIDAD') colCant = c2;
              else if (h.indexOf('VALOR UNIT') >= 0 || h === 'VALOR UNITARIO') colValUnit = c2;
              else if (h.indexOf('VALOR TOTAL') >= 0) colValTotal = c2;
            }
            productStartRow = i + 1;
          }
        }

        if (productStartRow >= 0) {
          for (var p = productStartRow; p < data.length; p++) {
            var producto = String(data[p][colProd] || '').trim();
            if (!producto) continue;
            var upper = producto.toUpperCase();
            if (['OBSERVACIONES','DESCUENTOS','SUBTOTAL','VALOR BRUTO','TOTAL A PAGAR','IVA','TOTAL'].indexOf(upper) >= 0) break;
            if (upper.indexOf('CONDICIONES') >= 0) break;

            var cant = Number(data[p][colCant]) || 0;
            if (cant <= 0) continue;

            oc.productos.push({
              Producto: producto,
              Presentacion: String(data[p][colPres] || '').trim(),
              Cantidad: cant,
              Valor_Unitario: Number(data[p][colValUnit]) || 0,
              Valor_Total: Number(data[p][colValTotal]) || 0
            });
          }
        }

        resolve(oc);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function handleOCFile(input) {
  var file = input.files && input.files[0];
  if (file) loadOCFromFile(file);
}

function handleOCDrop(event) {
  var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) loadOCFromFile(file);
}

async function loadOCFromFile(file) {
  try {
    showToast('📂 Leyendo archivo...', '#00897b');
    var oc = await parseOCExcel(file);

    if (!oc.productos.length) {
      showToast('⚠️ No se encontraron líneas de producto en el archivo', '#e67e22');
      return;
    }

    if (oc.fecha) document.getElementById('oc-fecha').value = oc.fecha;
    document.getElementById('oc-emp-dest').value = matchEmpresa(oc.empresa_destino);
    document.getElementById('oc-emp-orig').value = matchEmpresa(oc.empresa_origen);
    document.getElementById('oc-direccion').value = oc.direccion;
    document.getElementById('oc-bodega').value = oc.bodega;
    document.getElementById('oc-municipio').value = oc.municipio;
    document.getElementById('oc-observaciones').value = oc.observaciones;

    ocLineas = oc.productos.map(function(p) {
      return { Producto: p.Producto, Presentacion: p.Presentacion, Cantidad: p.Cantidad, Valor_Unitario: p.Valor_Unitario, Valor_Total: p.Valor_Total };
    });
    renderOCLines();

    document.getElementById('oc-upload-zone').style.display = 'none';
    document.getElementById('oc-file-info').style.display = 'block';
    document.getElementById('oc-file-name').textContent = file.name;

    showToast('✅ ' + oc.productos.length + ' producto(s) cargados desde Excel', '#00897b');
  } catch (err) {
    showToast('❌ Error al leer el archivo: ' + err.message, '#e74c3c');
  }
}

function clearOCFile() {
  document.getElementById('oc-upload-zone').style.display = 'block';
  document.getElementById('oc-file-info').style.display = 'none';
  document.getElementById('oc-file').value = '';
}

// ── New OC Modal ──
function openNewOC() {
  editOrden = null;
  document.getElementById('oc-modal-title').textContent = '🛒 Nueva Orden de Compra';
  document.getElementById('oc-fecha').value = today();
  document.getElementById('oc-consecutivo').value = '';
  document.getElementById('oc-emp-dest').value = '';
  document.getElementById('oc-emp-orig').value = '';
  document.getElementById('oc-direccion').value = '';
  document.getElementById('oc-bodega').value = '';
  document.getElementById('oc-municipio').value = '';
  document.getElementById('oc-remision').value = '';
  document.getElementById('oc-remision-origen').value = '';
  document.getElementById('oc-estado').value = 'Abierta';
  document.getElementById('oc-observaciones').value = '';
  document.getElementById('btn-save-oc').disabled = false;
  document.getElementById('btn-save-oc').textContent = '✓ Registrar orden';
  document.getElementById('oc-edit-single').style.display = 'none';
  document.getElementById('oc-multi-lines').style.display = 'block';
  document.getElementById('oc-upload-section').style.display = 'block';
  clearOCFile();

  ocLineas = [{ Producto: '', Presentacion: '', Cantidad: '', Valor_Unitario: '', Valor_Total: '' }];
  renderOCLines();
  // Botones PDF sólo aplican al editar una OC existente; ocultar aquí.
  var btnSol = document.getElementById('btn-oc-pdf-solicitud');
  var btnRem = document.getElementById('btn-oc-pdf-remisiones');
  if (btnSol) btnSol.style.display = 'none';
  if (btnRem) btnRem.style.display = 'none';
  // OC nueva siempre nace "Por aprobar": bloquear remisión y opción Cerrada.
  _applyAprobacionLockOC({ Estado_Aprobacion: 'Por aprobar' });
  document.getElementById('oc-overlay').classList.add('show');
}

// Bloquea inputs de remisión y la opción "Cerrada" cuando la OC no está aprobada.
// El check constraint SQL 'oc_legalizacion_requiere_aprobacion' respalda esta regla.
function _applyAprobacionLockOC(r) {
  var apr = (r && r.Estado_Aprobacion) || 'Por aprobar';
  var locked = apr !== 'Aprobada';
  var rem = document.getElementById('oc-remision');
  var remO = document.getElementById('oc-remision-origen');
  var est = document.getElementById('oc-estado');
  if (rem) {
    rem.disabled = locked;
    rem.title = locked ? 'Requiere aprobación previa de la OC' : '';
    rem.style.background = locked ? '#f1f5f9' : '';
  }
  if (remO) {
    remO.disabled = locked;
    remO.title = locked ? 'Requiere aprobación previa de la OC' : '';
    remO.style.background = locked ? '#f1f5f9' : '';
  }
  if (est) {
    // La opción "Cerrada" queda deshabilitada mientras no esté aprobada.
    var optCerrada = est.querySelector('option[value="Cerrada"]');
    if (optCerrada) optCerrada.disabled = locked;
    if (locked && est.value === 'Cerrada') est.value = 'Abierta';
  }
}

function closeOCModal() {
  document.getElementById('oc-overlay').classList.remove('show');
  editOrden = null;
  closeAllOCAutocomplete();
  var btnSol = document.getElementById('btn-oc-pdf-solicitud');
  var btnRem = document.getElementById('btn-oc-pdf-remisiones');
  if (btnSol) btnSol.style.display = 'none';
  if (btnRem) btnRem.style.display = 'none';
}

document.getElementById('oc-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeOCModal(); });

function onOCRemisionChange() {
  var rem = document.getElementById('oc-remision').value.trim();
  if (rem) {
    document.getElementById('oc-estado').value = 'Cerrada';
  }
}

// ── Edit OC ──
function openEditOC(row) {
  var r = null;
  for (var i = 0; i < ordenes.length; i++) {
    if (ordenes[i].__row === row) { r = ordenes[i]; break; }
  }
  if (!r) return;
  editOrden = r;
  document.getElementById('oc-modal-title').textContent = '✏️ Editar Orden de Compra';
  document.getElementById('oc-fecha').value = toDateInput(r.Fecha);
  document.getElementById('oc-consecutivo').value = r.Consecutivo || '';
  document.getElementById('oc-emp-dest').value = r.Empresa_Destino || '';
  document.getElementById('oc-emp-orig').value = r.Empresa_Origen || '';
  document.getElementById('oc-direccion').value = r.Direccion || '';
  document.getElementById('oc-bodega').value = r.Bodega || '';
  document.getElementById('oc-municipio').value = r.Municipio || '';
  document.getElementById('oc-remision').value = r.Remision || '';
  document.getElementById('oc-remision-origen').value = r.Remision_Origen || '';
  document.getElementById('oc-estado').value = r.Estado || 'Abierta';
  document.getElementById('oc-observaciones').value = r.Observaciones || '';
  document.getElementById('btn-save-oc').disabled = false;
  document.getElementById('btn-save-oc').textContent = '✓ Guardar cambios';
  _applyAprobacionLockOC(r);

  document.getElementById('oc-multi-lines').style.display = 'none';
  document.getElementById('oc-upload-section').style.display = 'none';
  document.getElementById('oc-edit-single').style.display = 'block';
  document.getElementById('oc-edit-producto').value = r.Producto || '';
  document.getElementById('oc-edit-presentacion').value = r.Presentacion || '';
  document.getElementById('oc-edit-cantidad').value = r.Cantidad || '';
  document.getElementById('oc-edit-valorunit').value = r.Valor_Unitario || '';
  document.getElementById('oc-edit-valortotal').value = r.Valor_Total || '';

  // Botones PDF: mostrar en edición (siempre solicitud; remisiones
  // sólo si al menos una de las remisiones está cargada).
  var btnSol = document.getElementById('btn-oc-pdf-solicitud');
  var btnRem = document.getElementById('btn-oc-pdf-remisiones');
  if (btnSol) btnSol.style.display = 'inline-block';
  if (btnRem) {
    var tieneRems = String(r.Remision || '').trim() || String(r.Remision_Origen || '').trim();
    btnRem.style.display = 'inline-block';
    btnRem.disabled = !tieneRems;
    btnRem.style.opacity = tieneRems ? '1' : '0.4';
    btnRem.style.cursor = tieneRems ? 'pointer' : 'not-allowed';
    btnRem.title = tieneRems
      ? 'Descargar las Remisiones (Destino y Origen) en PDF'
      : 'Aún no hay remisiones cargadas — legalizar primero (cargar Remisión Destino y/o Origen)';
  }

  document.getElementById('oc-overlay').classList.add('show');
}

// Handlers de los botones PDF del modal de edición de OC. Toman
// la OC activa (editOrden), agrupan con _grupoOC y llaman al PDF.
function exportarSolicitudOCDesdeModal() {
  if (!editOrden) { showToast('Abre una OC primero', '#e67e22'); return; }
  if (typeof generarSolicitudOCPDF !== 'function') { showToast('PDF no disponible (jsPDF no cargó)', '#e74c3c'); return; }
  generarSolicitudOCPDF(_grupoOC(editOrden));
}
function exportarRemisionesOCDesdeModal() {
  if (!editOrden) { showToast('Abre una OC primero', '#e67e22'); return; }
  if (typeof generarRemisionesTrasladoPDF !== 'function') { showToast('PDF no disponible (jsPDF no cargó)', '#e74c3c'); return; }
  generarRemisionesTrasladoPDF(_grupoOC(editOrden));
}

// ── Save ──
async function saveOC() {
  var fecha = document.getElementById('oc-fecha').value;
  var consecutivo = document.getElementById('oc-consecutivo').value.trim();
  var empresa_destino = document.getElementById('oc-emp-dest').value;
  var empresa_origen = document.getElementById('oc-emp-orig').value;
  var direccion = document.getElementById('oc-direccion').value.trim();
  var bodega = document.getElementById('oc-bodega').value.trim();
  var municipio = document.getElementById('oc-municipio').value.trim();
  var remision = document.getElementById('oc-remision').value.trim();
  var remision_origen = document.getElementById('oc-remision-origen').value.trim();
  var estado = document.getElementById('oc-estado').value;
  var observaciones = document.getElementById('oc-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!empresa_destino) { showToast('Selecciona la empresa destino', '#e74c3c'); return; }
  if (!empresa_origen) { showToast('Selecciona la empresa origen', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-oc');

  if (editOrden) {
    var prod = document.getElementById('oc-edit-producto').value.trim();
    var pres = document.getElementById('oc-edit-presentacion').value.trim();
    var cant = Number(document.getElementById('oc-edit-cantidad').value) || 0;
    var vunit = Number(document.getElementById('oc-edit-valorunit').value) || 0;
    var vtotal = Number(document.getElementById('oc-edit-valortotal').value) || 0;
    if (!prod) { showToast('Ingresa el producto', '#e74c3c'); return; }
    if (cant <= 0) { showToast('Ingresa una cantidad válida', '#e74c3c'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    try {
      var result = await apiPost({
        action: 'editarOrdenCompra', row: editOrden.__row,
        Fecha: fecha, Empresa_Destino: empresa_destino, Empresa_Origen: empresa_origen,
        Consecutivo: consecutivo, Direccion: direccion, Bodega: bodega, Municipio: municipio,
        Producto: prod, Presentacion: pres, Cantidad: cant,
        Valor_Unitario: vunit, Valor_Total: vtotal || (cant * vunit),
        Total_Orden: '', Observaciones: observaciones, Estado: estado, Remision: remision, Remision_Origen: remision_origen,
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeOCModal();
      showToast('✅ Orden actualizada en la nube');
      await loadOrdenes();
    } catch (err) {
      showToast('❌ Error: ' + err.message, '#e74c3c');
      btn.disabled = false;
      btn.textContent = '✓ Guardar cambios';
    }
    return;
  }

  readOCLines();
  var validLines = ocLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var totalOrden = validLines.reduce(function(s, l) { return s + (l.Valor_Total || 0); }, 0);

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarOrdenCompra',
      Fecha: fecha, Empresa_Destino: empresa_destino, Empresa_Origen: empresa_origen,
      Consecutivo: consecutivo, Direccion: direccion, Bodega: bodega, Municipio: municipio,
      Total_Orden: totalOrden, Observaciones: observaciones, Estado: estado, Remision: remision, Remision_Origen: remision_origen,
      lineas: validLines,
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeOCModal();
    showToast('✅ ' + result.added + ' línea(s) registradas en la nube');
    _notifyAprobadoresNuevaOC({
      empresaDest: empresa_destino, empresaOrig: empresa_origen, consecutivo: consecutivo,
      nLineas: validLines.length, total: fmtMoney(totalOrden)
    });
    await loadOrdenes();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar orden';
  }
}

// ── Delete ──
var deleteOCRow = null;

function openDeleteOC(idx, row) {
  deleteOCRow = row;
  var rows = filteredOC();
  var r = rows[idx] || {};
  document.getElementById('del-oc-msg').textContent = '¿Eliminar esta línea de la orden?';
  document.getElementById('del-oc-detail').innerHTML =
    'Producto: <strong>' + (r.Producto||'—') + '</strong> · ' + (r.Cantidad||0) + ' uds<br>' +
    'OC: ' + (r.Consecutivo||'—') + ' · ' + getSiglaOC(r.Empresa_Destino) + ' ← ' + getSiglaOC(r.Empresa_Origen) + ' · ' + fmtDate(r.Fecha) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará esta línea de la base de datos.</span>';
  document.getElementById('btn-del-oc-confirm').disabled = false;
  document.getElementById('btn-del-oc-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-oc-overlay').classList.add('show');
}

function closeDeleteOC() {
  document.getElementById('delete-oc-overlay').classList.remove('show');
  deleteOCRow = null;
}

document.getElementById('delete-oc-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteOC(); });

async function confirmDeleteOC() {
  if (!deleteOCRow) return;
  var btn = document.getElementById('btn-del-oc-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarOrdenCompra', row: deleteOCRow });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDeleteOC();
    showToast('🗑️ Línea eliminada');
    await loadOrdenes();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Aprobación / rechazo (admin o módulo ordenes_aprobar) ──

var ocRejectCtx = null;

function _ocGrupoIds(empresaDest, empresaOrig, consecutivo) {
  return ordenes
    .filter(function(r) {
      return (r.Empresa_Destino || '') === empresaDest
          && (r.Empresa_Origen  || '') === empresaOrig
          && String(r.Consecutivo || '') === String(consecutivo);
    })
    .map(function(r) { return r.id; });
}

async function approveOC(empresaDest, empresaOrig, consecutivo) {
  if (!AUTH.canApproveOC || !AUTH.canApproveOC()) {
    showToast('No tienes permiso para aprobar órdenes de compra.', '#e74c3c'); return;
  }
  var ids = _ocGrupoIds(empresaDest, empresaOrig, consecutivo);
  if (!ids.length) { showToast('OC no encontrada.', '#e67e22'); return; }
  if (!confirm('¿Aprobar esta OC (' + ids.length + ' línea(s))?')) return;
  var res = await apiPost({
    action: 'aprobarOrdenCompra',
    Empresa_Destino: empresaDest, Empresa_Origen: empresaOrig, Consecutivo: consecutivo,
    ids: ids
  });
  if (!res.ok) { showToast('❌ ' + (res.error || 'Error al aprobar'), '#e74c3c'); return; }
  showToast('✅ OC aprobada');
  var creatorRow = ordenes.filter(function(r) { return ids.indexOf(r.id) >= 0; })[0];
  _notifyCreadorAprobacionOC(creatorRow, 'Aprobada', '');
  await loadOrdenes();
}

function askRejectOC(empresaDest, empresaOrig, consecutivo) {
  if (!AUTH.canApproveOC || !AUTH.canApproveOC()) {
    showToast('No tienes permiso para rechazar órdenes de compra.', '#e74c3c'); return;
  }
  var ids = _ocGrupoIds(empresaDest, empresaOrig, consecutivo);
  if (!ids.length) { showToast('OC no encontrada.', '#e67e22'); return; }
  ocRejectCtx = { empresaDest: empresaDest, empresaOrig: empresaOrig, consecutivo: consecutivo, ids: ids };
  document.getElementById('rej-oc-detail').textContent =
    'OC ' + (consecutivo || '—') + ' · ' + ids.length + ' línea(s)';
  document.getElementById('rej-oc-motivo').value = '';
  document.getElementById('btn-rej-oc-confirm').disabled = false;
  document.getElementById('reject-oc-overlay').classList.add('show');
  setTimeout(function() { document.getElementById('rej-oc-motivo').focus(); }, 50);
}

function closeRejectOC() {
  document.getElementById('reject-oc-overlay').classList.remove('show');
  ocRejectCtx = null;
}
document.getElementById('reject-oc-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeRejectOC(); });

async function confirmRejectOC() {
  if (!ocRejectCtx) return;
  var motivo = document.getElementById('rej-oc-motivo').value.trim();
  if (!motivo) { showToast('Escribe el motivo del rechazo.', '#e67e22'); return; }
  var ctx = ocRejectCtx;
  var btn = document.getElementById('btn-rej-oc-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Rechazando...';
  try {
    var res = await apiPost({
      action: 'rechazarOrdenCompra',
      Empresa_Destino: ctx.empresaDest, Empresa_Origen: ctx.empresaOrig, Consecutivo: ctx.consecutivo,
      ids: ctx.ids, Motivo_Rechazo: motivo
    });
    if (!res.ok) throw new Error(res.error || 'Error al rechazar');
    var creatorRow = ordenes.filter(function(r) { return ctx.ids.indexOf(r.id) >= 0; })[0];
    closeRejectOC();
    showToast('✅ OC rechazada');
    _notifyCreadorAprobacionOC(creatorRow, 'Rechazada', motivo);
    await loadOrdenes();
  } catch (err) {
    showToast('❌ ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '❌ Rechazar';
  }
}

// ── Notificaciones ──

async function _notifyAprobadoresNuevaOC(info) {
  if (typeof NOTIF === 'undefined' || !NOTIF.notifyUsers || !NOTIF.getDirectorio) return;
  try {
    var dir = await NOTIF.getDirectorio();
    // Sólo admins reciben aviso (no expandimos a titulares del módulo hasta que
    // la RPC list_usuarios_directorio devuelva usuario_modulos, o consultemos aparte).
    var adminIds = (dir || [])
      .filter(function(u) { return u.activo && u.rol === 'admin'; })
      .map(function(u) { return u.id; });
    if (!adminIds.length) return;
    var siglaD = getSiglaOC(info.empresaDest);
    var siglaO = getSiglaOC(info.empresaOrig);
    await NOTIF.notifyUsers({
      para_ids: adminIds,
      modulo: 'ordenes',
      referencia: info.consecutivo || '',
      titulo: '🛒 Orden de compra por aprobar: ' + siglaD + ' ← ' + siglaO + ' #' + (info.consecutivo || ''),
      mensaje: info.nLineas + ' línea(s)' + (info.total ? ' · Total: ' + info.total : '')
    });
  } catch (e) { /* la notificación no debe bloquear el flujo */ }
}

async function _notifyCreadorAprobacionOC(row, estado, motivo) {
  if (typeof NOTIF === 'undefined' || !NOTIF.notifyUsers) return;
  if (!row || !row.creado_por) return;
  try {
    var siglaD = getSiglaOC(row.Empresa_Destino);
    var siglaO = getSiglaOC(row.Empresa_Origen);
    var ref = String(row.Consecutivo || '');
    var titulo, mensaje;
    if (estado === 'Aprobada') {
      titulo = '✅ OC aprobada: ' + siglaD + ' ← ' + siglaO + ' #' + ref;
      mensaje = 'Tu OC fue aprobada y ya puede legalizarse.';
    } else {
      titulo = '❌ OC rechazada: ' + siglaD + ' ← ' + siglaO + ' #' + ref;
      mensaje = 'Motivo: ' + (motivo || 'sin motivo');
    }
    await NOTIF.notifyUsers({
      para_ids: [row.creado_por],
      modulo: 'ordenes',
      referencia: ref,
      titulo: titulo,
      mensaje: mensaje
    });
  } catch (e) { /* silencioso */ }
}

// ── Auto-load ──
loadOrdenes();
loadCatalogo();
