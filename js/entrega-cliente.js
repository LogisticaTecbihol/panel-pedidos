// Datos de entrega de un cliente: Sucursal · Dirección · Municipio · Departamento.
//
// Misma lógica que «Nuevo Pedido» (js/pedidos.js: _populateSucursalDL y el onSelect del cliente), para los
// formularios que no cargan pedidos.js (hoy: Cambios de Mercancía). Si cambias una, cambia la otra.
//   clientes        lista de apiGet('getClientesUnicos') → {cliente, direccion, direccion_envio, municipio, departamento}
//   pedidosCliente  filas de Pedidos del cliente (apiGet('getPedidosDeCliente')) → {Cliente, Fecha_Pedido, Sucursal, ...}

function entregaNormCliente(s) { return (s || '').toLowerCase().trim(); }

// Opciones del campo Sucursal. Una por municipio donde el cliente tiene dirección (en Clientes o en pedidos
// anteriores); si hay varias direcciones en el mismo municipio se distinguen con «Municipio – dirección» y,
// si el pedido anterior traía Sucursal, se usa ese nombre.
//   → { opciones: [texto], mapa: { 'texto en minúscula': {direccion, municipio, departamento} } }
function entregaSucursales(clienteName, clientes, pedidosCliente) {
  var seen = {};
  var opts = [];
  var mapa = {};
  if (!clienteName) return { opciones: opts, mapa: mapa };
  var normCli = entregaNormCliente(clienteName);
  var munCount = {};
  var addEntry = function(mun, dir, suc, dep) {
    mun = (mun || '').trim();
    if (!mun) return;
    var mk = mun.toLowerCase();
    if (!munCount[mk]) munCount[mk] = [];
    dir = (dir || '').trim();
    suc = (suc || '').trim();
    var exists = munCount[mk].some(function(e) { return e.dir === dir; });
    if (!exists) munCount[mk].push({ dir: dir, suc: suc, mun: mun, dep: (dep || '').trim() });
  };
  (clientes || []).forEach(function(c) {
    if (entregaNormCliente(c.cliente) !== normCli) return;
    addEntry(c.municipio, c.direccion_envio || c.direccion, '', c.departamento);
  });
  (pedidosCliente || []).forEach(function(p) {
    if (entregaNormCliente(p.Cliente) !== normCli) return;
    addEntry(p.Municipio, p.Direccion_Envio, p.Sucursal, p.Departamento);
  });
  Object.keys(munCount).forEach(function(mk) {
    var entries = munCount[mk];
    var needDisambig = entries.length > 1;
    entries.forEach(function(e) {
      var label = e.suc || (needDisambig && e.dir ? e.mun + ' – ' + e.dir : e.mun);
      var key = label.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      opts.push(label);
      mapa[key] = { direccion: e.dir, municipio: e.mun, departamento: e.dep };
    });
  });
  return { opciones: opts, mapa: mapa };
}

// Último pedido del cliente (el más reciente por Fecha_Pedido).
function entregaUltimoPedido(clienteName, pedidosCliente) {
  var normCli = entregaNormCliente(clienteName);
  if (!normCli) return null;
  var propios = (pedidosCliente || []).filter(function(p) { return entregaNormCliente(p.Cliente) === normCli; });
  if (!propios.length) return null;
  propios.sort(function(a, b) { return +new Date(b.Fecha_Pedido || 0) - +new Date(a.Fecha_Pedido || 0); });
  return propios[0];
}

// Valores con que se rellena el formulario al elegir un cliente (onSelect de Nuevo Pedido): los de su ficha en
// Clientes y, donde ahí falten, los de su último pedido. Con varias direcciones (más de una opción de
// Sucursal) no se rellena nada: la persona elige la sucursal.
//   c = cliente elegido de la lista; suc = resultado de entregaSucursales()
function entregaPorDefecto(c, suc, pedidosCliente) {
  var out = { sucursal: '', direccion: '', municipio: '', departamento: '' };
  if (!c || Object.keys(suc.mapa).length > 1) return out;
  out.direccion = c.direccion_envio || c.direccion || '';
  out.municipio = c.municipio || '';
  out.departamento = c.departamento || '';
  var last = entregaUltimoPedido(c.cliente, pedidosCliente);
  if (last) {
    if (!c.direccion_envio && last.Direccion_Envio) out.direccion = last.Direccion_Envio;
    if (!c.municipio && last.Municipio) out.municipio = last.Municipio;
    if (!c.departamento && last.Departamento) out.departamento = last.Departamento;
    if (last.Sucursal) out.sucursal = last.Sucursal;
  }
  return out;
}
