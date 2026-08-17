// ── Reenvases ──

var allReenvases = [];
var filteredRe = [];
var reSortCols = [
  { id: 'Fecha', dir: 'desc' }
];
var reEditId = null;
var reDeleteId = null;
var productosCache = null;
var reLines = [{ producto: '', presentacion: '', cantidad: 0, observaciones: '' }];
var reProdACs = [];
var reEditProdAC = null;
var activeTab = 'buenos';
var reGroups = [];
var activeReGroup = null;

// ── Autocomplete engine ──

function reInitAC(input, opts) {
  var dd = document.createElement('div');
  dd.className = 'ac-dropdown';
  dd.style.display = 'none';
  document.body.appendChild(dd);
  var selIdx = -1, items = [];

  function pos() {
    var r = input.getBoundingClientRect();
    dd.style.top = r.bottom + 'px';
    dd.style.left = r.left + 'px';
    dd.style.width = Math.max(r.width, 250) + 'px';
  }

  function show() {
    var val = input.value.toLowerCase().trim();
    if (val.length < 2) { dd.style.display = 'none'; return; }
    var all = typeof opts.items === 'function' ? opts.items() : opts.items;
    items = all.filter(function(it) { return opts.match(it, val); }).slice(0, 10);
    if (!items.length) { dd.style.display = 'none'; return; }
    selIdx = -1;
    dd.innerHTML = items.map(function(it) { return '<div class="ac-item">' + opts.display(it) + '</div>'; }).join('');
    [].slice.call(dd.children).forEach(function(el, i) {
      el.addEventListener('mousedown', function(e) { e.preventDefault(); pick(i); });
    });
    pos();
    dd.style.display = 'block';
  }

  function pick(i) { if (items[i]) { opts.onSelect(items[i]); dd.style.display = 'none'; selIdx = -1; } }

  function hl() {
    [].slice.call(dd.children).forEach(function(el, j) { el.className = 'ac-item' + (j === selIdx ? ' active' : ''); });
    if (selIdx >= 0 && dd.children[selIdx]) dd.children[selIdx].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', show);
  input.addEventListener('focus', function() { if (input.value.trim().length >= 2) show(); });
  input.addEventListener('blur', function() { setTimeout(function() { dd.style.display = 'none'; }, 150); });
  input.addEventListener('keydown', function(e) {
    if (dd.style.display === 'none' || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); hl(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); hl(); }
    else if (e.key === 'Enter' && selIdx >= 0) { e.preventDefault(); pick(selIdx); }
    else if (e.key === 'Escape') { dd.style.display = 'none'; }
  });

  return { destroy: function() { if (dd.parentElement) dd.parentElement.removeChild(dd); } };
}

function acOpts(input, presSelector) {
  return {
    items: function() {
      var emp = document.getElementById('re-empresa').value;
      var prods = productosCache || [];
      if (emp) {
        var filtered = prods.filter(function(p) { return p.empresa === emp; });
        if (filtered.length) prods = filtered;
      }
      return prods;
    },
    display: function(p) {
      return '<strong>' + escHtml(p.producto) + '</strong>' +
             (p.presentacion ? ' <span class="ac-sub">— ' + escHtml(p.presentacion) + '</span>' : '') +
             (p.empresa ? '<div class="ac-sub">' + escHtml(p.empresa) + '</div>' : '');
    },
    match: function(p, val) {
      return ((p.producto || '') + ' ' + (p.presentacion || '') + ' ' + (p.empresa || '')).toLowerCase().indexOf(val) >= 0;
    },
    onSelect: function(p) {
      input.value = p.producto || '';
      var presEl = typeof presSelector === 'string' ? document.querySelector(presSelector) : presSelector;
      if (presEl) presEl.value = p.presentacion || '';
      syncReLinesFromDOM();
    }
  };
}

function destroyReProdACs() { reProdACs.forEach(function(ac) { ac.destroy(); }); reProdACs = []; }

function setupReProdAutocomplete() {
  destroyReProdACs();
  if (!productosCache) return;
  [].slice.call(document.querySelectorAll('.re-prod')).forEach(function(input, i) {
    var presInputs = document.querySelectorAll('.re-pres');
    reProdACs.push(reInitAC(input, acOpts(input, presInputs[i])));
  });
}

function setupReEditProdAC() {
  if (reEditProdAC) { reEditProdAC.destroy(); reEditProdAC = null; }
  if (!productosCache) return;
  var input = document.getElementById('re-edit-producto');
  reEditProdAC = reInitAC(input, acOpts(input, '#re-edit-presentacion'));
}

function switchReTab(tab) {
  activeTab = tab;
  var btnB = document.getElementById('tab-buenos');
  var btnNC = document.getElementById('tab-no-conforme');
  btnB.className = 're-tab' + (tab === 'buenos' ? ' active-buenos' : '');
  btnNC.className = 're-tab' + (tab === 'no_conforme' ? ' active-nc' : '');

  var isBuenos = tab === 'buenos';
  document.getElementById('card-title-re').textContent = isBuenos
    ? 'Salidas — Productos Buenos'
    : 'Salidas — Producto No Conforme';

  var btnNew = document.getElementById('btn-new-re');
  btnNew.style.background = isBuenos ? '#d35400' : '#c0392b';
  btnNew.textContent = isBuenos ? '🏭 Nueva Salida (Buenos)' : '🏭 Nueva Salida (No Conforme)';

  populateReFilters();
  applyReFilters();
}

function getBodegaFromTab() {
  return activeTab === 'buenos' ? 'Productos Buenos' : 'Producto No Conforme';
}

var EMPRESAS_SIGLA = {
  'PARCELAR DE COLOMBIA SAS': 'PARCELAR',
  'GREEN AGROSOLUCIONES DE COLOMBIA SAS': 'GREEN',
  'SOLUCIONES INTEGRALES RESO SAS': 'RESO',
  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS': 'IASO',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS': 'IAS'
};

// ── Grouping ──

function keyOfRe(r) {
  return [r.Fecha||'', r.Empresa||'', r.Empresa_Destino||'', r.Planta||'', r.Remision||'', r.Remision_Destino||'', r.Bodega||'Productos Buenos'].join('||');
}

function rebuildReGroups() {
  var seen = {};
  var order = [];
  var bodegaActual = getBodegaFromTab();
  allReenvases.forEach(function(r) {
    var bod = r.Bodega || 'Productos Buenos';
    if (bod !== bodegaActual) return;
    var k = keyOfRe(r);
    if (!seen[k]) {
      seen[k] = {
        _key: k, Fecha: r.Fecha, Empresa: r.Empresa, Empresa_Destino: r.Empresa_Destino,
        Planta: r.Planta, Remision: r.Remision, Remision_Destino: r.Remision_Destino,
        Bodega: bod
      };
      order.push(k);
    }
  });
  reGroups = order.map(function(k) { return seen[k]; });
}

function getLinesForRe(g) {
  return allReenvases.filter(function(r) { return keyOfRe(r) === g._key; });
}

// ── Sort columns ──

var SORT_COLS_RE = [
  { id:'Fecha',     label:'Fecha',        fn: function(g) { return +new Date(g.Fecha||0); } },
  { id:'Empresa',   label:'Empresa',      fn: function(g) { return (EMPRESAS_SIGLA[g.Empresa]||g.Empresa||'').toLowerCase(); } },
  { id:'Emp_Dest',  label:'Emp. Destino', fn: function(g) { return (EMPRESAS_SIGLA[g.Empresa_Destino]||g.Empresa_Destino||'').toLowerCase(); } },
  { id:'Planta',    label:'Planta',       fn: function(g) { return (g.Planta||'').toLowerCase(); } },
  { id:'lineas',    label:'Líneas',       fn: function(g) { return getLinesForRe(g).length; } },
  { id:'unidades',  label:'Unidades',     fn: function(g) { return getLinesForRe(g).reduce(function(s,r) { return s + (Number(r.Cantidad)||0); }, 0); } },
  { id:'Remision',  label:'N° Remisión',  fn: function(g) { return (g.Remision||'').toLowerCase(); } },
];

// ── Load data ──

async function loadReenvases() {
  await _authReady;
  populateEmpresaSelect('re-empresa');
  populateEmpresaSelect('re-empresa-destino', '— Sin traslado —', ['CHIA ABAGO']);
  var loadZone = document.getElementById('load-zone');
  var main = document.getElementById('main');
  var loadErr = document.getElementById('load-error');
  var btnRetry = document.getElementById('btn-retry');
  loadZone.style.display = 'block';
  main.style.display = 'none';
  loadErr.style.display = 'none';
  btnRetry.style.display = 'none';

  var res = await apiGet('getReenvases');
  if (!res.ok) {
    loadErr.textContent = res.error || 'Error al cargar';
    loadErr.style.display = 'block';
    btnRetry.style.display = 'inline-block';
    return;
  }

  allReenvases = res.reenvases || [];
  loadZone.style.display = 'none';
  main.style.display = 'block';
  populateReFilters();
  applyReFilters();
}

// ── Filters ──

function populateReFilters() {
  var empresas = {};
  var bodegaActual = getBodegaFromTab();
  allReenvases.forEach(function(r) {
    var bod = r.Bodega || 'Productos Buenos';
    if (bod !== bodegaActual) return;
    if (r.Empresa && AUTH.hasCompany(r.Empresa)) empresas[r.Empresa] = 1;
  });

  var sel = document.getElementById('f-empresa');
  var prev = sel.value;
  sel.innerHTML = '<option value="">Todas</option>';
  Object.keys(empresas).sort().forEach(function(v) {
    var sigla = EMPRESAS_SIGLA[v] || v;
    sel.innerHTML += '<option value="' + v.replace(/"/g, '&quot;') + '">' + sigla + '</option>';
  });
  sel.value = prev;
}

function applyReFilters() {
  var fEmp = document.getElementById('f-empresa').value;
  var fTxt = document.getElementById('f-txt').value.toLowerCase().trim();

  rebuildReGroups();

  filteredRe = reGroups.filter(function(g) {
    if (fEmp && g.Empresa !== fEmp) return false;
    if (fTxt) {
      var lines = getLinesForRe(g);
      var hay = [g.Empresa, g.Empresa_Destino, g.Planta, g.Remision, g.Remision_Destino].join(' ');
      lines.forEach(function(l) { hay += ' ' + (l.Producto||'') + ' ' + (l.Presentacion||'') + ' ' + (l.Observaciones||''); });
      if (hay.toLowerCase().indexOf(fTxt) < 0) return false;
    }
    return true;
  });

  filteredRe = applySortRe(filteredRe);
  renderReTable();
  updateReStats();
}

function clearReenvaseFilters() {
  document.getElementById('f-empresa').value = '';
  document.getElementById('f-txt').value = '';
  applyReFilters();
}

document.getElementById('f-empresa').addEventListener('change', applyReFilters);
document.getElementById('f-txt').addEventListener('input', applyReFilters);

// ── Stats ──

function updateReStats() {
  var conRem = 0, sinRem = 0, totalCant = 0;
  var bodegaActual = getBodegaFromTab();
  rebuildReGroups();
  var totalTab = reGroups.length;
  reGroups.forEach(function(g) {
    if (g.Remision && g.Remision.trim()) conRem++;
    else sinRem++;
    var lines = getLinesForRe(g);
    lines.forEach(function(r) { totalCant += Number(r.Cantidad) || 0; });
  });
  document.getElementById('s-total').textContent = totalTab;
  document.getElementById('s-con-remision').textContent = conRem;
  document.getElementById('s-sin-remision').textContent = sinRem;
  document.getElementById('s-cantidad').textContent = totalCant;
}

// ── Sort ──

function applySortRe(rows) {
  if (!reSortCols.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < reSortCols.length; si++) {
      var lvl = reSortCols[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS_RE.length; ci++) { if (SORT_COLS_RE[ci].id === lvl.id) { col = SORT_COLS_RE[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function toggleSortRe(id, e) {
  var shift = e && e.shiftKey;
  var idx = -1;
  for (var i = 0; i < reSortCols.length; i++) { if (reSortCols[i].id === id) { idx = i; break; } }
  if (shift) { if (idx >= 0) reSortCols.splice(idx, 1); }
  else if (idx >= 0) { if (reSortCols[idx].dir === 'asc') reSortCols[idx].dir = 'desc'; else reSortCols.splice(idx, 1); }
  else { reSortCols.push({ id: id, dir: 'asc' }); }
  applyReFilters();
}

function clearSortRe() {
  reSortCols = [];
  applyReFilters();
}

// ── Render table ──

function renderReHeader() {
  var cols = [
    { label:'#', id:null },
    { label:'Fecha', id:'Fecha' },
    { label:'Empresa', id:'Empresa' },
    { label:'Emp. Destino', id:'Emp_Dest' },
    { label:'Planta', id:'Planta' },
    { label:'Líneas', id:'lineas' },
    { label:'Unidades', id:'unidades' },
    { label:'N° Remisión', id:'Remision' },
    { label:'Rem. Destino', id:null },
    { label:'Acción', id:null },
  ];
  var thead = document.getElementById('t-head-re');
  thead.innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = -1;
    for (var i = 0; i < reSortCols.length; i++) { if (reSortCols[i].id === col.id) { lvlIdx = i; break; } }
    var active = lvlIdx >= 0;
    var lvl = active ? reSortCols[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = reSortCols.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSortRe(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');

  var btnSort = document.getElementById('btn-clear-sort-re');
  btnSort.style.display = reSortCols.length ? 'inline-block' : 'none';
}

function renderReTable() {
  var groups = filteredRe;

  renderReHeader();

  document.getElementById('row-ct').textContent = '(' + groups.length + ' mostrados)';

  var tbody = document.getElementById('t-body-re');
  if (!groups.length) {
    var emptyMsg = activeTab === 'buenos'
      ? 'No hay registros en Bodega Productos Buenos'
      : 'No hay registros en Bodega Producto No Conforme';
    tbody.innerHTML = '<tr><td colspan="10" class="empty">' + emptyMsg + '</td></tr>';
    return;
  }

  tbody.innerHTML = groups.map(function(g, i) {
    var lines = getLinesForRe(g);
    var totalQty = lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
    var sigla = EMPRESAS_SIGLA[g.Empresa] || g.Empresa || '—';
    var siglaCls = 'sigla-' + (EMPRESAS_SIGLA[g.Empresa] || 'DEFAULT');
    var siglaDestino = g.Empresa_Destino ? (EMPRESAS_SIGLA[g.Empresa_Destino] || g.Empresa_Destino) : '';
    var siglaDCls = g.Empresa_Destino ? 'sigla-' + (EMPRESAS_SIGLA[g.Empresa_Destino] || 'DEFAULT') : '';
    var plantaShort = (g.Planta || '').replace('Planta ', '');

    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(g.Fecha) + '</td>' +
      '<td><span class="sigla-badge ' + siglaCls + '">' + escHtml(sigla) + '</span></td>' +
      '<td>' + (siglaDestino ? '<span class="sigla-badge ' + siglaDCls + '">' + escHtml(siglaDestino) + '</span>' : '—') + '</td>' +
      '<td>' + escHtml(plantaShort || '—') + '</td>' +
      '<td style="text-align:center"><span style="background:#fef5ec;color:#d35400;padding:2px 9px;border-radius:12px;font-size:0.75rem;font-weight:700">' + lines.length + '</span></td>' +
      '<td style="text-align:center;font-weight:700">' + totalQty.toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.78rem">' + escHtml(g.Remision || '—') + '</td>' +
      '<td style="font-size:0.78rem">' + escHtml(g.Remision_Destino || '—') + '</td>' +
      '<td><button class="btn-ver" onclick="openReDetail(' + i + ')">📦 Ver salida</button></td>' +
    '</tr>';
  }).join('');

  refreshReDetail();
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Detail Modal ──

function openReDetail(idx) {
  var groups = filteredRe;
  activeReGroup = groups[idx];
  if (!activeReGroup) return;

  var g = activeReGroup;
  var sigla = EMPRESAS_SIGLA[g.Empresa] || g.Empresa || '';
  document.getElementById('re-detail-title').textContent = '🏭 Detalle de Salida';
  document.getElementById('re-detail-sub').textContent = fmtDate(g.Fecha) + ' · ' + sigla + (g.Planta ? ' → ' + g.Planta : '');

  document.getElementById('red-bodega').textContent = g.Bodega || '—';
  document.getElementById('red-empresa').textContent = g.Empresa || '—';
  document.getElementById('red-emp-dest').textContent = g.Empresa_Destino ? (EMPRESAS_SIGLA[g.Empresa_Destino] || g.Empresa_Destino) : '—';
  document.getElementById('red-planta').textContent = g.Planta || '—';
  document.getElementById('red-fecha').textContent = fmtDate(g.Fecha);
  document.getElementById('red-remision').textContent = g.Remision || '—';
  document.getElementById('red-rem-dest').textContent = g.Remision_Destino || '—';

  renderReDetailProducts();
  document.getElementById('re-detail-overlay').classList.add('show');
}

function renderReDetailProducts() {
  var g = activeReGroup;
  if (!g) return;
  var lines = getLinesForRe(g);

  document.getElementById('red-line-ct').textContent = '(' + lines.length + ' líneas)';
  var totalUnits = lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
  document.getElementById('red-total').textContent = 'Total: ' + totalUnits.toLocaleString('es-CO') + ' unidades';
  document.getElementById('red-footer-info').textContent = lines.length + ' producto(s) · ' + totalUnits.toLocaleString('es-CO') + ' unidades';

  var tbody = document.getElementById('red-products');
  if (!lines.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty">No hay productos en esta salida.</div></td></tr>';
    return;
  }

  tbody.innerHTML = lines.map(function(l, i) {
    var obs = (l.Observaciones || '');
    if (obs.length > 40) obs = obs.substring(0, 40) + '…';
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="font-weight:600">' + escHtml(l.Producto||'—') + '</td>' +
      '<td>' + escHtml(l.Presentacion||'—') + '</td>' +
      '<td style="text-align:right;font-weight:700">' + (Number(l.Cantidad)||0) + '</td>' +
      '<td style="font-size:0.78rem">' + escHtml(obs||'—') + '</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="editReenvase(' + l.id + ')" title="Editar">✏️</button>' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="openDeleteReFromDetail(' + i + ',' + (l.id||0) + ')" title="Eliminar">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function closeReDetail() {
  document.getElementById('re-detail-overlay').classList.remove('show');
  activeReGroup = null;
}

function refreshReDetail() {
  if (!activeReGroup) return;
  var overlay = document.getElementById('re-detail-overlay');
  if (!overlay || !overlay.classList.contains('show')) return;
  var key = activeReGroup._key;
  var newGroup = null;
  for (var i = 0; i < reGroups.length; i++) {
    if (reGroups[i]._key === key) { newGroup = reGroups[i]; break; }
  }
  if (newGroup) {
    activeReGroup = newGroup;
    renderReDetailProducts();
  } else {
    closeReDetail();
  }
}

document.getElementById('re-detail-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeReDetail(); });

function addProductToReGroup() {
  if (!activeReGroup) return;
  var g = activeReGroup;
  reEditId = null;
  document.getElementById('re-bodega').value = g.Bodega || getBodegaFromTab();
  document.getElementById('re-modal-title').textContent = '🏭 Agregar Producto';
  document.getElementById('btn-save-re').textContent = '✓ Registrar salida';
  document.getElementById('btn-save-re').disabled = false;

  document.getElementById('re-empresa').value = g.Empresa || '';
  document.getElementById('re-empresa-destino').value = g.Empresa_Destino || '';
  var wrapDest = document.getElementById('re-remision-destino-wrap');
  if (wrapDest) wrapDest.style.display = g.Empresa_Destino ? '' : 'none';
  document.getElementById('re-planta').value = g.Planta || '';
  document.getElementById('re-fecha').value = toDateInput(g.Fecha);
  document.getElementById('re-remision').value = g.Remision || '';
  var elRemDest = document.getElementById('re-remision-destino');
  if (elRemDest) elRemDest.value = g.Remision_Destino || '';
  var elRem = document.getElementById('re-remision');
  elRem.readOnly = false; elRem.style.background = ''; elRem.placeholder = 'N° remisión';
  if (elRemDest) { elRemDest.readOnly = false; elRemDest.style.background = ''; elRemDest.placeholder = 'N° remisión destino'; }
  var chkRem = document.getElementById('re-remision-auto');
  if (chkRem) chkRem.checked = false;
  var chkRemDest = document.getElementById('re-remision-destino-auto');
  if (chkRemDest) chkRemDest.checked = false;

  document.getElementById('re-multi-lines').style.display = '';
  document.getElementById('re-edit-single').style.display = 'none';

  reLines = [{ producto: '', presentacion: '', cantidad: 0, observaciones: '' }];
  renderReLines();
  document.getElementById('re-overlay').classList.add('show');
  loadProductosCache().then(function() { setupReProdAutocomplete(); });
}

// ── Enviar Remisión PDF ──

function enviarRemisionReenvase() {
  if (!activeReGroup) return;
  var g = activeReGroup;
  var lines = getLinesForRe(g);
  if (!lines.length) { showToast('No hay productos en esta salida.', '#e67e22'); return; }

  var remNum = (g.Remision || '').trim();
  if (!remNum) { showToast('Esta salida no tiene número de remisión asignado.', '#e67e22'); return; }

  if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
    showToast('Módulo de notificaciones no cargado.', '#e74c3c'); return;
  }

  var empresa = g.Empresa || '';
  var entregas = lines.map(function(l) {
    return {
      producto: l.Producto || '',
      presentacion: l.Presentacion || '',
      cantidad: Number(l.Cantidad) || 0,
      valor_unitario: 0,
      valor_total: 0,
      bonificado: 'No',
      observaciones: l.Observaciones || ''
    };
  }).filter(function(p) { return p.cantidad > 0 || p.producto; });

  var left = [
    ['Empresa', EMPRESAS_SIGLA[g.Empresa] || g.Empresa || ''],
    ['Bodega', g.Bodega || ''],
    ['Planta', g.Planta || '']
  ];
  var right = [
    ['Emp. Destino', g.Empresa_Destino ? (EMPRESAS_SIGLA[g.Empresa_Destino] || g.Empresa_Destino) : ''],
    ['Rem. Salida', g.Remision || ''],
    ['Rem. Entrada', g.Remision_Destino || '']
  ];

  var tienePlanta = !!(g.Planta && /planta/i.test(g.Planta));
  var data = {
    empresa: empresa,
    consecutivo: '',
    doc_title: tienePlanta ? 'REMISION DE SALIDA A PRODUCCION' : 'REMISION DE SALIDA',
    doc_number: remNum,
    ref_label: null,
    date_label: 'Fecha salida',
    fecha_entrega: g.Fecha || '',
    remision: remNum,
    left_fields: left,
    right_fields: right,
    entregas: entregas,
    qty_header: 'Cantidad',
    file_prefix: 'Remision_Salida',
    last_col_header: 'Observaciones'
  };

  var sigla = EMPRESAS_SIGLA[empresa] || '';
  NOTIF.openModalEnviar({
    modulo: 'reenvases',
    referencia: (sigla ? sigla + ' · ' : '') + 'Rem ' + remNum,
    titulo: 'Remisión salida #' + remNum + ' — ' + (EMPRESAS_SIGLA[g.Empresa] || g.Empresa || ''),
    buildDoc: function() {
      var r = generarRemisionPDF(Object.assign({}, data, { return_doc: true, copies: ['COPIA - CONTABILIDAD'] }));
      return r ? r.doc : null;
    }
  });
}

// ── View modal (legacy removed — now using detail modal) ──

// ── New / Edit modal ──

async function loadProductosCache() {
  if (productosCache && productosCache.length) return;
  try {
    var res = await apiGet('getMaestroProductos');
    if (res.ok && res.productos && res.productos.length) {
      productosCache = res.productos;
    } else {
      productosCache = null;
    }
  } catch (e) {
    productosCache = null;
  }
}

async function openNewReenvase() {
  reEditId = null;
  document.getElementById('re-bodega').value = getBodegaFromTab();
  document.getElementById('re-modal-title').textContent = '🏭 Nueva Salida a producción';
  document.getElementById('btn-save-re').textContent = '✓ Registrar salida';
  document.getElementById('btn-save-re').disabled = false;

  document.getElementById('re-empresa').value = '';
  document.getElementById('re-empresa-destino').value = '';
  var wrapDest = document.getElementById('re-remision-destino-wrap');
  if (wrapDest) wrapDest.style.display = 'none';
  document.getElementById('re-planta').value = '';
  document.getElementById('re-fecha').value = today();
  document.getElementById('re-remision').value = '';
  var elRemDest = document.getElementById('re-remision-destino');
  if (elRemDest) { elRemDest.value = ''; elRemDest.readOnly = false; elRemDest.style.background = ''; elRemDest.placeholder = 'N° remisión destino'; }
  var chkRem = document.getElementById('re-remision-auto');
  if (chkRem) chkRem.checked = false;
  var chkRemDest = document.getElementById('re-remision-destino-auto');
  if (chkRemDest) chkRemDest.checked = false;
  var elRem = document.getElementById('re-remision');
  elRem.readOnly = false; elRem.style.background = ''; elRem.placeholder = 'N° remisión';

  document.getElementById('re-multi-lines').style.display = '';
  document.getElementById('re-edit-single').style.display = 'none';

  reLines = [{ producto: '', presentacion: '', cantidad: 0, observaciones: '' }];
  renderReLines();
  document.getElementById('re-overlay').classList.add('show');
  await loadProductosCache();
  setupReProdAutocomplete();
}

async function editReenvase(id) {
  var r = allReenvases.filter(function(x) { return x.id === id; })[0];
  if (!r) return;

  reEditId = id;
  document.getElementById('re-bodega').value = r.Bodega || 'Productos Buenos';
  document.getElementById('re-modal-title').textContent = '✏️ Editar Salida';
  document.getElementById('btn-save-re').textContent = '✓ Guardar cambios';
  document.getElementById('btn-save-re').disabled = false;

  document.getElementById('re-empresa').value = r.Empresa || '';
  document.getElementById('re-empresa-destino').value = r.Empresa_Destino || '';
  var wrapDest = document.getElementById('re-remision-destino-wrap');
  if (wrapDest) wrapDest.style.display = r.Empresa_Destino ? '' : 'none';
  document.getElementById('re-planta').value = r.Planta || '';
  document.getElementById('re-fecha').value = toDateInput(r.Fecha);
  document.getElementById('re-remision').value = r.Remision || '';
  var elRemDest = document.getElementById('re-remision-destino');
  if (elRemDest) elRemDest.value = r.Remision_Destino || '';
  var elRemE = document.getElementById('re-remision');
  elRemE.readOnly = false; elRemE.style.background = ''; elRemE.placeholder = 'N° remisión';
  var chkRemE = document.getElementById('re-remision-auto'); if (chkRemE) chkRemE.checked = false;
  if (elRemDest) { elRemDest.readOnly = false; elRemDest.style.background = ''; elRemDest.placeholder = 'N° remisión destino'; }
  var chkRemDestE = document.getElementById('re-remision-destino-auto'); if (chkRemDestE) chkRemDestE.checked = false;

  document.getElementById('re-multi-lines').style.display = 'none';
  document.getElementById('re-edit-single').style.display = '';
  document.getElementById('re-edit-producto').value = r.Producto || '';
  document.getElementById('re-edit-presentacion').value = r.Presentacion || '';
  document.getElementById('re-edit-cantidad').value = r.Cantidad || 0;
  document.getElementById('re-edit-observaciones').value = r.Observaciones || '';

  document.getElementById('re-overlay').classList.add('show');
  await loadProductosCache();
  setupReEditProdAC();
}

function closeReModal() {
  document.getElementById('re-overlay').classList.remove('show');
  reEditId = null;
  reLines = [];
  destroyReProdACs();
  if (reEditProdAC) { reEditProdAC.destroy(); reEditProdAC = null; }
}

document.getElementById('re-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeReModal(); });
document.getElementById('re-overlay').addEventListener('scroll', function() {
  [].slice.call(document.querySelectorAll('.ac-dropdown')).forEach(function(dd) { dd.style.display = 'none'; });
}, true);

// ── Product lines ──

function renderReLines() {
  var tbody = document.getElementById('re-lines');
  tbody.innerHTML = reLines.map(function(p, i) {
    var prod = (p.producto || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var pres = (p.presentacion || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var obs = (p.observaciones || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td><input class="ef re-prod" data-i="' + i + '" type="text" value="' + prod + '" placeholder="Nombre del producto" autocomplete="off" style="min-width:140px"></td>' +
      '<td><input class="ef re-pres" data-i="' + i + '" type="text" value="' + pres + '" placeholder="Ej: 100CC, 1L" style="width:120px"></td>' +
      '<td><input class="ef re-cant" data-i="' + i + '" type="number" min="0" value="' + (p.cantidad || '') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td><input class="ef re-obs" data-i="' + i + '" type="text" value="' + obs + '" placeholder="Observación" style="min-width:100px"></td>' +
      '<td style="text-align:center">' +
        (reLines.length > 1
          ? '<button onclick="removeReLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>'
          : '') +
      '</td></tr>';
  }).join('');
  setupReProdAutocomplete();
}

function addReLine() {
  syncReLinesFromDOM();
  reLines.push({ producto: '', presentacion: '', cantidad: 0, observaciones: '' });
  renderReLines();
}

function removeReLine(i) {
  syncReLinesFromDOM();
  reLines.splice(i, 1);
  renderReLines();
}

function syncReLinesFromDOM() {
  var prods = document.querySelectorAll('.re-prod');
  var press = document.querySelectorAll('.re-pres');
  var cants = document.querySelectorAll('.re-cant');
  var obss = document.querySelectorAll('.re-obs');
  prods.forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (reLines[idx]) reLines[idx].producto = el.value;
  });
  press.forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (reLines[idx]) reLines[idx].presentacion = el.value;
  });
  cants.forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (reLines[idx]) reLines[idx].cantidad = Number(el.value) || 0;
  });
  obss.forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (reLines[idx]) reLines[idx].observaciones = el.value;
  });
}

// ── Save ──

async function saveReenvase() {
  var btn = document.getElementById('btn-save-re');
  var empresa = document.getElementById('re-empresa').value;
  var empresaDestino = document.getElementById('re-empresa-destino').value;
  var planta = document.getElementById('re-planta').value;
  var fecha = document.getElementById('re-fecha').value;
  var remision = document.getElementById('re-remision').value.trim();

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!planta && !empresaDestino) { showToast('Selecciona la planta de destino o la empresa destino', '#e74c3c'); return; }
  if (empresaDestino && empresaDestino === empresa) { showToast('La empresa destino debe ser diferente a la empresa origen', '#e74c3c'); return; }
  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }

  if (reEditId) {
    var producto = document.getElementById('re-edit-producto').value.trim();
    var presentacion = document.getElementById('re-edit-presentacion').value.trim();
    var cantidad = Number(document.getElementById('re-edit-cantidad').value) || 0;
    var observaciones = document.getElementById('re-edit-observaciones').value.trim();

    if (!producto) { showToast('Ingresa el producto', '#e74c3c'); return; }
    if (!cantidad) { showToast('Ingresa la cantidad', '#e74c3c'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    var reEditRow = allReenvases.filter(function(x) { return x.id === reEditId; })[0];
    try {
      var result = await apiPost({
        action: 'editarReenvase', row: reEditId,
        Empresa: empresa, Empresa_Destino: empresaDestino, Planta: planta, Producto: producto, Presentacion: presentacion,
        Cantidad: cantidad, Remision: remision, Fecha: fecha,
        Observaciones: observaciones, Bodega: document.getElementById('re-bodega').value,
        _remision_existente: !!(reEditRow && (reEditRow.Remision || '').trim()),
        _remision_destino_existente: !!(reEditRow && (reEditRow.Remision_Destino || '').trim()),
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeReModal();
      var toastRe = ['✅ Salida actualizada'];
      if (result.remision) toastRe.push('RS: ' + result.remision);
      if (result.remision_destino) toastRe.push('RE: ' + result.remision_destino);
      showToast(toastRe.join(' · '));
      await loadReenvases();
    } catch (err) {
      showToast('❌ Error: ' + err.message, '#e74c3c');
      btn.disabled = false;
      btn.textContent = '✓ Guardar cambios';
    }
    return;
  }

  // New mode — multi-line
  syncReLinesFromDOM();
  var productosValidos = reLines.filter(function(p) { return p.producto && p.cantidad > 0; });
  if (!productosValidos.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var remAutoSalida = remision;
    var remAutoEntrada = '';
    if (!remAutoSalida && empresa) {
      remAutoSalida = await generarRemisionConsecutivo(empresa, 'SALIDA');
    }
    if (empresaDestino && empresaDestino !== empresa) {
      remAutoEntrada = await generarRemisionConsecutivo(empresaDestino, 'ENTRADA');
    }
    var added = 0;
    var bodegaVal = document.getElementById('re-bodega').value;
    for (var i = 0; i < productosValidos.length; i++) {
      var p = productosValidos[i];
      var result = await apiPost({
        action: 'agregarReenvase',
        Empresa: empresa, Empresa_Destino: empresaDestino, Planta: planta, Producto: p.producto, Presentacion: p.presentacion,
        Cantidad: p.cantidad, Remision: remAutoSalida, Remision_Destino: remAutoEntrada, Fecha: fecha,
        Observaciones: (p.observaciones || '').trim(), Bodega: bodegaVal
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar línea ' + (i + 1));
      added++;
    }
    closeReModal();
    var toastReNew = ['✅ Salida registrada: ' + added + ' producto(s)'];
    if (remAutoSalida) toastReNew.push('RS: ' + remAutoSalida);
    if (remAutoEntrada) toastReNew.push('RE: ' + remAutoEntrada);
    showToast(toastReNew.join(' · '));
    await loadReenvases();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar salida';
  }
}

// ── Delete ──

function openDeleteReFromDetail(lineIdx, id) {
  reDeleteId = id;
  var g = activeReGroup;
  if (!g) return;
  var lines = getLinesForRe(g);
  var r = lines[lineIdx] || {};
  document.getElementById('del-re-msg').textContent = '¿Eliminar este producto de la salida?';
  document.getElementById('del-re-detail').innerHTML =
    'Producto: <strong>' + escHtml(r.Producto||'—') + '</strong> · ' + (r.Cantidad||0) + ' uds<br>' +
    'Salida: ' + (EMPRESAS_SIGLA[g.Empresa]||g.Empresa||'—') + ' · ' + fmtDate(g.Fecha) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará este producto de la salida.</span>';
  document.getElementById('btn-del-re-confirm').disabled = false;
  document.getElementById('btn-del-re-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-re-overlay').classList.add('show');
}

function closeDeleteRe() {
  document.getElementById('delete-re-overlay').classList.remove('show');
  reDeleteId = null;
}
document.getElementById('delete-re-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteRe(); });

async function confirmDeleteRe() {
  if (!reDeleteId) return;
  var btn = document.getElementById('btn-del-re-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarReenvase', row: reDeleteId });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDeleteRe();
    showToast('🗑️ Producto eliminado');
    await loadReenvases();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Auto-load ──
loadReenvases();
loadProductosCache();
