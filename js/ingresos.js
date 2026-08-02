// ── State ──
var ingresos = [];
var editIngreso = null;
var catalogoProductos = [];
var ingLineas = [];

// ── Constants ──
var ORIGENES = ['Planta Mosquera', 'Planta Cachipay', 'Proveedor Carval', 'Chia Abago', 'Bodega Villeta', 'Germisemillas'];
function getSiglaIng(n) { return getSigla(n); }
function getSiglaClassIng(n) { return getSiglaClass(n); }

// ── Sorting ──
var sortLevelsIng = [];

var SORT_COLS_ING = [
  { id:'fecha',     label:'Fecha',        fn: function(r) { return +new Date(r.Fecha||0); } },
  { id:'origen',    label:'Origen',       fn: function(r) { return (r.Origen||'').toLowerCase(); } },
  { id:'emp_orig',   label:'Emp. Origen',  fn: function(r) { return getSiglaIng(r.Empresa_Origen); } },
  { id:'emp_dest',   label:'Emp. Destino', fn: function(r) { return getSiglaIng(r.Empresa_Destino); } },
  { id:'producto',  label:'Producto',     fn: function(r) { return (r.Producto||'').toLowerCase(); } },
  { id:'cantidad',  label:'Cantidad',     fn: function(r) { return Number(r.Cantidad)||0; } },
  { id:'responsable', label:'Responsable', fn: function(r) { return (r.Responsable||'').toLowerCase(); } },
];

function toggleSortIng(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevelsIng.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevelsIng.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevelsIng[idx].dir === 'asc') sortLevelsIng[idx].dir = 'desc'; else sortLevelsIng.splice(idx, 1); }
  else { sortLevelsIng.push({ id: id, dir: 'asc' }); }
  renderIngTable();
}

function clearSortIng() { sortLevelsIng = []; renderIngTable(); }

function applySortIng(rows) {
  if (!sortLevelsIng.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevelsIng.length; si++) {
      var lvl = sortLevelsIng[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS_ING.length; ci++) { if (SORT_COLS_ING[ci].id === lvl.id) { col = SORT_COLS_ING[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

// ── Load from API ──
async function loadIngresos() {
  await _authReady;
  populateEmpresaSelect('f-emp-orig', 'Todas');
  populateEmpresaSelect('f-emp-dest', 'Todas');
  populateEmpresaSelect('ing-empresa-origen');
  populateEmpresaSelect('ing-empresa-destino');
  var loadZone = document.getElementById('load-zone');
  var mainEl = document.getElementById('main');
  var errEl = document.getElementById('load-error');
  var retryBtn = document.getElementById('btn-retry');
  var spinnerEl = document.getElementById('load-spinner');

  if (mainEl.style.display === 'block') {
    setSyncStatus('syncing', 'Actualizando datos...');
  } else {
    loadZone.style.display = 'block';
    spinnerEl.style.display = 'inline-block';
    errEl.style.display = 'none';
    retryBtn.style.display = 'none';
  }

  try {
    var data = await apiGet('getIngresos', { columns: 'id,Fecha,Origen,Empresa_Origen,Empresa_Destino,Producto,Presentacion,Cantidad,Responsable,Remision_Origen,Remision_Destino,Observaciones' });
    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    ingresos = (data.ingresos || []).map(function(r) {
      if (r.Fecha instanceof Date) r.Fecha = r.Fecha.toISOString().slice(0,10);
      return r;
    });

    populateIngFilters();
    renderIngTable();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + ingresos.length + ' registros';
  } catch (err) {
    if (mainEl.style.display === 'block') {
      setSyncStatus('error', 'Error al actualizar: ' + err.message);
    } else {
      spinnerEl.style.display = 'none';
      errEl.textContent = '⚠️ ' + err.message;
      errEl.style.display = 'block';
      retryBtn.style.display = 'inline-block';
    }
  }
}

async function loadCatalogo() {
  try {
    var data = await apiGet('getMaestroProductos');
    if (data.ok) catalogoProductos = data.productos || [];
  } catch(e) {}
}

// ── Filters ──
var ingFiltersAttached = false;
function populateIngFilters() {
  var productos = []; var responsables = [];
  ingresos.forEach(function(r) {
    if (r.Producto && productos.indexOf(r.Producto) < 0) productos.push(r.Producto);
    if (r.Responsable && responsables.indexOf(r.Responsable) < 0) responsables.push(r.Responsable);
  });
  productos.sort(); responsables.sort();

  var fp = document.getElementById('f-prod');
  fp.innerHTML = '<option value="">Todos</option>' + productos.map(function(p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');

  var fr = document.getElementById('f-resp');
  fr.innerHTML = '<option value="">Todos</option>' + responsables.map(function(r) { return '<option value="' + r + '">' + r + '</option>'; }).join('');

  if (!ingFiltersAttached) {
    ['f-origen','f-emp-orig','f-emp-dest','f-prod','f-resp','f-txt'].forEach(function(id) {
      document.getElementById(id).addEventListener('change', renderIngTable);
      document.getElementById(id).addEventListener('input', renderIngTable);
    });
    ingFiltersAttached = true;
  }
}

function filteredIng() {
  var fo = document.getElementById('f-origen').value;
  var feo = document.getElementById('f-emp-orig').value;
  var fed = document.getElementById('f-emp-dest').value;
  var fp = document.getElementById('f-prod').value;
  var fr = document.getElementById('f-resp').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();
  return ingresos.filter(function(r) {
    if (fo && r.Origen !== fo) return false;
    if (feo && r.Empresa_Origen !== feo) return false;
    if (fed && r.Empresa_Destino !== fed) return false;
    if (fp && r.Producto !== fp) return false;
    if (fr && r.Responsable !== fr) return false;
    if (ft) {
      var hay = [r.Producto, r.Presentacion, r.Remision_Origen, r.Remision_Destino, r.Responsable, r.Observaciones].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function clearIngFilters() {
  document.getElementById('f-origen').value = '';
  document.getElementById('f-emp-orig').value = '';
  document.getElementById('f-emp-dest').value = '';
  document.getElementById('f-prod').value = '';
  document.getElementById('f-resp').value = '';
  document.getElementById('f-txt').value = '';
  renderIngTable();
}

// ── Render ──
function renderIngHeader() {
  var cols = [
    { label:'#', id:null },
    { label:'Fecha', id:'fecha' },
    { label:'Origen', id:'origen' },
    { label:'Emp. Origen', id:'emp_orig' },
    { label:'Emp. Destino', id:'emp_dest' },
    { label:'Producto', id:'producto' },
    { label:'Presentación', id:null },
    { label:'Cantidad', id:'cantidad' },
    { label:'Responsable', id:'responsable' },
    { label:'Rem. Origen', id:null },
    { label:'Rem. Destino', id:null },
    { label:'Acción', id:null },
  ];
  document.getElementById('t-head-ing').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = sortLevelsIng.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevelsIng[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevelsIng.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSortIng(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');
  var btn = document.getElementById('btn-clear-sort-ing');
  if (btn) btn.style.display = sortLevelsIng.length ? 'inline-block' : 'none';
}

function renderIngTable() {
  var rows = applySortIng(filteredIng());

  var totalRegs = ingresos.length;
  var totalUnidades = ingresos.reduce(function(s, r) { return s + (Number(r.Cantidad)||0); }, 0);
  var mosquera = ingresos.filter(function(r) { return r.Origen === 'Planta Mosquera'; }).length;
  var cachipay = ingresos.filter(function(r) { return r.Origen === 'Planta Cachipay'; }).length;

  document.getElementById('s-total').textContent = totalRegs;
  document.getElementById('s-unidades').textContent = totalUnidades.toLocaleString('es-CO');
  document.getElementById('s-mosquera').textContent = mosquera;
  document.getElementById('s-cachipay').textContent = cachipay;
  document.getElementById('row-ct-ing').textContent = '(' + rows.length + ' mostrados)';

  renderIngHeader();

  var tbody = document.getElementById('t-body-ing');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="empty">No hay ingresos con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(r, i) {
    var origenBadge = r.Origen === 'Devolución'
      ? '<span class="badge b-rec">Devolución</span>'
      : '<span class="badge b-par">' + (r.Origen||'—') + '</span>';
    return '<tr>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i+1) + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(r.Fecha) + '</td>' +
      '<td>' + origenBadge + '</td>' +
      '<td title="' + (r.Empresa_Origen||'') + '"><span class="sigla-badge ' + getSiglaClassIng(r.Empresa_Origen) + '">' + getSiglaIng(r.Empresa_Origen) + '</span></td>' +
      '<td title="' + (r.Empresa_Destino||'') + '"><span class="sigla-badge ' + getSiglaClassIng(r.Empresa_Destino) + '">' + getSiglaIng(r.Empresa_Destino) + '</span></td>' +
      '<td style="font-weight:700">' + (r.Producto||'—') + '</td>' +
      '<td>' + (r.Presentacion||'—') + '</td>' +
      '<td style="text-align:center;font-weight:700">' + (r.Cantidad||0) + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Responsable||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Remision_Origen||'—') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.Remision_Destino||'—') + '</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="openEditIng(' + r.__row + ')" title="Editar">✏️</button>' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="openDeleteIng(' + i + ',' + (r.__row||0) + ')" title="Eliminar">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Product search/autocomplete ──
var activeAutocomplete = null;

function buildProductSearch(lineIdx) {
  var inp = document.querySelector('.ing-prod-search[data-line="' + lineIdx + '"]');
  if (!inp) return;

  inp.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    var empSel = document.getElementById('ing-empresa-origen').value;
    closeAllAutocomplete();
    if (q.length < 1) return;

    var matches = catalogoProductos.filter(function(p) {
      var matchName = (p.producto||'').toLowerCase().indexOf(q) >= 0;
      var matchEmp = !empSel || !p.empresa || p.empresa === empSel;
      return matchName && matchEmp;
    });

    var seen = {};
    matches = matches.filter(function(p) {
      var key = p.producto + '||' + p.presentacion;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    if (!matches.length) return;

    var list = document.createElement('div');
    list.className = 'autocomplete-list';
    list.style.cssText = 'position:absolute;z-index:100;background:white;border:1px solid #cbd5e0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:200px;overflow-y:auto;width:100%;left:0;top:100%';

    matches.slice(0, 15).forEach(function(p) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid #f0f4f8;display:flex;justify-content:space-between;align-items:center';
      item.innerHTML = '<span style="font-weight:600">' + (p.producto||'') + '</span><span style="color:#718096;font-size:0.75rem">' + (p.presentacion||'') + '</span>';
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        inp.value = p.producto;
        var presInp = document.querySelector('.ing-pres[data-line="' + lineIdx + '"]');
        if (presInp) presInp.value = p.presentacion || '';
        ingLineas[lineIdx].Producto = p.producto;
        ingLineas[lineIdx].Presentacion = p.presentacion || '';
        closeAllAutocomplete();
      });
      item.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
      item.addEventListener('mouseout', function() { this.style.background = 'white'; });
      list.appendChild(item);
    });

    var wrapper = inp.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(list);
    activeAutocomplete = list;
  });

  inp.addEventListener('blur', function() {
    setTimeout(closeAllAutocomplete, 150);
  });
}

function closeAllAutocomplete() {
  document.querySelectorAll('.autocomplete-list').forEach(function(el) { el.remove(); });
  activeAutocomplete = null;
}

// ── Render line rows in modal ──
function renderIngLines() {
  var tbody = document.getElementById('ing-lines');
  tbody.innerHTML = ingLineas.map(function(l, i) {
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td style="position:relative"><div style="position:relative"><input class="ef ing-prod-search" data-line="' + i + '" type="text" value="' + ((l.Producto||'').replace(/"/g,'&quot;')) + '" placeholder="Buscar producto..." autocomplete="off"></div></td>' +
      '<td><input class="ef ing-pres" data-line="' + i + '" type="text" value="' + ((l.Presentacion||'').replace(/"/g,'&quot;')) + '" placeholder="Presentación" style="width:120px"></td>' +
      '<td><input class="ef ing-cant" data-line="' + i + '" type="number" min="1" value="' + (l.Cantidad||'') + '" placeholder="0" style="width:80px;text-align:right"></td>' +
      '<td style="text-align:center">' +
        '<button onclick="removeIngLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  ingLineas.forEach(function(l, i) { buildProductSearch(i); });
}

function addIngLine() {
  ingLineas.push({ Producto: '', Presentacion: '', Cantidad: '' });
  renderIngLines();
  var lastInput = document.querySelector('.ing-prod-search[data-line="' + (ingLineas.length - 1) + '"]');
  if (lastInput) lastInput.focus();
}

function removeIngLine(i) {
  if (ingLineas.length <= 1) { showToast('Debe haber al menos una línea', '#e67e22'); return; }
  ingLineas.splice(i, 1);
  renderIngLines();
}

function readIngLines() {
  document.querySelectorAll('.ing-prod-search').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ingLineas[i]) ingLineas[i].Producto = inp.value.trim();
  });
  document.querySelectorAll('.ing-pres').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ingLineas[i]) ingLineas[i].Presentacion = inp.value.trim();
  });
  document.querySelectorAll('.ing-cant').forEach(function(inp) {
    var i = Number(inp.dataset.line);
    if (ingLineas[i]) ingLineas[i].Cantidad = Number(inp.value) || 0;
  });
}

// ── Origen → Empresa mapping ──
var ORIGEN_EMPRESA = {
  'Planta Mosquera': 'GREEN AGROSOLUCIONES DE COLOMBIA SAS',
  'Planta Cachipay': 'PARCELAR DE COLOMBIA SAS',
};

function onOrigenChange() {
  var origen = document.getElementById('ing-origen').value;
  var empresa = ORIGEN_EMPRESA[origen];
  if (empresa) {
    document.getElementById('ing-empresa-origen').value = empresa;
  }
  var esExterno = origen === 'Proveedor Carval' || origen === 'Chia Abago' || origen === 'Bodega Villeta' || origen === 'Germisemillas';
  document.getElementById('ing-empresa-origen-wrap').style.display = esExterno ? 'none' : '';
  document.getElementById('ing-remision-origen-wrap').style.display = esExterno ? 'none' : '';
  if (esExterno) {
    document.getElementById('ing-empresa-origen').value = '';
    document.getElementById('ing-remision-origen').value = '';
  }
  if (origen === 'Chia Abago') {
    document.getElementById('ing-empresa-destino').value = '';
  }
}

// ── New Ingreso Modal ──
function openNewIngreso() {
  editIngreso = null;
  document.getElementById('ing-modal-title').textContent = '📥 Registrar Ingreso';
  document.getElementById('ing-fecha').value = today();
  document.getElementById('ing-origen').value = 'Planta Mosquera';
  document.getElementById('ing-empresa-origen').value = '';
  document.getElementById('ing-empresa-destino').value = '';
  document.getElementById('ing-responsable').value = '';
  document.getElementById('ing-remision-origen').value = '';
  document.getElementById('ing-remision-destino').value = '';
  document.getElementById('ing-observaciones').value = '';
  document.getElementById('btn-save-ing').disabled = false;
  document.getElementById('btn-save-ing').textContent = '✓ Registrar ingreso';
  document.getElementById('ing-edit-single').style.display = 'none';
  document.getElementById('ing-multi-lines').style.display = 'block';

  ingLineas = [{ Producto: '', Presentacion: '', Cantidad: '' }];
  renderIngLines();
  onOrigenChange();
  document.getElementById('ing-overlay').classList.add('show');
}

function closeIngModal() {
  document.getElementById('ing-overlay').classList.remove('show');
  editIngreso = null;
  closeAllAutocomplete();
}

document.getElementById('ing-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeIngModal(); });

// ── Edit Ingreso (single line) ──
function openEditIng(row) {
  var r = null;
  for (var i = 0; i < ingresos.length; i++) {
    if (ingresos[i].__row === row) { r = ingresos[i]; break; }
  }
  if (!r) return;
  editIngreso = r;
  document.getElementById('ing-modal-title').textContent = '✏️ Editar Ingreso';
  document.getElementById('ing-fecha').value = toDateInput(r.Fecha);
  document.getElementById('ing-origen').value = r.Origen || '';
  document.getElementById('ing-empresa-origen').value = r.Empresa_Origen || '';
  document.getElementById('ing-empresa-destino').value = r.Empresa_Destino || '';
  document.getElementById('ing-responsable').value = r.Responsable || '';
  document.getElementById('ing-remision-origen').value = r.Remision_Origen || '';
  document.getElementById('ing-remision-destino').value = r.Remision_Destino || '';
  document.getElementById('ing-observaciones').value = r.Observaciones || '';
  document.getElementById('btn-save-ing').disabled = false;
  document.getElementById('btn-save-ing').textContent = '✓ Guardar cambios';

  document.getElementById('ing-multi-lines').style.display = 'none';
  document.getElementById('ing-edit-single').style.display = 'block';
  document.getElementById('ing-edit-producto').value = r.Producto || '';
  document.getElementById('ing-edit-presentacion').value = r.Presentacion || '';
  document.getElementById('ing-edit-cantidad').value = r.Cantidad || '';

  onOrigenChange();
  document.getElementById('ing-overlay').classList.add('show');
}

// ── Save ──
async function saveIngreso() {
  var fecha = document.getElementById('ing-fecha').value;
  var origen = document.getElementById('ing-origen').value;
  var empresa_origen = document.getElementById('ing-empresa-origen').value;
  var empresa_destino = document.getElementById('ing-empresa-destino').value;
  var responsable = document.getElementById('ing-responsable').value.trim();
  var remision_origen = document.getElementById('ing-remision-origen').value.trim();
  var remision_destino = document.getElementById('ing-remision-destino').value.trim();
  var observaciones = document.getElementById('ing-observaciones').value.trim();

  if (!fecha) { showToast('Selecciona la fecha', '#e74c3c'); return; }
  if (!origen) { showToast('Selecciona el origen', '#e74c3c'); return; }
  var esExterno = origen === 'Proveedor Carval' || origen === 'Chia Abago' || origen === 'Bodega Villeta' || origen === 'Germisemillas';
  if (!esExterno && !empresa_origen) { showToast('Selecciona la empresa origen', '#e74c3c'); return; }
  if (origen !== 'Chia Abago' && !empresa_destino) { showToast('Selecciona la empresa destino', '#e74c3c'); return; }
  if (!responsable) { showToast('Ingresa el responsable', '#e74c3c'); return; }

  var btn = document.getElementById('btn-save-ing');

  if (editIngreso) {
    var prod = document.getElementById('ing-edit-producto').value.trim();
    var pres = document.getElementById('ing-edit-presentacion').value.trim();
    var cant = Number(document.getElementById('ing-edit-cantidad').value) || 0;
    if (!prod) { showToast('Ingresa el producto', '#e74c3c'); return; }
    if (cant <= 0) { showToast('Ingresa una cantidad válida', '#e74c3c'); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    try {
      var result = await apiPost({
        action: 'editarIngreso',
        row: editIngreso.__row,
        Fecha: fecha, Origen: origen, Empresa_Origen: empresa_origen, Empresa_Destino: empresa_destino,
        Producto: prod, Presentacion: pres, Cantidad: cant,
        Responsable: responsable, Remision_Origen: remision_origen, Remision_Destino: remision_destino, Observaciones: observaciones,
      });
      if (!result.ok) throw new Error(result.error || 'Error al guardar');
      closeIngModal();
      showToast('✅ Ingreso actualizado en la nube');
      await loadIngresos();
    } catch (err) {
      showToast('❌ Error: ' + err.message, '#e74c3c');
      btn.disabled = false;
      btn.textContent = '✓ Guardar cambios';
    }
    return;
  }

  readIngLines();
  var validLines = ingLineas.filter(function(l) { return l.Producto && l.Cantidad > 0; });
  if (!validLines.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'agregarIngreso',
      Fecha: fecha, Origen: origen, Empresa_Origen: empresa_origen, Empresa_Destino: empresa_destino,
      Responsable: responsable, Remision_Origen: remision_origen, Remision_Destino: remision_destino, Observaciones: observaciones,
      lineas: validLines,
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');
    closeIngModal();
    showToast('✅ ' + result.added + ' línea(s) registradas en la nube');
    await loadIngresos();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Registrar ingreso';
  }
}

// ── Delete ──
var deleteIngRow = null;

function openDeleteIng(idx, row) {
  deleteIngRow = row;
  var rows = filteredIng();
  var r = rows[idx] || {};
  document.getElementById('del-ing-msg').textContent = '¿Eliminar este ingreso?';
  document.getElementById('del-ing-detail').innerHTML =
    'Producto: <strong>' + (r.Producto||'—') + '</strong> · ' + (r.Cantidad||0) + ' uds<br>' +
    'Origen: ' + (r.Origen||'—') + ' · Rem: ' + (r.Remision_Origen||'—') + '/' + (r.Remision_Destino||'—') + ' · ' + fmtDate(r.Fecha) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminará este registro de la base de datos.</span>';
  document.getElementById('btn-del-ing-confirm').disabled = false;
  document.getElementById('btn-del-ing-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-ing-overlay').classList.add('show');
}

function closeDeleteIng() {
  document.getElementById('delete-ing-overlay').classList.remove('show');
  deleteIngRow = null;
}

document.getElementById('delete-ing-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteIng(); });

async function confirmDeleteIng() {
  if (!deleteIngRow) return;
  var btn = document.getElementById('btn-del-ing-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({ action: 'eliminarIngreso', row: deleteIngRow });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDeleteIng();
    showToast('🗑️ Ingreso eliminado');
    await loadIngresos();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Auto-load ──
loadIngresos();
loadCatalogo();
