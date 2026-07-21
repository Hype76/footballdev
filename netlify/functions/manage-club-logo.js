import { createHash } from 'node:crypto'
import { assertPlanFeature, getAuthenticatedPlanProfile } from './lib/_plan-gate.js'
import { supabaseAdmin } from './lib/_supabase.js'
import {
  decodeClubLogoBase64,
  validateAndNormalizeClubLogo,
} from './lib/_club-logo-validation.js'
import { assertClubLogoActorAuthority } from './lib/_club-logo-authority.js'

const CLUB_LOGOS_BUCKET = 'club-logos'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function publicLogoUrl(objectPath) {
  const { data } = supabaseAdmin.storage.from(CLUB_LOGOS_BUCKET).getPublicUrl(objectPath)
  return normalizeText(data?.publicUrl)
}

export function managedClubLogoPathFromUrl(logoUrl, clubId) {
  const normalizedUrl = normalizeText(logoUrl)

  if (!normalizedUrl || !clubId) {
    return ''
  }

  try {
    const pathname = decodeURIComponent(new URL(normalizedUrl).pathname)
    const marker = `/storage/v1/object/public/${CLUB_LOGOS_BUCKET}/`
    const markerIndex = pathname.indexOf(marker)

    if (markerIndex < 0) {
      return ''
    }

    const objectPath = pathname.slice(markerIndex + marker.length)

    if (!objectPath.startsWith(`${clubId}/`) || objectPath.includes('..') || objectPath.includes('\\')) {
      return ''
    }

    return objectPath
  } catch {
    return ''
  }
}

async function replaceClubLogo({ body, clubId }) {
  const sourceBuffer = decodeClubLogoBase64(body.dataBase64)
  const validated = await validateAndNormalizeClubLogo({
    buffer: sourceBuffer,
    declaredMimeType: body.mimeType,
    fileName: body.fileName,
  })
  const contentHash = createHash('sha256').update(validated.buffer).digest('hex')
  const objectPath = `${clubId}/logos/${contentHash}.png`
  const { data: club, error: clubError } = await supabaseAdmin
    .from('clubs')
    .select('logo_url')
    .eq('id', clubId)
    .maybeSingle()

  if (clubError || !club) {
    throw Object.assign(new Error('The club could not be verified for this logo update.'), { statusCode: 404 })
  }

  const previousObjectPath = managedClubLogoPathFromUrl(club.logo_url, clubId)
  const { error: uploadError } = await supabaseAdmin.storage.from(CLUB_LOGOS_BUCKET).upload(
    objectPath,
    validated.buffer,
    {
      cacheControl: '31536000',
      contentType: validated.contentType,
      upsert: true,
    },
  )

  if (uploadError) {
    throw Object.assign(new Error('The validated logo could not be stored. The existing logo was kept.'), { statusCode: 502 })
  }

  const logoUrl = publicLogoUrl(objectPath)

  if (!logoUrl) {
    throw Object.assign(new Error('The logo was stored but its display URL could not be generated.'), { statusCode: 502 })
  }

  const { error: updateError } = await supabaseAdmin
    .from('clubs')
    .update({ logo_url: logoUrl })
    .eq('id', clubId)

  if (updateError) {
    if (previousObjectPath !== objectPath) {
      await supabaseAdmin.storage.from(CLUB_LOGOS_BUCKET).remove([objectPath])
    }

    throw Object.assign(new Error('The club record could not be updated. The existing logo was kept.'), { statusCode: 502 })
  }

  let oldLogoCleanupDeferred = false

  if (previousObjectPath && previousObjectPath !== objectPath) {
    const { error: cleanupError } = await supabaseAdmin.storage.from(CLUB_LOGOS_BUCKET).remove([previousObjectPath])
    oldLogoCleanupDeferred = Boolean(cleanupError)
  }

  return {
    contentType: validated.contentType,
    height: validated.height,
    logoUrl,
    oldLogoCleanupDeferred,
    width: validated.width,
  }
}

export function createManageClubLogoHandler({
  assertAuthority = assertClubLogoActorAuthority,
  assertFeature = assertPlanFeature,
  authenticate = getAuthenticatedPlanProfile,
  logger = console,
  replaceLogo = replaceClubLogo,
} = {}) {
  return async function manageClubLogo(event) {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { success: false, message: 'Method Not Allowed' })
    }

    try {
      const body = JSON.parse(event.body || '{}')
      const clubId = normalizeText(body.clubId)

      if (!clubId) {
        return jsonResponse(400, { success: false, message: 'Club details are required.' })
      }

      const profile = await authenticate(event, { clubId })
      const authority = assertAuthority(profile, clubId)

      if (!authority.isPlatformAdmin) {
        assertFeature(profile, 'basicLogoBranding')
      }
      const result = await replaceLogo({ body, clubId })

      return jsonResponse(200, { success: true, ...result })
    } catch (error) {
      logger.error('Club logo operation failed', {
        message: error?.message,
        statusCode: error?.statusCode,
      })
      return jsonResponse(error.statusCode || 500, {
        success: false,
        message: error.message || 'The club logo could not be updated.',
      })
    }
  }
}

const manageClubLogo = createManageClubLogoHandler()

export async function handler(event) {
  return manageClubLogo(event)
}
