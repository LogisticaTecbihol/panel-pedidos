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

function _esEmpresaHolding(nombre) {
  return EMPRESAS_HOLDING.some(function(e) { return e.value === (nombre || '').trim() || e.sigla === (nombre || '').trim(); });
}
async function generarRemisionConsecutivo(empresa, tipo) {
  var res = await _sb.rpc('generar_remision', { p_empresa_nombre: empresa, p_tipo: tipo });
  if (res.error) throw new Error('Error generando remisión: ' + res.error.message);
  return res.data;
}
async function generarRemisionDual(empresaSalida, empresaEntrada) {
  var res = await _sb.rpc('generar_remision_dual', { p_empresa_salida: empresaSalida, p_empresa_entrada: empresaEntrada });
  if (res.error) throw new Error('Error generando remisiones: ' + res.error.message);
  return res.data;
}

// Devuelve al contador un consecutivo de remisión que se generó pero cuyo
// guardado falló, para que no quede "quemado" (salto en el listado). El RPC
// solo revierte si es seguro: la remisión no quedó en ningún registro y el
// contador sigue en ese número. Best-effort — nunca lanza.
async function liberarRemisionConsecutivo(empresa, tipo, remision) {
  if (!empresa || !tipo || !remision) return false;
  try {
    var res = await _sb.rpc('liberar_remision', {
      p_empresa_nombre: empresa, p_tipo: tipo, p_remision: remision
    });
    return !res.error && res.data === true;
  } catch (e) { return false; }
}

// Registro de los consecutivos de remisión generados durante el apiPost en
// curso. Si el apiPost termina en error, apiPost() los libera uno a uno.
var _remLedger = [];
var _genRemImpl = generarRemisionConsecutivo;
async function _genRem(empresa, tipo) {
  var rem = await _genRemImpl(empresa, tipo);
  _remLedger.push({ empresa: empresa, tipo: tipo, remision: rem });
  return rem;
}

function populateEmpresaSelect(id, defaultLabel, extras, allAccess) {
  var sel = document.getElementById(id);
  if (!sel) return;
  var empresas;
  if (allAccess && typeof AUTH !== 'undefined' && AUTH.isGerenteIaso && AUTH.isGerenteIaso()) {
    empresas = EMPRESAS_HOLDING;
  } else {
    empresas = (typeof AUTH !== 'undefined' && AUTH.getFilteredEmpresas) ? AUTH.getFilteredEmpresas(EMPRESAS_HOLDING) : EMPRESAS_HOLDING;
  }
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

function _isKardexPage() {
  return location.pathname.indexOf('kardex') >= 0;
}

function _filterGerenteIaso(data, empresaCols) {
  if (typeof AUTH === 'undefined' || !AUTH.isGerenteIaso || !AUTH.isGerenteIaso()) return data;
  if (_isKardexPage()) return data;
  if (!Array.isArray(empresaCols)) empresaCols = [empresaCols];
  return data.filter(function(row) {
    return empresaCols.some(function(col) {
      return row[col] && AUTH.hasCompany(row[col]);
    });
  });
}

// ── Capa de compatibilidad: apiGet ──
// opts.columns: string de columnas para select (default '*')
async function apiGet(action, opts) {
  var cols = (opts && opts.columns) || '*';
  try {
    if (action === 'getPedidos') {
      var all = [], from = 0, size = 1000;
      while (true) {
        var res = await _sb.from('Pedidos').select(cols).order('id').range(from, from + size - 1);
        if (res.error) return { ok: false, error: res.error.message };
        all = all.concat(res.data);
        if (res.data.length < size) break;
        from += size;
      }
      all = _filterGerenteIaso(all, 'Nombre_Empresa');
      return { ok: true, pedidos: _addRow(all) };
    }
    if (action === 'getConsecutivos') {
      var res = await _sb.from('Consecutivos').select(cols).order('"N"');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, consecutivos: res.data };
    }
    if (action === 'getIngresos') {
      var qIng = _sb.from('Ingresos').select(cols).order('id');
      // Solo los ingresos ligados a una salida a producción (para la página
      // de Reenvases): usa el índice parcial idx_ingresos_reenvase_ref.
      if (opts && opts.reenvaseRefOnly) qIng = qIng.neq('Reenvase_Ref', '');
      var res = await qIng;
      if (res.error) return { ok: false, error: res.error.message };
      var ingData = _filterGerenteIaso(res.data, ['Empresa_Origen', 'Empresa_Destino']);
      return { ok: true, ingresos: _addRow(ingData) };
    }
    if (action === 'getDevoluciones') {
      var res = await _sb.from('Devoluciones').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, devoluciones: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getCambios') {
      var res = await _sb.from('CambiosMercancia').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, cambios: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getInventario') {
      var res = await _sb.from('Inventario').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, inventario: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getOrdenesCompra') {
      var res = await _sb.from('OrdenesCompra').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ordenes: _addRow(_filterGerenteIaso(res.data, ['Empresa_Origen', 'Empresa_Destino'])) };
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
      var allData = [], from = 0, pageSize = 1000;
      while (true) {
        var res = await _sb.from('ClientesUnicos').select(cols).range(from, from + pageSize - 1);
        if (res.error) return { ok: false, error: res.error.message, clientes: [] };
        allData = allData.concat(res.data);
        if (res.data.length < pageSize) break;
        from += pageSize;
      }
      return {
        ok: true,
        clientes: allData.map(function(r) {
          return {
            cliente: r.Cliente, nit: r.Identificacion || '',
            telefono: r.Telefono || '', direccion: r.Direccion || '',
            direccion_envio: r.Direccion_Envio || '',
            municipio: r.Municipio || '', departamento: r.Departamento || '',
            empresa: r.Nombre_Empresa || '', tipo_identificacion: r.Tipo_Identificacion || '',
            correo: r.Correo_Electronico || '', cupo_credito: r.Cupo_Credito || '',
            plazo_pago: r.Plazo_Pago || '', lista_precio: r.Lista_Precio || '',
            estado: r.Estado || 'Activo'
          };
        }),
        source: 'ClientesUnicos'
      };
    }
    if (action === 'getProductos') {
      var res = await _sb.from('Productos').select(cols);
      if (res.error) return { ok: true, productos: [] };
      var prodData = _filterGerenteIaso(res.data, 'Nombre_Empresa');
      return {
        ok: true,
        productos: prodData.map(function(r) {
          return { id: r.id, empresa: r.Nombre_Empresa, producto: r.Producto, presentacion: r.Presentacion };
        })
      };
    }
    if (action === 'getMuestras') {
      var res = await _sb.from('SolicitudMuestras').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, muestras: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getReenvases') {
      var qRe = _sb.from('Reenvases').select(cols).order('id');
      // Trae solo una salida concreta (por su remisión) — para el flujo de
      // "registrar retorno" desde el módulo de Ingresos.
      if (opts && opts.remisionEq) qRe = qRe.eq('Remision', opts.remisionEq);
      // Solo salidas no cerradas — para el selector de retornos en Ingresos.
      if (opts && opts.abiertasOnly) qRe = qRe.neq('Estado', 'Cerrada');
      var res = await qRe;
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, reenvases: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getKardexAjustes') {
      var res = await _sb.from('KardexAjustes').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ajustes: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getKardexNC') {
      var res = await _sb.from('KardexNC').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ajustesNC: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getRemisionesAnuladas') {
      var res = await _sb.from('RemisionesAnuladas').select(cols).order('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, remisionesAnuladas: _addRow(_filterGerenteIaso(res.data, 'Empresa')) };
    }
    if (action === 'getListaPrecios') {
      var all = [], from = 0, size = 1000;
      while (true) {
        var res = await _sb.from('ListaPrecios').select(cols).order('Producto').order('id').range(from, from + size - 1);
        if (res.error) return { ok: false, error: res.error.message };
        all = all.concat(res.data);
        if (res.data.length < size) break;
        from += size;
      }
      return { ok: true, precios: _addRow(all) };
    }
    if (action === 'getClientesAll') {
      var allData = [], from = 0, pageSize = 1000;
      while (true) {
        var res = await _sb.from('ClientesUnicos').select(cols).order('Cliente').range(from, from + pageSize - 1);
        if (res.error) return { ok: false, error: res.error.message, clientes: [] };
        allData = allData.concat(res.data);
        if (res.data.length < pageSize) break;
        from += pageSize;
      }
      return { ok: true, clientes: _addRow(allData) };
    }

    if (action === 'getInventarioFisico') {
      var all = [], from = 0, size = 1000;
      while (true) {
        var res = await _sb.from('InventarioFisico').select(cols).order('id').range(from, from + size - 1);
        if (res.error) return { ok: false, error: res.error.message };
        all = all.concat(res.data);
        if (res.data.length < size) break;
        from += size;
      }
      return { ok: true, conteos: _addRow(_filterGerenteIaso(all, 'Empresa')) };
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
// Envoltorio: ejecuta la operación y, si termina en error, libera los
// consecutivos de remisión que se generaron y no llegaron a ningún registro.
async function apiPost(body) {
  var ledgerPrev = _remLedger;
  var ledger = [];
  _remLedger = ledger;
  var result;
  try {
    result = await _apiPostCore(body);
  } catch (err) {
    result = { ok: false, error: (err && err.message) ? err.message : String(err) };
  } finally {
    _remLedger = ledgerPrev;
  }
  if (result && result.ok === false && ledger.length) {
    for (var _li = 0; _li < ledger.length; _li++) {
      await liberarRemisionConsecutivo(ledger[_li].empresa, ledger[_li].tipo, ledger[_li].remision);
    }
  }
  return result;
}

async function _apiPostCore(body) {
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
      // Bloqueo por estado del cliente: no se registran pedidos para
      // clientes 'Inactivo' o 'Bloqueado por cartera' (maestro ClientesUnicos).
      try {
        var _estCli = await _sb.rpc('cliente_estado_pedido', {
          p_cliente: body.cliente || '', p_nit: body.nit || ''
        });
        var _estVal = (_estCli && !_estCli.error && _estCli.data) ? String(_estCli.data) : 'Activo';
        if (_estVal === 'Inactivo' || _estVal === 'Bloqueado por cartera') {
          return { ok: false, error: 'El cliente "' + (body.cliente || '') + '" está en estado "' + _estVal + '". No se pueden registrar pedidos; contacta a Cartera / Administración.' };
        }
      } catch (e) { /* si la validación falla, no bloqueamos la operación */ }

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
          Bodega_Facturacion: body.bodega_facturacion || '',
          Sucursal: body.sucursal || '',
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

    // Bloquear / liberar un pedido por cartera. La RPC valida el rol
    // (admin/editor/cartera) y setea Estado_2 en todas las líneas.
    if (action === 'setBloqueoCartera') {
      var res = await _sb.rpc('set_bloqueo_cartera_pedido', {
        p_empresa: body.empresa || '',
        p_consecutivo: String(body.consecutivo || ''),
        p_bloquear: !!body.bloquear
      });
      if (res.error) return { ok: false, error: res.error.message };
      return res.data || { ok: true };
    }

    // Bloquear al cliente (ClientesUnicos.Estado) por NIT — opcional, lo
    // ofrece el panel de Pedidos tras bloquear un pedido por cartera.
    if (action === 'bloquearClientePorNit') {
      var res = await _sb.rpc('bloquear_cliente_por_nit', {
        p_nit: body.nit || '',
        p_cliente: body.cliente || ''
      });
      if (res.error) return { ok: false, error: res.error.message };
      return res.data || { ok: true };
    }

    // ── INGRESOS ──

    if (action === 'agregarIngreso') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{ Producto: body.Producto, Presentacion: body.Presentacion, Cantidad: body.Cantidad }];
      }
      var remOrigen = (body.Remision_Origen || '').trim();
      var remDestino = (body.Remision_Destino || '').trim();
      var origen = (body.Origen || '').trim();
      var empOrigen = (body.Empresa_Origen || '').trim();
      var empDestino = (body.Empresa_Destino || '').trim();
      var esPlanta = /planta/i.test(origen);
      var esHolding = _esEmpresaHolding(empOrigen);
      if (!remDestino && empDestino) {
        remDestino = await _genRem(empDestino, 'ENTRADA');
      }
      if (!remOrigen && esHolding && !esPlanta && empOrigen !== empDestino) {
        remOrigen = await _genRem(empOrigen, 'SALIDA');
      }
      var rows = lineas.map(function(lin) {
        return {
          Fecha: body.Fecha || '', Origen: body.Origen || '',
          Empresa_Origen: body.Empresa_Origen || '', Empresa_Destino: body.Empresa_Destino || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Cantidad: Number(lin.Cantidad) || 0, Responsable: body.Responsable || '',
          Remision_Origen: remOrigen, Remision_Destino: remDestino,
          Observaciones: body.Observaciones || '', Fecha_Registro: now,
          Reenvase_Ref: (body.Reenvase_Ref || '').trim(),
          creado_por: _uid()
        };
      });
      var res = await _sb.from('Ingresos').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length, remision_origen: remOrigen, remision_destino: remDestino };
    }

    if (action === 'editarIngreso') {
      var remOrigenE = (body.Remision_Origen || '').trim();
      var remDestinoE = (body.Remision_Destino || '').trim();
      var origenE = (body.Origen || '').trim();
      var empOrigenE = (body.Empresa_Origen || '').trim();
      var empDestinoE = (body.Empresa_Destino || '').trim();
      var esPlantaE = /planta/i.test(origenE);
      var esHoldingE = _esEmpresaHolding(empOrigenE);
      if (!remDestinoE && empDestinoE && !body._remision_destino_existente) {
        remDestinoE = await _genRem(empDestinoE, 'ENTRADA');
      }
      if (!remOrigenE && esHoldingE && !esPlantaE && empOrigenE !== empDestinoE && !body._remision_origen_existente) {
        remOrigenE = await _genRem(empOrigenE, 'SALIDA');
      }
      var _updIng = {
        Fecha: body.Fecha || '', Origen: body.Origen || '',
        Empresa_Origen: body.Empresa_Origen || '', Empresa_Destino: body.Empresa_Destino || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Cantidad: Number(body.Cantidad) || 0, Responsable: body.Responsable || '',
        Remision_Origen: remOrigenE, Remision_Destino: remDestinoE,
        Observaciones: body.Observaciones || '',
        modificado_por: _uid()
      };
      // Solo tocar el vínculo a la salida a producción si el form lo envía.
      if (body.Reenvase_Ref !== undefined) _updIng.Reenvase_Ref = (body.Reenvase_Ref || '').trim();
      var res = await _sb.from('Ingresos').update(_updIng).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1, remision_origen: remOrigenE, remision_destino: remDestinoE };
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
      var nuevasLineas = body.nuevas_lineas || [];
      var genIngreso = body.generar_remision_ingreso !== false;
      var genSalida = body.generar_remision_salida !== false;
      var remIngDev = genIngreso ? (body.Remision_Ingreso || '').trim() : '';
      var remSalDev = genSalida ? (body.Remision_Salida || '').trim() : '';
      var empDev = (body.Empresa || '').trim();
      // Reutiliza la remisión que ya traigan las líneas de un intento anterior
      // (evita quemar un consecutivo nuevo al reintentar tras un error).
      var _devIds = lineas.map(function(l) { return l.id; }).filter(function(x) { return x != null; });
      if (_devIds.length && ((genIngreso && !remIngDev) || (genSalida && !remSalDev))) {
        var peekDev = await _sb.from('Devoluciones')
          .select('Remision_Ingreso,Remision_Salida').in('id', _devIds);
        (peekDev.data || []).forEach(function(rw) {
          if (genIngreso && !remIngDev && String(rw.Remision_Ingreso || '').trim()) remIngDev = String(rw.Remision_Ingreso).trim();
          if (genSalida && !remSalDev && String(rw.Remision_Salida || '').trim()) remSalDev = String(rw.Remision_Salida).trim();
        });
      }
      if (empDev) {
        if (genIngreso && !remIngDev) remIngDev = await _genRem(empDev, 'ENTRADA');
        if (genSalida && !remSalDev) remSalDev = await _genRem(empDev, 'SALIDA');
      }
      var nuevasAdded = 0;
      if (nuevasLineas.length && lineas.length) {
        var refRes = await _sb.from('Devoluciones').select('*').eq('id', lineas[0].id).single();
        if (refRes.data) {
          var ref = refRes.data;
          var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
          var newRows = nuevasLineas.map(function(nl) {
            var cant = Number(nl.Cantidad) || 0;
            var row = {
              Fecha: ref.Fecha || '', Empresa: ref.Empresa || '', Consecutivo: ref.Consecutivo || '',
              Vendedor: ref.Vendedor || '', Cliente: ref.Cliente || '', NIT: ref.NIT || '',
              Direccion: ref.Direccion || '', Municipio: ref.Municipio || '',
              Departamento: ref.Departamento || '', Telefono: ref.Telefono || '',
              Num_Factura: nl.Num_Factura || '', Producto: nl.Producto || '',
              Presentacion: nl.Presentacion || '', Cantidad: cant,
              Cant_Entregada: Number(nl.Cant_Entregada) || 0,
              Valor_Unitario: Number(nl.Valor_Unitario) || 0,
              Valor_Total: Number(nl.Valor_Total) || 0,
              Motivo: ref.Motivo || '', Observaciones: ref.Observaciones || '',
              Estado: 'Tramitada',
              Fecha_Registro: now,
              creado_por: _uid(), modificado_por: _uid()
            };
            if (genIngreso) {
              row.Remision = remIngDev; row.Fecha_Devolucion = body.Fecha_Ingreso || '';
              row.Remision_Ingreso = remIngDev; row.Bodega_Ingreso = body.Bodega_Ingreso || 'Productos Buenos';
              row.Fecha_Ingreso = body.Fecha_Ingreso || '';
            }
            if (genSalida) {
              row.Remision_Salida = remSalDev; row.Bodega_Salida = body.Bodega_Salida || 'Productos Buenos';
              row.Fecha_Salida = body.Fecha_Salida || '';
            }
            return row;
          });
          var insRes = await _sb.from('Devoluciones').insert(newRows);
          if (insRes.error) return { ok: false, error: insRes.error.message };
          nuevasAdded = newRows.length;
        }
      }
      for (var i = 0; i < lineas.length; i++) {
        var lin = lineas[i];
        var upd = {
          Cant_Entregada: Number(lin.Cant_Entregada) || 0,
          Estado: 'Tramitada',
          modificado_por: _uid()
        };
        if (genIngreso) {
          upd.Remision = remIngDev;
          upd.Fecha_Devolucion = body.Fecha_Ingreso || '';
          upd.Remision_Ingreso = remIngDev;
          upd.Bodega_Ingreso = body.Bodega_Ingreso || 'Productos Buenos';
          upd.Fecha_Ingreso = body.Fecha_Ingreso || '';
        }
        if (genSalida) {
          upd.Remision_Salida = remSalDev;
          upd.Bodega_Salida = body.Bodega_Salida || 'Productos Buenos';
          upd.Fecha_Salida = body.Fecha_Salida || '';
        }
        var res = await _sb.from('Devoluciones').update(upd).eq('id', lin.id);
        if (res.error) return { ok: false, error: res.error.message };
      }
      return { ok: true, updated: lineas.length, nuevas_added: nuevasAdded, remision_ingreso: remIngDev, remision_salida: remSalDev };
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
      // 'ambos' (default) | 'ingreso' | 'salida' — permite cerrar el cambio en dos pasos
      var ladosCam = body.lados || 'ambos';
      var doIngCam = ladosCam === 'ambos' || ladosCam === 'ingreso';
      var doSalCam = ladosCam === 'ambos' || ladosCam === 'salida';
      var remIngCam = (body.Remision_Ingreso || '').trim();
      var remSalCam = (body.Remision_Salida || '').trim();
      var empCam = (body.Empresa || '').trim();
      // Si las filas ya traen una remisión de un intento anterior (p. ej. el
      // guardado falló en una línea posterior tras escribir esta), se reutiliza
      // en vez de generar y "quemar" un consecutivo nuevo al reintentar.
      if (ids.length && ((doIngCam && !remIngCam) || (doSalCam && !remSalCam))) {
        var peekCam = await _sb.from('CambiosMercancia')
          .select('Remision_Ingreso,Remision_Salida').in('id', ids);
        (peekCam.data || []).forEach(function(rw) {
          if (doIngCam && !remIngCam && String(rw.Remision_Ingreso || '').trim()) remIngCam = String(rw.Remision_Ingreso).trim();
          if (doSalCam && !remSalCam && String(rw.Remision_Salida || '').trim()) remSalCam = String(rw.Remision_Salida).trim();
        });
      }
      if (empCam) {
        if (doIngCam && !remIngCam) remIngCam = await _genRem(empCam, 'ENTRADA');
        if (doSalCam && !remSalCam) remSalCam = await _genRem(empCam, 'SALIDA');
      }
      var entregasUpd = body.entregasUpdate || {};
      var estadoFinalCam = 'Cerrado';
      for (var i = 0; i < ids.length; i++) {
        var curRes = await _sb.from('CambiosMercancia')
          .select('Remision_Ingreso,Remision_Salida,Cant_Entregada').eq('id', ids[i]).single();
        var curCam = curRes.data || {};
        var rowRemIng = String(curCam.Remision_Ingreso || '').trim();
        var rowRemSal = String(curCam.Remision_Salida || '').trim();
        var updObj = { modificado_por: _uid() };
        if (doIngCam) {
          updObj.Remision_Ingreso = remIngCam;
          updObj.Bodega_Ingreso = body.Bodega_Ingreso || 'Productos Buenos';
          updObj.Fecha_Ingreso = body.Fecha_Ingreso || '';
          rowRemIng = remIngCam;
        }
        if (doSalCam) {
          updObj.Remision_Salida = remSalCam;
          updObj.Bodega_Salida = body.Bodega_Salida || 'Productos Buenos';
          updObj.Fecha_Salida = body.Fecha_Salida || '';
          rowRemSal = remSalCam;
        }
        var estadoRow = (rowRemIng && rowRemSal) ? 'Cerrado' : 'Parcial';
        updObj.Estado = estadoRow;
        if (estadoRow !== 'Cerrado') estadoFinalCam = 'Parcial';
        if (doSalCam && entregasUpd[ids[i]]) {
          var prev = (curCam && Number(curCam.Cant_Entregada)) || 0;
          updObj.Cant_Entregada = prev + (entregasUpd[ids[i]].cantDirecta || 0);
        }
        var res = await _sb.from('CambiosMercancia').update(updObj).eq('id', ids[i]);
        if (res.error) return { ok: false, error: res.error.message };
      }
      return {
        ok: true, updated: ids.length,
        remision_ingreso: doIngCam ? remIngCam : '',
        remision_salida: doSalCam ? remSalCam : '',
        estado: estadoFinalCam
      };
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
          Valor_Unitario: body.Valor_Unitario, Valor_Total: body.Valor_Total, Bonificado: body.Bonificado
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
          Bonificado: lin.Bonificado || '',
          Total_Orden: Number(body.Total_Orden) || 0, Observaciones: body.Observaciones || '',
          Estado: body.Estado || 'Abierta', Fecha_Registro: now, Remision: body.Remision || '',
          Remision_Origen: body.Remision_Origen || '',
          Estado_Aprobacion: body.Estado_Aprobacion || 'Por aprobar',
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
      if (body.Bonificado !== undefined) upd.Bonificado = body.Bonificado || '';
      var remOC = (body.Remision !== undefined) ? (body.Remision || '').trim() : undefined;
      var remOrigenOC = (body.Remision_Origen !== undefined) ? (body.Remision_Origen || '').trim() : undefined;
      var empDestOC = (body.Empresa_Destino || '').trim();
      var empOrigOC = (body.Empresa_Origen || '').trim();
      var generatedRemOC = {};
      if (body._legalizar && empDestOC) {
        if (remOC !== undefined && !remOC) {
          remOC = await _genRem(empDestOC, 'ENTRADA');
          generatedRemOC.remision_destino = remOC;
        }
        if (remOrigenOC !== undefined && !remOrigenOC && empOrigOC && empOrigOC !== empDestOC) {
          remOrigenOC = await _genRem(empOrigOC, 'SALIDA');
          generatedRemOC.remision_origen = remOrigenOC;
        }
      }
      if (remOC !== undefined) upd.Remision = remOC;
      if (remOrigenOC !== undefined) upd.Remision_Origen = remOrigenOC;
      upd.modificado_por = _uid();
      var res = await _sb.from('OrdenesCompra').update(upd).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return Object.assign({ ok: true, updated: 1 }, generatedRemOC);
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
      // El consecutivo lo asigna la base (generar_consecutivo_muestra),
      // no el navegador: así no se repite aunque la lista en memoria del
      // cliente esté vieja o dos personas creen a la vez.
      var consecMu = (body.Consecutivo || '').trim();
      if ((body.Empresa || '').trim()) {
        var _cm = await _sb.rpc('generar_consecutivo_muestra', { p_empresa_nombre: body.Empresa });
        if (_cm.error) return { ok: false, error: 'No se pudo asignar el consecutivo: ' + _cm.error.message };
        if (_cm.data != null && String(_cm.data).trim()) consecMu = String(_cm.data).trim();
      }
      var rows = lineas.map(function(lin) {
        return {
          Empresa: body.Empresa || '', Consecutivo: consecMu, Fecha_Solicitud: body.Fecha_Solicitud || null,
          Fecha_Despacho: body.Fecha_Despacho || null, Responsable: body.Responsable || '',
          Departamento: body.Departamento || '', Municipio: body.Municipio || '', Tipo_Cultivo: body.Tipo_Cultivo || '',
          Fecha_Aplicacion: body.Fecha_Aplicacion || null, Fecha_Seguimiento: body.Fecha_Seguimiento || null,
          Remision: body.Remision || '', Objetivo: body.Objetivo || '',
          Producto: lin.Producto || '', Presentacion: lin.Presentacion || '',
          Cantidad: Number(lin.Cantidad) || 0, Cant_Entregada: Number(lin.Cant_Entregada) || 0,
          Fecha_Entrega: lin.Fecha_Entrega || null, Solicitante: body.Solicitante || '',
          Autoriza: body.Autoriza || '', Estado: body.Estado || 'Pendiente',
          Estado_Aprobacion: body.Estado_Aprobacion || 'Por aprobar',
          Aprobada_Por: body.Aprobada_Por || '', Fecha_Aprobacion: body.Fecha_Aprobacion || null,
          Observaciones: body.Observaciones || '', Fecha_Registro: now,
          responsable_id: body.responsable_id || null,
          creado_por: _uid()
        };
      });
      var remMu = (body.Remision || '').trim();
      if (!remMu && body._generar_remision && (body.Empresa || '').trim()) {
        remMu = await _genRem(body.Empresa, 'SALIDA');
        rows.forEach(function(r) { r.Remision = remMu; });
      }
      var res = await _sb.from('SolicitudMuestras').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length, remision: remMu, consecutivo: consecMu };
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
      var remMuE = (body.Remision || '').trim();
      if (!remMuE && body._generar_remision && (body.Empresa || '').trim()) {
        remMuE = await _genRem(body.Empresa, 'SALIDA');
      }
      var res = await _sb.from('SolicitudMuestras').update({
        Empresa: body.Empresa || '', Consecutivo: body.Consecutivo || '', Fecha_Solicitud: body.Fecha_Solicitud || null,
        Fecha_Despacho: body.Fecha_Despacho || null, Responsable: body.Responsable || '',
        Departamento: body.Departamento || '', Municipio: body.Municipio || '', Tipo_Cultivo: body.Tipo_Cultivo || '',
        Fecha_Aplicacion: body.Fecha_Aplicacion || null, Fecha_Seguimiento: body.Fecha_Seguimiento || null,
        Remision: remMuE, Objetivo: body.Objetivo || '',
        Producto: body.Producto || '', Presentacion: body.Presentacion || '',
        Cantidad: Number(body.Cantidad) || 0, Cant_Entregada: Number(body.Cant_Entregada) || 0,
        Fecha_Entrega: body.Fecha_Entrega || null, Solicitante: body.Solicitante || '',
        Autoriza: body.Autoriza || '', Estado: body.Estado || 'Pendiente',
        Observaciones: body.Observaciones || '',
        modificado_por: _uid()
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1, remision: remMuE };
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

    // ── INVENTARIO FISICO ──

    if (action === 'guardarInventarioFisico') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var lineas = body.lineas || [];
      var empresa = body.Empresa || '';
      var fechaConteo = body.Fecha_Conteo || '';
      var bodega = body.Bodega || 'Productos Buenos';
      var estado = body.Estado || 'Borrador';
      if (!empresa || !fechaConteo) return { ok: false, error: 'Empresa y fecha son requeridos' };

      // Esta acción borra y reinserta todas las líneas del conteo en cada
      // guardado. Preservamos la autoría de creación (quién y cuándo inició el
      // conteo) a través de los re-guardados; modificado_* refleja el último
      // que guardó/cerró.
      var prevRes = await _sb.from('InventarioFisico')
        .select('creado_por, creado_por_nombre, creado_en')
        .eq('Empresa', empresa).eq('Fecha_Conteo', fechaConteo).eq('Bodega', bodega)
        .order('creado_en', { ascending: true }).limit(1);
      var prevAud = (prevRes.data && prevRes.data[0]) || null;

      var delRes = await _sb.from('InventarioFisico').delete()
        .eq('Empresa', empresa).eq('Fecha_Conteo', fechaConteo).eq('Bodega', bodega);
      if (delRes.error) return { ok: false, error: delRes.error.message };
      if (!lineas.length) return { ok: true, saved: 0 };

      var audExtra = prevAud
        ? { creado_por: prevAud.creado_por, creado_por_nombre: prevAud.creado_por_nombre,
            creado_en: prevAud.creado_en, modificado_por: _uid() }
        : {};
      var rows = lineas.map(function(l) {
        var dif = (Number(l.Cantidad_Fisica) || 0) - (Number(l.Cantidad_Sistema) || 0);
        var row = {
          Fecha_Conteo: fechaConteo, Empresa: empresa, Bodega: bodega,
          Producto: l.Producto || '', Presentacion: l.Presentacion || '',
          Cantidad_Fisica: Number(l.Cantidad_Fisica) || 0,
          Cantidad_Sistema: Number(l.Cantidad_Sistema) || 0,
          Diferencia: dif, Observaciones: l.Observaciones || '',
          Estado: estado, Fecha_Registro: now
        };
        for (var k in audExtra) row[k] = audExtra[k];
        return row;
      });
      var res = await _sb.from('InventarioFisico').insert(rows);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, saved: rows.length };
    }

    if (action === 'eliminarInventarioFisico') {
      var bodega = body.Bodega || 'Productos Buenos';
      var res = await _sb.from('InventarioFisico').delete()
        .eq('Empresa', body.Empresa).eq('Fecha_Conteo', body.Fecha_Conteo).eq('Bodega', bodega);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    if (action === 'cerrarInventarioFisico') {
      var bodega = body.Bodega || 'Productos Buenos';
      var res = await _sb.from('InventarioFisico').update({ Estado: 'Cerrado', modificado_por: _uid() })
        .eq('Empresa', body.Empresa).eq('Fecha_Conteo', body.Fecha_Conteo).eq('Bodega', bodega);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, closed: 1 };
    }

    if (action === 'generarAjustesDesdeConteo') {
      var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      var bodega = body.Bodega || 'Productos Buenos';
      var esNC = bodega === 'Producto No Conforme';
      var lineas = body.lineas || [];
      var ajustes = lineas.filter(function(l) { return l.Diferencia && l.Diferencia !== 0; })
        .map(function(l) {
          if (esNC) {
            return {
              Fecha: body.Fecha_Conteo || '', Empresa: body.Empresa || '',
              Producto: l.Producto || '', Presentacion: l.Presentacion || '',
              Tipo: l.Diferencia > 0 ? 'Ingreso_NC' : 'Salida_NC',
              Cantidad: Math.abs(l.Diferencia), Motivo: 'Ajuste inventario fisico',
              Observaciones: 'Inventario fisico ' + (body.Fecha_Conteo || ''),
              Fecha_Registro: now, creado_por: _uid()
            };
          }
          return {
            Fecha: body.Fecha_Conteo || '', Empresa: body.Empresa || '',
            Producto: l.Producto || '', Presentacion: l.Presentacion || '',
            Tipo: l.Diferencia > 0 ? 'Ajuste_Sobrante' : 'Ajuste_Faltante',
            Cantidad: Math.abs(l.Diferencia),
            Observaciones: 'Inventario fisico ' + (body.Fecha_Conteo || ''),
            Fecha_Registro: now, creado_por: _uid()
          };
        });
      if (!ajustes.length) return { ok: true, ajustes: 0 };
      var tabla = esNC ? 'KardexNC' : 'KardexAjustes';
      var res = await _sb.from(tabla).insert(ajustes);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, ajustes: ajustes.length };
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
      var remReenv = (body.Remision || '').trim();
      var remReenvDest = (body.Remision_Destino || '').trim();
      var empReenv = (body.Empresa || '').trim();
      var empReenvDest = (body.Empresa_Destino || '').trim();
      if (!remReenv && empReenv) {
        remReenv = await _genRem(empReenv, 'SALIDA');
      }
      if (!remReenvDest && empReenvDest && empReenvDest !== empReenv) {
        remReenvDest = await _genRem(empReenvDest, 'ENTRADA');
      }
      var row = {
        Empresa: body.Empresa || '', Empresa_Destino: body.Empresa_Destino || '', Planta: body.Planta || '',
        Producto: body.Producto || '',
        Presentacion: body.Presentacion || '', Cantidad: Number(body.Cantidad) || 0,
        Remision: remReenv, Remision_Destino: remReenvDest, Fecha: body.Fecha || '',
        Observaciones: body.Observaciones || '', Bodega: body.Bodega || 'Productos Buenos',
        Fecha_Registro: now,
        creado_por: _uid()
      };
      var res = await _sb.from('Reenvases').insert([row]);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: 1, remision: remReenv, remision_destino: remReenvDest };
    }

    if (action === 'editarReenvase') {
      var remReenvEd = (body.Remision || '').trim();
      var remReenvDestEd = (body.Remision_Destino || '').trim();
      var empReenvEd = (body.Empresa || '').trim();
      var empReenvDestEd = (body.Empresa_Destino || '').trim();
      if (!remReenvEd && empReenvEd && !body._remision_existente) {
        remReenvEd = await _genRem(empReenvEd, 'SALIDA');
      }
      if (!remReenvDestEd && empReenvDestEd && empReenvDestEd !== empReenvEd && !body._remision_destino_existente) {
        remReenvDestEd = await _genRem(empReenvDestEd, 'ENTRADA');
      }
      var res = await _sb.from('Reenvases').update({
        Empresa: body.Empresa || '', Empresa_Destino: body.Empresa_Destino || '', Planta: body.Planta || '',
        Producto: body.Producto || '',
        Presentacion: body.Presentacion || '', Cantidad: Number(body.Cantidad) || 0,
        Remision: remReenvEd, Remision_Destino: remReenvDestEd, Fecha: body.Fecha || '',
        Observaciones: body.Observaciones || '', Bodega: body.Bodega || 'Productos Buenos',
        modificado_por: _uid()
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1, remision: remReenvEd, remision_destino: remReenvDestEd };
    }

    if (action === 'eliminarReenvase') {
      var res = await _sb.from('Reenvases').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    // Cierra o reabre una salida a producción (todas sus líneas comparten
    // Remision + Empresa). Estado: 'Pendiente' | 'Cerrada'.
    if (action === 'editarEstadoSalidaReenvase') {
      var _remSal = (body.Remision || '').trim();
      var _empSal = (body.Empresa || '').trim();
      var _estSal = body.Estado === 'Cerrada' ? 'Cerrada' : 'Pendiente';
      if (!_remSal) return { ok: false, error: 'Falta la remisión de la salida.' };
      var _qSal = _sb.from('Reenvases').update({ Estado: _estSal, modificado_por: _uid() })
        .eq('Remision', _remSal);
      if (_empSal) _qSal = _qSal.eq('Empresa', _empSal);
      var res = await _qSal;
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, estado: _estSal };
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

    // ── LISTA DE PRECIOS ──

    if (action === 'agregarListaPrecio') {
      var lineas = body.lineas || [];
      if (!lineas.length && body.Producto) {
        lineas = [{ Producto: body.Producto, Precio: body.Precio }];
      }
      var rows = lineas.map(function(lin) {
        return {
          Empresa: body.Empresa || '',
          Tipo_Precio: body.Tipo_Precio || '',
          Proveedor: body.Proveedor || '',
          Producto: lin.Producto || '',
          Precio: Number(lin.Precio) || 0,
          creado_por: _uid()
        };
      });
      var res = await _sb.from('ListaPrecios').upsert(rows, {
        onConflict: 'Empresa,Tipo_Precio,Proveedor,Producto'
      });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: rows.length };
    }

    if (action === 'editarListaPrecio') {
      var res = await _sb.from('ListaPrecios').update({
        Empresa: body.Empresa || '',
        Tipo_Precio: body.Tipo_Precio || '',
        Proveedor: body.Proveedor || '',
        Producto: body.Producto || '',
        Precio: Number(body.Precio) || 0,
        modificado_por: _uid()
      }).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'eliminarListaPrecio') {
      var res = await _sb.from('ListaPrecios').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    if (action === 'eliminarListaPreciosBulk') {
      var q = _sb.from('ListaPrecios').delete();
      if (body.Empresa) q = q.eq('Empresa', body.Empresa);
      if (body.Tipo_Precio) q = q.eq('Tipo_Precio', body.Tipo_Precio);
      var res = await q;
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true };
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

    if (action === 'registrarClienteNuevoDesdePedido') {
      var res = await _sb.rpc('registrar_cliente_nuevo_desde_pedido', {
        p_cliente: body.cliente || '',
        p_nit: body.nit || '',
        p_empresa: body.empresa || '',
        p_telefono: body.telefono || '',
        p_direccion_envio: body.direccion_envio || '',
        p_municipio: body.municipio || '',
        p_departamento: body.departamento || '',
        p_plazo_pago: body.plazo_pago || '',
        p_lista_precio: body.lista_precio || ''
      });
      if (res.error) return { ok: false, error: res.error.message };
      var _d = res.data || {};
      return { ok: true, created: !!_d.created, reason: _d.reason || null, id: _d.id || null };
    }

    if (action === 'agregarClienteUnico') {
      var row = {
        Cliente: body.Cliente || '', Identificacion: body.Identificacion || '',
        Tipo_Identificacion: body.Tipo_Identificacion || '',
        Telefono: body.Telefono || '', Direccion: body.Direccion || '',
        Direccion_Envio: body.Direccion_Envio || '',
        Municipio: body.Municipio || '', Departamento: body.Departamento || '',
        Nombre_Empresa: body.Nombre_Empresa || '',
        Correo_Electronico: body.Correo_Electronico || '',
        Cupo_Credito: body.Cupo_Credito || '',
        Plazo_Pago: body.Plazo_Pago || '',
        Lista_Precio: body.Lista_Precio || '',
        Estado: body.Estado || 'Activo'
      };
      var res = await _sb.from('ClientesUnicos').insert([row]).select('id');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, added: 1, id: (res.data && res.data[0]) ? res.data[0].id : null };
    }

    if (action === 'editarClienteUnico') {
      var upd = {
        Cliente: body.Cliente || '', Identificacion: body.Identificacion || '',
        Tipo_Identificacion: body.Tipo_Identificacion || '',
        Telefono: body.Telefono || '', Direccion: body.Direccion || '',
        Direccion_Envio: body.Direccion_Envio || '',
        Municipio: body.Municipio || '', Departamento: body.Departamento || '',
        Nombre_Empresa: body.Nombre_Empresa || '',
        Correo_Electronico: body.Correo_Electronico || '',
        Cupo_Credito: body.Cupo_Credito || '',
        Plazo_Pago: body.Plazo_Pago || '',
        Lista_Precio: body.Lista_Precio || '',
        // Al editar/guardar un cliente en el módulo Clientes se considera
        // revisado: se limpia la marca de "cliente nuevo" (alta desde pedido).
        Cliente_Nuevo: false
      };
      if (typeof body.Estado === 'string' && body.Estado) upd.Estado = body.Estado;
      var res = await _sb.from('ClientesUnicos').update(upd).eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: 1 };
    }

    if (action === 'setEstadoClientes') {
      var _idsEst = (body.ids || []).filter(function(x) { return x !== null && x !== undefined && x !== ''; });
      var _estNew = String(body.estado || '').trim();
      if (['Activo', 'Inactivo', 'Bloqueado por cartera'].indexOf(_estNew) < 0) {
        return { ok: false, error: 'Estado no válido: ' + _estNew };
      }
      if (!_idsEst.length) return { ok: true, updated: 0 };
      var res = await _sb.from('ClientesUnicos').update({ Estado: _estNew }).in('id', _idsEst);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, updated: _idsEst.length };
    }

    if (action === 'eliminarClienteUnico') {
      var res = await _sb.from('ClientesUnicos').delete().eq('id', body.row);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, deleted: 1 };
    }

    if (action === 'deleteClientesPorEmpresa') {
      var empresas = body.empresas || [];
      for (var ei = 0; ei < empresas.length; ei++) {
        await _sb.from('ClientesUnicos').delete().eq('Nombre_Empresa', empresas[ei]);
      }
      return { ok: true };
    }

    if (action === 'upsertClientesUnicos') {
      var items = body.items || [];
      if (!items.length) return { ok: true, added: 0 };
      var rows = items.map(function(it) {
        return {
          Cliente: it.cliente || '', Identificacion: it.nit || '',
          Telefono: it.telefono || '', Direccion: it.direccion || '',
          Direccion_Envio: it.direccion_envio || '',
          Municipio: it.municipio || '', Departamento: it.departamento || '',
          Nombre_Empresa: it.empresa || '', Tipo_Identificacion: it.tipo_identificacion || '',
          Correo_Electronico: it.correo || '', Cupo_Credito: it.cupo_credito || '',
          Plazo_Pago: it.plazo_pago || '', Lista_Precio: it.lista_precio || ''
        };
      });
      var res = await _sb.from('ClientesUnicos').insert(rows);
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

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function debounce(fn, ms) {
  var t;
  return function() { clearTimeout(t); t = setTimeout(fn, ms); };
}

// ── Auditoría: "Creado / Última modificación" (columnas creado_por_nombre,
// creado_en, modificado_por_nombre, modificado_en en ClientesUnicos,
// maestro_productos, ListaPrecios, InventarioFisico) ──
function _fmtAudTs(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  if (isNaN(d)) return String(ts);
  var p = function(n) { return String(n).padStart(2, '0'); };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Para registros agrupados (varias filas = un mismo documento): toma la
// creación más antigua y la modificación más reciente del conjunto.
function _auditoriaAgg(rows) {
  if (!rows || !rows.length) return null;
  var acc = null;
  rows.forEach(function(r) {
    if (!r) return;
    if (!acc) {
      acc = {
        creado_por_nombre: r.creado_por_nombre, creado_en: r.creado_en,
        modificado_por_nombre: r.modificado_por_nombre, modificado_en: r.modificado_en
      };
      return;
    }
    if (r.creado_en && (!acc.creado_en || r.creado_en < acc.creado_en)) {
      acc.creado_en = r.creado_en; acc.creado_por_nombre = r.creado_por_nombre;
    }
    if (r.modificado_en && (!acc.modificado_en || r.modificado_en > acc.modificado_en)) {
      acc.modificado_en = r.modificado_en; acc.modificado_por_nombre = r.modificado_por_nombre;
    }
  });
  return acc;
}

// compact=true -> una línea gris tenue (tarjetas/sedes); compact=false ->
// bloque con borde superior (pie de un modal de detalle/edición).
// `r` puede ser un registro o un array de registros (se agrega).
function _auditoriaHtml(r, compact) {
  if (Array.isArray(r)) r = _auditoriaAgg(r);
  var crNom = (r && r.creado_por_nombre) ? escHtml(r.creado_por_nombre) : '—';
  var crEn = _fmtAudTs(r && r.creado_en);
  var moNom = (r && r.modificado_por_nombre) ? escHtml(r.modificado_por_nombre) : '';
  var moEn = (r && r.modificado_en) ? _fmtAudTs(r.modificado_en) : '';

  if (compact) {
    return '<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #edf2f7;font-size:0.72rem;color:#a0aec0">' +
      'Creado ' + crEn + ' por ' + crNom +
      (moNom ? ' &nbsp;·&nbsp; Modif. ' + moEn + ' por ' + moNom : '') +
      '</div>';
  }
  var modTxt = moNom ? (moNom + ' · ' + moEn) : '<span style="color:#a0aec0">Sin modificaciones</span>';
  return '<div style="border-top:1px solid #e2e8f0;margin-top:16px;padding-top:12px;display:flex;gap:28px;flex-wrap:wrap;font-size:0.8rem;color:#4a5568">' +
    '<div><div style="font-size:0.7rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-bottom:2px">Creado</div>' + crNom + ' · ' + crEn + '</div>' +
    '<div><div style="font-size:0.7rem;text-transform:uppercase;color:#a0aec0;font-weight:700;margin-bottom:2px">Última modificación</div>' + modTxt + '</div>' +
    '</div>';
}

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

// ── Nav-dropdown toggle (Admin menu) ──
(function() {
  document.querySelectorAll('.nav-dropdown').forEach(function(dd) {
    var toggle = dd.querySelector('.nav-dropdown-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      dd.classList.toggle('open');
    });
  });
  document.addEventListener('click', function() {
    document.querySelectorAll('.nav-dropdown.open').forEach(function(dd) {
      dd.classList.remove('open');
    });
  });
})();
