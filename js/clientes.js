// ══════════════════════════════════════════════════════════════
// Clientes — módulo
// ══════════════════════════════════════════════════════════════

var clientesData = [];
var editingId = null;
var deleteId = null;
var importRows = [];
var PAGE_SIZE = 50;
var currentPage = 1;
var currentGroups = [];

function _normalizeId(id) {
  var s = (id || '').trim();
  s = s.replace(/[\s\-]\d$/, '');
  return s.replace(/[\s\-]+/g, '');
}

function _bestId(records) {
  var withDv = '', without = '';
  records.forEach(function(r) {
    var id = (r.Identificacion || '').trim();
    if (!id) return;
    if (!without) without = id;
    if (!withDv && /[\s\-]\d$/.test(id)) withDv = id;
  });
  return withDv || without;
}

// ── Normalización de identificación (NIT) ──
// Formatea "900946020 2" / "900.946.020-2" / "9009460202" -> "900946020-2".
// Reglas (alineadas con la función SQL nit_normalizado):
//   · El DV es el dígito final tras un separador (espacio, punto o guion),
//     o el 10.º dígito de un NIT de empresa (10 dígitos que empieza en 8/9).
//   · Es NIT si Tipo_Identificacion = 'NIT', o si el tipo está vacío y la
//     base tiene 9 dígitos y empieza en 8/9. Las cédulas no se tocan.
//   · Si no hay DV en el dato, NO se calcula: se muestra el número tal cual.

// Dígito de verificación del NIT — algoritmo oficial DIAN (módulo 11).
function _calcDvNit(base) {
  if (!/^\d{4,15}$/.test(base)) return null;
  var pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  var suma = 0;
  var d = base.split('').reverse();
  for (var i = 0; i < d.length; i++) suma += parseInt(d[i], 10) * pesos[i];
  var r = suma % 11;
  return r < 2 ? r : 11 - r;
}

// Devuelve { text, warn, expected } para un valor de identificación.
function _fmtIdent(raw, tipo) {
  var s = (raw == null ? '' : String(raw)).trim();
  if (!s) return { text: '', warn: false };

  var digitos = s.replace(/\D/g, '');
  if (!digitos) return { text: s, warn: false };

  // Parte con DV separado al final: "<algo> <sep> <1 dígito>".
  var sep = /^(.*)[\s.\-](\d)\s*$/.exec(s);
  var work = sep ? sep[1].replace(/\D/g, '') : digitos;
  var base, dv = null;
  if (work.length === 10 && /^[89]/.test(work)) {
    // NIT de empresa con el DV pegado: manda el 10.º dígito y se
    // descarta cualquier dígito extra tras el separador.
    base = work.slice(0, 9);
    dv = work.slice(9);
  } else if (sep) {
    base = work;
    dv = sep[2];
  } else {
    base = work;
  }

  var t = (tipo || '').trim().toUpperCase();
  var esNit = t === 'NIT' || (t === '' && base.length === 9 && /^[89]/.test(base));
  if (!esNit) return { text: s, warn: false };          // cédula u otro: sin tocar
  if (dv == null) return { text: base, warn: false };   // NIT sin DV: no se calcula

  var esperado = _calcDvNit(base);
  return { text: base + '-' + dv, warn: esperado != null && String(esperado) !== dv, expected: esperado };
}

// Celda de identificación ya escapada, con aviso si el DV no cuadra.
function _identCellHtml(raw, tipo) {
  var info = _fmtIdent(raw, tipo);
  if (!info.text) return '<span style="color:#cbd5e0">—</span>';
  var esc = escHtml(info.text);
  if (info.warn) {
    return '<span class="nit-dv-bad" title="DV esperado: ' + info.expected + '">' + esc + ' ⚠️</span>';
  }
  return esc;
}

// Tipo de identificación conocido del grupo (mismo NIT).
function _grupoTipoId(g) {
  var t = '';
  g.records.forEach(function(r) { if (!t && r.Tipo_Identificacion) t = r.Tipo_Identificacion; });
  return t;
}

// ── Normalización de teléfono (plan de numeración Colombia) ──
// Celular: 10 dígitos, empieza en 3          -> "3XX XXX XXXX"
// Fijo (desde 2022): 10 dígitos, empieza 60  -> "60X XXX XXXX"
// Fijo viejo de 7 dígitos: se deja tal cual (solo se limpian espacios).
// Se quitan el indicativo +57 / 57 / 0 de larga distancia.
// Lo que no encaja se muestra igual pero con aviso (warn:true).

function _fmtTelUno(s) {
  s = (s || '').trim();
  if (!s) return { text: '', warn: false };
  var d = s.replace(/\D/g, '');
  if (d.length === 12 && d.slice(0, 2) === '57') d = d.slice(2);
  else if (d.length === 13 && d.slice(0, 3) === '057') d = d.slice(3);
  else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);

  if (d.length === 10 && (d.charAt(0) === '3' || d.slice(0, 2) === '60')) {
    return { text: d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6), warn: false };
  }
  if (/^\d{7}$/.test(d) && /^[\d\s.\-]+$/.test(s)) {
    return { text: d, warn: false };            // fijo viejo: sin agrupar
  }
  return { text: s.replace(/\s+/g, ' '), warn: true };
}

// Devuelve { text, warn }. Soporta varios números en un mismo campo
// (separados por "/", ",", ";" o salto de línea); elimina repetidos.
function _fmtTelefono(raw) {
  var s = (raw == null ? '' : String(raw)).trim();
  if (!s || s === '0') return { text: '', warn: false };

  var partes = s.split(/\s*[\/,;]\s*|\s*[\r\n]+\s*/).map(function(x) { return x.trim(); }).filter(Boolean);
  if (partes.length <= 1) return _fmtTelUno(s);

  var vistos = {}, out = [], warn = false;
  partes.forEach(function(p) {
    var r = _fmtTelUno(p);
    if (r.warn) warn = true;
    if (r.text && !vistos[r.text]) { vistos[r.text] = true; out.push(r.text); }
  });
  return { text: out.join(' / '), warn: warn };
}

// Celda de teléfono ya escapada; '' si está vacío.
function _telCellHtml(raw) {
  var info = _fmtTelefono(raw);
  if (!info.text) return '';
  var esc = escHtml(info.text);
  return info.warn
    ? '<span class="tel-warn" title="No parece un teléfono colombiano">' + esc + ' ⚠️</span>'
    : esc;
}

// ── Estado del cliente ──
// Valores válidos: 'Activo' (por defecto), 'Inactivo', 'Bloqueado por cartera'.
var _EST_RANK = { 'Bloqueado por cartera': 0, 'Inactivo': 1, 'Activo': 2 };

function _estadoNorm(e) {
  e = (e || 'Activo').trim();
  return _EST_RANK[e] !== undefined ? e : 'Activo';
}

// Estado unificado de un grupo (mismo NIT). Si difieren, devuelve el más
// restrictivo y marca mixto:true.
function _grupoEstado(g) {
  var set = {};
  g.records.forEach(function(r) { set[_estadoNorm(r.Estado)] = true; });
  var keys = Object.keys(set);
  if (keys.length <= 1) return { estado: keys[0] || 'Activo', mixto: false };
  keys.sort(function(a, b) { return _EST_RANK[a] - _EST_RANK[b]; });
  return { estado: keys[0], mixto: true };
}

// Cliente dado de alta automáticamente desde un pedido manual y aún no
// revisado en este módulo. La marca se limpia al editar/guardar el cliente.
function _esNuevoRecord(r) {
  return r && (r.Cliente_Nuevo === true || r.Cliente_Nuevo === 'true' || r.Cliente_Nuevo === 't');
}

function _grupoEsNuevo(g) {
  return g.records.some(_esNuevoRecord);
}

function _estadoBadge(estado, mixto) {
  estado = _estadoNorm(estado);
  var cls = estado === 'Bloqueado por cartera' ? 'est-bloqueado'
          : estado === 'Inactivo' ? 'est-inactivo' : 'est-activo';
  var label = estado === 'Bloqueado por cartera' ? 'Bloq. cartera' : estado;
  var title = mixto ? ' title="Registros con estados distintos — se muestra el más restrictivo"' : '';
  return '<span class="est-badge ' + cls + (mixto ? ' est-mix' : '') + '"' + title + '>' + label + '</span>';
}

// Registros que comparten NIT con el cliente dado (el "cliente unificado").
function _nitSiblings(idNorm) {
  if (!idNorm) return [];
  return clientesData.filter(function(x) { return _normalizeId(x.Identificacion) === idNorm; });
}

function groupClientes(list) {
  var map = {};
  var order = [];
  list.forEach(function(c) {
    var idKey = _normalizeId(c.Identificacion);
    if (!idKey) {
      var soloKey = '__solo_' + c.id;
      map[soloKey] = { records: [c] };
      order.push(soloKey);
      return;
    }
    if (!map[idKey]) {
      map[idKey] = { records: [] };
      order.push(idKey);
    }
    map[idKey].records.push(c);
  });
  return order.map(function(k) { return map[k]; });
}

// ── Plazos de pago observados en Pedidos ──
// Índice: NIT normalizado / nombre normalizado -> conjunto de plazos (ya
// unificados). El cruce es por NIT y, si el cliente no aparece por NIT,
// se usa el nombre como respaldo.
var PLAZOS_POR_NIT = {};
var PLAZOS_POR_NOMBRE = {};
var PLAZOS_LISTA = [];

// ── Clientes que aparecen en Pedidos ──
// Conjuntos de NIT normalizado / nombre normalizado presentes en el módulo
// de Pedidos (con o sin plazo de pago). Sirve para la columna "¿Tiene
// pedidos?" y su filtro.
var PEDIDOS_POR_NIT = {};
var PEDIDOS_POR_NOMBRE = {};

function _normNombre(n) {
  return (n == null ? '' : String(n)).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Unifica variantes: "90", "90 días", "90 DIAS", "90 dias" -> "90 días";
// "Contado" / "CONTADO" -> "Contado".
function _normalizePlazo(raw) {
  var s = (raw == null ? '' : String(raw)).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  var low = s.toLowerCase();
  if (low.indexOf('contado') >= 0) return 'Contado';
  var m = low.match(/(\d+)\s*(?:d[ií]as?)?/);
  if (m) return m[1] + ' días';
  return s;
}

function _plazoOrden(p) {
  var s = String(p).toLowerCase();
  if (s.indexOf('contado') >= 0) return 0;
  var m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 9999;
}

function _cmpPlazo(a, b) {
  var oa = _plazoOrden(a), ob = _plazoOrden(b);
  if (oa !== ob) return oa - ob;
  return String(a).localeCompare(String(b));
}

function _indexPlazosPedidos(pedidos) {
  PLAZOS_POR_NIT = {};
  PLAZOS_POR_NOMBRE = {};
  PEDIDOS_POR_NIT = {};
  PEDIDOS_POR_NOMBRE = {};
  var todos = {};
  (pedidos || []).forEach(function(p) {
    var nk = _normalizeId(p.NIT);
    var nombre = _normNombre(p.Cliente);
    if (nk) PEDIDOS_POR_NIT[nk] = true;
    if (nombre) PEDIDOS_POR_NOMBRE[nombre] = true;

    var lbl = _normalizePlazo(p.Plazo_Pago);
    if (!lbl) return;
    todos[lbl] = true;
    if (nk) {
      if (!PLAZOS_POR_NIT[nk]) PLAZOS_POR_NIT[nk] = {};
      PLAZOS_POR_NIT[nk][lbl] = true;
    }
    if (nombre) {
      if (!PLAZOS_POR_NOMBRE[nombre]) PLAZOS_POR_NOMBRE[nombre] = {};
      PLAZOS_POR_NOMBRE[nombre][lbl] = true;
    }
  });
  PLAZOS_LISTA = Object.keys(todos).sort(_cmpPlazo);
}

// Plazos de un registro de cliente: primero por NIT; si ese NIT no aparece
// en pedidos, se intenta por nombre.
function _plazosParaRecord(c) {
  var nk = _normalizeId(c.Identificacion);
  if (nk && PLAZOS_POR_NIT[nk]) return Object.keys(PLAZOS_POR_NIT[nk]).sort(_cmpPlazo);
  var nombre = _normNombre(c.Cliente);
  if (nombre && PLAZOS_POR_NOMBRE[nombre]) return Object.keys(PLAZOS_POR_NOMBRE[nombre]).sort(_cmpPlazo);
  return [];
}

function _plazosDeGrupo(g) {
  var set = {};
  g.records.forEach(function(r) {
    _plazosParaRecord(r).forEach(function(k) { set[k] = true; });
  });
  return Object.keys(set).sort(_cmpPlazo);
}

// ¿Este registro de cliente aparece en algún pedido? Cruce por NIT y, si
// ese NIT no está en pedidos, por nombre (mismo criterio que los plazos).
function _tienePedidosRecord(c) {
  var nk = _normalizeId(c.Identificacion);
  if (nk && PEDIDOS_POR_NIT[nk]) return true;
  var nombre = _normNombre(c.Cliente);
  if (nombre && PEDIDOS_POR_NOMBRE[nombre]) return true;
  return false;
}

function _grupoTienePedidos(g) {
  return g.records.some(_tienePedidosRecord);
}

function _pedidosBadge(tiene) {
  return tiene
    ? '<span class="est-badge ped-si">Sí</span>'
    : '<span class="est-badge ped-no">No</span>';
}

function _plazosChips(list) {
  if (!list.length) return '<span style="color:#cbd5e0">—</span>';
  return list.map(function(p) {
    return '<span class="plazo-chip">' + escHtml(p) + '</span>';
  }).join('');
}

// ── Load ──
async function loadClientes() {
  document.getElementById('load-zone').style.display = '';
  document.getElementById('main').style.display = 'none';
  try {
    await _authReady;
    var _r = await Promise.all([
      apiGet('getClientesAll'),
      apiGet('getPedidos', { columns: 'Nombre_Empresa,Cliente,NIT,Plazo_Pago' })
        .catch(function() { return { ok: false, pedidos: [] }; })
    ]);
    var res = _r[0];
    var pedRes = _r[1];
    if (!res.ok) throw new Error(res.error || 'Error al cargar');
    clientesData = res.clientes || [];
    _indexPlazosPedidos(pedRes && pedRes.ok ? pedRes.pedidos : []);
    document.getElementById('load-zone').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    populateFilters();
    renderTable();
    setSyncStatus('ok', 'Conectado a la nube. Los cambios se guardan automáticamente.');
  } catch (err) {
    document.getElementById('load-error').textContent = err.message;
    document.getElementById('btn-retry').style.display = '';
    setSyncStatus('error', 'Error al conectar');
  }
}

// ── Filters ──
function populateFilters() {
  var empresas = {}, deptos = {}, munis = {};
  clientesData.forEach(function(c) {
    if (c.Nombre_Empresa) empresas[c.Nombre_Empresa] = true;
    if (c.Departamento) deptos[c.Departamento] = true;
    if (c.Municipio) munis[c.Municipio] = true;
  });

  var selEmp = document.getElementById('f-emp');
  var curEmp = selEmp.value;
  selEmp.innerHTML = '<option value="">Todas</option>';
  Object.keys(empresas).sort().forEach(function(e) {
    selEmp.innerHTML += '<option value="' + escHtml(e) + '">' + escHtml(getSigla(e)) + '</option>';
  });
  selEmp.value = curEmp;

  var selDepto = document.getElementById('f-depto');
  var curDepto = selDepto.value;
  selDepto.innerHTML = '<option value="">Todos</option>';
  Object.keys(deptos).sort().forEach(function(d) {
    selDepto.innerHTML += '<option value="' + escHtml(d) + '">' + escHtml(d) + '</option>';
  });
  selDepto.value = curDepto;

  var selPlazo = document.getElementById('f-plazo');
  var curPlazo = selPlazo.value;
  selPlazo.innerHTML = '<option value="">Todos</option>';
  PLAZOS_LISTA.forEach(function(p) {
    selPlazo.innerHTML += '<option value="' + escHtml(p) + '">' + escHtml(p) + '</option>';
  });
  selPlazo.value = PLAZOS_LISTA.indexOf(curPlazo) >= 0 ? curPlazo : '';

  _updateMuniFilter();
}

function _updateMuniFilter() {
  var depto = document.getElementById('f-depto').value;
  var munis = {};
  clientesData.forEach(function(c) {
    if (depto && c.Departamento !== depto) return;
    if (c.Municipio) munis[c.Municipio] = true;
  });
  var selMuni = document.getElementById('f-muni');
  var curMuni = selMuni.value;
  selMuni.innerHTML = '<option value="">Todos</option>';
  Object.keys(munis).sort().forEach(function(m) {
    selMuni.innerHTML += '<option value="' + escHtml(m) + '">' + escHtml(m) + '</option>';
  });
  selMuni.value = munis[curMuni] ? curMuni : '';
}

function getFiltered() {
  var emp = document.getElementById('f-emp').value;
  var depto = document.getElementById('f-depto').value;
  var muni = document.getElementById('f-muni').value;
  var est = document.getElementById('f-estado').value;
  var plazo = document.getElementById('f-plazo').value;
  var fped = document.getElementById('f-ped').value;
  var txt = (document.getElementById('f-txt').value || '').toLowerCase().trim();
  return clientesData.filter(function(c) {
    if (emp && c.Nombre_Empresa !== emp) return false;
    if (depto && c.Departamento !== depto) return false;
    if (muni && c.Municipio !== muni) return false;
    if (est && _estadoNorm(c.Estado) !== est) return false;
    if (plazo && _plazosParaRecord(c).indexOf(plazo) < 0) return false;
    if (fped === 'con' && !_tienePedidosRecord(c)) return false;
    if (fped === 'sin' && _tienePedidosRecord(c)) return false;
    if (txt) {
      var haystack = [c.Cliente, c.Identificacion, c.Correo_Electronico, c.Telefono, c.Municipio, c.Departamento]
        .join(' ').toLowerCase();
      if (haystack.indexOf(txt) < 0) return false;
    }
    return true;
  });
}

function clearFilters() {
  document.getElementById('f-emp').value = '';
  document.getElementById('f-depto').value = '';
  document.getElementById('f-muni').value = '';
  document.getElementById('f-estado').value = '';
  document.getElementById('f-plazo').value = '';
  document.getElementById('f-ped').value = '';
  document.getElementById('f-nuevo').value = '';
  document.getElementById('f-txt').value = '';
  _updateMuniFilter();
  currentPage = 1;
  renderTable();
}

// ── Render table ──
function renderTable() {
  var allGrps = groupClientes(clientesData);

  var emp = document.getElementById('f-emp').value;
  var depto = document.getElementById('f-depto').value;
  var muni = document.getElementById('f-muni').value;
  var est = document.getElementById('f-estado').value;
  var plazo = document.getElementById('f-plazo').value;
  var txt = (document.getElementById('f-txt').value || '').toLowerCase().trim();

  var filtered = allGrps.filter(function(g) {
    if (!emp && !depto && !muni && !est && !txt) return true;
    return g.records.some(function(c) {
      if (emp && c.Nombre_Empresa !== emp) return false;
      if (depto && c.Departamento !== depto) return false;
      if (muni && c.Municipio !== muni) return false;
      if (est && _estadoNorm(c.Estado) !== est) return false;
      if (txt) {
        var haystack = [c.Cliente, c.Identificacion, c.Correo_Electronico, c.Telefono, c.Municipio, c.Departamento]
          .join(' ').toLowerCase();
        if (haystack.indexOf(txt) < 0) return false;
      }
      return true;
    });
  });
  if (plazo) {
    filtered = filtered.filter(function(g) { return _plazosDeGrupo(g).indexOf(plazo) >= 0; });
  }
  if (document.getElementById('f-nuevo').value === '1') {
    filtered = filtered.filter(_grupoEsNuevo);
  }
  var fPed = document.getElementById('f-ped').value;
  if (fPed === 'con') {
    filtered = filtered.filter(_grupoTienePedidos);
  } else if (fPed === 'sin') {
    filtered = filtered.filter(function(g) { return !_grupoTienePedidos(g); });
  }
  currentGroups = filtered;

  var empSet = {}, deptoSet = {};
  clientesData.forEach(function(c) {
    if (c.Nombre_Empresa) empSet[c.Nombre_Empresa] = true;
    if (c.Departamento) deptoSet[c.Departamento] = true;
  });
  document.getElementById('s-total').textContent = allGrps.length;
  document.getElementById('s-empresas').textContent = Object.keys(empSet).length;
  document.getElementById('s-deptos').textContent = Object.keys(deptoSet).length;

  var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  var start = (currentPage - 1) * PAGE_SIZE;
  var pageGroups = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('row-ct').textContent = '(' + filtered.length + ' clientes)';

  var canEd = (typeof AUTH !== 'undefined' && AUTH.canEdit) ? AUTH.canEdit() : true;
  var canDel = (typeof AUTH !== 'undefined' && AUTH.canDelete) ? AUTH.canDelete() : false;
  var tbody = document.getElementById('t-body');

  tbody.innerHTML = pageGroups.map(function(g, i) {
    var first = g.records[0];
    var isMulti = g.records.length > 1;
    var globalIdx = start + i;

    var empresas = [];
    var empresasSeen = {};
    g.records.forEach(function(r) {
      var e = (r.Nombre_Empresa || '').trim();
      var sig = getSigla(e);
      if (e && !empresasSeen[sig]) { empresasSeen[sig] = true; empresas.push(e); }
    });
    var empresaHtml = empresas.map(function(e) {
      return '<span class="sigla-tag ' + getSiglaClass(e) + '">' + escHtml(getSigla(e)) + '</span>';
    }).join(' ');

    var munis = [];
    var munisSeen = {};
    g.records.forEach(function(r) {
      var m = (r.Municipio || '').trim();
      if (m && !munisSeen[m]) { munisSeen[m] = true; munis.push(m); }
    });
    var muniHtml = '';
    if (munis.length === 1) {
      muniHtml = escHtml(munis[0]);
    } else if (munis.length === 2) {
      muniHtml = munis.map(escHtml).join(', ');
    } else if (munis.length > 2) {
      muniHtml = escHtml(munis[0]) + ' <span style="color:#718096;font-size:0.74rem">+' + (munis.length - 1) + ' sedes</span>';
    }

    var tel = '', correo = '';
    g.records.forEach(function(r) {
      if (!tel && r.Telefono && r.Telefono !== '0') tel = r.Telefono;
      if (!correo && r.Correo_Electronico) correo = r.Correo_Electronico;
    });

    var multiTag = isMulti
      ? ' <span style="background:#edf2f7;color:#4a5568;font-size:0.68rem;padding:1px 6px;border-radius:10px;font-weight:600">' + g.records.length + ' reg.</span>'
      : '';

    var ge = _grupoEstado(g);
    var plazosHtml = _plazosChips(_plazosDeGrupo(g));
    var pedidosHtml = _pedidosBadge(_grupoTienePedidos(g));

    var actionHtml = '';
    if (canEd) {
      actionHtml = '<td style="text-align:center;white-space:nowrap">' +
        '<button onclick="openGroupDetail(' + globalIdx + ')" style="background:#2c3e50;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:3px" title="Ver detalle">👁️</button>';
      if (!isMulti) {
        actionHtml += '<button onclick="openEditCliente(' + first.id + ')" style="background:#1a5276;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:3px" title="Editar">✏️</button>';
        if (canDel) {
          actionHtml += '<button onclick="openDeleteCliente(' + first.id + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600" title="Eliminar">🗑️</button>';
        }
      }
      actionHtml += '</td>';
    }

    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (globalIdx + 1) + '</td>' +
      '<td>' + empresaHtml + '</td>' +
      '<td style="font-weight:600">' + escHtml(first.Cliente || '') + multiTag + '</td>' +
      '<td>' + (_grupoEsNuevo(g) ? '<span class="nuevo-badge">🆕 Nuevo</span>' : '<span style="color:#cbd5e0">—</span>') + '</td>' +
      '<td>' + _identCellHtml(_bestId(g.records), _grupoTipoId(g)) + '</td>' +
      '<td>' + escHtml(first.Tipo_Identificacion || '') + '</td>' +
      '<td>' + _telCellHtml(tel) + '</td>' +
      '<td>' + muniHtml + '</td>' +
      '<td style="font-size:0.78rem">' + escHtml(correo) + '</td>' +
      '<td>' + _estadoBadge(ge.estado, ge.mixto) + '</td>' +
      '<td style="text-align:center">' + pedidosHtml + '</td>' +
      '<td>' + plazosHtml + '</td>' +
      actionHtml +
      '</tr>';
  }).join('');

  var pagEl = document.getElementById('pagination');
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
  var html = '';
  if (currentPage > 1) html += '<button onclick="goPage(' + (currentPage - 1) + ')">← Anterior</button>';
  html += '<span style="font-size:0.82rem;color:#4a5568;padding:0 8px">Página ' + currentPage + ' de ' + totalPages + '</span>';
  if (currentPage < totalPages) html += '<button onclick="goPage(' + (currentPage + 1) + ')">Siguiente →</button>';
  pagEl.innerHTML = html;
}

function goPage(n) { currentPage = n; renderTable(); window.scrollTo(0, 0); }

// ── Filter listeners ──
document.getElementById('f-emp').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-depto').addEventListener('change', function() { _updateMuniFilter(); currentPage = 1; renderTable(); });
document.getElementById('f-muni').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-estado').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-plazo').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-ped').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-nuevo').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-txt').addEventListener('input', debounce(function() { currentPage = 1; renderTable(); }, 300));

// ── Detail modal ──
function openGroupDetail(groupIdx) {
  var g = currentGroups[groupIdx];
  if (!g) return;
  var first = g.records[0];
  var isMulti = g.records.length > 1;

  document.getElementById('det-titulo').textContent = '👤 ' + (first.Cliente || 'Cliente');

  var tel = '', correo = '', tipoId = '';
  g.records.forEach(function(r) {
    if (!tel && r.Telefono && r.Telefono !== '0') tel = r.Telefono;
    if (!correo && r.Correo_Electronico) correo = r.Correo_Electronico;
    if (!tipoId && r.Tipo_Identificacion) tipoId = r.Tipo_Identificacion;
  });

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;margin-bottom:' + (isMulti ? '20' : '0') + 'px">';
  var commonFields = [
    ['Cliente', first.Cliente],
    ['Identificación', _identCellHtml(_bestId(g.records), tipoId), true],
    ['Tipo ID', tipoId],
    ['Teléfono', _telCellHtml(tel) || '—', true],
    ['Correo', correo]
  ];
  commonFields.forEach(function(f) {
    html += '<div>' +
      '<div style="font-size:0.72rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-bottom:2px">' + f[0] + '</div>' +
      '<div style="font-size:0.88rem;color:#2d3748;font-weight:500">' + (f[2] ? f[1] : escHtml(f[1] || '—')) + '</div>' +
      '</div>';
  });
  html += '</div>';

  var _geDet = _grupoEstado(g);
  html += '<div style="margin-bottom:' + (isMulti ? '16' : '4') + 'px">' +
    '<span style="font-size:0.72rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-right:8px">Estado</span>' +
    _estadoBadge(_geDet.estado, _geDet.mixto) +
    (_grupoEsNuevo(g) ? ' <span class="nuevo-badge">🆕 Nuevo</span> <span style="color:#a0aec0;font-size:0.78rem">— alta desde un pedido, pendiente de completar</span>' : '') +
    '</div>';

  html += '<div style="margin-bottom:' + (isMulti ? '16' : '10') + 'px">' +
    '<span style="font-size:0.72rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-right:8px">¿Tiene pedidos?</span>' +
    _pedidosBadge(_grupoTienePedidos(g)) +
    '</div>';

  var _plzDet = _plazosDeGrupo(g);
  html += '<div style="margin-bottom:' + (isMulti ? '16' : '10') + 'px">' +
    '<span style="font-size:0.72rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-right:8px">Plazos de pago (pedidos)</span>' +
    (_plzDet.length ? _plzDet.map(function(p) { return '<span class="plazo-chip">' + escHtml(p) + '</span>'; }).join('')
                    : '<span style="color:#a0aec0;font-size:0.85rem">Sin pedidos registrados</span>') +
    '</div>';

  if (isMulti) {
    var canEd = (typeof AUTH !== 'undefined' && AUTH.canEdit) ? AUTH.canEdit() : true;
    var canDel = (typeof AUTH !== 'undefined' && AUTH.canDelete) ? AUTH.canDelete() : false;

    html += '<div style="border-top:1px solid #e2e8f0;padding-top:16px">';
    html += '<div style="font-size:0.84rem;font-weight:700;color:#2d3748;margin-bottom:12px">📍 Empresas y sedes (' + g.records.length + ' registros)</div>';

    g.records.forEach(function(r) {
      html += '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:10px">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
      html += '<span class="sigla-tag ' + getSiglaClass(r.Nombre_Empresa) + '">' + escHtml(getSigla(r.Nombre_Empresa)) + '</span>';
      var loc = [r.Municipio, r.Departamento].filter(function(x) { return x; }).join(', ');
      html += '<span style="font-weight:600;font-size:0.85rem;color:#2d3748">' + escHtml(loc || '—') + '</span>';
      if (canEd) {
        html += '<div style="margin-left:auto;display:flex;gap:4px">';
        html += '<button onclick="closeDetail();openEditCliente(' + r.id + ')" style="background:#1a5276;color:white;border:none;padding:3px 9px;border-radius:5px;cursor:pointer;font-size:0.72rem;font-weight:600" title="Editar">✏️</button>';
        if (canDel) {
          html += '<button onclick="closeDetail();openDeleteCliente(' + r.id + ')" style="background:#e74c3c;color:white;border:none;padding:3px 9px;border-radius:5px;cursor:pointer;font-size:0.72rem;font-weight:600" title="Eliminar">🗑️</button>';
        }
        html += '</div>';
      }
      html += '</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:0.8rem">';
      var sedeFields = [
        ['Dirección', r.Direccion],
        ['Dir. Envío', r.Direccion_Envio],
        ['Cupo Crédito', r.Cupo_Credito],
        ['Plazo Pago', r.Plazo_Pago],
        ['Lista Precio', r.Lista_Precio],
        ['Teléfono', _telCellHtml(r.Telefono) || '—', true]
      ];
      sedeFields.forEach(function(f) {
        html += '<div><span style="color:#a0aec0;font-size:0.72rem;font-weight:600">' + f[0] + ':</span> ' + (f[2] ? f[1] : escHtml(f[1] || '—')) + '</div>';
      });
      html += '</div>' + _auditoriaHtml(r, true) + '</div>';
    });
    html += '</div>';
  } else {
    var c = first;
    var singleFields = [
      ['Empresa', getSigla(c.Nombre_Empresa)],
      ['Dirección', c.Direccion],
      ['Dirección Envío', c.Direccion_Envio],
      ['Departamento', c.Departamento],
      ['Municipio', c.Municipio],
      ['Cupo Crédito', c.Cupo_Credito],
      ['Plazo Pago', c.Plazo_Pago],
      ['Lista Precio', c.Lista_Precio]
    ];
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 20px">';
    singleFields.forEach(function(f) {
      html += '<div>' +
        '<div style="font-size:0.72rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-bottom:2px">' + f[0] + '</div>' +
        '<div style="font-size:0.88rem;color:#2d3748;font-weight:500">' + escHtml(f[1] || '—') + '</div>' +
        '</div>';
    });
    html += '</div>';
    html += _auditoriaHtml(first, false);
  }

  document.getElementById('det-body').innerHTML = html;
  document.getElementById('detail-overlay').style.display = 'flex';
}

function openDetail(id) {
  var idx = -1;
  currentGroups.some(function(g, i) {
    return g.records.some(function(r) { if (r.id === id) { idx = i; return true; } });
  });
  if (idx >= 0) openGroupDetail(idx);
}

function closeDetail() {
  document.getElementById('detail-overlay').style.display = 'none';
}

// ── Departamento/Municipio cascading selects ──
function _populateDeptos(selectId) {
  var sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">— Seleccionar —</option>';
  if (typeof COLOMBIA_DEPTOS_MUNIS !== 'undefined') {
    Object.keys(COLOMBIA_DEPTOS_MUNIS).sort().forEach(function(d) {
      sel.innerHTML += '<option value="' + escHtml(d) + '">' + escHtml(d) + '</option>';
    });
  }
}

function _populateMunis(deptoSelectId, muniSelectId) {
  var depto = document.getElementById(deptoSelectId).value;
  var sel = document.getElementById(muniSelectId);
  sel.innerHTML = '<option value="">— Seleccionar —</option>';
  if (depto && typeof COLOMBIA_DEPTOS_MUNIS !== 'undefined' && COLOMBIA_DEPTOS_MUNIS[depto]) {
    COLOMBIA_DEPTOS_MUNIS[depto].forEach(function(m) {
      sel.innerHTML += '<option value="' + escHtml(m) + '">' + escHtml(m) + '</option>';
    });
  }
}

document.getElementById('ed-departamento').addEventListener('change', function() {
  _populateMunis('ed-departamento', 'ed-municipio');
});

// ── Add / Edit modal ──
function _populateEdEmpresa(selectId) {
  var sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">— Seleccionar —</option>';
  EMPRESAS_HOLDING.forEach(function(e) {
    sel.innerHTML += '<option value="' + e.value + '">' + e.sigla + '</option>';
  });
}

function _clearForm() {
  document.getElementById('ed-empresa').value = '';
  document.getElementById('ed-cliente').value = '';
  document.getElementById('ed-tipo-id').value = '';
  document.getElementById('ed-identificacion').value = '';
  document.getElementById('ed-telefono').value = '';
  document.getElementById('ed-correo').value = '';
  document.getElementById('ed-direccion').value = '';
  document.getElementById('ed-direccion-envio').value = '';
  document.getElementById('ed-departamento').value = '';
  _populateMunis('ed-departamento', 'ed-municipio');
  document.getElementById('ed-municipio').value = '';
  document.getElementById('ed-cupo').value = '';
  document.getElementById('ed-plazo').value = '';
  document.getElementById('ed-lista-precio').value = '';
  document.getElementById('ed-estado').value = 'Activo';
  document.getElementById('ed-estado-hint').textContent = '';
}

function openNuevoCliente() {
  editingId = null;
  document.getElementById('ed-titulo').textContent = '➕ Agregar Cliente';
  _populateEdEmpresa('ed-empresa');
  _populateDeptos('ed-departamento');
  _clearForm();
  document.getElementById('edit-overlay').style.display = 'flex';
}

function openEditCliente(id) {
  var c = clientesData.find(function(x) { return x.id === id; });
  if (!c) return;
  editingId = id;
  document.getElementById('ed-titulo').textContent = '✏️ Editar Cliente';
  _populateEdEmpresa('ed-empresa');
  _populateDeptos('ed-departamento');
  document.getElementById('ed-empresa').value = c.Nombre_Empresa || '';
  document.getElementById('ed-cliente').value = c.Cliente || '';
  document.getElementById('ed-tipo-id').value = c.Tipo_Identificacion || '';
  document.getElementById('ed-identificacion').value = c.Identificacion || '';
  document.getElementById('ed-telefono').value = c.Telefono || '';
  document.getElementById('ed-correo').value = c.Correo_Electronico || '';
  document.getElementById('ed-direccion').value = c.Direccion || '';
  document.getElementById('ed-direccion-envio').value = c.Direccion_Envio || '';
  document.getElementById('ed-departamento').value = c.Departamento || '';
  _populateMunis('ed-departamento', 'ed-municipio');
  document.getElementById('ed-municipio').value = c.Municipio || '';
  document.getElementById('ed-cupo').value = c.Cupo_Credito || '';
  document.getElementById('ed-plazo').value = c.Plazo_Pago || '';
  document.getElementById('ed-lista-precio').value = c.Lista_Precio || '';
  document.getElementById('ed-estado').value = _estadoNorm(c.Estado);
  var _sibs = _nitSiblings(_normalizeId(c.Identificacion));
  document.getElementById('ed-estado-hint').textContent = _sibs.length > 1
    ? 'El estado se aplica a los ' + _sibs.length + ' registros de este NIT.'
    : '';
  document.getElementById('edit-overlay').style.display = 'flex';
}

function closeEdit() {
  document.getElementById('edit-overlay').style.display = 'none';
  editingId = null;
}

async function saveEdit() {
  var empresa = document.getElementById('ed-empresa').value;
  var cliente = document.getElementById('ed-cliente').value.trim();
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!cliente) { showToast('Ingresa el nombre del cliente', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  var payload = {
    Nombre_Empresa: empresa,
    Cliente: cliente,
    Tipo_Identificacion: document.getElementById('ed-tipo-id').value,
    Identificacion: document.getElementById('ed-identificacion').value.trim(),
    Telefono: document.getElementById('ed-telefono').value.trim(),
    Correo_Electronico: document.getElementById('ed-correo').value.trim(),
    Direccion: document.getElementById('ed-direccion').value.trim(),
    Direccion_Envio: document.getElementById('ed-direccion-envio').value.trim(),
    Departamento: document.getElementById('ed-departamento').value,
    Municipio: document.getElementById('ed-municipio').value,
    Cupo_Credito: document.getElementById('ed-cupo').value.trim(),
    Plazo_Pago: document.getElementById('ed-plazo').value.trim(),
    Lista_Precio: document.getElementById('ed-lista-precio').value,
    Estado: _estadoNorm(document.getElementById('ed-estado').value)
  };

  var _geoCl = normalizarMunicipio(payload.Municipio, payload.Departamento);
  payload.Municipio = _geoCl.municipio;
  payload.Departamento = _geoCl.departamento || normalizarDepartamento(payload.Departamento);

  try {
    var result;
    if (editingId) {
      payload.action = 'editarClienteUnico';
      payload.row = editingId;
      result = await apiPost(payload);
    } else {
      payload.action = 'agregarClienteUnico';
      result = await apiPost(payload);
    }
    if (!result.ok) throw new Error(result.error || 'Error al guardar');

    // Estado unificado por NIT: aplica el mismo estado a los demás
    // registros del mismo NIT (varias empresas/sedes del cliente).
    var _nk = _normalizeId(payload.Identificacion);
    if (_nk) {
      var _sibIds = clientesData
        .filter(function(x) { return x.id !== editingId && _normalizeId(x.Identificacion) === _nk; })
        .map(function(x) { return x.id; });
      if (_sibIds.length) {
        await apiPost({ action: 'setEstadoClientes', ids: _sibIds, estado: payload.Estado });
      }
    }

    closeEdit();
    showToast('✅ Cliente guardado correctamente');
    await loadClientes();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Guardar';
  }
}

// ── Delete ──
function openDeleteCliente(id) {
  var c = clientesData.find(function(x) { return x.id === id; });
  if (!c) return;
  deleteId = id;
  document.getElementById('del-msg').textContent = '¿Eliminar este cliente?';
  var idFmt = _fmtIdent(c.Identificacion, c.Tipo_Identificacion).text || '—';
  var detail = getSigla(c.Nombre_Empresa) + ' · ' + (c.Cliente || '') + ' · ' + idFmt;
  document.getElementById('del-detail').textContent = detail;
  document.getElementById('delete-overlay').style.display = 'flex';
}

function closeDelete() {
  document.getElementById('delete-overlay').style.display = 'none';
  deleteId = null;
}

async function confirmDelete() {
  if (!deleteId) return;
  var btn = document.getElementById('btn-del-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarClienteUnico', row: deleteId });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDelete();
    showToast('✅ Cliente eliminado');
    await loadClientes();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
  } finally {
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Import Excel ──
function handleImportExcel(input) {
  var file = input.files[0];
  if (!file) return;
  input.value = '';
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(e.target.result, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      parseImportRows(rows, file.name);
    } catch (err) {
      showToast('❌ Error leyendo el archivo: ' + err.message, '#e74c3c');
    }
  };
  reader.readAsArrayBuffer(file);
}

var COL_MAP = {
  'cliente': 'cliente', 'razon social': 'cliente', 'razon_social': 'cliente', 'nombre': 'cliente', 'nombre cliente': 'cliente',
  'identificacion': 'nit', 'nit': 'nit', 'cc': 'nit', 'cedula': 'nit', 'documento': 'nit',
  'tipo_identificacion': 'tipo_identificacion', 'tipo identificacion': 'tipo_identificacion', 'tipo id': 'tipo_identificacion', 'tipo': 'tipo_identificacion',
  'telefono': 'telefono', 'celular': 'telefono', 'tel': 'telefono', 'movil': 'telefono',
  'direccion': 'direccion', 'dirección': 'direccion',
  'direccion_envio': 'direccion_envio', 'direccion envio': 'direccion_envio', 'dirección envío': 'direccion_envio', 'dir envio': 'direccion_envio',
  'municipio': 'municipio', 'ciudad': 'municipio',
  'departamento': 'departamento', 'depto': 'departamento',
  'correo': 'correo', 'correo_electronico': 'correo', 'correo electronico': 'correo', 'email': 'correo', 'e-mail': 'correo',
  'cupo_credito': 'cupo_credito', 'cupo credito': 'cupo_credito', 'cupo': 'cupo_credito',
  'plazo_pago': 'plazo_pago', 'plazo pago': 'plazo_pago', 'plazo': 'plazo_pago',
  'lista_precio': 'lista_precio', 'lista precio': 'lista_precio', 'lista': 'lista_precio'
};

function parseImportRows(rows, fileName) {
  if (!rows.length) { showToast('El archivo está vacío', '#e74c3c'); return; }
  var headers = Object.keys(rows[0]);
  var colMapping = {};
  headers.forEach(function(h) {
    var key = h.toLowerCase().trim().replace(/[_\s]+/g, ' ');
    for (var alias in COL_MAP) {
      if (key === alias || key.indexOf(alias) >= 0) {
        colMapping[h] = COL_MAP[alias];
        break;
      }
    }
  });

  importRows = [];
  rows.forEach(function(row) {
    var mapped = {};
    headers.forEach(function(h) {
      if (colMapping[h]) mapped[colMapping[h]] = String(row[h] || '').trim();
    });
    if (!mapped.cliente) return;
    importRows.push(mapped);
  });

  if (!importRows.length) {
    showToast('No se encontraron clientes válidos. Verifique que haya una columna "Cliente".', '#e74c3c');
    return;
  }

  _populateEdEmpresa('imp-empresa');
  document.getElementById('imp-archivo').textContent = fileName;
  document.getElementById('imp-summary').textContent = importRows.length + ' clientes encontrados en el archivo';
  document.getElementById('imp-lines').innerHTML = importRows.map(function(r, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td>' + escHtml(r.cliente || '') + '</td>' +
      '<td>' + escHtml(r.nit || '') + '</td>' +
      '<td>' + escHtml(r.telefono || '') + '</td>' +
      '<td>' + escHtml(r.municipio || '') + '</td>' +
      '<td>' + escHtml(r.correo || '') + '</td>' +
      '</tr>';
  }).join('');
  document.getElementById('import-overlay').style.display = 'flex';
}

function closeImport() {
  document.getElementById('import-overlay').style.display = 'none';
  importRows = [];
}

async function confirmImport() {
  var empresa = document.getElementById('imp-empresa').value;
  var reemplazar = document.getElementById('imp-reemplazar').checked;
  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!importRows.length) { showToast('No hay clientes para importar', '#e74c3c'); return; }

  var btn = document.getElementById('btn-import');
  btn.disabled = true;
  btn.textContent = '⏳ Importando...';

  try {
    if (reemplazar) {
      await apiPost({ action: 'deleteClientesPorEmpresa', empresas: [empresa] });
    }

    var sigla = getSigla(empresa);
    var items = importRows.map(function(r) {
      return {
        cliente: r.cliente || '',
        nit: r.nit || '',
        tipo_identificacion: r.tipo_identificacion || '',
        telefono: r.telefono || '',
        direccion: r.direccion || '',
        direccion_envio: r.direccion_envio || '',
        municipio: r.municipio || '',
        departamento: r.departamento || '',
        empresa: empresa,
        correo: r.correo || '',
        cupo_credito: r.cupo_credito || '',
        plazo_pago: r.plazo_pago || '',
        lista_precio: r.lista_precio || ''
      };
    });

    var chunkSize = 200;
    var total = 0;
    for (var i = 0; i < items.length; i += chunkSize) {
      var chunk = items.slice(i, i + chunkSize);
      var result = await apiPost({ action: 'upsertClientesUnicos', items: chunk });
      if (!result.ok) throw new Error(result.error || 'Error en la importación');
      total += chunk.length;
    }

    closeImport();
    showToast('✅ ' + total + ' clientes importados correctamente');
    await loadClientes();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Importar';
  }
}

// ── Export Excel ──
function exportExcel() {
  var filtered = getFiltered();
  if (!filtered.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var rows = [['Empresa', 'Cliente', 'Nuevo', 'Tipo ID', 'Identificación', 'Teléfono', 'Correo', 'Dirección', 'Dirección Envío', 'Departamento', 'Municipio', 'Cupo Crédito', 'Plazo Pago', 'Plazos Pago (pedidos)', 'Tiene pedidos', 'Lista Precio', 'Estado']];
  filtered.forEach(function(c) {
    rows.push([
      getSigla(c.Nombre_Empresa),
      c.Cliente || '',
      _esNuevoRecord(c) ? 'Sí' : '',
      c.Tipo_Identificacion || '',
      _fmtIdent(c.Identificacion, c.Tipo_Identificacion).text || (c.Identificacion || ''),
      _fmtTelefono(c.Telefono).text || (c.Telefono || ''),
      c.Correo_Electronico || '',
      c.Direccion || '',
      c.Direccion_Envio || '',
      c.Departamento || '',
      c.Municipio || '',
      c.Cupo_Credito || '',
      c.Plazo_Pago || '',
      _plazosParaRecord(c).join(', '),
      _tienePedidosRecord(c) ? 'Sí' : 'No',
      c.Lista_Precio || '',
      _estadoNorm(c.Estado)
    ]);
  });

  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  XLSX.writeFile(wb, 'clientes_' + today() + '.xlsx');
  showToast('✅ Archivo exportado');
}

// ── Close modals on overlay click ──
document.getElementById('edit-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeEdit(); });
document.getElementById('detail-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDetail(); });
document.getElementById('import-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeImport(); });
document.getElementById('delete-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDelete(); });

// ── Init ──
loadClientes();
