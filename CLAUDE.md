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
  Las tarjetas y el menú muestran «Solicitudes de Eventos» con ese mismo permiso.
- **Tabla** `solicitudes_eventos` (`supabase/add_solicitudes_eventos.sql`, aplicada como migración remota `add_solicitudes_eventos`): SIN políticas,
  solo las Edge Functions (service_role). Numeración visible `SE-<n>`. Todo el formulario normalizado viaja en `datos` (jsonb); columnas sueltas:
  empresa, nombre y fecha del evento, `fecha_radicacion`.
- **Edge Functions** (`supabase/functions/`): `solicitud-evento` (`verify_jwt=true`; acciones `contexto`, `preparar`, `crear`, `reenviar`, `editar`,
  `listar`, `pendientes`, `aprobadas`, `observar`, `aprobar`, `rechazar`, `archivo_url`) y `solicitud-evento-aviso` (`verify_jwt=false`, la llama pqrs
  con `PQRS_BRIDGE_SECRET`; eventos `estado`, `respuesta`, `rechazo`). El puente hacia pqrs es `solicitud-evento-pedidos` (URL por defecto en el código;
  `PQRS_EVENTO_BRIDGE_URL` opcional); mismo secreto `PQRS_BRIDGE_SECRET` que ya usa Solicitudes a Mercadeo.
- **Política de 15 días**: solo advertencia (no bloquea). `fecha_radicacion` = día del envío del solicitante (un reenvío tras un rechazo cuenta como
  radicar de nuevo; editar sin rechazo NO la reinicia). `aprobar` se niega si la fecha del evento ya pasó (409): se rechaza para que se corrija.
- **Qué se puede editar**: mientras Mercadeo no haya aprobado el evento (`radicada`/`en_revision`). Una solicitud aprobada aquí pero sin aprobar en
  Mercadeo se «retira» (el evento pasa a `cancelada` en pqrs) y vuelve a aprobación; ya aprobada por Mercadeo, se le deja una **observación**.
- **Avisos**: campanita con módulo `solicitudes_mercadeo` y referencia `SE-<n>`; `js/notificaciones.js` enruta las `SE-` a `solicitudes-eventos.html`.
- Probado con un arnés de navegador (Edge Function simulada en memoria); las funciones se desplegaron y rechazan llamadas sin credenciales. El flujo
  completo contra producción requiere una sesión real de un usuario con el permiso.
