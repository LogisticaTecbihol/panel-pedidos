// ══════════════════════════════════════════════════════════════
// Bodegas satélite — pantalla de la bodega (bodega-satelite.html)
//
// Mini-app para los usuarios de bodega (cuentas de Auth SIN fila en `usuarios`). Todo pasa por
// las RPC bodega_* (SECURITY DEFINER): la bodega no lee ni escribe tablas directamente y no ve nada
// de la principal. Inventario propio: solo producto terminado bueno, sin apartados.
//
// Pestañas: Existencias · Por recibir (de la principal y de otras bodegas) · Traslados entre bodegas ·
// Salidas · Conteos y ajustes · Movimientos (Kardex).
// Depende de: shared.js (_sb, escHtml, showToast, fmtDate, today, getSigla), bodega-auth.js,
// pdf-remision.js (generarRemisionPDF) y, para Excel, XLSX (SheetJS).
// ══════════════════════════════════════════════════════════════

var BS = {
  ctx: null,
  bodega: null,          // {bodega_id, codigo, nombre, municipio, departamento, empresa, fecha_corte, inicial_aplicado}
  productos: [],         // maestro: [{producto, presentacion}]
  exist: null,           // bodega_existencias
  pend: null,            // bodega_traslados_pendientes
  trasl: null,           // bodega_traslados_bodega {enviados, recibidos}
  destinos: [],          // bodega_destinos
  conteos: [],           // bodega_conteos (lista)
  kardex: [],            // bodega_kardex (todo, con anulados)
  tab: 'exist',
  listas: { sal: [], tr: [], cnt: [] },   // líneas en edición de los formularios
  cnt: null,             // conteo abierto en el editor {id, tipo, fecha, obs, estado}
  busy: false
};

var BS_TIPOS = {
  SALDO_INICIAL:               { txt: 'Saldo inicial',               cls: 'bs-inf', signo: 1 },
  ENTRADA_TRASLADO:            { txt: 'Entrada de la principal',     cls: 'bs-ok',  signo: 1 },
  ENTRADA_TRASLADO_BODEGA:     { txt: 'Entrada de otra bodega',      cls: 'bs-ok',  signo: 1 },
  AJUSTE_SOBRANTE:             { txt: 'Ajuste (sobrante)',           cls: 'bs-inf', signo: 1 },
  SALIDA_DESPACHO:             { txt: 'Salida',                      cls: 'bs-warn', signo: -1 },
  SALIDA_DEVOLUCION_PRINCIPAL: { txt: 'Devolución a la principal',   cls: 'bs-warn', signo: -1 },
  SALIDA_TRASLADO_BODEGA:      { txt: 'Traslado a otra bodega',      cls: 'bs-warn', signo: -1 },
  AJUSTE_FALTANTE:             { txt: 'Ajuste (faltante)',           cls: 'bs-bad', signo: -1 }
};

// ── Utilidades ────────────────────────────────────────────────
function bsEl(id) { return document.getElementById(id); }
var _bsFmt = new Intl.NumberFormat('es-CO');
function bsN(n) { return _bsFmt.format(Number(n) || 0); }
function bsNorm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase(); }
function bsErr(e) { showToast('❌ ' + ((e && e.message) || e), '#e74c3c', 7000); }
function bsOk(m) { showToast(m, '#27ae60', 4500); }
function bsBodegaNombre(b) { return (b.nombre || '') + (b.municipio ? ' · ' + b.municipio : ''); }
function bsSiglaEmpresa() { return (typeof getSigla === 'function' && BS.bodega) ? getSigla(BS.bodega.empresa) : ''; }
function bsBadge(txt, cls) { return '<span class="bs-badge ' + cls + '">' + escHtml(txt) + '</span>'; }
function bsEstadoTraslado(e) {
  var m = { 'En tránsito': 'bs-inf', 'Recibido': 'bs-ok', 'Recibido con diferencia': 'bs-warn', 'Cancelado': 'bs-gry' };
  return bsBadge(e, m[e] || 'bs-gry');
}
function bsHoy() { return today(); }

// Ejecuta una acción que escribe: evita doble clic y muestra el error.
async function bsAccion(btn, fn) {
  if (BS.busy) return;
  BS.busy = true;
  var txt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ ...'; }
  try { await fn(); } catch (e) { bsErr(e); }
  finally {
    BS.busy = false;
    if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = txt; }
  }
}

// ── Modal genérico ────────────────────────────────────────────
var _bsModalCb = null;
function bsModal(titulo, html, botones, info) {
  bsEl('bs-modal-titulo').textContent = titulo;
  bsEl('bs-modal-body').innerHTML = html;
  bsEl('bs-modal-info').innerHTML = info || '';
  var cont = bsEl('bs-modal-btns');
  cont.innerHTML = '';
  _bsModalCb = {};
  (botones || [{ id: 'cerrar', label: 'Cerrar', cls: 'btn-cancel' }]).forEach(function (b) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = b.cls || 'btn-confirm';
    btn.textContent = b.label;
    btn.dataset.bsbtn = b.id;
    _bsModalCb[b.id] = b.onClick || bsCerrarModal;
    cont.appendChild(btn);
  });
  bsEl('bs-overlay').classList.add('show');
}
function bsCerrarModal() { bsEl('bs-overlay').classList.remove('show'); _bsModalCb = null; }

function bsConfirmar(titulo, html, labelOk) {
  return new Promise(function (resolve) {
    bsModal(titulo, html, [
      { id: 'no', label: 'Cancelar', cls: 'btn-cancel', onClick: function () { bsCerrarModal(); resolve(false); } },
      { id: 'si', label: labelOk || 'Confirmar', cls: 'btn-confirm', onClick: function () { bsCerrarModal(); resolve(true); } }
    ]);
  });
}

// Pide un texto (motivo) de al menos `min` caracteres. Devuelve el texto o null.
function bsPedirTexto(titulo, etiqueta, min, labelOk) {
  return new Promise(function (resolve) {
    bsModal(titulo,
      '<label class="ef-label">' + escHtml(etiqueta) + ' *</label><textarea class="ef" id="bs-pt-txt" maxlength="300" placeholder="Mínimo ' + min + ' caracteres"></textarea><div id="bs-pt-err" class="login-error" style="margin-top:6px"></div>',
      [
        { id: 'no', label: 'Cancelar', cls: 'btn-cancel', onClick: function () { bsCerrarModal(); resolve(null); } },
        { id: 'si', label: labelOk || 'Aceptar', cls: 'btn-confirm', onClick: function () {
          var v = bsEl('bs-pt-txt').value.trim();
          if (v.length < min) { bsEl('bs-pt-err').textContent = 'Escribe al menos ' + min + ' caracteres.'; return; }
          bsCerrarModal(); resolve(v);
        } }
      ]);
    setTimeout(function () { var t = bsEl('bs-pt-txt'); if (t) t.focus(); }, 60);
  });
}

// ── Carga de datos ────────────────────────────────────────────
async function bsCargarBodega() {
  var id = BS.bodega.bodega_id;
  var r = await Promise.all([
    bodegaRpc('bodega_existencias', { p_bodega: id }),
    bodegaRpc('bodega_traslados_pendientes', { p_bodega: id }),
    bodegaRpc('bodega_traslados_bodega', { p_bodega: id }),
    bodegaRpc('bodega_destinos', { p_bodega: id }),
    bodegaRpc('bodega_conteos', { p_bodega: id }),
    bodegaRpc('bodega_kardex', { p_bodega: id, p_incluir_anulados: true })
  ]);
  BS.exist = r[0]; BS.pend = r[1]; BS.trasl = r[2]; BS.destinos = r[3] || []; BS.conteos = r[4] || []; BS.kardex = r[5] || [];
  BS.bodega.inicial_aplicado = !!(BS.exist && BS.exist.inicial_aplicado);
  bsLlenarDatalists();
  bsRenderTodo();
}

async function bsRefrescar(silencioso) {
  try { await bsCargarBodega(); if (!silencioso) bsOk('✅ Datos actualizados'); }
  catch (e) { bsErr(e); }
}

function bsLlenarDatalists() {
  var stock = (BS.exist && BS.exist.items) || [];
  bsEl('bs-dl-stock').innerHTML = stock.map(function (i) {
    return '<option value="' + escHtml(i.producto) + '"></option>'; // sin texto dentro: Firefox lo muestra EN LUGAR del nombre (la existencia se ve en la tabla al agregar)
  }).join('');
  bsEl('bs-dl-all').innerHTML = BS.productos.map(function (p) {
    return '<option value="' + escHtml(p.producto) + '"></option>';
  }).join('');
}

function bsStockDe(producto) {
  var k = bsNorm(producto);
  var it = ((BS.exist && BS.exist.items) || []).filter(function (i) { return bsNorm(i.producto) === k; })[0];
  return it ? Number(it.existencia) : 0;
}

function bsPorRecibirCuenta() {
  var n = ((BS.pend && BS.pend.remisiones) || []).length;
  n += ((BS.trasl && BS.trasl.recibidos) || []).filter(function (t) { return t.estado === 'En tránsito'; }).length;
  return n;
}

// ── Render general ────────────────────────────────────────────
function bsRenderTodo() {
  bsRenderBanner();
  bsRenderExist();
  bsRenderRecibir();
  bsRenderTraslados();
  bsRenderSalidas();
  bsRenderConteos();
  bsRenderKardex();
  var c = bsPorRecibirCuenta();
  var cnt = bsEl('bs-cnt-recibir');
  cnt.textContent = c; cnt.style.display = c > 0 ? '' : 'none';
}

function bsIrTab(tab) {
  BS.tab = tab;
  ['exist', 'recibir', 'trasl', 'salidas', 'conteos', 'kardex'].forEach(function (t) {
    bsEl('bs-panel-' + t).style.display = (t === tab) ? '' : 'none';
  });
  Array.prototype.forEach.call(document.querySelectorAll('#bs-tabs a'), function (a) {
    a.classList.toggle('active', a.dataset.tab === tab);
  });
}

function bsRenderBanner() {
  var b = BS.bodega;
  var h = '';
  if (!b.inicial_aplicado) {
    h += '<div class="bs-banner">⚠️ <div><strong>Esta bodega aún no tiene su conteo inicial.</strong> Hasta que lo apliques no podrás registrar salidas ni traslados. Fecha de corte (la del conteo físico): <strong>' + escHtml(fmtDate(b.fecha_corte)) + '</strong>.</div>' +
         '<button class="bs-btn bs-sm" data-act="ir-tab" data-tab="conteos">Ir a Conteos</button></div>';
  }
  var alertas = (BS.pend && BS.pend.alertas) || [];
  if (alertas.length) {
    var rems = {};
    alertas.forEach(function (a) { rems[a.remision] = true; });
    h += '<div class="bs-banner" style="background:#fff5f5;border-color:#fc8181;color:#742a2a">🚨 <div><strong>La principal anuló ' + Object.keys(rems).length + ' remisión(es) que ya habías recibido:</strong> ' +
         escHtml(Object.keys(rems).join(', ')) + '. Nada se reversa solo: revisa con la principal y, si corresponde, corrige con un conteo/ajuste.</div></div>';
  }
  bsEl('bs-banner').innerHTML = h;
}

// ══════════════════ EXISTENCIAS ══════════════════
function bsRenderExist() {
  var items = (BS.exist && BS.exist.items) || [];
  var trans = (BS.exist && BS.exist.en_transito_salida) || [];
  var uds = items.reduce(function (s, i) { return s + Number(i.existencia); }, 0);
  var udsTr = trans.reduce(function (s, i) { return s + Number(i.cantidad); }, 0);
  var h = '<div class="stats">' +
    '<div class="sc total"><div class="num">' + bsN(items.length) + '</div><div class="lbl">Productos con existencia</div></div>' +
    '<div class="sc entregado"><div class="num">' + bsN(uds) + '</div><div class="lbl">Unidades en bodega</div></div>' +
    '<div class="sc parcial"><div class="num">' + bsN(udsTr) + '</div><div class="lbl">En tránsito hacia otras bodegas</div></div>' +
    '<div class="sc recibido"><div class="num">' + bsN(bsPorRecibirCuenta()) + '</div><div class="lbl">Por recibir</div></div></div>';
  h += '<div class="filters"><div class="fg"><label>Buscar producto</label><input class="ef" id="bs-ex-q" type="search" placeholder="Nombre del producto" style="min-width:240px"></div>' +
       '<button class="bs-btn bs-sec" style="margin-left:auto" data-act="ex-excel">⬇ Exportar Excel</button></div>';
  h += '<div class="card"><div class="card-head"><h3>📦 Existencias de ' + escHtml(bsBodegaNombre(BS.bodega)) + ' <span id="bs-ex-ct" class="bs-muted"></span></h3></div>' +
       '<div class="bs-tblwrap"><table><thead><tr><th>Producto</th><th>Presentación</th><th class="bs-num">Existencia</th></tr></thead><tbody id="bs-ex-body"></tbody></table></div>' +
       '<p class="bs-muted" style="margin-top:10px">Solo producto terminado en buen estado. La existencia es entradas − salidas: en las bodegas satélite no hay apartados.</p></div>';
  if (trans.length) {
    h += '<div class="card"><div class="card-head"><h3>🚚 En tránsito hacia otras bodegas <small>ya salió de esta bodega y aún no la confirma el destino (no cuenta en ninguna existencia)</small></h3></div>' +
         '<div class="bs-tblwrap"><table><thead><tr><th>Traslado</th><th>Destino</th><th>Producto</th><th class="bs-num">Cantidad</th></tr></thead><tbody>' +
         trans.map(function (t) {
           return '<tr><td><strong>' + escHtml(t.consecutivo) + '</strong></td><td>' + escHtml(t.destino) + '</td><td>' + escHtml(t.producto) + '</td><td class="bs-num">' + bsN(t.cantidad) + '</td></tr>';
         }).join('') + '</tbody></table></div></div>';
  }
  bsEl('bs-panel-exist').innerHTML = h;
  bsFiltrarExist();
}

function bsFiltrarExist() {
  var q = bsEl('bs-ex-q') ? bsNorm(bsEl('bs-ex-q').value) : '';
  var items = ((BS.exist && BS.exist.items) || []).filter(function (i) { return !q || bsNorm(i.producto).indexOf(q) >= 0; });
  var tb = bsEl('bs-ex-body');
  if (!tb) return;
  tb.innerHTML = items.length ? items.map(function (i) {
    return '<tr><td>' + escHtml(i.producto) + '</td><td>' + escHtml(i.presentacion) + '</td><td class="bs-num"><strong>' + bsN(i.existencia) + '</strong></td></tr>';
  }).join('') : '<tr><td colspan="3"><div class="empty">' + (q ? 'Ningún producto coincide.' : (BS.bodega.inicial_aplicado ? 'No hay existencias.' : 'Todavía no hay existencias: aplica primero el conteo inicial.')) + '</div></td></tr>';
  bsEl('bs-ex-ct').textContent = '(' + items.length + ')';
}

function bsExcelExist() {
  var filas = ((BS.exist && BS.exist.items) || []).map(function (i) {
    return { 'Bodega': BS.bodega.codigo, 'Producto': i.producto, 'Presentación': i.presentacion, 'Existencia': Number(i.existencia) };
  });
  bsExcel('Existencias_' + BS.bodega.codigo + '_' + bsHoy() + '.xlsx', filas, 'Existencias');
}

function bsExcel(nombre, filas, hoja) {
  if (typeof XLSX === 'undefined') { showToast('La librería de Excel no está disponible todavía; intenta de nuevo.', '#e67e22'); return; }
  if (!filas.length) { showToast('No hay datos para exportar.', '#e67e22'); return; }
  var ws = XLSX.utils.json_to_sheet(filas);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja || 'Datos');
  XLSX.writeFile(wb, nombre);
}

// ══════════════════ POR RECIBIR ══════════════════
function bsTablaRecibir(kind, ref, lineas, cantKey) {
  // lineas: [{producto, presentacion, despachada}]
  return '<div class="bs-tblwrap"><table><thead><tr><th>Producto</th><th class="bs-num">' + (kind === 'rem' ? 'Despachado' : 'Enviado') + '</th><th class="bs-num">Recibido</th></tr></thead><tbody>' +
    lineas.map(function (l) {
      var d = Number(l[cantKey]);
      return '<tr><td>' + escHtml(l.producto) + '</td><td class="bs-num">' + bsN(d) + '</td>' +
        '<td class="bs-num"><input class="ef bs-qty bs-rec-in" type="number" min="0" max="' + d + '" step="1" value="' + d + '" data-prod="' + escHtml(l.producto) + '" data-desp="' + d + '"></td></tr>';
    }).join('') + '</tbody></table></div>' +
    '<div style="margin-top:10px"><label class="ef-label">Observaciones <span class="bs-muted bs-rec-obs-req" style="text-transform:none;font-weight:400"></span></label><textarea class="ef bs-rec-obs" maxlength="300" placeholder="Obligatoria si lo recibido no coincide con lo despachado"></textarea></div>' +
    '<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="bs-btn" data-act="' + (kind === 'rem' ? 'rec-rem' : 'rec-bod') + '" data-ref="' + escHtml(ref) + '">✅ Confirmar recepción</button><span class="bs-muted bs-rec-aviso"></span></div>';
}

function bsRenderRecibir() {
  var rems = (BS.pend && BS.pend.remisiones) || [];
  var pend = ((BS.trasl && BS.trasl.recibidos) || []).filter(function (t) { return t.estado === 'En tránsito'; });
  var h = '';
  h += '<div class="bs-card"><h3>📥 De la principal <small>remisiones despachadas hacia esta bodega' + (BS.pend && BS.pend.fecha_corte ? ' después del ' + escHtml(fmtDate(BS.pend.fecha_corte)) + ' (fecha de corte)' : '') + '</small></h3>';
  if (!rems.length) h += '<div class="empty">No hay remisiones de la principal pendientes de recibir.</div>';
  rems.forEach(function (r) {
    var lineas = r.lineas.map(function (l) { return { producto: l.producto, presentacion: l.presentacion, despachada: l.cantidad }; });
    h += '<div class="bs-card bs-rem" data-kind="rem" data-ref="' + escHtml(r.remision) + '"><h3>Remisión ' + escHtml(r.remision) + ' <small>' + escHtml(fmtDate(r.fecha)) + ' · ' + lineas.length + ' producto(s)</small></h3>' +
         bsTablaRecibir('rem', r.remision, lineas, 'despachada') + '</div>';
  });
  h += '</div>';

  h += '<div class="bs-card"><h3>🚚 De otras bodegas <small>traslados en tránsito hacia esta bodega</small></h3>';
  if (!pend.length) h += '<div class="empty">No hay traslados entre bodegas por recibir.</div>';
  pend.forEach(function (t) {
    var lineas = t.lineas.map(function (l) { return { producto: l.producto, presentacion: l.presentacion, enviada: l.enviada }; });
    h += '<div class="bs-card bs-rem" data-kind="bod" data-ref="' + t.id + '"><h3>' + escHtml(t.consecutivo) + ' <small>desde ' + escHtml(bsBodegaNombre(t.origen)) + ' · enviado ' + escHtml(fmtDate(t.fecha)) + (t.enviado_por_nombre ? ' por ' + escHtml(t.enviado_por_nombre) : '') + '</small></h3>' +
         (t.observaciones ? '<p class="bs-muted" style="margin-bottom:8px">Obs. del envío: ' + escHtml(t.observaciones) + '</p>' : '') +
         bsTablaRecibir('bod', String(t.id), lineas, 'enviada') + '</div>';
  });
  h += '</div>';
  bsEl('bs-panel-recibir').innerHTML = h;
}

// Marca en amarillo la tarjeta si lo recibido no coincide y avisa que la observación es obligatoria.
function bsRevisarDiferencia(card) {
  var dif = false;
  Array.prototype.forEach.call(card.querySelectorAll('.bs-rec-in'), function (inp) {
    if (Number(inp.value) !== Number(inp.dataset.desp)) dif = true;
  });
  card.classList.toggle('bs-dif', dif);
  var av = card.querySelector('.bs-rec-aviso');
  if (av) av.textContent = dif ? '⚠️ Hay diferencias: la observación es obligatoria y se avisará a la principal.' : '';
}

function bsLeerRecepcion(card) {
  var lineas = [];
  var ok = true;
  Array.prototype.forEach.call(card.querySelectorAll('.bs-rec-in'), function (inp) {
    var v = inp.value.trim();
    var n = Number(v);
    if (v === '' || !isFinite(n) || n < 0 || Math.floor(n) !== n) ok = false;
    if (n > Number(inp.dataset.desp)) ok = false;
    lineas.push({ producto: inp.dataset.prod, cantidad: n });
  });
  return ok ? lineas : null;
}

async function bsRecibir(btn, kind) {
  var card = btn.closest('.bs-rem');
  var lineas = bsLeerRecepcion(card);
  if (!lineas) { showToast('Revisa las cantidades: deben ser enteros entre 0 y lo despachado.', '#e67e22', 5000); return; }
  var obs = card.querySelector('.bs-rec-obs').value.trim();
  var dif = card.classList.contains('bs-dif');
  if (dif && obs.length < 5) { showToast('Hay diferencias: escribe una observación (mínimo 5 caracteres).', '#e67e22', 5000); card.querySelector('.bs-rec-obs').focus(); return; }
  var ref = card.dataset.ref;
  var ok = await bsConfirmar('Confirmar recepción',
    '<p>Vas a recibir <strong>' + escHtml(kind === 'rem' ? ref : (((BS.trasl.recibidos || []).filter(function (t) { return String(t.id) === ref; })[0] || {}).consecutivo || ref)) + '</strong> con las cantidades indicadas.</p>' +
    (dif ? '<p style="color:#c05621;margin-top:8px"><strong>Hay diferencias con lo despachado.</strong> Se avisará a la principal.</p>' : '') +
    '<p class="bs-muted" style="margin-top:8px">Esto suma a la existencia de la bodega y no se puede deshacer (se corrige con un ajuste).</p>');
  if (!ok) return;
  await bsAccion(btn, async function () {
    if (kind === 'rem') await bodegaRpc('bodega_recibir_traslado', { p_bodega: BS.bodega.bodega_id, p_remision: ref, p_lineas: lineas, p_obs: obs });
    else await bodegaRpc('bodega_recibir_traslado_bodega', { p_traslado_id: Number(ref), p_lineas: lineas, p_obs: obs });
    bsOk('✅ Recepción registrada' + (dif ? ' (con diferencia: se avisó a la principal)' : ''));
    await bsCargarBodega();
  });
}

// ══════════════════ EDITOR DE LÍNEAS (salidas, traslados, conteos) ══════════════════
// k = 'sal' | 'tr' | 'cnt'. soloStock: solo productos con existencia (y tope = existencia).
function bsLineasHtml(k, opts) {
  opts = opts || {};
  var lista = BS.listas[k];
  var dl = opts.soloStock ? 'bs-dl-stock' : 'bs-dl-all';
  var h = '<div class="bs-row"><div style="flex:3 1 240px"><label class="ef-label">Producto</label><input class="ef" id="bs-' + k + '-prod" list="' + dl + '" autocomplete="off" placeholder="Escribe unas letras y elige de la lista"></div>' +
          '<div style="flex:0 0 110px"><label class="ef-label">' + (opts.conteo ? 'Cantidad física' : 'Cantidad') + '</label><input class="ef" id="bs-' + k + '-qty" type="number" min="' + (opts.conteo ? 0 : 1) + '" step="1" placeholder="0"></div>' +
          '<div style="flex:0 0 auto"><button class="bs-btn" type="button" data-act="ln-add" data-k="' + k + '">➕ Agregar</button></div>' +
          (opts.precarga ? '<div style="flex:0 0 auto"><button class="bs-btn bs-sec" type="button" data-act="cnt-precargar">📋 Precargar con las existencias</button></div>' : '') + '</div>';
  if (!lista.length) return h + '<div class="empty" style="padding:14px">Aún no hay productos en la lista.</div>';
  h += '<div class="bs-tblwrap"><table><thead><tr><th>Producto</th>' +
       (opts.soloStock ? '<th class="bs-num">Disponible</th>' : '') +
       (opts.conteo ? '<th class="bs-num">Sistema</th>' : '') +
       '<th class="bs-num">' + (opts.conteo ? 'Físico' : 'Cantidad') + '</th>' +
       (opts.conteo ? '<th class="bs-num">Diferencia</th>' : '') + '<th></th></tr></thead><tbody>';
  lista.forEach(function (l, i) {
    var disp = opts.soloStock ? bsStockDe(l.producto) : null;
    var exceso = opts.soloStock && Number(l.cantidad) > disp;
    h += '<tr' + (exceso ? ' style="background:#fff5f5"' : '') + '><td>' + escHtml(l.producto) + '</td>' +
         (opts.soloStock ? '<td class="bs-num">' + bsN(disp) + '</td>' : '') +
         (opts.conteo ? '<td class="bs-num">' + bsN(l.sistema || 0) + '</td>' : '') +
         '<td class="bs-num"><input class="ef bs-qty" type="number" min="' + (opts.conteo ? 0 : 1) + '" step="1" value="' + escHtml(l.cantidad) + '" data-act-input="ln-qty" data-k="' + k + '" data-i="' + i + '"></td>' +
         (opts.conteo ? '<td class="bs-num"><strong style="color:' + (Number(l.cantidad) - Number(l.sistema || 0) === 0 ? '#718096' : (Number(l.cantidad) > Number(l.sistema || 0) ? '#22543d' : '#9b2c2c')) + '">' + (Number(l.cantidad) - Number(l.sistema || 0) > 0 ? '+' : '') + bsN(Number(l.cantidad) - Number(l.sistema || 0)) + '</strong></td>' : '') +
         '<td><button class="bs-btn bs-red bs-sm" type="button" data-act="ln-del" data-k="' + k + '" data-i="' + i + '">✕</button></td></tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function bsLineasAgregar(k, opts) {
  var inp = bsEl('bs-' + k + '-prod'), qty = bsEl('bs-' + k + '-qty');
  var nombre = bsNorm(inp.value);
  var base = opts.soloStock ? ((BS.exist && BS.exist.items) || []) : BS.productos;
  var prod = base.filter(function (p) { return bsNorm(p.producto) === nombre; })[0];
  if (!prod) { showToast('Elige un producto de la lista (' + (opts.soloStock ? 'solo productos con existencia' : 'maestro de productos') + ').', '#e67e22', 5000); inp.focus(); return false; }
  var v = qty.value.trim(), n = Number(v);
  if (v === '' || !isFinite(n) || Math.floor(n) !== n || n < (opts.conteo ? 0 : 1)) { showToast('La cantidad debe ser un número entero' + (opts.conteo ? ' (0 o más).' : ' mayor que 0.'), '#e67e22'); qty.focus(); return false; }
  var lista = BS.listas[k];
  var ya = lista.filter(function (l) { return bsNorm(l.producto) === nombre; })[0];
  if (ya) ya.cantidad = opts.conteo ? n : Number(ya.cantidad) + n;
  else lista.push({ producto: prod.producto, presentacion: prod.presentacion || '', cantidad: n, sistema: opts.conteo ? bsStockDe(prod.producto) : 0 });
  inp.value = ''; qty.value = '';
  return true;
}

// Revisa líneas contra la existencia; devuelve texto de error o ''.
function bsValidarExistencia(lista) {
  for (var i = 0; i < lista.length; i++) {
    var d = bsStockDe(lista[i].producto);
    if (Number(lista[i].cantidad) > d) return 'No hay existencia suficiente de ' + lista[i].producto + ' (disponible ' + bsN(d) + ', pides ' + bsN(lista[i].cantidad) + ').';
    if (!(Number(lista[i].cantidad) > 0)) return 'La cantidad de ' + lista[i].producto + ' debe ser mayor que 0.';
  }
  return '';
}

// ══════════════════ SALIDAS ══════════════════
function bsRenderSalidas() {
  var b = BS.bodega;
  var h = '';
  if (!b.inicial_aplicado) {
    h += '<div class="bs-banner">🔒 Las salidas están bloqueadas hasta que la bodega aplique su conteo inicial.</div>';
  }
  h += '<div class="bs-card"><h3>📤 Nueva salida <small>documento propio ' + escHtml('BOD-' + b.codigo + '-RS-0001') + ' · baja la existencia al registrarla</small></h3>' +
       '<div class="bs-row"><div style="flex:2 1 240px"><label class="ef-label">Destinatario *</label><input class="ef" id="bs-sal-dest" maxlength="150" placeholder="Cliente / persona que recibe"></div>' +
       '<div style="flex:0 0 160px"><label class="ef-label">Fecha</label><input class="ef" id="bs-sal-fecha" type="date" value="' + bsHoy() + '" min="' + escHtml(b.fecha_corte) + '" max="' + bsHoy() + '"></div></div>' +
       '<div id="bs-ln-sal">' + bsLineasHtml('sal', { soloStock: true }) + '</div>' +
       '<div style="margin-top:10px"><label class="ef-label">Observaciones</label><textarea class="ef" id="bs-sal-obs" maxlength="300" placeholder="Opcional"></textarea></div>' +
       '<div style="margin-top:12px"><button class="bs-btn" data-act="sal-guardar"' + (b.inicial_aplicado ? '' : ' disabled') + '>📤 Registrar salida y generar PDF</button></div></div>';

  var docs = bsAgruparDocs('SALIDA_DESPACHO');
  h += '<div class="bs-card"><h3>🗂️ Historial de salidas <small>' + docs.length + ' documento(s)</small></h3>';
  if (!docs.length) h += '<div class="empty">Aún no hay salidas registradas.</div>';
  else {
    h += '<div class="bs-tblwrap"><table><thead><tr><th>Documento</th><th>Fecha</th><th>Destinatario</th><th class="bs-num">Productos</th><th class="bs-num">Unidades</th><th>Estado</th><th></th></tr></thead><tbody>' +
      docs.map(function (d) {
        var anul = d.estado === 'Anulado';
        return '<tr' + (anul ? ' style="opacity:.6"' : '') + '><td><strong>' + escHtml(d.documento) + '</strong></td><td>' + escHtml(fmtDate(d.fecha)) + '</td><td>' + escHtml(d.contraparte) + '</td>' +
          '<td class="bs-num">' + d.lineas.length + '</td><td class="bs-num">' + bsN(d.total) + '</td>' +
          '<td>' + (anul ? bsBadge('Anulada', 'bs-gry') + '<div class="bs-muted">' + escHtml(d.motivo || '') + '</div>' : bsBadge('Activa', 'bs-ok')) + '</td>' +
          '<td><div class="bs-act"><button class="bs-btn bs-sec bs-sm" data-act="sal-pdf" data-doc="' + escHtml(d.documento) + '">📄 PDF</button>' +
          (anul ? '' : '<button class="bs-btn bs-red bs-sm" data-act="sal-anular" data-doc="' + escHtml(d.documento) + '">Anular</button>') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  h += '</div>';
  bsEl('bs-panel-salidas').innerHTML = h;
}

// Agrupa las filas del Kardex por documento (salidas o traslados enviados).
function bsAgruparDocs(tipo) {
  var map = {}, orden = [];
  (BS.kardex || []).filter(function (r) { return r.tipo === tipo; }).forEach(function (r) {
    var d = map[r.documento];
    if (!d) { d = map[r.documento] = { documento: r.documento, fecha: r.fecha, contraparte: r.contraparte, observaciones: r.observaciones, usuario: r.creado_por_nombre, estado: 'Anulado', motivo: '', lineas: [], total: 0 }; orden.push(d); }
    d.lineas.push({ producto: r.producto, presentacion: r.presentacion, cantidad: r.cantidad });
    if (r.estado === 'Activo') { d.estado = 'Activo'; d.total += Number(r.cantidad); }
    else d.motivo = r.motivo_anulacion || d.motivo;
  });
  return orden.sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)) || String(b.documento).localeCompare(String(a.documento)); });
}

async function bsGuardarSalida(btn) {
  var dest = bsEl('bs-sal-dest').value.trim();
  var lista = BS.listas.sal;
  if (dest.length < 3) { showToast('Escribe el destinatario (mínimo 3 caracteres).', '#e67e22'); bsEl('bs-sal-dest').focus(); return; }
  if (!lista.length) { showToast('Agrega al menos un producto.', '#e67e22'); return; }
  var err = bsValidarExistencia(lista);
  if (err) { showToast(err, '#e67e22', 6000); return; }
  var fecha = bsEl('bs-sal-fecha').value || bsHoy();
  var obs = bsEl('bs-sal-obs').value.trim();
  var ok = await bsConfirmar('Registrar salida',
    '<p>Salida a <strong>' + escHtml(dest) + '</strong> · ' + lista.length + ' producto(s) · ' + bsN(lista.reduce(function (s, l) { return s + Number(l.cantidad); }, 0)) + ' unidades.</p>' +
    '<p class="bs-muted" style="margin-top:8px">Baja la existencia de la bodega ahora. Si te equivocas puedes anular el documento con un motivo.</p>');
  if (!ok) return;
  await bsAccion(btn, async function () {
    var d = await bodegaRpc('bodega_registrar_salida', {
      p_bodega: BS.bodega.bodega_id, p_destinatario: dest,
      p_lineas: lista.map(function (l) { return { producto: l.producto, presentacion: l.presentacion, cantidad: Number(l.cantidad) }; }),
      p_obs: obs, p_fecha: fecha
    });
    BS.listas.sal = [];
    bsOk('✅ Salida ' + d.documento + ' registrada');
    bsPdfSalida(d);
    await bsCargarBodega();
  });
}

async function bsAnularSalida(btn, doc) {
  var motivo = await bsPedirTexto('Anular salida ' + doc, 'Motivo de la anulación', 5, 'Anular salida');
  if (!motivo) return;
  await bsAccion(btn, async function () {
    await bodegaRpc('bodega_anular_documento', { p_bodega: BS.bodega.bodega_id, p_documento: doc, p_motivo: motivo });
    bsOk('✅ Salida ' + doc + ' anulada: las unidades volvieron a la existencia');
    await bsCargarBodega();
  });
}

// ══════════════════ PDF ══════════════════
function bsPdfDisponible() {
  if (typeof generarRemisionPDF !== 'function' || !window.jspdf) {
    showToast('La librería de PDF todavía no cargó; espera unos segundos e intenta de nuevo.', '#e67e22', 5000);
    return false;
  }
  return true;
}

function bsPdfSalida(d) {
  if (!bsPdfDisponible()) return;
  var bod = d.bodega || {};
  try {
    generarRemisionPDF({
      empresa: d.empresa, consecutivo: d.documento, ref_label: null,
      doc_title: 'REMISION DE SALIDA - BODEGA', doc_number: d.documento,
      date_label: 'Fecha', fecha_entrega: fmtDate(d.fecha),
      left_fields: [['Destinatario', d.destinatario], ['Bodega', (bod.nombre || '') + ' (' + (bod.codigo || '') + ')'], ['Emitido por', d.usuario || '']],
      right_fields: [['Municipio', bod.municipio || ''], ['Departamento', bod.departamento || ''], ['Empresa', getSigla(d.empresa)]],
      entregas: (d.lineas || []).map(function (l) { return { producto: l.producto, presentacion: l.presentacion, cantidad: l.cantidad }; }),
      qty_header: 'Cantidad', last_col_header: 'Observaciones', observaciones: d.observaciones || '',
      file_prefix: 'Salida', copies: ['ORIGINAL - BODEGA', 'COPIA - DESTINATARIO', 'COPIA - BODEGA']
    });
  } catch (e) { bsErr(e); }
}

function bsPdfTraslado(t) {
  if (!bsPdfDisponible()) return;
  var o = t.origen || {}, d = t.destino || {};
  try {
    generarRemisionPDF({
      empresa: t.empresa, consecutivo: t.consecutivo, ref_label: null,
      doc_title: 'TRASLADO ENTRE BODEGAS', doc_number: t.consecutivo,
      date_label: 'Fecha', fecha_entrega: fmtDate(t.fecha),
      left_fields: [['Bodega origen', (o.nombre || '') + (o.municipio ? ' · ' + o.municipio : '') + ' (' + (o.codigo || '') + ')'], ['Bodega destino', (d.nombre || '') + (d.municipio ? ' · ' + d.municipio : '') + ' (' + (d.codigo || '') + ')'], ['Enviado por', t.enviado_por_nombre || t.usuario || '']],
      right_fields: [['Empresa', getSigla(t.empresa)], ['Estado', t.estado || ''], ['Dep. destino', d.departamento || '']],
      entregas: (t.lineas || []).map(function (l) { return { producto: l.producto, presentacion: l.presentacion, cantidad: l.enviada != null ? l.enviada : l.cantidad }; }),
      qty_header: 'Cantidad enviada', last_col_header: 'Observaciones', observaciones: t.observaciones || '',
      file_prefix: 'Traslado', copies: ['ORIGINAL - BODEGA ORIGEN', 'COPIA - BODEGA DESTINO', 'COPIA - TRANSPORTE']
    });
  } catch (e) { bsErr(e); }
}

function bsPdfSalidaHistorial(doc) {
  var d = bsAgruparDocs('SALIDA_DESPACHO').filter(function (x) { return x.documento === doc; })[0];
  if (!d) return;
  var b = BS.bodega;
  bsPdfSalida({
    documento: d.documento, fecha: d.fecha, empresa: b.empresa,
    bodega: { codigo: b.codigo, nombre: b.nombre, municipio: b.municipio, departamento: b.departamento },
    destinatario: d.contraparte, observaciones: d.observaciones, usuario: d.usuario, lineas: d.lineas
  });
}

// ══════════════════ TRASLADOS ENTRE BODEGAS ══════════════════
function bsRenderTraslados() {
  var b = BS.bodega;
  var h = '';
  h += '<div class="bs-card"><h3>🚚 Nuevo traslado a otra bodega <small>solo entre bodegas de la misma empresa · va en tránsito hasta que el destino confirme lo recibido</small></h3>';
  if (!b.inicial_aplicado) h += '<div class="bs-banner">🔒 Aplica primero el conteo inicial de esta bodega para poder trasladar.</div>';
  if (!BS.destinos.length) {
    h += '<div class="empty">No hay otras bodegas habilitadas de la misma empresa (' + escHtml(bsSiglaEmpresa()) + '). Para pasar mercancía a otra empresa usa la principal (orden de compra de traslado).</div>';
  } else {
    h += '<div class="bs-row"><div style="flex:2 1 260px"><label class="ef-label">Bodega destino *</label><select class="ef" id="bs-tr-dest"><option value="">— Elegir —</option>' +
      BS.destinos.map(function (d) {
        return '<option value="' + d.bodega_id + '"' + (d.inicial_aplicado ? '' : ' disabled') + '>' + escHtml(bsBodegaNombre(d)) + ' (' + escHtml(d.codigo) + ')' + (d.inicial_aplicado ? '' : ' — sin conteo inicial') + '</option>';
      }).join('') + '</select></div>' +
      '<div style="flex:0 0 160px"><label class="ef-label">Fecha</label><input class="ef" id="bs-tr-fecha" type="date" value="' + bsHoy() + '" min="' + escHtml(b.fecha_corte) + '" max="' + bsHoy() + '"></div></div>' +
      '<div id="bs-ln-tr">' + bsLineasHtml('tr', { soloStock: true }) + '</div>' +
      '<div style="margin-top:10px"><label class="ef-label">Observaciones</label><textarea class="ef" id="bs-tr-obs" maxlength="300" placeholder="Opcional (transportador, placa, etc.)"></textarea></div>' +
      '<div style="margin-top:12px"><button class="bs-btn" data-act="tr-guardar"' + (b.inicial_aplicado ? '' : ' disabled') + '>🚚 Enviar traslado y generar PDF</button></div>';
  }
  h += '</div>';

  var env = (BS.trasl && BS.trasl.enviados) || [];
  h += '<div class="bs-card"><h3>📤 Enviados <small>' + env.length + '</small></h3>';
  if (!env.length) h += '<div class="empty">No has enviado traslados.</div>';
  else h += '<div class="bs-tblwrap"><table><thead><tr><th>Traslado</th><th>Fecha</th><th>Destino</th><th>Productos</th><th>Estado</th><th></th></tr></thead><tbody>' +
    env.map(function (t) {
      var tot = t.lineas.reduce(function (s, l) { return s + Number(l.enviada); }, 0);
      var rec = t.lineas.reduce(function (s, l) { return s + Number(l.recibida); }, 0);
      return '<tr><td><strong>' + escHtml(t.consecutivo) + '</strong></td><td>' + escHtml(fmtDate(t.fecha)) + '</td><td>' + escHtml(bsBodegaNombre(t.destino)) + '</td>' +
        '<td>' + t.lineas.length + ' producto(s) · ' + bsN(tot) + ' ud' + (t.estado === 'Recibido' || t.estado === 'Recibido con diferencia' ? ' · recibido ' + bsN(rec) : '') + '</td>' +
        '<td>' + bsEstadoTraslado(t.estado) + (t.estado === 'Cancelado' && t.motivo_cancelacion ? '<div class="bs-muted">' + escHtml(t.motivo_cancelacion) + '</div>' : '') +
        (t.obs_recepcion ? '<div class="bs-muted">Obs. del destino: ' + escHtml(t.obs_recepcion) + '</div>' : '') + '</td>' +
        '<td><div class="bs-act"><button class="bs-btn bs-sec bs-sm" data-act="tr-pdf" data-id="' + t.id + '" data-src="enviados">📄 PDF</button>' +
        (t.estado === 'En tránsito' ? '<button class="bs-btn bs-red bs-sm" data-act="tr-cancelar" data-id="' + t.id + '">Cancelar</button>' : '') + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
  h += '</div>';

  var rcb = ((BS.trasl && BS.trasl.recibidos) || []).filter(function (t) { return t.estado !== 'En tránsito'; });
  h += '<div class="bs-card"><h3>📥 Recibidos de otras bodegas <small>historial · los que están en tránsito se reciben en «Por recibir»</small></h3>';
  if (!rcb.length) h += '<div class="empty">Aún no has recibido traslados de otras bodegas.</div>';
  else h += '<div class="bs-tblwrap"><table><thead><tr><th>Traslado</th><th>Fecha</th><th>Origen</th><th>Enviado</th><th>Recibido</th><th>Estado</th></tr></thead><tbody>' +
    rcb.map(function (t) {
      var tot = t.lineas.reduce(function (s, l) { return s + Number(l.enviada); }, 0);
      var rec = t.lineas.reduce(function (s, l) { return s + Number(l.recibida); }, 0);
      return '<tr><td><strong>' + escHtml(t.consecutivo) + '</strong></td><td>' + escHtml(fmtDate(t.fecha)) + '</td><td>' + escHtml(bsBodegaNombre(t.origen)) + '</td><td class="bs-num">' + bsN(tot) + '</td><td class="bs-num">' + bsN(rec) + '</td><td>' + bsEstadoTraslado(t.estado) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  h += '</div>';
  bsEl('bs-panel-trasl').innerHTML = h;
}

async function bsGuardarTraslado(btn) {
  var dest = Number(bsEl('bs-tr-dest').value);
  var lista = BS.listas.tr;
  if (!dest) { showToast('Elige la bodega de destino.', '#e67e22'); return; }
  if (!lista.length) { showToast('Agrega al menos un producto.', '#e67e22'); return; }
  var err = bsValidarExistencia(lista);
  if (err) { showToast(err, '#e67e22', 6000); return; }
  var d = BS.destinos.filter(function (x) { return x.bodega_id === dest; })[0];
  var ok = await bsConfirmar('Enviar traslado',
    '<p>Traslado a <strong>' + escHtml(d ? bsBodegaNombre(d) : '') + '</strong> · ' + lista.length + ' producto(s) · ' + bsN(lista.reduce(function (s, l) { return s + Number(l.cantidad); }, 0)) + ' unidades.</p>' +
    '<p class="bs-muted" style="margin-top:8px">Baja la existencia de esta bodega ahora y queda <strong>en tránsito</strong> hasta que el destino confirme lo recibido. Puedes cancelarlo mientras siga en tránsito.</p>');
  if (!ok) return;
  await bsAccion(btn, async function () {
    var t = await bodegaRpc('bodega_crear_traslado_bodega', {
      p_origen: BS.bodega.bodega_id, p_destino: dest,
      p_lineas: lista.map(function (l) { return { producto: l.producto, presentacion: l.presentacion, cantidad: Number(l.cantidad) }; }),
      p_obs: bsEl('bs-tr-obs').value.trim(), p_fecha: bsEl('bs-tr-fecha').value || bsHoy()
    });
    BS.listas.tr = [];
    bsOk('✅ Traslado ' + t.consecutivo + ' enviado (en tránsito)');
    bsPdfTraslado(t);
    await bsCargarBodega();
  });
}

async function bsCancelarTraslado(btn, id) {
  var t = ((BS.trasl && BS.trasl.enviados) || []).filter(function (x) { return String(x.id) === String(id); })[0];
  var motivo = await bsPedirTexto('Cancelar traslado ' + (t ? t.consecutivo : ''), 'Motivo de la cancelación', 5, 'Cancelar traslado');
  if (!motivo) return;
  await bsAccion(btn, async function () {
    await bodegaRpc('bodega_cancelar_traslado_bodega', { p_traslado_id: Number(id), p_motivo: motivo });
    bsOk('✅ Traslado cancelado: las unidades volvieron a esta bodega');
    await bsCargarBodega();
  });
}

// ══════════════════ CONTEOS Y AJUSTES ══════════════════
function bsRenderConteos() {
  var b = BS.bodega;
  var h = '';
  if (!b.inicial_aplicado) {
    h += '<div class="bs-card" style="border-color:#f6ad55"><h3>🧮 Conteo inicial <small>fecha de corte: ' + escHtml(fmtDate(b.fecha_corte)) + '</small></h3>' +
         '<p style="font-size:0.86rem;color:#4a5568;margin-bottom:12px">Cuenta físicamente lo que hay en la bodega a la fecha de corte y regístralo. Es el saldo de partida: los traslados anteriores a esa fecha se asumen incluidos en el conteo. Solo hay un conteo inicial por bodega.</p>' +
         '<button class="bs-btn" data-act="cnt-nuevo" data-tipo="INICIAL">🧮 Iniciar conteo inicial</button></div>';
  } else {
    h += '<div class="bs-card"><h3>🧮 Conteos periódicos y ajustes</h3><p style="font-size:0.86rem;color:#4a5568;margin-bottom:12px">Compara lo contado con el sistema: al aplicar, la diferencia queda como ajuste (sobrante o faltante). Los productos que no incluyas no se tocan.</p>' +
         '<button class="bs-btn" data-act="cnt-nuevo" data-tipo="PERIODICO">➕ Nuevo conteo periódico</button></div>';
  }
  h += '<div class="bs-card"><h3>🗂️ Conteos <small>' + BS.conteos.length + '</small></h3>';
  if (!BS.conteos.length) h += '<div class="empty">Aún no hay conteos.</div>';
  else h += '<div class="bs-tblwrap"><table><thead><tr><th>N.º</th><th>Fecha</th><th>Tipo</th><th class="bs-num">Líneas</th><th class="bs-num">Con diferencia</th><th>Estado</th><th></th></tr></thead><tbody>' +
    BS.conteos.map(function (c) {
      return '<tr><td>' + c.id + '</td><td>' + escHtml(fmtDate(c.fecha)) + '</td><td>' + (c.tipo === 'INICIAL' ? bsBadge('Inicial', 'bs-inf') : bsBadge('Periódico', 'bs-gry')) + '</td>' +
        '<td class="bs-num">' + c.lineas + '</td><td class="bs-num">' + (c.tipo === 'PERIODICO' ? c.diferencias : '—') + '</td>' +
        '<td>' + (c.estado === 'Aplicado' ? bsBadge('Aplicado', 'bs-ok') : bsBadge('Borrador', 'bs-warn')) + '</td>' +
        '<td><button class="bs-btn bs-sec bs-sm" data-act="cnt-abrir" data-id="' + c.id + '">' + (c.estado === 'Aplicado' ? 'Ver' : 'Continuar') + '</button></td></tr>';
    }).join('') + '</tbody></table></div>';
  h += '</div>';
  bsEl('bs-panel-conteos').innerHTML = h;
}

function bsCntHtml() {
  var c = BS.cnt;
  var editable = c.estado !== 'Aplicado';
  var h = '<div class="bs-row"><div style="flex:0 0 170px"><label class="ef-label">Fecha del conteo</label><input class="ef" id="bs-cnt-fecha" type="date" value="' + escHtml(c.fecha) + '"' + ((c.tipo === 'INICIAL' || !editable) ? ' disabled' : ' min="' + escHtml(BS.bodega.fecha_corte) + '" max="' + bsHoy() + '"') + '></div>' +
          '<div style="flex:2 1 240px"><label class="ef-label">Observaciones</label><input class="ef" id="bs-cnt-obs" maxlength="300" value="' + escHtml(c.obs || '') + '"' + (editable ? '' : ' disabled') + '></div></div>';
  if (c.tipo === 'INICIAL') h += '<p class="bs-muted" style="margin-bottom:10px">Conteo inicial: usa la fecha de corte de la bodega. Registra solo lo que hay físicamente.</p>';
  if (editable) h += '<div id="bs-ln-cnt">' + bsLineasHtml('cnt', { conteo: true, precarga: c.tipo === 'PERIODICO' }) + '</div>';
  else h += '<div class="bs-tblwrap"><table><thead><tr><th>Producto</th><th class="bs-num">Sistema</th><th class="bs-num">Físico</th><th class="bs-num">Diferencia</th></tr></thead><tbody>' +
    BS.listas.cnt.map(function (l) { var d = Number(l.cantidad) - Number(l.sistema || 0); return '<tr><td>' + escHtml(l.producto) + '</td><td class="bs-num">' + bsN(l.sistema) + '</td><td class="bs-num">' + bsN(l.cantidad) + '</td><td class="bs-num">' + (d > 0 ? '+' : '') + bsN(d) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  return h;
}

function bsCntModal() {
  var c = BS.cnt;
  var editable = c.estado !== 'Aplicado';
  var titulo = (c.tipo === 'INICIAL' ? '🧮 Conteo inicial' : '🧮 Conteo periódico') + (c.id ? ' #' + c.id : ' (nuevo)') + (editable ? '' : ' — aplicado');
  var btns = [{ id: 'cerrar', label: 'Cerrar', cls: 'btn-cancel' }];
  if (editable) {
    btns.push({ id: 'guardar', label: '💾 Guardar borrador', cls: 'btn-cancel', onClick: function () { bsCntGuardar(false); } });
    btns.push({ id: 'aplicar', label: '✅ Aplicar conteo', cls: 'btn-confirm', onClick: function () { bsCntGuardar(true); } });
  }
  bsModal(titulo, bsCntHtml(), btns);
}

function bsCntRefrescarLineas() {
  var cont = bsEl('bs-ln-cnt');
  if (cont) cont.innerHTML = bsLineasHtml('cnt', { conteo: true, precarga: BS.cnt.tipo === 'PERIODICO' });
}

function bsCntNuevo(tipo) {
  BS.cnt = { id: null, tipo: tipo, fecha: tipo === 'INICIAL' ? BS.bodega.fecha_corte : bsHoy(), obs: '', estado: 'Borrador' };
  BS.listas.cnt = [];
  bsCntModal();
}

async function bsCntAbrir(id) {
  try {
    var d = await bodegaRpc('bodega_conteos', { p_bodega: BS.bodega.bodega_id, p_conteo_id: Number(id) });
    BS.cnt = { id: d.conteo.id, tipo: d.conteo.tipo, fecha: d.conteo.fecha, obs: d.conteo.observaciones || '', estado: d.conteo.estado };
    BS.listas.cnt = d.lineas.map(function (l) { return { producto: l.producto, presentacion: l.presentacion, cantidad: Number(l.cant_fisica), sistema: Number(l.cant_sistema) }; });
    bsCntModal();
  } catch (e) { bsErr(e); }
}

function bsCntPrecargar() {
  var items = (BS.exist && BS.exist.items) || [];
  if (!items.length) { showToast('No hay existencias para precargar.', '#e67e22'); return; }
  items.forEach(function (i) {
    var k = bsNorm(i.producto);
    if (!BS.listas.cnt.some(function (l) { return bsNorm(l.producto) === k; })) {
      BS.listas.cnt.push({ producto: i.producto, presentacion: i.presentacion || '', cantidad: Number(i.existencia), sistema: Number(i.existencia) });
    }
  });
  bsCntRefrescarLineas();
  showToast('Precargado con las existencias del sistema: corrige lo que difiera del conteo físico.', '#1a5276', 5000);
}

async function bsCntGuardar(aplicar) {
  var c = BS.cnt;
  if (BS.busy) return;
  var lista = BS.listas.cnt;
  if (!lista.length) { showToast('Agrega al menos un producto al conteo.', '#e67e22'); return; }
  for (var i = 0; i < lista.length; i++) {
    var n = Number(lista[i].cantidad);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) { showToast('Cantidad no válida en ' + lista[i].producto + ' (entero, 0 o más).', '#e67e22'); return; }
  }
  var fecha = bsEl('bs-cnt-fecha').value;
  var obs = bsEl('bs-cnt-obs').value.trim();
  if (!fecha) { showToast('Indica la fecha del conteo.', '#e67e22'); return; }
  c.fecha = fecha; c.obs = obs;   // lo escrito en el formulario sobrevive si se cancela la confirmación
  if (aplicar) {
    var difs = lista.filter(function (l) { return Number(l.cantidad) !== Number(l.sistema || 0); }).length;
    var ok = await bsConfirmar('Aplicar conteo',
      c.tipo === 'INICIAL'
        ? '<p>Se registrará el <strong>saldo inicial</strong> de la bodega con ' + lista.filter(function (l) { return Number(l.cantidad) > 0; }).length + ' producto(s). Después no se puede editar (se corrige con conteos periódicos y ajustes).</p>'
        : '<p>Se aplicarán ajustes de <strong>' + difs + '</strong> producto(s) con diferencia contra el sistema. Los demás productos no se tocan.</p>',
      'Aplicar');
    if (!ok) { bsCntModal(); return; }   // cancelar la confirmación vuelve al editor (el modal es uno solo)
  }
  BS.busy = true;
  try {
    var r = await bodegaRpc('bodega_guardar_conteo', {
      p_bodega: BS.bodega.bodega_id, p_conteo_id: c.id, p_tipo: c.tipo, p_fecha: fecha,
      p_lineas: lista.map(function (l) { return { producto: l.producto, presentacion: l.presentacion, cantidad: Number(l.cantidad) }; }), p_obs: obs
    });
    c.id = r.conteo_id; c.fecha = fecha; c.obs = obs;
    if (aplicar) {
      var a = await bodegaRpc('bodega_aplicar_conteo', { p_conteo_id: c.id });
      bsCerrarModal();
      bsOk(c.tipo === 'INICIAL' ? '✅ Conteo inicial aplicado: ya puedes registrar salidas y traslados' : '✅ Conteo aplicado (' + a.sobrantes + ' sobrante(s), ' + a.faltantes + ' faltante(s))');
    } else {
      bsOk('💾 Borrador guardado');
    }
    BS.busy = false;
    await bsCargarBodega();
  } catch (e) {
    BS.busy = false; bsErr(e);
    if (!bsEl('bs-overlay').classList.contains('show')) bsCntModal();   // si falló tras la confirmación, se vuelve al editor
  }
}

// ══════════════════ KARDEX / MOVIMIENTOS ══════════════════
function bsRenderKardex() {
  var tipos = Object.keys(BS_TIPOS);
  var h = '<div class="filters">' +
    '<div class="fg"><label>Producto</label><input class="ef" id="bs-kx-prod" list="bs-dl-all" placeholder="Todos" style="min-width:230px"></div>' +
    '<div class="fg"><label>Tipo</label><select id="bs-kx-tipo"><option value="">Todos</option>' + tipos.map(function (t) { return '<option value="' + t + '">' + escHtml(BS_TIPOS[t].txt) + '</option>'; }).join('') + '</select></div>' +
    '<div class="fg"><label>Desde</label><input class="ef" id="bs-kx-desde" type="date"></div>' +
    '<div class="fg"><label>Hasta</label><input class="ef" id="bs-kx-hasta" type="date"></div>' +
    '<div class="fg"><label>&nbsp;</label><label style="font-size:0.82rem;display:flex;gap:6px;align-items:center;text-transform:none"><input type="checkbox" id="bs-kx-anul"> Incluir anulados</label></div>' +
    '<button class="bs-btn bs-sec" style="margin-left:auto" data-act="kx-excel">⬇ Exportar Excel</button></div>' +
    '<div class="card"><div class="card-head"><h3>📋 Movimientos de ' + escHtml(bsBodegaNombre(BS.bodega)) + ' <span id="bs-kx-ct" class="bs-muted"></span></h3></div>' +
    '<div class="bs-tblwrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Documento</th><th>Contraparte</th><th class="bs-num">Cantidad</th><th class="bs-num">Saldo</th><th></th></tr></thead><tbody id="bs-kx-body"></tbody></table></div>' +
    '<p class="bs-muted" style="margin-top:10px">El saldo es el corrido del producto (solo movimientos activos). Nada se borra: lo anulado se muestra tachado si activas «Incluir anulados».</p></div>';
  bsEl('bs-panel-kardex').innerHTML = h;
  bsFiltrarKardex();
}

function bsKardexFiltrado() {
  var prod = bsEl('bs-kx-prod') ? bsNorm(bsEl('bs-kx-prod').value) : '';
  var tipo = bsEl('bs-kx-tipo') ? bsEl('bs-kx-tipo').value : '';
  var desde = bsEl('bs-kx-desde') ? bsEl('bs-kx-desde').value : '';
  var hasta = bsEl('bs-kx-hasta') ? bsEl('bs-kx-hasta').value : '';
  var anul = bsEl('bs-kx-anul') && bsEl('bs-kx-anul').checked;
  return (BS.kardex || []).filter(function (r) {
    if (!anul && r.estado !== 'Activo') return false;
    if (prod && bsNorm(r.producto).indexOf(prod) < 0) return false;
    if (tipo && r.tipo !== tipo) return false;
    if (desde && String(r.fecha) < desde) return false;
    if (hasta && String(r.fecha) > hasta) return false;
    return true;
  }).sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id; });
}

function bsFiltrarKardex() {
  var filas = bsKardexFiltrado();
  var tb = bsEl('bs-kx-body');
  if (!tb) return;
  tb.innerHTML = filas.length ? filas.map(function (r) {
    var t = BS_TIPOS[r.tipo] || { txt: r.tipo, cls: 'bs-gry', signo: 1 };
    var anul = r.estado !== 'Activo';
    var dif = (r.tipo === 'ENTRADA_TRASLADO' || r.tipo === 'ENTRADA_TRASLADO_BODEGA') && r.cant_despachada != null && Number(r.cant_despachada) !== Number(r.cantidad);
    return '<tr' + (anul ? ' style="opacity:.55;text-decoration:line-through"' : '') + '><td style="white-space:nowrap">' + escHtml(fmtDate(r.fecha)) + '</td>' +
      '<td>' + bsBadge(t.txt, t.cls) + '</td><td>' + escHtml(r.producto) + '</td><td>' + escHtml(r.documento || '') + '</td>' +
      '<td>' + escHtml(r.contraparte || '') + (r.observaciones ? '<div class="bs-muted">' + escHtml(r.observaciones) + '</div>' : '') + (anul && r.motivo_anulacion ? '<div class="bs-muted">Anulado: ' + escHtml(r.motivo_anulacion) + '</div>' : '') + '</td>' +
      '<td class="bs-num"><strong style="color:' + (t.signo > 0 ? '#22543d' : '#9b2c2c') + '">' + (t.signo > 0 ? '+' : '−') + bsN(r.cantidad) + '</strong>' + (dif ? '<div class="bs-muted" style="color:#c05621">de ' + bsN(r.cant_despachada) + '</div>' : '') + '</td>' +
      '<td class="bs-num">' + (anul ? '—' : bsN(r.saldo)) + '</td>' +
      '<td>' + (!anul && (r.tipo === 'AJUSTE_SOBRANTE' || r.tipo === 'AJUSTE_FALTANTE') ? '<button class="bs-btn bs-red bs-sm" data-act="mov-anular" data-id="' + r.id + '">Anular</button>' : '') + '</td></tr>';
  }).join('') : '<tr><td colspan="8"><div class="empty">No hay movimientos con los filtros seleccionados.</div></td></tr>';
  bsEl('bs-kx-ct').textContent = '(' + filas.length + ')';
}

function bsExcelKardex() {
  var filas = bsKardexFiltrado().map(function (r) {
    var t = BS_TIPOS[r.tipo] || { txt: r.tipo, signo: 1 };
    return { 'Fecha': r.fecha, 'Tipo': t.txt, 'Producto': r.producto, 'Documento': r.documento || '', 'Contraparte': r.contraparte || '',
             'Cantidad': t.signo * Number(r.cantidad), 'Saldo': r.estado === 'Activo' ? Number(r.saldo) : '', 'Estado': r.estado, 'Observaciones': r.observaciones || '', 'Motivo anulación': r.motivo_anulacion || '' };
  });
  bsExcel('Movimientos_' + BS.bodega.codigo + '_' + bsHoy() + '.xlsx', filas, 'Movimientos');
}

async function bsAnularMovimiento(btn, id) {
  var r = (BS.kardex || []).filter(function (x) { return String(x.id) === String(id); })[0];
  var motivo = await bsPedirTexto('Anular ' + (r ? (BS_TIPOS[r.tipo] || {}).txt + ' de ' + r.producto : 'ajuste'), 'Motivo de la anulación', 5, 'Anular ajuste');
  if (!motivo) return;
  await bsAccion(btn, async function () {
    await bodegaRpc('bodega_anular_movimiento', { p_id: Number(id), p_motivo: motivo });
    bsOk('✅ Ajuste anulado');
    await bsCargarBodega();
  });
}

// ══════════════════ EVENTOS ══════════════════
document.addEventListener('click', function (e) {
  var bm = e.target.closest && e.target.closest('[data-bsbtn]');
  if (bm && _bsModalCb) { var f = _bsModalCb[bm.dataset.bsbtn]; if (f) f(); return; }
  if (e.target === bsEl('bs-overlay')) { return; }   // no se cierra al tocar fuera (evita perder datos)
  var tab = e.target.closest && e.target.closest('#bs-tabs a');
  if (tab) { e.preventDefault(); bsIrTab(tab.dataset.tab); return; }
  var el = e.target.closest && e.target.closest('[data-act]');
  if (!el) return;
  var act = el.dataset.act;
  switch (act) {
    case 'ir-tab': bsIrTab(el.dataset.tab); break;
    case 'ex-excel': bsExcelExist(); break;
    case 'kx-excel': bsExcelKardex(); break;
    case 'rec-rem': bsRecibir(el, 'rem'); break;
    case 'rec-bod': bsRecibir(el, 'bod'); break;
    case 'ln-add': {
      var k = el.dataset.k;
      var opts = k === 'cnt' ? { conteo: true } : { soloStock: true };
      if (bsLineasAgregar(k, opts)) {
        if (k === 'cnt') bsCntRefrescarLineas();
        else bsEl('bs-ln-' + k).innerHTML = bsLineasHtml(k, { soloStock: true });
        var p = bsEl('bs-' + k + '-prod'); if (p) p.focus();
      }
      break;
    }
    case 'ln-del': {
      var k2 = el.dataset.k;
      BS.listas[k2].splice(Number(el.dataset.i), 1);
      if (k2 === 'cnt') bsCntRefrescarLineas(); else bsEl('bs-ln-' + k2).innerHTML = bsLineasHtml(k2, { soloStock: true });
      break;
    }
    case 'cnt-precargar': bsCntPrecargar(); break;
    case 'cnt-nuevo': bsCntNuevo(el.dataset.tipo); break;
    case 'cnt-abrir': bsCntAbrir(el.dataset.id); break;
    case 'sal-guardar': bsGuardarSalida(el); break;
    case 'sal-pdf': bsPdfSalidaHistorial(el.dataset.doc); break;
    case 'sal-anular': bsAnularSalida(el, el.dataset.doc); break;
    case 'tr-guardar': bsGuardarTraslado(el); break;
    case 'tr-cancelar': bsCancelarTraslado(el, el.dataset.id); break;
    case 'tr-pdf': {
      var t = ((BS.trasl && BS.trasl[el.dataset.src]) || []).filter(function (x) { return String(x.id) === el.dataset.id; })[0];
      if (t) bsPdfTraslado(t);
      break;
    }
    case 'mov-anular': bsAnularMovimiento(el, el.dataset.id); break;
  }
});

document.addEventListener('input', function (e) {
  var t = e.target;
  if (t.id === 'bs-ex-q') { bsFiltrarExist(); return; }
  if (t.id === 'bs-kx-prod' || t.id === 'bs-kx-desde' || t.id === 'bs-kx-hasta') { bsFiltrarKardex(); return; }
  if (t.classList && t.classList.contains('bs-rec-in')) { bsRevisarDiferencia(t.closest('.bs-rem')); return; }
  if (t.dataset && t.dataset.actInput === 'ln-qty') {
    var k = t.dataset.k, i = Number(t.dataset.i);
    if (BS.listas[k][i]) BS.listas[k][i].cantidad = t.value === '' ? '' : Number(t.value);
    // Refresca solo los totales/diferencias sin perder el foco: se re-renderiza al salir del campo.
  }
});
document.addEventListener('change', function (e) {
  var t = e.target;
  if (t.id === 'bs-kx-tipo' || t.id === 'bs-kx-anul') { bsFiltrarKardex(); return; }
  if (t.dataset && t.dataset.actInput === 'ln-qty') {
    var k = t.dataset.k;
    if (k === 'cnt') bsCntRefrescarLineas(); else bsEl('bs-ln-' + k).innerHTML = bsLineasHtml(k, { soloStock: true });
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target && (e.target.id === 'bs-sal-prod' || e.target.id === 'bs-sal-qty' || e.target.id === 'bs-tr-prod' || e.target.id === 'bs-tr-qty' || e.target.id === 'bs-cnt-prod' || e.target.id === 'bs-cnt-qty')) {
    e.preventDefault();
    var k = e.target.id.split('-')[1];
    var b = document.querySelector('[data-act="ln-add"][data-k="' + k + '"]');
    if (b) b.click();
  }
  if (e.key === 'Escape' && bsEl('bs-overlay').classList.contains('show') && _bsModalCb && _bsModalCb.no) _bsModalCb.no();
});

// ══════════════════ ARRANQUE ══════════════════
function bsMostrarError(msg) {
  bsEl('load-spinner').style.display = 'none';
  bsEl('load-error').textContent = msg;
  bsEl('btn-retry').style.display = '';
}

function bsElegirBodega(id) {
  var b = BS.ctx.bodegas.filter(function (x) { return String(x.bodega_id) === String(id); })[0] || BS.ctx.bodegas[0];
  BS.bodega = b;
  try { localStorage.setItem('bodega-sel', String(b.bodega_id)); } catch (e) { /* sin almacenamiento */ }
  BS.listas = { sal: [], tr: [], cnt: [] };
  bsEl('bs-sub').textContent = getSigla(b.empresa) + ' · ' + bsBodegaNombre(b) + ' (' + b.codigo + ')';
  document.title = 'Bodega ' + b.codigo + ' – Inventario';
}

async function bsInit() {
  try {
    var ctx = await bodegaGuardia();
    if (!ctx) return;
    BS.ctx = ctx;
    bsEl('load-zone').style.display = 'none';
    if (!ctx.bodegas.length) {
      bsEl('bs-user').style.display = 'flex';
      bsEl('bs-user-nombre').textContent = ctx.usuario.nombre;
      var main = bsEl('main'); main.style.display = 'block';
      main.innerHTML = '<div class="bs-sinacc"><div style="font-size:2.4rem">📭</div><h2 style="margin:8px 0">Sin bodegas asignadas</h2><p style="color:#4a5568;font-size:0.9rem">Tu usuario no tiene ninguna bodega habilitada. Pide al administrador que te asigne una.</p></div>';
      return;
    }
    bsEl('bs-user').style.display = 'flex';
    bsEl('bs-user-nombre').textContent = ctx.usuario.nombre;
    var sel = bsEl('bs-bodega-sel');
    if (ctx.bodegas.length > 1) {
      sel.innerHTML = ctx.bodegas.map(function (b) { return '<option value="' + b.bodega_id + '">' + escHtml(bsBodegaNombre(b) + ' (' + b.codigo + ')') + '</option>'; }).join('');
      sel.style.display = '';
    }
    var guardada = null;
    try { guardada = localStorage.getItem('bodega-sel'); } catch (e) { guardada = null; }
    bsElegirBodega(guardada);
    if (ctx.bodegas.length > 1) sel.value = String(BS.bodega.bodega_id);
    bsEl('bs-tabs').style.display = 'flex';
    bsEl('main').style.display = 'block';

    BS.productos = await bodegaRpc('bodega_productos');
    await bsCargarBodega();
  } catch (e) {
    if (e && e.sinAcceso) {
      bsEl('load-zone').style.display = 'none';
      bsEl('bs-sinacceso').style.display = '';
    } else {
      bsEl('load-zone').style.display = '';
      bsMostrarError((e && e.message) || String(e));
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  bsEl('bs-btn-salir').addEventListener('click', function () { bodegaCerrarSesion(); });
  bsEl('bs-btn-refrescar').addEventListener('click', function () { bsRefrescar(false); });
  bsEl('bs-modal-x').addEventListener('click', function () { if (_bsModalCb && _bsModalCb.no) _bsModalCb.no(); else bsCerrarModal(); });
  bsEl('bs-bodega-sel').addEventListener('change', async function () {
    bsElegirBodega(this.value);
    try { await bsCargarBodega(); } catch (e) { bsErr(e); }
  });
  try {
    _sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT') location.replace(BODEGA_LOGIN); });
  } catch (e) { /* sin listener */ }
  if (!window.__BS_TEST) bsInit();
});
