// ══════════════════════════════════════════════════════════════
// Productos relacionados con una solicitud (Solicitudes a Mercadeo y Solicitudes de Eventos)
// ══════════════════════════════════════════════════════════════
// Campo OPCIONAL: buscador con «chips». Las sugerencias salen de maestro_productos, pero con el NOMBRE del producto, sin la
// presentación (se corta en la primera « X »): «CALIMAN X LITRO» y «CALIMAN X GALON» dan una sola opción, «CALIMAN». Un nombre
// del maestro sin « X » (p. ej. «ACIDO CITRICO») se ofrece completo. Lo que no esté en el listado se escribe directo y se guarda
// tal cual en la solicitud (NO se agrega al maestro).
// Se guarda como arreglo de textos, ["CALIMAN", "Otro producto"], de hasta PS_MAX productos de PS_MIN_LEN a PS_MAX_LEN
// caracteres. Las Edge Functions (solicitud-mercadeo y solicitud-evento) y panel-pqrs vuelven a exigir las mismas reglas: si
// cambias una aquí, cámbiala allá. El servidor no consulta el maestro (acepta cualquier texto dentro de esos límites).
// Depende de: apiGet, escHtml, showToast (shared.js).

var PS_MAX = 20;
var PS_MIN_LEN = 2;
var PS_MAX_LEN = 100;

var _psCatalogo = null;    // { lista: [{ n: nombre, k: clave }], por: { clave: nombre } } cuando ya cargó
var _psCargando = null;    // promesa en curso

// Clave de comparación: sin tildes, sin mayúsculas y con los espacios normalizados.
function psNorm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Texto de una sola línea, sin caracteres de control ni espacios de sobra.
function psLimpiar(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Nombre del producto sin la presentación: lo que va antes de la primera « X » (sin importar mayúsculas).
// «CALIMAN X LITRO» -> «CALIMAN»; «ACIDO CITRICO» (sin « X ») se queda igual.
function psNombreBase(producto) {
  var t = psLimpiar(producto);
  var m = /\s+x\s+/i.exec(t);
  return m ? t.slice(0, m.index).trim() : t;
}

// Catálogo de nombres únicos (sin repetir por mayúsculas o tildes) y ordenados, a partir de las filas del maestro.
function psConstruirCatalogo(filas) {
  var por = {}, lista = [];
  (filas || []).forEach(function (f) {
    var b = psNombreBase(f && (f.producto != null ? f.producto : f.Producto));
    var k = psNorm(b);
    if (!k || por[k]) return;
    por[k] = b;
    lista.push({ n: b, k: k });
  });
  lista.sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; });
  return { lista: lista, por: por };
}

// Carga (una sola vez) el maestro de productos. Si falla, no se guarda el error: el próximo intento vuelve a pedirlo.
function psCargarCatalogo() {
  if (_psCatalogo) return Promise.resolve(_psCatalogo);
  if (!_psCargando) {
    _psCargando = apiGet('getMaestroProductos').then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'sin respuesta');
      _psCatalogo = psConstruirCatalogo(r.productos);
      return _psCatalogo;
    }).catch(function (e) {
      _psCargando = null;
      throw e;
    });
  }
  return _psCargando;
}

// Nombres del catálogo que contienen todas las palabras escritas (los que empiezan por lo escrito, primero) y no están elegidos.
function psSugerencias(catalogo, consulta, elegidos) {
  var q = psNorm(consulta);
  var palabras = q ? q.split(' ') : [];
  var tomados = {};
  elegidos.forEach(function (n) { tomados[psNorm(n)] = true; });
  var primeros = [], resto = [];
  catalogo.lista.forEach(function (e) {
    if (tomados[e.k]) return;
    for (var i = 0; i < palabras.length; i++) if (e.k.indexOf(palabras[i]) < 0) return;
    (q && e.k.indexOf(q) === 0 ? primeros : resto).push(e.n);
  });
  return primeros.concat(resto);
}

// Productos como etiquetas de solo lectura (detalle de la solicitud) o «—» si no hay.
function psTagsHtml(arr) {
  var l = Array.isArray(arr) ? arr : [];
  if (!l.length) return '—';
  return l.map(function (n) { return '<span class="ps-tag">' + escHtml(n) + '</span>'; }).join(' ');
}

(function () {
  if (document.getElementById('ps-css')) return;
  var st = document.createElement('style');
  st.id = 'ps-css';
  st.textContent =
    '.ps-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }' +
    '.ps-chips:empty { display: none; }' +
    '.ps-chip, .ps-tag { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; padding: 3px 4px 3px 10px; border-radius: 14px; background: #ebf5fb; border: 1px solid #aed6f1; color: #1a5276; font-size: 0.82rem; font-weight: 600; }' +
    '.ps-tag { padding: 2px 10px; margin: 0 4px 4px 0; }' +
    '.ps-chip.ps-otro { background: #fef9e7; border: 1px dashed #d4ac0d; color: #8a6d0b; }' +
    '.ps-chip > span { overflow-wrap: anywhere; }' +
    '.ps-chip button { background: none; border: none; color: inherit; cursor: pointer; font-size: 0.9rem; line-height: 1; padding: 2px 7px; border-radius: 50%; }' +
    '.ps-chip button:hover { background: rgba(0,0,0,0.1); }' +
    '.ps-fila { display: flex; gap: 8px; align-items: flex-start; }' +
    '.ps-combo { position: relative; flex: 1; min-width: 0; }' +
    '.ps-agregar { padding: 7px 14px; }' +
    '.ps-lista { position: absolute; left: 0; right: 0; top: 100%; z-index: 30; margin: 2px 0 0; padding: 4px 0; list-style: none; max-height: 240px; overflow-y: auto; background: white; border: 1px solid #cbd5e0; border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); }' +
    '.ps-lista li { padding: 7px 12px; font-size: 0.86rem; cursor: pointer; }' +
    '.ps-lista li.activo, .ps-lista li:hover { background: #ebf5fb; }' +
    '.ps-lista li.libre { color: #8a6d0b; border-top: 1px solid #edf2f7; }' +
    '.ps-lista li.libre em { color: #718096; font-size: 0.76rem; }' +
    '.ps-lista li.vacio { color: #a0aec0; cursor: default; font-style: italic; }' +
    '.ps-aviso { color: #b7791f; }';
  document.head.appendChild(st);
})();

// Crea el campo dentro de `raiz` (un <div> con id; el <label> del formulario apunta a «<id>-in»).
// Devuelve { valor(), poner(arr), limpiar(), pendiente() }:
//   valor()     -> copia del arreglo de productos elegidos
//   poner(arr)  -> reemplaza lo elegido (al editar una solicitud)
//   limpiar()   -> vacía lo elegido y el cuadro de búsqueda
//   pendiente() -> texto escrito en el cuadro que todavía NO se agregó (para avisar antes de enviar)
function psCrear(raiz) {
  var id = raiz.id;
  var elegidos = [];
  var items = [];
  var activo = -1;
  var abierta = false;
  var errorCatalogo = false;

  raiz.classList.add('ps');
  raiz.innerHTML =
    '<div class="ps-chips" id="' + id + '-chips"></div>' +
    '<div class="ps-fila">' +
      '<div class="ps-combo">' +
        '<input class="ef" type="text" id="' + id + '-in" maxlength="' + PS_MAX_LEN + '" autocomplete="off" role="combobox" ' +
          'aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-lista" placeholder="Escribe para buscar un producto…">' +
        '<ul class="ps-lista" id="' + id + '-lista" role="listbox" style="display:none"></ul>' +
      '</div>' +
      '<button type="button" class="btn-ver ps-agregar" id="' + id + '-add">➕ Agregar</button>' +
    '</div>' +
    '<div class="sm-hint" id="' + id + '-hint"></div>';

  var chips = document.getElementById(id + '-chips');
  var input = document.getElementById(id + '-in');
  var lista = document.getElementById(id + '-lista');
  var hint = document.getElementById(id + '-hint');
  var btnAdd = document.getElementById(id + '-add');

  function textoEscrito() { return psLimpiar(input.value); }

  function pintarChips() {
    var cat = _psCatalogo;
    chips.innerHTML = elegidos.map(function (n, i) {
      var otro = !!cat && !cat.por[psNorm(n)];
      return '<span class="ps-chip' + (otro ? ' ps-otro' : '') + '"' + (otro ? ' title="No está en el listado de productos"' : '') + '>' +
        '<span>' + escHtml(n) + '</span>' +
        '<button type="button" data-ps-quitar="' + i + '" aria-label="Quitar ' + escHtml(n) + '">✕</button></span>';
    }).join('');
  }

  function pintarHint() {
    hint.innerHTML = (errorCatalogo
      ? '<span class="ps-aviso">No se pudo cargar el listado de productos; escribe el nombre y presiona Enter o «Agregar».</span>'
      : 'Busca por nombre (sin la presentación). Si el producto no está en el listado, escríbelo completo y presiona Enter o «Agregar».') +
      ' <span style="color:#a0aec0">· ' + elegidos.length + ' de ' + PS_MAX + '</span>';
  }

  function cerrar() {
    abierta = false;
    lista.style.display = 'none';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  // Calcula lo que ofrece la lista según lo escrito: coincidencias del listado y, si lo escrito no es un producto del
  // listado ni está ya elegido, la opción de agregarlo tal cual.
  function construirItems() {
    var texto = textoEscrito();
    var cat = _psCatalogo;
    items = (cat ? psSugerencias(cat, texto, elegidos) : []).slice(0, 100).map(function (n) { return { tipo: 'cat', nombre: n }; });
    if (texto.length >= PS_MIN_LEN) {
      var k = psNorm(texto);
      var yaEsta = elegidos.some(function (n) { return psNorm(n) === k; });
      if (!(cat && cat.por[k]) && !yaEsta) items.push({ tipo: 'libre', nombre: texto });
    }
  }

  function pintarLista() {
    if (!items.length) {
      lista.innerHTML = '<li class="vacio" role="option" aria-disabled="true">' +
        (_psCatalogo ? (textoEscrito() ? 'Sin coincidencias' : 'No hay más productos en el listado') : errorCatalogo ? 'Listado no disponible' : 'Cargando listado…') + '</li>';
      return;
    }
    lista.innerHTML = items.map(function (it, i) {
      return '<li role="option" id="' + id + '-op-' + i + '" data-i="' + i + '" class="' + (it.tipo === 'libre' ? 'libre ' : '') + (i === activo ? 'activo' : '') + '"' +
        ' aria-selected="' + (i === activo ? 'true' : 'false') + '">' +
        (it.tipo === 'libre'
          ? '➕ Agregar «' + escHtml(it.nombre) + '»' + (_psCatalogo ? ' <em>(no está en el listado)</em>' : '')
          : escHtml(it.nombre)) + '</li>';
    }).join('');
    if (activo >= 0) {
      input.setAttribute('aria-activedescendant', id + '-op-' + activo);
      var li = document.getElementById(id + '-op-' + activo);
      if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function abrir() {
    construirItems();
    // Con texto escrito, Enter toma la primera opción; sin texto no se resalta nada (Enter no agrega por accidente).
    activo = textoEscrito() && items.length ? 0 : -1;
    abierta = true;
    lista.style.display = '';
    input.setAttribute('aria-expanded', 'true');
    pintarLista();
  }

  // Agrega un producto: valida largo, repetidos y tope. Si coincide con un nombre del listado usa la grafía del listado.
  function agregar(nombre) {
    var n = psLimpiar(nombre);
    if (n.length < PS_MIN_LEN) { showToast('El nombre del producto debe tener al menos ' + PS_MIN_LEN + ' caracteres', '#e74c3c'); return false; }
    if (n.length > PS_MAX_LEN) { showToast('El nombre del producto no puede superar ' + PS_MAX_LEN + ' caracteres', '#e74c3c'); return false; }
    var k = psNorm(n);
    var canon = _psCatalogo && _psCatalogo.por[k];
    if (canon) n = canon;
    if (elegidos.some(function (x) { return psNorm(x) === k; })) {
      showToast('«' + n + '» ya está en la lista', '#e67e22');
      input.value = '';
      cerrar();
      return false;
    }
    if (elegidos.length >= PS_MAX) { showToast('Máximo ' + PS_MAX + ' productos por solicitud', '#e74c3c'); return false; }
    elegidos.push(n);
    input.value = '';
    cerrar();
    pintarChips();
    pintarHint();
    return true;
  }

  function agregarEscrito() {
    if (!textoEscrito()) { input.focus(); return; }
    if (agregar(textoEscrito())) input.focus();
  }

  function alEnfocar() {
    if (!_psCatalogo) {
      psCargarCatalogo().then(function () {
        errorCatalogo = false;
        pintarChips();
        pintarHint();
        if (abierta) abrir();
      }).catch(function () {
        errorCatalogo = true;
        pintarHint();
        if (abierta) abrir();
      });
    }
    abrir();
  }

  input.addEventListener('focus', alEnfocar);
  input.addEventListener('click', function () { if (!abierta) alEnfocar(); });
  input.addEventListener('input', abrir);
  input.addEventListener('blur', cerrar);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!abierta) { abrir(); return; }
      if (!items.length) return;
      activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      pintarLista();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!textoEscrito()) return;
      if (abierta && activo >= 0 && items[activo]) agregar(items[activo].nombre);
      else agregarEscrito();
    } else if (e.key === 'Escape') {
      if (abierta) { e.preventDefault(); cerrar(); }
    }
  });
  // mousedown (no click): se elige antes de que el cuadro pierda el foco.
  lista.addEventListener('mousedown', function (e) {
    e.preventDefault();
    var li = e.target.closest ? e.target.closest('li[data-i]') : null;
    if (li && items[Number(li.getAttribute('data-i'))]) agregar(items[Number(li.getAttribute('data-i'))].nombre);
  });
  btnAdd.addEventListener('click', agregarEscrito);
  chips.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-ps-quitar]') : null;
    if (!b) return;
    elegidos.splice(Number(b.getAttribute('data-ps-quitar')), 1);
    pintarChips();
    pintarHint();
  });

  pintarChips();
  pintarHint();
  // El listado se pide al crear el campo; si ya llegó, las etiquetas «no está en el listado» se recalculan.
  psCargarCatalogo().then(function () { errorCatalogo = false; pintarChips(); pintarHint(); }).catch(function () { errorCatalogo = true; pintarHint(); });

  return {
    valor: function () { return elegidos.slice(); },
    poner: function (arr) {
      elegidos = [];
      (Array.isArray(arr) ? arr : []).forEach(function (x) {
        var n = psLimpiar(x);
        if (n && elegidos.length < PS_MAX && !elegidos.some(function (y) { return psNorm(y) === psNorm(n); })) elegidos.push(n);
      });
      input.value = '';
      cerrar();
      pintarChips();
      pintarHint();
    },
    limpiar: function () { this.poner([]); },
    pendiente: function () { return textoEscrito(); }
  };
}
