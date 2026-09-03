// ── Auth Module ──
var AUTH = (function() {
  var _user = null;
  var _profile = null;
  var _companies = [];
  var _modules = [];
  var _ready = null;

  // Catálogo de módulos gestionables por permiso.
  // Debe coincidir con el CHECK constraint de supabase/usuario_modulos.sql
  var ALL_MODULES = [
    { key: 'pedidos',      label: '📋 Pedidos' },
    { key: 'ingresos',     label: '📥 Ingresos' },
    { key: 'ordenes',      label: '🛒 Órdenes' },
    { key: 'devoluciones', label: '🔄 Devoluciones y Cambios' },
    { key: 'inventario',   label: '📊 Inventario' },
    { key: 'kardex',       label: '📋 Kardex' },
    { key: 'muestras',     label: '🧪 Muestras' },
    { key: 'reenvases',    label: '🏭 Salidas a producción' },
    { key: 'lista_precios', label: '💲 Lista de Precios' },
    { key: 'productos',    label: '📦 Productos' },
    { key: 'reportes',     label: '📈 Reportes' },
    { key: 'dashboard',    label: '📊 Dashboard' },
    { key: 'muestras_aprobar',       label: '✅ Aprobar solicitudes de muestras' },
    { key: 'ordenes_aprobar',        label: '✅ Aprobar órdenes de compra' },
    { key: 'pedidos_editar_cantidad', label: '✏️ Editar cantidad pedida' },
    { key: 'clientes',                  label: '👥 Clientes' },
    { key: 'notificaciones',          label: '🔔 Notificaciones' }
  ];

  function init() {
    if (_ready) return _ready;
    _ready = _init();
    return _ready;
  }

  // Corre `promise` contra un límite de tiempo. Si se agota, rechaza con Error('auth-timeout').
  // Evita que un servicio de Supabase caído deje la app colgada en "Conectando con la nube...".
  function _withTimeout(promise, ms) {
    return new Promise(function(resolve, reject) {
      var done = false;
      var t = setTimeout(function() {
        if (!done) { done = true; reject(new Error('auth-timeout')); }
      }, ms);
      promise.then(
        function(v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function(e) { if (!done) { done = true; clearTimeout(t); reject(e); } }
      );
    });
  }

  // Muestra una pantalla de "sin conexión / reintentar" en vez del spinner infinito.
  function _showAuthError(msg) {
    var lz = document.getElementById('load-zone');
    var main = document.getElementById('main');
    if (lz) {
      var sp = document.getElementById('load-spinner');
      if (sp) sp.style.display = 'none';
      var h = lz.querySelector('h2'); if (h) h.textContent = 'Sin conexión con la nube';
      var p = lz.querySelector('p'); if (p) p.textContent = msg;
      var le = document.getElementById('load-error');
      if (le) le.textContent = 'El servicio puede estar temporalmente caído. Revisa tu conexión o inténtalo de nuevo en unos minutos.';
      var rb = document.getElementById('btn-retry');
      if (rb) { rb.style.display = ''; rb.textContent = '🔄 Reintentar'; rb.onclick = function() { location.reload(); }; }
      lz.style.display = '';
      if (main) main.style.display = 'none';
      return;
    }
    if (document.getElementById('auth-error-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'auth-error-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f7fafc;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:inherit';
    ov.innerHTML =
      '<div style="font-size:2.4rem;margin-bottom:10px">☁️⚠️</div>' +
      '<h2 style="color:#2d3748;margin:0 0 8px;font-size:1.15rem">Sin conexión con la nube</h2>' +
      '<p style="color:#718096;max-width:420px;margin:0 0 18px;font-size:0.9rem">' + msg +
      ' El servicio puede estar temporalmente caído; inténtalo de nuevo en unos minutos.</p>' +
      '<button style="background:#1a5276;color:#fff;border:none;padding:10px 22px;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:700">🔄 Reintentar</button>';
    ov.querySelector('button').onclick = function() { location.reload(); };
    document.body.appendChild(ov);
    if (main) main.style.display = 'none';
  }

  async function _init() {
    var isLoginPage = location.pathname.endsWith('login.html');
    var authErrored = false;

    try {
      var sess;
      try {
        sess = await _withTimeout(_sb.auth.getSession(), 8000);
      } catch (e) {
        if (!isLoginPage) { authErrored = true; _showAuthError('No se pudo conectar con el servicio de autenticación.'); }
        return;
      }
      var data = sess.data;

      if (!data.session) {
        if (!isLoginPage) {
          location.replace('login.html');
          return new Promise(function() {});
        }
        return;
      }

      _user = data.session.user;

      var authResults;
      try {
        authResults = await _withTimeout(Promise.all([
          _sb.from('usuarios')
            .select('*')
            .eq('id', _user.id)
            .eq('activo', true)
            .single(),
          _sb.from('usuario_empresas')
            .select('empresa_sigla, codigo_comercial, empresas(nombre_completo)')
            .eq('usuario_id', _user.id),
          _sb.from('usuario_modulos')
            .select('modulo')
            .eq('usuario_id', _user.id)
        ]), 12000);
      } catch (e) {
        if (!isLoginPage) { authErrored = true; _showAuthError('No se pudieron cargar tus datos de usuario.'); }
        return;
      }

      var res = authResults[0];
      if (res.error || !res.data) {
        try { await _withTimeout(_sb.auth.signOut(), 5000); } catch (e) {}
        if (!isLoginPage) {
          location.replace('login.html');
          return new Promise(function() {});
        }
        return;
      }

      _profile = res.data;

      _companies = (authResults[1].data || []).map(function(r) {
        return {
          sigla: r.empresa_sigla,
          nombre: r.empresas.nombre_completo,
          codigo_comercial: r.codigo_comercial || null
        };
      });

      _modules = (authResults[2].data || []).map(function(r) { return r.modulo; });

      if (isLoginPage) {
        location.replace('index.html');
        return new Promise(function() {});
      }

      _guardCurrentPage();
      _renderAuthUI();
      _setupAuthListener();
    } finally {
      // No liberar _authReady si hubo error de conexión: la pantalla de reintento
      // queda visible y los módulos no intentan cargar sobre una sesión inválida.
      if (!authErrored && typeof _authResolve === 'function') _authResolve();
    }
  }

  function _renderAuthUI() {
    var el = document.getElementById('auth-info');
    if (!el) return;
    var name = _profile ? escHtml(_profile.nombre || _profile.email) : '';
    var rolRaw = _profile ? _profile.rol : '';
    var rolLabel = rolRaw ? rolRaw.charAt(0).toUpperCase() + rolRaw.slice(1) : '';
    el.innerHTML =
      '<span class="auth-user">' + name + '</span>' +
      '<span class="auth-role-badge auth-role-' + escHtml(rolRaw) + '">' + escHtml(rolLabel) + '</span>' +
      '<button class="btn-logout" onclick="AUTH.logout()">Cerrar sesión</button>';
    el.style.display = 'flex';

    document.querySelectorAll('.auth-edit-only').forEach(function(e) {
      e.style.display = canEdit() ? (e.dataset.display || 'inline-block') : 'none';
    });
    document.querySelectorAll('.auth-admin-only').forEach(function(e) {
      e.style.display = canManageUsers() ? (e.dataset.display || 'inline-block') : 'none';
    });
    document.querySelectorAll('.auth-autoconsec').forEach(function(e) {
      e.style.display = canAutoConsec() ? (e.dataset.display || 'inline-block') : 'none';
    });

    // Ocultar enlaces del navbar y tarjetas del home cuyo módulo no esté permitido
    document.querySelectorAll('[data-modulo]').forEach(function(el) {
      var mod = el.getAttribute('data-modulo');
      if (!hasModule(mod)) el.style.display = 'none';
    });

    // Campanita de notificaciones (si el módulo está cargado en la página).
    if (typeof NOTIF !== 'undefined' && NOTIF.mountBell) {
      NOTIF.mountBell(el);
    }
  }

  // Bloquea el acceso directo por URL cuando la página tiene <body data-modulo="…">
  // o cuando el nombre de archivo coincide con un módulo conocido.
  function _guardCurrentPage() {
    var mod = document.body && document.body.getAttribute('data-modulo');
    if (!mod) {
      var file = (location.pathname.split('/').pop() || '').replace('.html', '');
      var known = ALL_MODULES.map(function(m) { return m.key; });
      if (known.indexOf(file) >= 0) mod = file;
    }
    if (!mod) return;
    if (!hasModule(mod)) {
      location.replace('index.html');
      throw new Promise(function() {}); // detiene la ejecución del resto del script
    }
  }

  function _setupAuthListener() {
    _sb.auth.onAuthStateChange(function(event) {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !_sb.auth.getSession()) {
        location.replace('login.html');
      }
    });
  }

  function logout() {
    _sb.auth.signOut().then(function() {
      location.replace('login.html');
    });
  }

  function canEdit() {
    if (!_profile) return false;
    return _profile.rol === 'admin' || _profile.rol === 'editor' || _profile.rol === 'contabilidad' || _profile.rol === 'gerente_iaso' || _profile.rol === 'comercial' || _profile.rol === 'remisionador';
  }

  // El rol 'comercial' solo puede crear/ver/editar sus propios pedidos
  // (RLS lo restringe en el servidor; en cliente se usa para autofill y bloqueos).
  function isAdmin() {
    return _profile && _profile.rol === 'admin';
  }

  function canAutoConsec() {
    if (!_profile) return false;
    return _profile.rol === 'admin' || _profile.rol === 'remisionador';
  }

  function isComercial() {
    return _profile && _profile.rol === 'comercial';
  }

  function isGerenteIaso() {
    return _profile && _profile.rol === 'gerente_iaso';
  }

  function isDespachador() {
    return _profile && _profile.rol === 'despachador';
  }

  // Rol 'cartera': CRUD de Clientes, solo lectura de Pedidos, todas las empresas.
  function isCartera() {
    return _profile && _profile.rol === 'cartera';
  }

  // Quién puede poner/quitar el estado "Bloqueado por cartera"
  // (Pedidos.Estado_2 y ClientesUnicos.Estado). El backend lo hace cumplir
  // con dos triggers + la RPC set_bloqueo_cartera_pedido.
  function canToggleBloqueoCartera() {
    if (!_profile) return false;
    return _profile.rol === 'admin' || _profile.rol === 'editor' || _profile.rol === 'cartera';
  }

  function canUploadAdjuntos() {
    if (!_profile) return false;
    return _profile.rol === 'admin' || _profile.rol === 'editor' || _profile.rol === 'contabilidad' || _profile.rol === 'gerente_iaso' || _profile.rol === 'comercial' || _profile.rol === 'despachador' || _profile.rol === 'remisionador';
  }

  function canManageUsers() {
    return _profile && _profile.rol === 'admin';
  }

  function canDelete() {
    return _profile && _profile.rol === 'admin';
  }

  function canApprove() {
    if (!_profile) return false;
    if (_profile.rol === 'admin') return true;
    return _modules.indexOf('muestras_aprobar') >= 0;
  }

  function canApproveOC() {
    if (!_profile) return false;
    if (_profile.rol === 'admin') return true;
    return _modules.indexOf('ordenes_aprobar') >= 0;
  }

  function hasCompany(nombre) {
    if (!_profile) return false;
    if (_profile.rol === 'admin' || _profile.rol === 'cartera') return true;
    var n = (nombre || '').trim();
    for (var i = 0; i < _companies.length; i++) {
      if (_companies[i].nombre === n || _companies[i].sigla === n) return true;
    }
    return false;
  }

  function getCompanies() {
    return _companies.slice();
  }

  function getFilteredEmpresas(allEmpresas) {
    if (!_profile) return [];
    if (_profile.rol === 'admin') return allEmpresas;
    return allEmpresas.filter(function(e) {
      return hasCompany(e.value || e.nombre || e);
    });
  }

  function getProfile() {
    return _profile;
  }

  function getUser() {
    return _user;
  }

  function hasModule(mod) {
    if (!_profile) return false;
    if (_profile.rol === 'admin') return true;
    return _modules.indexOf(mod) >= 0;
  }

  function getModules() {
    return _modules.slice();
  }

  function getAllModules() {
    return ALL_MODULES.slice();
  }

  function getComercialCodigo(empresaSiglaOrNombre) {
    var v = (empresaSiglaOrNombre || '').trim();
    if (!v) return null;
    for (var i = 0; i < _companies.length; i++) {
      if (_companies[i].sigla === v || _companies[i].nombre === v) {
        return _companies[i].codigo_comercial || null;
      }
    }
    return null;
  }

  function getComercialCodigos() {
    var result = {};
    _companies.forEach(function(c) {
      if (c.codigo_comercial) result[c.sigla] = c.codigo_comercial;
    });
    return result;
  }

  return {
    init: init,
    logout: logout,
    canEdit: canEdit,
    canDelete: canDelete,
    canApprove: canApprove,
    canApproveOC: canApproveOC,
    canManageUsers: canManageUsers,
    isAdmin: isAdmin,
    canAutoConsec: canAutoConsec,
    isComercial: isComercial,
    isGerenteIaso: isGerenteIaso,
    isDespachador: isDespachador,
    isCartera: isCartera,
    canToggleBloqueoCartera: canToggleBloqueoCartera,
    canUploadAdjuntos: canUploadAdjuntos,
    hasCompany: hasCompany,
    getCompanies: getCompanies,
    getFilteredEmpresas: getFilteredEmpresas,
    getProfile: getProfile,
    getUser: getUser,
    hasModule: hasModule,
    getModules: getModules,
    getAllModules: getAllModules,
    getComercialCodigo: getComercialCodigo,
    getComercialCodigos: getComercialCodigos
  };
})();

// Auto-initialize on load
AUTH.init();
