import {
  CLUB_LOGOS_BUCKET,
  MAX_LOGO_FILE_SIZE_BYTES,
  supabase,
} from '../supabase-client.js'
import {
  getCachedResource,
  invalidateMemoryCacheByPrefix,
} from './cache-store.js'
import {
  CLUB_SELECT,
} from './core-constants.js'
import {
  appendLogoCacheBuster,
  getLogoContentType,
  isStoredClubLogoUrl,
} from './club-logo-utils.js'
import { normalizeClubSettingsRow } from './club-settings-normalizers.js'
import {
  assertClubFeature,
} from './plan-gates.js'
import { fetchClubDetails } from './club-data.js'
import {
  blockDemoMutation,
} from './demo-guards.js'

export async function getClubSettings(clubId) {
  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  const data = await getCachedResource(`club-settings:${clubId}`, () => fetchClubDetails(clubId))

  if (!data) {
    throw new Error('Club not found.')
  }

  return normalizeClubSettingsRow(data)
}

export async function updateClubSettings({ clubId, data, user = null }) {
  await blockDemoMutation(user)

  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  const currentClub = await fetchClubDetails(clubId)
  const currentLogoUrl = String(currentClub?.logo_url ?? '').trim()
  const nextLogoUrl = String(data.logoUrl ?? '').trim()
  const logoChanged = nextLogoUrl !== currentLogoUrl

  if (logoChanged) {
    await assertClubFeature({
      user,
      clubId,
      featureName: 'basicBranding',
    })
  }

  if (data.requireApproval !== undefined && Boolean(data.requireApproval) !== Boolean(currentClub?.require_approval ?? true)) {
    await assertClubFeature({
      user,
      clubId,
      featureName: 'approvalWorkflow',
    })
  }

  const payload = {
    name: String(data.name ?? '').trim(),
    logo_url: String(data.logoUrl ?? '').trim(),
    contact_email: String(data.contactEmail ?? '').trim(),
    contact_phone: String(data.contactPhone ?? '').trim(),
  }

  if (data.requireApproval !== undefined) {
    payload.require_approval = Boolean(data.requireApproval)
  }

  const { data: updatedClub, error } = await supabase
    .from('clubs')
    .update(payload)
    .eq('id', clubId)
    .select(CLUB_SELECT)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`club-settings:${clubId}`)
  invalidateMemoryCacheByPrefix(`club:${clubId}`)
  invalidateMemoryCacheByPrefix('user-profile:')

  return normalizeClubSettingsRow(updatedClub)
}

async function uploadClubLogoBlob({ clubId, blob }) {
  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  if (!(blob instanceof Blob)) {
    throw new Error('A logo image is required.')
  }

  if (!String(blob.type ?? '').toLowerCase().startsWith('image/')) {
    throw new Error('Logo must be an image file.')
  }

  if (blob.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error('Logo must be 2MB or smaller.')
  }

  const objectPath = `${clubId}/logo.png`
  const { error: uploadError } = await supabase.storage.from(CLUB_LOGOS_BUCKET).upload(objectPath, blob, {
    cacheControl: '3600',
    contentType: blob.type || 'image/png',
    upsert: true,
  })

  if (uploadError) {
    console.error(uploadError)
    throw uploadError
  }

  const { data } = supabase.storage.from(CLUB_LOGOS_BUCKET).getPublicUrl(objectPath)
  const publicUrl = String(data?.publicUrl ?? '').trim()

  if (!publicUrl) {
    throw new Error('Could not generate logo URL.')
  }

  return appendLogoCacheBuster(publicUrl)
}

export async function uploadClubLogo({ clubId, file, user = null }) {
  await blockDemoMutation(user)

  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  await assertClubFeature({
    user,
    clubId,
    featureName: 'basicBranding',
  })

  if (!(file instanceof File)) {
    throw new Error('A logo file is required.')
  }

  if (!String(file.type ?? '').toLowerCase().startsWith('image/')) {
    throw new Error('Logo must be an image file.')
  }

  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error('Logo must be 2MB or smaller.')
  }

  return uploadClubLogoBlob({ clubId, blob: file })
}

export async function importClubLogoFromUrl({ clubId, logoUrl, user = null }) {
  await blockDemoMutation(user)

  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  await assertClubFeature({
    user,
    clubId,
    featureName: 'basicBranding',
  })

  if (!normalizedLogoUrl) {
    return ''
  }

  if (isStoredClubLogoUrl(clubId, normalizedLogoUrl)) {
    return normalizedLogoUrl
  }

  let parsedUrl

  try {
    parsedUrl = new URL(normalizedLogoUrl)
  } catch {
    throw new Error('Enter a valid logo URL.')
  }

  let response

  try {
    response = await fetch(parsedUrl.toString(), {
      mode: 'cors',
    })
  } catch (error) {
    console.error(error)
    throw new Error('Logo image could not be downloaded. Upload the image file instead.')
  }

  if (!response.ok) {
    throw new Error('Logo image could not be downloaded. Upload the image file instead.')
  }

  const blob = await response.blob()
  const contentType = getLogoContentType(parsedUrl, response, blob)

  if (!contentType) {
    throw new Error('That URL did not download as an image. Upload the image file instead.')
  }

  return uploadClubLogoBlob({
    clubId,
    blob: new Blob([blob], {
      type: contentType,
    }),
  })
}
