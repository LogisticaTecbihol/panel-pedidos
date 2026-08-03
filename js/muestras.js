// ── Solicitud de Muestras ──

var allMuestras = [];
var filteredMu = [];
var muSortCols = [];
var muEditId = null;
var muDeleteIds = [];
var muLines = [{ producto: '', presentacion: '', cantidad: 0 }];
var productosCache = null;
var muProdACs = [];
var muEditProdAC = null;
var muGeoAC = null;
var muViewingId = null;

// ── Autocomplete engine ──

function muInitAC(input, opts) {
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

function destroyMuProdACs() { muProdACs.forEach(function(ac) { ac.destroy(); }); muProdACs = []; }

function setupMuProdAutocomplete() {
  destroyMuProdACs();
  if (!productosCache) return;
  [].slice.call(document.querySelectorAll('.mu-prod')).forEach(function(input, i) {
    muProdACs.push(muInitAC(input, {
      items: function() {
        var emp = document.getElementById('mu-empresa').value;
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
        var presInputs = document.querySelectorAll('.mu-pres');
        if (presInputs[i]) presInputs[i].value = p.presentacion || '';
        syncMuLinesFromDOM();
      }
    }));
  });
}

function setupMuEditProdAC() {
  if (muEditProdAC) { muEditProdAC.destroy(); muEditProdAC = null; }
  if (!productosCache) return;
  var input = document.getElementById('mu-edit-producto');
  muEditProdAC = muInitAC(input, {
    items: function() {
      var emp = document.getElementById('mu-empresa').value;
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
      document.getElementById('mu-edit-presentacion').value = p.presentacion || '';
    }
  });
}

var EMPRESAS_SIGLA = {
  'PARCELAR DE COLOMBIA SAS': 'PARCELAR',
  'GREEN AGROSOLUCIONES DE COLOMBIA SAS': 'GREEN',
  'SOLUCIONES INTEGRALES RESO SAS': 'RESO',
  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS': 'IASO',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS': 'IAS'
};

var MU_COLS = [
  { key: 'Empresa', label: 'Empresa', sortable: true },
  { key: 'Consecutivo', label: 'Consec.', sortable: true },
  { key: 'Fecha_Solicitud', label: 'Fecha Solicitud', sortable: true, fmt: 'date' },
  { key: 'Responsable', label: 'Responsable', sortable: true },
  { key: 'Municipio', label: 'Municipio', sortable: true },
  { key: 'Tipo_Cultivo', label: 'Tipo Cultivo', sortable: true },
  { key: '_nProds', label: 'Productos', sortable: true, cls: 'money' },
  { key: 'Remision', label: 'Remisión', sortable: true },
  { key: 'Solicitante', label: 'Solicitante', sortable: true },
  { key: 'Estado', label: 'Estado', sortable: true },
  { key: '_actions', label: 'Acciones' }
];

var groupedMu = [];

// ── Load data ──

async function loadMuestras() {
  await _authReady;
  populateEmpresaSelect('mu-empresa');
  var loadZone = document.getElementById('load-zone');
  var main = document.getElementById('main');
  var loadErr = document.getElementById('load-error');
  var btnRetry = document.getElementById('btn-retry');
  loadZone.style.display = 'block';
  main.style.display = 'none';
  loadErr.style.display = 'none';
  btnRetry.style.display = 'none';

  var res = await apiGet('getMuestras');
  if (!res.ok) {
    loadErr.textContent = res.error || 'Error al cargar';
    loadErr.style.display = 'block';
    btnRetry.style.display = 'inline-block';
    return;
  }

  allMuestras = res.muestras || [];
  loadZone.style.display = 'none';
  main.style.display = 'block';
  populateMuFilters();
  applyMuFilters();
}

// ── Filters ──

function populateMuFilters() {
  var responsables = {};
  var municipios = {};
  allMuestras.forEach(function(r) {
    if (r.Responsable) responsables[r.Responsable] = 1;
    if (r.Municipio) municipios[r.Municipio] = 1;
  });

  var selResp = document.getElementById('f-responsable');
  var prevResp = selResp.value;
  selResp.innerHTML = '<option value="">Todos</option>';
  Object.keys(responsables).sort().forEach(function(v) {
    selResp.innerHTML += '<option value="' + v.replace(/"/g, '&quot;') + '">' + v + '</option>';
  });
  selResp.value = prevResp;

  var selMun = document.getElementById('f-municipio');
  var prevMun = selMun.value;
  selMun.innerHTML = '<option value="">Todos</option>';
  Object.keys(municipios).sort().forEach(function(v) {
    selMun.innerHTML += '<option value="' + v.replace(/"/g, '&quot;') + '">' + v + '</option>';
  });
  selMun.value = prevMun;
}

function groupMuestras(rows) {
  var map = {};
  var order = [];
  rows.forEach(function(r) {
    var key = (r.Empresa || '') + '||' + (r.Consecutivo || r.id);
    if (!map[key]) {
      map[key] = { head: r, lines: [], key: key };
      order.push(key);
    }
    map[key].lines.push(r);
  });
  return order.map(function(k) {
    var g = map[k];
    g.head._nProds = g.lines.length;
    g.head._lineIds = g.lines.map(function(l) { return l.id; });
    return g.head;
  });
}

function applyMuFilters() {
  var fResp = document.getElementById('f-responsable').value;
  var fMun = document.getElementById('f-municipio').value;
  var fEst = document.getElementById('f-estado').value;
  var fTxt = document.getElementById('f-txt').value.toLowerCase().trim();

  filteredMu = allMuestras.filter(function(r) {
    if (fResp && r.Responsable !== fResp) return false;
    if (fMun && r.Municipio !== fMun) return false;
    if (fEst && r.Estado !== fEst) return false;
    if (fTxt) {
      var hay = [r.Empresa, r.Consecutivo, r.Responsable, r.Municipio, r.Producto, r.Presentacion,
                 r.Tipo_Cultivo, r.Solicitante, r.Autoriza, r.Objetivo, r.Remision]
        .join(' ').toLowerCase();
      if (hay.indexOf(fTxt) < 0) return false;
    }
    return true;
  });

  groupedMu = groupMuestras(filteredMu);
  sortMuData();
  renderMuTable();
  updateMuStats();
}

function clearMuestraFilters() {
  document.getElementById('f-responsable').value = '';
  document.getElementById('f-municipio').value = '';
  document.getElementById('f-estado').value = '';
  document.getElementById('f-txt').value = '';
  applyMuFilters();
}

document.getElementById('f-responsable').addEventListener('change', applyMuFilters);
document.getElementById('f-municipio').addEventListener('change', applyMuFilters);
document.getElementById('f-estado').addEventListener('change', applyMuFilters);
document.getElementById('f-txt').addEventListener('input', applyMuFilters);

// ── Stats ──

function updateMuStats() {
  var allGrouped = groupMuestras(allMuestras);
  var despachadas = 0;
  var pendientes = 0;
  var totalProd = 0;
  allGrouped.forEach(function(r) {
    if (r.Estado === 'Despachada') despachadas++;
    else pendientes++;
  });
  allMuestras.forEach(function(r) { totalProd += Number(r.Cantidad) || 0; });
  document.getElementById('s-total').textContent = allGrouped.length;
  document.getElementById('s-despachadas').textContent = despachadas;
  document.getElementById('s-pendientes').textContent = pendientes;
  document.getElementById('s-productos').textContent = totalProd;
}

// ── Sort ──

function sortMuData() {
  if (!muSortCols.length) return;
  groupedMu.sort(function(a, b) {
    for (var i = 0; i < muSortCols.length; i++) {
      var col = muSortCols[i];
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

function toggleSortMu(key) {
  var existing = muSortCols.filter(function(c) { return c.key === key; })[0];
  if (existing) {
    if (existing.dir === 'asc') existing.dir = 'desc';
    else muSortCols = muSortCols.filter(function(c) { return c.key !== key; });
  } else {
    muSortCols.push({ key: key, dir: 'asc' });
  }
  applyMuFilters();
}

function clearSortMu() {
  muSortCols = [];
  applyMuFilters();
}

// ── Render table ──

function renderMuTable() {
  var thead = document.getElementById('t-head-mu');
  thead.innerHTML = MU_COLS.map(function(col) {
    if (!col.sortable) return '<th>' + col.label + '</th>';
    var sc = muSortCols.filter(function(c) { return c.key === col.key; })[0];
    var cls = 'sortable' + (sc ? (sc.dir === 'asc' ? ' sort-asc' : ' sort-desc') : '');
    var badge = '';
    if (sc && muSortCols.length > 1) {
      badge = '<span class="sort-badge">' + (muSortCols.indexOf(sc) + 1) + '</span>';
    }
    return '<th class="' + cls + '" onclick="toggleSortMu(\'' + col.key + '\')">' +
      col.label + '<span class="sort-icon"></span>' + badge + '</th>';
  }).join('');

  var btnSort = document.getElementById('btn-clear-sort-mu');
  btnSort.style.display = muSortCols.length ? 'inline-block' : 'none';

  var tbody = document.getElementById('t-body-mu');
  if (!groupedMu.length) {
    tbody.innerHTML = '<tr><td colspan="' + MU_COLS.length + '" class="empty">No hay solicitudes de muestras registradas</td></tr>';
    document.getElementById('row-ct').textContent = '';
    return;
  }

  document.getElementById('row-ct').textContent = '(' + groupedMu.length + ' solicitud' + (groupedMu.length !== 1 ? 'es' : '') + ')';

  tbody.innerHTML = groupedMu.map(function(r) {
    var estadoBadge = r.Estado === 'Despachada'
      ? '<span class="badge b-ent">Despachada</span>'
      : '<span class="badge b-rec">Pendiente</span>';

    var sigla = EMPRESAS_SIGLA[r.Empresa] || r.Empresa || '—';
    var siglaCls = 'sigla-' + (EMPRESAS_SIGLA[r.Empresa] || 'DEFAULT');

    return '<tr style="cursor:pointer" onclick="viewMuestra(' + r.id + ')">' +
      '<td><span class="sigla-badge ' + siglaCls + '">' + escHtml(sigla) + '</span></td>' +
      '<td>' + (r.Consecutivo || '—') + '</td>' +
      '<td>' + fmtDate(r.Fecha_Solicitud) + '</td>' +
      '<td>' + (r.Responsable || '—') + '</td>' +
      '<td>' + (r.Municipio || '—') + '</td>' +
      '<td>' + (r.Tipo_Cultivo || '—') + '</td>' +
      '<td class="money">' + (r._nProds || 0) + '</td>' +
      '<td>' + (r.Remision || '—') + '</td>' +
      '<td>' + (r.Solicitante || '—') + '</td>' +
      '<td>' + estadoBadge + '</td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()">' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="editMuestra(' + r.id + ')">✏️</button> ' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="deleteSolicitud(\'' + escHtml((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) + '\')">🗑️</button>' : '') +
      '</td></tr>';
  }).join('');
}

// ── View modal ──

function viewMuestra(id) {
  var rows = allMuestras.filter(function(r) { return r.id === id; });
  if (!rows.length) return;
  var r = rows[0];

  muViewingId = id;
  var consec = r.Consecutivo || '';
  var emp = r.Empresa || '';
  var sameConsec = allMuestras.filter(function(x) { return x.Consecutivo === consec && consec && (x.Empresa || '') === emp; });

  document.getElementById('view-mu-meta').innerHTML =
    '<span>📋 Consecutivo: ' + (consec || '—') + '</span>' +
    '<span>📅 ' + fmtDate(r.Fecha_Solicitud) + '</span>' +
    '<span>👤 ' + (r.Responsable || '—') + '</span>';

  var remVal = (r.Remision || '').replace(/"/g, '&quot;');
  var fDespachoVal = r.Fecha_Despacho ? toDateInput(r.Fecha_Despacho) : '';
  var editField = function(label, id, type, val, placeholder) {
    return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">' + label + '</span><br>' +
      '<input type="' + type + '" id="' + id + '" class="ef" value="' + val + '"' +
      (placeholder ? ' placeholder="' + placeholder + '"' : '') +
      ' style="padding:4px 8px;font-size:0.85rem;width:90%;margin-top:2px"></div>';
  };

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem">' +
    field('Empresa', EMPRESAS_SIGLA[r.Empresa] || r.Empresa) +
    field('Fecha Solicitud', fmtDate(r.Fecha_Solicitud)) +
    field('Responsable', r.Responsable) +
    field('Departamento', r.Departamento) +
    field('Municipio', r.Municipio) +
    field('Tipo de Cultivo', r.Tipo_Cultivo) +
    field('Solicitante', r.Solicitante) +
    field('Quien Autoriza', r.Autoriza) +
    field('Estado', r.Estado) +
    field('Fecha Aplicación', fmtDate(r.Fecha_Aplicacion)) +
    field('Fecha Seguimiento', fmtDate(r.Fecha_Seguimiento)) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem;background:#f0fdf4;padding:12px 14px;border-radius:8px;border:1px solid #bbf7d0">' +
    editField('N° Remisión', 'mu-view-remision', 'text', remVal, 'N° remisión') +
    editField('Fecha Despacho', 'mu-view-fecha-despacho', 'date', fDespachoVal, '') +
    '</div>';

  if (r.Objetivo) {
    html += '<div style="margin-bottom:14px"><div style="font-weight:700;font-size:0.78rem;color:#4a5568;text-transform:uppercase;margin-bottom:4px">Objetivo</div>' +
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">' + escHtml(r.Objetivo) + '</div></div>';
  }

  if (sameConsec.length) {
    html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">' +
      '<div style="font-weight:700;font-size:0.84rem;color:#2d3748">📦 Productos solicitados (' + sameConsec.length + ')</div>' +
      '<button onclick="saveEntregas()" style="background:#27ae60;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:700" id="btn-save-entregas">💾 Guardar entregas</button>' +
      '</div>';
    html += '<table style="font-size:0.82rem;width:100%"><thead><tr style="background:#f7fafc"><th>Producto</th><th>Presentación</th><th style="text-align:right">Cantidad</th><th style="text-align:right;width:90px">Entregada</th><th></th></tr></thead><tbody>';
    sameConsec.forEach(function(x) {
      var cantEnt = x.Cant_Entregada != null && x.Cant_Entregada !== '' ? x.Cant_Entregada : '';
      html += '<tr><td>' + (x.Producto || '—') + '</td><td>' + (x.Presentacion || '—') + '</td><td style="text-align:right">' + (x.Cantidad || 0) + '</td>' +
        '<td><input type="number" min="0" class="ef mu-view-cant-ent" data-id="' + x.id + '" value="' + cantEnt + '" style="width:70px;text-align:right;padding:4px 6px;font-size:0.82rem"></td>' +
        '<td style="white-space:nowrap">' + (AUTH.canEdit() ? '<button class="btn-edit" onclick="closeViewMu();editMuestra(' + x.id + ')" style="font-size:0.75rem;padding:3px 8px">✏️</button> ' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="closeViewMu();deleteMuestra(' + x.id + ')" style="font-size:0.75rem;padding:3px 8px">🗑️</button>' : '') + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  if (r.Observaciones) {
    html += '<div style="margin-top:14px"><div style="font-weight:700;font-size:0.78rem;color:#4a5568;text-transform:uppercase;margin-bottom:4px">Observaciones</div>' +
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">' + escHtml(r.Observaciones) + '</div></div>';
  }

  document.getElementById('view-mu-body').innerHTML = html;
  document.getElementById('view-mu-overlay').classList.add('show');
}

async function saveEntregas() {
  var remision = document.getElementById('mu-view-remision').value.trim();
  var fechaDespacho = document.getElementById('mu-view-fecha-despacho').value;
  var cantInputs = document.querySelectorAll('.mu-view-cant-ent');
  var updates = [];
  cantInputs.forEach(function(el) {
    var id = Number(el.getAttribute('data-id'));
    var cantVal = Number(el.value) || 0;
    updates.push({ id: id, Cant_Entregada: cantVal });
  });

  if (!updates.length) return;

  var btn = document.getElementById('btn-save-entregas');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      var row = allMuestras.filter(function(r) { return r.id === u.id; })[0];
      if (!row) continue;
      var estado = 'Despachada';
      var res = await apiPost({
        action: 'editarMuestra', row: u.id,
        Empresa: row.Empresa, Consecutivo: row.Consecutivo,
        Fecha_Solicitud: row.Fecha_Solicitud, Fecha_Despacho: fechaDespacho || row.Fecha_Despacho,
        Responsable: row.Responsable, Departamento: row.Departamento, Municipio: row.Municipio,
        Tipo_Cultivo: row.Tipo_Cultivo, Fecha_Aplicacion: row.Fecha_Aplicacion,
        Fecha_Seguimiento: row.Fecha_Seguimiento, Remision: remision,
        Solicitante: row.Solicitante, Autoriza: row.Autoriza,
        Estado: estado, Objetivo: row.Objetivo, Observaciones: row.Observaciones,
        Producto: row.Producto, Presentacion: row.Presentacion,
        Cantidad: row.Cantidad, Cant_Entregada: u.Cant_Entregada,
        Fecha_Entrega: row.Fecha_Entrega || ''
      });
      if (!res.ok) throw new Error(res.error || 'Error al guardar línea ' + u.id);
    }
    closeViewMu();
    showToast('✅ Entregas registradas');
    await loadMuestras();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '💾 Guardar entregas';
  }
}

function field(label, val) {
  return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">' + label + '</span><br><span style="color:#2d3748">' + (val || '—') + '</span></div>';
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function closeViewMu() {
  document.getElementById('view-mu-overlay').classList.remove('show');
  muViewingId = null;
}
document.getElementById('view-mu-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeViewMu(); });

// ── Exportar PDF (helpers) ──

function _muestraContext() {
  if (muViewingId == null) { showToast('No hay solicitud seleccionada.', '#e67e22'); return null; }
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    showToast('El generador de PDF aún no está listo. Intenta de nuevo en unos segundos.', '#e67e22');
    return null;
  }
  if (typeof generarRemisionPDF !== 'function') {
    showToast('Módulo de remisión no cargado.', '#e74c3c');
    return null;
  }
  var head = allMuestras.filter(function(r) { return r.id === muViewingId; })[0];
  if (!head) { showToast('Solicitud no encontrada.', '#e74c3c'); return null; }
  var consec = head.Consecutivo || '';
  var emp = head.Empresa || '';
  var rows = allMuestras.filter(function(x) { return x.Consecutivo === consec && consec && (x.Empresa || '') === emp; });
  if (!rows.length) rows = [head];
  return { head: head, consec: consec, rows: rows };
}

function _muestraEntregas(rows, useRequested) {
  var out = rows.map(function(x) {
    var cant;
    if (useRequested) {
      cant = Number(x.Cantidad) || 0;
    } else {
      var cantEnt = Number(x.Cant_Entregada) || 0;
      cant = cantEnt > 0 ? cantEnt : (Number(x.Cantidad) || 0);
    }
    return {
      producto: x.Producto || '',
      presentacion: x.Presentacion || '',
      cantidad: cant,
      valor_unitario: 0,
      valor_total: 0,
      bonificado: 'Sí'
    };
  }).filter(function(p) { return (p.cantidad || 0) > 0 || p.producto; });
  return out;
}

// ── Exportar Remisión PDF (mismo layout que Pedidos) ──

function exportarMuestraRemisionPDF(opts) {
  opts = opts || {};
  var ctx = _muestraContext();
  if (!ctx) return;
  var head = ctx.head;

  var remInput = document.getElementById('mu-view-remision');
  var fdInput = document.getElementById('mu-view-fecha-despacho');
  var remision = (remInput && remInput.value.trim()) || head.Remision || '';
  var fechaDespacho = (fdInput && fdInput.value) || head.Fecha_Despacho || '';

  if (!remision) {
    showToast('La remisión debe tener número asignado para imprimirse.', '#e67e22');
    return;
  }

  var entregas = _muestraEntregas(ctx.rows, false);
  if (!entregas.length) {
    showToast('No hay productos para incluir en la remisión.', '#e67e22');
    return;
  }

  var data = {
    empresa: head.Empresa || '',
    consecutivo: ctx.consec,
    ref_label: 'Solicitud de muestras',
    fecha_entrega: fechaDespacho || '',
    remision: remision,
    cliente: head.Solicitante || '',
    comercial: head.Responsable || '',
    municipio: head.Municipio || '',
    departamento: head.Departamento || '',
    entregas: entregas
  };
  if (opts.share) {
    if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
      showToast('Módulo de notificaciones no cargado.', '#e74c3c'); return;
    }
    var solicitudData = _dataMuestraSolicitud(ctx, head);
    var extras = [];
    if (solicitudData) {
      extras.push({
        buildDoc: function() {
          var r = generarRemisionPDF(Object.assign({}, solicitudData, { return_doc: true }));
          return r ? r.doc : null;
        },
        meta: {
          modulo: 'muestras',
          referencia: ctx.consec || '',
          titulo: 'Solicitud muestras #' + (ctx.consec || '') + ' — ' + (head.Solicitante || 'sin solicitante')
        }
      });
    }
    NOTIF.openModalEnviar({
      modulo: 'muestras',
      referencia: (ctx.consec || '') + ' · Rem ' + remision,
      titulo: 'Remisión muestras #' + remision + ' — ' + (head.Solicitante || 'sin solicitante'),
      buildDoc: function() {
        var r = generarRemisionPDF(Object.assign({}, data, { return_doc: true }));
        return r ? r.doc : null;
      },
      extras: extras
    });
    return;
  }
  generarRemisionPDF(data);
}

// ── Exportar Solicitud PDF (sin remisión, con campos originales) ──

function _dataMuestraSolicitud(ctx, head) {
  var entregas = _muestraEntregas(ctx.rows, true);
  if (!entregas.length) return null;
  var left = [
    ['Solicitante', head.Solicitante || ''],
    ['Responsable', head.Responsable || ''],
    ['Quien autoriza', head.Autoriza || ''],
    ['Tipo de cultivo', head.Tipo_Cultivo || ''],
    ['Municipio', head.Municipio || ''],
    ['Departamento', head.Departamento || '']
  ];
  var right = [
    ['Fecha aplicacion', head.Fecha_Aplicacion || ''],
    ['Fecha seguimiento', head.Fecha_Seguimiento || ''],
    ['Objetivo', head.Objetivo || '']
  ];
  return {
    empresa: head.Empresa || '',
    consecutivo: ctx.consec,
    doc_title: 'SOLICITUD DE MUESTRAS',
    doc_number: ctx.consec,
    ref_label: '',
    date_label: 'Fecha solicitud',
    fecha_entrega: head.Fecha_Solicitud || '',
    remision: '',
    left_fields: left,
    right_fields: right,
    entregas: entregas,
    qty_header: 'Cantidad',
    copies: [''],
    hide_signatures: true,
    file_prefix: 'Solicitud_Muestras'
  };
}

function exportarMuestraSolicitudPDF(opts) {
  opts = opts || {};
  var ctx = _muestraContext();
  if (!ctx) return;
  var head = ctx.head;

  var data = _dataMuestraSolicitud(ctx, head);
  if (!data) {
    showToast('No hay productos para incluir en la solicitud.', '#e67e22');
    return;
  }
  if (opts.share) {
    enviarRemisionPDF(data, {
      modulo: 'muestras',
      referencia: ctx.consec || '',
      titulo: 'Solicitud muestras #' + (ctx.consec || '') + ' — ' + (head.Solicitante || 'sin solicitante')
    });
    return;
  }
  generarRemisionPDF(data);
}

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

async function getNextConsecutivo(empresa) {
  if (!empresa) return '';
  var maxNum = 0;
  allMuestras.forEach(function(r) {
    if (r.Empresa === empresa) {
      var n = parseInt(r.Consecutivo, 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return String(maxNum + 1);
}

async function onEmpresaChange() {
  if (muEditId) return;
  var empresa = document.getElementById('mu-empresa').value;
  document.getElementById('mu-consecutivo').value = await getNextConsecutivo(empresa);
}

async function openNewMuestra() {
  muEditId = null;
  document.getElementById('mu-modal-title').textContent = '🧪 Nueva Solicitud de Muestras';
  document.getElementById('btn-save-mu').textContent = '✓ Registrar solicitud';
  document.getElementById('btn-save-mu').disabled = false;

  document.getElementById('mu-empresa').value = '';
  document.getElementById('mu-consecutivo').value = '';
  document.getElementById('mu-fecha-solicitud').value = today();
  document.getElementById('mu-fecha-despacho').value = '';
  document.getElementById('mu-responsable').value = '';
  document.getElementById('mu-departamento').value = '';
  document.getElementById('mu-municipio').value = '';
  document.getElementById('mu-tipo-cultivo').value = '';
  document.getElementById('mu-fecha-aplicacion').value = '';
  document.getElementById('mu-fecha-seguimiento').value = '';
  document.getElementById('mu-remision').value = '';
  document.getElementById('mu-solicitante').value = '';
  document.getElementById('mu-autoriza').value = '';
  document.getElementById('mu-estado').value = 'Pendiente';
  document.getElementById('mu-objetivo').value = '';
  document.getElementById('mu-observaciones').value = '';

  document.getElementById('mu-multi-lines').style.display = '';
  document.getElementById('mu-edit-single').style.display = 'none';

  muLines = [{ producto: '', presentacion: '', cantidad: 0 }];
  renderMuLines();
  document.getElementById('mu-overlay').classList.add('show');
  if (muGeoAC) { if (muGeoAC.deptAC) muGeoAC.deptAC.destroy(); if (muGeoAC.muniAC) muGeoAC.muniAC.destroy(); muGeoAC = null; }
  muGeoAC = setupGeoAutocomplete(document.getElementById('mu-departamento'), document.getElementById('mu-municipio'));
  await loadProductosCache();
  setupMuProdAutocomplete();
}

async function editMuestra(id) {
  var r = allMuestras.filter(function(x) { return x.id === id; })[0];
  if (!r) return;

  muEditId = id;
  document.getElementById('mu-modal-title').textContent = '✏️ Editar Solicitud';
  document.getElementById('btn-save-mu').textContent = '✓ Guardar cambios';
  document.getElementById('btn-save-mu').disabled = false;

  document.getElementById('mu-empresa').value = r.Empresa || '';
  document.getElementById('mu-consecutivo').value = r.Consecutivo || '';
  document.getElementById('mu-fecha-solicitud').value = toDateInput(r.Fecha_Solicitud);
  document.getElementById('mu-fecha-despacho').value = toDateInput(r.Fecha_Despacho);
  document.getElementById('mu-responsable').value = r.Responsable || '';
  document.getElementById('mu-departamento').value = r.Departamento || '';
  document.getElementById('mu-municipio').value = r.Municipio || '';
  document.getElementById('mu-tipo-cultivo').value = r.Tipo_Cultivo || '';
  document.getElementById('mu-fecha-aplicacion').value = toDateInput(r.Fecha_Aplicacion);
  document.getElementById('mu-fecha-seguimiento').value = toDateInput(r.Fecha_Seguimiento);
  document.getElementById('mu-remision').value = r.Remision || '';
  document.getElementById('mu-solicitante').value = r.Solicitante || '';
  document.getElementById('mu-autoriza').value = r.Autoriza || '';
  document.getElementById('mu-estado').value = r.Estado || 'Pendiente';
  document.getElementById('mu-objetivo').value = r.Objetivo || '';
  document.getElementById('mu-observaciones').value = r.Observaciones || '';

  document.getElementById('mu-multi-lines').style.display = 'none';
  document.getElementById('mu-edit-single').style.display = '';
  document.getElementById('mu-edit-producto').value = r.Producto || '';
  document.getElementById('mu-edit-presentacion').value = r.Presentacion || '';
  document.getElementById('mu-edit-cantidad').value = r.Cantidad || 0;
  document.getElementById('mu-edit-cant-entregada').value = r.Cant_Entregada != null ? r.Cant_Entregada : '';
  document.getElementById('mu-edit-fecha-entrega').value = toDateInput(r.Fecha_Entrega);

  document.getElementById('mu-overlay').classList.add('show');
  if (muGeoAC) { if (muGeoAC.deptAC) muGeoAC.deptAC.destroy(); if (muGeoAC.muniAC) muGeoAC.muniAC.destroy(); muGeoAC = null; }
  muGeoAC = setupGeoAutocomplete(document.getElementById('mu-departamento'), document.getElementById('mu-municipio'));
  await loadProductosCache();
  setupMuEditProdAC();
}

function closeMuModal() {
  document.getElementById('mu-overlay').classList.remove('show');
  muEditId = null;
  muLines = [];
  destroyMuProdACs();
  if (muEditProdAC) { muEditProdAC.destroy(); muEditProdAC = null; }
  if (muGeoAC) { if (muGeoAC.deptAC) muGeoAC.deptAC.destroy(); if (muGeoAC.muniAC) muGeoAC.muniAC.destroy(); muGeoAC = null; }
}

document.getElementById('mu-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeMuModal(); });
document.getElementById('mu-overlay').addEventListener('scroll', function() {
  [].slice.call(document.querySelectorAll('.ac-dropdown')).forEach(function(dd) { dd.style.display = 'none'; });
}, true);

// ── Product lines ──

function renderMuLines() {
  var tbody = document.getElementById('mu-lines');
  tbody.innerHTML = muLines.map(function(p, i) {
    var prod = (p.producto || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var pres = (p.presentacion || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td><input class="ef mu-prod" data-i="' + i + '" type="text" value="' + prod + '" placeholder="Nombre del producto" style="min-width:140px"></td>' +
      '<td><input class="ef mu-pres" data-i="' + i + '" type="text" value="' + pres + '" placeholder="Ej: 100CC, 1L" style="width:120px"></td>' +
      '<td><input class="ef mu-cant" data-i="' + i + '" type="number" min="0" value="' + (p.cantidad || '') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        (muLines.length > 1
          ? '<button onclick="removeMuLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>'
          : '') +
      '</td></tr>';
  }).join('');
  setupMuProdAutocomplete();
}

function addMuLine() {
  syncMuLinesFromDOM();
  muLines.push({ producto: '', presentacion: '', cantidad: 0 });
  renderMuLines();
}

function removeMuLine(i) {
  syncMuLinesFromDOM();
  muLines.splice(i, 1);
  renderMuLines();
}

function syncMuLinesFromDOM() {
  var prods = document.querySelectorAll('.mu-prod');
  var press = document.querySelectorAll('.mu-pres');
  var cants = document.querySelectorAll('.mu-cant');
  prods.forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (muLines[idx]) {
      muLines[idx].producto = el.value;
    }
  });
  press.forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (muLines[idx]) {
      muLines[idx].presentacion = el.value;
    }
  });
  cants.forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (muLines[idx]) {
      muLines[idx].cantidad = Number(el.value) || 0;
    }
  });
}

// ── Save ──

async function saveMuestra() {
  var btn = document.getElementById('btn-save-mu');

  if (muEditId) {
    var producto = document.getElementById('mu-edit-producto').value.trim();
    var presentacion = document.getElementById('mu-edit-presentacion').value.trim();
    var cantidad = Number(document.getElementById('mu-edit-cantidad').value) || 0;

    if (!producto) { showToast('Ingresa el producto', '#e74c3c'); return; }

    var cantEntregada = Number(document.getElementById('mu-edit-cant-entregada').value) || 0;
    var fechaEntrega = document.getElementById('mu-edit-fecha-entrega').value;
    var estado = document.getElementById('mu-estado').value;
    if (cantEntregada > 0) estado = 'Despachada';

    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    try {
      var result = await apiPost({
        action: 'editarMuestra',
        row: muEditId,
        Empresa: document.getElementById('mu-empresa').value,
        Consecutivo: document.getElementById('mu-consecutivo').value.trim(),
        Fecha_Solicitud: document.getElementById('mu-fecha-solicitud').value,
        Fecha_Despacho: document.getElementById('mu-fecha-despacho').value,
        Responsable: document.getElementById('mu-responsable').value.trim(),
        Departamento: document.getElementById('mu-departamento').value.trim(),
        Municipio: document.getElementById('mu-municipio').value.trim(),
        Tipo_Cultivo: document.getElementById('mu-tipo-cultivo').value.trim(),
        Fecha_Aplicacion: document.getElementById('mu-fecha-aplicacion').value,
        Fecha_Seguimiento: document.getElementById('mu-fecha-seguimiento').value,
        Remision: document.getElementById('mu-remision').value.trim(),
        Solicitante: document.getElementById('mu-solicitante').value.trim(),
        Autoriza: document.getElementById('mu-autoriza').value.trim(),
        Estado: estado,
        Objetivo: document.getElementById('mu-objetivo').value.trim(),
        Observaciones: document.getElementById('mu-observaciones').value.trim(),
        Producto: producto,
        Presentacion: presentacion,
        Cantidad: cantidad,
        Cant_Entregada: cantEntregada,
        Fecha_Entrega: fechaEntrega
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeMuModal();
      showToast('✅ Solicitud actualizada');
      await loadMuestras();
    } catch (err) {
      showToast('❌ Error: ' + err.message, '#e74c3c');
      btn.disabled = false;
      btn.textContent = '✓ Guardar cambios';
    }
    return;
  }

  // New mode
  syncMuLinesFromDOM();
  var empresa = document.getElementById('mu-empresa').value;
  var consecutivo = document.getElementById('mu-consecutivo').value.trim();
  var fechaSol = document.getElementById('mu-fecha-solicitud').value;
  var responsable = document.getElementById('mu-responsable').value.trim();

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!consecutivo) { showToast('Ingresa el consecutivo', '#e74c3c'); return; }
  if (!fechaSol) { showToast('Selecciona la fecha de solicitud', '#e74c3c'); return; }
  if (!responsable) { showToast('Ingresa el responsable', '#e74c3c'); return; }

  var productosValidos = muLines.filter(function(p) { return p.producto && p.cantidad > 0; });
  if (!productosValidos.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarMuestra',
      Empresa: empresa,
      Consecutivo: consecutivo,
      Fecha_Solicitud: fechaSol,
      Fecha_Despacho: document.getElementById('mu-fecha-despacho').value,
      Responsable: responsable,
      Departamento: document.getElementById('mu-departamento').value.trim(),
      Municipio: document.getElementById('mu-municipio').value.trim(),
      Tipo_Cultivo: document.getElementById('mu-tipo-cultivo').value.trim(),
      Fecha_Aplicacion: document.getElementById('mu-fecha-aplicacion').value,
      Fecha_Seguimiento: document.getElementById('mu-fecha-seguimiento').value,
      Remision: document.getElementById('mu-remision').value.trim(),
      Solicitante: document.getElementById('mu-solicitante').value.trim(),
      Autoriza: document.getElementById('mu-autoriza').value.trim(),
      Estado: document.getElementById('mu-estado').value,
      Objetivo: document.getElementById('mu-objetivo').value.trim(),
      Observaciones: document.getElementById('mu-observaciones').value.trim(),
      lineas: productosValidos.map(function(p) {
        return { Producto: p.producto, Presentacion: p.presentacion, Cantidad: p.cantidad };
      })
    });

    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeMuModal();
    showToast('✅ Solicitud creada: ' + (result.added || 0) + ' línea(s)');
    await loadMuestras();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar solicitud';
  }
}

// ── Delete ──

function deleteMuestra(id) {
  var r = allMuestras.filter(function(x) { return x.id === id; })[0];
  if (!r) return;
  muDeleteIds = [id];
  document.getElementById('del-mu-msg').textContent = '¿Eliminar esta línea de producto?';
  document.getElementById('del-mu-detail').textContent =
    'Producto: ' + (r.Producto || 'Sin producto') + ' — Cantidad: ' + (r.Cantidad || 0);
  document.getElementById('btn-del-mu-confirm').disabled = false;
  document.getElementById('delete-mu-overlay').classList.add('show');
}

function deleteSolicitud(key) {
  var parts = key.split('||');
  var empresa = parts[0];
  var consec = parts[1];
  var lines = allMuestras.filter(function(r) {
    return (r.Empresa || '') === empresa && (r.Consecutivo || String(r.id)) === consec;
  });
  if (!lines.length) return;
  muDeleteIds = lines.map(function(r) { return r.id; });
  document.getElementById('del-mu-msg').textContent = '¿Eliminar esta solicitud completa?';
  document.getElementById('del-mu-detail').textContent =
    'Consecutivo: ' + consec + ' — ' + lines.length + ' producto(s)';
  document.getElementById('btn-del-mu-confirm').disabled = false;
  document.getElementById('delete-mu-overlay').classList.add('show');
}

function closeDeleteMu() {
  document.getElementById('delete-mu-overlay').classList.remove('show');
  muDeleteIds = [];
}
document.getElementById('delete-mu-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteMu(); });

async function confirmDeleteMu() {
  if (!muDeleteIds.length) return;
  var btn = document.getElementById('btn-del-mu-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    for (var i = 0; i < muDeleteIds.length; i++) {
      var result = await apiPost({ action: 'eliminarMuestra', row: muDeleteIds[i] });
      if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    }
    closeDeleteMu();
    showToast('✅ Eliminado correctamente');
    await loadMuestras();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Auto-load ──
loadMuestras();
