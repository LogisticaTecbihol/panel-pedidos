// ══════════════════════════════════════════════════════════════
// Solicitudes a Mercadeo — formulario + "Mis solicitudes"
// ══════════════════════════════════════════════════════════════
// La solicitud NO se guarda en este proyecto: la Edge Function `solicitud-mercadeo`
// verifica la sesión, el permiso y las empresas del usuario y la reenvía al Tablero
// de Mercadeo de panel-pqrs (otro proyecto Supabase), donde queda en "Recibido".
// Los adjuntos suben directo al Storage de pqrs con URLs firmadas que entrega la
// función (la clave anon de pqrs es pública; por sí sola no da acceso a nada).
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

// El estado que ve el solicitante (el código 'solicitada' del Tablero se muestra como "Recibido").
var SM_ESTADOS = {
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
  ctx: null,          // { yo, empresas, usuarios }
  requestId: null,    // se mantiene entre reintentos del MISMO envío (idempotencia)
  files: [],          // File[] elegidos
  uploaded: {},       // clave archivo -> { path, nombre, tamano, tipo } ya subido para este requestId
  enviando: false,
  lista: [],
  pqrs: null
};

function smEl(id) { return document.getElementById(id); }

function smAsunto(k) {
  for (var i = 0; i < SM_ASUNTOS.length; i++) if (SM_ASUNTOS[i].k === k) return SM_ASUNTOS[i];
  return null;
}
function smEstado(k) { return SM_ESTADOS[k] || { t: String(k || '—'), cls: '' }; }

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
    smEl('load-zone').style.display = 'none';
    smEl('main').style.display = 'block';
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

// ── Formulario ──
function smResetForm() {
  _sm.requestId = smNuevoRequestId();
  _sm.files = [];
  _sm.uploaded = {};
  _sm.combo.ultimo = '';
  smEl('sm-solicitante-id').value = '';
  smEl('sm-solicitante').value = '';
  if (_sm.ctx) smComboElegir(_sm.ctx.yo.id);
  if (_sm.ctx && _sm.ctx.empresas.length === 1) smEl('sm-empresa').value = _sm.ctx.empresas[0];
  else smEl('sm-empresa').value = '';
  smEl('sm-asunto').value = '';
  smEl('sm-fecha').value = '';
  smEl('sm-fecha').min = today();
  smEl('sm-desc').value = '';
  smEl('sm-desc-ct').textContent = '0';
  smEl('sm-files').value = '';
  smEl('sm-progreso').textContent = '';
  smRenderArchivos();
}

function smRenderArchivos() {
  var ul = smEl('sm-files-lista');
  if (!_sm.files.length) { ul.innerHTML = ''; return; }
  ul.innerHTML = _sm.files.map(function (f, i) {
    return '<li><span class="nm">📎 ' + escHtml(f.name) + '</span><span class="sz">' + escHtml(smFmtTam(f.size)) + '</span>' +
      '<button type="button" data-sm-quitar="' + i + '" aria-label="Quitar ' + escHtml(f.name) + '">✕</button></li>';
  }).join('');
}

function smAgregarArchivos(lista) {
  var errores = [];
  for (var i = 0; i < lista.length; i++) {
    var f = lista[i];
    if (_sm.files.length >= SM_MAX_ARCHIVOS) { errores.push('Máximo ' + SM_MAX_ARCHIVOS + ' archivos'); break; }
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
    fecha_tentativa: smEl('sm-fecha').value,
    descripcion: smEl('sm-desc').value.trim()
  };
}

function smValidar(d) {
  if (!d.solicitante_id || !smComboOpcion(d.solicitante_id)) return 'Elige el solicitante de la lista';
  if (!d.empresa) return 'Elige la empresa';
  if (!d.asunto) return 'Elige el asunto';
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

// Sube los archivos que falten para este envío y devuelve la lista completa para `crear`.
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
  return _sm.files.map(function (f) { return _sm.uploaded[smClaveArchivo(f)]; });
}

async function smEnviar() {
  if (_sm.enviando) return;                       // candado anti doble clic
  var d = smLeerFormulario();
  var err = smValidar(d);
  if (err) { showToast(err, '#e74c3c'); return; }

  _sm.enviando = true;
  var btn = smEl('sm-enviar');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    var archivos = await smSubirArchivos();
    smEl('sm-progreso').textContent = 'Registrando la solicitud…';
    var res = await smInvocar({
      action: 'crear',
      request_id: _sm.requestId,
      a_nombre_de_id: d.a_nombre_de_id,
      empresa: d.empresa,
      asunto: d.asunto,
      fecha_tentativa: d.fecha_tentativa,
      descripcion: d.descripcion,
      archivos: archivos
    });
    showToast('✅ Solicitud enviada (N° ' + res.id + '): quedó en estado Recibido', '#27ae60');
    smResetForm();
    smCambiarTab('mis');
  } catch (e) {
    smEl('sm-progreso').textContent = '';
    showToast(e.message, '#e74c3c');
  } finally {
    _sm.enviando = false;
    btn.disabled = !(_sm.ctx && _sm.ctx.empresas.length);
    btn.textContent = '📨 Enviar solicitud';
  }
}

// ── Pestañas ──
function smCambiarTab(cual) {
  var mis = cual === 'mis';
  smEl('sm-vista-nueva').style.display = mis ? 'none' : '';
  smEl('sm-vista-mis').style.display = mis ? '' : 'none';
  smEl('sm-tab-nueva').classList.toggle('active', !mis);
  smEl('sm-tab-mis').classList.toggle('active', mis);
  if (mis) smCargarLista();
}

// ── Mis solicitudes ──
async function smCargarLista() {
  var tbody = smEl('sm-lista');
  tbody.innerHTML = '<tr><td colspan="9" class="empty">Cargando…</td></tr>';
  try {
    var r = await smInvocar({ action: 'listar' });
    _sm.lista = r.solicitudes || [];
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
    var a = smAsunto(s.asunto);
    var st = smEstado(s.estado);
    var aNombre = s.a_nombre_de ? s.a_nombre_de : '—';
    return '<tr>' +
      '<td>' + escHtml(s.id) + '</td>' +
      '<td>' + escHtml(smFmtFechaHora(s.creada_en)) + '</td>' +
      '<td>' + escHtml(a ? a.t : s.asunto) + '</td>' +
      '<td>' + (s.empresas || []).map(function (e) { return '<span class="sigla-badge sigla-' + escHtml(e) + '">' + escHtml(e) + '</span>'; }).join(' ') + '</td>' +
      '<td>' + escHtml(aNombre) + '</td>' +
      '<td>' + escHtml(fmtDate(s.fecha_tentativa)) + '</td>' +
      '<td>' + escHtml(s.fecha_comprometida ? fmtDate(s.fecha_comprometida) : 'Por definir') + '</td>' +
      '<td><span class="badge ' + st.cls + '">' + escHtml(st.t) + '</span></td>' +
      '<td><button class="btn-ver" type="button" data-sm-ver="' + i + '">Ver</button></td>' +
      '</tr>';
  }).join('');
}

function smVerDetalle(i) {
  var s = _sm.lista[i];
  if (!s) return;
  var a = smAsunto(s.asunto);
  var st = smEstado(s.estado);
  smEl('sm-det-titulo').textContent = 'Solicitud N° ' + s.id + ' — ' + (a ? a.t : s.asunto);
  smEl('sm-det-meta').innerHTML = '<span>Enviada: ' + escHtml(smFmtFechaHora(s.creada_en)) + '</span>' +
    '<span class="badge ' + st.cls + '">' + escHtml(st.t) + '</span>';

  var historial = (s.historial || []).map(function (h) {
    if (h.tipo === 'estado') {
      return '<li><div>Cambió a <strong>' + escHtml(smEstado(h.estado).t) + '</strong></div>' +
        '<div class="meta">' + escHtml(smFmtFechaHora(h.en)) + '</div></li>';
    }
    return '<li class="resp"><div>📣 ' + escHtml(h.texto) + '</div>' +
      '<div class="meta">' + escHtml(h.por || 'Mercadeo') + ' · ' + escHtml(smFmtFechaHora(h.en)) + '</div></li>';
  }).join('');

  var adjuntos = (s.adjuntos || []).map(function (x) {
    return '<li style="font-size:0.84rem">📎 ' + escHtml(x.nombre) + ' <span style="color:#718096">(' + escHtml(smFmtTam(x.tamano)) + ')</span></li>';
  }).join('');

  smEl('sm-det-cuerpo').innerHTML =
    '<div class="kv">' +
      '<span class="k">Empresa</span><span>' + escHtml((s.empresas || []).join(', ') || '—') + '</span>' +
      '<span class="k">Solicitante</span><span>' + escHtml(s.solicitante || '—') + '</span>' +
      '<span class="k">A nombre de</span><span>' + escHtml(s.a_nombre_de || '—') + '</span>' +
      '<span class="k">Fecha tentativa</span><span>' + escHtml(fmtDate(s.fecha_tentativa)) + '</span>' +
      '<span class="k">Fecha comprometida</span><span>' + escHtml(s.fecha_comprometida ? fmtDate(s.fecha_comprometida) : 'Por definir por Mercadeo') + '</span>' +
      '<span class="k">Entregada</span><span>' + escHtml(s.entregada_en ? smFmtFechaHora(s.entregada_en) : '—') + '</span>' +
      '<span class="k">Responsables</span><span>' + escHtml((s.responsables || []).join(', ') || 'Sin asignar') + '</span>' +
    '</div>' +
    '<h4>Descripción</h4><div style="white-space:pre-wrap;font-size:0.88rem">' + escHtml(s.descripcion) + '</div>' +
    '<h4>Archivos enviados</h4>' + (adjuntos ? '<ul style="margin:0;padding-left:18px">' + adjuntos + '</ul>' : '<div class="sm-hint">Sin archivos.</div>') +
    '<h4>Seguimiento</h4>' + (historial ? '<ul class="sm-hist">' + historial + '</ul>' : '<div class="sm-hint">Aún no hay novedades: Mercadeo la revisará pronto.</div>');
  smEl('sm-overlay').classList.add('show');
}

function smCerrarDetalle() { smEl('sm-overlay').classList.remove('show'); }

// ── Eventos ──
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t || !t.closest) return;
  var tab = t.closest('[data-sm-tab]');
  if (tab) { smCambiarTab(tab.getAttribute('data-sm-tab')); return; }
  var quitar = t.closest('[data-sm-quitar]');
  if (quitar) {
    var i = Number(quitar.getAttribute('data-sm-quitar'));
    _sm.files.splice(i, 1);
    smRenderArchivos();
    return;
  }
  var ver = t.closest('[data-sm-ver]');
  if (ver) { smVerDetalle(Number(ver.getAttribute('data-sm-ver'))); return; }
});

document.addEventListener('DOMContentLoaded', function () {
  smEl('sm-enviar').addEventListener('click', smEnviar);
  smEl('sm-limpiar').addEventListener('click', function () { if (!_sm.enviando) smResetForm(); });
  smEl('sm-refrescar').addEventListener('click', smCargarLista);
  smEl('sm-det-cerrar').addEventListener('click', smCerrarDetalle);
  smEl('sm-det-cerrar2').addEventListener('click', smCerrarDetalle);
  smEl('sm-overlay').addEventListener('click', function (e) { if (isBackdropClick(e)) smCerrarDetalle(); });
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
  smInit();
});
