// ── Auth Module ──
var AUTH = (function() {
  var _user = null;
  var _profile = null;
  var _companies = [];
  var _ready = null;

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

      var res = await _sb.from('usuarios')
        .select('*')
        .eq('id', _user.id)
        .eq('activo', true)
        .single();

      if (res.error || !res.data) {
        await _sb.auth.signOut();
        if (!isLoginPage) {
          location.replace('login.html');
          return new Promise(function() {});
        }
        return;
      }

      _profile = res.data;

      var ueRes = await _sb.from('usuario_empresas')
        .select('empresa_sigla, empresas(nombre_completo)')
        .eq('usuario_id', _user.id);

      _companies = (ueRes.data || []).map(function(r) {
        return { sigla: r.empresa_sigla, nombre: r.empresas.nombre_completo };
      });

      if (isLoginPage) {
        location.replace('index.html');
        return new Promise(function() {});
      }

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
    return _profile && (_profile.rol === 'admin' || _profile.rol === 'editor');
  }

  function canManageUsers() {
    return _profile && _profile.rol === 'admin';
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

  return {
    init: init,
    logout: logout,
    canEdit: canEdit,
    canManageUsers: canManageUsers,
    hasCompany: hasCompany,
    getCompanies: getCompanies,
    getFilteredEmpresas: getFilteredEmpresas,
    getProfile: getProfile,
    getUser: getUser
  };
})();

// Auto-initialize on load
AUTH.init();
