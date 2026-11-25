// vencimientos-vehiculos-aviso
//
// Avisa por WhatsApp (al grupo) los documentos de vehículos vencidos o por vencer
// (módulo «🚗 Vencimientos de Vehículos», tablas VehiculosVencimientos*).
//
// Quién la llama y qué hace:
//   1. pg_cron, una vez al día (supabase/vencimientos_vehiculos_cron.sql), con
//      `Authorization: Bearer <secreto del cron>` (vive solo en Vault, en la base; lo valida la función SQL
//      vv_token_cron_valido, así no hay que copiarlo a ningún otro sitio)  ->  envía solo lo NUEVO (escalones 30/15/7/3/0 días y,
//      ya vencido, recordatorio cada 7 días) y lo marca como avisado (vv_pendientes('nuevos') + vv_marcar).
//   2. El navegador (botón «Enviar aviso ahora» y su vista previa) con la sesión del usuario
//      (JWT). Exige rol distinto de lector + módulos `vehiculos_vencimientos` y
//      `vehiculos_vencimientos_editar` (el administrador pasa siempre).
//        { action: 'vista_previa' } -> devuelve el texto que se enviaría (no envía nada)
//        { action: 'enviar' }       -> envía el resumen COMPLETO (todo lo vencido o que vence en ≤ 30 días,
//                                       vv_pendientes('todos')); NO cambia las marcas de escalón.
//   Cada envío (correcto o fallido) queda en VehiculosVencimientosAvisos. Nada se marca si el envío falla:
//   el cron reintenta al día siguiente.
//
// Desplegar SIN verificación de JWT del gateway (el cron no manda un JWT; la función verifica ella misma
// el secreto o la sesión):  supabase functions deploy vencimientos-vehiculos-aviso --no-verify-jwt
//
// Secretos de la función (Dashboard > Edge Functions > Secrets, o `supabase secrets set ...`):
//   WA_PROVIDER   whapi | waha | evolution                 (por defecto: whapi)
//   WA_TOKEN      token / API key de la pasarela
//   WA_GROUP_ID   id del grupo, p. ej. 120363194020948049@g.us
//   WA_URL        solo waha / evolution: URL pública del servidor, sin «/» final
//   WA_SESSION    waha: sesión (por defecto «default») · evolution: nombre de la instancia
//
// La pasarela es no oficial (ver README del módulo en CLAUDE.md): use un número dedicado.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://logisticatecbihol.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODULO_VER = 'vehiculos_vencimientos'
const MODULO_EDITAR = 'vehiculos_vencimientos_editar'

type Pendiente = {
  doc_id: number
  vehiculo_id: number
  placa: string
  propietario: string | null
  documento: string
  fecha_vencimiento: string // YYYY-MM-DD
  dias: number
  umbral: number
}

const env = (k: string) => Deno.env.get(k) ?? ''

const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

const NOMBRE_DOC: Record<string, string> = {
  SOAT: 'SOAT',
  TECNOMECANICA: 'Técnico-mecánica',
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// ¿El token es el secreto del cron? Se compara dentro de la base contra Vault (vv_token_cron_valido, solo service_role).
async function tokenEsDelCron(token: string): Promise<boolean> {
  const { data, error } = await sb.rpc('vv_token_cron_valido', { p_token: token })
  return !error && data === true
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function linea(p: Pendiente): string {
  const doc = NOMBRE_DOC[p.documento] ?? p.documento
  const cuando = p.dias < 0
    ? `venció el ${fmt(p.fecha_vencimiento)} (hace ${-p.dias} d)`
    : p.dias === 0
    ? 'vence HOY'
    : `vence el ${fmt(p.fecha_vencimiento)} (en ${p.dias} d)`
  const dueno = p.propietario && p.propietario.trim() ? `\n    ${p.propietario.trim()}` : ''
  return `• *${p.placa}* – ${doc}: ${cuando}${dueno}`
}

export function armarMensaje(items: Pendiente[], ahora = new Date()): string {
  const hoy = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ahora)

  const grupos: [string, Pendiente[]][] = [
    ['🔴 *VENCIDOS*', items.filter((p) => p.dias < 0)],
    ['🟠 *Vencen en 7 días o menos*', items.filter((p) => p.dias >= 0 && p.dias <= 7)],
    ['🟡 *Vencen en los próximos 30 días*', items.filter((p) => p.dias > 7)],
  ]
  const cuerpo = grupos
    .filter(([, lista]) => lista.length > 0)
    .map(([titulo, lista]) => `${titulo}\n${lista.map(linea).join('\n')}`)
    .join('\n\n')

  return `🚗 *Vencimientos de vehículos* – ${hoy}\n\n${cuerpo}`
}

// Envía el texto al grupo con la pasarela configurada. Lanza Error si algo falla.
async function enviarWhatsApp(texto: string): Promise<void> {
  const proveedor = env('WA_PROVIDER') || 'whapi'
  const token = env('WA_TOKEN')
  const grupo = env('WA_GROUP_ID')
  if (!token || !grupo) throw new Error('Falta configurar WA_TOKEN y/o WA_GROUP_ID en los secretos de la función')

  let res: Response
  const senal = AbortSignal.timeout(20000)
  if (proveedor === 'whapi') {
    res = await fetch('https://gate.whapi.cloud/messages/text', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: grupo, body: texto }),
      signal: senal,
    })
  } else if (proveedor === 'waha') {
    res = await fetch(`${env('WA_URL')}/api/sendText`, {
      method: 'POST',
      headers: { 'X-Api-Key': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: env('WA_SESSION') || 'default', chatId: grupo, text: texto }),
      signal: senal,
    })
  } else if (proveedor === 'evolution') {
    res = await fetch(`${env('WA_URL')}/message/sendText/${env('WA_SESSION')}`, {
      method: 'POST',
      headers: { apikey: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: grupo, text: texto }),
      signal: senal,
    })
  } else {
    throw new Error(`WA_PROVIDER desconocido: ${proveedor}`)
  }
  if (!res.ok) {
    const detalle = (await res.text()).slice(0, 300)
    throw new Error(`${proveedor} respondió ${res.status}: ${detalle}`)
  }
}

// Usuario del navegador con permiso para enviar (rol != lector + ver + editar; admin siempre).
async function usuarioConPermiso(token: string): Promise<{ id: string; nombre: string } | null> {
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data?.user) return null
  const uid = data.user.id
  const [u, m] = await Promise.all([
    sb.from('usuarios').select('rol, activo, nombre').eq('id', uid).maybeSingle(),
    sb.from('usuario_modulos').select('modulo').eq('usuario_id', uid).in('modulo', [MODULO_VER, MODULO_EDITAR]),
  ])
  const fila = u.data
  if (!fila || !fila.activo || fila.rol === 'lector') return null
  const modulos = new Set((m.data ?? []).map((x: { modulo: string }) => x.modulo))
  if (fila.rol !== 'admin' && !(modulos.has(MODULO_VER) && modulos.has(MODULO_EDITAR))) return null
  return { id: uid, nombre: fila.nombre ?? '' }
}

async function registrar(
  origen: 'automatico' | 'manual',
  estado: 'enviado' | 'error',
  documentos: number,
  mensaje: string,
  error: string | null,
  usuario: { id: string; nombre: string } | null,
): Promise<void> {
  const { error: e } = await sb.from('VehiculosVencimientosAvisos').insert({
    Origen: origen,
    Estado: estado,
    Documentos: documentos,
    Mensaje: mensaje,
    Error: error,
    Enviado_Por: usuario?.id ?? null,
    Enviado_Por_Nombre: usuario?.nombre ?? null,
  })
  if (e) console.error('No se pudo registrar el aviso:', e.message)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'No autorizado' }, 401)

  // ¿Es el cron (secreto de Vault) o una persona (sesión)?
  const esCron = await tokenEsDelCron(token)
  let usuario: { id: string; nombre: string } | null = null
  let accion = 'enviar'
  if (!esCron) {
    usuario = await usuarioConPermiso(token)
    if (!usuario) return json({ error: 'No autorizado' }, 403)
    let cuerpo: { action?: string } = {}
    try { cuerpo = await req.json() } catch { /* sin cuerpo */ }
    accion = cuerpo.action === 'vista_previa' ? 'vista_previa' : cuerpo.action === 'enviar' ? 'enviar' : ''
    if (!accion) return json({ error: 'Acción no válida' }, 400)
  }

  const origen = esCron ? 'automatico' : 'manual'
  const { data, error } = await sb.rpc('vv_pendientes', { p_modo: esCron ? 'nuevos' : 'todos' })
  if (error) return json({ error: error.message }, 500)
  const items = (data ?? []) as Pendiente[]

  if (items.length === 0) {
    return json({ enviado: false, documentos: 0, texto: '', motivo: 'No hay documentos vencidos ni por vencer en los próximos 30 días' })
  }

  const texto = armarMensaje(items)
  if (accion === 'vista_previa') return json({ enviado: false, documentos: items.length, texto })

  try {
    await enviarWhatsApp(texto)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await registrar(origen, 'error', items.length, texto, msg, usuario)
    return json({ enviado: false, error: msg }, 502)
  }

  await registrar(origen, 'enviado', items.length, texto, null, usuario)

  // Solo el cron marca escalones: «Enviar aviso ahora» manda el resumen completo sin tocarlos.
  if (esCron) {
    const { error: errMarcar } = await sb.rpc('vv_marcar', { p_ids: items.map((i) => i.doc_id) })
    if (errMarcar) return json({ enviado: true, documentos: items.length, advertencia: `No se pudo marcar: ${errMarcar.message}` }, 500)
  }
  return json({ enviado: true, documentos: items.length })
})
