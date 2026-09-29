// ── Legalización de Gastos ──
// Reemplaza el Excel CT-PFT-FO02: gastos de ruta de un conductor (combustible,
// alimentación, peajes) contra un anticipo, con conciliación en dos pasos.

// ── Tabs ──
function switchTab(tab) {
  ['legalizaciones', 'envios', 'prorrateo', 'vehiculos', 'detalle'].forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var btn = document.getElementById('tab-' + t);
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    if (btn) btn.style.background = (t === tab) ? '#1a5276' : '#718096';
  });
  if (tab === 'envios') renderEnviosTable();
  if (tab === 'prorrateo') renderProrrateoGastos();
  if (tab === 'vehiculos') renderVehiculosTab();
  if (tab === 'detalle') renderDetalleTable();
}

var LEG_BUCKET = 'legalizacion-gastos-adjuntos';

var legs = [];       // LegalizacionGastos (cabeceras)
var legItems = [];   // LegalizacionGastosItems (líneas de gasto)
var legEmpresas = []; // LegalizacionGastosEmpresas (reparto)
var vehiculos = [];  // Vehiculos (catálogo, reemplaza la vieja lista fija PLACAS_FIJAS)

// Piloto de kilometraje: solo estas placas muestran los campos de
// km/hora/galones/rendimiento en el formulario de Ruta y en Ver. Ampliar el
// piloto después es solo agregar placas aquí — no requiere migración.
var KM_PILOTO_PLACAS = ['JRM295', 'LJT165'];

var editingLegId = null; // id en edición dentro de #form-overlay, null = nueva
var verLegId = null;     // id mostrado en #ver-overlay

var formGastos = [];     // líneas de gasto del formulario en curso
var formEmpresas = [];   // reparto por empresa del formulario en curso
var formRemisiones = []; // remisiones relacionadas del formulario en curso (lista)
var formClientes = [];   // clientes visitados del formulario en curso (lista)
var formGastoProveedorACs = []; // autocompletes de Proveedor (uno por línea de gasto, se recrean en cada render)

// ── Formulario de Mantenimiento (Tipo='Mantenimiento'): mismo patrón de
// cabecera + líneas de gasto + reparto entre empresas que el formulario de
// ruta, pero sin remisiones/clientes/recorrido y con un detalle de
// mantenimiento (en vez de Concepto) por línea. Estado propio, en paralelo
// al del formulario de ruta (editingLegId se comparte: solo un modal a la vez).
var formGastosMant = [];
var formEmpresasMant = [];
var formMantProveedorACs = [];

// ── Formulario de Envío (Tipo='Envio'): pago de un flete/mensajería de
// mercancía. Una sola línea de gasto (proveedor, NIT, valor) ligada a
// remisiones, con reparto entre empresas por litros/kilos (mismo cálculo que
// "Calcular reparto" del formulario de ruta, sin Combustible). No pasa por
// conciliación: en BD queda 'Por conciliar' (para seguir editable por RLS) y
// la interfaz lo muestra como "Registrado" (ver estadoLeg).
var formEmpresasEnv = [];
var formRemisionesEnv = [];
var ENVIO_CONCEPTO = 'Envío';

var legAdjuntosCache = [];

// Clientes con al menos una remisión real generada (Pedidos.Remisiones no
// vacío, Estado_2 != 'Anulado'), para sugerir en el campo Cliente(s) y para
// auto-completar el cliente cuando se agrega una remisión que le pertenece.
var clientesConRemisionCache = null;
var remisionClienteMap = {}; // "REM-001" (mayúsculas) -> Cliente

// "REM-001" (mayúsculas) -> [{producto, presentacion, cantidad, empresa}, ...]
// — la cantidad es la de ESA remisión puntual (una fila de Pedidos puede
// tener varias entregas parciales bajo remisiones distintas). Cubre entregas
// de Pedidos e Ingresos (traslados planta↔empresa); Órdenes de Compra,
// muestras y reenvases todavía no se resuelven aquí. Usado por
// calcularProrrateoGastos().
var remisionProductoMap = {};

// Igual que remisionProductoMap, más las remisiones de Muestras y de
// Devoluciones. Lo usan el botón "Calcular reparto" del formulario
// (calcularRepartoSugerido) y, en la pestaña Prorrateo, solo las
// legalizaciones de tipo Envío (los envíos suelen llevar muestras); el resto
// de la pestaña sigue con remisionProductoMap, sin cambios.
var remisionProductoMapReparto = {};

// Pedidos.Remisiones llega como "REM-001|cant|fecha, REM-002|cant|fecha" (o,
// en registros viejos, un solo código sin "|"). Mismo parseo que kardex.js.
function _parseRemisionesField(remStr) {
  var s = (remStr || '').trim();
  if (!s) return [];
  if (s.indexOf('|') < 0) return [s];
  return s.split(',').map(function(seg) {
    return (seg.split('|')[0] || '').trim();
  }).filter(function(r) { return r; });
}

async function loadClientesConRemision() {
  try {
    var results = await Promise.all([
      apiGet('getPedidos', { columns: 'Cliente,Remisiones,Estado_2,Producto,Presentacion,Nombre_Empresa' }),
      apiGet('getIngresos', { columns: 'Producto,Presentacion,Cantidad,Remision_Destino,Remision_Origen,Empresa_Destino,Empresa_Origen' }).catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getMuestras', { columns: 'Remision,Empresa,Producto,Presentacion,Cantidad,Cant_Entregada,Tipo_Solicitud' }).catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getDevoluciones', { columns: 'Remision,Remision_Ingreso,Remision_Salida,Empresa,Producto,Presentacion,Cantidad,Cant_Entregada,Estado' }).catch(function() { return { ok: true, devoluciones: [] }; })
    ]);
    var res = results[0];
    var resIng = results[1];
    var resMue = results[2];
    var resDev = results[3];
    var set = {};
    var remMap = {};
    var prodMap = {};
    if (res.ok) {
      (res.pedidos || []).forEach(function(p) {
        var cli = (p.Cliente || '').trim();
        if (p.Estado_2 === 'Anulado') return;
        var rems = _parseRemisionesField(p.Remisiones);
        if (!rems.length) return;
        if (cli) set[cli] = true;
        rems.forEach(function(r) { if (cli) remMap[r.toUpperCase()] = cli; });
        // Cantidad por remisión puntual: "REM|cant|fecha, REM2|cant2|fecha2"
        // (o un solo código sin "|", con toda Cant_Entregada de la fila —
        // aquí no se usa ese caso porque no pedimos Cant_Entregada; una
        // remisión "simple" sin cantidad estructurada no aporta al prorrateo).
        var remStr = (p.Remisiones || '').trim();
        if (remStr.indexOf('|') < 0) return;
        remStr.split(',').forEach(function(seg) {
          var parts = seg.trim().split('|');
          var rem = (parts[0] || '').trim();
          var cant = Number(parts[1]) || 0;
          if (!rem || cant <= 0) return;
          var key = rem.toUpperCase();
          (prodMap[key] = prodMap[key] || []).push({ producto: p.Producto, presentacion: p.Presentacion, cantidad: cant, empresa: p.Nombre_Empresa });
        });
      });
    }
    // Ingresos — traslados planta↔empresa u otro origen. Remision_Destino
    // pertenece a Empresa_Destino (quien recibe) y Remision_Origen a
    // Empresa_Origen (quien despacha); una fila puede aportar a ambas claves.
    if (resIng.ok) {
      (resIng.ingresos || []).forEach(function(ing) {
        var cant = Number(ing.Cantidad) || 0;
        if (cant <= 0) return;
        var remDest = (ing.Remision_Destino || '').trim();
        if (remDest) {
          var keyD = remDest.toUpperCase();
          (prodMap[keyD] = prodMap[keyD] || []).push({ producto: ing.Producto, presentacion: ing.Presentacion, cantidad: cant, empresa: ing.Empresa_Destino });
        }
        var remOrig = (ing.Remision_Origen || '').trim();
        if (remOrig) {
          var keyO = remOrig.toUpperCase();
          (prodMap[keyO] = prodMap[keyO] || []).push({ producto: ing.Producto, presentacion: ing.Presentacion, cantidad: cant, empresa: ing.Empresa_Origen });
        }
      });
    }
    clientesConRemisionCache = Object.keys(set).sort(function(a, b) { return a.localeCompare(b, 'es'); });
    remisionClienteMap = remMap;
    remisionProductoMap = prodMap;

    // Mapa ampliado para el reparto: copia de prodMap + Muestras + Devoluciones
    // (misma convención de cantidad que kardex.js: Cant_Entregada, o Cantidad
    // si no hay). Las órdenes de producción de muestras no despachan; las
    // devoluciones anuladas/pendientes no movieron producto.
    var repMap = {};
    Object.keys(prodMap).forEach(function(k) { repMap[k] = prodMap[k].slice(); });
    function _addRep(rem, emp, prod, pres, cant) {
      var key = String(rem || '').trim().toUpperCase();
      if (!key || cant <= 0) return;
      (repMap[key] = repMap[key] || []).push({ producto: prod, presentacion: pres, cantidad: cant, empresa: emp });
    }
    function _cantDe(r) { return Number(r.Cant_Entregada != null && r.Cant_Entregada !== '' ? r.Cant_Entregada : r.Cantidad) || 0; }
    if (resMue && resMue.ok) {
      (resMue.muestras || []).forEach(function(m) {
        if ((m.Tipo_Solicitud || 'Despacho') === 'Produccion') return;
        _addRep(m.Remision, m.Empresa, m.Producto, m.Presentacion, _cantDe(m));
      });
    }
    if (resDev && resDev.ok) {
      (resDev.devoluciones || []).forEach(function(d) {
        var est = (d.Estado || '').toLowerCase();
        if (est === 'anulado' || est === 'pendiente') return;
        var cant = _cantDe(d);
        var vistas = {};
        [d.Remision, d.Remision_Ingreso, d.Remision_Salida].forEach(function(r) {
          var key = String(r || '').trim().toUpperCase();
          if (!key || vistas[key]) return;
          vistas[key] = true;
          _addRep(key, d.Empresa, d.Producto, d.Presentacion, cant);
        });
      });
    }
    remisionProductoMapReparto = repMap;
    renderProrrateoGastos(); // legs pudo cargar antes o después de este fetch
  } catch (e) {
    clientesConRemisionCache = clientesConRemisionCache || [];
  }
}

// Responsables conocidos; "Otro" pide especificar el nombre.
var RESPONSABLES_FIJOS = ['Leimer Villegas', 'Kevin Rey', 'Giovanny Botia', 'Jhon Paez'];

function setResponsableField(value) {
  var sel = document.getElementById('lg-responsable-select');
  var otro = document.getElementById('lg-responsable-otro');
  if (!value) {
    sel.value = '';
    otro.style.display = 'none';
    otro.value = '';
  } else if (RESPONSABLES_FIJOS.indexOf(value) >= 0) {
    sel.value = value;
    otro.style.display = 'none';
    otro.value = '';
  } else {
    sel.value = 'Otro';
    otro.style.display = '';
    otro.value = value;
  }
}

function onResponsableSelectChange() {
  var sel = document.getElementById('lg-responsable-select');
  var otro = document.getElementById('lg-responsable-otro');
  if (sel.value === 'Otro') {
    otro.style.display = '';
    otro.focus();
  } else {
    otro.style.display = 'none';
    otro.value = '';
  }
}

function readResponsable() {
  var sel = document.getElementById('lg-responsable-select').value;
  if (sel === 'Otro') return document.getElementById('lg-responsable-otro').value.trim();
  return sel;
}

// Catálogo de vehículos (tabla Vehiculos): reemplaza la vieja lista fija
// PLACAS_FIJAS. El <select> se llena dinámicamente (populatePlacaSelects,
// tras cargar getVehiculos) — el value de cada <option> es la placa pura
// (ej. "JRM295"), la descripción solo se muestra en el texto de la opción.
function placaExiste(value) {
  return vehiculos.some(function(v) { return v.Placa === value; });
}

function placaOptionsHtml(selected) {
  var opts = '<option value="">— Seleccionar —</option>';
  vehiculos.filter(function(v) { return v.Activo !== false; })
    .sort(function(a, b) { return a.Placa.localeCompare(b.Placa, 'es'); })
    .forEach(function(v) {
      var label = v.Placa + (v.Descripcion ? ' - ' + v.Descripcion : '');
      opts += '<option value="' + escHtml(v.Placa) + '"' + (v.Placa === selected ? ' selected' : '') + '>' + escHtml(label) + '</option>';
    });
  opts += '<option value="Otro"' + (selected === 'Otro' ? ' selected' : '') + '>Otro (especificar)</option>';
  return opts;
}

// Se llama tras cargar/actualizar `vehiculos` (loadLegalizaciones,
// loadVehiculosData) para refrescar ambos selects de Placa (Ruta y
// Mantenimiento) conservando el valor actualmente seleccionado.
function populatePlacaSelects() {
  ['lg-placa-select', 'mant-placa-select'].forEach(function(id) {
    var sel = document.getElementById(id);
    if (sel) sel.innerHTML = placaOptionsHtml(sel.value);
  });
}

function ultimoKmVehiculo(placa) {
  var v = vehiculos.find(function(x) { return x.Placa === placa; });
  if (!v) return null;
  return { km: Number(v.Km_Actual) || 0, fecha: v.Km_Actual_Fecha, rendimiento: v.Rendimiento_Esperado != null ? Number(v.Rendimiento_Esperado) : null };
}

function setPlacaField(value) {
  var sel = document.getElementById('lg-placa-select');
  var otro = document.getElementById('lg-placa-otro');
  if (!value) {
    sel.value = '';
    otro.style.display = 'none';
    otro.value = '';
  } else if (placaExiste(value)) {
    sel.value = value;
    otro.style.display = 'none';
    otro.value = '';
  } else {
    sel.value = 'Otro';
    otro.style.display = '';
    otro.value = value;
  }
}

// Muestra/oculta el bloque de kilometraje (piloto, KM_PILOTO_PLACAS) y el
// hint del último odómetro conocido de la placa actual, sin tocar los
// valores ya escritos en los campos (openForm los precarga aparte al editar).
function updateKmWrapVisibility() {
  var placa = readPlaca();
  var show = KM_PILOTO_PLACAS.indexOf(placa) >= 0;
  var wrap = document.getElementById('lg-km-wrap');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
  var hintEl = document.getElementById('lg-km-hint');
  if (hintEl) {
    var info = show ? ultimoKmVehiculo(placa) : null;
    hintEl.textContent = info ? ('Último odómetro conocido: ' + info.km.toLocaleString('es-CO') + ' km' + (info.fecha ? ' (' + fmtDate(info.fecha) + ')' : '')) : '';
  }
}

function onPlacaSelectChange() {
  var sel = document.getElementById('lg-placa-select');
  var otro = document.getElementById('lg-placa-otro');
  if (sel.value === 'Otro') {
    otro.style.display = '';
    otro.focus();
  } else {
    otro.style.display = 'none';
    otro.value = '';
  }
  updateKmWrapVisibility();
  // Precarga "Km salida" con el último odómetro conocido, solo en
  // legalizaciones nuevas y si el campo está vacío (no pisa lo que el
  // usuario ya haya escrito).
  if (!editingLegId) {
    var placa = readPlaca();
    var info = KM_PILOTO_PLACAS.indexOf(placa) >= 0 ? ultimoKmVehiculo(placa) : null;
    var salidaInp = document.getElementById('lg-km-salida');
    if (info && salidaInp && !salidaInp.value) salidaInp.value = info.km;
  }
  // La placa determina si la línea de Combustible muestra el input de
  // Galones (ver renderLgGastos) — hay que leer lo ya escrito y redibujar.
  readLgGastos();
  renderLgGastos();
}

function readPlaca() {
  var sel = document.getElementById('lg-placa-select').value;
  if (sel === 'Otro') return document.getElementById('lg-placa-otro').value.trim();
  return sel;
}

// El NIT se guarda como un solo texto "base-DV" (igual que el resto del
// panel); en el formulario se captura en dos casillas separadas.
function splitNitDv(value) {
  var s = (value || '').trim();
  var m = /^(.*)[\s.\-](\d)\s*$/.exec(s);
  if (m) return { nit: m[1].replace(/\D/g, ''), dv: m[2] };
  return { nit: s.replace(/\D/g, ''), dv: '' };
}

function joinNitDv(nit, dv) {
  var n = (nit || '').trim();
  var d = (dv || '').trim();
  return d ? (n + '-' + d) : n;
}

// Conceptos fijos del formulario de gasto de ruta; "Otros" pide especificar
// el detalle. Mantenimiento tiene su propio formulario aparte (ver
// MANTENIMIENTO_DETALLE_FIJOS) y no aparece aquí.
var CONCEPTO_FIJOS = ['Combustible', 'Alimentación', 'Peaje', 'Envío', 'Alojamiento'];

// Detalle de mantenimiento (líneas de gasto del formulario de mantenimiento,
// en vez de Concepto); "Otros" pide especificar.
var MANTENIMIENTO_DETALLE_FIJOS = ['Aceite', 'Llantas', 'Extintor', 'Lavado', 'Mantenimiento correctivo'];

function parseConceptoLineFor(list, concepto) {
  return list.indexOf(concepto) >= 0 ? { sel: concepto, detail: '' } : { sel: 'Otros', detail: concepto || '' };
}

function conceptoOptionsHtmlFor(list, selected) {
  var opts = list.concat(['Otros']).map(function(c) {
    return '<option value="' + escHtml(c) + '"' + (c === selected ? ' selected' : '') + '>' + escHtml(c) + '</option>';
  });
  return opts.join('');
}

function parseConceptoLine(concepto) { return parseConceptoLineFor(CONCEPTO_FIJOS, concepto); }
function conceptoOptionsHtml(selected) { return conceptoOptionsHtmlFor(CONCEPTO_FIJOS, selected); }

// ── Carga inicial ──
async function loadLegalizaciones() {
  await _authReady;
  populateEmpresaSelect('f-emp', 'Todas');
  populateEmpresaSelect('pf-emp', 'Todas');
  populateEmpresaSelect('df-emp', 'Todas');
  populateEmpresaSelect('ef-emp', 'Todas');
  loadClientesConRemision(); // best-effort, no bloquea la carga principal

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
    var results = await Promise.all([
      apiGet('getLegalizacionGastos'),
      apiGet('getLegalizacionGastosItems'),
      apiGet('getLegalizacionGastosEmpresas'),
      apiGet('getVehiculos')
    ]);
    if (!results[0].ok) throw new Error(results[0].error || 'Error desconocido');
    if (!results[1].ok) throw new Error(results[1].error || 'Error desconocido');
    if (!results[2].ok) throw new Error(results[2].error || 'Error desconocido');
    if (!results[3].ok) throw new Error(results[3].error || 'Error desconocido');

    legs = (results[0].legalizaciones || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0, 10);
      return r;
    });
    legItems = results[1].items || [];
    legEmpresas = results[2].empresas || [];
    vehiculos = results[3].vehiculos || [];
    populatePlacaSelects();
    renderVehiculosTab();

    renderTable();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
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

// ── Catálogo de Vehículos (pestaña "Vehículos") ──
async function loadVehiculosData() {
  var res = await apiGet('getVehiculos');
  if (!res.ok) { showToast('Error al cargar vehículos: ' + res.error, '#e74c3c'); return; }
  vehiculos = res.vehiculos || [];
  populatePlacaSelects();
  renderVehiculosTab();
}

function renderVehiculosTab() {
  var box = document.getElementById('veh-body');
  var ctEl = document.getElementById('veh-ct');
  var btnNuevo = document.getElementById('veh-btn-nuevo');
  if (!box) return;

  if (btnNuevo) btnNuevo.style.display = AUTH.hasModule('legalizacion_gastos') ? 'inline-block' : 'none';
  var puedeEditar = AUTH.canConciliarGastos();

  var rows = vehiculos.slice().sort(function(a, b) { return a.Placa.localeCompare(b.Placa, 'es'); });
  if (ctEl) ctEl.textContent = '(' + rows.length + ')';

  box.innerHTML = rows.map(function(v) {
    var descCell = puedeEditar
      ? '<input class="ef" value="' + escHtml(v.Descripcion || '') + '" style="min-width:140px" onchange="guardarVehiculoCampo(' + v.id + ', \'Descripcion\', this.value)">'
      : escHtml(v.Descripcion || '—');
    var rendCell = puedeEditar
      ? '<input class="ef" type="number" min="0" step="0.1" value="' + (v.Rendimiento_Esperado != null ? v.Rendimiento_Esperado : '') + '" style="width:90px;text-align:right" onchange="guardarVehiculoCampo(' + v.id + ', \'Rendimiento_Esperado\', this.value)">'
      : escHtml(v.Rendimiento_Esperado != null ? v.Rendimiento_Esperado : '—');
    var kmTxt = (Number(v.Km_Actual) || 0).toLocaleString('es-CO') + ' km' + (v.Km_Actual_Fecha ? ' (' + fmtDate(v.Km_Actual_Fecha) + ')' : '');
    var pilotoTxt = KM_PILOTO_PLACAS.indexOf(v.Placa) >= 0 ? '<span class="badge b-ent">✅ Sí</span>' : '<span style="color:#a0aec0">—</span>';
    var activoCell = puedeEditar
      ? '<input type="checkbox" ' + (v.Activo !== false ? 'checked' : '') + ' onchange="guardarVehiculoCampo(' + v.id + ', \'Activo\', this.checked)">'
      : (v.Activo !== false ? '✅' : '❌');
    return '<tr>' +
      '<td><strong>' + escHtml(v.Placa) + '</strong></td>' +
      '<td>' + descCell + '</td>' +
      '<td style="text-align:right">' + rendCell + '</td>' +
      '<td style="text-align:right">' + escHtml(kmTxt) + '</td>' +
      '<td>' + pilotoTxt + '</td>' +
      '<td>' + activoCell + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6"><div class="empty">Sin vehículos.</div></td></tr>';
}

async function guardarVehiculoCampo(id, campo, valor) {
  var body = { action: 'editarVehiculo', id: id };
  body[campo] = valor;
  var res = await apiPost(body);
  if (!res.ok) { showToast('Error: ' + res.error, '#e74c3c'); return; }
  showToast('Vehículo actualizado', '#27ae60');
  await loadVehiculosData();
}

async function openNuevoVehiculo() {
  var placa = (prompt('Placa del vehículo nuevo:') || '').trim().toUpperCase();
  if (!placa) return;
  if (placaExiste(placa)) { showToast('Esa placa ya existe en el catálogo', '#e67e22'); return; }
  var desc = (prompt('Descripción (ej. "Camión Blanco"), opcional:') || '').trim();
  var res = await apiPost({ action: 'agregarVehiculo', Placa: placa, Descripcion: desc });
  if (!res.ok) { showToast('Error al agregar: ' + res.error, '#e74c3c'); return; }
  showToast('Vehículo agregado', '#27ae60');
  await loadVehiculosData();
}

// ── Helpers de datos ──
function itemsOf(legId) { return legItems.filter(function(it) { return it.Legalizacion_Id === legId; }); }
function empresasOf(legId) { return legEmpresas.filter(function(e) { return e.Legalizacion_Id === legId; }); }
function totalGastosOf(legId) { return itemsOf(legId).reduce(function(s, it) { return s + (Number(it.Valor) || 0); }, 0); }
function totalRepartoOf(legId) { return empresasOf(legId).reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0); }
// Suma solo las líneas de gasto de un concepto puntual (ej. 'Combustible'),
// usado por calcularProrrateoGastos() para sacarlo del prorrateo por producto.
function totalGastosConceptoOf(legId, concepto) {
  return itemsOf(legId).filter(function(it) { return it.Concepto === concepto; })
    .reduce(function(s, it) { return s + (Number(it.Valor) || 0); }, 0);
}

// ── Proporción de gastos por producto y por empresa (estimada) ──
// Prorratea el gasto de cada viaje entre los productos de sus remisiones
// relacionadas, según los litros movidos de cada uno, y agrega ese mismo
// prorrateo por SKU y por empresa (la Nombre_Empresa del pedido dueño de
// cada línea). Es una aproximación: Remisiones_Relacionadas es texto libre y
// remisionProductoMap solo resuelve entregas de Pedidos (ver
// loadClientesConRemision). Lo que no se puede vincular a un producto, o
// cuyo producto no es convertible a litros, cae en el bucket "Sin identificar"
// — el mismo bucket y monto para ambos desgloses.
//
// Filtros propios de la pestaña Prorrateo (#pf-emp/#pf-desde/#pf-hasta):
// el rango de fechas excluye viajes completos por Fecha; Empresa filtra a
// nivel de LÍNEA de producto, por la empresa dueña de esa remisión resuelta
// (Nombre_Empresa del Pedido), NO por el reparto manual del viaje — así,
// filtrar por una empresa muestra solo sus productos, aunque el viaje haya
// tocado varias empresas. Con el filtro activo, "Sin identificar" se omite
// (no se le puede atribuir a una empresa algo que no se pudo resolver) y el
// total/porcentajes quedan sobre la porción de esa empresa únicamente.
//
// Líquidos vs. sólidos: dentro de un mismo viaje, el gasto primero se separa
// en dos bolsas — "líquidos" (prorrateados por litro) y "sólidos"
// (prorrateados por kilo) — proporcional a cuántas remisiones relacionadas
// aportan a cada bolsa (una remisión con productos de ambos tipos cuenta
// para las dos). Ya dentro de cada bolsa, el reparto entre productos sigue
// siendo por litros o por kilos movidos, como antes. Un viaje 100% líquido
// (el caso más común) se comporta exactamente igual que antes.
//
// Combustible aparte: el concepto 'Combustible' no tiene relación con
// ningún producto/litro/kilo, así que se excluye por completo del reparto
// por producto de arriba y se muestra en su propia tabla "Combustible por
// empresa", repartido según el reparto manual entre empresas que ya trae
// cada legalización (tabla "Reparto entre empresas" del formulario) — no
// según litros/kilos. Un viaje sin ese reparto manual cae en "Sin asignar",
// y también uno cuyo reparto no incluye el Combustible (reparto = total de
// gastos − combustible, ver calcularRepartoForm): por ahora el combustible no
// se prorratea entre empresas.
function calcularProrrateoGastos() {
  var fEmp = document.getElementById('pf-emp').value;
  var fEmpSigla = fEmp ? getSigla(fEmp) : '';
  var fDesde = document.getElementById('pf-desde').value;
  var fHasta = document.getElementById('pf-hasta').value;

  var porEmpresa = {};       // empresaSigla -> monto total
  var porEmpresaSku = {};    // empresaSigla -> { sku -> { monto, legs: { legId -> Consecutivo } } }
  var porEmpresaLitros = {};     // empresaSigla -> litros totales movidos (sin ponderar por monto)
  var porEmpresaKilos = {};      // empresaSigla -> kilos totales movidos (sin ponderar por monto)
  var porEmpresaRemisiones = {}; // empresaSigla -> { codigoRemision: true }
  var porEmpresaLegs = {};       // empresaSigla -> { legId -> Consecutivo } (legalizaciones que tocan esa empresa)
  var legsPeriodo = {};          // legId -> true (todas las legalizaciones del período, resuelvan o no litros/kilos)
  var sinIdentificar = 0;
  var sinIdentificarRemisiones = {}; // codigoRemision -> true (viajes sin producto litro/kilo resoluble)
  var sinIdentificarLegs = {};       // legId -> Consecutivo
  var totalGeneral = 0;

  var combustiblePorEmpresa = {};    // empresaSigla -> monto de Combustible
  var combustibleLegs = {};          // empresaSigla -> { legId -> Consecutivo }
  var combustibleSinAsignar = 0;     // monto de Combustible en viajes sin reparto manual entre empresas
  var combustibleSinAsignarLegs = {};// legId -> Consecutivo
  var combustibleTotalGeneral = 0;

  // Reparte subMonto (la porción de líquidos o de sólidos del viaje) entre
  // las líneas de ese tipo, proporcional a su litros/kilos movidos.
  function _acumularLineas(leg, items, totalUnidad, subMonto, campoUnidad, campoAcumEmp) {
    items.forEach(function(item) {
      var l = item.m;
      if (l[campoUnidad] <= 0) return;
      var emp = getSigla(l.empresa);
      if (fEmpSigla && emp !== fEmpSigla) return;
      var monto = (l[campoUnidad] / totalUnidad) * subMonto;
      var sku = (l.producto || 'Sin nombre') + (l.presentacion ? ' (' + l.presentacion + ')' : '');
      porEmpresa[emp] = (porEmpresa[emp] || 0) + monto;
      var skuMap = porEmpresaSku[emp] || (porEmpresaSku[emp] = {});
      var entry = skuMap[sku] || (skuMap[sku] = { monto: 0, legs: {} });
      entry.monto += monto;
      entry.legs[leg.id] = leg.Consecutivo || ('#' + leg.id);
      totalGeneral += monto;

      campoAcumEmp[emp] = (campoAcumEmp[emp] || 0) + l[campoUnidad];
      (porEmpresaRemisiones[emp] = porEmpresaRemisiones[emp] || {})[item.codigo] = true;
      (porEmpresaLegs[emp] = porEmpresaLegs[emp] || {})[leg.id] = leg.Consecutivo || ('#' + leg.id);
    });
  }

  // Reparte el monto de Combustible de un viaje entre las empresas de su
  // reparto manual (Reparto entre empresas), a prorrata del Monto de cada
  // una — NO por litros/kilos, que no aplican a este concepto. Si el reparto
  // del viaje cubre solo los gastos SIN Combustible (el que calcula el botón
  // "Calcular reparto"), el combustible no tiene reparto asignado: se queda
  // en "Sin reparto asignado" en vez de prorratearse con esas proporciones.
  function _acumularCombustible(leg, monto) {
    var totalReparto = totalRepartoOf(leg.id);
    var repartoSinCombustible = totalReparto === totalGastosOf(leg.id) - monto;
    if (totalReparto <= 0 || repartoSinCombustible) {
      if (!fEmp) {
        combustibleSinAsignar += monto;
        combustibleTotalGeneral += monto;
        combustibleSinAsignarLegs[leg.id] = leg.Consecutivo || ('#' + leg.id);
      }
      return;
    }
    empresasOf(leg.id).forEach(function(e) {
      var eMonto = Number(e.Monto) || 0;
      if (eMonto <= 0) return;
      var emp = getSigla(e.Empresa);
      if (fEmpSigla && emp !== fEmpSigla) return;
      var m = monto * (eMonto / totalReparto);
      combustiblePorEmpresa[emp] = (combustiblePorEmpresa[emp] || 0) + m;
      combustibleTotalGeneral += m;
      (combustibleLegs[emp] = combustibleLegs[emp] || {})[leg.id] = leg.Consecutivo || ('#' + leg.id);
    });
  }

  legs.forEach(function(leg) {
    // Mantenimiento (Tipo='Mantenimiento') es un gasto de vehículo, no de
    // ruta: no tiene remisiones relacionadas ni relación con litros/kilos de
    // producto, así que queda totalmente fuera de esta pestaña (si no, caía
    // completo en "Sin identificar").
    if (leg.Tipo === 'Mantenimiento') return;
    if (leg.Estado_Conciliacion === 'Rechazada') return;
    if (fDesde && (leg.Fecha || '') < fDesde) return;
    if (fHasta && (leg.Fecha || '') > fHasta) return;
    legsPeriodo[leg.id] = true;

    var totalCombustible = totalGastosConceptoOf(leg.id, 'Combustible');
    if (totalCombustible > 0) _acumularCombustible(leg, totalCombustible);

    var totalViaje = totalGastosOf(leg.id) - totalCombustible;
    if (totalViaje <= 0) return;

    // Remisiones_Relacionadas es un CSV simple de códigos (sin "|cant|fecha"),
    // igual formato que lee openForm() al editar (línea ~591) — no usar
    // _parseRemisionesField aquí, que solo separa por coma cuando detecta "|".
    var codigos = (leg.Remisiones_Relacionadas || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    var lineas = [];
    // Un envío suele despachar muestras: sus remisiones se resuelven también
    // contra Muestras y Devoluciones; para Ruta se mantiene el mapa de siempre.
    var mapaRem = esEnvio(leg) ? remisionProductoMapReparto : remisionProductoMap;
    codigos.forEach(function(c) {
      var matches = mapaRem[c.trim().toUpperCase()];
      if (matches) matches.forEach(function(m) { lineas.push({ m: m, codigo: c }); });
    });

    var totalLitros = 0, totalKilos = 0;
    var codigosLiquido = {}, codigosSolido = {};
    lineas.forEach(function(item) {
      var l = item.m;
      var lit = _litParse(l.producto, l.presentacion);
      l._litros = lit.convertible ? lit.litrosUnidad * (Number(l.cantidad) || 0) : 0;
      l._kilos = lit.convertibleKilo ? lit.kilosUnidad * (Number(l.cantidad) || 0) : 0;
      totalLitros += l._litros;
      totalKilos += l._kilos;
      if (l._litros > 0) codigosLiquido[item.codigo] = true;
      if (l._kilos > 0) codigosSolido[item.codigo] = true;
    });

    var nLiq = Object.keys(codigosLiquido).length;
    var nSol = Object.keys(codigosSolido).length;

    if (nLiq + nSol <= 0) {
      if (!fEmp) {
        sinIdentificar += totalViaje;
        totalGeneral += totalViaje;
        sinIdentificarLegs[leg.id] = leg.Consecutivo || ('#' + leg.id);
        codigos.forEach(function(c) { sinIdentificarRemisiones[c] = true; });
      }
      return;
    }

    // Reparto del gasto del viaje entre la bolsa de líquidos y la de
    // sólidos, proporcional a cuántas remisiones aportan a cada una.
    var montoLiquidos = totalViaje * nLiq / (nLiq + nSol);
    var montoSolidos = totalViaje * nSol / (nLiq + nSol);

    if (totalLitros > 0) _acumularLineas(leg, lineas, totalLitros, montoLiquidos, '_litros', porEmpresaLitros);
    if (totalKilos > 0) _acumularLineas(leg, lineas, totalKilos, montoSolidos, '_kilos', porEmpresaKilos);
  });

  return {
    porEmpresa: porEmpresa,
    porEmpresaSku: porEmpresaSku,
    porEmpresaLitros: porEmpresaLitros,
    porEmpresaKilos: porEmpresaKilos,
    porEmpresaRemisiones: porEmpresaRemisiones,
    porEmpresaLegs: porEmpresaLegs,
    legsPeriodoCount: Object.keys(legsPeriodo).length,
    sinIdentificar: sinIdentificar,
    sinIdentificarRemisiones: sinIdentificarRemisiones,
    sinIdentificarLegs: sinIdentificarLegs,
    totalGeneral: totalGeneral,
    combustiblePorEmpresa: combustiblePorEmpresa,
    combustibleLegs: combustibleLegs,
    combustibleSinAsignar: combustibleSinAsignar,
    combustibleSinAsignarLegs: combustibleSinAsignarLegs,
    combustibleTotalGeneral: combustibleTotalGeneral
  };
}

// Litros/kilos con 2 decimales máx. (igual convención que _litFmt de
// reportes.js, pero local a este módulo).
function _litFmtLg(n) {
  var v = Number(n) || 0;
  var r = Math.round((v + Number.EPSILON) * 100) / 100;
  return r.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' L';
}
function _kiloFmtLg(n) {
  var v = Number(n) || 0;
  var r = Math.round((v + Number.EPSILON) * 100) / 100;
  return r.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' Kg';
}

// Monto con 2 decimales (el prorrateo por litros da valores fraccionarios;
// fmtMoney de shared.js redondea a entero, aquí interesa ver la precisión real).
function fmtMoney2(v) {
  var n = Number(v); if (!n && n !== 0) return '—';
  return '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "08:30:00" (columna time de Postgres) -> "08:30"
function fmtHora(h) { return h ? String(h).slice(0, 5) : ''; }

// Tabla (cuadrícula) reutilizable para las dos vistas de prorrateo.
// rows: [{label, value, pct, html?, legs?}] — html, si viene, reemplaza el
// texto plano de la primera columna (badge de sigla en "por empresa"); legs
// (si viene) es [{id, consecutivo}] de las legalizaciones que aportaron a
// esa fila, mostradas como enlaces a "Ver" debajo del label.
function lgProrrateoTable(rows, headerLabel) {
  if (!rows.length) return '<div class="empty">Sin datos.</div>';
  var body = rows.map(function(r) {
    // El km recorridos (piloto KM_PILOTO_PLACAS) se muestra como referencia
    // junto al enlace de cada legalización — no cambia el monto ni el %,
    // que siguen siendo el reparto manual entre empresas de siempre.
    var legsHtml = (r.legs && r.legs.length) ? '<div class="ac-sub">' + r.legs.map(function(l) {
      var leg = legs.find(function(x) { return x.id === l.id; });
      var kmTxt = (leg && leg.Km_Salida != null && leg.Km_Llegada != null)
        ? ' <span style="color:#a0aec0">(' + (Number(leg.Km_Llegada) - Number(leg.Km_Salida)).toLocaleString('es-CO') + ' km)</span>' : '';
      return '<a href="javascript:void(0)" onclick="openVer(' + l.id + ')" style="color:#1a5276">' + escHtml(l.consecutivo) + '</a>' + kmTxt;
    }).join(', ') + '</div>' : '';
    return '<tr><td>' + (r.html || escHtml(r.label)) + legsHtml + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney2(r.value)) + '</td>' +
      '<td style="text-align:right">' + r.pct.toFixed(2) + '%</td></tr>';
  }).join('');
  return '<div style="overflow-x:auto"><table>' +
    '<thead><tr><th>' + escHtml(headerLabel) + '</th><th style="text-align:right">Monto</th><th style="text-align:right">%</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}

function renderProrrateoGastos() {
  var calc = calcularProrrateoGastos();
  renderResumenProrrateo(calc);
  renderCombustiblePorEmpresa(calc);
  renderGastoPorProducto(calc);
  renderGastoPorEmpresa(calc);
}

// Combustible por empresa: aparte del prorrateo por producto (litros/kilos),
// repartido según el reparto manual entre empresas de cada legalización.
function renderCombustiblePorEmpresa(calc) {
  var box = document.getElementById('gpc-body');
  if (!box) return;

  var total = calc.combustibleTotalGeneral;
  if (total <= 0) {
    box.innerHTML = '<div class="empty">Sin gastos de Combustible para este período.</div>';
    return;
  }

  var rows = Object.keys(calc.combustiblePorEmpresa).map(function(emp) {
    var legs = Object.keys(calc.combustibleLegs[emp] || {}).map(function(id) {
      return { id: Number(id), consecutivo: calc.combustibleLegs[emp][id] };
    }).sort(function(a, b) { return a.consecutivo.localeCompare(b.consecutivo); });
    return { label: emp, value: calc.combustiblePorEmpresa[emp], html: '<span class="sigla-badge ' + getSiglaClass(emp) + '">' + escHtml(emp) + '</span>', legs: legs };
  }).sort(function(a, b) { return b.value - a.value; });

  if (calc.combustibleSinAsignar > 0) {
    var legsSin = Object.keys(calc.combustibleSinAsignarLegs || {}).map(function(id) {
      return { id: Number(id), consecutivo: calc.combustibleSinAsignarLegs[id] };
    }).sort(function(a, b) { return a.consecutivo.localeCompare(b.consecutivo); });
    rows.push({ label: 'Sin reparto asignado', value: calc.combustibleSinAsignar, legs: legsSin });
  }

  rows.forEach(function(r) { r.pct = total > 0 ? (r.value / total * 100) : 0; });

  box.innerHTML = lgProrrateoTable(rows, 'Empresa');
}

// Resumen del período: litros y kilos totales movidos y remisiones
// relacionadas por empresa, más la cantidad de legalizaciones consideradas
// (respeta los filtros Empresa/Desde/Hasta de esta pestaña, igual que las
// otras dos tablas). Con el filtro de Empresa activo, el conteo de
// legalizaciones pasa a ser el de esa empresa puntual (las que aportaron al
// menos una línea, líquida o sólida).
function renderResumenProrrateo(calc) {
  var box = document.getElementById('gpr-body');
  var legsEl = document.getElementById('gpr-legs-total');
  if (!box) return;

  var fEmp = document.getElementById('pf-emp').value;
  var fEmpSigla = fEmp ? getSigla(fEmp) : '';
  var legsCount = fEmpSigla ? Object.keys(calc.porEmpresaLegs[fEmpSigla] || {}).length : calc.legsPeriodoCount;
  if (legsEl) legsEl.textContent = legsCount + ' legalización' + (legsCount === 1 ? '' : 'es') + ' en el período';

  var empSet = {};
  Object.keys(calc.porEmpresaLitros).forEach(function(e) { empSet[e] = true; });
  Object.keys(calc.porEmpresaKilos).forEach(function(e) { empSet[e] = true; });
  var empresas = Object.keys(empSet).sort(function(a, b) {
    return (calc.porEmpresaLegs[b] ? Object.keys(calc.porEmpresaLegs[b]).length : 0) -
           (calc.porEmpresaLegs[a] ? Object.keys(calc.porEmpresaLegs[a]).length : 0);
  });
  var sinIdRemisiones = Object.keys(calc.sinIdentificarRemisiones || {}).sort(function(a, b) { return a.localeCompare(b, 'es'); });

  if (!empresas.length && !sinIdRemisiones.length) {
    box.innerHTML = '<div class="empty">Sin datos para este período.</div>';
    return;
  }

  function remisionesHtml(codigos) {
    if (!codigos.length) return '<span style="color:#a0aec0;font-size:0.82rem">Sin remisiones.</span>';
    return codigos.map(function(r) {
      return '<span class="badge b-par" style="margin:2px 4px 2px 0">' + escHtml(r) + '</span>';
    }).join('');
  }

  var html = empresas.map(function(emp) {
    var litros = calc.porEmpresaLitros[emp] || 0;
    var kilos = calc.porEmpresaKilos[emp] || 0;
    var totalesTxt = [litros > 0 ? _litFmtLg(litros) : null, kilos > 0 ? _kiloFmtLg(kilos) : null].filter(Boolean).join(' · ');
    var nLegs = Object.keys(calc.porEmpresaLegs[emp] || {}).length;
    var remisiones = Object.keys(calc.porEmpresaRemisiones[emp] || {}).sort(function(a, b) { return a.localeCompare(b, 'es'); });

    return '<div class="gpp-group">' +
      '<div class="gpp-group-head">' +
        '<span class="sigla-badge ' + getSiglaClass(emp) + '">' + escHtml(emp) + '</span>' +
        '<span class="gpp-group-total">' + escHtml(totalesTxt) + ' <span style="color:#a0aec0;font-weight:400">· ' + nLegs + ' legalización' + (nLegs === 1 ? '' : 'es') + '</span></span>' +
      '</div>' +
      '<div style="padding:2px 0 4px">' + remisionesHtml(remisiones) + '</div>' +
    '</div>';
  }).join('');

  if (sinIdRemisiones.length) {
    var nLegsSin = Object.keys(calc.sinIdentificarLegs || {}).length;
    html += '<div class="gpp-group">' +
      '<div class="gpp-group-head">' +
        '<span style="color:#718096;font-weight:700">Sin identificar</span>' +
        '<span class="gpp-group-total"><span style="color:#a0aec0;font-weight:400">' + nLegsSin + ' legalización' + (nLegsSin === 1 ? '' : 'es') + '</span></span>' +
      '</div>' +
      '<div style="padding:2px 0 4px">' + remisionesHtml(sinIdRemisiones) + '</div>' +
    '</div>';
  }

  box.innerHTML = html;
}

function clearProrrateoFiltros() {
  document.getElementById('pf-emp').value = '';
  document.getElementById('pf-desde').value = '';
  document.getElementById('pf-hasta').value = '';
  renderProrrateoGastos();
}

// Exporta a Excel el mismo prorrateo que se ve en pantalla (respeta los
// filtros de Empresa/Desde/Hasta activos): hoja "Prorrateo" con una fila por
// producto de cada empresa (más "Sin identificar" si aplica, ya sin
// Combustible), y hoja "Combustible" con el reparto de ese concepto por
// empresa (más "Sin reparto asignado" si aplica).
function exportarProrrateoExcel() {
  var calc = calcularProrrateoGastos();
  var total = calc.totalGeneral;
  var empresas = Object.keys(calc.porEmpresa);
  if (!empresas.length && calc.sinIdentificar <= 0 && calc.combustibleTotalGeneral <= 0) {
    showToast('No hay datos para exportar', '#e74c3c');
    return;
  }

  var rows = [];
  empresas.sort(function(a, b) { return calc.porEmpresa[b] - calc.porEmpresa[a]; }).forEach(function(emp) {
    Object.keys(calc.porEmpresaSku[emp] || {}).map(function(sku) {
      return { sku: sku, entry: calc.porEmpresaSku[emp][sku] };
    }).sort(function(a, b) { return b.entry.monto - a.entry.monto; }).forEach(function(x) {
      var legsTxt = Object.keys(x.entry.legs).map(function(id) { return x.entry.legs[id]; }).sort().join(', ');
      rows.push({
        'Empresa': emp,
        'Producto': x.sku,
        'Monto': Number(x.entry.monto.toFixed(2)),
        '% del total': Number((total > 0 ? x.entry.monto / total * 100 : 0).toFixed(2)),
        'Legalizaciones': legsTxt
      });
    });
  });
  if (calc.sinIdentificar > 0) {
    rows.push({
      'Empresa': '',
      'Producto': 'Sin identificar',
      'Monto': Number(calc.sinIdentificar.toFixed(2)),
      '% del total': Number((total > 0 ? calc.sinIdentificar / total * 100 : 0).toFixed(2)),
      'Legalizaciones': ''
    });
  }

  var totalComb = calc.combustibleTotalGeneral;
  var rowsComb = Object.keys(calc.combustiblePorEmpresa)
    .sort(function(a, b) { return calc.combustiblePorEmpresa[b] - calc.combustiblePorEmpresa[a]; })
    .map(function(emp) {
      var legsTxt = Object.keys(calc.combustibleLegs[emp] || {}).map(function(id) { return calc.combustibleLegs[emp][id]; }).sort().join(', ');
      return {
        'Empresa': emp,
        'Monto': Number(calc.combustiblePorEmpresa[emp].toFixed(2)),
        '% del total': Number((totalComb > 0 ? calc.combustiblePorEmpresa[emp] / totalComb * 100 : 0).toFixed(2)),
        'Legalizaciones': legsTxt
      };
    });
  if (calc.combustibleSinAsignar > 0) {
    var legsSinTxt = Object.keys(calc.combustibleSinAsignarLegs || {}).map(function(id) { return calc.combustibleSinAsignarLegs[id]; }).sort().join(', ');
    rowsComb.push({
      'Empresa': 'Sin reparto asignado',
      'Monto': Number(calc.combustibleSinAsignar.toFixed(2)),
      '% del total': Number((totalComb > 0 ? calc.combustibleSinAsignar / totalComb * 100 : 0).toFixed(2)),
      'Legalizaciones': legsSinTxt
    });
  }

  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 42 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Prorrateo');
  if (rowsComb.length) {
    var wsComb = XLSX.utils.json_to_sheet(rowsComb);
    wsComb['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsComb, 'Combustible');
  }
  XLSX.writeFile(wb, 'prorrateo_gastos_' + today() + '.xlsx');
  showToast('Excel exportado');
}

// Agrupado por empresa (una sección + tabla de productos por cada una), para
// verlas todas separadas de una vez sin tener que ir cambiando el filtro de
// Empresa. Si el filtro SÍ está activo, esto simplemente deja una sola
// sección (la de esa empresa).
function renderGastoPorProducto(calc) {
  var box = document.getElementById('gpp-body');
  if (!box) return;
  var total = calc.totalGeneral;
  var empresas = Object.keys(calc.porEmpresa).sort(function(a, b) { return calc.porEmpresa[b] - calc.porEmpresa[a]; });

  if (!empresas.length && calc.sinIdentificar <= 0) {
    box.innerHTML = '<div class="empty">Sin gastos para calcular.</div>';
    return;
  }

  var html = empresas.map(function(emp) {
    var empTotal = calc.porEmpresa[emp];
    var pctEmp = total > 0 ? (empTotal / total * 100) : 0;
    var rows = Object.keys(calc.porEmpresaSku[emp] || {}).map(function(sku) {
      var entry = calc.porEmpresaSku[emp][sku];
      var legs = Object.keys(entry.legs).map(function(id) {
        return { id: Number(id), consecutivo: entry.legs[id] };
      }).sort(function(a, b) { return a.consecutivo.localeCompare(b.consecutivo); });
      return { label: sku, value: entry.monto, legs: legs };
    }).sort(function(a, b) { return b.value - a.value; });
    rows.forEach(function(r) { r.pct = empTotal > 0 ? (r.value / empTotal * 100) : 0; });

    return '<div class="gpp-group">' +
      '<div class="gpp-group-head">' +
        '<span class="sigla-badge ' + getSiglaClass(emp) + '">' + escHtml(emp) + '</span>' +
        '<span class="gpp-group-total">' + escHtml(fmtMoney2(empTotal)) + ' <span style="color:#a0aec0;font-weight:400">(' + pctEmp.toFixed(2) + '% del total)</span></span>' +
      '</div>' +
      lgProrrateoTable(rows, 'Producto') +
    '</div>';
  }).join('');

  if (calc.sinIdentificar > 0) {
    var pctSin = total > 0 ? (calc.sinIdentificar / total * 100) : 0;
    html += '<div class="gpp-group">' +
      '<div class="gpp-group-head">' +
        '<span style="color:#718096;font-weight:700">Sin identificar</span>' +
        '<span class="gpp-group-total">' + escHtml(fmtMoney2(calc.sinIdentificar)) + ' <span style="color:#a0aec0;font-weight:400">(' + pctSin.toFixed(2) + '% del total)</span></span>' +
      '</div>' +
    '</div>';
  }

  box.innerHTML = html;
}

function renderGastoPorEmpresa(calc) {
  var box = document.getElementById('gpe-body');
  if (!box) return;
  var total = calc.totalGeneral;
  if (total <= 0) {
    box.innerHTML = '<div class="empty">Sin gastos para calcular.</div>';
    return;
  }

  var rows = Object.keys(calc.porEmpresa).map(function(emp) {
    return { label: emp, value: calc.porEmpresa[emp], html: '<span class="sigla-badge ' + getSiglaClass(emp) + '">' + escHtml(emp) + '</span>' };
  }).sort(function(a, b) { return b.value - a.value; });

  if (calc.sinIdentificar > 0) rows.push({ label: 'Sin identificar', value: calc.sinIdentificar });

  rows.forEach(function(r) { r.pct = r.value / total * 100; });

  box.innerHTML = lgProrrateoTable(rows, 'Empresa');
}

function esEnvio(leg) { return !!leg && leg.Tipo === 'Envio'; }

// Nombre legible del tipo (para Excel y filtros).
function tipoLabel(leg) {
  if (esEnvio(leg)) return 'Envío';
  return leg.Tipo === 'Mantenimiento' ? 'Mantenimiento' : 'Ruta';
}

// Estado tal como lo ve el usuario: los envíos no se concilian, así que se
// muestran como "Registrado" aunque en BD queden 'Por conciliar'.
function estadoLeg(leg) { return esEnvio(leg) ? 'Registrado' : leg.Estado_Conciliacion; }

// Con Tipo = Envío el filtro de Estado se ignora (un envío nunca está
// "Por conciliar"), así el usuario ve todos los envíos sin tocar el Estado.
// (Lo usa la Vista detallada; la lista principal ya no incluye envíos.)
function pasaFiltroEstado(leg, fEstado, fTipo) {
  return !fEstado || fTipo === 'Envio' || estadoLeg(leg) === fEstado;
}

// Proveedores de las líneas de gasto (un envío tiene uno solo), para mostrar
// y para buscar en la lista.
function proveedoresTexto(legId) {
  var seen = {};
  return itemsOf(legId).map(function(it) { return (it.Proveedor || '').trim(); })
    .filter(function(p) { if (!p || seen[p]) return false; seen[p] = true; return true; }).join(', ');
}

function tipoBadgeHtml(leg) {
  if (esEnvio(leg)) return '<span class="badge b-abierto">📦 Envío</span>';
  return (leg.Tipo === 'Mantenimiento')
    ? '<span class="badge b-fac">🔧 Mantenimiento</span>'
    : '<span class="badge b-par">🚚 Ruta</span>';
}

function estadoBadgeHtml(leg) {
  if (esEnvio(leg)) return '<span class="badge b-cerrado">📦 Registrado</span>';
  if (leg.Estado_Conciliacion === 'Conciliada') return '<span class="badge b-ent">✅ Conciliada</span>';
  if (leg.Estado_Conciliacion === 'Rechazada') {
    return '<span class="badge b-anulado" title="' + escHtml(leg.Motivo_Rechazo || '') + '">❌ Rechazada</span>';
  }
  return '<span class="badge b-rec">⏳ Por conciliar</span>';
}

function empresasBadgesHtml(legId) {
  var emps = empresasOf(legId);
  if (!emps.length) return '<span style="color:#a0aec0">—</span>';
  return emps.map(function(e) {
    return '<span class="sigla-badge sigla-' + escHtml(getSiglaClass(e.Empresa).replace('sigla-', '')) + '" style="font-size:0.7rem;padding:1px 7px;margin:1px" title="' + escHtml(fmtMoney(e.Monto)) + '">' + escHtml(getSigla(e.Empresa)) + '</span>';
  }).join(' ');
}

// ── Vista detallada ──
// Segunda mirada sobre las mismas legalizaciones, con dos modos: una fila
// ancha por legalización (con lo que hoy solo se ve al abrir "Ver": placa,
// clientes, remisiones, reparto por empresa, líneas de gasto y km/rendimiento
// si aplica) o una fila por línea de gasto (para sumar/filtrar por concepto o
// proveedor a través de todos los viajes). Filtros propios (df-*), separados
// de los de la pestaña Legalizaciones y de los de Prorrateo.
var detalleModo = 'legalizacion'; // 'legalizacion' | 'linea'

function setDetalleModo(modo) {
  detalleModo = modo;
  var btnLeg = document.getElementById('df-modo-legalizacion');
  var btnLin = document.getElementById('df-modo-linea');
  if (btnLeg) btnLeg.style.background = (modo === 'legalizacion') ? '#1a5276' : '#718096';
  if (btnLin) btnLin.style.background = (modo === 'linea') ? '#1a5276' : '#718096';
  renderDetalleTable();
}

function _detalleLegsFiltrados() {
  var fEmp = document.getElementById('df-emp').value;
  var fTipo = document.getElementById('df-tipo').value;
  var fEstado = document.getElementById('df-estado').value;
  var fDesde = document.getElementById('df-desde').value;
  var fHasta = document.getElementById('df-hasta').value;
  var fTxt = (document.getElementById('df-txt').value || '').toLowerCase().trim();

  return legs.filter(function(leg) {
    if (!pasaFiltroEstado(leg, fEstado, fTipo)) return false;
    if (fTipo && (leg.Tipo || 'Ruta') !== fTipo) return false;
    if (fEmp && !empresasOf(leg.id).some(function(e) { return e.Empresa === fEmp; })) return false;
    if (fDesde && (leg.Fecha || '') < fDesde) return false;
    if (fHasta && (leg.Fecha || '') > fHasta) return false;
    if (fTxt) {
      var hay = [leg.Consecutivo, leg.Responsable, leg.Recorrido_Ruta, leg.Clientes, leg.Placa, proveedoresTexto(leg.id)]
        .map(function(v) { return (v || '').toLowerCase(); }).join(' ');
      if (hay.indexOf(fTxt) < 0) return false;
    }
    return true;
  }).sort(function(a, b) { return (b.Fecha || '').localeCompare(a.Fecha || '') || (b.id - a.id); });
}

// Km recorridos (Ruta, salida→llegada) u odómetro registrado (Mantenimiento);
// mismo criterio que el bloque de kilometraje de renderVerBody. '—' si el
// viaje no está en el piloto de kilometraje.
function _detalleKmTxt(leg) {
  var esMant = leg.Tipo === 'Mantenimiento';
  if (!esMant && leg.Km_Salida != null && leg.Km_Llegada != null) {
    return (Number(leg.Km_Llegada) - Number(leg.Km_Salida)).toLocaleString('es-CO') + ' km';
  }
  if (esMant && leg.Km_Llegada != null) {
    return Number(leg.Km_Llegada).toLocaleString('es-CO') + ' km (odóm.)';
  }
  return '—';
}

function renderDetalleTable() {
  var box = document.getElementById('detalle-body');
  if (!box) return;
  var rows = _detalleLegsFiltrados();
  var ctEl = document.getElementById('df-ct');

  if (detalleModo === 'linea') {
    var lineas = [];
    rows.forEach(function(leg) {
      itemsOf(leg.id).forEach(function(it) { lineas.push({ leg: leg, it: it }); });
    });
    if (ctEl) ctEl.textContent = '(' + lineas.length + ' línea' + (lineas.length === 1 ? '' : 's') + ' · ' + rows.length + ' legalización' + (rows.length === 1 ? '' : 'es') + ')';
    box.innerHTML = _detalleTablaLinea(lineas);
  } else {
    if (ctEl) ctEl.textContent = '(' + rows.length + ')';
    box.innerHTML = _detalleTablaLegalizacion(rows);
  }
}

function _detalleTablaLegalizacion(rows) {
  if (!rows.length) return '<div class="empty">Sin legalizaciones para este filtro.</div>';
  var body = rows.map(function(leg) {
    var gastosTxt = itemsOf(leg.id).map(function(it) { return (it.Concepto || '—') + ': ' + fmtMoney(it.Valor); }).join(', ') || '—';
    return '<tr>' +
      '<td>' + escHtml(leg.Consecutivo || '') + '</td>' +
      '<td>' + escHtml(fmtDate(leg.Fecha)) + '</td>' +
      '<td>' + tipoBadgeHtml(leg) + '</td>' +
      '<td>' + escHtml(leg.Responsable || '—') + '</td>' +
      '<td>' + escHtml(leg.Placa || '—') + '</td>' +
      '<td>' + escHtml(leg.Recorrido_Ruta || '—') + '</td>' +
      '<td>' + escHtml(leg.Clientes || '—') + '</td>' +
      '<td style="max-width:220px;white-space:normal">' + escHtml(leg.Remisiones_Relacionadas || '—') + '</td>' +
      '<td>' + empresasBadgesHtml(leg.id) + '</td>' +
      '<td style="max-width:260px;white-space:normal;font-size:0.78rem">' + escHtml(gastosTxt) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(totalGastosOf(leg.id))) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(leg.Anticipo_Entregado)) + '</td>' +
      '<td>' + escHtml(_detalleKmTxt(leg)) + '</td>' +
      '<td>' + estadoBadgeHtml(leg) + '</td>' +
      '<td style="max-width:200px;white-space:normal">' + escHtml(leg.Observaciones || '—') + '</td>' +
      '<td><button class="btn-ver" onclick="openVer(' + leg.id + ')">👁 Ver</button></td>' +
    '</tr>';
  }).join('');
  return '<table><thead><tr>' +
    '<th>N°</th><th>Fecha</th><th>Tipo</th><th>Responsable</th><th>Placa</th><th>Ruta</th><th>Clientes</th>' +
    '<th>Remisiones</th><th>Empresas</th><th>Gastos</th><th style="text-align:right">Total gastos</th>' +
    '<th style="text-align:right">Anticipo</th><th>Km</th><th>Estado</th><th>Observaciones</th><th>Acciones</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>';
}

function _detalleTablaLinea(lineas) {
  if (!lineas.length) return '<div class="empty">Sin líneas de gasto para este filtro.</div>';
  var body = lineas.map(function(x) {
    var leg = x.leg, it = x.it;
    return '<tr>' +
      '<td>' + escHtml(leg.Consecutivo || '') + '</td>' +
      '<td>' + escHtml(fmtDate(leg.Fecha)) + '</td>' +
      '<td>' + tipoBadgeHtml(leg) + '</td>' +
      '<td>' + escHtml(leg.Responsable || '—') + '</td>' +
      '<td>' + escHtml(leg.Placa || '—') + '</td>' +
      '<td>' + empresasBadgesHtml(leg.id) + '</td>' +
      '<td>' + escHtml(it.Concepto || '—') + '</td>' +
      '<td>' + escHtml(it.Proveedor || '—') + '</td>' +
      '<td>' + escHtml(it.NIT || '—') + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(it.Valor)) + '</td>' +
      '<td>' + estadoBadgeHtml(leg) + '</td>' +
      '<td><button class="btn-ver" onclick="openVer(' + leg.id + ')">👁 Ver</button></td>' +
    '</tr>';
  }).join('');
  return '<table><thead><tr>' +
    '<th>N°</th><th>Fecha</th><th>Tipo</th><th>Responsable</th><th>Placa</th><th>Empresas</th>' +
    '<th>Concepto</th><th>Proveedor</th><th>NIT</th><th style="text-align:right">Valor</th><th>Estado</th><th>Acciones</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>';
}

// Exporta la misma vista activa (por legalización o por línea de gasto),
// respetando los filtros df-* actuales.
function exportarDetalleExcel() {
  var rows = _detalleLegsFiltrados();
  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var wb = XLSX.utils.book_new();
  if (detalleModo === 'linea') {
    var dataLinea = [];
    rows.forEach(function(leg) {
      itemsOf(leg.id).forEach(function(it) {
        dataLinea.push({
          'N°': leg.Consecutivo || '',
          'Fecha': fmtDate(leg.Fecha),
          'Tipo': tipoLabel(leg),
          'Responsable': leg.Responsable || '',
          'Placa': leg.Placa || '',
          'Empresas (reparto)': empresasOf(leg.id).map(function(e) { return getSigla(e.Empresa) + ' ' + fmtMoney(e.Monto); }).join(', '),
          'Concepto': it.Concepto || '',
          'Proveedor': it.Proveedor || '',
          'NIT': it.NIT || '',
          'Valor': Number(it.Valor) || 0,
          'Estado': estadoLeg(leg) || ''
        });
      });
    });
    if (!dataLinea.length) { showToast('No hay líneas de gasto para exportar', '#e74c3c'); return; }
    var wsLinea = XLSX.utils.json_to_sheet(dataLinea);
    XLSX.utils.book_append_sheet(wb, wsLinea, 'Por linea de gasto');
  } else {
    var dataLeg = rows.map(function(leg) {
      var esMant = leg.Tipo === 'Mantenimiento';
      var km = '';
      if (!esMant && leg.Km_Salida != null && leg.Km_Llegada != null) km = Number(leg.Km_Llegada) - Number(leg.Km_Salida);
      else if (esMant && leg.Km_Llegada != null) km = Number(leg.Km_Llegada);
      return {
        'N°': leg.Consecutivo || '',
        'Fecha': fmtDate(leg.Fecha),
        'Tipo': tipoLabel(leg),
        'Responsable': leg.Responsable || '',
        'Placa': leg.Placa || '',
        'Ruta': leg.Recorrido_Ruta || '',
        'Clientes': leg.Clientes || '',
        'Remisiones': leg.Remisiones_Relacionadas || '',
        'Empresas (reparto)': empresasOf(leg.id).map(function(e) { return getSigla(e.Empresa) + ' ' + fmtMoney(e.Monto); }).join(', '),
        'Gastos (detalle)': itemsOf(leg.id).map(function(it) { return (it.Concepto || '') + ': ' + fmtMoney(it.Valor); }).join(', '),
        'Total gastos': totalGastosOf(leg.id),
        'Anticipo': Number(leg.Anticipo_Entregado) || 0,
        'Km': km,
        'Estado': estadoLeg(leg) || '',
        'Observaciones': leg.Observaciones || ''
      };
    });
    var wsLeg = XLSX.utils.json_to_sheet(dataLeg);
    XLSX.utils.book_append_sheet(wb, wsLeg, 'Por legalizacion');
  }
  XLSX.writeFile(wb, 'legalizaciones_detalle_' + today() + '.xlsx');
  showToast('Excel exportado');
}

// ── Tabla ──
function renderTable() {
  var fEmp = document.getElementById('f-emp').value;
  var fTipo = document.getElementById('f-tipo').value;
  var fEstado = document.getElementById('f-estado').value;
  var fTxt = (document.getElementById('f-txt').value || '').toLowerCase().trim();

  var rows = legs.filter(function(leg) {
    if (esEnvio(leg)) return false; // los envíos tienen su propia pestaña (renderEnviosTable)
    if (fEstado && leg.Estado_Conciliacion !== fEstado) return false;
    if (fTipo && (leg.Tipo || 'Ruta') !== fTipo) return false;
    if (fEmp && !empresasOf(leg.id).some(function(e) { return e.Empresa === fEmp; })) return false;
    if (fTxt) {
      var hay = [leg.Consecutivo, leg.Responsable, leg.Recorrido_Ruta, leg.Clientes, proveedoresTexto(leg.id)]
        .map(function(v) { return (v || '').toLowerCase(); }).join(' ');
      if (hay.indexOf(fTxt) < 0) return false;
    }
    return true;
  }).sort(function(a, b) { return (b.Fecha || '').localeCompare(a.Fecha || '') || (b.id - a.id); });

  document.getElementById('lg-ct').textContent = '(' + rows.length + ')';

  var canEditMod = AUTH.hasModule('legalizacion_gastos');
  var canDel = AUTH.canDelete();

  document.getElementById('lg-body').innerHTML = rows.map(function(leg) {
    var total = totalGastosOf(leg.id);
    var esMant = leg.Tipo === 'Mantenimiento';
    var acciones = '<button class="btn-ver" onclick="openVer(' + leg.id + ')">👁 Ver</button>';
    if (leg.Estado_Conciliacion === 'Por conciliar' && canEditMod) {
      acciones += ' <button class="btn-edit" onclick="' + (esMant ? 'openFormMant' : 'openForm') + '(' + leg.id + ')">✏️</button>';
    }
    if (leg.Estado_Conciliacion === 'Por conciliar' && canDel) {
      acciones += ' <button class="btn-edit" style="color:#c0392b" onclick="eliminarLegalizacion(' + leg.id + ')">🗑️</button>';
    }
    return '<tr>' +
      '<td>' + escHtml(leg.Consecutivo || '') + '</td>' +
      '<td>' + escHtml(fmtDate(leg.Fecha)) + '</td>' +
      '<td>' + escHtml(leg.Responsable || '') + '</td>' +
      '<td>' + tipoBadgeHtml(leg) + '</td>' +
      '<td>' + escHtml(leg.Recorrido_Ruta || '') + '</td>' +
      '<td>' + empresasBadgesHtml(leg.id) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(total)) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(leg.Anticipo_Entregado)) + '</td>' +
      '<td>' + estadoBadgeHtml(leg) + '</td>' +
      '<td>' + acciones + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="10"><div class="empty">Sin legalizaciones para este filtro.</div></td></tr>';

  updateStats();
  renderEnviosTable();
  renderProrrateoGastos();
  renderDetalleTable();
}

// ── Pestaña Envíos (Tipo='Envio'): vista aparte de las legalizaciones ──
function renderEnviosTable() {
  var body = document.getElementById('envl-body');
  if (!body) return;
  var fEmp = document.getElementById('ef-emp').value;
  var fDesde = document.getElementById('ef-desde').value;
  var fHasta = document.getElementById('ef-hasta').value;
  var fTxt = (document.getElementById('ef-txt').value || '').toLowerCase().trim();

  function nitDe(leg) { var it = itemsOf(leg.id)[0]; return it ? (it.NIT || '') : ''; }

  var rows = legs.filter(function(leg) {
    if (!esEnvio(leg)) return false;
    if (fEmp && !empresasOf(leg.id).some(function(e) { return e.Empresa === fEmp; })) return false;
    if (fDesde && (leg.Fecha || '') < fDesde) return false;
    if (fHasta && (leg.Fecha || '') > fHasta) return false;
    if (fTxt) {
      var hay = [leg.Consecutivo, proveedoresTexto(leg.id), nitDe(leg), leg.Remisiones_Relacionadas]
        .map(function(v) { return (v || '').toLowerCase(); }).join(' ');
      if (hay.indexOf(fTxt) < 0) return false;
    }
    return true;
  }).sort(function(a, b) { return (b.Fecha || '').localeCompare(a.Fecha || '') || (b.id - a.id); });

  var canEditMod = AUTH.hasModule('legalizacion_gastos');
  var canDel = AUTH.canDelete();
  var total = rows.reduce(function(s, leg) { return s + totalGastosOf(leg.id); }, 0);
  document.getElementById('envl-ct').textContent = '(' + rows.length + ')';
  document.getElementById('envl-total').textContent = rows.length ? 'Total: ' + fmtMoney(total) : '';

  body.innerHTML = rows.map(function(leg) {
    var acciones = '<button class="btn-ver" onclick="openVer(' + leg.id + ')">👁 Ver</button>';
    if (leg.Estado_Conciliacion === 'Por conciliar' && canEditMod) {
      acciones += ' <button class="btn-edit" onclick="openFormEnvio(' + leg.id + ')">✏️</button>';
    }
    if (leg.Estado_Conciliacion === 'Por conciliar' && canDel) {
      acciones += ' <button class="btn-edit" style="color:#c0392b" onclick="eliminarLegalizacion(' + leg.id + ')">🗑️</button>';
    }
    return '<tr>' +
      '<td>' + escHtml(leg.Consecutivo || '') + '</td>' +
      '<td>' + escHtml(fmtDate(leg.Fecha)) + '</td>' +
      '<td>' + escHtml(proveedoresTexto(leg.id) || '—') + '</td>' +
      '<td>' + escHtml(nitDe(leg) || '—') + '</td>' +
      '<td style="max-width:280px;white-space:normal;font-size:0.8rem">' + escHtml(leg.Remisiones_Relacionadas || '—') + '</td>' +
      '<td>' + empresasBadgesHtml(leg.id) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(totalGastosOf(leg.id))) + '</td>' +
      '<td>' + acciones + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="8"><div class="empty">Sin envíos para este filtro.</div></td></tr>';
}

function updateStats() {
  // Los envíos no se concilian y tienen su propia pestaña: no cuentan aquí.
  var propias = legs.filter(function(l) { return !esEnvio(l); });
  var porConciliar = propias.filter(function(l) { return l.Estado_Conciliacion === 'Por conciliar'; });
  var conciliadas = propias.filter(function(l) { return l.Estado_Conciliacion === 'Conciliada'; });
  document.getElementById('s-porconciliar').textContent = porConciliar.length;
  document.getElementById('s-conciliadas').textContent = conciliadas.length;
  document.getElementById('s-total').textContent = propias.length;
  // El valor sí suma los envíos (no se concilian, pero son gasto registrado).
  var valorPend = legs.filter(function(l) { return esEnvio(l) || l.Estado_Conciliacion === 'Por conciliar'; })
    .reduce(function(s, l) { return s + totalGastosOf(l.id); }, 0);
  document.getElementById('s-valor').textContent = fmtMoney(valorPend);
}

// ── Opciones de empresa para las filas del reparto ──
function empresaRowOptionsHtml(selected) {
  var base = (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas) ? AUTH.getFilteredEmpresas(EMPRESAS_HOLDING) : EMPRESAS_HOLDING;
  var opts = '<option value="">— Empresa —</option>';
  base.forEach(function(e) {
    opts += '<option value="' + escHtml(e.value) + '"' + (e.value === selected ? ' selected' : '') + '>' + escHtml(e.sigla) + '</option>';
  });
  return opts;
}

// ── Formulario: reparto por empresa ──
function renderLgEmpresas() {
  document.getElementById('lg-emp-lines').innerHTML = formEmpresas.map(function(e, i) {
    return '<tr>' +
      '<td><select class="ef lg-emp-select" data-line="' + i + '" onchange="readLgEmpresas()">' + empresaRowOptionsHtml(e.Empresa) + '</select></td>' +
      '<td><input class="ef lg-emp-monto" data-line="' + i + '" type="number" min="0" step="1" value="' + (e.Monto || '') + '" style="text-align:right;width:140px" oninput="readLgEmpresas()"></td>' +
      '<td style="text-align:center"><button onclick="removeLgEmpresa(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="3"><div class="no-lines">Sin empresas en el reparto.</div></td></tr>';
}

function addLgEmpresa() {
  formEmpresas.push({ Empresa: '', Monto: '' });
  renderLgEmpresas();
}

function removeLgEmpresa(i) {
  formEmpresas.splice(i, 1);
  renderLgEmpresas();
  recalcTotals();
}

// El consecutivo de remisión trae la sigla de la empresa como primer
// segmento (ej. "RESO-RE-0032", "PARCELAR-RS-0081"), igual convención que
// usa todo el panel (pdf-remision.js, generar_remision). Solo empresas del
// holding: GRANEL no aparece en el <select> del reparto.
function empresaFromRemisionSigla(remision) {
  var sigla = (remision || '').split('-')[0].trim().toUpperCase();
  if (!sigla) return null;
  var e = EMPRESAS_HOLDING.find(function(x) { return x.sigla === sigla; });
  return e ? e.value : null;
}

// Una remisión solo puede estar relacionada en UNA legalización o envío (la
// base también lo exige: trigger trg_01_remisiones_unicas). Devuelve el motivo
// por el que NO se puede usar, o '' si está libre. listaForm = las remisiones
// ya agregadas en el formulario en curso; excluirId = el registro que se está
// editando (no se compara contra sí mismo). Los registros rechazados no cuentan.
// Solo ve los registros que el usuario tiene cargados (RLS): la base cubre el resto.
function remisionRepetidaMsg(codigo, listaForm, excluirId) {
  var key = String(codigo || '').trim().toUpperCase();
  if (!key) return '';
  if ((listaForm || []).some(function(r) { return String(r).trim().toUpperCase() === key; })) {
    return 'La remisión ' + codigo + ' ya está agregada en este formulario';
  }
  var otro = legs.find(function(l) {
    if (l.id === excluirId || l.Estado_Conciliacion === 'Rechazada') return false;
    return (l.Remisiones_Relacionadas || '').split(',').some(function(r) { return r.trim().toUpperCase() === key; });
  });
  if (otro) return 'La remisión ' + codigo + ' ya está registrada en ' + (otro.Consecutivo || ('#' + otro.id)) + (esEnvio(otro) ? ' (envío)' : ' (legalización)');
  return '';
}

function _addEmpresaToList(empresaValue) {
  if (!empresaValue) return;
  if (formEmpresas.some(function(e) { return e.Empresa === empresaValue; })) return;
  var emptyIdx = formEmpresas.findIndex(function(e) { return !e.Empresa; });
  if (emptyIdx >= 0) formEmpresas[emptyIdx].Empresa = empresaValue;
  else formEmpresas.push({ Empresa: empresaValue, Monto: '' });
  renderLgEmpresas();
  recalcTotals();
}

function readLgEmpresas() {
  document.querySelectorAll('.lg-emp-select').forEach(function(sel) {
    var i = Number(sel.dataset.line);
    if (formEmpresas[i]) formEmpresas[i].Empresa = sel.value;
  });
  document.querySelectorAll('.lg-emp-monto').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (formEmpresas[i]) formEmpresas[i].Monto = Number(inp.value) || 0;
  });
  recalcTotals();
}

// Reparte `total` (pesos enteros) en proporción a `pesos` {clave: peso} con el
// método del mayor resto, de modo que la suma sea exactamente `total`.
function _repartirEnteros(pesos, total) {
  var out = {};
  total = Math.round(Number(total) || 0);
  var keys = Object.keys(pesos).filter(function(k) { return pesos[k] > 0; });
  var suma = keys.reduce(function(s, k) { return s + pesos[k]; }, 0);
  if (!keys.length || suma <= 0 || total <= 0) return out;
  var asignado = 0;
  var restos = keys.map(function(k) {
    var exacto = total * pesos[k] / suma;
    var base = Math.floor(exacto);
    out[k] = base;
    asignado += base;
    return { k: k, resto: exacto - base };
  });
  restos.sort(function(a, b) { return b.resto - a.resto; });
  var faltan = total - asignado;
  for (var i = 0; i < faltan; i++) out[restos[i % restos.length].k] += 1;
  return out;
}

// ── Reparto entre empresas sugerido por litros/kilos ──
// Reparte `monto` (los gastos del viaje SIN Combustible) entre las empresas de
// las remisiones relacionadas, con la misma lógica de la pestaña Prorrateo:
// el monto se separa en bolsa de líquidos (por litro) y de sólidos (por kilo),
// proporcional a cuántas remisiones aportan a cada una, y dentro de cada bolsa
// cada empresa recibe según los litros/kilos de sus remisiones. Las remisiones
// se resuelven con remisionProductoMapReparto (Pedidos + Ingresos + Muestras +
// Devoluciones); las que no se resuelven a litros/kilos se ignoran. Si NINGUNA
// se resuelve, se reparte por número de remisiones según la sigla del
// consecutivo. Devuelve { porEmpresa: {empresa: pesos enteros}, metodo,
// sinResolver: [códigos] }.
function calcularRepartoSugerido(codigos, monto) {
  var holding = {};
  EMPRESAS_HOLDING.forEach(function(e) { holding[e.value] = true; });

  var vistos = {};
  var codigosUnicos = (codigos || []).map(function(c) { return String(c || '').trim(); }).filter(function(c) {
    var k = c.toUpperCase();
    if (!c || vistos[k]) return false;
    vistos[k] = true;
    return true;
  });

  var sinResolver = [];
  var codLiq = {}, codSol = {}, litEmp = {}, kiloEmp = {};
  codigosUnicos.forEach(function(c) {
    var aporta = false;
    (remisionProductoMapReparto[c.toUpperCase()] || []).forEach(function(m) {
      if (!holding[m.empresa]) return; // p. ej. GRANEL: no es del reparto
      var lit = _litParse(m.producto, m.presentacion);
      var cant = Number(m.cantidad) || 0;
      var litros = lit.convertible ? lit.litrosUnidad * cant : 0;
      var kilos = lit.convertibleKilo ? lit.kilosUnidad * cant : 0;
      if (litros > 0) { codLiq[c] = true; litEmp[m.empresa] = (litEmp[m.empresa] || 0) + litros; aporta = true; }
      if (kilos > 0) { codSol[c] = true; kiloEmp[m.empresa] = (kiloEmp[m.empresa] || 0) + kilos; aporta = true; }
    });
    if (!aporta) sinResolver.push(c);
  });

  var nLiq = Object.keys(codLiq).length;
  var nSol = Object.keys(codSol).length;
  if (nLiq + nSol > 0) {
    var montoLiq = monto * nLiq / (nLiq + nSol);
    var montoSol = monto - montoLiq;
    var totLit = Object.keys(litEmp).reduce(function(s, e) { return s + litEmp[e]; }, 0);
    var totKilo = Object.keys(kiloEmp).reduce(function(s, e) { return s + kiloEmp[e]; }, 0);
    var pesos = {};
    Object.keys(litEmp).forEach(function(e) { pesos[e] = (pesos[e] || 0) + montoLiq * litEmp[e] / totLit; });
    Object.keys(kiloEmp).forEach(function(e) { pesos[e] = (pesos[e] || 0) + montoSol * kiloEmp[e] / totKilo; });
    return { porEmpresa: _repartirEnteros(pesos, monto), metodo: 'litros/kilos', sinResolver: sinResolver };
  }

  var cuenta = {};
  codigosUnicos.forEach(function(c) {
    var emp = empresaFromRemisionSigla(c);
    if (emp) cuenta[emp] = (cuenta[emp] || 0) + 1;
  });
  return { porEmpresa: _repartirEnteros(cuenta, monto), metodo: 'remisiones', sinResolver: [] };
}

// Combustible aparte: por ahora NO se prorratea entre empresas, así que el
// reparto calculado cubre solo los gastos que no son Combustible.
function totalCombustibleLista(lista) {
  return (lista || []).reduce(function(s, g) {
    return s + (((g.Concepto || '').trim() === 'Combustible') ? (Number(g.Valor) || 0) : 0);
  }, 0);
}

function calcularRepartoForm() {
  readLgGastos();
  readLgEmpresas();
  if (!formRemisiones.length) { showToast('Agrega primero las remisiones relacionadas', '#e67e22'); return; }
  var totalGastos = formGastos.reduce(function(s, g) { return s + (Number(g.Valor) || 0); }, 0);
  var base = totalGastos - totalCombustibleLista(formGastos);
  if (base <= 0) { showToast('No hay gastos distintos de Combustible para repartir', '#e67e22'); return; }

  var calc = calcularRepartoSugerido(formRemisiones, base);
  var emps = Object.keys(calc.porEmpresa);
  if (!emps.length) { showToast('No se pudo determinar la empresa de las remisiones', '#e67e22'); return; }
  if (formEmpresas.some(function(e) { return e.Empresa && Number(e.Monto) > 0; }) &&
      !confirm('Ya hay montos en el reparto. ¿Reemplazarlos por el cálculo por litros/kilos?')) return;

  var nuevo = [];
  formEmpresas.forEach(function(e) {
    if (e.Empresa) nuevo.push({ Empresa: e.Empresa, Monto: calc.porEmpresa[e.Empresa] || 0 });
  });
  emps.forEach(function(emp) {
    if (!nuevo.some(function(e) { return e.Empresa === emp; })) nuevo.push({ Empresa: emp, Monto: calc.porEmpresa[emp] });
  });
  formEmpresas = nuevo;
  renderLgEmpresas();
  recalcTotals();

  var msg = 'Reparto calculado por ' + (calc.metodo === 'litros/kilos' ? 'litros/kilos' : 'número de remisiones') + ' (sin Combustible)';
  if (calc.sinResolver.length) msg += ' · sin litros/kilos: ' + calc.sinResolver.join(', ');
  showToast(msg, calc.sinResolver.length ? '#e67e22' : '#27ae60');
}

// Proveedores usados en gastos previos (de todas las legalizaciones ya
// cargadas), deduplicados por nombre+NIT, para autocompletar el campo
// Proveedor. legItems ya está cargado en memoria (loadLegalizaciones), así
// que no hace falta una consulta aparte.
function proveedoresConocidos() {
  var seen = {};
  var list = [];
  legItems.forEach(function(it) {
    var prov = (it.Proveedor || '').trim();
    if (!prov) return;
    var nit = (it.NIT || '').trim();
    var key = prov.toLowerCase() + '|' + nit;
    if (seen[key]) return;
    seen[key] = true;
    list.push({ proveedor: prov, nit: nit });
  });
  return list.sort(function(a, b) { return a.proveedor.localeCompare(b.proveedor, 'es'); });
}

// ── Formulario: líneas de gasto ──
function renderLgGastos() {
  formGastoProveedorACs.forEach(function(ac) { ac.destroy(); });
  formGastoProveedorACs = [];

  // Galones solo aplica a Combustible, y solo para las placas del piloto de
  // kilometraje (KM_PILOTO_PLACAS) — para el resto de la flota el gasto de
  // Combustible se registra igual que siempre, solo en $.
  var placaActual = readPlaca();
  var esPilotoKm = KM_PILOTO_PLACAS.indexOf(placaActual) >= 0;

  document.getElementById('lg-gasto-lines').innerHTML = formGastos.map(function(g, i) {
    var parsed = parseConceptoLine(g.Concepto || '');
    var showGalones = esPilotoKm && g.Concepto === 'Combustible';
    return '<tr>' +
      '<td>' +
        '<select class="ef lg-g-concepto" data-line="' + i + '" onchange="onConceptoSelectChange(this)">' + conceptoOptionsHtml(parsed.sel) + '</select>' +
        (parsed.sel === 'Otros' ? '<input class="ef lg-g-concepto-otro" data-line="' + i + '" type="text" value="' + escHtml(parsed.detail) + '" placeholder="Especifique…" style="margin-top:4px" oninput="readLgGastos()">' : '') +
      '</td>' +
      '<td><input class="ef lg-g-proveedor" data-line="' + i + '" type="text" value="' + escHtml(g.Proveedor || '') + '" placeholder="Proveedor" autocomplete="off" oninput="readLgGastos()"></td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<input class="ef lg-g-nit" data-line="' + i + '" type="text" value="' + escHtml(g.NIT || '') + '" placeholder="NIT" style="width:100px" oninput="readLgGastos()">' +
        '<input class="ef lg-g-dv" data-line="' + i + '" type="text" value="' + escHtml(g.DV || '') + '" placeholder="DV" maxlength="2" style="width:44px;text-align:center" oninput="readLgGastos()">' +
      '</div></td>' +
      '<td><input class="ef lg-g-valor" data-line="' + i + '" type="number" min="0" step="1" value="' + (g.Valor || '') + '" style="text-align:right;width:120px" oninput="readLgGastos()">' +
        (showGalones ? '<input class="ef lg-g-galones" data-line="' + i + '" type="number" min="0" step="0.1" value="' + (g.Galones || '') + '" placeholder="Galones" style="text-align:right;width:120px;margin-top:4px" oninput="readLgGastos()">' : '') +
      '</td>' +
      '<td style="text-align:center"><button onclick="removeLgGasto(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5"><div class="no-lines">Sin líneas de gasto.</div></td></tr>';

  document.querySelectorAll('.lg-g-proveedor').forEach(function(inp) {
    formGastoProveedorACs.push(initAutocomplete(inp, {
      minChars: 1,
      items: proveedoresConocidos,
      display: function(p) {
        return '<strong>' + escHtml(p.proveedor) + '</strong>' + (p.nit ? ' <span class="ac-sub">NIT ' + escHtml(p.nit) + '</span>' : '');
      },
      match: function(p, val) { return p.proveedor.toLowerCase().indexOf(val) >= 0; },
      onSelect: function(p) {
        var i = Number(inp.dataset.line);
        inp.value = p.proveedor;
        var nd = splitNitDv(p.nit);
        var nitInput = document.querySelector('.lg-g-nit[data-line="' + i + '"]');
        var dvInput = document.querySelector('.lg-g-dv[data-line="' + i + '"]');
        if (nitInput) nitInput.value = nd.nit;
        if (dvInput) dvInput.value = nd.dv;
        readLgGastos();
      }
    }));
  });
}

function addLgGasto() {
  formGastos.push({ Concepto: 'Combustible', Proveedor: '', NIT: '', DV: '', Valor: '', Galones: '' });
  renderLgGastos();
  var lastInput = document.querySelector('.lg-g-concepto[data-line="' + (formGastos.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeLgGasto(i) {
  formGastos.splice(i, 1);
  renderLgGastos();
  recalcTotals();
}

// El select de Concepto cambia el modo de la fila (fijo vs "Otros"), así que
// hace falta volver a pintarla para mostrar/ocultar el input de detalle.
function onConceptoSelectChange(sel) {
  var i = Number(sel.dataset.line);
  if (!formGastos[i]) return;
  formGastos[i].Concepto = (sel.value === 'Otros') ? '' : sel.value;
  renderLgGastos();
  recalcTotals();
  if (sel.value === 'Otros') {
    var det = document.querySelector('.lg-g-concepto-otro[data-line="' + i + '"]');
    if (det) det.focus();
  }
}

function readLgGastos() {
  document.querySelectorAll('.lg-g-concepto-otro').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastos[i]) formGastos[i].Concepto = inp.value; });
  document.querySelectorAll('.lg-g-proveedor').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastos[i]) formGastos[i].Proveedor = inp.value; });
  document.querySelectorAll('.lg-g-nit').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastos[i]) formGastos[i].NIT = inp.value; });
  document.querySelectorAll('.lg-g-dv').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastos[i]) formGastos[i].DV = inp.value; });
  document.querySelectorAll('.lg-g-valor').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastos[i]) formGastos[i].Valor = Number(inp.value) || 0; });
  document.querySelectorAll('.lg-g-galones').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastos[i]) formGastos[i].Galones = Number(inp.value) || ''; });
  recalcTotals();
}

// ── Formulario: remisiones relacionadas (lista, se agregan de una en una) ──
function renderLgRemisiones() {
  var box = document.getElementById('lg-remisiones-chips');
  box.innerHTML = formRemisiones.length ? formRemisiones.map(function(r, i) {
    return '<span class="badge b-par" style="display:inline-flex;align-items:center;gap:6px">' + escHtml(r) +
      '<span onclick="removeLgRemision(' + i + ')" style="cursor:pointer;font-weight:700" title="Quitar">✕</span></span>';
  }).join('') : '<span style="color:#a0aec0;font-size:0.82rem">Sin remisiones agregadas.</span>';
}

function addLgRemision() {
  var inp = document.getElementById('lg-remision-nueva');
  var val = inp.value.trim();
  if (!val) return;
  var repetida = remisionRepetidaMsg(val, formRemisiones, editingLegId);
  if (repetida) { showToast(repetida, '#e67e22'); inp.focus(); inp.select(); return; }
  formRemisiones.push(val);
  inp.value = '';
  renderLgRemisiones();
  inp.focus();

  // Si la remisión pertenece a un pedido real, su cliente se agrega solo
  // (sin robar el foco del campo de remisiones ni bloquear la edición manual).
  var cliAuto = remisionClienteMap && remisionClienteMap[val.toUpperCase()];
  if (cliAuto) _addClienteToList(cliAuto);

  // La empresa se extrae de la sigla al inicio del consecutivo, sin
  // necesidad de que la remisión exista en Pedidos.
  var empAuto = empresaFromRemisionSigla(val);
  if (empAuto) _addEmpresaToList(empAuto);
}

function removeLgRemision(i) {
  formRemisiones.splice(i, 1);
  renderLgRemisiones();
}

// ── Formulario: clientes visitados (lista, sugeridos desde Pedidos con remisión) ──
function renderLgClientes() {
  var box = document.getElementById('lg-clientes-chips');
  box.innerHTML = formClientes.length ? formClientes.map(function(c, i) {
    return '<span class="badge b-ent" style="display:inline-flex;align-items:center;gap:6px">' + escHtml(c) +
      '<span onclick="removeLgCliente(' + i + ')" style="cursor:pointer;font-weight:700" title="Quitar">✕</span></span>';
  }).join('') : '<span style="color:#a0aec0;font-size:0.82rem">Sin clientes agregados.</span>';
}

function _addClienteToList(val) {
  val = (val || '').trim();
  if (!val || formClientes.indexOf(val) >= 0) return;
  formClientes.push(val);
  renderLgClientes();
}

function addLgCliente(nombre) {
  var inp = document.getElementById('lg-cliente-nueva');
  var val = nombre != null ? nombre : inp.value;
  _addClienteToList(val);
  inp.value = '';
  inp.focus();
}

function removeLgCliente(i) {
  formClientes.splice(i, 1);
  renderLgClientes();
}

function recalcTotals() {
  var totalGastos = formGastos.reduce(function(s, g) { return s + (Number(g.Valor) || 0); }, 0);
  var totalReparto = formEmpresas.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  document.getElementById('lg-total-gastos').textContent = fmtMoney(totalGastos);
  document.getElementById('lg-total-reparto').textContent = fmtMoney(totalReparto);
  // Un reparto que cubre todo salvo el Combustible (ver calcularRepartoForm)
  // no es un error: se avisa aparte en vez de marcarlo como descuadre.
  var comb = totalCombustibleLista(formGastos);
  var sinComb = comb > 0 && totalReparto === totalGastos - comb;
  document.getElementById('lg-reparto-warn').style.display = (totalGastos !== totalReparto && !sinComb) ? 'block' : 'none';
  var info = document.getElementById('lg-reparto-info');
  info.textContent = 'ℹ El reparto no incluye el Combustible (' + fmtMoney(comb) + ')';
  info.style.display = sinComb ? 'block' : 'none';
}

// ── Abrir / cerrar formulario (crear o editar) ──
function openForm(id) {
  editingLegId = id || null;
  if (editingLegId) {
    var leg = legs.find(function(l) { return l.id === editingLegId; });
    if (!leg) return;
    document.getElementById('form-titulo').textContent = 'Editar ' + (leg.Consecutivo || '');
    document.getElementById('lg-fecha').value = (leg.Fecha || '').slice(0, 10);
    setResponsableField(leg.Responsable || '');
    setPlacaField(leg.Placa || '');
    document.getElementById('lg-ruta').value = leg.Recorrido_Ruta || '';
    document.getElementById('lg-personas').value = leg.No_Personas || '';
    document.getElementById('lg-fecha-salida').value = (leg.Fecha_Salida || '').slice(0, 10);
    document.getElementById('lg-fecha-llegada').value = (leg.Fecha_Llegada || '').slice(0, 10);
    document.getElementById('lg-hora-salida').value = leg.Hora_Salida || '';
    document.getElementById('lg-hora-llegada').value = leg.Hora_Llegada || '';
    document.getElementById('lg-km-salida').value = leg.Km_Salida != null ? leg.Km_Salida : '';
    document.getElementById('lg-km-llegada').value = leg.Km_Llegada != null ? leg.Km_Llegada : '';
    document.getElementById('lg-anticipo').value = leg.Anticipo_Entregado || '';
    document.getElementById('lg-observaciones').value = leg.Observaciones || '';
    formGastos = itemsOf(editingLegId).map(function(it) {
      var nd = splitNitDv(it.NIT);
      return { Concepto: it.Concepto, Proveedor: it.Proveedor, NIT: nd.nit, DV: nd.dv, Valor: it.Valor, Galones: it.Galones != null ? it.Galones : '' };
    });
    formEmpresas = empresasOf(editingLegId).map(function(e) { return { Empresa: e.Empresa, Monto: e.Monto }; });
    formRemisiones = (leg.Remisiones_Relacionadas || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    formClientes = (leg.Clientes || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  } else {
    document.getElementById('form-titulo').textContent = 'Nueva legalización de gastos';
    document.getElementById('lg-fecha').value = today();
    setResponsableField('');
    setPlacaField('');
    document.getElementById('lg-ruta').value = '';
    document.getElementById('lg-personas').value = 1;
    document.getElementById('lg-fecha-salida').value = '';
    document.getElementById('lg-fecha-llegada').value = '';
    document.getElementById('lg-hora-salida').value = '';
    document.getElementById('lg-hora-llegada').value = '';
    document.getElementById('lg-km-salida').value = '';
    document.getElementById('lg-km-llegada').value = '';
    document.getElementById('lg-anticipo').value = '';
    document.getElementById('lg-observaciones').value = '';
    formGastos = [{ Concepto: 'Combustible', Proveedor: '', NIT: '', DV: '', Valor: '', Galones: '' }];
    formEmpresas = [{ Empresa: '', Monto: '' }];
    formRemisiones = [];
    formClientes = [];
  }
  if (!formGastos.length) formGastos = [{ Concepto: 'Combustible', Proveedor: '', NIT: '', DV: '', Valor: '', Galones: '' }];
  if (!formEmpresas.length) formEmpresas = [{ Empresa: '', Monto: '' }];
  document.getElementById('lg-remision-nueva').value = '';
  document.getElementById('lg-cliente-nueva').value = '';
  updateKmWrapVisibility();
  renderLgGastos();
  renderLgEmpresas();
  renderLgRemisiones();
  renderLgClientes();
  recalcTotals();
  document.getElementById('form-overlay').classList.add('show');
}

function closeForm() {
  document.getElementById('form-overlay').classList.remove('show');
}

function readHeaderForm() {
  var placa = readPlaca();
  var esPilotoKm = KM_PILOTO_PLACAS.indexOf(placa) >= 0;
  return {
    Fecha: document.getElementById('lg-fecha').value || today(),
    Tipo: 'Ruta',
    Responsable: readResponsable(),
    Placa: placa,
    Recorrido_Ruta: document.getElementById('lg-ruta').value.trim(),
    No_Personas: Number(document.getElementById('lg-personas').value) || null,
    Fecha_Salida: document.getElementById('lg-fecha-salida').value || null,
    Fecha_Llegada: document.getElementById('lg-fecha-llegada').value || null,
    // Kilometraje/hora: solo se guardan para las placas del piloto (ver
    // KM_PILOTO_PLACAS) — para el resto quedan en null aunque el campo
    // oculto conserve algún valor residual de una placa anterior.
    Hora_Salida: esPilotoKm ? (document.getElementById('lg-hora-salida').value || null) : null,
    Hora_Llegada: esPilotoKm ? (document.getElementById('lg-hora-llegada').value || null) : null,
    Km_Salida: esPilotoKm ? (document.getElementById('lg-km-salida').value || null) : null,
    Km_Llegada: esPilotoKm ? (document.getElementById('lg-km-llegada').value || null) : null,
    Clientes: formClientes.join(', '),
    Remisiones_Relacionadas: formRemisiones.join(', '),
    Anticipo_Entregado: Number(document.getElementById('lg-anticipo').value) || 0,
    Observaciones: document.getElementById('lg-observaciones').value.trim()
  };
}

async function saveForm() {
  readLgGastos();
  readLgEmpresas();
  var header = readHeaderForm();

  if (!header.Responsable) { showToast('Indica el responsable', '#e67e22'); return; }
  if (header.Km_Salida != null && header.Km_Llegada != null && Number(header.Km_Llegada) <= Number(header.Km_Salida)) {
    showToast('El km de llegada debe ser mayor al km de salida', '#e67e22'); return;
  }
  // Otro usuario pudo registrar una de estas remisiones desde que se abrió el formulario.
  var remRepetida = formRemisiones.map(function(r) { return remisionRepetidaMsg(r, [], editingLegId); }).find(function(m) { return m; });
  if (remRepetida) { showToast(remRepetida, '#e67e22'); return; }
  var gastosValidos = formGastos
    .filter(function(g) { return (g.Concepto || '').trim() && Number(g.Valor) > 0; })
    .map(function(g) { return { Concepto: g.Concepto, Proveedor: g.Proveedor, NIT: joinNitDv(g.NIT, g.DV), Valor: g.Valor, Galones: g.Concepto === 'Combustible' ? g.Galones : null }; });
  if (!gastosValidos.length) { showToast('Agrega al menos una línea de gasto válida', '#e67e22'); return; }
  var empresasValidas = formEmpresas.filter(function(e) { return e.Empresa; });
  if (!empresasValidas.length) { showToast('Agrega al menos una empresa en el reparto', '#e67e22'); return; }

  var totalGastos = gastosValidos.reduce(function(s, g) { return s + (Number(g.Valor) || 0); }, 0);
  var totalReparto = empresasValidas.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  var combustible = totalCombustibleLista(gastosValidos);
  var repartoSinCombustible = combustible > 0 && totalReparto === totalGastos - combustible;
  if (totalGastos !== totalReparto && !repartoSinCombustible) {
    if (!confirm('El reparto entre empresas (' + fmtMoney(totalReparto) + ') no coincide con el total de gastos (' + fmtMoney(totalGastos) + '). ¿Guardar de todas formas?')) return;
  }

  // Alta automática de la placa en el catálogo si el usuario escribió una
  // que no existe todavía (mismo patrón que "cliente nuevo desde pedido").
  if (header.Placa && !placaExiste(header.Placa)) {
    await apiPost({ action: 'agregarVehiculo', Placa: header.Placa, Descripcion: '' });
  }

  var body = { header: header, items: gastosValidos, empresas: empresasValidas };
  var res;
  if (editingLegId) {
    body.id = editingLegId;
    res = await apiPost(Object.assign({ action: 'editarLegalizacionGastos' }, body));
  } else {
    res = await apiPost(Object.assign({ action: 'agregarLegalizacionGastos' }, body));
  }
  if (!res.ok) { showToast('Error al guardar: ' + res.error, '#e74c3c'); return; }
  await loadVehiculosData(); // refresca catálogo (placa nueva y/o Km_Actual actualizado por el trigger)

  showToast('Legalización guardada correctamente', '#27ae60');
  closeForm();
  await loadLegalizaciones();
  if (res.id) openVer(res.id);
  else if (editingLegId) openVer(editingLegId);
}

// ── Formulario de Mantenimiento (Tipo='Mantenimiento') ──
// Mismo patrón que el formulario de ruta (cabecera + reparto entre empresas +
// líneas de gasto + conciliación posterior), pero sin remisiones, clientes ni
// recorrido/ruta, con Placa obligatoria y con un detalle de mantenimiento
// (MANTENIMIENTO_DETALLE_FIJOS) en vez de Concepto por línea de gasto.

function setResponsableFieldMant(value) {
  var sel = document.getElementById('mant-responsable-select');
  var otro = document.getElementById('mant-responsable-otro');
  if (!value) {
    sel.value = '';
    otro.style.display = 'none';
    otro.value = '';
  } else if (RESPONSABLES_FIJOS.indexOf(value) >= 0) {
    sel.value = value;
    otro.style.display = 'none';
    otro.value = '';
  } else {
    sel.value = 'Otro';
    otro.style.display = '';
    otro.value = value;
  }
}

function onResponsableSelectChangeMant() {
  var sel = document.getElementById('mant-responsable-select');
  var otro = document.getElementById('mant-responsable-otro');
  if (sel.value === 'Otro') {
    otro.style.display = '';
    otro.focus();
  } else {
    otro.style.display = 'none';
    otro.value = '';
  }
}

function readResponsableMant() {
  var sel = document.getElementById('mant-responsable-select').value;
  if (sel === 'Otro') return document.getElementById('mant-responsable-otro').value.trim();
  return sel;
}

function setPlacaFieldMant(value) {
  var sel = document.getElementById('mant-placa-select');
  var otro = document.getElementById('mant-placa-otro');
  if (!value) {
    sel.value = '';
    otro.style.display = 'none';
    otro.value = '';
  } else if (placaExiste(value)) {
    sel.value = value;
    otro.style.display = 'none';
    otro.value = '';
  } else {
    sel.value = 'Otro';
    otro.style.display = '';
    otro.value = value;
  }
}

// Mantenimiento no tiene "viaje" (sin salida/llegada), así que registra un
// solo kilometraje puntual — el odómetro del vehículo al momento del
// mantenimiento — reutilizando la misma columna Km_Llegada que usa Ruta.
function updateKmWrapVisibilityMant() {
  var placa = readPlacaMant();
  var show = KM_PILOTO_PLACAS.indexOf(placa) >= 0;
  var wrap = document.getElementById('mant-km-wrap');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
  var hintEl = document.getElementById('mant-km-hint');
  if (hintEl) {
    var info = show ? ultimoKmVehiculo(placa) : null;
    hintEl.textContent = info ? ('Último odómetro conocido: ' + info.km.toLocaleString('es-CO') + ' km' + (info.fecha ? ' (' + fmtDate(info.fecha) + ')' : '')) : '';
  }
}

function onPlacaSelectChangeMant() {
  var sel = document.getElementById('mant-placa-select');
  var otro = document.getElementById('mant-placa-otro');
  if (sel.value === 'Otro') {
    otro.style.display = '';
    otro.focus();
  } else {
    otro.style.display = 'none';
    otro.value = '';
  }
  updateKmWrapVisibilityMant();
  if (!editingLegId) {
    var placa = readPlacaMant();
    var info = KM_PILOTO_PLACAS.indexOf(placa) >= 0 ? ultimoKmVehiculo(placa) : null;
    var kmInp = document.getElementById('mant-km-actual');
    if (info && kmInp && !kmInp.value) kmInp.value = info.km;
  }
}

function readPlacaMant() {
  var sel = document.getElementById('mant-placa-select').value;
  if (sel === 'Otro') return document.getElementById('mant-placa-otro').value.trim();
  return sel;
}

function renderMantEmpresas() {
  document.getElementById('mant-emp-lines').innerHTML = formEmpresasMant.map(function(e, i) {
    return '<tr>' +
      '<td><select class="ef mant-emp-select" data-line="' + i + '" onchange="readMantEmpresas()">' + empresaRowOptionsHtml(e.Empresa) + '</select></td>' +
      '<td><input class="ef mant-emp-monto" data-line="' + i + '" type="number" min="0" step="1" value="' + (e.Monto || '') + '" style="text-align:right;width:140px" oninput="readMantEmpresas()"></td>' +
      '<td style="text-align:center"><button onclick="removeMantEmpresa(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="3"><div class="no-lines">Sin empresas en el reparto.</div></td></tr>';
}

function addMantEmpresa() {
  formEmpresasMant.push({ Empresa: '', Monto: '' });
  renderMantEmpresas();
}

function removeMantEmpresa(i) {
  formEmpresasMant.splice(i, 1);
  renderMantEmpresas();
  recalcTotalsMant();
}

function readMantEmpresas() {
  document.querySelectorAll('.mant-emp-select').forEach(function(sel) {
    var i = Number(sel.dataset.line);
    if (formEmpresasMant[i]) formEmpresasMant[i].Empresa = sel.value;
  });
  document.querySelectorAll('.mant-emp-monto').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (formEmpresasMant[i]) formEmpresasMant[i].Monto = Number(inp.value) || 0;
  });
  recalcTotalsMant();
}

function renderMantGastos() {
  formMantProveedorACs.forEach(function(ac) { ac.destroy(); });
  formMantProveedorACs = [];

  document.getElementById('mant-gasto-lines').innerHTML = formGastosMant.map(function(g, i) {
    var parsed = parseConceptoLineFor(MANTENIMIENTO_DETALLE_FIJOS, g.Concepto || '');
    return '<tr>' +
      '<td>' +
        '<select class="ef mant-g-concepto" data-line="' + i + '" onchange="onConceptoSelectChangeMant(this)">' + conceptoOptionsHtmlFor(MANTENIMIENTO_DETALLE_FIJOS, parsed.sel) + '</select>' +
        (parsed.sel === 'Otros' ? '<input class="ef mant-g-concepto-otro" data-line="' + i + '" type="text" value="' + escHtml(parsed.detail) + '" placeholder="Especifique…" style="margin-top:4px" oninput="readMantGastos()">' : '') +
      '</td>' +
      '<td><input class="ef mant-g-proveedor" data-line="' + i + '" type="text" value="' + escHtml(g.Proveedor || '') + '" placeholder="Proveedor" autocomplete="off" oninput="readMantGastos()"></td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<input class="ef mant-g-nit" data-line="' + i + '" type="text" value="' + escHtml(g.NIT || '') + '" placeholder="NIT" style="width:100px" oninput="readMantGastos()">' +
        '<input class="ef mant-g-dv" data-line="' + i + '" type="text" value="' + escHtml(g.DV || '') + '" placeholder="DV" maxlength="2" style="width:44px;text-align:center" oninput="readMantGastos()">' +
      '</div></td>' +
      '<td><input class="ef mant-g-valor" data-line="' + i + '" type="number" min="0" step="1" value="' + (g.Valor || '') + '" style="text-align:right;width:120px" oninput="readMantGastos()"></td>' +
      '<td style="text-align:center"><button onclick="removeMantGasto(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5"><div class="no-lines">Sin líneas de gasto.</div></td></tr>';

  document.querySelectorAll('.mant-g-proveedor').forEach(function(inp) {
    formMantProveedorACs.push(initAutocomplete(inp, {
      minChars: 1,
      items: proveedoresConocidos,
      display: function(p) {
        return '<strong>' + escHtml(p.proveedor) + '</strong>' + (p.nit ? ' <span class="ac-sub">NIT ' + escHtml(p.nit) + '</span>' : '');
      },
      match: function(p, val) { return p.proveedor.toLowerCase().indexOf(val) >= 0; },
      onSelect: function(p) {
        var i = Number(inp.dataset.line);
        inp.value = p.proveedor;
        var nd = splitNitDv(p.nit);
        var nitInput = document.querySelector('.mant-g-nit[data-line="' + i + '"]');
        var dvInput = document.querySelector('.mant-g-dv[data-line="' + i + '"]');
        if (nitInput) nitInput.value = nd.nit;
        if (dvInput) dvInput.value = nd.dv;
        readMantGastos();
      }
    }));
  });
}

function addMantGasto() {
  formGastosMant.push({ Concepto: MANTENIMIENTO_DETALLE_FIJOS[0], Proveedor: '', NIT: '', DV: '', Valor: '' });
  renderMantGastos();
  var lastInput = document.querySelector('.mant-g-concepto[data-line="' + (formGastosMant.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeMantGasto(i) {
  formGastosMant.splice(i, 1);
  renderMantGastos();
  recalcTotalsMant();
}

function onConceptoSelectChangeMant(sel) {
  var i = Number(sel.dataset.line);
  if (!formGastosMant[i]) return;
  formGastosMant[i].Concepto = (sel.value === 'Otros') ? '' : sel.value;
  renderMantGastos();
  recalcTotalsMant();
  if (sel.value === 'Otros') {
    var det = document.querySelector('.mant-g-concepto-otro[data-line="' + i + '"]');
    if (det) det.focus();
  }
}

function readMantGastos() {
  document.querySelectorAll('.mant-g-concepto-otro').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastosMant[i]) formGastosMant[i].Concepto = inp.value; });
  document.querySelectorAll('.mant-g-proveedor').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastosMant[i]) formGastosMant[i].Proveedor = inp.value; });
  document.querySelectorAll('.mant-g-nit').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastosMant[i]) formGastosMant[i].NIT = inp.value; });
  document.querySelectorAll('.mant-g-dv').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastosMant[i]) formGastosMant[i].DV = inp.value; });
  document.querySelectorAll('.mant-g-valor').forEach(function(inp) { var i = Number(inp.dataset.line); if (formGastosMant[i]) formGastosMant[i].Valor = Number(inp.value) || 0; });
  recalcTotalsMant();
}

function recalcTotalsMant() {
  var totalGastos = formGastosMant.reduce(function(s, g) { return s + (Number(g.Valor) || 0); }, 0);
  var totalReparto = formEmpresasMant.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  document.getElementById('mant-total-gastos').textContent = fmtMoney(totalGastos);
  document.getElementById('mant-total-reparto').textContent = fmtMoney(totalReparto);
  document.getElementById('mant-reparto-warn').style.display = (totalGastos !== totalReparto) ? 'block' : 'none';
}

function openFormMant(id) {
  editingLegId = id || null;
  if (editingLegId) {
    var leg = legs.find(function(l) { return l.id === editingLegId; });
    if (!leg) return;
    document.getElementById('form-mant-titulo').textContent = 'Editar ' + (leg.Consecutivo || '');
    document.getElementById('mant-fecha').value = (leg.Fecha || '').slice(0, 10);
    setResponsableFieldMant(leg.Responsable || '');
    setPlacaFieldMant(leg.Placa || '');
    document.getElementById('mant-km-actual').value = leg.Km_Llegada != null ? leg.Km_Llegada : '';
    document.getElementById('mant-anticipo').value = leg.Anticipo_Entregado || '';
    document.getElementById('mant-observaciones').value = leg.Observaciones || '';
    formGastosMant = itemsOf(editingLegId).map(function(it) {
      var nd = splitNitDv(it.NIT);
      return { Concepto: it.Concepto, Proveedor: it.Proveedor, NIT: nd.nit, DV: nd.dv, Valor: it.Valor };
    });
    formEmpresasMant = empresasOf(editingLegId).map(function(e) { return { Empresa: e.Empresa, Monto: e.Monto }; });
  } else {
    document.getElementById('form-mant-titulo').textContent = 'Nueva legalización de mantenimiento';
    document.getElementById('mant-fecha').value = today();
    setResponsableFieldMant('');
    setPlacaFieldMant('');
    document.getElementById('mant-km-actual').value = '';
    document.getElementById('mant-anticipo').value = '';
    document.getElementById('mant-observaciones').value = '';
    formGastosMant = [{ Concepto: MANTENIMIENTO_DETALLE_FIJOS[0], Proveedor: '', NIT: '', DV: '', Valor: '' }];
    formEmpresasMant = [{ Empresa: '', Monto: '' }];
  }
  if (!formGastosMant.length) formGastosMant = [{ Concepto: MANTENIMIENTO_DETALLE_FIJOS[0], Proveedor: '', NIT: '', DV: '', Valor: '' }];
  if (!formEmpresasMant.length) formEmpresasMant = [{ Empresa: '', Monto: '' }];
  updateKmWrapVisibilityMant();
  renderMantGastos();
  renderMantEmpresas();
  recalcTotalsMant();
  document.getElementById('form-mant-overlay').classList.add('show');
}

function closeFormMant() {
  document.getElementById('form-mant-overlay').classList.remove('show');
}

function readHeaderFormMant() {
  var placa = readPlacaMant();
  var esPilotoKm = KM_PILOTO_PLACAS.indexOf(placa) >= 0;
  return {
    Fecha: document.getElementById('mant-fecha').value || today(),
    Tipo: 'Mantenimiento',
    Responsable: readResponsableMant(),
    Placa: placa,
    Recorrido_Ruta: '',
    No_Personas: null,
    Fecha_Salida: null,
    Fecha_Llegada: null,
    // Mantenimiento no es un viaje (sin salida/llegada): reutiliza Km_Llegada
    // como el kilometraje puntual del vehículo al momento del mantenimiento.
    Km_Salida: null,
    Km_Llegada: esPilotoKm ? (document.getElementById('mant-km-actual').value || null) : null,
    Clientes: '',
    Remisiones_Relacionadas: '',
    Anticipo_Entregado: Number(document.getElementById('mant-anticipo').value) || 0,
    Observaciones: document.getElementById('mant-observaciones').value.trim()
  };
}

async function saveFormMant() {
  readMantGastos();
  readMantEmpresas();
  var header = readHeaderFormMant();

  if (!header.Responsable) { showToast('Indica el responsable', '#e67e22'); return; }
  if (!header.Placa) { showToast('Indica la placa del vehículo', '#e67e22'); return; }
  var gastosValidos = formGastosMant
    .filter(function(g) { return (g.Concepto || '').trim() && Number(g.Valor) > 0; })
    .map(function(g) { return { Concepto: g.Concepto, Proveedor: g.Proveedor, NIT: joinNitDv(g.NIT, g.DV), Valor: g.Valor }; });
  if (!gastosValidos.length) { showToast('Agrega al menos una línea de gasto válida', '#e67e22'); return; }
  var empresasValidas = formEmpresasMant.filter(function(e) { return e.Empresa; });
  if (!empresasValidas.length) { showToast('Agrega al menos una empresa en el reparto', '#e67e22'); return; }

  var totalGastos = gastosValidos.reduce(function(s, g) { return s + (Number(g.Valor) || 0); }, 0);
  var totalReparto = empresasValidas.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  if (totalGastos !== totalReparto) {
    if (!confirm('El reparto entre empresas (' + fmtMoney(totalReparto) + ') no coincide con el total de gastos (' + fmtMoney(totalGastos) + '). ¿Guardar de todas formas?')) return;
  }

  // Alta automática de la placa en el catálogo si el usuario escribió una
  // que no existe todavía (mismo patrón que "cliente nuevo desde pedido").
  if (header.Placa && !placaExiste(header.Placa)) {
    await apiPost({ action: 'agregarVehiculo', Placa: header.Placa, Descripcion: '' });
  }

  var body = { header: header, items: gastosValidos, empresas: empresasValidas };
  var res;
  if (editingLegId) {
    body.id = editingLegId;
    res = await apiPost(Object.assign({ action: 'editarLegalizacionGastos' }, body));
  } else {
    res = await apiPost(Object.assign({ action: 'agregarLegalizacionGastos' }, body));
  }
  if (!res.ok) { showToast('Error al guardar: ' + res.error, '#e74c3c'); return; }
  await loadVehiculosData();

  showToast('Legalización guardada correctamente', '#27ae60');
  closeFormMant();
  await loadLegalizaciones();
  if (res.id) openVer(res.id);
  else if (editingLegId) openVer(editingLegId);
}

// ── Formulario de Envío (Tipo='Envio') ──
// Fecha + proveedor + NIT + valor + remisiones, con reparto entre empresas
// por litros/kilos (calcularRepartoSugerido, el mismo cálculo del botón
// "Calcular reparto" de la ruta). Sin responsable, placa, anticipo ni
// conciliación.

function renderEnvRemisiones() {
  var box = document.getElementById('env-remisiones-chips');
  box.innerHTML = formRemisionesEnv.length ? formRemisionesEnv.map(function(r, i) {
    return '<span class="badge b-par" style="display:inline-flex;align-items:center;gap:6px">' + escHtml(r) +
      '<span onclick="removeEnvRemision(' + i + ')" style="cursor:pointer;font-weight:700" title="Quitar">✕</span></span>';
  }).join('') : '<span style="color:#a0aec0;font-size:0.82rem">Sin remisiones agregadas.</span>';
}

function addEnvRemision() {
  var inp = document.getElementById('env-remision-nueva');
  var val = inp.value.trim();
  if (!val) return;
  var repetida = remisionRepetidaMsg(val, formRemisionesEnv, editingLegId);
  if (repetida) { showToast(repetida, '#e67e22'); inp.focus(); inp.select(); return; }
  inp.value = '';
  inp.focus();
  formRemisionesEnv.push(val);
  renderEnvRemisiones();
  // La empresa sale de la sigla al inicio del consecutivo (mismo criterio que la ruta).
  var empAuto = empresaFromRemisionSigla(val);
  if (empAuto) _addEmpresaToListEnv(empAuto);
  recalcTotalsEnv();
}

function removeEnvRemision(i) {
  formRemisionesEnv.splice(i, 1);
  renderEnvRemisiones();
  recalcTotalsEnv();
}

function renderEnvEmpresas() {
  document.getElementById('env-emp-lines').innerHTML = formEmpresasEnv.map(function(e, i) {
    return '<tr>' +
      '<td><select class="ef env-emp-select" data-line="' + i + '" onchange="readEnvEmpresas()">' + empresaRowOptionsHtml(e.Empresa) + '</select></td>' +
      '<td><input class="ef env-emp-monto" data-line="' + i + '" type="number" min="0" step="1" value="' + (e.Monto || '') + '" style="text-align:right;width:140px" oninput="readEnvEmpresas()"></td>' +
      '<td style="text-align:center"><button onclick="removeEnvEmpresa(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="3"><div class="no-lines">Sin empresas en el reparto.</div></td></tr>';
}

function addEnvEmpresa() {
  formEmpresasEnv.push({ Empresa: '', Monto: '' });
  renderEnvEmpresas();
}

function removeEnvEmpresa(i) {
  formEmpresasEnv.splice(i, 1);
  renderEnvEmpresas();
  recalcTotalsEnv();
}

function _addEmpresaToListEnv(empresaValue) {
  if (!empresaValue) return;
  if (formEmpresasEnv.some(function(e) { return e.Empresa === empresaValue; })) return;
  var emptyIdx = formEmpresasEnv.findIndex(function(e) { return !e.Empresa; });
  if (emptyIdx >= 0) formEmpresasEnv[emptyIdx].Empresa = empresaValue;
  else formEmpresasEnv.push({ Empresa: empresaValue, Monto: '' });
  renderEnvEmpresas();
}

function readEnvEmpresas() {
  document.querySelectorAll('.env-emp-select').forEach(function(sel) {
    var i = Number(sel.dataset.line);
    if (formEmpresasEnv[i]) formEmpresasEnv[i].Empresa = sel.value;
  });
  document.querySelectorAll('.env-emp-monto').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (formEmpresasEnv[i]) formEmpresasEnv[i].Monto = Number(inp.value) || 0;
  });
  recalcTotalsEnv();
}

function valorEnvio() { return Number(document.getElementById('env-valor').value) || 0; }

function recalcTotalsEnv() {
  var totalGastos = valorEnvio();
  var totalReparto = formEmpresasEnv.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  document.getElementById('env-total-gastos').textContent = fmtMoney(totalGastos);
  document.getElementById('env-total-reparto').textContent = fmtMoney(totalReparto);
  // Con el reparto en $0 no hay descuadre que avisar: se calcula al guardar.
  document.getElementById('env-reparto-warn').style.display = (totalReparto > 0 && totalGastos !== totalReparto) ? 'block' : 'none';
  document.getElementById('env-reparto-info').style.display = (totalReparto === 0 && totalGastos > 0 && formRemisionesEnv.length) ? 'block' : 'none';
}

// Calcula el reparto por litros/kilos y lo vuelca en el formulario: conserva
// las filas de empresa que ya hay (con su nuevo monto, o 0) y agrega las que
// aparecen en el cálculo. Devuelve { ok, motivo?, calc? }.
function _aplicarRepartoEnv() {
  var valor = valorEnvio();
  if (!formRemisionesEnv.length) return { ok: false, motivo: 'Agrega primero las remisiones' };
  if (valor <= 0) return { ok: false, motivo: 'Indica primero el valor del envío' };
  var calc = calcularRepartoSugerido(formRemisionesEnv, valor);
  var emps = Object.keys(calc.porEmpresa);
  if (!emps.length) return { ok: false, motivo: 'No se pudo determinar la empresa de las remisiones' };
  var nuevo = [];
  formEmpresasEnv.forEach(function(e) {
    if (e.Empresa) nuevo.push({ Empresa: e.Empresa, Monto: calc.porEmpresa[e.Empresa] || 0 });
  });
  emps.forEach(function(emp) {
    if (!nuevo.some(function(e) { return e.Empresa === emp; })) nuevo.push({ Empresa: emp, Monto: calc.porEmpresa[emp] });
  });
  formEmpresasEnv = nuevo;
  renderEnvEmpresas();
  recalcTotalsEnv();
  return { ok: true, calc: calc };
}

function _msgRepartoCalculado(calc) {
  var msg = 'Reparto calculado por ' + (calc.metodo === 'litros/kilos' ? 'litros/kilos' : 'número de remisiones');
  if (calc.sinResolver.length) msg += ' · sin litros/kilos: ' + calc.sinResolver.join(', ');
  return msg;
}

function calcularRepartoEnv() {
  readEnvEmpresas();
  if (formEmpresasEnv.some(function(e) { return e.Empresa && Number(e.Monto) > 0; }) &&
      !confirm('Ya hay montos en el reparto. ¿Reemplazarlos por el cálculo por litros/kilos?')) return;
  var r = _aplicarRepartoEnv();
  if (!r.ok) { showToast(r.motivo, '#e67e22'); return; }
  showToast(_msgRepartoCalculado(r.calc), r.calc.sinResolver.length ? '#e67e22' : '#27ae60');
}

function openFormEnvio(id) {
  editingLegId = id || null;
  var leg = null;
  if (editingLegId) {
    leg = legs.find(function(l) { return l.id === editingLegId; });
    if (!leg) return;
  }
  var it = leg ? (itemsOf(leg.id)[0] || {}) : {};
  var nd = splitNitDv(it.NIT);
  document.getElementById('form-env-titulo').textContent = leg ? 'Editar ' + (leg.Consecutivo || '') : 'Nuevo envío';
  document.getElementById('env-fecha').value = leg ? (leg.Fecha || '').slice(0, 10) : today();
  document.getElementById('env-proveedor').value = it.Proveedor || '';
  document.getElementById('env-nit').value = nd.nit || '';
  document.getElementById('env-dv').value = nd.dv || '';
  document.getElementById('env-valor').value = it.Valor || '';
  document.getElementById('env-remision-nueva').value = '';
  formRemisionesEnv = leg ? (leg.Remisiones_Relacionadas || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; }) : [];
  formEmpresasEnv = leg ? empresasOf(leg.id).map(function(e) { return { Empresa: e.Empresa, Monto: e.Monto }; }) : [];
  if (!formEmpresasEnv.length) formEmpresasEnv = [{ Empresa: '', Monto: '' }];
  renderEnvRemisiones();
  renderEnvEmpresas();
  recalcTotalsEnv();
  document.getElementById('form-env-overlay').classList.add('show');
}

function closeFormEnvio() {
  document.getElementById('form-env-overlay').classList.remove('show');
}

async function saveFormEnvio() {
  readEnvEmpresas();
  var proveedor = document.getElementById('env-proveedor').value.trim();
  var valor = valorEnvio();
  if (!proveedor) { showToast('Indica el proveedor', '#e67e22'); return; }
  if (valor <= 0) { showToast('Indica el valor del envío', '#e67e22'); return; }
  // Otro usuario pudo registrar una de estas remisiones desde que se abrió el formulario.
  var remRepetida = formRemisionesEnv.map(function(r) { return remisionRepetidaMsg(r, [], editingLegId); }).find(function(m) { return m; });
  if (remRepetida) { showToast(remRepetida, '#e67e22'); return; }

  // Reparto vacío ($0 en todas las filas) + remisiones: se calcula por
  // litros/kilos al guardar, para que el usuario no tenga que pedirlo.
  var repartoActual = formEmpresasEnv.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  var autoCalc = null;
  if (repartoActual === 0 && formRemisionesEnv.length) {
    var r = _aplicarRepartoEnv();
    if (r.ok) autoCalc = r.calc;
  }

  var empresasValidas = formEmpresasEnv.filter(function(e) { return e.Empresa; });
  if (!empresasValidas.length) { showToast('Agrega al menos una empresa en el reparto', '#e67e22'); return; }
  if (!formRemisionesEnv.length &&
      !confirm('No agregaste remisiones: el costo quedará como "Sin identificar" en el prorrateo de gastos. ¿Guardar de todas formas?')) return;

  var totalReparto = empresasValidas.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  if (valor !== totalReparto) {
    if (!confirm('El reparto entre empresas (' + fmtMoney(totalReparto) + ') no coincide con el valor del envío (' + fmtMoney(valor) + '). ¿Guardar de todas formas?')) return;
  }

  var header = {
    Fecha: document.getElementById('env-fecha').value || today(),
    Tipo: 'Envio',
    Responsable: '',
    Placa: '',
    Recorrido_Ruta: '',
    No_Personas: null,
    Fecha_Salida: null,
    Fecha_Llegada: null,
    Km_Salida: null,
    Km_Llegada: null,
    Clientes: '',
    Remisiones_Relacionadas: formRemisionesEnv.join(', '),
    Anticipo_Entregado: 0,
    Observaciones: ''
  };
  var items = [{
    Concepto: ENVIO_CONCEPTO,
    Proveedor: proveedor,
    NIT: joinNitDv(document.getElementById('env-nit').value, document.getElementById('env-dv').value),
    Valor: valor,
    Galones: null
  }];

  var body = { header: header, items: items, empresas: empresasValidas };
  var res;
  if (editingLegId) {
    body.id = editingLegId;
    res = await apiPost(Object.assign({ action: 'editarLegalizacionGastos' }, body));
  } else {
    res = await apiPost(Object.assign({ action: 'agregarLegalizacionGastos' }, body));
  }
  if (!res.ok) { showToast('Error al guardar: ' + res.error, '#e74c3c'); return; }

  showToast(autoCalc ? 'Envío guardado. ' + _msgRepartoCalculado(autoCalc) : 'Envío guardado correctamente', '#27ae60');
  closeFormEnvio();
  await loadLegalizaciones();
  if (res.id) openVer(res.id);
  else if (editingLegId) openVer(editingLegId);
}

async function eliminarLegalizacion(id) {
  var leg = legs.find(function(l) { return l.id === id; });
  if (!leg) return;
  var esEnv = esEnvio(leg);
  if (!confirm('¿Eliminar ' + (esEnv ? 'el envío ' : 'la legalización ') + (leg.Consecutivo || '') + '? Esta acción no se puede deshacer.')) return;
  var res = await apiPost({ action: 'eliminarLegalizacionGastos', id: id });
  if (!res.ok) { showToast('Error al eliminar: ' + res.error, '#e74c3c'); return; }
  showToast(esEnv ? 'Envío eliminado' : 'Legalización eliminada', '#e67e22');
  await loadLegalizaciones();
}

function editarDesdeVer() {
  var id = verLegId;
  var leg = legs.find(function(l) { return l.id === id; });
  closeVer();
  if (esEnvio(leg)) openFormEnvio(id);
  else if (leg && leg.Tipo === 'Mantenimiento') openFormMant(id);
  else openForm(id);
}

// ── Ver / conciliar ──
function openVer(id) {
  verLegId = id;
  var leg = legs.find(function(l) { return l.id === id; });
  if (!leg) return;

  document.getElementById('ver-titulo').innerHTML = escHtml(leg.Consecutivo || '') + ' ' + tipoBadgeHtml(leg);
  document.getElementById('ver-meta').textContent = esEnvio(leg)
    ? 'Fecha: ' + fmtDate(leg.Fecha)
    : 'Responsable: ' + (leg.Responsable || '—') + ' · Fecha: ' + fmtDate(leg.Fecha);

  var editBtn = document.getElementById('ver-btn-editar');
  editBtn.style.display = (leg.Estado_Conciliacion === 'Por conciliar' && AUTH.hasModule('legalizacion_gastos')) ? 'inline-block' : 'none';

  renderVerBody(leg);
  document.getElementById('ver-overlay').classList.add('show');
  loadAdjuntosLG(id);
}

function closeVer() {
  document.getElementById('ver-overlay').classList.remove('show');
  verLegId = null;
}

function renderVerBody(leg) {
  var items = itemsOf(leg.id);
  var emps = empresasOf(leg.id);
  var totalGastos = totalGastosOf(leg.id);
  var totalReparto = totalRepartoOf(leg.id);
  var esMant = leg.Tipo === 'Mantenimiento';
  var esEnv = esEnvio(leg);
  var combVer = totalCombustibleLista(items);
  var repartoSinComb = !esMant && combVer > 0 && totalReparto === totalGastos - combVer;

  var itemsHtml = items.map(function(it) {
    return '<tr><td>' + escHtml(it.Concepto || '') + '</td><td>' + escHtml(it.Proveedor || '') + '</td><td>' + escHtml(it.NIT || '') + '</td><td style="text-align:right">' + escHtml(fmtMoney(it.Valor)) + '</td></tr>';
  }).join('') || '<tr><td colspan="4"><div class="no-lines">Sin líneas de gasto.</div></td></tr>';

  var empsHtml = emps.map(function(e) {
    return '<tr><td>' + escHtml(getSigla(e.Empresa)) + '</td><td style="text-align:right">' + escHtml(fmtMoney(e.Monto)) + '</td></tr>';
  }).join('') || '<tr><td colspan="2"><div class="no-lines">Sin reparto.</div></td></tr>';

  var conciliacionHtml;
  if (leg.Estado_Conciliacion === 'Conciliada') {
    conciliacionHtml = '<div style="padding:10px 14px;background:#eafaf1;border:1px solid #a9dfbf;border-radius:8px;font-size:0.86rem">' +
      '<strong>✅ Conciliada</strong> por ' + escHtml(leg.Conciliado_Por || '—') + ' el ' + escHtml(fmtDate(leg.Fecha_Conciliacion)) + '<br>' +
      'Saldo a favor del empleado: <strong>' + escHtml(fmtMoney(leg.Saldo_Favor_Empleado)) + '</strong> · ' +
      'Saldo por reembolsar a la empresa: <strong>' + escHtml(fmtMoney(leg.Saldo_Reembolsar_Empresa)) + '</strong>' +
    '</div>';
  } else if (leg.Estado_Conciliacion === 'Rechazada') {
    conciliacionHtml = '<div style="padding:10px 14px;background:#fce4ec;border:1px solid #f5b7b1;border-radius:8px;font-size:0.86rem">' +
      '<strong>❌ Rechazada</strong> por ' + escHtml(leg.Conciliado_Por || '—') + ' el ' + escHtml(fmtDate(leg.Fecha_Conciliacion)) + '<br>' +
      'Motivo: ' + escHtml(leg.Motivo_Rechazo || '—') +
    '</div>';
  } else if (!esEnv && AUTH.canConciliarGastos()) {
    conciliacionHtml =
      '<div style="padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">' +
        '<div style="font-weight:700;color:#92400e;margin-bottom:8px;font-size:0.86rem">Conciliar legalización</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
          '<div><label class="ef-label">Saldo a favor del empleado ($)</label><input class="ef" id="ver-saldo-favor" type="number" min="0" step="1"></div>' +
          '<div><label class="ef-label">Saldo por reembolsar a la empresa ($)</label><input class="ef" id="ver-saldo-reemb" type="number" min="0" step="1"></div>' +
        '</div>' +
        '<div style="margin-bottom:10px"><label class="ef-label">Motivo de rechazo (solo si rechaza)</label><input class="ef" id="ver-motivo-rechazo" type="text" style="width:100%"></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn-confirm" onclick="doConciliarLG(true)">✅ Conciliar</button>' +
          '<button class="btn-cancel" style="color:#c0392b" onclick="doConciliarLG(false)">❌ Rechazar</button>' +
        '</div>' +
      '</div>';
  } else {
    conciliacionHtml = '<div style="padding:10px 14px;background:#fef3cd;border:1px solid #f9e79f;border-radius:8px;font-size:0.86rem;color:#7d6608">⏳ Pendiente de conciliación.</div>';
  }

  // Kilometraje/rendimiento (piloto, KM_PILOTO_PLACAS): solo informativo,
  // nunca bloquea la conciliación ni cambia el reparto entre empresas.
  var kmHtml = '';
  if (!esMant && leg.Km_Salida != null && leg.Km_Llegada != null) {
    var kmRec = Number(leg.Km_Llegada) - Number(leg.Km_Salida);
    var galonesComb = items.filter(function(it) { return it.Concepto === 'Combustible'; })
      .reduce(function(s, it) { return s + (Number(it.Galones) || 0); }, 0);
    var rendReal = galonesComb > 0 ? (kmRec / galonesComb) : null;
    var veh = vehiculos.find(function(v) { return v.Placa === leg.Placa; });
    var rendEsp = (veh && veh.Rendimiento_Esperado != null) ? Number(veh.Rendimiento_Esperado) : null;
    var alertaRend = '';
    if (rendReal != null && rendEsp) {
      var desvio = (rendReal - rendEsp) / rendEsp;
      if (desvio < -0.25) alertaRend = ' <span style="color:#c0392b;font-weight:700">⚠ muy por debajo de lo esperado (~' + escHtml(String(rendEsp)) + ' km/gal)</span>';
    }
    kmHtml = '<div style="grid-column:span 3;padding:8px 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px">' +
      '⛽ <strong>Km recorridos:</strong> ' + escHtml(kmRec.toLocaleString('es-CO')) + ' km' +
      ' (salida ' + escHtml(Number(leg.Km_Salida).toLocaleString('es-CO')) + ' → llegada ' + escHtml(Number(leg.Km_Llegada).toLocaleString('es-CO')) + ')' +
      (rendReal != null ? ' · <strong>Rendimiento real:</strong> ' + rendReal.toFixed(1) + ' km/gal' + alertaRend : '') +
    '</div>';
  }

  var infoGridHtml = esEnv ?
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:0.86rem;margin-bottom:14px">' +
      '<div style="grid-column:span 3"><strong>Remisiones relacionadas:</strong> ' + escHtml(leg.Remisiones_Relacionadas || '—') + '</div>' +
    '</div>' :
    esMant ?
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:0.86rem;margin-bottom:14px">' +
      '<div><strong>Placa:</strong> ' + escHtml(leg.Placa || '—') + '</div>' +
      (leg.Km_Llegada != null ? '<div><strong>Kilometraje registrado:</strong> ' + escHtml(Number(leg.Km_Llegada).toLocaleString('es-CO')) + ' km</div>' : '') +
      '<div><strong>Anticipo entregado:</strong> ' + escHtml(fmtMoney(leg.Anticipo_Entregado)) + '</div>' +
      '<div style="grid-column:span 3"><strong>Observaciones:</strong> ' + escHtml(leg.Observaciones || '—') + '</div>' +
    '</div>' :
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:0.86rem;margin-bottom:14px">' +
      '<div><strong>Ruta:</strong> ' + escHtml(leg.Recorrido_Ruta || '—') + '</div>' +
      '<div><strong>Placa:</strong> ' + escHtml(leg.Placa || '—') + '</div>' +
      '<div><strong>Personas en ruta:</strong> ' + escHtml(leg.No_Personas || '—') + '</div>' +
      '<div><strong>Clientes:</strong> ' + escHtml(leg.Clientes || '—') + '</div>' +
      '<div><strong>Fecha salida:</strong> ' + escHtml(fmtDate(leg.Fecha_Salida) + (leg.Hora_Salida ? ' · ' + fmtHora(leg.Hora_Salida) : '')) + '</div>' +
      '<div><strong>Fecha llegada:</strong> ' + escHtml(fmtDate(leg.Fecha_Llegada) + (leg.Hora_Llegada ? ' · ' + fmtHora(leg.Hora_Llegada) : '')) + '</div>' +
      '<div><strong>Anticipo entregado:</strong> ' + escHtml(fmtMoney(leg.Anticipo_Entregado)) + '</div>' +
      kmHtml +
      '<div style="grid-column:span 3"><strong>Remisiones relacionadas:</strong> ' + escHtml(leg.Remisiones_Relacionadas || '—') + '</div>' +
      '<div style="grid-column:span 3"><strong>Observaciones:</strong> ' + escHtml(leg.Observaciones || '—') + '</div>' +
    '</div>';

  document.getElementById('ver-body').innerHTML =
    infoGridHtml +
    '<h3 style="font-size:0.88rem;color:#1a5276;margin-bottom:6px">' + (esEnv ? 'Envío' : (esMant ? 'Líneas de gasto (detalle de mantenimiento)' : 'Líneas de gasto')) + '</h3>' +
    '<table><thead><tr><th>' + (esMant ? 'Detalle' : 'Concepto') + '</th><th>Proveedor</th><th>NIT</th><th style="text-align:right">Valor</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>' +
    '<h3 style="font-size:0.88rem;color:#1a5276;margin:14px 0 6px">Reparto entre empresas</h3>' +
    '<table><thead><tr><th>Empresa</th><th style="text-align:right">Monto</th></tr></thead><tbody>' + empsHtml + '</tbody></table>' +
    '<div style="margin:10px 0 14px;font-size:0.84rem;color:#4a5568">Total gastos: <strong>' + escHtml(fmtMoney(totalGastos)) + '</strong> · Total repartido: <strong>' + escHtml(fmtMoney(totalReparto)) + '</strong>' +
      (repartoSinComb ? ' · <em>El reparto no incluye el Combustible (' + escHtml(fmtMoney(combVer)) + ')</em>' : '') + '</div>' +
    // Los envíos no se concilian: sin bloque de conciliación.
    (esEnv ? '' : '<h3 style="font-size:0.88rem;color:#1a5276;margin-bottom:6px">Conciliación</h3>' + conciliacionHtml) +
    '<h3 style="font-size:0.88rem;color:#1a5276;margin:16px 0 6px">Soportes adjuntos <span id="lg-adj-count"></span></h3>' +
    (AUTH.hasModule('legalizacion_gastos') && leg.Estado_Conciliacion === 'Por conciliar' ?
      '<input type="file" id="lg-adjunto-input" accept=".pdf,.jpg,.jpeg,.png,.webp" onchange="handleAdjuntoUploadLG(this)" style="margin-bottom:8px">' : '') +
    '<div id="lg-adjuntos-list"></div>';
}

async function doConciliarLG(aprobar) {
  var id = verLegId;
  if (!id) return;
  var saldoFavor = document.getElementById('ver-saldo-favor').value;
  var saldoReemb = document.getElementById('ver-saldo-reemb').value;
  var motivo = document.getElementById('ver-motivo-rechazo').value.trim();

  if (!aprobar && !motivo) { showToast('Indica el motivo del rechazo', '#e67e22'); return; }
  if (aprobar && !confirm('¿Conciliar esta legalización? No se podrá editar después.')) return;
  if (!aprobar && !confirm('¿Rechazar esta legalización?')) return;

  var res = await apiPost({
    action: 'conciliarLegalizacionGastos', id: id, aprobar: aprobar,
    saldo_favor: saldoFavor, saldo_reembolsar: saldoReemb, motivo_rechazo: motivo
  });
  if (!res.ok) { showToast('Error: ' + res.error, '#e74c3c'); return; }

  showToast(aprobar ? 'Legalización conciliada' : 'Legalización rechazada', aprobar ? '#27ae60' : '#e67e22');
  await loadLegalizaciones();
  openVer(id);
}

// ── Adjuntos (bucket privado: solo legalizacion_gastos / _aprobar) ──
function legAdjuntoFolder(legId) { return String(legId); }

async function loadAdjuntosLG(legId) {
  var listEl = document.getElementById('lg-adjuntos-list');
  var countEl = document.getElementById('lg-adj-count');
  if (!listEl) return;
  listEl.innerHTML = '<div class="adjuntos-loading">Cargando adjuntos...</div>';

  var folder = legAdjuntoFolder(legId);
  var res = await _sb.storage.from(LEG_BUCKET).list(folder, { limit: 50 });
  var files = (res.data || []).filter(function(f) { return f.name && f.id; });
  legAdjuntosCache = files;

  if (!files.length) {
    listEl.innerHTML = '<div class="adjuntos-empty">Sin archivos adjuntos</div>';
    if (countEl) countEl.textContent = '';
    return;
  }
  if (countEl) countEl.textContent = '(' + files.length + ')';

  listEl.innerHTML = files.map(function(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var icon = ext === 'pdf' ? '📄' : '🖼️';
    var size = f.metadata && f.metadata.size ? formatFileSize(f.metadata.size) : '';
    var path = folder + '/' + f.name;
    var nameEsc = escHtml(f.name);
    var pathEsc = escHtml(path);
    var leg = legs.find(function(l) { return l.id === legId; });
    var puedeBorrar = AUTH.hasModule('legalizacion_gastos') && leg && leg.Estado_Conciliacion === 'Por conciliar';
    return '<div class="adjunto-item">' +
      '<div class="adjunto-icon">' + icon + '</div>' +
      '<div class="adjunto-info">' +
        '<div class="adjunto-name" title="' + nameEsc + '">' + nameEsc + '</div>' +
        '<div class="adjunto-meta">' + ext.toUpperCase() + (size ? ' · ' + size : '') + '</div>' +
      '</div>' +
      '<div class="adjunto-actions">' +
        '<button class="btn-adj-ver" onclick="previewAdjuntoLG(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + ext + '\')">👁 Ver</button>' +
        '<button class="btn-adj-ver" onclick="downloadAdjuntoLG(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + nameEsc.replace(/'/g, "\\'") + '\')">⬇ Descargar</button>' +
        (puedeBorrar ? '<button class="btn-adj-del" onclick="deleteAdjuntoLG(\'' + pathEsc.replace(/'/g, "\\'") + '\')">🗑️</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

async function handleAdjuntoUploadLG(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  input.value = '';
  if (!verLegId) return;

  var maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) { showToast('El archivo excede 5 MB.', '#e74c3c'); return; }
  var allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (allowed.indexOf(file.type) < 0) { showToast('Tipo de archivo no permitido. Usa PDF, JPG, PNG o WEBP.', '#e74c3c'); return; }

  var timestamp = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var path = legAdjuntoFolder(verLegId) + '/' + timestamp + '_' + safeName;

  var res = await _sb.storage.from(LEG_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (res.error) { showToast('Error al subir: ' + res.error.message, '#e74c3c'); return; }

  showToast('Archivo adjuntado correctamente', '#27ae60');
  await loadAdjuntosLG(verLegId);
}

async function previewAdjuntoLG(path, ext) {
  var signed = await _sb.storage.from(LEG_BUCKET).createSignedUrl(path, 3600);
  var url = signed.data && signed.data.signedUrl;
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }
  window.open(url, '_blank');
}

async function downloadAdjuntoLG(path, filename) {
  var signed = await _sb.storage.from(LEG_BUCKET).createSignedUrl(path, 3600);
  var url = signed.data && signed.data.signedUrl;
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || 'archivo';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function deleteAdjuntoLG(path) {
  if (!confirm('¿Eliminar este archivo adjunto?')) return;
  var res = await _sb.storage.from(LEG_BUCKET).remove([path]);
  if (res.error) { showToast('Error al eliminar: ' + res.error.message, '#e74c3c'); return; }
  showToast('Archivo eliminado', '#e67e22');
  if (verLegId) await loadAdjuntosLG(verLegId);
}

// ── PDF ──
function exportarPDF() {
  var leg = legs.find(function(l) { return l.id === verLegId; });
  if (!leg) return;
  var items = itemsOf(leg.id);
  var emps = empresasOf(leg.id);
  var totalGastos = totalGastosOf(leg.id);
  var esMant = leg.Tipo === 'Mantenimiento';
  var esEnv = esEnvio(leg);

  var reparto = emps.map(function(e) { return getSigla(e.Empresa) + ': ' + fmtMoney(e.Monto); }).join('  ·  ');

  var leftFields = esEnv ? [
    ['Remisiones relacionadas', leg.Remisiones_Relacionadas || '—'],
  ] : esMant ? [
    ['Responsable', leg.Responsable || ''],
    ['Placa', leg.Placa || '—'],
    ['Observaciones', leg.Observaciones || '—'],
  ] : [
    ['Responsable', leg.Responsable || ''],
    ['Placa', leg.Placa || '—'],
    ['Recorrido / Ruta', leg.Recorrido_Ruta || ''],
    ['No. Personas en ruta', String(leg.No_Personas || '')],
    ['Cliente(s)', leg.Clientes || ''],
    ['Observaciones', leg.Observaciones || '—'],
  ];
  var rightFields = esEnv ? [
    ['Total envío', fmtMoney(totalGastos)],
    ['Reparto entre empresas', reparto || '—'],
  ] : esMant ? [
    ['Anticipo entregado', fmtMoney(leg.Anticipo_Entregado)],
    ['Total gastos', fmtMoney(totalGastos)],
    ['Reparto entre empresas', reparto || '—'],
  ] : [
    ['Fecha de salida', fmtDate(leg.Fecha_Salida) + (leg.Hora_Salida ? ' ' + fmtHora(leg.Hora_Salida) : '')],
    ['Fecha de llegada', fmtDate(leg.Fecha_Llegada) + (leg.Hora_Llegada ? ' ' + fmtHora(leg.Hora_Llegada) : '')],
    ['Anticipo entregado', fmtMoney(leg.Anticipo_Entregado)],
    ['Total gastos', fmtMoney(totalGastos)],
    ['Reparto entre empresas', reparto || '—'],
    ['Remisiones relacionadas', leg.Remisiones_Relacionadas || '—'],
  ];
  if (!esMant && !esEnv && leg.Km_Salida != null && leg.Km_Llegada != null) {
    rightFields.push(['Km recorridos', (Number(leg.Km_Llegada) - Number(leg.Km_Salida)).toLocaleString('es-CO') + ' km']);
  }
  if (esMant && leg.Km_Llegada != null) {
    rightFields.push(['Kilometraje', Number(leg.Km_Llegada).toLocaleString('es-CO') + ' km']);
  }

  // El gasto se reparte entre varias empresas del holding (ver "reparto" /
  // right_fields), así que el documento no pertenece a ninguna en particular
  // — mostrar aquí una de esas empresas (y su NIT/dirección real) sería
  // incorrecto. "Polinizando Futuro" es una etiqueta neutra, no una empresa
  // real del holding, así que no dispara ningún banner de NIT/dirección.
  var data = {
    empresa: 'Polinizando Futuro',
    consecutivo: leg.Consecutivo,
    doc_title: esEnv ? 'REGISTRO DE ENVIO' : (esMant ? 'LEGALIZACION DE MANTENIMIENTO' : 'LEGALIZACION DE GASTOS'),
    doc_number: leg.Consecutivo,
    date_label: 'Fecha',
    ref_label: null,
    fecha_entrega: fmtDate(leg.Fecha),
    file_prefix: esEnv ? 'Registro_Envio' : (esMant ? 'Legalizacion_Mantenimiento' : 'Legalizacion_Gastos'),
    copies: ['ORIGINAL - CONTABILIDAD'],
    // El envío es un registro, no una legalización que se firme.
    hide_signatures: esEnv,
    page_format: 'letter',
    logo_key: 'LEGALIZACION',
    // Más aire arriba y campos largos (Remisiones relacionadas, Cliente(s))
    // con espacio suficiente para que el texto no toque las líneas del recuadro.
    top_margin: 8,
    left_block_ratio: 0.5,
    info_line_h: 3.4,
    info_pad: 2,
    signatures: [
      { label: 'Emitido por', sub: 'Nombre y firma' },
      { label: 'Despachado / Conductor', sub: 'Nombre y firma' },
      { label: 'Contabilidad', sub: 'Nombre y firma' }
    ],
    show_fecha_entrega: false,
    col1_header: esMant ? 'Detalle' : 'Concepto',
    col2_header: 'Proveedor',
    col1_width: 32,
    col2_width: 60,
    col2_align: 'left',
    qty_header: 'Valor',
    show_valores: false,
    last_col_header: 'Observaciones',
    entregas: items.map(function(it) {
      return { producto: it.Concepto, presentacion: it.Proveedor + (it.NIT ? ' (NIT ' + it.NIT + ')' : ''), cantidad: it.Valor, observaciones: '' };
    }),
    left_fields: leftFields,
    right_fields: rightFields
  };
  generarRemisionPDF(data);
}

initAutocomplete(document.getElementById('lg-cliente-nueva'), {
  minChars: 1,
  items: function() { return clientesConRemisionCache || []; },
  display: function(c) { return '<strong>' + escHtml(c) + '</strong>'; },
  match: function(c, val) { return c.toLowerCase().indexOf(val) >= 0; },
  onSelect: function(c) { addLgCliente(c); }
});

// Proveedores para el formulario de envío: todos los ya usados en formularios
// pasados (mismo origen que las líneas de gasto), con los de envíos anteriores
// primero — los de peajes/combustible/alimentación quedan después.
function proveedoresConocidosEnvio() {
  var idsEnvio = {};
  legs.forEach(function(l) { if (esEnvio(l)) idsEnvio[l.id] = true; });
  var deEnvio = {};
  legItems.forEach(function(it) {
    if (!idsEnvio[it.Legalizacion_Id]) return;
    var prov = (it.Proveedor || '').trim();
    if (prov) deEnvio[prov.toLowerCase() + '|' + (it.NIT || '').trim()] = true;
  });
  return proveedoresConocidos().map(function(p) {
    return { proveedor: p.proveedor, nit: p.nit, deEnvio: !!deEnvio[p.proveedor.toLowerCase() + '|' + p.nit] };
  }).sort(function(a, b) { return (b.deEnvio ? 1 : 0) - (a.deEnvio ? 1 : 0); }); // estable: respeta el orden alfabético
}

// Proveedor del formulario de envío: autocompleta con los proveedores de
// formularios pasados (sugiere ya al hacer clic, sin escribir) y completa NIT + DV.
initAutocomplete(document.getElementById('env-proveedor'), {
  minChars: 0,
  items: proveedoresConocidosEnvio,
  display: function(p) {
    return '<strong>' + escHtml(p.proveedor) + '</strong>' + (p.nit ? ' <span class="ac-sub">NIT ' + escHtml(p.nit) + '</span>' : '') +
      (p.deEnvio ? ' <span class="ac-sub">· 📦 envío anterior</span>' : '');
  },
  match: function(p, val) { return p.proveedor.toLowerCase().indexOf(val) >= 0; },
  onSelect: function(p) {
    document.getElementById('env-proveedor').value = p.proveedor;
    var nd = splitNitDv(p.nit);
    document.getElementById('env-nit').value = nd.nit;
    document.getElementById('env-dv').value = nd.dv;
  }
});

loadLegalizaciones();
