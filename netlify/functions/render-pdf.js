import { buildPdfBuffer } from '../../src/lib/pdf-builder.js'
import {
  assertPlanFeature,
  getAuthenticatedRequestUser,
  getClubPlanProfile,
} from './_plan-gate.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    await getAuthenticatedRequestUser(event)
    const planProfile = await getClubPlanProfile(body.clubId)
    assertPlanFeature(planProfile, 'pdfExport')
    const html = String(body.html ?? '').trim()
    const filename = String(body.filename ?? 'player-feedback.pdf')
      .replace(/["\r\n]/g, '')
      .trim() || 'player-feedback.pdf'

    if (!html) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing html' }),
      }
    }

    const pdfBuffer = await buildPdfBuffer(html)

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    }
  } catch (error) {
    console.error(error)

    return {
      statusCode: error.statusCode || 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.statusCode ? error.message : 'PDF export failed.' }),
    }
  }
}
