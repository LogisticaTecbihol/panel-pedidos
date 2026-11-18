# Gestión de inventario en bodegas satélite / consignación

**Diseño y plan de implementación** · Panel Pedidos · diseño del 2026-11-17

> **Estado (2026-11-18):** implementado como **piloto en IASO** (Bodega COATOL Chicoral, Bodega COATOL Ibagué y Bodega ESPINAL): las fases 0, 1 y 1b ya están en producción. **No** se han hecho la fase 2 (solicitudes de muestra / cambio / devolución a la principal) ni la fase 3 (supervisión en la principal más allá de la pestaña «Gestión»). El **Paso 0** de endurecimiento (sección 7) está **aplazado**. Este documento es el diseño original; lo construido, las reglas finales y lo probado están en la sección «Bodegas satélite / consignación» de `CLAUDE.md`.
> **Diferencias respecto al diseño:** una cuenta del panel (p. ej. un comercial) también puede ser usuaria de bodega con su misma cuenta; `login.html` redirige a la app de bodegas a quien es solo de bodega; la administración vive en la pestaña «Gestión de bodegas satélite» de `bodegas-consignacion.html` (solo admin).
> **Nota de publicación:** este repositorio se sirve por GitHub Pages, así que este archivo es público. Se omiten a propósito los detalles de endurecimiento de la base (qué funciones y políticas faltan por proteger).

---

## 1. Resumen

**Pregunta:** ¿cómo gestionar el inventario de las bodegas satélite / en consignación, con usuarios distintos a los actuales, sin afectar en nada el inventario, movimientos ni reportes de la bodega principal?

**Respuesta corta:** darles un **libro de inventario propio** (tablas `Bodega*`) y una **identidad de usuario separada**, y conectarlo con la principal solo por dos puertas controladas:

1. **Entrada (principal → satélite):** los traslados que la principal ya registra en `Pedidos` se *leen* (sin precios ni clientes) para que la bodega confirme lo recibido.
2. **Salida (satélite → principal):** la bodega solo deja *solicitudes* (muestras, cambios, devoluciones); la principal las atiende con sus módulos de hoy.

Nada de lo que haga una bodega satélite escribe en tablas de la principal, y la principal no lee las tablas de la satélite (salvo el panel de supervisión de solo lectura).

```
        PRINCIPAL (sin cambios)                      BODEGA SATÉLITE (nuevo, aislado)
  ┌───────────────────────────────┐            ┌─────────────────────────────────────┐
  │ Pedidos (traslado remisionado)│──(lee)────▶│ Por recibir → ENTRADA_TRASLADO       │
  │ Kardex / Existencias / Reportes│            │ Libro BodegaMovimientos (su saldo)   │
  │ Muestras / Cambios / Ingresos │◀─(solicita)│ Salidas con serie BOD-<COD>-RS       │
  └───────────────────────────────┘            │ Conteos / Ajustes / Kardex propio    │
                                                │ Traslados ⇄ otra satélite (misma emp.)│
                                                └─────────────────────────────────────┘
```

## 2. Contexto y punto de partida

Hoy las bodegas en consignación (`BodegasConsignacion`, 8 bodegas: Villeta, Didimo Cubillos, Boyacá, Espinal, COATOL, Antioquia ×2…) **no tienen inventario**. `bodegas-consignacion.html` es una vista de solo lectura sobre `Pedidos`; su «cant. ingresada» es la suma de `Cant_Entregada` de los traslados (`Consignacion='Sí'`, `Bodega_Consignacion_Id`). Nadie lleva saldo, ventas, ajustes ni conteos dentro de la bodega, y todos los usuarios actuales son del panel principal.

Un traslado ya es un `Pedidos` normal: al remisionarse sale del Kardex principal (`-1` en `_kx_movs`). Ese es el punto de entrega correcto: **desde ahí el stock es de la satélite**.

## 3. Alcance acordado

- **Operaciones:** recibir traslados · registrar salidas (con documento y serie propia, PDF) · ajustes y conteo físico · devolver a la principal · solicitar muestras y cambios a la principal · **traslados entre bodegas satélite**.
- **Solicitudes a la principal:** muestras, cambios y devoluciones son *solicitudes*; la principal las atiende con sus módulos actuales. La satélite nunca escribe en tablas de la principal.
- **Saldo inicial:** conteo físico inicial a una fecha de corte (los traslados históricos no cuentan).
- **Bodegas:** solo las del catálogo `BodegasConsignacion` (las detectadas por heurística —Carlos Ramírez, etc.— quedan fuera).
- **El inventario baja al registrar** la salida o la devolución a la principal (queda «en tránsito» hacia ella).
- **Solo producto terminado bueno:** en las satélites **no hay apartado** (ni columnas APARTADO / DISP. NETO, ni se leen `apartados_pedido`, `apartados_muestra` u OC vivas; la existencia es entradas − salidas) y **no hay bodega de No Conformes** (nada de `KardexNC`). Un cambio de producto no mueve el stock de la satélite: lo defectuoso lo maneja la principal.
- **Traslados entre bodegas satélite:** solo entre bodegas de la **misma empresa** (pasar mercancía a otra empresa cambia el dueño del inventario y sigue haciéndose por la principal con una OC de traslado). Van **en tránsito**: baja en el origen al registrar; el usuario del destino confirma lo realmente recibido y solo entonces suma. Las diferencias se marcan y se avisan a la principal.

## 4. Enfoque recomendado (3 pilares)

### 4.1 Identidad separada → aislamiento «por defecto negado»
Los usuarios de bodega son usuarios de Supabase Auth **sin fila en `public.usuarios`**. Verificado en la base viva: `get_user_role()` devuelve NULL para ellos, y las políticas RLS de lectura de las tablas de la principal dependen de un rol o de `user_has_company` (que con rol NULL es `false`). Resultado: **no pueden leer nada de la principal sin tocar ninguna política** (Pedidos, Ingresos, Kardex*, Clientes, ListaPrecios, apartados, etc.), y las tablas de movimientos tampoco les permiten escribir; los pocos puntos residuales los cubre el Paso 0 (sección 7, aplazado). Es el mismo patrón que `harden_select_true_policies.sql` preparó para el panel Chía Abago.

*Alternativa descartada:* un rol nuevo dentro de `usuarios`. Obligaría a auditar decenas de políticas y de RPC existentes, porque varias de ellas autorizan con solo «tener un rol» o «tener la empresa asignada».

### 4.2 Libro propio (tablas `Bodega*`) que ningún módulo de la principal lee
Todo el inventario satélite vive en tablas nuevas. `_kx_movs`, `get_saldos_holding`, `get_movs_holding_otras`, `kardex.js`, `existencias.js`, `dashboard.js`, `reportes.js` y `reabastecimiento.js` **no se modifican** y no las referencian. Se escribe **solo por RPC** (sin políticas INSERT/UPDATE/DELETE para clientes), igual que `tramitar_traslado_oc` y `tramitar_cambio`.

### 4.3 Flujo de una sola vía en cada sentido
- **Principal → satélite:** un RPC `SECURITY DEFINER` de solo lectura expone los traslados despachados (remisión, fecha, producto, presentación, cantidad; **sin cliente ni precios**). La satélite confirma lo recibido → `ENTRADA_TRASLADO`.
- **Satélite → principal:** solo *solicitudes* (muestra, cambio, devolución) y avisos en la campanita. El personal de la principal las atiende en Muestras / Cambios / Ingresos como hoy y anota la referencia en la solicitud.
- **Satélite ⇄ satélite (misma empresa):** circuito cerrado dentro de las tablas `Bodega*`; la principal solo recibe un aviso informativo si hay diferencia al recibir. No pasa por `Pedidos` ni `OrdenesCompra`.

## 5. Modelo de datos

Migraciones nuevas en `supabase/migrations/` (snake_case descriptivo, sin timestamp, cada una con su `_rollback.sql`; se aplican con `apply_migration` del MCP, el push a GitHub no aplica SQL).

| Tabla | Para qué |
|---|---|
| `BodegaUsuarios` (`usuario_id` → auth.users, nombre, email, activo, auditoría) | Identidad de los usuarios de bodega |
| `BodegaUsuarioBodegas` (`usuario_id`, `bodega_id` → `BodegasConsignacion`) | Qué bodegas ve/opera cada usuario (puede ser más de una) |
| `BodegaConfig` (`bodega_id` PK, `codigo` único p. ej. `VILLETA`, `fecha_corte`, `habilitada`) | Bodega habilitada para gestión + prefijo de serie + inicio del control. Tabla aparte: no altera `BodegasConsignacion` |
| `BodegaMovimientos` (`bodega_id`, `fecha`, `tipo`, `producto`, `presentacion`, `cantidad > 0`, `documento`, `origen_remision`, `cant_despachada`, `contraparte`, `solicitud_id`, `traslado_id`, `estado` Activo/Anulado + motivo, auditoría) | Libro único; el signo sale del tipo |
| `BodegaConteos` (solo producto bueno; cabecera por bodega/fecha/tipo INICIAL\|PERIODICO, líneas con físico/sistema/diferencia, estado Borrador\|Aplicado) | Conteo físico; al aplicar genera `SALDO_INICIAL` o ajustes (mismo patrón que `InventarioFisico` + `generarAjustesDesdeConteo`) |
| `BodegaTraslados` (consecutivo `BOD-<COD origen>-TR-0001`, `bodega_origen`, `bodega_destino`, `fecha`, `estado` En tránsito → Recibido \| Recibido con diferencia \| Cancelado, observaciones, quién/cuándo envía y recibe, motivo de cancelación) | Cabecera del traslado entre bodegas. Las líneas son las filas del libro con ese `traslado_id`. CHECK/trigger: origen ≠ destino y **misma `Nombre_Empresa`** |
| `BodegaConsecutivos` (`bodega_id`, `tipo`, `ultimo`) | Series propias, sin tocar `consecutivos_remisiones` ni `generar_remision` |
| `BodegaSolicitudes` (consecutivo `SOL-<COD>-n`, tipo MUESTRA\|CAMBIO\|DEVOLUCION, estado Pendiente → En proceso → Atendida\|Rechazada\|Cancelada, líneas jsonb, `ref_principal`, respuesta, quién/cuándo) | Bandeja bodega ⇄ principal |

**Tipos de movimiento** (CHECK, todos de producto terminado bueno):

| Suma (+) | Resta (−) |
|---|---|
| `SALDO_INICIAL` | `SALIDA_DESPACHO` |
| `ENTRADA_TRASLADO` (desde la principal) | `SALIDA_DEVOLUCION_PRINCIPAL` |
| `ENTRADA_TRASLADO_BODEGA` (desde otra satélite) | `SALIDA_TRASLADO_BODEGA` |
| `AJUSTE_SOBRANTE` | `AJUSTE_FALTANTE` |

- Lo que está en tránsito entre bodegas ya salió del origen y aún no entró al destino: no está en ninguna existencia (se muestra aparte, informativo).
- Sin columna de calidad ni de apartado: un solo saldo por (bodega, producto, presentación).
- Índice único parcial `(bodega_id, origen_remision, producto, presentacion)` para `ENTRADA_TRASLADO` activo → recibir dos veces es imposible.
- **Series propias:** `BOD-<COD>-RS-0001` (despacho), `BOD-<COD>-DV-0001` (devolución a la principal), `BOD-<COD>-TR-0001` (traslado entre bodegas, con el código de la bodega origen). El prefijo `BOD-` evita choque con `PARCELAR-RS-0222`.
- Productos normalizados con `_kx_norm_prod` (mismo criterio que la principal). Auditoría con `set_auditoria_row` + `fn_audit_log`.

## 6. RPC

Todas `SECURITY DEFINER`, con `SET search_path`, `REVOKE … FROM public, anon`, guardas de bodega asignada dentro del cuerpo y `pg_advisory_xact_lock` por bodega.

**Contexto y catálogo**
- `bodega_mi_contexto()` → bodegas del usuario (config, código, corte, pendiente de conteo inicial).
- `bodega_productos()` → nombres de `maestro_productos` (la satélite no puede leer esa tabla directamente).

**Desde la principal**
- `bodega_traslados_pendientes(bodega)` → remisiones de `Pedidos` con `Bodega_Consignacion_Id` = bodega, `Cant_Entregada>0`, no `Anulado`, no en `RemisionesAnuladas`, fecha **posterior** al corte y aún no recibidas. Solo remisión / fecha / producto / presentación / cantidad.
- `bodega_recibir_traslado(bodega, remision, lineas[], obs)` → `ENTRADA_TRASLADO` con lo realmente recibido; si difiere de lo despachado marca `cant_despachada` y avisa a la principal.

**Salidas y devoluciones**
- `bodega_registrar_salida(bodega, destinatario, lineas[], obs)` → valida contra la existencia (entradas − salidas; sin apartados; no permite negativo), genera consecutivo y `SALIDA_DESPACHO`; devuelve los datos para el PDF.
- `bodega_registrar_devolucion(bodega, lineas[], obs)` → `SALIDA_DEVOLUCION_PRINCIPAL` + `BodegaSolicitudes` tipo DEVOLUCION «en tránsito», en una transacción.

**Traslados entre bodegas**
- `bodega_crear_traslado_bodega(origen, destino, lineas[], obs)` → exige usuario asignado al **origen**, ambas bodegas habilitadas y de la **misma empresa**, y existencia suficiente en origen (lock sobre ambas bodegas en orden de id para evitar interbloqueos); genera `BOD-<COD>-TR-n`, crea la cabecera `En tránsito` y las `SALIDA_TRASLADO_BODEGA`; devuelve datos para el PDF.
- `bodega_recibir_traslado_bodega(traslado_id, lineas[], obs)` → solo usuarios asignados al **destino**; solo si sigue `En tránsito`; crea `ENTRADA_TRASLADO_BODEGA` con lo recibido (≤ lo enviado) y pasa a `Recibido` o `Recibido con diferencia` (avisa a la principal, sin reversar nada automáticamente).
- `bodega_cancelar_traslado_bodega(traslado_id, motivo)` → solo el origen y solo `En tránsito`: anula las salidas y devuelve el stock al origen.
- `bodega_traslados_bodega(bodega)` → enviados y por recibir de la bodega.

**Solicitudes, conteos y consulta**
- `bodega_crear_solicitud(bodega, tipo, …)` (muestra / cambio) → solo deja la solicitud para la principal, **sin mover el stock de la satélite**. Si el reemplazo sale de la bodega se registra aparte como `SALIDA_DESPACHO` enlazada a la solicitud (`solicitud_id`); si lo envía la principal, llega como traslado normal.
- `bodega_guardar_conteo` / `bodega_aplicar_conteo` → INICIAL genera `SALDO_INICIAL`; PERIODICO genera ajustes.
- `bodega_anular_movimiento(id, motivo)` → nada se borra; `ENTRADA_TRASLADO` y los movimientos con `traslado_id` no se anulan (se corrigen con ajuste o, en tránsito, con «Cancelar traslado»).
- `bodega_existencias(bodega)` y `bodega_kardex(bodega, producto, desde, hasta)` → saldos y movimientos.

**Lado principal** (roles admin / editor / contabilidad / gerente_iaso / lector con módulo `bodegas_consignacion` y empresa de la bodega)
- Lectura de existencias y movimientos de las bodegas, y `bodega_solicitud_atender(id, estado, ref_principal, respuesta)`; esta última escribe **solo en `BodegaSolicitudes`**.

**Avisos a la principal** (patrón `fn_oc_avisar_contabilidad`): solicitud nueva, devolución en tránsito y recepción con diferencia (de la principal o entre bodegas) → fila en `notificaciones`. Requiere ampliar `notificaciones_modulo_check` con `'bodegas'` y enrutar en `NOTIF.destino` (`js/notificaciones.js`).

## 7. Endurecimiento previo (Paso 0, migración propia con rollback) — aplazado

Migración opcional y aislada que cerraría los pocos puntos de la base que una cuenta con sesión pero sin rol todavía podría usar (guardas de rol en algunas funciones auxiliares y un ajuste en `user_has_company`). **No se aplicó** en el piloto: el aislamiento de lectura de la principal ya funciona sin ella, y antes de aplicarla hay que comprobar que no rompe al otro panel que comparte la base (Chía Abago). El detalle exacto de qué funciones y políticas incluye se mantiene fuera de este repositorio público.

## 8. Frontend

**Nuevos** (mini-app para usuarios de bodega; no cargan `auth.js` ni la barra de la principal):
- `bodega-login.html` y `bodega-recuperar.html` — login y recuperación de contraseña propios (no se tocan `login.html` ni `recuperar.html`).
- `bodega-satelite.html` + `js/bodega-satelite.js` + `js/bodega-auth.js` — guardia de sesión con `bodega_mi_contexto()`; sin fila en `BodegaUsuarios` → cierra sesión. Reutiliza `js/shared.js` (cliente `_sb`, `escHtml`, `showToast`, `fmtDate`, `today`), `css/panel.css` y `js/pdf-remision.js` (`generarRemisionPDF`, `_nuevoPdfDoc`, `_pdfRemisionHeaderInfoFor`) **sin modificarlos** (si el PDF necesita un campo extra, un wrapper en el JS nuevo).
- **Pestañas:**
  - **Existencias** — solo Producto · Presentación · Existencia (sin apartado), con un renglón informativo «en tránsito».
  - **Por recibir** — dos bloques: «De la principal» y «De otras bodegas», con botón Recibir y captura de lo realmente recibido.
  - **Traslados entre bodegas** — nuevo traslado a otra bodega de la misma empresa, enviados, cancelar en tránsito, PDF.
  - **Salidas** — nueva + historial + PDF.
  - **Conteos y ajustes**.
  - **Solicitudes** a la principal.
  - **Movimientos / Kardex** (+ Excel).
  - Selector de bodega si el usuario tiene varias. Las salidas quedan bloqueadas hasta que exista el conteo inicial.

**Cambios en archivos existentes (lista cerrada):**
- `bodegas-consignacion.html` + `js/bodegas-consignacion.js`: pestañas **nuevas** (las 3 actuales no cambian): *Existencias por bodega* (solo lectura), *Solicitudes de bodegas* (atender) y *Gestión de bodegas* (habilitar bodega con código y fecha de corte; crear/activar usuarios de bodega y asignarles bodegas). Para crear el usuario se usa la Edge Function `create-user` ya existente (solo crea el usuario de Auth y es exclusiva del administrador) y luego se insertan `BodegaUsuarios` / `BodegaUsuarioBodegas`; así no aparecen en `usuarios.html`.
- `js/notificaciones.js`: ruta del nuevo módulo de avisos. `js/backup.js`: añadir las tablas `Bodega*` a `BACKUP_TABLES`. Subir los `?v=` de lo tocado.
- **No se tocan:** `pedidos.*` (Nuevo Traslado sigue igual), `kardex`, `existencias`, `dashboard`, `reportes`, `reabastecimiento`, `shared`, `auth`, `usuarios`, `_kx_movs`, `generar_remision`, `consecutivos_remisiones`.

## 9. Fases de entrega

| Fase | Contenido |
|---|---|
| **0 · Fundaciones** | Endurecimiento (Paso 0, aplazado) + tablas de identidad / config / libro + RPC base + `bodega-login` / `bodega-auth`. Sin impacto visible |
| **1 · Núcleo** | Conteo inicial, recibir traslados de la principal, existencias, salidas con serie propia y PDF, ajustes y conteos periódicos, anulación, Kardex y Excel. Piloto con **Villeta** (22 líneas, la de más movimiento) |
| **1b · Traslados entre bodegas** | Envío en tránsito, recepción con diferencias, cancelación y PDF `BOD-<COD>-TR-n`. Se prueba con dos bodegas de PARCELAR (Villeta ↔ Didimo Cubillos / Boyacá) o dos de IASO (Espinal ↔ COATOL); requiere al menos dos bodegas habilitadas |
| **2 · Solicitudes** | Muestra, cambio y devolución hacia la principal + bandeja y avisos en la principal |
| **3 · Supervisión** | Existencias por bodega en la principal, gestión de usuarios y bodegas, y despliegue al resto de bodegas |

Orden de despliegue en cada fase: migración → publicar código. Al terminar, documentar el módulo en `CLAUDE.md` (sección propia, como las demás).

## 10. Verificación de punta a punta

1. **Aislamiento en SQL** (transacciones revertidas contra producción, usuarios simulados con `request.jwt.claims`): un usuario de bodega recibe 0 filas / permiso denegado en Pedidos, Ingresos, KardexNC, KardexAjustes, InventarioFisico, OrdenesCompra, Reenvases, Devoluciones, CambiosMercancia, SolicitudMuestras, Clientes, ClientesUnicos, ListaPrecios, apartados_*, Consecutivos y parametros_inventario; no puede ejecutar `generar_remision`, `get_saldos_holding` ni `get_movs_holding_otras`; no ve otra bodega ni las desasignadas; no puede escribir directo en `Bodega*`.
2. **Invariancia de la principal:** hash/conteo de `_kx_movs()` y `get_saldos_holding()` y conteo de filas de las tablas principales **antes y después** de un guion completo de la satélite (conteo inicial → recibir → salida → devolución → ajuste → solicitud → anulación). Deben ser idénticos.
3. **Estático:** `grep` de `Bodega(Movimientos|Conteos|Solicitudes|Config|Usuario)` en `kardex.js`, `existencias.js`, `dashboard.js`, `reportes.js`, `reabastecimiento.js`, `shared.js`, `auth.js` y en las migraciones de `_kx_movs`: cero coincidencias. Y el inverso: el código y las RPC nuevas **no** referencian `apartados_*`, `KardexNC`, `computeApartadoPorEmpresa` ni `esSolicitudCompraViva`.
4. **Traslados entre bodegas:** entre empresas distintas rechazado (RPC y trigger); origen = destino rechazado; solo el usuario del origen envía y solo el del destino recibe (uno asignado a ambas puede ambas); sin existencia suficiente rechazado; en tránsito no suma en ninguna existencia; recibir dos veces rechazado; recibir más de lo enviado rechazado; recepción con diferencia marcada y con aviso; cancelar en tránsito devuelve el stock al origen y no se puede cancelar tras recibir; dos traslados cruzados A→B y B→A simultáneos sin interbloqueo ni consecutivos repetidos; la suma origen + destino + tránsito se conserva.
5. **Negocio:** recibir dos veces el mismo traslado de la principal rechazado; recepción con diferencia; salida mayor al saldo rechazada; dos salidas simultáneas (lock) sin repetir consecutivo; remisión anulada en la principal después de recibida → alerta, sin reversa automática; corte (traslados ≤ fecha de corte no se ofrecen).
6. **Navegador:** arnés con Supabase simulado sobre `bodega-satelite.html` y `bodegas-consignacion.html` reales (pestañas nuevas + las 3 existentes sin regresión), PDF, Excel y móvil. Con usuarios reales de producción **no** se probará hasta el piloto (dejarlo dicho en el `CLAUDE.md`).
7. Migraciones idempotentes y cada `_rollback.sql` probado en una transacción revertida.

## 11. Impacto sobre los usuarios actuales de la aplicación

**Resumen:** los usuarios de hoy no ven ni sienten cambios en sus pantallas, cifras, permisos ni contraseñas. Los únicos efectos son (a) una cola de trabajo nueva para quien atienda solicitudes de bodegas y (b) un cambio mínimo en un script compartido. Lo único que toca código existente en producción es opcional y se aísla en su propia migración.

| Área | Efecto en los usuarios actuales |
|---|---|
| Pantallas y menús | **Ninguno.** Pedidos, Ingresos, Kardex, Existencias, Dashboard, Reportes, Reabastecimiento, Usuarios, etc. no se modifican. «Nuevo Traslado» funciona igual |
| Cifras y reportes | **Ninguno.** `_kx_movs`, `get_saldos_holding`, Kardex, Dashboard y Reportes siguen leyendo exactamente las mismas tablas; el stock de la principal ya baja al remisionar el traslado, como hoy |
| Permisos y contraseñas | **Ninguno.** No se crean roles ni módulos nuevos en `usuarios` / `usuario_modulos`. Los usuarios de bodega no aparecen en `usuarios.html` |
| Módulo «Bodegas en Consignación» | Hoy **solo el administrador** lo usa (0 usuarios con el módulo asignado). Se añaden 3 pestañas nuevas; las 3 actuales no cambian. Quien tenga el módulo en el futuro verá las pestañas nuevas |
| Campanita de notificaciones | Aparecen avisos **nuevos** (solicitud de una bodega, devolución en tránsito, recepción con diferencia) para quienes los deban atender (sugerido: contabilidad de la empresa de la bodega —4 usuarios hoy— y administradores). Requiere ampliar un CHECK de `notificaciones` (solo agrega un valor) y un cambio mínimo en `js/notificaciones.js`, que carga **en 24 páginas**: se hace con una sola línea de enrutamiento, se sube el `?v=` y se prueba en las páginas principales |
| Trabajo nuevo para la principal | Atender la bandeja de solicitudes (muestras / cambios / devoluciones) con sus módulos actuales; registrar el Ingreso manual cuando llegue una devolución; si anulan en Pedidos una remisión de traslado ya recibida por la bodega, la bodega recibe una alerta (no hay reversa automática) y conviene avisar |
| Administración | El administrador habilita cada bodega (código y fecha de corte) y crea sus usuarios desde la pestaña nueva; la bodega debe hacer su conteo inicial antes de operar |
| Datos / rendimiento | Tablas nuevas pequeñas; **sin triggers nuevos sobre tablas existentes** (Pedidos, Ingresos, etc.), así que no se alteran guardados ni consultas actuales |
| Despliegue | Migraciones solo aditivas (tablas y funciones nuevas), excepto el Paso 0. Se aplican **antes** de publicar el código y cada una tiene rollback |

**Cambio opcional sobre objetos existentes en la base: el Paso 0 (endurecimiento, sección 7).** Todos los usuarios activos tienen rol, así que su comportamiento no cambiaría; el riesgo es de ejecución (reescribir funciones sobre su cuerpo vigente), no de negocio, y se mitiga con migración propia, rollback y comparación de resultados antes/después. Es **opcional**: sin él, el aislamiento de datos de la principal se mantiene porque las políticas ya niegan por defecto.

**Recuperación de contraseña de usuarios de bodega:** `recuperar.html` redirige a `login.html`, donde un usuario de bodega quedaría fuera. Se resuelve con `bodega-recuperar.html` propio. Como construido, además, `login.html` envía a la app de bodegas a quien es solo usuario de bodega.

## 12. Supuestos a validar

- **Corte:** un traslado cuenta si su remisión es posterior a `fecha_corte` (los anteriores se asumen dentro del conteo físico).
- **Muestras:** en la primera versión las despacha la principal desde su stock (el stock de la satélite no cambia). Si deben salir del stock de la bodega, se añade `SALIDA_MUESTRA` en la fase 2.
- **Cambios:** son solo una solicitud a la principal (motivo y productos); el producto defectuoso que entrega el cliente **no entra al saldo** de la satélite. Si un cliente devuelve producto *bueno* para reponerlo en la bodega, se registra como `AJUSTE_SOBRANTE` con motivo.
- Saldo negativo bloqueado; solo se anula con motivo y queda auditado.
- «Bodega ANTIOQUIA» existe dos veces en el catálogo (GREEN id 9 e IAS id 8): se tratan como bodegas separadas, cada una con su saldo; por ser de empresas distintas **no se pueden trasladar entre sí** (debe ir por la principal).
- **Diferencias en traslados entre bodegas:** un faltante al recibir queda marcado y avisado, pero el sistema no lo reparte entre origen y destino: lo corrige quien corresponda con un ajuste tras investigar. Un traslado en tránsito no vence solo; la principal puede ver los que llevan más de N días sin recibir (N sugerido: 7).
- Solo se ofrecen traslados con `Bodega_Consignacion_Id` (flujo «Nuevo Traslado»). Hallazgo preexistente a verificar: `rebuildConsecs` (`pedidos.js` ~1243) no copia `Bodega_Consignacion_Id` al reabrir un traslado, aunque `editar_pedido_completo` lo conserva por `COALESCE`.

**Fuera de alcance:** apartados y bodega No Conforme en las satélites; traslados entre bodegas de empresas distintas; cierre de mes de la satélite; avisos por correo; conciliar contra ventas de la principal; y el hecho (preexistente) de que Reabastecimiento / cobertura cuentan los traslados a consignación como consumo.

## 13. Archivos críticos

- **Nuevos:** `supabase/migrations/bodega_*.sql` (+ `_rollback`), `bodega-login.html`, `bodega-recuperar.html`, `bodega-satelite.html`, `js/bodega-satelite.js`, `js/bodega-auth.js`.
- **Modificados:** `bodegas-consignacion.html`, `js/bodegas-consignacion.js`, `js/notificaciones.js`, `js/backup.js`, `CLAUDE.md`.
- **Referencia / reuso:** `js/pdf-remision.js`, `js/shared.js`, `supabase/functions/create-user/index.ts`, `supabase/migrations/tramitar_traslado_oc.sql` y `add_tramite_parcial_cambios.sql` (patrón RPC), `avisar_contabilidad_oc.sql` (patrón de avisos), `harden_select_true_policies.sql`.
