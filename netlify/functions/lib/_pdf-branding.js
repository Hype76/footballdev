import process from 'node:process'
import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import {
  PDF_BRANDING_SOURCES,
  PDF_BRANDING_VERSION,
  PDF_DEFAULT_PRIMARY_COLOUR,
  PDF_PLATFORM_ATTRIBUTION,
  validatePdfBranding,
} from '../../../src/lib/pdf-branding.js'
import { validateAndNormalizeClubLogo } from './_club-logo-validation.js'
import {
  loadAuthorisedPdfBrandingScope,
  normalizePdfText,
} from './_pdf-authority.js'

const CLUB_LOGOS_BUCKET = 'club-logos'
const PDF_LOGO_FETCH_TIMEOUT_MS = 5_000
const PDF_LOGO_MAX_WIDTH = 320
const PDF_LOGO_MAX_HEIGHT = 160
const PDF_LOGO_MAX_ASPECT_RATIO = 8
const SAFE_OBJECT_PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._-]+)+$/
const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/
const FIXED_ACCENT_COLOURS = Object.freeze({
  yellow: '#facc15',
  blue: '#1d4ed8',
  green: '#15803d',
  red: '#dc2626',
  purple: '#7c3aed',
})

function initialsFromName(value) {
  return normalizePdfText(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('')
    .slice(0, 4) || 'FP'
}

function hexToRgb(value) {
  const normalizedValue = value.slice(1)
  return {
    red: Number.parseInt(normalizedValue.slice(0, 2), 16),
    green: Number.parseInt(normalizedValue.slice(2, 4), 16),
    blue: Number.parseInt(normalizedValue.slice(4, 6), 16),
  }
}

function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`
}

function mixHex(source, target, targetWeight) {
  const sourceRgb = hexToRgb(source)
  const targetRgb = hexToRgb(target)
  const weight = Math.max(0, Math.min(1, Number(targetWeight) || 0))

  return rgbToHex({
    red: sourceRgb.red + ((targetRgb.red - sourceRgb.red) * weight),
    green: sourceRgb.green + ((targetRgb.green - sourceRgb.green) * weight),
    blue: sourceRgb.blue + ((targetRgb.blue - sourceRgb.blue) * weight),
  })
}

function relativeLuminance(value) {
  const { red, green, blue } = hexToRgb(value)
  const channels = [red, green, blue].map((channel) => {
    const normalizedChannel = channel / 255
    return normalizedChannel <= 0.04045
      ? normalizedChannel / 12.92
      : ((normalizedChannel + 0.055) / 1.055) ** 2.4
  })

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrastRatio(left, right) {
  const luminances = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a)
  return (luminances[0] + 0.05) / (luminances[1] + 0.05)
}

function resolveAccent(value) {
  const normalizedValue = normalizePdfText(value).toLowerCase()
  const primaryColour = HEX_COLOUR_PATTERN.test(normalizedValue)
    ? normalizedValue
    : FIXED_ACCENT_COLOURS[normalizedValue] || PDF_DEFAULT_PRIMARY_COLOUR
  let accentTextColour = primaryColour

  if (contrastRatio(accentTextColour, '#ffffff') < 4.5) {
    for (let step = 1; step <= 20; step += 1) {
      const candidate = mixHex(primaryColour, '#06110a', step / 20)

      if (contrastRatio(candidate, '#ffffff') >= 4.5) {
        accentTextColour = candidate
        break
      }
    }
  }

  return {
    primaryColour,
    secondaryColour: mixHex(primaryColour, '#ffffff', 0.88),
    accentTextColour,
    usedFallback: !HEX_COLOUR_PATTERN.test(normalizedValue) && !FIXED_ACCENT_COLOURS[normalizedValue],
  }
}

function formatGeneratedDate(value) {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(date)
}

function detectImageMime(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }

  return ''
}

export function resolveManagedClubLogoObjectPath(logoUrl, clubId, {
  storageOrigin = process.env.VITE_SUPABASE_URL,
} = {}) {
  const normalizedUrl = normalizePdfText(logoUrl)
  const normalizedClubId = normalizePdfText(clubId)
  const normalizedStorageOrigin = normalizePdfText(storageOrigin)

  if (!normalizedUrl || !normalizedClubId || !normalizedStorageOrigin) {
    return ''
  }

  try {
    const parsedUrl = new URL(normalizedUrl)
    const expectedOrigin = new URL(normalizedStorageOrigin).origin

    if (parsedUrl.origin !== expectedOrigin || parsedUrl.username || parsedUrl.password) {
      return ''
    }

    const pathname = decodeURIComponent(parsedUrl.pathname)
    const marker = `/storage/v1/object/public/${CLUB_LOGOS_BUCKET}/`
    const markerIndex = pathname.indexOf(marker)

    if (markerIndex < 0) {
      return ''
    }

    const objectPath = pathname.slice(markerIndex + marker.length)

    if (
      !objectPath.startsWith(`${normalizedClubId}/`) ||
      objectPath.includes('..') ||
      objectPath.includes('\\') ||
      !SAFE_OBJECT_PATH_PATTERN.test(objectPath)
    ) {
      return ''
    }

    return objectPath
  } catch {
    return ''
  }
}

async function downloadLogoWithTimeout(storage, objectPath, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await storage.from(CLUB_LOGOS_BUCKET).download(
      objectPath,
      {},
      { signal: controller.signal, cache: 'no-store' },
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function preparePdfClubLogo({
  storage,
  clubId,
  logoUrl,
  diagnostics = null,
  fetchTimeoutMs = PDF_LOGO_FETCH_TIMEOUT_MS,
  storageOrigin = process.env.VITE_SUPABASE_URL,
} = {}) {
  const objectPath = resolveManagedClubLogoObjectPath(logoUrl, clubId, { storageOrigin })

  if (!objectPath) {
    return { fallbackReason: logoUrl ? 'LOGO_PATH_REJECTED' : 'LOGO_MISSING' }
  }

  const fetchStartedAt = Date.now()
  let downloaded

  try {
    downloaded = await downloadLogoWithTimeout(storage, objectPath, fetchTimeoutMs)
  } catch (error) {
    if (diagnostics) {
      diagnostics.logoFetchDurationMs = Date.now() - fetchStartedAt
    }

    return {
      fallbackReason: error?.name === 'AbortError' ? 'LOGO_FETCH_TIMEOUT' : 'LOGO_FETCH_FAILED',
    }
  }

  if (diagnostics) {
    diagnostics.logoFetchDurationMs = Date.now() - fetchStartedAt
  }

  if (downloaded?.error || !downloaded?.data?.arrayBuffer) {
    return { fallbackReason: 'LOGO_FETCH_FAILED' }
  }

  const inputBuffer = Buffer.from(await downloaded.data.arrayBuffer())
  const declaredMimeType = normalizePdfText(downloaded.data.type) || detectImageMime(inputBuffer)
  const validationStartedAt = Date.now()
  let validated

  try {
    validated = await validateAndNormalizeClubLogo({
      buffer: inputBuffer,
      declaredMimeType,
      fileName: objectPath,
    })
  } catch {
    if (diagnostics) {
      diagnostics.logoValidationDurationMs = Date.now() - validationStartedAt
      diagnostics.logoInputBytes = inputBuffer.length
    }

    return { fallbackReason: 'LOGO_VALIDATION_FAILED' }
  }

  if (diagnostics) {
    diagnostics.logoValidationDurationMs = Date.now() - validationStartedAt
    diagnostics.logoInputBytes = inputBuffer.length
  }

  const aspectRatio = Math.max(validated.width, validated.height) / Math.min(validated.width, validated.height)

  if (!Number.isFinite(aspectRatio) || aspectRatio > PDF_LOGO_MAX_ASPECT_RATIO) {
    return { fallbackReason: 'LOGO_ASPECT_RATIO_REJECTED' }
  }

  const conversionStartedAt = Date.now()
  let outputBuffer
  let outputMetadata

  try {
    outputBuffer = await sharp(validated.buffer, {
      failOn: 'error',
      sequentialRead: true,
    })
      .resize({
        width: PDF_LOGO_MAX_WIDTH,
        height: PDF_LOGO_MAX_HEIGHT,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer()
    outputMetadata = await sharp(outputBuffer).metadata()
  } catch {
    if (diagnostics) {
      diagnostics.logoConversionDurationMs = Date.now() - conversionStartedAt
    }

    return { fallbackReason: 'LOGO_CONVERSION_FAILED' }
  }

  if (diagnostics) {
    diagnostics.logoConversionDurationMs = Date.now() - conversionStartedAt
    diagnostics.logoOutputBytes = outputBuffer.length
  }

  return {
    clubLogoData: `data:image/png;base64,${outputBuffer.toString('base64')}`,
    fallbackReason: '',
    logoHeight: Number(outputMetadata.height ?? 0),
    logoInputBytes: inputBuffer.length,
    logoOutputBytes: outputBuffer.length,
    logoWidth: Number(outputMetadata.width ?? 0),
  }
}

export async function resolvePdfBranding({
  supabaseAdmin,
  profile,
  clubId,
  teamId = '',
  reportType = '',
  diagnostics = null,
  now = () => new Date(),
  fetchTimeoutMs = PDF_LOGO_FETCH_TIMEOUT_MS,
  storageOrigin = process.env.VITE_SUPABASE_URL,
} = {}) {
  const startedAt = Date.now()
  const scope = await loadAuthorisedPdfBrandingScope(supabaseAdmin, {
    profile,
    clubId,
    teamId,
  })
  const branding = await buildPdfBrandingForAuthorisedScope({
    supabaseAdmin,
    club: scope.club,
    team: scope.team,
    reportType,
    diagnostics,
    now,
    fetchTimeoutMs,
    storageOrigin,
  })

  if (diagnostics) {
    diagnostics.brandingDurationMs = Date.now() - startedAt
  }

  return {
    branding,
    scope,
  }
}

export async function buildPdfBrandingForAuthorisedScope({
  supabaseAdmin,
  club,
  team = null,
  reportType = '',
  diagnostics = null,
  now = () => new Date(),
  fetchTimeoutMs = PDF_LOGO_FETCH_TIMEOUT_MS,
  storageOrigin = process.env.VITE_SUPABASE_URL,
} = {}) {
  const startedAt = Date.now()
  const generatedDate = formatGeneratedDate(now())
  const scope = { club, team }
  const clubName = normalizePdfText(scope.club.name) || 'Footballplayer.online'
  const teamName = normalizePdfText(scope.team?.name)
  const colours = resolveAccent(scope.club.theme_accent)
  const logo = await preparePdfClubLogo({
    storage: supabaseAdmin.storage,
    clubId: scope.club.id,
    logoUrl: scope.club.logo_url,
    diagnostics,
    fetchTimeoutMs,
    storageOrigin,
  })
  const fallbackReasons = [
    logo.fallbackReason,
    colours.usedFallback ? 'COLOUR_INVALID' : '',
  ].filter(Boolean)
  const branding = validatePdfBranding({
    version: PDF_BRANDING_VERSION,
    clubName,
    clubLogoData: logo.clubLogoData || '',
    clubInitials: initialsFromName(clubName),
    primaryColour: colours.primaryColour,
    secondaryColour: colours.secondaryColour,
    accentTextColour: colours.accentTextColour,
    teamName,
    platformAttribution: PDF_PLATFORM_ATTRIBUTION,
    confidentialityLabel: reportType === 'parent-message' ? 'Intended recipient only' : 'Confidential',
    generatedDate,
    brandingSource: logo.clubLogoData
      ? PDF_BRANDING_SOURCES.clubLogo
      : clubName === 'Footballplayer.online'
        ? PDF_BRANDING_SOURCES.platform
        : PDF_BRANDING_SOURCES.clubInitials,
    fallbackReason: fallbackReasons.join('_') || '',
    logoWidth: logo.logoWidth || 0,
    logoHeight: logo.logoHeight || 0,
  }, {
    context: { clubName, teamName },
    generatedDate,
  })

  if (diagnostics) {
    diagnostics.brandingDurationMs = Date.now() - startedAt
    diagnostics.brandingFallbackReason = branding.fallbackReason || 'none'
    diagnostics.brandingSource = branding.brandingSource
    diagnostics.teamId = normalizePdfText(scope.team?.id)
  }

  return branding
}
