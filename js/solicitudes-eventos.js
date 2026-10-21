// ══════════════════════════════════════════════════════════════
// Solicitudes de Eventos — formato MC-ISO-FO01, "Mis solicitudes" y aprobación
// ══════════════════════════════════════════════════════════════
// Misma lógica que "Solicitudes a Mercadeo" (solicitudes-mercadeo.js): la solicitud se guarda en Pedidos como
// "Por aprobar"; un aprobador (admin o permiso "Aprobar solicitudes a Mercadeo") la aprueba o la rechaza con
// motivo. SOLO al aprobarse llega al módulo de Eventos de Mercadeo de panel-pqrs, donde queda "Radicada" y el
// Líder de Mercadeo la evalúa (máximo 48 horas hábiles). Si quien envía ya puede aprobar, se aprueba sola.
// El solicitante puede editarla mientras Mercadeo no la haya aprobado: por aprobar -> se actualiza y sigue por
// aprobar; rechazada -> se corrige y se reenvía; aprobada en Pedidos pero aún sin aprobar en Mercadeo -> sale de
// Mercadeo y vuelve a aprobación (llega de nuevo al aprobarse). Una vez aprobada por Mercadeo, quien la hizo, a
// nombre de quién se hizo o un aprobador puede dejarle una OBSERVACIÓN (queda en la bitácora del evento y avisa
// al equipo). Política de 15 días: es una advertencia, no impide enviar.
//
// Todo pasa por la Edge Function `solicitud-evento` (sesión, permiso y empresas). Los adjuntos suben directo al
// Storage de pqrs con URLs firmadas que entrega la función (la clave anon de pqrs es pública; por sí sola no da
// acceso a nada).
// Depende de: _sb, _authReady, EMPRESAS_HOLDING, escHtml, showToast, fmtDate, today, isBackdropClick
// (shared.js) y AUTH (auth.js).

var EV_PQRS_URL = 'https://kvfqcymeihglohkcckdp.supabase.co';
var EV_PQRS_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2ZnFjeW1laWhnbG9oa2Nja2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTQyNjksImV4cCI6MjEwNTA3MDI2OX0.kdutwtsqpUDC6v9r7FPWTSKLFW62SMGy_1F41Fcv8Mk';
var EV_BUCKET = 'mercadeo-adjuntos';

var EV_MAX_ARCHIVOS = 5;
var EV_MAX_BYTES = 25 * 1024 * 1024;
var EV_DIAS_MINIMOS = 15;
var EV_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ai', 'psd', 'eps',
  'mp4', 'mov', 'mp3', 'wav', 'zip'];

// Listas del formato (códigos = los que guarda Mercadeo).
var EV_MODALIDAD = { fisico: 'Físico', virtual: 'Virtual', hibrido: 'Híbrido' };
// Empresas ADICIONALES (no son del holding): las ofrece la función en ctx.empresas_extra a todo el que envía. «Otros» exige el nombre escrito.
var EV_EMPRESAS_EXTRA = { CHIA_ABAGO: 'Chía Abagó', TECBIHOL: 'Tecbihol', OTROS: 'Otros' };
var EV_OBJETIVOS = [['leads', 'Generar nuevos leads (oportunidades de venta)'], ['relacion_clientes', 'Fortalecer la relación con clientes existentes'], ['lanzamiento', 'Lanzamiento o promoción de un nuevo producto/servicio'], ['posicionamiento', 'Posicionamiento de la marca/empresa'], ['capacitacion', 'Capacitación o educación'], ['trafico_digital', 'Aumentar el tráfico a nuestro sitio web o redes sociales'], ['retencion', 'Retención de clientes']];
var EV_CANALES = [['email', 'Email marketing (creación de campañas de invitación)'], ['redes', 'Redes sociales (posts, historias, anuncios)'], ['web', 'Blog o sitio web (creación de contenido, landing page)'], ['relaciones_publicas', 'Relaciones públicas (comunicados de prensa)'], ['publicidad_digital', 'Publicidad digital (Google Ads, LinkedIn Ads, etc.)'], ['video', 'Creación de videos promocionales']];
var EV_MATERIALES = [['banners_redes', 'Banners para redes sociales'], ['diseno_email', 'Diseño de email'], ['invitaciones', 'Invitaciones digitales o impresas'], ['presentacion', 'Presentación de diapositivas'], ['flyers', 'Flyers o folletos'], ['rollups', 'Roll-ups o pendones'], ['merchandising', 'Diseño para materiales de merchandising']];
var EV_LOGISTICA = [['registros', 'Apoyo en la gestión de registros (plataforma, base de datos)'], ['coordinacion_logistica', 'Coordinación con el área de logística para el evento'], ['plataforma_virtual', 'Apoyo en la configuración de la plataforma de evento virtual']];

// Estado que ve el solicitante. Primero el de la aprobación previa; ya aprobada, el del evento en Mercadeo.
var EV_ESTADOS = {
  por_aprobar:    { t: 'Por aprobar',    cls: 'b-pendiente-aprob' },
  rechazada:      { t: 'Rechazada',      cls: 'b-anulado' },
  aprobada:       { t: 'Aprobada',       cls: 'b-ent' },
  radicada:       { t: 'Recibida',       cls: 'b-rec' },
  en_revision:    { t: 'En revisión',    cls: 'b-par' },
  aprobada_merc:  { t: 'Aprobada',       cls: 'b-ent' },
  en_preparacion: { t: 'En preparación', cls: 'b-alistado' },
  realizada:      { t: 'Realizada',      cls: 'b-fac' },
  cerrada:        { t: 'Cerrada',        cls: 'b-ent' },
  cancelada:      { t: 'Cancelada',      cls: 'b-anulado' }
};

var EV_ROLES = {
  admin: 'Admin', editor: 'Editor', lector: 'Lector', comercial: 'Comercial', despachador: 'Despachador',
  contabilidad: 'Contabilidad', gerente_iaso: 'Gerente IASO', remisionador: 'Remisionador',
  cartera: 'Cartera', produccion: 'Producción', mercadeo: 'Mercadeo'
};

var _ev = {
  combo: { opciones: [], visibles: [], activo: -1, ultimo: '' },   // combo de "Solicitante"
  ctx: null,          // { yo, empresas, usuarios, puede_aprobar, pendientes }
  requestId: null,    // se mantiene entre reintentos del MISMO envío (idempotencia)
  editando: null,     // solicitud propia que se está modificando (objeto) o null
  keep: [],           // archivos ya subidos que se conservan al editar [{path,nombre,tamano,tipo}]
  files: [],          // File[] nuevos elegidos
  uploaded: {},       // clave archivo -> { path, nombre, tamano, tipo } ya subido para este requestId
  enviando: false,
  lista: [],          // Mis solicitudes
  pend: [],           // por aprobar (aprobadores)
  apr: [],            // aprobadas que siguen con Mercadeo (aprobadores)
  detalle: null,      // { origen: 'mis'|'pend'|'apr', idx }
  paso: 1,            // paso visible del formulario (1-5)
  visitados: {},      // pasos ya vistos: solo ellos muestran ✓ / ! en la barra
  observando: false,  // candado anti doble clic al enviar una observación
  rechazando: null,   // solicitud que se está rechazando
  pqrs: null
};

function evEl(id) { return document.getElementById(id); }

function evRef(s) { return 'SE-' + s.numero; }

function evEstadoDe(k) { return EV_ESTADOS[k] || { t: String(k || '—'), cls: '' }; }

function evEtiqueta(catalogo, k) {
  for (var i = 0; i < catalogo.length; i++) if (catalogo[i][0] === k) return catalogo[i][1];
  return k;
}

function evNum(v) { return v === null || v === undefined || v === '' ? '' : String(v); }

function evMoney(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CO'); }

// Monto escrito en formato colombiano ('3.500.000', '1.234,56') -> número; NaN si no lo es.
function evParseMonto(txt) {
  var s = String(txt === null || txt === undefined ? '' : txt).replace(/[$\s]/g, '');
  if (!s || !/^[\d.,]+$/.test(s)) return NaN;
  var hasDot = s.indexOf('.') >= 0, hasComma = s.indexOf(',') >= 0;
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

// Días calendario entre dos fechas 'YYYY-MM-DD' (b - a).
function evDias(a, b) {
  var pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(a || '')), pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b || ''));
  if (!pa || !pb) return null;
  return Math.round((new Date(+pb[1], +pb[2] - 1, +pb[3]) - new Date(+pa[1], +pa[2] - 1, +pa[3])) / 86400000);
}

// Etiquetas de estado a mostrar, cada una rotulada con la etapa a la que corresponde:
//  · "Gerente comercial": la aprobación previa (Por aprobar / Aprobada / Rechazada).
//  · "Mercadeo": el estado que le da el equipo a su evento. Solo aparece una vez aprobada.
function evBadgesEstado(s) {
  var etapa = function (rotulo, ayuda, st) {
    return '<span class="sm-etapa" title="' + escHtml(ayuda) + '"><span class="sm-etapa-t">' + escHtml(rotulo) + ':</span> ' +
      '<span class="badge ' + st.cls + '">' + escHtml(st.t) + '</span></span>';
  };
  var ayudaGerente = 'Aprobación del gerente comercial: es la revisión previa para que la solicitud pase a Mercadeo.';
  var ayudaMercadeo = 'Estado del evento dentro del equipo de Mercadeo.';
  if (s.estado_aprobacion === 'Por aprobar') return etapa('Gerente comercial', ayudaGerente, EV_ESTADOS.por_aprobar);
  if (s.estado_aprobacion === 'Rechazada' && !s.rechazada_por_mercadeo) return etapa('Gerente comercial', ayudaGerente, EV_ESTADOS.rechazada);
  var key = s.estado === 'aprobada' ? 'aprobada_merc' : s.estado;
  var merc = s.rechazada_por_mercadeo ? EV_ESTADOS.rechazada : (key ? evEstadoDe(key) : null);
  return etapa('Gerente comercial', s.auto_aprobada ? ayudaGerente + ' Se aprobó sola porque quien envió tiene permiso de aprobar.' : ayudaGerente, EV_ESTADOS.aprobada) +
    (merc ? etapa('Mercadeo', ayudaMercadeo, merc) : '');
}

function evAnticipacionHtml(s) {
  if (s.dias_anticipacion === null || s.dias_anticipacion === undefined) return '—';
  return s.extemporanea
    ? '<span class="badge b-alerta" title="Menos de ' + EV_DIAS_MINIMOS + ' días de anticipación (es una advertencia)">⚠ ' + escHtml(s.dias_anticipacion) + ' d</span>'
    : '<span title="Días de anticipación">✓ ' + escHtml(s.dias_anticipacion) + ' d</span>';
}

function evNuevoRequestId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  var b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

function evFmtTam(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB'; }
function evFmtFechaHora(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  if (isNaN(d)) return String(ts);
  return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function evClaveArchivo(f) { return f.name + '|' + f.size + '|' + (f.lastModified || 0); }
function evExt(nombre) {
  var i = String(nombre).lastIndexOf('.');
  return i >= 0 ? String(nombre).slice(i + 1).toLowerCase() : '';
}

// ── Llamada a la Edge Function (con el mensaje de error legible) ──
async function evInvocar(body) {
  var res = await _sb.functions.invoke('solicitud-evento', { body: body });
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
async function evInit() {
  evEl('load-zone').style.display = '';
  evEl('main').style.display = 'none';
  evEl('btn-retry').style.display = 'none';
  evEl('load-error').textContent = '';
  try {
    await _authReady;
    _ev.ctx = await evInvocar({ action: 'contexto' });
    evPoblarFormulario();
    evResetForm();
    var aprobar = !!_ev.ctx.puede_aprobar;
    evEl('sm-tab-aprobar').style.display = aprobar ? '' : 'none';
    if (aprobar) evEl('sm-ct-aprobar').textContent = _ev.ctx.pendientes || 0;
    evEl('load-zone').style.display = 'none';
    evEl('main').style.display = 'block';
    // Aviso de la campanita: ?tab=aprobar abre directamente la bandeja de aprobación.
    var qs = new URLSearchParams(location.search);
    var tab = qs.get('tab');
    if (tab === 'aprobar' && aprobar) evCambiarTab('aprobar');
    else if (tab === 'mis') evCambiarTab('mis');
  } catch (err) {
    evEl('load-error').textContent = err.message;
    evEl('btn-retry').style.display = '';
  }
}

function evChecks(id, catalogo, sel) {
  evEl(id).innerHTML = catalogo.map(function (c) {
    return '<label><input type="checkbox" class="' + id + '-chk" value="' + escHtml(c[0]) + '"' + (sel && sel.indexOf(c[0]) >= 0 ? ' checked' : '') + '> ' + escHtml(c[1]) + '</label>';
  }).join('');
}
function evMarcados(id) {
  return [].slice.call(document.querySelectorAll('.' + id + '-chk:checked')).map(function (c) { return c.value; });
}

function evPoblarFormulario() {
  var ctx = _ev.ctx;

  evComboCargar();

  var nombres = {};
  EMPRESAS_HOLDING.forEach(function (e) { nombres[e.sigla] = e.value; });
  var emp = '';
  if (ctx.empresas.length !== 1) emp += '<option value="">— Seleccionar —</option>';
  ctx.empresas.forEach(function (s) {
    emp += '<option value="' + escHtml(s) + '">' + escHtml(s) + (nombres[s] ? ' — ' + escHtml(nombres[s]) : '') + '</option>';
  });
  (ctx.empresas_extra || []).forEach(function (x) {
    emp += '<option value="' + escHtml(x.codigo) + '">' + escHtml(x.codigo === 'OTROS' ? 'Otros (escribir el nombre)' : x.nombre) + '</option>';
  });
  evEl('sm-empresa').innerHTML = emp;
  evEl('sm-aviso-sin-empresa').style.display = ctx.empresas.length ? 'none' : '';
  evEl('sm-enviar').disabled = !ctx.empresas.length;

  evEl('ev-modalidad').innerHTML = Object.keys(EV_MODALIDAD).map(function (k) {
    return '<label><input type="radio" name="ev-mod" value="' + k + '"' + (k === 'fisico' ? ' checked' : '') + '> ' + EV_MODALIDAD[k] + '</label>';
  }).join('');

  // El estado inicial es "Por aprobar"; si quien envía ya puede aprobar, pasa directo a Mercadeo.
  evEl('sm-estado').value = 'Por aprobar';
  evEl('sm-estado-hint').textContent = ctx.puede_aprobar
    ? 'Como tienes permiso de aprobar, tu solicitud se aprueba sola y pasa directo a Mercadeo.'
    : 'Un aprobador la revisa; al aprobarla pasa a Mercadeo.';
}

// ── Combo "Solicitante": todos los usuarios activos del panel, con búsqueda por nombre ──
function evNorm(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function evEtiquetaUsuario(o) { return o.yo ? o.nombre + ' (yo)' : o.nombre; }

function evComboCargar() {
  var ctx = _ev.ctx;
  var lista = (ctx.usuarios || []).slice();
  if (!lista.some(function (u) { return u.id === ctx.yo.id; })) {
    lista.push({ id: ctx.yo.id, nombre: ctx.yo.nombre, rol: ctx.yo.rol });
  }
  _ev.combo.opciones = lista.map(function (u) {
    return { id: u.id, nombre: u.nombre, rol: u.rol, yo: u.id === ctx.yo.id };
  }).sort(function (a, b) {
    if (a.yo !== b.yo) return a.yo ? -1 : 1;                        // el propio usuario primero
    return String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });
  });
}

function evComboOpcion(id) {
  for (var i = 0; i < _ev.combo.opciones.length; i++) if (_ev.combo.opciones[i].id === id) return _ev.combo.opciones[i];
  return null;
}

function evSolicitanteId() { return evEl('sm-solicitante-id').value || ''; }

function evComboCerrar() {
  evEl('sm-solicitante-lista').style.display = 'none';
  evEl('sm-solicitante').setAttribute('aria-expanded', 'false');
  evEl('sm-solicitante').removeAttribute('aria-activedescendant');
}

function evComboElegir(id) {
  var o = evComboOpcion(id);
  if (!o) return;
  evEl('sm-solicitante-id').value = o.id;
  evEl('sm-solicitante').value = evEtiquetaUsuario(o);
  _ev.combo.ultimo = o.id;
  evComboCerrar();
}

function evComboPintar() {
  var ul = evEl('sm-solicitante-lista');
  var c = _ev.combo;
  if (!c.visibles.length) {
    ul.innerHTML = '<li class="vacio" role="option" aria-disabled="true">Sin resultados</li>';
    return;
  }
  var sel = evSolicitanteId();
  ul.innerHTML = c.visibles.map(function (o, i) {
    return '<li role="option" id="sm-op-' + i + '" data-id="' + escHtml(o.id) + '"' +
      ' class="' + (i === c.activo ? 'activo ' : '') + (o.id === sel ? 'sel' : '') + '"' +
      ' aria-selected="' + (o.id === sel ? 'true' : 'false') + '">' +
      '<span>' + escHtml(evEtiquetaUsuario(o)) + '</span>' +
      '<span class="rol">' + escHtml(EV_ROLES[o.rol] || o.rol || '') + '</span></li>';
  }).join('');
  if (c.activo >= 0) {
    evEl('sm-solicitante').setAttribute('aria-activedescendant', 'sm-op-' + c.activo);
    var li = document.getElementById('sm-op-' + c.activo);
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }
}

// Abre la lista filtrando por nombre: todas las palabras escritas deben aparecer (sin importar tildes ni mayúsculas).
function evComboAbrir(filtro) {
  var palabras = evNorm(filtro).split(/\s+/).filter(Boolean);
  var c = _ev.combo;
  c.visibles = c.opciones.filter(function (o) {
    var h = evNorm(o.nombre);
    return palabras.every(function (p) { return h.indexOf(p) >= 0; });
  });
  c.activo = c.visibles.length ? 0 : -1;
  evEl('sm-solicitante-lista').style.display = '';
  evEl('sm-solicitante').setAttribute('aria-expanded', 'true');
  evComboPintar();
}

function evComboAlEnfocar() {
  // Si el cuadro muestra la selección actual, se ofrece la lista completa (no filtrada por ese texto).
  var o = evComboOpcion(evSolicitanteId());
  var inp = evEl('sm-solicitante');
  evComboAbrir(o && inp.value === evEtiquetaUsuario(o) ? '' : inp.value);
}

function evComboAlTeclear(e) {
  var c = _ev.combo;
  var abierta = evEl('sm-solicitante-lista').style.display !== 'none';
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!abierta) { evComboAlEnfocar(); return; }
    if (!c.visibles.length) return;
    c.activo = (c.activo + (e.key === 'ArrowDown' ? 1 : -1) + c.visibles.length) % c.visibles.length;
    evComboPintar();
  } else if (e.key === 'Enter') {
    if (abierta) {
      e.preventDefault();                       // no enviar nada con Enter
      if (c.activo >= 0 && c.visibles[c.activo]) evComboElegir(c.visibles[c.activo].id);
    }
  } else if (e.key === 'Escape') {
    if (abierta) { e.preventDefault(); evComboAlSalir(); }
  }
}

// Al salir: si el texto no corresponde a una selección válida, vuelve a la última elegida.
function evComboAlSalir() {
  var inp = evEl('sm-solicitante');
  if (!evSolicitanteId()) {
    var t = evNorm(inp.value);
    var exactos = _ev.combo.opciones.filter(function (o) { return evNorm(o.nombre) === t || evNorm(evEtiquetaUsuario(o)) === t; });
    if (exactos.length === 1) evComboElegir(exactos[0].id);
    else if (_ev.combo.ultimo) evComboElegir(_ev.combo.ultimo);
  } else {
    var o = evComboOpcion(evSolicitanteId());
    if (o) inp.value = evEtiquetaUsuario(o);
  }
  evComboCerrar();
}

// ── Formulario ──
function evModalidadActual() { var r = document.querySelector('input[name="ev-mod"]:checked'); return r ? r.value : ''; }

// Con la empresa «Otros» aparece el campo para escribir el nombre.
function evActualizarEmpresaOtra() {
  var otros = evEl('sm-empresa').value === 'OTROS';
  evEl('ev-empresa-otra-box').style.display = otros ? '' : 'none';
  if (otros && document.activeElement === evEl('sm-empresa')) evEl('ev-empresa-otra').focus();
}

// El área es una lista fija; si una solicitud anterior trae un texto libre que no está en ella, se agrega como opción para no perderlo al editar.
function evPonerArea(area) {
  var sel = evEl('ev-area'), v = String(area || '').trim();
  [].slice.call(sel.options).forEach(function (o) { if (o.getAttribute('data-extra')) sel.removeChild(o); });
  if (v && ![].slice.call(sel.options).some(function (o) { return o.value === v; })) {
    var op = document.createElement('option');
    op.value = v; op.textContent = v; op.setAttribute('data-extra', '1');
    sel.appendChild(op);
  }
  sel.value = v;
}

function evActualizarModalidad() {
  var m = evModalidadActual();
  evEl('ev-lugar-box').style.display = m === 'fisico' || m === 'hibrido' || !m ? '' : 'none';
  evEl('ev-plataforma-box').style.display = m === 'virtual' || m === 'hibrido' ? '' : 'none';
}

// Aviso de la política de 15 días contando desde hoy (o desde la fecha en que se radicó, al editar).
function evActualizarAnticipacion() {
  var ev = evEl('ev-fecha').value, el = evEl('ev-anticipacion');
  if (!ev) { el.innerHTML = ''; return; }
  var base = _ev.editando && _ev.editando.estado_aprobacion !== 'Rechazada' ? _ev.editando.fecha_radicacion : today();
  var d = evDias(base, ev);
  if (d === null) { el.innerHTML = ''; return; }
  if (d < 0) { el.innerHTML = '<span class="ev-aviso">La fecha del evento no puede ser anterior a hoy.</span>'; return; }
  el.innerHTML = d < EV_DIAS_MINIMOS
    ? '<span class="ev-aviso">⚠ Faltan ' + d + ' días: la política pide mínimo ' + EV_DIAS_MINIMOS + ' días de anticipación si necesitas material POP, diseño o presencia de Mercadeo. Es una advertencia; Mercadeo decide.</span>'
    : 'Anticipación: ' + d + ' días ✓';
}

function evFilaGasto(concepto, valor) {
  return '<div class="ev-gasto"><input class="ef ev-g-con" maxlength="120" placeholder="Concepto (p. ej. refrigerios)" aria-label="Concepto del gasto" value="' + escHtml(concepto || '') + '">' +
    '<input class="ef ev-g-val" inputmode="decimal" placeholder="Valor" aria-label="Valor del gasto" value="' + escHtml(valor ? Number(valor).toLocaleString('es-CO') : '') + '">' +
    '<button type="button" data-ev-gasto-quitar="1" aria-label="Quitar línea">🗑</button></div>';
}

function evLeerDesglose() {
  var out = [], error = null;
  [].slice.call(document.querySelectorAll('#ev-desglose .ev-gasto')).forEach(function (f) {
    var con = f.querySelector('.ev-g-con').value.trim(), txt = f.querySelector('.ev-g-val').value.trim();
    if (!con && !txt) return;
    var val = txt ? evParseMonto(txt) : 0;
    if (!con) { error = 'Cada línea del desglose de gastos necesita un concepto'; return; }
    if (isNaN(val)) { error = 'El valor de «' + con + '» en el desglose no es un número'; return; }
    out.push({ concepto: con, valor: val });
  });
  return { lineas: out, error: error };
}

function evActualizarPresupuesto() {
  var est = evParseMonto(evEl('ev-presupuesto').value), sol = evParseMonto(evEl('ev-solicitado').value);
  var des = evLeerDesglose().lineas, suma = des.reduce(function (a, l) { return a + l.valor; }, 0);
  evEl('ev-desglose-total').textContent = des.length ? 'Suma del desglose: ' + evMoney(suma) : '';
  var avisos = [];
  if (!isNaN(est) && !isNaN(sol) && sol > est) avisos.push('⚠ Lo solicitado a Mercadeo supera el presupuesto estimado del evento.');
  if (!isNaN(est) && est > 0 && des.length && Math.abs(suma - est) > 0.5) avisos.push('El desglose suma ' + evMoney(suma) + ' y el presupuesto estimado es ' + evMoney(est) + '.');
  evEl('ev-presupuesto-aviso').innerHTML = avisos.map(function (a) { return escHtml(a); }).join('<br>');
}

function evResetForm() {
  _ev.requestId = evNuevoRequestId();
  _ev.editando = null;
  _ev.keep = [];
  _ev.files = [];
  _ev.uploaded = {};
  _ev.combo.ultimo = '';
  evEl('sm-solicitante-id').value = '';
  evEl('sm-solicitante').value = '';
  if (_ev.ctx) evComboElegir(_ev.ctx.yo.id);
  if (_ev.ctx && _ev.ctx.empresas.length === 1) evEl('sm-empresa').value = _ev.ctx.empresas[0];
  else evEl('sm-empresa').value = '';
  evEl('ev-empresa-otra').value = '';
  evActualizarEmpresaOtra();
  evPonerArea('');
  ['ev-correo', 'ev-tel', 'ev-limite', 'ev-nombre', 'ev-fecha', 'ev-hora-ini', 'ev-hora-fin', 'ev-lugar', 'ev-plataforma',
    'ev-objetivos-otro', 'ev-publico', 'ev-seg-dem', 'ev-seg-prof', 'ev-nivel', 'ev-invitados', 'ev-asis-pres', 'ev-asis-virt',
    'ev-canales-otro', 'ev-materiales-otro', 'ev-logistica-otro', 'ev-presupuesto', 'ev-solicitado'].forEach(function (id) { evEl(id).value = ''; });
  evEl('ev-limite').min = today();
  evEl('ev-fecha').min = today();
  evEl('sm-desc').value = '';
  evEl('sm-desc-ct').textContent = '0';
  var m = document.querySelector('input[name="ev-mod"][value="fisico"]');
  if (m) m.checked = true;
  evChecks('ev-objetivos', EV_OBJETIVOS, []);
  evChecks('ev-canales', EV_CANALES, []);
  evChecks('ev-materiales', EV_MATERIALES, []);
  evChecks('ev-logistica', EV_LOGISTICA, []);
  evEl('ev-desglose').innerHTML = '';
  evActualizarModalidad();
  evActualizarAnticipacion();
  evActualizarPresupuesto();
  evEl('sm-files').value = '';
  evEl('sm-progreso').textContent = '';
  evEl('sm-edit-banner').style.display = 'none';
  evEl('sm-enviar').textContent = evTextoEnviar();
  evRenderArchivos();
  _ev.visitados = {};
  evMostrarPaso(1);
}

// Texto del botón de envío según lo que se está haciendo.
function evTextoEnviar() {
  var s = _ev.editando;
  if (!s) return '📨 Enviar solicitud';
  if (s.estado_aprobacion === 'Por aprobar') return '💾 Guardar cambios';
  if (s.estado_aprobacion === 'Aprobada') return '📨 Guardar y volver a aprobación';
  return '📨 Reenviar a aprobación';
}

// Texto del botón de la lista/detalle: "Editar y reenviar" solo cuando está rechazada.
function evTextoEditar(s) {
  return s.estado_aprobacion === 'Rechazada' ? '✏️ Editar y reenviar' : '✏️ Editar';
}

// Archivos: primero los ya subidos que se conservan (al editar) y luego los nuevos.
function evRenderArchivos() {
  var ul = evEl('sm-files-lista');
  var html = _ev.keep.map(function (a, i) {
    return '<li><span class="nm">📎 ' + escHtml(a.nombre) + ' <em style="color:#718096">(ya enviado)</em></span><span class="sz">' + escHtml(evFmtTam(a.tamano)) + '</span>' +
      '<button type="button" data-ev-quitar-keep="' + i + '" aria-label="Quitar ' + escHtml(a.nombre) + '">✕</button></li>';
  }).join('') + _ev.files.map(function (f, i) {
    return '<li><span class="nm">📎 ' + escHtml(f.name) + '</span><span class="sz">' + escHtml(evFmtTam(f.size)) + '</span>' +
      '<button type="button" data-ev-quitar="' + i + '" aria-label="Quitar ' + escHtml(f.name) + '">✕</button></li>';
  }).join('');
  ul.innerHTML = html;
}

function evAgregarArchivos(lista) {
  var errores = [];
  for (var i = 0; i < lista.length; i++) {
    var f = lista[i];
    if (_ev.keep.length + _ev.files.length >= EV_MAX_ARCHIVOS) { errores.push('Máximo ' + EV_MAX_ARCHIVOS + ' archivos'); break; }
    if (EV_EXT.indexOf(evExt(f.name)) < 0) { errores.push('"' + f.name + '" no es de un tipo permitido'); continue; }
    if (f.size > EV_MAX_BYTES) { errores.push('"' + f.name + '" supera 25 MB'); continue; }
    if (f.size <= 0) { errores.push('"' + f.name + '" está vacío'); continue; }
    var dup = _ev.files.some(function (x) { return evClaveArchivo(x) === evClaveArchivo(f); });
    if (!dup) _ev.files.push(f);
  }
  evEl('sm-files').value = '';
  evRenderArchivos();
  if (errores.length) showToast(errores.join('. '), '#e74c3c');
}

function evEnteroOpc(id) {
  var v = evEl(id).value.trim();
  return v === '' ? null : Number(v);
}

function evLeerFormulario() {
  var solId = evSolicitanteId();
  var gastos = evLeerDesglose();
  var est = evParseMonto(evEl('ev-presupuesto').value), sol = evParseMonto(evEl('ev-solicitado').value);
  return {
    solicitante_id: solId,
    // El propio usuario no es "a nombre de" nadie: se manda vacío.
    a_nombre_de_id: solId && _ev.ctx && solId !== _ev.ctx.yo.id ? solId : null,
    errGastos: gastos.error,
    datos: {
      empresa: evEl('sm-empresa').value,
      empresa_otra: evEl('sm-empresa').value === 'OTROS' ? evEl('ev-empresa-otra').value.trim().replace(/\s+/g, ' ') : '',
      solicitante_area: evEl('ev-area').value.trim(),
      solicitante_correo: evEl('ev-correo').value.trim(),
      solicitante_telefono: evEl('ev-tel').value.trim(),
      fecha_limite_aprobacion: evEl('ev-limite').value || null,
      nombre: evEl('ev-nombre').value.trim(),
      descripcion: evEl('sm-desc').value.trim(),
      fecha_evento: evEl('ev-fecha').value,
      hora_inicio: evEl('ev-hora-ini').value || null,
      hora_fin: evEl('ev-hora-fin').value || null,
      modalidad: evModalidadActual(),
      lugar: evEl('ev-lugar').value.trim(),
      plataforma: evEl('ev-plataforma').value.trim(),
      objetivos: evMarcados('ev-objetivos'),
      objetivos_otro: evEl('ev-objetivos-otro').value.trim(),
      publico_objetivo: evEl('ev-publico').value.trim(),
      segmento_demografico: evEl('ev-seg-dem').value.trim(),
      segmento_profesional: evEl('ev-seg-prof').value.trim(),
      nivel_conocimiento: evEl('ev-nivel').value.trim(),
      total_invitados: evEnteroOpc('ev-invitados'),
      asistentes_presencial: evEnteroOpc('ev-asis-pres'),
      asistentes_virtual: evEnteroOpc('ev-asis-virt'),
      canales: evMarcados('ev-canales'),
      canales_otro: evEl('ev-canales-otro').value.trim(),
      materiales: evMarcados('ev-materiales'),
      materiales_otro: evEl('ev-materiales-otro').value.trim(),
      logistica: evMarcados('ev-logistica'),
      logistica_otro: evEl('ev-logistica-otro').value.trim(),
      presupuesto_estimado: evEl('ev-presupuesto').value.trim() === '' ? 0 : est,
      total_solicitado: evEl('ev-solicitado').value.trim() === '' ? 0 : sol,
      desglose_gastos: gastos.lineas
    }
  };
}

// ── Pasos del formulario ──
// 1 Solicitante · 2 Evento · 3 Objetivos y público · 4 Requerimientos · 5 Presupuesto y envío (secciones 5 y 6 del formato).
// Se avanza con «Siguiente» (valida solo el paso actual); hacia atrás se vuelve sin validar. En la barra, un paso ya visitado
// muestra ✓ si está completo o ! si le falta algo. El envío revisa todos los pasos y lleva al primero con error.
var EV_PASOS = [
  { n: 1, t: 'Solicitante' },
  { n: 2, t: 'Evento' },
  { n: 3, t: 'Objetivos y público' },
  { n: 4, t: 'Requerimientos' },
  { n: 5, t: 'Presupuesto y envío' }
];

// Error (texto) de un paso, o null si está completo.
function evValidarPaso(f, n) {
  var d = f.datos;
  if (n === 1) {
    if (!d.empresa) return 'Elige la empresa';
    if (d.empresa === 'OTROS' && (d.empresa_otra.length < 3 || d.empresa_otra.length > 100)) return 'Escribe el nombre de la empresa (entre 3 y 100 caracteres)';
    if (!f.solicitante_id || !evComboOpcion(f.solicitante_id)) return 'Elige el solicitante de la lista';
    if (d.fecha_limite_aprobacion && d.fecha_limite_aprobacion < today()) return 'La fecha límite de aprobación no puede ser anterior a hoy';
  }
  if (n === 2) {
    if (d.nombre.length < 3) return 'El nombre del evento debe tener al menos 3 caracteres';
    if (d.descripcion.length < 10) return 'Describe el evento (mínimo 10 caracteres)';
    if (d.descripcion.length > 2000) return 'La descripción no puede superar 2000 caracteres';
    if (!d.fecha_evento) return 'Indica la fecha del evento';
    if (d.fecha_evento < today()) return 'La fecha del evento no puede ser anterior a hoy';
    if (d.fecha_limite_aprobacion && d.fecha_limite_aprobacion > d.fecha_evento) return 'La fecha límite de aprobación no puede ser posterior a la fecha del evento';
    if (d.hora_inicio && d.hora_fin && d.hora_fin <= d.hora_inicio) return 'La hora de fin debe ser posterior a la de inicio';
    if (!d.modalidad) return 'Elige la modalidad: físico, virtual o híbrido';
    if ((d.modalidad === 'fisico' || d.modalidad === 'hibrido') && !d.lugar) return 'Indica el lugar o ubicación del evento';
    if ((d.modalidad === 'virtual' || d.modalidad === 'hibrido') && !d.plataforma) return 'Indica la plataforma del evento virtual';
  }
  if (n === 3) {
    var enteros = [['total_invitados', 'El total de invitados'], ['asistentes_presencial', 'Los asistentes presenciales'], ['asistentes_virtual', 'Los asistentes virtuales']];
    for (var i = 0; i < enteros.length; i++) {
      var v = d[enteros[i][0]];
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100000)) return enteros[i][1] + ' debe ser un número entero entre 0 y 100000';
    }
  }
  if (n === 5) {
    if (f.errGastos) return f.errGastos;
    if (isNaN(d.presupuesto_estimado) || isNaN(d.total_solicitado)) return 'El presupuesto y el total solicitado deben ser números';
  }
  return null;
}

// Primer paso con error: { paso, msg } o null.
function evPrimerError(f) {
  for (var n = 1; n <= EV_PASOS.length; n++) {
    var msg = evValidarPaso(f, n);
    if (msg) return { paso: n, msg: msg };
  }
  return null;
}

function evRenderPasos() {
  var f = evLeerFormulario();
  evEl('ev-pasos').innerHTML = EV_PASOS.map(function (p) {
    var est = p.n === _ev.paso ? 'actual' : (_ev.visitados[p.n] ? (evValidarPaso(f, p.n) ? 'error' : 'ok') : '');
    var marca = est === 'ok' ? '✓' : est === 'error' ? '!' : String(p.n);
    return '<li class="' + est + '"><button type="button" data-ev-paso="' + p.n + '"' + (est === 'actual' ? ' aria-current="step"' : '') +
      ' title="' + escHtml(p.t) + (est === 'error' ? ' — falta completar algo' : '') + '">' +
      '<span class="num">' + marca + '</span><span class="txt">' + escHtml(p.t) + '</span></button></li>';
  }).join('');
}

function evMostrarPaso(n, scroll) {
  n = Math.max(1, Math.min(EV_PASOS.length, n));
  _ev.paso = n;
  _ev.visitados[n] = true;
  [].slice.call(document.querySelectorAll('.ev-paso')).forEach(function (s) {
    s.style.display = Number(s.getAttribute('data-paso')) === n ? '' : 'none';
  });
  var ultimo = n === EV_PASOS.length;
  evEl('ev-anterior').style.visibility = n === 1 ? 'hidden' : 'visible';
  evEl('ev-siguiente').style.display = ultimo ? 'none' : '';
  evEl('ev-envio').style.display = ultimo ? '' : 'none';
  evEl('ev-paso-txt').textContent = 'Paso ' + n + ' de ' + EV_PASOS.length + ' · ' + EV_PASOS[n - 1].t;
  if (ultimo) evRenderResumen();
  evRenderPasos();
  if (scroll) evEl('ev-pasos').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Ir a un paso: hacia atrás o el mismo, sin validar; hacia adelante, validando cada paso intermedio.
function evIrAPaso(n) {
  if (n <= _ev.paso) { evMostrarPaso(n, true); return; }
  var f = evLeerFormulario();
  for (var i = _ev.paso; i < n; i++) {
    _ev.visitados[i] = true;
    var err = evValidarPaso(f, i);
    if (err) { evMostrarPaso(i, true); showToast(err, '#e74c3c'); return; }
  }
  evMostrarPaso(n, true);
}

// Al editar, la solicitud ya está completa: todos los pasos se muestran como vistos.
function evMarcarTodosVisitados() {
  EV_PASOS.forEach(function (p) { _ev.visitados[p.n] = true; });
}

// Resumen del último paso, para revisar antes de enviar.
function evRenderResumen() {
  var f = evLeerFormulario(), d = f.datos, o = evComboOpcion(f.solicitante_id);
  var cuantos = function (a, otro) { var c = (a || []).length + (otro ? 1 : 0); return c ? c + ' seleccionado' + (c > 1 ? 's' : '') : 'ninguno'; };
  var base = _ev.editando && _ev.editando.estado_aprobacion !== 'Rechazada' ? _ev.editando.fecha_radicacion : today();
  var dias = d.fecha_evento ? evDias(base, d.fecha_evento) : null;
  var filas = [
    ['Solicitante', o ? o.nombre : '—'],
    ['Evento', d.nombre || '—'],
    ['Empresa', d.empresa ? evNombreEmpresa(d.empresa, d.empresa_otra) : '—'],
    ['Fecha del evento', d.fecha_evento ? fmtDate(d.fecha_evento) + (d.hora_inicio ? ' · ' + d.hora_inicio : '') : '—'],
    ['Lugar', (EV_MODALIDAD[d.modalidad] || '—') + (d.lugar ? ' · ' + d.lugar : '') + (d.plataforma ? ' · Plataforma: ' + d.plataforma : '')],
    ['Objetivos', cuantos(d.objetivos, d.objetivos_otro)],
    ['Canales de promoción', cuantos(d.canales, d.canales_otro)],
    ['Materiales', cuantos(d.materiales, d.materiales_otro)],
    ['Logística', cuantos(d.logistica, d.logistica_otro)],
    ['Presupuesto', 'Estimado ' + evMoney(d.presupuesto_estimado) + ' · solicitado a Mercadeo ' + evMoney(d.total_solicitado)],
    ['Archivos', (_ev.keep.length + _ev.files.length) || 'ninguno']
  ];
  evEl('ev-resumen').innerHTML = '<div class="sm-box" style="background:#f7fafc;border-color:#e2e8f0">' +
    '<h4>Resumen antes de enviar</h4><div class="kv">' +
    filas.map(function (r) { return '<span class="k">' + escHtml(r[0]) + '</span><span>' + escHtml(r[1]) + '</span>'; }).join('') + '</div></div>' +
    (dias !== null && dias >= 0 && dias < EV_DIAS_MINIMOS
      ? '<div class="sm-box sm-box-pend">⚠ Faltan ' + dias + ' días para el evento: la política pide mínimo ' + EV_DIAS_MINIMOS + ' días si necesitas material POP, diseño o presencia de Mercadeo. Puedes enviarla igual; Mercadeo decide.</div>'
      : '');
}

function evClientePqrs() {
  if (!_ev.pqrs) {
    _ev.pqrs = supabase.createClient(EV_PQRS_URL, EV_PQRS_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return _ev.pqrs;
}

// Sube los archivos nuevos que falten para este envío y devuelve la lista completa para `crear`/`editar`.
async function evSubirArchivos() {
  var pendientes = _ev.files.filter(function (f) { return !_ev.uploaded[evClaveArchivo(f)]; });
  if (pendientes.length) {
    var prep = await evInvocar({
      action: 'preparar',
      request_id: _ev.requestId,
      archivos: pendientes.map(function (f) { return { nombre: f.name, tamano: f.size, tipo: f.type || null }; })
    });
    if (!prep.archivos || prep.archivos.length !== pendientes.length) throw new Error('No se pudo preparar la subida de archivos');
    var storage = evClientePqrs().storage.from(EV_BUCKET);
    for (var i = 0; i < pendientes.length; i++) {
      var f = pendientes[i], u = prep.archivos[i];
      evEl('sm-progreso').textContent = 'Subiendo archivo ' + (i + 1) + ' de ' + pendientes.length + '…';
      var up = await storage.uploadToSignedUrl(u.path, u.token, f, f.type ? { contentType: f.type } : undefined);
      if (up.error) throw new Error('No se pudo subir "' + f.name + '": ' + (up.error.message || 'error de red'));
      _ev.uploaded[evClaveArchivo(f)] = { path: u.path, nombre: f.name, tamano: f.size, tipo: f.type || null };
    }
  }
  var nuevos = _ev.files.map(function (f) { return _ev.uploaded[evClaveArchivo(f)]; });
  return _ev.keep.map(function (a) { return { path: a.path, nombre: a.nombre, tamano: a.tamano, tipo: a.tipo }; }).concat(nuevos);
}

async function evEnviar() {
  if (_ev.enviando) return;                       // candado anti doble clic
  var f = evLeerFormulario();
  var pe = evPrimerError(f);
  if (pe) { evMarcarTodosVisitados(); evMostrarPaso(pe.paso, true); showToast(pe.msg, '#e74c3c'); return; }

  var previa = _ev.editando;
  // Una ya aprobada en Pedidos sale de Mercadeo al modificarla: se pide confirmación.
  if (previa && previa.estado_aprobacion === 'Aprobada' &&
      !confirm('La solicitud ' + evRef(previa) + ' ya fue aprobada y está con Mercadeo' +
        (previa.estado ? ' (' + evEstadoDe(previa.estado === 'aprobada' ? 'aprobada_merc' : previa.estado).t + ')' : '') + '.\n\n' +
        'Si la modificas, sale de Mercadeo y vuelve a aprobación del gerente comercial; ' +
        'llegará de nuevo a Mercadeo cuando se apruebe.\n\n¿Quieres continuar?')) return;

  _ev.enviando = true;
  var btn = evEl('sm-enviar');
  var reenvio = !!previa;
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    var archivos = await evSubirArchivos();
    evEl('sm-progreso').textContent = 'Registrando la solicitud…';
    var res = await evInvocar({
      action: reenvio ? 'editar' : 'crear',
      request_id: reenvio ? previa.id : _ev.requestId,
      a_nombre_de_id: f.a_nombre_de_id,
      datos: f.datos,
      archivos: archivos
    });
    var s = res.solicitud || {};
    var antes = previa ? previa.estado_aprobacion : null;
    if (s.estado_aprobacion === 'Aprobada') {
      showToast('✅ Solicitud ' + evRef(s) + (reenvio ? ' modificada' : ' enviada') + ': ya está con Mercadeo (Recibida)', '#27ae60');
    } else if (antes === 'Por aprobar') {
      showToast('✅ Solicitud ' + evRef(s) + ' modificada: sigue por aprobar', '#27ae60');
    } else if (antes === 'Aprobada') {
      showToast('✅ Solicitud ' + evRef(s) + ' modificada: salió de Mercadeo y vuelve a aprobación', '#27ae60');
    } else {
      showToast('✅ Solicitud ' + evRef(s) + (reenvio ? ' reenviada' : ' enviada') + ': queda por aprobar', '#27ae60');
    }
    if (res.aviso) showToast('⚠ ' + res.aviso + '. Queda por aprobar.', '#e67e22');
    evResetForm();
    evCambiarTab('mis');
  } catch (e) {
    evEl('sm-progreso').textContent = '';
    showToast(e.message, '#e74c3c');
  } finally {
    _ev.enviando = false;
    btn.disabled = !(_ev.ctx && _ev.ctx.empresas.length);
    btn.textContent = evTextoEnviar();
  }
}

// ── Editar una solicitud propia (por aprobar, rechazada o aprobada y aún sin aprobar en Mercadeo) ──
function evEditar(s) {
  if (!s || !s.puede_editar) return;
  evResetForm();
  _ev.editando = s;
  _ev.requestId = s.id;                           // mismo id: los archivos nuevos van a su carpeta
  _ev.keep = (s.archivos || []).slice();
  var d = s.datos || {}, sol = d.solicitante || {};
  var para = s.a_nombre_de_id || null;
  if (para && evComboOpcion(para)) evComboElegir(para);
  else if (evComboOpcion(s.solicitante_id)) evComboElegir(s.solicitante_id);
  evEl('sm-empresa').value = s.empresa;
  if (evEl('sm-empresa').value !== s.empresa) evEl('sm-empresa').value = '';   // ya no está entre las empresas del usuario
  evEl('ev-empresa-otra').value = (d && d.empresa_otra) || s.empresa_otra || '';
  evActualizarEmpresaOtra();
  evPonerArea(sol.area);
  evEl('ev-correo').value = sol.correo || '';
  evEl('ev-tel').value = sol.telefono || '';
  evEl('ev-limite').value = d.fecha_limite_aprobacion && d.fecha_limite_aprobacion >= today() ? d.fecha_limite_aprobacion : '';
  evEl('ev-nombre').value = d.nombre || '';
  evEl('sm-desc').value = d.descripcion || '';
  evEl('sm-desc-ct').textContent = (d.descripcion || '').length;
  // La fecha del evento anterior puede haber pasado: si es así se pide una nueva.
  evEl('ev-fecha').value = d.fecha_evento && d.fecha_evento >= today() ? d.fecha_evento : '';
  evEl('ev-hora-ini').value = d.hora_inicio ? String(d.hora_inicio).slice(0, 5) : '';
  evEl('ev-hora-fin').value = d.hora_fin ? String(d.hora_fin).slice(0, 5) : '';
  var m = document.querySelector('input[name="ev-mod"][value="' + (d.modalidad || 'fisico') + '"]');
  if (m) m.checked = true;
  evEl('ev-lugar').value = d.lugar || '';
  evEl('ev-plataforma').value = d.plataforma || '';
  evChecks('ev-objetivos', EV_OBJETIVOS, d.objetivos || []);
  evEl('ev-objetivos-otro').value = d.objetivos_otro || '';
  evEl('ev-publico').value = d.publico_objetivo || '';
  evEl('ev-seg-dem').value = d.segmento_demografico || '';
  evEl('ev-seg-prof').value = d.segmento_profesional || '';
  evEl('ev-nivel').value = d.nivel_conocimiento || '';
  evEl('ev-invitados').value = evNum(d.total_invitados);
  evEl('ev-asis-pres').value = evNum(d.asistentes_presencial);
  evEl('ev-asis-virt').value = evNum(d.asistentes_virtual);
  evChecks('ev-canales', EV_CANALES, d.canales || []);
  evEl('ev-canales-otro').value = d.canales_otro || '';
  evChecks('ev-materiales', EV_MATERIALES, d.materiales || []);
  evEl('ev-materiales-otro').value = d.materiales_otro || '';
  evChecks('ev-logistica', EV_LOGISTICA, d.logistica || []);
  evEl('ev-logistica-otro').value = d.logistica_otro || '';
  evEl('ev-presupuesto').value = d.presupuesto_estimado ? Number(d.presupuesto_estimado).toLocaleString('es-CO') : '';
  evEl('ev-solicitado').value = d.total_solicitado ? Number(d.total_solicitado).toLocaleString('es-CO') : '';
  evEl('ev-desglose').innerHTML = (d.desglose_gastos || []).map(function (l) { return evFilaGasto(l.concepto, l.valor); }).join('');
  evActualizarModalidad();
  evActualizarAnticipacion();
  evActualizarPresupuesto();

  evEl('sm-edit-banner').style.display = '';
  var ref = '<strong>' + escHtml(evRef(s)) + '</strong>';
  if (s.estado_aprobacion === 'Por aprobar') {
    evEl('sm-edit-banner').innerHTML = '✏️ Editando la solicitud ' + ref + ', por aprobar. ' +
      'Al guardar, los cambios quedan registrados y sigue por aprobar; “Limpiar” cancela la edición.';
  } else if (s.estado_aprobacion === 'Aprobada') {
    evEl('sm-edit-banner').innerHTML = '✏️ Editando la solicitud ' + ref + ', ya aprobada' +
      (s.estado ? ' y en Mercadeo (' + escHtml(evEstadoDe(s.estado === 'aprobada' ? 'aprobada_merc' : s.estado).t) + ')' : '') + '. ' +
      '<strong>Al guardar, sale de Mercadeo y vuelve a aprobación del gerente comercial;</strong> ' +
      'llegará de nuevo a Mercadeo cuando se apruebe. “Limpiar” cancela la edición.';
  } else {
    evEl('sm-edit-banner').innerHTML = '✏️ Editando la solicitud ' + ref + ', rechazada' +
      (s.rechazada_por_mercadeo
        ? ' por Mercadeo' + (s.aprobada_por ? ' (' + escHtml(s.aprobada_por) + ')' : '')
        : (s.aprobada_por ? ' por ' + escHtml(s.aprobada_por) : '')) + '.' +
      (s.motivo_rechazo ? ' <strong>Motivo:</strong> ' + escHtml(s.motivo_rechazo) : '') +
      ' Corrígela y reenvíala; “Limpiar” cancela la edición. Al reenviarla cuenta como una solicitud nueva para la política de 15 días.';
  }
  evEl('sm-enviar').textContent = evTextoEnviar();
  evRenderArchivos();
  evMarcarTodosVisitados();
  evMostrarPaso(1);
  evCerrarDetalle();
  evCambiarTab('nueva');
}

// ── Pestañas ──
function evCambiarTab(cual) {
  var vistas = { nueva: 'sm-vista-nueva', mis: 'sm-vista-mis', aprobar: 'sm-vista-aprobar' };
  Object.keys(vistas).forEach(function (k) {
    evEl(vistas[k]).style.display = k === cual ? '' : 'none';
    evEl('sm-tab-' + k).classList.toggle('active', k === cual);
  });
  if (cual === 'mis') evCargarLista();
  if (cual === 'aprobar') { evCargarPendientes(); evCargarAprobadas(); }
}

// ── Utilidades de pintado ──
function evEmpresaChips(arr) {
  return (arr || []).map(function (e) {
    return '<span class="sigla-badge sigla-' + escHtml(e) + '">' + escHtml(EV_EMPRESAS_EXTRA[e] ? EV_EMPRESAS_EXTRA[e].toUpperCase() : e) + '</span>';
  }).join(' ');
}

// Empresa de una solicitud: el chip y, con «Otros», el nombre escrito debajo.
function evEmpresaDe(s) {
  return evEmpresaChips([s.empresa]) + (s.empresa === 'OTROS' && s.empresa_otra ? '<div class="sm-hint" style="margin:2px 0 0">' + escHtml(s.empresa_otra) + '</div>' : '');
}

// Nombre legible de la empresa (detalle y resumen).
function evNombreEmpresa(codigo, otra) {
  if (codigo === 'OTROS') return 'Otros' + (otra ? ': ' + otra : '');
  return EV_EMPRESAS_EXTRA[codigo] || codigo || '—';
}

// ── Mis solicitudes ──
async function evCargarLista() {
  var tbody = evEl('sm-lista');
  tbody.innerHTML = '<tr><td colspan="9" class="empty">Cargando…</td></tr>';
  try {
    var r = await evInvocar({ action: 'listar' });
    _ev.lista = r.solicitudes || [];
    evEl('sm-aviso-mercadeo').style.display = r.mercadeo_disponible === false ? '' : 'none';
    evRenderLista();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No se pudieron cargar tus solicitudes: ' + escHtml(e.message) + '</td></tr>';
  }
}

function evRenderLista() {
  var tbody = evEl('sm-lista');
  evEl('sm-ct-mis').textContent = _ev.lista.length;
  evEl('sm-row-ct').textContent = '(' + _ev.lista.length + ')';
  if (!_ev.lista.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Todavía no has enviado solicitudes de eventos.</td></tr>';
    return;
  }
  tbody.innerHTML = _ev.lista.map(function (s, i) {
    return '<tr>' +
      '<td>' + escHtml(evRef(s)) + '</td>' +
      '<td>' + escHtml(evFmtFechaHora(s.creada_en)) + '</td>' +
      '<td>' + escHtml(s.nombre_evento) + '</td>' +
      '<td>' + evEmpresaDe(s) + '</td>' +
      '<td>' + escHtml(s.a_nombre_de || '—') + '</td>' +
      '<td>' + escHtml(fmtDate(s.fecha_evento)) + '</td>' +
      '<td>' + evAnticipacionHtml(s) + '</td>' +
      '<td>' + evBadgesEstado(s) + '</td>' +
      '<td><button class="btn-ver" type="button" data-ev-ver="mis:' + i + '">Ver</button>' +
      (s.puede_observar ? ' <button class="btn-ver" type="button" style="background:#2c7a7b" title="Dejarle una observación a Mercadeo" data-ev-ver="mis:' + i + ':obs">💬 Observación</button>' : '') +
      (s.puede_editar ? ' <button class="btn-ver" type="button" style="background:#b7791f" data-ev-editar="' + i + '">' + evTextoEditar(s) + '</button>' : '') +
      '</td></tr>';
  }).join('');
}

// ── Por aprobar (aprobadores) ──
async function evCargarPendientes() {
  var tbody = evEl('sm-lista-aprobar');
  tbody.innerHTML = '<tr><td colspan="9" class="empty">Cargando…</td></tr>';
  try {
    var r = await evInvocar({ action: 'pendientes' });
    _ev.pend = r.solicitudes || [];
    evEl('sm-ct-aprobar').textContent = _ev.pend.length;
    evRenderPendientes();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No se pudieron cargar las pendientes: ' + escHtml(e.message) + '</td></tr>';
  }
}

function evRenderPendientes() {
  var tbody = evEl('sm-lista-aprobar');
  evEl('sm-row-ct-aprobar').textContent = '(' + _ev.pend.length + ')';
  if (!_ev.pend.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No hay solicitudes de eventos por aprobar. 🎉</td></tr>';
    return;
  }
  tbody.innerHTML = _ev.pend.map(function (s, i) {
    return '<tr>' +
      '<td>' + escHtml(evRef(s)) + '</td>' +
      '<td>' + escHtml(evFmtFechaHora(s.creada_en)) + '</td>' +
      '<td>' + escHtml(s.solicitante || '—') + '</td>' +
      '<td>' + escHtml(s.a_nombre_de || '—') + '</td>' +
      '<td>' + escHtml(s.nombre_evento) + '</td>' +
      '<td>' + evEmpresaDe(s) + '</td>' +
      '<td>' + escHtml(fmtDate(s.fecha_evento)) + '</td>' +
      '<td>' + evAnticipacionHtml(s) + '</td>' +
      '<td><button class="btn-ver" type="button" data-ev-ver="pend:' + i + '">Revisar</button> ' +
      '<button class="btn-ver" type="button" style="background:#27ae60" data-ev-aprobar="' + i + '">✅ Aprobar</button> ' +
      '<button class="btn-ver" type="button" style="background:#c0392b" data-ev-rechazar="' + i + '">❌ Rechazar</button></td>' +
      '</tr>';
  }).join('');
}

// Aprobadas que siguen con Mercadeo: el aprobador las abre para dejarle observaciones.
async function evCargarAprobadas() {
  var tbody = evEl('sm-lista-apr');
  tbody.innerHTML = '<tr><td colspan="9" class="empty">Cargando…</td></tr>';
  try {
    var r = await evInvocar({ action: 'aprobadas' });
    _ev.apr = r.solicitudes || [];
    evEl('sm-aviso-apr').style.display = r.mercadeo_disponible === false ? '' : 'none';
    evRenderAprobadas();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No se pudieron cargar las aprobadas: ' + escHtml(e.message) + '</td></tr>';
  }
}

function evRenderAprobadas() {
  var tbody = evEl('sm-lista-apr');
  evEl('sm-row-ct-apr').textContent = '(' + _ev.apr.length + ')';
  if (!_ev.apr.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No hay solicitudes aprobadas con Mercadeo en este momento.</td></tr>';
    return;
  }
  tbody.innerHTML = _ev.apr.map(function (s, i) {
    var key = s.estado === 'aprobada' ? 'aprobada_merc' : s.estado;
    return '<tr>' +
      '<td>' + escHtml(evRef(s)) + '</td>' +
      '<td>' + escHtml(s.fecha_aprobacion ? evFmtFechaHora(s.fecha_aprobacion) : '—') + '</td>' +
      '<td>' + escHtml(s.solicitante || '—') + '</td>' +
      '<td>' + escHtml(s.a_nombre_de || '—') + '</td>' +
      '<td>' + escHtml(s.nombre_evento) + '</td>' +
      '<td>' + evEmpresaDe(s) + '</td>' +
      '<td>' + escHtml(fmtDate(s.fecha_evento)) + '</td>' +
      '<td>' + (s.estado ? '<span class="badge ' + evEstadoDe(key).cls + '">' + escHtml(evEstadoDe(key).t) + '</span>' : '—') + '</td>' +
      '<td><button class="btn-ver" type="button" data-ev-ver="apr:' + i + '">Ver</button> ' +
      '<button class="btn-ver" type="button" style="background:#2c7a7b" title="Dejarle una observación a Mercadeo" data-ev-ver="apr:' + i + ':obs">💬 Observación</button></td>' +
      '</tr>';
  }).join('');
}

async function evAprobar(i) {
  var s = _ev.pend[i];
  if (!s) return;
  var aviso = s.extemporanea ? '\n\n⚠ Llega con ' + s.dias_anticipacion + ' días de anticipación (la política pide ' + EV_DIAS_MINIMOS + ').' : '';
  if (!confirm('¿Aprobar la solicitud ' + evRef(s) + ' «' + s.nombre_evento + '»? Pasará al equipo de Mercadeo.' + aviso)) return;
  try {
    await evInvocar({ action: 'aprobar', id: s.id });
    showToast('✅ Solicitud ' + evRef(s) + ' aprobada: ya está con Mercadeo', '#27ae60');
  } catch (e) {
    showToast(e.message, '#e74c3c');
  }
  evCerrarDetalle();
  await evCargarPendientes();
  evCargarAprobadas();
}

function evPedirRechazo(i) {
  var s = _ev.pend[i];
  if (!s) return;
  _ev.rechazando = s;
  evEl('sm-rej-detalle').textContent = evRef(s) + ' · ' + s.nombre_evento + ' · ' + (s.solicitante || '');
  evEl('sm-rej-motivo').value = '';
  evEl('sm-rej-confirmar').disabled = false;
  evEl('sm-rej-overlay').classList.add('show');
  setTimeout(function () { evEl('sm-rej-motivo').focus(); }, 50);
}

function evCerrarRechazo() {
  evEl('sm-rej-overlay').classList.remove('show');
  _ev.rechazando = null;
}

async function evConfirmarRechazo() {
  var s = _ev.rechazando;
  if (!s) return;
  var motivo = evEl('sm-rej-motivo').value.trim();
  if (motivo.length < 3) { showToast('Escribe el motivo del rechazo.', '#e67e22'); return; }
  var btn = evEl('sm-rej-confirmar');
  btn.disabled = true;
  try {
    await evInvocar({ action: 'rechazar', id: s.id, motivo: motivo });
    showToast('✅ Solicitud ' + evRef(s) + ' rechazada', '#27ae60');
    evCerrarRechazo();
    evCerrarDetalle();
    await evCargarPendientes();
  } catch (e) {
    showToast(e.message, '#e74c3c');
    btn.disabled = false;
  }
}

// ── Detalle (de "Mis solicitudes", "Por aprobar" o "Aprobadas con Mercadeo") ──
var EV_TIPOS_HIST = {
  envio:          function (h) { return 'Enviada por <strong>' + escHtml(h.por) + '</strong>'; },
  reenvio:        function (h) { return 'Corregida y reenviada por <strong>' + escHtml(h.por) + '</strong>'; },
  edicion:        function (h) { return '✏️ Modificada por <strong>' + escHtml(h.por) + '</strong>'; },
  retiro_mercadeo: function () { return '↩ Retirada de Mercadeo: vuelve a aprobación y llegará de nuevo al aprobarse'; },
  aprobacion:     function (h) { return '✅ Aprobada por <strong>' + escHtml(h.por) + '</strong>'; },
  autoaprobacion: function (h) { return '✅ Aprobada automáticamente (<strong>' + escHtml(h.por) + '</strong> puede aprobar)'; },
  rechazo:        function (h) { return '❌ Rechazada por <strong>' + escHtml(h.por) + '</strong>' + (h.motivo ? ' — ' + escHtml(h.motivo) : ''); },
  rechazo_mercadeo: function (h) { return '❌ Rechazada por Mercadeo (<strong>' + escHtml(h.por) + '</strong>)' + (h.motivo ? ' — ' + escHtml(h.motivo) : ''); },
  estado:         function (h) {
    var key = h.estado === 'aprobada' ? 'aprobada_merc' : h.estado;
    return 'En Mercadeo: <strong>' + escHtml(evEstadoDe(key).t) + '</strong>' + (h.motivo ? ' — ' + escHtml(h.motivo) : '');
  }
};

function evListaDe(origen) {
  return origen === 'pend' ? _ev.pend : origen === 'apr' ? _ev.apr : _ev.lista;
}

function evListaTxt(catalogo, arr, otro) {
  var t = (arr || []).map(function (k) { return evEtiqueta(catalogo, k); });
  if (otro) t.push('Otros: ' + otro);
  return t.length ? '<ul style="margin:0;padding-left:18px">' + t.map(function (x) { return '<li>' + escHtml(x) + '</li>'; }).join('') + '</ul>' : '<span class="sm-hint">—</span>';
}

function evVerDetalle(origen, i, enfocarObs) {
  var s = evListaDe(origen)[i];
  if (!s) return;
  var d = s.datos || {}, sol = d.solicitante || {};
  _ev.detalle = { origen: origen, idx: i };
  evEl('sm-det-titulo').textContent = 'Solicitud ' + evRef(s) + ' — ' + s.nombre_evento;
  evEl('sm-det-meta').innerHTML = '<span>Enviada: ' + escHtml(evFmtFechaHora(s.creada_en)) + '</span>' +
    '<span>' + evBadgesEstado(s) + '</span>';

  var historial = (s.historial || []).map(function (h) {
    if (h.tipo === 'respuesta') {
      return '<li class="resp"><div>📣 ' + escHtml(h.texto) + '</div>' +
        '<div class="meta">' + escHtml(h.por || 'Mercadeo') + ' · ' + escHtml(evFmtFechaHora(h.en)) + '</div></li>';
    }
    if (h.tipo === 'observacion') {
      return '<li class="obs"><div>💬 <strong>Observación ' + (h.como === 'aprobador' ? 'del aprobador' : 'del solicitante') + ' a Mercadeo:</strong> ' +
        '<span style="white-space:pre-wrap">' + escHtml(h.texto) + '</span></div>' +
        '<div class="meta">' + escHtml(h.por || '—') + ' · ' + escHtml(evFmtFechaHora(h.en)) + '</div></li>';
    }
    var f = EV_TIPOS_HIST[h.tipo];
    return '<li' + (h.tipo === 'rechazo' || h.tipo === 'rechazo_mercadeo' ? ' style="border-left-color:#c0392b"' : '') + '><div>' + (f ? f(h) : escHtml(h.tipo)) + '</div>' +
      '<div class="meta">' + escHtml(evFmtFechaHora(h.en)) + '</div></li>';
  }).join('');

  var adjuntos = (s.archivos || []).map(function (x, k) {
    return '<li style="font-size:0.84rem">📎 ' + escHtml(x.nombre) + ' <span style="color:#718096">(' + escHtml(evFmtTam(x.tamano)) + ')</span> ' +
      '<button type="button" class="btn-ver" data-ev-adj="' + origen + ':' + i + ':' + k + '" style="padding:2px 10px">Abrir</button></li>';
  }).join('');

  var aprobacion = '';
  if (s.estado_aprobacion === 'Por aprobar') {
    aprobacion = '<div class="sm-box sm-box-pend">⏳ Por aprobar: un aprobador la revisará antes de que pase a Mercadeo.</div>';
  } else if (s.estado_aprobacion === 'Rechazada') {
    aprobacion = '<div class="sm-box sm-box-rech">❌ Rechazada' + (s.rechazada_por_mercadeo ? ' por Mercadeo' : '') +
      (s.aprobada_por ? (s.rechazada_por_mercadeo ? ' (' : ' por ') + '<strong>' + escHtml(s.aprobada_por) + '</strong>' + (s.rechazada_por_mercadeo ? ')' : '') : '') +
      (s.fecha_aprobacion ? ' el ' + escHtml(evFmtFechaHora(s.fecha_aprobacion)) : '') +
      '<br><strong>Motivo:</strong> ' + escHtml(s.motivo_rechazo || '—') + '</div>';
  } else {
    aprobacion = '<div class="sm-box sm-box-ok">✅ Aprobada' + (s.auto_aprobada ? ' automáticamente' : '') +
      (s.aprobada_por ? ' por <strong>' + escHtml(s.aprobada_por) + '</strong>' : '') +
      (s.fecha_aprobacion ? ' el ' + escHtml(evFmtFechaHora(s.fecha_aprobacion)) : '') + '</div>';
  }
  if (s.estado === 'cancelada') {
    aprobacion += '<div class="sm-box sm-box-rech">🚫 Cancelada por Mercadeo' + (s.cancelada_por ? ' (' + escHtml(s.cancelada_por) + ')' : '') +
      '<br><strong>Motivo:</strong> ' + escHtml(s.motivo_cancelacion || '—') + '</div>';
  }

  var enMercadeo = s.estado_aprobacion === 'Aprobada';
  var horario = (d.hora_inicio ? String(d.hora_inicio).slice(0, 5) : '') + (d.hora_fin ? ' a ' + String(d.hora_fin).slice(0, 5) : '');
  var lugar = (EV_MODALIDAD[d.modalidad] || '—') + (d.lugar ? ' · ' + d.lugar : '') + (d.plataforma ? ' · Plataforma: ' + d.plataforma : '');
  var desglose = (d.desglose_gastos || []).map(function (l) { return '<li>' + escHtml(l.concepto) + ': <strong>' + escHtml(evMoney(l.valor)) + '</strong></li>'; }).join('');
  evEl('sm-det-cuerpo').innerHTML = aprobacion +
    (s.extemporanea && s.estado_aprobacion !== 'Rechazada' ? '<div class="sm-box sm-box-pend">⚠ Solicitada con ' + escHtml(s.dias_anticipacion) + ' días de anticipación (la política pide mínimo ' + EV_DIAS_MINIMOS + '). Mercadeo decide.</div>' : '') +
    '<h4>1. Información general del solicitante</h4><div class="kv">' +
      '<span class="k">Solicitante</span><span>' + escHtml(sol.nombre || s.solicitante || '—') + '</span>' +
      '<span class="k">Enviada por</span><span>' + escHtml(s.solicitante || '—') + '</span>' +
      '<span class="k">Departamento / Área</span><span>' + escHtml(sol.area || '—') + '</span>' +
      '<span class="k">Correo</span><span>' + escHtml(sol.correo || '—') + '</span>' +
      '<span class="k">Teléfono</span><span>' + escHtml(sol.telefono || '—') + '</span>' +
      '<span class="k">Fecha límite aprobación</span><span>' + escHtml(d.fecha_limite_aprobacion ? fmtDate(d.fecha_limite_aprobacion) : '—') + '</span>' +
    '</div>' +
    '<h4>2. Detalles del evento</h4><div class="kv">' +
      '<span class="k">Empresa</span><span>' + escHtml(evNombreEmpresa(s.empresa, s.empresa_otra)) + '</span>' +
      '<span class="k">Fecha del evento</span><span>' + escHtml(fmtDate(s.fecha_evento)) + (horario ? ' · ' + escHtml(horario) : '') + '</span>' +
      '<span class="k">Lugar / Ubicación</span><span>' + escHtml(lugar) + '</span>' +
      '<span class="k">Radicada el</span><span>' + escHtml(fmtDate(s.fecha_radicacion)) + '</span>' +
    '</div>' +
    '<h4>Descripción</h4><div style="white-space:pre-wrap;font-size:0.88rem">' + escHtml(d.descripcion || '') + '</div>' +
    '<h4>3. Objetivos y público</h4>' + evListaTxt(EV_OBJETIVOS, d.objetivos, d.objetivos_otro) +
    '<div class="kv" style="margin-top:8px">' +
      '<span class="k">Público objetivo</span><span>' + escHtml(d.publico_objetivo || '—') + '</span>' +
      '<span class="k">Segmento demográfico</span><span>' + escHtml(d.segmento_demografico || '—') + '</span>' +
      '<span class="k">Segmentación profesional</span><span>' + escHtml(d.segmento_profesional || '—') + '</span>' +
      '<span class="k">Nivel de conocimiento</span><span>' + escHtml(d.nivel_conocimiento || '—') + '</span>' +
      '<span class="k">Asistentes esperados</span><span>' + escHtml((d.total_invitados !== null && d.total_invitados !== undefined ? d.total_invitados + ' invitados' : '—') +
        (d.asistentes_presencial !== null && d.asistentes_presencial !== undefined ? ' · ' + d.asistentes_presencial + ' presenciales' : '') +
        (d.asistentes_virtual !== null && d.asistentes_virtual !== undefined ? ' · ' + d.asistentes_virtual + ' virtuales' : '')) + '</span>' +
    '</div>' +
    '<h4>4. Requerimientos de Mercadeo</h4>' +
    '<div class="sm-hint" style="margin:0 0 2px">Canales de promoción</div>' + evListaTxt(EV_CANALES, d.canales, d.canales_otro) +
    '<div class="sm-hint" style="margin:8px 0 2px">Materiales gráficos y visuales</div>' + evListaTxt(EV_MATERIALES, d.materiales, d.materiales_otro) +
    '<div class="sm-hint" style="margin:8px 0 2px">Logística y presencialidad</div>' + evListaTxt(EV_LOGISTICA, d.logistica, d.logistica_otro) +
    '<h4>5. Presupuesto</h4><div class="kv">' +
      '<span class="k">Presupuesto estimado</span><span>' + escHtml(evMoney(d.presupuesto_estimado)) + '</span>' +
      '<span class="k">Total solicitado a Mercadeo</span><span>' + escHtml(evMoney(d.total_solicitado)) + '</span>' +
    '</div>' + (desglose ? '<ul style="margin:6px 0 0;padding-left:18px;font-size:0.86rem">' + desglose + '</ul>' : '') +
    (enMercadeo
      ? '<h4>Seguimiento en Mercadeo</h4><div class="kv">' +
          '<span class="k">Aprobada por Mercadeo</span><span>' + escHtml(s.aprobada_mercadeo_por ? s.aprobada_mercadeo_por + ' · ' + evFmtFechaHora(s.aprobada_mercadeo_en) : 'Pendiente') + '</span>' +
          '<span class="k">Realizada</span><span>' + escHtml(s.realizada_en ? evFmtFechaHora(s.realizada_en) : '—') + '</span>' +
          '<span class="k">Base de datos de asistentes</span><span>' + escHtml(s.bd_no_aplica ? 'No aplica' : (s.bd_asistentes_fecha ? 'Recibida el ' + fmtDate(s.bd_asistentes_fecha) : 'Pendiente (plazo: 3 días hábiles tras el evento)')) + '</span>' +
        '</div>'
      : '') +
    '<h4>Archivos enviados</h4>' + (adjuntos ? '<ul style="margin:0;padding-left:18px">' + adjuntos + '</ul>' : '<div class="sm-hint">Sin archivos.</div>') +
    '<h4>Seguimiento</h4>' + (historial ? '<ul class="sm-hist">' + historial + '</ul>' : '<div class="sm-hint">Sin novedades.</div>') +
    (s.puede_observar && origen !== 'pend' ? evObservacionHtml() : '');

  // Acciones según quién mira y en qué estado está
  var acc = '';
  if (origen === 'pend') {
    acc += '<button class="btn-confirm" type="button" style="background:#27ae60" data-ev-aprobar="' + i + '">✅ Aprobar</button> ' +
      '<button class="btn-confirm" type="button" style="background:#c0392b" data-ev-rechazar="' + i + '">❌ Rechazar</button>';
  } else if (origen === 'mis' && s.puede_editar) {
    acc += '<button class="btn-confirm" type="button" style="background:#b7791f" data-ev-editar="' + i + '">' + evTextoEditar(s) + '</button>';
  }
  evEl('sm-det-acciones').innerHTML = acc;
  evEl('sm-overlay').classList.add('show');
  if (enfocarObs && evEl('sm-obs-txt')) {
    var box = evEl('sm-obs-box');
    if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
    evEl('sm-obs-txt').focus();
  }
}

// Campo para dejarle una observación a Mercadeo (solicitudes que siguen con ella).
function evObservacionHtml() {
  return '<div id="sm-obs-box" class="sm-obs-box">' +
    '<h4 style="margin-top:0">💬 Observación para Mercadeo</h4>' +
    '<div class="sm-hint" style="margin:0 0 8px">Si necesitas aclarar o ajustar algo de tu evento (fecha, lugar, materiales…), escríbeselo aquí. ' +
    'Queda en la bitácora del evento y reciben un aviso. Puedes enviar varias; las anteriores no se borran.</div>' +
    '<textarea class="ef" id="sm-obs-txt" rows="3" maxlength="1000" placeholder="Ej.: el evento se mueve una hora más tarde y llegarán 20 invitados más…"></textarea>' +
    '<div class="sm-counter"><span id="sm-obs-ct">0</span> / 1000</div>' +
    '<button class="btn-confirm" id="sm-obs-enviar" type="button" style="background:#2c7a7b;margin-top:6px" data-ev-obs-enviar="1">💬 Enviar a Mercadeo</button>' +
    '</div>';
}

// Vuelve a cargar la lista de donde se abrió el detalle y lo reabre con lo nuevo (o lo cierra si ya no existe).
async function evRefrescarDetalle(origen, id) {
  if (origen === 'apr') await evCargarAprobadas(); else await evCargarLista();
  var lista = evListaDe(origen);
  for (var k = 0; k < lista.length; k++) {
    if (lista[k].id === id) { evVerDetalle(origen, k); return; }
  }
  evCerrarDetalle();
}

async function evEnviarObservacion() {
  if (_ev.observando) return;                      // candado anti doble clic
  var det = _ev.detalle;
  var s = det ? evListaDe(det.origen)[det.idx] : null;
  if (!s) return;
  var txt = evEl('sm-obs-txt').value.trim();
  if (txt.length < 5) { showToast('Escribe la observación (mínimo 5 caracteres)', '#e74c3c'); return; }
  if (txt.length > 1000) { showToast('La observación no puede superar 1000 caracteres', '#e74c3c'); return; }
  _ev.observando = true;
  var btn = evEl('sm-obs-enviar');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  var enviada = false;
  try {
    await evInvocar({ action: 'observar', id: s.id, texto: txt });
    enviada = true;
    showToast('✅ Observación enviada a Mercadeo (' + evRef(s) + ')', '#27ae60');
  } catch (e) {
    showToast(e.message, '#e74c3c');            // el texto escrito se conserva para reintentar
    btn.disabled = false;
    btn.textContent = '💬 Enviar a Mercadeo';
  } finally {
    _ev.observando = false;
  }
  if (enviada) await evRefrescarDetalle(det.origen, s.id);
}

async function evAbrirAdjunto(origen, i, k) {
  var s = evListaDe(origen)[i];
  if (!s) return;
  // Se abre la pestaña de inmediato (evita el bloqueo de ventanas) y se completa con la URL firmada.
  var w = window.open('', '_blank');
  try {
    var r = await evInvocar({ action: 'archivo_url', id: s.id, indice: k });
    if (w) { w.opener = null; w.location.href = r.url; } else { window.open(r.url, '_blank', 'noopener'); }
  } catch (e) {
    if (w) w.close();
    showToast(e.message, '#e74c3c');
  }
}

function evCerrarDetalle() { evEl('sm-overlay').classList.remove('show'); _ev.detalle = null; }

// ── Eventos ──
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t || !t.closest) return;
  var tab = t.closest('[data-sm-tab]');
  if (tab) { evCambiarTab(tab.getAttribute('data-sm-tab')); return; }
  var paso = t.closest('[data-ev-paso]');
  if (paso) { evIrAPaso(Number(paso.getAttribute('data-ev-paso'))); return; }
  var quitar = t.closest('[data-ev-quitar]');
  if (quitar) {
    _ev.files.splice(Number(quitar.getAttribute('data-ev-quitar')), 1);
    evRenderArchivos();
    return;
  }
  var quitarKeep = t.closest('[data-ev-quitar-keep]');
  if (quitarKeep) {
    _ev.keep.splice(Number(quitarKeep.getAttribute('data-ev-quitar-keep')), 1);
    evRenderArchivos();
    return;
  }
  if (t.closest('[data-ev-gasto-quitar]')) {
    var fila = t.closest('.ev-gasto');
    if (fila) fila.remove();
    evActualizarPresupuesto();
    return;
  }
  var ver = t.closest('[data-ev-ver]');
  if (ver) {
    var p = ver.getAttribute('data-ev-ver').split(':');
    evVerDetalle(p[0], Number(p[1]), p[2] === 'obs');
    return;
  }
  if (t.closest('[data-ev-obs-enviar]')) { evEnviarObservacion(); return; }
  var adj = t.closest('[data-ev-adj]');
  if (adj) {
    var a = adj.getAttribute('data-ev-adj').split(':');
    evAbrirAdjunto(a[0], Number(a[1]), Number(a[2]));
    return;
  }
  var ed = t.closest('[data-ev-editar]');
  if (ed) { evEditar(_ev.lista[Number(ed.getAttribute('data-ev-editar'))]); return; }
  var apr = t.closest('[data-ev-aprobar]');
  if (apr) { evAprobar(Number(apr.getAttribute('data-ev-aprobar'))); return; }
  var rec = t.closest('[data-ev-rechazar]');
  if (rec) { evPedirRechazo(Number(rec.getAttribute('data-ev-rechazar'))); return; }
});

document.addEventListener('DOMContentLoaded', function () {
  evEl('sm-enviar').addEventListener('click', evEnviar);
  evEl('sm-limpiar').addEventListener('click', function () { if (!_ev.enviando) evResetForm(); });
  evEl('ev-anterior').addEventListener('click', function () { evMostrarPaso(_ev.paso - 1, true); });
  evEl('ev-siguiente').addEventListener('click', function () { evIrAPaso(_ev.paso + 1); });
  evEl('sm-refrescar').addEventListener('click', evCargarLista);
  evEl('sm-refrescar-aprobar').addEventListener('click', function () { evCargarPendientes(); evCargarAprobadas(); });
  // El detalle se vuelve a pintar cada vez: el contador de la observación se escucha desde el documento.
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'sm-obs-txt') evEl('sm-obs-ct').textContent = e.target.value.length;
  });
  evEl('sm-det-cerrar').addEventListener('click', evCerrarDetalle);
  evEl('sm-det-cerrar2').addEventListener('click', evCerrarDetalle);
  evEl('sm-overlay').addEventListener('click', function (e) { if (isBackdropClick(e)) evCerrarDetalle(); });
  evEl('sm-rej-cancelar').addEventListener('click', evCerrarRechazo);
  evEl('sm-rej-confirmar').addEventListener('click', evConfirmarRechazo);
  evEl('sm-rej-overlay').addEventListener('click', function (e) { if (isBackdropClick(e)) evCerrarRechazo(); });
  evEl('sm-files').addEventListener('change', function () { evAgregarArchivos(this.files); });
  // Combo "Solicitante"
  var cbo = evEl('sm-solicitante');
  cbo.addEventListener('focus', evComboAlEnfocar);
  cbo.addEventListener('click', evComboAlEnfocar);
  cbo.addEventListener('input', function () { evEl('sm-solicitante-id').value = ''; evComboAbrir(this.value); });
  cbo.addEventListener('keydown', evComboAlTeclear);
  cbo.addEventListener('blur', evComboAlSalir);
  // mousedown (no click): se elige antes de que el cuadro pierda el foco.
  evEl('sm-solicitante-lista').addEventListener('mousedown', function (e) {
    e.preventDefault();
    var li = e.target.closest ? e.target.closest('li[data-id]') : null;
    if (li) evComboElegir(li.getAttribute('data-id'));
  });
  evEl('sm-desc').addEventListener('input', function () { evEl('sm-desc-ct').textContent = this.value.length; });
  evEl('ev-modalidad').addEventListener('change', evActualizarModalidad);
  evEl('sm-empresa').addEventListener('change', evActualizarEmpresaOtra);
  evEl('ev-fecha').addEventListener('change', evActualizarAnticipacion);
  evEl('ev-presupuesto').addEventListener('input', evActualizarPresupuesto);
  evEl('ev-solicitado').addEventListener('input', evActualizarPresupuesto);
  evEl('ev-desglose').addEventListener('input', evActualizarPresupuesto);
  evEl('ev-gasto-agregar').addEventListener('click', function () {
    evEl('ev-desglose').insertAdjacentHTML('beforeend', evFilaGasto('', ''));
    var filas = evEl('ev-desglose').querySelectorAll('.ev-g-con');
    if (filas.length) filas[filas.length - 1].focus();
  });
  evInit();
});
