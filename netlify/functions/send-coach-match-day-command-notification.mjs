import { supabaseAdmin } from './lib/_supabase.js'
import { deliverCoachMatchDayCommands } from './lib/_coach-match-day-command-notifications.js'

export default async request => {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '')
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return new Response('Login is required.', { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.commandId || '')) return new Response('A saved command is required.', { status: 400 })
  try {
    return Response.json(await deliverCoachMatchDayCommands(body.commandId, data.user.id))
  } catch { return Response.json({ message: 'Match saved. Notification delivery will be retried.' }, { status: 503 }) }
}
