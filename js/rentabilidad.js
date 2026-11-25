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
//  · Clasificación (2026-11-25): cada producto tiene una (Fungicida, Insecticida…; lista inicial de
//    categorias.xlsx) guardada en ClasificacionProducto, global y solo editable por el administrador.
//    Sin fila = «Otros» (que no se guarda). La tabla se ordena por clasificación (alfabético y «Otros»
//    al final; dentro de cada una, por valor vendido) y hay una tabla de rentabilidad POR clasificación.
//  · Bonificaciones (2026-11-25): sub-pestaña «🎁 Bonificaciones» con el COSTO de lo bonificado (unidades
//    bonificadas remisionadas × el costo usado del producto, el mismo de la tabla de rentabilidad), por
//    producto, cliente (agrupado por NIT), mes de la remisión y clasificación. Las unidades de un producto
//    sin costo se informan aparte (no entran al costo).
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
  var BONIF_DESDE = '2026-07-01';   // la sub-pestaña «Bonificaciones» mide SIEMPRE desde esta fecha de remisión (pedido del usuario, 2026-11-25)
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

  // ── Clasificación ──
  var OTROS = 'Otros';        // clasificación por defecto: no se guarda, es la ausencia de fila
  function limpiarClasif(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function esOtros(s) { return clave(s) === 'otros'; }
  // Alfabético sin importar mayúsculas ni tildes, y «Otros» siempre al final.
  function compararClasif(a, b) {
    var oa = esOtros(a), ob = esOtros(b);
    if (oa !== ob) return oa ? 1 : -1;
    return clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0;
  }
  // Clasificaciones que existen (las de la tabla), sin repetidos y sin «Otros», ordenadas.
  function catalogo(clasificaciones) {
    var vistos = {}, out = [];
    (clasificaciones || []).forEach(function(c) {
      var n = limpiarClasif(c && c.Clasificacion);
      var k = clave(n);
      if (!k || k === 'otros' || vistos[k]) return;
      vistos[k] = 1; out.push(n);
    });
    return out.sort(compararClasif);
  }
  // Si `nombre` ya existe en el catálogo (sin mayúsculas ni tildes) devuelve esa grafía; si no, el nombre limpio.
  function canonica(nombre, cat) {
    var n = limpiarClasif(nombre), k = clave(n);
    if (k === 'otros') return OTROS;
    for (var i = 0; i < (cat || []).length; i++) if (clave(cat[i]) === k) return cat[i];
    return n;
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

  // Entrada: { empresa, pedidos, excluidos, anuladas:{num:1}, ordenes, listaPrecios, costos, clasificaciones, desde, hasta }
  //   pedidos / excluidos: filas de Pedidos YA filtradas por quien llama (empresa, sin anulados ni
  //   históricos; `excluidos` = bodegas y consignación, solo para informar cuánto quedó fuera).
  //   costos: filas de CostosProducto (costo manual) de cualquier empresa; se usan las de `empresa`.
  //   clasificaciones: filas de ClasificacionProducto (una por producto, de todas las empresas).
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

    var clasifs = {};
    (e.clasificaciones || []).forEach(function(c) {
      var k = clave(c.Producto), n = limpiarClasif(c.Clasificacion);
      if (k && n && !esOtros(n)) clasifs[k] = { fila: c, nombre: n };
    });

    var bonifDet = [];   // una entrada por remisión bonificada (desde BONIF_DESDE): producto, cliente, NIT, mes, unidades
    var ventasBonif = 0; // ventas con precio válido desde BONIF_DESDE: denominador del % de las ventas de «Bonificaciones»
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
        // «Bonificaciones» solo mira remisiones con fecha y desde BONIF_DESDE (una remisión sin fecha no se puede ubicar)
        var desdeBonif = !!t.fecha && t.fecha >= BONIF_DESDE;
        if (bon) {
          f.bonif += t.cant;
          if (desdeBonif) bonifDet.push({ k: k, cliente: String(p.Cliente == null ? '' : p.Cliente).trim(), nit: p.NIT, mes: t.fecha.slice(0, 7),
            cant: t.cant, ped: p.Consecutivo + '#' + p.Cliente });
        }
        else if (vu >= VALOR_MINIMO && !(dealer > 0 && vu > FACTOR_ATIPICO * dealer)) {
          f.valor += t.cant * vu; f.undPrecio += t.cant;
          if (desdeBonif) ventasBonif += t.cant * vu;
        }
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
      f.clasif = clasifs[k] ? clasifs[k].fila : null;               // la fila guardada (null = «Otros» por defecto)
      f.clasificacion = clasifs[k] ? clasifs[k].nombre : OTROS;
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
    }).sort(function(a, b) {
      return compararClasif(a.clasificacion, b.clasificacion) || b.valor - a.valor || a.producto.localeCompare(b.producto);
    });

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

    var totalesGen = totalizar(lista);
    var bonif = resumirBonificaciones(bonifDet, lista, ventasBonif);
    bonif.desde = desde > BONIF_DESDE ? desde : BONIF_DESDE;   // si el «Desde» del Dashboard es posterior se respeta; uno anterior no abre el período
    bonif.hasta = hasta;
    return { filas: lista, totales: totalesGen, grupos: porClasificacion(lista),
      bonificaciones: bonif,
      excluidos: { unidades: excl.unidades, pedidos: Object.keys(excl.pedidos).length } };
  }

  // NIT sin puntos ni dígito de verificación («901.571.914-1» → «901571914»); '' si no parece un NIT.
  function nitBase(nit) {
    var s = String(nit == null ? '' : nit).trim();
    var m = /^([\d.,\s]+)-\s*\d$/.exec(s);
    if (m) s = m[1];
    s = s.replace(/\D/g, '');
    return s.length >= 5 ? s : '';
  }

  // COSTO de lo bonificado: unidades bonificadas remisionadas × el costo usado del producto (`f.costo`, el mismo de
  // la tabla de rentabilidad: manual si existe, si no el Mayorista de la proveedora). Un producto sin costo no entra
  // al costo: sus unidades se informan aparte (`undSinCosto`). Todo sale de las mismas entradas `det`, así que el
  // total por producto, por cliente, por mes y por clasificación coincide.
  // Clientes: se agrupan por NIT (sin dígito de verificación); una línea sin NIT usa el de otra línea con el mismo
  // nombre y, si no hay, el nombre normalizado. Se muestra el nombre con más unidades de cada grupo.
  function resumirBonificaciones(det, filas, valorVentas) {
    var porK = {};
    (filas || []).forEach(function(f) { porK[f.clave] = f; });
    var nombreANit = {};
    (det || []).forEach(function(d) { var n = nitBase(d.nit); if (n) nombreANit[clave(d.cliente)] = n; });

    function nuevo() { return { und: 0, costo: 0, undSinCosto: 0, clientes: {}, pedidos: {}, productos: {} }; }
    function sumar(g, d, costoUnit) {
      g.und += d.cant;
      if (costoUnit != null) g.costo += d.cant * costoUnit; else g.undSinCosto += d.cant;
      g.pedidos[d.ped] = 1;
    }
    var T = nuevo(), prod = {}, cli = {}, mes = {}, cla = {};
    (det || []).forEach(function(d) {
      var f = porK[d.k];
      if (!f) return;
      var cu = f.costo;                                   // null = sin costo
      var nitK = nitBase(d.nit) || nombreANit[clave(d.cliente)] || '';
      var ck = nitK ? 'n:' + nitK : 'c:' + clave(d.cliente);
      var pg = prod[d.k] || (prod[d.k] = nuevo());
      var cg = cli[ck] || (cli[ck] = Object.assign(nuevo(), { nit: nitK, nombres: {} }));
      var mg = mes[d.mes] || (mes[d.mes] = nuevo());
      var kg = cla[clave(f.clasificacion)] || (cla[clave(f.clasificacion)] = Object.assign(nuevo(), { nombre: f.clasificacion }));
      [T, pg, cg, mg, kg].forEach(function(g) { sumar(g, d, cu); });
      T.clientes[ck] = 1; T.productos[d.k] = 1;
      pg.clientes[ck] = 1;
      cg.productos[d.k] = 1; cg.nombres[d.cliente] = (cg.nombres[d.cliente] || 0) + d.cant;
      mg.clientes[ck] = 1; mg.productos[d.k] = 1;
      kg.clientes[ck] = 1; kg.productos[d.k] = 1;
    });

    function cuenta(o) { return Object.keys(o).length; }
    var totCosto = T.costo;
    function pct(c) { return totCosto > 0 ? c / totCosto : null; }
    function ordenCosto(a, b) { return (b.costo - a.costo) || (b.unidades - a.unidades) || String(a.nombre).localeCompare(String(b.nombre)); }

    var productos = Object.keys(prod).map(function(k) {
      var f = porK[k], g = prod[k];
      return { nombre: f.producto, clave: k, clasificacion: f.clasificacion, unidades: g.und, costoUnit: f.costo, fuente: f.fuente, fuenteTxt: f.fuenteTxt,
        costo: g.costo, sinCosto: f.costo == null, undSinCosto: g.undSinCosto, clientes: cuenta(g.clientes), pedidos: cuenta(g.pedidos), pct: pct(g.costo), fila: f };
    }).sort(ordenCosto);
    var clientes = Object.keys(cli).map(function(ck) {
      var g = cli[ck], mejor = '', mu = -1;
      Object.keys(g.nombres).forEach(function(n) { if (g.nombres[n] > mu || (g.nombres[n] === mu && n.length > mejor.length)) { mejor = n; mu = g.nombres[n]; } });
      return { nombre: mejor, clave: ck, nit: g.nit, variantes: Object.keys(g.nombres).sort(), unidades: g.und, costo: g.costo, undSinCosto: g.undSinCosto,
        productos: cuenta(g.productos), pedidos: cuenta(g.pedidos), pct: pct(g.costo) };
    }).sort(ordenCosto);
    var meses = Object.keys(mes).sort().map(function(m) {
      var g = mes[m];
      return { nombre: m, mes: m, unidades: g.und, costo: g.costo, undSinCosto: g.undSinCosto, clientes: cuenta(g.clientes), productos: cuenta(g.productos), pedidos: cuenta(g.pedidos), pct: pct(g.costo) };
    });
    var clasificaciones = Object.keys(cla).map(function(k) {
      var g = cla[k];
      return { nombre: g.nombre, clave: k, unidades: g.und, costo: g.costo, undSinCosto: g.undSinCosto, clientes: cuenta(g.clientes), productos: cuenta(g.productos), pedidos: cuenta(g.pedidos), pct: pct(g.costo) };
    }).sort(ordenCosto);

    return {
      total: { unidades: T.und, costo: T.costo, undSinCosto: T.undSinCosto, productos: cuenta(T.productos), clientes: cuenta(T.clientes), pedidos: cuenta(T.pedidos),
        productosSinCosto: productos.filter(function(p) { return p.sinCosto; }).length,
        pctVentas: valorVentas > 0 ? T.costo / valorVentas : null },
      productos: productos, clientes: clientes, meses: meses, clasificaciones: clasificaciones
    };
  }

  // Filas (ya calculadas) agrupadas por clasificación, en el orden de la tabla: alfabético y «Otros» al final.
  // Cada grupo trae sus totales con la MISMA cuenta que el total general (`totalizar`), así que la suma de
  // los grupos es el total.
  function porClasificacion(filas) {
    var mapa = {}, nombres = [];
    (filas || []).forEach(function(f) {
      var k = clave(f.clasificacion);
      if (!mapa[k]) { mapa[k] = { clasificacion: f.clasificacion, clave: k, filas: [] }; nombres.push(f.clasificacion); }
      mapa[k].filas.push(f);
    });
    return nombres.sort(compararClasif).map(function(n) {
      var g = mapa[clave(n)];
      g.totales = totalizar(g.filas);
      return g;
    });
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
    EMPRESA_IASO: EMPRESA_IASO, BONIF_DESDE: BONIF_DESDE, VALOR_MINIMO: VALOR_MINIMO, FACTOR_ATIPICO: FACTOR_ATIPICO,
    OTROS: OTROS, clave: clave, sigla: sigla, parseRemisiones: parseRemisiones, enRango: enRango,
    indexarLista: indexarLista, indexarProveedoras: indexarProveedoras, costoAutomatico: costoAutomatico,
    limpiarClasif: limpiarClasif, esOtros: esOtros, compararClasif: compararClasif, catalogo: catalogo, canonica: canonica,
    calcular: calcular, totalizar: totalizar, porClasificacion: porClasificacion,
    nitBase: nitBase, resumirBonificaciones: resumirBonificaciones
  };
})();

// Para pruebas en Node (no afecta al navegador).
if (typeof module !== 'undefined' && module.exports) module.exports = Rentabilidad;

// ══════════════════════════════════════════════════════════════
// Pantalla
// ══════════════════════════════════════════════════════════════
var DRENT_COLS_PEDIDOS = 'id,Nombre_Empresa,Cliente,NIT,Consecutivo,Producto,Valor_Unitario,Bonificado,Remisiones,Estado_2,Historico,Bodega_Consignacion_Id,Consignacion,Fecha_Pedido';
var DRENT_COLS_OC = 'Empresa_Destino,Empresa_Origen,Producto,Cantidad,Tipo,Estado,Estado_Aprobacion';
var DRENT_COLS_COSTOS = 'id,Empresa,Producto,Producto_Clave,Costo_Unitario,Nota,creado_por_nombre,creado_en,modificado_por_nombre,modificado_en';

var DRENT_COLS_CLASIF = 'id,Producto,Producto_Clave,Clasificacion,creado_por_nombre,creado_en,modificado_por_nombre,modificado_en';

var dRent = null;            // { pedidos, excluidos, anuladas, ordenes, lista, costos, costosOk, costosError, clasificaciones, clasifOk, clasifError } | null (sin cargar)
var dRentPromesa = null;     // carga en curso
var dRentGen = 0;            // sube al invalidar: una carga vieja no pisa la caché
var dRentBuildTok = 0;       // el último repintado gana
var dRentUltimo = null;      // { res, entrada, rango, desde, hasta } — lo último mostrado (lo que exporta el botón)
var dRentVista = { q: '', filtro: 'todos', margen: 'todos', clasif: '', orden: 'clasificacion', dir: 1 };   // clasif = clave de la clasificación filtrada ('' = todas); margen = 'todos' | 'negativo'
var dRentGuardando = {};     // clave (o 'c:' + clave para la clasificación) → true mientras se guarda (evita dobles envíos)
var dRentCat = [];           // clasificaciones que existen (las de la tabla, sin «Otros»), para las listas desplegables
var dRentSub = 'rent';       // sub-pestaña visible: 'rent' (Rentabilidad) | 'bonif' (Bonificaciones)

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
    apiGet('getCostosProducto', { columns: DRENT_COLS_COSTOS }).catch(function(e) { return { ok: false, error: e.message }; }),
    apiGet('getClasificacionesProducto', { columns: DRENT_COLS_CLASIF }).catch(function(e) { return { ok: false, error: e.message }; })
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
      costos: r[4].ok ? (r[4].costos || []) : [], costosOk: !!r[4].ok, costosError: r[4].ok ? '' : (r[4].error || 'No se pudieron leer los costos manuales'),
      clasificaciones: r[5].ok ? (r[5].clasificaciones || []) : [], clasifOk: !!r[5].ok, clasifError: r[5].ok ? '' : (r[5].error || 'No se pudieron leer las clasificaciones')
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
    ordenes: datos.ordenes, listaPrecios: datos.lista, costos: datos.costos, clasificaciones: datos.clasificaciones,
    desde: desde, hasta: hasta
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
  dRentSubTab(dRentSub);

  var entrada = dRentEntrada(datos, fDesde, fHasta);
  var res = Rentabilidad.calcular(entrada);
  dRentUltimo = { res: res, entrada: entrada, rango: rango, desde: fDesde, hasta: fHasta };
  dRentPintar();
}

function dRentPintar() {
  if (!dRentUltimo) return;
  dRentCat = Rentabilidad.catalogo(dRent ? dRent.clasificaciones : []);
  // El filtro por clasificación se suelta si ya no hay productos de esa clasificación en este período.
  if (dRentVista.clasif && !dRentUltimo.res.grupos.some(function(g) { return g.clave === dRentVista.clasif; })) dRentVista.clasif = '';
  dRentPintarKpis();
  dRentPintarClasif();
  dRentPintarControles();
  dRentPintarTabla();
  dRentPintarNota();
  dRentPintarBonif();
}

// ── Sub-pestañas: «Rentabilidad» | «Bonificaciones» ──
function dRentSubTab(v) {
  dRentSub = v === 'bonif' ? 'bonif' : 'rent';
  var a = document.getElementById('rent-vista-rent'), b = document.getElementById('rent-vista-bonif');
  if (a) a.style.display = dRentSub === 'rent' ? '' : 'none';
  if (b) b.style.display = dRentSub === 'bonif' ? '' : 'none';
  ['rent', 'bonif'].forEach(function(s) {
    var x = document.getElementById('rent-sub-' + s);
    if (x) x.classList.toggle('activa', dRentSub === s);
  });
}

// ── Bonificaciones: costo de lo bonificado ──
var DRENT_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dRentMesTxt(m) {
  var p = String(m).split('-'), i = Number(p[1]) - 1;
  return (DRENT_MESES[i] || p[1]) + ' ' + p[0];
}
function dRentAvisoSinCosto(r) {
  return r.undSinCosto > 0
    ? ' <span class="rent-tag rent-tag-sin" title="' + dRentNum(r.undSinCosto) + ' unidad(es) de productos sin costo: no están incluidas en este costo">+' + dRentNum(r.undSinCosto) + ' ud sin costo</span>'
    : '';
}
// cols: [{ t, cls, f(fila) → html }]; pie: fila de totales (misma forma) o null
function dRentTablaBon(cols, filas, pie) {
  var thead = '<thead><tr>' + cols.map(function(c) { return '<th class="' + c.cls + '">' + c.t + '</th>'; }).join('') + '</tr></thead>';
  var cuerpo = filas.map(function(r) {
    return '<tr>' + cols.map(function(c) { return '<td class="' + c.cls + '"' + (c.tip ? ' title="' + escHtml(c.tip(r)) + '"' : '') + '>' + c.f(r) + '</td>'; }).join('') + '</tr>';
  }).join('');
  var pieH = pie ? '<tr class="rent-total">' + cols.map(function(c) { return '<td class="' + c.cls + '">' + (c.p ? c.p(pie) : '') + '</td>'; }).join('') + '</tr>' : '';
  return '<table class="mini-table rent-table rent-bonif">' + thead + '<tbody>' + cuerpo + pieH + '</tbody></table>';
}

function dRentPintarBonif() {
  var kp = document.getElementById('bon-kpis');
  if (!kp || !dRentUltimo) return;
  var B = dRentUltimo.res.bonificaciones, t = B.total;
  var sinC = t.undSinCosto > 0;
  // Siempre desde el 01/07/2026 (o desde el «Desde» del Dashboard si es posterior), por fecha de remisión y sin cargas históricas
  var chip = document.getElementById('bon-chip');
  if (chip) chip.innerHTML = '<span class="dash-range-chip">📅 Desde el ' + escHtml(fmtDate(B.desde)) + (B.hasta ? ' hasta el ' + escHtml(fmtDate(B.hasta)) : ' en adelante') +
    ' · por fecha de remisión · <span class="emp">sin carga histórica</span></span>';
  kp.innerHTML =
    kpiCard('orange', dMoneyM(t.costo), 'Costo de lo bonificado', dMoneyFull(Math.round(t.costo)) + (t.pctVentas != null ? ' · equivale al ' + dRentPct(t.pctVentas) + ' de las ventas remisionadas en el mismo período' : '')) +
    kpiCard('', dRentNum(t.unidades), 'Unidades bonificadas', t.productos + ' producto(s) · remisionadas en el período') +
    kpiCard('purple', String(t.clientes), 'Clientes bonificados', t.pedidos + ' pedido(s)') +
    kpiCard(sinC ? 'red' : 'green', dRentNum(t.undSinCosto), 'Unidades sin costo', sinC ? t.productosSinCosto + ' producto(s) sin costo: digítalo en «Rentabilidad»; no entran al costo' : 'todo lo bonificado tiene costo');

  var vacio = '<div style="color:#a0aec0;text-align:center;padding:30px 20px">Sin productos bonificados remisionados en el período</div>';
  var ids = ['bon-prod', 'bon-clasif', 'bon-cli', 'bon-mes'];
  if (!t.unidades) {
    ids.forEach(function(id) { var e = document.getElementById(id); if (e) e.innerHTML = vacio; });
    ['bon-prod-sub', 'bon-clasif-sub', 'bon-cli-sub', 'bon-mes-sub'].forEach(function(id) { var e = document.getElementById(id); if (e) e.textContent = ''; });
  } else {
    var money = function(v) { return dRentMoney(Math.round(v)); };
    var pctC = { t: '% del costo', cls: 'num', f: function(r) { return r.pct == null ? '—' : dRentPct(r.pct); }, p: function() { return '100,0 %'; } };
    var costoC = function(titulo) {
      return { t: titulo, cls: 'num', f: function(r) { return (r.sinCosto ? '—' : '<b>' + money(r.costo) + '</b>') + dRentAvisoSinCosto(r); }, p: function(x) { return money(x.costo) + dRentAvisoSinCosto(x); } };
    };
    var undC = { t: 'Unidades', cls: 'num', f: function(r) { return dRentNum(r.unidades); }, p: function(x) { return dRentNum(x.unidades); } };
    var cnt = function(titulo, k) { return { t: titulo, cls: 'num', f: function(r) { return dRentNum(r[k]); }, p: function(x) { return dRentNum(x[k]); } }; };
    var sub = function(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; };

    sub('bon-prod-sub', B.productos.length + ' producto(s) · ordenados por costo');
    document.getElementById('bon-prod').innerHTML = dRentTablaBon([
      { t: 'Producto', cls: '', f: function(r) { return '<span style="font-weight:600">' + escHtml(r.nombre) + '</span>'; }, tip: function(r) { return r.nombre; }, p: function() { return 'TOTAL'; } },
      { t: 'Clasificación', cls: '', f: function(r) { return escHtml(r.clasificacion); } },
      { t: 'Unidades bonificadas', cls: 'num', f: function(r) { return dRentNum(r.unidades); }, p: function(x) { return dRentNum(x.unidades); } },
      { t: 'Costo unitario', cls: 'num', f: function(r) { return r.costoUnit != null ? dRentMoney(r.costoUnit) : '—'; } },
      { t: 'Fuente del costo', cls: 'num', f: function(r) { return '<div class="rent-fuente">' + dRentTagFuente(r.fila) + '</div>'; } },
      costoC('Costo total'), pctC, cnt('Clientes', 'clientes'), cnt('Pedidos', 'pedidos')
    ], B.productos, { unidades: t.unidades, costo: t.costo, undSinCosto: t.undSinCosto, clientes: t.clientes, pedidos: t.pedidos });

    sub('bon-clasif-sub', B.clasificaciones.length + ' clasificación(es)');
    document.getElementById('bon-clasif').innerHTML = dRentTablaBon([
      { t: 'Clasificación', cls: '', f: function(r) { return '<span style="font-weight:600' + (Rentabilidad.esOtros(r.nombre) ? ';color:#718096' : '') + '">' + escHtml(r.nombre) + '</span>'; }, p: function() { return 'TOTAL'; } },
      cnt('Productos', 'productos'), undC, costoC('Costo'), pctC, cnt('Clientes', 'clientes'), cnt('Pedidos', 'pedidos')
    ], B.clasificaciones, { productos: t.productos, unidades: t.unidades, costo: t.costo, undSinCosto: t.undSinCosto, clientes: t.clientes, pedidos: t.pedidos });

    sub('bon-cli-sub', B.clientes.length + ' cliente(s) · agrupados por NIT · ordenados por costo');
    document.getElementById('bon-cli').innerHTML = dRentTablaBon([
      { t: 'Cliente', cls: '', f: function(r) { return '<span style="font-weight:600">' + escHtml(r.nombre) + '</span>' + (r.variantes.length > 1 ? ' <span class="rent-sub" title="' + escHtml('Nombres con el mismo NIT: ' + r.variantes.join(' · ')) + '">+' + (r.variantes.length - 1) + ' nombre(s)</span>' : ''); },
        tip: function(r) { return r.variantes.join(' · '); }, p: function() { return 'TOTAL'; } },
      { t: 'NIT', cls: '', f: function(r) { return r.nit ? escHtml(r.nit) : '<span style="color:#a0aec0" title="Ninguna línea de este cliente trae NIT">sin NIT</span>'; } },
      undC, costoC('Costo'), pctC, cnt('Productos', 'productos'), cnt('Pedidos', 'pedidos')
    ], B.clientes, { unidades: t.unidades, costo: t.costo, undSinCosto: t.undSinCosto, productos: t.productos, pedidos: t.pedidos });

    sub('bon-mes-sub', 'por fecha de la remisión');
    document.getElementById('bon-mes').innerHTML = dRentTablaBon([
      { t: 'Mes', cls: '', f: function(r) { return '<span style="font-weight:600">' + escHtml(dRentMesTxt(r.mes)) + '</span>'; }, p: function() { return 'TOTAL'; } },
      undC, costoC('Costo'), pctC, cnt('Clientes', 'clientes'), cnt('Productos', 'productos'), cnt('Pedidos', 'pedidos')
    ], B.meses, { unidades: t.unidades, costo: t.costo, undSinCosto: t.undSinCosto, clientes: t.clientes, productos: t.productos, pedidos: t.pedidos });
  }

  var nota = document.getElementById('bon-nota');
  if (nota) nota.innerHTML =
    '<p>• <b>Qué se mide:</b> el <b>costo</b> de las unidades <b>bonificadas y remisionadas</b> por IASO: unidades × costo unitario del producto. Es el mismo costo de la sub-pestaña «Rentabilidad» (el manual si lo digitaste; si no, el Mayorista de la proveedora), así que si cambias un costo allá este resumen se actualiza. Las unidades de un producto <b>sin costo</b> no entran al costo: se informan aparte (+ud sin costo).</p>' +
    '<p>• <b>Período:</b> todos los indicadores de esta sub-pestaña se miden <b>desde el 01/07/2026</b>, por la <b>fecha de cada remisión</b> (un pedido anterior a esa fecha pero remisionado después sí cuenta; una remisión sin fecha no). Si el «Desde» de arriba es posterior a esa fecha se usa el de arriba; uno anterior no la adelanta. El «Hasta» sí se aplica. El mes de cada fila es el de la remisión. Quedan fuera los pedidos anulados, las <b>cargas históricas</b> (pedidos marcados como «Carga histórica») y los pedidos a bodegas o en consignación. Las bonificaciones no suman a las ventas ni al margen de la sub-pestaña «Rentabilidad» (su precio simbólico no cuenta como venta), y esa sub-pestaña sigue usando el rango de arriba sin el piso del 01/07.</p>' +
    '<p>• <b>Clientes:</b> se agrupan por NIT (sin dígito de verificación) para unir las distintas formas de escribir el nombre; una línea sin NIT se une a otra del mismo nombre que sí lo tenga y, si no hay, queda por su nombre. El % del costo es sobre el costo total bonificado del período.</p>';
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

// Rentabilidad POR clasificación: una fila por clasificación (alfabético, «Otros» al final) con la misma cuenta
// que el total general (`totalizar`); al hacer clic en una fila la tabla de productos se filtra a ella.
function dRentPintarClasif() {
  var cont = document.getElementById('rent-clasif');
  if (!cont || !dRentUltimo) return;
  var res = dRentUltimo.res, t = res.totales, grupos = res.grupos;
  var sub = document.getElementById('rent-clasif-sub');
  if (sub) sub.textContent = grupos.length ? grupos.length + ' clasificación(es) · clic en una fila para ver sus productos' : '';
  if (!grupos.length) {
    cont.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:30px 20px">Sin remisiones de IASO en el período</div>';
    return;
  }
  var thead = '<thead><tr><th>Clasificación</th><th class="num">Productos</th><th class="num">Unidades</th><th class="num">Ventas</th>' +
    '<th class="num" title="Participación en las ventas del período">% ventas</th><th class="num">Costo de lo vendido</th>' +
    '<th class="num">Margen $</th><th class="num">Margen %</th><th class="num" title="Productos vendidos sin costo: no entran al margen">Sin costo</th></tr></thead>';
  function celdas(tt, valorTotal) {
    var neg = tt.margenPct != null && tt.margen < 0;
    return '<td class="num">' + dRentNum(tt.productos) + '</td>' +
      '<td class="num">' + dRentNum(tt.unidades) + '</td>' +
      '<td class="num">' + dRentMoney(Math.round(tt.valor)) + '</td>' +
      '<td class="num">' + (valorTotal > 0 ? dRentPct(tt.valor / valorTotal) : '—') + '</td>' +
      '<td class="num">' + (tt.conCosto ? dRentMoney(Math.round(tt.costoTotal)) : '—') + '</td>' +
      '<td class="num' + (neg ? ' rent-neg' : '') + '">' + (tt.margenPct != null ? dRentMoney(Math.round(tt.margen)) : '—') + '</td>' +
      '<td class="num' + (neg ? ' rent-neg' : '') + '">' + dRentPct(tt.margenPct) + '</td>' +
      '<td class="num"' + (tt.sinCosto ? ' title="' + escHtml(dRentMoney(Math.round(tt.valorSinCosto))) + ' en ventas sin costo"' : '') + '>' +
        (tt.sinCosto ? '<span class="rent-tag rent-tag-sin">' + tt.sinCosto + ' prod.</span>' : '<span style="color:#a0aec0">—</span>') + '</td>';
  }
  var filas = grupos.map(function(g) {
    var activa = dRentVista.clasif === g.clave;
    var otros = Rentabilidad.esOtros(g.clasificacion);
    return '<tr class="rent-grupo-fila' + (activa ? ' activa' : '') + '" data-c="' + escHtml(g.clave) + '" onclick="dRentClickGrupo(this.getAttribute(\'data-c\'))" ' +
      'title="' + (activa ? 'Quitar el filtro' : 'Ver solo los productos de esta clasificación') + '">' +
      '<td style="font-weight:700' + (otros ? ';color:#718096' : '') + '">' + escHtml(g.clasificacion) + (activa ? ' <span class="rent-tag rent-tag-manual">filtrando</span>' : '') + '</td>' +
      celdas(g.totales, t.valor) + '</tr>';
  }).join('');
  var pie = '<tr class="rent-total"><td>TOTAL</td>' + celdas(t, t.valor) + '</tr>';
  cont.innerHTML = '<table class="mini-table rent-table rent-grupos">' + thead + '<tbody>' + filas + pie + '</tbody></table>';
}

function dRentPintarControles() {
  var el = document.getElementById('rent-controles');
  if (!el) return;
  var v = dRentVista;
  el.innerHTML =
    '<input type="search" id="rent-q" placeholder="Buscar producto…" value="' + escHtml(v.q) + '" oninput="dRentBuscar(this.value)" style="width:230px">' +
    '<select id="rent-clasif-filtro" onchange="dRentFiltrarClasif(this.value)" title="Filtrar por clasificación">' +
      '<option value="">Todas las clasificaciones</option>' +
      dRentUltimo.res.grupos.map(function(g) {
        return '<option value="' + escHtml(g.clave) + '"' + (v.clasif === g.clave ? ' selected' : '') + '>' + escHtml(g.clasificacion) + ' (' + g.filas.length + ')</option>';
      }).join('') +
    '</select>' +
    '<select id="rent-filtro" onchange="dRentFiltrar(this.value)">' +
      [['todos', 'Todos los productos'], ['sin', 'Solo sin costo'], ['manual', 'Solo con costo manual'], ['automatico', 'Solo con costo automático']]
        .map(function(o) { return '<option value="' + o[0] + '"' + (v.filtro === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
    '</select>' +
    '<select id="rent-margen" onchange="dRentFiltrarMargen(this.value)" title="Margen bruto: el costo supera al precio promedio de venta">' +
      '<option value="todos"' + (v.margen === 'todos' ? ' selected' : '') + '>Todos los márgenes</option>' +
      '<option value="negativo"' + (v.margen === 'negativo' ? ' selected' : '') + '>' + dRentTextoNegativos() + '</option>' +
    '</select>' +
    '<span id="rent-cuenta" class="sub"></span>';
}

// Margen negativo = el costo usado supera al precio promedio de venta (mismo criterio que pinta la fila en rojo).
// Un producto sin costo no tiene margen y no entra.
function dRentEsMargenNegativo(f) { return f.margen != null && f.margen < 0; }
function dRentTextoNegativos() {
  var n = dRentUltimo ? dRentUltimo.res.filas.filter(dRentEsMargenNegativo).length : 0;
  return 'Solo margen negativo (' + n + ')';
}

function dRentFilasVisibles() {
  var v = dRentVista, q = Rentabilidad.clave(v.q);
  return dRentUltimo.res.filas.filter(function(f) {
    if (q && f.clave.indexOf(q) < 0) return false;
    if (v.clasif && Rentabilidad.clave(f.clasificacion) !== v.clasif) return false;
    if (v.margen === 'negativo' && !dRentEsMargenNegativo(f)) return false;
    if (v.filtro === 'sin') return f.fuente === 'sin';
    if (v.filtro === 'manual') return f.fuente === 'manual';
    if (v.filtro === 'automatico') return f.fuente === 'automatico';
    return true;
  });
}

// Orden estable y simple: dir = 1 ascendente, -1 descendente.
function dRentOrdenar(filas) {
  var k = dRentVista.orden, dir = dRentVista.dir;
  var rangos = {};   // clasificación → posición (alfabético, «Otros» al final); los empates quedan por valor vendido
  dRentUltimo.res.grupos.forEach(function(g, i) { rangos[g.clave] = i; });
  function val(f) {
    if (k === 'clasificacion') return rangos[Rentabilidad.clave(f.clasificacion)];
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
  { k: 'clasificacion', t: 'Clasificación', cls: '' },
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
    (visibles.length ? visibles.map(dRentFilaHtml).join('') : '<tr><td colspan="' + DRENT_COLUMNAS.length + '" style="text-align:center;color:#a0aec0;padding:24px">Ningún producto coincide con los filtros</td></tr>') +
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

// Lista desplegable de clasificación de un producto: «Otros» (quita la clasificación), las que existen y
// «Nueva clasificación…». Sin clasificación guardada se resalta en ámbar (hay algo por clasificar).
function dRentClasifSelectHtml(f) {
  var editable = dRentUltimo && dRent && dRent.clasifOk;
  var actual = f.clasificacion, kActual = Rentabilidad.clave(actual), hay = false;
  var ops = '<option value=""' + (f.clasif ? '' : ' selected') + '>' + Rentabilidad.OTROS + '</option>';
  dRentCat.forEach(function(n) {
    var sel = !!f.clasif && Rentabilidad.clave(n) === kActual;
    if (sel) hay = true;
    ops += '<option value="' + escHtml(n) + '"' + (sel ? ' selected' : '') + '>' + escHtml(n) + '</option>';
  });
  if (f.clasif && !hay) ops += '<option value="' + escHtml(actual) + '" selected>' + escHtml(actual) + '</option>';   // por si el catálogo no la trae
  ops += '<option value="__nueva__">➕ Nueva clasificación…</option>';
  return '<select class="rent-clasif' + (f.clasif ? '' : ' sin') + '" data-k="' + escHtml(f.clave) + '" onchange="dRentClasifCambio(this)" ' +
    (editable ? '' : 'disabled title="La tabla de clasificaciones no está disponible (¿se aplicó la migración create_clasificacion_producto.sql?)"') +
    (editable && !f.clasif ? ' title="Sin clasificación: queda en «Otros». Elige una para clasificarlo"' : '') + '>' + ops + '</select>';
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
    '<td>' + dRentClasifSelectHtml(f) + '</td>' +
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
    '<p>• <b>Margen negativo:</b> el desplegable «Solo margen negativo» deja en la tabla los productos cuyo <b>costo usado supera al precio promedio de venta</b> (filas en rojo); el número entre paréntesis es cuántos hay en el período. Se combina con la búsqueda, la clasificación y el filtro de costo. Un producto «Sin costo» no tiene margen y no aparece ahí; al corregir un costo la fila editada se queda hasta que cambies de filtro.</p>' +
    '<p>• <b>Clasificación:</b> la lista inicial viene de <i>categorias.xlsx</i>; los productos que no figuran allí (o venían sin clasificación) están en <b>«Otros»</b>, resaltado en ámbar. Cámbiala en la columna «Clasificación» (o elige «➕ Nueva clasificación…»); «Otros» la quita. Aplica a todas las empresas, no tiene fechas y cada cambio queda en Auditoría. La tabla se ordena por clasificación (alfabético, «Otros» al final) y «Rentabilidad por clasificación» suma lo mismo que los totales de arriba: el margen % es sobre las ventas de los productos con costo.</p>' +
    (datos && !datos.costosOk ? '<p class="leg-aviso">⚠ No se pudieron leer los costos manuales (' + escHtml(datos.costosError) + '). ¿Se aplicó la migración create_costos_producto.sql? Mientras tanto no se pueden editar costos.</p>' : '') +
    (datos && !datos.clasifOk ? '<p class="leg-aviso">⚠ No se pudieron leer las clasificaciones (' + escHtml(datos.clasifError) + '). ¿Se aplicó la migración create_clasificacion_producto.sql? Mientras tanto todos los productos aparecen como «Otros» y no se pueden editar.</p>' : '');
}

// ── Búsqueda, filtro y orden ──
function dRentBuscar(q) { dRentVista.q = q; dRentPintarTabla(); }
function dRentFiltrar(f) { dRentVista.filtro = f; dRentPintarTabla(); }
function dRentFiltrarMargen(m) { dRentVista.margen = m === 'negativo' ? 'negativo' : 'todos'; dRentPintarTabla(); }
function dRentFiltrarClasif(c) { dRentVista.clasif = c || ''; dRentPintarClasif(); dRentPintarTabla(); }
// Clic en una fila de «Rentabilidad por clasificación»: filtra la tabla de productos (otro clic lo quita).
function dRentClickGrupo(c) {
  dRentVista.clasif = dRentVista.clasif === c ? '' : c;
  dRentPintarControles(); dRentPintarClasif(); dRentPintarTabla();
}
function dRentOrdenarPor(k) {
  if (dRentVista.orden === k) dRentVista.dir = -dRentVista.dir;
  else { dRentVista.orden = k; dRentVista.dir = (k === 'producto' || k === 'clasificacion') ? 1 : -1; }
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
  u.entrada.clasificaciones = dRent.clasificaciones;
  u.res = Rentabilidad.calcular(u.entrada);
  dRentPintarKpis();
  dRentPintarClasif();   // el costo cambia el margen de la clasificación del producto
  dRentPintarBonif();    // y el costo de lo bonificado
  var fila = dRentFila(k);
  var tbody = document.querySelector('#rent-tabla tbody');
  if (tbody && fila) {
    for (var i = 0; i < tbody.rows.length; i++) {
      if (tbody.rows[i].getAttribute('data-k') === k) { tbody.rows[i].outerHTML = dRentFilaHtml(fila); break; }
    }
  }
  var c = document.getElementById('rent-cuenta');
  var v = dRentVista;
  if (c && !v.q && v.filtro === 'todos' && v.margen === 'todos' && !v.clasif) c.textContent = u.res.filas.length + ' productos';   // con algún filtro activo el conteo no se toca (la fila editada se queda hasta repintar)
  var optNeg = document.querySelector('#rent-margen option[value="negativo"]');
  if (optNeg) optNeg.textContent = dRentTextoNegativos();   // el costo cambia cuántos productos quedan con margen negativo
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

// ── Edición de la clasificación ──
function dRentActualizarCacheClasif(filaGuardada, idEliminado) {
  if (!dRent) return;
  dRent.clasificaciones = dRent.clasificaciones.filter(function(c) {
    return idEliminado != null ? c.id !== idEliminado : c.id !== filaGuardada.id;
  });
  if (filaGuardada) dRent.clasificaciones.push(filaGuardada);
}

// Vuelve a calcular con las clasificaciones actuales y repinta lo que depende de ellas: la fila cambia de grupo
// (la tabla va ordenada por clasificación), la tabla por clasificación y la lista del filtro. Conserva el scroll.
function dRentClasifRepintar() {
  var u = dRentUltimo;
  if (!u || !dRent) return;   // el Dashboard se recargó solo mientras se guardaba: lo guardado ya está en la base
  u.entrada.clasificaciones = dRent.clasificaciones;
  u.res = Rentabilidad.calcular(u.entrada);
  dRentCat = Rentabilidad.catalogo(dRent.clasificaciones);
  if (dRentVista.clasif && !u.res.grupos.some(function(g) { return g.clave === dRentVista.clasif; })) dRentVista.clasif = '';
  var cont = document.getElementById('rent-tabla');
  var top = cont ? cont.scrollTop : 0;
  dRentPintarClasif();
  dRentPintarControles();
  dRentPintarTabla();
  dRentPintarBonif();    // el resumen de bonificaciones también se agrupa por clasificación
  if (cont) cont.scrollTop = top;
}

async function dRentClasifCambio(sel) {
  var k = sel.getAttribute('data-k');
  var f = dRentFila(k);
  if (!f || dRentGuardando['c:' + k]) return;
  var anterior = f.clasif ? f.clasificacion : '';          // valor del <option> de lo que había ('' = «Otros»)
  var v = sel.value, nuevo;

  if (v === '__nueva__') {
    var txt = window.prompt('Nombre de la nueva clasificación para\n' + f.producto + ':', '');
    if (txt == null || !String(txt).trim()) { sel.value = anterior; return; }
    nuevo = Rentabilidad.canonica(txt, dRentCat);           // si ya existe (sin mayúsculas ni tildes) se usa su grafía
    if (nuevo.length < 2 || nuevo.length > 60) {
      showToast('La clasificación debe tener entre 2 y 60 caracteres', '#e74c3c');
      sel.value = anterior;
      return;
    }
  } else {
    nuevo = v === '' ? Rentabilidad.OTROS : v;
  }
  if (Rentabilidad.clave(nuevo) === Rentabilidad.clave(f.clasificacion)) { sel.value = anterior; return; }   // sin cambio

  dRentGuardando['c:' + k] = true;
  sel.disabled = true;
  try {
    if (Rentabilidad.esOtros(nuevo)) {                      // «Otros» no se guarda: se quita la fila
      var rd = await apiPost({ action: 'eliminarClasificacionProducto', id: f.clasif.id });
      if (!rd.ok) throw new Error(rd.error || 'No se pudo quitar la clasificación');
      dRentActualizarCacheClasif(null, f.clasif.id);
      showToast(f.producto + ': vuelve a «Otros»', '#27ae60');
    } else {
      var rg = await apiPost({
        action: 'guardarClasificacionProducto', id: f.clasif ? f.clasif.id : null, Producto: f.producto, Clasificacion: nuevo
      });
      if (!rg.ok) throw new Error(rg.error || 'No se pudo guardar la clasificación');
      dRentActualizarCacheClasif(rg.clasificacion);
      showToast(f.producto + ': ' + rg.clasificacion.Clasificacion, '#27ae60');
    }
  } catch (e) {
    showToast('⚠️ ' + e.message, '#e74c3c');
    sel.value = anterior;
  } finally {
    delete dRentGuardando['c:' + k];
    sel.disabled = false;
  }
  dRentClasifRepintar();
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
      'Clasificación': f.clasificacion,
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
  criterios.push(['Clasificación: la lista inicial viene de categorias.xlsx; sin clasificación = «Otros». Las filas van ordenadas por clasificación (alfabético, «Otros» al final) y, dentro de cada una, por valor vendido. La hoja «Por clasificación» suma lo mismo que los totales: el margen % es sobre las ventas de los productos con costo.']);

  // Rentabilidad por clasificación (misma cuenta que los totales)
  function filaGrupo(nombre, tt) {
    return {
      'Clasificación': nombre, 'Productos': tt.productos, 'Unidades remisionadas': tt.unidades, 'Unidades con precio': tt.undPrecio,
      'Valor vendido': r2(tt.valor), '% de las ventas': t.valor > 0 ? Math.round(tt.valor / t.valor * 10000) / 10000 : '',
      'Costo de lo vendido (productos con costo)': tt.conCosto ? r2(tt.costoTotal) : '',
      'Margen bruto $': tt.margenPct == null ? '' : r2(tt.margen), 'Margen bruto %': tt.margenPct == null ? '' : Math.round(tt.margenPct * 10000) / 10000,
      'Productos sin costo': tt.sinCosto, 'Ventas de productos sin costo': r2(tt.valorSinCosto)
    };
  }
  var porClasif = u.res.grupos.map(function(g) { return filaGrupo(g.clasificacion, g.totales); });
  porClasif.push(filaGrupo('TOTAL', t));

  // Costo de lo bonificado (sub-pestaña «Bonificaciones»): una hoja por vista, con su TOTAL
  var B = u.res.bonificaciones, bt = B.total;
  function pctB(v) { return v == null ? '' : Math.round(v * 10000) / 10000; }
  function costoB(r) { return r.sinCosto ? '' : r2(r.costo); }
  var hojasBon = [];
  if (bt.unidades) {
    var bProd = B.productos.map(function(r) {
      return { 'Producto': r.nombre, 'Clasificación': r.clasificacion, 'Unidades bonificadas': r.unidades, 'Costo unitario': r.costoUnit == null ? '' : r.costoUnit,
        'Fuente del costo': r.fuenteTxt, 'Costo total': costoB(r), '% del costo': pctB(r.pct), 'Clientes': r.clientes, 'Pedidos': r.pedidos, 'Unidades sin costo': r.undSinCosto };
    });
    bProd.push({ 'Producto': 'TOTAL', 'Unidades bonificadas': bt.unidades, 'Costo total': r2(bt.costo), '% del costo': 1, 'Clientes': bt.clientes, 'Pedidos': bt.pedidos, 'Unidades sin costo': bt.undSinCosto });
    var bCli = B.clientes.map(function(r) {
      return { 'Cliente': r.nombre, 'NIT': r.nit, 'Nombres con ese NIT': r.variantes.join('; '), 'Unidades bonificadas': r.unidades, 'Costo': r2(r.costo), '% del costo': pctB(r.pct),
        'Productos': r.productos, 'Pedidos': r.pedidos, 'Unidades sin costo': r.undSinCosto };
    });
    bCli.push({ 'Cliente': 'TOTAL', 'Unidades bonificadas': bt.unidades, 'Costo': r2(bt.costo), '% del costo': 1, 'Productos': bt.productos, 'Pedidos': bt.pedidos, 'Unidades sin costo': bt.undSinCosto });
    var bMes = B.meses.map(function(r) {
      return { 'Mes (fecha de la remisión)': r.mes, 'Unidades bonificadas': r.unidades, 'Costo': r2(r.costo), '% del costo': pctB(r.pct),
        'Clientes': r.clientes, 'Productos': r.productos, 'Pedidos': r.pedidos, 'Unidades sin costo': r.undSinCosto };
    });
    bMes.push({ 'Mes (fecha de la remisión)': 'TOTAL', 'Unidades bonificadas': bt.unidades, 'Costo': r2(bt.costo), '% del costo': 1, 'Clientes': bt.clientes, 'Productos': bt.productos, 'Pedidos': bt.pedidos, 'Unidades sin costo': bt.undSinCosto });
    var bCla = B.clasificaciones.map(function(r) {
      return { 'Clasificación': r.nombre, 'Productos': r.productos, 'Unidades bonificadas': r.unidades, 'Costo': r2(r.costo), '% del costo': pctB(r.pct), 'Clientes': r.clientes, 'Pedidos': r.pedidos, 'Unidades sin costo': r.undSinCosto };
    });
    bCla.push({ 'Clasificación': 'TOTAL', 'Productos': bt.productos, 'Unidades bonificadas': bt.unidades, 'Costo': r2(bt.costo), '% del costo': 1, 'Clientes': bt.clientes, 'Pedidos': bt.pedidos, 'Unidades sin costo': bt.undSinCosto });
    hojasBon = [['Bonificados por producto', bProd], ['Bonificados por cliente', bCli], ['Bonificados por mes', bMes], ['Bonificados por clasificación', bCla]];
  }
  criterios.push([]);
  criterios.push(['Bonificaciones: costo de las unidades bonificadas y remisionadas = unidades × costo usado del producto (el mismo de la hoja «Rentabilidad»). Total del período: ' + bt.unidades + ' unidades, costo $' + Math.round(bt.costo).toLocaleString('es-CO') + (bt.pctVentas != null ? ' (' + (Math.round(bt.pctVentas * 1000) / 10).toLocaleString('es-CO') + ' % de las ventas remisionadas)' : '') + '; ' + bt.undSinCosto + ' unidades sin costo no incluidas.']);
  criterios.push(['Las hojas «Bonificados …» miden desde el ' + fmtDate(B.desde) + (B.hasta ? ' hasta el ' + fmtDate(B.hasta) : ' en adelante') + ' (el piso es el 01/07/2026; un «Desde» posterior del Dashboard lo adelanta), por fecha de remisión y sin cargas históricas; no usan el rango de la hoja «Rentabilidad».']);
  criterios.push(['Los clientes se agrupan por NIT (sin dígito de verificación). El mes es el de la fecha de cada remisión.']);

  var wsC = XLSX.utils.aoa_to_sheet(criterios);
  wsC['!cols'] = [{ wch: 130 }, { wch: 30 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Rentabilidad');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porClasif), 'Por clasificación');
  hojasBon.forEach(function(h) { XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(h[1]), h[0]); });
  XLSX.utils.book_append_sheet(wb, wsC, 'Criterios');
  XLSX.writeFile(wb, 'rentabilidad_IASO_' + today() + '.xlsx');
}
