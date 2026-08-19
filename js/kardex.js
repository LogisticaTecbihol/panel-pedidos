// ── State ──
var kxPedidos = [];
var kxIngresos = [];
var kxOrdenes = [];
var kxMuestras = [];
var kxReenvases = [];
var kxDevoluciones = [];
var kxAjustes = [];
var kxCambios = [];
var kxCatalogo = [];
var kxMovimientos = [];
var kxFiltered = [];

// NC State
var ncAjustes = [];
var ncMovimientos = [];
var ncFiltered = [];
var kxncFiltered = [];
var activeTab = 'kardex';

function getSiglaKx(n) { return getSigla(n); }

function _normProd(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }

function _empresaTienePlanta(empresa) {
  var s = getSiglaKx(empresa);
  return s === 'GREEN' || s === 'PARCELAR';
}

function _esOrigenPlanta(origen) {
  return /planta/i.test(origen || '');
}

// ── Load all modules ──
async function loadKardex() {
  await _authReady;
  var kxExtras = ['CHIA ABAGO'];
  populateEmpresaSelect('f-empresa', '— Seleccionar —', kxExtras);
  populateEmpresaSelect('nc-f-empresa', '— Seleccionar —', kxExtras);
  populateEmpresaSelect('nc-empresa', '— Seleccionar —', kxExtras);
  populateEmpresaSelect('ncsi-empresa', '— Seleccionar —', kxExtras);
  populateEmpresaSelect('aj-empresa', '— Seleccionar —', kxExtras);
  populateEmpresaSelect('si-empresa', '— Seleccionar —', kxExtras);
  populateEmpresaSelect('cm-empresa', '— Seleccionar —', kxExtras);
  populateEmpresaSelect('kxnc-f-empresa', '— Seleccionar —', kxExtras);
  EMPRESAS_EXIST = AUTH.getFilteredEmpresas(EMPRESAS_HOLDING);
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
      apiGet('getPedidos', { columns: 'Nombre_Empresa,Cliente,Cant_Entregada,Estado_2,Consecutivo,Producto,Presentacion,Remisiones,Fecha_Ult_Entrega,Fecha_Pedido' }).catch(function() { return { ok: true, pedidos: [] }; }),
      apiGet('getIngresos', { columns: 'Cantidad,Origen,Empresa_Destino,Empresa_Origen,Fecha,Remision_Destino,Remision_Origen,Producto,Presentacion' }).catch(function() { return { ok: true, ingresos: [] }; }),
      apiGet('getOrdenesCompra', { columns: 'Cantidad,Remision,Empresa_Destino,Empresa_Origen,Fecha,Consecutivo,Producto,Presentacion' }).catch(function() { return { ok: true, ordenes: [] }; }),
      apiGet('getMuestras', { columns: 'Cant_Entregada,Remision,Fecha_Despacho,Fecha_Entrega,Fecha_Solicitud,Consecutivo,Solicitante,Empresa,Producto,Presentacion' }).catch(function() { return { ok: true, muestras: [] }; }),
      apiGet('getReenvases', { columns: 'Empresa,Empresa_Destino,Bodega,Cantidad,Remision,Remision_Destino,Fecha,Producto,Presentacion,Planta,Observaciones' }).catch(function() { return { ok: true, reenvases: [] }; }),
      apiGet('getDevoluciones', { columns: 'Cant_Entregada,Cantidad,Estado,Bodega_Ingreso,Fecha_Devolucion,Fecha,Remision,Remision_Ingreso,Consecutivo,Motivo,Empresa,Producto,Presentacion' }).catch(function() { return { ok: true, devoluciones: [] }; }),
      apiGet('getKardexAjustes', { columns: 'id,Cantidad,Tipo,Fecha,Observaciones,Empresa,Producto,Presentacion' }).catch(function() { return { ok: true, ajustes: [] }; }),
      apiGet('getMaestroProductos').catch(function() { return { ok: true, productos: [] }; }),
      apiGet('getKardexNC', { columns: 'id,Cantidad,Tipo,Motivo,Fecha,Remision,Observaciones,Empresa,Producto,Presentacion' }).catch(function() { return { ok: true, ajustesNC: [] }; }),
      apiGet('getCambios', { columns: 'Tipo_Linea,Cantidad,Estado,Remision_Salida,Remision_Ingreso,Fecha_Salida,Fecha_Ingreso,Fecha_Solicitud,Consecutivo,Cliente,Empresa,Producto,Bodega_Ingreso,Bodega_Salida,Razon_Cambio' }).catch(function() { return { ok: true, cambios: [] }; })
    ]);

    kxPedidos = (results[0].pedidos || []).filter(function(p) {
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente';
    });
    kxIngresos = results[1].ingresos || [];
    kxOrdenes = results[2].ordenes || [];
    kxMuestras = results[3].muestras || [];
    kxReenvases = results[4].reenvases || [];
    kxDevoluciones = results[5].devoluciones || [];
    kxAjustes = results[6].ajustes || [];
    kxCatalogo = results[7].productos || [];
    ncAjustes = results[8].ajustesNC || [];
    kxCambios = results[9].cambios || [];

    buildMovimientos();
    buildNCMovimientos();
    populateKxFilters();
    populateNCFilters();
    populateKxNCFilters();
    calcularKardex();
    calcularNC();
    calcularKardexNC();
    if (activeTab === 'exist') calcularExistencias();
    if (activeTab === 'exnc') calcularExistenciasNC();
    if (activeTab === 'comp') calcularComparativo();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    var total = kxPedidos.length + kxIngresos.length + kxOrdenes.length + kxMuestras.length + kxReenvases.length + kxDevoluciones.length + kxCambios.length;
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + total + ' transacciones';
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

// ── Build unified movements ──
function buildMovimientos() {
  kxMovimientos = [];

  // Pedidos — entregas (SALIDA), desglosadas por entrega individual
  kxPedidos.forEach(function(p) {
    var cantE = Number(p.Cant_Entregada) || 0;
    if (cantE <= 0) return;
    var est2 = (p.Estado_2 || '').trim();
    if (est2 === 'Anulado') return;
    var ref = 'Orden ' + (p.Consecutivo || '') + ' — ' + (p.Cliente || '');
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
        kxMovimientos.push({
          fecha: fecha,
          tipo: 'Salida',
          modulo: 'Pedidos',
          remision: rem,
          referencia: ref,
          empresa: empresa,
          producto: producto,
          presentacion: presentacion,
          cantidad: cant,
          _ajusteId: null
        });
      });
    } else {
      kxMovimientos.push({
        fecha: p.Fecha_Ult_Entrega || p.Fecha_Pedido || '',
        tipo: 'Salida',
        modulo: 'Pedidos',
        remision: remStr,
        referencia: ref,
        empresa: empresa,
        producto: producto,
        presentacion: presentacion,
        cantidad: cantE,
        _ajusteId: null
      });
    }
  });

  // Ingresos — ENTRADA para destino siempre; SALIDA para origen solo si NO es Cachipay
  kxIngresos.forEach(function(ing) {
    var cant = Number(ing.Cantidad) || 0;
    if (cant <= 0) return;
    var origenLc = (ing.Origen || '').toLowerCase();
    var esCachipay = origenLc.indexOf('cachipay') >= 0 || origenLc.indexOf('proveedor') >= 0;
    var esPlantaOrigen = _esOrigenPlanta(ing.Origen);
    // ENTRADA destino
    if (ing.Empresa_Destino) {
      kxMovimientos.push({
        fecha: ing.Fecha || '',
        tipo: 'Entrada',
        modulo: 'Ingresos',
        remision: ing.Remision_Destino || '',
        referencia: 'Desde ' + getSiglaKx(ing.Empresa_Origen) + (ing.Origen ? ' — ' + ing.Origen : ''),
        empresa: ing.Empresa_Destino,
        producto: _normProd(ing.Producto),
        presentacion: ing.Presentacion || '',
        cantidad: cant,
        _ajusteId: null
      });
    }
    // SALIDA origen — se omite para ingresos desde Cachipay, planta o misma empresa
    var skipSalida = esCachipay || (_empresaTienePlanta(ing.Empresa_Origen) && esPlantaOrigen);
    if (ing.Empresa_Origen && !skipSalida && ing.Empresa_Origen !== ing.Empresa_Destino) {
      kxMovimientos.push({
        fecha: ing.Fecha || '',
        tipo: 'Salida',
        modulo: 'Ingresos',
        remision: ing.Remision_Origen || '',
        referencia: 'Hacia ' + getSiglaKx(ing.Empresa_Destino) + (ing.Origen ? ' — ' + ing.Origen : ''),
        empresa: ing.Empresa_Origen,
        producto: _normProd(ing.Producto),
        presentacion: ing.Presentacion || '',
        cantidad: cant,
        _ajusteId: null
      });
    }
  });

  // Devoluciones — solo ENTRADA a Productos Buenos (Bodega NC se excluye del Kardex General)
  kxDevoluciones.forEach(function(d) {
    var estado = (d.Estado || '').toLowerCase();
    if (estado === 'anulado' || estado === 'pendiente') return;
    var cant = Number(d.Cant_Entregada || d.Cantidad) || 0;
    if (cant <= 0) return;
    var bodegaIng = (d.Bodega_Ingreso || '').trim();
    if (bodegaIng === 'Producto No Conforme') return;
    kxMovimientos.push({
      fecha: d.Fecha_Devolucion || d.Fecha || '',
      tipo: 'Entrada',
      modulo: 'Devoluciones',
      remision: d.Remision || d.Remision_Ingreso || '',
      referencia: 'Dev. ' + (d.Consecutivo || '') + (d.Motivo ? ' — ' + d.Motivo : ''),
      empresa: d.Empresa || '',
      producto: _normProd(d.Producto),
      presentacion: d.Presentacion || '',
      cantidad: cant,
      _ajusteId: null
    });
  });

  // Cambios de Mercancía — SALIDA (solo líneas ENTREGAR desde bodega productos buenos)
  kxCambios.forEach(function(c) {
    if (c.Tipo_Linea !== 'ENTREGAR') return;
    var cant = Number(c.Cantidad) || 0;
    if (cant <= 0) return;
    var estado = (c.Estado || '').toLowerCase();
    if (estado !== 'cerrado' && estado !== 'cerrada') return;
    var bodegaSal = (c.Bodega_Salida || 'Productos Buenos').trim();
    if (bodegaSal !== 'Productos Buenos' && bodegaSal !== 'Producto Terminado') return;
    var rem = String(c.Remision_Salida || '').trim();
    if (!rem) return;
    kxMovimientos.push({
      fecha: c.Fecha_Salida || c.Fecha_Solicitud || '',
      tipo: 'Salida',
      modulo: 'Cambios',
      remision: rem,
      referencia: 'Cambio ' + (c.Consecutivo || '') + (c.Cliente ? ' — ' + c.Cliente : ''),
      empresa: c.Empresa || '',
      producto: _normProd(c.Producto),
      presentacion: c.Presentacion || '',
      cantidad: cant,
      _ajusteId: null
    });
  });

  // Órdenes de Compra — ENTRADA destino + SALIDA origen
  kxOrdenes.forEach(function(oc) {
    var cant = Number(oc.Cantidad) || 0;
    if (cant <= 0) return;
    var rem = String(oc.Remision || '').trim();
    if (!rem) return;
    if (oc.Empresa_Destino) {
      kxMovimientos.push({
        fecha: oc.Fecha || '',
        tipo: 'Entrada',
        modulo: 'Órdenes de Compra',
        remision: rem,
        referencia: 'OC ' + (oc.Consecutivo || '') + ' — Desde ' + getSiglaKx(oc.Empresa_Origen),
        empresa: oc.Empresa_Destino,
        producto: _normProd(oc.Producto),
        presentacion: oc.Presentacion || '',
        cantidad: cant,
        _ajusteId: null
      });
    }
    if (oc.Empresa_Origen && oc.Empresa_Origen !== oc.Empresa_Destino) {
      kxMovimientos.push({
        fecha: oc.Fecha || '',
        tipo: 'Salida',
        modulo: 'Órdenes de Compra',
        remision: rem,
        referencia: 'OC ' + (oc.Consecutivo || '') + ' — Hacia ' + getSiglaKx(oc.Empresa_Destino),
        empresa: oc.Empresa_Origen,
        producto: _normProd(oc.Producto),
        presentacion: oc.Presentacion || '',
        cantidad: cant,
        _ajusteId: null
      });
    }
  });

  // Muestras — SALIDA
  kxMuestras.forEach(function(m) {
    var cantE = Number(m.Cant_Entregada);
    var cant = (isNaN(cantE) || cantE === 0) ? 0 : cantE;
    if (cant <= 0) return;
    var rem = String(m.Remision || '').trim();
    if (!rem) return;
    kxMovimientos.push({
      fecha: m.Fecha_Despacho || m.Fecha_Entrega || m.Fecha_Solicitud || '',
      tipo: 'Salida',
      modulo: 'Muestras',
      remision: rem,
      referencia: 'Sol. ' + (m.Consecutivo || '') + (m.Solicitante ? ' — ' + m.Solicitante : ''),
      empresa: m.Empresa || '',
      producto: _normProd(m.Producto),
      presentacion: m.Presentacion || '',
      cantidad: cant,
      _ajusteId: null
    });
  });

  // Salidas a producción (Reenvases) — SALIDA (solo Bodega Producto Terminado)
  kxReenvases.forEach(function(re) {
    var bodega = re.Bodega || 'Productos Buenos';
    if (bodega !== 'Productos Buenos' && bodega !== 'Producto Terminado') return;
    var cant = Number(re.Cantidad) || 0;
    if (cant <= 0) return;
    var rem = String(re.Remision || '').trim();
    if (!rem) return;
    var esTraslado = !!(re.Empresa_Destino);
    var refText = esTraslado
      ? 'Traslado → ' + (SIGLAS[re.Empresa_Destino] || re.Empresa_Destino || '')
      : (re.Planta || '');
    kxMovimientos.push({
      fecha: re.Fecha || '',
      tipo: 'Salida',
      modulo: esTraslado ? 'Traslado' : 'Producción',
      remision: rem,
      referencia: refText,
      empresa: re.Empresa || '',
      producto: _normProd(re.Producto),
      presentacion: re.Presentacion || '',
      cantidad: cant,
      _ajusteId: null
    });
    if (esTraslado) {
      kxMovimientos.push({
        fecha: re.Fecha || '',
        tipo: 'Entrada',
        modulo: 'Traslado',
        remision: String(re.Remision_Destino || '').trim() || rem,
        referencia: 'Traslado ← ' + (SIGLAS[re.Empresa] || re.Empresa || ''),
        empresa: re.Empresa_Destino,
        producto: _normProd(re.Producto),
        presentacion: re.Presentacion || '',
        cantidad: cant,
        _ajusteId: null
      });
    }
  });

  // Ingresos a Bodega NC — SALIDA de la bodega de productos buenos
  // Excepciones (el producto no sale de Productos Buenos, así que no afecta Kardex General):
  //   - Devolucion_cliente: el producto llega de afuera (cliente).
  //   - Retorno_conforme:   el producto viene de otra bodega NC (traslado entre empresas).
  //   - Traslado_NC:        traslado explícito entre bodegas NC de distintas empresas.
  ncAjustes.forEach(function(a) {
    if (a.Tipo !== 'Ingreso_NC') return;
    if (a.Motivo === 'Devolucion_cliente') return;
    if (a.Motivo === 'Retorno_conforme') return;
    if (a.Motivo === 'Traslado_NC') return;
    var cant = Number(a.Cantidad) || 0;
    if (cant <= 0) return;
    var motivoLbl = NC_MOTIVO_LABELS[a.Motivo] || a.Motivo || '';
    kxMovimientos.push({
      fecha: a.Fecha || '',
      tipo: 'Salida',
      modulo: 'Bodega NC',
      remision: a.Remision || '',
      referencia: 'Traslado a NC' + (motivoLbl ? ' — ' + motivoLbl : '') + (a.Observaciones ? ' — ' + a.Observaciones : ''),
      empresa: a.Empresa || '',
      producto: _normProd(a.Producto),
      presentacion: a.Presentacion || '',
      cantidad: cant,
      _ajusteId: null
    });
  });

  // Ajustes manuales y Saldos iniciales
  kxAjustes.forEach(function(a) {
    var cant = Number(a.Cantidad) || 0;
    if (cant <= 0) return;
    var tipo = a.Tipo || '';
    var esTipo;
    var modulo;
    if (tipo === 'Saldo_Inicial') {
      esTipo = 'Entrada';
      modulo = 'Saldo Inicial';
    } else if (tipo === 'Ajuste_Sobrante') {
      esTipo = 'Entrada';
      modulo = 'Ajuste';
    } else if (tipo === 'Ajuste_Faltante') {
      esTipo = 'Salida';
      modulo = 'Ajuste';
    } else {
      return;
    }
    kxMovimientos.push({
      fecha: a.Fecha || '',
      tipo: esTipo,
      modulo: modulo,
      remision: '',
      referencia: a.Observaciones || '',
      empresa: a.Empresa || '',
      producto: _normProd(a.Producto),
      presentacion: a.Presentacion || '',
      cantidad: cant,
      _ajusteId: a.__row || a.id || null
    });
  });

  // Regla global: sin remisión solo se admite Saldo Inicial.
  kxMovimientos = kxMovimientos.filter(function(m) {
    if (m.modulo === 'Saldo Inicial') return true;
    return !!(m.remision && String(m.remision).trim());
  });
}

// ── Filters ──
var kxFiltersAttached = false;

function populateKxFilters() {
  if (!kxFiltersAttached) {
    document.getElementById('f-empresa').addEventListener('change', function() {
      populateProductFilter();
      calcularKardex();
    });
    document.getElementById('f-prod').addEventListener('change', calcularKardex);
    document.getElementById('f-desde').addEventListener('change', calcularKardex);
    document.getElementById('f-hasta').addEventListener('change', calcularKardex);
    kxFiltersAttached = true;
  }
  populateProductFilter();
}

function populateProductFilter() {
  var fEmp = document.getElementById('f-empresa').value;
  var productos = {};
  kxMovimientos.forEach(function(m) {
    if (fEmp && m.empresa !== fEmp) return;
    if (m.producto) productos[m.producto] = true;
  });
  var sorted = Object.keys(productos).sort();
  var fp = document.getElementById('f-prod');
  var current = fp.value;
  fp.innerHTML = '<option value="">— Todos —</option>' + sorted.map(function(p) {
    return '<option value="' + p.replace(/"/g, '&quot;') + '">' + p + '</option>';
  }).join('');
  if (current && sorted.indexOf(current) >= 0) fp.value = current;
}

function clearKardexFilters() {
  document.getElementById('f-empresa').value = '';
  document.getElementById('f-prod').value = '';
  document.getElementById('f-desde').value = '';
  document.getElementById('f-hasta').value = '';
  populateProductFilter();
  calcularKardex();
}

// ── Calculate & render Kardex ──
function calcularKardex() {
  var fEmp = document.getElementById('f-empresa').value;
  var fProd = document.getElementById('f-prod').value;
  var fDesde = document.getElementById('f-desde').value;
  var fHasta = document.getElementById('f-hasta').value;

  if (!fEmp) {
    document.getElementById('kx-no-filter').style.display = 'block';
    document.getElementById('kx-table-wrap').style.display = 'none';
    document.getElementById('s-saldo-ini').textContent = '0';
    document.getElementById('s-entradas').textContent = '0';
    document.getElementById('s-salidas').textContent = '0';
    document.getElementById('s-saldo-act').textContent = '0';
    document.getElementById('row-ct-kx').textContent = '';
    return;
  }

  document.getElementById('kx-no-filter').style.display = 'none';
  document.getElementById('kx-table-wrap').style.display = 'block';

  // Filter movements (corte desde 2026-07-01)
  var fechaCorte = '2026-07-01';
  kxFiltered = kxMovimientos.filter(function(m) {
    if (m.empresa !== fEmp) return false;
    if (fProd && m.producto !== fProd) return false;
    var desde = fDesde || fechaCorte;
    if (m.fecha < desde) return false;
    if (fHasta && m.fecha > fHasta) return false;
    return true;
  });

  // Sort by date, then saldo_inicial first
  kxFiltered.sort(function(a, b) {
    var da = a.fecha || '';
    var db = b.fecha || '';
    if (da !== db) return da < db ? -1 : 1;
    var pa = a.modulo === 'Saldo Inicial' ? 0 : 1;
    var pb = b.modulo === 'Saldo Inicial' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    var ea = a.tipo === 'Entrada' ? 0 : 1;
    var eb = b.tipo === 'Entrada' ? 0 : 1;
    return ea - eb;
  });

  // Calculate running balance and stats (per product)
  var saldoIni = 0;
  var totalEntradas = 0;
  var totalSalidas = 0;
  var saldosPorProducto = {};

  kxFiltered.forEach(function(m) {
    if (!saldosPorProducto[m.producto]) saldosPorProducto[m.producto] = 0;
    if (m.tipo === 'Entrada') {
      saldosPorProducto[m.producto] += m.cantidad;
      if (m.modulo === 'Saldo Inicial') {
        saldoIni += m.cantidad;
      } else {
        totalEntradas += m.cantidad;
      }
    } else {
      saldosPorProducto[m.producto] -= m.cantidad;
      totalSalidas += m.cantidad;
    }
    m._saldo = saldosPorProducto[m.producto];
  });

  var saldoTotal = 0;
  Object.keys(saldosPorProducto).forEach(function(k) { saldoTotal += saldosPorProducto[k]; });

  document.getElementById('s-saldo-ini').textContent = saldoIni.toLocaleString('es-CO');
  document.getElementById('s-entradas').textContent = totalEntradas.toLocaleString('es-CO');
  document.getElementById('s-salidas').textContent = totalSalidas.toLocaleString('es-CO');
  document.getElementById('s-saldo-act').textContent = saldoTotal.toLocaleString('es-CO');

  renderKardexTable();
}

function renderKardexTable() {
  var fProd = document.getElementById('f-prod').value;
  var showProd = !fProd;
  var cols = showProd
    ? ['#', 'Fecha', 'Tipo', 'Módulo', 'Producto', 'N° Remisión', 'Referencia', 'Entrada', 'Salida', 'Saldo', '']
    : ['#', 'Fecha', 'Tipo', 'Módulo', 'N° Remisión', 'Referencia', 'Entrada', 'Salida', 'Saldo', ''];
  var colSpan = cols.length;
  document.getElementById('t-head-kx').innerHTML = cols.map(function(c) {
    return '<th>' + c + '</th>';
  }).join('');

  document.getElementById('row-ct-kx').textContent = '(' + kxFiltered.length + ' movimientos)';

  var tbody = document.getElementById('t-body-kx');
  if (!kxFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="' + colSpan + '"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay movimientos con los filtros seleccionados.</div></td></tr>';
    return;
  }

  var MOD_COLORS = {
    'Pedidos': '#2980b9',
    'Ingresos': '#27ae60',
    'Devoluciones': '#e67e22',
    'Órdenes de Compra': '#8e44ad',
    'Muestras': '#f39c12',
    'Producción': '#d35400',
    'Saldo Inicial': '#1a5276',
    'Ajuste': '#0e6655',
    'Bodega NC': '#e67e22'
  };

  tbody.innerHTML = kxFiltered.map(function(m, i) {
    var modColor = MOD_COLORS[m.modulo] || '#718096';
    var entradaStr = m.tipo === 'Entrada' ? '<span style="color:#27ae60;font-weight:700">+' + m.cantidad.toLocaleString('es-CO') + '</span>' : '';
    var salidaStr = m.tipo === 'Salida' ? '<span style="color:#e74c3c;font-weight:700">−' + m.cantidad.toLocaleString('es-CO') + '</span>' : '';
    var saldoColor = m._saldo < 0 ? '#e74c3c' : '#2c3e50';
    var deleteBtn = m._ajusteId && AUTH.canDelete() ? '<button class="btn-del" onclick="openDeleteKx(' + m._ajusteId + ',\'' + (m.modulo || '').replace(/'/g, "\\'") + '\',' + m.cantidad + ')" title="Eliminar ajuste" style="font-size:0.72rem;padding:3px 8px">🗑️</button>' : '';
    var pdfBtn = m.remision ? '<button onclick="exportarRemisionKardexPDF(' + i + ',\'kx\')" title="Exportar PDF remision" style="background:none;border:none;cursor:pointer;font-size:0.74rem;padding:1px 4px;opacity:0.6;vertical-align:middle" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.6\'">📄</button>' : '';
    var prodCol = showProd ? '<td style="font-size:0.78rem;font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (m.producto || '').replace(/"/g, '&quot;') + '">' + (m.producto || '—') + '</td>' : '';

    return '<tr' + (m.modulo === 'Saldo Inicial' ? ' style="background:#f0f9ff"' : '') + '>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.8rem">' + fmtDate(m.fecha) + '</td>' +
      '<td><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;color:white;background:' + (m.tipo === 'Entrada' ? '#27ae60' : '#e74c3c') + '">' + m.tipo + '</span></td>' +
      '<td><span style="background:' + modColor + ';color:white;padding:2px 9px;border-radius:12px;font-size:0.72rem;font-weight:700">' + m.modulo + '</span></td>' +
      prodCol +
      '<td style="font-size:0.8rem;font-weight:600;white-space:nowrap">' + (m.remision || '—') + pdfBtn + '</td>' +
      '<td style="font-size:0.78rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (m.referencia || '').replace(/"/g, '&quot;') + '">' + (m.referencia || '—') + '</td>' +
      '<td style="text-align:right">' + entradaStr + '</td>' +
      '<td style="text-align:right">' + salidaStr + '</td>' +
      '<td style="text-align:right;font-weight:800;color:' + saldoColor + '">' + m._saldo.toLocaleString('es-CO') + '</td>' +
      '<td>' + deleteBtn + '</td>' +
    '</tr>';
  }).join('');
}

// ── Export Excel ──
function exportKardexExcel() {
  if (!kxFiltered.length) { showToast('No hay datos para exportar. Selecciona una empresa.', '#e74c3c'); return; }

  var fEmp = document.getElementById('f-empresa').value;
  var fProd = document.getElementById('f-prod').value;

  var data = kxFiltered.map(function(m, i) {
    return {
      '#': i + 1,
      'Fecha': m.fecha || '',
      'Tipo': m.tipo,
      'Módulo': m.modulo,
      'N° Remisión': m.remision || '',
      'Referencia': m.referencia || '',
      'Producto': m.producto,
      'Presentación': m.presentacion,
      'Entrada': m.tipo === 'Entrada' ? m.cantidad : '',
      'Salida': m.tipo === 'Salida' ? m.cantidad : '',
      'Saldo': m._saldo
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 15 },
    { wch: 35 }, { wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kardex');
  var filename = 'Kardex_' + getSiglaKx(fEmp) + '_' + (fProd || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + today() + '.xlsx';
  XLSX.writeFile(wb, filename);
  showToast('Excel exportado: ' + kxFiltered.length + ' movimientos');
}

// ── Autocomplete helpers ──
var activeAutocompleteKx = null;

function buildKxProductSearch(prefix, lineIdx) {
  var inp = document.querySelector('.' + prefix + '-prod-search[data-line="' + lineIdx + '"]');
  if (!inp) return;

  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    var empId = prefix === 'aj' ? 'aj-empresa' : prefix === 'nc' ? 'nc-empresa' : prefix === 'ncsi' ? 'ncsi-empresa' : 'si-empresa';
    var empSel = document.getElementById(empId).value;
    closeAllAutocompleteKx();
    if (q.length < 1) return;

    var matches = kxCatalogo.filter(function(p) {
      var matchName = (p.producto || '').toLowerCase().indexOf(q) >= 0;
      var matchEmp = !empSel || !p.empresa || p.empresa === empSel;
      return matchName && matchEmp;
    });

    var seen = {};
    matches = matches.filter(function(p) {
      var key = p.producto + '||' + p.presentacion;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    if (!matches.length) return;

    var list = document.createElement('div');
    list.className = 'autocomplete-list-kx';
    list.style.cssText = 'position:absolute;z-index:100;background:white;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:200px;overflow-y:auto;width:100%;left:0;top:100%';

    matches.slice(0, 15).forEach(function(p) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f4f8;display:flex;justify-content:space-between;align-items:center';
      item.innerHTML = '<span style="font-weight:600">' + (p.producto || '') + '</span><span style="color:#718096;font-size:0.75rem">' + (p.presentacion || '') + '</span>';
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        inp.value = p.producto;
        var presInp = document.querySelector('.' + prefix + '-pres[data-line="' + lineIdx + '"]');
        if (presInp) presInp.value = p.presentacion || '';
        closeAllAutocompleteKx();
      });
      item.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background = 'white'; });
      list.appendChild(item);
    });

    var wrapper = inp.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(list);
    activeAutocompleteKx = list;
  });

  inp.addEventListener('blur', function() {
    setTimeout(closeAllAutocompleteKx, 150);
  });
}

function closeAllAutocompleteKx() {
  document.querySelectorAll('.autocomplete-list-kx').forEach(function(el) { el.remove(); });
  activeAutocompleteKx = null;
}

// ── Ajuste Manual Modal ──
var ajLineas = [];

function openAjusteModal() {
  document.getElementById('ajuste-modal-title').textContent = '➕ Ajuste Manual de Inventario';
  document.getElementById('aj-fecha').value = today();
  document.getElementById('aj-empresa').value = document.getElementById('f-empresa').value || '';
  document.getElementById('aj-tipo').value = 'Ajuste_Sobrante';
  document.getElementById('aj-observaciones').value = '';
  document.getElementById('btn-save-ajuste').disabled = false;
  document.getElementById('btn-save-ajuste').textContent = '✓ Registrar ajuste';
  ajLineas = [{ Producto: '', Presentacion: '', Cantidad: '' }];
  renderAjLines();
  document.getElementById('ajuste-overlay').classList.add('show');
}

function closeAjusteModal() {
  document.getElementById('ajuste-overlay').classList.remove('show');
  closeAllAutocompleteKx();
}
document.getElementById('ajuste-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeAjusteModal(); });

function renderAjLines() {
  var tbody = document.getElementById('aj-lines');
  tbody.innerHTML = ajLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef aj-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto || '').replace(/"/g, '&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef aj-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion || '').replace(/"/g, '&quot;')) + '" placeholder="Pres." style="width:100px"></td>' +
      '<td><input class="ef aj-cant" data-line="' + i + '" type="number" min="0" value="' + (l.Cantidad || '') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeAjLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  ajLineas.forEach(function(l, i) { buildKxProductSearch('aj', i); });
}

function addAjusteLine() {
  ajLineas.push({ Producto: '', Presentacion: '', Cantidad: '' });
  renderAjLines();
  var lastInput = document.querySelector('.aj-prod-search[data-line="' + (ajLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeAjLine(i) {
  if (ajLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  ajLineas.splice(i, 1);
  renderAjLines();
}

function readAjLines() {
  document.querySelectorAll('.aj-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ajLineas[i]) ajLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.aj-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ajLineas[i]) ajLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.aj-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ajLineas[i]) ajLineas[i].Cantidad = Number(inp.value) || 0;
  });
}

async function saveAjuste() {
  var fecha = document.getElementById('aj-fecha').value;
  var empresa = document.getElementById('aj-empresa').value;
  var tipo = document.getElementById('aj-tipo').value;
  var obs = document.getElementById('aj-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }

  readAjLines();
  var validLines = ajLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-ajuste');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarKardexAjuste',
      Fecha: fecha,
      Empresa: empresa,
      Tipo: tipo,
      Observaciones: obs,
      lineas: validLines
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeAjusteModal();
    showToast('✅ ' + result.added + ' ajuste(s) registrado(s)');
    await loadKardex();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar ajuste';
  }
}

// ── Saldo Inicial Modal ──
var siLineas = [];

function openSaldoInicialModal() {
  document.getElementById('si-fecha').value = today();
  document.getElementById('si-empresa').value = document.getElementById('f-empresa').value || '';
  document.getElementById('si-observaciones').value = '';
  document.getElementById('btn-save-saldo').disabled = false;
  document.getElementById('btn-save-saldo').textContent = '✓ Cargar saldo inicial';
  siLineas = [{ Producto: '', Presentacion: '', Cantidad: '' }];
  renderSiLines();
  document.getElementById('saldo-overlay').classList.add('show');
}

function closeSaldoModal() {
  document.getElementById('saldo-overlay').classList.remove('show');
  closeAllAutocompleteKx();
}
document.getElementById('saldo-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeSaldoModal(); });

function renderSiLines() {
  var tbody = document.getElementById('si-lines');
  tbody.innerHTML = siLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef si-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto || '').replace(/"/g, '&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef si-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion || '').replace(/"/g, '&quot;')) + '" placeholder="Pres." style="width:100px"></td>' +
      '<td><input class="ef si-cant" data-line="' + i + '" type="number" min="0" value="' + (l.Cantidad || '') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeSiLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  siLineas.forEach(function(l, i) { buildKxProductSearch('si', i); });
}

function addSaldoLine() {
  siLineas.push({ Producto: '', Presentacion: '', Cantidad: '' });
  renderSiLines();
  var lastInput = document.querySelector('.si-prod-search[data-line="' + (siLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeSiLine(i) {
  if (siLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  siLineas.splice(i, 1);
  renderSiLines();
}

function readSiLines() {
  document.querySelectorAll('.si-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (siLineas[i]) siLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.si-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (siLineas[i]) siLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.si-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (siLineas[i]) siLineas[i].Cantidad = Number(inp.value) || 0;
  });
}

async function saveSaldoInicial() {
  var fecha = document.getElementById('si-fecha').value;
  var empresa = document.getElementById('si-empresa').value;
  var obs = document.getElementById('si-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha de corte', '#e74c3c'); return; }
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }

  readSiLines();
  var validLines = siLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-saldo');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarKardexAjuste',
      Fecha: fecha,
      Empresa: empresa,
      Tipo: 'Saldo_Inicial',
      Observaciones: obs || 'Saldo inicial',
      lineas: validLines
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeSaldoModal();
    showToast('✅ ' + result.added + ' saldo(s) inicial(es) cargado(s)');
    await loadKardex();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Cargar saldo inicial';
  }
}

// ── Delete Ajuste ──
var deleteKxRow = null;

function openDeleteKx(row, modulo, cantidad) {
  deleteKxRow = row;
  document.getElementById('del-kx-msg').textContent = '¿Eliminar este ajuste del Kardex?';
  document.getElementById('del-kx-detail').innerHTML =
    'Tipo: <strong>' + modulo + '</strong> · Cantidad: ' + Number(cantidad).toLocaleString('es-CO') + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará este registro de la base de datos.</span>';
  document.getElementById('btn-del-kx-confirm').disabled = false;
  document.getElementById('btn-del-kx-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-kx-overlay').classList.add('show');
}

function closeDeleteKx() {
  document.getElementById('delete-kx-overlay').classList.remove('show');
  deleteKxRow = null;
}
document.getElementById('delete-kx-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteKx(); });

async function confirmDeleteKx() {
  if (!deleteKxRow) return;
  var btn = document.getElementById('btn-del-kx-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarKardexAjuste', row: deleteKxRow });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDeleteKx();
    showToast('🗑️ Ajuste eliminado del Kardex');
    await loadKardex();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Carga masiva saldo inicial GREEN ──
var SALDOS_GREEN = [
  ['AKAR GREEN X 250 ML', '', 146],
  ['AKAR GREEN X 500 ML', '', 119],
  ['AKAR GREEN X BIDON 20 LITROS', '', 1],
  ['AKAR GREEN X LITRO', '', 142],
  ['BORCAMAG X BIDON 20LITROS', '', 4],
  ['BORCAMAG X GALON', '', 1],
  ['BORCAMAG X LITRO', '', 311],
  ['GREEN 40F X 250 ML', '', 124],
  ['GREEN 40F X 500 ML', '', 60],
  ['GREEN 40F X GALON', '', 12],
  ['GREEN 40F X LITRO', '', 28],
  ['GREEN AMINO X 100 ML', '', 65],
  ['GREEN AMINO X BIDON 20 LITROS', '', 3],
  ['GREEN AMINO X GALON', '', 32],
  ['GREEN AMINO X LITRO', '', 238],
  ['GREEN CA-L CANECA X 10 LITROS', '', 6],
  ['GREEN CA-L CANECA X 20 LITROS', '', 1],
  ['GREEN CA-L X GALON', '', 24],
  ['GREEN CA-L X LITRO', '', 443],
  ['GREEN CORRECTOR X 100 ML', '', 16],
  ['GREEN CORRECTOR X 250 ML', '', 81],
  ['GREEN CORRECTOR X BIDON 20 LITROS', '', 6],
  ['GREEN CORRECTOR X BIDON 30 LITROS', '', 1],
  ['GREEN CORRECTOR X LITRO', '', 23],
  ['GREEN CU-ILL X BIDON 20 LITROS', '', 4],
  ['GREEN CU-ILL X GALON', '', 20],
  ['GREEN CU-ILL X 250 ML', '', 7],
  ['GREEN DEFENSER-TECH X 250 ML', '', 11],
  ['GREEN DEFENSER-TECH X LITRO', '', 55],
  ['GREEN FOS X BIDON 20 LITROS', '', 1],
  ['GREEN MOLUS KILL X LITRO', '', 262],
  ['GREEN MOLUS-KILL X 250 ML', '', 111],
  ['GREEN MOLUS-KILL X 500 ML', '', 128],
  ['GREEN MOLUS-KILL X BIDON 16 LITROS', '', 1],
  ['GREEN MOLUS-KILL X GALON', '', 8],
  ['GREEN VAX X 100 ML', '', 73],
  ['GREEN VAX X LITRO', '', 277],
  ['GREEN YODO X 250 ML', '', 308],
  ['JABOLAN EXPORTACION X GALON', '', 14],
  ['JABOLAN EXPORTACION X LITRO', '', 10],
  ['JABOTAN EXPORTACION X LITRO', '', 82],
  ['NEMOCAP X BIDON 20 LITROS', '', 3],
  ['PEGASSO TOP X 100 ML', '', 47],
  ['PEGASSO TOP X 250 ML', '', 200],
  ['PEGASSO TOP X BIDON 20 LITROS', '', 2],
  ['PEGASSO TOP X GALON', '', 7],
];

// ── Carga masiva saldo inicial PARCELAR ──
var SALDOS_PARCELAR = [
  ['AFINADOR CAB X BIDON 20 LITROS', '', 6],
  ['AFINADOR CAB X 250 ML', '', 20],
  ['AFINADOR CAB X 500 ML', '', 15],
  ['AFINADOR CAB X GALON', '', 30],
  ['AFINADOR CAB X LITRO', '', 337],
  ['AMETRINA 80WG X KILO', '', 2],
  ['BORDEL CROP X BIDON 20 LITROS', '', 5],
  ['BORDEL CROP X 250 ML', '', 76],
  ['BORDEL CROP X GALON', '', 9],
  ['BORDEL CROP X LITRO', '', 137],
  ['BORO 21 X KILO', '', 25],
  ['CALIMAN X CANECA 10 LITROS', '', 5],
  ['CALIMAN X GALON', '', 23],
  ['CALIMAN X LITRO', '', 263],
  ['CERTUS 70 WS X 100 GR CV', '', 24],
  ['CERTUS 70 WS X 500 GR CV', '', 1],
  ['CERTUS 70 WS 50 GM', '', 11],
  ['CLEAN CROP X 100 ML', '', 90],
  ['CLEAN CROP X 250 ML', '', 75],
  ['CLEAN CROP X LITRO', '', 196],
  ['CONTRA 200 SC X 200 ML', '', 24],
  ['CUFIGA 80 WP X 500 GR CV', '', 643],
  ['DESESTRES P X 100 ML', '', 73],
  ['DESESTRES P X GALON', '', 9],
  ['DESESTRES P X 20 LITROS', '', 6],
  ['DESESTRES P X 250 ML', '', 37],
  ['DESESTRES P X 500 ML', '', 19],
  ['DESESTRES P X LITRO', '', 154],
  ['DIRVO 60% WG X 20 GR CV', '', 45],
  ['DIRVO 60% WG X KILO ( METSULFURON) CV', '', 60],
  ['ENGORDE K X 100 ML', '', 54],
  ['ENGORDE K X 20 LITROS', '', 2],
  ['ENGORDE K X 4 LITROS', '', 9],
  ['ENGORDE K X LITRO', '', 312],
  ['ESPAIDER CROP X 20 LITROS', '', 5],
  ['ESPAIDER CROP X 250 ML', '', 155],
  ['ESPAIDER CROP X LITRO', '', 85],
  ['FERTI-HUMI 16 X GALON', '', 9],
  ['FERTI-HUMI 16 X LITRO', '', 86],
  ['FERTI-HUMI 16 X 20 LITROS', '', 10],
  ['FERTILASER PRODUMLION X KILO', '', 17],
  ['FICLORAM SL X GALON', '', 1],
  ['FICLORAM LITRO', '', 11],
  ['FOSTAL 80 WP X 500 GR CV', '', 22],
  ['GRADUS 43 SC X LITRO CV', '', 12],
  ['GRADUS 43 X 500 ML CV', '', 29],
  ['HEXAZINONA 300 GR', '', 4],
  ['JABOLAN X 20 LITROS', '', 2],
  ['JABOLAN X 250 ML', '', 19],
  ['JABOLAN X GALON', '', 3],
  ['JABOLAN X LITRO', '', 5],
  ['LAMBDA CIHALOTRINA X 100 ML', '', 28],
  ['LAMBDA CIHALOTRINA X 500 ML', '', 101],
  ['LAMBDA CIHALOTRINA X LITRO', '', 38],
  ['MAXI PASTO X LITRO', '', 15],
  ['MERO BRIO X 250 ML', '', 229],
  ['MERO BRIO X GALON', '', 6],
  ['MERO BRIO X LITRO', '', 88],
  ['MICROZUL FZ&V LOMBRI-CROP  X GALON', '', 33],
  ['MICROZUL FZ&V LOMBRI-CROP  X LITRO', '', 288],
  ['NEMATO CROP X 500 ML', '', 29],
  ['NEMATO CROP X LITRO', '', 13],
  ['NEMATO CROP X 250 ML', '', 163],
  ['NOI-1 X 250 ML', '', 5],
  ['OXICLORURO DE COBRE X KILO', '', 30],
  ['PEGASSO OIL X 100 ML', '', 35],
  ['PEGASSO OIL X 20 LITROS', '', 39],
  ['PEGASSO OIL X 200 LITROS', '', 5],
  ['PEGASSO OIL X 250 ML', '', 173],
  ['PEGASSO OIL X 60 LITROS', '', 5],
  ['PEGASSO OIL X GALON', '', 52],
  ['PEGASSO OIL X LITRO', '', 171],
  ['PEGASSO PH X CANECA 200 LITROS', '', 5],
  ['PEGASSO PH X 20 LITROS', '', 37],
  ['PEGASSO PH X 250 ML', '', 3],
  ['PEGASSO PH X 60 LITROS', '', 4],
  ['PEGASSO PH X GALON', '', 44],
  ['PEGASSO PH X LITRO', '', 128],
  ['RUDOWN X1KG', '', 3],
  ['RUDOWN X50GR', '', 378],
  ['SAGUM 25 SC X 500 ML CV', '', 30],
  ['SAGUM X LITRO CV', '', 72],
  ['SHOCK UPI 36 EG X 500G', '', 6],
  ['TABUS 50 WG X 40 GR CV', '', 100],
  ['TRIP-CROP X 250 ML', '', 122],
  ['TRIP-CROP X LITRO', '', 29],
  ['YODO X LITRO', '', 7],
  ['YODO X 250 ML', '', 118]
];

var SALDOS_RESO = [
  ['ALGESIL X LT', '', 66],
  ['ALTOSAN BIZIN X LT', '', 144],
  ['COPFOR', '', 60],
  ['KERBEUS X LT', '', 60],
  ['MIMOX ZN', '', 93],
  ['ROTIP', '', 42],
  ['ARACK GREEN X 20 LITROS', '', 3],
  ['ARACK GREEN X 250 ML', '', 70],
  ['ARACK GREEN X GALON', '', 8],
  ['ARACK GREEN X LITRO', '', 275],
  ['BA-BOR-ZINC X 250 ML', '', 61],
  ['BA-BOR-ZINC X 500 ML', '', 56],
  ['BA-BOR-ZINC X GALON', '', 4],
  ['BA-BOR-ZINC X LITRO', '', 11],
  ['BACTERFIN X LITRO', '', 4],
  ['BLUE TECH X 5KL', '', 8],
  ['CALCI-TECH X LITRO', '', 13],
  ['CALCI-TECH X 250 ML', '', 1],
  ['CALCI-TECH X BIDON 20 LITROS', '', 4],
  ['CALIMAN X BIDON 20 LITROS', '', 26],
  ['CALIMAN X CANECA 10 LITROS', '', 22],
  ['CALIMAN X GALON', '', 26],
  ['CALIMAN X LITRO', '', 173],
  ['CLEAN-TECH X 5 KL', '', 3],
  ['ESPECIAL GROW GREEN DS X 250 ML', '', 42],
  ['GROW GREEN SP X LITRO', '', 23],
  ['GENIUS-TECH X 250 ML', '', 1],
  ['GEON3 X LITRO', '', 12],
  ['GREEN 50 DBF X LITRO', '', 2],
  ['GREEN 50 DBF X 250 ML', '', 9],
  ['GROW GREEN X 250 ML', '', 22],
  ['GROW GREEN X GALON', '', 16],
  ['JABOTAN X LITRO', '', 6],
  ['KAITOSOL X 100 ML', '', 84],
  ['KAITOSOL X 250 ML', '', 168],
  ['KAITOSOL X LITRO', '', 52],
  ['KAITOSOL X BIDON 20 LITROS', '', 1],
  ['MEKA TECH X 250 ML', '', 14],
  ['MEKA TECH X LITRO', '', 55],
  ['NEEM GREEN X 250 ML', '', 38],
  ['NEEM GREEN X LITRO', '', 8],
  ['NEMOCAP X LITRO', '', 5],
  ['NITRO-TECH X 250 ML', '', 8],
  ['NITRO-TECH X GALON 5 LITROS', '', 8],
  ['NITRO-TECH X LITRO', '', 42],
  ['PROTO TECH X 250 ML', '', 6],
  ['PROTO TECH X GALON 5 LITROS', '', 4],
  ['PROTO TECH X LITRO', '', 14],
  ['THYME GREEN X 250 ML', '', 8],
  ['THYME GREEN X LITRO', '', 349],
  ['YODO X 250 ML', '', 21]
];

var SALDOS_IAS = [
  ['ACTIVE FUNBAC X 100 ML', '', 50],
  ['ACTIVE FUNBAC X 250 ML', '', 20],
  ['ACTIVE FUNBAC X LITRO', '', 105],
  ['AGROHUMICOL X GALON', '', 18],
  ['AGROHUMICOL X BIDON 20 LITROS', '', 2],
  ['AGROHUMICOL X LITRO', '', 103],
  ['AGROTECK HUMUS X GALON', '', 3],
  ['AGROTECK X LITRO', '', 12],
  ['AJO AJI ORTIGA X BIDON 20 LITROS', '', 3],
  ['AJO AJI ORTIGA X 500 ML', '', 34],
  ['AJO AJI ORTIGA X LITRO', '', 203],
  ['AJO AJI ORTIGA X GALON', '', 28],
  ['AJO AJI ORTIGA X 100 ML', '', 97],
  ['AJO AJI ORTIGA X 250 ML', '', 86],
  ['CALIMAN X LITRO', '', 3],
  ['COOL PLANT X KILO', '', 1],
  ['GREEN FUNGY-BAC X GALON', '', 4],
  ['GREEN FUNGY-BAC X 250 ML', '', 309],
  ['GREEN FUNGY-BAC X BIDON 20 LITROS', '', 1],
  ['GREEN FUNGY-BAC X 100 ML', '', 100],
  ['NITRATO DE ZINC X BIDON 20 LITROS', '', 2],
  ['NITRATO DE ZINC X GALON', '', 4],
  ['NITRATO DE ZINC X LITRO', '', 97],
  ['NUTRI ROOTS X LITRO', '', 201],
  ['SOILTREATES - N X GALON', '', 1],
  ['URSUDOL X BLT 25 KILOS', '', 5],
  ['URSUDOL X 200 GR', '', 3],
  ['URSUDOL X KILOS', '', 50],
  ['URTI ALIL X 20L', '', 8],
  ['VASTAGO 9-13-28 PRODUCCION X 25 KILOS', '', 4],
  ['VASTAGO 9-13-28 PRODUCCION X KILO', '', 82],
  ['VASTAGO X 200GR', '', 17],
];

var cargaMasivaActiva = null;

function openCargaMasivaModal(dataset) {
  var datos = dataset === 'GREEN' ? SALDOS_GREEN : dataset === 'RESO' ? SALDOS_RESO : dataset === 'IAS' ? SALDOS_IAS : SALDOS_PARCELAR;
  var empresaDefault = dataset === 'GREEN' ? 'GREEN AGROSOLUCIONES DE COLOMBIA SAS' : dataset === 'RESO' ? 'SOLUCIONES INTEGRALES RESO SAS' : dataset === 'IAS' ? 'INSUMOS AGROPECUARIOS DE LA SABANA SAS' : 'PARCELAR DE COLOMBIA SAS';
  cargaMasivaActiva = datos;
  var total = datos.reduce(function(s, r) { return s + r[2]; }, 0);
  document.getElementById('cm-count').textContent = datos.length;
  document.getElementById('cm-total').textContent = total.toLocaleString('es-CO');
  document.getElementById('cm-fecha').value = '2026-07-01';
  document.getElementById('cm-empresa').value = empresaDefault;
  document.getElementById('btn-cm-confirm').disabled = false;
  document.getElementById('btn-cm-confirm').textContent = '✓ Cargar ' + datos.length + ' productos';
  document.getElementById('cm-progress').style.display = 'none';

  var tbody = document.getElementById('cm-preview');
  tbody.innerHTML = datos.map(function(r, i) {
    return '<tr><td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td style="font-size:0.82rem;font-weight:600">' + r[0] + '</td>' +
      '<td style="text-align:right;font-weight:700;color:#27ae60">' + r[2].toLocaleString('es-CO') + '</td></tr>';
  }).join('');

  document.getElementById('carga-masiva-overlay').classList.add('show');
}

function closeCargaMasivaModal() {
  document.getElementById('carga-masiva-overlay').classList.remove('show');
}
document.getElementById('carga-masiva-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeCargaMasivaModal(); });

async function ejecutarCargaMasiva() {
  var empresa = document.getElementById('cm-empresa').value;
  var fecha = document.getElementById('cm-fecha').value;
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!fecha) { showToast('Selecciona la fecha de corte', '#e74c3c'); return; }
  var datos = cargaMasivaActiva || SALDOS_PARCELAR;

  var btn = document.getElementById('btn-cm-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Cargando...';
  var progress = document.getElementById('cm-progress');
  progress.style.display = 'block';

  var BATCH = 20;
  var total = datos.length;
  var loaded = 0;
  var errors = [];

  for (var i = 0; i < total; i += BATCH) {
    var batch = datos.slice(i, i + BATCH);
    var lineas = batch.map(function(r) {
      return { Producto: r[0], Presentacion: r[1], Cantidad: r[2] };
    });

    try {
      var result = await apiPost({
        action: 'agregarKardexAjuste',
        Fecha: fecha,
        Empresa: empresa,
        Tipo: 'Saldo_Inicial',
        Observaciones: 'Saldo inicial carga masiva desde inventario fisico',
        lineas: lineas
      });
      if (!result.ok) {
        errors.push('Lote ' + (Math.floor(i / BATCH) + 1) + ': ' + (result.error || 'Error'));
      } else {
        loaded += lineas.length;
      }
    } catch (err) {
      errors.push('Lote ' + (Math.floor(i / BATCH) + 1) + ': ' + err.message);
    }

    progress.textContent = 'Cargados: ' + loaded + ' / ' + total + ' productos...';
  }

  if (errors.length) {
    showToast('⚠️ Cargados ' + loaded + ' con ' + errors.length + ' errores', '#e67e22');
  } else {
    showToast('✅ ' + loaded + ' saldos iniciales cargados exitosamente');
  }

  closeCargaMasivaModal();
  await loadKardex();
}

// ══════════════════════════════════════════
// ── TAB SWITCHING ──
// ══════════════════════════════════════════

function switchKardexTab(tab) {
  activeTab = tab;
  var tabs = [
    { id: 'tab-kardex', panel: 'panel-kardex', color: '#0e6655', key: 'kardex' },
    { id: 'tab-nc', panel: 'panel-nc', color: '#e67e22', key: 'nc' },
    { id: 'tab-exist', panel: 'panel-exist', color: '#1a5276', key: 'exist' },
    { id: 'tab-kxnc', panel: 'panel-kxnc', color: '#c0392b', key: 'kxnc' },
    { id: 'tab-exnc', panel: 'panel-exnc', color: '#c0392b', key: 'exnc' },
    { id: 'tab-comp', panel: 'panel-comp', color: '#8e44ad', key: 'comp' }
  ];
  tabs.forEach(function(t) {
    var btn = document.getElementById(t.id);
    var panel = document.getElementById(t.panel);
    if (t.key === tab) {
      btn.style.background = t.color;
      btn.style.color = 'white';
      panel.style.display = 'block';
    } else {
      btn.style.background = '#f7fafc';
      btn.style.color = '#718096';
      panel.style.display = 'none';
    }
  });
  if (tab === 'exist') calcularExistencias();
  if (tab === 'exnc') calcularExistenciasNC();
  if (tab === 'comp') calcularComparativo();
}

// ══════════════════════════════════════════
// ── NC: BUILD MOVEMENTS ──
// ══════════════════════════════════════════

function buildNCMovimientos() {
  ncMovimientos = [];

  // Salidas a producción NC (Reenvases con Bodega No Conforme)
  kxReenvases.forEach(function(re) {
    var bodega = re.Bodega || 'Productos Buenos';
    if (bodega !== 'Producto No Conforme') return;
    var cant = Number(re.Cantidad) || 0;
    if (cant <= 0) return;
    ncMovimientos.push({
      fecha: re.Fecha || '',
      tipo: 'Salida',
      motivo: 'Produccion_NC',
      remision: re.Remision || '',
      referencia: (re.Planta ? re.Planta : '') + (re.Observaciones ? ' — ' + re.Observaciones : ''),
      empresa: re.Empresa || '',
      producto: _normProd(re.Producto),
      presentacion: re.Presentacion || '',
      cantidad: cant,
      _ajusteId: null
    });
  });

  // Cambios de Mercancía — CAMBIAR con Bodega_Ingreso NC = ENTRADA;
  // ENTREGAR con Bodega_Salida NC = SALIDA
  kxCambios.forEach(function(c) {
    var estado = (c.Estado || '').toLowerCase();
    if (estado !== 'cerrado' && estado !== 'cerrada') return;
    var cant = Number(c.Cantidad) || 0;
    if (cant <= 0) return;

    if (c.Tipo_Linea === 'CAMBIAR') {
      var bodegaIng = (c.Bodega_Ingreso || '').trim();
      if (bodegaIng !== 'Producto No Conforme') return;
      var remIng = String(c.Remision_Ingreso || '').trim();
      if (!remIng) return;
      ncMovimientos.push({
        fecha: c.Fecha_Ingreso || c.Fecha_Solicitud || '',
        tipo: 'Entrada',
        motivo: 'Cambio_NC',
        remision: remIng,
        referencia: 'Cambio ' + (c.Consecutivo || '') + (c.Cliente ? ' — ' + c.Cliente : '') + (c.Razon_Cambio ? ' — ' + c.Razon_Cambio : ''),
        empresa: c.Empresa || '',
        producto: _normProd(c.Producto),
        presentacion: '',
        cantidad: cant,
        _ajusteId: null
      });
    } else if (c.Tipo_Linea === 'ENTREGAR') {
      var bodegaSal = (c.Bodega_Salida || '').trim();
      if (bodegaSal !== 'Producto No Conforme') return;
      var remSal = String(c.Remision_Salida || '').trim();
      if (!remSal) return;
      ncMovimientos.push({
        fecha: c.Fecha_Salida || c.Fecha_Solicitud || '',
        tipo: 'Salida',
        motivo: 'Cambio_NC',
        remision: remSal,
        referencia: 'Cambio ' + (c.Consecutivo || '') + (c.Cliente ? ' — ' + c.Cliente : ''),
        empresa: c.Empresa || '',
        producto: _normProd(c.Producto),
        presentacion: '',
        cantidad: cant,
        _ajusteId: null
      });
    }
  });

  // Devoluciones a Bodega No Conforme
  kxDevoluciones.forEach(function(d) {
    var estado = (d.Estado || '').toLowerCase();
    if (estado === 'anulado' || estado === 'pendiente') return;
    var cant = Number(d.Cant_Entregada || d.Cantidad) || 0;
    if (cant <= 0) return;
    var bodegaIng = (d.Bodega_Ingreso || '').trim();
    if (bodegaIng !== 'Producto No Conforme') return;
    ncMovimientos.push({
      fecha: d.Fecha_Devolucion || d.Fecha || '',
      tipo: 'Entrada',
      motivo: 'Devolucion_NC',
      remision: d.Remision || d.Remision_Ingreso || '',
      referencia: 'Dev. ' + (d.Consecutivo || '') + (d.Motivo ? ' — ' + d.Motivo : ''),
      empresa: d.Empresa || '',
      producto: _normProd(d.Producto),
      presentacion: d.Presentacion || '',
      cantidad: cant,
      _ajusteId: null
    });
  });

  ncAjustes.forEach(function(a) {
    var cant = Number(a.Cantidad) || 0;
    if (cant <= 0) return;
    var tipo = a.Tipo || '';
    var esTipo;
    var motivo;
    if (tipo === 'Saldo_Inicial_NC') {
      esTipo = 'Entrada';
      motivo = 'Saldo_Inicial';
    } else if (tipo === 'Ingreso_NC') {
      esTipo = 'Entrada';
      motivo = a.Motivo || '';
    } else if (tipo === 'Salida_NC') {
      esTipo = 'Salida';
      motivo = a.Motivo || '';
    } else {
      return;
    }
    ncMovimientos.push({
      fecha: a.Fecha || '',
      tipo: esTipo,
      motivo: motivo,
      remision: a.Remision || '',
      referencia: a.Observaciones || '',
      empresa: a.Empresa || '',
      producto: _normProd(a.Producto),
      presentacion: a.Presentacion || '',
      cantidad: cant,
      _ajusteId: a.__row || a.id || null
    });
  });

  // Regla global: sin remisión solo se admite Saldo Inicial.
  ncMovimientos = ncMovimientos.filter(function(m) {
    if (m.motivo === 'Saldo_Inicial') return true;
    return !!(m.remision && String(m.remision).trim());
  });
}

// ── NC Filters ──
var ncFiltersAttached = false;

function populateNCFilters() {
  if (!ncFiltersAttached) {
    document.getElementById('nc-f-empresa').addEventListener('change', function() {
      populateNCProductFilter();
      calcularNC();
    });
    document.getElementById('nc-f-prod').addEventListener('change', calcularNC);
    document.getElementById('nc-f-desde').addEventListener('change', calcularNC);
    document.getElementById('nc-f-hasta').addEventListener('change', calcularNC);
    ncFiltersAttached = true;
  }
  populateNCProductFilter();
}

function populateNCProductFilter() {
  var fEmp = document.getElementById('nc-f-empresa').value;
  var productos = {};
  ncMovimientos.forEach(function(m) {
    if (fEmp && m.empresa !== fEmp) return;
    if (m.producto) productos[m.producto] = true;
  });
  var sorted = Object.keys(productos).sort();
  var fp = document.getElementById('nc-f-prod');
  var current = fp.value;
  fp.innerHTML = '<option value="">— Todos —</option>' + sorted.map(function(p) {
    return '<option value="' + p.replace(/"/g, '&quot;') + '">' + p + '</option>';
  }).join('');
  if (current && sorted.indexOf(current) >= 0) fp.value = current;
}

function clearNCFilters() {
  document.getElementById('nc-f-empresa').value = '';
  document.getElementById('nc-f-prod').value = '';
  document.getElementById('nc-f-desde').value = '';
  document.getElementById('nc-f-hasta').value = '';
  populateNCProductFilter();
  calcularNC();
}

// ── NC Calculate & Render ──
function calcularNC() {
  var fEmp = document.getElementById('nc-f-empresa').value;
  var fProd = document.getElementById('nc-f-prod').value;
  var fDesde = document.getElementById('nc-f-desde').value;
  var fHasta = document.getElementById('nc-f-hasta').value;

  if (!fEmp) {
    document.getElementById('nc-no-filter').style.display = 'block';
    document.getElementById('nc-table-wrap').style.display = 'none';
    document.getElementById('nc-s-saldo-ini').textContent = '0';
    document.getElementById('nc-s-total').textContent = '0';
    document.getElementById('nc-s-salidas').textContent = '0';
    document.getElementById('nc-s-saldo').textContent = '0';
    document.getElementById('row-ct-nc').textContent = '';
    return;
  }

  document.getElementById('nc-no-filter').style.display = 'none';
  document.getElementById('nc-table-wrap').style.display = 'block';

  var fechaCorte = '2026-07-01';
  ncFiltered = ncMovimientos.filter(function(m) {
    if (m.empresa !== fEmp) return false;
    if (fProd && m.producto !== fProd) return false;
    var desde = fDesde || fechaCorte;
    if (m.fecha < desde) return false;
    if (fHasta && m.fecha > fHasta) return false;
    return true;
  });

  ncFiltered.sort(function(a, b) {
    var da = a.fecha || '';
    var db = b.fecha || '';
    if (da !== db) return da < db ? -1 : 1;
    var pa = a.motivo === 'Saldo_Inicial' ? 0 : 1;
    var pb = b.motivo === 'Saldo_Inicial' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    var ea = a.tipo === 'Entrada' ? 0 : 1;
    var eb = b.tipo === 'Entrada' ? 0 : 1;
    return ea - eb;
  });

  var saldoIni = 0;
  var totalEntradas = 0;
  var totalSalidas = 0;
  var saldosPorProducto = {};

  ncFiltered.forEach(function(m) {
    if (!saldosPorProducto[m.producto]) saldosPorProducto[m.producto] = 0;
    if (m.tipo === 'Entrada') {
      saldosPorProducto[m.producto] += m.cantidad;
      if (m.motivo === 'Saldo_Inicial') {
        saldoIni += m.cantidad;
      } else {
        totalEntradas += m.cantidad;
      }
    } else {
      saldosPorProducto[m.producto] -= m.cantidad;
      totalSalidas += m.cantidad;
    }
    m._saldo = saldosPorProducto[m.producto];
  });

  var saldoTotal = 0;
  Object.keys(saldosPorProducto).forEach(function(k) { saldoTotal += saldosPorProducto[k]; });

  document.getElementById('nc-s-saldo-ini').textContent = saldoIni.toLocaleString('es-CO');
  document.getElementById('nc-s-total').textContent = totalEntradas.toLocaleString('es-CO');
  document.getElementById('nc-s-salidas').textContent = totalSalidas.toLocaleString('es-CO');
  document.getElementById('nc-s-saldo').textContent = saldoTotal.toLocaleString('es-CO');

  renderNCTable();
}

var NC_MOTIVO_LABELS = {
  'Saldo_Inicial': 'Saldo Inicial',
  'Vencimiento': 'Vencimiento',
  'Daño': 'Daño',
  'Calidad': 'Calidad',
  'Devolucion_cliente': 'Dev. cliente',
  'Etiquetado': 'Etiquetado',
  'Contaminacion': 'Contaminación',
  'Disposicion_final': 'Disposición final',
  'Devolucion_proveedor': 'Dev. proveedor',
  'Reacondicionamiento': 'Reacondicionamiento',
  'Retorno_conforme': 'Retorno conforme',
  'Traslado_NC': 'Traslado entre bodegas NC',
  'Produccion_NC': 'Salida Producción',
  'Devolucion_NC': 'Devolución',
  'Cambio_NC': 'Cambio',
  'Otro': 'Otro'
};

var NC_MOTIVO_COLORS = {
  'Saldo_Inicial': '#1a5276',
  'Vencimiento': '#e74c3c',
  'Daño': '#d35400',
  'Calidad': '#8e44ad',
  'Devolucion_cliente': '#2980b9',
  'Etiquetado': '#f39c12',
  'Contaminacion': '#c0392b',
  'Disposicion_final': '#7f8c8d',
  'Devolucion_proveedor': '#1abc9c',
  'Reacondicionamiento': '#27ae60',
  'Retorno_conforme': '#0e6655',
  'Traslado_NC': '#16a085',
  'Produccion_NC': '#d35400',
  'Devolucion_NC': '#e67e22',
  'Cambio_NC': '#2980b9',
  'Otro': '#718096'
};

function renderNCTable() {
  var cols = ['#', 'Fecha', 'Tipo', 'Motivo', 'Producto', 'Presentación', 'N° Remisión', 'Entrada', 'Salida', 'Saldo', 'Observaciones', ''];
  document.getElementById('t-head-nc').innerHTML = cols.map(function(c) {
    return '<th>' + c + '</th>';
  }).join('');

  document.getElementById('row-ct-nc').textContent = '(' + ncFiltered.length + ' movimientos)';

  var tbody = document.getElementById('t-body-nc');
  if (!ncFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay movimientos en la bodega NC con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = ncFiltered.map(function(m, i) {
    var motivoLabel = NC_MOTIVO_LABELS[m.motivo] || m.motivo || '—';
    var motivoColor = NC_MOTIVO_COLORS[m.motivo] || '#718096';
    var entradaStr = m.tipo === 'Entrada' ? '<span style="color:#e67e22;font-weight:700">+' + m.cantidad.toLocaleString('es-CO') + '</span>' : '';
    var salidaStr = m.tipo === 'Salida' ? '<span style="color:#27ae60;font-weight:700">−' + m.cantidad.toLocaleString('es-CO') + '</span>' : '';
    var saldoColor = m._saldo < 0 ? '#e74c3c' : '#c0392b';
    var editBtn = m._ajusteId && AUTH.canEdit() ? '<button class="btn-edit" onclick="openEditNC(' + m._ajusteId + ')" title="Editar registro" style="font-size:0.72rem;padding:3px 8px">✏️</button>' : '';
    var deleteBtn = m._ajusteId && AUTH.canDelete() ? '<button class="btn-del" onclick="openDeleteNC(' + m._ajusteId + ',\'' + (m.tipo || '').replace(/'/g, "\\'") + '\',' + m.cantidad + ')" title="Eliminar registro" style="font-size:0.72rem;padding:3px 8px">🗑️</button>' : '';
    var pdfBtn = m.remision ? '<button onclick="exportarRemisionKardexPDF(' + i + ',\'nc\')" title="Exportar PDF remision" style="background:none;border:none;cursor:pointer;font-size:0.74rem;padding:1px 4px;opacity:0.6;vertical-align:middle" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.6\'">📄</button>' : '';

    return '<tr' + (m.motivo === 'Saldo_Inicial' ? ' style="background:#f0f9ff"' : '') + '>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.8rem">' + fmtDate(m.fecha) + '</td>' +
      '<td><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;color:white;background:' + (m.tipo === 'Entrada' ? '#e67e22' : '#27ae60') + '">' + (m.tipo === 'Entrada' ? 'Ingreso' : 'Salida') + '</span></td>' +
      '<td><span style="background:' + motivoColor + ';color:white;padding:2px 9px;border-radius:12px;font-size:0.72rem;font-weight:700">' + motivoLabel + '</span></td>' +
      '<td style="font-size:0.82rem;font-weight:600">' + (m.producto || '—') + '</td>' +
      '<td style="font-size:0.78rem">' + (m.presentacion || '—') + '</td>' +
      '<td style="font-size:0.78rem;white-space:nowrap">' + (m.remision || '—') + pdfBtn + '</td>' +
      '<td style="text-align:right">' + entradaStr + '</td>' +
      '<td style="text-align:right">' + salidaStr + '</td>' +
      '<td style="text-align:right;font-weight:800;color:' + saldoColor + '">' + m._saldo.toLocaleString('es-CO') + '</td>' +
      '<td style="font-size:0.78rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (m.referencia || '').replace(/"/g, '&quot;') + '">' + (m.referencia || '—') + '</td>' +
      '<td><div style="display:flex;gap:4px">' + editBtn + deleteBtn + '</div></td>' +
    '</tr>';
  }).join('');
}

// ── NC Export Excel ──
function exportNCExcel() {
  if (!ncFiltered.length) { showToast('No hay datos para exportar. Selecciona una empresa.', '#e74c3c'); return; }

  var fEmp = document.getElementById('nc-f-empresa').value;

  var data = ncFiltered.map(function(m, i) {
    return {
      '#': i + 1,
      'Fecha': m.fecha || '',
      'Tipo': m.tipo === 'Entrada' ? 'Ingreso NC' : 'Salida NC',
      'Motivo': NC_MOTIVO_LABELS[m.motivo] || m.motivo || '',
      'Producto': m.producto,
      'Presentación': m.presentacion,
      'N° Remisión': m.remision || '',
      'Entrada': m.tipo === 'Entrada' ? m.cantidad : '',
      'Salida': m.tipo === 'Salida' ? m.cantidad : '',
      'Saldo': m._saldo,
      'Observaciones': m.referencia || ''
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 30 },
    { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 35 }
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bodega NC');
  var filename = 'BodegaNC_' + getSiglaKx(fEmp) + '_' + today() + '.xlsx';
  XLSX.writeFile(wb, filename);
  showToast('Excel exportado: ' + ncFiltered.length + ' movimientos');
}

// ══════════════════════════════════════════
// ── NC MODAL (Ingreso / Salida) ──
// ══════════════════════════════════════════

var ncLineas = [];
var ncModalTipo = 'Ingreso_NC';

function openNCModal(tipo) {
  editNCId = null;
  ncModalTipo = tipo;
  var isIngreso = tipo === 'Ingreso_NC';
  document.getElementById('nc-modal-title').textContent = isIngreso ? '📥 Ingreso a Bodega No Conforme' : '📤 Salida de Bodega No Conforme';
  document.getElementById('nc-modal-sub').textContent = isIngreso ? 'Registra producto que ingresa a la bodega NC' : 'Registra producto que sale de la bodega NC';
  document.getElementById('nc-modal-hdr').style.background = isIngreso ? 'linear-gradient(135deg,#e67e22,#f39c12)' : 'linear-gradient(135deg,#27ae60,#2ecc71)';
  document.getElementById('btn-save-nc').style.background = isIngreso ? '#e67e22' : '#27ae60';
  document.getElementById('btn-save-nc').textContent = isIngreso ? '✓ Registrar ingreso' : '✓ Registrar salida';
  document.getElementById('nc-fecha').value = today();
  document.getElementById('nc-empresa').value = document.getElementById('nc-f-empresa').value || '';
  document.getElementById('nc-motivo').value = isIngreso ? 'Vencimiento' : 'Disposicion_final';
  document.getElementById('nc-remision').value = '';
  document.getElementById('nc-observaciones').value = '';
  document.getElementById('btn-save-nc').disabled = false;
  ncLineas = [{ Producto: '', Presentacion: '', Cantidad: '' }];
  renderNCLines();
  document.getElementById('nc-overlay').classList.add('show');
}

function closeNCModal() {
  document.getElementById('nc-overlay').classList.remove('show');
  closeAllAutocompleteKx();
}
document.getElementById('nc-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeNCModal(); });

function renderNCLines() {
  var tbody = document.getElementById('nc-lines');
  tbody.innerHTML = ncLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef nc-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto || '').replace(/"/g, '&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef nc-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion || '').replace(/"/g, '&quot;')) + '" placeholder="Pres." style="width:100px"></td>' +
      '<td><input class="ef nc-cant" data-line="' + i + '" type="number" min="0" value="' + (l.Cantidad || '') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeNCLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  ncLineas.forEach(function(l, i) { buildKxProductSearch('nc', i); });
}

function addNCLine() {
  ncLineas.push({ Producto: '', Presentacion: '', Cantidad: '' });
  renderNCLines();
  var lastInput = document.querySelector('.nc-prod-search[data-line="' + (ncLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeNCLine(i) {
  if (ncLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  ncLineas.splice(i, 1);
  renderNCLines();
}

function readNCLines() {
  document.querySelectorAll('.nc-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ncLineas[i]) ncLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.nc-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ncLineas[i]) ncLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.nc-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ncLineas[i]) ncLineas[i].Cantidad = Number(inp.value) || 0;
  });
}

async function saveNC() {
  if (editNCId) { await saveEditNC(); return; }
  var fecha = document.getElementById('nc-fecha').value;
  var empresa = document.getElementById('nc-empresa').value;
  var motivo = document.getElementById('nc-motivo').value;
  var remision = document.getElementById('nc-remision').value.trim();
  var obs = document.getElementById('nc-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }

  readNCLines();
  var validLines = ncLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-nc');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarKardexNC',
      Fecha: fecha,
      Empresa: empresa,
      Tipo: ncModalTipo,
      Motivo: motivo,
      Remision: remision,
      Observaciones: obs,
      lineas: validLines
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeNCModal();
    showToast('✅ ' + result.added + ' registro(s) NC guardado(s)');
    await loadKardex();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = ncModalTipo === 'Ingreso_NC' ? '✓ Registrar ingreso' : '✓ Registrar salida';
  }
}

// ── NC Edit ──
var editNCId = null;

function openEditNC(id) {
  var reg = ncAjustes.find(function(a) { return (a.__row || a.id) === id; });
  if (!reg) { showToast('Registro no encontrado', '#e74c3c'); return; }

  editNCId = id;
  var isIngreso = reg.Tipo === 'Ingreso_NC' || reg.Tipo === 'Saldo_Inicial_NC';
  ncModalTipo = reg.Tipo;

  document.getElementById('nc-modal-title').textContent = '✏️ Editar registro NC';
  document.getElementById('nc-modal-sub').textContent = 'Modifica los datos del registro de bodega No Conforme';
  document.getElementById('nc-modal-hdr').style.background = 'linear-gradient(135deg,#2c3e50,#34495e)';
  document.getElementById('btn-save-nc').style.background = '#2c3e50';
  document.getElementById('btn-save-nc').textContent = '✓ Guardar cambios';
  document.getElementById('btn-save-nc').disabled = false;

  document.getElementById('nc-fecha').value = reg.Fecha || '';
  document.getElementById('nc-empresa').value = reg.Empresa || '';
  document.getElementById('nc-motivo').value = reg.Motivo || 'Otro';
  document.getElementById('nc-remision').value = reg.Remision || '';
  document.getElementById('nc-observaciones').value = reg.Observaciones || '';

  ncLineas = [{ Producto: reg.Producto || '', Presentacion: reg.Presentacion || '', Cantidad: reg.Cantidad || 0 }];
  renderNCLines();
  document.getElementById('nc-overlay').classList.add('show');
}

async function saveEditNC() {
  var fecha = document.getElementById('nc-fecha').value;
  var empresa = document.getElementById('nc-empresa').value;
  var motivo = document.getElementById('nc-motivo').value;
  var remision = document.getElementById('nc-remision').value.trim();
  var obs = document.getElementById('nc-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }

  readNCLines();
  var line = ncLineas[0];
  if (!line || !line.Producto || line.Cantidad <= 0) { showToast('Completa el producto y cantidad', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-nc');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'editarKardexNC',
      row: editNCId,
      Fecha: fecha,
      Empresa: empresa,
      Tipo: ncModalTipo,
      Producto: line.Producto,
      Presentacion: line.Presentacion,
      Cantidad: line.Cantidad,
      Motivo: motivo,
      Remision: remision,
      Observaciones: obs
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    editNCId = null;
    closeNCModal();
    showToast('✅ Registro NC actualizado');
    await loadKardex();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Guardar cambios';
  }
}

// ── NC Delete ──
var deleteNCRow = null;

function openDeleteNC(row, tipo, cantidad) {
  deleteNCRow = row;
  document.getElementById('del-nc-msg').textContent = '¿Eliminar este registro de la bodega NC?';
  document.getElementById('del-nc-detail').innerHTML =
    'Tipo: <strong>' + tipo + '</strong> · Cantidad: ' + Number(cantidad).toLocaleString('es-CO') + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará este registro de la base de datos.</span>';
  document.getElementById('btn-del-nc-confirm').disabled = false;
  document.getElementById('btn-del-nc-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-nc-overlay').classList.add('show');
}

function closeDeleteNC() {
  document.getElementById('delete-nc-overlay').classList.remove('show');
  deleteNCRow = null;
}
document.getElementById('delete-nc-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteNC(); });

async function confirmDeleteNC() {
  if (!deleteNCRow) return;
  var btn = document.getElementById('btn-del-nc-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarKardexNC', row: deleteNCRow });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDeleteNC();
    showToast('🗑️ Registro NC eliminado');
    await loadKardex();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ══════════════════════════════════════════
// ── NC SALDO INICIAL MODAL ──
// ══════════════════════════════════════════

var ncsiLineas = [];

function openNCSaldoModal() {
  document.getElementById('ncsi-fecha').value = today();
  document.getElementById('ncsi-empresa').value = document.getElementById('nc-f-empresa').value || '';
  document.getElementById('ncsi-observaciones').value = '';
  document.getElementById('btn-save-ncsi').disabled = false;
  document.getElementById('btn-save-ncsi').textContent = '✓ Cargar saldo inicial';
  ncsiLineas = [{ Producto: '', Presentacion: '', Cantidad: '' }];
  renderNCSiLines();
  document.getElementById('nc-saldo-overlay').classList.add('show');
}

function closeNCSaldoModal() {
  document.getElementById('nc-saldo-overlay').classList.remove('show');
  closeAllAutocompleteKx();
}
document.getElementById('nc-saldo-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeNCSaldoModal(); });

function renderNCSiLines() {
  var tbody = document.getElementById('ncsi-lines');
  tbody.innerHTML = ncsiLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef ncsi-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto || '').replace(/"/g, '&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef ncsi-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion || '').replace(/"/g, '&quot;')) + '" placeholder="Pres." style="width:100px"></td>' +
      '<td><input class="ef ncsi-cant" data-line="' + i + '" type="number" min="0" value="' + (l.Cantidad || '') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeNCSiLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  ncsiLineas.forEach(function(l, i) { buildKxProductSearch('ncsi', i); });
}

function addNCSaldoLine() {
  ncsiLineas.push({ Producto: '', Presentacion: '', Cantidad: '' });
  renderNCSiLines();
  var lastInput = document.querySelector('.ncsi-prod-search[data-line="' + (ncsiLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeNCSiLine(i) {
  if (ncsiLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  ncsiLineas.splice(i, 1);
  renderNCSiLines();
}

function readNCSiLines() {
  document.querySelectorAll('.ncsi-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ncsiLineas[i]) ncsiLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.ncsi-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ncsiLineas[i]) ncsiLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.ncsi-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ncsiLineas[i]) ncsiLineas[i].Cantidad = Number(inp.value) || 0;
  });
}

async function saveNCSaldo() {
  var fecha = document.getElementById('ncsi-fecha').value;
  var empresa = document.getElementById('ncsi-empresa').value;
  var obs = document.getElementById('ncsi-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha de corte', '#e74c3c'); return; }
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }

  readNCSiLines();
  var validLines = ncsiLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-ncsi');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarKardexNC',
      Fecha: fecha,
      Empresa: empresa,
      Tipo: 'Saldo_Inicial_NC',
      Motivo: 'Saldo Inicial',
      Observaciones: obs || 'Saldo inicial bodega NC',
      lineas: validLines
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeNCSaldoModal();
    showToast('✅ ' + result.added + ' saldo(s) inicial(es) NC cargado(s)');
    await loadKardex();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Cargar saldo inicial';
  }
}

// ══════════════════════════════════════════
// ── EXISTENCIAS POR EMPRESA ──
// ══════════════════════════════════════════

var EMPRESAS_EXIST = [];

// ── Productos de PARCELAR cuyo proveedor es CARVAL ──
// Se muestran en una columna virtual "PARCELAR (CARVAL)" separada
// dentro del módulo "Existencias por Empresa".
var PARCELAR_EMPRESA_VAL = 'PARCELAR DE COLOMBIA SAS';
var PARCELAR_CARVAL_VAL  = 'PARCELAR - CARVAL';
var PARCELAR_CARVAL_SIGLA = 'PARCELAR (CARVAL)';

var CARVAL_PRODUCTS = (function() {
  var list = [
    'CERTUS 70 WS X 100 GR CV',
    'CERTUS 70 WS X 50 GR',
    'CERTUS 70 WS 50 GM',
    'CERTUS 70 WS X 500 GR CV',
    'CONTRA 200 SC X 200 ML',
    'CUFIGA 80 WP X 500 GR CV',
    'DIRVO 60% WG X 20 GR CV',
    'DIRVO 60% WG X KILO ( METSULFURON) CV',
    'FICLORAM LITRO',
    'FICLORAM SL X GALON',
    'FICLORAM X BIDON 20 LITROS',
    'FIPRID 75 SC 100ML CV',
    'FOSTAL 80 WP X 500 GR CV',
    'GRADUS 43 SC X LITRO CV',
    'GRADUS 43 X 500 ML CV',
    'HEXAZINONA 300 GR',
    'LAMBDA CIHALOTRINA X 100 ML',
    'LAMBDA CIHALOTRINA X 500 ML',
    'LAMBDA CIHALOTRINA X LITRO',
    'RUDOWN X 1 KG',
    'RUDOWN X1KG',
    'RUDOWN X 50 GR',
    'RUDOWN X50GR',
    'SAGUM 25 SC X 500 ML CV',
    'SAGUM X LITRO CV',
    'SHOCK UPI 36 EG X 500G',
    'TABUS 50 WG X 40 GR CV'
  ];
  var set = {};
  list.forEach(function(p) { set[_normProd(p).toUpperCase()] = true; });
  return set;
})();

function _esCarval(producto) {
  return !!CARVAL_PRODUCTS[_normProd(producto).toUpperCase()];
}

// ── Productos de PARCELAR cuyo proveedor es GERMISEMILLAS ──
var PARCELAR_GERMI_VAL   = 'PARCELAR - GERMISEMILLAS';
var PARCELAR_GERMI_SIGLA = 'PARCELAR (GERMISEMILLAS)';

function _esGermisemillas(producto) {
  return /maxi\s*pasto/i.test(producto);
}

function _empresaExistKey(empresa, producto) {
  if (empresa === PARCELAR_EMPRESA_VAL) {
    if (_esCarval(producto)) return PARCELAR_CARVAL_VAL;
    if (_esGermisemillas(producto)) return PARCELAR_GERMI_VAL;
  }
  return empresa;
}

var PARCELAR_BUCKETS = [
  { key: PARCELAR_EMPRESA_VAL, label: 'Propio' },
  { key: PARCELAR_CARVAL_VAL,  label: 'Carval' },
  { key: PARCELAR_GERMI_VAL,   label: 'Germisemillas' }
];

function _empresasExistView() {
  return EMPRESAS_EXIST.slice();
}

function _allParcelarKeys() {
  return [PARCELAR_EMPRESA_VAL, PARCELAR_CARVAL_VAL, PARCELAR_GERMI_VAL];
}

var existData = [];
var existFiltered = [];
var existFiltersAttached = false;

function debugKardexProducto(filtro) {
  var f = (filtro || '').toUpperCase();
  var encontrados = kxMovimientos.filter(function(m) {
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
  console.log('=== DEBUG Kardex (' + filtro + ') ===');
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
  return porEmpresa;
}

function calcularExistencias() {
  var saldos = {};

  var fechaCorte = null;
  kxMovimientos.forEach(function(m) {
    if (m.modulo === 'Saldo Inicial' && m.fecha) {
      if (!fechaCorte || m.fecha < fechaCorte) fechaCorte = m.fecha;
    }
  });

  var elCorteHasta = document.getElementById('ex-f-corte');
  var corteHasta = elCorteHasta ? (elCorteHasta.value || '') : '';

  var empresasView = _empresasExistView();

  kxMovimientos.forEach(function(m) {
    if (!m.producto || !m.empresa) return;
    if (fechaCorte && m.fecha < fechaCorte) return;
    if (corteHasta && m.fecha && m.fecha > corteHasta) return;
    var key = m.producto;
    if (!saldos[key]) {
      saldos[key] = { producto: m.producto };
      empresasView.forEach(function(e) { saldos[key][e.value] = 0; });
    }
    var bucket = _empresaExistKey(m.empresa, m.producto);
    if (typeof saldos[key][bucket] === 'undefined') {
      saldos[key][bucket] = 0;
    }
    if (m.tipo === 'Entrada') {
      saldos[key][bucket] += m.cantidad;
    } else {
      saldos[key][bucket] -= m.cantidad;
    }
  });

  var parcelarKeys = _allParcelarKeys();
  existData = Object.keys(saldos).sort().map(function(k) {
    var row = saldos[k];
    var total = 0;
    empresasView.forEach(function(e) {
      if (e.value === PARCELAR_EMPRESA_VAL) {
        parcelarKeys.forEach(function(pk) { total += (row[pk] || 0); });
      } else {
        total += (row[e.value] || 0);
      }
    });
    row._total = total;
    return row;
  });

  var selEmp = document.getElementById('ex-f-empresa');
  var prevEmp = selEmp.value;
  selEmp.innerHTML = '<option value="">— Todas —</option>' +
    empresasView.map(function(e) {
      return '<option value="' + e.value + '">' + e.sigla + '</option>';
    }).join('');
  var stillExists = empresasView.some(function(e) { return e.value === prevEmp; });
  selEmp.value = stillExists ? prevEmp : '';

  if (!existFiltersAttached) {
    document.getElementById('ex-f-buscar').addEventListener('input', renderExistencias);
    document.getElementById('ex-f-mostrar').addEventListener('change', renderExistencias);
    document.getElementById('ex-f-empresa').addEventListener('change', renderExistencias);
    document.getElementById('ex-f-corte').addEventListener('change', calcularExistencias);
    existFiltersAttached = true;
  }

  renderExistencias();
}

function clearExistFilters() {
  document.getElementById('ex-f-buscar').value = '';
  document.getElementById('ex-f-mostrar').value = 'todos';
  document.getElementById('ex-f-empresa').value = '';
  document.getElementById('ex-f-corte').value = '';
  calcularExistencias();
}

function renderExistencias() {
  var buscar = (document.getElementById('ex-f-buscar').value || '').toLowerCase().trim();
  var mostrar = document.getElementById('ex-f-mostrar').value;
  var empresaSel = document.getElementById('ex-f-empresa').value;

  var empresasAll = _empresasExistView();
  var empresasView = empresaSel
    ? empresasAll.filter(function(e) { return e.value === empresaSel; })
    : empresasAll;

  var parcelarKeys = _allParcelarKeys();
  function _existEmpVal(row, eValue) {
    if (eValue === PARCELAR_EMPRESA_VAL) {
      var s = 0;
      parcelarKeys.forEach(function(pk) { s += (row[pk] || 0); });
      return s;
    }
    return row[eValue] || 0;
  }

  existFiltered = existData.filter(function(row) {
    if (buscar && row.producto.toLowerCase().indexOf(buscar) < 0) return false;
    var totalView = 0;
    empresasView.forEach(function(e) { totalView += _existEmpVal(row, e.value); });
    row._totalView = totalView;
    if (mostrar === 'con_stock' && totalView <= 0) return false;
    if (mostrar === 'sin_stock' && totalView !== 0) return false;
    if (mostrar === 'negativo' && totalView >= 0) return false;
    return true;
  });

  var totalUnidades = 0;
  var empresasConStock = {};
  existFiltered.forEach(function(row) {
    empresasView.forEach(function(e) {
      var val = _existEmpVal(row, e.value);
      if (val > 0) empresasConStock[e.value] = true;
    });
    totalUnidades += row._totalView;
  });

  document.getElementById('ex-s-productos').textContent = existFiltered.length.toLocaleString('es-CO');
  document.getElementById('ex-s-empresas').textContent = Object.keys(empresasConStock).length;
  document.getElementById('ex-s-total').textContent = totalUnidades.toLocaleString('es-CO');
  document.getElementById('row-ct-ex').textContent = '(' + existFiltered.length + ' productos)';

  renderExistTable(empresasView);
}

function _existCellVal(row, eValue) {
  if (eValue === PARCELAR_EMPRESA_VAL) {
    var s = 0;
    _allParcelarKeys().forEach(function(pk) { s += (row[pk] || 0); });
    return s;
  }
  return row[eValue] || 0;
}

function _parcelarCategory(producto) {
  if (_esCarval(producto)) return 'carval';
  if (_esGermisemillas(producto)) return 'germisemillas';
  return 'propio';
}

function _groupByParcelarCategory(items) {
  var groups = { propio: [], carval: [], germisemillas: [] };
  items.forEach(function(row) {
    var cat = _parcelarCategory(row.producto);
    groups[cat].push(row);
  });
  return groups;
}

function renderExistTable(empresasView) {
  empresasView = empresasView || _empresasExistView();
  var showTotal = empresasView.length > 1;
  var hasParcelarCol = empresasView.some(function(e) { return e.value === PARCELAR_EMPRESA_VAL; });
  var tbl = document.getElementById('tbl-ex');
  if (tbl) tbl.classList.toggle('single', empresasView.length === 1);
  var thead = document.getElementById('t-head-ex');
  var headerCols = '<th style="position:sticky;left:0;background:#f0f4f8;z-index:2">#</th>' +
    '<th style="position:sticky;left:30px;background:#f0f4f8;z-index:2;min-width:220px">Producto</th>';
  empresasView.forEach(function(e) {
    headerCols += '<th style="text-align:right;min-width:90px">' + e.sigla + '</th>';
  });
  if (showTotal) headerCols += '<th style="text-align:right;min-width:90px;background:#edf2f7;font-weight:800">TOTAL</th>';
  thead.innerHTML = headerCols;

  var tbody = document.getElementById('t-body-ex');
  var colSpan = 2 + empresasView.length + (showTotal ? 1 : 0);
  if (!existFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="' + colSpan + '"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay productos con los filtros seleccionados.</div></td></tr>';
    document.getElementById('t-foot-ex').innerHTML = '';
    return;
  }

  function buildProductRow(row, num) {
    var html = '<tr>' +
      '<td style="color:#718096;font-size:0.78rem;position:sticky;left:0;background:white;z-index:1">' + num + '</td>' +
      '<td style="font-size:0.82rem;font-weight:600;position:sticky;left:30px;background:white;z-index:1;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + row.producto.replace(/"/g, '&quot;') + '">' + row.producto + '</td>';
    empresasView.forEach(function(e) {
      var val = _existCellVal(row, e.value);
      var color = val > 0 ? '#27ae60' : val < 0 ? '#e74c3c' : '#cbd5e0';
      var weight = val !== 0 ? '700' : '400';
      html += '<td style="text-align:right;font-weight:' + weight + ';color:' + color + ';font-size:0.84rem">' + val.toLocaleString('es-CO') + '</td>';
    });
    if (showTotal) {
      var totalView = row._totalView != null ? row._totalView : row._total;
      var totalColor = totalView > 0 ? '#2c3e50' : totalView < 0 ? '#e74c3c' : '#cbd5e0';
      html += '<td style="text-align:right;font-weight:800;color:' + totalColor + ';background:#f7fafc;font-size:0.88rem">' + totalView.toLocaleString('es-CO') + '</td>';
    }
    html += '</tr>';
    return html;
  }

  var rows = [];
  var num = 1;

  if (hasParcelarCol) {
    var groups = _groupByParcelarCategory(existFiltered);
    var sections = [
      { key: 'propio', label: 'Propio' },
      { key: 'carval', label: 'Carval' },
      { key: 'germisemillas', label: 'Maxi Pasto' }
    ];
    sections.forEach(function(sec) {
      var items = groups[sec.key];
      if (!items.length) return;
      rows.push('<tr style="background:#e8eef4"><td colspan="' + colSpan + '" style="font-weight:800;font-size:0.88rem;color:#1a5276;padding:10px 12px;position:sticky;left:0">' + sec.label + '</td></tr>');
      items.forEach(function(row) {
        rows.push(buildProductRow(row, num++));
      });
    });
  } else {
    existFiltered.forEach(function(row) {
      rows.push(buildProductRow(row, num++));
    });
  }
  tbody.innerHTML = rows.join('');

  var totales = {};
  empresasView.forEach(function(e) { totales[e.value] = 0; });
  var granTotal = 0;
  existFiltered.forEach(function(row) {
    empresasView.forEach(function(e) { totales[e.value] += _existCellVal(row, e.value); });
    granTotal += (row._totalView != null ? row._totalView : row._total);
  });

  var footHtml = '<td style="position:sticky;left:0;background:#f0f4f8;z-index:1"></td>' +
    '<td style="position:sticky;left:30px;background:#f0f4f8;z-index:1;font-size:0.84rem;font-weight:800;color:#2d3748">TOTALES</td>';
  empresasView.forEach(function(e) {
    var val = totales[e.value];
    var color = val > 0 ? '#27ae60' : val < 0 ? '#e74c3c' : '#718096';
    footHtml += '<td style="text-align:right;font-weight:800;color:' + color + ';font-size:0.88rem">' + val.toLocaleString('es-CO') + '</td>';
  });
  if (showTotal) footHtml += '<td style="text-align:right;font-weight:800;color:#0e6655;background:#e8f5e9;font-size:0.95rem">' + granTotal.toLocaleString('es-CO') + '</td>';
  document.getElementById('t-foot-ex').innerHTML = footHtml;
}

function exportExistExcel() {
  if (!existFiltered.length) { showToast('No hay datos para exportar.', '#e74c3c'); return; }

  var empresaSel = document.getElementById('ex-f-empresa').value;
  var empresasAll = _empresasExistView();
  var empresasView = empresaSel
    ? empresasAll.filter(function(e) { return e.value === empresaSel; })
    : empresasAll;

  var showTotal = empresasView.length > 1;
  var hasParcelarCol = empresasView.some(function(e) { return e.value === PARCELAR_EMPRESA_VAL; });
  var data = [];
  var num = 1;

  function pushProductRow(row) {
    var obj = { '#': num++, 'Producto': row.producto };
    empresasView.forEach(function(e) { obj[e.sigla] = _existCellVal(row, e.value); });
    if (showTotal) obj['TOTAL'] = (row._totalView != null ? row._totalView : row._total);
    data.push(obj);
  }

  if (hasParcelarCol) {
    var groups = _groupByParcelarCategory(existFiltered);
    var sections = [
      { key: 'propio', label: 'Propio' },
      { key: 'carval', label: 'Carval' },
      { key: 'germisemillas', label: 'Maxi Pasto' }
    ];
    sections.forEach(function(sec) {
      if (!groups[sec.key].length) return;
      var header = { '#': '', 'Producto': sec.label };
      empresasView.forEach(function(e) { header[e.sigla] = ''; });
      if (showTotal) header['TOTAL'] = '';
      data.push(header);
      groups[sec.key].forEach(pushProductRow);
    });
  } else {
    existFiltered.forEach(pushProductRow);
  }

  var corteEx = (document.getElementById('ex-f-corte') || {}).value || '';
  var empresaLabel = empresaSel
    ? ((empresasView[0] && empresasView[0].sigla ? empresasView[0].sigla + ' — ' : '') + empresaSel)
    : 'Todas las empresas';
  var corteLabel = corteEx || today();
  var totalCols = 2 + empresasView.length + (showTotal ? 1 : 0);

  var ws = XLSX.utils.aoa_to_sheet([
    ['Existencias de Producto Bueno por Empresa'],
    ['Empresa: ' + empresaLabel + '   ·   Fecha de corte: ' + corteLabel],
    []
  ]);
  XLSX.utils.sheet_add_json(ws, data, { origin: 'A4' });
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } }
  ];
  var colWidths = [{ wch: 5 }, { wch: 35 }];
  empresasView.forEach(function() { colWidths.push({ wch: 12 }); });
  if (showTotal) colWidths.push({ wch: 12 });
  ws['!cols'] = colWidths;
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Existencias');
  var fnameEx = corteEx
    ? ('Existencias_por_Empresa_corte_' + corteEx + '.xlsx')
    : ('Existencias_por_Empresa_' + today() + '.xlsx');
  XLSX.writeFile(wb, fnameEx);
  showToast('Excel exportado: ' + existFiltered.length + ' productos');
}

// ══════════════════════════════════════════
// ── KARDEX NC (estilo Kardex General) ──
// ══════════════════════════════════════════

var kxncFiltersAttached = false;

function populateKxNCFilters() {
  if (!kxncFiltersAttached) {
    document.getElementById('kxnc-f-empresa').addEventListener('change', function() {
      populateKxNCProductFilter();
      calcularKardexNC();
    });
    document.getElementById('kxnc-f-prod').addEventListener('change', calcularKardexNC);
    document.getElementById('kxnc-f-desde').addEventListener('change', calcularKardexNC);
    document.getElementById('kxnc-f-hasta').addEventListener('change', calcularKardexNC);
    kxncFiltersAttached = true;
  }
  populateKxNCProductFilter();
}

function populateKxNCProductFilter() {
  var fEmp = document.getElementById('kxnc-f-empresa').value;
  var productos = {};
  ncMovimientos.forEach(function(m) {
    if (fEmp && m.empresa !== fEmp) return;
    if (m.producto) productos[m.producto] = true;
  });
  var sorted = Object.keys(productos).sort();
  var fp = document.getElementById('kxnc-f-prod');
  var current = fp.value;
  fp.innerHTML = '<option value="">— Todos —</option>' + sorted.map(function(p) {
    return '<option value="' + p.replace(/"/g, '&quot;') + '">' + p + '</option>';
  }).join('');
  if (current && sorted.indexOf(current) >= 0) fp.value = current;
}

function clearKardexNCFilters() {
  document.getElementById('kxnc-f-empresa').value = '';
  document.getElementById('kxnc-f-prod').value = '';
  document.getElementById('kxnc-f-desde').value = '';
  document.getElementById('kxnc-f-hasta').value = '';
  populateKxNCProductFilter();
  calcularKardexNC();
}

var NC_MODULO_LABELS = {
  'Saldo_Inicial': 'Saldo Inicial NC',
  'Produccion_NC': 'Producción NC',
  'Devolucion_NC': 'Devolución NC'
};

function _kxncModulo(m) {
  if (m.motivo === 'Saldo_Inicial') return 'Saldo Inicial NC';
  if (m.motivo === 'Produccion_NC') return 'Producción NC';
  if (m.motivo === 'Devolucion_NC') return 'Devolución NC';
  if (m.motivo === 'Cambio_NC') return 'Cambio NC';
  if (m.tipo === 'Entrada') return 'Ingreso NC';
  return 'Salida NC';
}

function calcularKardexNC() {
  var fEmp = document.getElementById('kxnc-f-empresa').value;
  var fProd = document.getElementById('kxnc-f-prod').value;
  var fDesde = document.getElementById('kxnc-f-desde').value;
  var fHasta = document.getElementById('kxnc-f-hasta').value;

  if (!fEmp) {
    document.getElementById('kxnc-no-filter').style.display = 'block';
    document.getElementById('kxnc-table-wrap').style.display = 'none';
    document.getElementById('kxnc-s-saldo-ini').textContent = '0';
    document.getElementById('kxnc-s-entradas').textContent = '0';
    document.getElementById('kxnc-s-salidas').textContent = '0';
    document.getElementById('kxnc-s-saldo-act').textContent = '0';
    document.getElementById('row-ct-kxnc').textContent = '';
    return;
  }

  document.getElementById('kxnc-no-filter').style.display = 'none';
  document.getElementById('kxnc-table-wrap').style.display = 'block';

  var fechaCorte = '2026-07-01';
  kxncFiltered = ncMovimientos.filter(function(m) {
    if (m.empresa !== fEmp) return false;
    if (fProd && m.producto !== fProd) return false;
    var desde = fDesde || fechaCorte;
    if (m.fecha < desde) return false;
    if (fHasta && m.fecha > fHasta) return false;
    return true;
  });

  kxncFiltered.sort(function(a, b) {
    var da = a.fecha || '';
    var db = b.fecha || '';
    if (da !== db) return da < db ? -1 : 1;
    var pa = a.motivo === 'Saldo_Inicial' ? 0 : 1;
    var pb = b.motivo === 'Saldo_Inicial' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    var ea = a.tipo === 'Entrada' ? 0 : 1;
    var eb = b.tipo === 'Entrada' ? 0 : 1;
    return ea - eb;
  });

  var saldoIni = 0;
  var totalEntradas = 0;
  var totalSalidas = 0;
  var saldosPorProducto = {};

  kxncFiltered.forEach(function(m) {
    if (!saldosPorProducto[m.producto]) saldosPorProducto[m.producto] = 0;
    if (m.tipo === 'Entrada') {
      saldosPorProducto[m.producto] += m.cantidad;
      if (m.motivo === 'Saldo_Inicial') {
        saldoIni += m.cantidad;
      } else {
        totalEntradas += m.cantidad;
      }
    } else {
      saldosPorProducto[m.producto] -= m.cantidad;
      totalSalidas += m.cantidad;
    }
    m._saldoKxnc = saldosPorProducto[m.producto];
  });

  var saldoTotal = 0;
  Object.keys(saldosPorProducto).forEach(function(k) { saldoTotal += saldosPorProducto[k]; });

  document.getElementById('kxnc-s-saldo-ini').textContent = saldoIni.toLocaleString('es-CO');
  document.getElementById('kxnc-s-entradas').textContent = totalEntradas.toLocaleString('es-CO');
  document.getElementById('kxnc-s-salidas').textContent = totalSalidas.toLocaleString('es-CO');
  document.getElementById('kxnc-s-saldo-act').textContent = saldoTotal.toLocaleString('es-CO');

  renderKardexNCTable();
}

function renderKardexNCTable() {
  var fProd = document.getElementById('kxnc-f-prod').value;
  var showProd = !fProd;
  var cols = showProd
    ? ['#', 'Fecha', 'Tipo', 'Módulo', 'Producto', 'N° Remisión', 'Referencia', 'Entrada', 'Salida', 'Saldo']
    : ['#', 'Fecha', 'Tipo', 'Módulo', 'N° Remisión', 'Referencia', 'Entrada', 'Salida', 'Saldo'];
  var colSpan = cols.length;
  document.getElementById('t-head-kxnc').innerHTML = cols.map(function(c) {
    return '<th>' + c + '</th>';
  }).join('');

  document.getElementById('row-ct-kxnc').textContent = '(' + kxncFiltered.length + ' movimientos)';

  var tbody = document.getElementById('t-body-kxnc');
  if (!kxncFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="' + colSpan + '"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay movimientos NC con los filtros seleccionados.</div></td></tr>';
    return;
  }

  var MOD_COLORS = {
    'Saldo Inicial NC': '#1a5276',
    'Ingreso NC': '#e67e22',
    'Salida NC': '#27ae60',
    'Devolución NC': '#e67e22',
    'Producción NC': '#d35400',
    'Cambio NC': '#2980b9'
  };

  tbody.innerHTML = kxncFiltered.map(function(m, i) {
    var modulo = _kxncModulo(m);
    var modColor = MOD_COLORS[modulo] || '#718096';
    var entradaStr = m.tipo === 'Entrada' ? '<span style="color:#e67e22;font-weight:700">+' + m.cantidad.toLocaleString('es-CO') + '</span>' : '';
    var salidaStr = m.tipo === 'Salida' ? '<span style="color:#27ae60;font-weight:700">−' + m.cantidad.toLocaleString('es-CO') + '</span>' : '';
    var saldoColor = m._saldoKxnc < 0 ? '#e74c3c' : '#c0392b';
    var referencia = m.referencia || '';
    var motivoLbl = NC_MOTIVO_LABELS[m.motivo] || m.motivo || '';
    if (motivoLbl && m.motivo !== 'Saldo_Inicial' && m.motivo !== 'Produccion_NC' && m.motivo !== 'Devolucion_NC') {
      referencia = motivoLbl + (referencia ? ' — ' + referencia : '');
    }
    var pdfBtn = m.remision ? '<button onclick="exportarRemisionKardexPDF(' + i + ',\'kxnc\')" title="Exportar PDF remision" style="background:none;border:none;cursor:pointer;font-size:0.74rem;padding:1px 4px;opacity:0.6;vertical-align:middle" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.6\'">📄</button>' : '';
    var prodCol = showProd ? '<td style="font-size:0.78rem;font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (m.producto || '').replace(/"/g, '&quot;') + '">' + (m.producto || '—') + '</td>' : '';

    return '<tr' + (m.motivo === 'Saldo_Inicial' ? ' style="background:#f0f9ff"' : '') + '>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.8rem">' + fmtDate(m.fecha) + '</td>' +
      '<td><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;color:white;background:' + (m.tipo === 'Entrada' ? '#e67e22' : '#27ae60') + '">' + (m.tipo === 'Entrada' ? 'Ingreso' : 'Salida') + '</span></td>' +
      '<td><span style="background:' + modColor + ';color:white;padding:2px 9px;border-radius:12px;font-size:0.72rem;font-weight:700">' + modulo + '</span></td>' +
      prodCol +
      '<td style="font-size:0.8rem;font-weight:600;white-space:nowrap">' + (m.remision || '—') + pdfBtn + '</td>' +
      '<td style="font-size:0.78rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + referencia.replace(/"/g, '&quot;') + '">' + (referencia || '—') + '</td>' +
      '<td style="text-align:right">' + entradaStr + '</td>' +
      '<td style="text-align:right">' + salidaStr + '</td>' +
      '<td style="text-align:right;font-weight:800;color:' + saldoColor + '">' + m._saldoKxnc.toLocaleString('es-CO') + '</td>' +
    '</tr>';
  }).join('');
}

function exportKardexNCExcel() {
  if (!kxncFiltered.length) { showToast('No hay datos para exportar. Selecciona una empresa.', '#e74c3c'); return; }

  var fEmp = document.getElementById('kxnc-f-empresa').value;
  var fProd = document.getElementById('kxnc-f-prod').value;

  var data = kxncFiltered.map(function(m, i) {
    var motivoLbl = NC_MOTIVO_LABELS[m.motivo] || m.motivo || '';
    return {
      '#': i + 1,
      'Fecha': m.fecha || '',
      'Tipo': m.tipo === 'Entrada' ? 'Ingreso NC' : 'Salida NC',
      'Módulo': _kxncModulo(m),
      'Motivo': motivoLbl,
      'N° Remisión': m.remision || '',
      'Referencia': m.referencia || '',
      'Producto': m.producto,
      'Presentación': m.presentacion,
      'Entrada': m.tipo === 'Entrada' ? m.cantidad : '',
      'Salida': m.tipo === 'Salida' ? m.cantidad : '',
      'Saldo': m._saldoKxnc
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 18 },
    { wch: 15 }, { wch: 35 }, { wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kardex NC');
  var filename = 'KardexNC_' + getSiglaKx(fEmp) + '_' + (fProd || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) + '_' + today() + '.xlsx';
  XLSX.writeFile(wb, filename);
  showToast('Excel exportado: ' + kxncFiltered.length + ' movimientos');
}

// ══════════════════════════════════════════
// ── EXISTENCIAS NC POR EMPRESA ──
// ══════════════════════════════════════════

var existDataNC = [];
var existFilteredNC = [];
var existNCFiltersAttached = false;

function calcularExistenciasNC() {
  var saldos = {};

  var fechaCorte = null;
  ncMovimientos.forEach(function(m) {
    if (m.motivo === 'Saldo_Inicial' && m.fecha) {
      if (!fechaCorte || m.fecha < fechaCorte) fechaCorte = m.fecha;
    }
  });

  var elCorteHastaNC = document.getElementById('exnc-f-corte');
  var corteHastaNC = elCorteHastaNC ? (elCorteHastaNC.value || '') : '';

  ncMovimientos.forEach(function(m) {
    if (!m.producto || !m.empresa) return;
    if (fechaCorte && m.fecha < fechaCorte) return;
    if (corteHastaNC && m.fecha && m.fecha > corteHastaNC) return;
    var key = m.producto;
    if (!saldos[key]) {
      saldos[key] = { producto: m.producto };
      EMPRESAS_EXIST.forEach(function(e) { saldos[key][e.value] = 0; });
    }
    if (typeof saldos[key][m.empresa] === 'undefined') {
      saldos[key][m.empresa] = 0;
    }
    if (m.tipo === 'Entrada') {
      saldos[key][m.empresa] += m.cantidad;
    } else {
      saldos[key][m.empresa] -= m.cantidad;
    }
  });

  existDataNC = Object.keys(saldos).sort().map(function(k) {
    var row = saldos[k];
    var total = 0;
    EMPRESAS_EXIST.forEach(function(e) { total += (row[e.value] || 0); });
    row._total = total;
    return row;
  });

  var selEmpNC = document.getElementById('exnc-f-empresa');
  var prevEmpNC = selEmpNC.value;
  selEmpNC.innerHTML = '<option value="">— Todas —</option>' +
    EMPRESAS_EXIST.map(function(e) {
      return '<option value="' + e.value + '">' + e.sigla + '</option>';
    }).join('');
  var stillExistsNC = EMPRESAS_EXIST.some(function(e) { return e.value === prevEmpNC; });
  selEmpNC.value = stillExistsNC ? prevEmpNC : '';

  if (!existNCFiltersAttached) {
    document.getElementById('exnc-f-buscar').addEventListener('input', renderExistenciasNC);
    document.getElementById('exnc-f-mostrar').addEventListener('change', renderExistenciasNC);
    document.getElementById('exnc-f-empresa').addEventListener('change', renderExistenciasNC);
    document.getElementById('exnc-f-corte').addEventListener('change', calcularExistenciasNC);
    existNCFiltersAttached = true;
  }

  renderExistenciasNC();
}

function clearExistNCFilters() {
  document.getElementById('exnc-f-buscar').value = '';
  document.getElementById('exnc-f-mostrar').value = 'todos';
  document.getElementById('exnc-f-empresa').value = '';
  document.getElementById('exnc-f-corte').value = '';
  calcularExistenciasNC();
}

function renderExistenciasNC() {
  var buscar = (document.getElementById('exnc-f-buscar').value || '').toLowerCase().trim();
  var mostrar = document.getElementById('exnc-f-mostrar').value;
  var empresaSel = document.getElementById('exnc-f-empresa').value;

  var empresasView = empresaSel
    ? EMPRESAS_EXIST.filter(function(e) { return e.value === empresaSel; })
    : EMPRESAS_EXIST;

  existFilteredNC = existDataNC.filter(function(row) {
    if (buscar && row.producto.toLowerCase().indexOf(buscar) < 0) return false;
    var totalView = 0;
    empresasView.forEach(function(e) { totalView += (row[e.value] || 0); });
    row._totalView = totalView;
    if (mostrar === 'con_stock' && totalView <= 0) return false;
    if (mostrar === 'sin_stock' && totalView !== 0) return false;
    if (mostrar === 'negativo' && totalView >= 0) return false;
    return true;
  });

  var totalUnidades = 0;
  var empresasConStock = {};
  existFilteredNC.forEach(function(row) {
    empresasView.forEach(function(e) {
      var val = row[e.value] || 0;
      if (val > 0) empresasConStock[e.value] = true;
    });
    totalUnidades += row._totalView;
  });

  document.getElementById('exnc-s-productos').textContent = existFilteredNC.length.toLocaleString('es-CO');
  document.getElementById('exnc-s-empresas').textContent = Object.keys(empresasConStock).length;
  document.getElementById('exnc-s-total').textContent = totalUnidades.toLocaleString('es-CO');
  document.getElementById('row-ct-exnc').textContent = '(' + existFilteredNC.length + ' productos)';

  renderExistNCTable(empresasView);
}

function renderExistNCTable(empresasView) {
  empresasView = empresasView || EMPRESAS_EXIST;
  var showTotal = empresasView.length > 1;
  var tbl = document.getElementById('tbl-exnc');
  if (tbl) tbl.classList.toggle('single', empresasView.length === 1);
  var thead = document.getElementById('t-head-exnc');
  var headerCols = '<th style="position:sticky;left:0;background:#f0f4f8;z-index:2">#</th>' +
    '<th style="position:sticky;left:30px;background:#f0f4f8;z-index:2;min-width:220px">Producto</th>';
  empresasView.forEach(function(e) {
    headerCols += '<th style="text-align:right;min-width:90px">' + e.sigla + '</th>';
  });
  if (showTotal) headerCols += '<th style="text-align:right;min-width:90px;background:#fdedec;font-weight:800">TOTAL NC</th>';
  thead.innerHTML = headerCols;

  var tbody = document.getElementById('t-body-exnc');
  if (!existFilteredNC.length) {
    var colSpan = 2 + empresasView.length + (showTotal ? 1 : 0);
    tbody.innerHTML = '<tr><td colspan="' + colSpan + '"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay productos NC con los filtros seleccionados.</div></td></tr>';
    document.getElementById('t-foot-exnc').innerHTML = '';
    return;
  }

  tbody.innerHTML = existFilteredNC.map(function(row, i) {
    var html = '<tr>' +
      '<td style="color:#718096;font-size:0.78rem;position:sticky;left:0;background:white;z-index:1">' + (i + 1) + '</td>' +
      '<td style="font-size:0.82rem;font-weight:600;position:sticky;left:30px;background:white;z-index:1;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + row.producto.replace(/"/g, '&quot;') + '">' + row.producto + '</td>';
    empresasView.forEach(function(e) {
      var val = row[e.value] || 0;
      var color = val > 0 ? '#e67e22' : val < 0 ? '#e74c3c' : '#cbd5e0';
      var weight = val !== 0 ? '700' : '400';
      html += '<td style="text-align:right;font-weight:' + weight + ';color:' + color + ';font-size:0.84rem">' + val.toLocaleString('es-CO') + '</td>';
    });
    if (showTotal) {
      var totalView = row._totalView != null ? row._totalView : row._total;
      var totalColor = totalView > 0 ? '#c0392b' : totalView < 0 ? '#e74c3c' : '#cbd5e0';
      html += '<td style="text-align:right;font-weight:800;color:' + totalColor + ';background:#fdf2f2;font-size:0.88rem">' + totalView.toLocaleString('es-CO') + '</td>';
    }
    html += '</tr>';
    return html;
  }).join('');

  var totales = {};
  empresasView.forEach(function(e) { totales[e.value] = 0; });
  var granTotal = 0;
  existFilteredNC.forEach(function(row) {
    empresasView.forEach(function(e) { totales[e.value] += (row[e.value] || 0); });
    granTotal += (row._totalView != null ? row._totalView : row._total);
  });

  var footHtml = '<td style="position:sticky;left:0;background:#f0f4f8;z-index:1"></td>' +
    '<td style="position:sticky;left:30px;background:#f0f4f8;z-index:1;font-size:0.84rem;font-weight:800;color:#2d3748">TOTALES</td>';
  empresasView.forEach(function(e) {
    var val = totales[e.value];
    var color = val > 0 ? '#e67e22' : val < 0 ? '#e74c3c' : '#718096';
    footHtml += '<td style="text-align:right;font-weight:800;color:' + color + ';font-size:0.88rem">' + val.toLocaleString('es-CO') + '</td>';
  });
  if (showTotal) footHtml += '<td style="text-align:right;font-weight:800;color:#c0392b;background:#fdedec;font-size:0.95rem">' + granTotal.toLocaleString('es-CO') + '</td>';
  document.getElementById('t-foot-exnc').innerHTML = footHtml;
}

function exportExistNCExcel() {
  if (!existFilteredNC.length) { showToast('No hay datos para exportar.', '#e74c3c'); return; }

  var empresaSel = document.getElementById('exnc-f-empresa').value;
  var empresasView = empresaSel
    ? EMPRESAS_EXIST.filter(function(e) { return e.value === empresaSel; })
    : EMPRESAS_EXIST;

  var showTotalNC = empresasView.length > 1;
  var data = existFilteredNC.map(function(row, i) {
    var obj = { '#': i + 1, 'Producto': row.producto };
    empresasView.forEach(function(e) { obj[e.sigla] = row[e.value] || 0; });
    if (showTotalNC) obj['TOTAL NC'] = (row._totalView != null ? row._totalView : row._total);
    return obj;
  });

  var corteExNC = (document.getElementById('exnc-f-corte') || {}).value || '';
  var empresaLabelNC = empresaSel
    ? ((empresasView[0] && empresasView[0].sigla ? empresasView[0].sigla + ' — ' : '') + empresaSel)
    : 'Todas las empresas';
  var corteLabelNC = corteExNC || today();
  var totalColsNC = 2 + empresasView.length + (showTotalNC ? 1 : 0);

  var ws = XLSX.utils.aoa_to_sheet([
    ['Existencias de Producto No Conforme por Empresa'],
    ['Empresa: ' + empresaLabelNC + '   ·   Fecha de corte: ' + corteLabelNC],
    []
  ]);
  XLSX.utils.sheet_add_json(ws, data, { origin: 'A4' });
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalColsNC - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalColsNC - 1 } }
  ];
  var colWidths = [{ wch: 5 }, { wch: 35 }];
  empresasView.forEach(function() { colWidths.push({ wch: 12 }); });
  if (showTotalNC) colWidths.push({ wch: 12 });
  ws['!cols'] = colWidths;
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Existencias NC');
  var fnameExNC = corteExNC
    ? ('Existencias_NC_por_Empresa_corte_' + corteExNC + '.xlsx')
    : ('Existencias_NC_por_Empresa_' + today() + '.xlsx');
  XLSX.writeFile(wb, fnameExNC);
  showToast('Excel exportado: ' + existFilteredNC.length + ' productos');
}

// ══════════════════════════════════════════
// ── COMPARATIVO BUENO vs NC POR EMPRESA ──
// ══════════════════════════════════════════

var compFiltersAttached = false;
var compData = [];
var compFiltered = [];

function calcularComparativo() {
  var elCorte = document.getElementById('comp-f-corte');
  var corteHasta = elCorte ? (elCorte.value || '') : '';

  var fechaCorteBueno = null;
  kxMovimientos.forEach(function(m) {
    if (m.modulo === 'Saldo Inicial' && m.fecha) {
      if (!fechaCorteBueno || m.fecha < fechaCorteBueno) fechaCorteBueno = m.fecha;
    }
  });
  var fechaCorteNC = null;
  ncMovimientos.forEach(function(m) {
    if (m.motivo === 'Saldo_Inicial' && m.fecha) {
      if (!fechaCorteNC || m.fecha < fechaCorteNC) fechaCorteNC = m.fecha;
    }
  });

  var mapa = {};
  function ensureRow(prod) {
    if (!mapa[prod]) {
      mapa[prod] = { producto: prod, bueno: {}, nc: {} };
      EMPRESAS_EXIST.forEach(function(e) {
        mapa[prod].bueno[e.value] = 0;
        mapa[prod].nc[e.value] = 0;
      });
    }
    return mapa[prod];
  }

  kxMovimientos.forEach(function(m) {
    if (!m.producto || !m.empresa) return;
    if (fechaCorteBueno && m.fecha < fechaCorteBueno) return;
    if (corteHasta && m.fecha && m.fecha > corteHasta) return;
    var r = ensureRow(m.producto);
    if (typeof r.bueno[m.empresa] === 'undefined') r.bueno[m.empresa] = 0;
    if (m.tipo === 'Entrada') r.bueno[m.empresa] += m.cantidad;
    else r.bueno[m.empresa] -= m.cantidad;
  });

  ncMovimientos.forEach(function(m) {
    if (!m.producto || !m.empresa) return;
    if (fechaCorteNC && m.fecha < fechaCorteNC) return;
    if (corteHasta && m.fecha && m.fecha > corteHasta) return;
    var r = ensureRow(m.producto);
    if (typeof r.nc[m.empresa] === 'undefined') r.nc[m.empresa] = 0;
    if (m.tipo === 'Entrada') r.nc[m.empresa] += m.cantidad;
    else r.nc[m.empresa] -= m.cantidad;
  });

  compData = Object.keys(mapa).sort().map(function(k) {
    var r = mapa[k];
    var totalB = 0, totalNC = 0;
    EMPRESAS_EXIST.forEach(function(e) {
      totalB += (r.bueno[e.value] || 0);
      totalNC += (r.nc[e.value] || 0);
    });
    r._totalBueno = totalB;
    r._totalNC = totalNC;
    return r;
  });

  var selEmp = document.getElementById('comp-f-empresa');
  var prev = selEmp.value;
  selEmp.innerHTML = '<option value="">— Todas —</option>' +
    EMPRESAS_EXIST.map(function(e) {
      return '<option value="' + e.value + '">' + e.sigla + '</option>';
    }).join('');
  var stillExists = EMPRESAS_EXIST.some(function(e) { return e.value === prev; });
  selEmp.value = stillExists ? prev : '';

  if (!compFiltersAttached) {
    document.getElementById('comp-f-buscar').addEventListener('input', renderComparativo);
    document.getElementById('comp-f-mostrar').addEventListener('change', renderComparativo);
    document.getElementById('comp-f-empresa').addEventListener('change', renderComparativo);
    document.getElementById('comp-f-corte').addEventListener('change', calcularComparativo);
    compFiltersAttached = true;
  }

  renderComparativo();
}

function clearCompFilters() {
  document.getElementById('comp-f-buscar').value = '';
  document.getElementById('comp-f-mostrar').value = 'todos';
  document.getElementById('comp-f-empresa').value = '';
  document.getElementById('comp-f-corte').value = '';
  calcularComparativo();
}

function renderComparativo() {
  var buscar = (document.getElementById('comp-f-buscar').value || '').toLowerCase().trim();
  var mostrar = document.getElementById('comp-f-mostrar').value;
  var empresaSel = document.getElementById('comp-f-empresa').value;

  var empresasView = empresaSel
    ? EMPRESAS_EXIST.filter(function(e) { return e.value === empresaSel; })
    : EMPRESAS_EXIST;

  compFiltered = compData.filter(function(row) {
    if (buscar && row.producto.toLowerCase().indexOf(buscar) < 0) return false;
    var tB = 0, tN = 0;
    empresasView.forEach(function(e) {
      tB += (row.bueno[e.value] || 0);
      tN += (row.nc[e.value] || 0);
    });
    row._totalBuenoView = tB;
    row._totalNCView = tN;
    if (mostrar === 'con_stock' && (tB + tN) <= 0) return false;
    if (mostrar === 'con_nc' && tN <= 0) return false;
    if (mostrar === 'nc_mayor' && !(tN > 0 && tN >= tB)) return false;
    return true;
  });

  var sumB = 0, sumN = 0;
  compFiltered.forEach(function(row) {
    sumB += row._totalBuenoView;
    sumN += row._totalNCView;
  });

  document.getElementById('comp-s-productos').textContent = compFiltered.length.toLocaleString('es-CO');
  document.getElementById('comp-s-bueno').textContent = sumB.toLocaleString('es-CO');
  document.getElementById('comp-s-nc').textContent = sumN.toLocaleString('es-CO');
  document.getElementById('comp-s-diff').textContent = (sumB - sumN).toLocaleString('es-CO');
  document.getElementById('row-ct-comp').textContent = '(' + compFiltered.length + ' productos)';

  renderCompTable(empresasView);
}

function renderCompTable(empresasView) {
  empresasView = empresasView || EMPRESAS_EXIST;
  var thead = document.getElementById('t-head-comp');

  var row1 = '<tr>' +
    '<th rowspan="2" style="position:sticky;left:0;background:#f0f4f8;z-index:3;vertical-align:middle">#</th>' +
    '<th rowspan="2" style="position:sticky;left:30px;background:#f0f4f8;z-index:3;min-width:220px;vertical-align:middle">Producto</th>';
  empresasView.forEach(function(e) {
    row1 += '<th colspan="2" style="text-align:center;background:#edf2f7;border-left:2px solid #cbd5e0">' + e.sigla + '</th>';
  });
  row1 += '<th colspan="2" style="text-align:center;background:#e8f5e9;border-left:2px solid #cbd5e0">TOTAL</th>';
  row1 += '</tr>';

  var row2 = '<tr>';
  empresasView.forEach(function() {
    row2 += '<th style="text-align:right;min-width:80px;color:#27ae60;font-size:0.72rem;background:#f0faf7;border-left:2px solid #cbd5e0">Bueno</th>';
    row2 += '<th style="text-align:right;min-width:80px;color:#c0392b;font-size:0.72rem;background:#fdedec">NC</th>';
  });
  row2 += '<th style="text-align:right;min-width:80px;color:#27ae60;font-size:0.72rem;background:#f0faf7;border-left:2px solid #cbd5e0">Bueno</th>';
  row2 += '<th style="text-align:right;min-width:80px;color:#c0392b;font-size:0.72rem;background:#fdedec">NC</th>';
  row2 += '</tr>';

  thead.innerHTML = row1 + row2;

  var tbody = document.getElementById('t-body-comp');
  var totalDataCols = empresasView.length * 2 + 2;
  var colSpan = 2 + totalDataCols;
  if (!compFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="' + colSpan + '"><div class="empty-msg" style="text-align:center;padding:32px;color:#718096">No hay productos con los filtros seleccionados.</div></td></tr>';
    document.getElementById('t-foot-comp').innerHTML = '';
    return;
  }

  tbody.innerHTML = compFiltered.map(function(row, i) {
    var html = '<tr>' +
      '<td style="color:#718096;font-size:0.78rem;position:sticky;left:0;background:white;z-index:1">' + (i + 1) + '</td>' +
      '<td style="font-size:0.82rem;font-weight:600;position:sticky;left:30px;background:white;z-index:1;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + row.producto.replace(/"/g, '&quot;') + '">' + row.producto + '</td>';
    empresasView.forEach(function(e) {
      var b = row.bueno[e.value] || 0;
      var n = row.nc[e.value] || 0;
      var bColor = b > 0 ? '#27ae60' : b < 0 ? '#e74c3c' : '#cbd5e0';
      var nColor = n > 0 ? '#c0392b' : n < 0 ? '#e74c3c' : '#cbd5e0';
      html += '<td style="text-align:right;font-weight:' + (b !== 0 ? '700' : '400') + ';color:' + bColor + ';font-size:0.84rem;border-left:2px solid #edf2f7">' + b.toLocaleString('es-CO') + '</td>';
      html += '<td style="text-align:right;font-weight:' + (n !== 0 ? '700' : '400') + ';color:' + nColor + ';font-size:0.84rem">' + n.toLocaleString('es-CO') + '</td>';
    });
    var tB = row._totalBuenoView;
    var tN = row._totalNCView;
    var tBColor = tB > 0 ? '#0e6655' : tB < 0 ? '#e74c3c' : '#cbd5e0';
    var tNColor = tN > 0 ? '#c0392b' : tN < 0 ? '#e74c3c' : '#cbd5e0';
    html += '<td style="text-align:right;font-weight:800;color:' + tBColor + ';background:#e8f5e9;font-size:0.88rem;border-left:2px solid #cbd5e0">' + tB.toLocaleString('es-CO') + '</td>';
    html += '<td style="text-align:right;font-weight:800;color:' + tNColor + ';background:#fdedec;font-size:0.88rem">' + tN.toLocaleString('es-CO') + '</td>';
    html += '</tr>';
    return html;
  }).join('');

  var totB = {}, totN = {};
  empresasView.forEach(function(e) { totB[e.value] = 0; totN[e.value] = 0; });
  var granB = 0, granN = 0;
  compFiltered.forEach(function(row) {
    empresasView.forEach(function(e) {
      totB[e.value] += (row.bueno[e.value] || 0);
      totN[e.value] += (row.nc[e.value] || 0);
    });
    granB += row._totalBuenoView;
    granN += row._totalNCView;
  });

  var footHtml = '<tr>' +
    '<td style="position:sticky;left:0;background:#f0f4f8;z-index:1"></td>' +
    '<td style="position:sticky;left:30px;background:#f0f4f8;z-index:1;font-size:0.84rem;font-weight:800;color:#2d3748">TOTALES</td>';
  empresasView.forEach(function(e) {
    var vB = totB[e.value];
    var vN = totN[e.value];
    footHtml += '<td style="text-align:right;font-weight:800;color:' + (vB > 0 ? '#27ae60' : vB < 0 ? '#e74c3c' : '#718096') + ';font-size:0.88rem;border-left:2px solid #cbd5e0">' + vB.toLocaleString('es-CO') + '</td>';
    footHtml += '<td style="text-align:right;font-weight:800;color:' + (vN > 0 ? '#c0392b' : vN < 0 ? '#e74c3c' : '#718096') + ';font-size:0.88rem">' + vN.toLocaleString('es-CO') + '</td>';
  });
  footHtml += '<td style="text-align:right;font-weight:800;color:#0e6655;background:#e8f5e9;font-size:0.95rem;border-left:2px solid #cbd5e0">' + granB.toLocaleString('es-CO') + '</td>';
  footHtml += '<td style="text-align:right;font-weight:800;color:#c0392b;background:#fdedec;font-size:0.95rem">' + granN.toLocaleString('es-CO') + '</td>';
  footHtml += '</tr>';
  document.getElementById('t-foot-comp').innerHTML = footHtml;
}

function exportCompExcel() {
  if (!compFiltered.length) { showToast('No hay datos para exportar.', '#e74c3c'); return; }

  var empresaSel = document.getElementById('comp-f-empresa').value;
  var empresasView = empresaSel
    ? EMPRESAS_EXIST.filter(function(e) { return e.value === empresaSel; })
    : EMPRESAS_EXIST;
  var corte = (document.getElementById('comp-f-corte') || {}).value || '';
  var empresaLabel = empresaSel
    ? ((empresasView[0] && empresasView[0].sigla ? empresasView[0].sigla + ' — ' : '') + empresaSel)
    : 'Todas las empresas';
  var corteLabel = corte || today();

  var headerRow1 = ['#', 'Producto'];
  empresasView.forEach(function(e) { headerRow1.push(e.sigla); headerRow1.push(''); });
  headerRow1.push('TOTAL'); headerRow1.push('');
  var headerRow2 = ['', ''];
  empresasView.forEach(function() { headerRow2.push('Bueno'); headerRow2.push('NC'); });
  headerRow2.push('Bueno'); headerRow2.push('NC');

  var totalCols = 2 + empresasView.length * 2 + 2;

  var aoa = [
    ['Comparativo Bueno vs No Conforme por Empresa'],
    ['Empresa: ' + empresaLabel + '   ·   Fecha de corte: ' + corteLabel],
    [],
    headerRow1,
    headerRow2
  ];
  compFiltered.forEach(function(row, i) {
    var r = [i + 1, row.producto];
    empresasView.forEach(function(e) {
      r.push(row.bueno[e.value] || 0);
      r.push(row.nc[e.value] || 0);
    });
    r.push(row._totalBuenoView);
    r.push(row._totalNCView);
    aoa.push(r);
  });

  var totFootB = {}, totFootN = {}, granB = 0, granN = 0;
  empresasView.forEach(function(e) { totFootB[e.value] = 0; totFootN[e.value] = 0; });
  compFiltered.forEach(function(row) {
    empresasView.forEach(function(e) {
      totFootB[e.value] += (row.bueno[e.value] || 0);
      totFootN[e.value] += (row.nc[e.value] || 0);
    });
    granB += row._totalBuenoView;
    granN += row._totalNCView;
  });
  var footRow = ['', 'TOTALES'];
  empresasView.forEach(function(e) { footRow.push(totFootB[e.value]); footRow.push(totFootN[e.value]); });
  footRow.push(granB); footRow.push(granN);
  aoa.push(footRow);

  var ws = XLSX.utils.aoa_to_sheet(aoa);
  var merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
    { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } }
  ];
  for (var i = 0; i < empresasView.length; i++) {
    var startC = 2 + i * 2;
    merges.push({ s: { r: 3, c: startC }, e: { r: 3, c: startC + 1 } });
  }
  merges.push({ s: { r: 3, c: 2 + empresasView.length * 2 }, e: { r: 3, c: 2 + empresasView.length * 2 + 1 } });
  ws['!merges'] = merges;

  var colWidths = [{ wch: 5 }, { wch: 35 }];
  empresasView.forEach(function() { colWidths.push({ wch: 11 }); colWidths.push({ wch: 11 }); });
  colWidths.push({ wch: 12 }); colWidths.push({ wch: 12 });
  ws['!cols'] = colWidths;

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comparativo B vs NC');
  var fname = corte
    ? ('Comparativo_Bueno_vs_NC_corte_' + corte + '.xlsx')
    : ('Comparativo_Bueno_vs_NC_' + today() + '.xlsx');
  XLSX.writeFile(wb, fname);
  showToast('Excel exportado: ' + compFiltered.length + ' productos');
}

// ══════════════════════════════════════════
// ── EXPORTAR PDF REMISIÓN DESDE KARDEX ──
// ══════════════════════════════════════════

function exportarRemisionKardexPDF(idx, source) {
  var movimientos = source === 'nc' ? ncFiltered : source === 'kxnc' ? kxncFiltered : kxFiltered;
  var allMovimientos = source === 'nc' ? ncMovimientos : source === 'kxnc' ? ncMovimientos : kxMovimientos;
  var m = movimientos[idx];
  if (!m || !m.remision) { showToast('Este movimiento no tiene remisión', '#e74c3c'); return; }

  if (typeof generarRemisionPDF !== 'function') {
    showToast('Módulo PDF no cargado. Recarga la página.', '#e74c3c');
    return;
  }

  var related = allMovimientos.filter(function(mv) {
    return mv.remision === m.remision && mv.empresa === m.empresa && mv.tipo === m.tipo;
  });

  var prodMap = {};
  related.forEach(function(mv) {
    var key = mv.producto + '||' + (mv.presentacion || '');
    if (!prodMap[key]) {
      prodMap[key] = { producto: mv.producto, presentacion: mv.presentacion || '', cantidad: 0 };
    }
    prodMap[key].cantidad += mv.cantidad;
  });
  var entregas = Object.keys(prodMap).map(function(key) { return prodMap[key]; });

  var tipoLabel = m.tipo === 'Entrada' ? 'ENTRADA' : 'SALIDA';
  var moduloLabel;
  if (source === 'nc' || source === 'kxnc') {
    moduloLabel = NC_MOTIVO_LABELS[m.motivo] || m.motivo || '';
  } else {
    moduloLabel = m.modulo || '';
  }

  generarRemisionPDF({
    empresa: m.empresa,
    consecutivo: '',
    remision: m.remision,
    fecha_entrega: fmtDate(m.fecha),
    doc_title: 'REMISION',
    doc_number: m.remision,
    date_label: 'Fecha',
    ref_label: null,
    file_prefix: 'Remision_Kardex',
    copies: ['ORIGINAL - LOGISTICA', 'COPIA - CONTABILIDAD'],
    last_col_header: 'Observaciones',
    entregas: entregas,
    left_fields: [
      ['Tipo', tipoLabel],
      ['Modulo', moduloLabel],
      ['Referencia', m.referencia || ''],
    ],
    right_fields: [
      ['Fecha', fmtDate(m.fecha)],
      ['N° Remision', m.remision],
      ['Productos', entregas.length + ' linea(s)'],
    ]
  });

  showToast('PDF de remision ' + m.remision + ' generado');
}

// ── Auto-load ──
loadKardex();
