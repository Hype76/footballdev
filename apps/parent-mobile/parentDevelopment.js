import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { fetchJsonWithTimeout, joinApiPath } from '../mobile-core/src/http'
import { getAccessToken } from '../mobile-core/src/supabase'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function safeFilename(value) {
  const baseName = normalizeText(value)
    .replace(/[\r\n"\\/:*?<>|]+/g, '-')
    .replace(/\.pdf$/i, '')
    .replace(/\s+/g, ' ')
    .slice(0, 130)
    .trim()

  return `${baseName || 'development-report'}.pdf`
}

async function getAuthorisedRequestDetails(apiBaseUrl, parentLinkId, reportId = '') {
  const accessToken = await getAccessToken()
  const normalizedParentLinkId = normalizeText(parentLinkId)
  const normalizedReportId = normalizeText(reportId)

  if (!normalizeText(apiBaseUrl) || !accessToken || !normalizedParentLinkId) {
    throw new Error('Sign in again before opening Development history.')
  }

  return {
    accessToken,
    parentLinkId: normalizedParentLinkId,
    reportId: normalizedReportId,
  }
}

export async function getParentMobileDevelopmentHistory({ apiBaseUrl, parentLinkId } = {}) {
  const request = await getAuthorisedRequestDetails(apiBaseUrl, parentLinkId)
  const { ok, result } = await fetchJsonWithTimeout(
    joinApiPath(apiBaseUrl, 'api/parent-development/history'),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'list',
        parentLinkId: request.parentLinkId,
      }),
    },
  )

  if (!ok || result.success === false) {
    throw new Error(result.message || 'Development history could not be loaded.')
  }

  return Array.isArray(result.reports) ? result.reports : []
}

export async function shareParentMobileDevelopmentPdf({
  apiBaseUrl,
  parentLinkId,
  report,
} = {}) {
  const request = await getAuthorisedRequestDetails(apiBaseUrl, parentLinkId, report?.id)

  if (!request.reportId || report?.canDownloadPdf !== true) {
    throw new Error('This Development PDF is not available.')
  }

  if (!await Sharing.isAvailableAsync()) {
    throw new Error('This device cannot open the Development PDF.')
  }

  const reportLabel = normalizeText(report?.form?.name || 'development-report')
  const recordDate = normalizeText(report?.recordDate || report?.finalizedAt).slice(0, 10)
  const filename = safeFilename(`${reportLabel}${recordDate ? `-${recordDate}` : ''}.pdf`)

  if (!FileSystem.cacheDirectory) {
    throw new Error('This device cannot open the Development PDF.')
  }

  const destination = `${FileSystem.cacheDirectory}${filename}`
  const query = [
    `parentLinkId=${encodeURIComponent(request.parentLinkId)}`,
    `reportId=${encodeURIComponent(request.reportId)}`,
  ].join('&')
  let downloadedUri = destination

  try {
    const download = await FileSystem.downloadAsync(
      `${joinApiPath(apiBaseUrl, 'api/parent-development/history')}?${query}`,
      destination,
      {
        headers: { Authorization: `Bearer ${request.accessToken}` },
      },
    )
    downloadedUri = download.uri
    const contentType = normalizeText(download.headers?.['content-type'] || download.headers?.['Content-Type'])
      .toLowerCase()
      .split(';', 1)[0]
      .trim()
    const fileInfo = await FileSystem.getInfoAsync(downloadedUri)

    if (download.status !== 200 || contentType !== 'application/pdf' || !fileInfo.exists || Number(fileInfo.size || 0) === 0) {
      throw new Error('This Development PDF is not available.')
    }

    await Sharing.shareAsync(downloadedUri, {
      dialogTitle: 'Open Development PDF',
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    })

    return true
  } finally {
    if (downloadedUri) {
      await FileSystem.deleteAsync(downloadedUri, { idempotent: true }).catch(() => {})
    }
  }
}
