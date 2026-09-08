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
// Idéntica a js/existencias.js:_normProd — las claves del snapshot
// (snapshot.saldos[prodKey]) y de los movimientos (m.producto) usan ésta.
function _reabNormProd(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
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
  var total = 0, minF = null;
  (kxMovimientos || []).forEach(function(m) {
    if (m.tipo !== 'Salida' || m.modulo !== 'Pedidos') return;
    if (empresa && m.empresa !== empresa) return;
    if (m.producto !== prodKey) return;
    var f = _reabIsoDia(m.fecha);
    if (!f || f < desde) return;
    total += Number(m.cantidad) || 0;
    if (!minF || f < minF) minF = f;
  });
  var dias = minF ? Math.round((hoyMs - new Date(minF + 'T00:00:00').getTime()) / 86400000) + 1 : 0;
  dias = Math.max(0, Math.min(dias, REAB_VENTANA_DIAS));
  return {
    consumoDia: (dias > 0 && total > 0) ? total / dias : 0,
    unidades: total,
    diasEfectivos: dias
  };
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

// Exponer los helpers puros para pruebas offline con node.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REAB_VENTANA_DIAS: REAB_VENTANA_DIAS,
    REAB_DEFAULTS: REAB_DEFAULTS,
    _reabNormProd: _reabNormProd,
    _reabConsumoDiario: _reabConsumoDiario,
    _reabResolveParam: _reabResolveParam,
    _reabPuntoReorden: _reabPuntoReorden,
    _reabRedondearLote: _reabRedondearLote,
    _reabCalcularFila: _reabCalcularFila
  };
}
