# Panel Pedidos

## Regla principal

No hagas cualquier cambio hasta que tengas el 95% de confianza en lo que necesites construir. Hazme preguntas de seguimiento hasta que alcances dicho porcentaje de confianza.

## Stack

- Frontend: HTML estático + CSS + JavaScript vanilla (sin frameworks)
- Backend: Supabase (auth, base de datos PostgreSQL, storage, edge functions)
- Proyecto Supabase: `opghwfuxrvjpbuxeykxn`
- Repositorio: GitHub `LogisticaTecbihol`

## Estructura

- `*.html` — Páginas del panel (login, pedidos, ingresos, ordenes, inventario, etc.)
- `js/` — Lógica de cada módulo (un archivo JS por página)
- `css/` — Estilos
- `supabase/` — Migraciones SQL y edge functions
- `sql/` — Scripts SQL auxiliares

## Convenciones

- Los archivos JS usan el cliente Supabase directamente (no hay API intermedia)
- Las migraciones van en `supabase/migrations/` con formato de timestamp
- El idioma del código y UI es español

## gstack

Suite de skills instalada en `~/.claude/skills/gstack` (requiere `bun` + `./setup`).

- **Navegación web**: usa la habilidad `/browse` de gstack cuando esté disponible. Si `/browse` falla o el binario no está instalado, recurre a las herramientas de navegador integradas.
- Skills disponibles: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`

## Kardex → Existencias por Empresa: listado fijo de PARCELAR

`PARCELAR_LISTADO` (`js/kardex.js`, junto a `_existSoloUnaEmpresa`) es una lista fija de 121 productos (92 propios + 26 Carval + 3 Maxi Pasto, tomada de
`PRODUCTOS PARCELAR.xlsx`). Para quien ve la empresa PARCELAR (`_existVeParcelar`), `calcularExistencias` los crea en cero si no tienen movimientos (o reutiliza
la fila existente, comparando sin mayúsculas/espacios) y los marca `_listado`. El rol con acceso **solo** a PARCELAR, que normalmente solo ve existencias ≠ 0,
ve estos productos también en cero (y la opción «Solo sin existencia» se le habilita). Cada producto cae en su sección (Propio / Carval / Maxi Pasto) por las
reglas de siempre. Los nombres deben ser los del maestro/movimientos: «CLEAN CROP X 20 LITROS» (el Excel decía «BIDON DE 20 LITROS»). Para agregar o quitar un
producto se edita el arreglo; no hay tabla en BD. Solo aplica a la pestaña Existencias por Empresa (no a Existencias NC ni al Comparativo).

## Cambios de mercancía: trámite parcial (`devoluciones.html` → pestaña «Cambios de Mercancía»)

«Gestionar» ya no registra cada lado de una sola vez: cada pasada guarda lo que **realmente** ingresó y/o salió (cantidad por línea) con su propia remisión,
y lo que falta queda pendiente para otra pasada. Una línea puede tener varias remisiones de ingreso y varias de salida.

- **Modelo** (`supabase/migrations/add_tramite_parcial_cambios.sql`, migración remota `add_tramite_parcial_cambios`): cada línea de `CambiosMercancia` trae
  `Movs_Ingreso` / `Movs_Salida` (jsonb `[{rem, cant, fecha, bodega}]`, un elemento por pasada). Ingreso = líneas CAMBIAR; salida = líneas ENTREGAR, o CAMBIAR si el
  cambio no tiene ENTREGAR (mismo producto). **Las filas anteriores** tienen los arreglos vacíos: su `Remision_*` cubre TODA la `Cantidad`, como siempre; no hubo backfill.
  Las columnas `Remision_*`/`Bodega_*`/`Fecha_*` se siguen llenando en las filas con movimientos (remisiones separadas por coma, bodega y fecha de la última pasada)
  solo para búsquedas y exportes: **el stock sale de los arreglos**. `Cierre_Con_Faltante` marca el cierre con cantidades sin tramitar.
- **Estados**: `Parcial` mientras quede algo pendiente en cualquier lado, `Cerrado` al completar ambos. «Cerrar con faltante» (observación ≥ 10 car.; exige algún
  movimiento previo) y «Cerrar sin recibir producto» (solo si no ha entrado nada) cierran dejando lo pendiente sin mover inventario; ninguno se reabre.
- **Un solo lugar escribe**: el RPC `tramitar_cambio(jsonb)` (SECURITY INVOKER → aplican las RLS de la tabla). Atómico y con las filas del cambio bloqueadas; valida que
  las líneas sean exactamente el cambio, que cada cantidad sea entera y ≤ lo pendiente, y calcula el estado. Si falla no escribe nada y `apiPost` libera las
  remisiones generadas (`_genRem`). El candado `trg_cambios_movs_guard` impide arreglos mal formados o por encima de la `Cantidad`. Desde JS: `apiPost({action:'tramitarCambio', …})`
  (shared.js). La acción antigua `gestionarCambio` queda solo por pestañas abiertas con código viejo y se niega a tocar un cambio con movimientos.
- **Lectura única de movimientos**: `camEventosLinea` / `camLadoAplica` / `camResumenGrupo` / `camCantPendiente` (shared.js) devuelven los movimientos de una línea (los del
  arreglo, o —en filas anteriores— uno por toda la `Cantidad`). **Todo lector del inventario debe usarlos**, y su equivalente SQL es `_kx_cam_eventos` / `_cam_cant_hecha`.
  Hoy los usan: `_kx_movs` (SQL; la usan `get_saldos_holding` y `get_movs_holding_otras`), `existencias.js` (`buildKxMovimientos` y `_computeMovimientos_Inv`), `kardex.js`
  (Buenos y Bodega NC), `legalizacion-prorrateo.js`, `reportes.js` (Remisiones), `despachos-devcam.js` (una fila por remisión de salida) y el detalle/PDF de `cambios.js`.
  Si agregas un lector nuevo de `CambiosMercancia`, pide `Movs_Ingreso,Movs_Salida` en las columnas y reutiliza esos helpers. `get_prorrateo_legalizacion_*` ya devuelven los arreglos.
- **Pantalla «Gestionar»** (`cambios.js`): tablas con solicitada / ya tramitada / pendiente / «ahora» por línea (por defecto lo pendiente; «Todo lo pendiente» / «Ninguna»). El motor de
  asignación de inventario (`asignacion-inventario.js`) sigue en la salida de los cambios con líneas ENTREGAR; lo asignado a una línea no puede superar lo que se entrega ahora.
  Con «Ingreso y salida», un lado sin cantidades simplemente no se registra (no genera remisión). Cada remisión sale a contabilidad con SOLO las cantidades de su pasada.
- **Detalle**: una tarjeta por remisión (con su botón PDF) y columnas «Ingresada/Entregada» y «Falta» por línea. **Editar y eliminar** un cambio con movimientos están bloqueados
  (editar borra y recrea las líneas, y se perderían las remisiones).
- Probado contra producción con transacciones revertidas (parcial, exceso, grupo incompleto, cierre con faltante, solo CAMBIAR, dato anterior) y con arneses de navegador
  (paridad SQL↔JS de `_kx_movs`/`buildKxMovimientos`/kardex Buenos y NC/prorrateo/reportes, y el modal con Supabase simulado). El flujo completo con usuarios reales no se probó.

## Cambios de mercancía: datos de entrega (Sucursal, Dirección, Municipio, Departamento)

El formulario «Registrar Cambio de Mercancía» captura los mismos datos de entrega que «Nuevo Pedido» (`pedidos.html`): **Sucursal**, **Dirección**, **Municipio** y **Departamento**.

- **Modelo** (`supabase/migrations/add_direccion_entrega_cambios.sql`, migración remota `add_direccion_entrega_cambios`; aplicar ANTES de publicar el código, porque `agregarCambio`
  ya inserta las columnas): `CambiosMercancia.Sucursal`, `Direccion_Envio`, `Municipio`, `Departamento` (text, default `''`, mismos nombres que en `Pedidos`). Son datos del cambio
  completo, no de cada línea: se repiten en todas las filas, como Cliente/NIT/Teléfono. **Los cambios anteriores quedan vacíos** (sin backfill; el detalle muestra «—») y,
  como un cambio con movimientos no se edita, así se quedan. El trámite parcial (`Movs_*`, `tramitar_cambio`) no usa estas columnas.
- **Obligatoriedad**: Municipio y Departamento obligatorios; Dirección y Sucursal opcionales. Al guardar se normaliza igual que Nuevo Pedido (`normalizarMunicipio` /
  `normalizarDepartamento` de `js/colombia-geo.js`: corrige la grafía y completa el departamento). La **carga histórica** (admin) queda exenta de la obligatoriedad.
  Si se edita un cambio anterior (sin movimientos) hay que completar municipio y departamento para guardar.
- **Lógica de Nuevo Pedido, reutilizada**: Departamento/Municipio usan `setupGeoAutocomplete` (`js/colombia-geo.js`, lista oficial). Las opciones de Sucursal y lo que se rellena al elegir
  el cliente salen de `js/entrega-cliente.js` (`entregaSucursales`, `entregaPorDefecto`, `entregaUltimoPedido`), que es el equivalente de `_populateSucursalDL` y del `onSelect` del
  cliente en `pedidos.js`: ficha del cliente en Clientes + sus pedidos anteriores; con más de una dirección no se rellena nada y se elige la sucursal (que rellena dirección, municipio
  y departamento); con una sola se rellena con la ficha y, donde falte, con el último pedido. **`pedidos.js` conserva su propia copia: si cambias una, cambia la otra** (paridad
  comprobada contra el código real de `pedidos.js` con 4000 casos aleatorios, 0 diferencias). Como `devoluciones.html` no carga pedidos, los pedidos del cliente se piden al elegirlo con
  `apiGet('getPedidosDeCliente', {cliente, columns})` (shared.js; solo ese cliente; respeta `_filterGerenteIaso`); si falla o no hay acceso, quedan solo los datos de Clientes.
  Diferencia menor: al elegir cliente aquí se limpian los cuatro campos antes de rellenar (Nuevo Pedido deja los valores anteriores cuando el cliente tiene varias direcciones).
- **Se ven en**: formulario de alta y de edición (`cam-sucursal`, `cam-direccion`, `cam-municipio`, `cam-departamento`; el desplegable `.ac-dropdown` de geo está en el `<style>` de
  `devoluciones.html`), detalle del cambio, búsqueda de la lista y los PDF: solicitud (OP-PDC-FO11, +2 filas por columna) y las remisiones de ingreso/salida, tanto al exportar como
  las que salen a contabilidad al «Gestionar» (los cuatro sitios usan `_camEntregaPdf` en `cambios.js`).
- Probado con un arnés de navegador (Supabase simulado: relleno por cliente con una y varias direcciones, sucursal, geo, validación, alta, edición, histórico, detalle y PDF) y con la
  migración dentro de una transacción revertida contra producción (columnas, idempotencia, filas anteriores con `''`, inserción, `_kx_movs` idéntico: 4284 filas). El flujo con usuarios
  reales (permisos de lectura de `Pedidos` por rol) no se probó.

## Devoluciones y Cambios: archivos de soporte al registrar

Los formularios «Registrar Devolución» y «Registrar Cambio de Mercancía» (`devoluciones.html`) tienen la zona **opcional** «📎 Archivos de soporte» (`#dev-soporte` / `#cam-soporte`):
se eligen o arrastran varios archivos antes de guardar y **se suben después de que el registro se guardó bien** (no quedan huérfanos si falla el guardado). Un solo componente,
`js/adjuntos-soporte.js` (`aspCrear`, `aspFiltrar`, `aspSubir`, `aspSubirSoporte`; lo carga la página antes de `devoluciones.js`/`cambios.js`).

- **Reglas**: PDF/JPG/PNG/WEBP, hasta 5 MB c/u (`ASP_MAX_BYTES`) y 10 archivos por vez (`ASP_MAX_ARCHIVOS`); sin archivos vacíos ni repetidos. Si el navegador no informa el tipo se usa la extensión.
  Los buckets repiten el tope y los tipos. Si cambias una regla, cámbiala en el bucket también.
- **Dónde quedan**: Cambios → bucket `cambios-adjuntos` (público, ya existía; es la misma carpeta que lista su detalle: `<SIGLA>/<consecutivo>_<cliente>/<marca>_<nombre>`).
  Devoluciones → bucket nuevo **`devoluciones-adjuntos`, privado** (URL firmada de 1 h; `supabase/migrations/create_devoluciones_adjuntos.sql`, migración remota `create_devoluciones_adjuntos`,
  aplicar ANTES de publicar el código; políticas: cualquier usuario autenticado con rol, `get_user_role()` no nulo, igual que las de cambios endurecidas), misma estructura de carpeta (`devAdjuntoFolder`).
- **Sin consecutivo no se adjunta**: la carga histórica con consecutivo manual vacío no guarda si hay archivos (la carpeta se arma con el consecutivo).
- **Si falla alguna subida** el registro ya existe: se avisa en un toast largo (`showToast(msg, color, ms)`, 3.er parámetro nuevo y opcional en `shared.js`) y se agrega desde el detalle.
- **Detalle de la devolución** (nuevo, `devAdjuntosSeccionHtml` / `loadDevAdjuntos` en `devoluciones.js`): lista, ver (imagen/PDF), descargar, eliminar y adjuntar varios; un grupo del listado puede juntar varios
  consecutivos (misma empresa/cliente/vendedor/fecha): se listan las carpetas de todos con la etiqueta «Consec. N» y se elige a cuál adjuntar. Subir exige `AUTH.canEdit()`, eliminar `AUTH.canUploadAdjuntos()`
  (igual que el detalle de Cambios, que no se tocó).
- **En «Editar»** la zona se reemplaza por un aviso (editar un cambio borra y recrea las líneas): los soportes se manejan desde el detalle. «Enviar Solicitud» y las remisiones a contabilidad **no** llevan los adjuntos.
- La carpeta incluye el nombre del cliente (como en pedidos/cambios): si se edita el cliente de una devolución, sus archivos dejan de verse en el detalle (siguen en Storage).
- Probado con un arnés de navegador (Supabase simulado en memoria: validación, alta con subida, falla parcial, detalle, grupo con dos consecutivos, ver/descargar/eliminar, edición, histórica sin consecutivo,
  arrastrar y soltar) y con la migración en una transacción revertida contra producción (bucket, políticas, idempotencia; admin inserta/ve, usuario sin fila en `usuarios` bloqueado, `anon` no ve nada).
  Subida/URL firmada/eliminación contra Storage real con un usuario real no se probaron.

## Solicitudes de Eventos (formato MC-ISO-FO01)

`solicitudes-eventos.html` + `js/solicitudes-eventos.js`: el comercial diligencia el formato de solicitud de eventos (6 secciones).
Mismo patrón que «Solicitudes a Mercadeo» (`solicitudes-mercadeo.*`): aprobación previa aquí, y solo al aprobarse la solicitud se crea en el módulo
**Eventos** de panel-pqrs (estado «Radicada»), donde el Líder de Mercadeo la evalúa (máx. 48 h hábiles).

- **Permisos**: se REUTILIZAN `solicitudes_mercadeo` (enviar) y `solicitudes_mercadeo_aprobar` (aprobar); no hay claves nuevas en `usuario_modulos`.
  Las tarjetas muestran «Solicitudes de Eventos» con ese mismo permiso. En el navbar de todas las páginas, «Solicitudes a Mercadeo» y «Solicitudes de
  Eventos» van agrupadas en el desplegable «📣 Mercadeo» (mismo patrón `.nav-dropdown` que el menú Admin; la página actual marca `has-active` en el
  botón y `active` en su opción). El manejador de `shared.js` cierra el otro desplegable al abrir uno.
- **Tabla** `solicitudes_eventos` (`supabase/add_solicitudes_eventos.sql`, aplicada como migración remota `add_solicitudes_eventos`): SIN políticas,
  solo las Edge Functions (service_role). Numeración visible `SE-<n>`. Todo el formulario normalizado viaja en `datos` (jsonb); columnas sueltas:
  empresa, nombre y fecha del evento, `fecha_radicacion`.
- **Edge Functions** (`supabase/functions/`): `solicitud-evento` (`verify_jwt=true`; acciones `contexto`, `preparar`, `crear`, `reenviar`, `editar`,
  `listar`, `pendientes`, `aprobadas`, `observar`, `aprobar`, `rechazar`, `archivo_url`) y `solicitud-evento-aviso` (`verify_jwt=false`, la llama pqrs
  con `PQRS_BRIDGE_SECRET`; eventos `estado`, `respuesta`, `rechazo`). El puente hacia pqrs es `solicitud-evento-pedidos` (URL por defecto en el código;
  `PQRS_EVENTO_BRIDGE_URL` opcional); mismo secreto `PQRS_BRIDGE_SECRET` que ya usa Solicitudes a Mercadeo.
- **Empresas adicionales** (`supabase/add_solicitudes_eventos_empresas.sql`, migración remota `add_solicitudes_eventos_empresas`): además de las 5 del
  holding, el campo Empresa ofrece `CHIA_ABAGO` («Chía Abagó»), `TECBIHOL` («Tecbihol») y `OTROS` (exige escribir el nombre, 3–100 car., en
  `datos.empresa_otra`). No son del holding, así que NO dependen de `usuario_empresas`: la función las devuelve en `contexto.empresas_extra` y las
  puede elegir cualquiera que envíe solicitudes. `validarFormulario` las acepta y la BD de pqrs las vuelve a validar (migración 0032 de panel-pqrs).
- **Política de 15 días**: solo advertencia (no bloquea). `fecha_radicacion` = día del envío del solicitante (un reenvío tras un rechazo cuenta como
  radicar de nuevo; editar sin rechazo NO la reinicia). `aprobar` se niega si la fecha del evento ya pasó (409): se rechaza para que se corrija.
- **Formulario por pasos**: 5 pasos (Solicitante · Evento · Objetivos y público · Requerimientos · Presupuesto y envío; las secciones 5 y 6 del formato van
  juntas). «Siguiente» valida solo el paso actual, volver atrás no valida, y la barra de pasos (clicable) muestra ✓ o ! en los ya vistos. El último paso trae un
  resumen antes de enviar; enviar revisa todos los pasos y lleva al primero con error (`evValidarPaso` / `evPrimerError` en `solicitudes-eventos.js`).
- **Lugar del evento** (físico/híbrido): ya no es un texto libre sino `datos.lugar_municipio` + `lugar_departamento` (obligatorios, pareja validada contra
  `COLOMBIA_DEPTOS_MUNIS` de `js/colombia-geo.js`; combos con `setupGeoAutocomplete`), `lugar_distribuidor` + `lugar_distribuidor_nit` (opcionales; combo de
  `apiGet('getClientesUnicos')`, admite texto libre; al elegir un cliente rellena NIT y, si el lugar está vacío, su municipio/departamento) y `lugar_finca`.
  La función arma `datos.lugar` («Municipio, Depto · Distribuidor/cliente: X (NIT n) · Finca: Y», ≤ 300) y ese texto es lo único que lee pqrs
  (`solicitud-evento-pedidos` toma solo `d.lugar`; el formulario de Eventos de pqrs sigue con su campo libre). Las solicitudes anteriores conservan su `lugar`
  en texto libre; al editarlas se pide completar municipio y departamento (se les muestra el texto anterior).
- **Listas con «Otro/a»** (sin cambios en el servidor, `datos` sigue igual): `Departamento / Área` (Comercial, Cartera, Contabilidad, Administrativo, Otros) y
  `Plataforma` (Zoom, Microsoft Teams, Google Meet, YouTube Live, Facebook Live, Otra) y `Segmentación` (Agricultor, Agrónomos, Dueños de almacén, Mostrador,
  Distribuidor, Otros). Al elegir «Otros/Otra» aparece un campo obligatorio y se guarda el texto escrito en lugar de «Otros/Otra»
  (`evAreaValor` / `evPlataformaValor` / `evSegmentacionValor`); al editar, un valor fuera de la lista vuelve a mostrarse como «Otros/Otra» + texto.
  La Segmentación reemplaza a segmento demográfico, segmento profesional y nivel de conocimiento: se guarda en `datos.segmento_profesional` (la columna que lee
  pqrs); las otras dos claves ya no se piden (las solicitudes antiguas las siguen mostrando en el detalle, pero al editarlas se descartan).
- **Alineado con panel-pqrs**: el formulario de Eventos de Mercadeo (`panel/eventos.html` + `js/panel/eventos.js` en panel-pqrs, migración 0035) tiene los mismos
  campos y reglas que este: empresa primero, área / plataforma / segmentación como listas con «Otros/Otra», y el lugar por partes (la única diferencia: allá
  «Distribuidor o cliente» es texto libre porque no tiene la lista de clientes). Si cambias uno de los dos formularios, cambia el otro.
- **Avance del checklist de Mercadeo**: el equipo de Mercadeo gestiona cada evento con un checklist de actividades (panel-pqrs, migración 0036). Aquí solo se
  muestra el AVANCE («3 de 5» + barra) en «Mis solicitudes» y en el detalle (`evAvanceMercadeoHtml`), que llega de la función puente en `actividades_total` /
  `actividades_hechas` y que `solicitud-evento` (`mapFila`) pasa tal cual; nunca las actividades, notas ni responsables.
- **Logística y presencialidad**: las opciones (`registros`, `coordinacion_logistica`, `plataforma_virtual`, `presencia_mercadeo` = «Se solicita presencia de Mercadeo»)
  viven en TRES sitios que hay que mantener iguales: `EV_LOGISTICA` (solicitudes-eventos.js), `LOGISTICA` en la función `solicitud-evento` y, en panel-pqrs,
  `LOGISTICA` de `solicitud-evento-pedidos` + el CHECK `mercadeo_eventos_logistica_check` y el brief (migración 0034) + la lista `CAT.LOGISTICA` de `js/panel/eventos-pdf.js` (única copia en panel-pqrs; la usan Eventos, el PDF y el Tablero).
  Una opción nueva exige aplicar primero la migración de pqrs; si no, el CHECK rechaza el evento al aprobarse.
- **Qué se puede editar**: mientras Mercadeo no haya aprobado el evento (`radicada`/`en_revision`). Una solicitud aprobada aquí pero sin aprobar en
  Mercadeo se «retira» (el evento pasa a `cancelada` en pqrs) y vuelve a aprobación; ya aprobada por Mercadeo, se le deja una **observación**.
- **Avisos**: campanita con módulo `solicitudes_mercadeo` y referencia `SE-<n>`; `js/notificaciones.js` enruta las `SE-` a `solicitudes-eventos.html`.
- Probado con un arnés de navegador (Edge Function simulada en memoria); las funciones se desplegaron y rechazan llamadas sin credenciales. El flujo
  completo contra producción requiere una sesión real de un usuario con el permiso.

## Solicitudes a Mercadeo: envío directo de las no comerciales

`solicitudes-mercadeo.html` + `js/solicitudes-mercadeo.js` + Edge Function `solicitud-mercadeo`. Una solicitud **no comercial** se salta la aprobación del gerente
comercial: se crea de una vez en el Tablero de Mercadeo (panel-pqrs, «Recibido») y allí Mercadeo la acepta o la rechaza, como a cualquier otra.

- **Regla** (`esComercial` en la función; `smEsDirecta` en el JS solo AVISA, la que decide es la función): es comercial —y sigue la aprobación de siempre— si quien envía
  tiene rol `admin`/`editor`/`comercial`/`gerente_iaso` (`ROLES_COMERCIALES`), **o** la persona «a nombre de» tiene uno de esos roles, **o** el área elegida es «Comercial»
  (compara sin tildes ni mayúsculas, también si se escribió en «Otros»). Todo lo demás (contabilidad, cartera, producción… con cualquier otra área o sin área) va directo.
  Quien ya puede aprobar (`solicitudes_mercadeo_aprobar`) conserva su autoaprobación de siempre. La función manda `roles_comerciales` / `area_comercial` en `contexto`.
- **Datos** (`supabase/add_solicitudes_mercadeo_directa.sql`, migración remota `add_solicitudes_mercadeo_directa`, aplicar ANTES de desplegar la función): columna
  `directa_mercadeo boolean`. La fila queda `Aprobada` con `aprobada_por = NULL`, `aprobada_por_nombre = 'Envío directo (sin aprobación comercial)'` (es el texto que ve
  el Tablero como «aprobada por») e historial `envio_directo`. Editar o reenviar apaga la bandera y vuelve a evaluar la ruta (un cambio de área puede mandarla a aprobación).
- **Pantalla**: el campo «Estado» del formulario cambia a «Directo a Mercadeo» (azul) al elegir área/solicitante; en la lista y el detalle la etapa «Gerente comercial»
  muestra «No aplica». Si el envío directo falla (Mercadeo no responde) la solicitud queda «Por aprobar» y se avisa a los aprobadores, como en la autoaprobación.
- Las solicitudes anteriores no se tocaron: una «Por aprobar» de un usuario no comercial sigue en la bandeja hasta que alguien la apruebe o su dueño la edite (entonces va directo).

## Solicitudes a Mercadeo y de Eventos: «Productos relacionados»

Campo **opcional** en `solicitudes-mercadeo.html` (después de la descripción) y en `solicitudes-eventos.html` (paso 3 «Objetivos y público», después de los objetivos). Es un
solo componente, `js/productos-solicitud.js` (`psCrear`, lo cargan las dos páginas antes de su JS): buscador con chips, varios productos por solicitud.

- **Nombre sin presentación**: las sugerencias salen de `maestro_productos` (`apiGet('getMaestroProductos')`; la leen todos los roles con sesión) cortando cada nombre en la primera « X »
  sin importar mayúsculas (`psNombreBase`): «CALIMAN X LITRO» y «CALIMAN X GALON» dan «CALIMAN». Hoy 555 filas dan 210 nombres únicos. Los 30 que no traen « X » («ACIDO CITRICO»,
  «HIDROPLANTS INICIO NPK11-45-11+0»…) se ofrecen completos, y si un producto está escrito de dos maneras en el maestro («ACTIV K 50 LITRO» y «ACTIV K 50 X …») salen dos opciones:
  se corrige en el maestro, no aquí. La búsqueda ignora tildes y mayúsculas y pide todas las palabras escritas.
- **Fuera del listado**: lo escrito que no coincide con un producto del listado se ofrece como «➕ Agregar «…»» (Enter o el botón «Agregar»), queda como chip punteado ámbar y se guarda
  tal cual **en la solicitud**; NO se agrega a `maestro_productos`. Un texto escrito y sin agregar impide enviar (aviso con el texto) para que no se pierda en silencio.
- **Reglas** (las mismas en `productos-solicitud.js`, en `solicitud-mercadeo` y `solicitud-evento` —`productosValidos`—, en `solicitud-mercadeo-pedidos` y `solicitud-evento-pedidos`
  de panel-pqrs y en el CHECK de pqrs): hasta 20 productos, de 2 a 100 caracteres, una sola línea, sin repetir (sin tildes ni mayúsculas; el servidor descarta el repetido sin error).
  El servidor no consulta el maestro: acepta cualquier texto dentro de esos límites. Si cambias una regla, cámbiala en todos.
- **Modelo**: Solicitudes a Mercadeo → columna `solicitudes_mercadeo.productos text[]` (`supabase/add_solicitudes_mercadeo_productos.sql`, migración remota
  `add_solicitudes_mercadeo_productos`; aplicar ANTES de desplegar la función, que ya la escribe). Solicitudes de Eventos → dentro de `datos.productos` (jsonb): sin migración.
  Las solicitudes anteriores quedan sin productos (el detalle muestra «—»); editarlas permite agregarlos.
- **Hacia Mercadeo (panel-pqrs)**: en el Tablero, la tarea trae una línea «Productos relacionados: A, B» al inicio del brief (junto a Empresa y Departamento / Área; no hay columna
  propia). En Eventos, columna `mercadeo_eventos.productos` (migración 0038 de panel-pqrs): el trigger de aprobación la incluye en el brief de la tarea, el PDF del evento la muestra, la
  bitácora anota sus cambios y la búsqueda de la lista la encuentra. El formulario de Eventos de pqrs también tiene el campo (alineado con este), pero allá es texto libre: no hay maestro.
- **Se ve en**: formulario (alta y edición), resumen del último paso de Eventos y detalle de la solicitud (bandeja del solicitante y de los aprobadores).
- **Orden de despliegue**: migración 0038 de pqrs → funciones de pqrs (`solicitud-mercadeo-pedidos`, `solicitud-evento-pedidos`) → migración `add_solicitudes_mercadeo_productos` →
  funciones de pedidos (`solicitud-mercadeo`, `solicitud-evento`) → frontends de los dos repos. Una función vieja de pqrs ignora el campo `productos` sin fallar, pero la nueva lo inserta.
- Probado con arneses de navegador sobre las páginas reales con la Edge Function simulada (catálogo con casos reales del maestro, búsqueda, texto libre, repetidos, tope, texto
  pendiente, alta, detalle, edición, escritorio y móvil) y con las dos migraciones en transacciones revertidas contra producción (columnas, CHECK, filas anteriores vacías,
  brief y bitácora de Eventos, idempotencia). El flujo completo con usuarios reales no se probó.

## Pedidos: el stock que trae una OC de traslado queda apartado para SU pedido

Cuando un pedido pide stock a otra empresa se crea una OC `Tipo='Traslado'` ligada a la línea (`OrdenesCompra.pedido_id`, `Ref_Pedido`). Mientras está abierta, esas unidades cuentan
como apartadas contra la empresa ORIGEN. **Al legalizarse la OC esa reserva desaparecía** y las unidades entraban a la empresa destino como existencia común: cualquier otro pedido
podía tomarlas en «+ Añadir» (`EntregasPedido.orden_compra_id` estaba vacío en las 1.046 filas, así que tampoco quedaba rastro de qué OC respaldaba cada despacho).

- **Migración** (`supabase/migrations/reservar_stock_oc_traslado.sql`, migración remota `reservar_stock_oc_traslado`; aplicar ANTES de publicar el código): trigger
  `trg_oc_traslado_reserva_pedido` (AFTER UPDATE en `OrdenesCompra`) → `fn_oc_traslado_reserva_pedido` → `reservar_stock_oc_traslado(oc_id)`. Cuando una OC de traslado con `pedido_id`
  recibe su `Remision` de destino (se legaliza) crea o amplía el apartado Activo de ESA línea en `Empresa_Destino` (`apartados_pedido.orden_compra_id` = la OC y nota
  «Reservado por OC <consecutivo> (n ud)»; varias OC de la misma línea se acumulan en una sola fila y en la nota). Solo corre al pasar `Remision` de vacío a lleno, así que retocar una OC ya legalizada no reserva otra vez.
  La base ya exige que la OC esté **Aprobada** para legalizarse (`oc_legalizacion_requiere_aprobacion`), por eso la reserva solo nace de OC aprobadas.
- **Reglas**: se aparta `MIN(Cantidad de la OC, hueco)` con `hueco = Cantidad − Cant_Entregada − apartados activos de la línea` (si la OC trajo de más, o la línea ya se surtió de otro stock,
  el sobrante queda libre). No aparta si la OC o la línea están anuladas, si la OC no trae `pedido_id` o si `Empresa_Destino` no es la empresa del pedido. **Nunca bloquea la legalización**:
  cualquier fallo (p. ej. pedido «Pendiente de aprobación», que `trg_apartado_no_pendiente_aprobacion` rechaza) queda como WARNING y las unidades quedan libres. Un `pg_advisory_xact_lock`
  por pedido evita que dos OC de la misma línea legalizadas a la vez se pasen del hueco. Las funciones no son llamables por clientes (REVOKE a `public/anon/authenticated`).
- **Después de la reserva todo lo demás ya existía**: anular el pedido o cerrarlo libera el apartado (`fn_apartados_cascade_pedido`), bajar la cantidad exige «Descomprometer» primero, el panel
  «Stock ya apartado para este pedido» ofrece «Emitir entrega» / «Liberar», y `consumir_apartados_pedido` lo descuenta al despachar.
- **Regularización incluida en la migración**: OC ya legalizadas de líneas que siguen abiertas y a las que la OC trajo más unidades de las despachadas desde esa empresa. Hoy eran 2 filas:
  IASO #30, NUTRICEL K50 X LITRO (pedido_id 2925 → 12 ud, 2926 → 1 ud). El resto de OC legalizadas no se toca. Volver a correr la migración no reserva dos veces (el tope es el hueco).
- **Pantalla** (`pedidos.js`): el panel muestra la etiqueta «de OC <consecutivo>»; «Emitir entrega» deja el chip con `orden_compra_id` y `EntregasPedido.orden_compra_id` se guarda **solo en las
  entregas emitidas desde la reserva** (una entrega tomada del stock libre queda en null aunque al guardar `consumirApartados` descuente primero el apartado propio de la línea en esa empresa, como siempre).
  Al abrir un pedido los mapas de apartados se rearman con el snapshot de existencias recién leído (`_reconstruirApartadosDesdeSnapshot`; antes se leían al cargar la página y una OC
  legalizada después no aparecía). `loadSnapshot` ahora devuelve `apartadosOk` (false si falló la lectura de apartados) y los apartados traen `orden_compra_id,notas`.
- **Revalidación al guardar** (`_validarEntregasContraStockFresco`, solo si hay entregas directas): vuelve a leer existencias y apartados, descuenta de cada entrega el apartado propio de la línea
  y exige que lo que exceda quepa en el stock LIBRE (existencia − apartados de todos). Si no cabe, no se gasta la remisión, se refresca el modal y el aviso nombra qué pedidos tienen apartado
  ese producto. Si no se pudo releer, no frena (como antes). Si `consumir_apartados_pedido` falla al guardar, ahora se avisa (antes se ignoraba y el apartado quedaba restando dos veces).
- **Alcance elegido: control solo en pantalla.** No hay candado en la base de datos: una entrega registrada por otra vía todavía podría usar unidades reservadas para otro pedido. Tampoco
  se cubren las OC de muestras (`muestra_id`) ni las OC de IASO a PARCELAR (`oc-como-pedido.js`, solo consulta).
- Probado con la migración dentro de una transacción revertida contra producción (regularización: 2 filas, idempotencia, legalizar una OC, tope al hueco, suma sobre un apartado existente, pedido pendiente
  de aprobación sin bloquear la OC, retoque de una OC ya legalizada, anulación del pedido) y con un arnés de navegador sobre el código real de `pedidos.js`/`existencias.js` (30 comprobaciones: panel, chip,
  `EntregasPedido`, revalidación y `apartadosOk`). El flujo completo con usuarios reales (legalizar en Órdenes y despachar después) no se probó.
