import { json } from './lib/_stripe-billing.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  return json(410, {
    success: false,
    message: 'V1 staging tester signup has been retired.',
  })
}
