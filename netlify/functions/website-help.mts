import process from 'node:process'
import { prepareWebsiteHelp, selectWebsiteHelp } from './lib/_website-help.js'
import { websiteHelpFallback } from '../../src/lib/website-help-library.js'

function reply(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}

export default async function websiteHelp(request: Request) {
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) return reply({ error: 'Request not allowed.' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Use JSON.' }, 415)
  if (process.env.FOOTBALL_HELP_DISABLED === 'true') return reply({ ...websiteHelpFallback, unavailable: true })
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 4096) return reply({ error: 'Please keep your question short.' }, 413)
    const body = JSON.parse(raw)
    if (!body || typeof body.message !== 'string' || Object.keys(body).some((key) => key !== 'message') || !body.message.trim() || body.message.length > 600) {
      return reply({ error: 'Ask one question of up to 600 characters.' }, 400)
    }
    const prepared = prepareWebsiteHelp(body.message)
    if (prepared.reply) return reply(prepared.reply)
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return reply({ ...websiteHelpFallback, unavailable: true })
    try {
      return reply(await selectWebsiteHelp(prepared.topics, { apiKey }))
    } catch {
      // Do not log raw questions, provider errors or secrets.
      return reply({ ...websiteHelpFallback, unavailable: true })
    }
  } catch {
    return reply({ error: 'Please send a valid question.' }, 400)
  }
}

export const config = {
  path: '/api/website-help',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
