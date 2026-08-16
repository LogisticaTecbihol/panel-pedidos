// Motor reutilizable de asignación de inventario.
// Usado por muestras.js y cambios.js para mostrar stock disponible
// por empresa, asignar cantidades, y generar solicitudes de OC
// cuando la empresa no tiene inventario propio.
//
// Uso:
//   var engine = createAsignacionEngine({
//     getLines:    function() { return workingLines; },
//     getEmpresa:  function() { return empresaActual; },
//     globalName:  'muAsig',
//     prefix:      'mu'
//   });
//   await engine.loadSnapshot();
//   // renderCell(i, l) → HTML de la celda de asignación
//   // engine.splitAsignaciones() → { entregas, solicitudesCompra }

function createAsignacionEngine(config) {
  var _snapshot = null;
  var _getLines = config.getLines;
  var _getEmpresa = config.getEmpresa;
  var _gn = config.globalName;
  var _prefix = config.prefix || 'asig';

  function _normProd(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s*bonificado\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  async function loadSnapshot() {
    try { _snapshot = await Existencias.loadSnapshot(); }
    catch (e) { _snapshot = null; console.warn('No se pudo cargar existencias:', e); }
    return _snapshot;
  }

  function getSnapshot() { return _snapshot; }

  function _pendienteRestante(i) {
    var lines = _getLines();
    var dl = lines[i];
    if (!dl) return 0;
    var pedida = Number(dl.Cantidad) || 0;
    var yaEntregada = Number(dl.Cant_Entregada) || 0;
    var yaAsignada = (dl._asignaciones || []).reduce(function(s, a) { return s + (Number(a.cantidad) || 0); }, 0);
    return Math.max(0, pedida - yaEntregada - yaAsignada);
  }

  function _asignadoEnSesion(empresa, producto, excludeIdx) {
    var empN = norm(empresa);
    var prodN = _normProd(producto);
    var total = 0;
    var lines = _getLines();
    (lines || []).forEach(function(dl, j) {
      if (!dl) return;
      if (_normProd(dl.Producto) !== prodN) return;
      if (dl._asignaciones) {
        dl._asignaciones.forEach(function(a) {
          if (norm(a.empresa_stock) === empN) total += (Number(a.cantidad) || 0);
        });
      }
      if (j !== excludeIdx) {
        var sel = document.querySelector('.' + _prefix + '-asig-empresa[data-i="' + j + '"]');
        var inp = document.querySelector('.' + _prefix + '-asig-cant[data-i="' + j + '"]');
        if (sel && inp && norm(sel.value) === empN) {
          var v = Number(inp.value) || 0;
          if (v > 0) total += v;
        }
      }
    });
    return total;
  }

  function _maxAsignable(i) {
    var sel = document.querySelector('.' + _prefix + '-asig-empresa[data-i="' + i + '"]');
    if (!sel || !sel.value) return null;
    var lines = _getLines();
    var dl = lines[i];
    if (!dl) return null;
    var disp = Number(sel.selectedOptions[0] && sel.selectedOptions[0].dataset.disp) || 0;
    var pendiente = _pendienteRestante(i);
    var yaEnSesion = _asignadoEnSesion(sel.value, dl.Producto, i);
    var libre = Math.max(0, disp - yaEnSesion);
    return Math.min(pendiente, libre);
  }

  function renderCell(i, l) {
    var empresa = _getEmpresa();
    var pedida = Number(l.Cantidad) || 0;
    var yaEntregada = Number(l.Cant_Entregada) || 0;
    var pendienteBase = Math.max(0, pedida - yaEntregada);
    if (pendienteBase <= 0) {
      return '<div style="font-size:0.72rem;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;padding:4px 8px;border-radius:4px;font-weight:700">' +
        '✓ Línea entregada</div>' +
        '<div class="' + _prefix + '-asig-chips" data-i="' + i + '" style="margin-top:4px"></div>';
    }
    var prodStock = _normProd(l.Producto);
    var opciones = '';
    if (_snapshot && typeof Existencias !== 'undefined') {
      var lista = Existencias.getPorEmpresa(_snapshot, prodStock, l.Presentacion);
      lista.sort(function(a, b) {
        var aEs = norm(a.empresa) === norm(empresa) ? 0 : 1;
        var bEs = norm(b.empresa) === norm(empresa) ? 0 : 1;
        if (aEs !== bEs) return aEs - bEs;
        return a.sigla.localeCompare(b.sigla, 'es');
      });
      opciones = lista.map(function(x) {
        var marca = norm(x.empresa) === norm(empresa) ? ' ★' : '';
        var dispRaw = Math.round(x.disponible * 100) / 100;
        var yaSesion = _asignadoEnSesion(x.empresa, prodStock);
        var dispRest = Math.max(0, dispRaw - yaSesion);
        var etiqueta = (yaSesion > 0)
          ? x.sigla + marca + ' · ' + dispRest + ' disp. (base ' + dispRaw + ')'
          : x.sigla + marca + ' · ' + dispRest + ' disp.';
        return '<option value="' + x.empresa.replace(/"/g, '&quot;') + '" data-disp="' + dispRaw + '">' +
          etiqueta + '</option>';
      }).join('');
    }
    var selectHTML = opciones
      ? '<select class="' + _prefix + '-asig-empresa" data-i="' + i + '" onchange="' + _gn + '.onEmpresaChange(' + i + ')" style="width:100%;font-size:0.75rem;padding:2px 4px">' +
        '<option value="">— Empresa origen —</option>' + opciones +
        '</select>'
      : '<div style="font-size:0.72rem;color:#a94442;background:#fdecea;border:1px solid #f5c2c0;padding:2px 6px;border-radius:4px">Sin stock disponible</div>';
    var refBar = '<div style="display:flex;gap:8px;font-size:0.70rem;margin-bottom:4px;padding:2px 6px;background:#eef6fc;border-radius:4px;color:#1a5276;font-weight:600">' +
      '<span>Solicitada: <b>' + pedida + '</b></span>' +
      '<span style="color:#b0bec5">|</span>' +
      '<span>Pend: <b style="color:' + (pendienteBase > 0 ? '#e67e22' : '#27ae60') + '">' + pendienteBase + '</b></span>' +
      '</div>';
    return refBar + selectHTML +
      '<div style="display:flex;gap:4px;margin-top:3px">' +
      '<input type="number" class="' + _prefix + '-asig-cant" data-i="' + i + '" min="0" step="1" placeholder="0" style="width:60px;font-size:0.75rem;padding:2px 4px;text-align:right" oninput="' + _gn + '.validate(' + i + ')">' +
      '<button type="button" onclick="' + _gn + '.addAsignacion(' + i + ')" ' +
      'style="background:#3498db;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:0.75rem;font-weight:700;cursor:pointer">+ Añadir</button>' +
      '</div>' +
      '<div class="' + _prefix + '-asig-chips" data-i="' + i + '" style="margin-top:4px"></div>';
  }

  function refreshCell(i) {
    var td = document.querySelector('.' + _prefix + '-asig-td[data-i="' + i + '"]');
    if (!td) return;
    var lines = _getLines();
    var l = lines[i];
    if (!l) return;
    td.innerHTML = renderCell(i, l);
    renderChips(i);
  }

  function onEmpresaChange(i) {
    var inp = document.querySelector('.' + _prefix + '-asig-cant[data-i="' + i + '"]');
    if (!inp) return;
    var tope = _maxAsignable(i);
    if (tope == null) {
      inp.removeAttribute('max');
      inp.placeholder = '0';
      inp.classList.remove('error');
      inp.title = '';
      return;
    }
    inp.max = tope;
    inp.placeholder = 'máx ' + tope;
    validate(i);
  }

  function validate(i, _skipProp) {
    var inp = document.querySelector('.' + _prefix + '-asig-cant[data-i="' + i + '"]');
    var sel = document.querySelector('.' + _prefix + '-asig-empresa[data-i="' + i + '"]');
    if (!inp) return;
    var cant = Number(inp.value) || 0;
    if (cant <= 0) { inp.classList.remove('error'); inp.title = ''; if (!_skipProp) _propagate(i); return; }
    if (!sel || !sel.value) { inp.classList.add('error'); inp.title = 'Selecciona primero la empresa origen'; if (!_skipProp) _propagate(i); return; }
    var lines = _getLines();
    var dl = lines[i];
    var pendiente = _pendienteRestante(i);
    var disp = Number(sel.selectedOptions[0] && sel.selectedOptions[0].dataset.disp) || 0;
    var yaEnSesion = dl ? _asignadoEnSesion(sel.value, dl.Producto, i) : 0;
    var libre = Math.max(0, disp - yaEnSesion);
    var tope = Math.min(pendiente, libre);
    if (cant > tope) {
      inp.value = tope;
      inp.max = tope;
      var motivo = (tope === pendiente && pendiente <= libre)
        ? 'Ajustado al pendiente por entregar (' + pendiente + ')'
        : 'Ajustado al disponible en esa empresa (' + libre + ')';
      inp.title = motivo;
      inp.classList.add('error');
      clearTimeout(inp._clampTimer);
      inp._clampTimer = setTimeout(function() { inp.classList.remove('error'); }, 900);
      if (!_skipProp) _propagate(i);
      return;
    }
    inp.classList.remove('error');
    inp.title = '';
    if (!_skipProp) _propagate(i);
  }

  function _propagate(i) {
    var lines = _getLines();
    var dl = lines[i];
    if (!dl) return;
    var prodN = _normProd(dl.Producto);
    lines.forEach(function(other, j) {
      if (j === i || !other) return;
      if (_normProd(other.Producto) !== prodN) return;
      validate(j, true);
    });
  }

  function _refreshSameProduct(i) {
    var lines = _getLines();
    var dl = lines[i];
    if (!dl) return;
    var prodN = _normProd(dl.Producto);
    lines.forEach(function(other, j) {
      if (j === i || !other) return;
      if (_normProd(other.Producto) !== prodN) return;
      refreshCell(j);
    });
  }

  function addAsignacion(i) {
    var lines = _getLines();
    var dl = lines[i];
    if (!dl) return;
    var sel = document.querySelector('.' + _prefix + '-asig-empresa[data-i="' + i + '"]');
    var inp = document.querySelector('.' + _prefix + '-asig-cant[data-i="' + i + '"]');
    if (!sel || !inp) return;
    var empresa = sel.value;
    var cant = Number(inp.value) || 0;
    if (!empresa) { showToast('Selecciona la empresa origen', '#e67e22'); return; }
    if (cant <= 0) { showToast('Ingresa una cantidad mayor a 0', '#e67e22'); return; }
    validate(i);
    if (inp.classList.contains('error')) {
      showToast(inp.title || 'Cantidad inválida', '#e74c3c');
      return;
    }
    if (!dl._asignaciones) dl._asignaciones = [];
    dl._asignaciones.push({ empresa_stock: empresa, cantidad: cant });
    inp.value = '';
    sel.selectedIndex = 0;
    inp.removeAttribute('max');
    inp.placeholder = '0';
    inp.classList.remove('error');
    inp.title = '';
    renderChips(i);
    _refreshSameProduct(i);
  }

  function removeAsignacion(i, k) {
    var lines = _getLines();
    var dl = lines[i];
    if (!dl || !dl._asignaciones) return;
    dl._asignaciones.splice(k, 1);
    renderChips(i);
    _refreshSameProduct(i);
  }

  function renderChips(i) {
    var wrap = document.querySelector('.' + _prefix + '-asig-chips[data-i="' + i + '"]');
    if (!wrap) return;
    var lines = _getLines();
    var dl = lines[i];
    var arr = (dl && dl._asignaciones) || [];
    if (!arr.length) { wrap.innerHTML = ''; return; }
    var empRec = norm(_getEmpresa());
    wrap.innerHTML = arr.map(function(a, k) {
      var sigla = getSigla(a.empresa_stock);
      var traslado = norm(a.empresa_stock) !== empRec;
      var tag = traslado
        ? '<span style="color:#c0392b;font-weight:700">🛒 solicitud de compra (remisión pendiente)</span>'
        : '<span style="color:#27ae60;font-weight:700">✓ mismo origen — genera remisión</span>';
      return '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;font-size:0.7rem;background:#eef5ff;padding:2px 6px;border-radius:4px;border:1px solid #cfe1ff">' +
        '<span style="flex:1"><strong>' + a.cantidad + '</strong> ud · ' + sigla + ' · ' + tag + '</span>' +
        '<button type="button" onclick="' + _gn + '.removeAsignacion(' + i + ',' + k + ')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:0.72rem;padding:0 2px" title="Quitar asignación">✕</button>' +
        '</div>';
    }).join('');
  }

  function splitAsignaciones() {
    var entregas = [];
    var solicitudesCompra = [];
    var empN = norm(_getEmpresa());
    var lines = _getLines();
    lines.forEach(function(dl, i) {
      var asigs = (dl && dl._asignaciones) || [];
      asigs.forEach(function(a) {
        var cant = Number(a.cantidad) || 0;
        if (cant <= 0) return;
        var item = { _idx: i, cantidad: cant, empresa_stock: a.empresa_stock };
        if (norm(a.empresa_stock) === empN) entregas.push(item);
        else solicitudesCompra.push(item);
      });
    });
    return { entregas: entregas, solicitudesCompra: solicitudesCompra };
  }

  async function persistirOCSolicitudes(solicitudes, opts) {
    if (!solicitudes.length) return;
    var lines = _getLines();
    var empresa = _getEmpresa();
    var uid = _uid();
    var stamp = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    var ymd = stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate());
    var hms = pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds());
    var fecha = opts.fecha || ymd;
    var refLabel = opts.refLabel || '';
    var counter = 0;

    var porOrigen = {};
    solicitudes.forEach(function(sol) {
      var key = norm(sol.empresa_stock);
      if (!porOrigen[key]) porOrigen[key] = { empresa_stock: sol.empresa_stock, items: [] };
      porOrigen[key].items.push(sol);
    });

    var keys = Object.keys(porOrigen);
    for (var gi = 0; gi < keys.length; gi++) {
      var grupo = porOrigen[keys[gi]];
      counter += 1;
      var siglaOrig = getSigla(grupo.empresa_stock) || '';
      var consecTras = 'T-' + ymd + '-' + hms + (siglaOrig ? '-' + siglaOrig : '') +
        (counter > 1 && !siglaOrig ? '-' + counter : '');
      var obsGrupo = 'Solicitud de compra automática por ' + refLabel +
        ' — legalizar en Órdenes (Remisión Destino + Origen) para ' +
        'que el stock entre a ' + empresa + '.';
      for (var li = 0; li < grupo.items.length; li++) {
        var sol = grupo.items[li];
        var dl = lines[sol._idx] || {};
        var ocRow = {
          Fecha: fecha,
          Empresa_Destino: empresa,
          Empresa_Origen: grupo.empresa_stock,
          Consecutivo: consecTras,
          Tipo: 'Traslado',
          Ref_Pedido: refLabel,
          Producto: dl.Producto || '',
          Presentacion: dl.Presentacion || '',
          Cantidad: sol.cantidad,
          Valor_Unitario: 0, Valor_Total: 0, Total_Orden: 0,
          Estado: 'Abierta',
          Remision: '',
          Bodega: 'Productos Buenos',
          Observaciones: obsGrupo,
          creado_por: uid
        };
        var ocRes = await _sb.from('OrdenesCompra').insert(ocRow);
        if (ocRes.error) throw new Error('OC solicitud compra: ' + ocRes.error.message);
      }
      _notifyAprobadores({
        empresaOrig: grupo.empresa_stock,
        empresaDest: empresa,
        consecutivo: consecTras,
        nLineas: grupo.items.length,
        refLabel: refLabel
      });
    }
  }

  async function _notifyAprobadores(info) {
    if (typeof NOTIF === 'undefined' || !NOTIF.notifyUsers) return;
    try {
      var res = await _sb.rpc('find_oc_approvers', { p_empresa: info.empresaOrig });
      var ids = (res.data || []).map(function(r) { return r.usuario_id; });
      if (!ids.length) return;
      var siglaD = getSigla(info.empresaDest);
      var siglaO = getSigla(info.empresaOrig);
      await NOTIF.notifyUsers({
        para_ids: ids,
        modulo: 'ordenes',
        referencia: info.consecutivo || '',
        titulo: '🛒 Solicitud de compra por aprobar: ' + siglaD + ' ← ' + siglaO + ' #' + (info.consecutivo || ''),
        mensaje: info.nLineas + ' línea(s) · Ref: ' + info.refLabel
      });
    } catch (e) { console.warn('No se pudo notificar aprobadores OC:', e); }
  }

  var engine = {
    loadSnapshot: loadSnapshot,
    getSnapshot: getSnapshot,
    renderCell: renderCell,
    refreshCell: refreshCell,
    addAsignacion: addAsignacion,
    removeAsignacion: removeAsignacion,
    renderChips: renderChips,
    validate: validate,
    onEmpresaChange: onEmpresaChange,
    splitAsignaciones: splitAsignaciones,
    persistirOCSolicitudes: persistirOCSolicitudes
  };

  window[_gn] = engine;
  return engine;
}
