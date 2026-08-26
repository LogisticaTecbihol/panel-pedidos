// ── Dashboard State ──
var dPedidos = [];
var dDevoluciones = [];
var dIngresos = [];
var dInventario = [];
var dOrdenes = [];
var dMuestras = [];
var dReenvases = [];

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
      apiGet('getPedidos', { columns: 'Nombre_Empresa,Cliente,Cant_Entregada,Cantidad,Estado_2,Estado_Entrega,Consecutivo,Fecha_Ult_Entrega,Fecha_Pedido,Producto,Comercial' }),
      apiGet('getDevoluciones', { columns: 'Empresa,Estado,Motivo' }).catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getIngresos', { columns: 'Empresa_Origen,Empresa_Destino,Cantidad' }).catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getInventario', { columns: 'Empresa,Cantidad' }).catch(function() { return { ok: true, inventario: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Empresa_Destino,Empresa_Origen,Estado' }).catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras', { columns: 'Empresa,Estado' }).catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases', { columns: 'Empresa,Cantidad' }).catch(function() { return { ok: true, reenvases: [] }; })
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
    dInventario = results[3].inventario || [];
    dOrdenes = results[4].ordenes || [];
    dMuestras = results[5].muestras || [];
    dReenvases = results[6].reenvases || [];

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
    sel.addEventListener('change', buildDashboard);
    dashFiltersAttached = true;
  }
}

function clearDashFilters() {
  document.getElementById('df-emp').value = '';
  buildDashboard();
}

// ── Build Dashboard ──
function buildDashboard() {
  var fEmp = document.getElementById('df-emp').value;

  var ped = fEmp ? dPedidos.filter(function(p) { return p.Nombre_Empresa === fEmp; }) : dPedidos;
  var dev = fEmp ? dDevoluciones.filter(function(d) { return d.Empresa === fEmp; }) : dDevoluciones;
  var inv = fEmp ? dInventario.filter(function(i) { return i.Empresa === fEmp; }) : dInventario;
  var oc = fEmp ? dOrdenes.filter(function(o) { return o.Empresa_Destino === fEmp || o.Empresa_Origen === fEmp; }) : dOrdenes;
  var mue = fEmp ? dMuestras.filter(function(m) { return m.Empresa === fEmp; }) : dMuestras;
  var ree = fEmp ? dReenvases.filter(function(r) { return r.Empresa === fEmp; }) : dReenvases;
  var ing = fEmp ? dIngresos.filter(function(i) { return i.Empresa_Origen === fEmp || i.Empresa_Destino === fEmp; }) : dIngresos;

  document.getElementById('dash-ts').textContent = 'Actualizado: ' + new Date().toLocaleString('es-CO');

  buildKPIs(ped, dev, inv, oc);
  buildTiempos(ped);
  buildTopDemora(ped);
  buildEntregas(ped);
  buildEmpresas(ped);
  buildTopProductos(ped);
  buildTopClientes(ped);
  buildDevoluciones(dev);
  buildTopComerciales(ped);
  buildInventario(inv, ped);
  buildResumenModulos(ped, dev, ing, inv, oc, mue, ree);
}

// ── 1. KPI Cards ──
function buildKPIs(ped, dev, inv, oc) {
  var ordSet = {};
  var abiertos = 0;
  var udsEntregadas = 0;
  var udsPedidas = 0;
  var today = new Date();
  today.setHours(0,0,0,0);
  var deliveryDays = [];
  var delayDays = [];
  var ordDel = {};
  var ordPend = {};

  ped.forEach(function(p) {
    var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '');
    if (!ordSet[key]) {
      ordSet[key] = true;
      if ((p.Estado_2 || 'Abierto') === 'Abierto') abiertos++;
    }
    udsEntregadas += Number(p.Cant_Entregada) || 0;
    udsPedidas += Number(p.Cantidad) || 0;

    if (p.Fecha_Ult_Entrega && p.Fecha_Pedido && (Number(p.Cant_Entregada) || 0) > 0 && !ordDel[key]) {
      var dE = new Date(p.Fecha_Ult_Entrega);
      var dP = new Date(p.Fecha_Pedido);
      if (!isNaN(dE) && !isNaN(dP)) { var dd = Math.round((dE - dP) / 86400000); if (dd >= 0) { ordDel[key] = dd; deliveryDays.push(dd); } }
    }
    var est2 = (p.Estado_2 || 'Abierto').trim();
    if (est2 === 'Abierto' && (Number(p.Cant_Pendiente) || 0) > 0 && p.Fecha_Pedido && !ordPend[key]) {
      var dP2 = new Date(p.Fecha_Pedido);
      if (!isNaN(dP2)) { var dd2 = Math.round((today - dP2) / 86400000); if (dd2 >= 0) { ordPend[key] = dd2; delayDays.push(dd2); } }
    }
  });

  var totalOrdenes = Object.keys(ordSet).length;
  var tasaEntrega = udsPedidas > 0 ? Math.round((udsEntregadas / udsPedidas) * 100) : 0;
  var devPendientes = dev.filter(function(d) { return (d.Estado || '') === 'Pendiente'; }).length;
  var avgDelivery = deliveryDays.length > 0 ? Math.round(deliveryDays.reduce(function(s,v){return s+v;},0) / deliveryDays.length) : 0;
  var avgDelay = delayDays.length > 0 ? Math.round(delayDays.reduce(function(s,v){return s+v;},0) / delayDays.length) : 0;

  var html = '';
  html += kpiCard('', totalOrdenes.toLocaleString('es-CO'), 'Total ordenes', abiertos + ' abiertas · ' + ped.length.toLocaleString('es-CO') + ' lineas');
  html += kpiCard('teal', tasaEntrega + '%', 'Tasa de entrega', udsEntregadas.toLocaleString('es-CO') + ' / ' + udsPedidas.toLocaleString('es-CO') + ' uds');
  html += kpiCard('green', avgDelivery + ' dias', 'Tiempo prom. entrega', deliveryDays.length + ' ordenes entregadas');
  html += kpiCard('orange', avgDelay + ' dias', 'Demora prom. pendientes', delayDays.length + ' ordenes esperando');
  html += kpiCard('red', devPendientes.toString(), 'Devoluciones pendientes', dev.length + ' total devoluciones');
  html += kpiCard('purple', inv.length.toLocaleString('es-CO'), 'Registros inventario', inv.reduce(function(s, i) { return s + (Number(i.Cantidad) || 0); }, 0).toLocaleString('es-CO') + ' uds en stock');
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
function buildEntregas(ped) {
  var ordMap = {};
  ped.forEach(function(p) {
    var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '');
    if (!ordMap[key]) {
      ordMap[key] = { estado: 'Recibido', est2: (p.Estado_2 || 'Abierto').trim() };
    }
    var est = (p.Estado_Entrega || 'Recibido').trim();
    if (est === 'Entregado' || ordMap[key].estado === 'Entregado') ordMap[key].estado = 'Entregado';
    else if (est === 'Alistado' || ordMap[key].estado === 'Alistado') ordMap[key].estado = 'Alistado';
    else if (est === 'Parcial' || (Number(p.Cant_Entregada) || 0) > 0) ordMap[key].estado = 'Parcial';
  });

  var recibidos = 0, parciales = 0, entregados = 0, alistados = 0, anulados = 0, cerrados = 0;
  Object.values(ordMap).forEach(function(o) {
    if (o.est2 === 'Anulado') { anulados++; return; }
    if (o.est2 === 'Alistado') { alistados++; return; }
    if (o.est2 === 'Cerrado') { cerrados++; return; }
    if (o.est2 === 'Bloqueado por cartera') { anulados++; return; }
    if (o.estado === 'Entregado') entregados++;
    else if (o.estado === 'Parcial') parciales++;
    else recibidos++;
  });

  var total = recibidos + parciales + entregados + alistados + anulados + cerrados;

  var segData = [
    { label: 'Recibidos', val: recibidos, color: '#e67e22' },
    { label: 'Parciales', val: parciales, color: '#2980b9' },
    { label: 'Entregados', val: entregados, color: '#27ae60' },
    { label: 'Alistados', val: alistados, color: '#7b1fa2' },
    { label: 'Cerrados', val: cerrados, color: '#1565c0' },
    { label: 'Anulados', val: anulados, color: '#e74c3c' },
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
function buildEmpresas(ped) {
  var empMap = {};
  ped.forEach(function(p) {
    var sigla = dGetSigla(p.Nombre_Empresa);
    if (!empMap[sigla]) empMap[sigla] = { ordenes: 0, uds: 0, _keys: {} };
    empMap[sigla].uds += Number(p.Cantidad) || 0;
    var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '');
    if (!empMap[sigla]._keys[key]) { empMap[sigla]._keys[key] = true; empMap[sigla].ordenes++; }
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
    var est2 = (p.Estado_2 || 'Abierto').trim();
    if (est2 === 'Anulado' || est2 === 'Alistado' || est2 === 'Cerrado' || est2 === 'Bloqueado por cartera') return;
    var pend = Number(p.Cant_Pendiente) || 0;
    if (pend <= 0) return;
    var prod = (p.Producto || '').toUpperCase().trim();
    if (!prod) return;
    if (!map[prod]) map[prod] = { producto: prod, pendiente: 0, pedido: 0 };
    map[prod].pendiente += pend;
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
function buildTopClientes(ped) {
  var map = {};
  ped.forEach(function(p) {
    var cli = (p.Cliente || '').trim();
    if (!cli) return;
    if (!map[cli]) map[cli] = { cliente: cli, uds: 0, ordenes: 0, empresas: {}, _keys: {} };
    map[cli].uds += Number(p.Cantidad) || 0;
    var sigla = dGetSigla(p.Nombre_Empresa);
    map[cli].empresas[sigla] = true;
    var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '');
    if (!map[cli]._keys[key]) { map[cli]._keys[key] = true; map[cli].ordenes++; }
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

// ── 7. Top Comerciales ──
function buildTopComerciales(ped) {
  var map = {};
  ped.forEach(function(p) {
    var com = (p.Comercial || '').trim();
    if (!com) return;
    if (!map[com]) map[com] = { comercial: com, ordenes: 0, uds: 0, entregada: 0, pedida: 0, _keys: {} };
    map[com].uds += Number(p.Cantidad) || 0;
    map[com].entregada += Number(p.Cant_Entregada) || 0;
    map[com].pedida += Number(p.Cantidad) || 0;
    var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '');
    if (!map[com]._keys[key]) { map[com]._keys[key] = true; map[com].ordenes++; }
  });

  var arr = Object.values(map);
  arr.sort(function(a, b) { return b.ordenes - a.ordenes; });
  arr = arr.slice(0, 10);

  var tbody = document.getElementById('tb-comerciales');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = arr.map(function(r) {
    var pct = r.pedida > 0 ? Math.round((r.entregada / r.pedida) * 100) : 0;
    var pctColor = pct >= 75 ? '#27ae60' : pct >= 40 ? '#e67e22' : '#e74c3c';
    return '<tr>' +
      '<td style="font-weight:600">' + escHtml(r.comercial) + '</td>' +
      '<td class="money">' + r.ordenes + '</td>' +
      '<td class="money">' + r.uds.toLocaleString('es-CO') + '</td>' +
      '<td style="text-align:center"><span style="background:' + pctColor + '18;color:' + pctColor + ';padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:700">' + pct + '%</span></td>' +
    '</tr>';
  }).join('');
}

// ── 8. Inventario ──
function buildInventario(inv, ped) {
  var empMap = {};
  inv.forEach(function(i) {
    var sigla = dGetSigla(i.Empresa);
    if (!empMap[sigla]) empMap[sigla] = { stock: 0, productos: 0 };
    empMap[sigla].stock += Number(i.Cantidad) || 0;
    empMap[sigla].productos++;
  });

  var pendByEmp = {};
  ped.forEach(function(p) {
    if ((p.Estado_2 || 'Abierto').trim() !== 'Abierto') return;
    var sigla = dGetSigla(p.Nombre_Empresa);
    if (!pendByEmp[sigla]) pendByEmp[sigla] = 0;
    pendByEmp[sigla] += Number(p.Cant_Pendiente) || 0;
  });

  var empArr = Object.keys(empMap);
  empArr.sort();

  var el = document.getElementById('chart-inventario');

  if (!empArr.length) {
    el.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">Sin registros de inventario</div>';
    return;
  }

  var totalStock = inv.reduce(function(s, i) { return s + (Number(i.Cantidad) || 0); }, 0);
  var totalPend = Object.values(pendByEmp).reduce(function(s, v) { return s + v; }, 0);

  var html = '<div style="display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Stock total</div><div style="font-size:1.4rem;font-weight:800;color:#2980b9">' + totalStock.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Comprometido</div><div style="font-size:1.4rem;font-weight:800;color:#e67e22">' + totalPend.toLocaleString('es-CO') + '</div></div>';
  html += '<div style="flex:1;min-width:120px"><div style="font-size:0.76rem;color:#718096;text-transform:uppercase;font-weight:600">Disponible</div><div style="font-size:1.4rem;font-weight:800;color:' + ((totalStock - totalPend) >= 0 ? '#27ae60' : '#e74c3c') + '">' + (totalStock - totalPend).toLocaleString('es-CO') + '</div></div>';
  html += '</div>';

  html += '<div class="hbar-chart">';
  empArr.forEach(function(sigla) {
    var stock = empMap[sigla].stock;
    var pend = pendByEmp[sigla] || 0;
    var maxBar = Math.max(stock, pend, 1);
    var color = EMP_COLORS[sigla] || '#718096';
    html += '<div class="hbar-row">' +
      '<div class="hbar-label">' + escHtml(sigla) + '</div>' +
      '<div class="hbar-track" style="position:relative">' +
        '<div class="hbar-fill" style="width:' + Math.max(3, (stock / maxBar) * 100) + '%;background:' + color + ';opacity:0.7">' + stock.toLocaleString('es-CO') + '</div>' +
      '</div>' +
      '<div class="hbar-value" style="color:' + ((stock - pend) >= 0 ? '#27ae60' : '#e74c3c') + '">' + (stock - pend).toLocaleString('es-CO') + '</div>' +
    '</div>';
  });
  html += '</div>';
  html += '<div style="font-size:0.72rem;color:#a0aec0;margin-top:8px;text-align:right">Barra = stock | Valor = disponible (stock - comprometido)</div>';

  el.innerHTML = html;
}

// ── 9. Resumen Modulos ──
function buildResumenModulos(ped, dev, ing, inv, oc, mue, ree) {
  var ordSet = {};
  ped.forEach(function(p) {
    ordSet[(p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '')] = true;
  });

  var modules = [
    { icon: '📋', name: 'Pedidos', count: Object.keys(ordSet).length, detail: ped.length + ' lineas' },
    { icon: '🔄', name: 'Devoluciones', count: dev.length, detail: dev.filter(function(d) { return d.Estado === 'Pendiente'; }).length + ' pendientes' },
    { icon: '📥', name: 'Ingresos', count: ing.length, detail: ing.reduce(function(s, i) { return s + (Number(i.Cantidad) || 0); }, 0).toLocaleString('es-CO') + ' uds' },
    { icon: '📦', name: 'Inventario', count: inv.length, detail: inv.reduce(function(s, i) { return s + (Number(i.Cantidad) || 0); }, 0).toLocaleString('es-CO') + ' uds' },
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
function buildTiempos(ped) {
  var today = new Date();
  today.setHours(0,0,0,0);
  var ordDelivered = {};
  var ordPending = {};

  ped.forEach(function(p) {
    var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '');
    var est2 = (p.Estado_2 || 'Abierto').trim();

    if (p.Fecha_Ult_Entrega && p.Fecha_Pedido && (Number(p.Cant_Entregada) || 0) > 0 && !ordDelivered[key]) {
      var dE = new Date(p.Fecha_Ult_Entrega);
      var dP = new Date(p.Fecha_Pedido);
      if (!isNaN(dE) && !isNaN(dP)) {
        var days = Math.round((dE - dP) / 86400000);
        if (days >= 0) ordDelivered[key] = days;
      }
    }

    if (est2 === 'Abierto' && (Number(p.Cant_Pendiente) || 0) > 0 && p.Fecha_Pedido && !ordPending[key]) {
      var dP2 = new Date(p.Fecha_Pedido);
      if (!isNaN(dP2)) {
        var dd = Math.round((today - dP2) / 86400000);
        if (dd >= 0) ordPending[key] = dd;
      }
    }
  });

  var deliveryVals = Object.values(ordDelivered);
  var pendingVals = Object.values(ordPending);

  var el = document.getElementById('chart-tiempos');
  document.getElementById('tiempos-sub').textContent = deliveryVals.length + ' entregadas / ' + pendingVals.length + ' pendientes';

  if (!deliveryVals.length && !pendingVals.length) {
    el.innerHTML = '<div style="color:#a0aec0;text-align:center;padding:20px">Sin datos de tiempos</div>';
    return;
  }

  var avgDel = deliveryVals.length ? Math.round(deliveryVals.reduce(function(s,v){return s+v;},0) / deliveryVals.length) : 0;
  var minDel = deliveryVals.length ? Math.min.apply(null, deliveryVals) : 0;
  var maxDel = deliveryVals.length ? Math.max.apply(null, deliveryVals) : 0;
  var avgPend = pendingVals.length ? Math.round(pendingVals.reduce(function(s,v){return s+v;},0) / pendingVals.length) : 0;
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
function buildTopDemora(ped) {
  var today = new Date();
  today.setHours(0,0,0,0);
  var ordMap = {};

  ped.forEach(function(p) {
    var est2 = (p.Estado_2 || 'Abierto').trim();
    if (est2 !== 'Abierto') return;
    if ((Number(p.Cant_Pendiente) || 0) <= 0) return;
    if (!p.Fecha_Pedido) return;

    var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '');
    if (!ordMap[key]) {
      var dP = new Date(p.Fecha_Pedido);
      if (isNaN(dP)) return;
      ordMap[key] = {
        consecutivo: p.Consecutivo || '—',
        cliente: (p.Cliente || '—').trim(),
        empresa: dGetSigla(p.Nombre_Empresa),
        dias: Math.round((today - dP) / 86400000),
        pendiente: 0, pedido: 0
      };
    }
    ordMap[key].pendiente += Number(p.Cant_Pendiente) || 0;
    ordMap[key].pedido += Number(p.Cantidad) || 0;
  });

  var arr = Object.values(ordMap);
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
