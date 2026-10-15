// solicitud-mercadeo
//
// Solicitudes a Mercadeo con APROBACIÓN PREVIA. Lado "Pedidos" del puente hacia el Tablero
// de Mercadeo de panel-pqrs (otro proyecto Supabase). El navegador llama a ESTA función con
// la sesión del usuario; aquí se verifica quién es, su permiso y sus empresas.
//
// Flujo (misma lógica que las solicitudes de muestras):
//   crear/reenviar -> la solicitud queda guardada aquí en 'Por aprobar' (tabla solicitudes_mercadeo)
//                     y se avisa a los aprobadores. Si quien envía ya es aprobador, se aprueba sola.
//   aprobar        -> SOLO entonces se crea en el Tablero de panel-pqrs (estado "Recibido") con la
//                     función `solicitud-mercadeo-pedidos` y un secreto compartido (server -> server).
//   rechazar       -> motivo obligatorio; el solicitante puede editarla y reenviarla.
// Mercadeo también puede rechazar en su Tablero una solicitud ya aprobada: eso entra por la función
// `solicitud-mercadeo-aviso` (otra función, la llama pqrs), la deja 'Rechazada' con
// rechazada_por_mercadeo = true y aquí se corrige y se reenvía igual que un rechazo de aprobador.
// El navegador nunca habla con la función de pqrs ni con la tabla: todo pasa por aquí.
//
// Acciones (campo `action`):
//   contexto     -> empresas del usuario, usuarios activos del panel y si puede aprobar
//   preparar     -> URLs firmadas para subir adjuntos directo al Storage de pqrs
//   crear        -> envía una solicitud nueva
//   reenviar     -> corrige y reenvía una solicitud RECHAZADA propia
//   listar       -> "Mis solicitudes" (las que hizo el usuario o hechas a su nombre)
//   pendientes   -> (aprobadores) solicitudes 'Por aprobar'
//   aprobar      -> (aprobadores) aprueba y la manda al Tablero
//   rechazar     -> (aprobadores) rechaza con motivo
//   archivo_url  -> URL temporal para abrir un adjunto (aprobador, solicitante o a_nombre_de)
//
// Secretos de ESTE proyecto (supabase secrets set ...):
//   PQRS_BRIDGE_URL    = https://kvfqcymeihglohkcckdp.supabase.co/functions/v1/solicitud-mercadeo-pedidos
//   PQRS_BRIDGE_SECRET = <el mismo valor que PEDIDOS_BRIDGE_SECRET en pqrs>
//
// Permisos: enviar = rol admin o módulo `solicitudes_mercadeo`; aprobar = rol admin o módulo
// `solicitudes_mercadeo_aprobar` (usuario_modulos). Desplegar con verify_jwt = true.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://logisticatecbihol.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODULO = 'solicitudes_mercadeo'
const MODULO_APROBAR = 'solicitudes_mercadeo_aprobar'
const TABLA = 'solicitudes_mercadeo'
const EMPRESAS_HOLDING = ['PARCELAR', 'GREEN', 'RESO', 'IASO', 'IAS']
const ASUNTOS = [
  'material_pop', 'material_impreso', 'piezas_graficas', 'piezas_audiovisuales',
  'diseno_nuevo_producto', 'diseno_ajuste_portafolios', 'diseno_ajuste_institucional',
  'desarrollo_marca', 'otros',
]
const ASUNTO_ETIQUETA: Record<string, string> = {
  material_pop: 'Material POP', material_impreso: 'Material impreso', piezas_graficas: 'Piezas gráficas',
  piezas_audiovisuales: 'Piezas audiovisuales', diseno_nuevo_producto: 'Diseño de nuevo producto',
  diseno_ajuste_portafolios: 'Diseño y ajuste de portafolios',
  diseno_ajuste_institucional: 'Diseño y ajuste de material institucional',
  desarrollo_marca: 'Desarrollo de marca', otros: 'Otros',
}
const MAX_ARCHIVOS = 5
const MAX_PENDIENTES_POR_USUARIO = 30
const MAX_ENVIOS_POR_HORA = 10
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

class Rechazo extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

function uuid(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new Rechazo(`${campo} inválido`)
  return v.toLowerCase()
}

const refSM = (n: number | string) => `SM-${n}`

// Llama a la función de pqrs. Los 4xx de validación se reenvían con su mensaje;
// un 401 (secreto mal configurado) o un fallo de red se traducen a mensajes neutros.
async function puente(payload: Record<string, unknown>) {
  const url = Deno.env.get('PQRS_BRIDGE_URL')
  const secret = Deno.env.get('PQRS_BRIDGE_SECRET')
  if (!url || !secret) throw new Rechazo('El envío a Mercadeo todavía no está configurado', 503)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': secret },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    let j: any = null
    try { j = await res.json() } catch (_e) { /* cuerpo no JSON */ }
    if (res.ok && j && j.ok) return j
    if (res.status === 401) {
      console.error('solicitud-mercadeo: el puente de pqrs rechazó el secreto (401)')
      throw new Rechazo('No se pudo comunicar con Mercadeo (configuración del puente)', 502)
    }
    const status = res.status >= 400 && res.status < 500 ? res.status : 502
    throw new Rechazo((j && j.error) || 'Mercadeo no pudo procesar la solicitud', status)
  } catch (e) {
    if (e instanceof Rechazo) throw e
    if ((e as Error)?.name === 'AbortError') throw new Rechazo('Mercadeo no respondió a tiempo; intenta de nuevo', 504)
    console.error('solicitud-mercadeo: fallo de red hacia pqrs:', (e as Error)?.message)
    throw new Rechazo('No se pudo comunicar con Mercadeo; intenta de nuevo', 502)
  } finally {
    clearTimeout(timer)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Método no permitido' })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Rechazo('No autenticado', 401)

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Rechazo('No autenticado', 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Perfil activo
    const p = await admin.from('usuarios').select('id, nombre, email, rol').eq('id', user.id).eq('activo', true).maybeSingle()
    if (p.error) throw p.error
    if (!p.data) throw new Rechazo('Tu usuario no está activo', 403)
    const perfil = p.data
    const nombreUsuario = (perfil.nombre || '').trim() || perfil.email

    // Permisos (admin siempre)
    const mods = await admin.from('usuario_modulos').select('modulo').eq('usuario_id', user.id).in('modulo', [MODULO, MODULO_APROBAR])
    if (mods.error) throw mods.error
    const tiene = (m: string) => (mods.data || []).some((r: any) => r.modulo === m)
    const esAdmin = perfil.rol === 'admin'
    const puedeEnviar = esAdmin || tiene(MODULO)
    const puedeAprobar = esAdmin || tiene(MODULO_APROBAR)
    if (!puedeEnviar && !puedeAprobar) throw new Rechazo('No tienes permiso para solicitudes a Mercadeo', 403)

    // Empresas del usuario (admin y cartera ven todas, como en auth.js)
    let empresas: string[]
    if (esAdmin || perfil.rol === 'cartera') {
      empresas = [...EMPRESAS_HOLDING]
    } else {
      const e = await admin.from('usuario_empresas').select('empresa_sigla').eq('usuario_id', user.id)
      if (e.error) throw e.error
      empresas = (e.data || []).map((r: any) => r.empresa_sigla).filter((s: string) => EMPRESAS_HOLDING.includes(s))
    }

    const body = await req.json()

    // ── Utilidades que usan el contexto de la petición ──
    // Usuarios activos del panel (para "Solicitante"/"a nombre de"), incluido el propio usuario.
    // Solo se expone nombre y rol (no el correo).
    async function usuariosPanel() {
      const c = await admin.from('usuarios').select('id, nombre, email, rol').eq('activo', true).order('nombre')
      if (c.error) throw c.error
      return (c.data || []).map((x: any) => ({ id: x.id, nombre: (x.nombre || '').trim() || x.email, rol: x.rol }))
    }

    function exigirEnviar() {
      if (!puedeEnviar) throw new Rechazo('No tienes permiso para enviar solicitudes a Mercadeo', 403)
    }
    function exigirAprobador() {
      if (!puedeAprobar) throw new Rechazo('No tienes permiso para aprobar solicitudes a Mercadeo', 403)
    }

    // Ids de quienes pueden aprobar (admin activos + módulo de aprobación activos).
    async function aprobadoresIds(): Promise<string[]> {
      const [a, m] = await Promise.all([
        admin.from('usuarios').select('id').eq('activo', true).eq('rol', 'admin'),
        admin.from('usuario_modulos').select('usuario_id').eq('modulo', MODULO_APROBAR),
      ])
      if (a.error) throw a.error
      if (m.error) throw m.error
      const ids = new Set<string>((a.data || []).map((x: any) => x.id))
      const conModulo = (m.data || []).map((x: any) => x.usuario_id)
      if (conModulo.length) {
        const act = await admin.from('usuarios').select('id').eq('activo', true).in('id', conModulo)
        if (act.error) throw act.error
        for (const x of act.data || []) ids.add(x.id)
      }
      return [...ids]
    }

    // Aviso in-app (campanita). Nunca debe hacer fallar la operación principal.
    async function avisar(paraIds: string[], titulo: string, mensaje: string, referencia: string) {
      try {
        const rows = [...new Set(paraIds)].filter((id) => id && id !== user.id).map((id) => ({
          para_usuario_id: id,
          de_usuario_id: user.id,
          modulo: 'solicitudes_mercadeo',
          referencia,
          titulo,
          mensaje,
          storage_path: null,
        }))
        if (!rows.length) return
        const r = await admin.from('notificaciones').insert(rows)
        if (r.error) console.error('solicitud-mercadeo: no se pudo avisar:', r.error.message)
      } catch (e) {
        console.error('solicitud-mercadeo: no se pudo avisar:', (e as Error)?.message)
      }
    }

    function textoAsunto(r: any): string {
      const base = ASUNTO_ETIQUETA[r.asunto] || r.asunto
      return r.asunto === 'otros' && r.asunto_otro ? `${base}: ${r.asunto_otro}` : base
    }

    async function avisarAprobadores(r: any) {
      const ids = await aprobadoresIds()
      const para = r.a_nombre_de_nombre ? ` (a nombre de ${r.a_nombre_de_nombre})` : ''
      await avisar(
        ids,
        `📣 Solicitud a Mercadeo por aprobar: ${refSM(r.numero)}`,
        `${r.creado_por_nombre}${para} pide: ${textoAsunto(r)} · ${r.empresa}.`,
        refSM(r.numero),
      )
    }

    async function avisarDecision(r: any, aprobada: boolean) {
      const destinatarios = [r.creado_por, r.a_nombre_de_id].filter(Boolean)
      await avisar(
        destinatarios,
        aprobada
          ? `✅ Solicitud a Mercadeo aprobada: ${refSM(r.numero)}`
          : `❌ Solicitud a Mercadeo rechazada: ${refSM(r.numero)}`,
        aprobada
          ? 'Tu solicitud fue aprobada y ya está con el equipo de Mercadeo.'
          : `Motivo: ${r.motivo_rechazo || 'sin motivo'}. Puedes editarla y reenviarla.`,
        refSM(r.numero),
      )
    }

    // Valida y normaliza lo que dice el formulario (para crear y reenviar).
    async function validarFormulario(requestId: string) {
      if (!empresas.includes(body.empresa)) throw new Rechazo('La empresa elegida no está entre las tuyas')
      if (!ASUNTOS.includes(body.asunto)) throw new Rechazo('Elige un asunto de la lista')

      // Con asunto "Otros" el solicitante escribe el asunto (obligatorio); con cualquier otro no aplica.
      let asuntoOtro: string | null = null
      if (body.asunto === 'otros') {
        asuntoOtro = typeof body.asunto_otro === 'string' ? body.asunto_otro.trim().replace(/\s+/g, ' ') : ''
        if (asuntoOtro.length < 3) throw new Rechazo('Escribe el asunto (mínimo 3 caracteres)')
        if (asuntoOtro.length > 100) throw new Rechazo('El asunto no puede superar 100 caracteres')
      }

      const fecha = body.fecha_tentativa
      if (typeof fecha !== 'string' || !FECHA_RE.test(fecha) || Number.isNaN(Date.parse(fecha + 'T00:00:00Z'))) {
        throw new Rechazo('La fecha tentativa no es válida')
      }
      if (fecha < hoyBogota()) throw new Rechazo('La fecha tentativa no puede ser anterior a hoy')

      const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : ''
      if (descripcion.length < 10) throw new Rechazo('La descripción debe tener al menos 10 caracteres')
      if (descripcion.length > 2000) throw new Rechazo('La descripción no puede superar 2000 caracteres')

      // "A nombre de": cualquier usuario activo del panel (el nombre sale de la BD, no del navegador).
      let aNombre: { id: string; nombre: string } | null = null
      if (body.a_nombre_de_id) {
        const id = uuid(body.a_nombre_de_id, 'a_nombre_de_id')
        if (id !== user.id) {
          const u = (await usuariosPanel()).find((x: any) => x.id === id)
          if (!u) throw new Rechazo('El solicitante elegido no está disponible')
          aNombre = { id: u.id, nombre: u.nombre }
        }
      }

      // Archivos: ya subidos bajo solicitudes/<request_id>/ ; se confirma que existen.
      const declarados = Array.isArray(body.archivos) ? body.archivos : []
      if (declarados.length > MAX_ARCHIVOS) throw new Rechazo(`Máximo ${MAX_ARCHIVOS} archivos por solicitud`)
      const carpeta = `solicitudes/${requestId}/`
      const archivos = declarados.map((a: any) => {
        if (!a || typeof a.path !== 'string' || !a.path.startsWith(carpeta) || a.path.includes('..')) {
          throw new Rechazo('Ruta de archivo inválida')
        }
        const nombre = typeof a.nombre === 'string' ? a.nombre.trim().slice(0, 200) : ''
        if (!nombre) throw new Rechazo('Archivo sin nombre')
        const tamano = Number(a.tamano)
        return {
          path: a.path,
          nombre,
          tamano: Number.isFinite(tamano) && tamano > 0 ? Math.round(tamano) : 0,
          tipo: typeof a.tipo === 'string' ? a.tipo.slice(0, 120) : null,
        }
      })
      if (archivos.length) {
        const f = await puente({ action: 'firmar', request_id: requestId, paths: archivos.map((a: any) => a.path) })
        const faltan = (f.archivos || []).filter((x: any) => !x.existe)
        if (faltan.length) throw new Rechazo('Un archivo no llegó completo; vuelve a intentarlo')
      }

      return { empresa: body.empresa, asunto: body.asunto, asuntoOtro, fecha, descripcion, aNombre, archivos }
    }

    // Manda una solicitud YA aprobada al Tablero de Mercadeo (idempotente por origen_ref = id).
    async function enviarAMercadeo(r: any, aprobadorNombre: string) {
      const c = await admin.from('usuarios').select('email, rol').eq('id', r.creado_por).maybeSingle()
      if (c.error) throw c.error
      return await puente({
        action: 'crear',
        aprobacion: true,
        numero_origen: r.numero,
        aprobada_por: aprobadorNombre,
        request_id: r.id,
        solicitante: { id: r.creado_por, nombre: r.creado_por_nombre, email: c.data?.email ?? null, rol: c.data?.rol ?? null },
        a_nombre_de: r.a_nombre_de_id ? { id: r.a_nombre_de_id, nombre: r.a_nombre_de_nombre } : null,
        empresa: r.empresa,
        asunto: r.asunto,
        asunto_otro: r.asunto_otro,
        fecha_tentativa: r.fecha_tentativa,
        descripcion: r.descripcion,
        archivos: r.archivos,
      })
    }

    // Marca la solicitud como aprobada (solo si sigue 'Por aprobar'). Devuelve la fila resultante.
    async function marcarAprobada(r: any, tareaId: number, auto: boolean) {
      const ahora = new Date().toISOString()
      const historial = [...(r.historial || []), { tipo: auto ? 'autoaprobacion' : 'aprobacion', por: nombreUsuario, en: ahora }]
      const u = await admin.from(TABLA).update({
        estado_aprobacion: 'Aprobada',
        aprobada_por: user.id,
        aprobada_por_nombre: nombreUsuario,
        fecha_aprobacion: ahora,
        auto_aprobada: auto,
        pqrs_tarea_id: tareaId,
        modificado_en: ahora,
        historial,
      }).eq('id', r.id).eq('estado_aprobacion', 'Por aprobar').select('*').maybeSingle()
      if (u.error) throw u.error
      return u.data // null si otro la resolvió antes
    }

    async function filaPorId(id: string) {
      const f = await admin.from(TABLA).select('*').eq('id', id).maybeSingle()
      if (f.error) throw f.error
      return f.data
    }

    // Forma que ve el navegador. `pq` = datos de la tarea en el Tablero (si ya fue aprobada).
    function mapFila(r: any, pq: any | null) {
      const hist = (r.historial || []).map((h: any) => ({ tipo: h.tipo, por: h.por, en: h.en, motivo: h.motivo ?? null }))
      if (pq) {
        for (const h of pq.historial || []) {
          hist.push(h.tipo === 'estado'
            ? { tipo: 'estado', estado: h.estado, en: h.en }
            : { tipo: 'respuesta', texto: h.texto, por: h.por, en: h.en })
        }
      }
      hist.sort((a: any, b: any) => String(a.en).localeCompare(String(b.en)))
      return {
        id: r.id,
        numero: r.numero,
        estado_aprobacion: r.estado_aprobacion,
        motivo_rechazo: r.motivo_rechazo,
        rechazada_por_mercadeo: !!r.rechazada_por_mercadeo,
        aprobada_por: r.aprobada_por_nombre,
        fecha_aprobacion: r.fecha_aprobacion,
        auto_aprobada: r.auto_aprobada,
        puede_editar: r.estado_aprobacion === 'Rechazada' && r.creado_por === user.id,
        asunto: r.asunto,
        asunto_otro: r.asunto_otro,
        empresas: [r.empresa],
        descripcion: r.descripcion,
        fecha_tentativa: r.fecha_tentativa,
        solicitante: r.creado_por_nombre,
        solicitante_id: r.creado_por,
        a_nombre_de: r.a_nombre_de_nombre,
        a_nombre_de_id: r.a_nombre_de_id,
        creada_en: r.creado_en,
        archivos: (r.archivos || []).map((a: any) => ({ path: a.path, nombre: a.nombre, tamano: a.tamano, tipo: a.tipo })),
        // Datos del Tablero (solo si ya fue aprobada y creada allá)
        estado: pq ? pq.estado : null,
        fecha_comprometida: pq ? pq.fecha_comprometida : null,
        confirmada_en: pq ? pq.confirmada_en : null,
        entregada_en: pq ? pq.entregada_en : null,
        responsables: pq ? pq.responsables : [],
        historial: hist,
      }
    }

    // Registra (o reenvía) una solicitud y, si quien envía ya es aprobador, la aprueba sola.
    async function resolverEnvio(fila: any, esReenvio: boolean) {
      let actual = fila
      let aviso: string | null = null
      if (puedeAprobar) {
        try {
          const t = await enviarAMercadeo(actual, nombreUsuario)
          const m = await marcarAprobada(actual, t.id, true)
          if (m) actual = m
          else actual = (await filaPorId(actual.id)) || actual
        } catch (e) {
          // No se pudo mandar a Mercadeo: queda por aprobar y se avisa a los aprobadores.
          aviso = e instanceof Rechazo ? e.message : 'No se pudo enviar a Mercadeo'
          console.error('solicitud-mercadeo: autoaprobación fallida:', (e as Error)?.message)
        }
      }
      if (actual.estado_aprobacion === 'Por aprobar') await avisarAprobadores(actual)
      return { actual, aviso }
    }

    switch (body?.action) {
      case 'contexto': {
        const usuarios = await usuariosPanel()
        let pendientes: number | null = null
        if (puedeAprobar) {
          const c = await admin.from(TABLA).select('id', { count: 'exact', head: true }).eq('estado_aprobacion', 'Por aprobar')
          if (c.error) throw c.error
          pendientes = c.count ?? 0
        }
        return json(200, {
          ok: true,
          yo: { id: user.id, nombre: nombreUsuario, rol: perfil.rol },
          empresas,
          usuarios,
          puede_enviar: puedeEnviar,
          puede_aprobar: puedeAprobar,
          pendientes,
        })
      }

      case 'preparar': {
        exigirEnviar()
        const requestId = uuid(body.request_id, 'request_id')
        const archivos = Array.isArray(body.archivos) ? body.archivos : []
        if (archivos.length < 1) throw new Rechazo('No hay archivos para preparar')
        if (archivos.length > MAX_ARCHIVOS) throw new Rechazo(`Máximo ${MAX_ARCHIVOS} archivos por solicitud`)
        const r = await puente({
          action: 'preparar',
          request_id: requestId,
          archivos: archivos.map((a: any) => ({ nombre: a?.nombre, tamano: a?.tamano, tipo: a?.tipo })),
        })
        return json(200, { ok: true, archivos: r.archivos })
      }

      case 'crear': {
        exigirEnviar()
        const requestId = uuid(body.request_id, 'request_id')

        // Idempotencia: el mismo envío (doble clic, reintento) devuelve la misma solicitud.
        const previa = await filaPorId(requestId)
        if (previa) {
          if (previa.creado_por !== user.id) throw new Rechazo('Identificador de solicitud inválido')
          return json(200, { ok: true, duplicada: true, solicitud: mapFila(previa, null) })
        }

        const v = await validarFormulario(requestId)

        // Topes por usuario (freno a abusos/errores; son holgados para el uso normal).
        const desde = new Date(Date.now() - 3600 * 1000).toISOString()
        const [pend, recientes] = await Promise.all([
          admin.from(TABLA).select('id', { count: 'exact', head: true }).eq('creado_por', user.id).eq('estado_aprobacion', 'Por aprobar'),
          admin.from(TABLA).select('id', { count: 'exact', head: true }).eq('creado_por', user.id).gte('creado_en', desde),
        ])
        if (pend.error) throw pend.error
        if (recientes.error) throw recientes.error
        if ((pend.count ?? 0) >= MAX_PENDIENTES_POR_USUARIO) {
          throw new Rechazo('Tienes demasiadas solicitudes por aprobar; espera a que se resuelvan algunas', 429)
        }
        if ((recientes.count ?? 0) >= MAX_ENVIOS_POR_HORA) {
          throw new Rechazo('Has enviado muchas solicitudes en poco tiempo; intenta de nuevo en un rato', 429)
        }

        const ahora = new Date().toISOString()
        const ins = await admin.from(TABLA).insert({
          id: requestId,
          creado_por: user.id,
          creado_por_nombre: nombreUsuario,
          a_nombre_de_id: v.aNombre ? v.aNombre.id : null,
          a_nombre_de_nombre: v.aNombre ? v.aNombre.nombre : null,
          empresa: v.empresa,
          asunto: v.asunto,
          asunto_otro: v.asuntoOtro,
          fecha_tentativa: v.fecha,
          descripcion: v.descripcion,
          archivos: v.archivos,
          historial: [{ tipo: 'envio', por: nombreUsuario, en: ahora }],
        }).select('*').single()
        if (ins.error) {
          if ((ins.error as any).code === '23505') {
            const dup = await filaPorId(requestId)
            if (dup && dup.creado_por === user.id) return json(200, { ok: true, duplicada: true, solicitud: mapFila(dup, null) })
          }
          throw ins.error
        }

        const { actual, aviso } = await resolverEnvio(ins.data, false)
        return json(200, { ok: true, solicitud: mapFila(actual, null), aviso })
      }

      case 'reenviar': {
        exigirEnviar()
        const requestId = uuid(body.request_id, 'request_id')
        const r = await filaPorId(requestId)
        if (!r || r.creado_por !== user.id) throw new Rechazo('Solicitud no encontrada', 404)
        if (r.estado_aprobacion !== 'Rechazada') throw new Rechazo('Solo se pueden reenviar solicitudes rechazadas')

        const v = await validarFormulario(requestId)
        const ahora = new Date().toISOString()
        const upd = await admin.from(TABLA).update({
          a_nombre_de_id: v.aNombre ? v.aNombre.id : null,
          a_nombre_de_nombre: v.aNombre ? v.aNombre.nombre : null,
          empresa: v.empresa,
          asunto: v.asunto,
          asunto_otro: v.asuntoOtro,
          fecha_tentativa: v.fecha,
          descripcion: v.descripcion,
          archivos: v.archivos,
          estado_aprobacion: 'Por aprobar',
          motivo_rechazo: null,
          aprobada_por: null,
          aprobada_por_nombre: null,
          fecha_aprobacion: null,
          auto_aprobada: false,
          // Si la había rechazado Mercadeo, la tarea vieja queda atrás: al aprobarse de nuevo
          // se crea una nueva en el Tablero (pqrs_tarea_id se vuelve a fijar entonces).
          rechazada_por_mercadeo: false,
          pqrs_tarea_id: null,
          reenvios: (r.reenvios || 0) + 1,
          modificado_en: ahora,
          historial: [...(r.historial || []), { tipo: 'reenvio', por: nombreUsuario, en: ahora }],
        }).eq('id', requestId).eq('estado_aprobacion', 'Rechazada').select('*').maybeSingle()
        if (upd.error) throw upd.error
        if (!upd.data) throw new Rechazo('La solicitud ya no está rechazada')

        const { actual, aviso } = await resolverEnvio(upd.data, true)
        return json(200, { ok: true, solicitud: mapFila(actual, null), aviso })
      }

      case 'listar': {
        // Siempre por el id del JWT verificado: el navegador no puede pedir las de otra persona.
        const t = await admin.from(TABLA).select('*')
          .or(`creado_por.eq.${user.id},a_nombre_de_id.eq.${user.id}`)
          .order('numero', { ascending: false })
          .limit(200)
        if (t.error) throw t.error
        const filas = t.data || []

        // Estado en el Tablero de las ya aprobadas. Si pqrs no responde, se muestran igual las demás.
        // La rechazada por Mercadeo ya no tiene tarea vigente en el Tablero: no se consulta.
        const tablero = (f: any) => f.pqrs_tarea_id && !f.rechazada_por_mercadeo
        const porTarea = new Map<number, any>()
        let mercadeoDisponible = true
        if (filas.some(tablero)) {
          try {
            const r = await puente({ action: 'listar', solicitante: { id: user.id } })
            for (const s of r.solicitudes || []) porTarea.set(Number(s.id), s)
          } catch (e) {
            mercadeoDisponible = false
            console.error('solicitud-mercadeo: no se pudo leer el Tablero:', (e as Error)?.message)
          }
        }
        return json(200, {
          ok: true,
          mercadeo_disponible: mercadeoDisponible,
          solicitudes: filas.map((f: any) => mapFila(f, tablero(f) ? porTarea.get(Number(f.pqrs_tarea_id)) || null : null)),
        })
      }

      case 'pendientes': {
        exigirAprobador()
        const t = await admin.from(TABLA).select('*').eq('estado_aprobacion', 'Por aprobar')
          .order('numero', { ascending: true }).limit(200)
        if (t.error) throw t.error
        return json(200, { ok: true, solicitudes: (t.data || []).map((f: any) => mapFila(f, null)) })
      }

      case 'aprobar': {
        exigirAprobador()
        const id = uuid(body.id, 'id')
        const r = await filaPorId(id)
        if (!r) throw new Rechazo('Solicitud no encontrada', 404)
        if (r.estado_aprobacion !== 'Por aprobar') {
          throw new Rechazo(`Esta solicitud ya fue ${r.estado_aprobacion === 'Aprobada' ? 'aprobada' : 'rechazada'}`, 409)
        }
        // Primero se crea en el Tablero (idempotente); si falla, la solicitud sigue 'Por aprobar'.
        const t = await enviarAMercadeo(r, nombreUsuario)
        const m = await marcarAprobada(r, t.id, false)
        if (!m) {
          const ya = await filaPorId(id)
          if (ya && ya.estado_aprobacion === 'Aprobada') return json(200, { ok: true, duplicada: true, solicitud: mapFila(ya, null) })
          throw new Rechazo('La solicitud cambió de estado; recarga la lista', 409)
        }
        await avisarDecision(m, true)
        return json(200, { ok: true, solicitud: mapFila(m, null) })
      }

      case 'rechazar': {
        exigirAprobador()
        const id = uuid(body.id, 'id')
        const motivo = typeof body.motivo === 'string' ? body.motivo.trim().replace(/\s+/g, ' ') : ''
        if (motivo.length < 3) throw new Rechazo('Escribe el motivo del rechazo (mínimo 3 caracteres)')
        if (motivo.length > 500) throw new Rechazo('El motivo no puede superar 500 caracteres')
        const r = await filaPorId(id)
        if (!r) throw new Rechazo('Solicitud no encontrada', 404)
        if (r.estado_aprobacion !== 'Por aprobar') {
          throw new Rechazo(`Esta solicitud ya fue ${r.estado_aprobacion === 'Aprobada' ? 'aprobada' : 'rechazada'}`, 409)
        }
        const ahora = new Date().toISOString()
        const u = await admin.from(TABLA).update({
          estado_aprobacion: 'Rechazada',
          motivo_rechazo: motivo,
          aprobada_por: user.id,
          aprobada_por_nombre: nombreUsuario,
          fecha_aprobacion: ahora,
          auto_aprobada: false,
          modificado_en: ahora,
          historial: [...(r.historial || []), { tipo: 'rechazo', por: nombreUsuario, en: ahora, motivo }],
        }).eq('id', id).eq('estado_aprobacion', 'Por aprobar').select('*').maybeSingle()
        if (u.error) throw u.error
        if (!u.data) throw new Rechazo('La solicitud cambió de estado; recarga la lista', 409)
        await avisarDecision(u.data, false)
        return json(200, { ok: true, solicitud: mapFila(u.data, null) })
      }

      case 'archivo_url': {
        const id = uuid(body.id, 'id')
        const idx = Number(body.indice)
        const r = await filaPorId(id)
        if (!r) throw new Rechazo('Solicitud no encontrada', 404)
        const esParte = r.creado_por === user.id || r.a_nombre_de_id === user.id
        if (!puedeAprobar && !esParte) throw new Rechazo('No tienes permiso para ver este archivo', 403)
        const a = Number.isInteger(idx) ? (r.archivos || [])[idx] : null
        if (!a) throw new Rechazo('Archivo no encontrado', 404)
        const f = await puente({ action: 'firmar', request_id: r.id, paths: [a.path] })
        const x = (f.archivos || [])[0]
        if (!x || !x.existe) throw new Rechazo('El archivo ya no está disponible', 404)
        return json(200, { ok: true, url: x.url, nombre: a.nombre })
      }

      default:
        throw new Rechazo(`action inválida: ${body?.action}`)
    }
  } catch (e) {
    if (e instanceof Rechazo) return json(e.status, { ok: false, error: e.message })
    console.error('solicitud-mercadeo error:', (e as Error)?.message, e)
    return json(500, { ok: false, error: 'Error interno al procesar la solicitud' })
  }
})
