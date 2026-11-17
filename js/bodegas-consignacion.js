// ══════════════════════════════════════════════════════════════
// Bodegas en Consignación
//
// Vista de solo lectura sobre Pedidos. Incluye filas cuyo campo
// Consignacion = 'Si'/'Sí', MÁS excepciones pedidas a mano (esos
// pedidos tienen Consignacion = 'No' en el dato, pero son bodegas
// en consignación reales que no quedaron marcadas así):
//   - IASO, cualquier cliente cuyo nombre empiece con "Bodega "
//     (cubre COATOL, Espinal, y cualquier "Bodega X" que aparezca
//     después — mismo criterio, sin tener que agregar cada una a mano).
//   - PARCELAR, Bodega_Facturacion = 'Bodega Villeta'.
//   - PARCELAR, Bodega_Facturacion = 'Bodega Didimo Cubillos'.
//   - PARCELAR, Bodega_Facturacion = 'Bodega Boyaca' (los traslados a
//     "Bodega BOYACA - ..." del catálogo se agrupan en el mismo cubo).
//   - PARCELAR, cliente "Carlos Andres Ramirez" (varias variantes de
//     nombre en el dato — "CARLOS RAMIREZ" / "carlos andres ramirez
//     bonilla" — mismo NIT 80282454; se matchea por nombre).
// Ver _bcCalifica().
//
// La "bodega" normalmente es el campo Sucursal del pedido (el sitio
// del cliente donde queda la mercancía) — no existe una tabla propia
// de bodegas, así que se deriva de los datos ya cargados. Para
// Bodega Villeta / Bodega Didimo Cubillos / Bodega Boyaca la bodega real es
// Bodega_Facturacion, no Sucursal (que ahí es solo la ubicación del
// cliente que compró). Para los clientes "Bodega X" de IASO y para
// Carlos Ramirez, Sucursal y Bodega_Facturacion vienen vacíos o
// genéricos ("Bodega Principal", el mismo que usa cualquier pedido
// normal) — ahí la bodega es el propio cliente, PERO con dos casos ya
// verificados que se funden con un cubo que ya existía por Sucursal:
// "Bodega Espinal"/"BODEGA ESPINAL" (con o sin Sucursal=ESPINAL) cae
// en el mismo cubo "ESPINAL" que ya alimentan otros clientes (ej.
// AGROEXPORT) que sí traen Sucursal=ESPINAL. "Bodega COATOL" no tenía
// ningún cubo previo, así que queda como "Bodega COATOL". Cualquier
// "Bodega X" nueva que no sea ninguna de las dos cae por defecto en
// "Bodega " + el nombre, igual que COATOL. Ver _bcBodegaKey().
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
var BC_BODEGAS_FACTURACION_PARCELAR = ['Bodega Villeta', 'Bodega Didimo Cubillos', 'Bodega Boyaca'];

function _bcEsConsignacion(v) {
  var s = (v || '').trim();
  return s === 'Si' || s === 'Sí';
}

function _bcClienteContiene(cliente, palabras) {
  var c = (cliente || '').toUpperCase();
  return palabras.every(function(p) { return c.indexOf(p) >= 0; });
}
function _bcEsClienteCarlosRamirez(cliente) { return _bcClienteContiene(cliente, ['CARLOS', 'RAMIREZ']); }

// Cliente cuyo nombre empieza con "Bodega " (ej. "Bodega COATOL",
// "BODEGA ESPINAL", "Bodega Espinal") — el patrón que usa IASO para
// registrar clientes que en realidad son bodegas en consignación.
function _bcEsClienteBodegaIaso(cliente) {
  return /^BODEGA\s+\S/.test((cliente || '').trim().toUpperCase());
}

// Pedidos con Consignacion='Sí', más las excepciones pedidas a mano
// (empresa + cliente/bodega de facturación puntuales) aunque digan 'No'.
function _bcCalifica(p) {
  if (_bcEsConsignacion(p.Consignacion)) return true;
  var sigla = getSigla(p.Nombre_Empresa);
  if (sigla === 'IASO' && _bcEsClienteBodegaIaso(p.Cliente)) return true;
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
    // Traslados de "Nuevo Traslado" a la bodega del catálogo ("Bodega BOYACA -
    // Jorge Castellanos"): traen el nombre en Sucursal y Bodega_Facturacion
    // genérico. Se funden con el cubo de Bodega_Facturacion = 'Bodega Boyaca'.
    if ((r.Sucursal || '').trim().toUpperCase().indexOf('BODEGA BOYAC') === 0) return 'Bodega Boyaca';
  }
  if (sigla === 'IASO' && _bcEsClienteBodegaIaso(r.Cliente)) {
    var cliUp = (r.Cliente || '').trim().toUpperCase();
    // Ya existía un cubo "ESPINAL" alimentado por Sucursal — se funde con él.
    if (cliUp.indexOf('ESPINAL') >= 0) return 'ESPINAL';
    var sufijo = (r.Cliente || '').trim().replace(/^BODEGA\s+/i, '').trim();
    return 'Bodega ' + (sufijo || cliUp).toUpperCase();
  }
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
      columns: 'Nombre_Empresa,Consecutivo,Cliente,Sucursal,Bodega_Facturacion,Municipio,Fecha_Pedido,Producto,Presentacion,Cantidad,Cant_Entregada,Estado_Entrega,Estado_2,Consignacion'
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
  ['listado', 'resumen', 'admin', 'gestion'].forEach(function(t) {
    var panel = document.getElementById('bc-panel-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    var btn = document.getElementById('bc-tab-' + t);
    if (btn) btn.style.background = (t === tab) ? '#1a5276' : '#718096';
  });
  if (tab === 'gestion') bcGestionCargar();
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
    tbody.innerHTML = '<tr><td colspan="12"><div class="empty">No hay pedidos en consignación con los filtros seleccionados.</div></td></tr>';
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
      '<td>' + escHtml(r.Municipio || '—') + '</td>' +
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
  var groups = {}; // empresa||bodega||municipio||producto||presentacion
  bcFiltered.forEach(function(r) {
    var bKey = _bcBodegaKey(r);
    // Normalizado (mayúsculas) para que variantes de mayúsculas del mismo
    // municipio (ej. "Chicoral" / "CHICORAL") no se abran en filas separadas.
    var muni = (r.Municipio || '').trim().toUpperCase() || '(vacío)';
    var gKey = r.Nombre_Empresa + '||' + bKey + '||' + muni + '||' + (r.Producto || '') + '||' + (r.Presentacion || '');
    if (!groups[gKey]) {
      groups[gKey] = { empresa: r.Nombre_Empresa, bodegaKey: bKey, municipio: muni, producto: r.Producto || '', presentacion: r.Presentacion || '', cant: 0, pedidos: {} };
    }
    groups[gKey].cant += Number(r.Cant_Entregada) || 0;
    groups[gKey].pedidos[r.Nombre_Empresa + '||' + r.Consecutivo + '||' + r.Cliente] = true;
  });

  var arr = Object.values(groups);
  arr.sort(function(a, b) {
    return (getSigla(a.empresa) + '|' + a.bodegaKey + '|' + a.municipio + '|' + a.producto)
      .localeCompare(getSigla(b.empresa) + '|' + b.bodegaKey + '|' + b.municipio + '|' + b.producto, 'es');
  });

  // Subtotal por Bodega + Municipio (nivel aparte de cada uno, como se pidió).
  var subtot = {}; // empresa||bodega||municipio -> { cant, pedidos:{} }
  arr.forEach(function(g) {
    var k = g.empresa + '||' + g.bodegaKey + '||' + g.municipio;
    if (!subtot[k]) subtot[k] = { cant: 0, pedidos: {} };
    subtot[k].cant += g.cant;
    Object.keys(g.pedidos).forEach(function(p) { subtot[k].pedidos[p] = true; });
  });

  var tbody = document.getElementById('bc-body-resumen');
  document.getElementById('bc-row-ct-resumen').textContent = '(' + arr.length + ' producto(s) × bodega × municipio)';

  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty">No hay datos con los filtros seleccionados.</div></td></tr>';
    document.getElementById('bc-foot-resumen').innerHTML = '';
    return;
  }

  var html = '';
  var grandTotal = 0;
  arr.forEach(function(g, i) {
    var k = g.empresa + '||' + g.bodegaKey + '||' + g.municipio;
    html += '<tr>' +
      '<td><span class="sigla-badge ' + getSiglaClass(g.empresa) + '">' + escHtml(getSigla(g.empresa)) + '</span></td>' +
      '<td>' + escHtml(_bcBodegaLabel(g.bodegaKey)) + '</td>' +
      '<td>' + escHtml(g.municipio) + '</td>' +
      '<td>' + escHtml(g.producto) + '</td>' +
      '<td>' + escHtml(g.presentacion) + '</td>' +
      '<td class="money">' + Object.keys(g.pedidos).length + '</td>' +
      '<td class="money" style="font-weight:700;color:#27ae60">' + _fmtNum.format(g.cant) + '</td>' +
    '</tr>';
    grandTotal += g.cant;

    var next = arr[i + 1];
    var nextKey = next ? (next.empresa + '||' + next.bodegaKey + '||' + next.municipio) : null;
    if (nextKey !== k) {
      var st = subtot[k];
      html += '<tr style="background:#f7fafc;font-weight:700">' +
        '<td colspan="5" style="text-align:right">Subtotal ' + escHtml(getSigla(g.empresa)) + ' · ' + escHtml(_bcBodegaLabel(g.bodegaKey)) + ' · ' + escHtml(g.municipio) + '</td>' +
        '<td class="money">' + Object.keys(st.pedidos).length + '</td>' +
        '<td class="money">' + _fmtNum.format(st.cant) + '</td>' +
      '</tr>';
    }
  });

  tbody.innerHTML = html;
  document.getElementById('bc-foot-resumen').innerHTML =
    '<td colspan="5" style="text-align:right">Total</td><td></td><td class="money">' + _fmtNum.format(grandTotal) + '</td>';
}

// ── Administrar bodegas (catálogo BodegasConsignacion) ──────────
// Sección aditiva: alimenta el selector "Bodega destino" del botón
// "🚚 Nuevo Traslado" en Pedidos. No participa del Listado/Resumen de
// arriba, que sigue detectando traslados por _bcCalifica() (sin cambios).
var bcCatalogo = [];

async function bcLoadCatalogo() {
  var res = await apiGet('getBodegasConsignacion');
  bcCatalogo = res.ok ? (res.bodegas || []) : [];
  bcRenderAdmin();
}

function bcRenderAdmin() {
  var tbody = document.getElementById('bc-body-admin');
  if (!tbody) return;
  document.getElementById('bc-row-ct-admin').textContent = '(' + bcCatalogo.length + ' bodega(s))';

  if (!bcCatalogo.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty">Sin bodegas registradas en el catálogo.</div></td></tr>';
    return;
  }

  var rows = [].concat(bcCatalogo).sort(function(a, b) {
    return (getSigla(a.Nombre_Empresa) + '|' + a.Nombre).localeCompare(getSigla(b.Nombre_Empresa) + '|' + b.Nombre, 'es');
  });

  tbody.innerHTML = rows.map(function(b) {
    return '<tr>' +
      '<td><span class="sigla-badge ' + getSiglaClass(b.Nombre_Empresa) + '">' + escHtml(getSigla(b.Nombre_Empresa)) + '</span></td>' +
      '<td>' + escHtml(b.Nombre || '') + '</td>' +
      '<td>' + escHtml(b.Municipio || '—') + '</td>' +
      '<td>' + escHtml(b.Departamento || '—') + '</td>' +
      '<td>' + (b.Activo === false ? '<span style="color:#a0aec0">Inactiva</span>' : '<span style="color:#27ae60;font-weight:600">Activa</span>') + '</td>' +
      '<td><button class="btn-dl auth-edit-only" style="padding:3px 10px;font-size:0.76rem" onclick="bcAbrirModalBodega(' + b.id + ')">✏️ Editar</button></td>' +
    '</tr>';
  }).join('');
}

function bcAbrirModalBodega(id) {
  var b = id ? bcCatalogo.find(function(x) { return x.id === id; }) : null;
  document.getElementById('bc-modal-titulo').textContent = b ? '✏️ Editar bodega' : '➕ Nueva bodega';
  document.getElementById('bc-m-id').value = b ? b.id : '';
  populateEmpresaSelect('bc-m-empresa');
  document.getElementById('bc-m-empresa').value = b ? (b.Nombre_Empresa || '') : '';
  document.getElementById('bc-m-nombre').value = b ? (b.Nombre || '') : '';
  document.getElementById('bc-m-municipio').value = b ? (b.Municipio || '') : '';
  document.getElementById('bc-m-departamento').value = b ? (b.Departamento || '') : '';
  document.getElementById('bc-m-direccion').value = b ? (b.Direccion || '') : '';
  document.getElementById('bc-m-activo').checked = b ? (b.Activo !== false) : true;
  document.getElementById('bc-modal-overlay').classList.add('show');
}

function bcCerrarModalBodega() {
  document.getElementById('bc-modal-overlay').classList.remove('show');
}

async function bcGuardarBodega() {
  var empresa = document.getElementById('bc-m-empresa').value;
  var nombre = document.getElementById('bc-m-nombre').value.trim();
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!nombre) { showToast('Ingresa el nombre de la bodega', '#e74c3c'); return; }

  var btn = document.getElementById('bc-m-btn-guardar');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';
  try {
    var res = await apiPost({
      action: 'guardarBodegaConsignacion',
      id: document.getElementById('bc-m-id').value || null,
      nombre_empresa: empresa,
      nombre: nombre,
      municipio: document.getElementById('bc-m-municipio').value.trim(),
      departamento: document.getElementById('bc-m-departamento').value.trim(),
      direccion: document.getElementById('bc-m-direccion').value.trim(),
      activo: document.getElementById('bc-m-activo').checked
    });
    if (!res.ok) throw new Error(res.error || 'Error al guardar');
    bcCerrarModalBodega();
    showToast('✅ Bodega guardada');
    await bcLoadCatalogo();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Guardar';
  }
}

// ══════════════════════════════════════════════════════════════
// Gestión de bodegas satélite (solo administrador)
//
// Cada bodega del catálogo se HABILITA para llevar su propio inventario (tablas Bodega*, ver
// supabase/migrations/bodega_satelite_*.sql) y se le crean usuarios de bodega: cuentas de Auth SIN fila
// en `usuarios` (no ven nada de la principal). Todo pasa por RPC bodega_admin_* (exigen rol admin).
// Esta sección no toca el Listado/Resumen ni el catálogo de arriba.
// ══════════════════════════════════════════════════════════════
var bcGest = { bodegas: [], usuarios: [], cargado: false };

function _bcRpc(nombre, args) {
  return _sb.rpc(nombre, args || {}).then(function(r) {
    if (r.error) throw new Error(r.error.message || String(r.error));
    return r.data;
  });
}

async function bcGestionCargar() {
  var tbody = document.getElementById('bc-body-gestion');
  if (!tbody) return;
  if (!bcGest.cargado) tbody.innerHTML = '<tr><td colspan="9"><div class="empty">Cargando…</div></td></tr>';
  try {
    if (typeof _authReady !== 'undefined') { try { await _authReady; } catch (e) {} }
    var d = await _bcRpc('bodega_admin_listar');
    bcGest.bodegas = d.bodegas || [];
    bcGest.usuarios = d.usuarios || [];
    bcGest.cargado = true;
    bcRenderGestion();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty">' + escHtml((err && err.message) || String(err)) + '</div></td></tr>';
  }
}

function bcRenderGestion() {
  var tbody = document.getElementById('bc-body-gestion');
  document.getElementById('bc-row-ct-gestion').textContent = '(' + bcGest.bodegas.length + ' bodega(s) del catálogo)';
  if (!bcGest.bodegas.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty">El catálogo no tiene bodegas.</div></td></tr>';
  } else {
    tbody.innerHTML = bcGest.bodegas.map(function(b) {
      var c = b.config;
      var usrs = bcGest.usuarios.filter(function(u) { return (u.bodegas || []).indexOf(b.bodega_id) >= 0; })
        .map(function(u) { return escHtml(u.nombre) + (u.activo ? '' : ' <span style="color:#a0aec0">(inactivo)</span>'); }).join(', ') || '<span style="color:#a0aec0">—</span>';
      var estado = !c ? '<span style="color:#a0aec0">No habilitada</span>'
        : (c.habilitada ? '<span style="color:#27ae60;font-weight:600">Habilitada</span>' : '<span style="color:#e74c3c;font-weight:600">Deshabilitada</span>');
      var inicial = !c ? '—' : (c.inicial_aplicado ? '<span style="color:#27ae60">✔ Aplicado</span>' : '<span style="color:#e67e22">⏳ Pendiente</span>');
      var exist = !c ? '—' : (c.inicial_aplicado || c.movimientos > 0
        ? _fmtNum.format(c.productos) + ' prod. · ' + _fmtNum.format(Number(c.unidades) || 0) + ' ud' + (c.traslados_en_transito ? ' <span title="Traslados entre bodegas en tránsito" style="color:#e67e22">· ' + c.traslados_en_transito + ' en tránsito</span>' : '')
        : '—');
      return '<tr' + (b.activo === false ? ' style="opacity:.6"' : '') + '>' +
        '<td><span class="sigla-badge ' + getSiglaClass(b.empresa) + '">' + escHtml(getSigla(b.empresa)) + '</span></td>' +
        '<td>' + escHtml(b.nombre || '') + (b.municipio ? ' <span style="color:#718096">· ' + escHtml(b.municipio) + '</span>' : '') + (b.activo === false ? ' <em style="color:#a0aec0">(inactiva en el catálogo)</em>' : '') + '</td>' +
        '<td>' + (c ? '<strong>' + escHtml(c.codigo) + '</strong>' : '—') + '</td>' +
        '<td>' + (c ? fmtDate(c.fecha_corte) : '—') + '</td>' +
        '<td>' + estado + '</td><td>' + inicial + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' + exist + '</td>' +
        '<td style="font-size:0.8rem">' + usrs + '</td>' +
        '<td><button class="btn-dl" style="padding:3px 10px;font-size:0.76rem" onclick="bcAbrirModalGestionBodega(' + b.bodega_id + ')">' + (c ? '✏️ Editar' : '✅ Habilitar') + '</button></td></tr>';
    }).join('');
  }

  var ub = document.getElementById('bc-body-usuarios');
  document.getElementById('bc-row-ct-usuarios').textContent = '(' + bcGest.usuarios.length + ')';
  if (!bcGest.usuarios.length) {
    ub.innerHTML = '<tr><td colspan="6"><div class="empty">Aún no hay usuarios de bodega.</div></td></tr>';
    return;
  }
  ub.innerHTML = bcGest.usuarios.map(function(u) {
    var nombres = (u.bodegas || []).map(function(id) {
      var b = bcGest.bodegas.filter(function(x) { return x.bodega_id === id; })[0];
      return b ? (b.config ? escHtml(b.config.codigo) : escHtml(b.nombre)) : '#' + id;
    }).join(', ') || '<span style="color:#a0aec0">Sin bodegas</span>';
    // «Cuenta»: una cuenta del panel (con rol) que además gestiona bodegas se distingue de las que son SOLO de bodega.
    var cuenta = u.rol_panel
      ? '<span style="background:#ebf8ff;color:#2a4365;border-radius:10px;padding:1px 9px;font-size:0.72rem;font-weight:700;white-space:nowrap" title="Cuenta del panel principal que también gestiona bodegas">Panel: ' + escHtml(u.rol_panel) + '</span>'
      : '<span style="background:#e2e8f0;color:#4a5568;border-radius:10px;padding:1px 9px;font-size:0.72rem;font-weight:700;white-space:nowrap" title="Cuenta creada solo para las bodegas (no ve el panel)">Solo bodega</span>';
    return '<tr' + (u.activo ? '' : ' style="opacity:.6"') + '><td>' + escHtml(u.nombre) + '</td><td>' + escHtml(u.email) + '</td><td>' + cuenta + '</td><td>' + nombres + '</td>' +
      '<td>' + (u.activo ? '<span style="color:#27ae60;font-weight:600">Activo</span>' : '<span style="color:#a0aec0">Inactivo</span>') + '</td>' +
      '<td><button class="btn-dl" style="padding:3px 10px;font-size:0.76rem" onclick="bcAbrirModalUsuario(\'' + escHtml(u.usuario_id) + '\')">✏️ Editar</button></td></tr>';
  }).join('');
}

// Sugiere un código a partir del nombre («Bodega COATOL» → COATOL); si otra del mismo catálogo y
// empresa se llama igual, agrega el municipio («COATOL-CHICORAL»).
function bcSugerirCodigo(b) {
  function limpia(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();
  }
  var base = limpia(b.nombre).replace(/^BODEGA\s+/, '').split(/\s+/)[0] || 'BODEGA';
  base = base.slice(0, 12);
  var repetida = bcGest.bodegas.some(function(o) {
    return o.bodega_id !== b.bodega_id && o.empresa === b.empresa &&
      (limpia(o.nombre).replace(/^BODEGA\s+/, '').split(/\s+/)[0] || '').slice(0, 12) === base;
  });
  if (repetida && b.municipio) {
    var m = limpia(b.municipio).split(/\s+/)[0].slice(0, 12);
    if (m) return base + '-' + m;
  }
  return base;
}

function bcAbrirModalGestionBodega(id) {
  var b = bcGest.bodegas.filter(function(x) { return x.bodega_id === id; })[0];
  if (!b) return;
  var c = b.config;
  document.getElementById('bg-modal-titulo').textContent = c ? '✏️ Editar bodega satélite' : '✅ Habilitar bodega satélite';
  document.getElementById('bg-m-id').value = b.bodega_id;
  document.getElementById('bg-m-nombre').value = getSigla(b.empresa) + ' · ' + (b.nombre || '') + (b.municipio ? ' · ' + b.municipio : '');
  var cod = document.getElementById('bg-m-codigo');
  cod.value = c ? c.codigo : bcSugerirCodigo(b);
  cod.disabled = !!(c && c.movimientos > 0);
  var corte = document.getElementById('bg-m-corte');
  corte.value = c ? c.fecha_corte : today();
  corte.max = today();
  corte.disabled = !!(c && c.inicial_aplicado);
  document.getElementById('bg-m-habilitada').checked = c ? c.habilitada : true;
  document.getElementById('bg-modal-overlay').classList.add('show');
}

function bcCerrarModalGestionBodega() {
  document.getElementById('bg-modal-overlay').classList.remove('show');
}

async function bcGuardarGestionBodega() {
  var id = Number(document.getElementById('bg-m-id').value);
  var codigo = document.getElementById('bg-m-codigo').value.trim().toUpperCase();
  var corte = document.getElementById('bg-m-corte').value;
  if (!/^[A-Z0-9]{2,12}(-[A-Z0-9]{2,12})?$/.test(codigo)) { showToast('Código no válido: mayúsculas y números (2 a 12), con un guion y un segundo bloque opcional.', '#e74c3c', 5000); return; }
  if (!corte) { showToast('Indica la fecha de corte', '#e74c3c'); return; }
  var btn = document.getElementById('bg-m-btn-guardar');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  try {
    await _bcRpc('bodega_admin_guardar_bodega', {
      p_bodega_id: id, p_codigo: codigo, p_fecha_corte: corte,
      p_habilitada: document.getElementById('bg-m-habilitada').checked
    });
    bcCerrarModalGestionBodega();
    showToast('✅ Bodega guardada');
    await bcGestionCargar();
  } catch (err) {
    showToast('❌ ' + err.message, '#e74c3c', 6000);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Guardar';
  }
}

// ── Usuarios de bodega ──
function bcAbrirModalUsuario(uid) {
  var u = uid ? bcGest.usuarios.filter(function(x) { return x.usuario_id === uid; })[0] : null;
  var habilitadas = bcGest.bodegas.filter(function(b) { return b.config && b.config.habilitada; });
  if (!u && !habilitadas.length) { showToast('Primero habilita al menos una bodega.', '#e67e22', 5000); return; }
  document.getElementById('bu-modal-titulo').textContent = u ? '✏️ Editar usuario de bodega' : '👤 Nuevo usuario de bodega';
  document.getElementById('bu-m-id').value = u ? u.usuario_id : '';
  document.getElementById('bu-m-nombre').value = u ? u.nombre : '';
  var em = document.getElementById('bu-m-email');
  em.value = u ? u.email : '';
  em.disabled = !!u;
  document.getElementById('bu-m-pass').value = '';
  document.getElementById('bu-m-pass-wrap').style.display = u ? 'none' : '';
  document.getElementById('bu-m-activo').checked = u ? u.activo : true;
  var nota = document.getElementById('bu-m-nota');
  var esPanel = !!(u && u.rol_panel);
  nota.innerHTML = esPanel
    ? '👤 Cuenta del <strong>panel principal</strong> (rol: <strong>' + escHtml(u.rol_panel) + '</strong>). Desactivarla aquí solo le quita el acceso a las bodegas; su acceso al panel no cambia.'
    : '';
  nota.style.background = esPanel ? '#ebf8ff' : '';
  nota.style.padding = esPanel ? '8px 10px' : '0';
  var asignadas = u ? (u.bodegas || []) : [];
  document.getElementById('bu-m-bodegas').innerHTML = habilitadas.map(function(b) {
    return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer"><input type="checkbox" class="bu-m-bod" value="' + b.bodega_id + '"' +
      (asignadas.indexOf(b.bodega_id) >= 0 ? ' checked' : '') + '> <span class="sigla-badge ' + getSiglaClass(b.empresa) + '">' + escHtml(getSigla(b.empresa)) + '</span> ' +
      escHtml(b.nombre) + (b.municipio ? ' · ' + escHtml(b.municipio) : '') + ' <strong>(' + escHtml(b.config.codigo) + ')</strong></label>';
  }).join('') || '<span style="color:#a0aec0">No hay bodegas habilitadas.</span>';
  document.getElementById('bu-modal-overlay').classList.add('show');
}

function bcCerrarModalUsuario() {
  document.getElementById('bu-modal-overlay').classList.remove('show');
}

async function bcGuardarUsuario() {
  var uid = document.getElementById('bu-m-id').value;
  var nombre = document.getElementById('bu-m-nombre').value.trim();
  var email = document.getElementById('bu-m-email').value.trim().toLowerCase();
  var pass = document.getElementById('bu-m-pass').value;
  var activo = document.getElementById('bu-m-activo').checked;
  var bodegas = Array.prototype.map.call(document.querySelectorAll('.bu-m-bod:checked'), function(i) { return Number(i.value); });
  if (nombre.length < 3) { showToast('Escribe el nombre (mínimo 3 caracteres)', '#e74c3c'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast('Correo no válido', '#e74c3c'); return; }

  var btn = document.getElementById('bu-m-btn-guardar');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  var creada = false;
  try {
    if (!uid) {
      // ¿Ya existe una cuenta con ese correo? Una cuenta del panel principal SÍ puede gestionar bodegas (p. ej. un
      // comercial): se vincula con su misma cuenta y contraseña, sin tocar su acceso al panel. La contraseña solo se pide
      // para cuentas NUEVAS.
      var f = await _bcRpc('bodega_admin_buscar_usuario', { p_email: email });
      if (f.existe) {
        if (f.ya_es_bodega) throw new Error('Ese correo ya es usuario de bodega: edítalo desde la lista.');
        var pregunta = f.es_usuario_principal
          ? 'Esta cuenta ya es del PANEL PRINCIPAL (rol: ' + (f.rol_panel || '—') + (f.nombre_panel ? ', ' + f.nombre_panel : '') + '). Se le dará acceso a las bodegas marcadas con su MISMA cuenta y contraseña; su acceso al panel no cambia. ¿Continuar?'
          : 'Ya existe una cuenta con ese correo (sin acceso al panel de la empresa). ¿Vincularla como usuario de bodega? Su contraseña no se cambia.';
        if (!window.confirm(pregunta)) {
          return;
        }
        uid = f.usuario_id;
      } else {
        if (pass.length < 8) throw new Error('Cuenta nueva: la contraseña temporal debe tener al menos 8 caracteres.');
        var fnRes = await _sb.functions.invoke('create-user', { body: { email: email, password: pass } });
        if (fnRes.error) {
          var msg = 'Error al crear la cuenta en Auth';
          try { var body = await fnRes.error.context.json(); if (body && body.error) msg = body.error; } catch (e2) {}
          throw new Error(msg);
        }
        uid = fnRes.data && fnRes.data.user_id;
        if (!uid) throw new Error('No se recibió el ID de la cuenta creada');
        creada = true;
      }
    }
    await _bcRpc('bodega_admin_guardar_usuario', { p_usuario_id: uid, p_nombre: nombre, p_email: email, p_activo: activo, p_bodegas: bodegas });
    bcCerrarModalUsuario();
    showToast('✅ Usuario de bodega guardado');
    await bcGestionCargar();
  } catch (err) {
    showToast('❌ ' + err.message + (creada ? ' — La cuenta SÍ se creó; vuelve a guardar con el mismo correo para vincularla.' : ''), '#e74c3c', 8000);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Guardar';
  }
}

// ── Init ───────────────────────────────────────────────────────
if (typeof document !== 'undefined' && document.getElementById('load-zone') && !window.__BC_TEST) {
  loadBodegasConsignacion();
  if (typeof _authReady !== 'undefined') {
    _authReady.then(function() { bcLoadCatalogo(); }).catch(function() {});
  } else {
    bcLoadCatalogo();
  }
  // Un aviso de la campanita (módulo 'bodegas') abre directo la gestión: bodegas-consignacion.html?tab=gestion
  try {
    if (new URLSearchParams(location.search).get('tab') === 'gestion' && typeof _authReady !== 'undefined') {
      _authReady.then(function() { bcSwitchTab('gestion'); }).catch(function() {});
    }
  } catch (e) { /* sin parámetros */ }
}
