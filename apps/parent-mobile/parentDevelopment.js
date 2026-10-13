import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'
import { Linking, Platform } from 'react-native'
import { fetchJsonWithTimeout, joinApiPath } from '../mobile-core/src/http'
import { getAccessToken, supabase } from '../mobile-core/src/supabase'

const PDF_DOWNLOAD_TIMEOUT_MS = 35_000

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

function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

export function buildParentDevelopmentPdfCacheFilename(report = {}) {
  const reportLabel = normalizeText(report?.form?.name || 'development-report')
  const recordDate = normalizeText(report?.recordDate || report?.finalizedAt).slice(0, 10)
  const displayDate = /^\d{4}-\d{2}-\d{2}$/.test(recordDate) ? recordDate.split('-').reverse().join('-') : recordDate
  const reportId = normalizeText(report?.id).replace(/[^a-z0-9-]/gi, '').slice(0, 48)
  const finalizedAt = normalizeText(report?.finalizedAt).replace(/[^0-9]/g, '').slice(0, 14)
  return safeFilename([reportLabel, displayDate, reportId, finalizedAt, 'v2'].filter(Boolean).join('-'))
}

async function isUsablePdf(uri) {
  const fileInfo = await FileSystem.getInfoAsync(uri)
  return fileInfo.exists && Number(fileInfo.size || 0) > 100
}

async function openDevelopmentPdf(uri, isCurrent) {
  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(uri)
      if (!isCurrent()) return
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: 'application/pdf',
      })
      return
    } catch {
      throw new Error('No PDF viewer is available on this device. Use Share PDF to choose an app.')
    }
  }

  throw new Error('Use the authorised browser link to open the PDF on iPhone.')
}

async function shareDevelopmentPdf(uri, isCurrent) {
  if (!await Sharing.isAvailableAsync()) throw new Error('This device cannot share the Development PDF.')
  if (!isCurrent()) return
  await Sharing.shareAsync(uri, {
    dialogTitle: 'Share Development PDF',
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  })
}

async function downloadDevelopmentPdf(downloadUrl, destination, accessToken) {
  const temporaryDestination = `${destination}.${Date.now()}.download`
  const download = await withTimeout(
    FileSystem.downloadAsync(downloadUrl, temporaryDestination, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    }),
    PDF_DOWNLOAD_TIMEOUT_MS,
    'The Development PDF is taking too long to prepare. Please try again.',
  )
  const contentType = normalizeText(download.headers?.['content-type'] || download.headers?.['Content-Type'])
    .toLowerCase()
    .split(';', 1)[0]
    .trim()

  if (download.status !== 200 || contentType !== 'application/pdf' || !await isUsablePdf(download.uri)) {
    await FileSystem.deleteAsync(download.uri, { idempotent: true }).catch(() => {})
    return { ...download, valid: false }
  }

  await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {})
  await FileSystem.moveAsync({ from: download.uri, to: destination })
  return { ...download, uri: destination, valid: true }
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
  action = 'share',
  isCurrent = () => true,
  storageOrigin = supabase.supabaseUrl,
} = {}) {
  const request = await getAuthorisedRequestDetails(apiBaseUrl, parentLinkId, report?.id)

  if (!request.reportId || report?.canDownloadPdf !== true) {
    throw new Error('This Development PDF is not available.')
  }
  let authorisedOpenUrl = ''
  if (action === 'open') {
    const endpoint = joinApiPath(apiBaseUrl, 'api/parent-development/history')
    const { ok, result } = await fetchJsonWithTimeout(endpoint, { timeoutMs: PDF_DOWNLOAD_TIMEOUT_MS, method: 'POST', headers: { Authorization: `Bearer ${request.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open_pdf', parentLinkId: request.parentLinkId, reportId: request.reportId }) })
    if (!ok) throw new Error(result?.message || 'This Development PDF could not be opened.')
    const url = normalizeText(result?.url)
    let parsed
    try { parsed = new URL(url) } catch { throw new Error('This Development PDF could not be opened.') }
    if (parsed.protocol !== 'https:' || parsed.origin !== new URL(storageOrigin).origin || parsed.username || parsed.password || !parsed.pathname.startsWith('/storage/v1/object/sign/development-pdfs-private/') || !parsed.searchParams.get('token')) throw new Error('This Development PDF could not be opened.')
    if (!isCurrent()) return false
    if (Platform.OS === 'ios') {
      await Linking.openURL(url)
      return true
    }
    authorisedOpenUrl = url
  }

  const filename = buildParentDevelopmentPdfCacheFilename(report)

  if (!FileSystem.cacheDirectory) {
    throw new Error('This device cannot open the Development PDF.')
  }

  const destination = `${FileSystem.cacheDirectory}${filename}`
  const query = [
    `parentLinkId=${encodeURIComponent(request.parentLinkId)}`,
    `reportId=${encodeURIComponent(request.reportId)}`,
  ].join('&')
  if (await isUsablePdf(destination)) {
    try {
      if (isCurrent()) await (action === 'open' ? openDevelopmentPdf(destination, isCurrent) : shareDevelopmentPdf(destination, isCurrent))
      return true
    } catch {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {})
    }
  }

  const downloadUrl = authorisedOpenUrl || `${joinApiPath(apiBaseUrl, 'api/parent-development/history')}?${query}`
  let accessToken = authorisedOpenUrl ? '' : request.accessToken
  let download = await downloadDevelopmentPdf(downloadUrl, destination, accessToken)
  if (download.status === 401 && !authorisedOpenUrl) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data?.session?.access_token) throw new Error('Sign in again before opening this Development PDF.')
    accessToken = data.session.access_token
    download = await downloadDevelopmentPdf(downloadUrl, destination, accessToken)
  }

  if (!download.valid) {
    throw new Error('This Development PDF is not available.')
  }

  if (isCurrent()) await (action === 'open' ? openDevelopmentPdf(destination, isCurrent) : shareDevelopmentPdf(destination, isCurrent))
  return true
}
