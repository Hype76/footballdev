import process from 'node:process'
import { Resend } from 'resend'
import { createSupabaseAdminClient } from './_supabase.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function buildResetEmail({ actionLink }) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;">
      <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">Football Player</p>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;">Reset your password</h1>
      <p style="margin:0 0 20px;color:#4b5f55;font-size:15px;line-height:1.6;font-weight:700;">Use this secure link to choose a new password.</p>
      <p style="margin:0 0 22px;">
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:12px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">Reset password</a>
      </p>
      <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">If you did not request this, ignore this email.</p>
    </div>
  `
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const email = normalizeEmail(body.email)
    const redirectTo = normalizeText(body.redirectTo)

    if (!isValidEmail(email)) {
      return jsonResponse(400, { success: false, message: 'Enter a valid email address.' })
    }

    if (!redirectTo || !/^https?:\/\//i.test(redirectTo)) {
      return jsonResponse(400, { success: false, message: 'Password reset redirect is not configured.' })
    }

    if (!process.env.RESEND_API_KEY) {
      return jsonResponse(500, { success: false, message: 'Password reset email is not configured.' })
    }

    const supabaseAdmin = createSupabaseAdminClient(event)
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo,
      },
    })

    if (error) {
      console.error(error)
      return jsonResponse(200, { success: true })
    }

    const actionLink = data?.properties?.action_link

    if (!actionLink) {
      return jsonResponse(500, { success: false, message: 'Password reset link could not be created.' })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const sendResult = await resend.emails.send({
      from: 'Football Player <feedback@footballplayer.online>',
      to: [email],
      subject: 'Reset your Football Player password',
      html: buildResetEmail({ actionLink }),
    })

    if (sendResult.error) {
      console.error(sendResult.error)
      return jsonResponse(502, { success: false, message: sendResult.error.message || 'Password reset email could not be sent.' })
    }

    return jsonResponse(200, { success: true })
  } catch (error) {
    console.error(error)
    return jsonResponse(500, { success: false, message: error.message || 'Password reset email could not be sent.' })
  }
}
