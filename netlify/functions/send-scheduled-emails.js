import { processScheduledEmails } from './process-scheduled-emails.js'
import { authorizeNativeScheduledRequest } from './lib/_processor-auth.js'

export const config = {
  schedule: '* * * * *',
}

export default async function handler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)

  if (!authorization.ok) {
    return authorization.response
  }

  const result = await processScheduledEmails()

  return Response.json(result.payload, { status: result.statusCode })
}
