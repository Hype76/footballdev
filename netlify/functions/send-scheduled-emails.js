import { processScheduledEmails } from './process-scheduled-emails.js'
import { rejectDirectScheduledFunctionRequest } from './lib/_processor-auth.js'

export const config = {
  schedule: '* * * * *',
}

export async function handler(event = {}) {
  const rejectedResponse = rejectDirectScheduledFunctionRequest(event)

  if (rejectedResponse) {
    return rejectedResponse
  }

  const result = await processScheduledEmails()

  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.payload),
  }
}
