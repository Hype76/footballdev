export const FOOTBALL_PLAYER_LOGO_PATH = '/football-player-logo.png'
export const FOOTBALL_PLAYER_ORIGIN = 'https://footballplayer.online'

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

  return `<img src="${escapeHtml(logo.url)}" alt="${escapeHtml(altText || 'Football Player')}" data-logo-source="${escapeHtml(logo.source)}" style="display:block;max-width:${Number(maxWidth) || 180}px;max-height:${Number(maxHeight) || 64}px;width:auto;height:auto;margin:0 0 14px;background:#ffffff;border-radius:8px;padding:6px;border:1px solid #e7ece3;">`
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
