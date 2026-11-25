// ══════════════════════════════════════════════════════════════
// Vencimientos de vehículos — SOAT y técnico-mecánica por placa
// Tablas: VehiculosVencimientos, VehiculosVencimientosDocs, VehiculosVencimientosAvisos
// (supabase/migrations/create_vehiculos_vencimientos.sql). El aviso diario al grupo de WhatsApp lo
// manda la Edge Function `vencimientos-vehiculos-aviso` (pg_cron); aquí solo se editan los datos,
// se ve el historial y se dispara «Enviar aviso ahora» (vista previa + confirmación).
// Permisos: ver = módulo `vehiculos_vencimientos`; editar y enviar = además `vehiculos_vencimientos_editar`
// (el administrador siempre; el rol lector nunca escribe). La base lo exige por RLS; aquí solo se oculta.
// ══════════════════════════════════════════════════════════════

var VV_REGION_FUNCION = 'us-west-2';   // misma región que la base (ver solicitudes-mercadeo.js)
var VV_DOCS = [
  { key: 'SOAT',          label: 'SOAT' },
  { key: 'TECNOMECANICA', label: 'Técnico-mecánica' }
];
var VV_DIAS_URGENTE = 7;
var VV_DIAS_PROXIMO = 30;

var _vv = {
  vehiculos: [],      // filas de VehiculosVencimientos
  docs: {},           // { vehiculo_id: { SOAT: fila, TECNOMECANICA: fila } }
  avisos: [],         // últimos avisos (historial)
  editId: null,
  puedeEditar: false,
  avisoListo: false,
  enviando: false
};

function vvEl(id) { return document.getElementById(id); }

function vvPuedeEditar() {
  return typeof AUTH !== 'undefined' && !!AUTH.hasModule && AUTH.hasModule('vehiculos_vencimientos_editar') &&
         !(AUTH.isLector && AUTH.isLector());
}

// ── Fechas y estados ──
// Días que faltan (negativo = ya venció) contando por fecha de calendario, sin horas.
function vvDias(iso, hoyIso) {
  if (!iso) return null;
  var p = String(iso).split('-');
  var t = String(hoyIso || today()).split('-');
  return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+t[0], +t[1] - 1, +t[2])) / 86400000);
}

function vvEstadoDias(dias) {
  if (dias === null || dias === undefined) return 'sin';
  if (dias < 0) return 'venc';
  if (dias <= VV_DIAS_URGENTE) return 'urg';
  if (dias <= VV_DIAS_PROXIMO) return 'prox';
  return 'vig';
}

function vvTextoDias(dias) {
  if (dias === null || dias === undefined) return 'Sin fecha';
  if (dias < 0) return 'Vencido hace ' + (-dias) + (dias === -1 ? ' día' : ' días');
  if (dias === 0) return 'Vence HOY';
  if (dias === 1) return 'Vence mañana';
  if (dias <= VV_DIAS_PROXIMO) return 'En ' + dias + ' días';
  return 'Vigente · ' + dias + ' días';
}

// Estado del vehículo = el del documento más urgente que tenga fecha.
function vvDiasMinimos(v) {
  var d = _vv.docs[v.id] || {};
  var min = null;
  VV_DOCS.forEach(function(t) {
    if (!d[t.key]) return;
    var x = vvDias(d[t.key].Fecha_Vencimiento);
    if (x !== null && (min === null || x < min)) min = x;
  });
  return min;
}

function vvNormPlaca(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }

function vvNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Carga ──
function vvMensajeErrorCarga(err) {
  if (!err) return '';
  if (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|schema cache/i.test(err.message || '')) {
    return 'Falta aplicar la migración create_vehiculos_vencimientos.sql en Supabase.';
  }
  return err.message || 'Error al cargar';
}

async function vvLeerDatos() {
  var res = await Promise.all([
    _sb.from('VehiculosVencimientos').select('*').order('Placa'),
    _sb.from('VehiculosVencimientosDocs').select('*'),
    _sb.from('VehiculosVencimientosAvisos').select('*').order('Creado_En', { ascending: false }).limit(50)
  ]);
  for (var i = 0; i < res.length; i++) {
    if (res[i].error) throw new Error(vvMensajeErrorCarga(res[i].error));
  }
  _vv.vehiculos = res[0].data || [];
  _vv.docs = {};
  (res[1].data || []).forEach(function(d) {
    (_vv.docs[d.Vehiculo_Id] = _vv.docs[d.Vehiculo_Id] || {})[d.Documento] = d;
  });
  _vv.avisos = res[2].data || [];
}

async function vvCargar() {
  vvEl('load-zone').style.display = '';
  vvEl('main').style.display = 'none';
  vvEl('btn-retry').style.display = 'none';
  vvEl('load-error').textContent = '';
  try {
    await _authReady;
    _vv.puedeEditar = vvPuedeEditar();
    await vvLeerDatos();
    vvEl('btn-nuevo').style.display = _vv.puedeEditar ? '' : 'none';
    vvEl('btn-aviso').style.display = _vv.puedeEditar ? '' : 'none';
    vvEl('th-accion').style.display = _vv.puedeEditar ? '' : 'none';
    vvEl('load-zone').style.display = 'none';
    vvEl('main').style.display = 'block';
    vvRender();
    vvRenderAvisos();
    setSyncStatus('ok', 'Conectado a la nube. Los cambios se guardan automáticamente.');
  } catch (err) {
    vvEl('load-error').textContent = err.message;
    vvEl('btn-retry').style.display = '';
    setSyncStatus('error', 'Error al conectar');
  }
}

// ── Filtro y orden ──
function vvFiltrados() {
  var txt = vvNorm(vvEl('f-txt').value).trim();
  var est = vvEl('f-estado').value;
  var verInactivos = vvEl('f-inactivos').checked;
  var filas = _vv.vehiculos.filter(function(v) {
    if (!v.Activo && !verInactivos) return false;
    if (txt) {
      var hay = vvNorm(v.Placa + ' ' + v.Propietario + ' ' + v.Identificacion);
      if (hay.indexOf(txt) < 0) return false;
    }
    if (est && vvEstadoDias(vvDiasMinimos(v)) !== est) return false;
    return true;
  });
  // Lo más urgente primero; sin fecha al final; luego por placa.
  filas.sort(function(a, b) {
    var da = vvDiasMinimos(a), db = vvDiasMinimos(b);
    if (da === null && db !== null) return 1;
    if (db === null && da !== null) return -1;
    if (da !== db && da !== null) return da - db;
    return a.Placa.localeCompare(b.Placa, 'es');
  });
  return filas;
}

function vvLimpiarFiltros() {
  vvEl('f-txt').value = '';
  vvEl('f-estado').value = '';
  vvEl('f-inactivos').checked = false;
  vvRender();
}

// ── Render ──
function vvCeldaDoc(v, tipo) {
  var d = (_vv.docs[v.id] || {})[tipo];
  if (!d) return '<div class="vv-doc"><span class="vv-pill sin">Sin fecha</span></div>';
  var dias = vvDias(d.Fecha_Vencimiento);
  return '<div class="vv-doc"><div class="vv-f">' + escHtml(fmtDate(d.Fecha_Vencimiento)) + '</div>' +
         '<span class="vv-pill ' + vvEstadoDias(dias) + '">' + escHtml(vvTextoDias(dias)) + '</span></div>';
}

function vvResumen() {
  var r = { activos: 0, venc: 0, urg: 0, prox: 0, vig: 0 };
  _vv.vehiculos.forEach(function(v) {
    if (!v.Activo) return;
    r.activos++;
    var d = _vv.docs[v.id] || {};
    VV_DOCS.forEach(function(t) {
      if (!d[t.key]) return;
      r[vvEstadoDias(vvDias(d[t.key].Fecha_Vencimiento))]++;
    });
  });
  return r;
}

function vvRender() {
  var r = vvResumen();
  vvEl('s-total').textContent = r.activos;
  vvEl('s-venc').textContent = r.venc;
  vvEl('s-urg').textContent = r.urg;
  vvEl('s-prox').textContent = r.prox;
  vvEl('s-vig').textContent = r.vig;

  var filas = vvFiltrados();
  vvEl('row-ct').textContent = '(' + filas.length + ' vehículo' + (filas.length !== 1 ? 's' : '') + ')';
  var cols = _vv.puedeEditar ? 7 : 6;
  if (!filas.length) {
    vvEl('t-body').innerHTML = '<tr><td colspan="' + cols + '"><div class="empty">' +
      (_vv.vehiculos.length ? 'No hay vehículos que coincidan con los filtros.' : 'Todavía no hay vehículos cargados.') + '</div></td></tr>';
    return;
  }
  vvEl('t-body').innerHTML = filas.map(function(v, i) {
    var accion = _vv.puedeEditar
      ? '<td><button onclick="vvAbrirEditar(' + Number(v.id) + ')" title="Editar" style="background:#1a5276;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600">✏️ Editar</button></td>'
      : '';
    return '<tr' + (v.Activo ? '' : ' class="vv-inactivo"') + '>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i + 1) + '</td>' +
      '<td style="font-weight:700">' + escHtml(v.Placa) + (v.Activo ? '' : ' <span class="vv-pill sin">Inactivo</span>') + '</td>' +
      '<td>' + (escHtml(v.Propietario) || '<span style="color:#a0aec0">—</span>') + '</td>' +
      '<td>' + (escHtml(v.Identificacion) || '<span style="color:#a0aec0">—</span>') + '</td>' +
      '<td>' + vvCeldaDoc(v, 'SOAT') + '</td>' +
      '<td>' + vvCeldaDoc(v, 'TECNOMECANICA') + '</td>' +
      accion + '</tr>';
  }).join('');
}

function vvFechaHora(ts) {
  var d = new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function vvRenderAvisos() {
  vvEl('av-ct').textContent = _vv.avisos.length ? '(últimos ' + _vv.avisos.length + ')' : '';
  if (!_vv.avisos.length) {
    vvEl('av-body').innerHTML = '<tr><td colspan="6"><div class="empty">Todavía no se ha enviado ningún aviso.</div></td></tr>';
    return;
  }
  vvEl('av-body').innerHTML = _vv.avisos.map(function(a, i) {
    var ok = a.Estado === 'enviado';
    return '<tr>' +
      '<td style="white-space:nowrap">' + escHtml(vvFechaHora(a.Creado_En)) + '</td>' +
      '<td>' + (a.Origen === 'manual' ? '🖐 Manual' : '⏰ Automático') + '</td>' +
      '<td><span class="vv-pill ' + (ok ? 'vig' : 'venc') + '">' + (ok ? 'Enviado' : 'Con error') + '</span></td>' +
      '<td style="text-align:center">' + Number(a.Documentos || 0) + '</td>' +
      '<td>' + (a.Enviado_Por_Nombre ? escHtml(a.Enviado_Por_Nombre) : '<span style="color:#a0aec0">Automático</span>') + '</td>' +
      '<td><button onclick="vvVerMensaje(' + i + ')" style="background:none;border:1px solid #cbd5e0;color:#4a5568;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:0.76rem;font-weight:600">Ver mensaje</button></td>' +
      '</tr>';
  }).join('');
}

// ── Agregar / editar ──
function vvAdvertencia(msg) {
  var w = vvEl('ed-warn');
  w.textContent = msg || '';
  w.style.display = msg ? 'block' : 'none';
}

function vvAbrirNuevo() {
  if (!_vv.puedeEditar) return;
  _vv.editId = null;
  vvEl('ed-titulo').textContent = '➕ Agregar vehículo';
  vvEl('ed-placa').value = '';
  vvEl('ed-prop').value = '';
  vvEl('ed-ident').value = '';
  vvEl('ed-soat').value = '';
  vvEl('ed-tec').value = '';
  vvEl('ed-activo').checked = true;
  vvEl('ed-audit').innerHTML = '';
  vvAdvertencia('');
  vvEl('edit-overlay').style.display = 'flex';
  setTimeout(function() { vvEl('ed-placa').focus(); }, 50);
}

function vvAbrirEditar(id) {
  if (!_vv.puedeEditar) return;
  var v = _vv.vehiculos.find(function(x) { return x.id === id; });
  if (!v) return;
  var d = _vv.docs[id] || {};
  _vv.editId = id;
  vvEl('ed-titulo').textContent = '✏️ Editar vehículo ' + v.Placa;
  vvEl('ed-placa').value = v.Placa;
  vvEl('ed-prop').value = v.Propietario || '';
  vvEl('ed-ident').value = v.Identificacion || '';
  vvEl('ed-soat').value = d.SOAT ? d.SOAT.Fecha_Vencimiento : '';
  vvEl('ed-tec').value = d.TECNOMECANICA ? d.TECNOMECANICA.Fecha_Vencimiento : '';
  vvEl('ed-activo').checked = !!v.Activo;
  vvEl('ed-audit').innerHTML = _auditoriaHtml(v, false);
  vvAdvertencia('');
  vvEl('edit-overlay').style.display = 'flex';
  setTimeout(function() { vvEl('ed-placa').focus(); }, 50);
}

function vvCerrarEdicion() {
  vvEl('edit-overlay').style.display = 'none';
  _vv.editId = null;
}

// Devuelve { error } o los valores listos para enviar. No toca la base.
function vvValidarFormulario() {
  var placa = vvNormPlaca(vvEl('ed-placa').value);
  if (!placa) return { error: 'Escribe la placa' };
  if (!/^[A-Z0-9-]{3,10}$/.test(placa)) return { error: 'La placa solo puede llevar letras, números y guion (3 a 10 caracteres)' };
  var dup = _vv.vehiculos.find(function(v) { return v.id !== _vv.editId && v.Placa === placa; });
  if (dup) return { error: 'Ya existe un vehículo con la placa ' + placa };
  var soatEl = vvEl('ed-soat'), tecEl = vvEl('ed-tec');
  if ((soatEl.validity && soatEl.validity.badInput) || (tecEl.validity && tecEl.validity.badInput)) {
    return { error: 'Revisa las fechas: alguna no es válida' };
  }
  var rango = /^(20\d{2}|2100)-\d{2}-\d{2}$/;
  if ((soatEl.value && !rango.test(soatEl.value)) || (tecEl.value && !rango.test(tecEl.value))) {
    return { error: 'Las fechas deben estar entre 2000 y 2100' };
  }
  return {
    placa: placa,
    propietario: vvEl('ed-prop').value.trim().replace(/\s+/g, ' '),
    identificacion: vvEl('ed-ident').value.trim(),
    activo: vvEl('ed-activo').checked,
    soat: soatEl.value || null,
    tec: tecEl.value || null
  };
}

function vvErrorGuardar(err) {
  if (!err) return 'No se pudo guardar';
  if (err.code === '23505') return 'Ya existe un vehículo con esa placa';
  if (err.code === '42501' || /row-level security|permission denied/i.test(err.message || '')) return 'No tienes permiso para modificar los vencimientos';
  if (err.code === 'P0002') return 'No se encontró el vehículo, o no tienes permiso para modificarlo';
  if (err.code === '23514') return 'Algún dato no cumple las reglas (placa o fechas)';
  return err.message || 'No se pudo guardar';
}

async function vvGuardar() {
  var f = vvValidarFormulario();
  if (f.error) { vvAdvertencia('⚠️ ' + f.error); return; }
  vvAdvertencia('');
  var btn = vvEl('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';
  var nuevo = !_vv.editId;
  try {
    var res = await _sb.rpc('guardar_vehiculo_vencimiento', {
      p_id: _vv.editId,
      p_placa: f.placa,
      p_propietario: f.propietario,
      p_identificacion: f.identificacion,
      p_activo: f.activo,
      p_soat: f.soat,
      p_tecnomecanica: f.tec
    });
    if (res.error) throw res.error;
    await vvLeerDatos();
    vvCerrarEdicion();
    vvRender();
    showToast(nuevo ? '✅ Vehículo agregado' : '✅ Vehículo actualizado');
  } catch (err) {
    vvAdvertencia('❌ ' + vvErrorGuardar(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Guardar';
  }
}

// ── Edge Function (con el mensaje de error legible) ──
async function vvInvocarAviso(action) {
  var res = await _sb.functions.invoke('vencimientos-vehiculos-aviso', { body: { action: action }, region: VV_REGION_FUNCION });
  if (res.error) {
    var msg = 'No se pudo completar la operación';
    try {
      var j = await res.error.context.json();
      if (j && j.error) msg = j.error;
    } catch (_e) { /* sin cuerpo legible */ }
    throw new Error(msg);
  }
  if (!res.data) throw new Error('Respuesta inesperada del servidor');
  return res.data;
}

// ── Enviar aviso ahora ──
function vvAvisoError(msg) {
  var e = vvEl('aviso-error');
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}

async function vvAbrirAviso() {
  if (!_vv.puedeEditar) return;
  _vv.avisoListo = false;
  vvEl('btn-aviso-ok').disabled = true;
  vvEl('aviso-texto').style.display = 'none';
  vvEl('aviso-texto').textContent = '';
  vvEl('aviso-estado').textContent = '⏳ Preparando el resumen…';
  vvAvisoError('');
  vvEl('aviso-overlay').style.display = 'flex';
  try {
    var r = await vvInvocarAviso('vista_previa');
    if (!r.documentos) {
      vvEl('aviso-estado').textContent = r.motivo || 'No hay documentos vencidos ni por vencer en los próximos 30 días.';
      return;
    }
    vvEl('aviso-estado').textContent = 'Se enviará este mensaje (' + r.documentos + ' documento' + (r.documentos !== 1 ? 's' : '') + '):';
    vvEl('aviso-texto').textContent = r.texto;
    vvEl('aviso-texto').style.display = 'block';
    _vv.avisoListo = true;
    vvEl('btn-aviso-ok').disabled = false;
  } catch (err) {
    vvEl('aviso-estado').textContent = 'No se pudo preparar el resumen.';
    vvAvisoError('❌ ' + err.message);
  }
}

function vvCerrarAviso() {
  if (_vv.enviando) return;
  vvEl('aviso-overlay').style.display = 'none';
}

async function vvRecargarAvisos() {
  var r = await _sb.from('VehiculosVencimientosAvisos').select('*').order('Creado_En', { ascending: false }).limit(50);
  if (!r.error) { _vv.avisos = r.data || []; vvRenderAvisos(); }
}

async function vvEnviarAviso() {
  if (!_vv.avisoListo || _vv.enviando) return;
  _vv.enviando = true;
  var btn = vvEl('btn-aviso-ok');
  btn.disabled = true;
  btn.textContent = '⏳ Enviando...';
  vvAvisoError('');
  try {
    var r = await vvInvocarAviso('enviar');
    _vv.enviando = false;
    vvEl('aviso-overlay').style.display = 'none';
    showToast('✅ Aviso enviado al grupo (' + (r.documentos || 0) + ' documento' + (r.documentos !== 1 ? 's' : '') + ')');
  } catch (err) {
    _vv.enviando = false;
    vvAvisoError('❌ ' + err.message);
    btn.disabled = false;
  } finally {
    _vv.enviando = false;
    btn.textContent = '📲 Enviar al grupo';
    vvRecargarAvisos();   // el intento (bueno o fallido) queda en el historial
  }
}

// ── Historial: ver un aviso ──
function vvVerMensaje(i) {
  var a = _vv.avisos[i];
  if (!a) return;
  vvEl('msg-meta').textContent = vvFechaHora(a.Creado_En) + ' · ' + (a.Origen === 'manual' ? 'Manual' : 'Automático') +
    ' · ' + (a.Estado === 'enviado' ? 'Enviado' : 'Con error');
  vvEl('msg-texto').textContent = a.Mensaje || '';
  var e = vvEl('msg-error');
  e.textContent = a.Error ? 'Error: ' + a.Error : '';
  e.style.display = a.Error ? 'block' : 'none';
  vvEl('msg-overlay').style.display = 'flex';
}

function vvCerrarMensaje() { vvEl('msg-overlay').style.display = 'none'; }

// ── Eventos ──
vvEl('f-txt').addEventListener('input', debounce(vvRender, 200));
vvEl('f-estado').addEventListener('change', vvRender);
vvEl('f-inactivos').addEventListener('change', vvRender);
['edit-overlay', 'msg-overlay'].forEach(function(id) {
  vvEl(id).addEventListener('click', function(e) {
    if (!isBackdropClick(e)) return;
    if (id === 'edit-overlay') vvCerrarEdicion(); else vvCerrarMensaje();
  });
});
vvEl('aviso-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) vvCerrarAviso(); });
['ed-placa', 'ed-prop', 'ed-ident'].forEach(function(id) {
  vvEl(id).addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); vvGuardar(); } });
});

// ── Init ──
vvCargar();
