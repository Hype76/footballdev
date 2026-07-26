export const PUBLIC_SITE_BANNER_KEY = 'public_site'
export const LOGGED_IN_USERS_BANNER_KEY = 'logged_in_users'
export const PARENT_PORTAL_BANNER_KEY = 'parent_portal'
export const PLATFORM_BANNER_MESSAGE_MAX_LENGTH = 280
export const PLATFORM_BANNER_COLOR_PATTERN = /^#[0-9A-F]{6}$/

export const DEFAULT_PUBLIC_SITE_BANNER = Object.freeze({
  bannerKey: PUBLIC_SITE_BANNER_KEY,
  enabled: true,
  message: 'Parent login is currently being worked on and may not work until 8:00am on Monday 27 July.',
  backgroundColor: '#FCD34D',
  updatedAt: '',
})

export const DEFAULT_LOGGED_IN_USERS_BANNER = Object.freeze({
  bannerKey: LOGGED_IN_USERS_BANNER_KEY,
  enabled: false,
  message: 'Important update for club and team users.',
  backgroundColor: '#93C5FD',
  updatedAt: '',
})

export const DEFAULT_PARENT_PORTAL_BANNER = Object.freeze({
  bannerKey: PARENT_PORTAL_BANNER_KEY,
  enabled: false,
  message: 'Important update for parents and families.',
  backgroundColor: '#86EFAC',
  updatedAt: '',
})

export const PLATFORM_BANNER_AUDIENCES = Object.freeze([
  {
    bannerKey: PUBLIC_SITE_BANNER_KEY,
    label: 'Landing pages',
    description: 'Shown on public pages and the sign-in page.',
    defaultBanner: DEFAULT_PUBLIC_SITE_BANNER,
  },
  {
    bannerKey: LOGGED_IN_USERS_BANNER_KEY,
    label: 'Logged-in users',
    description: 'Shown inside the staff and Platform Admin application.',
    defaultBanner: DEFAULT_LOGGED_IN_USERS_BANNER,
  },
  {
    bannerKey: PARENT_PORTAL_BANNER_KEY,
    label: 'Parent portal',
    description: 'Shown only to signed-in parents in the parent portal.',
    defaultBanner: DEFAULT_PARENT_PORTAL_BANNER,
  },
])

export const PLATFORM_BANNER_KEYS = Object.freeze(
  PLATFORM_BANNER_AUDIENCES.map((audience) => audience.bannerKey),
)

export const DEFAULT_PLATFORM_BANNERS = Object.freeze(
  Object.fromEntries(
    PLATFORM_BANNER_AUDIENCES.map((audience) => [audience.bannerKey, audience.defaultBanner]),
  ),
)

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

export function getDefaultPlatformBanner(bannerKey) {
  return DEFAULT_PLATFORM_BANNERS[bannerKey] ?? DEFAULT_PUBLIC_SITE_BANNER
}

export function normalizePlatformBanner(row, fallback) {
  const requestedBannerKey = String(row?.banner_key ?? row?.bannerKey ?? fallback?.bannerKey ?? '').trim()
  const resolvedFallback = fallback ?? getDefaultPlatformBanner(requestedBannerKey)
  const normalizedMessage = String(row?.message ?? '').trim()

  return {
    bannerKey: requestedBannerKey || resolvedFallback.bannerKey,
    enabled: typeof row?.enabled === 'boolean' ? row.enabled : resolvedFallback.enabled,
    message: normalizedMessage || resolvedFallback.message,
    backgroundColor: normalizePlatformBannerColor(
      row?.background_color ?? row?.backgroundColor,
      resolvedFallback.backgroundColor,
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
