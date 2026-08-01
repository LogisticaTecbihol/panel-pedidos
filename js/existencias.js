// ============================================================
// js/existencias.js
//
// Módulo compartido para calcular existencias disponibles por
// empresa/producto. Antes vivía dentro de js/inventario.js; se
// extrae aquí para que pedidos.js también pueda consultarlo al
// registrar entregas de pedido.
//
// Fuentes de movimientos consideradas:
//   • Reenvases         → salida de producto
//   • Muestras          → salida (Cant_Entregada)
//   • Ingresos          → transferencia inter-empresa (bilateral)
//   • OrdenesCompra
//       ▸ Tipo='Compra'   → entrada al destino cuando hay Remisión
//       ▸ Tipo='Traslado' → transferencia inter-empresa (bilateral)
//                          cuando hay Remisión
//   • Devoluciones      → según Remision_Ingreso/Salida y bodega
//   • CambiosMercancia  → según Tipo_Linea y bodega, sólo cerrados
//   • EntregasPedido    → salida desde empresa_stock (siempre resta,
//                          la fila sólo existe cuando ya hay remisión)
// ============================================================

(function(global) {
  'use strict';

  // ── Utilidades ────────────────────────────────────────────
  function _norm(s) {
    if (typeof norm === 'function') return norm(s);
    return String(s || '').toLowerCase().trim();
  }

  function _esBueno(bodega) {
    var b = (bodega || '').toLowerCase().trim();
    return b !== 'producto no conforme';
  }

  // ── Cálculo de comprometido (pendientes de entrega) ───────
  function computeComprometido(pedidos) {
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

  // ── Cálculo de movimientos netos por empresa+producto ─────
  function computeMovimientos(sources) {
    var mov = {};
    function add(empresa, producto, cantidad) {
      var prod = _norm(producto);
      if (!prod) return;
      var key = _norm(empresa) + '||' + prod;
      if (!mov[key]) mov[key] = 0;
      mov[key] += cantidad;
    }

    // 1. Reenvases (Salidas a producción) — producto sale → restar
    (sources.reenvases || []).forEach(function(re) {
      if (!_esBueno(re.Bodega || 'Productos Buenos')) return;
      add(re.Empresa, re.Producto, -(Number(re.Cantidad) || 0));
    });

    // 2. Muestras despachadas — producto sale → restar cant entregada
    (sources.muestras || []).forEach(function(m) {
      var cant = Number(m.Cant_Entregada) || 0;
      if (cant <= 0) return;
      add(m.Empresa, m.Producto, -cant);
    });

    // 3. Ingresos (transferencias) — sale de origen, entra a destino
    (sources.ingresos || []).forEach(function(ing) {
      var cant = Number(ing.Cantidad) || 0;
      if (cant <= 0) return;
      if (ing.Empresa_Origen)  add(ing.Empresa_Origen,  ing.Producto, -cant);
      if (ing.Empresa_Destino) add(ing.Empresa_Destino, ing.Producto,  cant);
    });

    // 4. Órdenes de compra
    (sources.ordenes || []).forEach(function(oc) {
      if ((oc.Estado || '').toLowerCase() === 'anulada') return;
      if (!String(oc.Remision || '').trim()) return;
      var cant = Number(oc.Cantidad) || 0;
      if (cant <= 0) return;
      var tipo = (oc.Tipo || 'Compra');
      if (tipo === 'Traslado') {
        // Transferencia inter-empresa: sale de origen, entra a destino
        if (oc.Empresa_Origen)  add(oc.Empresa_Origen,  oc.Producto, -cant);
        if (oc.Empresa_Destino) add(oc.Empresa_Destino, oc.Producto,  cant);
      } else {
        // Compra a proveedor externo: sólo entra al destino
        if (!_esBueno(oc.Bodega)) return;
        add(oc.Empresa_Destino, oc.Producto, cant);
      }
    });

    // 5. Devoluciones tramitadas
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

    // 6. Cambios de mercancía cerrados
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
      lines.forEach(function(l) {
        var cant = Number(l.Cantidad) || 0;
        if (cant <= 0) return;
        if (l.Tipo_Linea === 'CAMBIAR' && _esBueno(hdr.Bodega_Ingreso)) {
          add(hdr.Empresa, l.Producto, cant);
        } else if (l.Tipo_Linea === 'ENTREGAR' && _esBueno(hdr.Bodega_Salida)) {
          add(hdr.Empresa, l.Producto, -cant);
        }
      });
    });

    // 7. Entregas de pedido — sale desde la empresa que aportó el stock
    (sources.entregasPedido || []).forEach(function(e) {
      var cant = Number(e.cantidad) || 0;
      if (cant <= 0) return;
      add(e.empresa_stock, e.producto, -cant);
    });

    return mov;
  }

  // ── Enriquecer filas de Inventario con _disponible ────────
  function enrichInventarioRows(rows, comprometido, movimientos) {
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

  // ── Snapshot: carga todo lo necesario en paralelo ─────────
  // Devuelve { inventario, pedidos, sources, comprometido, movimientos }
  // Usado por pedidos.js para poblar el selector de existencias.
  async function loadSnapshot(opts) {
    opts = opts || {};
    if (typeof _authReady !== 'undefined') {
      try { await _authReady; } catch(e) {}
    }

    var promises = [
      apiGet('getInventario', {
        columns: 'id,Fecha,Empresa,Producto,Presentacion,Unidad_Medida,Cantidad_Caja,Lote,Cantidad,Observaciones'
      }),
      apiGet('getPedidos', { columns: 'Producto,Cantidad,Cant_Entregada,Estado_2' }),
      apiGet('getReenvases',   { columns: 'Bodega,Empresa,Producto,Cantidad' })
        .catch(function() { return { ok: true, reenvases: [] }; }),
      apiGet('getIngresos',    { columns: 'Cantidad,Empresa_Origen,Empresa_Destino,Producto' })
        .catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getMuestras',    { columns: 'Cant_Entregada,Empresa,Producto' })
        .catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getDevoluciones',{ columns: 'Estado,Cantidad,Remision_Ingreso,Bodega_Ingreso,Remision_Salida,Bodega_Salida,Empresa,Producto' })
        .catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getCambios',     { columns: 'id,Empresa,Consecutivo,Estado,Cantidad,Tipo_Linea,Producto,Bodega_Ingreso,Bodega_Salida' })
        .catch(function() { return { ok: true, cambios: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Estado,Remision,Bodega,Cantidad,Empresa_Origen,Empresa_Destino,Producto,Tipo' })
        .catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getEntregasPedido', {
        columns: 'id,pedido_id,empresa_pedido,empresa_stock,producto,presentacion,cantidad,remision,fecha'
      }).catch(function() { return { ok: true, entregas: [] }; })
    ];

    var res = await Promise.all(promises);

    var dataInv = res[0];
    if (!dataInv.ok) throw new Error(dataInv.error || 'Error al cargar inventario');

    var inventario = (dataInv.inventario || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0, 10);
      return r;
    });
    var pedidos = res[1].ok ? (res[1].pedidos || []) : [];

    var sources = {
      reenvases:       res[2].reenvases      || [],
      ingresos:        res[3].ingresos       || [],
      muestras:        res[4].muestras       || [],
      devoluciones:    res[5].devoluciones   || [],
      cambios:         res[6].cambios        || [],
      ordenes:         res[7].ordenes        || [],
      entregasPedido:  res[8].entregas       || []
    };

    var comprometido = computeComprometido(pedidos);
    var movimientos = computeMovimientos(sources);
    enrichInventarioRows(inventario, comprometido, movimientos);

    return {
      inventario: inventario,
      pedidos: pedidos,
      sources: sources,
      comprometido: comprometido,
      movimientos: movimientos
    };
  }

  // ── Consultas de alto nivel ───────────────────────────────
  //
  // Devuelve un array [{empresa, sigla, disponible}] con las empresas
  // del holding (según los filtros de AUTH) que tienen disponible > 0
  // para ese producto+presentación.
  function getPorEmpresa(snapshot, producto, presentacion) {
    if (!snapshot) return [];
    var prod = _norm(producto);
    var pres = _norm(presentacion || '');
    var porEmpresa = {}; // empresa (nombre completo) → cantidad base
    (snapshot.inventario || []).forEach(function(r) {
      if (_norm(r.Producto) !== prod) return;
      if (pres && _norm(r.Presentacion || '') !== pres) return;
      var emp = r.Empresa || '';
      if (!emp) return;
      if (porEmpresa[emp] == null) porEmpresa[emp] = 0;
      porEmpresa[emp] += Number(r.Cantidad) || 0;
    });

    // Sumar movimientos (comprometido es global por producto,
    // aplica a todas las empresas por igual sólo si hay stock)
    var comp = (snapshot.comprometido || {})[prod] || 0;
    var mov = snapshot.movimientos || {};

    var empresasFiltro = (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas)
      ? AUTH.getFilteredEmpresas(EMPRESAS_HOLDING)
      : EMPRESAS_HOLDING;
    var permitidas = {};
    empresasFiltro.forEach(function(e) { permitidas[e.value] = true; });

    var out = [];
    Object.keys(porEmpresa).forEach(function(emp) {
      if (!permitidas[emp]) return;
      var m = mov[_norm(emp) + '||' + prod] || 0;
      // Nota: el "comprometido" (pendientes de entrega) es un pool
      // global por producto, no por empresa. Para el selector de
      // stock lo ignoramos: mostramos lo que realmente hay disponible
      // como material físico en cada empresa (stock + movimientos).
      var disponible = porEmpresa[emp] + m;
      if (disponible > 0) {
        out.push({
          empresa: emp,
          sigla: (typeof getSigla === 'function') ? getSigla(emp) : emp,
          disponible: disponible
        });
      }
    });

    // También considerar empresas sin fila en Inventario pero con
    // movimientos positivos (entradas por traslado sin base histórica)
    Object.keys(mov).forEach(function(key) {
      var parts = key.split('||');
      if (parts[1] !== prod) return;
      var empNorm = parts[0];
      var m = mov[key] || 0;
      if (m <= 0) return;
      // Buscar el nombre completo en EMPRESAS_HOLDING
      var full = null;
      EMPRESAS_HOLDING.forEach(function(e) {
        if (_norm(e.value) === empNorm) full = e.value;
      });
      if (!full || !permitidas[full]) return;
      if (out.some(function(o) { return o.empresa === full; })) return;
      out.push({
        empresa: full,
        sigla: (typeof getSigla === 'function') ? getSigla(full) : full,
        disponible: m
      });
    });

    // Ordenar por sigla
    out.sort(function(a, b) { return a.sigla.localeCompare(b.sigla, 'es'); });
    return out;
  }

  function getPorEmpresaEspecifica(snapshot, empresa, producto, presentacion) {
    var lista = getPorEmpresa(snapshot, producto, presentacion);
    for (var i = 0; i < lista.length; i++) {
      if (_norm(lista[i].empresa) === _norm(empresa)) return lista[i].disponible;
    }
    return 0;
  }

  // ── Exportar API pública ──────────────────────────────────
  global.Existencias = {
    loadSnapshot: loadSnapshot,
    computeComprometido: computeComprometido,
    computeMovimientos: computeMovimientos,
    enrichInventarioRows: enrichInventarioRows,
    getPorEmpresa: getPorEmpresa,
    getPorEmpresaEspecifica: getPorEmpresaEspecifica
  };

  // Compatibilidad: para minimizar el diff en js/inventario.js
  // exponemos también las funciones antiguas como globales. Toman
  // los datos desde las variables globales del módulo Inventario
  // (inventario, pedidos, reenvasesInv, etc.).
  global.computeComprometido = function() {
    return computeComprometido(typeof pedidos !== 'undefined' ? pedidos : []);
  };
  global.computeMovimientos = function() {
    return computeMovimientos({
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
    enrichInventarioRows(typeof inventario !== 'undefined' ? inventario : [], comp, mov);
  };
})(window);
