import { supabase } from '../supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getDownloadFilename(response, fallback = 'development-report.pdf') {
  const disposition = normalizeText(response.headers.get('content-disposition'))
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const plainMatch = disposition.match(/filename="([^"]+)"/i)
  const candidate = encodedMatch?.[1]
    ? decodeURIComponent(encodedMatch[1])
    : plainMatch?.[1] || fallback

  return normalizeText(candidate).replace(/[\\/:*?"<>|]+/g, '-') || fallback
}

async function getParentDevelopmentAccessToken(providedAccessToken = '') {
  const normalizedProvidedAccessToken = normalizeText(providedAccessToken)

  if (normalizedProvidedAccessToken) {
    return normalizedProvidedAccessToken
  }

  const { data, error } = await supabase.auth.getSession()
  const accessToken = data?.session?.access_token || ''

  if (error || !accessToken) {
    throw new Error('Sign in again before opening Development history.')
  }

  return accessToken
}

async function requestParentDevelopment(body, accessToken = '') {
  const resolvedAccessToken = await getParentDevelopmentAccessToken(accessToken)
  return fetch('/api/parent-development/history', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export async function getParentPortalDevelopmentHistory({
  accessToken = '',
  parentLinkId,
} = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const response = await requestParentDevelopment({
    action: 'list',
    parentLinkId: normalizedParentLinkId,
  }, accessToken)
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.message || 'Development history could not be loaded.')
  }

  return Array.isArray(payload.reports) ? payload.reports : []
}

export async function downloadParentPortalDevelopmentPdf({
  accessToken = '',
  parentLinkId,
  reportId,
} = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)
  const normalizedReportId = normalizeText(reportId)

  if (!normalizedParentLinkId || !normalizedReportId) {
    throw new Error('Choose a Development report before downloading its PDF.')
  }

  const response = await requestParentDevelopment({
    action: 'download_pdf',
    parentLinkId: normalizedParentLinkId,
    reportId: normalizedReportId,
  }, accessToken)

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'This Development PDF is not available.')
  }

  const blob = await response.blob()

  if (blob.type !== 'application/pdf' || blob.size === 0) {
    throw new Error('This Development PDF is not available.')
  }

  return {
    blob,
    filename: getDownloadFilename(response),
  }
}
