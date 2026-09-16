// ══════════════════════════════════════════════════════════════
// Bodegas en Consignación
//
// Vista de solo lectura sobre Pedidos. Incluye filas cuyo campo
// Consignacion = 'Si'/'Sí', MÁS cuatro excepciones pedidas a mano
// (esos pedidos tienen Consignacion = 'No' en el dato, pero son
// bodegas en consignación reales que no quedaron marcadas así):
//   - IASO, cliente "Bodega COATOL" (cualquier variante de mayúsculas).
//   - PARCELAR, Bodega_Facturacion = 'Bodega Villeta'.
//   - PARCELAR, Bodega_Facturacion = 'Bodega Didimo Cubillos'.
//   - PARCELAR, cliente "Carlos Andres Ramirez" (varias variantes de
//     nombre en el dato — "CARLOS RAMIREZ" / "carlos andres ramirez
//     bonilla" — mismo NIT 80282454; se matchea por nombre).
// Ver _bcCalifica().
//
// La "bodega" normalmente es el campo Sucursal del pedido (el sitio
// del cliente donde queda la mercancía) — no existe una tabla propia
// de bodegas, así que se deriva de los datos ya cargados. Para
// Bodega Villeta / Bodega Didimo Cubillos la bodega real es
// Bodega_Facturacion, no Sucursal (que ahí es solo la ubicación del
// cliente que compró). Para COATOL y Carlos Ramirez, Sucursal y
// Bodega_Facturacion vienen vacíos o genéricos ("Bodega Principal",
// el mismo que usa cualquier pedido normal) — ahí la bodega es el
// propio cliente. Ver _bcBodegaKey().
//
// "Cant. ingresada" = Cant_Entregada: solo lo que ya se despachó
// físicamente hacia esa bodega cuenta como ingreso a su inventario;
// lo pedido pero aún pendiente de despacho no suma todavía.
// ══════════════════════════════════════════════════════════════

var bcRows = [];       // líneas de Pedidos que califican (ver _bcCalifica)
var bcFiltered = [];
var bcTab = 'listado';
var bcFiltersAttached = false;
var _fmtNum = new Intl.NumberFormat('es-CO');
var BC_SIN_BODEGA = '__SIN_BODEGA__';
var BC_BODEGAS_FACTURACION_PARCELAR = ['Bodega Villeta', 'Bodega Didimo Cubillos'];

function _bcEsConsignacion(v) {
  var s = (v || '').trim();
  return s === 'Si' || s === 'Sí';
}

function _bcClienteContiene(cliente, palabras) {
  var c = (cliente || '').toUpperCase();
  return palabras.every(function(p) { return c.indexOf(p) >= 0; });
}
function _bcEsClienteCoatol(cliente) { return _bcClienteContiene(cliente, ['COATOL']); }
function _bcEsClienteCarlosRamirez(cliente) { return _bcClienteContiene(cliente, ['CARLOS', 'RAMIREZ']); }

// Pedidos con Consignacion='Sí', más las 4 excepciones pedidas a mano
// (empresa + cliente/bodega de facturación puntuales) aunque digan 'No'.
function _bcCalifica(p) {
  if (_bcEsConsignacion(p.Consignacion)) return true;
  var sigla = getSigla(p.Nombre_Empresa);
  if (sigla === 'IASO' && _bcEsClienteCoatol(p.Cliente)) return true;
  if (sigla === 'PARCELAR' && _bcEsClienteCarlosRamirez(p.Cliente)) return true;
  if (sigla === 'PARCELAR' && BC_BODEGAS_FACTURACION_PARCELAR.indexOf((p.Bodega_Facturacion || '').trim()) >= 0) return true;
  return false;
}

function _bcBodegaKey(r) {
  var sigla = getSigla(r.Nombre_Empresa);
  if (sigla === 'PARCELAR') {
    if (_bcEsClienteCarlosRamirez(r.Cliente)) return 'Carlos Ramirez';
    var bf = (r.Bodega_Facturacion || '').trim();
    if (BC_BODEGAS_FACTURACION_PARCELAR.indexOf(bf) >= 0) return bf;
  }
  if (sigla === 'IASO' && _bcEsClienteCoatol(r.Cliente)) return 'Bodega COATOL';
  return (r.Sucursal || '').trim() || BC_SIN_BODEGA;
}
function _bcBodegaLabel(key) { return key === BC_SIN_BODEGA ? '(Sin bodega)' : key; }

function bcGoto(el) {
  var href = el && el.getAttribute('data-href');
  if (href) location.href = href;
}

// ── Carga ──────────────────────────────────────────────────────
async function loadBodegasConsignacion() {
  var lz = document.getElementById('load-zone');
  var main = document.getElementById('main');
  var yaCargado = main.style.display === 'block';
  if (yaCargado) {
    if (typeof setSyncStatus === 'function') setSyncStatus('syncing', 'Actualizando datos...');
  } else {
    lz.style.display = '';
    document.getElementById('load-spinner').style.display = 'inline-block';
    document.getElementById('load-error').textContent = '';
    document.getElementById('btn-retry').style.display = 'none';
  }
  try {
    if (typeof _authReady !== 'undefined') { try { await _authReady; } catch (e) {} }

    var res = await apiGet('getPedidos', {
      columns: 'Nombre_Empresa,Consecutivo,Cliente,Sucursal,Bodega_Facturacion,Fecha_Pedido,Producto,Presentacion,Cantidad,Cant_Entregada,Estado_Entrega,Estado_2,Consignacion'
    });
    if (!res.ok) throw new Error(res.error || 'No se pudo cargar Pedidos');

    bcRows = (res.pedidos || []).filter(_bcCalifica);

    populateEmpresaSelect('bc-f-empresa', 'Todas');
    bcPopulateBodegaFilter();

    if (!bcFiltersAttached) {
      document.getElementById('bc-f-empresa').addEventListener('change', function() {
        bcPopulateBodegaFilter();
        bcRender();
      });
      document.getElementById('bc-f-bodega').addEventListener('change', bcRender);
      bcFiltersAttached = true;
    }

    lz.style.display = 'none';
    main.style.display = 'block';
    bcRender();
    if (typeof setSyncStatus === 'function') setSyncStatus('ok', 'Conectado a la nube.');
  } catch (err) {
    document.getElementById('load-error').textContent = (err && err.message) || String(err);
    document.getElementById('btn-retry').style.display = '';
    if (typeof setSyncStatus === 'function') setSyncStatus('error', 'Error al conectar');
  }
}

// ── Filtros ────────────────────────────────────────────────────
function bcPopulateBodegaFilter() {
  var empSel = document.getElementById('bc-f-empresa').value;
  var sel = document.getElementById('bc-f-bodega');
  var prev = sel.value;
  var bodegas = {};
  bcRows.forEach(function(r) {
    if (empSel && r.Nombre_Empresa !== empSel) return;
    bodegas[_bcBodegaKey(r)] = true;
  });
  var sorted = Object.keys(bodegas).sort(function(a, b) {
    if (a === BC_SIN_BODEGA) return 1;
    if (b === BC_SIN_BODEGA) return -1;
    return a.localeCompare(b, 'es');
  });
  sel.innerHTML = '<option value="">Todas</option>' + sorted.map(function(b) {
    return '<option value="' + escHtml(b) + '">' + escHtml(_bcBodegaLabel(b)) + '</option>';
  }).join('');
  sel.value = sorted.indexOf(prev) >= 0 ? prev : '';
}

function bcClearFilters() {
  document.getElementById('bc-f-empresa').value = '';
  bcPopulateBodegaFilter();
  document.getElementById('bc-f-bodega').value = '';
  bcRender();
}

function bcSwitchTab(tab) {
  bcTab = tab;
  ['listado', 'resumen'].forEach(function(t) {
    var panel = document.getElementById('bc-panel-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    var btn = document.getElementById('bc-tab-' + t);
    if (btn) btn.style.background = (t === tab) ? '#1a5276' : '#718096';
  });
}

// ── Render ─────────────────────────────────────────────────────
function bcRender() {
  var empSel = document.getElementById('bc-f-empresa').value;
  var bodSel = document.getElementById('bc-f-bodega').value;

  bcFiltered = bcRows.filter(function(r) {
    if (empSel && r.Nombre_Empresa !== empSel) return false;
    if (bodSel && _bcBodegaKey(r) !== bodSel) return false;
    return true;
  });

  var bodegasSet = {}, pedidosSet = {}, totalUds = 0, sinBodega = 0;
  bcFiltered.forEach(function(r) {
    var bKey = _bcBodegaKey(r);
    bodegasSet[r.Nombre_Empresa + '||' + bKey] = true;
    pedidosSet[r.Nombre_Empresa + '||' + r.Consecutivo + '||' + r.Cliente] = true;
    totalUds += Number(r.Cant_Entregada) || 0;
    if (bKey === BC_SIN_BODEGA) sinBodega++;
  });
  document.getElementById('bc-s-bodegas').textContent = Object.keys(bodegasSet).length;
  document.getElementById('bc-s-pedidos').textContent = Object.keys(pedidosSet).length;
  document.getElementById('bc-s-uds').textContent = _fmtNum.format(totalUds);

  var notaEl = document.getElementById('bc-nota');
  if (sinBodega > 0) {
    notaEl.textContent = '⚠️ ' + sinBodega + ' línea(s) en consignación sin Sucursal (bodega) asignada — revisar en Pedidos.';
    notaEl.style.display = 'block';
  } else {
    notaEl.style.display = 'none';
  }

  bcRenderListado();
  bcRenderResumen();
}

function bcRenderListado() {
  var tbody = document.getElementById('bc-body-listado');
  document.getElementById('bc-row-ct-listado').textContent = '(' + bcFiltered.length + ' línea(s))';

  if (!bcFiltered.length) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty">No hay pedidos en consignación con los filtros seleccionados.</div></td></tr>';
    return;
  }

  var rows = [].concat(bcFiltered).sort(function(a, b) {
    return String(b.Fecha_Pedido || '').localeCompare(String(a.Fecha_Pedido || ''));
  });

  tbody.innerHTML = rows.map(function(r) {
    return '<tr data-href="pedidos.html?buscar=' + encodeURIComponent(r.Consecutivo || '') + '" onclick="bcGoto(this)" style="cursor:pointer">' +
      '<td><span class="sigla-badge ' + getSiglaClass(r.Nombre_Empresa) + '">' + escHtml(getSigla(r.Nombre_Empresa)) + '</span></td>' +
      '<td>' + escHtml(_bcBodegaLabel(_bcBodegaKey(r))) + '</td>' +
      '<td>' + escHtml(r.Cliente || '—') + '</td>' +
      '<td style="font-weight:700;text-align:center">' + escHtml(r.Consecutivo || '') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha_Pedido) + '</td>' +
      '<td>' + escHtml(r.Producto || '') + '</td>' +
      '<td>' + escHtml(r.Presentacion || '') + '</td>' +
      '<td class="money">' + _fmtNum.format(Number(r.Cantidad) || 0) + '</td>' +
      '<td class="money" style="font-weight:700;color:#27ae60">' + _fmtNum.format(Number(r.Cant_Entregada) || 0) + '</td>' +
      '<td>' + escHtml(r.Estado_Entrega || '') + '</td>' +
      '<td>' + escHtml(r.Estado_2 || '') + '</td>' +
    '</tr>';
  }).join('');
}

function bcRenderResumen() {
  var groups = {}; // empresa||bodega||producto||presentacion
  bcFiltered.forEach(function(r) {
    var bKey = _bcBodegaKey(r);
    var gKey = r.Nombre_Empresa + '||' + bKey + '||' + (r.Producto || '') + '||' + (r.Presentacion || '');
    if (!groups[gKey]) {
      groups[gKey] = { empresa: r.Nombre_Empresa, bodegaKey: bKey, producto: r.Producto || '', presentacion: r.Presentacion || '', cant: 0, pedidos: {} };
    }
    groups[gKey].cant += Number(r.Cant_Entregada) || 0;
    groups[gKey].pedidos[r.Nombre_Empresa + '||' + r.Consecutivo + '||' + r.Cliente] = true;
  });

  var arr = Object.values(groups);
  arr.sort(function(a, b) {
    return (getSigla(a.empresa) + '|' + a.bodegaKey + '|' + a.producto).localeCompare(getSigla(b.empresa) + '|' + b.bodegaKey + '|' + b.producto, 'es');
  });

  var bodSubtot = {}; // empresa||bodega -> { cant, pedidos:{} }
  arr.forEach(function(g) {
    var k = g.empresa + '||' + g.bodegaKey;
    if (!bodSubtot[k]) bodSubtot[k] = { cant: 0, pedidos: {} };
    bodSubtot[k].cant += g.cant;
    Object.keys(g.pedidos).forEach(function(p) { bodSubtot[k].pedidos[p] = true; });
  });

  var tbody = document.getElementById('bc-body-resumen');
  document.getElementById('bc-row-ct-resumen').textContent = '(' + arr.length + ' producto(s) × bodega)';

  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty">No hay datos con los filtros seleccionados.</div></td></tr>';
    document.getElementById('bc-foot-resumen').innerHTML = '';
    return;
  }

  var html = '';
  var grandTotal = 0;
  arr.forEach(function(g, i) {
    var k = g.empresa + '||' + g.bodegaKey;
    html += '<tr>' +
      '<td><span class="sigla-badge ' + getSiglaClass(g.empresa) + '">' + escHtml(getSigla(g.empresa)) + '</span></td>' +
      '<td>' + escHtml(_bcBodegaLabel(g.bodegaKey)) + '</td>' +
      '<td>' + escHtml(g.producto) + '</td>' +
      '<td>' + escHtml(g.presentacion) + '</td>' +
      '<td class="money">' + Object.keys(g.pedidos).length + '</td>' +
      '<td class="money" style="font-weight:700;color:#27ae60">' + _fmtNum.format(g.cant) + '</td>' +
    '</tr>';
    grandTotal += g.cant;

    var next = arr[i + 1];
    var nextKey = next ? (next.empresa + '||' + next.bodegaKey) : null;
    if (nextKey !== k) {
      var st = bodSubtot[k];
      html += '<tr style="background:#f7fafc;font-weight:700">' +
        '<td colspan="4" style="text-align:right">Subtotal ' + escHtml(getSigla(g.empresa)) + ' · ' + escHtml(_bcBodegaLabel(g.bodegaKey)) + '</td>' +
        '<td class="money">' + Object.keys(st.pedidos).length + '</td>' +
        '<td class="money">' + _fmtNum.format(st.cant) + '</td>' +
      '</tr>';
    }
  });

  tbody.innerHTML = html;
  document.getElementById('bc-foot-resumen').innerHTML =
    '<td colspan="4" style="text-align:right">Total</td><td></td><td class="money">' + _fmtNum.format(grandTotal) + '</td>';
}

// ── Init ───────────────────────────────────────────────────────
if (typeof document !== 'undefined' && document.getElementById('load-zone') && !window.__BC_TEST) {
  loadBodegasConsignacion();
}
