// ── State ──
var cambios = [];
var editCam = null;
var camLineasCambiar = [];
var camLineasEntregar = [];
var deleteCamGroupIds = null;
var gestionarCamIds = null;
var catalogoProductosCam = [];
var catalogoClientesCam = [];

// ── Constants ──
var EMPRESAS_CAM = [
  { value: 'PARCELAR DE COLOMBIA SAS', sigla: 'PARCELAR' },
  { value: 'GREEN AGROSOLUCIONES DE COLOMBIA SAS', sigla: 'GREEN' },
  { value: 'SOLUCIONES INTEGRALES RESO SAS', sigla: 'RESO' },
  { value: 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS', sigla: 'IASO' },
  { value: 'INSUMOS AGROPECUARIOS DE LA SABANA SAS', sigla: 'IAS' },
];
function getSiglaCam(n) {
  for (var i = 0; i < EMPRESAS_CAM.length; i++) {
    if (EMPRESAS_CAM[i].value === (n||'').trim()) return EMPRESAS_CAM[i].sigla;
  }
  return n || '—';
}
var SIGLA_CLS_CAM = ['PARCELAR','GREEN','RESO','IASO','IAS'];
function getSiglaClassCam(n) { var s = getSiglaCam(n); return SIGLA_CLS_CAM.indexOf(s) >= 0 ? 'sigla-'+s : 'sigla-DEFAULT'; }

// ── Load ──
async function loadCambios() {
  await _authReady;
  populateEmpresaSelect('cam-empresa');
  setSyncStatus('syncing', 'Cargando cambios...');
  try {
    var data = await apiGet('getCambios');
    if (!data.ok) throw new Error(data.error || 'Error desconocido');
    cambios = (data.cambios || []).map(function(r) {
      if (r.Fecha_Solicitud instanceof Date) r.Fecha_Solicitud = r.Fecha_Solicitud.toISOString().slice(0,10);
      return r;
    });
    populateCamFilters();
    renderCamTable();
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
  } catch (err) {
    setSyncStatus('error', 'Error al cargar cambios: ' + err.message);
  }
}

async function loadCatalogoCam() {
  try {
    var data = await apiGet('getMaestroProductos');
    if (data.ok) catalogoProductosCam = data.productos || [];
  } catch(e) {}
}

async function loadClientesCam() {
  try {
    var data = await apiGet('getClientesUnicos');
    if (data.ok) catalogoClientesCam = data.clientes || [];
  } catch(e) {}
}

// ── Client autocomplete ──
function buildClientSearchCam() {
  var inp = document.getElementById('cam-cliente');
  if (!inp || inp._camBound) return;
  inp._camBound = true;
  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    closeCamClientAC();
    if (q.length < 1 || !catalogoClientesCam.length) return;
    var matches = catalogoClientesCam.filter(function(c) {
      return (c.cliente||'').toLowerCase().indexOf(q) >= 0 || (c.nit||'').toLowerCase().indexOf(q) >= 0;
    });
    if (!matches.length) return;
    var list = document.createElement('div');
    list.className = 'autocomplete-list cam-client-ac';
    list.style.cssText = 'position:absolute;z-index:100;background:white;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:220px;overflow-y:auto;width:100%;left:0;top:100%';
    matches.slice(0,20).forEach(function(c) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f4f8';
      var nitL = c.nit ? ' <span style="color:#718096;font-size:0.75rem">NIT: '+c.nit+'</span>' : '';
      item.innerHTML = '<span style="font-weight:600">'+c.cliente+'</span>'+nitL;
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        document.getElementById('cam-cliente').value = c.cliente || '';
        document.getElementById('cam-nit').value = c.nit || '';
        document.getElementById('cam-telefono').value = c.telefono || '';
        closeCamClientAC();
      });
      item.addEventListener('mouseover', function() { this.style.background='#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background='white'; });
      list.appendChild(item);
    });
    var wrapper = inp.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(list);
  });
  inp.addEventListener('blur', function() { setTimeout(closeCamClientAC, 150); });
}
function closeCamClientAC() {
  document.querySelectorAll('.cam-client-ac').forEach(function(el) { el.remove(); });
}

// ── Product autocomplete for cambio lines ──
function buildCamProdSearch(cls, idx) {
  var inp = document.querySelector('.'+cls+'[data-line="'+idx+'"]');
  if (!inp) return;
  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    closeCamProdAC();
    if (q.length < 1) return;
    var empSel = document.getElementById('cam-empresa').value;
    var matches = catalogoProductosCam.filter(function(p) {
      var mn = (p.producto||'').toLowerCase().indexOf(q) >= 0;
      var me = !empSel || !p.empresa || p.empresa === empSel;
      return mn && me;
    });
    var seen = {};
    matches = matches.filter(function(p) {
      var key = p.producto+'||'+p.presentacion;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    if (!matches.length) return;
    var list = document.createElement('div');
    list.className = 'autocomplete-list cam-prod-ac';
    list.style.cssText = 'position:absolute;z-index:100;background:white;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:350px;overflow-y:auto;width:100%;left:0;top:100%';
    matches.slice(0,25).forEach(function(p) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f4f8;display:flex;justify-content:space-between';
      item.innerHTML = '<span style="font-weight:600">'+(p.producto||'')+'</span><span style="color:#718096;font-size:0.75rem">'+(p.presentacion||'')+'</span>';
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        inp.value = p.producto;
        closeCamProdAC();
      });
      item.addEventListener('mouseover', function() { this.style.background='#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background='white'; });
      list.appendChild(item);
    });
    var wrapper = inp.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(list);
  });
  inp.addEventListener('blur', function() { setTimeout(closeCamProdAC, 150); });
}
function closeCamProdAC() {
  document.querySelectorAll('.cam-prod-ac').forEach(function(el) { el.remove(); });
}

// ── Filters ──
var camFiltersAttached = false;
function populateCamFilters() {
  var clientes = [];
  cambios.forEach(function(r) {
    if (r.Cliente && clientes.indexOf(r.Cliente) < 0) clientes.push(r.Cliente);
  });
  clientes.sort();
  var fc = document.getElementById('fc-cliente');
  fc.innerHTML = '<option value="">Todos</option>' + clientes.map(function(c) { return '<option value="'+c+'">'+c+'</option>'; }).join('');
  if (!camFiltersAttached) {
    ['fc-empresa','fc-cliente','fc-estado','fc-txt'].forEach(function(id) {
      document.getElementById(id).addEventListener('change', renderCamTable);
      document.getElementById(id).addEventListener('input', renderCamTable);
    });
    camFiltersAttached = true;
  }
}
function filteredCam() {
  var fe = document.getElementById('fc-empresa').value;
  var fc = document.getElementById('fc-cliente').value;
  var fst = document.getElementById('fc-estado').value;
  var ft = document.getElementById('fc-txt').value.toLowerCase();
  return cambios.filter(function(r) {
    if (fe && r.Empresa !== fe) return false;
    if (fc && r.Cliente !== fc) return false;
    if (fst && r.Estado !== fst) return false;
    if (ft) {
      var hay = [r.Cliente, r.NIT, r.Producto, r.Num_Factura, r.Razon_Cambio, r.Observaciones, r.Consecutivo, r.Correo].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}
function clearCamFilters() {
  document.getElementById('fc-empresa').value = '';
  document.getElementById('fc-cliente').value = '';
  document.getElementById('fc-estado').value = '';
  document.getElementById('fc-txt').value = '';
  renderCamTable();
}

// ── Group cambios ──
function groupCambios(rows) {
  var map = {};
  var order = [];
  rows.forEach(function(r) {
    var key = (r.Empresa||'') + '||' + (r.Consecutivo || r.id);
    if (!map[key]) {
      map[key] = { head: Object.assign({}, r), lines: [], key: key };
      order.push(key);
    }
    map[key].lines.push(r);
  });
  return order.map(function(k) {
    var g = map[k];
    g.head._key = k;
    g.head._lines = g.lines;
    g.head._nCambiar = g.lines.filter(function(l) { return l.Tipo_Linea === 'CAMBIAR'; }).length;
    g.head._nEntregar = g.lines.filter(function(l) { return l.Tipo_Linea === 'ENTREGAR'; }).length;
    g.head._estado = g.lines[0].Estado || 'Pendiente';
    g.head._lineIds = g.lines.map(function(l) { return l.__row || l.id; });
    return g.head;
  });
}

// ── Render ──
function renderCamTable() {
  var filtered = filteredCam();
  var grouped = groupCambios(filtered);
  var allGrouped = groupCambios(cambios);

  document.getElementById('sc-total').textContent = allGrouped.length;
  var now = new Date();
  var mesActual = groupCambios(cambios.filter(function(r) {
    var d = new Date(r.Fecha_Solicitud);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  })).length;
  document.getElementById('sc-mes').textContent = mesActual;
  var cliSet = {};
  cambios.forEach(function(r) { if (r.Cliente) cliSet[r.Cliente] = true; });
  document.getElementById('sc-clientes').textContent = Object.keys(cliSet).length;
  document.getElementById('sc-pendientes').textContent = allGrouped.filter(function(g) { return g._estado === 'Pendiente'; }).length;
  document.getElementById('row-ct-cam').textContent = '(' + grouped.length + ' mostrados)';

  // Header
  var cols = ['#','Fecha','Empresa','Consec.','Cliente','NIT','Factura','Prod. Cambiar','Prod. Entregar','Estado','Acción'];
  document.getElementById('t-head-cam').innerHTML = cols.map(function(c) { return '<th>'+c+'</th>'; }).join('');

  var tbody = document.getElementById('t-body-cam');
  if (!grouped.length) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty">No hay cambios registrados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = grouped.map(function(r, i) {
    var keyEsc = (r._key||'').replace(/'/g, "\\'");
    var esPend = r._estado === 'Pendiente';
    var esCerrado = r._estado === 'Cerrado';
    var estadoBadge = esCerrado
      ? '<span style="background:#d1ecf1;color:#0c5460;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Cerrado</span>'
      : esPend
        ? '<span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Pendiente</span>'
        : '<span style="background:#d4edda;color:#155724;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Completado</span>';
    var gestionarBtn = AUTH.canEdit() ? '<button onclick="openGestionarCam(\''+keyEsc+'\')" title="Gestionar cambio" style="background:#27ae60;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📝 Gestionar</button>' : '';
    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">'+(i+1)+'</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">'+fmtDate(r.Fecha_Solicitud)+'</td>' +
      '<td title="'+(r.Empresa||'')+'"><span class="sigla-badge '+getSiglaClassCam(r.Empresa)+'">'+getSiglaCam(r.Empresa)+'</span></td>' +
      '<td style="text-align:center;font-weight:600">'+(r.Consecutivo||'—')+'</td>' +
      '<td style="font-weight:600;font-size:0.82rem">'+(r.Cliente||'—')+'</td>' +
      '<td style="font-size:0.78rem">'+(r.NIT||'—')+'</td>' +
      '<td style="font-size:0.78rem">'+(r.Num_Factura||'—')+'</td>' +
      '<td style="text-align:center"><span style="background:#fde8e8;color:#c0392b;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.8rem">'+(r._nCambiar||0)+'</span></td>' +
      '<td style="text-align:center"><span style="background:#e8f8f0;color:#27ae60;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.8rem">'+(r._nEntregar||0)+'</span></td>' +
      '<td style="text-align:center">'+estadoBadge+'</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
        '<button onclick="viewCamDetail(\''+keyEsc+'\')" title="Ver detalle" style="background:#3498db;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📋 Ver</button>' +
        gestionarBtn +
        (AUTH.canEdit() ? '<button onclick="openEditCamGroup(\''+keyEsc+'\')" title="Editar" style="background:#8e44ad;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">✏️</button>' +
        '<button class="btn-del" onclick="openDeleteCamGroup(\''+keyEsc+'\')" title="Eliminar">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Detail view ──
function viewCamDetail(key) {
  var lines = cambios.filter(function(r) {
    return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  var r = lines[0];
  function cf(label, val) {
    return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">'+label+'</span><br><span style="font-size:0.85rem;color:#2d3748">'+(val||'—')+'</span></div>';
  }
  var estadoLabel = r.Estado === 'Cerrado'
    ? '<span style="background:#d1ecf1;color:#0c5460;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Cerrado</span>'
    : r.Estado === 'Completado'
      ? '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Completado</span>'
      : '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Pendiente</span>';

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem">' +
    cf('Empresa', getSiglaCam(r.Empresa)) +
    cf('Fecha Solicitud', fmtDate(r.Fecha_Solicitud)) +
    cf('Fecha Recogida', r.Fecha_Recogida ? fmtDate(r.Fecha_Recogida) : '—') +
    cf('Consecutivo', r.Consecutivo) +
    cf('Cliente', r.Cliente) +
    cf('NIT', r.NIT) +
    cf('Teléfono', r.Telefono) +
    cf('Correo', r.Correo) +
    cf('N° Factura', r.Num_Factura) +
    cf('Fecha Compra', r.Fecha_Compra ? fmtDate(r.Fecha_Compra) : '—') +
    cf('Estado', estadoLabel) +
    '</div>' +
    (function() {
      var hasIngreso = r.Remision_Ingreso;
      var hasSalida = r.Remision_Salida;
      if (!hasIngreso && !hasSalida) {
        var m = (r.Observaciones||'').match(/\[Remisión:\s*(.+?)\s*\|\s*Fecha:\s*(.+?)\]/);
        if (m) return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem">' + cf('N° Remisión (legado)', m[1]) + cf('Fecha Remisión', fmtDate(m[2])) + '</div>';
        return '';
      }
      var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">';
      html += '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 14px">' +
        '<div style="font-weight:700;font-size:0.82rem;color:#e65100;margin-bottom:8px">📥 Remisión de Ingreso</div>' +
        cf('N° Remisión', r.Remision_Ingreso || '') +
        cf('Bodega', r.Bodega_Ingreso || '') +
        cf('Fecha', r.Fecha_Ingreso ? fmtDate(r.Fecha_Ingreso) : '—') +
        '</div>';
      html += '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:12px 14px">' +
        '<div style="font-weight:700;font-size:0.82rem;color:#2e7d32;margin-bottom:8px">📤 Remisión de Salida</div>' +
        cf('N° Remisión', r.Remision_Salida || '') +
        cf('Bodega', r.Bodega_Salida || '') +
        cf('Fecha', r.Fecha_Salida ? fmtDate(r.Fecha_Salida) : '—') +
        '</div>';
      html += '</div>';
      return html;
    })();

  var linesCambiar = lines.filter(function(l) { return l.Tipo_Linea === 'CAMBIAR'; });
  var linesEntregar = lines.filter(function(l) { return l.Tipo_Linea === 'ENTREGAR'; });

  if (linesCambiar.length) {
    html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-bottom:10px;font-weight:700;font-size:0.84rem;color:#c0392b">📦 Mercancía a cambiar ('+linesCambiar.length+')</div>';
    html += '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#fdf2f2">' +
      '<th>Producto</th><th style="text-align:right">Cantidad</th><th>Lote / Vencimiento</th><th>Razón</th></tr></thead><tbody>';
    linesCambiar.forEach(function(x) {
      html += '<tr><td style="font-weight:600">'+(x.Producto||'—')+'</td><td style="text-align:right">'+(x.Cantidad||0)+'</td><td>'+(x.Lote_Vencimiento||'—')+'</td><td>'+(x.Razon_Cambio||'—')+'</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  if (linesEntregar.length) {
    html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px;margin-bottom:10px;font-weight:700;font-size:0.84rem;color:#27ae60">📦 Mercancía a entregar ('+linesEntregar.length+')</div>';
    html += '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#f0faf4">' +
      '<th>Producto</th><th style="text-align:right">Cantidad</th><th>Lote / Vencimiento</th><th>Fecha Cambio</th></tr></thead><tbody>';
    linesEntregar.forEach(function(x) {
      html += '<tr><td style="font-weight:600">'+(x.Producto||'—')+'</td><td style="text-align:right">'+(x.Cantidad||0)+'</td><td>'+(x.Lote_Vencimiento||'—')+'</td><td>'+(x.Fecha_Cambio ? fmtDate(x.Fecha_Cambio) : '—')+'</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  if (r.Valor_Cliente || r.Valor_Empresa) {
    html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      cf('Valor a favor del cliente', r.Valor_Cliente ? fmtMoney(r.Valor_Cliente) : '—') +
      cf('Valor a favor de la empresa', r.Valor_Empresa ? fmtMoney(r.Valor_Empresa) : '—') +
      '</div>';
  }

  if (r.Observaciones) {
    html += '<div style="margin-top:14px"><div style="font-weight:700;font-size:0.78rem;color:#4a5568;text-transform:uppercase;margin-bottom:4px">Observaciones</div>' +
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">'+(r.Observaciones||'')+'</div></div>';
  }

  document.getElementById('view-cam-meta').innerHTML =
    '<span>📋 Consec: '+(r.Consecutivo||'—')+'</span>' +
    '<span>👤 '+(r.Cliente||'—')+'</span>';
  document.getElementById('view-cam-body').innerHTML = html;
  document.getElementById('view-cam-overlay').classList.add('show');
}
function closeViewCam() { document.getElementById('view-cam-overlay').classList.remove('show'); }
document.getElementById('view-cam-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeViewCam(); });

// ── Render lines in form ──
function renderCamLines(tipo) {
  var arr = tipo === 'cambiar' ? camLineasCambiar : camLineasEntregar;
  var tbodyId = tipo === 'cambiar' ? 'cam-lines-cambiar' : 'cam-lines-entregar';
  var prodCls = 'cam-prod-'+tipo;
  var tbody = document.getElementById(tbodyId);

  if (tipo === 'cambiar') {
    tbody.innerHTML = arr.map(function(l, i) {
      return '<tr>' +
        '<td style="color:#a0aec0;font-size:0.74rem">'+(i+1)+'</td>' +
        '<td style="position:relative;min-width:260px"><div style="position:relative"><input class="ef '+prodCls+'" data-line="'+i+'" type="text" value="'+((l.Producto||'').replace(/"/g,'&quot;'))+'" placeholder="Buscar producto..." autocomplete="off" style="min-width:240px"></div></td>' +
        '<td><input class="ef cam-cant-cambiar" data-line="'+i+'" type="number" min="0" value="'+(l.Cantidad||'')+'" placeholder="0" style="width:65px;text-align:right"></td>' +
        '<td><input class="ef cam-lote-cambiar" data-line="'+i+'" type="text" value="'+((l.Lote_Vencimiento||'').replace(/"/g,'&quot;'))+'" placeholder="Lote / vencimiento"></td>' +
        '<td><input class="ef cam-razon" data-line="'+i+'" type="text" value="'+((l.Razon_Cambio||'').replace(/"/g,'&quot;'))+'" placeholder="Razón del cambio"></td>' +
        '<td style="text-align:center"><button onclick="removeCamLine(\'cambiar\','+i+')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button></td>' +
      '</tr>';
    }).join('');
  } else {
    tbody.innerHTML = arr.map(function(l, i) {
      return '<tr>' +
        '<td style="color:#a0aec0;font-size:0.74rem">'+(i+1)+'</td>' +
        '<td style="position:relative;min-width:260px"><div style="position:relative"><input class="ef '+prodCls+'" data-line="'+i+'" type="text" value="'+((l.Producto||'').replace(/"/g,'&quot;'))+'" placeholder="Buscar producto..." autocomplete="off" style="min-width:240px"></div></td>' +
        '<td><input class="ef cam-cant-entregar" data-line="'+i+'" type="number" min="0" value="'+(l.Cantidad||'')+'" placeholder="0" style="width:65px;text-align:right"></td>' +
        '<td><input class="ef cam-lote-entregar" data-line="'+i+'" type="text" value="'+((l.Lote_Vencimiento||'').replace(/"/g,'&quot;'))+'" placeholder="Lote / vencimiento"></td>' +
        '<td><input class="ef cam-fecha-cambio" data-line="'+i+'" type="date" value="'+(l.Fecha_Cambio||'')+'"></td>' +
        '<td style="text-align:center"><button onclick="removeCamLine(\'entregar\','+i+')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button></td>' +
      '</tr>';
    }).join('');
  }

  arr.forEach(function(l, i) { buildCamProdSearch(prodCls, i); });
}

function addCamLine(tipo) {
  if (tipo === 'cambiar') {
    camLineasCambiar.push({ Producto:'', Cantidad:'', Lote_Vencimiento:'', Razon_Cambio:'' });
    renderCamLines('cambiar');
  } else {
    camLineasEntregar.push({ Producto:'', Cantidad:'', Lote_Vencimiento:'', Fecha_Cambio:'' });
    renderCamLines('entregar');
  }
}

function removeCamLine(tipo, i) {
  var arr = tipo === 'cambiar' ? camLineasCambiar : camLineasEntregar;
  arr.splice(i, 1);
  renderCamLines(tipo);
}

function readCamLines() {
  document.querySelectorAll('.cam-prod-cambiar').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasCambiar[i]) camLineasCambiar[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.cam-cant-cambiar').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasCambiar[i]) camLineasCambiar[i].Cantidad = Number(inp.value) || 0;
  });
  document.querySelectorAll('.cam-lote-cambiar').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasCambiar[i]) camLineasCambiar[i].Lote_Vencimiento = inp.value.trim();
  });
  document.querySelectorAll('.cam-razon').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasCambiar[i]) camLineasCambiar[i].Razon_Cambio = inp.value.trim();
  });
  document.querySelectorAll('.cam-prod-entregar').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasEntregar[i]) camLineasEntregar[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.cam-cant-entregar').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasEntregar[i]) camLineasEntregar[i].Cantidad = Number(inp.value) || 0;
  });
  document.querySelectorAll('.cam-lote-entregar').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasEntregar[i]) camLineasEntregar[i].Lote_Vencimiento = inp.value.trim();
  });
  document.querySelectorAll('.cam-fecha-cambio').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (camLineasEntregar[i]) camLineasEntregar[i].Fecha_Cambio = inp.value;
  });
}

// ── Auto-consecutivo por empresa ──
function nextConsecutivoCam(empresa) {
  if (!empresa) return '';
  var maxCons = 0;
  cambios.forEach(function(r) {
    if (r.Empresa === empresa) {
      var n = Number(r.Consecutivo) || 0;
      if (n > maxCons) maxCons = n;
    }
  });
  return String(maxCons + 1);
}

function onCamEmpresaChange() {
  if (editCam) return;
  var empresa = document.getElementById('cam-empresa').value;
  document.getElementById('cam-consecutivo').value = nextConsecutivoCam(empresa);
}

// ── New Cambio ──
function openNewCambio() {
  editCam = null;
  document.getElementById('cam-modal-title').textContent = '🔁 Registrar Cambio de Mercancía';
  document.getElementById('cam-empresa').value = '';
  document.getElementById('cam-empresa').onchange = onCamEmpresaChange;
  document.getElementById('cam-fecha-solicitud').value = today();
  document.getElementById('cam-fecha-recogida').value = '';
  document.getElementById('cam-consecutivo').value = '';
  document.getElementById('cam-cliente').value = '';
  document.getElementById('cam-nit').value = '';
  document.getElementById('cam-telefono').value = '';
  document.getElementById('cam-correo').value = '';
  document.getElementById('cam-num-factura').value = '';
  document.getElementById('cam-fecha-compra').value = '';
  document.getElementById('cam-valor-cliente').value = '';
  document.getElementById('cam-valor-empresa').value = '';
  document.getElementById('cam-observaciones').value = '';
  document.getElementById('btn-save-cam').disabled = false;
  document.getElementById('btn-save-cam').textContent = '✓ Registrar cambio';
  camLineasCambiar = [{ Producto:'', Cantidad:'', Lote_Vencimiento:'', Razon_Cambio:'' }];
  camLineasEntregar = [{ Producto:'', Cantidad:'', Lote_Vencimiento:'', Fecha_Cambio:'' }];
  renderCamLines('cambiar');
  renderCamLines('entregar');
  buildClientSearchCam();
  document.getElementById('cam-overlay').classList.add('show');
}

function openEditCamGroup(key) {
  var lines = cambios.filter(function(r) {
    return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  editCam = { key: key, lineIds: lines.map(function(l) { return l.__row || l.id; }) };
  var r = lines[0];
  document.getElementById('cam-modal-title').textContent = '✏️ Editar Cambio de Mercancía';
  document.getElementById('cam-empresa').value = r.Empresa || '';
  document.getElementById('cam-fecha-solicitud').value = toDateInput(r.Fecha_Solicitud);
  document.getElementById('cam-fecha-recogida').value = r.Fecha_Recogida ? toDateInput(r.Fecha_Recogida) : '';
  document.getElementById('cam-consecutivo').value = r.Consecutivo || '';
  document.getElementById('cam-cliente').value = r.Cliente || '';
  document.getElementById('cam-nit').value = r.NIT || '';
  document.getElementById('cam-telefono').value = r.Telefono || '';
  document.getElementById('cam-correo').value = r.Correo || '';
  document.getElementById('cam-num-factura').value = r.Num_Factura || '';
  document.getElementById('cam-fecha-compra').value = r.Fecha_Compra ? toDateInput(r.Fecha_Compra) : '';
  document.getElementById('cam-valor-cliente').value = r.Valor_Cliente || '';
  document.getElementById('cam-valor-empresa').value = r.Valor_Empresa || '';
  document.getElementById('cam-observaciones').value = r.Observaciones || '';
  document.getElementById('btn-save-cam').disabled = false;
  document.getElementById('btn-save-cam').textContent = '✓ Guardar cambios';

  camLineasCambiar = lines.filter(function(l) { return l.Tipo_Linea === 'CAMBIAR'; }).map(function(l) {
    return { Producto: l.Producto, Cantidad: l.Cantidad, Lote_Vencimiento: l.Lote_Vencimiento, Razon_Cambio: l.Razon_Cambio };
  });
  camLineasEntregar = lines.filter(function(l) { return l.Tipo_Linea === 'ENTREGAR'; }).map(function(l) {
    return { Producto: l.Producto, Cantidad: l.Cantidad, Lote_Vencimiento: l.Lote_Vencimiento, Fecha_Cambio: l.Fecha_Cambio };
  });
  if (!camLineasCambiar.length) camLineasCambiar = [{ Producto:'', Cantidad:'', Lote_Vencimiento:'', Razon_Cambio:'' }];
  if (!camLineasEntregar.length) camLineasEntregar = [{ Producto:'', Cantidad:'', Lote_Vencimiento:'', Fecha_Cambio:'' }];
  renderCamLines('cambiar');
  renderCamLines('entregar');
  buildClientSearchCam();
  document.getElementById('cam-overlay').classList.add('show');
}

function closeCamModal() {
  document.getElementById('cam-overlay').classList.remove('show');
  editCam = null;
  closeCamProdAC();
  closeCamClientAC();
}
document.getElementById('cam-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeCamModal(); });

// ── Save ──
async function saveCambio() {
  var empresa = document.getElementById('cam-empresa').value;
  var fechaSolicitud = document.getElementById('cam-fecha-solicitud').value;
  var fechaRecogida = document.getElementById('cam-fecha-recogida').value;
  var consecutivo = document.getElementById('cam-consecutivo').value.trim();
  var cliente = document.getElementById('cam-cliente').value.trim();
  var nit = document.getElementById('cam-nit').value.trim();
  var telefono = document.getElementById('cam-telefono').value.trim();
  var correo = document.getElementById('cam-correo').value.trim();
  var numFactura = document.getElementById('cam-num-factura').value.trim();
  var fechaCompra = document.getElementById('cam-fecha-compra').value;
  var valorCliente = Number(document.getElementById('cam-valor-cliente').value) || 0;
  var valorEmpresa = Number(document.getElementById('cam-valor-empresa').value) || 0;
  var observaciones = document.getElementById('cam-observaciones').value.trim();

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!fechaSolicitud) { showToast('Selecciona la fecha de solicitud', '#e74c3c'); return; }
  if (!cliente) { showToast('Ingresa el nombre del cliente', '#e74c3c'); return; }

  readCamLines();
  var validCambiar = camLineasCambiar.filter(function(l) { return l.Producto; });
  if (!validCambiar.length) { showToast('Agrega al menos un producto a cambiar', '#e74c3c'); return; }

  var validEntregar = camLineasEntregar.filter(function(l) { return l.Producto; });

  var btn = document.getElementById('btn-save-cam');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  var header = {
    Empresa: empresa, Fecha_Solicitud: fechaSolicitud, Fecha_Recogida: fechaRecogida,
    Consecutivo: consecutivo, Cliente: cliente, NIT: nit, Telefono: telefono,
    Correo: correo, Num_Factura: numFactura, Fecha_Compra: fechaCompra,
    Valor_Cliente: valorCliente, Valor_Empresa: valorEmpresa, Observaciones: observaciones
  };

  try {
    if (editCam) {
      // Delete old lines then insert new ones
      for (var i = 0; i < editCam.lineIds.length; i++) {
        await apiPost({ action: 'eliminarCambio', row: editCam.lineIds[i] });
      }
    }
    var result = await apiPost({
      action: 'agregarCambio',
      header: header,
      lineasCambiar: validCambiar,
      lineasEntregar: validEntregar
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeCamModal();
    showToast('✅ ' + result.added + ' línea(s) registradas');
    await loadCambios();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = editCam ? '✓ Guardar cambios' : '✓ Registrar cambio';
  }
}

// ── Delete ──
function openDeleteCamGroup(key) {
  var lines = cambios.filter(function(r) {
    return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  var r = lines[0];
  deleteCamGroupIds = lines.map(function(l) { return l.__row || l.id; });
  document.getElementById('del-cam-msg').textContent = '¿Eliminar este cambio completo?';
  document.getElementById('del-cam-detail').innerHTML =
    'Cliente: <strong>'+(r.Cliente||'—')+'</strong> · Consec: <strong>'+(r.Consecutivo||'—')+'</strong><br>' +
    'Líneas: '+lines.length+'<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminarán '+lines.length+' registro(s).</span>';
  document.getElementById('btn-del-cam-confirm').disabled = false;
  document.getElementById('btn-del-cam-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-cam-overlay').classList.add('show');
}

function closeDeleteCam() {
  document.getElementById('delete-cam-overlay').classList.remove('show');
  deleteCamGroupIds = null;
}
document.getElementById('delete-cam-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteCam(); });

async function confirmDeleteCam() {
  if (!deleteCamGroupIds || !deleteCamGroupIds.length) return;
  var btn = document.getElementById('btn-del-cam-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';
  try {
    for (var i = 0; i < deleteCamGroupIds.length; i++) {
      var result = await apiPost({ action: 'eliminarCambio', row: deleteCamGroupIds[i] });
      if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    }
    closeDeleteCam();
    showToast('🗑️ Cambio eliminado ('+deleteCamGroupIds.length+' líneas)');
    await loadCambios();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Gestionar Cambio ──
function openGestionarCam(key) {
  var lines = cambios.filter(function(r) {
    return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  var r = lines[0];
  gestionarCamIds = lines.map(function(l) { return l.__row || l.id; });

  document.getElementById('gestionar-cam-meta').innerHTML =
    '<span>📋 Consec: '+(r.Consecutivo||'—')+'</span>' +
    '<span>👤 '+(r.Cliente||'—')+'</span>' +
    '<span>'+getSiglaCam(r.Empresa)+'</span>';

  document.getElementById('gestionar-cam-remision-ingreso').value = r.Remision_Ingreso || '';
  document.getElementById('gestionar-cam-bodega-ingreso').value = r.Bodega_Ingreso || 'Productos Buenos';
  document.getElementById('gestionar-cam-fecha-ingreso').value = r.Fecha_Ingreso ? toDateInput(r.Fecha_Ingreso) : today();
  document.getElementById('gestionar-cam-remision-salida').value = r.Remision_Salida || '';
  document.getElementById('gestionar-cam-bodega-salida').value = r.Bodega_Salida || 'Productos Buenos';
  document.getElementById('gestionar-cam-fecha-salida').value = r.Fecha_Salida ? toDateInput(r.Fecha_Salida) : today();
  document.getElementById('btn-gestionar-cam').disabled = false;
  document.getElementById('btn-gestionar-cam').textContent = '✓ Cerrar cambio';
  document.getElementById('gestionar-cam-overlay').classList.add('show');
}

function closeGestionarCam() {
  document.getElementById('gestionar-cam-overlay').classList.remove('show');
  gestionarCamIds = null;
}
document.getElementById('gestionar-cam-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeGestionarCam(); });

async function saveGestionarCam() {
  var remIngreso = document.getElementById('gestionar-cam-remision-ingreso').value.trim();
  var bodegaIngreso = document.getElementById('gestionar-cam-bodega-ingreso').value;
  var fechaIngreso = document.getElementById('gestionar-cam-fecha-ingreso').value;
  var remSalida = document.getElementById('gestionar-cam-remision-salida').value.trim();
  var bodegaSalida = document.getElementById('gestionar-cam-bodega-salida').value;
  var fechaSalida = document.getElementById('gestionar-cam-fecha-salida').value;
  if (!remIngreso) { showToast('Ingresa el N° de remisión de ingreso', '#e74c3c'); return; }
  if (!fechaIngreso) { showToast('Selecciona la fecha de ingreso', '#e74c3c'); return; }
  if (!remSalida) { showToast('Ingresa el N° de remisión de salida', '#e74c3c'); return; }
  if (!fechaSalida) { showToast('Selecciona la fecha de salida', '#e74c3c'); return; }
  if (!gestionarCamIds || !gestionarCamIds.length) return;

  var btn = document.getElementById('btn-gestionar-cam');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'gestionarCambio',
      Remision_Ingreso: remIngreso,
      Bodega_Ingreso: bodegaIngreso,
      Fecha_Ingreso: fechaIngreso,
      Remision_Salida: remSalida,
      Bodega_Salida: bodegaSalida,
      Fecha_Salida: fechaSalida,
      ids: gestionarCamIds
    });
    if (!result.ok) throw new Error(result.error || 'Error al gestionar');
    closeGestionarCam();
    showToast('✅ Cambio cerrado — ' + result.updated + ' línea(s) actualizadas');
    await loadCambios();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Cerrar cambio';
  }
}

// ── Init ──
loadCatalogoCam();
loadClientesCam();
