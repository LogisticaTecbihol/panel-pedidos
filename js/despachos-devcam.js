// ── Despachos de Devoluciones y Cambios: tipo de entrega (Ruta / Envío / Comercial) ──
//
// Una fila por remisión de SALIDA (lo que se entrega al cliente) de Devoluciones
// (Remision_Salida) y de Cambios de Mercancía (Remision_Salida). La remisión es el
// despacho físico: si cubre varias devoluciones/cambios sale una sola fila con sus
// consecutivos juntos. El tipo se guarda en TipoDespachoDevCam (origen, empresa,
// remisión) solo cuando alguien lo cambia; sin fila es 'Ruta'.
// Tipos y colores: DESP_TIPOS / DESP_TIPO_DEFAULT / despTipoCss (shared.js).
// Los datos salen de `devoluciones` (devoluciones.js) y `cambios` (cambios.js).

var despachosDC = [];          // filas visibles (filtradas y ordenadas)
var _ddTipoMap = {};           // clave del despacho → tipo guardado
var sortLevelsDD = [];

var DD_ORIGEN_LABEL = { Devolucion: '🔄 Devolución', Cambio: '🔁 Cambio' };

function _ddKey(d) { return [d.origen || '', (d.empresa || '').trim(), d.remision || ''].join('||'); }
function _ddTipo(d) { return _ddTipoMap[_ddKey(d)] || DESP_TIPO_DEFAULT; }

function _ddCmp(a, b) {
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}

var SORT_COLS_DD = [
  { id:'origen',      label:'Origen',          fn: function(d) { return d.origen; } },
  { id:'empresa',     label:'Empresa',         fn: function(d) { return (getSigla(d.empresa) || '').toLowerCase(); } },
  { id:'consecutivo', label:'Consecutivo',     fn: function(d) { return d.consecutivo || ''; } },
  { id:'remision',    label:'Remisión salida', fn: function(d) { return (d.remision || '').toLowerCase(); } },
  { id:'cliente',     label:'Cliente',         fn: function(d) { return (d.cliente || '').toLowerCase(); } },
  { id:'fecha',       label:'Fecha salida',    fn: function(d) { return d.fecha || ''; } },
  { id:'tipo',        label:'Tipo de entrega', fn: function(d) { return _ddTipo(d).toLowerCase(); } }
];

function toggleSortDD(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevelsDD.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevelsDD.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevelsDD[idx].dir === 'asc') sortLevelsDD[idx].dir = 'desc'; else sortLevelsDD.splice(idx, 1); }
  else { sortLevelsDD.push({ id: id, dir: 'asc' }); }
  renderDespachosDC();
}

function clearSortDD() { sortLevelsDD = []; renderDespachosDC(); }

function applySortDD(rows) {
  var out = rows.slice();
  if (!sortLevelsDD.length) {
    // Sin orden elegido: las salidas más recientes primero.
    return out.sort(function(a, b) { return _ddCmp(b.fecha || '', a.fecha || '') || _ddCmp(b.remision, a.remision); });
  }
  return out.sort(function(a, b) {
    for (var si = 0; si < sortLevelsDD.length; si++) {
      var lvl = sortLevelsDD[si];
      var col = SORT_COLS_DD.filter(function(c) { return c.id === lvl.id; })[0];
      if (!col) continue;
      var cmp = _ddCmp(col.fn(a), col.fn(b));
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function renderDDHeader() {
  var cols = [{ label:'#', id:null, style:'width:30px' }];
  SORT_COLS_DD.forEach(function(c) { cols.push({ label: c.label, id: c.id }); });
  cols.push({ label:'Acción', id:null, style:'width:90px' });

  document.getElementById('dd-head').innerHTML = cols.map(function(col) {
    var style = col.style ? ' style="' + col.style + '"' : '';
    if (!col.id) return '<th' + style + '>' + col.label + '</th>';
    var lvlIdx = sortLevelsDD.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var cls = 'sortable' + (active ? (sortLevelsDD[lvlIdx].dir === 'asc' ? ' sort-asc' : ' sort-desc') : '');
    var badge = sortLevelsDD.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx + 1) + '</span>' : '';
    return '<th class="' + cls + '"' + style + ' title="Clic: ordenar · Shift + clic: quitar del orden" onclick="toggleSortDD(\'' + col.id + '\',event)">' +
      col.label + '<span class="sort-icon"></span>' + badge + '</th>';
  }).join('');

  var btn = document.getElementById('btn-clear-sort-dd');
  if (btn) btn.style.display = sortLevelsDD.length ? 'inline-block' : 'none';
}

// Despachos a partir de las líneas cargadas. `mostrarHistoricos` incluye las líneas
// de cargas históricas (Historico = true), ocultas por defecto como en el resto del módulo.
function _ddConstruir(mostrarHistoricos) {
  var map = {};
  var order = [];
  function agregar(origen, r) {
    var rem = String(r.Remision_Salida || '').trim();
    if (!rem) return;
    if (!mostrarHistoricos && r.Historico) return;
    var key = [origen, (r.Empresa || '').trim(), rem].join('||');
    if (!map[key]) {
      map[key] = {
        origen: origen, empresa: (r.Empresa || '').trim(), remision: rem,
        consecutivos: {}, clientes: {}, fecha: '',
        // Clave para abrir el detalle en su sección (viewDevDetail / viewCamDetail)
        viewKey: origen === 'Devolucion' ? devGroupKey(r) : ((r.Empresa || '') + '||' + (r.Consecutivo || r.id))
      };
      order.push(key);
    }
    var g = map[key];
    if (r.Consecutivo != null && r.Consecutivo !== '') g.consecutivos[String(r.Consecutivo)] = 1;
    if (r.Cliente) g.clientes[r.Cliente] = 1;
    if (!g.fecha && r.Fecha_Salida) g.fecha = String(r.Fecha_Salida).slice(0, 10);
  }
  (devoluciones || []).forEach(function(r) { agregar('Devolucion', r); });
  (cambios || []).forEach(function(r) { agregar('Cambio', r); });
  return order.map(function(k) {
    var g = map[k];
    g.consecutivo = Object.keys(g.consecutivos).sort(_ddCmp).join(', ');
    g.cliente = Object.keys(g.clientes).join(', ');
    return g;
  });
}

async function cargarTiposDespachoDC() {
  try {
    var res = await _fetchAllRows('TipoDespachoDevCam', 'origen,empresa,remision,tipo');
    if (res.error) throw res.error;
    _ddTipoMap = {};
    (res.data || []).forEach(function(r) { _ddTipoMap[_ddKey(r)] = r.tipo; });
  } catch (e) { console.warn('No se pudo cargar el tipo de entrega de devoluciones/cambios:', e); }
}

var _ddEmpresaPoblada = false;

async function abrirDespachosDC() {
  if (!_ddEmpresaPoblada) { populateEmpresaSelect('dd-empresa', 'Todas'); _ddEmpresaPoblada = true; }
  var body = document.getElementById('dd-body');
  if (body && !body.innerHTML) body.innerHTML = '<tr><td colspan="9" class="empty">Cargando despachos…</td></tr>';
  await Promise.all([ensureCambiosLoaded(), cargarTiposDespachoDC()]);
  renderDespachosDC();
}

function clearDespachosDCFilters() {
  ['dd-empresa', 'dd-origen', 'dd-tipo', 'dd-remision', 'dd-txt', 'dd-desde', 'dd-hasta'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('dd-historicos').checked = false;
  renderDespachosDC();
}

function renderDespachosDC() {
  var panel = document.getElementById('tab-despachos');
  if (!panel || panel.style.display === 'none') return;
  try {
    renderDDHeader();
    var empresaEl = document.getElementById('dd-empresa');
    var origenEl = document.getElementById('dd-origen');
    var tipoEl = document.getElementById('dd-tipo');
    var remEl = document.getElementById('dd-remision');
    var txtEl = document.getElementById('dd-txt');
    var empresa = empresaEl.value.trim();
    var origen = origenEl.value;
    var tipoF = tipoEl.value;
    var remF = remEl.value.toLowerCase().trim();
    var txt = txtEl.value.toLowerCase().trim();
    var desde = document.getElementById('dd-desde').value;
    var hasta = document.getElementById('dd-hasta').value;

    var todos = _ddConstruir(document.getElementById('dd-historicos').checked);
    var filtrados = todos.filter(function(d) {
      if (empresa && d.empresa !== empresa) return false;
      if (origen && d.origen !== origen) return false;
      if (tipoF && _ddTipo(d) !== tipoF) return false;
      if (remF && d.remision.toLowerCase().indexOf(remF) < 0) return false;
      if (txt && (d.cliente + ' ' + d.consecutivo).toLowerCase().indexOf(txt) < 0) return false;
      if (desde || hasta) {
        if (!d.fecha) return false;
        if (desde && d.fecha < desde) return false;
        if (hasta && d.fecha > hasta) return false;
      }
      return true;
    });
    despachosDC = applySortDD(filtrados);

    var filtrando = !!(empresa || origen || tipoF || remF || txt || desde || hasta);
    document.getElementById('dd-count').textContent = filtrando
      ? '(' + despachosDC.length + ' de ' + todos.length + ' remisiones)'
      : '(' + despachosDC.length + ' remisiones)';
    [[empresaEl, empresa], [origenEl, origen], [tipoEl, tipoF], [remEl, remF], [txtEl, txt]].forEach(function(p) {
      p[0].style.borderColor = p[1] ? '#16a085' : '#cbd5e0';
      p[0].style.fontWeight = p[1] ? '700' : '400';
    });

    var tbody = document.getElementById('dd-body');
    if (!despachosDC.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No hay despachos con los filtros seleccionados.</td></tr>';
      return;
    }

    var canSetTipo = AUTH.canSetTipoDespacho();
    tbody.innerHTML = despachosDC.map(function(d, i) {
      var tipo = _ddTipo(d);
      var tipoCell = canSetTipo
        ? '<select class="dd-tipo" data-idx="' + i + '" onchange="onDDTipoChange(this)" style="font-size:0.78rem;padding:3px 6px;border-radius:5px;font-weight:600;' + despTipoCss(tipo) + '">' +
            DESP_TIPOS.map(function(t) { return '<option value="' + t + '"' + (t === tipo ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
          '</select>'
        : '<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:0.76rem;font-weight:600;' + despTipoCss(tipo) + '">' + escHtml(tipo) + '</span>';
      var verFn = d.origen === 'Devolucion' ? 'viewDevDetail' : 'viewCamDetail';
      var keyEsc = escHtml(d.viewKey).replace(/&#39;/g, "\\'");
      return '<tr>' +
        '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
        '<td style="font-size:0.82rem;white-space:nowrap">' + DD_ORIGEN_LABEL[d.origen] + '</td>' +
        '<td><span class="sigla-badge ' + getSiglaClass(d.empresa) + '">' + escHtml(getSigla(d.empresa)) + '</span></td>' +
        '<td style="font-size:0.82rem">' + escHtml(d.consecutivo || '—') + '</td>' +
        '<td style="font-size:0.82rem">' + escHtml(d.remision) + '</td>' +
        '<td style="font-size:0.82rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(d.cliente) + '">' + escHtml(d.cliente || '—') + '</td>' +
        '<td style="font-size:0.82rem">' + fmtDate(d.fecha) + '</td>' +
        '<td style="white-space:nowrap">' + tipoCell + '</td>' +
        '<td><button class="btn-edit" onclick="' + verFn + '(\'' + keyEsc + '\')" title="Ver detalle" style="background:#3498db;font-size:0.72rem;padding:4px 8px;border-radius:5px;color:white;border:none;cursor:pointer;font-weight:700">📋 Ver</button></td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    console.error('Error en renderDespachosDC:', err);
    showToast('Error al renderizar despachos: ' + err.message, '#e74c3c');
  }
}

async function onDDTipoChange(el) {
  var d = despachosDC[Number(el.dataset.idx)];
  if (!d) return;
  var nuevo = el.value;
  var key = _ddKey(d);
  var previo = _ddTipoMap[key] || DESP_TIPO_DEFAULT;
  if (nuevo === previo) return;

  el.disabled = true;
  try {
    var res = await _sb.from('TipoDespachoDevCam').upsert({
      origen: d.origen,
      empresa: d.empresa,
      remision: d.remision,
      tipo: nuevo
    }, { onConflict: 'origen,empresa,remision' });
    if (res.error) throw res.error;
    _ddTipoMap[key] = nuevo;
    el.style.cssText += despTipoCss(nuevo);
    showToast('Despacho ' + d.remision + ': ' + nuevo, '#27ae60');
  } catch (e) {
    el.value = previo;
    showToast('Error al guardar el tipo de entrega: ' + (e.message || e), '#e74c3c');
  } finally {
    el.disabled = false;
  }
}

// Excel de la pestaña tal como se ve: mismas filas (filtros), mismo orden y columnas.
function exportDespachosDCExcel() {
  var rows = despachosDC || [];
  if (!rows.length) { showToast('No hay despachos para exportar', '#e74c3c'); return; }
  var data = rows.map(function(d) {
    return {
      'Origen': d.origen === 'Devolucion' ? 'Devolución' : 'Cambio',
      'Empresa': getSigla(d.empresa) || d.empresa || '',
      'Consecutivo': d.consecutivo || '',
      'Remisión salida': d.remision || '',
      'Cliente': d.cliente || '',
      'Fecha salida': d.fecha ? fmtDate(d.fecha) : '',
      'Tipo de entrega': _ddTipo(d)
    };
  });
  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:12},{wch:12},{wch:14},{wch:16},{wch:34},{wch:14},{wch:16}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Despachos');
  XLSX.writeFile(wb, 'Despachos_DevCam_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' remisiones', '#27ae60');
}
