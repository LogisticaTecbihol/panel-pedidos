// ── Sorting ──
var sortLevels = [];

var SORT_COLS = [
  { id:'empresa',     label:'Empresa',      fn: function(c) { return getSigla(c.Nombre_Empresa); } },
  { id:'consecutivo', label:'Consecutivo',  fn: function(c) { return Number(c.Consecutivo)||0; } },
  { id:'cliente',     label:'Cliente',      fn: function(c) { return (c.Cliente||'').toLowerCase(); } },
  { id:'fecha',       label:'Fecha Pedido', fn: function(c) { return +new Date(c.Fecha_Pedido||0); } },
  { id:'comercial',   label:'Comercial',    fn: function(c) { return (c.Comercial||'').toLowerCase(); } },
  { id:'total',       label:'Total Orden',  fn: function(c) { return Number(c.Total_Orden)||0; } },
  { id:'productos',   label:'Productos',    fn: function(c) { return getLinesFor(c).length; } },
  { id:'avance',      label:'Avance',       fn: function(c) { return derivedPct(getLinesFor(c)); } },
  { id:'estado',      label:'Estado',       fn: function(c) { return derivedStatus(getLinesFor(c)); } },
  { id:'estado2',     label:'Estado 2',     fn: function(c) { return derivedEstado2(getLinesFor(c)); } },
];

function toggleSort(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevels.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevels.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevels[idx].dir === 'asc') sortLevels[idx].dir = 'desc'; else sortLevels.splice(idx, 1); }
  else { sortLevels.push({ id: id, dir: 'asc' }); }
  renderTable();
}

function clearSort() { sortLevels = []; renderTable(); }

function applySort(rows) {
  if (!sortLevels.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevels.length; si++) {
      var lvl = sortLevels[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS.length; ci++) { if (SORT_COLS[ci].id === lvl.id) { col = SORT_COLS[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function renderHeader() {
  var cols = [
    { label:'#', id:null }, { label:'Empresa', id:'empresa' }, { label:'Consecutivo', id:'consecutivo' },
    { label:'Cliente', id:'cliente' }, { label:'Fecha Pedido', id:'fecha' }, { label:'Comercial', id:'comercial' },
    { label:'Total Orden', id:'total' }, { label:'Productos', id:'productos' }, { label:'Avance', id:'avance' },
    { label:'Estado', id:'estado' }, { label:'Estado 2', id:'estado2' }, { label:'Acción', id:null },
  ];
  document.getElementById('t-head').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = sortLevels.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevels[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevels.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSort(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');
  var btn = document.getElementById('btn-clear-sort');
  if (btn) btn.style.display = sortLevels.length ? 'inline-block' : 'none';
}

// ── Siglas ──
var SIGLAS = {
  'PARCELAR DE COLOMBIA SAS': 'PARCELAR',
  'GREEN AGROSOLUCIONES DE COLOMBIA SAS': 'GREEN',
  'SOLUCIONES INTEGRALES RESO SAS': 'RESO',
  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS': 'IASO',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS': 'IAS',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS ': 'IAS',
};
function getSigla(n) { return SIGLAS[(n||'').trim()] || n || '—'; }
var SIGLA_CLASSES = ['PARCELAR','GREEN','RESO','IASO','IAS'];
function getSiglaClass(n) { var s = getSigla(n); return SIGLA_CLASSES.indexOf(s) >= 0 ? 'sigla-'+s : 'sigla-DEFAULT'; }

// ── State ──
var consecs = [];
var pedidos = [];
var activeIdx = null;
var editIdx = null;
var editKey = null;
var editWorkingLines = [];
var detailWorkingLines = [];
// Snapshot de existencias para el modal de detalle (empresa origen del stock)
var existSnapshot = null;

// ── Load from API ──
async function loadFromAPI() {
  await _authReady;
  populateEmpresaSelect('nv-empresa');
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
    var data = await apiGet('getPedidos');
    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    var EXPECTED = ['Fecha_Procesamiento','Nombre_Empresa','Consecutivo','Fecha_Pedido',
      'Cliente','NIT','Telefono','Direccion_Envio','Municipio','Departamento',
      'Comercial','Plazo_Pago','Precio_Facturacion','Producto','Presentacion',
      'Cantidad','Valor_Unitario','Valor_Total','Total_Orden','Archivo_Fuente',
      'Estado','ID_Cliente','ID_Comercial','ID_Producto',
      'Cant_Entregada','Cant_Pendiente','Estado_Entrega','Fecha_Ult_Entrega','Remisiones','Observaciones','Estado_2','Bonificado'];

    if (data.headers && data.headers[0] !== 'Fecha_Procesamiento') {
      var oldHeaders = data.headers;
      var posMap = {};
      for (var pi = 0; pi < oldHeaders.length; pi++) {
        var hKey = String(oldHeaders[pi]);
        if (!(hKey in posMap)) posMap[hKey] = [];
        posMap[hKey].push(pi);
      }
      var fixedFirst = {};
      for (var hi = 0; hi < EXPECTED.length && hi < oldHeaders.length; hi++) {
        fixedFirst[EXPECTED[hi]] = oldHeaders[hi];
      }
      fixedFirst.__row = 1;
      var fixedPedidos = [fixedFirst];
      for (var ri = 0; ri < data.pedidos.length; ri++) {
        var oldRow = data.pedidos[ri];
        var vals = [];
        for (var vi = 0; vi < oldHeaders.length; vi++) vals.push(undefined);
        for (var hk in posMap) {
          if (!posMap.hasOwnProperty(hk)) continue;
          var positions = posMap[hk];
          var rawVal = oldRow[hk];
          if (positions.length === 1) {
            vals[positions[0]] = rawVal;
          } else {
            for (var pp = 0; pp < positions.length; pp++) {
              vals[positions[pp]] = rawVal;
            }
          }
        }
        var newRow = {};
        for (var ci = 0; ci < EXPECTED.length && ci < vals.length; ci++) {
          newRow[EXPECTED[ci]] = vals[ci] !== undefined ? vals[ci] : '';
        }
        newRow.__row = oldRow.__row || (ri + 2);
        fixedPedidos.push(newRow);
      }
      data.pedidos = fixedPedidos;
      data.headers = EXPECTED;
    }

    data.pedidos = data.pedidos.filter(function(p) {
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente';
    });

    pedidos = data.pedidos.map(function(p) {
      if (p.Consecutivo !== null && p.Consecutivo !== undefined) {
        var n = Number(p.Consecutivo);
        if (!isNaN(n)) p.Consecutivo = n;
      }
      if (!p.Cant_Entregada && p.Cant_Entregada !== 0) {
        p.Cant_Entregada = 0;
        p.Cant_Pendiente = Number(p.Cantidad) || 0;
        p.Estado_Entrega = 'Recibido';
        p.Fecha_Ult_Entrega = null;
        p.Remisiones = '';
      }
      if (!p.Estado_2) p.Estado_2 = 'Abierto';
      if (!p.Estado_Entrega || p.Estado_Entrega.trim() === '') p.Estado_Entrega = 'Recibido';
      var cantE = Number(p.Cant_Entregada) || 0;
      var cantP = Number(p.Cant_Pendiente) || 0;
      var cantQ = Number(p.Cantidad) || 0;
      if (cantQ === 0 && (cantE + cantP) > 0) {
        p.Cantidad = cantE + cantP;
      } else if (cantQ > 0 && cantQ < cantE) {
        p.Cantidad = cantE + cantP;
      }
      return p;
    });

    rebuildConsecs();
    populateFilters();
    renderTable();
    loadAdjuntosIndex();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + pedidos.length + ' líneas';
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

// ── Parse data ──
function rebuildConsecs() {
  var seen = {};
  pedidos.forEach(function(p) {
    var k = keyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente);
    if (!seen[k]) seen[k] = {
      Nombre_Empresa: p.Nombre_Empresa, Consecutivo: p.Consecutivo,
      Fecha_Pedido: p.Fecha_Pedido, Cliente: p.Cliente, NIT: p.NIT,
      Telefono: p.Telefono, Direccion_Envio: p.Direccion_Envio,
      Comercial: p.Comercial, Municipio: p.Municipio, Departamento: p.Departamento,
      Plazo_Pago: p.Plazo_Pago, Precio_Facturacion: p.Precio_Facturacion, Total_Orden: p.Total_Orden,
    };
  });
  consecs = Object.values(seen).sort(function(a, b) {
    var da = +new Date(a.Fecha_Pedido), db = +new Date(b.Fecha_Pedido);
    return db - da || (b.Consecutivo||0) - (a.Consecutivo||0);
  }).map(function(c, i) { c['N°'] = i + 1; return c; });
}

// ── Helpers ──
function keyOf(emp, con, cli) { return (emp||'') + '||' + String(con||'').trim() + '||' + (cli||''); }

function getLinesFor(c) {
  var k = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
  return pedidos.filter(function(p) { return keyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente) === k; });
}

function derivedStatus(lines) {
  if (!lines.length) return 'Recibido';
  var ent = lines.filter(function(l) { return norm(l.Estado_Entrega) === 'entregado'; }).length;
  var ali = lines.filter(function(l) { return norm(l.Estado_Entrega) === 'alistado'; }).length;
  var par = lines.filter(function(l) { return norm(l.Estado_Entrega) === 'parcial'; }).length;
  if (ent === lines.length) return 'Entregado';
  if ((ent + ali) === lines.length) return 'Alistado';
  if (ent > 0 || ali > 0 || par > 0) return 'Parcial';
  return 'Recibido';
}

function derivedEstado2(lines) {
  if (!lines.length) return 'Abierto';
  var vals = lines.map(function(l) { return (l.Estado_2 || 'Abierto').trim(); });
  if (vals.indexOf('Anulado') >= 0) return 'Anulado';
  if (vals.indexOf('Bloqueado por cartera') >= 0) return 'Bloqueado por cartera';
  var allCerrado = vals.every(function(v) { return v === 'Cerrado'; });
  if (allCerrado) return 'Cerrado';
  var allCerradoOrAlistado = vals.every(function(v) { return v === 'Cerrado' || v === 'Alistado'; });
  if (allCerradoOrAlistado) return 'Alistado';
  return 'Abierto';
}

function derivedPct(lines) {
  var totPed = lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
  var totEnt = lines.reduce(function(s, l) { return s + (Number(l.Cant_Entregada)||0); }, 0);
  return totPed > 0 ? Math.round(totEnt / totPed * 100) : 0;
}

// ── Filters ──
var filtersAttached = false;
function populateFilters() {
  var emps = []; var clis = []; var coms = [];
  consecs.forEach(function(c) {
    if (c.Nombre_Empresa && emps.indexOf(c.Nombre_Empresa) < 0) emps.push(c.Nombre_Empresa);
    if (c.Cliente && clis.indexOf(c.Cliente) < 0) clis.push(c.Cliente);
    var com = (c.Comercial || '').trim();
    if (com && coms.indexOf(com) < 0) coms.push(com);
  });
  emps.sort(); clis.sort(); coms.sort(function(a, b) { return a.localeCompare(b, 'es'); });
  var fe = document.getElementById('f-emp');
  var fc = document.getElementById('f-cli');
  var fcom = document.getElementById('f-com');
  var prevEmp = fe.value;
  var prevCli = fc.value;
  var prevCom = fcom ? fcom.value : '';
  fe.innerHTML = '<option value="">Todas</option>' + emps.map(function(e) { return '<option value="' + e + '">' + getSigla(e) + ' — ' + e + '</option>'; }).join('');
  document.getElementById('dl-f-cli').innerHTML = clis.map(function(c) { return '<option value="' + c + '">'; }).join('');
  if (fcom) fcom.innerHTML = '<option value="">Todos</option>' + coms.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  if (prevEmp) fe.value = prevEmp;
  if (prevCli) fc.value = prevCli;
  if (fcom && prevCom) fcom.value = prevCom;
  if (!filtersAttached) {
    function onFilterChange() { currentPage = 1; renderTable(); }
    ['f-emp','f-com','f-cli','f-est','f-est2','f-txt'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', onFilterChange);
      el.addEventListener('input', onFilterChange);
    });
    filtersAttached = true;
  }
}

function filtered() {
  var fe = document.getElementById('f-emp').value;
  var fcomEl = document.getElementById('f-com');
  var fcom = fcomEl ? fcomEl.value : '';
  var fc = document.getElementById('f-cli').value;
  var fs = document.getElementById('f-est').value;
  var fs2 = document.getElementById('f-est2').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();
  return consecs.filter(function(c) {
    if (fe && c.Nombre_Empresa !== fe) return false;
    if (fcom && (c.Comercial||'').trim() !== fcom) return false;
    if (fc && (c.Cliente||'').toLowerCase().indexOf(fc.toLowerCase()) < 0) return false;
    var lines = getLinesFor(c);
    var est = derivedStatus(lines);
    if (fs && norm(est) !== norm(fs)) return false;
    if (fs2) { var e2 = derivedEstado2(lines); if (e2 !== fs2) return false; }
    if (ft) {
      var hay = [c.Cliente, String(c.Consecutivo), getSigla(c.Nombre_Empresa), c.Comercial].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function clearFilters() {
  document.getElementById('f-emp').value = '';
  var fcomEl = document.getElementById('f-com');
  if (fcomEl) fcomEl.value = '';
  document.getElementById('f-cli').value = '';
  document.getElementById('f-est').value = '';
  document.getElementById('f-est2').value = '';
  document.getElementById('f-txt').value = '';
  currentPage = 1;
  renderTable();
}

// ── Pagination ──
var currentPage = 1;
var pageSize = 25;

function goToPage(p) {
  currentPage = p;
  renderTable();
  var card = document.querySelector('#panel-ordenes .card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changePageSize(val) {
  pageSize = Number(val) || 25;
  currentPage = 1;
  renderTable();
}

function renderPagination(totalRows) {
  var el = document.getElementById('pagination');
  if (!el) return;
  var totalPages = Math.ceil(totalRows / pageSize);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  var start = (currentPage - 1) * pageSize + 1;
  var end = Math.min(currentPage * pageSize, totalRows);
  var html = '<span class="pg-info">' + start + '–' + end + ' de ' + totalRows + '</span>';

  html += '<button ' + (currentPage <= 1 ? 'disabled' : 'onclick="goToPage(1)"') + ' title="Primera">«</button>';
  html += '<button ' + (currentPage <= 1 ? 'disabled' : 'onclick="goToPage(' + (currentPage - 1) + ')"') + ' title="Anterior">‹</button>';

  var range = [];
  if (totalPages <= 7) {
    for (var i = 1; i <= totalPages; i++) range.push(i);
  } else {
    range.push(1);
    if (currentPage > 3) range.push('...');
    for (var i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) range.push(i);
    if (currentPage < totalPages - 2) range.push('...');
    range.push(totalPages);
  }
  range.forEach(function(p) {
    if (p === '...') { html += '<span class="pg-ellipsis">…</span>'; return; }
    html += '<button class="' + (p === currentPage ? 'pg-active' : '') + '" onclick="goToPage(' + p + ')">' + p + '</button>';
  });

  html += '<button ' + (currentPage >= totalPages ? 'disabled' : 'onclick="goToPage(' + (currentPage + 1) + ')"') + ' title="Siguiente">›</button>';
  html += '<button ' + (currentPage >= totalPages ? 'disabled' : 'onclick="goToPage(' + totalPages + ')"') + ' title="Última">»</button>';

  html += '<select onchange="changePageSize(this.value)">';
  [25, 50, 100].forEach(function(n) {
    html += '<option value="' + n + '"' + (pageSize === n ? ' selected' : '') + '>' + n + ' / pág</option>';
  });
  html += '</select>';

  el.innerHTML = html;
}

// ── Render table ──
function renderTable() {
  var rows = applySort(filtered());
  var all = consecs.map(function(c) { return derivedStatus(getLinesFor(c)); });
  document.getElementById('s-rec').textContent = all.filter(function(e) { return e === 'Recibido'; }).length;
  document.getElementById('s-par').textContent = all.filter(function(e) { return e === 'Parcial'; }).length;
  document.getElementById('s-ent').textContent = all.filter(function(e) { return e === 'Entregado'; }).length;
  document.getElementById('s-tot').textContent = consecs.length;

  var totalRows = rows.length;
  var totalPages = Math.ceil(totalRows / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  document.getElementById('row-ct').textContent = '(' + totalRows + ' mostradas)';

  renderHeader();

  var tbody = document.getElementById('t-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="empty">No hay órdenes con los filtros seleccionados.</div></td></tr>';
    renderPagination(0);
    return;
  }

  var startIdx = (currentPage - 1) * pageSize;
  var pageRows = rows.slice(startIdx, startIdx + pageSize);

  tbody.innerHTML = pageRows.map(function(c) {
    var lines = getLinesFor(c);
    var est = derivedStatus(lines);
    var est2 = derivedEstado2(lines);
    var pct = derivedPct(lines);
    var badge = est === 'Recibido' ? 'b-rec' : est === 'Parcial' ? 'b-par' : est === 'Alistado' ? 'b-alistado' : 'b-ent';
    var badge2 = est2 === 'Abierto' ? 'b-abierto' : est2 === 'Alistado' ? 'b-alistado' : est2 === 'Cerrado' ? 'b-cerrado' : est2 === 'Bloqueado por cartera' ? 'b-bloqueado' : 'b-anulado';
    var done = est === 'Entregado' || est === 'Alistado';
    var idx = consecs.indexOf(c);
    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">' + (c['N°']||'') + '</td>' +
      '<td title="' + (c.Nombre_Empresa||'') + '"><span class="sigla-badge ' + getSiglaClass(c.Nombre_Empresa) + '">' + getSigla(c.Nombre_Empresa) + '</span></td>' +
      '<td style="text-align:center;font-weight:700">' + (c.Consecutivo||'') + '<span class="adjunto-badge-cell" data-adj-key="' + getSigla(c.Nombre_Empresa) + '_' + c.Consecutivo + '_' + sanitizeForPath(c.Cliente) + '"></span></td>' +
      '<td style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (c.Cliente||'') + '">' + (c.Cliente||'—') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(c.Fecha_Pedido) + '</td>' +
      '<td style="font-size:0.78rem">' + (c.Comercial||'—') + '</td>' +
      '<td class="money">' + fmtMoney(c.Total_Orden) + '</td>' +
      '<td style="text-align:center">' +
        (lines.length ? '<span style="background:#e8f4fb;color:#1a5276;padding:2px 9px;border-radius:12px;font-size:0.75rem;font-weight:700">' + lines.length + '</span>' : '<span class="tag-sin">—</span>') +
      '</td>' +
      '<td><div class="prog"><div class="prog-bar"><div class="prog-fill" style="width:' + pct + '%"></div></div><div class="prog-pct">' + pct + '%</div></div></td>' +
      '<td><span class="badge ' + badge + '">' + est + '</span></td>' +
      '<td><span class="badge ' + badge2 + '">' + est2 + '</span></td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        '<button class="btn-ver ' + (done?'done':'') + '" onclick="openDetail(' + idx + ')">' +
          (lines.length === 0 ? '👁 Ver' : done ? '✓ Entregado' : '📦 Ver pedido') +
        '</button>' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="openEdit(' + idx + ')" title="Editar pedido">✏️</button>' +
        '<button class="btn-del" onclick="openDelete(' + idx + ')" title="Eliminar pedido">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');

  renderPagination(totalRows);
  updateAdjuntosBadges();

  var detPanel = document.getElementById('panel-detalle');
  if (detPanel && detPanel.style.display !== 'none') renderDetalle();
}

// ── Detail Modal ──
async function openDetail(idx) {
  activeIdx = idx;
  var c = consecs[idx];
  var lines = getLinesFor(c);

  // Cargar snapshot de existencias para poblar los selectores de empresa origen.
  // No bloqueamos la apertura si falla; simplemente el selector queda vacío.
  try { existSnapshot = await Existencias.loadSnapshot(); }
  catch (e) { existSnapshot = null; console.warn('No se pudo cargar existencias:', e); }

  document.getElementById('m-titulo').textContent = '[' + getSigla(c.Nombre_Empresa) + '] ' + (c.Nombre_Empresa||'—') + ' · Orden #' + (c.Consecutivo||'');
  document.getElementById('md-cliente').value = c.Cliente || '';
  document.getElementById('md-nit').value = c.NIT || '';
  document.getElementById('md-fecha-pedido').value = toDateInput(c.Fecha_Pedido);
  document.getElementById('md-comercial').value = c.Comercial || '';
  document.getElementById('md-municipio').value = c.Municipio || '';
  document.getElementById('md-departamento').value = c.Departamento || '';
  document.getElementById('md-telefono').value = c.Telefono || '';
  document.getElementById('md-plazo').value = c.Plazo_Pago || '';
  document.getElementById('md-precio').value = c.Precio_Facturacion || '';
  document.getElementById('md-facturar-a').value = c.Facturar_A || c.Cliente || '';
  document.getElementById('md-nit-adicional').value = c.NIT_Adicional || '';
  document.getElementById('md-consignacion').value = c.Consignacion || 'No';
  document.getElementById('md-estado2').value = derivedEstado2(lines);
  document.getElementById('m-total').textContent = fmtMoney(c.Total_Orden);
  var obsText = c.Observaciones || lines.reduce(function(a, l) { return a || l.Observaciones; }, '') || '';
  document.getElementById('m-observaciones').value = obsText ? String(obsText).trim() : '';
  document.getElementById('m-fecha').value = today();
  document.getElementById('m-remision').value = '';
  document.getElementById('m-remision').classList.remove('error');
  document.getElementById('btn-confirmar').disabled = false;
  document.getElementById('btn-confirmar').textContent = '✓ Guardar cambios';

  detailWorkingLines = lines.map(function(l) {
    var copy = Object.assign({}, l);
    copy._entregas = parseEntregas(l.Remisiones, Number(l.Cant_Entregada) || 0, l.Fecha_Ult_Entrega);
    copy._asignaciones = []; // { empresa_stock, cantidad } — pendientes de guardar
    return copy;
  });

  var tbody = document.getElementById('m-lines');
  if (!lines.length) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="no-lines">⚠ Esta orden no tiene líneas de producto registradas.</div></td></tr>';
  } else {
    var orderHasDeliveries = lines.some(function(l) { return (Number(l.Cant_Entregada)||0) > 0; });
    tbody.innerHTML = detailWorkingLines.map(function(l, i) {
      var pedida = Number(l.Cantidad)||0;
      var entregada = Number(l.Cant_Entregada)||0;
      var pendiente = Math.max(0, pedida - entregada);
      var rawEst = (l.Estado_Entrega || '').trim();
      var estL = (!rawEst || norm(rawEst) === 'recibido') ? (orderHasDeliveries ? 'Parcial' : 'Recibido') : rawEst;
      var badgeL = norm(estL) === 'recibido' ? 'b-rec' : norm(estL) === 'parcial' ? 'b-par' : norm(estL) === 'alistado' ? 'b-alistado' : 'b-ent';
      var done = norm(estL) === 'entregado' || norm(estL) === 'alistado';
      var prodNombre = l.Producto || '';
      var textoTieneBonif = /bonificado/i.test(prodNombre);
      var prodLimpio = textoTieneBonif ? prodNombre.replace(/\s*bonificado\s*/gi, ' ').trim() : prodNombre;
      var vUnit = Number(l.Valor_Unitario) || 0;
      var bonif = (l.Bonificado || '').trim();
      var esBonif = bonif === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
      var prodEsc = prodLimpio.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      var presEsc = (l.Presentacion||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      return '<tr>' +
        '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
        '<td><input class="ef md-prod" data-i="' + i + '" type="text" value="' + prodEsc + '" style="min-width:260px;font-weight:700"></td>' +
        '<td><input class="ef md-pres" data-i="' + i + '" type="text" value="' + presEsc + '" style="width:90px"></td>' +
        '<td style="text-align:center">' + (esBonif ? '<span style="background:#d5f5e3;color:#1e8449;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:700">Sí</span>' : '<span style="color:#718096;font-size:0.75rem">No</span>') + '</td>' +
        '<td><input class="ef md-cant" data-i="' + i + '" type="number" min="0" value="' + pedida + '" style="width:70px;text-align:right" oninput="updateDetailLine(' + i + ')"></td>' +
        '<td><input class="ef md-ent" data-i="' + i + '" type="number" value="' + entregada + '" style="width:70px;text-align:right;color:#27ae60;font-weight:700;background:#f0fff4" readonly tabindex="-1"></td>' +
        '<td class="money"><span class="pend-tag ' + (pendiente > 0 ? 'pend' : 'ok') + '" id="md-pend-' + i + '">' + pendiente + '</span></td>' +
        '<td style="min-width:280px"><span class="badge ' + badgeL + '">' + estL + '</span>' +
          '<div class="entregas-wrap" data-i="' + i + '">' + renderEntregasHTML(i, l._entregas || []) + '</div>' +
        '</td>' +
        '<td><input class="ef md-vuni" data-i="' + i + '" type="number" min="0" value="' + vUnit + '" style="width:90px;text-align:right" oninput="updateDetailLine(' + i + ')"></td>' +
        '<td class="money" style="font-size:0.78rem" id="md-vtot-' + i + '">' + fmtMoney(l.Valor_Total) + '</td>' +
        '<td data-row="' + l.__row + '" data-idx="' + i + '" style="min-width:220px">' + renderAsignacionCell(i, l, c.Nombre_Empresa) + '</td>' +
      '</tr>';
    }).join('');
  }

  resetNewLineForm();
  document.getElementById('overlay').classList.add('show');
  destroyGeoAC('md');
  geoACs.md = setupGeoAutocomplete(
    document.getElementById('md-departamento'),
    document.getElementById('md-municipio')
  );
  loadAdjuntos(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
}

function closeModal() {
  document.getElementById('overlay').classList.remove('show');
  activeIdx = null;
  destroyGeoAC('md');
  if (typeof closeRemPicker === 'function') closeRemPicker();
}

document.getElementById('overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeModal(); });

// ── Detail line helpers ──
function updateDetailLine(i) {
  var cants = document.querySelectorAll('.md-cant');
  var vunis = document.querySelectorAll('.md-vuni');
  var ents = document.querySelectorAll('.md-ent');
  var cant = parseFloat(cants[i] && cants[i].value) || 0;
  var vuni = parseFloat(vunis[i] && vunis[i].value) || 0;
  var entregada = parseFloat(ents[i] && ents[i].value) || 0;
  if (ents[i]) {
    ents[i].max = cant;
    if (entregada > cant) {
      entregada = cant;
      ents[i].value = cant;
      ents[i].classList.add('error');
      showToast('La cantidad entregada no puede superar la pedida (' + cant + ')', '#e74c3c');
    } else {
      ents[i].classList.remove('error');
    }
  }
  var vtot = cant * vuni;
  var vtotEl = document.getElementById('md-vtot-' + i);
  if (vtotEl) vtotEl.textContent = fmtMoney(vtot);
  if (detailWorkingLines[i]) {
    detailWorkingLines[i].Cantidad = cant;
    detailWorkingLines[i].Valor_Unitario = vuni;
    detailWorkingLines[i].Valor_Total = vtot;
    detailWorkingLines[i].Cant_Entregada = entregada;
  }
  var pendiente = Math.max(0, cant - entregada);
  var pendEl = document.getElementById('md-pend-' + i);
  if (pendEl) {
    pendEl.textContent = pendiente;
    pendEl.className = 'pend-tag ' + (pendiente > 0 ? 'pend' : 'ok');
  }
  // Re-render de la celda de asignación: si el pendiente pasó a 0
  // se oculta el selector; si aumentó, vuelve a aparecer.
  if (typeof refreshAsignacionCell === 'function') refreshAsignacionCell(i);
  updateDetailTotal();
}

function updateDeliveryMax(i) {
  var qtyInput = document.querySelectorAll('.qty-input')[i];
  if (!qtyInput || !detailWorkingLines[i]) return;
  var cants = document.querySelectorAll('.md-cant');
  var ents = document.querySelectorAll('.md-ent');
  var cant = parseFloat(cants[i] && cants[i].value) || 0;
  var entregada = parseFloat(ents[i] && ents[i].value) || 0;
  var pendiente = Math.max(0, cant - entregada);
  var val = Number(qtyInput.value) || 0;
  if (val > pendiente) {
    qtyInput.value = pendiente;
    qtyInput.classList.add('error');
  } else {
    qtyInput.classList.remove('error');
  }
}

function updateDetailTotal() {
  var total = detailWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0);
  document.getElementById('m-total').textContent = fmtMoney(total);
}

function parseEntregas(remStr, cantTotal, fechaUlt) {
  if (!remStr || !remStr.trim()) {
    if (cantTotal > 0) return [{ remision: '', cantidad: cantTotal, fecha: fechaUlt ? toDateInput(fechaUlt) : '' }];
    return [];
  }
  var parts = remStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var hasStructured = parts.some(function(p) { return p.indexOf('|') >= 0; });
  if (hasStructured) {
    var fallbackFecha = fechaUlt ? toDateInput(fechaUlt) : '';
    return parts.map(function(p) {
      var segs = p.split('|');
      return { remision: segs[0] || '', cantidad: Number(segs[1]) || 0, fecha: segs[2] || fallbackFecha };
    });
  }
  if (cantTotal > 0) {
    return [{ remision: remStr, cantidad: cantTotal, fecha: fechaUlt ? toDateInput(fechaUlt) : '' }];
  }
  return [];
}

function formatEntregas(entries) {
  var valid = entries.filter(function(e) { return (e.cantidad > 0) || e.remision; });
  if (!valid.length) return '';
  return valid.map(function(e) {
    return (e.remision || '') + '|' + (e.cantidad || 0) + '|' + (e.fecha || '');
  }).join(',');
}

function renderEntregasHTML(lineIdx, entregas) {
  if (!entregas.length) return '';
  var html = '';
  html += entregas.map(function(e, ei) {
    var fechaFmt = e.fecha ? formatDateShort(e.fecha) : '';
    var remTxt = e.remision || '';
    var cantTxt = e.cantidad || 0;
    var parts = [];
    if (cantTxt) parts.push('<strong>' + cantTxt + '</strong> ud');
    if (remTxt) parts.push('Rem: ' + remTxt.replace(/</g,'&lt;'));
    if (fechaFmt) parts.push(fechaFmt);
    return '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;font-size:0.7rem;color:#4a5568;background:#f7fafc;padding:2px 6px;border-radius:4px;border:1px solid #e2e8f0">' +
      '<span style="flex:1">' + parts.join(' · ') + '</span>' +
      '<button onclick="removeEntrega(' + lineIdx + ',' + ei + ')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:0.72rem;padding:0 2px;line-height:1" title="Eliminar entrega">✕</button>' +
    '</div>';
  }).join('');
  return html;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return dateStr;
}

function renderEntregasUI(lineIdx) {
  var wrap = document.querySelector('.entregas-wrap[data-i="' + lineIdx + '"]');
  if (!wrap) return;
  wrap.innerHTML = renderEntregasHTML(lineIdx, detailWorkingLines[lineIdx]._entregas || []);
}

// ── Asignación de existencias a la entrega ────────────────
// Renderiza la celda que reemplaza al viejo qty-input libre.
// Muestra un selector de empresa origen (con las existencias
// disponibles para el producto/presentación de la línea) + input
// cantidad + botón añadir, y una lista de chips con las
// asignaciones ya cargadas (aún no persistidas).
function renderAsignacionCell(i, l, empresaPedido) {
  // Si la línea no tiene pendiente (Cant_Entregada ≥ Cantidad) no se
  // permite asignar más stock. Se muestra un aviso en lugar del
  // selector. Se sigue reservando un contenedor de chips vacío para
  // que refreshAsignacionCell/renderAsignacionChips no fallen.
  var pedida = Number(l.Cantidad) || 0;
  var yaEntregada = Number(l.Cant_Entregada) || 0;
  var pendienteBase = Math.max(0, pedida - yaEntregada);
  if (pendienteBase <= 0) {
    return '<div style="font-size:0.72rem;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;padding:4px 8px;border-radius:4px;font-weight:700">' +
             '✓ Línea entregada — sin pendiente por asignar' +
           '</div>' +
           '<div class="asig-chips" data-i="' + i + '" style="margin-top:4px"></div>';
  }

  var opciones = '';
  if (existSnapshot && typeof Existencias !== 'undefined') {
    var lista = Existencias.getPorEmpresa(existSnapshot, l.Producto, l.Presentacion);
    // Ordenar: primero la empresa del pedido si tiene stock
    lista.sort(function(a, b) {
      var aEsPedido = norm(a.empresa) === norm(empresaPedido) ? 0 : 1;
      var bEsPedido = norm(b.empresa) === norm(empresaPedido) ? 0 : 1;
      if (aEsPedido !== bEsPedido) return aEsPedido - bEsPedido;
      return a.sigla.localeCompare(b.sigla, 'es');
    });
    opciones = lista.map(function(x) {
      var marca = norm(x.empresa) === norm(empresaPedido) ? ' ★' : '';
      var dispRaw = Math.round(x.disponible * 100) / 100;
      // Ajuste por sesión: restar lo ya asignado a esa (empresa,
      // producto) en TODAS las líneas del pedido, para que dos líneas
      // del mismo producto no puedan sobregirar el mismo pool.
      var yaSesion = _asignadoEnSesion(x.empresa, l.Producto);
      var dispRest = Math.max(0, dispRaw - yaSesion);
      var etiqueta = (yaSesion > 0)
        ? x.sigla + marca + ' · ' + dispRest + ' disp. (base ' + dispRaw + ')'
        : x.sigla + marca + ' · ' + dispRest + ' disp.';
      return '<option value="' + x.empresa.replace(/"/g,'&quot;') + '" data-disp="' + dispRaw + '">' +
        etiqueta + '</option>';
    }).join('');
  }
  var selectHTML = opciones
    ? '<select class="asig-empresa" data-i="' + i + '" onchange="onAsignEmpresaChange(' + i + ')" style="width:100%;font-size:0.75rem;padding:2px 4px">' +
        '<option value="">— Empresa origen —</option>' + opciones +
      '</select>'
    : '<div style="font-size:0.72rem;color:#a94442;background:#fdecea;border:1px solid #f5c2c0;padding:2px 6px;border-radius:4px">Sin stock disponible</div>';
  return selectHTML +
    '<div style="display:flex;gap:4px;margin-top:3px">' +
      '<input type="number" class="asig-cant" data-i="' + i + '" min="0" step="1" placeholder="0" style="width:60px;font-size:0.75rem;padding:2px 4px;text-align:right" oninput="validateAsignCant(' + i + ')">' +
      '<button type="button" onclick="addAsignacion(' + i + ')" ' +
        'style="background:#3498db;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:0.75rem;font-weight:700;cursor:pointer">+ Añadir</button>' +
    '</div>' +
    '<div class="asig-chips" data-i="' + i + '" style="margin-top:4px"></div>';
}

// Re-renderiza la celda de asignación (por ejemplo cuando cambia la
// cantidad pedida y ahora hay o deja de haber pendiente). Preserva
// las asignaciones ya cargadas en memoria (dl._asignaciones).
function refreshAsignacionCell(i) {
  if (activeIdx == null) return;
  var td = document.querySelector('#m-lines td[data-idx="' + i + '"]');
  if (!td) return;
  var c = consecs[activeIdx];
  var l = detailWorkingLines[i];
  if (!c || !l) return;
  td.innerHTML = renderAsignacionCell(i, l, c.Nombre_Empresa);
  renderAsignacionChips(i);
}

// Máximo asignable ahora mismo para la línea i:
// mínimo entre lo pendiente por entregar y lo disponible libre
// en la empresa seleccionada. Devuelve null si aún no hay empresa
// seleccionada (no se puede acotar el tope).
function _maxAsignable(i) {
  var sel = document.querySelector('.asig-empresa[data-i="' + i + '"]');
  if (!sel || !sel.value) return null;
  var dl = detailWorkingLines[i];
  if (!dl) return null;
  var disp = Number(sel.selectedOptions[0] && sel.selectedOptions[0].dataset.disp) || 0;
  var pendiente = _pendienteRestante(i);
  var yaEnSesion = _asignadoEnSesion(sel.value, dl.Producto, i);
  var libre = Math.max(0, disp - yaEnSesion);
  return Math.min(pendiente, libre);
}

function onAsignEmpresaChange(i) {
  // Ajusta el placeholder + revalida el input actual al cambiar la empresa.
  var inp = document.querySelector('.asig-cant[data-i="' + i + '"]');
  if (!inp) return;
  var tope = _maxAsignable(i);
  if (tope == null) {
    inp.removeAttribute('max');
    inp.placeholder = '0';
    inp.classList.remove('error');
    inp.title = '';
    return;
  }
  inp.max = tope;
  inp.placeholder = 'máx ' + tope;
  validateAsignCant(i);
}

// Validación en vivo mientras el usuario tipea la cantidad.
// Estrategia:
//   • Sin empresa seleccionada → borde rojo + tooltip explicativo,
//     no se puede clampear porque no conocemos el tope.
//   • Con empresa seleccionada → si el valor supera el tope
//     (min pendiente, disponible libre), se recorta al tope al
//     instante y se avisa mediante un tooltip persistente.
function validateAsignCant(i, _skipPropagate) {
  var inp = document.querySelector('.asig-cant[data-i="' + i + '"]');
  var sel = document.querySelector('.asig-empresa[data-i="' + i + '"]');
  if (!inp) return;
  var cant = Number(inp.value) || 0;
  if (cant <= 0) {
    inp.classList.remove('error');
    inp.title = '';
    if (!_skipPropagate) _propagateValidationSameProducto(i);
    return;
  }
  if (!sel || !sel.value) {
    inp.classList.add('error');
    inp.title = 'Selecciona primero la empresa origen';
    if (!_skipPropagate) _propagateValidationSameProducto(i);
    return;
  }
  var dl = detailWorkingLines[i];
  var pendiente = _pendienteRestante(i);
  var disp = Number(sel.selectedOptions[0] && sel.selectedOptions[0].dataset.disp) || 0;
  var yaEnSesion = dl ? _asignadoEnSesion(sel.value, dl.Producto, i) : 0;
  var libre = Math.max(0, disp - yaEnSesion);
  var tope = Math.min(pendiente, libre);

  if (cant > tope) {
    // Auto-clamp: no dejamos que el input tenga valores fuera de rango.
    inp.value = tope;
    inp.max = tope;
    var motivo = (tope === pendiente && pendiente <= libre)
      ? 'Ajustado al pendiente por entregar (' + pendiente + ')'
      : 'Ajustado al disponible en esa empresa (' + libre + ')';
    inp.title = motivo;
    // Marcamos el borde rojo brevemente como feedback visual del recorte,
    // luego lo quitamos para no confundir con un error persistente.
    inp.classList.add('error');
    clearTimeout(inp._clampTimer);
    inp._clampTimer = setTimeout(function() { inp.classList.remove('error'); }, 900);
    if (!_skipPropagate) _propagateValidationSameProducto(i);
    return;
  }
  inp.classList.remove('error');
  inp.title = '';
  if (!_skipPropagate) _propagateValidationSameProducto(i);
}

// Al cambiar el valor tipeado en la línea i, revalidamos las líneas
// hermanas que comparten producto: si el usuario tipea 100 en la
// línea A del mismo pool, la línea B del mismo producto tiene que
// recortarse al pool restante. Se marca con _skipPropagate=true para
// evitar recursión infinita.
function _propagateValidationSameProducto(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return;
  var prodN = _normProdSel(dl.Producto);
  (detailWorkingLines || []).forEach(function(other, j) {
    if (j === i || !other) return;
    if (_normProdSel(other.Producto) !== prodN) return;
    validateAsignCant(j, true);
  });
}

function _pendienteRestante(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return 0;
  var pedida = Number(dl.Cantidad) || 0;
  var yaEntregada = (dl._entregas || []).reduce(function(s, e) { return s + (e.cantidad || 0); }, 0);
  var yaAsignada = (dl._asignaciones || []).reduce(function(s, a) { return s + (a.cantidad || 0); }, 0);
  return Math.max(0, pedida - yaEntregada - yaAsignada);
}

// Normalización de producto compatible con Existencias._normProd
// (whitespace-collapse + trim, sin cambiar mayúsculas). Debe coincidir
// para que el "disponible por empresa/producto" del snapshot y las
// sumas de esta sesión hablen del mismo producto.
function _normProdSel(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// Suma en TODA la sesión (todas las líneas del pedido) las cantidades
// dirigidas a esa (empresa_stock, producto). Incluye:
//   • chips ya confirmados en cualquier línea (dl._asignaciones);
//   • valores tipeados aún sin confirmar en las OTRAS líneas
//     (input .asig-cant) — así, tan pronto como el usuario tipea 100
//     en la línea A, la línea B ya ve el pool restante recalculado
//     sin necesidad de que la línea A haga clic en "+ Añadir".
// excludeLineIdx: índice de la línea que se está validando (se
//   excluye del "typed" para no contarse a sí misma).
function _asignadoEnSesion(empresa, producto, excludeLineIdx) {
  var empN = norm(empresa);
  var prodN = _normProdSel(producto);
  var total = 0;
  (detailWorkingLines || []).forEach(function(dl, j) {
    if (!dl) return;
    if (_normProdSel(dl.Producto) !== prodN) return;
    // Chips confirmados (cuentan siempre, también en la propia línea
    // porque validamos una asignación NUEVA sobre el resto).
    if (dl._asignaciones) {
      dl._asignaciones.forEach(function(a) {
        if (norm(a.empresa_stock) === empN) total += (Number(a.cantidad) || 0);
      });
    }
    // Valor tipeado en otras líneas (aún sin +Añadir) — se cuenta
    // sólo si la empresa seleccionada en esa otra línea coincide.
    if (j !== excludeLineIdx) {
      var sel = document.querySelector('.asig-empresa[data-i="' + j + '"]');
      var inp = document.querySelector('.asig-cant[data-i="' + j + '"]');
      if (sel && inp && norm(sel.value) === empN) {
        var v = Number(inp.value) || 0;
        if (v > 0) total += v;
      }
    }
  });
  return total;
}

function addAsignacion(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return;
  var sel = document.querySelector('.asig-empresa[data-i="' + i + '"]');
  var inp = document.querySelector('.asig-cant[data-i="' + i + '"]');
  if (!sel || !inp) return;
  var empresa = sel.value;
  var cant = Number(inp.value) || 0;
  if (!empresa) { showToast('Selecciona la empresa origen', '#e67e22'); return; }
  if (cant <= 0) { showToast('Ingresa una cantidad mayor a 0', '#e67e22'); return; }

  // Reutiliza la validación en vivo. Si quedó en error, mostramos
  // el motivo (guardado en title) y bloqueamos.
  validateAsignCant(i);
  if (inp.classList.contains('error')) {
    showToast(inp.title || 'Cantidad inválida', '#e74c3c');
    return;
  }

  dl._asignaciones.push({ empresa_stock: empresa, cantidad: cant });
  inp.value = '';
  sel.selectedIndex = 0;
  inp.removeAttribute('max');
  inp.placeholder = '0';
  inp.classList.remove('error');
  inp.title = '';
  renderAsignacionChips(i);
  // Actualizar el "disp." mostrado en las líneas hermanas que
  // comparten producto (misma normalización), para que reflejen el
  // nuevo pool restante de esa empresa.
  _refreshSameProductoCells(i);
}

function removeAsignacion(i, k) {
  var dl = detailWorkingLines[i];
  if (!dl || !dl._asignaciones) return;
  dl._asignaciones.splice(k, 1);
  renderAsignacionChips(i);
  _refreshSameProductoCells(i);
}

// Re-renderiza las celdas de asignación de todas las líneas que
// comparten producto con la línea i (excepto la propia). Necesario
// tras agregar/quitar una asignación para que la etiqueta "disp."
// del dropdown refleje el pool disponible en esta sesión.
function _refreshSameProductoCells(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return;
  var prodN = _normProdSel(dl.Producto);
  (detailWorkingLines || []).forEach(function(other, j) {
    if (j === i) return;
    if (!other) return;
    if (_normProdSel(other.Producto) !== prodN) return;
    if (typeof refreshAsignacionCell === 'function') refreshAsignacionCell(j);
  });
}

function renderAsignacionChips(i) {
  var wrap = document.querySelector('.asig-chips[data-i="' + i + '"]');
  if (!wrap) return;
  var dl = detailWorkingLines[i];
  var arr = (dl && dl._asignaciones) || [];
  if (!arr.length) { wrap.innerHTML = ''; return; }
  var c = consecs[activeIdx];
  var empPedido = c ? norm(c.Nombre_Empresa) : '';
  wrap.innerHTML = arr.map(function(a, k) {
    var sigla = getSigla(a.empresa_stock);
    var traslado = norm(a.empresa_stock) !== empPedido;
    var tag = traslado
      ? '<span title="Se generará OC de traslado" style="color:#c0392b;font-weight:700">↗ traslado</span>'
      : '<span style="color:#27ae60;font-weight:700">✓ mismo origen</span>';
    return '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;font-size:0.7rem;background:#eef5ff;padding:2px 6px;border-radius:4px;border:1px solid #cfe1ff">' +
      '<span style="flex:1"><strong>' + a.cantidad + '</strong> ud · ' + sigla + ' · ' + tag + '</span>' +
      '<button type="button" onclick="removeAsignacion(' + i + ',' + k + ')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:0.72rem;padding:0 2px" title="Quitar asignación">✕</button>' +
    '</div>';
  }).join('');
}

function syncEntregaTotal(lineIdx) {
  var entregas = detailWorkingLines[lineIdx]._entregas || [];
  var total = entregas.reduce(function(s, e) { return s + (e.cantidad || 0); }, 0);
  var entInput = document.querySelector('.md-ent[data-i="' + lineIdx + '"]');
  if (entInput) entInput.value = total;
  detailWorkingLines[lineIdx].Cant_Entregada = total;
  updateDetailLine(lineIdx);
}

function removeEntrega(lineIdx, entIdx) {
  if (!detailWorkingLines[lineIdx] || !detailWorkingLines[lineIdx]._entregas) return;
  detailWorkingLines[lineIdx]._entregas.splice(entIdx, 1);
  renderEntregasUI(lineIdx);
  syncEntregaTotal(lineIdx);
}

// ── Save all changes (edits + deliveries) ──
async function guardarTodo() {
  if (activeIdx === null) return;
  var c = consecs[activeIdx];

  var prods = [].slice.call(document.querySelectorAll('.md-prod'));
  var press = [].slice.call(document.querySelectorAll('.md-pres'));
  var cants = [].slice.call(document.querySelectorAll('.md-cant'));
  var vunis = [].slice.call(document.querySelectorAll('.md-vuni'));
  detailWorkingLines.forEach(function(l, i) {
    l.Producto = prods[i] ? prods[i].value.trim() : l.Producto;
    l.Presentacion = press[i] ? press[i].value.trim() : l.Presentacion;
    l.Cantidad = Number(cants[i] && cants[i].value) || 0;
    l.Valor_Unitario = Number(vunis[i] && vunis[i].value) || 0;
    l.Valor_Total = l.Cantidad * l.Valor_Unitario;
  });

  var fecha = document.getElementById('m-fecha').value;
  var rem = document.getElementById('m-remision').value.trim();

  // Recolectar asignaciones pendientes de todas las líneas.
  // Cada entrada = { row, _idx, cantidad, empresa_stock, remision, fecha }.
  var entregas = [];
  detailWorkingLines.forEach(function(dl, i) {
    var asigs = (dl && dl._asignaciones) || [];
    asigs.forEach(function(a) {
      var cant = Number(a.cantidad) || 0;
      if (cant <= 0) return;
      entregas.push({
        row: dl.__row,
        _idx: i,
        cantidad: cant,
        empresa_stock: a.empresa_stock,
        remision: rem,
        fecha: fecha
      });
    });
  });

  if (entregas.length > 0 && !rem) {
    document.getElementById('m-remision').classList.add('error');
    showToast('El N° de remisión es obligatorio para descontar stock', '#e74c3c');
    return;
  }
  if (entregas.length > 0 && !fecha) {
    showToast('Selecciona la fecha de entrega', '#e74c3c');
    return;
  }

  // Volcar las asignaciones al buffer _entregas para que el resto
  // del flujo actual (Cant_Entregada, Remisiones, Estado_Entrega,
  // PDF de remisión) siga funcionando sin cambios.
  entregas.forEach(function(ent) {
    var dl = detailWorkingLines[ent._idx];
    if (!dl) return;
    if (!dl._entregas) dl._entregas = [];
    dl._entregas.push({
      remision: ent.remision,
      cantidad: ent.cantidad,
      fecha: ent.fecha,
      empresa_stock: ent.empresa_stock
    });
  });

  var entregadaExcedida = false;
  detailWorkingLines.forEach(function(l) {
    var entries = l._entregas || [];
    l.Cant_Entregada = entries.reduce(function(s, e) { return s + (e.cantidad || 0); }, 0);
    l.Remisiones = formatEntregas(entries);
    var maxDate = '';
    entries.forEach(function(e) { if (e.fecha && e.fecha > maxDate) maxDate = e.fecha; });
    if (maxDate) l.Fecha_Ult_Entrega = maxDate;
    l.Cant_Pendiente = Math.max(0, (Number(l.Cantidad) || 0) - l.Cant_Entregada);
    if (l.Cant_Entregada > l.Cantidad) entregadaExcedida = true;
  });
  if (entregadaExcedida) { showToast('La cantidad total de entregas supera la pedida', '#e74c3c'); return; }

  if (rem && entregas.length === 0) {
    detailWorkingLines.forEach(function(l) {
      if ((Number(l.Cant_Entregada) || 0) > 0 && (l._entregas || []).some(function(e) { return !(e.remision || '').trim(); })) {
        l._entregas.forEach(function(e) {
          if (!(e.remision || '').trim()) e.remision = rem;
        });
        l.Remisiones = formatEntregas(l._entregas);
      }
    });
  }

  var anyDelivery = detailWorkingLines.some(function(l) { return (Number(l.Cant_Entregada)||0) > 0; });
  detailWorkingLines.forEach(function(l) {
    var pedida = Number(l.Cantidad) || 0;
    var entregada = Number(l.Cant_Entregada) || 0;
    if (pedida > 0 && entregada >= pedida) {
      var todasRemision = (l._entregas || []).length > 0 && (l._entregas || []).every(function(e) { return (e.remision || '').trim() !== ''; });
      l.Estado_Entrega = todasRemision ? 'Entregado' : 'Alistado';
    } else if (entregada > 0) {
      l.Estado_Entrega = 'Parcial';
    } else if (anyDelivery) {
      l.Estado_Entrega = 'Parcial';
    } else {
      l.Estado_Entrega = 'Recibido';
    }
  });

  var hdr = {
    Cliente: document.getElementById('md-cliente').value.trim(),
    NIT: document.getElementById('md-nit').value.trim(),
    Fecha_Pedido: document.getElementById('md-fecha-pedido').value || null,
    Comercial: document.getElementById('md-comercial').value.trim(),
    Municipio: document.getElementById('md-municipio').value.trim(),
    Departamento: document.getElementById('md-departamento').value.trim(),
    Telefono: document.getElementById('md-telefono').value.trim(),
    Plazo_Pago: document.getElementById('md-plazo').value.trim(),
    Precio_Facturacion: document.getElementById('md-precio').value.trim(),
    Facturar_A: document.getElementById('md-facturar-a').value.trim(),
    NIT_Adicional: document.getElementById('md-nit-adicional').value.trim(),
    Consignacion: document.getElementById('md-consignacion').value,
    Total_Orden: detailWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0),
    Estado_2: document.getElementById('md-estado2').value,
    Nombre_Empresa: c.Nombre_Empresa,
    Consecutivo: c.Consecutivo
  };

  var btn = document.getElementById('btn-confirmar');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var obs = document.getElementById('m-observaciones').value.trim();
    var editResult = await apiPost({
      action: 'editarPedido',
      header: hdr,
      lineas: detailWorkingLines.map(function(l) { var c = Object.assign({}, l); delete c._entregas; return c; }),
      deleteRows: []
    });
    if (!editResult.ok) throw new Error(editResult.error || 'Error al guardar edición');

    for (var di = 0; di < detailWorkingLines.length; di++) {
      var dl = detailWorkingLines[di];
      if (dl.__row) {
        var upd = {};
        if (dl.Estado_Entrega) upd.Estado_Entrega = dl.Estado_Entrega;
        if (dl.Fecha_Ult_Entrega) upd.Fecha_Ult_Entrega = dl.Fecha_Ult_Entrega;
        upd.Remisiones = dl.Remisiones || null;
        upd.Cant_Entregada = dl.Cant_Entregada || 0;
        upd.Cant_Pendiente = dl.Cant_Pendiente || 0;
        if (obs) upd.Observaciones = obs;
        if (Object.keys(upd).length > 0) {
          upd.modificado_por = _uid();
          await _sb.from('Pedidos').update(upd).eq('id', dl.__row);
        }
      }
    }

    // Registrar EntregasPedido + OCs de traslado auto para las
    // asignaciones nuevas de esta sesión (las que estaban en
    // _asignaciones antes de volcarlas a _entregas).
    if (entregas.length > 0) {
      await persistirEntregasYTraslados(entregas, c, rem, fecha, obs);
    }

    if (entregas.length > 0 && rem) {
      var entregasPDF = entregas.map(function(ent) {
        var dl = detailWorkingLines[ent._idx];
        var vUni = dl ? (Number(dl.Valor_Unitario) || 0) : 0;
        return {
          producto: dl ? dl.Producto : '',
          presentacion: dl ? dl.Presentacion : '',
          cantidad: ent.cantidad,
          valor_unitario: vUni,
          valor_total: ent.cantidad * vUni,
          bonificado: dl ? (dl.Bonificado || '') : ''
        };
      });
      var totalEntrega = entregasPDF.reduce(function(s, e) { return s + (e.valor_total || 0); }, 0);
      generarRemisionPDF({
        empresa: c.Nombre_Empresa,
        consecutivo: c.Consecutivo,
        fecha_pedido: hdr.Fecha_Pedido,
        cliente: hdr.Cliente,
        nit: hdr.NIT,
        comercial: hdr.Comercial,
        municipio: hdr.Municipio,
        departamento: hdr.Departamento,
        telefono: hdr.Telefono,
        direccion: c.Direccion_Envio || '',
        plazo: hdr.Plazo_Pago,
        precio: hdr.Precio_Facturacion,
        consignacion: hdr.Consignacion,
        facturar_a: hdr.Facturar_A,
        nit_adicional: hdr.NIT_Adicional,
        observaciones: obs,
        remision: rem,
        fecha_entrega: fecha,
        entregas: entregasPDF,
        total: totalEntrega
      });
    }

    closeModal();
    var msg = entregas.length > 0
      ? '✅ Cambios guardados + ' + entregas.length + ' entrega(s) registrada(s)'
      : '✅ Cambios guardados en la nube';
    showToast(msg);
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Guardar cambios';
  }
}

// ── Persistencia de entregas + OC de traslado automáticas ──
// Para cada asignación:
//   • Si empresa_stock === empresa del pedido: sólo se inserta la
//     fila en EntregasPedido; el descuento del stock lo hace el
//     módulo Inventario al considerar EntregasPedido.
//   • Si empresa_stock !== empresa del pedido: primero se crea una
//     OC con Tipo='Traslado' desde empresa_stock hacia la empresa
//     del pedido (con la misma Remision), y luego se inserta la
//     EntregasPedido enlazada por orden_compra_id. La OC dispara
//     el movimiento bilateral (resta a origen, suma a destino) y
//     la EntregasPedido descuenta el destino → neto: origen pierde,
//     destino queda igual, y el pedido queda con Cant_Entregada.
async function persistirEntregasYTraslados(entregas, c, rem, fecha, obs) {
  var uid = _uid();
  var stamp = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var ymd = stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate());
  var hms = pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds());
  var counter = 0;

  for (var e = 0; e < entregas.length; e++) {
    var ent = entregas[e];
    var dl = detailWorkingLines[ent._idx] || {};
    var esTraslado = norm(ent.empresa_stock) !== norm(c.Nombre_Empresa);
    var ocId = null;

    if (esTraslado) {
      counter += 1;
      var consecTras = 'T-' + ymd + '-' + hms + (counter > 1 ? '-' + counter : '');
      var ocRow = {
        Fecha: fecha || ymd,
        Empresa_Destino: c.Nombre_Empresa,
        Empresa_Origen: ent.empresa_stock,
        Consecutivo: consecTras,
        Tipo: 'Traslado',
        Ref_Pedido: c.Nombre_Empresa + ' #' + c.Consecutivo,
        Producto: dl.Producto || '',
        Presentacion: dl.Presentacion || '',
        Cantidad: ent.cantidad,
        Valor_Unitario: 0,
        Valor_Total: 0,
        Total_Orden: 0,
        Estado: 'Cerrada',
        Remision: rem,
        Bodega: 'Productos Buenos',
        Observaciones: 'Traslado automático por entrega de pedido ' +
          c.Nombre_Empresa + ' #' + c.Consecutivo,
        creado_por: uid
      };
      var ocRes = await _sb.from('OrdenesCompra').insert(ocRow).select('id').single();
      if (ocRes.error) throw new Error('OC traslado: ' + ocRes.error.message);
      ocId = ocRes.data && ocRes.data.id;
    }

    var epRow = {
      pedido_id: ent.row,
      empresa_pedido: c.Nombre_Empresa,
      empresa_stock: ent.empresa_stock,
      producto: dl.Producto || '',
      presentacion: dl.Presentacion || '',
      cantidad: ent.cantidad,
      remision: rem,
      fecha: fecha || null,
      orden_compra_id: ocId,
      observaciones: obs || '',
      creado_por: uid
    };
    var epRes = await _sb.from('EntregasPedido').insert(epRow);
    if (epRes.error) throw new Error('EntregasPedido: ' + epRes.error.message);
  }
}

// ── Add new line from detail modal ──
function toggleNewLine() {
  var form = document.getElementById('new-line-form');
  var btn = document.getElementById('btn-toggle-newline');
  if (form.style.display === 'none') {
    form.style.display = 'block';
    btn.textContent = 'Ocultar';
  } else {
    form.style.display = 'none';
    btn.textContent = 'Mostrar';
  }
}

function calcNewLineTotal() {
  var cant = Number(document.getElementById('nl-cantidad').value) || 0;
  var vuni = Number(document.getElementById('nl-vunitario').value) || 0;
  document.getElementById('nl-vtotal').value = cant * vuni;
}

function resetNewLineForm() {
  document.getElementById('nl-producto').value = '';
  document.getElementById('nl-presentacion').value = '';
  document.getElementById('nl-cantidad').value = '';
  document.getElementById('nl-vunitario').value = '';
  document.getElementById('nl-vtotal').value = '';
  var nlBonif = document.getElementById('nl-bonificado');
  if (nlBonif) nlBonif.checked = false;
  document.getElementById('new-line-form').style.display = 'none';
  document.getElementById('btn-toggle-newline').textContent = 'Mostrar';
}

async function agregarNuevaLinea() {
  if (activeIdx === null) return;
  var producto = document.getElementById('nl-producto').value.trim();
  var presentacion = document.getElementById('nl-presentacion').value.trim();
  var cantidad = Number(document.getElementById('nl-cantidad').value) || 0;
  var vunitario = Number(document.getElementById('nl-vunitario').value) || 0;
  var vtotal = Number(document.getElementById('nl-vtotal').value) || 0;

  if (!producto) { showToast('Ingresa el nombre del producto', '#e74c3c'); return; }
  if (cantidad <= 0) { showToast('La cantidad debe ser mayor a 0', '#e74c3c'); return; }

  var c = consecs[activeIdx];
  var newLine = {
    __row: null,
    Nombre_Empresa: c.Nombre_Empresa,
    Consecutivo: c.Consecutivo,
    Fecha_Pedido: c.Fecha_Pedido,
    Producto: producto,
    Presentacion: presentacion,
    Cantidad: cantidad,
    Valor_Unitario: vunitario,
    Valor_Total: vtotal,
    Cant_Entregada: 0,
    Cant_Pendiente: cantidad,
    Estado_Entrega: 'Recibido',
    Estado: 'recibido',
    Estado_2: 'Abierto',
    Bonificado: (document.getElementById('nl-bonificado') && document.getElementById('nl-bonificado').checked) ? 'Sí' : ''
  };

  var hdr = {
    Cliente: c.Cliente, NIT: c.NIT, Fecha_Pedido: c.Fecha_Pedido,
    Comercial: c.Comercial, Municipio: c.Municipio, Departamento: c.Departamento,
    Telefono: c.Telefono, Plazo_Pago: c.Plazo_Pago, Precio_Facturacion: c.Precio_Facturacion,
    Nombre_Empresa: c.Nombre_Empresa, Consecutivo: c.Consecutivo,
    Total_Orden: (Number(c.Total_Orden) || 0) + vtotal
  };

  var btn = document.getElementById('btn-add-newline');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  var savedKey = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);

  try {
    var result = await apiPost({
      action: 'editarPedido',
      header: hdr,
      lineas: [newLine],
      deleteRows: []
    });
    if (!result || !result.ok) throw new Error((result && result.error) || 'Error al guardar');

    resetNewLineForm();
    showToast('✅ Línea de producto agregada al pedido');
    await loadFromAPI();
    var newIdx = consecs.findIndex(function(cc) { return keyOf(cc.Nombre_Empresa, cc.Consecutivo, cc.Cliente) === savedKey; });
    if (newIdx >= 0) {
      openDetail(newIdx);
    }
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Agregar línea al pedido';
  }
}

// ── Edit Modal ──
function openEdit(idx) {
  editIdx = idx;
  var c = consecs[idx];
  editKey = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
  editWorkingLines = getLinesFor(c).map(function(l) { return Object.assign({}, l); });

  document.getElementById('ed-titulo').textContent = '✏️ [' + getSigla(c.Nombre_Empresa) + '] Orden #' + (c.Consecutivo||'');
  document.getElementById('ed-cliente').value = c.Cliente || '';
  document.getElementById('ed-nit').value = c.NIT || '';
  document.getElementById('ed-fecha').value = toDateInput(c.Fecha_Pedido);
  document.getElementById('ed-comercial').value = c.Comercial || '';
  document.getElementById('ed-municipio').value = c.Municipio || '';
  document.getElementById('ed-departamento').value = c.Departamento || '';
  document.getElementById('ed-telefono').value = c.Telefono || '';
  document.getElementById('ed-plazo').value = c.Plazo_Pago || '';
  document.getElementById('ed-precio').value = c.Precio_Facturacion || '';
  document.getElementById('ed-facturar-a').value = c.Facturar_A || c.Cliente || '';
  document.getElementById('ed-nit-adicional').value = c.NIT_Adicional || '';
  document.getElementById('ed-consignacion').value = c.Consignacion || 'No';
  document.getElementById('ed-estado2').value = derivedEstado2(getLinesFor(c));
  document.getElementById('btn-saveEdit').disabled = false;
  document.getElementById('btn-saveEdit').textContent = '✓ Aplicar cambios';

  renderEditLines();
  document.getElementById('edit-overlay').classList.add('show');
  destroyGeoAC('ed');
  geoACs.ed = setupGeoAutocomplete(
    document.getElementById('ed-departamento'),
    document.getElementById('ed-municipio')
  );
}

function closeEdit() {
  document.getElementById('edit-overlay').classList.remove('show');
  editIdx = null; editKey = null; editWorkingLines = [];
  destroyGeoAC('ed');
}

document.getElementById('edit-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeEdit(); });

function renderEditLines() {
  var tbody = document.getElementById('ed-lines');
  tbody.innerHTML = editWorkingLines.map(function(l, i) {
    var locked = (Number(l.Cant_Entregada)||0) > 0;
    var prod = (l.Producto||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    var pres = (l.Presentacion||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td><input class="ef ed-prod" data-i="' + i + '" type="text" value="' + prod + '" style="min-width:260px' + (locked ? ';background:#f7fafc' : '') + '"></td>' +
      '<td><input class="ef ed-pres" data-i="' + i + '" type="text" value="' + pres + '"' + (locked ? ' style="background:#f7fafc"' : '') + '></td>' +
      '<td><input class="ef ed-cant" data-i="' + i + '" type="number" min="0" value="' + (l.Cantidad||0) + '" style="width:80px;text-align:right" oninput="updateLineTotal(' + i + ')"></td>' +
      '<td><input class="ef ed-vuni" data-i="' + i + '" type="number" min="0" value="' + (l.Valor_Unitario||0) + '" style="width:100px;text-align:right" oninput="updateLineTotal(' + i + ')"></td>' +
      '<td><input class="ef ed-vtot" data-i="' + i + '" type="number" value="' + (l.Valor_Total||0) + '" style="width:100px;text-align:right;background:#f7fafc" readonly></td>' +
      '<td><input class="ef ed-rem" data-i="' + i + '" type="text" value="' + (l.Remisiones||'').replace(/"/g,'&quot;') + '" placeholder="' + (locked ? 'Ej: REM-001' : '') + '" style="width:120px;font-size:0.78rem"></td>' +
      '<td style="text-align:center">' +
        (locked
          ? '<span style="font-size:0.85rem;color:#a0aec0" title="Tiene entregas registradas">🔒</span>'
          : '<button onclick="removeEditLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>') +
      '</td></tr>';
  }).join('');
  updateEditTotal();
}

function updateLineTotal(i) {
  var cants = document.querySelectorAll('.ed-cant');
  var vunis = document.querySelectorAll('.ed-vuni');
  var vtots = document.querySelectorAll('.ed-vtot');
  var cant = parseFloat(cants[i] && cants[i].value) || 0;
  var vuni = parseFloat(vunis[i] && vunis[i].value) || 0;
  var vtot = cant * vuni;
  if (vtots[i]) vtots[i].value = vtot;
  if (editWorkingLines[i]) {
    editWorkingLines[i].Cantidad = cant;
    editWorkingLines[i].Valor_Unitario = vuni;
    editWorkingLines[i].Valor_Total = vtot;
  }
  updateEditTotal();
}

function updateEditTotal() {
  var total = editWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0);
  document.getElementById('ed-total-calc').textContent = fmtMoney(total);
}

function addEditLine() {
  editWorkingLines.push({
    Producto:'', Presentacion:'', Cantidad:0, Valor_Unitario:0, Valor_Total:0,
    Cant_Entregada:0, Cant_Pendiente:0, Estado_Entrega:'Recibido',
    Fecha_Ult_Entrega:null, Remisiones:'', __row: null
  });
  renderEditLines();
  var wrap = document.querySelector('#edit-overlay .prod-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function removeEditLine(i) {
  editWorkingLines.splice(i, 1);
  renderEditLines();
}

async function saveEdit() {
  if (editIdx === null) return;

  var prods = [].slice.call(document.querySelectorAll('.ed-prod'));
  var press = [].slice.call(document.querySelectorAll('.ed-pres'));
  var cants = [].slice.call(document.querySelectorAll('.ed-cant'));
  var vunis = [].slice.call(document.querySelectorAll('.ed-vuni'));
  var vtots = [].slice.call(document.querySelectorAll('.ed-vtot'));
  var rems = [].slice.call(document.querySelectorAll('.ed-rem'));
  editWorkingLines.forEach(function(l, i) {
    l.Producto = prods[i] ? prods[i].value.trim() : '';
    l.Presentacion = press[i] ? press[i].value.trim() : '';
    l.Cantidad = Number(cants[i] && cants[i].value) || 0;
    l.Valor_Unitario = Number(vunis[i] && vunis[i].value) || 0;
    l.Valor_Total = Number(vtots[i] && vtots[i].value) || 0;
    l.Remisiones = rems[i] ? rems[i].value.trim() : '';
    l.Cant_Pendiente = Math.max(0, l.Cantidad - (Number(l.Cant_Entregada)||0));
  });

  var hdr = {
    Cliente: document.getElementById('ed-cliente').value.trim(),
    NIT: document.getElementById('ed-nit').value.trim(),
    Fecha_Pedido: document.getElementById('ed-fecha').value || null,
    Comercial: document.getElementById('ed-comercial').value.trim(),
    Municipio: document.getElementById('ed-municipio').value.trim(),
    Departamento: document.getElementById('ed-departamento').value.trim(),
    Telefono: document.getElementById('ed-telefono').value.trim(),
    Plazo_Pago: document.getElementById('ed-plazo').value.trim(),
    Precio_Facturacion: document.getElementById('ed-precio').value.trim(),
    Facturar_A: document.getElementById('ed-facturar-a').value.trim(),
    NIT_Adicional: document.getElementById('ed-nit-adicional').value.trim(),
    Consignacion: document.getElementById('ed-consignacion').value,
    Total_Orden: editWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0),
    Estado_2: document.getElementById('ed-estado2').value,
  };

  var c = consecs[editIdx];
  var originalLines = getLinesFor(c);
  var originalRows = originalLines.map(function(l) { return l.__row; });
  var keepRows = editWorkingLines.filter(function(l) { return l.__row; }).map(function(l) { return l.__row; });
  var deleteRows = originalRows.filter(function(r) { return keepRows.indexOf(r) < 0; });

  var btn = document.getElementById('btn-saveEdit');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'editarPedido',
      header: Object.assign({}, hdr, { Nombre_Empresa: c.Nombre_Empresa, Consecutivo: c.Consecutivo }),
      lineas: editWorkingLines,
      deleteRows: deleteRows
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');

    closeEdit();
    showToast('✅ Pedido actualizado en la nube');
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Aplicar cambios';
  }
}

async function agregarProductosNuevosAlMaestro(productos, empresa) {
  if (!productosCache) return;
  var nuevos = [];
  productos.forEach(function(p) {
    if (!p.producto) return;
    if (p._normalizado) return;
    var np = _normTxt(p.producto);
    var exists = productosCache.some(function(m) { return _normTxt(m.producto) === np; });
    if (!exists) {
      var yaAgregado = nuevos.some(function(n) { return _normTxt(n.producto) === np; });
      if (!yaAgregado) nuevos.push({ producto: p.producto, presentacion: p.presentacion || '', empresa: empresa || '' });
    }
  });
  if (!nuevos.length) return;
  try {
    var res = await apiPost({ action: 'addMaestroProductos', items: nuevos });
    if (res.ok && res.added) {
      nuevos.forEach(function(n) { productosCache.push(n); });
      showToast(res.added + ' producto(s) nuevo(s) agregado(s) al maestro', '#2E86C1');
    }
  } catch(e) {}
}

// ── Upload Order from Excel ──
var uploadData = null;

function _normTxt(s) {
  if (!s && s !== 0) return '';
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function _normVolume(s) {
  s = s.replace(/\bbidon(?:\s+de)?\s+20\s*(?:litros?|lts?)\b/g, '1 bidon');
  s = s.replace(/\bgalon(?:\s+de)?\s+4\s*(?:litros?|lts?)\b/g, '1 galon');
  s = s.replace(/\b20\s*(?:litros?|lts?)\b/g, '1 bidon');
  s = s.replace(/\b4\s*(?:litros?|lts?)\b/g, '1 galon');
  return s;
}

function normalizarProductosConMaestro(productos) {
  if (!productosCache || !productosCache.length) return productos;
  var maestro = {};
  var maestroVol = {};
  productosCache.forEach(function(m) {
    var key = _normTxt(m.producto) + '|' + _normTxt(m.presentacion);
    if (!maestro[key]) maestro[key] = m;
    var vkey = _normVolume(key);
    if (!maestroVol[vkey]) maestroVol[vkey] = m;
  });
  var maestroKeys = Object.keys(maestro);
  var maestroVolKeys = Object.keys(maestroVol);

  return productos.map(function(p) {
    var np = _normTxt(p.producto);
    var nq = _normTxt(p.presentacion);
    var key = np + '|' + nq;

    if (maestro[key]) {
      var m = maestro[key];
      if (m.producto === p.producto && (m.presentacion || '') === (p.presentacion || ''))
        return p;
      var r = Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
      return r;
    }

    var vkey = _normVolume(key);
    if (maestroVol[vkey]) {
      var m = maestroVol[vkey];
      return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
    }

    var candProd = [];
    maestroKeys.forEach(function(k) { if (k.split('|')[0] === np) candProd.push(maestro[k]); });
    if (candProd.length === 1) {
      var m = candProd[0];
      if (m.producto === p.producto) return p;
      return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
    }

    if (!candProd.length) {
      var vnp = _normVolume(np);
      var candVolProd = [];
      maestroVolKeys.forEach(function(k) { if (k.split('|')[0] === vnp) candVolProd.push(maestroVol[k]); });
      if (candVolProd.length === 1) {
        var m = candVolProd[0];
        return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
      }
    }

    var bestScore = 0, bestKey = null;
    var queryStr = _normVolume(np + ' ' + nq);
    maestroKeys.forEach(function(k) {
      var parts = k.split('|');
      var candStr = _normVolume(parts[0] + ' ' + parts[1]);
      var longer = Math.max(queryStr.length, candStr.length);
      if (!longer) return;
      var dp = [];
      for (var i = 0; i <= queryStr.length; i++) { dp[i] = []; for (var j = 0; j <= candStr.length; j++) dp[i][j] = 0; }
      for (var i = 1; i <= queryStr.length; i++)
        for (var j = 1; j <= candStr.length; j++)
          dp[i][j] = queryStr[i-1] === candStr[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
      var lcs = dp[queryStr.length][candStr.length];
      var score = (2 * lcs) / (queryStr.length + candStr.length);
      if (score > bestScore) { bestScore = score; bestKey = k; }
    });
    if (bestScore >= 0.75 && bestKey) {
      var m = maestro[bestKey];
      return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
    }

    return p;
  });
}

function handleFileUpload(input) {
  var file = input.files[0];
  if (!file) return;
  input.value = '';
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var data = new Uint8Array(e.target.result);
      var parsed = parseOrderExcel(data, file.name);
      uploadData = parsed;
      await showUploadPreview(parsed);
    } catch (err) {
      showToast('Error al leer el archivo: ' + err.message, '#e74c3c');
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseOrderExcel(data, filename) {
  var wb = XLSX.read(data, {type: 'array', cellDates: true});
  var ws = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(ws, {header: 1, defval: null, raw: true});

  function get(r, c) {
    if (r >= rows.length) return null;
    var row = rows[r] || [];
    return c < row.length ? row[c] : null;
  }

  function str(v) { return v != null ? String(v).trim() : null; }

  function dateFmt(v) {
    if (!v) return null;
    if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0') + '-' + String(v.getDate()).padStart(2,'0');
    return String(v);
  }

  function findRow(label, col) {
    col = col || 0;
    for (var i = 0; i < rows.length; i++) {
      var cell = get(i, col);
      if (cell != null && String(cell).trim().toUpperCase().indexOf(label) >= 0) return i;
    }
    return null;
  }

  function findSelectedOption(row, skipCol) {
    if (!row) return null;
    skipCol = skipCol || 0;
    var labeled = [];
    for (var i = 0; i < row.length; i++) {
      if (row[i] != null && i > skipCol) labeled.push({i: i, v: row[i]});
    }
    var xItems = labeled.filter(function(item) { return String(item.v).trim().toLowerCase() === 'x'; });
    if (!xItems.length) return null;
    var xp = xItems[0].i;
    var before = labeled.filter(function(item) { return String(item.v).trim().toLowerCase() !== 'x' && item.i < xp; });
    if (!before.length) return null;
    before.sort(function(a, b) { return b.i - a.i; });
    return String(before[0].v).trim();
  }

  var rEmpresa = findRow('NOMBRE DE LA EMPRESA');
  var rFecha = findRow('FECHA');
  var rCliente = findRow('CLIENTE');
  var rDirEnvio = findRow('DIRECCION DE ENVIO') || findRow('DIRECCI');
  var rMunicipio = findRow('MUNICIPIO');
  var rPlazo = findRow('PLAZO DE PAGO');
  var rPrecio = findRow('PRECIO FACTURA');

  function findLabeledValue(label) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || [];
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        if (cell == null) continue;
        var upper = String(cell).trim().toUpperCase();
        if (upper.indexOf(label) < 0) continue;
        for (var cc = c + 1; cc < row.length; cc++) {
          if (row[cc] != null && String(row[cc]).trim() !== '') return { row: i, col: cc };
        }
      }
    }
    return null;
  }

  var consecInfo = findLabeledValue('CONSECUTIVO');
  var comercialInfo = findLabeledValue('COMERCIAL');
  var nitInfo = findLabeledValue('NIT');
  var telInfo = findLabeledValue('TEL');
  var deptoInfo = findLabeledValue('DEPARTAMENTO');

  var prodHeader = null, obsRow = null, totalRow = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && str(rows[i][0]) === 'PRODUCTOS') prodHeader = i;
    if (rows[i] && str(rows[i][0]) === 'OBSERVACIONES') obsRow = i;
    for (var c = 0; c < (rows[i]||[]).length; c++) {
      if (rows[i][c] != null && String(rows[i][c]).indexOf('TOTAL A PAGAR') >= 0) { totalRow = i; break; }
    }
  }

  var cantCol = 5, vuCol = 10, vtCol = 15;
  if (prodHeader !== null) {
    var hdr = rows[prodHeader] || [];
    for (var c = 0; c < hdr.length; c++) {
      var h = str(hdr[c]) || '';
      if (h.toUpperCase().indexOf('CANTIDAD') >= 0) cantCol = c;
      if (h.toUpperCase().indexOf('VALOR UNITARIO') >= 0) vuCol = c;
      if (h.toUpperCase().indexOf('VALOR TOTAL') >= 0) vtCol = c;
    }
  }

  var productos = [];
  if (prodHeader !== null) {
    var endRow = obsRow || rows.length;
    for (var r = prodHeader + 1; r < endRow; r++) {
      var nombre = get(r, 0);
      if (nombre == null) continue;
      var nombreStr = String(nombre);
      var textoTieneBonif = /bonificado/i.test(nombreStr);
      var productoLimpio = textoTieneBonif ? nombreStr.replace(/\s*bonificado\s*/gi, ' ').trim() : nombreStr;
      var vUnitario = Number(get(r, vuCol)) || 0;
      var esBonificado = textoTieneBonif || (vUnitario > 0 && vUnitario < 10);
      productos.push({
        producto: productoLimpio,
        presentacion: get(r, 1),
        cantidad: get(r, cantCol),
        valor_unitario: get(r, vuCol),
        valor_total: get(r, vtCol),
        bonificado: esBonificado ? 'Sí' : '',
      });
    }
  }

  var observaciones = null;
  if (obsRow !== null) {
    var obsParts = [];
    var obsRowData = rows[obsRow] || [];
    for (var oi = 1; oi < obsRowData.length; oi++) {
      if (obsRowData[oi] != null && String(obsRowData[oi]).trim()) obsParts.push(String(obsRowData[oi]).trim());
    }
    if (obsParts.length) observaciones = obsParts.join(' ');
  }

  return {
    nombre_empresa: rEmpresa !== null ? str(get(rEmpresa, 1)) : null,
    consecutivo: consecInfo ? get(consecInfo.row, consecInfo.col) : null,
    fecha_pedido: rFecha !== null ? dateFmt(get(rFecha, 1)) : null,
    cliente: rCliente !== null ? str(get(rCliente, 1)) : null,
    nit: nitInfo ? get(nitInfo.row, nitInfo.col) : null,
    telefono: telInfo ? get(telInfo.row, telInfo.col) : null,
    direccion_envio: rDirEnvio !== null ? str(get(rDirEnvio, 1)) : null,
    municipio: rMunicipio !== null ? str(get(rMunicipio, 1)) : null,
    departamento: deptoInfo ? str(get(deptoInfo.row, deptoInfo.col)) : null,
    comercial: comercialInfo ? str(get(comercialInfo.row, comercialInfo.col)) : null,
    plazo_pago: rPlazo !== null ? findSelectedOption(rows[rPlazo]) : null,
    precio_facturacion: rPrecio !== null ? findSelectedOption(rows[rPrecio]) : null,
    total_orden: totalRow !== null ? get(totalRow, vtCol) : null,
    observaciones: observaciones,
    productos: productos,
    archivo_fuente: filename,
  };
}

async function showUploadPreview(data) {
  if (!productosCache) {
    try { var r = await apiGet('getMaestroProductos'); if (r.ok) productosCache = r.productos || []; } catch(e) { productosCache = []; }
  }
  data.productos = normalizarProductosConMaestro(data.productos);

  document.getElementById('up-archivo').textContent = 'Archivo: ' + data.archivo_fuente;
  document.getElementById('up-empresa').textContent = data.nombre_empresa || '—';
  document.getElementById('up-consecutivo').textContent = data.consecutivo || '—';
  document.getElementById('up-fecha').textContent = data.fecha_pedido || '—';
  document.getElementById('up-cliente').textContent = data.cliente || '—';
  document.getElementById('up-nit').textContent = data.nit || '—';
  document.getElementById('up-comercial').textContent = data.comercial || '—';
  document.getElementById('up-municipio').textContent = data.municipio || '—';
  document.getElementById('up-departamento').textContent = data.departamento || '—';
  document.getElementById('up-plazo').textContent = data.plazo_pago || '—';
  var obsWrap = document.getElementById('up-obs-wrap');
  if (data.observaciones) {
    document.getElementById('up-observaciones').textContent = data.observaciones;
    obsWrap.style.display = 'block';
  } else {
    obsWrap.style.display = 'none';
  }
  document.getElementById('up-total').textContent = fmtMoney(data.total_orden);

  var normCount = data.productos.filter(function(p) { return p._normalizado; }).length;

  var tbody = document.getElementById('up-lines');
  if (!data.productos.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#a0aec0;padding:16px">Sin productos</td></tr>';
  } else {
    tbody.innerHTML = data.productos.map(function(p, i) {
      var normBadge = '';
      if (p._normalizado) {
        normBadge = '<span title="Original: ' + escHtml(p._original) + '" style="background:#fff3cd;color:#856404;padding:1px 6px;border-radius:8px;font-size:0.65rem;margin-left:4px;cursor:help">corregido</span>';
      }
      return '<tr>' +
        '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
        '<td style="font-weight:700">' + (p.producto||'—') + normBadge + '</td>' +
        '<td>' + (p.presentacion||'') + '</td>' +
        '<td class="money">' + (p.cantidad||0) + '</td>' +
        '<td class="money">' + fmtMoney(p.valor_unitario) + '</td>' +
        '<td class="money">' + fmtMoney(p.valor_total) + '</td>' +
        '<td style="text-align:center">' + (p.bonificado ? '<span style="background:#d5f5e3;color:#1e8449;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:700">Sí</span>' : '<span style="color:#718096;font-size:0.75rem">No</span>') + '</td>' +
        '</tr>';
    }).join('');
  }
  var oldBanner = document.querySelector('.norm-banner');
  if (oldBanner) oldBanner.remove();
  if (normCount > 0) {
    var banner = document.createElement('div');
    banner.className = 'norm-banner';
    banner.style.cssText = 'background:#fff3cd;color:#856404;padding:8px 12px;border-radius:6px;margin-bottom:8px;font-size:0.85rem';
    banner.innerHTML = '⚠️ ' + normCount + ' producto(s) corregido(s) segun maestro de productos. Pase el cursor sobre <span style="background:#fff3cd;border:1px solid #856404;padding:0 4px;border-radius:4px;font-size:0.65rem">corregido</span> para ver el nombre original.';
    var prodWrap = tbody.closest('.prod-wrap');
    prodWrap.parentElement.insertBefore(banner, prodWrap);
  }

  var dupWarn = document.getElementById('up-dup-warn');
  dupWarn.style.display = 'none';
  try {
    var dupResult = await apiPost({
      action: 'checkDuplicado',
      consecutivo: data.consecutivo,
      cliente: data.cliente,
      fecha_pedido: data.fecha_pedido,
      nombre_empresa: data.nombre_empresa
    });
    if (dupResult.ok && dupResult.duplicado) dupWarn.style.display = 'block';
  } catch(e) {}

  document.getElementById('btn-upload').disabled = false;
  document.getElementById('btn-upload').textContent = '📥 Cargar pedido';
  document.getElementById('upload-overlay').classList.add('show');
}

function closeUpload() {
  document.getElementById('upload-overlay').classList.remove('show');
  uploadData = null;
}

document.getElementById('upload-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeUpload(); });

async function confirmUpload() {
  if (!uploadData) return;
  var btn = document.getElementById('btn-upload');
  btn.disabled = true;
  btn.textContent = '⏳ Cargando...';

  try {
    var result = await apiPost({
      action: 'agregarPedido',
      nombre_empresa: uploadData.nombre_empresa,
      consecutivo: uploadData.consecutivo,
      fecha_pedido: uploadData.fecha_pedido,
      cliente: uploadData.cliente,
      nit: uploadData.nit,
      telefono: uploadData.telefono,
      direccion_envio: uploadData.direccion_envio,
      municipio: uploadData.municipio,
      departamento: uploadData.departamento,
      comercial: uploadData.comercial,
      plazo_pago: uploadData.plazo_pago,
      precio_facturacion: uploadData.precio_facturacion,
      total_orden: uploadData.total_orden,
      observaciones: uploadData.observaciones,
      productos: uploadData.productos.map(function(p) {
        return { producto: p.producto, presentacion: p.presentacion, cantidad: p.cantidad,
                 valor_unitario: p.valor_unitario, valor_total: p.valor_total, bonificado: p.bonificado || '' };
      }),
      archivo_fuente: uploadData.archivo_fuente,
    });
    if (!result.ok) throw new Error(result.error || 'Error al cargar');
    await agregarProductosNuevosAlMaestro(uploadData.productos, uploadData.nombre_empresa);
    generarPedidoPDF({
      empresa: uploadData.nombre_empresa,
      consecutivo: uploadData.consecutivo,
      fecha: uploadData.fecha_pedido,
      cliente: uploadData.cliente,
      nit: uploadData.nit,
      telefono: uploadData.telefono,
      direccion: uploadData.direccion_envio,
      municipio: uploadData.municipio,
      departamento: uploadData.departamento,
      comercial: uploadData.comercial,
      plazo: uploadData.plazo_pago,
      precio: uploadData.precio_facturacion,
      observaciones: uploadData.observaciones,
      total: uploadData.total_orden,
      productos: uploadData.productos,
      archivo: uploadData.archivo_fuente
    });
    closeUpload();
    showToast('Pedido cargado: ' + (result.added||0) + ' linea(s) agregadas');
    await loadFromAPI();
  } catch (err) {
    showToast('Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '📥 Cargar pedido';
  }
}

// ── Delete Order ──
var deleteIdx = null;

function openDelete(idx) {
  deleteIdx = idx;
  var c = consecs[idx];
  var lines = getLinesFor(c);
  var est = derivedStatus(lines);
  document.getElementById('del-msg').textContent = '¿Eliminar el pedido #' + (c.Consecutivo||'') + ' de ' + getSigla(c.Nombre_Empresa) + '?';
  document.getElementById('del-detail').innerHTML =
    'Cliente: <strong>' + (c.Cliente||'—') + '</strong><br>' +
    'Productos: ' + lines.length + ' línea(s) · Estado: ' + est + '<br>' +
    'Total: ' + fmtMoney(c.Total_Orden) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminarán todas las líneas de este pedido de la base de datos.</span>';
  document.getElementById('btn-del-confirm').disabled = false;
  document.getElementById('btn-del-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-overlay').classList.add('show');
}

function closeDelete() {
  document.getElementById('delete-overlay').classList.remove('show');
  deleteIdx = null;
}

document.getElementById('delete-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDelete(); });

async function confirmDelete() {
  if (deleteIdx === null) return;
  var c = consecs[deleteIdx];
  var btn = document.getElementById('btn-del-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({
      action: 'eliminarPedido',
      empresa: c.Nombre_Empresa,
      consecutivo: String(c.Consecutivo)
    });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDelete();
    showToast('🗑️ Pedido eliminado: ' + (result.deleted||0) + ' línea(s) removidas');
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Autocomplete ──
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

var clientesCache = null;
var productosCache = null;
var clienteAC = null;
var productoACs = [];
var geoACs = { nv: null, md: null, ed: null };

function destroyGeoAC(key) {
  if (geoACs[key]) {
    if (geoACs[key].deptAC) geoACs[key].deptAC.destroy();
    if (geoACs[key].muniAC) geoACs[key].muniAC.destroy();
    geoACs[key] = null;
  }
}

async function loadAutocompleteData() {
  var promises = [];
  if (!clientesCache) promises.push(apiGet('getClientesUnicos').then(function(r) { if (r.ok) clientesCache = r.clientes || []; }).catch(function() { clientesCache = []; }));
  if (!productosCache) promises.push(apiGet('getMaestroProductos').then(function(r) { if (r.ok) productosCache = r.productos || []; }).catch(function() { productosCache = []; }));
  if (promises.length) await Promise.all(promises);
}

function initAutocomplete(input, opts) {
  var dd = document.createElement('div');
  dd.className = 'ac-dropdown';
  dd.style.display = 'none';
  document.body.appendChild(dd);
  var selIdx = -1, items = [];

  function pos() {
    var r = input.getBoundingClientRect();
    dd.style.top = r.bottom + 'px';
    dd.style.left = r.left + 'px';
    dd.style.width = Math.max(r.width, 320) + 'px';
  }

  function show() {
    var val = input.value.toLowerCase().trim();
    if (val.length < (opts.minChars || 2)) { dd.style.display = 'none'; return; }
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
  input.addEventListener('focus', function() { if (input.value.trim().length >= (opts.minChars || 2)) show(); });
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

function destroyProductoACs() { productoACs.forEach(function(ac) { ac.destroy(); }); productoACs = []; }

function setupProductoAutocomplete() {
  destroyProductoACs();
  if (!productosCache) return;
  [].slice.call(document.querySelectorAll('.nv-prod')).forEach(function(input, i) {
    productoACs.push(initAutocomplete(input, {
      items: function() {
        var emp = document.getElementById('nv-empresa').value;
        var prods = productosCache || [];
        if (emp) prods = prods.filter(function(p) { return !p.empresa || p.empresa === emp; });
        return prods;
      },
      display: function(p) {
        return '<strong>' + escHtml(p.producto) + '</strong>' +
               (p.presentacion ? ' <span class="ac-sub">— ' + escHtml(p.presentacion) + '</span>' : '');
      },
      match: function(p, val) {
        return ((p.producto||'') + ' ' + (p.presentacion||'')).toLowerCase().indexOf(val) >= 0;
      },
      onSelect: function(p) {
        input.value = p.producto || '';
        var presInputs = document.querySelectorAll('.nv-pres');
        if (presInputs[i]) presInputs[i].value = p.presentacion || '';
        syncNuevoFromDOM();
      }
    }));
  });
}

// ── New Order Manual Entry ──
function getLastOrderForClient(clienteName) {
  if (!clienteName || !pedidos.length) return null;
  var normClient = clienteName.toLowerCase().trim();
  var clientOrders = pedidos.filter(function(p) {
    return (p.Cliente || '').toLowerCase().trim() === normClient;
  });
  if (!clientOrders.length) return null;
  clientOrders.sort(function(a, b) {
    return +new Date(b.Fecha_Pedido || 0) - +new Date(a.Fecha_Pedido || 0);
  });
  return clientOrders[0];
}

var nuevoProductos = [];

function populateNuevoDataLists() {
  var plazos = {}, precios = {};
  pedidos.forEach(function(p) {
    var pl = (p.Plazo_Pago || '').trim();
    var pr = (p.Precio_Facturacion || '').trim();
    if (pl) plazos[pl] = true;
    if (pr) precios[pr] = true;
  });
  document.getElementById('dl-plazo').innerHTML = Object.keys(plazos).sort().map(function(v) {
    return '<option value="' + v.replace(/"/g, '&quot;') + '">';
  }).join('');
  document.getElementById('dl-precio').innerHTML = Object.keys(precios).sort().map(function(v) {
    return '<option value="' + v.replace(/"/g, '&quot;') + '">';
  }).join('');
}

function populateComercialSelect(empresa) {
  var dl = document.getElementById('dl-comercial');
  var seen = {};
  var list = [];
  pedidos.forEach(function(p) {
    if (empresa && (p.Nombre_Empresa || '') !== empresa) return;
    var c = (p.Comercial || '').trim();
    if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = true; list.push(c); }
  });
  list.sort(function(a, b) { return a.localeCompare(b, 'es'); });
  dl.innerHTML = list.map(function(c) { return '<option value="' + c.replace(/"/g, '&quot;') + '">'; }).join('');
}

function nextConsecutivoPorComercial(comercial) {
  if (!comercial) return '';
  var cLow = comercial.trim().toLowerCase();
  var max = 0;
  pedidos.forEach(function(p) {
    if ((p.Comercial || '').trim().toLowerCase() === cLow) {
      var n = Number(p.Consecutivo) || 0;
      if (n > max) max = n;
    }
  });
  return max + 1;
}

function actualizarConsecutivoNuevo() {
  var comercial = document.getElementById('nv-comercial').value.trim();
  document.getElementById('nv-consecutivo').value = comercial ? nextConsecutivoPorComercial(comercial) : '';
}

async function openNuevoPedido() {
  document.getElementById('nv-empresa').value = '';
  document.getElementById('nv-consecutivo').value = '';
  document.getElementById('nv-fecha').value = today();
  document.getElementById('nv-cliente').value = '';
  document.getElementById('nv-nit').value = '';
  document.getElementById('nv-comercial').value = '';
  document.getElementById('nv-telefono').value = '';
  document.getElementById('nv-direccion').value = '';
  document.getElementById('nv-municipio').value = '';
  document.getElementById('nv-departamento').value = '';
  document.getElementById('nv-plazo').value = '';
  document.getElementById('nv-precio').value = '';
  document.getElementById('nv-facturar-a').value = '';
  document.getElementById('nv-facturar-a').removeAttribute('data-edited');
  document.getElementById('nv-nit-adicional').value = '';
  document.getElementById('nv-consignacion').value = 'No';
  document.getElementById('nv-observaciones').value = '';
  document.getElementById('nv-dup-warn').style.display = 'none';
  document.getElementById('btn-guardar-nuevo').disabled = false;
  document.getElementById('btn-guardar-nuevo').textContent = '✏️ Guardar pedido';
  nuevoProductos = [{ producto:'', presentacion:'', cantidad:0, valor_unitario:0, valor_total:0, bonificado:'' }];
  populateComercialSelect('');
  var nvEmpSel = document.getElementById('nv-empresa');
  nvEmpSel.onchange = function() {
    document.getElementById('nv-comercial').value = '';
    populateComercialSelect(nvEmpSel.value);
    actualizarConsecutivoNuevo();
  };
  document.getElementById('nv-comercial').oninput = actualizarConsecutivoNuevo;
  document.getElementById('nv-cliente').addEventListener('input', function() {
    var fa = document.getElementById('nv-facturar-a');
    if (!fa.dataset.edited) fa.value = this.value;
  });
  document.getElementById('nv-facturar-a').addEventListener('input', function() {
    this.dataset.edited = '1';
  });
  populateNuevoDataLists();
  renderNuevoLines();
  document.getElementById('nuevo-overlay').classList.add('show');

  await loadAutocompleteData();
  if (clienteAC) { clienteAC.destroy(); clienteAC = null; }
  clienteAC = initAutocomplete(document.getElementById('nv-cliente'), {
    items: function() { return clientesCache || []; },
    display: function(c) {
      return '<strong>' + escHtml(c.cliente) + '</strong>' +
             (c.nit ? '<div class="ac-sub">NIT: ' + escHtml(c.nit) + '</div>' : '');
    },
    match: function(c, val) {
      return ((c.cliente||'') + ' ' + (c.nit||'')).toLowerCase().indexOf(val) >= 0;
    },
    onSelect: function(c) {
      document.getElementById('nv-cliente').value = c.cliente || '';
      document.getElementById('nv-facturar-a').value = c.cliente || '';
      if (c.nit) document.getElementById('nv-nit').value = c.nit;
      if (c.telefono) document.getElementById('nv-telefono').value = c.telefono;
      if (c.municipio) document.getElementById('nv-municipio').value = c.municipio;
      if (c.departamento) document.getElementById('nv-departamento').value = c.departamento;
      if (c.direccion) document.getElementById('nv-direccion').value = c.direccion;
      var lastOrder = getLastOrderForClient(c.cliente);
      if (lastOrder) {
        if (lastOrder.Direccion_Envio) document.getElementById('nv-direccion').value = lastOrder.Direccion_Envio;
        if (lastOrder.Municipio) document.getElementById('nv-municipio').value = lastOrder.Municipio;
        if (lastOrder.Departamento) document.getElementById('nv-departamento').value = lastOrder.Departamento;
        if (lastOrder.Plazo_Pago) document.getElementById('nv-plazo').value = lastOrder.Plazo_Pago;
        if (lastOrder.Precio_Facturacion) document.getElementById('nv-precio').value = lastOrder.Precio_Facturacion;
        if (lastOrder.Comercial && !document.getElementById('nv-comercial').value) {
          document.getElementById('nv-comercial').value = lastOrder.Comercial;
          actualizarConsecutivoNuevo();
        }
      }
    }
  });
  setupProductoAutocomplete();
  destroyGeoAC('nv');
  geoACs.nv = setupGeoAutocomplete(
    document.getElementById('nv-departamento'),
    document.getElementById('nv-municipio')
  );
}

function closeNuevo() {
  document.getElementById('nuevo-overlay').classList.remove('show');
  nuevoProductos = [];
  if (clienteAC) { clienteAC.destroy(); clienteAC = null; }
  destroyProductoACs();
  destroyGeoAC('nv');
}

document.getElementById('nuevo-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeNuevo(); });
document.getElementById('nuevo-overlay').addEventListener('scroll', function() {
  [].slice.call(document.querySelectorAll('.ac-dropdown')).forEach(function(dd) { dd.style.display = 'none'; });
}, true);

function renderNuevoLines() {
  var tbody = document.getElementById('nv-lines');
  tbody.innerHTML = nuevoProductos.map(function(p, i) {
    var prod = (p.producto||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    var pres = (p.presentacion||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td><input class="ef nv-prod" data-i="' + i + '" type="text" value="' + prod + '" placeholder="Nombre del producto" style="min-width:260px"></td>' +
      '<td><input class="ef nv-pres" data-i="' + i + '" type="text" value="' + pres + '" placeholder="Ej: 1L, 20KG" style="width:100px"></td>' +
      '<td><input class="ef nv-cant" data-i="' + i + '" type="number" min="0" value="' + (p.cantidad||'') + '" placeholder="0" style="width:80px;text-align:right" oninput="updateNuevoLine(' + i + ')"></td>' +
      '<td><input class="ef nv-vuni" data-i="' + i + '" type="number" min="0" value="' + (p.valor_unitario||'') + '" placeholder="0" style="width:100px;text-align:right" oninput="updateNuevoLine(' + i + ')"></td>' +
      '<td><input class="ef nv-vtot" data-i="' + i + '" type="number" value="' + (p.valor_total||0) + '" style="width:100px;text-align:right;background:#f7fafc" readonly></td>' +
      '<td style="text-align:center"><input type="checkbox" class="nv-bonif" data-i="' + i + '"' + (p.bonificado === 'Sí' ? ' checked' : '') + '></td>' +
      '<td style="text-align:center">' +
        (nuevoProductos.length > 1
          ? '<button onclick="removeNuevoLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>'
          : '') +
      '</td></tr>';
  }).join('');
  updateNuevoTotal();
  setupProductoAutocomplete();
}

function updateNuevoLine(i) {
  syncNuevoFromDOM();
  var cant = nuevoProductos[i].cantidad;
  var vuni = nuevoProductos[i].valor_unitario;
  nuevoProductos[i].valor_total = cant * vuni;
  var vtots = document.querySelectorAll('.nv-vtot');
  if (vtots[i]) vtots[i].value = nuevoProductos[i].valor_total;
  updateNuevoTotal();
}

function updateNuevoTotal() {
  var total = nuevoProductos.reduce(function(s, p) { return s + (Number(p.valor_total)||0); }, 0);
  document.getElementById('nv-total-calc').textContent = fmtMoney(total);
}

function syncNuevoFromDOM() {
  var prods = document.querySelectorAll('.nv-prod');
  var press = document.querySelectorAll('.nv-pres');
  var cants = document.querySelectorAll('.nv-cant');
  var vunis = document.querySelectorAll('.nv-vuni');
  var vtots = document.querySelectorAll('.nv-vtot');
  var bonifs = document.querySelectorAll('.nv-bonif');
  nuevoProductos.forEach(function(p, i) {
    p.producto = prods[i] ? prods[i].value.trim() : '';
    p.presentacion = press[i] ? press[i].value.trim() : '';
    p.cantidad = Number(cants[i] && cants[i].value) || 0;
    p.valor_unitario = Number(vunis[i] && vunis[i].value) || 0;
    p.valor_total = Number(vtots[i] && vtots[i].value) || 0;
    p.bonificado = bonifs[i] && bonifs[i].checked ? 'Sí' : '';
  });
}

function addNuevoProducto() {
  syncNuevoFromDOM();
  nuevoProductos.push({ producto:'', presentacion:'', cantidad:0, valor_unitario:0, valor_total:0, bonificado:'' });
  renderNuevoLines();
  var wrap = document.querySelector('#nuevo-overlay .prod-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function removeNuevoLine(i) {
  syncNuevoFromDOM();
  nuevoProductos.splice(i, 1);
  renderNuevoLines();
}

async function guardarNuevoPedido() {
  syncNuevoFromDOM();

  var empresa = document.getElementById('nv-empresa').value;
  var consecutivo = document.getElementById('nv-consecutivo').value.trim();
  var fecha = document.getElementById('nv-fecha').value;
  var cliente = document.getElementById('nv-cliente').value.trim();

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!consecutivo) { showToast('Selecciona un comercial para generar el consecutivo', '#e74c3c'); return; }
  if (!fecha) { showToast('Selecciona la fecha del pedido', '#e74c3c'); return; }
  if (!cliente) { showToast('Ingresa el nombre del cliente', '#e74c3c'); return; }

  var productosValidos = nuevoProductos.filter(function(p) { return p.producto && p.cantidad > 0; });
  if (!productosValidos.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var btn = document.getElementById('btn-guardar-nuevo');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var dupResult = await apiPost({
      action: 'checkDuplicado',
      consecutivo: consecutivo,
      cliente: cliente,
      fecha_pedido: fecha,
      nombre_empresa: empresa
    });
    if (dupResult.ok && dupResult.duplicado) {
      document.getElementById('nv-dup-warn').style.display = 'block';
    }

    var totalOrden = productosValidos.reduce(function(s, p) { return s + (Number(p.valor_total)||0); }, 0);

    var result = await apiPost({
      action: 'agregarPedido',
      nombre_empresa: empresa,
      consecutivo: consecutivo,
      fecha_pedido: fecha,
      cliente: cliente,
      nit: document.getElementById('nv-nit').value.trim(),
      telefono: document.getElementById('nv-telefono').value.trim(),
      direccion_envio: document.getElementById('nv-direccion').value.trim(),
      municipio: document.getElementById('nv-municipio').value.trim(),
      departamento: document.getElementById('nv-departamento').value.trim(),
      comercial: document.getElementById('nv-comercial').value.trim(),
      plazo_pago: document.getElementById('nv-plazo').value.trim(),
      precio_facturacion: document.getElementById('nv-precio').value.trim(),
      facturar_a: document.getElementById('nv-facturar-a').value.trim() || cliente,
      nit_adicional: document.getElementById('nv-nit-adicional').value.trim(),
      consignacion: document.getElementById('nv-consignacion').value,
      total_orden: totalOrden,
      observaciones: document.getElementById('nv-observaciones').value.trim(),
      productos: productosValidos.map(function(p) {
        return { producto: p.producto, presentacion: p.presentacion, cantidad: p.cantidad,
                 valor_unitario: p.valor_unitario, valor_total: p.valor_total, bonificado: p.bonificado };
      }),
      archivo_fuente: 'Ingreso manual',
    });

    if (!result.ok) throw new Error(result.error || 'Error al guardar');

    await agregarProductosNuevosAlMaestro(productosValidos, empresa);
    generarPedidoPDF({
      empresa: empresa,
      consecutivo: consecutivo,
      fecha: fecha,
      cliente: cliente,
      nit: document.getElementById('nv-nit').value.trim(),
      telefono: document.getElementById('nv-telefono').value.trim(),
      direccion: document.getElementById('nv-direccion').value.trim(),
      municipio: document.getElementById('nv-municipio').value.trim(),
      departamento: document.getElementById('nv-departamento').value.trim(),
      comercial: document.getElementById('nv-comercial').value.trim(),
      plazo: document.getElementById('nv-plazo').value.trim(),
      precio: document.getElementById('nv-precio').value.trim(),
      facturar_a: document.getElementById('nv-facturar-a').value.trim() || cliente,
      nit_adicional: document.getElementById('nv-nit-adicional').value.trim(),
      consignacion: document.getElementById('nv-consignacion').value,
      observaciones: document.getElementById('nv-observaciones').value.trim(),
      total: totalOrden,
      productos: productosValidos,
      archivo: 'Ingreso manual'
    });
    closeNuevo();
    showToast('✅ Pedido creado: ' + (result.added||0) + ' línea(s) agregadas');
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✏️ Guardar pedido';
  }
}

// ── Tab switching ──
function switchPedidoTab(tab) {
  document.getElementById('panel-ordenes').style.display = tab === 'ordenes' ? 'block' : 'none';
  document.getElementById('panel-detalle').style.display = tab === 'detalle' ? 'block' : 'none';
  document.getElementById('tab-ordenes').style.background = tab === 'ordenes' ? '#1a5276' : '#718096';
  document.getElementById('tab-detalle').style.background = tab === 'detalle' ? '#1a5276' : '#718096';
  if (tab === 'detalle') renderDetalle();
}

// ── Vista Detallada (read-only) ──
var detSort = [{ col: 'empresa', dir: 'asc' }];

function toggleDetSort(col, e) {
  var shift = e && e.shiftKey;
  var idx = detSort.findIndex(function(l) { return l.col === col; });
  if (shift) {
    if (idx >= 0) detSort.splice(idx, 1);
    else detSort.push({ col: col, dir: col === 'cantidad' || col === 'pendiente' ? 'desc' : 'asc' });
  } else {
    if (idx >= 0) {
      if (detSort[idx].dir === 'asc') detSort[idx].dir = 'desc';
      else detSort.splice(idx, 1);
    } else {
      detSort = [{ col: col, dir: col === 'cantidad' || col === 'pendiente' ? 'desc' : 'asc' }];
    }
  }
  renderDetalle();
}

function renderDetalle() {
  var fe = document.getElementById('f-emp').value;
  var fcomEl = document.getElementById('f-com');
  var fcom = fcomEl ? fcomEl.value : '';
  var fc = document.getElementById('f-cli').value;
  var fs = document.getElementById('f-est').value;
  var fs2 = document.getElementById('f-est2').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();

  var rows = pedidos.filter(function(p) {
    if (fe && p.Nombre_Empresa !== fe) return false;
    if (fcom && (p.Comercial || '').trim() !== fcom) return false;
    if (fc && (p.Cliente || '').toLowerCase().indexOf(fc.toLowerCase()) < 0) return false;
    if (fs) {
      var rawEst = norm(p.Estado_Entrega || 'Recibido');
      if (rawEst !== norm(fs)) return false;
    }
    if (fs2) {
      var e2 = (p.Estado_2 || 'Abierto').trim();
      if (e2 !== fs2) return false;
    }
    if (ft) {
      var hay = [p.Cliente, String(p.Consecutivo), getSigla(p.Nombre_Empresa), p.Comercial, p.Producto].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });

  if (detSort.length) {
    rows = [].concat(rows).sort(function(a, b) {
      for (var s = 0; s < detSort.length; s++) {
        var col = detSort[s].col, dir = detSort[s].dir;
        var va, vb;
        if (col === 'empresa') { va = getSigla(a.Nombre_Empresa); vb = getSigla(b.Nombre_Empresa); }
        else if (col === 'cliente') { va = (a.Cliente||'').toLowerCase(); vb = (b.Cliente||'').toLowerCase(); }
        else if (col === 'consecutivo') { va = Number(a.Consecutivo)||0; vb = Number(b.Consecutivo)||0; }
        else if (col === 'producto') { va = (a.Producto||'').toLowerCase(); vb = (b.Producto||'').toLowerCase(); }
        else if (col === 'presentacion') { va = (a.Presentacion||'').toLowerCase(); vb = (b.Presentacion||'').toLowerCase(); }
        else if (col === 'cantidad') { va = Number(a.Cantidad)||0; vb = Number(b.Cantidad)||0; }
        else if (col === 'pendiente') { va = Number(a.Cant_Pendiente)||0; vb = Number(b.Cant_Pendiente)||0; }
        else if (col === 'estado') { va = (a.Estado_Entrega||'Recibido'); vb = (b.Estado_Entrega||'Recibido'); }
        else if (col === 'estado2') { va = (a.Estado_2||'Abierto'); vb = (b.Estado_2||'Abierto'); }
        else if (col === 'fecha') { va = +(new Date(a.Fecha_Pedido||0)); vb = +(new Date(b.Fecha_Pedido||0)); }
        else { va = ''; vb = ''; }
        var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  document.getElementById('det-count').textContent = '(' + rows.length + ' líneas)';

  var cols = [
    { id: 'empresa', label: 'Empresa' },
    { id: 'cliente', label: 'Cliente' },
    { id: 'consecutivo', label: 'Consecutivo' },
    { id: 'fecha', label: 'Fecha Pedido' },
    { id: 'producto', label: 'Producto' },
    { id: 'presentacion', label: 'Presentación' },
    { id: 'cantidad', label: 'Cant. Pedida' },
    { id: 'pendiente', label: 'Pendiente' },
    { id: 'estado', label: 'Estado' },
    { id: 'estado2', label: 'Estado 2' },
  ];

  document.getElementById('det-head').innerHTML = cols.map(function(c) {
    var idx = detSort.findIndex(function(l) { return l.col === c.id; });
    var cls = idx >= 0 ? (detSort[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = idx >= 0 && detSort.length > 1 ? '<span style="font-size:0.6rem;vertical-align:super;color:#2980b9">' + (idx+1) + '</span>' : '';
    return '<th class="sortable ' + cls + '" onclick="toggleDetSort(\'' + c.id + '\',event)">' + c.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');

  var tbody = document.getElementById('det-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No hay líneas con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(p) {
    var est = (p.Estado_Entrega || 'Recibido').trim();
    var est2 = (p.Estado_2 || 'Abierto').trim();
    var badgeEst = norm(est) === 'recibido' ? 'b-rec' : norm(est) === 'parcial' ? 'b-par' : norm(est) === 'alistado' ? 'b-alistado' : 'b-ent';
    var badgeEst2 = est2 === 'Abierto' ? 'b-abierto' : est2 === 'Alistado' ? 'b-alistado' : est2 === 'Cerrado' ? 'b-cerrado' : est2 === 'Bloqueado por cartera' ? 'b-bloqueado' : 'b-anulado';
    return '<tr>' +
      '<td><span class="sigla-badge ' + getSiglaClass(p.Nombre_Empresa) + '">' + getSigla(p.Nombre_Empresa) + '</span></td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (p.Cliente||'') + '">' + (p.Cliente||'—') + '</td>' +
      '<td style="text-align:center;font-weight:700">' + (p.Consecutivo||'') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(p.Fecha_Pedido) + '</td>' +
      '<td style="font-weight:600">' + (p.Producto||'—') + '</td>' +
      '<td>' + (p.Presentacion||'—') + '</td>' +
      '<td class="money">' + (Number(p.Cantidad)||0).toLocaleString('es-CO') + '</td>' +
      '<td class="money" style="color:#e74c3c;font-weight:600">' + (Number(p.Cant_Pendiente)||0).toLocaleString('es-CO') + '</td>' +
      '<td><span class="badge ' + badgeEst + '">' + est + '</span></td>' +
      '<td><span class="badge ' + badgeEst2 + '">' + est2 + '</span></td>' +
    '</tr>';
  }).join('');
}

function exportDetalleCSV() {
  var fe = document.getElementById('f-emp').value;
  var fcomEl = document.getElementById('f-com');
  var fcom = fcomEl ? fcomEl.value : '';
  var fc = document.getElementById('f-cli').value;
  var fs = document.getElementById('f-est').value;
  var fs2 = document.getElementById('f-est2').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();

  var rows = pedidos.filter(function(p) {
    if (fe && p.Nombre_Empresa !== fe) return false;
    if (fcom && (p.Comercial || '').trim() !== fcom) return false;
    if (fc && (p.Cliente || '').toLowerCase().indexOf(fc.toLowerCase()) < 0) return false;
    if (fs && norm(p.Estado_Entrega || 'Recibido') !== norm(fs)) return false;
    if (fs2 && (p.Estado_2 || 'Abierto').trim() !== fs2) return false;
    if (ft) {
      var hay = [p.Cliente, String(p.Consecutivo), getSigla(p.Nombre_Empresa), p.Comercial, p.Producto].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });

  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var lines = ['Empresa,Cliente,Consecutivo,Fecha_Pedido,Producto,Presentacion,Cant_Pedida,Pendiente,Estado,Estado_2'];
  rows.forEach(function(p) {
    lines.push([
      '"' + getSigla(p.Nombre_Empresa) + '"',
      '"' + (p.Cliente||'').replace(/"/g,'""') + '"',
      '"' + (p.Consecutivo||'') + '"',
      '"' + fmtDate(p.Fecha_Pedido) + '"',
      '"' + (p.Producto||'').replace(/"/g,'""') + '"',
      '"' + (p.Presentacion||'').replace(/"/g,'""') + '"',
      Number(p.Cantidad)||0,
      Number(p.Cant_Pendiente)||0,
      '"' + (p.Estado_Entrega||'Recibido') + '"',
      '"' + (p.Estado_2||'Abierto') + '"'
    ].join(','));
  });

  var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'detalle_pedidos_' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado: ' + rows.length + ' líneas');
}

// ── Export órdenes a Excel ──
function exportOrdenesExcel() {
  var rows = applySort(filtered());
  if (!rows.length) { showToast('No hay órdenes para exportar', '#e74c3c'); return; }

  var data = rows.map(function(c) {
    var lines = getLinesFor(c);
    var est = derivedStatus(lines);
    var est2 = derivedEstado2(lines);
    var pct = derivedPct(lines);
    return {
      'Empresa': getSigla(c.Nombre_Empresa),
      'Consecutivo': c.Consecutivo || '',
      'Cliente': c.Cliente || '',
      'NIT': c.NIT || '',
      'Fecha Pedido': c.Fecha_Pedido ? new Date(c.Fecha_Pedido) : '',
      'Comercial': c.Comercial || '',
      'Municipio': c.Municipio || '',
      'Departamento': c.Departamento || '',
      'Productos': lines.length,
      'Total Orden': Number(c.Total_Orden) || 0,
      'Avance %': pct,
      'Estado': est,
      'Estado 2': est2
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  var colWidths = [
    {wch:12},{wch:12},{wch:28},{wch:16},{wch:12},{wch:18},{wch:16},{wch:16},{wch:10},{wch:14},{wch:10},{wch:12},{wch:10}
  ];
  ws['!cols'] = colWidths;
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
  XLSX.writeFile(wb, 'Pedidos_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' órdenes', '#27ae60');
}

// ── PDF Export ──
function closeRemPicker() {
  var el = document.getElementById('rem-picker');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  document.removeEventListener('mousedown', _remPickerOutside, true);
}
function _remPickerOutside(ev) {
  var picker = document.getElementById('rem-picker');
  var btn = document.getElementById('btn-export-rem');
  if (!picker) return;
  if (picker.contains(ev.target) || (btn && btn.contains(ev.target))) return;
  closeRemPicker();
}

function _buildRemisionesAgrupadas() {
  if (activeIdx == null) return [];
  var c = consecs[activeIdx];
  var lines = getLinesFor(c);
  var mapa = {};
  lines.forEach(function(l) {
    var vUni = Number(l.Valor_Unitario) || 0;
    var entregas = parseEntregas(l.Remisiones, Number(l.Cant_Entregada) || 0, l.Fecha_Ult_Entrega);
    entregas.forEach(function(e) {
      var numRem = (e.remision || '').trim();
      if (!numRem) return;
      var key = numRem + '|' + (e.fecha || '');
      if (!mapa[key]) mapa[key] = { remision: numRem, fecha: e.fecha || '', items: [], total: 0 };
      var cant = Number(e.cantidad) || 0;
      if (cant <= 0) return;
      var vt = cant * vUni;
      mapa[key].items.push({
        producto: l.Producto,
        presentacion: l.Presentacion,
        cantidad: cant,
        valor_unitario: vUni,
        valor_total: vt,
        bonificado: l.Bonificado || ''
      });
      mapa[key].total += vt;
    });
  });
  var arr = Object.keys(mapa).map(function(k) { return mapa[k]; })
    .filter(function(r) { return r.items.length > 0; });
  arr.sort(function(a, b) {
    if (a.fecha && b.fecha && a.fecha !== b.fecha) return a.fecha > b.fecha ? -1 : 1;
    return (a.remision || '').localeCompare(b.remision || '');
  });
  return arr;
}

function _exportarRemisionEspecifica(rem) {
  if (activeIdx == null) return;
  if (!rem || !rem.remision || !String(rem.remision).trim()) {
    showToast('La remisión debe tener número asignado para imprimirse.', '#e67e22');
    return;
  }
  var c = consecs[activeIdx];
  var obsEl = document.getElementById('m-observaciones');
  var lines = getLinesFor(c);
  var obsPed = (obsEl ? obsEl.value.trim() : '') || (lines[0] && lines[0].Observaciones) || c.Observaciones || '';
  generarRemisionPDF({
    empresa: c.Nombre_Empresa,
    consecutivo: c.Consecutivo,
    fecha_pedido: c.Fecha_Pedido,
    cliente: document.getElementById('md-cliente').value.trim() || c.Cliente,
    nit: document.getElementById('md-nit').value.trim() || c.NIT,
    telefono: document.getElementById('md-telefono').value.trim() || c.Telefono,
    comercial: document.getElementById('md-comercial').value.trim() || c.Comercial,
    municipio: document.getElementById('md-municipio').value.trim() || c.Municipio,
    departamento: document.getElementById('md-departamento').value.trim() || c.Departamento,
    direccion: c.Direccion_Envio || '',
    plazo: document.getElementById('md-plazo').value.trim() || c.Plazo_Pago || '',
    precio: document.getElementById('md-precio').value.trim() || c.Precio_Facturacion || '',
    consignacion: (document.getElementById('md-consignacion') && document.getElementById('md-consignacion').value) || c.Consignacion || 'No',
    facturar_a: document.getElementById('md-facturar-a') ? (document.getElementById('md-facturar-a').value.trim() || c.Facturar_A || '') : (c.Facturar_A || ''),
    nit_adicional: document.getElementById('md-nit-adicional') ? (document.getElementById('md-nit-adicional').value.trim() || c.NIT_Adicional || '') : (c.NIT_Adicional || ''),
    observaciones: obsPed,
    remision: rem.remision,
    fecha_entrega: rem.fecha,
    entregas: rem.items,
    total: rem.total
  });
}

function exportarRemisionDesdeModal(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  var remisiones = _buildRemisionesAgrupadas();
  if (!remisiones.length) {
    showToast('No hay remisiones con número asignado para imprimir.', '#e67e22');
    return;
  }
  if (remisiones.length === 1) {
    _exportarRemisionEspecifica(remisiones[0]);
    return;
  }
  var picker = document.getElementById('rem-picker');
  if (!picker) { _exportarRemisionEspecifica(remisiones[0]); return; }
  if (picker.style.display === 'block') { closeRemPicker(); return; }
  var html = '<div style="padding:8px 12px;font-size:0.75rem;font-weight:700;color:#4a5568;background:#f7fafc;border-bottom:1px solid #e2e8f0">Seleccionar remisión</div>';
  remisiones.forEach(function(r, i) {
    var label = (r.remision || '(sin número)');
    var meta = (r.fecha ? r.fecha + ' · ' : '') + r.items.length + ' producto' + (r.items.length === 1 ? '' : 's');
    html += '<div data-idx="' + i + '" class="rem-picker-item" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #edf2f7;font-size:0.82rem">' +
      '<div style="font-weight:700;color:#1a5276">' + label.replace(/</g, '&lt;') + '</div>' +
      '<div style="font-size:0.72rem;color:#718096;margin-top:2px">' + meta + '</div>' +
      '</div>';
  });
  picker.innerHTML = html;
  picker.style.display = 'block';
  picker.querySelectorAll('.rem-picker-item').forEach(function(el) {
    el.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
    el.addEventListener('mouseout', function() { this.style.background = 'white'; });
    el.addEventListener('click', function() {
      var idx = Number(this.getAttribute('data-idx'));
      closeRemPicker();
      _exportarRemisionEspecifica(remisiones[idx]);
    });
  });
  setTimeout(function() {
    document.addEventListener('mousedown', _remPickerOutside, true);
  }, 0);
}

function exportarPedidoDesdeModal() {
  if (activeIdx == null) return;
  var c = consecs[activeIdx];
  var lines = getLinesFor(c);
  var obsText = document.getElementById('m-observaciones').value.trim();
  var archivo = lines.length ? (lines[0].Archivo_Fuente || '') : '';
  generarPedidoPDF({
    empresa: c.Nombre_Empresa,
    consecutivo: c.Consecutivo,
    fecha: c.Fecha_Pedido,
    cliente: document.getElementById('md-cliente').value.trim() || c.Cliente,
    nit: document.getElementById('md-nit').value.trim() || c.NIT,
    telefono: document.getElementById('md-telefono').value.trim() || c.Telefono,
    direccion: c.Direccion_Envio,
    municipio: document.getElementById('md-municipio').value.trim() || c.Municipio,
    departamento: document.getElementById('md-departamento').value.trim() || c.Departamento,
    comercial: document.getElementById('md-comercial').value.trim() || c.Comercial,
    plazo: document.getElementById('md-plazo').value.trim() || c.Plazo_Pago,
    precio: document.getElementById('md-precio').value.trim() || c.Precio_Facturacion,
    facturar_a: document.getElementById('md-facturar-a').value.trim() || c.Facturar_A || c.Cliente,
    nit_adicional: document.getElementById('md-nit-adicional').value.trim() || c.NIT_Adicional,
    consignacion: document.getElementById('md-consignacion').value || c.Consignacion || 'No',
    observaciones: obsText,
    total: c.Total_Orden,
    productos: lines.map(function(l) {
      return {
        producto: l.Producto,
        presentacion: l.Presentacion,
        cantidad: l.Cantidad,
        valor_unitario: l.Valor_Unitario,
        valor_total: l.Valor_Total,
        bonificado: l.Bonificado
      };
    }),
    archivo: archivo
  });
}

var _pdfLogos = { PARCELAR: null, IASO: null, RESO: null };
(function _preloadPdfLogos() {
  if (typeof document === 'undefined') return;
  var sources = { PARCELAR: 'assets/logo_parcelar.png', IASO: 'assets/logo_iaso.png', RESO: 'assets/logo_reso.png' };
  Object.keys(sources).forEach(function(key) {
    var img = new Image();
    img.onload = function() {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        _pdfLogos[key] = { data: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
      } catch (e) { _pdfLogos[key] = null; }
    };
    img.onerror = function() { _pdfLogos[key] = null; };
    img.src = sources[key];
  });
})();

function _pdfHeaderLogoFor(empresa) {
  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  return _pdfLogos[String(sigla).toUpperCase()] || null;
}

var _pdfRemisionHeaderInfo = {
  IASO: [
    'INSUMOS AGROPECUARIOS SOSTENIBLES S.A.S',
    'NIT: 901-924.101-1',
    'Av. Troncal de Occidente #11E-03E, Mosquera,',
    'Cundinamarca - Parque Agroindustrial de la Sabana',
    'Cel 3106716741  ·  Correo: inagrosostenible.sas@gmail.com'
  ]
};

function _pdfRemisionHeaderInfoFor(empresa) {
  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  return _pdfRemisionHeaderInfo[String(sigla).toUpperCase()] || null;
}

function _pdfPaletteFor(empresa) {
  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  sigla = String(sigla).toUpperCase();
  if (sigla === 'PARCELAR') return { accent: [30, 107, 63], light: [220, 235, 225] };
  if (sigla === 'RESO')     return { accent: [26, 55, 100],  light: [219, 229, 245] };
  return { accent: [39, 174, 96], light: [212, 239, 223] };
}

function _drawRemisionCopyFooter(doc, label, palette) {
  var pw = doc.internal.pageSize.getWidth();
  var ph = doc.internal.pageSize.getHeight();
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(palette.accent[0], palette.accent[1], palette.accent[2]);
  doc.text(String(label), pw / 2, ph - 5, { align: 'center' });
}

function generarRemisionPDF(data) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF();
  var palette = _pdfPaletteFor(data.empresa);
  var copias = ['ORIGINAL - LOGISTICA', 'COPIA - CONTABILIDAD', 'CLIENTE', 'COPIA - LOGISTICA'];
  copias.forEach(function(label, idx) {
    if (idx > 0) doc.addPage();
    var startPage = doc.internal.getNumberOfPages();
    _drawRemisionCopy(doc, data, palette);
    var endPage = doc.internal.getNumberOfPages();
    for (var p = startPage; p <= endPage; p++) {
      doc.setPage(p);
      _drawRemisionCopyFooter(doc, label, palette);
    }
  });
  var sigla = (typeof getSigla === 'function' ? getSigla(data.empresa) : '') || 'Remision';
  var fileName = 'Remision_' + sigla + '_' + (data.consecutivo || '') + (data.remision ? '_' + String(data.remision) : '') + '.pdf';
  doc.save(fileName);
}

function _drawRemisionCopy(doc, data, palette) {
  var pw = doc.internal.pageSize.getWidth();
  var accent = palette.accent;
  var totalFill = palette.light;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];

  var headerInfo = _pdfRemisionHeaderInfoFor(data.empresa);
  var headerH = headerInfo ? 48 : 30;

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pw, headerH, 'F');
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(1.2);
  doc.line(0, headerH, pw, headerH);

  var logo = _pdfHeaderLogoFor(data.empresa);
  var titleX = 14;
  if (logo) {
    try {
      doc.addImage(logo.data, 'PNG', 5, 4, 22, 22);
      titleX = 34;
    } catch (e) {}
  }

  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('REMISION' + (data.remision ? '  N° ' + String(data.remision) : ''), titleX, 13);
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.text(String(data.empresa || ''), titleX, 21);
  doc.setFontSize(9);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFont(undefined, 'bold');
  doc.text('Pedido #' + String(data.consecutivo || ''), pw - 14, 13, { align: 'right' });
  doc.text('Fecha remision: ' + String(data.fecha_entrega || ''), pw - 14, 21, { align: 'right' });
  doc.setFont(undefined, 'normal');

  if (headerInfo) {
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(120, 132, 150);
    var infoStartY = 30;
    var infoLineH = 3.4;
    headerInfo.forEach(function(line, i) {
      var bold = i === 0;
      if (bold) doc.setFont(undefined, 'bold');
      doc.text(String(line), pw - 14, infoStartY + i * infoLineH, { align: 'right' });
      if (bold) doc.setFont(undefined, 'normal');
    });
  }

  var y = headerH + 10;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(9);

  var consignVal = (data.consignacion === 'Sí' || data.consignacion === 'Si') ? 'Sí' : 'No';
  var left = [
    ['Cliente', data.cliente || ''],
    ['NIT', data.nit || ''],
    ['Facturar a', data.facturar_a || ''],
    ['NIT Adicional', data.nit_adicional || ''],
    ['Telefono', data.telefono || ''],
    ['Municipio', data.municipio || ''],
    ['Departamento', data.departamento || ''],
  ];
  var right = [
    ['Comercial', data.comercial || ''],
    ['Plazo de Pago', data.plazo || ''],
    ['Precio Facturacion', data.precio || ''],
    ['Direccion', data.direccion || ''],
    ['Consignacion', consignVal],
    ['Fecha pedido', data.fecha_pedido || ''],
  ];

  var totalW = pw - 28;
  var leftBlockW = totalW * 0.58;
  var leftValX = 14 + 34;
  var rightLabelX = 14 + leftBlockW + 4;
  var rightValX = rightLabelX + 34;
  var leftValMaxW = (14 + leftBlockW) - leftValX - 4;
  var rightValMaxW = pw - 14 - rightValX;
  var maxF = Math.max(left.length, right.length);
  var infoTop = y - 5;
  var midX = 14 + leftBlockW;
  var rowGap = 9;
  for (var fi = 0; fi < maxF; fi++) {
    var rowH = 0;
    if (fi < left.length) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text(left[fi][0] + ':', 16, y);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      var lVal = String(left[fi][1] || '');
      var lLines = lVal ? doc.splitTextToSize(lVal, leftValMaxW) : [''];
      doc.text(lLines, leftValX, y);
      rowH = Math.max(rowH, (lLines.length - 1) * 4);
    }
    if (fi < right.length) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text(right[fi][0] + ':', rightLabelX + 2, y);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      var rVal = String(right[fi][1] || '');
      var rLines = rVal ? doc.splitTextToSize(rVal, rightValMaxW) : [''];
      doc.text(rLines, rightValX, y);
      rowH = Math.max(rowH, (rLines.length - 1) * 4);
    }
    y += rowGap + rowH;
    if (fi < maxF - 1) {
      doc.setDrawColor(200, 210, 220);
      doc.setLineWidth(0.2);
      doc.line(14, y - 4, pw - 14, y - 4);
    }
  }
  var infoBottom = y - 4;
  doc.setDrawColor(140, 155, 175);
  doc.setLineWidth(0.4);
  doc.rect(14, infoTop, pw - 28, infoBottom - infoTop);
  doc.setLineWidth(0.2);
  doc.setDrawColor(200, 210, 220);
  doc.line(midX, infoTop, midX, infoBottom);

  y += 3;
  var obsText = String(data.observaciones || '');
  var obsMaxW = pw - 28 - 48;
  var obsLines = obsText ? doc.splitTextToSize(obsText, obsMaxW) : [''];
  var obsH = Math.max(14, obsLines.length * 4 + 8);
  doc.setFillColor(254, 249, 231);
  doc.roundedRect(14, y - 4, pw - 28, obsH, 2, 2, 'F');
  doc.setFont(undefined, 'bold');
  doc.setTextColor(125, 102, 8);
  doc.text('Observaciones:', 18, y + 1);
  doc.setFont(undefined, 'normal');
  doc.text(obsLines, 62, y + 1);
  y += obsH;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);

  y += 4;

  var tableBody = (data.entregas || []).map(function(p, i) {
    var vUnit = Number(p.valor_unitario) || 0;
    var textoTieneBonif = /bonificado/i.test(String(p.producto || ''));
    var esBonif = (p.bonificado || '') === 'Si' || (p.bonificado || '') === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
    return [
      i + 1,
      String(p.producto || ''),
      String(p.presentacion || ''),
      Number(p.cantidad) || 0,
      esBonif ? 'Sí' : 'No'
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['#', 'Producto', 'Presentacion', 'Cant. Entregada', 'Bonif.']],
    body: tableBody,
    theme: 'grid',
    headStyles: { fillColor: accent, fontSize: 8, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35 },
    bodyStyles: { fontSize: 8, lineColor: [90, 90, 90], lineWidth: 0.3 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { cellWidth: 90 },
      2: { cellWidth: 36 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'center', cellWidth: 16 }
    },
    margin: { left: 14, right: 14 },
    styles: { cellPadding: 3, lineColor: [90, 90, 90], lineWidth: 0.3 },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.5
  });

  var finalY = doc.lastAutoTable.finalY + 10;

  var ph = doc.internal.pageSize.getHeight();
  var sigTop = finalY + 22;
  var footerReserve = 12;
  var minSigTop = ph - 60;
  if (sigTop < minSigTop) sigTop = minSigTop;
  if (sigTop > ph - 42) {
    doc.addPage();
    sigTop = 40;
  }

  var sigGap = 5;
  var sigCount = 4;
  var sigW = (pw - 28 - sigGap * (sigCount - 1)) / sigCount;
  var lineY = sigTop + 18;
  var labelY = lineY + 5;
  var subY = labelY + 5;
  var cols = [
    { x: 14, label: 'Emitido por', sub: 'Nombre y firma' },
    { x: 14 + (sigW + sigGap), label: 'Despachado / Conductor', sub: 'Nombre y firma' },
    { x: 14 + (sigW + sigGap) * 2, label: 'Contabilidad', sub: 'Nombre y firma' },
    { x: 14 + (sigW + sigGap) * 3, label: 'Recibido por el cliente', sub: 'Nombre, firma y fecha' }
  ];
  doc.setDrawColor(darkText[0], darkText[1], darkText[2]);
  doc.setLineWidth(0.3);
  doc.setFontSize(8);
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  cols.forEach(function(c) {
    doc.line(c.x, lineY, c.x + sigW, lineY);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(7.5);
    doc.text(c.label, c.x + sigW / 2, labelY, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text(c.sub, c.x + sigW / 2, subY, { align: 'center' });
    doc.setFontSize(8);
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  });
  var recCol = cols[cols.length - 1];
  var fechaRecY = subY + 6;
  var fechaLabelX = recCol.x + 2;
  var fechaLineX1 = fechaLabelX + 26;
  var fechaLineX2 = recCol.x + sigW - 2;
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.text('Fecha de entrega:', fechaLabelX, fechaRecY);
  doc.setDrawColor(160, 174, 192);
  doc.line(fechaLineX1, fechaRecY + 0.5, fechaLineX2, fechaRecY + 0.5);

  var genY = sigTop + 42;
  if (genY > ph - 8) genY = ph - 8;
  doc.setFontSize(7);
  doc.setTextColor(grayText[0], grayText[1], grayText[2]);
  doc.setFont(undefined, 'normal');
  doc.text('Generado: ' + new Date().toLocaleString('es-CO'), 14, genY);
}

function generarPedidoPDF(data) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF();
  var pw = doc.internal.pageSize.getWidth();

  var palette = _pdfPaletteFor(data.empresa);
  var primary = palette.accent;
  var totalFill = palette.light;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pw, 30, 'F');
  doc.setDrawColor(primary[0], primary[1], primary[2]);
  doc.setLineWidth(1.2);
  doc.line(0, 30, pw, 30);

  var logoP = _pdfHeaderLogoFor(data.empresa);
  var titleXP = 14;
  if (logoP) {
    try {
      doc.addImage(logoP.data, 'PNG', 5, 4, 22, 22);
      titleXP = 34;
    } catch (e) {}
  }

  doc.setTextColor(primary[0], primary[1], primary[2]);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('PEDIDO #' + String(data.consecutivo || ''), titleXP, 13);
  doc.setFontSize(9);
  doc.text('Fecha: ' + String(data.fecha || ''), pw - 14, 13, { align: 'right' });

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  var empresaText = String(data.empresa || '');
  var empresaMaxW = (pw - 14) - titleXP;
  var empresaFit = doc.splitTextToSize(empresaText, empresaMaxW);
  var empresaOneLine = empresaFit[0] + (empresaFit.length > 1 ? '…' : '');
  doc.text(empresaOneLine, titleXP, 21);

  if (data.archivo) {
    doc.setFontSize(6.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    var archivoText = String(data.archivo);
    var archivoMaxW = pw - 14 - titleXP;
    var archivoFit = doc.splitTextToSize(archivoText, archivoMaxW);
    doc.text(archivoFit[0] + (archivoFit.length > 1 ? '…' : ''), pw - 14, 26, { align: 'right' });
  }

  var y = 40;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(9);

  var left = [
    ['Cliente', data.cliente],
    ['NIT', data.nit],
    ['Facturar a', data.facturar_a && data.facturar_a !== data.cliente ? data.facturar_a : null],
    ['NIT Adicional', data.nit_adicional],
    ['Teléfono', data.telefono],
    ['Municipio', data.municipio],
    ['Departamento', data.departamento],
  ];
  var right = [
    ['Comercial', data.comercial],
    ['Plazo de Pago', data.plazo],
    ['Precio Facturación', data.precio],
    ['Dirección', data.direccion],
    ['Consignación', data.consignacion === 'Sí' ? 'Sí' : null],
  ];

  var totalW = pw - 28;
  var leftBlockW = totalW * 0.58;
  var leftValX = 14 + 34;
  var rightLabelX = 14 + leftBlockW + 4;
  var rightValX = rightLabelX + 34;
  var leftValMaxW = (14 + leftBlockW) - leftValX - 4;
  var rightValMaxW = pw - 14 - rightValX;
  var maxF = Math.max(left.length, right.length);
  var infoTop = y - 5;
  var midX = 14 + leftBlockW;
  var rowGap = 9;
  for (var fi = 0; fi < maxF; fi++) {
    var rowH = 0;
    if (fi < left.length && left[fi][1]) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(primary[0], primary[1], primary[2]);
      doc.text(left[fi][0] + ':', 16, y);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      var lLines = doc.splitTextToSize(String(left[fi][1]), leftValMaxW);
      doc.text(lLines, leftValX, y);
      rowH = Math.max(rowH, (lLines.length - 1) * 4);
    }
    if (fi < right.length && right[fi][1]) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(primary[0], primary[1], primary[2]);
      doc.text(right[fi][0] + ':', rightLabelX + 2, y);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(darkText[0], darkText[1], darkText[2]);
      var rLines = doc.splitTextToSize(String(right[fi][1]), rightValMaxW);
      doc.text(rLines, rightValX, y);
      rowH = Math.max(rowH, (rLines.length - 1) * 4);
    }
    y += rowGap + rowH;
    if (fi < maxF - 1) {
      doc.setDrawColor(200, 210, 220);
      doc.setLineWidth(0.2);
      doc.line(14, y - 4, pw - 14, y - 4);
    }
  }
  var infoBottom = y - 4;
  doc.setDrawColor(140, 155, 175);
  doc.setLineWidth(0.4);
  doc.rect(14, infoTop, pw - 28, infoBottom - infoTop);
  doc.setLineWidth(0.2);
  doc.setDrawColor(200, 210, 220);
  doc.line(midX, infoTop, midX, infoBottom);

  if (data.observaciones) {
    y += 3;
    doc.setFont(undefined, 'normal');
    var obsMaxW = pw - 28 - 48;
    var obsLines = doc.splitTextToSize(String(data.observaciones), obsMaxW);
    var obsH = Math.max(14, obsLines.length * 4 + 8);
    doc.setFillColor(254, 249, 231);
    doc.roundedRect(14, y - 4, pw - 28, obsH, 2, 2, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(125, 102, 8);
    doc.text('Observaciones:', 18, y + 1);
    doc.setFont(undefined, 'normal');
    doc.text(obsLines, 62, y + 1);
    y += obsH;
  }

  y += 4;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);

  var tableBody = (data.productos || []).map(function(p, i) {
    var vUnit = Number(p.valor_unitario) || 0;
    var textoTieneBonif = /bonificado/i.test(String(p.producto || ''));
    var esBonif = (p.bonificado || '').trim() === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
    return [
      i + 1,
      String(p.producto || ''),
      String(p.presentacion || ''),
      Number(p.cantidad) || 0,
      fmtMoney(p.valor_unitario),
      fmtMoney(p.valor_total),
      esBonif ? 'Sí' : 'No'
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['#', 'Producto', 'Presentación', 'Cantidad', 'Val. Unitario', 'Val. Total', 'Bonif.']],
    body: tableBody,
    theme: 'grid',
    headStyles: { fillColor: primary, fontSize: 8, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35 },
    bodyStyles: { fontSize: 8, lineColor: [90, 90, 90], lineWidth: 0.3 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 55 },
      3: { halign: 'right', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 26 },
      5: { halign: 'right', cellWidth: 26 },
      6: { halign: 'center', cellWidth: 14 }
    },
    margin: { left: 14, right: 14 },
    styles: { cellPadding: 3, lineColor: [90, 90, 90], lineWidth: 0.3 },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.5
  });

  var finalY = doc.lastAutoTable.finalY + 10;
  doc.setFillColor(totalFill[0], totalFill[1], totalFill[2]);
  doc.roundedRect(pw - 82, finalY - 5, 68, 14, 3, 3, 'F');
  doc.setFontSize(11);
  doc.setTextColor(primary[0], primary[1], primary[2]);
  doc.setFont(undefined, 'bold');
  doc.text('Total: ' + fmtMoney(data.total), pw - 16, finalY + 4, { align: 'right' });

  finalY += 20;
  doc.setFontSize(7);
  doc.setTextColor(grayText[0], grayText[1], grayText[2]);
  doc.setFont(undefined, 'normal');
  doc.text('Generado: ' + new Date().toLocaleString('es-CO'), 14, finalY);

  var sigla = getSigla(data.empresa) || 'Pedido';
  doc.save('Pedido_' + sigla + '_' + (data.consecutivo || 'nuevo') + '.pdf');
}

// ── Adjuntos (Supabase Storage) ──
var ADJUNTOS_BUCKET = 'pedidos-adjuntos';
var adjuntosCache = {};
var adjuntosIndex = {};

async function loadAdjuntosIndex() {
  adjuntosIndex = {};
  var siglas = EMPRESAS_HOLDING.map(function(e) { return e.sigla; });
  var promises = siglas.map(function(sigla) {
    return _sb.storage.from(ADJUNTOS_BUCKET).list(sigla, { limit: 1000 }).then(function(res) {
      var folders = (res.data || []).filter(function(f) { return f.name && !f.id; });
      folders.forEach(function(f) {
        adjuntosIndex[sigla + '_' + f.name] = true;
      });
    }).catch(function() {});
  });
  await Promise.all(promises);
  updateAdjuntosBadges();
}


function updateAdjuntosBadges() {
  var badges = document.querySelectorAll('.adjunto-badge-cell');
  badges.forEach(function(el) {
    var key = el.getAttribute('data-adj-key');
    if (key && adjuntosIndex[key]) {
      el.innerHTML = ' <span title="Tiene archivos adjuntos" style="cursor:help;font-size:0.85rem">📎</span>';
    }
  });
}

function sanitizeForPath(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
}

function adjuntoFolder(empresa, consecutivo, cliente) {
  var emp = getSigla(empresa).replace(/[^a-zA-Z0-9_-]/g, '_');
  return emp + '/' + consecutivo + '_' + sanitizeForPath(cliente);
}

function adjuntoPath(empresa, consecutivo, cliente, filename) {
  return adjuntoFolder(empresa, consecutivo, cliente) + '/' + filename;
}

function adjuntoKey(empresa, consecutivo, cliente) {
  return getSigla(empresa) + '_' + consecutivo + '_' + sanitizeForPath(cliente);
}

async function loadAdjuntos(empresa, consecutivo, cliente) {
  var listEl = document.getElementById('adjuntos-list');
  var countEl = document.getElementById('adjuntos-count');
  listEl.innerHTML = '<div class="adjuntos-loading">Cargando adjuntos...</div>';

  var folder = adjuntoFolder(empresa, consecutivo, cliente);
  var res2 = await _sb.storage.from(ADJUNTOS_BUCKET).list(folder, { limit: 50 });

  var files = (res2.data || []).filter(function(f) { return f.name && f.id; });
  var key = adjuntoKey(empresa, consecutivo, cliente);
  adjuntosCache[key] = files;

  if (!files.length) {
    listEl.innerHTML = '<div class="adjuntos-empty">Sin archivos adjuntos</div>';
    countEl.textContent = '';
    return;
  }

  countEl.textContent = '(' + files.length + ')';
  listEl.innerHTML = files.map(function(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var icon = ext === 'pdf' ? '📄' : '🖼️';
    var size = f.metadata && f.metadata.size ? formatFileSize(f.metadata.size) : '';
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
        '<button class="btn-adj-ver" onclick="previewAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + ext + '\')">👁 Ver</button>' +
        '<button class="btn-adj-ver" onclick="downloadAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + nameEsc.replace(/'/g, "\\'") + '\')">⬇ Descargar</button>' +
        (AUTH.canEdit() ? '<button class="btn-adj-del" onclick="deleteAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\')">🗑️</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function handleAdjuntoUpload(input) {
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

  if (activeIdx === null) return;
  var c = consecs[activeIdx];
  var empresa = c.Nombre_Empresa;
  var consecutivo = c.Consecutivo;
  var cliente = c.Cliente;

  var timestamp = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var finalName = timestamp + '_' + safeName;
  var path = adjuntoPath(empresa, consecutivo, cliente, finalName);

  var progWrap = document.getElementById('adjunto-progress');
  var progFill = document.getElementById('adjunto-prog-fill');
  var progText = document.getElementById('adjunto-prog-text');
  progWrap.style.display = 'block';
  progFill.style.width = '30%';
  progText.textContent = 'Subiendo ' + file.name + '...';

  var res = await _sb.storage.from(ADJUNTOS_BUCKET).upload(path, file, {
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
  adjuntosIndex[adjuntoKey(empresa, consecutivo, cliente)] = true;
  updateAdjuntosBadges();
  await loadAdjuntos(empresa, consecutivo, cliente);
}

async function previewAdjunto(path, ext) {
  var res = _sb.storage.from(ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
    url = signed.data && signed.data.signedUrl;
  }
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }

  var contentEl = document.getElementById('adjunto-preview-content');
  if (ext === 'pdf') {
    contentEl.innerHTML = '<iframe src="' + url + '"></iframe>';
  } else {
    contentEl.innerHTML = '<img src="' + url + '" alt="Preview">';
  }
  document.getElementById('adjunto-preview-overlay').classList.add('show');
}

function closeAdjuntoPreview() {
  document.getElementById('adjunto-preview-overlay').classList.remove('show');
  document.getElementById('adjunto-preview-content').innerHTML = '';
}

async function downloadAdjunto(path, filename) {
  var res = _sb.storage.from(ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
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

async function deleteAdjunto(path) {
  if (!confirm('¿Eliminar este archivo adjunto?')) return;
  var res = await _sb.storage.from(ADJUNTOS_BUCKET).remove([path]);
  if (res.error) {
    showToast('Error al eliminar: ' + res.error.message, '#e74c3c');
    return;
  }
  showToast('Archivo eliminado', '#e67e22');
  if (activeIdx !== null) {
    var c = consecs[activeIdx];
    await loadAdjuntos(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
  }
}

// Drag & drop
(function() {
  var dz = document.getElementById('adjunto-dropzone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var input = document.getElementById('adjunto-input');
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleAdjuntoUpload(input);
  });
})();

// ── Auto-load on page open ──
loadFromAPI();
