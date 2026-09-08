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
  var r = filteredData[idx];
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

function showAuditTab(tab) {
  var isConsultas = tab === 'consultas';
  document.getElementById('atab-cambios').style.display = isConsultas ? 'none' : 'block';
  document.getElementById('atab-consultas').style.display = isConsultas ? 'block' : 'none';
  document.getElementById('atab-btn-cambios').style.background = isConsultas ? '#718096' : '#1a5276';
  document.getElementById('atab-btn-consultas').style.background = isConsultas ? '#1a5276' : '#718096';
  if (isConsultas && !consultasLoaded) loadConsultas();
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
