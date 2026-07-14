// ── Supabase Client ──
// IMPORTANTE: Reemplazar con las credenciales de tu proyecto Supabase
// Dashboard → Settings → API → URL y anon/public key
var SUPABASE_URL = 'https://opghwfuxrvjpbuxeykxn.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wZ2h3ZnV4cnZqcGJ1eGV5a3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNTI5MTMsImV4cCI6MjA5OTYyODkxM30.MLncpAN3CNhynabvfCLrdGM1ymjGFx7xMtpLdGklQlI';
var _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth guard: all modules must await this before loading data ──
// AUTH is defined in auth.js which loads after shared.js,
// so we use a deferred promise that AUTH.init() will resolve.
var _authResolve;
var _authReady = new Promise(function(resolve) { _authResolve = resolve; });

// ── Empresas centralizadas (elimina duplicados en módulos) ──
var EMPRESAS_HOLDING = [
  { value: 'PARCELAR DE COLOMBIA SAS', sigla: 'PARCELAR' },
  { value: 'GREEN AGROSOLUCIONES DE COLOMBIA SAS', sigla: 'GREEN' },
  { value: 'SOLUCIONES INTEGRALES RESO SAS', sigla: 'RESO' },
  { value: 'INSUMOS AGROPECUARIOS SOSTENIBLES SAS', sigla: 'IASO' },
  { value: 'INSUMOS AGROPECUARIOS DE LA SABANA SAS', sigla: 'IAS' },
];

var SIGLAS = {};
EMPRESAS_HOLDING.forEach(function(e) { SIGLAS[e.value] = e.sigla; });
SIGLAS['INSUMOS AGROPECUARIOS DE LA SABANA SAS '] = 'IAS';

function getSigla(n) { return SIGLAS[(n||'').trim()] || n || '—'; }

var SIGLA_CLASSES = ['PARCELAR','GREEN','RESO','IASO','IAS'];
function getSiglaClass(n) { var s = getSigla(n); return SIGLA_CLASSES.indexOf(s) >= 0 ? 'sigla-'+s : 'sigla-DEFAULT'; }

function _addRow(arr) {
  return arr.map(function(r) { r.__row = r.id; return r; });
}

// ── Capa de compatibilidad: apiGet ──
async function apiGet(action) {
  try {
    if (action === 'getPedidos') {
      var res = await _sb.from('Pedidos').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, pedidos: _addRow(res.data) };
    }
    if (action === 'getConsecutivos') {
      var res = await _sb.from('Consecutivos').select('*').order('"N"');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, consecutivos: res.data };
    }
    if (action === 'getIngresos') {
      var res = await _sb.from('Ingresos').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ingresos: _addRow(res.data) };
    }
    if (action === 'getDevoluciones') {
      var res = await _sb.from('Devoluciones').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, devoluciones: _addRow(res.data) };
    }
    if (action === 'getCambios') {
      var res = await _sb.from('CambiosMercancia').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, cambios: _addRow(res.data) };
    }
    if (action === 'getInventario') {
      var res = await _sb.from('Inventario').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, inventario: _addRow(res.data) };
    }
    if (action === 'getOrdenesCompra') {
      var res = await _sb.from('OrdenesCompra').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ordenes: _addRow(res.data) };
    }
    if (action === 'getMaestroProductos') {
      var res = await _sb.from('maestro_productos').select('*');
      if (res.error) return { ok: false, error: res.error.message, productos: [] };
      return {
        ok: true,
        productos: res.data.map(function(r) {
          return { producto: r.Producto, presentacion: r.Presentacion, empresa: r.Empresa };
        }),
        source: 'maestro_productos'
      };
    }
    if (action === 'getClientesUnicos') {
      var res = await _sb.from('ClientesUnicos').select('*');
      if (res.error) return { ok: false, error: res.error.message, clientes: [] };
      return {
        ok: true,
        clientes: res.data.map(function(r) {
          return {
            cliente: r.Cliente, nit: r.Identificacion || '',
            telefono: '', direccion: '', municipio: '', departamento: ''
          };
        }),
        source: 'ClientesUnicos'
      };
    }
    if (action === 'getProductos') {
      var res = await _sb.from('Productos').select('*');
      if (res.error) return { ok: true, productos: [] };
      return {
        ok: true,
        productos: res.data.map(function(r) {
          return { id: r.id, empresa: r.Nombre_Empresa, producto: r.Producto, presentacion: r.Presentacion };
        })
      };
    }
    if (action === 'getMuestras') {
      var res = await _sb.from('SolicitudMuestras').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, muestras: _addRow(res.data) };
    }
    if (action === 'getReenvases') {
      var res = await _sb.from('Reenvases').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, reenvases: _addRow(res.data) };
    }
    if (action === 'getKardexAjustes') {
      var res = await _sb.from('KardexAjustes').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ajustes: _addRow(res.data) };
    }
    if (action === 'getKardexNC') {
      var res = await _sb.from('KardexNC').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ajustesNC: _addRow(res.data) };
    }
    if (action === 'getRemisionesAnuladas') {
      var res = await _sb.from('RemisionesAnuladas').select('*').order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, remisionesAnuladas: _addRow(res.data) };
    }

    return { error: 'Accion no reconocida: ' + action };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Capa de compatibilidad: apiPost ──
async function apiPost(body) {
  try {
    var action = body.action;

    // ── PEDIDOS ──

    if (action === 'registrarEntrega') {
      var entregas = (body.entregas || []).map(function(e) {
        return { row: e.row, cantidad: e.cantidad, fecha: e.fecha, remision: e.remision };
      });
      var res = await _sb.rpc('registrar_entrega', {
        p_entregas: entregas,
        p_observaciones: body.observaciones || null
      });
      if (res.error) return { ok: false, error: res.error.message };
      for (var ei = 0; ei < entregas.length; ei++) {
        if (entregas[ei].fecha && entregas[ei].row) {
          await _sb.from('Pedidos').update({ Fecha_Ult_Entrega: entregas[ei].fecha }).eq('id', entregas[ei].row);
        }
      }
      return res.data;
    }

    if (action === 'editarPedido') {
      var deleteIds = (body.deleteRows || []);
      var res = await _sb.rpc('editar_pedido_completo', {
        p_header: body.header || {},
        p_lineas: body.lineas || [],
        p_delete_ids: deleteIds
      });
      if (res.error) return { ok: false, error: res.error.message };
      return res.data;
    }

    if (action === 'agregarPedido') {
      var now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      var productos = body.productos || [{}];
      var resCl = await _sb.rpc('get_or_create_cliente', {
        p_cliente: body.cliente || '', p_nit: body.nit || '',
        p_telefono: body.telefono || '', p_direccion: body.direccion_envio || '',
        p_municipio: body.municipio || '', p_departamento: body.departamento || ''
      });
      var idCl = resCl.data;
      var resCm = await _sb.rpc('get_or_create_comercial', { p_comercial: body.comercial || '' });
      var idCm = resCm.data;
      var rows = [];
      for (var i = 0; i < productos.length; i++) {
        var prod = productos[i];
        var resPr = await _sb.rpc('get_or_create_producto', {
          p_producto: prod.producto || '', p_presentacion: prod.presentacion || '',
          p_empresa: body.nombre_empresa || ''
        });
        var idPr = resPr.data;
        rows.push({
          Fecha_Procesamiento: now, Nombre_Empresa: body.nombre_empresa || '',
          Consecutivo: body.consecutivo || '', Fecha_Pedido: body.fecha_pedido || '',
          Cliente: body.cliente || '', NIT: body.nit || '', Telefono: body.telefono || '',
          Direccion_Envio: body.direccion_envio || '', Municipio: body.municipio || '',
          Departamento: body.departamento || '', Comercial: body.comercial || '',
          Plazo_Pago: body.plazo_pago || '', Precio_Facturacion: body.precio_facturacion || '',
          Producto: prod.producto || '', Presentacion: prod.presentacion || '',
          Cantidad: prod.cantidad || 0, Valor_Unitario: prod.valor_unitario || 0,
          Valor_Total: prod.valor_total || 0, Total_Orden: body.total_orden || 0,
          Archivo_Fuente: body.archivo_fuente || '', Estado: 'recibido',
          ID_Cliente: idCl || '', ID_Comercial: idCm || '', ID_Producto: idPr || '',
          Observaciones: body.observaciones || '', Estado_2: 'Abierto',
          Bonificado: prod.bonificado || ''
        });
      }
      var res = await _sb.from('Pedidos').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      await _sb.rpc('rebuild_consecutivos');
      return { ok: true, added: rows.length };
    }

    if (action === 'checkDuplicado') {
      var consec = String(body.consecutivo || '').trim();
      var cliente = String(body.cliente || '').trim();
      var fecha = String(body.fecha_pedido || '').trim();
      var empresa = String(body.nombre_empresa || '').trim();
      if (!consec || !cliente) return { ok: true, duplicado: false };
      var q = _sb.from('Pedidos').select('id')
        .eq('Consecutivo', consec)
        .eq('Cliente', cliente)
        .eq('Fecha_Pedido', fecha);
      if (empresa) q = q.eq('Nombre_Empresa', empresa);
      var res = await q.limit(1);
      return { ok: true, duplicado: (res.data && res.data.length > 0) };
    }

    if (action === 'eliminarPedido') {
      var res = await _sb.rpc('eliminar_pedido_completo', {
        p_empresa: body.empresa || '', p_consecutivo: body.consecutivo || ''
      });
      if (res.error) return { ok: false, error: res.error.message };
      return res.data;
    }

    // ── INGRESOS ──

    if (action === 'agregarIngreso') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{ Producto: body.Producto, Presentacion: body.Presentacion, Cantidad: body.Cantidad }];
      }
      var rows = lineas.map(function(lin) {
        return {
          Fecha: body.Fecha || '', Origen: body.Origen || '',
          Empresa_Origen: body.Empresa_Origen || '', Empresa_Destino: body.Empresa_Destino || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Cantidad: Number(lin.Cantidad) || 0, Responsable: body.Responsable || '',
          Remision_Origen: body.Remision_Origen || '', Remision_Destino: body.Remision_Destino || '',
          Observaciones: body.Observaciones || '', Fecha_Registro: now
        };
      });
      var res = await _sb.from('Ingresos').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'editarIngreso') {
      var res = await _sb.from('Ingresos').update({
        Fecha: body.Fecha || '', Origen: body.Origen || '',
        Empresa_Origen: body.Empresa_Origen || '', Empresa_Destino: body.Empresa_Destino || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Cantidad: Number(body.Cantidad) || 0, Responsable: body.Responsable || '',
        Remision_Origen: body.Remision_Origen || '', Remision_Destino: body.Remision_Destino || '',
        Observaciones: body.Observaciones || ''
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarIngreso') {
      var res = await _sb.from('Ingresos').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // ── DEVOLUCIONES ──

    if (action === 'agregarDevolucion') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{
          Producto: body.Producto, Presentacion: body.Presentacion, Cantidad: body.Cantidad,
          Cant_Entregada: body.Cant_Entregada, Valor_Unitario: body.Valor_Unitario, Valor_Total: body.Valor_Total
        }];
      }
      var rows = lineas.map(function(lin) {
        var cant = Number(lin.Cantidad) || 0;
        var vU = Number(lin.Valor_Unitario) || 0;
        return {
          Fecha: body.Fecha || '', Empresa: body.Empresa || '', Consecutivo: body.Consecutivo || '',
          Vendedor: body.Vendedor || '', Cliente: body.Cliente || '', NIT: body.NIT || '',
          Direccion: body.Direccion || '', Municipio: body.Municipio || '',
          Departamento: body.Departamento || '', Telefono: body.Telefono || '',
          Num_Factura: body.Num_Factura || '', Producto: lin.Producto || '',
          Presentacion: lin.Presentacion || '', Cantidad: cant,
          Cant_Entregada: Number(lin.Cant_Entregada) || 0, Valor_Unitario: vU,
          Valor_Total: Number(lin.Valor_Total) || (cant * vU),
          Motivo: body.Motivo || '', Observaciones: body.Observaciones || '',
          Estado: 'Pendiente', Remision: '', Fecha_Devolucion: '',
          Fecha_Registro: now
        };
      });
      var res = await _sb.from('Devoluciones').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'editarDevolucion') {
      var cant = Number(body.Cantidad) || 0;
      var vU = Number(body.Valor_Unitario) || 0;
      var upd = {
        Fecha: body.Fecha || '', Empresa: body.Empresa || '', Consecutivo: body.Consecutivo || '',
        Vendedor: body.Vendedor || '', Cliente: body.Cliente || '', NIT: body.NIT || '',
        Direccion: body.Direccion || '', Municipio: body.Municipio || '',
        Departamento: body.Departamento || '', Telefono: body.Telefono || '',
        Num_Factura: body.Num_Factura || '', Producto: body.Producto || '',
        Presentacion: body.Presentacion || '', Cantidad: cant,
        Cant_Entregada: Number(body.Cant_Entregada) || 0, Valor_Unitario: vU,
        Valor_Total: Number(body.Valor_Total) || (cant * vU),
        Motivo: body.Motivo || '', Observaciones: body.Observaciones || ''
      };
      if (body.Remision !== undefined) upd.Remision = body.Remision;
      if (body.Fecha_Devolucion !== undefined) upd.Fecha_Devolucion = body.Fecha_Devolucion;
      if (body.Estado !== undefined) upd.Estado = body.Estado;
      var res = await _sb.from('Devoluciones').update(upd).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'tramitarDevolucion') {
      var lineas = body.lineas || [];
      for (var i = 0; i < lineas.length; i++) {
        var lin = lineas[i];
        var res = await _sb.from('Devoluciones').update({
          Remision: body.Remision_Ingreso || '',
          Fecha_Devolucion: body.Fecha_Ingreso || '',
          Remision_Ingreso: body.Remision_Ingreso || '',
          Bodega_Ingreso: body.Bodega_Ingreso || 'Productos Buenos',
          Fecha_Ingreso: body.Fecha_Ingreso || '',
          Remision_Salida: body.Remision_Salida || '',
          Bodega_Salida: body.Bodega_Salida || 'Productos Buenos',
          Fecha_Salida: body.Fecha_Salida || '',
          Cant_Entregada: Number(lin.Cant_Entregada) || 0,
          Estado: 'Tramitada'
        }).eq('id', lin.id);
        if (res.error) return { ok: false, error: res.error.message };
      }
      return { ok: true, updated: lineas.length };
    }

    if (action === 'eliminarDevolucion') {
      var res = await _sb.from('Devoluciones').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // ── CAMBIOS DE MERCANCIA ──

    if (action === 'agregarCambio') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var h = body.header || {};
      var allLines = [];
      (body.lineasCambiar || []).forEach(function(lin) {
        allLines.push({
          Empresa: h.Empresa || '', Fecha_Solicitud: h.Fecha_Solicitud || '',
          Fecha_Recogida: h.Fecha_Recogida || '', Consecutivo: h.Consecutivo || '',
          Cliente: h.Cliente || '', NIT: h.NIT || '', Telefono: h.Telefono || '',
          Correo: h.Correo || '', Num_Factura: h.Num_Factura || '',
          Fecha_Compra: h.Fecha_Compra || '', Tipo_Linea: 'CAMBIAR',
          Producto: lin.Producto || '', Cantidad: Number(lin.Cantidad) || 0,
          Lote_Vencimiento: lin.Lote_Vencimiento || '',
          Razon_Cambio: lin.Razon_Cambio || '', Fecha_Cambio: '',
          Valor_Cliente: Number(h.Valor_Cliente) || 0,
          Valor_Empresa: Number(h.Valor_Empresa) || 0,
          Observaciones: h.Observaciones || '', Estado: 'Pendiente',
          Fecha_Registro: now
        });
      });
      (body.lineasEntregar || []).forEach(function(lin) {
        allLines.push({
          Empresa: h.Empresa || '', Fecha_Solicitud: h.Fecha_Solicitud || '',
          Fecha_Recogida: h.Fecha_Recogida || '', Consecutivo: h.Consecutivo || '',
          Cliente: h.Cliente || '', NIT: h.NIT || '', Telefono: h.Telefono || '',
          Correo: h.Correo || '', Num_Factura: h.Num_Factura || '',
          Fecha_Compra: h.Fecha_Compra || '', Tipo_Linea: 'ENTREGAR',
          Producto: lin.Producto || '', Cantidad: Number(lin.Cantidad) || 0,
          Lote_Vencimiento: lin.Lote_Vencimiento || '',
          Razon_Cambio: '', Fecha_Cambio: lin.Fecha_Cambio || '',
          Valor_Cliente: Number(h.Valor_Cliente) || 0,
          Valor_Empresa: Number(h.Valor_Empresa) || 0,
          Observaciones: h.Observaciones || '', Estado: 'Pendiente',
          Fecha_Registro: now
        });
      });
      if (!allLines.length) return { ok: false, error: 'Sin líneas' };
      var res = await _sb.from('CambiosMercancia').insert(allLines);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: allLines.length };
    }

    if (action === 'gestionarCambio') {
      var ids = body.ids || [];
      for (var i = 0; i < ids.length; i++) {
        var res = await _sb.from('CambiosMercancia').update({
          Remision_Ingreso: body.Remision_Ingreso || '',
          Bodega_Ingreso: body.Bodega_Ingreso || 'Productos Buenos',
          Fecha_Ingreso: body.Fecha_Ingreso || '',
          Remision_Salida: body.Remision_Salida || '',
          Bodega_Salida: body.Bodega_Salida || 'Productos Buenos',
          Fecha_Salida: body.Fecha_Salida || '',
          Estado: 'Cerrado'
        }).eq('id', ids[i]);
        if (res.error) return { ok: false, error: res.error.message };
      }
      return { ok: true, updated: ids.length };
    }

    if (action === 'eliminarCambio') {
      var res = await _sb.from('CambiosMercancia').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // ── INVENTARIO ──

    if (action === 'agregarInventario') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{
          Producto: body.Producto, Presentacion: body.Presentacion, Unidad_Medida: body.Unidad_Medida,
          Cantidad_Caja: body.Cantidad_Caja, Lote: body.Lote, Cantidad: body.Cantidad
        }];
      }
      var rows = lineas.map(function(lin) {
        return {
          Fecha: body.Fecha || '', Empresa: body.Empresa || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Unidad_Medida: lin.Unidad_Medida || '', Cantidad_Caja: Number(lin.Cantidad_Caja) || 0,
          Lote: lin.Lote || '', Cantidad: Number(lin.Cantidad) || 0,
          Observaciones: body.Observaciones || '', Fecha_Registro: now
        };
      });
      var res = await _sb.from('Inventario').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'editarInventario') {
      var res = await _sb.from('Inventario').update({
        Fecha: body.Fecha || '', Empresa: body.Empresa || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Unidad_Medida: body.Unidad_Medida || '', Cantidad_Caja: Number(body.Cantidad_Caja) || 0,
        Lote: body.Lote || '', Cantidad: Number(body.Cantidad) || 0,
        Observaciones: body.Observaciones || ''
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarInventario') {
      var res = await _sb.from('Inventario').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // ── ÓRDENES DE COMPRA ──

    if (action === 'agregarOrdenCompra') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{
          Producto: body.Producto, Presentacion: body.Presentacion, Cantidad: body.Cantidad,
          Valor_Unitario: body.Valor_Unitario, Valor_Total: body.Valor_Total
        }];
      }
      var rows = lineas.map(function(lin) {
        var cant = Number(lin.Cantidad) || 0;
        var vU = Number(lin.Valor_Unitario) || 0;
        return {
          Fecha: body.Fecha || '', Empresa_Destino: body.Empresa_Destino || '',
          Empresa_Origen: body.Empresa_Origen || '', Consecutivo: body.Consecutivo || '',
          Direccion: body.Direccion || '', Bodega: body.Bodega || '', Municipio: body.Municipio || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Cantidad: cant, Valor_Unitario: vU,
          Valor_Total: Number(lin.Valor_Total) || (cant * vU),
          Total_Orden: Number(body.Total_Orden) || 0, Observaciones: body.Observaciones || '',
          Estado: body.Estado || 'Abierta', Fecha_Registro: now, Remision: body.Remision || ''
        };
      });
      var res = await _sb.from('OrdenesCompra').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'editarOrdenCompra') {
      var cant = Number(body.Cantidad) || 0;
      var vU = Number(body.Valor_Unitario) || 0;
      var upd = {
        Fecha: body.Fecha || '', Empresa_Destino: body.Empresa_Destino || '',
        Empresa_Origen: body.Empresa_Origen || '', Consecutivo: body.Consecutivo || '',
        Direccion: body.Direccion || '', Bodega: body.Bodega || '', Municipio: body.Municipio || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Cantidad: cant, Valor_Unitario: vU,
        Valor_Total: Number(body.Valor_Total) || (cant * vU),
        Total_Orden: Number(body.Total_Orden) || 0, Observaciones: body.Observaciones || '',
        Estado: body.Estado || 'Abierta'
      };
      if (body.Remision !== undefined) upd.Remision = body.Remision || '';
      var res = await _sb.from('OrdenesCompra').update(upd).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarOrdenCompra') {
      var res = await _sb.from('OrdenesCompra').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // ── SOLICITUD MUESTRAS ──

    if (action === 'agregarMuestra') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{ Producto: body.Producto, Presentacion: body.Presentacion, Cantidad: body.Cantidad }];
      }
      var rows = lineas.map(function(lin) {
        return {
          Empresa: body.Empresa || '', Consecutivo: body.Consecutivo || '', Fecha_Solicitud: body.Fecha_Solicitud || '',
          Fecha_Despacho: body.Fecha_Despacho || '', Responsable: body.Responsable || '',
          Municipio: body.Municipio || '', Tipo_Cultivo: body.Tipo_Cultivo || '',
          Fecha_Aplicacion: body.Fecha_Aplicacion || '', Fecha_Seguimiento: body.Fecha_Seguimiento || '',
          Remision: body.Remision || '', Objetivo: body.Objetivo || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Cantidad: Number(lin.Cantidad) || 0, Cant_Entregada: Number(lin.Cant_Entregada) || 0,
          Fecha_Entrega: lin.Fecha_Entrega || '', Solicitante: body.Solicitante || '',
          Autoriza: body.Autoriza || '', Estado: body.Estado || 'Pendiente',
          Observaciones: body.Observaciones || '', Fecha_Registro: now
        };
      });
      var res = await _sb.from('SolicitudMuestras').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'editarMuestra') {
      var res = await _sb.from('SolicitudMuestras').update({
        Empresa: body.Empresa || '', Consecutivo: body.Consecutivo || '', Fecha_Solicitud: body.Fecha_Solicitud || '',
        Fecha_Despacho: body.Fecha_Despacho || '', Responsable: body.Responsable || '',
        Municipio: body.Municipio || '', Tipo_Cultivo: body.Tipo_Cultivo || '',
        Fecha_Aplicacion: body.Fecha_Aplicacion || '', Fecha_Seguimiento: body.Fecha_Seguimiento || '',
        Remision: body.Remision || '', Objetivo: body.Objetivo || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Cantidad: Number(body.Cantidad) || 0, Cant_Entregada: Number(body.Cant_Entregada) || 0,
        Fecha_Entrega: body.Fecha_Entrega || '', Solicitante: body.Solicitante || '',
        Autoriza: body.Autoriza || '', Estado: body.Estado || 'Pendiente',
        Observaciones: body.Observaciones || ''
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarMuestra') {
      var res = await _sb.from('SolicitudMuestras').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // ── KARDEX AJUSTES ──

    if (action === 'agregarKardexAjuste') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{ Producto: body.Producto, Presentacion: body.Presentacion, Cantidad: body.Cantidad }];
      }
      var rows = lineas.map(function(lin) {
        return {
          Fecha: body.Fecha || '', Empresa: body.Empresa || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Tipo: body.Tipo || 'Ajuste_Sobrante',
          Cantidad: Number(lin.Cantidad) || 0,
          Observaciones: body.Observaciones || '', Fecha_Registro: now
        };
      });
      var res = await _sb.from('KardexAjustes').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };

      // Register new products in maestro_productos so they appear in search
      var maestroRes = await _sb.from('maestro_productos').select('Producto,Presentacion,Empresa');
      var existing = {};
      if (maestroRes.data) {
        maestroRes.data.forEach(function(r) {
          existing[r.Producto + '||' + (r.Presentacion || '') + '||' + (r.Empresa || '')] = true;
        });
      }
      var newProducts = [];
      lineas.forEach(function(lin) {
        var key = (lin.Producto || '') + '||' + (lin.Presentacion || '') + '||' + (body.Empresa || '');
        if (lin.Producto && !existing[key]) {
          newProducts.push({ Producto: lin.Producto, Presentacion: lin.Presentacion || '', Empresa: body.Empresa || '' });
          existing[key] = true;
        }
      });
      if (newProducts.length) {
        await _sb.from('maestro_productos').insert(newProducts);
      }

      return { ok: true, added: rows.length };
    }

    if (action === 'editarKardexAjuste') {
      var res = await _sb.from('KardexAjustes').update({
        Fecha: body.Fecha || '', Empresa: body.Empresa || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Tipo: body.Tipo || '', Cantidad: Number(body.Cantidad) || 0,
        Observaciones: body.Observaciones || ''
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarKardexAjuste') {
      var res = await _sb.from('KardexAjustes').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    if (action === 'agregarKardexNC') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{ Producto: body.Producto, Presentacion: body.Presentacion, Cantidad: body.Cantidad }];
      }
      var rows = lineas.map(function(lin) {
        return {
          Fecha: body.Fecha || '', Empresa: body.Empresa || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Tipo: body.Tipo || 'Ingreso_NC',
          Cantidad: Number(lin.Cantidad) || 0,
          Motivo: body.Motivo || '', Remision: body.Remision || '',
          Observaciones: body.Observaciones || '', Fecha_Registro: now
        };
      });
      var res = await _sb.from('KardexNC').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'editarKardexNC') {
      var upd = {
        Fecha: body.Fecha || '', Empresa: body.Empresa || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Tipo: body.Tipo || '', Cantidad: Number(body.Cantidad) || 0,
        Motivo: body.Motivo || '', Remision: body.Remision || '',
        Observaciones: body.Observaciones || ''
      };
      var res = await _sb.from('KardexNC').update(upd).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarKardexNC') {
      var res = await _sb.from('KardexNC').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // ── REENVASES ──

    if (action === 'agregarReenvase') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var row = {
        Empresa: body.Empresa || '', Planta: body.Planta || '',
        Producto: body.Producto || '',
        Presentacion: body.Presentacion || '', Cantidad: Number(body.Cantidad) || 0,
        Remision: body.Remision || '', Fecha: body.Fecha || '',
        Observaciones: body.Observaciones || '', Bodega: body.Bodega || 'Productos Buenos',
        Fecha_Registro: now
      };
      var res = await _sb.from('Reenvases').insert([row]);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: 1 };
    }

    if (action === 'editarReenvase') {
      var res = await _sb.from('Reenvases').update({
        Empresa: body.Empresa || '', Planta: body.Planta || '',
        Producto: body.Producto || '',
        Presentacion: body.Presentacion || '', Cantidad: Number(body.Cantidad) || 0,
        Remision: body.Remision || '', Fecha: body.Fecha || '',
        Observaciones: body.Observaciones || '', Bodega: body.Bodega || 'Productos Buenos'
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarReenvase') {
      var res = await _sb.from('Reenvases').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    if (action === 'agregarRemisionAnulada') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var row = {
        Empresa: body.Empresa || '', Remision: body.Remision || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Cantidad: Number(body.Cantidad) || 0, Fecha: body.Fecha || '',
        Observaciones: body.Observaciones || '', Fecha_Registro: now
      };
      var res = await _sb.from('RemisionesAnuladas').insert([row]);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: 1 };
    }

    if (action === 'eliminarRemisionAnulada') {
      var res = await _sb.from('RemisionesAnuladas').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    if (action === 'addMaestroProductos') {
      var items = body.items || [];
      if (!items.length) return { ok: true, added: 0 };
      var rows = items.map(function(it) {
        return { Producto: it.producto, Presentacion: it.presentacion || '', Empresa: it.empresa || '' };
      });
      var res = await _sb.from('maestro_productos').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    return { error: 'Accion POST no reconocida: ' + action };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Utilidades (sin cambios) ──

function fmtMoney(v) {
  var n = Number(v); if (!n && n !== 0) return '—';
  return '$' + n.toLocaleString('es-CO');
}

function fmtDate(v) {
  if (!v) return '—';
  var d;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    var p = v.split('-');
    d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  } else {
    d = v instanceof Date ? v : new Date(v);
  }
  return isNaN(d) ? String(v) : d.toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function today() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function toDateInput(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function norm(s) { return (s||'').toLowerCase().trim(); }

function showToast(msg, color) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.style.background = color || '#1a5276';
  t.classList.add('show'); setTimeout(function() { t.classList.remove('show'); }, 3500);
}

function isBackdropClick(e) {
  return e.target === e.currentTarget && e.offsetX <= e.currentTarget.clientWidth && e.offsetY <= e.currentTarget.clientHeight;
}

function setSyncStatus(state, msg) {
  var el = document.getElementById('sync-status');
  var ico = document.getElementById('sync-icon');
  var msgEl = document.getElementById('sync-msg');
  if (!el) return;
  el.className = state === 'ok' ? '' : state === 'syncing' ? 'syncing' : 'error';
  ico.textContent = state === 'ok' ? '☁️' : state === 'syncing' ? '🔄' : '⚠️';
  msgEl.textContent = msg;
}
