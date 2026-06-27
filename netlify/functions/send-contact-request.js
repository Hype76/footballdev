import { getPublicEmailErrorMessage } from './_email-provider.js'
import { sendSupportNotification } from './_support-notification.js'

const SUPPORT_REFERENCE = 'FPO-V1-SUPPORT-EMAIL-AUDIT-013'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function successResponse(payload = {}) {
  return jsonResponse(200, { success: true, ...payload })
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/[<>{}[\]`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const name = cleanText(body.name)
    const email = cleanText(body.email).toLowerCase()
    const phone = cleanText(body.phone)
    const message = cleanText(body.message)
    const sourcePath = cleanText(body.sourcePath)

    if (!name) {
      return failureResponse(400, 'Name is required')
    }

    if (!email || !isValidEmail(email)) {
      return failureResponse(400, 'A valid email is required')
    }

    const response = await sendSupportNotification({
      source: 'public_contact_request',
      reportId: SUPPORT_REFERENCE,
      type: 'contact',
      severity: 'medium',
      title: `Website contact: ${name}`,
      summary: message || 'No message entered.',
      route: sourcePath,
      pageTitle: 'Contact us',
      module: 'Public website',
      phase: 'production',
      reporterName: name,
      reporterEmail: email,
      browserDevice: phone ? `Phone: ${phone}` : '',
      adminReviewUrl: 'https://footballplayer.online',
    })

    return successResponse({ id: response?.data?.id || response?.id || '' })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, getPublicEmailErrorMessage(error, 'Contact request could not be sent. Please try again in a moment.'))
  }
}
