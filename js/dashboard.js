// ── Dashboard State ──
var dPedidos = [];
var dDevoluciones = [];
var dIngresos = [];
var dOrdenes = [];
var dMuestras = [];
var dReenvases = [];
var dEntregas = [];      // EntregasPedido — 1 fila por despacho (fecha real). Datos desde ago-2026.
var dCambios = [];        // CambiosMercancia
var dConteos = [];        // InventarioFisico
var dClientes = [];       // ClientesUnicos (para "clientes nuevos del período")
var dExist = null;   // snapshot de Existencias (mismo cálculo que Kardex / Inventario / Reportes)
var dOrders = [];    // órdenes derivadas: 1 por (empresa, consecutivo, cliente) — igual que Pedidos

var SIGLAS = {
  'PARCELAR DE COLOMBIA SAS': 'PARCELAR',
  'GREEN AGROSOLUCIONES DE COLOMBIA SAS': 'GREEN',
  'SOLUCIONES INTEGRALES RESO SAS': 'RESO',
  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS': 'IASO',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS': 'IAS',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS ': 'IAS',
};
var EMP_COLORS = { PARCELAR: '#2980b9', GREEN: '#27ae60', RESO: '#e67e22', IASO: '#8e44ad', IAS: '#c0392b' };
function dGetSigla(n) { return SIGLAS[(n || '').trim()] || n || '—'; }

// Rango de fechas por defecto al abrir el dashboard (fecha del pedido — desde).
var DASH_DEFAULT_DESDE = '2026-07-01';

// Valor en millones de COP, compacto para tablas: $0,5 M · $45 M · $1.046 M
function dMoneyM(v) {
  var n = (Number(v) || 0) / 1e6;
  var dec = (n !== 0 && Math.abs(n) < 10) ? 1 : 0;
  return '$' + n.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' M';
}
function dMoneyFull(v) { return '$' + (Number(v) || 0).toLocaleString('es-CO'); }

// ══════════════════════════════════════════════════════════════
// Chart.js — helpers
// ══════════════════════════════════════════════════════════════
var _dashCharts = {};   // canvasId → instancia Chart (se destruye al reconstruir)

function _destroyChart(id) {
  if (_dashCharts[id]) { try { _dashCharts[id].destroy(); } catch (e) {} delete _dashCharts[id]; }
}

// Gráfico mixto líneas/barras.
// datasets: [{ label, data, color, tipo?('bar'|'line'), yAxis?('y'|'y2'), fill? }]
// opts: { yMoney, y2, y2Money }
function dMixedChart(canvasId, labels, datasets, opts) {
  opts = opts || {};
  _destroyChart(canvasId);
  var el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return;

  var ds = datasets.map(function(d) {
    var isBar = d.tipo === 'bar';
    return {
      type: isBar ? 'bar' : 'line',
      label: d.label,
      data: d.data,
      borderColor: d.color,
      backgroundColor: isBar ? (d.color + 'cc') : (d.color + '22'),
      borderWidth: 2,
      fill: !isBar && d.fill !== false,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      yAxisID: d.yAxis || 'y',
      order: isBar ? 2 : 1
    };
  });

  var scales = {
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    y: {
      beginAtZero: true, position: 'left',
      ticks: { font: { size: 11 }, callback: function(v) { return opts.yMoney ? dMoneyM(v) : Number(v).toLocaleString('es-CO'); } },
      grid: { color: '#edf2f7' }
    }
  };
  if (opts.y2) {
    scales.y2 = {
      beginAtZero: true, position: 'right',
      ticks: { font: { size: 11 }, callback: function(v) { return opts.y2Money ? dMoneyM(v) : Number(v).toLocaleString('es-CO'); } },
      grid: { drawOnChartArea: false }
    };
  }

  _dashCharts[canvasId] = new Chart(el, {
    type: 'bar',   // base; cada dataset define su propio type ('bar' | 'line')
    data: { labels: labels, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              var val = ctx.parsed.y;
              var money = (ctx.dataset.yAxisID === 'y2') ? opts.y2Money : opts.yMoney;
              return ctx.dataset.label + ': ' + (money ? dMoneyFull(val) : Number(val).toLocaleString('es-CO'));
            }
          }
        }
      },
      scales: scales
    }
  });
}

// ══════════════════════════════════════════════════════════════
// Rango de fechas — presets + persistencia (localStorage)
// ══════════════════════════════════════════════════════════════
var DASH_LS_KEY = 'dash.filtros';
var dActivePreset = '';   // '' | 'mes' | 'mes-1' | '30' | '90' | 'anio' | 'todo'

var DASH_PRESET_LBL = {
  'mes': 'Este mes', 'mes-1': 'Mes pasado', '30': 'Últimos 30 días',
  '90': 'Últimos 90 días', 'anio': 'Este año', 'todo': 'Todo el histórico'
};

function _isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Devuelve { desde, hasta } en 'YYYY-MM-DD' para un preset ('' = abierto/hoy).
function dPresetRange(preset) {
  var now = new Date(); now.setHours(0, 0, 0, 0);
  var y = now.getFullYear(), m = now.getMonth();
  if (preset === 'mes')   return { desde: _isoDate(new Date(y, m, 1)),     hasta: _isoDate(new Date(y, m + 1, 0)) };
  if (preset === 'mes-1') return { desde: _isoDate(new Date(y, m - 1, 1)), hasta: _isoDate(new Date(y, m, 0)) };
  if (preset === '30')  { var d30 = new Date(now); d30.setDate(d30.getDate() - 29); return { desde: _isoDate(d30), hasta: _isoDate(now) }; }
  if (preset === '90')  { var d90 = new Date(now); d90.setDate(d90.getDate() - 89); return { desde: _isoDate(d90), hasta: _isoDate(now) }; }
  if (preset === 'anio')  return { desde: _isoDate(new Date(y, 0, 1)), hasta: _isoDate(now) };
  if (preset === 'todo')  return { desde: '', hasta: '' };
  return null;
}

function saveDashFilters() {
  try {
    localStorage.setItem(DASH_LS_KEY, JSON.stringify({
      emp: document.getElementById('df-emp').value,
      desde: document.getElementById('df-desde').value,
      hasta: document.getElementById('df-hasta').value,
      preset: dActivePreset
    }));
  } catch (e) { /* modo privado / storage bloqueado */ }
}

function loadDashFiltersLS() {
  try { return JSON.parse(localStorage.getItem(DASH_LS_KEY) || 'null'); } catch (e) { return null; }
}

function markActivePreset() {
  var btns = document.querySelectorAll('#df-presets .preset');
  Array.prototype.forEach.call(btns, function(b) {
    b.classList.toggle('active', b.getAttribute('data-preset') === dActivePreset);
  });
}

function applyDashPreset(preset) {
  var r = dPresetRange(preset);
  if (!r) return;
  dActivePreset = preset;
  document.getElementById('df-desde').value = r.desde;
  document.getElementById('df-hasta').value = r.hasta;
  markActivePreset();
  saveDashFilters();
  buildDashboard();
}

// ══════════════════════════════════════════════════════════════
// Coherencia con el módulo Pedidos
// ──────────────────────────────────────────────────────────────
// Una "orden" se identifica por empresa + consecutivo + CLIENTE
// (idéntico a pedidos.js:keyOf). El estado de entrega y el Estado_2
// se derivan de TODAS las líneas con la misma precedencia que
// pedidos.js (derivedStatus / derivedEstado2). Una línea cuenta
// como "pendiente" con el mismo criterio que reportes.js.
// ══════════════════════════════════════════════════════════════

function dKeyOf(emp, con, cli) { return (emp || '') + '||' + String(con || '').trim() + '||' + (cli || ''); }
function dNorm(s) { return String(s || '').toLowerCase().trim(); }

// mismo criterio que pedidos.js:derivedStatus
function dDerivedStatus(lines) {
  if (!lines.length) return 'Recibido';
  var n = lines.length, fac = 0, ent = 0, ali = 0, par = 0;
  lines.forEach(function(l) {
    var s = dNorm(l.Estado_Entrega);
    if (s === 'facturado') fac++;
    else if (s === 'entregado') ent++;
    else if (s === 'alistado') ali++;
    else if (s === 'parcial') par++;
  });
  if (fac === n) return 'Facturado';
  if (fac + ent === n) return 'Entregado';
  if (fac + ent + ali === n) return 'Alistado';
  if (fac > 0 || ent > 0 || ali > 0 || par > 0) return 'Parcial';
  return 'Recibido';
}

// mismo criterio que pedidos.js:derivedEstado2
function dDerivedEstado2(lines) {
  if (!lines.length) return 'Abierto';
  var vals = lines.map(function(l) { return (l.Estado_2 || 'Abierto').trim(); });
  if (vals.indexOf('Anulado') >= 0) return 'Anulado';
  if (vals.indexOf('Bloqueado por cartera') >= 0) return 'Bloqueado por cartera';
  if (vals.indexOf('Entregado por proveedor') >= 0) return 'Entregado por proveedor';
  if (vals.every(function(v) { return v === 'Cerrado'; })) return 'Cerrado';
  if (vals.every(function(v) { return v === 'Cerrado' || v === 'Alistado'; })) return 'Alistado';
  return 'Abierto';
}

// mismo criterio que reportes.js:buildReport para "producto pendiente"
var D_ESTADOS_NO_PENDIENTE = { 'Anulado': 1, 'Alistado': 1, 'Cerrado': 1, 'Bloqueado por cartera': 1, 'Entregado por proveedor': 1 };
function dLineaPendiente(p) {
  if (D_ESTADOS_NO_PENDIENTE[(p.Estado_2 || 'Abierto').trim()]) return false;
  return (Number(p.Cant_Pendiente) || 0) > 0;
}

// Empresas del holding visibles al usuario (mismo criterio que reportes.js).
function dHoldingEmpresas() {
  if (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas && typeof EMPRESAS_HOLDING !== 'undefined') {
    return AUTH.getFilteredEmpresas(EMPRESAS_HOLDING);
  }
  return (typeof EMPRESAS_HOLDING !== 'undefined') ? EMPRESAS_HOLDING : [];
}

// Agrega las líneas de pedido en órdenes derivadas.
function dBuildOrders(ped) {
  var map = {};
  ped.forEach(function(p) {
    var key = dKeyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente);
    if (!map[key]) {
      map[key] = {
        key: key,
        empresa: p.Nombre_Empresa || '',
        sigla: dGetSigla(p.Nombre_Empresa),
        consecutivo: p.Consecutivo || '—',
        cliente: (p.Cliente || '—').trim(),
        comercial: (p.Comercial || '').trim(),
        fechaPedido: p.Fecha_Pedido || '',
        fechaUltEntrega: p.Fecha_Ult_Entrega || '',
        lines: []
      };
    }
    var o = map[key];
    o.lines.push(p);
    if (p.Fecha_Ult_Entrega && (!o.fechaUltEntrega || p.Fecha_Ult_Entrega > o.fechaUltEntrega)) {
      o.fechaUltEntrega = p.Fecha_Ult_Entrega;
    }
    if (p.Comercial && !o.comercial) o.comercial = (p.Comercial || '').trim();
  });

  return Object.keys(map).map(function(k) {
    var o = map[k];
    o.status = dDerivedStatus(o.lines);
    o.estado2 = dDerivedEstado2(o.lines);
    o.cantPedida = o.lines.reduce(function(s, l) { return s + (Number(l.Cantidad) || 0); }, 0);
    o.cantEntregada = o.lines.reduce(function(s, l) { return s + (Number(l.Cant_Entregada) || 0); }, 0);
    // pendiente sólo de las líneas que realmente cuentan como pendientes
    o.pendUds = o.lines.reduce(function(s, l) { return s + (dLineaPendiente(l) ? (Number(l.Cant_Pendiente) || 0) : 0); }, 0);
    o.esPendiente = o.pendUds > 0;
    o.pct = o.cantPedida > 0 ? Math.round(o.cantEntregada / o.cantPedida * 100) : 0;

    // Valor ($COP). "Pedido" y "Entregado" cuentan TODAS las líneas no
    // anuladas (volumen histórico del comercial — por ahí se ordena el
    // ranking). "Pendiente" usa el MISMO criterio que reportes.js ›
    // "Valorización ventas": solo líneas con Cant_Pendiente > 0 y Estado_2
    // fuera de {Anulado, Alistado, Cerrado, Bloqueado por cartera, Entregado
    // por proveedor}. Por eso Pendiente ≠ Pedido − Entregado: los pedidos ya
    // cerrados siguen sumando a Pedido pero no a Pendiente.
    o.valorPedido = 0; o.valorEntregado = 0; o.valorPendiente = 0;
    o.lineasSinPrecio = 0;
    o.lines.forEach(function(l) {
      if ((l.Estado_2 || 'Abierto').trim() === 'Anulado') return;
      var vu = Number(l.Valor_Unitario) || 0;
      var cant = Number(l.Cantidad) || 0;
      o.valorPedido += Number(l.Valor_Total) || (vu * cant);
      o.valorEntregado += vu * (Number(l.Cant_Entregada) || 0);
      if (dLineaPendiente(l)) o.valorPendiente += vu * (Number(l.Cant_Pendiente) || 0);
      if (vu === 0 && cant > 0) o.lineasSinPrecio++;
    });
    return o;
  });
}

// ── Load ──
async function loadDashboard() {
  await _authReady;
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
      apiGet('getPedidos', { columns: 'Nombre_Empresa,Cliente,NIT,Departamento,Cant_Entregada,Cantidad,Estado_2,Estado_Entrega,Consecutivo,Fecha_Ult_Entrega,Fecha_Pedido,Producto,Comercial,Valor_Unitario,Valor_Total' }),
      apiGet('getDevoluciones', { columns: 'Empresa,Estado,Motivo,Fecha,Cantidad,Valor_Total' }).catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getIngresos', { columns: 'Empresa_Origen,Empresa_Destino,Cantidad,Fecha' }).catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Empresa_Destino,Empresa_Origen,Consecutivo,Estado,Fecha,Estado_Aprobacion,Fecha_Aprobacion,creado_en,Total_Orden,Valor_Total,Tipo,Cantidad' }).catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras', { columns: 'Empresa,Estado,Fecha_Solicitud,Fecha_Despacho,Cantidad' }).catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases', { columns: 'Empresa,Cantidad,Fecha,Estado' }).catch(function() { return { ok: true, reenvases: [] }; }),
      apiGet('getEntregasPedido', { columns: 'empresa_pedido,empresa_stock,producto,cantidad,fecha' }).catch(function() { return { ok: true, entregas: [] }; }),
      apiGet('getCambios', { columns: 'Empresa,Estado,Fecha_Solicitud,Producto,Cantidad' }).catch(function() { return { ok: true, cambios: [] }; }),
      apiGet('getInventarioFisico', { columns: 'Empresa,Producto,Presentacion,Cantidad_Fisica,Cantidad_Sistema,Diferencia,Fecha_Conteo,Observaciones' }).catch(function() { return { ok: true, conteos: [] }; }),
      apiGet('getClientesAll', { columns: 'Cliente,Identificacion,Nombre_Empresa,Cliente_Nuevo,creado_en' }).catch(function() { return { ok: true, clientes: [] }; })
    ]);

    if (!results[0].ok) throw new Error(results[0].error || 'Error al cargar pedidos');

    dPedidos = (results[0].pedidos || []).filter(function(p) {
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente';
    }).map(function(p) {
      if (!p.Cant_Entregada && p.Cant_Entregada !== 0) {
        p.Cant_Entregada = 0;
        p.Cant_Pendiente = Number(p.Cantidad) || 0;
        p.Estado_Entrega = 'Recibido';
      }
      if (!p.Estado_2) p.Estado_2 = 'Abierto';
      p.Cant_Pendiente = Math.max(0, (Number(p.Cantidad) || 0) - (Number(p.Cant_Entregada) || 0));
      return p;
    });

    dDevoluciones = results[1].devoluciones || [];
    dIngresos = results[2].ingresos || [];
    dOrdenes = results[3].ordenes || [];
    dMuestras = results[4].muestras || [];
    dReenvases = results[5].reenvases || [];
    dEntregas = results[6].entregas || [];
    dCambios = results[7].cambios || [];
    dConteos = results[8].conteos || [];
    dClientes = results[9].clientes || [];

    // Snapshot de existencias — mismo cálculo que Kardex / Inventario / Reportes.
    try {
      if (typeof Existencias !== 'undefined' && Existencias.loadSnapshot) {
        dExist = await Existencias.loadSnapshot();
      }
    } catch (e) {
      dExist = null;
      console.warn('No se pudo cargar snapshot de existencias:', e);
    }

    // #main visible ANTES de construir: los <canvas> de Chart.js necesitan
    // que su contenedor tenga tamaño para dimensionarse bien.
    loadZone.style.display = 'none';
    mainEl.style.display = 'block';

    populateDashFilters();
    buildDashboard();

    setSyncStatus('ok', 'Conectado a la nube. Ultima actualizacion: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase';
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

// ── Filters ──
var dashFiltersAttached = false;
function populateDashFilters() {
  var emps = [];
  dPedidos.forEach(function(p) {
    if (p.Nombre_Empresa && emps.indexOf(p.Nombre_Empresa) < 0 && AUTH.hasCompany(p.Nombre_Empresa)) emps.push(p.Nombre_Empresa);
  });
  emps.sort();
  var sel = document.getElementById('df-emp');
  sel.innerHTML = '<option value="">Todas</option>' + emps.map(function(e) {
    return '<option value="' + escHtml(e) + '">' + escHtml(dGetSigla(e)) + ' — ' + escHtml(e) + '</option>';
  }).join('');

  if (!dashFiltersAttached) {
    var dDesde = document.getElementById('df-desde');
    var dHasta = document.getElementById('df-hasta');

    // Restaurar filtros guardados; si no hay, arrancar en DASH_DEFAULT_DESDE.
    var ls = loadDashFiltersLS();
    if (ls) {
      if (ls.emp && AUTH.hasCompany(ls.emp)) sel.value = ls.emp;
      dActivePreset = ls.preset || '';
      if (dActivePreset && dActivePreset !== 'todo') {
        var r = dPresetRange(dActivePreset);   // re-resolver por si cambió el mes
        if (r) { dDesde.value = r.desde; dHasta.value = r.hasta; }
      } else {
        dDesde.value = ls.desde || '';
        dHasta.value = ls.hasta || '';
      }
    } else {
      dDesde.value = DASH_DEFAULT_DESDE;
    }

    // Cambios manuales de empresa / fechas: se pierde el preset activo.
    function onManualFilterChange() {
      dActivePreset = '';
      markActivePreset();
      saveDashFilters();
      buildDashboard();
    }
    sel.addEventListener('change', onManualFilterChange);
    dDesde.addEventListener('change', onManualFilterChange);
    dHasta.addEventListener('change', onManualFilterChange);

    Array.prototype.forEach.call(document.querySelectorAll('#df-presets .preset'), function(b) {
      b.addEventListener('click', function() { applyDashPreset(b.getAttribute('data-preset')); });
    });

    markActivePreset();
    dashFiltersAttached = true;
  }
}

function clearDashFilters() {
  document.getElementById('df-emp').value = '';
  document.getElementById('df-desde').value = DASH_DEFAULT_DESDE;
  document.getElementById('df-hasta').value = '';
  dActivePreset = '';
  markActivePreset();
  saveDashFilters();
  buildDashboard();
}

// Rango por prefijo YYYY-MM-DD (la fecha puede venir con hora / Date serializada).
function _fechaEnRango(fecha, desde, hasta) {
  if (!desde && !hasta) return true;
  var f10 = String(fecha || '').slice(0, 10);
  if (desde && f10 < desde) return false;
  if (hasta && f10 > hasta) return false;
  return true;
}

// Ventana inmediatamente anterior, de igual longitud (para el comparativo).
function dRangoPrevio(desde, hasta) {
  if (!desde || !hasta) return null;
  var d1 = new Date(desde + 'T00:00:00'), d2 = new Date(hasta + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2) || d2 < d1) return null;
  var dias = Math.round((d2 - d1) / 86400000) + 1;
  var pHasta = new Date(d1); pHasta.setDate(pHasta.getDate() - 1);
  var pDesde = new Date(pHasta); pDesde.setDate(pDesde.getDate() - (dias - 1));
  return { desde: _isoDate(pDesde), hasta: _isoDate(pHasta), dias: dias };
}

// Filtra todas las fuentes por empresa + un rango de fechas dado.
function dSlice(fEmp, desde, hasta) {
  function r(f) { return _fechaEnRango(f, desde, hasta); }
  var ped = dPedidos.filter(function(p) { return (!fEmp || p.Nombre_Empresa === fEmp) && r(p.Fecha_Pedido); });
  return {
    ped: ped,
    orders: dBuildOrders(ped),
    dev: dDevoluciones.filter(function(d) { return (!fEmp || d.Empresa === fEmp) && r(d.Fecha); }),
    oc: dOrdenes.filter(function(o) { return (!fEmp || o.Empresa_Destino === fEmp || o.Empresa_Origen === fEmp) && r(o.Fecha); }),
    mue: dMuestras.filter(function(m) { return (!fEmp || m.Empresa === fEmp) && r(m.Fecha_Solicitud); }),
    ree: dReenvases.filter(function(x) { return (!fEmp || x.Empresa === fEmp) && r(x.Fecha); }),
    ing: dIngresos.filter(function(i) { return (!fEmp || i.Empresa_Origen === fEmp || i.Empresa_Destino === fEmp) && r(i.Fecha); }),
    cam: dCambios.filter(function(c) { return (!fEmp || c.Empresa === fEmp) && r(c.Fecha_Solicitud); }),
    ent: dEntregas.filter(function(e) { return (!fEmp || e.empresa_pedido === fEmp) && r(e.fecha); })
  };
}

// ── Build Dashboard ──
function buildDashboard() {
  var fEmp = document.getElementById('df-emp').value;
  var fDesde = document.getElementById('df-desde').value;   // 'YYYY-MM-DD' | ''
  var fHasta = document.getElementById('df-hasta').value;   // 'YYYY-MM-DD' | ''

  var cur = dSlice(fEmp, fDesde, fHasta);
  dOrders = cur.orders;

  // Comparativo: ventana anterior de igual longitud (solo con rango acotado).
  var prevR = dRangoPrevio(fDesde, fHasta);
  var kpiPrev = null, prevSlice = null;
  if (prevR) {
    prevSlice = dSlice(fEmp, prevR.desde, prevR.hasta);
    kpiPrev = dKpiSnapshot(prevSlice.orders, prevSlice.ped, prevSlice.dev, prevSlice.oc);
  }

  var rangoTxt = (fDesde || fHasta)
    ? '  ·  Rango: ' + (fDesde ? fmtDate(fDesde) : 'inicio') + ' → ' + (fHasta ? fmtDate(fHasta) : 'hoy')
    : '';
  document.getElementById('dash-ts').textContent = 'Actualizado: ' + new Date().toLocaleString('es-CO') + rangoTxt;
  renderRangeChip(fEmp, fDesde, fHasta);

  buildKPIs(cur.orders, cur.ped, cur.dev, cur.oc, fEmp, kpiPrev);
  buildKPIsMoney(cur.orders, cur.ped, cur.dev, fEmp, fDesde, fHasta, kpiPrev);
  buildPedidosPorMes(fEmp);
  buildEntregasPorMes(fEmp);
  buildVentasPorCategoria(cur.ped);
  buildVentasPorDepartamento(cur.ped);
  buildTiempos(cur.orders);
  buildTopDemora(cur.orders);
  buildEntregas(cur.orders);
  buildEmpresas(cur.orders);
  buildTopProductos(cur.ped);
  buildTopClientes(cur.orders);
  buildDevoluciones(cur.dev, cur.orders, fEmp);
  buildTopComerciales(cur.orders);
  buildInventario(cur.ped, fEmp);
  buildResumenModulos(cur.orders, cur.dev, cur.ing, cur.oc, cur.mue, cur.ree, cur.cam, fEmp);
  buildExactitudInventario(fEmp);
  buildTopDescuadre(fEmp);
  buildCobertura(cur.ent, fEmp, fDesde, fHasta);
  buildAlertasStock(cur.ped, cur.ent, fEmp);
  buildOrdenesCompra(cur.oc);
  buildOtrosModulos(cur.cam, cur.mue, cur.ree);
  buildCalidadDatos(cur.ped, fEmp);
  buildClientesNuevos(fEmp, fDesde, fHasta);
}

// ── Existencias (snapshot Kardex) ──
// Suma de saldos por (producto) sobre las empresas del holding visibles,
// opcionalmente filtrado a una empresa. Devuelve { productos, uds, porEmp }.
function dStockTotals(fEmp) {
  var saldos = (dExist && dExist.saldos) || {};
  var empresas = dHoldingEmpresas();
  var porEmp = {};
  empresas.forEach(function(e) { if (!fEmp || e.value === fEmp) porEmp[e.sigla] = 0; });

  var productos = 0, uds = 0, negativos = 0;
  Object.keys(saldos).forEach(function(prodKey) {
    var perEmp = saldos[prodKey] || {};
    var totProd = 0;
    empresas.forEach(function(e) {
      if (fEmp && e.value !== fEmp) return;
      var v = perEmp[e.value] || 0;
      totProd += v;
      if (v !== 0) porEmp[e.sigla] += v;
    });
    if (totProd > 0) { productos++; uds += totProd; }
    else if (totProd < 0) { negativos++; }
  });

  return { productos: productos, uds: uds, negativos: negativos, porEmp: porEmp, disponible: dExist != null };
}

// ── Chip de rango + empresa activos (encima de los KPI) ──
function renderRangeChip(fEmp, fDesde, fHasta) {
  var el = document.getElementById('dash-range-chip');
  if (!el) return;
  var rango;
  if (dActivePreset && DASH_PRESET_LBL[dActivePreset]) rango = DASH_PRESET_LBL[dActivePreset];
  else if (!fDesde && !fHasta) rango = 'Todo el histórico';
  else rango = (fDesde ? fmtDate(fDesde) : 'inicio') + ' → ' + (fHasta ? fmtDate(fHasta) : 'hoy');
  var empTxt = fEmp
    ? ' · <span class="emp">' + escHtml(dGetSigla(fEmp)) + '</span>'
    : ' · Todas las empresas';
  el.innerHTML = '<span class="dash-range-chip">📅 ' + escHtml(rango) + empTxt + '</span>';
}

// ── Comparativo vs período anterior ──
// Cifras "de volumen" del período (aditivas) — se comparan con la ventana previa.
function dKpiSnapshot(orders, ped, dev, oc) {
  var udsEnt = 0, udsPed = 0, valPed = 0, valEnt = 0, valPen = 0;
  ped.forEach(function(p) {
    if ((p.Estado_2 || 'Abierto').trim() === 'Anulado') return;
    udsEnt += Number(p.Cant_Entregada) || 0;
    udsPed += Number(p.Cantidad) || 0;
  });
  var deliveryDays = [];
  orders.forEach(function(o) {
    valPed += o.valorPedido; valEnt += o.valorEntregado; valPen += o.valorPendiente;
    if (o.fechaUltEntrega && o.fechaPedido && o.cantEntregada > 0) {
      var dd = Math.round((new Date(o.fechaUltEntrega) - new Date(o.fechaPedido)) / 86400000);
      if (!isNaN(dd) && dd >= 0) deliveryDays.push(dd);
    }
  });
  return {
    ordenes: orders.length,
    lineas: ped.length,
    tasaEntrega: udsPed > 0 ? Math.round(udsEnt / udsPed * 100) : 0,
    avgDelivery: deliveryDays.length ? Math.round(deliveryDays.reduce(function(s, v) { return s + v; }, 0) / deliveryDays.length) : 0,
    devoluciones: dev.length,
    valorPedido: valPed,
    valorEntregado: valEnt,
    valorPendiente: valPen
  };
}

// Devuelve { txt, cls('up'|'down'|'flat'), arrow } o null si no hay base.
function dDelta(cur, prev, moreIsGood) {
  if (prev == null || !isFinite(prev) || prev === 0) return null;
  var pct = Math.round((cur - prev) / Math.abs(prev) * 100);
  if (pct === 0) return { txt: '0%', cls: 'flat', arrow: '→' };
  var up = pct > 0;
  var good = moreIsGood ? up : !up;
  return { txt: (up ? '+' : '') + pct + '%', cls: good ? 'up' : 'down', arrow: up ? '▲' : '▼' };
}

// ── 1. KPI Cards ──
function buildKPIs(orders, ped, dev, oc, fEmp, prev) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var totalOrdenes = orders.length;
  var abiertas = orders.filter(function(o) { return o.estado2 === 'Abierto'; }).length;
  var lineas = ped.length;

  // Tasa de entrega: uds entregadas / pedidas sobre líneas no anuladas.
  var udsEntregadas = 0, udsPedidas = 0;
  ped.forEach(function(p) {
    if ((p.Estado_2 || 'Abierto').trim() === 'Anulado') return;
    udsEntregadas += Number(p.Cant_Entregada) || 0;
    udsPedidas += Number(p.Cantidad) || 0;
  });
  var tasaEntrega = udsPedidas > 0 ? Math.round((udsEntregadas / udsPedidas) * 100) : 0;

  // Tiempos por orden.
  var deliveryDays = [], delayDays = [];
  orders.forEach(function(o) {
    if (o.fechaUltEntrega && o.fechaPedido && o.cantEntregada > 0) {
      var dd = Math.round((new Date(o.fechaUltEntrega) - new Date(o.fechaPedido)) / 86400000);
      if (!isNaN(dd) && dd >= 0) deliveryDays.push(dd);
    }
    if (o.estado2 === 'Abierto' && o.esPendiente && o.fechaPedido) {
      var dd2 = Math.round((today - new Date(o.fechaPedido)) / 86400000);
      if (!isNaN(dd2) && dd2 >= 0) delayDays.push(dd2);
    }
  });

  var devPendientes = dev.filter(function(d) { return (d.Estado || '') === 'Pendiente'; }).length;
  var avgDelivery = deliveryDays.length ? Math.round(deliveryDays.reduce(function(s, v) { return s + v; }, 0) / deliveryDays.length) : 0;
  var avgDelay = delayDays.length ? Math.round(delayDays.reduce(function(s, v) { return s + v; }, 0) / delayDays.length) : 0;

  var stk = dStockTotals(fEmp);

  var stockSub = stk.disponible
    ? (stk.uds.toLocaleString('es-CO') + ' uds disponibles' + (stk.negativos ? ' · ⚠️ ' + stk.negativos + ' con saldo negativo' : ''))
    : 'sin snapshot';

  var p = prev || null;

  var empQS = fEmp ? ('&empresa=' + encodeURIComponent(dGetSigla(fEmp))) : '';
  var p = prev || null;

  var html = '';
  html += kpiCard('', totalOrdenes.toLocaleString('es-CO'), 'Total ordenes', abiertas + ' abiertas · ' + lineas.toLocaleString('es-CO') + ' lineas',
    p && dDelta(totalOrdenes, p.ordenes, true), 'pedidos.html' + (empQS ? '?' + empQS.slice(1) : ''));
  html += kpiCard('teal', tasaEntrega + '%', 'Tasa de entrega (a hoy)', udsEntregadas.toLocaleString('es-CO') + ' / ' + udsPedidas.toLocaleString('es-CO') + ' uds acumuladas',
    p && dDelta(tasaEntrega, p.tasaEntrega, true));
  html += kpiCard('green', avgDelivery + ' dias', 'Tiempo prom. entrega', deliveryDays.length + ' ordenes entregadas',
    p && dDelta(avgDelivery, p.avgDelivery, false));
  html += kpiCard('orange', avgDelay + ' dias', 'Antiguedad prom. de pendientes', delayDays.length + ' ordenes esperando');
  html += kpiCard('red', devPendientes.toString(), 'Devoluciones pendientes', dev.length + ' total devoluciones',
    null, 'devoluciones.html');
  html += kpiCard('purple', stk.disponible ? stk.productos.toLocaleString('es-CO') : '—', 'Productos en stock', stockSub,
    null, 'kardex.html');

  var ocOrds = dOrdenesCompraAgrupadas(oc);
  var ocAbiertas = ocOrds.filter(function(o) { return (o.estado || '') === 'Abierta'; }).length;
  html += kpiCard('', ocAbiertas.toString(), 'OC abiertas', ocOrds.length + ' ordenes de compra total',
    null, 'ordenes.html');

  document.getElementById('kpi-main').innerHTML = html;
}

function kpiCard(cls, val, lbl, sub, delta, href) {
  var d = delta
    ? '<div class="kpi-delta ' + delta.cls + '">' + delta.arrow + ' ' + delta.txt +
      ' <span style="color:#a0aec0;font-weight:600">vs prev.</span></div>'
    : '';
  var attrs = href
    ? ' data-href="' + escHtml(href) + '" onclick="dGoto(this)" role="link" tabindex="0" style="cursor:pointer"'
    : '';
  return '<div class="kpi ' + cls + '"' + attrs + '>' +
    '<div class="kpi-val">' + val + '</div>' +
    '<div class="kpi-lbl">' + lbl + '</div>' +
    (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + d +
  '</div>';
}

// Navega a un módulo desde una tarjeta/fila del dashboard.
function dGoto(el) {
  var href = el && el.getAttribute('data-href');
  if (href) location.href = href;
}

// ══════════════════════════════════════════════════════════════
// KPI ROW 2 — Pesos / comercial
// ══════════════════════════════════════════════════════════════
function buildKPIsMoney(orders, ped, dev, fEmp, fDesde, fHasta, prev) {
  var cur = dKpiSnapshot(orders, ped, dev, []);
  var p = prev || null;

  // Ticket promedio por orden.
  var ticket = orders.length ? cur.valorPedido / orders.length : 0;

  // $ bloqueado por cartera (dentro del rango).
  var valBloq = 0;
  orders.forEach(function(o) { if (o.estado2 === 'Bloqueado por cartera') valBloq += o.valorPedido; });

  // Concentración: % del $ pedido en el top-5 de clientes del período.
  var porCliente = {};
  orders.forEach(function(o) {
    if (!o.cliente || o.cliente === '—') return;
    porCliente[o.cliente] = (porCliente[o.cliente] || 0) + o.valorPedido;
  });
  var vals = Object.keys(porCliente).map(function(k) { return porCliente[k]; }).sort(function(a, b) { return b - a; });
  var top5 = vals.slice(0, 5).reduce(function(s, v) { return s + v; }, 0);
  var totCli = vals.reduce(function(s, v) { return s + v; }, 0);
  var conc = totCli > 0 ? Math.round(top5 / totCli * 100) : 0;
  var concCls = conc > 60 ? 'red' : conc >= 40 ? 'orange' : 'green';

  var html = '';
  html += kpiCard('teal', dMoneyM(cur.valorPedido), '$ Pedido del período', cur.ordenes + ' ordenes · ticket ' + dMoneyFull(Math.round(ticket)),
    p && dDelta(cur.valorPedido, p.valorPedido, true));
  html += kpiCard('green', dMoneyM(cur.valorEntregado), '$ Entregado del período', cur.valorPedido > 0 ? Math.round(cur.valorEntregado / cur.valorPedido * 100) + '% de lo pedido' : '—',
    p && dDelta(cur.valorEntregado, p.valorEntregado, true));
  html += kpiCard('orange', dMoneyM(cur.valorPendiente), '$ Pendiente por despachar', 'mismo criterio que Reportes › Valorización',
    p && dDelta(cur.valorPendiente, p.valorPendiente, false));
  html += kpiCard(concCls, conc + '%', 'Concentración top-5 clientes', 'del $ pedido del período');
  html += kpiCard('red', dMoneyM(valBloq), '$ bloqueado por cartera', 'ordenes en Estado_2 "Bloqueado por cartera"');

  document.getElementById('kpi-money').innerHTML = html;
}

// ── 2. Estado de Entregas ──
function buildEntregas(orders) {
  var b = { recibidos: 0, parciales: 0, entregados: 0, alistados: 0, cerrados: 0, anulados: 0, bloqueados: 0, entProv: 0 };

  orders.forEach(function(o) {
    switch (o.estado2) {
      case 'Anulado': b.anulados++; return;
      case 'Bloqueado por cartera': b.bloqueados++; return;
      case 'Entregado por proveedor': b.entProv++; return;
      case 'Cerrado': b.cerrados++; return;
      case 'Alistado': b.alistados++; return;
    }
    // Abierto → por estado de entrega derivado
    if (o.status === 'Entregado' || o.status === 'Facturado') b.entregados++;
    else if (o.status === 'Alistado') b.alistados++;
    else if (o.status === 'Parcial') b.parciales++;
    else b.recibidos++;
  });

  var total = orders.length;

  var segData = [
    { label: 'Recibidos', val: b.recibidos, color: '#e67e22' },
    { label: 'Parciales', val: b.parciales, color: '#2980b9' },
    { label: 'Entregados', val: b.entregados, color: '#27ae60' },
    { label: 'Alistados', val: b.alistados, color: '#7b1fa2' },
    { label: 'Cerrados', val: b.cerrados, color: '#1565c0' },
    { label: 'Ent. proveedor', val: b.entProv, color: '#00695c' },
    { label: 'Bloqueados', val: b.bloqueados, color: '#e65100' },
    { label: 'Anulados', val: b.anulados, color: '#e74c3c' },
  ];

  document.getElementById('ent-sub').textContent = total + ' ordenes total';
  document.getElementById('chart-entregas').innerHTML = renderSegBar(segData, total);
}

function renderSegBar(data, total) {
  if (!total) return '<div style="color:#a0aec0;text-align:center;padding:20px">Sin datos</div>';

  var barHtml = '<div class="seg-bar">';
  data.forEach(function(d) {
    var pct = (d.val / total) * 100;
    if (pct > 0) {
      barHtml += '<div class="seg" style="width:' + pct + '%;background:' + d.color + '">' + (pct >= 8 ? d.val : '') + '</div>';
    }
  });
  barHtml += '</div>';

  barHtml += '<div class="seg-legend">';
  data.forEach(function(d) {
    if (d.val > 0) {
      barHtml += '<div class="seg-legend-item"><div class="seg-legend-dot" style="background:' + d.color + '"></div>' +
        d.label + ': <span class="seg-legend-val">' + d.val + '</span> (' + Math.round((d.val / total) * 100) + '%)</div>';
    }
  });
  barHtml += '</div>';

  return barHtml;
}

// ── 3. Pedidos por Empresa ──
function buildEmpresas(orders) {
  var empMap = {};
  orders.forEach(function(o) {
    if (!empMap[o.sigla]) empMap[o.sigla] = { ordenes: 0, uds: 0 };
    empMap[o.sigla].ordenes++;
    empMap[o.sigla].uds += o.cantPedida;
  });

  var empArr = Object.keys(empMap).map(function(s) { return { sigla: s, ordenes: empMap[s].ordenes, uds: empMap[s].uds }; });
  empArr.sort(function(a, b) { return b.uds - a.uds; });

  var maxVal = empArr.length ? empArr[0].uds : 1;

  document.getElementById('emp-sub').textContent = empArr.length + ' empresas';

  var html = '<div class="hbar-chart">';
  empArr.forEach(function(e) {
    var pct = maxVal > 0 ? Math.max(3, (e.uds / maxVal) * 100) : 3;
    var color = EMP_COLORS[e.sigla] || '#718096';
    html += '<div class="hbar-row">' +
      '<div class="hbar-label">' + escHtml(e.sigla) + '</div>' +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%;background:' + color + '">' + e.ordenes + ' ord</div></div>' +
      '<div class="hbar-value">' + e.uds.toLocaleString('es-CO') + ' uds</div>' +
    '</div>';
  });
  html += '</div>';

  document.getElementById('chart-empresas').innerHTML = html;
}

// ── 4. Top Productos Pendientes ──
function buildTopProductos(ped) {
  var map = {};
  ped.forEach(function(p) {
    if (!dLineaPendiente(p)) return;
    var prod = (p.Producto || '').toUpperCase().trim();
    if (!prod) return;
    if (!map[prod]) map[prod] = { producto: prod, pendiente: 0, pedido: 0 };
    map[prod].pendiente += Number(p.Cant_Pendiente) || 0;
    map[prod].pedido += Number(p.Cantidad) || 0;
  });

  var arr = Object.values(map);
  arr.sort(function(a, b) { return b.pendiente - a.pendiente; });
  arr = arr.slice(0, 10);

  var tbody = document.getElementById('tb-productos');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin pendientes</td></tr>';
    return;
  }

  tbody.innerHTML = arr.map(function(r) {
    var avance = r.pedido > 0 ? Math.round(((r.pedido - r.pendiente) / r.pedido) * 100) : 0;
    return '<tr data-href="pedidos.html?prod=' + encodeURIComponent(r.producto) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.producto) + '</td>' +
      '<td class="money" style="color:#e74c3c;font-weight:700">' + r.pendiente.toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + r.pedido.toLocaleString('es-CO') + '</td>' +
      '<td style="text-align:center"><div class="prog" style="margin:0 auto"><div class="prog-bar"><div class="prog-fill" style="width:' + avance + '%"></div></div><div class="prog-pct">' + avance + '%</div></div></td>' +
    '</tr>';
  }).join('');
}

// ── 5. Top Clientes por Volumen ──
function buildTopClientes(orders) {
  var map = {};
  orders.forEach(function(o) {
    var cli = o.cliente;
    if (!cli || cli === '—') return;
    if (!map[cli]) map[cli] = { cliente: cli, uds: 0, ordenes: 0, empresas: {} };
    map[cli].uds += o.cantPedida;
    map[cli].ordenes++;
    map[cli].empresas[o.sigla] = true;
  });

  var arr = Object.values(map);
  arr.sort(function(a, b) { return b.uds - a.uds; });
  arr = arr.slice(0, 10);

  var tbody = document.getElementById('tb-clientes');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = arr.map(function(r) {
    var empTags = Object.keys(r.empresas).sort().map(function(s) {
      var color = EMP_COLORS[s] || '#718096';
      return '<span class="sigla-badge" style="background:' + color + '20;color:' + color + '">' + escHtml(s) + '</span>';
    }).join(' ');
    return '<tr data-href="clientes.html?buscar=' + encodeURIComponent(r.cliente) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.cliente) + '</td>' +
      '<td class="money" style="font-weight:700;color:#2980b9">' + r.uds.toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + r.ordenes + '</td>' +
      '<td>' + empTags + '</td>' +
    '</tr>';
  }).join('');
}

// ── 6. Devoluciones ──
function buildDevoluciones(dev, orders, fEmp) {
  var pendientes = 0, tramitadas = 0;
  var motivoMap = {};

  dev.forEach(function(d) {
    if ((d.Estado || '') === 'Tramitada') { tramitadas++; }
    else { pendientes++; }
    var motivo = (d.Motivo || 'Sin motivo').trim();
    if (!motivoMap[motivo]) motivoMap[motivo] = 0;
    motivoMap[motivo]++;
  });

  // Serie mensual (todo el histórico de la empresa filtrada) + tasa del período.
  buildDevolucionesPorMes(fEmp);
  var valDevPeriodo = dev.reduce(function(s, d) { return s + (Number(d.Valor_Total) || 0); }, 0);
  var valEntPeriodo = (orders || []).reduce(function(s, o) { return s + o.valorEntregado; }, 0);
  var tasaDev = valEntPeriodo > 0 ? (valDevPeriodo / valEntPeriodo * 100) : 0;

  var total = pendientes + tramitadas;
  document.getElementById('dev-sub').textContent = total + ' en el período · tasa ' +
    tasaDev.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '% del $ entregado';

  if (!total) {
    document.getElementById('chart-devoluciones').innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">Sin devoluciones registradas</div>';
    return;
  }

  var segData = [
    { label: 'Pendientes', val: pendientes, color: '#e67e22' },
    { label: 'Tramitadas', val: tramitadas, color: '#27ae60' },
  ];

  var html = renderSegBar(segData, total);

  var motivoArr = Object.keys(motivoMap).map(function(m) { return { motivo: m, count: motivoMap[m] }; });
  motivoArr.sort(function(a, b) { return b.count - a.count; });
  if (motivoArr.length > 5) motivoArr = motivoArr.slice(0, 5);

  if (motivoArr.length) {
    html += '<div style="margin-top:16px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600;margin-bottom:8px">Top motivos</div>';
    var maxMotivo = motivoArr[0].count;
    motivoArr.forEach(function(m) {
      var pct = Math.max(5, (m.count / maxMotivo) * 100);
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">' +
        '<div style="width:120px;font-size:0.78rem;color:#4a5568;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(m.motivo) + '">' + escHtml(m.motivo) + '</div>' +
        '<div style="flex:1;height:18px;background:#f0f4f8;border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:#e74c3c;border-radius:4px"></div></div>' +
        '<div style="width:30px;font-size:0.78rem;font-weight:700;color:#2d3748">' + m.count + '</div>' +
      '</div>';
    });
    html += '</div>';
  }

  document.getElementById('chart-devoluciones').innerHTML = html;
}

// ── 7. Top Comerciales (pedidos y valor por comercial) ──
function buildTopComerciales(orders) {
  var map = {};
  var sinComercial = 0, sinPrecio = 0;
  var totPed = 0, totPen = 0;

  orders.forEach(function(o) {
    sinPrecio += o.lineasSinPrecio;
    var com = o.comercial;
    if (!com) { sinComercial++; return; }
    if (!map[com]) map[com] = { comercial: com, ordenes: 0, vPed: 0, vEnt: 0, vPen: 0 };
    var m = map[com];
    m.ordenes++;
    m.vPed += o.valorPedido;
    m.vEnt += o.valorEntregado;
    m.vPen += o.valorPendiente;
    totPed += o.valorPedido;
    totPen += o.valorPendiente;
  });

  var arr = Object.values(map);
  arr.sort(function(a, b) { return b.vPed - a.vPed; });
  arr = arr.slice(0, 10);

  var subEl = document.getElementById('com-sub');
  if (subEl) subEl.textContent = 'Pedido ' + dMoneyM(totPed) + ' · pendiente ' + dMoneyM(totPen);

  var notaEl = document.getElementById('com-nota');
  if (notaEl) {
    var notas = ['"Pendiente" = ventas aún por despachar: excluye pedidos anulados, cerrados, alistados y bloqueados por cartera (mismo criterio que Reportes › Valorización ventas). Por eso no cuadra con Pedido − Entregado.'];
    if (sinPrecio > 0) notas.push('⚠️ ' + sinPrecio.toLocaleString('es-CO') + ' línea(s) sin precio no suman al valor');
    if (sinComercial > 0) notas.push(sinComercial.toLocaleString('es-CO') + ' orden(es) sin comercial asignado');
    notaEl.textContent = notas.join(' · ');
    notaEl.style.display = notas.length ? 'block' : 'none';
  }

  var tbody = document.getElementById('tb-comerciales');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:20px">Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = arr.map(function(r) {
    var pct = r.vPed > 0 ? Math.round((r.vEnt / r.vPed) * 100) : 0;
    var penColor = pct >= 75 ? '#27ae60' : pct >= 40 ? '#e67e22' : '#e74c3c';
    return '<tr data-href="pedidos.html?buscar=' + encodeURIComponent(r.comercial) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.comercial) + '">' + escHtml(r.comercial) + '</td>' +
      '<td class="money">' + r.ordenes + '</td>' +
      '<td class="money" style="font-weight:700;color:#2980b9">' + dMoneyM(r.vPed) + '</td>' +
      '<td class="money" style="color:#27ae60">' + dMoneyM(r.vEnt) + '</td>' +
      '<td class="money" style="font-weight:700;color:' + penColor + '">' + dMoneyM(r.vPen) + '</td>' +
    '</tr>';
  }).join('');
}

// ── 8. Inventario (snapshot Kardex + comprometido de pedidos) ──
function buildInventario(ped, fEmp) {
  var el = document.getElementById('chart-inventario');

  if (!dExist) {
    el.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">No se pudo cargar el snapshot de existencias</div>';
    return;
  }

  var stk = dStockTotals(fEmp);

  // Comprometido: pendiente de pedidos por empresa (mismo criterio que reportes.js).
  var pendByEmp = {};
  ped.forEach(function(p) {
    if (!dLineaPendiente(p)) return;
    var sigla = dGetSigla(p.Nombre_Empresa);
    pendByEmp[sigla] = (pendByEmp[sigla] || 0) + (Number(p.Cant_Pendiente) || 0);
  });

  var empresas = dHoldingEmpresas().filter(function(e) { return !fEmp || e.value === fEmp; });
  var totalStock = stk.uds;
  var totalPend = Object.keys(pendByEmp).reduce(function(s, k) { return s + pendByEmp[k]; }, 0);

  var html = '<div style="display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Stock total</div><div style="font-size:1.4rem;font-weight:800;color:#2980b9">' + totalStock.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Comprometido</div><div style="font-size:1.4rem;font-weight:800;color:#e67e22">' + totalPend.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Disponible</div><div style="font-size:1.4rem;font-weight:800;color:' + ((totalStock - totalPend) >= 0 ? '#27ae60' : '#e74c3c') + '">' + (totalStock - totalPend).toLocaleString('es-CO') + '</div></div>';
  html += '</div>';

  if (stk.negativos) {
    html += '<div style="background:#fdecea;color:#c0392b;border-radius:6px;padding:8px 12px;font-size:0.78rem;font-weight:600;margin-bottom:12px">' +
      '⚠️ ' + stk.negativos + ' producto(s) con saldo negativo en el snapshot de Kardex — revisar en Kardex › Existencias por empresa.</div>';
  }

  html += '<div class="hbar-chart">';
  empresas.forEach(function(e) {
    var stock = stk.porEmp[e.sigla] || 0;
    var pend = pendByEmp[e.sigla] || 0;
    if (stock === 0 && pend === 0) return;
    var maxBar = Math.max(stock, pend, 1);
    var color = EMP_COLORS[e.sigla] || '#718096';
    html += '<div class="hbar-row">' +
      '<div class="hbar-label">' + escHtml(e.sigla) + '</div>' +
      '<div class="hbar-track" style="position:relative">' +
        '<div class="hbar-fill" style="width:' + Math.max(3, (Math.max(stock, 0) / maxBar) * 100) + '%;background:' + color + ';opacity:0.7">' + stock.toLocaleString('es-CO') + '</div>' +
      '</div>' +
      '<div class="hbar-value" style="color:' + ((stock - pend) >= 0 ? '#27ae60' : '#e74c3c') + '">' + (stock - pend).toLocaleString('es-CO') + '</div>' +
    '</div>';
  });
  html += '</div>';
  html += '<div style="font-size:0.72rem;color:#a0aec0;margin-top:8px;text-align:right">Barra = stock (snapshot Kardex, siempre a hoy) | Valor = disponible (stock - comprometido)</div>';

  el.innerHTML = html;
}

// ── 9. Resumen Modulos ──
function buildResumenModulos(orders, dev, ing, oc, mue, ree, cam, fEmp) {
  var stk = dStockTotals(fEmp);
  var _ocOrds = dOrdenesCompraAgrupadas(oc);

  var modules = [
    { icon: '📋', name: 'Pedidos', count: orders.length, detail: orders.reduce(function(s, o) { return s + o.lines.length; }, 0) + ' lineas' },
    { icon: '🔄', name: 'Devoluciones', count: dev.length, detail: dev.filter(function(d) { return d.Estado === 'Pendiente'; }).length + ' pendientes' },
    { icon: '🔁', name: 'Cambios', count: cam.length, detail: cam.filter(function(c) { return (c.Estado || '') !== 'Cerrado'; }).length + ' sin cerrar' },
    { icon: '📥', name: 'Ingresos', count: ing.length, detail: ing.reduce(function(s, i) { return s + (Number(i.Cantidad) || 0); }, 0).toLocaleString('es-CO') + ' uds' },
    { icon: '📦', name: 'Inventario', count: stk.disponible ? stk.productos : '—', detail: stk.disponible ? stk.uds.toLocaleString('es-CO') + ' uds en stock' : 'sin snapshot' },
    { icon: '🛒', name: 'Ordenes Compra', count: _ocOrds.length, detail: _ocOrds.filter(function(o) { return o.estado === 'Abierta'; }).length + ' abiertas' },
    { icon: '🧪', name: 'Muestras', count: mue.length, detail: mue.filter(function(m) { return (m.Estado || '') === 'Pendiente'; }).length + ' pendientes' },
    { icon: '🏭', name: 'Salidas prod.', count: ree.length, detail: ree.reduce(function(s, r) { return s + (Number(r.Cantidad) || 0); }, 0).toLocaleString('es-CO') + ' uds' },
  ];

  var html = '';
  modules.forEach(function(m) {
    html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #edf2f7">' +
      '<div style="font-size:1.3rem">' + m.icon + '</div>' +
      '<div style="flex:1"><div style="font-weight:700;font-size:0.88rem;color:#2d3748">' + m.name + '</div><div style="font-size:0.76rem;color:#718096">' + m.detail + '</div></div>' +
      '<div style="font-size:1.2rem;font-weight:800;color:#1a5276">' + m.count + '</div>' +
    '</div>';
  });

  document.getElementById('resumen-modulos').innerHTML = html;
}

// ── Tiempos de entrega ──
function buildTiempos(orders) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var deliveryVals = [];
  var pendingVals = [];

  orders.forEach(function(o) {
    if (o.fechaUltEntrega && o.fechaPedido && o.cantEntregada > 0) {
      var dE = new Date(o.fechaUltEntrega), dP = new Date(o.fechaPedido);
      if (!isNaN(dE) && !isNaN(dP)) {
        var days = Math.round((dE - dP) / 86400000);
        if (days >= 0) deliveryVals.push(days);
      }
    }
    if (o.estado2 === 'Abierto' && o.esPendiente && o.fechaPedido) {
      var dP2 = new Date(o.fechaPedido);
      if (!isNaN(dP2)) {
        var dd = Math.round((today - dP2) / 86400000);
        if (dd >= 0) pendingVals.push(dd);
      }
    }
  });

  var el = document.getElementById('chart-tiempos');
  document.getElementById('tiempos-sub').textContent = deliveryVals.length + ' entregadas / ' + pendingVals.length + ' pendientes';

  if (!deliveryVals.length && !pendingVals.length) {
    el.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">Sin datos de tiempos</div>';
    return;
  }

  var avgDel = deliveryVals.length ? Math.round(deliveryVals.reduce(function(s, v) { return s + v; }, 0) / deliveryVals.length) : 0;
  var minDel = deliveryVals.length ? Math.min.apply(null, deliveryVals) : 0;
  var maxDel = deliveryVals.length ? Math.max.apply(null, deliveryVals) : 0;
  var avgPend = pendingVals.length ? Math.round(pendingVals.reduce(function(s, v) { return s + v; }, 0) / pendingVals.length) : 0;
  var minPend = pendingVals.length ? Math.min.apply(null, pendingVals) : 0;
  var maxPend = pendingVals.length ? Math.max.apply(null, pendingVals) : 0;

  var ranges = [
    { label: '0-7 dias', min: 0, max: 7, cD: 0, cP: 0 },
    { label: '8-15 dias', min: 8, max: 15, cD: 0, cP: 0 },
    { label: '16-30 dias', min: 16, max: 30, cD: 0, cP: 0 },
    { label: '31-60 dias', min: 31, max: 60, cD: 0, cP: 0 },
    { label: '61+ dias', min: 61, max: 99999, cD: 0, cP: 0 },
  ];

  deliveryVals.forEach(function(d) {
    for (var i = 0; i < ranges.length; i++) { if (d >= ranges[i].min && d <= ranges[i].max) { ranges[i].cD++; break; } }
  });
  pendingVals.forEach(function(d) {
    for (var i = 0; i < ranges.length; i++) { if (d >= ranges[i].min && d <= ranges[i].max) { ranges[i].cP++; break; } }
  });

  var html = '';
  html += '<div style="display:flex;gap:16px;margin-bottom:18px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:140px;background:#f0fdf4;border-radius:8px;padding:12px">';
  html += '<div style="font-size:0.72rem;color:#718096;text-transform:uppercase;font-weight:600">Entregadas</div>';
  html += '<div style="font-size:1.3rem;font-weight:800;color:#27ae60">' + avgDel + ' dias prom</div>';
  html += '<div style="font-size:0.74rem;color:#4a5568">Min: ' + minDel + ' / Max: ' + maxDel + ' dias</div>';
  html += '</div>';
  html += '<div style="flex:1;min-width:140px;background:#fff7ed;border-radius:8px;padding:12px">';
  html += '<div style="font-size:0.72rem;color:#718096;text-transform:uppercase;font-weight:600">Pendientes (demora)</div>';
  html += '<div style="font-size:1.3rem;font-weight:800;color:#e67e22">' + avgPend + ' dias prom</div>';
  html += '<div style="font-size:0.74rem;color:#4a5568">Min: ' + minPend + ' / Max: ' + maxPend + ' dias</div>';
  html += '</div>';
  html += '</div>';

  html += '<div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600;margin-bottom:8px">Distribucion por rango</div>';
  var maxC = 1;
  ranges.forEach(function(r) { maxC = Math.max(maxC, r.cD, r.cP); });

  html += '<div class="hbar-chart">';
  ranges.forEach(function(r) {
    if (r.cD === 0 && r.cP === 0) return;
    var pD = Math.max(2, (r.cD / maxC) * 100);
    var pP = Math.max(2, (r.cP / maxC) * 100);
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">';
    html += '<div style="width:70px;font-size:0.76rem;font-weight:600;color:#4a5568;text-align:right">' + r.label + '</div>';
    html += '<div style="flex:1;display:flex;gap:3px">';
    if (r.cD > 0) html += '<div style="height:20px;width:' + pD + '%;background:#27ae60;border-radius:4px;display:flex;align-items:center;padding:0 6px;font-size:0.7rem;font-weight:700;color:white;min-width:24px">' + r.cD + '</div>';
    if (r.cP > 0) html += '<div style="height:20px;width:' + pP + '%;background:#e67e22;border-radius:4px;display:flex;align-items:center;padding:0 6px;font-size:0.7rem;font-weight:700;color:white;min-width:24px">' + r.cP + '</div>';
    html += '</div></div>';
  });
  html += '</div>';

  html += '<div style="display:flex;gap:14px;margin-top:8px">';
  html += '<div style="display:flex;align-items:center;gap:5px;font-size:0.74rem;color:#4a5568"><div style="width:10px;height:10px;border-radius:3px;background:#27ae60"></div>Entregadas</div>';
  html += '<div style="display:flex;align-items:center;gap:5px;font-size:0.74rem;color:#4a5568"><div style="width:10px;height:10px;border-radius:3px;background:#e67e22"></div>Pendientes</div>';
  html += '</div>';

  el.innerHTML = html;
}

// ── Top Pedidos con Mayor Demora ──
function buildTopDemora(orders) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var arr = orders.filter(function(o) {
    return o.estado2 === 'Abierto' && o.esPendiente && o.fechaPedido && !isNaN(new Date(o.fechaPedido));
  }).map(function(o) {
    return {
      consecutivo: o.consecutivo,
      cliente: o.cliente,
      empresa: o.sigla,
      dias: Math.round((today - new Date(o.fechaPedido)) / 86400000),
      pendiente: o.pendUds,
      pedido: o.cantPedida
    };
  });

  arr.sort(function(a, b) { return b.dias - a.dias; });
  arr = arr.slice(0, 10);

  var tbody = document.getElementById('tb-demora');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin pedidos pendientes</td></tr>';
    return;
  }

  tbody.innerHTML = arr.map(function(r) {
    var avance = r.pedido > 0 ? Math.round(((r.pedido - r.pendiente) / r.pedido) * 100) : 0;
    var color = r.dias > 60 ? '#e74c3c' : r.dias > 30 ? '#e67e22' : '#2980b9';
    var empColor = EMP_COLORS[r.empresa] || '#718096';
    return '<tr data-href="pedidos.html?buscar=' + encodeURIComponent(r.consecutivo) + '&empresa=' + encodeURIComponent(r.empresa) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600"><span class="sigla-badge" style="background:' + empColor + '20;color:' + empColor + ';font-size:0.68rem">' + escHtml(r.empresa) + '</span> ' + escHtml(r.consecutivo) + '</td>' +
      '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.cliente) + '</td>' +
      '<td class="money" style="font-weight:700;color:' + color + '">' + r.dias + '</td>' +
      '<td style="text-align:center"><div class="prog" style="margin:0 auto"><div class="prog-bar"><div class="prog-fill" style="width:' + avance + '%"></div></div><div class="prog-pct">' + avance + '%</div></div></td>' +
    '</tr>';
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// Helpers de series mensuales
// ══════════════════════════════════════════════════════════════
var D_MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dMesLbl(m) {
  var p = String(m || '').split('-');
  if (p.length < 2) return m;
  return D_MESES_CORTOS[Number(p[1]) - 1] + ' ' + p[0].slice(2);
}
function dEsMes(v) { return /^\d{4}-\d{2}$/.test(String(v || '').slice(0, 7)); }

// Lista de barras horizontales reutilizable. rows: [{label, value, valueTxt, color, barTxt}]
// opts.stack = true → etiqueta y valor sobre la barra (labels largos: productos,
// departamentos). Por defecto etiqueta en línea (labels cortos: siglas, estados).
function dHbarList(rows, maxVal, opts) {
  opts = opts || {};
  if (!rows.length) return '<div style="color:#a0aec0;text-align:center;padding:20px">Sin datos en el período</div>';
  var mx = maxVal || Math.max.apply(null, rows.map(function(r) { return r.value; })) || 1;

  var h = '<div class="hbar-chart">';
  rows.forEach(function(r) {
    var pct = Math.max(3, r.value / mx * 100);
    var valTxt = (r.valueTxt != null ? r.valueTxt : Number(r.value).toLocaleString('es-CO'));
    if (opts.stack) {
      h += '<div class="hbar-srow">' +
        '<div class="hbar-shead"><span class="hbar-slabel" title="' + escHtml(r.label) + '">' + escHtml(r.label) + '</span>' +
        '<span class="hbar-sval">' + valTxt + '</span></div>' +
        '<div class="hbar-track" style="height:18px"><div class="hbar-fill" style="width:' + pct + '%;background:' + (r.color || '#718096') + ';min-width:0">' + (r.barTxt || '') + '</div></div>' +
      '</div>';
    } else {
      h += '<div class="hbar-row">' +
        '<div class="hbar-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.label) + '">' + escHtml(r.label) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%;background:' + (r.color || '#718096') + '">' + (r.barTxt || '') + '</div></div>' +
        '<div class="hbar-value">' + valTxt + '</div>' +
      '</div>';
    }
  });
  return h + '</div>';
}

// Normalizador de nombre de producto — mismo criterio que existencias.js:_normProd.
function dNormProd(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// ── Pedidos por mes ──
function buildPedidosPorMes(fEmp) {
  var map = {};
  dPedidos.forEach(function(p) {
    if (fEmp && p.Nombre_Empresa !== fEmp) return;
    if ((p.Estado_2 || 'Abierto').trim() === 'Anulado') return;
    var mes = String(p.Fecha_Pedido || '').slice(0, 7);
    if (!dEsMes(mes)) return;
    if (!map[mes]) map[mes] = { ord: {}, uds: 0, valor: 0 };
    map[mes].ord[dKeyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente)] = 1;
    map[mes].uds += Number(p.Cantidad) || 0;
    map[mes].valor += Number(p.Valor_Total) || 0;
  });
  var meses = Object.keys(map).sort();
  dMixedChart('cv-pedidos-mes', meses.map(dMesLbl), [
    { label: 'Órdenes', tipo: 'bar', yAxis: 'y', color: '#1a5276', data: meses.map(function(m) { return Object.keys(map[m].ord).length; }) },
    { label: '$ Pedido', tipo: 'line', yAxis: 'y2', color: '#27ae60', data: meses.map(function(m) { return Math.round(map[m].valor); }) }
  ], { y2: true, y2Money: true });
}

// ── Entregas por mes (EntregasPedido — datos desde ago-2026) ──
function buildEntregasPorMes(fEmp) {
  var map = {};
  dEntregas.forEach(function(e) {
    if (fEmp && e.empresa_pedido !== fEmp) return;
    var mes = String(e.fecha || '').slice(0, 7);
    if (!dEsMes(mes)) return;
    if (!map[mes]) map[mes] = { n: 0, uds: 0 };
    map[mes].n++;
    map[mes].uds += Number(e.cantidad) || 0;
  });
  var meses = Object.keys(map).sort();
  var subEl = document.getElementById('entmes-sub');
  if (subEl) subEl.textContent = meses.length ? ('desde ' + dMesLbl(meses[0]) + ' · ' + dEntregas.length + ' despachos') : 'sin datos (el módulo registra desde ago-2026)';
  dMixedChart('cv-entregas-mes', meses.map(dMesLbl), [
    { label: 'Despachos', tipo: 'bar', yAxis: 'y', color: '#8e44ad', data: meses.map(function(m) { return map[m].n; }) },
    { label: 'Uds', tipo: 'line', yAxis: 'y2', color: '#e67e22', data: meses.map(function(m) { return map[m].uds; }) }
  ], { y2: true });
}

// ── Devoluciones por mes ──
function buildDevolucionesPorMes(fEmp) {
  var map = {};
  dDevoluciones.forEach(function(d) {
    if (fEmp && d.Empresa !== fEmp) return;
    var mes = String(d.Fecha || '').slice(0, 7);
    if (!dEsMes(mes)) return;
    if (!map[mes]) map[mes] = { n: 0, valor: 0 };
    map[mes].n++;
    map[mes].valor += Number(d.Valor_Total) || 0;
  });
  var meses = Object.keys(map).sort();
  dMixedChart('cv-dev-mes', meses.map(dMesLbl), [
    { label: 'Nº devoluciones', tipo: 'bar', yAxis: 'y', color: '#e74c3c', data: meses.map(function(m) { return map[m].n; }) },
    { label: '$ devuelto', tipo: 'line', yAxis: 'y2', color: '#c0392b', data: meses.map(function(m) { return Math.round(map[m].valor); }) }
  ], { y2: true, y2Money: true });
}

// ── Ventas por proveedor / categoría ──
var D_CAT_COLOR = {
  'Proveedor Carval': '#b7950b', 'Proveedor Abago': '#1e8449',
  'Proveedor Sharda': '#6c3483', 'Proveedor Disney C.': '#a04000',
  'Producción propia': '#1a5276'
};
function buildVentasPorCategoria(ped) {
  var map = {};
  var total = 0;
  ped.forEach(function(p) {
    if ((p.Estado_2 || 'Abierto').trim() === 'Anulado') return;
    var cat = _getCategoria(p.Producto);
    var v = Number(p.Valor_Total) || 0;
    map[cat] = (map[cat] || 0) + v;
    total += v;
  });
  var rows = Object.keys(map).map(function(cat) {
    return { label: cat.replace('Proveedor ', ''), value: map[cat], color: D_CAT_COLOR[cat] || '#718096',
      valueTxt: dMoneyM(map[cat]), barTxt: total > 0 ? Math.round(map[cat] / total * 100) + '%' : '' };
  }).sort(function(a, b) { return b.value - a.value; });
  var subEl = document.getElementById('cat-sub');
  if (subEl) subEl.textContent = 'total ' + dMoneyM(total);
  document.getElementById('chart-categorias').innerHTML = dHbarList(rows, null, { stack: true });
}

// ── Ventas por departamento ──
function buildVentasPorDepartamento(ped) {
  var map = {};
  ped.forEach(function(p) {
    if ((p.Estado_2 || 'Abierto').trim() === 'Anulado') return;
    var dep = (p.Departamento || '').trim().toUpperCase() || 'SIN DATO';
    map[dep] = (map[dep] || 0) + (Number(p.Valor_Total) || 0);
  });
  var rows = Object.keys(map).map(function(dep) {
    return { label: dep, value: map[dep], valueTxt: dMoneyM(map[dep]), color: '#2980b9' };
  }).sort(function(a, b) { return b.value - a.value; }).slice(0, 10);
  document.getElementById('chart-departamentos').innerHTML = dHbarList(rows, null, { stack: true });
}

// ── Exactitud de inventario (último conteo físico por empresa) ──
// Devuelve, por empresa: filas del conteo más reciente (± 30 días de su fecha
// máxima, para capturar toda la campaña de conteo).
function dConteosRecientes(fEmp) {
  var porEmp = {};
  dConteos.forEach(function(c) {
    if (fEmp && c.Empresa !== fEmp) return;
    var f = String(c.Fecha_Conteo || '').slice(0, 10);
    if (!f) return;
    (porEmp[c.Empresa] = porEmp[c.Empresa] || []).push(c);
  });
  var out = [];
  Object.keys(porEmp).forEach(function(emp) {
    var maxF = porEmp[emp].reduce(function(mx, c) {
      var f = String(c.Fecha_Conteo || '').slice(0, 10);
      return f > mx ? f : mx;
    }, '');
    var lim = new Date(new Date(maxF + 'T00:00:00') - 30 * 86400000);
    porEmp[emp].forEach(function(c) {
      var f = new Date(String(c.Fecha_Conteo || '').slice(0, 10) + 'T00:00:00');
      if (!isNaN(f) && f >= lim) out.push(c);
    });
  });
  return out;
}

function buildExactitudInventario(fEmp) {
  var rows = dConteosRecientes(fEmp);
  var el = document.getElementById('chart-exactitud');
  var subEl = document.getElementById('exac-sub');
  if (!rows.length) {
    if (subEl) subEl.textContent = '';
    el.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">Sin conteos físicos registrados</div>';
    return;
  }
  var porEmp = {};
  rows.forEach(function(c) {
    var e = porEmp[c.Empresa] || (porEmp[c.Empresa] = { sisAbs: 0, difAbs: 0, n: 0, ok: 0, maxF: '' });
    var sis = Math.abs(Number(c.Cantidad_Sistema) || 0);
    var dif = Math.abs(Number(c.Diferencia) || 0);
    e.sisAbs += sis; e.difAbs += dif; e.n++;
    if (dif === 0) e.ok++;
    var f = String(c.Fecha_Conteo || '').slice(0, 10);
    if (f > e.maxF) e.maxF = f;
  });
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var totSis = 0, totDif = 0, totN = 0, totOk = 0, maxAntig = 0;
  var barRows = Object.keys(porEmp).map(function(emp) {
    var e = porEmp[emp];
    var exac = e.sisAbs > 0 ? (1 - e.difAbs / e.sisAbs) * 100 : 100;
    var antig = e.maxF ? Math.round((hoy - new Date(e.maxF + 'T00:00:00')) / 86400000) : 0;
    totSis += e.sisAbs; totDif += e.difAbs; totN += e.n; totOk += e.ok;
    if (antig > maxAntig) maxAntig = antig;
    return {
      label: dGetSigla(emp), value: Math.max(0, exac),
      color: exac >= 98 ? '#27ae60' : exac >= 95 ? '#e67e22' : '#e74c3c',
      valueTxt: exac.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%',
      barTxt: 'hace ' + antig + 'd'
    };
  }).sort(function(a, b) { return a.value - b.value; });

  var exacGlobal = totSis > 0 ? (1 - totDif / totSis) * 100 : 100;
  if (subEl) {
    subEl.textContent = 'global ' + exacGlobal.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '% · ' +
      totOk + '/' + totN + ' líneas sin descuadre' + (maxAntig > 45 ? ' · ⚠️ último conteo hace ' + maxAntig + 'd' : '');
  }
  el.innerHTML = dHbarList(barRows, 100);
}

// ── Top productos con descuadre ──
function buildTopDescuadre(fEmp) {
  var rows = dConteosRecientes(fEmp).filter(function(c) { return (Number(c.Diferencia) || 0) !== 0; });
  rows.sort(function(a, b) { return Math.abs(Number(b.Diferencia) || 0) - Math.abs(Number(a.Diferencia) || 0); });
  rows = rows.slice(0, 10);
  var tbody = document.getElementById('tb-descuadre');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:20px">Sin descuadres en el último conteo</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(c) {
    var dif = Number(c.Diferencia) || 0;
    return '<tr data-href="inventario.html?buscar=' + encodeURIComponent(c.Producto || '') + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(c.Producto || '') + '">' + escHtml(c.Producto || '') + '</td>' +
      '<td>' + escHtml(dGetSigla(c.Empresa)) + '</td>' +
      '<td class="money">' + (Number(c.Cantidad_Fisica) || 0).toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + (Number(c.Cantidad_Sistema) || 0).toLocaleString('es-CO') + '</td>' +
      '<td class="money" style="font-weight:700;color:' + (dif < 0 ? '#e74c3c' : '#e67e22') + '">' + (dif > 0 ? '+' : '') + dif.toLocaleString('es-CO') + '</td>' +
    '</tr>';
  }).join('');
}

// ── Stock por producto (snapshot Kardex) ──
function dStockPorProducto(fEmp) {
  var saldos = (dExist && dExist.saldos) || {};
  var empresas = dHoldingEmpresas();
  var out = {};
  Object.keys(saldos).forEach(function(pk) {
    var per = saldos[pk] || {}, tot = 0;
    empresas.forEach(function(e) { if (fEmp && e.value !== fEmp) return; tot += per[e.value] || 0; });
    out[pk] = tot;
  });
  return out;
}

// ── Cobertura de inventario (días) ──
function buildCobertura(ent, fEmp, fDesde, fHasta) {
  var tbody = document.getElementById('tb-cobertura');
  var subEl = document.getElementById('cob-sub');
  if (!dExist) {
    if (subEl) subEl.textContent = '';
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin snapshot de existencias</td></tr>';
    return;
  }
  // Días del período de consumo: rango acotado; o desde→hoy; o desde la primera
  // entrega hasta hoy si el rango está totalmente abierto.
  var dias = 0;
  var hoyMs = Date.now();
  if (fDesde && fHasta) {
    dias = Math.round((new Date(fHasta + 'T00:00:00') - new Date(fDesde + 'T00:00:00')) / 86400000) + 1;
  } else if (fDesde) {
    dias = Math.round((hoyMs - new Date(fDesde + 'T00:00:00')) / 86400000) + 1;
  } else {
    var fechas = ent.map(function(e) { return String(e.fecha || '').slice(0, 10); }).filter(Boolean).sort();
    if (fechas.length) dias = Math.round((hoyMs - new Date(fechas[0] + 'T00:00:00')) / 86400000) + 1;
  }
  if (dias < 1) dias = 0;
  var salidaPorProd = {};
  ent.forEach(function(e) {
    var k = dNormProd(e.producto);
    if (!k) return;
    salidaPorProd[k] = (salidaPorProd[k] || 0) + (Number(e.cantidad) || 0);
  });
  var stock = dStockPorProducto(fEmp);
  var rows = [];
  Object.keys(salidaPorProd).forEach(function(k) {
    var sal = salidaPorProd[k];
    if (!dias || sal <= 0) return;
    var rate = sal / dias;              // uds/día
    var st = stock[k] || 0;
    if (st <= 0) return;
    rows.push({ prod: k, stock: st, rate: rate, cob: st / rate });
  });
  rows.sort(function(a, b) { return a.cob - b.cob; });
  rows = rows.slice(0, 10);
  if (subEl) subEl.textContent = dias ? ('consumo de ' + dias + ' días · menor cobertura primero') : 'sin salidas en el período';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin datos de salidas en el período</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(r) {
    var col = r.cob < 15 ? '#e74c3c' : r.cob < 30 ? '#e67e22' : '#27ae60';
    return '<tr>' +
      '<td style="font-weight:600;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.prod) + '">' + escHtml(r.prod) + '</td>' +
      '<td class="money">' + Math.round(r.stock).toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + r.rate.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '</td>' +
      '<td class="money" style="font-weight:700;color:' + col + '">' + Math.round(r.cob).toLocaleString('es-CO') + ' d</td>' +
    '</tr>';
  }).join('');
}

// ── Alertas de stock: agotados y sin rotación ──
function buildAlertasStock(ped, ent, fEmp) {
  var el = document.getElementById('chart-alertas-stock');
  var subEl = document.getElementById('alertas-sub');
  if (!dExist) {
    if (subEl) subEl.textContent = '';
    el.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">Sin snapshot de existencias</div>';
    return;
  }
  var stock = dStockPorProducto(fEmp);
  var salida = {};
  ent.forEach(function(e) { var k = dNormProd(e.producto); if (k) salida[k] = (salida[k] || 0) + (Number(e.cantidad) || 0); });
  var pendPorProd = {};
  ped.forEach(function(p) {
    if (!dLineaPendiente(p)) return;
    var k = dNormProd(p.Producto);
    if (k) pendPorProd[k] = (pendPorProd[k] || 0) + (Number(p.Cant_Pendiente) || 0);
  });

  var agotados = [], sinRotacion = [];
  Object.keys(pendPorProd).forEach(function(k) {
    if ((stock[k] || 0) <= 0) agotados.push({ prod: k, pend: pendPorProd[k] });
  });
  Object.keys(stock).forEach(function(k) {
    if ((stock[k] || 0) > 0 && !(salida[k] > 0)) sinRotacion.push({ prod: k, stock: stock[k] });
  });
  agotados.sort(function(a, b) { return b.pend - a.pend; });
  sinRotacion.sort(function(a, b) { return b.stock - a.stock; });

  if (subEl) subEl.textContent = agotados.length + ' agotados con pendiente · ' + sinRotacion.length + ' sin rotación';

  var html = '';
  html += '<div style="font-size:0.78rem;font-weight:700;color:#e74c3c;margin-bottom:6px">🔴 Agotados con pedidos pendientes</div>';
  html += dHbarList(agotados.slice(0, 6).map(function(r) {
    return { label: r.prod, value: r.pend, valueTxt: Math.round(r.pend).toLocaleString('es-CO') + ' pend', color: '#e74c3c' };
  }), null, { stack: true });
  html += '<div style="font-size:0.78rem;font-weight:700;color:#e67e22;margin:14px 0 6px">🟠 Con stock y sin salidas en el período</div>';
  html += dHbarList(sinRotacion.slice(0, 6).map(function(r) {
    return { label: r.prod, value: r.stock, valueTxt: Math.round(r.stock).toLocaleString('es-CO') + ' uds', color: '#e67e22' };
  }), null, { stack: true });
  el.innerHTML = html;
}

// Agrupa las líneas de OrdenesCompra en órdenes: 1 por (origen, destino,
// consecutivo). Lo usan la KPI "OC abiertas", el Resumen de módulos y la
// tarjeta de OC — todos cuentan órdenes, no líneas.
function dOrdenesCompraAgrupadas(oc) {
  var map = {};
  oc.forEach(function(o) {
    var key = (o.Empresa_Origen || '') + '|' + (o.Empresa_Destino || '') + '|' + (o.Consecutivo || o.id || '');
    var m = map[key] || (map[key] = {
      estado: o.Estado, aprob: o.Estado_Aprobacion, valor: 0,
      creado: o.creado_en, aprobFecha: o.Fecha_Aprobacion, tipo: o.Tipo
    });
    m.valor += Number(o.Valor_Total) || (Number(o.Total_Orden) || 0);
  });
  return Object.keys(map).map(function(k) { return map[k]; });
}

// ── Órdenes de compra ──
function buildOrdenesCompra(oc) {
  var el = document.getElementById('chart-oc');
  var subEl = document.getElementById('oc-sub');

  var ords = dOrdenesCompraAgrupadas(oc);

  var abiertas = ords.filter(function(o) { return (o.estado || '') === 'Abierta'; });
  var porAprobar = ords.filter(function(o) { return (o.aprob || '') === 'Por aprobar'; });
  var valComprometido = abiertas.reduce(function(s, o) { return s + o.valor; }, 0);

  // Lead time de aprobación (días entre creado_en y Fecha_Aprobacion).
  var leadDias = [];
  ords.forEach(function(o) {
    if (o.creado && o.aprobFecha) {
      var d = (new Date(o.aprobFecha) - new Date(o.creado)) / 86400000;
      if (isFinite(d) && d >= 0) leadDias.push(d);
    }
  });
  var leadProm = leadDias.length ? (leadDias.reduce(function(s, v) { return s + v; }, 0) / leadDias.length) : 0;

  if (subEl) subEl.textContent = ords.length + ' órdenes en el período';

  var html = '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px">';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.74rem;color:#718096;text-transform:uppercase;font-weight:600">Abiertas</div><div style="font-size:1.4rem;font-weight:800;color:#1a5276">' + abiertas.length + '</div></div>';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.74rem;color:#718096;text-transform:uppercase;font-weight:600">Por aprobar</div><div style="font-size:1.4rem;font-weight:800;color:' + (porAprobar.length ? '#e67e22' : '#27ae60') + '">' + porAprobar.length + '</div></div>';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.74rem;color:#718096;text-transform:uppercase;font-weight:600">$ comprometido</div><div style="font-size:1.4rem;font-weight:800;color:#8e44ad">' + dMoneyM(valComprometido) + '</div></div>';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.74rem;color:#718096;text-transform:uppercase;font-weight:600">Lead aprob.</div><div style="font-size:1.4rem;font-weight:800;color:#2d3748">' + leadProm.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' d</div></div>';
  html += '</div>';

  var estMap = {};
  ords.forEach(function(o) { var e = (o.estado || '—'); estMap[e] = (estMap[e] || 0) + 1; });
  var estRows = Object.keys(estMap).map(function(e) {
    var color = e === 'Abierta' ? '#1a5276' : e === 'Cerrada' ? '#27ae60' : e === 'Anulada' ? '#e74c3c' : '#718096';
    return { label: e, value: estMap[e], color: color };
  }).sort(function(a, b) { return b.value - a.value; });
  html += dHbarList(estRows);
  el.innerHTML = html;
}

// ── Cambios · Muestras · Salidas a producción ──
function buildOtrosModulos(cam, mue, ree) {
  var el = document.getElementById('chart-otros-modulos');

  function bloque(icon, titulo, filas) {
    var h = '<div style="margin-bottom:14px"><div style="font-weight:700;font-size:0.86rem;color:#2d3748;margin-bottom:6px">' + icon + ' ' + titulo + '</div>';
    h += dHbarList(filas);
    return h + '</div>';
  }

  // Cambios por estado.
  var camMap = {};
  cam.forEach(function(c) { var e = (c.Estado || '—'); camMap[e] = (camMap[e] || 0) + 1; });
  var camRows = Object.keys(camMap).map(function(e) {
    return { label: e, value: camMap[e], color: e === 'Cerrado' ? '#27ae60' : e === 'Parcial' ? '#2980b9' : '#e67e22' };
  }).sort(function(a, b) { return b.value - a.value; });

  // Muestras: efectividad = despachadas / solicitadas.
  var mDesp = mue.filter(function(m) { return (m.Estado || '') === 'Despachada'; }).length;
  var mPend = mue.filter(function(m) { return (m.Estado || '') === 'Pendiente'; }).length;
  var efect = mue.length ? Math.round(mDesp / mue.length * 100) : 0;
  var mueRows = [
    { label: 'Despachadas', value: mDesp, color: '#27ae60' },
    { label: 'Pendientes', value: mPend, color: '#e67e22' }
  ];

  // Salidas a producción por estado (sin retorno completo).
  var reeMap = {};
  ree.forEach(function(r) { var e = (r.Estado || '—'); reeMap[e] = (reeMap[e] || 0) + 1; });
  var reeRows = Object.keys(reeMap).map(function(e) {
    return { label: e, value: reeMap[e], color: e === 'Cerrada' ? '#27ae60' : e === 'Parcial' ? '#2980b9' : '#e67e22' };
  }).sort(function(a, b) { return b.value - a.value; });

  el.innerHTML =
    bloque('🔁', 'Cambios de mercancía (' + cam.length + ')', camRows) +
    bloque('🧪', 'Muestras — efectividad ' + efect + '% (' + mue.length + ')', mueRows) +
    bloque('🏭', 'Salidas a producción (' + ree.length + ')', reeRows);
}

// ── Calidad de datos ──
function buildCalidadDatos(ped, fEmp) {
  var sinPrecio = 0;
  var ordSinComercial = {};
  ped.forEach(function(p) {
    var cant = Number(p.Cantidad) || 0;
    if ((Number(p.Valor_Unitario) || 0) === 0 && cant > 0 && (p.Estado_2 || 'Abierto').trim() !== 'Anulado') sinPrecio++;
    if (!(p.Comercial || '').trim()) ordSinComercial[dKeyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente)] = 1;
  });
  var sinComercial = Object.keys(ordSinComercial).length;

  // Fechas mal formateadas: sobre TODOS los pedidos (empresa filtrada), no el
  // rango — una fecha mala se cae del propio filtro de rango, así que filtrarla
  // aquí la escondería justo cuando hay que verla.
  var fechaMala = dPedidos.filter(function(p) {
    if (fEmp && p.Nombre_Empresa !== fEmp) return false;
    return p.Fecha_Pedido && !/^\d{4}-\d{2}-\d{2}/.test(String(p.Fecha_Pedido));
  }).length;

  var stk = dStockTotals(fEmp);
  var conteoDif = dConteosRecientes(fEmp).filter(function(c) {
    return (Number(c.Diferencia) || 0) !== 0 && !(c.Observaciones || '').trim();
  }).length;

  var items = [
    { lbl: 'Líneas de pedido sin precio', val: sinPrecio, bad: sinPrecio > 0, hint: 'Valor_Unitario = 0 con cantidad > 0' },
    { lbl: 'Órdenes sin comercial asignado', val: sinComercial, bad: sinComercial > 0, hint: 'no suman a "Top comerciales"' },
    { lbl: 'Fechas de pedido mal formateadas', val: fechaMala, bad: fechaMala > 0, hint: 'no en formato YYYY-MM-DD' },
    { lbl: 'Productos con saldo negativo (Kardex)', val: stk.disponible ? stk.negativos : '—', bad: stk.disponible && stk.negativos > 0, hint: 'error de kardex' },
    { lbl: 'Descuadres de conteo sin observación', val: conteoDif, bad: conteoDif > 0, hint: 'InventarioFisico.Diferencia ≠ 0 sin nota' }
  ];

  document.getElementById('chart-calidad').innerHTML = items.map(function(it) {
    var color = it.bad ? '#e74c3c' : '#27ae60';
    return '<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #edf2f7">' +
      '<div style="font-size:1rem">' + (it.bad ? '⚠️' : '✅') + '</div>' +
      '<div style="flex:1"><div style="font-weight:600;font-size:0.85rem;color:#2d3748">' + it.lbl + '</div>' +
      '<div style="font-size:0.72rem;color:#a0aec0">' + it.hint + '</div></div>' +
      '<div style="font-size:1.15rem;font-weight:800;color:' + color + '">' + (typeof it.val === 'number' ? it.val.toLocaleString('es-CO') : it.val) + '</div>' +
    '</div>';
  }).join('');
}

// ── Clientes nuevos del período ──
function buildClientesNuevos(fEmp, fDesde, fHasta) {
  var tbody = document.getElementById('tb-clinuevos');
  var subEl = document.getElementById('clinuevos-sub');

  var nuevos = dClientes.filter(function(c) {
    if (!c.Cliente_Nuevo) return false;
    if (fEmp && c.Nombre_Empresa && c.Nombre_Empresa !== fEmp) return false;
    var f = String(c.creado_en || '').slice(0, 10);
    return _fechaEnRango(f, fDesde, fHasta);
  });

  // Aporte en $: cruzar por nombre de cliente contra los pedidos del período.
  var pedByCli = {};
  dPedidos.forEach(function(p) {
    if (fEmp && p.Nombre_Empresa !== fEmp) return;
    if (!_fechaEnRango(p.Fecha_Pedido, fDesde, fHasta)) return;
    var k = dNorm(p.Cliente);
    if (!k) return;
    var e = pedByCli[k] || (pedByCli[k] = { valor: 0, ord: {} });
    e.valor += Number(p.Valor_Total) || 0;
    e.ord[dKeyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente)] = 1;
  });

  var rows = nuevos.map(function(c) {
    var e = pedByCli[dNorm(c.Cliente)] || { valor: 0, ord: {} };
    return { cliente: c.Cliente || '—', alta: String(c.creado_en || '').slice(0, 10), ord: Object.keys(e.ord).length, valor: e.valor };
  }).sort(function(a, b) { return b.valor - a.valor; });

  var totVal = rows.reduce(function(s, r) { return s + r.valor; }, 0);
  if (subEl) subEl.textContent = rows.length + ' clientes · ' + dMoneyM(totVal) + ' en pedidos';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin clientes nuevos en el período</td></tr>';
    return;
  }
  tbody.innerHTML = rows.slice(0, 12).map(function(r) {
    return '<tr data-href="clientes.html?buscar=' + encodeURIComponent(r.cliente) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.cliente) + '">' + escHtml(r.cliente) + '</td>' +
      '<td>' + (r.alta ? fmtDate(r.alta) : '—') + '</td>' +
      '<td class="money">' + r.ord + '</td>' +
      '<td class="money" style="font-weight:700;color:#2980b9">' + dMoneyM(r.valor) + '</td>' +
    '</tr>';
  }).join('');
}

// ── Init ──
loadDashboard();
