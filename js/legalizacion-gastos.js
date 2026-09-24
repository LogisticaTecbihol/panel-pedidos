// ── Legalización de Gastos ──
// Reemplaza el Excel CT-PFT-FO02: gastos de ruta de un conductor (combustible,
// alimentación, peajes) contra un anticipo, con conciliación en dos pasos.

// ── Tabs ──
function switchTab(tab) {
  ['legalizaciones', 'prorrateo'].forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var btn = document.getElementById('tab-' + t);
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    if (btn) btn.style.background = (t === tab) ? '#1a5276' : '#718096';
  });
  if (tab === 'prorrateo') renderProrrateoGastos();
}

var LEG_BUCKET = 'legalizacion-gastos-adjuntos';

var legs = [];       // LegalizacionGastos (cabeceras)
var legItems = [];   // LegalizacionGastosItems (líneas de gasto)
var legEmpresas = []; // LegalizacionGastosEmpresas (reparto)

var editingLegId = null; // id en edición dentro de #form-overlay, null = nueva
var verLegId = null;     // id mostrado en #ver-overlay

var formGastos = [];     // líneas de gasto del formulario en curso
var formEmpresas = [];   // reparto por empresa del formulario en curso
var formRemisiones = []; // remisiones relacionadas del formulario en curso (lista)
var formClientes = [];   // clientes visitados del formulario en curso (lista)
var formGastoProveedorACs = []; // autocompletes de Proveedor (uno por línea de gasto, se recrean en cada render)

var legAdjuntosCache = [];

// Clientes con al menos una remisión real generada (Pedidos.Remisiones no
// vacío, Estado_2 != 'Anulado'), para sugerir en el campo Cliente(s) y para
// auto-completar el cliente cuando se agrega una remisión que le pertenece.
var clientesConRemisionCache = null;
var remisionClienteMap = {}; // "REM-001" (mayúsculas) -> Cliente

// "REM-001" (mayúsculas) -> [{producto, presentacion, cantidad, empresa}, ...]
// — la cantidad es la de ESA remisión puntual (una fila de Pedidos puede
// tener varias entregas parciales bajo remisiones distintas). Solo cubre
// entregas de Pedidos (mismo alcance que remisionClienteMap); traslados/OC,
// muestras y reenvases no se resuelven aquí. Usado por calcularProrrateoGastos().
var remisionProductoMap = {};

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
    var res = await apiGet('getPedidos', { columns: 'Cliente,Remisiones,Estado_2,Producto,Presentacion,Nombre_Empresa' });
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
    clientesConRemisionCache = Object.keys(set).sort(function(a, b) { return a.localeCompare(b, 'es'); });
    remisionClienteMap = remMap;
    remisionProductoMap = prodMap;
    renderProrrateoGastos(); // legs pudo cargar antes o después de este fetch
  } catch (e) {
    clientesConRemisionCache = clientesConRemisionCache || [];
  }
}

// Responsables conocidos; "Otro" pide especificar el nombre.
var RESPONSABLES_FIJOS = ['Leimer Villegas', 'Kevin Rey'];

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

// Conceptos fijos del formulario de gasto; "Otros" pide especificar el detalle.
var CONCEPTO_FIJOS = ['Combustible', 'Alimentación', 'Peaje', 'Mantenimiento'];

function parseConceptoLine(concepto) {
  return CONCEPTO_FIJOS.indexOf(concepto) >= 0 ? { sel: concepto, detail: '' } : { sel: 'Otros', detail: concepto || '' };
}

function conceptoOptionsHtml(selected) {
  var opts = CONCEPTO_FIJOS.concat(['Otros']).map(function(c) {
    return '<option value="' + escHtml(c) + '"' + (c === selected ? ' selected' : '') + '>' + escHtml(c) + '</option>';
  });
  return opts.join('');
}

// ── Carga inicial ──
async function loadLegalizaciones() {
  await _authReady;
  populateEmpresaSelect('f-emp', 'Todas');
  populateEmpresaSelect('pf-emp', 'Todas');
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
      apiGet('getLegalizacionGastosEmpresas')
    ]);
    if (!results[0].ok) throw new Error(results[0].error || 'Error desconocido');
    if (!results[1].ok) throw new Error(results[1].error || 'Error desconocido');
    if (!results[2].ok) throw new Error(results[2].error || 'Error desconocido');

    legs = (results[0].legalizaciones || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0, 10);
      return r;
    });
    legItems = results[1].items || [];
    legEmpresas = results[2].empresas || [];

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

// ── Helpers de datos ──
function itemsOf(legId) { return legItems.filter(function(it) { return it.Legalizacion_Id === legId; }); }
function empresasOf(legId) { return legEmpresas.filter(function(e) { return e.Legalizacion_Id === legId; }); }
function totalGastosOf(legId) { return itemsOf(legId).reduce(function(s, it) { return s + (Number(it.Valor) || 0); }, 0); }
function totalRepartoOf(legId) { return empresasOf(legId).reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0); }

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
function calcularProrrateoGastos() {
  var fEmp = document.getElementById('pf-emp').value;
  var fEmpSigla = fEmp ? getSigla(fEmp) : '';
  var fDesde = document.getElementById('pf-desde').value;
  var fHasta = document.getElementById('pf-hasta').value;

  var porEmpresa = {};       // empresaSigla -> monto total
  var porEmpresaSku = {};    // empresaSigla -> { sku -> monto } (para agrupar "por producto" por empresa)
  var sinIdentificar = 0;
  var totalGeneral = 0;

  legs.forEach(function(leg) {
    if (leg.Estado_Conciliacion === 'Rechazada') return;
    if (fDesde && (leg.Fecha || '') < fDesde) return;
    if (fHasta && (leg.Fecha || '') > fHasta) return;
    var totalViaje = totalGastosOf(leg.id);
    if (totalViaje <= 0) return;

    // Remisiones_Relacionadas es un CSV simple de códigos (sin "|cant|fecha"),
    // igual formato que lee openForm() al editar (línea ~591) — no usar
    // _parseRemisionesField aquí, que solo separa por coma cuando detecta "|".
    var codigos = (leg.Remisiones_Relacionadas || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    var lineas = [];
    codigos.forEach(function(c) {
      var matches = remisionProductoMap[c.trim().toUpperCase()];
      if (matches) lineas = lineas.concat(matches);
    });

    var totalLitros = 0;
    lineas.forEach(function(l) {
      var lit = _litParse(l.producto, l.presentacion);
      l._litros = lit.convertible ? lit.litrosUnidad * (Number(l.cantidad) || 0) : 0;
      totalLitros += l._litros;
    });

    if (totalLitros <= 0) {
      if (!fEmp) { sinIdentificar += totalViaje; totalGeneral += totalViaje; }
      return;
    }

    lineas.forEach(function(l) {
      if (l._litros <= 0) return;
      var emp = getSigla(l.empresa);
      if (fEmpSigla && emp !== fEmpSigla) return;
      var monto = (l._litros / totalLitros) * totalViaje;
      var sku = (l.producto || 'Sin nombre') + (l.presentacion ? ' (' + l.presentacion + ')' : '');
      porEmpresa[emp] = (porEmpresa[emp] || 0) + monto;
      var skuMap = porEmpresaSku[emp] || (porEmpresaSku[emp] = {});
      skuMap[sku] = (skuMap[sku] || 0) + monto;
      totalGeneral += monto;
    });
  });

  return { porEmpresa: porEmpresa, porEmpresaSku: porEmpresaSku, sinIdentificar: sinIdentificar, totalGeneral: totalGeneral };
}

// Monto con 2 decimales (el prorrateo por litros da valores fraccionarios;
// fmtMoney de shared.js redondea a entero, aquí interesa ver la precisión real).
function fmtMoney2(v) {
  var n = Number(v); if (!n && n !== 0) return '—';
  return '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Tabla (cuadrícula) reutilizable para las dos vistas de prorrateo.
// rows: [{label, value, pct, html?}] — html, si viene, reemplaza el texto
// plano de la primera columna (usado para el badge de sigla en "por empresa").
function lgProrrateoTable(rows, headerLabel) {
  if (!rows.length) return '<div class="empty">Sin datos.</div>';
  var body = rows.map(function(r) {
    return '<tr><td>' + (r.html || escHtml(r.label)) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney2(r.value)) + '</td>' +
      '<td style="text-align:right">' + r.pct.toFixed(2) + '%</td></tr>';
  }).join('');
  return '<div style="overflow-x:auto"><table>' +
    '<thead><tr><th>' + escHtml(headerLabel) + '</th><th style="text-align:right">Monto</th><th style="text-align:right">%</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}

var GPP_TOP_N = 10;

function renderProrrateoGastos() {
  var calc = calcularProrrateoGastos();
  renderGastoPorProducto(calc);
  renderGastoPorEmpresa(calc);
}

function clearProrrateoFiltros() {
  document.getElementById('pf-emp').value = '';
  document.getElementById('pf-desde').value = '';
  document.getElementById('pf-hasta').value = '';
  renderProrrateoGastos();
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
      return { label: sku, value: calc.porEmpresaSku[emp][sku] };
    }).sort(function(a, b) { return b.value - a.value; });

    var top = rows.slice(0, GPP_TOP_N);
    var resto = rows.slice(GPP_TOP_N);
    var otrosVal = resto.reduce(function(s, r) { return s + r.value; }, 0);
    if (otrosVal > 0) top.push({ label: 'Otros (' + resto.length + ' productos)', value: otrosVal });
    top.forEach(function(r) { r.pct = empTotal > 0 ? (r.value / empTotal * 100) : 0; });

    return '<div class="gpp-group">' +
      '<div class="gpp-group-head">' +
        '<span class="sigla-badge ' + getSiglaClass(emp) + '">' + escHtml(emp) + '</span>' +
        '<span class="gpp-group-total">' + escHtml(fmtMoney2(empTotal)) + ' <span style="color:#a0aec0;font-weight:400">(' + pctEmp.toFixed(2) + '% del total)</span></span>' +
      '</div>' +
      lgProrrateoTable(top, 'Producto') +
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

function estadoBadgeHtml(leg) {
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

// ── Tabla ──
function renderTable() {
  var fEmp = document.getElementById('f-emp').value;
  var fEstado = document.getElementById('f-estado').value;
  var fTxt = (document.getElementById('f-txt').value || '').toLowerCase().trim();

  var rows = legs.filter(function(leg) {
    if (fEstado && leg.Estado_Conciliacion !== fEstado) return false;
    if (fEmp && !empresasOf(leg.id).some(function(e) { return e.Empresa === fEmp; })) return false;
    if (fTxt) {
      var hay = [leg.Consecutivo, leg.Responsable, leg.Recorrido_Ruta, leg.Clientes]
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
    var acciones = '<button class="btn-ver" onclick="openVer(' + leg.id + ')">👁 Ver</button>';
    if (leg.Estado_Conciliacion === 'Por conciliar' && canEditMod) {
      acciones += ' <button class="btn-edit" onclick="openForm(' + leg.id + ')">✏️</button>';
    }
    if (leg.Estado_Conciliacion === 'Por conciliar' && canDel) {
      acciones += ' <button class="btn-edit" style="color:#c0392b" onclick="eliminarLegalizacion(' + leg.id + ')">🗑️</button>';
    }
    return '<tr>' +
      '<td>' + escHtml(leg.Consecutivo || '') + '</td>' +
      '<td>' + escHtml(fmtDate(leg.Fecha)) + '</td>' +
      '<td>' + escHtml(leg.Responsable || '') + '</td>' +
      '<td>' + escHtml(leg.Recorrido_Ruta || '') + '</td>' +
      '<td>' + empresasBadgesHtml(leg.id) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(total)) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(leg.Anticipo_Entregado)) + '</td>' +
      '<td>' + estadoBadgeHtml(leg) + '</td>' +
      '<td>' + acciones + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="9"><div class="empty">Sin legalizaciones para este filtro.</div></td></tr>';

  updateStats();
  renderProrrateoGastos();
}

function updateStats() {
  var porConciliar = legs.filter(function(l) { return l.Estado_Conciliacion === 'Por conciliar'; });
  var conciliadas = legs.filter(function(l) { return l.Estado_Conciliacion === 'Conciliada'; });
  document.getElementById('s-porconciliar').textContent = porConciliar.length;
  document.getElementById('s-conciliadas').textContent = conciliadas.length;
  document.getElementById('s-total').textContent = legs.length;
  var valorPend = porConciliar.reduce(function(s, l) { return s + totalGastosOf(l.id); }, 0);
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

  document.getElementById('lg-gasto-lines').innerHTML = formGastos.map(function(g, i) {
    var parsed = parseConceptoLine(g.Concepto || '');
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
      '<td><input class="ef lg-g-valor" data-line="' + i + '" type="number" min="0" step="1" value="' + (g.Valor || '') + '" style="text-align:right;width:120px" oninput="readLgGastos()"></td>' +
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
  formGastos.push({ Concepto: 'Combustible', Proveedor: '', NIT: '', DV: '', Valor: '' });
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
  document.getElementById('lg-reparto-warn').style.display = (totalGastos !== totalReparto) ? 'block' : 'none';
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
    document.getElementById('lg-ruta').value = leg.Recorrido_Ruta || '';
    document.getElementById('lg-personas').value = leg.No_Personas || '';
    document.getElementById('lg-fecha-salida').value = (leg.Fecha_Salida || '').slice(0, 10);
    document.getElementById('lg-fecha-llegada').value = (leg.Fecha_Llegada || '').slice(0, 10);
    document.getElementById('lg-anticipo').value = leg.Anticipo_Entregado || '';
    document.getElementById('lg-observaciones').value = leg.Observaciones || '';
    formGastos = itemsOf(editingLegId).map(function(it) {
      var nd = splitNitDv(it.NIT);
      return { Concepto: it.Concepto, Proveedor: it.Proveedor, NIT: nd.nit, DV: nd.dv, Valor: it.Valor };
    });
    formEmpresas = empresasOf(editingLegId).map(function(e) { return { Empresa: e.Empresa, Monto: e.Monto }; });
    formRemisiones = (leg.Remisiones_Relacionadas || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    formClientes = (leg.Clientes || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  } else {
    document.getElementById('form-titulo').textContent = 'Nueva legalización de gastos';
    document.getElementById('lg-fecha').value = today();
    setResponsableField('');
    document.getElementById('lg-ruta').value = '';
    document.getElementById('lg-personas').value = '';
    document.getElementById('lg-fecha-salida').value = '';
    document.getElementById('lg-fecha-llegada').value = '';
    document.getElementById('lg-anticipo').value = '';
    document.getElementById('lg-observaciones').value = '';
    formGastos = [{ Concepto: 'Combustible', Proveedor: '', NIT: '', DV: '', Valor: '' }];
    formEmpresas = [{ Empresa: '', Monto: '' }];
    formRemisiones = [];
    formClientes = [];
  }
  if (!formGastos.length) formGastos = [{ Concepto: 'Combustible', Proveedor: '', NIT: '', DV: '', Valor: '' }];
  if (!formEmpresas.length) formEmpresas = [{ Empresa: '', Monto: '' }];
  document.getElementById('lg-remision-nueva').value = '';
  document.getElementById('lg-cliente-nueva').value = '';
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
  return {
    Fecha: document.getElementById('lg-fecha').value || today(),
    Responsable: readResponsable(),
    Recorrido_Ruta: document.getElementById('lg-ruta').value.trim(),
    No_Personas: Number(document.getElementById('lg-personas').value) || null,
    Fecha_Salida: document.getElementById('lg-fecha-salida').value || null,
    Fecha_Llegada: document.getElementById('lg-fecha-llegada').value || null,
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
  var gastosValidos = formGastos
    .filter(function(g) { return (g.Concepto || '').trim() && Number(g.Valor) > 0; })
    .map(function(g) { return { Concepto: g.Concepto, Proveedor: g.Proveedor, NIT: joinNitDv(g.NIT, g.DV), Valor: g.Valor }; });
  if (!gastosValidos.length) { showToast('Agrega al menos una línea de gasto válida', '#e67e22'); return; }
  var empresasValidas = formEmpresas.filter(function(e) { return e.Empresa; });
  if (!empresasValidas.length) { showToast('Agrega al menos una empresa en el reparto', '#e67e22'); return; }

  var totalGastos = gastosValidos.reduce(function(s, g) { return s + (Number(g.Valor) || 0); }, 0);
  var totalReparto = empresasValidas.reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0);
  if (totalGastos !== totalReparto) {
    if (!confirm('El reparto entre empresas (' + fmtMoney(totalReparto) + ') no coincide con el total de gastos (' + fmtMoney(totalGastos) + '). ¿Guardar de todas formas?')) return;
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

  showToast('Legalización guardada correctamente', '#27ae60');
  closeForm();
  await loadLegalizaciones();
  if (res.id) openVer(res.id);
  else if (editingLegId) openVer(editingLegId);
}

async function eliminarLegalizacion(id) {
  var leg = legs.find(function(l) { return l.id === id; });
  if (!leg) return;
  if (!confirm('¿Eliminar la legalización ' + (leg.Consecutivo || '') + '? Esta acción no se puede deshacer.')) return;
  var res = await apiPost({ action: 'eliminarLegalizacionGastos', id: id });
  if (!res.ok) { showToast('Error al eliminar: ' + res.error, '#e74c3c'); return; }
  showToast('Legalización eliminada', '#e67e22');
  await loadLegalizaciones();
}

function editarDesdeVer() {
  var id = verLegId;
  closeVer();
  openForm(id);
}

// ── Ver / conciliar ──
function openVer(id) {
  verLegId = id;
  var leg = legs.find(function(l) { return l.id === id; });
  if (!leg) return;

  document.getElementById('ver-titulo').textContent = leg.Consecutivo || '';
  document.getElementById('ver-meta').textContent = 'Responsable: ' + (leg.Responsable || '—') + ' · Fecha: ' + fmtDate(leg.Fecha);

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
  } else if (AUTH.canConciliarGastos()) {
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

  document.getElementById('ver-body').innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:0.86rem;margin-bottom:14px">' +
      '<div><strong>Ruta:</strong> ' + escHtml(leg.Recorrido_Ruta || '—') + '</div>' +
      '<div><strong>Personas en ruta:</strong> ' + escHtml(leg.No_Personas || '—') + '</div>' +
      '<div><strong>Clientes:</strong> ' + escHtml(leg.Clientes || '—') + '</div>' +
      '<div><strong>Fecha salida:</strong> ' + escHtml(fmtDate(leg.Fecha_Salida)) + '</div>' +
      '<div><strong>Fecha llegada:</strong> ' + escHtml(fmtDate(leg.Fecha_Llegada)) + '</div>' +
      '<div><strong>Anticipo entregado:</strong> ' + escHtml(fmtMoney(leg.Anticipo_Entregado)) + '</div>' +
      '<div style="grid-column:span 3"><strong>Remisiones relacionadas:</strong> ' + escHtml(leg.Remisiones_Relacionadas || '—') + '</div>' +
      '<div style="grid-column:span 3"><strong>Observaciones:</strong> ' + escHtml(leg.Observaciones || '—') + '</div>' +
    '</div>' +
    '<h3 style="font-size:0.88rem;color:#1a5276;margin-bottom:6px">Líneas de gasto</h3>' +
    '<table><thead><tr><th>Concepto</th><th>Proveedor</th><th>NIT</th><th style="text-align:right">Valor</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>' +
    '<h3 style="font-size:0.88rem;color:#1a5276;margin:14px 0 6px">Reparto entre empresas</h3>' +
    '<table><thead><tr><th>Empresa</th><th style="text-align:right">Monto</th></tr></thead><tbody>' + empsHtml + '</tbody></table>' +
    '<div style="margin:10px 0 14px;font-size:0.84rem;color:#4a5568">Total gastos: <strong>' + escHtml(fmtMoney(totalGastos)) + '</strong> · Total repartido: <strong>' + escHtml(fmtMoney(totalReparto)) + '</strong></div>' +
    '<h3 style="font-size:0.88rem;color:#1a5276;margin-bottom:6px">Conciliación</h3>' +
    conciliacionHtml +
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

  var empresaPrincipal = (emps[0] && emps[0].Empresa) || '';
  var reparto = emps.map(function(e) { return getSigla(e.Empresa) + ': ' + fmtMoney(e.Monto); }).join('  ·  ');

  var data = {
    empresa: empresaPrincipal,
    consecutivo: leg.Consecutivo,
    doc_title: 'LEGALIZACION DE GASTOS',
    doc_number: leg.Consecutivo,
    date_label: 'Fecha',
    ref_label: null,
    fecha_entrega: fmtDate(leg.Fecha),
    file_prefix: 'Legalizacion_Gastos',
    copies: ['ORIGINAL - CONTABILIDAD'],
    hide_signatures: false,
    qty_header: 'Valor',
    show_valores: false,
    last_col_header: 'Observaciones',
    entregas: items.map(function(it) {
      return { producto: it.Concepto, presentacion: it.Proveedor + (it.NIT ? ' (NIT ' + it.NIT + ')' : ''), cantidad: it.Valor, observaciones: '' };
    }),
    left_fields: [
      ['Responsable', leg.Responsable || ''],
      ['Ruta', leg.Recorrido_Ruta || ''],
      ['Personas en ruta', String(leg.No_Personas || '')],
      ['Clientes', leg.Clientes || ''],
    ],
    right_fields: [
      ['Fecha salida', fmtDate(leg.Fecha_Salida)],
      ['Fecha llegada', fmtDate(leg.Fecha_Llegada)],
      ['Anticipo entregado', fmtMoney(leg.Anticipo_Entregado)],
      ['Total gastos', fmtMoney(totalGastos)],
      ['Reparto', reparto || '—'],
    ]
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

loadLegalizaciones();
