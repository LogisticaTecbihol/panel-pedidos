// ══════════════════════════════════════════════════════════════
// Bodegas satélite — cliente Supabase PROPIO de la app de bodega
//
// Va entre la librería de Supabase y js/shared.js. shared.js crea `_sb` con
// supabase.createClient(URL, KEY) y guarda la sesión en localStorage bajo la clave
// por defecto del proyecto, la MISMA que usa el panel principal (mismo origen).
// Compartirla haría que cada app cerrara la sesión de la otra: auth.js del panel
// principal hace signOut() cuando la cuenta no tiene fila en `usuarios` (y signOut()
// es global: revoca TODAS las sesiones de esa cuenta). Con otra clave de sesión las dos
// apps son independientes: el administrador puede probar una bodega sin perder su sesión
// del panel, y un usuario de bodega que abra por error una página del panel no pierde la suya.
//
// shared.js NO se modifica: este archivo envuelve createClient para que `_sb` ya nazca con
// la clave 'sb-bodega-auth'. Cargarlo SOLO en las páginas bodega-*.html.
// ══════════════════════════════════════════════════════════════
(function () {
  if (typeof window === 'undefined' || !window.supabase || window.supabase.__bodegaPatched) return;
  var lib = window.supabase;
  var envuelta = {};
  Object.keys(lib).forEach(function (k) { envuelta[k] = lib[k]; });
  envuelta.createClient = function (url, key, opts) {
    opts = opts || {};
    opts.auth = Object.assign({ storageKey: 'sb-bodega-auth' }, opts.auth || {});
    return lib.createClient(url, key, opts);
  };
  envuelta.__bodegaPatched = true;
  window.supabase = envuelta;
})();
