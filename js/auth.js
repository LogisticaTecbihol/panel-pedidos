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
    { key: 'reportes',     label: '📈 Reportes' },
    { key: 'dashboard',    label: '📊 Dashboard' },
    { key: 'muestras_aprobar',       label: '✅ Aprobar solicitudes de muestras' },
    { key: 'ordenes_aprobar',        label: '✅ Aprobar órdenes de compra' },
    { key: 'pedidos_editar_cantidad', label: '✏️ Editar cantidad pedida' },
    { key: 'notificaciones',          label: '🔔 Notificaciones' }
  ];

  function init() {
    if (_ready) return _ready;
    _ready = _init();
    return _ready;
  }

  async function _init() {
    var isLoginPage = location.pathname.endsWith('login.html');

    try {
      var { data } = await _sb.auth.getSession();

      if (!data.session) {
        if (!isLoginPage) {
          location.replace('login.html');
          return new Promise(function() {});
        }
        return;
      }

      _user = data.session.user;

      var authResults = await Promise.all([
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
      ]);

      var res = authResults[0];
      if (res.error || !res.data) {
        await _sb.auth.signOut();
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
      if (typeof _authResolve === 'function') _authResolve();
    }
  }

  function _renderAuthUI() {
    var el = document.getElementById('auth-info');
    if (!el) return;
    var name = _profile ? (_profile.nombre || _profile.email) : '';
    var rolLabel = _profile ? _profile.rol.charAt(0).toUpperCase() + _profile.rol.slice(1) : '';
    el.innerHTML =
      '<span class="auth-user">' + name + '</span>' +
      '<span class="auth-role-badge auth-role-' + (_profile ? _profile.rol : '') + '">' + rolLabel + '</span>' +
      '<button class="btn-logout" onclick="AUTH.logout()">Cerrar sesión</button>';
    el.style.display = 'flex';

    document.querySelectorAll('.auth-edit-only').forEach(function(e) {
      e.style.display = canEdit() ? (e.dataset.display || 'inline-block') : 'none';
    });
    document.querySelectorAll('.auth-admin-only').forEach(function(e) {
      e.style.display = canManageUsers() ? (e.dataset.display || 'inline-block') : 'none';
    });

    var navUsuarios = document.getElementById('nav-usuarios');
    if (navUsuarios) {
      navUsuarios.style.display = canManageUsers() ? '' : 'none';
    }

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
    return _profile.rol === 'admin' || _profile.rol === 'editor' || _profile.rol === 'comercial';
  }

  // El rol 'comercial' solo puede crear/ver/editar sus propios pedidos
  // (RLS lo restringe en el servidor; en cliente se usa para autofill y bloqueos).
  function isAdmin() {
    return _profile && _profile.rol === 'admin';
  }

  function isComercial() {
    return _profile && _profile.rol === 'comercial';
  }

  function isDespachador() {
    return _profile && _profile.rol === 'despachador';
  }

  function canUploadAdjuntos() {
    if (!_profile) return false;
    return _profile.rol === 'admin' || _profile.rol === 'editor' || _profile.rol === 'comercial' || _profile.rol === 'despachador';
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
    if (_profile.rol === 'admin') return true;
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
    isComercial: isComercial,
    isDespachador: isDespachador,
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
