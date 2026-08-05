// ── State ──
var usrList = [];
var usrEmpresas = {};
var usrModulos = {};
var toggleUsrId = null;
var toggleUsrActivo = false;

// ── Load ──
async function loadUsuarios() {
  await _authReady;

  if (!AUTH.canManageUsers()) {
    document.getElementById('load-zone').innerHTML =
      '<div style="font-size:2.5rem;margin-bottom:12px">🔒</div>' +
      '<h2 style="color:#e74c3c">Acceso denegado</h2>' +
      '<p>Solo los administradores pueden gestionar usuarios.</p>' +
      '<a href="index.html" style="display:inline-block;margin-top:16px;background:#1a5276;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">Volver al inicio</a>';
    return;
  }

  var loadZone = document.getElementById('load-zone');
  var mainEl = document.getElementById('main');

  if (mainEl.style.display === 'block') {
    setSyncStatus('syncing', 'Actualizando...');
  } else {
    loadZone.style.display = 'block';
  }

  try {
    var _usrResults = await Promise.all([
      _sb.from('usuarios').select('*').order('created_at'),
      _sb.from('usuario_empresas').select('usuario_id, empresa_sigla, empresas(nombre_completo)'),
      _sb.from('usuario_modulos').select('usuario_id, modulo')
    ]);
    var res = _usrResults[0];
    var ueRes = _usrResults[1];
    var umRes = _usrResults[2];
    if (res.error) throw new Error(res.error.message);
    if (ueRes.error) throw new Error(ueRes.error.message);
    if (umRes.error) throw new Error(umRes.error.message);

    usrList = res.data || [];

    usrEmpresas = {};
    (ueRes.data || []).forEach(function(r) {
      if (!usrEmpresas[r.usuario_id]) usrEmpresas[r.usuario_id] = [];
      usrEmpresas[r.usuario_id].push({
        sigla: r.empresa_sigla,
        nombre: r.empresas ? r.empresas.nombre_completo : r.empresa_sigla
      });
    });

    usrModulos = {};
    (umRes.data || []).forEach(function(r) {
      if (!usrModulos[r.usuario_id]) usrModulos[r.usuario_id] = [];
      usrModulos[r.usuario_id].push(r.modulo);
    });

    renderUsuariosTable();
    updateStats();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
  } catch (err) {
    if (mainEl.style.display === 'block') {
      setSyncStatus('error', 'Error: ' + err.message);
    } else {
      document.getElementById('load-spinner').style.display = 'none';
      var errEl = document.getElementById('load-error');
      errEl.textContent = '⚠️ ' + err.message;
      errEl.style.display = 'block';
      document.getElementById('btn-retry').style.display = 'inline-block';
    }
  }
}

function updateStats() {
  var total = usrList.length;
  var admins = 0, editors = 0, readers = 0;
  usrList.forEach(function(u) {
    if (u.rol === 'admin') admins++;
    else if (u.rol === 'editor') editors++;
    else readers++;
  });
  document.getElementById('s-total').textContent = total;
  document.getElementById('s-admins').textContent = admins;
  document.getElementById('s-editors').textContent = editors;
  document.getElementById('s-readers').textContent = readers;
}

// ── Render ──
function renderUsuariosTable() {
  document.getElementById('row-ct-usr').textContent = '(' + usrList.length + ')';
  var tbody = document.getElementById('t-body-usr');

  if (!usrList.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div style="text-align:center;padding:32px;color:#718096">No hay usuarios registrados.</div></td></tr>';
    return;
  }

  var ROL_BADGES = {
    admin: '<span style="background:#e74c3c;color:white;padding:2px 10px;border-radius:12px;font-size:0.74rem;font-weight:700">Admin</span>',
    editor: '<span style="background:#27ae60;color:white;padding:2px 10px;border-radius:12px;font-size:0.74rem;font-weight:700">Editor</span>',
    lector: '<span style="background:#f39c12;color:white;padding:2px 10px;border-radius:12px;font-size:0.74rem;font-weight:700">Lector</span>'
  };

  tbody.innerHTML = usrList.map(function(u, i) {
    var emps = usrEmpresas[u.id] || [];
    var empBadges = emps.map(function(e) {
      return '<span class="sigla-badge sigla-' + e.sigla + '" style="font-size:0.7rem;padding:1px 7px;margin:1px">' + e.sigla + '</span>';
    }).join(' ');
    if (!empBadges) empBadges = '<span style="color:#a0aec0;font-size:0.78rem">Sin asignar</span>';

    var estadoBadge = u.activo
      ? '<span style="background:#d4edda;color:#155724;padding:2px 10px;border-radius:12px;font-size:0.74rem;font-weight:700">Activo</span>'
      : '<span style="background:#f8d7da;color:#721c24;padding:2px 10px;border-radius:12px;font-size:0.74rem;font-weight:700">Inactivo</span>';

    var currentUser = AUTH.getUser();
    var isSelf = currentUser && currentUser.id === u.id;

    return '<tr' + (!u.activo ? ' style="opacity:0.5"' : '') + '>' +
      '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
      '<td style="font-weight:600">' + (u.nombre || '—') + '</td>' +
      '<td style="font-size:0.82rem">' + (u.email || '—') + '</td>' +
      '<td>' + (ROL_BADGES[u.rol] || u.rol) + '</td>' +
      '<td style="max-width:200px">' + empBadges + '</td>' +
      '<td>' + estadoBadge + '</td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        '<button class="btn-edit" onclick="openEditUser(\'' + u.id + '\')" title="Editar">✏️</button>' +
        (!isSelf ? '<button class="btn-del" onclick="openToggleUser(\'' + u.id + '\',' + (u.activo ? 'true' : 'false') + ')" title="' + (u.activo ? 'Desactivar' : 'Activar') + '">' + (u.activo ? '🔒' : '🔓') + '</button>' : '') +
        '<button onclick="resetUserPassword(\'' + u.id + '\',\'' + (u.email || '').replace(/'/g, "\\'") + '\')" title="Enviar reset de contraseña" style="background:none;border:1px solid #cbd5e0;border-radius:5px;cursor:pointer;padding:3px 8px;font-size:0.78rem">🔑</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── New / Edit User Modal ──
function openNewUser() {
  document.getElementById('usr-modal-title').textContent = '➕ Nuevo Usuario';
  document.getElementById('usr-edit-id').value = '';
  document.getElementById('usr-nombre').value = '';
  document.getElementById('usr-email').value = '';
  document.getElementById('usr-email').disabled = false;
  document.getElementById('usr-password').value = '';
  document.getElementById('usr-pass-group').style.display = '';
  document.getElementById('usr-rol').value = 'editor';
  document.getElementById('usr-comercial-codigo').value = '';
  document.getElementById('btn-save-usr').disabled = false;
  document.getElementById('btn-save-usr').textContent = '✓ Crear usuario';
  renderEmpresaChecks([]);
  renderModuloChecks([], 'editor');
  document.getElementById('usr-overlay').classList.add('show');
}

function openEditUser(userId) {
  var u = usrList.find(function(x) { return x.id === userId; });
  if (!u) return;
  document.getElementById('usr-modal-title').textContent = '✏️ Editar Usuario';
  document.getElementById('usr-edit-id').value = userId;
  document.getElementById('usr-nombre').value = u.nombre || '';
  document.getElementById('usr-email').value = u.email || '';
  document.getElementById('usr-email').disabled = true;
  document.getElementById('usr-password').value = '';
  document.getElementById('usr-pass-group').style.display = 'none';
  document.getElementById('usr-rol').value = u.rol || 'lector';
  document.getElementById('usr-comercial-codigo').value = u.comercial_codigo || '';
  document.getElementById('btn-save-usr').disabled = false;
  document.getElementById('btn-save-usr').textContent = '✓ Guardar cambios';
  var userEmps = (usrEmpresas[userId] || []).map(function(e) { return e.sigla; });
  renderEmpresaChecks(userEmps);
  renderModuloChecks(usrModulos[userId] || [], u.rol || 'lector');
  document.getElementById('usr-overlay').classList.add('show');
}

function renderEmpresaChecks(selectedSiglas) {
  var container = document.getElementById('usr-empresas-checks');
  container.innerHTML = EMPRESAS_HOLDING.map(function(e) {
    var checked = selectedSiglas.indexOf(e.sigla) >= 0 ? ' checked' : '';
    return '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;padding:6px 10px;background:#f7fafc;border-radius:6px;border:1px solid #e2e8f0">' +
      '<input type="checkbox" class="usr-emp-check" value="' + e.sigla + '"' + checked + '>' +
      '<span class="sigla-badge sigla-' + e.sigla + '" style="font-size:0.72rem;padding:1px 7px">' + e.sigla + '</span> ' +
      '<span style="font-size:0.78rem;color:#4a5568">' + e.value.split(' ')[0] + '</span>' +
    '</label>';
  }).join('');
}

// Dependencias: si se marca la clave, también deben quedar marcadas las de la lista.
var MODULE_DEPENDS_ON = {
  muestras_aprobar: ['muestras'],
  ordenes_aprobar:  ['ordenes']
};

function renderModuloChecks(selectedKeys, rol) {
  var container = document.getElementById('usr-modulos-checks');
  var hint = document.getElementById('usr-modulos-hint');
  var isAdmin = rol === 'admin';
  container.innerHTML = AUTH.getAllModules().map(function(m) {
    // Para admins pre-marcamos y deshabilitamos: no se persisten filas para admins.
    var checked = (isAdmin || selectedKeys.indexOf(m.key) >= 0) ? ' checked' : '';
    var disabled = isAdmin ? ' disabled' : '';
    return '<label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer;padding:6px 10px;background:#f7fafc;border-radius:6px;border:1px solid #e2e8f0' + (isAdmin ? ';opacity:0.6' : '') + '">' +
      '<input type="checkbox" class="usr-mod-check" value="' + m.key + '"' + checked + disabled + '>' +
      '<span style="font-size:0.82rem;color:#2d3748">' + m.label + '</span>' +
    '</label>';
  }).join('');
  hint.style.display = isAdmin ? 'block' : 'none';
  _wireModuleDependencies();
}

// Aplica MODULE_DEPENDS_ON: marcar un dependiente marca automáticamente sus requisitos;
// desmarcar un requisito desmarca a quienes dependen de él.
function _wireModuleDependencies() {
  var checks = {};
  document.querySelectorAll('.usr-mod-check').forEach(function(cb) { checks[cb.value] = cb; });

  Object.keys(MODULE_DEPENDS_ON).forEach(function(depKey) {
    var depCb = checks[depKey];
    if (!depCb) return;
    var requiredKeys = MODULE_DEPENDS_ON[depKey];

    depCb.addEventListener('change', function() {
      if (depCb.checked) {
        requiredKeys.forEach(function(req) {
          if (checks[req] && !checks[req].checked) checks[req].checked = true;
        });
      }
    });

    requiredKeys.forEach(function(req) {
      var reqCb = checks[req];
      if (!reqCb) return;
      reqCb.addEventListener('change', function() {
        if (!reqCb.checked && depCb.checked) depCb.checked = false;
      });
    });
  });
}

function toggleAllModulos(on) {
  document.querySelectorAll('.usr-mod-check').forEach(function(cb) {
    if (!cb.disabled) cb.checked = !!on;
  });
}

// Al cambiar el rol en el modal, re-renderizar módulos (admin vs editor/lector)
document.getElementById('usr-rol').addEventListener('change', function() {
  var current = [];
  document.querySelectorAll('.usr-mod-check:checked').forEach(function(cb) { current.push(cb.value); });
  renderModuloChecks(current, this.value);
});

function closeUserModal() {
  document.getElementById('usr-overlay').classList.remove('show');
}
document.getElementById('usr-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeUserModal(); });

async function saveUser() {
  var editId = document.getElementById('usr-edit-id').value;
  var nombre = document.getElementById('usr-nombre').value.trim();
  var email = document.getElementById('usr-email').value.trim();
  var password = document.getElementById('usr-password').value;
  var rol = document.getElementById('usr-rol').value;

  if (!nombre) { showToast('Ingresa el nombre', '#e74c3c'); return; }
  if (!email) { showToast('Ingresa el correo electrónico', '#e74c3c'); return; }

  var selectedEmps = [];
  document.querySelectorAll('.usr-emp-check:checked').forEach(function(cb) {
    selectedEmps.push(cb.value);
  });

  var selectedMods = [];
  document.querySelectorAll('.usr-mod-check:checked').forEach(function(cb) {
    if (!cb.disabled) selectedMods.push(cb.value);
  });

  if (rol !== 'admin' && !selectedEmps.length) {
    showToast('Asigna al menos una empresa (o selecciona rol Admin)', '#e74c3c');
    return;
  }

  if (rol !== 'admin' && !selectedMods.length) {
    showToast('Asigna al menos un módulo (o selecciona rol Admin)', '#e74c3c');
    return;
  }

  if (rol !== 'admin') {
    for (var depKey in MODULE_DEPENDS_ON) {
      if (selectedMods.indexOf(depKey) < 0) continue;
      var faltan = MODULE_DEPENDS_ON[depKey].filter(function(req) { return selectedMods.indexOf(req) < 0; });
      if (faltan.length) {
        showToast('El módulo "' + depKey + '" requiere: ' + faltan.join(', '), '#e74c3c');
        return;
      }
    }
  }

  // Código de comercial (opcional): sólo tiene sentido para rol comercial pero
  // se persiste en cualquier rol; NULL cuando el input está vacío.
  var comercialCodigoRaw = document.getElementById('usr-comercial-codigo').value.trim();
  var comercialCodigo = comercialCodigoRaw ? comercialCodigoRaw : null;

  var btn = document.getElementById('btn-save-usr');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    if (editId) {
      var res = await _sb.from('usuarios').update({
        nombre: nombre,
        rol: rol,
        comercial_codigo: comercialCodigo,
        modificado_por: _uid()
      }).eq('id', editId);
      if (res.error) throw new Error(res.error.message);

      var delRes = await _sb.from('usuario_empresas').delete().eq('usuario_id', editId);
      if (delRes.error) throw new Error(delRes.error.message);

      if (selectedEmps.length) {
        var rows = selectedEmps.map(function(s) {
          return { usuario_id: editId, empresa_sigla: s };
        });
        var insRes = await _sb.from('usuario_empresas').insert(rows);
        if (insRes.error) throw new Error(insRes.error.message);
      }

      var delModRes = await _sb.from('usuario_modulos').delete().eq('usuario_id', editId);
      if (delModRes.error) throw new Error(delModRes.error.message);

      if (rol !== 'admin' && selectedMods.length) {
        var modRows = selectedMods.map(function(m) {
          return { usuario_id: editId, modulo: m };
        });
        var insModRes = await _sb.from('usuario_modulos').insert(modRows);
        if (insModRes.error) throw new Error(insModRes.error.message);
      }

      closeUserModal();
      showToast('✅ Usuario actualizado');
      await loadUsuarios();
    } else {
      if (!password || password.length < 6) {
        showToast('La contraseña debe tener al menos 6 caracteres', '#e74c3c');
        btn.disabled = false;
        btn.textContent = '✓ Crear usuario';
        return;
      }

      var fnRes = await _sb.functions.invoke('create-user', {
        body: { email: email, password: password }
      });

      if (fnRes.error) throw new Error(fnRes.error.message || 'Error al crear usuario en Auth');
      var newUserId = fnRes.data && fnRes.data.user_id;
      if (!newUserId) throw new Error('No se recibió el ID del usuario creado');

      var usrRes = await _sb.from('usuarios').insert([{
        id: newUserId,
        email: email,
        nombre: nombre,
        rol: rol,
        comercial_codigo: comercialCodigo,
        activo: true,
        creado_por: _uid()
      }]);
      if (usrRes.error) throw new Error(usrRes.error.message);

      if (selectedEmps.length) {
        var rows = selectedEmps.map(function(s) {
          return { usuario_id: newUserId, empresa_sigla: s };
        });
        var ueRes = await _sb.from('usuario_empresas').insert(rows);
        if (ueRes.error) throw new Error(ueRes.error.message);
      }

      if (rol !== 'admin' && selectedMods.length) {
        var modRows = selectedMods.map(function(m) {
          return { usuario_id: newUserId, modulo: m };
        });
        var umRes = await _sb.from('usuario_modulos').insert(modRows);
        if (umRes.error) throw new Error(umRes.error.message);
      }

      closeUserModal();
      showToast('✅ Usuario creado exitosamente');
      await loadUsuarios();
    }
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = editId ? '✓ Guardar cambios' : '✓ Crear usuario';
  }
}

// ── Toggle user status ──
function openToggleUser(userId, isActive) {
  toggleUsrId = userId;
  toggleUsrActivo = isActive;
  var u = usrList.find(function(x) { return x.id === userId; });
  var name = u ? (u.nombre || u.email) : userId;

  if (isActive) {
    document.getElementById('del-usr-msg').textContent = '¿Desactivar a ' + name + '?';
    document.getElementById('del-usr-detail').innerHTML = 'El usuario no podrá iniciar sesión hasta que sea reactivado.';
    document.getElementById('btn-del-usr-confirm').textContent = '🔒 Desactivar';
    document.getElementById('btn-del-usr-confirm').style.background = '#e74c3c';
  } else {
    document.getElementById('del-usr-msg').textContent = '¿Reactivar a ' + name + '?';
    document.getElementById('del-usr-detail').innerHTML = 'El usuario podrá iniciar sesión nuevamente.';
    document.getElementById('btn-del-usr-confirm').textContent = '🔓 Reactivar';
    document.getElementById('btn-del-usr-confirm').style.background = '#27ae60';
  }
  document.getElementById('btn-del-usr-confirm').disabled = false;
  document.getElementById('del-usr-overlay').classList.add('show');
}

function closeDeleteUser() {
  document.getElementById('del-usr-overlay').classList.remove('show');
  toggleUsrId = null;
}
document.getElementById('del-usr-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDeleteUser(); });

async function confirmToggleUser() {
  if (!toggleUsrId) return;
  var btn = document.getElementById('btn-del-usr-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Procesando...';

  try {
    var newStatus = !toggleUsrActivo;
    var res = await _sb.from('usuarios').update({ activo: newStatus, modificado_por: _uid() }).eq('id', toggleUsrId);
    if (res.error) throw new Error(res.error.message);
    closeDeleteUser();
    showToast(newStatus ? '🔓 Usuario reactivado' : '🔒 Usuario desactivado');
    await loadUsuarios();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = toggleUsrActivo ? '🔒 Desactivar' : '🔓 Reactivar';
  }
}

// ── Reset password ──
async function resetUserPassword(userId, email) {
  if (!email) { showToast('No se encontró el email del usuario', '#e74c3c'); return; }
  try {
    var res = await _sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname.replace('usuarios.html', 'index.html')
    });
    if (res.error) throw new Error(res.error.message);
    showToast('🔑 Email de recuperación enviado a ' + email);
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
  }
}

// ── Init ──
loadUsuarios();
