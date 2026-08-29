// ══════════════════════════════════════════════════════════════
// Productos — catálogo maestro (tabla maestro_productos)
// ══════════════════════════════════════════════════════════════

var productosData = [];      // [{ id, Producto }]
var editingId = null;
var deleteId = null;
var PAGE_SIZE = 100;
var currentPage = 1;
var sortDir = 'asc';         // 'asc' | 'desc' sobre el nombre del producto

// ── Load ──
async function loadProductos() {
  document.getElementById('load-zone').style.display = '';
  document.getElementById('main').style.display = 'none';
  try {
    await _authReady;
    var all = [], from = 0, size = 1000;
    while (true) {
      var res = await _sb.from('maestro_productos').select('id, Producto').order('Producto').range(from, from + size - 1);
      if (res.error) throw new Error(res.error.message);
      all = all.concat(res.data || []);
      if (!res.data || res.data.length < size) break;
      from += size;
    }
    productosData = all;
    document.getElementById('load-zone').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    renderTable();
    setSyncStatus('ok', 'Conectado a la nube. Los cambios se guardan automáticamente.');
  } catch (err) {
    document.getElementById('load-error').textContent = err.message;
    document.getElementById('btn-retry').style.display = '';
    setSyncStatus('error', 'Error al conectar');
  }
}

// ── Filtro ──
function getFiltered() {
  var txt = (document.getElementById('f-txt').value || '').toLowerCase().trim();
  var rows = productosData.filter(function(p) {
    if (!txt) return true;
    return (p.Producto || '').toLowerCase().indexOf(txt) >= 0;
  });
  rows.sort(function(a, b) {
    var cmp = (a.Producto || '').localeCompare(b.Producto || '', 'es', { sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function clearFilters() {
  document.getElementById('f-txt').value = '';
  currentPage = 1;
  renderTable();
}

function toggleSort() {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  renderTable();
}

// ── Render ──
function renderTable() {
  var canEd = (typeof AUTH !== 'undefined' && AUTH.canEdit) ? AUTH.canEdit() : false;
  var canDel = (typeof AUTH !== 'undefined' && AUTH.canDelete) ? AUTH.canDelete() : false;

  var filtered = getFiltered();

  document.getElementById('s-total').textContent = productosData.length;
  document.getElementById('s-mostrados').textContent = filtered.length;
  document.getElementById('row-ct').textContent = '(' + filtered.length + ' producto' + (filtered.length !== 1 ? 's' : '') + ')';

  // Encabezado con ordenamiento por nombre
  var sortCls = 'sortable ' + (sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  document.getElementById('t-head').innerHTML =
    '<th style="width:60px">#</th>' +
    '<th class="' + sortCls + '" onclick="toggleSort()">Producto<span class="sort-icon"></span></th>' +
    (canEd ? '<th style="width:150px" class="auth-edit-only">Acción</th>' : '');

  var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  var start = (currentPage - 1) * PAGE_SIZE;
  var pageRows = filtered.slice(start, start + PAGE_SIZE);

  var tbody = document.getElementById('t-body');
  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="' + (canEd ? 3 : 2) + '"><div class="empty">No hay productos que coincidan con la búsqueda.</div></td></tr>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = pageRows.map(function(p, i) {
    var accion = '';
    if (canEd) {
      accion = '<td style="white-space:nowrap">' +
        '<button class="btn-edit" onclick="openEditProducto(' + p.id + ')" title="Editar" style="background:#1a5276;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600;margin-right:3px">✏️</button>' +
        (canDel ? '<button class="btn-del" onclick="openDeleteProducto(' + p.id + ')" title="Eliminar" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600">🗑️</button>' : '') +
        '</td>';
    }
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (start + i + 1) + '</td>' +
      '<td style="font-weight:600">' + escHtml(p.Producto || '') + '</td>' +
      accion +
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

document.getElementById('f-txt').addEventListener('input', debounce(function() { currentPage = 1; renderTable(); }, 250));

// ── Agregar / Editar ──
function openNuevoProducto() {
  editingId = null;
  document.getElementById('ed-titulo').textContent = '➕ Agregar Producto';
  document.getElementById('ed-producto').value = '';
  document.getElementById('ed-warn').style.display = 'none';
  document.getElementById('edit-overlay').style.display = 'flex';
  setTimeout(function() { document.getElementById('ed-producto').focus(); }, 50);
}

function openEditProducto(id) {
  var p = productosData.find(function(x) { return x.id === id; });
  if (!p) return;
  editingId = id;
  document.getElementById('ed-titulo').textContent = '✏️ Editar Producto';
  document.getElementById('ed-producto').value = p.Producto || '';
  document.getElementById('ed-warn').style.display = 'none';
  document.getElementById('edit-overlay').style.display = 'flex';
  setTimeout(function() { document.getElementById('ed-producto').focus(); }, 50);
}

function closeEdit() {
  document.getElementById('edit-overlay').style.display = 'none';
  editingId = null;
}

async function saveEdit() {
  var nombre = document.getElementById('ed-producto').value.trim().replace(/\s+/g, ' ');
  var warn = document.getElementById('ed-warn');
  if (!nombre) { showToast('Ingresa el nombre del producto', '#e74c3c'); return; }

  // Duplicado (case-insensitive), ignorando el registro que se está editando
  var dup = productosData.find(function(p) {
    return p.id !== editingId && (p.Producto || '').toLowerCase() === nombre.toLowerCase();
  });
  if (dup) {
    warn.textContent = '⚠️ Ya existe un producto con ese nombre: "' + dup.Producto + '"';
    warn.style.display = 'block';
    return;
  }

  var btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var res;
    if (editingId) {
      res = await _sb.from('maestro_productos').update({ Producto: nombre }).eq('id', editingId);
    } else {
      res = await _sb.from('maestro_productos').insert({ Producto: nombre });
    }
    if (res.error) {
      if (res.error.code === '23505') throw new Error('Ya existe un producto con ese nombre');
      if (res.error.code === '42501' || /row-level security/i.test(res.error.message)) {
        throw new Error('No tienes permiso para modificar el catálogo de productos');
      }
      throw new Error(res.error.message);
    }
    closeEdit();
    showToast(editingId ? '✅ Producto actualizado' : '✅ Producto agregado');
    await loadProductos();
  } catch (err) {
    showToast('❌ ' + err.message, '#e74c3c');
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Guardar';
  }
}

// ── Eliminar ──
function openDeleteProducto(id) {
  var p = productosData.find(function(x) { return x.id === id; });
  if (!p) return;
  deleteId = id;
  document.getElementById('del-detail').textContent = p.Producto || '';
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
    var res = await _sb.from('maestro_productos').delete().eq('id', deleteId);
    if (res.error) {
      if (res.error.code === '42501' || /row-level security/i.test(res.error.message)) {
        throw new Error('No tienes permiso para eliminar productos');
      }
      throw new Error(res.error.message);
    }
    closeDelete();
    showToast('✅ Producto eliminado');
    await loadProductos();
  } catch (err) {
    showToast('❌ ' + err.message, '#e74c3c');
  } finally {
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Exportar Excel ──
function exportExcel() {
  var filtered = getFiltered();
  if (!filtered.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }
  var rows = [['#', 'Producto']];
  filtered.forEach(function(p, i) { rows.push([i + 1, p.Producto || '']); });
  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 6 }, { wch: 60 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  XLSX.writeFile(wb, 'productos_' + today() + '.xlsx');
  showToast('✅ Archivo exportado');
}

// ── Cerrar modales al hacer clic fuera ──
document.getElementById('edit-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeEdit(); });
document.getElementById('delete-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDelete(); });
document.getElementById('ed-producto').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } });

// ── Init ──
loadProductos();
