// ── Auditoría Module ──
var auditData = [];
var filteredData = [];
var PAGE_SIZE = 50;
var currentPage = 1;

(async function() {
  await _authReady;

  if (!AUTH.canManageUsers()) {
    document.getElementById('load-zone').innerHTML =
      '<div style="font-size:2.5rem;margin-bottom:12px">🔒</div>' +
      '<h2 style="color:#e74c3c">Acceso restringido</h2>' +
      '<p>Solo los administradores pueden ver el registro de auditoría.</p>';
    return;
  }

  await loadAudit();
})();

async function loadAudit() {
  var loadZone = document.getElementById('load-zone');
  var main = document.getElementById('main');
  loadZone.style.display = '';
  main.style.display = 'none';
  setSyncStatus('syncing', 'Cargando registros de auditoría...');

  try {
    var res = await _sb.from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (res.error) throw new Error(res.error.message);

    auditData = res.data || [];
    populateUserFilter();
    applyFilters();

    loadZone.style.display = 'none';
    main.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. ' + auditData.length + ' registros cargados.');
  } catch (err) {
    setSyncStatus('error', 'Error: ' + err.message);
    var errEl = document.getElementById('load-error');
    errEl.textContent = err.message;
    errEl.style.display = '';
    document.getElementById('btn-retry').style.display = '';
    document.getElementById('load-spinner').style.display = 'none';
  }
}

function populateUserFilter() {
  var sel = document.getElementById('f-usuario');
  var emails = {};
  auditData.forEach(function(r) {
    if (r.usuario_email) emails[r.usuario_email] = true;
  });
  var opts = '<option value="">Todos</option>';
  Object.keys(emails).sort().forEach(function(e) {
    opts += '<option value="' + escHtml(e) + '">' + escHtml(e) + '</option>';
  });
  sel.innerHTML = opts;
}

function applyFilters() {
  var tabla = document.getElementById('f-tabla').value;
  var accion = document.getElementById('f-accion').value;
  var usuario = document.getElementById('f-usuario').value;
  var desde = document.getElementById('f-desde').value;
  var hasta = document.getElementById('f-hasta').value;
  var buscar = document.getElementById('f-buscar').value.toLowerCase().trim();

  filteredData = auditData.filter(function(r) {
    if (tabla && r.tabla !== tabla) return false;
    if (accion && r.accion !== accion) return false;
    if (usuario && r.usuario_email !== usuario) return false;
    if (desde) {
      var rDate = r.created_at.slice(0, 10);
      if (rDate < desde) return false;
    }
    if (hasta) {
      var rDate2 = r.created_at.slice(0, 10);
      if (rDate2 > hasta) return false;
    }
    if (buscar) {
      var haystack = [
        r.tabla, r.accion, r.usuario_email || '',
        String(r.registro_id || ''),
        JSON.stringify(r.datos_antes || ''),
        JSON.stringify(r.datos_despues || '')
      ].join(' ').toLowerCase();
      if (haystack.indexOf(buscar) < 0) return false;
    }
    return true;
  });

  updateStats();
  currentPage = 1;
  renderTable();
}

function clearFilters() {
  document.getElementById('f-tabla').value = '';
  document.getElementById('f-accion').value = '';
  document.getElementById('f-usuario').value = '';
  document.getElementById('f-desde').value = '';
  document.getElementById('f-hasta').value = '';
  document.getElementById('f-buscar').value = '';
  applyFilters();
}

function updateStats() {
  var ins = 0, upd = 0, del = 0;
  filteredData.forEach(function(r) {
    if (r.accion === 'INSERT') ins++;
    else if (r.accion === 'UPDATE') upd++;
    else if (r.accion === 'DELETE') del++;
  });
  document.getElementById('s-total').textContent = filteredData.length;
  document.getElementById('s-inserts').textContent = ins;
  document.getElementById('s-updates').textContent = upd;
  document.getElementById('s-deletes').textContent = del;
}

function renderTable() {
  var start = (currentPage - 1) * PAGE_SIZE;
  var page = filteredData.slice(start, start + PAGE_SIZE);
  var html = '';

  if (!page.length) {
    html = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#718096">No se encontraron registros</td></tr>';
  } else {
    page.forEach(function(r, i) {
      var badgeClass = r.accion === 'INSERT' ? 'badge-insert' : r.accion === 'UPDATE' ? 'badge-update' : 'badge-delete';
      var accionLabel = r.accion === 'INSERT' ? 'Creación' : r.accion === 'UPDATE' ? 'Edición' : 'Eliminación';
      var fecha = formatTimestamp(r.created_at);
      var resumen = buildSummary(r);

      html += '<tr class="audit-row" onclick="showDetail(' + (start + i) + ')">' +
        '<td style="white-space:nowrap;font-size:0.82rem">' + fecha + '</td>' +
        '<td>' + escHtml(r.usuario_email || '—') + '</td>' +
        '<td><span class="' + badgeClass + '">' + accionLabel + '</span></td>' +
        '<td>' + escHtml(r.tabla) + '</td>' +
        '<td style="text-align:center">' + (r.registro_id || '—') + '</td>' +
        '<td style="font-size:0.82rem;color:#4a5568;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + resumen + '</td>' +
        '</tr>';
    });
  }

  document.getElementById('t-body').innerHTML = html;
  document.getElementById('row-ct').textContent = '(' + filteredData.length + ' registros)';
  renderPagination();
}

function renderPagination() {
  var totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
  if (totalPages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }

  var html = '';
  if (currentPage > 1) {
    html += '<button class="btn-dl" onclick="goPage(' + (currentPage - 1) + ')">← Anterior</button>';
  }
  html += '<span style="padding:8px 12px;font-size:0.85rem;color:#4a5568">Página ' + currentPage + ' de ' + totalPages + '</span>';
  if (currentPage < totalPages) {
    html += '<button class="btn-dl" onclick="goPage(' + (currentPage + 1) + ')">Siguiente →</button>';
  }
  document.getElementById('pagination').innerHTML = html;
}

function goPage(p) {
  currentPage = p;
  renderTable();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  if (isNaN(d)) return ts;
  var dd = String(d.getDate()).padStart(2, '0');
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yy = d.getFullYear();
  var hh = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  var ss = String(d.getSeconds()).padStart(2, '0');
  return dd + '/' + mm + '/' + yy + ' ' + hh + ':' + mi + ':' + ss;
}

function buildSummary(r) {
  if (r.accion === 'INSERT' && r.datos_despues) {
    var d = r.datos_despues;
    var parts = [];
    if (d.Producto) parts.push(d.Producto);
    if (d.Cliente) parts.push(d.Cliente);
    if (d.Empresa || d.Nombre_Empresa) parts.push(d.Empresa || d.Nombre_Empresa);
    if (d.Consecutivo) parts.push('Cons: ' + d.Consecutivo);
    if (d.nombre) parts.push(d.nombre);
    if (d.email) parts.push(d.email);
    return parts.length ? escHtml(parts.join(' · ')) : 'Registro creado';
  }
  if (r.accion === 'UPDATE' && r.datos_despues) {
    var keys = Object.keys(r.datos_despues);
    if (!keys.length) return 'Sin cambios';
    return escHtml(keys.join(', '));
  }
  if (r.accion === 'DELETE' && r.datos_antes) {
    var d2 = r.datos_antes;
    var parts2 = [];
    if (d2.Producto) parts2.push(d2.Producto);
    if (d2.Cliente) parts2.push(d2.Cliente);
    if (d2.Consecutivo) parts2.push('Cons: ' + d2.Consecutivo);
    return parts2.length ? escHtml(parts2.join(' · ')) : 'Registro eliminado';
  }
  return '—';
}

function showDetail(idx) {
  openDetail(filteredData[idx]);
}

function openDetail(r) {
  if (!r) return;

  var badgeClass = r.accion === 'INSERT' ? 'badge-insert' : r.accion === 'UPDATE' ? 'badge-update' : 'badge-delete';
  var accionLabel = r.accion === 'INSERT' ? 'Creación' : r.accion === 'UPDATE' ? 'Edición' : 'Eliminación';

  document.getElementById('detail-title').innerHTML = '<span class="' + badgeClass + '">' + accionLabel + '</span> en ' + escHtml(r.tabla);
  document.getElementById('detail-subtitle').textContent =
    formatTimestamp(r.created_at) + ' — ' + (r.usuario_email || 'Sistema') + ' — ID registro: ' + (r.registro_id || '—');

  var html = '';

  if (r.accion === 'INSERT') {
    html += '<h4 style="margin-bottom:8px;color:#27ae60">Datos del registro creado</h4>';
    html += '<div class="json-block">' + formatJsonDiff(r.datos_despues, 'added') + '</div>';
  } else if (r.accion === 'DELETE') {
    html += '<h4 style="margin-bottom:8px;color:#e74c3c">Datos del registro eliminado</h4>';
    html += '<div class="json-block">' + formatJsonDiff(r.datos_antes, 'removed') + '</div>';
  } else if (r.accion === 'UPDATE') {
    html += '<div class="audit-detail-grid">';
    html += '<div><h4>Valores anteriores</h4><div class="json-block">' + formatJsonDiff(r.datos_antes, 'removed') + '</div></div>';
    html += '<div><h4>Valores nuevos</h4><div class="json-block">' + formatJsonDiff(r.datos_despues, 'added') + '</div></div>';
    html += '</div>';
  }

  document.getElementById('detail-body').innerHTML = html;
  document.getElementById('detail-overlay').classList.add('show');
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('show');
}
document.getElementById('detail-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDetail(); });

function formatJsonDiff(obj, type) {
  if (!obj || typeof obj !== 'object') return '<span style="color:#718096">— sin datos —</span>';
  var cls = type === 'added' ? 'diff-added' : 'diff-removed';
  var lines = [];
  Object.keys(obj).forEach(function(k) {
    var val = obj[k];
    if (val === null || val === undefined) val = 'null';
    else if (typeof val === 'object') val = JSON.stringify(val);
    lines.push('<span class="' + cls + '">' + escHtml(k) + '</span>: ' + escHtml(String(val)));
  });
  return lines.join('\n');
}

function exportCSV() {
  if (!filteredData.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var headers = ['Fecha','Usuario','Acción','Tabla','Registro_ID','Datos_Antes','Datos_Después'];
  var rows = [headers.join(',')];

  filteredData.forEach(function(r) {
    rows.push([
      '"' + formatTimestamp(r.created_at) + '"',
      '"' + (r.usuario_email || '') + '"',
      '"' + r.accion + '"',
      '"' + r.tabla + '"',
      r.registro_id || '',
      '"' + JSON.stringify(r.datos_antes || {}).replace(/"/g, '""') + '"',
      '"' + JSON.stringify(r.datos_despues || {}).replace(/"/g, '""') + '"'
    ].join(','));
  });

  var blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'auditoria_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado con ' + filteredData.length + ' registros');
}


// ══════════════════════════════════════════════════════════════
// PESTAÑA: CONSULTAS DE REPORTES
// Quién abrió cada reporte de solo lectura y cuándo (tabla
// acceso_reportes, 1 fila por usuario/reporte/día).
// ══════════════════════════════════════════════════════════════

var consultaData = [];
var consultaFiltered = [];
var consultaPage = 1;
var consultasLoaded = false;

// Etiqueta legible por identificador de reporte.
var REPORTE_LABELS = {
  programacion_planta: 'Programación de planta'
};
function reporteLabel(id) { return REPORTE_LABELS[id] || id || '—'; }

var AUDIT_TABS = ['cambios', 'remision', 'consultas'];

function showAuditTab(tab) {
  AUDIT_TABS.forEach(function(t) {
    document.getElementById('atab-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('atab-btn-' + t).style.background = t === tab ? '#1a5276' : '#718096';
  });
  if (tab === 'consultas' && !consultasLoaded) loadConsultas();
  if (tab === 'remision') document.getElementById('r-q').focus();
}

async function loadConsultas() {
  consultasLoaded = true;
  setSyncStatus('syncing', 'Cargando consultas de reportes...');
  try {
    var res = await _sb.from('acceso_reportes')
      .select('*')
      .order('dia', { ascending: false })
      .order('ultima_hora', { ascending: false })
      .limit(5000);

    if (res.error) throw new Error(res.error.message);

    consultaData = res.data || [];
    populateConsultaUserFilter();
    applyConsultaFilters();
    setSyncStatus('ok', 'Conectado a la nube. ' + consultaData.length + ' consultas registradas.');
  } catch (err) {
    setSyncStatus('error', 'Error al cargar consultas: ' + err.message);
    showToast('Error al cargar consultas: ' + err.message, '#e74c3c');
  }
}

function populateConsultaUserFilter() {
  var sel = document.getElementById('cf-usuario');
  var prev = sel.value;
  var seen = {};
  var opts = '<option value="">Todos</option>';
  consultaData.forEach(function(r) {
    var label = r.usuario_email || r.usuario_nombre;
    if (label && !seen[label]) {
      seen[label] = true;
      opts += '<option value="' + escHtml(label) + '">' + escHtml(label) + '</option>';
    }
  });
  sel.innerHTML = opts;
  sel.value = prev;
}

function applyConsultaFilters() {
  var usuario = document.getElementById('cf-usuario').value;
  var desde = document.getElementById('cf-desde').value;
  var hasta = document.getElementById('cf-hasta').value;

  consultaFiltered = consultaData.filter(function(r) {
    if (usuario && (r.usuario_email || r.usuario_nombre) !== usuario) return false;
    if (desde && r.dia < desde) return false;
    if (hasta && r.dia > hasta) return false;
    return true;
  });

  updateConsultaStats();
  consultaPage = 1;
  renderConsultaTable();
}

function clearConsultaFilters() {
  document.getElementById('cf-usuario').value = '';
  document.getElementById('cf-desde').value = '';
  document.getElementById('cf-hasta').value = '';
  applyConsultaFilters();
}

function updateConsultaStats() {
  var usuarios = {}, dias = {};
  consultaFiltered.forEach(function(r) {
    if (r.usuario_email || r.usuario_nombre) usuarios[r.usuario_email || r.usuario_nombre] = true;
    if (r.dia) dias[r.dia] = true;
  });
  document.getElementById('c-total').textContent = consultaFiltered.length;
  document.getElementById('c-usuarios').textContent = Object.keys(usuarios).length;
  document.getElementById('c-dias').textContent = Object.keys(dias).length;
}

function formatDay(d) {
  if (!d) return '—';
  var p = String(d).slice(0, 10).split('-');
  if (p.length !== 3) return d;
  return p[2] + '/' + p[1] + '/' + p[0];
}

function renderConsultaTable() {
  var start = (consultaPage - 1) * PAGE_SIZE;
  var page = consultaFiltered.slice(start, start + PAGE_SIZE);
  var html = '';

  if (!page.length) {
    html = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#718096">No hay consultas registradas</td></tr>';
  } else {
    page.forEach(function(r) {
      html += '<tr>' +
        '<td style="white-space:nowrap;font-size:0.82rem">' + formatDay(r.dia) + '</td>' +
        '<td style="white-space:nowrap;font-size:0.82rem">' + formatTimestamp(r.primera_hora) + '</td>' +
        '<td style="white-space:nowrap;font-size:0.82rem">' + formatTimestamp(r.ultima_hora) + '</td>' +
        '<td style="text-align:center;font-weight:700">' + (r.veces || 1) + '</td>' +
        '<td>' + escHtml(r.usuario_email || r.usuario_nombre || '—') + '</td>' +
        '<td>' + escHtml(reporteLabel(r.reporte)) + '</td>' +
        '</tr>';
    });
  }

  document.getElementById('c-body').innerHTML = html;
  document.getElementById('c-row-ct').textContent = '(' + consultaFiltered.length + ' registros)';
  renderConsultaPagination();
}

function renderConsultaPagination() {
  var totalPages = Math.ceil(consultaFiltered.length / PAGE_SIZE);
  if (totalPages <= 1) { document.getElementById('c-pagination').innerHTML = ''; return; }

  var html = '';
  if (consultaPage > 1) {
    html += '<button class="btn-dl" onclick="goConsultaPage(' + (consultaPage - 1) + ')">← Anterior</button>';
  }
  html += '<span style="padding:8px 12px;font-size:0.85rem;color:#4a5568">Página ' + consultaPage + ' de ' + totalPages + '</span>';
  if (consultaPage < totalPages) {
    html += '<button class="btn-dl" onclick="goConsultaPage(' + (consultaPage + 1) + ')">Siguiente →</button>';
  }
  document.getElementById('c-pagination').innerHTML = html;
}

function goConsultaPage(p) {
  consultaPage = p;
  renderConsultaTable();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exportConsultasCSV() {
  if (!consultaFiltered.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var headers = ['Día','Primera_consulta','Última_consulta','Veces','Usuario','Reporte'];
  var rows = [headers.join(',')];

  consultaFiltered.forEach(function(r) {
    rows.push([
      '"' + formatDay(r.dia) + '"',
      '"' + formatTimestamp(r.primera_hora) + '"',
      '"' + formatTimestamp(r.ultima_hora) + '"',
      (r.veces || 1),
      '"' + (r.usuario_email || r.usuario_nombre || '') + '"',
      '"' + reporteLabel(r.reporte) + '"'
    ].join(','));
  });

  var blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'consultas_reportes_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado con ' + consultaFiltered.length + ' registros');
}


// ══════════════════════════════════════════════════════════════
// PESTAÑA: HISTORIAL DE REMISIÓN
// Quién creó o modificó una remisión, cuándo, en qué módulo y qué cambió.
// La búsqueda corre en el servidor (RPC get_historial_remision, solo admin):
// busca el número en TODAS las columnas "remision*" del audit_log y trae,
// además, el resto del historial de los mismos registros (menciona = false),
// porque un UPDATE solo guarda las columnas que cambiaron y no repite el
// número de la remisión.
// ══════════════════════════════════════════════════════════════

var REM_TABLA_LABELS = {
  Pedidos: 'Pedidos',
  EntregasPedido: 'Entrega de pedido',
  Ingresos: 'Ingresos',
  OrdenesCompra: 'Órdenes de compra',
  Devoluciones: 'Devoluciones',
  CambiosMercancia: 'Cambios',
  SolicitudMuestras: 'Muestras',
  Reenvases: 'Salidas a producción',
  KardexNC: 'Kardex NC',
  RemisionesAnuladas: 'Remisión anulada',
  RemisionesExternas: 'Remisión externa',
  RemisionesExternasItems: 'Ítem de remisión externa',
  LegalizacionGastos: 'Legalización de gastos',
  apartados_pedido: 'Apartado de pedido',
  apartados_muestra: 'Apartado de muestra'
};
// Campos que, en una creación o eliminación, vale la pena mostrar además de la remisión.
var REM_PREFERIDOS = ['Producto', 'Presentacion', 'Cantidad', 'Cliente', 'Empresa', 'Consecutivo', 'Estado'];
var REM_MAX_LINEAS = 8;

var remData = [];
var remFiltered = [];
var remPage = 1;
var remQuery = '';
var remRe = null;
var remTotal = 0;
var remTruncado = false;
var remSeq = 0;

document.getElementById('r-q').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') buscarRemision();
});

function remTablaLabel(t) { return REM_TABLA_LABELS[t] || t || '—'; }

// Misma regla que el servidor: el número no puede ir pegado a otro carácter
// alfanumérico (0044 no coincide con 00441), sin distinguir mayúsculas.
function remBuildRe(q) {
  var esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^A-Za-z0-9])' + esc + '([^A-Za-z0-9]|$)', 'i');
}

function remIsKey(k) { return /remision/i.test(k) && k !== 'Remision_Id'; }

function remValText(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// Valor acotado y escapado; resalta el número buscado si el campo es una remisión.
function remValHtml(k, v) {
  var s = remValText(v);
  if (s === '') return '<em style="color:#a0aec0">(vacío)</em>';
  var html = escHtml(s.length > 70 ? s.slice(0, 67) + '…' : s);
  if (remIsKey(k) && remRe && remRe.test(s)) return '<span class="rem-hit" title="' + escHtml(s) + '">' + html + '</span>';
  if (s.length > 70) return '<span title="' + escHtml(s) + '">' + html + '</span>';
  return html;
}

// Pedidos.Remisiones es una lista "num|cant|fecha,num|cant|fecha": se muestra
// qué entrada se agregó (＋) o se quitó (－) en vez de las dos listas completas.
function remSplitList(v) {
  return remValText(v).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

function remEntryHtml(x) {
  var p = x.split('|');
  var label = (p[0] || '(sin número)') + (p.length > 1 ? ' · cant. ' + p[1] : '') + (p.length > 2 ? ' · ' + p[2] : '');
  var h = escHtml(label);
  return remRe && remRe.test(p[0]) ? '<span class="rem-hit">' + h + '</span>' : h;
}

function remListDiffHtml(antes, despues) {
  var a = remSplitList(antes);
  var d = remSplitList(despues);
  var parts = [];
  d.filter(function(x) { return a.indexOf(x) < 0; }).forEach(function(x) {
    parts.push('<span class="diff-added">＋</span> ' + remEntryHtml(x));
  });
  a.filter(function(x) { return d.indexOf(x) < 0; }).forEach(function(x) {
    parts.push('<span class="diff-removed">－</span> ' + remEntryHtml(x));
  });
  return parts.length ? parts.join('<br>') : '<span style="color:#718096">sin cambios en la lista</span>';
}

// Celda "Qué cambió": en una edición, campo: antes → después; en una creación o
// eliminación, la(s) remisión(es) del registro y sus datos principales.
function remCambioHtml(r) {
  var lines = [];
  if (r.accion === 'UPDATE') {
    var antes = r.datos_antes || {};
    var despues = r.datos_despues || {};
    Object.keys(despues).forEach(function(k) {
      if (k === 'Remisiones') {
        lines.push('<span class="k">' + escHtml(k) + '</span>:<br>' + remListDiffHtml(antes[k], despues[k]));
      } else {
        lines.push('<span class="k">' + escHtml(k) + '</span>: <span class="diff-removed">' + remValHtml(k, antes[k]) +
          '</span> → <span class="diff-added">' + remValHtml(k, despues[k]) + '</span>');
      }
    });
    if (!lines.length) lines.push('<span style="color:#718096">Sin cambios</span>');
  } else {
    var snap = (r.accion === 'DELETE' ? r.datos_antes : r.datos_despues) || {};
    var show = Object.keys(snap).filter(function(k) { return remIsKey(k) && remValText(snap[k]) !== ''; });
    REM_PREFERIDOS.forEach(function(k) {
      if (remValText(snap[k]) !== '' && show.indexOf(k) < 0) show.push(k);
    });
    show.forEach(function(k) {
      lines.push('<span class="k">' + escHtml(k) + '</span>: ' + remValHtml(k, snap[k]));
    });
    if (!lines.length) lines.push('<span style="color:#718096">' + (r.accion === 'DELETE' ? 'Registro eliminado' : 'Registro creado') + '</span>');
  }
  if (lines.length > REM_MAX_LINEAS) {
    var extra = lines.length - REM_MAX_LINEAS;
    lines = lines.slice(0, REM_MAX_LINEAS);
    lines.push('<span style="color:#718096">… y ' + extra + ' campo' + (extra === 1 ? '' : 's') + ' más (clic para ver todo)</span>');
  }
  return '<div class="rem-cambio">' + lines.join('<br>') + '</div>';
}

function remUsuarioHtml(r) {
  if (r.usuario_nombre) {
    return '<strong>' + escHtml(r.usuario_nombre) + '</strong>' +
      (r.usuario_email ? '<br><span style="font-size:0.76rem;color:#718096">' + escHtml(r.usuario_email) + '</span>' : '');
  }
  return escHtml(r.usuario_email || 'Sistema');
}

async function buscarRemision() {
  var q = document.getElementById('r-q').value.trim();
  if (q.length < 3) { showToast('Escriba al menos 3 caracteres del número de remisión', '#e74c3c'); return; }

  var seq = ++remSeq;
  document.getElementById('r-body').innerHTML =
    '<tr><td colspan="6" style="text-align:center;padding:32px;color:#718096">Buscando el historial de «' + escHtml(q) + '»…</td></tr>';
  document.getElementById('r-pagination').innerHTML = '';
  setSyncStatus('syncing', 'Buscando el historial de la remisión ' + q + '...');

  try {
    var res = await _sb.rpc('get_historial_remision', { p_remision: q });
    if (seq !== remSeq) return;   // llegó una búsqueda más nueva
    if (res.error) throw new Error(res.error.message);

    var out = res.data || {};
    remQuery = q;
    remRe = remBuildRe(q);
    remTotal = out.total || 0;
    remTruncado = !!out.truncado;
    // El servidor responde de lo más reciente a lo más antiguo; aquí se lee como historia.
    remData = (out.filas || []).slice().reverse();
    applyRemFilters();
    setSyncStatus('ok', 'Conectado a la nube. ' + remData.length + ' movimientos para la remisión ' + q + '.');
  } catch (err) {
    if (seq !== remSeq) return;
    remData = [];
    remQuery = '';
    remRe = null;
    applyRemFilters();
    setSyncStatus('error', 'Error al buscar la remisión: ' + err.message);
    showToast('Error al buscar la remisión: ' + err.message, '#e74c3c');
  }
}

function clearRemision() {
  remSeq++;
  document.getElementById('r-q').value = '';
  document.getElementById('r-solo-menciona').checked = false;
  remData = [];
  remQuery = '';
  remRe = null;
  remTotal = 0;
  remTruncado = false;
  applyRemFilters();
  document.getElementById('r-q').focus();
}

function applyRemFilters() {
  var solo = document.getElementById('r-solo-menciona').checked;
  remFiltered = remData.filter(function(r) { return !solo || r.menciona; });
  updateRemStats();
  remPage = 1;
  renderRemTable();
}

function updateRemStats() {
  var menciona = 0, usuarios = {}, modulos = {};
  remFiltered.forEach(function(r) {
    if (r.menciona) menciona++;
    usuarios[r.usuario_email || r.usuario_nombre || 'Sistema'] = true;
    modulos[r.tabla] = true;
  });
  document.getElementById('r-total').textContent = remFiltered.length;
  document.getElementById('r-menciona').textContent = menciona;
  document.getElementById('r-usuarios').textContent = Object.keys(usuarios).length;
  document.getElementById('r-modulos').textContent = Object.keys(modulos).length;

  var aviso = document.getElementById('r-aviso');
  if (remTruncado) {
    aviso.textContent = 'Hay ' + remTotal + ' movimientos para esta búsqueda; se muestran solo los ' + remData.length +
      ' más recientes. Escriba el número completo de la remisión para acotarla.';
    aviso.style.display = '';
  } else {
    aviso.style.display = 'none';
  }
}

function renderRemTable() {
  var start = (remPage - 1) * PAGE_SIZE;
  var page = remFiltered.slice(start, start + PAGE_SIZE);
  var html = '';

  if (!page.length) {
    var msg = remQuery
      ? 'No se encontró ninguna remisión «' + escHtml(remQuery) + '» en el registro de auditoría. Revise que el número esté completo; las remisiones emitidas antes de activarse la auditoría no tienen historial.'
      : 'Escriba un número de remisión y pulse Buscar.';
    html = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#718096">' + msg + '</td></tr>';
  } else {
    page.forEach(function(r, i) {
      var badgeClass = r.accion === 'INSERT' ? 'badge-insert' : r.accion === 'UPDATE' ? 'badge-update' : 'badge-delete';
      var accionLabel = r.accion === 'INSERT' ? 'Creación' : r.accion === 'UPDATE' ? 'Edición' : 'Eliminación';
      html += '<tr class="audit-row' + (r.menciona ? '' : ' rem-otro') + '" onclick="showRemDetail(' + (start + i) + ')">' +
        '<td style="white-space:nowrap;font-size:0.82rem">' + formatTimestamp(r.created_at) + '</td>' +
        '<td>' + remUsuarioHtml(r) + '</td>' +
        '<td><span class="' + badgeClass + '">' + accionLabel + '</span></td>' +
        '<td>' + escHtml(remTablaLabel(r.tabla)) +
          '<br><span style="font-size:0.74rem;color:#a0aec0">ID ' + escHtml(String(r.registro_id || '—')) + '</span></td>' +
        '<td>' + remCambioHtml(r) + '</td>' +
        '<td>' + (r.menciona
          ? '<span class="badge-menciona">Menciona</span>'
          : '<span class="badge-otro">Mismo registro</span>') + '</td>' +
        '</tr>';
    });
  }

  document.getElementById('r-body').innerHTML = html;
  document.getElementById('r-row-ct').textContent = remQuery ? '(' + remFiltered.length + ' movimientos de «' + remQuery + '»)' : '';
  renderRemPagination();
}

function renderRemPagination() {
  var totalPages = Math.ceil(remFiltered.length / PAGE_SIZE);
  if (totalPages <= 1) { document.getElementById('r-pagination').innerHTML = ''; return; }

  var html = '';
  if (remPage > 1) {
    html += '<button class="btn-dl" onclick="goRemPage(' + (remPage - 1) + ')">← Anterior</button>';
  }
  html += '<span style="padding:8px 12px;font-size:0.85rem;color:#4a5568">Página ' + remPage + ' de ' + totalPages + '</span>';
  if (remPage < totalPages) {
    html += '<button class="btn-dl" onclick="goRemPage(' + (remPage + 1) + ')">Siguiente →</button>';
  }
  document.getElementById('r-pagination').innerHTML = html;
}

function goRemPage(p) {
  remPage = p;
  renderRemTable();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showRemDetail(idx) {
  openDetail(remFiltered[idx]);
}

function exportRemisionCSV() {
  if (!remFiltered.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  function cell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }

  var headers = ['Fecha','Usuario','Email','Acción','Módulo','Registro_ID','Relación','Campos_modificados','Datos_Antes','Datos_Después'];
  var rows = [headers.join(',')];

  remFiltered.forEach(function(r) {
    rows.push([
      cell(formatTimestamp(r.created_at)),
      cell(r.usuario_nombre || ''),
      cell(r.usuario_email || ''),
      cell(r.accion === 'INSERT' ? 'Creación' : r.accion === 'UPDATE' ? 'Edición' : 'Eliminación'),
      cell(remTablaLabel(r.tabla)),
      cell(r.registro_id || ''),
      cell(r.menciona ? 'Menciona la remisión' : 'Mismo registro'),
      cell(r.accion === 'UPDATE' ? Object.keys(r.datos_despues || {}).join(', ') : ''),
      cell(JSON.stringify(r.datos_antes || {})),
      cell(JSON.stringify(r.datos_despues || {}))
    ].join(','));
  });

  var blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'historial_remision_' + remQuery.replace(/[^A-Za-z0-9_-]/g, '') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado con ' + remFiltered.length + ' movimientos');
}
