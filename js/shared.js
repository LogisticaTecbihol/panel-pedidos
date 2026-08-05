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

function populateEmpresaSelect(id, defaultLabel, extras) {
  var sel = document.getElementById(id);
  if (!sel) return;
  var empresas = (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas) ? AUTH.getFilteredEmpresas(EMPRESAS_HOLDING) : EMPRESAS_HOLDING;
  var opts = '<option value="">' + (defaultLabel || '— Seleccionar —') + '</option>';
  empresas.forEach(function(e) {
    opts += '<option value="' + e.value + '">' + e.sigla + '</option>';
  });
  if (extras) extras.forEach(function(x) {
    opts += '<option value="' + x + '">' + x + '</option>';
  });
  sel.innerHTML = opts;
}

function _addRow(arr) {
  return arr.map(function(r) { r.__row = r.id; return r; });
}

// ── Capa de compatibilidad: apiGet ──
// opts.columns: string de columnas para select (default '*')
async function apiGet(action, opts) {
  var cols = (opts && opts.columns) || '*';
  try {
    if (action === 'getPedidos') {
      var res = await _sb.from('Pedidos').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, pedidos: _addRow(res.data) };
    }
    if (action === 'getConsecutivos') {
      var res = await _sb.from('Consecutivos').select(cols).order('"N"');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, consecutivos: res.data };
    }
    if (action === 'getIngresos') {
      var res = await _sb.from('Ingresos').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ingresos: _addRow(res.data) };
    }
    if (action === 'getDevoluciones') {
      var res = await _sb.from('Devoluciones').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, devoluciones: _addRow(res.data) };
    }
    if (action === 'getCambios') {
      var res = await _sb.from('CambiosMercancia').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, cambios: _addRow(res.data) };
    }
    if (action === 'getInventario') {
      var res = await _sb.from('Inventario').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, inventario: _addRow(res.data) };
    }
    if (action === 'getOrdenesCompra') {
      var res = await _sb.from('OrdenesCompra').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ordenes: _addRow(res.data) };
    }
    if (action === 'getEntregasPedido') {
      var res = await _sb.from('EntregasPedido').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, entregas: _addRow(res.data) };
    }
    if (action === 'getMaestroProductos') {
      var res = await _sb.from('maestro_productos').select('Producto');
      if (res.error) return { ok: false, error: res.error.message, productos: [] };
      return {
        ok: true,
        productos: res.data.map(function(r) {
          return { producto: r.Producto, presentacion: '', empresa: '' };
        }),
        source: 'maestro_productos'
      };
    }
    if (action === 'getClientesUnicos') {
      var res = await _sb.from('ClientesUnicos').select(cols);
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
      var res = await _sb.from('Productos').select(cols);
      if (res.error) return { ok: true, productos: [] };
      return {
        ok: true,
        productos: res.data.map(function(r) {
          return { id: r.id, empresa: r.Nombre_Empresa, producto: r.Producto, presentacion: r.Presentacion };
        })
      };
    }
    if (action === 'getMuestras') {
      var res = await _sb.from('SolicitudMuestras').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, muestras: _addRow(res.data) };
    }
    if (action === 'getReenvases') {
      var res = await _sb.from('Reenvases').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, reenvases: _addRow(res.data) };
    }
    if (action === 'getKardexAjustes') {
      var res = await _sb.from('KardexAjustes').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ajustes: _addRow(res.data) };
    }
    if (action === 'getKardexNC') {
      var res = await _sb.from('KardexNC').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ajustesNC: _addRow(res.data) };
    }
    if (action === 'getRemisionesAnuladas') {
      var res = await _sb.from('RemisionesAnuladas').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, remisionesAnuladas: _addRow(res.data) };
    }

    return { error: 'Accion no reconocida: ' + action };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function _uid() {
  return (typeof AUTH !== 'undefined' && AUTH.getUser()) ? AUTH.getUser().id : null;
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
          await _sb.from('Pedidos').update({ Fecha_Ult_Entrega: entregas[ei].fecha, modificado_por: _uid() }).eq('id', entregas[ei].row);
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
      // Marca la modificación (cantidad cambiada o línea nueva) en todas las
      // filas del pedido, para que otros usuarios la vean resaltada en la
      // vista principal. La marca "vista" es local por usuario.
      var modTipo = body.modificacionTipo;
      var hdr = body.header || {};
      if (modTipo && hdr.Nombre_Empresa && (hdr.Consecutivo !== null && hdr.Consecutivo !== undefined && hdr.Consecutivo !== '')) {
        try {
          await _sb.from('Pedidos')
            .update({
              Fecha_Modificacion_Cant: new Date().toISOString(),
              Tipo_Modificacion_Cant: modTipo,
              modificado_por: _uid()
            })
            .eq('Nombre_Empresa', hdr.Nombre_Empresa)
            .eq('Consecutivo', String(hdr.Consecutivo));
        } catch (e) { /* no bloquea la operación principal */ }
      }
      // La RPC editar_pedido_completo no conoce la columna comercial_id;
      // la seteamos aparte cuando el cliente la envía en el header.
      if (hdr.comercial_id !== undefined && hdr.Nombre_Empresa && (hdr.Consecutivo !== null && hdr.Consecutivo !== undefined && hdr.Consecutivo !== '')) {
        try {
          await _sb.from('Pedidos')
            .update({ comercial_id: hdr.comercial_id || null })
            .eq('Nombre_Empresa', hdr.Nombre_Empresa)
            .eq('Consecutivo', String(hdr.Consecutivo));
        } catch (e) { /* no bloquea */ }
      }
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
          Bonificado: prod.bonificado || '',
          Facturar_A: body.facturar_a || body.cliente || '',
          NIT_Adicional: body.nit_adicional || '',
          Consignacion: body.consignacion || 'No',
          comercial_id: body.comercial_id || null,
          creado_por: _uid()
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
          Observaciones: body.Observaciones || '', Fecha_Registro: now,
          creado_por: _uid()
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
        Observaciones: body.Observaciones || '',
        modificado_por: _uid()
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
          Num_Factura: lin.Num_Factura || body.Num_Factura || '', Producto: lin.Producto || '',
          Presentacion: lin.Presentacion || '', Cantidad: cant,
          Cant_Entregada: Number(lin.Cant_Entregada) || 0, Valor_Unitario: vU,
          Valor_Total: Number(lin.Valor_Total) || (cant * vU),
          Motivo: body.Motivo || '', Observaciones: body.Observaciones || '',
          Estado: 'Pendiente', Remision: '', Fecha_Devolucion: '',
          Fecha_Registro: now,
          creado_por: _uid()
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
      upd.modificado_por = _uid();
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
          Estado: 'Tramitada',
          modificado_por: _uid()
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
          Fecha_Registro: now, creado_por: _uid()
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
          Fecha_Registro: now, creado_por: _uid()
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
          Estado: 'Cerrado',
          modificado_por: _uid()
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
          Observaciones: body.Observaciones || '', Fecha_Registro: now,
          creado_por: _uid()
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
        Observaciones: body.Observaciones || '',
        modificado_por: _uid()
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
          Estado: body.Estado || 'Abierta', Fecha_Registro: now, Remision: body.Remision || '',
          Remision_Origen: body.Remision_Origen || '',
          Estado_Aprobacion: 'Por aprobar',
          creado_por: _uid()
        };
      });
      var res = await _sb.from('OrdenesCompra').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'aprobarOrdenCompra') {
      if (!AUTH.canApproveOC || !AUTH.canApproveOC()) {
        return { ok: false, error: 'No tienes permiso para aprobar órdenes de compra.' };
      }
      var profOC = AUTH.getProfile();
      var aprOC = (profOC && (profOC.nombre || profOC.email)) || '';
      var payloadOC = {
        Estado_Aprobacion: 'Aprobada',
        Aprobada_Por: aprOC,
        Fecha_Aprobacion: new Date().toISOString(),
        Motivo_Rechazo: null,
        modificado_por: _uid()
      };
      var qOC = _sb.from('OrdenesCompra').update(payloadOC);
      if (Array.isArray(body.ids) && body.ids.length) {
        qOC = qOC.in('id', body.ids);
      } else {
        qOC = qOC.eq('Empresa_Destino', body.Empresa_Destino || '')
                 .eq('Empresa_Origen',  body.Empresa_Origen  || '')
                 .eq('Consecutivo',     body.Consecutivo     || '');
      }
      var resOC = await qOC.select('id');
      if (resOC.error) return { ok: false, error: resOC.error.message };
      return { ok: true, updated: (resOC.data || []).length };
    }

    if (action === 'rechazarOrdenCompra') {
      if (!AUTH.canApproveOC || !AUTH.canApproveOC()) {
        return { ok: false, error: 'No tienes permiso para rechazar órdenes de compra.' };
      }
      var profOC2 = AUTH.getProfile();
      var aprOC2 = (profOC2 && (profOC2.nombre || profOC2.email)) || '';
      var payloadOC2 = {
        Estado_Aprobacion: 'Rechazada',
        Aprobada_Por: aprOC2,
        Fecha_Aprobacion: new Date().toISOString(),
        Motivo_Rechazo: body.Motivo_Rechazo || '',
        modificado_por: _uid()
      };
      var qOC2 = _sb.from('OrdenesCompra').update(payloadOC2);
      if (Array.isArray(body.ids) && body.ids.length) {
        qOC2 = qOC2.in('id', body.ids);
      } else {
        qOC2 = qOC2.eq('Empresa_Destino', body.Empresa_Destino || '')
                   .eq('Empresa_Origen',  body.Empresa_Origen  || '')
                   .eq('Consecutivo',     body.Consecutivo     || '');
      }
      var resOC2 = await qOC2.select('id');
      if (resOC2.error) return { ok: false, error: resOC2.error.message };
      return { ok: true, updated: (resOC2.data || []).length };
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
      if (body.Remision_Origen !== undefined) upd.Remision_Origen = body.Remision_Origen || '';
      upd.modificado_por = _uid();
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
          Departamento: body.Departamento || '', Municipio: body.Municipio || '', Tipo_Cultivo: body.Tipo_Cultivo || '',
          Fecha_Aplicacion: body.Fecha_Aplicacion || '', Fecha_Seguimiento: body.Fecha_Seguimiento || '',
          Remision: body.Remision || '', Objetivo: body.Objetivo || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Cantidad: Number(lin.Cantidad) || 0, Cant_Entregada: Number(lin.Cant_Entregada) || 0,
          Fecha_Entrega: lin.Fecha_Entrega || '', Solicitante: body.Solicitante || '',
          Autoriza: body.Autoriza || '', Estado: body.Estado || 'Pendiente',
          Estado_Aprobacion: 'Por aprobar',
          Observaciones: body.Observaciones || '', Fecha_Registro: now,
          responsable_id: body.responsable_id || null,
          creado_por: _uid()
        };
      });
      var res = await _sb.from('SolicitudMuestras').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'aprobarMuestra') {
      if (!AUTH.canApprove || !AUTH.canApprove()) {
        return { ok: false, error: 'No tienes permiso para aprobar solicitudes de muestras.' };
      }
      var prof = AUTH.getProfile();
      var aprobador = (prof && (prof.nombre || prof.email)) || '';
      var payload = {
        Estado_Aprobacion: 'Aprobada',
        Aprobada_Por: aprobador,
        Fecha_Aprobacion: new Date().toISOString(),
        Motivo_Rechazo: null,
        modificado_por: _uid()
      };
      var q = _sb.from('SolicitudMuestras').update(payload);
      if (Array.isArray(body.ids) && body.ids.length) {
        q = q.in('id', body.ids);
      } else {
        q = q.eq('Empresa', body.Empresa || '').eq('Consecutivo', body.Consecutivo || '');
      }
      var res = await q.select('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: (res.data || []).length };
    }

    if (action === 'rechazarMuestra') {
      if (!AUTH.canApprove || !AUTH.canApprove()) {
        return { ok: false, error: 'No tienes permiso para rechazar solicitudes de muestras.' };
      }
      var prof2 = AUTH.getProfile();
      var aprobador2 = (prof2 && (prof2.nombre || prof2.email)) || '';
      var payload2 = {
        Estado_Aprobacion: 'Rechazada',
        Aprobada_Por: aprobador2,
        Fecha_Aprobacion: new Date().toISOString(),
        Motivo_Rechazo: body.Motivo_Rechazo || '',
        modificado_por: _uid()
      };
      var q2 = _sb.from('SolicitudMuestras').update(payload2);
      if (Array.isArray(body.ids) && body.ids.length) {
        q2 = q2.in('id', body.ids);
      } else {
        q2 = q2.eq('Empresa', body.Empresa || '').eq('Consecutivo', body.Consecutivo || '');
      }
      var res2 = await q2.select('id');
      if (res2.error) return { ok: false, error: res2.error.message };
      return { ok: true, updated: (res2.data || []).length };
    }

    if (action === 'editarMuestra') {
      var res = await _sb.from('SolicitudMuestras').update({
        Empresa: body.Empresa || '', Consecutivo: body.Consecutivo || '', Fecha_Solicitud: body.Fecha_Solicitud || '',
        Fecha_Despacho: body.Fecha_Despacho || '', Responsable: body.Responsable || '',
        Departamento: body.Departamento || '', Municipio: body.Municipio || '', Tipo_Cultivo: body.Tipo_Cultivo || '',
        Fecha_Aplicacion: body.Fecha_Aplicacion || '', Fecha_Seguimiento: body.Fecha_Seguimiento || '',
        Remision: body.Remision || '', Objetivo: body.Objetivo || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Cantidad: Number(body.Cantidad) || 0, Cant_Entregada: Number(body.Cant_Entregada) || 0,
        Fecha_Entrega: body.Fecha_Entrega || '', Solicitante: body.Solicitante || '',
        Autoriza: body.Autoriza || '', Estado: body.Estado || 'Pendiente',
        Observaciones: body.Observaciones || '',
        modificado_por: _uid()
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
          Observaciones: body.Observaciones || '', Fecha_Registro: now,
          creado_por: _uid()
        };
      });
      var res = await _sb.from('KardexAjustes').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };

      // Register new products in maestro_productos so they appear in search
      var maestroRes = await _sb.from('maestro_productos').select('Producto');
      var existing = {};
      if (maestroRes.data) {
        maestroRes.data.forEach(function(r) {
          existing[r.Producto] = true;
        });
      }
      var newProducts = [];
      lineas.forEach(function(lin) {
        if (lin.Producto && !existing[lin.Producto]) {
          newProducts.push({ Producto: lin.Producto });
          existing[lin.Producto] = true;
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
        Observaciones: body.Observaciones || '',
        modificado_por: _uid()
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
          Observaciones: body.Observaciones || '', Fecha_Registro: now,
          creado_por: _uid()
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
        Observaciones: body.Observaciones || '',
        modificado_por: _uid()
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
        Fecha_Registro: now,
        creado_por: _uid()
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
        Observaciones: body.Observaciones || '', Bodega: body.Bodega || 'Productos Buenos',
        modificado_por: _uid()
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
        Observaciones: body.Observaciones || '', Fecha_Registro: now,
        creado_por: _uid()
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
      var seen = {};
      var rows = [];
      items.forEach(function(it) {
        if (it.producto && !seen[it.producto]) {
          seen[it.producto] = true;
          rows.push({ Producto: it.producto });
        }
      });
      if (!rows.length) return { ok: true, added: 0 };
      var res = await _sb.from('maestro_productos').upsert(rows, { onConflict: 'Producto', ignoreDuplicates: true });
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

var _overlayOpenedAt = 0;
document.addEventListener('animationstart', function(e) {
  if (e.animationName === 'pop') _overlayOpenedAt = Date.now();
});
function isBackdropClick(e) {
  if (Date.now() - _overlayOpenedAt < 400) return false;
  return e.target === e.currentTarget && e.offsetX <= e.currentTarget.clientWidth && e.offsetY <= e.currentTarget.clientHeight;
}

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function initAutocomplete(input, opts) {
  var dd = document.createElement('div');
  dd.className = 'ac-dropdown';
  dd.style.display = 'none';
  document.body.appendChild(dd);
  var selIdx = -1, items = [];

  function pos() {
    var r = input.getBoundingClientRect();
    dd.style.top = r.bottom + 'px';
    dd.style.left = r.left + 'px';
    dd.style.width = Math.max(r.width, 320) + 'px';
  }

  function show() {
    var val = input.value.toLowerCase().trim();
    if (val.length < (opts.minChars || 2)) { dd.style.display = 'none'; return; }
    var all = typeof opts.items === 'function' ? opts.items() : opts.items;
    items = all.filter(function(it) { return opts.match(it, val); }).slice(0, 10);
    if (!items.length) { dd.style.display = 'none'; return; }
    selIdx = -1;
    dd.innerHTML = items.map(function(it) { return '<div class="ac-item">' + opts.display(it) + '</div>'; }).join('');
    [].slice.call(dd.children).forEach(function(el, i) {
      el.addEventListener('mousedown', function(e) { e.preventDefault(); pick(i); });
    });
    pos();
    dd.style.display = 'block';
  }

  function pick(i) { if (items[i]) { opts.onSelect(items[i]); dd.style.display = 'none'; selIdx = -1; } }

  function hl() {
    [].slice.call(dd.children).forEach(function(el, j) { el.className = 'ac-item' + (j === selIdx ? ' active' : ''); });
    if (selIdx >= 0 && dd.children[selIdx]) dd.children[selIdx].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', show);
  input.addEventListener('focus', function() { if (input.value.trim().length >= (opts.minChars || 2)) show(); });
  input.addEventListener('blur', function() { setTimeout(function() { dd.style.display = 'none'; }, 150); });
  input.addEventListener('keydown', function(e) {
    if (dd.style.display === 'none' || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); hl(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); hl(); }
    else if (e.key === 'Enter' && selIdx >= 0) { e.preventDefault(); pick(selIdx); }
    else if (e.key === 'Escape') { dd.style.display = 'none'; }
  });

  return { destroy: function() { if (dd.parentElement) dd.parentElement.removeChild(dd); } };
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

// ══════════════════════════════════════════════════════════════
// Notificaciones: badges de nuevas solicitudes por módulo
// ══════════════════════════════════════════════════════════════

var NEW_COUNTS_CONFIG = [
  { key: 'pedidos',      href: 'pedidos.html',      tables: ['Pedidos'] },
  { key: 'devoluciones', href: 'devoluciones.html', tables: ['Devoluciones', 'CambiosMercancia'] },
  { key: 'muestras',     href: 'muestras.html',     tables: ['SolicitudMuestras'] }
];

var _newCountsPromise = null;

function getNewCountsPerModule() {
  if (_newCountsPromise) return _newCountsPromise;
  _newCountsPromise = (async function() {
    await _authReady;
    var user = (typeof AUTH !== 'undefined' && AUTH.getUser) ? AUTH.getUser() : null;
    if (!user) return {};
    var prefix = 'lastSeenId_' + user.id + '_';
    var out = {};
    await Promise.all(NEW_COUNTS_CONFIG.map(async function(m) {
      var maxIds = {};
      var totalNew = 0;
      await Promise.all(m.tables.map(async function(t) {
        var maxRes = await _sb.from(t).select('id').order('id', { ascending: false }).limit(1);
        var maxId = (maxRes.data && maxRes.data[0]) ? maxRes.data[0].id : 0;
        maxIds[t] = maxId;
        var seenKey = prefix + t;
        var raw = localStorage.getItem(seenKey);
        if (raw === null) { localStorage.setItem(seenKey, String(maxId)); return; }
        var lastSeen = parseInt(raw, 10);
        if (isNaN(lastSeen) || maxId <= lastSeen) return;
        var cntRes = await _sb.from(t).select('id', { count: 'exact', head: true }).gt('id', lastSeen);
        totalNew += (cntRes.count || 0);
      }));
      out[m.key] = { maxIds: maxIds, newCount: totalNew, prefix: prefix, tables: m.tables };
    }));
    return out;
  })();
  return _newCountsPromise;
}

function markModuleSeen(moduleKey) {
  return getNewCountsPerModule().then(function(counts) {
    var m = counts[moduleKey];
    if (!m) return;
    Object.keys(m.maxIds).forEach(function(t) {
      localStorage.setItem(m.prefix + t, String(m.maxIds[t]));
    });
  });
}

// ── Dropdown de notificaciones (lista de nuevos ítems) ──

var _newItemsCache = {};
var _openNotifDD = null;

var _MODULE_META = {
  pedidos:      { label: 'Pedidos',              href: 'pedidos.html' },
  devoluciones: { label: 'Devoluciones y Cambios', href: 'devoluciones.html' },
  muestras:     { label: 'Solicitud de Muestras', href: 'muestras.html' }
};

function _colsForNotifTable(t) {
  if (t === 'Pedidos')           return 'id,Consecutivo,Cliente,Nombre_Empresa,Fecha_Pedido';
  if (t === 'Devoluciones')      return 'id,Consecutivo,Cliente,Empresa,Fecha,Motivo';
  if (t === 'CambiosMercancia')  return 'id,Consecutivo,Cliente,Empresa,Fecha_Solicitud';
  if (t === 'SolicitudMuestras') return 'id,Consecutivo,Empresa,Fecha_Solicitud,Responsable,Solicitante,Municipio';
  return 'id';
}

function _rowToNotifItem(t, r) {
  var sigla = (typeof getSigla === 'function') ? getSigla(r.Empresa || r.Nombre_Empresa) : (r.Empresa || r.Nombre_Empresa || '');
  var consec = r.Consecutivo || ('#' + r.id);
  if (t === 'Pedidos') return {
    id: r.id, prefix: '',
    title: consec + ' · ' + (r.Cliente || '—'),
    sub: sigla,
    date: (r.Fecha_Pedido || '').slice(0, 10)
  };
  if (t === 'Devoluciones') return {
    id: r.id, prefix: '[DEV] ',
    title: '[DEV] ' + consec + ' · ' + (r.Cliente || '—'),
    sub: sigla + (r.Motivo ? ' · ' + r.Motivo : ''),
    date: (r.Fecha || '').slice(0, 10)
  };
  if (t === 'CambiosMercancia') return {
    id: r.id, prefix: '[CAM] ',
    title: '[CAM] ' + consec + ' · ' + (r.Cliente || '—'),
    sub: sigla,
    date: (r.Fecha_Solicitud || '').slice(0, 10)
  };
  if (t === 'SolicitudMuestras') return {
    id: r.id, prefix: '',
    title: consec + ' · ' + (r.Responsable || r.Solicitante || '—'),
    sub: sigla + (r.Municipio ? ' · ' + r.Municipio : ''),
    date: (r.Fecha_Solicitud || '').slice(0, 10)
  };
  return { id: r.id, prefix: '', title: '#' + r.id, sub: '', date: '' };
}

async function _fetchNewItems(moduleKey, info) {
  if (_newItemsCache[moduleKey]) return _newItemsCache[moduleKey];
  var all = [];
  await Promise.all(info.tables.map(async function(t) {
    var raw = localStorage.getItem(info.prefix + t);
    var maxIdSnapshot = info.maxIds[t] || 0;
    var lastSeen = parseInt(raw, 10);
    if (isNaN(lastSeen)) lastSeen = maxIdSnapshot;
    var res = await _sb.from(t).select(_colsForNotifTable(t))
      .gt('id', lastSeen).order('id', { ascending: false }).limit(30);
    (res.data || []).forEach(function(r) { all.push({ table: t, row: r }); });
  }));
  var groups = {};
  var order = [];
  all.forEach(function(x) {
    var consec = x.row.Consecutivo || ('#' + x.row.id);
    var k = x.table + '|' + consec;
    if (!groups[k]) {
      groups[k] = _rowToNotifItem(x.table, x.row);
      groups[k]._maxId = x.row.id;
      groups[k]._lineas = 0;
      order.push(k);
    }
    groups[k]._lineas += 1;
    if (x.row.id > groups[k]._maxId) groups[k]._maxId = x.row.id;
  });
  var arr = order.map(function(k) { return groups[k]; })
    .sort(function(a, b) { return b._maxId - a._maxId; })
    .slice(0, 10);
  arr.forEach(function(g) {
    if (g._lineas > 1) g.sub = (g.sub ? g.sub + ' · ' : '') + g._lineas + ' líneas';
  });
  _newItemsCache[moduleKey] = arr;
  return arr;
}

function _closeNotifDropdown() {
  if (_openNotifDD) {
    _openNotifDD.remove();
    _openNotifDD = null;
  }
}

function _openNotifDropdown(anchorEl, moduleKey, info) {
  _closeNotifDropdown();
  var dd = document.createElement('div');
  dd.className = 'notif-dd';
  dd.innerHTML = '<div class="notif-dd-loading">Cargando…</div>';
  document.body.appendChild(dd);
  var meta = _MODULE_META[moduleKey] || { label: moduleKey, href: '#' };
  var rect = anchorEl.getBoundingClientRect();
  var top = rect.bottom + window.scrollY + 6;
  var left = Math.max(8, Math.min(window.innerWidth - 340, rect.left + window.scrollX - 20));
  dd.style.top = top + 'px';
  dd.style.left = left + 'px';
  dd._anchor = anchorEl;
  _openNotifDD = dd;

  _fetchNewItems(moduleKey, info).then(function(items) {
    if (_openNotifDD !== dd) return;
    if (!items.length) {
      dd.innerHTML = '<div class="notif-dd-empty">Sin novedades para mostrar.</div>';
      return;
    }
    var html = '<div class="notif-dd-header">🔔 Nuevas de ' + escHtml(meta.label) +
      ' (' + info.newCount + ')</div>';
    html += '<ul class="notif-dd-list">';
    items.forEach(function(it) {
      html += '<li><a href="' + meta.href + '" data-mkey="' + moduleKey + '">' +
        '<div class="notif-dd-title">' + escHtml(it.title) + '</div>' +
        (it.sub ? '<div class="notif-dd-sub">' + escHtml(it.sub) + '</div>' : '') +
        (it.date ? '<div class="notif-dd-date">📅 ' + escHtml(it.date) + '</div>' : '') +
        '</a></li>';
    });
    html += '</ul>';
    html += '<a class="notif-dd-footer" href="' + meta.href + '" data-mkey="' + moduleKey + '">Ver todas →</a>';
    dd.innerHTML = html;
    dd.querySelectorAll('a[data-mkey]').forEach(function(a) {
      a.addEventListener('click', function() { markModuleSeen(moduleKey); });
    });
  }).catch(function() {
    if (_openNotifDD !== dd) return;
    dd.innerHTML = '<div class="notif-dd-empty">Error cargando.</div>';
  });
}

function _bindBadgeDropdown(badgeEl, moduleKey, info) {
  badgeEl.style.cursor = 'pointer';
  badgeEl.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (_openNotifDD && _openNotifDD._anchor === badgeEl) {
      _closeNotifDropdown();
      return;
    }
    _openNotifDropdown(badgeEl, moduleKey, info);
  });
}

document.addEventListener('click', function(e) {
  if (!_openNotifDD) return;
  if (_openNotifDD.contains(e.target)) return;
  var t = e.target;
  if (t && t.classList && (t.classList.contains('nav-badge') || t.classList.contains('card-badge'))) return;
  _closeNotifDropdown();
});
window.addEventListener('resize', _closeNotifDropdown);
window.addEventListener('scroll', _closeNotifDropdown, true);

// Auto-run: pintar badges en el navbar de la página actual
(async function paintNavBadges() {
  try {
    await _authReady;
    var counts = await getNewCountsPerModule();
    NEW_COUNTS_CONFIG.forEach(function(m) {
      var link = document.querySelector('.navbar a[href="' + m.href + '"]');
      if (!link) return;
      if (link.classList.contains('active')) {
        markModuleSeen(m.key);
        return;
      }
      var info = counts[m.key];
      if (!info || info.newCount <= 0) return;
      var badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.textContent = info.newCount > 99 ? '99+' : String(info.newCount);
      badge.title = 'Ver ' + info.newCount + ' nueva(s)';
      link.appendChild(badge);
      _bindBadgeDropdown(badge, m.key, info);
    });
  } catch (e) { /* silencioso */ }
})();
