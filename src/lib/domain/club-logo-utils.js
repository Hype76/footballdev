import { CLUB_LOGOS_BUCKET } from '../supabase-client.js'

export function appendLogoCacheBuster(url) {
  const normalizedUrl = String(url ?? '').trim()

  if (!normalizedUrl) {
    return ''
  }

  const separator = normalizedUrl.includes('?') ? '&' : '?'
  return `${normalizedUrl}${separator}v=${Date.now()}`
}

export function isStoredClubLogoUrl(clubId, logoUrl) {
  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!clubId || !normalizedLogoUrl) {
    return false
  }

  try {
    const parsedUrl = new URL(normalizedLogoUrl)
    return parsedUrl.pathname.includes(`/storage/v1/object/public/${CLUB_LOGOS_BUCKET}/${clubId}/logo.png`)
  } catch {
    return false
  }
}

export function getLogoContentType(url, response, blob) {
  const headerType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const blobType = String(blob.type ?? '').trim().toLowerCase()

  if (headerType.startsWith('image/')) {
    return headerType
  }

  if (blobType.startsWith('image/')) {
    return blobType
  }

  const pathname = url.pathname.toLowerCase()

  if (pathname.endsWith('.png')) {
    return 'image/png'
  }

  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (pathname.endsWith('.webp')) {
    return 'image/webp'
  }

  if (pathname.endsWith('.gif')) {
    return 'image/gif'
  }

  if (pathname.endsWith('.svg')) {
    return 'image/svg+xml'
  }

  return ''
}
