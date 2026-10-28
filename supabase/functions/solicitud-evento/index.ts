// solicitud-evento
//
// Solicitudes de EVENTOS (formato MC-ISO-FO01) con APROBACIÓN PREVIA. Lado "Pedidos" del puente hacia el
// módulo de Eventos de Mercadeo de panel-pqrs (otro proyecto Supabase). El navegador llama a ESTA función
// con la sesión del usuario; aquí se verifica quién es, su permiso y sus empresas. Misma lógica que
// `solicitud-mercadeo` (Solicitudes a Mercadeo), con estas diferencias:
//   - El formulario es el formato de eventos (6 secciones); viaja normalizado en `datos`.
//   - `fecha_radicacion` = día en que el solicitante radicó (o reenvió tras un rechazo) la solicitud; con ella
//     Mercadeo mide la política de 15 días de anticipación (es una advertencia, no bloquea).
//   - Solo se puede modificar mientras Mercadeo no la haya aprobado (radicada / en revisión); después, el
//     solicitante le deja una OBSERVACIÓN.
//
// Flujo:
//   crear/reenviar -> la solicitud queda guardada aquí en 'Por aprobar' (tabla solicitudes_eventos)
//                     y se avisa a los aprobadores. Si quien envía ya es aprobador, se aprueba sola.
//   aprobar        -> SOLO entonces se crea en Eventos de Mercadeo (estado 'Radicada') con la función
//                     `solicitud-evento-pedidos` de pqrs y un secreto compartido (server -> server).
//   rechazar       -> motivo obligatorio; el solicitante puede editarla y reenviarla.
//   editar         -> 'Por aprobar': se actualiza y sigue por aprobar. 'Rechazada': igual que reenviar.
//                     'Aprobada': el evento sale de Mercadeo (acción `retirar` de pqrs; se niega con 409 si
//                     Mercadeo ya lo aprobó) y la solicitud vuelve a aprobación; al aprobarse llega como
//                     evento nuevo.
// Mercadeo también puede rechazar una solicitud ya aprobada: eso entra por `solicitud-evento-aviso` (la llama
// pqrs), la deja 'Rechazada' con rechazada_por_mercadeo = true y se corrige y reenvía igual que un rechazo.
// El navegador nunca habla con la función de pqrs ni con la tabla: todo pasa por aquí.
//
// Acciones (campo `action`):
//   contexto     -> empresas del usuario, usuarios activos del panel y si puede aprobar
//   preparar     -> URLs firmadas para subir adjuntos directo al Storage de pqrs
//   crear        -> envía una solicitud nueva
//   reenviar     -> corrige y reenvía una solicitud RECHAZADA propia
//   editar       -> modifica una solicitud propia por aprobar, rechazada o aprobada (aún sin aprobar en Mercadeo)
//   listar       -> "Mis solicitudes" (las que hizo el usuario o hechas a su nombre)
//   pendientes   -> (aprobadores) solicitudes 'Por aprobar'
//   aprobadas    -> (aprobadores) solicitudes aprobadas que siguen con Mercadeo (sin cerrar ni cancelar)
//   observar     -> el solicitante, a nombre de quién se hizo o un aprobador le deja una OBSERVACIÓN a Mercadeo
//   aprobar      -> (aprobadores) aprueba y la manda a Eventos de Mercadeo
//   rechazar     -> (aprobadores) rechaza con motivo
//   archivo_url  -> URL temporal para abrir un adjunto (aprobador, solicitante o a_nombre_de)
//
// Secretos de ESTE proyecto (supabase secrets set ...): PQRS_BRIDGE_SECRET (ya existe; el mismo valor que
// PEDIDOS_BRIDGE_SECRET en pqrs). Opcional: PQRS_EVENTO_BRIDGE_URL (por defecto, la función de pqrs de producción).
//
// Permisos: enviar = rol admin o módulo `solicitudes_mercadeo`; aprobar = rol admin o módulo
// `solicitudes_mercadeo_aprobar` (usuario_modulos), los mismos de Solicitudes a Mercadeo.
// Desplegar con verify_jwt = true.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://logisticatecbihol.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODULO = 'solicitudes_mercadeo'
const MODULO_APROBAR = 'solicitudes_mercadeo_aprobar'
const TABLA = 'solicitudes_eventos'
const PQRS_BRIDGE_URL_DEFECTO = 'https://kvfqcymeihglohkcckdp.supabase.co/functions/v1/solicitud-evento-pedidos'
const EMPRESAS_HOLDING = ['PARCELAR', 'GREEN', 'RESO', 'IASO', 'IAS']
// Empresas ADICIONALES de los eventos: no son del holding, así que no dependen de las empresas asignadas al usuario;
// las puede elegir cualquiera que envíe solicitudes. «OTROS» exige el nombre escrito (datos.empresa_otra).
const EMPRESAS_EXTRA: { codigo: string; nombre: string }[] = [
  { codigo: 'CHIA_ABAGO', nombre: 'Chía Abagó' },
  { codigo: 'TECBIHOL', nombre: 'Tecbihol' },
  { codigo: 'OTROS', nombre: 'Otros' },
]
const EXTRA_CODIGOS = EMPRESAS_EXTRA.map((e) => e.codigo)
function nombreEmpresa(codigo: string, otra?: string | null): string {
  if (codigo === 'OTROS') return otra ? `Otros: ${otra}` : 'Otros'
  return EMPRESAS_EXTRA.find((e) => e.codigo === codigo)?.nombre ?? codigo
}
const MODALIDADES = ['fisico', 'virtual', 'hibrido']
const OBJETIVOS = ['leads', 'relacion_clientes', 'lanzamiento', 'posicionamiento', 'capacitacion', 'trafico_digital', 'retencion']
const CANALES = ['email', 'redes', 'web', 'relaciones_publicas', 'publicidad_digital', 'video']
const MATERIALES = ['banners_redes', 'diseno_email', 'invitaciones', 'presentacion', 'flyers', 'rollups', 'merchandising']
const LOGISTICA = ['registros', 'coordinacion_logistica', 'plataforma_virtual', 'presencia_mercadeo']
const MAX_ARCHIVOS = 5
// «Productos relacionados» (opcional): nombres del maestro sin la presentación, o escritos a mano. Mismas reglas que el
// formulario (js/productos-solicitud.js), que solicitud-mercadeo y que panel-pqrs; el servidor no consulta el maestro.
const MAX_PRODUCTOS = 20
const PRODUCTO_MIN = 2
const PRODUCTO_MAX = 100
// Estados del evento en Mercadeo: aún sin aprobar (se puede modificar) y con Mercadeo (se puede observar).
const EST_SIN_APROBAR = ['radicada', 'en_revision']
const EST_ABIERTOS = ['radicada', 'en_revision', 'aprobada', 'en_preparacion', 'realizada']
const MAX_PENDIENTES_POR_USUARIO = 30
const MAX_ENVIOS_POR_HORA = 10
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}

function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '')
}

function uuid(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new Rechazo(`${campo} inválido`)
  return v.toLowerCase()
}

function texto(v: unknown, campo: string, min: number, max: number): string {
  const t = typeof v === 'string' ? v.trim() : ''
  if (t.length < min) throw new Rechazo(min <= 1 ? `${campo} es requerido` : `${campo} debe tener al menos ${min} caracteres`)
  if (t.length > max) throw new Rechazo(`${campo} no puede superar ${max} caracteres`)
  return t
}

// Texto opcional: vacío si no viene.
function textoOpc(v: unknown, campo: string, max: number): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v !== 'string') throw new Rechazo(`${campo} no es válido`)
  const t = v.trim()
  if (t.length > max) throw new Rechazo(`${campo} no puede superar ${max} caracteres`)
  return t
}

function fechaValida(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !FECHA_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) {
    throw new Rechazo(`${campo} no es una fecha válida`)
  }
  return v
}

function horaOpc(v: unknown, campo: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !HORA_RE.test(v)) throw new Rechazo(`${campo} no es una hora válida`)
  return v.slice(0, 5)
}

function enteroOpc(v: unknown, campo: string): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Rechazo(`${campo} debe ser un número entero entre 0 y 100000`)
  return n
}

function monto(v: unknown, campo: string): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100000000000) throw new Rechazo(`${campo} no es un valor válido`)
  return n
}

function lista(v: unknown, validos: string[], campo: string): string[] {
  if (v === null || v === undefined) return []
  if (!Array.isArray(v)) throw new Rechazo(`${campo} no es válido`)
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string' || !validos.includes(x)) throw new Rechazo(`${campo}: opción inválida`)
    if (!out.includes(x)) out.push(x)
  }
  return out
}

// Productos relacionados: hasta MAX_PRODUCTOS nombres de PRODUCTO_MIN a PRODUCTO_MAX caracteres, en una sola línea y sin repetir
// (sin importar tildes ni mayúsculas; el primero que llegue se queda).
function productosValidos(v: unknown): string[] {
  if (v === null || v === undefined) return []
  if (!Array.isArray(v)) throw new Rechazo('Los productos relacionados no son válidos')
  if (v.length > MAX_PRODUCTOS) throw new Rechazo(`Máximo ${MAX_PRODUCTOS} productos por solicitud`)
  const out: string[] = []
  const vistos = new Set<string>()
  for (const x of v) {
    if (typeof x !== 'string') throw new Rechazo('Los productos relacionados no son válidos')
    const n = x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    if (n.length < PRODUCTO_MIN) throw new Rechazo(`El nombre de un producto debe tener al menos ${PRODUCTO_MIN} caracteres`)
    if (n.length > PRODUCTO_MAX) throw new Rechazo(`El nombre de un producto no puede superar ${PRODUCTO_MAX} caracteres`)
    const k = n.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (vistos.has(k)) continue
    vistos.add(k)
    out.push(n)
  }
  return out
}

const refSE = (n: number | string) => `SE-${n}`

// Texto único del lugar (igual al que arma el navegador): «Municipio, Departamento · Distribuidor/cliente: X (NIT n) · Finca: Y».
// El municipio va primero para que, si algo se recortara a los 300 de pqrs, se pierda lo opcional y no lo obligatorio.
function armarLugar(municipio: string, departamento: string, distribuidor: string, nit: string, finca: string): string {
  const p: string[] = []
  if (municipio) p.push(municipio + (departamento ? `, ${departamento}` : ''))
  if (distribuidor) p.push(`Distribuidor/cliente: ${distribuidor}${nit ? ` (NIT ${nit})` : ''}`)
  if (finca) p.push(`Finca: ${finca}`)
  return p.join(' · ').slice(0, 300)
}

// Llama a la función de pqrs. Los 4xx de validación se reenvían con su mensaje;
// un 401 (secreto mal configurado) o un fallo de red se traducen a mensajes neutros.
async function puente(payload: Record<string, unknown>) {
  const url = Deno.env.get('PQRS_EVENTO_BRIDGE_URL') || PQRS_BRIDGE_URL_DEFECTO
  const secret = Deno.env.get('PQRS_BRIDGE_SECRET')
  if (!secret) throw new Rechazo('El envío a Mercadeo todavía no está configurado', 503)

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
      console.error('solicitud-evento: el puente de pqrs rechazó el secreto (401)')
      throw new Rechazo('No se pudo comunicar con Mercadeo (configuración del puente)', 502)
    }
    const status = res.status >= 400 && res.status < 500 ? res.status : 502
    throw new Rechazo((j && j.error) || 'Mercadeo no pudo procesar la solicitud', status)
  } catch (e) {
    if (e instanceof Rechazo) throw e
    if ((e as Error)?.name === 'AbortError') throw new Rechazo('Mercadeo no respondió a tiempo; intenta de nuevo', 504)
    console.error('solicitud-evento: fallo de red hacia pqrs:', (e as Error)?.message)
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
    // Usuarios activos del panel (para "Solicitante"), incluido el propio usuario. Solo se expone nombre y rol.
    async function usuariosPanel() {
      const c = await admin.from('usuarios').select('id, nombre, email, rol').eq('activo', true).order('nombre')
      if (c.error) throw c.error
      return (c.data || []).map((x: any) => ({ id: x.id, nombre: (x.nombre || '').trim() || x.email, rol: x.rol, email: x.email }))
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
    // Usa el módulo 'solicitudes_mercadeo' (el mismo permiso); la referencia SE-n lleva a solicitudes-eventos.html.
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
        if (r.error) console.error('solicitud-evento: no se pudo avisar:', r.error.message)
      } catch (e) {
        console.error('solicitud-evento: no se pudo avisar:', (e as Error)?.message)
      }
    }

    async function avisarAprobadores(r: any, modificada = false) {
      const ids = await aprobadoresIds()
      const para = r.a_nombre_de_nombre ? ` (a nombre de ${r.a_nombre_de_nombre})` : ''
      await avisar(
        ids,
        modificada
          ? `✏️ Solicitud de evento modificada, por aprobar: ${refSE(r.numero)}`
          : `🎪 Solicitud de evento por aprobar: ${refSE(r.numero)}`,
        modificada
          ? `${r.creado_por_nombre}${para} la modificó: ${r.nombre_evento} · ${nombreEmpresa(r.empresa, r.datos?.empresa_otra)}.`
          : `${r.creado_por_nombre}${para} pide: ${r.nombre_evento} · ${nombreEmpresa(r.empresa, r.datos?.empresa_otra)} (${fechaCorta(r.fecha_evento)}).`,
        refSE(r.numero),
      )
    }

    async function avisarDecision(r: any, aprobada: boolean) {
      const destinatarios = [r.creado_por, r.a_nombre_de_id].filter(Boolean)
      await avisar(
        destinatarios,
        aprobada
          ? `✅ Solicitud de evento aprobada: ${refSE(r.numero)}`
          : `❌ Solicitud de evento rechazada: ${refSE(r.numero)}`,
        aprobada
          ? 'Tu solicitud fue aprobada y ya está con el equipo de Mercadeo.'
          : `Motivo: ${r.motivo_rechazo || 'sin motivo'}. Puedes editarla y reenviarla.`,
        refSE(r.numero),
      )
    }

    // Valida y normaliza lo que dice el formulario (para crear, reenviar y editar). La BD de pqrs lo vuelve a validar.
    async function validarFormulario(requestId: string) {
      const d = body.datos && typeof body.datos === 'object' ? body.datos : {}
      if (!empresas.includes(d.empresa) && !EXTRA_CODIGOS.includes(d.empresa)) throw new Rechazo('La empresa elegida no está entre las tuyas')
      // Con «Otros» se escribe el nombre de la empresa (obligatorio); con cualquier otra no aplica.
      const empresaOtra = d.empresa === 'OTROS' ? texto(d.empresa_otra, 'El nombre de la empresa', 3, 100).replace(/\s+/g, ' ') : ''

      // Solicitante: el propio usuario o, si hace la solicitud a nombre de otro, cualquier usuario activo del panel
      // (el nombre y el correo salen de la BD, no del navegador).
      let aNombre: { id: string; nombre: string } | null = null
      let solicitante = { id: user.id as string, nombre: nombreUsuario as string, email: perfil.email as string }
      if (body.a_nombre_de_id) {
        const id = uuid(body.a_nombre_de_id, 'a_nombre_de_id')
        if (id !== user.id) {
          const u = (await usuariosPanel()).find((x: any) => x.id === id)
          if (!u) throw new Rechazo('El solicitante elegido no está disponible')
          aNombre = { id: u.id, nombre: u.nombre }
          solicitante = { id: u.id, nombre: u.nombre, email: u.email }
        }
      }

      const hoy = hoyBogota()
      const nombre = texto(d.nombre, 'El nombre del evento', 3, 200)
      const descripcion = texto(d.descripcion, 'La descripción del evento', 10, 2000)
      const fechaEvento = fechaValida(d.fecha_evento, 'La fecha del evento')
      if (fechaEvento < hoy) throw new Rechazo('La fecha del evento no puede ser anterior a hoy')
      let fechaLimite: string | null = null
      if (d.fecha_limite_aprobacion) {
        fechaLimite = fechaValida(d.fecha_limite_aprobacion, 'La fecha límite de aprobación')
        if (fechaLimite < hoy) throw new Rechazo('La fecha límite de aprobación no puede ser anterior a hoy')
        if (fechaLimite > fechaEvento) throw new Rechazo('La fecha límite de aprobación no puede ser posterior a la fecha del evento')
      }
      const horaInicio = horaOpc(d.hora_inicio, 'La hora de inicio')
      const horaFin = horaOpc(d.hora_fin, 'La hora de fin')
      if (horaInicio && horaFin && horaFin <= horaInicio) throw new Rechazo('La hora de fin debe ser posterior a la de inicio')

      const modalidad = d.modalidad
      if (!MODALIDADES.includes(modalidad)) throw new Rechazo('Elige la modalidad: físico, virtual o híbrido')
      // Lugar presencial: municipio + departamento obligatorios; distribuidor/cliente (con su NIT) y finca opcionales.
      // `lugar` (texto único, ≤ 300) lo arma esta función: es lo que recibe Mercadeo en panel-pqrs.
      const presencial = modalidad === 'fisico' || modalidad === 'hibrido'
      const lugarMunicipio = presencial ? textoOpc(d.lugar_municipio, 'El municipio', 60) : ''
      const lugarDepartamento = presencial ? textoOpc(d.lugar_departamento, 'El departamento', 40) : ''
      const lugarDistribuidor = presencial ? textoOpc(d.lugar_distribuidor, 'El distribuidor o cliente', 120) : ''
      const lugarNit = presencial ? textoOpc(d.lugar_distribuidor_nit, 'El NIT del distribuidor o cliente', 25) : ''
      const lugarFinca = presencial ? textoOpc(d.lugar_finca, 'La finca', 100) : ''
      if (presencial && (!lugarMunicipio || !lugarDepartamento)) throw new Rechazo('Indica el municipio y el departamento del evento')
      if (lugarNit && !lugarDistribuidor) throw new Rechazo('Indica el nombre del distribuidor o cliente del NIT')
      const lugar = armarLugar(lugarMunicipio, lugarDepartamento, lugarDistribuidor, lugarNit, lugarFinca)
      let plataforma = textoOpc(d.plataforma, 'La plataforma', 200)
      if ((modalidad === 'virtual' || modalidad === 'hibrido') && !plataforma) throw new Rechazo('Indica la plataforma del evento virtual')
      if (modalidad === 'fisico') plataforma = ''

      const correo = textoOpc(d.solicitante_correo, 'El correo', 160) || (solicitante.email || '').slice(0, 160)
      if (correo && !CORREO_RE.test(correo)) throw new Rechazo('El correo electrónico no es válido')

      const lineas: { concepto: string; valor: number }[] = []
      const gastos = d.desglose_gastos
      if (gastos !== undefined && gastos !== null && !Array.isArray(gastos)) throw new Rechazo('El desglose de gastos no es válido')
      if (Array.isArray(gastos)) {
        if (gastos.length > 30) throw new Rechazo('El desglose de gastos admite máximo 30 líneas')
        for (const g of gastos) {
          const concepto = typeof g?.concepto === 'string' ? g.concepto.trim() : ''
          if (!concepto) throw new Rechazo('Cada línea del desglose de gastos necesita un concepto')
          if (concepto.length > 120) throw new Rechazo('El concepto de un gasto no puede superar 120 caracteres')
          lineas.push({ concepto, valor: monto(g?.valor, `El valor de «${concepto}»`) })
        }
      }

      const datos = {
        solicitante: {
          id: solicitante.id,
          nombre: solicitante.nombre,
          area: textoOpc(d.solicitante_area, 'El departamento/área', 120),
          correo,
          telefono: textoOpc(d.solicitante_telefono, 'El teléfono', 40),
        },
        fecha_limite_aprobacion: fechaLimite,
        empresa: d.empresa,
        empresa_otra: empresaOtra,
        nombre,
        descripcion,
        fecha_evento: fechaEvento,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        modalidad,
        lugar,
        lugar_municipio: lugarMunicipio,
        lugar_departamento: lugarDepartamento,
        lugar_distribuidor: lugarDistribuidor,
        lugar_distribuidor_nit: lugarNit,
        lugar_finca: lugarFinca,
        plataforma,
        objetivos: lista(d.objetivos, OBJETIVOS, 'Objetivos'),
        objetivos_otro: textoOpc(d.objetivos_otro, 'Otros objetivos', 300),
        productos: productosValidos(d.productos),
        publico_objetivo: textoOpc(d.publico_objetivo, 'El público objetivo', 500),
        segmento_demografico: textoOpc(d.segmento_demografico, 'El segmento demográfico', 500),
        segmento_profesional: textoOpc(d.segmento_profesional, 'La segmentación profesional', 500),
        nivel_conocimiento: textoOpc(d.nivel_conocimiento, 'El nivel de conocimiento', 300),
        total_invitados: enteroOpc(d.total_invitados, 'El total de invitados'),
        asistentes_presencial: enteroOpc(d.asistentes_presencial, 'Los asistentes presenciales'),
        asistentes_virtual: enteroOpc(d.asistentes_virtual, 'Los asistentes virtuales'),
        canales: lista(d.canales, CANALES, 'Canales de promoción'),
        canales_otro: textoOpc(d.canales_otro, 'Otros canales', 300),
        materiales: lista(d.materiales, MATERIALES, 'Materiales'),
        materiales_otro: textoOpc(d.materiales_otro, 'Otros materiales', 300),
        logistica: lista(d.logistica, LOGISTICA, 'Logística'),
        logistica_otro: textoOpc(d.logistica_otro, 'Otra logística', 300),
        presupuesto_estimado: monto(d.presupuesto_estimado, 'El presupuesto estimado'),
        total_solicitado: monto(d.total_solicitado, 'El total solicitado a Mercadeo'),
        desglose_gastos: lineas,
      }

      // Archivos: ya subidos bajo eventos/<request_id>/ ; se confirma que existen.
      const declarados = Array.isArray(body.archivos) ? body.archivos : []
      if (declarados.length > MAX_ARCHIVOS) throw new Rechazo(`Máximo ${MAX_ARCHIVOS} archivos por solicitud`)
      const carpeta = `eventos/${requestId}/`
      const archivos = declarados.map((a: any) => {
        if (!a || typeof a.path !== 'string' || !a.path.startsWith(carpeta) || a.path.includes('..')) {
          throw new Rechazo('Ruta de archivo inválida')
        }
        const nombreArchivo = typeof a.nombre === 'string' ? a.nombre.trim().slice(0, 200) : ''
        if (!nombreArchivo) throw new Rechazo('Archivo sin nombre')
        const tamano = Number(a.tamano)
        return {
          path: a.path,
          nombre: nombreArchivo,
          tamano: Number.isFinite(tamano) && tamano > 0 ? Math.round(tamano) : 0,
          tipo: typeof a.tipo === 'string' ? a.tipo.slice(0, 120) : null,
        }
      })
      if (archivos.length) {
        const f = await puente({ action: 'firmar', request_id: requestId, paths: archivos.map((a: any) => a.path) })
        const faltan = (f.archivos || []).filter((x: any) => !x.existe)
        if (faltan.length) throw new Rechazo('Un archivo no llegó completo; vuelve a intentarlo')
      }

      return { empresa: d.empresa as string, aNombre, datos, archivos, nombreEvento: nombre, fechaEvento }
    }

    // Manda una solicitud YA aprobada a Eventos de Mercadeo (idempotente por origen_ref = id).
    async function enviarAMercadeo(r: any, aprobadorNombre: string) {
      return await puente({
        action: 'crear',
        numero_origen: r.numero,
        aprobada_por: aprobadorNombre,
        request_id: r.id,
        fecha_radicacion: r.fecha_radicacion,
        enviado_por: { id: r.creado_por, nombre: r.creado_por_nombre },
        datos: r.datos,
        archivos: r.archivos,
      })
    }

    // Marca la solicitud como aprobada (solo si sigue 'Por aprobar' Y sin cambios desde que se leyó:
    // si el solicitante la editó mientras se aprobaba, el evento creado ya no corresponde).
    async function marcarAprobada(r: any, eventoId: number, auto: boolean) {
      const ahora = new Date().toISOString()
      const historial = [...(r.historial || []), { tipo: auto ? 'autoaprobacion' : 'aprobacion', por: nombreUsuario, en: ahora }]
      const u = await admin.from(TABLA).update({
        estado_aprobacion: 'Aprobada',
        aprobada_por: user.id,
        aprobada_por_nombre: nombreUsuario,
        fecha_aprobacion: ahora,
        auto_aprobada: auto,
        pqrs_evento_id: eventoId,
        modificado_en: ahora,
        historial,
      }).eq('id', r.id).eq('estado_aprobacion', 'Por aprobar').eq('modificado_en', r.modificado_en).select('*').maybeSingle()
      if (u.error) throw u.error
      return u.data // null si otro la resolvió o la modificó antes
    }

    async function filaPorId(id: string) {
      const f = await admin.from(TABLA).select('*').eq('id', id).maybeSingle()
      if (f.error) throw f.error
      return f.data
    }

    // Forma que ve el navegador. `pq` = datos del evento en Mercadeo (si ya fue aprobada y creada allá).
    function mapFila(r: any, pq: any | null) {
      const hist = (r.historial || []).map((h: any) => ({ tipo: h.tipo, por: h.por, en: h.en, motivo: h.motivo ?? null }))
      if (pq) {
        for (const h of pq.historial || []) {
          hist.push(h.tipo === 'estado'
            ? { tipo: 'estado', estado: h.estado, motivo: h.motivo ?? null, en: h.en }
            : h.tipo === 'observacion'
              ? { tipo: 'observacion', texto: h.texto, por: h.por, como: h.como, en: h.en }
              : { tipo: 'respuesta', texto: h.texto, por: h.por, en: h.en })
        }
      }
      hist.sort((a: any, b: any) => String(a.en).localeCompare(String(b.en)))
      const dias = diasEntre(r.fecha_radicacion, r.fecha_evento)
      return {
        id: r.id,
        numero: r.numero,
        estado_aprobacion: r.estado_aprobacion,
        motivo_rechazo: r.motivo_rechazo,
        rechazada_por_mercadeo: !!r.rechazada_por_mercadeo,
        aprobada_por: r.aprobada_por_nombre,
        fecha_aprobacion: r.fecha_aprobacion,
        auto_aprobada: r.auto_aprobada,
        // Se puede modificar mientras Mercadeo no haya aprobado el evento. Si no se pudo leer Mercadeo
        // (pq nulo) se ofrece igual: `editar` lo vuelve a comprobar con pqrs.
        puede_editar: r.creado_por === user.id && (
          r.estado_aprobacion === 'Por aprobar' || r.estado_aprobacion === 'Rechazada' ||
          (r.estado_aprobacion === 'Aprobada' && !(pq && !EST_SIN_APROBAR.includes(pq.estado)))
        ),
        // Se le puede dejar una observación a Mercadeo mientras el evento siga con ella (aprobada aquí, vigente allá
        // y sin cerrar ni cancelar): quien la hizo, a nombre de quién y los aprobadores.
        puede_observar: r.estado_aprobacion === 'Aprobada' && !!r.pqrs_evento_id && !r.rechazada_por_mercadeo &&
          !(pq && !EST_ABIERTOS.includes(pq.estado)) &&
          (r.creado_por === user.id || r.a_nombre_de_id === user.id || puedeAprobar),
        empresa: r.empresa,
        empresa_otra: r.datos?.empresa_otra || '',
        nombre_evento: r.nombre_evento,
        fecha_evento: r.fecha_evento,
        fecha_radicacion: r.fecha_radicacion,
        dias_anticipacion: dias,
        extemporanea: dias < 15,
        datos: r.datos,
        solicitante: r.creado_por_nombre,
        solicitante_id: r.creado_por,
        a_nombre_de: r.a_nombre_de_nombre,
        a_nombre_de_id: r.a_nombre_de_id,
        creada_en: r.creado_en,
        archivos: (r.archivos || []).map((a: any) => ({ path: a.path, nombre: a.nombre, tamano: a.tamano, tipo: a.tipo })),
        // Datos de Mercadeo (solo si ya fue aprobada y creada allá)
        estado: pq ? pq.estado : null,
        respondida_en: pq ? pq.respondida_en : null,
        aprobada_mercadeo_por: pq ? pq.aprobada_por : null,
        aprobada_mercadeo_en: pq ? pq.aprobada_en : null,
        motivo_cancelacion: pq ? pq.motivo_cancelacion : null,
        cancelada_por: pq ? pq.cancelada_por : null,
        realizada_en: pq ? pq.realizada_en : null,
        bd_asistentes_fecha: pq ? pq.bd_asistentes_fecha : null,
        bd_no_aplica: pq ? pq.bd_no_aplica : false,
        cerrada_en: pq ? pq.cerrada_en : null,
        // Avance del checklist de actividades de Mercadeo (solo cuántas van; el detalle es interno de Mercadeo).
        actividades_total: pq ? Number(pq.actividades_total) || 0 : 0,
        actividades_hechas: pq ? Number(pq.actividades_hechas) || 0 : 0,
        historial: hist,
      }
    }

    // Registra (o reenvía) una solicitud y, si quien envía ya es aprobador, la aprueba sola.
    // `modificada`: es una edición, el aviso a los aprobadores lo dice.
    async function resolverEnvio(fila: any, modificada = false) {
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
          console.error('solicitud-evento: autoaprobación fallida:', (e as Error)?.message)
        }
      }
      if (actual.estado_aprobacion === 'Por aprobar') await avisarAprobadores(actual, modificada)
      return { actual, aviso }
    }

    // Columnas sueltas que salen del formulario normalizado.
    function columnasDe(v: any) {
      return {
        a_nombre_de_id: v.aNombre ? v.aNombre.id : null,
        a_nombre_de_nombre: v.aNombre ? v.aNombre.nombre : null,
        empresa: v.empresa,
        nombre_evento: v.nombreEvento,
        fecha_evento: v.fechaEvento,
        datos: v.datos,
        archivos: v.archivos,
      }
    }

    switch (body?.action) {
      case 'contexto': {
        const usuarios = (await usuariosPanel()).map((u: any) => ({ id: u.id, nombre: u.nombre, rol: u.rol }))
        let pendientes: number | null = null
        if (puedeAprobar) {
          const c = await admin.from(TABLA).select('id', { count: 'exact', head: true }).eq('estado_aprobacion', 'Por aprobar')
          if (c.error) throw c.error
          pendientes = c.count ?? 0
        }
        return json(200, {
          ok: true,
          yo: { id: user.id, nombre: nombreUsuario, rol: perfil.rol, email: perfil.email },
          empresas,
          empresas_extra: EMPRESAS_EXTRA,
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
          ...columnasDe(v),
          fecha_radicacion: hoyBogota(),
          historial: [{ tipo: 'envio', por: nombreUsuario, en: ahora }],
        }).select('*').single()
        if (ins.error) {
          if ((ins.error as any).code === '23505') {
            const dup = await filaPorId(requestId)
            if (dup && dup.creado_por === user.id) return json(200, { ok: true, duplicada: true, solicitud: mapFila(dup, null) })
          }
          throw ins.error
        }

        const { actual, aviso } = await resolverEnvio(ins.data)
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
          ...columnasDe(v),
          // Reenviar tras un rechazo es radicar de nuevo: la política de 15 días cuenta desde hoy.
          fecha_radicacion: hoyBogota(),
          estado_aprobacion: 'Por aprobar',
          motivo_rechazo: null,
          aprobada_por: null,
          aprobada_por_nombre: null,
          fecha_aprobacion: null,
          auto_aprobada: false,
          // Si la había rechazado Mercadeo, el evento viejo queda atrás: al aprobarse de nuevo se crea uno nuevo.
          rechazada_por_mercadeo: false,
          pqrs_evento_id: null,
          reenvios: (r.reenvios || 0) + 1,
          modificado_en: ahora,
          historial: [...(r.historial || []), { tipo: 'reenvio', por: nombreUsuario, en: ahora }],
        }).eq('id', requestId).eq('estado_aprobacion', 'Rechazada').select('*').maybeSingle()
        if (upd.error) throw upd.error
        if (!upd.data) throw new Rechazo('La solicitud ya no está rechazada')

        const { actual, aviso } = await resolverEnvio(upd.data)
        return json(200, { ok: true, solicitud: mapFila(actual, null), aviso })
      }

      case 'editar': {
        exigirEnviar()
        const requestId = uuid(body.request_id, 'request_id')
        const r = await filaPorId(requestId)
        if (!r || r.creado_por !== user.id) throw new Rechazo('Solicitud no encontrada', 404)
        const previo = r.estado_aprobacion
        if (!['Por aprobar', 'Rechazada', 'Aprobada'].includes(previo)) {
          throw new Rechazo('Esta solicitud ya no se puede modificar', 409)
        }
        if (previo === 'Aprobada' && r.rechazada_por_mercadeo) {
          throw new Rechazo('Esta solicitud ya no se puede modificar', 409)
        }

        const v = await validarFormulario(requestId)
        const ahora = new Date().toISOString()
        const historial = [...(r.historial || [])]

        if (previo === 'Aprobada') {
          // Primero sale el evento de Mercadeo: si Mercadeo ya lo aprobó, esto falla (409) y no se toca nada.
          // Es idempotente: si ya no hay evento vigente, sigue.
          await puente({
            action: 'retirar',
            request_id: r.id,
            por: { id: user.id, nombre: nombreUsuario },
            motivo: `Retirada por el solicitante: ${nombreUsuario} modificó la solicitud ${refSE(r.numero)}; vuelve a aprobación y llegará de nuevo cuando se apruebe.`,
          })
          historial.push({ tipo: 'retiro_mercadeo', por: nombreUsuario, en: ahora })
        }
        historial.push({ tipo: previo === 'Rechazada' ? 'reenvio' : 'edicion', por: nombreUsuario, en: ahora })

        const cambios: Record<string, unknown> = { ...columnasDe(v), modificado_en: ahora, historial }
        if (previo === 'Rechazada') cambios.fecha_radicacion = hoyBogota()   // reenviar tras un rechazo = radicar de nuevo
        if (previo !== 'Por aprobar') {
          // Vuelve a aprobación. El evento viejo (si lo había) ya salió de Mercadeo: al aprobarse de nuevo
          // se crea uno nuevo y pqrs_evento_id se vuelve a fijar entonces.
          Object.assign(cambios, {
            estado_aprobacion: 'Por aprobar',
            motivo_rechazo: null,
            aprobada_por: null,
            aprobada_por_nombre: null,
            fecha_aprobacion: null,
            auto_aprobada: false,
            rechazada_por_mercadeo: false,
            pqrs_evento_id: null,
            reenvios: (r.reenvios || 0) + 1,
          })
        }
        // Solo si nada cambió desde que se leyó (un aprobador pudo resolverla en medio).
        let q = admin.from(TABLA).update(cambios).eq('id', requestId).eq('estado_aprobacion', previo)
        if (previo === 'Por aprobar') q = q.eq('modificado_en', r.modificado_en)
        const upd = await q.select('*').maybeSingle()
        if (upd.error) throw upd.error
        if (!upd.data) throw new Rechazo('La solicitud cambió mientras la editabas; recárgala e inténtalo de nuevo', 409)

        const { actual, aviso } = await resolverEnvio(upd.data, previo !== 'Rechazada')
        return json(200, { ok: true, solicitud: mapFila(actual, null), aviso, retirada: previo === 'Aprobada' })
      }

      case 'listar': {
        // Siempre por el id del JWT verificado: el navegador no puede pedir las de otra persona.
        const t = await admin.from(TABLA).select('*')
          .or(`creado_por.eq.${user.id},a_nombre_de_id.eq.${user.id}`)
          .order('numero', { ascending: false })
          .limit(200)
        if (t.error) throw t.error
        const filas = t.data || []

        // Estado en Mercadeo de las ya aprobadas. Si pqrs no responde, se muestran igual las demás.
        // La rechazada por Mercadeo ya no tiene evento vigente: no se consulta.
        const enMercadeo = (f: any) => f.pqrs_evento_id && !f.rechazada_por_mercadeo
        const porEvento = new Map<number, any>()
        let mercadeoDisponible = true
        if (filas.some(enMercadeo)) {
          try {
            const r = await puente({ action: 'listar', solicitante: { id: user.id } })
            for (const s of r.eventos || []) porEvento.set(Number(s.id), s)
          } catch (e) {
            mercadeoDisponible = false
            console.error('solicitud-evento: no se pudo leer Mercadeo:', (e as Error)?.message)
          }
        }
        return json(200, {
          ok: true,
          mercadeo_disponible: mercadeoDisponible,
          solicitudes: filas.map((f: any) => mapFila(f, enMercadeo(f) ? porEvento.get(Number(f.pqrs_evento_id)) || null : null)),
        })
      }

      case 'pendientes': {
        exigirAprobador()
        const t = await admin.from(TABLA).select('*').eq('estado_aprobacion', 'Por aprobar')
          .order('numero', { ascending: true }).limit(200)
        if (t.error) throw t.error
        return json(200, { ok: true, solicitudes: (t.data || []).map((f: any) => mapFila(f, null)) })
      }

      case 'aprobadas': {
        // Vista de aprobadores: las ya aprobadas que siguen con Mercadeo (para dejarle observaciones).
        exigirAprobador()
        const t = await admin.from(TABLA).select('*').eq('estado_aprobacion', 'Aprobada')
          .order('numero', { ascending: false }).limit(200)
        if (t.error) throw t.error
        const filas = (t.data || []).filter((f: any) => f.pqrs_evento_id && !f.rechazada_por_mercadeo)
        if (!filas.length) return json(200, { ok: true, mercadeo_disponible: true, solicitudes: [] })

        const porEvento = new Map<number, any>()
        let mercadeoDisponible = true
        try {
          const r = await puente({ action: 'listar', request_ids: filas.map((f: any) => f.id) })
          for (const s of r.eventos || []) porEvento.set(Number(s.id), s)
        } catch (e) {
          mercadeoDisponible = false
          console.error('solicitud-evento: no se pudo leer Mercadeo:', (e as Error)?.message)
        }
        // Solo las que siguen abiertas en Mercadeo; si no se pudo leer se muestran todas (sin estado) y `observar` lo vuelve a comprobar.
        const vigentes = filas
          .map((f: any) => ({ f, pq: porEvento.get(Number(f.pqrs_evento_id)) || null }))
          .filter((x: any) => !mercadeoDisponible || (x.pq && EST_ABIERTOS.includes(x.pq.estado)))
        return json(200, {
          ok: true,
          mercadeo_disponible: mercadeoDisponible,
          solicitudes: vigentes.map((x: any) => mapFila(x.f, x.pq)),
        })
      }

      case 'observar': {
        // El solicitante, a nombre de quién se hizo o un aprobador le deja una observación a Mercadeo.
        const id = uuid(body.id, 'id')
        const r = await filaPorId(id)
        if (!r) throw new Rechazo('Solicitud no encontrada', 404)
        const esParte = r.creado_por === user.id || r.a_nombre_de_id === user.id
        if (!esParte && !puedeAprobar) throw new Rechazo('No tienes permiso para escribirle a Mercadeo sobre esta solicitud', 403)
        if (r.estado_aprobacion !== 'Aprobada' || !r.pqrs_evento_id) {
          throw new Rechazo('Solo puedes dejar observaciones en una solicitud que está con Mercadeo', 409)
        }
        // Se conservan los saltos de línea, pero no los espacios ni las líneas en blanco de sobra.
        const obs = typeof body.texto === 'string'
          ? body.texto.replace(/[ \t]+/g, ' ').replace(/ ?\r?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
          : ''
        if (obs.length < 5) throw new Rechazo('Escribe la observación (mínimo 5 caracteres)')
        if (obs.length > 1000) throw new Rechazo('La observación no puede superar 1000 caracteres')
        await puente({
          action: 'observar',
          request_id: r.id,
          evento_id: r.pqrs_evento_id,
          como: esParte ? 'solicitante' : 'aprobador',
          por: { id: user.id, nombre: nombreUsuario },
          texto: obs,
        })
        return json(200, { ok: true })
      }

      case 'aprobar': {
        exigirAprobador()
        const id = uuid(body.id, 'id')
        const r = await filaPorId(id)
        if (!r) throw new Rechazo('Solicitud no encontrada', 404)
        if (r.estado_aprobacion !== 'Por aprobar') {
          throw new Rechazo(`Esta solicitud ya fue ${r.estado_aprobacion === 'Aprobada' ? 'aprobada' : 'rechazada'}`, 409)
        }
        if (r.fecha_evento < hoyBogota()) {
          throw new Rechazo(`La fecha del evento (${fechaCorta(r.fecha_evento)}) ya pasó; rechaza la solicitud para que el solicitante la corrija`, 409)
        }
        // Primero se crea en Mercadeo (idempotente); si falla, la solicitud sigue 'Por aprobar'.
        const t = await enviarAMercadeo(r, nombreUsuario)
        const m = await marcarAprobada(r, t.id, false)
        if (!m) {
          const ya = await filaPorId(id)
          if (ya && ya.estado_aprobacion === 'Aprobada') return json(200, { ok: true, duplicada: true, solicitud: mapFila(ya, null) })
          if (ya && ya.estado_aprobacion === 'Por aprobar') {
            // El solicitante la modificó mientras se aprobaba: el evento recién creado tiene datos viejos.
            // Se retira (mejor esfuerzo) y se vuelve a revisar con lo nuevo.
            try {
              await puente({
                action: 'retirar',
                request_id: id,
                por: { id: user.id, nombre: nombreUsuario },
                motivo: 'La solicitud cambió mientras se aprobaba; se aprobará de nuevo con los datos nuevos.',
              })
            } catch (e) {
              console.error('solicitud-evento: no se pudo retirar el evento desactualizado:', (e as Error)?.message)
            }
            throw new Rechazo('El solicitante modificó la solicitud mientras la aprobabas; revísala de nuevo', 409)
          }
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
        }).eq('id', id).eq('estado_aprobacion', 'Por aprobar').eq('modificado_en', r.modificado_en).select('*').maybeSingle()
        if (u.error) throw u.error
        if (!u.data) throw new Rechazo('La solicitud cambió (el solicitante pudo modificarla); recarga la lista', 409)
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
    console.error('solicitud-evento error:', (e as Error)?.message, e)
    return json(500, { ok: false, error: 'Error interno al procesar la solicitud' })
  }
})
