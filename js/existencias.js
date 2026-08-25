// ============================================================
// js/existencias.js
//
// Este módulo expone dos APIs con propósitos distintos:
//
//   A) API "Kardex" (usada por pedidos.js al registrar entregas)
//      ─────────────────────────────────────────────────────────
//      Replica exactamente el cálculo del módulo Kardex
//      (js/kardex.js → buildMovimientos + calcularExistencias),
//      para que los números que ve el usuario en el desplegable
//      "Empresa origen del stock" coincidan uno a uno con la
//      pestaña "Existencias por Empresa" del Kardex.
//
//        • loadSnapshot()            → carga las 9 fuentes que
//                                       usa Kardex y calcula los
//                                       saldos por (producto,
//                                       empresa) desde el Saldo
//                                       Inicial más antiguo.
//        • getPorEmpresa(snap, prod) → array [{empresa, sigla,
//                                       disponible}] filtrado por
//                                       las empresas visibles al
//                                       usuario (AUTH).
//        • getPorEmpresaEspecifica(...)  → número.
//
//   B) API "Inventario" (usada por inventario.js)
//      ───────────────────────────────────────────
//      Globals de compatibilidad para el módulo Inventario, que
//      calcula "Disponible" como stock_fisico(Inventario) +
//      movimientos − comprometido(pedidos pendientes). NO se
//      cambia el comportamiento actual del módulo Inventario.
//
//        • computeComprometido()   (window global)
//        • computeMovimientos()    (window global)
//        • enrichInventario()      (window global)
// ============================================================

(function(global) {
  'use strict';

  // ═════════════════════════════════════════════════════════
  // Utilidades comunes
  // ═════════════════════════════════════════════════════════

  function _norm(s) {
    if (typeof norm === 'function') return norm(s);
    return String(s || '').toLowerCase().trim();
  }

  // Misma normalización que kardex.js:_normProd
  function _normProd(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }

  function _esBueno(bodega) {
    var b = (bodega || '').toLowerCase().trim();
    return b !== 'producto no conforme';
  }

  function _empresaTienePlanta(empresa) {
    var s = (typeof getSigla === 'function') ? getSigla(empresa) : empresa;
    return s === 'GREEN' || s === 'PARCELAR';
  }

  function _esOrigenPlanta(origen) {
    return /planta/i.test(origen || '');
  }

  var _NC_MOTIVOS_IGNORAR_SALIDA = {
    'Devolucion_cliente': true,
    'Retorno_conforme': true,
    'Traslado_NC': true
  };


  // ═════════════════════════════════════════════════════════
  // API A) KARDEX — cálculo idéntico al del módulo Kardex
  // ═════════════════════════════════════════════════════════

  // Construye el stream unificado de movimientos, replicando
  // js/kardex.js:buildMovimientos (líneas 118-402). No muta
  // ningún global; devuelve el array.
  function buildKxMovimientos(src) {
    var movs = [];

    // Pedidos — SALIDA por cada entrega parseada de Remisiones
    (src.pedidos || []).forEach(function(p) {
      var cantE = Number(p.Cant_Entregada) || 0;
      if (cantE <= 0) return;
      var est2 = (p.Estado_2 || '').trim();
      if (est2 === 'Anulado') return;
      var empresa = p.Nombre_Empresa || '';
      var producto = _normProd(p.Producto);
      var presentacion = p.Presentacion || '';
      var remStr = (p.Remisiones || '').trim();
      if (!remStr) return;
      var hasStructured = remStr.indexOf('|') >= 0;
      if (hasStructured) {
        remStr.split(',').forEach(function(seg) {
          seg = seg.trim();
          if (!seg) return;
          var parts = seg.split('|');
          var rem = (parts[0] || '').trim();
          if (!rem) return;
          var cant = Number(parts[1]) || 0;
          var fecha = parts[2] || p.Fecha_Ult_Entrega || p.Fecha_Pedido || '';
          if (cant <= 0) return;
          movs.push({
            fecha: fecha, tipo: 'Salida', modulo: 'Pedidos',
            remision: rem, empresa: empresa, producto: producto,
            presentacion: presentacion, cantidad: cant
          });
        });
      } else {
        movs.push({
          fecha: p.Fecha_Ult_Entrega || p.Fecha_Pedido || '',
          tipo: 'Salida', modulo: 'Pedidos', remision: remStr,
          empresa: empresa, producto: producto,
          presentacion: presentacion, cantidad: cantE
        });
      }
    });

    // Ingresos — ENTRADA destino siempre; SALIDA origen salvo Cachipay/Planta/misma empresa
    (src.ingresos || []).forEach(function(ing) {
      var cant = Number(ing.Cantidad) || 0;
      if (cant <= 0) return;
      var origenLc = (ing.Origen || '').toLowerCase();
      var esCachipay = origenLc.indexOf('cachipay') >= 0 || origenLc.indexOf('proveedor') >= 0;
      var esPlantaOrigen = _esOrigenPlanta(ing.Origen);
      if (ing.Empresa_Destino) {
        movs.push({
          fecha: ing.Fecha || '', tipo: 'Entrada', modulo: 'Ingresos',
          remision: ing.Remision_Destino || '',
          empresa: ing.Empresa_Destino, producto: _normProd(ing.Producto),
          presentacion: ing.Presentacion || '', cantidad: cant
        });
      }
      var skipSalida = esCachipay || (_empresaTienePlanta(ing.Empresa_Origen) && esPlantaOrigen);
      if (ing.Empresa_Origen && !skipSalida && ing.Empresa_Origen !== ing.Empresa_Destino) {
        movs.push({
          fecha: ing.Fecha || '', tipo: 'Salida', modulo: 'Ingresos',
          remision: ing.Remision_Origen || '',
          empresa: ing.Empresa_Origen, producto: _normProd(ing.Producto),
          presentacion: ing.Presentacion || '', cantidad: cant
        });
      }
    });

    // Devoluciones — ENTRADA (excluye Bodega NC)
    (src.devoluciones || []).forEach(function(d) {
      var estado = (d.Estado || '').toLowerCase();
      if (estado === 'anulado' || estado === 'pendiente') return;
      var cant = Number(d.Cant_Entregada || d.Cantidad) || 0;
      if (cant <= 0) return;
      var bodegaIng = (d.Bodega_Ingreso || '').trim();
      if (bodegaIng === 'Producto No Conforme') return;
      movs.push({
        fecha: d.Fecha_Devolucion || d.Fecha || '', tipo: 'Entrada',
        modulo: 'Devoluciones', remision: d.Remision || d.Remision_Ingreso || '',
        empresa: d.Empresa || '', producto: _normProd(d.Producto),
        presentacion: d.Presentacion || '', cantidad: cant
      });
    });

    // Devoluciones — SALIDA desde Productos Buenos (cuando hay remisión de salida)
    (src.devoluciones || []).forEach(function(d) {
      var estado = (d.Estado || '').toLowerCase();
      if (estado === 'anulado' || estado === 'pendiente') return;
      var cant = Number(d.Cant_Entregada || d.Cantidad) || 0;
      if (cant <= 0) return;
      var remSal = String(d.Remision_Salida || '').trim();
      if (!remSal) return;
      var bodegaSal = (d.Bodega_Salida || '').trim();
      if (bodegaSal !== 'Productos Buenos' && bodegaSal !== 'Producto Terminado') return;
      movs.push({
        fecha: d.Fecha_Salida || d.Fecha_Devolucion || d.Fecha || '', tipo: 'Salida',
        modulo: 'Devoluciones', remision: remSal,
        empresa: d.Empresa || '', producto: _normProd(d.Producto),
        presentacion: d.Presentacion || '', cantidad: cant
      });
    });

    // Cambios — agrupar para detectar si hay líneas ENTREGAR
    var _cGrp = {}, _cTE = {};
    (src.cambios || []).forEach(function(c) {
      var gk = (c.Empresa || '') + '||' + (c.Consecutivo || c.id);
      if (!_cGrp[gk]) _cGrp[gk] = [];
      _cGrp[gk].push(c);
    });
    Object.keys(_cGrp).forEach(function(gk) {
      _cTE[gk] = _cGrp[gk].some(function(l) { return l.Tipo_Linea === 'ENTREGAR'; });
    });

    // Cambios de Mercancía — ENTRADA (CAMBIAR a bodega buena, cerrado)
    (src.cambios || []).forEach(function(c) {
      if (c.Tipo_Linea !== 'CAMBIAR') return;
      var cant = Number(c.Cantidad) || 0;
      if (cant <= 0) return;
      var estado = (c.Estado || '').toLowerCase();
      if (estado !== 'cerrado' && estado !== 'cerrada') return;
      var bodegaIng = (c.Bodega_Ingreso || 'Productos Buenos').trim();
      if (bodegaIng !== 'Productos Buenos' && bodegaIng !== 'Producto Terminado') return;
      var rem = String(c.Remision_Ingreso || '').trim();
      if (!rem) return;
      movs.push({
        fecha: c.Fecha_Ingreso || c.Fecha_Solicitud || '', tipo: 'Entrada',
        modulo: 'Cambios', remision: rem,
        empresa: c.Empresa || '', producto: _normProd(c.Producto),
        presentacion: c.Presentacion || '', cantidad: cant
      });
    });

    // Cambios de Mercancía — SALIDA (ENTREGAR, o CAMBIAR si no hay ENTREGAR — mismo producto)
    (src.cambios || []).forEach(function(c) {
      var gk = (c.Empresa || '') + '||' + (c.Consecutivo || c.id);
      var tieneEntregar = _cTE[gk];
      if (tieneEntregar && c.Tipo_Linea !== 'ENTREGAR') return;
      if (!tieneEntregar && c.Tipo_Linea !== 'CAMBIAR') return;
      var cant = Number(c.Cantidad) || 0;
      if (cant <= 0) return;
      var estado = (c.Estado || '').toLowerCase();
      if (estado !== 'cerrado' && estado !== 'cerrada') return;
      var bodegaSal = (c.Bodega_Salida || 'Productos Buenos').trim();
      if (bodegaSal !== 'Productos Buenos' && bodegaSal !== 'Producto Terminado') return;
      var rem = String(c.Remision_Salida || '').trim();
      if (!rem) return;
      movs.push({
        fecha: c.Fecha_Salida || c.Fecha_Solicitud || '', tipo: 'Salida',
        modulo: 'Cambios', remision: rem,
        empresa: c.Empresa || '', producto: _normProd(c.Producto),
        presentacion: c.Presentacion || '', cantidad: cant
      });
    });

    // Órdenes de Compra — ENTRADA destino + SALIDA origen
    // (misma lógica que kardex.js: requiere Remision para procesar)
    (src.ordenes || []).forEach(function(oc) {
      var cant = Number(oc.Cantidad) || 0;
      if (cant <= 0) return;
      var rem = String(oc.Remision || '').trim();
      if (!rem) return;
      if (oc.Empresa_Destino) {
        movs.push({
          fecha: oc.Fecha || '', tipo: 'Entrada', modulo: 'Órdenes de Compra',
          remision: rem, empresa: oc.Empresa_Destino,
          producto: _normProd(oc.Producto),
          presentacion: oc.Presentacion || '', cantidad: cant
        });
      }
      if (oc.Empresa_Origen && oc.Empresa_Origen !== oc.Empresa_Destino) {
        movs.push({
          fecha: oc.Fecha || '', tipo: 'Salida', modulo: 'Órdenes de Compra',
          remision: rem, empresa: oc.Empresa_Origen,
          producto: _normProd(oc.Producto),
          presentacion: oc.Presentacion || '', cantidad: cant
        });
      }
    });

    // Muestras — SALIDA
    (src.muestras || []).forEach(function(m) {
      var cantE = Number(m.Cant_Entregada);
      var cant = (isNaN(cantE) || cantE === 0) ? 0 : cantE;
      if (cant <= 0) return;
      var rem = String(m.Remision || '').trim();
      if (!rem) return;
      movs.push({
        fecha: m.Fecha_Despacho || m.Fecha_Entrega || m.Fecha_Solicitud || '',
        tipo: 'Salida', modulo: 'Muestras', remision: rem,
        empresa: m.Empresa || '', producto: _normProd(m.Producto),
        presentacion: m.Presentacion || '', cantidad: cant
      });
    });

    // Reenvases (Producción) — SALIDA (solo Producto Terminado)
    (src.reenvases || []).forEach(function(re) {
      var bodega = re.Bodega || 'Productos Buenos';
      if (bodega !== 'Productos Buenos' && bodega !== 'Producto Terminado') return;
      var cant = Number(re.Cantidad) || 0;
      if (cant <= 0) return;
      var rem = String(re.Remision || '').trim();
      if (!rem) return;
      var esTraslado = !!(re.Empresa_Destino);
      movs.push({
        fecha: re.Fecha || '', tipo: 'Salida', modulo: esTraslado ? 'Traslado' : 'Producción',
        remision: rem, empresa: re.Empresa || '',
        producto: _normProd(re.Producto),
        presentacion: re.Presentacion || '', cantidad: cant
      });
      if (esTraslado) {
        movs.push({
          fecha: re.Fecha || '', tipo: 'Entrada', modulo: 'Traslado',
          remision: String(re.Remision_Destino || '').trim() || rem, empresa: re.Empresa_Destino,
          producto: _normProd(re.Producto),
          presentacion: re.Presentacion || '', cantidad: cant
        });
      }
    });

    // Ingresos a Bodega NC — SALIDA (excepto devoluciones de cliente)
    (src.ajustesNC || []).forEach(function(a) {
      if (a.Tipo !== 'Ingreso_NC') return;
      if (_NC_MOTIVOS_IGNORAR_SALIDA[a.Motivo]) return;
      var cant = Number(a.Cantidad) || 0;
      if (cant <= 0) return;
      movs.push({
        fecha: a.Fecha || '', tipo: 'Salida', modulo: 'Bodega NC',
        remision: a.Remision || '', empresa: a.Empresa || '',
        producto: _normProd(a.Producto),
        presentacion: a.Presentacion || '', cantidad: cant
      });
    });

    // Ajustes manuales y Saldos Iniciales
    (src.ajustes || []).forEach(function(a) {
      var cant = Number(a.Cantidad) || 0;
      if (cant <= 0) return;
      var tipo = a.Tipo || '';
      var esTipo, modulo;
      if (tipo === 'Saldo_Inicial') { esTipo = 'Entrada'; modulo = 'Saldo Inicial'; }
      else if (tipo === 'Ajuste_Sobrante') { esTipo = 'Entrada'; modulo = 'Ajuste'; }
      else if (tipo === 'Ajuste_Faltante') { esTipo = 'Salida'; modulo = 'Ajuste'; }
      else return;
      movs.push({
        fecha: a.Fecha || '', tipo: esTipo, modulo: modulo,
        remision: '', empresa: a.Empresa || '',
        producto: _normProd(a.Producto),
        presentacion: a.Presentacion || '', cantidad: cant
      });
    });

    // Regla global: sin remisión solo se admite Saldo Inicial
    movs = movs.filter(function(m) {
      if (m.modulo === 'Saldo Inicial') return true;
      return !!(m.remision && String(m.remision).trim());
    });

    return movs;
  }

  // Suma Entrada/Salida por (producto, empresa) a partir de la
  // fecha del Saldo Inicial más antiguo. Idéntico a
  // js/kardex.js:calcularExistencias (líneas 1974-2010).
  function computeSaldosPorEmpresa(kxMovimientos) {
    var saldos = {}; // producto → { empresa: cantidad }

    var fechaCorte = null;
    kxMovimientos.forEach(function(m) {
      if (m.modulo === 'Saldo Inicial' && m.fecha) {
        if (!fechaCorte || m.fecha < fechaCorte) fechaCorte = m.fecha;
      }
    });

    kxMovimientos.forEach(function(m) {
      if (!m.producto || !m.empresa) return;
      if (fechaCorte && m.fecha < fechaCorte) return;
      var prodKey = m.producto;
      if (!saldos[prodKey]) saldos[prodKey] = {};
      if (typeof saldos[prodKey][m.empresa] === 'undefined') {
        saldos[prodKey][m.empresa] = 0;
      }
      if (m.tipo === 'Entrada') saldos[prodKey][m.empresa] += m.cantidad;
      else                       saldos[prodKey][m.empresa] -= m.cantidad;
    });

    return saldos;
  }

  // Carga las 9 fuentes que necesita el cálculo Kardex.
  async function loadSnapshot() {
    if (typeof _authReady !== 'undefined') {
      try { await _authReady; } catch(e) {}
    }
    var res = await Promise.all([
      apiGet('getPedidos',     { columns: 'Nombre_Empresa,Cant_Entregada,Estado_2,Producto,Presentacion,Remisiones,Fecha_Ult_Entrega,Fecha_Pedido' })
        .catch(function() { return { ok: true, pedidos: [] }; }),
      apiGet('getIngresos',    { columns: 'Cantidad,Origen,Empresa_Destino,Empresa_Origen,Fecha,Remision_Destino,Remision_Origen,Producto,Presentacion' })
        .catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Cantidad,Remision,Remision_Origen,Empresa_Destino,Empresa_Origen,Fecha,Producto,Presentacion,Estado,Tipo,Bodega' })
        .catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras',    { columns: 'Cant_Entregada,Remision,Fecha_Despacho,Fecha_Entrega,Fecha_Solicitud,Empresa,Producto,Presentacion' })
        .catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases',   { columns: 'Empresa,Empresa_Destino,Bodega,Cantidad,Remision,Remision_Destino,Fecha,Producto,Presentacion' })
        .catch(function() { return { ok: true, reenvases: [] }; }),
      apiGet('getDevoluciones',{ columns: 'Cant_Entregada,Cantidad,Estado,Bodega_Ingreso,Fecha_Devolucion,Fecha,Remision,Remision_Ingreso,Empresa,Producto,Presentacion' })
        .catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getKardexAjustes', { columns: 'id,Cantidad,Tipo,Fecha,Empresa,Producto,Presentacion' })
        .catch(function() { return { ok: true, ajustes: [] }; }),
      apiGet('getKardexNC',    { columns: 'id,Cantidad,Tipo,Motivo,Fecha,Remision,Empresa,Producto,Presentacion' })
        .catch(function() { return { ok: true, ajustesNC: [] }; }),
      apiGet('getCambios',     { columns: 'Tipo_Linea,Cantidad,Estado,Remision_Salida,Fecha_Salida,Fecha_Solicitud,Empresa,Producto,Bodega_Salida' })
        .catch(function() { return { ok: true, cambios: [] }; })
    ]);

    var sources = {
      pedidos:      (res[0].pedidos      || []).filter(function(p) {
        return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente';
      }),
      ingresos:     res[1].ingresos      || [],
      ordenes:      res[2].ordenes       || [],
      muestras:     res[3].muestras      || [],
      reenvases:    res[4].reenvases     || [],
      devoluciones: res[5].devoluciones  || [],
      ajustes:      res[6].ajustes       || [],
      ajustesNC:    res[7].ajustesNC     || [],
      cambios:      res[8].cambios       || []
    };

    var kxMovs = buildKxMovimientos(sources);
    var saldos = computeSaldosPorEmpresa(kxMovs);

    return { sources: sources, kxMovimientos: kxMovs, saldos: saldos };
  }

  // Devuelve [{empresa, sigla, disponible}] ordenado por sigla,
  // filtrado por las empresas visibles al usuario (AUTH), sólo con
  // disponible > 0.
  function getPorEmpresa(snapshot, producto /*, presentacion — ignorado */) {
    if (!snapshot || !snapshot.saldos) return [];
    var prodKey = _normProd(producto);
    var perEmp = snapshot.saldos[prodKey] || {};

    var visibles = (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas)
      ? AUTH.getFilteredEmpresas(EMPRESAS_HOLDING)
      : EMPRESAS_HOLDING;
    var permitidas = {};
    visibles.forEach(function(e) { permitidas[e.value] = true; });

    var out = [];
    Object.keys(perEmp).forEach(function(emp) {
      if (!permitidas[emp]) return;
      var disp = perEmp[emp] || 0;
      if (disp <= 0) return;
      out.push({
        empresa: emp,
        sigla: (typeof getSigla === 'function') ? getSigla(emp) : emp,
        disponible: disp
      });
    });
    out.sort(function(a, b) { return a.sigla.localeCompare(b.sigla, 'es'); });
    return out;
  }

  function getPorEmpresaEspecifica(snapshot, empresa, producto) {
    if (!snapshot || !snapshot.saldos) return 0;
    var prodKey = _normProd(producto);
    var perEmp = snapshot.saldos[prodKey] || {};
    return perEmp[empresa] || 0;
  }


  // ═════════════════════════════════════════════════════════
  // API B) INVENTARIO — compatibilidad con inventario.js
  // ═════════════════════════════════════════════════════════
  //
  // Estas funciones consumen las variables globales de inventario.js
  // (inventario, pedidos, reenvasesInv, etc.) y NO cambian su
  // comportamiento previo. Mantienen la lógica original basada en
  // la tabla Inventario + módulos de movimientos, con la resta del
  // "comprometido" (pedidos pendientes) que el módulo Inventario
  // usa para pintar su columna "Disponible".

  function _computeComprometido_Inv(pedidos) {
    var comp = {};
    (pedidos || []).forEach(function(p) {
      var prod = _norm(p.Producto);
      if (!prod) return;
      var pedida = Number(p.Cantidad) || 0;
      var entregada = Number(p.Cant_Entregada) || 0;
      var pendiente = Math.max(0, pedida - entregada);
      var estado2 = (p.Estado_2 || '').toLowerCase();
      if (estado2 === 'cerrado' || estado2 === 'alistado' ||
          estado2 === 'anulado' || estado2 === 'bloqueado por cartera') return;
      if (!comp[prod]) comp[prod] = 0;
      comp[prod] += pendiente;
    });
    return comp;
  }

  function _computeMovimientos_Inv(sources) {
    var mov = {};
    function add(empresa, producto, cantidad) {
      var prod = _norm(producto);
      if (!prod) return;
      var key = _norm(empresa) + '||' + prod;
      if (!mov[key]) mov[key] = 0;
      mov[key] += cantidad;
    }
    (sources.reenvases || []).forEach(function(re) {
      if (!_esBueno(re.Bodega || 'Productos Buenos')) return;
      var cant = Number(re.Cantidad) || 0;
      add(re.Empresa, re.Producto, -cant);
      if (re.Empresa_Destino) add(re.Empresa_Destino, re.Producto, cant);
    });
    (sources.muestras || []).forEach(function(m) {
      var cant = Number(m.Cant_Entregada) || 0;
      if (cant <= 0) return;
      add(m.Empresa, m.Producto, -cant);
    });
    (sources.ingresos || []).forEach(function(ing) {
      var cant = Number(ing.Cantidad) || 0;
      if (cant <= 0) return;
      if (ing.Empresa_Origen)  add(ing.Empresa_Origen,  ing.Producto, -cant);
      if (ing.Empresa_Destino) add(ing.Empresa_Destino, ing.Producto,  cant);
    });
    (sources.ordenes || []).forEach(function(oc) {
      if ((oc.Estado || '').toLowerCase() === 'anulada') return;
      var cant = Number(oc.Cantidad) || 0;
      if (cant <= 0) return;
      var remDest = String(oc.Remision || '').trim();
      var remOrig = String(oc.Remision_Origen || '').trim();
      if (!remDest && !remOrig) return;
      var tipo = (oc.Tipo || 'Compra');
      if (tipo === 'Traslado') {
        if (remOrig && oc.Empresa_Origen)  add(oc.Empresa_Origen,  oc.Producto, -cant);
        if (remDest && oc.Empresa_Destino) add(oc.Empresa_Destino, oc.Producto,  cant);
      } else {
        if (remOrig && oc.Empresa_Origen && oc.Empresa_Origen !== oc.Empresa_Destino) {
          add(oc.Empresa_Origen, oc.Producto, -cant);
        }
        if (remDest && _esBueno(oc.Bodega)) {
          add(oc.Empresa_Destino, oc.Producto, cant);
        }
      }
    });
    (sources.devoluciones || []).forEach(function(d) {
      if ((d.Estado || '').toLowerCase() !== 'tramitada') return;
      var cant = Number(d.Cantidad) || 0;
      if (cant <= 0) return;
      if (String(d.Remision_Ingreso || '').trim() && _esBueno(d.Bodega_Ingreso)) {
        add(d.Empresa, d.Producto, cant);
      }
      if (String(d.Remision_Salida || '').trim() && _esBueno(d.Bodega_Salida)) {
        add(d.Empresa, d.Producto, -cant);
      }
    });
    var cambiosGrp = {};
    (sources.cambios || []).forEach(function(c) {
      var gk = (c.Empresa || '') + '||' + (c.Consecutivo || c.id);
      if (!cambiosGrp[gk]) cambiosGrp[gk] = [];
      cambiosGrp[gk].push(c);
    });
    Object.keys(cambiosGrp).forEach(function(gk) {
      var lines = cambiosGrp[gk];
      var hdr = lines[0];
      if ((hdr.Estado || '').toLowerCase() !== 'cerrado') return;
      var tieneEntregar = lines.some(function(l) { return l.Tipo_Linea === 'ENTREGAR'; });
      lines.forEach(function(l) {
        var cant = Number(l.Cantidad) || 0;
        if (cant <= 0) return;
        if (l.Tipo_Linea === 'CAMBIAR' && _esBueno(hdr.Bodega_Ingreso)) {
          add(hdr.Empresa, l.Producto, cant);
        }
        if (l.Tipo_Linea === 'ENTREGAR' && _esBueno(hdr.Bodega_Salida)) {
          add(hdr.Empresa, l.Producto, -cant);
        } else if (!tieneEntregar && l.Tipo_Linea === 'CAMBIAR' && _esBueno(hdr.Bodega_Salida)) {
          add(hdr.Empresa, l.Producto, -cant);
        }
      });
    });
    (sources.entregasPedido || []).forEach(function(e) {
      var cant = Number(e.cantidad) || 0;
      if (cant <= 0) return;
      add(e.empresa_stock, e.producto, -cant);
    });
    return mov;
  }

  function _enrichInventarioRows(rows, comprometido, movimientos) {
    (rows || []).forEach(function(r) {
      var prod = _norm(r.Producto);
      var emp = _norm(r.Empresa);
      var stock = Number(r.Cantidad) || 0;
      var comp = comprometido[prod] || 0;
      var m = movimientos[emp + '||' + prod] || 0;
      r._comprometido = comp;
      r._movimientos = m;
      r._disponible = stock - comp + m;
    });
    return rows;
  }


  // ═════════════════════════════════════════════════════════
  // Exportar
  // ═════════════════════════════════════════════════════════

  async function debugProducto(filtro) {
    var snap = await loadSnapshot();
    var movs = snap.kxMovimientos;
    var f = (filtro || '').toUpperCase();
    var encontrados = movs.filter(function(m) {
      return m.producto && m.producto.toUpperCase().indexOf(f) >= 0;
    });
    var porEmpresa = {};
    encontrados.forEach(function(m) {
      var k = m.empresa;
      if (!porEmpresa[k]) porEmpresa[k] = { entradas: [], salidas: [], saldo: 0 };
      if (m.tipo === 'Entrada') {
        porEmpresa[k].entradas.push(m);
        porEmpresa[k].saldo += m.cantidad;
      } else {
        porEmpresa[k].salidas.push(m);
        porEmpresa[k].saldo -= m.cantidad;
      }
    });
    console.log('=== DEBUG Existencias (' + filtro + ') ===');
    console.log('Total movimientos:', encontrados.length);
    Object.keys(porEmpresa).sort().forEach(function(emp) {
      var d = porEmpresa[emp];
      console.log('\n--- ' + emp + ' --- Saldo: ' + d.saldo);
      console.log('Entradas (' + d.entradas.length + '):');
      d.entradas.forEach(function(m) {
        console.log('  +' + m.cantidad, m.modulo, m.remision, m.fecha);
      });
      console.log('Salidas (' + d.salidas.length + '):');
      d.salidas.forEach(function(m) {
        console.log('  -' + m.cantidad, m.modulo, m.remision, m.fecha);
      });
    });
    console.log('\nSaldos snapshot:', snap.saldos[_normProd(filtro)] || 'No encontrado (busca nombre exacto)');
    return porEmpresa;
  }

  global.Existencias = {
    loadSnapshot: loadSnapshot,
    getPorEmpresa: getPorEmpresa,
    getPorEmpresaEspecifica: getPorEmpresaEspecifica,
    buildKxMovimientos: buildKxMovimientos,
    computeSaldosPorEmpresa: computeSaldosPorEmpresa,
    debug: debugProducto
  };

  // Compatibilidad con inventario.js (globals antiguos).
  global.computeComprometido = function() {
    return _computeComprometido_Inv(typeof pedidos !== 'undefined' ? pedidos : []);
  };
  global.computeMovimientos = function() {
    return _computeMovimientos_Inv({
      reenvases:      typeof reenvasesInv     !== 'undefined' ? reenvasesInv     : [],
      ingresos:       typeof ingresosInv      !== 'undefined' ? ingresosInv      : [],
      muestras:       typeof muestrasInv      !== 'undefined' ? muestrasInv      : [],
      devoluciones:   typeof devolucionesInv  !== 'undefined' ? devolucionesInv  : [],
      cambios:        typeof cambiosMercInv   !== 'undefined' ? cambiosMercInv   : [],
      ordenes:        typeof ordenesCompraInv !== 'undefined' ? ordenesCompraInv : [],
      entregasPedido: typeof entregasPedidoInv !== 'undefined' ? entregasPedidoInv : []
    });
  };
  global.enrichInventario = function() {
    var comp = global.computeComprometido();
    var mov = global.computeMovimientos();
    _enrichInventarioRows(typeof inventario !== 'undefined' ? inventario : [], comp, mov);
  };
})(window);
