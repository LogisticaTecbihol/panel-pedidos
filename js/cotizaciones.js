// ============================================================
// Cotizaciones — pedidos.html → pestaña «Cotizaciones»
//
// Una cotización es una propuesta de precios para un cliente (o prospecto). Si el
// cliente la acepta, se ajusta si hace falta y se CONVIERTE en pedido: el pedido se
// crea desde «Nuevo Pedido» precargado (con todas sus validaciones de siempre); aquí
// solo queda el vínculo (estado «Convertida» + N° del pedido).
//
// Datos: tablas Cotizaciones / CotizacionLineas (supabase/migrations/create_cotizaciones.sql).
// Todo se escribe por RPC (guardar_cotizacion, cambiar_estado_cotizacion,
// marcar_cotizacion_convertida) vía apiPost de shared.js; la base asigna el número
// COT-<SIGLA>-<n> (consecutivo por empresa) y recalcula los totales.
//
// El formulario NO es uno nuevo: reutiliza el modal de «Nuevo Pedido» (#nuevo-overlay) en
// «modo cotización» (clase .modo-cot + bandera _nvEsCotizacion, que viven en pedidos.js),
// igual que «Nuevo Traslado». Por eso este archivo carga DESPUÉS de pedidos.js y usa sus
// funciones globales (openNuevoPedido, renderNuevoLines, nuevoProductos, _resolveComercialId…).
// Los ganchos que hay en pedidos.js: openNuevoPedido / closeNuevo (apagan el modo),
// guardarNuevoPedido (delega aquí si _nvEsCotizacion y avisa la conversión), switchPedidoTab
// y los dos manejadores de precio (marca línea.precio_fijo).
//
// Estados guardados: Abierta → Aceptada → Convertida; Abierta/Aceptada → Rechazada → Abierta.
// «Vencida» NO se guarda: es una Abierta con Vigente_Hasta < hoy (cotEstadoEfectivo).
// Vigencia por defecto: COT_VIGENCIA_DIAS días CALENDARIO (corridos) desde la fecha.
// ============================================================

var COT_VIGENCIA_DIAS = 8;                    // días calendario (corridos), no hábiles
var COT_COLS = ['N°', 'Fecha', 'Válida hasta', 'Empresa', 'Cliente', 'NIT', 'Comercial', 'Total', 'Estado', ''];

var _cotLista = null;       // cabeceras cargadas (null = sin cargar)
var _cotDet = null;         // cotización abierta en el detalle (con líneas)
var _cotOcupado = false;    // evita doble clic en acciones que escriben
var _cotEditOrig = null;    // cotización que se está editando en el modal (null = nueva)
var _cotVigTocada = false;  // ¿la persona ajustó «Válida hasta» a mano?

// ── Utilidades ──

function _cotPad(n) { return String(n).padStart(2, '0'); }

// Suma n días CALENDARIO a una fecha 'YYYY-MM-DD' (cruza fin de mes y de año).
function cotSumarDias(iso, n) {
  var p = String(iso || '').slice(0, 10).split('-');
  if (p.length !== 3 || !+p[0]) return '';
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + _cotPad(d.getMonth() + 1) + '-' + _cotPad(d.getDate());
}

function cotNumero(c) { return 'COT-' + getSigla(c.Nombre_Empresa) + '-' + c.Consecutivo; }

function _cotNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Estado que se muestra: «Vencida» es una Abierta cuya vigencia ya pasó.
function cotEstadoEfectivo(c) {
  var est = c.Estado || 'Abierta';
  if (est === 'Abierta' && c.Vigente_Hasta && String(c.Vigente_Hasta).slice(0, 10) < today()) return 'Vencida';
  return est;
}

function cotBadge(est) {
  return '<span class="badge b-cot-' + String(est).toLowerCase() + '">' + escHtml(est) + '</span>';
}

function _cotPuedeEscribir() { return !!(AUTH.canEdit && AUTH.canEdit()); }

// El nombre del asesor es lo que ve el cliente; Pedidos.Comercial guarda un CÓDIGO
// (p. ej. PDC-C08). Se busca en el directorio igual que _resolveComercialId.
async function cotNombreComercial(codigo) {
  var v = String(codigo || '').trim();
  if (!v) return '';
  try {
    if (AUTH.isComercial && AUTH.isComercial()) {
      var prof = AUTH.getProfile && AUTH.getProfile();
      return (prof && prof.nombre) ? prof.nombre : v;
    }
    if (typeof NOTIF === 'undefined' || !NOTIF.getDirectorio) return v;
    var dir = await NOTIF.getDirectorio();
    var vLow = v.toLowerCase();
    var hit = (dir || []).filter(function(x) { return x.activo; }).filter(function(x) {
      var codes = x.codigos_comercial || [];
      for (var j = 0; j < codes.length; j++) {
        if (String(codes[j].codigo || '').trim().toLowerCase() === vLow) return true;
      }
      return String(x.comercial_codigo || '').trim().toLowerCase() === vLow;
    })[0];
    return (hit && hit.nombre) ? hit.nombre : v;
  } catch (e) { return v; }
}

// ── Pestaña y lista ──

function initCotizacionesTab() {
  var btn = document.getElementById('tab-cotizaciones');
  if (btn && AUTH.verCotizaciones && AUTH.verCotizaciones()) btn.style.display = 'inline-block';
}

// Se llama desde switchPedidoTab al entrar a la pestaña: muestra lo que haya en memoria
// y vuelve a pedir la lista (así se ve lo que otras personas hicieron mientras tanto).
async function cotMostrar() {
  if (_cotLista) { cotLlenarEmpresas(); cotRender(); }
  await cotCargar(true, !!_cotLista);
}

async function cotCargar(forzar, silencioso) {
  if (!forzar && _cotLista) { cotRender(); return; }
  var body = document.getElementById('cot-body');
  if (!silencioso && body) {
    body.innerHTML = '<tr><td colspan="' + COT_COLS.length + '" style="text-align:center;padding:24px;color:#718096">Cargando cotizaciones…</td></tr>';
  }
  var r = await apiGet('getCotizaciones');
  if (!r || !r.ok) {
    var msg = (r && r.error) ? r.error : 'Error desconocido';
    if (silencioso) showToast('No se pudo actualizar la lista de cotizaciones: ' + msg, '#e74c3c');
    else if (body) body.innerHTML = '<tr><td colspan="' + COT_COLS.length + '" style="text-align:center;padding:24px;color:#c0392b">No se pudieron cargar las cotizaciones: ' + escHtml(msg) + '</td></tr>';
    return;
  }
  _cotLista = r.cotizaciones || [];
  cotLlenarEmpresas();
  cotRender();
}

// Fuerza que la próxima vez que se abra la pestaña se vuelva a pedir la lista.
function cotInvalidar() { _cotLista = null; }

function cotLlenarEmpresas() {
  var sel = document.getElementById('cot-f-empresa');
  if (!sel) return;
  var actual = sel.value;
  var nombres = {};
  (_cotLista || []).forEach(function(c) { nombres[c.Nombre_Empresa] = true; });
  sel.innerHTML = '<option value="">— Todas —</option>' + Object.keys(nombres).sort().map(function(n) {
    return '<option value="' + escHtml(n) + '">' + escHtml(getSigla(n)) + '</option>';
  }).join('');
  sel.value = actual;
}

function cotRender() {
  var head = document.getElementById('cot-head');
  var body = document.getElementById('cot-body');
  if (!head || !body) return;
  if (!head.children.length) {
    head.innerHTML = COT_COLS.map(function(c, i) {
      return '<th' + (c === 'Total' ? ' style="text-align:right"' : '') + '>' + escHtml(c) + '</th>';
    }).join('');
  }
  if (!_cotLista) return;

  var fEmp = (document.getElementById('cot-f-empresa') || {}).value || '';
  var fEst = (document.getElementById('cot-f-estado') || {}).value || '';
  var q = _cotNorm((document.getElementById('cot-f-buscar') || {}).value);

  var lista = _cotLista.filter(function(c) {
    if (fEmp && c.Nombre_Empresa !== fEmp) return false;
    if (fEst && cotEstadoEfectivo(c) !== fEst) return false;
    if (q) {
      var hay = _cotNorm([cotNumero(c), c.Cliente, c.NIT, c.Comercial, c.Pedido_Consecutivo, c.Municipio].join(' '));
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }).sort(function(a, b) {
    var fa = String(a.Fecha_Cotizacion), fb = String(b.Fecha_Cotizacion);
    if (fa !== fb) return fa < fb ? 1 : -1;
    return (b.Consecutivo || 0) - (a.Consecutivo || 0);
  });

  var ct = document.getElementById('cot-count');
  if (ct) ct.textContent = '(' + lista.length + (lista.length !== _cotLista.length ? ' de ' + _cotLista.length : '') + ')';

  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="' + COT_COLS.length + '" style="text-align:center;padding:24px;color:#718096">' +
      (_cotLista.length ? 'Ninguna cotización coincide con los filtros.'
        : (_cotPuedeEscribir() ? 'Aún no hay cotizaciones. Crea la primera con «Nueva Cotización».' : 'Aún no hay cotizaciones.')) + '</td></tr>';
    return;
  }

  body.innerHTML = lista.map(function(c) {
    var est = cotEstadoEfectivo(c);
    var vinculo = (est === 'Convertida' && c.Pedido_Consecutivo)
      ? ' <span style="font-size:.72rem;color:#718096">→ Pedido #' + escHtml(c.Pedido_Consecutivo) + '</span>' : '';
    return '<tr>' +
      '<td><strong>' + escHtml(cotNumero(c)) + '</strong></td>' +
      '<td>' + escHtml(fmtDate(c.Fecha_Cotizacion)) + '</td>' +
      '<td>' + escHtml(fmtDate(c.Vigente_Hasta)) + '</td>' +
      '<td><span class="sigla-badge ' + getSiglaClass(c.Nombre_Empresa) + '">' + escHtml(getSigla(c.Nombre_Empresa)) + '</span></td>' +
      '<td>' + escHtml(c.Cliente) + '</td>' +
      '<td>' + escHtml(c.NIT || '—') + '</td>' +
      '<td>' + escHtml(c.Comercial || '—') + '</td>' +
      '<td style="text-align:right;font-weight:600">' + escHtml(fmtMoney(c.Total)) + '</td>' +
      '<td>' + cotBadge(est) + vinculo + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn-ver" onclick="cotAbrirDetalle(' + Number(c.id) + ')">Ver</button> ' +
        '<button class="btn-ver" style="background:#7d3c98" title="Descargar el PDF para el cliente" onclick="cotPdfDesdeLista(' + Number(c.id) + ')">📄</button>' +
      '</td></tr>';
  }).join('');
}

// ── Modal de Nuevo Pedido en «modo cotización» ──

// Enciende/apaga el modo. Apagar restaura todo lo que el modo cambió (openNuevoPedido y
// closeNuevo lo llaman); los textos del título y del botón los repone openNuevoPedido.
function cotAplicarModo(on, opts) {
  var ov = document.getElementById('nuevo-overlay');
  if (!ov) return;
  opts = opts || {};
  ov.classList.toggle('modo-cot', !!on);
  var txt = function(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; };
  var hdr = ov.querySelector('.mhdr');
  var btn = document.getElementById('btn-guardar-nuevo');
  var emp = document.getElementById('nv-empresa');
  var cli = document.getElementById('nv-cliente');
  var obs = document.getElementById('nv-observaciones');
  if (on) {
    txt('nv-titulo', opts.titulo || '📝 Nueva Cotización');
    txt('nv-subtitulo', 'Prepara la propuesta para el cliente o prospecto; si la acepta, se convierte en pedido');
    txt('nv-fecha-lbl', 'Fecha Cotización *');
    txt('nv-compromiso-lbl', 'Válida hasta *');
    txt('nv-obs-lbl', 'Observaciones / condiciones');
    if (btn) { btn.textContent = opts.boton || '📝 Guardar cotización'; btn.style.background = '#7d3c98'; }
    if (hdr) hdr.style.background = 'linear-gradient(135deg,#6c3483,#8e44ad)';
    if (cli) cli.placeholder = 'Nombre del cliente o prospecto';
    if (obs) obs.placeholder = 'Condiciones o notas para el cliente (opcional)';
    if (emp) emp.disabled = !!opts.bloquearEmpresa;
  } else {
    txt('nv-fecha-lbl', 'Fecha Pedido *');
    txt('nv-compromiso-lbl', 'Fecha Compromiso *');
    txt('nv-obs-lbl', 'Observaciones');
    if (btn) btn.style.background = '#1a5276';
    if (hdr) hdr.style.background = 'linear-gradient(135deg,#1a5276,#2980b9)';
    if (cli) cli.placeholder = 'Nombre del cliente';
    if (obs) obs.placeholder = 'Observaciones del pedido (opcional)';
    if (emp) emp.disabled = false;
  }
}

// «Válida hasta» = fecha + COT_VIGENCIA_DIAS días calendario (sustituye los manejadores del
// pedido, que suman días HÁBILES). Si se pasa vigIni (edición) se respeta.
function cotConfigurarVigencia(vigIni) {
  var f = document.getElementById('nv-fecha');
  var v = document.getElementById('nv-compromiso');
  _cotVigTocada = !!vigIni;
  v.value = vigIni || cotSumarDias(f.value, COT_VIGENCIA_DIAS);
  v.min = f.value;
  v.oninput = function() { _cotVigTocada = true; };
  f.oninput = function() {
    v.min = f.value;
    if (!_cotVigTocada) v.value = cotSumarDias(f.value, COT_VIGENCIA_DIAS);
  };
}

async function openNuevaCotizacion() {
  if (!_cotPuedeEscribir()) { showToast('No tienes permiso para crear cotizaciones', '#e74c3c'); return; }
  await openNuevoPedido();
  _nvEsCotizacion = true;
  _cotEditOrig = null;
  cotAplicarModo(true);
  cotConfigurarVigencia('');
}

// Llena el modal de Nuevo Pedido con una cotización. destino 'cotizacion' = editarla;
// 'pedido' = convertirla (el modal queda como un pedido normal). Las líneas llevan
// precio_fijo para que el precio cotizado no se pise con la lista al pasar por el campo
// (ver el blur de setupProductoAutocomplete); NO se llama _reapplyPreciosNuevo.
async function cotPrecargarModal(cot, destino) {
  var el = function(id) { return document.getElementById(id); };
  var emp = el('nv-empresa');
  emp.value = cot.Nombre_Empresa;
  if (emp.value !== cot.Nombre_Empresa) {
    showToast('No tienes acceso a la empresa de esta cotización (' + getSigla(cot.Nombre_Empresa) + ')', '#e74c3c');
    return false;
  }
  // Mismo efecto que elegir la empresa a mano (limpia el comercial, recalcula consecutivo…).
  // Va primero porque borra el comercial; el rol comercial queda fijo en su propio código.
  if (typeof emp.onchange === 'function') emp.onchange();
  if (!(AUTH.isComercial && AUTH.isComercial())) {
    el('nv-comercial').value = cot.Comercial || '';
    actualizarConsecutivoNuevo();
  }
  el('nv-cliente').value = cot.Cliente || '';
  el('nv-nit').value = cot.NIT || '';
  el('nv-sucursal').value = cot.Sucursal || '';
  el('nv-telefono').value = cot.Telefono || '';
  el('nv-direccion').value = cot.Direccion_Envio || '';
  el('nv-municipio').value = cot.Municipio || '';
  el('nv-departamento').value = cot.Departamento || '';
  el('nv-plazo').value = cot.Plazo_Pago || '';
  el('nv-precio').value = cot.Precio_Facturacion || '';

  if (destino === 'pedido') {
    el('nv-facturar-a').value = cot.Cliente || '';
    el('nv-observaciones').value = ('Cotización ' + cotNumero(cot) + '. ' + (cot.Observaciones || '')).trim();
  } else {
    el('nv-observaciones').value = cot.Observaciones || '';
    el('nv-fecha').value = String(cot.Fecha_Cotizacion).slice(0, 10);
    cotConfigurarVigencia(String(cot.Vigente_Hasta).slice(0, 10));
  }

  nuevoProductos = (cot.lineas || []).map(function(l) {
    return {
      producto: l.Producto || '', presentacion: l.Presentacion || '',
      cantidad: Number(l.Cantidad) || 0, valor_unitario: Number(l.Valor_Unitario) || 0,
      valor_total: Number(l.Valor_Total) || 0, bonificado: l.Bonificado === 'Sí' ? 'Sí' : '',
      precio_fijo: true
    };
  });
  if (!nuevoProductos.length) nuevoProductos = [{ producto:'', presentacion:'', cantidad:0, valor_unitario:0, valor_total:0, bonificado:'' }];
  renderNuevoLines();
  _toggleNvProductos();
  return true;
}

async function cotEditar(id) {
  if (!_cotPuedeEscribir()) { showToast('No tienes permiso para editar cotizaciones', '#e74c3c'); return; }
  var r = await apiGet('getCotizacion', { id: id });
  if (!r.ok) { showToast('❌ ' + r.error, '#e74c3c'); return; }
  var cot = r.cotizacion;
  if (cot.Estado !== 'Abierta' && cot.Estado !== 'Aceptada') {
    showToast('Una cotización ' + cot.Estado.toLowerCase() + ' no se puede editar', '#e67e22');
    return;
  }
  cotCerrarDetalle();
  await openNuevoPedido();
  _nvEsCotizacion = true;
  _nvCotizacionId = cot.id;
  _cotEditOrig = cot;
  cotAplicarModo(true, { titulo: '✏️ Editar ' + cotNumero(cot), boton: '💾 Guardar cambios', bloquearEmpresa: true });
  if (!(await cotPrecargarModal(cot, 'cotizacion'))) closeNuevo();
}

// Guarda la cotización (alta o edición). Lo llama guardarNuevoPedido cuando _nvEsCotizacion.
async function guardarCotizacion() {
  syncNuevoFromDOM();
  var el = function(id) { return document.getElementById(id); };
  var empresa = el('nv-empresa').value;
  var fecha = el('nv-fecha').value;
  var vigente = el('nv-compromiso').value;
  var cliente = el('nv-cliente').value.trim();
  var hoy = today();
  var editando = !!_nvCotizacionId;

  if (!_cotPuedeEscribir()) { showToast('No tienes permiso para guardar cotizaciones', '#e74c3c'); return; }
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!fecha) { showToast('Selecciona la fecha de la cotización', '#e74c3c'); return; }
  if (!vigente) { showToast('Indica hasta cuándo es válida la cotización', '#e74c3c'); return; }
  if (vigente < fecha) { showToast('«Válida hasta» no puede ser anterior a la fecha de la cotización', '#e74c3c'); return; }
  var estadoOrig = _cotEditOrig ? _cotEditOrig.Estado : 'Abierta';
  if (estadoOrig === 'Abierta' && vigente < hoy) { showToast('«Válida hasta» ya pasó: indica una fecha desde hoy', '#e74c3c'); return; }
  if (!cliente) { showToast('Ingresa el nombre del cliente o prospecto', '#e74c3c'); return; }
  var lineas = nuevoProductos.filter(function(p) { return p.producto && p.cantidad > 0; });
  if (!lineas.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var btn = el('btn-guardar-nuevo');
  var textoBtn = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';
  try {
    var comercial = el('nv-comercial').value.trim();
    // Si el comercial no cambió se conserva su id (el id lo usa la RLS para que el
    // comercial siga viendo su cotización aunque otra persona la edite).
    var comercialId = (_cotEditOrig && String(_cotEditOrig.Comercial || '') === comercial)
      ? _cotEditOrig.comercial_id
      : await _resolveComercialId(comercial);
    var geo = normalizarMunicipio(el('nv-municipio').value.trim(), el('nv-departamento').value.trim());
    var res = await apiPost({
      action: 'guardarCotizacion',
      id: editando ? _nvCotizacionId : null,
      cab: {
        nombre_empresa: empresa,
        fecha_cotizacion: fecha,
        vigente_hasta: vigente,
        cliente: cliente,
        nit: el('nv-nit').value.trim(),
        sucursal: el('nv-sucursal').value.trim(),
        telefono: el('nv-telefono').value.trim(),
        direccion_envio: el('nv-direccion').value.trim(),
        municipio: geo.municipio,
        departamento: geo.departamento || normalizarDepartamento(el('nv-departamento').value.trim()),
        comercial: comercial,
        comercial_id: comercialId || '',
        plazo_pago: el('nv-plazo').value.trim(),
        precio_facturacion: el('nv-precio').value.trim(),
        observaciones: el('nv-observaciones').value.trim()
      },
      lineas: lineas.map(function(p) {
        return { producto: p.producto, presentacion: p.presentacion, cantidad: p.cantidad,
                 valor_unitario: p.valor_unitario, bonificado: p.bonificado };
      })
    });
    if (!res.ok) throw new Error(res.error || 'No se pudo guardar la cotización');

    cotInvalidar();
    closeNuevo();
    var numero = 'COT-' + getSigla(empresa) + '-' + res.consecutivo;
    showToast((editando ? '✅ Cotización actualizada: ' : '✅ Cotización creada: ') + numero, '#6c3483');
    // Al crearla se descarga el PDF para presentarlo al cliente (igual que el pedido).
    // Se genera con lo que quedó guardado, no con lo digitado.
    if (!editando) {
      var rr = await apiGet('getCotizacion', { id: res.id });
      if (rr.ok) await cotDescargarPDF(rr.cotizacion);
    }
    switchPedidoTab('cotizaciones');
  } catch (err) {
    showToast('❌ ' + err.message, '#e74c3c', 6000);
    btn.disabled = false;
    btn.textContent = textoBtn;
  }
}

// ── Detalle ──

async function cotAbrirDetalle(id) {
  var r = await apiGet('getCotizacion', { id: id });
  if (!r.ok) { showToast('❌ ' + r.error, '#e74c3c'); return; }
  _cotDet = r.cotizacion;
  cotRenderDetalle();
  document.getElementById('cot-det-overlay').classList.add('show');
}

function cotCerrarDetalle() {
  var ov = document.getElementById('cot-det-overlay');
  if (ov) ov.classList.remove('show');
  _cotDet = null;
}

function cotRenderDetalle() {
  var c = _cotDet;
  if (!c) return;
  var est = cotEstadoEfectivo(c);
  document.getElementById('cot-det-titulo').innerHTML = escHtml(cotNumero(c)) + ' &nbsp;' + cotBadge(est);
  document.getElementById('cot-det-meta').innerHTML =
    '<span>🏢 ' + escHtml(c.Nombre_Empresa) + '</span>' +
    '<span>📅 ' + escHtml(fmtDate(c.Fecha_Cotizacion)) + '</span>' +
    '<span>⏳ Válida hasta ' + escHtml(fmtDate(c.Vigente_Hasta)) + '</span>';

  var kv = function(k, v) {
    return '<div><div class="k">' + escHtml(k) + '</div><div class="v">' + (v ? escHtml(v) : '<span style="color:#a0aec0">—</span>') + '</div></div>';
  };
  var banner = '';
  if (est === 'Vencida') {
    banner = '<div style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #ea580c;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.84rem;color:#9a3412">' +
      '⏰ Esta cotización venció el ' + escHtml(fmtDate(c.Vigente_Hasta)) + '. Para aceptarla, edítala y extiende la vigencia.</div>';
  } else if (est === 'Rechazada') {
    banner = '<div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.84rem;color:#7f1d1d">' +
      '❌ Rechazada' + (c.Rechazada_En ? ' el ' + escHtml(fmtDate(c.Rechazada_En)) : '') + '. Motivo: ' + escHtml(c.Motivo_Rechazo || '—') + '</div>';
  } else if (est === 'Convertida') {
    banner = '<div style="background:#f5eef8;border:1px solid #d7bde2;border-left:4px solid #7d3c98;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.84rem;color:#4a235a">' +
      '🛒 Convertida en el pedido <strong>#' + escHtml(c.Pedido_Consecutivo) + '</strong> de ' + escHtml(c.Pedido_Cliente || c.Cliente) +
      (c.Convertida_En ? ' el ' + escHtml(fmtDate(c.Convertida_En)) : '') + '.</div>';
  } else if (est === 'Aceptada') {
    banner = '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.84rem;color:#14532d">' +
      '✅ Aceptada' + (c.Aceptada_En ? ' el ' + escHtml(fmtDate(c.Aceptada_En)) : '') + '. Puedes ajustarla y convertirla en pedido.</div>';
  }

  var lineas = (c.lineas || []).map(function(l, i) {
    return '<tr><td style="color:#a0aec0">' + (i + 1) + '</td><td>' + escHtml(l.Producto) + '</td><td>' + escHtml(l.Presentacion || '') + '</td>' +
      '<td style="text-align:right">' + escHtml(String(Number(l.Cantidad))) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(l.Valor_Unitario)) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney(l.Valor_Total)) + '</td>' +
      '<td style="text-align:center">' + (l.Bonificado === 'Sí' ? 'Sí' : '') + '</td></tr>';
  }).join('');

  document.getElementById('cot-det-body').innerHTML = banner +
    '<div class="cot-grid">' +
      kv('Cliente', c.Cliente) + kv('NIT', c.NIT) + kv('Sucursal', c.Sucursal) +
      kv('Teléfono', c.Telefono) + kv('Dirección', c.Direccion_Envio) + kv('Municipio / Departamento', [c.Municipio, c.Departamento].filter(Boolean).join(', ')) +
      kv('Comercial', c.Comercial) + kv('Plazo de pago', c.Plazo_Pago) + kv('Lista de precios (interno)', c.Precio_Facturacion) +
    '</div>' +
    '<div style="overflow-x:auto"><table class="prod-table"><thead><tr><th>#</th><th>Producto</th><th>Presentación</th>' +
      '<th style="text-align:right">Cantidad</th><th style="text-align:right">Val. Unitario</th><th style="text-align:right">Val. Total</th><th>Bonif.</th></tr></thead>' +
      '<tbody>' + lineas + '</tbody></table></div>' +
    '<div style="margin-top:10px;display:flex;justify-content:flex-end"><div style="background:#f5eef8;border:1px solid #d7bde2;border-radius:7px;padding:8px 16px;font-size:.88rem">Total: <strong>' + escHtml(fmtMoney(c.Total)) + '</strong></div></div>' +
    (c.Observaciones ? '<div style="background:#fef9e7;border:1px solid #f9e79f;border-radius:8px;padding:10px 14px;margin-top:12px;font-size:.84rem"><div style="font-weight:700;color:#7d6608;font-size:.72rem;text-transform:uppercase;margin-bottom:4px">Observaciones</div>' + escHtml(c.Observaciones) + '</div>' : '') +
    '<div id="cot-det-accion"></div>' +
    _auditoriaHtml(c, false);

  cotRenderAcciones(c, est);
}

function cotRenderAcciones(c, est) {
  var puede = _cotPuedeEscribir();
  var b = function(txt, fn, color) {
    return '<button class="btn-confirm" style="background:' + (color || '#7d3c98') + '" onclick="' + fn + '">' + txt + '</button>';
  };
  var out = [];
  out.push('<button class="btn-cancel" onclick="cotCerrarDetalle()">Cerrar</button>');
  out.push(b('📄 PDF', 'cotPdfDetalle()', '#1a5276'));
  if (puede) {
    if (est === 'Abierta') {
      out.push(b('✏️ Editar', 'cotEditar(' + Number(c.id) + ')', '#1a5276'));
      out.push(b('❌ Rechazar', "cotMostrarAccion('rechazar')", '#c62828'));
      out.push(b('✅ Marcar aceptada', 'cotCambiarEstado(\'Aceptada\')', '#16a34a'));
    } else if (est === 'Vencida') {
      out.push(b('✏️ Editar y extender vigencia', 'cotEditar(' + Number(c.id) + ')', '#1a5276'));
      out.push(b('❌ Rechazar', "cotMostrarAccion('rechazar')", '#c62828'));
    } else if (est === 'Aceptada') {
      out.push(b('✏️ Editar', 'cotEditar(' + Number(c.id) + ')', '#1a5276'));
      out.push(b('❌ Rechazar', "cotMostrarAccion('rechazar')", '#c62828'));
      out.push(b('🛒 Convertir en pedido', 'cotConvertir(' + Number(c.id) + ')', '#7d3c98'));
    } else if (est === 'Rechazada') {
      out.push(b('↩ Reabrir', "cotMostrarAccion('reabrir')", '#16a34a'));
    }
  }
  if (est === 'Convertida') out.push(b('🔎 Ver el pedido', 'cotVerPedido()', '#7d3c98'));
  document.getElementById('cot-det-acciones').innerHTML = out.join('');
  document.getElementById('cot-det-aviso').textContent = '';
}

// Rechazar y reabrir piden un dato: se muestra un recuadro dentro del detalle.
function cotMostrarAccion(tipo) {
  var box = document.getElementById('cot-det-accion');
  if (!box) return;
  if (tipo === 'rechazar') {
    box.innerHTML = '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-top:14px">' +
      '<label class="ef-label">Motivo del rechazo * (mínimo 5 caracteres)</label>' +
      '<textarea id="cot-accion-nota" class="ef" rows="2" maxlength="300" placeholder="Ej.: el cliente consiguió mejor precio"></textarea>' +
      '<div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn-cancel" onclick="cotOcultarAccion()">Cancelar</button>' +
      '<button class="btn-confirm" style="background:#c62828" onclick="cotConfirmarRechazo()">Rechazar cotización</button></div></div>';
    var t = document.getElementById('cot-accion-nota'); if (t) t.focus();
  } else if (tipo === 'reabrir') {
    var hoy = today();
    box.innerHTML = '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-top:14px">' +
      '<label class="ef-label">Nueva vigencia * (válida hasta)</label>' +
      '<input id="cot-accion-vig" class="ef" type="date" min="' + hoy + '" value="' + cotSumarDias(hoy, COT_VIGENCIA_DIAS) + '" style="max-width:200px">' +
      '<div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn-cancel" onclick="cotOcultarAccion()">Cancelar</button>' +
      '<button class="btn-confirm" style="background:#16a34a" onclick="cotConfirmarReapertura()">Reabrir cotización</button></div></div>';
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cotOcultarAccion() {
  var box = document.getElementById('cot-det-accion');
  if (box) box.innerHTML = '';
}

function cotConfirmarRechazo() {
  var nota = ((document.getElementById('cot-accion-nota') || {}).value || '').trim();
  if (nota.length < 5) { showToast('Indica el motivo del rechazo (mínimo 5 caracteres)', '#e74c3c'); return; }
  cotCambiarEstado('Rechazada', nota);
}

function cotConfirmarReapertura() {
  var vig = (document.getElementById('cot-accion-vig') || {}).value || '';
  if (!vig || vig < today()) { showToast('Indica una nueva vigencia desde hoy', '#e74c3c'); return; }
  cotCambiarEstado('Abierta', null, vig);
}

async function cotCambiarEstado(estado, nota, vigente) {
  if (_cotOcupado || !_cotDet) return;
  _cotOcupado = true;
  var id = _cotDet.id;
  var numero = cotNumero(_cotDet);
  try {
    var r = await apiPost({ action: 'cambiarEstadoCotizacion', id: id, estado: estado, nota: nota || null, vigente_hasta: vigente || null });
    if (!r.ok) { showToast('❌ ' + r.error, '#e74c3c', 6000); return; }
    var msg = { Aceptada: '✅ ' + numero + ' marcada como aceptada', Rechazada: '❌ ' + numero + ' rechazada', Abierta: '↩ ' + numero + ' reabierta' };
    showToast(msg[estado] || 'Listo', estado === 'Rechazada' ? '#c62828' : '#16a34a');
    cotInvalidar();
    await cotAbrirDetalle(id);          // refresca el detalle con el estado nuevo
    cotCargar(true, true);              // y la lista de fondo
  } finally {
    _cotOcupado = false;
  }
}

// ── Conversión a pedido ──

// Abre «Nuevo Pedido» precargado con la cotización ACEPTADA. El pedido se guarda por el
// flujo normal (guardarNuevoPedido); al guardarse bien, cotMarcarConvertida deja el vínculo.
async function cotConvertir(id) {
  if (!_cotPuedeEscribir()) { showToast('No tienes permiso para crear pedidos', '#e74c3c'); return; }
  var r = await apiGet('getCotizacion', { id: id });
  if (!r.ok) { showToast('❌ ' + r.error, '#e74c3c'); return; }
  var cot = r.cotizacion;
  if (cot.Estado !== 'Aceptada') {
    showToast('Solo se puede convertir una cotización aceptada (esta está ' + cot.Estado.toLowerCase() + ')', '#e67e22', 5000);
    cotInvalidar();
    await cotAbrirDetalle(id);
    return;
  }
  cotCerrarDetalle();
  await openNuevoPedido();             // deja el modal como un pedido normal
  if (!(await cotPrecargarModal(cot, 'pedido'))) { closeNuevo(); return; }
  _nvCotizacionOrigen = { id: cot.id, numero: cotNumero(cot) };
  var titulo = document.getElementById('nv-titulo');
  var sub = document.getElementById('nv-subtitulo');
  if (titulo) titulo.textContent = '🛒 Nuevo Pedido desde ' + cotNumero(cot);
  if (sub) sub.textContent = 'Revisa los datos, completa lo que falte y guarda: al guardarse el pedido, la cotización queda como convertida';
}

// Lo llama guardarNuevoPedido después de crear el pedido. No lanza: devuelve {ok, numero, error}.
async function cotMarcarConvertida(origen, consecutivo, cliente) {
  var out = { ok: false, numero: origen.numero, error: '' };
  try {
    var r = await apiPost({ action: 'marcarCotizacionConvertida', id: origen.id, pedido_consecutivo: consecutivo, pedido_cliente: cliente });
    out.ok = !!(r && r.ok);
    out.error = (r && r.error) || '';
  } catch (e) {
    out.error = e.message;
  }
  cotInvalidar();
  return out;
}

// Va a la lista de pedidos filtrada por el cliente del pedido creado.
function cotVerPedido() {
  var c = _cotDet;
  if (!c) return;
  var cliente = c.Pedido_Cliente || c.Cliente;
  var n = c.Pedido_Consecutivo;
  cotCerrarDetalle();
  switchPedidoTab('activos');
  var q = document.getElementById('f-txt');
  if (q) { q.value = cliente; q.dispatchEvent(new Event('input', { bubbles: true })); }
  showToast('Mostrando los pedidos de ' + cliente + ' (busca el #' + n + ')');
}

// ── PDF para el cliente ──

async function cotPdfDetalle() {
  if (_cotDet) await cotDescargarPDF(_cotDet);
}

async function cotPdfDesdeLista(id) {
  var r = await apiGet('getCotizacion', { id: id });
  if (!r.ok) { showToast('❌ ' + r.error, '#e74c3c'); return; }
  await cotDescargarPDF(r.cotizacion);
}

async function cotDescargarPDF(c) {
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('La librería de PDF todavía no cargó; intenta de nuevo en unos segundos', '#e67e22'); return; }
  try {
    var asesor = await cotNombreComercial(c.Comercial);
    generarCotizacionPDF({
      empresa: c.Nombre_Empresa,
      numero: cotNumero(c),
      sigla: getSigla(c.Nombre_Empresa),
      consecutivo: c.Consecutivo,
      fecha: fmtDate(c.Fecha_Cotizacion),
      vigente: fmtDate(c.Vigente_Hasta),
      cliente: c.Cliente, nit: c.NIT, sucursal: c.Sucursal, telefono: c.Telefono,
      direccion: c.Direccion_Envio, municipio: c.Municipio, departamento: c.Departamento,
      comercial: asesor, plazo: c.Plazo_Pago,
      observaciones: c.Observaciones, total: c.Total,
      productos: (c.lineas || []).map(function(l) {
        return { producto: l.Producto, presentacion: l.Presentacion, cantidad: l.Cantidad,
                 valor_unitario: l.Valor_Unitario, valor_total: l.Valor_Total, bonificado: l.Bonificado };
      })
    });
  } catch (e) {
    showToast('❌ No se pudo generar el PDF: ' + e.message, '#e74c3c', 6000);
  }
}

// PDF de la cotización (media carta apaisada, como el pedido y las remisiones). Modelado en
// generarPedidoPDF (pedidos.js) y en el membrete de la solicitud de cambios (cambios.js).
// NO muestra el tipo de lista de precios (dato interno) ni IVA: los productos no lo manejan.
function generarCotizacionPDF(data) {
  var doc = _nuevoPdfDoc();
  var pw = doc.internal.pageSize.getWidth();
  var ph = doc.internal.pageSize.getHeight();
  var palette = _pdfPaletteFor(data.empresa);
  var primary = palette.accent;
  var totalFill = palette.light;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];
  var info = (typeof _pdfRemisionHeaderInfoFor === 'function' && _pdfRemisionHeaderInfoFor(data.empresa)) || [];
  var BAND_H = 23;

  function fit(txt, w) {
    var l = doc.splitTextToSize(String(txt || ''), w);
    return l[0] + (l.length > 1 ? '…' : '');
  }

  // Membrete: logo, título, razón social + NIT, dirección y contacto, y las fechas.
  function drawBand() {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pw, BAND_H, 'F');
    doc.setDrawColor(primary[0], primary[1], primary[2]);
    doc.setLineWidth(1.2);
    doc.line(0, BAND_H, pw, BAND_H);

    var textX = 14;
    var logo = (typeof _pdfHeaderLogoFor === 'function') ? _pdfHeaderLogoFor(data.empresa) : null;
    if (logo) {
      try {
        var lb = (typeof _pdfLogoBox === 'function') ? _pdfLogoBox(logo, 24, 15) : { w: 15, h: 15 };
        doc.addImage(logo.data, 'PNG', 6, 3.5, lb.w, lb.h);
        textX = 6 + lb.w + 4;
      } catch (e) {}
    }
    var maxW = pw - 14 - 58 - textX;

    doc.setTextColor(primary[0], primary[1], primary[2]);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('COTIZACIÓN ' + data.numero, textX, 8);

    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    var l1 = info.length > 1 ? (info[0] + '  ·  ' + info[1]) : (info[0] || data.empresa || '');
    doc.text(fit(l1, maxW), textX, 12.4);
    if (info[2]) doc.text(fit(info[2] + (info[3] ? ' ' + info[3] : ''), maxW), textX, 15.8);
    if (info[4]) doc.text(fit(info[4], maxW), textX, 19.2);

    doc.setFont(undefined, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    doc.text('Fecha: ' + data.fecha, pw - 14, 8, { align: 'right' });
    doc.setFontSize(8);
    doc.setTextColor(primary[0], primary[1], primary[2]);
    doc.text('Válida hasta: ' + data.vigente, pw - 14, 12.6, { align: 'right' });
  }

  var izq = [
    ['Cliente', data.cliente],
    ['NIT / CC', data.nit],
    ['Sucursal', data.sucursal],
    ['Teléfono', data.telefono],
    ['Dirección', data.direccion],
    ['Municipio', [data.municipio, data.departamento].filter(Boolean).join(', ')]
  ].filter(function(r, i) { return i === 0 || String(r[1] || '').trim() !== ''; });
  var der = [
    ['Asesor comercial', data.comercial],
    ['Plazo de pago', data.plazo]
  ].filter(function(r) { return String(r[1] || '').trim() !== ''; });

  // Datos del cliente (solo en la primera página). Devuelve el Y donde termina.
  function drawGrid(y0) {
    var totalW = pw - 28;
    var leftW = totalW * 0.62;
    var midX = 14 + leftW;
    var valX = 16 + 24;
    var leftMax = leftW - 24 - 4;
    var rLabelX = midX + 3;
    var rValX = rLabelX + 30;
    var rightMax = pw - 14 - rValX - 2;
    var rowGap = 3.4;
    var rows = Math.max(izq.length, der.length);
    var y = y0 + 4.5;
    doc.setFontSize(7.5);
    for (var i = 0; i < rows; i++) {
      var extra = 0;
      if (i < izq.length) {
        doc.setFont(undefined, 'bold');
        doc.setTextColor(primary[0], primary[1], primary[2]);
        doc.text(izq[i][0] + ':', 16, y);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(darkText[0], darkText[1], darkText[2]);
        var ll = doc.splitTextToSize(String(izq[i][1] || '—'), leftMax);
        doc.text(ll, valX, y);
        extra = Math.max(extra, (ll.length - 1) * 3);
      }
      if (i < der.length) {
        doc.setFont(undefined, 'bold');
        doc.setTextColor(primary[0], primary[1], primary[2]);
        doc.text(der[i][0] + ':', rLabelX, y);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(darkText[0], darkText[1], darkText[2]);
        var rl = doc.splitTextToSize(String(der[i][1] || '—'), rightMax);
        doc.text(rl, rValX, y);
        extra = Math.max(extra, (rl.length - 1) * 3);
      }
      y += rowGap + extra;
      if (i < rows - 1) {
        doc.setDrawColor(200, 210, 220);
        doc.setLineWidth(0.2);
        doc.line(14, y - 2.6, pw - 14, y - 2.6);
      }
    }
    var bottom = y - rowGap + 2.2;
    doc.setDrawColor(140, 155, 175);
    doc.setLineWidth(0.4);
    doc.rect(14, y0, totalW, bottom - y0);
    doc.setLineWidth(0.2);
    doc.setDrawColor(200, 210, 220);
    doc.line(midX, y0, midX, bottom);
    return bottom;
  }

  drawBand();
  var gridBottom = drawGrid(BAND_H + 4);

  var productos = data.productos || [];
  var hayBonif = productos.some(function(p) { return String(p.bonificado || '').trim() === 'Sí'; });
  var head = ['#', 'Producto', 'Presentación', 'Cantidad', 'Val. Unitario', 'Val. Total'];
  if (hayBonif) head.push('Bonif.');
  var body = productos.map(function(p, i) {
    var fila = [i + 1, String(p.producto || ''), String(p.presentacion || ''), Number(p.cantidad) || 0, fmtMoney(p.valor_unitario), fmtMoney(p.valor_total)];
    if (hayBonif) fila.push(String(p.bonificado || '').trim() === 'Sí' ? 'Sí' : 'No');
    return fila;
  });
  var colStyles = {
    0: { halign: 'center', cellWidth: 10 },
    1: { cellWidth: 62 },
    3: { halign: 'right', cellWidth: 18 },
    4: { halign: 'right', cellWidth: 26 },
    5: { halign: 'right', cellWidth: 26 }
  };
  if (hayBonif) colStyles[6] = { halign: 'center', cellWidth: 14 };

  doc.autoTable({
    startY: gridBottom + 4,
    head: [head],
    body: body,
    theme: 'grid',
    headStyles: { fillColor: primary, fontSize: 7, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35, cellPadding: 1.2 },
    bodyStyles: { fontSize: 7, lineColor: [90, 90, 90], lineWidth: 0.3 },
    columnStyles: colStyles,
    // Las páginas siguientes llevan solo el membrete; deja ~16 mm al pie para el total y el pie.
    margin: { top: BAND_H + 4, left: 14, right: 14, bottom: 16 },
    styles: { cellPadding: 1.2, lineColor: [90, 90, 90], lineWidth: 0.3 },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.5,
    didDrawPage: function(h) { if (h.pageNumber > 1) drawBand(); }
  });

  var y = doc.lastAutoTable.finalY + 5;
  if (y + 10 > ph - 12) { doc.addPage(); drawBand(); y = BAND_H + 9; }

  doc.setFont(undefined, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(grayText[0], grayText[1], grayText[2]);
  doc.text('Cotización válida hasta el ' + data.vigente + '.', 14, y + 2);

  doc.setFillColor(totalFill[0], totalFill[1], totalFill[2]);
  doc.roundedRect(pw - 82, y - 4, 68, 9, 2.5, 2.5, 'F');
  doc.setFontSize(9);
  doc.setTextColor(primary[0], primary[1], primary[2]);
  doc.setFont(undefined, 'bold');
  doc.text('Total: ' + fmtMoney(data.total), pw - 16, y + 2, { align: 'right' });
  y += 11;

  if (data.observaciones) {
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
    var obsLines = doc.splitTextToSize(String(data.observaciones), pw - 28 - 36);
    var obsH = Math.max(9, obsLines.length * 3.1 + 4);
    if (y + obsH > ph - 12) { doc.addPage(); drawBand(); y = BAND_H + 9; }
    doc.setFillColor(254, 249, 231);
    doc.roundedRect(14, y - 4, pw - 28, obsH, 2, 2, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(125, 102, 8);
    doc.text('Observaciones:', 18, y);
    doc.setFont(undefined, 'normal');
    doc.text(obsLines, 50, y);
  }

  var totalPg = doc.internal.getNumberOfPages();
  var genStamp = new Date().toLocaleString('es-CO');
  for (var pp = 1; pp <= totalPg; pp++) {
    doc.setPage(pp);
    doc.setFontSize(5.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('Generado: ' + genStamp, 14, ph - 3.5);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(primary[0], primary[1], primary[2]);
    doc.text('COTIZACIÓN ' + data.numero, pw / 2, ph - 3.5, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('Pagina ' + pp + ' de ' + totalPg, pw - 14, ph - 3.5, { align: 'right' });
  }

  var fileName = 'Cotizacion_' + (data.sigla || 'COT') + '_' + (data.consecutivo || 'nueva') + '.pdf';
  if (data.return_doc) return { doc: doc, filename: fileName };
  doc.save(fileName);
}

// pedidos.js lanza su primer loadFromAPI() al terminar de ejecutarse, ANTES de que este
// archivo exista: ese primer llamado a initCotizacionesTab() puede perderse. Por eso la
// pestaña también se muestra aquí en cuanto hay sesión (loadFromAPI la vuelve a mostrar).
if (typeof _authReady !== 'undefined') _authReady.then(initCotizacionesTab);

// Clic fuera del detalle lo cierra (mismo criterio que los demás modales).
(function() {
  var ov = document.getElementById('cot-det-overlay');
  if (ov) ov.addEventListener('click', function(e) { if (isBackdropClick(e)) cotCerrarDetalle(); });
})();
