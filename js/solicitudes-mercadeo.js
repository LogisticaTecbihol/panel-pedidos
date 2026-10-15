// ══════════════════════════════════════════════════════════════
// Solicitudes a Mercadeo — formulario, "Mis solicitudes" y aprobación
// ══════════════════════════════════════════════════════════════
// Flujo (misma lógica que las solicitudes de muestras): la solicitud se guarda en Pedidos
// como "Por aprobar"; un aprobador (admin o permiso "Aprobar solicitudes a Mercadeo") la
// aprueba o la rechaza con motivo. SOLO al aprobarse llega al Tablero de Mercadeo de
// panel-pqrs, donde queda en "Recibido". Si quien envía ya puede aprobar, se aprueba sola.
// Una solicitud rechazada se puede editar y reenviar.
//
// Todo pasa por la Edge Function `solicitud-mercadeo` (sesión, permiso y empresas). Los
// adjuntos suben directo al Storage de pqrs con URLs firmadas que entrega la función
// (la clave anon de pqrs es pública; por sí sola no da acceso a nada).
// Depende de: _sb, _authReady, EMPRESAS_HOLDING, escHtml, showToast, fmtDate, today
// (shared.js) y AUTH (auth.js).

var SM_PQRS_URL = 'https://kvfqcymeihglohkcckdp.supabase.co';
var SM_PQRS_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2ZnFjeW1laWhnbG9oa2Nja2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTQyNjksImV4cCI6MjEwNTA3MDI2OX0.kdutwtsqpUDC6v9r7FPWTSKLFW62SMGy_1F41Fcv8Mk';
var SM_BUCKET = 'mercadeo-adjuntos';

var SM_MAX_ARCHIVOS = 5;
var SM_MAX_BYTES = 25 * 1024 * 1024;
var SM_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ai', 'psd', 'eps',
  'mp4', 'mov', 'mp3', 'wav', 'zip'];

// Asuntos del formulario (códigos = los que guarda el Tablero) con sus ejemplos.
var SM_ASUNTOS = [
  { k: 'material_pop',                t: 'Material POP',                              ej: 'por ejemplo: gorras, camisetas, pocillos, esferos' },
  { k: 'material_impreso',            t: 'Material impreso',                          ej: 'por ejemplo: flyers, folletos, afiches, tarjetas, talonarios, post-its' },
  { k: 'piezas_graficas',             t: 'Piezas gráficas',                           ej: 'por ejemplo: carrusel, una imagen para un producto, etc.' },
  { k: 'piezas_audiovisuales',        t: 'Piezas audiovisuales',                      ej: 'por ejemplo: videos, audios' },
  { k: 'diseno_nuevo_producto',       t: 'Diseño de nuevo producto',                  ej: '' },
  { k: 'diseno_ajuste_portafolios',   t: 'Diseño y ajuste de portafolios',            ej: '' },
  { k: 'diseno_ajuste_institucional', t: 'Diseño y ajuste de material institucional', ej: 'por ejemplo: carnets, membretes' },
  { k: 'desarrollo_marca',            t: 'Desarrollo de marca',                       ej: 'por ejemplo: Brand book' },
  { k: 'otros',                       t: 'Otros',                                     ej: 'por ejemplo: ajuste de fichas técnicas u hojas de seguridad' }
];

// Texto de cada opción del desplegable: nombre + ejemplos entre paréntesis (si los tiene).
function smAsuntoOpcion(a) { return a.t + (a.ej ? ' (' + a.ej + ')' : ''); }

// Estado que ve el solicitante. Primero el de la aprobación; ya aprobada, el del Tablero
// (el código 'solicitada' del Tablero se muestra como "Recibido").
var SM_ESTADOS = {
  por_aprobar:   { t: 'Por aprobar',   cls: 'b-pendiente-aprob' },
  rechazada:     { t: 'Rechazada',     cls: 'b-anulado' },
  rechazada_mercadeo: { t: 'Rechazada por Mercadeo', cls: 'b-anulado' },
  aprobada:      { t: 'Aprobada',      cls: 'b-ent' },
  solicitada:    { t: 'Recibido',      cls: 'b-rec' },
  confirmada:    { t: 'Confirmada',    cls: 'b-par' },
  en_produccion: { t: 'En producción', cls: 'b-alistado' },
  en_validacion: { t: 'En validación', cls: 'b-fac' },
  entregada:     { t: 'Entregada',     cls: 'b-ent' },
  cancelada:     { t: 'Cancelada',     cls: 'b-anulado' }
};

var SM_ROLES = {
  admin: 'Admin', editor: 'Editor', lector: 'Lector', comercial: 'Comercial', despachador: 'Despachador',
  contabilidad: 'Contabilidad', gerente_iaso: 'Gerente IASO', remisionador: 'Remisionador',
  cartera: 'Cartera', produccion: 'Producción', mercadeo: 'Mercadeo'
};

var _sm = {
  combo: { opciones: [], visibles: [], activo: -1, ultimo: '' },   // combo de "Solicitante"
  ctx: null,          // { yo, empresas, usuarios, puede_aprobar, pendientes }
  requestId: null,    // se mantiene entre reintentos del MISMO envío (idempotencia)
  editando: null,     // solicitud rechazada que se está corrigiendo (objeto) o null
  keep: [],           // archivos ya subidos que se conservan al editar [{path,nombre,tamano,tipo}]
  files: [],          // File[] nuevos elegidos
  uploaded: {},       // clave archivo -> { path, nombre, tamano, tipo } ya subido para este requestId
  enviando: false,
  lista: [],          // Mis solicitudes
  pend: [],           // por aprobar (aprobadores)
  detalle: null,      // { origen: 'mis'|'pend', idx }
  rechazando: null,   // solicitud que se está rechazando
  pqrs: null
};

function smEl(id) { return document.getElementById(id); }

function smAsunto(k) {
  for (var i = 0; i < SM_ASUNTOS.length; i++) if (SM_ASUNTOS[i].k === k) return SM_ASUNTOS[i];
  return null;
}

// Nombre del asunto de una solicitud; con "Otros" agrega el asunto que escribió el solicitante.
function smAsuntoTexto(s) {
  var a = smAsunto(s.asunto);
  var t = a ? a.t : String(s.asunto || '—');
  return s.asunto === 'otros' && s.asunto_otro ? t + ' — ' + s.asunto_otro : t;
}

function smRef(s) { return 'SM-' + s.numero; }

function smEstadoDe(k) { return SM_ESTADOS[k] || { t: String(k || '—'), cls: '' }; }

// Estado completo de una solicitud para mostrar.
function smEstadoSolicitud(s) {
  if (s.estado_aprobacion === 'Por aprobar') return SM_ESTADOS.por_aprobar;
  if (s.estado_aprobacion === 'Rechazada') return s.rechazada_por_mercadeo ? SM_ESTADOS.rechazada_mercadeo : SM_ESTADOS.rechazada;
  return s.estado ? smEstadoDe(s.estado) : SM_ESTADOS.aprobada;
}

function smNuevoRequestId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  var b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

function smFmtTam(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB'; }
function smFmtFechaHora(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  if (isNaN(d)) return String(ts);
  return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function smClaveArchivo(f) { return f.name + '|' + f.size + '|' + (f.lastModified || 0); }
function smExt(nombre) {
  var i = String(nombre).lastIndexOf('.');
  return i >= 0 ? String(nombre).slice(i + 1).toLowerCase() : '';
}

// ── Llamada a la Edge Function (con el mensaje de error legible) ──
async function smInvocar(body) {
  var res = await _sb.functions.invoke('solicitud-mercadeo', { body: body });
  if (res.error) {
    var msg = 'No se pudo completar la operación';
    try {
      var j = await res.error.context.json();
      if (j && j.error) msg = j.error;
    } catch (_e) { /* sin cuerpo legible */ }
    throw new Error(msg);
  }
  if (!res.data || !res.data.ok) throw new Error((res.data && res.data.error) || 'Respuesta inesperada del servidor');
  return res.data;
}

// ── Arranque ──
async function smInit() {
  smEl('load-zone').style.display = '';
  smEl('main').style.display = 'none';
  smEl('btn-retry').style.display = 'none';
  smEl('load-error').textContent = '';
  try {
    await _authReady;
    _sm.ctx = await smInvocar({ action: 'contexto' });
    smPoblarFormulario();
    smResetForm();
    var aprobar = !!_sm.ctx.puede_aprobar;
    smEl('sm-tab-aprobar').style.display = aprobar ? '' : 'none';
    if (aprobar) smEl('sm-ct-aprobar').textContent = _sm.ctx.pendientes || 0;
    smEl('load-zone').style.display = 'none';
    smEl('main').style.display = 'block';
    // Aviso de la campanita: ?tab=aprobar abre directamente la bandeja de aprobación.
    var qs = new URLSearchParams(location.search);
    var tab = qs.get('tab');
    if (tab === 'aprobar' && aprobar) smCambiarTab('aprobar');
    else if (tab === 'mis') smCambiarTab('mis');
  } catch (err) {
    smEl('load-error').textContent = err.message;
    smEl('btn-retry').style.display = '';
  }
}

function smPoblarFormulario() {
  var ctx = _sm.ctx;

  smComboCargar();

  var nombres = {};
  EMPRESAS_HOLDING.forEach(function (e) { nombres[e.sigla] = e.value; });
  var emp = '';
  if (ctx.empresas.length !== 1) emp += '<option value="">— Seleccionar —</option>';
  ctx.empresas.forEach(function (s) {
    emp += '<option value="' + escHtml(s) + '">' + escHtml(s) + (nombres[s] ? ' — ' + escHtml(nombres[s]) : '') + '</option>';
  });
  smEl('sm-empresa').innerHTML = emp;
  smEl('sm-aviso-sin-empresa').style.display = ctx.empresas.length ? 'none' : '';
  smEl('sm-enviar').disabled = !ctx.empresas.length;

  var as = '<option value="">— Seleccionar —</option>';
  SM_ASUNTOS.forEach(function (a) { as += '<option value="' + a.k + '">' + escHtml(smAsuntoOpcion(a)) + '</option>'; });
  smEl('sm-asunto').innerHTML = as;

  // El estado inicial es "Por aprobar"; si quien envía ya puede aprobar, pasa directo a Mercadeo.
  smEl('sm-estado').value = 'Por aprobar';
  smEl('sm-estado-hint').textContent = ctx.puede_aprobar
    ? 'Como tienes permiso de aprobar, tu solicitud se aprueba sola y pasa directo a Mercadeo.'
    : 'Un aprobador la revisa; al aprobarla pasa a Mercadeo.';
}

// ── Combo "Solicitante": todos los usuarios activos del panel, con búsqueda por nombre ──
function smNorm(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function smEtiqueta(o) { return o.yo ? o.nombre + ' (yo)' : o.nombre; }

function smComboCargar() {
  var ctx = _sm.ctx;
  // Versiones anteriores del servidor solo mandaban "comerciales" (sin el propio usuario).
  var lista = (ctx.usuarios || ctx.comerciales || []).slice();
  if (!lista.some(function (u) { return u.id === ctx.yo.id; })) {
    lista.push({ id: ctx.yo.id, nombre: ctx.yo.nombre, rol: ctx.yo.rol });
  }
  _sm.combo.opciones = lista.map(function (u) {
    return { id: u.id, nombre: u.nombre, rol: u.rol, yo: u.id === ctx.yo.id };
  }).sort(function (a, b) {
    if (a.yo !== b.yo) return a.yo ? -1 : 1;                        // el propio usuario primero
    return String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });
  });
}

function smComboOpcion(id) {
  for (var i = 0; i < _sm.combo.opciones.length; i++) if (_sm.combo.opciones[i].id === id) return _sm.combo.opciones[i];
  return null;
}

function smSolicitanteId() { return smEl('sm-solicitante-id').value || ''; }

function smComboCerrar() {
  smEl('sm-solicitante-lista').style.display = 'none';
  smEl('sm-solicitante').setAttribute('aria-expanded', 'false');
  smEl('sm-solicitante').removeAttribute('aria-activedescendant');
}

function smComboElegir(id) {
  var o = smComboOpcion(id);
  if (!o) return;
  smEl('sm-solicitante-id').value = o.id;
  smEl('sm-solicitante').value = smEtiqueta(o);
  _sm.combo.ultimo = o.id;
  smComboCerrar();
}

function smComboPintar() {
  var ul = smEl('sm-solicitante-lista');
  var c = _sm.combo;
  if (!c.visibles.length) {
    ul.innerHTML = '<li class="vacio" role="option" aria-disabled="true">Sin resultados</li>';
    return;
  }
  var sel = smSolicitanteId();
  ul.innerHTML = c.visibles.map(function (o, i) {
    return '<li role="option" id="sm-op-' + i + '" data-id="' + escHtml(o.id) + '"' +
      ' class="' + (i === c.activo ? 'activo ' : '') + (o.id === sel ? 'sel' : '') + '"' +
      ' aria-selected="' + (o.id === sel ? 'true' : 'false') + '">' +
      '<span>' + escHtml(smEtiqueta(o)) + '</span>' +
      '<span class="rol">' + escHtml(SM_ROLES[o.rol] || o.rol || '') + '</span></li>';
  }).join('');
  if (c.activo >= 0) {
    smEl('sm-solicitante').setAttribute('aria-activedescendant', 'sm-op-' + c.activo);
    var li = document.getElementById('sm-op-' + c.activo);
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }
}

// Abre la lista filtrando por nombre: todas las palabras escritas deben aparecer (sin importar tildes ni mayúsculas).
function smComboAbrir(filtro) {
  var palabras = smNorm(filtro).split(/\s+/).filter(Boolean);
  var c = _sm.combo;
  c.visibles = c.opciones.filter(function (o) {
    var h = smNorm(o.nombre);
    return palabras.every(function (p) { return h.indexOf(p) >= 0; });
  });
  c.activo = c.visibles.length ? 0 : -1;
  smEl('sm-solicitante-lista').style.display = '';
  smEl('sm-solicitante').setAttribute('aria-expanded', 'true');
  smComboPintar();
}

function smComboAlEnfocar() {
  // Si el cuadro muestra la selección actual, se ofrece la lista completa (no filtrada por ese texto).
  var o = smComboOpcion(smSolicitanteId());
  var inp = smEl('sm-solicitante');
  smComboAbrir(o && inp.value === smEtiqueta(o) ? '' : inp.value);
}

function smComboAlTeclear(e) {
  var c = _sm.combo;
  var abierta = smEl('sm-solicitante-lista').style.display !== 'none';
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!abierta) { smComboAlEnfocar(); return; }
    if (!c.visibles.length) return;
    c.activo = (c.activo + (e.key === 'ArrowDown' ? 1 : -1) + c.visibles.length) % c.visibles.length;
    smComboPintar();
  } else if (e.key === 'Enter') {
    if (abierta) {
      e.preventDefault();                       // no enviar nada con Enter
      if (c.activo >= 0 && c.visibles[c.activo]) smComboElegir(c.visibles[c.activo].id);
    }
  } else if (e.key === 'Escape') {
    if (abierta) { e.preventDefault(); smComboAlSalir(); }
  }
}

// Al salir: si el texto no corresponde a una selección válida, vuelve a la última elegida.
function smComboAlSalir() {
  var inp = smEl('sm-solicitante');
  if (!smSolicitanteId()) {
    var t = smNorm(inp.value);
    var exactos = _sm.combo.opciones.filter(function (o) { return smNorm(o.nombre) === t || smNorm(smEtiqueta(o)) === t; });
    if (exactos.length === 1) smComboElegir(exactos[0].id);
    else if (_sm.combo.ultimo) smComboElegir(_sm.combo.ultimo);
  } else {
    var o = smComboOpcion(smSolicitanteId());
    if (o) inp.value = smEtiqueta(o);
  }
  smComboCerrar();
}

// Con asunto "Otros" aparece el campo para escribir el asunto.
function smMostrarAsuntoOtro(visible) {
  smEl('sm-asunto-otro-box').style.display = visible ? '' : 'none';
}

// ── Formulario ──
function smResetForm() {
  _sm.requestId = smNuevoRequestId();
  _sm.editando = null;
  _sm.keep = [];
  _sm.files = [];
  _sm.uploaded = {};
  _sm.combo.ultimo = '';
  smEl('sm-solicitante-id').value = '';
  smEl('sm-solicitante').value = '';
  if (_sm.ctx) smComboElegir(_sm.ctx.yo.id);
  if (_sm.ctx && _sm.ctx.empresas.length === 1) smEl('sm-empresa').value = _sm.ctx.empresas[0];
  else smEl('sm-empresa').value = '';
  smEl('sm-asunto').value = '';
  smEl('sm-asunto-otro').value = '';
  smMostrarAsuntoOtro(false);
  smEl('sm-fecha').value = '';
  smEl('sm-fecha').min = today();
  smEl('sm-desc').value = '';
  smEl('sm-desc-ct').textContent = '0';
  smEl('sm-files').value = '';
  smEl('sm-progreso').textContent = '';
  smEl('sm-edit-banner').style.display = 'none';
  smEl('sm-enviar').textContent = '📨 Enviar solicitud';
  smRenderArchivos();
}

// Archivos: primero los ya subidos que se conservan (al editar) y luego los nuevos.
function smRenderArchivos() {
  var ul = smEl('sm-files-lista');
  var html = _sm.keep.map(function (a, i) {
    return '<li><span class="nm">📎 ' + escHtml(a.nombre) + ' <em style="color:#718096">(ya enviado)</em></span><span class="sz">' + escHtml(smFmtTam(a.tamano)) + '</span>' +
      '<button type="button" data-sm-quitar-keep="' + i + '" aria-label="Quitar ' + escHtml(a.nombre) + '">✕</button></li>';
  }).join('') + _sm.files.map(function (f, i) {
    return '<li><span class="nm">📎 ' + escHtml(f.name) + '</span><span class="sz">' + escHtml(smFmtTam(f.size)) + '</span>' +
      '<button type="button" data-sm-quitar="' + i + '" aria-label="Quitar ' + escHtml(f.name) + '">✕</button></li>';
  }).join('');
  ul.innerHTML = html;
}

function smAgregarArchivos(lista) {
  var errores = [];
  for (var i = 0; i < lista.length; i++) {
    var f = lista[i];
    if (_sm.keep.length + _sm.files.length >= SM_MAX_ARCHIVOS) { errores.push('Máximo ' + SM_MAX_ARCHIVOS + ' archivos'); break; }
    if (SM_EXT.indexOf(smExt(f.name)) < 0) { errores.push('"' + f.name + '" no es de un tipo permitido'); continue; }
    if (f.size > SM_MAX_BYTES) { errores.push('"' + f.name + '" supera 25 MB'); continue; }
    if (f.size <= 0) { errores.push('"' + f.name + '" está vacío'); continue; }
    var dup = _sm.files.some(function (x) { return smClaveArchivo(x) === smClaveArchivo(f); });
    if (!dup) _sm.files.push(f);
  }
  smEl('sm-files').value = '';
  smRenderArchivos();
  if (errores.length) showToast(errores.join('. '), '#e74c3c');
}

function smLeerFormulario() {
  var solId = smSolicitanteId();
  return {
    solicitante_id: solId,
    // El propio usuario no es "a nombre de" nadie: se manda vacío.
    a_nombre_de_id: solId && _sm.ctx && solId !== _sm.ctx.yo.id ? solId : null,
    empresa: smEl('sm-empresa').value,
    asunto: smEl('sm-asunto').value,
    // Solo cuenta con asunto "Otros".
    asunto_otro: smEl('sm-asunto').value === 'otros' ? smEl('sm-asunto-otro').value.trim().replace(/\s+/g, ' ') : null,
    fecha_tentativa: smEl('sm-fecha').value,
    descripcion: smEl('sm-desc').value.trim()
  };
}

function smValidar(d) {
  if (!d.solicitante_id || !smComboOpcion(d.solicitante_id)) return 'Elige el solicitante de la lista';
  if (!d.empresa) return 'Elige la empresa';
  if (!d.asunto) return 'Elige el asunto';
  if (d.asunto === 'otros') {
    if (!d.asunto_otro || d.asunto_otro.length < 3) return 'Escribe el asunto (mínimo 3 caracteres)';
    if (d.asunto_otro.length > 100) return 'El asunto no puede superar 100 caracteres';
  }
  if (!d.fecha_tentativa) return 'Indica la fecha tentativa';
  if (d.fecha_tentativa < today()) return 'La fecha tentativa no puede ser anterior a hoy';
  if (d.descripcion.length < 10) return 'Describe la solicitud (mínimo 10 caracteres)';
  if (d.descripcion.length > 2000) return 'La descripción no puede superar 2000 caracteres';
  return null;
}

function smClientePqrs() {
  if (!_sm.pqrs) {
    _sm.pqrs = supabase.createClient(SM_PQRS_URL, SM_PQRS_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return _sm.pqrs;
}

// Sube los archivos nuevos que falten para este envío y devuelve la lista completa para `crear`/`reenviar`.
async function smSubirArchivos() {
  var pendientes = _sm.files.filter(function (f) { return !_sm.uploaded[smClaveArchivo(f)]; });
  if (pendientes.length) {
    var prep = await smInvocar({
      action: 'preparar',
      request_id: _sm.requestId,
      archivos: pendientes.map(function (f) { return { nombre: f.name, tamano: f.size, tipo: f.type || null }; })
    });
    if (!prep.archivos || prep.archivos.length !== pendientes.length) throw new Error('No se pudo preparar la subida de archivos');
    var storage = smClientePqrs().storage.from(SM_BUCKET);
    for (var i = 0; i < pendientes.length; i++) {
      var f = pendientes[i], u = prep.archivos[i];
      smEl('sm-progreso').textContent = 'Subiendo archivo ' + (i + 1) + ' de ' + pendientes.length + '…';
      var up = await storage.uploadToSignedUrl(u.path, u.token, f, f.type ? { contentType: f.type } : undefined);
      if (up.error) throw new Error('No se pudo subir "' + f.name + '": ' + (up.error.message || 'error de red'));
      _sm.uploaded[smClaveArchivo(f)] = { path: u.path, nombre: f.name, tamano: f.size, tipo: f.type || null };
    }
  }
  var nuevos = _sm.files.map(function (f) { return _sm.uploaded[smClaveArchivo(f)]; });
  return _sm.keep.map(function (a) { return { path: a.path, nombre: a.nombre, tamano: a.tamano, tipo: a.tipo }; }).concat(nuevos);
}

async function smEnviar() {
  if (_sm.enviando) return;                       // candado anti doble clic
  var d = smLeerFormulario();
  var err = smValidar(d);
  if (err) { showToast(err, '#e74c3c'); return; }

  _sm.enviando = true;
  var btn = smEl('sm-enviar');
  var reenvio = !!_sm.editando;
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    var archivos = await smSubirArchivos();
    smEl('sm-progreso').textContent = 'Registrando la solicitud…';
    var res = await smInvocar({
      action: reenvio ? 'reenviar' : 'crear',
      request_id: reenvio ? _sm.editando.id : _sm.requestId,
      a_nombre_de_id: d.a_nombre_de_id,
      empresa: d.empresa,
      asunto: d.asunto,
      asunto_otro: d.asunto_otro,
      fecha_tentativa: d.fecha_tentativa,
      descripcion: d.descripcion,
      archivos: archivos
    });
    var s = res.solicitud || {};
    if (s.estado_aprobacion === 'Aprobada') {
      showToast('✅ Solicitud ' + smRef(s) + ' enviada: ya está con Mercadeo (Recibido)', '#27ae60');
    } else {
      showToast('✅ Solicitud ' + smRef(s) + (reenvio ? ' reenviada' : ' enviada') + ': queda por aprobar', '#27ae60');
    }
    if (res.aviso) showToast('⚠ ' + res.aviso + '. Queda por aprobar.', '#e67e22');
    smResetForm();
    smCambiarTab('mis');
  } catch (e) {
    smEl('sm-progreso').textContent = '';
    showToast(e.message, '#e74c3c');
  } finally {
    _sm.enviando = false;
    btn.disabled = !(_sm.ctx && _sm.ctx.empresas.length);
    btn.textContent = _sm.editando ? '📨 Reenviar a aprobación' : '📨 Enviar solicitud';
  }
}

// ── Editar y reenviar una solicitud rechazada ──
function smEditar(s) {
  if (!s || !s.puede_editar) return;
  smResetForm();
  _sm.editando = s;
  _sm.requestId = s.id;                           // mismo id: los archivos nuevos van a su carpeta
  _sm.keep = (s.archivos || []).slice();
  if (s.a_nombre_de_id && smComboOpcion(s.a_nombre_de_id)) smComboElegir(s.a_nombre_de_id);
  if (_sm.ctx.empresas.indexOf((s.empresas || [])[0]) >= 0) smEl('sm-empresa').value = s.empresas[0];
  smEl('sm-asunto').value = s.asunto;
  smEl('sm-asunto-otro').value = s.asunto_otro || '';
  smMostrarAsuntoOtro(s.asunto === 'otros');
  // La fecha tentativa anterior puede haber pasado: si es así se pide una nueva.
  smEl('sm-fecha').value = s.fecha_tentativa && s.fecha_tentativa >= today() ? s.fecha_tentativa : '';
  smEl('sm-desc').value = s.descripcion || '';
  smEl('sm-desc-ct').textContent = (s.descripcion || '').length;
  smEl('sm-edit-banner').style.display = '';
  smEl('sm-edit-banner').innerHTML = '✏️ Editando la solicitud <strong>' + escHtml(smRef(s)) + '</strong>, rechazada' +
    (s.rechazada_por_mercadeo
      ? ' por Mercadeo' + (s.aprobada_por ? ' (' + escHtml(s.aprobada_por) + ')' : '')
      : (s.aprobada_por ? ' por ' + escHtml(s.aprobada_por) : '')) + '.' +
    (s.motivo_rechazo ? ' <strong>Motivo:</strong> ' + escHtml(s.motivo_rechazo) : '') +
    ' Corrígela y reenvíala; “Limpiar” cancela la edición.';
  smEl('sm-enviar').textContent = '📨 Reenviar a aprobación';
  smRenderArchivos();
  smCerrarDetalle();
  smCambiarTab('nueva');
}

// ── Pestañas ──
function smCambiarTab(cual) {
  var vistas = { nueva: 'sm-vista-nueva', mis: 'sm-vista-mis', aprobar: 'sm-vista-aprobar' };
  Object.keys(vistas).forEach(function (k) {
    smEl(vistas[k]).style.display = k === cual ? '' : 'none';
    smEl('sm-tab-' + k).classList.toggle('active', k === cual);
  });
  if (cual === 'mis') smCargarLista();
  if (cual === 'aprobar') smCargarPendientes();
}

// ── Utilidades de pintado ──
function smEmpresaChips(arr) {
  return (arr || []).map(function (e) { return '<span class="sigla-badge sigla-' + escHtml(e) + '">' + escHtml(e) + '</span>'; }).join(' ');
}

// ── Mis solicitudes ──
async function smCargarLista() {
  var tbody = smEl('sm-lista');
  tbody.innerHTML = '<tr><td colspan="9" class="empty">Cargando…</td></tr>';
  try {
    var r = await smInvocar({ action: 'listar' });
    _sm.lista = r.solicitudes || [];
    smEl('sm-aviso-mercadeo').style.display = r.mercadeo_disponible === false ? '' : 'none';
    smRenderLista();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No se pudieron cargar tus solicitudes: ' + escHtml(e.message) + '</td></tr>';
  }
}

function smRenderLista() {
  var tbody = smEl('sm-lista');
  smEl('sm-ct-mis').textContent = _sm.lista.length;
  smEl('sm-row-ct').textContent = '(' + _sm.lista.length + ')';
  if (!_sm.lista.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Todavía no has enviado solicitudes.</td></tr>';
    return;
  }
  tbody.innerHTML = _sm.lista.map(function (s, i) {
    var st = smEstadoSolicitud(s);
    var comprometida = s.estado_aprobacion === 'Aprobada'
      ? (s.fecha_comprometida ? fmtDate(s.fecha_comprometida) : 'Por definir')
      : '—';
    return '<tr>' +
      '<td>' + escHtml(smRef(s)) + '</td>' +
      '<td>' + escHtml(smFmtFechaHora(s.creada_en)) + '</td>' +
      '<td>' + escHtml(smAsuntoTexto(s)) + '</td>' +
      '<td>' + smEmpresaChips(s.empresas) + '</td>' +
      '<td>' + escHtml(s.a_nombre_de || '—') + '</td>' +
      '<td>' + escHtml(fmtDate(s.fecha_tentativa)) + '</td>' +
      '<td>' + escHtml(comprometida) + '</td>' +
      '<td><span class="badge ' + st.cls + '">' + escHtml(st.t) + '</span></td>' +
      '<td><button class="btn-ver" type="button" data-sm-ver="mis:' + i + '">Ver</button>' +
      (s.puede_editar ? ' <button class="btn-ver" type="button" style="background:#b7791f" data-sm-editar="' + i + '">✏️ Editar y reenviar</button>' : '') +
      '</td></tr>';
  }).join('');
}

// ── Por aprobar (aprobadores) ──
async function smCargarPendientes() {
  var tbody = smEl('sm-lista-aprobar');
  tbody.innerHTML = '<tr><td colspan="8" class="empty">Cargando…</td></tr>';
  try {
    var r = await smInvocar({ action: 'pendientes' });
    _sm.pend = r.solicitudes || [];
    smEl('sm-ct-aprobar').textContent = _sm.pend.length;
    smRenderPendientes();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No se pudieron cargar las pendientes: ' + escHtml(e.message) + '</td></tr>';
  }
}

function smRenderPendientes() {
  var tbody = smEl('sm-lista-aprobar');
  smEl('sm-row-ct-aprobar').textContent = '(' + _sm.pend.length + ')';
  if (!_sm.pend.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No hay solicitudes por aprobar. 🎉</td></tr>';
    return;
  }
  tbody.innerHTML = _sm.pend.map(function (s, i) {
    return '<tr>' +
      '<td>' + escHtml(smRef(s)) + '</td>' +
      '<td>' + escHtml(smFmtFechaHora(s.creada_en)) + '</td>' +
      '<td>' + escHtml(s.solicitante || '—') + '</td>' +
      '<td>' + escHtml(s.a_nombre_de || '—') + '</td>' +
      '<td>' + escHtml(smAsuntoTexto(s)) + '</td>' +
      '<td>' + smEmpresaChips(s.empresas) + '</td>' +
      '<td>' + escHtml(fmtDate(s.fecha_tentativa)) + '</td>' +
      '<td><button class="btn-ver" type="button" data-sm-ver="pend:' + i + '">Revisar</button> ' +
      '<button class="btn-ver" type="button" style="background:#27ae60" data-sm-aprobar="' + i + '">✅ Aprobar</button> ' +
      '<button class="btn-ver" type="button" style="background:#c0392b" data-sm-rechazar="' + i + '">❌ Rechazar</button></td>' +
      '</tr>';
  }).join('');
}

async function smAprobar(i) {
  var s = _sm.pend[i];
  if (!s) return;
  if (!confirm('¿Aprobar la solicitud ' + smRef(s) + '? Pasará al equipo de Mercadeo.')) return;
  try {
    await smInvocar({ action: 'aprobar', id: s.id });
    showToast('✅ Solicitud ' + smRef(s) + ' aprobada: ya está con Mercadeo', '#27ae60');
  } catch (e) {
    showToast(e.message, '#e74c3c');
  }
  smCerrarDetalle();
  await smCargarPendientes();
}

function smPedirRechazo(i) {
  var s = _sm.pend[i];
  if (!s) return;
  _sm.rechazando = s;
  smEl('sm-rej-detalle').textContent = smRef(s) + ' · ' + smAsuntoTexto(s) + ' · ' + (s.solicitante || '');
  smEl('sm-rej-motivo').value = '';
  smEl('sm-rej-confirmar').disabled = false;
  smEl('sm-rej-overlay').classList.add('show');
  setTimeout(function () { smEl('sm-rej-motivo').focus(); }, 50);
}

function smCerrarRechazo() {
  smEl('sm-rej-overlay').classList.remove('show');
  _sm.rechazando = null;
}

async function smConfirmarRechazo() {
  var s = _sm.rechazando;
  if (!s) return;
  var motivo = smEl('sm-rej-motivo').value.trim();
  if (motivo.length < 3) { showToast('Escribe el motivo del rechazo.', '#e67e22'); return; }
  var btn = smEl('sm-rej-confirmar');
  btn.disabled = true;
  try {
    await smInvocar({ action: 'rechazar', id: s.id, motivo: motivo });
    showToast('✅ Solicitud ' + smRef(s) + ' rechazada', '#27ae60');
    smCerrarRechazo();
    smCerrarDetalle();
    await smCargarPendientes();
  } catch (e) {
    showToast(e.message, '#e74c3c');
    btn.disabled = false;
  }
}

// ── Detalle (de "Mis solicitudes" o de "Por aprobar") ──
var SM_TIPOS_HIST = {
  envio:         function (h) { return 'Enviada por <strong>' + escHtml(h.por) + '</strong>'; },
  reenvio:       function (h) { return 'Corregida y reenviada por <strong>' + escHtml(h.por) + '</strong>'; },
  aprobacion:    function (h) { return '✅ Aprobada por <strong>' + escHtml(h.por) + '</strong>'; },
  autoaprobacion: function (h) { return '✅ Aprobada automáticamente (<strong>' + escHtml(h.por) + '</strong> puede aprobar)'; },
  rechazo:       function (h) { return '❌ Rechazada por <strong>' + escHtml(h.por) + '</strong>' + (h.motivo ? ' — ' + escHtml(h.motivo) : ''); },
  rechazo_mercadeo: function (h) { return '❌ Rechazada por Mercadeo (<strong>' + escHtml(h.por) + '</strong>)' + (h.motivo ? ' — ' + escHtml(h.motivo) : ''); },
  estado:       function (h) { return 'En Mercadeo: <strong>' + escHtml(smEstadoDe(h.estado).t) + '</strong>'; }
};

function smVerDetalle(origen, i) {
  var lista = origen === 'pend' ? _sm.pend : _sm.lista;
  var s = lista[i];
  if (!s) return;
  _sm.detalle = { origen: origen, idx: i };
  var st = smEstadoSolicitud(s);
  smEl('sm-det-titulo').textContent = 'Solicitud ' + smRef(s) + ' — ' + smAsuntoTexto(s);
  smEl('sm-det-meta').innerHTML = '<span>Enviada: ' + escHtml(smFmtFechaHora(s.creada_en)) + '</span>' +
    '<span class="badge ' + st.cls + '">' + escHtml(st.t) + '</span>';

  var historial = (s.historial || []).map(function (h) {
    if (h.tipo === 'respuesta') {
      return '<li class="resp"><div>📣 ' + escHtml(h.texto) + '</div>' +
        '<div class="meta">' + escHtml(h.por || 'Mercadeo') + ' · ' + escHtml(smFmtFechaHora(h.en)) + '</div></li>';
    }
    var f = SM_TIPOS_HIST[h.tipo];
    return '<li' + (h.tipo === 'rechazo' || h.tipo === 'rechazo_mercadeo' ? ' style="border-left-color:#c0392b"' : '') + '><div>' + (f ? f(h) : escHtml(h.tipo)) + '</div>' +
      '<div class="meta">' + escHtml(smFmtFechaHora(h.en)) + '</div></li>';
  }).join('');

  var adjuntos = (s.archivos || []).map(function (x, k) {
    return '<li style="font-size:0.84rem">📎 ' + escHtml(x.nombre) + ' <span style="color:#718096">(' + escHtml(smFmtTam(x.tamano)) + ')</span> ' +
      '<button type="button" class="btn-ver" data-sm-adj="' + origen + ':' + i + ':' + k + '" style="padding:2px 10px">Abrir</button></li>';
  }).join('');

  var aprobacion = '';
  if (s.estado_aprobacion === 'Por aprobar') {
    aprobacion = '<div class="sm-box sm-box-pend">⏳ Por aprobar: un aprobador la revisará antes de que pase a Mercadeo.</div>';
  } else if (s.estado_aprobacion === 'Rechazada') {
    aprobacion = '<div class="sm-box sm-box-rech">❌ Rechazada' + (s.rechazada_por_mercadeo ? ' por Mercadeo' : '') +
      (s.aprobada_por ? (s.rechazada_por_mercadeo ? ' (' : ' por ') + '<strong>' + escHtml(s.aprobada_por) + '</strong>' + (s.rechazada_por_mercadeo ? ')' : '') : '') +
      (s.fecha_aprobacion ? ' el ' + escHtml(smFmtFechaHora(s.fecha_aprobacion)) : '') +
      '<br><strong>Motivo:</strong> ' + escHtml(s.motivo_rechazo || '—') + '</div>';
  } else {
    aprobacion = '<div class="sm-box sm-box-ok">✅ Aprobada' + (s.auto_aprobada ? ' automáticamente' : '') +
      (s.aprobada_por ? ' por <strong>' + escHtml(s.aprobada_por) + '</strong>' : '') +
      (s.fecha_aprobacion ? ' el ' + escHtml(smFmtFechaHora(s.fecha_aprobacion)) : '') + '</div>';
  }

  var enMercadeo = s.estado_aprobacion === 'Aprobada';
  smEl('sm-det-cuerpo').innerHTML = aprobacion +
    '<div class="kv">' +
      '<span class="k">Empresa</span><span>' + escHtml((s.empresas || []).join(', ') || '—') + '</span>' +
      '<span class="k">Solicitante</span><span>' + escHtml(s.solicitante || '—') + '</span>' +
      '<span class="k">A nombre de</span><span>' + escHtml(s.a_nombre_de || '—') + '</span>' +
      '<span class="k">Fecha tentativa</span><span>' + escHtml(fmtDate(s.fecha_tentativa)) + '</span>' +
      (enMercadeo
        ? '<span class="k">Fecha comprometida</span><span>' + escHtml(s.fecha_comprometida ? fmtDate(s.fecha_comprometida) : 'Por definir por Mercadeo') + '</span>' +
          '<span class="k">Entregada</span><span>' + escHtml(s.entregada_en ? smFmtFechaHora(s.entregada_en) : '—') + '</span>' +
          '<span class="k">Responsables</span><span>' + escHtml((s.responsables || []).join(', ') || 'Sin asignar') + '</span>'
        : '') +
    '</div>' +
    '<h4>Descripción</h4><div style="white-space:pre-wrap;font-size:0.88rem">' + escHtml(s.descripcion) + '</div>' +
    '<h4>Archivos enviados</h4>' + (adjuntos ? '<ul style="margin:0;padding-left:18px">' + adjuntos + '</ul>' : '<div class="sm-hint">Sin archivos.</div>') +
    '<h4>Seguimiento</h4>' + (historial ? '<ul class="sm-hist">' + historial + '</ul>' : '<div class="sm-hint">Sin novedades.</div>');

  // Acciones según quién mira y en qué estado está
  var acc = '';
  if (origen === 'pend') {
    acc += '<button class="btn-confirm" type="button" style="background:#27ae60" data-sm-aprobar="' + i + '">✅ Aprobar</button> ' +
      '<button class="btn-confirm" type="button" style="background:#c0392b" data-sm-rechazar="' + i + '">❌ Rechazar</button>';
  } else if (s.puede_editar) {
    acc += '<button class="btn-confirm" type="button" style="background:#b7791f" data-sm-editar="' + i + '">✏️ Editar y reenviar</button>';
  }
  smEl('sm-det-acciones').innerHTML = acc;
  smEl('sm-overlay').classList.add('show');
}

async function smAbrirAdjunto(origen, i, k) {
  var s = (origen === 'pend' ? _sm.pend : _sm.lista)[i];
  if (!s) return;
  // Se abre la pestaña de inmediato (evita el bloqueo de ventanas) y se completa con la URL firmada.
  var w = window.open('', '_blank');
  try {
    var r = await smInvocar({ action: 'archivo_url', id: s.id, indice: k });
    if (w) { w.opener = null; w.location.href = r.url; } else { window.open(r.url, '_blank', 'noopener'); }
  } catch (e) {
    if (w) w.close();
    showToast(e.message, '#e74c3c');
  }
}

function smCerrarDetalle() { smEl('sm-overlay').classList.remove('show'); _sm.detalle = null; }

// ── Eventos ──
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t || !t.closest) return;
  var tab = t.closest('[data-sm-tab]');
  if (tab) { smCambiarTab(tab.getAttribute('data-sm-tab')); return; }
  var quitar = t.closest('[data-sm-quitar]');
  if (quitar) {
    _sm.files.splice(Number(quitar.getAttribute('data-sm-quitar')), 1);
    smRenderArchivos();
    return;
  }
  var quitarKeep = t.closest('[data-sm-quitar-keep]');
  if (quitarKeep) {
    _sm.keep.splice(Number(quitarKeep.getAttribute('data-sm-quitar-keep')), 1);
    smRenderArchivos();
    return;
  }
  var ver = t.closest('[data-sm-ver]');
  if (ver) {
    var p = ver.getAttribute('data-sm-ver').split(':');
    smVerDetalle(p[0], Number(p[1]));
    return;
  }
  var adj = t.closest('[data-sm-adj]');
  if (adj) {
    var a = adj.getAttribute('data-sm-adj').split(':');
    smAbrirAdjunto(a[0], Number(a[1]), Number(a[2]));
    return;
  }
  var ed = t.closest('[data-sm-editar]');
  if (ed) { smEditar(_sm.lista[Number(ed.getAttribute('data-sm-editar'))]); return; }
  var apr = t.closest('[data-sm-aprobar]');
  if (apr) { smAprobar(Number(apr.getAttribute('data-sm-aprobar'))); return; }
  var rec = t.closest('[data-sm-rechazar]');
  if (rec) { smPedirRechazo(Number(rec.getAttribute('data-sm-rechazar'))); return; }
});

document.addEventListener('DOMContentLoaded', function () {
  smEl('sm-enviar').addEventListener('click', smEnviar);
  smEl('sm-limpiar').addEventListener('click', function () { if (!_sm.enviando) smResetForm(); });
  smEl('sm-refrescar').addEventListener('click', smCargarLista);
  smEl('sm-refrescar-aprobar').addEventListener('click', smCargarPendientes);
  smEl('sm-det-cerrar').addEventListener('click', smCerrarDetalle);
  smEl('sm-det-cerrar2').addEventListener('click', smCerrarDetalle);
  smEl('sm-overlay').addEventListener('click', function (e) { if (isBackdropClick(e)) smCerrarDetalle(); });
  smEl('sm-rej-cancelar').addEventListener('click', smCerrarRechazo);
  smEl('sm-rej-confirmar').addEventListener('click', smConfirmarRechazo);
  smEl('sm-rej-overlay').addEventListener('click', function (e) { if (isBackdropClick(e)) smCerrarRechazo(); });
  smEl('sm-files').addEventListener('change', function () { smAgregarArchivos(this.files); });
  // Combo "Solicitante"
  var cbo = smEl('sm-solicitante');
  cbo.addEventListener('focus', smComboAlEnfocar);
  cbo.addEventListener('click', smComboAlEnfocar);
  cbo.addEventListener('input', function () { smEl('sm-solicitante-id').value = ''; smComboAbrir(this.value); });
  cbo.addEventListener('keydown', smComboAlTeclear);
  cbo.addEventListener('blur', smComboAlSalir);
  // mousedown (no click): se elige antes de que el cuadro pierda el foco.
  smEl('sm-solicitante-lista').addEventListener('mousedown', function (e) {
    e.preventDefault();
    var li = e.target.closest ? e.target.closest('li[data-id]') : null;
    if (li) smComboElegir(li.getAttribute('data-id'));
  });
  smEl('sm-desc').addEventListener('input', function () { smEl('sm-desc-ct').textContent = this.value.length; });
  smEl('sm-asunto').addEventListener('change', function () {
    var otros = this.value === 'otros';
    smMostrarAsuntoOtro(otros);
    if (otros) smEl('sm-asunto-otro').focus();
  });
  smInit();
});
