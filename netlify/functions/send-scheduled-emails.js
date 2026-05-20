import { handler as processScheduledEmails } from './process-scheduled-emails.js'

export const config = {
  schedule: '* * * * *',
}

export default async function handler() {
  const result = await processScheduledEmails({ httpMethod: 'POST' })

  return new Response(result.body, {
    status: result.statusCode,
    headers: result.headers,
  })
}
