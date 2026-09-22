// ══════════════════════════════════════════════════════════════
// CRM de Mercadeo — Leads + Actividades + Presupuesto + Indicadores
// ══════════════════════════════════════════════════════════════
// Leads: ciclo de vida del manual MKT-P-10 — captura -> calificación ->
// asignación a un comercial (48h) -> seguimiento -> cierre (Convertido /
// Perdido / Cierre automático a 90 días sin movimiento, vía cron en la BD:
// función cerrar_leads_inactivos()).
//
// Actividades: eventos/digital/POP/trade con presupuesto y responsable;
// Leads.Actividad_Id vincula opcionalmente un lead a la actividad que lo
// generó (usado para "leads generados" y el indicador de anticipación).
//
// Presupuesto: PresupuestoMercadeo (cabecera por empresa/rubro/periodo) +
// PresupuestoMercadeoGastos (detalle ejecutado, opcionalmente ligado a una
// actividad); lo ejecutado se suma siempre en el cliente, nunca se duplica.
//
// Indicadores: KPIs 100% calculados en cliente sobre lo ya cargado.
//
// Tablas independientes de ClientesUnicos/SolicitudMuestras/Pedidos por
// decisión explícita del proyecto (sin vinculación por ahora).
//
// RLS: admin/editor/mercadeo ven y gestionan todo. Comercial solo ve/gestiona
// los leads que tiene asignados (o que él mismo creó), solo LEE actividades
// (no las administra), y no tiene acceso alguno a Presupuesto (la pestaña se
// oculta para ese rol).

var CRM_CALIF_COLOR = { Caliente: '#c0392b', Tibio: '#d97706', Frio: '#2563eb' };
var CRM_ESTADO_COLOR = {
  'Nuevo': '#718096', 'Calificado': '#7c3aed', 'Asignado': '#2563eb',
  'En seguimiento': '#0891b2', 'Cerrado': '#15803d'
};

var crmLeads = [];
var crmSeguimientos = [];
var crmActividades = [];
var crmPresupuesto = [];
var crmGastos = [];
var crmByLeadId = {};
var crmSeguimientosPorLead = {};
var crmActividadesById = {};
var crmPresupuestoById = {};
var crmGastosPorPresupuesto = {};
var crmDirectorio = [];        // usuarios (de list_usuarios_directorio)
var crmComerciales = [];       // solo rol=comercial, activos
var crmActivos = [];           // todos los usuarios activos (para Responsable de actividad)
var crmCtxId = null;           // lead abierto en el panel de detalle
var crmCierreKind = null;      // 'Convertido' | 'Perdido'
var crmTab = 'leads';          // 'leads' | 'actividades' | 'presupuesto' | 'indicadores'
var crmActividadEditId = null;
var crmPresupuestoEditId = null;
var crmPresupuestoDetalleId = null;

var CRM_TIPO_ACTIVIDAD_COLOR = { Eventos: '#c2410c', Digital: '#2563eb', POP: '#7c3aed', Trade: '#0891b2', 'Diseño': '#be185d', Otro: '#718096' };
var CRM_ESTADO_ACTIVIDAD_COLOR = { 'Planificada': '#718096', 'En ejecucion': '#2563eb', 'Cerrada': '#15803d', 'Cancelada': '#c0392b' };

// ── Helpers ──────────────────────────────────────────────────
function crmEsComercial() {
  var p = typeof AUTH !== 'undefined' && AUTH.getProfile ? AUTH.getProfile() : null;
  return !!(p && p.rol === 'comercial');
}
function crmMiUid() {
  var u = typeof AUTH !== 'undefined' && AUTH.getUser ? AUTH.getUser() : null;
  return u ? u.id : null;
}
function crmNombreUsuario(id) {
  if (!id) return null;
  var u = crmDirectorio.filter(function(d) { return d.id === id; })[0];
  return u ? (u.nombre || u.email) : null;
}
function crmBadge(txt, color) {
  return '<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.74rem;font-weight:700;color:#fff;background:' + color + '">' + escHtml(txt) + '</span>';
}
function crmEstadoBadge(l) { return crmBadge(l.Estado, CRM_ESTADO_COLOR[l.Estado] || '#718096'); }
function crmCalifBadge(l) { return l.Calificacion ? crmBadge(l.Calificacion === 'Frio' ? 'Frío' : l.Calificacion, CRM_CALIF_COLOR[l.Calificacion] || '#718096') : '<span class="tag-sin">sin calificar</span>'; }

// Horas hábiles aproximadas (simplificado a horas corridas) desde la
// calificación (o la captura, si no se ha calificado) hasta ahora.
function crmHorasSinAsignar(l) {
  if (l.Asignado_A || l.Estado === 'Cerrado') return null;
  var desde = l.Fecha_Calificacion || l.creado_en;
  if (!desde) return null;
  var ms = Date.now() - new Date(desde).getTime();
  if (isNaN(ms)) return null;
  return ms / 3600000;
}
function crmVencido48h(l) {
  var h = crmHorasSinAsignar(l);
  return h != null && h > 48;
}
function crmKv(k, v) { return '<div class="car-kv"><span>' + k + '</span><span>' + v + '</span></div>'; }

// ── Carga ────────────────────────────────────────────────────
async function loadCRM() {
  await _authReady;
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
    var results = await Promise.all([
      apiGet('getLeads'),
      apiGet('getLeadsSeguimiento'),
      apiGet('getActividadesMercadeo'),
      apiGet('getPresupuestoMercadeo'),
      apiGet('getPresupuestoMercadeoGastos'),
      (typeof NOTIF !== 'undefined' && NOTIF.getDirectorio) ? NOTIF.getDirectorio() : Promise.resolve([])
    ]);
    if (!results[0].ok) throw new Error(results[0].error || 'Error al cargar leads');
    if (!results[1].ok) throw new Error(results[1].error || 'Error al cargar seguimientos');
    if (!results[2].ok) throw new Error(results[2].error || 'Error al cargar actividades');
    // Presupuesto/Gastos: RLS los deja vacíos (no error) para comercial; solo se
    // trata como error real si el rol que sí debería verlos no los pudo cargar.
    if (!results[3].ok && !crmEsComercial()) throw new Error(results[3].error || 'Error al cargar el presupuesto');
    if (!results[4].ok && !crmEsComercial()) throw new Error(results[4].error || 'Error al cargar los gastos');

    crmLeads = results[0].leads || [];
    crmSeguimientos = results[1].seguimientos || [];
    crmActividades = results[2].actividades || [];
    crmPresupuesto = results[3].presupuesto || [];
    crmGastos = results[4].gastos || [];
    crmDirectorio = results[5] || [];
    crmComerciales = crmDirectorio.filter(function(u) { return u.rol === 'comercial' && u.activo; });
    crmActivos = crmDirectorio.filter(function(u) { return u.activo; });

    crmByLeadId = {};
    crmLeads.forEach(function(l) { crmByLeadId[l.id] = l; });
    crmSeguimientosPorLead = {};
    crmSeguimientos.forEach(function(s) {
      (crmSeguimientosPorLead[s.Lead_Id] = crmSeguimientosPorLead[s.Lead_Id] || []).push(s);
    });
    Object.keys(crmSeguimientosPorLead).forEach(function(k) {
      crmSeguimientosPorLead[k].sort(function(a, b) { return String(b.Fecha).localeCompare(String(a.Fecha)); });
    });
    crmActividadesById = {};
    crmActividades.forEach(function(a) { crmActividadesById[a.id] = a; });
    crmPresupuestoById = {};
    crmPresupuesto.forEach(function(p) { crmPresupuestoById[p.id] = p; });
    crmGastosPorPresupuesto = {};
    crmGastos.forEach(function(g) {
      (crmGastosPorPresupuesto[g.Presupuesto_Id] = crmGastosPorPresupuesto[g.Presupuesto_Id] || []).push(g);
    });

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Datos actualizados ' + new Date().toLocaleTimeString('es-CO'));
    crmFillAsignadoSelects();
    crmAplicarVisibilidadPorRol();
    crmRender();
    crmRenderActividades();
    crmRenderPresupuesto();
    crmRenderIndicadores();
    crmSwitchTab(crmTab);
    if (crmCtxId) {
      if (crmByLeadId[crmCtxId]) crmRenderCtx(); else crmCloseCtx();
    }
    if (typeof applyDeepLinkFilters === 'function') applyDeepLinkFilters();
  } catch (err) {
    if (mainEl.style.display === 'block') {
      setSyncStatus('error', 'Error al actualizar: ' + err.message);
    } else {
      spinnerEl.style.display = 'none';
      errEl.textContent = 'Error: ' + err.message;
      errEl.style.display = 'block';
      retryBtn.style.display = 'inline-block';
    }
  }
}

function crmFillAsignadoSelects() {
  var opts = crmComerciales.map(function(u) {
    return '<option value="' + escHtml(u.id) + '">' + escHtml(u.nombre || u.email) + '</option>';
  }).join('');
  var fSel = document.getElementById('f-asig');
  var actual = fSel.value;
  fSel.innerHTML = '<option value="">Todos</option>' + opts;
  fSel.value = actual;
  var nvSel = document.getElementById('nv-asignado');
  nvSel.innerHTML = '<option value="">Sin asignar todavía</option>' + opts;

  var actOpts = crmActividades.slice().sort(function(a, b) { return String(a.Nombre).localeCompare(String(b.Nombre)); }).map(function(a) {
    return '<option value="' + a.id + '">' + escHtml(a.Nombre) + '</option>';
  }).join('');
  var nvAct = document.getElementById('nv-actividad');
  nvAct.innerHTML = '<option value="">Sin actividad vinculada</option>' + actOpts;

  var respOpts = crmActivos.map(function(u) {
    return '<option value="' + escHtml(u.id) + '">' + escHtml(u.nombre || u.email) + '</option>';
  }).join('');
  document.getElementById('ac-responsable').innerHTML = '<option value="">Sin asignar</option>' + respOpts;

  var empOpts = EMPRESAS_HOLDING.map(function(e) { return '<option value="' + e.sigla + '">' + e.sigla + '</option>'; }).join('');
  var fpEmp = document.getElementById('fp-empresa');
  var fpEmpActual = fpEmp.value;
  fpEmp.innerHTML = '<option value="">Todas</option>' + empOpts;
  fpEmp.value = fpEmpActual;
  document.getElementById('pr-empresa').innerHTML = empOpts;
}

// Comercial no gestiona ni ve Presupuesto (RLS lo deja fuera por completo).
function crmAplicarVisibilidadPorRol() {
  var oculto = crmEsComercial();
  document.getElementById('tab-presupuesto').style.display = oculto ? 'none' : '';
  if (oculto && crmTab === 'presupuesto') crmTab = 'leads';
}

// ── Pestañas ─────────────────────────────────────────────────
function crmSwitchTab(t) {
  crmTab = t;
  document.getElementById('tab-leads').classList.toggle('active', t === 'leads');
  document.getElementById('tab-actividades').classList.toggle('active', t === 'actividades');
  document.getElementById('tab-presupuesto').classList.toggle('active', t === 'presupuesto');
  document.getElementById('tab-indicadores').classList.toggle('active', t === 'indicadores');
  document.getElementById('panel-leads').style.display = t === 'leads' ? 'block' : 'none';
  document.getElementById('panel-actividades').style.display = t === 'actividades' ? 'block' : 'none';
  document.getElementById('panel-presupuesto').style.display = t === 'presupuesto' ? 'block' : 'none';
  document.getElementById('panel-indicadores').style.display = t === 'indicadores' ? 'block' : 'none';
}

// ── Filtros y render principal ───────────────────────────────
function crmClearFilters() {
  ['f-estado', 'f-origen', 'f-calif', 'f-asig'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('f-txt').value = '';
  crmRender();
}

function crmFiltrar(list) {
  var est = document.getElementById('f-estado').value;
  var ori = document.getElementById('f-origen').value;
  var cal = document.getElementById('f-calif').value;
  var asig = document.getElementById('f-asig').value;
  var q = norm(document.getElementById('f-txt').value);
  return list.filter(function(l) {
    if (est && l.Estado !== est) return false;
    if (ori && l.Origen !== ori) return false;
    if (cal && l.Calificacion !== cal) return false;
    if (asig && l.Asignado_A !== asig) return false;
    if (q) {
      var hay = norm([l.Nombre_Contacto, l.Empresa_Contacto, l.Producto_Interes, l.Municipio].join(' '));
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

function crmRender() {
  crmRenderStats();
  var lista = crmFiltrar(crmLeads).slice().sort(function(a, b) { return (b.id || 0) - (a.id || 0); });

  document.getElementById('leads-ct').textContent = '(' + lista.length + (lista.length !== crmLeads.length ? ' de ' + crmLeads.length : '') + ')';

  if (!lista.length) {
    document.getElementById('leads-body').innerHTML = '<tr><td colspan="9" style="text-align:center;color:#a0aec0;padding:26px">' +
      (crmLeads.length ? 'Ningún lead coincide con los filtros.' : 'Aún no hay leads registrados.') + '</td></tr>';
    return;
  }

  document.getElementById('leads-body').innerHTML = lista.map(function(l) {
    var venc = crmVencido48h(l);
    return '<tr style="cursor:pointer" onclick="crmOpenCtx(' + l.id + ')">' +
      '<td><strong>' + escHtml(l.Nombre_Contacto || '—') + '</strong>' + (l.Empresa_Contacto ? '<div style="color:#a0aec0;font-size:0.78rem">' + escHtml(l.Empresa_Contacto) + '</div>' : '') + '</td>' +
      '<td>' + escHtml(l.Producto_Interes || '—') + '</td>' +
      '<td>' + escHtml(l.Origen || '—') + '</td>' +
      '<td>' + crmCalifBadge(l) + '</td>' +
      '<td>' + crmEstadoBadge(l) + (venc ? '<div style="color:#c0392b;font-size:0.72rem;font-weight:700;margin-top:2px">⚠ &gt;48h sin asignar</div>' : '') + '</td>' +
      '<td>' + escHtml(crmNombreUsuario(l.Asignado_A) || '—') + '</td>' +
      '<td>' + escHtml(fmtDate(l.Fecha_Captura)) + '</td>' +
      '<td>' + (l.Fecha_Ultima_Interaccion ? escHtml(_fmtAudTs(l.Fecha_Ultima_Interaccion)) : '—') + '</td>' +
      '<td><button class="btn-ver" onclick="event.stopPropagation();crmOpenCtx(' + l.id + ')">Ver</button></td>' +
    '</tr>';
  }).join('');
}

function crmRenderStats() {
  var mesActual = today().slice(0, 7);
  var nuevos = crmLeads.filter(function(l) { return String(l.Fecha_Captura || '').slice(0, 7) === mesActual; });
  document.getElementById('s-nuevos').textContent = nuevos.length;

  var vencidos = crmLeads.filter(crmVencido48h);
  document.getElementById('s-vencidos').textContent = vencidos.length;

  var seguimiento = crmLeads.filter(function(l) { return l.Estado === 'En seguimiento'; });
  document.getElementById('s-seguimiento').textContent = seguimiento.length;

  var lim = Date.now() - 90 * 86400000;
  var asignados90 = crmLeads.filter(function(l) { return l.Fecha_Asignacion && new Date(l.Fecha_Asignacion).getTime() >= lim; });
  var convertidos90 = asignados90.filter(function(l) { return l.Resultado_Cierre === 'Convertido'; });
  if (asignados90.length) {
    document.getElementById('s-conversion').textContent = Math.round(convertidos90.length / asignados90.length * 100) + '%';
    document.getElementById('s-conversion-det').textContent = convertidos90.length + ' de ' + asignados90.length + ' leads asignados';
  } else {
    document.getElementById('s-conversion').textContent = '—';
    document.getElementById('s-conversion-det').textContent = 'sin leads asignados en 90 días';
  }
}

// ── Actividades de mercadeo ───────────────────────────────────
var EMPRESAS_MERCADEO = EMPRESAS_HOLDING; // las 5 empresas comerciales del holding (sin GRANEL)

function crmEmpresasChecksHtml(seleccionadas) {
  var sel = (seleccionadas || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  return EMPRESAS_MERCADEO.map(function(e) {
    return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer">' +
      '<input type="checkbox" class="ac-emp-chk" value="' + escHtml(e.sigla) + '" ' + (sel.indexOf(e.sigla) >= 0 ? 'checked' : '') + '> ' + escHtml(e.sigla) +
    '</label>';
  }).join('');
}
function crmEmpresasChecksLeer() {
  return [].slice.call(document.querySelectorAll('.ac-emp-chk:checked')).map(function(c) { return c.value; }).join(', ');
}

function crmLeadsGeneradosPorActividad(actId) {
  return crmLeads.filter(function(l) { return l.Actividad_Id === actId; }).length;
}

// Días de anticipación entre Fecha_Solicitud y Fecha_Inicio (política: 15 días para Eventos).
function crmAnticipacionDias(a) {
  if (!a.Fecha_Solicitud || !a.Fecha_Inicio) return null;
  var ms = new Date(a.Fecha_Inicio + 'T00:00:00').getTime() - new Date(a.Fecha_Solicitud + 'T00:00:00').getTime();
  if (isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

function crmFiltrarActividades(list) {
  var est = document.getElementById('fa-estado').value;
  var tipo = document.getElementById('fa-tipo').value;
  return list.filter(function(a) {
    if (est && a.Estado !== est) return false;
    if (tipo && a.Tipo !== tipo) return false;
    return true;
  });
}

function crmRenderActividades() {
  var puedeGestionarActividades = !crmEsComercial();
  var btnNueva = document.getElementById('btn-nueva-actividad');
  if (btnNueva) btnNueva.style.display = puedeGestionarActividades ? '' : 'none';

  var lista = crmFiltrarActividades(crmActividades).slice().sort(function(a, b) { return (b.id || 0) - (a.id || 0); });
  document.getElementById('actividades-ct').textContent = '(' + lista.length + (lista.length !== crmActividades.length ? ' de ' + crmActividades.length : '') + ')';

  if (!lista.length) {
    document.getElementById('actividades-body').innerHTML = '<tr><td colspan="9" style="text-align:center;color:#a0aec0;padding:26px">' +
      (crmActividades.length ? 'Ninguna actividad coincide con los filtros.' : 'Aún no hay actividades registradas.') + '</td></tr>';
    return;
  }

  document.getElementById('actividades-body').innerHTML = lista.map(function(a) {
    var empresasHtml = (a.Empresas || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean).map(function(sig) {
      return '<span class="sigla-badge ' + (SIGLA_CLASSES.indexOf(sig) >= 0 ? 'sigla-' + sig : 'sigla-DEFAULT') + '">' + escHtml(sig) + '</span>';
    }).join(' ') || '—';
    var fechas = (a.Fecha_Inicio ? fmtDate(a.Fecha_Inicio) : '—') + (a.Fecha_Fin && a.Fecha_Fin !== a.Fecha_Inicio ? ' – ' + fmtDate(a.Fecha_Fin) : '');
    var antic = crmAnticipacionDias(a);
    var anticFlag = (a.Tipo === 'Eventos' && antic != null && antic < 15) ? '<div style="color:#c0392b;font-size:0.72rem;font-weight:700;margin-top:2px">⚠ solicitada con ' + antic + ' días de anticipación</div>' : '';
    var nLeads = crmLeadsGeneradosPorActividad(a.id);
    return '<tr>' +
      '<td><strong>' + escHtml(a.Nombre || '—') + '</strong>' + anticFlag + '</td>' +
      '<td>' + crmBadge(a.Tipo, CRM_TIPO_ACTIVIDAD_COLOR[a.Tipo] || '#718096') + '</td>' +
      '<td>' + empresasHtml + '</td>' +
      '<td>' + fechas + '</td>' +
      '<td>' + escHtml(crmNombreUsuario(a.Responsable) || '—') + '</td>' +
      '<td>' + crmBadge(a.Estado === 'En ejecucion' ? 'En ejecución' : a.Estado, CRM_ESTADO_ACTIVIDAD_COLOR[a.Estado] || '#718096') + '</td>' +
      '<td style="text-align:right">' + fmtMoney(a.Presupuesto_Asignado || 0) + '</td>' +
      '<td style="text-align:right">' + (nLeads ? '<a href="#" onclick="event.preventDefault();crmVerLeadsDeActividad(' + a.id + ')" style="font-weight:700">' + nLeads + '</a>' : '0') + '</td>' +
      '<td style="display:flex;gap:4px">' +
        (puedeGestionarActividades ? '<button class="btn-ver" onclick="crmAbrirEditarActividad(' + a.id + ')">Editar</button>' +
        '<button class="btn-rechazar-pedido" onclick="crmEliminarActividad(' + a.id + ')">🗑</button>' : '') +
      '</td>' +
    '</tr>';
  }).join('');
}

function crmVerLeadsDeActividad(actId) {
  crmSwitchTab('leads');
  crmClearFilters();
  crmRenderLeadsFiltradoPorActividad(actId);
}
function crmRenderLeadsFiltradoPorActividad(actId) {
  var lista = crmLeads.filter(function(l) { return l.Actividad_Id === actId; });
  document.getElementById('leads-ct').textContent = '(' + lista.length + ' de la actividad "' + escHtml((crmActividadesById[actId] || {}).Nombre || '') + '")';
  document.getElementById('leads-body').innerHTML = lista.length ? lista.map(function(l) {
    return '<tr style="cursor:pointer" onclick="crmOpenCtx(' + l.id + ')">' +
      '<td><strong>' + escHtml(l.Nombre_Contacto || '—') + '</strong></td>' +
      '<td>' + escHtml(l.Producto_Interes || '—') + '</td><td>' + escHtml(l.Origen || '—') + '</td>' +
      '<td>' + crmCalifBadge(l) + '</td><td>' + crmEstadoBadge(l) + '</td>' +
      '<td>' + escHtml(crmNombreUsuario(l.Asignado_A) || '—') + '</td><td>' + escHtml(fmtDate(l.Fecha_Captura)) + '</td>' +
      '<td>' + (l.Fecha_Ultima_Interaccion ? escHtml(_fmtAudTs(l.Fecha_Ultima_Interaccion)) : '—') + '</td>' +
      '<td><button class="btn-ver" onclick="event.stopPropagation();crmOpenCtx(' + l.id + ')">Ver</button></td></tr>';
  }).join('') : '<tr><td colspan="9" style="text-align:center;color:#a0aec0;padding:26px">Esta actividad no tiene leads vinculados.</td></tr>';
}

function crmOpenNuevaActividad() {
  crmActividadEditId = null;
  document.getElementById('act-titulo').textContent = '➕ Nueva actividad';
  document.getElementById('ac-id').value = '';
  document.getElementById('ac-nombre').value = '';
  document.getElementById('ac-tipo').value = 'Eventos';
  document.getElementById('ac-estado').value = 'Planificada';
  document.getElementById('ac-responsable').value = '';
  document.getElementById('ac-presupuesto').value = '';
  document.getElementById('ac-fecha-sol').value = '';
  document.getElementById('ac-fecha-ini').value = '';
  document.getElementById('ac-fecha-fin').value = '';
  document.getElementById('ac-objetivo').value = '';
  document.getElementById('ac-obs').value = '';
  document.getElementById('ac-bd-entregada').checked = false;
  document.getElementById('ac-bd-fecha').value = '';
  document.getElementById('ac-empresas-checks').innerHTML = crmEmpresasChecksHtml('');
  document.getElementById('act-overlay').classList.add('show');
  setTimeout(function() { document.getElementById('ac-nombre').focus(); }, 60);
}

function crmAbrirEditarActividad(id) {
  var a = crmActividadesById[id];
  if (!a) return;
  crmActividadEditId = id;
  document.getElementById('act-titulo').textContent = '✏️ Editar actividad';
  document.getElementById('ac-id').value = a.id;
  document.getElementById('ac-nombre').value = a.Nombre || '';
  document.getElementById('ac-tipo').value = a.Tipo || 'Otro';
  document.getElementById('ac-estado').value = a.Estado || 'Planificada';
  document.getElementById('ac-responsable').value = a.Responsable || '';
  document.getElementById('ac-presupuesto').value = a.Presupuesto_Asignado || '';
  document.getElementById('ac-fecha-sol').value = a.Fecha_Solicitud || '';
  document.getElementById('ac-fecha-ini').value = a.Fecha_Inicio || '';
  document.getElementById('ac-fecha-fin').value = a.Fecha_Fin || '';
  document.getElementById('ac-objetivo').value = a.Objetivo || '';
  document.getElementById('ac-obs').value = a.Observaciones || '';
  document.getElementById('ac-bd-entregada').checked = !!a.Base_Datos_Entregada;
  document.getElementById('ac-bd-fecha').value = a.Fecha_Entrega_Base_Datos || '';
  document.getElementById('ac-empresas-checks').innerHTML = crmEmpresasChecksHtml(a.Empresas);
  document.getElementById('act-overlay').classList.add('show');
}

function crmCloseActividad() { document.getElementById('act-overlay').classList.remove('show'); }

async function crmGuardarActividad() {
  var nombre = document.getElementById('ac-nombre').value.trim();
  if (!nombre) { showToast('El nombre de la actividad es obligatorio', '#e74c3c'); return; }

  var body = {
    nombre: nombre,
    tipo: document.getElementById('ac-tipo').value,
    empresas: crmEmpresasChecksLeer(),
    fecha_solicitud: document.getElementById('ac-fecha-sol').value || null,
    fecha_inicio: document.getElementById('ac-fecha-ini').value || null,
    fecha_fin: document.getElementById('ac-fecha-fin').value || null,
    responsable: document.getElementById('ac-responsable').value || null,
    estado: document.getElementById('ac-estado').value,
    objetivo: document.getElementById('ac-objetivo').value.trim(),
    presupuesto_asignado: document.getElementById('ac-presupuesto').value.replace(/[^\d.]/g, ''),
    base_datos_entregada: document.getElementById('ac-bd-entregada').checked,
    fecha_entrega_base_datos: document.getElementById('ac-bd-fecha').value || null,
    observaciones: document.getElementById('ac-obs').value.trim()
  };

  var okBtn = document.getElementById('ac-ok');
  okBtn.disabled = true; okBtn.textContent = 'Guardando…';
  var res = crmActividadEditId
    ? await apiPost(Object.assign({ action: 'editarActividad', id: crmActividadEditId }, body))
    : await apiPost(Object.assign({ action: 'crearActividad' }, body));
  okBtn.disabled = false; okBtn.textContent = 'Guardar';

  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo guardar'), '#e74c3c'); return; }
  showToast(crmActividadEditId ? '✅ Actividad actualizada' : '✅ Actividad creada', undefined);
  crmCloseActividad();
  await loadCRM();
}

async function crmEliminarActividad(id) {
  var a = crmActividadesById[id];
  if (!a) return;
  if (!confirm('¿Eliminar la actividad "' + a.Nombre + '"? Esta acción no se puede deshacer.')) return;
  var res = await apiPost({ action: 'eliminarActividad', id: id });
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo eliminar'), '#e74c3c'); return; }
  showToast('🗑 Actividad eliminada', undefined);
  await loadCRM();
}

// ── Presupuesto de mercadeo ────────────────────────────────────
function crmEjecutadoDe(presupuestoId) {
  return (crmGastosPorPresupuesto[presupuestoId] || []).reduce(function(s, g) { return s + (Number(g.Valor_Ejecutado) || 0); }, 0);
}

function crmSemaforoEjecucion(pct) {
  if (pct == null) return { cls: 'none', txt: 'sin ejecución' };
  if (pct > 105) return { cls: 'over', txt: pct + '% (sobreejecutado)' };
  if (pct >= 95) return { cls: 'ok', txt: pct + '% (en meta)' };
  return { cls: 'mid', txt: pct + '%' };
}

function crmFiltrarPresupuesto(list) {
  var emp = document.getElementById('fp-empresa').value;
  var rubro = document.getElementById('fp-rubro').value;
  return list.filter(function(p) {
    if (emp && p.Empresa !== emp) return false;
    if (rubro && p.Rubro !== rubro) return false;
    return true;
  });
}

function crmRenderPresupuesto() {
  if (crmEsComercial()) return; // sin acceso (RLS); la pestaña ya está oculta
  var lista = crmFiltrarPresupuesto(crmPresupuesto).slice().sort(function(a, b) {
    return String(b.Periodo).localeCompare(String(a.Periodo)) || String(a.Empresa).localeCompare(String(b.Empresa));
  });
  document.getElementById('presupuesto-ct').textContent = '(' + lista.length + (lista.length !== crmPresupuesto.length ? ' de ' + crmPresupuesto.length : '') + ')';

  if (!lista.length) {
    document.getElementById('presupuesto-body').innerHTML = '<tr><td colspan="7" style="text-align:center;color:#a0aec0;padding:26px">' +
      (crmPresupuesto.length ? 'Ninguna línea coincide con los filtros.' : 'Aún no hay líneas de presupuesto registradas.') + '</td></tr>';
    return;
  }

  document.getElementById('presupuesto-body').innerHTML = lista.map(function(p) {
    var ejecutado = crmEjecutadoDe(p.id);
    var presupuestado = Number(p.Valor_Presupuestado) || 0;
    var pct = presupuestado > 0 ? Math.round(ejecutado / presupuestado * 100) : null;
    var sem = crmSemaforoEjecucion(pct);
    return '<tr style="cursor:pointer" onclick="crmAbrirDetallePresupuesto(' + p.id + ')">' +
      '<td>' + escHtml(p.Empresa) + '</td>' +
      '<td>' + crmBadge(p.Rubro, CRM_TIPO_ACTIVIDAD_COLOR[p.Rubro] || '#718096') + '</td>' +
      '<td>' + escHtml(p.Periodo) + '</td>' +
      '<td style="text-align:right">' + fmtMoney(presupuestado) + '</td>' +
      '<td style="text-align:right">' + fmtMoney(ejecutado) + '</td>' +
      '<td><span class="car-pill ' + sem.cls + '">' + sem.txt + '</span></td>' +
      '<td style="display:flex;gap:4px">' +
        '<button class="btn-ver" onclick="event.stopPropagation();crmAbrirEditarPresupuesto(' + p.id + ')">Editar</button>' +
        '<button class="btn-rechazar-pedido" onclick="event.stopPropagation();crmEliminarPresupuesto(' + p.id + ')">🗑</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function crmOpenNuevoPresupuesto() {
  crmPresupuestoEditId = null;
  document.getElementById('pr-titulo').textContent = '➕ Nueva línea de presupuesto';
  document.getElementById('pr-id').value = '';
  document.getElementById('pr-empresa').value = EMPRESAS_HOLDING[0].sigla;
  document.getElementById('pr-rubro').value = 'Eventos';
  document.getElementById('pr-periodo').value = today().slice(0, 7);
  document.getElementById('pr-valor').value = '';
  document.getElementById('pr-obs').value = '';
  document.getElementById('pr-overlay').classList.add('show');
}

function crmAbrirEditarPresupuesto(id) {
  var p = crmPresupuestoById[id];
  if (!p) return;
  crmPresupuestoEditId = id;
  document.getElementById('pr-titulo').textContent = '✏️ Editar línea de presupuesto';
  document.getElementById('pr-id').value = p.id;
  document.getElementById('pr-empresa').value = p.Empresa;
  document.getElementById('pr-rubro').value = p.Rubro;
  document.getElementById('pr-periodo').value = p.Periodo;
  document.getElementById('pr-valor').value = p.Valor_Presupuestado || '';
  document.getElementById('pr-obs').value = p.Observaciones || '';
  document.getElementById('pr-overlay').classList.add('show');
}

function crmClosePresupuesto() { document.getElementById('pr-overlay').classList.remove('show'); }

async function crmGuardarPresupuesto() {
  var periodo = document.getElementById('pr-periodo').value.trim();
  if (!periodo) { showToast('El periodo es obligatorio (ej. 2026-09)', '#e74c3c'); return; }

  var body = {
    empresa: document.getElementById('pr-empresa').value,
    rubro: document.getElementById('pr-rubro').value,
    periodo: periodo,
    valor_presupuestado: document.getElementById('pr-valor').value.replace(/[^\d.]/g, ''),
    observaciones: document.getElementById('pr-obs').value.trim()
  };

  var okBtn = document.getElementById('pr-ok');
  okBtn.disabled = true; okBtn.textContent = 'Guardando…';
  var res = crmPresupuestoEditId
    ? await apiPost(Object.assign({ action: 'editarPresupuesto', id: crmPresupuestoEditId }, body))
    : await apiPost(Object.assign({ action: 'crearPresupuesto' }, body));
  okBtn.disabled = false; okBtn.textContent = 'Guardar';

  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo guardar'), '#e74c3c'); return; }
  showToast(crmPresupuestoEditId ? '✅ Línea actualizada' : '✅ Línea creada', undefined);
  crmClosePresupuesto();
  await loadCRM();
}

async function crmEliminarPresupuesto(id) {
  var p = crmPresupuestoById[id];
  if (!p) return;
  var gastos = crmGastosPorPresupuesto[id] || [];
  if (gastos.length && !confirm('Esta línea tiene ' + gastos.length + ' gasto(s) registrados que también se eliminarán. ¿Continuar?')) return;
  if (!gastos.length && !confirm('¿Eliminar la línea de presupuesto de ' + p.Empresa + ' / ' + p.Rubro + ' / ' + p.Periodo + '?')) return;
  var res = await apiPost({ action: 'eliminarPresupuesto', id: id });
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo eliminar'), '#e74c3c'); return; }
  showToast('🗑 Línea eliminada', undefined);
  await loadCRM();
}

// ── Detalle de presupuesto (gastos) ──────────────────────────
function crmAbrirDetallePresupuesto(id) {
  crmPresupuestoDetalleId = id;
  crmRenderPresupuestoDetalle();
  document.getElementById('prd-overlay').classList.add('show');
}
function crmClosePresupuestoDetalle() {
  crmPresupuestoDetalleId = null;
  document.getElementById('prd-overlay').classList.remove('show');
}

function crmRenderPresupuestoDetalle() {
  var p = crmPresupuestoById[crmPresupuestoDetalleId];
  if (!p) return;
  var gastos = (crmGastosPorPresupuesto[p.id] || []).slice().sort(function(a, b) { return String(b.Fecha_Gasto).localeCompare(String(a.Fecha_Gasto)); });
  var ejecutado = crmEjecutadoDe(p.id);
  var presupuestado = Number(p.Valor_Presupuestado) || 0;
  var pct = presupuestado > 0 ? Math.round(ejecutado / presupuestado * 100) : null;
  var sem = crmSemaforoEjecucion(pct);

  document.getElementById('prd-titulo').textContent = p.Empresa + ' — ' + p.Rubro + ' — ' + p.Periodo;
  document.getElementById('prd-meta').innerHTML =
    '<span>Presupuestado: ' + fmtMoney(presupuestado) + '</span>' +
    '<span>Ejecutado: ' + fmtMoney(ejecutado) + '</span>' +
    '<span class="car-pill ' + sem.cls + '">' + sem.txt + '</span>';

  var html = '<div class="car-box" style="margin-bottom:14px">' +
    '<h4>Registrar gasto</h4>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
      '<div><label class="ef-label">Fecha del gasto</label><input class="ef" id="ga-fecha" type="date" value="' + today() + '"></div>' +
      '<div><label class="ef-label">Valor ejecutado ($)</label><input class="ef" id="ga-valor" type="text" inputmode="numeric" placeholder="Ej. 500000"></div>' +
      '<div><label class="ef-label">Fecha de legalización</label><input class="ef" id="ga-legal" type="date"></div>' +
    '</div>' +
    '<div style="margin-top:8px"><label class="ef-label">Concepto</label><input class="ef" id="ga-concepto" type="text" placeholder="Ej. Alquiler de carpas"></div>' +
    '<div style="margin-top:8px"><label class="ef-label">Actividad relacionada (opcional)</label><select class="ef" id="ga-actividad"><option value="">Sin actividad</option>' +
      crmActividades.map(function(a) { return '<option value="' + a.id + '">' + escHtml(a.Nombre) + '</option>'; }).join('') +
    '</select></div>' +
    '<button class="btn-confirm" style="margin-top:10px" onclick="crmAgregarGasto(' + p.id + ')">➕ Registrar gasto</button>' +
  '</div>';

  html += '<div class="car-box"><h4>Gastos registrados (' + gastos.length + ')</h4>';
  if (!gastos.length) {
    html += '<div style="color:#a0aec0;font-size:0.82rem">Sin gastos registrados todavía.</div>';
  } else {
    html += '<table class="car-mini"><thead><tr><th>Fecha</th><th>Concepto</th><th>Actividad</th><th style="text-align:right">Valor</th><th>Legalización</th><th></th></tr></thead><tbody>' +
      gastos.map(function(g) {
        var legaliza = g.Fecha_Legalizacion ? fmtDate(g.Fecha_Legalizacion) : '<span class="tag-sin">pendiente</span>';
        var diasLeg = g.Fecha_Legalizacion ? crmDiasEntre(g.Fecha_Gasto, g.Fecha_Legalizacion) : null;
        var legalWarn = diasLeg != null && diasLeg > 5 ? ' ⚠' : '';
        return '<tr><td>' + escHtml(fmtDate(g.Fecha_Gasto)) + '</td><td>' + escHtml(g.Concepto || '—') + '</td>' +
          '<td>' + escHtml(g.Actividad_Id ? ((crmActividadesById[g.Actividad_Id] || {}).Nombre || '—') : '—') + '</td>' +
          '<td style="text-align:right">' + fmtMoney(g.Valor_Ejecutado || 0) + '</td>' +
          '<td>' + legaliza + legalWarn + '</td>' +
          '<td><button class="btn-rechazar-pedido" onclick="crmEliminarGasto(' + g.id + ')">🗑</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  html += '</div>';

  document.getElementById('prd-body').innerHTML = html;
}

function crmDiasEntre(desde, hasta) {
  var a = new Date(desde + 'T00:00:00').getTime(), b = new Date(hasta + 'T00:00:00').getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

async function crmAgregarGasto(presupuestoId) {
  var body = {
    presupuesto_id: presupuestoId,
    fecha_gasto: document.getElementById('ga-fecha').value || today(),
    valor_ejecutado: document.getElementById('ga-valor').value.replace(/[^\d.]/g, ''),
    concepto: document.getElementById('ga-concepto').value.trim(),
    actividad_id: document.getElementById('ga-actividad').value || null,
    fecha_legalizacion: document.getElementById('ga-legal').value || null
  };
  if (!body.valor_ejecutado) { showToast('El valor ejecutado es obligatorio', '#e74c3c'); return; }
  var res = await apiPost(Object.assign({ action: 'registrarGastoPresupuesto' }, body));
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo registrar'), '#e74c3c'); return; }
  showToast('✅ Gasto registrado', undefined);
  await loadCRM();
  crmAbrirDetallePresupuesto(presupuestoId);
}

async function crmEliminarGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  var res = await apiPost({ action: 'eliminarGastoPresupuesto', id: id });
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo eliminar'), '#e74c3c'); return; }
  showToast('🗑 Gasto eliminado', undefined);
  var pid = crmPresupuestoDetalleId;
  await loadCRM();
  if (pid) crmAbrirDetallePresupuesto(pid);
}

// ── Indicadores ───────────────────────────────────────────────
function crmRenderIndicadores() {
  var mesActual = today().slice(0, 7);
  var leadsMes = crmLeads.filter(function(l) { return String(l.Fecha_Captura || '').slice(0, 7) === mesActual; });

  // Tiempo promedio de asignación (creado_en -> Fecha_Asignacion) y de primer contacto (Fecha_Asignacion -> primer seguimiento).
  var horasAsig = [];
  crmLeads.forEach(function(l) {
    if (l.Fecha_Asignacion && l.creado_en) {
      var h = (new Date(l.Fecha_Asignacion).getTime() - new Date(l.creado_en).getTime()) / 3600000;
      if (h >= 0) horasAsig.push(h);
    }
  });
  var promAsig = horasAsig.length ? Math.round(horasAsig.reduce(function(s, h) { return s + h; }, 0) / horasAsig.length) : null;

  var horasContacto = [];
  crmLeads.forEach(function(l) {
    var segs = crmSeguimientosPorLead[l.id];
    if (l.Fecha_Asignacion && segs && segs.length) {
      var primero = segs[segs.length - 1]; // el arreglo está ordenado desc por fecha
      var h = (new Date(primero.Fecha).getTime() - new Date(l.Fecha_Asignacion).getTime()) / 3600000;
      if (h >= 0) horasContacto.push(h);
    }
  });
  var promContacto = horasContacto.length ? Math.round(horasContacto.reduce(function(s, h) { return s + h; }, 0) / horasContacto.length) : null;

  // Ejecución presupuestal total (solo si el rol puede verla).
  var statsHtml =
    '<div class="sc pend-aprob"><div class="num">' + leadsMes.length + '</div><div class="lbl">Leads capturados (mes)</div></div>' +
    '<div class="sc recibido"><div class="num">' + (promAsig == null ? '—' : promAsig + ' h') + '</div><div class="lbl">Tiempo promedio de asignación</div></div>' +
    '<div class="sc sol-pend"><div class="num">' + (promContacto == null ? '—' : promContacto + ' h') + '</div><div class="lbl">Tiempo promedio de 1er contacto</div></div>';

  if (!crmEsComercial()) {
    var totalPres = crmPresupuesto.reduce(function(s, p) { return s + (Number(p.Valor_Presupuestado) || 0); }, 0);
    var totalEjec = crmGastos.reduce(function(s, g) { return s + (Number(g.Valor_Ejecutado) || 0); }, 0);
    var pctEjec = totalPres > 0 ? Math.round(totalEjec / totalPres * 100) : null;
    statsHtml += '<div class="sc total"><div class="num">' + (pctEjec == null ? '—' : pctEjec + '%') + '</div><div class="lbl">Ejecución presupuestal total</div><div class="car-sub">' + fmtMoney(totalEjec) + ' de ' + fmtMoney(totalPres) + '</div></div>';
  }
  document.getElementById('ind-stats').innerHTML = statsHtml;

  // Leads por origen (mes)
  var porOrigen = { Evento: 0, Digital: 0, Distribuidor: 0 };
  leadsMes.forEach(function(l) { if (porOrigen[l.Origen] != null) porOrigen[l.Origen]++; });
  document.getElementById('ind-origen-body').innerHTML = Object.keys(porOrigen).map(function(o) {
    return '<tr><td>' + o + '</td><td style="text-align:right">' + porOrigen[o] + '</td></tr>';
  }).join('');

  // Cumplimiento de anticipación de eventos
  var eventos = crmActividades.filter(function(a) { return a.Tipo === 'Eventos' && a.Fecha_Solicitud && a.Fecha_Inicio; });
  if (!eventos.length) {
    document.getElementById('ind-eventos-body').innerHTML = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:16px">Sin eventos con fechas registradas.</td></tr>';
  } else {
    document.getElementById('ind-eventos-body').innerHTML = eventos.map(function(a) {
      var d = crmAnticipacionDias(a);
      var color = d != null && d < 15 ? '#c0392b' : '#15803d';
      return '<tr><td>' + escHtml(a.Nombre) + '</td><td>' + escHtml(fmtDate(a.Fecha_Solicitud)) + '</td><td>' + escHtml(fmtDate(a.Fecha_Inicio)) + '</td>' +
        '<td style="text-align:right;color:' + color + ';font-weight:700">' + (d == null ? '—' : d + ' días') + '</td></tr>';
    }).join('');
  }
}

// ── Modal: nuevo / editar lead ───────────────────────────────
function crmOpenNuevo() {
  document.getElementById('nuevo-titulo').textContent = '➕ Nuevo lead';
  document.getElementById('nv-id').value = '';
  ['nv-nombre', 'nv-empresa', 'nv-telefono', 'nv-correo', 'nv-municipio', 'nv-departamento', 'nv-producto', 'nv-obs'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('nv-origen').value = 'Evento';
  document.getElementById('nv-actividad').value = '';
  document.getElementById('nv-autorizacion').checked = false;
  document.getElementById('nv-asignado').value = crmEsComercial() ? (crmMiUid() || '') : '';
  document.getElementById('nv-asignar-wrap').style.display = crmEsComercial() ? 'none' : 'block';
  document.getElementById('nv-ok').disabled = false;
  document.getElementById('nv-ok').textContent = 'Guardar';
  document.getElementById('nuevo-overlay').classList.add('show');
  setTimeout(function() { document.getElementById('nv-nombre').focus(); }, 60);
}
function crmAbrirEditar() {
  var l = crmByLeadId[crmCtxId];
  if (!l) return;
  document.getElementById('nuevo-titulo').textContent = '✏️ Editar lead';
  document.getElementById('nv-id').value = l.id;
  document.getElementById('nv-nombre').value = l.Nombre_Contacto || '';
  document.getElementById('nv-empresa').value = l.Empresa_Contacto || '';
  document.getElementById('nv-telefono').value = l.Telefono || '';
  document.getElementById('nv-correo').value = l.Correo || '';
  document.getElementById('nv-municipio').value = l.Municipio || '';
  document.getElementById('nv-departamento').value = l.Departamento || '';
  document.getElementById('nv-producto').value = l.Producto_Interes || '';
  document.getElementById('nv-obs').value = l.Observaciones || '';
  document.getElementById('nv-origen').value = l.Origen || 'Evento';
  document.getElementById('nv-actividad').value = l.Actividad_Id || '';
  document.getElementById('nv-autorizacion').checked = !!l.Autorizacion_Datos;
  document.getElementById('nv-asignar-wrap').style.display = 'none';
  document.getElementById('nuevo-overlay').classList.add('show');
}
function crmCloseNuevo() { document.getElementById('nuevo-overlay').classList.remove('show'); }

async function crmGuardarNuevo() {
  var nombre = document.getElementById('nv-nombre').value.trim();
  if (!nombre) { showToast('El nombre del contacto es obligatorio', '#e74c3c'); return; }
  var autorizacion = document.getElementById('nv-autorizacion').checked;
  var id = document.getElementById('nv-id').value;
  if (!autorizacion) { showToast('Falta marcar la autorización de tratamiento de datos (Ley 1581)', '#e74c3c'); return; }

  var body = {
    nombre_contacto: nombre,
    empresa_contacto: document.getElementById('nv-empresa').value.trim(),
    telefono: document.getElementById('nv-telefono').value.trim(),
    correo: document.getElementById('nv-correo').value.trim(),
    municipio: document.getElementById('nv-municipio').value.trim(),
    departamento: document.getElementById('nv-departamento').value.trim(),
    producto_interes: document.getElementById('nv-producto').value.trim(),
    origen: document.getElementById('nv-origen').value,
    actividad_id: document.getElementById('nv-actividad').value || null,
    autorizacion_datos: autorizacion,
    observaciones: document.getElementById('nv-obs').value.trim()
  };

  var okBtn = document.getElementById('nv-ok');
  okBtn.disabled = true; okBtn.textContent = 'Guardando…';
  var res;
  if (id) {
    res = await apiPost({ action: 'editarLead', id: Number(id), nombre_contacto: body.nombre_contacto, empresa_contacto: body.empresa_contacto,
      telefono: body.telefono, correo: body.correo, municipio: body.municipio, departamento: body.departamento,
      producto_interes: body.producto_interes, origen: body.origen, actividad_id: body.actividad_id,
      autorizacion_datos: body.autorizacion_datos, observaciones: body.observaciones });
  } else {
    var asignado = document.getElementById('nv-asignado').value;
    if (asignado) body.asignado_a = asignado;
    res = await apiPost(Object.assign({ action: 'crearLead' }, body));
  }
  okBtn.disabled = false; okBtn.textContent = 'Guardar';

  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo guardar'), '#e74c3c'); return; }
  showToast(id ? '✅ Lead actualizado' : '✅ Lead creado', undefined);
  crmCloseNuevo();
  await loadCRM();
}

// ── Panel de detalle ─────────────────────────────────────────
function crmOpenCtx(id) {
  if (!crmByLeadId[id]) return;
  crmCtxId = id;
  crmRenderCtx();
  document.getElementById('ctx-overlay').classList.add('show');
}
function crmCloseCtx() {
  crmCtxId = null;
  document.getElementById('ctx-overlay').classList.remove('show');
}

function crmRenderCtx() {
  var l = crmByLeadId[crmCtxId];
  if (!l) return;
  var venc = crmVencido48h(l);
  var puedeGestionar = !crmEsComercial() || l.Asignado_A === crmMiUid() || l.creado_por === crmMiUid();

  document.getElementById('ctx-titulo').textContent = (l.Nombre_Contacto || '—') + (l.Empresa_Contacto ? ' — ' + l.Empresa_Contacto : '');
  document.getElementById('ctx-meta').innerHTML =
    '<span>' + crmEstadoBadge(l) + '</span><span>' + crmCalifBadge(l) + '</span>' +
    '<span>📍 ' + escHtml(l.Origen || '—') + '</span><span>📅 ' + escHtml(fmtDate(l.Fecha_Captura)) + '</span>';

  var html = '';
  if (venc) html += '<div class="car-flag">⚠️ Este lead lleva más de 48 horas sin asignarse a un comercial.</div>';

  html += '<div class="car-ctx-grid">';
  html += '<div class="car-box"><h4>Datos de contacto</h4>' +
    crmKv('Teléfono', escHtml(l.Telefono || '—')) +
    crmKv('Correo', escHtml(l.Correo || '—')) +
    crmKv('Municipio', escHtml(l.Municipio || '—')) +
    crmKv('Departamento', escHtml(l.Departamento || '—')) +
    crmKv('Producto de interés', escHtml(l.Producto_Interes || '—')) +
    crmKv('Autorización de datos', l.Autorizacion_Datos ? '<span class="car-pill ok">Sí</span>' : '<span class="car-pill over">No registrada</span>') +
    (l.Actividad_Id ? crmKv('Actividad de origen', '<a href="#" onclick="event.preventDefault();crmCloseCtx();crmSwitchTab(\'actividades\')">' + escHtml((crmActividadesById[l.Actividad_Id] || {}).Nombre || ('#' + l.Actividad_Id)) + '</a>') : '') +
    (l.Observaciones ? crmKv('Observaciones', escHtml(l.Observaciones)) : '') +
  '</div>';

  html += '<div class="car-box"><h4>Calificación y asignación</h4>';
  if (puedeGestionar && l.Estado !== 'Cerrado') {
    html += '<div style="display:flex;gap:6px;margin-bottom:10px">' +
      ['Caliente', 'Tibio', 'Frio'].map(function(c) {
        var activo = l.Calificacion === c;
        return '<button class="btn-cancel" style="' + (activo ? 'background:' + CRM_CALIF_COLOR[c] + ';color:#fff;border-color:' + CRM_CALIF_COLOR[c] : '') + '" onclick="crmCalificar(' + l.id + ',\'' + c + '\')">' + (c === 'Frio' ? 'Frío' : c) + '</button>';
      }).join('') + '</div>';
  }
  html += crmKv('Calificación', crmCalifBadge(l));
  html += crmKv('Asignado a', escHtml(crmNombreUsuario(l.Asignado_A) || 'Sin asignar'));
  if (l.Fecha_Asignacion) html += crmKv('Asignado el', escHtml(_fmtAudTs(l.Fecha_Asignacion)));
  if (puedeGestionar && l.Estado !== 'Cerrado' && !crmEsComercial()) {
    html += '<div style="display:flex;gap:6px;margin-top:10px;align-items:center">' +
      '<select class="ef" id="ctx-asig-sel" style="flex:1">' +
        '<option value="">Elegir comercial…</option>' +
        crmComerciales.map(function(u) { return '<option value="' + escHtml(u.id) + '" ' + (u.id === l.Asignado_A ? 'selected' : '') + '>' + escHtml(u.nombre || u.email) + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn-confirm" onclick="crmAsignar(' + l.id + ')">Asignar</button></div>';
  }
  html += '</div>';
  html += '</div>';

  // Seguimiento (timeline)
  var segs = crmSeguimientosPorLead[l.id] || [];
  html += '<div class="car-box" style="margin-top:14px"><h4>Seguimiento (' + segs.length + ')</h4>';
  if (puedeGestionar && l.Estado !== 'Cerrado') {
    html += '<div style="display:grid;grid-template-columns:130px 1fr;gap:8px;margin-bottom:12px">' +
      '<select class="ef" id="sg-tipo"><option>Llamada</option><option>Visita</option><option>Email</option><option>WhatsApp</option><option>Reunion</option><option>Otro</option></select>' +
      '<input class="ef" id="sg-resultado" placeholder="Resultado (ej. interesado, agenda visita, no contesta…)">' +
      '</div>' +
      '<textarea class="ef" id="sg-obs" rows="2" style="resize:vertical;margin-bottom:8px" placeholder="Observaciones (opcional)"></textarea>' +
      '<button class="btn-confirm" onclick="crmAgregarSeguimiento(' + l.id + ')">➕ Agregar seguimiento</button><div style="margin-bottom:10px"></div>';
  }
  if (!segs.length) {
    html += '<div style="color:#a0aec0;font-size:0.82rem">Sin interacciones registradas todavía.</div>';
  } else {
    html += segs.map(function(s) {
      return '<div style="border-top:1px solid #edf2f7;padding:8px 0;font-size:0.84rem">' +
        '<strong>' + escHtml(s.Tipo) + '</strong> · ' + escHtml(_fmtAudTs(s.Fecha)) + (s.creado_por_nombre ? ' · ' + escHtml(s.creado_por_nombre) : '') +
        (s.Resultado ? '<div>' + escHtml(s.Resultado) + '</div>' : '') +
        (s.Observaciones ? '<div style="color:#718096">' + escHtml(s.Observaciones) + '</div>' : '') +
      '</div>';
    }).join('');
  }
  html += '</div>';

  // Cierre
  html += '<div class="car-box" style="margin-top:14px"><h4>Cierre</h4>';
  if (l.Estado === 'Cerrado') {
    if (l.Resultado_Cierre === 'Convertido') {
      html += crmKv('Resultado', '<span class="car-pill ok">✅ Convertido</span>') + crmKv('Valor de venta', fmtMoney(l.Valor_Venta || 0));
    } else if (l.Resultado_Cierre === 'Perdido') {
      html += crmKv('Resultado', '<span class="car-pill over">❌ Perdido</span>') + crmKv('Motivo', escHtml(l.Motivo_Perdida || '—'));
    } else {
      html += crmKv('Resultado', '<span class="car-pill mid">⏱ Cierre automático (90 días sin movimiento)</span>');
    }
    if (l.Fecha_Cierre) html += crmKv('Fecha de cierre', escHtml(_fmtAudTs(l.Fecha_Cierre)));
  } else if (puedeGestionar) {
    html += '<div style="display:flex;gap:8px">' +
      '<button class="btn-aprobar-pedido" onclick="crmAbrirCierre(\'Convertido\')">✅ Marcar Convertido</button>' +
      '<button class="btn-rechazar-pedido" onclick="crmAbrirCierre(\'Perdido\')">❌ Marcar Perdido</button>' +
    '</div>';
  } else {
    html += '<div style="color:#a0aec0;font-size:0.82rem">Aún abierto.</div>';
  }
  html += '</div>';

  html += _auditoriaHtml(l, false);

  document.getElementById('ctx-body').innerHTML = html;
}

async function crmCalificar(id, calificacion) {
  var res = await apiPost({ action: 'calificarLead', id: id, calificacion: calificacion });
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo calificar'), '#e74c3c'); return; }
  await loadCRM();
}

async function crmAsignar(id) {
  var sel = document.getElementById('ctx-asig-sel');
  var asignadoA = sel ? sel.value : '';
  if (!asignadoA) { showToast('Elige un comercial', '#e74c3c'); return; }
  var l = crmByLeadId[id];
  var res = await apiPost({ action: 'asignarLead', id: id, asignado_a: asignadoA });
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo asignar'), '#e74c3c'); return; }
  if (typeof NOTIF !== 'undefined' && NOTIF.notifyUsers) {
    try {
      await NOTIF.notifyUsers({
        para_ids: [asignadoA], modulo: 'crm', referencia: 'lead-' + id,
        titulo: '🧲 Nuevo lead asignado: ' + (l ? l.Nombre_Contacto : ''),
        mensaje: 'Se te asignó un lead de Mercadeo para hacerle seguimiento.'
      });
    } catch (e) { /* silencioso */ }
  }
  showToast('✅ Lead asignado', undefined);
  await loadCRM();
}

async function crmAgregarSeguimiento(id) {
  var tipo = document.getElementById('sg-tipo').value;
  var resultado = document.getElementById('sg-resultado').value.trim();
  var obs = document.getElementById('sg-obs').value.trim();
  var res = await apiPost({ action: 'registrarSeguimientoLead', lead_id: id, tipo: tipo, resultado: resultado, observaciones: obs });
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo registrar'), '#e74c3c'); return; }
  showToast('✅ Seguimiento agregado', undefined);
  await loadCRM();
}

// ── Cierre (Convertido / Perdido) ────────────────────────────
function crmAbrirCierre(kind) {
  crmCierreKind = kind;
  document.getElementById('cierre-titulo').textContent = kind === 'Convertido' ? '✅ Marcar como Convertido' : '❌ Marcar como Perdido';
  document.getElementById('cierre-hdr').style.background = kind === 'Convertido' ? 'linear-gradient(135deg,#15803d,#22c55e)' : 'linear-gradient(135deg,#b91c1c,#ef4444)';
  document.getElementById('cierre-campo-valor').style.display = kind === 'Convertido' ? 'block' : 'none';
  document.getElementById('cierre-campo-motivo').style.display = kind === 'Perdido' ? 'block' : 'none';
  document.getElementById('cierre-valor').value = '';
  document.getElementById('cierre-motivo').value = '';
  document.getElementById('cierre-overlay').classList.add('show');
}
function crmCloseCierre() { document.getElementById('cierre-overlay').classList.remove('show'); }

async function crmConfirmCierre() {
  if (!crmCtxId || !crmCierreKind) return;
  var body = { action: 'cerrarLead', id: crmCtxId, resultado_cierre: crmCierreKind };
  if (crmCierreKind === 'Convertido') {
    body.valor_venta = document.getElementById('cierre-valor').value.replace(/[^\d.]/g, '');
  } else {
    var motivo = document.getElementById('cierre-motivo').value.trim();
    if (!motivo) { showToast('Escribe el motivo de la pérdida', '#e74c3c'); return; }
    body.motivo_perdida = motivo;
  }
  var okBtn = document.getElementById('cierre-ok');
  okBtn.disabled = true; okBtn.textContent = 'Procesando…';
  var res = await apiPost(body);
  okBtn.disabled = false; okBtn.textContent = 'Confirmar';
  if (!res || res.ok === false) { showToast('Error: ' + ((res && res.error) || 'no se pudo cerrar'), '#e74c3c'); return; }
  showToast(crmCierreKind === 'Convertido' ? '✅ Lead convertido' : '❌ Lead marcado como perdido', undefined);
  crmCloseCierre();
  await loadCRM();
}

// Escape cierra el modal de más arriba.
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  if (document.getElementById('cierre-overlay').classList.contains('show')) crmCloseCierre();
  else if (document.getElementById('prd-overlay').classList.contains('show')) crmClosePresupuestoDetalle();
  else if (document.getElementById('pr-overlay').classList.contains('show')) crmClosePresupuesto();
  else if (document.getElementById('act-overlay').classList.contains('show')) crmCloseActividad();
  else if (document.getElementById('nuevo-overlay').classList.contains('show')) crmCloseNuevo();
  else if (document.getElementById('ctx-overlay').classList.contains('show')) crmCloseCtx();
});

loadCRM();
