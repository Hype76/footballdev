import process from 'node:process'
import { Resend } from 'resend'

const CONTACT_REQUEST_RECIPIENT = 'sales@playerfeedback.online'

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function buildContactRequestHtml({ name, email, phone, message, sourcePath }) {
  const rows = [
    ['Name', name],
    ['Email', email],
    ['Phone number', phone || 'Not provided'],
    ['Page', sourcePath || 'Not recorded'],
  ]

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 18px; overflow: hidden;">
        <div style="background: #101510; color: #ffffff; padding: 24px;">
          <p style="margin: 0 0 8px; color: #d8ff2f; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">Football Player</p>
          <h1 style="margin: 0; font-size: 24px;">New contact request</h1>
        </div>
        <div style="padding: 24px; background: #ffffff;">
          <p style="margin: 0 0 18px;">A visitor sent a message from the Football Player website.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${rows
                .map(
                  ([label, value]) => `
                    <tr>
                      <td style="width: 180px; padding: 12px; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-weight: 700;">${escapeHtml(label)}</td>
                      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(value)}</td>
                    </tr>
                  `,
                )
                .join('')}
            </tbody>
          </table>
          <div style="margin-top: 20px;">
            <p style="margin: 0 0 8px; color: #4b5563; font-size: 14px; font-weight: 700;">Message</p>
            <div style="white-space: pre-line; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px;">${escapeHtml(message || 'No message entered')}</div>
          </div>
          <p style="margin: 20px 0 0; color: #4b5563; font-size: 14px;">Reply directly to this email to contact the visitor.</p>
          <div style="border-top: 1px solid #e5e7eb; margin-top: 20px; padding-top: 14px;">
            <p style="margin: 0; color: #6b7280; font-size: 11px; line-height: 1.45;">Powered by Football Player | footballplayer.online</p>
          </div>
        </div>
      </div>
    </div>
  `
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  if (!process.env.RESEND_API_KEY) {
    return failureResponse(500, 'Email service is not configured')
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

    const resend = new Resend(process.env.RESEND_API_KEY)
    const html = buildContactRequestHtml({
      name,
      email,
      phone,
      message,
      sourcePath,
    })

    const response = await resend.emails.send({
      from: 'Football Player Contact <feedback@footballplayer.online>',
      to: [CONTACT_REQUEST_RECIPIENT],
      reply_to: email,
      subject: `Website Contact: ${name}`,
      html,
    })

    return successResponse({ id: response?.data?.id || response?.id || '' })
  } catch (error) {
    console.error(error)
    return failureResponse(500, 'Contact request could not be sent')
  }
}
