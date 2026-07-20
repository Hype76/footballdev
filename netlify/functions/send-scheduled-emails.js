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
