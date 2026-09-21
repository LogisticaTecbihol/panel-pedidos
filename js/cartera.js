// ══════════════════════════════════════════════════════════════
// Cartera — bandeja de aprobaciones y bloqueos por crédito
// ══════════════════════════════════════════════════════════════
// Lee Pedidos y ClientesUnicos (el rol 'cartera' tiene SELECT en ambos) y
// escribe con las RPC que ya usa Pedidos: bloquear_pedido_cartera,
// resolver_aprobacion_pedido, bloquear_cliente_por_nit. No hay saldos ni
// facturas por cobrar en el panel: la "exposición" es una ESTIMACIÓN a partir de
// los pedidos abiertos a crédito (ver _exposicionCredito en shared.js).
//
// derivedEstado2 / derivedStatus se copian de pedidos.js (mismo criterio que
// dashboard.js): si cambian allí, actualizar aquí también.

var CAR_PEND = 'Pendiente de aprobación';
var CAR_BLOQ = 'Bloqueado por cartera';

var CAR_PED_COLS = 'id,Nombre_Empresa,Consecutivo,Cliente,NIT,Comercial,Fecha_Pedido,Plazo_Pago,Estado_2,Estado_Entrega,' +
  'Producto,Presentacion,Cantidad,Cant_Entregada,Valor_Unitario,Valor_Total,Bodega_Consignacion_Id,' +
  'creado_por,creado_por_nombre,creado_en,' +
  'Bloqueo_Observacion,Bloqueo_Por_Nombre,Bloqueo_En,Desbloqueo_Por_Nombre,Desbloqueo_En,' +
  'Aprobacion_Por_Nombre,Aprobacion_En,Aprobacion_Nota';
var CAR_CLI_COLS = 'id,Cliente,Identificacion,Tipo_Identificacion,Nombre_Empresa,Estado,Cupo_Credito,Plazo_Pago,Cliente_Nuevo';

var carOrders = [];        // pedidos agrupados (uno por empresa+consecutivo+cliente)
var carByKey = {};
var carClientes = [];      // ClientesUnicos
var carCliByNit = {};      // nitBase → [registros]
var carCliByName = {};     // nombre normalizado → [registros]
var carTab = 'aprobar';
var carSel = {};           // key → true (selección de la cola)
var carCtxKey = null;      // pedido abierto en el panel de contexto
var carAct = null;         // acción en curso { kind, keys, busy }
var carColaRows = [];      // filas visibles de la cola (para exportar / seleccionar)

// ── Helpers ──────────────────────────────────────────────────
function carKey(emp, con, cli) { return (emp || '') + '||' + String(con || '').trim() + '||' + (cli || ''); }

function carPuedeAprobar() { return typeof AUTH !== 'undefined' && AUTH.canApproveNuevoCliente(); }
function carPuedeBloquear() { return typeof AUTH !== 'undefined' && AUTH.canToggleBloqueoCartera(); }

// Mismo criterio que pedidos.js:derivedEstado2.
function carDerivedEstado2(lines) {
  if (!lines.length) return 'Abierto';
  var vals = lines.map(function(l) { return (l.Estado_2 || 'Abierto').trim(); });
  if (vals.indexOf('Anulado') >= 0) return 'Anulado';
  if (vals.indexOf(CAR_PEND) >= 0) return CAR_PEND;
  if (vals.indexOf(CAR_BLOQ) >= 0) return CAR_BLOQ;
  if (vals.indexOf('Entregado por proveedor') >= 0) return 'Entregado por proveedor';
  if (vals.every(function(v) { return v === 'Cerrado'; })) return 'Cerrado';
  if (vals.every(function(v) { return v === 'Cerrado' || v === 'Alistado'; })) return 'Alistado';
  return 'Abierto';
}

// Mismo criterio que pedidos.js:derivedStatus.
function carDerivedStatus(lines) {
  if (!lines.length) return 'Recibido';
  var fac = 0, ent = 0, ali = 0, par = 0;
  lines.forEach(function(l) {
    var s = norm(l.Estado_Entrega);
    if (s === 'facturado') fac++; else if (s === 'entregado') ent++;
    else if (s === 'alistado') ali++; else if (s === 'parcial') par++;
  });
  var n = lines.length;
  if (fac === n) return 'Facturado';
  if (fac + ent === n) return 'Entregado';
  if (fac + ent + ali === n) return 'Alistado';
  if (fac > 0 || ent > 0 || ali > 0 || par > 0) return 'Parcial';
  return 'Recibido';
}

// Días transcurridos desde una fecha (YYYY-MM-DD) o un timestamp ISO.
function carDias(ts) {
  if (!ts) return null;
  var s = String(ts);
  var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function carDiasHtml(n) {
  if (n == null) return '<span class="car-dias">—</span>';
  var cls = n >= 7 ? 'alert' : n >= 3 ? 'warn' : '';
  return '<span class="car-dias ' + cls + '">' + n + (n === 1 ? ' día' : ' días') + '</span>';
}
function carFmtTs(ts) { return ts ? _fmtAudTs(ts) : '—'; }

// Duración legible entre dos timestamps ("3 h", "2 d 4 h").
function carDuracion(desde, hasta) {
  var a = new Date(desde).getTime(), b = new Date(hasta).getTime();
  if (isNaN(a) || isNaN(b) || b < a) return '—';
  var mins = Math.round((b - a) / 60000);
  if (mins < 60) return Math.max(1, mins) + ' min';
  var h = Math.floor(mins / 60);
  if (h < 24) return h + ' h';
  var d = Math.floor(h / 24);
  return d + ' d' + (h % 24 ? ' ' + (h % 24) + ' h' : '');
}

function carBadge(est2) {
  var cls = est2 === CAR_BLOQ ? 'b-bloqueado' : est2 === CAR_PEND ? 'b-pendiente-aprob' :
    est2 === 'Abierto' ? 'b-abierto' : est2 === 'Alistado' ? 'b-alistado' : est2 === 'Cerrado' ? 'b-cerrado' :
    est2 === 'Entregado por proveedor' ? 'b-entregado-prov' : 'b-anulado';
  return '<span class="badge ' + cls + '">' + escHtml(est2) + '</span>';
}
function carSiglaHtml(emp) {
  return '<span class="sigla-badge ' + getSiglaClass(emp) + '" title="' + escHtml(emp || '') + '">' + escHtml(getSigla(emp)) + '</span>';
}

// ── Agrupación de líneas en pedidos ──────────────────────────
function carBuildOrders(ped) {
  var map = {};
  ped.forEach(function(p) {
    if (p.Nombre_Empresa === 'Nombre_Empresa' || p.Cliente === 'Cliente') return;   // encabezados repetidos
    if (p.Bodega_Consignacion_Id) return;                                           // traslados a bodega: no son ventas a cliente
    var key = carKey(p.Nombre_Empresa, p.Consecutivo, p.Cliente);
    if (!map[key]) map[key] = { key: key, lines: [] };
    map[key].lines.push(p);
  });

  return Object.keys(map).map(function(k) {
    var o = map[k];
    var L = o.lines;
    var f = L[0];
    o.empresa = f.Nombre_Empresa || '';
    o.consecutivo = f.Consecutivo || '—';
    o.cliente = (f.Cliente || '—').trim();
    o.nit = (L.filter(function(l) { return l.NIT; })[0] || f).NIT || '';
    o.nitBase = _nitBase(o.nit);
    o.idCli = o.nitBase || ('n:' + norm(o.cliente));
    o.comercial = ((L.filter(function(l) { return l.Comercial; })[0] || f).Comercial || '').trim();
    var conPlazo = L.filter(function(l) { return String(l.Plazo_Pago || '').trim(); })[0];
    o.plazo = conPlazo ? _normalizePlazo(conPlazo.Plazo_Pago) : '';
    o.fechaPedido = f.Fecha_Pedido || '';
    o.creadoEn = L.map(function(l) { return l.creado_en; }).filter(Boolean).sort()[0] || '';
    var conCreador = L.filter(function(l) { return l.creado_por; })[0];
    o.creadoPor = conCreador ? conCreador.creado_por : null;
    o.creadoPorNombre = ((L.filter(function(l) { return l.creado_por_nombre; })[0] || {}).creado_por_nombre) || '';
    o.ids = L.map(function(l) { return l.__row; }).filter(function(id) { return id != null; });
    o.estado2 = carDerivedEstado2(L);
    o.status = carDerivedStatus(L);

    // Valor total del pedido (mismo criterio que dashboard.js › dBuildOrders).
    // valorTotal incluye las líneas anuladas (un rechazo anula todo el pedido: el
    // historial de decisiones debe mostrar lo que valía).
    o.valor = 0;
    o.valorTotal = 0;
    L.forEach(function(l) {
      var v = Number(l.Valor_Total) || ((Number(l.Valor_Unitario) || 0) * (Number(l.Cantidad) || 0));
      o.valorTotal += v;
      if ((l.Estado_2 || 'Abierto').trim() === 'Anulado') return;
      o.valor += v;
    });
    // Valor que aún compromete crédito (sin líneas anuladas ni cerradas).
    var ab = _valorAbiertoLineas(L);
    o.valorAbierto = ab.valor;
    o.valorEntregadoAbierto = ab.entregado;

    // Último bloqueo / liberación y última aprobación (solo se conserva el último ciclo).
    var bqs = L.filter(function(l) { return l.Bloqueo_En || l.Bloqueo_Observacion; })
      .sort(function(a, b) { return String(b.Bloqueo_En || '').localeCompare(String(a.Bloqueo_En || '')); });
    o.bq = bqs.length ? {
      obs: bqs[0].Bloqueo_Observacion || '', por: bqs[0].Bloqueo_Por_Nombre || '', en: bqs[0].Bloqueo_En || '',
      libPor: bqs[0].Desbloqueo_Por_Nombre || '', libEn: bqs[0].Desbloqueo_En || ''
    } : null;
    var aps = L.filter(function(l) { return l.Aprobacion_Por_Nombre || l.Aprobacion_En; })
      .sort(function(a, b) { return String(b.Aprobacion_En || '').localeCompare(String(a.Aprobacion_En || '')); });
    o.ap = aps.length ? { por: aps[0].Aprobacion_Por_Nombre || '', en: aps[0].Aprobacion_En || '', nota: aps[0].Aprobacion_Nota || '' } : null;
    return o;
  });
}

function carIndexClientes() {
  carCliByNit = {}; carCliByName = {};
  carClientes.forEach(function(c) {
    var nb = _nitBase(c.Identificacion);
    if (nb) (carCliByNit[nb] = carCliByNit[nb] || []).push(c);
    var nn = norm(c.Cliente);
    if (nn) (carCliByName[nn] = carCliByName[nn] || []).push(c);
  });
}
// Registros de ClientesUnicos del cliente de un pedido (por NIT base; si no hay NIT, por nombre).
function carClientesDe(o) {
  if (o.nitBase && carCliByNit[o.nitBase]) return carCliByNit[o.nitBase];
  if (!o.nitBase) return carCliByName[norm(o.cliente)] || [];
  return [];
}
function carEstadoCliente(regs) {
  if (!regs.length) return '';
  if (regs.some(function(r) { return r.Estado === CAR_BLOQ; })) return CAR_BLOQ;
  if (regs.some(function(r) { return r.Estado === 'Inactivo'; })) return 'Inactivo';
  return 'Activo';
}

// ── Carga ────────────────────────────────────────────────────
async function loadCartera() {
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
      apiGet('getPedidos', { columns: CAR_PED_COLS }),
      apiGet('getClientesAll', { columns: CAR_CLI_COLS })
    ]);
    if (!results[0].ok) throw new Error(results[0].error || 'Error al cargar pedidos');
    if (!results[1].ok) throw new Error(results[1].error || 'Error al cargar clientes');

    carClientes = results[1].clientes || [];
    carIndexClientes();
    carOrders = carBuildOrders(results[0].pedidos || []);
    carByKey = {};
    carOrders.forEach(function(o) { carByKey[o.key] = o; });
    Object.keys(carSel).forEach(function(k) { if (!carByKey[k]) delete carSel[k]; });

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Datos actualizados ' + new Date().toLocaleTimeString('es-CO'));
    carFillEmpresas();
    carRender();
    if (carCtxKey) {
      var o = carByKey[carCtxKey];
      if (o) carRenderCtx(); else carCloseCtx();
    }
    if (typeof applyDeepLinkFilters === 'function') applyDeepLinkFilters();
  } catch (err) {
    if (mainEl.style.display === 'block') {
      setSyncStatus('error', 'Error al actualizar: ' + err.message);
    } else {
      spinnerEl.style.display = 'none';
      errEl.textContent = 'Error: ' + err.message;
      errEl.style.display = 'block';
      retryBtn.style.display = 'inline-block';
    }
  }
}

function carFillEmpresas() {
  var sel = document.getElementById('f-emp');
  var actual = sel.value;
  var nombres = {};
  carOrders.forEach(function(o) {
    if (o.estado2 === CAR_PEND || o.estado2 === CAR_BLOQ) nombres[o.empresa] = true;
  });
  var arr = Object.keys(nombres).sort();
  sel.innerHTML = '<option value="">Todas</option>' + arr.map(function(n) {
    return '<option value="' + escHtml(n) + '">' + escHtml(n) + '</option>';
  }).join('');
  sel.value = arr.indexOf(actual) >= 0 ? actual : '';
}

// ── Pestañas y filtros ───────────────────────────────────────
function carSwitchTab(t) {
  carTab = t;
  carRender();
}
function carClearFilters() {
  document.getElementById('f-emp').value = '';
  document.getElementById('f-txt').value = '';
  carRender();
}

function carFiltrar(list) {
  var emp = document.getElementById('f-emp').value;
  var q = norm(document.getElementById('f-txt').value);
  return list.filter(function(o) {
    if (emp && o.empresa !== emp) return false;
    if (q) {
      var hay = norm([o.cliente, o.nit, o.consecutivo, o.comercial, o.creadoPorNombre].join(' '));
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

// ── Render principal ─────────────────────────────────────────
function carRender() {
  var pend = carOrders.filter(function(o) { return o.estado2 === CAR_PEND; });
  var bloq = carOrders.filter(function(o) { return o.estado2 === CAR_BLOQ; });

  document.getElementById('ct-aprobar').textContent = pend.length;
  document.getElementById('ct-bloqueados').textContent = bloq.length;
  ['aprobar', 'bloqueados', 'resumen'].forEach(function(t) {
    document.getElementById('tab-' + t).classList.toggle('active', carTab === t);
  });
  carRenderStats(pend, bloq);

  var esResumen = carTab === 'resumen';
  document.getElementById('panel-cola').style.display = esResumen ? 'none' : 'block';
  document.getElementById('panel-resumen').style.display = esResumen ? 'block' : 'none';
  document.getElementById('car-filters').style.display = esResumen ? 'none' : 'flex';
  if (esResumen) carRenderResumen(bloq); else carRenderCola(carTab === 'aprobar' ? pend : bloq);
}

function carRenderStats(pend, bloq) {
  function suma(l) { return l.reduce(function(s, o) { return s + o.valor; }, 0); }
  document.getElementById('s-aprobar').textContent = pend.length;
  document.getElementById('s-aprobar-val').textContent = pend.length ? fmtMoney(suma(pend)) : '';
  document.getElementById('s-bloq').textContent = bloq.length;
  document.getElementById('s-bloq-val').textContent = bloq.length ? fmtMoney(suma(bloq)) : '';

  var maxP = null, maxB = null, quienP = '', quienB = '';
  pend.forEach(function(o) { var d = carDias(o.creadoEn || o.fechaPedido); if (d != null && (maxP == null || d > maxP)) { maxP = d; quienP = o.cliente; } });
  bloq.forEach(function(o) { var d = carDias(o.bq && o.bq.en); if (d != null && (maxB == null || d > maxB)) { maxB = d; quienB = o.cliente; } });
  var max = Math.max(maxP == null ? -1 : maxP, maxB == null ? -1 : maxB);
  document.getElementById('s-antig').textContent = max < 0 ? '—' : max;
  document.getElementById('s-antig-det').textContent = max < 0 ? '' : (max === maxP ? 'Por aprobar · ' + quienP : 'Bloqueado · ' + quienB);

  var gruposBloq = {}, gruposSinCupo = {}, gruposTotal = {};
  carClientes.forEach(function(c) {
    var k = _nitBase(c.Identificacion) || ('n:' + norm(c.Cliente));
    gruposTotal[k] = true;
    if (c.Estado === CAR_BLOQ) gruposBloq[k] = true;
  });
  Object.keys(gruposTotal).forEach(function(k) {
    var regs = carCliByNit[k.replace(/^n:/, '')] || carCliByName[k.replace(/^n:/, '')] || [];
    var conCupo = regs.some(function(r) { var t = _cupoInfo(r.Cupo_Credito).tipo; return t === 'numero' || t === 'na'; });
    if (!conCupo) gruposSinCupo[k] = true;
  });
  document.getElementById('s-cli-bloq').textContent = Object.keys(gruposBloq).length;
  document.getElementById('s-cli-sin-cupo').textContent = Object.keys(gruposSinCupo).length + ' de ' + Object.keys(gruposTotal).length + ' sin cupo definido';
}

// ── Cola (Por aprobar / Bloqueados) ──────────────────────────
function carRenderCola(base) {
  var esAprobar = carTab === 'aprobar';
  var lista = carFiltrar(base).slice();
  lista.forEach(function(o) {
    o._dias = esAprobar ? carDias(o.creadoEn || o.fechaPedido) : carDias(o.bq && o.bq.en);
  });
  lista.sort(function(a, b) { return (b._dias == null ? -1 : b._dias) - (a._dias == null ? -1 : a._dias); });
  carColaRows = lista;

  document.getElementById('cola-titulo').innerHTML = (esAprobar ? '⏳ Pedidos de cliente nuevo por aprobar ' : '🔒 Pedidos bloqueados por cartera ') +
    '<span id="cola-ct" style="font-weight:400;color:#718096">(' + lista.length + (lista.length !== base.length ? ' de ' + base.length : '') + ')</span>';
  document.getElementById('cola-nota').textContent = esAprobar
    ? 'Ordenados por antigüedad (días desde que se creó el pedido). Un pedido de cliente nuevo no se puede despachar hasta que se apruebe.'
    : 'Ordenados por días bloqueado. Mientras esté bloqueado no se puede registrar entrega. Para bloquear un pedido abierto, ábrelo desde el panel del cliente o desde Pedidos.';

  var puede = esAprobar ? carPuedeAprobar() : carPuedeBloquear();
  var head = (puede ? '<th style="width:32px"><input type="checkbox" id="car-chk-all" onclick="carToggleAll(this.checked)" title="Seleccionar todo"></th>' : '') +
    '<th>Empresa</th><th>N°</th><th>Cliente</th><th>NIT</th><th>Comercial</th><th>Plazo</th><th style="text-align:right">Total</th>' +
    (esAprobar ? '<th>Creado por</th><th>Esperando</th>' : '<th>Observación</th><th>Bloqueó</th><th>Bloqueado</th>') +
    '<th></th>';
  document.getElementById('cola-head').innerHTML = head;

  var cols = (puede ? 1 : 0) + 8 + (esAprobar ? 2 : 3);
  if (!lista.length) {
    document.getElementById('cola-body').innerHTML = '<tr><td colspan="' + cols + '" style="text-align:center;color:#a0aec0;padding:26px">' +
      (base.length ? 'Ningún pedido coincide con los filtros.' : (esAprobar ? 'No hay pedidos pendientes de aprobación. 🎉' : 'No hay pedidos bloqueados por cartera.')) + '</td></tr>';
    carUpdateBulk();
    return;
  }

  document.getElementById('cola-body').innerHTML = lista.map(function(o) {
    var k = escHtml(o.key);
    var cls = esAprobar ? 'row-pendiente-aprobacion' : 'row-bloqueada-cartera';
    var chk = puede ? '<td onclick="event.stopPropagation()"><input type="checkbox" data-key="' + k + '" ' + (carSel[o.key] ? 'checked' : '') +
      ' onclick="carToggleSel(this.getAttribute(\'data-key\'), this.checked)"></td>' : '';
    var extra = esAprobar
      ? '<td>' + escHtml(o.creadoPorNombre || '—') + '</td><td>' + carDiasHtml(o._dias) + '</td>'
      : '<td><div class="car-obs" title="' + escHtml(o.bq && o.bq.obs || '') + '">' + (o.bq && o.bq.obs ? '💬 ' + escHtml(o.bq.obs) : '<span class="tag-sin">sin observación</span>') + '</div></td>' +
        '<td>' + escHtml(o.bq && o.bq.por || '—') + '</td><td>' + carDiasHtml(o._dias) + '</td>';
    return '<tr class="' + cls + '" style="cursor:pointer" data-key="' + k + '" onclick="carOpenCtx(this.getAttribute(\'data-key\'))">' + chk +
      '<td>' + carSiglaHtml(o.empresa) + '</td>' +
      '<td><strong>' + escHtml(o.consecutivo) + '</strong></td>' +
      '<td>' + escHtml(o.cliente) + '</td>' +
      '<td>' + escHtml(o.nit || '—') + '</td>' +
      '<td>' + escHtml(o.comercial || '—') + '</td>' +
      '<td>' + escHtml(o.plazo || '—') + '</td>' +
      '<td style="text-align:right">' + fmtMoney(o.valor) + '</td>' +
      extra +
      '<td><button class="btn-ver" data-key="' + k + '" onclick="event.stopPropagation();carOpenCtx(this.getAttribute(\'data-key\'))">Revisar</button></td>' +
    '</tr>';
  }).join('');
  var all = document.getElementById('car-chk-all');
  if (all) all.checked = lista.length > 0 && lista.every(function(o) { return carSel[o.key]; });
  carUpdateBulk();
}

// ── Selección y acciones masivas ─────────────────────────────
function carToggleSel(key, on) {
  if (on) carSel[key] = true; else delete carSel[key];
  var all = document.getElementById('car-chk-all');
  if (all) all.checked = carColaRows.length > 0 && carColaRows.every(function(o) { return carSel[o.key]; });
  carUpdateBulk();
}
function carToggleAll(on) {
  carColaRows.forEach(function(o) { if (on) carSel[o.key] = true; else delete carSel[o.key]; });
  document.querySelectorAll('#cola-body input[type=checkbox][data-key]').forEach(function(cb) { cb.checked = on; });
  carUpdateBulk();
}
function carClearSel() {
  carSel = {};
  document.querySelectorAll('#cola-body input[type=checkbox]').forEach(function(cb) { cb.checked = false; });
  var all = document.getElementById('car-chk-all'); if (all) all.checked = false;
  carUpdateBulk();
}
function carSelKeys() {
  // Solo las filas visibles de la pestaña actual (los filtros no deben arrastrar selecciones ocultas).
  return carColaRows.filter(function(o) { return carSel[o.key]; }).map(function(o) { return o.key; });
}
function carUpdateBulk() {
  var n = carSelKeys().length;
  var bar = document.getElementById('car-bulk');
  bar.style.display = n ? 'flex' : 'none';
  document.getElementById('car-bulk-ct').textContent = n + (n === 1 ? ' pedido seleccionado' : ' pedidos seleccionados');
  var esAprobar = carTab === 'aprobar';
  document.getElementById('bulk-aprobar').style.display = esAprobar ? '' : 'none';
  document.getElementById('bulk-rechazar').style.display = esAprobar ? '' : 'none';
  document.getElementById('bulk-liberar').style.display = esAprobar ? 'none' : '';
}
function carBulk(kind) {
  var keys = carSelKeys();
  if (!keys.length) return;
  carOpenAct(kind, keys);
}

// ── Panel de contexto ────────────────────────────────────────
function carOpenCtx(key) {
  if (!carByKey[key]) return;
  carCtxKey = key;
  carRenderCtx();
  document.getElementById('ctx-overlay').classList.add('show');
}
function carCloseCtx() {
  carCtxKey = null;
  document.getElementById('ctx-overlay').classList.remove('show');
}

// Todos los pedidos del mismo cliente con valor abierto (para lista y exposición).
function carAbiertosDelCliente(o) {
  return carOrders.filter(function(x) { return x.idCli === o.idCli && x.valorAbierto > 0; })
    .sort(function(a, b) { return String(b.fechaPedido).localeCompare(String(a.fechaPedido)); });
}

function carKv(k, v) { return '<div class="car-kv"><span>' + k + '</span><span>' + v + '</span></div>'; }

function carSemaforo(exp, cupo) {
  if (cupo.tipo !== 'numero') return { cls: 'none', pct: null, txt: cupo.tipo === 'na' ? 'Cupo: no aplica' : cupo.tipo === 'texto' ? 'Cupo: ' + cupo.texto : 'Sin cupo definido' };
  var pct = cupo.valor > 0 ? Math.round(exp / cupo.valor * 100) : 0;
  return { cls: pct > 100 ? 'over' : pct >= 70 ? 'mid' : 'ok', pct: pct, txt: pct + '% del cupo' };
}

function carRenderCtx() {
  var o = carByKey[carCtxKey];
  if (!o) return;
  var regs = carClientesDe(o);
  var estCli = carEstadoCliente(regs);
  var esNuevo = regs.some(function(r) { return r.Cliente_Nuevo; });

  document.getElementById('ctx-titulo').textContent = getSigla(o.empresa) + ' #' + o.consecutivo + ' — ' + o.cliente;
  document.getElementById('ctx-meta').innerHTML =
    '<span>' + carBadge(o.estado2) + '</span>' +
    '<span>🧾 ' + fmtMoney(o.valor) + '</span>' +
    '<span>👤 ' + escHtml(o.comercial || 'sin comercial') + '</span>' +
    '<span>📅 ' + escHtml(fmtDate(o.fechaPedido)) + '</span>';

  // ── Exposición por empresa ──
  var abiertos = carAbiertosDelCliente(o);
  // _exposicionCredito trabaja con el valor ABIERTO (sin líneas anuladas/cerradas).
  var exp = _exposicionCredito(abiertos.map(function(x) {
    return { nitBase: x.idCli, plazo: x.plazo, valor: x.valorAbierto, valorEntregado: x.valorEntregadoAbierto, ord: x };
  }), o.idCli);
  var empresas = {};
  regs.forEach(function(r) { if (r.Nombre_Empresa) empresas[r.Nombre_Empresa] = true; });
  exp.items.forEach(function(x) { empresas[x.ord.empresa] = true; });
  var maxCupo = 0, hayCupo = false;
  regs.forEach(function(r) { var c = _cupoInfo(r.Cupo_Credito); if (c.tipo === 'numero') { hayCupo = true; if (c.valor > maxCupo) maxCupo = c.valor; } });
  var cupoTop = hayCupo ? { tipo: 'numero', valor: maxCupo } : (regs.length ? _cupoInfo(regs[0].Cupo_Credito) : { tipo: 'vacio' });
  var semTot = carSemaforo(exp.total, cupoTop);

  var filasEmp = Object.keys(empresas).sort().map(function(emp) {
    var reg = regs.filter(function(r) { return r.Nombre_Empresa === emp; })[0];
    var cupo = reg ? _cupoInfo(reg.Cupo_Credito) : { tipo: 'vacio' };
    var expEmp = exp.items.filter(function(x) { return x.ord.empresa === emp; }).reduce(function(s, x) { return s + x.valor; }, 0);
    var sem = carSemaforo(expEmp, cupo);
    var cupoTxt = cupo.tipo === 'numero' ? fmtMoney(cupo.valor) : cupo.tipo === 'na' ? 'No aplica' : cupo.tipo === 'texto' ? escHtml(cupo.texto) : '—';
    return '<tr><td>' + carSiglaHtml(emp) + '</td><td>' + cupoTxt + '</td><td style="text-align:right">' + fmtMoney(expEmp) + '</td>' +
      '<td><span class="car-pill ' + sem.cls + '">' + escHtml(sem.txt) + '</span></td></tr>';
  }).join('');

  // ── Plazo pedido vs. plazo del cliente ──
  var plazosCli = [];
  regs.forEach(function(r) { var p = _normalizePlazo(r.Plazo_Pago); if (p && plazosCli.indexOf(p) < 0) plazosCli.push(p); });
  var plazoFlag = '';
  if (!o.plazo) plazoFlag = 'El pedido no trae plazo de pago.';
  else if (plazosCli.length && plazosCli.indexOf(o.plazo) < 0) plazoFlag = 'El plazo del pedido (' + o.plazo + ') es distinto del plazo del cliente (' + plazosCli.join(' / ') + ').';
  else if (!plazosCli.length && !esContado(o.plazo)) plazoFlag = 'El cliente no tiene plazo definido y el pedido es a crédito (' + o.plazo + ').';

  // ── Cliente ──
  var estCliTxt = !regs.length ? '<span class="car-pill mid">No está en Clientes</span>'
    : estCli === CAR_BLOQ ? '<span class="car-pill over">Bloqueado por cartera</span>'
    : estCli === 'Inactivo' ? '<span class="car-pill mid">Inactivo</span>' : '<span class="car-pill ok">Activo</span>';

  var html = '';
  if (plazoFlag) html += '<div class="car-flag">⚠️ ' + escHtml(plazoFlag) + '</div>';
  if (esNuevo) html += '<div class="car-flag">🆕 Cliente nuevo: se dio de alta con este pedido y aún no tiene cupo ni plazo revisados.</div>';

  html += '<div class="car-ctx-grid">';
  // Caja cliente
  html += '<div class="car-box"><h4>Cliente</h4>' +
    carKv('Estado', estCliTxt) +
    carKv('NIT', escHtml(o.nit || '—')) +
    carKv('Plazo del pedido', escHtml(o.plazo || '—')) +
    carKv('Plazo del cliente', escHtml(plazosCli.join(' / ') || '—')) +
    carKv('Registros en Clientes', String(regs.length)) +
    (o.creadoPorNombre ? carKv('Pedido creado por', escHtml(o.creadoPorNombre)) : '') +
  '</div>';
  // Caja crédito
  var barW = semTot.pct == null ? 100 : Math.min(100, semTot.pct);
  html += '<div class="car-box"><h4>Crédito (estimado)</h4>' +
    carKv('Exposición a crédito', '<strong>' + fmtMoney(exp.total) + '</strong>') +
    carKv('&nbsp;&nbsp;por despachar', fmtMoney(Math.max(0, exp.total - exp.entregado))) +
    carKv('&nbsp;&nbsp;despachado sin cerrar', fmtMoney(exp.entregado)) +
    carKv('Cupo (el más alto registrado)', cupoTop.tipo === 'numero' ? fmtMoney(cupoTop.valor) : '—') +
    '<div class="car-meter"><div class="' + semTot.cls + '" style="width:' + barW + '%"></div></div>' +
    '<span class="car-pill ' + semTot.cls + '">' + escHtml(semTot.txt) + '</span>' +
    '<div style="font-size:0.7rem;color:#a0aec0;margin-top:6px">Estimación con los pedidos abiertos a crédito de todas las empresas (incluye este pedido). No es el saldo por cobrar: el panel no maneja facturas ni pagos.</div>' +
  '</div>';
  html += '</div>';

  if (filasEmp) {
    html += '<div class="car-box" style="margin-bottom:14px"><h4>Cupo y exposición por empresa</h4>' +
      '<table class="car-mini"><thead><tr><th>Empresa</th><th>Cupo</th><th style="text-align:right">Exposición</th><th>Uso</th></tr></thead><tbody>' + filasEmp + '</tbody></table></div>';
  }

  // Última decisión / bloqueo
  var traza = '';
  if (o.bq) {
    traza += '<div style="font-size:0.82rem;color:#7f1d1d;margin-bottom:4px">🔒 <strong>Bloqueo</strong>' + (o.bq.por ? ' por ' + escHtml(o.bq.por) : '') + ' · ' + escHtml(carFmtTs(o.bq.en)) +
      (o.bq.obs ? '<div style="white-space:pre-wrap;margin-top:2px">' + escHtml(o.bq.obs) + '</div>' : '') +
      (o.bq.libEn ? '<div style="color:#166534;margin-top:2px">🔓 Liberado por ' + escHtml(o.bq.libPor || '—') + ' · ' + escHtml(carFmtTs(o.bq.libEn)) + '</div>' : '') + '</div>';
  }
  if (o.ap) {
    traza += '<div style="font-size:0.82rem;color:#92400e">✔ <strong>Aprobación de cliente nuevo</strong> resuelta por ' + escHtml(o.ap.por || '—') + ' · ' + escHtml(carFmtTs(o.ap.en)) +
      (o.ap.nota ? ' · ' + escHtml(o.ap.nota) : '') + '</div>';
  }
  if (traza) html += '<div class="car-box" style="margin-bottom:14px"><h4>Último bloqueo / decisión</h4>' + traza + '</div>';

  // Líneas del pedido
  html += '<div class="car-box" style="margin-bottom:14px"><h4>Productos de este pedido</h4>' +
    '<table class="car-mini"><thead><tr><th>Producto</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Vr. unitario</th><th style="text-align:right">Valor</th></tr></thead><tbody>' +
    o.lines.map(function(l) {
      var v = Number(l.Valor_Total) || ((Number(l.Valor_Unitario) || 0) * (Number(l.Cantidad) || 0));
      return '<tr><td>' + escHtml(l.Producto || '') + (l.Presentacion ? ' <span style="color:#a0aec0">' + escHtml(l.Presentacion) + '</span>' : '') + '</td>' +
        '<td style="text-align:right">' + (Number(l.Cantidad) || 0) + '</td>' +
        '<td style="text-align:right">' + fmtMoney(Number(l.Valor_Unitario) || 0) + '</td>' +
        '<td style="text-align:right">' + fmtMoney(v) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  // Pedidos abiertos del cliente
  html += '<div class="car-box"><h4>Pedidos abiertos del cliente (' + abiertos.length + ')</h4>';
  if (!abiertos.length) {
    html += '<div style="color:#a0aec0;font-size:0.82rem">No tiene pedidos abiertos.</div>';
  } else {
    html += '<table class="car-mini"><thead><tr><th>Empresa</th><th>N°</th><th>Fecha</th><th>Estado</th><th>Plazo</th><th style="text-align:right">Valor abierto</th><th></th></tr></thead><tbody>' +
      abiertos.map(function(x) {
        var contado = esContado(x.plazo);
        var puedeBloq = carPuedeBloquear() && x.estado2 === 'Abierto';
        return '<tr class="' + (x.key === o.key ? 'actual' : '') + '"><td>' + carSiglaHtml(x.empresa) + '</td><td>' + escHtml(x.consecutivo) + '</td>' +
          '<td>' + escHtml(fmtDate(x.fechaPedido)) + '</td><td>' + carBadge(x.estado2) + '</td>' +
          '<td>' + escHtml(x.plazo || '—') + (contado ? ' <span class="tag-sin">(no suma)</span>' : '') + '</td>' +
          '<td style="text-align:right">' + fmtMoney(x.valorAbierto) + '</td>' +
          '<td>' + (puedeBloq ? '<button class="btn-rechazar-pedido" data-key="' + escHtml(x.key) + '" onclick="carOpenAct(\'bloquear\',[this.getAttribute(\'data-key\')])">🔒 Bloquear</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  html += '</div>';

  document.getElementById('ctx-body').innerHTML = html;

  // Acciones de este pedido
  var acc = '';
  if (o.estado2 === CAR_PEND && carPuedeAprobar()) {
    acc += '<button class="btn-aprobar-pedido" onclick="carOpenAct(\'aprobar\',[carCtxKey])">✅ Aprobar</button>' +
           '<button class="btn-rechazar-pedido" onclick="carOpenAct(\'rechazar\',[carCtxKey])">❌ Rechazar</button>';
  } else if (o.estado2 === CAR_BLOQ && carPuedeBloquear()) {
    acc += '<button class="btn-aprobar-pedido" onclick="carOpenAct(\'liberar\',[carCtxKey])">🔓 Liberar</button>';
  }
  document.getElementById('ctx-acciones').innerHTML = acc;
  document.getElementById('ctx-ver-pedidos').href = 'pedidos.html?buscar=' + encodeURIComponent(o.consecutivo) + '&empresa=' + encodeURIComponent(getSigla(o.empresa));
}

// ── Modal de acción ──────────────────────────────────────────
var CAR_ACT_CFG = {
  aprobar:  { titulo: '✅ Aprobar pedido', color: 'linear-gradient(135deg,#15803d,#22c55e)', ok: '✅ Aprobar', notaLabel: 'Nota (opcional)', notaReq: false, exito: '✅ Pedido aprobado: ya se le puede dar trámite' },
  rechazar: { titulo: '❌ Rechazar pedido', color: 'linear-gradient(135deg,#b91c1c,#ef4444)', ok: '❌ Rechazar', notaLabel: 'Motivo del rechazo (obligatorio)', notaReq: true, exito: '❌ Pedido rechazado (Anulado)' },
  bloquear: { titulo: '🔒 Bloquear por cartera', color: 'linear-gradient(135deg,#b91c1c,#ef4444)', ok: '🔒 Bloquear', notaLabel: 'Observación del bloqueo (obligatoria)', notaReq: true, exito: '🔒 Pedido bloqueado por cartera' },
  liberar:  { titulo: '🔓 Liberar del bloqueo', color: 'linear-gradient(135deg,#15803d,#22c55e)', ok: '🔓 Liberar', notaLabel: '', notaReq: false, exito: '🔓 Pedido liberado de cartera' }
};

function carOpenAct(kind, keys) {
  var cfg = CAR_ACT_CFG[kind];
  var ords = keys.map(function(k) { return carByKey[k]; }).filter(Boolean);
  if (!cfg || !ords.length) return;
  if ((kind === 'aprobar' || kind === 'rechazar') && !carPuedeAprobar()) { showToast('Solo Cartera o administración pueden resolver aprobaciones', '#e74c3c'); return; }
  if ((kind === 'bloquear' || kind === 'liberar') && !carPuedeBloquear()) { showToast('Solo Cartera, editor o administración pueden bloquear/liberar', '#e74c3c'); return; }

  carAct = { kind: kind, keys: ords.map(function(o) { return o.key; }), busy: false };
  var multi = ords.length > 1;
  document.getElementById('act-hdr').style.background = cfg.color;
  document.getElementById('act-titulo').textContent = cfg.titulo + (multi ? ' (' + ords.length + ' pedidos)' : '');
  document.getElementById('act-sub').textContent = '';
  document.getElementById('act-resumen').innerHTML = multi
    ? '<div style="max-height:130px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px">' + ords.map(function(o) {
        return '<div>' + carSiglaHtml(o.empresa) + ' #' + escHtml(o.consecutivo) + ' — ' + escHtml(o.cliente) + ' <span style="color:#718096">' + fmtMoney(o.valor) + '</span></div>';
      }).join('') + '</div>'
    : '<strong>' + carSiglaHtml(ords[0].empresa) + ' #' + escHtml(ords[0].consecutivo) + '</strong> — ' + escHtml(ords[0].cliente) +
      ' <span style="color:#718096">· ' + fmtMoney(ords[0].valor) + '</span>';

  var notaWrap = document.getElementById('act-nota-wrap');
  notaWrap.style.display = cfg.notaLabel ? 'block' : 'none';
  document.getElementById('act-nota-label').textContent = cfg.notaLabel;
  document.getElementById('act-nota').value = '';
  document.getElementById('act-nota').placeholder = kind === 'bloquear' ? 'Por qué se bloquea (mora, cupo excedido, documentos pendientes…)' :
    kind === 'rechazar' ? 'Por qué se rechaza el pedido' : '';

  // Cupo y plazo: solo al aprobar UN pedido cuyo cliente sea nuevo.
  var regs = !multi ? carClientesDe(ords[0]) : [];
  var mostrarCred = kind === 'aprobar' && !multi && regs.some(function(r) { return r.Cliente_Nuevo; });
  document.getElementById('act-credito').style.display = mostrarCred ? 'block' : 'none';
  document.getElementById('act-cupo').value = '';
  document.getElementById('act-plazo').value = '';
  if (mostrarCred) {
    var r0 = regs.filter(function(r) { return r.Cliente_Nuevo; })[0];
    var c0 = _cupoInfo(r0.Cupo_Credito);
    if (c0.tipo === 'numero') document.getElementById('act-cupo').value = String(c0.valor);
    document.getElementById('act-plazo').value = _normalizePlazo(r0.Plazo_Pago) || ords[0].plazo || '';
  }

  var cliWrap = document.getElementById('act-cli-wrap');
  cliWrap.style.display = kind === 'bloquear' ? 'flex' : 'none';
  document.getElementById('act-cli-bloq').checked = false;

  var warn = document.getElementById('act-warn');
  var w = '';
  if (kind === 'rechazar') w = 'El pedido quedará ANULADO' + (multi ? ' (todos los seleccionados)' : '') + '. No se puede deshacer desde aquí.';
  else if (kind === 'bloquear') w = 'Mientras esté bloqueado no se podrá registrar entrega de producto.';
  else if (kind === 'liberar') w = 'Quedará en estado "Abierto". La observación del bloqueo se conserva como historial.';
  else if (kind === 'aprobar') w = 'Al aprobar queda en "Abierto" y ya se le puede dar trámite.';
  warn.textContent = w;
  warn.style.display = w ? 'block' : 'none';

  var ok = document.getElementById('act-ok');
  ok.textContent = cfg.ok; ok.disabled = false;
  document.getElementById('act-overlay').classList.add('show');
  var nota = document.getElementById('act-nota');
  if (cfg.notaLabel) setTimeout(function() { nota.focus(); }, 60);
}
function carCloseAct() {
  if (carAct && carAct.busy) return;
  carAct = null;
  document.getElementById('act-overlay').classList.remove('show');
}

// Ejecuta la acción sobre UN pedido. Lanza Error si falla.
async function carDoOne(kind, o, nota, opts) {
  if (!o.ids.length) throw new Error('No se pudieron identificar las líneas del pedido');
  if (kind === 'aprobar' || kind === 'rechazar') {
    var r = await apiPost({ action: 'resolverAprobacionPedido', pedido_ids: o.ids, aprobar: kind === 'aprobar', nota: nota });
    if (!r || r.ok === false) throw new Error((r && r.error) || 'Error al actualizar');
    var extra = '';
    if (kind === 'aprobar' && opts && opts.credito) {
      try {
        var ids = carClientesDe(o).map(function(x) { return x.__row; }).filter(function(x) { return x != null; });
        var rc = await apiPost({ action: 'setCreditoCliente', ids: ids, cupo: opts.credito.cupo, plazo: opts.credito.plazo });
        if (!rc || rc.ok === false) throw new Error((rc && rc.error) || 'Error');
      } catch (e2) { extra = 'Aprobado, pero no se pudo guardar el cupo/plazo: ' + (e2.message || e2); }
    }
    carNotificarCreador(o, kind === 'aprobar', nota);
    return extra;
  }
  var bloquear = kind === 'bloquear';
  var r2 = await apiPost({ action: 'setBloqueoCartera', pedido_ids: o.ids, bloquear: bloquear, observacion: bloquear ? nota : '' });
  if (!r2 || r2.ok === false) throw new Error((r2 && r2.error) || 'Error al actualizar');
  var extra2 = '';
  if (bloquear && opts && opts.bloquearCliente) {
    try {
      var rb = await apiPost({ action: 'bloquearClientePorNit', nit: o.nit || '', cliente: o.cliente || '' });
      if (!rb || rb.ok === false) throw new Error((rb && rb.error) || 'Error');
      if (!(rb.updated > 0) && !(rb.found > 0)) extra2 = 'Bloqueado, pero no se encontró al cliente en Clientes; bloquéalo manualmente allí.';
    } catch (e3) { extra2 = 'Bloqueado, pero no se pudo bloquear al cliente: ' + (e3.message || e3); }
  }
  return extra2;
}

// Aviso por la campana al creador del pedido (no bloquea el flujo si falla).
async function carNotificarCreador(o, aprobar, nota) {
  if (typeof NOTIF === 'undefined' || !NOTIF.notifyUsers || !o.creadoPor) return;
  try {
    var ref = getSigla(o.empresa) + ' #' + o.consecutivo + ' — ' + o.cliente;
    await NOTIF.notifyUsers({
      para_ids: [o.creadoPor], modulo: 'pedidos', referencia: String(o.consecutivo || ''),
      titulo: (aprobar ? '✅ Pedido aprobado: ' : '❌ Pedido rechazado: ') + ref,
      mensaje: aprobar ? 'Cartera aprobó tu pedido de cliente nuevo; ya se le puede dar trámite.' : 'Motivo: ' + (nota || 'sin motivo')
    });
  } catch (e) { /* silencioso */ }
}

async function carConfirmAct() {
  var st = carAct;
  if (!st || st.busy) return;
  var cfg = CAR_ACT_CFG[st.kind];
  var nota = document.getElementById('act-nota').value.trim();
  if (cfg.notaReq && !nota) { showToast('Escribe ' + (st.kind === 'bloquear' ? 'la observación del bloqueo' : 'el motivo del rechazo'), '#e74c3c'); return; }

  var opts = {};
  if (st.kind === 'aprobar' && st.keys.length === 1 && document.getElementById('act-credito').style.display !== 'none') {
    var cupo = document.getElementById('act-cupo').value.trim();
    var plazo = document.getElementById('act-plazo').value.trim();
    if (cupo || plazo) {
      var ci = _cupoInfo(cupo);
      opts.credito = { cupo: ci.tipo === 'numero' ? String(ci.valor) : ci.tipo === 'na' ? 'NA' : cupo, plazo: plazo ? _normalizePlazo(plazo) : '' };
      if (!cupo) delete opts.credito.cupo;
      if (!plazo) delete opts.credito.plazo;
    }
  }
  if (st.kind === 'bloquear') opts.bloquearCliente = document.getElementById('act-cli-bloq').checked;

  st.busy = true;
  var okBtn = document.getElementById('act-ok');
  okBtn.disabled = true; okBtn.textContent = 'Procesando…';

  var resultados = [];
  for (var i = 0; i < st.keys.length; i++) {
    var o = carByKey[st.keys[i]];
    try {
      var aviso = await carDoOne(st.kind, o, nota, opts);
      resultados.push({ o: o, ok: true, aviso: aviso });
    } catch (e) {
      resultados.push({ o: o, ok: false, err: e.message || String(e) });
    }
  }
  st.busy = false;
  carAct = null;
  document.getElementById('act-overlay').classList.remove('show');

  var okN = resultados.filter(function(r) { return r.ok; }).length;
  var fallos = resultados.filter(function(r) { return !r.ok; });
  var avisos = resultados.filter(function(r) { return r.ok && r.aviso; });
  var verbo = { aprobar: 'aprobado(s)', rechazar: 'rechazado(s)', bloquear: 'bloqueado(s)', liberar: 'liberado(s)' }[st.kind];

  if (resultados.length === 1) {
    if (okN) showToast(avisos.length ? '⚠️ ' + avisos[0].aviso : cfg.exito, avisos.length ? '#e67e22' : undefined);
    else showToast('❌ ' + fallos[0].err, '#e74c3c');
  } else {
    var h = '<div style="font-size:0.9rem;margin-bottom:8px"><strong>' + okN + '</strong> pedido(s) ' + verbo + (fallos.length ? ' · <strong style="color:#b91c1c">' + fallos.length + ' con error</strong>' : '') + '.</div>';
    if (fallos.length) {
      h += '<div style="max-height:200px;overflow-y:auto;font-size:0.8rem;border:1px solid #fecaca;background:#fef2f2;border-radius:6px;padding:8px 10px">' +
        fallos.map(function(f) { return '<div>#' + escHtml(f.o.consecutivo) + ' — ' + escHtml(f.o.cliente) + ': <em>' + escHtml(f.err) + '</em></div>'; }).join('') + '</div>';
    }
    if (avisos.length) h += '<div style="margin-top:8px;font-size:0.78rem;color:#b7791f">' + avisos.map(function(a) { return '#' + escHtml(a.o.consecutivo) + ': ' + escHtml(a.aviso); }).join('<br>') + '</div>';
    document.getElementById('resm-titulo').textContent = 'Resultado';
    document.getElementById('resm-body').innerHTML = h;
    document.getElementById('res-overlay').classList.add('show');
  }
  carSel = {};
  await loadCartera();
  // Si el pedido del panel de contexto ya no está en su cola (p. ej. se aprobó), se cierra.
  if (carCtxKey && carByKey[carCtxKey] && carByKey[carCtxKey].estado2 !== CAR_PEND && carByKey[carCtxKey].estado2 !== CAR_BLOQ && st.keys.indexOf(carCtxKey) >= 0) carCloseCtx();
}
function carCloseRes() { document.getElementById('res-overlay').classList.remove('show'); }

// ── Resumen ──────────────────────────────────────────────────
// Decisiones de los últimos 30 días a partir del ÚLTIMO ciclo de cada pedido.
function carDecisiones30d() {
  var lim = Date.now() - 30 * 86400000;
  var out = [];
  carOrders.forEach(function(o) {
    if (o.ap && o.ap.en && new Date(o.ap.en).getTime() >= lim) {
      var rech = o.estado2 === 'Anulado' && !!o.ap.nota;
      out.push({ fecha: o.ap.en, tipo: rech ? 'Rechazado' : 'Aprobado', o: o, quien: o.ap.por, nota: o.ap.nota, tardo: o.creadoEn ? carDuracion(o.creadoEn, o.ap.en) : '—',
        ms: o.creadoEn ? new Date(o.ap.en).getTime() - new Date(o.creadoEn).getTime() : null });
    }
    if (o.bq && o.bq.en && new Date(o.bq.en).getTime() >= lim) {
      out.push({ fecha: o.bq.en, tipo: 'Bloqueado', o: o, quien: o.bq.por, nota: o.bq.obs, tardo: '—', ms: null });
    }
    if (o.bq && o.bq.libEn && new Date(o.bq.libEn).getTime() >= lim) {
      out.push({ fecha: o.bq.libEn, tipo: 'Liberado', o: o, quien: o.bq.libPor, nota: '', tardo: o.bq.en ? carDuracion(o.bq.en, o.bq.libEn) : '—',
        ms: o.bq.en ? new Date(o.bq.libEn).getTime() - new Date(o.bq.en).getTime() : null });
    }
  });
  out.sort(function(a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
  return out;
}
function carBloqueadosPorCliente(bloq) {
  var g = {};
  bloq.forEach(function(o) {
    var x = g[o.idCli] || (g[o.idCli] = { cliente: o.cliente, nit: o.nit, n: 0, valor: 0, desde: '', regs: carClientesDe(o) });
    x.n++; x.valor += o.valor;
    var en = o.bq && o.bq.en;
    if (en && (!x.desde || en < x.desde)) x.desde = en;
  });
  return Object.keys(g).map(function(k) { return g[k]; }).sort(function(a, b) { return b.valor - a.valor; });
}

function carRenderResumen(bloq) {
  var dec = carDecisiones30d();
  function cuenta(t) { return dec.filter(function(d) { return d.tipo === t; }).length; }
  function promedio(t) {
    var v = dec.filter(function(d) { return d.tipo === t && d.ms != null && d.ms >= 0; });
    if (!v.length) return '—';
    var ms = v.reduce(function(s, d) { return s + d.ms; }, 0) / v.length;
    return carDuracion(0, ms);
  }
  document.getElementById('res-stats').innerHTML =
    '<div class="sc entregado"><div class="num">' + cuenta('Aprobado') + '</div><div class="lbl">Aprobados (30 d)</div><div class="car-sub">Tiempo promedio: ' + promedio('Aprobado') + '</div></div>' +
    '<div class="sc sol-pend"><div class="num">' + cuenta('Rechazado') + '</div><div class="lbl">Rechazados (30 d)</div></div>' +
    '<div class="sc recibido"><div class="num">' + cuenta('Bloqueado') + '</div><div class="lbl">Bloqueados (30 d)</div></div>' +
    '<div class="sc parcial"><div class="num">' + cuenta('Liberado') + '</div><div class="lbl">Liberados (30 d)</div><div class="car-sub">Tiempo promedio bloqueado: ' + promedio('Liberado') + '</div></div>';

  var g = carBloqueadosPorCliente(bloq);
  document.getElementById('res-bloq-body').innerHTML = g.length ? g.map(function(x) {
    var est = carEstadoCliente(x.regs);
    return '<tr><td>' + escHtml(x.cliente) + '</td><td>' + escHtml(x.nit || '—') + '</td><td>' + x.n + '</td><td>' + fmtMoney(x.valor) + '</td>' +
      '<td>' + (x.desde ? escHtml(fmtDate(String(x.desde).slice(0, 10))) + ' · ' + carDiasHtml(carDias(x.desde)) : '—') + '</td>' +
      '<td>' + (est === CAR_BLOQ ? '<span class="badge b-bloqueado">Bloqueado</span>' : est ? escHtml(est) : '<span class="tag-sin">no está en Clientes</span>') + '</td></tr>';
  }).join('') : '<tr><td colspan="6" style="text-align:center;color:#a0aec0;padding:20px">No hay pedidos bloqueados.</td></tr>';

  document.getElementById('res-dec-body').innerHTML = dec.length ? dec.map(function(d) {
    var cls = d.tipo === 'Aprobado' || d.tipo === 'Liberado' ? 'b-abierto' : d.tipo === 'Rechazado' ? 'b-anulado' : 'b-bloqueado';
    return '<tr><td>' + escHtml(carFmtTs(d.fecha)) + '</td><td><span class="badge ' + cls + '">' + d.tipo + '</span></td>' +
      '<td>' + carSiglaHtml(d.o.empresa) + ' #' + escHtml(d.o.consecutivo) + '</td><td>' + escHtml(d.o.cliente) + '</td>' +
      '<td style="text-align:right">' + fmtMoney(d.o.valorTotal) + '</td><td>' + escHtml(d.quien || '—') + '</td><td>' + escHtml(d.tardo) + '</td>' +
      '<td><div class="car-obs" title="' + escHtml(d.nota || '') + '" style="color:#4a5568">' + escHtml(d.nota || '') + '</div></td></tr>';
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:#a0aec0;padding:20px">Sin decisiones en los últimos 30 días.</td></tr>';
}

// ── Exportar a Excel ─────────────────────────────────────────
function carXlsx(nombre, hoja, filas) {
  if (typeof XLSX === 'undefined') { showToast('La librería de Excel aún no carga; intenta de nuevo', '#e67e22'); return; }
  var ws = XLSX.utils.aoa_to_sheet(filas);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  XLSX.writeFile(wb, nombre + '_' + today() + '.xlsx');
}
function carExportCola() {
  var esAprobar = carTab === 'aprobar';
  var filas = [['Empresa', 'N° pedido', 'Cliente', 'NIT', 'Comercial', 'Plazo', 'Total', 'Fecha pedido']
    .concat(esAprobar ? ['Creado por', 'Días esperando'] : ['Observación', 'Bloqueó', 'Bloqueado en', 'Días bloqueado'])];
  carColaRows.forEach(function(o) {
    filas.push([o.empresa, o.consecutivo, o.cliente, o.nit, o.comercial, o.plazo, o.valor, o.fechaPedido]
      .concat(esAprobar ? [o.creadoPorNombre, o._dias == null ? '' : o._dias]
        : [o.bq ? o.bq.obs : '', o.bq ? o.bq.por : '', o.bq ? carFmtTs(o.bq.en) : '', o._dias == null ? '' : o._dias]));
  });
  carXlsx(esAprobar ? 'cartera_por_aprobar' : 'cartera_bloqueados', esAprobar ? 'Por aprobar' : 'Bloqueados', filas);
}
function carExportResumen() {
  var bloq = carOrders.filter(function(o) { return o.estado2 === CAR_BLOQ; });
  var filas = [['Cliente', 'NIT', 'Pedidos bloqueados', 'Valor', 'Bloqueado desde', 'Estado del cliente']];
  carBloqueadosPorCliente(bloq).forEach(function(x) {
    filas.push([x.cliente, x.nit, x.n, x.valor, x.desde ? carFmtTs(x.desde) : '', carEstadoCliente(x.regs) || 'No está en Clientes']);
  });
  filas.push([]);
  filas.push(['Decisiones últimos 30 días (último ciclo por pedido)']);
  filas.push(['Fecha', 'Decisión', 'Empresa', 'N° pedido', 'Cliente', 'Valor', 'Quién', 'Tardó', 'Nota']);
  carDecisiones30d().forEach(function(d) {
    filas.push([carFmtTs(d.fecha), d.tipo, d.o.empresa, d.o.consecutivo, d.o.cliente, d.o.valorTotal, d.quien || '', d.tardo, d.nota || '']);
  });
  carXlsx('cartera_resumen', 'Resumen', filas);
}

// Escape cierra el modal de más arriba.
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  if (document.getElementById('res-overlay').classList.contains('show')) carCloseRes();
  else if (document.getElementById('act-overlay').classList.contains('show')) carCloseAct();
  else if (document.getElementById('ctx-overlay').classList.contains('show')) carCloseCtx();
});

loadCartera();
