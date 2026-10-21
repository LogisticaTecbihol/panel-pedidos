// solicitud-evento-aviso
//
// Recibe los avisos que manda el módulo de Eventos de Mercadeo (panel-pqrs) cuando el equipo de Mercadeo
// hace algo con una solicitud de evento que viene de aquí, y se los deja al solicitante en la campanita.
// La llama la función `notificar-evento-solicitante` del proyecto de pqrs (server -> server) con el
// secreto compartido; NO es para el navegador (verify_jwt = false, sin CORS).
//
// Eventos (campo `evento`):
//   estado    -> el evento cambió de estado en Mercadeo (En revisión, Aprobada, En preparación, Realizada,
//                Cerrada o Cancelada; la cancelación trae su motivo)
//   respuesta -> Mercadeo le escribió una respuesta al solicitante
//   rechazo   -> Mercadeo rechazó la solicitud (motivo obligatorio). La solicitud vuelve a 'Rechazada'
//                (rechazada_por_mercadeo = true) para que el solicitante la corrija y la reenvíe a aprobación.
//
// El número visible (SE-n) y los destinatarios salen de la BD (por request_id), nunca del cuerpo de la
// petición. Destinatarios: quien hizo la solicitud y, si existe, a nombre de quién.
//
// Secreto de ESTE proyecto: PQRS_BRIDGE_SECRET (el mismo que usa `solicitud-mercadeo-aviso`; igual a
// PEDIDOS_BRIDGE_SECRET en pqrs). Desplegar con verify_jwt = false.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TABLA = 'solicitudes_eventos'
const EVENTOS = ['estado', 'respuesta', 'rechazo']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Estados del evento tal como los ve el solicitante.
const ESTADO_ETIQUETA: Record<string, string> = {
  en_revision: 'En revisión',
  aprobada: 'Aprobada por Mercadeo',
  en_preparacion: 'En preparación',
  realizada: 'Realizada',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada',
}
const ESTADO_ICONO: Record<string, string> = {
  en_revision: '🔍', aprobada: '✅', en_preparacion: '🛠️', realizada: '🎉', cerrada: '🔒', cancelada: '🚫',
}

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
    headers: { 'Content-Type': 'application/json' },
  })
}

// Comparación en tiempo constante (no revela cuántos caracteres del secreto coinciden).
function iguales(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let d = ea.length ^ eb.length
  const n = Math.max(ea.length, eb.length)
  for (let i = 0; i < n; i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return d === 0
}

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Método no permitido' })

  try {
    const secret = Deno.env.get('PQRS_BRIDGE_SECRET') ?? ''
    if (secret.length < 32) throw new Rechazo('El aviso desde Mercadeo no está configurado', 503)
    const dado = req.headers.get('x-bridge-secret') ?? ''
    if (!iguales(dado, secret)) throw new Rechazo('No autorizado', 401)

    const body = await req.json()
    const evento = body?.evento
    if (!EVENTOS.includes(evento)) throw new Rechazo('evento inválido')
    const requestId = typeof body?.request_id === 'string' ? body.request_id : ''
    if (!UUID_RE.test(requestId)) throw new Rechazo('request_id inválido')
    const eventoId = body?.evento_id == null ? null : Number(body.evento_id)
    if (eventoId !== null && (!Number.isInteger(eventoId) || eventoId < 1)) throw new Rechazo('evento_id inválido')

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const f = await admin.from(TABLA).select('*').eq('id', requestId.toLowerCase()).maybeSingle()
    if (f.error) throw f.error
    if (!f.data) throw new Rechazo('Solicitud no encontrada', 404)
    const r = f.data
    const ref = `SE-${r.numero}`
    const por = texto(body?.por, 120)

    // Aviso in-app a quien la hizo y a nombre de quién. Notificación del sistema (sin emisor).
    // Usa el módulo 'solicitudes_mercadeo' (el mismo permiso); la referencia SE-n lleva a solicitudes-eventos.html.
    async function avisar(titulo: string, mensaje: string): Promise<number> {
      const ids = [...new Set([r.creado_por, r.a_nombre_de_id].filter(Boolean))] as string[]
      if (!ids.length) return 0
      const ins = await admin.from('notificaciones').insert(ids.map((id) => ({
        para_usuario_id: id,
        de_usuario_id: null,
        modulo: 'solicitudes_mercadeo',
        referencia: ref,
        titulo,
        mensaje,
        storage_path: null,
      })))
      if (ins.error) throw ins.error
      return ids.length
    }

    // Un aviso de un evento que ya no es el vigente de la solicitud (p. ej. el rechazado y luego
    // reenviado) no se entrega: sería ruido.
    const esVigente = eventoId === null || (r.pqrs_evento_id != null && Number(r.pqrs_evento_id) === eventoId)

    if (evento === 'rechazo') {
      const motivo = texto(body?.motivo, 500)
      if (motivo.length < 3) throw new Rechazo('Falta el motivo del rechazo')
      if (r.estado_aprobacion === 'Rechazada' && r.rechazada_por_mercadeo) {
        return json(200, { ok: true, duplicado: true, avisados: 0 })
      }
      if (r.estado_aprobacion !== 'Aprobada' || !esVigente) return json(200, { ok: true, omitido: true, avisados: 0 })

      const ahora = new Date().toISOString()
      const nombre = por || 'Mercadeo'
      const u = await admin.from(TABLA).update({
        estado_aprobacion: 'Rechazada',
        motivo_rechazo: motivo,
        aprobada_por: null,
        aprobada_por_nombre: nombre,
        fecha_aprobacion: ahora,
        auto_aprobada: false,
        rechazada_por_mercadeo: true,
        modificado_en: ahora,
        historial: [...(r.historial || []), { tipo: 'rechazo_mercadeo', por: nombre, en: ahora, motivo }],
      }).eq('id', r.id).eq('estado_aprobacion', 'Aprobada').select('id').maybeSingle()
      if (u.error) throw u.error
      if (!u.data) return json(200, { ok: true, duplicado: true, avisados: 0 })

      const n = await avisar(
        `❌ Solicitud de evento rechazada por Mercadeo: ${ref}`,
        `Motivo: ${motivo}. Puedes editarla y reenviarla.`,
      )
      return json(200, { ok: true, avisados: n })
    }

    // estado / respuesta: solo tiene sentido si la solicitud está aprobada (en Mercadeo).
    if (r.estado_aprobacion !== 'Aprobada' || !esVigente) return json(200, { ok: true, omitido: true, avisados: 0 })

    if (evento === 'estado') {
      const estado = typeof body?.estado === 'string' ? body.estado : ''
      const etiqueta = ESTADO_ETIQUETA[estado]
      if (!etiqueta) return json(200, { ok: true, omitido: true, avisados: 0 })
      const motivo = estado === 'cancelada' ? texto(body?.motivo, 300) : ''
      const n = await avisar(
        `${ESTADO_ICONO[estado] || '🔄'} Solicitud de evento ${ref}: ${etiqueta}`,
        `Mercadeo cambió el estado de tu solicitud a «${etiqueta}»${por ? ` (${por})` : ''}.${motivo ? ` Motivo: ${motivo}.` : ''}`,
      )
      return json(200, { ok: true, avisados: n })
    }

    // respuesta
    const msg = texto(body?.texto, 300)
    if (!msg) throw new Rechazo('Falta el texto de la respuesta')
    const n = await avisar(
      `💬 Mercadeo respondió tu solicitud de evento ${ref}`,
      `${por ? `${por}: ` : ''}${msg}`,
    )
    return json(200, { ok: true, avisados: n })
  } catch (e) {
    if (e instanceof Rechazo) return json(e.status, { ok: false, error: e.message })
    console.error('solicitud-evento-aviso error:', (e as Error)?.message, e)
    return json(500, { ok: false, error: 'Error interno' })
  }
})
