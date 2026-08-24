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

// ── Load ──
async function loadClientes() {
  document.getElementById('load-zone').style.display = '';
  document.getElementById('main').style.display = 'none';
  try {
    await _authReady;
    var res = await apiGet('getClientesAll');
    if (!res.ok) throw new Error(res.error || 'Error al cargar');
    clientesData = res.clientes || [];
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
    selEmp.innerHTML += '<option value="' + e.replace(/"/g, '&quot;') + '">' + getSigla(e) + '</option>';
  });
  selEmp.value = curEmp;

  var selDepto = document.getElementById('f-depto');
  var curDepto = selDepto.value;
  selDepto.innerHTML = '<option value="">Todos</option>';
  Object.keys(deptos).sort().forEach(function(d) {
    selDepto.innerHTML += '<option value="' + d.replace(/"/g, '&quot;') + '">' + escHtml(d) + '</option>';
  });
  selDepto.value = curDepto;

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
    selMuni.innerHTML += '<option value="' + m.replace(/"/g, '&quot;') + '">' + escHtml(m) + '</option>';
  });
  selMuni.value = munis[curMuni] ? curMuni : '';
}

function getFiltered() {
  var emp = document.getElementById('f-emp').value;
  var depto = document.getElementById('f-depto').value;
  var muni = document.getElementById('f-muni').value;
  var txt = (document.getElementById('f-txt').value || '').toLowerCase().trim();
  return clientesData.filter(function(c) {
    if (emp && c.Nombre_Empresa !== emp) return false;
    if (depto && c.Departamento !== depto) return false;
    if (muni && c.Municipio !== muni) return false;
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
  var txt = (document.getElementById('f-txt').value || '').toLowerCase().trim();

  var filtered = allGrps.filter(function(g) {
    if (!emp && !depto && !muni && !txt) return true;
    return g.records.some(function(c) {
      if (emp && c.Nombre_Empresa !== emp) return false;
      if (depto && c.Departamento !== depto) return false;
      if (muni && c.Municipio !== muni) return false;
      if (txt) {
        var haystack = [c.Cliente, c.Identificacion, c.Correo_Electronico, c.Telefono, c.Municipio, c.Departamento]
          .join(' ').toLowerCase();
        if (haystack.indexOf(txt) < 0) return false;
      }
      return true;
    });
  });
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
      if (e && !empresasSeen[e]) { empresasSeen[e] = true; empresas.push(e); }
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
      '<td>' + escHtml(_bestId(g.records)) + '</td>' +
      '<td>' + escHtml(first.Tipo_Identificacion || '') + '</td>' +
      '<td>' + escHtml(tel) + '</td>' +
      '<td>' + muniHtml + '</td>' +
      '<td style="font-size:0.78rem">' + escHtml(correo) + '</td>' +
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
document.getElementById('f-txt').addEventListener('input', function() { currentPage = 1; renderTable(); });

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
    ['Identificación', _bestId(g.records)],
    ['Tipo ID', tipoId],
    ['Teléfono', tel],
    ['Correo', correo]
  ];
  commonFields.forEach(function(f) {
    html += '<div>' +
      '<div style="font-size:0.72rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-bottom:2px">' + f[0] + '</div>' +
      '<div style="font-size:0.88rem;color:#2d3748;font-weight:500">' + escHtml(f[1] || '—') + '</div>' +
      '</div>';
  });
  html += '</div>';

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
        ['Teléfono', r.Telefono]
      ];
      sedeFields.forEach(function(f) {
        html += '<div><span style="color:#a0aec0;font-size:0.72rem;font-weight:600">' + f[0] + ':</span> ' + escHtml(f[1] || '—') + '</div>';
      });
      html += '</div></div>';
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
      sel.innerHTML += '<option value="' + d.replace(/"/g, '&quot;') + '">' + escHtml(d) + '</option>';
    });
  }
}

function _populateMunis(deptoSelectId, muniSelectId) {
  var depto = document.getElementById(deptoSelectId).value;
  var sel = document.getElementById(muniSelectId);
  sel.innerHTML = '<option value="">— Seleccionar —</option>';
  if (depto && typeof COLOMBIA_DEPTOS_MUNIS !== 'undefined' && COLOMBIA_DEPTOS_MUNIS[depto]) {
    COLOMBIA_DEPTOS_MUNIS[depto].forEach(function(m) {
      sel.innerHTML += '<option value="' + m.replace(/"/g, '&quot;') + '">' + escHtml(m) + '</option>';
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
    Lista_Precio: document.getElementById('ed-lista-precio').value
  };

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
  var detail = getSigla(c.Nombre_Empresa) + ' · ' + (c.Cliente || '') + ' · ' + (c.Identificacion || '—');
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

  var rows = [['Empresa', 'Cliente', 'Tipo ID', 'Identificación', 'Teléfono', 'Correo', 'Dirección', 'Dirección Envío', 'Departamento', 'Municipio', 'Cupo Crédito', 'Plazo Pago', 'Lista Precio']];
  filtered.forEach(function(c) {
    rows.push([
      getSigla(c.Nombre_Empresa),
      c.Cliente || '',
      c.Tipo_Identificacion || '',
      c.Identificacion || '',
      c.Telefono || '',
      c.Correo_Electronico || '',
      c.Direccion || '',
      c.Direccion_Envio || '',
      c.Departamento || '',
      c.Municipio || '',
      c.Cupo_Credito || '',
      c.Plazo_Pago || '',
      c.Lista_Precio || ''
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
