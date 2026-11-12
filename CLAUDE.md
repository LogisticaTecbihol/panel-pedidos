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
  **`ventas-evento-resumen`** (`verify_jwt=false`, mismo secreto; archivos `index.ts` + `calculo.js`): SOLO LECTURA. La llama la función `impacto-evento` de pqrs (Eventos > «Impacto en ventas») y le devuelve las
  ventas de `Pedidos` AGREGADAS (sumas, conteos y fechas; nunca nombres de clientes ni líneas) antes/después de un evento, por distribuidor (NIT sin DV), municipio y productos, contra el resto de la empresa.
  No escribe nada ni toca el esquema. Se despliega a mano (`supabase functions deploy ventas-evento-resumen --no-verify-jwt` o desde el dashboard).
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

> **Actualización 2026-11-11:** las OC de traslado de un pedido ahora son «diferidas» (ver la sección «OC de traslado diferidas»): ya no se legalizan a mano ni mueven inventario al legalizarse, y el trigger
> `reservar_stock_oc_traslado` **se salta** las diferidas. Lo de abajo describe el modelo anterior, que sigue valiendo solo para las OC que **no** son diferidas (las ya legalizadas antes del cambio).

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
- **Unidades en una OC sin legalizar no se despachan** (caso IASO #26, BODEGA ESPINAL, PEGASSO PH X LITRO 60 ud con la OC T-20261029-100802-PARCELAR de 60): mientras la OC siga viva
  (`esSolicitudCompraViva`: traslado, sin Remisión de destino, ni anulada ni cerrada; también «Por aprobar») sus unidades salen del tope del selector. `ocEnCaminoPorLinea[Pedidos.id]`
  (`_buildOCEnCaminoMap`, se arma al cargar y se relee con `_refrescarOCEnCamino` al abrir el pedido) y `_pendienteLibre(i) = pedida − entregada − asignado − unidades en OC` gobiernan
  `_maxAsignable`, `validateAsignCant` y `renderAsignacionCell`: con 60 de 60 en OC el modal no ofrece selector ni cantidad, muestra «🛒 60 ud … en una orden de compra sin legalizar: <OC> (aprobada,
  falta legalizar)» y deja solo «Emitir entrega» de lo ya apartado; con una OC parcial (40 de 60) quedan 20 por asignar con normalidad. **Lo no cubierto por una OC sigue pudiendo salir del stock
  libre** (decisión del usuario); al legalizarse la OC, sus unidades pasan a ser el apartado de la línea. El tope vale también para las solicitudes de compra nuevas (no se vuelve a pedir lo ya pedido).
  Al guardar, `_validarEntregasContraStockFresco(entregas, solicitudes)` relee las OC (`_leerOCEnCamino`) y lo entregado (`_leerEntregadas`) y frena si lo asignado pasa de
  `Cantidad − entregada − unidades en OC`. Las OC históricas sin `pedido_id` no se pueden atar a una línea y no restringen; si no se pueden releer las OC, no se frena por este motivo.
- **«Para qué pedidos está apartado»** (selector de empresa del modal): bajo el selector, un desplegable «🔒 Apartado (PARCELAR 30) — ver para qué pedidos» lista, por empresa de stock, quién tiene
  reservado el producto: apartados de pedidos (con «de OC …» si vienen de una OC), apartados de muestras y solicitudes de compra a esa empresa (OC viva, con su estado «aprobada, falta legalizar» /
  «por aprobar»), marcando «este pedido» en la propia. Sale de `Existencias.getApartadoDetalle(snapshot, producto, {soloGranel})` (`existencias.js`), que usa las MISMAS dos fuentes y criterios que
  `computeApartadoPorEmpresa`, así que lo que suma por empresa es exactamente el «(n apartado)» de cada opción. Respeta las empresas visibles del usuario. `SNAPSHOT_COLS.ordenes` ahora pide
  `id,Consecutivo,pedido_id,Estado_Aprobacion` (para mostrar la OC y el cliente de la solicitud). Al elegir una empresa con apartado el desplegable se abre y resalta su grupo (`onAsignEmpresaChange`).
  Se complementa con el panel «Quién tiene este producto apartado» (`_competenciaApartadoHtml`), que solo sale cuando el neto no alcanza y trae los botones «Liberar».
- **«Liberar» una OC desde el modal** (`liberarOC`, `pedidos.js`): una OC de traslado viva retiene stock en la empresa origen pero NO es un apartado (`apartados_pedido`), así que «Liberar» y
  «Descomprometer» por línea no la tocaban y la única salida era Órdenes (el ✕ de la línea borra la línea del pedido, no libera nada). Cada solicitud de compra trae ahora un botón «Liberar»
  (solo `AUTH.canDescomprometer()`: admin/editor) en el panel «🛒 solicitudes de compra pendientes», en el aviso 🛒 de la línea («Liberar N ud», uno por OC) y en las filas «solicitud de compra
  OC …» del desplegable «Apartado …» (`getApartadoDetalle` trae `oc_id`). Relee la OC, exige que siga viva (`esSolicitudCompraViva` y sin Remisión de origen) y la ANULA (`Estado='Anulada'`, lo mismo que
  hace la cascada de `fn_apartados_cascade_pedido` y el «Descomprometer» del pedido completo); la línea del pedido no se toca y esas unidades quedan por asignar. UPDATE directo bajo RLS
  (`OrdenesCompra_update` admite admin/editor/contabilidad/gerente_iaso/remisionador con acceso a la empresa), sin migración; `trg_oc_traslado_no_excede` solo vigila filas en Estado 'Abierta'. Una OC de
  OTRO pedido pide además un motivo, que queda en `Observaciones` («Anulada desde Pedidos (IASO #26) por <usuario>: <motivo>»). Si la OC cambió desde la lectura (`.eq('Estado', leído)`) no la pisa.
  Después recarga y reabre el pedido (se pierden las asignaciones sin guardar; el confirm lo avisa). Los apartados de pedido/muestra del desplegable no llevan botón: se liberan con el panel
  «Quién tiene este producto apartado» o con «Descomprometer». Probado con un arnés de navegador sobre el código real (38 comprobaciones: render, permisos, OC propia y ajena, OC ya legalizada /
  cerrada / anulada, 0 filas, error, confirm cancelado); no se probó con un usuario real contra producción.
- **Alcance elegido: control solo en pantalla.** No hay candado en la base de datos: una entrega registrada por otra vía todavía podría usar unidades reservadas para otro pedido. Tampoco
  se cubren las OC de muestras (`muestra_id`) ni las OC de IASO a PARCELAR (`oc-como-pedido.js`, solo consulta).
- Probado con la migración dentro de una transacción revertida contra producción (regularización: 2 filas, idempotencia, legalizar una OC, tope al hueco, suma sobre un apartado existente, pedido pendiente
  de aprobación sin bloquear la OC, retoque de una OC ya legalizada, anulación del pedido) y con un arnés de navegador sobre el código real de `pedidos.js`/`existencias.js` (30 comprobaciones: panel, chip,
  `EntregasPedido`, revalidación y `apartadosOk`). El flujo completo con usuarios reales (legalizar en Órdenes y despachar después) no se probó.

## OC de traslado «diferidas»: el inventario solo se mueve al remisionar el pedido

Antes, legalizar una OC de traslado de un pedido (Órdenes → Cerrada, que genera RE destino / RS origen) movía la existencia en el acto (Salida en origen, Entrada en destino) aunque el pedido no se
hubiera remisionado; aprobarla nunca movió nada. Ahora las OC `Tipo='Traslado'` con `pedido_id` son **diferidas** (`OrdenesCompra."Traslado_Diferido" = true`): aprobarlas **no mueve nada** y **no se
legalizan a mano**; mientras tanto siguen **apartando** stock en el origen (siguen «vivas» para `esSolicitudCompraViva` / `computeApartadoPorEmpresa`, que NO cambiaron). El inventario real se mueve
cuando el pedido se remisiona: la OC se legaliza sola (RE/RS) **en proporción a lo remisionado** y con la **fecha de esa remisión** (antes el Kardex usaba la fecha de creación de la OC).
Efecto neto de una pasada: origen −N, destino +N−N = 0. Decisiones del usuario (2026-11-11): existencia intacta pero apartada; RE/RS al remisionar el pedido; movimiento proporcional; aplica a OC nuevas y a
las aprobadas sin legalizar (las ya legalizadas no se tocaron; al activar eran 2 filas: ids 667 y 668, GREEN → IASO, 150 y 60 ud).

- **Modelo: se divide la fila** (`supabase/migrations/oc_traslado_diferido.sql`, `tramitar_traslado_oc.sql`, `oc_traslado_diferido_activar.sql`, cada una con su `_rollback.sql`). Una pasada que cubre toda la fila
  la actualiza en sitio (`Fecha` = día de la remisión, `Remision`, `Remision_Origen`, `Estado='Cerrada'`); una pasada parcial baja la `Cantidad` del remanente (que sigue Abierta y apartando) e **inserta una pieza
  Cerrada** con las remisiones, mismo `Consecutivo`/`Ref_Pedido`/`pedido_id`/aprobación y `Traslado_Padre_Id` = la fila de la que salió (60 = 20 + 40). Así cada pieza es una fila de OC legalizada normal y **Kardex,
  Existencias, `_kx_movs`, reportes, facturación por remisión y el paquete PDF no cambian** (se descartó un jsonb tipo `Movs_*` de Cambios: habría que tocar todos los lectores). Un mismo `Consecutivo` puede
  tener entonces piezas Cerradas con pares RE/RS distintos y un remanente Abierto. La `Cantidad` original ya no está en una sola fila.
- **Un solo lugar escribe**: RPC `tramitar_traslado_oc(jsonb)` (SECURITY DEFINER, **no ejecutable por clientes**; sola movería inventario sin remisión del pedido) llamada por **`guardar_pedido_con_traslados(p_header,
  p_lineas, p_delete_ids, p_tramite)`** (DEFINER, la usa el navegador vía `apiPost({action:'editarPedido', tramites:{fecha, remision_pedido, lineas:[{pedido_id,cantidad}]}})`, shared.js). El envoltorio tramita y luego
  llama a `editar_pedido_completo`, **todo en una transacción** (si algo falla se revierten también los consecutivos RE/RS, que se generan en SQL con `_remision_siguiente` —copia de `generar_remision` sin el guard
  `user_has_company(origen)`, porque un editor de una sola empresa no podría remisionar con una OC de otra—), y comprueba que `Cant_Entregada` subió al menos lo tramitado. Devuelve el resultado de
  `editar_pedido_completo` más `tramite: {pares, piezas, por_linea}`. La RPC reparte la cantidad entre las OC diferidas **Aprobadas**, Abiertas y sin remisiones de cada línea (FIFO por id), con
  `pg_advisory_xact_lock` por línea y `FOR UPDATE ORDER BY id`; valida rol (admin/editor/contabilidad/gerente_iaso/remisionador), `user_has_company(empresa del pedido)`, pedido no Anulado/Cerrado/Pendiente de
  aprobación/GRANEL, cantidades **enteras** y ≤ lo pendiente de la línea y ≤ lo entregable por las OC. Un par RE/RS por pasada y por `(Consecutivo, origen, destino)`.
- **Candados** (`trg_oc_diferida_guard`, INVOKER a propósito para ver `current_user`): una diferida pendiente no admite `Remision`/`Remision_Origen`/`Estado='Cerrada'` fuera de la RPC (`app.oc_tramite='on'`, que ningún
  cliente PostgREST puede fijar); una pieza ya tramitada es inmutable (cantidad, producto, empresas, estado, remisiones; ni DELETE) salvo para un admin o SQL directo; una diferida **Rechazada pasa sola a
  `Anulada`** (si no seguiría «viva» apartando). `trg_oc_diferida_alta` (BEFORE INSERT, parte 3) marca `Traslado_Diferido = (Tipo='Traslado' AND pedido_id IS NOT NULL)` en toda fila nueva (el cliente no decide).
  **Salida de emergencia**: un admin o el SQL directo pueden poner `Traslado_Diferido=false` a una diferida pendiente y entonces se legaliza a mano como una OC común.
- **Ajustes a lo anterior** (reescritos sobre el cuerpo VIGENTE en producción): `reservar_stock_oc_traslado` / `fn_oc_traslado_reserva_pedido` se saltan las diferidas (no hay stock que apartar en el destino);
  `fn_apartados_cascade_pedido` anula las diferidas pendientes también al **cerrar** el pedido y al **borrar** la línea (antes solo al anular: quedarían apartando para siempre) y bajar la `Cantidad` de la línea
  cuenta lo pendiente en diferidas; `fn_oc_avisar_contabilidad` se calla mientras corre la RPC (esta avisa por su cuenta: `_oc_avisar_tramite`, «📦 OC legalizada … · <RE>», uno por pasada y por contabilidad de
  origen y destino; el trigger habría dado un «aprobada» espurio en el INSERT de la pieza y deduplicado la 2.ª pasada por título).
- **Pedidos** (`pedidos.js`): `ocEnCaminoPorLinea[id]` ahora trae `{cant, entregable, bloqueada}`: **entregable** = OC diferidas ya Aprobadas, **bloqueada** = el resto (por aprobar / no diferidas). En el modal, el aviso
  de la línea ofrece **«🚚 Entregar N ud con OC»** (`entregarConOC`): un chip `_fromOC` a nombre de la empresa del pedido que **no consume stock ni apartados del destino** (se excluye de `_asignadoEnSesion`,
  `_faltasStockLibre`, `apartarSinRemisionar` y del agregado de `consumirApartados`). `_pendienteLibre` = restante − bloqueada − (entregable aún sin chip). `_validarEntregasContraStockFresco` valida los `_fromOC` contra lo
  entregable releído (no contra existencias). `guardarTodo` manda `tramites` en `editarPedido`; justo después de que el guardado salga bien consolida `dl._entregas` y limpia los chips de la misma empresa (un reintento no
  debe entregar ni tramitar dos veces) y, si algo falla después, el toast avisa que el pedido **YA quedó remisionado**. `persistirEntregasYTraslados` deja **una fila de `EntregasPedido` por pieza** con `orden_compra_id` = la OC.
  El paquete PDF no necesitó cambios (la RPC ya hizo commit antes de leer las OC; `oc_fecha_legalizacion` cuenta también los INSERT).
- **Órdenes** (`ordenes.js`): insignias «🚚 En espera de remisión del pedido» / «🚚 Tramitada con el pedido»; el editor bloquea `Cerrada`, las remisiones y la casilla Auto en una diferida pendiente, y bloquea cantidad/
  producto/empresas/estado en una pieza tramitada (salvo admin) (`_applyDiferidaLockOC`); `editarOrdenCompra` (shared.js) rechaza legalizar una diferida **antes** de `_genRem` (no gasta consecutivos). `_grupoOC` ignora la
  `Fecha` para diferidas; los PDF de remisiones salen **uno por par RE/RS** (`_paresRemisionOC`, `_remisionesDeFila`) y la Solicitud suma las partes de cada producto con la fecha más antigua (`_grupoSolicitudOC`). La
  facturación por remisión ya iba por número de remisión, así que cada pasada se factura aparte.
- **Orden de despliegue**: (1) `oc_traslado_diferido.sql` y `tramitar_traslado_oc.sql` (inertes: ninguna fila está marcada) → (2) publicar el código (los `select` piden `Traslado_Diferido`, por eso la migración 1 va antes;
  subir los `?v=` de `pedidos.html` y `ordenes.html`) → (3) **`oc_traslado_diferido_activar.sql` justo después** (trigger de alta + backfill). Entre (2) y (3) todo sigue como antes; activar sin el código nuevo dejaría esas OC
  sin poder legalizarse ni despacharse. Rollback: activar → tramitar → diferido (cada `_rollback.sql`; no deshacen trámites ya hechos: las piezas son OC normales).
- **Fuera de alcance**: OC de muestras/cambios (`muestra_id`), OC de IASO a PARCELAR (`oc-como-pedido.js`, solo consulta, muestra cada pasada como un «pedido»), OC ya legalizadas, candado en la base contra entregas hechas por otra
  vía (el control de stock libre sigue siendo en pantalla), «Programación de planta» (ya contaba doble los traslados pendientes; preexistente). Los avisos «aprobada sin legalizar» del 10/11 sobre las OC 667/668 (⏳ «falta
  legalizarla») quedan desactualizados. Para **deshacer** un trámite hecho por error hay que anular la remisión con «Remisión anulada» (no se puede borrar ni editar la pieza).
- Probado contra producción con **transacciones revertidas** (`DO` que termina en excepción; usuarios reales simulados con `request.jwt.claims`): migraciones aplicadas dos veces sin error; `_kx_movs` idéntico antes y después
  (4701 filas, suma 11520); privilegios (el RPC interno no es ejecutable por `authenticated`); legalizar a mano una diferida rechazado; rechazar → Anulada; remisión completa de la OC 668 (60 de 60: RE/RS, OC Cerrada, sin
  `apartados_pedido`, avisos, contadores +1); envoltorio sin entrega del pedido → falla y revierte; tres pasadas sobre la OC 667 (20, 50 y 80, la última en sitio: suma 150, Kardex GREEN −150 / IASO +150); FIFO con dos OC
  aprobadas y una por aprobar a nombre de un **editor de una sola empresa** (genera el RS del origen sin error, un solo par); exceso, cantidad fraccionaria y fecha inválida; pieza inmutable y no borrable para un
  remisionador; cascada al cerrar/anular/borrar y bajar cantidad; OC sin `pedido_id` se sigue legalizando a mano; el rollback de la parte 1 deja las 4 funciones **idénticas** a producción (mismo md5). En el navegador, con las
  funciones reales extraídas y datos simulados: mapa de OC, topes, chips, validación fresca, `persistirEntregasYTraslados` (una fila por pieza), `editarPedido` con/sin trámite, `editarOrdenCompra` sobre diferida/común/sin
  columna, agrupación por pasada, PDF por par, bloqueos del editor. **No se probó**: el flujo completo `guardarTodo` en la página real (solo sus piezas), con usuarios reales (permisos de cada rol, PDF y avisos en vivo), ni las
  migraciones aplicadas de verdad en producción.

## Legalización de gastos: «TECBIHOL» en el reparto entre empresas

`legalizacion-gastos.html` + `js/legalizacion-gastos.js`: la tabla «Reparto entre empresas» (formularios de ruta, mantenimiento y envío; todos usan `empresaRowOptionsHtml`) ofrece, además de las 5 empresas del
holding, tres **grupos externos**: `TECBIHOL`, `CHIA ABAGO` y `MATERIAS PRIMAS`. Tecbihol sigue el patrón de «Chia Abago», no el de una empresa real: se guarda como el texto `'TECBIHOL'` en
`LegalizacionGastosEmpresas.Empresa` (columna de texto libre, sin CHECK), no está en `empresas` ni en `usuario_empresas`, no se asigna a usuarios y no toca Pedidos, Kardex ni el resto del panel.
A diferencia de los otros dos, **no sale de una remisión externa**: solo se elige a mano (por eso NO entra en `esEmpresaExterna`, que es de las remisiones).

- **Quién la elige**: igual que Chia Abago, todo el que NO sea de una sola empresa (admin, cartera y los de varias empresas). El usuario de una sola empresa (p. ej. PARCELAR) no la ve en el listado,
  ve en un viaje compartido solo su parte («PARCELAR + otras») y no lo edita (`legEsCompartida` ya cuenta a Tecbihol como «otra empresa»). Los cuatro filtros «Empresa» (Legalizaciones, Envíos, Prorrateo,
  Vista detallada) la ofrecen a quien puede elegirla (`populateEmpresaSelect(..., extras)`); hoy son los únicos que filtran por un grupo externo (Chia Abago y Materias primas no se filtran).
- **Quién la ve** (BD, `supabase/migrations/legalizacion_gastos_tecbihol_grupo_externo.sql`; rollback en `..._rollback.sql`; **aplicar ANTES de publicar el código**): `legalizacion_gastos_visible` ignora la fila
  `TECBIHOL` como ignora las de los otros dos grupos. Sin eso `'TECBIHOL'` contaba como una empresa del holding sin acceso (`user_has_company` es false salvo admin/cartera) y una legalización repartida
  solo a Tecbihol quedaba invisible hasta para el editor que la creó. Reparto solo de grupos externos → lo ve todo el que tiene el módulo; reparto mixto (PARCELAR + TECBIHOL) → decide por las empresas del holding.
- **La lista `('CHIA ABAGO', 'MATERIAS PRIMAS', 'TECBIHOL')` vive en CUATRO sitios que hay que mantener iguales**: `legalizacion_gastos_visible`, `get_historial_legalizacion_gastos` y
  `get_cambios_legalizacion_gastos` (cada una con su copia de la regla para la legalización eliminada) y `LegProrrateo.empresaVisible` / `EMPRESA_*` (`js/legalizacion-prorrateo.js`, que también carga
  `dashboard.html`: subir su `?v=` en las dos páginas). Un grupo externo nuevo exige tocar los cuatro. Quien copie una de esas funciones de una migración vieja pierde la lista nueva.
- **Prorrateo / Dashboard**: Tecbihol aparece (con el nombre `TECBIHOL`, chip gris `sigla-DEFAULT`) en «Combustible por empresa» y «Mantenimiento por empresa», porque ahí se reparte por el Monto del reparto manual. El
  prorrateo por producto va por la empresa de cada remisión y **no hay remisiones de Tecbihol**, así que ahí no recibe nada. «⚖ Calcular reparto» tampoco le asigna monto (si la fila ya estaba, queda en $0 y hay
  que digitarlo a mano). Lo ven en Prorrateo/Dashboard solo quienes ven TODAS las empresas del holding (misma regla que Chia Abago). El filtro «Empresa» del Dashboard no la ofrece.
- Probado con la migración dentro de una transacción revertida contra producción (usuarios reales simulados bajo RLS: antes del cambio una legalización solo-Tecbihol era invisible para el editor creador, su
  Historial por consecutivo fallaba y «Cambios desde una fecha» la omitía; después las tres la ven/incluyen, las mixtas y las de Chia Abago no cambian, permisos EXECUTE intactos, sin gastar consecutivos `LEG-`)
  y con un arnés de navegador sobre la página real con Supabase simulado (listado y filtros según perfil, guardado, detalle, Prorrateo con y sin filtro, usuario de una sola empresa). Con usuarios reales de
  producción no se probó.

## Pedidos: una remisión = una sola orden

Caso **IASO-RS-0171** (2026-11-03): quedó en la orden 146 (AGROPECUARIA INTERNACIONAL SAS, 5:00 p.m.) y en la 152 (HURTADO SANTANA DENIS MACIEL, 5:06 p.m.), y Reportes → Remisiones mostraba
«Orden 146, Orden 152». El contador emitió el 0171 una sola vez: el segundo uso fue un número **escrito a mano** (rol `admin`/`remisionador`, casilla «Auto» desmarcada en `pedidos.html`; `AUTH.canAutoConsec`)
y no había ninguna validación. De las 371 remisiones de formato estándar (SIGLA-RS/RE-0000, vigente desde 2026-08-19) era la única que cubría más de una orden/cliente; en `Pedidos.Remisiones` hay además 6 números sueltos
históricos (1415, 1417, 189, 0090, 152, 1047; el último uso fue el 2026-09-03) compartidos por varias órdenes, casi todos de un mismo cliente. **Reportes agrupa por empresa + número + módulo** (`reportes.js`, `_buildRemisionesInner`): no valida nada, solo refleja el dato.

- **«Misma orden»** = mismo `Consecutivo` y mismo `Cliente` dentro de la misma `Nombre_Empresa` (la clave `keyOf` con la que `pedidos.js` arma cada orden). **El consecutivo NO identifica una orden por sí solo**: un mismo
  consecutivo agrupa varios clientes (p. ej. IASO #148 = AGRONIZA y EXIAGRICOLA, cada uno con su remisión; PARCELAR #91–95 igual). Agregar líneas al MISMO pedido con su remisión sigue permitido.
- **Dos capas** (si cambias la regla, cámbiala en las dos):
  1. **Pantalla** (`pedidos.js`, `_remisionClave` / `_remisionFilaOtraOrden` / `_remisionUsadaEnOtraOrden`, llamadas al inicio de `guardarTodo`): si hay un número escrito a mano, consulta `Pedidos` de la empresa y, si otra orden ya lo usa
     (o usa una variante suya, ver «Clave canónica»), **bloquea** con un toast que nombra la orden y el cliente («allí figura como …» si lo escribió distinto). Va ANTES de gastar el consecutivo y de escribir nada.
     Si la consulta falla no frena (el trigger es el respaldo).
  2. **Base** (`supabase/migrations/remision_unica_por_orden_pedidos.sql`, migración remota `remision_unica_por_orden_pedidos` aplicada el 2026-11-04; rollback `..._rollback.sql`. La 2.ª,
     `remision_unica_por_orden_pedidos_variantes.sql` + `..._variantes_rollback.sql`, reemplaza el cuerpo del trigger por la comparación por clave canónica: **aplicar ANTES de publicar el código**): trigger `trg_pedidos_remision_unica_por_orden`
     (BEFORE UPDATE OF `Remisiones` en `Pedidos`, `WHEN` el valor cambia) → `fn_pedidos_remision_unica_por_orden` + `fn_pedidos_codigos_remision`. Va sobre `Pedidos.Remisiones` y no sobre `EntregasPedido`
     porque el Kardex, Existencias y Reportes leen ese campo (`EntregasPedido` es un log secundario). Solo valida los números que la línea AGREGA, así que el 0171 ya repetido no bloquea otras ediciones ni su corrección.
     Acepta el cliente anterior (`OLD`) o el nuevo (`NEW`) porque `editar_pedido_completo` actualiza línea por línea. `SECURITY DEFINER` (ve órdenes que la RLS del usuario no ve) y `pg_advisory_xact_lock`
     por empresa+número contra guardados simultáneos. Rechazo duro (23505): `editar_pedido_completo` es una sola transacción y el mensaje llega a `pedidos.js`.
- **Clave canónica** (`fn_remision_clave` en SQL, `_remisionClave` en JS: deben dar lo mismo; paridad comprobada en 46 entradas): «IASO-RS-0171», «iaso rs 171», «IASO_RS_171» e «IASORS171» son el mismo número
  (`IASO-RS-171`); RS (salida) y RE (entrada) no se mezclan; un número suelto («0090» = «90») solo se iguala a otro suelto, **nunca a uno estándar**: hay 441 números sueltos históricos que chocarían por azar con los que
  genera el contador y bloquearían guardados normales con «Auto». Consecuencia conocida: escribir «0171» a secas en una orden de IASO NO se detecta como repetición de IASO-RS-0171. El trigger lleva un prefiltro (el número
  sin ceros a la izquierda debe aparecer en el texto de la otra orden): sin él cada evaluación tardaba ~180 ms por línea; con él, 4–17 ms.
- **Rechazo y contador**: si el guardado falla por «ya pertenece a la orden…», `guardarTodo` NO devuelve el consecutivo al contador. `liberar_remision` solo compara texto exacto: un choque por variante (p. ej. «IASO-RS-200»
  escrito antes de que el contador llegue a 0200) se devolvería y cada intento volvería a generar el mismo número. Hoy los 12 contadores coinciden con el mayor número usado (nadie escribió números por delante).
- **Alcance**: solo Pedidos. Ingresos, OC, Muestras, Reenvases y Devoluciones comparten el contador pero no este candado (hoy hay un número estándar repetido entre módulos, PARCELAR-RE-0015 en Ingresos y OC; no se investigó si es legítimo). Entre empresas
  distintas no se compara. El candado también rechaza que dos órdenes del MISMO cliente salgan en una sola remisión (pasaba con números sueltos antes del 2026-09-03); no hay forma de saltarlo sin cambiar el trigger. **No corrige datos existentes**: el caso del 0171 se corrigió aparte con
  `sql/corregir_remision_iaso_rs_0171_orden_152.sql` (ejecutado el 2026-11-04: la 152 pasó a IASO-RS-0174, la 146 conserva el 0171; el PDF de la 152 con el número nuevo se reemite desde el panel). No usar «Remisión anulada» para estos casos: funciona por número y anularía también la remisión legítima.
- Probado con la migración dentro de una transacción revertida contra producción (10 casos: sin cambio sobre el 0171 repetido, número de otra orden, número libre, hermana de la misma orden, mismo consecutivo con otro cliente,
  cambio de cliente en el mismo guardado, otra empresa, minúsculas, volver a poner el 0171) y con un arnés de navegador sobre el `pedidos.js` real (15 casos: caso real, misma orden, otro cliente, minúsculas, subcadenas,
  lista heredada sin `|`, comodines `%`/`_`, otra empresa, error de red). El flujo completo con un usuario real no se probó.
- La 2.ª migración se probó en una transacción revertida contra producción (20 casos de la clave, los 10 anteriores y 10 de variantes: sin ceros, con espacios, guiones bajos o sin separadores, ceros de más, suelto contra estándar,
  RS contra RE, «90» contra el «0090» histórico, variante en la misma orden) y `pedidos.js` con un arnés de navegador (paridad SQL↔JS en 46 entradas y 24 casos de comportamiento). Con un usuario real no se probó.

## Cotizaciones (`pedidos.html` → pestaña «Cotizaciones»)

Propuesta de precios para un cliente **o prospecto**. Si el cliente la acepta, se ajusta si hace falta y se convierte en pedido. Vive dentro de Pedidos (botón «📝 Nueva Cotización» junto a
«Nuevo Pedido» y pestaña «📝 Cotizaciones»); **no hay módulo ni permiso nuevo en `usuario_modulos`**. Todo el código nuevo está en `js/cotizaciones.js`, que carga DESPUÉS de `pedidos.js` y usa sus
funciones globales.

- **Modelo** (`supabase/migrations/create_cotizaciones.sql`, migración remota `create_cotizaciones`; aplicar ANTES de publicar el código): cabecera `Cotizaciones` (una fila por cotización) +
  `CotizacionLineas` (se reemplazan completas en cada edición). Número visible **`COT-<SIGLA>-<Consecutivo>`**, consecutivo **por empresa** (no por comercial: el de pedidos, por comercial, ya duplicó
  números). Estados guardados: `Abierta` → `Aceptada` → `Convertida`; `Abierta/Aceptada` → `Rechazada` (con motivo) → `Abierta` (reabrir con vigencia nueva). **«Vencida» no se guarda**: es una `Abierta`
  con `Vigente_Hasta < hoy` (`cotEstadoEfectivo`). Editable: Abierta y Aceptada. Convertible: solo Aceptada. Sin versiones: lo editado queda en `audit_log` (ambas tablas lo tienen).
- **Vigencia**: `COT_VIGENCIA_DIAS = 8` días **calendario** (corridos, no hábiles; el pedido sí usa 8 hábiles para el compromiso) desde la fecha de la cotización; «Válida hasta» se puede ajustar. No se acepta
  una vencida (hay que editarla y extender la vigencia) ni se guarda una Abierta con vigencia pasada.
- **Sin IVA ni descuentos**: los productos no manejan IVA, así que ni el formulario ni el PDF lo mencionan. Valores como en el pedido: producto, cantidad, valor unitario, total.
- **Escritura SOLO por RPC** (atómicas, `SECURITY INVOKER` → aplican las RLS): `guardar_cotizacion(id, cab, lineas)` (crea o edita; recalcula `Valor_Total` y `Total` en el servidor), `cambiar_estado_cotizacion`,
  `marcar_cotizacion_convertida`. `generar_consecutivo_cotizacion` es `SECURITY DEFINER` a propósito (con RLS un comercial solo ve lo suyo y el `MAX()+1` saldría repetido; lock por empresa).
  El trigger `trg_cotizaciones_guard` hace cumplir las transiciones aunque alguien escriba directo a la tabla (Convertida inmutable, Rechazada no se edita, empresa/número no cambian, no se acepta vencida).
  Desde JS: `apiPost({action:'guardarCotizacion'|'cambiarEstadoCotizacion'|'marcarCotizacionConvertida'})` y `apiGet('getCotizaciones'|'getCotizacion',{id})` (shared.js). La lista se carga **al abrir la pestaña**
  (no en `loadFromAPI`, que ya es lenta).
- **Permisos** (RLS calcada de `Pedidos`): admin, editor, contabilidad, gerente_iaso y remisionador crean/editan en sus empresas; `lector` solo consulta; `comercial` solo ve/edita las suyas
  (`comercial_id` o `creado_por = auth.uid()`; al crear exige `comercial_id = auth.uid()`); borrar: solo admin (no hay botón). Despachador, cartera y producción no tienen acceso. En JS:
  `AUTH.verCotizaciones()` (canEdit + lector) para la pestaña y `AUTH.canEdit()` para escribir.
- **El formulario es el modal de «Nuevo Pedido» en «modo cotización»** (mismo patrón que «Nuevo Traslado»): clase `.modo-cot` en `#nuevo-overlay` (el CSS oculta consecutivo, Facturar a, NIT adicional, Consignación,
  Bodega de facturación y Carga histórica; por CSS y no por JS porque `_toggleBodegaField` los vuelve a mostrar) + banderas `_nvEsCotizacion` / `_nvCotizacionId` / `_nvCotizacionOrigen` (declaradas en `pedidos.js`;
  `openNuevoPedido` y `closeNuevo` las apagan con `cotAplicarModo(false)`). Ganchos en `pedidos.js`: `guardarNuevoPedido` delega en `guardarCotizacion` si `_nvEsCotizacion`; `switchPedidoTab` conoce la pestaña
  (y oculta `.stats`/`.filters`, que son de pedidos). **Si cambias el modal de Nuevo Pedido (ids `nv-*`), revisa también `cotAplicarModo` y `cotPrecargarModal`.**
- **Cliente o prospecto**: no se exige NIT y la cotización NO crea nada en Clientes ni agrega productos al maestro; eso ocurre solo al convertir, por el flujo normal del pedido
  (`registrarClienteNuevoDesdePedido` + aprobación de Cartera si es cliente nuevo). Se puede cotizar a un cliente bloqueado/inactivo (solo avisa al elegirlo); al convertir, el servidor rechaza el pedido como siempre.
- **Conversión**: «🛒 Convertir en pedido» (solo Aceptada) abre **Nuevo Pedido precargado** (`cotPrecargarModal(cot,'pedido')`): el comercial revisa, completa (p. ej. Bodega de facturación en PARCELAR, comercial
  si la cotización no lo traía) y guarda con `guardarNuevoPedido` de siempre, con todas sus validaciones. Al guardarse bien el pedido, `cotMarcarConvertida` deja la cotización `Convertida` con `Pedido_Consecutivo` y
  `Pedido_Cliente`. El pedido lleva `Archivo_Fuente = 'Ingreso manual'` **a propósito** (el trigger de aprobación de cliente nuevo compara esa cadena exacta; con otro valor se saltaría la aprobación) y las
  observaciones empiezan con «Cotización COT-…». **Los precios cotizados no se pisan con la lista**: las líneas precargadas llevan `precio_fijo` y el `blur` del producto (que reaplica el precio de lista) las respeta;
  cambiar lista, empresa o cliente sí reprecia (`_reapplyPreciosNuevo` suelta la marca), igual que elegir otro producto del autocompletado.
- **Riesgo conocido**: no hay transacción entre crear el pedido (JS, `agregarPedido`) y marcar la cotización. Si `marcar_cotizacion_convertida` falla después de crear el pedido (red), la cotización queda
  «Aceptada» y se avisa con un toast largo («PERO COT-… no quedó marcada como convertida… no dupliques el pedido»); hay que avisar a un administrador (se corrige en la base).
- **PDF** (`generarCotizacionPDF`, media carta apaisada con `_nuevoPdfDoc()`): membrete con logo, razón social, NIT, dirección y contacto de la empresa (`_pdfRemisionHeaderInfoFor`), «COTIZACIÓN COT-…», fecha y
  «Válida hasta», datos del cliente, asesor (nombre, no el código: `cotNombreComercial`), plazo de pago, tabla (columna «Bonif.» solo si hay línea bonificada), total, observaciones y pie paginado. **No muestra el tipo
  de lista de precios** (Dealer/Mayorista, dato interno) ni IVA. Al crear una cotización se descarga solo; después, desde el detalle o el 📄 de la lista (se genera siempre con lo guardado).
- **Se ve en**: lista (N°, fechas, empresa, cliente, NIT, comercial, total, estado con el pedido enlazado; filtros de empresa, estado —incluye «Vencida»— y búsqueda), detalle (banner por estado, líneas, auditoría y botones
  según estado y rol; rechazar y reabrir piden su dato en un recuadro dentro del detalle), `js/backup.js` (`BACKUP_TABLES`) y el filtro de tablas de `auditoria.html`.
- **Fuera de alcance** (por decisión): correo desde el panel (solo PDF descargable), descuentos, versiones/revisiones, revisión de stock al cotizar, notificaciones en la campanita, Dashboard/Reportes y el alcance de
  Contabilidad en Auditoría (`audit_tablas_documentales`).
- Probado con la migración dentro de una transacción revertida contra producción (consecutivo por empresa independiente de la visibilidad de cada rol, RLS por rol —admin, comerciales A/B, lector, gerente, contabilidad de
  otra empresa, despachador, cartera, anon—, edición atómica con línea inválida, transiciones, vencimiento, bloqueo de lo convertido, borrado solo admin, unicidad, totales y auditoría) y con un arnés de navegador sobre
  la página real `pedidos.html` con Supabase simulado (alta de prospecto sin NIT, PDF de 1 y de 4 páginas, edición con precio conservado, rechazar/reabrir/aceptar, vencida, conversión con precio intacto y vínculo, falla
  del vínculo, regresión de «Nuevo Pedido» y «Nuevo Traslado», roles lector/comercial/despachador, HTML malicioso en nombres y errores de carga). **El flujo con usuarios reales (permisos reales de cada rol y el envío del PDF al
  cliente) no se probó.**

## Órdenes de compra: Contabilidad se entera al aprobarse, rechazarse o legalizarse la OC

Antes, al aprobar una OC `ordenes.js` solo avisaba a quien la creó (`_notifyCreadorAprobacionOC`) y al crearla, a los aprobadores de la empresa ORIGEN (`find_oc_approvers`): la contabilidad de la
empresa DESTINO (la que recibe el stock) no sabía nada hasta que se despachaba el pedido (paquete de remisiones de `pedidos.js`) o, ya despachado, el «complemento tardío»
(`_avisarContabilidadTrasladoTardio`). Caso real: OC 621 (IASO ← PARCELAR), aprobada el 29/10 y legalizada el 05/11 sin que la contabilidad de IASO lo supiera. Contabilidad = 1 usuario activo por empresa
(rol `contabilidad` + `usuario_empresas`); todos tienen `ordenes_aprobar`, por eso la de la empresa origen ya veía y aprobaba la OC, y la de destino no.

- **Dónde vive**: un trigger en la base, no en el navegador (`supabase/migrations/avisar_contabilidad_oc.sql`, migración remota `avisar_contabilidad_oc` aplicada el 2026-11-10; rollback `..._rollback.sql`, que no borra los
  avisos ya enviados). `trg_oc_avisar_contabilidad` (AFTER INSERT OR UPDATE OF `Estado_Aprobacion`, `Remision`, `Remision_Origen` en `OrdenesCompra`) → `fn_oc_avisar_contabilidad` → `_oc_avisar_contabilidad`
  (arma y guarda el aviso) + `_oc_contabilidad_destinatarios` (contabilidad activa de la empresa destino Y de la origen). Funciona sin importar quién ni desde qué pantalla se apruebe, y **no hay cambios en el
  frontend**: es una fila en `notificaciones` (módulo `ordenes`, referencia = consecutivo) y la campanita ya la recibe por Realtime con sonido y contador; el clic abre `ordenes.html?buscar=<consecutivo>` (`NOTIF.destino`).
  Solo llega en vivo si contabilidad tiene el panel abierto (y, para que suene, si hizo clic en la página); si no, lo ve al entrar.
- **Eventos** (uno por OC, no por línea): `aprobada` (✅, `Estado_Aprobacion` pasa a «Aprobada» o la OC nace ya aprobada), `rechazada` (❌, con el motivo) y `legalizada` (📦, `Remision` o `Remision_Origen`
  pasa de vacío a lleno en una OC aprobada y no anulada; el mensaje trae las remisiones de entrada y salida). El título usa el mismo formato que los avisos de `ordenes.js`: `<evento> OC …: <sigla destino> ← <sigla origen> #<consecutivo>`.
- **Reglas**: no se avisa a quien ejecutó la acción (`auth.uid()`); en aprobada/rechazada tampoco al creador de la OC (ya recibe el suyo desde `ordenes.js`). Sin duplicados: aprobada/rechazada no repiten el mismo aviso
  dentro de 10 min (aprobar actualiza todas las líneas de golpe); legalizada y pendiente, una sola vez por OC y persona (legalizar actualiza línea por línea). OC sin consecutivo (filas históricas) no avisan; una empresa
  fuera del holding (CHIA ABAGO) no tiene contabilidad, así que solo se avisa a la de la otra empresa. **Nunca bloquea** aprobar/rechazar/legalizar: un fallo queda como WARNING. Las tres funciones no son llamables por
  clientes (REVOKE a `public/anon/authenticated`, comprobado en producción).
- **Aviso único** (al aplicar la migración): las OC aprobadas y aún sin legalizar (con consecutivo y `Fecha_Aprobacion`) avisaron una vez con el evento `pendiente` (⏳). Fueron 4 avisos: las dos OC IASO ← GREEN del
  09/11 (T-20261109-102347-GREEN y T-20261109-104711-GREEN) a Alison (IASO) y Sharon (GREEN). Las filas históricas sin consecutivo ni fecha de aprobación se omiten a propósito. Repetir la migración no repite avisos.
- **Convive con lo anterior**: el aviso es de TEXTO (no lleva PDF; el PDF de remisiones sigue saliendo por el paquete del despacho y el complemento tardío) y no reemplaza el aviso al creador ni el de «por aprobar» a los aprobadores.
  Si cambias el formato de los títulos, revisa `NOTIF.destino` (usa `referencia`) y el dedupe, que compara `titulo` exacto.
- Probado contra producción con transacciones revertidas (usuarios reales simulados con `request.jwt.claims`): crear no avisa; aprobar 2 líneas de golpe → 1 aviso a Alison, sin Lizeth (la aprobadora); reaprobar en 10 min no duplica;
  legalizar línea por línea → 1 aviso a cada contabilidad; aprueba un gerente → Alison y Lizeth; rechazo con motivo; OC que nace aprobada; consecutivo vacío no avisa; sin sesión (script SQL) avisa con `de_usuario_id` nulo;
  creador contabilidad no recibe duplicado; destino CHIA ABAGO → solo la origen; OC anulada no avisa al poner remisión; sobre una OC REAL ligada a un pedido el trigger de reserva de stock y este conviven (apartado
  creado y avisos a Alison y Sharon). Todo revertido y verificado. El flujo completo con usuarios reales (aprobar en Órdenes y ver la campanita de contabilidad) no se probó.

## Legalización de gastos: cierre de mes

`legalizacion-gastos.html` + `js/legalizacion-gastos.js`. Un mes **cerrado** (y todos los anteriores) solo lo toca un administrador: para cualquier otro usuario NO se puede **crear, editar ni eliminar** una
legalización (Ruta / Mantenimiento) ni un envío cuya `Fecha` caiga en un período cerrado, ni **cambiar la fecha** de un registro para meterlo o sacarlo de él. Pedido el 2026-11-11: **octubre cerrado**
(con septiembre, que es el mes anterior y donde empiezan los datos: 2026-09-01).

- **Modelo** (`supabase/migrations/legalizacion_gastos_cierre_mes.sql`, migración remota `legalizacion_gastos_cierre_mes` aplicada el 2026-11-11; rollback `..._rollback.sql`; **aplicar ANTES de publicar el código**): tabla
  `LegalizacionGastosCierres` (una fila por cierre; `Cerrado_Hasta` = último día cerrado, siempre un fin de mes —CHECK— y único). **Una fecha está cerrada si es ≤ al mayor `Cerrado_Hasta`**, o sea que cerrar un mes
  cierra también los anteriores. Hoy hay una sola fila: `2026-10-31`. Lectura: quien tiene `legalizacion_gastos` o `_aprobar`; escritura: solo admin (RLS) o SQL/migración.
  - **Cerrar noviembre**: `INSERT INTO "LegalizacionGastosCierres" ("Cerrado_Hasta","Nota") VALUES ('2026-11-30','Cierre de noviembre de 2026');` (con SQL editor o `apply_migration`; **no hay botón en pantalla**).
  - **Reabrir**: borrar esa fila (y las posteriores). Para reabrir octubre pero dejar cerrado septiembre: borrar la de octubre e insertar `2026-09-30`. Con un solo cierre vigente, borrarlo deja TODO abierto.
- **Cómo se hace cumplir** (BD, no se puede saltar desde la consola): triggers `trg_legalizacion_gastos_cierre_mes` (BEFORE INSERT/UPDATE/DELETE) en `LegalizacionGastos`, `LegalizacionGastosItems` y
  `LegalizacionGastosEmpresas` (las líneas y el reparto miran la fecha de su legalización) → `fn_legalizacion_gastos_cierre_mes` / `fn_legalizacion_gastos_hijos_cierre_mes` →
  `legalizacion_gastos_asegurar_fecha_abierta(fecha)`. Son triggers y no políticas RLS para no tocar las políticas vigentes. Error: «Período cerrado: la fecha dd/mm/aaaa pertenece a un mes cerrado (hasta el …)…».
  - **Quién pasa**: `usuarios.rol = 'admin'` (`get_user_role()`; hoy un solo usuario) y las llamadas **sin sesión** (SQL editor, service role, migraciones: `auth.uid()` NULL). No está atado a un id: otro admin futuro también pasa.
  - **Conciliar/rechazar sigue permitido** en meses cerrados (RPC `conciliar_legalizacion_gastos`): el trigger de la cabecera compara la fila sin `Estado_Conciliacion`, saldos, `Conciliado_Por`, `Fecha_Conciliacion`,
    `Motivo_Rechazo` y `modificado_*`; si solo cambió eso, deja pasar. Los 64 registros de octubre estaban todos «Por conciliar». Para cerrar también la conciliación habría que quitar esa excepción.
  - Las funciones de apoyo no son llamables por clientes (REVOKE); solo `legalizacion_gastos_cerrado_hasta()` (la usa la pantalla) tiene EXECUTE para `authenticated`.
  - **Fuera de alcance** (por decisión): los **soportes adjuntos** (bucket `legalizacion-gastos-adjuntos`: la pantalla los oculta/rechaza en meses cerrados pero la BD no), las **Remisiones externas** (Chia Abago /
    Materias primas), las notas del Consecutivo y los vehículos.
- **Pantalla** (`js/legalizacion-gastos.js`, bloque «Cierre de mes» junto a `puedeEditarLeg`): `loadCierreLeg()` lee el cierre (RPC) dentro de `loadLegalizaciones()`; si falla queda `null` y NO oculta nada (la BD manda).
  `puedeEditarLeg` ya no deja editar un registro de período cerrado a un no admin (esconde ✏️ y «Editar», y las tres `openForm*` avisan con `msgNoEditableLeg`); `fechaLegAbierta(inputId)` avisa al elegir la fecha y
  frena `saveForm` / `saveFormMant` / `saveFormEnvio` antes de gastar nada; los adjuntos (subir/eliminar) se ocultan y rechazan; 🔒 junto a la fecha en las dos listas y «🔒 Período cerrado» en el detalle (también para
  el admin, informativo). El botón 🗑️ ya era solo de admin. Si cambias la regla, cámbiala en las dos capas (trigger y `legFechaCerrada` / `legCerradaParaUsuario`).
- Probado: la migración completa dentro de una transacción revertida contra producción con usuarios reales simulados (`request.jwt.claims`; editor, editor-conciliador y admin; 45 casos: crear/editar/mover fecha/borrar en
  octubre, septiembre, meses muy anteriores y noviembre, líneas y reparto, conciliar y rechazar, admin con cascada, sin sesión, tabla de cierres por RLS, CHECK de fin de mes, UNIQUE, cerrar y reabrir noviembre) y después
  de aplicarla sobre registros reales de octubre y noviembre (también revertido: 144 legalizaciones intactas, 0 de prueba). La pantalla con un arnés de navegador sobre el código real (sintaxis de todo el archivo y 20 casos de
  los helpers: no admin, admin, rpc con error / excepción / sin cierres). **No se probó la pantalla completa con un usuario real** (crear/editar/adjuntar desde el navegador).

## Salidas a producción: tipo de salida (Reenvase / Reetiquetado / Reformulación / …)

**Estado:** migración remota `reenvases_tipo_salida` (`supabase/migrations/reenvases_tipo_salida.sql`) **aplicada el 2026-11-12** y verificada en producción (452 líneas, ninguna sin tipo, sin salidas mezcladas, auditoría intacta,
funciones no expuestas a clientes); va ANTES de publicar `reenvases.js`, `ingresos.js` y `shared.js` (ya piden/escriben `Tipo_Salida`). Rollback: `..._rollback.sql`. Mismo patrón que «Ingresos: tipo de ingreso» (abajo).

- **Siete tipos** (`RE_TIPOS`, `js/reenvases.js`; mismos ids que el CHECK `reenvases_tipo_salida_check`): `REENVASE`, `REETIQUETADO` (cambio de etiqueta/tapa), `REFORMULACION`, `MUESTRAS` (Muestra_Ref o pruebas/laboratorio),
  `TRASLADO_DEVOLUCION` (sin planta y con empresa destino, o notas de devolución/traslado), `OTROS` y `SIN_CLASIFICAR` (histórico sin nota: 43 salidas, todas pendientes; solo se corrige a mano, las nuevas exigen tipo).
  Decisiones del usuario: Reetiquetado y Traslado/devolución con categoría propia; las sin nota quedan «Sin clasificar»; los ingresos de retorno heredan el tipo de su salida.
- **Modelo**: `Reenvases."Tipo_Salida"` (text NOT NULL default `''`); reglas en `_reenvase_tipo_sugerido` (lee las Observaciones de TODAS las líneas de la salida, Remision + Empresa); trigger `trg_reenvases_tipo_defecto`
  (vacío → hereda de otra línea de la misma salida o deduce); relleno del histórico con la auditoría apagada. Probado en transacción revertida contra producción (237 salidas: Reenvase 96, Reformulación 27, Reetiquetado 31,
  Traslado/devolución 24, Muestras 7, Otros 9, Sin clasificar 43; sin tipos mezclados, auditoría intacta, migración dos veces).
- **Herencia hacia Ingresos**: `_ingreso_tipo_sugerido` (ahora STABLE) lee la salida: retorno de una salida REFORMULACION → ingreso REFORMULACION; cualquier otra → REENVASE (Ingresos no tiene «reetiquetado»). La migración corrige
  los ingresos ya vinculados (13 líneas) y el trigger `trg_reenvases_tipo_a_ingresos` mueve los retornos entre REENVASE y REFORMULACION cuando cambia el tipo de la salida, SOLO si seguían con el tipo heredado.
  `ingresos.js`: `ingTipoSugerido(…, tipoSalida)`, `_tipoSalidaDeRef`, `_ingReenvaseTipoSalida`; `getReenvases` pide `Tipo_Salida`.
- **Pantalla**: tarjetas por tipo (salidas, unidades y pendientes de retorno; según los demás filtros y la bodega activa) que filtran la tabla (`setReTipoFiltro`); columna «Tipo» y borde de color (por salidas y por productos);
  filtro `f-tipo`; formulario con «Tipo de salida» obligatorio (`re-tipo`; solo se propone Muestras o Traslado/devolución, lo demás lo elige el usuario; fijo al agregar un producto; oculto al editar una línea);
  **el tipo se cambia desde el detalle para TODAS las líneas** (`editarTipoSalidaReenvase`, shared.js; `guardarTipoSalidaReenvase`). Se quitaron las tarjetas «Con remisión / Sin remisión / Unidades totales».
  La regla JS `reTipoSugerido` y la SQL deben mantenerse iguales (el JS no mira texto).
- Probado con arnés de navegador (Supabase simulado) sobre `reenvases.html` y `ingresos.html` reales: tarjetas, filtros, orden, detalle, clasificar una salida, formulario, alta, agregar producto, edición, camino del JS anterior y herencia.
  No se probó con usuarios reales. `js/ingresos.js`, `js/reenvases.js` y `reenvases.html` tenían además cambios AJENOS sin commit (avisos a contabilidad): separarlos al hacer commit.

## Ingresos: tipo de ingreso (Fabricado / PT proveedor / Reenvase / …)

`ingresos.html` + `js/ingresos.js` distinguen **qué clase de ingreso es**, no solo de dónde viene. Pedido 2026-11-12: separar lo realmente fabricado del producto terminado de
proveedores, los reenvases y el resto. Solo aplica a Ingresos (Kardex, Existencias y Reportes NO leen el tipo).

- **Siete tipos** (`ING_TIPOS`, `js/ingresos.js`; mismos ids que el CHECK de la base): `FABRICADO` (planta propia: Mosquera / Cachipay), `PT_PROVEEDOR` (Carval, **Chia Abago**,
  Germisemillas, Bodega Villeta), `REENVASE`, `REFORMULACION`, `BIDONES_USADOS`, `GRANEL` (destino GRANEL) y `OTROS` (Ecociclus, personas —p. ej. DISNEY CASTELLANOS, JOHN PAEZ—, bodegas,
  retornos de consignación…). Decisiones del usuario: Chia Abago es proveedor de PT; bidones usados y granel son categorías separadas; reformulación tiene la suya; Ecociclus y orígenes
  «otros» van en Otros. Nota: en `shared.js` (`_getCategoria`) Disney C. figura como proveedor de oxicloruro; aquí se dejó en Otros por decisión del usuario.
- **Modelo** (`supabase/migrations/ingresos_tipo_ingreso.sql`, migración remota `ingresos_tipo_ingreso` **aplicada el 2026-11-12**, rollback `..._rollback.sql`; va ANTES de publicar el código, porque `getIngresos` ya pide la columna): `Ingresos."Tipo_Ingreso"`
  (text NOT NULL, default `''`, CHECK con los siete valores). Se repite en todas las líneas del ingreso, como Origen o Responsable. `_ingreso_tipo_sugerido(origen, destino, reenvase_ref, observaciones)`
  guarda las reglas EN LA BASE (orden: vínculo `Reenvase_Ref` → REENVASE; destino GRANEL → GRANEL; planta + «bidones usados» → BIDONES_USADOS; planta + «reformul» → REFORMULACION; planta +
  reenvase/reembase/reempaque → REENVASE; planta → FABRICADO; origen proveedor → PT_PROVEEDOR; resto → OTROS; las reglas por texto solo miran orígenes que empiezan por «planta»). El trigger
  `trg_ingresos_tipo_defecto` (BEFORE INSERT / UPDATE OF `Tipo_Ingreso`) las aplica si el valor llega vacío: así una pestaña con el JS anterior o cualquier otro camino de escritura nunca deja un ingreso sin tipo.
- **Histórico**: la migración rellena lo ya guardado POR INGRESO (mismas columnas con las que agrupa `keyOfIng`, leyendo las Observaciones de todas sus líneas, para que no queden tipos mezclados dentro de un
  ingreso) con los triggers de auditoría apagados, igual que `add_placa_por_linea_mantenimiento.sql`: no genera «modificaciones» falsas. Resultado probado contra producción (transacción revertida, 375 ingresos / 705 líneas):
  FABRICADO 176, REENVASE 98 (68 vinculados + 30 detectados por texto), PT_PROVEEDOR 66, GRANEL 13, OTROS 10, REFORMULACION 9, BIDONES_USADOS 3. **Lo deducido por texto es una sugerencia sobre texto libre**:
  se corrige editando el ingreso («Tipo de ingreso»).
- **Pantalla**: tarjetas por tipo (más «Todos») que cuentan ingresos y unidades según los demás filtros (menos el de Tipo) y al hacer clic filtran la tabla (`setIngTipoFiltro`; segundo clic quita el filtro);
  columna «Tipo» con insignia y borde de color en la primera celda (tabla agrupada y «Vista detallada»); filtro «Tipo» (`f-tipo`, también por texto en «Buscar»); insignia en el encabezado del detalle;
  columna «Tipo» en los dos Excel. Las tarjetas «Planta Mosquera / Planta Cachipay» se quitaron (Origen sigue siendo filtro). `keyOfIng` incluye el tipo: cambiar el tipo de UNA línea la separa del ingreso
  (igual que pasa con Origen o `Reenvase_Ref`).
- **Formulario**: campo obligatorio «Tipo de ingreso» (`ing-tipo`) que se PROPONE solo (`ingTipoSugerido`: vínculo con salida a producción → Reenvase; destino GRANEL → Granel; planta → Fabricado; proveedor → PT proveedor;
  resto → Otros) mientras el usuario no lo toque; al elegirlo a mano, o al editar / agregar un producto a un ingreso que ya tiene tipo, se respeta (`_ingTipoManual`). **La regla de `ingTipoSugerido` (JS) y la de
  `_ingreso_tipo_sugerido` (SQL) deben mantenerse iguales** (el JS no mira Observaciones). `agregarIngreso` / `editarIngreso` (`shared.js`) guardan `Tipo_Ingreso`; en la edición solo si el form lo envía.
  Los PDF de remisión de ingreso no llevan el tipo.
- Probado: la migración dentro de una transacción revertida contra producción (corrida dos veces, auditoría y `modificado_en` intactos, 375 ingresos antes y después, ningún ingreso con tipos mezclados, 19 casos de las
  reglas, trigger con insert sin tipo / tipo explícito / update a vacío, CHECK rechaza valores inválidos) y la pantalla real con un arnés de navegador (`ingresos.html` + `shared.js` + `ingresos.js` con Supabase simulado: 30 comprobaciones
  de tarjetas, filtros, orden, detalle, Excel, formulario, alta, edición, agregar producto, retorno de reenvase y camino del JS anterior). **No se probó con un usuario real contra producción.**

## Remisiones de entrada/salida: aviso SIEMPRE a la contabilidad de la empresa

Toda remisión de ingreso (RE) o salida (RS) de las empresas del holding (PARCELAR, RESO, IASO, IAS, GREEN) que mueve inventario debe llegarle a la contabilidad **de la empresa dueña del consecutivo**
(la sigla del prefijo: `GREEN-RE-0058` → contabilidad de GREEN). Hay 1 usuario `contabilidad` activo por empresa (`usuario_empresas`, RPC `list_contabilidad_por_empresa`). GRANEL no tiene contabilidad:
su remisión va a producción (`NOTIF.resolverProduccion`). Auditoría del 2026-11-12 contra producción: los permisos de `notificaciones` y de Storage dejan enviar a cualquier rol con sesión (el remisionador también);
los huecos estaban en el código de cada módulo.

- **Mecanismo** (`js/notificaciones.js`, no hay trigger en la base salvo para OC): al guardar, el módulo llama a `NOTIF.confirmarEnvioContabilidad(empresa|[empresas], módulo, {empresas})` (diálogo «Guardar y Enviar») y, ya guardado,
  a `NOTIF.enviarPDFContabilidad(doc, meta)`, que además suma la contabilidad de cada empresa de `meta.empresa/empresas` y de la sigla de cada consecutivo de `meta.remisiones/titulo/referencia`. Se omite al propio usuario
  (si la contabilidad es quien guarda no se auto-avisa). El botón manual «📨 Enviar» (`openModalEnviar`) siempre agrega a esa contabilidad y no se puede desmarcar. Las **OC de traslado** avisan por trigger
  (`trg_oc_avisar_contabilidad`, ver su sección): no pasan por aquí.
- **Módulos con aviso al guardar** (`AUTO_CONTAB_MODS`): pedidos, ingresos, devoluciones, cambios, muestras, reenvases y **kardex** (nuevo: remisiones de la bodega NC; `modulo='kardex'` ya estaba en el CHECK de `notificaciones`).
- **Huecos que se cerraron** (2026-11-12; en producción 17 de 19 RE de Reenvases y 3 de Bodega NC no habían llegado a su contabilidad): (1) **Reenvases**: el PDF automático solo llevaba la RS; ahora lleva RS + RE
  (`_reDocContabilidad`) y la confirmación incluye la empresa destino. (2) **Kardex → Bodega NC** (ingreso/salida NC): antes solo descargaba el PDF; ahora confirma y envía (`_ncEnviarContabilidad`); un registro histórico
  no avisa. (3) **Devoluciones, «Tramitar» masivo**: antes no avisaba; ahora confirma una vez y envía un PDF por devolución a la contabilidad de SU empresa (`_devEnviarContabilidad`). (4) **Editar** un Ingreso, un Reenvase o un
  registro NC que genera o cambia una remisión: ahora envía (sin diálogo previo; el aviso lo da el toast). (5) **Fallos silenciosos**: los `catch` de los envíos solo dejaban un `console.error`.
- **Los fallos ya no se pierden**: `NOTIF.falloEnvio(e, botón)` y las alertas de `enviarPDFContabilidad` dejan una **franja roja** fija abajo (`#notif-alertas`, se cierra a mano), porque el toast (`#toast`, uno solo) lo pisaba
  el «✅ guardado» siguiente. Se avisa (sin frenar el guardado, la remisión ya existe) cuando: la consulta de contabilidad falla (se reintenta una vez), una empresa del holding no tiene contabilidad activa
  (`resolverContabilidad` devuelve `sinContab`), el PDF no se puede armar, o solo llegó a parte de los destinatarios. Los módulos ya no exigen `contabIds.length` para enviar: si la consulta falló al confirmar,
  se vuelve a resolver al enviar.
- **Corrección de paso**: `editarReenvase` guardaba `Remision_Destino = ''` porque el formulario no la enviaba (borraba la RE existente al editar una línea); `saveReenvase` ahora manda la del formulario.
- **Pendiente / fuera de alcance**: el aviso sigue siendo del navegador (si se cierra la pestaña entre guardar y enviar, no sale; se reenvía con «Enviar»); no se avisó retroactivamente de las ~23 remisiones que ya habían quedado sin aviso
  (Reenvases RE, Bodega NC, algunas de Ingresos/Devoluciones anteriores al 1-oct); las cargas históricas no avisan (no afectan existencias).
- Probado con un arnés de navegador sobre los archivos reales (`with(scope)` con Supabase, PDF y DOM simulados; 85 comprobaciones): `NOTIF` (reintento, sin contabilidad, contabilidad = quien guarda, externas, fallo parcial/total,
  franja persistente) y el alta/edición de Reenvases, Ingresos, Bodega NC y el trámite masivo de Devoluciones (confirmación única, un PDF por devolución a su empresa, envío caído, cancelar). **No se probó con usuarios reales ni contra Storage real.**
