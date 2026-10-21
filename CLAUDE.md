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
- **Logística y presencialidad**: las opciones (`registros`, `coordinacion_logistica`, `plataforma_virtual`, `presencia_mercadeo` = «Se solicita presencia de Mercadeo»)
  viven en TRES sitios que hay que mantener iguales: `EV_LOGISTICA` (solicitudes-eventos.js), `LOGISTICA` en la función `solicitud-evento` y, en panel-pqrs,
  `LOGISTICA` de `solicitud-evento-pedidos` + el CHECK `mercadeo_eventos_logistica_check` y el brief (migración 0034) + la lista de `js/panel/eventos.js`.
  Una opción nueva exige aplicar primero la migración de pqrs; si no, el CHECK rechaza el evento al aprobarse.
- **Qué se puede editar**: mientras Mercadeo no haya aprobado el evento (`radicada`/`en_revision`). Una solicitud aprobada aquí pero sin aprobar en
  Mercadeo se «retira» (el evento pasa a `cancelada` en pqrs) y vuelve a aprobación; ya aprobada por Mercadeo, se le deja una **observación**.
- **Avisos**: campanita con módulo `solicitudes_mercadeo` y referencia `SE-<n>`; `js/notificaciones.js` enruta las `SE-` a `solicitudes-eventos.html`.
- Probado con un arnés de navegador (Edge Function simulada en memoria); las funciones se desplegaron y rechazan llamadas sin credenciales. El flujo
  completo contra producción requiere una sesión real de un usuario con el permiso.
