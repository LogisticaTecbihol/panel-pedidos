// ══════════════════════════════════════════════════════════════
// Lista de Precios — módulo
// ══════════════════════════════════════════════════════════════

var preciosData = [];
var editingId = null;
var deleteId = null;
var importRows = [];
var PAGE_SIZE = 50;
var currentPage = 1;

// ── Load ──
async function loadPrecios() {
  document.getElementById('load-zone').style.display = '';
  document.getElementById('main').style.display = 'none';
  try {
    await _authReady;
    var res = await apiGet('getListaPrecios');
    if (!res.ok) throw new Error(res.error || 'Error al cargar');
    preciosData = res.precios || [];
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
  var empresas = {}, tipos = {}, proveedores = {};
  preciosData.forEach(function(p) {
    if (p.Empresa) empresas[p.Empresa] = true;
    if (p.Tipo_Precio) tipos[p.Tipo_Precio] = true;
    if (p.Proveedor) proveedores[p.Proveedor] = true;
  });
  var selEmp = document.getElementById('f-emp');
  var curEmp = selEmp.value;
  selEmp.innerHTML = '<option value="">Todas</option>';
  Object.keys(empresas).sort().forEach(function(e) {
    var sigla = getSigla(e);
    selEmp.innerHTML += '<option value="' + e.replace(/"/g, '&quot;') + '">' + sigla + '</option>';
  });
  selEmp.value = curEmp;

  var selProv = document.getElementById('f-prov');
  var curProv = selProv.value;
  selProv.innerHTML = '<option value="">Todos</option>';
  Object.keys(proveedores).sort().forEach(function(pr) {
    selProv.innerHTML += '<option value="' + pr.replace(/"/g, '&quot;') + '">' + escHtml(pr) + '</option>';
  });
  selProv.value = curProv;

  var selTipo = document.getElementById('f-tipo');
  var curTipo = selTipo.value;
  selTipo.innerHTML = '<option value="">Todos</option>';
  Object.keys(tipos).sort().forEach(function(t) {
    selTipo.innerHTML += '<option value="' + t.replace(/"/g, '&quot;') + '">' + escHtml(t) + '</option>';
  });
  selTipo.value = curTipo;
}

function getFiltered() {
  var emp = document.getElementById('f-emp').value;
  var prov = document.getElementById('f-prov').value;
  var tipo = document.getElementById('f-tipo').value;
  var txt = (document.getElementById('f-txt').value || '').toLowerCase().trim();
  return preciosData.filter(function(p) {
    if (emp && p.Empresa !== emp) return false;
    if (prov && p.Proveedor !== prov) return false;
    if (tipo && p.Tipo_Precio !== tipo) return false;
    if (txt && (p.Producto || '').toLowerCase().indexOf(txt) < 0) return false;
    return true;
  });
}

function clearFilters() {
  document.getElementById('f-emp').value = '';
  document.getElementById('f-prov').value = '';
  document.getElementById('f-tipo').value = '';
  document.getElementById('f-txt').value = '';
  currentPage = 1;
  renderTable();
}

// ── Render table ──
function renderTable() {
  var filtered = getFiltered();

  // Stats
  var empSet = {}, tipoSet = {};
  preciosData.forEach(function(p) {
    if (p.Empresa) empSet[p.Empresa] = true;
    if (p.Tipo_Precio) tipoSet[p.Tipo_Precio] = true;
  });
  document.getElementById('s-total').textContent = preciosData.length;
  document.getElementById('s-empresas').textContent = Object.keys(empSet).length;
  document.getElementById('s-tipos').textContent = Object.keys(tipoSet).length;

  // Pagination
  var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  var start = (currentPage - 1) * PAGE_SIZE;
  var pageData = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('row-ct').textContent = '(' + filtered.length + ' productos)';

  var canEd = (typeof AUTH !== 'undefined' && AUTH.canEdit) ? AUTH.canEdit() : true;
  var tbody = document.getElementById('t-body');
  tbody.innerHTML = pageData.map(function(p, i) {
    var sigla = getSigla(p.Empresa);
    var siglaClass = getSiglaClass(p.Empresa);
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (start + i + 1) + '</td>' +
      '<td><span class="sigla-tag ' + siglaClass + '">' + escHtml(sigla) + '</span></td>' +
      '<td>' + escHtml(p.Proveedor || '') + '</td>' +
      '<td>' + escHtml(p.Tipo_Precio || '') + '</td>' +
      '<td>' + escHtml(p.Producto || '') + '</td>' +
      '<td class="money">' + fmtMoney(p.Precio) + '</td>' +
      (canEd
        ? '<td style="text-align:center">' +
          '<button onclick="openEditPrecio(' + p.id + ')" style="background:#1a5276;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:4px">✏️</button>' +
          '<button onclick="openDeletePrecio(' + p.id + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600">🗑️</button>' +
          '</td>'
        : '') +
      '</tr>';
  }).join('');

  // Pagination controls
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
document.getElementById('f-prov').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-tipo').addEventListener('change', function() { currentPage = 1; renderTable(); });
document.getElementById('f-txt').addEventListener('input', function() { currentPage = 1; renderTable(); });

// ── Add / Edit modal ──
function _populateEdEmpresa(selectId) {
  var sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">— Seleccionar —</option>';
  EMPRESAS_HOLDING.forEach(function(e) {
    sel.innerHTML += '<option value="' + e.value + '">' + e.sigla + '</option>';
  });
}

function openNuevoPrecio() {
  editingId = null;
  document.getElementById('ed-titulo').textContent = '✏️ Agregar Precio';
  _populateEdEmpresa('ed-empresa');
  document.getElementById('ed-empresa').value = '';
  document.getElementById('ed-proveedor').value = '';
  document.getElementById('ed-tipo').value = '';
  document.getElementById('ed-producto').value = '';
  document.getElementById('ed-precio').value = '';
  document.getElementById('edit-overlay').style.display = 'flex';
}

function openEditPrecio(id) {
  var p = preciosData.find(function(x) { return x.id === id; });
  if (!p) return;
  editingId = id;
  document.getElementById('ed-titulo').textContent = '✏️ Editar Precio';
  _populateEdEmpresa('ed-empresa');
  document.getElementById('ed-empresa').value = p.Empresa || '';
  document.getElementById('ed-proveedor').value = p.Proveedor || '';
  document.getElementById('ed-tipo').value = p.Tipo_Precio || '';
  document.getElementById('ed-producto').value = p.Producto || '';
  document.getElementById('ed-precio').value = p.Precio || '';
  document.getElementById('edit-overlay').style.display = 'flex';
}

function closeEdit() {
  document.getElementById('edit-overlay').style.display = 'none';
  editingId = null;
}

async function saveEdit() {
  var empresa = document.getElementById('ed-empresa').value;
  var proveedor = document.getElementById('ed-proveedor').value.trim();
  var tipo = document.getElementById('ed-tipo').value;
  var producto = document.getElementById('ed-producto').value.trim();
  var precio = document.getElementById('ed-precio').value;

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!tipo) { showToast('Selecciona el tipo de precio', '#e74c3c'); return; }
  if (!producto) { showToast('Ingresa el nombre del producto', '#e74c3c'); return; }
  if (!precio && precio !== 0) { showToast('Ingresa el precio', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result;
    if (editingId) {
      result = await apiPost({
        action: 'editarListaPrecio',
        row: editingId,
        Empresa: empresa,
        Proveedor: proveedor,
        Tipo_Precio: tipo,
        Producto: producto,
        Precio: Number(precio)
      });
    } else {
      result = await apiPost({
        action: 'agregarListaPrecio',
        Empresa: empresa,
        Proveedor: proveedor,
        Tipo_Precio: tipo,
        lineas: [{ Producto: producto, Precio: Number(precio) }]
      });
    }
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeEdit();
    showToast('✅ Precio guardado correctamente');
    await loadPrecios();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Guardar';
  }
}

// ── Delete ──
function openDeletePrecio(id) {
  var p = preciosData.find(function(x) { return x.id === id; });
  if (!p) return;
  deleteId = id;
  document.getElementById('del-msg').textContent = '¿Eliminar este precio?';
  var detail = getSigla(p.Empresa);
  if (p.Proveedor) detail += ' · ' + p.Proveedor;
  detail += ' · ' + p.Tipo_Precio + ' · ' + p.Producto + ' — ' + fmtMoney(p.Precio);
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
    var result = await apiPost({ action: 'eliminarListaPrecio', row: deleteId });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDelete();
    showToast('✅ Precio eliminado');
    await loadPrecios();
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
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      parseImportRows(rows, file.name);
    } catch (err) {
      showToast('❌ Error leyendo el archivo: ' + err.message, '#e74c3c');
    }
  };
  reader.readAsArrayBuffer(file);
}

var importMultiTipo = false;

function parseImportRows(rows, fileName) {
  var headerIdx = -1;
  var colProducto = -1, colPrecio = -1, colProveedor = -1;
  var precioCols = [];
  for (var r = 0; r < Math.min(rows.length, 10); r++) {
    var row = rows[r] || [];
    for (var c = 0; c < row.length; c++) {
      var val = String(row[c] || '').toUpperCase().trim();
      if (val.indexOf('PROVEEDOR') >= 0) colProveedor = c;
      if (val.indexOf('PRODUCTO') >= 0) colProducto = c;
      if (val.indexOf('PRECIO') >= 0) {
        var tipo = 'Dealer';
        if (val.indexOf('MAYORISTA') >= 0) tipo = 'Mayorista';
        else if (val.indexOf('PUBLICO') >= 0 || val.indexOf('PÚBLICO') >= 0) tipo = 'Público';
        else if (val.indexOf('DEALER') >= 0) tipo = 'Dealer';
        precioCols.push({ col: c, tipo: tipo });
        if (colPrecio < 0) colPrecio = c;
      }
    }
    if (colProducto >= 0 && colPrecio >= 0) { headerIdx = r; break; }
  }

  if (headerIdx < 0) {
    colProveedor = 0;
    colProducto = 1;
    colPrecio = 2;
    precioCols = [{ col: 2, tipo: 'Dealer' }];
    headerIdx = 2;
    for (var r2 = 0; r2 < Math.min(rows.length, 10); r2++) {
      var row2 = rows[r2] || [];
      for (var c2 = 0; c2 < row2.length; c2++) {
        var val2 = String(row2[c2] || '').toUpperCase().trim();
        if (val2 === 'PRODUCTO' || val2.indexOf('PRODUCTO') >= 0) {
          headerIdx = r2;
          break;
        }
      }
    }
  }

  importMultiTipo = precioCols.length > 1;
  importRows = [];
  var hasProvCol = colProveedor >= 0;
  for (var i = headerIdx + 1; i < rows.length; i++) {
    var row = rows[i] || [];
    var producto = String(row[colProducto] || '').trim();
    while (producto.indexOf('  ') >= 0) producto = producto.replace(/  /g, ' ');
    if (!producto) continue;
    var prov = hasProvCol ? String(row[colProveedor] || '').trim() : '';
    if (importMultiTipo) {
      precioCols.forEach(function(pc) {
        var precio = Number(row[pc.col]) || 0;
        if (precio) importRows.push({ producto: producto, precio: precio, proveedor: prov, tipo: pc.tipo });
      });
    } else {
      var precio = Number(row[precioCols[0] ? precioCols[0].col : colPrecio]) || 0;
      if (precio) importRows.push({ producto: producto, precio: precio, proveedor: prov });
    }
  }

  if (!importRows.length) {
    showToast('No se encontraron productos válidos en el archivo', '#e74c3c');
    return;
  }

  _populateEdEmpresa('imp-empresa');
  document.getElementById('imp-archivo').textContent = fileName;
  document.getElementById('imp-proveedor').value = '';
  var impTipoWrap = document.getElementById('imp-tipo').parentElement;
  if (importMultiTipo) {
    impTipoWrap.style.display = 'none';
    var tipos = {};
    importRows.forEach(function(r) { if (r.tipo) tipos[r.tipo] = true; });
    document.getElementById('imp-summary').textContent = importRows.length + ' precios encontrados (' + Object.keys(tipos).join(' + ') + ')';
  } else {
    impTipoWrap.style.display = '';
    document.getElementById('imp-summary').textContent = importRows.length + ' productos encontrados en el archivo';
  }
  var showTipoCol = importMultiTipo;
  document.getElementById('imp-lines').innerHTML = importRows.map(function(r, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td>' + escHtml(r.proveedor || '') + '</td>' +
      '<td>' + escHtml(r.producto) + '</td>' +
      (showTipoCol ? '<td>' + escHtml(r.tipo || '') + '</td>' : '') +
      '<td class="money">' + fmtMoney(r.precio) + '</td>' +
      '</tr>';
  }).join('');
  var impThead = document.querySelector('#import-overlay .prod-table thead tr');
  if (impThead) {
    impThead.innerHTML = '<th>#</th><th>Proveedor</th><th>Producto</th>' +
      (showTipoCol ? '<th>Tipo Precio</th>' : '') +
      '<th class="money">Precio</th>';
  }
  document.getElementById('import-overlay').style.display = 'flex';
}

function closeImport() {
  document.getElementById('import-overlay').style.display = 'none';
  importRows = [];
  importMultiTipo = false;
  var impTipoWrap = document.getElementById('imp-tipo').parentElement;
  if (impTipoWrap) impTipoWrap.style.display = '';
}

async function confirmImport() {
  var empresa = document.getElementById('imp-empresa').value;
  var tipo = document.getElementById('imp-tipo').value;
  var provGlobal = document.getElementById('imp-proveedor').value.trim();
  var reemplazar = document.getElementById('imp-reemplazar').checked;

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!importMultiTipo && !tipo) { showToast('Selecciona el tipo de precio', '#e74c3c'); return; }
  if (!importRows.length) { showToast('No hay productos para importar', '#e74c3c'); return; }

  var btn = document.getElementById('btn-import');
  btn.disabled = true;
  btn.textContent = '⏳ Importando...';

  try {
    if (reemplazar) {
      if (importMultiTipo) {
        var tiposSet = {};
        importRows.forEach(function(r) { if (r.tipo) tiposSet[r.tipo] = true; });
        var tiposArr = Object.keys(tiposSet);
        for (var t = 0; t < tiposArr.length; t++) {
          await apiPost({ action: 'eliminarListaPreciosBulk', Empresa: empresa, Tipo_Precio: tiposArr[t] });
        }
      } else {
        await apiPost({ action: 'eliminarListaPreciosBulk', Empresa: empresa, Tipo_Precio: tipo });
      }
    }

    // Group by proveedor+tipo for correct upsert
    var byKey = {};
    importRows.forEach(function(r) {
      var prov = r.proveedor || provGlobal || '';
      var t = importMultiTipo ? (r.tipo || 'Dealer') : tipo;
      var key = prov + '||' + t;
      if (!byKey[key]) byKey[key] = { prov: prov, tipo: t, items: [] };
      byKey[key].items.push(r);
    });

    var chunkSize = 50;
    var total = 0;
    var keys = Object.keys(byKey);
    for (var k = 0; k < keys.length; k++) {
      var group = byKey[keys[k]];
      for (var i = 0; i < group.items.length; i += chunkSize) {
        var chunk = group.items.slice(i, i + chunkSize);
        var result = await apiPost({
          action: 'agregarListaPrecio',
          Empresa: empresa,
          Proveedor: group.prov,
          Tipo_Precio: group.tipo,
          lineas: chunk.map(function(r) {
            return { Producto: r.producto, Precio: r.precio };
          })
        });
        if (!result.ok) throw new Error(result.error || 'Error en la importación');
        total += chunk.length;
      }
    }

    closeImport();
    showToast('✅ ' + total + ' precios importados correctamente');
    await loadPrecios();
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

  var rows = [['Empresa', 'Proveedor', 'Tipo Precio', 'Producto', 'Precio']];
  filtered.forEach(function(p) {
    rows.push([getSigla(p.Empresa), p.Proveedor || '', p.Tipo_Precio, p.Producto, Number(p.Precio) || 0]);
  });

  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lista de Precios');
  XLSX.writeFile(wb, 'lista_precios_' + today() + '.xlsx');
  showToast('✅ Archivo exportado');
}

// ── Close modals on overlay click ──
document.getElementById('edit-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeEdit(); });
document.getElementById('import-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeImport(); });
document.getElementById('delete-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDelete(); });

// ── Init ──
loadPrecios();
