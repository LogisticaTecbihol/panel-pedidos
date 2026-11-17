// ══════════════════════════════════════════════════════════════
// Bodegas satélite — sesión y contexto del usuario de bodega
//
// NO usa js/auth.js (ese es del panel principal y exige fila en `usuarios`).
// Un usuario de bodega es una cuenta de Auth SIN fila en `usuarios`; lo que lo identifica
// es la RPC bodega_mi_contexto() (BodegaUsuarios activo + sus bodegas asignadas).
// La sesión vive bajo otra clave (js/bodega-cliente.js), así que cerrar sesión aquí es LOCAL.
// ══════════════════════════════════════════════════════════════

var BODEGA_LOGIN = 'bodega-login.html';
var BODEGA_APP = 'bodega-satelite.html';

// Llama una RPC y devuelve data; lanza Error(message) si falla.
function bodegaRpc(nombre, args) {
  return _sb.rpc(nombre, args || {}).then(function (r) {
    if (r.error) throw new Error(r.error.message || String(r.error));
    return r.data;
  });
}

// Contexto del usuario: { usuario: {id,nombre,email} | null, bodegas: [...] }
function bodegaContexto() {
  return bodegaRpc('bodega_mi_contexto');
}

// Cierra la sesión de ESTA app (scope local: no revoca otras sesiones de la cuenta) y navega.
function bodegaCerrarSesion(destino) {
  var ir = function () { location.replace(destino || BODEGA_LOGIN); };
  try {
    var p = _sb.auth.signOut({ scope: 'local' });
    if (p && p.then) { p.then(ir, ir); return; }
  } catch (e) { /* se sale igual */ }
  ir();
}

// Guardia de la app: devuelve el contexto o null (ya redirigió / mostró «sin acceso»).
// NUNCA cierra la sesión por su cuenta si la cuenta no es de bodega: solo avisa. Así, un
// usuario del panel principal que abra esta página por error no pierde nada.
async function bodegaGuardia() {
  var s;
  try { s = await _sb.auth.getSession(); } catch (e) { throw new Error('No se pudo conectar con el servicio de autenticación.'); }
  if (!s || !s.data || !s.data.session) {
    location.replace(BODEGA_LOGIN);
    return null;
  }
  var ctx = await bodegaContexto();
  if (!ctx || !ctx.usuario) {
    var err = new Error('SIN_ACCESO');
    err.sinAcceso = true;
    throw err;
  }
  return ctx;
}
