// ── PDF de Remisión (compartido: pedidos, muestras, etc.) ──
// Depende de: window.jspdf (jsPDF + autoTable) y getSigla() de shared.js.

var _pdfLogos = { PARCELAR: null, IASO: null, RESO: null, GREEN: null, IAS: null };
(function _preloadPdfLogos() {
  if (typeof document === 'undefined') return;
  var sources = { PARCELAR: 'assets/logo_parcelar.png', IASO: 'assets/logo_iaso.png', RESO: 'assets/logo_reso.png', GREEN: 'assets/logo_green.png', IAS: 'assets/logo_ias.png' };
  Object.keys(sources).forEach(function(key) {
    var img = new Image();
    img.onload = function() {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        _pdfLogos[key] = { data: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
      } catch (e) { _pdfLogos[key] = null; }
    };
    img.onerror = function() { _pdfLogos[key] = null; };
    img.src = sources[key];
  });
})();

function _pdfHeaderLogoFor(empresa) {
  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  return _pdfLogos[String(sigla).toUpperCase()] || null;
}

var _pdfRemisionHeaderInfo = {
  IASO: [
    'INSUMOS AGROPECUARIOS SOSTENIBLES S.A.S',
    'NIT: 901-924.101-1',
    'Av. Troncal de Occidente #11E-03E, Mosquera,',
    'Cundinamarca - Parque Agroindustrial de la Sabana',
    'Cel 3106716741  ·  Correo: inagrosostenible.sas@gmail.com'
  ],
  PARCELAR: [
    'PARCELAR DE COLOMBIA S.A.S',
    'NIT: 900-156.484-6',
    'Av. Troncal de Occidente #11E-03E, Mosquera,',
    'Cundinamarca - Parque Agroindustrial de la Sabana',
    'Bod 76  ·  Cel: 313 462 9468'
  ],
  GREEN: [
    'GREEN AGRO SOLUCIONES DE COLOMBIA S.A.S',
    'NIT: 900-511.092-5',
    'Av. Troncal de Occidente #11E-03E, Mosquera,',
    'Cundinamarca - Parque Agroindustrial de la Sabana',
    'Bod 1274  ·  Cel: 3001264572'
  ],
  IAS: [
    'INSUMOS AGROPECUARIOS DE LA SABANA S.A.S',
    'NIT: 900.447.393-3',
    'Av. Troncal Occidente #11E-03E, Mosquera, Cundinamarca',
    'Parque Agroindustrial de la Sabana - Administracion Of. 3',
    'Cel: 310 6716741  ·  Correo: inagrosabana22@gmail.com'
  ]
};

function _pdfRemisionHeaderInfoFor(empresa) {
  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  return _pdfRemisionHeaderInfo[String(sigla).toUpperCase()] || null;
}

function _pdfPaletteFor(empresa) {
  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  sigla = String(sigla).toUpperCase();
  if (sigla === 'PARCELAR') return { accent: [30, 107, 63], light: [220, 235, 225] };
  if (sigla === 'RESO')     return { accent: [26, 55, 100],  light: [219, 229, 245] };
  return { accent: [39, 174, 96], light: [212, 239, 223] };
}

function _drawRemisionCopyFooter(doc, label, palette, pageIdx, pageCount, genStamp) {
  var pw = doc.internal.pageSize.getWidth();
  var ph = doc.internal.pageSize.getHeight();
  var accent = palette.accent;
  var grayText = [113, 128, 150];

  if (genStamp) {
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('Generado: ' + genStamp, 14, ph - 5);
  }

  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(String(label), pw / 2, ph - 5, { align: 'center' });

  if (pageIdx && pageCount) {
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('Pagina ' + pageIdx + ' de ' + pageCount, pw - 14, ph - 5, { align: 'right' });
  }
}

function generarRemisionPDF(data) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF();
  var palette = _pdfPaletteFor(data.empresa);
  var copias = data.copies || ['ORIGINAL - LOGISTICA', 'COPIA - CONTABILIDAD', 'CLIENTE', 'COPIA - LOGISTICA'];
  if (!copias.length) copias = [''];
  var genStamp = new Date().toLocaleString('es-CO');
  copias.forEach(function(label, idx) {
    if (idx > 0) doc.addPage();
    var startPage = doc.internal.getNumberOfPages();
    _drawRemisionCopy(doc, data, palette);
    var endPage = doc.internal.getNumberOfPages();
    var total = endPage - startPage + 1;
    for (var p = startPage; p <= endPage; p++) {
      doc.setPage(p);
      _drawRemisionCopyFooter(doc, label, palette, p - startPage + 1, total, genStamp);
    }
  });
  var sigla = (typeof getSigla === 'function' ? getSigla(data.empresa) : '') || 'Remision';
  var filePrefix = data.file_prefix || 'Remision';
  var fileName = filePrefix + '_' + sigla + '_' + (data.consecutivo || '') + (data.remision ? '_' + String(data.remision) : '') + '.pdf';
  if (data.return_doc) return { doc: doc, filename: fileName };
  doc.save(fileName);
}

// Abre el modal de NOTIF para enviar una remisión a otros usuarios sin
// descargarla localmente. Reutiliza los mismos parámetros de generarRemisionPDF.
function enviarRemisionPDF(data, meta) {
  if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
    if (typeof showToast === 'function') showToast('Módulo de notificaciones no cargado.', '#e74c3c');
    return;
  }
  NOTIF.openModalEnviar({
    modulo: meta.modulo,
    referencia: meta.referencia,
    titulo: meta.titulo,
    buildDoc: function() {
      var r = generarRemisionPDF(Object.assign({}, data, { return_doc: true }));
      return r ? r.doc : null;
    }
  });
}

function _drawRemisionCopy(doc, data, palette) {
  var pw = doc.internal.pageSize.getWidth();
  var ph = doc.internal.pageSize.getHeight();
  var accent = palette.accent;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];

  var headerInfo = _pdfRemisionHeaderInfoFor(data.empresa);
  var headerH = headerInfo ? 48 : 30;
  var refLabel = (data.ref_label != null) ? data.ref_label : 'Pedido';
  var docTitle = data.doc_title || 'REMISION';
  var docNumber = (data.doc_number != null && data.doc_number !== '') ? String(data.doc_number) : (data.remision ? String(data.remision) : '');
  var dateLabel = data.date_label || 'Fecha remision';
  var logo = _pdfHeaderLogoFor(data.empresa);

  var left = data.left_fields || [
    ['Cliente', data.cliente || ''],
    ['NIT', data.nit || ''],
    ['Comercial', data.comercial || ''],
    ['Telefono', data.telefono || ''],
  ];
  var right = data.right_fields || [
    ['Direccion', data.direccion || ''],
    ['Municipio', data.municipio || ''],
    ['Departamento', data.departamento || ''],
  ];

  function drawPageTop() {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pw, headerH, 'F');
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(1.2);
    doc.line(0, headerH, pw, headerH);

    var titleX = 14;
    if (logo) {
      try {
        doc.addImage(logo.data, 'PNG', 5, 4, 22, 22);
        titleX = 34;
      } catch (e) {}
    }

    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(docTitle + (docNumber ? '  N° ' + docNumber : ''), titleX, 13);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    doc.text(String(data.empresa || ''), titleX, 21);
    doc.setFontSize(9);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.setFont(undefined, 'bold');
    if (refLabel && data.consecutivo) {
      doc.text(refLabel + ' #' + String(data.consecutivo), pw - 14, 13, { align: 'right' });
    }
    if (data.fecha_entrega) {
      doc.text(dateLabel + ': ' + String(data.fecha_entrega), pw - 14, 21, { align: 'right' });
    }
    doc.setFont(undefined, 'normal');

    if (headerInfo) {
      doc.setFontSize(7);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(120, 132, 150);
      var infoStartY = 30;
      var infoLineH = 3.4;
      headerInfo.forEach(function(line, i) {
        var bold = i === 0;
        if (bold) doc.setFont(undefined, 'bold');
        doc.text(String(line), pw - 14, infoStartY + i * infoLineH, { align: 'right' });
        if (bold) doc.setFont(undefined, 'normal');
      });
    }

    var y = headerH + 10;
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    doc.setFontSize(9);

    var totalW = pw - 28;
    var leftBlockW = totalW * 0.58;
    var leftValX = 14 + 34;
    var rightLabelX = 14 + leftBlockW + 4;
    var rightValX = rightLabelX + 34;
    var leftValMaxW = (14 + leftBlockW) - leftValX - 4;
    var rightValMaxW = pw - 14 - rightValX;
    var maxF = Math.max(left.length, right.length);
    var infoTop = y - 5;
    var midX = 14 + leftBlockW;
    var rowGap = 6;
    for (var fi = 0; fi < maxF; fi++) {
      var rowH = 0;
      if (fi < left.length) {
        doc.setFont(undefined, 'bold');
        doc.setTextColor(accent[0], accent[1], accent[2]);
        doc.text(left[fi][0] + ':', 16, y);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(darkText[0], darkText[1], darkText[2]);
        var lVal = String(left[fi][1] || '');
        var lLines = lVal ? doc.splitTextToSize(lVal, leftValMaxW) : [''];
        doc.text(lLines, leftValX, y);
        rowH = Math.max(rowH, (lLines.length - 1) * 3.5);
      }
      if (fi < right.length) {
        doc.setFont(undefined, 'bold');
        doc.setTextColor(accent[0], accent[1], accent[2]);
        doc.text(right[fi][0] + ':', rightLabelX + 2, y);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(darkText[0], darkText[1], darkText[2]);
        var rVal = String(right[fi][1] || '');
        var rLines = rVal ? doc.splitTextToSize(rVal, rightValMaxW) : [''];
        doc.text(rLines, rightValX, y);
        rowH = Math.max(rowH, (rLines.length - 1) * 3.5);
      }
      y += rowGap + rowH;
      if (fi < maxF - 1) {
        doc.setDrawColor(200, 210, 220);
        doc.setLineWidth(0.2);
        doc.line(14, y - 3, pw - 14, y - 3);
      }
    }
    var infoBottom = y - 4;
    doc.setDrawColor(140, 155, 175);
    doc.setLineWidth(0.4);
    doc.rect(14, infoTop, pw - 28, infoBottom - infoTop);
    doc.setLineWidth(0.2);
    doc.setDrawColor(200, 210, 220);
    doc.line(midX, infoTop, midX, infoBottom);

    y += 6;
    return y;
  }

  var pageTopY = drawPageTop();

  var tableBody = (data.entregas || []).map(function(p, i) {
    var vUnit = Number(p.valor_unitario) || 0;
    var textoTieneBonif = /bonificado/i.test(String(p.producto || ''));
    var esBonif = (p.bonificado || '') === 'Si' || (p.bonificado || '') === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
    var prodName = String(p.producto || '');
    var presName = String(p.presentacion || '');
    var m = prodName.match(/^(.*?)\s+[xX]\s+(.+)$/);
    if (m) {
      prodName = m[1].trim();
      presName = m[2].trim();
    }
    return [
      i + 1,
      prodName,
      presName,
      Number(p.cantidad) || 0,
      esBonif ? 'Sí' : 'No'
    ];
  });

  doc.autoTable({
    startY: pageTopY,
    head: [['#', 'Producto', 'Presentacion', data.qty_header || 'Cant. Entregada', 'Bonif.']],
    body: tableBody,
    theme: 'grid',
    headStyles: { fillColor: accent, fontSize: 7.5, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35, cellPadding: 1.5 },
    bodyStyles: { fontSize: 7.5, lineColor: [90, 90, 90], lineWidth: 0.3 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 82 },
      2: { halign: 'center', cellWidth: 40 },
      3: { halign: 'center', cellWidth: 32 },
      4: { halign: 'center', cellWidth: 18 }
    },
    margin: { top: pageTopY, left: 14, right: 14, bottom: 15 },
    styles: { cellPadding: 1.5, lineColor: [90, 90, 90], lineWidth: 0.3 },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.5,
    didDrawPage: function(hookData) {
      if (hookData.pageNumber > 1) drawPageTop();
    }
  });

  if (data.hide_signatures) return;

  var finalY = doc.lastAutoTable.finalY + 10;
  var sigTop = finalY + 22;
  var minSigTop = ph - 60;
  if (sigTop < minSigTop) sigTop = minSigTop;
  if (sigTop > ph - 42) {
    doc.addPage();
    var newTop = drawPageTop();
    sigTop = Math.max(newTop + 8, ph - 60);
  }

  var sigGap = 5;
  var sigCount = 4;
  var sigW = (pw - 28 - sigGap * (sigCount - 1)) / sigCount;
  var lineY = sigTop + 18;
  var labelY = lineY + 5;
  var subY = labelY + 5;
  var cols = [
    { x: 14, label: 'Emitido por', sub: 'Nombre y firma' },
    { x: 14 + (sigW + sigGap), label: 'Despachado / Conductor', sub: 'Nombre y firma' },
    { x: 14 + (sigW + sigGap) * 2, label: 'Contabilidad', sub: 'Nombre y firma' },
    { x: 14 + (sigW + sigGap) * 3, label: 'Recibido por el cliente', sub: 'Nombre, firma y fecha' }
  ];
  doc.setDrawColor(darkText[0], darkText[1], darkText[2]);
  doc.setLineWidth(0.3);
  doc.setFontSize(8);
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  cols.forEach(function(c) {
    doc.line(c.x, lineY, c.x + sigW, lineY);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(7.5);
    doc.text(c.label, c.x + sigW / 2, labelY, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text(c.sub, c.x + sigW / 2, subY, { align: 'center' });
    doc.setFontSize(8);
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  });
  var recCol = cols[cols.length - 1];
  var fechaRecY = subY + 6;
  var fechaLabelX = recCol.x + 2;
  var fechaLineX1 = fechaLabelX + 26;
  var fechaLineX2 = recCol.x + sigW - 2;
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.text('Fecha de entrega:', fechaLabelX, fechaRecY);
  doc.setDrawColor(160, 174, 192);
  doc.line(fechaLineX1, fechaRecY + 0.5, fechaLineX2, fechaRecY + 0.5);
}

// ═══════════════════════════════════════════════════════════════
// PDFs para Órdenes de Compra (Solicitud + Remisiones Origen/Destino)
// ═══════════════════════════════════════════════════════════════
//
// Todos reciben un ARRAY de filas de OrdenesCompra que comparten
// (Consecutivo, Empresa_Destino, Empresa_Origen, Fecha, Ref_Pedido)
// — es decir, todos los productos de una misma solicitud/orden — y
// generan UN documento con la tabla de productos agrupada.
//
// Reutilizan _drawRemisionCopy/_drawRemisionCopyFooter para
// mantener el mismo estilo visual que las remisiones de pedidos.

function _ocFmtDate(v) {
  if (!v) return '';
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var parts = s.slice(0, 10).split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  return s;
}

// Construye la lista de "entregas" (productos) para las tablas
// PDF a partir del grupo de OCs. Cada fila = un producto.
function _ocProductosParaPDF(ocs) {
  return (ocs || []).filter(function(oc) { return oc; }).map(function(oc) {
    return {
      producto: oc.Producto || '',
      presentacion: oc.Presentacion || '',
      cantidad: Number(oc.Cantidad) || 0,
      valor_unitario: Number(oc.Valor_Unitario) || 0,
      valor_total: Number(oc.Valor_Total) || 0,
      bonificado: ''
    };
  });
}

// Solicitud de OC — documento tipo "orden de compra emitida".
// Header con Empresa Destino (quien solicita), listado de productos,
// info de origen/destino/fecha/ref pedido/estado. Sin firmas.
function generarSolicitudOCPDF(ocs) {
  if (!ocs || !ocs.length) return;
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF();
  var hdr = ocs[0];
  var palette = _pdfPaletteFor(hdr.Empresa_Destino);
  var siglaOrig = (typeof getSigla === 'function' ? getSigla(hdr.Empresa_Origen) : '') || hdr.Empresa_Origen || '';
  var siglaDest = (typeof getSigla === 'function' ? getSigla(hdr.Empresa_Destino) : '') || hdr.Empresa_Destino || '';
  var totalOrden = (ocs || []).reduce(function(s, r) { return s + (Number(r.Valor_Total) || 0); }, 0);
  var data = {
    empresa: hdr.Empresa_Destino,
    consecutivo: hdr.Consecutivo,
    fecha_entrega: _ocFmtDate(hdr.Fecha),
    doc_title: 'SOLICITUD DE OC',
    doc_number: hdr.Consecutivo,
    date_label: 'Fecha OC',
    ref_label: hdr.Ref_Pedido ? 'Pedido origen' : null,
    file_prefix: 'Solicitud_OC',
    copies: ['ORIGINAL - SOLICITUD DE OC'],
    hide_signatures: true,
    qty_header: 'Cantidad',
    entregas: _ocProductosParaPDF(ocs),
    left_fields: [
      ['Empresa Destino', siglaDest + (hdr.Empresa_Destino && siglaDest !== hdr.Empresa_Destino ? ' · ' + hdr.Empresa_Destino : '')],
      ['Empresa Origen', siglaOrig + (hdr.Empresa_Origen && siglaOrig !== hdr.Empresa_Origen ? ' · ' + hdr.Empresa_Origen : '')],
      ['Tipo', hdr.Tipo || 'Compra'],
      ['Ref. Pedido', hdr.Ref_Pedido || '—'],
    ],
    right_fields: [
      ['Fecha OC', _ocFmtDate(hdr.Fecha)],
      ['Municipio', hdr.Municipio || '—'],
      ['Bodega', hdr.Bodega || '—'],
      ['Estado', hdr.Estado || 'Abierta'],
      ['Total', totalOrden > 0 ? '$ ' + totalOrden.toLocaleString('es-CO') : '—'],
    ]
  };
  var genStamp = new Date().toLocaleString('es-CO');
  var startPage = doc.internal.getNumberOfPages();
  _drawRemisionCopy(doc, data, palette);
  var endPage = doc.internal.getNumberOfPages();
  var total = endPage - startPage + 1;
  for (var p = startPage; p <= endPage; p++) {
    doc.setPage(p);
    _drawRemisionCopyFooter(doc, 'SOLICITUD DE OC', palette, p - startPage + 1, total, genStamp);
  }
  var fname = 'Solicitud_OC_' + (siglaDest || 'DEST') + '_' + (siglaOrig || 'ORIG') + '_' + (hdr.Consecutivo || '') + '.pdf';
  if (data.return_doc) return { doc: doc, filename: fname };
  doc.save(fname);
}

// Extrae info conocida (NIT, dirección, municipio, departamento,
// teléfono) del banner _pdfRemisionHeaderInfo cuando la empresa
// está en el catálogo de holding. Devuelve strings vacíos si no
// se encuentra o si el patrón no matchea, no lanza.
function _ocEmpresaInfoParaCliente(empresa) {
  var sigla = (typeof getSigla === 'function' ? getSigla(empresa) : '') || '';
  var info = _pdfRemisionHeaderInfo[String(sigla).toUpperCase()];
  var out = { nombre: empresa || '', nit: '', direccion: '', municipio: '', departamento: '', telefono: '' };
  if (!info) return out;
  out.nombre = info[0] || out.nombre;
  var joined = info.join(' \n ');
  var mNit = joined.match(/NIT:\s*([0-9.\-\s]+)/i);
  if (mNit) out.nit = mNit[1].trim();
  var mTel = joined.match(/Cel[\s:]*([0-9\s]+)/i);
  if (mTel) out.telefono = mTel[1].trim();
  // Address lines: buscar líneas que arranquen con abreviatura vial
  // ("Av.", "Cra.", "Calle", "Cl.", "Cll.", "Kra.") y capturar
  // municipio si viene con coma. Formato típico:
  //   "Av. Troncal de Occidente #11E-03E, Mosquera,"
  //   "Cundinamarca - Parque Agroindustrial de la Sabana"
  var addrLines = info.filter(function(ln, i) {
    if (i === 0) return false;
    if (/^NIT/i.test(ln)) return false;
    if (/^(Cel|Correo|Bod)/i.test(ln)) return false;
    return true;
  });
  if (addrLines.length) out.direccion = addrLines[0].replace(/,\s*[A-Za-zÁ-ú]+,?\s*$/, '').trim();
  // Municipio: buscar palabra antes de la coma final en la primera
  // línea de dirección; departamento: primera palabra de la segunda.
  var mMun = (addrLines[0] || '').match(/,\s*([A-Za-zÁ-úñÑ]+)\s*,?\s*$/);
  if (mMun) out.municipio = mMun[1].trim();
  if (addrLines[1]) {
    var mDep = addrLines[1].match(/^([A-Za-zÁ-úñÑ]+)/);
    if (mDep) out.departamento = mDep[1].trim();
  }
  return out;
}

// Remisiones del traslado — PDF de 2 páginas usando el MISMO layout
// que la remisión de pedidos (Cliente/NIT/Comercial/Teléfono ↔
// Dirección/Municipio/Departamento). En ambas páginas:
//   • Header (empresa emisora)  = Empresa Origen (quien despacha)
//   • Cliente (destinatario)    = Empresa Destino (quien recibe)
//   • Sólo cambia el N° remisión:
//       - Página 1: Remision (número usado por Destino)
//       - Página 2: Remision_Origen (número usado por Origen)
// Si una de las remisiones aún no está cargada, esa página se omite.
// Si NINGUNA está cargada, avisa y no genera nada.
function generarRemisionesTrasladoPDF(ocs) {
  if (!ocs || !ocs.length) return;
  var hdr = ocs[0];
  var remDest = String(hdr.Remision || '').trim();
  var remOrig = String(hdr.Remision_Origen || '').trim();
  if (!remDest && !remOrig) {
    if (typeof showToast === 'function') {
      showToast('La OC no tiene remisiones cargadas todavía (ni Destino ni Origen).', '#e67e22');
    }
    return;
  }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF();
  var siglaOrig = (typeof getSigla === 'function' ? getSigla(hdr.Empresa_Origen) : '') || hdr.Empresa_Origen || '';
  var siglaDest = (typeof getSigla === 'function' ? getSigla(hdr.Empresa_Destino) : '') || hdr.Empresa_Destino || '';
  var entregas = _ocProductosParaPDF(ocs);
  var fechaFmt = _ocFmtDate(hdr.Fecha);
  var genStamp = new Date().toLocaleString('es-CO');

  // Empresa Origen emite ambos documentos (branding en header).
  // Empresa Destino actúa como Cliente.
  var palette = _pdfPaletteFor(hdr.Empresa_Origen);
  var infoCliente = _ocEmpresaInfoParaCliente(hdr.Empresa_Destino);
  var direccion = String(hdr.Direccion || '').trim() || infoCliente.direccion;
  var municipio = String(hdr.Municipio || '').trim() || infoCliente.municipio;

  // Fields alineados al layout del pedido — mismos labels y orden.
  function baseFields() {
    return {
      left_fields: [
        ['Cliente', infoCliente.nombre + (siglaDest && siglaDest !== infoCliente.nombre ? ' (' + siglaDest + ')' : '')],
        ['NIT', infoCliente.nit || '—'],
        ['Comercial', '—'],
        ['Telefono', infoCliente.telefono || '—'],
      ],
      right_fields: [
        ['Direccion', direccion || '—'],
        ['Municipio', municipio || '—'],
        ['Departamento', infoCliente.departamento || '—'],
      ]
    };
  }

  function drawSide(data, footerLabel) {
    var startPage = doc.internal.getNumberOfPages();
    _drawRemisionCopy(doc, data, palette);
    var endPage = doc.internal.getNumberOfPages();
    var total = endPage - startPage + 1;
    for (var p = startPage; p <= endPage; p++) {
      doc.setPage(p);
      _drawRemisionCopyFooter(doc, footerLabel, palette, p - startPage + 1, total, genStamp);
    }
  }

  var firstPageAdded = false;

  if (remDest) {
    var bf1 = baseFields();
    var dataDest = {
      empresa: hdr.Empresa_Origen,
      consecutivo: hdr.Consecutivo,
      remision: remDest,
      fecha_entrega: fechaFmt,
      doc_title: 'REMISION',
      doc_number: remDest,
      date_label: 'Fecha',
      ref_label: 'OC',
      qty_header: 'Cant. Entregada',
      entregas: entregas,
      cliente: infoCliente.nombre,
      nit: infoCliente.nit,
      telefono: infoCliente.telefono,
      direccion: direccion,
      municipio: municipio,
      departamento: infoCliente.departamento,
      left_fields: bf1.left_fields,
      right_fields: bf1.right_fields
    };
    drawSide(dataDest, 'COPIA DESTINO (' + (siglaDest || 'DEST') + ') - N° Rem ' + remDest);
    firstPageAdded = true;
  }

  if (remOrig) {
    if (firstPageAdded) doc.addPage();
    var bf2 = baseFields();
    var dataOrig = {
      empresa: hdr.Empresa_Origen,
      consecutivo: hdr.Consecutivo,
      remision: remOrig,
      fecha_entrega: fechaFmt,
      doc_title: 'REMISION',
      doc_number: remOrig,
      date_label: 'Fecha',
      ref_label: 'OC',
      qty_header: 'Cant. Entregada',
      entregas: entregas,
      cliente: infoCliente.nombre,
      nit: infoCliente.nit,
      telefono: infoCliente.telefono,
      direccion: direccion,
      municipio: municipio,
      departamento: infoCliente.departamento,
      left_fields: bf2.left_fields,
      right_fields: bf2.right_fields
    };
    drawSide(dataOrig, 'COPIA ORIGEN (' + (siglaOrig || 'ORIG') + ') - N° Rem ' + remOrig);
  }

  var fname = 'Remisiones_Traslado_' + (siglaDest || 'DEST') + '_' + (siglaOrig || 'ORIG') + '_' + (hdr.Consecutivo || '') + '.pdf';
  doc.save(fname);
}
