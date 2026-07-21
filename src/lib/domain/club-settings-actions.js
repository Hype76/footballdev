import { MAX_LOGO_FILE_SIZE_BYTES, supabase } from '../supabase-client.js'
import { CAPABILITIES } from '../paywall-access.js'
import {
  getCachedResource,
  invalidateMemoryCacheByPrefix,
} from './cache-store.js'
import {
  CLUB_SELECT,
} from './core-constants.js'
import {
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
    if (user?.role !== 'admin') {
      throw new Error('Only club admins can change the club logo.')
    }

    await assertClubFeature({
      user,
      clubId,
      featureName: CAPABILITIES.basicLogoBranding,
    })
  }

  if (data.requireApproval !== undefined && Boolean(data.requireApproval) !== Boolean(currentClub?.require_approval ?? true)) {
    await assertClubFeature({
      user,
      clubId,
      featureName: CAPABILITIES.approvalWorkflows,
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

async function readBlobAsBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }

  return btoa(binary)
}

async function uploadClubLogoBlob({ clubId, blob, fileName }) {
  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  if (!(blob instanceof Blob)) {
    throw new Error('A logo image is required.')
  }

  const mimeType = String(blob.type ?? '').trim().toLowerCase()

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('Use a PNG, JPG, or WebP logo.')
  }

  if (blob.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error('Logo must be 2MB or smaller.')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = String(sessionData?.session?.access_token ?? '').trim()

  if (sessionError || !accessToken) {
    throw new Error('Sign in again before uploading a club logo.')
  }

  const response = await fetch('/.netlify/functions/manage-club-logo', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clubId,
      dataBase64: await readBlobAsBase64(blob),
      fileName,
      mimeType,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  const publicUrl = String(payload?.logoUrl ?? '').trim()

  if (!response.ok || !payload?.success || !publicUrl) {
    throw new Error(payload?.message || 'The club logo could not be uploaded.')
  }

  const separator = publicUrl.includes('?') ? '&' : '?'
  return `${publicUrl}${separator}v=${Date.now()}`
}

export async function uploadClubLogo({ clubId, file, user = null }) {
  await blockDemoMutation(user)

  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  if (user?.role !== 'admin') {
    throw new Error('Only club admins can change the club logo.')
  }

  await assertClubFeature({
    user,
    clubId,
    featureName: CAPABILITIES.basicLogoBranding,
  })

  if (!(file instanceof File)) {
    throw new Error('A logo file is required.')
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(file.type ?? '').toLowerCase())) {
    throw new Error('Use a PNG, JPG, or WebP logo.')
  }

  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error('Logo must be 2MB or smaller.')
  }

  return uploadClubLogoBlob({ clubId, blob: file, fileName: file.name })
}

export async function importClubLogoFromUrl({ clubId, logoUrl, user = null }) {
  await blockDemoMutation(user)

  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  if (user?.role !== 'admin') {
    throw new Error('Only club admins can change the club logo.')
  }

  await assertClubFeature({
    user,
    clubId,
    featureName: CAPABILITIES.basicLogoBranding,
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
    fileName: `imported-logo.${contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]}`,
  })
}
