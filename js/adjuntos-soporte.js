// ══════════════════════════════════════════════════════════════
// Archivos de soporte al registrar un Cambio de Mercancía o una Devolución (devoluciones.html)
// ══════════════════════════════════════════════════════════════
// Zona OPCIONAL «📎 Archivos de soporte» de los formularios de alta: el usuario elige o arrastra varios archivos, quedan en
// memoria (se pueden quitar) y se suben a Storage SOLO cuando el registro ya se guardó bien, así no quedan archivos huérfanos si
// falla el guardado. Reglas de siempre en el panel: PDF / JPG / PNG / WEBP, hasta ASP_MAX_BYTES cada uno (los buckets repiten el
// tope y los tipos); ASP_MAX_ARCHIVOS por envío. Los archivos van a <bucket>/<SIGLA>/<consecutivo>_<cliente>/<marca>_<nombre>,
// la misma carpeta que lee el detalle (cambios.js → camAdjuntoFolder; devoluciones.js → devAdjuntoFolder).
// Cambios usa el bucket cambios-adjuntos y Devoluciones devoluciones-adjuntos (privado,
// supabase/migrations/create_devoluciones_adjuntos.sql: aplicar ANTES de publicar el código).
// Depende de: _sb, escHtml, showToast (shared.js).

var ASP_MAX_BYTES = 5 * 1024 * 1024;
var ASP_MAX_ARCHIVOS = 10;
var ASP_TIPOS_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
var ASP_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

function aspExtension(nombre) {
  var p = String(nombre || '').split('.');
  return p.length > 1 ? p.pop().toLowerCase() : '';
}

// Tipo MIME permitido del archivo, o '' si no lo es. Algunos navegadores no informan el tipo: entonces manda la extensión.
function aspTipoDe(file) {
  var t = String((file && file.type) || '').toLowerCase();
  var permitidos = {};
  Object.keys(ASP_TIPOS_EXT).forEach(function (k) { permitidos[ASP_TIPOS_EXT[k]] = true; });
  if (t) return permitidos[t] ? t : '';
  return ASP_TIPOS_EXT[aspExtension(file && file.name)] || '';
}

function aspTamano(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// Nombre apto para una ruta de Storage (sin acentos ni símbolos), conservando la extensión.
function aspNombreSeguro(nombre) {
  var s = String(nombre || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (s.length > 100) { var ext = aspExtension(s); s = s.slice(0, 95) + (ext ? '.' + ext : ''); }
  return s;
}

// Nombre para mostrar: sin la marca de tiempo (13 dígitos + «_») con que se guarda el archivo.
function aspNombreVisible(nombre) {
  return String(nombre || '').replace(/^\d{13}_/, '');
}

// Revisa archivos recién elegidos. «yaHay» = cuántos hay ya en la lista; «claves» = {nombre|tamaño|fecha: true} de los ya elegidos.
// Devuelve { ok: [File], msgs: [texto] } con lo que se acepta y por qué se descartó lo demás.
function aspFiltrar(lista, yaHay, claves) {
  var ok = [], msgs = [];
  Array.prototype.slice.call(lista || []).forEach(function (f) {
    var clave = f.name + '|' + f.size + '|' + f.lastModified;
    if (claves && claves[clave]) return;
    if (!aspTipoDe(f)) { msgs.push('«' + f.name + '»: solo PDF, JPG, PNG o WEBP'); return; }
    if (f.size > ASP_MAX_BYTES) { msgs.push('«' + f.name + '» pesa más de ' + (ASP_MAX_BYTES / 1048576) + ' MB'); return; }
    if (f.size === 0) { msgs.push('«' + f.name + '» está vacío'); return; }
    if (yaHay + ok.length >= ASP_MAX_ARCHIVOS) { msgs.push('Máximo ' + ASP_MAX_ARCHIVOS + ' archivos por vez: «' + f.name + '» no se agregó'); return; }
    ok.push(f);
  });
  return { ok: ok, msgs: msgs };
}

function aspAvisar(msgs) {
  if (msgs && msgs.length) showToast(msgs.slice(0, 3).join(' · ') + (msgs.length > 3 ? ' (+' + (msgs.length - 3) + ' más)' : ''), '#e74c3c');
}

// Sube los archivos a bucket/carpeta, uno tras otro; si uno falla sigue con los demás.
// onProgreso(n, total, nombre) se llama antes de cada subida. Devuelve { subidos, fallos: [{ nombre, error }] }.
async function aspSubir(bucket, carpeta, archivos, onProgreso) {
  var subidos = 0, fallos = [];
  var base = Date.now();          // + índice: dos archivos del mismo envío nunca comparten marca ni ruta
  for (var i = 0; i < archivos.length; i++) {
    var f = archivos[i];
    if (onProgreso) onProgreso(i + 1, archivos.length, f.name);
    try {
      var res = await _sb.storage.from(bucket).upload(carpeta + '/' + (base + i) + '_' + aspNombreSeguro(f.name), f, {
        cacheControl: '3600', upsert: false, contentType: aspTipoDe(f)
      });
      if (res.error) throw new Error(res.error.message);
      subidos++;
    } catch (e) {
      fallos.push({ nombre: f.name, error: (e && e.message) || 'error desconocido' });
    }
  }
  return { subidos: subidos, fallos: fallos };
}

// Sube el soporte elegido en el formulario (control = aspCrear) DESPUÉS de guardar el registro, mostrando el avance en el botón.
// El registro ya existe, así que un fallo no deshace nada: se informa para que el usuario lo agregue desde el detalle.
// Devuelve { extra, falla }: «extra» se agrega al aviso de éxito (' · 2 archivo(s) de soporte'); «falla» trae el motivo si algo no subió.
async function aspSubirSoporte(control, bucket, carpeta, boton) {
  var archivos = control.archivos();
  if (!archivos.length) return { extra: '', falla: '' };
  var r = await aspSubir(bucket, carpeta, archivos, function (n, total) {
    if (boton) boton.textContent = '⏳ Subiendo archivos (' + n + '/' + total + ')...';
  });
  control.limpiar();
  if (!r.fallos.length) return { extra: ' · ' + r.subidos + ' archivo(s) de soporte', falla: '' };
  return {
    extra: '',
    falla: 'no se pudo subir: ' + r.fallos.map(function (f) { return '«' + f.nombre + '» (' + f.error + ')'; }).join(', ') +
      (r.subidos ? ' (los otros ' + r.subidos + ' sí se subieron)' : '') + '. Agrégalo desde el detalle (📋 Ver).'
  };
}

// Zona de selección dentro de #contenedorId. Devuelve un control:
//   archivos()      → [File] elegidos hasta ahora
//   limpiar()       → vacía la lista (al abrir el formulario y después de guardar)
//   modoEdicion(b)  → en «Editar» no se piden archivos: se muestra un aviso en lugar de la zona
function aspCrear(contenedorId) {
  var cont = document.getElementById(contenedorId);
  if (!cont) return { archivos: function () { return []; }, limpiar: function () {}, modoEdicion: function () {} };
  var archivos = [];
  var claves = {};
  var edicion = false;

  cont.innerHTML =
    '<div class="sop-zona">' +
      '<div class="adjunto-dropzone sop-drop">Arrastra archivos aquí o haz clic para seleccionar · PDF, JPG, PNG, WEBP (máx. ' + (ASP_MAX_BYTES / 1048576) + ' MB c/u, hasta ' + ASP_MAX_ARCHIVOS + ')' +
        '<input type="file" multiple accept="' + ASP_ACCEPT + '">' +
      '</div>' +
      '<div class="sop-lista"></div>' +
    '</div>' +
    '<div class="sop-aviso" style="display:none">Para agregar o quitar archivos de soporte abre el detalle (📋 Ver) de la solicitud.</div>';

  var zona = cont.querySelector('.sop-zona');
  var aviso = cont.querySelector('.sop-aviso');
  var drop = cont.querySelector('.sop-drop');
  var input = cont.querySelector('input[type=file]');
  var lista = cont.querySelector('.sop-lista');

  function pintar() {
    lista.innerHTML = archivos.map(function (f, i) {
      return '<div class="sop-item">' +
        '<span class="sop-ico">' + (aspExtension(f.name) === 'pdf' ? '📄' : '🖼️') + '</span>' +
        '<span class="sop-nom" title="' + escHtml(f.name) + '">' + escHtml(f.name) + '</span>' +
        '<span class="sop-tam">' + aspTamano(f.size) + '</span>' +
        '<button type="button" class="sop-quitar" data-i="' + i + '" title="Quitar">✕</button>' +
      '</div>';
    }).join('');
  }

  function agregar(lst) {
    var r = aspFiltrar(lst, archivos.length, claves);
    r.ok.forEach(function (f) { archivos.push(f); claves[f.name + '|' + f.size + '|' + f.lastModified] = true; });
    aspAvisar(r.msgs);
    pintar();
  }

  drop.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
  input.addEventListener('change', function () { agregar(input.files); input.value = ''; });
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('drag-over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files) agregar(e.dataTransfer.files);
  });
  lista.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.sop-quitar') : null;
    if (!b) return;
    var f = archivos.splice(Number(b.getAttribute('data-i')), 1)[0];
    if (f) delete claves[f.name + '|' + f.size + '|' + f.lastModified];
    pintar();
  });

  return {
    archivos: function () { return archivos.slice(); },
    limpiar: function () { archivos = []; claves = {}; input.value = ''; pintar(); },
    modoEdicion: function (b) { edicion = !!b; zona.style.display = edicion ? 'none' : ''; aviso.style.display = edicion ? '' : 'none'; }
  };
}
