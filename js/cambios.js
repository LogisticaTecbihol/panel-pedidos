// ── State ──
var cambios = [];
var editCam = null;
var camLineasCambiar = [];
var camLineasEntregar = [];
var deleteCamGroupIds = null;
var gestionarCamIds = null;
var catalogoProductosCam = [];
var catalogoClientesCam = [];
var camViewingKey = null;

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
        (AUTH.canEdit() ? '<button onclick="openEditCamGroup(\''+keyEsc+'\')" title="Editar" style="background:#8e44ad;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">✏️</button>' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="openDeleteCamGroup(\''+keyEsc+'\')" title="Eliminar">🗑️</button>' : '') +
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

  camViewingKey = key;
  var btnIn = document.getElementById('btn-cam-rem-ingreso');
  var btnOut = document.getElementById('btn-cam-rem-salida');
  if (btnIn) btnIn.style.display = r.Remision_Ingreso ? 'inline-block' : 'none';
  if (btnOut) btnOut.style.display = r.Remision_Salida ? 'inline-block' : 'none';
}
function closeViewCam() {
  document.getElementById('view-cam-overlay').classList.remove('show');
  camViewingKey = null;
}
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

// ── PDF Export (Cambios) ──
function _camViewContext() {
  if (!camViewingKey) { showToast('No hay cambio seleccionado.', '#e67e22'); return null; }
  if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
    showToast('El generador de PDF aún no está listo. Intenta de nuevo en unos segundos.', '#e67e22');
    return null;
  }
  if (typeof generarRemisionPDF !== 'function') {
    showToast('Módulo de remisión no cargado.', '#e74c3c');
    return null;
  }
  var lines = cambios.filter(function(r) {
    return ((r.Empresa || '') + '||' + (r.Consecutivo || r.id)) === camViewingKey;
  });
  if (!lines.length) { showToast('Cambio no encontrado.', '#e74c3c'); return null; }
  var head = lines[0];
  var linesCambiar = lines.filter(function(l) { return l.Tipo_Linea === 'CAMBIAR'; });
  var linesEntregar = lines.filter(function(l) { return l.Tipo_Linea === 'ENTREGAR'; });
  return { head: head, lines: lines, cambiar: linesCambiar, entregar: linesEntregar };
}

function exportarCamSolicitudPDF() {
  var ctx = _camViewContext();
  if (!ctx) return;
  var head = ctx.head;

  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF();
  var pw = doc.internal.pageSize.getWidth();
  var palette = _pdfPaletteFor(head.Empresa);
  var accent = palette.accent;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];
  var headerInfo = (typeof _pdfRemisionHeaderInfoFor === 'function') ? _pdfRemisionHeaderInfoFor(head.Empresa) : null;
  var headerH = headerInfo ? 48 : 30;
  var logo = _pdfHeaderLogoFor(head.Empresa);

  // Header
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pw, headerH, 'F');
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(1.2);
  doc.line(0, headerH, pw, headerH);

  var titleX = 14;
  if (logo) {
    try {
      doc.addImage(logo.data, 'PNG', 5, 4, 22, 22);
      titleX = 34;
    } catch (e) {}
  }

  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.text('SOLICITUD DE CAMBIO DE MERCANCIA  N° ' + String(head.Consecutivo || ''), titleX, 13);
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.text(String(head.Empresa || ''), titleX, 21);
  doc.setFontSize(9);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFont(undefined, 'bold');
  if (head.Fecha_Solicitud) {
    doc.text('Fecha solicitud: ' + String(head.Fecha_Solicitud), pw - 14, 21, { align: 'right' });
  }
  doc.setFont(undefined, 'normal');

  if (headerInfo) {
    doc.setFontSize(7);
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

  // Client data
  var left = [
    ['Cliente', head.Cliente || ''],
    ['NIT', head.NIT || ''],
    ['Telefono', head.Telefono || ''],
    ['Correo', head.Correo || '']
  ];
  var right = [
    ['N° Factura', head.Num_Factura || ''],
    ['Fecha compra', head.Fecha_Compra || ''],
    ['Fecha recogida', head.Fecha_Recogida || ''],
    ['Estado', head.Estado || 'Pendiente']
  ];

  var y = headerH + 10;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(9);
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
  y += 4;

  // Mercancía a Cambiar
  if (ctx.cambiar.length) {
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(192, 57, 43);
    doc.text('Mercancia a cambiar (devuelve el cliente)', 14, y + 4);
    y += 6;
    doc.autoTable({
      startY: y,
      head: [['#', 'Producto', 'Cantidad', 'Lote / Vencimiento', 'Razon del cambio']],
      body: ctx.cambiar.map(function(l, i) {
        return [ i + 1, String(l.Producto || ''), Number(l.Cantidad) || 0, String(l.Lote_Vencimiento || ''), String(l.Razon_Cambio || '') ];
      }),
      theme: 'grid',
      headStyles: { fillColor: [192, 57, 43], fontSize: 8, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35 },
      bodyStyles: { fontSize: 8, lineColor: [90, 90, 90], lineWidth: 0.3 },
      columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 2: { halign: 'right', cellWidth: 22 } },
      margin: { left: 14, right: 14 },
      styles: { cellPadding: 3 },
      tableLineColor: [60, 60, 60],
      tableLineWidth: 0.5
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Mercancía a Entregar
  if (ctx.entregar.length) {
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(39, 174, 96);
    doc.text('Mercancia a entregar (nueva para el cliente)', 14, y + 4);
    y += 6;
    doc.autoTable({
      startY: y,
      head: [['#', 'Producto', 'Cantidad', 'Lote / Vencimiento', 'Fecha del cambio']],
      body: ctx.entregar.map(function(l, i) {
        return [ i + 1, String(l.Producto || ''), Number(l.Cantidad) || 0, String(l.Lote_Vencimiento || ''), String(l.Fecha_Cambio || '') ];
      }),
      theme: 'grid',
      headStyles: { fillColor: [39, 174, 96], fontSize: 8, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35 },
      bodyStyles: { fontSize: 8, lineColor: [90, 90, 90], lineWidth: 0.3 },
      columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 2: { halign: 'right', cellWidth: 22 } },
      margin: { left: 14, right: 14 },
      styles: { cellPadding: 3 },
      tableLineColor: [60, 60, 60],
      tableLineWidth: 0.5
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Valores
  var vc = Number(head.Valor_Cliente) || 0;
  var ve = Number(head.Valor_Empresa) || 0;
  if (vc || ve) {
    doc.setFillColor(247, 250, 252);
    doc.roundedRect(14, y, pw - 28, 14, 2, 2, 'F');
    doc.setDrawColor(200, 210, 220);
    doc.roundedRect(14, y, pw - 28, 14, 2, 2, 'S');
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    doc.text('Valor a favor del cliente: ' + fmtMoney(vc), 18, y + 9);
    doc.text('Valor a favor de la empresa: ' + fmtMoney(ve), pw - 18, y + 9, { align: 'right' });
    y += 18;
  }

  // Observaciones
  if (head.Observaciones) {
    var obsMaxW = pw - 28 - 40;
    var obsLines = doc.splitTextToSize(String(head.Observaciones), obsMaxW);
    var obsH = Math.max(14, obsLines.length * 4 + 8);
    doc.setFillColor(254, 249, 231);
    doc.roundedRect(14, y, pw - 28, obsH, 2, 2, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(125, 102, 8);
    doc.setFontSize(9);
    doc.text('Observaciones:', 18, y + 5);
    doc.setFont(undefined, 'normal');
    doc.text(obsLines, 54, y + 5);
    y += obsH + 4;
  }

  // Footer generado
  var ph = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(grayText[0], grayText[1], grayText[2]);
  doc.text('Generado: ' + new Date().toLocaleString('es-CO'), 14, ph - 5);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text('OP-PDC-FO11', pw / 2, ph - 5, { align: 'center' });

  var sigla = (typeof getSigla === 'function' ? getSigla(head.Empresa) : '') || 'Cambio';
  doc.save('Solicitud_Cambio_' + sigla + '_' + (head.Consecutivo || 'nuevo') + '.pdf');
}

function exportarCamRemisionPDF(tipo) {
  var ctx = _camViewContext();
  if (!ctx) return;
  var head = ctx.head;
  var esIngreso = tipo === 'ingreso';
  var remision = esIngreso ? (head.Remision_Ingreso || '') : (head.Remision_Salida || '');
  var bodega = esIngreso ? (head.Bodega_Ingreso || '') : (head.Bodega_Salida || '');
  var fechaRem = esIngreso ? (head.Fecha_Ingreso || '') : (head.Fecha_Salida || '');
  if (!remision) {
    showToast('Este cambio no tiene remisión de ' + tipo + ' registrada.', '#e67e22');
    return;
  }

  // Ingreso = producto que devuelve el cliente (CAMBIAR)
  // Salida  = producto nuevo para el cliente (ENTREGAR)
  var srcLines = esIngreso ? ctx.cambiar : ctx.entregar;
  if (!srcLines.length) {
    showToast('No hay productos de tipo ' + (esIngreso ? 'a cambiar' : 'a entregar') + ' para incluir.', '#e67e22');
    return;
  }
  var entregas = srcLines.map(function(l) {
    return {
      producto: l.Producto || '',
      presentacion: l.Lote_Vencimiento || '',
      cantidad: Number(l.Cantidad) || 0,
      valor_unitario: 0,
      valor_total: 0,
      bonificado: 'No'
    };
  }).filter(function(p) { return (p.cantidad || 0) > 0 || p.producto; });

  var left = [
    ['Cliente', head.Cliente || ''],
    ['NIT', head.NIT || ''],
    ['Telefono', head.Telefono || ''],
    ['N° Factura', head.Num_Factura || '']
  ];
  var right = [
    ['Correo', head.Correo || ''],
    ['Bodega', bodega || ''],
    ['Fecha compra', head.Fecha_Compra || ''],
    ['Estado', head.Estado || 'Pendiente']
  ];

  generarRemisionPDF({
    empresa: head.Empresa || '',
    consecutivo: head.Consecutivo || '',
    doc_title: esIngreso ? 'REMISION DE INGRESO' : 'REMISION DE SALIDA',
    ref_label: 'Cambio',
    date_label: 'Fecha remision',
    fecha_entrega: fechaRem || '',
    remision: remision,
    cliente: head.Cliente || '',
    nit: head.NIT || '',
    telefono: head.Telefono || '',
    left_fields: left,
    right_fields: right,
    entregas: entregas,
    qty_header: 'Cantidad',
    file_prefix: esIngreso ? 'Remision_Ingreso_Cambio' : 'Remision_Salida_Cambio'
  });
}

// ── Init ──
loadCatalogoCam();
loadClientesCam();
