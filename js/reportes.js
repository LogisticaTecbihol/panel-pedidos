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
    var data = await apiGet('getPedidos');
    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    var EXPECTED = ['Fecha_Procesamiento','Nombre_Empresa','Consecutivo','Fecha_Pedido',
      'Cliente','NIT','Telefono','Direccion_Envio','Municipio','Departamento',
      'Comercial','Plazo_Pago','Precio_Facturacion','Producto','Presentacion',
      'Cantidad','Valor_Unitario','Valor_Total','Total_Orden','Archivo_Fuente',
      'Estado','ID_Cliente','ID_Comercial','ID_Producto',
      'Cant_Entregada','Cant_Pendiente','Estado_Entrega','Fecha_Ult_Entrega','Remisiones','Observaciones','Estado_2','Bonificado'];

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

    var results = await Promise.all([
      apiGet('getIngresos').catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getOrdenesCompra').catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras').catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases').catch(function() { return { ok: true, reenvases: [] }; }),
      apiGet('getDevoluciones').catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getRemisionesAnuladas').catch(function() { return { ok: true, remisionesAnuladas: [] }; }),
      apiGet('getCambios').catch(function() { return { ok: true, cambios: [] }; }),
      apiGet('getKardexNC').catch(function() { return { ok: true, ajustesNC: [] }; })
    ]);
    ingresos = (results[0].ingresos || []);
    ordenesCompra = (results[1].ordenes || []);
    muestras = (results[2].muestras || []);
    reenvases = (results[3].reenvases || []);
    devoluciones = (results[4].devoluciones || []);
    remisionesAnuladas = (results[5].remisionesAnuladas || []);
    cambiosMerc = (results[6].cambios || []);
    kardexNC = (results[7].ajustesNC || []);

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
    if (p.Nombre_Empresa && emps.indexOf(p.Nombre_Empresa) < 0) emps.push(p.Nombre_Empresa);
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
      document.getElementById(id).addEventListener('change', buildReport);
      document.getElementById(id).addEventListener('input', buildReport);
    });
    rptFiltersAttached = true;
  }
}

function clearRptFilters() {
  document.getElementById('rf-emp').value = '';
  document.getElementById('rf-com').value = '';
  document.getElementById('rf-cli').value = '';
  document.getElementById('rf-txt').value = '';
  buildReport();
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
    if (est2 === 'Anulado') return false;
    if (fEmp && p.Nombre_Empresa !== fEmp) return false;
    if (fCom && p.Comercial !== fCom) return false;
    if (fCli && (p.Cliente || '').trim() !== fCli) return false;
    return true;
  });

  // Aggregate by product + presentacion
  var map = {};
  var ordenesSet = {};
  var clientesSet = {};
  filtered.forEach(function(p) {
    var prodLimpio = limpiarProducto(String(p.Producto || '')).toUpperCase().trim();
    var pres = String(p.Presentacion || '').toUpperCase().trim();
    var key = prodLimpio + '||' + pres;
    if (!map[key]) {
      map[key] = {
        producto: prodLimpio,
        presentacion: pres,
        pendiente: 0,
        pedida: 0,
        entregada: 0,
        ordenes: 0,
        empresas: {},
        clientes: {},
        _ordenKeys: {}
      };
    }
    var row = map[key];
    row.pendiente += Number(p.Cant_Pendiente) || 0;
    row.pedida += Number(p.Cantidad) || 0;
    row.entregada += Number(p.Cant_Entregada) || 0;
    var empSigla = getSigla(p.Nombre_Empresa);
    row.empresas[empSigla] = (row.empresas[empSigla] || 0) + (Number(p.Cant_Pendiente) || 0);
    var cli = (p.Cliente || '').trim();
    if (cli) row.clientes[cli] = (row.clientes[cli] || 0) + (Number(p.Cant_Pendiente) || 0);
    var ordKey = (p.Nombre_Empresa || '') + '||' + p.Consecutivo;
    if (!row._ordenKeys[ordKey]) { row._ordenKeys[ordKey] = true; row.ordenes++; }
    ordenesSet[ordKey] = true;
    clientesSet[p.Cliente || ''] = true;
  });

  aggregated = Object.values(map).map(function(r) {
    r.numClientes = Object.keys(r.clientes).length;
    return r;
  });

  if (fTxt) {
    aggregated = aggregated.filter(function(r) {
      return r.producto.toLowerCase().indexOf(fTxt) >= 0 || r.presentacion.toLowerCase().indexOf(fTxt) >= 0;
    });
  }

  // Stats
  document.getElementById('st-productos').textContent = aggregated.length;
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
    rptSort.dir = col === 'producto' || col === 'presentacion' ? 'asc' : 'desc';
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
    else if (col === 'pedida') { va = a.pedida; vb = b.pedida; }
    else if (col === 'entregada') { va = a.entregada; vb = b.entregada; }
    else if (col === 'pendiente') { va = a.pendiente; vb = b.pendiente; }
    else if (col === 'ordenes') { va = a.ordenes; vb = b.ordenes; }
    else if (col === 'numClientes') { va = a.numClientes; vb = b.numClientes; }
    else { va = a.pendiente; vb = b.pendiente; }
    var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ── Render ──
function renderRptTable() {
  var cols = [
    { id: 'producto', label: 'Producto' },
    { id: 'pendiente', label: 'Pendiente' },
    { id: 'numClientes', label: 'Clientes' },
    { id: null, label: 'Empresas' },
    { id: null, label: 'Detalle Clientes' },
  ];

  document.getElementById('rpt-head').innerHTML = cols.map(function(c) {
    if (!c.id) return '<th>' + c.label + '</th>';
    var cls = rptSort.col === c.id ? (rptSort.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    return '<th class="' + cls + '" onclick="toggleRptSort(\'' + c.id + '\')">' + c.label + '</th>';
  }).join('');

  document.getElementById('rpt-count').textContent = '(' + aggregated.length + ' productos)';

  var rows = sortedAggregated();
  var tbody = document.getElementById('rpt-body');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-msg">No hay productos pendientes con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r) {
    var empTags = Object.keys(r.empresas).sort().map(function(emp) {
      return '<span class="badge-emp" style="background:#ebf5fb;color:#1a5276;margin-right:3px">' + emp + ': ' + r.empresas[emp] + '</span>';
    }).join(' ');

    var cliKeys = Object.keys(r.clientes).sort();
    var cliTags = cliKeys.map(function(cli) {
      return '<span class="badge-emp" style="background:#fef9e7;color:#7d6608;margin-right:3px;margin-bottom:2px;display:inline-block">' + cli + ': ' + r.clientes[cli] + '</span>';
    }).join(' ');

    return '<tr>' +
      '<td style="font-weight:700">' + (r.producto || '—') + '</td>' +
      '<td class="money" style="color:#e74c3c;font-weight:700;font-size:0.95rem">' + r.pendiente.toLocaleString('es-CO') + '</td>' +
      '<td class="center">' + cliKeys.length + '</td>' +
      '<td>' + empTags + '</td>' +
      '<td style="max-width:300px">' + cliTags + '</td>' +
    '</tr>';
  }).join('');
}

// ── Export Excel ──
function exportExcel() {
  var rows = sortedAggregated();
  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var data = rows.map(function(r) {
    var cliDetail = Object.keys(r.clientes).sort().map(function(c) { return c + ': ' + r.clientes[c]; }).join('; ');
    var empDetail = Object.keys(r.empresas).sort().map(function(e) { return e + ': ' + r.empresas[e]; }).join('; ');
    return {
      'Producto': r.producto || '',
      'Pendiente': r.pendiente,
      'Clientes': r.numClientes,
      'Empresas': empDetail,
      'Detalle Clientes': cliDetail
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 50 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pendientes');
  XLSX.writeFile(wb, 'pendientes_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' productos');
}

// ── Tabs ──
function switchTab(tab) {
  document.getElementById('panel-pendientes').style.display = tab === 'pendientes' ? 'block' : 'none';
  document.getElementById('panel-remisiones').style.display = tab === 'remisiones' ? 'block' : 'none';
  document.getElementById('tab-pendientes').style.background = tab === 'pendientes' ? '#1a5276' : '#718096';
  document.getElementById('tab-remisiones').style.background = tab === 'remisiones' ? '#1a5276' : '#718096';
  if (tab === 'remisiones') buildRemisiones();
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
  if (detalle) row.detalles.push(detalle);
  row.cantidad += Number(cantidad) || 0;
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

  // 1. Pedidos — campo Remisiones (puede tener varios separados por coma)
  pedidos.forEach(function(p) {
    var rem = String(p.Remisiones || '').trim();
    if (!rem) return;
    var empNombre = p.Nombre_Empresa || '';
    if (fEmp && empNombre !== fEmp) return;
    var nums = rem.split(/[,;\/]+/).map(function(r) { return String(r).trim(); }).filter(Boolean);
    nums.forEach(function(numRem) {
      if (fTxt && numRem.toLowerCase().indexOf(fTxt) < 0 && getSigla(empNombre).toLowerCase().indexOf(fTxt) < 0) return;
      var key = empNombre + '||' + numRem + '||Pedido';
      _addRemision(map, key, empNombre, numRem, 'Pedido', 'Orden ' + (p.Consecutivo || ''), (p.Producto || '') + ' (' + (p.Presentacion || '') + ')', p.Cant_Entregada, p.Fecha_Ult_Entrega);
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

function renderRemTable() {
  var MOD_COLORS = { 'Pedido': '#2980b9', 'Ingreso': '#27ae60', 'Orden de Compra': '#8e44ad', 'Muestra': '#e67e22', 'Salida a producción': '#d35400', 'Devolución': '#c0392b', 'Dev. Ingreso': '#e74c3c', 'Dev. Salida': '#c0392b', 'Cambio': '#16a085', 'Cambio Ingreso': '#1abc9c', 'Cambio Salida': '#16a085', 'Anulada': '#7f8c8d' };
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

  tbody.innerHTML = rows.map(function(r) {
    var modColor = MOD_COLORS[r.modulo] || '#718096';
    var empOrigCell = r.empresaOrigen ? '<span class="badge-emp" style="background:#fef9e7;color:#7d6608">' + getSigla(r.empresaOrigen) + '</span>' : '—';
    var empDestCell = r.empresaDestino ? '<span class="badge-emp" style="background:#eafaf1;color:#1e8449">' + getSigla(r.empresaDestino) + '</span>' : '—';
    var deleteBtn = r._anulada_id ? ' <button onclick="deleteRemAnulada(' + r._anulada_id + ')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:0.85rem" title="Eliminar">🗑️</button>' : '';
    return '<tr' + (r.modulo === 'Anulada' ? ' style="background:#fdf2f2"' : '') + '>' +
      '<td><span class="badge-emp" style="background:#ebf5fb;color:#1a5276">' + r.empresa + '</span></td>' +
      '<td>' + empOrigCell + '</td>' +
      '<td>' + empDestCell + '</td>' +
      '<td style="font-weight:700;color:#2c3e50">' + r.remision + deleteBtn + '</td>' +
      '<td><span style="background:' + modColor + ';color:white;padding:2px 9px;border-radius:12px;font-size:0.72rem;font-weight:700">' + r.modulo + '</span></td>' +
      '<td style="font-size:0.8rem">' + r.referenciasStr + '</td>' +
      '<td class="center">' + r.numDetalles + '</td>' +
      '<td class="money" style="color:#27ae60;font-weight:600">' + r.cantidad.toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.8rem;color:#718096">' + (r.fecha ? fmtDate(r.fecha) : '—') + '</td>' +
    '</tr>';
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
