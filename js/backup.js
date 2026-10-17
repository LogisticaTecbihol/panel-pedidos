// ── Backup Module ──

var BACKUP_TABLES = [
  { name: 'Pedidos',            label: 'Pedidos' },
  { name: 'Consecutivos',      label: 'Consecutivos' },
  { name: 'EntregasPedido',    label: 'Entregas Pedido' },
  { name: 'Ingresos',          label: 'Ingresos' },
  { name: 'Devoluciones',      label: 'Devoluciones' },
  { name: 'CambiosMercancia',  label: 'Cambios Mercancía' },
  { name: 'InventarioFisico',  label: 'Inventario Físico' },
  { name: 'OrdenesCompra',     label: 'Órdenes Compra' },
  { name: 'SolicitudMuestras', label: 'Solicitud Muestras' },
  { name: 'Reenvases',         label: 'Reenvases' },
  { name: 'KardexAjustes',     label: 'Kardex Ajustes' },
  { name: 'KardexNC',          label: 'Kardex NC' },
  { name: 'RemisionesAnuladas', label: 'Remisiones Anuladas' },
  { name: 'apartados_pedido',  label: 'Apartados Pedido' },
  { name: 'apartados_muestra', label: 'Apartados Muestra' },
  { name: 'TipoDespacho',      label: 'Tipo Despacho' },
  { name: 'TipoDespachoDevCam', label: 'Tipo Despacho Dev-Cambios' },
  { name: 'TipoDespachoMuestra', label: 'Tipo Despacho Muestra' },
  { name: 'consecutivos_remisiones', label: 'Consecutivos Remisiones' },
  { name: 'remisiones_enviadas', label: 'Remisiones Enviadas' },
  { name: 'LegalizacionGastos', label: 'Legalización Gastos' },
  { name: 'LegalizacionGastosItems', label: 'Legalización Items' },
  { name: 'LegalizacionGastosEmpresas', label: 'Legalización Empresas' },
  { name: 'LegalizacionGastosConsecutivoNotas', label: 'Legalización Notas Consec.' },
  { name: 'Vehiculos',         label: 'Vehículos' },
  { name: 'RemisionesExternas', label: 'Remisiones Externas' },
  { name: 'RemisionesExternasItems', label: 'Remisiones Externas Items' },
  { name: 'BitacoraContactoClientes', label: 'Bitácora Contacto Clientes' },
  { name: 'BodegasConsignacion', label: 'Bodegas Consignación' },
  { name: 'solicitudes_mercadeo', label: 'Solicitudes Mercadeo' },
  { name: 'parametros_inventario', label: 'Parámetros Inventario' },
  { name: 'solicitudes_reabastecimiento', label: 'Solicitudes Reabastecimiento' },
  { name: 'Clientes',          label: 'Clientes', sinId: true },
  { name: 'Comerciales',       label: 'Comerciales' },
  { name: 'Productos',         label: 'Productos' },
  { name: 'maestro_productos', label: 'Maestro Productos' },
  { name: 'ClientesUnicos',    label: 'Clientes Únicos' },
  { name: 'ListaPrecios',      label: 'Lista de Precios' },
  { name: 'usuarios',          label: 'Usuarios' },
  { name: 'usuario_empresas',  label: 'Usuario Empresas', sinId: true },
  { name: 'usuario_modulos',   label: 'Usuario Módulos', sinId: true },
  { name: 'empresas',          label: 'Empresas', sinId: true },
  { name: 'notificaciones',    label: 'Notificaciones' },
  { name: 'acceso_reportes',   label: 'Acceso Reportes' },
  { name: 'audit_log',         label: 'Audit Log' },
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

// sinId: tablas sin columna id (no se pueden ordenar por id; todas caben en una página).
// Ordenar por id evita filas repetidas/omitidas al paginar tablas grandes como audit_log.
async function fetchAllRows(tableName, sinId) {
  var allData = [];
  var pageSize = 1000;
  var from = 0;
  while (true) {
    var q = _sb.from(tableName).select('*');
    if (!sinId) q = q.order('id');
    var res = await q.range(from, from + pageSize - 1);
    if (res.error) throw new Error(tableName + ': ' + res.error.message);
    if (!res.data || !res.data.length) break;
    allData = allData.concat(res.data);
    if (res.data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

// Excel no admite objetos en una celda (jsonb de audit_log y solicitudes_mercadeo
// saldrían como "[object Object]") y rechaza textos de más de 32767 caracteres.
function filasParaExcel(data) {
  return data.map(function(row) {
    var out = {};
    Object.keys(row).forEach(function(k) {
      var v = row[k];
      if (v !== null && typeof v === 'object') v = JSON.stringify(v);
      if (typeof v === 'string' && v.length > 32767) v = v.substring(0, 32767);
      out[k] = v;
    });
    return out;
  });
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
      var data = await fetchAllRows(t.name, t.sinId);
      totalRows += data.length;

      if (ct) ct.textContent = data.length + ' registros';
      if (item) { item.className = 'backup-table-item done'; }

      var sheetName = t.label.substring(0, 31);
      var ws = XLSX.utils.json_to_sheet(data.length ? filasParaExcel(data) : [{}]);
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
      errors.map(function(e) { return '• ' + escHtml(e); }).join('<br>') +
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

// Estructura de la base como script SQL. La arma la RPC exportar_estructura_bd
// (solo admin; ver supabase/migrations/exportar_estructura_bd.sql).
async function descargarEstructura() {
  var btn = document.getElementById('btn-estructura');
  var resultEl = document.getElementById('estructura-result');

  btn.disabled = true;
  btn.textContent = 'Generando...';
  resultEl.className = 'backup-result';
  resultEl.style.display = 'none';

  try {
    var res = await _sb.rpc('exportar_estructura_bd');
    if (res.error) throw new Error(res.error.message);
    var sql = res.data || '';
    if (!sql) throw new Error('La base devolvió un script vacío');

    var filename = 'estructura_bd_' + today() + '.sql';
    var blob = new Blob([sql], { type: 'application/sql;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 2000);

    var lineas = sql.split('\n').length;
    var kb = Math.round(blob.size / 1024);
    resultEl.className = 'backup-result success';
    resultEl.textContent = '✅ Estructura descargada: ' + filename + ' — ' + lineas + ' líneas, ' + kb + ' KB.';
  } catch (err) {
    resultEl.className = 'backup-result error';
    resultEl.innerHTML = '⚠️ No se pudo descargar la estructura: ' + escHtml(err.message);
  }

  btn.disabled = false;
  btn.textContent = '🧱 Descargar Estructura (.sql)';
}
