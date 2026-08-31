// ── Dashboard State ──
var dPedidos = [];
var dDevoluciones = [];
var dIngresos = [];
var dOrdenes = [];
var dMuestras = [];
var dReenvases = [];
var dExist = null;   // snapshot de Existencias (mismo cálculo que Kardex / Inventario / Reportes)
var dOrders = [];    // órdenes derivadas: 1 por (empresa, consecutivo, cliente) — igual que Pedidos

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

// Rango de fechas por defecto al abrir el dashboard (fecha del pedido — desde).
var DASH_DEFAULT_DESDE = '2026-07-01';

// Valor en millones de COP, compacto para tablas: $0,5 M · $45 M · $1.046 M
function dMoneyM(v) {
  var n = (Number(v) || 0) / 1e6;
  var dec = (n !== 0 && Math.abs(n) < 10) ? 1 : 0;
  return '$' + n.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' M';
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
  if (vals.indexOf('Bloqueado por cartera') >= 0) return 'Bloqueado por cartera';
  if (vals.indexOf('Entregado por proveedor') >= 0) return 'Entregado por proveedor';
  if (vals.every(function(v) { return v === 'Cerrado'; })) return 'Cerrado';
  if (vals.every(function(v) { return v === 'Cerrado' || v === 'Alistado'; })) return 'Alistado';
  return 'Abierto';
}

// mismo criterio que reportes.js:buildReport para "producto pendiente"
var D_ESTADOS_NO_PENDIENTE = { 'Anulado': 1, 'Alistado': 1, 'Cerrado': 1, 'Bloqueado por cartera': 1, 'Entregado por proveedor': 1 };
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
        comercial: (p.Comercial || '').trim(),
        fechaPedido: p.Fecha_Pedido || '',
        fechaUltEntrega: p.Fecha_Ult_Entrega || '',
        lines: []
      };
    }
    var o = map[key];
    o.lines.push(p);
    if (p.Fecha_Ult_Entrega && (!o.fechaUltEntrega || p.Fecha_Ult_Entrega > o.fechaUltEntrega)) {
      o.fechaUltEntrega = p.Fecha_Ult_Entrega;
    }
    if (p.Comercial && !o.comercial) o.comercial = (p.Comercial || '').trim();
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

    // Valor ($COP). Se excluyen líneas anuladas. Valor pedido = Valor_Total
    // (= Valor_Unitario × Cantidad); entregado = Valor_Unitario × Cant_Entregada.
    o.valorPedido = 0; o.valorEntregado = 0; o.lineasSinPrecio = 0;
    o.lines.forEach(function(l) {
      if ((l.Estado_2 || 'Abierto').trim() === 'Anulado') return;
      var vu = Number(l.Valor_Unitario) || 0;
      var cant = Number(l.Cantidad) || 0;
      o.valorPedido += Number(l.Valor_Total) || (vu * cant);
      o.valorEntregado += vu * (Number(l.Cant_Entregada) || 0);
      if (vu === 0 && cant > 0) o.lineasSinPrecio++;
    });
    o.valorPendiente = Math.max(0, o.valorPedido - o.valorEntregado);
    return o;
  });
}

// ── Load ──
async function loadDashboard() {
  await _authReady;
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
      apiGet('getPedidos', { columns: 'Nombre_Empresa,Cliente,Cant_Entregada,Cantidad,Estado_2,Estado_Entrega,Consecutivo,Fecha_Ult_Entrega,Fecha_Pedido,Producto,Comercial,Valor_Unitario,Valor_Total' }),
      apiGet('getDevoluciones', { columns: 'Empresa,Estado,Motivo,Fecha' }).catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getIngresos', { columns: 'Empresa_Origen,Empresa_Destino,Cantidad,Fecha' }).catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Empresa_Destino,Empresa_Origen,Estado,Fecha' }).catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras', { columns: 'Empresa,Estado,Fecha_Solicitud' }).catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases', { columns: 'Empresa,Cantidad,Fecha' }).catch(function() { return { ok: true, reenvases: [] }; })
    ]);

    if (!results[0].ok) throw new Error(results[0].error || 'Error al cargar pedidos');

    dPedidos = (results[0].pedidos || []).filter(function(p) {
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente';
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

    dDevoluciones = results[1].devoluciones || [];
    dIngresos = results[2].ingresos || [];
    dOrdenes = results[3].ordenes || [];
    dMuestras = results[4].muestras || [];
    dReenvases = results[5].reenvases || [];

    // Snapshot de existencias — mismo cálculo que Kardex / Inventario / Reportes.
    try {
      if (typeof Existencias !== 'undefined' && Existencias.loadSnapshot) {
        dExist = await Existencias.loadSnapshot();
      }
    } catch (e) {
      dExist = null;
      console.warn('No se pudo cargar snapshot de existencias:', e);
    }

    populateDashFilters();
    buildDashboard();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Ultima actualizacion: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase';
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
var dashFiltersAttached = false;
function populateDashFilters() {
  var emps = [];
  dPedidos.forEach(function(p) {
    if (p.Nombre_Empresa && emps.indexOf(p.Nombre_Empresa) < 0 && AUTH.hasCompany(p.Nombre_Empresa)) emps.push(p.Nombre_Empresa);
  });
  emps.sort();
  var sel = document.getElementById('df-emp');
  sel.innerHTML = '<option value="">Todas</option>' + emps.map(function(e) {
    return '<option value="' + escHtml(e) + '">' + escHtml(dGetSigla(e)) + ' — ' + escHtml(e) + '</option>';
  }).join('');

  if (!dashFiltersAttached) {
    var dDesde = document.getElementById('df-desde');
    var dHasta = document.getElementById('df-hasta');
    if (!dDesde.value) dDesde.value = DASH_DEFAULT_DESDE;
    sel.addEventListener('change', buildDashboard);
    dDesde.addEventListener('change', buildDashboard);
    dHasta.addEventListener('change', buildDashboard);
    dashFiltersAttached = true;
  }
}

function clearDashFilters() {
  document.getElementById('df-emp').value = '';
  document.getElementById('df-desde').value = DASH_DEFAULT_DESDE;
  document.getElementById('df-hasta').value = '';
  buildDashboard();
}

// ── Build Dashboard ──
function buildDashboard() {
  var fEmp = document.getElementById('df-emp').value;
  var fDesde = document.getElementById('df-desde').value;   // 'YYYY-MM-DD' | ''
  var fHasta = document.getElementById('df-hasta').value;   // 'YYYY-MM-DD' | ''

  // Rango por fecha del pedido — mismo criterio que pedidos.js: compara por
  // prefijo YYYY-MM-DD (la fecha puede venir con hora o como Date serializada).
  // Cada módulo se filtra por su propia fecha: Devoluciones/Ingresos/OC/Salidas
  // por 'Fecha', Muestras por 'Fecha_Solicitud'. El snapshot de existencias
  // (stock) es siempre "a hoy" y no se ve afectado por el rango.
  function dInRango(fecha) {
    if (!fDesde && !fHasta) return true;
    var f10 = String(fecha || '').slice(0, 10);
    if (fDesde && f10 < fDesde) return false;
    if (fHasta && f10 > fHasta) return false;
    return true;
  }

  var ped = dPedidos.filter(function(p) {
    return (!fEmp || p.Nombre_Empresa === fEmp) && dInRango(p.Fecha_Pedido);
  });
  var dev = dDevoluciones.filter(function(d) {
    return (!fEmp || d.Empresa === fEmp) && dInRango(d.Fecha);
  });
  var oc = dOrdenes.filter(function(o) {
    return (!fEmp || o.Empresa_Destino === fEmp || o.Empresa_Origen === fEmp) && dInRango(o.Fecha);
  });
  var mue = dMuestras.filter(function(m) {
    return (!fEmp || m.Empresa === fEmp) && dInRango(m.Fecha_Solicitud);
  });
  var ree = dReenvases.filter(function(r) {
    return (!fEmp || r.Empresa === fEmp) && dInRango(r.Fecha);
  });
  var ing = dIngresos.filter(function(i) {
    return (!fEmp || i.Empresa_Origen === fEmp || i.Empresa_Destino === fEmp) && dInRango(i.Fecha);
  });

  dOrders = dBuildOrders(ped);

  var rangoTxt = (fDesde || fHasta)
    ? '  ·  Rango: ' + (fDesde ? fmtDate(fDesde) : 'inicio') + ' → ' + (fHasta ? fmtDate(fHasta) : 'hoy')
    : '';
  document.getElementById('dash-ts').textContent = 'Actualizado: ' + new Date().toLocaleString('es-CO') + rangoTxt;

  buildKPIs(dOrders, ped, dev, oc, fEmp);
  buildTiempos(dOrders);
  buildTopDemora(dOrders);
  buildEntregas(dOrders);
  buildEmpresas(dOrders);
  buildTopProductos(ped);
  buildTopClientes(dOrders);
  buildDevoluciones(dev);
  buildTopComerciales(dOrders);
  buildInventario(ped, fEmp);
  buildResumenModulos(dOrders, dev, ing, oc, mue, ree, fEmp);
}

// ── Existencias (snapshot Kardex) ──
// Suma de saldos por (producto) sobre las empresas del holding visibles,
// opcionalmente filtrado a una empresa. Devuelve { productos, uds, porEmp }.
function dStockTotals(fEmp) {
  var saldos = (dExist && dExist.saldos) || {};
  var empresas = dHoldingEmpresas();
  var porEmp = {};
  empresas.forEach(function(e) { if (!fEmp || e.value === fEmp) porEmp[e.sigla] = 0; });

  var productos = 0, uds = 0;
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
  });

  return { productos: productos, uds: uds, porEmp: porEmp, disponible: dExist != null };
}

// ── 1. KPI Cards ──
function buildKPIs(orders, ped, dev, oc, fEmp) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var totalOrdenes = orders.length;
  var abiertas = orders.filter(function(o) { return o.estado2 === 'Abierto'; }).length;
  var lineas = ped.length;

  // Tasa de entrega: uds entregadas / pedidas sobre líneas no anuladas.
  var udsEntregadas = 0, udsPedidas = 0;
  ped.forEach(function(p) {
    if ((p.Estado_2 || 'Abierto').trim() === 'Anulado') return;
    udsEntregadas += Number(p.Cant_Entregada) || 0;
    udsPedidas += Number(p.Cantidad) || 0;
  });
  var tasaEntrega = udsPedidas > 0 ? Math.round((udsEntregadas / udsPedidas) * 100) : 0;

  // Tiempos por orden.
  var deliveryDays = [], delayDays = [];
  orders.forEach(function(o) {
    if (o.fechaUltEntrega && o.fechaPedido && o.cantEntregada > 0) {
      var dd = Math.round((new Date(o.fechaUltEntrega) - new Date(o.fechaPedido)) / 86400000);
      if (!isNaN(dd) && dd >= 0) deliveryDays.push(dd);
    }
    if (o.estado2 === 'Abierto' && o.esPendiente && o.fechaPedido) {
      var dd2 = Math.round((today - new Date(o.fechaPedido)) / 86400000);
      if (!isNaN(dd2) && dd2 >= 0) delayDays.push(dd2);
    }
  });

  var devPendientes = dev.filter(function(d) { return (d.Estado || '') === 'Pendiente'; }).length;
  var avgDelivery = deliveryDays.length ? Math.round(deliveryDays.reduce(function(s, v) { return s + v; }, 0) / deliveryDays.length) : 0;
  var avgDelay = delayDays.length ? Math.round(delayDays.reduce(function(s, v) { return s + v; }, 0) / delayDays.length) : 0;

  var stk = dStockTotals(fEmp);

  var html = '';
  html += kpiCard('', totalOrdenes.toLocaleString('es-CO'), 'Total ordenes', abiertas + ' abiertas · ' + lineas.toLocaleString('es-CO') + ' lineas');
  html += kpiCard('teal', tasaEntrega + '%', 'Tasa de entrega', udsEntregadas.toLocaleString('es-CO') + ' / ' + udsPedidas.toLocaleString('es-CO') + ' uds');
  html += kpiCard('green', avgDelivery + ' dias', 'Tiempo prom. entrega', deliveryDays.length + ' ordenes entregadas');
  html += kpiCard('orange', avgDelay + ' dias', 'Demora prom. pendientes', delayDays.length + ' ordenes esperando');
  html += kpiCard('red', devPendientes.toString(), 'Devoluciones pendientes', dev.length + ' total devoluciones');
  html += kpiCard('purple', stk.disponible ? stk.productos.toLocaleString('es-CO') : '—', 'Productos en stock', stk.disponible ? stk.uds.toLocaleString('es-CO') + ' uds disponibles' : 'sin snapshot');
  html += kpiCard('', oc.filter(function(o) { return (o.Estado || '') === 'Abierta'; }).length.toString(), 'OC abiertas', oc.length + ' ordenes de compra total');

  document.getElementById('kpi-main').innerHTML = html;
}

function kpiCard(cls, val, lbl, sub) {
  return '<div class="kpi ' + cls + '">' +
    '<div class="kpi-val">' + val + '</div>' +
    '<div class="kpi-lbl">' + lbl + '</div>' +
    (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
  '</div>';
}

// ── 2. Estado de Entregas ──
function buildEntregas(orders) {
  var b = { recibidos: 0, parciales: 0, entregados: 0, alistados: 0, cerrados: 0, anulados: 0, bloqueados: 0, entProv: 0 };

  orders.forEach(function(o) {
    switch (o.estado2) {
      case 'Anulado': b.anulados++; return;
      case 'Bloqueado por cartera': b.bloqueados++; return;
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
function buildEmpresas(orders) {
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

  var html = '<div class="hbar-chart">';
  empArr.forEach(function(e) {
    var pct = maxVal > 0 ? Math.max(3, (e.uds / maxVal) * 100) : 3;
    var color = EMP_COLORS[e.sigla] || '#718096';
    html += '<div class="hbar-row">' +
      '<div class="hbar-label">' + escHtml(e.sigla) + '</div>' +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%;background:' + color + '">' + e.ordenes + ' ord</div></div>' +
      '<div class="hbar-value">' + e.uds.toLocaleString('es-CO') + ' uds</div>' +
    '</div>';
  });
  html += '</div>';

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
    return '<tr>' +
      '<td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.producto) + '</td>' +
      '<td class="money" style="color:#e74c3c;font-weight:700">' + r.pendiente.toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + r.pedido.toLocaleString('es-CO') + '</td>' +
      '<td style="text-align:center"><div class="prog" style="margin:0 auto"><div class="prog-bar"><div class="prog-fill" style="width:' + avance + '%"></div></div><div class="prog-pct">' + avance + '%</div></div></td>' +
    '</tr>';
  }).join('');
}

// ── 5. Top Clientes por Volumen ──
function buildTopClientes(orders) {
  var map = {};
  orders.forEach(function(o) {
    var cli = o.cliente;
    if (!cli || cli === '—') return;
    if (!map[cli]) map[cli] = { cliente: cli, uds: 0, ordenes: 0, empresas: {} };
    map[cli].uds += o.cantPedida;
    map[cli].ordenes++;
    map[cli].empresas[o.sigla] = true;
  });

  var arr = Object.values(map);
  arr.sort(function(a, b) { return b.uds - a.uds; });
  arr = arr.slice(0, 10);

  var tbody = document.getElementById('tb-clientes');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = arr.map(function(r) {
    var empTags = Object.keys(r.empresas).sort().map(function(s) {
      var color = EMP_COLORS[s] || '#718096';
      return '<span class="sigla-badge" style="background:' + color + '20;color:' + color + '">' + escHtml(s) + '</span>';
    }).join(' ');
    return '<tr>' +
      '<td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.cliente) + '</td>' +
      '<td class="money" style="font-weight:700;color:#2980b9">' + r.uds.toLocaleString('es-CO') + '</td>' +
      '<td class="money">' + r.ordenes + '</td>' +
      '<td>' + empTags + '</td>' +
    '</tr>';
  }).join('');
}

// ── 6. Devoluciones ──
function buildDevoluciones(dev) {
  var pendientes = 0, tramitadas = 0;
  var motivoMap = {};

  dev.forEach(function(d) {
    if ((d.Estado || '') === 'Tramitada') { tramitadas++; }
    else { pendientes++; }
    var motivo = (d.Motivo || 'Sin motivo').trim();
    if (!motivoMap[motivo]) motivoMap[motivo] = 0;
    motivoMap[motivo]++;
  });

  var total = pendientes + tramitadas;
  document.getElementById('dev-sub').textContent = total + ' total';

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
function buildTopComerciales(orders) {
  var map = {};
  var sinComercial = 0, sinPrecio = 0;
  var totPed = 0, totPen = 0;

  orders.forEach(function(o) {
    sinPrecio += o.lineasSinPrecio;
    var com = o.comercial;
    if (!com) { sinComercial++; return; }
    if (!map[com]) map[com] = { comercial: com, ordenes: 0, vPed: 0, vEnt: 0, vPen: 0 };
    var m = map[com];
    m.ordenes++;
    m.vPed += o.valorPedido;
    m.vEnt += o.valorEntregado;
    m.vPen += o.valorPendiente;
    totPed += o.valorPedido;
    totPen += o.valorPendiente;
  });

  var arr = Object.values(map);
  arr.sort(function(a, b) { return b.vPed - a.vPed; });
  arr = arr.slice(0, 10);

  var subEl = document.getElementById('com-sub');
  if (subEl) subEl.textContent = 'Pedido ' + dMoneyM(totPed) + ' · pendiente ' + dMoneyM(totPen);

  var notaEl = document.getElementById('com-nota');
  if (notaEl) {
    var notas = [];
    if (sinPrecio > 0) notas.push('⚠️ ' + sinPrecio.toLocaleString('es-CO') + ' línea(s) sin precio no suman al valor');
    if (sinComercial > 0) notas.push(sinComercial.toLocaleString('es-CO') + ' orden(es) sin comercial asignado');
    notaEl.textContent = notas.join(' · ');
    notaEl.style.display = notas.length ? 'block' : 'none';
  }

  var tbody = document.getElementById('tb-comerciales');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#a0aec0;padding:20px">Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = arr.map(function(r) {
    var pct = r.vPed > 0 ? Math.round((r.vEnt / r.vPed) * 100) : 0;
    var penColor = pct >= 75 ? '#27ae60' : pct >= 40 ? '#e67e22' : '#e74c3c';
    return '<tr>' +
      '<td style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(r.comercial) + '">' + escHtml(r.comercial) + '</td>' +
      '<td class="money">' + r.ordenes + '</td>' +
      '<td class="money" style="font-weight:700;color:#2980b9">' + dMoneyM(r.vPed) + '</td>' +
      '<td class="money" style="color:#27ae60">' + dMoneyM(r.vEnt) + '</td>' +
      '<td class="money" style="font-weight:700;color:' + penColor + '">' + dMoneyM(r.vPen) + '</td>' +
    '</tr>';
  }).join('');
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

  var html = '<div style="display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Stock total</div><div style="font-size:1.4rem;font-weight:800;color:#2980b9">' + totalStock.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Comprometido</div><div style="font-size:1.4rem;font-weight:800;color:#e67e22">' + totalPend.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Disponible</div><div style="font-size:1.4rem;font-weight:800;color:' + ((totalStock - totalPend) >= 0 ? '#27ae60' : '#e74c3c') + '">' + (totalStock - totalPend).toLocaleString('es-CO') + '</div></div>';
  html += '</div>';

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

  el.innerHTML = html;
}

// ── 9. Resumen Modulos ──
function buildResumenModulos(orders, dev, ing, oc, mue, ree, fEmp) {
  var stk = dStockTotals(fEmp);

  var modules = [
    { icon: '📋', name: 'Pedidos', count: orders.length, detail: orders.reduce(function(s, o) { return s + o.lines.length; }, 0) + ' lineas' },
    { icon: '🔄', name: 'Devoluciones', count: dev.length, detail: dev.filter(function(d) { return d.Estado === 'Pendiente'; }).length + ' pendientes' },
    { icon: '📥', name: 'Ingresos', count: ing.length, detail: ing.reduce(function(s, i) { return s + (Number(i.Cantidad) || 0); }, 0).toLocaleString('es-CO') + ' uds' },
    { icon: '📦', name: 'Inventario', count: stk.disponible ? stk.productos : '—', detail: stk.disponible ? stk.uds.toLocaleString('es-CO') + ' uds en stock' : 'sin snapshot' },
    { icon: '🛒', name: 'Ordenes Compra', count: oc.length, detail: oc.filter(function(o) { return o.Estado === 'Abierta'; }).length + ' abiertas' },
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
function buildTiempos(orders) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var deliveryVals = [];
  var pendingVals = [];

  orders.forEach(function(o) {
    if (o.fechaUltEntrega && o.fechaPedido && o.cantEntregada > 0) {
      var dE = new Date(o.fechaUltEntrega), dP = new Date(o.fechaPedido);
      if (!isNaN(dE) && !isNaN(dP)) {
        var days = Math.round((dE - dP) / 86400000);
        if (days >= 0) deliveryVals.push(days);
      }
    }
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
    return '<tr>' +
      '<td style="font-weight:600"><span class="sigla-badge" style="background:' + empColor + '20;color:' + empColor + ';font-size:0.68rem">' + escHtml(r.empresa) + '</span> ' + escHtml(r.consecutivo) + '</td>' +
      '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.cliente) + '</td>' +
      '<td class="money" style="font-weight:700;color:' + color + '">' + r.dias + '</td>' +
      '<td style="text-align:center"><div class="prog" style="margin:0 auto"><div class="prog-bar"><div class="prog-fill" style="width:' + avance + '%"></div></div><div class="prog-pct">' + avance + '%</div></div></td>' +
    '</tr>';
  }).join('');
}

// ── Init ──
loadDashboard();
