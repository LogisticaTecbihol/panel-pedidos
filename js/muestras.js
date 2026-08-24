// ── Solicitud de Muestras ──

// Resuelve el nombre del Responsable contra el directorio de usuarios y
// devuelve el uuid a guardar en responsable_id (usado por la RLS para que
// un usuario con rol=comercial vea sólo sus propias solicitudes).
// Primero matchea por nombre (que es lo que se escribe en Responsable);
// si no hay match, cae por comercial_codigo.
async function _resolveResponsableId(valor) {
  var v = String(valor || '').trim();
  if (!v) return null;
  var vLow = v.toLowerCase();
  if (typeof AUTH !== 'undefined' && AUTH.isComercial && AUTH.isComercial()) {
    var uSelf = AUTH.getUser();
    return uSelf ? uSelf.id : null;
  }
  if (typeof NOTIF === 'undefined' || !NOTIF.getDirectorio) return null;
  try {
    var dir = await NOTIF.getDirectorio();
    var activos = (dir || []).filter(function(x) { return x.activo; });
    var byName = activos.filter(function(x) {
      return String(x.nombre || '').trim().toLowerCase() === vLow;
    })[0];
    if (byName) return byName.id;
    var byCod = activos.filter(function(x) {
      var codes = x.codigos_comercial || [];
      for (var j = 0; j < codes.length; j++) {
        if (String(codes[j].codigo || '').trim().toLowerCase() === vLow) return true;
      }
      return String(x.comercial_codigo || '').trim().toLowerCase() === vLow;
    })[0];
    return byCod ? byCod.id : null;
  } catch (e) { return null; }
}

var allMuestras = [];
var filteredMu = [];
var muSortCols = [
  { key: 'Fecha_Solicitud', dir: 'desc' }
];
var muEditId = null;
var muDeleteIds = [];
var muLines = [{ producto: '', presentacion: '', cantidad: 0 }];
var productosCache = null;
var muProdACs = [];
var muEditProdAC = null;
var muGeoAC = null;
var muViewingId = null;
var muViewNewLines = [];
var muViewProdACs = [];
var muViewWorkingLines = [];
var muViewEmpresa = '';
var muAsig = null;
var ocsLegalizadasPorMuestra = {};

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
  { key: 'Estado_Aprobacion', label: 'Aprobación', sortable: true },
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

  var results = await Promise.all([
    apiGet('getMuestras'),
    apiGet('getOrdenesCompra', {
      columns: 'id,Consecutivo,Tipo,Estado,Remision,Remision_Origen,Empresa_Origen,Empresa_Destino,Producto,Presentacion,Cantidad,Valor_Unitario,Valor_Total,Fecha,Ref_Pedido'
    }).catch(function() { return { ok: true, ordenes: [] }; })
  ]);
  var res = results[0];
  var ocData = results[1];
  if (!res.ok) {
    loadErr.textContent = res.error || 'Error al cargar';
    loadErr.style.display = 'block';
    btnRetry.style.display = 'inline-block';
    return;
  }

  allMuestras = res.muestras || [];
  ocsLegalizadasPorMuestra = _buildOCsLegalizadasMu((ocData && ocData.ok && ocData.ordenes) || []);
  loadZone.style.display = 'none';
  main.style.display = 'block';
  populateMuFilters();
  applyMuFilters();
}

function _buildOCsLegalizadasMu(ordenes) {
  var map = {};
  (ordenes || []).forEach(function(oc) {
    if (String(oc.Tipo || '').toLowerCase() !== 'traslado') return;
    var remDest = String(oc.Remision || '').trim();
    var remOrig = String(oc.Remision_Origen || '').trim();
    if (!remDest && !remOrig) return;
    var ref = String(oc.Ref_Pedido || '').trim();
    var m = ref.match(/^(.+)\s+Muestra\s+#(.+)$/i);
    if (!m) return;
    var k = m[1].trim() + '||' + m[2].trim();
    var consec = String(oc.Consecutivo || '');
    if (!map[k]) map[k] = {};
    if (!map[k][consec]) map[k][consec] = [];
    map[k][consec].push(oc);
  });
  var result = {};
  Object.keys(map).forEach(function(k) {
    result[k] = Object.keys(map[k]).map(function(c) { return map[k][c]; });
  });
  return result;
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
  var fApr = document.getElementById('f-aprobacion').value;
  var fTxt = document.getElementById('f-txt').value.toLowerCase().trim();

  filteredMu = allMuestras.filter(function(r) {
    if (fResp && r.Responsable !== fResp) return false;
    if (fMun && r.Municipio !== fMun) return false;
    if (fEst && r.Estado !== fEst) return false;
    if (fApr && (r.Estado_Aprobacion || 'Por aprobar') !== fApr) return false;
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
  renderDetalleMu();
  updateMuStats();
}

function clearMuestraFilters() {
  document.getElementById('f-responsable').value = '';
  document.getElementById('f-municipio').value = '';
  document.getElementById('f-estado').value = '';
  document.getElementById('f-aprobacion').value = '';
  document.getElementById('f-txt').value = '';
  applyMuFilters();
}

document.getElementById('f-responsable').addEventListener('change', applyMuFilters);
document.getElementById('f-municipio').addEventListener('change', applyMuFilters);
document.getElementById('f-estado').addEventListener('change', applyMuFilters);
document.getElementById('f-aprobacion').addEventListener('change', applyMuFilters);
document.getElementById('f-txt').addEventListener('input', applyMuFilters);

// ── Stats ──

function updateMuStats() {
  var allGrouped = groupMuestras(allMuestras);
  var despachadas = 0;
  var pendientes = 0;
  var porAprobar = 0;
  var totalProd = 0;
  allGrouped.forEach(function(r) {
    if ((r.Estado_Aprobacion || 'Por aprobar') === 'Por aprobar') porAprobar++;
    if (r.Estado === 'Despachada') despachadas++;
    else pendientes++;
  });
  allMuestras.forEach(function(r) { totalProd += Number(r.Cantidad) || 0; });
  document.getElementById('s-total').textContent = allGrouped.length;
  document.getElementById('s-por-aprobar').textContent = porAprobar;
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

    var apr = r.Estado_Aprobacion || 'Por aprobar';
    var aprBadge;
    if (apr === 'Aprobada') {
      aprBadge = '<span class="badge b-ent" title="' + escHtml(r.Aprobada_Por || '') + '">✅ Aprobada</span>';
    } else if (apr === 'Rechazada') {
      aprBadge = '<span class="badge b-anu" title="' + escHtml(r.Motivo_Rechazo || '') + '">❌ Rechazada</span>';
    } else {
      aprBadge = '<span class="badge b-par">⏳ Por aprobar</span>';
    }

    var sigla = EMPRESAS_SIGLA[r.Empresa] || r.Empresa || '—';
    var siglaCls = 'sigla-' + (EMPRESAS_SIGLA[r.Empresa] || 'DEFAULT');

    var canApr = AUTH.canApprove && AUTH.canApprove();
    var aprBtns = '';
    if (canApr && apr === 'Por aprobar') {
      var argsAR = "'" + escHtml((r.Empresa || '').replace(/'/g, "\\'")) + "','" + escHtml(String(r.Consecutivo || '').replace(/'/g, "\\'")) + "'";
      aprBtns =
        '<button class="btn-edit" style="background:#27ae60;color:white;border-color:#27ae60" title="Aprobar" onclick="approveMuestra(' + argsAR + ')">✅</button> ' +
        '<button class="btn-del" style="background:#e74c3c;color:white;border-color:#e74c3c" title="Rechazar" onclick="askRejectMuestra(' + argsAR + ')">❌</button> ';
    }

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
      '<td>' + aprBadge + '</td>' +
      '<td>' + estadoBadge + '</td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()">' +
        aprBtns +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="editMuestra(' + r.id + ')">✏️</button> ' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="deleteSolicitud(\'' + escHtml((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) + '\')">🗑️</button>' : '') +
      '</td></tr>';
  }).join('');
}

// ── View modal ──

async function viewMuestra(id) {
  var rows = allMuestras.filter(function(r) { return r.id === id; });
  if (!rows.length) return;
  var r = rows[0];

  muViewingId = id;
  var consec = r.Consecutivo || '';
  var emp = r.Empresa || '';
  var sameConsec = allMuestras.filter(function(x) { return x.Consecutivo === consec && consec && (x.Empresa || '') === emp; });

  var aprEstado = r.Estado_Aprobacion || 'Por aprobar';
  var aprIcon = aprEstado === 'Aprobada' ? '✅' : (aprEstado === 'Rechazada' ? '❌' : '⏳');
  document.getElementById('view-mu-meta').innerHTML =
    '<span>📋 Consecutivo: ' + (consec || '—') + '</span>' +
    '<span>📅 ' + fmtDate(r.Fecha_Solicitud) + '</span>' +
    '<span>👤 ' + (r.Responsable || '—') + '</span>' +
    '<span>' + aprIcon + ' ' + aprEstado + '</span>';

  var remVal = (r.Remision || '').replace(/"/g, '&quot;');
  var fDespachoVal = r.Fecha_Despacho ? toDateInput(r.Fecha_Despacho) : '';
  var editField = function(label, id, type, val, placeholder) {
    return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">' + label + '</span><br>' +
      '<input type="' + type + '" id="' + id + '" class="ef" value="' + val + '"' +
      (placeholder ? ' placeholder="' + placeholder + '"' : '') +
      ' style="padding:4px 8px;font-size:0.85rem;width:90%;margin-top:2px"></div>';
  };

  var canApr = AUTH.canApprove && AUTH.canApprove();
  var aprBoxColor = aprEstado === 'Aprobada' ? '#f0fdf4;border-color:#bbf7d0' :
                    aprEstado === 'Rechazada' ? '#fef2f2;border-color:#fecaca' :
                                                '#fffbeb;border-color:#fde68a';
  var aprBox = '<div style="background:' + aprBoxColor + ';border:1px solid;padding:12px 14px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<div style="font-size:0.85rem">' +
      '<div style="font-weight:700;color:#2d3748">' + aprIcon + ' Estado de aprobación: ' + aprEstado + '</div>';
  if (aprEstado === 'Aprobada') {
    aprBox += '<div style="font-size:0.78rem;color:#4a5568;margin-top:3px">Aprobada por <strong>' + escHtml(r.Aprobada_Por || '—') + '</strong>' +
              (r.Fecha_Aprobacion ? ' el ' + fmtDate(r.Fecha_Aprobacion) : '') + '</div>';
  } else if (aprEstado === 'Rechazada') {
    aprBox += '<div style="font-size:0.78rem;color:#4a5568;margin-top:3px">Rechazada por <strong>' + escHtml(r.Aprobada_Por || '—') + '</strong>' +
              (r.Fecha_Aprobacion ? ' el ' + fmtDate(r.Fecha_Aprobacion) : '') + '</div>';
    if (r.Motivo_Rechazo) {
      aprBox += '<div style="font-size:0.78rem;color:#c0392b;margin-top:3px"><strong>Motivo:</strong> ' + escHtml(r.Motivo_Rechazo) + '</div>';
    }
  } else {
    aprBox += '<div style="font-size:0.78rem;color:#92400e;margin-top:3px">Requiere aprobación de un administrador antes de despacharse.</div>';
  }
  aprBox += '</div>';
  if (canApr && aprEstado === 'Por aprobar') {
    var argsAR2 = "'" + escHtml((r.Empresa || '').replace(/'/g, "\\'")) + "','" + escHtml(String(consec || '').replace(/'/g, "\\'")) + "'";
    aprBox += '<div style="display:flex;gap:8px">' +
      '<button onclick="approveMuestra(' + argsAR2 + ',true)" style="background:#27ae60;color:white;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem;font-weight:700">✅ Aprobar</button>' +
      '<button onclick="askRejectMuestra(' + argsAR2 + ',true)" style="background:#e74c3c;color:white;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem;font-weight:700">❌ Rechazar</button>' +
      '</div>';
  }
  aprBox += '</div>';

  var html = aprBox +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem">' +
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
    editField('N° Remisión', 'mu-view-remision', 'text', remVal, '(Auto al despachar)') +
    (AUTH.canAutoConsec() ? '<label style="font-size:0.72rem;cursor:pointer;user-select:none;display:flex;align-items:center;gap:3px;margin-top:2px"><input type="checkbox" id="mu-view-remision-auto" checked onchange="var el=document.getElementById(\'mu-view-remision\');if(this.checked){el.readOnly=true;el.style.background=\'#f0f4f8\';el.placeholder=\'(Auto al despachar)\';el.value=\'\';}else{el.readOnly=false;el.style.background=\'\';el.placeholder=\'N° remisión\';}">Auto</label>' : '') +
    editField('Fecha Despacho', 'mu-view-fecha-despacho', 'date', fDespachoVal, '') +
    '</div>';

  if (r.Objetivo) {
    html += '<div style="margin-bottom:14px"><div style="font-weight:700;font-size:0.78rem;color:#4a5568;text-transform:uppercase;margin-bottom:4px">Objetivo</div>' +
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">' + escHtml(r.Objetivo) + '</div></div>';
  }

  if (sameConsec.length) {
    var despachoDisabled = aprEstado !== 'Aprobada';
    muViewEmpresa = emp;
    muViewWorkingLines = sameConsec.map(function(x) {
      var copy = Object.assign({}, x);
      copy._asignaciones = [];
      return copy;
    });
    muAsig = createAsignacionEngine({
      getLines: function() { return muViewWorkingLines; },
      getEmpresa: function() { return muViewEmpresa; },
      globalName: 'muAsig',
      prefix: 'mu'
    });
    await muAsig.loadSnapshot();

    var saveBtn = despachoDisabled
      ? '<button disabled title="Requiere aprobación previa" style="background:#cbd5e0;color:#4a5568;border:none;padding:6px 14px;border-radius:6px;cursor:not-allowed;font-size:0.8rem;font-weight:700">🔒 Aprobación requerida</button>'
      : '<button onclick="saveEntregas()" style="background:#27ae60;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:700" id="btn-save-entregas">💾 Guardar entregas</button>';
    html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">' +
      '<div style="font-weight:700;font-size:0.84rem;color:#2d3748">📦 Productos solicitados (' + sameConsec.length + ')</div>' +
      saveBtn +
      '</div>';
    html += '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#f7fafc"><th>Producto</th><th>Presentación</th><th style="text-align:right">Cantidad</th><th style="text-align:right;width:90px">Entregada</th>' +
      (despachoDisabled ? '' : '<th style="min-width:220px">Asignar entrega (empresa · cant.)</th>') +
      '<th></th></tr></thead><tbody>';
    muViewWorkingLines.forEach(function(x, i) {
      var cantEnt = x.Cant_Entregada != null && x.Cant_Entregada !== '' ? x.Cant_Entregada : '';
      var inpDis = despachoDisabled ? ' disabled' : '';
      html += '<tr><td>' + (x.Producto || '—') + '</td><td>' + (x.Presentacion || '—') + '</td><td style="text-align:right">' + (x.Cantidad || 0) + '</td>' +
        '<td><input type="number" min="0" class="ef mu-view-cant-ent" data-id="' + x.id + '" data-i="' + i + '" value="' + cantEnt + '"' + inpDis + ' style="width:70px;text-align:right;padding:4px 6px;font-size:0.82rem' + (despachoDisabled ? ';background:#f1f5f9;color:#94a3b8' : '') + '"' + (despachoDisabled ? '' : ' readonly tabindex="-1" title="Se calcula desde las asignaciones"') + '></td>' +
        (despachoDisabled ? '' : '<td class="mu-asig-td" data-i="' + i + '" style="min-width:220px">' + muAsig.renderCell(i, x) + '</td>') +
        '<td style="white-space:nowrap">' + (AUTH.canEdit() ? '<button class="btn-edit" onclick="closeViewMu();editMuestra(' + x.id + ')" style="font-size:0.75rem;padding:3px 8px">✏️</button> ' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="closeViewMu();deleteMuestra(' + x.id + ')" style="font-size:0.75rem;padding:3px 8px">🗑️</button>' : '') + '</td></tr>';
    });
    html += '<tbody id="mu-view-new-lines"></tbody></table></div>';
    if (AUTH.canEdit() && !despachoDisabled) {
      html += '<div style="margin-top:8px"><button onclick="addMuViewLine()" style="background:#d35400;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:700">+ Agregar línea</button></div>';
    }
  }

  if (r.Observaciones) {
    html += '<div style="margin-top:14px"><div style="font-weight:700;font-size:0.78rem;color:#4a5568;text-transform:uppercase;margin-bottom:4px">Observaciones</div>' +
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">' + escHtml(r.Observaciones) + '</div></div>';
  }

  html += '<div class="adjuntos-section" id="mu-adjuntos-section">' +
    '<div class="adjuntos-header">' +
      '<h4>📎 Archivos adjuntos <span class="adjuntos-count" id="mu-adjuntos-count"></span></h4>' +
      (AUTH.canEdit() ? '<button class="btn-adjuntar" onclick="document.getElementById(\'mu-adjunto-input\').click()">📤 Adjuntar archivo</button>' : '') +
    '</div>' +
    '<div class="adjuntos-list" id="mu-adjuntos-list"><div class="adjuntos-empty">Sin archivos adjuntos</div></div>' +
    (AUTH.canEdit() ? '<div class="adjunto-dropzone" id="mu-adjunto-dropzone" onclick="document.getElementById(\'mu-adjunto-input\').click()">' +
      'Arrastra un archivo aquí o haz clic para seleccionar · PDF, JPG, PNG (máx. 5 MB)' +
      '<input type="file" id="mu-adjunto-input" accept=".pdf,.jpg,.jpeg,.png,.webp" onchange="handleMuAdjuntoUpload(this)">' +
    '</div>' : '') +
    '<div class="adjunto-upload-progress" id="mu-adjunto-progress">' +
      '<div class="prog-bar"><div class="prog-fill" id="mu-adjunto-prog-fill" style="width:0%"></div></div>' +
      '<div class="prog-text" id="mu-adjunto-prog-text">Subiendo...</div>' +
    '</div>' +
  '</div>';

  muViewNewLines = [];
  document.getElementById('view-mu-body').innerHTML = html;
  var _muViewRem = document.getElementById('mu-view-remision');
  if (_muViewRem) { _muViewRem.readOnly = true; _muViewRem.style.background = '#f0f4f8'; }
  document.getElementById('view-mu-overlay').classList.add('show');
  loadMuAdjuntos(emp, consec);
  initMuDropzone();
  loadProductosCache();

  if (typeof NOTIF !== 'undefined' && NOTIF.verificarBtn) {
    var _remMu = (r.Remision || '').trim();
    var _cMu = consec || '';
    var _btnSol = document.querySelector('#view-mu-overlay button[onclick*="exportarMuestraSolicitudPDF"]');
    var _btnRem = document.querySelector('#view-mu-overlay button[onclick*="exportarMuestraRemisionPDF"]');
    if (_btnSol) {
      if (_cMu) NOTIF.verificarBtn(_btnSol, 'muestras', _cMu);
      else { _btnSol.disabled = false; _btnSol.style.opacity = ''; _btnSol.style.cursor = ''; _btnSol.textContent = '📨 Enviar Solicitud'; }
    }
    if (_btnRem) {
      _btnRem.disabled = false; _btnRem.style.opacity = ''; _btnRem.style.cursor = '';
      _btnRem.textContent = '📨 Enviar Remisión';
      if (_remMu) NOTIF.verificarBtn(_btnRem, 'muestras', _cMu + ' · Rem ' + _remMu);
    }
  }
}

async function saveEntregas() {
  var remision = document.getElementById('mu-view-remision').value.trim();
  var fechaDespacho = document.getElementById('mu-view-fecha-despacho').value;

  syncMuViewNewLinesFromDOM();
  var newLines = muViewNewLines.filter(function(p) { return p.producto && p.cantidad > 0; });

  var split = muAsig ? muAsig.splitAsignaciones() : { entregas: [], solicitudesCompra: [] };
  var entregas = split.entregas;
  var solicitudesCompra = split.solicitudesCompra;

  var tieneAsignaciones = entregas.length > 0 || solicitudesCompra.length > 0;

  if (!tieneAsignaciones && !newLines.length) {
    showToast('Asigna al menos una entrega o agrega líneas nuevas', '#e67e22');
    return;
  }
  if (tieneAsignaciones && !fechaDespacho) {
    showToast('Selecciona la fecha de despacho', '#e74c3c');
    return;
  }

  if (entregas.length > 0 && !remision) {
    try {
      remision = await generarRemisionConsecutivo(muViewEmpresa, 'SALIDA');
      document.getElementById('mu-view-remision').value = remision;
    } catch (err) {
      showToast('Error generando remisión: ' + err.message, '#e74c3c');
      return;
    }
  }

  var btn = document.getElementById('btn-save-entregas');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    await loadMuestras();

    var entregasPorLinea = {};
    entregas.forEach(function(ent) {
      if (!entregasPorLinea[ent._idx]) entregasPorLinea[ent._idx] = 0;
      entregasPorLinea[ent._idx] += ent.cantidad;
    });

    var noEncontradas = [];
    for (var i = 0; i < muViewWorkingLines.length; i++) {
      var wl = muViewWorkingLines[i];
      var row = allMuestras.filter(function(r) { return r.id === wl.id; })[0];
      if (!row) { noEncontradas.push(wl.id); continue; }
      var cantDirecta = entregasPorLinea[i] || 0;
      var cantEntAnterior = Number(row.Cant_Entregada) || 0;
      var cantEntNueva = cantEntAnterior + cantDirecta;
      var estado = cantDirecta > 0 ? 'Despachada' : row.Estado;
      var generarRem = !remision && !(row.Remision || '').trim();
      var res = await apiPost({
        action: 'editarMuestra', row: wl.id,
        Empresa: row.Empresa, Consecutivo: row.Consecutivo,
        Fecha_Solicitud: row.Fecha_Solicitud, Fecha_Despacho: fechaDespacho || row.Fecha_Despacho,
        Responsable: row.Responsable, Departamento: row.Departamento, Municipio: row.Municipio,
        Tipo_Cultivo: row.Tipo_Cultivo, Fecha_Aplicacion: row.Fecha_Aplicacion,
        Fecha_Seguimiento: row.Fecha_Seguimiento, Remision: remision,
        Solicitante: row.Solicitante, Autoriza: row.Autoriza,
        Estado: estado, Objetivo: row.Objetivo, Observaciones: row.Observaciones,
        Producto: row.Producto, Presentacion: row.Presentacion,
        Cantidad: row.Cantidad, Cant_Entregada: cantEntNueva,
        Fecha_Entrega: row.Fecha_Entrega || '',
        _generar_remision: generarRem
      });
      if (!res.ok) throw new Error(res.error || 'Error al guardar línea ' + wl.id);
    }
    if (noEncontradas.length) {
      throw new Error('No se encontraron ' + noEncontradas.length + ' línea(s) en la base de datos. Recargá la página e intentá de nuevo.');
    }

    if (solicitudesCompra.length > 0 && muAsig) {
      var head = allMuestras.filter(function(r) { return r.id === muViewingId; })[0];
      var refLabel = (muViewEmpresa || '') + ' Muestra #' + ((head && head.Consecutivo) || '');
      await muAsig.persistirOCSolicitudes(solicitudesCompra, {
        fecha: fechaDespacho,
        refLabel: refLabel
      });
    }

    if (newLines.length) {
      var head2 = allMuestras.filter(function(r) { return r.id === muViewingId; })[0];
      if (head2) {
        var resNew = await apiPost({
          action: 'agregarMuestra',
          Empresa: head2.Empresa, Consecutivo: head2.Consecutivo,
          Fecha_Solicitud: head2.Fecha_Solicitud, Fecha_Despacho: fechaDespacho || head2.Fecha_Despacho,
          Responsable: head2.Responsable, Departamento: head2.Departamento, Municipio: head2.Municipio,
          Tipo_Cultivo: head2.Tipo_Cultivo, Fecha_Aplicacion: head2.Fecha_Aplicacion,
          Fecha_Seguimiento: head2.Fecha_Seguimiento, Remision: remision,
          Solicitante: head2.Solicitante, Autoriza: head2.Autoriza,
          Estado: head2.Estado || 'Despachada', Objetivo: head2.Objetivo,
          Estado_Aprobacion: head2.Estado_Aprobacion || 'Aprobada',
          Aprobada_Por: head2.Aprobada_Por || '', Fecha_Aprobacion: head2.Fecha_Aprobacion || '',
          Observaciones: head2.Observaciones,
          lineas: newLines.map(function(l) {
            return { Producto: l.producto, Presentacion: l.presentacion, Cantidad: l.cantidad };
          })
        });
        if (!resNew.ok) throw new Error(resNew.error || 'Error al agregar nuevas líneas');
      }
    }

    closeViewMu();
    var partes = [];
    if (entregas.length > 0) partes.push(entregas.length + ' entrega(s) registrada(s)');
    if (solicitudesCompra.length > 0) partes.push(solicitudesCompra.length + ' solicitud(es) de compra creada(s)');
    if (newLines.length) partes.push(newLines.length + ' línea(s) nueva(s)');
    showToast('✅ ' + (partes.length ? partes.join(' + ') : 'Guardado'));
    if (solicitudesCompra.length > 0) {
      showToast('⚠ ' + solicitudesCompra.length + ' solicitud(es) de compra pendiente(s) — legalizar la OC en Órdenes para que el stock quede en ' + muViewEmpresa, '#e67e22');
    }
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
  muViewNewLines = [];
  muViewWorkingLines = [];
  muViewEmpresa = '';
  muAsig = null;
  muViewProdACs.forEach(function(ac) { ac.destroy(); });
  muViewProdACs = [];
}
document.getElementById('view-mu-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeViewMu(); });

function addMuViewLine() {
  muViewNewLines.push({ producto: '', presentacion: '', cantidad: 0 });
  renderMuViewNewLines();
}

function removeMuViewLine(i) {
  syncMuViewNewLinesFromDOM();
  muViewNewLines.splice(i, 1);
  renderMuViewNewLines();
}

function syncMuViewNewLinesFromDOM() {
  document.querySelectorAll('.mu-view-new-prod').forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (muViewNewLines[idx]) muViewNewLines[idx].producto = el.value;
  });
  document.querySelectorAll('.mu-view-new-pres').forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (muViewNewLines[idx]) muViewNewLines[idx].presentacion = el.value;
  });
  document.querySelectorAll('.mu-view-new-cant').forEach(function(el) {
    var idx = Number(el.getAttribute('data-i'));
    if (muViewNewLines[idx]) muViewNewLines[idx].cantidad = Number(el.value) || 0;
  });
}

function renderMuViewNewLines() {
  var tbody = document.getElementById('mu-view-new-lines');
  if (!tbody) return;
  tbody.innerHTML = muViewNewLines.map(function(p, i) {
    var prod = (p.producto || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var pres = (p.presentacion || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<tr>' +
      '<td><input class="ef mu-view-new-prod" data-i="' + i + '" type="text" value="' + prod + '" placeholder="Nombre del producto" style="min-width:120px;font-size:0.82rem;padding:4px 6px"></td>' +
      '<td><input class="ef mu-view-new-pres" data-i="' + i + '" type="text" value="' + pres + '" placeholder="Presentación" style="width:100px;font-size:0.82rem;padding:4px 6px"></td>' +
      '<td><input class="ef mu-view-new-cant" data-i="' + i + '" type="number" min="0" value="' + (p.cantidad || '') + '" placeholder="0" style="width:70px;text-align:right;font-size:0.82rem;padding:4px 6px"></td>' +
      '<td></td>' +
      (muAsig ? '<td></td>' : '') +
      '<td style="text-align:center"><button onclick="removeMuViewLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:3px 8px;border-radius:5px;cursor:pointer;font-size:0.75rem;font-weight:700">✕</button></td>' +
      '</tr>';
  }).join('');
  setupMuViewProdAutocomplete();
}

function setupMuViewProdAutocomplete() {
  muViewProdACs.forEach(function(ac) { ac.destroy(); });
  muViewProdACs = [];
  if (!productosCache) return;
  var head = allMuestras.filter(function(r) { return r.id === muViewingId; })[0];
  var empView = head ? head.Empresa : '';
  [].slice.call(document.querySelectorAll('.mu-view-new-prod')).forEach(function(input, i) {
    muViewProdACs.push(muInitAC(input, {
      items: function() {
        var prods = productosCache || [];
        if (empView) {
          var filtered = prods.filter(function(p) { return p.empresa === empView; });
          if (filtered.length) prods = filtered;
        }
        return prods;
      },
      display: function(p) {
        return '<strong>' + escHtml(p.producto) + '</strong>' +
               (p.presentacion ? ' <span class="ac-sub">— ' + escHtml(p.presentacion) + '</span>' : '');
      },
      match: function(p, val) {
        return ((p.producto || '') + ' ' + (p.presentacion || '')).toLowerCase().indexOf(val) >= 0;
      },
      onSelect: function(p) {
        input.value = p.producto || '';
        var presInputs = document.querySelectorAll('.mu-view-new-pres');
        if (presInputs[i]) presInputs[i].value = p.presentacion || '';
        syncMuViewNewLinesFromDOM();
      }
    }));
  });
}

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
    var ocKey = (head.Empresa || '') + '||' + (ctx.consec || '');
    var ocGroups = ocsLegalizadasPorMuestra[ocKey] || [];
    NOTIF.openModalEnviar({
      modulo: 'muestras',
      referencia: (ctx.consec || '') + ' · Rem ' + remision,
      titulo: 'Remisión muestras #' + remision + ' — ' + (head.Solicitante || 'sin solicitante'),
      triggerBtn: opts.triggerBtn || null,
      buildDoc: function() {
        var r = generarRemisionPDF(Object.assign({}, data, { return_doc: true, copies: ['COPIA - CONTABILIDAD'] }));
        if (!r) return null;
        var doc = r.doc;
        if (solicitudData) {
          generarRemisionPDF(Object.assign({}, solicitudData, { return_doc: true, _doc: doc }));
        }
        var mergedByRem = {};
        ocGroups.forEach(function(ocLines) {
          if (!ocLines || !ocLines.length) return;
          var h = ocLines[0];
          var kRem = String(h.Remision || '').trim() + '||' + String(h.Remision_Origen || '').trim();
          if (!mergedByRem[kRem]) mergedByRem[kRem] = [];
          ocLines.forEach(function(l) { mergedByRem[kRem].push(l); });
        });
        Object.keys(mergedByRem).forEach(function(k) {
          generarRemisionesTrasladoPDF(mergedByRem[k], { return_doc: true, _doc: doc, contabilidad: true });
        });
        return doc;
      }
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
      titulo: 'Solicitud muestras #' + (ctx.consec || '') + ' — ' + (head.Solicitante || 'sin solicitante'),
      triggerBtn: opts.triggerBtn || null
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
  var muFecha = document.getElementById('mu-fecha-solicitud');
  muFecha.value = today();
  muFecha.min = today();
  if (!AUTH.isAdmin()) {
    muFecha.readOnly = true;
    muFecha.style.background = '#f0f0f0';
  } else {
    muFecha.readOnly = false;
    muFecha.style.background = '';
  }
  document.getElementById('mu-fecha-despacho').value = '';
  document.getElementById('mu-responsable').value = '';
  var respSet = {};
  allMuestras.forEach(function(r) { if (r.Responsable) respSet[r.Responsable] = 1; });
  document.getElementById('dl-mu-responsable').innerHTML = Object.keys(respSet).sort().map(function(v) {
    return '<option value="' + v.replace(/"/g, '&quot;') + '">';
  }).join('');
  document.getElementById('mu-departamento').value = '';
  document.getElementById('mu-municipio').value = '';
  document.getElementById('mu-tipo-cultivo').value = '';
  document.getElementById('mu-fecha-aplicacion').value = '';
  document.getElementById('mu-fecha-seguimiento').value = '';
  document.getElementById('mu-remision').value = '';
  var _elMuR = document.getElementById('mu-remision');
  _elMuR.readOnly = true; _elMuR.style.background = '#f0f4f8'; _elMuR.placeholder = '(Auto al despachar)';
  var _chkMuR = document.getElementById('mu-remision-auto'); if (_chkMuR) _chkMuR.checked = true;
  document.getElementById('mu-solicitante').value = '';
  document.getElementById('mu-autoriza').value = '';
  document.getElementById('mu-estado').value = 'Pendiente';
  document.getElementById('mu-objetivo').value = '';
  document.getElementById('mu-observaciones').value = '';

  document.getElementById('mu-multi-lines').style.display = '';
  document.getElementById('mu-edit-single').style.display = 'none';

  muLines = [{ producto: '', presentacion: '', cantidad: 0 }];
  renderMuLines();
  // Rol 'comercial': fija el Responsable a su nombre (o código) y lo bloquea.
  // La RLS del backend valida que responsable_id = auth.uid() al insertar.
  if (AUTH.isComercial && AUTH.isComercial()) {
    var profM = AUTH.getProfile();
    var muR = document.getElementById('mu-responsable');
    if (muR && profM) {
      muR.value = profM.nombre || profM.email || '';
      muR.readOnly = true;
      muR.style.background = '#f1f5f9';
      muR.title = 'Las solicitudes que crees quedan asignadas a tu usuario';
    }
  }
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
  var _elMuRe = document.getElementById('mu-remision');
  _elMuRe.readOnly = true; _elMuRe.style.background = '#f0f4f8'; _elMuRe.placeholder = '(Auto al despachar)';
  var _chkMuRe = document.getElementById('mu-remision-auto'); if (_chkMuRe) _chkMuRe.checked = true;
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

    var muEditRow = allMuestras ? allMuestras.filter(function(x) { return x.id === muEditId; })[0] : null;
    var generarRemMu = estado === 'Despachada' && !(muEditRow && (muEditRow.Remision || '').trim()) && !document.getElementById('mu-remision').value.trim();
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
        Fecha_Entrega: fechaEntrega,
        _generar_remision: generarRemMu
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeMuModal();
      var toastMu = ['✅ Solicitud actualizada'];
      if (result.remision) toastMu.push('RS: ' + result.remision);
      showToast(toastMu.join(' · '));
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
  if (!AUTH.isAdmin() && fechaSol < today()) { showToast('La fecha de solicitud no puede ser anterior a hoy', '#e74c3c'); return; }
  if (!responsable) { showToast('Ingresa el responsable', '#e74c3c'); return; }

  var productosValidos = muLines.filter(function(p) { return p.producto && p.cantidad > 0; });
  if (!productosValidos.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var responsableId = await _resolveResponsableId(responsable);
    var result = await apiPost({
      action: 'agregarMuestra',
      Empresa: empresa,
      Consecutivo: consecutivo,
      Fecha_Solicitud: fechaSol,
      Fecha_Despacho: document.getElementById('mu-fecha-despacho').value,
      Responsable: responsable,
      responsable_id: responsableId,
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
      _generar_remision: document.getElementById('mu-estado').value === 'Despachada' && !document.getElementById('mu-remision').value.trim(),
      lineas: productosValidos.map(function(p) {
        return { Producto: p.producto, Presentacion: p.presentacion, Cantidad: p.cantidad };
      })
    });

    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeMuModal();
    var toastMuNew = ['✅ Solicitud creada: ' + (result.added || 0) + ' línea(s)'];
    if (result.remision) toastMuNew.push('RS: ' + result.remision);
    showToast(toastMuNew.join(' · '));
    _notifyAdminsNuevaSolicitud({
      empresa: empresa, consecutivo: consecutivo,
      solicitante: document.getElementById('mu-solicitante').value.trim(),
      responsable: responsable, nLineas: productosValidos.length
    });
    await loadMuestras();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar solicitud';
  }
}

async function _notifyAdminsNuevaSolicitud(info) {
  if (typeof NOTIF === 'undefined' || !NOTIF.notifyUsers || !NOTIF.getDirectorio) return;
  try {
    var dir = await NOTIF.getDirectorio();
    var adminIds = (dir || [])
      .filter(function(u) { return u.activo && u.rol === 'admin'; })
      .map(function(u) { return u.id; });
    if (!adminIds.length) return;
    var sigla = EMPRESAS_SIGLA[info.empresa] || info.empresa || '—';
    await NOTIF.notifyUsers({
      para_ids: adminIds,
      modulo: 'muestras',
      referencia: info.consecutivo || '',
      titulo: '🧪 Solicitud de muestras por aprobar: ' + sigla + ' #' + (info.consecutivo || ''),
      mensaje: (info.responsable || 'Sin responsable') +
               ' registró ' + info.nLineas + ' línea(s)' +
               (info.solicitante ? ' para ' + info.solicitante : '') + '.'
    });
  } catch (e) { /* la notificación no debe bloquear el flujo */ }
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

// ── Aprobación / rechazo (admin-only) ──

var muRejectCtx = null;

async function approveMuestra(empresa, consecutivo, closeAfter) {
  if (!AUTH.canApprove || !AUTH.canApprove()) {
    showToast('No tienes permiso para aprobar.', '#e74c3c');
    return;
  }
  var rows = allMuestras
    .filter(function(r) { return (r.Empresa || '') === empresa && String(r.Consecutivo || '') === String(consecutivo); });
  if (!rows.length) { showToast('Solicitud no encontrada.', '#e67e22'); return; }
  var ids = rows.map(function(r) { return r.id; });
  if (!confirm('¿Aprobar esta solicitud de muestras (' + ids.length + ' línea(s))?')) return;
  var res = await apiPost({ action: 'aprobarMuestra', Empresa: empresa, Consecutivo: consecutivo, ids: ids });
  if (!res.ok) { showToast('❌ ' + (res.error || 'Error al aprobar'), '#e74c3c'); return; }
  showToast('✅ Solicitud aprobada');
  _notifyCreadorAprobacion(rows[0], 'Aprobada', '');
  if (closeAfter) closeViewMu();
  await loadMuestras();
}

async function _notifyCreadorAprobacion(row, estado, motivo) {
  if (typeof NOTIF === 'undefined' || !NOTIF.notifyUsers) return;
  if (!row || !row.creado_por) return;
  try {
    var sigla = EMPRESAS_SIGLA[row.Empresa] || row.Empresa || '—';
    var ref = String(row.Consecutivo || '');
    var titulo, mensaje;
    if (estado === 'Aprobada') {
      titulo = '✅ Solicitud de muestras aprobada: ' + sigla + ' #' + ref;
      mensaje = 'Tu solicitud fue aprobada y ya puede despacharse.';
    } else {
      titulo = '❌ Solicitud de muestras rechazada: ' + sigla + ' #' + ref;
      mensaje = 'Motivo: ' + (motivo || 'sin motivo');
    }
    await NOTIF.notifyUsers({
      para_ids: [row.creado_por],
      modulo: 'muestras',
      referencia: ref,
      titulo: titulo,
      mensaje: mensaje
    });
  } catch (e) { /* silencioso */ }
}

function askRejectMuestra(empresa, consecutivo, closeAfter) {
  if (!AUTH.canApprove || !AUTH.canApprove()) {
    showToast('No tienes permiso para rechazar.', '#e74c3c');
    return;
  }
  var ids = allMuestras
    .filter(function(r) { return (r.Empresa || '') === empresa && String(r.Consecutivo || '') === String(consecutivo); })
    .map(function(r) { return r.id; });
  if (!ids.length) { showToast('Solicitud no encontrada.', '#e67e22'); return; }
  muRejectCtx = { empresa: empresa, consecutivo: consecutivo, ids: ids, closeAfter: !!closeAfter };
  document.getElementById('rej-mu-detail').textContent =
    'Consecutivo ' + (consecutivo || '—') + ' · ' + ids.length + ' línea(s)';
  document.getElementById('rej-mu-motivo').value = '';
  document.getElementById('btn-rej-mu-confirm').disabled = false;
  document.getElementById('reject-mu-overlay').classList.add('show');
  setTimeout(function() { document.getElementById('rej-mu-motivo').focus(); }, 50);
}

function closeRejectMu() {
  document.getElementById('reject-mu-overlay').classList.remove('show');
  muRejectCtx = null;
}
document.getElementById('reject-mu-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeRejectMu(); });

async function confirmRejectMu() {
  if (!muRejectCtx) return;
  var motivo = document.getElementById('rej-mu-motivo').value.trim();
  if (!motivo) { showToast('Escribe el motivo del rechazo.', '#e67e22'); return; }
  var ctx = muRejectCtx;
  var btn = document.getElementById('btn-rej-mu-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Rechazando...';
  try {
    var res = await apiPost({
      action: 'rechazarMuestra',
      Empresa: ctx.empresa, Consecutivo: ctx.consecutivo, ids: ctx.ids,
      Motivo_Rechazo: motivo
    });
    if (!res.ok) throw new Error(res.error || 'Error al rechazar');
    var creatorRow = allMuestras.filter(function(r) { return ctx.ids.indexOf(r.id) >= 0; })[0];
    closeRejectMu();
    if (ctx.closeAfter) closeViewMu();
    showToast('✅ Solicitud rechazada');
    _notifyCreadorAprobacion(creatorRow, 'Rechazada', motivo);
    await loadMuestras();
  } catch (err) {
    showToast('❌ ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '❌ Rechazar';
  }
}

// ── Tabs: Solicitudes / Vista detallada ──

function switchMuTab(tab) {
  var tabs = ['mu-solicitudes', 'mu-detalle'];
  tabs.forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var btn = document.getElementById('tab-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) btn.style.background = t === tab ? '#8e44ad' : '#718096';
  });
  if (tab === 'mu-detalle') renderDetalleMu();
}

// ── Vista detallada (flat product lines) ──

var detMuSort = [];

function toggleDetMuSort(col, e) {
  var shift = e && e.shiftKey;
  var idx = -1;
  for (var i = 0; i < detMuSort.length; i++) { if (detMuSort[i].col === col) { idx = i; break; } }
  if (shift) { if (idx >= 0) detMuSort.splice(idx, 1); }
  else if (idx >= 0) { if (detMuSort[idx].dir === 'asc') detMuSort[idx].dir = 'desc'; else detMuSort.splice(idx, 1); }
  else { detMuSort.push({ col: col, dir: 'asc' }); }
  renderDetalleMu();
}

function clearDetMuSort() { detMuSort = []; renderDetalleMu(); }

function renderDetalleMu() {
  var panel = document.getElementById('panel-mu-detalle');
  if (!panel || panel.style.display === 'none') return;

  var rows = filteredMu.slice();

  if (detMuSort.length) {
    rows.sort(function(a, b) {
      for (var s = 0; s < detMuSort.length; s++) {
        var col = detMuSort[s].col, dir = detMuSort[s].dir;
        var va, vb;
        if (col === 'empresa') { va = (EMPRESAS_SIGLA[a.Empresa] || a.Empresa || '').toLowerCase(); vb = (EMPRESAS_SIGLA[b.Empresa] || b.Empresa || '').toLowerCase(); }
        else if (col === 'consecutivo') { va = String(a.Consecutivo || ''); vb = String(b.Consecutivo || ''); }
        else if (col === 'fecha') { va = a.Fecha_Solicitud || ''; vb = b.Fecha_Solicitud || ''; }
        else if (col === 'responsable') { va = (a.Responsable || '').toLowerCase(); vb = (b.Responsable || '').toLowerCase(); }
        else if (col === 'municipio') { va = (a.Municipio || '').toLowerCase(); vb = (b.Municipio || '').toLowerCase(); }
        else if (col === 'cultivo') { va = (a.Tipo_Cultivo || '').toLowerCase(); vb = (b.Tipo_Cultivo || '').toLowerCase(); }
        else if (col === 'producto') { va = (a.Producto || '').toLowerCase(); vb = (b.Producto || '').toLowerCase(); }
        else if (col === 'presentacion') { va = (a.Presentacion || '').toLowerCase(); vb = (b.Presentacion || '').toLowerCase(); }
        else if (col === 'cantidad') { va = Number(a.Cantidad) || 0; vb = Number(b.Cantidad) || 0; }
        else if (col === 'entregada') { va = Number(a.Cant_Entregada) || 0; vb = Number(b.Cant_Entregada) || 0; }
        else if (col === 'aprobacion') { va = (a.Estado_Aprobacion || 'Por aprobar').toLowerCase(); vb = (b.Estado_Aprobacion || 'Por aprobar').toLowerCase(); }
        else if (col === 'estado') { va = (a.Estado || '').toLowerCase(); vb = (b.Estado || '').toLowerCase(); }
        else if (col === 'solicitante') { va = (a.Solicitante || '').toLowerCase(); vb = (b.Solicitante || '').toLowerCase(); }
        else if (col === 'remision') { va = (a.Remision || ''); vb = (b.Remision || ''); }
        else { va = ''; vb = ''; }
        var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  document.getElementById('det-mu-count').textContent = '(' + rows.length + ' líneas)';

  var cols = [
    { id: 'empresa', label: 'Empresa' },
    { id: 'consecutivo', label: 'Consec.' },
    { id: 'fecha', label: 'Fecha Solicitud' },
    { id: 'responsable', label: 'Responsable' },
    { id: 'solicitante', label: 'Solicitante' },
    { id: 'municipio', label: 'Municipio' },
    { id: 'cultivo', label: 'Tipo Cultivo' },
    { id: 'producto', label: 'Producto' },
    { id: 'presentacion', label: 'Presentación' },
    { id: 'cantidad', label: 'Cantidad' },
    { id: 'entregada', label: 'Entregada' },
    { id: 'remision', label: 'Remisión' },
    { id: 'aprobacion', label: 'Aprobación' },
    { id: 'estado', label: 'Estado' }
  ];

  document.getElementById('det-mu-head').innerHTML = cols.map(function(c) {
    var idx = -1;
    for (var i = 0; i < detMuSort.length; i++) { if (detMuSort[i].col === c.id) { idx = i; break; } }
    var cls = idx >= 0 ? (detMuSort[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = idx >= 0 && detMuSort.length > 1 ? '<span style="font-size:0.6rem;vertical-align:super;color:#8e44ad">' + (idx + 1) + '</span>' : '';
    return '<th class="sortable ' + cls + '" onclick="toggleDetMuSort(\'' + c.id + '\',event)">' + c.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');

  var btn = document.getElementById('btn-clear-sort-det-mu');
  if (btn) btn.style.display = detMuSort.length ? 'inline-block' : 'none';

  var tbody = document.getElementById('det-mu-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="' + cols.length + '"><div class="empty">No hay líneas con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    var sigla = EMPRESAS_SIGLA[r.Empresa] || r.Empresa || '—';
    var siglaCls = 'sigla-' + (EMPRESAS_SIGLA[r.Empresa] || 'DEFAULT');
    var apr = r.Estado_Aprobacion || 'Por aprobar';
    var aprBadge = apr === 'Aprobada' ? '<span class="badge b-ent">✅ Aprobada</span>'
      : apr === 'Rechazada' ? '<span class="badge b-anu">❌ Rechazada</span>'
      : '<span class="badge b-par">⏳ Por aprobar</span>';
    var estadoBadge = r.Estado === 'Despachada'
      ? '<span class="badge b-ent">Despachada</span>'
      : '<span class="badge b-rec">Pendiente</span>';
    var cant = Number(r.Cantidad) || 0;
    var entregada = Number(r.Cant_Entregada) || 0;
    return '<tr style="cursor:pointer" onclick="viewMuestra(' + r.id + ')">' +
      '<td><span class="sigla-badge ' + siglaCls + '">' + escHtml(sigla) + '</span></td>' +
      '<td>' + (r.Consecutivo || '—') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha_Solicitud) + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Responsable || '—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Solicitante || '—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Municipio || '—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Tipo_Cultivo || '—') + '</td>' +
      '<td style="font-weight:600">' + (r.Producto || '—') + '</td>' +
      '<td>' + (r.Presentacion || '—') + '</td>' +
      '<td class="money" style="font-weight:700">' + cant.toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + entregada.toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Remision || '—') + '</td>' +
      '<td>' + aprBadge + '</td>' +
      '<td>' + estadoBadge + '</td>' +
    '</tr>';
  }).join('');
}

// ── Excel export (detail/flat) ──

function exportDetalleMuExcel() {
  var rows = filteredMu.slice();
  if (!rows.length) { showToast('No hay líneas para exportar', '#e74c3c'); return; }

  var data = rows.map(function(r) {
    return {
      'Empresa': EMPRESAS_SIGLA[r.Empresa] || r.Empresa || '',
      'Consecutivo': r.Consecutivo || '',
      'Fecha Solicitud': r.Fecha_Solicitud || '',
      'Responsable': r.Responsable || '',
      'Solicitante': r.Solicitante || '',
      'Municipio': r.Municipio || '',
      'Departamento': r.Departamento || '',
      'Tipo Cultivo': r.Tipo_Cultivo || '',
      'Producto': r.Producto || '',
      'Presentación': r.Presentacion || '',
      'Cantidad': Number(r.Cantidad) || 0,
      'Entregada': Number(r.Cant_Entregada) || 0,
      'Remisión': r.Remision || '',
      'Aprobación': r.Estado_Aprobacion || 'Por aprobar',
      'Estado': r.Estado || '',
      'Objetivo': r.Objetivo || '',
      'Observaciones': r.Observaciones || ''
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    {wch:12},{wch:10},{wch:14},{wch:18},{wch:18},{wch:16},{wch:16},{wch:16},
    {wch:30},{wch:14},{wch:10},{wch:10},{wch:14},{wch:12},{wch:12},{wch:30},{wch:30}
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle Muestras');
  XLSX.writeFile(wb, 'Muestras_Detalle_' + today() + '.xlsx');
  showToast('Excel detalle exportado: ' + rows.length + ' líneas', '#27ae60');
}

// ── Adjuntos Muestras (Supabase Storage) ──
var MU_ADJUNTOS_BUCKET = 'muestras-adjuntos';

function muAdjSanitize(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
}

function muAdjuntoFolder(empresa, consecutivo) {
  var emp = (EMPRESAS_SIGLA[empresa] || empresa || 'SIN').replace(/[^a-zA-Z0-9_-]/g, '_');
  return emp + '/' + muAdjSanitize(consecutivo);
}

function muAdjuntoPath(empresa, consecutivo, filename) {
  return muAdjuntoFolder(empresa, consecutivo) + '/' + filename;
}

function muFormatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function loadMuAdjuntos(empresa, consecutivo) {
  var listEl = document.getElementById('mu-adjuntos-list');
  var countEl = document.getElementById('mu-adjuntos-count');
  if (!listEl) return;
  listEl.innerHTML = '<div class="adjuntos-loading">Cargando adjuntos...</div>';

  var folder = muAdjuntoFolder(empresa, consecutivo);
  var res2 = await _sb.storage.from(MU_ADJUNTOS_BUCKET).list(folder, { limit: 50 });

  var files = (res2.data || []).filter(function(f) { return f.name && f.id; });

  if (!files.length) {
    listEl.innerHTML = '<div class="adjuntos-empty">Sin archivos adjuntos</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (countEl) countEl.textContent = '(' + files.length + ')';
  listEl.innerHTML = files.map(function(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var icon = ext === 'pdf' ? '📄' : '🖼️';
    var size = f.metadata && f.metadata.size ? muFormatFileSize(f.metadata.size) : '';
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
        '<button class="btn-adj-ver" onclick="previewMuAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + ext + '\')">👁 Ver</button>' +
        '<button class="btn-adj-ver" onclick="downloadMuAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + nameEsc.replace(/'/g, "\\'") + '\')">⬇ Descargar</button>' +
        (AUTH.canDelete() ? '<button class="btn-adj-del" onclick="deleteMuAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\')">🗑️</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

async function handleMuAdjuntoUpload(input) {
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

  if (!muViewingId) return;
  var head = allMuestras.filter(function(r) { return r.id === muViewingId; })[0];
  if (!head) return;

  var timestamp = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var finalName = timestamp + '_' + safeName;
  var path = muAdjuntoPath(head.Empresa, head.Consecutivo || head.id, finalName);

  var progWrap = document.getElementById('mu-adjunto-progress');
  var progFill = document.getElementById('mu-adjunto-prog-fill');
  var progText = document.getElementById('mu-adjunto-prog-text');
  if (progWrap) progWrap.style.display = 'block';
  if (progFill) progFill.style.width = '30%';
  if (progText) progText.textContent = 'Subiendo ' + file.name + '...';

  var res = await _sb.storage.from(MU_ADJUNTOS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });

  if (progFill) progFill.style.width = '100%';

  if (res.error) {
    if (progWrap) progWrap.style.display = 'none';
    showToast('Error al subir: ' + res.error.message, '#e74c3c');
    return;
  }

  if (progText) progText.textContent = 'Listo';
  setTimeout(function() { if (progWrap) progWrap.style.display = 'none'; if (progFill) progFill.style.width = '0%'; }, 1200);

  showToast('Archivo adjuntado correctamente', '#27ae60');
  await loadMuAdjuntos(head.Empresa, head.Consecutivo || head.id);
}

async function previewMuAdjunto(path, ext) {
  var res = _sb.storage.from(MU_ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(MU_ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
    url = signed.data && signed.data.signedUrl;
  }
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }

  var contentEl = document.getElementById('mu-adjunto-preview-content');
  if (ext === 'pdf') {
    contentEl.innerHTML = '<iframe src="' + url + '"></iframe>';
  } else {
    contentEl.innerHTML = '<img src="' + url + '" alt="Preview">';
  }
  document.getElementById('mu-adjunto-preview-overlay').classList.add('show');
}

function closeMuAdjuntoPreview() {
  document.getElementById('mu-adjunto-preview-overlay').classList.remove('show');
  document.getElementById('mu-adjunto-preview-content').innerHTML = '';
}

async function downloadMuAdjunto(path, filename) {
  var res = _sb.storage.from(MU_ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(MU_ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
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

async function deleteMuAdjunto(path) {
  if (!confirm('¿Eliminar este archivo adjunto?')) return;
  var res = await _sb.storage.from(MU_ADJUNTOS_BUCKET).remove([path]);
  if (res.error) {
    showToast('Error al eliminar: ' + res.error.message, '#e74c3c');
    return;
  }
  showToast('Archivo eliminado', '#e67e22');
  if (muViewingId) {
    var head = allMuestras.filter(function(r) { return r.id === muViewingId; })[0];
    if (head) {
      await loadMuAdjuntos(head.Empresa, head.Consecutivo || head.id);
    }
  }
}

function initMuDropzone() {
  var dz = document.getElementById('mu-adjunto-dropzone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var input = document.getElementById('mu-adjunto-input');
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleMuAdjuntoUpload(input);
  });
}

// ── Auto-load ──
loadMuestras();
