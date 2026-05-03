import { buildPdfBuffer } from '../../src/lib/pdf-builder.js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body || '{}')
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
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    }
  }
}
