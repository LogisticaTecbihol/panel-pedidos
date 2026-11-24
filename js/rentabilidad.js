// ══════════════════════════════════════════════════════════════
// Dashboard → pestaña «Rentabilidad» (por ahora solo IASO)
// ──────────────────────────────────────────────────────────────
// Estima la rentabilidad bruta de lo REMISIONADO por IASO: precio de venta del pedido contra el
// costo unitario del producto. IASO es cliente de las otras empresas del holding (GREEN, IAS,
// PARCELAR, RESO) y les compra al precio MAYORISTA de su lista; las órdenes de compra a IASO
// traen valor 0, así que el costo sale de la lista de precios y, si no sirve, se digita a mano.
//
// Dos partes:
//  · `Rentabilidad` (puro, sin DOM ni red): parsea remisiones, agrega por producto, resuelve el
//    costo y calcula márgenes. Es lo que se prueba aparte.
//  · `dRent*` (pantalla): carga datos, pinta KPIs y tabla, edita el costo manual y exporta a Excel.
//    Usa los globales de dashboard.js (dEsConsignacion, dListaPrecios, kpiCard, dMoney*, …) solo
//    dentro de funciones; este archivo carga ANTES de dashboard.js.
//
// Reglas (decididas con el usuario, 2026-11-24):
//  · Solo ve y edita el ADMINISTRADOR (la tabla CostosProducto lo exige por RLS).
//  · Un costo manual vigente por producto; «Restablecer» lo borra (el cambio queda en audit_log).
//  · NO se estima el costo (p. ej. Dealer ÷ 1,35): sin Mayorista ni costo manual = «Sin costo».
//  · Período = fecha de la REMISIÓN (la de cada remisión registrada en Pedidos.Remisiones), no la
//    del pedido: «Desde / Hasta» del Dashboard se aplican a esa fecha.
//  · Fuera: pedidos anulados, cargas históricas (Historico) y pedidos a bodegas / en consignación
//    (los mismos que ya saca dEsConsignacion del resto del Dashboard: no son ventas).
//  · Precio de venta: Valor_Unitario del pedido × cantidad de cada remisión. No entran al precio
//    promedio las líneas bonificadas, con valor menor a $10 (0 o simbólico) ni con valor mayor a
//    5 veces el Dealer de IASO (error de digitación probable).
//  · Costo automático: Mayorista de la proveedora principal según las OC aprobadas a IASO; si esa
//    no lo tiene, el de otra proveedora de las OC; si no, el de otra empresa (el mayor si difieren).
//  · El costo se aplica a TODO el período consultado (no hay vigencia por fechas).
// ══════════════════════════════════════════════════════════════
var Rentabilidad = (function() {
  var EMPRESA_IASO = 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS';
  var SIGLAS = {
    'PARCELAR DE COLOMBIA SAS': 'PARCELAR',
    'GREEN AGROSOLUCIONES DE COLOMBIA SAS': 'GREEN',
    'SOLUCIONES INTEGRALES RESO SAS': 'RESO',
    'INSUMOS AGROPECUARIOS SOSTENIBLES SAS': 'IASO',
    'INSUMOS AGROPECUARIOS DE LA SABANA SAS': 'IAS'
  };
  var VALOR_MINIMO = 10;     // por debajo (0 o simbólico, p. ej. $1) la línea no cuenta como venta
  var FACTOR_ATIPICO = 5;    // por encima de 5 × Dealer: error de digitación probable

  // Mismo criterio que la columna generada Producto_Clave de CostosProducto y que dNormLp:
  // sin tildes, minúsculas, espacios colapsados.
  function clave(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function sigla(empresa) {
    var e = String(empresa == null ? '' : empresa).trim();
    return SIGLAS[e] || e;
  }

  // 'NUM|cant|fecha,NUM|cant|fecha' → [{ num, cant, fecha }] (solo cantidad > 0).
  function parseRemisiones(str) {
    var out = [];
    String(str || '').split(',').forEach(function(t) {
      var p = t.split('|');
      if (p.length < 3) return;
      var cant = Number(String(p[1]).trim());
      if (!(cant > 0) || !isFinite(cant)) return;
      out.push({ num: String(p[0]).trim(), cant: cant, fecha: String(p[2]).trim().slice(0, 10) });
    });
    return out;
  }

  function enRango(fecha, desde, hasta) {
    if (!desde && !hasta) return true;
    var f = String(fecha || '').slice(0, 10);
    if (!f) return false;
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    return true;
  }

  function esBonificado(v) { return clave(v) === 'si'; }

  // clave de producto → { clave de empresa → { empresa, may, dea } } (el mayor precio por tipo)
  function indexarLista(lista) {
    var idx = {};
    (lista || []).forEach(function(lp) {
      var tipo = clave(lp.Tipo_Precio);
      if (tipo !== 'mayorista' && tipo !== 'dealer') return;
      var precio = Number(lp.Precio) || 0;
      if (precio <= 0) return;
      var kp = clave(lp.Producto), ke = clave(lp.Empresa);
      var porEmp = idx[kp] || (idx[kp] = {});
      var o = porEmp[ke] || (porEmp[ke] = { empresa: String(lp.Empresa || '').trim(), may: 0, dea: 0 });
      if (tipo === 'mayorista') { if (precio > o.may) o.may = precio; }
      else if (precio > o.dea) o.dea = precio;
    });
    return idx;
  }

  // clave de producto → [{ empresa, sigla, unidades }] de más a menos unidades. Solo OC de Traslado o
  // Compra con destino la empresa, aprobadas y no anuladas (todas las fechas).
  function indexarProveedoras(ordenes, empresa) {
    var mapa = {};
    (ordenes || []).forEach(function(o) {
      if (!o || String(o.Empresa_Destino || '').trim() !== empresa) return;
      if (o.Tipo !== 'Traslado' && o.Tipo !== 'Compra') return;
      if (o.Estado === 'Anulada' || o.Estado_Aprobacion !== 'Aprobada') return;
      var cant = Number(o.Cantidad) || 0;
      var origen = String(o.Empresa_Origen || '').trim();
      if (!(cant > 0) || !origen) return;
      var k = clave(o.Producto);
      var m = mapa[k] || (mapa[k] = {});
      var ko = clave(origen);
      var x = m[ko] || (m[ko] = { empresa: origen, sigla: sigla(origen), unidades: 0 });
      x.unidades += cant;
    });
    var out = {};
    Object.keys(mapa).forEach(function(k) {
      out[k] = Object.keys(mapa[k]).map(function(ko) { return mapa[k][ko]; })
        .sort(function(a, b) { return b.unidades - a.unidades; });
    });
    return out;
  }

  // Costo automático (precio Mayorista) de un producto, o null si ninguna lista lo trae.
  function costoAutomatico(k, proveedoras, idx, claveEmpresa) {
    var porEmp = idx[k] || {};
    for (var i = 0; i < proveedoras.length; i++) {
      var o = porEmp[clave(proveedoras[i].empresa)];
      if (o && o.may > 0) {
        return { precio: o.may, nivel: i === 0 ? 'proveedora' : 'otra-proveedora',
          texto: 'Mayorista · ' + proveedoras[i].sigla + (i === 0 ? '' : ' (no es la principal)') };
      }
    }
    var otras = [];
    Object.keys(porEmp).forEach(function(ke) { if (ke !== claveEmpresa && porEmp[ke].may > 0) otras.push(porEmp[ke]); });
    if (!otras.length) return null;
    var max = 0;
    otras.forEach(function(o) { if (o.may > max) max = o.may; });
    var iguales = otras.every(function(o) { return o.may === otras[0].may; });
    var sigs = otras.map(function(o) { return sigla(o.empresa); }).sort();
    return { precio: max, nivel: 'otra-empresa',
      texto: 'Mayorista · otra empresa (' + sigs.join('/') + ')' + (iguales ? '' : ', el mayor') };
  }

  // Entrada: { empresa, pedidos, excluidos, anuladas:{num:1}, ordenes, listaPrecios, costos, desde, hasta }
  //   pedidos / excluidos: filas de Pedidos YA filtradas por quien llama (empresa, sin anulados ni
  //   históricos; `excluidos` = bodegas y consignación, solo para informar cuánto quedó fuera).
  //   costos: filas de CostosProducto (costo manual) de cualquier empresa; se usan las de `empresa`.
  function calcular(e) {
    var empresa = e.empresa || EMPRESA_IASO;
    var claveEmp = clave(empresa);
    var desde = e.desde || '', hasta = e.hasta || '';
    var anuladas = e.anuladas || {};
    var idx = indexarLista(e.listaPrecios);
    var provs = indexarProveedoras(e.ordenes, empresa);

    var manuales = {};
    (e.costos || []).forEach(function(c) {
      if (String(c.Empresa || '').trim() !== empresa) return;
      var k = clave(c.Producto);
      if (k) manuales[k] = c;
    });

    var filas = {};
    (e.pedidos || []).forEach(function(p) {
      var toks = parseRemisiones(p.Remisiones);
      if (!toks.length) return;
      var k = clave(p.Producto);
      if (!k) return;
      var vu = Number(p.Valor_Unitario) || 0;
      var bon = esBonificado(p.Bonificado);
      var dealerIdx = idx[k] && idx[k][claveEmp];
      var dealer = dealerIdx ? dealerIdx.dea : 0;
      toks.forEach(function(t) {
        if (!enRango(t.fecha, desde, hasta)) return;
        if (t.num && anuladas[t.num]) return;
        var f = filas[k] || (filas[k] = {
          clave: k, producto: String(p.Producto || '').trim(), unidades: 0, bonif: 0, undPrecio: 0, undSinPrecio: 0, valor: 0,
          sinNumero: 0, _remisiones: {}, _pedidos: {}
        });
        f.unidades += t.cant;
        if (t.num) f._remisiones[t.num] = 1; else f.sinNumero++;   // remisiones registradas sin número se cuentan aparte
        f._pedidos[p.Consecutivo + '#' + p.Cliente] = 1;
        if (bon) f.bonif += t.cant;
        else if (vu >= VALOR_MINIMO && !(dealer > 0 && vu > FACTOR_ATIPICO * dealer)) { f.valor += t.cant * vu; f.undPrecio += t.cant; }
        else f.undSinPrecio += t.cant;
      });
    });

    var lista = Object.keys(filas).map(function(k) {
      var f = filas[k];
      f.nPedidos = Object.keys(f._pedidos).length;
      f.nRemisiones = Object.keys(f._remisiones).length;
      delete f._pedidos; delete f._remisiones;
      f.precioProm = f.undPrecio > 0 ? f.valor / f.undPrecio : null;
      f.proveedoras = provs[k] || [];
      var dIdx = idx[k] && idx[k][claveEmp];
      f.dealer = dIdx && dIdx.dea > 0 ? dIdx.dea : null;
      f.auto = costoAutomatico(k, f.proveedoras, idx, claveEmp);
      f.manual = manuales[k] || null;
      if (f.manual) {
        f.costo = Number(f.manual.Costo_Unitario); f.fuente = 'manual'; f.fuenteTxt = 'Manual';
      } else if (f.auto) {
        f.costo = f.auto.precio; f.fuente = 'automatico'; f.fuenteTxt = f.auto.texto;
      } else {
        f.costo = null; f.fuente = 'sin'; f.fuenteTxt = 'Sin costo';
      }
      f.margen = null; f.margenPct = null;
      if (f.costo != null && f.undPrecio > 0) {
        f.margen = f.valor - f.costo * f.undPrecio;
        f.margenPct = f.valor > 0 ? f.margen / f.valor : null;
      }
      // Avisos para revisar la lista (no cambian el cálculo)
      f.avisoCostoMayorQueDealer = !!(f.fuente === 'automatico' && f.dealer && f.costo > f.dealer);
      return f;
    }).sort(function(a, b) { return b.valor - a.valor || a.producto.localeCompare(b.producto); });

    // Lo que quedó fuera por ser bodega / consignación (solo informativo)
    var excl = { unidades: 0, pedidos: {} };
    (e.excluidos || []).forEach(function(p) {
      parseRemisiones(p.Remisiones).forEach(function(t) {
        if (!enRango(t.fecha, desde, hasta)) return;
        if (t.num && anuladas[t.num]) return;
        excl.unidades += t.cant;
        excl.pedidos[p.Consecutivo + '#' + p.Cliente] = 1;
      });
    });

    return { filas: lista, totales: totalizar(lista), excluidos: { unidades: excl.unidades, pedidos: Object.keys(excl.pedidos).length } };
  }

  function totalizar(filas) {
    var t = { productos: filas.length, unidades: 0, bonif: 0, undPrecio: 0, undSinPrecio: 0, valor: 0,
      conCosto: 0, valorConCosto: 0, costoTotal: 0, margen: 0, margenPct: null, cobertura: null,
      sinCosto: 0, valorSinCosto: 0, manuales: 0 };
    filas.forEach(function(f) {
      t.unidades += f.unidades; t.bonif += f.bonif; t.undPrecio += f.undPrecio; t.undSinPrecio += f.undSinPrecio; t.valor += f.valor;
      if (f.manual) t.manuales++;
      if (f.undPrecio <= 0) return;   // sin ventas con precio no hay margen que medir
      if (f.costo != null) {
        t.conCosto++; t.valorConCosto += f.valor; t.costoTotal += f.costo * f.undPrecio;
      } else {
        t.sinCosto++; t.valorSinCosto += f.valor;
      }
    });
    t.margen = t.valorConCosto - t.costoTotal;
    t.margenPct = t.valorConCosto > 0 ? t.margen / t.valorConCosto : null;
    t.cobertura = t.valor > 0 ? t.valorConCosto / t.valor : null;
    return t;
  }

  return {
    EMPRESA_IASO: EMPRESA_IASO, VALOR_MINIMO: VALOR_MINIMO, FACTOR_ATIPICO: FACTOR_ATIPICO,
    clave: clave, sigla: sigla, parseRemisiones: parseRemisiones, enRango: enRango,
    indexarLista: indexarLista, indexarProveedoras: indexarProveedoras, costoAutomatico: costoAutomatico,
    calcular: calcular, totalizar: totalizar
  };
})();

// Para pruebas en Node (no afecta al navegador).
if (typeof module !== 'undefined' && module.exports) module.exports = Rentabilidad;

// ══════════════════════════════════════════════════════════════
// Pantalla
// ══════════════════════════════════════════════════════════════
var DRENT_COLS_PEDIDOS = 'id,Nombre_Empresa,Cliente,Consecutivo,Producto,Valor_Unitario,Bonificado,Remisiones,Estado_2,Historico,Bodega_Consignacion_Id,Consignacion,Fecha_Pedido';
var DRENT_COLS_OC = 'Empresa_Destino,Empresa_Origen,Producto,Cantidad,Tipo,Estado,Estado_Aprobacion';
var DRENT_COLS_COSTOS = 'id,Empresa,Producto,Producto_Clave,Costo_Unitario,Nota,creado_por_nombre,creado_en,modificado_por_nombre,modificado_en';

var dRent = null;            // { pedidos, excluidos, anuladas, ordenes, lista, costos, costosOk, costosError } | null (sin cargar)
var dRentPromesa = null;     // carga en curso
var dRentGen = 0;            // sube al invalidar: una carga vieja no pisa la caché
var dRentBuildTok = 0;       // el último repintado gana
var dRentUltimo = null;      // { res, entrada, rango, desde, hasta } — lo último mostrado (lo que exporta el botón)
var dRentVista = { q: '', filtro: 'todos', orden: 'valor', dir: -1 };
var dRentGuardando = {};     // clave → true mientras se guarda (evita dobles envíos)

function dRentPermiso() { return !!(typeof AUTH !== 'undefined' && AUTH.isAdmin && AUTH.isAdmin()); }

function dRentAplicarPermiso() {
  var btn = document.getElementById('tab-rentabilidad');
  if (btn) btn.style.display = dRentPermiso() ? '' : 'none';
}

function dRentInvalidar() { dRent = null; dRentPromesa = null; dRentGen++; }

function dRentCargar() {
  if (dRent) return Promise.resolve(dRent);
  if (dRentPromesa) return dRentPromesa;
  var gen = dRentGen;
  var p = Promise.all([
    apiGet('getPedidos', { columns: DRENT_COLS_PEDIDOS }),
    apiGet('getRemisionesAnuladas', { columns: 'Empresa,Remision' }),
    apiGet('getOrdenesCompra', { columns: DRENT_COLS_OC }),
    (typeof dListaPrecios !== 'undefined' && dListaPrecios)
      ? Promise.resolve({ ok: true, precios: dListaPrecios })
      : apiGet('getListaPrecios', { columns: 'Empresa,Tipo_Precio,Producto,Precio' }),
    apiGet('getCostosProducto', { columns: DRENT_COLS_COSTOS }).catch(function(e) { return { ok: false, error: e.message }; })
  ]).then(function(r) {
    if (!r[0].ok) throw new Error(r[0].error || 'No se pudieron cargar los pedidos');
    if (!r[1].ok) throw new Error(r[1].error || 'No se pudieron cargar las remisiones anuladas');
    if (!r[2].ok) throw new Error(r[2].error || 'No se pudieron cargar las órdenes de compra');
    if (!r[3].ok) throw new Error(r[3].error || 'No se pudo cargar la Lista de precios');

    var incl = [], excl = [];
    (r[0].pedidos || []).forEach(function(p) {
      if (String(p.Nombre_Empresa || '').trim() !== Rentabilidad.EMPRESA_IASO) return;
      if (p.Cliente === 'Cliente') return;                       // encabezado repetido
      if (p.Historico === true) return;                          // cargas históricas: fuera, como en el resto del Dashboard
      if (String(p.Estado_2 || '') === 'Anulado') return;
      (dEsConsignacion(p) ? excl : incl).push(p);
    });
    var anuladas = {};
    (r[1].remisionesAnuladas || []).forEach(function(a) {
      if (String(a.Empresa || '').trim() === Rentabilidad.EMPRESA_IASO && a.Remision) anuladas[String(a.Remision).trim()] = 1;
    });
    var datos = {
      pedidos: incl, excluidos: excl, anuladas: anuladas,
      ordenes: r[2].ordenes || [], lista: r[3].precios || [],
      costos: r[4].ok ? (r[4].costos || []) : [], costosOk: !!r[4].ok, costosError: r[4].ok ? '' : (r[4].error || 'No se pudieron leer los costos manuales')
    };
    if (gen === dRentGen) dRent = datos;
    return datos;
  });
  dRentPromesa = p;
  var limpiar = function() { if (dRentPromesa === p) dRentPromesa = null; };
  p.then(limpiar, limpiar);
  return p;
}

function dRentEntrada(datos, desde, hasta) {
  return {
    empresa: Rentabilidad.EMPRESA_IASO, pedidos: datos.pedidos, excluidos: datos.excluidos, anuladas: datos.anuladas,
    ordenes: datos.ordenes, listaPrecios: datos.lista, costos: datos.costos, desde: desde, hasta: hasta
  };
}

// ── Formatos ──
function dRentMoney(v) {
  if (v == null || !isFinite(v)) return '—';
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}
function dRentNum(v) { return (Number(v) || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 }); }
function dRentPct(v) {
  if (v == null || !isFinite(v)) return '—';
  return (v * 100).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
}

// ── Construcción ──
async function buildRentabilidadDash() {
  var tok = ++dRentBuildTok;
  var chipEl = document.getElementById('rent-chip');
  var msgEl = document.getElementById('rent-msg');
  var contEl = document.getElementById('rent-contenido');
  if (!chipEl) return;

  var fDesde = document.getElementById('df-desde').value;
  var fHasta = document.getElementById('df-hasta').value;
  var rango = dRangoLabel(fDesde, fHasta);
  chipEl.innerHTML = '<span class="dash-range-chip">📅 ' + escHtml(rango) + ' · <span class="emp">IASO</span> · por fecha de remisión</span>';

  if (!dRent) {
    msgEl.textContent = 'Cargando pedidos, órdenes de compra y costos…';
    msgEl.style.display = '';
    contEl.style.display = 'none';
  }
  var datos;
  try {
    datos = await dRentCargar();
  } catch (e) {
    if (tok !== dRentBuildTok) return;
    dRentUltimo = null;
    msgEl.textContent = '⚠️ No se pudo cargar la rentabilidad: ' + e.message;
    msgEl.style.display = '';
    contEl.style.display = 'none';
    return;
  }
  if (tok !== dRentBuildTok || dActiveTab !== 'rentabilidad') return;
  msgEl.style.display = 'none';
  contEl.style.display = '';

  var entrada = dRentEntrada(datos, fDesde, fHasta);
  var res = Rentabilidad.calcular(entrada);
  dRentUltimo = { res: res, entrada: entrada, rango: rango, desde: fDesde, hasta: fHasta };
  dRentPintar();
}

function dRentPintar() {
  if (!dRentUltimo) return;
  dRentPintarKpis();
  dRentPintarControles();
  dRentPintarTabla();
  dRentPintarNota();
}

function dRentPintarKpis() {
  var t = dRentUltimo.res.totales;
  var sinMargen = t.margenPct == null;
  document.getElementById('rent-kpis').innerHTML =
    kpiCard('', dMoneyM(t.valor), 'Ventas remisionadas', dMoneyFull(Math.round(t.valor)) + ' · ' + t.productos + ' productos · sin bonificadas') +
    kpiCard('orange', sinMargen ? '—' : dMoneyM(t.costoTotal), 'Costo de lo vendido', t.cobertura == null ? 'sin ventas con precio'
      : 'cobertura ' + dRentPct(t.cobertura) + ' de las ventas (' + t.conCosto + ' productos con costo)') +
    kpiCard(t.margen < 0 ? 'red' : 'teal', sinMargen ? '—' : dMoneyM(t.margen), 'Margen bruto', sinMargen ? 'sin productos con costo' : dMoneyFull(Math.round(t.margen)) + ' · solo productos con costo') +
    kpiCard(t.margen < 0 ? 'red' : 'green', dRentPct(t.margenPct), 'Margen bruto %', 'sobre las ventas con costo') +
    kpiCard(t.sinCosto ? 'red' : 'green', String(t.sinCosto), 'Productos sin costo', t.sinCosto ? dMoneyM(t.valorSinCosto) + ' en ventas sin margen: digita su costo' : 'todo lo vendido tiene costo') +
    kpiCard('purple', String(t.manuales), 'Costos manuales', 'productos del período con costo digitado');
}

function dRentPintarControles() {
  var el = document.getElementById('rent-controles');
  if (!el) return;
  var v = dRentVista;
  el.innerHTML =
    '<input type="search" id="rent-q" placeholder="Buscar producto…" value="' + escHtml(v.q) + '" oninput="dRentBuscar(this.value)" style="width:230px">' +
    '<select id="rent-filtro" onchange="dRentFiltrar(this.value)">' +
      [['todos', 'Todos los productos'], ['sin', 'Solo sin costo'], ['manual', 'Solo con costo manual'], ['automatico', 'Solo con costo automático']]
        .map(function(o) { return '<option value="' + o[0] + '"' + (v.filtro === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
    '</select>' +
    '<span id="rent-cuenta" class="sub"></span>';
}

function dRentFilasVisibles() {
  var v = dRentVista, q = Rentabilidad.clave(v.q);
  return dRentUltimo.res.filas.filter(function(f) {
    if (q && f.clave.indexOf(q) < 0) return false;
    if (v.filtro === 'sin') return f.fuente === 'sin';
    if (v.filtro === 'manual') return f.fuente === 'manual';
    if (v.filtro === 'automatico') return f.fuente === 'automatico';
    return true;
  });
}

// Orden estable y simple: dir = 1 ascendente, -1 descendente.
function dRentOrdenar(filas) {
  var k = dRentVista.orden, dir = dRentVista.dir;
  function val(f) {
    if (k === 'producto') return f.producto.toLowerCase();
    if (k === 'costo') return f.costo == null ? null : f.costo;
    var x = f[k];
    return x == null ? null : x;
  }
  return filas.map(function(f, i) { return { f: f, i: i }; }).sort(function(A, B) {
    var x = val(A.f), y = val(B.f);
    if (x === null && y === null) return A.i - B.i;
    if (x === null) return 1;           // sin dato siempre al final
    if (y === null) return -1;
    if (x < y) return -dir;
    if (x > y) return dir;
    return A.i - B.i;
  }).map(function(o) { return o.f; });
}

var DRENT_COLUMNAS = [
  { k: 'producto', t: 'Producto', cls: '' },
  { k: 'unidades', t: 'Unidades', cls: 'num' },
  { k: 'undPrecio', t: 'Con precio', cls: 'num' },
  { k: 'precioProm', t: 'Precio prom.', cls: 'num' },
  { k: 'valor', t: 'Valor vendido', cls: 'num' },
  { k: null, t: 'Proveedora (OC)', cls: '' },
  { k: null, t: 'Costo automático', cls: 'num' },
  { k: null, t: 'Costo manual', cls: 'num' },
  { k: 'costo', t: 'Costo usado', cls: 'num' },
  { k: 'margen', t: 'Margen $', cls: 'num' },
  { k: 'margenPct', t: 'Margen %', cls: 'num' }
];

function dRentPintarTabla() {
  var cont = document.getElementById('rent-tabla');
  if (!cont) return;
  var visibles = dRentOrdenar(dRentFilasVisibles());
  var total = dRentUltimo.res.filas.length;
  var cuenta = document.getElementById('rent-cuenta');
  if (cuenta) cuenta.textContent = visibles.length === total ? total + ' productos' : visibles.length + ' de ' + total + ' productos';
  document.getElementById('rent-tabla-sub').textContent = total ? total + ' producto(s) remisionados en el período' : '';

  if (!total) {
    cont.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:30px 20px">Sin remisiones de IASO en el período</div>';
    return;
  }
  var flecha = function(k) { return dRentVista.orden === k ? (dRentVista.dir === 1 ? ' ▲' : ' ▼') : ''; };
  var thead = '<thead><tr>' + DRENT_COLUMNAS.map(function(c) {
    return c.k
      ? '<th class="' + c.cls + ' rent-th" onclick="dRentOrdenarPor(\'' + c.k + '\')" title="Ordenar">' + c.t + flecha(c.k) + '</th>'
      : '<th class="' + c.cls + '">' + c.t + '</th>';
  }).join('') + '</tr></thead>';
  cont.innerHTML = '<table class="mini-table rent-table">' + thead + '<tbody>' +
    (visibles.length ? visibles.map(dRentFilaHtml).join('') : '<tr><td colspan="' + DRENT_COLUMNAS.length + '" style="text-align:center;color:#a0aec0;padding:24px">Ningún producto coincide con la búsqueda</td></tr>') +
    '</tbody></table>';
}

function dRentTagFuente(f) {
  var cls = f.fuente === 'manual' ? 'rent-tag-manual' : f.fuente === 'sin' ? 'rent-tag-sin'
    : (f.auto && f.auto.nivel === 'proveedora' ? 'rent-tag-auto' : 'rent-tag-otra');
  var tip = f.manual
    ? 'Costo digitado' + (f.manual.modificado_por_nombre || f.manual.creado_por_nombre ? ' por ' + (f.manual.modificado_por_nombre || f.manual.creado_por_nombre) : '') +
      (f.manual.modificado_en || f.manual.creado_en ? ' el ' + fmtDate(String(f.manual.modificado_en || f.manual.creado_en).slice(0, 10)) : '') +
      (f.manual.Nota ? ' · ' + f.manual.Nota : '') +
      (f.auto ? '\nAutomático: ' + dRentMoney(f.auto.precio) + ' (' + f.auto.texto + ')' : '\nSin costo automático')
    : f.fuente === 'automatico' ? 'Se toma del precio Mayorista de la lista de precios'
    : 'Ninguna lista trae el Mayorista de este producto: digita el costo';
  return '<span class="rent-tag ' + cls + '" title="' + escHtml(tip) + '">' + escHtml(f.fuenteTxt) + '</span>';
}

function dRentFilaHtml(f) {
  var editable = dRentUltimo && dRent && dRent.costosOk;
  var prov = f.proveedoras.length
    ? f.proveedoras.map(function(p) { return escHtml(p.sigla) + ' ' + dRentNum(p.unidades); }).join(' · ')
    : '<span style="color:#a0aec0">—</span>';
  var valorInput = f.manual ? Number(f.manual.Costo_Unitario) : '';
  var neg = f.margen != null && f.margen < 0;
  return '<tr data-k="' + escHtml(f.clave) + '">' +
    '<td style="font-weight:600;max-width:260px" title="' + escHtml(f.producto) + '">' + escHtml(f.producto) +
      (f.avisoCostoMayorQueDealer ? ' <span class="leg-aviso" title="El costo automático es mayor que el Dealer de IASO: revisa la lista de precios">⚠</span>' : '') + '</td>' +
    '<td class="num" title="' + dRentNum(f.nRemisiones) + ' remisión(es)' + (f.sinNumero ? ' (+' + f.sinNumero + ' sin número)' : '') + ' · ' + dRentNum(f.nPedidos) + ' pedido(s)' + (f.undSinPrecio ? ' · ' + dRentNum(f.undSinPrecio) + ' ud sin precio válido' : '') + '">' +
      dRentNum(f.unidades) + (f.bonif ? ' <small style="color:#718096">(+' + dRentNum(f.bonif) + ' bonif.)</small>' : '') + '</td>' +
    '<td class="num">' + dRentNum(f.undPrecio) + '</td>' +
    '<td class="num">' + dRentMoney(f.precioProm) + '</td>' +
    '<td class="num">' + dRentMoney(f.valor) + '</td>' +
    '<td style="font-size:0.78rem">' + prov + '</td>' +
    '<td class="num">' + (f.auto ? dRentMoney(f.auto.precio) + '<div class="rent-sub">' + escHtml(f.auto.texto.replace('Mayorista · ', '')) + '</div>' : '<span style="color:#a0aec0">—</span>') + '</td>' +
    '<td class="num rent-edit">' +
      '<input type="number" min="0" step="any" class="rent-costo' + (f.manual ? ' tiene' : '') + '" data-k="' + escHtml(f.clave) + '" value="' + valorInput + '" ' +
        'placeholder="digitar" ' + (editable ? '' : 'disabled title="La tabla de costos manuales no está disponible"') +
        ' onchange="dRentCostoCambio(this)" onkeydown="if(event.key===\'Enter\'){this.blur()}">' +
      (f.manual && editable ? ' <button type="button" class="rent-reset" title="Restablecer: volver al costo automático" onclick="dRentRestablecer(\'' + escHtml(f.clave).replace(/'/g, '&#39;') + '\')">↺</button>' : '') +
    '</td>' +
    '<td class="num">' + (f.costo != null ? '<b>' + dRentMoney(f.costo) + '</b>' : '—') + '<div class="rent-fuente">' + dRentTagFuente(f) + '</div></td>' +
    '<td class="num' + (neg ? ' rent-neg' : '') + '">' + (f.margen != null ? dRentMoney(f.margen) : '—') + '</td>' +
    '<td class="num' + (neg ? ' rent-neg' : '') + '">' + dRentPct(f.margenPct) + '</td>' +
  '</tr>';
}

function dRentPintarNota() {
  var u = dRentUltimo, datos = dRent;
  var ex = u.res.excluidos;
  var sinPrecio = u.res.totales.undSinPrecio;
  document.getElementById('rent-nota').innerHTML =
    '<p>• <b>Qué se mide:</b> lo <b>remisionado</b> por IASO, a razón de <b>fecha de la remisión</b> (el «Desde / Hasta» de arriba se aplica a esa fecha, no a la del pedido), con el precio del pedido. Quedan fuera los pedidos anulados, las cargas históricas y los pedidos <b>a bodegas o en consignación</b> (no son ventas)' +
      (ex.unidades ? ': ' + dRentNum(ex.unidades) + ' unidades de ' + ex.pedidos + ' pedido(s) en este período' : '') + '.</p>' +
    '<p>• <b>Precio de venta:</b> valor unitario del pedido × cantidad de cada remisión. No cuentan las unidades bonificadas, ni las líneas con valor menor a $' + Rentabilidad.VALOR_MINIMO + ' (cero o simbólico) ni mayor a ' + Rentabilidad.FACTOR_ATIPICO + ' veces el Dealer de IASO (probable error de digitación)' +
      (sinPrecio ? ': ' + dRentNum(sinPrecio) + ' unidades en este período' : '') + '. El margen se calcula solo sobre las unidades con precio.</p>' +
    '<p>• <b>Costo automático:</b> precio <b>Mayorista</b> de la lista de la proveedora principal según las órdenes de compra aprobadas a IASO (las OC traen valor 0); si esa no lo tiene, el de otra proveedora de las OC o el de otra empresa (se marca en ámbar: conviene verificar el nombre del producto; con varias empresas se toma el mayor). <b>No se estima</b>: sin Mayorista ni costo manual el producto queda «Sin costo» y no entra al margen. ⚠ = el costo automático es mayor que el Dealer de IASO.</p>' +
    '<p>• <b>Costo manual:</b> escribe el costo unitario en la columna «Costo manual» y presiona Enter; reemplaza al automático en <b>todo</b> el período (no tiene fechas de vigencia). ↺ lo restablece al automático. Cada cambio queda en Auditoría con quién y cuándo. Solo el administrador ve esta pestaña.</p>' +
    (datos && !datos.costosOk ? '<p class="leg-aviso">⚠ No se pudieron leer los costos manuales (' + escHtml(datos.costosError) + '). ¿Se aplicó la migración create_costos_producto.sql? Mientras tanto no se pueden editar costos.</p>' : '');
}

// ── Búsqueda, filtro y orden ──
function dRentBuscar(q) { dRentVista.q = q; dRentPintarTabla(); }
function dRentFiltrar(f) { dRentVista.filtro = f; dRentPintarTabla(); }
function dRentOrdenarPor(k) {
  if (dRentVista.orden === k) dRentVista.dir = -dRentVista.dir;
  else { dRentVista.orden = k; dRentVista.dir = (k === 'producto') ? 1 : -1; }
  dRentPintarTabla();
}

// ── Edición del costo manual ──
function dRentFila(k) {
  if (!dRentUltimo) return null;
  var filas = dRentUltimo.res.filas;
  for (var i = 0; i < filas.length; i++) if (filas[i].clave === k) return filas[i];
  return null;
}

// Vuelve a calcular con los costos actuales y actualiza solo la fila editada y las tarjetas
// (así no se pierde el foco ni la posición mientras se digitan varios costos seguidos).
function dRentRecalcularFila(k) {
  var u = dRentUltimo;
  if (!u || !dRent) return;   // el Dashboard se recargó solo mientras se guardaba: lo guardado ya está en la base y se verá al repintar
  u.entrada.costos = dRent.costos;
  u.res = Rentabilidad.calcular(u.entrada);
  dRentPintarKpis();
  var fila = dRentFila(k);
  var tbody = document.querySelector('#rent-tabla tbody');
  if (tbody && fila) {
    for (var i = 0; i < tbody.rows.length; i++) {
      if (tbody.rows[i].getAttribute('data-k') === k) { tbody.rows[i].outerHTML = dRentFilaHtml(fila); break; }
    }
  }
  var c = document.getElementById('rent-cuenta');
  if (c && !dRentVista.q && dRentVista.filtro === 'todos') c.textContent = u.res.filas.length + ' productos';
}

function dRentActualizarCache(filaGuardada, idEliminado) {
  if (!dRent) return;
  var costos = dRent.costos.filter(function(c) {
    if (idEliminado != null) return c.id !== idEliminado;
    return c.id !== filaGuardada.id;
  });
  if (filaGuardada) costos.push(filaGuardada);
  dRent.costos = costos;
}

async function dRentCostoCambio(inp) {
  var k = inp.getAttribute('data-k');
  var f = dRentFila(k);
  if (!f || dRentGuardando[k]) return;
  var anterior = f.manual ? Number(f.manual.Costo_Unitario) : '';
  var txt = String(inp.value).trim();

  if (txt === '') {                         // borrar el campo = restablecer
    if (f.manual) return dRentRestablecer(k);
    return;
  }
  var n = Number(txt);
  if (!isFinite(n) || n <= 0) {
    showToast('El costo debe ser un número mayor que cero', '#e74c3c');
    inp.value = anterior;
    return;
  }
  if (f.manual && Math.abs(Number(f.manual.Costo_Unitario) - n) < 0.005) return;            // sin cambio
  if (!f.manual && f.auto && Math.abs(f.auto.precio - n) < 0.005) {                          // igual al automático
    showToast('Ese es el costo automático: no hace falta digitarlo', '#718096');
    inp.value = '';
    return;
  }
  dRentGuardando[k] = true;
  inp.disabled = true;
  try {
    var r = await apiPost({
      action: 'guardarCostoProducto', id: f.manual ? f.manual.id : null,
      Empresa: Rentabilidad.EMPRESA_IASO, Producto: f.producto, Costo_Unitario: n, Nota: f.manual ? (f.manual.Nota || '') : ''
    });
    if (!r.ok) throw new Error(r.error || 'No se pudo guardar el costo');
    dRentActualizarCache(r.costo);
    showToast('Costo de ' + f.producto + ' guardado: ' + dRentMoney(n), '#27ae60');
  } catch (e) {
    showToast('⚠️ ' + e.message, '#e74c3c');
    inp.value = anterior;
  } finally {
    delete dRentGuardando[k];
    inp.disabled = false;
  }
  dRentRecalcularFila(k);
}

async function dRentRestablecer(k) {
  var f = dRentFila(k);
  if (!f || !f.manual || dRentGuardando[k]) return;
  dRentGuardando[k] = true;
  try {
    var r = await apiPost({ action: 'eliminarCostoProducto', id: f.manual.id });
    if (!r.ok) throw new Error(r.error || 'No se pudo restablecer el costo');
    dRentActualizarCache(null, f.manual.id);
    showToast('Costo de ' + f.producto + ' restablecido al automático', '#27ae60');
  } catch (e) {
    showToast('⚠️ ' + e.message, '#e74c3c');
  } finally {
    delete dRentGuardando[k];
  }
  dRentRecalcularFila(k);
}

// ── Excel ──
function dRentExportar() {
  if (typeof XLSX === 'undefined') { showToast('La librería de Excel aún no carga; intenta de nuevo en unos segundos', '#e74c3c'); return; }
  if (!dRentUltimo || !dRentUltimo.res.filas.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }
  var u = dRentUltimo, t = u.res.totales;
  function r2(v) { return v == null ? '' : Math.round(v * 100) / 100; }
  var filas = u.res.filas.map(function(f) {
    return {
      'Producto': f.producto,
      'Unidades remisionadas': f.unidades, 'Unidades bonificadas': f.bonif, 'Unidades con precio': f.undPrecio,
      'Unidades sin precio válido': f.undSinPrecio, 'Pedidos': f.nPedidos, 'Remisiones': f.nRemisiones,
      'Precio venta promedio': r2(f.precioProm), 'Valor vendido': r2(f.valor),
      'Proveedora(s) según OC': f.proveedoras.map(function(p) { return p.sigla + ':' + p.unidades; }).join('; '),
      'Dealer IASO': f.dealer == null ? '' : f.dealer,
      'Costo automático': f.auto ? f.auto.precio : '', 'Origen costo automático': f.auto ? f.auto.texto : '',
      'Costo manual': f.manual ? Number(f.manual.Costo_Unitario) : '', 'Nota del costo manual': f.manual ? (f.manual.Nota || '') : '',
      'Costo usado': f.costo == null ? '' : f.costo, 'Fuente del costo': f.fuenteTxt,
      'Margen bruto $': r2(f.margen), 'Margen bruto %': f.margenPct == null ? '' : Math.round(f.margenPct * 10000) / 10000
    };
  });
  filas.push({
    'Producto': 'TOTAL (solo productos con costo en margen)',
    'Unidades remisionadas': t.unidades, 'Unidades bonificadas': t.bonif, 'Unidades con precio': t.undPrecio,
    'Unidades sin precio válido': t.undSinPrecio, 'Valor vendido': r2(t.valor),
    'Costo usado': '', 'Margen bruto $': r2(t.margen), 'Margen bruto %': t.margenPct == null ? '' : Math.round(t.margenPct * 10000) / 10000
  });
  var criterios = [
    ['Rentabilidad estimada · IASO'],
    ['Rango (fecha de la remisión)', u.rango],
    ['Generado', new Date().toLocaleString('es-CO')],
    [],
    ['Ventas remisionadas', r2(t.valor)], ['Costo de lo vendido (productos con costo)', r2(t.costoTotal)],
    ['Margen bruto (productos con costo)', r2(t.margen)], ['Margen bruto %', t.margenPct == null ? '' : Math.round(t.margenPct * 10000) / 10000],
    ['Cobertura (ventas con costo / ventas)', t.cobertura == null ? '' : Math.round(t.cobertura * 10000) / 10000],
    ['Productos sin costo', t.sinCosto], ['Ventas de productos sin costo', r2(t.valorSinCosto)], ['Costos manuales en el período', t.manuales],
    [],
    ['Lo remisionado por IASO en el rango, por fecha de cada remisión; sin pedidos anulados, cargas históricas ni pedidos a bodegas o en consignación (' + u.res.excluidos.unidades + ' unidades de ' + u.res.excluidos.pedidos + ' pedido(s) quedaron fuera por eso).'],
    ['Precio de venta: valor unitario del pedido × cantidad de cada remisión; sin bonificadas, valores menores a $' + Rentabilidad.VALOR_MINIMO + ' ni mayores a ' + Rentabilidad.FACTOR_ATIPICO + ' veces el Dealer de IASO.'],
    ['Costo automático: precio Mayorista de la proveedora principal según las OC aprobadas a IASO (o de otra proveedora / empresa). No se estima: sin Mayorista ni costo manual queda «Sin costo».'],
    ['Costo manual: lo digita el administrador; reemplaza al automático en todo el período.']
  ];
  var wsC = XLSX.utils.aoa_to_sheet(criterios);
  wsC['!cols'] = [{ wch: 130 }, { wch: 30 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Rentabilidad');
  XLSX.utils.book_append_sheet(wb, wsC, 'Criterios');
  XLSX.writeFile(wb, 'rentabilidad_IASO_' + today() + '.xlsx');
}
