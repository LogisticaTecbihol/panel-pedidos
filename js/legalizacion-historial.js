// ── Historial de una legalización (pestaña "Historial") ──
// Dos modos (selector «Consultar»): «Una legalización» y «Cambios desde una fecha»
// (al final de este archivo: qué legalizaciones/envíos se crearon, cambiaron o
// eliminaron desde un momento, para explicar por qué el Prorrateo de un mes ya
// no da lo mismo que cuando se calculó).
//
// Para un consecutivo (LEG-00044, ENV-00012…) muestra todo lo que quedó en el
// registro de auditoría: quién la creó, qué cambió y cuándo, en la cabecera, en
// las líneas de gasto y en el reparto entre empresas. Los eventos crudos los
// entrega el servidor (get_historial_legalizacion_gastos, SECURITY DEFINER:
// audit_log solo lo lee un admin) y aquí se agrupan por guardado y se leen como
// diferencias. Requiere shared.js (apiGet, escHtml, fmtMoney, fmtDate, showToast,
// today) y auth.js.
//
// Visible solo para quien concilia gastos (AUTH.canConciliarGastos) y que no esté
// limitado a una sola empresa (el servidor lo hace cumplir también).
//
// Al guardar una legalización el panel borra y vuelve a crear sus líneas de gasto
// y su reparto, así que el audit_log trae DELETE + INSERT aunque nada haya
// cambiado: por eso se comparan por contenido y las que quedan iguales se
// resumen como «sin cambios».

var histData = null; // { generado, consecutivo, registros: [{ id, existe, actual, truncado, eventos }] }

// Eventos del mismo usuario separados por menos de esto = un mismo guardado
// (cada guardado hace varias escrituras, repartidas en un par de segundos).
var HIST_GAP_MS = 20000;

var HIST_CAMPOS = {
  Consecutivo: 'Consecutivo', Tipo: 'Tipo', Fecha: 'Fecha', Placa: 'Placa', Responsable: 'Responsable',
  Recorrido_Ruta: 'Recorrido / ruta', No_Personas: 'N.º de personas', Clientes: 'Clientes',
  Fecha_Salida: 'Fecha de salida', Fecha_Llegada: 'Fecha de llegada', Hora_Salida: 'Hora de salida', Hora_Llegada: 'Hora de llegada',
  Km_Salida: 'Km de salida', Km_Llegada: 'Km de llegada', Remisiones_Relacionadas: 'Remisiones relacionadas',
  Anticipo_Entregado: 'Anticipo entregado', Saldo_Favor_Empleado: 'Saldo a favor del empleado',
  Saldo_Reembolsar_Empresa: 'Saldo a reembolsar a la empresa', Observaciones: 'Observaciones',
  Estado_Conciliacion: 'Estado', Conciliado_Por: 'Conciliado por', Fecha_Conciliacion: 'Fecha de conciliación',
  Motivo_Rechazo: 'Motivo del rechazo',
  Concepto: 'Concepto', Proveedor: 'Proveedor', NIT: 'NIT', Valor: 'Valor', Galones: 'Galones', Km_Placa: 'Km',
  Empresa: 'Empresa', Monto: 'Monto',
  Remision: 'Remisión', Planta: 'Planta', Producto: 'Producto', Presentacion: 'Presentación', Cantidad: 'Cantidad', Unidad: 'Unidad'
};
var HIST_MONEDA = ['Anticipo_Entregado', 'Saldo_Favor_Empleado', 'Saldo_Reembolsar_Empresa', 'Valor', 'Monto'];
var HIST_FECHA = ['Fecha', 'Fecha_Salida', 'Fecha_Llegada'];
var HIST_FECHA_HORA = ['Fecha_Conciliacion'];
var HIST_TABLAS = {
  LegalizacionGastos: 'Cabecera', LegalizacionGastosItems: 'Línea de gasto', LegalizacionGastosEmpresas: 'Reparto',
  RemisionesExternas: 'Remisión externa', RemisionesExternasItems: 'Línea de remisión'
};
var HIST_ACCIONES = { INSERT: 'Alta', UPDATE: 'Cambio', DELETE: 'Baja' };
var HIST_TIPOS = {
  creacion:     { icono: '✨', titulo: 'Creación' },
  modificacion: { icono: '✏️', titulo: 'Modificación' },
  conciliacion: { icono: '✅', titulo: 'Conciliación' },
  rechazo:      { icono: '⛔', titulo: 'Rechazo' },
  eliminacion:  { icono: '🗑️', titulo: 'Eliminación' }
};

// ── Permiso y visibilidad ──
function histPuede() {
  return typeof AUTH !== 'undefined' && AUTH.canConciliarGastos() &&
    !(typeof empresaPropia !== 'undefined' && empresaPropia);
}

// ¿Mostrar también los cambios de las remisiones externas relacionadas? (casilla de la pestaña)
function histVerRemisiones() {
  var c = document.getElementById('hf-rem');
  return !c || c.checked;
}

// Muestra la pestaña solo a quien puede (se llama al cargar las legalizaciones).
function aplicarVisibilidadHistorial() {
  var tab = document.getElementById('tab-historial');
  if (tab) tab.style.display = histPuede() ? '' : 'none';
}

// ── Formato ──
function histFechaHora(iso) {
  var d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function histVacio(v) { return v === null || v === undefined || v === ''; }

function histCampo(k) { return HIST_CAMPOS[k] || k.replace(/_/g, ' '); }

function histValor(k, v) {
  if (histVacio(v)) return '(vacío)';
  if (HIST_MONEDA.indexOf(k) >= 0) return fmtMoney(v);
  if (HIST_FECHA.indexOf(k) >= 0) return fmtDate(v);
  if (HIST_FECHA_HORA.indexOf(k) >= 0) return histFechaHora(v);
  return String(v);
}

// Campos con valor de un registro, como "Campo: valor" (sin id ni vacíos).
function histPares(d) {
  return Object.keys(d || {}).filter(function(k) { return k !== 'id' && k !== 'Legalizacion_Id' && k !== 'Remision_Id' && !histVacio(d[k]); })
    .map(function(k) { return histCampo(k) + ': ' + histValor(k, d[k]); });
}

function histChips(pares) {
  return pares.map(function(p) { return '<span class="hist-chip">' + escHtml(p) + '</span>'; }).join('');
}

// Una línea de gasto en una frase: Peaje · Proveedor · NIT 901… · $24.800
function histItemTxt(d) {
  d = d || {};
  var p = [];
  if (!histVacio(d.Concepto)) p.push(d.Concepto);
  if (!histVacio(d.Proveedor)) p.push(d.Proveedor);
  if (!histVacio(d.NIT)) p.push('NIT ' + d.NIT);
  if (!histVacio(d.Placa)) p.push('placa ' + d.Placa);
  if (!histVacio(d.Galones)) p.push(d.Galones + ' gal');
  if (!histVacio(d.Km_Placa)) p.push(d.Km_Placa + ' km');
  p.push(fmtMoney(d.Valor));
  return p.join(' · ');
}

// Clave para comparar dos filas por contenido (sin id ni vacíos).
function histClave(d) {
  var o = {};
  Object.keys(d || {}).sort().forEach(function(k) {
    if (k === 'id' || k === 'Legalizacion_Id' || histVacio(d[k])) return;
    o[k] = d[k];
  });
  return JSON.stringify(o);
}

// ── Agrupar y leer los eventos ──

// Deja en cada evento `_previo` (cómo estaba la fila antes) para poder nombrar
// la línea o la empresa en un UPDATE, que solo trae los campos que cambiaron.
function histAnotarPrevios(eventos) {
  var estado = {};
  eventos.forEach(function(e) {
    var k = e.tabla + ':' + e.registro_id;
    e._previo = estado[k] ? Object.assign({}, estado[k]) : null;
    if (e.accion === 'INSERT') estado[k] = Object.assign({}, e.despues || {});
    else if (e.accion === 'UPDATE') estado[k] = Object.assign({}, estado[k] || {}, e.despues || {});
    else if (e.accion === 'DELETE') estado[k] = Object.assign({}, e.antes || {});
  });
}

// Eventos (ya en orden) → guardados: mismo usuario y a pocos segundos uno del otro.
function histAgrupar(eventos) {
  var bloques = [];
  var cur = null;
  eventos.forEach(function(e) {
    var t = new Date(e.cuando).getTime();
    if (!cur || cur.usuario !== e.usuario || (t - cur.ultimo) > HIST_GAP_MS) {
      cur = { usuario: e.usuario, email: e.email, inicio: e.cuando, ultimo: t, eventos: [] };
      bloques.push(cur);
    }
    cur.ultimo = t;
    cur.eventos.push(e);
  });
  return bloques;
}

// Quita de `quitadas` y `agregadas` las filas idénticas (las que el guardado
// borró y volvió a crear igual). Devuelve lo que queda y cuántas eran iguales.
function histDiffFilas(quitadas, agregadas) {
  var rest = agregadas.slice();
  var q = [];
  var iguales = 0;
  quitadas.forEach(function(d) {
    var c = histClave(d);
    var i = rest.findIndex(function(a) { return histClave(a) === c; });
    if (i >= 0) { rest.splice(i, 1); iguales++; }
    else q.push(d);
  });
  return { quitadas: q, agregadas: rest, iguales: iguales };
}

function histLinea(signo, html) {
  return { signo: signo, html: html };
}

// Líneas de lo que pasó con una cabecera (legalización o remisión externa):
// alta → sus datos; baja → lo que tenía; cambio → campo: antes → después.
function histCabeceraLineas(cab) {
  var out = [];
  cab.forEach(function(e) {
    if (e.accion === 'INSERT') {
      out.push(histLinea('', '<div class="hist-chips">' + histChips(histPares(e.despues)) + '</div>'));
    } else if (e.accion === 'DELETE') {
      out.push(histLinea('', 'Eliminada. Tenía: <div class="hist-chips">' + histChips(histPares(e.antes)) + '</div>'));
    } else {
      Object.keys(e.despues || {}).forEach(function(k) {
        out.push(histLinea('', '<strong>' + escHtml(histCampo(k)) + ':</strong> ' +
          '<span class="hist-antes">' + escHtml(histValor(k, (e.antes || {})[k])) + '</span> → ' +
          '<span class="hist-despues">' + escHtml(histValor(k, e.despues[k])) + '</span>'));
      });
    }
  });
  return out;
}

// Qué hizo un guardado: { tipo, cabecera:[], gastos:[], reparto:[], soloLineas }.
// Cada línea es { signo: '+' | '−' | '·' | '', html }.
function histDescribirBloque(bloque) {
  var ev = bloque.eventos;
  var cab = ev.filter(function(e) { return e.tabla === 'LegalizacionGastos'; });
  var its = ev.filter(function(e) { return e.tabla === 'LegalizacionGastosItems'; });
  var ems = ev.filter(function(e) { return e.tabla === 'LegalizacionGastosEmpresas'; });

  var tipo = 'modificacion';
  if (cab.some(function(e) { return e.accion === 'INSERT'; })) tipo = 'creacion';
  else if (cab.some(function(e) { return e.accion === 'DELETE'; })) tipo = 'eliminacion';
  else {
    cab.forEach(function(e) {
      var est = e.accion === 'UPDATE' && e.despues ? e.despues.Estado_Conciliacion : null;
      if (est === 'Conciliada') tipo = 'conciliacion';
      else if (est === 'Rechazada') tipo = 'rechazo';
    });
  }

  var cabecera = histCabeceraLineas(cab);

  // Líneas de gasto
  var gastos = [];
  var quitadas = its.filter(function(e) { return e.accion === 'DELETE'; }).map(function(e) { return e.antes || {}; });
  var agregadas = its.filter(function(e) { return e.accion === 'INSERT'; }).map(function(e) { return e.despues || {}; });
  var dg = histDiffFilas(quitadas, agregadas);
  dg.quitadas.forEach(function(d) { gastos.push(histLinea('−', escHtml(histItemTxt(d)) + ' <span class="hist-nota">(quitada)</span>')); });
  dg.agregadas.forEach(function(d) { gastos.push(histLinea('+', escHtml(histItemTxt(d)) + (tipo === 'creacion' ? '' : ' <span class="hist-nota">(agregada)</span>'))); });
  its.filter(function(e) { return e.accion === 'UPDATE'; }).forEach(function(e) {
    var base = Object.assign({}, e._previo || {});
    var cambios = Object.keys(e.despues || {}).map(function(k) {
      return escHtml(histCampo(k)) + ': <span class="hist-antes">' + escHtml(histValor(k, (e.antes || {})[k])) + '</span> → <span class="hist-despues">' + escHtml(histValor(k, e.despues[k])) + '</span>';
    }).join(' · ');
    gastos.push(histLinea('', escHtml(base.Concepto ? histItemTxt(base) : 'Línea #' + e.registro_id) + ' — ' + cambios));
  });
  if (dg.iguales) {
    gastos.push(histLinea('·', '<span class="hist-nota">' + dg.iguales + (dg.iguales === 1 ? ' línea sin cambios (se regrabó igual)' : ' líneas sin cambios (se regrabaron iguales)') + '</span>'));
  }

  // Reparto entre empresas
  var reparto = [];
  var antes = {}, despues = {}, orden = [];
  function _nota(mapa, emp, monto) {
    if (!(emp in antes) && !(emp in despues)) orden.push(emp);
    mapa[emp] = (mapa[emp] || 0) + (Number(monto) || 0);
  }
  ems.forEach(function(e) {
    if (e.accion === 'DELETE') _nota(antes, (e.antes || {}).Empresa, (e.antes || {}).Monto);
    else if (e.accion === 'INSERT') _nota(despues, (e.despues || {}).Empresa, (e.despues || {}).Monto);
  });
  var igualesRep = 0;
  orden.forEach(function(emp) {
    var a = emp in antes, d = emp in despues;
    if (a && d) {
      if (antes[emp] === despues[emp]) igualesRep++;
      else reparto.push(histLinea('', '<strong>' + escHtml(emp) + ':</strong> <span class="hist-antes">' + escHtml(fmtMoney(antes[emp])) + '</span> → <span class="hist-despues">' + escHtml(fmtMoney(despues[emp])) + '</span>'));
    } else if (a) {
      reparto.push(histLinea('−', '<strong>' + escHtml(emp) + '</strong> ' + escHtml(fmtMoney(antes[emp])) + ' <span class="hist-nota">(quitada)</span>'));
    } else {
      reparto.push(histLinea('+', '<strong>' + escHtml(emp) + '</strong> ' + escHtml(fmtMoney(despues[emp])) + (tipo === 'creacion' ? '' : ' <span class="hist-nota">(agregada)</span>')));
    }
  });
  ems.filter(function(e) { return e.accion === 'UPDATE'; }).forEach(function(e) {
    var emp = (e.despues || {}).Empresa || (e._previo || {}).Empresa || 'Fila #' + e.registro_id;
    var cambios = Object.keys(e.despues || {}).filter(function(k) { return k !== 'Empresa'; }).map(function(k) {
      return escHtml(histCampo(k)) + ': <span class="hist-antes">' + escHtml(histValor(k, (e.antes || {})[k])) + '</span> → <span class="hist-despues">' + escHtml(histValor(k, e.despues[k])) + '</span>';
    }).join(' · ');
    reparto.push(histLinea('', '<strong>' + escHtml(emp) + ':</strong> ' + cambios));
  });
  if (igualesRep) {
    reparto.push(histLinea('·', '<span class="hist-nota">' + igualesRep + (igualesRep === 1 ? ' empresa sin cambios' : ' empresas sin cambios') + '</span>'));
  }

  return { tipo: tipo, cabecera: cabecera, gastos: gastos, reparto: reparto, soloLineas: cab.length === 0 && tipo === 'modificacion' };
}

// ── Remisiones externas relacionadas ──
// El reparto de una legalización sale de la planta y las líneas de sus remisiones
// externas (MP-…, Chia Abago): corregir una de ellas y re-guardar la legalización
// es una modificación que, sin esto, solo se vería en el historial de la remisión.

function histRemNombre(d) {
  d = d || {};
  return [d.Producto, d.Presentacion].filter(function(x) { return !histVacio(x); }).join(' ') || 'Línea';
}

// Una línea de remisión en una frase: Producto Presentación · 140 L
function histRemItemTxt(d) {
  d = d || {};
  var cant = histVacio(d.Cantidad) ? '' : String(d.Cantidad) + (histVacio(d.Unidad) ? '' : ' ' + d.Unidad);
  return histRemNombre(d) + (cant ? ' · ' + cant : '');
}

// Mismo producto, presentación y unidad = la misma línea con otra cantidad.
function histRemClaveNombre(d) {
  d = d || {};
  return [d.Producto, d.Presentacion, d.Unidad].map(function(x) { return String(x || '').trim().toLowerCase(); }).join('|');
}

// Empareja lo quitado con lo agregado que sea la misma línea (misma clave de
// nombre): son cambios de cantidad, no una línea quitada y otra nueva.
function histEmparejarLineas(quitadas, agregadas) {
  var rest = agregadas.slice();
  var cambios = [];
  var q = [];
  quitadas.forEach(function(d) {
    var c = histRemClaveNombre(d);
    var i = rest.findIndex(function(a) { return histRemClaveNombre(a) === c; });
    if (i >= 0) { cambios.push({ antes: d, despues: rest[i] }); rest.splice(i, 1); }
    else q.push(d);
  });
  return { cambios: cambios, quitadas: q, agregadas: rest };
}

// Qué hizo un guardado sobre una remisión externa: { tipo, cabecera:[], lineas:[] }.
function histDescribirBloqueRem(bloque) {
  var ev = bloque.eventos;
  var cab = ev.filter(function(e) { return e.tabla === 'RemisionesExternas'; });
  var its = ev.filter(function(e) { return e.tabla === 'RemisionesExternasItems'; });

  var tipo = 'modificacion';
  if (cab.some(function(e) { return e.accion === 'INSERT'; })) tipo = 'creacion';
  else if (cab.some(function(e) { return e.accion === 'DELETE'; })) tipo = 'eliminacion';

  var lineas = [];
  var quitadas = its.filter(function(e) { return e.accion === 'DELETE'; }).map(function(e) { return e.antes || {}; });
  var agregadas = its.filter(function(e) { return e.accion === 'INSERT'; }).map(function(e) { return e.despues || {}; });
  var dg = histDiffFilas(quitadas, agregadas);
  var par = histEmparejarLineas(dg.quitadas, dg.agregadas);
  par.cambios.forEach(function(c) {
    var cambios = Object.keys(c.despues).filter(function(k) {
      return k !== 'id' && k !== 'Remision_Id' && String(c.antes[k]) !== String(c.despues[k]);
    }).map(function(k) {
      return escHtml(histCampo(k)) + ': <span class="hist-antes">' + escHtml(histValor(k, c.antes[k])) + '</span> → <span class="hist-despues">' + escHtml(histValor(k, c.despues[k])) + '</span>';
    }).join(' · ');
    lineas.push(histLinea('', '<strong>' + escHtml(histRemNombre(c.despues)) + ':</strong> ' + cambios));
  });
  par.quitadas.forEach(function(d) { lineas.push(histLinea('−', escHtml(histRemItemTxt(d)) + ' <span class="hist-nota">(quitada)</span>')); });
  par.agregadas.forEach(function(d) { lineas.push(histLinea('+', escHtml(histRemItemTxt(d)) + (tipo === 'creacion' ? '' : ' <span class="hist-nota">(agregada)</span>'))); });
  its.filter(function(e) { return e.accion === 'UPDATE'; }).forEach(function(e) {
    var base = e._previo || {};
    var cambios = Object.keys(e.despues || {}).map(function(k) {
      return escHtml(histCampo(k)) + ': <span class="hist-antes">' + escHtml(histValor(k, (e.antes || {})[k])) + '</span> → <span class="hist-despues">' + escHtml(histValor(k, e.despues[k])) + '</span>';
    }).join(' · ');
    lineas.push(histLinea('', '<strong>' + escHtml(base.Producto ? histRemNombre(base) : 'Línea #' + e.registro_id) + ':</strong> ' + cambios));
  });
  if (dg.iguales) {
    lineas.push(histLinea('·', '<span class="hist-nota">' + dg.iguales + (dg.iguales === 1 ? ' línea sin cambios (se regrabó igual)' : ' líneas sin cambios (se regrabaron iguales)') + '</span>'));
  }

  return { tipo: tipo, cabecera: histCabeceraLineas(cab), lineas: lineas };
}

// Texto plano de un evento (para el Excel).
function histDetalleEvento(e) {
  if (e.accion === 'UPDATE') {
    return Object.keys(e.despues || {}).map(function(k) {
      return histCampo(k) + ': ' + histValor(k, (e.antes || {})[k]) + ' → ' + histValor(k, e.despues[k]);
    }).join('; ');
  }
  return histPares(e.accion === 'DELETE' ? e.antes : e.despues).join('; ');
}

// ── Pantalla ──
function histConsecutivoDe(reg) {
  var leg = (typeof legs !== 'undefined') ? legs.find(function(l) { return l.id === reg.id; }) : null;
  if (leg && leg.Consecutivo) return leg.Consecutivo;
  // Ya no existe (o no está cargada): el último consecutivo que dejó el audit_log.
  var ult = '';
  (reg.eventos || []).forEach(function(e) {
    if (e.tabla !== 'LegalizacionGastos') return;
    var c = (e.despues && e.despues.Consecutivo) || (e.antes && e.antes.Consecutivo);
    if (c) ult = c;
  });
  return ult || (histData ? histData.consecutivo : '');
}

function histListaConsecutivos() {
  var dl = document.getElementById('hf-cons-list');
  if (!dl || typeof legs === 'undefined') return;
  dl.innerHTML = legs.slice().sort(function(a, b) { return b.id - a.id; }).map(function(l) {
    var desc = [fmtDate(l.Fecha), l.Responsable || '', l.Tipo || ''].filter(Boolean).join(' · ');
    return '<option value="' + escHtml(l.Consecutivo) + '">' + escHtml(desc) + '</option>';
  }).join('');
}

// Al abrir la pestaña: arma la lista de sugerencias; la consulta es a demanda.
function abrirTabHistorial() {
  histListaConsecutivos();
  if (!histData) {
    document.getElementById('hist-body').innerHTML =
      '<div class="empty">Escribe un consecutivo (LEG-00044, ENV-00012…) y pulsa «Consultar».</div>';
  }
}

async function cargarHistorial(cons) {
  var inp = document.getElementById('hf-cons');
  var valor = String(cons || inp.value || '').trim();
  if (!valor) { showToast('Escribe el consecutivo (p. ej. LEG-00044)', '#e67e22'); return; }
  inp.value = valor;
  var box = document.getElementById('hist-body');
  box.innerHTML = '<div class="empty">Cargando…</div>';
  var res = await apiGet('getHistorialLegalizacion', { consecutivo: valor });
  if (!res.ok) {
    histData = null;
    box.innerHTML = '<div class="empty" style="color:#c0392b">' + escHtml(res.error || 'No se pudo cargar el historial.') + '</div>';
    return;
  }
  histData = res.historial;
  renderHistorialTab();
}

// Desde el detalle «Ver»: abre la pestaña ya consultada con esa legalización.
function abrirHistorialDesdeVer() {
  var leg = legs.find(function(l) { return l.id === verLegId; });
  if (!leg) return;
  closeVer();
  switchTab('historial');
  histIrAConsecutivo(leg.Consecutivo);
}

// Pasa al modo «Una legalización» y consulta ese consecutivo.
function histIrAConsecutivo(cons) {
  document.getElementById('hm-modo').value = 'consecutivo';
  cambiarModoHistorial();
  cargarHistorial(cons);
}

function histBloqueHtml(bloque) {
  var esRem = !!bloque.rem; // guardado de una remisión externa relacionada
  var d = esRem ? histDescribirBloqueRem(bloque) : histDescribirBloque(bloque);
  var t = HIST_TIPOS[d.tipo];
  var titulo = esRem ? '📦 Remisión ' + escHtml(bloque.rem.remision || 'externa') + ' · ' + t.titulo : t.icono + ' ' + t.titulo;
  var quien = bloque.usuario || 'Sistema (cambio directo en la base de datos)';

  function seccion(titulo, lineas) {
    if (!lineas.length) return '';
    return '<div class="hist-sec"><div class="hist-sec-t">' + titulo + '</div>' +
      lineas.map(function(l) {
        var cls = l.signo === '+' ? ' hist-mas' : (l.signo === '−' ? ' hist-menos' : '');
        return '<div class="hist-linea' + cls + '">' + (l.signo && l.signo !== '·' ? '<span class="hist-signo">' + l.signo + '</span>' : '') + '<span>' + l.html + '</span></div>';
      }).join('') + '</div>';
  }

  return '<div class="hist-bloque hist-' + d.tipo + (esRem ? ' hist-rem' : '') + '">' +
    '<div class="hist-cab"><strong>' + titulo + '</strong>' +
      '<span class="hist-cuando">' + escHtml(histFechaHora(bloque.inicio)) + '</span>' +
      '<span>' + escHtml(quien) + '</span>' +
      (bloque.email ? '<span class="hist-nota">' + escHtml(bloque.email) + '</span>' : '') +
    '</div>' +
    (esRem
      ? seccion('Remisión externa', d.cabecera) + seccion('Líneas de la remisión', d.lineas)
      : seccion('Cabecera', d.cabecera) + seccion('Líneas de gasto', d.gastos) + seccion('Reparto entre empresas', d.reparto)) +
    (d.soloLineas ?'<div class="hist-nota" style="margin-top:6px">ℹ️ Solo cambiaron líneas o reparto: un guardado así no actualiza «Modificada» en la cabecera.</div>' : '') +
  '</div>';
}

function histRegistroHtml(reg) {
  var a = reg.actual;
  var cons = histConsecutivoDe(reg);
  var eventos = reg.eventos || [];
  histAnotarPrevios(eventos);
  var bloquesLeg = histAgrupar(eventos);

  // Guardados de las remisiones externas relacionadas, en la misma línea de tiempo.
  var bloquesRem = [];
  if (histVerRemisiones()) {
    (reg.remisiones || []).forEach(function(m) {
      var evs = m.eventos || [];
      histAnotarPrevios(evs);
      histAgrupar(evs).forEach(function(b) { b.rem = m; bloquesRem.push(b); });
    });
  }
  var bloques = bloquesLeg.concat(bloquesRem);
  bloques.forEach(function(b, i) { b._i = i; });
  bloques.sort(function(a, b) { return (new Date(a.inicio) - new Date(b.inicio)) || (a._i - b._i); });

  var tipoTxt = a ? (typeof tipoLabel === 'function' ? tipoLabel({ Tipo: a.tipo }) : (a.tipo || '')) : '';
  var meta = a
    ? [tipoTxt, a.fecha ? 'Fecha ' + fmtDate(a.fecha) : '', a.responsable || '', a.placa || ''].filter(Boolean).join(' · ')
    : '';
  var resumen = '';
  if (a) {
    resumen = '<div class="hist-resumen">' +
      '<span><strong>Estado:</strong> ' + escHtml(a.estado || '—') + (a.conciliado_por ? ' · ' + escHtml(a.conciliado_por) + (a.fecha_conciliacion ? ' · ' + escHtml(histFechaHora(a.fecha_conciliacion)) : '') : '') + '</span>' +
      '<span><strong>Creada:</strong> ' + escHtml(a.creado_por || '—') + (a.creado_en ? ' · ' + escHtml(histFechaHora(a.creado_en)) : '') + '</span>' +
      '<span><strong>Cabecera modificada:</strong> ' + (a.modificado_en ? escHtml(a.modificado_por || '—') + ' · ' + escHtml(histFechaHora(a.modificado_en)) : 'nunca') + '</span>' +
    '</div>';
    if (a.motivo_rechazo) resumen += '<div class="hist-nota" style="padding:0 20px 8px"><strong>Motivo del rechazo:</strong> ' + escHtml(a.motivo_rechazo) + '</div>';
  }

  var avisos = '';
  if (!reg.existe) {
    avisos += '<div class="hist-aviso hist-aviso-rojo">🗑️ Esta legalización ya no existe: se eliminó. Su historial se conserva en el registro de auditoría.</div>';
  }
  if (histData && cons && histData.consecutivo && cons !== histData.consecutivo && reg.existe) {
    avisos += '<div class="hist-aviso">↪️ Ese consecutivo se cambió: hoy esta legalización figura como <strong>' + escHtml(cons) + '</strong>.</div>';
  }
  if (reg.truncado) {
    avisos += '<div class="hist-aviso hist-aviso-rojo">⚠️ Hay más de 3000 eventos: se muestran solo los primeros 3000.</div>';
  }

  var lineaTiempo = bloques.length
    ? '<div class="hist-linea-tiempo">' + bloques.map(histBloqueHtml).join('') + '</div>'
    : '<div class="empty">Sin eventos en el registro de auditoría.</div>';

  return '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-head"><h3>' + escHtml(cons) + (meta ? ' <span style="font-weight:400;color:#718096">· ' + escHtml(meta) + '</span>' : '') + '</h3>' +
      '<span style="font-size:0.78rem;color:#718096">' + bloquesLeg.length + (bloquesLeg.length === 1 ? ' guardado' : ' guardados') + ' · ' + eventos.length + ' eventos' +
        (bloquesRem.length ? ' · ' + bloquesRem.length + (bloquesRem.length === 1 ? ' guardado' : ' guardados') + ' de remisiones externas' : '') + '</span></div>' +
    resumen + avisos + lineaTiempo +
  '</div>';
}

function renderHistorialTab() {
  var box = document.getElementById('hist-body');
  if (!box) return;
  if (!histData) { box.innerHTML = ''; return; }
  var regs = histData.registros || [];
  if (!regs.length) {
    box.innerHTML = '<div class="empty">No hay ninguna legalización ni rastro en la auditoría con el consecutivo <strong>' + escHtml(histData.consecutivo) + '</strong>.</div>';
    return;
  }
  box.innerHTML =
    '<div class="gpp-note" style="margin:0 0 12px">Consultado: ' + escHtml(histFechaHora(histData.generado)) + ' · hora de Colombia. ' +
    'Un «guardado» agrupa lo que una persona grabó en pocos segundos. Al guardar, el panel borra y vuelve a crear las líneas de gasto y el reparto; las que quedan iguales se marcan «sin cambios». ' +
    'Los bloques 📦 morados son cambios de las remisiones externas (MP-…) que la legalización lleva o llevó en «Remisiones relacionadas»: su planta y sus líneas alimentan el reparto, así que corregirlas explica muchos re-guardados.</div>' +
    regs.map(histRegistroHtml).join('');
}

// Un renglón por evento del registro de auditoría, tal como quedó.
function exportarHistorialExcel() {
  if (!histData || !(histData.registros || []).length) { showToast('No hay historial para exportar', '#e74c3c'); return; }
  var data = [];
  histData.registros.forEach(function(reg) {
    var cons = histConsecutivoDe(reg);
    // Eventos de la legalización y, si se están viendo, los de sus remisiones externas.
    var filas = (reg.eventos || []).map(function(e) { return { e: e, rem: '' }; });
    if (histVerRemisiones()) {
      (reg.remisiones || []).forEach(function(m) {
        (m.eventos || []).forEach(function(e) { filas.push({ e: e, rem: m.remision || '' }); });
      });
    }
    filas.sort(function(a, b) { return (new Date(a.e.cuando) - new Date(b.e.cuando)) || (a.e.audit_id - b.e.audit_id); });
    filas.forEach(function(f) {
      var e = f.e;
      data.push({
        'Consecutivo': cons,
        'Remisión externa': f.rem,
        'Fecha y hora': histFechaHora(e.cuando),
        'Usuario': e.usuario || 'Sistema',
        'Correo': e.email || '',
        'Qué': HIST_TABLAS[e.tabla] || e.tabla,
        'Acción': HIST_ACCIONES[e.accion] || e.accion,
        'Fila': e.registro_id,
        'Detalle': histDetalleEvento(e),
        'N.º auditoría': e.audit_id
      });
    });
  });
  if (!data.length) { showToast('No hay eventos para exportar', '#e74c3c'); return; }
  var ws = XLSX.utils.json_to_sheet(data);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');
  XLSX.writeFile(wb, 'historial_' + histData.consecutivo + '_' + today() + '.xlsx');
}

// ══════════════════════════════════════════════════════════════
// Cambios desde una fecha
// ──────────────────────────────────────────────────────────────
// Todas las legalizaciones/envíos que se crearon, cambiaron o eliminaron entre dos
// momentos (get_cambios_legalizacion_gastos). Sirve para explicar por qué el
// Prorrateo de un mes cerrado ya no da lo mismo que cuando se calculó: cada una se
// marca con lo que cambió y si puede mover el Prorrateo (nueva, eliminada, fecha /
// tipo / remisiones de la cabecera, gastos, reparto o una remisión externa). Lo que
// solo cambia datos como el responsable, la placa o las observaciones queda aparte.
// El servidor entrega el historial completo de cada una y aquí se recorta a la
// ventana: lo anterior hace falta para nombrar líneas y empresas en un UPDATE.
// ══════════════════════════════════════════════════════════════

var camData = null;  // respuesta de get_cambios_legalizacion_gastos
var camDesdeMs = 0;  // ventana consultada (ms)
var camHastaMs = 0;

// Campos de la cabecera que cambian a qué mes, tipo o remisiones se asigna el gasto.
var CAM_CLAVES_CABECERA = ['Fecha', 'Tipo', 'Remisiones_Relacionadas'];
var CAM_AREAS = {
  nueva:     { txt: '✨ Nueva',                     plano: 'Nueva' },
  eliminada: { txt: '🗑️ Eliminada',                 plano: 'Eliminada' },
  cabecera:  { txt: 'Fecha / tipo / remisiones',    plano: 'Fecha / tipo / remisiones' },
  gastos:    { txt: 'Gastos',                       plano: 'Gastos' },
  reparto:   { txt: 'Reparto',                      plano: 'Reparto' },
  remision:  { txt: '📦 Remisión externa',          plano: 'Remisión externa' },
  otros:     { txt: 'Otros datos (no mueven el Prorrateo)', plano: 'Otros datos' }
};
var CAM_ORDEN = ['nueva', 'eliminada', 'cabecera', 'gastos', 'reparto', 'remision', 'otros'];
var CAM_IMPACTO = ['nueva', 'eliminada', 'cabecera', 'gastos', 'reparto', 'remision'];

function cambiarModoHistorial() {
  var cambios = document.getElementById('hm-modo').value === 'cambios';
  document.getElementById('hm-cons').style.display = cambios ? 'none' : '';
  document.getElementById('hm-cambios').style.display = cambios ? '' : 'none';
  if (cambios) camPrepararFiltros();
}

function camPad(n) { return String(n).padStart(2, '0'); }
function camFechaLocal(d) { return d.getFullYear() + '-' + camPad(d.getMonth() + 1) + '-' + camPad(d.getDate()); }

// Primera vez: «desde» = el 1.º del mes en curso (lo que pasó tras el cierre) y las
// legalizaciones del mes anterior, que es lo habitual al revisar un corte.
function camPrepararFiltros() {
  var d = document.getElementById('cm-desde');
  if (!d || d.value) return;
  var hoy = new Date();
  d.value = camFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)) + 'T00:00';
  document.getElementById('cm-fdesde').value = camFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
  document.getElementById('cm-fhasta').value = camFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 0));
}

// Lo que se escribe en «Cambios desde» es hora de Colombia (sin horario de verano).
function camIsoBogota(v) {
  v = String(v || '').trim();
  if (!v) return null;
  if (v.length === 16) v += ':00';
  return v + '-05:00';
}

function camVerRem() { var c = document.getElementById('cm-rem'); return !c || c.checked; }
function camSoloImpacto() { var c = document.getElementById('cm-solo'); return !c || c.checked; }

async function cargarCambios() {
  var desde = camIsoBogota(document.getElementById('cm-desde').value);
  if (!desde) { showToast('Indica desde qué fecha y hora buscar los cambios', '#e67e22'); return; }
  var hasta = camIsoBogota(document.getElementById('cm-hasta').value);
  var fd = document.getElementById('cm-fdesde').value || null;
  var fh = document.getElementById('cm-fhasta').value || null;
  if (hasta && new Date(hasta) < new Date(desde)) { showToast('El «hasta» es anterior al «desde»', '#e67e22'); return; }
  if (fd && fh && fd > fh) { showToast('La fecha de legalización «desde» es posterior a «hasta»', '#e67e22'); return; }

  var box = document.getElementById('cam-body');
  box.innerHTML = '<div class="empty">Buscando cambios…</div>';
  var res = await apiGet('getCambiosLegalizacion', { desde: desde, hasta: hasta, fechaDesde: fd, fechaHasta: fh });
  if (!res.ok) {
    camData = null;
    box.innerHTML = '<div class="empty" style="color:#c0392b">' + escHtml(res.error || 'No se pudieron cargar los cambios.') + '</div>';
    return;
  }
  camData = res.cambios;
  camDesdeMs = new Date(camData.desde).getTime();
  camHastaMs = new Date(camData.hasta).getTime();
  renderCambios();
}

function camEnVentana(bloque) {
  var t = new Date(bloque.inicio).getTime();
  return t >= camDesdeMs && t <= camHastaMs;
}

// Fecha y tipo de una legalización (si ya no existe, lo último que dejó el audit_log).
function camDatosLeg(reg) {
  if (reg.actual) return { fecha: reg.actual.fecha, tipo: reg.actual.tipo };
  var d = {};
  (reg.eventos || []).forEach(function(e) {
    if (e.tabla === 'LegalizacionGastos') Object.assign(d, e.antes || {}, e.despues || {});
  });
  return { fecha: d.Fecha, tipo: d.Tipo };
}

// Qué tocó un guardado: { nueva, eliminada, cabecera, gastos, reparto, remision, otros }.
function camFlagsBloque(b, d) {
  var f = {};
  if (b.rem) {
    if (d.tipo !== 'modificacion' || d.lineas.some(function(l) { return l.signo !== '·'; }) || d.cabecera.length) f.remision = true;
    return f;
  }
  if (d.tipo === 'creacion') { f.nueva = true; return f; }
  if (d.tipo === 'eliminacion') { f.eliminada = true; return f; }
  b.eventos.forEach(function(e) {
    if (e.tabla !== 'LegalizacionGastos' || e.accion !== 'UPDATE') return;
    Object.keys(e.despues || {}).forEach(function(k) {
      var antes = (e.antes || {})[k];
      if (CAM_CLAVES_CABECERA.indexOf(k) >= 0) f.cabecera = true;
      // Pasar a/desde «Rechazada» saca o mete la legalización del Prorrateo.
      else if (k === 'Estado_Conciliacion' && (e.despues[k] === 'Rechazada' || antes === 'Rechazada')) f.cabecera = true;
      else f.otros = true;
    });
  });
  if (d.gastos.some(function(l) { return l.signo !== '·'; })) f.gastos = true;
  if (d.reparto.some(function(l) { return l.signo !== '·'; })) f.reparto = true;
  return f;
}

// Guardados de una legalización (y de sus remisiones externas) dentro de la ventana.
function camAnalizar(reg, verRem) {
  var eventos = reg.eventos || [];
  histAnotarPrevios(eventos);
  var bloques = histAgrupar(eventos).filter(camEnVentana);
  if (verRem) {
    (reg.remisiones || []).forEach(function(m) {
      var evs = m.eventos || [];
      histAnotarPrevios(evs);
      histAgrupar(evs).filter(camEnVentana).forEach(function(b) { b.rem = m; bloques.push(b); });
    });
  }
  bloques.forEach(function(b, i) { b._i = i; });
  bloques.sort(function(a, b) { return (new Date(a.inicio) - new Date(b.inicio)) || (a._i - b._i); });
  var flags = {};
  bloques.forEach(function(b) {
    b._d = b.rem ? histDescribirBloqueRem(b) : histDescribirBloque(b);
    b._f = camFlagsBloque(b, b._d);
    Object.keys(b._f).forEach(function(k) { flags[k] = true; });
  });
  var ultimo = bloques.length ? bloques[bloques.length - 1] : null;
  return {
    reg: reg,
    cons: reg.consecutivo || ('#' + reg.id),
    bloques: bloques,
    flags: flags,
    impacto: CAM_IMPACTO.some(function(k) { return flags[k]; }),
    ultimoBloque: ultimo,
    ultimo: ultimo ? new Date(ultimo.inicio).getTime() : 0
  };
}

function camAnalizarTodas() {
  var verRem = camVerRem();
  var todas = ((camData && camData.registros) || []).map(function(r) { return camAnalizar(r, verRem); })
    .filter(function(a) { return a.bloques.length; });
  todas.sort(function(a, b) { return b.ultimo - a.ultimo; });
  return todas;
}

function camLegHtml(a) {
  var datos = camDatosLeg(a.reg);
  var tipoTxt = datos.tipo ? (typeof tipoLabel === 'function' ? tipoLabel({ Tipo: datos.tipo }) : datos.tipo) : '';
  var chips = CAM_ORDEN.filter(function(k) { return a.flags[k]; }).map(function(k) {
    return '<span class="cam-chip cam-' + k + '">' + escHtml(CAM_AREAS[k].txt) + '</span>';
  }).join(' ');
  var nLeg = a.bloques.filter(function(b) { return !b.rem; }).length;
  var nRem = a.bloques.length - nLeg;
  var ult = a.ultimoBloque;
  return '<details class="cam-leg">' +
    '<summary><strong>' + escHtml(a.cons) + '</strong>' +
      '<span>' + escHtml([datos.fecha ? fmtDate(datos.fecha) : '', tipoTxt].filter(Boolean).join(' · ')) + '</span>' +
      '<span>' + chips + '</span>' +
      '<span class="hist-nota">Último cambio: ' + escHtml(histFechaHora(ult.inicio)) + ' · ' + escHtml(ult.usuario || 'Sistema') + '</span>' +
      '<span class="hist-nota">' + nLeg + (nLeg === 1 ? ' guardado' : ' guardados') + (nRem ? ' · ' + nRem + ' de remisiones externas' : '') + '</span>' +
    '</summary>' +
    '<div class="hist-linea-tiempo">' + a.bloques.map(histBloqueHtml).join('') + '</div>' +
    '<div style="padding:0 14px 12px"><button class="btn-edit" onclick="histIrAConsecutivo(\'' + escHtml(a.cons) + '\')">🕑 Ver historial completo</button></div>' +
  '</details>';
}

function renderCambios() {
  var box = document.getElementById('cam-body');
  if (!box) return;
  if (!camData) { box.innerHTML = ''; return; }
  var todas = camAnalizarTodas();
  var visibles = camSoloImpacto() ? todas.filter(function(a) { return a.impacto; }) : todas;
  var ocultas = todas.length - visibles.length;
  function cuenta(k) { return todas.filter(function(a) { return a.flags[k]; }).length; }

  var rango = histFechaHora(camData.desde) + ' y ' + histFechaHora(camData.hasta);
  var filtroFecha = (camData.fecha_desde || camData.fecha_hasta)
    ? ' · legalizaciones con fecha ' + (camData.fecha_desde ? 'desde ' + fmtDate(camData.fecha_desde) : '') + (camData.fecha_desde && camData.fecha_hasta ? ' ' : '') + (camData.fecha_hasta ? 'hasta ' + fmtDate(camData.fecha_hasta) : '')
    : '';

  var html = '<div class="gpp-note" style="margin:0 0 12px">Cambios entre <strong>' + escHtml(rango) + '</strong> (hora de Colombia)' + escHtml(filtroFecha) + '. ' +
    'Cubre las legalizaciones y envíos, sus líneas de gasto y su reparto, y las remisiones externas (MP-…, Chia Abago) que llevan hoy. ' +
    '<strong>No</strong> cubre los cambios en Pedidos, Ingresos, Devoluciones, Cambios de mercancía ni Muestras (de ahí salen los productos de cada remisión), ' +
    'ni los cambios en la fórmula del Prorrateo: esos también mueven el resultado sin que aparezca aquí ninguna legalización.</div>';

  if (camData.omitidas_visibilidad > 0) {
    html += '<div class="hist-aviso" style="margin:0 0 12px">🔒 ' + camData.omitidas_visibilidad + (camData.omitidas_visibilidad === 1 ? ' legalización de empresas' : ' legalizaciones de empresas') + ' a las que no tienes acceso no se muestran.</div>';
  }
  if (camData.omitidas_tope > 0) {
    html += '<div class="hist-aviso hist-aviso-rojo" style="margin:0 0 12px">⚠️ Hay demasiados eventos: ' + camData.omitidas_tope + (camData.omitidas_tope === 1 ? ' legalización quedó fuera' : ' legalizaciones quedaron fuera') + '. Acorta el periodo o el rango de fechas.</div>';
  }

  html += '<div class="cam-resumen">' +
    '<span><strong>' + todas.length + '</strong> con actividad</span>' +
    '<span>✨ <strong>' + cuenta('nueva') + '</strong> nuevas</span>' +
    '<span>🗑️ <strong>' + cuenta('eliminada') + '</strong> eliminadas</span>' +
    '<span><strong>' + cuenta('cabecera') + '</strong> con fecha / tipo / remisiones</span>' +
    '<span><strong>' + cuenta('gastos') + '</strong> con gastos</span>' +
    '<span><strong>' + cuenta('reparto') + '</strong> con reparto</span>' +
    '<span>📦 <strong>' + cuenta('remision') + '</strong> con remisión externa</span>' +
    (ocultas ? '<span class="hist-nota">' + ocultas + (ocultas === 1 ? ' solo con cambios que no mueven el Prorrateo (oculta)' : ' solo con cambios que no mueven el Prorrateo (ocultas)') + '</span>' : '') +
  '</div>';

  if (!visibles.length) {
    html += '<div class="empty">' + (todas.length
      ? 'Todo lo que cambió en ese periodo son datos que no mueven el Prorrateo (responsable, placa, observaciones…). Desmarca «Solo lo que puede mover el Prorrateo» para verlo.'
      : 'Ninguna legalización de ese rango de fechas tuvo cambios en ese periodo.') + '</div>';
  } else {
    html += visibles.map(camLegHtml).join('');
  }
  box.innerHTML = html;
}

function camAbrirTodas(abrir) {
  document.querySelectorAll('#cam-body details.cam-leg').forEach(function(d) { d.open = abrir; });
}

// Texto plano de un fragmento de HTML (los renglones del historial vienen con marcas).
function camTexto(html) {
  var el = document.createElement('div');
  // Las «chips» de un alta son spans seguidos: sin separador quedarían pegadas.
  el.innerHTML = String(html).replace(/<\/span>(\s*)<span class="hist-chip">/g, '</span>; <span class="hist-chip">');
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function camTextoBloque(b) {
  var d = b._d;
  var partes = [];
  function sec(titulo, lineas) {
    if (!lineas || !lineas.length) return;
    partes.push(titulo + ': ' + lineas.map(function(l) {
      return (l.signo && l.signo !== '·' ? l.signo + ' ' : '') + camTexto(l.html);
    }).join(' | '));
  }
  if (b.rem) { sec('Remisión externa', d.cabecera); sec('Líneas de la remisión', d.lineas); }
  else { sec('Cabecera', d.cabecera); sec('Líneas de gasto', d.gastos); sec('Reparto', d.reparto); }
  return partes.join(' ‖ ');
}

// Un renglón por guardado dentro del periodo, con lo mismo que se ve en pantalla.
function exportarCambiosExcel() {
  if (!camData) { showToast('Primero busca los cambios', '#e74c3c'); return; }
  var solo = camSoloImpacto();
  var data = [];
  camAnalizarTodas().filter(function(a) { return !solo || a.impacto; }).forEach(function(a) {
    var datos = camDatosLeg(a.reg);
    var tipoTxt = datos.tipo ? (typeof tipoLabel === 'function' ? tipoLabel({ Tipo: datos.tipo }) : datos.tipo) : '';
    a.bloques.forEach(function(b) {
      data.push({
        'Consecutivo': a.cons,
        'Fecha de la legalización': datos.fecha ? fmtDate(datos.fecha) : '',
        'Tipo': tipoTxt,
        'Fecha y hora': histFechaHora(b.inicio),
        'Usuario': b.usuario || 'Sistema',
        'Correo': b.email || '',
        'Qué': HIST_TIPOS[b._d.tipo].titulo,
        'Remisión externa': b.rem ? (b.rem.remision || '') : '',
        'Puede mover el Prorrateo': CAM_IMPACTO.some(function(k) { return b._f[k]; }) ? 'Sí' : 'No',
        'Áreas': CAM_ORDEN.filter(function(k) { return b._f[k]; }).map(function(k) { return CAM_AREAS[k].plano; }).join(', '),
        'Detalle': camTextoBloque(b)
      });
    });
  });
  if (!data.length) { showToast('No hay cambios para exportar', '#e74c3c'); return; }
  var ws = XLSX.utils.json_to_sheet(data);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cambios');
  XLSX.writeFile(wb, 'cambios_legalizaciones_desde_' + String(document.getElementById('cm-desde').value).slice(0, 10) + '.xlsx');
}
