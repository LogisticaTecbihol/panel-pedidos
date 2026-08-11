// ── Reenvases ──

var allReenvases = [];
var filteredRe = [];
var reSortCols = [];
var reEditId = null;
var reDeleteId = null;
var productosCache = null;
var reLines = [{ producto: '', presentacion: '', cantidad: 0, observaciones: '' }];
var reProdACs = [];
var reEditProdAC = null;
var activeTab = 'buenos';

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

var RE_COLS = [
  { key: 'Empresa', label: 'Empresa', sortable: true },
  { key: 'Empresa_Destino', label: 'Emp. Destino', sortable: true },
  { key: 'Planta', label: 'Planta', sortable: true },
  { key: 'Fecha', label: 'Fecha', sortable: true, fmt: 'date' },
  { key: 'Producto', label: 'Producto', sortable: true },
  { key: 'Presentacion', label: 'Presentación', sortable: true },
  { key: 'Cantidad', label: 'Cantidad', sortable: true, cls: 'money' },
  { key: 'Remision', label: 'N° Remisión', sortable: true },
  { key: 'Observaciones', label: 'Observaciones', sortable: false },
  { key: '_actions', label: 'Acciones' }
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

  var bodegaActual = getBodegaFromTab();
  filteredRe = allReenvases.filter(function(r) {
    var bod = r.Bodega || 'Productos Buenos';
    if (bod !== bodegaActual) return false;
    if (fEmp && r.Empresa !== fEmp) return false;
    if (fTxt) {
      var hay = [r.Empresa, r.Empresa_Destino, r.Planta, r.Producto, r.Presentacion, r.Remision, r.Observaciones]
        .join(' ').toLowerCase();
      if (hay.indexOf(fTxt) < 0) return false;
    }
    return true;
  });

  sortReData();
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
  var conRem = 0, sinRem = 0, totalCant = 0, totalTab = 0;
  var bodegaActual = getBodegaFromTab();
  allReenvases.forEach(function(r) {
    var bod = r.Bodega || 'Productos Buenos';
    if (bod !== bodegaActual) return;
    totalTab++;
    if (r.Remision && r.Remision.trim()) conRem++;
    else sinRem++;
    totalCant += Number(r.Cantidad) || 0;
  });
  document.getElementById('s-total').textContent = totalTab;
  document.getElementById('s-con-remision').textContent = conRem;
  document.getElementById('s-sin-remision').textContent = sinRem;
  document.getElementById('s-cantidad').textContent = totalCant;
}

// ── Sort ──

function sortReData() {
  if (!reSortCols.length) return;
  filteredRe.sort(function(a, b) {
    for (var i = 0; i < reSortCols.length; i++) {
      var col = reSortCols[i];
      var va = a[col.key] == null ? '' : a[col.key];
      var vb = b[col.key] == null ? '' : b[col.key];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      var cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return col.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function toggleSortRe(key) {
  var existing = reSortCols.filter(function(c) { return c.key === key; })[0];
  if (existing) {
    if (existing.dir === 'asc') existing.dir = 'desc';
    else reSortCols = reSortCols.filter(function(c) { return c.key !== key; });
  } else {
    reSortCols.push({ key: key, dir: 'asc' });
  }
  applyReFilters();
}

function clearSortRe() {
  reSortCols = [];
  applyReFilters();
}

// ── Render table ──

function renderReTable() {
  var thead = document.getElementById('t-head-re');
  thead.innerHTML = RE_COLS.map(function(col) {
    if (!col.sortable) return '<th>' + col.label + '</th>';
    var sc = reSortCols.filter(function(c) { return c.key === col.key; })[0];
    var cls = 'sortable' + (sc ? (sc.dir === 'asc' ? ' sort-asc' : ' sort-desc') : '');
    var badge = '';
    if (sc && reSortCols.length > 1) {
      badge = '<span class="sort-badge">' + (reSortCols.indexOf(sc) + 1) + '</span>';
    }
    return '<th class="' + cls + '" onclick="toggleSortRe(\'' + col.key + '\')">' +
      col.label + '<span class="sort-icon"></span>' + badge + '</th>';
  }).join('');

  var btnSort = document.getElementById('btn-clear-sort-re');
  btnSort.style.display = reSortCols.length ? 'inline-block' : 'none';

  var tbody = document.getElementById('t-body-re');
  if (!filteredRe.length) {
    var emptyMsg = activeTab === 'buenos'
      ? 'No hay registros en Bodega Productos Buenos'
      : 'No hay registros en Bodega Producto No Conforme';
    tbody.innerHTML = '<tr><td colspan="' + RE_COLS.length + '" class="empty">' + emptyMsg + '</td></tr>';
    document.getElementById('row-ct').textContent = '';
    return;
  }

  document.getElementById('row-ct').textContent = '(' + filteredRe.length + ' registro' + (filteredRe.length !== 1 ? 's' : '') + ')';

  tbody.innerHTML = filteredRe.map(function(r) {
    var sigla = EMPRESAS_SIGLA[r.Empresa] || r.Empresa || '—';
    var siglaCls = 'sigla-' + (EMPRESAS_SIGLA[r.Empresa] || 'DEFAULT');
    var siglaDestino = r.Empresa_Destino ? (EMPRESAS_SIGLA[r.Empresa_Destino] || r.Empresa_Destino) : '';
    var siglaDCls = r.Empresa_Destino ? 'sigla-' + (EMPRESAS_SIGLA[r.Empresa_Destino] || 'DEFAULT') : '';
    var obs = (r.Observaciones || '');
    if (obs.length > 40) obs = obs.substring(0, 40) + '…';

    var plantaShort = (r.Planta || '').replace('Planta ', '');

    return '<tr style="cursor:pointer" onclick="viewReenvase(' + r.id + ')">' +
      '<td><span class="sigla-badge ' + siglaCls + '">' + escHtml(sigla) + '</span></td>' +
      '<td>' + (siglaDestino ? '<span class="sigla-badge ' + siglaDCls + '">' + escHtml(siglaDestino) + '</span>' : '—') + '</td>' +
      '<td>' + escHtml(plantaShort || '—') + '</td>' +
      '<td>' + fmtDate(r.Fecha) + '</td>' +
      '<td>' + escHtml(r.Producto || '—') + '</td>' +
      '<td>' + escHtml(r.Presentacion || '—') + '</td>' +
      '<td class="money">' + (r.Cantidad || 0) + '</td>' +
      '<td>' + escHtml(r.Remision || '—') + '</td>' +
      '<td>' + escHtml(obs || '—') + '</td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()">' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="editReenvase(' + r.id + ')">✏️</button> ' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="deleteReenvase(' + r.id + ')">🗑️</button>' : '') +
      '</td></tr>';
  }).join('');
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── View modal ──

function viewReenvase(id) {
  var r = allReenvases.filter(function(x) { return x.id === id; })[0];
  if (!r) return;

  var sigla = EMPRESAS_SIGLA[r.Empresa] || r.Empresa || '—';
  document.getElementById('view-re-meta').innerHTML =
    '<span>🏢 ' + escHtml(sigla) + '</span>' +
    '<span>📅 ' + fmtDate(r.Fecha) + '</span>';

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem">' +
    field('Bodega', r.Bodega || 'Productos Buenos') +
    field('Empresa (Origen)', EMPRESAS_SIGLA[r.Empresa] || r.Empresa) +
    field('Empresa Destino', r.Empresa_Destino ? (EMPRESAS_SIGLA[r.Empresa_Destino] || r.Empresa_Destino) : '') +
    field('Planta de destino', r.Planta) +
    field('Fecha', fmtDate(r.Fecha)) +
    field('N° Remisión', r.Remision) +
    field('Producto', r.Producto) +
    field('Presentación', r.Presentacion) +
    field('Cantidad', r.Cantidad) +
    '</div>';

  if (r.Observaciones) {
    html += '<div style="margin-top:14px"><div style="font-weight:700;font-size:0.78rem;color:#4a5568;text-transform:uppercase;margin-bottom:4px">Observaciones</div>' +
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">' + escHtml(r.Observaciones) + '</div></div>';
  }

  document.getElementById('view-re-body').innerHTML = html;
  document.getElementById('view-re-overlay').classList.add('show');
}

function field(label, val) {
  return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">' + label + '</span><br><span style="color:#2d3748">' + (val || '—') + '</span></div>';
}

function closeViewRe() {
  document.getElementById('view-re-overlay').classList.remove('show');
}
document.getElementById('view-re-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeViewRe(); });

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
  document.getElementById('re-planta').value = '';
  document.getElementById('re-fecha').value = today();
  document.getElementById('re-remision').value = '';

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
  document.getElementById('re-planta').value = r.Planta || '';
  document.getElementById('re-fecha').value = toDateInput(r.Fecha);
  document.getElementById('re-remision').value = r.Remision || '';

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

    try {
      var result = await apiPost({
        action: 'editarReenvase', row: reEditId,
        Empresa: empresa, Empresa_Destino: empresaDestino, Planta: planta, Producto: producto, Presentacion: presentacion,
        Cantidad: cantidad, Remision: remision, Fecha: fecha,
        Observaciones: observaciones, Bodega: document.getElementById('re-bodega').value
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeReModal();
      showToast('✅ Salida actualizada');
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
    var added = 0;
    for (var i = 0; i < productosValidos.length; i++) {
      var p = productosValidos[i];
      var result = await apiPost({
        action: 'agregarReenvase',
        Empresa: empresa, Empresa_Destino: empresaDestino, Planta: planta, Producto: p.producto, Presentacion: p.presentacion,
        Cantidad: p.cantidad, Remision: remision, Fecha: fecha,
        Observaciones: (p.observaciones || '').trim(), Bodega: document.getElementById('re-bodega').value
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar línea ' + (i + 1));
      added++;
    }
    closeReModal();
    showToast('✅ Salida registrada: ' + added + ' producto(s)');
    await loadReenvases();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar salida';
  }
}

// ── Delete ──

function deleteReenvase(id) {
  var r = allReenvases.filter(function(x) { return x.id === id; })[0];
  if (!r) return;
  reDeleteId = id;
  document.getElementById('del-re-msg').textContent = '¿Eliminar este registro de salida a producción?';
  document.getElementById('del-re-detail').textContent =
    'Producto: ' + (r.Producto || 'Sin producto') + ' — Cantidad: ' + (r.Cantidad || 0);
  document.getElementById('btn-del-re-confirm').disabled = false;
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
    showToast('✅ Eliminado correctamente');
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
