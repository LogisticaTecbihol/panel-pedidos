// ── Prorrateo de gastos de Legalización — lógica compartida ──
// Fuente ÚNICA del cálculo que muestran la pestaña "Prorrateo de gastos" del
// módulo Legalización (legalizacion-gastos.js) y la pestaña "Legalización de
// gastos" del Dashboard (dashboard.js): así las dos pantallas no pueden
// divergir. Sin DOM ni estado propio: todo entra por parámetros.
// Requiere shared.js (getSigla, _litParse, EMPRESAS_HOLDING).
//
//  · construirMapas(fuentes)  → arma los mapas remisión → productos a partir de
//    las 7 consultas (Pedidos, Ingresos, Muestras, Devoluciones, Remisiones
//    externas + sus líneas, Cambios).
//  · calcular(datos, filtros) → el prorrateo (ver el bloque grande más abajo).
var LegProrrateo = (function() {

  // Remisiones externas que NO están en el sistema: las de Chia Abago (proveedor)
  // y las de materias primas de la planta de producción. Ninguna es empresa del
  // holding: en el reparto son filas propias y en Prorrateo grupos aparte.
  var EMPRESA_ABAGO = 'CHIA ABAGO';
  var EMPRESA_MP = 'MATERIAS PRIMAS';

  // Tipo de la remisión de la que sale cada línea del Prorrateo (columna "Tipo de
  // remisión" del Excel): las remisiones externas de materia prima y las de Chia
  // Abago traen el suyo (`tipoRem`); todo lo que resuelve el sistema (Pedidos,
  // Ingresos, Cambios, Muestras, Devoluciones) es producto terminado.
  var TIPO_REM_MP = 'Materia prima';
  var TIPO_REM_ABAGO = 'Chia Abago';
  var TIPO_REM_PT = 'Producto terminado';

  // Conceptos fijos del formulario de gasto de ruta. Cualquier otro texto (lo que
  // se escribe en "Otros → Especifique…") es un gasto "Otros": no se prorratea
  // por producto ni se discrimina por empresa; va como un solo monto en su
  // propia tabla "Otros por empresa" (como se ve el Combustible).
  var CONCEPTOS_RUTA_FIJOS = ['Combustible', 'Alimentación', 'Peaje', 'Envío', 'Alojamiento'];
  function esConceptoOtros(concepto) {
    return CONCEPTOS_RUTA_FIJOS.indexOf(concepto || '') < 0;
  }

  // ¿Qué de los gastos de un viaje deja por fuera su reparto entre empresas?
  // El reparto manual puede sumar el total de gastos o, si lo calculó el botón
  // "Calcular reparto", el total sin Combustible y/o sin Otros. Devuelve
  // { comb, otros, cuadra }: comb/otros = true si el reparto NO incluye ese
  // gasto (hay que mostrarlo "Sin reparto asignado"); cuadra = el reparto
  // coincide con alguna de esas combinaciones. Un reparto que no coincide con
  // ninguna queda con comb/otros = false (se prorratea por sus proporciones).
  // Prioridad ante montos iguales: total − combustible (reparto histórico, que
  // sí cubría Otros) antes que total − otros.
  function cobertura(total, reparto, comb, otros) {
    total = Math.round(total); reparto = Math.round(reparto);
    comb = Math.round(comb); otros = Math.round(otros);
    var r = { comb: false, otros: false, cuadra: false };
    if (reparto === total) { r.cuadra = true; return r; }
    if (comb > 0 && otros > 0 && reparto === total - comb - otros) { r.comb = true; r.otros = true; r.cuadra = true; return r; }
    if (comb > 0 && reparto === total - comb) { r.comb = true; r.cuadra = true; return r; }
    if (otros > 0 && reparto === total - otros) { r.otros = true; r.cuadra = true; return r; }
    return r;
  }

  // "Planta" de destino de una remisión de materia prima; define la(s) empresa(s)
  // a la(s) que se cargan sus gastos. Las dos plantas van a su empresa (misma
  // relación de ORIGEN_EMPRESA en ingresos.js); IASO, IAS y RESO se eligen
  // directamente por empresa. Se pueden elegir varias: Remisiones_Externas.Planta
  // guarda los códigos separados por coma ("CACHIPAY,IASO"), en este orden.
  var PLANTAS_MP = {
    CACHIPAY: { nombre: 'Planta Cachipay', sigla: 'PARCELAR' },
    MOSQUERA: { nombre: 'Planta Mosquera', sigla: 'GREEN' },
    IASO:     { nombre: 'IASO', sigla: 'IASO' },
    IAS:      { nombre: 'IAS',  sigla: 'IAS' },
    RESO:     { nombre: 'RESO', sigla: 'RESO' }
  };
  var PLANTAS_MP_ORDEN = ['CACHIPAY', 'MOSQUERA', 'IASO', 'IAS', 'RESO'];
  function empresaDePlanta(planta) {
    var p = PLANTAS_MP[planta];
    var e = p && EMPRESAS_HOLDING.find(function(x) { return x.sigla === p.sigla; });
    return e ? e.value : null;
  }
  // Códigos válidos de un valor de Planta (texto con códigos separados por coma),
  // sin repetidos y en el orden canónico.
  function plantasDe(planta) {
    var set = {};
    String(planta || '').split(',').forEach(function(c) { c = c.trim().toUpperCase(); if (PLANTAS_MP[c]) set[c] = true; });
    return PLANTAS_MP_ORDEN.filter(function(c) { return set[c]; });
  }
  // Empresas a las que se cargan los gastos de una remisión externa: Abago → grupo
  // "CHIA ABAGO"; materia prima → las empresas de sus plantas (las antiguas sin
  // planta quedan en el grupo "MATERIAS PRIMAS" hasta que se les asigne una).
  function empresasDeRemisionExterna(ex) {
    if (ex && ex.Tipo === 'MATERIA_PRIMA') {
      var emps = [];
      plantasDe(ex.Planta).forEach(function(c) {
        var e = empresaDePlanta(c);
        if (e && emps.indexOf(e) < 0) emps.push(e);
      });
      return emps.length ? emps : [EMPRESA_MP];
    }
    return [EMPRESA_ABAGO];
  }
  // La primera de esas empresas (para donde solo cabe una).
  function empresaDeRemisionExterna(ex) { return empresasDeRemisionExterna(ex)[0]; }
  // Líneas de un mapa de remisiones a partir de una línea guardada de remisión
  // externa. `externa` las distingue de las líneas del sistema con el mismo código
  // (la empresa ya no basta: una materia prima cargada a PARCELAR o GREEN tiene
  // empresa del holding). Con varias empresas la cantidad se divide en partes
  // iguales: una línea de 1.000 Kg para IASO + IAS aporta 500 Kg a cada una.
  function lineasExternasAMapa(ex, l) {
    var emps = empresasDeRemisionExterna(ex);
    var cant = Number(l.Cantidad) / emps.length;
    return emps.map(function(emp) {
      return { producto: l.Producto, presentacion: l.Presentacion, cantidad: cant, empresa: emp, unidad: l.Unidad || null, externa: true,
               tipoRem: ex && ex.Tipo === 'MATERIA_PRIMA' ? TIPO_REM_MP : TIPO_REM_ABAGO };
    });
  }

  // Litros, kilos y unidades de una línea de remisión resuelta (para el reparto y
  // el Prorrateo). Las de materia prima externa traen kilos/litros directos
  // (unidad KG|L); el resto se deduce del nombre/presentación del producto.
  // `unidades` solo se llena en las líneas de materia prima externa en Unidades
  // (UND) que no se pueden convertir a litros/kilos: son la tercera bolsa del
  // prorrateo, repartida por cantidad de unidades. Lo demás que no se convierte
  // (ej. un producto de Chia Abago sin presentación) sigue sin entrar.
  function litKiloDeLinea(m) {
    var cant = Number(m.cantidad) || 0;
    if (m.unidad === 'KG') return { litros: 0, kilos: cant, unidades: 0 };
    if (m.unidad === 'L') return { litros: cant, kilos: 0, unidades: 0 };
    var lit = _litParse(m.producto, m.presentacion);
    var litros = lit.convertible ? lit.litrosUnidad * cant : 0;
    var kilos = lit.convertibleKilo ? lit.kilosUnidad * cant : 0;
    return { litros: litros, kilos: kilos, unidades: (m.unidad === 'UND' && litros <= 0 && kilos <= 0) ? cant : 0 };
  }

  // Pedidos.Remisiones llega como "REM-001|cant|fecha, REM-002|cant|fecha" (o,
  // en registros viejos, un solo código sin "|"). Mismo parseo que kardex.js.
  function parseRemisionesField(remStr) {
    var s = (remStr || '').trim();
    if (!s) return [];
    if (s.indexOf('|') < 0) return [s];
    return s.split(',').map(function(seg) {
      return (seg.split('|')[0] || '').trim();
    }).filter(function(r) { return r; });
  }

  // ══════════════════════════════════════════════════════════════
  // Mapas remisión → productos
  // ──────────────────────────────────────────────────────────────
  // fuentes = resultados de apiGet (con .ok): { pedidos, ingresos, muestras,
  // devoluciones, ext, extItems, cambios } — columnas pedidas en cada pantalla:
  //   pedidos      Cliente,Remisiones,Estado_2,Producto,Presentacion,Nombre_Empresa
  //   ingresos     Producto,Presentacion,Cantidad,Remision_Destino,Remision_Origen,Empresa_Destino,Empresa_Origen
  //   muestras     Remision,Empresa,Producto,Presentacion,Cantidad,Cant_Entregada,Tipo_Solicitud
  //   devoluciones Remision,Remision_Ingreso,Remision_Salida,Empresa,Producto,Presentacion,Cantidad,Cant_Entregada,Estado
  //   ext          id,Remision,Fecha,Tipo,Proveedor,Planta,creado_por_nombre,creado_en,modificado_en
  //   extItems     Remision_Id,Producto,Presentacion,Cantidad,Unidad
  //   cambios      id,Tipo_Linea,Cantidad,Estado,Remision_Salida,Remision_Ingreso,Consecutivo,Empresa,Producto
  //
  // Devuelve:
  //  · prodMap  "REM-001" (mayúsculas) -> [{producto, presentacion, cantidad, empresa}, ...]
  //    — la cantidad es la de ESA remisión puntual (una fila de Pedidos puede
  //    tener varias entregas parciales bajo remisiones distintas). Cubre entregas
  //    de Pedidos, Ingresos (traslados planta↔empresa), Cambios de mercancía y
  //    remisiones externas; Órdenes de Compra, muestras y reenvases todavía no se
  //    resuelven aquí.
  //  · repMap   igual que prodMap, más las remisiones de Muestras y de
  //    Devoluciones. Lo usan el botón "Calcular reparto" del formulario y, en
  //    Prorrateo, solo las legalizaciones de tipo Envío (los envíos suelen llevar
  //    muestras).
  //  · remMap / clientes  remisión → cliente, y clientes con al menos una remisión.
  //  · remisionesExternas / externasCargadas  las remisiones externas por código
  //    {id, Remision, Fecha, Tipo, Proveedor, Planta, lineas:[{Producto,Presentacion,Cantidad,Unidad}]}
  //    y si se pudieron cargar (los dos fetch ok).
  // ══════════════════════════════════════════════════════════════
  function construirMapas(src) {
    var res = src.pedidos;
    var resIng = src.ingresos;
    var resMue = src.muestras;
    var resDev = src.devoluciones;
    var resExt = src.ext;
    var resExtIt = src.extItems;
    var resCam = src.cambios;
    var set = {};
    var remMap = {};
    var prodMap = {};
    var remisionesExternas = {};
    var externasCargadas = false;
    if (res && res.ok) {
      (res.pedidos || []).forEach(function(p) {
        var cli = (p.Cliente || '').trim();
        if (p.Estado_2 === 'Anulado') return;
        var rems = parseRemisionesField(p.Remisiones);
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
    if (resIng && resIng.ok) {
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
    // Cambios de mercancía: mismo criterio que el Kardex (buildMovimientos). La
    // remisión de ingreso es de las líneas CAMBIAR (lo que devuelve el cliente);
    // la de salida es de las líneas ENTREGAR (lo que se le despacha), o de las
    // CAMBIAR si el cambio no tiene líneas ENTREGAR. Cuentan los cambios Cerrado
    // y Parcial (cada lado solo si ya tiene su remisión); la cantidad es Cantidad.
    if (resCam && resCam.ok) {
      var camGrupo = function(c) { return (c.Empresa || '') + '||' + (c.Consecutivo || c.id); };
      var camEntregar = {};
      (resCam.cambios || []).forEach(function(c) { if (c.Tipo_Linea === 'ENTREGAR') camEntregar[camGrupo(c)] = true; });
      (resCam.cambios || []).forEach(function(c) {
        var cant = Number(c.Cantidad) || 0;
        var est = (c.Estado || '').toLowerCase();
        if (cant <= 0 || (est !== 'cerrado' && est !== 'cerrada' && est !== 'parcial')) return;
        var tieneEntregar = !!camEntregar[camGrupo(c)];
        var remIng = c.Tipo_Linea === 'CAMBIAR' ? String(c.Remision_Ingreso || '').trim().toUpperCase() : '';
        var remSal = ((tieneEntregar && c.Tipo_Linea === 'ENTREGAR') || (!tieneEntregar && c.Tipo_Linea === 'CAMBIAR'))
          ? String(c.Remision_Salida || '').trim().toUpperCase() : '';
        [remIng, remSal].forEach(function(key) {
          if (!key) return;
          (prodMap[key] = prodMap[key] || []).push({ producto: c.Producto, presentacion: '', cantidad: cant, empresa: c.Empresa });
        });
      });
    }
    // Remisiones externas (Chia Abago / materia prima): sus líneas entran a
    // prodMap (y por copia a repMap, más abajo) con la empresa de su tipo.
    if (resExt && resExt.ok && resExtIt && resExtIt.ok) {
      externasCargadas = true;
      var extPorId = {};
      (resExt.remisiones || []).forEach(function(r) {
        var o = { id: r.id, Remision: r.Remision, Fecha: r.Fecha, Tipo: r.Tipo || 'ABAGO', Proveedor: r.Proveedor || '', Planta: r.Planta || null,
                  creado_por_nombre: r.creado_por_nombre || '', creado_en: r.creado_en || null, modificado_en: r.modificado_en || null, lineas: [] };
        extPorId[r.id] = o;
        remisionesExternas[String(r.Remision || '').trim().toUpperCase()] = o;
      });
      (resExtIt.items || []).forEach(function(it) {
        var o = extPorId[it.Remision_Id];
        if (o) o.lineas.push({ Producto: it.Producto, Presentacion: it.Presentacion || '', Cantidad: Number(it.Cantidad) || 0, Unidad: it.Unidad || null });
      });
      Object.keys(remisionesExternas).forEach(function(key) {
        var ex = remisionesExternas[key];
        ex.lineas.forEach(function(l) {
          if (!(l.Cantidad > 0)) return;
          lineasExternasAMapa(ex, l).forEach(function(m) { (prodMap[key] = prodMap[key] || []).push(m); });
        });
      });
    }

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

    return {
      prodMap: prodMap,
      repMap: repMap,
      remMap: remMap,
      clientes: Object.keys(set).sort(function(a, b) { return a.localeCompare(b, 'es'); }),
      remisionesExternas: remisionesExternas,
      externasCargadas: externasCargadas
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Proporción de gastos por producto y por empresa (estimada)
  // ──────────────────────────────────────────────────────────────
  // Prorratea el gasto de cada viaje entre los productos de sus remisiones
  // relacionadas, según los litros movidos de cada uno, y agrega ese mismo
  // prorrateo por SKU y por empresa (la Nombre_Empresa del pedido dueño de
  // cada línea). Es una aproximación: Remisiones_Relacionadas es texto libre y
  // el mapa de remisiones solo resuelve entregas de Pedidos, Ingresos, Cambios y
  // remisiones externas (ver construirMapas). Lo que no se puede vincular a un
  // producto, o cuyo producto no es convertible a litros, cae en el bucket
  // "Sin identificar" — el mismo bucket y monto para ambos desgloses.
  //
  // Filtros (f.fEmp / f.fDesde / f.fHasta): el rango de fechas excluye viajes
  // completos por Fecha; Empresa filtra a nivel de LÍNEA de producto, por la
  // empresa dueña de esa remisión resuelta (Nombre_Empresa del Pedido), NO por
  // el reparto manual del viaje — así, filtrar por una empresa muestra solo sus
  // productos, aunque el viaje haya tocado varias empresas. Con el filtro
  // activo, "Sin identificar" se omite (no se le puede atribuir a una empresa
  // algo que no se pudo resolver) y el total/porcentajes quedan sobre la porción
  // de esa empresa únicamente.
  //
  // Líquidos vs. sólidos (vs. unidades): dentro de un mismo viaje, el gasto primero
  // se separa en bolsas — "líquidos" (prorrateados por litro), "sólidos"
  // (prorrateados por kilo) y "unidades" (por cantidad de unidades) — proporcional
  // a cuántas remisiones relacionadas aportan a cada bolsa (una remisión con
  // productos de varios tipos cuenta para cada una). Ya dentro de cada bolsa, el
  // reparto entre productos sigue siendo por litros, kilos o unidades movidos.
  // La bolsa de unidades solo la llenan las líneas de materia prima externa en
  // Unidades que no se convierten a litros/kilos (ver litKiloDeLinea). Un viaje
  // 100% líquido (el caso más común) se comporta exactamente igual que antes.
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
  // También entran a esa tabla las líneas de Combustible de los formularios de
  // Mantenimiento (Tipo='Mantenimiento'), repartidas por el Monto de su reparto
  // entre empresas; el resto del mantenimiento va a "Mantenimiento por empresa".
  //
  // Otros aparte: las líneas de un viaje de Ruta cuyo concepto es "Otros" (texto
  // libre fuera de CONCEPTOS_RUTA_FIJOS) salen del prorrateo por producto y se
  // muestran en su tabla "Otros por empresa" como UN solo monto, sin discriminar
  // por empresa: todo queda en "Sin reparto asignado", tal como se ve hoy el
  // Combustible y el Mantenimiento. Los Envíos y el Mantenimiento no tienen
  // "Otros" (el mantenimiento ya va completo a su tabla).
  //
  // datos = { legs, items, empresas, mapa, mapaReparto }
  //   legs/items/empresas: LegalizacionGastos / ...Items / ...Empresas (en el
  //   orden de id: el orden de suma afecta los decimales); mapa y mapaReparto:
  //   prodMap y repMap de construirMapas.
  // ══════════════════════════════════════════════════════════════
  function calcular(datos, f) {
    f = f || {};
    var fEmp = f.fEmp || '';
    var fEmpSigla = fEmp ? getSigla(fEmp) : '';
    var fDesde = f.fDesde || '';
    var fHasta = f.fHasta || '';
    var legs = datos.legs || [];
    var remisionProductoMap = datos.mapa || {};
    var remisionProductoMapReparto = datos.mapaReparto || {};

    // Índices por legalización (mismo orden que el arreglo de origen).
    var itemsPorLeg = {}, repPorLeg = {};
    (datos.items || []).forEach(function(it) { (itemsPorLeg[it.Legalizacion_Id] = itemsPorLeg[it.Legalizacion_Id] || []).push(it); });
    (datos.empresas || []).forEach(function(e) { (repPorLeg[e.Legalizacion_Id] = repPorLeg[e.Legalizacion_Id] || []).push(e); });
    function itemsOf(legId) { return itemsPorLeg[legId] || []; }
    function empresasOf(legId) { return repPorLeg[legId] || []; }
    function totalGastosOf(legId) { return itemsOf(legId).reduce(function(s, it) { return s + (Number(it.Valor) || 0); }, 0); }
    function totalRepartoOf(legId) { return empresasOf(legId).reduce(function(s, e) { return s + (Number(e.Monto) || 0); }, 0); }
    // Suma solo las líneas de gasto de un concepto puntual (ej. 'Combustible'),
    // para sacarlo del prorrateo por producto.
    function totalGastosConceptoOf(legId, concepto) {
      return itemsOf(legId).filter(function(it) { return it.Concepto === concepto; })
        .reduce(function(s, it) { return s + (Number(it.Valor) || 0); }, 0);
    }
    // Suma las líneas con concepto "Otros" (texto fuera de los conceptos fijos).
    function totalGastosOtrosOf(legId) {
      return itemsOf(legId).filter(function(it) { return esConceptoOtros(it.Concepto); })
        .reduce(function(s, it) { return s + (Number(it.Valor) || 0); }, 0);
    }
    function esEnvio(leg) { return !!leg && leg.Tipo === 'Envio'; }

    var porEmpresa = {};       // empresaSigla -> monto total
    // rems = el mismo monto desglosado por remisión de origen:
    // { "tipo|CODIGO" -> { codigo, tipo, monto, legs: { legId -> Consecutivo } } }
    var porEmpresaSku = {};    // empresaSigla -> { sku -> { monto, legs: { legId -> Consecutivo }, rems } }
    var porEmpresaLitros = {};     // empresaSigla -> litros totales movidos (sin ponderar por monto)
    var porEmpresaKilos = {};      // empresaSigla -> kilos totales movidos (sin ponderar por monto)
    var porEmpresaUnidades = {};   // empresaSigla -> unidades totales movidas (materia prima en Unidades sin conversión)
    // Parte del monto de porEmpresa que salió de cada bolsa (líquidos / sólidos /
    // unidades): permite el costo por litro, por kilo y por unidad de cada empresa.
    // Solo informativo: no cambia porEmpresa ni los totales.
    var porEmpresaMontoLitros = {};
    var porEmpresaMontoKilos = {};
    var porEmpresaMontoUnidades = {};
    var porEmpresaRemisiones = {}; // empresaSigla -> { codigoRemision: true }
    var porEmpresaLegs = {};       // empresaSigla -> { legId -> Consecutivo } (legalizaciones que tocan esa empresa)
    var legsPeriodo = {};          // legId -> true (todas las legalizaciones del período, resuelvan o no litros/kilos)
    // "Sin identificar": gasto de viajes cuyas remisiones no resuelven ningún
    // producto litro/kilo/unidad. Va APARTE (como Combustible, Mantenimiento y
    // Otros): NO entra en totalGeneral, para no mover los % de prorrateo por empresa.
    var sinIdentificar = 0;
    var sinIdentificarRemisiones = {}; // codigoRemision -> true (viajes sin producto litro/kilo resoluble)
    var sinIdentificarLegs = {};       // legId -> Consecutivo
    var totalGeneral = 0;              // solo lo prorrateado por producto (sin "Sin identificar")

    // Combustible: porEmpresa = empresaSigla -> monto; legs = empresaSigla ->
    // { legId -> Consecutivo }; sinAsignar = monto de viajes/mantenimientos sin
    // reparto manual entre empresas (sinAsignarLegs = legId -> Consecutivo).
    var combustible = { porEmpresa: {}, legs: {}, sinAsignar: 0, sinAsignarLegs: {}, total: 0 };

    // Mantenimiento: igual que el Combustible (tabla propia, sin litros/kilos).
    var mantenimiento = { porEmpresa: {}, legs: {}, sinAsignar: 0, sinAsignarLegs: {}, total: 0 };

    // Otros (concepto "Otros" de los viajes de Ruta): misma forma que el
    // Combustible, pero porEmpresa/legs quedan siempre vacíos (ver _acumularOtros).
    var otros ={ porEmpresa: {}, legs: {}, sinAsignar: 0, sinAsignarLegs: {}, total: 0 };

    // Reparte subMonto (la porción de líquidos, sólidos o unidades del viaje) entre
    // las líneas de ese tipo, proporcional a sus litros/kilos/unidades movidos.
    function _acumularLineas(leg, items, totalUnidad, subMonto, campoUnidad, campoAcumEmp, campoAcumMonto) {
      items.forEach(function(item) {
        var l = item.m;
        if (l[campoUnidad] <= 0) return;
        var emp = getSigla(l.empresa);
        if (fEmpSigla && emp !== fEmpSigla) return;
        var monto = (l[campoUnidad] / totalUnidad) * subMonto;
        campoAcumMonto[emp] = (campoAcumMonto[emp] || 0) + monto;
        var sku = (l.producto || 'Sin nombre') + (l.presentacion ? ' (' + l.presentacion + ')' : '');
        porEmpresa[emp] = (porEmpresa[emp] || 0) + monto;
        var skuMap = porEmpresaSku[emp] || (porEmpresaSku[emp] = {});
        var entry = skuMap[sku] || (skuMap[sku] = { monto: 0, legs: {}, rems: {} });
        entry.monto += monto;
        entry.legs[leg.id] = leg.Consecutivo || ('#' + leg.id);
        // Misma remisión con el mismo tipo = un solo renglón (el código puede
        // repetirse entre una remisión del sistema y una externa).
        var tipoRem = l.tipoRem || TIPO_REM_PT;
        var codigoRem = String(item.codigo || '').trim().toUpperCase();
        var remKey = tipoRem + '|' + codigoRem;
        var rem = entry.rems[remKey] || (entry.rems[remKey] = { codigo: codigoRem, tipo: tipoRem, monto: 0, legs: {} });
        rem.monto += monto;
        rem.legs[leg.id] = leg.Consecutivo || ('#' + leg.id);
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
    function _acumularCombustible(leg, monto, montoOtros) {
      var totalReparto = totalRepartoOf(leg.id);
      var cob = cobertura(totalGastosOf(leg.id), totalReparto, monto, montoOtros);
      if (totalReparto <= 0 || cob.comb) {
        if (!fEmp) {
          combustible.sinAsignar += monto;
          combustible.total += monto;
          combustible.sinAsignarLegs[leg.id] = leg.Consecutivo || ('#' + leg.id);
        }
        return;
      }
      _repartirPorMonto(leg, monto, combustible);
    }

    // El concepto "Otros" de un viaje de Ruta NO se discrimina por empresa: va
    // completo, en un solo monto, a "Sin reparto asignado" de su tabla (así se ve
    // hoy el Combustible y el Mantenimiento), tenga o no reparto el viaje. Con
    // filtro de empresa no se atribuye a nadie, igual que los otros "Sin …".
    function _acumularOtros(leg, monto) {
      if (fEmp) return;
      otros.sinAsignar += monto;
      otros.total += monto;
      otros.sinAsignarLegs[leg.id] = leg.Consecutivo || ('#' + leg.id);
    }

    // Reparte `monto` de una legalización entre las empresas de su reparto
    // manual, a prorrata del Monto de cada una, y lo acumula en `dest`
    // (combustible o mantenimiento). Sin reparto con montos (>0) queda en "Sin
    // reparto asignado".
    function _repartirPorMonto(leg, monto, dest) {
      var totalReparto = totalRepartoOf(leg.id);
      var rotulo = leg.Consecutivo || ('#' + leg.id);
      if (totalReparto <= 0) {
        if (!fEmp) {
          dest.sinAsignar += monto;
          dest.total += monto;
          dest.sinAsignarLegs[leg.id] = rotulo;
        }
        return;
      }
      empresasOf(leg.id).forEach(function(e) {
        var eMonto = Number(e.Monto) || 0;
        if (eMonto <= 0) return;
        var emp = getSigla(e.Empresa);
        if (fEmpSigla && emp !== fEmpSigla) return;
        var m = monto * (eMonto / totalReparto);
        dest.porEmpresa[emp] = (dest.porEmpresa[emp] || 0) + m;
        dest.total += m;
        (dest.legs[emp] = dest.legs[emp] || {})[leg.id] = rotulo;
      });
    }

    legs.forEach(function(leg) {
      if (leg.Estado_Conciliacion === 'Rechazada') return;
      if (fDesde && (leg.Fecha || '') < fDesde) return;
      if (fHasta && (leg.Fecha || '') > fHasta) return;
      // Mantenimiento (Tipo='Mantenimiento') es un gasto de vehículo, no de
      // ruta: no tiene remisiones relacionadas ni relación con litros/kilos de
      // producto, así que no entra al prorrateo por producto (caería completo en
      // "Sin identificar"); va en su propia tabla "Mantenimiento por empresa".
      // Las líneas con detalle 'Combustible' del formulario de mantenimiento se
      // sacan de ahí y se suman a la tabla "Combustible por empresa" (mismo
      // reparto por Monto de la legalización), sin contarse en las dos.
      if (leg.Tipo === 'Mantenimiento') {
        var combMant = totalGastosConceptoOf(leg.id, 'Combustible');
        if (combMant > 0) _repartirPorMonto(leg, combMant, combustible);
        var totalMant = totalGastosOf(leg.id) - combMant;
        if (totalMant > 0) _repartirPorMonto(leg, totalMant, mantenimiento);
        return;
      }
      legsPeriodo[leg.id] = true;

      var totalCombustible = totalGastosConceptoOf(leg.id, 'Combustible');
      var totalOtros = esEnvio(leg) ? 0 : totalGastosOtrosOf(leg.id);
      if (totalCombustible > 0) _acumularCombustible(leg, totalCombustible, totalOtros);
      if (totalOtros > 0) _acumularOtros(leg, totalOtros);

      var totalViaje = totalGastosOf(leg.id) - totalCombustible - totalOtros;
      if (totalViaje <= 0) return;

      // Remisiones_Relacionadas es un CSV simple de códigos (sin "|cant|fecha"),
      // igual formato que lee openForm() al editar — no usar parseRemisionesField
      // aquí, que solo separa por coma cuando detecta "|".
      var codigos = (leg.Remisiones_Relacionadas || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
      var lineas = [];
      // Un envío suele despachar muestras: sus remisiones se resuelven también
      // contra Muestras y Devoluciones; para Ruta se mantiene el mapa de siempre.
      var mapaRem = esEnvio(leg) ? remisionProductoMapReparto : remisionProductoMap;
      codigos.forEach(function(c) {
        var matches = mapaRem[c.trim().toUpperCase()];
        if (matches) matches.forEach(function(m) { lineas.push({ m: m, codigo: c }); });
      });

      var totalLitros = 0, totalKilos = 0, totalUnidades = 0;
      var codigosLiquido = {}, codigosSolido = {}, codigosUnidad = {};
      lineas.forEach(function(item) {
        var l = item.m;
        var lk = litKiloDeLinea(l);
        l._litros = lk.litros;
        l._kilos = lk.kilos;
        l._unidades = lk.unidades;
        totalLitros += l._litros;
        totalKilos += l._kilos;
        totalUnidades += l._unidades;
        if (l._litros > 0) codigosLiquido[item.codigo] = true;
        if (l._kilos > 0) codigosSolido[item.codigo] = true;
        if (l._unidades > 0) codigosUnidad[item.codigo] = true;
      });

      var nLiq = Object.keys(codigosLiquido).length;
      var nSol = Object.keys(codigosSolido).length;
      var nUni = Object.keys(codigosUnidad).length;

      if (nLiq + nSol + nUni <= 0) {
        if (!fEmp) {
          sinIdentificar += totalViaje;
          sinIdentificarLegs[leg.id] = leg.Consecutivo || ('#' + leg.id);
          codigos.forEach(function(c) { sinIdentificarRemisiones[c] = true; });
        }
        return;
      }

      // Reparto del gasto del viaje entre la bolsa de líquidos, la de sólidos y
      // la de unidades, proporcional a cuántas remisiones aportan a cada una.
      var nBolsas = nLiq + nSol + nUni;
      var montoLiquidos = totalViaje * nLiq / nBolsas;
      var montoSolidos = totalViaje * nSol / nBolsas;
      var montoUnidades = totalViaje * nUni / nBolsas;

      if (totalLitros > 0) _acumularLineas(leg, lineas, totalLitros, montoLiquidos, '_litros', porEmpresaLitros, porEmpresaMontoLitros);
      if (totalKilos > 0) _acumularLineas(leg, lineas, totalKilos, montoSolidos, '_kilos', porEmpresaKilos, porEmpresaMontoKilos);
      if (totalUnidades > 0) _acumularLineas(leg, lineas, totalUnidades, montoUnidades, '_unidades', porEmpresaUnidades, porEmpresaMontoUnidades);
    });

    return {
      porEmpresa: porEmpresa,
      porEmpresaSku: porEmpresaSku,
      porEmpresaLitros: porEmpresaLitros,
      porEmpresaKilos: porEmpresaKilos,
      porEmpresaUnidades: porEmpresaUnidades,
      porEmpresaMontoLitros: porEmpresaMontoLitros,
      porEmpresaMontoKilos: porEmpresaMontoKilos,
      porEmpresaMontoUnidades: porEmpresaMontoUnidades,
      porEmpresaRemisiones: porEmpresaRemisiones,
      porEmpresaLegs: porEmpresaLegs,
      legsPeriodoCount: Object.keys(legsPeriodo).length,
      sinIdentificar: sinIdentificar,
      sinIdentificarRemisiones: sinIdentificarRemisiones,
      sinIdentificarLegs: sinIdentificarLegs,
      // Misma forma que `otros`/`mantenimiento` para mostrarlo como tabla aparte:
      // un solo monto en "Sin reparto asignado", sin discriminar por empresa.
      sinIdentificado: { porEmpresa: {}, legs: {}, sinAsignar: sinIdentificar, sinAsignarLegs: sinIdentificarLegs, total: sinIdentificar },
      totalGeneral: totalGeneral,
      combustiblePorEmpresa: combustible.porEmpresa,
      combustibleLegs: combustible.legs,
      combustibleSinAsignar: combustible.sinAsignar,
      combustibleSinAsignarLegs: combustible.sinAsignarLegs,
      combustibleTotalGeneral: combustible.total,
      mantenimiento: mantenimiento,
      otros: otros
    };
  }

  return {
    CONCEPTOS_RUTA_FIJOS: CONCEPTOS_RUTA_FIJOS,
    esConceptoOtros: esConceptoOtros,
    cobertura: cobertura,
    EMPRESA_ABAGO: EMPRESA_ABAGO,
    EMPRESA_MP: EMPRESA_MP,
    PLANTAS_MP: PLANTAS_MP,
    PLANTAS_MP_ORDEN: PLANTAS_MP_ORDEN,
    plantasDe: plantasDe,
    empresaDePlanta: empresaDePlanta,
    empresaDeRemisionExterna: empresaDeRemisionExterna,
    empresasDeRemisionExterna: empresasDeRemisionExterna,
    lineasExternasAMapa: lineasExternasAMapa,
    litKiloDeLinea: litKiloDeLinea,
    parseRemisionesField: parseRemisionesField,
    construirMapas: construirMapas,
    calcular: calcular
  };
})();
