import { requestFormationBoardExport } from './domain/formation-board.js'
import { supabase } from './supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getExportRequestId(payload) {
  return normalizeText(payload?.request?.id ?? payload?.request_id ?? payload?.id)
}

function getFilename(response, fallback) {
  const disposition = response.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="([^"]+)"/i)
  return normalizeText(match?.[1]) || fallback
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession()

  if (error || !data?.session?.access_token) {
    throw new Error('Sign in again before exporting this Formation Board.')
  }

  return data.session.access_token
}

async function callExportFunction({ purpose, requestId }) {
  const accessToken = await getAccessToken()
  const response = await fetch('/.netlify/functions/formation-board-export', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ purpose, requestId }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || 'Formation Board export failed.')
  }

  return response
}

export async function createFormationBoardThumbnail({ boardId, user, versionId } = {}) {
  const request = await requestFormationBoardExport({ boardId, format: 'png', user, versionId })
  const requestId = getExportRequestId(request)

  if (!requestId) throw new Error('The thumbnail request could not be created.')

  const response = await callExportFunction({ purpose: 'thumbnail', requestId })
  const body = await response.json()
  const thumbnailPath = normalizeText(body?.thumbnailPath)

  if (!thumbnailPath) throw new Error('The thumbnail could not be stored.')

  return { requestId, thumbnailPath }
}

export async function generateFormationBoardExport({ boardId, format, user, versionId } = {}) {
  const normalizedFormat = normalizeText(format).toLowerCase()

  if (!['png', 'pdf'].includes(normalizedFormat)) {
    throw new Error('Choose PNG or PDF before exporting this Formation Board.')
  }

  const request = await requestFormationBoardExport({ boardId, format: normalizedFormat, user, versionId })
  const requestId = getExportRequestId(request)

  if (!requestId) throw new Error('The export request could not be created.')

  const response = await callExportFunction({ purpose: 'download', requestId })
  const blob = await response.blob()
  const filename = getFilename(response, `formation-board.${normalizedFormat}`)

  return { blob, filename, format: normalizedFormat, requestId }
}

export function downloadFormationBoardExport({ blob, filename }) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function shareFormationBoardExport(result) {
  const file = new File([result.blob], result.filename, { type: result.blob.type })
  const canShareFile = typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [file] })

  if (canShareFile) {
    try {
      await navigator.share({
        files: [file],
        title: 'Formation Board',
      })
      return { shared: true }
    } catch (error) {
      if (error?.name === 'AbortError') return { cancelled: true, shared: false }
    }
  }

  downloadFormationBoardExport(result)
  return { downloaded: true, shared: false }
}
