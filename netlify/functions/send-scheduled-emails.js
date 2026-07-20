import { processScheduledEmails } from './process-scheduled-emails.js'

export const config = {
  schedule: '* * * * *',
}

export default async function handler() {
  const result = await processScheduledEmails()

  return Response.json(result.payload, { status: result.statusCode })
}
