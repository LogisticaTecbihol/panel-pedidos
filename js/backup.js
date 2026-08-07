// ── Backup Module ──

var BACKUP_TABLES = [
  { name: 'Pedidos',            label: 'Pedidos' },
  { name: 'Consecutivos',      label: 'Consecutivos' },
  { name: 'EntregasPedido',    label: 'Entregas Pedido' },
  { name: 'Ingresos',          label: 'Ingresos' },
  { name: 'Devoluciones',      label: 'Devoluciones' },
  { name: 'CambiosMercancia',  label: 'Cambios Mercancía' },
  { name: 'Inventario',        label: 'Inventario' },
  { name: 'OrdenesCompra',     label: 'Órdenes Compra' },
  { name: 'SolicitudMuestras', label: 'Solicitud Muestras' },
  { name: 'Reenvases',         label: 'Reenvases' },
  { name: 'KardexAjustes',     label: 'Kardex Ajustes' },
  { name: 'KardexNC',          label: 'Kardex NC' },
  { name: 'RemisionesAnuladas', label: 'Remisiones Anuladas' },
  { name: 'Clientes',          label: 'Clientes' },
  { name: 'Comerciales',       label: 'Comerciales' },
  { name: 'Productos',         label: 'Productos' },
  { name: 'maestro_productos', label: 'Maestro Productos' },
  { name: 'ClientesUnicos',    label: 'Clientes Únicos' },
  { name: 'usuarios',          label: 'Usuarios' },
  { name: 'usuario_empresas',  label: 'Usuario Empresas' },
  { name: 'usuario_modulos',   label: 'Usuario Módulos' },
  { name: 'empresas',          label: 'Empresas' },
];

(async function initBackup() {
  await _authReady;

  if (!AUTH.isAdmin()) {
    location.replace('index.html');
    return;
  }

  var loadZone = document.getElementById('load-zone');
  var mainEl = document.getElementById('main');
  loadZone.style.display = 'none';
  mainEl.style.display = 'block';

  renderTableList();
})();

function renderTableList() {
  var container = document.getElementById('backup-tables');
  container.innerHTML = BACKUP_TABLES.map(function(t) {
    return '<div class="backup-table-item" id="bt-' + t.name + '">' +
      '<span class="tname">' + t.label + '</span>' +
      '<span class="tcount" id="tc-' + t.name + '">—</span>' +
      '</div>';
  }).join('');
}

async function fetchAllRows(tableName) {
  var allData = [];
  var pageSize = 1000;
  var from = 0;
  while (true) {
    var res = await _sb.from(tableName).select('*').range(from, from + pageSize - 1);
    if (res.error) throw new Error(tableName + ': ' + res.error.message);
    if (!res.data || !res.data.length) break;
    allData = allData.concat(res.data);
    if (res.data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

async function startBackup() {
  var btn = document.getElementById('btn-backup');
  var progressEl = document.getElementById('backup-progress');
  var barFill = document.getElementById('bar-fill');
  var barLabel = document.getElementById('bar-label');
  var resultEl = document.getElementById('backup-result');

  btn.disabled = true;
  btn.textContent = 'Descargando...';
  progressEl.style.display = 'block';
  resultEl.className = 'backup-result';
  resultEl.style.display = 'none';

  BACKUP_TABLES.forEach(function(t) {
    var item = document.getElementById('bt-' + t.name);
    if (item) { item.className = 'backup-table-item'; }
    var ct = document.getElementById('tc-' + t.name);
    if (ct) ct.textContent = '—';
  });

  var wb = XLSX.utils.book_new();
  var total = BACKUP_TABLES.length;
  var errors = [];
  var totalRows = 0;

  for (var i = 0; i < total; i++) {
    var t = BACKUP_TABLES[i];
    var pct = Math.round(((i) / total) * 100);
    barFill.style.width = pct + '%';
    barFill.textContent = pct + '%';
    barLabel.textContent = 'Descargando ' + t.label + '...';

    var item = document.getElementById('bt-' + t.name);
    var ct = document.getElementById('tc-' + t.name);

    try {
      var data = await fetchAllRows(t.name);
      totalRows += data.length;

      if (ct) ct.textContent = data.length + ' registros';
      if (item) { item.className = 'backup-table-item done'; }

      var sheetName = t.label.substring(0, 31);
      var ws = XLSX.utils.json_to_sheet(data.length ? data : [{}]);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    } catch (err) {
      errors.push(t.label + ': ' + err.message);
      if (ct) ct.textContent = 'Error';
      if (item) { item.className = 'backup-table-item error'; }

      var ws = XLSX.utils.json_to_sheet([{ error: err.message }]);
      var sheetName = t.label.substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  }

  barFill.style.width = '100%';
  barFill.textContent = '100%';
  barLabel.textContent = 'Generando archivo Excel...';

  var fecha = today();
  var filename = 'backup_panel_' + fecha + '.xlsx';
  XLSX.writeFile(wb, filename);

  if (errors.length) {
    resultEl.className = 'backup-result error';
    resultEl.innerHTML = '⚠️ Backup descargado con ' + errors.length + ' error(es):<br>' +
      errors.map(function(e) { return '• ' + e; }).join('<br>') +
      '<br><br>Total: ' + totalRows + ' registros en ' + (total - errors.length) + ' tablas exitosas.';
  } else {
    resultEl.className = 'backup-result success';
    resultEl.textContent = '✅ Backup descargado exitosamente: ' + filename +
      ' — ' + totalRows + ' registros en ' + total + ' tablas.';
  }

  barLabel.textContent = 'Completado';
  btn.disabled = false;
  btn.textContent = '💾 Descargar Backup Completo';
}
