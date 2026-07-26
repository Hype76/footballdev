export const PUBLIC_SITE_BANNER_KEY = 'public_site'
export const PLATFORM_BANNER_MESSAGE_MAX_LENGTH = 280
export const PLATFORM_BANNER_COLOR_PATTERN = /^#[0-9A-F]{6}$/

export const DEFAULT_PUBLIC_SITE_BANNER = Object.freeze({
  bannerKey: PUBLIC_SITE_BANNER_KEY,
  enabled: true,
  message: 'Parent login is currently being worked on and may not work until 8:00am on Monday 27 July.',
  backgroundColor: '#FCD34D',
  updatedAt: '',
})

export const PLATFORM_BANNER_COLOR_PRESETS = Object.freeze([
  { label: 'Amber', value: '#FCD34D' },
  { label: 'Red', value: '#FCA5A5' },
  { label: 'Blue', value: '#93C5FD' },
  { label: 'Green', value: '#86EFAC' },
  { label: 'Navy', value: '#0F172A' },
])

export function normalizePlatformBannerColor(value, fallback = DEFAULT_PUBLIC_SITE_BANNER.backgroundColor) {
  const normalizedValue = String(value ?? '').trim().toUpperCase()
  return PLATFORM_BANNER_COLOR_PATTERN.test(normalizedValue) ? normalizedValue : fallback
}

export function normalizePlatformBanner(row, fallback = DEFAULT_PUBLIC_SITE_BANNER) {
  const normalizedMessage = String(row?.message ?? '').trim()

  return {
    bannerKey: String(row?.banner_key ?? row?.bannerKey ?? fallback.bannerKey).trim() || fallback.bannerKey,
    enabled: typeof row?.enabled === 'boolean' ? row.enabled : fallback.enabled,
    message: normalizedMessage || fallback.message,
    backgroundColor: normalizePlatformBannerColor(
      row?.background_color ?? row?.backgroundColor,
      fallback.backgroundColor,
    ),
    updatedAt: String(row?.updated_at ?? row?.updatedAt ?? '').trim(),
  }
}

export function validatePlatformBannerDraft(draft) {
  const message = String(draft?.message ?? '').trim()
  const backgroundColor = normalizePlatformBannerColor(draft?.backgroundColor, '')

  if (!message) {
    throw new Error('Banner text is required.')
  }

  if (message.length > PLATFORM_BANNER_MESSAGE_MAX_LENGTH) {
    throw new Error(`Banner text must be ${PLATFORM_BANNER_MESSAGE_MAX_LENGTH} characters or fewer.`)
  }

  if (!backgroundColor) {
    throw new Error('Choose a valid banner background colour.')
  }

  return {
    enabled: Boolean(draft?.enabled),
    message,
    backgroundColor,
  }
}

export function getPlatformBannerTextColor(backgroundColor) {
  const normalizedColor = normalizePlatformBannerColor(backgroundColor)
  const red = Number.parseInt(normalizedColor.slice(1, 3), 16)
  const green = Number.parseInt(normalizedColor.slice(3, 5), 16)
  const blue = Number.parseInt(normalizedColor.slice(5, 7), 16)
  const perceivedBrightness = (red * 299 + green * 587 + blue * 114) / 1000

  return perceivedBrightness >= 150 ? '#241A00' : '#FFFFFF'
}
