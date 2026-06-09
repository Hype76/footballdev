import { processScheduledEmails } from './process-scheduled-emails.js'

export const config = {
  schedule: '* * * * *',
}

export async function handler() {
  const result = await processScheduledEmails()

  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.payload),
  }
}

export default async function scheduledHandler() {
  const result = await handler()

  return new Response(result.body, {
    status: result.statusCode,
    headers: result.headers,
  })
}
