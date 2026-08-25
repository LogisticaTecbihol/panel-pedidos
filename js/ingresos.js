// ── State ──
var ingresos = [];
var editIngreso = null;
var catalogoProductos = [];
var ingLineas = [];
var ingGroups = [];
var activeIngGroup = null;

// ── Constants ──
var ORIGENES = ['Planta Mosquera', 'Planta Cachipay', 'Proveedor Carval', 'Chia Abago', 'Bodega Villeta', 'Germisemillas'];
function getSiglaIng(n) { return getSigla(n); }
function getSiglaClassIng(n) { return getSiglaClass(n); }

// ── Sorting ──
var sortLevelsIng = [
  { id: 'fecha', dir: 'desc' }
];

var SORT_COLS_ING = [
  { id:'fecha',     label:'Fecha',        fn: function(g) { return +new Date(g.Fecha||0); } },
  { id:'origen',    label:'Origen',       fn: function(g) { return (g.Origen||'').toLowerCase(); } },
  { id:'emp_orig',   label:'Emp. Origen',  fn: function(g) { return getSiglaIng(g.Empresa_Origen); } },
  { id:'emp_dest',   label:'Emp. Destino', fn: function(g) { return getSiglaIng(g.Empresa_Destino); } },
  { id:'lineas',    label:'Líneas',       fn: function(g) { return getLinesForIng(g).length; } },
  { id:'unidades',  label:'Unidades',     fn: function(g) { return getLinesForIng(g).reduce(function(s,r) { return s + (Number(r.Cantidad)||0); }, 0); } },
  { id:'responsable', label:'Responsable', fn: function(g) { return (g.Responsable||'').toLowerCase(); } },
];

// ── Grouping ──
function keyOfIng(r) {
  return [r.Fecha||'', r.Origen||'', r.Empresa_Origen||'', r.Empresa_Destino||'', r.Responsable||'', r.Remision_Origen||'', r.Remision_Destino||''].join('||');
}

function rebuildIngGroups() {
  var seen = {};
  var order = [];
  ingresos.forEach(function(r) {
    var k = keyOfIng(r);
    if (!seen[k]) {
      seen[k] = {
        _key: k, Fecha: r.Fecha, Origen: r.Origen, Empresa_Origen: r.Empresa_Origen,
        Empresa_Destino: r.Empresa_Destino, Responsable: r.Responsable,
        Remision_Origen: r.Remision_Origen, Remision_Destino: r.Remision_Destino,
        Observaciones: r.Observaciones,
      };
      order.push(k);
    }
    if (!seen[k].Observaciones && r.Observaciones) seen[k].Observaciones = r.Observaciones;
  });
  ingGroups = order.map(function(k) { return seen[k]; });
}

function getLinesForIng(g) {
  return ingresos.filter(function(r) { return keyOfIng(r) === g._key; });
}

function toggleSortIng(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevelsIng.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevelsIng.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevelsIng[idx].dir === 'asc') sortLevelsIng[idx].dir = 'desc'; else sortLevelsIng.splice(idx, 1); }
  else { sortLevelsIng.push({ id: id, dir: 'asc' }); }
  renderIngTable();
}

function clearSortIng() { sortLevelsIng = []; renderIngTable(); }

function applySortIng(rows) {
  if (!sortLevelsIng.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevelsIng.length; si++) {
      var lvl = sortLevelsIng[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS_ING.length; ci++) { if (SORT_COLS_ING[ci].id === lvl.id) { col = SORT_COLS_ING[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

// ── Load from API ──
async function loadIngresos() {
  await _authReady;
  populateEmpresaSelect('f-emp-orig', 'Todas');
  populateEmpresaSelect('f-emp-dest', 'Todas');
  populateEmpresaSelect('ing-empresa-origen');
  populateEmpresaSelect('ing-empresa-destino');
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
    var data = await apiGet('getIngresos', { columns: 'id,Fecha,Origen,Empresa_Origen,Empresa_Destino,Producto,Presentacion,Cantidad,Responsable,Remision_Origen,Remision_Destino,Observaciones' });
    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    ingresos = (data.ingresos || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0,10);
      return r;
    });

    populateIngFilters();
    renderIngTable();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + ingGroups.length + ' ingresos · ' + ingresos.length + ' líneas';
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
var ingFiltersAttached = false;
function populateIngFilters() {
  var productos = []; var responsables = [];
  ingresos.forEach(function(r) {
    if (r.Producto && productos.indexOf(r.Producto) < 0) productos.push(r.Producto);
    if (r.Responsable && responsables.indexOf(r.Responsable) < 0) responsables.push(r.Responsable);
  });
  productos.sort(); responsables.sort();

  var fp = document.getElementById('f-prod');
  fp.innerHTML = '<option value="">Todos</option>' + productos.map(function(p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');

  var fr = document.getElementById('f-resp');
  fr.innerHTML = '<option value="">Todos</option>' + responsables.map(function(r) { return '<option value="' + r + '">' + r + '</option>'; }).join('');

  if (!ingFiltersAttached) {
    ['f-origen','f-emp-orig','f-emp-dest','f-prod','f-resp','f-fec-desde','f-fec-hasta','f-txt'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function() { renderIngTable(); renderDetalleIng(); });
      el.addEventListener('input', function() { renderIngTable(); renderDetalleIng(); });
    });
    ingFiltersAttached = true;
  }
}

function filteredIng() {
  var fo = document.getElementById('f-origen').value;
  var feo = document.getElementById('f-emp-orig').value;
  var fed = document.getElementById('f-emp-dest').value;
  var fp = document.getElementById('f-prod').value;
  var fr = document.getElementById('f-resp').value;
  var fdEl = document.getElementById('f-fec-desde');
  var fhEl = document.getElementById('f-fec-hasta');
  var fdesde = fdEl ? fdEl.value : '';
  var fhasta = fhEl ? fhEl.value : '';
  var ft = document.getElementById('f-txt').value.toLowerCase();
  return ingGroups.filter(function(g) {
    if (fo && g.Origen !== fo) return false;
    if (feo && g.Empresa_Origen !== feo) return false;
    if (fed && g.Empresa_Destino !== fed) return false;
    if (fr && g.Responsable !== fr) return false;
    if (fdesde || fhasta) {
      var fp10 = String(g.Fecha || '').slice(0, 10);
      if (!fp10) return false;
      if (fdesde && fp10 < fdesde) return false;
      if (fhasta && fp10 > fhasta) return false;
    }
    var lines = getLinesForIng(g);
    if (fp && !lines.some(function(l) { return l.Producto === fp; })) return false;
    if (ft) {
      var hay = [g.Origen, g.Empresa_Origen, g.Empresa_Destino, g.Responsable, g.Remision_Origen, g.Remision_Destino, g.Observaciones].join(' ');
      lines.forEach(function(l) { hay += ' ' + (l.Producto||'') + ' ' + (l.Presentacion||''); });
      if (hay.toLowerCase().indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function clearIngFilters() {
  document.getElementById('f-origen').value = '';
  document.getElementById('f-emp-orig').value = '';
  document.getElementById('f-emp-dest').value = '';
  document.getElementById('f-prod').value = '';
  document.getElementById('f-resp').value = '';
  var fd = document.getElementById('f-fec-desde'); if (fd) fd.value = '';
  var fh = document.getElementById('f-fec-hasta'); if (fh) fh.value = '';
  document.getElementById('f-txt').value = '';
  renderIngTable();
  renderDetalleIng();
}

// ── Render ──
function renderIngHeader() {
  var cols = [
    { label:'#', id:null },
    { label:'Fecha', id:'fecha' },
    { label:'Origen', id:'origen' },
    { label:'Emp. Origen', id:'emp_orig' },
    { label:'Emp. Destino', id:'emp_dest' },
    { label:'Líneas', id:'lineas' },
    { label:'Unidades', id:'unidades' },
    { label:'Responsable', id:'responsable' },
    { label:'Rem. Origen', id:null },
    { label:'Rem. Destino', id:null },
    { label:'Acción', id:null },
  ];
  document.getElementById('t-head-ing').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = sortLevelsIng.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevelsIng[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevelsIng.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSortIng(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');
  var btn = document.getElementById('btn-clear-sort-ing');
  if (btn) btn.style.display = sortLevelsIng.length ? 'inline-block' : 'none';
}

function renderIngTable() {
  rebuildIngGroups();
  var groups = applySortIng(filteredIng());

  var totalGroups = ingGroups.length;
  var totalUnidades = ingresos.reduce(function(s, r) { return s + (Number(r.Cantidad)||0); }, 0);
  var mosquera = ingGroups.filter(function(g) { return g.Origen === 'Planta Mosquera'; }).length;
  var cachipay = ingGroups.filter(function(g) { return g.Origen === 'Planta Cachipay'; }).length;

  document.getElementById('s-total').textContent = totalGroups;
  document.getElementById('s-unidades').textContent = totalUnidades.toLocaleString('es-CO');
  document.getElementById('s-mosquera').textContent = mosquera;
  document.getElementById('s-cachipay').textContent = cachipay;
  document.getElementById('row-ct-ing').textContent = '(' + groups.length + ' mostrados)';

  renderIngHeader();

  var tbody = document.getElementById('t-body-ing');
  if (!groups.length) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty">No hay ingresos con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = groups.map(function(g, i) {
    var lines = getLinesForIng(g);
    var totalQty = lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
    var origenBadge = g.Origen === 'Devolución'
      ? '<span class="badge b-rec">Devolución</span>'
      : '<span class="badge b-par">' + (g.Origen||'—') + '</span>';
    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(g.Fecha) + '</td>' +
      '<td>' + origenBadge + '</td>' +
      '<td title="' + (g.Empresa_Origen||'') + '"><span class="sigla-badge ' + getSiglaClassIng(g.Empresa_Origen) + '">' + getSiglaIng(g.Empresa_Origen) + '</span></td>' +
      '<td title="' + (g.Empresa_Destino||'') + '"><span class="sigla-badge ' + getSiglaClassIng(g.Empresa_Destino) + '">' + getSiglaIng(g.Empresa_Destino) + '</span></td>' +
      '<td style="text-align:center"><span style="background:#e8f4fb;color:#1a5276;padding:2px 9px;border-radius:12px;font-size:0.75rem;font-weight:700">' + lines.length + '</span></td>' +
      '<td style="text-align:center;font-weight:700">' + totalQty.toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.78rem">' + (g.Responsable||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (g.Remision_Origen||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (g.Remision_Destino||'—') + '</td>' +
      '<td><button class="btn-ver" onclick="openIngDetail(' + i + ')">📦 Ver ingreso</button></td>' +
    '</tr>';
  }).join('');

  refreshIngDetail();
}

// ── Detail Modal ──
function openIngDetail(idx) {
  var groups = applySortIng(filteredIng());
  activeIngGroup = groups[idx];
  if (!activeIngGroup) return;

  var g = activeIngGroup;
  document.getElementById('ing-detail-title').textContent = '📥 Detalle de Ingreso';
  document.getElementById('ing-detail-sub').textContent = fmtDate(g.Fecha) + ' · ' + (g.Origen||'') + ' → ' + getSiglaIng(g.Empresa_Destino);

  document.getElementById('igd-fecha').textContent = fmtDate(g.Fecha);
  document.getElementById('igd-origen').textContent = g.Origen || '—';
  document.getElementById('igd-responsable').textContent = g.Responsable || '—';
  document.getElementById('igd-emp-orig').textContent = g.Empresa_Origen || '—';
  document.getElementById('igd-emp-dest').textContent = g.Empresa_Destino || '—';
  document.getElementById('igd-rem-orig').textContent = g.Remision_Origen || '—';
  document.getElementById('igd-rem-dest').textContent = g.Remision_Destino || '—';
  document.getElementById('igd-obs').textContent = g.Observaciones || '—';

  renderIngDetailProducts();

  var canUpload = AUTH.canUploadAdjuntos();
  document.getElementById('ing-btn-adjuntar').style.display = canUpload ? '' : 'none';
  document.getElementById('ing-adjunto-dropzone').style.display = canUpload ? '' : 'none';

  document.getElementById('ing-detail-overlay').classList.add('show');
  loadIngAdjuntos();

  var _envBtn = document.querySelector('#ing-detail-overlay button[onclick*="enviarRemisionIngreso"]');
  if (_envBtn && typeof NOTIF !== 'undefined' && NOTIF.verificarBtn) {
    var _remDest = (g.Remision_Destino || '').trim();
    var _remOrig = (g.Remision_Origen || '').trim();
    var _remNum = _remDest || _remOrig || '';
    var _emp = g.Empresa_Origen || g.Empresa_Destino || '';
    var _sig = (typeof getSigla === 'function' ? getSigla(_emp) : '') || '';
    var _ref = (_sig ? _sig + ' · ' : '') + 'Rem ' + _remNum;
    if (_remNum) {
      NOTIF.verificarBtn(_envBtn, 'ingresos', _ref);
    } else {
      _envBtn.disabled = false; _envBtn.style.opacity = ''; _envBtn.style.cursor = '';
      _envBtn.title = 'Enviar remisión con copia contabilidad a otro usuario del panel';
      _envBtn.textContent = '📨 Enviar Remisión';
    }
  }
}

function renderIngDetailProducts() {
  var g = activeIngGroup;
  if (!g) return;
  var lines = getLinesForIng(g);

  document.getElementById('igd-line-ct').textContent = '(' + lines.length + ' líneas)';
  var totalUnits = lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
  document.getElementById('igd-total').textContent = 'Total: ' + totalUnits.toLocaleString('es-CO') + ' unidades';
  document.getElementById('igd-footer-info').textContent = lines.length + ' producto(s) · ' + totalUnits.toLocaleString('es-CO') + ' unidades';

  var tbody = document.getElementById('igd-products');
  if (!lines.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty">No hay productos en este ingreso.</div></td></tr>';
    return;
  }

  tbody.innerHTML = lines.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="font-weight:600">' + (l.Producto||'—') + '</td>' +
      '<td>' + (l.Presentacion||'—') + '</td>' +
      '<td style="text-align:right;font-weight:700">' + (Number(l.Cantidad)||0) + '</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="openEditIng(' + l.__row + ')" title="Editar">✏️</button>' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="openDeleteIngFromDetail(' + i + ',' + (l.__row||0) + ')" title="Eliminar">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function closeIngDetail() {
  document.getElementById('ing-detail-overlay').classList.remove('show');
  activeIngGroup = null;
}

function refreshIngDetail() {
  if (!activeIngGroup) return;
  var overlay = document.getElementById('ing-detail-overlay');
  if (!overlay || !overlay.classList.contains('show')) return;
  var key = activeIngGroup._key;
  var newGroup = null;
  for (var i = 0; i < ingGroups.length; i++) {
    if (ingGroups[i]._key === key) { newGroup = ingGroups[i]; break; }
  }
  if (newGroup) {
    activeIngGroup = newGroup;
    renderIngDetailProducts();
  } else {
    closeIngDetail();
  }
}

function addProductToGroup() {
  if (!activeIngGroup) return;
  var g = activeIngGroup;
  editIngreso = null;
  document.getElementById('ing-modal-title').textContent = '📥 Agregar Producto';
  document.getElementById('ing-fecha').value = toDateInput(g.Fecha);
  setOrigenValue(g.Origen || '');
  document.getElementById('ing-empresa-origen').value = g.Empresa_Origen || '';
  document.getElementById('ing-empresa-destino').value = g.Empresa_Destino || '';
  document.getElementById('ing-responsable').value = g.Responsable || '';
  document.getElementById('ing-remision-origen').value = g.Remision_Origen || '';
  document.getElementById('ing-remision-destino').value = g.Remision_Destino || '';
  document.getElementById('ing-observaciones').value = g.Observaciones || '';
  var chkDestA = document.getElementById('ing-remision-destino-auto');
  if (chkDestA) chkDestA.checked = true;
  var elDest = document.getElementById('ing-remision-destino');
  elDest.readOnly = true; elDest.style.background = '#f0f4f8'; elDest.placeholder = '(Auto al guardar)';
  document.getElementById('btn-save-ing').disabled = false;
  document.getElementById('btn-save-ing').textContent = '✓ Registrar ingreso';
  document.getElementById('ing-edit-single').style.display = 'none';
  document.getElementById('ing-multi-lines').style.display = 'block';

  ingLineas = [{ Producto: '', Presentacion: '', Cantidad: '' }];
  renderIngLines();
  onOrigenChange();
  document.getElementById('ing-overlay').classList.add('show');
}

// ── Enviar Remisión PDF ──
function enviarRemisionIngreso(btn) {
  if (!activeIngGroup) return;
  var g = activeIngGroup;
  var lines = getLinesForIng(g);
  if (!lines.length) { showToast('No hay productos en este ingreso.', '#e67e22'); return; }

  var remDest = (g.Remision_Destino || '').trim();
  var remOrig = (g.Remision_Origen || '').trim();
  var remNum = remDest || remOrig || '';
  if (!remNum) { showToast('Este ingreso no tiene número de remisión asignado.', '#e67e22'); return; }

  if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
    showToast('Módulo de notificaciones no cargado.', '#e74c3c'); return;
  }

  var empresa = g.Empresa_Origen || g.Empresa_Destino || '';
  var entregas = lines.map(function(l) {
    return {
      producto: l.Producto || '',
      presentacion: l.Presentacion || '',
      cantidad: Number(l.Cantidad) || 0,
      valor_unitario: 0,
      valor_total: 0,
      bonificado: 'No'
    };
  }).filter(function(p) { return p.cantidad > 0 || p.producto; });

  var left = [
    ['Origen', g.Origen || ''],
    ['Emp. Origen', g.Empresa_Origen || ''],
    ['Responsable', g.Responsable || '']
  ];
  var right = [
    ['Emp. Destino', g.Empresa_Destino || ''],
    ['Rem. Origen', g.Remision_Origen || ''],
    ['Rem. Destino', g.Remision_Destino || '']
  ];

  var data = {
    empresa: empresa,
    consecutivo: '',
    doc_title: 'REMISION DE INGRESO',
    doc_number: remNum,
    ref_label: null,
    date_label: 'Fecha ingreso',
    fecha_entrega: g.Fecha || '',
    remision: remNum,
    left_fields: left,
    right_fields: right,
    entregas: entregas,
    qty_header: 'Cantidad',
    file_prefix: 'Remision_Ingreso'
  };

  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  NOTIF.openModalEnviar({
    modulo: 'ingresos',
    referencia: (sigla ? sigla + ' · ' : '') + 'Rem ' + remNum,
    titulo: 'Remisión ingreso #' + remNum + ' — ' + (g.Origen || ''),
    triggerBtn: btn || null,
    buildDoc: function() {
      var r = generarRemisionPDF(Object.assign({}, data, { return_doc: true, copies: ['COPIA - CONTABILIDAD'] }));
      return r ? r.doc : null;
    }
  });
}

// ── Exportar PDF de Remisión ──
function exportarRemisionIngreso() {
  if (!activeIngGroup) return;
  var g = activeIngGroup;
  var lines = getLinesForIng(g);
  if (!lines.length) { showToast('No hay productos en este ingreso.', '#e67e22'); return; }

  var remDest = (g.Remision_Destino || '').trim();
  var remOrig = (g.Remision_Origen || '').trim();
  var remNum = remDest || remOrig || '';
  if (!remNum) { showToast('Este ingreso no tiene número de remisión asignado.', '#e67e22'); return; }

  if (typeof generarRemisionPDF !== 'function') {
    showToast('Módulo de PDF no cargado. Intenta de nuevo en unos segundos.', '#e74c3c'); return;
  }

  var empresa = g.Empresa_Origen || g.Empresa_Destino || '';
  var entregas = lines.map(function(l) {
    return {
      producto: l.Producto || '',
      presentacion: l.Presentacion || '',
      cantidad: Number(l.Cantidad) || 0,
      valor_unitario: 0,
      valor_total: 0,
      bonificado: 'No'
    };
  }).filter(function(p) { return p.cantidad > 0 || p.producto; });

  var left = [
    ['Origen', g.Origen || ''],
    ['Emp. Origen', g.Empresa_Origen || ''],
    ['Responsable', g.Responsable || '']
  ];
  var right = [
    ['Emp. Destino', g.Empresa_Destino || ''],
    ['Rem. Origen', g.Remision_Origen || ''],
    ['Rem. Destino', g.Remision_Destino || '']
  ];

  generarRemisionPDF({
    empresa: empresa,
    consecutivo: '',
    doc_title: 'REMISION DE INGRESO',
    doc_number: remNum,
    ref_label: null,
    date_label: 'Fecha ingreso',
    fecha_entrega: g.Fecha || '',
    remision: remNum,
    left_fields: left,
    right_fields: right,
    entregas: entregas,
    qty_header: 'Cantidad',
    file_prefix: 'Remision_Ingreso'
  });
}

// ── Product search/autocomplete ──
var activeAutocomplete = null;

function buildProductSearch(lineIdx) {
  var inp = document.querySelector('.ing-prod-search[data-line="' + lineIdx + '"]');
  if (!inp) return;

  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    var empSel = document.getElementById('ing-empresa-origen').value;
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
        var presInp = document.querySelector('.ing-pres[data-line="' + lineIdx + '"]');
        if (presInp) presInp.value = p.presentacion || '';
        ingLineas[lineIdx].Producto = p.producto;
        ingLineas[lineIdx].Presentacion = p.presentacion || '';
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
function renderIngLines() {
  var tbody = document.getElementById('ing-lines');
  tbody.innerHTML = ingLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef ing-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto||'').replace(/"/g,'&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef ing-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion||'').replace(/"/g,'&quot;')) + '" placeholder="Presentación" style="width:120px"></td>' +
      '<td><input class="ef ing-cant" data-line="' + i + '" type="number" min="1" value="' + (l.Cantidad||'') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeIngLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  ingLineas.forEach(function(l, i) { buildProductSearch(i); });
}

function addIngLine() {
  ingLineas.push({ Producto: '', Presentacion: '', Cantidad: '' });
  renderIngLines();
  var lastInput = document.querySelector('.ing-prod-search[data-line="' + (ingLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeIngLine(i) {
  if (ingLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  ingLineas.splice(i, 1);
  renderIngLines();
}

function readIngLines() {
  document.querySelectorAll('.ing-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ingLineas[i]) ingLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.ing-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ingLineas[i]) ingLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.ing-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ingLineas[i]) ingLineas[i].Cantidad = Number(inp.value) || 0;
  });
}

// ── Origen → Empresa mapping ──
var ORIGEN_EMPRESA = {
  'Planta Mosquera': 'GREEN AGROSOLUCIONES DE COLOMBIA SAS',
  'Planta Cachipay': 'PARCELAR DE COLOMBIA SAS',
};

function setOrigenValue(val) {
  var sel = document.getElementById('ing-origen');
  var customEl = document.getElementById('ing-origen-custom');
  var found = false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === val) { found = true; break; }
  }
  if (found) {
    sel.value = val;
    customEl.style.display = 'none';
    customEl.value = '';
  } else {
    sel.value = '__otro__';
    customEl.style.display = '';
    customEl.value = val || '';
  }
}

function getOrigenValue() {
  var sel = document.getElementById('ing-origen').value;
  if (sel === '__otro__') return (document.getElementById('ing-origen-custom').value || '').trim();
  return sel;
}

function onOrigenChange() {
  var selVal = document.getElementById('ing-origen').value;
  var customEl = document.getElementById('ing-origen-custom');
  customEl.style.display = selVal === '__otro__' ? '' : 'none';
  if (selVal !== '__otro__') customEl.value = '';

  var origen = getOrigenValue();
  var empresa = ORIGEN_EMPRESA[origen];
  if (empresa) {
    document.getElementById('ing-empresa-origen').value = empresa;
  }
  var esExterno = origen === 'Proveedor Carval' || origen === 'Chia Abago' || origen === 'Bodega Villeta' || origen === 'Germisemillas';
  document.getElementById('ing-empresa-origen-wrap').style.display = esExterno ? 'none' : '';
  document.getElementById('ing-remision-origen-wrap').style.display = esExterno ? 'none' : '';
  if (esExterno) {
    document.getElementById('ing-empresa-origen').value = '';
    document.getElementById('ing-remision-origen').value = '';
  }
  if (origen === 'Chia Abago') {
    document.getElementById('ing-empresa-destino').value = '';
  }
  var esPlanta = !!ORIGEN_EMPRESA[origen];
  var chkOrigen = document.getElementById('ing-remision-origen-auto');
  var elOrigen = document.getElementById('ing-remision-origen');
  if (chkOrigen) {
    if (esPlanta) {
      chkOrigen.checked = false;
      elOrigen.readOnly = false;
      elOrigen.style.background = '';
      elOrigen.placeholder = 'N° remisión planta';
    } else {
      chkOrigen.checked = true;
      elOrigen.readOnly = true;
      elOrigen.style.background = '#f0f4f8';
      elOrigen.placeholder = '(Auto al guardar)';
    }
  }
}

// ── New Ingreso Modal ──
function openNewIngreso() {
  editIngreso = null;
  document.getElementById('ing-modal-title').textContent = '📥 Registrar Ingreso';
  document.getElementById('ing-fecha').value = today();
  setOrigenValue('Planta Mosquera');
  document.getElementById('ing-empresa-origen').value = '';
  document.getElementById('ing-empresa-destino').value = '';
  document.getElementById('ing-responsable').value = '';
  document.getElementById('ing-remision-origen').value = '';
  document.getElementById('ing-remision-destino').value = '';
  document.getElementById('ing-observaciones').value = '';
  var chkDestA = document.getElementById('ing-remision-destino-auto');
  if (chkDestA) chkDestA.checked = true;
  var elDest = document.getElementById('ing-remision-destino');
  elDest.readOnly = true; elDest.style.background = '#f0f4f8'; elDest.placeholder = '(Auto al guardar)';
  document.getElementById('btn-save-ing').disabled = false;
  document.getElementById('btn-save-ing').textContent = '✓ Registrar ingreso';
  document.getElementById('ing-edit-single').style.display = 'none';
  document.getElementById('ing-multi-lines').style.display = 'block';

  ingLineas = [{ Producto: '', Presentacion: '', Cantidad: '' }];
  renderIngLines();
  onOrigenChange();
  document.getElementById('ing-overlay').classList.add('show');
}

function closeIngModal() {
  document.getElementById('ing-overlay').classList.remove('show');
  editIngreso = null;
  closeAllAutocomplete();
}

document.getElementById('ing-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeIngModal(); });

// ── Edit Ingreso (single line) ──
function openEditIng(row) {
  var r = null;
  for (var i = 0; i < ingresos.length; i++) {
    if (ingresos[i].__row === row) { r = ingresos[i]; break; }
  }
  if (!r) return;
  editIngreso = r;
  document.getElementById('ing-modal-title').textContent = '✏️ Editar Ingreso';
  document.getElementById('ing-fecha').value = toDateInput(r.Fecha);
  setOrigenValue(r.Origen || '');
  document.getElementById('ing-empresa-origen').value = r.Empresa_Origen || '';
  document.getElementById('ing-empresa-destino').value = r.Empresa_Destino || '';
  document.getElementById('ing-responsable').value = r.Responsable || '';
  document.getElementById('ing-remision-origen').value = r.Remision_Origen || '';
  document.getElementById('ing-remision-destino').value = r.Remision_Destino || '';
  var elD = document.getElementById('ing-remision-destino');
  elD.readOnly = true; elD.style.background = '#f0f4f8'; elD.placeholder = '(Auto al guardar)';
  var chkD = document.getElementById('ing-remision-destino-auto');
  if (chkD) chkD.checked = true;
  var elO = document.getElementById('ing-remision-origen');
  elO.readOnly = true; elO.style.background = '#f0f4f8'; elO.placeholder = '(Auto al guardar)';
  var chkO = document.getElementById('ing-remision-origen-auto');
  if (chkO) chkO.checked = true;
  document.getElementById('ing-observaciones').value = r.Observaciones || '';
  document.getElementById('btn-save-ing').disabled = false;
  document.getElementById('btn-save-ing').textContent = '✓ Guardar cambios';

  document.getElementById('ing-multi-lines').style.display = 'none';
  document.getElementById('ing-edit-single').style.display = 'block';
  document.getElementById('ing-edit-producto').value = r.Producto || '';
  document.getElementById('ing-edit-presentacion').value = r.Presentacion || '';
  document.getElementById('ing-edit-cantidad').value = r.Cantidad || '';

  onOrigenChange();
  document.getElementById('ing-overlay').classList.add('show');
}

// ── Save ──
async function saveIngreso() {
  var fecha = document.getElementById('ing-fecha').value;
  var origen = getOrigenValue();
  var empresa_origen = document.getElementById('ing-empresa-origen').value;
  var empresa_destino = document.getElementById('ing-empresa-destino').value;
  var responsable = document.getElementById('ing-responsable').value.trim();
  var remision_origen = document.getElementById('ing-remision-origen').value.trim();
  var remision_destino = document.getElementById('ing-remision-destino').value.trim();
  var observaciones = document.getElementById('ing-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!origen) { showToast('Selecciona el origen', '#e74c3c'); return; }
  var esExterno = origen === 'Proveedor Carval' || origen === 'Chia Abago' || origen === 'Bodega Villeta' || origen === 'Germisemillas';
  if (!esExterno && !empresa_origen) { showToast('Selecciona la empresa origen', '#e74c3c'); return; }
  if (!responsable) { showToast('Ingresa el responsable', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-ing');

  if (editIngreso) {
    var prod = document.getElementById('ing-edit-producto').value.trim();
    var pres = document.getElementById('ing-edit-presentacion').value.trim();
    var cant = Number(document.getElementById('ing-edit-cantidad').value) || 0;
    if (!prod) { showToast('Ingresa el producto', '#e74c3c'); return; }
    if (cant <= 0) { showToast('Ingresa una cantidad válida', '#e74c3c'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    try {
      var result = await apiPost({
        action: 'editarIngreso',
        row: editIngreso.__row,
        Fecha: fecha, Origen: origen, Empresa_Origen: empresa_origen, Empresa_Destino: empresa_destino,
        Producto: prod, Presentacion: pres, Cantidad: cant,
        Responsable: responsable, Remision_Origen: remision_origen, Remision_Destino: remision_destino, Observaciones: observaciones,
        _remision_origen_existente: !!(editIngreso.Remision_Origen || '').trim(),
        _remision_destino_existente: !!(editIngreso.Remision_Destino || '').trim(),
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeIngModal();
      var toastParts = ['✅ Ingreso actualizado'];
      if (result.remision_destino) toastParts.push('RE: ' + result.remision_destino);
      if (result.remision_origen) toastParts.push('RS: ' + result.remision_origen);
      showToast(toastParts.join(' · '));
      await loadIngresos();
    } catch (err) {
      showToast('❌ Error: ' + err.message, '#e74c3c');
      btn.disabled = false;
      btn.textContent = '✓ Guardar cambios';
    }
    return;
  }

  readIngLines();
  var validLines = ingLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarIngreso',
      Fecha: fecha, Origen: origen, Empresa_Origen: empresa_origen, Empresa_Destino: empresa_destino,
      Responsable: responsable, Remision_Origen: remision_origen, Remision_Destino: remision_destino, Observaciones: observaciones,
      lineas: validLines,
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeIngModal();
    var toastPartsNew = ['✅ ' + result.added + ' línea(s) registradas'];
    if (result.remision_destino) toastPartsNew.push('RE: ' + result.remision_destino);
    if (result.remision_origen) toastPartsNew.push('RS: ' + result.remision_origen);
    showToast(toastPartsNew.join(' · '));
    await loadIngresos();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar ingreso';
  }
}

// ── Delete ──
var deleteIngRow = null;

function openDeleteIngFromDetail(lineIdx, row) {
  deleteIngRow = row;
  var g = activeIngGroup;
  if (!g) return;
  var lines = getLinesForIng(g);
  var r = lines[lineIdx] || {};
  document.getElementById('del-ing-msg').textContent = '¿Eliminar este producto del ingreso?';
  document.getElementById('del-ing-detail').innerHTML =
    'Producto: <strong>' + (r.Producto||'—') + '</strong> · ' + (r.Cantidad||0) + ' uds<br>' +
    'Ingreso: ' + (g.Origen||'—') + ' · ' + fmtDate(g.Fecha) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará este producto del ingreso.</span>';
  document.getElementById('btn-del-ing-confirm').disabled = false;
  document.getElementById('btn-del-ing-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-ing-overlay').classList.add('show');
}

function closeDeleteIng() {
  document.getElementById('delete-ing-overlay').classList.remove('show');
  deleteIngRow = null;
}

document.getElementById('delete-ing-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteIng(); });
document.getElementById('ing-detail-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeIngDetail(); });

async function confirmDeleteIng() {
  if (!deleteIngRow) return;
  var btn = document.getElementById('btn-del-ing-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarIngreso', row: deleteIngRow });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDeleteIng();
    showToast('🗑️ Ingreso eliminado');
    await loadIngresos();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Adjuntos (Supabase Storage) ──
var ING_ADJUNTOS_BUCKET = 'ingresos-adjuntos';

function ingAdjuntoFolder(g) {
  var empOrig = (typeof getSigla === 'function' ? getSigla(g.Empresa_Origen) : '') || 'SIN';
  var empDest = (typeof getSigla === 'function' ? getSigla(g.Empresa_Destino) : '') || 'SIN';
  var rem = (g.Remision_Destino || g.Remision_Origen || '').trim();
  var fecha = (g.Fecha || '').replace(/-/g, '');
  var folder = empOrig + '_' + empDest + '/' + (rem || fecha || 'sin_remision');
  return folder.replace(/[^a-zA-Z0-9_/\-]/g, '_');
}

function ingFormatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function loadIngAdjuntos() {
  if (!activeIngGroup) return;
  var listEl = document.getElementById('ing-adjuntos-list');
  var countEl = document.getElementById('ing-adjuntos-count');
  listEl.innerHTML = '<div class="adjuntos-loading">Cargando adjuntos...</div>';

  var folder = ingAdjuntoFolder(activeIngGroup);
  var res = await _sb.storage.from(ING_ADJUNTOS_BUCKET).list(folder, { limit: 50 });

  var files = (res.data || []).filter(function(f) { return f.name && f.id; });

  if (!files.length) {
    listEl.innerHTML = '<div class="adjuntos-empty">Sin archivos adjuntos</div>';
    countEl.textContent = '';
    return;
  }

  countEl.textContent = '(' + files.length + ')';
  listEl.innerHTML = files.map(function(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var icon = ext === 'pdf' ? '📄' : '🖼️';
    var size = f.metadata && f.metadata.size ? ingFormatFileSize(f.metadata.size) : '';
    var path = folder + '/' + f.name;
    var nameEsc = f.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var pathEsc = path.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<div class="adjunto-item">' +
      '<div class="adjunto-icon">' + icon + '</div>' +
      '<div class="adjunto-info">' +
        '<div class="adjunto-name" title="' + nameEsc + '">' + nameEsc + '</div>' +
        '<div class="adjunto-meta">' + ext.toUpperCase() + (size ? ' · ' + size : '') + '</div>' +
      '</div>' +
      '<div class="adjunto-actions">' +
        '<button class="btn-adj-ver" onclick="previewIngAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + ext + '\')">👁 Ver</button>' +
        '<button class="btn-adj-ver" onclick="downloadIngAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + nameEsc.replace(/'/g, "\\'") + '\')">⬇ Descargar</button>' +
        (AUTH.canDelete() ? '<button class="btn-adj-del" onclick="deleteIngAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\')">🗑️</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

async function handleIngAdjuntoUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  var maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast('El archivo excede 5 MB. Selecciona un archivo más pequeño.', '#e74c3c');
    return;
  }

  var allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (allowed.indexOf(file.type) < 0) {
    showToast('Tipo de archivo no permitido. Usa PDF, JPG, PNG o WEBP.', '#e74c3c');
    return;
  }

  if (!activeIngGroup) return;
  var folder = ingAdjuntoFolder(activeIngGroup);
  var timestamp = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var finalName = timestamp + '_' + safeName;
  var path = folder + '/' + finalName;

  var progWrap = document.getElementById('ing-adjunto-progress');
  var progFill = document.getElementById('ing-adjunto-prog-fill');
  var progText = document.getElementById('ing-adjunto-prog-text');
  progWrap.style.display = 'block';
  progFill.style.width = '30%';
  progText.textContent = 'Subiendo ' + file.name + '...';

  var res = await _sb.storage.from(ING_ADJUNTOS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });

  progFill.style.width = '100%';

  if (res.error) {
    progWrap.style.display = 'none';
    showToast('Error al subir: ' + res.error.message, '#e74c3c');
    return;
  }

  progText.textContent = 'Listo';
  setTimeout(function() { progWrap.style.display = 'none'; progFill.style.width = '0%'; }, 1200);

  showToast('Archivo adjuntado correctamente', '#27ae60');
  await loadIngAdjuntos();
}

async function previewIngAdjunto(path, ext) {
  var res = _sb.storage.from(ING_ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(ING_ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
    url = signed.data && signed.data.signedUrl;
  }
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }

  var contentEl = document.getElementById('ing-adjunto-preview-content');
  if (ext === 'pdf') {
    contentEl.innerHTML = '<iframe src="' + url + '"></iframe>';
  } else {
    contentEl.innerHTML = '<img src="' + url + '" alt="Preview">';
  }
  document.getElementById('ing-adjunto-preview-overlay').classList.add('show');
}

function closeIngAdjuntoPreview() {
  document.getElementById('ing-adjunto-preview-overlay').classList.remove('show');
  document.getElementById('ing-adjunto-preview-content').innerHTML = '';
}

async function downloadIngAdjunto(path, filename) {
  var res = _sb.storage.from(ING_ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(ING_ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
    url = signed.data && signed.data.signedUrl;
  }
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || 'archivo';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function deleteIngAdjunto(path) {
  if (!confirm('¿Eliminar este archivo adjunto?')) return;
  var res = await _sb.storage.from(ING_ADJUNTOS_BUCKET).remove([path]);
  if (res.error) {
    showToast('Error al eliminar: ' + res.error.message, '#e74c3c');
    return;
  }
  showToast('Archivo eliminado', '#e67e22');
  await loadIngAdjuntos();
}

// Drag & drop for ingresos adjuntos
(function() {
  var dz = document.getElementById('ing-adjunto-dropzone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var input = document.getElementById('ing-adjunto-input');
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleIngAdjuntoUpload(input);
  });
})();

// ── Tab switching ──
function switchIngTab(tab) {
  var tabs = ['ingresos', 'ing-detalle'];
  tabs.forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var btn = document.getElementById('tab-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) btn.style.background = t === tab ? '#1a5276' : '#718096';
  });
  if (tab === 'ing-detalle') renderDetalleIng();
}

// ── Excel export (grouped) ──
function exportIngresosExcel() {
  var groups = applySortIng(filteredIng());
  if (!groups.length) { showToast('No hay ingresos para exportar', '#e74c3c'); return; }

  var data = groups.map(function(g) {
    var lines = getLinesForIng(g);
    var totalQty = lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
    return {
      'Fecha': g.Fecha || '',
      'Origen': g.Origen || '',
      'Emp. Origen': getSiglaIng(g.Empresa_Origen),
      'Emp. Destino': getSiglaIng(g.Empresa_Destino),
      'Líneas': lines.length,
      'Unidades': totalQty,
      'Responsable': g.Responsable || '',
      'Rem. Origen': g.Remision_Origen || '',
      'Rem. Destino': g.Remision_Destino || '',
      'Observaciones': g.Observaciones || ''
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:12},{wch:18},{wch:14},{wch:14},{wch:8},{wch:10},{wch:18},{wch:14},{wch:14},{wch:30}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ingresos');
  XLSX.writeFile(wb, 'Ingresos_' + today() + '.xlsx');
  showToast('Excel exportado: ' + groups.length + ' ingresos', '#27ae60');
}

// ── Detail view (flat per-product line) ──
var detIngSort = [];

function filteredIngLines() {
  var fo = document.getElementById('f-origen').value;
  var feo = document.getElementById('f-emp-orig').value;
  var fed = document.getElementById('f-emp-dest').value;
  var fp = document.getElementById('f-prod').value;
  var fr = document.getElementById('f-resp').value;
  var fdEl = document.getElementById('f-fec-desde');
  var fhEl = document.getElementById('f-fec-hasta');
  var fdesde = fdEl ? fdEl.value : '';
  var fhasta = fhEl ? fhEl.value : '';
  var ft = document.getElementById('f-txt').value.toLowerCase();

  return ingresos.filter(function(r) {
    if (fo && r.Origen !== fo) return false;
    if (feo && r.Empresa_Origen !== feo) return false;
    if (fed && r.Empresa_Destino !== fed) return false;
    if (fr && r.Responsable !== fr) return false;
    if (fp && r.Producto !== fp) return false;
    if (fdesde || fhasta) {
      var fp10 = String(r.Fecha || '').slice(0, 10);
      if (!fp10) return false;
      if (fdesde && fp10 < fdesde) return false;
      if (fhasta && fp10 > fhasta) return false;
    }
    if (ft) {
      var hay = [r.Origen, r.Empresa_Origen, r.Empresa_Destino, r.Responsable, r.Remision_Origen, r.Remision_Destino, r.Producto, r.Presentacion, r.Observaciones].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function toggleDetIngSort(col, e) {
  var shift = e && e.shiftKey;
  var idx = detIngSort.findIndex(function(l) { return l.col === col; });
  if (shift) { if (idx >= 0) detIngSort.splice(idx, 1); }
  else if (idx >= 0) { if (detIngSort[idx].dir === 'asc') detIngSort[idx].dir = 'desc'; else detIngSort.splice(idx, 1); }
  else { detIngSort.push({ col: col, dir: 'asc' }); }
  renderDetalleIng();
}

function clearDetIngSort() { detIngSort = []; renderDetalleIng(); }

function renderDetalleIng() {
  var panel = document.getElementById('panel-ing-detalle');
  if (!panel || panel.style.display === 'none') return;

  var rows = filteredIngLines();

  if (detIngSort.length) {
    rows = [].concat(rows).sort(function(a, b) {
      for (var s = 0; s < detIngSort.length; s++) {
        var col = detIngSort[s].col, dir = detIngSort[s].dir;
        var va, vb;
        if (col === 'fecha') { va = +(new Date(a.Fecha||0)); vb = +(new Date(b.Fecha||0)); }
        else if (col === 'origen') { va = (a.Origen||'').toLowerCase(); vb = (b.Origen||'').toLowerCase(); }
        else if (col === 'emp_orig') { va = getSiglaIng(a.Empresa_Origen); vb = getSiglaIng(b.Empresa_Origen); }
        else if (col === 'emp_dest') { va = getSiglaIng(a.Empresa_Destino); vb = getSiglaIng(b.Empresa_Destino); }
        else if (col === 'producto') { va = (a.Producto||'').toLowerCase(); vb = (b.Producto||'').toLowerCase(); }
        else if (col === 'presentacion') { va = (a.Presentacion||'').toLowerCase(); vb = (b.Presentacion||'').toLowerCase(); }
        else if (col === 'cantidad') { va = Number(a.Cantidad)||0; vb = Number(b.Cantidad)||0; }
        else if (col === 'responsable') { va = (a.Responsable||'').toLowerCase(); vb = (b.Responsable||'').toLowerCase(); }
        else if (col === 'rem_orig') { va = (a.Remision_Origen||''); vb = (b.Remision_Origen||''); }
        else if (col === 'rem_dest') { va = (a.Remision_Destino||''); vb = (b.Remision_Destino||''); }
        else { va = ''; vb = ''; }
        var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  document.getElementById('det-ing-count').textContent = '(' + rows.length + ' líneas)';

  var cols = [
    { id: 'fecha', label: 'Fecha' },
    { id: 'origen', label: 'Origen' },
    { id: 'emp_orig', label: 'Emp. Origen' },
    { id: 'emp_dest', label: 'Emp. Destino' },
    { id: 'producto', label: 'Producto' },
    { id: 'presentacion', label: 'Presentación' },
    { id: 'cantidad', label: 'Cantidad' },
    { id: 'responsable', label: 'Responsable' },
    { id: 'rem_orig', label: 'Rem. Origen' },
    { id: 'rem_dest', label: 'Rem. Destino' },
  ];

  document.getElementById('det-ing-head').innerHTML = cols.map(function(c) {
    var idx = detIngSort.findIndex(function(l) { return l.col === c.id; });
    var cls = idx >= 0 ? (detIngSort[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = idx >= 0 && detIngSort.length > 1 ? '<span style="font-size:0.6rem;vertical-align:super;color:#2980b9">' + (idx+1) + '</span>' : '';
    return '<th class="sortable ' + cls + '" onclick="toggleDetIngSort(\'' + c.id + '\',event)">' + c.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');

  var btn = document.getElementById('btn-clear-sort-det-ing');
  if (btn) btn.style.display = detIngSort.length ? 'inline-block' : 'none';

  var tbody = document.getElementById('det-ing-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No hay líneas con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    var origenBadge = r.Origen === 'Devolución'
      ? '<span class="badge b-rec">Devolución</span>'
      : '<span class="badge b-par">' + (r.Origen||'—') + '</span>';
    return '<tr>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha) + '</td>' +
      '<td>' + origenBadge + '</td>' +
      '<td title="' + (r.Empresa_Origen||'') + '"><span class="sigla-badge ' + getSiglaClassIng(r.Empresa_Origen) + '">' + getSiglaIng(r.Empresa_Origen) + '</span></td>' +
      '<td title="' + (r.Empresa_Destino||'') + '"><span class="sigla-badge ' + getSiglaClassIng(r.Empresa_Destino) + '">' + getSiglaIng(r.Empresa_Destino) + '</span></td>' +
      '<td style="font-weight:600">' + (r.Producto||'—') + '</td>' +
      '<td>' + (r.Presentacion||'—') + '</td>' +
      '<td class="money" style="font-weight:700">' + (Number(r.Cantidad)||0).toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Responsable||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Remision_Origen||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Remision_Destino||'—') + '</td>' +
    '</tr>';
  }).join('');
}

// ── Excel export (detail/flat) ──
function exportDetalleIngExcel() {
  var rows = filteredIngLines();
  if (!rows.length) { showToast('No hay líneas para exportar', '#e74c3c'); return; }

  var data = rows.map(function(r) {
    return {
      'Fecha': r.Fecha || '',
      'Origen': r.Origen || '',
      'Emp. Origen': getSiglaIng(r.Empresa_Origen),
      'Emp. Destino': getSiglaIng(r.Empresa_Destino),
      'Producto': r.Producto || '',
      'Presentación': r.Presentacion || '',
      'Cantidad': Number(r.Cantidad) || 0,
      'Responsable': r.Responsable || '',
      'Rem. Origen': r.Remision_Origen || '',
      'Rem. Destino': r.Remision_Destino || '',
      'Observaciones': r.Observaciones || ''
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:12},{wch:18},{wch:14},{wch:14},{wch:30},{wch:14},{wch:10},{wch:18},{wch:14},{wch:14},{wch:30}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle Ingresos');
  XLSX.writeFile(wb, 'Ingresos_Detalle_' + today() + '.xlsx');
  showToast('Excel detalle exportado: ' + rows.length + ' líneas', '#27ae60');
}

// ── Auto-load ──
loadIngresos();
loadCatalogo();
