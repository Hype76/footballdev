import { createFromAddress, getEmailProviderConfig, getPublicEmailErrorMessage, sendEmail } from './lib/_email-provider.js'
import { getAuthenticatedPlanProfile } from './lib/_plan-gate.js'

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

function buildDiagnosticHtml(profile) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;">
      <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">Football Player</p>
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.15;">Email diagnostic passed</h1>
      <p style="margin:0;color:#4b5f55;font-size:15px;line-height:1.6;">
        This test email confirms the server-side provider call completed for ${escapeHtml(profile.email)}.
      </p>
    </div>
  `
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const profile = await getAuthenticatedPlanProfile(event, { clubId: body.clubId })

    if (profile.role !== 'super_admin') {
      return jsonResponse(403, { success: false, message: 'Platform admin access is required.' })
    }

    const config = getEmailProviderConfig()
    const basePayload = {
      success: true,
      configured: config.configured,
      missing: config.missing,
      fromDomain: config.fromDomain,
      fromEmail: config.fromEmail,
    }

    if (body.sendTest !== true) {
      return jsonResponse(200, basePayload)
    }

    const toEmail = normalizeEmail(body.toEmail || profile.email)

    if (!isValidEmail(toEmail)) {
      return jsonResponse(400, { success: false, message: 'Enter a valid diagnostic recipient email.' })
    }

    const response = await sendEmail({
      from: createFromAddress('Football Player Diagnostics'),
      to: [toEmail],
      subject: 'Football Player email diagnostic',
      html: buildDiagnosticHtml(profile),
    }, {
      context: {
        emailType: 'email_diagnostic',
        userRole: profile.role,
        actorId: profile.id,
        actorEmail: profile.email,
        clubId: profile.clubId,
        targetEntityType: 'email_provider',
      },
      publicMessage: 'Email diagnostic could not send a test email. Check the provider logs.',
    })

    return jsonResponse(200, {
      ...basePayload,
      sent: true,
      id: response?.data?.id || response?.id || '',
    })
  } catch (error) {
    console.error(error)
    return jsonResponse(error.statusCode || 500, {
      success: false,
      message: error.publicMessage
        ? getPublicEmailErrorMessage(error, 'Email diagnostic failed.')
        : error.message || 'Email diagnostic failed.',
    })
  }
}
