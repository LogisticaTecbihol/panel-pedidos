// solicitud-mercadeo
//
// Lado "Pedidos" del puente hacia el Tablero de Mercadeo de panel-pqrs (otro
// proyecto Supabase). El navegador llama a ESTA función con la sesión del usuario;
// aquí se verifica quién es, su permiso y sus empresas, y se reenvía a la función
// `solicitud-mercadeo-pedidos` del proyecto pqrs con un secreto compartido
// (server -> server). El navegador nunca habla con la función de pqrs.
//
// Acciones (campo `action`):
//   contexto -> datos para armar el formulario: empresas del usuario y comerciales
//   preparar -> URLs firmadas para subir adjuntos directo al Storage de pqrs
//   crear    -> registra la solicitud (queda "Recibido" en el Tablero)
//   listar   -> "Mis solicitudes": las que hizo el usuario o hechas a su nombre
//
// Secretos de ESTE proyecto (supabase secrets set ...):
//   PQRS_BRIDGE_URL    = https://kvfqcymeihglohkcckdp.supabase.co/functions/v1/solicitud-mercadeo-pedidos
//   PQRS_BRIDGE_SECRET = <el mismo valor que PEDIDOS_BRIDGE_SECRET en pqrs>
//
// Permiso: rol admin o módulo `solicitudes_mercadeo` en usuario_modulos.
// Desplegar con verify_jwt = true (igual que create-user).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://logisticatecbihol.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODULO = 'solicitudes_mercadeo'
const EMPRESAS_HOLDING = ['PARCELAR', 'GREEN', 'RESO', 'IASO', 'IAS']
const ASUNTOS = [
  'material_pop', 'material_impreso', 'piezas_graficas', 'piezas_audiovisuales',
  'diseno_nuevo_producto', 'diseno_ajuste_portafolios', 'diseno_ajuste_institucional',
  'desarrollo_marca', 'otros',
]
const MAX_ARCHIVOS = 5
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

    // Permiso del módulo (admin siempre)
    let permitido = perfil.rol === 'admin'
    if (!permitido) {
      const m = await admin.from('usuario_modulos').select('modulo').eq('usuario_id', user.id).eq('modulo', MODULO).maybeSingle()
      if (m.error) throw m.error
      permitido = !!m.data
    }
    if (!permitido) throw new Rechazo('No tienes permiso para enviar solicitudes a Mercadeo', 403)

    // Empresas del usuario (admin y cartera ven todas, como en auth.js)
    let empresas: string[]
    if (perfil.rol === 'admin' || perfil.rol === 'cartera') {
      empresas = [...EMPRESAS_HOLDING]
    } else {
      const e = await admin.from('usuario_empresas').select('empresa_sigla').eq('usuario_id', user.id)
      if (e.error) throw e.error
      empresas = (e.data || []).map((r: any) => r.empresa_sigla).filter((s: string) => EMPRESAS_HOLDING.includes(s))
    }

    const body = await req.json()

    // Comerciales activos (para "A nombre de"); nunca el propio usuario.
    async function comerciales() {
      const c = await admin.from('usuarios').select('id, nombre, email').eq('rol', 'comercial').eq('activo', true).order('nombre')
      if (c.error) throw c.error
      return (c.data || [])
        .filter((x: any) => x.id !== user.id)
        .map((x: any) => ({ id: x.id, nombre: (x.nombre || '').trim() || x.email }))
    }

    switch (body?.action) {
      case 'contexto': {
        return json(200, {
          ok: true,
          yo: { id: user.id, nombre: nombreUsuario, rol: perfil.rol },
          empresas,
          comerciales: await comerciales(),
        })
      }

      case 'preparar': {
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
        const requestId = uuid(body.request_id, 'request_id')
        if (!empresas.includes(body.empresa)) throw new Rechazo('La empresa elegida no está entre las tuyas')
        if (!ASUNTOS.includes(body.asunto)) throw new Rechazo('Elige un asunto de la lista')

        const fecha = body.fecha_tentativa
        if (typeof fecha !== 'string' || !FECHA_RE.test(fecha) || Number.isNaN(Date.parse(fecha + 'T00:00:00Z'))) {
          throw new Rechazo('La fecha tentativa no es válida')
        }
        if (fecha < hoyBogota()) throw new Rechazo('La fecha tentativa no puede ser anterior a hoy')

        const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : ''
        if (descripcion.length < 10) throw new Rechazo('La descripción debe tener al menos 10 caracteres')
        if (descripcion.length > 2000) throw new Rechazo('La descripción no puede superar 2000 caracteres')

        // "A nombre de": solo un comercial activo de la lista (el nombre sale de la BD, no del navegador).
        let aNombre: { id: string; nombre: string } | null = null
        if (body.a_nombre_de_id) {
          const id = uuid(body.a_nombre_de_id, 'a_nombre_de_id')
          if (id !== user.id) {
            aNombre = (await comerciales()).find((c: any) => c.id === id) || null
            if (!aNombre) throw new Rechazo('El comercial elegido no está disponible')
          }
        }

        const archivos = Array.isArray(body.archivos) ? body.archivos : []
        if (archivos.length > MAX_ARCHIVOS) throw new Rechazo(`Máximo ${MAX_ARCHIVOS} archivos por solicitud`)
        const carpeta = `solicitudes/${requestId}/`
        for (const a of archivos) {
          if (!a || typeof a.path !== 'string' || !a.path.startsWith(carpeta) || a.path.includes('..')) {
            throw new Rechazo('Ruta de archivo inválida')
          }
        }

        const r = await puente({
          action: 'crear',
          request_id: requestId,
          solicitante: { id: user.id, nombre: nombreUsuario, email: perfil.email, rol: perfil.rol },
          a_nombre_de: aNombre,
          empresa: body.empresa,
          asunto: body.asunto,
          fecha_tentativa: fecha,
          descripcion,
          archivos: archivos.map((a: any) => ({ path: a.path, nombre: a.nombre, tamano: a.tamano, tipo: a.tipo })),
        })
        return json(200, { ok: true, id: r.id, estado: r.estado, duplicada: !!r.duplicada })
      }

      case 'listar': {
        // Siempre por el id del JWT verificado: el navegador no puede pedir las de otra persona.
        const r = await puente({ action: 'listar', solicitante: { id: user.id } })
        return json(200, { ok: true, solicitudes: r.solicitudes || [] })
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
