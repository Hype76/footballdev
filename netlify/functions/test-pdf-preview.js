import { buildEmailHtml } from '../../src/lib/email-builder.js'
import { buildPdfBuffer } from '../../src/lib/pdf-builder.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method Not Allowed' })
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const html = buildEmailHtml(body)

    if (html.length > 200000) {
      return jsonResponse(400, { success: false, message: 'Email content is too large' })
    }

    const pdfBuffer = await buildPdfBuffer(html)

    return jsonResponse(200, {
      success: true,
      htmlSize: html.length,
      pdfSize: pdfBuffer.length,
      pdfBase64: pdfBuffer.toString('base64'),
    })
  } catch (error) {
    console.error(error)

    return jsonResponse(500, {
      success: false,
      message: 'PDF preview could not be generated',
    })
  }
}
