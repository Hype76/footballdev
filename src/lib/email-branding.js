export const FOOTBALL_PLAYER_LOGO_PATH = '/football-player-logo.png'
export const FOOTBALL_PLAYER_ORIGIN = 'https://footballplayer.online'
const DEFAULT_IMAGE_PROBE_TIMEOUT_MS = 2500
const SAFE_EMAIL_IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function escapeHtml(value) {
  return normalizeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeOrigin(origin) {
  const configuredOrigin = normalizeText(origin)
    || normalizeText(globalThis.location?.origin)
    || FOOTBALL_PLAYER_ORIGIN

  try {
    const parsedUrl = new URL(configuredOrigin)
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.origin : FOOTBALL_PLAYER_ORIGIN
  } catch {
    return FOOTBALL_PLAYER_ORIGIN
  }
}

export function getSafeEmailImageUrl(value, { origin = '' } = {}) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return ''
  }

  try {
    const parsedUrl = normalizedValue.startsWith('/')
      ? new URL(normalizedValue, normalizeOrigin(origin))
      : new URL(normalizedValue)

    return parsedUrl.protocol === 'https:' ? parsedUrl.href : ''
  } catch {
    return ''
  }
}

function isBlockedEmailImageHostname(hostname) {
  const normalizedHostname = normalizeText(hostname)
    .toLowerCase()
    .replace(/^\[|\]$/g, '')

  if (!normalizedHostname
    || normalizedHostname === 'localhost'
    || normalizedHostname.endsWith('.localhost')
    || normalizedHostname.endsWith('.local')) {
    return true
  }

  if (normalizedHostname.includes(':')) {
    return true
  }

  const octets = normalizedHostname.split('.')

  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) {
    return false
  }

  const [first, second] = octets.map(Number)

  if (octets.some((octet) => Number(octet) > 255)) {
    return true
  }

  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
}

export function isSafeEmailImageProbeUrl(value, { origin = '' } = {}) {
  const safeUrl = getSafeEmailImageUrl(value, { origin })

  if (!safeUrl) {
    return false
  }

  const parsedUrl = new URL(safeUrl)

  return !parsedUrl.username
    && !parsedUrl.password
    && !parsedUrl.port
    && !isBlockedEmailImageHostname(parsedUrl.hostname)
}

async function probeEmailImageRequest(url, {
  fetchImpl,
  method,
  signal,
} = {}) {
  const response = await fetchImpl(url, {
    headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
    method,
    redirect: 'error',
    signal,
  })
  const contentType = normalizeText(response.headers?.get?.('content-type'))
    .toLowerCase()
    .split(';')[0]
    .trim()
  const isImage = response.ok && SAFE_EMAIL_IMAGE_CONTENT_TYPES.has(contentType)

  await response.body?.cancel?.().catch(() => {})

  return {
    isImage,
    shouldRetryWithGet: method === 'HEAD' && [403, 405, 501].includes(response.status),
  }
}

export async function isEmailImageReachable(value, {
  fetchImpl = globalThis.fetch,
  origin = '',
  timeoutMs = DEFAULT_IMAGE_PROBE_TIMEOUT_MS,
} = {}) {
  const safeUrl = getSafeEmailImageUrl(value, { origin })

  if (!safeUrl || !isSafeEmailImageProbeUrl(safeUrl) || typeof fetchImpl !== 'function') {
    return false
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_IMAGE_PROBE_TIMEOUT_MS))

  try {
    const headResult = await probeEmailImageRequest(safeUrl, {
      fetchImpl,
      method: 'HEAD',
      signal: controller.signal,
    })

    if (headResult.isImage) {
      return true
    }

    if (!headResult.shouldRetryWithGet) {
      return false
    }

    const getResult = await probeEmailImageRequest(safeUrl, {
      fetchImpl,
      method: 'GET',
      signal: controller.signal,
    })

    return getResult.isImage
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

export function getFootballPlayerEmailLogoUrl({ origin = '' } = {}) {
  return getSafeEmailImageUrl(FOOTBALL_PLAYER_LOGO_PATH, { origin })
}

export function resolveEmailLogo({
  clubLogoUrl = '',
  fallbackLogoUrl = '',
  origin = '',
  teamLogoUrl = '',
} = {}) {
  const candidates = [
    ['team', teamLogoUrl],
    ['club', clubLogoUrl],
    ['football-player', fallbackLogoUrl || FOOTBALL_PLAYER_LOGO_PATH],
  ]

  for (const [source, url] of candidates) {
    const safeUrl = getSafeEmailImageUrl(url, { origin })

    if (safeUrl) {
      return { source, url: safeUrl }
    }
  }

  return { source: '', url: '' }
}

export async function resolveReachableEmailLogo({
  clubLogoUrl = '',
  fallbackLogoUrl = '',
  fetchImpl = globalThis.fetch,
  origin = '',
  teamLogoUrl = '',
  timeoutMs = DEFAULT_IMAGE_PROBE_TIMEOUT_MS,
} = {}) {
  const candidates = [
    ['team', teamLogoUrl],
    ['club', clubLogoUrl],
  ]

  for (const [source, url] of candidates) {
    const safeUrl = getSafeEmailImageUrl(url, { origin })

    if (safeUrl && await isEmailImageReachable(safeUrl, { fetchImpl, origin, timeoutMs })) {
      return { source, url: safeUrl }
    }
  }

  return resolveEmailLogo({
    fallbackLogoUrl,
    origin,
  })
}

export function buildEmailLogoMarkup({
  altText = 'Football Player',
  clubLogoUrl = '',
  fallbackLogoUrl = '',
  maxHeight = 64,
  maxWidth = 180,
  origin = '',
  teamLogoUrl = '',
} = {}) {
  const logo = resolveEmailLogo({ clubLogoUrl, fallbackLogoUrl, origin, teamLogoUrl })

  if (!logo.url) {
    return `<p style="margin:0 0 12px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">${escapeHtml(altText || 'Football Player')}</p>`
  }

  const resolvedAltText = logo.source === 'football-player'
    ? 'Football Player logo'
    : normalizeText(altText) || 'Club logo'

  return `<img src="${escapeHtml(logo.url)}" alt="${escapeHtml(resolvedAltText)}" data-logo-source="${escapeHtml(logo.source)}" style="display:block;max-width:${Number(maxWidth) || 180}px;max-height:${Number(maxHeight) || 64}px;width:auto;height:auto;margin:0 0 14px;background:#ffffff;border-radius:8px;padding:6px;border:1px solid #e7ece3;">`
}

export function getEventMapLinks(locationText) {
  const query = normalizeText(locationText)

  if (!query) {
    return []
  }

  const encodedQuery = encodeURIComponent(query)

  return [
    {
      href: `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`,
      label: 'Open in Google Maps',
    },
    {
      href: `https://maps.apple.com/?q=${encodedQuery}`,
      label: 'Open in Apple Maps',
    },
  ]
}

export function buildEventMapLinksMarkup(locationText) {
  const links = getEventMapLinks(locationText)

  if (links.length === 0) {
    return ''
  }

  return `
    <div style="margin:0 0 22px;">
      ${links.map((link) => `<a href="${escapeHtml(link.href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 12px;border:1px solid #047857;color:#047857;text-decoration:none;border-radius:8px;font-weight:900;">${escapeHtml(link.label)}</a>`).join('')}
    </div>
  `
}
