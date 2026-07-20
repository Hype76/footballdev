import { processScheduledEmails } from './process-scheduled-emails.js'

export const config = {
  schedule: '* * * * *',
}

async function logScheduleRequestShape(request, context) {
  let bodyKeys = []

  try {
    const body = await request.clone().json()
    bodyKeys = body && typeof body === 'object' ? Object.keys(body).sort() : []
  } catch {
    bodyKeys = []
  }

  console.info('Scheduled request shape', {
    bodyKeys,
    contextKeys: context && typeof context === 'object' ? Object.keys(context).sort() : [],
    method: request.method,
    netlifyHeaderNames: [...request.headers.keys()]
      .filter((name) => name.startsWith('x-nf-') || name.startsWith('x-netlify-'))
      .sort(),
  })
}

export default async function handler(request, context) {
  await logScheduleRequestShape(request, context)
  const result = await processScheduledEmails()

  return Response.json(result.payload, { status: result.statusCode })
}
