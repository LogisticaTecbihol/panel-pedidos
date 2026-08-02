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
  var copias = ['ORIGINAL - LOGISTICA', 'COPIA - CONTABILIDAD', 'CLIENTE', 'COPIA - LOGISTICA'];
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
  var fileName = 'Remision_' + sigla + '_' + (data.consecutivo || '') + (data.remision ? '_' + String(data.remision) : '') + '.pdf';
  doc.save(fileName);
}

function _drawRemisionCopy(doc, data, palette) {
  var pw = doc.internal.pageSize.getWidth();
  var ph = doc.internal.pageSize.getHeight();
  var accent = palette.accent;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];

  var headerInfo = _pdfRemisionHeaderInfoFor(data.empresa);
  var headerH = headerInfo ? 48 : 30;
  var refLabel = data.ref_label || 'Pedido';
  var logo = _pdfHeaderLogoFor(data.empresa);

  var left = data.left_fields || [
    ['Cliente', data.cliente || ''],
    ['NIT', data.nit || ''],
    ['Telefono', data.telefono || ''],
    ['Municipio', data.municipio || ''],
    ['Departamento', data.departamento || ''],
  ];
  var right = data.right_fields || [
    ['Comercial', data.comercial || ''],
    ['Direccion', data.direccion || ''],
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
    doc.text('REMISION' + (data.remision ? '  N° ' + String(data.remision) : ''), titleX, 13);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(darkText[0], darkText[1], darkText[2]);
    doc.text(String(data.empresa || ''), titleX, 21);
    doc.setFontSize(9);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.setFont(undefined, 'bold');
    doc.text(refLabel + ' #' + String(data.consecutivo || ''), pw - 14, 13, { align: 'right' });
    doc.text('Fecha remision: ' + String(data.fecha_entrega || ''), pw - 14, 21, { align: 'right' });
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
    var rowGap = 9;
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
        rowH = Math.max(rowH, (lLines.length - 1) * 4);
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
        rowH = Math.max(rowH, (rLines.length - 1) * 4);
      }
      y += rowGap + rowH;
      if (fi < maxF - 1) {
        doc.setDrawColor(200, 210, 220);
        doc.setLineWidth(0.2);
        doc.line(14, y - 4, pw - 14, y - 4);
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
    if (!presName.trim()) {
      var m = prodName.match(/^(.*?)\s+[xX]\s+(.+)$/);
      if (m) {
        prodName = m[1].trim();
        presName = m[2].trim();
      }
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
    head: [['#', 'Producto', 'Presentacion', 'Cant. Entregada', 'Bonif.']],
    body: tableBody,
    theme: 'grid',
    headStyles: { fillColor: accent, fontSize: 8, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35 },
    bodyStyles: { fontSize: 8, lineColor: [90, 90, 90], lineWidth: 0.3 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 82 },
      2: { cellWidth: 40 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'center', cellWidth: 18 }
    },
    margin: { top: pageTopY, left: 14, right: 14, bottom: 15 },
    styles: { cellPadding: 3, lineColor: [90, 90, 90], lineWidth: 0.3 },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.5,
    didDrawPage: function(hookData) {
      if (hookData.pageNumber > 1) drawPageTop();
    }
  });

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
