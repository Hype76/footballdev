import { PDF_REPORT_TYPES } from './pdf-document.js'
import { supabase } from './supabase-client.js'

const PDF_DOWNLOAD_TIMEOUT_MS = 15_000
const PDF_DOWNLOAD_FILENAME = 'football-player-report.pdf'
const PDF_MIN_BYTES = 512
const PDF_MAX_BYTES = 5 * 1024 * 1024

function downloadBlob(blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = PDF_DOWNLOAD_FILENAME
  link.rel = 'noopener'
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function exportCommunicationPdf({ clubId, communicationLogId }) {
  const normalizedClubId = String(clubId ?? '').trim()
  const normalizedLogId = String(communicationLogId ?? '').trim()

  if (!normalizedClubId || !normalizedLogId) {
    throw new Error('This PDF is not available for download.')
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''
  let response

  try {
    response = await fetchWithTimeout(
      '/.netlify/functions/render-pdf',
      {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType: PDF_REPORT_TYPES.parentMessage,
          clubId: normalizedClubId,
          communicationLogId: normalizedLogId,
        }),
      },
      PDF_DOWNLOAD_TIMEOUT_MS,
    )
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('PDF generation timed out.')
    }

    throw error
  }

  if (!response.ok) {
    let message = 'PDF export failed.'

    try {
      const errorResult = await response.json()
      message = String(errorResult.error ?? '').trim() || message
    } catch {
      message = response.statusText || message
    }

    throw new Error(message)
  }

  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase()

  if (!contentType.startsWith('application/pdf')) {
    throw new Error('PDF export returned an invalid file.')
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer())
  const signature = new TextDecoder('ascii').decode(pdfBytes.subarray(0, 5))

  if (pdfBytes.byteLength < PDF_MIN_BYTES || pdfBytes.byteLength > PDF_MAX_BYTES || signature !== '%PDF-') {
    throw new Error('PDF export returned an invalid file.')
  }

  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' })
  downloadBlob(pdfBlob)
}
