export const PDF_BRANDING_VERSION = 1

export const PDF_BRANDING_LIMITS = Object.freeze({
  maxClubNameLength: 160,
  maxTeamNameLength: 160,
  maxInitialsLength: 4,
  maxGeneratedDateLength: 80,
  maxLogoDataUriLength: 400_000,
  maxLogoDimension: 2048,
})

export const PDF_BRANDING_SOURCES = Object.freeze({
  clubLogo: 'club-logo',
  clubInitials: 'club-initials',
  platform: 'platform',
})

export const PDF_PLATFORM_ATTRIBUTION = 'Generated securely by Footballplayer.online'
export const PDF_DEFAULT_PRIMARY_COLOUR = '#047857'
export const PDF_DEFAULT_SECONDARY_COLOUR = '#ecfdf5'
export const PDF_DEFAULT_ACCENT_TEXT_COLOUR = '#065f46'

const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/
const LOGO_DATA_URI_PATTERN = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/
const SAFE_FALLBACK_REASON_PATTERN = /^[A-Z0-9_]{0,80}$/
const SAFE_CONFIDENTIALITY_LABELS = new Set(['Confidential', 'Intended recipient only'])
const SAFE_BRANDING_SOURCES = new Set(Object.values(PDF_BRANDING_SOURCES))

function cleanText(value, maxLength) {
  return String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
    .trim()
    .slice(0, maxLength)
}

function safeColour(value, fallback) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()
  return HEX_COLOUR_PATTERN.test(normalizedValue) ? normalizedValue : fallback
}

function safeLogoDataUri(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue || normalizedValue.length > PDF_BRANDING_LIMITS.maxLogoDataUriLength) {
    return ''
  }

  const match = normalizedValue.match(LOGO_DATA_URI_PATTERN)

  const encodedImage = match?.[2] || ''
  const imageType = match?.[1] || ''
  const hasExpectedSignature = imageType === 'png'
    ? encodedImage.startsWith('iVBORw0KGgo')
    : encodedImage.startsWith('/9j/')

  if (!match || encodedImage.length % 4 !== 0 || !hasExpectedSignature) {
    return ''
  }

  return normalizedValue
}

function safeDimension(value) {
  const numericValue = Number(value ?? 0)

  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > PDF_BRANDING_LIMITS.maxLogoDimension) {
    return 0
  }

  return numericValue
}

export function createPdfBrandingFallback(context = {}, generatedDate = '') {
  const clubName = cleanText(context.clubName, PDF_BRANDING_LIMITS.maxClubNameLength) || 'Footballplayer.online'
  const initials = clubName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')
    .slice(0, PDF_BRANDING_LIMITS.maxInitialsLength) || 'FP'

  return {
    version: PDF_BRANDING_VERSION,
    clubName,
    clubLogoData: '',
    clubInitials: initials,
    primaryColour: PDF_DEFAULT_PRIMARY_COLOUR,
    secondaryColour: PDF_DEFAULT_SECONDARY_COLOUR,
    accentTextColour: PDF_DEFAULT_ACCENT_TEXT_COLOUR,
    teamName: cleanText(context.teamName, PDF_BRANDING_LIMITS.maxTeamNameLength),
    platformAttribution: PDF_PLATFORM_ATTRIBUTION,
    confidentialityLabel: 'Confidential',
    generatedDate: cleanText(generatedDate, PDF_BRANDING_LIMITS.maxGeneratedDateLength),
    brandingSource: clubName === 'Footballplayer.online'
      ? PDF_BRANDING_SOURCES.platform
      : PDF_BRANDING_SOURCES.clubInitials,
    fallbackReason: 'BRANDING_NOT_RESOLVED',
    logoWidth: 0,
    logoHeight: 0,
  }
}

export function validatePdfBranding(value, { context = {}, generatedDate = '' } = {}) {
  const fallback = createPdfBrandingFallback(context, generatedDate)

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const clubName = cleanText(value.clubName, PDF_BRANDING_LIMITS.maxClubNameLength) || fallback.clubName
  const clubLogoData = safeLogoDataUri(value.clubLogoData)
  const clubInitials = cleanText(value.clubInitials, PDF_BRANDING_LIMITS.maxInitialsLength)
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase() || fallback.clubInitials
  const requestedSource = String(value.brandingSource ?? '').trim()
  const brandingSource = SAFE_BRANDING_SOURCES.has(requestedSource)
    ? requestedSource
    : clubLogoData
      ? PDF_BRANDING_SOURCES.clubLogo
      : PDF_BRANDING_SOURCES.clubInitials
  const fallbackReason = String(value.fallbackReason ?? '').trim().toUpperCase()
  const confidentialityLabel = SAFE_CONFIDENTIALITY_LABELS.has(value.confidentialityLabel)
    ? value.confidentialityLabel
    : fallback.confidentialityLabel

  return {
    version: PDF_BRANDING_VERSION,
    clubName,
    clubLogoData,
    clubInitials,
    primaryColour: safeColour(value.primaryColour, fallback.primaryColour),
    secondaryColour: safeColour(value.secondaryColour, fallback.secondaryColour),
    accentTextColour: safeColour(value.accentTextColour, fallback.accentTextColour),
    teamName: cleanText(value.teamName, PDF_BRANDING_LIMITS.maxTeamNameLength) || fallback.teamName,
    platformAttribution: PDF_PLATFORM_ATTRIBUTION,
    confidentialityLabel,
    generatedDate: cleanText(value.generatedDate, PDF_BRANDING_LIMITS.maxGeneratedDateLength)
      || fallback.generatedDate,
    brandingSource: clubLogoData ? brandingSource : brandingSource === PDF_BRANDING_SOURCES.clubLogo
      ? PDF_BRANDING_SOURCES.clubInitials
      : brandingSource,
    fallbackReason: SAFE_FALLBACK_REASON_PATTERN.test(fallbackReason)
      ? fallbackReason
      : 'BRANDING_FALLBACK',
    logoWidth: clubLogoData ? safeDimension(value.logoWidth) : 0,
    logoHeight: clubLogoData ? safeDimension(value.logoHeight) : 0,
  }
}
