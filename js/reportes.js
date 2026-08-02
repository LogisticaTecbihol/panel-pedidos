// ── State ──
var pedidos = [];
var ingresos = [];
var ordenesCompra = [];
var muestras = [];
var reenvases = [];
var devoluciones = [];
var remisionesAnuladas = [];
var cambiosMerc = [];
var kardexNC = [];
var aggregated = [];
var rptSort = { col: 'pendiente', dir: 'desc' };

// Programación de planta + Traslados pendientes
var existSnapshot = null;
var plantaData = [];
var plantaSort = { col: 'producir', dir: 'desc' };
var plantaExpanded = {}; // prodKey → true si su detalle está desplegado
var trasladosData = [];
var trasladosSort = { col: 'fecha', dir: 'desc' };

var SIGLAS = {
  'PARCELAR DE COLOMBIA SAS': 'PARCELAR',
  'GREEN AGROSOLUCIONES DE COLOMBIA SAS': 'GREEN',
  'SOLUCIONES INTEGRALES RESO SAS': 'RESO',
  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS': 'IASO',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS': 'IAS',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS ': 'IAS',
};
function getSigla(n) { return SIGLAS[(n||'').trim()] || n || '—'; }

// ── Load ──
async function loadReportes() {
  await _authReady;
  populateEmpresaSelect('ra-empresa', 'Seleccionar...');
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
      apiGet('getPedidos', { columns: 'id,Nombre_Empresa,Consecutivo,Fecha_Pedido,Cliente,Comercial,Producto,Presentacion,Cantidad,Cant_Entregada,Cant_Pendiente,Estado_Entrega,Estado_2,Remisiones,Fecha_Ult_Entrega' }),
      apiGet('getIngresos', { columns: 'id,Empresa_Origen,Empresa_Destino,Remision_Origen,Remision_Destino,Origen,Producto,Presentacion,Cantidad,Fecha' }).catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'id,Remision,Empresa_Destino,Empresa_Origen,Consecutivo,Producto,Presentacion,Cantidad,Fecha,Tipo,Estado,Ref_Pedido,Observaciones' }).catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras', { columns: 'id,Remision,Empresa,Consecutivo,Producto,Presentacion,Cantidad,Cant_Entregada,Fecha_Entrega,Fecha_Solicitud' }).catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases', { columns: 'id,Remision,Empresa,Producto,Presentacion,Cantidad,Fecha' }).catch(function() { return { ok: true, reenvases: [] }; }),
      apiGet('getDevoluciones', { columns: 'id,Empresa,Consecutivo,Remision_Ingreso,Remision,Remision_Salida,Producto,Presentacion,Cantidad,Fecha_Ingreso,Fecha_Devolucion,Fecha,Fecha_Salida' }).catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getRemisionesAnuladas', { columns: 'id,Remision,Empresa,Producto,Presentacion,Cantidad,Fecha,Observaciones' }).catch(function() { return { ok: true, remisionesAnuladas: [] }; }),
      apiGet('getCambios', { columns: 'id,Empresa,Consecutivo,Estado,Remision_Ingreso,Remision_Salida,Observaciones,Producto,Tipo_Linea,Cantidad,Fecha_Ingreso,Fecha_Salida' }).catch(function() { return { ok: true, cambios: [] }; }),
      apiGet('getKardexNC', { columns: 'id,Remision,Empresa,Tipo,Producto,Presentacion,Cantidad,Fecha,Motivo' }).catch(function() { return { ok: true, ajustesNC: [] }; })
    ]);

    var data = results[0];
    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    data.pedidos = data.pedidos.filter(function(p) {
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente';
    });

    pedidos = data.pedidos.map(function(p) {
      if (!p.Cant_Entregada && p.Cant_Entregada !== 0) {
        p.Cant_Entregada = 0;
        p.Cant_Pendiente = Number(p.Cantidad) || 0;
        p.Estado_Entrega = 'Recibido';
      }
      if (!p.Estado_2) p.Estado_2 = 'Abierto';
      var cantE = Number(p.Cant_Entregada) || 0;
      var cantQ = Number(p.Cantidad) || 0;
      p.Cant_Pendiente = Math.max(0, cantQ - cantE);
      return p;
    });

    ingresos = (results[1].ingresos || []);
    ordenesCompra = (results[2].ordenes || []);
    muestras = (results[3].muestras || []);
    reenvases = (results[4].reenvases || []);
    devoluciones = (results[5].devoluciones || []);
    remisionesAnuladas = (results[6].remisionesAnuladas || []);
    cambiosMerc = (results[7].cambios || []);
    kardexNC = (results[8].ajustesNC || []);

    // Snapshot de existencias (mismo cálculo que Kardex/Pedidos)
    // usado por los tabs "Programación de planta" y "Traslados".
    try {
      if (typeof Existencias !== 'undefined' && Existencias.loadSnapshot) {
        existSnapshot = await Existencias.loadSnapshot();
      }
    } catch (e) {
      existSnapshot = null;
      console.warn('No se pudo cargar snapshot de existencias:', e);
    }

    populateRptFilters();
    buildReport();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + pedidos.length + ' líneas';
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
var rptFiltersAttached = false;
function populateRptFilters() {
  var emps = [], coms = [], clis = [];
  pedidos.forEach(function(p) {
    if (p.Nombre_Empresa && emps.indexOf(p.Nombre_Empresa) < 0 && AUTH.hasCompany(p.Nombre_Empresa)) emps.push(p.Nombre_Empresa);
    if (p.Comercial && coms.indexOf(p.Comercial) < 0) coms.push(p.Comercial);
    var cli = (p.Cliente || '').trim();
    if (cli && clis.indexOf(cli) < 0) clis.push(cli);
  });
  emps.sort(); coms.sort(); clis.sort();
  var fe = document.getElementById('rf-emp');
  fe.innerHTML = '<option value="">Todas</option>' + emps.map(function(e) { return '<option value="' + e + '">' + getSigla(e) + ' — ' + e + '</option>'; }).join('');
  var fc = document.getElementById('rf-com');
  fc.innerHTML = '<option value="">Todos</option>' + coms.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  var fcli = document.getElementById('rf-cli');
  fcli.innerHTML = '<option value="">Todos</option>' + clis.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');

  if (!rptFiltersAttached) {
    ['rf-emp','rf-com','rf-cli','rf-txt'].forEach(function(id) {
      document.getElementById(id).addEventListener('change', _rebuildActiveTab);
      document.getElementById(id).addEventListener('input', _rebuildActiveTab);
    });
    rptFiltersAttached = true;
  }
}

function clearRptFilters() {
  document.getElementById('rf-emp').value = '';
  document.getElementById('rf-com').value = '';
  document.getElementById('rf-cli').value = '';
  document.getElementById('rf-txt').value = '';
  _rebuildActiveTab();
}

// Reconstruye el tab actualmente visible (pendientes/planta/traslados/remisiones)
// cada vez que cambian los filtros del header.
function _rebuildActiveTab() {
  buildReport(); // el de pendientes siempre lo actualizamos
  var isPlanta   = document.getElementById('panel-planta')   && document.getElementById('panel-planta').style.display   !== 'none';
  var isTraslad  = document.getElementById('panel-traslados')&& document.getElementById('panel-traslados').style.display !== 'none';
  var isRem      = document.getElementById('panel-remisiones')&&document.getElementById('panel-remisiones').style.display!== 'none';
  if (isPlanta) buildPlanta();
  if (isTraslad) buildTraslados();
  if (isRem) buildRemisiones();
}

function limpiarProducto(nombre) {
  nombre = String(nombre || '');
  if (/bonificado/i.test(nombre)) {
    return nombre.replace(/\s*bonificado\s*/gi, ' ').trim();
  }
  return nombre;
}

// ── Build aggregated report ──
function buildReport() {
  var fEmp = document.getElementById('rf-emp').value;
  var fCom = document.getElementById('rf-com').value;
  var fCli = document.getElementById('rf-cli').value;
  var fTxt = document.getElementById('rf-txt').value.toLowerCase();

  // Build set of orders that have at least one delivery
  var ordersWithDeliveries = {};
  pedidos.forEach(function(p) {
    if ((Number(p.Cant_Entregada) || 0) > 0) {
      ordersWithDeliveries[(p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '') + '||' + (p.Cliente || '')] = true;
    }
  });

  // Filter lines: Parcial (or Recibido in an order with deliveries) with pending > 0
  var filtered = pedidos.filter(function(p) {
    var rawEst = (p.Estado_Entrega || '').trim();
    var est = norm(rawEst || 'Recibido');
    var ordKey = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '') + '||' + (p.Cliente || '');
    var effectiveEst = (est === 'recibido' && ordersWithDeliveries[ordKey]) ? 'parcial' : est;
    if (effectiveEst !== 'parcial') return false;
    var pend = Number(p.Cant_Pendiente) || 0;
    if (pend <= 0) return false;
    var est2 = (p.Estado_2 || 'Abierto').trim();
    if (est2 === 'Anulado' || est2 === 'Alistado' || est2 === 'Cerrado' || est2 === 'Bloqueado por cartera') return false;
    if (fEmp && p.Nombre_Empresa !== fEmp) return false;
    if (fCom && p.Comercial !== fCom) return false;
    if (fCli && (p.Cliente || '').trim() !== fCli) return false;
    return true;
  });

  // Build line-by-line detail
  var ordenesSet = {};
  var clientesSet = {};
  var productosSet = {};
  aggregated = filtered.map(function(p) {
    var ordKey = (p.Nombre_Empresa || '') + '||' + p.Consecutivo;
    ordenesSet[ordKey] = true;
    clientesSet[p.Cliente || ''] = true;
    productosSet[limpiarProducto(String(p.Producto || '')).toUpperCase().trim()] = true;
    return {
      empresa: p.Nombre_Empresa || '',
      producto: limpiarProducto(String(p.Producto || '')).toUpperCase().trim(),
      presentacion: String(p.Presentacion || '').toUpperCase().trim(),
      pendiente: Number(p.Cant_Pendiente) || 0,
      cliente: (p.Cliente || '').trim(),
      fecha: p.Fecha_Pedido || '',
      consecutivo: p.Consecutivo || ''
    };
  });

  if (fTxt) {
    aggregated = aggregated.filter(function(r) {
      return r.producto.toLowerCase().indexOf(fTxt) >= 0 || r.presentacion.toLowerCase().indexOf(fTxt) >= 0;
    });
  }

  // Stats
  document.getElementById('st-productos').textContent = Object.keys(productosSet).length;
  document.getElementById('st-unidades').textContent = aggregated.reduce(function(s, r) { return s + r.pendiente; }, 0).toLocaleString('es-CO');
  document.getElementById('st-ordenes').textContent = Object.keys(ordenesSet).length;
  document.getElementById('st-clientes').textContent = Object.keys(clientesSet).filter(Boolean).length;

  renderRptTable();
  if (document.getElementById('panel-remisiones').style.display !== 'none') buildRemisiones();
}

// ── Sort ──
function toggleRptSort(col) {
  if (rptSort.col === col) {
    rptSort.dir = rptSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    rptSort.col = col;
    rptSort.dir = col === 'producto' || col === 'presentacion' || col === 'cliente' || col === 'empresa' ? 'asc' : 'desc';
  }
  renderRptTable();
}

function sortedAggregated() {
  var col = rptSort.col;
  var dir = rptSort.dir;
  return [].concat(aggregated).sort(function(a, b) {
    var va, vb;
    if (col === 'producto') { va = a.producto; vb = b.producto; }
    else if (col === 'presentacion') { va = a.presentacion; vb = b.presentacion; }
    else if (col === 'pendiente') { va = a.pendiente; vb = b.pendiente; }
    else if (col === 'cliente') { va = a.cliente; vb = b.cliente; }
    else if (col === 'fecha') { va = +(new Date(a.fecha||0)); vb = +(new Date(b.fecha||0)); }
    else if (col === 'empresa') { va = getSigla(a.empresa); vb = getSigla(b.empresa); }
    else { va = a.pendiente; vb = b.pendiente; }
    var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ── Render ──
function renderRptTable() {
  var cols = [
    { id: 'empresa', label: 'Empresa' },
    { id: 'producto', label: 'Producto' },
    { id: 'presentacion', label: 'Presentación' },
    { id: 'pendiente', label: 'Pendiente' },
    { id: 'cliente', label: 'Cliente' },
    { id: 'fecha', label: 'Fecha Pedido' },
  ];

  document.getElementById('rpt-head').innerHTML = cols.map(function(c) {
    var cls = rptSort.col === c.id ? (rptSort.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    return '<th class="' + cls + '" onclick="toggleRptSort(\'' + c.id + '\')">' + c.label + '</th>';
  }).join('');

  document.getElementById('rpt-count').textContent = '(' + aggregated.length + ' líneas)';

  var rows = sortedAggregated();
  var tbody = document.getElementById('rpt-body');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-msg">No hay productos pendientes con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    return '<tr>' +
      '<td><span class="badge-emp" style="background:#ebf5fb;color:#1a5276">' + getSigla(r.empresa) + '</span></td>' +
      '<td style="font-weight:700">' + (r.producto || '—') + '</td>' +
      '<td>' + (r.presentacion || '—') + '</td>' +
      '<td class="money" style="color:#e74c3c;font-weight:700;font-size:0.95rem">' + r.pendiente.toLocaleString('es-CO') + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + r.cliente + '">' + (r.cliente || '—') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.fecha) + '</td>' +
    '</tr>';
  }).join('');
}

// ── Export Excel ──
function exportExcel() {
  var rows = sortedAggregated();
  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var data = rows.map(function(r) {
    return {
      'Empresa': getSigla(r.empresa),
      'Producto': r.producto || '',
      'Presentación': r.presentacion || '',
      'Pendiente': r.pendiente,
      'Cliente': r.cliente || '',
      'Fecha Pedido': r.fecha ? fmtDate(r.fecha) : ''
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 35 }, { wch: 14 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pendientes');
  XLSX.writeFile(wb, 'pendientes_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' líneas');
}

// ── Tabs ──
function switchTab(tab) {
  var tabs = ['pendientes', 'planta', 'traslados', 'remisiones'];
  tabs.forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var btn = document.getElementById('tab-' + t);
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    if (btn) btn.style.background = (t === tab) ? '#1a5276' : '#718096';
  });
  if (tab === 'planta') buildPlanta();
  if (tab === 'traslados') buildTraslados();
  if (tab === 'remisiones') buildRemisiones();
}

// ══════════════════════════════════════════════════════════════
// PROGRAMACIÓN DE PLANTA
// ══════════════════════════════════════════════════════════════
//
// Agregado por producto (mismo criterio de normalización que Kardex):
//   Pendiente total = suma de Cant_Pendiente en líneas con
//     Cant_Pendiente>0 y Estado_2 NO en {Anulado,Cerrado,Bloqueado}.
//   Existencia holding = suma de existSnapshot.saldos[prod] por empresa.
//   Traslados pend. aprobar = suma de OrdenesCompra con Tipo='Traslado',
//     Remision vacía y Estado NO 'Anulada' para ese producto.
//   A producir = max(0, pendiente − existencia − traslados_pend)
//   Estado semáforo:
//     verde   → existencia >= pendiente
//     amarillo→ existencia + traslados_pend >= pendiente pero exist. < pend.
//     rojo    → todavía falta producir
// ══════════════════════════════════════════════════════════════

function _normProdRep(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function _empresasVisibles() {
  var lista = (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas)
    ? AUTH.getFilteredEmpresas(EMPRESAS_HOLDING)
    : (typeof EMPRESAS_HOLDING !== 'undefined' ? EMPRESAS_HOLDING : []);
  return lista;
}

function buildPlanta() {
  var fEmp = document.getElementById('rf-emp').value;
  var fCom = document.getElementById('rf-com').value;
  var fCli = document.getElementById('rf-cli').value;
  var fTxt = (document.getElementById('rf-txt').value || '').toLowerCase();

  // 1) Agregar pendientes por producto (guardando las líneas
  //    contribuyentes para el detalle desplegable)
  var acum = {}; // prodNorm → { producto, presentaciones:Set, pendiente, empresas:Set, _lineas:[] }
  pedidos.forEach(function(p) {
    var pend = Number(p.Cant_Pendiente) || 0;
    if (pend <= 0) return;
    var est2 = (p.Estado_2 || 'Abierto').trim();
    if (est2 === 'Anulado' || est2 === 'Cerrado' || est2 === 'Bloqueado por cartera') return;
    if (fEmp && p.Nombre_Empresa !== fEmp) return;
    if (fCom && p.Comercial !== fCom) return;
    if (fCli && (p.Cliente || '').trim() !== fCli) return;
    var prodDisplay = limpiarProducto(String(p.Producto || '')).toUpperCase().trim();
    var prodKey = _normProdRep(p.Producto);
    if (!prodKey) return;
    if (!acum[prodKey]) {
      acum[prodKey] = {
        producto: prodDisplay,
        prodKey: prodKey,
        presentaciones: {},
        pendiente: 0,
        empresasPed: {},
        _lineas: [],
        _traslados: []
      };
    }
    acum[prodKey].pendiente += pend;
    var pres = String(p.Presentacion || '').trim();
    if (pres) acum[prodKey].presentaciones[pres] = true;
    if (p.Nombre_Empresa) acum[prodKey].empresasPed[p.Nombre_Empresa] = true;
    acum[prodKey]._lineas.push({
      empresa: p.Nombre_Empresa || '',
      consecutivo: p.Consecutivo || '',
      cliente: (p.Cliente || '').trim(),
      comercial: (p.Comercial || '').trim(),
      presentacion: pres,
      cantidad: Number(p.Cantidad) || 0,
      entregada: Number(p.Cant_Entregada) || 0,
      pendiente: pend,
      fecha: p.Fecha_Pedido || '',
      estado2: est2
    });
  });

  // 2) Agregar traslados pendientes (OC Tipo='Traslado', Remision vacía, Estado no anulada)
  var trasladosByProd = {};
  var trasladosListByProd = {};
  ordenesCompra.forEach(function(oc) {
    if ((oc.Tipo || 'Compra') !== 'Traslado') return;
    if (String(oc.Remision || '').trim()) return;
    if ((oc.Estado || '').toLowerCase() === 'anulada') return;
    var cant = Number(oc.Cantidad) || 0;
    if (cant <= 0) return;
    var key = _normProdRep(oc.Producto);
    if (!key) return;
    if (!trasladosByProd[key]) trasladosByProd[key] = 0;
    trasladosByProd[key] += cant;
    if (!trasladosListByProd[key]) trasladosListByProd[key] = [];
    trasladosListByProd[key].push({
      consecutivo: oc.Consecutivo || '',
      origen: oc.Empresa_Origen || '',
      destino: oc.Empresa_Destino || '',
      cantidad: cant,
      fecha: oc.Fecha || '',
      refPedido: oc.Ref_Pedido || ''
    });
  });

  // 3) Existencia por empresa desde el snapshot (misma lógica que Kardex)
  var empresasList = _empresasVisibles();
  var saldos = (existSnapshot && existSnapshot.saldos) || {};

  // 4) Armar filas
  plantaData = Object.keys(acum).map(function(key) {
    var a = acum[key];
    var perEmp = saldos[key] || {};
    var porEmp = {};
    var existHolding = 0;
    empresasList.forEach(function(e) {
      var v = Math.max(0, perEmp[e.value] || 0);
      porEmp[e.value] = v;
      existHolding += v;
    });
    var trasladosPend = trasladosByProd[key] || 0;
    var producir = Math.max(0, a.pendiente - existHolding - trasladosPend);
    var estado;
    if (existHolding >= a.pendiente) estado = 'verde';
    else if (existHolding + trasladosPend >= a.pendiente) estado = 'amarillo';
    else estado = 'rojo';
    return {
      producto: a.producto,
      prodKey: a.prodKey,
      presentaciones: Object.keys(a.presentaciones).sort().join(', '),
      pendiente: a.pendiente,
      porEmp: porEmp,
      existHolding: existHolding,
      trasladosPend: trasladosPend,
      producir: producir,
      estado: estado,
      empresasPedidoCount: Object.keys(a.empresasPed).length,
      _lineas: a._lineas || [],
      _traslados: trasladosListByProd[key] || []
    };
  });

  // Filtro texto (aplicar sobre producto y presentacion)
  if (fTxt) {
    plantaData = plantaData.filter(function(r) {
      return r.producto.toLowerCase().indexOf(fTxt) >= 0 || r.presentaciones.toLowerCase().indexOf(fTxt) >= 0;
    });
  }

  // Stats
  document.getElementById('st-pl-productos').textContent = plantaData.length.toLocaleString('es-CO');
  document.getElementById('st-pl-producir').textContent  = plantaData.reduce(function(s, r) { return s + r.producir; }, 0).toLocaleString('es-CO');
  document.getElementById('st-pl-traslados').textContent = plantaData.reduce(function(s, r) { return s + r.trasladosPend; }, 0).toLocaleString('es-CO');
  document.getElementById('st-pl-cubiertos').textContent = plantaData.filter(function(r) { return r.estado === 'verde'; }).length.toLocaleString('es-CO');

  renderPlantaTable();
}

function togglePlantaSort(col) {
  if (plantaSort.col === col) {
    plantaSort.dir = plantaSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    plantaSort.col = col;
    plantaSort.dir = (col === 'producto' || col === 'presentaciones') ? 'asc' : 'desc';
  }
  renderPlantaTable();
}

function sortedPlanta() {
  var col = plantaSort.col;
  var dir = plantaSort.dir;
  return [].concat(plantaData).sort(function(a, b) {
    var va, vb;
    if (col === 'producto') { va = a.producto; vb = b.producto; }
    else if (col === 'presentaciones') { va = a.presentaciones; vb = b.presentaciones; }
    else if (col === 'existHolding') { va = a.existHolding; vb = b.existHolding; }
    else if (col === 'trasladosPend') { va = a.trasladosPend; vb = b.trasladosPend; }
    else if (col === 'pendiente') { va = a.pendiente; vb = b.pendiente; }
    else if (col === 'producir') { va = a.producir; vb = b.producir; }
    else if (col === 'estado') { va = a.estado; vb = b.estado; }
    else if (typeof col === 'string' && col.indexOf('emp:') === 0) {
      var emp = col.slice(4);
      va = (a.porEmp[emp] || 0);
      vb = (b.porEmp[emp] || 0);
    } else { va = a.producir; vb = b.producir; }
    var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });
}

function renderPlantaTable() {
  var empresasList = _empresasVisibles();
  var cols = [
    { id: '_toggle', label: '' },
    { id: 'producto', label: 'Producto' },
    { id: 'presentaciones', label: 'Presentación(es)' },
    { id: 'pendiente', label: 'Pendiente' }
  ];
  empresasList.forEach(function(e) {
    cols.push({ id: 'emp:' + e.value, label: e.sigla });
  });
  cols.push({ id: 'existHolding', label: 'Exist. total' });
  cols.push({ id: 'trasladosPend', label: 'Traslados pend.' });
  cols.push({ id: 'producir', label: 'A producir' });
  cols.push({ id: 'estado', label: 'Estado' });

  var head = document.getElementById('pl-head');
  head.innerHTML = cols.map(function(c) {
    if (c.id === '_toggle') return '<th style="width:26px"></th>';
    var cls = plantaSort.col === c.id ? (plantaSort.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var safeId = String(c.id).replace(/'/g, "\\'");
    return '<th class="' + cls + '" onclick="togglePlantaSort(\'' + safeId + '\')">' + c.label + '</th>';
  }).join('');

  document.getElementById('pl-count').textContent = '(' + plantaData.length + ' producto' + (plantaData.length === 1 ? '' : 's') + ')';

  var rows = sortedPlanta();
  var tbody = document.getElementById('pl-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="' + cols.length + '"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay productos con demanda pendiente.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    var badge;
    if (r.estado === 'verde') badge = '<span style="background:#d5f5e3;color:#1e8449;padding:3px 8px;border-radius:10px;font-size:0.72rem;font-weight:700">🟢 Cubierto</span>';
    else if (r.estado === 'amarillo') badge = '<span style="background:#fef5e7;color:#b7791f;padding:3px 8px;border-radius:10px;font-size:0.72rem;font-weight:700">🟡 Cubierto con traslados</span>';
    else badge = '<span style="background:#fadbd8;color:#a93226;padding:3px 8px;border-radius:10px;font-size:0.72rem;font-weight:700">🔴 Producir</span>';
    var abierto = !!plantaExpanded[r.prodKey];
    var keyEsc = r.prodKey.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    var chevron = '<button onclick="togglePlantaDetail(\'' + keyEsc + '\')" title="Ver pedidos que suman este pendiente" style="background:none;border:none;color:#1a5276;cursor:pointer;font-size:0.85rem;font-weight:700;padding:0 4px">' + (abierto ? '▾' : '▸') + '</button>';
    var celdas = '<td style="text-align:center">' + chevron + '</td>' +
      '<td style="font-weight:700;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.producto || '').replace(/"/g, '&quot;') + '">' + (r.producto || '—') + '</td>' +
      '<td style="font-size:0.78rem;color:#4a5568">' + (r.presentaciones || '—') + '</td>' +
      '<td class="money" style="font-weight:700"><a href="#" onclick="togglePlantaDetail(\'' + keyEsc + '\');return false" style="color:#1a5276;text-decoration:none;border-bottom:1px dashed #cbd5e0" title="Ver detalle">' + r.pendiente.toLocaleString('es-CO') + '</a></td>';
    empresasList.forEach(function(e) {
      var v = r.porEmp[e.value] || 0;
      var color = v > 0 ? '#27ae60' : '#cbd5e0';
      var weight = v > 0 ? '700' : '400';
      celdas += '<td style="text-align:right;color:' + color + ';font-weight:' + weight + ';font-size:0.84rem">' + v.toLocaleString('es-CO') + '</td>';
    });
    var colorExist = r.existHolding >= r.pendiente ? '#27ae60' : '#2c3e50';
    celdas += '<td class="money" style="font-weight:800;color:' + colorExist + '">' + r.existHolding.toLocaleString('es-CO') + '</td>';
    var colorTras = r.trasladosPend > 0 ? '#e67e22' : '#cbd5e0';
    celdas += '<td class="money" style="font-weight:700;color:' + colorTras + '">' + r.trasladosPend.toLocaleString('es-CO') + '</td>';
    var colorProd = r.producir > 0 ? '#e74c3c' : '#27ae60';
    celdas += '<td class="money" style="font-weight:800;color:' + colorProd + ';font-size:0.95rem">' + r.producir.toLocaleString('es-CO') + '</td>';
    celdas += '<td>' + badge + '</td>';
    var mainRow = '<tr>' + celdas + '</tr>';
    var detailRow = abierto ? renderPlantaDetail(r, cols.length) : '';
    return mainRow + detailRow;
  }).join('');
}

// Alterna el detalle desplegable de una fila.
function togglePlantaDetail(prodKey) {
  if (plantaExpanded[prodKey]) delete plantaExpanded[prodKey];
  else plantaExpanded[prodKey] = true;
  renderPlantaTable();
}

// Genera el <tr> con el detalle: lista de pedidos que suman el
// pendiente y (si aplica) OC de traslado que se descuentan del
// disponible.
function renderPlantaDetail(r, colspan) {
  var lineas = r._lineas || [];
  var traslados = r._traslados || [];

  // Orden natural: por empresa, luego consecutivo
  lineas = [].concat(lineas).sort(function(a, b) {
    var eA = getSigla(a.empresa), eB = getSigla(b.empresa);
    if (eA !== eB) return eA.localeCompare(eB, 'es');
    return String(a.consecutivo).localeCompare(String(b.consecutivo), 'es', { numeric: true });
  });

  var lineasHTML = '<div style="margin-bottom:10px">' +
    '<div style="font-weight:700;font-size:0.78rem;color:#1a5276;margin-bottom:4px">📋 ' + lineas.length + ' línea(s) de pedido suman ' + r.pendiente.toLocaleString('es-CO') + ' unidades</div>' +
    '<table style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:4px">' +
    '<thead><tr style="background:#f7fafc">' +
      '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Empresa</th>' +
      '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Consecutivo</th>' +
      '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Cliente</th>' +
      '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Comercial</th>' +
      '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Presentación</th>' +
      '<th style="text-align:right;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Pedida</th>' +
      '<th style="text-align:right;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Entregada</th>' +
      '<th style="text-align:right;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Pendiente</th>' +
      '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Fecha</th>' +
      '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Estado</th>' +
    '</tr></thead>' +
    '<tbody>' +
    lineas.map(function(l) {
      return '<tr>' +
        '<td style="padding:3px 8px;font-size:0.74rem;border-bottom:1px solid #f0f4f8"><span class="badge-emp" style="background:#ebf5fb;color:#1a5276">' + getSigla(l.empresa) + '</span></td>' +
        '<td style="padding:3px 8px;font-size:0.74rem;font-weight:700;border-bottom:1px solid #f0f4f8">' + (l.consecutivo || '—') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.74rem;border-bottom:1px solid #f0f4f8;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (l.cliente || '').replace(/"/g, '&quot;') + '">' + (l.cliente || '—') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.74rem;color:#4a5568;border-bottom:1px solid #f0f4f8">' + (l.comercial || '—') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.74rem;color:#4a5568;border-bottom:1px solid #f0f4f8">' + (l.presentacion || '—') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.74rem;text-align:right;border-bottom:1px solid #f0f4f8">' + l.cantidad.toLocaleString('es-CO') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.74rem;text-align:right;color:#27ae60;border-bottom:1px solid #f0f4f8">' + l.entregada.toLocaleString('es-CO') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.74rem;text-align:right;font-weight:700;color:#e74c3c;border-bottom:1px solid #f0f4f8">' + l.pendiente.toLocaleString('es-CO') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.72rem;color:#4a5568;border-bottom:1px solid #f0f4f8;white-space:nowrap">' + (l.fecha ? fmtDate(l.fecha) : '—') + '</td>' +
        '<td style="padding:3px 8px;font-size:0.72rem;color:#4a5568;border-bottom:1px solid #f0f4f8">' + (l.estado2 || '—') + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';

  var trasladosHTML = '';
  if (traslados.length) {
    trasladosHTML = '<div>' +
      '<div style="font-weight:700;font-size:0.78rem;color:#e67e22;margin-bottom:4px">🚚 ' + traslados.length + ' OC de traslado pendiente(s) que descontamos del disponible (' + r.trasladosPend.toLocaleString('es-CO') + ' unidades)</div>' +
      '<table style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:4px">' +
      '<thead><tr style="background:#fef5e7">' +
        '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Consecutivo</th>' +
        '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Origen → Destino</th>' +
        '<th style="text-align:right;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Cantidad</th>' +
        '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Fecha</th>' +
        '<th style="text-align:left;padding:4px 8px;font-size:0.7rem;color:#4a5568;border-bottom:1px solid #e2e8f0">Ref. Pedido</th>' +
      '</tr></thead>' +
      '<tbody>' +
      traslados.map(function(t) {
        return '<tr>' +
          '<td style="padding:3px 8px;font-size:0.74rem;font-weight:700;border-bottom:1px solid #f0f4f8">' + (t.consecutivo || '—') + '</td>' +
          '<td style="padding:3px 8px;font-size:0.74rem;border-bottom:1px solid #f0f4f8">' + getSigla(t.origen) + ' → ' + getSigla(t.destino) + '</td>' +
          '<td style="padding:3px 8px;font-size:0.74rem;text-align:right;font-weight:700;color:#e67e22;border-bottom:1px solid #f0f4f8">' + t.cantidad.toLocaleString('es-CO') + '</td>' +
          '<td style="padding:3px 8px;font-size:0.72rem;color:#4a5568;border-bottom:1px solid #f0f4f8;white-space:nowrap">' + (t.fecha ? fmtDate(t.fecha) : '—') + '</td>' +
          '<td style="padding:3px 8px;font-size:0.72rem;color:#4a5568;border-bottom:1px solid #f0f4f8">' + (t.refPedido || '—') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  return '<tr class="planta-detail">' +
    '<td colspan="' + colspan + '" style="background:#f7fafc;padding:12px 16px;border-top:1px dashed #cbd5e0">' +
    lineasHTML + trasladosHTML +
    '</td>' +
    '</tr>';
}

function exportPlanta() {
  var rows = sortedPlanta();
  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }
  var empresasList = _empresasVisibles();
  var data = rows.map(function(r) {
    var base = {
      'Producto': r.producto || '',
      'Presentación(es)': r.presentaciones || '',
      'Pendiente': r.pendiente
    };
    empresasList.forEach(function(e) { base[e.sigla] = r.porEmp[e.value] || 0; });
    base['Exist. total holding'] = r.existHolding;
    base['Traslados pend. aprobar'] = r.trasladosPend;
    base['A producir'] = r.producir;
    base['Estado'] = r.estado === 'verde' ? 'Cubierto' : r.estado === 'amarillo' ? 'Cubierto con traslados' : 'Requiere producción';
    return base;
  });
  var ws = XLSX.utils.json_to_sheet(data);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planta');
  XLSX.writeFile(wb, 'programacion_planta_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' productos');
}

// ══════════════════════════════════════════════════════════════
// TRASLADOS PENDIENTES DE APROBAR
// ══════════════════════════════════════════════════════════════

function buildTraslados() {
  var fEmp = document.getElementById('rf-emp').value;
  var fTxt = (document.getElementById('rf-txt').value || '').toLowerCase();

  trasladosData = ordenesCompra.filter(function(oc) {
    if ((oc.Tipo || 'Compra') !== 'Traslado') return false;
    if (String(oc.Remision || '').trim()) return false;
    if ((oc.Estado || '').toLowerCase() === 'anulada') return false;
    if (fEmp && oc.Empresa_Destino !== fEmp && oc.Empresa_Origen !== fEmp) return false;
    if (fTxt) {
      var hay = ((oc.Producto || '') + ' ' + (oc.Consecutivo || '') + ' ' + (oc.Ref_Pedido || '')).toLowerCase();
      if (hay.indexOf(fTxt) < 0) return false;
    }
    return true;
  }).map(function(oc) {
    return {
      id: oc.id,
      consecutivo: oc.Consecutivo || '',
      origen: oc.Empresa_Origen || '',
      destino: oc.Empresa_Destino || '',
      producto: oc.Producto || '',
      presentacion: oc.Presentacion || '',
      cantidad: Number(oc.Cantidad) || 0,
      fecha: oc.Fecha || '',
      refPedido: oc.Ref_Pedido || '',
      observaciones: oc.Observaciones || ''
    };
  });

  var pedidosSet = {};
  var empresasSet = {};
  trasladosData.forEach(function(r) {
    if (r.refPedido) pedidosSet[r.refPedido] = true;
    if (r.origen) empresasSet[r.origen] = true;
  });

  document.getElementById('st-tr-total').textContent    = trasladosData.length.toLocaleString('es-CO');
  document.getElementById('st-tr-empresas').textContent = Object.keys(empresasSet).length.toLocaleString('es-CO');
  document.getElementById('st-tr-unidades').textContent = trasladosData.reduce(function(s, r) { return s + r.cantidad; }, 0).toLocaleString('es-CO');
  document.getElementById('st-tr-pedidos').textContent  = Object.keys(pedidosSet).length.toLocaleString('es-CO');

  renderTrasladosTable();
}

function toggleTrasladosSort(col) {
  if (trasladosSort.col === col) {
    trasladosSort.dir = trasladosSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    trasladosSort.col = col;
    trasladosSort.dir = (col === 'fecha' || col === 'cantidad') ? 'desc' : 'asc';
  }
  renderTrasladosTable();
}

function sortedTraslados() {
  var col = trasladosSort.col;
  var dir = trasladosSort.dir;
  return [].concat(trasladosData).sort(function(a, b) {
    var va, vb;
    if (col === 'fecha') { va = +(new Date(a.fecha || 0)); vb = +(new Date(b.fecha || 0)); }
    else if (col === 'cantidad') { va = a.cantidad; vb = b.cantidad; }
    else if (col === 'consecutivo') { va = a.consecutivo; vb = b.consecutivo; }
    else if (col === 'origen') { va = getSigla(a.origen); vb = getSigla(b.origen); }
    else if (col === 'destino') { va = getSigla(a.destino); vb = getSigla(b.destino); }
    else if (col === 'producto') { va = a.producto; vb = b.producto; }
    else if (col === 'ref') { va = a.refPedido; vb = b.refPedido; }
    else { va = +(new Date(a.fecha || 0)); vb = +(new Date(b.fecha || 0)); }
    var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });
}

function renderTrasladosTable() {
  var cols = [
    { id: 'fecha', label: 'Fecha' },
    { id: 'consecutivo', label: 'Consecutivo' },
    { id: 'origen', label: 'Origen' },
    { id: 'destino', label: 'Destino' },
    { id: 'producto', label: 'Producto' },
    { id: 'cantidad', label: 'Cantidad' },
    { id: 'ref', label: 'Ref. Pedido' },
    { id: '_act', label: '' }
  ];
  document.getElementById('tr-head').innerHTML = cols.map(function(c) {
    var cls = trasladosSort.col === c.id ? (trasladosSort.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    if (c.id === '_act') return '<th></th>';
    return '<th class="' + cls + '" onclick="toggleTrasladosSort(\'' + c.id + '\')">' + c.label + '</th>';
  }).join('');

  document.getElementById('tr-count').textContent = '(' + trasladosData.length + ' OC)';

  var rows = sortedTraslados();
  var tbody = document.getElementById('tr-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="' + cols.length + '"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay traslados pendientes de aprobar. 🎉</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    return '<tr>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.fecha) + '</td>' +
      '<td style="font-weight:700;font-size:0.82rem">' + (r.consecutivo || '—') + '</td>' +
      '<td><span class="badge-emp" style="background:#fef5e7;color:#b7791f">' + getSigla(r.origen) + '</span></td>' +
      '<td><span class="badge-emp" style="background:#ebf5fb;color:#1a5276">' + getSigla(r.destino) + '</span></td>' +
      '<td style="font-weight:600;font-size:0.82rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.producto || '').replace(/"/g, '&quot;') + '">' + (r.producto || '—') + '</td>' +
      '<td class="money" style="font-weight:700;color:#e74c3c">' + r.cantidad.toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.78rem;color:#4a5568">' + (r.refPedido || '—') + '</td>' +
      '<td><a href="ordenes.html" style="background:#1a5276;color:white;text-decoration:none;padding:5px 10px;border-radius:5px;font-size:0.72rem;font-weight:600;white-space:nowrap">Ir a Órdenes ↗</a></td>' +
    '</tr>';
  }).join('');
}

function exportTraslados() {
  var rows = sortedTraslados();
  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }
  var data = rows.map(function(r) {
    return {
      'Fecha': r.fecha ? fmtDate(r.fecha) : '',
      'Consecutivo': r.consecutivo,
      'Empresa Origen': getSigla(r.origen),
      'Empresa Destino': getSigla(r.destino),
      'Producto': r.producto,
      'Presentación': r.presentacion,
      'Cantidad': r.cantidad,
      'Ref. Pedido': r.refPedido,
      'Observaciones': r.observaciones
    };
  });
  var ws = XLSX.utils.json_to_sheet(data);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Traslados pendientes');
  XLSX.writeFile(wb, 'traslados_pendientes_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' OC');
}

// ── Remisiones report ──
var remData = [];
var remSortLevels = [{ col: 'empresa', dir: 'asc' }];

function _addRemision(map, key, empresa, numRem, modulo, referencia, detalle, cantidad, fecha, empresaOrigen, empresaDestino) {
  if (!map[key]) {
    map[key] = {
      empresa: getSigla(empresa),
      empresaFull: empresa,
      remision: numRem,
      modulo: modulo,
      referencias: {},
      detalles: [],
      cantidad: 0,
      fechas: [],
      empresaOrigen: empresaOrigen || '',
      empresaDestino: empresaDestino || ''
    };
  }
  var row = map[key];
  if (referencia) row.referencias[referencia] = true;
  var cant = Number(cantidad) || 0;
  if (detalle) row.detalles.push({ text: detalle, cantidad: cant, fecha: String(fecha || ''), referencia: referencia || '' });
  row.cantidad += cant;
  if (fecha) row.fechas.push(String(fecha));
}

function buildRemisiones() {
  try { _buildRemisionesInner(); } catch(err) {
    document.getElementById('rem-body').innerHTML = '<tr><td colspan="9"><div class="empty-msg">Error: ' + err.message + '</div></td></tr>';
  }
}
function _buildRemisionesInner() {
  var fEmp = document.getElementById('rf-emp').value;
  var fTxt = document.getElementById('rf-txt').value.toLowerCase();

  var map = {};
  var empresasSet = {};
  var totalLineas = 0;

  // 1. Pedidos — campo Remisiones (formato estructurado: rem|cant|fecha,rem|cant|fecha)
  pedidos.forEach(function(p) {
    var rem = String(p.Remisiones || '').trim();
    if (!rem) return;
    var empNombre = p.Nombre_Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    var parts = rem.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    var hasStructured = parts.some(function(pt) { return pt.indexOf('|') >= 0; });
    parts.forEach(function(part) {
      var numRem, cant, fecha;
      if (hasStructured) {
        var segs = part.split('|');
        numRem = (segs[0] || '').trim();
        cant = Number(segs[1]) || 0;
        fecha = (segs[2] || '').trim();
      } else {
        numRem = part;
        cant = Number(p.Cant_Entregada) || 0;
        fecha = p.Fecha_Ult_Entrega || '';
      }
      if (!numRem) return;
      if (fTxt && numRem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
      var key = empNombre + '||' + numRem + '||Pedido';
      _addRemision(map, key, empNombre, numRem, 'Pedido', 'Orden ' + (p.Consecutivo || ''), (p.Producto || '') + ' (' + (p.Presentacion || '') + ')', cant, fecha);
      empresasSet[getSigla(empNombre)] = true;
      totalLineas++;
    });
  });

  // 2. Ingresos — campos Remision_Origen y Remision_Destino
  ingresos.forEach(function(ing) {
    var empOrigen = ing.Empresa_Origen || '';
    var empDestino = ing.Empresa_Destino || '';
    var rems = [];
    if (String(ing.Remision_Origen || '').trim()) rems.push({ num: String(ing.Remision_Origen || '').trim(), emp: empOrigen || empDestino });
    if (String(ing.Remision_Destino || '').trim()) rems.push({ num: String(ing.Remision_Destino || '').trim(), emp: empDestino || empOrigen });
    rems.forEach(function(r) {
      if (fEmp && r.emp !== fEmp && empOrigen !== fEmp && empDestino !== fEmp) return;
      if (fTxt && r.num.toLowerCase().indexOf(fTxt) < 0 && getSigla(r.emp).toLowerCase().indexOf(fTxt) < 0) return;
      var key = r.emp + '||' + r.num + '||Ingreso';
      _addRemision(map, key, r.emp, r.num, 'Ingreso', ing.Origen || '', (ing.Producto || '') + ' (' + (ing.Presentacion || '') + ')', ing.Cantidad, ing.Fecha);
      empresasSet[getSigla(r.emp)] = true;
      totalLineas++;
    });
  });

  // 3. Órdenes de Compra — campo Remision
  ordenesCompra.forEach(function(oc) {
    var rem = String(oc.Remision || '').trim();
    if (!rem) return;
    var empNombre = oc.Empresa_Destino || oc.Empresa_Origen || '';
    if (fEmp && empNombre !== fEmp && (oc.Empresa_Origen || '') !== fEmp) return;
    if (fTxt && rem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
    var key = empNombre + '||' + rem + '||Orden de Compra';
    _addRemision(map, key, empNombre, rem, 'Orden de Compra', 'OC ' + (oc.Consecutivo || ''), (oc.Producto || '') + ' (' + (oc.Presentacion || '') + ')', oc.Cantidad, oc.Fecha, oc.Empresa_Origen || '', oc.Empresa_Destino || '');
    empresasSet[getSigla(empNombre)] = true;
    totalLineas++;
  });

  // 4. Muestras — campo Remision
  muestras.forEach(function(m) {
    var rem = String(m.Remision || '').trim();
    if (!rem) return;
    var empNombre = m.Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    if (fTxt && rem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
    var key = empNombre + '||' + rem + '||Muestra';
    _addRemision(map, key, empNombre, rem, 'Muestra', 'Sol. ' + (m.Consecutivo || ''), (m.Producto || '') + ' (' + (m.Presentacion || '') + ')', m.Cant_Entregada || m.Cantidad, m.Fecha_Entrega || m.Fecha_Solicitud);
    empresasSet[getSigla(empNombre)] = true;
    totalLineas++;
  });

  // 5. Reenvases — campo Remision
  reenvases.forEach(function(re) {
    var rem = String(re.Remision || '').trim();
    if (!rem) return;
    var empNombre = re.Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    if (fTxt && rem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
    var key = empNombre + '||' + rem + '||Salida a producción';
    _addRemision(map, key, empNombre, rem, 'Salida a producción', '', (re.Producto || '') + ' (' + (re.Presentacion || '') + ')', re.Cantidad, re.Fecha);
    empresasSet[getSigla(empNombre)] = true;
    totalLineas++;
  });

  // 6. Devoluciones — Remisión de Ingreso y Remisión de Salida
  devoluciones.forEach(function(d) {
    var empNombre = d.Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    var remIngreso = String(d.Remision_Ingreso || d.Remision || '').trim();
    if (remIngreso) {
      if (!fTxt || remIngreso.toLowerCase().indexOf(fTxt) >= 0 || getSigla(empNombre).toLowerCase().indexOf(fTxt) >= 0) {
        var keyIng = empNombre + '||' + remIngreso + '||Devolución (Ingreso)';
        _addRemision(map, keyIng, empNombre, remIngreso, 'Dev. Ingreso', 'Dev. ' + (d.Consecutivo || ''), (d.Producto || '') + ' (' + (d.Presentacion || '') + ')', d.Cantidad, d.Fecha_Ingreso || d.Fecha_Devolucion || d.Fecha);
        empresasSet[getSigla(empNombre)] = true;
        totalLineas++;
      }
    }
    var remSalida = String(d.Remision_Salida || '').trim();
    if (remSalida) {
      if (!fTxt || remSalida.toLowerCase().indexOf(fTxt) >= 0 || getSigla(empNombre).toLowerCase().indexOf(fTxt) >= 0) {
        var keySal = empNombre + '||' + remSalida + '||Devolución (Salida)';
        _addRemision(map, keySal, empNombre, remSalida, 'Dev. Salida', 'Dev. ' + (d.Consecutivo || ''), (d.Producto || '') + ' (' + (d.Presentacion || '') + ')', d.Cantidad, d.Fecha_Salida || d.Fecha);
        empresasSet[getSigla(empNombre)] = true;
        totalLineas++;
      }
    }
  });

  // 7. Cambios de Mercancía — Remisión de Ingreso y Salida
  var cambiosGrouped = {};
  cambiosMerc.forEach(function(c) {
    var key = (c.Empresa||'') + '||' + (c.Consecutivo || c.id);
    if (!cambiosGrouped[key]) cambiosGrouped[key] = [];
    cambiosGrouped[key].push(c);
  });
  Object.keys(cambiosGrouped).forEach(function(gKey) {
    var lines = cambiosGrouped[gKey];
    var r = lines[0];
    if (r.Estado !== 'Cerrado') return;
    var empNombre = r.Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    var remIngreso = String(r.Remision_Ingreso || '').trim();
    var remSalida = String(r.Remision_Salida || '').trim();
    if (remIngreso || remSalida) {
      if (remIngreso) {
        if (!fTxt || remIngreso.toLowerCase().indexOf(fTxt) >= 0 || getSigla(empNombre).toLowerCase().indexOf(fTxt) >= 0) {
          var keyIng = empNombre + '||' + remIngreso + '||Cambio (Ingreso)';
          lines.forEach(function(l) {
            _addRemision(map, keyIng, empNombre, remIngreso, 'Cambio Ingreso', 'Cambio ' + (r.Consecutivo || ''), (l.Producto || '') + ' (' + (l.Tipo_Linea || '') + ')', l.Cantidad, r.Fecha_Ingreso);
            totalLineas++;
          });
          empresasSet[getSigla(empNombre)] = true;
        }
      }
      if (remSalida) {
        if (!fTxt || remSalida.toLowerCase().indexOf(fTxt) >= 0 || getSigla(empNombre).toLowerCase().indexOf(fTxt) >= 0) {
          var keySal = empNombre + '||' + remSalida + '||Cambio (Salida)';
          lines.forEach(function(l) {
            _addRemision(map, keySal, empNombre, remSalida, 'Cambio Salida', 'Cambio ' + (r.Consecutivo || ''), (l.Producto || '') + ' (' + (l.Tipo_Linea || '') + ')', l.Cantidad, r.Fecha_Salida);
            totalLineas++;
          });
          empresasSet[getSigla(empNombre)] = true;
        }
      }
    } else {
      var m = (r.Observaciones||'').match(/\[Remisión:\s*(.+?)\s*\|\s*Fecha:\s*(.+?)\]/);
      if (!m) return;
      var numRem = m[1];
      var fechaRem = m[2];
      if (fTxt && numRem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
      var key = empNombre + '||' + numRem + '||Cambio';
      lines.forEach(function(l) {
        _addRemision(map, key, empNombre, numRem, 'Cambio', 'Cambio ' + (r.Consecutivo || ''), (l.Producto || '') + ' (' + (l.Tipo_Linea || '') + ')', l.Cantidad, fechaRem);
        totalLineas++;
      });
      empresasSet[getSigla(empNombre)] = true;
    }
  });

  // 8. Kardex NC — Ingresos y Salidas de Producto No Conforme
  kardexNC.forEach(function(nc) {
    var rem = String(nc.Remision || '').trim();
    if (!rem) return;
    var empNombre = nc.Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    if (fTxt && rem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
    var tipoLabel = nc.Tipo === 'Ingreso_NC' ? 'NC Ingreso' : 'NC Salida';
    var key = empNombre + '||' + rem + '||' + tipoLabel;
    _addRemision(map, key, empNombre, rem, tipoLabel, nc.Motivo || '', (nc.Producto || '') + ' (' + (nc.Presentacion || '') + ')', nc.Cantidad, nc.Fecha);
    empresasSet[getSigla(empNombre)] = true;
    totalLineas++;
  });

  // 9. Remisiones anuladas (registro manual)
  remisionesAnuladas.forEach(function(ra) {
    var rem = String(ra.Remision || '').trim();
    if (!rem) return;
    var empNombre = ra.Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    if (fTxt && rem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
    var key = empNombre + '||' + rem + '||Anulada';
    _addRemision(map, key, empNombre, rem, 'Anulada', ra.Observaciones || '', (ra.Producto || '') + ' (' + (ra.Presentacion || '') + ')', ra.Cantidad, ra.Fecha);
    if (map[key]) map[key]._anulada_id = ra.__row || ra.id;
    empresasSet[getSigla(empNombre)] = true;
    totalLineas++;
  });

  remData = Object.values(map).map(function(r) {
    r.referenciasStr = Object.keys(r.referencias).join(', ') || '—';
    r.numDetalles = r.detalles.length;
    r.fecha = r.fechas.length ? r.fechas.sort().pop() : '';
    return r;
  });

  document.getElementById('st-rem-total').textContent = remData.length;
  document.getElementById('st-rem-empresas').textContent = Object.keys(empresasSet).length;
  var modulosSet = {};
  remData.forEach(function(r) { modulosSet[r.modulo] = true; });
  document.getElementById('st-rem-ordenes').textContent = Object.keys(modulosSet).length;
  document.getElementById('st-rem-lineas').textContent = totalLineas;

  renderRemTable();
}

function toggleRemSort(col, e) {
  var shift = e && e.shiftKey;
  var idx = remSortLevels.findIndex(function(l) { return l.col === col; });
  if (shift) {
    if (idx >= 0) { remSortLevels.splice(idx, 1); }
    else { remSortLevels.push({ col: col, dir: col === 'cantidad' || col === 'numDetalles' ? 'desc' : 'asc' }); }
  } else {
    if (idx >= 0) {
      if (remSortLevels[idx].dir === 'asc') remSortLevels[idx].dir = 'desc';
      else remSortLevels.splice(idx, 1);
    } else {
      remSortLevels = [{ col: col, dir: col === 'cantidad' || col === 'numDetalles' ? 'desc' : 'asc' }];
    }
  }
  renderRemTable();
}

function sortedRemData() {
  if (!remSortLevels.length) return [].concat(remData);
  return [].concat(remData).sort(function(a, b) {
    for (var s = 0; s < remSortLevels.length; s++) {
      var col = remSortLevels[s].col;
      var dir = remSortLevels[s].dir;
      var va = a[col], vb = b[col];
      if (va === undefined) va = '';
      if (vb === undefined) vb = '';
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function toggleRemDetail(idx, e) {
  if (e) e.stopPropagation();
  var detail = document.getElementById('rem-detail-' + idx);
  var mainRow = document.getElementById('rem-row-' + idx);
  var chevron = document.getElementById('rem-chev-' + idx);
  if (detail.classList.contains('open')) {
    detail.classList.remove('open');
    mainRow.classList.remove('rem-open');
    chevron.textContent = '▶';
  } else {
    detail.classList.add('open');
    mainRow.classList.add('rem-open');
    chevron.textContent = '▼';
  }
}

function _parseDetalle(text) {
  var m = String(text || '').match(/^(.+?)\s*\((.+?)\)\s*$/);
  return m ? { producto: m[1].trim(), presentacion: m[2].trim() } : { producto: text || '—', presentacion: '' };
}

function renderRemTable() {
  var MOD_COLORS = { 'Pedido': '#2980b9', 'Ingreso': '#27ae60', 'Orden de Compra': '#8e44ad', 'Muestra': '#e67e22', 'Salida a producción': '#d35400', 'Devolución': '#c0392b', 'Dev. Ingreso': '#e74c3c', 'Dev. Salida': '#c0392b', 'Cambio': '#16a085', 'Cambio Ingreso': '#1abc9c', 'Cambio Salida': '#16a085', 'Anulada': '#7f8c8d', 'NC Ingreso': '#e74c3c', 'NC Salida': '#c0392b' };
  var cols = [
    { id: 'empresa', label: 'Empresa' },
    { id: 'empresaOrigen', label: 'Emp. Origen' },
    { id: 'empresaDestino', label: 'Emp. Destino' },
    { id: 'remision', label: 'N° Remisión' },
    { id: 'modulo', label: 'Módulo' },
    { id: 'referenciasStr', label: 'Referencia' },
    { id: 'numDetalles', label: 'Productos' },
    { id: 'cantidad', label: 'Cantidad' },
    { id: 'fecha', label: 'Fecha' },
  ];

  document.getElementById('rem-head').innerHTML = cols.map(function(c) {
    var idx = remSortLevels.findIndex(function(l) { return l.col === c.id; });
    var cls = idx >= 0 ? (remSortLevels[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = idx >= 0 && remSortLevels.length > 1 ? '<span style="font-size:0.6rem;vertical-align:super;color:#2980b9">' + (idx+1) + '</span>' : '';
    return '<th class="' + cls + '" onclick="toggleRemSort(\'' + c.id + '\', event)">' + c.label + badge + '</th>';
  }).join('');

  document.getElementById('rem-count').textContent = '(' + remData.length + ' remisiones)';

  var rows = sortedRemData();
  var tbody = document.getElementById('rem-body');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-msg">No hay remisiones registradas con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r, idx) {
    var modColor = MOD_COLORS[r.modulo] || '#718096';
    var empOrigCell = r.empresaOrigen ? '<span class="badge-emp" style="background:#fef9e7;color:#7d6608">' + getSigla(r.empresaOrigen) + '</span>' : '—';
    var empDestCell = r.empresaDestino ? '<span class="badge-emp" style="background:#eafaf1;color:#1e8449">' + getSigla(r.empresaDestino) + '</span>' : '—';
    var deleteBtn = r._anulada_id && AUTH.canDelete() ? ' <button onclick="event.stopPropagation();deleteRemAnulada(' + r._anulada_id + ')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:0.85rem" title="Eliminar">🗑️</button>' : '';
    var hasDetalles = r.detalles && r.detalles.length > 0;

    var mainRow = '<tr class="rem-row-main" id="rem-row-' + idx + '" onclick="toggleRemDetail(' + idx + ')"' + (r.modulo === 'Anulada' ? ' style="background:#fdf2f2"' : '') + '>' +
      '<td><span class="rem-expand" id="rem-chev-' + idx + '">▶</span> <span class="badge-emp" style="background:#ebf5fb;color:#1a5276">' + r.empresa + '</span></td>' +
      '<td>' + empOrigCell + '</td>' +
      '<td>' + empDestCell + '</td>' +
      '<td style="font-weight:700;color:#2c3e50">' + r.remision + deleteBtn + '</td>' +
      '<td><span style="background:' + modColor + ';color:white;padding:2px 9px;border-radius:12px;font-size:0.72rem;font-weight:700">' + r.modulo + '</span></td>' +
      '<td style="font-size:0.8rem">' + r.referenciasStr + '</td>' +
      '<td class="center">' + r.numDetalles + '</td>' +
      '<td class="money" style="color:#27ae60;font-weight:600">' + r.cantidad.toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.8rem;color:#718096">' + (r.fecha ? fmtDate(r.fecha) : '—') + '</td>' +
    '</tr>';

    var detailRow = '<tr class="rem-detail-row" id="rem-detail-' + idx + '"><td colspan="9">';
    if (hasDetalles) {
      detailRow += '<div class="rem-detail-label">Productos en remisión ' + r.remision + ' — ' + r.empresa + ' (' + r.modulo + ')</div>';
      detailRow += '<table class="rem-detail-table"><thead><tr>' +
        '<th style="width:5%">#</th><th style="width:35%">Producto</th><th style="width:18%">Presentación</th>' +
        '<th style="width:14%;text-align:right">Cantidad</th><th style="width:14%">Fecha</th><th style="width:14%">Referencia</th>' +
        '</tr></thead><tbody>';
      r.detalles.forEach(function(d, di) {
        var p = _parseDetalle(d.text);
        detailRow += '<tr>' +
          '<td style="color:#a0aec0;font-size:0.72rem">' + (di + 1) + '</td>' +
          '<td style="font-weight:600;color:#2c3e50">' + p.producto + '</td>' +
          '<td>' + (p.presentacion || '—') + '</td>' +
          '<td class="money" style="color:#27ae60;font-weight:600">' + (d.cantidad || 0).toLocaleString('es-CO') + '</td>' +
          '<td style="font-size:0.78rem;color:#718096">' + (d.fecha ? fmtDate(d.fecha) : '—') + '</td>' +
          '<td style="font-size:0.78rem">' + (d.referencia || '—') + '</td>' +
        '</tr>';
      });
      detailRow += '</tbody></table>';
    } else {
      detailRow += '<div class="empty-msg" style="padding:12px;font-size:0.82rem">Sin detalle de productos para esta remisión.</div>';
    }
    detailRow += '</td></tr>';

    return mainRow + detailRow;
  }).join('');
}

function exportRemCSV() {
  var rows = sortedRemData();
  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var lines = ['Empresa,Emp_Origen,Emp_Destino,Remision,Modulo,Referencia,Productos,Cantidad,Fecha'];
  rows.forEach(function(r) {
    lines.push([
      '"' + r.empresa + '"',
      '"' + (r.empresaOrigen ? getSigla(r.empresaOrigen) : '') + '"',
      '"' + (r.empresaDestino ? getSigla(r.empresaDestino) : '') + '"',
      '"' + r.remision + '"',
      '"' + r.modulo + '"',
      '"' + r.referenciasStr.replace(/"/g,'""') + '"',
      r.numDetalles,
      r.cantidad,
      '"' + (r.fecha || '') + '"'
    ].join(','));
  });

  var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'remisiones_' + today() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado: ' + rows.length + ' remisiones');
}

// ── Remisiones Anuladas (manual) ──
function openAddRemAnulada() {
  document.getElementById('ra-empresa').value = '';
  document.getElementById('ra-remision').value = '';
  document.getElementById('ra-producto').value = '';
  document.getElementById('ra-presentacion').value = '';
  document.getElementById('ra-cantidad').value = '';
  document.getElementById('ra-fecha').value = today();
  document.getElementById('ra-observaciones').value = '';
  var modal = document.getElementById('modal-rem-anulada');
  modal.style.display = 'flex';
}

function closeRemAnulada() {
  document.getElementById('modal-rem-anulada').style.display = 'none';
}

async function saveRemAnulada() {
  var empresa = document.getElementById('ra-empresa').value;
  var remision = document.getElementById('ra-remision').value.trim();
  if (!empresa) { showToast('Selecciona una empresa', '#e74c3c'); return; }
  if (!remision) { showToast('Ingresa el N° de remisión', '#e74c3c'); return; }

  var btn = document.getElementById('ra-btn-save');
  btn.disabled = true; btn.textContent = 'Guardando...';

  var res = await apiPost({
    action: 'agregarRemisionAnulada',
    Empresa: empresa,
    Remision: remision,
    Producto: document.getElementById('ra-producto').value.trim(),
    Presentacion: document.getElementById('ra-presentacion').value.trim(),
    Cantidad: document.getElementById('ra-cantidad').value,
    Fecha: document.getElementById('ra-fecha').value,
    Observaciones: document.getElementById('ra-observaciones').value.trim()
  });

  btn.disabled = false; btn.textContent = 'Guardar';

  if (res.ok) {
    closeRemAnulada();
    showToast('Remisión anulada registrada');
    loadReportes();
  } else {
    showToast('Error: ' + (res.error || 'desconocido'), '#e74c3c');
  }
}

async function deleteRemAnulada(id) {
  if (!confirm('¿Eliminar esta remisión anulada?')) return;
  var res = await apiPost({ action: 'eliminarRemisionAnulada', row: id });
  if (res.ok) {
    showToast('Remisión anulada eliminada');
    loadReportes();
  } else {
    showToast('Error: ' + (res.error || 'desconocido'), '#e74c3c');
  }
}

// ── Init ──
loadReportes();
