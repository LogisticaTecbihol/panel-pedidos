// ── State ──
var devoluciones = [];
var editDev = null;
var catalogoProductosDev = [];
var catalogoClientesDev = [];
var devLineas = [];
var tramitarDevLines = [];
var tramitarDevKey = null;
var selectedDevKeys = {};
var devViewMode = 'table';
var devCurrentPage = 1;
var devPageSize = 25;
var devDetSort = [];

// ── Constants ──
function getSiglaDev(n) { return getSigla(n); }
function getSiglaClassDev(n) { return getSiglaClass(n); }

function fmtMoney(v) {
  var n = Number(v) || 0;
  return '$' + n.toLocaleString('es-CO');
}

// ── Sorting ──
var sortLevelsDev = [];

var SORT_COLS_DEV = [
  { id:'fecha',      label:'Fecha',       fn: function(r) { return +new Date(r.Fecha||0); } },
  { id:'empresa',    label:'Empresa',     fn: function(r) { return getSiglaDev(r.Empresa); } },
  { id:'consecutivo',label:'Consec.',     fn: function(r) { return Number(r.Consecutivo)||0; } },
  { id:'cliente',    label:'Cliente',     fn: function(r) { return (r.Cliente||'').toLowerCase(); } },
  { id:'cantidad',   label:'Cantidad',    fn: function(r) { return Number(r.Cantidad)||0; } },
  { id:'valor_total',label:'Valor Total', fn: function(r) { return Number(r.Valor_Total)||0; } },
  { id:'vendedor',   label:'Vendedor',    fn: function(r) { return (r.Vendedor||'').toLowerCase(); } },
];

function toggleSortDev(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevelsDev.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevelsDev.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevelsDev[idx].dir === 'asc') sortLevelsDev[idx].dir = 'desc'; else sortLevelsDev.splice(idx, 1); }
  else { sortLevelsDev.push({ id: id, dir: 'asc' }); }
  renderDevTable();
}

function clearSortDev() { sortLevelsDev = []; renderDevTable(); }

function setDevView(mode) {
  devViewMode = mode;
  document.getElementById('dev-table-view').style.display = mode === 'table' ? 'block' : 'none';
  document.getElementById('dev-grouped-view').style.display = mode === 'grouped' ? 'block' : 'none';
  document.getElementById('btn-view-table').style.background = mode === 'table' ? '#e67e22' : '#edf2f7';
  document.getElementById('btn-view-table').style.color = mode === 'table' ? 'white' : '#718096';
  document.getElementById('btn-view-grouped').style.background = mode === 'grouped' ? '#e67e22' : '#edf2f7';
  document.getElementById('btn-view-grouped').style.color = mode === 'grouped' ? 'white' : '#718096';
  renderDevTable();
}

function toggleGroupSelect(sgKey, checked) {
  var byConsec = groupDevoluciones(filteredDev());
  byConsec.forEach(function(r) {
    var itemSgKey = (r.Empresa || '') + '||' + (r.Fecha || '') + '||' + (r.Cliente || '');
    if (itemSgKey === sgKey && (r._estado || 'Pendiente') === 'Pendiente') {
      selectedDevKeys[r._key] = checked;
    }
  });
  renderDevTable();
}

function tramitarGroupDev(sgKey) {
  var byConsec = groupDevoluciones(filteredDev());
  selectedDevKeys = {};
  byConsec.forEach(function(r) {
    var itemSgKey = (r.Empresa || '') + '||' + (r.Fecha || '') + '||' + (r.Cliente || '');
    if (itemSgKey === sgKey && (r._estado || 'Pendiente') === 'Pendiente') {
      selectedDevKeys[r._key] = true;
    }
  });
  updateBulkBarDev();
  openBulkTramitarDev();
}

function renderDevGrouped(grouped) {
  var container = document.getElementById('dev-grouped-view');
  if (!container) return;

  var superGroups = {};
  var superOrder = [];
  grouped.forEach(function(r) {
    var sgKey = (r.Empresa || '') + '||' + (r.Fecha || '') + '||' + (r.Cliente || '');
    if (!superGroups[sgKey]) {
      superGroups[sgKey] = { empresa: r.Empresa, fecha: r.Fecha, cliente: r.Cliente, items: [], sgKey: sgKey };
      superOrder.push(sgKey);
    }
    superGroups[sgKey].items.push(r);
  });

  superOrder.sort(function(a, b) {
    var ga = superGroups[a], gb = superGroups[b];
    var cEmp = (ga.empresa || '').localeCompare(gb.empresa || '', 'es');
    if (cEmp !== 0) return cEmp;
    var cFecha = (gb.fecha || '').localeCompare(ga.fecha || '');
    if (cFecha !== 0) return cFecha;
    return (ga.cliente || '').localeCompare(gb.cliente || '', 'es');
  });

  if (!superOrder.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#718096;font-size:0.9rem">No hay devoluciones con los filtros seleccionados.</div>';
    return;
  }

  container.innerHTML = superOrder.map(function(sgKey) {
    var g = superGroups[sgKey];
    var sgKeyEsc = sgKey.replace(/'/g, "\\'");
    var totalProds = g.items.reduce(function(s, r) { return s + (r._nProds || 0); }, 0);
    var totalCant = g.items.reduce(function(s, r) { return s + (r._totalCant || 0); }, 0);
    var totalValor = g.items.reduce(function(s, r) { return s + (r._totalValor || 0); }, 0);
    var pendientes = g.items.filter(function(r) { return (r._estado || 'Pendiente') === 'Pendiente'; });
    var tramitadas = g.items.filter(function(r) { return r._estado === 'Tramitada'; });
    var allPendSel = pendientes.length > 0 && pendientes.every(function(r) { return selectedDevKeys[r._key]; });
    var somePendSel = pendientes.some(function(r) { return selectedDevKeys[r._key]; });

    var html = '<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,0.06);overflow:hidden">';

    html += '<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:linear-gradient(135deg,#f7fafc,#edf2f7);border-bottom:1px solid #e2e8f0;flex-wrap:wrap">';
    if (AUTH.canEdit() && pendientes.length > 0) {
      html += '<input type="checkbox" class="dev-group-cb" data-sgkey="' + sgKeyEsc + '" ' +
        (allPendSel ? 'checked' : '') +
        ' onchange="toggleGroupSelect(\'' + sgKeyEsc + '\', this.checked)" title="Seleccionar todas las pendientes del grupo">';
    }
    html += '<span class="sigla-badge ' + getSiglaClassDev(g.empresa) + '" style="font-size:0.84rem">' + getSiglaDev(g.empresa) + '</span>';
    html += '<span style="font-weight:700;font-size:0.94rem;color:#2d3748">' + (g.cliente || '—') + '</span>';
    html += '<span style="font-size:0.82rem;color:#718096;white-space:nowrap">📅 ' + fmtDate(g.fecha) + '</span>';
    html += '<div style="margin-left:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap">';
    html += '<span style="background:#edf2f7;padding:3px 10px;border-radius:10px;font-size:0.76rem;font-weight:600;color:#4a5568">' + g.items.length + ' devol.</span>';
    html += '<span style="background:#edf2f7;padding:3px 10px;border-radius:10px;font-size:0.76rem;font-weight:600;color:#4a5568">' + totalProds + ' prod.</span>';
    html += '<span style="background:#edf2f7;padding:3px 10px;border-radius:10px;font-size:0.76rem;font-weight:600;color:#4a5568">Cant: ' + totalCant + '</span>';
    html += '<span style="font-weight:700;font-size:0.88rem;color:#2d3748">' + fmtMoney(totalValor) + '</span>';
    if (tramitadas.length === g.items.length) {
      html += '<span style="background:#d4edda;color:#155724;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">✓ Todo tramitado</span>';
    } else if (tramitadas.length > 0) {
      html += '<span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">' + pendientes.length + ' pendiente(s)</span>';
    } else {
      html += '<span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Pendiente</span>';
    }
    html += '</div></div>';

    html += '<div style="overflow-x:auto"><table style="font-size:0.82rem;margin:0;width:100%"><thead><tr style="background:#fafbfc">';
    if (AUTH.canEdit()) html += '<th style="width:30px"></th>';
    html += '<th style="text-align:center">Consec.</th><th>Factura</th><th>Vendedor</th><th style="text-align:center"># Prod.</th><th style="text-align:center">Cant.</th><th style="text-align:right">Valor</th><th>Motivo</th><th style="text-align:center">Estado</th><th>Acciones</th>';
    html += '</tr></thead><tbody>';

    g.items.forEach(function(r) {
      var keyEsc = (r._key || '').replace(/'/g, "\\'");
      var estado = r._estado || 'Pendiente';
      var esTramitada = estado === 'Tramitada';
      var estadoBadge = esTramitada
        ? '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700">Tramitada</span>'
        : '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700">Pendiente</span>';
      var tramitarBtn = !AUTH.canEdit() ? '' : esTramitada
        ? '<button onclick="openTramitarDev(\'' + keyEsc + '\')" title="Ver/editar trámite" style="background:#6c757d;font-size:0.72rem;padding:3px 8px;border-radius:4px;color:white;border:none;cursor:pointer;font-weight:700">📝</button>'
        : '<button onclick="openTramitarDev(\'' + keyEsc + '\')" title="Tramitar" style="background:#27ae60;font-size:0.72rem;padding:3px 8px;border-radius:4px;color:white;border:none;cursor:pointer;font-weight:700">📝</button>';
      var checkboxTd = !AUTH.canEdit() ? '' : esTramitada ? '<td></td>'
        : '<td style="text-align:center"><input type="checkbox" class="dev-row-cb" data-key="' + keyEsc + '" ' + (selectedDevKeys[r._key] ? 'checked' : '') + ' onchange="toggleSelectDev(\'' + keyEsc + '\',this.checked)"></td>';
      var facturas = (function() {
        var fs = {};
        (r._lines || [r]).forEach(function(l) { if (l.Num_Factura) fs[l.Num_Factura] = 1; });
        var k = Object.keys(fs);
        return k.length ? k.join(', ') : '—';
      })();

      html += '<tr' + (selectedDevKeys[r._key] ? ' style="background:#edf7ed"' : '') + '>' +
        checkboxTd +
        '<td style="text-align:center;font-weight:600">' + (r.Consecutivo || '—') + '</td>' +
        '<td style="font-size:0.78rem">' + facturas + '</td>' +
        '<td style="font-size:0.78rem">' + (r.Vendedor || '—') + '</td>' +
        '<td style="text-align:center"><span style="background:#edf2f7;padding:1px 6px;border-radius:8px;font-weight:700;font-size:0.78rem">' + (r._nProds || 0) + '</span></td>' +
        '<td style="text-align:center;font-weight:600">' + (r._totalCant || 0) + '</td>' +
        '<td style="text-align:right;font-weight:700;font-size:0.82rem">' + fmtMoney(r._totalValor) + '</td>' +
        '<td style="font-size:0.74rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.Motivo || '') + '">' + (r.Motivo || '—') + '</td>' +
        '<td style="text-align:center">' + estadoBadge + '</td>' +
        '<td><div style="display:flex;gap:4px;align-items:center">' +
          '<button onclick="viewDevDetail(\'' + keyEsc + '\')" title="Ver detalle" style="background:#3498db;font-size:0.72rem;padding:3px 8px;border-radius:4px;color:white;border:none;cursor:pointer;font-weight:700">📋</button>' +
          tramitarBtn +
          (AUTH.canEdit() ? '<button class="btn-del" onclick="openDeleteDevGroup(\'' + keyEsc + '\')" title="Eliminar" style="font-size:0.72rem;padding:3px 8px">🗑️</button>' : '') +
        '</div></td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';

    if (AUTH.canEdit() && pendientes.length > 0) {
      html += '<div style="padding:10px 18px;background:#f0faf4;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;align-items:center">';
      html += '<span style="font-size:0.78rem;color:#718096;margin-right:auto">' + pendientes.length + ' pendiente(s) en este grupo</span>';
      html += '<button onclick="tramitarGroupDev(\'' + sgKeyEsc + '\')" style="background:#27ae60;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:700;transition:background 0.2s" onmouseover="this.style.background=\'#219a52\'" onmouseout="this.style.background=\'#27ae60\'">📝 Tramitar grupo</button>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }).join('');
}

function applySortDev(rows) {
  if (!sortLevelsDev.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevelsDev.length; si++) {
      var lvl = sortLevelsDev[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS_DEV.length; ci++) { if (SORT_COLS_DEV[ci].id === lvl.id) { col = SORT_COLS_DEV[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

// ── Load from API ──
async function loadDevoluciones() {
  await _authReady;
  populateEmpresaSelect('f-empresa', 'Todas');
  populateEmpresaSelect('fc-empresa', 'Todas');
  populateEmpresaSelect('fp-empresa', 'Todas');
  populateEmpresaSelect('dev-empresa');
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
    var data = await apiGet('getDevoluciones');
    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    devoluciones = (data.devoluciones || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0,10);
      return r;
    });

    populateDevFilters();
    renderDevTable();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + devoluciones.length + ' registros';
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

async function loadCatalogoDev() {
  try {
    var data = await apiGet('getMaestroProductos');
    if (data.ok) catalogoProductosDev = data.productos || [];
  } catch(e) {}
}

async function loadClientesDev() {
  try {
    var data = await apiGet('getClientesUnicos');
    if (data.ok) catalogoClientesDev = data.clientes || [];
  } catch(e) {}
}

// ── Client search/autocomplete ──
var activeClientAutocompleteDev = null;

function buildClientSearchDev() {
  var inp = document.getElementById('dev-cliente');
  if (!inp || inp._clientSearchBound) return;
  inp._clientSearchBound = true;

  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    closeClientAutocompleteDev();
    if (q.length < 1 || !catalogoClientesDev.length) return;

    var matches = catalogoClientesDev.filter(function(c) {
      return (c.cliente || '').toLowerCase().indexOf(q) >= 0 ||
             (c.nit || '').toLowerCase().indexOf(q) >= 0;
    });

    if (!matches.length) return;

    var list = document.createElement('div');
    list.className = 'autocomplete-list client-autocomplete';
    list.style.cssText = 'position:absolute;z-index:100;background:white;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:220px;overflow-y:auto;width:100%;left:0;top:100%';

    matches.slice(0, 20).forEach(function(c) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f4f8';
      var nitLabel = c.nit ? ' <span style="color:#718096;font-size:0.75rem">NIT: ' + c.nit + '</span>' : '';
      var muniLabel = c.municipio ? ' <span style="color:#a0aec0;font-size:0.72rem">· ' + c.municipio + '</span>' : '';
      item.innerHTML = '<span style="font-weight:600">' + c.cliente + '</span>' + nitLabel + muniLabel;
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        fillClientFields(c);
        closeClientAutocompleteDev();
      });
      item.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background = 'white'; });
      list.appendChild(item);
    });

    var wrapper = inp.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(list);
    activeClientAutocompleteDev = list;
  });

  inp.addEventListener('blur', function() {
    setTimeout(closeClientAutocompleteDev, 150);
  });
}

function fillClientFields(c) {
  document.getElementById('dev-cliente').value = c.cliente || '';
  document.getElementById('dev-nit').value = c.nit || '';
  document.getElementById('dev-direccion').value = c.direccion || '';
  document.getElementById('dev-municipio').value = c.municipio || '';
  document.getElementById('dev-departamento').value = c.departamento || '';
  document.getElementById('dev-telefono').value = c.telefono || '';
}

function closeClientAutocompleteDev() {
  document.querySelectorAll('.client-autocomplete').forEach(function(el) { el.remove(); });
  activeClientAutocompleteDev = null;
}

// ── Filters ──
function onDevFilterChange() {
  devCurrentPage = 1;
  renderDevTable();
  var detallePanel = document.getElementById('panel-dev-detalle');
  if (detallePanel && detallePanel.style.display !== 'none') {
    renderDevDetalle();
  }
}

var devFiltersAttached = false;
function populateDevFilters() {
  var productos = [], clientes = [], motivos = [];
  devoluciones.forEach(function(r) {
    if (r.Producto && productos.indexOf(r.Producto) < 0) productos.push(r.Producto);
    if (r.Cliente && clientes.indexOf(r.Cliente) < 0) clientes.push(r.Cliente);
    if (r.Motivo && motivos.indexOf(r.Motivo) < 0) motivos.push(r.Motivo);
  });
  productos.sort();
  clientes.sort();
  motivos.sort();

  var fp = document.getElementById('f-prod');
  fp.innerHTML = '<option value="">Todos</option>' + productos.map(function(p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');

  var fc = document.getElementById('f-cliente');
  fc.innerHTML = '<option value="">Todos</option>' + clientes.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');

  var fm = document.getElementById('f-motivo');
  fm.innerHTML = '<option value="">Todos</option>' + motivos.map(function(m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');

  if (!devFiltersAttached) {
    ['f-empresa','f-cliente','f-motivo','f-prod','f-txt'].forEach(function(id) {
      document.getElementById(id).addEventListener('change', onDevFilterChange);
      document.getElementById(id).addEventListener('input', onDevFilterChange);
    });
    devFiltersAttached = true;
  }
}

function filteredDev() {
  var fe = document.getElementById('f-empresa').value;
  var fc = document.getElementById('f-cliente').value;
  var fm = document.getElementById('f-motivo').value;
  var fp = document.getElementById('f-prod').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();
  return devoluciones.filter(function(r) {
    if (fe && r.Empresa !== fe) return false;
    if (fc && r.Cliente !== fc) return false;
    if (fm && r.Motivo !== fm) return false;
    if (fp && r.Producto !== fp) return false;
    if (ft) {
      var hay = [r.Cliente, r.Vendedor, r.Producto, r.Presentacion, r.Num_Factura, r.Motivo, r.Observaciones, r.Consecutivo, r.NIT, r.Remision, r.Estado].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function clearDevFilters() {
  document.getElementById('f-empresa').value = '';
  document.getElementById('f-cliente').value = '';
  document.getElementById('f-motivo').value = '';
  document.getElementById('f-prod').value = '';
  document.getElementById('f-txt').value = '';
  renderDevTable();
}

// ── Group devoluciones ──
function groupDevoluciones(rows) {
  var map = {};
  var order = [];
  rows.forEach(function(r) {
    var key = (r.Empresa || '') + '||' + (r.Consecutivo || r.id);
    if (!map[key]) {
      map[key] = { head: Object.assign({}, r), lines: [], key: key };
      order.push(key);
    }
    map[key].lines.push(r);
  });
  return order.map(function(k) {
    var g = map[k];
    g.head._key = k;
    g.head._nProds = g.lines.length;
    g.head._lines = g.lines;
    g.head._totalValor = g.lines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0);
    g.head._totalCant = g.lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
    g.head._lineIds = g.lines.map(function(l) { return l.__row || l.id; });
    g.head._estado = g.lines.every(function(l) { return l.Estado === 'Tramitada'; }) && g.lines[0].Estado ? 'Tramitada' : (g.lines[0].Estado || 'Pendiente');
    g.head._remision = g.lines[0].Remision || '';
    g.head._fechaDevolucion = g.lines[0].Fecha_Devolucion || '';
    return g.head;
  });
}

// ── Render ──
function getSelectedDevCount() {
  return Object.keys(selectedDevKeys).filter(function(k) { return selectedDevKeys[k]; }).length;
}

function toggleSelectAllDev(cb) {
  var grouped = groupDevoluciones(applySortDev(filteredDev()));
  grouped.forEach(function(r) {
    if ((r._estado || 'Pendiente') !== 'Pendiente') return;
    selectedDevKeys[r._key] = cb.checked;
  });
  renderDevTable();
}

function toggleSelectDev(key, checked) {
  selectedDevKeys[key] = checked;
  updateBulkBarDev();
}

function updateBulkBarDev() {
  var count = getSelectedDevCount();
  var bar = document.getElementById('bulk-bar-dev');
  if (!bar) return;
  if (count > 0) {
    bar.style.display = 'flex';
    document.getElementById('bulk-count-dev').textContent = count;
  } else {
    bar.style.display = 'none';
  }
  var selectAllCb = document.getElementById('dev-select-all');
  if (selectAllCb) {
    var grouped = groupDevoluciones(applySortDev(filteredDev()));
    var pendientes = grouped.filter(function(r) { return (r._estado || 'Pendiente') === 'Pendiente'; });
    var selectedPendientes = pendientes.filter(function(r) { return selectedDevKeys[r._key]; }).length;
    selectAllCb.checked = pendientes.length > 0 && selectedPendientes === pendientes.length;
    selectAllCb.indeterminate = selectedPendientes > 0 && selectedPendientes < pendientes.length;
  }
}

function clearSelectionDev() {
  selectedDevKeys = {};
  renderDevTable();
}

function renderDevHeader() {
  var cols = [
    { label:'<input type="checkbox" id="dev-select-all" onclick="toggleSelectAllDev(this)" title="Seleccionar todos los pendientes">', id:null },
    { label:'#', id:null },
    { label:'Fecha', id:'fecha' },
    { label:'Empresa', id:'empresa' },
    { label:'Consec.', id:'consecutivo' },
    { label:'Factura', id:null },
    { label:'Cliente', id:'cliente' },
    { label:'Vendedor', id:'vendedor' },
    { label:'# Prod.', id:null },
    { label:'Cant. Total', id:'cantidad' },
    { label:'V. Total', id:'valor_total' },
    { label:'Motivo', id:null },
    { label:'Estado', id:null },
    { label:'Acción', id:null },
  ];
  document.getElementById('t-head-dev').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = sortLevelsDev.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevelsDev[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevelsDev.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSortDev(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');
  var btn = document.getElementById('btn-clear-sort-dev');
  if (btn) btn.style.display = sortLevelsDev.length ? 'inline-block' : 'none';
}

function renderDevTable() {
  var filtered = filteredDev();
  var grouped = groupDevoluciones(applySortDev(filtered));

  var allGrouped = groupDevoluciones(devoluciones);
  var totalRegs = allGrouped.length;
  var totalValor = devoluciones.reduce(function(s, r) { return s + (Number(r.Valor_Total)||0); }, 0);
  var now = new Date();
  var mesActual = groupDevoluciones(devoluciones.filter(function(r) {
    var d = new Date(r.Fecha);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  })).length;
  var clientesSet = {};
  devoluciones.forEach(function(r) { if (r.Cliente) clientesSet[r.Cliente] = true; });
  var clientesCount = Object.keys(clientesSet).length;

  document.getElementById('s-total').textContent = totalRegs;
  document.getElementById('s-valor').textContent = fmtMoney(totalValor);
  document.getElementById('s-mes').textContent = mesActual;
  document.getElementById('s-clientes').textContent = clientesCount;
  document.getElementById('row-ct-dev').textContent = '(' + grouped.length + ' mostrados)';

  renderDevHeader();

  renderDevGrouped(grouped);

  var totalRows = grouped.length;
  var totalPages = Math.ceil(totalRows / devPageSize) || 1;
  if (devCurrentPage > totalPages) devCurrentPage = totalPages;

  var tbody = document.getElementById('t-body-dev');
  if (!grouped.length) {
    tbody.innerHTML = '<tr><td colspan="14"><div class="empty">No hay devoluciones con los filtros seleccionados.</div></td></tr>';
    renderDevPagination(0);
    updateBulkBarDev();
    return;
  }

  var startIdx = (devCurrentPage - 1) * devPageSize;
  var pageRows = grouped.slice(startIdx, startIdx + devPageSize);

  tbody.innerHTML = pageRows.map(function(r, ri) {
    var i = startIdx + ri;
    var keyEsc = (r._key || '').replace(/'/g, "\\'");
    var estado = r._estado || 'Pendiente';
    var esTramitada = estado === 'Tramitada';
    var estadoBadge = esTramitada
      ? '<span style="background:#d4edda;color:#155724;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Tramitada</span>'
      : '<span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Pendiente</span>';
    var tramitarBtn = !AUTH.canEdit() ? '' : esTramitada
      ? '<button class="btn-edit" onclick="openTramitarDev(\'' + keyEsc + '\')" title="Ver/editar trámite" style="background:#6c757d;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📝 Editar</button>'
      : '<button class="btn-edit" onclick="openTramitarDev(\'' + keyEsc + '\')" title="Tramitar devolución" style="background:#27ae60;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📝 Tramitar</button>';
    var checkboxTd = !AUTH.canEdit()
      ? '<td></td>'
      : esTramitada
        ? '<td></td>'
        : '<td style="text-align:center"><input type="checkbox" class="dev-row-cb" data-key="' + keyEsc + '" ' + (selectedDevKeys[r._key] ? 'checked' : '') + ' onchange="toggleSelectDev(\'' + keyEsc + '\',this.checked)"></td>';
    return '<tr' + (selectedDevKeys[r._key] ? ' style="background:#edf7ed"' : '') + '>' +
      checkboxTd +
      '<td style="color:#718096;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha) + '</td>' +
      '<td title="' + (r.Empresa||'') + '"><span class="sigla-badge ' + getSiglaClassDev(r.Empresa) + '">' + getSiglaDev(r.Empresa) + '</span></td>' +
      '<td style="text-align:center;font-weight:600">' + (r.Consecutivo||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (function(){ var fs={}; (r._lines||[r]).forEach(function(l){ if(l.Num_Factura) fs[l.Num_Factura]=1; }); var k=Object.keys(fs); return k.length ? k.join(', ') : '—'; })() + '</td>' +
      '<td style="font-weight:600;font-size:0.82rem">' + (r.Cliente||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Vendedor||'—') + '</td>' +
      '<td style="text-align:center"><span style="background:#edf2f7;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.8rem">' + (r._nProds||0) + '</span></td>' +
      '<td style="text-align:center;font-weight:600">' + (r._totalCant||0) + '</td>' +
      '<td style="text-align:right;font-weight:700;font-size:0.82rem">' + fmtMoney(r._totalValor) + '</td>' +
      '<td style="font-size:0.76rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.Motivo||'') + '">' + (r.Motivo||'—') + '</td>' +
      '<td style="text-align:center">' + estadoBadge + '</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        '<button class="btn-edit" onclick="viewDevDetail(\'' + keyEsc + '\')" title="Ver detalle" style="background:#3498db;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📋 Ver</button>' +
        tramitarBtn +
        (AUTH.canEdit() ? '<button class="btn-del" onclick="openDeleteDevGroup(\'' + keyEsc + '\')" title="Eliminar devolución">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');

  renderDevPagination(totalRows);
  updateBulkBarDev();
}

// ── Detail view modal ──
function viewDevDetail(key) {
  var lines = devoluciones.filter(function(r) {
    return ((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  var r = lines[0];

  function devField(label, val) {
    return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">' + label + '</span><br>' +
      '<span style="font-size:0.85rem;color:#2d3748">' + (val || '—') + '</span></div>';
  }

  var estadoLabel = r.Estado === 'Tramitada'
    ? '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Tramitada</span>'
    : '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Pendiente</span>';

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem">' +
    devField('Empresa', getSiglaDev(r.Empresa)) +
    devField('Fecha', fmtDate(r.Fecha)) +
    devField('Consecutivo', r.Consecutivo) +
    devField('Vendedor', r.Vendedor) +
    devField('Cliente', r.Cliente) +
    devField('NIT', r.NIT) +
    devField('Dirección', r.Direccion) +
    devField('Municipio', r.Municipio) +
    devField('Departamento', r.Departamento) +
    devField('Teléfono', r.Telefono) +
    devField('Motivo', r.Motivo) +
    devField('Estado', estadoLabel) +
    '</div>' +
    (function() {
      var hasIngreso = r.Remision_Ingreso || r.Remision;
      var hasSalida = r.Remision_Salida;
      if (!hasIngreso && !hasSalida) return '';
      var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">';
      html += '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 14px">' +
        '<div style="font-weight:700;font-size:0.82rem;color:#e65100;margin-bottom:8px">📥 Remisión de Ingreso</div>' +
        devField('N° Remisión', r.Remision_Ingreso || r.Remision || '') +
        devField('Bodega', r.Bodega_Ingreso || '') +
        devField('Fecha', (r.Fecha_Ingreso || r.Fecha_Devolucion) ? fmtDate(r.Fecha_Ingreso || r.Fecha_Devolucion) : '—') +
        '</div>';
      html += '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:12px 14px">' +
        '<div style="font-weight:700;font-size:0.82rem;color:#2e7d32;margin-bottom:8px">📤 Remisión de Salida</div>' +
        devField('N° Remisión', r.Remision_Salida || '') +
        devField('Bodega', r.Bodega_Salida || '') +
        devField('Fecha', r.Fecha_Salida ? fmtDate(r.Fecha_Salida) : '—') +
        '</div>';
      html += '</div>';
      return html;
    })();

  if (r.Observaciones) {
    html += '<div style="margin-bottom:14px"><div style="font-weight:700;font-size:0.78rem;color:#4a5568;text-transform:uppercase;margin-bottom:4px">Observaciones</div>' +
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">' + (r.Observaciones || '') + '</div></div>';
  }

  html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">' +
    '<div style="font-weight:700;font-size:0.84rem;color:#2d3748">📦 Productos (' + lines.length + ')</div>' +
    '</div>';

  html += '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#f7fafc">' +
    '<th>Factura</th><th>Producto</th><th>Presentación</th><th style="text-align:right">Cantidad</th>' +
    '<th style="text-align:right">Cant. Devuelta</th><th style="text-align:right">V. Unitario</th>' +
    '<th style="text-align:right">V. Total</th><th style="width:80px"></th>' +
    '</tr></thead><tbody>';

  var totalValor = 0;
  lines.forEach(function(x) {
    totalValor += Number(x.Valor_Total) || 0;
    html += '<tr>' +
      '<td style="font-size:0.78rem">' + (x.Num_Factura || '—') + '</td>' +
      '<td style="font-weight:600">' + (x.Producto || '—') + '</td>' +
      '<td>' + (x.Presentacion || '—') + '</td>' +
      '<td style="text-align:right">' + (x.Cantidad || 0) + '</td>' +
      '<td style="text-align:right">' + (x.Cant_Entregada || '—') + '</td>' +
      '<td style="text-align:right">' + fmtMoney(x.Valor_Unitario) + '</td>' +
      '<td style="text-align:right;font-weight:700">' + fmtMoney(x.Valor_Total) + '</td>' +
      '<td style="white-space:nowrap">' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="closeViewDev();openEditDev(' + x.__row + ')" style="font-size:0.75rem;padding:3px 8px" title="Editar línea">✏️</button> ' +
        '<button class="btn-del" onclick="closeViewDev();openDeleteDev(0,' + (x.__row||0) + ')" style="font-size:0.75rem;padding:3px 8px" title="Eliminar línea">🗑️</button>' : '') +
      '</td></tr>';
  });

  html += '<tr style="background:#fef9f2;font-weight:700;border-top:2px solid #e2e8f0">' +
    '<td colspan="6" style="text-align:right">TOTAL:</td>' +
    '<td style="text-align:right">' + fmtMoney(totalValor) + '</td><td></td></tr>';
  html += '</tbody></table></div>';

  document.getElementById('view-dev-meta').innerHTML =
    '<span>📋 Consec: ' + (r.Consecutivo || '—') + '</span>' +
    '<span>📅 ' + fmtDate(r.Fecha) + '</span>' +
    '<span>👤 ' + (r.Cliente || '—') + '</span>';

  document.getElementById('view-dev-body').innerHTML = html;
  document.getElementById('view-dev-overlay').classList.add('show');
}

function closeViewDev() {
  document.getElementById('view-dev-overlay').classList.remove('show');
}

document.getElementById('view-dev-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeViewDev(); });

// ── Delete group ──
function openDeleteDevGroup(key) {
  var lines = devoluciones.filter(function(r) {
    return ((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  var r = lines[0];
  deleteDevGroupIds = lines.map(function(l) { return l.__row || l.id; });
  document.getElementById('del-dev-msg').textContent = '¿Eliminar esta devolución completa?';
  document.getElementById('del-dev-detail').innerHTML =
    'Cliente: <strong>' + (r.Cliente||'—') + '</strong> · Consec: <strong>' + (r.Consecutivo||'—') + '</strong><br>' +
    'Productos: ' + lines.length + ' · Valor: ' + fmtMoney(lines.reduce(function(s,l){return s+(Number(l.Valor_Total)||0);},0)) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminarán ' + lines.length + ' registro(s) de la base de datos.</span>';
  document.getElementById('btn-del-dev-confirm').disabled = false;
  document.getElementById('btn-del-dev-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-dev-overlay').classList.add('show');
}

var deleteDevGroupIds = null;

// ── Product search/autocomplete ──
var activeAutocompleteDev = null;

function buildProductSearchDev(lineIdx) {
  var inp = document.querySelector('.dev-prod-search[data-line="' + lineIdx + '"]');
  if (!inp) return;

  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    var empSel = document.getElementById('dev-empresa').value;
    closeAllAutocompleteDev();
    if (q.length < 1) return;

    var matches = catalogoProductosDev.filter(function(p) {
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
        var presInp = document.querySelector('.dev-pres[data-line="' + lineIdx + '"]');
        if (presInp) presInp.value = p.presentacion || '';
        devLineas[lineIdx].Producto = p.producto;
        devLineas[lineIdx].Presentacion = p.presentacion || '';
        closeAllAutocompleteDev();
      });
      item.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background = 'white'; });
      list.appendChild(item);
    });

    var wrapper = inp.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(list);
    activeAutocompleteDev = list;
  });

  inp.addEventListener('blur', function() {
    setTimeout(closeAllAutocompleteDev, 150);
  });
}

function closeAllAutocompleteDev() {
  document.querySelectorAll('.autocomplete-list').forEach(function(el) { el.remove(); });
  activeAutocompleteDev = null;
}

// ── Render line rows in modal ──
function updateDevTotal() {
  var total = 0;
  devLineas.forEach(function(l) { total += (Number(l.Valor_Total)||0); });
  var el = document.getElementById('dev-total-display');
  if (el) el.textContent = fmtMoney(total);
}

function calcLineTotal(i) {
  var cant = Number(devLineas[i].Cantidad) || 0;
  var vunit = Number(devLineas[i].Valor_Unitario) || 0;
  devLineas[i].Valor_Total = cant * vunit;
  var vtEl = document.querySelector('.dev-vtotal[data-line="' + i + '"]');
  if (vtEl) vtEl.textContent = fmtMoney(devLineas[i].Valor_Total);
  updateDevTotal();
}

function renderDevLines() {
  var tbody = document.getElementById('dev-lines');
  tbody.innerHTML = devLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td><input class="ef dev-factura" data-line="' + i + '" type="text" value="' + ((l.Num_Factura||'').replace(/"/g,'&quot;')) + '" placeholder="FV..." style="width:100px"></td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef dev-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto||'').replace(/"/g,'&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef dev-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion||'').replace(/"/g,'&quot;')) + '" placeholder="Pres." style="width:100px"></td>' +
      '<td><input class="ef dev-cant" data-line="' + i + '" type="number" min="0" value="' + (l.Cantidad||'') + '" placeholder="0" style="width:65px;text-align:right"></td>' +
      '<td><input class="ef dev-cant-ent" data-line="' + i + '" type="number" min="0" value="' + (l.Cant_Entregada||'') + '" placeholder="0" style="width:75px;text-align:right"></td>' +
      '<td><input class="ef dev-vunit" data-line="' + i + '" type="number" min="0" value="' + (l.Valor_Unitario||'') + '" placeholder="$0" style="width:90px;text-align:right"></td>' +
      '<td style="text-align:right;font-weight:700;font-size:0.82rem"><span class="dev-vtotal" data-line="' + i + '">' + fmtMoney(l.Valor_Total||0) + '</span></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeDevLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  devLineas.forEach(function(l, i) {
    buildProductSearchDev(i);

    var cantInp = document.querySelector('.dev-cant[data-line="' + i + '"]');
    var vunitInp = document.querySelector('.dev-vunit[data-line="' + i + '"]');
    if (cantInp) cantInp.addEventListener('input', function() {
      devLineas[i].Cantidad = Number(this.value) || 0;
      calcLineTotal(i);
    });
    if (vunitInp) vunitInp.addEventListener('input', function() {
      devLineas[i].Valor_Unitario = Number(this.value) || 0;
      calcLineTotal(i);
    });
  });

  updateDevTotal();
}

function addDevLine() {
  devLineas.push({ Num_Factura: '', Producto: '', Presentacion: '', Cantidad: '', Cant_Entregada: '', Valor_Unitario: '', Valor_Total: 0 });
  renderDevLines();
  var lastInput = document.querySelector('.dev-prod-search[data-line="' + (devLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeDevLine(i) {
  if (devLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  devLineas.splice(i, 1);
  renderDevLines();
}

function readDevLines() {
  document.querySelectorAll('.dev-factura').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (devLineas[i]) devLineas[i].Num_Factura = inp.value.trim();
  });
  document.querySelectorAll('.dev-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (devLineas[i]) devLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.dev-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (devLineas[i]) devLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.dev-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (devLineas[i]) devLineas[i].Cantidad = Number(inp.value) || 0;
  });
  document.querySelectorAll('.dev-cant-ent').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (devLineas[i]) devLineas[i].Cant_Entregada = Number(inp.value) || 0;
  });
  document.querySelectorAll('.dev-vunit').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (devLineas[i]) {
      devLineas[i].Valor_Unitario = Number(inp.value) || 0;
      devLineas[i].Valor_Total = (devLineas[i].Cantidad || 0) * devLineas[i].Valor_Unitario;
    }
  });
}

// ── Motivo dropdown helpers ──
function toggleMotivoOtro() {
  var sel = document.getElementById('dev-motivo');
  var inp = document.getElementById('dev-motivo-otro');
  if (sel.value === '__otro__') {
    inp.style.display = 'block';
    inp.focus();
  } else {
    inp.style.display = 'none';
    inp.value = '';
  }
}

function getDevMotivo() {
  var sel = document.getElementById('dev-motivo');
  if (sel.value === '__otro__') return document.getElementById('dev-motivo-otro').value.trim();
  return sel.value;
}

function setDevMotivo(motivo) {
  var sel = document.getElementById('dev-motivo');
  var inp = document.getElementById('dev-motivo-otro');
  var found = false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === motivo) { found = true; break; }
  }
  if (found) {
    sel.value = motivo;
    inp.style.display = 'none';
    inp.value = '';
  } else {
    sel.value = '__otro__';
    inp.style.display = 'block';
    inp.value = motivo;
  }
}

// ── New Devolucion Modal ──
function openNewDev() {
  editDev = null;
  document.getElementById('dev-modal-title').textContent = '🔄 Registrar Devolución';
  document.getElementById('dev-empresa').value = '';
  document.getElementById('dev-fecha').value = today();
  document.getElementById('dev-consecutivo').value = '';
  document.getElementById('dev-vendedor').value = '';
  document.getElementById('dev-cliente').value = '';
  document.getElementById('dev-nit').value = '';
  document.getElementById('dev-direccion').value = '';
  document.getElementById('dev-municipio').value = '';
  document.getElementById('dev-departamento').value = '';
  document.getElementById('dev-telefono').value = '';
  document.getElementById('dev-motivo').value = '';
  document.getElementById('dev-motivo-otro').value = '';
  document.getElementById('dev-motivo-otro').style.display = 'none';
  document.getElementById('dev-observaciones').value = '';
  document.getElementById('btn-save-dev').disabled = false;
  document.getElementById('btn-save-dev').textContent = '✓ Registrar devolución';
  document.getElementById('dev-edit-single').style.display = 'none';
  document.getElementById('dev-multi-lines').style.display = 'block';

  devLineas = [{ Num_Factura: '', Producto: '', Presentacion: '', Cantidad: '', Cant_Entregada: '', Valor_Unitario: '', Valor_Total: 0 }];
  renderDevLines();
  buildClientSearchDev();
  document.getElementById('dev-overlay').classList.add('show');
}

function closeDevModal() {
  document.getElementById('dev-overlay').classList.remove('show');
  editDev = null;
  closeAllAutocompleteDev();
  closeClientAutocompleteDev();
}

document.getElementById('dev-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDevModal(); });

// ── Edit Devolucion (single line) ──
function openEditDev(row) {
  var r = null;
  for (var i = 0; i < devoluciones.length; i++) {
    if (devoluciones[i].__row === row) { r = devoluciones[i]; break; }
  }
  if (!r) return;
  editDev = r;
  document.getElementById('dev-modal-title').textContent = '✏️ Editar Devolución';
  document.getElementById('dev-empresa').value = r.Empresa || '';
  document.getElementById('dev-fecha').value = toDateInput(r.Fecha);
  document.getElementById('dev-consecutivo').value = r.Consecutivo || '';
  document.getElementById('dev-vendedor').value = r.Vendedor || '';
  document.getElementById('dev-cliente').value = r.Cliente || '';
  document.getElementById('dev-nit').value = r.NIT || '';
  document.getElementById('dev-direccion').value = r.Direccion || '';
  document.getElementById('dev-municipio').value = r.Municipio || '';
  document.getElementById('dev-departamento').value = r.Departamento || '';
  document.getElementById('dev-telefono').value = r.Telefono || '';
  setDevMotivo(r.Motivo || '');
  document.getElementById('dev-observaciones').value = r.Observaciones || '';
  document.getElementById('btn-save-dev').disabled = false;
  document.getElementById('btn-save-dev').textContent = '✓ Guardar cambios';

  document.getElementById('dev-multi-lines').style.display = 'none';
  document.getElementById('dev-edit-single').style.display = 'block';
  document.getElementById('dev-edit-num-factura').value = r.Num_Factura || '';
  document.getElementById('dev-edit-producto').value = r.Producto || '';
  document.getElementById('dev-edit-presentacion').value = r.Presentacion || '';
  document.getElementById('dev-edit-cantidad').value = r.Cantidad || '';
  document.getElementById('dev-edit-cant-entregada').value = r.Cant_Entregada || '';
  document.getElementById('dev-edit-valor-unit').value = r.Valor_Unitario || '';
  document.getElementById('dev-edit-valor-total').value = r.Valor_Total || '';

  // Auto-calculate on edit
  var calcEdit = function() {
    var c = Number(document.getElementById('dev-edit-cantidad').value) || 0;
    var v = Number(document.getElementById('dev-edit-valor-unit').value) || 0;
    document.getElementById('dev-edit-valor-total').value = c * v;
  };
  document.getElementById('dev-edit-cantidad').oninput = calcEdit;
  document.getElementById('dev-edit-valor-unit').oninput = calcEdit;

  buildClientSearchDev();
  document.getElementById('dev-overlay').classList.add('show');
}

// ── Save ──
async function saveDevolucion() {
  var empresa = document.getElementById('dev-empresa').value;
  var fecha = document.getElementById('dev-fecha').value;
  var consecutivo = document.getElementById('dev-consecutivo').value.trim();
  var vendedor = document.getElementById('dev-vendedor').value.trim();
  var cliente = document.getElementById('dev-cliente').value.trim();
  var nit = document.getElementById('dev-nit').value.trim();
  var direccion = document.getElementById('dev-direccion').value.trim();
  var municipio = document.getElementById('dev-municipio').value.trim();
  var departamento = document.getElementById('dev-departamento').value.trim();
  var telefono = document.getElementById('dev-telefono').value.trim();
  var motivo = getDevMotivo();
  var observaciones = document.getElementById('dev-observaciones').value.trim();

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!cliente) { showToast('Ingresa el nombre del cliente', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-dev');

  if (editDev) {
    var num_factura = document.getElementById('dev-edit-num-factura').value.trim();
    var prod = document.getElementById('dev-edit-producto').value.trim();
    var pres = document.getElementById('dev-edit-presentacion').value.trim();
    var cant = Number(document.getElementById('dev-edit-cantidad').value) || 0;
    var cantEnt = Number(document.getElementById('dev-edit-cant-entregada').value) || 0;
    var vUnit = Number(document.getElementById('dev-edit-valor-unit').value) || 0;
    var vTotal = Number(document.getElementById('dev-edit-valor-total').value) || 0;
    if (!prod) { showToast('Ingresa el producto', '#e74c3c'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    try {
      var result = await apiPost({
        action: 'editarDevolucion',
        row: editDev.__row,
        Fecha: fecha, Empresa: empresa, Consecutivo: consecutivo, Vendedor: vendedor,
        Cliente: cliente, NIT: nit, Direccion: direccion, Municipio: municipio,
        Departamento: departamento, Telefono: telefono, Num_Factura: num_factura,
        Producto: prod, Presentacion: pres, Cantidad: cant, Cant_Entregada: cantEnt,
        Valor_Unitario: vUnit, Valor_Total: vTotal,
        Motivo: motivo, Observaciones: observaciones,
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeDevModal();
      showToast('✅ Devolución actualizada en la nube');
      await loadDevoluciones();
    } catch (err) {
      showToast('❌ Error: ' + err.message, '#e74c3c');
      btn.disabled = false;
      btn.textContent = '✓ Guardar cambios';
    }
    return;
  }

  readDevLines();
  var validLines = devLineas.filter(function(l) { return l.Producto; });
  if (!validLines.length) { showToast('Agrega al menos un producto', '#e74c3c'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarDevolucion',
      Fecha: fecha, Empresa: empresa, Consecutivo: consecutivo, Vendedor: vendedor,
      Cliente: cliente, NIT: nit, Direccion: direccion, Municipio: municipio,
      Departamento: departamento, Telefono: telefono,
      Motivo: motivo, Observaciones: observaciones,
      lineas: validLines,
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeDevModal();
    showToast('✅ ' + result.added + ' línea(s) registradas en la nube');
    await loadDevoluciones();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar devolución';
  }
}

// ── Delete ──
var deleteDevRow = null;

function openDeleteDev(idx, row) {
  deleteDevRow = row;
  deleteDevGroupIds = null;
  var r = null;
  for (var i = 0; i < devoluciones.length; i++) {
    if (devoluciones[i].__row === row) { r = devoluciones[i]; break; }
  }
  if (!r) r = {};
  document.getElementById('del-dev-msg').textContent = '¿Eliminar esta línea de producto?';
  document.getElementById('del-dev-detail').innerHTML =
    'Cliente: <strong>' + (r.Cliente||'—') + '</strong> · Producto: <strong>' + (r.Producto||'—') + '</strong><br>' +
    'Valor: ' + fmtMoney(r.Valor_Total) + ' · ' + fmtDate(r.Fecha) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará esta línea de la base de datos.</span>';
  document.getElementById('btn-del-dev-confirm').disabled = false;
  document.getElementById('btn-del-dev-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-dev-overlay').classList.add('show');
}

function closeDeleteDev() {
  document.getElementById('delete-dev-overlay').classList.remove('show');
  deleteDevRow = null;
  deleteDevGroupIds = null;
}

document.getElementById('delete-dev-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteDev(); });

async function confirmDeleteDev() {
  var btn = document.getElementById('btn-del-dev-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    if (deleteDevGroupIds && deleteDevGroupIds.length) {
      var count = deleteDevGroupIds.length;
      for (var i = 0; i < deleteDevGroupIds.length; i++) {
        var result = await apiPost({ action: 'eliminarDevolucion', row: deleteDevGroupIds[i] });
        if (!result.ok) throw new Error(result.error || 'Error al eliminar');
      }
      closeDeleteDev();
      showToast('🗑️ Devolución eliminada (' + count + ' líneas)');
    } else if (deleteDevRow) {
      var result = await apiPost({ action: 'eliminarDevolucion', row: deleteDevRow });
      if (!result.ok) throw new Error(result.error || 'Error al eliminar');
      closeDeleteDev();
      showToast('🗑️ Línea eliminada');
    }
    await loadDevoluciones();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Excel import ──
function handleDevExcelUpload(input) {
  var file = input.files[0];
  if (!file) return;
  input.value = '';

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(e.target.result, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var parsed = parseDevExcel(ws);
      if (!parsed) { showToast('No se pudo leer el formato de devolución', '#e74c3c'); return; }
      prefillDevForm(parsed);
      showToast('📂 Datos cargados desde Excel — revisa y guarda');
    } catch (err) {
      showToast('❌ Error al leer el archivo: ' + err.message, '#e74c3c');
    }
  };
  reader.readAsArrayBuffer(file);
}

function findCellByLabel(ws, label) {
  var range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  var labelUp = label.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (var r = range.s.r; r <= range.e.r; r++) {
    for (var c = range.s.c; c <= range.e.c; c++) {
      var addr = XLSX.utils.encode_cell({ r: r, c: c });
      var cell = ws[addr];
      if (!cell) continue;
      var val = String(cell.v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (val.indexOf(labelUp) >= 0) return { r: r, c: c };
    }
  }
  return null;
}

function getCellValue(ws, r, c) {
  var addr = XLSX.utils.encode_cell({ r: r, c: c });
  var cell = ws[addr];
  if (!cell) return '';
  if (cell.t === 'n') return cell.v;
  return String(cell.v || '').trim();
}

function getValueNextTo(ws, label, colOffset) {
  var pos = findCellByLabel(ws, label);
  if (!pos) return '';
  return getCellValue(ws, pos.r, pos.c + (colOffset || 1));
}

function parseDevExcel(ws) {
  var empresa = getValueNextTo(ws, 'NOMBRE DE LA EMPRESA') || getValueNextTo(ws, 'NOMBRE EMPRESA');
  var fecha = getValueNextTo(ws, 'FECHA');
  var vendedor = getValueNextTo(ws, 'VENDEDOR');
  var cliente = getValueNextTo(ws, 'CLIENTE');
  var nit = getValueNextTo(ws, 'NIT');
  var direccion = '';
  var dirPos = findCellByLabel(ws, 'DIRECCION');
  if (dirPos) {
    var clientePos = findCellByLabel(ws, 'CLIENTE');
    if (clientePos && dirPos.r > clientePos.r) {
      direccion = getCellValue(ws, dirPos.r, dirPos.c + 1);
    } else if (dirPos) {
      var dirs = [];
      var range = XLSX.utils.decode_range(ws['!ref']);
      for (var r = range.s.r; r <= range.e.r; r++) {
        for (var c = range.s.c; c <= range.e.c; c++) {
          var v = String(getCellValue(ws, r, c)).toUpperCase().replace(/[^A-Z]/g, '');
          if (v === 'DIRECCION' && r > (clientePos ? clientePos.r : 0)) {
            direccion = getCellValue(ws, r, c + 1);
            break;
          }
        }
        if (direccion) break;
      }
      if (!direccion) direccion = getCellValue(ws, dirPos.r, dirPos.c + 1);
    }
  }
  var municipio = getValueNextTo(ws, 'MUNICIPIO');
  var departamento = getValueNextTo(ws, 'DEPARTAMENTO');
  var telefono = getValueNextTo(ws, 'TELEFONO');
  var numFactura = getValueNextTo(ws, 'FACTURA');
  var consecutivo = '';
  var consPos = findCellByLabel(ws, 'CONSECUTIVO');
  if (consPos) consecutivo = getCellValue(ws, consPos.r, consPos.c + 1);

  var observaciones = getValueNextTo(ws, 'OBSERVACIONES');
  if (!observaciones) {
    var obsPos = findCellByLabel(ws, 'OBSERVACIONES');
    if (obsPos) {
      var parts = [];
      for (var oRow = obsPos.r + 1; oRow <= obsPos.r + 3; oRow++) {
        var v = getCellValue(ws, oRow, obsPos.c + 1);
        if (v) parts.push(v);
        else break;
      }
      observaciones = parts.join('. ');
    }
  }

  var motivo = getValueNextTo(ws, 'MOTIVO');
  if (!motivo) {
    var motPos = findCellByLabel(ws, 'MOTIVO');
    if (motPos) {
      var parts = [];
      for (var mRow = motPos.r + 1; mRow <= motPos.r + 2; mRow++) {
        var v = getCellValue(ws, mRow, motPos.c + 1);
        if (v) parts.push(v);
        else break;
      }
      motivo = parts.join('. ');
    }
  }

  var prodPos = findCellByLabel(ws, 'PRODUCTOS');
  if (!prodPos) prodPos = findCellByLabel(ws, 'PRODUCTO');
  var lineas = [];
  if (prodPos) {
    var startRow = prodPos.r + 1;
    var range = XLSX.utils.decode_range(ws['!ref']);
    var colProd = prodPos.c;
    for (var r = startRow; r <= range.e.r; r++) {
      var prod = String(getCellValue(ws, r, colProd)).trim();
      if (!prod) continue;
      var prodUp = prod.toUpperCase().replace(/[^A-Z]/g, '');
      if (prodUp === 'OBSERVACIONES' || prodUp === 'MOTIVO' || prodUp === 'FACTURA') break;
      lineas.push({
        Producto: prod,
        Presentacion: String(getCellValue(ws, r, colProd + 1)).trim(),
        Cantidad: Number(getCellValue(ws, r, colProd + 2)) || 0,
        Cant_Entregada: Number(getCellValue(ws, r, colProd + 3)) || 0,
        Valor_Unitario: Number(getCellValue(ws, r, colProd + 4)) || 0,
        Valor_Total: Number(getCellValue(ws, r, colProd + 5)) || 0,
      });
    }
  }

  if (!cliente && !lineas.length) return null;

  if (fecha) {
    if (typeof fecha === 'number') {
      var d = XLSX.SSF.parse_date_code(fecha);
      if (d) fecha = d.y + '-' + String(d.m).padStart(2,'0') + '-' + String(d.d).padStart(2,'0');
    } else {
      var dp = new Date(fecha);
      if (!isNaN(dp)) fecha = dp.getFullYear() + '-' + String(dp.getMonth()+1).padStart(2,'0') + '-' + String(dp.getDate()).padStart(2,'0');
    }
  }

  return {
    empresa: empresa, fecha: fecha, vendedor: vendedor, cliente: cliente,
    nit: String(nit), direccion: direccion, municipio: municipio,
    departamento: departamento, telefono: String(telefono),
    numFactura: String(numFactura), consecutivo: String(consecutivo),
    observaciones: observaciones, motivo: motivo, lineas: lineas,
  };
}

function prefillDevForm(data) {
  openNewDev();

  var empSelect = document.getElementById('dev-empresa');
  var empVal = (data.empresa || '').toUpperCase();
  var matched = false;
  for (var i = 0; i < empSelect.options.length; i++) {
    if (empVal.indexOf(empSelect.options[i].value.split(' ')[0].toUpperCase()) >= 0 && empSelect.options[i].value) {
      empSelect.value = empSelect.options[i].value;
      matched = true;
      break;
    }
  }
  if (!matched) {
    for (var i = 0; i < EMPRESAS_HOLDING.length; i++) {
      if (empVal.indexOf(EMPRESAS_HOLDING[i].sigla) >= 0) {
        empSelect.value = EMPRESAS_HOLDING[i].value;
        break;
      }
    }
  }

  if (data.fecha) document.getElementById('dev-fecha').value = data.fecha;
  document.getElementById('dev-consecutivo').value = data.consecutivo || '';
  document.getElementById('dev-vendedor').value = data.vendedor || '';
  document.getElementById('dev-cliente').value = data.cliente || '';
  document.getElementById('dev-nit').value = data.nit || '';
  document.getElementById('dev-direccion').value = data.direccion || '';
  document.getElementById('dev-municipio').value = data.municipio || '';
  document.getElementById('dev-departamento').value = data.departamento || '';
  document.getElementById('dev-telefono').value = data.telefono || '';
  document.getElementById('dev-observaciones').value = data.observaciones || '';

  if (data.motivo) setDevMotivo(data.motivo);

  if (data.lineas && data.lineas.length) {
    devLineas = data.lineas.map(function(l) {
      var cant = Number(l.Cantidad) || 0;
      var vUnit = Number(l.Valor_Unitario) || 0;
      return {
        Num_Factura: l.Num_Factura || data.numFactura || '',
        Producto: l.Producto || '',
        Presentacion: l.Presentacion || '',
        Cantidad: cant,
        Cant_Entregada: Number(l.Cant_Entregada) || 0,
        Valor_Unitario: vUnit,
        Valor_Total: Number(l.Valor_Total) || (cant * vUnit),
      };
    });
    renderDevLines();
  }
}

// ── Tramitar Devolución ──
function openTramitarDev(key) {
  var lines = devoluciones.filter(function(r) {
    return ((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  tramitarDevKey = key;
  tramitarDevLines = lines.map(function(l) {
    return { id: l.__row || l.id, Producto: l.Producto, Presentacion: l.Presentacion, Cantidad: l.Cantidad, Cant_Entregada: l.Cant_Entregada || 0 };
  });

  var r = lines[0];
  document.getElementById('tramitar-dev-meta').innerHTML =
    '<span>📋 Consec: ' + (r.Consecutivo || '—') + '</span>' +
    '<span>👤 ' + (r.Cliente || '—') + '</span>' +
    '<span>' + getSiglaDev(r.Empresa) + '</span>';

  document.getElementById('tramitar-remision-ingreso').value = r.Remision_Ingreso || r.Remision || '';
  document.getElementById('tramitar-bodega-ingreso').value = r.Bodega_Ingreso || 'Productos Buenos';
  document.getElementById('tramitar-fecha-ingreso').value = r.Fecha_Ingreso ? toDateInput(r.Fecha_Ingreso) : (r.Fecha_Devolucion ? toDateInput(r.Fecha_Devolucion) : today());
  document.getElementById('tramitar-remision-salida').value = r.Remision_Salida || '';
  document.getElementById('tramitar-bodega-salida').value = r.Bodega_Salida || 'Productos Buenos';
  document.getElementById('tramitar-fecha-salida').value = r.Fecha_Salida ? toDateInput(r.Fecha_Salida) : today();

  var tbody = document.getElementById('tramitar-lines');
  tbody.innerHTML = tramitarDevLines.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td style="font-weight:600">' + (l.Producto || '—') + '</td>' +
      '<td>' + (l.Presentacion || '—') + '</td>' +
      '<td style="text-align:right">' + (l.Cantidad || 0) + '</td>' +
      '<td><input class="ef tramitar-cant" data-line="' + i + '" type="number" min="0" max="' + (l.Cantidad||9999) + '" value="' + (l.Cant_Entregada || '') + '" placeholder="0" style="width:100px;text-align:right"></td>' +
    '</tr>';
  }).join('');

  document.getElementById('btn-tramitar-dev').disabled = false;
  document.getElementById('btn-tramitar-dev').textContent = '✓ Tramitar devolución';
  document.getElementById('tramitar-dev-overlay').classList.add('show');
}

function closeTramitarDev() {
  document.getElementById('tramitar-dev-overlay').classList.remove('show');
  tramitarDevKey = null;
  tramitarDevLines = [];
}

document.getElementById('tramitar-dev-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeTramitarDev(); });

async function saveTramitarDev() {
  var remIngreso = document.getElementById('tramitar-remision-ingreso').value.trim();
  var bodegaIngreso = document.getElementById('tramitar-bodega-ingreso').value;
  var fechaIngreso = document.getElementById('tramitar-fecha-ingreso').value;
  var remSalida = document.getElementById('tramitar-remision-salida').value.trim();
  var bodegaSalida = document.getElementById('tramitar-bodega-salida').value;
  var fechaSalida = document.getElementById('tramitar-fecha-salida').value;
  if (!remIngreso) { showToast('Ingresa el N° de remisión de ingreso', '#e74c3c'); return; }
  if (!fechaIngreso) { showToast('Selecciona la fecha de ingreso', '#e74c3c'); return; }
  if (!remSalida) { showToast('Ingresa el N° de remisión de salida', '#e74c3c'); return; }
  if (!fechaSalida) { showToast('Selecciona la fecha de salida', '#e74c3c'); return; }

  document.querySelectorAll('.tramitar-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (tramitarDevLines[i]) tramitarDevLines[i].Cant_Entregada = Number(inp.value) || 0;
  });

  var btn = document.getElementById('btn-tramitar-dev');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'tramitarDevolucion',
      Remision_Ingreso: remIngreso,
      Bodega_Ingreso: bodegaIngreso,
      Fecha_Ingreso: fechaIngreso,
      Remision_Salida: remSalida,
      Bodega_Salida: bodegaSalida,
      Fecha_Salida: fechaSalida,
      lineas: tramitarDevLines.map(function(l) { return { id: l.id, Cant_Entregada: l.Cant_Entregada }; })
    });
    if (!result.ok) throw new Error(result.error || 'Error al tramitar');
    closeTramitarDev();
    showToast('✅ Devolución tramitada — ' + result.updated + ' línea(s) actualizadas');
    await loadDevoluciones();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Tramitar devolución';
  }
}

// ── Tab switching ──
function switchTab(tab) {
  var tabs = [
    { id: 'tab-devoluciones', btn: 'tab-btn-dev', color: '#e67e22', key: 'devoluciones' },
    { id: 'tab-cambios', btn: 'tab-btn-cam', color: '#8e44ad', key: 'cambios' },
    { id: 'tab-porproducto', btn: 'tab-btn-prod', color: '#1a5276', key: 'porproducto' }
  ];
  tabs.forEach(function(t) {
    var panel = document.getElementById(t.id);
    var btn = document.getElementById(t.btn);
    if (t.key === tab) {
      panel.style.display = 'block';
      btn.style.borderBottomColor = t.color;
      btn.style.color = t.color;
    } else {
      panel.style.display = 'none';
      btn.style.borderBottomColor = 'transparent';
      btn.style.color = '#718096';
    }
  });
  if (tab === 'cambios' && typeof loadCambios === 'function' && !window._cambiosLoaded) {
    window._cambiosLoaded = true;
    loadCambios();
  }
  if (tab === 'porproducto') {
    if (typeof loadCambios === 'function' && !window._cambiosLoaded) {
      window._cambiosLoaded = true;
      loadCambios().then(function() { calcularPorProducto(); });
    } else {
      calcularPorProducto();
    }
  }
}

// ══════════════════════════════════════════
// ── DETALLE POR PRODUCTO ──
// ══════════════════════════════════════════

var prodData = [];
var prodFiltered = [];
var prodFiltersAttached = false;
var prodSortCol = 'totalUds';
var prodSortDir = 'desc';

var PROD_SORT_COLS = {
  producto:  { fn: function(r) { return r.producto.toLowerCase(); }, type: 'string' },
  devCount:  { fn: function(r) { return r.devCount; }, type: 'number' },
  devCant:   { fn: function(r) { return r.devCant; }, type: 'number' },
  camCount:  { fn: function(r) { return r.camCount; }, type: 'number' },
  camCant:   { fn: function(r) { return r.camCant; }, type: 'number' },
  devValor:  { fn: function(r) { return r.devValor; }, type: 'number' },
  clientes:  { fn: function(r) { return Object.keys(r.clientes).length; }, type: 'number' },
  totalUds:  { fn: function(r) { return r.devCant + r.camCant; }, type: 'number' },
};

function toggleProdSort(col) {
  if (prodSortCol === col) {
    prodSortDir = prodSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    prodSortCol = col;
    prodSortDir = col === 'producto' ? 'asc' : 'desc';
  }
  renderPorProducto();
}

function calcularPorProducto() {
  var map = {};

  devoluciones.forEach(function(r) {
    var prod = r.Producto || '';
    if (!prod) return;
    var emp = r.Empresa || '';
    var fEmp = document.getElementById('fp-empresa').value;
    if (fEmp && emp !== fEmp) return;
    if (!map[prod]) map[prod] = { producto: prod, devCant: 0, devValor: 0, devCount: 0, camCant: 0, camCount: 0, empresas: {}, clientes: {}, motivos: {}, _devLines: [], _camLines: [] };
    var cant = Number(r.Cantidad) || 0;
    var cantEnt = Number(r.Cant_Entregada) || 0;
    var valor = Number(r.Valor_Total) || 0;
    map[prod].devCant += cantEnt || cant;
    map[prod].devValor += valor;
    map[prod].devCount++;
    if (emp) map[prod].empresas[getSiglaDev(emp)] = true;
    if (r.Cliente) map[prod].clientes[r.Cliente] = true;
    if (r.Motivo) map[prod].motivos[r.Motivo] = (map[prod].motivos[r.Motivo] || 0) + 1;
    map[prod]._devLines.push(r);
  });

  if (typeof cambios !== 'undefined') {
    cambios.forEach(function(r) {
      var tipo = (r.Tipo_Linea || '').toUpperCase();
      if (tipo !== 'CAMBIAR') return;
      var prod = r.Producto || '';
      if (!prod) return;
      var emp = r.Empresa || '';
      var fEmp = document.getElementById('fp-empresa').value;
      if (fEmp && emp !== fEmp) return;
      if (!map[prod]) map[prod] = { producto: prod, devCant: 0, devValor: 0, devCount: 0, camCant: 0, camCount: 0, empresas: {}, clientes: {}, motivos: {}, _devLines: [], _camLines: [] };
      var cant = Number(r.Cantidad) || 0;
      map[prod].camCant += cant;
      map[prod].camCount++;
      if (emp) map[prod].empresas[getSiglaCam ? getSiglaCam(emp) : getSiglaDev(emp)] = true;
      if (r.Cliente) map[prod].clientes[r.Cliente] = true;
      map[prod]._camLines.push(r);
    });
  }

  prodData = Object.keys(map).sort().map(function(k) { return map[k]; });

  if (!prodFiltersAttached) {
    document.getElementById('fp-empresa').addEventListener('change', function() { calcularPorProducto(); });
    document.getElementById('fp-buscar').addEventListener('input', renderPorProducto);
    document.getElementById('fp-tipo').addEventListener('change', renderPorProducto);
    prodFiltersAttached = true;
  }

  renderPorProducto();
}

function clearProdFilters() {
  document.getElementById('fp-empresa').value = '';
  document.getElementById('fp-buscar').value = '';
  document.getElementById('fp-tipo').value = '';
  calcularPorProducto();
}

function refreshProdTab() {
  loadDevoluciones().then(function() {
    if (typeof loadCambios === 'function') loadCambios().then(function() { calcularPorProducto(); });
    else calcularPorProducto();
  });
}

function renderPorProducto() {
  var buscar = (document.getElementById('fp-buscar').value || '').toLowerCase().trim();
  var tipo = document.getElementById('fp-tipo').value;

  prodFiltered = prodData.filter(function(row) {
    if (buscar && row.producto.toLowerCase().indexOf(buscar) < 0) return false;
    if (tipo === 'devoluciones' && row.devCount === 0) return false;
    if (tipo === 'cambios' && row.camCount === 0) return false;
    return true;
  });

  var sortDef = PROD_SORT_COLS[prodSortCol];
  if (sortDef) {
    prodFiltered.sort(function(a, b) {
      var va = sortDef.fn(a), vb = sortDef.fn(b);
      var cmp = sortDef.type === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      return prodSortDir === 'asc' ? cmp : -cmp;
    });
  }

  var totalDev = 0, totalCam = 0, totalValor = 0;
  prodFiltered.forEach(function(row) {
    totalDev += row.devCant;
    totalCam += row.camCant;
    totalValor += row.devValor;
  });

  document.getElementById('sp-productos').textContent = prodFiltered.length;
  document.getElementById('sp-total-dev').textContent = totalDev.toLocaleString('es-CO');
  document.getElementById('sp-total-cam').textContent = totalCam.toLocaleString('es-CO');
  document.getElementById('sp-valor').textContent = fmtMoney(totalValor);
  document.getElementById('row-ct-prod').textContent = '(' + prodFiltered.length + ' productos)';

  renderProdTable();
}

function renderProdTable() {
  var cols = [
    { label: '#', id: null },
    { label: 'Producto', id: 'producto' },
    { label: 'Dev.', id: 'devCount' },
    { label: 'Uds. Devueltas', id: 'devCant' },
    { label: 'Cambios', id: 'camCount' },
    { label: 'Uds. Cambios', id: 'camCant' },
    { label: 'Valor Dev.', id: 'devValor' },
    { label: 'Empresas', id: null },
    { label: 'Clientes', id: 'clientes' },
    { label: 'Motivo Principal', id: null },
    { label: '', id: null }
  ];
  document.getElementById('t-head-prod').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var active = prodSortCol === col.id;
    var dirCls = active ? (prodSortDir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleProdSort(\'' + col.id + '\')">' + col.label + '<span class="sort-icon"></span></th>';
  }).join('');

  var tbody = document.getElementById('t-body-prod');
  if (!prodFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="' + cols.length + '"><div class="empty" style="text-align:center;padding:32px;color:#718096">No hay datos con los filtros seleccionados.</div></td></tr>';
    document.getElementById('t-foot-prod').innerHTML = '';
    return;
  }

  tbody.innerHTML = prodFiltered.map(function(row, i) {
    var empresasList = Object.keys(row.empresas).sort().join(', ') || '—';
    var clienteCount = Object.keys(row.clientes).length;
    var motivoPrincipal = '—';
    var maxMot = 0;
    Object.keys(row.motivos).forEach(function(m) {
      if (row.motivos[m] > maxMot) { maxMot = row.motivos[m]; motivoPrincipal = m; }
    });
    var totalUds = row.devCant + row.camCant;

    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
      '<td style="font-weight:600;font-size:0.84rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + row.producto.replace(/"/g, '&quot;') + '">' + row.producto + '</td>' +
      '<td style="text-align:center"><span style="background:#fef5e7;color:#e67e22;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.78rem">' + row.devCount + '</span></td>' +
      '<td style="text-align:right;font-weight:700;color:' + (row.devCant > 0 ? '#e67e22' : '#cbd5e0') + '">' + row.devCant.toLocaleString('es-CO') + '</td>' +
      '<td style="text-align:center"><span style="background:#f3e8ff;color:#8e44ad;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.78rem">' + row.camCount + '</span></td>' +
      '<td style="text-align:right;font-weight:700;color:' + (row.camCant > 0 ? '#8e44ad' : '#cbd5e0') + '">' + row.camCant.toLocaleString('es-CO') + '</td>' +
      '<td style="text-align:right;font-weight:700;font-size:0.82rem">' + fmtMoney(row.devValor) + '</td>' +
      '<td style="font-size:0.76rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + empresasList.replace(/"/g, '&quot;') + '">' + empresasList + '</td>' +
      '<td style="text-align:center;font-weight:600">' + clienteCount + '</td>' +
      '<td style="font-size:0.76rem;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + motivoPrincipal.replace(/"/g, '&quot;') + '">' + motivoPrincipal + '</td>' +
      '<td><button class="btn-edit" onclick="openProdDetail(\'' + row.producto.replace(/'/g, "\\'").replace(/"/g, '&quot;') + '\')" title="Ver detalle" style="background:#1a5276;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📋 Ver</button></td>' +
    '</tr>';
  }).join('');

  var tDev = 0, tCam = 0, tValor = 0;
  prodFiltered.forEach(function(r) { tDev += r.devCant; tCam += r.camCant; tValor += r.devValor; });
  document.getElementById('t-foot-prod').innerHTML =
    '<td></td><td style="font-size:0.84rem;color:#2d3748">TOTALES</td>' +
    '<td style="text-align:center">' + prodFiltered.reduce(function(s, r) { return s + r.devCount; }, 0) + '</td>' +
    '<td style="text-align:right;color:#e67e22">' + tDev.toLocaleString('es-CO') + '</td>' +
    '<td style="text-align:center">' + prodFiltered.reduce(function(s, r) { return s + r.camCount; }, 0) + '</td>' +
    '<td style="text-align:right;color:#8e44ad">' + tCam.toLocaleString('es-CO') + '</td>' +
    '<td style="text-align:right">' + fmtMoney(tValor) + '</td>' +
    '<td></td><td></td><td></td><td></td>';
}

function openProdDetail(producto) {
  var row = null;
  for (var i = 0; i < prodData.length; i++) {
    if (prodData[i].producto === producto) { row = prodData[i]; break; }
  }
  if (!row) return;

  document.getElementById('prod-detail-title').textContent = '📦 ' + row.producto;
  document.getElementById('prod-detail-sub').textContent =
    row.devCount + ' devolución(es) · ' + row.camCount + ' cambio(s) · ' + (row.devCant + row.camCant) + ' unidades totales';

  var html = '';

  if (row._devLines.length) {
    html += '<div style="margin-bottom:20px">' +
      '<div style="font-weight:700;font-size:0.88rem;color:#e67e22;margin-bottom:10px;display:flex;align-items:center;gap:8px">' +
        '<span style="background:#e67e22;color:white;padding:2px 10px;border-radius:10px;font-size:0.76rem">' + row.devCount + '</span> Devoluciones — ' + row.devCant.toLocaleString('es-CO') + ' uds — ' + fmtMoney(row.devValor) +
      '</div>' +
      '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#fef5e7">' +
        '<th>Fecha</th><th>Empresa</th><th>Consec.</th><th>Cliente</th><th>Motivo</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Devuelta</th><th style="text-align:right">Valor</th><th>Estado</th>' +
      '</tr></thead><tbody>';
    row._devLines.forEach(function(d) {
      var estado = d.Estado === 'Tramitada'
        ? '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700">Tramitada</span>'
        : '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700">Pendiente</span>';
      html += '<tr>' +
        '<td style="white-space:nowrap">' + fmtDate(d.Fecha) + '</td>' +
        '<td><span class="sigla-badge ' + getSiglaClassDev(d.Empresa) + '">' + getSiglaDev(d.Empresa) + '</span></td>' +
        '<td style="text-align:center;font-weight:600">' + (d.Consecutivo || '—') + '</td>' +
        '<td style="font-weight:600">' + (d.Cliente || '—') + '</td>' +
        '<td style="font-size:0.76rem;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (d.Motivo || '').replace(/"/g, '&quot;') + '">' + (d.Motivo || '—') + '</td>' +
        '<td style="text-align:right">' + (Number(d.Cantidad) || 0) + '</td>' +
        '<td style="text-align:right;font-weight:700;color:#e67e22">' + (Number(d.Cant_Entregada) || 0) + '</td>' +
        '<td style="text-align:right;font-weight:700">' + fmtMoney(d.Valor_Total) + '</td>' +
        '<td>' + estado + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div></div>';
  }

  if (row._camLines.length) {
    html += '<div>' +
      '<div style="font-weight:700;font-size:0.88rem;color:#8e44ad;margin-bottom:10px;display:flex;align-items:center;gap:8px">' +
        '<span style="background:#8e44ad;color:white;padding:2px 10px;border-radius:10px;font-size:0.76rem">' + row.camCount + '</span> Cambios — ' + row.camCant.toLocaleString('es-CO') + ' uds' +
      '</div>' +
      '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#f3e8ff">' +
        '<th>Fecha</th><th>Empresa</th><th>Consec.</th><th>Cliente</th><th style="text-align:right">Cantidad</th><th>Razón</th><th>Estado</th>' +
      '</tr></thead><tbody>';
    row._camLines.forEach(function(c) {
      var estado = (c.Estado || 'Pendiente');
      var estadoBadge = estado === 'Cerrado'
        ? '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700">Cerrado</span>'
        : estado === 'Completado'
          ? '<span style="background:#cce5ff;color:#004085;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700">Completado</span>'
          : '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700">' + estado + '</span>';
      html += '<tr>' +
        '<td style="white-space:nowrap">' + fmtDate(c.Fecha_Solicitud || c.Fecha) + '</td>' +
        '<td><span class="sigla-badge ' + getSiglaClassDev(c.Empresa) + '">' + getSiglaDev(c.Empresa) + '</span></td>' +
        '<td style="text-align:center;font-weight:600">' + (c.Consecutivo || '—') + '</td>' +
        '<td style="font-weight:600">' + (c.Cliente || '—') + '</td>' +
        '<td style="text-align:right;font-weight:700;color:#8e44ad">' + (Number(c.Cantidad) || 0) + '</td>' +
        '<td style="font-size:0.76rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (c.Razon || '').replace(/"/g, '&quot;') + '">' + (c.Razon || '—') + '</td>' +
        '<td>' + estadoBadge + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div></div>';
  }

  document.getElementById('prod-detail-body').innerHTML = html;
  document.getElementById('prod-detail-overlay').classList.add('show');
}

function closeProdDetail() {
  document.getElementById('prod-detail-overlay').classList.remove('show');
}

document.getElementById('prod-detail-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeProdDetail(); });

function exportProdExcel() {
  if (!prodFiltered.length) { showToast('No hay datos para exportar.', '#e74c3c'); return; }

  var data = prodFiltered.map(function(row, i) {
    var motivoPrincipal = '—';
    var maxMot = 0;
    Object.keys(row.motivos).forEach(function(m) {
      if (row.motivos[m] > maxMot) { maxMot = row.motivos[m]; motivoPrincipal = m; }
    });
    return {
      '#': i + 1,
      'Producto': row.producto,
      'N° Devoluciones': row.devCount,
      'Uds. Devueltas': row.devCant,
      'N° Cambios': row.camCount,
      'Uds. Cambios': row.camCant,
      'Valor Devoluciones': row.devValor,
      'Empresas': Object.keys(row.empresas).sort().join(', '),
      'N° Clientes': Object.keys(row.clientes).length,
      'Motivo Principal': motivoPrincipal
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 5 }, { wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 18 }, { wch: 25 }, { wch: 12 }, { wch: 30 }
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle por Producto');
  XLSX.writeFile(wb, 'Devoluciones_por_Producto_' + today() + '.xlsx');
  showToast('Excel exportado: ' + prodFiltered.length + ' productos');
}

// ── Bulk Tramitar (2-step wizard) ──
var bulkTramitarData = { keys: [], groups: [], allLines: [] };

function openBulkTramitarDev() {
  var keys = Object.keys(selectedDevKeys).filter(function(k) { return selectedDevKeys[k]; });
  if (!keys.length) { showToast('Selecciona al menos una devolución pendiente', '#e74c3c'); return; }

  var allLines = [];
  var groupMap = {};
  var groupOrder = [];

  keys.forEach(function(key) {
    var lines = devoluciones.filter(function(r) {
      return ((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) === key;
    });
    if (!lines.length) return;
    var r = lines[0];
    var gKey = (r.Empresa || '') + '||' + (r.Fecha || '') + '||' + (r.Cliente || '');
    if (!groupMap[gKey]) {
      groupMap[gKey] = {
        empresa: r.Empresa, empresaSigla: getSiglaDev(r.Empresa), empresaClass: getSiglaClassDev(r.Empresa),
        fecha: r.Fecha, cliente: r.Cliente || '—',
        consecutivos: [], nProds: 0, totalCant: 0, totalValor: 0, devKeys: []
      };
      groupOrder.push(gKey);
    }
    var g = groupMap[gKey];
    g.consecutivos.push(r.Consecutivo || '—');
    g.nProds += lines.length;
    g.devKeys.push(key);
    lines.forEach(function(l) {
      g.totalCant += Number(l.Cantidad) || 0;
      g.totalValor += Number(l.Valor_Total) || 0;
      allLines.push({
        id: l.__row || l.id, Producto: l.Producto, Presentacion: l.Presentacion,
        Cantidad: l.Cantidad, Cant_Entregada: l.Cant_Entregada || 0,
        Consecutivo: r.Consecutivo || '—', Cliente: r.Cliente || '—'
      });
    });
  });

  var groups = groupOrder.map(function(k) { return groupMap[k]; });
  bulkTramitarData = { keys: keys, groups: groups, allLines: allLines };

  document.getElementById('bulk-tramitar-meta').innerHTML =
    '<span>' + keys.length + ' devolución(es)</span>' +
    '<span>' + groups.length + ' grupo(s) por empresa/fecha/cliente</span>' +
    '<span>' + allLines.length + ' línea(s) de producto</span>';

  var groupsHtml = groups.map(function(g, gi) {
    return '<div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span class="sigla-badge ' + g.empresaClass + '">' + g.empresaSigla + '</span>' +
          '<span style="font-weight:700;font-size:0.9rem;color:#2d3748">' + g.cliente + '</span>' +
          '<span style="font-size:0.78rem;color:#718096">📅 ' + fmtDate(g.fecha) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<span style="background:#edf2f7;padding:3px 10px;border-radius:10px;font-size:0.76rem;font-weight:600;color:#4a5568">' + g.nProds + ' producto(s)</span>' +
          '<span style="font-weight:700;font-size:0.86rem;color:#2d3748">' + fmtMoney(g.totalValor) + '</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
        '<span style="font-size:0.76rem;color:#718096;font-weight:600">Consecutivos:</span>' +
        g.consecutivos.map(function(c) {
          return '<span style="background:#e2e8f0;padding:2px 8px;border-radius:6px;font-size:0.78rem;font-weight:600;color:#2d3748">' + c + '</span>';
        }).join('') +
        '<span style="font-size:0.76rem;color:#718096;margin-left:8px">Cant. total: <strong>' + g.totalCant + '</strong></span>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('bulk-tramitar-groups').innerHTML = groupsHtml;

  document.getElementById('bulk-step-1').style.display = 'block';
  document.getElementById('bulk-step-2').style.display = 'none';
  document.getElementById('btn-bulk-next').style.display = 'inline-block';
  document.getElementById('btn-bulk-back').style.display = 'none';
  document.getElementById('btn-bulk-tramitar-dev').style.display = 'none';
  document.getElementById('bulk-tramitar-title').textContent = '📝 Vista General — Devoluciones Seleccionadas';
  document.getElementById('bulk-tramitar-footer-msg').textContent = 'Revisa las devoluciones y continúa al detalle';

  document.getElementById('bulk-tramitar-dev-overlay').classList.add('show');
}

function bulkTramitarNext() {
  document.getElementById('bulk-step-1').style.display = 'none';
  document.getElementById('bulk-step-2').style.display = 'block';
  document.getElementById('btn-bulk-next').style.display = 'none';
  document.getElementById('btn-bulk-back').style.display = 'inline-block';
  document.getElementById('btn-bulk-tramitar-dev').style.display = 'inline-block';
  document.getElementById('bulk-tramitar-title').textContent = '📝 Detalle de Productos y Trámite';
  document.getElementById('bulk-tramitar-footer-msg').innerHTML = 'Se actualizará el estado a <strong>Tramitada</strong> en todas las seleccionadas';

  var linesHtml = bulkTramitarData.allLines.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td style="font-weight:600;font-size:0.78rem;text-align:center">' + l.Consecutivo + '</td>' +
      '<td style="font-size:0.78rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (l.Cliente || '').replace(/"/g,'&quot;') + '">' + l.Cliente + '</td>' +
      '<td style="font-weight:600">' + (l.Producto || '—') + '</td>' +
      '<td style="font-size:0.78rem">' + (l.Presentacion || '—') + '</td>' +
      '<td style="text-align:right">' + (l.Cantidad || 0) + '</td>' +
      '<td><input class="ef bulk-cant-dev" data-idx="' + i + '" type="number" min="0" max="' + (l.Cantidad || 9999) + '" value="' + (Number(l.Cant_Entregada) || Number(l.Cantidad) || 0) + '" style="width:100px;text-align:right"></td>' +
    '</tr>';
  }).join('');
  document.getElementById('bulk-tramitar-lines').innerHTML = linesHtml;

  document.getElementById('bulk-tramitar-remision-ingreso').value = '';
  document.getElementById('bulk-tramitar-bodega-ingreso').value = 'Productos Buenos';
  document.getElementById('bulk-tramitar-fecha-ingreso').value = today();
  document.getElementById('bulk-tramitar-remision-salida').value = '';
  document.getElementById('bulk-tramitar-bodega-salida').value = 'Productos Buenos';
  document.getElementById('bulk-tramitar-fecha-salida').value = today();

  document.getElementById('btn-bulk-tramitar-dev').disabled = false;
  document.getElementById('btn-bulk-tramitar-dev').textContent = '✓ Tramitar ' + bulkTramitarData.keys.length + ' devolución(es)';
}

function bulkTramitarBack() {
  document.getElementById('bulk-step-1').style.display = 'block';
  document.getElementById('bulk-step-2').style.display = 'none';
  document.getElementById('btn-bulk-next').style.display = 'inline-block';
  document.getElementById('btn-bulk-back').style.display = 'none';
  document.getElementById('btn-bulk-tramitar-dev').style.display = 'none';
  document.getElementById('bulk-tramitar-title').textContent = '📝 Vista General — Devoluciones Seleccionadas';
  document.getElementById('bulk-tramitar-footer-msg').textContent = 'Revisa las devoluciones y continúa al detalle';
}

function closeBulkTramitarDev() {
  document.getElementById('bulk-tramitar-dev-overlay').classList.remove('show');
}

document.getElementById('bulk-tramitar-dev-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeBulkTramitarDev(); });

async function saveBulkTramitarDev() {
  var remIngreso = document.getElementById('bulk-tramitar-remision-ingreso').value.trim();
  var bodegaIngreso = document.getElementById('bulk-tramitar-bodega-ingreso').value;
  var fechaIngreso = document.getElementById('bulk-tramitar-fecha-ingreso').value;
  var remSalida = document.getElementById('bulk-tramitar-remision-salida').value.trim();
  var bodegaSalida = document.getElementById('bulk-tramitar-bodega-salida').value;
  var fechaSalida = document.getElementById('bulk-tramitar-fecha-salida').value;

  if (!remIngreso) { showToast('Ingresa el N° de remisión de ingreso', '#e74c3c'); return; }
  if (!fechaIngreso) { showToast('Selecciona la fecha de ingreso', '#e74c3c'); return; }
  if (!remSalida) { showToast('Ingresa el N° de remisión de salida', '#e74c3c'); return; }
  if (!fechaSalida) { showToast('Selecciona la fecha de salida', '#e74c3c'); return; }

  document.querySelectorAll('.bulk-cant-dev').forEach(function(inp) {
    var idx = Number(inp.dataset.idx);
    if (bulkTramitarData.allLines[idx]) bulkTramitarData.allLines[idx].Cant_Entregada = Number(inp.value) || 0;
  });

  var keys = bulkTramitarData.keys;
  if (!keys.length) return;

  var btn = document.getElementById('btn-bulk-tramitar-dev');
  btn.disabled = true;
  btn.textContent = '⏳ Tramitando...';

  var totalUpdated = 0;
  var errors = [];

  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var lines = devoluciones.filter(function(r) {
      return ((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) === key;
    });
    if (!lines.length) continue;

    var lineas = lines.map(function(l) {
      var lineId = l.__row || l.id;
      var match = bulkTramitarData.allLines.filter(function(al) { return al.id === lineId; })[0];
      var cantDev = match ? (Number(match.Cant_Entregada) || 0) : (Number(l.Cant_Entregada) || Number(l.Cantidad) || 0);
      return { id: lineId, Cant_Entregada: cantDev };
    });

    try {
      var result = await apiPost({
        action: 'tramitarDevolucion',
        Remision_Ingreso: remIngreso,
        Bodega_Ingreso: bodegaIngreso,
        Fecha_Ingreso: fechaIngreso,
        Remision_Salida: remSalida,
        Bodega_Salida: bodegaSalida,
        Fecha_Salida: fechaSalida,
        lineas: lineas
      });
      if (!result.ok) {
        errors.push((lines[0].Consecutivo || key) + ': ' + (result.error || 'Error'));
      } else {
        totalUpdated += result.updated || lineas.length;
      }
    } catch (err) {
      errors.push((lines[0].Consecutivo || key) + ': ' + err.message);
    }
  }

  closeBulkTramitarDev();
  selectedDevKeys = {};

  if (errors.length) {
    showToast('⚠️ Tramitadas con errores: ' + errors.join('; '), '#e67e22');
  } else {
    showToast('✅ ' + keys.length + ' devolución(es) tramitada(s) — ' + totalUpdated + ' línea(s) actualizadas');
  }

  await loadDevoluciones();
}

// ── Pagination ──
function devGoToPage(p) {
  devCurrentPage = p;
  renderDevTable();
  var card = document.querySelector('#panel-dev-ordenes .card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function devChangePageSize(val) {
  devPageSize = Number(val) || 25;
  devCurrentPage = 1;
  renderDevTable();
}

function renderDevPagination(totalRows) {
  var el = document.getElementById('dev-pagination');
  if (!el) return;
  var totalPages = Math.ceil(totalRows / devPageSize);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  var start = (devCurrentPage - 1) * devPageSize + 1;
  var end = Math.min(devCurrentPage * devPageSize, totalRows);
  var html = '<span class="pg-info">' + start + '–' + end + ' de ' + totalRows + '</span>';

  html += '<button ' + (devCurrentPage <= 1 ? 'disabled' : 'onclick="devGoToPage(1)"') + ' title="Primera">«</button>';
  html += '<button ' + (devCurrentPage <= 1 ? 'disabled' : 'onclick="devGoToPage(' + (devCurrentPage - 1) + ')"') + ' title="Anterior">‹</button>';

  var range = [];
  if (totalPages <= 7) {
    for (var i = 1; i <= totalPages; i++) range.push(i);
  } else {
    range.push(1);
    if (devCurrentPage > 3) range.push('...');
    for (var i = Math.max(2, devCurrentPage - 1); i <= Math.min(totalPages - 1, devCurrentPage + 1); i++) range.push(i);
    if (devCurrentPage < totalPages - 2) range.push('...');
    range.push(totalPages);
  }
  range.forEach(function(p) {
    if (p === '...') { html += '<span class="pg-ellipsis">…</span>'; return; }
    html += '<button class="' + (p === devCurrentPage ? 'pg-active' : '') + '" onclick="devGoToPage(' + p + ')">' + p + '</button>';
  });

  html += '<button ' + (devCurrentPage >= totalPages ? 'disabled' : 'onclick="devGoToPage(' + (devCurrentPage + 1) + ')"') + ' title="Siguiente">›</button>';
  html += '<button ' + (devCurrentPage >= totalPages ? 'disabled' : 'onclick="devGoToPage(' + totalPages + ')"') + ' title="Última">»</button>';

  html += '<select onchange="devChangePageSize(this.value)">';
  [25, 50, 100].forEach(function(n) {
    html += '<option value="' + n + '"' + (devPageSize === n ? ' selected' : '') + '>' + n + ' / pág</option>';
  });
  html += '</select>';

  el.innerHTML = html;
}

// ── Sub-tab switching ──
function switchDevSubTab(tab) {
  var ordenes = document.getElementById('panel-dev-ordenes');
  var detalle = document.getElementById('panel-dev-detalle');
  var tabOrd = document.getElementById('dev-subtab-ordenes');
  var tabDet = document.getElementById('dev-subtab-detalle');
  if (tab === 'ordenes') {
    ordenes.style.display = 'block';
    detalle.style.display = 'none';
    tabOrd.style.background = '#e67e22';
    tabDet.style.background = '#718096';
  } else {
    ordenes.style.display = 'none';
    detalle.style.display = 'block';
    tabOrd.style.background = '#718096';
    tabDet.style.background = '#e67e22';
    renderDevDetalle();
  }
}

// ── Vista Detallada (flat per-line) ──
var DEV_DET_COLS = [
  { id: 'empresa', label: 'Empresa' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'consecutivo', label: 'Consecutivo' },
  { id: 'fecha', label: 'Fecha' },
  { id: 'factura', label: 'Factura' },
  { id: 'producto', label: 'Producto' },
  { id: 'presentacion', label: 'Presentación' },
  { id: 'cantidad', label: 'Cantidad' },
  { id: 'cant_devuelta', label: 'Cant. Devuelta' },
  { id: 'valor_total', label: 'V. Total' },
  { id: 'motivo', label: 'Motivo' },
  { id: 'estado', label: 'Estado' },
];

function toggleDevDetSort(col, e) {
  var shift = e && e.shiftKey;
  var idx = devDetSort.findIndex(function(l) { return l.col === col; });
  if (shift) {
    if (idx >= 0) devDetSort.splice(idx, 1);
    else devDetSort.push({ col: col, dir: 'asc' });
  } else if (idx >= 0) {
    if (devDetSort[idx].dir === 'asc') devDetSort[idx].dir = 'desc';
    else devDetSort.splice(idx, 1);
  } else {
    devDetSort = [{ col: col, dir: 'asc' }];
  }
  renderDevDetalle();
}

function renderDevDetalle() {
  var fe = document.getElementById('f-empresa').value;
  var fc = document.getElementById('f-cliente').value;
  var fm = document.getElementById('f-motivo').value;
  var fp = document.getElementById('f-prod').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();

  var rows = devoluciones.filter(function(r) {
    if (fe && r.Empresa !== fe) return false;
    if (fc && r.Cliente !== fc) return false;
    if (fm && r.Motivo !== fm) return false;
    if (fp && r.Producto !== fp) return false;
    if (ft) {
      var hay = [r.Cliente, r.Vendedor, r.Producto, r.Presentacion, r.Num_Factura, r.Motivo, r.Observaciones, r.Consecutivo, r.NIT, r.Remision, r.Estado].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });

  if (devDetSort.length) {
    rows = [].concat(rows).sort(function(a, b) {
      for (var s = 0; s < devDetSort.length; s++) {
        var col = devDetSort[s].col, dir = devDetSort[s].dir;
        var va, vb;
        if (col === 'empresa') { va = getSiglaDev(a.Empresa); vb = getSiglaDev(b.Empresa); }
        else if (col === 'cliente') { va = (a.Cliente||'').toLowerCase(); vb = (b.Cliente||'').toLowerCase(); }
        else if (col === 'consecutivo') { va = Number(a.Consecutivo)||0; vb = Number(b.Consecutivo)||0; }
        else if (col === 'fecha') { va = +(new Date(a.Fecha||0)); vb = +(new Date(b.Fecha||0)); }
        else if (col === 'factura') { va = (a.Num_Factura||'').toLowerCase(); vb = (b.Num_Factura||'').toLowerCase(); }
        else if (col === 'producto') { va = (a.Producto||'').toLowerCase(); vb = (b.Producto||'').toLowerCase(); }
        else if (col === 'presentacion') { va = (a.Presentacion||'').toLowerCase(); vb = (b.Presentacion||'').toLowerCase(); }
        else if (col === 'cantidad') { va = Number(a.Cantidad)||0; vb = Number(b.Cantidad)||0; }
        else if (col === 'cant_devuelta') { va = Number(a.Cant_Entregada)||0; vb = Number(b.Cant_Entregada)||0; }
        else if (col === 'valor_total') { va = Number(a.Valor_Total)||0; vb = Number(b.Valor_Total)||0; }
        else if (col === 'motivo') { va = (a.Motivo||'').toLowerCase(); vb = (b.Motivo||'').toLowerCase(); }
        else if (col === 'estado') { va = (a.Estado||'Pendiente'); vb = (b.Estado||'Pendiente'); }
        else { va = ''; vb = ''; }
        var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  document.getElementById('dev-det-count').textContent = '(' + rows.length + ' líneas)';

  var headEl = document.getElementById('dev-det-head');
  headEl.innerHTML = DEV_DET_COLS.map(function(c) {
    var idx = devDetSort.findIndex(function(l) { return l.col === c.id; });
    var cls = idx >= 0 ? (devDetSort[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = idx >= 0 && devDetSort.length > 1 ? '<span style="font-size:0.6rem;vertical-align:super;color:#e67e22">' + (idx+1) + '</span>' : '';
    return '<th class="sortable ' + cls + '" onclick="toggleDevDetSort(\'' + c.id + '\',event)">' + c.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');

  var tbody = document.getElementById('dev-det-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="' + DEV_DET_COLS.length + '"><div class="empty">No hay líneas con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    var estado = (r.Estado || 'Pendiente').trim();
    var estadoBadge = estado === 'Tramitada'
      ? '<span style="background:#d4edda;color:#155724;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Tramitada</span>'
      : '<span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Pendiente</span>';
    return '<tr>' +
      '<td><span class="sigla-badge ' + getSiglaClassDev(r.Empresa) + '">' + getSiglaDev(r.Empresa) + '</span></td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.Cliente||'') + '">' + (r.Cliente||'—') + '</td>' +
      '<td style="text-align:center;font-weight:700">' + (r.Consecutivo||'') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha) + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Num_Factura||'—') + '</td>' +
      '<td style="font-weight:600">' + (r.Producto||'—') + '</td>' +
      '<td>' + (r.Presentacion||'—') + '</td>' +
      '<td class="money">' + (Number(r.Cantidad)||0).toLocaleString('es-CO') + '</td>' +
      '<td class="money" style="color:#e67e22;font-weight:600">' + (Number(r.Cant_Entregada)||0).toLocaleString('es-CO') + '</td>' +
      '<td class="money" style="font-weight:700">' + fmtMoney(r.Valor_Total) + '</td>' +
      '<td style="font-size:0.76rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.Motivo||'') + '">' + (r.Motivo||'—') + '</td>' +
      '<td style="text-align:center">' + estadoBadge + '</td>' +
    '</tr>';
  }).join('');
}

function exportDevDetalleCSV() {
  var rows = filteredDev();
  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var lines = ['Empresa,Cliente,Consecutivo,Fecha,Factura,Producto,Presentacion,Cantidad,Cant_Devuelta,Valor_Total,Motivo,Estado'];
  rows.forEach(function(r) {
    lines.push([
      getSiglaDev(r.Empresa),
      '"' + (r.Cliente||'').replace(/"/g,'""') + '"',
      r.Consecutivo||'',
      r.Fecha||'',
      '"' + (r.Num_Factura||'').replace(/"/g,'""') + '"',
      '"' + (r.Producto||'').replace(/"/g,'""') + '"',
      '"' + (r.Presentacion||'').replace(/"/g,'""') + '"',
      Number(r.Cantidad)||0,
      Number(r.Cant_Entregada)||0,
      Number(r.Valor_Total)||0,
      '"' + (r.Motivo||'').replace(/"/g,'""') + '"',
      r.Estado||'Pendiente',
    ].join(','));
  });

  var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Devoluciones_Detalle_' + today() + '.csv';
  link.click();
  showToast('CSV exportado: ' + rows.length + ' líneas');
}

// ── Auto-load ──
loadDevoluciones();
loadCatalogoDev();
loadClientesDev();
