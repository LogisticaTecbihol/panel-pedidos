// ── Legalización de gastos: CONCILIACIÓN CONTABLE ──
// Las facturas (o documentos) del sistema contable se registran POR EMPRESA, con su valor y el
// rango de fechas de las legalizaciones que cubren. Lo causado por empresa sale del Prorrateo
// (gasto por producto + su Combustible + su Mantenimiento; ver LegProrrateo.resumenConciliacion);
// lo facturado lo descuenta y queda el pendiente. Lo que ninguna empresa recibe en el Prorrateo
// (Otros, Sin identificar, Combustible/Mantenimiento «Sin reparto asignado») es «Sin empresa» y
// sigue pendiente. Reemplaza al Conciliar / Rechazar de cada legalización.
// Datos: tabla LegalizacionGastosFacturas (supabase/migrations/legalizacion_gastos_facturas.sql).
// Se carga ANTES de legalizacion-gastos.js (que arranca la carga al final de su archivo y ya llama a estas
// funciones) y usa sus globales (legs, empresaPropia, …) solo dentro de funciones, nunca al cargar.

var facturas = [];            // LegalizacionGastosFacturas visibles para el usuario (vigentes y anuladas)
var facturasOk = false;       // false si la tabla no se pudo leer (p. ej. migración sin aplicar)
var facturasError = '';
var prorrateoListo = false;   // true cuando cargaron los mapas de remisiones: sin ellos el reparto por empresa no es confiable
var facEditId = null;         // id de la factura en edición (null = nueva)
var facAnularId = null;
var _concCalcCache = {};      // "desde|hasta" -> resultado de LegProrrateo.calcular (se vacía al cambiar los datos)

// Debe llamarse cada vez que cambian legs / items / reparto / mapas de remisiones.
function concInvalidar() { _concCalcCache = {}; }

// ── Fechas y montos ──
function fmtPesos(v) {
  var n = Math.round(Number(v) || 0);
  return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('es-CO');
}
function _fdia(s) { return String(s || '').slice(0, 10); }
function fmtPeriodo(f) { return fmtDate(_fdia(f.Periodo_Desde)) + ' – ' + fmtDate(_fdia(f.Periodo_Hasta)); }

// ── Cálculo del Prorrateo para un rango de fechas (todas las legalizaciones) ──
// Mismo criterio de «monto de una empresa igual para cualquier usuario»: con prorrateoGrupo (usuarios
// que no ven todo por RLS) se calcula sobre TODAS las legalizaciones; después solo se le muestran sus empresas.
function _concDatos() {
  var g = prorrateoGrupo;
  return {
    legs: g ? g.legs : legs,
    items: g ? g.items : legItems,
    empresas: g ? g.empresas : legEmpresas,
    mapa: prorrateoMapa || remisionProductoMap,
    mapaReparto: prorrateoMapaReparto || remisionProductoMapReparto
  };
}
function concCalc(desde, hasta) {
  var k = (desde || '') + '|' + (hasta || '');
  if (!_concCalcCache[k]) _concCalcCache[k] = LegProrrateo.calcular(_concDatos(), { fEmp: '', fDesde: desde || '', fHasta: hasta || '' });
  return _concCalcCache[k];
}
// Lo causado por una empresa (sigla) en un rango.
function concCausadoEmpresa(sigla, desde, hasta) {
  return LegProrrateo.causadoPorEmpresa(concCalc(desde, hasta))[sigla] || 0;
}

// ¿Ve el usuario TODO el holding? Solo él ve «Sin empresa» y los grupos externos (Tecbihol, Chia Abago, Materias primas).
function concVeTodo() {
  return !empresaPropia && LegProrrateo.empresaVisible(LegProrrateo.EMPRESA_TECBIHOL, typeof AUTH === 'undefined' ? null : AUTH);
}
function _concExtras() {
  return [LegProrrateo.EMPRESA_TECBIHOL, LegProrrateo.EMPRESA_ABAGO, LegProrrateo.EMPRESA_MP].filter(function(x) {
    return LegProrrateo.empresaVisible(x, typeof AUTH === 'undefined' ? null : AUTH);
  });
}

// Resumen por empresa de un período (con las facturas que se pudieron leer).
function concResumen(desde, hasta, solo) {
  return LegProrrateo.resumenConciliacion(concCalc(desde, hasta), facturasOk ? facturas : [], { desde: desde || '', hasta: hasta || '' },
    { visible: _empresaDelUsuario, conSinEmpresa: concVeTodo(), solo: solo || '' });
}
function _concAnalisis() {
  if (!facturasOk || !prorrateoListo) return {};
  return LegProrrateo.analizarFacturas(facturas, concCausadoEmpresa);
}

// ── Carga ──
async function loadFacturas() {
  var res = await apiGet('getLegalizacionFacturas').catch(function(e) { return { ok: false, error: e && e.message }; });
  facturasOk = !!(res && res.ok);
  facturasError = facturasOk ? '' : ((res && res.error) || 'no disponible');
  facturas = facturasOk ? (res.facturas || []) : [];
  return facturasOk;
}

// Los botones que registran o modifican facturas solo los ve quien puede conciliar.
function aplicarPermisosConciliacion() {
  var puede = typeof AUTH !== 'undefined' && AUTH.canConciliarGastos();
  document.querySelectorAll('.lg-solo-conciliar').forEach(function(el) { el.style.display = puede ? '' : 'none'; });
}

// ── Tarjetas de arriba (Facturado / Pendiente / Valor total) ──
// `per` = { desde, hasta }: el período de la pestaña activa (Prorrateo o Conciliación contable; vacío en las demás).
function concActualizarTiles(per) {
  var valorEl = document.getElementById('s-valor');
  if (!valorEl) return;
  var fact = document.getElementById('s-facturado'), factSub = document.getElementById('s-facturado-sub');
  var pend = document.getElementById('s-pendiente'), pendSub = document.getElementById('s-pendiente-sub');
  // Un usuario que no ve todo el holding depende del reparto por empresa, que sin los mapas de remisiones no es confiable.
  if (!prorrateoListo && !concVeTodo()) {
    valorEl.textContent = '…'; fact.textContent = '…'; pend.textContent = '…';
    factSub.textContent = ''; pendSub.textContent = 'calculando el prorrateo…';
    return;
  }
  var r = concResumen(per.desde, per.hasta, '');
  valorEl.textContent = fmtPesos(r.causadoTotal);
  if (!facturasOk) {
    fact.textContent = '—'; pend.textContent = '—';
    factSub.textContent = 'facturas no disponibles'; pendSub.textContent = '';
    return;
  }
  var nFact = r.filas.reduce(function(s, x) { return s + x.nFacturas; }, 0);
  fact.textContent = fmtPesos(r.facturadoTotal);
  factSub.textContent = nFact + (nFact === 1 ? ' factura' : ' facturas') + (r.cruzan.length ? ' · ' + r.cruzan.length + ' cruzan el período' : '');
  pend.textContent = fmtPesos(r.pendienteTotal);
  pendSub.textContent = r.sinEmpresa ? 'incluye ' + fmtPesos(r.sinEmpresa) + ' sin empresa' : '';
}

// ── Tabla «Causado / Facturado / Pendiente por empresa» (la usan Prorrateo y Conciliación contable) ──
function concResumenHtml(r) {
  if (!r.filas.length && !r.sinEmpresa) return '<div class="empty">Sin datos para este período.</div>';
  var tol = LegProrrateo.FACTURA_TOLERANCIA;
  function estadoPend(p, causado) {
    if (p < -tol) return '<span style="color:#c0392b;font-weight:700" title="Lo facturado supera lo causado en el período">⚠ facturado de más</span>';
    if (Math.abs(p) <= tol && causado > 0) return '<span style="color:#1e8449;font-weight:700">✓ conciliado</span>';
    return '';
  }
  var body = r.filas.map(function(f) {
    var pct = f.causado > 0 ? Math.round(f.facturado / f.causado * 1000) / 10 : null;
    return '<tr>' +
      '<td><span class="sigla-badge ' + getSiglaClass(f.emp) + '">' + escHtml(f.emp) + '</span></td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney2(f.causado)) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney2(f.facturado)) + '</td>' +
      '<td style="text-align:right;font-weight:700' + (f.pendiente < -tol ? ';color:#c0392b' : '') + '">' + escHtml(fmtMoney2(f.pendiente)) + '</td>' +
      '<td style="text-align:right">' + (pct === null ? '—' : pct.toLocaleString('es-CO') + '%') + '</td>' +
      '<td style="text-align:right">' + f.nFacturas + '</td>' +
      '<td>' + estadoPend(f.pendiente, f.causado) + '</td>' +
    '</tr>';
  }).join('');
  var sinFila = r.sinEmpresa ? '<tr style="background:#fffaf0">' +
      '<td><span style="color:#718096;font-weight:700">Sin empresa</span></td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney2(r.sinEmpresa)) + '</td>' +
      '<td style="text-align:right;color:#a0aec0">—</td>' +
      '<td style="text-align:right;font-weight:700">' + escHtml(fmtMoney2(r.sinEmpresa)) + '</td>' +
      '<td style="text-align:right;color:#a0aec0">—</td><td style="text-align:right;color:#a0aec0">—</td>' +
      '<td style="color:#7b341e;font-size:0.78rem">Otros, Sin identificar y «Sin reparto asignado»: se asigna reparto a su legalización</td>' +
    '</tr>' : '';
  var totalFila = '<tr style="background:#f7fafc;font-weight:700">' +
      '<td>Total</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney2(r.causadoTotal)) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtMoney2(r.facturadoTotal)) + '</td>' +
      '<td style="text-align:right' + (r.pendienteTotal < -tol ? ';color:#c0392b' : '') + '">' + escHtml(fmtMoney2(r.pendienteTotal)) + '</td>' +
      '<td style="text-align:right">' + (r.causadoTotal > 0 ? (Math.round(r.facturadoTotal / r.causadoTotal * 1000) / 10).toLocaleString('es-CO') + '%' : '—') + '</td>' +
      '<td style="text-align:right">' + r.filas.reduce(function(s, f) { return s + f.nFacturas; }, 0) + '</td><td></td>' +
    '</tr>';
  var aviso = r.cruzan.length
    ? '<div class="hist-aviso" style="margin:12px 20px 0">⚠ ' + r.cruzan.length + (r.cruzan.length === 1 ? ' factura cruza' : ' facturas cruzan') +
      ' el período y no se ' + (r.cruzan.length === 1 ? 'descuenta' : 'descuentan') + ' (su rango no cae completo dentro de Desde / Hasta): ' +
      r.cruzan.map(function(f) { return escHtml(f.Numero_Documento) + ' (' + escHtml(getSigla(f.Empresa)) + ', ' + escHtml(fmtPeriodo(f)) + ')'; }).join('; ') + '.</div>'
    : '';
  var noFact = !facturasOk
    ? '<div class="hist-aviso" style="margin:12px 20px 0">Las facturas no están disponibles todavía' + (facturasError ? ' (' + escHtml(facturasError) + ')' : '') + ': aquí solo se ve lo causado.</div>'
    : '';
  return noFact + aviso + '<div style="overflow-x:auto"><table>' +
    '<thead><tr><th>Empresa</th><th style="text-align:right">Causado</th><th style="text-align:right">Facturado</th>' +
    '<th style="text-align:right">Pendiente</th><th style="text-align:right">% facturado</th><th style="text-align:right">Facturas</th><th></th></tr></thead>' +
    '<tbody>' + body + sinFila + totalFila + '</tbody></table></div>';
}

// Tarjeta de la pestaña Prorrateo (respeta sus filtros Empresa / Desde / Hasta).
function renderConcProrrateo() {
  var box = document.getElementById('gpv-body');
  if (!box) return;
  var desde = document.getElementById('pf-desde').value, hasta = document.getElementById('pf-hasta').value;
  var solo = document.getElementById('pf-emp').value;
  var totEl = document.getElementById('gpv-total');
  if (!prorrateoListo && !concVeTodo()) {
    box.innerHTML = '<div class="empty">Calculando el prorrateo…</div>';
    if (totEl) totEl.textContent = '';
    return;
  }
  var r = concResumen(desde, hasta, solo ? getSigla(solo) : '');
  box.innerHTML = concResumenHtml(r);
  if (totEl) totEl.textContent = facturasOk ? 'Pendiente: ' + fmtMoney2(r.pendienteTotal) : '';
}

// ── Pestaña «Conciliación contable» ──
// Cada fila: { f: factura, a: análisis (causado en su rango, si supera, si el reparto cambió) o null }
function _facFilas() {
  var fEmp = document.getElementById('cf-emp').value;
  var fDesde = document.getElementById('cf-desde').value, fHasta = document.getElementById('cf-hasta').value;
  var fEstado = document.getElementById('cf-estado').value;
  var fTxt = (document.getElementById('cf-txt').value || '').toLowerCase().trim();
  var analisis = _concAnalisis();
  var filas = facturas.filter(function(f) {
    if (fEstado && (f.Estado || 'Vigente') !== fEstado) return false;
    if (fEmp && getSigla(f.Empresa) !== getSigla(fEmp)) return false;
    // Cualquier factura que toque el período (completa dentro o cruzándolo).
    if (fHasta && _fdia(f.Periodo_Desde) > fHasta) return false;
    if (fDesde && _fdia(f.Periodo_Hasta) < fDesde) return false;
    if (fTxt) {
      var hay = [f.Numero_Documento, f.Observacion, f.Motivo_Anulacion, getSigla(f.Empresa), f.creado_por_nombre]
        .map(function(v) { return (v || '').toLowerCase(); }).join(' ');
      if (hay.indexOf(fTxt) < 0) return false;
    }
    return true;
  }).sort(function(a, b) { return _fdia(b.Periodo_Desde).localeCompare(_fdia(a.Periodo_Desde)) || (b.id - a.id); })
    .map(function(f) { return { f: f, a: analisis[f.id] || null, cruza: LegProrrateo.facturaCruza(f, fDesde, fHasta) }; });
  return applySortLg('fac', filas);
}

function _facEstadoTxt(r) {
  if (r.f.Estado === 'Anulada') return 'Anulada';
  var t = ['Vigente'];
  if (r.a && r.a.supera) t.push('supera lo causado');
  if (r.a && r.a.cambio) t.push('el reparto cambió');
  if (r.cruza) t.push('cruza el período');
  return t.join(' · ');
}

function puedeEditarFactura(f) {
  return !!f && f.Estado !== 'Anulada' && AUTH.canConciliarGastos() && _empresaDelUsuario(getSigla(f.Empresa));
}

function renderConciliacion() {
  var body = document.getElementById('fac-body');
  if (!body) return;
  updateStats(); // los indicadores de arriba toman el período de esta pestaña
  var desde = document.getElementById('cf-desde').value, hasta = document.getElementById('cf-hasta').value;
  var solo = document.getElementById('cf-emp').value;

  var aviso = document.getElementById('cf-aviso');
  if (!facturasOk) {
    aviso.style.display = 'block';
    aviso.textContent = 'No se pudieron leer las facturas' + (facturasError ? ' (' + facturasError + ')' : '') + '. Si es la primera vez que se usa, falta aplicar la migración legalizacion_gastos_facturas en la base.';
  } else if (!prorrateoListo) {
    aviso.style.display = 'block';
    aviso.textContent = 'Calculando el prorrateo (remisiones)… las cifras de «causado» todavía no son definitivas.';
  } else {
    aviso.style.display = 'none';
  }

  // Resumen por empresa del período
  var resBox = document.getElementById('cf-resumen-body');
  if (!prorrateoListo && !concVeTodo()) {
    resBox.innerHTML = '<div class="empty">Calculando el prorrateo…</div>';
    document.getElementById('cf-resumen-total').textContent = '';
  } else {
    var r = concResumen(desde, hasta, solo ? getSigla(solo) : '');
    resBox.innerHTML = concResumenHtml(r);
    document.getElementById('cf-resumen-total').textContent = facturasOk ? 'Pendiente: ' + fmtMoney2(r.pendienteTotal) : '';
  }

  // Lista de facturas
  var rows = _facFilas();
  renderSortHead('fac', 'fac-head');
  document.getElementById('cf-ct').textContent = '(' + rows.length + ')';
  body.innerHTML = rows.map(function(r) {
    var f = r.f, a = r.a;
    var anulada = f.Estado === 'Anulada';
    var dif = a ? Number(f.Valor) - a.causado : null;
    var badges = anulada
      ? '<span class="badge b-anulado" title="' + escHtml((f.Motivo_Anulacion || '') + (f.Anulado_Por ? ' — ' + f.Anulado_Por : '') + (f.Fecha_Anulacion ? ' (' + fmtDate(String(f.Fecha_Anulacion).slice(0, 10)) + ')' : '')) + '">🚫 Anulada</span>'
      : '<span class="badge b-ent">✅ Vigente</span>';
    if (!anulada && a && a.supera) badges += ' <span class="badge b-anulado" title="Las facturas vigentes de ' + escHtml(getSigla(f.Empresa)) + ' que se cruzan con esta suman ' + escHtml(fmtPesos(a.grupoFacturado)) + ' y lo causado en el rango que cubren es ' + escHtml(fmtPesos(a.grupoCausado)) + '">⚠ supera lo causado</span>';
    if (!anulada && a && a.cambio) badges += ' <span class="badge b-rec" title="Al registrarla el Prorrateo daba ' + escHtml(fmtPesos(a.alRegistrar)) + ' para esta empresa y rango; hoy da ' + escHtml(fmtPesos(a.causado)) + '">↻ el reparto cambió</span>';
    if (r.cruza) badges += ' <span class="badge b-par" title="Su rango no cae completo dentro de Desde / Hasta, por eso no se descuenta en el resumen de arriba">cruza el período</span>';
    var acciones = '';
    if (puedeEditarFactura(f)) {
      acciones = '<button class="btn-edit" title="Editar" onclick="openFormFactura(' + f.id + ')">✏️</button> ' +
                 '<button class="btn-edit" style="color:#c0392b" title="Anular" onclick="openAnularFactura(' + f.id + ')">🚫</button>';
    }
    return '<tr' + (anulada ? ' style="opacity:.6"' : '') + '>' +
      '<td style="white-space:nowrap"><strong>' + escHtml(f.Numero_Documento || '') + '</strong>' +
        (f.Observacion ? '<div class="ac-sub" style="white-space:normal;max-width:220px">' + escHtml(f.Observacion) + '</div>' : '') + '</td>' +
      '<td><span class="sigla-badge ' + getSiglaClass(f.Empresa) + '">' + escHtml(getSigla(f.Empresa)) + '</span></td>' +
      '<td style="white-space:nowrap">' + escHtml(fmtDate(_fdia(f.Fecha_Documento))) + '</td>' +
      '<td style="white-space:nowrap">' + escHtml(fmtPeriodo(f)) + '</td>' +
      '<td style="text-align:right">' + escHtml(fmtPesos(f.Valor)) + '</td>' +
      '<td style="text-align:right">' + (a ? escHtml(fmtPesos(a.causado)) : '<span style="color:#a0aec0">—</span>') + '</td>' +
      '<td style="text-align:right' + (dif !== null && dif > LegProrrateo.FACTURA_TOLERANCIA ? ';color:#c0392b' : '') + '">' + (dif === null ? '<span style="color:#a0aec0">—</span>' : escHtml(fmtPesos(dif))) + '</td>' +
      '<td>' + badges + '</td>' +
      '<td style="white-space:nowrap">' + escHtml(f.creado_por_nombre || '—') + '<div class="ac-sub">' + escHtml(f.creado_en ? fmtDate(String(f.creado_en).slice(0, 10)) : '') + '</div></td>' +
      '<td style="white-space:nowrap">' + acciones + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="' + _lgColsVisibles('fac').length + '"><div class="empty">' +
    (facturasOk ? 'Sin facturas para este filtro.' : 'Las facturas no están disponibles.') + '</div></td></tr>';
}

function clearConciliacionFiltros() {
  document.getElementById('cf-emp').value = '';
  document.getElementById('cf-desde').value = '';
  document.getElementById('cf-hasta').value = '';
  document.getElementById('cf-estado').value = 'Vigente';
  document.getElementById('cf-txt').value = '';
  renderConciliacion();
}

// Columnas ordenables de la lista (mismo mecanismo que las demás tablas del módulo; legalizacion-gastos.js
// las registra como LG_SORT_COLS.fac).
var LG_COLS_FAC = [
  { id: 'n', label: 'N.º documento', fn: function(r) { return r.f.Numero_Documento || ''; } },
  { id: 'empresa', label: 'Empresa', fn: function(r) { return getSigla(r.f.Empresa); } },
  { id: 'fecha', label: 'Fecha documento', fn: function(r) { return _fdia(r.f.Fecha_Documento); } },
  { id: 'periodo', label: 'Período cubierto', fn: function(r) { return _fdia(r.f.Periodo_Desde) + ' ' + _fdia(r.f.Periodo_Hasta); } },
  { id: 'valor', label: 'Valor facturado', right: true, fn: function(r) { return Number(r.f.Valor) || 0; } },
  { id: 'causado', label: 'Causado en el rango', right: true, fn: function(r) { return r.a ? r.a.causado : null; } },
  { id: 'dif', label: 'Diferencia', right: true, fn: function(r) { return r.a ? Number(r.f.Valor) - r.a.causado : null; } },
  { id: 'estado', label: 'Estado', fn: function(r) { return _facEstadoTxt(r); } },
  { id: 'registro', label: 'Registrada por', fn: function(r) { return r.f.creado_en || ''; } },
  { id: 'acciones', label: 'Acciones' }
];

// Excel de la lista (mismas filas y orden que la pantalla) + hoja con el resumen por empresa del período.
function exportarFacturasExcel() {
  var rows = _facFilas();
  if (!rows.length) { showToast('No hay facturas para exportar', '#e74c3c'); return; }
  var data = rows.map(function(r) {
    var f = r.f, a = r.a;
    return {
      'Empresa': getSigla(f.Empresa),
      'N.º documento': f.Numero_Documento || '',
      'Fecha documento': fmtDate(_fdia(f.Fecha_Documento)),
      'Período desde': fmtDate(_fdia(f.Periodo_Desde)),
      'Período hasta': fmtDate(_fdia(f.Periodo_Hasta)),
      'Valor facturado': Number(f.Valor) || 0,
      'Causado en el rango': a ? Number(a.causado.toFixed(2)) : '',
      'Diferencia': a ? Number((Number(f.Valor) - a.causado).toFixed(2)) : '',
      'Causado al registrar': f.Causado_Al_Registrar != null ? Number(f.Causado_Al_Registrar) : '',
      'Estado': _facEstadoTxt(r),
      'Observación': f.Observacion || '',
      'Motivo anulación': f.Motivo_Anulacion || '',
      'Anulada por': f.Anulado_Por || '',
      'Fecha anulación': f.Fecha_Anulacion ? fmtDate(String(f.Fecha_Anulacion).slice(0, 10)) : '',
      'Registrada por': f.creado_por_nombre || '',
      'Fecha registro': f.creado_en ? fmtDate(String(f.creado_en).slice(0, 10)) : ''
    };
  });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Facturas');
  var hoja = concHojaResumen(document.getElementById('cf-desde').value, document.getElementById('cf-hasta').value, document.getElementById('cf-emp').value);
  if (hoja) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hoja), 'Resumen por empresa');
  XLSX.writeFile(wb, 'conciliacion_contable_' + today() + '.xlsx');
  showToast('Excel exportado');
}

// Filas del resumen por empresa de un período (Excel de Prorrateo y de Conciliación contable). null si no aplica.
function concHojaResumen(desde, hasta, solo) {
  if (!prorrateoListo && !concVeTodo()) return null;
  var r = concResumen(desde, hasta, solo ? getSigla(solo) : '');
  var filas = r.filas.map(function(f) {
    return { 'Empresa': f.emp, 'Causado': Number(f.causado.toFixed(2)), 'Facturado': Number(f.facturado.toFixed(2)), 'Pendiente': Number(f.pendiente.toFixed(2)), 'Facturas': f.nFacturas };
  });
  if (r.sinEmpresa) filas.push({ 'Empresa': 'Sin empresa', 'Causado': Number(r.sinEmpresa.toFixed(2)), 'Facturado': '', 'Pendiente': Number(r.sinEmpresa.toFixed(2)), 'Facturas': '' });
  filas.push({ 'Empresa': 'Total', 'Causado': Number(r.causadoTotal.toFixed(2)), 'Facturado': Number(r.facturadoTotal.toFixed(2)), 'Pendiente': Number(r.pendienteTotal.toFixed(2)), 'Facturas': r.filas.reduce(function(s, f) { return s + f.nFacturas; }, 0) });
  return filas.length > 1 ? filas : null;
}

// ── Formulario: registrar / editar una factura ──
function openFormFactura(id) {
  if (!AUTH.canConciliarGastos()) { showToast('No tienes permiso para registrar facturas de conciliación', '#e67e22'); return; }
  if (!facturasOk) { showToast('Las facturas no están disponibles todavía (falta aplicar la migración en la base)', '#e67e22', 5000); return; }
  facEditId = id || null;
  var f = null;
  if (facEditId) {
    f = facturas.find(function(x) { return x.id === facEditId; });
    if (!f || !puedeEditarFactura(f)) { facEditId = null; showToast('Esta factura no se puede modificar (anulada o de otra empresa)', '#e67e22'); return; }
  }
  var empresas = LegProrrateo.empresasParaFactura(AUTH);
  var selEmp = document.getElementById('fac-empresa');
  var preEmp = f ? f.Empresa : (document.getElementById('cf-emp').value || (empresaPropia ? empresaPropia.nombre : ''));
  selEmp.innerHTML = '<option value="">— Seleccionar —</option>' + empresas.map(function(e) {
    return '<option value="' + escHtml(e.value) + '">' + escHtml(e.sigla) + '</option>';
  }).join('');
  selEmp.value = preEmp;
  if (selEmp.value !== preEmp) selEmp.value = (empresas.find(function(e) { return e.sigla === getSigla(preEmp); }) || {}).value || '';
  document.getElementById('fac-titulo').textContent = f ? 'Editar factura ' + (f.Numero_Documento || '') : 'Registrar factura';
  document.getElementById('fac-numero').value = f ? f.Numero_Documento : '';
  document.getElementById('fac-fecha').value = f ? _fdia(f.Fecha_Documento) : today();
  document.getElementById('fac-desde').value = f ? _fdia(f.Periodo_Desde) : document.getElementById('cf-desde').value;
  document.getElementById('fac-hasta').value = f ? _fdia(f.Periodo_Hasta) : document.getElementById('cf-hasta').value;
  document.getElementById('fac-valor').value = f ? f.Valor : '';
  document.getElementById('fac-obs').value = f ? (f.Observacion || '') : '';
  document.getElementById('fac-btn-guardar').disabled = false;
  recalcFactura();
  document.getElementById('form-fac-overlay').classList.add('show');
}

function closeFormFactura() {
  document.getElementById('form-fac-overlay').classList.remove('show');
  facEditId = null;
}

// Lo que dice el formulario antes de guardar: causado, facturas que se cruzan y pendiente resultante.
// Devuelve el análisis de la factura que se está armando (o null si falta empresa o rango).
function _facAnalisisForm() {
  var emp = document.getElementById('fac-empresa').value;
  var d = document.getElementById('fac-desde').value, h = document.getElementById('fac-hasta').value;
  if (!emp || !d || !h || d > h || !prorrateoListo) return null;
  var valor = Number(document.getElementById('fac-valor').value) || 0;
  var otras = facturas.filter(function(x) { return x.id !== facEditId; });
  var nueva = { id: '__nueva__', Empresa: emp, Periodo_Desde: d, Periodo_Hasta: h, Valor: valor, Estado: 'Vigente' };
  var a = LegProrrateo.analizarFacturas(otras.concat([nueva]), concCausadoEmpresa)['__nueva__'];
  if (!a) return null;
  a.sigla = getSigla(emp);
  a.cruzan = otras.filter(function(x) { return LegProrrateo.facturaVigente(x) && getSigla(x.Empresa) === a.sigla && LegProrrateo.rangosSeCruzan(nueva, x); });
  return a;
}

function recalcFactura() {
  var box = document.getElementById('fac-calculo');
  var emp = document.getElementById('fac-empresa').value;
  var d = document.getElementById('fac-desde').value, h = document.getElementById('fac-hasta').value;
  if (!emp || !d || !h) { box.innerHTML = ''; return; }
  if (d > h) { box.innerHTML = '<div class="hist-aviso hist-aviso-rojo" style="margin:0">⚠ El período «hasta» no puede ser anterior a «desde».</div>'; return; }
  if (!prorrateoListo) {
    box.innerHTML = '<div class="hist-aviso" style="margin:0">Calculando el prorrateo… vuelve a abrir esta ventana en unos segundos para ver lo causado. Se puede guardar igual.</div>';
    return;
  }
  var a = _facAnalisisForm();
  if (!a) { box.innerHTML = ''; return; }
  var valor = Number(document.getElementById('fac-valor').value) || 0;
  var otrasSuma = a.cruzan.reduce(function(s, x) { return s + (Number(x.Valor) || 0); }, 0);
  var pendiente = a.grupoCausado - a.grupoFacturado;
  var sobre = a.supera;
  box.innerHTML = '<div style="padding:10px 14px;background:' + (sobre ? '#fff5f5' : '#eaf4fb') + ';border:1px solid ' + (sobre ? '#feb2b2' : '#aed6f1') + ';border-radius:8px;font-size:0.86rem;line-height:1.6">' +
    'Lo causado por <strong>' + escHtml(a.sigla) + '</strong> del ' + escHtml(fmtDate(d)) + ' al ' + escHtml(fmtDate(h)) + ' según Prorrateo: <strong>' + escHtml(fmtPesos(a.causado)) + '</strong><br>' +
    (a.cruzan.length
      ? 'Otras facturas vigentes de ' + escHtml(a.sigla) + ' que se cruzan con este rango: ' + a.cruzan.map(function(x) { return escHtml(x.Numero_Documento); }).join(', ') +
        ' (' + escHtml(fmtPesos(otrasSuma)) + ')<br>Causado en el rango unido de todas ellas: <strong>' + escHtml(fmtPesos(a.grupoCausado)) + '</strong><br>'
      : '') +
    'Pendiente después de esta factura: <strong' + (sobre ? ' style="color:#c0392b"' : '') + '>' + escHtml(fmtPesos(pendiente)) + '</strong>' +
    (valor <= 0 ? ' <span style="color:#718096">(escribe el valor facturado)</span>' : '') +
    (sobre ? '<div style="color:#c0392b;font-weight:700;margin-top:4px">⚠ Esta factura, junto con las que se cruzan, supera lo causado en ' + escHtml(fmtPesos(-pendiente)) + '. Se puede guardar, pero revisa el período y el valor.</div>' : '') +
  '</div>';
}

async function saveFormFactura() {
  var emp = document.getElementById('fac-empresa').value;
  var numero = document.getElementById('fac-numero').value.trim();
  var fecha = document.getElementById('fac-fecha').value;
  var desde = document.getElementById('fac-desde').value, hasta = document.getElementById('fac-hasta').value;
  var valor = Number(document.getElementById('fac-valor').value);
  var obs = document.getElementById('fac-obs').value.trim();
  if (!emp) { showToast('Elige la empresa', '#e67e22'); return; }
  if (!numero) { showToast('Indica el número de la factura o documento', '#e67e22'); return; }
  if (!desde || !hasta) { showToast('Indica el período que cubre la factura (desde y hasta)', '#e67e22'); return; }
  if (desde > hasta) { showToast('El período «hasta» no puede ser anterior a «desde»', '#e67e22'); return; }
  if (!fecha) { showToast('Indica la fecha del documento', '#e67e22'); return; }
  if (!(valor > 0)) { showToast('Indica el valor facturado (mayor que cero)', '#e67e22'); return; }
  var sigla = getSigla(emp);
  var dup = facturas.find(function(x) {
    return x.id !== facEditId && LegProrrateo.facturaVigente(x) && getSigla(x.Empresa) === sigla &&
      String(x.Numero_Documento || '').trim().toUpperCase() === numero.toUpperCase();
  });
  if (dup) { showToast('Ya hay una factura vigente con el número ' + numero + ' para ' + sigla, '#e67e22'); return; }

  var a = _facAnalisisForm();
  if (a && a.supera && !confirm('Esta factura, junto con las que se cruzan, supera lo causado por ' + sigla + ' en ' + fmtPesos(a.grupoFacturado - a.grupoCausado) + '.\n\n¿Guardarla de todos modos?')) return;
  // Lo causado al registrar: solo si el prorrateo está calculado; al editar sin él se conserva el que ya tenía.
  var causado = a ? Number(a.causado.toFixed(2)) : null;
  if (causado === null && facEditId) {
    var ant = facturas.find(function(x) { return x.id === facEditId; });
    causado = ant ? ant.Causado_Al_Registrar : null;
  }

  var btn = document.getElementById('fac-btn-guardar');
  btn.disabled = true;
  var res = await apiPost({
    action: 'guardarLegalizacionFactura', id: facEditId || undefined,
    Empresa: emp, Numero_Documento: numero, Fecha_Documento: fecha, Periodo_Desde: desde, Periodo_Hasta: hasta,
    Valor: valor, Observacion: obs, Causado_Al_Registrar: causado
  });
  btn.disabled = false;
  if (!res.ok) { showToast('Error: ' + res.error, '#e74c3c', 6000); return; }
  var editando = !!facEditId;
  closeFormFactura();
  showToast(editando ? 'Factura actualizada' : 'Factura registrada', '#27ae60');
  await loadFacturas();
  renderConciliacion();
  renderConcProrrateo();
  updateStats();
}

// ── Anular ──
function openAnularFactura(id) {
  var f = facturas.find(function(x) { return x.id === id; });
  if (!f || !puedeEditarFactura(f)) { showToast('Esta factura no se puede anular (ya está anulada o es de otra empresa)', '#e67e22'); return; }
  facAnularId = id;
  document.getElementById('anular-fac-meta').textContent = f.Numero_Documento + ' · ' + getSigla(f.Empresa) + ' · ' + fmtPesos(f.Valor) + ' · ' + fmtPeriodo(f);
  document.getElementById('anular-fac-motivo').value = '';
  document.getElementById('anular-fac-btn').disabled = false;
  document.getElementById('anular-fac-overlay').classList.add('show');
}
function closeAnularFactura() {
  document.getElementById('anular-fac-overlay').classList.remove('show');
  facAnularId = null;
}
async function doAnularFactura() {
  if (!facAnularId) return;
  var motivo = document.getElementById('anular-fac-motivo').value.trim();
  if (motivo.length < 5) { showToast('Indica el motivo de la anulación (mínimo 5 caracteres)', '#e67e22'); return; }
  var btn = document.getElementById('anular-fac-btn');
  btn.disabled = true;
  var res = await apiPost({ action: 'anularLegalizacionFactura', id: facAnularId, motivo: motivo });
  btn.disabled = false;
  if (!res.ok) { showToast('Error: ' + res.error, '#e74c3c', 6000); return; }
  closeAnularFactura();
  showToast('Factura anulada', '#e67e22');
  await loadFacturas();
  renderConciliacion();
  renderConcProrrateo();
  updateStats();
}
