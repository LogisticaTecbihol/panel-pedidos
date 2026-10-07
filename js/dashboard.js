// ── Dashboard State ──
var dPedidos = [];
var dPedidosConsig = [];  // pedidos en consignación: salen de dPedidos (no son ventas) pero se cuentan aparte
var dConsigIds = {};      // id de Pedidos → 1, para marcar los despachos de EntregasPedido que son de consignación
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
var dListaPrecios = null;  // ListaPrecios (Mayorista/Dealer) para valorizar el inventario; null = no se pudo cargar
var dPrecioIdx = null;     // índice empresa||producto → { mayorista, dealer } (se reconstruye en cada carga)
var dLoadedAt = null;  // Date en que se descargaron los datos (NO cambia al mover filtros)
var dLoading = false;  // evita cargas simultáneas (botón Actualizar + recarga automática)

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

// IASO: "Bodega COATOL" y "Bodega Espinal" (cualquier variante de mayúsculas/
// minúsculas) son bodegas en consignación registradas como cliente en vez de
// traslado — se excluyen del dashboard de forma retroactiva (pedidos ya
// existentes incluidos), a diferencia del filtro por Bodega_Consignacion_Id
// (que solo aplica hacia adelante). Pedido a mano, no heurística general de
// "cualquier Bodega X": solo estos dos clientes puntuales.
var DASH_IASO_CLIENTES_BODEGA = { 'BODEGA COATOL': 1, 'BODEGA ESPINAL': 1 };
function dEsBodegaIasoExcluida(p) {
  if (dGetSigla(p.Nombre_Empresa) !== 'IASO') return false;
  return !!DASH_IASO_CLIENTES_BODEGA[(p.Cliente || '').trim().toUpperCase()];
}

// Campo "Pedido en Consignación" (columna Consignacion) marcado explícitamente
// en 'Sí' — el dato histórico también trae 'Si' sin tilde. Retroactivo, igual
// que dEsBodegaIasoExcluida: cualquier empresa, no solo IASO.
function dEsPedidoConsignacionExplicito(p) {
  var v = (p.Consignacion || '').trim();
  return v === 'Si' || v === 'Sí';
}

// Pedido en consignación = cualquiera de los tres criterios que lo sacan de
// dPedidos (traslado a bodega, bodega de IASO, campo Consignación = Sí).
function dEsConsignacion(p) {
  return !!p.Bodega_Consignacion_Id || dEsBodegaIasoExcluida(p) || dEsPedidoConsignacionExplicito(p);
}

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
  if (vals.indexOf('Pendiente de aprobación') >= 0) return 'Pendiente de aprobación';
  if (vals.indexOf('Bloqueado por cartera') >= 0) return 'Bloqueado por cartera';
  if (vals.indexOf('Entregado por proveedor') >= 0) return 'Entregado por proveedor';
  if (vals.every(function(v) { return v === 'Cerrado'; })) return 'Cerrado';
  if (vals.every(function(v) { return v === 'Cerrado' || v === 'Alistado'; })) return 'Alistado';
  return 'Abierto';
}

// mismo criterio que reportes.js:buildReport para "producto pendiente"
var D_ESTADOS_NO_PENDIENTE = { 'Anulado': 1, 'Alistado': 1, 'Cerrado': 1, 'Bloqueado por cartera': 1, 'Pendiente de aprobación': 1, 'Entregado por proveedor': 1 };
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
        nit: (p.NIT || '').trim(),
        comercial: (p.Comercial || '').trim(),
        fechaPedido: p.Fecha_Pedido || '',
        fechaUltEntrega: p.Fecha_Ult_Entrega || '',
        fechaCompromiso: p.Fecha_Compromiso || '',
        lines: []
      };
    }
    var o = map[key];
    o.lines.push(p);
    if (p.Fecha_Ult_Entrega && (!o.fechaUltEntrega || p.Fecha_Ult_Entrega > o.fechaUltEntrega)) {
      o.fechaUltEntrega = p.Fecha_Ult_Entrega;
    }
    if (p.Comercial && !o.comercial) o.comercial = (p.Comercial || '').trim();
    if (p.NIT && !o.nit) o.nit = (p.NIT || '').trim();
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
    // ── OTD / cumplimiento de entrega ──
    o.otd = _otdClasificar({
      fechaCompromiso: o.fechaCompromiso,
      fechaUltEntrega: o.fechaUltEntrega,
      completa: dOrdenCompleta(o),
      estado2: o.estado2
    });
    return o;
  });
}

// ── Load ──
async function loadDashboard() {
  await _authReady;
  if (dLoading) return;
  dLoading = true;
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
      apiGet('getPedidos', { columns: 'id,Nombre_Empresa,Cliente,NIT,Departamento,Cant_Entregada,Cantidad,Estado_2,Estado_Entrega,Consecutivo,Fecha_Ult_Entrega,Fecha_Pedido,Fecha_Compromiso,Producto,Comercial,Valor_Unitario,Valor_Total,Bodega_Consignacion_Id,Consignacion' }),
      apiGet('getDevoluciones', { columns: 'Empresa,Estado,Motivo,Fecha,Cantidad,Valor_Total,Cliente,Vendedor' }).catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getIngresos', { columns: 'Empresa_Origen,Empresa_Destino,Cantidad,Fecha,Origen,Responsable,Remision_Origen,Remision_Destino,Reenvase_Ref' }).catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Empresa_Destino,Empresa_Origen,Consecutivo,Estado,Fecha,Estado_Aprobacion,Fecha_Aprobacion,creado_en,Total_Orden,Valor_Total,Tipo,Cantidad' }).catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras', { columns: 'id,Empresa,Consecutivo,Estado,Fecha_Solicitud,Fecha_Despacho,Cantidad,Tipo_Solicitud' }).catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases', { columns: 'Empresa,Empresa_Destino,Planta,Remision,Remision_Destino,Bodega,Cantidad,Fecha,Estado' }).catch(function() { return { ok: true, reenvases: [] }; }),
      apiGet('getEntregasPedido', { columns: 'pedido_id,empresa_pedido,empresa_stock,producto,cantidad,fecha' }).catch(function() { return { ok: true, entregas: [] }; }),
      apiGet('getCambios', { columns: 'id,Empresa,Consecutivo,Estado,Fecha_Solicitud,Producto,Cantidad' }).catch(function() { return { ok: true, cambios: [] }; }),
      apiGet('getInventarioFisico', { columns: 'Empresa,Producto,Presentacion,Cantidad_Fisica,Cantidad_Sistema,Diferencia,Fecha_Conteo,Observaciones' }).catch(function() { return { ok: true, conteos: [] }; }),
      apiGet('getClientesAll', { columns: 'Cliente,Identificacion,Nombre_Empresa,Cliente_Nuevo,creado_en' }).catch(function() { return { ok: true, clientes: [] }; }),
      apiGet('getListaPrecios', { columns: 'Empresa,Tipo_Precio,Producto,Precio' }).catch(function() { return { ok: false }; })
    ]);

    if (!results[0].ok) throw new Error(results[0].error || 'Error al cargar pedidos');

    var pedidosValidos = (results[0].pedidos || []).filter(function(p) {
      // Excluye encabezados repetidos y GRANEL (aislada de los consolidados
      // igual que en el resto del panel; sus pedidos solo se ven dentro del
      // módulo Pedidos).
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente'
        && !_esGranel(p.Nombre_Empresa);
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

    // Los pedidos en consignación no son ventas a cliente final, así que no
    // deben inflar KPIs, Top clientes/comerciales, OTD, etc. (ver
    // dEsConsignacion). Se apartan en dPedidosConsig para contarlos aparte:
    // los despachos de EntregasPedido sí los incluyen, y sin este conteo el
    // total de órdenes no cuadra con el de entregas.
    dPedidos = pedidosValidos.filter(function(p) { return !dEsConsignacion(p); });
    dPedidosConsig = pedidosValidos.filter(dEsConsignacion);
    dConsigIds = {};
    dPedidosConsig.forEach(function(p) { if (p.id != null) dConsigIds[p.id] = 1; });

    dDevoluciones = results[1].devoluciones || [];
    dIngresos = results[2].ingresos || [];
    dOrdenes = results[3].ordenes || [];
    dMuestras = results[4].muestras || [];
    dReenvases = results[5].reenvases || [];
    dEntregas = results[6].entregas || [];
    dCambios = results[7].cambios || [];
    dConteos = results[8].conteos || [];
    dClientes = results[9].clientes || [];
    dListaPrecios = results[10].ok ? (results[10].precios || []) : null;
    dPrecioIdx = null;
    _cliNitMap = null;             // se reconstruye con el nuevo maestro
    _allOrdersCache.emp = undefined; // idem con los nuevos pedidos
    dLegInvalidar();                 // el informe de Legalización se vuelve a pedir al abrirlo / repintarlo
    dLoadedAt = new Date();

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
    populateMpProductoSelect();
    dLegAplicarPermiso();
    buildDashboard();

    setSyncStatus('ok', 'Conectado a la nube. Ultima actualizacion: ' + dLoadedAt.toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase';
  } catch (err) {
    if (mainEl.style.display === 'block') {
      // Los datos en pantalla siguen siendo los de dLoadedAt: se dice cuáles.
      setSyncStatus('error', 'Error al actualizar: ' + err.message + (dLoadedAt ? ' (se muestran los datos de las ' + dLoadedAt.toLocaleTimeString('es-CO') + ')' : ''));
    } else {
      spinnerEl.style.display = 'none';
      errEl.textContent = '⚠️ ' + err.message;
      errEl.style.display = 'block';
      retryBtn.style.display = 'inline-block';
    }
  } finally {
    dLoading = false;
  }
}

// El dashboard descarga los datos una sola vez al abrirse: una pestaña que queda
// abierta horas o días muestra cifras viejas sin avisar (ej.: "Pendiente" de
// pedidos que ya se entregaron). Al volver a la pestaña, si los datos tienen más
// de D_REFRESH_MIN_MS, se recargan solos; los filtros se conservan.
var D_REFRESH_MIN_MS = 5 * 60 * 1000;
function dMaybeAutoRefresh() {
  if (document.visibilityState !== 'visible') return;
  if (dLoading || !dLoadedAt) return;
  if (Date.now() - dLoadedAt.getTime() < D_REFRESH_MIN_MS) return;
  loadDashboard();
}
document.addEventListener('visibilitychange', dMaybeAutoRefresh);
window.addEventListener('focus', dMaybeAutoRefresh);

// ── Filters ──
var dashFiltersAttached = false;
function populateDashFilters() {
  var emps = [];
  dPedidos.forEach(function(p) {
    if (p.Nombre_Empresa && emps.indexOf(p.Nombre_Empresa) < 0 && AUTH.hasCompany(p.Nombre_Empresa)) emps.push(p.Nombre_Empresa);
  });
  emps.sort();
  var sel = document.getElementById('df-emp');
  var prevEmp = sel.value;   // en una recarga, conservar la empresa elegida
  sel.innerHTML = '<option value="">Todas</option>' + emps.map(function(e) {
    return '<option value="' + escHtml(e) + '">' + escHtml(dGetSigla(e)) + ' — ' + escHtml(e) + '</option>';
  }).join('');
  if (prevEmp && emps.indexOf(prevEmp) >= 0) sel.value = prevEmp;

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
  var cons = dPedidosConsig.filter(function(p) { return (!fEmp || p.Nombre_Empresa === fEmp) && r(p.Fecha_Pedido); });
  return {
    ped: ped,
    orders: dBuildOrders(ped),
    cons: cons,
    consOrders: dBuildOrders(cons),
    dev: dDevoluciones.filter(function(d) { return (!fEmp || d.Empresa === fEmp) && r(d.Fecha); }),
    oc: dOrdenes.filter(function(o) { return (!fEmp || o.Empresa_Destino === fEmp || o.Empresa_Origen === fEmp) && r(o.Fecha); }),
    mue: dMuestras.filter(function(m) { return (m.Tipo_Solicitud || 'Despacho') !== 'Produccion' && (!fEmp || m.Empresa === fEmp) && r(m.Fecha_Solicitud); }),
    ree: dReenvases.filter(function(x) { return (!fEmp || x.Empresa === fEmp) && r(x.Fecha); }),
    ing: dIngresos.filter(function(i) { return (!fEmp || i.Empresa_Origen === fEmp || i.Empresa_Destino === fEmp) && r(i.Fecha); }),
    cam: dCambios.filter(function(c) { return (!fEmp || c.Empresa === fEmp) && r(c.Fecha_Solicitud); })
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
    kpiPrev = dKpiSnapshot(prevSlice.orders, prevSlice.ped, prevSlice.dev, fEmp, prevR.desde, prevR.hasta);
  }

  var rangoTxt = (fDesde || fHasta)
    ? '  ·  Rango: ' + (fDesde ? fmtDate(fDesde) : 'inicio') + ' → ' + (fHasta ? fmtDate(fHasta) : 'hoy')
    : '';
  // Hora en que se cargaron los datos (no la de este repintado por cambio de filtro).
  document.getElementById('dash-ts').textContent = 'Datos actualizados: ' + (dLoadedAt || new Date()).toLocaleString('es-CO') + rangoTxt;
  renderRangeChip(fEmp, fDesde, fHasta);

  buildKPIs(cur.orders, cur.ped, cur.dev, cur.oc, fEmp, kpiPrev, fDesde, fHasta, cur.consOrders, cur.cons);
  buildKPIsMoney(cur.orders, cur.ped, cur.dev, fEmp, fDesde, fHasta, kpiPrev);
  buildPedidosPorMes(fEmp);
  buildEntregasPorMes(fEmp);
  buildVentasPorCategoria(cur.ped);
  buildVentasPorDepartamento(cur.ped);
  buildCumplimiento(cur.orders, fEmp, fDesde, fHasta);
  buildTiempos(cur.orders, fEmp, fDesde, fHasta);
  buildTopDemora(cur.orders);
  buildEntregas(cur.orders);
  buildEmpresas(cur.orders, fEmp);
  buildTopProductos(cur.ped);
  buildTopClientes(cur.orders, fEmp);
  buildDevoluciones(cur.dev, cur.orders, fEmp);
  buildTopComerciales(cur.orders, fEmp);
  buildInventario(cur.ped, fEmp);
  buildResumenModulos(cur.orders, cur.dev, cur.ing, cur.oc, cur.mue, cur.ree, cur.cam, fEmp);
  buildExactitudInventario(fEmp);
  buildTopDescuadre(fEmp);
  buildCobertura(fEmp);
  buildAlertasStock(fEmp);
  buildOrdenesCompra(cur.oc);
  buildOtrosModulos(cur.cam, cur.mue, cur.ree);
  buildCalidadDatos(cur.ped, fEmp);
  buildClientesNuevos(fEmp, fDesde, fHasta);
  buildMovimientosPorProducto(fEmp, fDesde, fHasta);
  if (dActiveTab === 'movimientos') buildMovimientosEmpresa();
  if (dActiveTab === 'legalizacion') buildLegalizacionDash();
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
function dRangoLabel(fDesde, fHasta) {
  if (dActivePreset && DASH_PRESET_LBL[dActivePreset]) return DASH_PRESET_LBL[dActivePreset];
  if (!fDesde && !fHasta) return 'Todo el histórico';
  return (fDesde ? fmtDate(fDesde) : 'inicio') + ' → ' + (fHasta ? fmtDate(fHasta) : 'hoy');
}

function renderRangeChip(fEmp, fDesde, fHasta) {
  var el = document.getElementById('dash-range-chip');
  if (!el) return;
  var rango = dRangoLabel(fDesde, fHasta);
  var empTxt = fEmp
    ? ' · <span class="emp">' + escHtml(dGetSigla(fEmp)) + '</span>'
    : ' · Todas las empresas';
  el.innerHTML = '<span class="dash-range-chip">📅 ' + escHtml(rango) + empTxt + '</span>';
}

// Orden "completa" = todas sus líneas entregadas/facturadas (o entregadas por
// el proveedor). Las anuladas no cuentan ni en numerador ni en denominador.
function dOrdenCompleta(o) {
  if (o.estado2 === 'Anulado') return false;
  return o.status === 'Entregado' || o.status === 'Facturado' || o.estado2 === 'Entregado por proveedor';
}

// Todas las órdenes (empresa filtrada, cualquier fecha) — memo por carga+empresa.
var _allOrdersCache = { emp: undefined, orders: null };
function dAllOrders(fEmp) {
  var key = fEmp || '';
  if (_allOrdersCache.emp !== key) {
    _allOrdersCache.emp = key;
    _allOrdersCache.orders = dBuildOrders(dPedidos.filter(function(p) { return !fEmp || p.Nombre_Empresa === fEmp; }));
  }
  return _allOrdersCache.orders;
}

// Tiempo medio pedido→última entrega, coherente con el período: mide las
// órdenes cuya ÚLTIMA entrega cae dentro del rango (entregadas en el período),
// sin importar cuándo se pidieron. Evita el sesgo de "solo las ya entregadas
// de los pedidos del mes" (que descarta las que aún tardarán).
function dLeadTimeMedio(fEmp, desde, hasta) {
  var days = [];
  dAllOrders(fEmp).forEach(function(o) {
    if (!o.fechaUltEntrega || !o.fechaPedido || o.cantEntregada <= 0) return;
    if (!_fechaEnRango(String(o.fechaUltEntrega).slice(0, 10), desde, hasta)) return;
    var dd = Math.round((new Date(o.fechaUltEntrega) - new Date(o.fechaPedido)) / 86400000);
    if (!isNaN(dd) && dd >= 0) days.push(dd);
  });
  return {
    avg: days.length ? Math.round(days.reduce(function(s, v) { return s + v; }, 0) / days.length) : 0,
    n: days.length,
    days: days
  };
}

// ── OTD / cumplimiento de entrega ──
// % de órdenes despachadas a tiempo (vs Fecha_Compromiso), sobre las órdenes
// completas CON compromiso cuya última entrega cae en el período. Los pedidos
// históricos sin compromiso quedan fuera (numerador y denominador).
function dOtdStats(fEmp, desde, hasta) {
  var aTiempo = 0, tarde = 0;
  dAllOrders(fEmp).forEach(function(o) {
    var cl = o.otd ? o.otd.clase : '';
    if (cl !== 'a_tiempo' && cl !== 'tarde') return;
    if (!_fechaEnRango(String(o.fechaUltEntrega).slice(0, 10), desde, hasta)) return;
    if (cl === 'a_tiempo') aTiempo++; else tarde++;
  });
  var total = aTiempo + tarde;
  return { aTiempo: aTiempo, tarde: tarde, total: total, pct: total ? Math.round(aTiempo / total * 100) : null };
}

// Órdenes abiertas ya vencidas frente a su compromiso (a hoy, no del período).
function dAtrasadosAbiertos(fEmp) {
  return dAllOrders(fEmp).filter(function(o) { return o.otd && o.otd.clase === 'atrasado'; });
}

// ── Comparativo vs período anterior ──
// Cifras "de volumen" del período (aditivas) — se comparan con la ventana previa.
function dKpiSnapshot(orders, ped, dev, fEmp, desde, hasta) {
  var valPed = 0, valEnt = 0, valPen = 0;
  orders.forEach(function(o) {
    valPed += o.valorPedido; valEnt += o.valorEntregado; valPen += o.valorPendiente;
  });
  var ordNoAnul = orders.filter(function(o) { return o.estado2 !== 'Anulado'; });
  return {
    ordenes: orders.length,
    lineas: ped.length,
    tasaEntrega: ordNoAnul.length ? Math.round(ordNoAnul.filter(dOrdenCompleta).length / ordNoAnul.length * 100) : 0,
    avgDelivery: dLeadTimeMedio(fEmp, desde, hasta).avg,
    otdPct: dOtdStats(fEmp, desde, hasta).pct,
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
function buildKPIs(orders, ped, dev, oc, fEmp, prev, fDesde, fHasta, consOrders, consPed) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var totalOrdenes = orders.length;
  var abiertas = orders.filter(function(o) { return o.estado2 === 'Abierto'; }).length;
  var lineas = ped.length;

  // Tasa de entrega = % de órdenes 100% despachadas (todas sus líneas
  // entregadas/facturadas). Denominador: órdenes no anuladas del período.
  var ordNoAnul = orders.filter(function(o) { return o.estado2 !== 'Anulado'; });
  var ordCompletas = ordNoAnul.filter(dOrdenCompleta).length;
  var tasaEntrega = ordNoAnul.length ? Math.round(ordCompletas / ordNoAnul.length * 100) : 0;

  // Tiempo prom. entrega: órdenes ENTREGADAS en el período (por fecha de última
  // entrega), no las pedidas en el período. Antigüedad de pendientes: sobre las
  // órdenes del período que siguen abiertas, medida a hoy.
  var lead = dLeadTimeMedio(fEmp, fDesde, fHasta);
  var avgDelivery = lead.avg;
  var delayDays = [];
  orders.forEach(function(o) {
    if (o.estado2 === 'Abierto' && o.esPendiente && o.fechaPedido) {
      var dd2 = Math.round((today - new Date(o.fechaPedido)) / 86400000);
      if (!isNaN(dd2) && dd2 >= 0) delayDays.push(dd2);
    }
  });

  var devPendientes = dev.filter(function(d) { return (d.Estado || '') === 'Pendiente'; }).length;
  var avgDelay = delayDays.length ? Math.round(delayDays.reduce(function(s, v) { return s + v; }, 0) / delayDays.length) : 0;

  var stk = dStockTotals(fEmp);

  var stockSub = stk.disponible
    ? (stk.uds.toLocaleString('es-CO') + ' uds disponibles' + (stk.negativos ? ' · ⚠️ ' + stk.negativos + ' con saldo negativo' : ''))
    : 'sin snapshot';

  var empQS = fEmp ? ('&empresa=' + encodeURIComponent(dGetSigla(fEmp))) : '';
  var p = prev || null;

  var html = '';
  html += kpiCard('', totalOrdenes.toLocaleString('es-CO'), 'Total ordenes', abiertas + ' abiertas · ' + lineas.toLocaleString('es-CO') + ' lineas',
    p && dDelta(totalOrdenes, p.ordenes, true), 'pedidos.html' + (empQS ? '?' + empQS.slice(1) : ''));

  // Pedidos en consignación del mismo período/empresa: no suman a "Total
  // ordenes" (no son ventas), pero sus despachos sí están en Entregas por mes.
  // Sin enlace: Pedidos no tiene filtro por consignación y mostraría todo.
  var consUds = consPed.reduce(function(s, l) { return s + (Number(l.Cantidad) || 0); }, 0);
  html += kpiCard('purple', consOrders.length.toLocaleString('es-CO'), 'Pedidos en consignación',
    'no suman a Total ordenes · ' + consPed.length.toLocaleString('es-CO') + ' lineas · ' + consUds.toLocaleString('es-CO') + ' uds');

  html += kpiCard('teal', tasaEntrega + '%', 'Tasa de entrega', ordCompletas.toLocaleString('es-CO') + ' / ' + ordNoAnul.length.toLocaleString('es-CO') + ' ordenes completas (a hoy)',
    p && dDelta(tasaEntrega, p.tasaEntrega, true));

  // ── Cumplimiento de entrega / OTD ──
  var otd = dOtdStats(fEmp, fDesde, fHasta);
  var atrasados = dAtrasadosAbiertos(fEmp);
  var atrDias = atrasados.length ? Math.round(atrasados.reduce(function(s, o) { return s + (o.otd.dias || 0); }, 0) / atrasados.length) : 0;
  html += kpiCard('teal', otd.pct == null ? '—' : otd.pct + '%', 'Entregas a tiempo (OTD)',
    otd.total ? (otd.aTiempo.toLocaleString('es-CO') + ' / ' + otd.total.toLocaleString('es-CO') + ' ordenes completas con compromiso') : 'sin ordenes con compromiso en el período',
    (p && otd.pct != null && p.otdPct != null) ? dDelta(otd.pct, p.otdPct, true) : null);
  html += kpiCard('red', atrasados.length.toLocaleString('es-CO'), 'Pedidos atrasados',
    'ordenes abiertas vencidas vs compromiso (a hoy)', null,
    'pedidos.html?otd=atrasado' + empQS);
  html += kpiCard('orange', atrDias + ' dias', 'Dias de atraso prom.', atrasados.length + ' pedidos atrasados');

  html += kpiCard('green', avgDelivery + ' dias', 'Tiempo prom. entrega', lead.n + ' ordenes entregadas en el período',
    p && dDelta(avgDelivery, p.avgDelivery, false));
  html += kpiCard('orange', avgDelay + ' dias', 'Antiguedad prom. de pendientes', delayDays.length + ' ordenes del período aun abiertas');
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
  var cur = dKpiSnapshot(orders, ped, dev, fEmp, fDesde, fHasta);
  var p = prev || null;

  // Ticket promedio por orden.
  var ticket = orders.length ? cur.valorPedido / orders.length : 0;

  // $ bloqueado por cartera (dentro del rango).
  var valBloq = 0;
  orders.forEach(function(o) { if (o.estado2 === 'Bloqueado por cartera') valBloq += o.valorPedido; });

  // Concentración: % del $ pedido en el top-5 de clientes del período
  // (consolidados por identificación, mismo criterio que "Top clientes").
  var vals = dClientesConsolidados(orders).map(function(c) { return c.valor; })
    .sort(function(a, b) { return b - a; });
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
  var b = { recibidos: 0, parciales: 0, entregados: 0, alistados: 0, cerrados: 0, anulados: 0, bloqueados: 0, pendAprob: 0, entProv: 0 };

  orders.forEach(function(o) {
    switch (o.estado2) {
      case 'Anulado': b.anulados++; return;
      case 'Bloqueado por cartera': b.bloqueados++; return;
      case 'Pendiente de aprobación': b.pendAprob++; return;
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
    { label: 'Pend. aprobación', val: b.pendAprob, color: '#d97706' },
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
function buildEmpresas(orders, fEmp) {
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

  // Tendencia mensual (últimos 12 meses) por empresa — histórico completo,
  // independiente del filtro Desde/Hasta (mismo criterio que "Top clientes").
  var pedHist = fEmp ? dPedidos.filter(function(p) { return p.Nombre_Empresa === fEmp; }) : dPedidos;
  var ordersHist = dBuildOrders(pedHist);
  var trend = dTrend12mByKey(ordersHist, function(o) { return o.sigla || null; });

  var html = '<div class="hbar-chart">';
  empArr.forEach(function(e) {
    var pct = maxVal > 0 ? Math.max(3, (e.uds / maxVal) * 100) : 3;
    var color = EMP_COLORS[e.sigla] || '#718096';
    var serieMes = trend.byKey[e.sigla] || {};
    var serieValor = trend.meses.map(function(m) { return serieMes[m] ? serieMes[m].valor : 0; });
    var serieUds = trend.meses.map(function(m) { return serieMes[m] ? serieMes[m].uds : 0; });
    html += '<div class="hbar-row">' +
      '<div class="hbar-label">' + escHtml(e.sigla) + '</div>' +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%;background:' + color + '">' + e.ordenes + ' ord</div></div>' +
      '<div class="hbar-value">' + e.uds.toLocaleString('es-CO') + ' uds</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' +
        dSparklineCell(trend.meses, serieValor, '#1a5276', dMoneyM, 60, 20) +
        dSparklineCell(trend.meses, serieUds, '#27ae60', function(v) { return v.toLocaleString('es-CO') + ' uds'; }, 60, 20) +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  html += '<div style="padding:8px 2px 0;font-size:0.72rem;color:#a0aec0">Tendencia (12m): $ pedido y uds por mes · ▲/▼/→ compara el último mes vs. el anterior.</div>';

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

// ── Resolución de cliente por identificación (NIT/cédula) ──
// Consolida por dígitos de la identificación y trae el nombre canónico de
// ClientesUnicos. Tolera el dígito de verificación (NIT de 10 díg ↔ base de 9).
function _nitDigits(s) { return String(s || '').replace(/\D/g, ''); }
function _nitVariants(d) {
  if (!d) return [];
  return d.length === 10 ? [d, d.slice(0, 9)] : [d];
}
var _cliNitMap = null;   // dígitos → { ident, nombre } — se arma 1 vez por carga
function _ensureCliNitMap() {
  if (_cliNitMap) return;
  _cliNitMap = {};
  var seen = {};
  (dClientes || []).forEach(function(c) {
    var d = _nitDigits(c.Identificacion);
    if (d) seen[d] = 1;
  });
  (dClientes || []).forEach(function(c) {
    var d = _nitDigits(c.Identificacion);
    if (!d) return;
    // Si el maestro tiene el NIT con y sin dígito de verificación (901737428 y
    // 9017374281), la identificación canónica es la base de 9 dígitos.
    var ident = (d.length === 10 && seen[d.slice(0, 9)]) ? d.slice(0, 9) : d;
    var entry = { ident: ident, nombre: (c.Cliente || '').trim() };
    _nitVariants(d).forEach(function(k) { if (!_cliNitMap[k]) _cliNitMap[k] = entry; });
  });
}
// { key, nombre, nd, fromMaster } para agrupar un pedido por cliente único.
function dClienteKey(nit, nombrePedido) {
  _ensureCliNitMap();
  var d = _nitDigits(nit);
  var nm = (nombrePedido || '').trim();
  if (d) {
    var vs = _nitVariants(d);
    for (var i = 0; i < vs.length; i++) {
      var hit = _cliNitMap[vs[i]];
      if (hit) return { key: 'id:' + hit.ident, nombre: hit.nombre || nm || hit.ident, nd: hit.ident, fromMaster: true };
    }
    return { key: 'id:' + d, nombre: nm || d, nd: d, fromMaster: false };   // sin match en el maestro
  }
  return { key: 'nom:' + nm.toLowerCase(), nombre: nm || '—', nd: '', fromMaster: false };
}

// 2ª pasada: funde grupos cuyo NIT es idéntico salvo UN dígito extra al final
// (caso típico: un pedido trae el NIT sin dígito de verificación y otro con él).
// NO fusiona NITs de igual longitud que difieren en algún dígito — eso es un
// error de captura y debe verse como dos filas.
// redirects (opcional): si se pasa un objeto, se le registra other.key → base.key
// por cada fusión, para que quien haya agrupado OTRO subconjunto de órdenes con
// las mismas keys "crudas" (p.ej. dResolveDvKey) pueda aplicar la misma fusión
// sin recalcularla.
function _mergeDvGroups(map, redirects) {
  var gs = Object.keys(map).map(function(k) { return map[k]; })
    .filter(function(g) { return g.nd && g.nd.length >= 8; })
    .sort(function(a, b) { return a.nd.length - b.nd.length; });
  gs.forEach(function(base) {
    if (base._merged) return;
    gs.forEach(function(other) {
      if (other === base || other._merged) return;
      if (other.nd.length === base.nd.length + 1 && other.nd.slice(0, -1) === base.nd) {
        base.uds += other.uds; base.valor += other.valor; base.ordenes += other.ordenes;
        Object.keys(other.empresas).forEach(function(s) { base.empresas[s] = true; });
        if (!base.fromMaster && other.fromMaster) base.cliente = other.cliente;
        base.fromMaster = base.fromMaster || other.fromMaster;
        other._merged = true;
        delete map[other.key];
        if (redirects) redirects[other.key] = base.key;
      }
    });
  });
}

// Calcula la fusión DV (misma regla que _mergeDvGroups) sobre un conjunto de
// órdenes de REFERENCIA (el histórico completo del cliente) y devuelve una
// función rawKey → key final. Se usa para que el ranking histórico de "top
// clientes" y cualquier otro recorte (período filtrado, ventana de meses del
// sparkline de tendencia) agrupen SIEMPRE al mismo cliente bajo la misma key,
// aunque ese recorte por sí solo no tenga ambas variantes de NIT para fusionar.
function dResolveDvKey(ordersRef) {
  var map = {}, redirects = {};
  ordersRef.forEach(function(o) {
    var r = dClienteKey(o.nit, o.cliente);
    if (!r.nombre || r.nombre === '—') return;
    if (!map[r.key]) map[r.key] = { key: r.key, nd: r.nd, fromMaster: r.fromMaster, uds: 0, valor: 0, ordenes: 0, empresas: {} };
  });
  _mergeDvGroups(map, redirects);
  return function(rawKey) { return redirects[rawKey] || rawKey; };
}

// Consolida un conjunto de órdenes por cliente usando una identidad ya
// resuelta (dResolveDvKey) en vez de recalcular la fusión DV localmente.
function dGroupByResolvedKey(orders, resolveKey) {
  var map = {};
  orders.forEach(function(o) {
    var r = dClienteKey(o.nit, o.cliente);
    if (!r.nombre || r.nombre === '—') return;
    var key = resolveKey(r.key);
    var m = map[key] || (map[key] = { key: key, cliente: r.nombre, uds: 0, valor: 0, ordenes: 0, empresas: {} });
    m.uds += o.cantPedida;
    m.valor += o.valorPedido;
    m.ordenes++;
    m.empresas[o.sigla] = true;
    if (r.fromMaster) m.cliente = r.nombre;
  });
  return map;
}

// Agrupa órdenes por cliente único: consolida por identificación (dClienteKey)
// + fusiona el dígito de verificación (_mergeDvGroups). Usado por "Top clientes"
// y por la concentración top-5 de buildKPIsMoney.
function dClientesConsolidados(orders) {
  var map = {};
  orders.forEach(function(o) {
    var r = dClienteKey(o.nit, o.cliente);
    if (!r.nombre || r.nombre === '—') return;
    var m = map[r.key] || (map[r.key] = { key: r.key, cliente: r.nombre, uds: 0, valor: 0, ordenes: 0, empresas: {}, nd: r.nd, fromMaster: r.fromMaster });
    m.uds += o.cantPedida;
    m.valor += o.valorPedido;
    m.ordenes++;
    m.empresas[o.sigla] = true;
    if (!m.fromMaster && r.fromMaster) { m.cliente = r.nombre; m.fromMaster = true; }
  });
  _mergeDvGroups(map);
  return Object.keys(map).map(function(k) { return map[k]; });
}

// Últimos 12 meses (incluye el actual), como ['2025-10', ..., '2026-09'].
function dUltimos12Meses() {
  var out = [];
  var base = new Date(); base.setDate(1);
  for (var i = 11; i >= 0; i--) {
    var dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}

// Serie mensual ($ valor y uds) últimos 12 meses, agrupada por una key
// arbitraria — SIEMPRE sobre el histórico completo (independiente del
// filtro Desde/Hasta del dashboard, igual criterio que "Pedidos por mes").
// keyFn(order) → string de agrupación, o null/'' para excluir la orden.
// Usado por la tendencia de "Top clientes", "Top comerciales" y "Empresas".
function dTrend12mByKey(ordersRef, keyFn) {
  var meses = dUltimos12Meses();
  var desdeMes = meses[0];
  var byKey = {};
  ordersRef.forEach(function(o) {
    var mes = String(o.fechaPedido || '').slice(0, 7);
    if (!dEsMes(mes) || mes < desdeMes) return;
    var key = keyFn(o);
    if (!key) return;
    if (!byKey[key]) byKey[key] = {};
    if (!byKey[key][mes]) byKey[key][mes] = { valor: 0, uds: 0 };
    byKey[key][mes].valor += o.valorPedido;
    byKey[key][mes].uds += o.cantPedida;
  });
  return { meses: meses, byKey: byKey };
}

// Tendencia por cliente: resolveKey aplica la misma fusión de NIT que el
// ranking histórico de "Top clientes".
function dClienteTrend12m(ordersRef, resolveKey) {
  var t = dTrend12mByKey(ordersRef, function(o) {
    var r = dClienteKey(o.nit, o.cliente);
    if (!r.nombre || r.nombre === '—') return null;
    return resolveKey(r.key);
  });
  return { meses: t.meses, byClient: t.byKey };
}

// Mini gráfico de tendencia (SVG inline, sin dependencias) — línea + punto final.
// Parte siempre de 0 (no del mínimo de la serie) para no exagerar variaciones.
function dSparkline(values, color, w, h) {
  w = w || 84; h = h || 24;
  if (!values.some(function(v) { return v > 0; })) {
    return '<span style="color:#cbd5e0;font-size:0.72rem">sin datos</span>';
  }
  var max = Math.max.apply(null, values) || 1;
  var n = values.length;
  var pts = values.map(function(v, i) {
    var x = n > 1 ? (i / (n - 1)) * w : w / 2;
    var y = h - 2 - (v / max) * (h - 4);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  var last = pts[pts.length - 1].split(',');
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.3" fill="' + color + '"/>' +
  '</svg>';
}

// Señalización ▲/▼/→ del último mes vs. el anterior (mismo cálculo que los
// deltas de los KPI: dDelta). null si el mes anterior es 0 (sin base de
// comparación — cliente nuevo o sin compras ese mes).
function dTrendBadge(serie) {
  var d = dDelta(serie[serie.length - 1], serie[serie.length - 2], true);
  if (!d) return '';
  var color = d.cls === 'up' ? '#27ae60' : (d.cls === 'down' ? '#e74c3c' : '#a0aec0');
  return '<span style="font-size:0.7rem;font-weight:700;color:' + color + ';white-space:nowrap">' + d.arrow + ' ' + d.txt + '</span>';
}

// Sparkline + señalización de tendencia + tooltip (title) con el detalle mes a mes.
function dSparklineCell(meses, serie, color, fmt, w, h) {
  var tip = meses.map(function(m, i) { return dMesLbl(m) + ': ' + fmt(serie[i]); }).join('\n');
  return '<span title="' + escHtml(tip) + '" style="display:flex;flex-direction:column;gap:2px;align-items:flex-start">' +
    dSparkline(serie, color, w, h) + dTrendBadge(serie) +
  '</span>';
}

// ── 5. Top Clientes ──
// Ranking ESTABLE por valor $ histórico (no cambia al mover el filtro
// Desde/Hasta) + tendencia mensual (últimos 12 meses) de $ y uds por cliente.
// Las columnas $ Pedido / Uds / Ord. siguen mostrando el período filtrado.
function buildTopClientes(orders, fEmp) {
  var pedHist = fEmp ? dPedidos.filter(function(p) { return p.Nombre_Empresa === fEmp; }) : dPedidos;
  var ordersHist = dBuildOrders(pedHist);

  var top = dClientesConsolidados(ordersHist)
    .sort(function(a, b) { return b.valor - a.valor; })
    .slice(0, 10);

  var resolveKey = dResolveDvKey(ordersHist);
  var periodo = dGroupByResolvedKey(orders, resolveKey);
  var trend = dClienteTrend12m(ordersHist, resolveKey);

  var tbody = document.getElementById('tb-clientes');
  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px">Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = top.map(function(r) {
    var p = periodo[r.key];
    var empTags = Object.keys(r.empresas).sort().map(function(s) {
      var color = EMP_COLORS[s] || '#718096';
      return '<span class="sigla-badge" style="background:' + color + '20;color:' + color + '">' + escHtml(s) + '</span>';
    }).join(' ');
    var serieMes = trend.byClient[r.key] || {};
    var serieValor = trend.meses.map(function(m) { return serieMes[m] ? serieMes[m].valor : 0; });
    var serieUds = trend.meses.map(function(m) { return serieMes[m] ? serieMes[m].uds : 0; });
    return '<tr data-href="clientes.html?buscar=' + encodeURIComponent(r.cliente) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.cliente) + '</td>' +
      '<td>' + dSparklineCell(trend.meses, serieValor, '#1a5276', dMoneyM) + '</td>' +
      '<td>' + dSparklineCell(trend.meses, serieUds, '#27ae60', function(v) { return v.toLocaleString('es-CO') + ' uds'; }) + '</td>' +
      '<td class="money" style="font-weight:700;color:#2980b9">' + dMoneyM(p ? p.valor : 0) + '</td>' +
      '<td class="money">' + (p ? p.uds : 0).toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + (p ? p.ordenes : 0) + '</td>' +
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
function buildTopComerciales(orders, fEmp) {
  var map = {};
  var sinComercial = 0, sinPrecio = 0;
  var totPed = 0, totPen = 0, totCer = 0, totBloq = 0;

  orders.forEach(function(o) {
    sinPrecio += o.lineasSinPrecio;
    var com = o.comercial;
    if (!com) { sinComercial++; return; }
    if (!map[com]) map[com] = { comercial: com, ordenes: 0, vPed: 0, vEnt: 0, vPen: 0, vCer: 0, vBloq: 0 };
    var m = map[com];
    // Recibido + Cerrado = se cerró sin entregarse (Entregado ya queda en 0
    // para estas líneas) — no cuenta como Entregado ni como Pendiente, así
    // que se aparta aquí para que Pedido = Entregado + Pendiente + Cerrado.
    var vCerrado = (o.status === 'Recibido' && o.estado2 === 'Cerrado') ? (o.valorPedido - o.valorEntregado) : 0;
    // Bloqueado por cartera: lo que no se entregó y tampoco cuenta como
    // Pendiente (las líneas bloqueadas se excluyen de Pendiente). Se resta el
    // pendiente por si la orden mezcla líneas bloqueadas y abiertas.
    var vBloq = (o.estado2 === 'Bloqueado por cartera') ? (o.valorPedido - o.valorEntregado - o.valorPendiente) : 0;
    m.ordenes++;
    m.vPed += o.valorPedido;
    m.vEnt += o.valorEntregado;
    m.vPen += o.valorPendiente;
    m.vCer += vCerrado;
    m.vBloq += vBloq;
    totPed += o.valorPedido;
    totPen += o.valorPendiente;
    totCer += vCerrado;
    totBloq += vBloq;
  });

  var arr = Object.values(map);
  arr.sort(function(a, b) { return b.vPed - a.vPed; });
  arr = arr.slice(0, 10);

  var subEl = document.getElementById('com-sub');
  if (subEl) subEl.textContent = 'Pedido ' + dMoneyM(totPed) + ' · pendiente ' + dMoneyM(totPen) + ' · cerrado s/entregar ' + dMoneyM(totCer) + ' · bloqueado cartera ' + dMoneyM(totBloq);

  var notaEl = document.getElementById('com-nota');
  if (notaEl) {
    var notas = ['"Pendiente" = ventas aún por despachar: excluye pedidos anulados, cerrados, alistados y bloqueados por cartera (mismo criterio que Reportes › Valorización ventas). "Cerrado s/entregar" = pedidos Recibido + Cerrado (se cerraron sin despacharse). "Bloqueado cartera" = lo no entregado de pedidos con Estado 2 Bloqueado por cartera (no cuenta como Pendiente ni como Cerrado). Aun así, otros estados (Parcial+Cerrado) pueden dejar un residuo fuera de las cuatro columnas. "% Cumpl." = (Entregado + Cerrado s/entregar) / Pedido: los pedidos cerrados sin entregar cuentan como cumplidos, por eso puede dar 100% aunque lo entregado sea menor (Entregado / Pedido = porcentaje de lo realmente despachado).'];
    if (sinPrecio > 0) notas.push('⚠️ ' + sinPrecio.toLocaleString('es-CO') + ' línea(s) sin precio no suman al valor');
    if (sinComercial > 0) notas.push(sinComercial.toLocaleString('es-CO') + ' orden(es) sin comercial asignado');
    notas.push('Las columnas "Tend." muestran los últimos 12 meses (histórico, no el período filtrado); ▲/▼/→ compara el último mes vs. el anterior.');
    notaEl.textContent = notas.join(' · ');
    notaEl.style.display = notas.length ? 'block' : 'none';
  }

  var tbody = document.getElementById('tb-comerciales');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#a0aec0;padding:20px">Sin datos</td></tr>';
    return;
  }

  // Tendencia mensual (últimos 12 meses) por comercial — histórico completo,
  // independiente del filtro Desde/Hasta (mismo criterio que "Top clientes").
  var pedHist = fEmp ? dPedidos.filter(function(p) { return p.Nombre_Empresa === fEmp; }) : dPedidos;
  var ordersHist = dBuildOrders(pedHist);
  var trend = dTrend12mByKey(ordersHist, function(o) { return o.comercial || null; });

  tbody.innerHTML = arr.map(function(r) {
    // El color de Pendiente depende de cuánto pesa el pendiente en el pedido
    // (≤10% verde, ≤30% naranja, más rojo), no de lo entregado.
    var pesoPen = r.vPed > 0 ? r.vPen / r.vPed : 0;
    var penColor = pesoPen <= 0.10 ? '#27ae60' : pesoPen <= 0.30 ? '#e67e22' : '#e74c3c';
    var pctCumpl = r.vPed > 0 ? Math.round(((r.vEnt + r.vCer) / r.vPed) * 100) : 0;
    var cumplColor = pctCumpl >= 75 ? '#27ae60' : pctCumpl >= 40 ? '#e67e22' : '#e74c3c';
    var serieMes = trend.byKey[r.comercial] || {};
    var serieValor = trend.meses.map(function(m) { return serieMes[m] ? serieMes[m].valor : 0; });
    var serieUds = trend.meses.map(function(m) { return serieMes[m] ? serieMes[m].uds : 0; });
    return '<tr data-href="pedidos.html?buscar=' + encodeURIComponent(r.comercial) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.comercial) + '">' + escHtml(r.comercial) + '</td>' +
      '<td>' + dSparklineCell(trend.meses, serieValor, '#1a5276', dMoneyM, 64, 20) + '</td>' +
      '<td>' + dSparklineCell(trend.meses, serieUds, '#27ae60', function(v) { return v.toLocaleString('es-CO') + ' uds'; }, 64, 20) + '</td>' +
      '<td class="money">' + r.ordenes + '</td>' +
      '<td class="money" style="font-weight:700;color:#2980b9">' + dMoneyM(r.vPed) + '</td>' +
      '<td class="money" style="color:#27ae60">' + dMoneyM(r.vEnt) + '</td>' +
      '<td class="money" style="font-weight:700;color:' + penColor + '">' + dMoneyM(r.vPen) + '</td>' +
      '<td class="money" style="color:#718096">' + dMoneyM(r.vCer) + '</td>' +
      '<td class="money" style="color:#718096">' + dMoneyM(r.vBloq) + '</td>' +
      '<td class="money" style="font-weight:700;color:' + cumplColor + '">' + pctCumpl + '%</td>' +
    '</tr>';
  }).join('');
}

// ── Inventario valorizado ──
// Precio de valorización, en este orden:
//   1) Mayorista de la Lista de precios de la propia empresa;
//   2) si no tiene (o está en 0), Dealer de la propia empresa;
//   3) si no tiene ninguno, el precio del MISMO producto en otra empresa
//      (Mayorista y, si no, Dealer; con varias empresas, el menor);
//   4) si tampoco existe en ninguna empresa, queda en $0 y se avisa.
// Empareja (empresa, producto) normalizados como reportes.js. Si un producto trae
// varios precios (IASO: mismo producto con otro proveedor) se toma el menor.
// Solo saldos positivos del snapshot Kardex (los negativos ya se avisan aparte
// y no restan valor).
function dNormLp(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

// { emp: 'empresa||producto' → { mayorista, dealer },
//   prod: 'producto' → { mayorista: {precio, emp}, dealer: {precio, emp} } }  (menor precio entre empresas)
function dPrecioIndex() {
  if (dPrecioIdx) return dPrecioIdx;
  var emp = {}, prod = {};
  (dListaPrecios || []).forEach(function(lp) {
    var tipo = dNormLp(lp.Tipo_Precio);
    if (tipo !== 'mayorista' && tipo !== 'dealer') return;
    var precio = Number(lp.Precio) || 0;
    if (precio <= 0) return;
    var kp = dNormLp(lp.Producto);
    var e = emp[dNormLp(lp.Empresa) + '||' + kp] || (emp[dNormLp(lp.Empresa) + '||' + kp] = {});
    if (!e[tipo] || precio < e[tipo]) e[tipo] = precio;
    var x = prod[kp] || (prod[kp] = {});
    if (!x[tipo] || precio < x[tipo].precio) x[tipo] = { precio: precio, emp: dGetSigla(lp.Empresa) };
  });
  dPrecioIdx = { emp: emp, prod: prod };
  return dPrecioIdx;
}

// Devuelve { porEmp: { sigla: fila }, total: fila } con la misma forma de fila:
// { may, dea, ext, total, nMay, nDea, nExt, nSin, udsSin, prodsDea[], prodsExt[], prodsSin[] }.
function dInventarioValorizado(empresas) {
  var saldos = (dExist && dExist.saldos) || {};
  var idx = dPrecioIndex();
  function fila() { return { may: 0, dea: 0, ext: 0, total: 0, nMay: 0, nDea: 0, nExt: 0, nSin: 0, udsSin: 0, prodsDea: [], prodsExt: [], prodsSin: [] }; }
  var porEmp = {}, total = fila();
  empresas.forEach(function(e) { porEmp[e.sigla] = fila(); });

  Object.keys(saldos).forEach(function(prodKey) {
    var perEmp = saldos[prodKey] || {};
    var kp = dNormLp(prodKey);
    empresas.forEach(function(e) {
      var uds = Number(perEmp[e.value]) || 0;
      if (uds <= 0) return;
      var p = idx.emp[dNormLp(e.value) + '||' + kp];
      var x = idx.prod[kp];
      var otra = x && (x.mayorista || x.dealer);   // precio de otra empresa (Mayorista antes que Dealer)
      var etiqueta = dGetSigla(e.value) + ' · ' + prodKey;
      [porEmp[e.sigla], total].forEach(function(r) {
        if (p && p.mayorista) { r.may += uds * p.mayorista; r.total += uds * p.mayorista; r.nMay++; }
        else if (p && p.dealer) { r.dea += uds * p.dealer; r.total += uds * p.dealer; r.nDea++; r.prodsDea.push(etiqueta); }
        else if (otra) {
          r.ext += uds * otra.precio; r.total += uds * otra.precio; r.nExt++;
          r.prodsExt.push(etiqueta + ' → $' + otra.precio.toLocaleString('es-CO') + ' (' + (x.mayorista ? 'Mayorista' : 'Dealer') + ' de ' + otra.emp + ')');
        }
        else { r.nSin++; r.udsSin += uds; r.prodsSin.push(etiqueta); }
      });
    });
  });
  return { porEmp: porEmp, total: total };
}

// Tabla "Inventario valorizado por empresa" para el Resumen de inventario.
function dInventarioValorizadoHtml(empresas, v) {
  if (!v) {
    return '<div style="margin-top:16px;padding:8px 12px;border-radius:6px;background:#f7fafc;color:#a0aec0;font-size:0.78rem">' +
      '💰 No se pudo cargar la Lista de precios: el inventario no se valorizó. Usa ↻ Actualizar para reintentar.</div>';
  }

  function lista(arr) {
    var vis = arr.slice(0, 12).map(escHtml).join('\n');
    return vis + (arr.length > 12 ? '\n… y ' + (arr.length - 12) + ' más' : '');
  }
  function celdaDealer(r) {
    if (!r.nDea) return '<span style="color:#cbd5e0">—</span>';
    return '<span title="' + escHtml('Valorizados a Dealer (sin precio Mayorista):\n') + lista(r.prodsDea) + '" style="cursor:help">' +
      dMoneyM(r.dea) + ' <span style="color:#a0aec0;font-size:0.72rem">(' + r.nDea + ' prod.)</span></span>';
  }
  function celdaExt(r) {
    if (!r.nExt) return '<span style="color:#cbd5e0">—</span>';
    return '<span title="' + escHtml('Sin precio en su empresa: se usó el del mismo producto en otra empresa:\n') + lista(r.prodsExt) + '" style="cursor:help">' +
      dMoneyM(r.ext) + ' <span style="color:#a0aec0;font-size:0.72rem">(' + r.nExt + ' prod.)</span></span>';
  }
  function celdaSin(r) {
    if (!r.nSin) return '<span style="color:#cbd5e0">—</span>';
    return '<span title="' + escHtml('Con stock y sin precio Mayorista ni Dealer en ninguna empresa (quedan en $0):\n') + lista(r.prodsSin) + '" style="cursor:help;color:#c0392b;font-weight:600">' +
      r.nSin + ' prod. <span style="font-weight:400;font-size:0.72rem">(' + Math.round(r.udsSin).toLocaleString('es-CO') + ' uds)</span></span>';
  }
  function filaHtml(label, r, esTotal) {
    return '<tr' + (esTotal ? ' style="font-weight:700;background:#f7fafc"' : '') + '>' +
      '<td>' + label + '</td>' +
      '<td class="money" style="font-weight:700;color:#1a5276">' + dMoneyM(r.total) + '</td>' +
      '<td class="money">' + (r.may ? dMoneyM(r.may) : '<span style="color:#cbd5e0">—</span>') + '</td>' +
      '<td class="money">' + celdaDealer(r) + '</td>' +
      '<td class="money">' + celdaExt(r) + '</td>' +
      '<td class="money">' + celdaSin(r) + '</td>' +
    '</tr>';
  }

  var rows = '';
  var visibles = empresas.filter(function(e) {
    var r = v.porEmp[e.sigla];
    return r && (r.total > 0 || r.nSin > 0);
  });
  visibles.forEach(function(e) {
    var color = EMP_COLORS[e.sigla] || '#718096';
    rows += filaHtml('<span style="font-weight:700;color:' + color + '">' + escHtml(e.sigla) + '</span>', v.porEmp[e.sigla], false);
  });
  if (visibles.length > 1) rows += filaHtml('Total', v.total, true);

  var html = '<div style="margin-top:18px">' +
    '<div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600;margin-bottom:6px">💰 Inventario valorizado por empresa</div>';
  if (!rows) {
    return html + '<div style="color:#a0aec0;font-size:0.8rem">Sin existencias para valorizar</div></div>';
  }
  html += '<div style="overflow-x:auto"><table class="mini-table">' +
    '<thead><tr><th>Empresa</th><th style="text-align:right">Valor total</th><th style="text-align:right">A Mayorista</th>' +
    '<th style="text-align:right" title="Productos sin precio Mayorista valorizados con su precio Dealer">A Dealer</th>' +
    '<th style="text-align:right" title="Productos sin Mayorista ni Dealer en su empresa, valorizados con el precio del mismo producto en otra empresa">De otra empresa</th>' +
    '<th style="text-align:right" title="Productos con stock sin precio Mayorista ni Dealer en ninguna empresa: no suman al valor">Sin precio</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    '<div style="font-size:0.72rem;color:#a0aec0;margin-top:6px">Stock (saldos positivos del snapshot Kardex, a hoy) × precio Mayorista de la Lista de precios. ' +
    'Los productos sin precio Mayorista se valoran a <b>Dealer</b> (columna "A Dealer"); si no tienen ninguno de los dos en su empresa, se usa el precio del mismo producto en otra empresa (Mayorista y, si no, Dealer; el menor) en la columna "De otra empresa"; ' +
    'si tampoco existe en ninguna, quedan en $0 (columna "Sin precio"). Pasa el cursor sobre esas columnas para ver los productos.</div>';
  return html + '</div>';
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

  // Apartado: parte del comprometido que YA tiene stock reservado sin
  // remisionar (apartados_pedido + OC de traslado abiertas). NO se vuelve
  // a restar del stock — ya está dentro de "Comprometido".
  var empSet = {};
  empresas.forEach(function(e) { empSet[e.value] = true; });
  var totalApartado = 0;
  var apaMap = (dExist && dExist.apartadoPorEmpresa) || {};
  Object.keys(apaMap).forEach(function(prod) {
    Object.keys(apaMap[prod]).forEach(function(emp) {
      if (empSet[emp]) totalApartado += (Number(apaMap[prod][emp]) || 0);
    });
  });

  var html = '<div style="display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Stock total</div><div style="font-size:1.4rem;font-weight:800;color:#2980b9">' + totalStock.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Comprometido</div><div style="font-size:1.4rem;font-weight:800;color:#e67e22">' + totalPend.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600" title="Stock apartado a pedidos sin remisionar (parte del comprometido)">Apartado 🔒</div><div style="font-size:1.4rem;font-weight:800;color:#b45309">' + totalApartado.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:110px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Disponible</div><div style="font-size:1.4rem;font-weight:800;color:' + ((totalStock - totalPend) >= 0 ? '#27ae60' : '#e74c3c') + '">' + (totalStock - totalPend).toLocaleString('es-CO') + '</div></div>';
  var vInv = dListaPrecios !== null ? dInventarioValorizado(empresas) : null;
  if (vInv) {
    html += '<div style="flex:1;min-width:110px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600" title="Stock a precio Mayorista (Dealer si el producto no tiene Mayorista; si no tiene ninguno, el precio del mismo producto en otra empresa). Detalle por empresa abajo.">Valor inventario 💰</div><div style="font-size:1.4rem;font-weight:800;color:#1a5276">' + dMoneyM(vInv.total.total) + '</div></div>';
  }
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

  html += dInventarioValorizadoHtml(empresas, vInv);

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
function buildTiempos(orders, fEmp, fDesde, fHasta) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // Entregadas: órdenes cuya última entrega cae en el período (dLeadTimeMedio).
  // Pendientes: órdenes del período aún abiertas, envejecidas a hoy.
  var deliveryVals = dLeadTimeMedio(fEmp, fDesde, fHasta).days;
  var pendingVals = [];

  orders.forEach(function(o) {
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

// ── Cumplimiento de entrega / OTD ──
function buildCumplimiento(orders, fEmp, fDesde, fHasta) {
  var counts = { a_tiempo: 0, tarde: 0, atrasado: 0, en_plazo: 0 };
  var atrasados = [];
  dAllOrders(fEmp).forEach(function(o) {
    var cl = o.otd ? o.otd.clase : '';
    if (counts[cl] != null) counts[cl]++;
    if (cl === 'atrasado') atrasados.push(o);
  });
  var otd = dOtdStats(fEmp, fDesde, fHasta);

  var el = document.getElementById('chart-cumplimiento');
  var subEl = document.getElementById('cumplimiento-sub');
  if (subEl) subEl.textContent = otd.pct == null
    ? 'sin órdenes completas con compromiso en el período'
    : ('OTD ' + otd.pct + '% · ' + otd.aTiempo + '/' + otd.total + ' a tiempo en el período');
  var segData = [
    { label: 'A tiempo (entregadas)', val: counts.a_tiempo, color: '#27ae60' },
    { label: 'Tarde (entregadas)',    val: counts.tarde,    color: '#e74c3c' },
    { label: 'Atrasadas (abiertas)',  val: counts.atrasado, color: '#e67e22' },
    { label: 'En plazo (abiertas)',   val: counts.en_plazo, color: '#2980b9' }
  ];
  var total = segData.reduce(function(s, d) { return s + d.val; }, 0);
  el.innerHTML = total
    ? '<div style="font-size:0.72rem;color:#718096;margin-bottom:8px">Estado actual de las órdenes con fecha de compromiso</div>' + renderSegBar(segData, total)
    : '<div style="color:#a0aec0;text-align:center;padding:20px">Aún no hay pedidos con fecha de compromiso</div>';

  var tbody = document.getElementById('tb-atrasados');
  var aSub = document.getElementById('atrasados-sub');
  if (aSub) aSub.textContent = atrasados.length + ' abiertos vencidos';
  if (!atrasados.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Ningún pedido atrasado 🎉</td></tr>';
    return;
  }
  var arr = atrasados.slice().sort(function(a, b) { return (b.otd.dias || 0) - (a.otd.dias || 0); }).slice(0, 10);
  tbody.innerHTML = arr.map(function(o) {
    var empColor = EMP_COLORS[o.sigla] || '#718096';
    return '<tr data-href="pedidos.html?otd=atrasado&buscar=' + encodeURIComponent(o.consecutivo) + '&empresa=' + encodeURIComponent(o.sigla) + '" onclick="dGoto(this)">' +
      '<td style="font-weight:600"><span class="sigla-badge" style="background:' + empColor + '20;color:' + empColor + ';font-size:0.68rem">' + escHtml(o.sigla) + '</span> ' + escHtml(o.consecutivo) + '</td>' +
      '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(o.cliente) + '</td>' +
      '<td style="text-align:center;font-size:0.76rem">' + fmtDate(o.fechaCompromiso) + '</td>' +
      '<td class="money" style="font-weight:700;color:#e74c3c">+' + (o.otd.dias || 0) + ' d</td>' +
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
  var nTot = 0, nCons = 0;   // despachos del gráfico y cuántos son de pedidos en consignación
  dEntregas.forEach(function(e) {
    if (fEmp && e.empresa_pedido !== fEmp) return;
    var mes = String(e.fecha || '').slice(0, 7);
    if (!dEsMes(mes)) return;
    if (!map[mes]) map[mes] = { n: 0, uds: 0 };
    map[mes].n++;
    map[mes].uds += Number(e.cantidad) || 0;
    nTot++;
    if (dConsigIds[e.pedido_id]) nCons++;
  });
  var meses = Object.keys(map).sort();
  var subEl = document.getElementById('entmes-sub');
  if (subEl) subEl.textContent = meses.length
    ? ('desde ' + dMesLbl(meses[0]) + ' · ' + nTot + ' despachos' + (nCons ? ' · ' + nCons + ' de consignación' : ''))
    : 'sin datos (el módulo registra desde ago-2026)';
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

// Cobertura y alertas de stock son indicadores "a hoy" (el snapshot de Kardex
// siempre es a hoy). Por eso el movimiento se mide en una ventana móvil fija de
// 90 días desde hoy — NO con el rango del filtro (mezclarlos hacía que un
// producto que ingresó en septiembre saliera como "sin rotación en agosto").
var DASH_MOV_VENTANA = 90;
function _movVentanaDesde() {
  return _isoDate(new Date(Date.now() - DASH_MOV_VENTANA * 86400000));
}

// Última fecha de movimiento de Kardex por producto y tipo ('Entrada'|'Salida'),
// sobre la empresa filtrada. Usa dExist.kxMovimientos (misma base que el saldo).
function _ultimoMovPorProducto(fEmp, tipo) {
  var out = {};
  ((dExist && dExist.kxMovimientos) || []).forEach(function(m) {
    if (m.tipo !== tipo) return;
    if (_esGranel(m.empresa)) return; // GRANEL no es parte del holding en el dashboard
    if (fEmp && m.empresa !== fEmp) return;
    var k = dNormProd(m.producto), f = String(m.fecha || '').slice(0, 10);
    if (k && f && (!out[k] || f > out[k])) out[k] = f;
  });
  return out;
}

// ── Cobertura de inventario (días) — consumo de los últimos 90 días, a hoy ──
function buildCobertura(fEmp) {
  var tbody = document.getElementById('tb-cobertura');
  var subEl = document.getElementById('cob-sub');
  if (!dExist) {
    if (subEl) subEl.textContent = '';
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin snapshot de existencias</td></tr>';
    return;
  }
  var desde = _movVentanaDesde();
  // Consumo = salidas de Kardex por Pedidos (demanda real de cliente) en la ventana.
  var salidaPorProd = {}, minF = null;
  ((dExist && dExist.kxMovimientos) || []).forEach(function(m) {
    if (m.tipo !== 'Salida' || m.modulo !== 'Pedidos') return;
    if (fEmp && m.empresa !== fEmp) return;
    var f = String(m.fecha || '').slice(0, 10);
    if (!f || f < desde) return;
    var k = dNormProd(m.producto);
    if (!k) return;
    salidaPorProd[k] = (salidaPorProd[k] || 0) + (Number(m.cantidad) || 0);
    if (!minF || f < minF) minF = f;
  });
  // Días efectivos: desde la primera salida dentro de la ventana hasta hoy
  // (EntregasPedido arranca en ago-2026, así que puede ser < 90).
  var dias = minF ? Math.round((Date.now() - new Date(minF + 'T00:00:00')) / 86400000) + 1 : 0;
  dias = Math.max(0, Math.min(dias, DASH_MOV_VENTANA));

  var stock = dStockPorProducto(fEmp);
  var rows = [];
  Object.keys(salidaPorProd).forEach(function(k) {
    var sal = salidaPorProd[k];
    if (!dias || sal <= 0) return;
    var st = stock[k] || 0;
    if (st <= 0) return;
    var rate = sal / dias;
    rows.push({ prod: k, stock: st, rate: rate, cob: st / rate });
  });
  rows.sort(function(a, b) { return a.cob - b.cob; });
  rows = rows.slice(0, 10);
  if (subEl) subEl.textContent = dias ? ('consumo últimos ' + dias + ' días · a hoy (no depende del rango)') : 'sin salidas recientes';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin datos de salidas recientes</td></tr>';
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

// ── Alertas de stock (a hoy) — agotados con pendiente + stock estancado ──
function buildAlertasStock(fEmp) {
  var el = document.getElementById('chart-alertas-stock');
  var subEl = document.getElementById('alertas-sub');
  if (!dExist) {
    if (subEl) subEl.textContent = '';
    el.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">Sin snapshot de existencias</div>';
    return;
  }
  var desde = _movVentanaDesde();
  var stock = dStockPorProducto(fEmp);
  var ultSalida = _ultimoMovPorProducto(fEmp, 'Salida');
  var ultIngreso = _ultimoMovPorProducto(fEmp, 'Entrada');

  // Pendientes a hoy: TODAS las líneas abiertas con pendiente (no solo del rango).
  var pendPorProd = {};
  dPedidos.forEach(function(p) {
    if (fEmp && p.Nombre_Empresa !== fEmp) return;
    if (!dLineaPendiente(p)) return;
    var k = dNormProd(p.Producto);
    if (k) pendPorProd[k] = (pendPorProd[k] || 0) + (Number(p.Cant_Pendiente) || 0);
  });

  var agotados = [], estancados = [];
  Object.keys(pendPorProd).forEach(function(k) {
    if ((stock[k] || 0) <= 0) agotados.push({ prod: k, pend: pendPorProd[k] });
  });
  Object.keys(stock).forEach(function(k) {
    if ((stock[k] || 0) <= 0) return;
    var salioReciente = ultSalida[k] && ultSalida[k] >= desde;
    var entroReciente = ultIngreso[k] && ultIngreso[k] >= desde;   // stock "nuevo": no es estancado
    if (!salioReciente && !entroReciente) estancados.push({ prod: k, stock: stock[k], ult: ultSalida[k] || null });
  });
  agotados.sort(function(a, b) { return b.pend - a.pend; });
  estancados.sort(function(a, b) { return b.stock - a.stock; });

  if (subEl) subEl.textContent = agotados.length + ' agotados con pendiente · ' + estancados.length + ' estancados · a hoy';

  var html = '';
  html += '<div style="font-size:0.78rem;font-weight:700;color:#e74c3c;margin-bottom:6px">🔴 Agotados con pedidos pendientes</div>';
  html += dHbarList(agotados.slice(0, 6).map(function(r) {
    return { label: r.prod, value: r.pend, valueTxt: Math.round(r.pend).toLocaleString('es-CO') + ' pend', color: '#e74c3c' };
  }), null, { stack: true });
  html += '<div style="font-size:0.78rem;font-weight:700;color:#e67e22;margin:14px 0 6px">🟠 Con stock y sin movimiento en ' + DASH_MOV_VENTANA + ' días</div>';
  html += dHbarList(estancados.slice(0, 6).map(function(r) {
    return { label: r.prod, value: r.stock, valueTxt: Math.round(r.stock).toLocaleString('es-CO') + ' uds', color: '#e67e22' };
  }), null, { stack: true });
  el.innerHTML = html;
}

// ── Movimientos por producto (selector) ──
// Lista de productos con movimiento en el Kardex (dExist.kxMovimientos),
// independiente del filtro de Empresa/fechas — esos se aplican al construir
// el gráfico/tabla, no al armar el desplegable.
var dMpSelectAttached = false;
function populateMpProductoSelect() {
  var sel = document.getElementById('mp-producto');
  if (!sel) return;
  var prev = sel.value;
  var set = {};
  ((dExist && dExist.kxMovimientos) || []).forEach(function(m) {
    if (_esGranel(m.empresa)) return;
    var k = dNormProd(m.producto);
    if (k) set[k] = 1;
  });
  var productos = Object.keys(set).sort(function(a, b) { return a.localeCompare(b, 'es'); });
  sel.innerHTML = '<option value="">Selecciona un producto...</option>' + productos.map(function(p) {
    return '<option value="' + escHtml(p) + '">' + escHtml(p) + '</option>';
  }).join('');
  if (prev && productos.indexOf(prev) >= 0) sel.value = prev;

  if (!dMpSelectAttached) {
    sel.addEventListener('change', function() {
      var fEmp = document.getElementById('df-emp').value;
      var fDesde = document.getElementById('df-desde').value;
      var fHasta = document.getElementById('df-hasta').value;
      buildMovimientosPorProducto(fEmp, fDesde, fHasta);
    });
    dMpSelectAttached = true;
  }
}

var DASH_MP_TOPE_FILAS = 100;
function buildMovimientosPorProducto(fEmp, fDesde, fHasta) {
  var sub = document.getElementById('mp-sub');
  var tbody = document.getElementById('tb-mp-detalle');
  if (!sub || !tbody) return;
  var prod = document.getElementById('mp-producto').value;

  if (!dExist) {
    sub.textContent = '';
    _destroyChart('cv-mp-mes');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px">Sin snapshot de existencias</td></tr>';
    return;
  }
  if (!prod) {
    sub.textContent = 'Elegí un producto arriba para ver sus movimientos de Kardex';
    _destroyChart('cv-mp-mes');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px">Sin producto seleccionado</td></tr>';
    return;
  }

  var movs = (dExist.kxMovimientos || []).filter(function(m) {
    if (_esGranel(m.empresa)) return false;
    if (dNormProd(m.producto) !== prod) return false;
    if (fEmp && m.empresa !== fEmp) return false;
    if (!_fechaEnRango(m.fecha, fDesde, fHasta)) return false;
    return true;
  });

  // Gráfico: entradas vs salidas por mes
  var map = {};
  movs.forEach(function(m) {
    var mes = String(m.fecha || '').slice(0, 7);
    if (!dEsMes(mes)) return;
    if (!map[mes]) map[mes] = { ent: 0, sal: 0 };
    if (m.tipo === 'Entrada') map[mes].ent += Number(m.cantidad) || 0;
    else map[mes].sal += Number(m.cantidad) || 0;
  });
  var meses = Object.keys(map).sort();
  dMixedChart('cv-mp-mes', meses.map(dMesLbl), [
    { label: 'Entradas', tipo: 'line', yAxis: 'y', color: '#27ae60', data: meses.map(function(m) { return Math.round(map[m].ent); }) },
    { label: 'Salidas', tipo: 'line', yAxis: 'y', color: '#e74c3c', data: meses.map(function(m) { return Math.round(map[m].sal); }) }
  ], {});

  var totEnt = 0, totSal = 0;
  movs.forEach(function(m) {
    if (m.tipo === 'Entrada') totEnt += Number(m.cantidad) || 0; else totSal += Number(m.cantidad) || 0;
  });
  sub.textContent = movs.length.toLocaleString('es-CO') + ' movimientos · Entradas ' + Math.round(totEnt).toLocaleString('es-CO') +
    ' · Salidas ' + Math.round(totSal).toLocaleString('es-CO') + ' · Saldo del período ' + Math.round(totEnt - totSal).toLocaleString('es-CO') +
    (movs.length > DASH_MP_TOPE_FILAS ? ' · tabla: últimos ' + DASH_MP_TOPE_FILAS : '');

  var rows = movs.slice().sort(function(a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')); }).slice(0, DASH_MP_TOPE_FILAS);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:20px">Sin movimientos en el período</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(m) {
    var esEnt = m.tipo === 'Entrada';
    return '<tr>' +
      '<td>' + escHtml(fmtDate(String(m.fecha || '').slice(0, 10))) + '</td>' +
      '<td style="font-weight:700;color:' + (esEnt ? '#27ae60' : '#e74c3c') + '">' + (esEnt ? '⬆️ Entrada' : '⬇️ Salida') + '</td>' +
      '<td>' + escHtml(m.modulo || '') + '</td>' +
      '<td>' + escHtml(dGetSigla(m.empresa)) + '</td>' +
      '<td>' + escHtml(m.presentacion || '—') + '</td>' +
      '<td>' + escHtml(m.remision || '—') + '</td>' +
      '<td class="money">' + Math.round(Number(m.cantidad) || 0).toLocaleString('es-CO') + '</td>' +
    '</tr>';
  }).join('');
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

  // Clientes marcados nuevos con alta en el rango, dedup por identificación
  // (ClientesUnicos tiene filas repetidas para el mismo NIT).
  var nuevos = {};
  dClientes.forEach(function(c) {
    if (!c.Cliente_Nuevo) return;
    if (fEmp && c.Nombre_Empresa && c.Nombre_Empresa !== fEmp) return;
    var f = String(c.creado_en || '').slice(0, 10);
    if (!_fechaEnRango(f, fDesde, fHasta)) return;
    var r = dClienteKey(c.Identificacion, c.Cliente);
    var n = nuevos[r.key];
    if (!n) nuevos[r.key] = { key: r.key, cliente: r.nombre, alta: f, fromMaster: r.fromMaster };
    else {
      if (f && (!n.alta || f < n.alta)) n.alta = f;
      if (r.fromMaster && !n.fromMaster) { n.cliente = r.nombre; n.fromMaster = true; }
    }
  });

  // Aporte en $: cruzar por identificación contra los pedidos del período.
  var pedByKey = {};
  dPedidos.forEach(function(p) {
    if (fEmp && p.Nombre_Empresa !== fEmp) return;
    if (!_fechaEnRango(p.Fecha_Pedido, fDesde, fHasta)) return;
    var k = dClienteKey(p.NIT, p.Cliente).key;
    var e = pedByKey[k] || (pedByKey[k] = { valor: 0, ord: {} });
    e.valor += Number(p.Valor_Total) || 0;
    e.ord[dKeyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente)] = 1;
  });

  var rows = Object.keys(nuevos).map(function(k) {
    var n = nuevos[k];
    var e = pedByKey[k] || { valor: 0, ord: {} };
    return { cliente: n.cliente || '—', alta: n.alta || '', ord: Object.keys(e.ord).length, valor: e.valor };
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

// ══════════════════════════════════════════════════════════════
// Pestañas (Resumen general · Movimientos por empresa · Legalización de gastos)
// ══════════════════════════════════════════════════════════════
var dActiveTab = 'resumen';
var D_TABS = ['resumen', 'movimientos', 'legalizacion'];

function switchDashTab(tab) {
  if (D_TABS.indexOf(tab) < 0) tab = 'resumen';
  // Legalización solo para admin / módulo Legalización (el botón ya viene oculto;
  // esto cubre llamarla a mano). RLS devolvería 0 filas sin error a los demás.
  if (tab === 'legalizacion' && !dLegPermiso()) {
    showToast('No tienes acceso al informe de Legalización de gastos', '#e74c3c');
    return;
  }
  dActiveTab = tab;
  D_TABS.forEach(function(t) {
    document.getElementById('panel-' + t).style.display = (t === tab) ? 'block' : 'none';
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  // Movimientos y Legalización muestran TODAS las empresas lado a lado: el filtro
  // de empresa no aplica (Desde/Hasta y los rangos rápidos sí).
  document.getElementById('df-emp-fg').style.display = (tab === 'resumen') ? '' : 'none';
  if (tab === 'movimientos') {
    buildMovimientosEmpresa();
  } else if (tab === 'legalizacion') {
    buildLegalizacionDash();
  } else {
    // Los gráficos reconstruidos mientras el panel estaba oculto midieron 0 px.
    Object.keys(_dashCharts).forEach(function(id) { try { _dashCharts[id].resize(); } catch (e) {} });
  }
}

// ══════════════════════════════════════════════════════════════
// Movimientos por empresa
// ──────────────────────────────────────────────────────────────
// Por empresa del holding: nº de DOCUMENTOS (no líneas) de pedidos, ingresos,
// órdenes de compra, salidas a producción, cambios, devoluciones y muestras, y
// nº de remisiones distintas de entrada (RE) y de salida (RS).
//  · Documento = mismo agrupamiento que usa cada módulo (pedidos.js keyOf,
//    ingresos.js keyOfIng, reenvases.js keyOfRe, devoluciones.js devGroupKey,
//    cambios/muestras = empresa + consecutivo, OC = origen|destino|consecutivo).
//  · Ingresos y OC tienen origen y destino: cuentan en AMBAS empresas (como en
//    dSlice); el total del holding los cuenta una sola vez.
//  · Pedidos excluye los de consignación (dPedidosConsig, igual que el resto del
//    dashboard); se informan aparte en el mismo renglón.
//  · Remisiones = números distintos del stream del Kardex (dExist.kxMovimientos):
//    solo los que movieron inventario, sin anuladas ni Bodega NC / ajustes.
// ══════════════════════════════════════════════════════════════
var D_MOV_CAMPOS = ['ped', 'pedConsig', 'ing', 'oc', 'ree', 'cam', 'dev', 'mue', 'remRE', 'remRS'];
var D_MOV_MODULOS_SIN_REMISION_DOC = { 'Bodega NC': 1, 'Ajuste': 1, 'Saldo Inicial': 1 };

function dMovPorEmpresa(desde, hasta) {
  var cur = dSlice('', desde, hasta);
  function vacio(extra) {
    var o = extra || {};
    D_MOV_CAMPOS.forEach(function(c) { o[c] = 0; });
    return o;
  }
  var porSigla = {}, filas = [];
  dHoldingEmpresas().forEach(function(e) {
    var f = vacio({ sigla: e.sigla, nombre: e.value });
    porSigla[e.sigla] = f;
    filas.push(f);
  });
  var tot = vacio();
  var visto = {};

  // Cuenta un documento (clave única por campo) en cada empresa visible que
  // participa; en el total del holding entra una sola vez.
  function contar(campo, clave, empresas) {
    var base = campo + '||' + clave;
    var alguna = false;
    empresas.forEach(function(n) {
      var f = porSigla[dGetSigla(n)];
      if (!f) return;
      alguna = true;
      var k = base + '||' + f.sigla;
      if (visto[k]) return;
      visto[k] = 1;
      f[campo]++;
    });
    if (alguna && !visto[base]) { visto[base] = 1; tot[campo]++; }
  }
  function j(arr) { return arr.map(function(v) { return v == null ? '' : String(v).trim(); }).join('||'); }

  cur.orders.forEach(function(o) { contar('ped', o.key, [o.empresa]); });
  cur.consOrders.forEach(function(o) { contar('pedConsig', o.key, [o.empresa]); });

  cur.ing.forEach(function(i) {
    contar('ing', j([i.Fecha, i.Origen, i.Empresa_Origen, i.Empresa_Destino, i.Responsable, i.Remision_Origen, i.Remision_Destino, i.Reenvase_Ref]),
      [i.Empresa_Origen, i.Empresa_Destino]);
  });

  cur.oc.forEach(function(o) {
    contar('oc', j([o.Empresa_Origen, o.Empresa_Destino, o.Consecutivo || o.id]), [o.Empresa_Origen, o.Empresa_Destino]);
  });

  // Salidas a producción: solo la empresa que despacha (en un traslado la
  // destino recibe una entrada, no una salida).
  cur.ree.forEach(function(r) {
    var bod = (r.Bodega === 'Productos Buenos' || !r.Bodega) ? 'Producto Terminado' : r.Bodega;
    contar('ree', j([r.Fecha, r.Empresa, r.Empresa_Destino, r.Planta, r.Remision, r.Remision_Destino, bod]), [r.Empresa]);
  });

  cur.cam.forEach(function(c) { contar('cam', j([c.Empresa, c.Consecutivo || c.id]), [c.Empresa]); });
  cur.dev.forEach(function(d) { contar('dev', j([d.Empresa, d.Cliente, d.Vendedor, d.Fecha]), [d.Empresa]); });
  cur.mue.forEach(function(m) { contar('mue', j([m.Empresa, m.Consecutivo || m.id]), [m.Empresa]); });

  // Remisiones de entrada (RE) y salida (RS) que movieron inventario.
  var remDisponible = !!(dExist && dExist.kxMovimientos);
  if (remDisponible) {
    dExist.kxMovimientos.forEach(function(m) {
      if (D_MOV_MODULOS_SIN_REMISION_DOC[m.modulo]) return;
      var rem = String(m.remision || '').trim();
      if (!rem || !_fechaEnRango(m.fecha, desde, hasta)) return;
      contar(m.tipo === 'Entrada' ? 'remRE' : 'remRS', rem, [m.empresa]);
    });
  }

  return { filas: filas, total: tot, remDisponible: remDisponible };
}

var dMovUltimo = null;   // último resultado mostrado en la pestaña (lo que exporta el botón)

// Exporta a Excel lo que muestra la pestaña: una fila por empresa + HOLDING, y
// una hoja "Criterios" con el rango y las reglas de conteo.
function exportMovimientosExcel() {
  if (typeof XLSX === 'undefined') { showToast('La librería de Excel aún no carga; intenta de nuevo en unos segundos', '#e74c3c'); return; }
  if (!dMovUltimo || !dMovUltimo.d.filas.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }
  var d = dMovUltimo.d;

  function fila(f, sigla, nombre) {
    return {
      'Empresa': sigla,
      'Razón social': nombre,
      'Pedidos': f.ped,
      'Pedidos en consignación': f.pedConsig,
      'Ingresos': f.ing,
      'Órdenes de compra': f.oc,
      'Salidas a producción': f.ree,
      'Cambios': f.cam,
      'Devoluciones': f.dev,
      'Muestras': f.mue,
      'Remisiones de entrada (RE)': d.remDisponible ? f.remRE : '',
      'Remisiones de salida (RS)': d.remDisponible ? f.remRS : ''
    };
  }
  var data = d.filas.map(function(f) { return fila(f, f.sigla, f.nombre); });
  if (d.filas.length > 1) data.push(fila(d.total, 'HOLDING', 'Total (ingresos y órdenes de compra entre empresas, una sola vez)'));

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 11 }, { wch: 42 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 13 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];

  var criterios = [
    ['Movimientos por empresa'],
    ['Rango', dMovUltimo.rango],
    ['Generado', new Date().toLocaleString('es-CO')],
    [],
    ['Cada indicador cuenta documentos, no líneas: un pedido, ingreso u orden de compra con varios productos cuenta 1. Incluye anulados.'],
    ['Pedidos: sin los de consignación (columna aparte). Muestras: sin órdenes de producción de muestras.'],
    ['Salidas a producción: módulo Salidas a producción; cuenta solo para la empresa que despacha.'],
    ['Ingresos y órdenes de compra cuentan en las dos empresas (origen y destino); el total HOLDING no los duplica.'],
    ['Remisiones: números distintos de entrada (RE) y salida (RS) que movieron inventario en el Kardex (sin anuladas, Bodega NC ni ajustes).']
  ];
  var wsC = XLSX.utils.aoa_to_sheet(criterios);
  wsC['!cols'] = [{ wch: 120 }, { wch: 30 }];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
  XLSX.utils.book_append_sheet(wb, wsC, 'Criterios');
  XLSX.writeFile(wb, 'movimientos_por_empresa_' + today() + '.xlsx');
}

function buildMovimientosEmpresa() {
  var gridEl = document.getElementById('mov-grid');
  var chipEl = document.getElementById('mov-chip');
  var notaEl = document.getElementById('mov-nota');
  if (!gridEl) return;

  var fDesde = document.getElementById('df-desde').value;
  var fHasta = document.getElementById('df-hasta').value;
  chipEl.innerHTML = '<span class="dash-range-chip">📅 ' + escHtml(dRangoLabel(fDesde, fHasta)) + ' · Todas las empresas</span>';

  var d = dMovPorEmpresa(fDesde, fHasta);
  dMovUltimo = { d: d, rango: dRangoLabel(fDesde, fHasta), desde: fDesde, hasta: fHasta };
  if (!d.filas.length) {
    gridEl.innerHTML = '<div class="empty" style="grid-column:1/-1;text-align:center;padding:44px;color:#a0aec0">No tienes empresas asignadas para ver movimientos.</div>';
    notaEl.innerHTML = '';
    return;
  }

  function num(v) { return Number(v).toLocaleString('es-CO'); }
  function fila(icon, lbl, val, sub, tip) {
    return '<div class="mov-row"' + (tip ? ' title="' + escHtml(tip) + '"' : '') + '>' +
      '<span class="mov-ico">' + icon + '</span>' +
      '<span class="mov-lbl">' + lbl + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
      '<span class="mov-val' + (val ? '' : ' zero') + '">' + num(val) + '</span>' +
    '</div>';
  }
  function card(f, color, head) {
    var consSub = f.pedConsig ? '+ ' + num(f.pedConsig) + ' en consignación' : '';
    var rem = d.remDisponible
      ? fila('⬇️', 'Entrada (RE)', f.remRE, '', 'Remisiones distintas de entrada que movieron inventario') +
        fila('⬆️', 'Salida (RS)', f.remRS, '', 'Remisiones distintas de salida que movieron inventario')
      : '<div class="mov-row" style="color:#a0aec0;font-size:0.8rem">Sin datos de remisiones (el Kardex no cargó).</div>';
    return '<div class="mov-card" style="border-top-color:' + color + '">' +
      '<div class="mov-head">' + head + '</div>' +
      fila('📋', 'Pedidos', f.ped, consSub, 'Órdenes (empresa + consecutivo + cliente) por fecha del pedido. No incluye consignación.') +
      fila('📥', 'Ingresos', f.ing, '', 'Ingresos como empresa origen o destino, por fecha del ingreso') +
      fila('🛒', 'Órdenes de compra', f.oc, '', 'Órdenes de compra como empresa origen o destino, por fecha') +
      fila('🏭', 'Salidas a producción', f.ree, '', 'Salidas despachadas por la empresa, por fecha de la salida') +
      fila('🔁', 'Cambios', f.cam, '', 'Cambios de mercancía por fecha de solicitud') +
      fila('🔄', 'Devoluciones', f.dev, '', 'Devoluciones por fecha') +
      fila('🧪', 'Muestras', f.mue, '', 'Solicitudes de muestras (sin órdenes de producción) por fecha de solicitud') +
      '<div class="mov-sec">📄 Remisiones</div>' + rem +
    '</div>';
  }

  var html = d.filas.map(function(f) {
    var head = '<span class="sigla-badge ' + getSiglaClass(f.nombre) + '">' + escHtml(f.sigla) + '</span>' +
      '<span class="mov-name">' + escHtml(f.nombre) + '</span>';
    return card(f, EMP_COLORS[f.sigla] || '#1a5276', head);
  }).join('');

  if (d.filas.length > 1) {
    var headTot = '<span class="sigla-badge" style="background:#d6eaf8;color:#1a5276">HOLDING</span>' +
      '<span class="mov-name">Total (los documentos entre empresas se cuentan una sola vez)</span>';
    html += card(d.total, '#1a5276', headTot);
  }
  gridEl.innerHTML = html;

  notaEl.innerHTML =
    '<p>• Cada indicador cuenta <b>documentos</b>, no líneas: un pedido, ingreso u orden de compra con varios productos cuenta 1. Incluye anulados, igual que el resto del dashboard.</p>' +
    '<p>• Ingresos y órdenes de compra aparecen en las <b>dos</b> empresas que participan (origen y destino), por eso la suma de las tarjetas supera al total del holding.</p>' +
    '<p>• Remisiones: números <b>distintos</b> de entrada (RE) y salida (RS) de pedidos, ingresos, órdenes de compra, salidas, cambios, devoluciones y muestras que movieron inventario en el Kardex (sin anuladas, Bodega NC ni ajustes). Un traslado entre empresas aporta una RS al origen y una RE al destino.</p>';
}

// ══════════════════════════════════════════════════════════════
// Legalización de gastos
// ──────────────────────────────────────────────────────────────
// Informe consolidado de legalizaciones (Ruta, Mantenimiento, Envío) por rango
// de fechas (Fecha de la legalización). Solo admin / módulo Legalización: RLS
// devuelve 0 filas SIN error a quien no lo tiene, y a un usuario restringido por
// empresa le recorta las legalizaciones (totales parciales).
//  · Excluye las Rechazadas (mismo criterio que la pestaña Prorrateo).
//  · Concepto: Combustible / Peaje / Alimentación / Alojamiento / Envío; lo demás
//    es "Otros". Las líneas de una legalización de Mantenimiento van a
//    "Mantenimiento", salvo su Combustible.
//  · Gasto / Combustible / Mantenimiento por empresa: es EXACTAMENTE el cálculo de la
//    pestaña "Prorrateo de gastos" del módulo Legalización — sale del mismo código
//    (js/legalizacion-prorrateo.js, LegProrrateo.calcular) con los mismos datos y el
//    rango Desde/Hasta del Dashboard (sin filtro de empresa). Por eso trae las 7
//    fuentes de remisiones (Pedidos, Ingresos, Muestras, Devoluciones, Cambios y
//    remisiones externas) al abrir la pestaña.
//  · Vehículos: viajes de Ruta con Km_Salida y Km_Llegada (piloto de kilometraje).
//    Rendimiento = km de los viajes con galones ÷ galones de Combustible; alerta si
//    queda más de 25 % bajo Vehiculos.Rendimiento_Esperado (igual que el modal "Ver").
// Los datos se piden la primera vez que se abre la pestaña (no en loadDashboard,
// para no frenar el Resumen) y se vuelven a pedir tras "↻ Actualizar".
// ══════════════════════════════════════════════════════════════
var D_LEG_CATS = [
  { k: 'Combustible',   color: '#e67e22' },
  { k: 'Peaje',         color: '#2980b9' },
  { k: 'Alimentación',  color: '#27ae60' },
  { k: 'Alojamiento',   color: '#8e44ad' },
  { k: 'Envío',         color: '#148f77' },
  { k: 'Mantenimiento', color: '#c0392b' },
  { k: 'Otros',         color: '#a0aec0' }
];
var D_LEG_DESVIO_ALERTA = 0.25;

var dLeg = null;          // { legs, items, empresas, vehiculos, mapas, fallidas } | null (sin cargar)
var dLegPromesa = null;   // carga en curso
var dLegGen = 0;          // sube al invalidar: una carga vieja no pisa la caché
var dLegBuildTok = 0;     // el último repintado gana
var dLegUltimo = null;    // lo último mostrado (lo que exporta el botón)

function dLegPermiso() {
  return !!(AUTH.hasModule('legalizacion_gastos') || AUTH.hasModule('legalizacion_gastos_aprobar'));
}

function dLegAplicarPermiso() {
  var btn = document.getElementById('tab-legalizacion');
  if (btn) btn.style.display = dLegPermiso() ? '' : 'none';
}

function dLegInvalidar() { dLeg = null; dLegPromesa = null; dLegGen++; }

function dLegCargar() {
  if (dLeg) return Promise.resolve(dLeg);
  if (dLegPromesa) return dLegPromesa;
  var gen = dLegGen;
  var p = Promise.all([
    apiGet('getLegalizacionGastos', { columns: 'id,Consecutivo,Fecha,Responsable,Tipo,Placa,Estado_Conciliacion,Km_Salida,Km_Llegada,Remisiones_Relacionadas' }),
    apiGet('getLegalizacionGastosItems', { columns: 'id,Legalizacion_Id,Concepto,Proveedor,Valor,Galones' }),
    apiGet('getLegalizacionGastosEmpresas', { columns: 'id,Legalizacion_Id,Empresa,Monto' }),
    apiGet('getVehiculos', { columns: 'id,Placa,Descripcion,Rendimiento_Esperado' }).catch(function() { return { ok: true, vehiculos: [] }; }),
    // Fuentes de remisiones del prorrateo: mismas consultas y columnas que
    // loadClientesConRemision() de legalizacion-gastos.js.
    apiGet('getPedidos', { columns: 'Cliente,Remisiones,Estado_2,Producto,Presentacion,Nombre_Empresa' }),
    apiGet('getIngresos', { columns: 'Producto,Presentacion,Cantidad,Remision_Destino,Remision_Origen,Empresa_Destino,Empresa_Origen' }).catch(function() { return { ok: true, ingresos: [] }; }),
    apiGet('getMuestras', { columns: 'Remision,Empresa,Producto,Presentacion,Cantidad,Cant_Entregada,Tipo_Solicitud' }).catch(function() { return { ok: true, muestras: [] }; }),
    apiGet('getDevoluciones', { columns: 'Remision,Remision_Ingreso,Remision_Salida,Empresa,Producto,Presentacion,Cantidad,Cant_Entregada,Estado' }).catch(function() { return { ok: true, devoluciones: [] }; }),
    apiGet('getRemisionesExternas', { columns: 'id,Remision,Fecha,Tipo,Proveedor,Planta,creado_por_nombre,creado_en,modificado_en' }).catch(function() { return { ok: false }; }),
    apiGet('getRemisionesExternasItems', { columns: 'Remision_Id,Producto,Presentacion,Cantidad,Unidad' }).catch(function() { return { ok: false }; }),
    apiGet('getCambios', { columns: 'id,Tipo_Linea,Cantidad,Estado,Remision_Salida,Remision_Ingreso,Consecutivo,Empresa,Producto' }).catch(function() { return { ok: true, cambios: [] }; })
  ]).then(function(r) {
    for (var i = 0; i < 3; i++) if (!r[i].ok) throw new Error(r[i].error || 'Error al cargar legalizaciones');
    // Sin pedidos no hay forma de resolver remisiones: todo caería en "Sin
    // identificar" y parecería un resultado válido. Mejor avisar.
    if (!r[4].ok) throw new Error(r[4].error || 'Error al cargar los pedidos (remisiones)');
    // Las demás fuentes, si fallan, solo restan remisiones resolubles: se avisa en la nota.
    var fallidas = [];
    [[5, 'ingresos'], [6, 'muestras'], [7, 'devoluciones'], [8, 'remisiones externas'], [9, 'remisiones externas'], [10, 'cambios']].forEach(function(f) {
      if (!r[f[0]] || !r[f[0]].ok) { if (fallidas.indexOf(f[1]) < 0) fallidas.push(f[1]); }
    });
    var mapas = LegProrrateo.construirMapas({
      pedidos: r[4], ingresos: r[5], muestras: r[6], devoluciones: r[7],
      ext: r[8], extItems: r[9], cambios: r[10]
    });
    var datos = {
      legs: r[0].legalizaciones || [],
      items: r[1].items || [],
      empresas: r[2].empresas || [],
      vehiculos: (r[3] && r[3].vehiculos) || [],
      mapas: mapas,
      fallidas: fallidas
    };
    if (gen === dLegGen) dLeg = datos;
    return datos;
  });
  dLegPromesa = p;
  var limpiar = function() { if (dLegPromesa === p) dLegPromesa = null; };
  p.then(limpiar, limpiar);
  return p;
}

function _dLegNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Categoría de una línea de gasto (ver criterios arriba).
function dLegCategoria(leg, it) {
  var c = _dLegNorm(it.Concepto);
  if (c === 'combustible') return 'Combustible';
  if (leg.Tipo === 'Mantenimiento') return 'Mantenimiento';
  for (var i = 0; i < D_LEG_CATS.length; i++) {
    if (D_LEG_CATS[i].k !== 'Otros' && D_LEG_CATS[i].k !== 'Mantenimiento' && _dLegNorm(D_LEG_CATS[i].k) === c) return D_LEG_CATS[i].k;
  }
  return 'Otros';
}

// Cálculo puro: todo lo que muestra y exporta la pestaña.
function dLegCalcular(datos, desde, hasta) {
  var itemsPorLeg = {}, vehEsp = {};
  datos.items.forEach(function(it) { (itemsPorLeg[it.Legalizacion_Id] = itemsPorLeg[it.Legalizacion_Id] || []).push(it); });
  datos.vehiculos.forEach(function(v) { vehEsp[String(v.Placa || '').trim().toUpperCase()] = v; });

  var d = {
    filas: [], total: 0, nLeg: 0, nEnv: 0, pendTotal: 0, pendN: 0, rechazadas: 0,
    porMes: {}, porCat: {}, vehiculos: [], pro: null, cuadre: 0
  };
  var veh = {};

  datos.legs.forEach(function(leg) {
    if (!_fechaEnRango(leg.Fecha, desde, hasta)) return;
    if (leg.Estado_Conciliacion === 'Rechazada') { d.rechazadas++; return; }

    var esEnv = leg.Tipo === 'Envio', esMant = leg.Tipo === 'Mantenimiento';
    var mes = String(leg.Fecha || '').slice(0, 7);
    var totalLeg = 0, comb = 0, gal = 0, cats = {}, provs = [], visto = {};
    (itemsPorLeg[leg.id] || []).forEach(function(it) {
      var v = Number(it.Valor) || 0;
      var cat = dLegCategoria(leg, it);
      totalLeg += v;
      cats[cat] = (cats[cat] || 0) + v;
      d.porCat[cat] = (d.porCat[cat] || 0) + v;
      if (dEsMes(mes)) {
        var m = d.porMes[mes] || (d.porMes[mes] = {});
        m[cat] = (m[cat] || 0) + v;
      }
      if (cat === 'Combustible') { comb += v; gal += Number(it.Galones) || 0; }
      var pv = String(it.Proveedor || '').trim();
      if (pv && !visto[pv]) { visto[pv] = 1; provs.push(pv); }
    });

    d.total += totalLeg;
    if (esEnv) d.nEnv++; else d.nLeg++;
    if (!esEnv && leg.Estado_Conciliacion === 'Por conciliar') { d.pendTotal += totalLeg; d.pendN++; }

    // Kilometraje (solo viajes de Ruta).
    if (!esEnv && !esMant && leg.Km_Salida != null && leg.Km_Llegada != null) {
      var km = Number(leg.Km_Llegada) - Number(leg.Km_Salida);
      if (km > 0) {
        var pl = String(leg.Placa || '').trim().toUpperCase() || '—';
        var vv = veh[pl] || (veh[pl] = { placa: pl, viajes: 0, km: 0, kmConGal: 0, galones: 0, costoComb: 0 });
        vv.viajes++; vv.km += km; vv.galones += gal; vv.costoComb += comb;
        if (gal > 0) vv.kmConGal += km;
      }
    }

    d.filas.push({
      id: leg.id,
      consecutivo: leg.Consecutivo || ('#' + leg.id),
      fecha: String(leg.Fecha || '').slice(0, 10),
      tipo: esEnv ? 'Envío' : (esMant ? 'Mantenimiento' : 'Ruta'),
      responsable: leg.Responsable || '',
      proveedores: provs.join(', '),
      placa: leg.Placa || '',
      estado: esEnv ? 'Registrado' : (leg.Estado_Conciliacion || ''),
      valor: totalLeg,
      cats: cats
    });
  });

  d.filas.sort(function(a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id; });

  d.vehiculos = Object.keys(veh).map(function(pl) {
    var v = veh[pl];
    var ref = vehEsp[pl];
    v.descripcion = ref ? (ref.Descripcion || '') : '';
    v.rend = v.galones > 0 ? v.kmConGal / v.galones : null;
    v.esperado = (ref && ref.Rendimiento_Esperado != null) ? Number(ref.Rendimiento_Esperado) : null;
    v.alerta = !!(v.rend != null && v.esperado && (v.rend - v.esperado) / v.esperado < -D_LEG_DESVIO_ALERTA);
    v.costoKm = v.km > 0 ? v.costoComb / v.km : null;
    return v;
  }).sort(function(a, b) { return b.km - a.km; });

  // Prorrateo por empresa: el mismo cálculo (y los mismos datos) que la pestaña
  // "Prorrateo de gastos" del módulo Legalización, con el rango del Dashboard.
  d.pro = LegProrrateo.calcular({
    legs: datos.legs,
    items: datos.items,
    empresas: datos.empresas,
    mapa: datos.mapas.prodMap,
    mapaReparto: datos.mapas.repMap
  }, { fEmp: '', fDesde: desde, fHasta: hasta });
  // Autoverificación: gasto prorrateado + combustible + mantenimiento debe sumar el
  // total de gastos del período (si no, se avisa en la nota).
  d.cuadre = d.total - (d.pro.totalGeneral + d.pro.combustibleTotalGeneral + d.pro.mantenimiento.total);

  // Carga transportada del período (litros / kilos / unidades de las remisiones
  // relacionadas, rutas y envíos) y costo por unidad movida: la parte del gasto
  // que cayó en cada bolsa ÷ lo movido en ella. Mismas cantidades que el
  // "Resumen del período" de la pestaña Prorrateo.
  function suma(o) { return Object.keys(o).reduce(function(s, k) { return s + (o[k] || 0); }, 0); }
  d.carga = {
    litros: suma(d.pro.porEmpresaLitros), kilos: suma(d.pro.porEmpresaKilos), unidades: suma(d.pro.porEmpresaUnidades),
    montoLitros: suma(d.pro.porEmpresaMontoLitros), montoKilos: suma(d.pro.porEmpresaMontoKilos), montoUnidades: suma(d.pro.porEmpresaMontoUnidades)
  };
  d.carga.costoLitro = d.carga.litros > 0 ? d.carga.montoLitros / d.carga.litros : null;
  d.carga.costoKilo = d.carga.kilos > 0 ? d.carga.montoKilos / d.carga.kilos : null;
  d.carga.costoUnidad = d.carga.unidades > 0 ? d.carga.montoUnidades / d.carga.unidades : null;

  return d;
}

// Cantidades como en Prorrateo: hasta 2 decimales, sin ceros sobrantes.
function dLegCant(v) {
  return (Number(v) || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function dLegNum(v, dec) {
  return Number(v).toLocaleString('es-CO', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
}

// Mismo formato de cifras que la pestaña Prorrateo: montos con 2 decimales y % con 2.
function dLegMoney2(v) {
  var n = Number(v); if (!n && n !== 0) return '—';
  return '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// { legId: consecutivo } → "LEG-00002, LEG-00010" (para el tooltip de «Sin …»).
function dLegLegsTxt(obj) {
  return Object.keys(obj || {}).map(function(id) { return obj[id]; }).sort(function(a, b) { return String(a).localeCompare(String(b)); }).join(', ');
}

// Filas por empresa de un bloque (ordenadas de mayor a menor) + la fila «Sin …»
// si tiene monto; pct = % del total del bloque.
function dLegFilasEmpresa(porEmpresa, total, sin) {
  var rows = Object.keys(porEmpresa).map(function(emp) { return { label: emp, value: porEmpresa[emp] }; })
    .sort(function(a, b) { return b.value - a.value; });
  if (sin && sin.value > 0) rows.push({ label: sin.label, value: sin.value, legs: sin.legs, sin: true });
  rows.forEach(function(r) { r.pct = total > 0 ? (r.value / total * 100) : 0; });
  return rows;
}

// extra (opcional) agrega columnas a la derecha de Monto y %:
// { heads: ['Litros', ...], cells: function(empresa) → ['…', …] (HTML ya escapado),
//   totals: ['…', …] }. La fila «Sin …» las deja en blanco.
function dLegTablaEmpresa(rows, total, extra) {
  if (!rows.length) return '<div style="color:#a0aec0;text-align:center;padding:30px 20px">Sin datos en el período</div>';
  var nExtra = extra ? extra.heads.length : 0;
  function celdas(arr) { return arr.map(function(c) { return '<td class="num">' + c + '</td>'; }).join(''); }
  var vacias = '';
  for (var i = 0; i < nExtra; i++) vacias += '<td class="num"></td>';
  return '<table class="mini-table"><thead><tr><th>Empresa</th><th class="num">Monto</th><th class="num">%</th>' +
    (extra ? extra.heads.map(function(h) { return '<th class="num">' + escHtml(h) + '</th>'; }).join('') : '') + '</tr></thead><tbody>' +
    rows.map(function(r) {
      var etiqueta = r.sin
        ? '<span style="color:#718096;font-weight:700"' + (r.legs ? ' title="' + escHtml(r.legs) + '"' : '') + '>' + escHtml(r.label) + '</span>'
        : '<span class="sigla-badge ' + getSiglaClass(r.label) + '">' + escHtml(r.label) + '</span>';
      return '<tr><td>' + etiqueta + '</td><td class="num">' + escHtml(dLegMoney2(r.value)) + '</td><td class="num">' + r.pct.toFixed(2) + '%</td>' +
        (extra ? (r.sin ? vacias : celdas(extra.cells(r.label))) : '') + '</tr>';
    }).join('') +
    '<tr style="font-weight:700;background:#f7fafc"><td>Total</td><td class="num">' + escHtml(dLegMoney2(total)) + '</td><td class="num">' + (total > 0 ? '100.00%' : '0.00%') + '</td>' +
    (extra ? celdas(extra.totals) : '') + '</tr>' +
    '</tbody></table>';
}

// Columnas de carga transportada de «Gasto por empresa»: litros, kilos, unidades (solo
// si las hay) y costo por litro / por kilo / por unidad de cada empresa.
function dLegExtraCarga(pro, carga) {
  var hayUnid = carga.unidades > 0;
  function cant(v, u) { return v > 0 ? escHtml(dLegCant(v)) + ' ' + u : '—'; }
  function costo(m, c) { return c > 0 ? escHtml(dLegMoney2(m / c)) : '—'; }
  var heads = ['Litros', 'Kilos'].concat(hayUnid ? ['Unidades'] : []).concat(['$/litro', '$/kilo']).concat(hayUnid ? ['$/unidad'] : []);
  return {
    heads: heads,
    cells: function(e) {
      return [cant(pro.porEmpresaLitros[e], 'L'), cant(pro.porEmpresaKilos[e], 'Kg')]
        .concat(hayUnid ? [cant(pro.porEmpresaUnidades[e], 'und')] : [])
        .concat([costo(pro.porEmpresaMontoLitros[e], pro.porEmpresaLitros[e]), costo(pro.porEmpresaMontoKilos[e], pro.porEmpresaKilos[e])])
        .concat(hayUnid ? [costo(pro.porEmpresaMontoUnidades[e], pro.porEmpresaUnidades[e])] : []);
    },
    totals: [cant(carga.litros, 'L'), cant(carga.kilos, 'Kg')]
      .concat(hayUnid ? [cant(carga.unidades, 'und')] : [])
      .concat([costo(carga.montoLitros, carga.litros), costo(carga.montoKilos, carga.kilos)])
      .concat(hayUnid ? [costo(carga.montoUnidades, carga.unidades)] : [])
  };
}

async function buildLegalizacionDash() {
  var tok = ++dLegBuildTok;
  var chipEl = document.getElementById('leg-chip');
  var msgEl = document.getElementById('leg-msg');
  var contEl = document.getElementById('leg-contenido');
  if (!chipEl) return;

  var fDesde = document.getElementById('df-desde').value;
  var fHasta = document.getElementById('df-hasta').value;
  var rango = dRangoLabel(fDesde, fHasta);
  chipEl.innerHTML = '<span class="dash-range-chip">📅 ' + escHtml(rango) + ' · Todas las empresas</span>';

  if (!dLeg) {
    msgEl.textContent = 'Cargando legalizaciones y remisiones…';
    msgEl.style.display = '';
    contEl.style.display = 'none';
  }
  var datos;
  try {
    datos = await dLegCargar();
  } catch (e) {
    if (tok !== dLegBuildTok) return;
    dLegUltimo = null;
    msgEl.textContent = '⚠️ No se pudo cargar el informe: ' + e.message;
    msgEl.style.display = '';
    contEl.style.display = 'none';
    return;
  }
  if (tok !== dLegBuildTok || dActiveTab !== 'legalizacion') return;
  msgEl.style.display = 'none';
  contEl.style.display = '';

  var d = dLegCalcular(datos, fDesde, fHasta);
  dLegUltimo = { d: d, rango: rango, desde: fDesde, hasta: fHasta };
  var nDocs = d.nLeg + d.nEnv;

  // KPIs
  document.getElementById('leg-kpis').innerHTML =
    kpiCard('', dMoneyM(d.total), 'Total legalizado', dMoneyFull(d.total)) +
    kpiCard('teal', dLegNum(d.nLeg), 'Legalizaciones (LEG)', 'rutas y mantenimiento') +
    kpiCard('purple', dLegNum(d.nEnv), 'Envíos (ENV)', 'fletes registrados') +
    kpiCard('green', dMoneyM(nDocs ? d.total / nDocs : 0), 'Promedio por documento', 'LEG + ENV') +
    kpiCard('orange', dMoneyM(d.pendTotal), 'Por conciliar', dLegNum(d.pendN) + ' legalización(es)') +
    kpiCard('teal', dLegCant(d.carga.litros) + ' L', 'Litros transportados',
      d.carga.costoLitro != null ? dLegMoney2(d.carga.costoLitro) + ' por litro' : 'sin litros identificados') +
    kpiCard('purple', dLegCant(d.carga.kilos) + ' Kg', 'Kilos transportados',
      d.carga.costoKilo != null ? dLegMoney2(d.carga.costoKilo) + ' por kilo' : 'sin kilos identificados');

  // Gasto por concepto (barras horizontales, de mayor a menor; % sobre el total)
  var conceptoRows = D_LEG_CATS.filter(function(c) { return (d.porCat[c.k] || 0) > 0; })
    .map(function(c) { return { label: c.k, value: d.porCat[c.k], color: c.color }; })
    .sort(function(a, b) { return b.value - a.value; });
  conceptoRows.forEach(function(r) {
    r.valueTxt = dMoneyFull(Math.round(r.value)) + ' · ' + (d.total > 0 ? dLegNum(r.value / d.total * 100, 1) : '0') + '%';
  });
  document.getElementById('leg-concepto-sub').textContent = conceptoRows.length ? 'Total ' + dMoneyFull(d.total) : '';
  document.getElementById('leg-concepto').innerHTML = dHbarList(conceptoRows, null, { stack: true });

  // Gasto / Combustible / Mantenimiento por empresa (prorrateo — mismas cifras que
  // la pestaña "Prorrateo de gastos" del módulo Legalización)
  var pro = d.pro;
  var proRows = dLegFilasEmpresa(pro.porEmpresa, pro.totalGeneral,
    { label: 'Sin identificar', value: pro.sinIdentificar, legs: dLegLegsTxt(pro.sinIdentificarLegs) });
  var combRows = dLegFilasEmpresa(pro.combustiblePorEmpresa, pro.combustibleTotalGeneral,
    { label: 'Sin reparto asignado', value: pro.combustibleSinAsignar, legs: dLegLegsTxt(pro.combustibleSinAsignarLegs) });
  var mantRows = dLegFilasEmpresa(pro.mantenimiento.porEmpresa, pro.mantenimiento.total,
    { label: 'Sin reparto asignado', value: pro.mantenimiento.sinAsignar, legs: dLegLegsTxt(pro.mantenimiento.sinAsignarLegs) });
  document.getElementById('leg-pro-emp').innerHTML = dLegTablaEmpresa(proRows, pro.totalGeneral, dLegExtraCarga(pro, d.carga));
  document.getElementById('leg-comb').innerHTML = dLegTablaEmpresa(combRows, pro.combustibleTotalGeneral);
  document.getElementById('leg-mant').innerHTML = dLegTablaEmpresa(mantRows, pro.mantenimiento.total);

  // Vehículos
  var vehEl = document.getElementById('leg-veh');
  if (!d.vehiculos.length) {
    vehEl.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:30px 20px">Sin viajes con kilometraje en el período</div>';
  } else {
    vehEl.innerHTML = '<table class="mini-table"><thead><tr>' +
      '<th>Placa</th><th class="num">Viajes</th><th class="num">Km</th><th class="num">Galones</th>' +
      '<th class="num">Km/gal</th><th class="num">Esperado</th><th class="num">$ Comb.</th><th class="num">$/km</th></tr></thead><tbody>' +
      d.vehiculos.map(function(v) {
        return '<tr>' +
          '<td style="font-weight:700"' + (v.descripcion ? ' title="' + escHtml(v.descripcion) + '"' : '') + '>' + escHtml(v.placa) + '</td>' +
          '<td class="num">' + dLegNum(v.viajes) + '</td>' +
          '<td class="num">' + dLegNum(v.km) + '</td>' +
          '<td class="num">' + (v.galones ? dLegNum(v.galones, 1) : '—') + '</td>' +
          '<td class="num">' + (v.rend != null ? dLegNum(v.rend, 1) : '—') +
            (v.alerta ? ' <span class="leg-aviso" title="Más de 25 % por debajo del rendimiento esperado">⚠</span>' : '') + '</td>' +
          '<td class="num">' + (v.esperado != null ? dLegNum(v.esperado, 1) : '—') + '</td>' +
          '<td class="num">' + dMoneyFull(v.costoComb) + '</td>' +
          '<td class="num">' + (v.costoKm != null ? dMoneyFull(Math.round(v.costoKm)) : '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  // Tabla de legalizaciones
  var estadoCls = { 'Conciliada': 'b-ent', 'Por conciliar': 'b-rec', 'Registrado': 'b-cerrado' };
  var tipoIco = { 'Ruta': '🚚', 'Mantenimiento': '🔧', 'Envío': '📦' };
  document.getElementById('leg-tabla-sub').textContent = d.filas.length
    ? dLegNum(d.filas.length) + ' documento(s) · ' + dMoneyFull(d.total) : '';
  document.getElementById('leg-tabla').innerHTML = d.filas.length
    ? '<table class="mini-table"><thead><tr><th>N.º</th><th>Fecha</th><th>Tipo</th><th>Responsable / Proveedor</th><th>Placa</th><th class="num">Valor</th><th>Estado</th></tr></thead><tbody>' +
      d.filas.map(function(f) {
        return '<tr>' +
          '<td style="font-weight:700">' + escHtml(f.consecutivo) + '</td>' +
          '<td>' + escHtml(fmtDate(f.fecha)) + '</td>' +
          '<td>' + (tipoIco[f.tipo] || '') + ' ' + escHtml(f.tipo) + '</td>' +
          '<td>' + escHtml(f.tipo === 'Envío' ? (f.proveedores || f.responsable) : f.responsable) + '</td>' +
          '<td>' + escHtml(f.placa) + '</td>' +
          '<td class="num">' + dMoneyFull(f.valor) + '</td>' +
          '<td><span class="badge ' + (estadoCls[f.estado] || 'b-rec') + '">' + escHtml(f.estado) + '</span></td>' +
        '</tr>';
      }).join('') + '</tbody></table>'
    : '<div style="color:#a0aec0;text-align:center;padding:30px 20px">Sin legalizaciones en el período</div>';

  // Notas de criterio
  var rolP = (AUTH.getProfile() || {}).rol;
  document.getElementById('leg-nota').innerHTML =
    '<p>• Incluye legalizaciones de ruta, mantenimiento y envíos por <b>fecha de la legalización</b>; excluye las rechazadas' +
      (d.rechazadas ? ' (' + dLegNum(d.rechazadas) + ' en el período)' : '') + '.</p>' +
    '<p>• <b>Gasto por empresa:</b> el gasto de cada ruta o envío (sin combustible) se prorratea entre los productos de sus remisiones relacionadas, por litros, kilos o unidades, y se asigna a la empresa dueña de cada remisión; lo que no se puede ligar a un producto queda en «Sin identificar». <b>Combustible</b> y <b>Mantenimiento</b> se reparten según el reparto manual de cada legalización; sin reparto, quedan en «Sin reparto asignado». Son las mismas cifras de la pestaña Prorrateo de gastos del módulo Legalización (mismo rango, sin filtro de empresa). Pasa el cursor sobre «Sin …» para ver qué legalizaciones lo componen.</p>' +
    '<p>• <b>Litros, kilos y unidades transportados:</b> los de los productos de las remisiones relacionadas a rutas y envíos (mismas cantidades del «Resumen del período» de Prorrateo); una remisión relacionada en dos legalizaciones cuenta en cada una. <b>$/litro</b> y <b>$/kilo</b> = parte del gasto prorrateada a líquidos (o a sólidos) ÷ litros (o kilos) movidos. Lo que quedó en «Sin identificar» no tiene cantidades.</p>' +
    (Math.abs(d.cuadre) > 1 ? '<p class="leg-aviso">⚠ El total de gastos (' + dMoneyFull(d.total) + ') no coincide con gasto prorrateado + combustible + mantenimiento (diferencia ' + dMoneyFull(Math.round(d.cuadre)) + '); suele deberse a repartos manuales con montos negativos o inconsistentes.</p>' : '') +
    (datos.fallidas.length ? '<p class="leg-aviso">⚠ No se pudieron cargar: ' + escHtml(datos.fallidas.join(', ')) + '. Las remisiones que dependen de esas fuentes pueden aparecer como «Sin identificar».</p>' : '') +
    '<p>• <b>Rendimiento:</b> km de los viajes con galones registrados ÷ galones de combustible; ⚠ si queda más de 25 % por debajo del esperado. Solo hay datos de las placas del piloto de kilometraje; los envíos y el mantenimiento no suman km.</p>' +
    ((rolP === 'admin' || rolP === 'cartera') ? '' : '<p>• Si tu usuario está limitado a ciertas empresas, solo ves las legalizaciones que las involucran: los totales pueden ser parciales.</p>');
}

// Exporta a Excel lo que muestra la pestaña (7 hojas, la última con los criterios).
function exportLegalizacionExcel() {
  if (typeof XLSX === 'undefined') { showToast('La librería de Excel aún no carga; intenta de nuevo en unos segundos', '#e74c3c'); return; }
  if (!dLegUltimo || !dLegUltimo.d.filas.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }
  var d = dLegUltimo.d;

  var hojaLeg = d.filas.map(function(f) {
    var o = {
      'N.º': f.consecutivo, 'Fecha': f.fecha, 'Tipo': f.tipo, 'Responsable': f.responsable,
      'Proveedor(es)': f.proveedores, 'Placa': f.placa, 'Estado': f.estado, 'Valor total': Math.round(f.valor)
    };
    D_LEG_CATS.forEach(function(c) { o[c.k] = Math.round(f.cats[c.k] || 0); });
    return o;
  });

  var hojaMes = Object.keys(d.porMes).sort().map(function(m) {
    var o = { 'Mes': m }, t = 0;
    D_LEG_CATS.forEach(function(c) { var v = Math.round(d.porMes[m][c.k] || 0); o[c.k] = v; t += v; });
    o['Total'] = t;
    return o;
  });

  // Prorrateo por empresa: mismas filas y porcentajes que las tablas de la pestaña.
  function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
  var pro = d.pro;
  // extra (opcional): { fila: function(empresa) → columnas extra, total: columnas extra del TOTAL }
  function hojaBloque(porEmpresa, total, sinLabel, sinValor, extra) {
    var filas = Object.keys(porEmpresa).map(function(e) { return { e: e, v: porEmpresa[e] }; })
      .sort(function(a, b) { return b.v - a.v; })
      .map(function(r) {
        var o = { 'Empresa': r.e, 'Monto': r2(r.v), '%': total > 0 ? r2(r.v / total * 100) : 0 };
        if (extra) { var x = extra.fila(r.e); Object.keys(x).forEach(function(k) { o[k] = x[k]; }); }
        return o;
      });
    if (sinValor > 0) {
      var s = { 'Empresa': sinLabel, 'Monto': r2(sinValor), '%': total > 0 ? r2(sinValor / total * 100) : 0 };
      if (extra) Object.keys(extra.total).forEach(function(k) { s[k] = ''; });
      filas.push(s);
    }
    var t = { 'Empresa': 'TOTAL', 'Monto': r2(total), '%': total > 0 ? 100 : 0 };
    if (extra) Object.keys(extra.total).forEach(function(k) { t[k] = extra.total[k]; });
    filas.push(t);
    return filas;
  }
  // Carga transportada y costo por unidad movida (litros / kilos / unidades de las
  // remisiones relacionadas; el costo es la parte del gasto de esa bolsa ÷ lo movido).
  function costoUn(monto, cant) { return cant > 0 ? r2(monto / cant) : ''; }
  var carga = d.carga;
  var hojaPro = hojaBloque(pro.porEmpresa, pro.totalGeneral, 'Sin identificar', pro.sinIdentificar, {
    fila: function(e) {
      return {
        'Litros movidos': r2(pro.porEmpresaLitros[e]),
        'Kilos movidos': r2(pro.porEmpresaKilos[e]),
        'Unidades movidas': r2(pro.porEmpresaUnidades[e]),
        '$ por litro': costoUn(pro.porEmpresaMontoLitros[e], pro.porEmpresaLitros[e]),
        '$ por kilo': costoUn(pro.porEmpresaMontoKilos[e], pro.porEmpresaKilos[e]),
        '$ por unidad': costoUn(pro.porEmpresaMontoUnidades[e], pro.porEmpresaUnidades[e]),
        'Legalizaciones': Object.keys(pro.porEmpresaLegs[e] || {}).length
      };
    },
    total: {
      'Litros movidos': r2(carga.litros),
      'Kilos movidos': r2(carga.kilos),
      'Unidades movidas': r2(carga.unidades),
      '$ por litro': costoUn(carga.montoLitros, carga.litros),
      '$ por kilo': costoUn(carga.montoKilos, carga.kilos),
      '$ por unidad': costoUn(carga.montoUnidades, carga.unidades),
      'Legalizaciones': pro.legsPeriodoCount
    }
  });
  var hojaComb = hojaBloque(pro.combustiblePorEmpresa, pro.combustibleTotalGeneral, 'Sin reparto asignado', pro.combustibleSinAsignar);
  var hojaMant = hojaBloque(pro.mantenimiento.porEmpresa, pro.mantenimiento.total, 'Sin reparto asignado', pro.mantenimiento.sinAsignar);

  var hojaVeh = d.vehiculos.map(function(v) {
    return {
      'Placa': v.placa, 'Descripción': v.descripcion, 'Viajes': v.viajes, 'Km recorridos': Math.round(v.km),
      'Galones': Math.round(v.galones * 10) / 10,
      'Km/galón real': v.rend != null ? Math.round(v.rend * 10) / 10 : '',
      'Km/galón esperado': v.esperado != null ? v.esperado : '',
      'Alerta (>25 % bajo lo esperado)': v.alerta ? 'Sí' : '',
      '$ Combustible': Math.round(v.costoComb),
      '$ por km': v.costoKm != null ? Math.round(v.costoKm) : ''
    };
  });

  var criterios = [
    ['Legalización de gastos'],
    ['Rango', dLegUltimo.rango],
    ['Generado', new Date().toLocaleString('es-CO')],
    [],
    ['Incluye legalizaciones de ruta, mantenimiento y envíos por fecha de la legalización; excluye las rechazadas (' + d.rechazadas + ' en el período).'],
    ['Concepto: Combustible, Peaje, Alimentación, Alojamiento y Envío; el resto es "Otros". Las líneas de mantenimiento van a "Mantenimiento" salvo su combustible.'],
    ['Gasto por empresa: el gasto de cada ruta o envío (sin combustible) se prorratea entre los productos de sus remisiones relacionadas por litros, kilos o unidades, a la empresa dueña de cada remisión; lo que no se liga a un producto es "Sin identificar".'],
    ['Litros / kilos / unidades movidos: los de los productos de las remisiones relacionadas a rutas y envíos; $ por litro / kilo / unidad = parte del gasto prorrateada a esa bolsa ÷ cantidad movida. Lo "Sin identificar" no tiene cantidades.'],
    ['Combustible y Mantenimiento por empresa: según el reparto manual de cada legalización; sin reparto, "Sin reparto asignado". Las líneas de combustible de mantenimiento van a la hoja de Combustible.'],
    ['Las hojas de empresa son las mismas cifras de la pestaña "Prorrateo de gastos" del módulo Legalización (mismo rango, sin filtro de empresa).'],
    ['Vehículos: viajes de ruta con km de salida y llegada. Km/galón = km de los viajes con galones ÷ galones de combustible.'],
    ['Si el usuario está limitado a ciertas empresas, RLS solo le entrega las legalizaciones que las involucran: los totales pueden ser parciales.']
  ];
  var wsC = XLSX.utils.aoa_to_sheet(criterios);
  wsC['!cols'] = [{ wch: 130 }, { wch: 30 }];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaLeg), 'Legalizaciones');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaMes), 'Gasto por mes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaPro), 'Gasto por empresa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaComb), 'Combustible por empresa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaMant), 'Mantenimiento por empresa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojaVeh.length ? hojaVeh : [{ 'Placa': '(sin viajes con kilometraje en el período)' }]), 'Vehículos');
  XLSX.utils.book_append_sheet(wb, wsC, 'Criterios');
  XLSX.writeFile(wb, 'legalizacion_gastos_' + today() + '.xlsx');
}

// ── Init ──
loadDashboard();
