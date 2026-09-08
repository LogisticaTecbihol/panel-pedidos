// ══════════════════════════════════════════════════════════════
// Reabastecimiento (Fase 3) — punto de reorden + solicitud de compra
//
// Toda la lógica de cálculo vive en este archivo (no se replica en
// dashboard.js / reportes.js). Si más adelante el Dashboard necesita
// el mismo número, se extrae a js/shared.js — no se copia.
//
// F3-A: constantes + helpers puros (sin DOM). La carga de datos, la
// tabla y los modales llegan en F3-B..F3-E.
// ══════════════════════════════════════════════════════════════

// Ventana de consumo: salidas a cliente de los últimos N días
// (misma definición que buildCobertura de dashboard.js).
var REAB_VENTANA_DIAS = 90;

// Estados de una solicitud de reabastecimiento.
var REAB_ESTADOS = ['Pendiente', 'En OC', 'Comprada', 'Descartada'];

// Defaults cuando (producto, empresa) no tiene fila en parametros_inventario.
// Confirmar lead_time_dias y dias_cobertura_objetivo con el negocio.
var REAB_DEFAULTS = {
  stock_seguridad: 0,
  punto_reorden: 0,            // 0 → se calcula: consumo_diario × lead_time + stock_seguridad
  lote_optimo_compra: 0,       // 0 → sin redondeo
  lead_time_dias: 15,
  dias_cobertura_objetivo: 30,
  empresa_proveedora_default: '',
  activo: true
};

// Estados de Estado_2 que NO cuentan como pendiente (igual que buildPlanta de reportes.js).
var REAB_ESTADO2_EXCLUIR = {
  'anulado': 1, 'alistado': 1, 'cerrado': 1,
  'bloqueado por cartera': 1, 'entregado por proveedor': 1
};

// ── Normalización de producto ───────────────────────────────────
// Base: js/existencias.js:_normProd (NFD, sin acentos, espacios colapsados) +
// MAYÚSCULAS. Los datos transaccionales (Pedidos/Ingresos/OC → snapshot) ya
// vienen en mayúsculas; el maestro tiene ~3 filas que no, y los parámetros los
// escribe un humano — subir todo a mayúsculas hace robusto el cruce
// parámetro ↔ movimiento. Idempotente sobre claves ya normalizadas del snapshot.
function _reabNormProd(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}


// ── Fechas ──────────────────────────────────────────────────────
function _reabHoyIso() {
  return (typeof today === 'function') ? today() : new Date().toISOString().slice(0, 10);
}

function _reabIsoDia(v) {
  var s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// ── Consumo diario ──────────────────────────────────────────────
// Salidas a cliente (kxMovimientos con tipo='Salida' y modulo='Pedidos')
// de los últimos REAB_VENTANA_DIAS días, para (producto, empresa).
// Días efectivos = desde la primera salida dentro de la ventana hasta hoy
// (EntregasPedido arranca en ago-2026, así que puede ser < 90).
// Devuelve { consumoDia, unidades, diasEfectivos }.
function _reabConsumoDiario(kxMovimientos, prodKey, empresa, hoyIso) {
  hoyIso = hoyIso || _reabHoyIso();
  var hoyMs = new Date(hoyIso + 'T00:00:00').getTime();
  var desde = new Date(hoyMs - REAB_VENTANA_DIAS * 86400000).toISOString().slice(0, 10);
  var agg = { total: 0, minF: null };
  (kxMovimientos || []).forEach(function(m) {
    if (m.tipo !== 'Salida' || m.modulo !== 'Pedidos') return;
    if (empresa && m.empresa !== empresa) return;
    if (m.producto !== prodKey) return;
    var f = _reabIsoDia(m.fecha);
    if (!f || f < desde) return;
    agg.total += Number(m.cantidad) || 0;
    if (!agg.minF || f < agg.minF) agg.minF = f;
  });
  return _reabConsumoFromAgg(agg, hoyIso);
}

// Igual que _reabConsumoDiario pero a partir de un agregado ya calculado
// { total, minF } (para no re-escanear kxMovimientos por cada producto×empresa).
function _reabConsumoFromAgg(agg, hoyIso) {
  hoyIso = hoyIso || _reabHoyIso();
  var total = (agg && Number(agg.total)) || 0;
  var minF = agg && agg.minF;
  if (!minF || total <= 0) return { consumoDia: 0, unidades: total, diasEfectivos: 0 };
  var hoyMs = new Date(hoyIso + 'T00:00:00').getTime();
  var dias = Math.round((hoyMs - new Date(minF + 'T00:00:00').getTime()) / 86400000) + 1;
  dias = Math.max(0, Math.min(dias, REAB_VENTANA_DIAS));
  return { consumoDia: dias > 0 ? total / dias : 0, unidades: total, diasEfectivos: dias };
}

// ── Resolución del parámetro ────────────────────────────────────
// Busca la fila de parametros_inventario para (producto, empresa):
//   1) (Producto, Empresa)  2) (Producto, NULL)  3) REAB_DEFAULTS.
// `params` es el array crudo de la tabla; se indexa por producto normalizado.
function _reabResolveParam(params, prodKey, empresa) {
  var exacta = null, general = null;
  (params || []).forEach(function(p) {
    if (_reabNormProd(p.Producto) !== prodKey) return;
    var emp = p.Empresa == null ? '' : String(p.Empresa);
    if (emp && emp === empresa) exacta = p;
    else if (!emp) general = p;
  });
  var base = exacta || general;
  if (!base) return _reabExtend({}, REAB_DEFAULTS, { _origen: 'default' });
  return _reabExtend({}, REAB_DEFAULTS, base, {
    _origen: exacta ? 'empresa' : 'general'
  });
}

function _reabExtend(dst) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (!src) continue;
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k) && src[k] != null) dst[k] = src[k];
  }
  return dst;
}

// ── Punto de reorden efectivo ───────────────────────────────────
function _reabPuntoReorden(param, consumoDia) {
  var pr = Number(param && param.punto_reorden) || 0;
  if (pr > 0) return pr;
  var lt = Number(param && param.lead_time_dias) || REAB_DEFAULTS.lead_time_dias;
  var ss = Number(param && param.stock_seguridad) || 0;
  return (Number(consumoDia) || 0) * lt + ss;
}

// ── Redondeo al lote óptimo de compra ───────────────────────────
function _reabRedondearLote(qty, lote) {
  qty = Math.max(0, Number(qty) || 0);
  lote = Number(lote) || 0;
  if (lote <= 0) return Math.ceil(qty);
  return Math.ceil(qty / lote) * lote;
}

// ── Cálculo de una fila de sugerencia ───────────────────────────
// Entrada: { param, consumoDia, disponible, enCamino, yaSolicitado, pendiente }
// Salida:  { puntoReorden, necesidadPron, necesidadBruta, faltante,
//            sugerir, cantidadSugerida, motivo, clase, coberturaDias }
function _reabCalcularFila(inp) {
  var param        = inp.param || _reabExtend({}, REAB_DEFAULTS);
  var consumoDia   = Number(inp.consumoDia) || 0;
  var disponible   = Number(inp.disponible) || 0;
  var enCamino     = Number(inp.enCamino) || 0;
  var yaSolicitado = Number(inp.yaSolicitado) || 0;
  var pendiente    = Number(inp.pendiente) || 0;

  var leadTime  = Number(param.lead_time_dias) || REAB_DEFAULTS.lead_time_dias;
  var cobObj    = Number(param.dias_cobertura_objetivo) || REAB_DEFAULTS.dias_cobertura_objetivo;

  var puntoReorden   = _reabPuntoReorden(param, consumoDia);
  var necesidadPron  = consumoDia * (leadTime + cobObj);
  var necesidadBruta = Math.max(pendiente, necesidadPron);
  var faltante       = necesidadBruta - disponible - enCamino - yaSolicitado;

  var bajoReorden = (disponible + enCamino) < puntoReorden;
  var sugerir     = (bajoReorden || faltante > 0) && param.activo !== false;

  // Sin nada que reponer si no hay stock, ni demanda, ni histórico de consumo
  // — salvo que exista un parámetro específico para esa empresa (alta proactiva).
  if (disponible <= 0 && pendiente <= 0 && enCamino <= 0 && consumoDia <= 0 &&
      (!param || param._origen !== 'empresa')) {
    sugerir = false;
  }

  var cantidadSugerida = _reabRedondearLote(
    Math.max(faltante, puntoReorden - disponible - enCamino),
    param.lote_optimo_compra
  );

  var coberturaDias = consumoDia > 0 ? (disponible / consumoDia) : (disponible > 0 ? Infinity : 0);

  var motivo, clase;
  if (disponible <= 0 && pendiente > 0) { motivo = 'agotado_con_pendiente'; clase = 'rojo'; }
  else if (bajoReorden)                 { motivo = 'bajo_reorden';          clase = 'naranja'; }
  else if (coberturaDias < leadTime)    { motivo = 'pronostico';            clase = 'amarillo'; }
  else                                  { motivo = 'ok';                    clase = 'verde'; }

  return {
    puntoReorden: puntoReorden,
    necesidadPron: necesidadPron,
    necesidadBruta: necesidadBruta,
    faltante: faltante,
    bajoReorden: bajoReorden,
    sugerir: sugerir,
    cantidadSugerida: sugerir ? Math.max(0, cantidadSugerida) : 0,
    motivo: motivo,
    clase: clase,
    coberturaDias: coberturaDias
  };
}

var REAB_MOTIVO_LABEL = {
  agotado_con_pendiente: 'Agotado con pedidos',
  bajo_reorden: 'Bajo punto de reorden',
  pronostico: 'Cobertura corta',
  ok: 'OK'
};

var REAB_MOTIVO_BADGE = {
  agotado_con_pendiente: ['#fdecea', '#922b21', 'Agotado con pedidos'],
  bajo_reorden:          ['#fef3cd', '#b7791f', 'Bajo reorden'],
  pronostico:            ['#e8f4fd', '#2c5282', 'Cobertura corta'],
  ok:                    ['#eafaf1', '#1e8449', 'OK']
};

function _reabMotivoBadge(motivo) {
  var m = REAB_MOTIVO_BADGE[motivo] || ['#edf2f7', '#4a5568', String(motivo || '')];
  return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:0.72rem;' +
    'font-weight:700;background:' + m[0] + ';color:' + m[1] + '">' + escHtml(m[2]) + '</span>';
}

// ═══════════════════════════════════════════════════════════════
// Capa de datos + render (F3-B) — solo lectura
// ═══════════════════════════════════════════════════════════════

var reabSnapshot = null;       // Existencias.loadSnapshot()  → { saldos, kxMovimientos }
var reabPedidos = [];
var reabOC = [];
var reabParams = [];           // filas de parametros_inventario
var reabSolicitudes = [];      // filas de solicitudes_reabastecimiento
var reabRows = [];             // filas calculadas (todas: sugerir true|false)
var reabTab = 'sugerencias';
var reabSort = { col: 'sugerido', dir: 'desc' };
var _REAB_SEP = '';

function _reabEmpresasVisibles() {
  if (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas && typeof EMPRESAS_HOLDING !== 'undefined') {
    return AUTH.getFilteredEmpresas(EMPRESAS_HOLDING);
  }
  return (typeof EMPRESAS_HOLDING !== 'undefined') ? EMPRESAS_HOLDING : [];
}

// ── Carga ──────────────────────────────────────────────────────
async function loadReabastecimiento() {
  var lz = document.getElementById('load-zone');
  var main = document.getElementById('main');
  var yaCargado = main.style.display === 'block';
  if (yaCargado) {
    if (typeof setSyncStatus === 'function') setSyncStatus('syncing', 'Actualizando datos...');
  } else {
    lz.style.display = '';
    document.getElementById('load-spinner').style.display = 'inline-block';
    document.getElementById('load-error').textContent = '';
    document.getElementById('btn-retry').style.display = 'none';
  }
  try {
    if (typeof _authReady !== 'undefined') { try { await _authReady; } catch (e) {} }
    populateEmpresaSelect('f-emp', 'Todas');

    var res = await Promise.all([
      (typeof Existencias !== 'undefined' && Existencias.loadSnapshot)
        ? Existencias.loadSnapshot().catch(function() { return null; })
        : Promise.resolve(null),
      apiGet('getPedidos', { columns: 'Nombre_Empresa,Producto,Presentacion,Cant_Pendiente,Estado_2' })
        .catch(function() { return { ok: true, pedidos: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Producto,Presentacion,Cantidad,Empresa_Destino,Remision,Estado,Tipo' })
        .catch(function() { return { ok: true, ordenes: [] }; }),
      _sb.from('parametros_inventario').select('*'),
      _sb.from('solicitudes_reabastecimiento').select('*')
    ]);

    reabSnapshot = res[0];
    reabPedidos = (res[1].pedidos || []).filter(function(p) {
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Producto !== 'Producto';
    });
    reabOC = res[2].ordenes || [];
    reabParams = (res[3] && res[3].data) || [];
    reabSolicitudes = (res[4] && res[4].data) || [];

    reabBuildSugerencias();
    lz.style.display = 'none';
    main.style.display = 'block';
    reabRender();
    if (typeof setSyncStatus === 'function') setSyncStatus('ok', 'Conectado a la nube.');
  } catch (err) {
    document.getElementById('load-error').textContent = (err && err.message) || String(err);
    document.getElementById('btn-retry').style.display = '';
    if (typeof setSyncStatus === 'function') setSyncStatus('error', 'Error al conectar');
  }
}

// ── Cálculo de todas las filas de sugerencia ────────────────────
function reabBuildSugerencias() {
  reabRows = [];
  if (!reabSnapshot || !reabSnapshot.saldos) return;

  var hoy = _reabHoyIso();
  var hoyMs = new Date(hoy + 'T00:00:00').getTime();
  var desde = new Date(hoyMs - REAB_VENTANA_DIAS * 86400000).toISOString().slice(0, 10);

  var empresas = _reabEmpresasVisibles();
  var empByValue = {};
  empresas.forEach(function(e) { empByValue[e.value] = e; });

  var movs = reabSnapshot.kxMovimientos || [];

  // 0) disponible por (prodKey, empresa) — re-normaliza las claves del snapshot
  //    a MAYÚSCULAS (idempotente) y filtra a empresas visibles.
  var dispAgg = {};
  Object.keys(reabSnapshot.saldos || {}).forEach(function(rawKey) {
    var pk = _reabNormProd(rawKey);
    var per = reabSnapshot.saldos[rawKey] || {};
    Object.keys(per).forEach(function(emp) {
      if (!empByValue[emp]) return;
      var k = pk + _REAB_SEP + emp;
      dispAgg[k] = (dispAgg[k] || 0) + (Number(per[emp]) || 0);
    });
  });

  // 1) consumo agregado (una pasada)
  var consumoAgg = {};
  movs.forEach(function(m) {
    if (m.tipo !== 'Salida' || m.modulo !== 'Pedidos') return;
    if (!empByValue[m.empresa]) return;
    var f = _reabIsoDia(m.fecha);
    if (!f || f < desde) return;
    var k = _reabNormProd(m.producto) + _REAB_SEP + m.empresa;
    var a = consumoAgg[k] || (consumoAgg[k] = { total: 0, minF: null });
    a.total += Number(m.cantidad) || 0;
    if (!a.minF || f < a.minF) a.minF = f;
  });

  // 2) pendiente agregado + presentación / nombre representativos
  var pendAgg = {}, presAgg = {}, nombreAgg = {};
  reabPedidos.forEach(function(p) {
    if (!empByValue[p.Nombre_Empresa]) return;
    var pk = _reabNormProd(p.Producto);
    if (!pk) return;
    var k = pk + _REAB_SEP + p.Nombre_Empresa;
    if (!nombreAgg[pk]) nombreAgg[pk] = String(p.Producto || '').trim();
    if (!presAgg[k] && p.Presentacion) presAgg[k] = p.Presentacion;
    var pend = Number(p.Cant_Pendiente) || 0;
    if (pend <= 0) return;
    var est2 = (p.Estado_2 || 'Abierto').trim().toLowerCase();
    if (REAB_ESTADO2_EXCLUIR[est2]) return;
    pendAgg[k] = (pendAgg[k] || 0) + pend;
  });

  // 3) en camino (OC entrantes sin remisión, no anuladas)
  var enCaminoAgg = {};
  reabOC.forEach(function(oc) {
    var cant = Number(oc.Cantidad) || 0;
    if (cant <= 0) return;
    if (String(oc.Remision || '').trim()) return;
    if ((oc.Estado || '').trim().toLowerCase() === 'anulada') return;
    if (!empByValue[oc.Empresa_Destino]) return;
    var pk = _reabNormProd(oc.Producto);
    if (!pk) return;
    var k = pk + _REAB_SEP + oc.Empresa_Destino;
    enCaminoAgg[k] = (enCaminoAgg[k] || 0) + cant;
    if (!nombreAgg[pk]) nombreAgg[pk] = String(oc.Producto || '').trim();
    if (!presAgg[k] && oc.Presentacion) presAgg[k] = oc.Presentacion;
  });

  // 4) ya solicitado (solicitudes Pendiente | En OC)
  var solicAgg = {};
  reabSolicitudes.forEach(function(s) {
    var est = (s.estado || '').trim();
    if (est !== 'Pendiente' && est !== 'En OC') return;
    var k = _reabNormProd(s.Producto) + _REAB_SEP + s.Empresa;
    solicAgg[k] = (solicAgg[k] || 0) + (Number(s.cantidad_sugerida) || 0);
  });

  // 5) universo de candidatos (prodKey, empresa)
  var cand = {};
  function addCand(pk, emp) { if (pk && empByValue[emp]) cand[pk + _REAB_SEP + emp] = { pk: pk, emp: emp }; }
  [dispAgg, consumoAgg, pendAgg, enCaminoAgg].forEach(function(agg) {
    Object.keys(agg).forEach(function(k) {
      var i = k.indexOf(_REAB_SEP);
      addCand(k.slice(0, i), k.slice(i + 1));
    });
  });
  reabParams.forEach(function(pm) {
    var pk = _reabNormProd(pm.Producto);
    if (pm.Empresa) addCand(pk, pm.Empresa);
    // parámetro general (Empresa NULL): candidato solo donde ya hay actividad
    // (stock/consumo/pendiente/en camino) — la fila con "sin actividad" se
    // descarta en _reabCalcularFila.
  });

  // 6) calcular una fila por candidato
  Object.keys(cand).forEach(function(ck) {
    var c = cand[ck];
    var k = c.pk + _REAB_SEP + c.emp;
    var cons = _reabConsumoFromAgg(consumoAgg[k], hoy);
    var disponible = dispAgg[k] || 0;
    var enCamino = enCaminoAgg[k] || 0;
    var yaSolic = solicAgg[k] || 0;
    var pend = pendAgg[k] || 0;
    var param = _reabResolveParam(reabParams, c.pk, c.emp);
    var fila = _reabCalcularFila({
      param: param, consumoDia: cons.consumoDia, disponible: disponible,
      enCamino: enCamino, yaSolicitado: yaSolic, pendiente: pend
    });
    reabRows.push({
      prodKey: c.pk,
      producto: nombreAgg[c.pk] || c.pk,   // convención del panel: producto en MAYÚSCULAS
      empresa: c.emp,
      sigla: (empByValue[c.emp] && empByValue[c.emp].sigla) || (typeof getSigla === 'function' ? getSigla(c.emp) : c.emp),
      presentacion: presAgg[k] || '',
      disponible: disponible,
      enCamino: enCamino,
      yaSolicitado: yaSolic,
      pendiente: pend,
      consumoDia: cons.consumoDia,
      diasConsumo: cons.diasEfectivos,
      param: param,
      puntoReorden: fila.puntoReorden,
      coberturaDias: fila.coberturaDias,
      sugerido: fila.cantidadSugerida,
      motivo: fila.motivo,
      clase: fila.clase,
      bajoReorden: fila.bajoReorden,
      sugerir: fila.sugerir
    });
  });
}

// ── Filtros ────────────────────────────────────────────────────
function reabFilteredRows() {
  var emp = _reabVal('f-emp'), txt = _reabVal('f-txt').toLowerCase().trim(), motivo = _reabVal('f-motivo');
  var incluirOk = !!(document.getElementById('f-incluir-ok') && document.getElementById('f-incluir-ok').checked);
  return reabRows.filter(function(r) {
    if (!incluirOk && !r.sugerir) return false;
    if (emp && r.empresa !== emp) return false;
    if (motivo && r.motivo !== motivo) return false;
    if (txt && r.producto.toLowerCase().indexOf(txt) < 0) return false;
    return true;
  });
}

function _reabVal(id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; }

function reabClearFilters() {
  ['f-emp', 'f-txt', 'f-motivo'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
  var ok = document.getElementById('f-incluir-ok'); if (ok) ok.checked = false;
  reabRender();
}

// ── Tabs ───────────────────────────────────────────────────────
function reabSwitchTab(tab) {
  reabTab = tab;
  ['sugerencias', 'solicitudes'].forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    var btn = document.getElementById('tab-' + t);
    if (btn) btn.style.background = (t === tab) ? '#1a5276' : '#718096';
  });
}

// ── Render ─────────────────────────────────────────────────────
function reabRender() {
  reabRenderStats();
  reabRenderTable();
  if (typeof reabRenderBanner === 'function') reabRenderBanner();
}

function reabRenderStats() {
  var bajo = 0, agot = 0, sug = 0;
  reabRows.forEach(function(r) {
    if (!r.sugerir) return;
    sug++;
    if (r.bajoReorden) bajo++;
    if (r.motivo === 'agotado_con_pendiente') agot++;
  });
  _reabSetText('s-reorden', bajo);
  _reabSetText('s-agotados', agot);
  _reabSetText('s-sugerencias', sug);
}

function _reabSetText(id, n) {
  var el = document.getElementById(id);
  if (el) el.textContent = Number(n || 0).toLocaleString('es-CO');
}

var REAB_SUG_COLS = [
  { id: 'producto',   label: 'Producto',    get: function(r) { return r.producto.toLowerCase(); } },
  { id: 'empresa',    label: 'Empresa',     get: function(r) { return r.sigla; } },
  { id: 'disponible', label: 'Disp.',       get: function(r) { return r.disponible; }, num: 1 },
  { id: 'encamino',   label: 'En camino',   get: function(r) { return r.enCamino; }, num: 1 },
  { id: 'consumo',    label: 'Consumo/día', get: function(r) { return r.consumoDia; }, num: 1 },
  { id: 'cobertura',  label: 'Cobertura',   get: function(r) { return r.coberturaDias; }, num: 1 },
  { id: 'reorden',    label: 'P. reorden',  get: function(r) { return r.puntoReorden; }, num: 1 },
  { id: 'sugerido',   label: 'Sugerido',    get: function(r) { return r.sugerido; }, num: 1 },
  { id: 'motivo',     label: 'Motivo',      get: function(r) { return r.motivo; } }
];

function reabToggleSort(col) {
  if (reabSort.col === col) reabSort.dir = (reabSort.dir === 'asc') ? 'desc' : 'asc';
  else { reabSort.col = col; reabSort.dir = (col === 'producto' || col === 'empresa' || col === 'motivo') ? 'asc' : 'desc'; }
  reabRenderTable();
}

function reabSortedRows(rows) {
  var col = null;
  for (var i = 0; i < REAB_SUG_COLS.length; i++) if (REAB_SUG_COLS[i].id === reabSort.col) col = REAB_SUG_COLS[i];
  if (!col) col = REAB_SUG_COLS[7];
  var dir = (reabSort.dir === 'asc') ? 1 : -1;
  return rows.slice().sort(function(a, b) {
    var va = col.get(a), vb = col.get(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.producto.localeCompare(b.producto, 'es');
  });
}

function _reabFmtNum(n) {
  if (n === Infinity) return '∞';
  return Math.round(Number(n) || 0).toLocaleString('es-CO');
}

function _reabCoberturaCell(dias, leadTime) {
  if (dias === Infinity) return '<span style="color:#1e8449;font-weight:700">∞</span>';
  var d = Math.round(dias);
  var col = d < (leadTime || 15) ? '#e74c3c' : d < 30 ? '#e67e22' : '#27ae60';
  return '<span style="color:' + col + ';font-weight:700">' + d.toLocaleString('es-CO') + ' d</span>';
}

function reabRenderTable() {
  var head = document.getElementById('sug-head');
  var body = document.getElementById('sug-body');
  if (!head || !body) return;

  head.innerHTML = REAB_SUG_COLS.map(function(c) {
    var cls = reabSort.col === c.id ? (reabSort.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    return '<th class="' + cls + '" style="cursor:pointer" onclick="reabToggleSort(\'' + c.id + '\')">' +
      escHtml(c.label) + '</th>';
  }).join('') + '<th></th>';

  var rows = reabSortedRows(reabFilteredRows());
  var ct = document.getElementById('sug-ct');
  if (ct) ct.textContent = '(' + rows.length + (rows.length === 1 ? ' producto)' : ' productos)');

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#a0aec0;padding:24px">' +
      'Sin sugerencias de reabastecimiento con los filtros actuales.</td></tr>';
    return;
  }

  body.innerHTML = rows.map(function(r) {
    var lead = Number(r.param && r.param.lead_time_dias) || REAB_DEFAULTS.lead_time_dias;
    var tint = r.motivo === 'agotado_con_pendiente' ? 'background:#fff5f5'
             : r.motivo === 'bajo_reorden' ? 'background:#fffdf3' : '';
    return '<tr style="' + tint + '">' +
      '<td style="font-weight:600;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.producto) + '">' + escHtml(r.producto) + '</td>' +
      '<td>' + escHtml(r.sigla) + '</td>' +
      '<td class="money">' + _reabFmtNum(r.disponible) + '</td>' +
      '<td class="money">' + (r.enCamino ? _reabFmtNum(r.enCamino) : '—') + '</td>' +
      '<td class="money">' + (r.consumoDia ? r.consumoDia.toLocaleString('es-CO', { maximumFractionDigits: 1 }) : '—') + '</td>' +
      '<td class="money">' + _reabCoberturaCell(r.coberturaDias, lead) + '</td>' +
      '<td class="money">' + _reabFmtNum(r.puntoReorden) + '</td>' +
      '<td class="money" style="font-weight:700">' + _reabFmtNum(r.sugerido) + '</td>' +
      '<td>' + _reabMotivoBadge(r.motivo) + '</td>' +
      '<td></td>' +
    '</tr>';
  }).join('');
}

// ── Listeners de filtro ────────────────────────────────────────
(function() {
  if (typeof document === 'undefined') return;
  function on(id, ev, fn) { var el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }
  var deb = (typeof debounce === 'function') ? debounce(reabRenderTable, 220) : reabRenderTable;
  on('f-emp', 'change', reabRenderTable);
  on('f-motivo', 'change', reabRenderTable);
  on('f-txt', 'input', deb);
})();

// ── Init ───────────────────────────────────────────────────────
if (typeof document !== 'undefined' && document.getElementById('load-zone') && !window.__REAB_TEST) {
  loadReabastecimiento();
}

// Exponer los helpers puros para pruebas offline con node.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REAB_VENTANA_DIAS: REAB_VENTANA_DIAS,
    REAB_DEFAULTS: REAB_DEFAULTS,
    _reabNormProd: _reabNormProd,
    _reabConsumoDiario: _reabConsumoDiario,
    _reabConsumoFromAgg: _reabConsumoFromAgg,
    _reabResolveParam: _reabResolveParam,
    _reabPuntoReorden: _reabPuntoReorden,
    _reabRedondearLote: _reabRedondearLote,
    _reabCalcularFila: _reabCalcularFila
  };
}
