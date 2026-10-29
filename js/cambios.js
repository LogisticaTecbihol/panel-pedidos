// ── State ──
var cambios = [];
var editCam = null;
var camLineasCambiar = [];
var camLineasEntregar = [];
var deleteCamGroupIds = null;
var gestionarCamIds = null;
var gestionarCamEmpresa = '';
var gestionarCamWorkingLines = [];
var camAsig = null;
// Gestionar Cambio: qué se va a registrar en esta pasada
var gestionarCamLados = 'ambos';       // 'ambos' | 'ingreso' | 'salida' | 'faltante' | 'sinrecepcion'
var gestionarCamResumen = null;        // camResumenGrupo() del cambio al abrir (pendientes y remisiones previas)
var gestionarCamIngLines = [];         // líneas que admiten ingreso: [{id, Producto, Lote, Cantidad, hecha, pend}]
var gestionarCamSalLines = [];         // líneas que admiten salida (mismo formato)
var catalogoProductosCam = [];
var catalogoClientesCam = [];
var camViewingKey = null;
var ocsLegalizadasPorCambio = {};
// Sub-pestaña activa: 'pendientes' (estado Pendiente) o 'tramitadas' (Completado + Cerrado, solo lectura)
var camScope = 'pendientes';

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
    var results = await Promise.all([
      apiGet('getCambios'),
      apiGet('getOrdenesCompra', {
        columns: 'id,Consecutivo,Tipo,Estado,Remision,Remision_Origen,Empresa_Origen,Empresa_Destino,Producto,Presentacion,Cantidad,Valor_Unitario,Valor_Total,Fecha,Ref_Pedido'
      }).catch(function() { return { ok: true, ordenes: [] }; })
    ]);
    var data = results[0];
    var ocData = results[1];
    if (!data.ok) throw new Error(data.error || 'Error desconocido');
    cambios = (data.cambios || []).map(function(r) {
      if (r.Fecha_Solicitud instanceof Date) r.Fecha_Solicitud = r.Fecha_Solicitud.toISOString().slice(0,10);
      return r;
    });
    ocsLegalizadasPorCambio = _buildOCsLegalizadasCam((ocData && ocData.ok && ocData.ordenes) || []);
    populateCamFilters();
    renderCamTable();
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
  } catch (err) {
    setSyncStatus('error', 'Error al cargar cambios: ' + err.message);
  }
}

function _buildOCsLegalizadasCam(ordenes) {
  var map = {};
  (ordenes || []).forEach(function(oc) {
    if (String(oc.Tipo || '').toLowerCase() !== 'traslado') return;
    var remDest = String(oc.Remision || '').trim();
    var remOrig = String(oc.Remision_Origen || '').trim();
    if (!remDest && !remOrig) return;
    var ref = String(oc.Ref_Pedido || '').trim();
    var m = ref.match(/^(.+)\s+Cambio\s+#(.+)$/i);
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
      var nitL = c.nit ? ' <span style="color:#718096;font-size:0.75rem">NIT: '+escHtml(c.nit)+'</span>' : '';
      var muniL = c.municipio ? ' <span style="color:#a0aec0;font-size:0.72rem">· '+escHtml(c.municipio)+'</span>' : '';
      item.innerHTML = '<span style="font-weight:600">'+escHtml(c.cliente)+'</span>'+nitL+muniL;
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        document.getElementById('cam-cliente').value = c.cliente || '';
        document.getElementById('cam-nit').value = c.nit || '';
        document.getElementById('cam-telefono').value = c.telefono || '';
        closeCamClientAC();
        camAplicarEntregaCliente(c);
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

// ── Datos de entrega: Sucursal · Dirección · Municipio · Departamento ──
// Misma lógica que «Nuevo Pedido»: las opciones de Sucursal y lo que se rellena al elegir el cliente salen de su
// ficha en Clientes y de sus pedidos anteriores (js/entrega-cliente.js); Departamento y Municipio se eligen de la
// lista oficial (js/colombia-geo.js) y se normalizan al guardar.
var camSucursalMapa = {};          // texto de la sucursal (minúscula) → {direccion, municipio, departamento}
var camEntregaToken = 0;           // descarta la respuesta tardía de un cliente que ya no es el elegido
var camPedidosClienteCache = {};   // nombre del cliente (minúscula) → líneas de sus pedidos
var camEntregaBound = false;

async function camPedidosDeCliente(nombre) {
  var k = entregaNormCliente(nombre);
  if (!k) return [];
  if (camPedidosClienteCache[k]) return camPedidosClienteCache[k];
  try {
    var r = await apiGet('getPedidosDeCliente', {
      cliente: nombre,
      columns: 'Cliente,Nombre_Empresa,Fecha_Pedido,Municipio,Departamento,Direccion_Envio,Sucursal'
    });
    if (r && r.ok) { camPedidosClienteCache[k] = r.pedidos || []; return camPedidosClienteCache[k]; }
  } catch (e) {}
  return [];   // sin pedidos previos o sin acceso: quedan solo los datos de la ficha del cliente
}

// Arma la lista de sucursales del cliente (datalist) y devuelve las opciones con su mapa.
function camLlenarSucursales(nombre, pedidos) {
  var suc = entregaSucursales(nombre, catalogoClientesCam, pedidos);
  camSucursalMapa = suc.mapa;
  var dl = document.getElementById('dl-cam-sucursal');
  if (dl) dl.innerHTML = suc.opciones.map(function(o) { return '<option value="' + escHtml(o) + '">'; }).join('');
  return suc;
}

// Al elegir un cliente de la lista: sucursales disponibles y datos por defecto (ficha del cliente y, donde falten, su último pedido).
async function camAplicarEntregaCliente(c) {
  var token = ++camEntregaToken;
  var pedidos = await camPedidosDeCliente(c.cliente);
  if (token !== camEntregaToken) return;
  var suc = camLlenarSucursales(c.cliente, pedidos);
  var def = entregaPorDefecto(c, suc, pedidos);
  document.getElementById('cam-sucursal').value = def.sucursal;
  document.getElementById('cam-direccion').value = def.direccion;
  document.getElementById('cam-municipio').value = def.municipio;
  document.getElementById('cam-departamento').value = def.departamento;
}

// Al editar un cambio: solo las sucursales del cliente; los valores guardados no se tocan.
async function camCargarSucursalesCliente(nombre) {
  var token = ++camEntregaToken;
  camLlenarSucursales(nombre, []);
  var pedidos = await camPedidosDeCliente(nombre);
  if (token !== camEntregaToken) return;
  camLlenarSucursales(nombre, pedidos);
}

function camOnSucursalChange() {
  var m = camSucursalMapa[document.getElementById('cam-sucursal').value.trim().toLowerCase()];
  if (!m) return;
  document.getElementById('cam-direccion').value = m.direccion;
  document.getElementById('cam-municipio').value = m.municipio;
  document.getElementById('cam-departamento').value = m.departamento;
}

function camSetupEntrega() {
  if (camEntregaBound) return;
  camEntregaBound = true;
  document.getElementById('cam-sucursal').addEventListener('change', camOnSucursalChange);
  setupGeoAutocomplete(document.getElementById('cam-departamento'), document.getElementById('cam-municipio'));
}

// ── Product autocomplete for cambio lines ──
// Se posiciona con position:fixed y se cuelga de document.body para que la
// lista no quede recortada por los contenedores overflow-x:auto de las
// tablas ni por el scroll interno del modal (.mbody).
function _positionAcDropdownCam(inp, list) {
  var rect = inp.getBoundingClientRect();
  var vw = window.innerWidth, vh = window.innerHeight;
  var width = rect.width;
  var left = Math.min(rect.left, vw - width - 8);
  if (left < 8) left = 8;
  list.style.left = left + 'px';
  list.style.width = width + 'px';
  var spaceBelow = vh - rect.bottom - 12;
  var spaceAbove = rect.top - 12;
  if (spaceBelow < 160 && spaceAbove > spaceBelow) {
    list.style.top = '';
    list.style.bottom = (vh - rect.top + 4) + 'px';
    list.style.maxHeight = Math.max(Math.min(350, spaceAbove), 100) + 'px';
  } else {
    list.style.bottom = '';
    list.style.top = (rect.bottom + 4) + 'px';
    list.style.maxHeight = Math.max(Math.min(350, spaceBelow), 100) + 'px';
  }
}
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
    list.style.cssText = 'position:fixed;z-index:2000;background:white;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);overflow-y:auto';
    matches.slice(0,25).forEach(function(p) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f4f8;display:flex;justify-content:space-between';
      item.innerHTML = '<span style="font-weight:600">'+escHtml(p.producto||'')+'</span><span style="color:#718096;font-size:0.75rem">'+escHtml(p.presentacion||'')+'</span>';
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        inp.value = p.producto;
        closeCamProdAC();
      });
      item.addEventListener('mouseover', function() { this.style.background='#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background='white'; });
      list.appendChild(item);
    });
    document.body.appendChild(list);
    _positionAcDropdownCam(inp, list);
  });
  inp.addEventListener('blur', function() { setTimeout(closeCamProdAC, 150); });
}
function closeCamProdAC() {
  document.querySelectorAll('.cam-prod-ac').forEach(function(el) { el.remove(); });
}
window.addEventListener('scroll', closeCamProdAC, true);
window.addEventListener('resize', closeCamProdAC);

// ── Filters ──
var camFiltersAttached = false;
function populateCamFilters() {
  var clientes = [];
  cambios.forEach(function(r) {
    if (r.Cliente && clientes.indexOf(r.Cliente) < 0) clientes.push(r.Cliente);
  });
  clientes.sort();
  var fc = document.getElementById('fc-cliente');
  fc.innerHTML = '<option value="">Todos</option>' + clientes.map(function(c) { return '<option value="'+escHtml(c)+'">'+escHtml(c)+'</option>'; }).join('');
  if (!camFiltersAttached) {
    ['fc-empresa','fc-cliente','fc-estado','fc-mostrar-historicos'].forEach(function(id) {
      var elCamF = document.getElementById(id);
      if (elCamF) elCamF.addEventListener('change', renderCamTable);
    });
    document.getElementById('fc-txt').addEventListener('input', debounce(renderCamTable, 300));
    camFiltersAttached = true;
  }
}
function filteredCam() {
  var fe = document.getElementById('fc-empresa').value;
  var fc = document.getElementById('fc-cliente').value;
  var fst = document.getElementById('fc-estado').value;
  var ft = document.getElementById('fc-txt').value.toLowerCase();
  var fMostrarHistCam = document.getElementById('fc-mostrar-historicos');
  var mostrarHistoricosCam = !!(fMostrarHistCam && fMostrarHistCam.checked);
  return cambios.filter(function(r) {
    if (!mostrarHistoricosCam && r.Historico) return false;
    if (fe && r.Empresa !== fe) return false;
    if (fc && r.Cliente !== fc) return false;
    if (fst && r.Estado !== fst) return false;
    if (ft) {
      var hay = [r.Cliente, r.NIT, r.Producto, r.Num_Factura, r.Razon_Cambio, r.Observaciones, r.Observacion_Cierre, r.Consecutivo, r.Correo, r.Sucursal, r.Direccion_Envio, r.Municipio, r.Departamento].join(' ').toLowerCase();
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
  var fMostrarHistCamClr = document.getElementById('fc-mostrar-historicos');
  if (fMostrarHistCamClr) fMostrarHistCamClr.checked = false;
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
    g.head._res = camResumenGrupo(g.lines);
    return g.head;
  });
}

// ── Render ──
function renderCamTable() {
  var filtered = filteredCam();
  var grouped = groupCambios(filtered);
  grouped.sort(function(a, b) { return (b.Fecha_Solicitud || '').localeCompare(a.Fecha_Solicitud || ''); });

  // Ámbito de la sub-pestaña: Pendientes (Pendiente + Parcial) vs Tramitadas (Completado + Cerrado)
  if (camScope === 'tramitadas') grouped = grouped.filter(function(g) { var e = g._estado || 'Pendiente'; return e !== 'Pendiente' && e !== 'Parcial'; });
  else grouped = grouped.filter(function(g) { var e = g._estado || 'Pendiente'; return e === 'Pendiente' || e === 'Parcial'; });

  var camListTitle = document.getElementById('cam-list-title');
  if (camListTitle) camListTitle.textContent = camScope === 'tramitadas' ? 'Cambios tramitados (consulta)' : 'Cambios pendientes';

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
  document.getElementById('sc-pendientes').textContent = allGrouped.filter(function(g) { return g._estado === 'Pendiente' || g._estado === 'Parcial'; }).length;
  document.getElementById('row-ct-cam').textContent = '(' + grouped.length + ' mostrados)';

  // Header
  var cols = ['#','Fecha','Empresa','Consec.','Cliente','NIT','Factura','Prod. Cambiar','Prod. Entregar','Estado','Acción'];
  document.getElementById('t-head-cam').innerHTML = cols.map(function(c) { return '<th>'+c+'</th>'; }).join('');

  var tbody = document.getElementById('t-body-cam');
  if (!grouped.length) {
    var emptyMsg = camScope === 'tramitadas' ? 'No hay cambios tramitados.' : 'No hay cambios pendientes.';
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty">' + emptyMsg + '</div></td></tr>';
    return;
  }

  tbody.innerHTML = grouped.map(function(r, i) {
    var keyEsc = escHtml(r._key||'').replace(/&#39;/g, "\\'");
    var esPend = r._estado === 'Pendiente';
    var esCerrado = r._estado === 'Cerrado';
    var esParcial = r._estado === 'Parcial';
    var res = r._res || camResumenGrupo(r._lines);
    var faltaTxt = 'Falta: ' + [res.pendIng > 0 ? 'ingreso ' + res.pendIng + ' ud' : '', res.pendSal > 0 ? 'salida ' + res.pendSal + ' ud' : ''].filter(Boolean).join(' · ');
    var estadoBadge = (esCerrado && r.Cierre_Sin_Recepcion)
      ? '<span style="background:#ffe8d1;color:#a04000;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700" title="'+escHtml('Cerrado sin recibir el producto: '+(r.Observacion_Cierre||''))+'">Cerrado sin recepción</span>'
      : (esCerrado && r.Cierre_Con_Faltante)
      ? '<span style="background:#ffe8d1;color:#a04000;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700" title="'+escHtml('Cerrado con faltante: '+(r.Observacion_Cierre||''))+'">Cerrado con faltante</span>'
      : esCerrado
      ? '<span style="background:#d1ecf1;color:#0c5460;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Cerrado</span>'
      : esParcial
        ? '<span style="background:#ffe8cc;color:#b45309;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700" title="'+escHtml(faltaTxt)+'">Parcial</span>' +
          '<div style="font-size:0.68rem;color:#b45309;margin-top:2px;white-space:nowrap">'+escHtml(faltaTxt)+'</div>'
        : esPend
          ? '<span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Pendiente</span>'
          : '<span style="background:#d4edda;color:#155724;padding:3px 10px;border-radius:10px;font-size:0.74rem;font-weight:700">Completado</span>';
    var gestionarBtn = (AUTH.canEdit() && camScope !== 'tramitadas') ? '<button onclick="openGestionarCam(\''+keyEsc+'\')" title="Gestionar cambio" style="background:#27ae60;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📝 Gestionar</button>' : '';
    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">'+(i+1)+'</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">'+fmtDate(r.Fecha_Solicitud)+'</td>' +
      '<td title="'+escHtml(r.Empresa||'')+'"><span class="sigla-badge '+getSiglaClassCam(r.Empresa)+'">'+escHtml(getSiglaCam(r.Empresa))+'</span></td>' +
      '<td style="text-align:center;font-weight:600">'+escHtml(r.Consecutivo||'—')+'</td>' +
      '<td style="font-weight:600;font-size:0.82rem">'+escHtml(r.Cliente||'—')+'</td>' +
      '<td style="font-size:0.78rem">'+escHtml(r.NIT||'—')+'</td>' +
      '<td style="font-size:0.78rem">'+escHtml(r.Num_Factura||'—')+'</td>' +
      '<td style="text-align:center"><span style="background:#fde8e8;color:#c0392b;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.8rem">'+(r._nCambiar||0)+'</span></td>' +
      '<td style="text-align:center"><span style="background:#e8f8f0;color:#27ae60;padding:2px 8px;border-radius:10px;font-weight:700;font-size:0.8rem">'+(r._nEntregar||0)+'</span></td>' +
      '<td style="text-align:center">'+estadoBadge+'</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
        '<button onclick="viewCamDetail(\''+keyEsc+'\')" title="Ver detalle" style="background:#3498db;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📋 Ver</button>' +
        gestionarBtn +
        (AUTH.canEdit() && camScope !== 'tramitadas' ? '<button onclick="openEditCamGroup(\''+keyEsc+'\')" title="Editar" style="background:#8e44ad;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">✏️</button>' : '') +
        (AUTH.canDeleteIn('cambios') && camScope !== 'tramitadas' ? '<button class="btn-del" onclick="openDeleteCamGroup(\''+keyEsc+'\')" title="Eliminar">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Sub-tab switching (Pendientes / Tramitadas) ──
function switchCamSubTab(tab) {
  camScope = (tab === 'tramitadas') ? 'tramitadas' : 'pendientes';
  var bp = document.getElementById('cam-subtab-pendientes');
  var bt = document.getElementById('cam-subtab-tramitadas');
  if (bp) bp.style.background = camScope === 'pendientes' ? '#8e44ad' : '#718096';
  if (bt) bt.style.background = camScope === 'tramitadas' ? '#8e44ad' : '#718096';
  var panel = document.getElementById('panel-cam-lista');
  if (panel) panel.classList.toggle('solo-lectura', camScope === 'tramitadas');
  renderCamTable();
}

// ── Detail view ──
function viewCamDetail(key) {
  var lines = cambios.filter(function(r) {
    return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  var r = lines[0];
  function cf(label, val) {
    return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">'+label+'</span><br><span style="font-size:0.85rem;color:#2d3748">'+escHtml(val||'—')+'</span></div>';
  }
  // cfHtml: cuando el valor YA es HTML de confianza (badges), no escapar.
  function cfHtml(label, htmlVal) {
    return '<div><span style="font-weight:700;color:#4a5568;font-size:0.76rem;text-transform:uppercase">'+label+'</span><br>'+htmlVal+'</div>';
  }
  var res = camResumenGrupo(lines);
  var estadoLabel = (r.Estado === 'Cerrado' && r.Cierre_Sin_Recepcion)
    ? '<span style="background:#ffe8d1;color:#a04000;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Cerrado sin recepción</span>'
    : (r.Estado === 'Cerrado' && r.Cierre_Con_Faltante)
    ? '<span style="background:#ffe8d1;color:#a04000;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Cerrado con faltante</span>'
    : r.Estado === 'Cerrado'
    ? '<span style="background:#d1ecf1;color:#0c5460;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Cerrado</span>'
    : r.Estado === 'Parcial'
      ? '<span style="background:#ffe8cc;color:#b45309;padding:2px 8px;border-radius:8px;font-size:0.82rem;font-weight:700">Parcial</span>'
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
    cf('Sucursal', r.Sucursal) +
    cf('Dirección', r.Direccion_Envio) +
    cf('Municipio', r.Municipio) +
    cf('Departamento', r.Departamento) +
    cfHtml('Estado', estadoLabel) +
    '</div>' +
    (r.Cierre_Sin_Recepcion
      ? '<div style="background:#fff3e6;border:1px solid #f5b87a;border-radius:8px;padding:12px 14px;margin-bottom:18px">' +
          '<div style="font-weight:700;font-size:0.82rem;color:#a04000;margin-bottom:6px">🚫 Cerrado sin recibir el producto</div>' +
          '<div style="font-size:0.85rem;color:#2d3748;white-space:pre-wrap">'+escHtml(r.Observacion_Cierre||'—')+'</div>' +
        '</div>'
      : '') +
    (r.Cierre_Con_Faltante
      ? '<div style="background:#fff3e6;border:1px solid #f5b87a;border-radius:8px;padding:12px 14px;margin-bottom:18px">' +
          '<div style="font-weight:700;font-size:0.82rem;color:#a04000;margin-bottom:6px">⚠️ Cerrado con faltante — lo pendiente no movió inventario</div>' +
          '<div style="font-size:0.85rem;color:#2d3748;white-space:pre-wrap">'+escHtml(r.Observacion_Cierre||'—')+'</div>' +
        '</div>'
      : '') +
    (function() {
      if (!res.ingresos.length && !res.salidas.length) {
        var m = (r.Observaciones||'').match(/\[Remisión:\s*(.+?)\s*\|\s*Fecha:\s*(.+?)\]/);
        if (m) return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 24px;margin-bottom:18px;font-size:0.85rem">' + cf('N° Remisión (legado)', m[1]) + cf('Fecha Remisión', fmtDate(m[2])) + '</div>';
        return '';
      }
      // Una tarjeta por remisión: un cambio tramitado por partes puede tener varias de ingreso y de salida.
      function tarjeta(tipo, g) {
        var esIng = tipo === 'ingreso';
        var color = esIng ? '#e65100' : '#2e7d32';
        var items = g.items.map(function(it) {
          return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:0.78rem;color:#4a5568"><span>' + escHtml(it.producto || '—') + (it.lote ? ' <span style="color:#a0aec0">(' + escHtml(it.lote) + ')</span>' : '') + '</span><strong>' + it.cant + '</strong></div>';
        }).join('');
        return '<div style="background:' + (esIng ? '#fff8e1' : '#e8f5e9') + ';border:1px solid ' + (esIng ? '#ffe082' : '#a5d6a7') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">' +
            '<div style="font-weight:700;font-size:0.82rem;color:' + color + '">' + (esIng ? '📥 Remisión de Ingreso' : '📤 Remisión de Salida') + ' · ' + escHtml(g.rem) + '</div>' +
            '<button onclick="exportarCamRemisionPDF(\'' + tipo + '\',{rem:this.dataset.rem})" data-rem="' + escHtml(g.rem) + '" title="Exportar esta remisión a PDF" style="background:' + color + ';color:#fff;border:none;border-radius:5px;padding:3px 9px;font-size:0.72rem;font-weight:700;cursor:pointer">📄 PDF</button>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 16px;margin-bottom:8px">' +
            cf('Bodega', g.bodega || '') + cf('Fecha', g.fecha ? fmtDate(g.fecha) : '—') + cf('Unidades', String(g.total)) +
          '</div>' + items + '</div>';
      }
      var h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;align-items:start;margin-bottom:8px">';
      h += '<div>' + (res.ingresos.length ? res.ingresos.map(function(g) { return tarjeta('ingreso', g); }).join('') : '<div style="font-size:0.8rem;color:#a0aec0;padding:10px 4px">📥 Sin ingresos registrados</div>') + '</div>';
      h += '<div>' + (res.salidas.length ? res.salidas.map(function(g) { return tarjeta('salida', g); }).join('') : '<div style="font-size:0.8rem;color:#a0aec0;padding:10px 4px">📤 Sin salidas registradas</div>') + '</div>';
      h += '</div>';
      return h;
    })();

  var linesCambiar = lines.filter(function(l) { return l.Tipo_Linea === 'CAMBIAR'; });
  var linesEntregar = lines.filter(function(l) { return l.Tipo_Linea === 'ENTREGAR'; });
  var hayAvance = res.hayIng || res.haySal;   // con avance se muestran las columnas de lo tramitado y lo pendiente
  function celdasAvance(l, lado) {
    if (!camLadoAplica(l, lado, res.te)) return '<td></td><td></td>';
    var hecha = camCantHecha(l, lado), pend = camCantPendiente(l, lado);
    var cerrado = r.Estado === 'Cerrado';
    return '<td style="text-align:right">' + hecha + '</td><td style="text-align:right;font-weight:700;color:' + (pend > 0 ? (cerrado ? '#a04000' : '#e67e22') : '#27ae60') + '">' + (pend > 0 ? pend : '✓') + '</td>';
  }

  if (linesCambiar.length) {
    // Sin líneas ENTREGAR el mismo producto sale en la misma línea: también muestra lo entregado
    var camSalida = !res.te;
    html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-bottom:10px;font-weight:700;font-size:0.84rem;color:#c0392b">📦 Mercancía a cambiar ('+linesCambiar.length+')</div>';
    html += '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#fdf2f2">' +
      '<th>Producto</th><th style="text-align:right">Cantidad</th>' +
      (hayAvance ? '<th style="text-align:right">Ingresada</th><th style="text-align:right">Falta</th>' + (camSalida ? '<th style="text-align:right">Entregada</th><th style="text-align:right">Falta</th>' : '') : '') +
      '<th>Lote / Vencimiento</th><th>Razón</th></tr></thead><tbody>';
    linesCambiar.forEach(function(x) {
      html += '<tr><td style="font-weight:600">'+escHtml(x.Producto||'—')+'</td><td style="text-align:right">'+(x.Cantidad||0)+'</td>' +
        (hayAvance ? celdasAvance(x, 'ingreso') + (camSalida ? celdasAvance(x, 'salida') : '') : '') +
        '<td>'+escHtml(x.Lote_Vencimiento||'—')+'</td><td>'+escHtml(x.Razon_Cambio||'—')+'</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  if (linesEntregar.length) {
    html += '<div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px;margin-bottom:10px;font-weight:700;font-size:0.84rem;color:#27ae60">📦 Mercancía a entregar ('+linesEntregar.length+')</div>';
    html += '<div style="overflow-x:auto"><table style="font-size:0.82rem;width:100%"><thead><tr style="background:#f0faf4">' +
      '<th>Producto</th><th style="text-align:right">Cantidad</th>' +
      (hayAvance ? '<th style="text-align:right">Entregada</th><th style="text-align:right">Falta</th>' : '') +
      '<th>Lote / Vencimiento</th><th>Fecha Cambio</th></tr></thead><tbody>';
    linesEntregar.forEach(function(x) {
      html += '<tr><td style="font-weight:600">'+escHtml(x.Producto||'—')+'</td><td style="text-align:right">'+(x.Cantidad||0)+'</td>' +
        (hayAvance ? celdasAvance(x, 'salida') : '') +
        '<td>'+escHtml(x.Lote_Vencimiento||'—')+'</td><td>'+(x.Fecha_Cambio ? fmtDate(x.Fecha_Cambio) : '—')+'</td></tr>';
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
      '<div style="font-size:0.85rem;color:#2d3748;background:#f7fafc;padding:10px 14px;border-radius:6px">'+escHtml(r.Observaciones||'')+'</div></div>';
  }

  html += '<div class="adjuntos-section" id="cam-adjuntos-section">' +
    '<div class="adjuntos-header">' +
      '<h4>📎 Archivos adjuntos <span class="adjuntos-count" id="cam-adjuntos-count"></span></h4>' +
      (AUTH.canEdit() ? '<button class="btn-adjuntar" onclick="document.getElementById(\'cam-adjunto-input\').click()">📤 Adjuntar archivo</button>' : '') +
    '</div>' +
    '<div class="adjuntos-list" id="cam-adjuntos-list"><div class="adjuntos-empty">Sin archivos adjuntos</div></div>' +
    (AUTH.canEdit() ? '<div class="adjunto-dropzone" id="cam-adjunto-dropzone" onclick="document.getElementById(\'cam-adjunto-input\').click()">' +
      'Arrastra un archivo aquí o haz clic para seleccionar · PDF, JPG, PNG (máx. 5 MB)' +
      '<input type="file" id="cam-adjunto-input" accept=".pdf,.jpg,.jpeg,.png,.webp" onchange="handleCamAdjuntoUpload(this)">' +
    '</div>' : '') +
    '<div class="adjunto-upload-progress" id="cam-adjunto-progress">' +
      '<div class="prog-bar"><div class="prog-fill" id="cam-adjunto-prog-fill" style="width:0%"></div></div>' +
      '<div class="prog-text" id="cam-adjunto-prog-text">Subiendo...</div>' +
    '</div>' +
  '</div>';

  html += _auditoriaHtml(lines, false);

  document.getElementById('view-cam-meta').innerHTML =
    '<span>📋 Consec: '+escHtml(r.Consecutivo||'—')+'</span>' +
    '<span>👤 '+escHtml(r.Cliente||'—')+'</span>';
  document.getElementById('view-cam-body').innerHTML = html;
  document.getElementById('view-cam-overlay').classList.add('show');

  camViewingKey = key;
  initCamDropzone();
  loadCamAdjuntos(r.Empresa, r.Consecutivo || r.id, r.Cliente);
  var btnIn = document.getElementById('btn-cam-rem-ingreso');
  var btnOut = document.getElementById('btn-cam-rem-salida');
  var sendIn = document.getElementById('btn-cam-send-ingreso');
  var sendOut = document.getElementById('btn-cam-send-salida');
  // El PDF de cada remisión sale de su tarjeta (un cambio puede tener varias de ingreso y de salida)
  if (btnIn) btnIn.style.display = 'none';
  if (btnOut) btnOut.style.display = 'none';
  if (sendIn) sendIn.style.display = 'none';
  if (sendOut) sendOut.style.display = 'none';

  if (typeof NOTIF !== 'undefined' && NOTIF.verificarBtn) {
    var _cCam = r.Consecutivo || '';
    var _remIngC = (r.Remision_Ingreso || '').trim();
    var _remSalC = (r.Remision_Salida || '').trim();
    var _btnSolCam = document.querySelector('#view-cam-overlay button[onclick*="exportarCamSolicitudPDF"]');
    if (_btnSolCam) {
      _btnSolCam.disabled = false; _btnSolCam.style.opacity = ''; _btnSolCam.style.cursor = '';
      _btnSolCam.textContent = '📨 Enviar Solicitud';
      if (_cCam) NOTIF.verificarBtn(_btnSolCam, 'cambios', _cCam);
    }
    if (sendIn) {
      sendIn.disabled = false; sendIn.style.opacity = ''; sendIn.style.cursor = '';
      sendIn.textContent = '📨 Enviar Ingreso';
      if (_remIngC) NOTIF.verificarBtn(sendIn, 'cambios', _cCam + ' · Rem ' + _remIngC);
    }
    if (sendOut) {
      sendOut.disabled = false; sendOut.style.opacity = ''; sendOut.style.cursor = '';
      sendOut.textContent = '📨 Enviar Salida';
      if (_remSalC) NOTIF.verificarBtn(sendOut, 'cambios', _cCam + ' · Rem ' + _remSalC);
    }
  }
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
  var chkHist = document.getElementById('cam-chk-historico');
  if (chkHist && chkHist.checked) return; // carga histórica: consecutivo manual
  var empresa = document.getElementById('cam-empresa').value;
  document.getElementById('cam-consecutivo').value = nextConsecutivoCam(empresa);
}

// Carga histórica (solo admin): registro anterior al 2026-07-01 que no debe
// afectar existencias/Kardex (se excluye vía columna Historico). El cambio
// ya se tramitó, así que se captura resuelto (Estado/remisiones) de una vez.
function toggleCargaHistoricaCam(on) {
  var wrap = document.getElementById('cam-hist-wrap');
  if (wrap) wrap.style.display = on ? 'grid' : 'none';
  var consecEl = document.getElementById('cam-consecutivo');
  if (consecEl) {
    consecEl.readOnly = !on;
    consecEl.style.background = on ? '' : '#f7fafc';
    consecEl.placeholder = on ? 'N° consecutivo original' : 'Automático';
  }
  var fechaEl = document.getElementById('cam-fecha-solicitud');
  if (fechaEl) fechaEl.min = on ? '' : today();
}

// ── New Cambio ──
function openNewCambio() {
  editCam = null;
  document.getElementById('cam-modal-title').textContent = '🔁 Registrar Cambio de Mercancía';
  document.getElementById('cam-empresa').value = '';
  document.getElementById('cam-empresa').onchange = onCamEmpresaChange;
  var camFecha = document.getElementById('cam-fecha-solicitud');
  camFecha.value = today();
  camFecha.min = today();
  if (!AUTH.isAdmin()) {
    camFecha.readOnly = true;
    camFecha.style.background = '#f0f0f0';
  } else {
    camFecha.readOnly = false;
    camFecha.style.background = '';
  }
  document.getElementById('cam-fecha-recogida').value = '';
  document.getElementById('cam-consecutivo').value = '';
  document.getElementById('cam-cliente').value = '';
  document.getElementById('cam-nit').value = '';
  document.getElementById('cam-telefono').value = '';
  document.getElementById('cam-correo').value = '';
  document.getElementById('cam-num-factura').value = '';
  document.getElementById('cam-sucursal').value = '';
  document.getElementById('cam-direccion').value = '';
  document.getElementById('cam-municipio').value = '';
  document.getElementById('cam-departamento').value = '';
  camEntregaToken++;
  camSucursalMapa = {};
  document.getElementById('dl-cam-sucursal').innerHTML = '';
  document.getElementById('cam-fecha-compra').value = '';
  document.getElementById('cam-valor-cliente').value = '';
  document.getElementById('cam-valor-empresa').value = '';
  document.getElementById('cam-observaciones').value = '';
  var chkHistCam = document.getElementById('cam-chk-historico');
  if (chkHistCam) chkHistCam.checked = false;
  var histWrapCam = document.getElementById('cam-hist-wrap');
  if (histWrapCam) histWrapCam.style.display = 'none';
  var remIngCamEl = document.getElementById('cam-hist-remision-ingreso');
  if (remIngCamEl) remIngCamEl.value = '';
  var remSalCamEl = document.getElementById('cam-hist-remision-salida');
  if (remSalCamEl) remSalCamEl.value = '';
  document.getElementById('btn-save-cam').disabled = false;
  document.getElementById('btn-save-cam').textContent = '✓ Registrar cambio';
  camLineasCambiar = [{ Producto:'', Cantidad:'', Lote_Vencimiento:'', Razon_Cambio:'' }];
  camLineasEntregar = [{ Producto:'', Cantidad:'', Lote_Vencimiento:'', Fecha_Cambio:'' }];
  renderCamLines('cambiar');
  renderCamLines('entregar');
  buildClientSearchCam();
  camSetupEntrega();
  camSoporte.limpiar();
  camSoporte.modoEdicion(false);
  document.getElementById('cam-overlay').classList.add('show');
}

function openEditCamGroup(key) {
  var lines = cambios.filter(function(r) {
    return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === key;
  });
  if (!lines.length) return;
  // Editar borra y vuelve a crear las líneas: se perderían las remisiones ya tramitadas por partes
  if (camTieneMovimientos(lines)) { showToast('Este cambio ya tiene ingresos o salidas registrados: no se puede editar. Usa «Gestionar» para tramitar lo pendiente.', '#e67e22'); return; }
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
  document.getElementById('cam-sucursal').value = r.Sucursal || '';
  document.getElementById('cam-direccion').value = r.Direccion_Envio || '';
  document.getElementById('cam-municipio').value = r.Municipio || '';
  document.getElementById('cam-departamento').value = r.Departamento || '';
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
  camSetupEntrega();
  camCargarSucursalesCliente(r.Cliente || '');
  camSoporte.limpiar();
  camSoporte.modoEdicion(true);
  document.getElementById('cam-overlay').classList.add('show');
}

function closeCamModal() {
  document.getElementById('cam-overlay').classList.remove('show');
  editCam = null;
  camEntregaToken++;
  closeCamProdAC();
  closeCamClientAC();
}
document.getElementById('cam-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeCamModal(); });
// Las listas de Departamento/Municipio (position:fixed) no siguen al contenido: se ocultan al desplazar el formulario.
document.getElementById('cam-overlay').addEventListener('scroll', function() {
  [].slice.call(document.querySelectorAll('.ac-dropdown')).forEach(function(dd) { dd.style.display = 'none'; });
}, true);

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
  var sucursal = document.getElementById('cam-sucursal').value.trim();
  var direccion = document.getElementById('cam-direccion').value.trim();
  var municipio = document.getElementById('cam-municipio').value.trim();
  var departamento = document.getElementById('cam-departamento').value.trim();
  var fechaCompra = document.getElementById('cam-fecha-compra').value;
  var valorCliente = Number(document.getElementById('cam-valor-cliente').value) || 0;
  var valorEmpresa = Number(document.getElementById('cam-valor-empresa').value) || 0;
  var observaciones = document.getElementById('cam-observaciones').value.trim();

  var chkHistCamSave = document.getElementById('cam-chk-historico');
  var esHistoricoCam = !!(chkHistCamSave && chkHistCamSave.checked && AUTH.isAdmin());

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!fechaSolicitud) { showToast('Selecciona la fecha de solicitud', '#e74c3c'); return; }
  if (!esHistoricoCam && !AUTH.isAdmin() && fechaSolicitud < today()) { showToast('La fecha de solicitud no puede ser anterior a hoy', '#e74c3c'); return; }
  if (!cliente) { showToast('Ingresa el nombre del cliente', '#e74c3c'); return; }
  // Municipio y departamento son obligatorios, salvo en la carga histórica (registros anteriores que pueden no tenerlos)
  if (!esHistoricoCam && !municipio) { showToast('Ingresa el municipio', '#e74c3c'); document.getElementById('cam-municipio').focus(); return; }
  if (!esHistoricoCam && !departamento) { showToast('Ingresa el departamento', '#e74c3c'); document.getElementById('cam-departamento').focus(); return; }
  // Igual que Nuevo Pedido: se corrige a la grafía oficial (js/colombia-geo.js) y se completa el departamento
  var geoCam = normalizarMunicipio(municipio, departamento);
  municipio = geoCam.municipio;
  departamento = geoCam.departamento || normalizarDepartamento(departamento);

  readCamLines();
  var validCambiar = camLineasCambiar.filter(function(l) { return l.Producto; });

  var validEntregar = camLineasEntregar.filter(function(l) { return l.Producto; });

  if (validCambiar.some(function(l) { return !(Number(l.Cantidad) > 0); })) {
    showToast('Ingresa una cantidad mayor a 0 en cada línea de "Mercancía a cambiar"', '#e74c3c');
    return;
  }
  if (validEntregar.some(function(l) { return !(Number(l.Cantidad) > 0); })) {
    showToast('Ingresa una cantidad mayor a 0 en cada línea de "Mercancía a entregar"', '#e74c3c');
    return;
  }

  // Los archivos de soporte van a la carpeta <empresa>/<consecutivo>_<cliente>: sin consecutivo no hay dónde ponerlos
  if (camSoporte.archivos().length && !consecutivo) { showToast('Ingresa el consecutivo para poder adjuntar archivos de soporte', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-cam');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  var header = {
    Empresa: empresa, Fecha_Solicitud: fechaSolicitud, Fecha_Recogida: fechaRecogida,
    Consecutivo: consecutivo, Cliente: cliente, NIT: nit, Telefono: telefono,
    Sucursal: sucursal, Direccion_Envio: direccion, Municipio: municipio, Departamento: departamento,
    Correo: correo, Num_Factura: numFactura, Fecha_Compra: fechaCompra,
    Valor_Cliente: valorCliente, Valor_Empresa: valorEmpresa, Observaciones: observaciones,
    Historico: esHistoricoCam
  };
  if (esHistoricoCam) {
    header.Estado = 'Cerrado';
    header.Remision_Ingreso = (document.getElementById('cam-hist-remision-ingreso').value || '').trim();
    header.Fecha_Ingreso = fechaSolicitud;
    header.Remision_Salida = (document.getElementById('cam-hist-remision-salida').value || '').trim();
    header.Fecha_Salida = fechaSolicitud;
  }

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
    // El cambio ya existe: un fallo al subir el soporte no lo deshace, solo se avisa (aspSubirSoporte no lanza).
    // Al editar no hay archivos: la zona se oculta (camSoporte.modoEdicion) y estos se manejan desde el detalle.
    var sop = await aspSubirSoporte(camSoporte, CAM_ADJUNTOS_BUCKET, camAdjuntoFolder(empresa, consecutivo, cliente), btn);
    closeCamModal();
    if (sop.falla) showToast('⚠️ Cambio registrado, pero ' + sop.falla, '#e67e22', 9000);
    else showToast('✅ ' + result.added + ' línea(s) registradas' + sop.extra);
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
  // Eliminar borraría también los movimientos de inventario que esas remisiones ya generaron
  if (camTieneMovimientos(lines)) { showToast('Este cambio ya tiene ingresos o salidas registrados: no se puede eliminar.', '#e67e22'); return; }
  var r = lines[0];
  deleteCamGroupIds = lines.map(function(l) { return l.__row || l.id; });
  document.getElementById('del-cam-msg').textContent = '¿Eliminar este cambio completo?';
  document.getElementById('del-cam-detail').innerHTML =
    'Cliente: <strong>'+escHtml(r.Cliente||'—')+'</strong> · Consec: <strong>'+escHtml(r.Consecutivo||'—')+'</strong><br>' +
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

// ── Gestionar Cambio (trámite por partes) ──
// Cada pasada registra lo que realmente ingresó y/o salió (cantidad por línea), con su propia remisión; lo que
// falta queda pendiente para otra pasada. El cambio queda «Parcial» mientras haya pendientes y «Cerrado» al
// completar ambos lados, o al cerrarlo con faltante / sin recepción. Todo se guarda con el RPC tramitar_cambio
// (action 'tramitarCambio' de shared.js), que valida las cantidades contra lo pendiente.
function _gcLineaGestion(l, lado) {
  return {
    id: l.__row || l.id, Producto: l.Producto || '', Lote: l.Lote_Vencimiento || '',
    Cantidad: Number(l.Cantidad) || 0, hecha: camCantHecha(l, lado), pend: camCantPendiente(l, lado)
  };
}

async function openGestionarCam(key) {
  var lines = cambios.filter(function(r) { return camGrupoKey(r) === key; });
  if (!lines.length) return;
  var r = lines[0];
  var res = camResumenGrupo(lines);
  if (res.pendIng <= 0 && res.pendSal <= 0) { showToast('Este cambio no tiene cantidades pendientes por tramitar', '#e67e22'); return; }
  gestionarCamIds = lines.map(function(l) { return l.__row || l.id; });
  gestionarCamEmpresa = r.Empresa || '';
  gestionarCamResumen = res;
  gestionarCamIngLines = lines.filter(function(l) { return camLadoAplica(l, 'ingreso', res.te); }).map(function(l) { return _gcLineaGestion(l, 'ingreso'); });
  gestionarCamSalLines = lines.filter(function(l) { return camLadoAplica(l, 'salida', res.te); }).map(function(l) { return _gcLineaGestion(l, 'salida'); });
  // Solo se ofrece lo que aún tiene pendiente
  gestionarCamLados = (res.pendIng > 0 && res.pendSal > 0) ? 'ambos' : res.pendIng > 0 ? 'ingreso' : 'salida';

  document.getElementById('gestionar-cam-meta').innerHTML =
    '<span>📋 Consec: '+escHtml(r.Consecutivo||'—')+'</span>' +
    '<span>👤 '+escHtml(r.Cliente||'—')+'</span>' +
    '<span>'+escHtml(getSiglaCam(r.Empresa))+'</span>';

  // Cada pasada es una remisión nueva: no se rellenan los datos de la anterior
  ['ingreso', 'salida'].forEach(function(lado) {
    var elRem = document.getElementById('gestionar-cam-remision-' + lado);
    elRem.value = ''; elRem.readOnly = true; elRem.style.background = '#f0f4f8'; elRem.placeholder = '(Auto al guardar)';
    var chk = document.getElementById('gestionar-cam-remision-' + lado + '-auto'); if (chk) chk.checked = true;
    document.getElementById('gestionar-cam-bodega-' + lado).value = 'Productos Buenos';
    document.getElementById('gestionar-cam-fecha-' + lado).value = today();
  });
  document.getElementById('btn-gestionar-cam').disabled = false;
  document.getElementById('gestionar-cam-obs-cierre').value = '';

  // Motor de asignación de inventario: solo si hay líneas ENTREGAR (lo que sale es distinto de lo que entra)
  if (res.te && gestionarCamSalLines.length && typeof createAsignacionEngine === 'function') {
    // Cant_Entregada del motor = lo ya entregado en pasadas anteriores (tope de lo asignable)
    gestionarCamWorkingLines = gestionarCamSalLines.map(function(s) {
      return { Producto: s.Producto, Presentacion: '', Cantidad: s.Cantidad, Cant_Entregada: s.hecha, _asignaciones: [], __row: s.id };
    });
    camAsig = createAsignacionEngine({
      getLines: function() { return gestionarCamWorkingLines; },
      getEmpresa: function() { return gestionarCamEmpresa; },
      globalName: 'camAsig',
      prefix: 'cam'
    });
    await camAsig.loadSnapshot();
  } else {
    gestionarCamWorkingLines = [];
    camAsig = null;
  }

  _renderGestionarCamTablas();
  _applyGestionarCamLados();
  document.getElementById('gestionar-cam-overlay').classList.add('show');
}

// Tabla de un lado: lo solicitado, lo ya tramitado, lo pendiente y la cantidad de ESTA pasada.
function _gcTablaHtml(lado, lines, conMotor) {
  var esIng = lado === 'ingreso';
  var titulo = esIng ? 'Productos que ingresan — cantidad recibida en este trámite' : 'Productos a entregar — cantidad entregada en este trámite';
  var color = esIng ? '#e65100' : '#2e7d32';
  var h = '<div style="margin-top:12px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 8px;flex-wrap:wrap">' +
      '<h4 style="margin:0;font-size:0.85rem;color:#2d3748">' + titulo + '</h4>' +
      '<span style="font-size:0.74rem"><a href="#" onclick="setGestionarCamCants(\'' + lado + '\',\'todo\');return false" style="color:' + color + ';font-weight:700">Todo lo pendiente</a>' +
      ' · <a href="#" onclick="setGestionarCamCants(\'' + lado + '\',\'nada\');return false" style="color:#718096;font-weight:700">Ninguna</a></span>' +
    '</div>' +
    '<div style="overflow-x:auto"><table class="detail-table" style="width:100%;font-size:0.78rem"><thead><tr>' +
    '<th style="text-align:left">Producto</th>' +
    '<th style="text-align:left">Lote / Venc.</th>' +
    '<th style="text-align:center;width:62px">Solicitada</th>' +
    '<th style="text-align:center;width:62px">' + (esIng ? 'Ya ingresada' : 'Ya entregada') + '</th>' +
    '<th style="text-align:center;width:62px">Pendiente</th>' +
    '<th style="text-align:center;width:92px">' + (esIng ? 'Ingresa ahora' : 'Entrega ahora') + '</th>' +
    (conMotor ? '<th style="text-align:left;min-width:220px">Asignar entrega</th>' : '') +
    '</tr></thead><tbody>';
  lines.forEach(function(s, i) {
    var celdaCant = s.pend > 0
      ? '<input class="ef gc-cant" data-lado="' + lado + '" data-i="' + i + '" type="number" min="0" max="' + s.pend + '" step="1" value="' + s.pend + '" oninput="onGestionarCamCant(this)" style="width:72px;text-align:right">'
      : '<span style="color:#27ae60;font-weight:700">✓ completa</span>';
    h += '<tr>' +
      '<td>' + escHtml(s.Producto) + '</td>' +
      '<td>' + escHtml(s.Lote || '—') + '</td>' +
      '<td style="text-align:center">' + s.Cantidad + '</td>' +
      '<td style="text-align:center">' + s.hecha + '</td>' +
      '<td style="text-align:center;font-weight:700;color:' + (s.pend > 0 ? '#e67e22' : '#27ae60') + '">' + s.pend + '</td>' +
      '<td style="text-align:center">' + celdaCant + '</td>' +
      (conMotor ? '<td class="cam-asig-td" data-i="' + i + '">' + camAsig.renderCell(i, gestionarCamWorkingLines[i]) + '</td>' : '') +
      '</tr>';
  });
  return h + '</tbody></table></div></div>';
}

function _renderGestionarCamTablas() {
  var secIng = document.getElementById('gestionar-cam-ing-section');
  var secSal = document.getElementById('gestionar-cam-lineas-section');
  secIng.innerHTML = gestionarCamIngLines.length ? _gcTablaHtml('ingreso', gestionarCamIngLines, false) : '';
  secSal.innerHTML = gestionarCamSalLines.length ? _gcTablaHtml('salida', gestionarCamSalLines, !!camAsig) : '';
}

// Cantidades de esta pasada por línea (ya acotadas a [0, pendiente], enteras)
function _gcCants(lado) {
  var arr = lado === 'ingreso' ? gestionarCamIngLines : gestionarCamSalLines;
  return arr.map(function(s, i) {
    var inp = document.querySelector('.gc-cant[data-lado="' + lado + '"][data-i="' + i + '"]');
    var v = inp ? Math.floor(Number(inp.value) || 0) : 0;
    return Math.max(0, Math.min(v, s.pend));
  });
}
function _gcSuma(arr) { return arr.reduce(function(s, v) { return s + v; }, 0); }

function onGestionarCamCant(inp) {
  var arr = inp.dataset.lado === 'ingreso' ? gestionarCamIngLines : gestionarCamSalLines;
  var s = arr[Number(inp.dataset.i)];
  if (!s || inp.value === '') { _applyGestionarCamLados(); return; }
  var v = Number(inp.value);
  if (isNaN(v) || v < 0) inp.value = 0;
  else if (v > s.pend) inp.value = s.pend;
  else if (v !== Math.floor(v)) inp.value = Math.floor(v);
  _applyGestionarCamLados();
}

function setGestionarCamCants(lado, modo) {
  var arr = lado === 'ingreso' ? gestionarCamIngLines : gestionarCamSalLines;
  document.querySelectorAll('.gc-cant[data-lado="' + lado + '"]').forEach(function(inp) {
    var s = arr[Number(inp.dataset.i)];
    inp.value = modo === 'todo' && s ? s.pend : 0;
  });
  _applyGestionarCamLados();
}

// Selector «¿Qué vas a registrar?»
function setGestionarCamLados(lados) {
  gestionarCamLados = lados;
  _applyGestionarCamLados();
}

function _applyGestionarCamLados() {
  var res = gestionarCamResumen;
  if (!res) return;
  var lados = gestionarCamLados;
  var sinRecep = lados === 'sinrecepcion';
  var faltante = lados === 'faltante';
  var cierre = sinRecep || faltante;
  var doIng = lados === 'ambos' || lados === 'ingreso';
  var doSal = lados === 'ambos' || lados === 'salida';

  // Botones del selector: solo los que aplican a lo que queda pendiente
  var disponibles = {
    ambos: res.pendIng > 0 && res.pendSal > 0,
    ingreso: res.pendIng > 0,
    salida: res.pendSal > 0,
    faltante: res.hayIng || res.haySal,      // hay algo ya tramitado y algo pendiente (siempre lo hay aquí)
    sinrecepcion: !res.hayIng                // «sin recibir» solo si no ha entrado nada
  };
  var selector = document.getElementById('gestionar-cam-lados-selector');
  if (selector) {
    selector.querySelectorAll('.gc-lado-btn').forEach(function(b) {
      var ok = !!disponibles[b.dataset.lado];
      b.classList.toggle('active', b.dataset.lado === lados);
      if (b.dataset.lado === 'ambos' || b.dataset.lado === 'ingreso' || b.dataset.lado === 'salida') {
        b.disabled = !ok;
      } else {
        b.style.display = ok ? '' : 'none';
      }
    });
  }

  var bi = document.getElementById('gestionar-cam-bloque-ingreso');
  var bs = document.getElementById('gestionar-cam-bloque-salida');
  if (bi) bi.style.display = doIng ? '' : 'none';
  if (bs) bs.style.display = doSal ? '' : 'none';
  var secIng = document.getElementById('gestionar-cam-ing-section');
  var secSal = document.getElementById('gestionar-cam-lineas-section');
  if (secIng) secIng.style.display = doIng ? '' : 'none';
  if (secSal) secSal.style.display = doSal ? '' : 'none';

  var bsr = document.getElementById('gestionar-cam-bloque-sinrecep');
  if (bsr) {
    bsr.style.display = cierre ? '' : 'none';
    var tit = document.getElementById('gestionar-cam-cierre-titulo');
    var desc = document.getElementById('gestionar-cam-cierre-desc');
    var obs = document.getElementById('gestionar-cam-obs-cierre');
    var lbl = document.getElementById('gestionar-cam-obs-label');
    if (faltante) {
      if (tit) tit.textContent = '⚠️ Cerrar con faltante';
      if (desc) desc.innerHTML = 'El cambio se cierra dejando sin tramitar lo que falta (ingreso: <strong>' + res.pendIng + '</strong> uds. · salida: <strong>' + res.pendSal + '</strong> uds.). Esas cantidades no mueven inventario; lo ya registrado se respeta. Queda en Tramitadas como <strong>Cerrado con faltante</strong> y ya no se puede reabrir.';
      if (lbl) lbl.textContent = 'justifica por qué no se recibirá / entregará el resto';
      if (obs) obs.placeholder = 'Ej.: El cliente solo devolvió 6 de las 10 unidades y acordamos no reponer el resto.';
    } else {
      if (tit) tit.textContent = '🚫 Cerrar sin recibir el producto';
      if (desc) desc.innerHTML = 'El cambio se cierra sin remisión de ingreso y sin mover inventario. Queda en Tramitadas como <strong>Cerrado sin recepción</strong> y ya no se puede reabrir.';
      if (lbl) lbl.textContent = 'justifica por qué se cierra sin haber recibido el producto';
      if (obs) obs.placeholder = 'Ej.: El cliente no devolvió el producto en el plazo acordado; se confirmó por WhatsApp el 02/10.';
    }
  }

  // Estado resultante tras guardar
  var cIng = doIng ? _gcSuma(_gcCants('ingreso')) : 0;
  var cSal = doSal ? _gcSuma(_gcCants('salida')) : 0;
  var restIng = res.pendIng - cIng;
  var restSal = res.pendSal - cSal;
  var cerrado = cierre || (restIng <= 0 && restSal <= 0);
  var hint = document.getElementById('gestionar-cam-estado-hint');
  if (hint) {
    hint.textContent = sinRecep ? 'Cerrado (sin recepción)' : faltante ? 'Cerrado (con faltante)' : cerrado ? 'Cerrado' : 'Parcial';
    hint.style.color = cierre ? '#d35400' : cerrado ? '#27ae60' : '#e67e22';
  }
  var btn = document.getElementById('btn-gestionar-cam');
  if (btn) {
    btn.style.background = cierre ? '#d35400' : '#27ae60';
    if (!btn.disabled) btn.textContent = sinRecep ? '🚫 Cerrar sin recibir producto' : faltante ? '⚠️ Cerrar con faltante' : cerrado ? '✓ Cerrar cambio y enviar' : '✓ Registrar trámite y enviar';
  }

  // Lo ya registrado y lo que quedaría pendiente
  var aviso = document.getElementById('gestionar-cam-parcial-aviso');
  if (aviso) {
    var totIng = gestionarCamIngLines.reduce(function(s, l) { return s + l.Cantidad; }, 0);
    var totSal = gestionarCamSalLines.reduce(function(s, l) { return s + l.Cantidad; }, 0);
    var msgs = [];
    if (res.hayIng || res.haySal) {
      msgs.push('Ya registrado — ingreso: ' + (totIng - res.pendIng) + ' de ' + totIng + ' uds. · salida: ' + (totSal - res.pendSal) + ' de ' + totSal + ' uds.');
    }
    if (sinRecep) {
      msgs.push(res.haySal
        ? 'La salida ya registrada se respeta tal cual; solo se cierra el cambio sin ingreso.'
        : 'No se registrará ningún movimiento de inventario (ni ingreso ni salida).');
    } else if (!faltante) {
      if (restIng > 0 || restSal > 0) {
        msgs.push('Después de este trámite quedará pendiente — ingreso: ' + restIng + ' uds. · salida: ' + restSal + ' uds. (se tramita luego con otra remisión).');
      }
    }
    aviso.textContent = msgs.join(' ');
    aviso.style.display = msgs.length ? '' : 'none';
  }
}

function closeGestionarCam() {
  document.getElementById('gestionar-cam-overlay').classList.remove('show');
  gestionarCamIds = null;
  gestionarCamWorkingLines = [];
  gestionarCamEmpresa = '';
  camAsig = null;
  gestionarCamLados = 'ambos';
  gestionarCamResumen = null;
  gestionarCamIngLines = [];
  gestionarCamSalLines = [];
  var obsCierre = document.getElementById('gestionar-cam-obs-cierre');
  if (obsCierre) obsCierre.value = '';
  var secSal = document.getElementById('gestionar-cam-lineas-section');
  if (secSal) { secSal.innerHTML = ''; secSal.style.display = 'none'; }
  var secIng = document.getElementById('gestionar-cam-ing-section');
  if (secIng) { secIng.innerHTML = ''; secIng.style.display = 'none'; }
}
document.getElementById('gestionar-cam-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeGestionarCam(); });

// Lo que realmente se registra en esta pasada. Con «Ingreso y salida», un lado sin ninguna cantidad
// simplemente no se registra (no genera remisión): p. ej. se entrega hoy pero aún no ha llegado lo devuelto.
function _gcLadosEfectivos() {
  var lados = gestionarCamLados;
  if (lados !== 'ambos') return lados;
  var hayIng = _gcSuma(_gcCants('ingreso')) > 0;
  var haySal = _gcSuma(_gcCants('salida')) > 0;
  return (hayIng && !haySal) ? 'ingreso' : (!hayIng && haySal) ? 'salida' : 'ambos';
}

// Revisa la pasada antes de enviarla; muestra el aviso y devuelve false si algo no cuadra.
function _gcValidarTramite() {
  var lados = _gcLadosEfectivos();
  var doIng = lados === 'ambos' || lados === 'ingreso';
  var doSal = lados === 'ambos' || lados === 'salida';
  if (!gestionarCamIds || !gestionarCamIds.length) return false;
  if (gestionarCamLados === 'ambos' && _gcSuma(_gcCants('ingreso')) + _gcSuma(_gcCants('salida')) <= 0) {
    showToast('Indica al menos una cantidad recibida o entregada en este trámite', '#e74c3c'); return false;
  }
  if (doIng) {
    if (!document.getElementById('gestionar-cam-fecha-ingreso').value) { showToast('Selecciona la fecha de ingreso', '#e74c3c'); return false; }
    if (_gcSuma(_gcCants('ingreso')) <= 0) { showToast('Indica al menos una cantidad recibida (o elige «Solo salida»)', '#e74c3c'); return false; }
  }
  if (doSal) {
    if (!document.getElementById('gestionar-cam-fecha-salida').value) { showToast('Selecciona la fecha de salida', '#e74c3c'); return false; }
    var cants = _gcCants('salida');
    if (_gcSuma(cants) <= 0) { showToast('Indica al menos una cantidad entregada (o elige «Solo ingreso»)', '#e74c3c'); return false; }
    // Lo asignado a una línea (de este stock o por solicitud de compra) no puede superar lo que se entrega ahora
    if (camAsig) {
      var asig = camAsig.splitAsignaciones();
      var tot = {};
      asig.entregas.concat(asig.solicitudesCompra).forEach(function(a) { tot[a._idx] = (tot[a._idx] || 0) + a.cantidad; });
      for (var i = 0; i < cants.length; i++) {
        if ((tot[i] || 0) > cants[i]) {
          showToast('«' + gestionarCamSalLines[i].Producto + '»: asignaste ' + tot[i] + ' uds. pero entregas ' + cants[i] + ' en este trámite. Ajusta la cantidad o quita asignaciones.', '#e74c3c');
          return false;
        }
      }
    }
  }
  return true;
}

var _pendingContabCam = null;
async function gestionarYEnviarCam() {
  var lados = gestionarCamLados;
  if (lados === 'sinrecepcion' || lados === 'faltante') {
    // Sin remisiones no hay PDF que enviar a contabilidad: se valida y se guarda directo
    var obs = (document.getElementById('gestionar-cam-obs-cierre').value || '').trim();
    var res = gestionarCamResumen || { pendIng: 0, pendSal: 0 };
    if (obs.length < 10) { showToast('Escribe la observación que justifica ' + (lados === 'faltante' ? 'cerrar con faltante' : 'cerrar sin recibir el producto') + ' (mínimo 10 caracteres)', '#e74c3c'); return; }
    var pregunta = lados === 'faltante'
      ? '¿Cerrar este cambio CON FALTANTE?\n\nLo pendiente (ingreso: ' + res.pendIng + ' uds. · salida: ' + res.pendSal + ' uds.) no se tramitará y el cambio no se podrá reabrir.'
      : '¿Cerrar este cambio SIN haber recibido el producto?\n\nQuedará en Tramitadas y no se podrá reabrir.';
    if (!window.confirm(pregunta)) return;
    _pendingContabCam = null;
    await saveGestionarCam();
    return;
  }
  if (!_gcValidarTramite()) return;
  if (typeof NOTIF !== 'undefined' && NOTIF.confirmarEnvioContabilidad) {
    var r = await NOTIF.confirmarEnvioContabilidad(gestionarCamEmpresa, 'cambios');
    if (!r.confirmed) return;
    _pendingContabCam = r;
  }
  await saveGestionarCam();
}

async function saveGestionarCam() {
  var lados = _gcLadosEfectivos();
  var cierre = lados === 'sinrecepcion' || lados === 'faltante';
  var doIng = lados === 'ambos' || lados === 'ingreso';
  var doSal = lados === 'ambos' || lados === 'salida';
  if (!gestionarCamIds || !gestionarCamIds.length) return;

  var fechaIngreso = document.getElementById('gestionar-cam-fecha-ingreso').value;
  var fechaSalida = document.getElementById('gestionar-cam-fecha-salida').value;
  var bodegaIngreso = document.getElementById('gestionar-cam-bodega-ingreso').value;
  var bodegaSalida = document.getElementById('gestionar-cam-bodega-salida').value;

  // Líneas de esta pasada (solo las que tienen cantidad)
  var lineasIng = [], lineasSal = [];
  var solicitudesCompra = [];
  var entregasDirectas = 0;
  if (doIng) {
    var cIng = _gcCants('ingreso');
    gestionarCamIngLines.forEach(function(s, i) { if (cIng[i] > 0) lineasIng.push({ id: s.id, cant: cIng[i], _s: s }); });
  }
  if (doSal) {
    var cSal = _gcCants('salida');
    var directaPorIdx = {};
    if (camAsig) {
      var split = camAsig.splitAsignaciones();
      solicitudesCompra = split.solicitudesCompra;
      split.entregas.forEach(function(e) { directaPorIdx[e._idx] = (directaPorIdx[e._idx] || 0) + e.cantidad; entregasDirectas++; });
    }
    gestionarCamSalLines.forEach(function(s, i) {
      if (cSal[i] > 0) lineasSal.push({ id: s.id, cant: cSal[i], directa: Math.min(directaPorIdx[i] || 0, cSal[i]), _s: s });
    });
  }

  var btn = document.getElementById('btn-gestionar-cam');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'tramitarCambio',
      Empresa: gestionarCamEmpresa,
      lados: lados,
      ids: gestionarCamIds,
      Observacion: cierre ? document.getElementById('gestionar-cam-obs-cierre').value.trim() : '',
      ingreso: doIng ? {
        Remision: document.getElementById('gestionar-cam-remision-ingreso').value.trim(),
        Bodega: bodegaIngreso, Fecha: fechaIngreso,
        lineas: lineasIng.map(function(l) { return { id: l.id, cant: l.cant }; })
      } : null,
      salida: doSal ? {
        Remision: document.getElementById('gestionar-cam-remision-salida').value.trim(),
        Bodega: bodegaSalida, Fecha: fechaSalida,
        lineas: lineasSal.map(function(l) { return { id: l.id, cant: l.cant, directa: l.directa }; })
      } : null
    });
    if (!result.ok) throw new Error(result.error || 'Error al gestionar');

    if (solicitudesCompra.length && camAsig) {
      var consec = '';
      var camLines0 = cambios.filter(function(r) {
        return gestionarCamIds.indexOf(r.__row || r.id) >= 0;
      });
      if (camLines0.length) consec = camLines0[0].Consecutivo || '';
      await camAsig.persistirOCSolicitudes(solicitudesCompra, {
        fecha: fechaSalida,
        refLabel: getSiglaCam(gestionarCamEmpresa) + ' Cambio #' + consec
      });
    }

    // Remisiones PDF de ESTA pasada (con sus cantidades) a contabilidad
    var _finalRemIngC = doIng ? (result.remision_ingreso || '') : '';
    var _finalRemSalC = doSal ? (result.remision_salida || '') : '';
    if (_pendingContabCam && _pendingContabCam.contabIds && _pendingContabCam.contabIds.length && (_finalRemIngC || _finalRemSalC) && typeof NOTIF !== 'undefined') {
      try {
        var camLines = cambios.filter(function(r) { return gestionarCamIds.indexOf(r.__row || r.id) >= 0; });
        var head = camLines.length ? camLines[0] : {};
        var _eItems = function(arr) {
          return arr.map(function(l) { return { producto: l._s.Producto || '', presentacion: l._s.Lote || '', cantidad: l.cant, valor_unitario: 0, valor_total: 0, bonificado: 'No' }; }).filter(function(p) { return p.cantidad > 0; });
        };
        var jsPDFDoc = null;
        if (_finalRemIngC) {
          var rI = generarRemisionPDF({ empresa: gestionarCamEmpresa, consecutivo: head.Consecutivo||'', doc_title:'REMISION DE INGRESO', ref_label:'Cambio', date_label:'Fecha remision', fecha_entrega: fechaIngreso, remision: _finalRemIngC, left_fields:[['Cliente',head.Cliente||''],['NIT',head.NIT||''],['Telefono',head.Telefono||''],['N° Factura',head.Num_Factura||'']].concat(_camEntregaPdf(head).izq), right_fields:[['Correo',head.Correo||''],['Bodega',bodegaIngreso||''],['Fecha compra',head.Fecha_Compra||''],['Estado',result.estado||head.Estado||'Pendiente']].concat(_camEntregaPdf(head).der), entregas:_eItems(lineasIng), qty_header:'Cantidad', file_prefix:'Remision_Ingreso_Cambio', return_doc:true, copies:['COPIA - CONTABILIDAD'] });
          if (rI) jsPDFDoc = rI.doc;
        }
        if (_finalRemSalC) {
          var optsS = { empresa: gestionarCamEmpresa, consecutivo: head.Consecutivo||'', doc_title:'REMISION DE SALIDA', ref_label:'Cambio', date_label:'Fecha remision', fecha_entrega: fechaSalida, remision: _finalRemSalC, left_fields:[['Cliente',head.Cliente||''],['NIT',head.NIT||''],['Telefono',head.Telefono||''],['N° Factura',head.Num_Factura||'']].concat(_camEntregaPdf(head).izq), right_fields:[['Correo',head.Correo||''],['Bodega',bodegaSalida||''],['Fecha compra',head.Fecha_Compra||''],['Estado',result.estado||head.Estado||'Pendiente']].concat(_camEntregaPdf(head).der), entregas:_eItems(lineasSal), qty_header:'Cantidad', file_prefix:'Remision_Salida_Cambio', return_doc:true, copies:['COPIA - CONTABILIDAD'] };
          if (jsPDFDoc) optsS._doc = jsPDFDoc;
          var rS = generarRemisionPDF(optsS);
          if (rS) jsPDFDoc = rS.doc;
        }
        if (jsPDFDoc) {
          var refP = [(head.Consecutivo||'')];
          if (_finalRemIngC) refP.push('RE ' + _finalRemIngC);
          if (_finalRemSalC) refP.push('RS ' + _finalRemSalC);
          await NOTIF.enviarPDFContabilidad(jsPDFDoc, {
            modulo: 'cambios', referencia: refP.join(' · '),
            titulo: 'Remisión cambio — ' + (head.Cliente||''),
            docLabel: 'Remisión',
            contabIds: _pendingContabCam.contabIds, contabNames: _pendingContabCam.contabNames
          });
        }
      } catch (e) { console.error('Auto-send contabilidad error', e); }
    }
    _pendingContabCam = null;
    var _estadoFinal = result.estado || 'Cerrado';
    closeGestionarCam();
    var toastParts = [result.sin_recepcion ? '✅ Cambio cerrado sin recepción'
      : result.con_faltante ? '✅ Cambio cerrado con faltante'
      : _estadoFinal === 'Cerrado' ? '✅ Cambio cerrado'
      : '✅ Trámite registrado (Parcial)'];
    if (result.remision_ingreso) toastParts.push('RE: ' + result.remision_ingreso);
    if (result.remision_salida) toastParts.push('RS: ' + result.remision_salida);
    if (_estadoFinal === 'Parcial') toastParts.push('Pendiente — ingreso: ' + result.pend_ing + ' · salida: ' + result.pend_sal);
    if (entregasDirectas) toastParts.push(entregasDirectas + ' entrega(s) directa(s)');
    if (solicitudesCompra.length) toastParts.push(solicitudesCompra.length + ' solicitud(es) de compra');
    showToast(toastParts.join(' · '));
    await loadCambios();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    _applyGestionarCamLados();
    _pendingContabCam = null;
  }
}

// ── PDF Export (Cambios) ──
// Datos de entrega del cambio para los recuadros de los PDF (solicitud y remisiones): dos filas por columna.
function _camEntregaPdf(head) {
  return {
    izq: [['Sucursal', head.Sucursal || ''], ['Direccion', head.Direccion_Envio || '']],
    der: [['Municipio', head.Municipio || ''], ['Departamento', head.Departamento || '']]
  };
}

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

function exportarCamSolicitudPDF(opts) {
  opts = opts || {};
  var ctx = _camViewContext();
  if (!ctx) return;
  var head = ctx.head;

  var doc = opts._doc || _nuevoPdfDoc();
  if (opts._doc) doc.addPage();
  var pw = doc.internal.pageSize.getWidth();
  var palette = _pdfPaletteFor(head.Empresa);
  var accent = palette.accent;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];
  var headerInfo = (typeof _pdfRemisionHeaderInfoFor === 'function') ? _pdfRemisionHeaderInfoFor(head.Empresa) : null;
  var headerH = headerInfo ? 23.5 : 12.5;
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
      var lb = (typeof _pdfLogoBox === 'function') ? _pdfLogoBox(logo, 22, 12) : { w: 13, h: 13 };
      doc.addImage(logo.data, 'PNG', 6, 2, lb.w, lb.h);
      titleX = 6 + lb.w + 3;
    } catch (e) {}
  }

  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('SOLICITUD DE CAMBIO DE MERCANCIA  N° ' + String(head.Consecutivo || ''), titleX, 6.3);
  doc.setFontSize(7);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.text(String(head.Empresa || ''), titleX, 10.3);
  doc.setFontSize(6.8);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setFont(undefined, 'bold');
  if (head.Fecha_Solicitud) {
    doc.text('Fecha solicitud: ' + String(head.Fecha_Solicitud), pw - 14, 10.3, { align: 'right' });
  }
  doc.setFont(undefined, 'normal');

  if (headerInfo) {
    doc.setFontSize(4.7);
    doc.setTextColor(120, 132, 150);
    var infoStartY = 12.9;
    var infoLineH = 2.05;
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
  ].concat(_camEntregaPdf(head).izq);
  var right = [
    ['N° Factura', head.Num_Factura || ''],
    ['Fecha compra', head.Fecha_Compra || ''],
    ['Fecha recogida', head.Fecha_Recogida || ''],
    ['Estado', head.Estado || 'Pendiente']
  ].concat(_camEntregaPdf(head).der);

  var ph = doc.internal.pageSize.getHeight();
  function _camSalto(need) {
    if (y + need > ph - 4) { doc.addPage(); y = 14; return true; }
    return false;
  }

  var y = headerH + 8;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(8);
  var totalW = pw - 28;
  var leftBlockW = totalW * 0.58;
  var leftValX = 14 + 30;
  var rightLabelX = 14 + leftBlockW + 4;
  var rightValX = rightLabelX + 30;
  var leftValMaxW = (14 + leftBlockW) - leftValX - 4;
  var rightValMaxW = pw - 14 - rightValX;
  var maxF = Math.max(left.length, right.length);
  var infoTop = y - 5;
  var midX = 14 + leftBlockW;
  var rowGap = 4.2;
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
      rowH = Math.max(rowH, (lLines.length - 1) * 3);
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
      rowH = Math.max(rowH, (rLines.length - 1) * 3);
    }
    y += rowGap + rowH;
    if (fi < maxF - 1) {
      doc.setDrawColor(200, 210, 220);
      doc.setLineWidth(0.2);
      doc.line(14, y - 3, pw - 14, y - 3);
    }
  }
  var infoBottom = y - 3;
  doc.setDrawColor(140, 155, 175);
  doc.setLineWidth(0.4);
  doc.rect(14, infoTop, pw - 28, infoBottom - infoTop);
  doc.setLineWidth(0.2);
  doc.setDrawColor(200, 210, 220);
  doc.line(midX, infoTop, midX, infoBottom);
  y += 3;

  // Mercancía a Cambiar
  if (ctx.cambiar.length) {
    _camSalto(16);
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(192, 57, 43);
    doc.text('Mercancia a cambiar (devuelve el cliente)', 14, y + 3);
    y += 4.5;
    doc.autoTable({
      startY: y,
      head: [['#', 'Producto', 'Cant.', 'Lote / Vencimiento', 'Razon del cambio']],
      body: ctx.cambiar.map(function(l, i) {
        return [ i + 1, String(l.Producto || ''), Number(l.Cantidad) || 0, String(l.Lote_Vencimiento || ''), String(l.Razon_Cambio || '') ];
      }),
      theme: 'grid',
      headStyles: { fillColor: [192, 57, 43], fontSize: 7, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35 },
      bodyStyles: { fontSize: 7, lineColor: [90, 90, 90], lineWidth: 0.3 },
      columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 2: { halign: 'right', cellWidth: 18 } },
      margin: { left: 14, right: 14, bottom: 10 },
      styles: { cellPadding: 1.3 },
      tableLineColor: [60, 60, 60],
      tableLineWidth: 0.5
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // Mercancía a Entregar
  if (ctx.entregar.length) {
    _camSalto(16);
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(39, 174, 96);
    doc.text('Mercancia a entregar (nueva para el cliente)', 14, y + 3);
    y += 4.5;
    doc.autoTable({
      startY: y,
      head: [['#', 'Producto', 'Cant.', 'Lote / Vencimiento', 'Fecha del cambio']],
      body: ctx.entregar.map(function(l, i) {
        return [ i + 1, String(l.Producto || ''), Number(l.Cantidad) || 0, String(l.Lote_Vencimiento || ''), String(l.Fecha_Cambio || '') ];
      }),
      theme: 'grid',
      headStyles: { fillColor: [39, 174, 96], fontSize: 7, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35 },
      bodyStyles: { fontSize: 7, lineColor: [90, 90, 90], lineWidth: 0.3 },
      columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 2: { halign: 'right', cellWidth: 18 } },
      margin: { left: 14, right: 14, bottom: 10 },
      styles: { cellPadding: 1.3 },
      tableLineColor: [60, 60, 60],
      tableLineWidth: 0.5
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // Valores
  var vc = Number(head.Valor_Cliente) || 0;
  var ve = Number(head.Valor_Empresa) || 0;
  if (vc || ve) {
    _camSalto(14);
    doc.setFillColor(247, 250, 252);
    doc.roundedRect(14, y, pw - 28, 11, 2, 2, 'F');
    doc.setDrawColor(200, 210, 220);
    doc.roundedRect(14, y, pw - 28, 11, 2, 2, 'S');
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    doc.text('Valor a favor del cliente: ' + fmtMoney(vc), 18, y + 7);
    doc.text('Valor a favor de la empresa: ' + fmtMoney(ve), pw - 18, y + 7, { align: 'right' });
    y += 14;
  }

  // Observaciones
  if (head.Observaciones) {
    doc.setFontSize(7.5);
    var obsMaxW = pw - 28 - 34;
    var obsLines = doc.splitTextToSize(String(head.Observaciones), obsMaxW);
    var obsH = Math.max(9, obsLines.length * 3 + 3.5);
    _camSalto(obsH + 1);
    doc.setFillColor(254, 249, 231);
    doc.roundedRect(14, y, pw - 28, obsH, 2, 2, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(125, 102, 8);
    doc.text('Observaciones:', 18, y + 4.5);
    doc.setFont(undefined, 'normal');
    doc.text(obsLines, 48, y + 4.5);
    y += obsH + 2;
  }

  // Footer generado
  doc.setFontSize(5.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(grayText[0], grayText[1], grayText[2]);
  doc.text('Generado: ' + new Date().toLocaleString('es-CO'), 14, ph - 3.5);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text('OP-PDC-FO11', pw / 2, ph - 3.5, { align: 'center' });

  var sigla = (typeof getSigla === 'function' ? getSigla(head.Empresa) : '') || 'Cambio';
  var fileName = 'Solicitud_Cambio_' + sigla + '_' + (head.Consecutivo || 'nuevo') + '.pdf';
  if (opts.return_doc) return { doc: doc, filename: fileName };
  if (opts.share) {
    if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
      showToast('Módulo de notificaciones no cargado.', '#e74c3c'); return;
    }
    NOTIF.openModalEnviar({
      modulo: 'cambios',
      referencia: head.Consecutivo || '',
      titulo: 'Solicitud cambio #' + (head.Consecutivo || '') + ' — ' + (head.Cliente || 'sin cliente'),
      empresa: head.Empresa || '',
      triggerBtn: opts.triggerBtn || null,
      buildDoc: function() { return doc; }
    });
    return;
  }
  doc.save(fileName);
}

function exportarCamRemisionPDF(tipo, opts) {
  opts = opts || {};
  var ctx = _camViewContext();
  if (!ctx) return;
  var head = ctx.head;
  var esIngreso = tipo === 'ingreso';

  // Un cambio tramitado por partes tiene una remisión por cada pasada: opts.rem elige cuál; cada una
  // lleva solo los productos y cantidades de su pasada.
  //   Ingreso = producto que devuelve el cliente (CAMBIAR)
  //   Salida  = producto nuevo para el cliente (ENTREGAR, o CAMBIAR si no hay ENTREGAR — mismo producto)
  var resCam = camResumenGrupo(ctx.lines);
  var remisiones = (esIngreso ? resCam.ingresos : resCam.salidas).filter(function(g) { return !opts.rem || g.rem === opts.rem; });
  if (!remisiones.length) {
    showToast('Este cambio no tiene remisión de ' + tipo + ' registrada.', '#e67e22');
    return;
  }
  var gRem = remisiones[remisiones.length - 1];
  var remision = gRem.rem;
  var bodega = gRem.bodega || '';
  var fechaRem = gRem.fecha || '';
  var entregas = gRem.items.map(function(it) {
    return {
      producto: it.producto || '',
      presentacion: it.lote || '',
      cantidad: Number(it.cant) || 0,
      valor_unitario: 0,
      valor_total: 0,
      bonificado: 'No'
    };
  }).filter(function(p) { return (p.cantidad || 0) > 0 || p.producto; });
  if (!entregas.length) {
    showToast('No hay productos para incluir en la remisión.', '#e67e22');
    return;
  }

  var left = [
    ['Cliente', head.Cliente || ''],
    ['NIT', head.NIT || ''],
    ['Telefono', head.Telefono || ''],
    ['N° Factura', head.Num_Factura || '']
  ].concat(_camEntregaPdf(head).izq);
  var right = [
    ['Correo', head.Correo || ''],
    ['Bodega', bodega || ''],
    ['Fecha compra', head.Fecha_Compra || ''],
    ['Estado', head.Estado || 'Pendiente']
  ].concat(_camEntregaPdf(head).der);

  var data = {
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
  };
  if (opts.share) {
    if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
      showToast('Módulo de notificaciones no cargado.', '#e74c3c'); return;
    }
    var ocKey = getSiglaCam(head.Empresa) + '||' + (head.Consecutivo || '');
    var ocGroups = ocsLegalizadasPorCambio[ocKey] || [];
    NOTIF.openModalEnviar({
      modulo: 'cambios',
      referencia: (head.Consecutivo || '') + ' · Rem ' + remision,
      titulo: 'Remisión ' + (esIngreso ? 'ingreso' : 'salida') + ' cambio #' + remision,
      empresa: head.Empresa || '',
      // El PDF incluye las remisiones de traslado de las OC: su contabilidad
      // (RE = destino, RS = origen) también recibe copia.
      empresas: NOTIF.refsDeOCs(ocGroups.map(function(g) { return g && g[0]; })).empresas,
      remisiones: [remision].concat(NOTIF.refsDeOCs(ocGroups.map(function(g) { return g && g[0]; })).remisiones),
      triggerBtn: opts.triggerBtn || null,
      buildDoc: function() {
        var r = generarRemisionPDF(Object.assign({}, data, { return_doc: true, copies: ['COPIA - CONTABILIDAD'] }));
        if (!r) return null;
        var doc = r.doc;
        exportarCamSolicitudPDF({ return_doc: true, _doc: doc });
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

// ── Adjuntos Cambios (Supabase Storage) ──
var CAM_ADJUNTOS_BUCKET = 'cambios-adjuntos';
var camAdjuntosCache = {};
// Zona «📎 Archivos de soporte» del formulario de alta (js/adjuntos-soporte.js): se suben al guardar, a la misma carpeta que lista el detalle
var camSoporte = aspCrear('cam-soporte');

function camSanitizeForPath(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
}

function camAdjuntoFolder(empresa, consecutivo, cliente) {
  var emp = getSiglaCam(empresa).replace(/[^a-zA-Z0-9_-]/g, '_');
  return emp + '/' + consecutivo + '_' + camSanitizeForPath(cliente);
}

function camAdjuntoPath(empresa, consecutivo, cliente, filename) {
  return camAdjuntoFolder(empresa, consecutivo, cliente) + '/' + filename;
}

function camFormatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function loadCamAdjuntos(empresa, consecutivo, cliente) {
  var listEl = document.getElementById('cam-adjuntos-list');
  var countEl = document.getElementById('cam-adjuntos-count');
  if (!listEl) return;
  listEl.innerHTML = '<div class="adjuntos-loading">Cargando adjuntos...</div>';

  var folder = camAdjuntoFolder(empresa, consecutivo, cliente);
  var res2 = await _sb.storage.from(CAM_ADJUNTOS_BUCKET).list(folder, { limit: 50 });

  var files = (res2.data || []).filter(function(f) { return f.name && f.id; });
  var cacheKey = folder;
  camAdjuntosCache[cacheKey] = files;

  if (!files.length) {
    listEl.innerHTML = '<div class="adjuntos-empty">Sin archivos adjuntos</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (countEl) countEl.textContent = '(' + files.length + ')';
  listEl.innerHTML = files.map(function(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var icon = ext === 'pdf' ? '📄' : '🖼️';
    var size = f.metadata && f.metadata.size ? camFormatFileSize(f.metadata.size) : '';
    var path = folder + '/' + f.name;
    var nameEsc = f.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var pathEsc = path.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<div class="adjunto-item">' +
      '<div class="adjunto-icon">' + icon + '</div>' +
      '<div class="adjunto-info">' +
        '<div class="adjunto-name" title="' + escHtml(f.name) + '">' + escHtml(f.name) + '</div>' +
        '<div class="adjunto-meta">' + ext.toUpperCase() + (size ? ' · ' + size : '') + '</div>' +
      '</div>' +
      '<div class="adjunto-actions">' +
        '<button class="btn-adj-ver" onclick="previewCamAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + ext + '\')">👁 Ver</button>' +
        '<button class="btn-adj-ver" onclick="downloadCamAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + nameEsc.replace(/'/g, "\\'") + '\')">⬇ Descargar</button>' +
        (AUTH.canUploadAdjuntos() ? '<button class="btn-adj-del" onclick="deleteCamAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\')">🗑️</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

async function handleCamAdjuntoUpload(input) {
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

  if (!camViewingKey) return;
  var lines = cambios.filter(function(r) {
    return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === camViewingKey;
  });
  if (!lines.length) return;
  var r = lines[0];

  var timestamp = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var finalName = timestamp + '_' + safeName;
  var path = camAdjuntoPath(r.Empresa, r.Consecutivo || r.id, r.Cliente, finalName);

  var progWrap = document.getElementById('cam-adjunto-progress');
  var progFill = document.getElementById('cam-adjunto-prog-fill');
  var progText = document.getElementById('cam-adjunto-prog-text');
  if (progWrap) progWrap.style.display = 'block';
  if (progFill) progFill.style.width = '30%';
  if (progText) progText.textContent = 'Subiendo ' + file.name + '...';

  var res = await _sb.storage.from(CAM_ADJUNTOS_BUCKET).upload(path, file, {
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
  await loadCamAdjuntos(r.Empresa, r.Consecutivo || r.id, r.Cliente);
}

async function previewCamAdjunto(path, ext) {
  var res = _sb.storage.from(CAM_ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(CAM_ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
    url = signed.data && signed.data.signedUrl;
  }
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }

  var contentEl = document.getElementById('cam-adjunto-preview-content');
  contentEl.innerHTML = '';
  if (ext === 'pdf') {
    var f = document.createElement('iframe');
    f.src = url;
    contentEl.appendChild(f);
  } else {
    var im = document.createElement('img');
    im.src = url;
    im.alt = 'Preview';
    contentEl.appendChild(im);
  }
  document.getElementById('cam-adjunto-preview-overlay').classList.add('show');
}

function closeCamAdjuntoPreview() {
  document.getElementById('cam-adjunto-preview-overlay').classList.remove('show');
  document.getElementById('cam-adjunto-preview-content').innerHTML = '';
}

async function downloadCamAdjunto(path, filename) {
  var res = _sb.storage.from(CAM_ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(CAM_ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
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

async function deleteCamAdjunto(path) {
  if (!confirm('¿Eliminar este archivo adjunto?')) return;
  var res = await _sb.storage.from(CAM_ADJUNTOS_BUCKET).remove([path]);
  if (res.error) {
    showToast('Error al eliminar: ' + res.error.message, '#e74c3c');
    return;
  }
  showToast('Archivo eliminado', '#e67e22');
  if (camViewingKey) {
    var lines = cambios.filter(function(r) {
      return ((r.Empresa||'') + '||' + (r.Consecutivo || r.id)) === camViewingKey;
    });
    if (lines.length) {
      var r = lines[0];
      await loadCamAdjuntos(r.Empresa, r.Consecutivo || r.id, r.Cliente);
    }
  }
}

function initCamDropzone() {
  var dz = document.getElementById('cam-adjunto-dropzone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var input = document.getElementById('cam-adjunto-input');
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleCamAdjuntoUpload(input);
  });
}

// ── Init ──
loadCatalogoCam();
loadClientesCam();
