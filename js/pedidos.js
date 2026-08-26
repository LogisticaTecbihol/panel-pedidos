// ── Resolución de comercial (valor del campo → uuid) contra el directorio ──
// Se llama antes de cada agregar/editar Pedido para poblar comercial_id, que es
// el campo que usa la RLS.
//
// El campo Pedidos.Comercial guarda el CÓDIGO del comercial (formato tipo
// "PDC-C08"), no el nombre. Por eso matcheamos primero por comercial_codigo;
// si no hay match, caemos por nombre para retrocompatibilidad con datos
// anteriores donde el usuario no tiene código asignado.
async function _resolveComercialId(valor) {
  var v = String(valor || '').trim();
  if (!v) return null;
  var vLow = v.toLowerCase();
  if (typeof AUTH !== 'undefined' && AUTH.isComercial && AUTH.isComercial()) {
    var u = AUTH.getUser();
    return u ? u.id : null;
  }
  if (typeof NOTIF === 'undefined' || !NOTIF.getDirectorio) return null;
  try {
    var dir = await NOTIF.getDirectorio();
    var activos = (dir || []).filter(function(x) { return x.activo; });
    // 1) Match por códigos de comercial por empresa (codigos_comercial jsonb array).
    var byCod = activos.filter(function(x) {
      var codes = x.codigos_comercial || [];
      for (var j = 0; j < codes.length; j++) {
        if (String(codes[j].codigo || '').trim().toLowerCase() === vLow) return true;
      }
      return String(x.comercial_codigo || '').trim().toLowerCase() === vLow;
    })[0];
    if (byCod) return byCod.id;
    // 2) Fallback: match por nombre.
    var byName = activos.filter(function(x) {
      return String(x.nombre || '').trim().toLowerCase() === vLow;
    })[0];
    return byName ? byName.id : null;
  } catch (e) { return null; }
}

// ── Sorting ──
var sortLevels = [];

// Días hábiles (lun-vie) transcurridos desde Fecha_Pedido hasta hoy.
// null si no hay fecha válida.
function _diasDesdePedido(f) {
  if (!f) return null;
  var s = String(f).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var p = s.split('-');
  var start = new Date(+p[0], +p[1] - 1, +p[2]);
  var n = new Date();
  var end = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  var count = 0;
  var cur = new Date(start.getTime());
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    var dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// True si el pedido debe mostrar el indicador de días (activo, no cerrado y no anulado).
function _mostrarDias(c) {
  var lines = getLinesFor(c);
  var est = derivedStatus(lines);
  var est2 = derivedEstado2(lines);
  return (est === 'Recibido' || est === 'Alistado' || est === 'Parcial')
      && est2 !== 'Cerrado' && est2 !== 'Anulado';
}

var SORT_COLS = [
  { id:'empresa',     label:'Empresa',      fn: function(c) { return getSigla(c.Nombre_Empresa); } },
  { id:'consecutivo', label:'Consecutivo',  fn: function(c) { return Number(c.Consecutivo)||0; } },
  { id:'cliente',     label:'Cliente',      fn: function(c) { return (c.Cliente||'').toLowerCase(); } },
  { id:'fecha',       label:'Fecha Pedido', fn: function(c) { return +new Date(c.Fecha_Pedido||0); } },
  { id:'dias',        label:'Días Háb.',         fn: function(c) {
      // Al ordenar, filas sin indicador van al fondo (valor -1).
      if (!_mostrarDias(c)) return -1;
      var d = _diasDesdePedido(c.Fecha_Pedido);
      return d == null ? -1 : d;
    }
  },
  { id:'comercial',   label:'Comercial',    fn: function(c) { return (c.Comercial||'').toLowerCase(); } },
  { id:'municipio',   label:'Municipio',    fn: function(c) { return (c.Municipio||'').toLowerCase(); } },
  { id:'total',       label:'Total Orden',  fn: function(c) { return Number(c.Total_Orden)||0; } },
  { id:'productos',   label:'Productos',    fn: function(c) { return getLinesFor(c).length; } },
  { id:'avance',      label:'Avance',       fn: function(c) { return derivedPct(getLinesFor(c)); } },
  { id:'estado',      label:'Estado',       fn: function(c) { return derivedStatus(getLinesFor(c)); } },
  { id:'estado2',     label:'Estado 2',     fn: function(c) { return derivedEstado2(getLinesFor(c)); } },
];

function toggleSort(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevels.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevels.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevels[idx].dir === 'asc') sortLevels[idx].dir = 'desc'; else sortLevels.splice(idx, 1); }
  else { sortLevels.push({ id: id, dir: 'asc' }); }
  renderTable();
}

function clearSort() { sortLevels = []; renderTable(); }

function applySort(rows) {
  if (!sortLevels.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevels.length; si++) {
      var lvl = sortLevels[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS.length; ci++) { if (SORT_COLS[ci].id === lvl.id) { col = SORT_COLS[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function renderHeader() {
  var cols = [
    { label:'#', id:null }, { label:'Empresa', id:'empresa' }, { label:'Consecutivo', id:'consecutivo' },
    { label:'Cliente', id:'cliente' }, { label:'Fecha Pedido', id:'fecha' }, { label:'Días Háb.', id:'dias' }, { label:'Comercial', id:'comercial' },
    { label:'Municipio', id:'municipio' },
    { label:'Total Orden', id:'total' }, { label:'Productos', id:'productos' }, { label:'Avance', id:'avance' },
    { label:'Estado', id:'estado' }, { label:'Estado 2', id:'estado2' }, { label:'Acción', id:null },
  ];
  document.getElementById('t-head').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th>' + col.label + '</th>';
    var lvlIdx = sortLevels.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevels[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevels.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '" onclick="toggleSort(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');
  var btn = document.getElementById('btn-clear-sort');
  if (btn) btn.style.display = sortLevels.length ? 'inline-block' : 'none';
}

// ── Siglas ──
var SIGLAS = {
  'PARCELAR DE COLOMBIA SAS': 'PARCELAR',
  'GREEN AGROSOLUCIONES DE COLOMBIA SAS': 'GREEN',
  'SOLUCIONES INTEGRALES RESO SAS': 'RESO',
  'INSUMOS AGROPECUARIOS SOSTENIBLES SAS': 'IASO',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS': 'IAS',
  'INSUMOS AGROPECUARIOS DE LA SABANA SAS ': 'IAS',
};
function getSigla(n) { return SIGLAS[(n||'').trim()] || n || '—'; }
var SIGLA_CLASSES = ['PARCELAR','GREEN','RESO','IASO','IAS'];
function getSiglaClass(n) { var s = getSigla(n); return SIGLA_CLASSES.indexOf(s) >= 0 ? 'sigla-'+s : 'sigla-DEFAULT'; }

// ── Lista de precios IAS (fuente: lista_precios_ias_19082026.xlsx) ──
// [producto, precio_dealer, precio_mayorista, precio_publico]
var _PRECIOS_IAS_RAW = [
  ['AJO AJI ORTIGA X 250 ML',12500,9250,15006],
  ['AJO AJI ORTIGA X GALON',164084,121545,196980],
  ['AJO AJI ORTIGA X LITRO',43251,32038,51922],
  ['AJO AJI ORTIGA X BIDON 20 LITROS',779615,577500,935912],
  ['COOL PLANT X 25 KILOS',621622,460000,746244],
  ['COOL PLANT X KILO',27027,20000,32445],
  ['GREEN FUNGY-BAC X 250 ML',14527,10750,0],
  ['GREEN FUNGY-BAC X GALON',184613,136752,221624],
  ['GREEN FUNGY-BAC X 500 ML',26351,19500,0],
  ['GREEN FUNGY-BAC X LITRO',47252,35002,56725],
  ['GREEN FUNGY-BAC X BIDON 20 LITROS',882889,654000,1059891],
  ['ACTIV CEL X BIDON 20 LITROS',830068,614250,996480],
  ['ACTIV CEL X GALON',175405,129800,210571],
  ['ACTIV CEL X LITRO',54054,40000,64891],
  ['ACTIV CEL X 250 ML',13378,9900,16060],
  ['NUTRI ROOTS X 250 ML',17432,12900,20927],
  ['NUTRI ROOTS X BIDON 20 LITROS',989189,732000,1187502],
  ['NUTRI ROOTS X GALON',203243,150400,243989],
  ['NUTRI ROOTS X LITRO',53514,39600,64242],
  ['ACTIV K 50 X LITRO',57230,42350,68703],
  ['ACTIV K 50 X 250 ML',18378,13600,22063],
  ['ACTIV K 50 X GALON',218108,161400,261834],
  ['ACTIV K 50 X BIDON 20 LITROS',1063514,787000,1276727],
  ['AR-SIL-TRU X LITRO',74324,55000,89225],
  ['AR-SIL-TRU X GALON',286486,212000,343921],
  ['NITRATO DE ZINC X BIDON 20 LITROS',635135,470000,762467],
  ['NITRATO DE ZINC X GALON',127027,94000,0],
  ['NITRATO DE ZINC X LITRO',33784,25000,40557],
  ['UREA FOSFATO X KILO',7432,5500,8922],
  ['CREOLINA X 20 LITROS',482365,356950,579069],
  ['CREOLINA X 250 ML',10405,7700,12491],
  ['CREOLINA X 500 ML',19176,14190,23020],
  ['CREOLINA X GALON',103311,76450,124023],
  ['CREOLINA X LITRO',29730,22000,35690],
  ['DEKATIN X LITRO',70270,52000,84358],
  ['DEKATIN X GALON',267568,198000,321210],
  ['DEKATIN X BIDON 20 LITROS',1324324,980000,1589825],
  ['HUMI 61 X KILO',12162,9000,14600],
  ['HUMI 61 X 25 KILOS',279730,207000,335810],
  ['VASTAGO 9-13-28 PRODUCCION X 25 KILOS',12582,9311,15105],
  ['VASTAGO 9-13-28 PRODUCCION X KILO',290236,214774,348422],
  ['AGROHUMICOL X BIDON 20 LITROS',175676,130000,210895],
  ['AGROHUMICOL X GALON',43243,32000,51913],
  ['AGROHUMICOL X LITRO',12162,9000,14600],
  ['URSUDOL X BLT 25 KILOS',159179,117793,191092],
  ['URSUDOL X KILOS',7340,5432,8812],
  ['20-20-20 DESARROLLO X KILO',12116,8966,14545],
  ['20-20-20 DESARROLLO X 25 KILOS',278576,206146,334425],
  ['25-4-24 PRODUCCION X KILO',11299,8361,13564]
];

// ── Lista de precios GREEN (fuente: lista_precios_iaso_11082026.xlsx) ──
// [producto, precio_dealer, precio_mayorista]
var _PRECIOS_GREEN_RAW = [
  ['GREEN 40F  X 60 LTS',8059399,5970000],
  ['GREEN 40F X BIDON 20 LITROS',2697500,1998100],
  ['GREEN 40F X 250 ML',38800,28800],
  ['GREEN 40F X 500 ML',73500,55000],
  ['GREEN 40F X GALON',545000,403700],
  ['GREEN 40F X LITRO',138950,102900],
  ['GREEN 40F X CANECA 200 LITROS',0,18600000],
  ['GROW GREEN SP X BIDON 20 LITROS',0,1998100],
  ['GROW GREEN SP X GALON',0,403700],
  ['GROW GREEN SP X LITRO',0,102900],
  ['GROW-GREEN SP X 250 ML',0,28800],
  ['GROW-GREEN SP X 500 ML',0,55000],
  ['GROW-GREEN SP X CANECA 200 LITROS',0,18600000],
  ['GROW-GREEN SP  X 60 LTS',0,5970000],
  ['AKAR GREEN X 250 ML',40900,30400],
  ['AKAR GREEN X 500 ML',79200,58800],
  ['AKAR GREEN X BIDON 20 LITROS',2688550,2129000],
  ['AKAR GREEN X GALON',543100,429800],
  ['AKAR GREEN X LITRO',147800,109450],
  ['GREEN CU-ILL X BIDON 20 LITROS',467800,346500],
  ['GREEN CU-ILL X GALON',95150,70500],
  ['GREEN CU-ILL X LITRO',24300,18000],
  ['GREEN CU-ILL X 60 LITROS',1376983,1020000],
  ['GREEN CA-L X CANECA 10 LITROS',308000,229500],
  ['GREEN CA-L X CANECA 20 LITROS',614000,454800],
  ['GREEN CA-L X GALON',128200,95000],
  ['GREEN CA-L X LITRO',34800,25750],
  ['GREEN CA-L  X 60 LITROS',1808977,1340000],
  ['GREEN CORRECTOR X 250 ML',8600,7150],
  ['GREEN CORRECTOR X GALON',121550,101200],
  ['GREEN CORRECTOR X LITRO',33000,27500],
  ['GREEN CORRECTOR X BIDON 20 LITROS',573550,498000],
  ['GREEN CORRECTOR  X 60 LITROS',1997975,1480000],
  ['PEGASSO TOP X BIDON 20 LITROS',354000,295000],
  ['PEGASSO TOP X 250 ML',0,5150],
  ['PEGASSO TOP X GALON',71500,59500],
  ['PEGASSO TOP X LITRO',18600,15500],
  ['PEGASSO TOP X 60 LITROS',1174485,870000],
  ['GREEN AMINO X 500 ML',0,19500],
  ['GREEN AMINO X BIDON 20 LITROS',843700,614250],
  ['GREEN AMINO X GALON',176700,129800],
  ['GREEN AMINO X LITRO',44800,34400],
  ['GREEN AMINO X 250 ML',12900,9900],
  ['GREEN AMINO X 60 LITROS',2456969,1820000],
  ['GREEN FOS X 500 ML',27700,21300],
  ['GREEN FOS X GALON',195550,150400],
  ['GREEN FOS X LITRO',51500,39600],
  ['GREEN FOS X 250 ML',16800,12900],
  ['GREEN FOS X BIDON 20 LITROS',951600,732000],
  ['GREEN FOS X 60 LITROS',2942963,2180000],
  ['GREEN K X 250 ML',17700,13600],
  ['GREEN K X 500 ML',33300,25600],
  ['GREEN K X BIDON 20 LITROS',1023000,787000],
  ['GREEN K X GALON',209800,161400],
  ['GREEN K X LITRO',55000,42350],
  ['GREEN K X 60 LITROS',3158961,2340000],
  ['NEMOCAP X 500 ML',52000,38450],
  ['NEMOCAP X BIDON 20 LITROS',1914300,1418000],
  ['NEMOCAP X BIDON 60 LITROS',5710429,4230000],
  ['NEMOCAP X GALON',388500,287600],
  ['NEMOCAP X LITRO',99800,73900],
  ['JABOTAN EXPORTACION X BIDON 20 LITROS',677800,502000],
  ['JABOTAN EXPORTACION X BIDON 60 LITROS',2011475,1490000],
  ['JABOTAN EXPORTACION X GALON',142000,105200],
  ['JABOTAN EXPORTACION X LITRO',39200,29050],
  ['GREEN YODO  X BIDON 20 LITROS',739800,548000],
  ['GREEN YODO X 250 ML',14300,10600],
  ['GREEN YODO X 500 ML',25000,0],
  ['GREEN YODO X GALON',153400,113600],
  ['GREEN YODO X LITRO',41000,30400],
  ['GREEN YODO X BIDON 60 LITROS',2200472,1630000],
  ['GREEN VAX X 500 ML',50700,39000],
  ['GREEN VAX X LITRO',91000,70000],
  ['GREEN VAX X GALON',344500,265000],
  ['GREEN VAX  X BIDON 20 LITROS',1755000,1300000],
  ['GREEN VAX X BIDON 60 LITROS',5224435,3870000],
  ['GREEN MOLUS-KILL X 250 ML',37400,27700],
  ['GREEN MOLUS-KILL X 500 ML',72400,53600],
  ['GREEN MOLUS-KILL X BIDON 20 LITROS',1959000,1451000],
  ['GREEN MOLUS-KILL X GALON',416800,308700],
  ['GREEN MOLUS-KILL X LITRO',110400,81800],
  ['GREEN MOLUS-KILL X BIDON 60 LITROS',6108674,4525000],
  ['JABOLAN EXPORTACION X BIDON 20 LT',507000,375600],
  ['JABOLAN EXPORTACION X GALON',106800,79200],
  ['JABOLAN EXPORTACION X LITRO',29400,21800],
  ['JABOLAN EXPORTACION X BIDON 60 LITROS',1484981,1100000],
  ['CREOLINA X 20 LITROS',364000,364000],
  ['CREOLINA X 250 ML',7800,7800],
  ['CREOLINA X 500 ML',14300,14300],
  ['CREOLINA X GALON',78000,78000],
  ['CREOLINA X LITRO',21500,21500],
  ['BORCAMAG X BIDON 20 LITROS',608400,468000],
  ['BORCAMAG X GALON',126880,97600],
  ['BORCAMAG X LITRO',34320,26400],
  ['BORCAMAG X 250 ML',12480,9600],
  ['BORCAMAG X 500 ML',19110,14700],
  ['NUTRI ROOTS X BIDON 20 LITROS',0,590000],
  ['NUTRI ROOTS X LITRO',0,29500],
  ['AGROHUMICOL X BIDON 20 LITROS',175700,130000],
  ['AGROHUMICOL X GALON',43300,32000],
  ['AGROHUMICOL X LITRO',12200,9000],
  ['GROW GREEN X 250 ML',38800,38800],
  ['GROW GREEN X 500 ML',73500,73500],
  ['GROW GREEN X BIDON 20 LITROS',2697500,2697500],
  ['GROW GREEN X GALON',545000,545000],
  ['GROW GREEN X LITRO',138950,138950],
  ['GREEN FUNGY-BAC X LITRO',47250,35000],
  ['GREEN DEFENSER-TECH X 250 ML',55393,41032],
  ['GREEN DEFENSER-TECH X LITRO',205376,152130]
];

// ── Lista de precios RESO (fuente: lista_precios_iaso_11082026.xlsx) ──
// [producto, precio_dealer, precio_mayorista, precio_publico]
var _PRECIOS_RESO_RAW = [
  ['ARACK GREEN X 20 LITROS',2874150,2129000,3161565],
  ['ARACK GREEN X 250 ML',45405,30362,49946],
  ['ARACK GREEN X 500 ML',78300,58000,86130],
  ['ARACK GREEN X GALON',580230,429800,638253],
  ['ARACK GREEN X LITRO',147758,109450,162534],
  ['BA-BOR-ZINC X 250 ML',37391,27697,41130],
  ['BA-BOR-ZINC X 500 ML',58832,43579,64715],
  ['BA-BOR-ZINC X BIDON 20 LITROS',2047592,1516735,2252351],
  ['BA-BOR-ZINC X GALON',416641,308623,458305],
  ['BA-BOR-ZINC X LITRO',110392,81772,121431],
  ['CALIMAN X BIDON 20 LITROS',567000,420000,623700],
  ['CALIMAN X CANECA 10 LITROS',291141,215660,320255],
  ['CALIMAN X GALON',128196,94960,141015],
  ['CALIMAN X LITRO',34721,25719,38193],
  ['GEON3 X 250 ML',27540,20400,30294],
  ['GEON3 X 500 ML',0,39950,0],
  ['GEON3 X BIDON 20 LITROS',1914300,1418000,2105730],
  ['GEON3 X GALON',388260,287600,427086],
  ['GEON3 X LITRO',99765,73900,109742],
  ['GROW GREEN SP X BIDON 20 LITROS',3204927,2374020,3525420],
  ['GROW GREEN SP X GALON',640985,474804,705084],
  ['GROW GREEN SP X LITRO',166656,123449,183322],
  ['GROW GREEN SP X 250 ML',0,31599,0],
  ['GROW GREEN 50DBF X 250 ML',38780,28726,42658],
  ['GROW GREEN 50DBF X 500 ML',74856,55449,82342],
  ['GROW GREEN 50DBF X BIDON 20 LITROS',2697435,1998100,2967179],
  ['GROW GREEN 50DBF X GALON',544887,403620,599376],
  ['GROW GREEN 50DBF X LITRO',138922,102905,152814],
  ['JABOTAN X BIDON 20 LITROS',507060,375600,557766],
  ['JABOTAN X GALON',106812,79120,117493],
  ['JABOTAN X LITRO',29403,21780,32343],
  ['JABOTAN EXPORTACION X BIDON 20 LITROS',0,502000,0],
  ['JABOTAN EXPORTACION X GALON',0,105200,0],
  ['JABOTAN EXPORTACION X LITRO',0,29050,0],
  ['KAITOSOL X 250 ML',0,0,60932],
  ['KAITOSOL X BIDON 20 LITROS',0,0,4429161],
  ['KAITOSOL X GALON',0,0,891772],
  ['KAITOSOL X LITRO',0,0,225910],
  ['IKASOL X 250 ML',55393,41032,0],
  ['IKASOL X BIDON 20 LITROS',4026510,2982600,0],
  ['IKASOL X GALON',810702,600520,0],
  ['IKASOL X LITRO',205373,152130,0],
  ['NEEM GREEN  X 500 ML',83387,61768,91726],
  ['NEEM GREEN X 250 ML',44943,33291,49437],
  ['NEEM GREEN X BIDON 20 LITROS',3026876,2242130,3329564],
  ['NEEM GREEN X GALON',614278,455021,675706],
  ['NEEM GREEN X LITRO',156685,116063,172353],
  ['THYME GREEN X 250 ML',44943,33291,49437],
  ['THYME GREEN X 500 ML',83387,61768,91726],
  ['THYME GREEN X BIDON 20 LITROS',3026876,2242130,3329564],
  ['THYME GREEN X GALON',614278,455021,675706],
  ['THYME GREEN X LITRO',156685,95000,172353],
  ['YODO X 250 ML',14310,10600,15741],
  ['YODO X 500 ML',22228,16465,24451],
  ['YODO X BIDON 20 LITROS',739800,548000,813780],
  ['YODO X GALON',153360,113600,168696],
  ['YODO X LITRO',41040,30400,45144],
  ['CALCI-TECH X BIDON 20 LITROS',357750,265000,412000],
  ['CALCI-TECH X GALON',85050,63000,98000],
  ['CALCI-TECH X LITRO',24000,18000,27945],
  ['GENIUS-TECH X 250 ML',34493,25550,46565],
  ['GENIUS-TECH X BIDON 20 LITROS',2443500,1810000,2810025],
  ['GENIUS-TECH X GALON',494100,366000,667035],
  ['GENIUS-TECH X LITRO',127008,94080,171461],
  ['MEKA-TECH X GALON',117450,87000,135068],
  ['MEKA-TECH X LITRO',32400,24000,37300],
  ['MEKA-TECH X BIDON 20 LITROS',560250,415000,756338],
  ['NITRO-TECH X BIDON 20 LITROS',425250,315000,489038],
  ['NITRO-TECH X GALON',90450,67000,104017],
  ['NITRO-TECH X LITRO',25650,19000,29498],
  ['PROTO TECH X BIDON 20 LITROS',614250,455000,706388],
  ['PROTO TECH X GALON',128250,95000,147488],
  ['PROTO TECH X LITRO',35100,26000,40365],
  ['ALGESIL X LT',0,42955,0],
  ['ALTOSAN BIZIN X LT',0,48033,0],
  ['COPFOR',0,45018,0],
  ['MIMOX ZN',0,54752,0],
  ['ROTIP',0,40627,0],
  ['KERBEUS X LT',0,78080,0],
  ['SHAZUGAMYCIN 2 % SL',0,16000,0],
  ['SHARDIZOL 250 EC X LITRO',0,45000,0]
];

// ── Lista de precios PARCELAR (fuente: lista_precios_iaso_11082026.xlsx) ──
// [producto, precio_dealer, precio_mayorista, precio_publico]
var _PRECIOS_PARCELAR_RAW = [
  ['DESESTRES P X GALON',195520,150400,0],
  ['DESESTRES P X 20 LITROS',951600,732000,0],
  ['DESESTRES P X 250 ML',16770,12900,0],
  ['DESESTRES P X 500 ML',27690,21300,0],
  ['DESESTRES P X LITRO',51480,39600,0],
  ['ENGORDE K X BIDON 20 LITROS',1023100,787000,0],
  ['ENGORDE K X 250 ML',17680,13600,0],
  ['ENGORDE K X GALON',209820,161400,0],
  ['ENGORDE K X 500 ML',33280,25600,0],
  ['ENGORDE K X LITRO',55055,42350,0],
  ['AFINADOR CAB X BIDON 20 LITROS',403000,310000,0],
  ['AFINADOR CAB X 250 ML',9750,7500,0],
  ['AFINADOR CAB X 500 ML',0,12000,0],
  ['AFINADOR CAB X GALON',83200,64000,0],
  ['AFINADOR CAB X LITRO',23400,18000,0],
  ['MERO BRIO X BIDON 20 LITROS',2353000,1810000,0],
  ['MERO BRIO X 250 ML',34320,26400,0],
  ['MERO BRIO X GALON',475800,366000,0],
  ['MERO BRIO X LITRO',121550,93500,0],
  ['FERTI-HUMI 16 X BIDON 20 LITROS',265200,204000,0],
  ['FERTI-HUMI 16 X GALON',58240,44800,0],
  ['FERTI-HUMI 16 X LITRO',17160,13200,0],
  ['MICROZUL FZ&V LOMBRI-CROP  X 20 LITROS',379600,292000,0],
  ['MICROZUL FZ&V LOMBRI-CROP  X GALON',81120,62400,0],
  ['MICROZUL FZ&V LOMBRI-CROP  X LITRO',22880,17600,0],
  ['CALIMAN X GALON',128196,94960,0],
  ['CALIMAN X CANECA 10 LITROS',308000,237400,0],
  ['CALIMAN X BIDON 20 LITROS',613980,454800,0],
  ['CALIMAN X LITRO',34749,25740,0],
  ['CLEAN CROP X 20 LITROS',2697435,1998100,0],
  ['CLEAN CROP X 250 ML',38780,28726,0],
  ['CLEAN CROP X GALON',544887,403620,0],
  ['CLEAN CROP X LITRO',138922,102905,0],
  ['BORDEL CROP X BIDON 20 LITROS',810000,600000,0],
  ['BORDEL CROP X 250 ML',15188,11250,0],
  ['BORDEL CROP X GALON',167400,124000,0],
  ['BORDEL CROP X LITRO',44550,33000,0],
  ['TRIP CROP X LITRO',156668,116050,0],
  ['TRIP CROP X 250 ML',43216,32012,0],
  ['TRIP CROP X GALON',615870,456200,0],
  ['TRIP CROP X BIDON 20 LITROS',3052350,2261000,0],
  ['ESPAIDER CROP X BIDON 20 LITROS',2874150,2129000,0],
  ['ESPAIDER CROP X 250 ML',40989,30362,0],
  ['ESPAIDER CROP X LITRO',147758,109450,0],
  ['ESPAIDER CROP X GALON',580230,429800,0],
  ['NOI-1 X BIDON 20 LITROS',4026510,2982600,0],
  ['NOI-1 X 250 ML',55393,41032,0],
  ['NOI-1 X GALON',810702,600520,0],
  ['NOI-1 X LITRO',205376,152130,0],
  ['NEMATO CROP X BIDON 20 LITROS',1914300,1418000,0],
  ['NEMATO CROP X 250 ML',0,21500,0],
  ['NEMATO CROP X GALON',388260,287600,0],
  ['NEMATO CROP X 500 ML',51908,38450,0],
  ['NEMATO CROP X LITRO',99765,73900,0],
  ['YODO X GALON',153360,113600,0],
  ['YODO X LITRO',41040,30400,0],
  ['YODO X BIDON 20 LITROS',739800,548000,0],
  ['YODO X 250 ML',14310,10600,0],
  ['JABOLAN X 250 ML',11475,8500,0],
  ['JABOLAN X BIDON 20 LITROS',507060,375600,0],
  ['JABOLAN X GALON',106812,79120,0],
  ['JABOLAN X LITRO',29403,21780,0],
  ['CREOLINA X 20 LITROS',481883,356950,0],
  ['CREOLINA X 250 ML',10395,7700,0],
  ['CREOLINA X GALON',103208,76450,0],
  ['CREOLINA X 500 ML',19157,14190,0],
  ['CREOLINA X LITRO',29700,22000,0],
  ['PEGASSO PH X BIDON 20 LITROS',546000,420000,0],
  ['PEGASSO PH X 250 ML',11700,9000,0],
  ['PEGASSO PH X 60 LITROS',0,1150000,0],
  ['PEGASSO PH X GALON',114400,88000,0],
  ['PEGASSO PH X LITRO',31200,24000,0],
  ['PEGASSO PH X CANECA 200 LITROS',0,3800000,0],
  ['PEGASSO OIL X BIDON 20 LITROS',468000,360000,0],
  ['PEGASSO OIL X 250 ML',10725,8250,0],
  ['PEGASSO OIL X 60 LITROS',0,950000,0],
  ['PEGASSO OIL X GALON',98800,76000,0],
  ['PEGASSO OIL X LITRO',27300,21000,0],
  ['PEGASSO OIL X CANECA 200 LITROS',0,3200000,0],
  ['GREEN 40F X BIDON 20 LITROS',2697500,0,0],
  ['GREEN 40F X 250 ML',39000,0,0],
  ['GREEN 40F X 500 ML',74300,0,0],
  ['GREEN 40F X GALON',545000,0,0],
  ['GREEN 40F X LITRO',139000,0,0],
  ['GREEN MOLUS-KILL X 250 ML',37400,0,0],
  ['GREEN MOLUS-KILL X 500 ML',72400,0,0],
  ['GREEN MOLUS-KILL X BIDON 20 LITROS',1958900,0,0],
  ['GREEN MOLUS-KILL X GALON',417000,0,0],
  ['GREEN MOLUS-KILL X LITRO',110500,0,0],
  ['GREEN VAX X 500 ML',52700,0,0],
  ['GREEN VAX X LITRO',94500,0,0],
  ['GREEN VAX X GALON',357800,0,0],
  ['GREEN VAX X BIDON 20 LITROS',1755000,0,0],
  ['FOSTAL 80 WP X 500 GR CV',13500,0,15882],
  ['CUFIGA 80 WP X 500 GR CV',12300,0,14471],
  ['TABUS 50 WG X 40 GR CV',13500,0,15882],
  ['SAGUM 25 SC X 500 ML CV',48000,0,56471],
  ['SAGUM X LITRO CV',65000,0,76471],
  ['CERTUS 70 WS X 50 GR',18800,0,22118],
  ['CERTUS 70 WS X 100 GR CV',32000,0,37647],
  ['CERTUS 70 WS X 500 GR CV',142000,0,167059],
  ['FIPRID 75 SC 100ML CV',20600,0,24235],
  ['FIPRID X 500 ML',78800,0,92706],
  ['LAMBDA CIHALOTRINA X 100 ML',10300,0,12118],
  ['LAMBDA CIHALOTRINA X 500 ML',41200,0,48471],
  ['LAMBDA CIHALOTRINA X LITRO',80000,0,94118],
  ['SHOCK UPI 36 EG X 500G',181000,0,212941],
  ['SHOCK UPI 36 EG X KG',345000,0,405882],
  ['AMETRINA 80WG X KILO',45000,0,52941],
  ['HEXAZINONA 300 GR',35500,0,41765],
  ['HEXAZINONA 75 X KILO',94000,0,110588],
  ['DIRVO 60% WG X 20 GR CV',2200,0,2588],
  ['DIRVO 60% WG X KILO ( METSULFURON) CV',53000,0,62353],
  ['FICLORAM LITRO',21000,0,24706],
  ['FICLORAM SL X GALON',67000,0,78824],
  ['FICLORAM SL X 20 LITROS',271000,0,318824],
  ['RUDOWN X 1 KG',26000,0,30588],
  ['RUDOWN X 50 GR',2200,0,2588]
];

function _mergePreciosEmbedded() {
  if (!listaPreciosCache) listaPreciosCache = [];
  if (!productosCache) productosCache = [];
  var empresa = 'PARCELAR DE COLOMBIA SAS';
  var existingP = {};
  listaPreciosCache.forEach(function(lp) {
    existingP[_normStr(lp.Empresa) + '||' + _normStr(lp.Tipo_Precio) + '||' + _normStr(lp.Producto)] = true;
  });
  var existingM = {};
  productosCache.forEach(function(p) {
    existingM[_normStr(p.producto)] = true;
  });
  var sets = [
    { raw: _PRECIOS_PARCELAR_RAW, empresa: 'PARCELAR DE COLOMBIA SAS' },
    { raw: _PRECIOS_IAS_RAW, empresa: 'INSUMOS AGROPECUARIOS DE LA SABANA SAS' },
    { raw: _PRECIOS_GREEN_RAW, empresa: 'GREEN AGROSOLUCIONES DE COLOMBIA SAS' },
    { raw: _PRECIOS_RESO_RAW, empresa: 'SOLUCIONES INTEGRALES RESO SAS' }
  ];
  sets.forEach(function(set) {
    var emp = set.empresa;
    set.raw.forEach(function(r) {
      var prod = r[0], dealer = r[1], mayo = r[2], publico = r[3] || 0;
      var prodNorm = _normStr(prod);
      if (!existingM[prodNorm]) {
        existingM[prodNorm] = true;
        productosCache.push({ producto: prod, presentacion: '', empresa: emp });
      }
      if (dealer) {
        var kd = _normStr(emp) + '||dealer||' + prodNorm;
        if (!existingP[kd]) { existingP[kd] = true; listaPreciosCache.push({ Empresa: emp, Tipo_Precio: 'Dealer', Producto: prod, Precio: dealer }); }
      }
      if (mayo) {
        var km = _normStr(emp) + '||mayorista||' + prodNorm;
        if (!existingP[km]) { existingP[km] = true; listaPreciosCache.push({ Empresa: emp, Tipo_Precio: 'Mayorista', Producto: prod, Precio: mayo }); }
      }
      if (publico) {
        var kp = _normStr(emp) + '||publico||' + prodNorm;
        if (!existingP[kp]) { existingP[kp] = true; listaPreciosCache.push({ Empresa: emp, Tipo_Precio: 'Público', Producto: prod, Precio: publico }); }
      }
    });
  });
}

// ── State ──
var consecs = [];
var pedidos = [];
var activeIdx = null;
var editIdx = null;
var editKey = null;
var editWorkingLines = [];
var detailWorkingLines = [];
// Snapshot de existencias para el modal de detalle (empresa origen del stock)
var existSnapshot = null;

// Índice de solicitudes de compra abiertas (OCs Tipo='Traslado' con
// Ref_Pedido apuntando a un pedido y Remisión Destino aún vacía).
// Clave: normSC(Nombre_Empresa) + '||' + String(Consecutivo).trim()
// Valor: array de OCs { id, Consecutivo, Producto, Presentacion,
//                       Cantidad, Empresa_Origen, Fecha, Estado }.
// Se reconstruye en cada loadFromAPI().
var solicitudesCompraPorPedido = {};
var ocsLegalizadasPorPedido = {};

function _normSC(s) { return String(s || '').toLowerCase().trim(); }
function _keySC(empresa, consecutivo) {
  return _normSC(empresa) + '||' + String(consecutivo == null ? '' : consecutivo).trim();
}
// "CARVAL #123" → { empresa: 'CARVAL', consecutivo: '123' }
function _parseRefPedido(ref) {
  var s = String(ref || '').trim();
  if (!s) return null;
  var idx = s.lastIndexOf(' #');
  if (idx < 0) return null;
  var empresa = s.slice(0, idx).trim();
  var consecutivo = s.slice(idx + 2).trim();
  if (!empresa || !consecutivo) return null;
  return { empresa: empresa, consecutivo: consecutivo };
}
// Renderiza la sección de solicitudes de compra pendientes dentro
// del modal detalle. Se oculta si no hay OCs abiertas para ese
// pedido. Fuente de verdad: solicitudesCompraPorPedido (indexado
// desde OrdenesCompra en cada loadFromAPI).
function renderSolicitudesCompraSection(c) {
  var host = document.getElementById('solicitudes-compra-section');
  if (!host) return;
  var list = solicitudesCompraPorPedido[_keySC(c.Nombre_Empresa, c.Consecutivo)] || [];
  if (!list.length) {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }
  var items = list.map(function(s) {
    var esc = function(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(ch) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch];
    }); };
    return '<div class="sol-item">' +
      '<span class="sol-oc" title="Consecutivo de la OC">' + esc(s.Consecutivo) + '</span>' +
      '<span class="sol-prod">' + esc(s.Producto) + (s.Presentacion ? ' <span style="color:#718096;font-weight:400">· ' + esc(s.Presentacion) + '</span>' : '') + '</span>' +
      '<span class="sol-cant">' + s.Cantidad + ' ud</span>' +
      '<span class="sol-origen" title="Empresa origen del traslado">desde ' + esc(getSigla(s.Empresa_Origen) || s.Empresa_Origen) + '</span>' +
      '<span class="sol-estado">' + esc(s.Estado) + '</span>' +
    '</div>';
  }).join('');
  host.style.display = 'block';
  host.className = 'sol-panel';
  host.innerHTML =
    '<label class="sol-title">🛒 ' + list.length + ' solicitud' + (list.length === 1 ? '' : 'es') +
      ' de compra pendiente' + (list.length === 1 ? '' : 's') + ' para este pedido</label>' +
    '<div style="font-size:0.76rem;color:#7d2820;margin-bottom:8px">' +
      'Estas OC deben legalizarse en el módulo <strong>Órdenes de Compra</strong> (cargar Remisión Destino y Origen) ' +
      'para que el producto entre como existencia en <strong>' + (c.Nombre_Empresa || '') + '</strong> y se pueda emitir la remisión al cliente.' +
    '</div>' +
    '<div class="sol-list">' + items + '</div>';
}

function _buildSolicitudesMap(ordenes) {
  var map = {};
  (ordenes || []).forEach(function(oc) {
    if (String(oc.Tipo || '').toLowerCase() !== 'traslado') return;
    // "Legalizada" = tiene Remisión Destino cargada.
    if (String(oc.Remision || '').trim()) return;
    // Anulada o Cerrada (sin remisión, edge case manual) no cuentan
    // como solicitud viva. Mantiene la semántica idéntica al
    // predicado _esSolicitudPedidoPendiente de ordenes.js.
    var est = String(oc.Estado || '').toLowerCase();
    if (est === 'anulada' || est === 'cerrada') return;
    var ref = _parseRefPedido(oc.Ref_Pedido);
    if (!ref) return;
    var k = _keySC(ref.empresa, ref.consecutivo);
    if (!map[k]) map[k] = [];
    map[k].push({
      id: oc.id,
      Consecutivo: oc.Consecutivo || '',
      Producto: oc.Producto || '',
      Presentacion: oc.Presentacion || '',
      Cantidad: Number(oc.Cantidad) || 0,
      Empresa_Origen: oc.Empresa_Origen || '',
      Fecha: oc.Fecha || '',
      Estado: oc.Estado || 'Abierta'
    });
  });
  return map;
}

function _buildOCsLegalizadasMap(ordenes) {
  var map = {};
  (ordenes || []).forEach(function(oc) {
    if (String(oc.Tipo || '').toLowerCase() !== 'traslado') return;
    var remDest = String(oc.Remision || '').trim();
    var remOrig = String(oc.Remision_Origen || '').trim();
    if (!remDest && !remOrig) return;
    var ref = _parseRefPedido(oc.Ref_Pedido);
    if (!ref) return;
    var k = _keySC(ref.empresa, ref.consecutivo);
    if (!map[k]) map[k] = {};
    var consec = String(oc.Consecutivo || '');
    if (!map[k][consec]) map[k][consec] = [];
    map[k][consec].push(oc);
  });
  var result = {};
  Object.keys(map).forEach(function(k) {
    result[k] = Object.keys(map[k]).map(function(c) { return map[k][c]; });
  });
  return result;
}

// ── Load from API ──
async function loadFromAPI() {
  await _authReady;
  populateEmpresaSelect('nv-empresa');
  var loadZone = document.getElementById('load-zone');
  var mainEl = document.getElementById('main');
  var errEl = document.getElementById('load-error');
  var retryBtn = document.getElementById('btn-retry');
  var spinnerEl = document.getElementById('load-spinner');

  if (mainEl.style.display === 'block') {
    setSyncStatus('syncing', 'Actualizando datos...');
  } else {
    loadZone.style.display = 'block';
    spinnerEl.style.display = 'inline-block';
    errEl.style.display = 'none';
    retryBtn.style.display = 'none';
  }

  try {
    // Cargamos pedidos + OCs de traslado abiertas en paralelo. Las
    // OCs las usamos para el índice de "solicitudes de compra
    // pendientes" que se muestran como badge en la lista y como
    // sección en el modal detalle. Si getOrdenesCompra falla, seguimos
    // sin badges (los pedidos siguen cargando).
    var pedidosPromise = apiGet('getPedidos');
    var ordenesPromise = apiGet('getOrdenesCompra', {
      columns: 'id,Consecutivo,Tipo,Estado,Remision,Remision_Origen,Empresa_Origen,Empresa_Destino,Producto,Presentacion,Cantidad,Valor_Unitario,Valor_Total,Fecha,Ref_Pedido'
    }).catch(function() { return { ok: true, ordenes: [] }; });
    var results = await Promise.all([pedidosPromise, ordenesPromise]);
    var data = results[0];
    var ocData = results[1];
    if (!data.ok) throw new Error(data.error || 'Error desconocido');
    var allOCs = (ocData && ocData.ok && ocData.ordenes) || [];
    solicitudesCompraPorPedido = _buildSolicitudesMap(allOCs);
    ocsLegalizadasPorPedido = _buildOCsLegalizadasMap(allOCs);

    var EXPECTED = ['Fecha_Procesamiento','Nombre_Empresa','Consecutivo','Fecha_Pedido',
      'Cliente','NIT','Telefono','Direccion_Envio','Municipio','Departamento',
      'Comercial','Plazo_Pago','Precio_Facturacion','Producto','Presentacion',
      'Cantidad','Valor_Unitario','Valor_Total','Total_Orden','Archivo_Fuente',
      'Estado','ID_Cliente','ID_Comercial','ID_Producto',
      'Cant_Entregada','Cant_Pendiente','Estado_Entrega','Fecha_Ult_Entrega','Remisiones','Observaciones','Estado_2','Bonificado'];

    if (data.headers && data.headers[0] !== 'Fecha_Procesamiento') {
      var oldHeaders = data.headers;
      var posMap = {};
      for (var pi = 0; pi < oldHeaders.length; pi++) {
        var hKey = String(oldHeaders[pi]);
        if (!(hKey in posMap)) posMap[hKey] = [];
        posMap[hKey].push(pi);
      }
      var fixedFirst = {};
      for (var hi = 0; hi < EXPECTED.length && hi < oldHeaders.length; hi++) {
        fixedFirst[EXPECTED[hi]] = oldHeaders[hi];
      }
      fixedFirst.__row = 1;
      var fixedPedidos = [fixedFirst];
      for (var ri = 0; ri < data.pedidos.length; ri++) {
        var oldRow = data.pedidos[ri];
        var vals = [];
        for (var vi = 0; vi < oldHeaders.length; vi++) vals.push(undefined);
        for (var hk in posMap) {
          if (!posMap.hasOwnProperty(hk)) continue;
          var positions = posMap[hk];
          var rawVal = oldRow[hk];
          if (positions.length === 1) {
            vals[positions[0]] = rawVal;
          } else {
            for (var pp = 0; pp < positions.length; pp++) {
              vals[positions[pp]] = rawVal;
            }
          }
        }
        var newRow = {};
        for (var ci = 0; ci < EXPECTED.length && ci < vals.length; ci++) {
          newRow[EXPECTED[ci]] = vals[ci] !== undefined ? vals[ci] : '';
        }
        newRow.__row = oldRow.__row || (ri + 2);
        fixedPedidos.push(newRow);
      }
      data.pedidos = fixedPedidos;
      data.headers = EXPECTED;
    }

    data.pedidos = data.pedidos.filter(function(p) {
      return p.Nombre_Empresa !== 'Nombre_Empresa' && p.Cliente !== 'Cliente';
    });

    pedidos = data.pedidos.map(function(p) {
      if (p.Consecutivo !== null && p.Consecutivo !== undefined) {
        var n = Number(p.Consecutivo);
        if (!isNaN(n)) p.Consecutivo = n;
      }
      if (!p.Cant_Entregada && p.Cant_Entregada !== 0) {
        p.Cant_Entregada = 0;
        p.Cant_Pendiente = Number(p.Cantidad) || 0;
        p.Estado_Entrega = 'Recibido';
        p.Fecha_Ult_Entrega = null;
        p.Remisiones = '';
      }
      if (!p.Estado_2) p.Estado_2 = 'Abierto';
      if (!p.Estado_Entrega || p.Estado_Entrega.trim() === '') p.Estado_Entrega = 'Recibido';
      var cantE = Number(p.Cant_Entregada) || 0;
      var cantP = Number(p.Cant_Pendiente) || 0;
      var cantQ = Number(p.Cantidad) || 0;
      if (cantQ === 0 && (cantE + cantP) > 0) {
        p.Cantidad = cantE + cantP;
      } else if (cantQ > 0 && cantQ < cantE) {
        p.Cantidad = cantE + cantP;
      }
      return p;
    });

    rebuildConsecs();
    populateFilters();
    renderTable();
    loadAdjuntosIndex();
    initDespachosTab();

    loadZone.style.display = 'none';
    mainEl.style.display = 'block';
    setSyncStatus('ok', 'Conectado a la nube. Última actualización: ' + new Date().toLocaleTimeString('es-CO'));
    document.getElementById('hdr-status').textContent = '☁️ Supabase · ' + pedidos.length + ' líneas';
  } catch (err) {
    if (mainEl.style.display === 'block') {
      setSyncStatus('error', 'Error al actualizar: ' + err.message);
    } else {
      spinnerEl.style.display = 'none';
      errEl.textContent = '⚠️ ' + err.message;
      errEl.style.display = 'block';
      retryBtn.style.display = 'inline-block';
    }
  }
}

// ── Parse data ──
function rebuildConsecs() {
  var seen = {};
  pedidos.forEach(function(p) {
    var k = keyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente);
    if (!seen[k]) seen[k] = {
      Nombre_Empresa: p.Nombre_Empresa, Consecutivo: p.Consecutivo,
      Fecha_Pedido: p.Fecha_Pedido, Cliente: p.Cliente, NIT: p.NIT,
      Sucursal: p.Sucursal,
      Telefono: p.Telefono, Direccion_Envio: p.Direccion_Envio,
      Comercial: p.Comercial, Municipio: p.Municipio, Departamento: p.Departamento,
      Plazo_Pago: p.Plazo_Pago, Precio_Facturacion: p.Precio_Facturacion, Total_Orden: p.Total_Orden,
      Facturar_A: p.Facturar_A, NIT_Adicional: p.NIT_Adicional,
      Consignacion: p.Consignacion, Bodega_Facturacion: p.Bodega_Facturacion,
      Observaciones: p.Observaciones,
      _ModTs: null, _ModTipo: null,
    };
    var pts = p.Fecha_Modificacion_Cant;
    if (pts) {
      var cur = seen[k]._ModTs;
      if (!cur || new Date(pts).getTime() > new Date(cur).getTime()) {
        seen[k]._ModTs = pts;
        seen[k]._ModTipo = p.Tipo_Modificacion_Cant || 'ambos';
      }
    }
  });
  consecs = Object.values(seen).sort(function(a, b) {
    var da = +new Date(a.Fecha_Pedido), db = +new Date(b.Fecha_Pedido);
    return db - da || (b.Consecutivo||0) - (a.Consecutivo||0);
  }).map(function(c, i) { c['N°'] = i + 1; return c; });
}

// ── Helpers ──
function keyOf(emp, con, cli) { return (emp||'') + '||' + String(con||'').trim() + '||' + (cli||''); }

// ── Modificaciones (server-side + dismissal local por usuario) ──
// El servidor marca cada pedido con Fecha_Modificacion_Cant + Tipo_Modificacion_Cant
// cuando cambia la cantidad pedida o se agregan líneas. Todos los usuarios
// autorizados ven la marca. Cada usuario descarta su vista guardando la
// fecha "vista" en localStorage; si el servidor registra una modificación
// posterior, el resalte reaparece.
var MOD_SEEN_KEY = 'pedidos_mod_vistos_v1';
function _loadModSeen() {
  try { return JSON.parse(localStorage.getItem(MOD_SEEN_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function _saveModSeen(m) {
  try { localStorage.setItem(MOD_SEEN_KEY, JSON.stringify(m)); } catch (e) {}
}
function isPedidoModificadoPendiente(key, serverTs) {
  if (!key || !serverTs) return false;
  var dis = _loadModSeen()[key];
  if (!dis) return true;
  return new Date(serverTs).getTime() > new Date(dis).getTime();
}
function dismissPedidoModificado(key, serverTs, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (!key || !serverTs) return;
  var m = _loadModSeen();
  m[key] = serverTs;
  _saveModSeen(m);
  renderTable();
}

function getLinesFor(c) {
  var k = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
  return pedidos.filter(function(p) { return keyOf(p.Nombre_Empresa, p.Consecutivo, p.Cliente) === k; });
}

function derivedStatus(lines) {
  if (!lines.length) return 'Recibido';
  var fac = lines.filter(function(l) { return norm(l.Estado_Entrega) === 'facturado'; }).length;
  var ent = lines.filter(function(l) { return norm(l.Estado_Entrega) === 'entregado'; }).length;
  var ali = lines.filter(function(l) { return norm(l.Estado_Entrega) === 'alistado'; }).length;
  var par = lines.filter(function(l) { return norm(l.Estado_Entrega) === 'parcial'; }).length;
  if (fac === lines.length) return 'Facturado';
  if ((fac + ent) === lines.length) return 'Entregado';
  if ((fac + ent + ali) === lines.length) return 'Alistado';
  if (fac > 0 || ent > 0 || ali > 0 || par > 0) return 'Parcial';
  return 'Recibido';
}

function derivedEstado2(lines) {
  if (!lines.length) return 'Abierto';
  var vals = lines.map(function(l) { return (l.Estado_2 || 'Abierto').trim(); });
  if (vals.indexOf('Anulado') >= 0) return 'Anulado';
  if (vals.indexOf('Bloqueado por cartera') >= 0) return 'Bloqueado por cartera';
  if (vals.indexOf('Entregado por proveedor') >= 0) return 'Entregado por proveedor';
  var allCerrado = vals.every(function(v) { return v === 'Cerrado'; });
  if (allCerrado) return 'Cerrado';
  var allCerradoOrAlistado = vals.every(function(v) { return v === 'Cerrado' || v === 'Alistado'; });
  if (allCerradoOrAlistado) return 'Alistado';
  return 'Abierto';
}

function derivedPct(lines) {
  var totPed = lines.reduce(function(s, l) { return s + (Number(l.Cantidad)||0); }, 0);
  var totEnt = lines.reduce(function(s, l) { return s + (Number(l.Cant_Entregada)||0); }, 0);
  return totPed > 0 ? Math.round(totEnt / totPed * 100) : 0;
}

// ── Multi-select Municipio filter ──
var _muniSelected = [];
var _muniAllOptions = [];

function toggleMuniDropdown(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('f-muni-dropdown');
  var tg = document.getElementById('f-muni-toggle');
  var isOpen = dd.classList.contains('open');
  if (isOpen) {
    dd.classList.remove('open');
    tg.classList.remove('open');
  } else {
    dd.classList.add('open');
    tg.classList.add('open');
    var search = document.getElementById('f-muni-search');
    search.value = '';
    filterMuniOptions();
    setTimeout(function() { search.focus(); }, 50);
  }
}

function _closeMuniDropdown() {
  var dd = document.getElementById('f-muni-dropdown');
  var tg = document.getElementById('f-muni-toggle');
  if (dd) dd.classList.remove('open');
  if (tg) tg.classList.remove('open');
}

document.addEventListener('click', function(e) {
  var wrap = document.getElementById('f-muni-wrap');
  if (wrap && !wrap.contains(e.target)) _closeMuniDropdown();
});

function filterMuniOptions() {
  var q = (document.getElementById('f-muni-search').value || '').toLowerCase();
  var opts = document.getElementById('f-muni-options');
  var matches = _muniAllOptions.filter(function(m) {
    return !q || m.toLowerCase().indexOf(q) >= 0;
  });
  if (!matches.length) {
    opts.innerHTML = '<div class="ms-no-results">Sin resultados</div>';
    return;
  }
  opts.innerHTML = matches.map(function(m, i) {
    var checked = _muniSelected.indexOf(m) >= 0;
    return '<label class="ms-opt' + (checked ? ' selected' : '') + '" data-muni-idx="' + i + '" onclick="_onMuniOptClick(this, event)">' +
      '<input type="checkbox"' + (checked ? ' checked' : '') + '>' +
      '<span>' + m.replace(/</g, '&lt;') + '</span></label>';
  }).join('');
  opts._muniMatches = matches;
}

function _onMuniOptClick(el, e) {
  if (e) e.stopPropagation();
  var idx = Number(el.getAttribute('data-muni-idx'));
  var opts = document.getElementById('f-muni-options');
  var val = (opts._muniMatches || [])[idx];
  if (!val) return;
  var si = _muniSelected.indexOf(val);
  if (si >= 0) _muniSelected.splice(si, 1);
  else _muniSelected.push(val);
  _renderMuniToggle();
  filterMuniOptions();
  currentPage = 1;
  renderTable();
}

function _removeMuniByIdx(i, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  _muniSelected.splice(i, 1);
  _renderMuniToggle();
  filterMuniOptions();
  currentPage = 1;
  renderTable();
}

function _renderMuniToggle() {
  var tg = document.getElementById('f-muni-toggle');
  var ph = document.getElementById('f-muni-placeholder');
  if (!_muniSelected.length) {
    if (ph) ph.style.display = '';
    var chips = tg.querySelectorAll('.ms-chip,.ms-more');
    for (var i = 0; i < chips.length; i++) chips[i].remove();
    return;
  }
  if (ph) ph.style.display = 'none';
  var html = '';
  var show = Math.min(_muniSelected.length, 2);
  for (var i = 0; i < show; i++) {
    html += '<span class="ms-chip">' + _muniSelected[i].replace(/</g, '&lt;') + '<span class="ms-chip-x" onclick="_removeMuniByIdx(' + i + ', event)">&times;</span></span>';
  }
  if (_muniSelected.length > 2) {
    html += '<span class="ms-more">+' + (_muniSelected.length - 2) + '</span>';
  }
  tg.innerHTML = '<span class="ms-placeholder" id="f-muni-placeholder" style="display:none">Todos</span>' + html;
}

function _renderMuniOptions() {
  var search = document.getElementById('f-muni-search');
  if (search) search.value = '';
  filterMuniOptions();
}

// ── Filters ──
var filtersAttached = false;
function populateFilters() {
  var emps = []; var clis = []; var coms = []; var prods = {}; var munis = [];
  consecs.forEach(function(c) {
    if (c.Nombre_Empresa && emps.indexOf(c.Nombre_Empresa) < 0) emps.push(c.Nombre_Empresa);
    if (c.Cliente && clis.indexOf(c.Cliente) < 0) clis.push(c.Cliente);
    var com = (c.Comercial || '').trim();
    if (com && coms.indexOf(com) < 0) coms.push(com);
    var mun = (c.Municipio || '').trim();
    if (mun && munis.indexOf(mun) < 0) munis.push(mun);
    getLinesFor(c).forEach(function(l) {
      var p = (l.Producto || '').trim();
      if (p) prods[p] = 1;
    });
  });
  emps.sort(); clis.sort(); coms.sort(function(a, b) { return a.localeCompare(b, 'es'); });
  munis.sort(function(a, b) { return a.localeCompare(b, 'es'); });
  var prodList = Object.keys(prods).sort(function(a, b) { return a.localeCompare(b, 'es'); });
  var fe = document.getElementById('f-emp');
  var fc = document.getElementById('f-cli');
  var fcom = document.getElementById('f-com');
  var fp = document.getElementById('f-prod');
  var prevEmp = fe.value;
  var prevCli = fc.value;
  var prevCom = fcom ? fcom.value : '';
  var prevProd = fp ? fp.value : '';
  fe.innerHTML = '<option value="">Todas</option>' + emps.map(function(e) { return '<option value="' + e + '">' + getSigla(e) + ' — ' + e + '</option>'; }).join('');
  document.getElementById('dl-f-cli').innerHTML = clis.map(function(c) { return '<option value="' + c + '">'; }).join('');
  if (fcom) fcom.innerHTML = '<option value="">Todos</option>' + coms.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  var dlProd = document.getElementById('dl-f-prod');
  if (dlProd) dlProd.innerHTML = prodList.map(function(p) { return '<option value="' + p.replace(/"/g, '&quot;') + '">'; }).join('');
  _muniAllOptions = munis;
  _renderMuniOptions();
  if (prevEmp) fe.value = prevEmp;
  if (prevCli) fc.value = prevCli;
  if (fcom && prevCom) fcom.value = prevCom;
  if (fp && prevProd) fp.value = prevProd;
  if (!filtersAttached) {
    function onFilterChange() { currentPage = 1; renderTable(); }
    ['f-emp','f-com','f-cli','f-est','f-est2','f-prod','f-fec-desde','f-fec-hasta','f-txt'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', onFilterChange);
      el.addEventListener('input', onFilterChange);
    });
    filtersAttached = true;
  }
}

function filtered() {
  var fe = document.getElementById('f-emp').value;
  var fcomEl = document.getElementById('f-com');
  var fcom = fcomEl ? fcomEl.value : '';
  var fc = document.getElementById('f-cli').value;
  var fs = document.getElementById('f-est').value;
  var fs2 = document.getElementById('f-est2').value;
  var fpEl = document.getElementById('f-prod');
  var fp = fpEl ? fpEl.value.trim().toLowerCase() : '';
  var fdEl = document.getElementById('f-fec-desde');
  var fhEl = document.getElementById('f-fec-hasta');
  var fdesde = fdEl ? fdEl.value : '';   // ISO YYYY-MM-DD
  var fhasta = fhEl ? fhEl.value : '';
  var ft = document.getElementById('f-txt').value.toLowerCase();
  var fmunis = _muniSelected.slice();
  return consecs.filter(function(c) {
    if (fe && c.Nombre_Empresa !== fe) return false;
    if (fcom && (c.Comercial||'').trim() !== fcom) return false;
    if (fc && (c.Cliente||'').toLowerCase().indexOf(fc.toLowerCase()) < 0) return false;
    if (fmunis.length && fmunis.indexOf((c.Municipio||'').trim()) < 0) return false;
    if (fdesde || fhasta) {
      // Fecha_Pedido puede venir como 'YYYY-MM-DD' o ISO con hora; comparar por prefijo YYYY-MM-DD.
      var fp10 = String(c.Fecha_Pedido || '').slice(0, 10);
      if (!fp10) return false;
      if (fdesde && fp10 < fdesde) return false;
      if (fhasta && fp10 > fhasta) return false;
    }
    var lines = getLinesFor(c);
    if (fp) {
      // El pedido pasa si al menos una línea contiene el producto buscado.
      var any = lines.some(function(l) {
        return String(l.Producto || '').toLowerCase().indexOf(fp) >= 0;
      });
      if (!any) return false;
    }
    var est = derivedStatus(lines);
    if (fs && norm(est) !== norm(fs)) return false;
    if (fs2) { var e2 = derivedEstado2(lines); if (e2 !== fs2) return false; }
    if (ft) {
      var hay = [c.Cliente, String(c.Consecutivo), getSigla(c.Nombre_Empresa), c.Comercial].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });
}

function clearFilters() {
  document.getElementById('f-emp').value = '';
  var fcomEl = document.getElementById('f-com');
  if (fcomEl) fcomEl.value = '';
  document.getElementById('f-cli').value = '';
  document.getElementById('f-est').value = '';
  document.getElementById('f-est2').value = '';
  document.getElementById('f-txt').value = '';
  var fp = document.getElementById('f-prod');   if (fp) fp.value = '';
  var fd = document.getElementById('f-fec-desde'); if (fd) fd.value = '';
  var fh = document.getElementById('f-fec-hasta'); if (fh) fh.value = '';
  _muniSelected = [];
  _renderMuniToggle();
  _renderMuniOptions();
  currentPage = 1;
  renderTable();
}

// ── Pagination ──
var currentPage = 1;
var pageSize = 25;

function goToPage(p) {
  currentPage = p;
  renderTable();
  var card = document.querySelector('#panel-ordenes .card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changePageSize(val) {
  pageSize = Number(val) || 25;
  currentPage = 1;
  renderTable();
}

function renderPagination(totalRows) {
  var el = document.getElementById('pagination');
  if (!el) return;
  var totalPages = Math.ceil(totalRows / pageSize);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  var start = (currentPage - 1) * pageSize + 1;
  var end = Math.min(currentPage * pageSize, totalRows);
  var html = '<span class="pg-info">' + start + '–' + end + ' de ' + totalRows + '</span>';

  html += '<button ' + (currentPage <= 1 ? 'disabled' : 'onclick="goToPage(1)"') + ' title="Primera">«</button>';
  html += '<button ' + (currentPage <= 1 ? 'disabled' : 'onclick="goToPage(' + (currentPage - 1) + ')"') + ' title="Anterior">‹</button>';

  var range = [];
  if (totalPages <= 7) {
    for (var i = 1; i <= totalPages; i++) range.push(i);
  } else {
    range.push(1);
    if (currentPage > 3) range.push('...');
    for (var i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) range.push(i);
    if (currentPage < totalPages - 2) range.push('...');
    range.push(totalPages);
  }
  range.forEach(function(p) {
    if (p === '...') { html += '<span class="pg-ellipsis">…</span>'; return; }
    html += '<button class="' + (p === currentPage ? 'pg-active' : '') + '" onclick="goToPage(' + p + ')">' + p + '</button>';
  });

  html += '<button ' + (currentPage >= totalPages ? 'disabled' : 'onclick="goToPage(' + (currentPage + 1) + ')"') + ' title="Siguiente">›</button>';
  html += '<button ' + (currentPage >= totalPages ? 'disabled' : 'onclick="goToPage(' + totalPages + ')"') + ' title="Última">»</button>';

  html += '<select onchange="changePageSize(this.value)">';
  [25, 50, 100].forEach(function(n) {
    html += '<option value="' + n + '"' + (pageSize === n ? ' selected' : '') + '>' + n + ' / pág</option>';
  });
  html += '</select>';

  el.innerHTML = html;
}

// ── Render table ──
function renderTable() {
  var rows = applySort(filtered());
  var all = consecs.map(function(c) { return derivedStatus(getLinesFor(c)); });
  document.getElementById('s-rec').textContent = all.filter(function(e) { return e === 'Recibido'; }).length;
  document.getElementById('s-par').textContent = all.filter(function(e) { return e === 'Parcial'; }).length;
  document.getElementById('s-ent').textContent = all.filter(function(e) { return e === 'Entregado'; }).length;
  document.getElementById('s-tot').textContent = consecs.length;

  var totalRows = rows.length;
  var totalPages = Math.ceil(totalRows / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  document.getElementById('row-ct').textContent = '(' + totalRows + ' mostradas)';

  renderHeader();

  var tbody = document.getElementById('t-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="14"><div class="empty">No hay órdenes con los filtros seleccionados.</div></td></tr>';
    renderPagination(0);
    return;
  }

  var startIdx = (currentPage - 1) * pageSize;
  var pageRows = rows.slice(startIdx, startIdx + pageSize);

  tbody.innerHTML = pageRows.map(function(c) {
    var lines = getLinesFor(c);
    var est = derivedStatus(lines);
    var est2 = derivedEstado2(lines);
    var pct = derivedPct(lines);
    var badge = est === 'Recibido' ? 'b-rec' : est === 'Parcial' ? 'b-par' : est === 'Alistado' ? 'b-alistado' : est === 'Facturado' ? 'b-fac' : 'b-ent';
    var badge2 = est2 === 'Abierto' ? 'b-abierto' : est2 === 'Alistado' ? 'b-alistado' : est2 === 'Cerrado' ? 'b-cerrado' : est2 === 'Bloqueado por cartera' ? 'b-bloqueado' : est2 === 'Entregado por proveedor' ? 'b-entregado-prov' : 'b-anulado';
    var done = est === 'Entregado' || est === 'Alistado';
    var idx = consecs.indexOf(c);
    var rowKey = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
    var modPend = isPedidoModificadoPendiente(rowKey, c._ModTs);
    var trClass = modPend ? ' class="row-modificada"' : '';
    var modBadge = '';
    if (modPend) {
      var tipo = c._ModTipo || 'ambos';
      var modLabel = tipo === 'linea_nueva' ? 'NUEVO' : tipo === 'cantidad' ? 'CANT.' : 'MOD.';
      var modTitle = tipo === 'linea_nueva'
        ? 'Se agregó una línea nueva a este pedido — clic para descartar'
        : tipo === 'cantidad'
          ? 'Se modificó la cantidad pedida — clic para descartar'
          : 'Se modificó cantidad y se agregaron líneas — clic para descartar';
      var keyAttr = rowKey.replace(/"/g, '&quot;').replace(/'/g, "\\'");
      var tsAttr = String(c._ModTs).replace(/'/g, "\\'");
      modBadge = '<span class="mod-badge" title="' + modTitle + '" onclick="dismissPedidoModificado(\'' + keyAttr + '\', \'' + tsAttr + '\', event)">✏️ ' + modLabel + '</span>';
    }
    var solList = solicitudesCompraPorPedido[_keySC(c.Nombre_Empresa, c.Consecutivo)] || [];
    var solBadge = '';
    if (solList.length > 0) {
      var solTitle = solList.length === 1
        ? '1 solicitud de compra pendiente — legalizar la OC en Órdenes para poder emitir la remisión'
        : solList.length + ' solicitudes de compra pendientes — legalizar las OC en Órdenes para poder emitir la remisión';
      solBadge = '<span class="sol-badge" title="' + solTitle + '">🛒 ' + solList.length + '</span>';
    }
    return '<tr' + trClass + '>' +
      '<td style="color:#718096;font-size:0.78rem">' + (c['N°']||'') + '</td>' +
      '<td title="' + (c.Nombre_Empresa||'') + '"><span class="sigla-badge ' + getSiglaClass(c.Nombre_Empresa) + '">' + getSigla(c.Nombre_Empresa) + '</span></td>' +
      '<td style="text-align:center;font-weight:700">' + (c.Consecutivo||'') + modBadge + solBadge + '<span class="adjunto-badge-cell" data-adj-key="' + getSigla(c.Nombre_Empresa) + '_' + c.Consecutivo + '_' + sanitizeForPath(c.Cliente) + '"></span></td>' +
      '<td style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (c.Cliente||'') + '">' + (c.Cliente||'—') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(c.Fecha_Pedido) + '</td>' +
      (function() {
        if (!_mostrarDias(c)) return '<td style="text-align:center;color:#cbd5e0">—</td>';
        var d = _diasDesdePedido(c.Fecha_Pedido);
        if (d == null) return '<td style="text-align:center;color:#cbd5e0">—</td>';
        // Semaforo: <=3 verde, 4-7 amarillo, >7 rojo. Solo pinta si es pertinente.
        var bg = d <= 3 ? '#dcfce7' : d <= 7 ? '#fef3c7' : '#fee2e2';
        var fg = d <= 3 ? '#166534' : d <= 7 ? '#92400e' : '#991b1b';
        var title = 'Días hábiles transcurridos desde la fecha del pedido';
        return '<td style="text-align:center"><span title="' + title + '" style="background:' + bg + ';color:' + fg + ';padding:2px 9px;border-radius:12px;font-size:0.78rem;font-weight:700">' + d + ' dh</span></td>';
      })() +
      '<td style="font-size:0.78rem">' + (c.Comercial||'—') + '</td>' +
      '<td style="font-size:0.78rem;white-space:nowrap">' + (c.Municipio||'—') + '</td>' +
      '<td class="money">' + fmtMoney(c.Total_Orden) + '</td>' +
      '<td style="text-align:center">' +
        (lines.length ? '<span style="background:#e8f4fb;color:#1a5276;padding:2px 9px;border-radius:12px;font-size:0.75rem;font-weight:700">' + lines.length + '</span>' : '<span class="tag-sin">—</span>') +
      '</td>' +
      '<td><div class="prog"><div class="prog-bar"><div class="prog-fill" style="width:' + pct + '%"></div></div><div class="prog-pct">' + pct + '%</div></div></td>' +
      '<td><span class="badge ' + badge + '">' + est + '</span></td>' +
      '<td><span class="badge ' + badge2 + '">' + est2 + '</span></td>' +
      '<td><div style="display:flex;gap:6px;align-items:center">' +
        '<button class="btn-ver ' + (done?'done':'') + '" onclick="openDetail(' + idx + ')">' +
          (lines.length === 0 ? '👁 Ver' : done ? '✓ Entregado' : '📦 Ver pedido') +
        '</button>' +
        (AUTH.canEdit() ? '<button class="btn-edit" onclick="openEdit(' + idx + ')" title="Editar pedido">✏️</button>' : '') +
        (AUTH.canDelete() ? '<button class="btn-del" onclick="openDelete(' + idx + ')" title="Eliminar pedido">🗑️</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');

  renderPagination(totalRows);
  updateAdjuntosBadges();

  var detPanel = document.getElementById('panel-detalle');
  if (detPanel && detPanel.style.display !== 'none') renderDetalle();
}

// ── Detail Modal ──
async function openDetail(idx) {
  activeIdx = idx;
  var c = consecs[idx];
  var lines = getLinesFor(c);

  // Cargar snapshot de existencias para poblar los selectores de empresa origen.
  // No bloqueamos la apertura si falla; simplemente el selector queda vacío.
  var _acP = [];
  if (!productosCache) _acP.push(apiGet('getMaestroProductos').then(function(r) { if (r.ok) productosCache = r.productos || []; }).catch(function() { productosCache = []; }));
  if (!listaPreciosCache) _acP.push(apiGet('getListaPrecios').then(function(r) { if (r.ok) listaPreciosCache = r.precios || []; }).catch(function() { listaPreciosCache = []; }));
  try { existSnapshot = await Existencias.loadSnapshot(); }
  catch (e) { existSnapshot = null; console.warn('No se pudo cargar existencias:', e); }
  if (_acP.length) await Promise.all(_acP);
  _mergePreciosEmbedded();

  // Cargar datos de factura de entregas existentes (por remisión).
  var _facturaMap = {};
  try {
    var lineIds = lines.map(function(l) { return l.__row; }).filter(Boolean);
    if (lineIds.length) {
      var epRes = await _sb.from('EntregasPedido').select('pedido_id,remision,num_factura,fecha_factura').in('pedido_id', lineIds);
      if (epRes.data) epRes.data.forEach(function(r) {
        if ((r.num_factura || '').trim() || (r.fecha_factura || '').trim()) {
          _facturaMap[r.remision] = { num_factura: r.num_factura || '', fecha_factura: r.fecha_factura || '' };
        }
      });
    }
  } catch (e) { console.warn('No se pudo cargar factura de entregas:', e); }
  window._facturaMapDetail = _facturaMap;

  document.getElementById('m-titulo').textContent = '[' + getSigla(c.Nombre_Empresa) + '] ' + (c.Nombre_Empresa||'—') + ' · Orden #' + (c.Consecutivo||'');
  document.getElementById('md-cliente').value = c.Cliente || '';
  document.getElementById('md-nit').value = c.NIT || '';
  document.getElementById('md-fecha-pedido').value = toDateInput(c.Fecha_Pedido);
  document.getElementById('md-comercial').value = c.Comercial || '';
  document.getElementById('md-municipio').value = c.Municipio || '';
  document.getElementById('md-departamento').value = c.Departamento || '';
  document.getElementById('md-telefono').value = c.Telefono || '';
  document.getElementById('md-direccion').value = c.Direccion_Envio || '';
  document.getElementById('md-plazo').value = c.Plazo_Pago || '';
  document.getElementById('md-precio').value = c.Precio_Facturacion || '';
  document.getElementById('md-facturar-a').value = c.Facturar_A || c.Cliente || '';
  document.getElementById('md-nit-adicional').value = c.NIT_Adicional || '';
  _populateSucursalDL(c.Cliente);
  document.getElementById('md-sucursal').value = c.Sucursal || '';
  document.getElementById('md-consignacion').value = c.Consignacion || 'No';
  document.getElementById('md-bodega-facturacion').value = _normBodegaFacturacion(c.Bodega_Facturacion || '');
  _toggleBodegaField('md', c.Nombre_Empresa);
  document.getElementById('md-estado2').value = derivedEstado2(lines);
  document.getElementById('m-total').textContent = fmtMoney(c.Total_Orden);
  var obsText = c.Observaciones || lines.reduce(function(a, l) { return a || l.Observaciones; }, '') || '';
  document.getElementById('m-observaciones').value = obsText ? String(obsText).trim() : '';
  renderSolicitudesCompraSection(c);
  document.getElementById('m-fecha').value = today();
  document.getElementById('m-remision').value = '';
  document.getElementById('m-remision').classList.remove('error');
  var _elPR = document.getElementById('m-remision');
  _elPR.readOnly = true; _elPR.style.background = '#f0f4f8'; _elPR.placeholder = '(Auto al guardar)';
  var _chkPR = document.getElementById('m-remision-auto'); if (_chkPR) _chkPR.checked = true;
  document.getElementById('btn-confirmar').disabled = false;
  document.getElementById('btn-confirmar').textContent = '✓ Guardar cambios';

  detailWorkingLines = lines.map(function(l) {
    var copy = Object.assign({}, l);
    copy._entregas = parseEntregas(l.Remisiones, Number(l.Cant_Entregada) || 0, l.Fecha_Ult_Entrega);
    copy._asignaciones = []; // { empresa_stock, cantidad } — pendientes de guardar
    return copy;
  });

  var tbody = document.getElementById('m-lines');
  if (!lines.length) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="no-lines">⚠ Esta orden no tiene líneas de producto registradas.</div></td></tr>';
  } else {
    var orderStatus = derivedStatus(detailWorkingLines);
    var orderEntregado = orderStatus === 'Entregado' || orderStatus === 'Facturado';
    tbody.innerHTML = detailWorkingLines.map(function(l, i) {
      var pedida = Number(l.Cantidad)||0;
      var entregada = Number(l.Cant_Entregada)||0;
      var pendiente = Math.max(0, pedida - entregada);
      var rawEst = (l.Estado_Entrega || '').trim();
      var estL = (!rawEst || norm(rawEst) === 'recibido') ? (entregada > 0 ? 'Parcial' : 'Recibido') : rawEst;
      var badgeL = norm(estL) === 'recibido' ? 'b-rec' : norm(estL) === 'parcial' ? 'b-par' : norm(estL) === 'alistado' ? 'b-alistado' : norm(estL) === 'facturado' ? 'b-fac' : 'b-ent';
      var done = norm(estL) === 'entregado' || norm(estL) === 'alistado';
      var lockEntregado = norm(rawEst) === 'entregado' && !AUTH.isAdmin();
      var lockCant = !AUTH.hasModule('pedidos_editar_cantidad');
      var lockAttr = lockEntregado ? ' disabled' : '';
      var lockStyle = lockEntregado ? ';background:#f7fafc;opacity:0.7' : '';
      var prodNombre = l.Producto || '';
      var textoTieneBonif = /bonificado/i.test(prodNombre);
      var prodLimpio = textoTieneBonif ? prodNombre.replace(/\s*bonificado\s*/gi, ' ').trim() : prodNombre;
      var vUnit = Number(l.Valor_Unitario) || 0;
      var bonif = (l.Bonificado || '').trim();
      var esBonif = bonif === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
      var prodEsc = prodLimpio.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      var presEsc = (l.Presentacion||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      var lockBadge = lockEntregado ? '<div style="font-size:0.68rem;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;padding:2px 6px;border-radius:4px;margin-top:2px;font-weight:600">🔒 Solo administrador puede modificar</div>' : '';
      return '<tr>' +
        '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
        '<td class="sticky-prod"><input class="ef md-prod" data-i="' + i + '" type="text" value="' + prodEsc + '" style="min-width:260px;font-weight:700' + lockStyle + '"' + lockAttr + '></td>' +
        '<td><input class="ef md-pres" data-i="' + i + '" type="text" value="' + presEsc + '" style="width:90px' + lockStyle + '"' + lockAttr + '></td>' +
        '<td style="text-align:center">' + (esBonif ? '<span style="background:#d5f5e3;color:#1e8449;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:700">Sí</span>' : '<span style="color:#718096;font-size:0.75rem">No</span>') + '</td>' +
        '<td><input class="ef md-cant" data-i="' + i + '" type="number" min="0" value="' + pedida + '" style="width:70px;text-align:right' + (lockEntregado || lockCant ? ';background:#f7fafc;opacity:0.7' : '') + '"' + (lockEntregado || lockCant ? ' disabled' : '') + (lockEntregado || lockCant ? '' : ' oninput="updateDetailLine(' + i + ')"') + '></td>' +
        '<td><input class="ef md-ent" data-i="' + i + '" type="number" value="' + entregada + '" style="width:70px;text-align:right;color:#27ae60;font-weight:700;background:#f0fff4" readonly tabindex="-1"></td>' +
        '<td class="money"><span class="pend-tag ' + (pendiente > 0 ? 'pend' : 'ok') + '" id="md-pend-' + i + '">' + pendiente + '</span></td>' +
        '<td style="min-width:280px"><span class="badge ' + badgeL + '">' + estL + '</span>' + lockBadge +
          '<div class="entregas-wrap" data-i="' + i + '">' + renderEntregasHTML(i, l._entregas || []) + '</div>' +
        '</td>' +
        '<td><input class="ef md-vuni" data-i="' + i + '" type="number" min="0" value="' + vUnit + '" style="width:90px;text-align:right' + lockStyle + '"' + lockAttr + (lockEntregado ? '' : ' oninput="updateDetailLine(' + i + ')"') + '></td>' +
        '<td class="money" style="font-size:0.78rem" id="md-vtot-' + i + '">' + fmtMoney(l.Valor_Total) + '</td>' +
        '<td data-row="' + l.__row + '" data-idx="' + i + '" style="min-width:220px">' + renderAsignacionCell(i, l, c.Nombre_Empresa) + '</td>' +
        '<td style="text-align:center">' +
          (orderEntregado || lockEntregado
            ? ''
            : entregada > 0
              ? '<span style="font-size:0.85rem;color:#a0aec0" title="Tiene entregas registradas — no se puede eliminar">🔒</span>'
              : '<button onclick="removeDetailLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700" title="Eliminar línea">✕</button>') +
        '</td>' +
      '</tr>';
    }).join('');
  }

  resetNewLineForm();
  if (nlProdAC) { nlProdAC.destroy(); nlProdAC = null; }
  var nlProd = document.getElementById('nl-producto');
  if (productosCache) {
    nlProdAC = initAutocomplete(nlProd, {
      items: function() {
        var emp = c.Nombre_Empresa;
        var prods = productosCache || [];
        if (emp) prods = prods.filter(function(p) { return !p.empresa || p.empresa === emp; });
        return prods;
      },
      display: function(p) {
        return '<strong>' + escHtml(p.producto) + '</strong>' +
               (p.presentacion ? ' <span class="ac-sub">— ' + escHtml(p.presentacion) + '</span>' : '');
      },
      match: function(p, val) {
        return ((p.producto||'') + ' ' + (p.presentacion||'')).toLowerCase().indexOf(val) >= 0;
      },
      onSelect: function(p) {
        nlProd.value = p.producto || '';
        var nlPres = document.getElementById('nl-presentacion');
        if (nlPres) nlPres.value = p.presentacion || '';
        var nlBonif = document.getElementById('nl-bonificado');
        if (nlBonif && nlBonif.checked) {
          document.getElementById('nl-vunitario').value = 1;
          calcNewLineTotal();
        } else {
          var precio = _lookupPrecio(c.Nombre_Empresa, document.getElementById('md-precio').value.trim(), p.producto);
          if (precio !== null) {
            document.getElementById('nl-vunitario').value = precio;
            calcNewLineTotal();
          }
        }
      }
    });
  }
  nlProd.onblur = function() {
    var prod = nlProd.value.trim();
    if (!prod || activeIdx === null) return;
    var cDet = consecs[activeIdx];
    var nlPres = document.getElementById('nl-presentacion');
    if (nlPres && !nlPres.value.trim()) {
      var pres = _autoFillPresentacion(prod, cDet.Nombre_Empresa);
      if (pres) nlPres.value = pres;
    }
    var precio = _lookupPrecio(cDet.Nombre_Empresa, document.getElementById('md-precio').value.trim(), prod);
    if (precio !== null) {
      document.getElementById('nl-vunitario').value = precio;
      calcNewLineTotal();
    }
  };
  renderFacturaRemisiones();
  document.getElementById('overlay').classList.add('show');
  destroyGeoAC('md');
  geoACs.md = setupGeoAutocomplete(
    document.getElementById('md-departamento'),
    document.getElementById('md-municipio')
  );
  loadAdjuntos(c.Nombre_Empresa, c.Consecutivo, c.Cliente);

  if (typeof NOTIF !== 'undefined' && NOTIF.verificarBtn) {
    var _sigP = (typeof getSigla === 'function' ? getSigla(c.Nombre_Empresa) : '') || '';
    var _btnPed = document.querySelector('#overlay button[onclick*="exportarPedidoDesdeModal"]');
    if (_btnPed) {
      var _refPed = (_sigP ? _sigP + ' ' : '') + (c.Consecutivo || '');
      NOTIF.verificarBtn(_btnPed, 'pedidos', _refPed);
      if (!_btnPed.disabled) { _btnPed.textContent = '📨 Enviar Pedido'; _btnPed.title = 'Enviar el PDF del pedido a otro usuario del panel'; }
    }
    var _btnRem = document.getElementById('btn-export-rem-share');
    if (_btnRem) {
      _btnRem.disabled = false; _btnRem.style.opacity = ''; _btnRem.style.cursor = '';
      _btnRem.textContent = '📨 Enviar Remisión ▾';
      _btnRem.title = 'Enviar remisión a otro usuario del panel';
    }
  }
}

function closeModal() {
  document.getElementById('overlay').classList.remove('show');
  activeIdx = null;
  if (nlProdAC) { nlProdAC.destroy(); nlProdAC = null; }
  destroyGeoAC('md');
  if (typeof closeRemPicker === 'function') closeRemPicker();
  if (typeof closeFmtPickers === 'function') closeFmtPickers();
}

document.getElementById('overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeModal(); });

// ── Detail line helpers ──
function updateDetailLine(i) {
  var dl = detailWorkingLines[i];
  if (dl && norm(dl.Estado_Entrega || '') === 'entregado' && !AUTH.isAdmin()) return;
  if (!AUTH.hasModule('pedidos_editar_cantidad')) return;
  var cants = document.querySelectorAll('.md-cant');
  var vunis = document.querySelectorAll('.md-vuni');
  var ents = document.querySelectorAll('.md-ent');
  var cant = parseFloat(cants[i] && cants[i].value) || 0;
  var vuni = parseFloat(vunis[i] && vunis[i].value) || 0;
  var entregada = parseFloat(ents[i] && ents[i].value) || 0;
  if (ents[i]) {
    ents[i].max = cant;
    if (entregada > cant) {
      entregada = cant;
      ents[i].value = cant;
      ents[i].classList.add('error');
      showToast('La cantidad entregada no puede superar la pedida (' + cant + ')', '#e74c3c');
    } else {
      ents[i].classList.remove('error');
    }
  }
  var vtot = cant * vuni;
  var vtotEl = document.getElementById('md-vtot-' + i);
  if (vtotEl) vtotEl.textContent = fmtMoney(vtot);
  if (detailWorkingLines[i]) {
    detailWorkingLines[i].Cantidad = cant;
    detailWorkingLines[i].Valor_Unitario = vuni;
    detailWorkingLines[i].Valor_Total = vtot;
    detailWorkingLines[i].Cant_Entregada = entregada;
  }
  var pendiente = Math.max(0, cant - entregada);
  var pendEl = document.getElementById('md-pend-' + i);
  if (pendEl) {
    pendEl.textContent = pendiente;
    pendEl.className = 'pend-tag ' + (pendiente > 0 ? 'pend' : 'ok');
  }
  // Re-render de la celda de asignación: si el pendiente pasó a 0
  // se oculta el selector; si aumentó, vuelve a aparecer.
  if (typeof refreshAsignacionCell === 'function') refreshAsignacionCell(i);
  updateDetailTotal();
}

function updateDeliveryMax(i) {
  var qtyInput = document.querySelectorAll('.qty-input')[i];
  if (!qtyInput || !detailWorkingLines[i]) return;
  var cants = document.querySelectorAll('.md-cant');
  var ents = document.querySelectorAll('.md-ent');
  var cant = parseFloat(cants[i] && cants[i].value) || 0;
  var entregada = parseFloat(ents[i] && ents[i].value) || 0;
  var pendiente = Math.max(0, cant - entregada);
  var val = Number(qtyInput.value) || 0;
  if (val > pendiente) {
    qtyInput.value = pendiente;
    qtyInput.classList.add('error');
  } else {
    qtyInput.classList.remove('error');
  }
}

function updateDetailTotal() {
  var total = detailWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0);
  document.getElementById('m-total').textContent = fmtMoney(total);
}

function parseEntregas(remStr, cantTotal, fechaUlt) {
  if (!remStr || !remStr.trim()) {
    if (cantTotal > 0) return [{ remision: '', cantidad: cantTotal, fecha: fechaUlt ? toDateInput(fechaUlt) : '' }];
    return [];
  }
  var parts = remStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var hasStructured = parts.some(function(p) { return p.indexOf('|') >= 0; });
  if (hasStructured) {
    var fallbackFecha = fechaUlt ? toDateInput(fechaUlt) : '';
    return parts.map(function(p) {
      var segs = p.split('|');
      return { remision: segs[0] || '', cantidad: Number(segs[1]) || 0, fecha: segs[2] || fallbackFecha };
    });
  }
  if (cantTotal > 0) {
    return [{ remision: remStr, cantidad: cantTotal, fecha: fechaUlt ? toDateInput(fechaUlt) : '' }];
  }
  return [];
}

function formatEntregas(entries) {
  var valid = entries.filter(function(e) { return (e.cantidad > 0) || e.remision; });
  if (!valid.length) return '';
  return valid.map(function(e) {
    return (e.remision || '') + '|' + (e.cantidad || 0) + '|' + (e.fecha || '');
  }).join(',');
}

function renderEntregasHTML(lineIdx, entregas) {
  if (!entregas.length) return '';
  var fmap = window._facturaMapDetail || {};
  var html = '';
  html += entregas.map(function(e, ei) {
    var fechaFmt = e.fecha ? formatDateShort(e.fecha) : '';
    var remTxt = e.remision || '';
    var cantTxt = e.cantidad || 0;
    var parts = [];
    if (cantTxt) parts.push('<strong>' + cantTxt + '</strong> ud');
    if (remTxt) parts.push('Rem: ' + remTxt.replace(/</g,'&lt;'));
    if (fechaFmt) parts.push(fechaFmt);
    var facData = remTxt ? (fmap[remTxt] || {}) : {};
    var nf = facData.num_factura || '';
    var ff = facData.fecha_factura || '';
    if (nf && ff) parts.push('<span style="color:#3730a3;font-weight:700">Fac: ' + nf.replace(/</g,'&lt;') + '</span>');
    return '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;font-size:0.7rem;color:#4a5568;background:#f7fafc;padding:2px 6px;border-radius:4px;border:1px solid #e2e8f0">' +
      '<span style="flex:1">' + parts.join(' · ') + '</span>' +
      '<button onclick="removeEntrega(' + lineIdx + ',' + ei + ')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:0.72rem;padding:0 2px;line-height:1" title="Eliminar entrega">✕</button>' +
    '</div>';
  }).join('');
  return html;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return dateStr;
}

function renderEntregasUI(lineIdx) {
  var wrap = document.querySelector('.entregas-wrap[data-i="' + lineIdx + '"]');
  if (!wrap) return;
  wrap.innerHTML = renderEntregasHTML(lineIdx, detailWorkingLines[lineIdx]._entregas || []);
}

function renderFacturaRemisiones() {
  var section = document.getElementById('factura-remisiones-section');
  var list = document.getElementById('factura-remisiones-list');
  if (!section || !list) return;
  var fmap = window._facturaMapDetail || {};
  // Recopilar remisiones únicas de todas las líneas
  var remisiones = {};
  detailWorkingLines.forEach(function(l) {
    (l._entregas || []).forEach(function(e) {
      var rem = (e.remision || '').trim();
      if (!rem) return;
      if (!remisiones[rem]) {
        remisiones[rem] = { remision: rem, fecha: e.fecha || '', productos: [] };
      }
      remisiones[rem].productos.push((l.Producto || '') + (e.cantidad ? ' (' + e.cantidad + ')' : ''));
    });
  });
  var keys = Object.keys(remisiones);
  if (!keys.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = keys.map(function(rem, ri) {
    var r = remisiones[rem];
    var fac = fmap[rem] || {};
    var nf = fac.num_factura || '';
    var ff = fac.fecha_factura || '';
    var fechaFmt = r.fecha ? formatDateShort(r.fecha) : '';
    var prodsText = r.productos.join(', ');
    var facturado = nf && ff;
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;background:' + (facturado ? '#eef2ff' : '#f7fafc') + ';border:1px solid ' + (facturado ? '#c7d2fe' : '#e2e8f0') + ';border-radius:6px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:200px">' +
        '<div style="font-weight:700;font-size:0.8rem;color:#1a5276">Rem: ' + rem.replace(/</g,'&lt;') + (fechaFmt ? ' <span style="font-weight:400;color:#718096">· ' + fechaFmt + '</span>' : '') + '</div>' +
        '<div style="font-size:0.7rem;color:#718096;margin-top:2px">' + prodsText.replace(/</g,'&lt;') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<label style="font-size:0.72rem;color:#4a5568;font-weight:600;white-space:nowrap">N° Factura</label>' +
        '<input type="text" class="fac-rem-num" data-rem="' + rem.replace(/"/g,'&quot;') + '" value="' + nf.replace(/"/g,'&quot;') + '" placeholder="Ej: FAC-001" style="width:120px;font-size:0.78rem;padding:4px 8px;border:1px solid #d1d5db;border-radius:5px" onchange="onFacturaSeccionChange(this)">' +
        '<label style="font-size:0.72rem;color:#4a5568;font-weight:600;white-space:nowrap">Fecha</label>' +
        '<input type="date" class="fac-rem-fecha" data-rem="' + rem.replace(/"/g,'&quot;') + '" value="' + ff + '" style="width:140px;font-size:0.78rem;padding:4px 8px;border:1px solid #d1d5db;border-radius:5px" onchange="onFacturaSeccionChange(this)">' +
        (facturado ? '<span style="color:#3730a3;font-weight:700;font-size:1rem" title="Facturado">✓</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function onFacturaSeccionChange(el) {
  var rem = el.dataset.rem;
  if (!rem) return;
  var numEl = document.querySelector('.fac-rem-num[data-rem="' + CSS.escape(rem) + '"]');
  var fechaEl = document.querySelector('.fac-rem-fecha[data-rem="' + CSS.escape(rem) + '"]');
  var nf = numEl ? numEl.value.trim() : '';
  var ff = fechaEl ? fechaEl.value.trim() : '';
  var fmap = window._facturaMapDetail || {};
  fmap[rem] = { num_factura: nf, fecha_factura: ff };
  window._facturaMapDetail = fmap;
  // Propagar a _entregas
  detailWorkingLines.forEach(function(l) {
    (l._entregas || []).forEach(function(e) {
      if ((e.remision || '').trim() === rem) {
        e._num_factura = nf;
        e._fecha_factura = ff;
      }
    });
  });
  // Re-render chips para mostrar/ocultar indicador de factura
  detailWorkingLines.forEach(function(l, li) { renderEntregasUI(li); });
  // Re-render la sección para mostrar/ocultar ✓
  renderFacturaRemisiones();
  // Guardar en EntregasPedido y actualizar estados
  _guardarFacturaRemision(rem, nf, ff);
}

async function _guardarFacturaRemision(remision, numFactura, fechaFactura) {
  try {
    var lineIds = detailWorkingLines.map(function(l) { return l.__row; }).filter(Boolean);
    if (!lineIds.length) return;
    await _sb.from('EntregasPedido').update({ num_factura: numFactura, fecha_factura: fechaFactura }).eq('remision', remision).in('pedido_id', lineIds);
    for (var i = 0; i < detailWorkingLines.length; i++) {
      var dl = detailWorkingLines[i];
      if (!dl._entregas || !dl._entregas.length) continue;
      var tieneEntregas = dl._entregas.some(function(e) { return (e.remision || '').trim(); });
      if (!tieneEntregas) continue;
      var todasFacturadas = dl._entregas.every(function(e) {
        if (!(e.remision || '').trim()) return true;
        return (e._num_factura || '').trim() !== '' && (e._fecha_factura || '').trim() !== '';
      });
      var estadoActual = norm(dl.Estado_Entrega);
      if (todasFacturadas && (estadoActual === 'entregado' || estadoActual === 'alistado')) {
        dl.Estado_Entrega = 'Facturado';
        await _sb.from('Pedidos').update({ Estado_Entrega: 'Facturado', modificado_por: _uid() }).eq('id', dl.__row);
      } else if (!todasFacturadas && estadoActual === 'facturado') {
        var todasRem = dl._entregas.every(function(e) { return (e.remision || '').trim() !== ''; });
        dl.Estado_Entrega = todasRem ? 'Entregado' : 'Alistado';
        await _sb.from('Pedidos').update({ Estado_Entrega: dl.Estado_Entrega, modificado_por: _uid() }).eq('id', dl.__row);
      }
      // Refresh badge
      var badgeEl = document.querySelector('#m-lines tr:nth-child(' + (i+1) + ') .badge');
      if (badgeEl) {
        var est = (dl.Estado_Entrega || '').trim();
        badgeEl.textContent = est;
        badgeEl.className = 'badge ' + (norm(est) === 'recibido' ? 'b-rec' : norm(est) === 'parcial' ? 'b-par' : norm(est) === 'alistado' ? 'b-alistado' : norm(est) === 'facturado' ? 'b-fac' : 'b-ent');
      }
    }
  } catch (e) {
    console.error('Error guardando factura:', e);
    showToast('Error al guardar factura: ' + e.message, '#e74c3c');
  }
}

// ── Asignación de existencias a la entrega ────────────────
// Renderiza la celda que reemplaza al viejo qty-input libre.
// Muestra un selector de empresa origen (con las existencias
// disponibles para el producto/presentación de la línea) + input
// cantidad + botón añadir, y una lista de chips con las
// asignaciones ya cargadas (aún no persistidas).
function renderAsignacionCell(i, l, empresaPedido) {
  // Si la línea no tiene pendiente (Cant_Entregada ≥ Cantidad) no se
  // permite asignar más stock. Se muestra un aviso en lugar del
  // selector. Se sigue reservando un contenedor de chips vacío para
  // que refreshAsignacionCell/renderAsignacionChips no fallen.
  var pedida = Number(l.Cantidad) || 0;
  var yaEntregada = Number(l.Cant_Entregada) || 0;
  var pendienteBase = Math.max(0, pedida - yaEntregada);
  if (pendienteBase <= 0) {
    return '<div style="font-size:0.72rem;color:#276749;background:#f0fff4;border:1px solid #9ae6b4;padding:4px 8px;border-radius:4px;font-weight:700">' +
             '✓ Línea entregada — sin pendiente por asignar' +
           '</div>' +
           '<div class="asig-chips" data-i="' + i + '" style="margin-top:4px"></div>';
  }

  var prodStock = _normProdSel(l.Producto);
  var opciones = '';
  if (existSnapshot && typeof Existencias !== 'undefined') {
    var lista = Existencias.getPorEmpresa(existSnapshot, prodStock, l.Presentacion);
    // Ordenar: primero la empresa del pedido si tiene stock
    lista.sort(function(a, b) {
      var aEsPedido = norm(a.empresa) === norm(empresaPedido) ? 0 : 1;
      var bEsPedido = norm(b.empresa) === norm(empresaPedido) ? 0 : 1;
      if (aEsPedido !== bEsPedido) return aEsPedido - bEsPedido;
      return a.sigla.localeCompare(b.sigla, 'es');
    });
    opciones = lista.map(function(x) {
      var marca = norm(x.empresa) === norm(empresaPedido) ? ' ★' : '';
      var dispRaw = Math.round(x.disponible * 100) / 100;
      // Ajuste por sesión: restar lo ya asignado a esa (empresa,
      // producto) en TODAS las líneas del pedido, para que dos líneas
      // del mismo producto no puedan sobregirar el mismo pool.
      var yaSesion = _asignadoEnSesion(x.empresa, prodStock);
      var dispRest = Math.max(0, dispRaw - yaSesion);
      var etiqueta = (yaSesion > 0)
        ? x.sigla + marca + ' · ' + dispRest + ' disp. (base ' + dispRaw + ')'
        : x.sigla + marca + ' · ' + dispRest + ' disp.';
      return '<option value="' + x.empresa.replace(/"/g,'&quot;') + '" data-disp="' + dispRaw + '">' +
        etiqueta + '</option>';
    }).join('');
  }
  var selectHTML = opciones
    ? '<select class="asig-empresa" data-i="' + i + '" onchange="onAsignEmpresaChange(' + i + ')" style="width:100%;font-size:0.75rem;padding:2px 4px">' +
        '<option value="">— Empresa origen —</option>' + opciones +
      '</select>'
    : '<div style="font-size:0.72rem;color:#a94442;background:#fdecea;border:1px solid #f5c2c0;padding:2px 6px;border-radius:4px">Sin stock disponible</div>';
  var refBar = '<div class="asig-ref-bar" style="display:flex;gap:8px;font-size:0.70rem;margin-bottom:4px;padding:2px 6px;background:#eef6fc;border-radius:4px;color:#1a5276;font-weight:600">' +
    '<span>Pedida: <b>' + pedida + '</b></span>' +
    '<span style="color:#b0bec5">|</span>' +
    '<span>Pend: <b style="color:' + (pendienteBase > 0 ? '#e67e22' : '#27ae60') + '">' + pendienteBase + '</b></span>' +
  '</div>';
  return refBar + selectHTML +
    '<div style="display:flex;gap:4px;margin-top:3px">' +
      '<input type="number" class="asig-cant" data-i="' + i + '" min="0" step="1" placeholder="0" style="width:60px;font-size:0.75rem;padding:2px 4px;text-align:right" oninput="validateAsignCant(' + i + ')">' +
      '<button type="button" onclick="addAsignacion(' + i + ')" ' +
        'style="background:#3498db;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:0.75rem;font-weight:700;cursor:pointer">+ Añadir</button>' +
    '</div>' +
    '<div class="asig-chips" data-i="' + i + '" style="margin-top:4px"></div>';
}

// Re-renderiza la celda de asignación (por ejemplo cuando cambia la
// cantidad pedida y ahora hay o deja de haber pendiente). Preserva
// las asignaciones ya cargadas en memoria (dl._asignaciones).
function refreshAsignacionCell(i) {
  if (activeIdx == null) return;
  var td = document.querySelector('#m-lines td[data-idx="' + i + '"]');
  if (!td) return;
  var c = consecs[activeIdx];
  var l = detailWorkingLines[i];
  if (!c || !l) return;
  td.innerHTML = renderAsignacionCell(i, l, c.Nombre_Empresa);
  renderAsignacionChips(i);
}

// Máximo asignable ahora mismo para la línea i:
// mínimo entre lo pendiente por entregar y lo disponible libre
// en la empresa seleccionada. Devuelve null si aún no hay empresa
// seleccionada (no se puede acotar el tope).
function _maxAsignable(i) {
  var sel = document.querySelector('.asig-empresa[data-i="' + i + '"]');
  if (!sel || !sel.value) return null;
  var dl = detailWorkingLines[i];
  if (!dl) return null;
  var disp = Number(sel.selectedOptions[0] && sel.selectedOptions[0].dataset.disp) || 0;
  var pendiente = _pendienteRestante(i);
  var yaEnSesion = _asignadoEnSesion(sel.value, dl.Producto, i);
  var libre = Math.max(0, disp - yaEnSesion);
  return Math.min(pendiente, libre);
}

function onAsignEmpresaChange(i) {
  // Ajusta el placeholder + revalida el input actual al cambiar la empresa.
  var inp = document.querySelector('.asig-cant[data-i="' + i + '"]');
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
  validateAsignCant(i);
}

// Validación en vivo mientras el usuario tipea la cantidad.
// Estrategia:
//   • Sin empresa seleccionada → borde rojo + tooltip explicativo,
//     no se puede clampear porque no conocemos el tope.
//   • Con empresa seleccionada → si el valor supera el tope
//     (min pendiente, disponible libre), se recorta al tope al
//     instante y se avisa mediante un tooltip persistente.
function validateAsignCant(i, _skipPropagate) {
  var inp = document.querySelector('.asig-cant[data-i="' + i + '"]');
  var sel = document.querySelector('.asig-empresa[data-i="' + i + '"]');
  if (!inp) return;
  var cant = Number(inp.value) || 0;
  if (cant <= 0) {
    inp.classList.remove('error');
    inp.title = '';
    if (!_skipPropagate) _propagateValidationSameProducto(i);
    return;
  }
  if (!sel || !sel.value) {
    inp.classList.add('error');
    inp.title = 'Selecciona primero la empresa origen';
    if (!_skipPropagate) _propagateValidationSameProducto(i);
    return;
  }
  var dl = detailWorkingLines[i];
  var pendiente = _pendienteRestante(i);
  var disp = Number(sel.selectedOptions[0] && sel.selectedOptions[0].dataset.disp) || 0;
  var yaEnSesion = dl ? _asignadoEnSesion(sel.value, dl.Producto, i) : 0;
  var libre = Math.max(0, disp - yaEnSesion);
  var tope = Math.min(pendiente, libre);

  if (cant > tope) {
    // Auto-clamp: no dejamos que el input tenga valores fuera de rango.
    inp.value = tope;
    inp.max = tope;
    var motivo = (tope === pendiente && pendiente <= libre)
      ? 'Ajustado al pendiente por entregar (' + pendiente + ')'
      : 'Ajustado al disponible en esa empresa (' + libre + ')';
    inp.title = motivo;
    // Marcamos el borde rojo brevemente como feedback visual del recorte,
    // luego lo quitamos para no confundir con un error persistente.
    inp.classList.add('error');
    clearTimeout(inp._clampTimer);
    inp._clampTimer = setTimeout(function() { inp.classList.remove('error'); }, 900);
    if (!_skipPropagate) _propagateValidationSameProducto(i);
    return;
  }
  inp.classList.remove('error');
  inp.title = '';
  if (!_skipPropagate) _propagateValidationSameProducto(i);
}

// Al cambiar el valor tipeado en la línea i, revalidamos las líneas
// hermanas que comparten producto: si el usuario tipea 100 en la
// línea A del mismo pool, la línea B del mismo producto tiene que
// recortarse al pool restante. Se marca con _skipPropagate=true para
// evitar recursión infinita.
function _propagateValidationSameProducto(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return;
  var prodN = _normProdSel(dl.Producto);
  (detailWorkingLines || []).forEach(function(other, j) {
    if (j === i || !other) return;
    if (_normProdSel(other.Producto) !== prodN) return;
    validateAsignCant(j, true);
  });
}

function _pendienteRestante(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return 0;
  var pedida = Number(dl.Cantidad) || 0;
  var yaEntregada = (dl._entregas || []).reduce(function(s, e) { return s + (e.cantidad || 0); }, 0);
  var yaAsignada = (dl._asignaciones || []).reduce(function(s, a) { return s + (a.cantidad || 0); }, 0);
  return Math.max(0, pedida - yaEntregada - yaAsignada);
}

// Normalización de producto compatible con Existencias._normProd
// (whitespace-collapse + trim, sin cambiar mayúsculas). Debe coincidir
// para que el "disponible por empresa/producto" del snapshot y las
// sumas de esta sesión hablen del mismo producto.
function _normProdSel(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*bonificado\s*/gi, ' ').replace(/\s+/g, ' ').trim(); }

// Suma en TODA la sesión (todas las líneas del pedido) las cantidades
// dirigidas a esa (empresa_stock, producto). Incluye:
//   • chips ya confirmados en cualquier línea (dl._asignaciones);
//   • valores tipeados aún sin confirmar en las OTRAS líneas
//     (input .asig-cant) — así, tan pronto como el usuario tipea 100
//     en la línea A, la línea B ya ve el pool restante recalculado
//     sin necesidad de que la línea A haga clic en "+ Añadir".
// excludeLineIdx: índice de la línea que se está validando (se
//   excluye del "typed" para no contarse a sí misma).
function _asignadoEnSesion(empresa, producto, excludeLineIdx) {
  var empN = norm(empresa);
  var prodN = _normProdSel(producto);
  var total = 0;
  (detailWorkingLines || []).forEach(function(dl, j) {
    if (!dl) return;
    if (_normProdSel(dl.Producto) !== prodN) return;
    // Chips confirmados (cuentan siempre, también en la propia línea
    // porque validamos una asignación NUEVA sobre el resto).
    if (dl._asignaciones) {
      dl._asignaciones.forEach(function(a) {
        if (norm(a.empresa_stock) === empN) total += (Number(a.cantidad) || 0);
      });
    }
    // Valor tipeado en otras líneas (aún sin +Añadir) — se cuenta
    // sólo si la empresa seleccionada en esa otra línea coincide.
    if (j !== excludeLineIdx) {
      var sel = document.querySelector('.asig-empresa[data-i="' + j + '"]');
      var inp = document.querySelector('.asig-cant[data-i="' + j + '"]');
      if (sel && inp && norm(sel.value) === empN) {
        var v = Number(inp.value) || 0;
        if (v > 0) total += v;
      }
    }
  });
  return total;
}

function addAsignacion(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return;
  var sel = document.querySelector('.asig-empresa[data-i="' + i + '"]');
  var inp = document.querySelector('.asig-cant[data-i="' + i + '"]');
  if (!sel || !inp) return;
  var empresa = sel.value;
  var cant = Number(inp.value) || 0;
  if (!empresa) { showToast('Selecciona la empresa origen', '#e67e22'); return; }
  if (cant <= 0) { showToast('Ingresa una cantidad mayor a 0', '#e67e22'); return; }

  // Reutiliza la validación en vivo. Si quedó en error, mostramos
  // el motivo (guardado en title) y bloqueamos.
  validateAsignCant(i);
  if (inp.classList.contains('error')) {
    showToast(inp.title || 'Cantidad inválida', '#e74c3c');
    return;
  }

  dl._asignaciones.push({ empresa_stock: empresa, cantidad: cant });
  inp.value = '';
  sel.selectedIndex = 0;
  inp.removeAttribute('max');
  inp.placeholder = '0';
  inp.classList.remove('error');
  inp.title = '';
  renderAsignacionChips(i);
  // Actualizar el "disp." mostrado en las líneas hermanas que
  // comparten producto (misma normalización), para que reflejen el
  // nuevo pool restante de esa empresa.
  _refreshSameProductoCells(i);
}

function removeAsignacion(i, k) {
  var dl = detailWorkingLines[i];
  if (!dl || !dl._asignaciones) return;
  dl._asignaciones.splice(k, 1);
  renderAsignacionChips(i);
  _refreshSameProductoCells(i);
}

// Re-renderiza las celdas de asignación de todas las líneas que
// comparten producto con la línea i (excepto la propia). Necesario
// tras agregar/quitar una asignación para que la etiqueta "disp."
// del dropdown refleje el pool disponible en esta sesión.
function _refreshSameProductoCells(i) {
  var dl = detailWorkingLines[i];
  if (!dl) return;
  var prodN = _normProdSel(dl.Producto);
  (detailWorkingLines || []).forEach(function(other, j) {
    if (j === i) return;
    if (!other) return;
    if (_normProdSel(other.Producto) !== prodN) return;
    if (typeof refreshAsignacionCell === 'function') refreshAsignacionCell(j);
  });
}

function renderAsignacionChips(i) {
  var wrap = document.querySelector('.asig-chips[data-i="' + i + '"]');
  if (!wrap) return;
  var dl = detailWorkingLines[i];
  var arr = (dl && dl._asignaciones) || [];
  if (!arr.length) { wrap.innerHTML = ''; return; }
  var c = consecs[activeIdx];
  var empPedido = c ? norm(c.Nombre_Empresa) : '';
  wrap.innerHTML = arr.map(function(a, k) {
    var sigla = getSigla(a.empresa_stock);
    var traslado = norm(a.empresa_stock) !== empPedido;
    var tag = traslado
      ? '<span title="Genera SOLO una solicitud de compra (OC de traslado, Estado Abierta). La remisión al cliente NO se emite ahora: primero hay que legalizar la OC en Órdenes para que el stock quede en la empresa del pedido." style="color:#c0392b;font-weight:700">🛒 solicitud de compra (remisión pendiente)</span>'
      : '<span style="color:#27ae60;font-weight:700">✓ mismo origen — genera remisión</span>';
    return '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;font-size:0.7rem;background:#eef5ff;padding:2px 6px;border-radius:4px;border:1px solid #cfe1ff">' +
      '<span style="flex:1"><strong>' + a.cantidad + '</strong> ud · ' + sigla + ' · ' + tag + '</span>' +
      '<button type="button" onclick="removeAsignacion(' + i + ',' + k + ')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:0.72rem;padding:0 2px" title="Quitar asignación">✕</button>' +
    '</div>';
  }).join('');
}

function syncEntregaTotal(lineIdx) {
  var entregas = detailWorkingLines[lineIdx]._entregas || [];
  var total = entregas.reduce(function(s, e) { return s + (e.cantidad || 0); }, 0);
  var entInput = document.querySelector('.md-ent[data-i="' + lineIdx + '"]');
  if (entInput) entInput.value = total;
  detailWorkingLines[lineIdx].Cant_Entregada = total;
  updateDetailLine(lineIdx);
}

function removeEntrega(lineIdx, entIdx) {
  if (!detailWorkingLines[lineIdx] || !detailWorkingLines[lineIdx]._entregas) return;
  detailWorkingLines[lineIdx]._entregas.splice(entIdx, 1);
  renderEntregasUI(lineIdx);
  syncEntregaTotal(lineIdx);
}

// ── Save all changes (edits + deliveries) ──
async function guardarTodo() {
  if (activeIdx === null) return;
  var c = consecs[activeIdx];

  var prods = [].slice.call(document.querySelectorAll('.md-prod'));
  var press = [].slice.call(document.querySelectorAll('.md-pres'));
  var cants = [].slice.call(document.querySelectorAll('.md-cant'));
  var vunis = [].slice.call(document.querySelectorAll('.md-vuni'));
  detailWorkingLines.forEach(function(l, i) {
    if (norm(l.Estado_Entrega || '') === 'entregado' && !AUTH.isAdmin()) return;
    l.Producto = prods[i] ? prods[i].value.trim() : l.Producto;
    l.Presentacion = press[i] ? press[i].value.trim() : l.Presentacion;
    l.Cantidad = Number(cants[i] && cants[i].value) || 0;
    l.Valor_Unitario = Number(vunis[i] && vunis[i].value) || 0;
    l.Valor_Total = l.Cantidad * l.Valor_Unitario;
  });

  var fecha = document.getElementById('m-fecha').value;
  var rem = document.getElementById('m-remision').value.trim();

  var entregas = [];
  var solicitudesCompra = [];
  var empPedidoN = norm(c.Nombre_Empresa);
  detailWorkingLines.forEach(function(dl, i) {
    var asigs = (dl && dl._asignaciones) || [];
    asigs.forEach(function(a) {
      var cant = Number(a.cantidad) || 0;
      if (cant <= 0) return;
      var item = {
        row: dl.__row,
        _idx: i,
        cantidad: cant,
        empresa_stock: a.empresa_stock,
        remision: rem,
        fecha: fecha
      };
      if (norm(a.empresa_stock) === empPedidoN) entregas.push(item);
      else solicitudesCompra.push(item);
    });
  });

  if (entregas.length > 0 && !rem) {
    try {
      rem = await generarRemisionConsecutivo(c.Nombre_Empresa, 'SALIDA');
      entregas.forEach(function(e) { e.remision = rem; });
      document.getElementById('m-remision').value = rem;
    } catch (err) {
      showToast('Error generando remisión: ' + err.message, '#e74c3c');
      return;
    }
  }
  if ((entregas.length > 0 || solicitudesCompra.length > 0) && !fecha) {
    showToast('Selecciona la fecha', '#e74c3c');
    return;
  }

  // Volcar SOLO las entregas directas al buffer _entregas para que
  // el resto del flujo (Cant_Entregada, Remisiones, Estado_Entrega,
  // PDF de remisión) opere únicamente sobre lo que realmente se
  // entrega al cliente. Los traslados no cuentan como entrega hasta
  // que la OC se legalice y se registre la entrega desde la empresa
  // del pedido en una sesión posterior.
  entregas.forEach(function(ent) {
    var dl = detailWorkingLines[ent._idx];
    if (!dl) return;
    if (!dl._entregas) dl._entregas = [];
    dl._entregas.push({
      remision: ent.remision,
      cantidad: ent.cantidad,
      fecha: ent.fecha,
      empresa_stock: ent.empresa_stock
    });
  });

  var entregadaExcedida = false;
  detailWorkingLines.forEach(function(l) {
    var entries = l._entregas || [];
    l.Cant_Entregada = entries.reduce(function(s, e) { return s + (e.cantidad || 0); }, 0);
    l.Remisiones = formatEntregas(entries);
    var maxDate = '';
    entries.forEach(function(e) { if (e.fecha && e.fecha > maxDate) maxDate = e.fecha; });
    if (maxDate) l.Fecha_Ult_Entrega = maxDate;
    l.Cant_Pendiente = Math.max(0, (Number(l.Cantidad) || 0) - l.Cant_Entregada);
    if (l.Cant_Entregada > l.Cantidad) entregadaExcedida = true;
  });
  if (entregadaExcedida) { showToast('La cantidad total de entregas supera la pedida', '#e74c3c'); return; }

  if (rem && entregas.length === 0) {
    detailWorkingLines.forEach(function(l) {
      if ((Number(l.Cant_Entregada) || 0) > 0 && (l._entregas || []).some(function(e) { return !(e.remision || '').trim(); })) {
        l._entregas.forEach(function(e) {
          if (!(e.remision || '').trim()) e.remision = rem;
        });
        l.Remisiones = formatEntregas(l._entregas);
      }
    });
  }

  detailWorkingLines.forEach(function(l) {
    var pedida = Number(l.Cantidad) || 0;
    var entregada = Number(l.Cant_Entregada) || 0;
    if (pedida > 0 && entregada >= pedida) {
      var todasRemision = (l._entregas || []).length > 0 && (l._entregas || []).every(function(e) { return (e.remision || '').trim() !== ''; });
      l.Estado_Entrega = todasRemision ? 'Entregado' : 'Alistado';
    } else if (entregada > 0) {
      l.Estado_Entrega = 'Parcial';
    } else {
      l.Estado_Entrega = 'Recibido';
    }
  });

  var hdr = {
    Cliente: document.getElementById('md-cliente').value.trim(),
    NIT: document.getElementById('md-nit').value.trim(),
    Fecha_Pedido: document.getElementById('md-fecha-pedido').value || null,
    Comercial: document.getElementById('md-comercial').value.trim(),
    Municipio: document.getElementById('md-municipio').value.trim(),
    Departamento: document.getElementById('md-departamento').value.trim(),
    Telefono: document.getElementById('md-telefono').value.trim(),
    Direccion_Envio: document.getElementById('md-direccion').value.trim(),
    Plazo_Pago: document.getElementById('md-plazo').value.trim(),
    Precio_Facturacion: document.getElementById('md-precio').value.trim(),
    Facturar_A: document.getElementById('md-facturar-a').value.trim(),
    NIT_Adicional: document.getElementById('md-nit-adicional').value.trim(),
    Sucursal: document.getElementById('md-sucursal').value.trim(),
    Consignacion: document.getElementById('md-consignacion').value,
    Bodega_Facturacion: document.getElementById('md-bodega-facturacion').value,
    Total_Orden: detailWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0),
    Estado_2: document.getElementById('md-estado2').value,
    Nombre_Empresa: c.Nombre_Empresa,
    Consecutivo: c.Consecutivo
  };
  hdr.comercial_id = await _resolveComercialId(hdr.Comercial);

  var btn = document.getElementById('btn-confirmar');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var obs = document.getElementById('m-observaciones').value.trim();
    var editResult = await apiPost({
      action: 'editarPedido',
      header: hdr,
      lineas: detailWorkingLines.map(function(l) { var c = Object.assign({}, l); delete c._entregas; return c; }),
      deleteRows: []
    });
    if (!editResult.ok) throw new Error(editResult.error || 'Error al guardar edición');

    for (var di = 0; di < detailWorkingLines.length; di++) {
      var dl = detailWorkingLines[di];
      if (dl.__row) {
        var upd = {};
        if (dl.Estado_Entrega) upd.Estado_Entrega = dl.Estado_Entrega;
        if (dl.Fecha_Ult_Entrega) upd.Fecha_Ult_Entrega = dl.Fecha_Ult_Entrega;
        upd.Remisiones = dl.Remisiones || null;
        upd.Cant_Entregada = dl.Cant_Entregada || 0;
        upd.Cant_Pendiente = dl.Cant_Pendiente || 0;
        if (obs) upd.Observaciones = obs;
        if (Object.keys(upd).length > 0) {
          upd.modificado_por = _uid();
          await _sb.from('Pedidos').update(upd).eq('id', dl.__row);
        }
      }
    }

    // Registrar EntregasPedido de las entregas directas + OCs de
    // "solicitud de compra" para los traslados. Ver la regla en el
    // encabezado del bucket splitting arriba.
    if (entregas.length > 0 || solicitudesCompra.length > 0) {
      await persistirEntregasYTraslados(entregas, solicitudesCompra, c, rem, fecha, obs);
    }

    if (entregas.length > 0 && rem) {
      var entregasPDF = entregas.map(function(ent) {
        var dl = detailWorkingLines[ent._idx];
        var vUni = dl ? (Number(dl.Valor_Unitario) || 0) : 0;
        return {
          producto: dl ? dl.Producto : '',
          presentacion: dl ? dl.Presentacion : '',
          cantidad: ent.cantidad,
          valor_unitario: vUni,
          valor_total: ent.cantidad * vUni,
          bonificado: dl ? (dl.Bonificado || '') : ''
        };
      });
      var totalEntrega = entregasPDF.reduce(function(s, e) { return s + (e.valor_total || 0); }, 0);
      generarRemisionPDF({
        empresa: c.Nombre_Empresa,
        consecutivo: c.Consecutivo,
        fecha_pedido: hdr.Fecha_Pedido,
        cliente: hdr.Cliente,
        nit: hdr.NIT,
        comercial: hdr.Comercial,
        municipio: hdr.Municipio,
        departamento: hdr.Departamento,
        telefono: hdr.Telefono,
        direccion: c.Direccion_Envio || '',
        plazo: hdr.Plazo_Pago,
        precio: hdr.Precio_Facturacion,
        consignacion: hdr.Consignacion,
        facturar_a: hdr.Facturar_A,
        nit_adicional: hdr.NIT_Adicional,
        sucursal: hdr.Sucursal,
        bodega_facturacion: hdr.Bodega_Facturacion,
        observaciones: obs,
        remision: rem,
        fecha_entrega: fecha,
        entregas: entregasPDF,
        total: totalEntrega
      });
    }

    closeModal();
    var partes = [];
    if (entregas.length > 0) partes.push(entregas.length + ' entrega(s) registrada(s)');
    if (solicitudesCompra.length > 0) partes.push(solicitudesCompra.length + ' solicitud(es) de compra creada(s)');
    var msg = partes.length > 0
      ? '✅ Cambios guardados + ' + partes.join(' + ')
      : '✅ Cambios guardados en la nube';
    showToast(msg);
    if (solicitudesCompra.length > 0) {
      showToast('⚠ ' + solicitudesCompra.length + ' solicitud(es) de compra pendiente(s) — legalizar la OC en Órdenes para que el stock quede en ' + c.Nombre_Empresa + ' y poder emitir la remisión', '#e67e22');
    }
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Guardar cambios';
  }
}

// ── Persistencia de entregas + OC de "solicitud de compra" ──
//
// Se reciben dos buckets ya separados por guardarTodo():
//
//   • entregas (empresa_stock === empresa del pedido):
//     Se inserta la fila en EntregasPedido; el descuento del stock
//     lo hace Existencias/Kardex al considerar EntregasPedido +
//     la Remisiones del pedido.
//
//   • solicitudesCompra (empresa_stock !== empresa del pedido):
//     Se crea SOLO una OC con Tipo='Traslado', Estado='Abierta' y
//     Remision='' — es una "solicitud de compra". NO se crea
//     EntregasPedido y NO se toca el pedido (Cant_Entregada,
//     Remisiones, Estado_Entrega). La OC no afecta inventario
//     hasta que un usuario la abra en el módulo Órdenes y cargue
//     Remisión Destino + Remisión Origen — recién ahí Existencias
//     y Kardex la cuentan como movimiento bilateral y el producto
//     queda como existencia en la empresa del pedido. Sólo
//     entonces el usuario puede volver a este pedido y registrar
//     la entrega al cliente desde esa empresa para emitir la
//     remisión correspondiente.
async function persistirEntregasYTraslados(entregas, solicitudesCompra, c, rem, fecha, obs) {
  var uid = _uid();
  var stamp = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var ymd = stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate());
  var hms = pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds());
  var counter = 0;

  // 1) Entregas directas → sólo EntregasPedido, sin OC.
  for (var e = 0; e < entregas.length; e++) {
    var ent = entregas[e];
    var dl = detailWorkingLines[ent._idx] || {};
    var epRow = {
      pedido_id: ent.row,
      empresa_pedido: c.Nombre_Empresa,
      empresa_stock: ent.empresa_stock,
      producto: dl.Producto || '',
      presentacion: dl.Presentacion || '',
      cantidad: ent.cantidad,
      remision: rem,
      fecha: fecha || null,
      orden_compra_id: null,
      observaciones: obs || '',
      creado_por: uid
    };
    var epRes = await _sb.from('EntregasPedido').insert(epRow);
    if (epRes.error) throw new Error('EntregasPedido: ' + epRes.error.message);
  }

  // 2) Solicitudes de compra → OC de traslado, sin EntregasPedido.
  //
  // Se agrupan por empresa_origen para que una sola "solicitud de
  // orden de compra" contenga TODAS las líneas de producto que van
  // desde esa misma empresa origen. Todas las líneas del grupo
  // comparten Consecutivo, Fecha, Empresa_Destino, Empresa_Origen y
  // Ref_Pedido — sólo cambia Producto/Presentación/Cantidad. Así el
  // PDF de la solicitud y el PDF de las remisiones agrupan todos los
  // productos relacionados.
  var solPorOrigen = {};
  solicitudesCompra.forEach(function(sol) {
    var key = _normSC(sol.empresa_stock);
    if (!solPorOrigen[key]) solPorOrigen[key] = { empresa_stock: sol.empresa_stock, items: [] };
    solPorOrigen[key].items.push(sol);
  });
  var origenKeys = Object.keys(solPorOrigen);
  for (var gi = 0; gi < origenKeys.length; gi++) {
    var grupo = solPorOrigen[origenKeys[gi]];
    counter += 1;
    var siglaOrig = (typeof getSigla === 'function' ? getSigla(grupo.empresa_stock) : '') || '';
    var consecTras = 'T-' + ymd + '-' + hms + (siglaOrig ? '-' + siglaOrig : '') +
                     (counter > 1 && !siglaOrig ? '-' + counter : '');
    var obsGrupo = 'Solicitud de compra automática por pedido ' +
      c.Nombre_Empresa + ' #' + c.Consecutivo +
      ' — legalizar en Órdenes (Remisión Destino + Origen) para ' +
      'que el stock entre a ' + c.Nombre_Empresa + ' y poder emitir ' +
      'la remisión al cliente.';
    for (var li = 0; li < grupo.items.length; li++) {
      var sol = grupo.items[li];
      var dls = detailWorkingLines[sol._idx] || {};
      var ocRow = {
        Fecha: fecha || ymd,
        Empresa_Destino: c.Nombre_Empresa,
        Empresa_Origen: grupo.empresa_stock,
        Consecutivo: consecTras,
        Tipo: 'Traslado',
        Ref_Pedido: c.Nombre_Empresa + ' #' + c.Consecutivo,
        Producto: dls.Producto || '',
        Presentacion: dls.Presentacion || '',
        Cantidad: sol.cantidad,
        Valor_Unitario: 0,
        Valor_Total: 0,
        Total_Orden: 0,
        Estado: 'Abierta',
        Remision: '',
        Bodega: 'Productos Buenos',
        Observaciones: obsGrupo,
        creado_por: uid
      };
      var ocRes = await _sb.from('OrdenesCompra').insert(ocRow);
      if (ocRes.error) throw new Error('OC solicitud compra: ' + ocRes.error.message);
    }
    // Notificar aprobadores de OC para la empresa origen
    _notifyAprobadoresOCDesdePedido({
      empresaOrig: grupo.empresa_stock,
      empresaDest: c.Nombre_Empresa,
      consecutivo: consecTras,
      nLineas: grupo.items.length,
      refPedido: c.Nombre_Empresa + ' #' + c.Consecutivo
    });
  }
}

async function _notifyAprobadoresOCDesdePedido(info) {
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
      mensaje: info.nLineas + ' línea(s) · Ref: ' + info.refPedido
    });
  } catch (e) { console.warn('No se pudo notificar aprobadores OC:', e); }
}

// ── Add new line from detail modal ──
function toggleNewLine() {
  var form = document.getElementById('new-line-form');
  var btn = document.getElementById('btn-toggle-newline');
  if (form.style.display === 'none') {
    form.style.display = 'block';
    btn.textContent = 'Ocultar';
  } else {
    form.style.display = 'none';
    btn.textContent = 'Mostrar';
  }
}

function calcNewLineTotal() {
  var cant = Number(document.getElementById('nl-cantidad').value) || 0;
  var vuni = Number(document.getElementById('nl-vunitario').value) || 0;
  document.getElementById('nl-vtotal').value = cant * vuni;
}

function resetNewLineForm() {
  document.getElementById('nl-producto').value = '';
  document.getElementById('nl-presentacion').value = '';
  document.getElementById('nl-cantidad').value = '';
  document.getElementById('nl-vunitario').value = '';
  document.getElementById('nl-vtotal').value = '';
  var nlBonif = document.getElementById('nl-bonificado');
  if (nlBonif) nlBonif.checked = false;
  document.getElementById('new-line-form').style.display = 'none';
  document.getElementById('btn-toggle-newline').textContent = 'Mostrar';
}

async function agregarNuevaLinea() {
  if (activeIdx === null) return;
  var producto = document.getElementById('nl-producto').value.trim();
  var presentacion = document.getElementById('nl-presentacion').value.trim();
  var cantidad = Number(document.getElementById('nl-cantidad').value) || 0;
  var vunitario = Number(document.getElementById('nl-vunitario').value) || 0;
  var vtotal = Number(document.getElementById('nl-vtotal').value) || 0;

  if (!producto) { showToast('Ingresa el nombre del producto', '#e74c3c'); return; }
  if (cantidad <= 0) { showToast('La cantidad debe ser mayor a 0', '#e74c3c'); return; }

  var c = consecs[activeIdx];
  var newLine = {
    __row: null,
    Nombre_Empresa: c.Nombre_Empresa,
    Consecutivo: c.Consecutivo,
    Fecha_Pedido: c.Fecha_Pedido,
    Producto: producto,
    Presentacion: presentacion,
    Cantidad: cantidad,
    Valor_Unitario: vunitario,
    Valor_Total: vtotal,
    Cant_Entregada: 0,
    Cant_Pendiente: cantidad,
    Estado_Entrega: 'Recibido',
    Estado: 'recibido',
    Estado_2: 'Abierto',
    Bonificado: (document.getElementById('nl-bonificado') && document.getElementById('nl-bonificado').checked) ? 'Sí' : ''
  };

  var hdr = {
    Cliente: c.Cliente, NIT: c.NIT, Fecha_Pedido: c.Fecha_Pedido,
    Comercial: c.Comercial, Municipio: c.Municipio, Departamento: c.Departamento,
    Telefono: c.Telefono, Plazo_Pago: c.Plazo_Pago, Precio_Facturacion: c.Precio_Facturacion,
    Nombre_Empresa: c.Nombre_Empresa, Consecutivo: c.Consecutivo,
    Total_Orden: (Number(c.Total_Orden) || 0) + vtotal
  };
  hdr.comercial_id = c.comercial_id || await _resolveComercialId(hdr.Comercial);

  var btn = document.getElementById('btn-add-newline');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  var savedKey = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);

  try {
    var result = await apiPost({
      action: 'editarPedido',
      header: hdr,
      lineas: [newLine],
      deleteRows: [],
      modificacionTipo: 'linea_nueva'
    });
    if (!result || !result.ok) throw new Error((result && result.error) || 'Error al guardar');

    resetNewLineForm();
    showToast('✅ Línea de producto agregada al pedido');
    await loadFromAPI();
    var newIdx = consecs.findIndex(function(cc) { return keyOf(cc.Nombre_Empresa, cc.Consecutivo, cc.Cliente) === savedKey; });
    if (newIdx >= 0) {
      openDetail(newIdx);
    }
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Agregar línea al pedido';
  }
}

async function removeDetailLine(i) {
  var l = detailWorkingLines[i];
  if (!l || !l.__row) return;
  if (norm(l.Estado_Entrega || '') === 'entregado' && !AUTH.isAdmin()) {
    showToast('Solo el administrador puede eliminar líneas entregadas', '#e74c3c');
    return;
  }
  if ((Number(l.Cant_Entregada) || 0) > 0) {
    showToast('No se puede eliminar una línea con entregas registradas', '#e74c3c');
    return;
  }
  if (!confirm('¿Eliminar la línea "' + (l.Producto || '') + '" del pedido?')) return;
  try {
    var c = consecs[activeIdx];
    var savedKey = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
    var res = await _sb.from('Pedidos').delete().eq('id', l.__row);
    if (res.error) throw new Error(res.error.message);
    detailWorkingLines.splice(i, 1);
    var newTotal = detailWorkingLines.reduce(function(s, dl) { return s + (Number(dl.Valor_Total) || 0); }, 0);
    if (detailWorkingLines.length > 0) {
      await _sb.from('Pedidos')
        .update({ Total_Orden: newTotal, modificado_por: _uid() })
        .eq('Nombre_Empresa', c.Nombre_Empresa)
        .eq('Consecutivo', String(c.Consecutivo));
    }
    showToast('✅ Línea eliminada del pedido');
    await loadFromAPI();
    var newIdx = consecs.findIndex(function(cc) { return keyOf(cc.Nombre_Empresa, cc.Consecutivo, cc.Cliente) === savedKey; });
    if (newIdx >= 0) openDetail(newIdx);
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
  }
}

// ── Edit Modal ──
async function openEdit(idx) {
  editIdx = idx;
  var c = consecs[idx];
  var acPromises = [];
  if (!productosCache) acPromises.push(apiGet('getMaestroProductos').then(function(r) { if (r.ok) productosCache = r.productos || []; }).catch(function() { productosCache = []; }));
  if (!listaPreciosCache) acPromises.push(apiGet('getListaPrecios').then(function(r) { if (r.ok) listaPreciosCache = r.precios || []; }).catch(function() { listaPreciosCache = []; }));
  if (acPromises.length) await Promise.all(acPromises);
  _mergePreciosEmbedded();
  editKey = keyOf(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
  editWorkingLines = getLinesFor(c).map(function(l) { return Object.assign({}, l); });

  document.getElementById('ed-titulo').textContent = '✏️ [' + getSigla(c.Nombre_Empresa) + '] Orden #' + (c.Consecutivo||'');
  document.getElementById('ed-cliente').value = c.Cliente || '';
  document.getElementById('ed-nit').value = c.NIT || '';
  document.getElementById('ed-fecha').value = toDateInput(c.Fecha_Pedido);
  document.getElementById('ed-comercial').value = c.Comercial || '';
  document.getElementById('ed-municipio').value = c.Municipio || '';
  document.getElementById('ed-departamento').value = c.Departamento || '';
  document.getElementById('ed-telefono').value = c.Telefono || '';
  document.getElementById('ed-plazo').value = c.Plazo_Pago || '';
  document.getElementById('ed-precio').value = c.Precio_Facturacion || '';
  document.getElementById('ed-facturar-a').value = c.Facturar_A || c.Cliente || '';
  document.getElementById('ed-nit-adicional').value = c.NIT_Adicional || '';
  _populateSucursalDL(c.Cliente);
  document.getElementById('ed-sucursal').value = c.Sucursal || '';
  document.getElementById('ed-consignacion').value = c.Consignacion || 'No';
  document.getElementById('ed-bodega-facturacion').value = _normBodegaFacturacion(c.Bodega_Facturacion || '');
  _toggleBodegaField('ed', c.Nombre_Empresa);
  document.getElementById('ed-estado2').value = derivedEstado2(getLinesFor(c));
  document.getElementById('btn-saveEdit').disabled = false;
  document.getElementById('btn-saveEdit').textContent = '✓ Aplicar cambios';

  renderEditLines();
  document.getElementById('edit-overlay').classList.add('show');
  destroyGeoAC('ed');
  geoACs.ed = setupGeoAutocomplete(
    document.getElementById('ed-departamento'),
    document.getElementById('ed-municipio')
  );
}

function closeEdit() {
  document.getElementById('edit-overlay').classList.remove('show');
  editIdx = null; editKey = null; editWorkingLines = [];
  edProdACs.forEach(function(ac) { ac.destroy(); });
  edProdACs = [];
  destroyGeoAC('ed');
}

document.getElementById('edit-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeEdit(); });

function renderEditLines() {
  var tbody = document.getElementById('ed-lines');
  tbody.innerHTML = editWorkingLines.map(function(l, i) {
    var locked = (Number(l.Cant_Entregada)||0) > 0;
    var lockEntregado = norm(l.Estado_Entrega || '') === 'entregado' && !AUTH.isAdmin();
    var lockCant = !AUTH.hasModule('pedidos_editar_cantidad');
    var disAttr = lockEntregado ? ' disabled' : '';
    var disBg = lockEntregado ? ';background:#f7fafc;opacity:0.7' : '';
    var cantDisAttr = (lockEntregado || lockCant) ? ' disabled' : '';
    var cantDisBg = (lockEntregado || lockCant) ? ';background:#f7fafc;opacity:0.7' : '';
    var prod = (l.Producto||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    var pres = (l.Presentacion||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    var textoTieneBonif = /bonificado/i.test(l.Producto || '');
    var vUnit = Number(l.Valor_Unitario) || 0;
    var bonif = (l.Bonificado || '').trim();
    var esBonif = bonif === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td><input class="ef ed-prod" data-i="' + i + '" type="text" value="' + prod + '" style="min-width:260px' + (locked || lockEntregado ? ';background:#f7fafc' : '') + (lockEntregado ? ';opacity:0.7' : '') + '"' + disAttr + '></td>' +
      '<td><input class="ef ed-pres" data-i="' + i + '" type="text" value="' + pres + '" style="' + (locked || lockEntregado ? 'background:#f7fafc' : '') + (lockEntregado ? ';opacity:0.7' : '') + '"' + disAttr + '></td>' +
      '<td style="text-align:center"><input type="checkbox" class="ed-bonif" data-i="' + i + '"' + (esBonif ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer"' + disAttr + '></td>' +
      '<td><input class="ef ed-cant" data-i="' + i + '" type="number" min="0" value="' + (l.Cantidad||0) + '" style="width:80px;text-align:right' + cantDisBg + '"' + cantDisAttr + (lockEntregado || lockCant ? '' : ' oninput="updateLineTotal(' + i + ')"') + '></td>' +
      '<td><input class="ef ed-vuni" data-i="' + i + '" type="number" min="0" value="' + (l.Valor_Unitario||0) + '" style="width:100px;text-align:right' + disBg + '"' + disAttr + (lockEntregado ? '' : ' oninput="updateLineTotal(' + i + ')"') + '></td>' +
      '<td><input class="ef ed-vtot" data-i="' + i + '" type="number" value="' + (l.Valor_Total||0) + '" style="width:100px;text-align:right;background:#f7fafc" readonly></td>' +
      '<td><input class="ef ed-rem" data-i="' + i + '" type="text" value="' + (l.Remisiones||'').replace(/"/g,'&quot;') + '" placeholder="' + (locked ? 'Ej: REM-001' : '') + '" style="width:120px;font-size:0.78rem' + disBg + '"' + disAttr + '></td>' +
      '<td style="text-align:center">' +
        (lockEntregado
          ? '<span style="font-size:0.85rem;color:#92400e" title="Entregado — solo administrador puede modificar">🔒</span>'
          : locked
            ? '<span style="font-size:0.85rem;color:#a0aec0" title="Tiene entregas registradas">🔒</span>'
            : '<button onclick="removeEditLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>') +
      '</td></tr>';
  }).join('');
  updateEditTotal();
  edProdACs.forEach(function(ac) { ac.destroy(); });
  edProdACs = [];
  if (productosCache && editIdx !== null) {
    var emp = consecs[editIdx].Nombre_Empresa;
    [].slice.call(document.querySelectorAll('.ed-prod')).forEach(function(input, i) {
      var lockEntregado = editWorkingLines[i] && norm(editWorkingLines[i].Estado_Entrega || '') === 'entregado' && !AUTH.isAdmin();
      if (lockEntregado) return;
      edProdACs.push(initAutocomplete(input, {
        items: function() {
          var prods = productosCache || [];
          if (emp) prods = prods.filter(function(p) { return !p.empresa || p.empresa === emp; });
          return prods;
        },
        display: function(p) {
          return '<strong>' + escHtml(p.producto) + '</strong>' +
                 (p.presentacion ? ' <span class="ac-sub">— ' + escHtml(p.presentacion) + '</span>' : '');
        },
        match: function(p, val) {
          return ((p.producto||'') + ' ' + (p.presentacion||'')).toLowerCase().indexOf(val) >= 0;
        },
        onSelect: function(p) {
          input.value = p.producto || '';
          var presInputs = document.querySelectorAll('.ed-pres');
          var idx = [].slice.call(document.querySelectorAll('.ed-prod')).indexOf(input);
          if (idx >= 0 && presInputs[idx]) presInputs[idx].value = p.presentacion || '';
          var bonifInputs = document.querySelectorAll('.ed-bonif');
          var esBonif = idx >= 0 && bonifInputs[idx] && bonifInputs[idx].checked;
          if (esBonif) {
            var vunis = document.querySelectorAll('.ed-vuni');
            if (idx >= 0 && vunis[idx]) { vunis[idx].value = 1; updateLineTotal(idx); }
          } else {
            var precio = _lookupPrecio(emp, document.getElementById('ed-precio').value.trim(), p.producto);
            if (precio !== null) {
              var vunis = document.querySelectorAll('.ed-vuni');
              if (idx >= 0 && vunis[idx]) { vunis[idx].value = precio; updateLineTotal(idx); }
            }
          }
        }
      }));
    });
  }
}

function updateLineTotal(i) {
  var cants = document.querySelectorAll('.ed-cant');
  var vunis = document.querySelectorAll('.ed-vuni');
  var vtots = document.querySelectorAll('.ed-vtot');
  var cant = parseFloat(cants[i] && cants[i].value) || 0;
  var vuni = parseFloat(vunis[i] && vunis[i].value) || 0;
  var vtot = cant * vuni;
  if (vtots[i]) vtots[i].value = vtot;
  if (editWorkingLines[i]) {
    editWorkingLines[i].Cantidad = cant;
    editWorkingLines[i].Valor_Unitario = vuni;
    editWorkingLines[i].Valor_Total = vtot;
  }
  updateEditTotal();
}

function updateEditTotal() {
  var total = editWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0);
  document.getElementById('ed-total-calc').textContent = fmtMoney(total);
}

function addEditLine() {
  editWorkingLines.push({
    Producto:'', Presentacion:'', Cantidad:0, Valor_Unitario:0, Valor_Total:0,
    Cant_Entregada:0, Cant_Pendiente:0, Estado_Entrega:'Recibido',
    Fecha_Ult_Entrega:null, Remisiones:'', Bonificado:'', __row: null
  });
  renderEditLines();
  var wrap = document.querySelector('#edit-overlay .prod-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function removeEditLine(i) {
  var l = editWorkingLines[i];
  if (l && norm(l.Estado_Entrega || '') === 'entregado' && !AUTH.isAdmin()) {
    showToast('Solo el administrador puede modificar líneas entregadas', '#e74c3c');
    return;
  }
  editWorkingLines.splice(i, 1);
  renderEditLines();
}

async function saveEdit() {
  if (editIdx === null) return;

  var prods = [].slice.call(document.querySelectorAll('.ed-prod'));
  var press = [].slice.call(document.querySelectorAll('.ed-pres'));
  var cants = [].slice.call(document.querySelectorAll('.ed-cant'));
  var vunis = [].slice.call(document.querySelectorAll('.ed-vuni'));
  var vtots = [].slice.call(document.querySelectorAll('.ed-vtot'));
  var rems = [].slice.call(document.querySelectorAll('.ed-rem'));
  var bonifs = [].slice.call(document.querySelectorAll('.ed-bonif'));
  editWorkingLines.forEach(function(l, i) {
    if (norm(l.Estado_Entrega || '') === 'entregado' && !AUTH.isAdmin()) return;
    l.Producto = prods[i] ? prods[i].value.trim() : '';
    l.Presentacion = press[i] ? press[i].value.trim() : '';
    l.Cantidad = Number(cants[i] && cants[i].value) || 0;
    l.Valor_Unitario = Number(vunis[i] && vunis[i].value) || 0;
    l.Valor_Total = Number(vtots[i] && vtots[i].value) || 0;
    l.Remisiones = rems[i] ? rems[i].value.trim() : '';
    l.Bonificado = bonifs[i] && bonifs[i].checked ? 'Sí' : '';
    l.Cant_Pendiente = Math.max(0, l.Cantidad - (Number(l.Cant_Entregada)||0));
  });

  var hdr = {
    Cliente: document.getElementById('ed-cliente').value.trim(),
    NIT: document.getElementById('ed-nit').value.trim(),
    Fecha_Pedido: document.getElementById('ed-fecha').value || null,
    Comercial: document.getElementById('ed-comercial').value.trim(),
    Municipio: document.getElementById('ed-municipio').value.trim(),
    Departamento: document.getElementById('ed-departamento').value.trim(),
    Telefono: document.getElementById('ed-telefono').value.trim(),
    Plazo_Pago: document.getElementById('ed-plazo').value.trim(),
    Precio_Facturacion: document.getElementById('ed-precio').value.trim(),
    Facturar_A: document.getElementById('ed-facturar-a').value.trim(),
    NIT_Adicional: document.getElementById('ed-nit-adicional').value.trim(),
    Sucursal: document.getElementById('ed-sucursal').value.trim(),
    Consignacion: document.getElementById('ed-consignacion').value,
    Bodega_Facturacion: document.getElementById('ed-bodega-facturacion').value,
    Total_Orden: editWorkingLines.reduce(function(s, l) { return s + (Number(l.Valor_Total)||0); }, 0),
    Estado_2: document.getElementById('ed-estado2').value,
  };
  hdr.comercial_id = await _resolveComercialId(hdr.Comercial);

  var c = consecs[editIdx];
  var originalLines = getLinesFor(c);
  var originalRows = originalLines.map(function(l) { return l.__row; });
  var keepRows = editWorkingLines.filter(function(l) { return l.__row; }).map(function(l) { return l.__row; });
  var deleteRows = originalRows.filter(function(r) { return keepRows.indexOf(r) < 0; });

  // Detectar cambios que ameriten resaltar el pedido como modificado.
  var origCantMap = {};
  originalLines.forEach(function(ol) { if (ol.__row) origCantMap[ol.__row] = Number(ol.Cantidad) || 0; });
  var cantChanged = false, lineaNueva = false;
  editWorkingLines.forEach(function(l) {
    if (!l.__row) lineaNueva = true;
    else if ((Number(l.Cantidad) || 0) !== (origCantMap[l.__row] || 0)) cantChanged = true;
  });
  var tipoMod = (cantChanged && lineaNueva) ? 'ambos' : cantChanged ? 'cantidad' : lineaNueva ? 'linea_nueva' : null;

  var btn = document.getElementById('btn-saveEdit');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var result = await apiPost({
      action: 'editarPedido',
      header: Object.assign({}, hdr, { Nombre_Empresa: c.Nombre_Empresa, Consecutivo: c.Consecutivo }),
      lineas: editWorkingLines,
      deleteRows: deleteRows,
      modificacionTipo: tipoMod
    });
    if (!result.ok) throw new Error(result.error || 'Error al guardar');

    closeEdit();
    showToast('✅ Pedido actualizado en la nube');
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✓ Aplicar cambios';
  }
}

async function agregarProductosNuevosAlMaestro(productos, empresa) {
  if (!productosCache) return;
  var nuevos = [];
  productos.forEach(function(p) {
    if (!p.producto) return;
    if (p._normalizado) return;
    var np = _normTxt(p.producto);
    var exists = productosCache.some(function(m) { return _normTxt(m.producto) === np; });
    if (!exists) {
      var yaAgregado = nuevos.some(function(n) { return _normTxt(n.producto) === np; });
      if (!yaAgregado) nuevos.push({ producto: p.producto, presentacion: p.presentacion || '', empresa: empresa || '' });
    }
  });
  if (!nuevos.length) return;
  try {
    var res = await apiPost({ action: 'addMaestroProductos', items: nuevos });
    if (res.ok && res.added) {
      nuevos.forEach(function(n) { productosCache.push(n); });
      showToast(res.added + ' producto(s) nuevo(s) agregado(s) al maestro', '#2E86C1');
    }
  } catch(e) {}
}

// ── Upload Order from Excel ──
var uploadData = null;

function _normTxt(s) {
  if (!s && s !== 0) return '';
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function _normVolume(s) {
  s = s.replace(/\bbidon(?:\s+de)?\s+20\s*(?:litros?|lts?)\b/g, '1 bidon');
  s = s.replace(/\bgalon(?:\s+de)?\s+4\s*(?:litros?|lts?)\b/g, '1 galon');
  s = s.replace(/\b20\s*(?:litros?|lts?)\b/g, '1 bidon');
  s = s.replace(/\b4\s*(?:litros?|lts?)\b/g, '1 galon');
  return s;
}

function normalizarProductosConMaestro(productos) {
  if (!productosCache || !productosCache.length) return productos;
  var maestro = {};
  var maestroVol = {};
  productosCache.forEach(function(m) {
    var key = _normTxt(m.producto) + '|' + _normTxt(m.presentacion);
    if (!maestro[key]) maestro[key] = m;
    var vkey = _normVolume(key);
    if (!maestroVol[vkey]) maestroVol[vkey] = m;
  });
  var maestroKeys = Object.keys(maestro);
  var maestroVolKeys = Object.keys(maestroVol);

  return productos.map(function(p) {
    var np = _normTxt(p.producto);
    var nq = _normTxt(p.presentacion);
    var key = np + '|' + nq;

    if (maestro[key]) {
      var m = maestro[key];
      if (m.producto === p.producto && (m.presentacion || '') === (p.presentacion || ''))
        return p;
      var r = Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
      return r;
    }

    var vkey = _normVolume(key);
    if (maestroVol[vkey]) {
      var m = maestroVol[vkey];
      return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
    }

    var candProd = [];
    maestroKeys.forEach(function(k) { if (k.split('|')[0] === np) candProd.push(maestro[k]); });
    if (candProd.length === 1) {
      var m = candProd[0];
      if (m.producto === p.producto) return p;
      return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
    }

    if (!candProd.length) {
      var vnp = _normVolume(np);
      var candVolProd = [];
      maestroVolKeys.forEach(function(k) { if (k.split('|')[0] === vnp) candVolProd.push(maestroVol[k]); });
      if (candVolProd.length === 1) {
        var m = candVolProd[0];
        return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
      }
    }

    var bestScore = 0, bestKey = null;
    var queryStr = _normVolume(np + ' ' + nq);
    maestroKeys.forEach(function(k) {
      var parts = k.split('|');
      var candStr = _normVolume(parts[0] + ' ' + parts[1]);
      var longer = Math.max(queryStr.length, candStr.length);
      if (!longer) return;
      var dp = [];
      for (var i = 0; i <= queryStr.length; i++) { dp[i] = []; for (var j = 0; j <= candStr.length; j++) dp[i][j] = 0; }
      for (var i = 1; i <= queryStr.length; i++)
        for (var j = 1; j <= candStr.length; j++)
          dp[i][j] = queryStr[i-1] === candStr[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
      var lcs = dp[queryStr.length][candStr.length];
      var score = (2 * lcs) / (queryStr.length + candStr.length);
      if (score > bestScore) { bestScore = score; bestKey = k; }
    });
    if (bestScore >= 0.75 && bestKey) {
      var m = maestro[bestKey];
      return Object.assign({}, p, { producto: m.producto, presentacion: m.presentacion || p.presentacion, _normalizado: true, _original: p.producto });
    }

    return p;
  });
}

function handleFileUpload(input) {
  var file = input.files[0];
  if (!file) return;
  input.value = '';
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var data = new Uint8Array(e.target.result);
      var parsed = parseOrderExcel(data, file.name);
      uploadData = parsed;
      await showUploadPreview(parsed);
    } catch (err) {
      showToast('Error al leer el archivo: ' + err.message, '#e74c3c');
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseOrderExcel(data, filename) {
  var wb = XLSX.read(data, {type: 'array', cellDates: true});
  var ws = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(ws, {header: 1, defval: null, raw: true});

  function get(r, c) {
    if (r >= rows.length) return null;
    var row = rows[r] || [];
    return c < row.length ? row[c] : null;
  }

  function str(v) { return v != null ? String(v).trim() : null; }

  function dateFmt(v) {
    if (!v) return null;
    if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0') + '-' + String(v.getDate()).padStart(2,'0');
    return String(v);
  }

  function findRow(label, col) {
    col = col || 0;
    for (var i = 0; i < rows.length; i++) {
      var cell = get(i, col);
      if (cell != null && String(cell).trim().toUpperCase().indexOf(label) >= 0) return i;
    }
    return null;
  }

  function findSelectedOption(row, skipCol) {
    if (!row) return null;
    skipCol = skipCol || 0;
    var labeled = [];
    for (var i = 0; i < row.length; i++) {
      if (row[i] != null && i > skipCol) labeled.push({i: i, v: row[i]});
    }
    var xItems = labeled.filter(function(item) { return String(item.v).trim().toLowerCase() === 'x'; });
    if (!xItems.length) return null;
    var xp = xItems[0].i;
    var before = labeled.filter(function(item) { return String(item.v).trim().toLowerCase() !== 'x' && item.i < xp; });
    if (!before.length) return null;
    before.sort(function(a, b) { return b.i - a.i; });
    return String(before[0].v).trim();
  }

  var rEmpresa = findRow('NOMBRE DE LA EMPRESA');
  var rFecha = findRow('FECHA');
  var rCliente = findRow('CLIENTE');
  var rDirEnvio = findRow('DIRECCION DE ENVIO') || findRow('DIRECCI');
  var rMunicipio = findRow('MUNICIPIO');
  var rPlazo = findRow('PLAZO DE PAGO');
  var rPrecio = findRow('PRECIO FACTURA');

  function findLabeledValue(label) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || [];
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        if (cell == null) continue;
        var upper = String(cell).trim().toUpperCase();
        if (upper.indexOf(label) < 0) continue;
        for (var cc = c + 1; cc < row.length; cc++) {
          if (row[cc] != null && String(row[cc]).trim() !== '') return { row: i, col: cc };
        }
      }
    }
    return null;
  }

  var consecInfo = findLabeledValue('CONSECUTIVO');
  var comercialInfo = findLabeledValue('COMERCIAL');
  var nitInfo = findLabeledValue('NIT');
  var telInfo = findLabeledValue('TEL');
  var deptoInfo = findLabeledValue('DEPARTAMENTO');

  var prodHeader = null, obsRow = null, totalRow = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && str(rows[i][0]) === 'PRODUCTOS') prodHeader = i;
    if (rows[i] && str(rows[i][0]) === 'OBSERVACIONES') obsRow = i;
    for (var c = 0; c < (rows[i]||[]).length; c++) {
      if (rows[i][c] != null && String(rows[i][c]).indexOf('TOTAL A PAGAR') >= 0) { totalRow = i; break; }
    }
  }

  var cantCol = 5, vuCol = 10, vtCol = 15;
  if (prodHeader !== null) {
    var hdr = rows[prodHeader] || [];
    for (var c = 0; c < hdr.length; c++) {
      var h = str(hdr[c]) || '';
      if (h.toUpperCase().indexOf('CANTIDAD') >= 0) cantCol = c;
      if (h.toUpperCase().indexOf('VALOR UNITARIO') >= 0) vuCol = c;
      if (h.toUpperCase().indexOf('VALOR TOTAL') >= 0) vtCol = c;
    }
  }

  var productos = [];
  if (prodHeader !== null) {
    var endRow = obsRow || rows.length;
    for (var r = prodHeader + 1; r < endRow; r++) {
      var nombre = get(r, 0);
      if (nombre == null) continue;
      var nombreStr = String(nombre);
      var textoTieneBonif = /bonificado/i.test(nombreStr);
      var productoLimpio = textoTieneBonif ? nombreStr.replace(/\s*bonificado\s*/gi, ' ').trim() : nombreStr;
      var vUnitario = Number(get(r, vuCol)) || 0;
      var esBonificado = textoTieneBonif || (vUnitario > 0 && vUnitario < 10);
      productos.push({
        producto: productoLimpio,
        presentacion: get(r, 1),
        cantidad: get(r, cantCol),
        valor_unitario: get(r, vuCol),
        valor_total: get(r, vtCol),
        bonificado: esBonificado ? 'Sí' : '',
      });
    }
  }

  var observaciones = null;
  if (obsRow !== null) {
    var obsParts = [];
    var obsRowData = rows[obsRow] || [];
    for (var oi = 1; oi < obsRowData.length; oi++) {
      if (obsRowData[oi] != null && String(obsRowData[oi]).trim()) obsParts.push(String(obsRowData[oi]).trim());
    }
    if (obsParts.length) observaciones = obsParts.join(' ');
  }

  return {
    nombre_empresa: rEmpresa !== null ? str(get(rEmpresa, 1)) : null,
    consecutivo: consecInfo ? get(consecInfo.row, consecInfo.col) : null,
    fecha_pedido: rFecha !== null ? dateFmt(get(rFecha, 1)) : null,
    cliente: rCliente !== null ? str(get(rCliente, 1)) : null,
    nit: nitInfo ? get(nitInfo.row, nitInfo.col) : null,
    telefono: telInfo ? get(telInfo.row, telInfo.col) : null,
    direccion_envio: rDirEnvio !== null ? str(get(rDirEnvio, 1)) : null,
    municipio: rMunicipio !== null ? str(get(rMunicipio, 1)) : null,
    departamento: deptoInfo ? str(get(deptoInfo.row, deptoInfo.col)) : null,
    comercial: comercialInfo ? str(get(comercialInfo.row, comercialInfo.col)) : null,
    plazo_pago: rPlazo !== null ? findSelectedOption(rows[rPlazo]) : null,
    precio_facturacion: rPrecio !== null ? findSelectedOption(rows[rPrecio]) : null,
    total_orden: totalRow !== null ? get(totalRow, vtCol) : null,
    observaciones: observaciones,
    productos: productos,
    archivo_fuente: filename,
  };
}

async function showUploadPreview(data) {
  if (!productosCache) {
    try { var r = await apiGet('getMaestroProductos'); if (r.ok) productosCache = r.productos || []; } catch(e) { productosCache = []; }
  }
  data.productos = normalizarProductosConMaestro(data.productos);

  document.getElementById('up-archivo').textContent = 'Archivo: ' + data.archivo_fuente;
  document.getElementById('up-empresa').textContent = data.nombre_empresa || '—';
  document.getElementById('up-consecutivo').textContent = data.consecutivo || '—';
  document.getElementById('up-fecha').textContent = data.fecha_pedido || '—';
  document.getElementById('up-cliente').textContent = data.cliente || '—';
  document.getElementById('up-nit').textContent = data.nit || '—';
  document.getElementById('up-comercial').textContent = data.comercial || '—';
  document.getElementById('up-municipio').textContent = data.municipio || '—';
  document.getElementById('up-departamento').textContent = data.departamento || '—';
  document.getElementById('up-plazo').textContent = data.plazo_pago || '—';
  var obsWrap = document.getElementById('up-obs-wrap');
  if (data.observaciones) {
    document.getElementById('up-observaciones').textContent = data.observaciones;
    obsWrap.style.display = 'block';
  } else {
    obsWrap.style.display = 'none';
  }
  document.getElementById('up-total').textContent = fmtMoney(data.total_orden);

  var normCount = data.productos.filter(function(p) { return p._normalizado; }).length;

  var tbody = document.getElementById('up-lines');
  if (!data.productos.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#a0aec0;padding:16px">Sin productos</td></tr>';
  } else {
    tbody.innerHTML = data.productos.map(function(p, i) {
      var normBadge = '';
      if (p._normalizado) {
        normBadge = '<span title="Original: ' + escHtml(p._original) + '" style="background:#fff3cd;color:#856404;padding:1px 6px;border-radius:8px;font-size:0.65rem;margin-left:4px;cursor:help">corregido</span>';
      }
      return '<tr>' +
        '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
        '<td style="font-weight:700">' + (p.producto||'—') + normBadge + '</td>' +
        '<td>' + (p.presentacion||'') + '</td>' +
        '<td class="money">' + (p.cantidad||0) + '</td>' +
        '<td class="money">' + fmtMoney(p.valor_unitario) + '</td>' +
        '<td class="money">' + fmtMoney(p.valor_total) + '</td>' +
        '<td style="text-align:center">' + (p.bonificado ? '<span style="background:#d5f5e3;color:#1e8449;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:700">Sí</span>' : '<span style="color:#718096;font-size:0.75rem">No</span>') + '</td>' +
        '</tr>';
    }).join('');
  }
  var oldBanner = document.querySelector('.norm-banner');
  if (oldBanner) oldBanner.remove();
  if (normCount > 0) {
    var banner = document.createElement('div');
    banner.className = 'norm-banner';
    banner.style.cssText = 'background:#fff3cd;color:#856404;padding:8px 12px;border-radius:6px;margin-bottom:8px;font-size:0.85rem';
    banner.innerHTML = '⚠️ ' + normCount + ' producto(s) corregido(s) segun maestro de productos. Pase el cursor sobre <span style="background:#fff3cd;border:1px solid #856404;padding:0 4px;border-radius:4px;font-size:0.65rem">corregido</span> para ver el nombre original.';
    var prodWrap = tbody.closest('.prod-wrap');
    prodWrap.parentElement.insertBefore(banner, prodWrap);
  }

  var dupWarn = document.getElementById('up-dup-warn');
  dupWarn.style.display = 'none';
  try {
    var dupResult = await apiPost({
      action: 'checkDuplicado',
      consecutivo: data.consecutivo,
      cliente: data.cliente,
      fecha_pedido: data.fecha_pedido,
      nombre_empresa: data.nombre_empresa
    });
    if (dupResult.ok && dupResult.duplicado) dupWarn.style.display = 'block';
  } catch(e) {}

  document.getElementById('btn-upload').disabled = false;
  document.getElementById('btn-upload').textContent = '📥 Cargar pedido';
  document.getElementById('upload-overlay').classList.add('show');
}

function closeUpload() {
  document.getElementById('upload-overlay').classList.remove('show');
  uploadData = null;
}

document.getElementById('upload-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeUpload(); });

async function confirmUpload() {
  if (!uploadData) return;
  var btn = document.getElementById('btn-upload');
  btn.disabled = true;
  btn.textContent = '⏳ Cargando...';

  try {
    var comercialIdUp = await _resolveComercialId(uploadData.comercial);
    var result = await apiPost({
      action: 'agregarPedido',
      nombre_empresa: uploadData.nombre_empresa,
      consecutivo: uploadData.consecutivo,
      fecha_pedido: uploadData.fecha_pedido,
      cliente: uploadData.cliente,
      nit: uploadData.nit,
      telefono: uploadData.telefono,
      direccion_envio: uploadData.direccion_envio,
      municipio: uploadData.municipio,
      departamento: uploadData.departamento,
      comercial: uploadData.comercial,
      comercial_id: comercialIdUp,
      plazo_pago: uploadData.plazo_pago,
      precio_facturacion: uploadData.precio_facturacion,
      total_orden: uploadData.total_orden,
      observaciones: uploadData.observaciones,
      productos: uploadData.productos.map(function(p) {
        return { producto: p.producto, presentacion: p.presentacion, cantidad: p.cantidad,
                 valor_unitario: p.valor_unitario, valor_total: p.valor_total, bonificado: p.bonificado || '' };
      }),
      archivo_fuente: uploadData.archivo_fuente,
    });
    if (!result.ok) throw new Error(result.error || 'Error al cargar');
    await agregarProductosNuevosAlMaestro(uploadData.productos, uploadData.nombre_empresa);
    generarPedidoPDF({
      empresa: uploadData.nombre_empresa,
      consecutivo: uploadData.consecutivo,
      fecha: uploadData.fecha_pedido,
      cliente: uploadData.cliente,
      nit: uploadData.nit,
      telefono: uploadData.telefono,
      direccion: uploadData.direccion_envio,
      municipio: uploadData.municipio,
      departamento: uploadData.departamento,
      comercial: uploadData.comercial,
      plazo: uploadData.plazo_pago,
      precio: uploadData.precio_facturacion,
      bodega_facturacion: uploadData.bodega_facturacion || '',
      observaciones: uploadData.observaciones,
      total: uploadData.total_orden,
      productos: uploadData.productos,
      archivo: uploadData.archivo_fuente
    });
    closeUpload();
    showToast('Pedido cargado: ' + (result.added||0) + ' linea(s) agregadas');
    await loadFromAPI();
  } catch (err) {
    showToast('Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '📥 Cargar pedido';
  }
}

// ── Delete Order ──
var deleteIdx = null;

function openDelete(idx) {
  deleteIdx = idx;
  var c = consecs[idx];
  var lines = getLinesFor(c);
  var est = derivedStatus(lines);
  document.getElementById('del-msg').textContent = '¿Eliminar el pedido #' + (c.Consecutivo||'') + ' de ' + getSigla(c.Nombre_Empresa) + '?';
  document.getElementById('del-detail').innerHTML =
    'Cliente: <strong>' + (c.Cliente||'—') + '</strong><br>' +
    'Productos: ' + lines.length + ' línea(s) · Estado: ' + est + '<br>' +
    'Total: ' + fmtMoney(c.Total_Orden) + '<br><br>' +
    '<span style="color:#e74c3c;font-weight:700">Se eliminarán todas las líneas de este pedido de la base de datos.</span>';
  document.getElementById('btn-del-confirm').disabled = false;
  document.getElementById('btn-del-confirm').textContent = '🗑️ Sí, eliminar';
  document.getElementById('delete-overlay').classList.add('show');
}

function closeDelete() {
  document.getElementById('delete-overlay').classList.remove('show');
  deleteIdx = null;
}

document.getElementById('delete-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeDelete(); });

async function confirmDelete() {
  if (deleteIdx === null) return;
  var c = consecs[deleteIdx];
  var btn = document.getElementById('btn-del-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Eliminando...';

  try {
    var result = await apiPost({
      action: 'eliminarPedido',
      empresa: c.Nombre_Empresa,
      consecutivo: String(c.Consecutivo)
    });
    if (!result.ok) throw new Error(result.error || 'Error al eliminar');
    closeDelete();
    showToast('🗑️ Pedido eliminado: ' + (result.deleted||0) + ' línea(s) removidas');
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '🗑️ Sí, eliminar';
  }
}

// ── Autocomplete ──
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

var clientesCache = null;
var productosCache = null;
var listaPreciosCache = null;
var clienteAC = null;
var nitAC = null;
var nlProdAC = null;
var productoACs = [];
var edProdACs = [];
var geoACs = { nv: null, md: null, ed: null };

function _extraerPresentacion(nombre) {
  if (!nombre) return '';
  var s = String(nombre).trim();
  var patterns = [
    /\b(bid[oó]n\s+\d+\s*(?:litros?|lts?|l))\b/i,
    /\b(caneca\s+\d+\s*(?:litros?|lts?|l))\b/i,
    /\b(garrafa\s+\d+\s*(?:litros?|lts?|l))\b/i,
    /\b(tambor\s+\d+\s*(?:litros?|lts?|l|galones?))\b/i,
    /\b(frasco\s+\d+\s*(?:ml|cc|litros?|lts?|l|g|gr|oz))\b/i,
    /\b(bolsa\s+\d+\s*(?:kg|g|gr|lb|litros?|lts?|l|ml))\b/i,
    /\b(saco\s+\d+\s*(?:kg|lb))\b/i,
    /\b(bulto\s+\d+\s*(?:kg|lb))\b/i,
    /\b(caja\s+\d+\s*(?:unidades|uds?|kg|g|gr|litros?|lts?|l))\b/i,
    /\b(sobre\s+\d+\s*(?:g|gr|ml|cc))\b/i,
    /\b(\d+\s*(?:x\s*\d+\s*)?galones?)\b/i,
    /\b(\d+\s*(?:x\s*\d+\s*)?litros?)\b/i,
    /\b(\d+\s*(?:x\s*\d+\s*)?lts?)\b/i,
    /\b(\d+\s*l)\b(?![\wáéíóú])/i,
    /\b(\d+\s*ml)\b/i,
    /\b(\d+\s*cc)\b/i,
    /\b(\d+\s*(?:x\s*\d+\s*)?kg)\b/i,
    /\b(\d+\s*g(?:r(?:amos?)?)?)\b(?!\s*al)/i,
    /\b(\d+\s*lb)\b/i,
    /\b(\d+\s*oz)\b/i,
    /\b(gal[oó]n)\b/i,
    /\b(litro)\b/i,
  ];
  for (var pi = 0; pi < patterns.length; pi++) {
    var m = s.match(patterns[pi]);
    if (m) return m[1].trim();
  }
  return '';
}

function _autoFillPresentacion(productoNombre, empresa) {
  if (!productoNombre) return '';
  var prodNorm = productoNombre.toLowerCase().trim();
  if (productosCache) {
    var filtrados = empresa
      ? productosCache.filter(function(p) { return !p.empresa || p.empresa === empresa; })
      : productosCache;
    for (var i = 0; i < filtrados.length; i++) {
      if ((filtrados[i].producto || '').toLowerCase().trim() === prodNorm) {
        if (filtrados[i].presentacion) return filtrados[i].presentacion;
        break;
      }
    }
  }
  return _extraerPresentacion(productoNombre);
}

function destroyGeoAC(key) {
  if (geoACs[key]) {
    if (geoACs[key].deptAC) geoACs[key].deptAC.destroy();
    if (geoACs[key].muniAC) geoACs[key].muniAC.destroy();
    geoACs[key] = null;
  }
}

async function loadAutocompleteData() {
  var promises = [];
  if (!clientesCache) promises.push(apiGet('getClientesUnicos').then(function(r) { if (r.ok) clientesCache = r.clientes || []; }).catch(function() { clientesCache = []; }));
  if (!productosCache) promises.push(apiGet('getMaestroProductos').then(function(r) { if (r.ok) productosCache = r.productos || []; }).catch(function() { productosCache = []; }));
  if (!listaPreciosCache) promises.push(apiGet('getListaPrecios').then(function(r) { if (r.ok) listaPreciosCache = r.precios || []; }).catch(function() { listaPreciosCache = []; }));
  if (promises.length) await Promise.all(promises);
  _mergePreciosEmbedded();
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

function destroyProductoACs() { productoACs.forEach(function(ac) { ac.destroy(); }); productoACs = []; }

function _normStr(s) { return (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' '); }

function _lookupPrecio(empresa, tipoPrecio, productoNombre) {
  if (!listaPreciosCache || !empresa || !tipoPrecio || !productoNombre) return null;
  var empNorm = _normStr(empresa);
  var tipoNorm = _normStr(tipoPrecio);
  var prodNorm = _normStr(productoNombre);
  for (var i = 0; i < listaPreciosCache.length; i++) {
    var lp = listaPreciosCache[i];
    if (_normStr(lp.Empresa) === empNorm &&
        _normStr(lp.Tipo_Precio) === tipoNorm &&
        _normStr(lp.Producto) === prodNorm) {
      return Number(lp.Precio) || 0;
    }
  }
  return null;
}

function _reapplyPreciosNuevo() {
  syncNuevoFromDOM();
  var prodInputs = document.querySelectorAll('.nv-prod');
  for (var j = 0; j < prodInputs.length; j++) {
    if (prodInputs[j].value.trim()) _applyPrecioToLine(j);
  }
}

function _applyPrecioToLine(lineIdx) {
  var empresa = document.getElementById('nv-empresa').value;
  var tipoPrecio = document.getElementById('nv-precio').value.trim();
  var prodInputs = document.querySelectorAll('.nv-prod');
  var vuniInputs = document.querySelectorAll('.nv-vuni');
  var bonifInputs = document.querySelectorAll('.nv-bonif');
  if (!prodInputs[lineIdx] || !vuniInputs[lineIdx]) return;
  var esBonif = bonifInputs[lineIdx] && bonifInputs[lineIdx].checked;
  if (esBonif) {
    vuniInputs[lineIdx].value = 1;
    syncNuevoFromDOM();
    updateNuevoLine(lineIdx);
    return;
  }
  var producto = prodInputs[lineIdx].value.trim();
  var precio = _lookupPrecio(empresa, tipoPrecio, producto);
  if (precio !== null) {
    vuniInputs[lineIdx].value = precio;
    syncNuevoFromDOM();
    updateNuevoLine(lineIdx);
  }
}

function setupProductoAutocomplete() {
  destroyProductoACs();
  if (!productosCache) return;
  [].slice.call(document.querySelectorAll('.nv-prod')).forEach(function(input, i) {
    productoACs.push(initAutocomplete(input, {
      items: function() {
        var emp = document.getElementById('nv-empresa').value;
        var prods = productosCache || [];
        if (emp) prods = prods.filter(function(p) { return !p.empresa || p.empresa === emp; });
        return prods;
      },
      display: function(p) {
        return '<strong>' + escHtml(p.producto) + '</strong>' +
               (p.presentacion ? ' <span class="ac-sub">— ' + escHtml(p.presentacion) + '</span>' : '');
      },
      match: function(p, val) {
        return ((p.producto||'') + ' ' + (p.presentacion||'')).toLowerCase().indexOf(val) >= 0;
      },
      onSelect: function(p) {
        input.value = p.producto || '';
        var presInputs = document.querySelectorAll('.nv-pres');
        if (presInputs[i]) presInputs[i].value = p.presentacion || '';
        syncNuevoFromDOM();
        _applyPrecioToLine(i);
      }
    }));
    input.addEventListener('blur', function() {
      var idx = [].slice.call(document.querySelectorAll('.nv-prod')).indexOf(input);
      if (idx >= 0 && input.value.trim()) {
        var presInput = document.querySelectorAll('.nv-pres')[idx];
        if (presInput && !presInput.value.trim()) {
          var emp = document.getElementById('nv-empresa').value;
          var pres = _autoFillPresentacion(input.value.trim(), emp);
          if (pres) presInput.value = pres;
          syncNuevoFromDOM();
        }
        _applyPrecioToLine(idx);
      }
    });
  });
}

// ── New Order Manual Entry ──
function getLastOrderForClient(clienteName) {
  if (!clienteName || !pedidos.length) return null;
  var normClient = clienteName.toLowerCase().trim();
  var clientOrders = pedidos.filter(function(p) {
    return (p.Cliente || '').toLowerCase().trim() === normClient;
  });
  if (!clientOrders.length) return null;
  clientOrders.sort(function(a, b) {
    return +new Date(b.Fecha_Pedido || 0) - +new Date(a.Fecha_Pedido || 0);
  });
  return clientOrders[0];
}

var _sucursalMap = {};
function _populateSucursalDL(clienteName) {
  var seen = {};
  var opts = [];
  _sucursalMap = {};
  if (!clienteName) return;
  var normCli = clienteName.toLowerCase().trim();
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
  if (clientesCache) {
    clientesCache.forEach(function(c) {
      if ((c.cliente || '').toLowerCase().trim() !== normCli) return;
      addEntry(c.municipio, c.direccion_envio || c.direccion, '', c.departamento);
    });
  }
  pedidos.forEach(function(p) {
    if ((p.Cliente || '').toLowerCase().trim() !== normCli) return;
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
      _sucursalMap[key] = {
        direccion: e.dir,
        municipio: e.mun,
        departamento: e.dep
      };
    });
  });
  var dl = document.getElementById('dl-sucursal');
  if (dl) dl.innerHTML = opts.map(function(o) {
    return '<option value="' + o.replace(/"/g, '&quot;') + '">';
  }).join('');
}

function _onSucursalChange(prefix) {
  var val = document.getElementById(prefix + '-sucursal').value.trim().toLowerCase();
  var match = _sucursalMap[val];
  if (!match) return;
  var dirEl = document.getElementById(prefix + '-direccion');
  if (dirEl) dirEl.value = match.direccion;
  var munEl = document.getElementById(prefix + '-municipio');
  if (munEl) munEl.value = match.municipio;
  var depEl = document.getElementById(prefix + '-departamento');
  if (depEl) depEl.value = match.departamento;
}

var nuevoProductos = [];

function populateNuevoDataLists() {
  var plazos = {};
  pedidos.forEach(function(p) {
    var pl = (p.Plazo_Pago || '').trim();
    if (pl) plazos[pl] = true;
  });
  document.getElementById('dl-plazo').innerHTML = Object.keys(plazos).sort().map(function(v) {
    return '<option value="' + v.replace(/"/g, '&quot;') + '">';
  }).join('');
}

function populateComercialSelect(empresa) {
  var dl = document.getElementById('dl-comercial');
  var seen = {};
  var list = [];
  pedidos.forEach(function(p) {
    if (empresa && (p.Nombre_Empresa || '') !== empresa) return;
    var c = (p.Comercial || '').trim();
    if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = true; list.push(c); }
  });
  list.sort(function(a, b) { return a.localeCompare(b, 'es'); });
  dl.innerHTML = list.map(function(c) { return '<option value="' + c.replace(/"/g, '&quot;') + '">'; }).join('');
}

function nextConsecutivoPorComercial(comercial) {
  if (!comercial) return '';
  var cLow = comercial.trim().toLowerCase();
  var max = 0;
  pedidos.forEach(function(p) {
    if ((p.Comercial || '').trim().toLowerCase() === cLow) {
      var n = Number(p.Consecutivo) || 0;
      if (n > max) max = n;
    }
  });
  return max + 1;
}

function actualizarConsecutivoNuevo() {
  var comercial = document.getElementById('nv-comercial').value.trim();
  document.getElementById('nv-consecutivo').value = comercial ? nextConsecutivoPorComercial(comercial) : '';
}

function _normBodegaFacturacion(v) {
  if (v === 'Productos Buenos' || v === 'Bodega principal') return 'Bodega Principal';
  return v;
}

function _toggleBodegaField(prefix, empresa) {
  var wrap = document.getElementById(prefix + '-bodega-wrap');
  if (!wrap) return;
  wrap.style.display = (getSigla(empresa) === 'PARCELAR') ? '' : 'none';
  var sel = document.getElementById(prefix + '-bodega-facturacion');
  if (!sel) return;
  if (wrap.style.display === 'none') {
    sel.value = '';
  } else if (!sel.value) {
    sel.value = 'Bodega Principal';
  }
}

async function openNuevoPedido() {
  document.getElementById('nv-empresa').value = '';
  document.getElementById('nv-consecutivo').value = '';
  var nvFecha = document.getElementById('nv-fecha');
  nvFecha.value = today();
  nvFecha.min = today();
  if (!AUTH.isAdmin()) {
    nvFecha.readOnly = true;
    nvFecha.style.background = '#f0f0f0';
  } else {
    nvFecha.readOnly = false;
    nvFecha.style.background = '';
  }
  document.getElementById('nv-cliente').value = '';
  document.getElementById('nv-nit').value = '';
  document.getElementById('nv-sucursal').value = '';
  document.getElementById('nv-comercial').value = '';
  document.getElementById('nv-telefono').value = '';
  document.getElementById('nv-direccion').value = '';
  document.getElementById('nv-municipio').value = '';
  document.getElementById('nv-departamento').value = '';
  document.getElementById('nv-plazo').value = '';
  document.getElementById('nv-precio').value = '';
  document.getElementById('nv-facturar-a').value = '';
  document.getElementById('nv-facturar-a').removeAttribute('data-edited');
  document.getElementById('nv-nit-adicional').value = '';
  document.getElementById('nv-consignacion').value = 'No';
  document.getElementById('nv-bodega-facturacion').value = '';
  document.getElementById('nv-bodega-facturacion').removeAttribute('data-edited');
  _toggleBodegaField('nv', '');
  document.getElementById('nv-observaciones').value = '';
  document.getElementById('nv-cupo-info').style.display = 'none';
  document.getElementById('nv-dup-warn').style.display = 'none';
  document.getElementById('btn-guardar-nuevo').disabled = false;
  document.getElementById('btn-guardar-nuevo').textContent = '✏️ Guardar pedido';
  nuevoProductos = [{ producto:'', presentacion:'', cantidad:0, valor_unitario:0, valor_total:0, bonificado:'' }];
  populateComercialSelect('');
  var nvEmpSel = document.getElementById('nv-empresa');
  nvEmpSel.onchange = function() {
    document.getElementById('nv-comercial').value = '';
    populateComercialSelect(nvEmpSel.value);
    actualizarConsecutivoNuevo();
    _toggleBodegaField('nv', nvEmpSel.value);
    document.getElementById('nv-bodega-facturacion').removeAttribute('data-edited');
    _reapplyPreciosNuevo();
  };
  document.getElementById('nv-bodega-facturacion').onchange = function() {
    this.setAttribute('data-edited', '1');
  };
  var nvPrecioEl = document.getElementById('nv-precio');
  nvPrecioEl.oninput = function() { _reapplyPreciosNuevo(); _toggleNvProductos(); };
  nvPrecioEl.onchange = function() { _reapplyPreciosNuevo(); _toggleNvProductos(); };
  document.getElementById('nv-comercial').oninput = actualizarConsecutivoNuevo;
  document.getElementById('nv-cliente').addEventListener('input', function() {
    var fa = document.getElementById('nv-facturar-a');
    if (!fa.dataset.edited) fa.value = this.value;
  });
  document.getElementById('nv-facturar-a').addEventListener('input', function() {
    this.dataset.edited = '1';
  });
  populateNuevoDataLists();
  renderNuevoLines();
  // Rol 'comercial': fija el campo Comercial al código por empresa y lo bloquea.
  if (AUTH.isComercial && AUTH.isComercial()) {
    var _setComercialPorEmpresa = function() {
      var emp = document.getElementById('nv-empresa').value;
      var nvC = document.getElementById('nv-comercial');
      if (!nvC) return;
      var sigla = (typeof getSigla === 'function') ? getSigla(emp) : emp;
      var code = AUTH.getComercialCodigo(sigla) || AUTH.getComercialCodigo(emp);
      var prof = AUTH.getProfile();
      var val = code || (prof && prof.nombre) || '';
      nvC.value = val;
      nvC.readOnly = true;
      nvC.style.background = '#f1f5f9';
      nvC.title = code
        ? 'Código de comercial para esta empresa: ' + code
        : 'No tienes código de comercial para esta empresa — pedí al admin que lo asigne';
    };
    var _nvEmpEl = document.getElementById('nv-empresa');
    if (_nvEmpEl) {
      var _prevOnChange = _nvEmpEl.onchange;
      _nvEmpEl.onchange = function() {
        if (_prevOnChange) _prevOnChange.call(this);
        _setComercialPorEmpresa();
        actualizarConsecutivoNuevo();
      };
    }
    _setComercialPorEmpresa();
  }
  document.getElementById('nuevo-overlay').classList.add('show');

  await loadAutocompleteData();
  if (clienteAC) { clienteAC.destroy(); clienteAC = null; }
  clienteAC = initAutocomplete(document.getElementById('nv-cliente'), {
    items: function() {
      var emp = document.getElementById('nv-empresa').value;
      var cls = clientesCache || [];
      if (emp) {
        var exact = cls.filter(function(c) { return c.empresa === emp; });
        cls = exact.length ? exact : cls;
      }
      var seen = {};
      return cls.filter(function(c) {
        var key = (c.cliente || '').toLowerCase() + '|' + (c.nit || '').toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    },
    display: function(c) {
      var sigla = c.empresa ? getSigla(c.empresa) : '';
      var badge = sigla ? '<span class="ac-badge sigla-badge ' + getSiglaClass(c.empresa) + '">' + escHtml(sigla) + '</span> ' : '';
      return badge + '<strong>' + escHtml(c.cliente) + '</strong>' +
             (c.nit ? '<div class="ac-sub">' + escHtml(c.tipo_identificacion || 'NIT') + ': ' + escHtml(c.nit) + '</div>' : '') +
             (c.municipio ? '<div class="ac-sub">' + escHtml(c.municipio) + '</div>' : '');
    },
    match: function(c, val) {
      return ((c.cliente||'') + ' ' + (c.nit||'') + ' ' + (c.municipio||'') + ' ' + (c.telefono||'')).toLowerCase().indexOf(val) >= 0;
    },
    onSelect: function(c) {
      document.getElementById('nv-cliente').value = c.cliente || '';
      document.getElementById('nv-facturar-a').value = c.cliente || '';
      if (c.nit) document.getElementById('nv-nit').value = c.nit;
      if (c.telefono) document.getElementById('nv-telefono').value = c.telefono;
      if (c.plazo_pago) document.getElementById('nv-plazo').value = c.plazo_pago;
      if (c.lista_precio) document.getElementById('nv-precio').value = c.lista_precio;
      var cupoEl = document.getElementById('nv-cupo-info');
      if (c.cupo_credito && c.cupo_credito !== 'NA') {
        document.getElementById('nv-cupo-text').textContent = 'Cupo Crédito: ' + fmtMoney(Number(c.cupo_credito) || 0);
        cupoEl.style.display = 'block';
      } else if (c.cupo_credito === 'NA') {
        document.getElementById('nv-cupo-text').textContent = 'Cupo Crédito: No aplica';
        cupoEl.style.display = 'block';
      } else {
        cupoEl.style.display = 'none';
      }
      _populateSucursalDL(c.cliente);
      var multiDir = Object.keys(_sucursalMap).length > 1;
      document.getElementById('nv-sucursal').value = '';
      if (!multiDir) {
        if (c.direccion_envio) {
          document.getElementById('nv-direccion').value = c.direccion_envio;
        } else if (c.direccion) {
          document.getElementById('nv-direccion').value = c.direccion;
        }
        if (c.municipio) document.getElementById('nv-municipio').value = c.municipio;
        if (c.departamento) document.getElementById('nv-departamento').value = c.departamento;
      }
      var lastOrder = getLastOrderForClient(c.cliente);
      if (lastOrder) {
        if (!multiDir) {
          if (!c.direccion_envio && lastOrder.Direccion_Envio) document.getElementById('nv-direccion').value = lastOrder.Direccion_Envio;
          if (!c.municipio && lastOrder.Municipio) document.getElementById('nv-municipio').value = lastOrder.Municipio;
          if (!c.departamento && lastOrder.Departamento) document.getElementById('nv-departamento').value = lastOrder.Departamento;
          if (lastOrder.Sucursal) document.getElementById('nv-sucursal').value = lastOrder.Sucursal;
        }
        if (lastOrder.Facturar_A) document.getElementById('nv-facturar-a').value = lastOrder.Facturar_A;
        if (lastOrder.NIT_Adicional) document.getElementById('nv-nit-adicional').value = lastOrder.NIT_Adicional;
        if (lastOrder.Consignacion) document.getElementById('nv-consignacion').value = lastOrder.Consignacion;
        var _bfEl = document.getElementById('nv-bodega-facturacion');
        if (lastOrder.Bodega_Facturacion && !_bfEl.dataset.edited) _bfEl.value = lastOrder.Bodega_Facturacion;
        if (lastOrder.Comercial && !document.getElementById('nv-comercial').value) {
          document.getElementById('nv-comercial').value = lastOrder.Comercial;
          actualizarConsecutivoNuevo();
        }
      }
      var emp = document.getElementById('nv-empresa').value;
      _toggleBodegaField('nv', emp);
      _reapplyPreciosNuevo(); _toggleNvProductos();
    }
  });
  if (nitAC) { nitAC.destroy(); nitAC = null; }
  nitAC = initAutocomplete(document.getElementById('nv-nit'), {
    minChars: 3,
    items: function() {
      var emp = document.getElementById('nv-empresa').value;
      var cls = (clientesCache || []).filter(function(c) { return c.nit; });
      if (emp) {
        var exact = cls.filter(function(c) { return c.empresa === emp; });
        if (exact.length) cls = exact;
      }
      var seen = {};
      return cls.filter(function(c) {
        var key = (c.cliente || '').toLowerCase() + '|' + (c.nit || '').toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    },
    display: function(c) {
      var sigla = c.empresa ? getSigla(c.empresa) : '';
      var badge = sigla ? '<span class="ac-badge sigla-badge ' + getSiglaClass(c.empresa) + '">' + escHtml(sigla) + '</span> ' : '';
      var tipoTag = c.tipo_identificacion ? '<span style="color:#718096;font-size:0.72rem">' + escHtml(c.tipo_identificacion) + '</span> ' : '';
      return badge + tipoTag + '<strong>' + escHtml(c.nit) + '</strong>' +
             '<div class="ac-sub">' + escHtml(c.cliente) + '</div>' +
             (c.municipio ? '<div class="ac-sub">' + escHtml(c.municipio) + '</div>' : '');
    },
    match: function(c, val) {
      var nitClean = (c.nit || '').replace(/[-.\s]/g, '').toLowerCase();
      var valClean = val.replace(/[-.\s]/g, '').toLowerCase().replace(/^(nit|cc|ce|ti|pa)\s*/i, '');
      return nitClean.indexOf(valClean) >= 0;
    },
    onSelect: function(c) {
      document.getElementById('nv-nit').value = c.nit || '';
      document.getElementById('nv-cliente').value = c.cliente || '';
      var fa = document.getElementById('nv-facturar-a');
      if (!fa.dataset.edited) fa.value = c.cliente || '';
      if (c.telefono) document.getElementById('nv-telefono').value = c.telefono;
      if (c.plazo_pago) document.getElementById('nv-plazo').value = c.plazo_pago;
      if (c.lista_precio) document.getElementById('nv-precio').value = c.lista_precio;
      if (c.cupo_credito && c.cupo_credito !== 'NA') {
        document.getElementById('nv-cupo-text').textContent = 'Cupo Crédito: ' + fmtMoney(Number(c.cupo_credito) || 0);
        document.getElementById('nv-cupo-info').style.display = 'block';
      } else {
        document.getElementById('nv-cupo-info').style.display = 'none';
      }
      _populateSucursalDL(c.cliente);
      var multiDir = Object.keys(_sucursalMap).length > 1;
      document.getElementById('nv-sucursal').value = '';
      if (!multiDir) {
        if (c.direccion_envio) {
          document.getElementById('nv-direccion').value = c.direccion_envio;
        } else if (c.direccion) {
          document.getElementById('nv-direccion').value = c.direccion;
        }
        if (c.municipio) document.getElementById('nv-municipio').value = c.municipio;
        if (c.departamento) document.getElementById('nv-departamento').value = c.departamento;
      }
      var lastOrder = getLastOrderForClient(c.cliente);
      if (lastOrder) {
        if (!multiDir) {
          if (!c.direccion_envio && lastOrder.Direccion_Envio) document.getElementById('nv-direccion').value = lastOrder.Direccion_Envio;
          if (!c.municipio && lastOrder.Municipio) document.getElementById('nv-municipio').value = lastOrder.Municipio;
          if (!c.departamento && lastOrder.Departamento) document.getElementById('nv-departamento').value = lastOrder.Departamento;
          if (lastOrder.Sucursal) document.getElementById('nv-sucursal').value = lastOrder.Sucursal;
        }
        if (lastOrder.Facturar_A) document.getElementById('nv-facturar-a').value = lastOrder.Facturar_A;
        if (lastOrder.NIT_Adicional) document.getElementById('nv-nit-adicional').value = lastOrder.NIT_Adicional;
        if (lastOrder.Consignacion) document.getElementById('nv-consignacion').value = lastOrder.Consignacion;
        var _bfEl2 = document.getElementById('nv-bodega-facturacion');
        if (lastOrder.Bodega_Facturacion && !_bfEl2.dataset.edited) _bfEl2.value = lastOrder.Bodega_Facturacion;
        if (lastOrder.Comercial && !document.getElementById('nv-comercial').value) {
          document.getElementById('nv-comercial').value = lastOrder.Comercial;
          actualizarConsecutivoNuevo();
        }
      }
      var emp = document.getElementById('nv-empresa').value;
      _toggleBodegaField('nv', emp);
      _reapplyPreciosNuevo(); _toggleNvProductos();
    }
  });
  setupProductoAutocomplete();
  destroyGeoAC('nv');
  geoACs.nv = setupGeoAutocomplete(
    document.getElementById('nv-departamento'),
    document.getElementById('nv-municipio')
  );
}

function closeNuevo() {
  document.getElementById('nuevo-overlay').classList.remove('show');
  nuevoProductos = [];
  if (clienteAC) { clienteAC.destroy(); clienteAC = null; }
  if (nitAC) { nitAC.destroy(); nitAC = null; }
  destroyProductoACs();
  destroyGeoAC('nv');
}

document.getElementById('nuevo-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeNuevo(); });
document.getElementById('nuevo-overlay').addEventListener('scroll', function() {
  [].slice.call(document.querySelectorAll('.ac-dropdown')).forEach(function(dd) { dd.style.display = 'none'; });
}, true);

document.getElementById('nv-sucursal').addEventListener('change', function() { _onSucursalChange('nv'); });
document.getElementById('md-sucursal').addEventListener('change', function() { _onSucursalChange('md'); });
document.getElementById('ed-sucursal').addEventListener('change', function() { _onSucursalChange('ed'); });

function _toggleNvProductos() {
  var precio = (document.getElementById('nv-precio').value || '').trim();
  var disabled = !precio;
  var wrap = document.querySelector('#nuevo-overlay .prod-wrap');
  if (wrap) {
    wrap.style.opacity = disabled ? '0.45' : '';
    wrap.style.pointerEvents = disabled ? 'none' : '';
  }
  var btnAdd = document.querySelector('#nuevo-overlay button[onclick*="addNuevoProducto"]');
  if (btnAdd) {
    btnAdd.disabled = disabled;
    btnAdd.style.opacity = disabled ? '0.45' : '';
  }
  var msg = document.getElementById('nv-precio-warn');
  if (!msg) {
    var ref = wrap || document.getElementById('nv-lines');
    if (ref && ref.parentNode) {
      msg = document.createElement('div');
      msg.id = 'nv-precio-warn';
      msg.style.cssText = 'color:#c0392b;font-size:0.8rem;font-weight:600;margin-bottom:6px;display:none';
      msg.textContent = 'Selecciona el Precio Facturación antes de agregar productos.';
      ref.parentNode.insertBefore(msg, ref);
    }
  }
  if (msg) msg.style.display = disabled ? '' : 'none';
}

function renderNuevoLines() {
  var tbody = document.getElementById('nv-lines');
  tbody.innerHTML = nuevoProductos.map(function(p, i) {
    var prod = (p.producto||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    var pres = (p.presentacion||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return '<tr>' +
      '<td style="color:#a0aec0;font-size:0.74rem">' + (i+1) + '</td>' +
      '<td><input class="ef nv-prod" data-i="' + i + '" type="text" value="' + prod + '" placeholder="Nombre del producto" style="min-width:260px"></td>' +
      '<td><input class="ef nv-pres" data-i="' + i + '" type="text" value="' + pres + '" placeholder="Ej: 1L, 20KG" style="width:100px"></td>' +
      '<td><input class="ef nv-cant" data-i="' + i + '" type="number" min="0" value="' + (p.cantidad||'') + '" placeholder="0" style="width:80px;text-align:right" oninput="updateNuevoLine(' + i + ')"></td>' +
      '<td><input class="ef nv-vuni" data-i="' + i + '" type="number" min="0" value="' + (p.valor_unitario||'') + '" placeholder="0" style="width:100px;text-align:right" oninput="updateNuevoLine(' + i + ')"></td>' +
      '<td><input class="ef nv-vtot" data-i="' + i + '" type="number" value="' + (p.valor_total||0) + '" style="width:100px;text-align:right;background:#f7fafc" readonly></td>' +
      '<td style="text-align:center"><input type="checkbox" class="nv-bonif" data-i="' + i + '"' + (p.bonificado === 'Sí' ? ' checked' : '') + ' onchange="onNvBonifChange(' + i + ',this.checked)"></td>' +
      '<td style="text-align:center">' +
        (nuevoProductos.length > 1
          ? '<button onclick="removeNuevoLine(' + i + ')" style="background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.78rem;font-weight:700">✕</button>'
          : '') +
      '</td></tr>';
  }).join('');
  updateNuevoTotal();
  setupProductoAutocomplete();
  _toggleNvProductos();
}

function updateNuevoLine(i) {
  syncNuevoFromDOM();
  var cant = nuevoProductos[i].cantidad;
  var vuni = nuevoProductos[i].valor_unitario;
  nuevoProductos[i].valor_total = cant * vuni;
  var vtots = document.querySelectorAll('.nv-vtot');
  if (vtots[i]) vtots[i].value = nuevoProductos[i].valor_total;
  updateNuevoTotal();
}

function onNvBonifChange(i, checked) {
  if (checked) {
    var vunis = document.querySelectorAll('.nv-vuni');
    if (vunis[i]) vunis[i].value = 1;
    updateNuevoLine(i);
  } else {
    _applyPrecioToLine(i);
  }
}

function updateNuevoTotal() {
  var total = nuevoProductos.reduce(function(s, p) { return s + (Number(p.valor_total)||0); }, 0);
  document.getElementById('nv-total-calc').textContent = fmtMoney(total);
}

function syncNuevoFromDOM() {
  var prods = document.querySelectorAll('.nv-prod');
  var press = document.querySelectorAll('.nv-pres');
  var cants = document.querySelectorAll('.nv-cant');
  var vunis = document.querySelectorAll('.nv-vuni');
  var vtots = document.querySelectorAll('.nv-vtot');
  var bonifs = document.querySelectorAll('.nv-bonif');
  nuevoProductos.forEach(function(p, i) {
    p.producto = prods[i] ? prods[i].value.trim() : '';
    p.presentacion = press[i] ? press[i].value.trim() : '';
    p.cantidad = Number(cants[i] && cants[i].value) || 0;
    p.valor_unitario = Number(vunis[i] && vunis[i].value) || 0;
    p.valor_total = Number(vtots[i] && vtots[i].value) || 0;
    p.bonificado = bonifs[i] && bonifs[i].checked ? 'Sí' : '';
  });
}

function addNuevoProducto() {
  syncNuevoFromDOM();
  nuevoProductos.push({ producto:'', presentacion:'', cantidad:0, valor_unitario:0, valor_total:0, bonificado:'' });
  renderNuevoLines();
  var wrap = document.querySelector('#nuevo-overlay .prod-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function removeNuevoLine(i) {
  syncNuevoFromDOM();
  nuevoProductos.splice(i, 1);
  renderNuevoLines();
}

async function guardarNuevoPedido() {
  syncNuevoFromDOM();

  var empresa = document.getElementById('nv-empresa').value;
  var consecutivo = document.getElementById('nv-consecutivo').value.trim();
  var fecha = document.getElementById('nv-fecha').value;
  var cliente = document.getElementById('nv-cliente').value.trim();

  if (!empresa) { showToast('Selecciona la empresa', '#e74c3c'); return; }
  if (!consecutivo) { showToast('Selecciona un comercial para generar el consecutivo', '#e74c3c'); return; }
  if (!fecha) { showToast('Selecciona la fecha del pedido', '#e74c3c'); return; }
  if (!AUTH.isAdmin() && fecha < today()) { showToast('La fecha del pedido no puede ser anterior a hoy', '#e74c3c'); return; }
  if (!cliente) { showToast('Ingresa el nombre del cliente', '#e74c3c'); return; }
  if (getSigla(empresa) === 'PARCELAR' && !document.getElementById('nv-bodega-facturacion').value) {
    showToast('Selecciona la Bodega de Facturación', '#e74c3c'); return;
  }

  var productosValidos = nuevoProductos.filter(function(p) { return p.producto && p.cantidad > 0; });
  if (!productosValidos.length) { showToast('Agrega al menos un producto con cantidad', '#e74c3c'); return; }

  var btn = document.getElementById('btn-guardar-nuevo');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    var dupResult = await apiPost({
      action: 'checkDuplicado',
      consecutivo: consecutivo,
      cliente: cliente,
      fecha_pedido: fecha,
      nombre_empresa: empresa
    });
    if (dupResult.ok && dupResult.duplicado) {
      document.getElementById('nv-dup-warn').style.display = 'block';
    }

    var totalOrden = productosValidos.reduce(function(s, p) { return s + (Number(p.valor_total)||0); }, 0);

    var nvComercial = document.getElementById('nv-comercial').value.trim();
    var comercialIdNv = await _resolveComercialId(nvComercial);
    var result = await apiPost({
      action: 'agregarPedido',
      nombre_empresa: empresa,
      consecutivo: consecutivo,
      fecha_pedido: fecha,
      cliente: cliente,
      nit: document.getElementById('nv-nit').value.trim(),
      sucursal: document.getElementById('nv-sucursal').value.trim(),
      telefono: document.getElementById('nv-telefono').value.trim(),
      direccion_envio: document.getElementById('nv-direccion').value.trim(),
      municipio: document.getElementById('nv-municipio').value.trim(),
      departamento: document.getElementById('nv-departamento').value.trim(),
      comercial: nvComercial,
      comercial_id: comercialIdNv,
      plazo_pago: document.getElementById('nv-plazo').value.trim(),
      precio_facturacion: document.getElementById('nv-precio').value.trim(),
      facturar_a: document.getElementById('nv-facturar-a').value.trim() || cliente,
      nit_adicional: document.getElementById('nv-nit-adicional').value.trim(),
      consignacion: document.getElementById('nv-consignacion').value,
      bodega_facturacion: document.getElementById('nv-bodega-facturacion').value,
      total_orden: totalOrden,
      observaciones: document.getElementById('nv-observaciones').value.trim(),
      productos: productosValidos.map(function(p) {
        return { producto: p.producto, presentacion: p.presentacion, cantidad: p.cantidad,
                 valor_unitario: p.valor_unitario, valor_total: p.valor_total, bonificado: p.bonificado };
      }),
      archivo_fuente: 'Ingreso manual',
    });

    if (!result.ok) throw new Error(result.error || 'Error al guardar');

    await agregarProductosNuevosAlMaestro(productosValidos, empresa);
    generarPedidoPDF({
      empresa: empresa,
      consecutivo: consecutivo,
      fecha: fecha,
      cliente: cliente,
      nit: document.getElementById('nv-nit').value.trim(),
      sucursal: document.getElementById('nv-sucursal').value.trim(),
      telefono: document.getElementById('nv-telefono').value.trim(),
      direccion: document.getElementById('nv-direccion').value.trim(),
      municipio: document.getElementById('nv-municipio').value.trim(),
      departamento: document.getElementById('nv-departamento').value.trim(),
      comercial: document.getElementById('nv-comercial').value.trim(),
      plazo: document.getElementById('nv-plazo').value.trim(),
      precio: document.getElementById('nv-precio').value.trim(),
      facturar_a: document.getElementById('nv-facturar-a').value.trim() || cliente,
      nit_adicional: document.getElementById('nv-nit-adicional').value.trim(),
      consignacion: document.getElementById('nv-consignacion').value,
      bodega_facturacion: document.getElementById('nv-bodega-facturacion').value,
      observaciones: document.getElementById('nv-observaciones').value.trim(),
      total: totalOrden,
      productos: productosValidos,
      archivo: 'Ingreso manual'
    });
    closeNuevo();
    showToast('✅ Pedido creado: ' + (result.added||0) + ' línea(s) agregadas');
    await loadFromAPI();
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '✏️ Guardar pedido';
  }
}

// ── Tab switching ──
function switchPedidoTab(tab) {
  var tabs = ['ordenes', 'detalle', 'despachos'];
  tabs.forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var btn = document.getElementById('tab-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) btn.style.background = t === tab ? '#1a5276' : '#718096';
  });
  if (tab === 'detalle') renderDetalle();
  if (tab === 'despachos') buildDespachos();
}

function initDespachosTab() {
  var btn = document.getElementById('tab-despachos');
  if (!btn) return;
  btn.style.display = 'inline-block';
  if (AUTH.isDespachador()) {
    document.getElementById('tab-ordenes').style.display = 'none';
    document.getElementById('tab-detalle').style.display = 'none';
    var stats = document.querySelector('.stats');
    if (stats) stats.style.display = 'none';
    var filters = document.querySelector('.filters');
    if (filters) filters.style.display = 'none';
    switchPedidoTab('despachos');
  }
  var despEmpSel = document.getElementById('desp-f-empresa');
  if (despEmpSel) {
    despEmpSel.addEventListener('change', function() { renderDespachos(); });
  }
  var despBuscar = document.getElementById('desp-f-buscar');
  if (despBuscar) {
    despBuscar.addEventListener('input', function() { renderDespachos(); });
  }
}

// ── Vista Detallada (read-only) ──
var detSort = [{ col: 'empresa', dir: 'asc' }];

function toggleDetSort(col, e) {
  var shift = e && e.shiftKey;
  var idx = detSort.findIndex(function(l) { return l.col === col; });
  if (shift) {
    if (idx >= 0) detSort.splice(idx, 1);
    else detSort.push({ col: col, dir: col === 'cantidad' || col === 'pendiente' ? 'desc' : 'asc' });
  } else {
    if (idx >= 0) {
      if (detSort[idx].dir === 'asc') detSort[idx].dir = 'desc';
      else detSort.splice(idx, 1);
    } else {
      detSort = [{ col: col, dir: col === 'cantidad' || col === 'pendiente' ? 'desc' : 'asc' }];
    }
  }
  renderDetalle();
}

function renderDetalle() {
  var fe = document.getElementById('f-emp').value;
  var fcomEl = document.getElementById('f-com');
  var fcom = fcomEl ? fcomEl.value : '';
  var fc = document.getElementById('f-cli').value;
  var fs = document.getElementById('f-est').value;
  var fs2 = document.getElementById('f-est2').value;
  var fpEl = document.getElementById('f-prod');
  var fp = fpEl ? fpEl.value.trim().toLowerCase() : '';
  var fdEl = document.getElementById('f-fec-desde');
  var fhEl = document.getElementById('f-fec-hasta');
  var fdesde = fdEl ? fdEl.value : '';
  var fhasta = fhEl ? fhEl.value : '';
  var ft = document.getElementById('f-txt').value.toLowerCase();
  var fmunis = _muniSelected.slice();

  var rows = pedidos.filter(function(p) {
    if (fe && p.Nombre_Empresa !== fe) return false;
    if (fcom && (p.Comercial || '').trim() !== fcom) return false;
    if (fc && (p.Cliente || '').toLowerCase().indexOf(fc.toLowerCase()) < 0) return false;
    if (fmunis.length && fmunis.indexOf((p.Municipio||'').trim()) < 0) return false;
    if (fdesde || fhasta) {
      var fp10 = String(p.Fecha_Pedido || '').slice(0, 10);
      if (!fp10) return false;
      if (fdesde && fp10 < fdesde) return false;
      if (fhasta && fp10 > fhasta) return false;
    }
    if (fp && String(p.Producto || '').toLowerCase().indexOf(fp) < 0) return false;
    if (fs) {
      var rawEst = norm(p.Estado_Entrega || 'Recibido');
      if (rawEst !== norm(fs)) return false;
    }
    if (fs2) {
      var e2 = (p.Estado_2 || 'Abierto').trim();
      if (e2 !== fs2) return false;
    }
    if (ft) {
      var hay = [p.Cliente, String(p.Consecutivo), getSigla(p.Nombre_Empresa), p.Comercial, p.Producto].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });

  if (detSort.length) {
    rows = [].concat(rows).sort(function(a, b) {
      for (var s = 0; s < detSort.length; s++) {
        var col = detSort[s].col, dir = detSort[s].dir;
        var va, vb;
        if (col === 'empresa') { va = getSigla(a.Nombre_Empresa); vb = getSigla(b.Nombre_Empresa); }
        else if (col === 'cliente') { va = (a.Cliente||'').toLowerCase(); vb = (b.Cliente||'').toLowerCase(); }
        else if (col === 'consecutivo') { va = Number(a.Consecutivo)||0; vb = Number(b.Consecutivo)||0; }
        else if (col === 'producto') { va = (a.Producto||'').toLowerCase(); vb = (b.Producto||'').toLowerCase(); }
        else if (col === 'presentacion') { va = (a.Presentacion||'').toLowerCase(); vb = (b.Presentacion||'').toLowerCase(); }
        else if (col === 'cantidad') { va = Number(a.Cantidad)||0; vb = Number(b.Cantidad)||0; }
        else if (col === 'pendiente') { va = Number(a.Cant_Pendiente)||0; vb = Number(b.Cant_Pendiente)||0; }
        else if (col === 'estado') { va = (a.Estado_Entrega||'Recibido'); vb = (b.Estado_Entrega||'Recibido'); }
        else if (col === 'estado2') { va = (a.Estado_2||'Abierto'); vb = (b.Estado_2||'Abierto'); }
        else if (col === 'fecha') { va = +(new Date(a.Fecha_Pedido||0)); vb = +(new Date(b.Fecha_Pedido||0)); }
        else { va = ''; vb = ''; }
        var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  document.getElementById('det-count').textContent = '(' + rows.length + ' líneas)';

  var cols = [
    { id: 'empresa', label: 'Empresa' },
    { id: 'cliente', label: 'Cliente' },
    { id: 'consecutivo', label: 'Consecutivo' },
    { id: 'fecha', label: 'Fecha Pedido' },
    { id: 'producto', label: 'Producto' },
    { id: 'presentacion', label: 'Presentación' },
    { id: 'cantidad', label: 'Cant. Pedida' },
    { id: 'pendiente', label: 'Pendiente' },
    { id: 'estado', label: 'Estado' },
    { id: 'estado2', label: 'Estado 2' },
  ];

  document.getElementById('det-head').innerHTML = cols.map(function(c) {
    var idx = detSort.findIndex(function(l) { return l.col === c.id; });
    var cls = idx >= 0 ? (detSort[idx].dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = idx >= 0 && detSort.length > 1 ? '<span style="font-size:0.6rem;vertical-align:super;color:#2980b9">' + (idx+1) + '</span>' : '';
    return '<th class="sortable ' + cls + '" onclick="toggleDetSort(\'' + c.id + '\',event)">' + c.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');

  var tbody = document.getElementById('det-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No hay líneas con los filtros seleccionados.</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(p) {
    var est = (p.Estado_Entrega || 'Recibido').trim();
    var est2 = (p.Estado_2 || 'Abierto').trim();
    var badgeEst = norm(est) === 'recibido' ? 'b-rec' : norm(est) === 'parcial' ? 'b-par' : norm(est) === 'alistado' ? 'b-alistado' : 'b-ent';
    var badgeEst2 = est2 === 'Abierto' ? 'b-abierto' : est2 === 'Alistado' ? 'b-alistado' : est2 === 'Cerrado' ? 'b-cerrado' : est2 === 'Bloqueado por cartera' ? 'b-bloqueado' : est2 === 'Entregado por proveedor' ? 'b-entregado-prov' : 'b-anulado';
    return '<tr>' +
      '<td><span class="sigla-badge ' + getSiglaClass(p.Nombre_Empresa) + '">' + getSigla(p.Nombre_Empresa) + '</span></td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (p.Cliente||'') + '">' + (p.Cliente||'—') + '</td>' +
      '<td style="text-align:center;font-weight:700">' + (p.Consecutivo||'') + '</td>' +
      '<td style="white-space:nowrap;font-size:0.78rem">' + fmtDate(p.Fecha_Pedido) + '</td>' +
      '<td style="font-weight:600">' + (p.Producto||'—') + '</td>' +
      '<td>' + (p.Presentacion||'—') + '</td>' +
      '<td class="money">' + (Number(p.Cantidad)||0).toLocaleString('es-CO') + '</td>' +
      '<td class="money" style="color:#e74c3c;font-weight:600">' + (Number(p.Cant_Pendiente)||0).toLocaleString('es-CO') + '</td>' +
      '<td><span class="badge ' + badgeEst + '">' + est + '</span></td>' +
      '<td><span class="badge ' + badgeEst2 + '">' + est2 + '</span></td>' +
    '</tr>';
  }).join('');
}

function exportDetalleExcel() {
  var fe = document.getElementById('f-emp').value;
  var fcomEl = document.getElementById('f-com');
  var fcom = fcomEl ? fcomEl.value : '';
  var fc = document.getElementById('f-cli').value;
  var fs = document.getElementById('f-est').value;
  var fs2 = document.getElementById('f-est2').value;
  var ft = document.getElementById('f-txt').value.toLowerCase();

  var rows = pedidos.filter(function(p) {
    if (fe && p.Nombre_Empresa !== fe) return false;
    if (fcom && (p.Comercial || '').trim() !== fcom) return false;
    if (fc && (p.Cliente || '').toLowerCase().indexOf(fc.toLowerCase()) < 0) return false;
    if (fs && norm(p.Estado_Entrega || 'Recibido') !== norm(fs)) return false;
    if (fs2 && (p.Estado_2 || 'Abierto').trim() !== fs2) return false;
    if (ft) {
      var hay = [p.Cliente, String(p.Consecutivo), getSigla(p.Nombre_Empresa), p.Comercial, p.Producto].join(' ').toLowerCase();
      if (hay.indexOf(ft) < 0) return false;
    }
    return true;
  });

  if (!rows.length) { showToast('No hay datos para exportar', '#e74c3c'); return; }

  var data = rows.map(function(p) {
    return {
      'Empresa': getSigla(p.Nombre_Empresa),
      'Cliente': p.Cliente || '',
      'Sucursal': p.Sucursal || '',
      'Consecutivo': p.Consecutivo || '',
      'Fecha Pedido': p.Fecha_Pedido ? new Date(p.Fecha_Pedido) : '',
      'Producto': p.Producto || '',
      'Presentacion': p.Presentacion || '',
      'Cant Pedida': Number(p.Cantidad) || 0,
      'Pendiente': Number(p.Cant_Pendiente) || 0,
      'Estado': p.Estado_Entrega || 'Recibido',
      'Estado 2': p.Estado_2 || 'Abierto'
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    {wch:12},{wch:28},{wch:12},{wch:12},{wch:28},{wch:18},{wch:12},{wch:12},{wch:14},{wch:10}
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle');
  XLSX.writeFile(wb, 'detalle_pedidos_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' líneas', '#27ae60');
}

// ── Export órdenes a Excel ──
function exportOrdenesExcel() {
  var rows = applySort(filtered());
  if (!rows.length) { showToast('No hay órdenes para exportar', '#e74c3c'); return; }

  var data = rows.map(function(c) {
    var lines = getLinesFor(c);
    var est = derivedStatus(lines);
    var est2 = derivedEstado2(lines);
    var pct = derivedPct(lines);
    return {
      'Empresa': getSigla(c.Nombre_Empresa),
      'Consecutivo': c.Consecutivo || '',
      'Cliente': c.Cliente || '',
      'NIT': c.NIT || '',
      'Fecha Pedido': c.Fecha_Pedido ? new Date(c.Fecha_Pedido) : '',
      'Comercial': c.Comercial || '',
      'Municipio': c.Municipio || '',
      'Departamento': c.Departamento || '',
      'Productos': lines.length,
      'Total Orden': Number(c.Total_Orden) || 0,
      'Avance %': pct,
      'Estado': est,
      'Estado 2': est2
    };
  });

  var ws = XLSX.utils.json_to_sheet(data);
  var colWidths = [
    {wch:12},{wch:12},{wch:28},{wch:16},{wch:12},{wch:18},{wch:16},{wch:16},{wch:10},{wch:14},{wch:10},{wch:12},{wch:10}
  ];
  ws['!cols'] = colWidths;
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
  XLSX.writeFile(wb, 'Pedidos_' + today() + '.xlsx');
  showToast('Excel exportado: ' + rows.length + ' órdenes', '#27ae60');
}

// ── PDF Export ──
function closeRemPicker() {
  ['rem-picker', 'rem-picker-share'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  });
  document.removeEventListener('mousedown', _remPickerOutside, true);
}
function _remPickerOutside(ev) {
  var picker = document.getElementById('rem-picker');
  var pickerShare = document.getElementById('rem-picker-share');
  var btn = document.getElementById('btn-export-rem');
  var btnShare = document.getElementById('btn-export-rem-share');
  var inside = false;
  [picker, pickerShare, btn, btnShare].forEach(function(el) {
    if (el && el.contains(ev.target)) inside = true;
  });
  if (inside) return;
  closeRemPicker();
}

// ── Format picker (PDF / Excel) ──
function toggleFmtPicker(id, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  var el = document.getElementById(id);
  if (!el) return;
  var showing = el.style.display === 'block';
  closeFmtPickers();
  if (!showing) {
    el.style.display = 'block';
    setTimeout(function() { document.addEventListener('mousedown', _fmtPickerOutside, true); }, 0);
  }
}
function closeFmtPickers() {
  document.querySelectorAll('.fmt-picker').forEach(function(p) { p.style.display = 'none'; });
  document.removeEventListener('mousedown', _fmtPickerOutside, true);
}
function _fmtPickerOutside(ev) {
  var inside = false;
  document.querySelectorAll('.fmt-picker').forEach(function(p) {
    if (p.contains(ev.target)) inside = true;
  });
  if (!inside) closeFmtPickers();
}

// ── Excel export: Pedido ──
function exportarPedidoExcelDesdeModal() {
  if (activeIdx == null) return;
  var c = consecs[activeIdx];
  var data = _dataPedidoDesdeModal(c);
  var sigla = (typeof getSigla === 'function' ? getSigla(data.empresa) : '') || '';

  var rows = [];
  rows.push(['PEDIDO #' + (data.consecutivo || '')]);
  rows.push(['Empresa', data.empresa]);
  rows.push(['Fecha', data.fecha || '']);
  rows.push([]);
  rows.push(['Cliente', data.cliente]);
  rows.push(['NIT', data.nit]);
  if (data.facturar_a && data.facturar_a !== data.cliente) rows.push(['Facturar a', data.facturar_a]);
  if (data.nit_adicional) rows.push(['NIT Adicional', data.nit_adicional]);
  rows.push(['Telefono', data.telefono]);
  rows.push(['Comercial', data.comercial]);
  rows.push(['Municipio', data.municipio]);
  rows.push(['Departamento', data.departamento]);
  if (data.plazo) rows.push(['Plazo de Pago', data.plazo]);
  if (data.precio) rows.push(['Precio Facturacion', data.precio]);
  if (data.consignacion === 'Si' || data.consignacion === 'Sí') rows.push(['Consignacion', 'Si']);
  if (data.bodega_facturacion) rows.push(['Bodega Facturacion', data.bodega_facturacion]);
  if (data.observaciones) rows.push(['Observaciones', data.observaciones]);
  rows.push([]);

  rows.push(['#', 'Producto', 'Presentacion', 'Cantidad', 'Val. Unitario', 'Val. Total', 'Bonif.']);
  (data.productos || []).forEach(function(p, i) {
    var vUnit = Number(p.valor_unitario) || 0;
    var textoTieneBonif = /bonificado/i.test(String(p.producto || ''));
    var esBonif = (p.bonificado || '').trim() === 'Si' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
    rows.push([
      i + 1,
      p.producto || '',
      p.presentacion || '',
      Number(p.cantidad) || 0,
      Number(p.valor_unitario) || 0,
      Number(p.valor_total) || 0,
      esBonif ? 'Si' : 'No'
    ]);
  });
  rows.push([]);
  rows.push(['', '', '', '', 'TOTAL', Number(data.total) || 0]);

  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:4},{wch:36},{wch:18},{wch:12},{wch:14},{wch:14},{wch:8}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pedido');
  XLSX.writeFile(wb, 'Pedido_' + (sigla || 'EMP') + '_' + (data.consecutivo || 'nuevo') + '.xlsx');
  showToast('Excel del pedido exportado', '#27ae60');
}

// ── Excel export: Remision ──
function _exportarRemisionExcelEspecifica(rem) {
  if (activeIdx == null) return;
  if (!rem || !rem.remision || !String(rem.remision).trim()) {
    showToast('La remision debe tener numero asignado para exportarse.', '#e67e22');
    return;
  }
  var c = consecs[activeIdx];
  var sigla = (typeof getSigla === 'function' ? getSigla(c.Nombre_Empresa) : '') || '';

  var rows = [];
  rows.push(['REMISION N° ' + rem.remision]);
  rows.push(['Empresa', c.Nombre_Empresa || '']);
  rows.push(['Pedido #', c.Consecutivo || '']);
  rows.push(['Fecha remision', rem.fecha || '']);
  rows.push([]);
  rows.push(['Cliente', document.getElementById('md-cliente').value.trim() || c.Cliente || '']);
  rows.push(['NIT', document.getElementById('md-nit').value.trim() || c.NIT || '']);
  rows.push(['Comercial', document.getElementById('md-comercial').value.trim() || c.Comercial || '']);
  rows.push(['Telefono', document.getElementById('md-telefono').value.trim() || c.Telefono || '']);
  rows.push(['Sucursal', document.getElementById('md-sucursal').value.trim() || c.Sucursal || '']);
  rows.push(['Direccion', document.getElementById('md-direccion').value.trim() || c.Direccion_Envio || '']);
  rows.push(['Municipio', document.getElementById('md-municipio').value.trim() || c.Municipio || '']);
  rows.push(['Departamento', document.getElementById('md-departamento').value.trim() || c.Departamento || '']);
  rows.push([]);

  rows.push(['#', 'Producto', 'Presentacion', 'Cant. Entregada', 'Bonif.']);
  (rem.items || []).forEach(function(p, i) {
    var vUnit = Number(p.valor_unitario) || 0;
    var textoTieneBonif = /bonificado/i.test(String(p.producto || ''));
    var esBonif = (p.bonificado || '') === 'Si' || (p.bonificado || '') === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
    rows.push([
      i + 1,
      p.producto || '',
      p.presentacion || '',
      Number(p.cantidad) || 0,
      esBonif ? 'Si' : 'No'
    ]);
  });

  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:4},{wch:36},{wch:18},{wch:16},{wch:8}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Remision');
  XLSX.writeFile(wb, 'Remision_' + (sigla || 'EMP') + '_' + (c.Consecutivo || '') + '_' + rem.remision + '.xlsx');
  showToast('Excel de remision exportado', '#27ae60');
}

function exportarRemisionExcelDesdeModal() {
  var remisiones = _buildRemisionesAgrupadas();
  if (!remisiones.length) {
    showToast('No hay remisiones con numero asignado para exportar.', '#e67e22');
    return;
  }
  if (remisiones.length === 1) {
    _exportarRemisionExcelEspecifica(remisiones[0]);
    return;
  }
  var picker = document.getElementById('rem-picker');
  if (!picker) { _exportarRemisionExcelEspecifica(remisiones[0]); return; }
  if (picker.style.display === 'block') { closeRemPicker(); return; }
  var html = '<div style="padding:8px 12px;font-size:0.75rem;font-weight:700;color:#4a5568;background:#f7fafc;border-bottom:1px solid #e2e8f0">Seleccionar remision (Excel)</div>';
  remisiones.forEach(function(r, i) {
    var label = (r.remision || '(sin numero)');
    var meta = (r.fecha ? r.fecha + ' · ' : '') + r.items.length + ' producto' + (r.items.length === 1 ? '' : 's');
    html += '<div data-idx="' + i + '" class="rem-picker-item" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #edf2f7;font-size:0.82rem">' +
      '<div style="font-weight:700;color:#1a5276">' + label.replace(/</g, '&lt;') + '</div>' +
      '<div style="font-size:0.72rem;color:#718096;margin-top:2px">' + meta + '</div>' +
      '</div>';
  });
  picker.innerHTML = html;
  picker.style.display = 'block';
  picker.querySelectorAll('.rem-picker-item').forEach(function(el) {
    el.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
    el.addEventListener('mouseout', function() { this.style.background = 'white'; });
    el.addEventListener('click', function() {
      var idx = Number(this.getAttribute('data-idx'));
      closeRemPicker();
      _exportarRemisionExcelEspecifica(remisiones[idx]);
    });
  });
  setTimeout(function() {
    document.addEventListener('mousedown', _remPickerOutside, true);
  }, 0);
}

function _buildRemisionesAgrupadas() {
  if (activeIdx == null) return [];
  var c = consecs[activeIdx];
  var lines = getLinesFor(c);
  var mapa = {};
  lines.forEach(function(l) {
    var vUni = Number(l.Valor_Unitario) || 0;
    var entregas = parseEntregas(l.Remisiones, Number(l.Cant_Entregada) || 0, l.Fecha_Ult_Entrega);
    entregas.forEach(function(e) {
      var numRem = (e.remision || '').trim();
      if (!numRem) return;
      var key = numRem + '|' + (e.fecha || '');
      if (!mapa[key]) mapa[key] = { remision: numRem, fecha: e.fecha || '', items: [], total: 0 };
      var cant = Number(e.cantidad) || 0;
      if (cant <= 0) return;
      var vt = cant * vUni;
      mapa[key].items.push({
        producto: l.Producto,
        presentacion: l.Presentacion,
        cantidad: cant,
        valor_unitario: vUni,
        valor_total: vt,
        bonificado: l.Bonificado || ''
      });
      mapa[key].total += vt;
    });
  });
  var arr = Object.keys(mapa).map(function(k) { return mapa[k]; })
    .filter(function(r) { return r.items.length > 0; });
  arr.sort(function(a, b) {
    if (a.fecha && b.fecha && a.fecha !== b.fecha) return a.fecha > b.fecha ? -1 : 1;
    return (a.remision || '').localeCompare(b.remision || '');
  });
  return arr;
}

function _exportarRemisionEspecifica(rem, opts) {
  opts = opts || {};
  if (activeIdx == null) return;
  if (!rem || !rem.remision || !String(rem.remision).trim()) {
    showToast('La remisión debe tener número asignado para imprimirse.', '#e67e22');
    return;
  }
  var c = consecs[activeIdx];
  var obsEl = document.getElementById('m-observaciones');
  var lines = getLinesFor(c);
  var obsPed = (obsEl ? obsEl.value.trim() : '') || (lines[0] && lines[0].Observaciones) || c.Observaciones || '';
  var data = {
    empresa: c.Nombre_Empresa,
    consecutivo: c.Consecutivo,
    fecha_pedido: c.Fecha_Pedido,
    cliente: document.getElementById('md-cliente').value.trim() || c.Cliente,
    nit: document.getElementById('md-nit').value.trim() || c.NIT,
    telefono: document.getElementById('md-telefono').value.trim() || c.Telefono,
    comercial: document.getElementById('md-comercial').value.trim() || c.Comercial,
    municipio: document.getElementById('md-municipio').value.trim() || c.Municipio,
    departamento: document.getElementById('md-departamento').value.trim() || c.Departamento,
    direccion: document.getElementById('md-direccion').value.trim() || c.Direccion_Envio || '',
    plazo: document.getElementById('md-plazo').value.trim() || c.Plazo_Pago || '',
    precio: document.getElementById('md-precio').value.trim() || c.Precio_Facturacion || '',
    consignacion: (document.getElementById('md-consignacion') && document.getElementById('md-consignacion').value) || c.Consignacion || 'No',
    bodega_facturacion: (document.getElementById('md-bodega-facturacion') && document.getElementById('md-bodega-facturacion').value) || c.Bodega_Facturacion || '',
    facturar_a: document.getElementById('md-facturar-a') ? (document.getElementById('md-facturar-a').value.trim() || c.Facturar_A || '') : (c.Facturar_A || ''),
    nit_adicional: document.getElementById('md-nit-adicional') ? (document.getElementById('md-nit-adicional').value.trim() || c.NIT_Adicional || '') : (c.NIT_Adicional || ''),
    sucursal: document.getElementById('md-sucursal') ? (document.getElementById('md-sucursal').value.trim() || c.Sucursal || '') : (c.Sucursal || ''),
    observaciones: obsPed,
    remision: rem.remision,
    fecha_entrega: rem.fecha,
    entregas: rem.items,
    total: rem.total
  };
  if (opts.share) {
    if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
      showToast('Módulo de notificaciones no cargado.', '#e74c3c'); return;
    }
    var sig = (typeof getSigla === 'function' ? getSigla(c.Nombre_Empresa) : '') || '';
    var dataPedido = _dataPedidoDesdeModal(c);
    var ocGroups = ocsLegalizadasPorPedido[_keySC(c.Nombre_Empresa, c.Consecutivo)] || [];
    NOTIF.openModalEnviar({
      modulo: 'pedidos',
      referencia: (sig ? sig + ' ' : '') + (c.Consecutivo || '') + ' · Rem ' + rem.remision,
      titulo: 'Remisión #' + rem.remision + ' — ' + (data.cliente || 'sin cliente'),
      triggerBtn: opts.triggerBtn || null,
      buildDoc: function() {
        var r = generarRemisionPDF(Object.assign({}, data, { return_doc: true, copies: ['COPIA - CONTABILIDAD'] }));
        if (!r) return null;
        var doc = r.doc;
        generarPedidoPDF(Object.assign({}, dataPedido, { return_doc: true, _doc: doc }));
        var mergedByRem = {};
        ocGroups.forEach(function(ocLines) {
          if (!ocLines || !ocLines.length) return;
          var h = ocLines[0];
          var kRem = String(h.Remision || '').trim() + '||' + String(h.Remision_Origen || '').trim();
          if (!mergedByRem[kRem]) mergedByRem[kRem] = [];
          ocLines.forEach(function(l) { mergedByRem[kRem].push(l); });
        });
        Object.keys(mergedByRem).forEach(function(k) {
          generarRemisionesTrasladoPDF(mergedByRem[k], { return_doc: true, _doc: doc, contabilidad: true });
        });
        return doc;
      }
    });
    return;
  }
  generarRemisionPDF(data);
}

function exportarRemisionDesdeModal(ev, opts) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  opts = opts || {};
  var remisiones = _buildRemisionesAgrupadas();
  if (!remisiones.length) {
    showToast('No hay remisiones con número asignado para imprimir.', '#e67e22');
    return;
  }
  if (remisiones.length === 1) {
    _exportarRemisionEspecifica(remisiones[0], opts);
    return;
  }
  var pickerId = opts.share ? 'rem-picker-share' : 'rem-picker';
  var picker = document.getElementById(pickerId) || document.getElementById('rem-picker');
  if (!picker) { _exportarRemisionEspecifica(remisiones[0], opts); return; }
  if (picker.style.display === 'block') { closeRemPicker(); return; }
  var html = '<div style="padding:8px 12px;font-size:0.75rem;font-weight:700;color:#4a5568;background:#f7fafc;border-bottom:1px solid #e2e8f0">Seleccionar remisión</div>';
  remisiones.forEach(function(r, i) {
    var label = (r.remision || '(sin número)');
    var meta = (r.fecha ? r.fecha + ' · ' : '') + r.items.length + ' producto' + (r.items.length === 1 ? '' : 's');
    html += '<div data-idx="' + i + '" class="rem-picker-item" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #edf2f7;font-size:0.82rem">' +
      '<div style="font-weight:700;color:#1a5276">' + label.replace(/</g, '&lt;') + '</div>' +
      '<div style="font-size:0.72rem;color:#718096;margin-top:2px">' + meta + '</div>' +
      '</div>';
  });
  picker.innerHTML = html;
  picker.style.display = 'block';
  var sigPicker = (typeof getSigla === 'function' ? getSigla(consecs[activeIdx].Nombre_Empresa) : '') || '';
  var consPicker = consecs[activeIdx].Consecutivo || '';
  picker.querySelectorAll('.rem-picker-item').forEach(function(el) {
    var idx = Number(el.getAttribute('data-idx'));
    var refCheck = (sigPicker ? sigPicker + ' ' : '') + consPicker + ' · Rem ' + remisiones[idx].remision;
    if (typeof NOTIF !== 'undefined' && NOTIF.fueEnviada && NOTIF.fueEnviada('pedidos', refCheck)) {
      el.style.opacity = '0.55';
      el.querySelector('div').insertAdjacentHTML('afterend', '<span style="font-size:0.7rem;color:#27ae60;font-weight:700;margin-left:6px">✅ Enviada</span>');
    }
    el.addEventListener('mouseover', function() { this.style.background = '#f0f8ff'; });
    el.addEventListener('mouseout', function() { this.style.background = 'white'; });
    el.addEventListener('click', function() {
      closeRemPicker();
      var perRemOpts = Object.assign({}, opts);
      delete perRemOpts.triggerBtn;
      _exportarRemisionEspecifica(remisiones[idx], perRemOpts);
    });
  });
  setTimeout(function() {
    document.addEventListener('mousedown', _remPickerOutside, true);
  }, 0);
}

function _dataPedidoDesdeModal(c) {
  var lines = getLinesFor(c);
  var obsEl = document.getElementById('m-observaciones');
  var obsText = (obsEl ? obsEl.value.trim() : '') || (lines[0] && lines[0].Observaciones) || c.Observaciones || '';
  var archivo = lines.length ? (lines[0].Archivo_Fuente || '') : '';
  function _v(id, fallback) {
    var el = document.getElementById(id);
    return (el && el.value != null && String(el.value).trim()) || fallback || '';
  }
  return {
    empresa: c.Nombre_Empresa,
    consecutivo: c.Consecutivo,
    fecha: c.Fecha_Pedido,
    cliente: _v('md-cliente', c.Cliente),
    nit: _v('md-nit', c.NIT),
    telefono: _v('md-telefono', c.Telefono),
    direccion: _v('md-direccion', c.Direccion_Envio),
    municipio: _v('md-municipio', c.Municipio),
    departamento: _v('md-departamento', c.Departamento),
    comercial: _v('md-comercial', c.Comercial),
    plazo: _v('md-plazo', c.Plazo_Pago),
    precio: _v('md-precio', c.Precio_Facturacion),
    facturar_a: _v('md-facturar-a', c.Facturar_A || c.Cliente),
    nit_adicional: _v('md-nit-adicional', c.NIT_Adicional),
    sucursal: _v('md-sucursal', c.Sucursal || ''),
    consignacion: _v('md-consignacion', c.Consignacion || 'No'),
    bodega_facturacion: _v('md-bodega-facturacion', c.Bodega_Facturacion || ''),
    observaciones: obsText,
    total: c.Total_Orden,
    productos: lines.map(function(l) {
      return {
        producto: l.Producto,
        presentacion: l.Presentacion,
        cantidad: l.Cantidad,
        valor_unitario: l.Valor_Unitario,
        valor_total: l.Valor_Total,
        bonificado: l.Bonificado
      };
    }),
    archivo: archivo
  };
}

function exportarPedidoDesdeModal(opts) {
  opts = opts || {};
  if (activeIdx == null) return;
  var c = consecs[activeIdx];
  var data = _dataPedidoDesdeModal(c);
  if (opts.share) {
    if (typeof NOTIF === 'undefined' || !NOTIF.openModalEnviar) {
      showToast('Módulo de notificaciones no cargado.', '#e74c3c'); return;
    }
    var sig = (typeof getSigla === 'function' ? getSigla(c.Nombre_Empresa) : '') || '';
    NOTIF.openModalEnviar({
      modulo: 'pedidos',
      referencia: (sig ? sig + ' ' : '') + (c.Consecutivo || ''),
      titulo: 'Pedido #' + (c.Consecutivo || '') + ' — ' + (data.cliente || 'sin cliente'),
      triggerBtn: opts.triggerBtn || null,
      buildDoc: function() {
        var r = generarPedidoPDF(Object.assign({}, data, { return_doc: true }));
        return r ? r.doc : null;
      }
    });
    return;
  }
  generarPedidoPDF(data);
}

// Helpers de PDF de remisión (_pdfLogos, _pdfPaletteFor, _pdfHeaderLogoFor,
// generarRemisionPDF, _drawRemisionCopy, _drawRemisionCopyFooter) viven ahora
// en js/pdf-remision.js — compartidos con muestras y otros módulos.

function generarPedidoPDF(data) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = data._doc || new jsPDF();
  if (data._doc) doc.addPage();
  var pw = doc.internal.pageSize.getWidth();

  var palette = _pdfPaletteFor(data.empresa);
  var primary = palette.accent;
  var totalFill = palette.light;
  var darkText = [45, 55, 72];
  var grayText = [113, 128, 150];

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pw, 30, 'F');
  doc.setDrawColor(primary[0], primary[1], primary[2]);
  doc.setLineWidth(1.2);
  doc.line(0, 30, pw, 30);

  var logoP = _pdfHeaderLogoFor(data.empresa);
  var titleXP = 14;
  if (logoP) {
    try {
      doc.addImage(logoP.data, 'PNG', 5, 4, 22, 22);
      titleXP = 34;
    } catch (e) {}
  }

  doc.setTextColor(primary[0], primary[1], primary[2]);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('PEDIDO #' + String(data.consecutivo || ''), titleXP, 13);
  doc.setFontSize(9);
  doc.text('Fecha: ' + String(data.fecha || ''), pw - 14, 13, { align: 'right' });

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  var empresaText = String(data.empresa || '');
  var empresaMaxW = (pw - 14) - titleXP;
  var empresaFit = doc.splitTextToSize(empresaText, empresaMaxW);
  var empresaOneLine = empresaFit[0] + (empresaFit.length > 1 ? '…' : '');
  doc.text(empresaOneLine, titleXP, 21);

  if (data.archivo) {
    doc.setFontSize(6.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    var archivoText = String(data.archivo);
    var archivoMaxW = pw - 14 - titleXP;
    var archivoFit = doc.splitTextToSize(archivoText, archivoMaxW);
    doc.text(archivoFit[0] + (archivoFit.length > 1 ? '…' : ''), pw - 14, 26, { align: 'right' });
  }

  var y = 40;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);
  doc.setFontSize(9);

  var left = [
    ['Cliente', data.cliente],
    ['Sucursal', data.sucursal],
    ['NIT', data.nit],
    ['Facturar a', data.facturar_a && data.facturar_a !== data.cliente ? data.facturar_a : ''],
    ['NIT Adicional', data.nit_adicional],
    ['Teléfono', data.telefono],
    ['Municipio', data.municipio],
    ['Departamento', data.departamento],
  ];
  var right = [
    ['Comercial', data.comercial],
    ['Plazo de Pago', data.plazo],
    ['Precio Facturación', data.precio],
    ['Dir. Envío', data.direccion],
    ['Consignación', data.consignacion || ''],
    ['Observaciones', data.observaciones],
  ];
  if (data.bodega_facturacion) right.splice(4, 0, ['Bodega Fact.', data.bodega_facturacion]);

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
      doc.setTextColor(primary[0], primary[1], primary[2]);
      doc.text(left[fi][0] + ':', 16, y);
      doc.setFont(undefined, 'normal');
      var lVal = left[fi][1] ? String(left[fi][1]) : '—';
      doc.setTextColor(left[fi][1] ? darkText[0] : grayText[0], left[fi][1] ? darkText[1] : grayText[1], left[fi][1] ? darkText[2] : grayText[2]);
      var lLines = doc.splitTextToSize(lVal, leftValMaxW);
      doc.text(lLines, leftValX, y);
      rowH = Math.max(rowH, (lLines.length - 1) * 3.5);
    }
    if (fi < right.length) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(primary[0], primary[1], primary[2]);
      doc.text(right[fi][0] + ':', rightLabelX + 2, y);
      doc.setFont(undefined, 'normal');
      var rVal = right[fi][1] ? String(right[fi][1]) : '—';
      doc.setTextColor(right[fi][1] ? darkText[0] : grayText[0], right[fi][1] ? darkText[1] : grayText[1], right[fi][1] ? darkText[2] : grayText[2]);
      var rLines = doc.splitTextToSize(rVal, rightValMaxW);
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

  if (data.observaciones) {
    y += 3;
    doc.setFont(undefined, 'normal');
    var obsMaxW = pw - 28 - 48;
    var obsLines = doc.splitTextToSize(String(data.observaciones), obsMaxW);
    var obsH = Math.max(14, obsLines.length * 4 + 8);
    doc.setFillColor(254, 249, 231);
    doc.roundedRect(14, y - 4, pw - 28, obsH, 2, 2, 'F');
    doc.setFont(undefined, 'bold');
    doc.setTextColor(125, 102, 8);
    doc.text('Observaciones:', 18, y + 1);
    doc.setFont(undefined, 'normal');
    doc.text(obsLines, 62, y + 1);
    y += obsH;
  }

  y += 4;
  doc.setTextColor(darkText[0], darkText[1], darkText[2]);

  var tableBody = (data.productos || []).map(function(p, i) {
    var vUnit = Number(p.valor_unitario) || 0;
    var textoTieneBonif = /bonificado/i.test(String(p.producto || ''));
    var esBonif = (p.bonificado || '').trim() === 'Sí' || textoTieneBonif || (vUnit > 0 && vUnit < 10);
    return [
      i + 1,
      String(p.producto || ''),
      String(p.presentacion || ''),
      Number(p.cantidad) || 0,
      fmtMoney(p.valor_unitario),
      fmtMoney(p.valor_total),
      esBonif ? 'Sí' : 'No'
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['#', 'Producto', 'Presentación', 'Cantidad', 'Val. Unitario', 'Val. Total', 'Bonif.']],
    body: tableBody,
    theme: 'grid',
    headStyles: { fillColor: primary, fontSize: 7.5, fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.35, cellPadding: 1.5 },
    bodyStyles: { fontSize: 7.5, lineColor: [90, 90, 90], lineWidth: 0.3 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 55 },
      3: { halign: 'right', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 26 },
      5: { halign: 'right', cellWidth: 26 },
      6: { halign: 'center', cellWidth: 14 }
    },
    margin: { left: 14, right: 14 },
    styles: { cellPadding: 1.5, lineColor: [90, 90, 90], lineWidth: 0.3 },
    tableLineColor: [60, 60, 60],
    tableLineWidth: 0.5
  });

  var finalY = doc.lastAutoTable.finalY + 10;
  doc.setFillColor(totalFill[0], totalFill[1], totalFill[2]);
  doc.roundedRect(pw - 82, finalY - 5, 68, 14, 3, 3, 'F');
  doc.setFontSize(11);
  doc.setTextColor(primary[0], primary[1], primary[2]);
  doc.setFont(undefined, 'bold');
  doc.text('Total: ' + fmtMoney(data.total), pw - 16, finalY + 4, { align: 'right' });

  finalY += 20;
  doc.setFontSize(7);
  doc.setTextColor(grayText[0], grayText[1], grayText[2]);
  doc.setFont(undefined, 'normal');
  doc.text('Generado: ' + new Date().toLocaleString('es-CO'), 14, finalY);

  var sigla = getSigla(data.empresa) || 'Pedido';
  var fileName = 'Pedido_' + sigla + '_' + (data.consecutivo || 'nuevo') + '.pdf';
  if (data.return_doc) return { doc: doc, filename: fileName };
  doc.save(fileName);
}

// ── Adjuntos (Supabase Storage) ──
var ADJUNTOS_BUCKET = 'pedidos-adjuntos';
var adjuntosCache = {};
var adjuntosIndex = {};
var adjuntosUploaders = {};
var _usuariosNombresCache = {};

async function loadAdjuntosIndex() {
  adjuntosIndex = {};
  var siglas = EMPRESAS_HOLDING.map(function(e) { return e.sigla; });
  var promises = siglas.map(function(sigla) {
    return _sb.storage.from(ADJUNTOS_BUCKET).list(sigla, { limit: 1000 }).then(function(res) {
      var folders = (res.data || []).filter(function(f) { return f.name && !f.id; });
      folders.forEach(function(f) {
        adjuntosIndex[sigla + '_' + f.name] = true;
      });
    }).catch(function() {});
  });
  await Promise.all(promises);
  updateAdjuntosBadges();
  loadAdjuntosUploaders();
}

async function loadAdjuntosUploaders() {
  var keys = Object.keys(adjuntosIndex);
  if (!keys.length) return;

  var folderMap = {};
  keys.forEach(function(k) {
    var idx = k.indexOf('_');
    if (idx < 0) return;
    var sigla = k.substring(0, idx);
    var rest = k.substring(idx + 1);
    folderMap[k] = sigla + '/' + rest;
  });

  var allOwners = {};
  var folderEntries = Object.keys(folderMap);
  var batchSize = 10;
  for (var b = 0; b < folderEntries.length; b += batchSize) {
    var batch = folderEntries.slice(b, b + batchSize);
    var batchPromises = batch.map(function(key) {
      var folder = folderMap[key];
      return _sb.storage.from(ADJUNTOS_BUCKET).list(folder, { limit: 100 }).then(function(res) {
        var files = (res.data || []).filter(function(f) { return f.name && f.id; });
        var owners = {};
        files.forEach(function(f) {
          if (f.owner) owners[f.owner] = true;
        });
        adjuntosUploaders[key] = Object.keys(owners);
        Object.keys(owners).forEach(function(uid) { allOwners[uid] = true; });
      }).catch(function() {});
    });
    await Promise.all(batchPromises);
  }

  var uidsToFetch = Object.keys(allOwners).filter(function(uid) { return !_usuariosNombresCache[uid]; });
  if (uidsToFetch.length) {
    var res = await _sb.from('usuarios').select('id, nombre, email').in('id', uidsToFetch);
    if (res.data) {
      res.data.forEach(function(u) {
        _usuariosNombresCache[u.id] = u.nombre || u.email || u.id.substring(0, 8);
      });
    }
  }

  Object.keys(adjuntosUploaders).forEach(function(key) {
    adjuntosUploaders[key] = adjuntosUploaders[key].map(function(uid) {
      return _usuariosNombresCache[uid] || uid.substring(0, 8);
    });
  });

  renderDespachos();
}

function updateAdjuntosBadges() {
  var badges = document.querySelectorAll('.adjunto-badge-cell');
  badges.forEach(function(el) {
    var key = el.getAttribute('data-adj-key');
    if (key && adjuntosIndex[key]) {
      el.innerHTML = ' <span title="Tiene archivos adjuntos" style="cursor:help;font-size:0.85rem">📎</span>';
    }
  });
}

function sanitizeForPath(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
}

function adjuntoFolder(empresa, consecutivo, cliente) {
  var emp = getSigla(empresa).replace(/[^a-zA-Z0-9_-]/g, '_');
  return emp + '/' + consecutivo + '_' + sanitizeForPath(cliente);
}

function adjuntoPath(empresa, consecutivo, cliente, filename) {
  return adjuntoFolder(empresa, consecutivo, cliente) + '/' + filename;
}

function adjuntoKey(empresa, consecutivo, cliente) {
  return getSigla(empresa) + '_' + consecutivo + '_' + sanitizeForPath(cliente);
}

async function loadAdjuntos(empresa, consecutivo, cliente) {
  var listEl = document.getElementById('adjuntos-list');
  var countEl = document.getElementById('adjuntos-count');
  listEl.innerHTML = '<div class="adjuntos-loading">Cargando adjuntos...</div>';

  var folder = adjuntoFolder(empresa, consecutivo, cliente);
  var res2 = await _sb.storage.from(ADJUNTOS_BUCKET).list(folder, { limit: 50 });

  var files = (res2.data || []).filter(function(f) { return f.name && f.id; });
  var key = adjuntoKey(empresa, consecutivo, cliente);
  adjuntosCache[key] = files;

  if (!files.length) {
    listEl.innerHTML = '<div class="adjuntos-empty">Sin archivos adjuntos</div>';
    countEl.textContent = '';
    return;
  }

  countEl.textContent = '(' + files.length + ')';
  listEl.innerHTML = files.map(function(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var icon = ext === 'pdf' ? '📄' : '🖼️';
    var size = f.metadata && f.metadata.size ? formatFileSize(f.metadata.size) : '';
    var path = folder + '/' + f.name;
    var nameEsc = f.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var pathEsc = path.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<div class="adjunto-item">' +
      '<div class="adjunto-icon">' + icon + '</div>' +
      '<div class="adjunto-info">' +
        '<div class="adjunto-name" title="' + nameEsc + '">' + nameEsc + '</div>' +
        '<div class="adjunto-meta">' + ext.toUpperCase() + (size ? ' · ' + size : '') + '</div>' +
      '</div>' +
      '<div class="adjunto-actions">' +
        '<button class="btn-adj-ver" onclick="previewAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + ext + '\')">👁 Ver</button>' +
        '<button class="btn-adj-ver" onclick="downloadAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + nameEsc.replace(/'/g, "\\'") + '\')">⬇ Descargar</button>' +
        (AUTH.canEdit() ? '<button class="btn-adj-del" onclick="deleteAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\')">🗑️</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function handleAdjuntoUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  var maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast('El archivo excede 5 MB. Selecciona un archivo más pequeño.', '#e74c3c');
    return;
  }

  var allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (allowed.indexOf(file.type) < 0) {
    showToast('Tipo de archivo no permitido. Usa PDF, JPG, PNG o WEBP.', '#e74c3c');
    return;
  }

  if (activeIdx === null) return;
  var c = consecs[activeIdx];
  var empresa = c.Nombre_Empresa;
  var consecutivo = c.Consecutivo;
  var cliente = c.Cliente;

  var timestamp = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var finalName = timestamp + '_' + safeName;
  var path = adjuntoPath(empresa, consecutivo, cliente, finalName);

  var progWrap = document.getElementById('adjunto-progress');
  var progFill = document.getElementById('adjunto-prog-fill');
  var progText = document.getElementById('adjunto-prog-text');
  progWrap.style.display = 'block';
  progFill.style.width = '30%';
  progText.textContent = 'Subiendo ' + file.name + '...';

  var res = await _sb.storage.from(ADJUNTOS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });

  progFill.style.width = '100%';

  if (res.error) {
    progWrap.style.display = 'none';
    showToast('Error al subir: ' + res.error.message, '#e74c3c');
    return;
  }

  progText.textContent = 'Listo';
  setTimeout(function() { progWrap.style.display = 'none'; progFill.style.width = '0%'; }, 1200);

  showToast('Archivo adjuntado correctamente', '#27ae60');
  adjuntosIndex[adjuntoKey(empresa, consecutivo, cliente)] = true;
  updateAdjuntosBadges();
  await loadAdjuntos(empresa, consecutivo, cliente);
}

async function previewAdjunto(path, ext) {
  var res = _sb.storage.from(ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
    url = signed.data && signed.data.signedUrl;
  }
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }

  var contentEl = document.getElementById('adjunto-preview-content');
  if (ext === 'pdf') {
    contentEl.innerHTML = '<iframe src="' + url + '"></iframe>';
  } else {
    contentEl.innerHTML = '<img src="' + url + '" alt="Preview">';
  }
  document.getElementById('adjunto-preview-overlay').classList.add('show');
}

function closeAdjuntoPreview() {
  document.getElementById('adjunto-preview-overlay').classList.remove('show');
  document.getElementById('adjunto-preview-content').innerHTML = '';
}

async function downloadAdjunto(path, filename) {
  var res = _sb.storage.from(ADJUNTOS_BUCKET).getPublicUrl(path);
  var url = res.data && res.data.publicUrl;
  if (!url) {
    var signed = await _sb.storage.from(ADJUNTOS_BUCKET).createSignedUrl(path, 3600);
    url = signed.data && signed.data.signedUrl;
  }
  if (!url) { showToast('No se pudo obtener el archivo', '#e74c3c'); return; }
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || 'archivo';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function deleteAdjunto(path) {
  if (!confirm('¿Eliminar este archivo adjunto?')) return;
  var res = await _sb.storage.from(ADJUNTOS_BUCKET).remove([path]);
  if (res.error) {
    showToast('Error al eliminar: ' + res.error.message, '#e74c3c');
    return;
  }
  showToast('Archivo eliminado', '#e67e22');
  if (activeIdx !== null) {
    var c = consecs[activeIdx];
    await loadAdjuntos(c.Nombre_Empresa, c.Consecutivo, c.Cliente);
  }
}

// Drag & drop
(function() {
  var dz = document.getElementById('adjunto-dropzone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var input = document.getElementById('adjunto-input');
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleAdjuntoUpload(input);
  });
})();

// ══════════════════════════════════════════
// ── DESPACHOS ──
// ══════════════════════════════════════════

var despachosData = [];
var despachosFiltered = [];
var _despActivo = null;
var _despFacturaMap = {};

var sortLevelsDesp = [];
var SORT_COLS_DESP = [
  { id:'empresa',   label:'Empresa',       fn: function(d) { return (getSigla(d.empresa)||'').toLowerCase(); } },
  { id:'remision',  label:'Remisión',      fn: function(d) { return (d.remision||'').toLowerCase(); } },
  { id:'cliente',   label:'Cliente',       fn: function(d) { return (d.cliente||'').toLowerCase(); } },
  { id:'fecha',     label:'Fecha',         fn: function(d) { return d.fecha || ''; } },
  { id:'adjuntos',  label:'📎',            fn: function(d) { return adjuntosIndex[adjuntoKey(d.empresa, d.consecutivo, d.cliente)] ? 1 : 0; }, style:'width:60px;text-align:center' },
  { id:'uploaders', label:'Adjuntado por', fn: function(d) { return (adjuntosUploaders[adjuntoKey(d.empresa, d.consecutivo, d.cliente)] || []).join(', ').toLowerCase(); } },
  { id:'num_factura',   label:'N° Factura',    fn: function(d) { var f = _despFacturaMap[d.remision]; return f ? (f.num_factura || '').toLowerCase() : ''; } },
  { id:'fecha_factura', label:'Fecha Factura', fn: function(d) { var f = _despFacturaMap[d.remision]; return f ? (f.fecha_factura || '') : ''; } },
];

function toggleSortDesp(id, e) {
  var shift = e && e.shiftKey;
  var idx = sortLevelsDesp.findIndex(function(l) { return l.id === id; });
  if (shift) { if (idx >= 0) sortLevelsDesp.splice(idx, 1); }
  else if (idx >= 0) { if (sortLevelsDesp[idx].dir === 'asc') sortLevelsDesp[idx].dir = 'desc'; else sortLevelsDesp.splice(idx, 1); }
  else { sortLevelsDesp.push({ id: id, dir: 'asc' }); }
  renderDespachos();
}

function clearSortDesp() { sortLevelsDesp = []; renderDespachos(); }

function applySortDesp(rows) {
  if (!sortLevelsDesp.length) return rows;
  return [].concat(rows).sort(function(a, b) {
    for (var si = 0; si < sortLevelsDesp.length; si++) {
      var lvl = sortLevelsDesp[si];
      var col = null;
      for (var ci = 0; ci < SORT_COLS_DESP.length; ci++) { if (SORT_COLS_DESP[ci].id === lvl.id) { col = SORT_COLS_DESP[ci]; break; } }
      if (!col) continue;
      var va = col.fn(a), vb = col.fn(b);
      var cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
      if (cmp !== 0) return lvl.dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

function renderDespHeader() {
  var cols = [
    { label:'#', id:null, style:'width:30px' },
  ];
  SORT_COLS_DESP.forEach(function(c) {
    cols.push({ label: c.label, id: c.id, style: c.style || '' });
  });
  cols.push({ label:'Acción', id:null, style:'width:90px' });

  document.getElementById('desp-thead').innerHTML = cols.map(function(col) {
    if (!col.id) return '<th' + (col.style ? ' style="' + col.style + '"' : '') + '>' + col.label + '</th>';
    var lvlIdx = sortLevelsDesp.findIndex(function(l) { return l.id === col.id; });
    var active = lvlIdx >= 0;
    var lvl = active ? sortLevelsDesp[lvlIdx] : null;
    var dirCls = active ? (lvl.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    var badge = sortLevelsDesp.length > 1 && active ? '<span class="sort-badge">' + (lvlIdx+1) + '</span>' : '';
    return '<th class="sortable ' + dirCls + '"' + (col.style ? ' style="' + col.style + '"' : '') + ' onclick="toggleSortDesp(\'' + col.id + '\',event)">' + col.label + badge + '<span class="sort-icon"></span></th>';
  }).join('');

  var btn = document.getElementById('btn-clear-sort-desp');
  if (btn) btn.style.display = sortLevelsDesp.length ? 'inline-block' : 'none';
}

async function buildDespachos() {
  var remMap = {};
  pedidos.forEach(function(p) {
    if (!p.Remisiones) return;
    var segs = String(p.Remisiones).split(',');
    segs.forEach(function(s) {
      var parts = s.split('|');
      var rem = (parts[0] || '').trim();
      if (!rem) return;
      var fecha = parts[2] || p.Fecha_Ult_Entrega || '';
      var key = (p.Nombre_Empresa || '') + '||' + (p.Consecutivo || '') + '||' + (p.Cliente || '') + '||' + rem;
      if (!remMap[key]) {
        remMap[key] = {
          empresa: p.Nombre_Empresa || '',
          consecutivo: p.Consecutivo || '',
          cliente: p.Cliente || '',
          remision: rem,
          fecha: fecha
        };
      }
    });
  });
  despachosData = Object.keys(remMap).sort(function(a, b) {
    return remMap[b].fecha.localeCompare(remMap[a].fecha) || a.localeCompare(b);
  }).map(function(k) { return remMap[k]; });

  var selEmp = document.getElementById('desp-f-empresa');
  var prev = selEmp.value;
  var emps = {};
  despachosData.forEach(function(d) { if (d.empresa) emps[d.empresa] = 1; });
  selEmp.innerHTML = '<option value="">— Todas —</option>' +
    Object.keys(emps).sort().map(function(e) {
      var sig = getSigla(e) || e;
      return '<option value="' + e.replace(/"/g, '&quot;') + '">' + sig + '</option>';
    }).join('');
  selEmp.value = prev || '';
  renderDespachos();

  var allRems = despachosData.map(function(d) { return d.remision; }).filter(Boolean);
  if (allRems.length) {
    try {
      var batchSize = 200;
      var facResults = [];
      for (var bi = 0; bi < allRems.length; bi += batchSize) {
        var batch = allRems.slice(bi, bi + batchSize);
        var r = await _sb.from('EntregasPedido').select('remision,num_factura,fecha_factura').in('remision', batch);
        if (r.data) facResults = facResults.concat(r.data);
      }
      facResults.forEach(function(row) {
        var rem = (row.remision || '').trim();
        if (!rem) return;
        if ((row.num_factura || '').trim() || (row.fecha_factura || '').trim()) {
          _despFacturaMap[rem] = { num_factura: row.num_factura || '', fecha_factura: row.fecha_factura || '' };
        }
      });
    } catch (e) { console.warn('No se pudo cargar facturas de despachos:', e); }
  }

  renderDespachos();
}

function renderDespachos() {
  try {
    renderDespHeader();
    var buscarEl = document.getElementById('desp-f-buscar');
    var empresaEl = document.getElementById('desp-f-empresa');
    var buscar = (buscarEl ? buscarEl.value : '').toLowerCase().trim();
    var empresa = empresaEl ? empresaEl.value : '';

    var total = despachosData.length;
    var filtered = despachosData.filter(function(d) {
      if (empresa && d.empresa !== empresa) return false;
      if (buscar) {
        var fac = _despFacturaMap[d.remision] || {};
        var txt = (d.cliente + ' ' + d.remision + ' ' + d.consecutivo + ' ' + (fac.num_factura || '')).toLowerCase();
        if (txt.indexOf(buscar) < 0) return false;
      }
      return true;
    });
    despachosFiltered = applySortDesp(filtered);

    var countEl = document.getElementById('desp-count');
    if (empresa || buscar) {
      countEl.textContent = '(' + despachosFiltered.length + ' de ' + total + ' remisiones)';
    } else {
      countEl.textContent = '(' + despachosFiltered.length + ' remisiones)';
    }

    if (empresaEl) {
      empresaEl.style.borderColor = empresa ? '#1a5276' : '#cbd5e0';
      empresaEl.style.fontWeight = empresa ? '700' : '400';
    }

    var tbody = document.getElementById('desp-body');
    if (!despachosFiltered.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;color:#718096">No hay despachos con los filtros seleccionados.</td></tr>';
      return;
    }

    var canEdit = AUTH.canEdit();
    tbody.innerHTML = despachosFiltered.map(function(d, i) {
      var sig = getSigla(d.empresa) || d.empresa;
      var key = adjuntoKey(d.empresa, d.consecutivo, d.cliente);
      var badge = adjuntosIndex[key] ? '📎' : '';
      var fechaFmt = d.fecha ? formatDateShort(d.fecha) : '';
      var uploaders = adjuntosUploaders[key] || [];
      var uploadersHtml = uploaders.length
        ? uploaders.map(function(n) { return '<span style="display:inline-block;background:#ebf5fb;color:#1a5276;padding:1px 7px;border-radius:10px;font-size:0.72rem;font-weight:600;margin:1px 2px">' + n + '</span>'; }).join('')
        : '<span style="color:#cbd5e0;font-size:0.75rem">—</span>';
      var fac = _despFacturaMap[d.remision] || {};
      var nf = (fac.num_factura || '').replace(/"/g, '&quot;');
      var ff = fac.fecha_factura || '';
      var facIcon = (nf && ff) ? ' <span style="color:#3730a3;font-weight:700" title="Facturado">✓</span>' : '';
      var remEsc = d.remision.replace(/"/g, '&quot;');
      var numFacCell = canEdit
        ? '<input type="text" value="' + nf + '" placeholder="—" data-rem="' + remEsc + '" class="desp-fac-num" onchange="onDespFacturaChange(this)" style="width:100px;font-size:0.78rem;padding:3px 6px;border:1px solid #d1d5db;border-radius:5px">' + facIcon
        : '<span style="font-size:0.78rem">' + (nf || '—') + '</span>' + facIcon;
      var fechaFacCell = canEdit
        ? '<input type="date" value="' + ff + '" data-rem="' + remEsc + '" class="desp-fac-fecha" onchange="onDespFacturaChange(this)" style="width:130px;font-size:0.78rem;padding:3px 6px;border:1px solid #d1d5db;border-radius:5px">'
        : '<span style="font-size:0.78rem">' + (ff ? formatDateShort(ff) : '—') + '</span>';
      return '<tr>' +
        '<td style="color:#718096;font-size:0.78rem">' + (i + 1) + '</td>' +
        '<td style="font-size:0.82rem;font-weight:600">' + sig + '</td>' +
        '<td style="font-size:0.82rem">' + d.remision + '</td>' +
        '<td style="font-size:0.82rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + d.cliente.replace(/"/g, '&quot;') + '">' + d.cliente + '</td>' +
        '<td style="font-size:0.82rem">' + fechaFmt + '</td>' +
        '<td style="text-align:center;font-size:0.9rem">' + badge + '</td>' +
        '<td style="font-size:0.78rem">' + uploadersHtml + '</td>' +
        '<td style="white-space:nowrap">' + numFacCell + '</td>' +
        '<td style="white-space:nowrap">' + fechaFacCell + '</td>' +
        '<td><button class="btn-export" style="background:#1a5276;font-size:0.76rem;padding:4px 10px" onclick="openDespachoAdjuntos(' + i + ')">📤 Adjuntos</button></td>' +
        '</tr>';
    }).join('');
  } catch (err) {
    console.error('Error en renderDespachos:', err);
    showToast('Error al renderizar despachos: ' + err.message, '#e74c3c');
  }
}

async function onDespFacturaChange(el) {
  var rem = el.dataset.rem;
  if (!rem) return;
  var numEl = document.querySelector('.desp-fac-num[data-rem="' + CSS.escape(rem) + '"]');
  var fechaEl = document.querySelector('.desp-fac-fecha[data-rem="' + CSS.escape(rem) + '"]');
  var nf = numEl ? numEl.value.trim() : '';
  var ff = fechaEl ? fechaEl.value.trim() : '';
  _despFacturaMap[rem] = { num_factura: nf, fecha_factura: ff };

  try {
    var res = await _sb.from('EntregasPedido')
      .update({ num_factura: nf, fecha_factura: ff })
      .eq('remision', rem);
    if (res.error) throw res.error;

    var facIcon = el.closest('tr').querySelector('span[title="Facturado"]');
    if (nf && ff) {
      if (!facIcon) {
        var numTd = numEl.parentElement;
        numTd.insertAdjacentHTML('beforeend', ' <span style="color:#3730a3;font-weight:700" title="Facturado">✓</span>');
      }
    } else if (facIcon) {
      facIcon.remove();
    }

    showToast('Factura actualizada: ' + rem, '#27ae60');
  } catch (e) {
    showToast('Error al guardar factura: ' + (e.message || e), '#e74c3c');
  }
}

function openDespachoAdjuntos(idx) {
  var d = despachosFiltered[idx];
  if (!d) return;
  _despActivo = { empresa: d.empresa, consecutivo: d.consecutivo, cliente: d.cliente, remision: d.remision };

  document.getElementById('desp-adj-title').textContent = '📎 Adjuntos — ' + getSigla(d.empresa) + ' / ' + d.remision + ' / ' + d.cliente;
  document.getElementById('desp-adjuntos-panel').style.display = 'block';

  var canUpload = AUTH.canUploadAdjuntos();
  document.getElementById('desp-adjunto-dropzone').style.display = canUpload ? 'block' : 'none';

  loadDespachoAdjuntos();
}

function closeDespachoAdjuntos() {
  document.getElementById('desp-adjuntos-panel').style.display = 'none';
  _despActivo = null;
}

async function loadDespachoAdjuntos() {
  if (!_despActivo) return;
  var listEl = document.getElementById('desp-adjuntos-list');
  listEl.innerHTML = '<div class="adjuntos-loading">Cargando adjuntos...</div>';

  var folder = adjuntoFolder(_despActivo.empresa, _despActivo.consecutivo, _despActivo.cliente);
  var res2 = await _sb.storage.from(ADJUNTOS_BUCKET).list(folder, { limit: 50 });

  var files = (res2.data || []).filter(function(f) { return f.name && f.id; });

  if (!files.length) {
    listEl.innerHTML = '<div class="adjuntos-empty">Sin archivos adjuntos</div>';
    return;
  }

  listEl.innerHTML = files.map(function(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var icon = ext === 'pdf' ? '📄' : '🖼️';
    var size = f.metadata && f.metadata.size ? formatFileSize(f.metadata.size) : '';
    var path = folder + '/' + f.name;
    var nameEsc = f.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    var pathEsc = path.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<div class="adjunto-item">' +
      '<div class="adjunto-icon">' + icon + '</div>' +
      '<div class="adjunto-info">' +
        '<div class="adjunto-name" title="' + nameEsc + '">' + nameEsc + '</div>' +
        '<div class="adjunto-meta">' + ext.toUpperCase() + (size ? ' · ' + size : '') + '</div>' +
      '</div>' +
      '<div class="adjunto-actions">' +
        '<button class="btn-adj-ver" onclick="previewAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + ext + '\')">👁 Ver</button>' +
        '<button class="btn-adj-ver" onclick="downloadAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\',\'' + nameEsc.replace(/'/g, "\\'") + '\')">⬇ Descargar</button>' +
        (AUTH.canEdit() ? '<button class="btn-adj-del" onclick="deleteDespachoAdjunto(\'' + pathEsc.replace(/'/g, "\\'") + '\')">🗑️</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

async function handleDespachoUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  input.value = '';

  var maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast('El archivo excede 5 MB. Selecciona un archivo más pequeño.', '#e74c3c');
    return;
  }

  var allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (allowed.indexOf(file.type) < 0) {
    showToast('Tipo de archivo no permitido. Usa PDF, JPG, PNG o WEBP.', '#e74c3c');
    return;
  }

  if (!_despActivo) return;

  var timestamp = Date.now();
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var finalName = timestamp + '_' + safeName;
  var path = adjuntoPath(_despActivo.empresa, _despActivo.consecutivo, _despActivo.cliente, finalName);

  var progWrap = document.getElementById('desp-adjunto-progress');
  var progFill = document.getElementById('desp-adjunto-prog-fill');
  var progText = document.getElementById('desp-adjunto-prog-text');
  progWrap.style.display = 'block';
  progFill.style.width = '30%';
  progText.textContent = 'Subiendo ' + file.name + '...';

  var res = await _sb.storage.from(ADJUNTOS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });

  progFill.style.width = '100%';

  if (res.error) {
    progWrap.style.display = 'none';
    showToast('Error al subir: ' + res.error.message, '#e74c3c');
    return;
  }

  progText.textContent = 'Listo';
  setTimeout(function() { progWrap.style.display = 'none'; progFill.style.width = '0%'; }, 1200);

  showToast('Archivo adjuntado correctamente', '#27ae60');
  var _dKey = adjuntoKey(_despActivo.empresa, _despActivo.consecutivo, _despActivo.cliente);
  adjuntosIndex[_dKey] = true;
  var _prof = (typeof AUTH !== 'undefined' && AUTH.getProfile) ? AUTH.getProfile() : null;
  var _myName = _prof ? (_prof.nombre || _prof.email || '') : '';
  if (_myName && (!adjuntosUploaders[_dKey] || adjuntosUploaders[_dKey].indexOf(_myName) < 0)) {
    adjuntosUploaders[_dKey] = (adjuntosUploaders[_dKey] || []).concat(_myName);
  }
  renderDespachos();
  await loadDespachoAdjuntos();
}

async function deleteDespachoAdjunto(path) {
  if (!confirm('¿Eliminar este archivo adjunto?')) return;
  var res = await _sb.storage.from(ADJUNTOS_BUCKET).remove([path]);
  if (res.error) {
    showToast('Error al eliminar: ' + res.error.message, '#e74c3c');
    return;
  }
  showToast('Archivo eliminado', '#e67e22');
  await loadDespachoAdjuntos();
}

// Drag & drop para despachos
(function() {
  var dz = document.getElementById('desp-adjunto-dropzone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    var input = document.getElementById('desp-adjunto-input');
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleDespachoUpload(input);
  });
})();

// ── Importar Clientes desde Excel ──

var clientImportData = null;

function handleClientImport(input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('El archivo está vacío', '#e74c3c'); return; }
      var parsed = parseClientExcel(rows);
      if (!parsed.length) { showToast('No se encontraron clientes válidos', '#e74c3c'); return; }
      clientImportData = parsed;
      showClientImportPreview(parsed);
    } catch (err) {
      showToast('Error al leer Excel: ' + err.message, '#e74c3c');
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseClientExcel(rows) {
  var siglaToEmpresa = {};
  EMPRESAS_HOLDING.forEach(function(e) { siglaToEmpresa[e.sigla.toUpperCase()] = e.value; });

  var headerMap = {};
  var firstRow = rows[0];
  Object.keys(firstRow).forEach(function(key) {
    var k = key.toUpperCase().trim().replace(/[^A-Z0-9_ ]/g, '');
    if (k.indexOf('EMPRESA') >= 0) headerMap.empresa = key;
    else if (k === 'CLIENTE' || k.indexOf('RAZON') >= 0 || k.indexOf('NOMBRE') >= 0) headerMap.cliente = key;
    else if (k.indexOf('TIPO') >= 0 && k.indexOf('IDENT') >= 0) headerMap.tipo_id = key;
    else if (k === 'NIT' || k.indexOf('IDENTIFICACION') >= 0 || k.indexOf('CEDULA') >= 0 || k.indexOf('DOCUMENTO') >= 0) headerMap.nit = key;
    else if (k.indexOf('CORREO') >= 0 || k.indexOf('EMAIL') >= 0 || k.indexOf('ELECTRONICO') >= 0) headerMap.correo = key;
    else if (k.indexOf('DIRECCION') >= 0 || k.indexOf('ENVIO') >= 0) headerMap.direccion = key;
    else if (k.indexOf('TELEFONO') >= 0 || k.indexOf('CELULAR') >= 0 || k.indexOf('TEL') >= 0) headerMap.telefono = key;
    else if (k.indexOf('MUNICIPIO') >= 0 || k.indexOf('CIUDAD') >= 0) headerMap.municipio = key;
    else if (k.indexOf('CUPO') >= 0 || k.indexOf('CREDITO') >= 0) headerMap.cupo = key;
    else if (k.indexOf('PLAZO') >= 0 || k.indexOf('PAGO') >= 0) headerMap.plazo = key;
  });

  var results = [];
  rows.forEach(function(r) {
    var cliente = String(r[headerMap.cliente] || '').trim();
    if (!cliente) return;

    var empRaw = String(r[headerMap.empresa] || '').trim().toUpperCase();
    var empresa = siglaToEmpresa[empRaw] || empRaw;

    var cupoRaw = String(r[headerMap.cupo] || '').trim();
    var cupo = cupoRaw;
    if (cupoRaw && cupoRaw !== 'NA') {
      var cupoNum = Number(String(cupoRaw).replace(/[^\d.-]/g, ''));
      if (!isNaN(cupoNum) && cupoNum > 0) cupo = String(cupoNum);
    }

    results.push({
      cliente: cliente,
      nit: String(r[headerMap.nit] || '').trim(),
      telefono: String(r[headerMap.telefono] || '').trim(),
      direccion: String(r[headerMap.direccion] || '').trim(),
      municipio: String(r[headerMap.municipio] || '').trim(),
      departamento: '',
      empresa: empresa,
      tipo_identificacion: String(r[headerMap.tipo_id] || '').trim(),
      correo: String(r[headerMap.correo] || '').trim(),
      cupo_credito: cupo,
      plazo_pago: String(r[headerMap.plazo] || '').trim()
    });
  });
  return results;
}

function showClientImportPreview(clients) {
  var empresas = {};
  clients.forEach(function(c) { var s = c.empresa ? getSigla(c.empresa) : '?'; empresas[s] = (empresas[s]||0) + 1; });
  var empList = Object.keys(empresas).map(function(s) { return s + ': ' + empresas[s]; }).join(', ');
  document.getElementById('ci-summary').innerHTML =
    '<strong>' + clients.length + ' clientes</strong> detectados · ' + empList;

  var tbody = document.getElementById('ci-lines');
  tbody.innerHTML = clients.slice(0, 20).map(function(c, i) {
    return '<tr>' +
      '<td>' + (i+1) + '</td>' +
      '<td>' + escHtml(c.cliente) + '</td>' +
      '<td>' + escHtml(c.nit) + '</td>' +
      '<td>' + escHtml(c.tipo_identificacion) + '</td>' +
      '<td>' + escHtml(c.telefono) + '</td>' +
      '<td>' + escHtml(c.municipio) + '</td>' +
      '<td>' + escHtml(c.plazo_pago) + '</td>' +
      '<td>' + (c.cupo_credito && c.cupo_credito !== 'NA' ? fmtMoney(Number(c.cupo_credito)||0) : c.cupo_credito || '') + '</td>' +
      '</tr>';
  }).join('');
  if (clients.length > 20) {
    tbody.innerHTML += '<tr><td colspan="8" style="text-align:center;color:#718096;font-style:italic">... y ' + (clients.length - 20) + ' más</td></tr>';
  }

  document.getElementById('btn-ci-confirm').disabled = false;
  document.getElementById('btn-ci-confirm').textContent = '📋 Importar ' + clients.length + ' clientes';
  document.getElementById('client-import-overlay').classList.add('show');
}

function closeClientImport() {
  document.getElementById('client-import-overlay').classList.remove('show');
  clientImportData = null;
}

document.getElementById('client-import-overlay').addEventListener('click', function(e) { if (isBackdropClick(e)) closeClientImport(); });

async function confirmClientImport() {
  if (!clientImportData || !clientImportData.length) return;
  var btn = document.getElementById('btn-ci-confirm');
  btn.disabled = true;
  btn.textContent = '⏳ Importando...';

  try {
    var empresas = {};
    clientImportData.forEach(function(c) { if (c.empresa) empresas[c.empresa] = true; });
    var empList = Object.keys(empresas);
    if (empList.length) {
      var delRes = await apiPost({ action: 'deleteClientesPorEmpresa', empresas: empList });
      if (!delRes.ok) throw new Error(delRes.error || 'Error al limpiar clientes existentes');
    }
    var batchSize = 200;
    var total = 0;
    for (var i = 0; i < clientImportData.length; i += batchSize) {
      var batch = clientImportData.slice(i, i + batchSize);
      var result = await apiPost({ action: 'upsertClientesUnicos', items: batch });
      if (!result.ok) throw new Error(result.error || 'Error en la importación');
      total += result.added || 0;
    }
    clientesCache = null;
    await loadAutocompleteData();
    closeClientImport();
    showToast('✅ ' + total + ' clientes importados correctamente');
  } catch (err) {
    showToast('❌ Error: ' + err.message, '#e74c3c');
    btn.disabled = false;
    btn.textContent = '📋 Importar';
  }
}

// ── Auto-load on page open ──
loadFromAPI();
