// ── OC de IASO a PARCELAR vistas como pedidos (solo consulta) ──
// Para los usuarios cuya única empresa es PARCELAR (AUTH.verPedidosIASO), las
// órdenes de compra que IASO le hace a PARCELAR (OrdenesCompra: Empresa_Destino =
// IASO, Empresa_Origen = PARCELAR) se ven como pedidos de un cliente llamado IASO:
//   · pestaña «Pedidos IASO» del módulo Pedidos (este archivo pinta la tabla), y
//   · sus remisiones de salida en la pestaña Despachos (pedidos.js llama a despachos()).
//
// Es solo visualización: lo único que hace contra la base es un SELECT acotado a
// OrdenesCompra. No escribe en ninguna tabla, no se mezcla con el arreglo `pedidos`
// de pedidos.js (lista, filtros, KPIs y OTD no cambian) y no toca inventarios ni
// movimientos: el stock sigue moviéndose solo por las remisiones de la OC, que
// Kardex/Existencias leen directamente de OrdenesCompra.
//
// Reglas de lectura de las OC (datos reales, ver comentarios en agrupar):
//   · Remisión de PARCELAR = Remision_Origen; en las OC antiguas cerradas que solo
//     tienen Remision, se usa esa.
//   · Las OC tipo Compra suelen venir sin Consecutivo: se agrupan por fecha +
//     referencia + remisión y se les arma un consecutivo «OC-<fecha>[-<remisión>]».
//   · La OC no guarda fecha de remisión: se usa la Fecha de la OC.
//   · Las OC no llevan precio (Valor_Total = 0): los totales saldrán en $0.
var OCComoPedido = (function() {
  var EMPRESA = 'PARCELAR DE COLOMBIA SAS';
  var CLIENTE = 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS';
  var COLS = 'id,Fecha,Consecutivo,Tipo,Ref_Pedido,Empresa_Destino,Empresa_Origen,' +
    'Producto,Presentacion,Cantidad,Valor_Unitario,Valor_Total,Bonificado,' +
    'Remision,Remision_Origen,num_factura_origen,fecha_factura_origen,' +
    'Estado,Estado_Aprobacion,Observaciones,Municipio';

  var _promesa = null;               // carga en curso o ya resuelta
  var _datos = null;                 // pedidos agrupados, una vez cargados
  var _orden = [{ col: 'fecha', dir: 'desc' }];
  var _abiertos = {};                // clave del pedido -> detalle desplegado
  var _vista = [];                   // filas mostradas ahora (las que exporta el Excel)
  var _modo = 'pedidos';             // vista activa: 'pedidos' (una fila por OC) | 'detalle' (productos remisionados)
  var _ordenDet = [{ col: 'fecha', dir: 'desc' }, { col: 'remision', dir: 'asc' }];
  var _vistaDet = [];                // líneas remisionadas mostradas ahora

  function _t(v) { return v == null ? '' : String(v).trim(); }
  function _n(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function _f10(v) { return _t(v).slice(0, 10); }

  // Remisión con la que PARCELAR despachó la línea: la de salida; en las OC
  // antiguas ya cerradas solo quedó la de entrada.
  function _remisionDe(r) {
    return _t(r.Remision_Origen) || (_t(r.Estado) === 'Cerrada' ? _t(r.Remision) : '');
  }

  // ── Agrupación: filas de OrdenesCompra (una por producto) → un pedido por OC ──
  // Función pura (sin red ni DOM): recibe las filas y devuelve la lista de pedidos.
  function agrupar(filas) {
    var mapa = {}, lista = [];
    (filas || []).forEach(function(r) {
      // user_has_company deja pasar filas con empresa vacía: se vuelve a filtrar aquí.
      if (_t(r.Empresa_Destino) !== CLIENTE || _t(r.Empresa_Origen) !== EMPRESA) return;
      if (_t(r.Estado) === 'Anulada' || _t(r.Estado_Aprobacion) === 'Rechazada') return;
      var rem = _remisionDe(r);
      var cons = _t(r.Consecutivo);
      var clave = cons
        ? 'C|' + cons + '|' + _f10(r.Fecha) + '|' + _t(r.Ref_Pedido)
        : 'S|' + _f10(r.Fecha) + '|' + _t(r.Ref_Pedido) + '|' + rem;
      var g = mapa[clave];
      if (!g) {
        g = mapa[clave] = {
          clave: clave,
          empresa: EMPRESA,
          cliente: CLIENTE,
          tipo: _t(r.Tipo) || 'Compra',
          consecutivo: cons || ('OC-' + _f10(r.Fecha) + (rem ? '-' + rem : '')),
          fecha: _f10(r.Fecha),
          refIaso: _t(r.Ref_Pedido).replace(CLIENTE, 'IASO'),
          lineas: [],
          observaciones: []
        };
        lista.push(g);
      }
      var cant = _n(r.Cantidad), vu = _n(r.Valor_Unitario);
      g.lineas.push({
        producto: _t(r.Producto),
        presentacion: _t(r.Presentacion),
        cantidad: cant,
        valorUnitario: vu,
        valorTotal: _n(r.Valor_Total) || (cant * vu),
        bonificado: _t(r.Bonificado),
        municipio: _t(r.Municipio),
        remision: rem,
        facturaNum: _t(r.num_factura_origen),
        facturaFecha: _t(r.fecha_factura_origen),
        estadoOC: _t(r.Estado),
        aprobacion: _t(r.Estado_Aprobacion)
      });
      var obs = _t(r.Observaciones);
      if (obs && g.observaciones.indexOf(obs) < 0) g.observaciones.push(obs);
    });
    lista.forEach(_resumir);
    return lista;
  }

  function _resumir(g) {
    var pedida = 0, despachada = 0, total = 0, conRem = 0, facturadas = 0, cerradas = 0, porAprobar = false;
    var rems = [], facs = [];
    g.lineas.forEach(function(l) {
      pedida += l.cantidad;
      total += l.valorTotal;
      if (l.remision) {
        despachada += l.cantidad;
        conRem++;
        if (rems.indexOf(l.remision) < 0) rems.push(l.remision);
      }
      if (l.facturaNum && l.facturaFecha) facturadas++;
      if (l.facturaNum && facs.indexOf(l.facturaNum) < 0) facs.push(l.facturaNum);
      if (l.estadoOC === 'Cerrada') cerradas++;
      if (l.aprobacion === 'Por aprobar') porAprobar = true;
    });
    var n = g.lineas.length;
    g.pedida = pedida;
    g.despachada = despachada;
    g.total = Math.round(total * 100) / 100;
    g.remisiones = rems;
    g.facturas = facs;
    // Mismos nombres de estado que Pedidos (derivedStatus / derivedEstado2).
    g.estado = (conRem === n && facturadas === n) ? 'Facturado'
      : conRem === n ? 'Entregado'
      : conRem > 0 ? 'Parcial' : 'Recibido';
    g.estado2 = porAprobar ? 'Pendiente de aprobación' : (cerradas === n ? 'Cerrado' : 'Abierto');
    g.observacion = g.observaciones.join(' · ');
  }

  // ── Carga (bajo demanda, con caché en memoria) ──
  function cargar() {
    if (!_promesa) {
      _promesa = _fetchAllRows('OrdenesCompra', COLS, function(q) {
        return q.ilike('Empresa_Destino', CLIENTE + '%').ilike('Empresa_Origen', 'PARCELAR%');
      }).then(function(res) {
        if (res.error) throw res.error;
        _datos = agrupar(res.data);
        return _datos;
      });
      _promesa.catch(function() { _promesa = null; });
    }
    return _promesa;
  }

  function invalidar() { _promesa = null; _datos = null; }

  function recargar() { invalidar(); return render(); }

  // Remisiones de salida para la pestaña Despachos: una entrada por remisión, con
  // la misma forma que las que arma buildDespachos (pedidos.js) más `ocVirtual` y
  // la factura de la OC (no se consulta EntregasPedido para ellas).
  function despachos() {
    return cargar().then(function(lista) {
      var salida = [];
      lista.forEach(function(g) {
        var porRem = {};
        g.lineas.forEach(function(l) {
          if (!l.remision) return;
          var d = porRem[l.remision];
          if (!d) {
            d = porRem[l.remision] = {
              empresa: g.empresa, consecutivo: g.consecutivo, cliente: g.cliente,
              remision: l.remision, fecha: g.fecha, valor: 0,
              ocVirtual: true, factura: { num_factura: '', fecha_factura: '' }
            };
            salida.push(d);
          }
          d.valor += l.valorTotal;
          if (l.facturaNum || l.facturaFecha) d.factura = { num_factura: l.facturaNum, fecha_factura: l.facturaFecha };
        });
      });
      salida.forEach(function(d) { d.valor = Math.round(d.valor * 100) / 100; });
      return salida;
    });
  }

  // ── Pestaña «Pedidos IASO» ──
  var COLUMNAS = [
    { id: 'empresa',    label: 'Empresa',        sort: false },
    { id: 'consecutivo', label: 'Consecutivo',   fn: function(g) { return g.consecutivo.toLowerCase(); } },
    { id: 'cliente',    label: 'Cliente',        sort: false },
    { id: 'fecha',      label: 'Fecha Pedido',   fn: function(g) { return g.fecha; } },
    { id: 'lineas',     label: 'Productos',      fn: function(g) { return g.lineas.length; }, num: true },
    { id: 'pedida',     label: 'Cant. Pedida',   fn: function(g) { return g.pedida; }, num: true },
    { id: 'despachada', label: 'Cant. Despachada', fn: function(g) { return g.despachada; }, num: true },
    { id: 'total',      label: 'Total Orden',    fn: function(g) { return g.total; }, num: true },
    { id: 'estado',     label: 'Estado',         fn: function(g) { return g.estado; } },
    { id: 'estado2',    label: 'Estado 2',       fn: function(g) { return g.estado2; } },
    { id: 'remision',   label: 'Remisión',       fn: function(g) { return g.remisiones.join(', ').toLowerCase(); } },
    { id: 'factura',    label: 'N° Factura',     fn: function(g) { return g.facturas.join(', ').toLowerCase(); } }
  ];

  function _val(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  // Vista «Productos remisionados»: una fila por línea de OC que ya tiene remisión de
  // PARCELAR. Cada fila es { g: pedido, l: línea }.
  var COLUMNAS_DET = [
    { id: 'fecha',        label: 'Fecha Remisión', fn: function(r) { return r.g.fecha; } },
    { id: 'remision',     label: 'Remisión',       fn: function(r) { return r.l.remision.toLowerCase(); } },
    { id: 'consecutivo',  label: 'Pedido (OC)',    fn: function(r) { return r.g.consecutivo.toLowerCase(); } },
    { id: 'producto',     label: 'Producto',       fn: function(r) { return r.l.producto.toLowerCase(); } },
    { id: 'presentacion', label: 'Presentación',   fn: function(r) { return r.l.presentacion.toLowerCase(); } },
    { id: 'cantidad',     label: 'Cantidad',       fn: function(r) { return r.l.cantidad; }, num: true },
    { id: 'valorUnitario', label: 'Valor Unit.',   fn: function(r) { return r.l.valorUnitario; }, num: true },
    { id: 'valorTotal',   label: 'Valor Total',    fn: function(r) { return r.l.valorTotal; }, num: true },
    { id: 'bonificado',   label: 'Bonificado',     fn: function(r) { return r.l.bonificado.toLowerCase(); } },
    { id: 'factura',      label: 'N° Factura',     fn: function(r) { return r.l.facturaNum.toLowerCase(); } },
    { id: 'fechaFactura', label: 'Fecha Factura',  fn: function(r) { return r.l.facturaFecha; } },
    { id: 'estado',       label: 'Estado',         fn: function(r) { return r.g.estado; } }
  ];

  function _buscarCol(defs, id) {
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
    return null;
  }

  // Orden multinivel compartido por las dos vistas: clic = ordena por esa columna (otro
  // clic invierte, un tercero lo quita); Mayús+clic suma o quita un nivel.
  function _alternarOrden(orden, def, e) {
    var dir = def.num ? 'desc' : 'asc';
    var idx = -1;
    orden.forEach(function(l, i) { if (l.col === def.id) idx = i; });
    if (e && e.shiftKey) {
      if (idx >= 0) orden.splice(idx, 1);
      else orden.push({ col: def.id, dir: dir });
      return orden;
    }
    if (idx >= 0) {
      if (orden[idx].dir === 'asc') orden[idx].dir = 'desc';
      else orden.splice(idx, 1);
      return orden;
    }
    return [{ col: def.id, dir: dir }];
  }

  function ordenar(col, e) {
    var def = _buscarCol(COLUMNAS, col);
    if (!def || def.sort === false) return;
    _orden = _alternarOrden(_orden, def, e);
    _pintar();
  }

  function ordenarDetalle(col, e) {
    var def = _buscarCol(COLUMNAS_DET, col);
    if (!def) return;
    _ordenDet = _alternarOrden(_ordenDet, def, e);
    _pintarDetalle();
  }

  // `sinTexto`: la vista de productos aplica el texto de búsqueda por línea, no por pedido.
  function _filtrar(lista, sinTexto) {
    var q = sinTexto ? '' : _val('iaso-f-buscar').toLowerCase().trim();
    var est = _val('iaso-f-estado');
    var desde = _val('iaso-f-desde');
    var hasta = _val('iaso-f-hasta');
    return lista.filter(function(g) {
      if (est && g.estado !== est) return false;
      if (desde && (!g.fecha || g.fecha < desde)) return false;
      if (hasta && (!g.fecha || g.fecha > hasta)) return false;
      if (q) {
        var txt = [g.consecutivo, g.refIaso, g.remisiones.join(' '), g.facturas.join(' '), g.observacion,
          g.lineas.map(function(l) { return l.producto; }).join(' ')].join(' ').toLowerCase();
        if (txt.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function _ordenarPor(filas, orden, defs) {
    var copia = filas.slice();
    if (!orden.length) return copia;
    return copia.sort(function(a, b) {
      for (var s = 0; s < orden.length; s++) {
        var def = _buscarCol(defs, orden[s].col);
        if (!def || !def.fn) continue;
        var va = def.fn(a), vb = def.fn(b);
        var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
        if (cmp !== 0) return orden[s].dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  // Encabezado con flechas de orden; `accion` es el método público que recibe el clic.
  function _encabezadoHtml(defs, orden, accion) {
    return '<th>#</th>' + defs.map(function(col) {
      if (col.sort === false) return '<th>' + col.label + '</th>';
      var idx = -1;
      orden.forEach(function(l, i) { if (l.col === col.id) idx = i; });
      var cls = idx >= 0 ? (orden[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
      var badge = idx >= 0 && orden.length > 1 ? '<span style="font-size:0.6rem;vertical-align:super;color:#2980b9">' + (idx + 1) + '</span>' : '';
      return '<th class="sortable ' + cls + '" onclick="OCComoPedido.' + accion + '(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
    }).join('');
  }

  function _badgeEstado(est) {
    return est === 'Recibido' ? 'b-rec' : est === 'Parcial' ? 'b-par' : est === 'Facturado' ? 'b-fac' : 'b-ent';
  }

  function _badgeEstado2(est2) {
    return est2 === 'Pendiente de aprobación' ? 'b-pendiente-aprob' : est2 === 'Cerrado' ? 'b-cerrado' : 'b-abierto';
  }

  function _detalleHtml(g, colspan) {
    var filas = g.lineas.map(function(l) {
      return '<tr>' +
        '<td>' + escHtml(l.producto || '—') + '</td>' +
        '<td>' + escHtml(l.presentacion || '') + '</td>' +
        '<td class="money">' + l.cantidad.toLocaleString('es-CO') + '</td>' +
        '<td class="money">' + fmtMoney(l.valorUnitario) + '</td>' +
        '<td class="money">' + fmtMoney(l.valorTotal) + '</td>' +
        '<td>' + escHtml(l.bonificado || '') + '</td>' +
        '<td>' + (l.remision ? escHtml(l.remision) : '<span style="color:#cbd5e0">—</span>') + '</td>' +
        '</tr>';
    }).join('');
    var info = ['Orden de compra de IASO a PARCELAR · tipo ' + escHtml(g.tipo)];
    if (g.refIaso) info.push('Ref. ' + escHtml(g.refIaso));
    if (g.observacion) info.push('Observaciones: ' + escHtml(g.observacion));
    return '<tr><td colspan="' + colspan + '" style="padding:0">' +
      '<div style="background:#f7fafc;padding:10px 18px;border-left:3px solid #1a5276">' +
      '<div style="font-size:0.78rem;color:#4a5568;margin-bottom:6px">' + info.join(' · ') + '</div>' +
      '<table><thead><tr><th>Producto</th><th>Presentación</th><th>Cantidad</th><th>Valor Unit.</th><th>Valor Total</th><th>Bonificado</th><th>Remisión PARCELAR</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div></td></tr>';
  }

  function _pintar() {
    var filas = _ordenarPor(_filtrar(_datos || []), _orden, COLUMNAS);
    _vista = filas;

    var lineas = 0, total = 0;
    filas.forEach(function(g) { lineas += g.lineas.length; total += g.total; });
    var cuenta = document.getElementById('iaso-count');
    if (cuenta) {
      cuenta.textContent = '(' + filas.length + ' pedido' + (filas.length === 1 ? '' : 's') + ' · ' +
        lineas + ' línea' + (lineas === 1 ? '' : 's') + ' · ' + fmtMoney(total) + ')';
    }

    var head = document.getElementById('iaso-head');
    if (head) head.innerHTML = _encabezadoHtml(COLUMNAS, _orden, 'ordenar') + '<th>Acción</th>';

    var cuerpo = document.getElementById('iaso-body');
    if (!cuerpo) return;
    var colspan = COLUMNAS.length + 2;
    if (!filas.length) {
      cuerpo.innerHTML = '<tr><td colspan="' + colspan + '"><div class="empty">' +
        ((_datos && _datos.length) ? 'No hay pedidos de IASO con los filtros seleccionados.' : 'IASO no tiene órdenes de compra a PARCELAR.') +
        '</div></td></tr>';
      return;
    }
    cuerpo.innerHTML = filas.map(function(g, i) {
      var abierto = !!_abiertos[g.clave];
      return '<tr>' +
        '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
        '<td title="' + escHtml(g.empresa) + '"><span class="sigla-badge ' + getSiglaClass(g.empresa) + '">' + escHtml(getSigla(g.empresa)) + '</span></td>' +
        '<td style="text-align:center;font-weight:700;white-space:nowrap">' + escHtml(g.consecutivo) +
          ' <span title="Orden de compra de IASO a PARCELAR" style="background:#ebf5fb;color:#1a5276;padding:1px 6px;border-radius:9px;font-size:0.68rem;font-weight:700">OC</span></td>' +
        '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(g.cliente) + '">' + escHtml(g.cliente) + '</td>' +
        '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(g.fecha) + '</td>' +
        '<td style="text-align:center">' + g.lineas.length + '</td>' +
        '<td class="money">' + g.pedida.toLocaleString('es-CO') + '</td>' +
        '<td class="money">' + g.despachada.toLocaleString('es-CO') + '</td>' +
        '<td class="money">' + fmtMoney(g.total) + '</td>' +
        '<td><span class="badge ' + _badgeEstado(g.estado) + '">' + escHtml(g.estado) + '</span></td>' +
        '<td><span class="badge ' + _badgeEstado2(g.estado2) + '">' + escHtml(g.estado2) + '</span></td>' +
        '<td style="font-size:0.78rem">' + (g.remisiones.length ? escHtml(g.remisiones.join(', ')) : '<span style="color:#cbd5e0">—</span>') + '</td>' +
        '<td style="font-size:0.78rem">' + (g.facturas.length ? escHtml(g.facturas.join(', ')) : '<span style="color:#cbd5e0">—</span>') + '</td>' +
        '<td><button class="btn-ver" data-k="' + escHtml(g.clave) + '" onclick="OCComoPedido.alternarDetalle(this.dataset.k)">' + (abierto ? '▲ Ocultar' : '👁 Ver') + '</button></td>' +
        '</tr>' + (abierto ? _detalleHtml(g, colspan) : '');
    }).join('');
  }

  function alternarDetalle(clave) {
    if (_abiertos[clave]) delete _abiertos[clave]; else _abiertos[clave] = true;
    _pintar();
  }

  // ── Vista «Productos remisionados» ──
  // Una fila por línea con remisión de PARCELAR, de los pedidos que pasan los filtros de
  // estado y fecha; el texto de búsqueda se aplica a cada línea (producto, remisión, etc.).
  function _lineasRemisionadas() {
    var q = _val('iaso-f-buscar').toLowerCase().trim();
    var filas = [];
    _filtrar(_datos || [], true).forEach(function(g) {
      g.lineas.forEach(function(l) {
        if (!l.remision) return;
        if (q) {
          var txt = [g.consecutivo, g.refIaso, l.producto, l.presentacion, l.remision, l.facturaNum, l.bonificado].join(' ').toLowerCase();
          if (txt.indexOf(q) < 0) return;
        }
        filas.push({ g: g, l: l });
      });
    });
    return filas;
  }

  function _pintarDetalle() {
    var filas = _ordenarPor(_lineasRemisionadas(), _ordenDet, COLUMNAS_DET);
    _vistaDet = filas;

    var remisiones = {}, nRem = 0, unidades = 0, total = 0;
    filas.forEach(function(r) {
      if (!remisiones[r.l.remision]) { remisiones[r.l.remision] = true; nRem++; }
      unidades += r.l.cantidad;
      total += r.l.valorTotal;
    });
    var cuenta = document.getElementById('iaso-count');
    if (cuenta) {
      cuenta.textContent = '(' + filas.length + ' producto' + (filas.length === 1 ? '' : 's') + ' · ' +
        nRem + (nRem === 1 ? ' remisión' : ' remisiones') + ' · ' + unidades.toLocaleString('es-CO') + ' und · ' + fmtMoney(total) + ')';
    }

    var head = document.getElementById('iaso-det-head');
    if (head) head.innerHTML = _encabezadoHtml(COLUMNAS_DET, _ordenDet, 'ordenarDetalle');

    var cuerpo = document.getElementById('iaso-det-body');
    if (!cuerpo) return;
    if (!filas.length) {
      var hayRem = (_datos || []).some(function(g) { return g.remisiones.length; });
      cuerpo.innerHTML = '<tr><td colspan="' + (COLUMNAS_DET.length + 1) + '"><div class="empty">' +
        (hayRem ? 'No hay productos remisionados con los filtros seleccionados.' : 'Todavía no hay productos remisionados de las órdenes de compra de IASO.') +
        '</div></td></tr>';
      return;
    }
    var vacio = '<span style="color:#cbd5e0">—</span>';
    cuerpo.innerHTML = filas.map(function(r, i) {
      var g = r.g, l = r.l;
      return '<tr>' +
        '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
        '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(g.fecha) + '</td>' +
        '<td style="white-space:nowrap;font-weight:600;font-size:0.82rem">' + escHtml(l.remision) +
          ' <span title="Orden de compra de IASO a PARCELAR" style="background:#ebf5fb;color:#1a5276;padding:1px 6px;border-radius:9px;font-size:0.68rem;font-weight:700">OC</span></td>' +
        '<td style="white-space:nowrap;font-size:0.78rem">' + escHtml(g.consecutivo) + '</td>' +
        '<td style="font-size:0.82rem">' + escHtml(l.producto || '—') + '</td>' +
        '<td style="font-size:0.78rem">' + escHtml(l.presentacion || '') + '</td>' +
        '<td class="money">' + l.cantidad.toLocaleString('es-CO') + '</td>' +
        '<td class="money">' + fmtMoney(l.valorUnitario) + '</td>' +
        '<td class="money">' + fmtMoney(l.valorTotal) + '</td>' +
        '<td style="font-size:0.78rem">' + (l.bonificado ? escHtml(l.bonificado) : vacio) + '</td>' +
        '<td style="font-size:0.78rem">' + (l.facturaNum ? escHtml(l.facturaNum) : vacio) + '</td>' +
        '<td style="white-space:nowrap;font-size:0.78rem">' + (l.facturaFecha ? fmtDate(l.facturaFecha) : vacio) + '</td>' +
        '<td><span class="badge ' + _badgeEstado(g.estado) + '">' + escHtml(g.estado) + '</span></td>' +
        '</tr>';
    }).join('');
  }

  function _repintar() {
    if (_modo === 'detalle') _pintarDetalle(); else _pintar();
  }

  // Cambia entre «Por pedido» y «Productos remisionados» (los filtros de arriba valen para ambas).
  function cambiarVista(modo) {
    _modo = modo === 'detalle' ? 'detalle' : 'pedidos';
    var vp = document.getElementById('iaso-vista-pedidos');
    var vd = document.getElementById('iaso-vista-detalle');
    if (vp) vp.style.display = _modo === 'pedidos' ? 'block' : 'none';
    if (vd) vd.style.display = _modo === 'detalle' ? 'block' : 'none';
    var bp = document.getElementById('iaso-btn-pedidos');
    var bd = document.getElementById('iaso-btn-detalle');
    if (bp) bp.style.background = _modo === 'pedidos' ? '#1a5276' : '#718096';
    if (bd) bd.style.background = _modo === 'detalle' ? '#1a5276' : '#718096';
    return render();
  }

  // Lo llama switchPedidoTab('iaso') y cada filtro de la pestaña.
  function render() {
    if (!AUTH.verPedidosIASO()) return;
    if (_datos) { _repintar(); return; }
    var cuerpo = document.getElementById(_modo === 'detalle' ? 'iaso-det-body' : 'iaso-body');
    var colspan = _modo === 'detalle' ? COLUMNAS_DET.length + 1 : COLUMNAS.length + 2;
    if (cuerpo) cuerpo.innerHTML = '<tr><td colspan="' + colspan + '"><div class="empty">Cargando órdenes de compra de IASO…</div></td></tr>';
    return cargar().then(function() { _repintar(); }, function(e) {
      if (cuerpo) cuerpo.innerHTML = '<tr><td colspan="' + colspan + '"><div class="empty">⚠ No se pudieron cargar las órdenes de compra: ' +
        escHtml((e && e.message) || e) + '</div></td></tr>';
    });
  }

  // Una hoja con los productos remisionados que se están viendo.
  function _exportarDetalle() {
    if (!_vistaDet.length) { showToast('No hay productos remisionados para exportar', '#e74c3c'); return; }
    var datos = _vistaDet.map(function(r) {
      return {
        'Fecha Remisión': r.g.fecha,
        'Remisión': r.l.remision,
        'Pedido (OC)': r.g.consecutivo,
        'Tipo OC': r.g.tipo,
        'Ref. IASO': r.g.refIaso,
        'Cliente': r.g.cliente,
        'Producto': r.l.producto,
        'Presentación': r.l.presentacion,
        'Cantidad': r.l.cantidad,
        'Valor Unitario': r.l.valorUnitario,
        'Valor Total': r.l.valorTotal,
        'Bonificado': r.l.bonificado,
        'N° Factura': r.l.facturaNum,
        'Fecha Factura': r.l.facturaFecha,
        'Estado': r.g.estado
      };
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(datos);
    ws['!cols'] = [{wch:14},{wch:20},{wch:30},{wch:10},{wch:14},{wch:36},{wch:28},{wch:16},{wch:10},{wch:14},{wch:14},{wch:10},{wch:14},{wch:14},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, 'Productos remisionados');
    XLSX.writeFile(wb, 'productos_remisionados_IASO_OC_' + today() + '.xlsx');
    showToast('Excel exportado: ' + _vistaDet.length + ' productos', '#27ae60');
  }

  // Exporta la vista activa.
  function exportarExcel() {
    if (_modo === 'detalle') _exportarDetalle(); else _exportarPedidos();
  }

  // Dos hojas, como Cargas históricas: una fila por pedido y una por línea.
  function _exportarPedidos() {
    if (!_vista.length) { showToast('No hay pedidos para exportar', '#e74c3c'); return; }
    var pedidosData = _vista.map(function(g) {
      return {
        'Empresa': getSigla(g.empresa),
        'Consecutivo': g.consecutivo,
        'Cliente': g.cliente,
        'Tipo OC': g.tipo,
        'Ref. IASO': g.refIaso,
        'Fecha Pedido': g.fecha,
        'Total Orden': g.total,
        'Productos': g.lineas.length,
        'Cant. Pedida': g.pedida,
        'Cant. Despachada': g.despachada,
        'Estado': g.estado,
        'Estado 2': g.estado2,
        'Remisión': g.remisiones.join(', '),
        'N° Factura': g.facturas.join(', '),
        'Observaciones': g.observacion
      };
    });
    var lineasData = [];
    _vista.forEach(function(g) {
      g.lineas.forEach(function(l) {
        lineasData.push({
          'Empresa': getSigla(g.empresa),
          'Consecutivo': g.consecutivo,
          'Cliente': g.cliente,
          'Fecha Pedido': g.fecha,
          'Producto': l.producto,
          'Presentación': l.presentacion,
          'Cantidad': l.cantidad,
          'Valor Unitario': l.valorUnitario,
          'Valor Total': l.valorTotal,
          'Bonificado': l.bonificado,
          'Remisión': l.remision,
          'N° Factura': l.facturaNum,
          'Fecha Factura': l.facturaFecha
        });
      });
    });
    var wb = XLSX.utils.book_new();
    var wsP = XLSX.utils.json_to_sheet(pedidosData);
    wsP['!cols'] = [{wch:10},{wch:30},{wch:36},{wch:10},{wch:14},{wch:12},{wch:14},{wch:10},{wch:12},{wch:16},{wch:12},{wch:22},{wch:20},{wch:16},{wch:34}];
    XLSX.utils.book_append_sheet(wb, wsP, 'Pedidos');
    var wsL = XLSX.utils.json_to_sheet(lineasData);
    wsL['!cols'] = [{wch:10},{wch:30},{wch:36},{wch:12},{wch:28},{wch:16},{wch:10},{wch:14},{wch:14},{wch:10},{wch:16},{wch:14},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsL, 'Líneas');
    XLSX.writeFile(wb, 'pedidos_IASO_OC_' + today() + '.xlsx');
    showToast('Excel exportado: ' + _vista.length + ' pedidos', '#27ae60');
  }

  return {
    EMPRESA: EMPRESA,
    CLIENTE: CLIENTE,
    agrupar: agrupar,
    cargar: cargar,
    invalidar: invalidar,
    recargar: recargar,
    despachos: despachos,
    render: render,
    ordenar: ordenar,
    ordenarDetalle: ordenarDetalle,
    cambiarVista: cambiarVista,
    alternarDetalle: alternarDetalle,
    exportarExcel: exportarExcel
  };
})();
