import { createSupabaseAdminClient } from './lib/_supabase.js'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { coachReferral } from './lib/_coach-referral.js'

export default async (request: Request) => {
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  if (request.method !== 'POST') return reply(405, { message: 'Method not allowed.' })
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return reply(401, { message: 'Sign in to invite your Coach.' })
    const raw = await request.text()
    if (raw.length > 4096) return reply(413, { message: 'Your message is too long.' })
    let body
    try { body = JSON.parse(raw) } catch { return reply(400, { message: 'Enter your Coach details again.' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { message: 'Enter your Coach details again.' })
    const db = createSupabaseAdminClient({ headers: Object.fromEntries(request.headers) })
    const auth = await db.auth.getUser(token)
    if (auth.error || !auth.data?.user) return reply(401, { message: 'Sign in again to invite your Coach.' })
    return reply(200, await coachReferral({ db, user: auth.data.user, body, send: sendEmail, from: createFromAddress('Football Player') }))
  } catch (error: any) {
    return reply(error.statusCode || 502, { message: error.publicMessage || (error.statusCode ? error.message : 'Your invitation could not be sent. Please try again.') })
  }
}
