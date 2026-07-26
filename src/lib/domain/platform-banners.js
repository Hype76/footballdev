import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { blockDemoMutation } from './demo-guards.js'
import {
  DEFAULT_PLATFORM_BANNERS,
  PLATFORM_BANNER_KEYS,
  PUBLIC_SITE_BANNER_KEY,
  getDefaultPlatformBanner,
  normalizePlatformBanner,
  validatePlatformBannerDraft,
} from '../platform-banner-config.js'

const PLATFORM_BANNER_SELECT = 'banner_key, enabled, message, background_color, updated_at'

function assertPlatformBannerKey(bannerKey) {
  if (!PLATFORM_BANNER_KEYS.includes(bannerKey)) {
    throw new Error('Choose a valid banner audience.')
  }
}

export async function getPlatformBannerByKey(bannerKey) {
  assertPlatformBannerKey(bannerKey)

  const { data, error } = await supabase
    .from('platform_banners')
    .select(PLATFORM_BANNER_SELECT)
    .eq('banner_key', bannerKey)
    .maybeSingle()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizePlatformBanner(data, getDefaultPlatformBanner(bannerKey))
}

export async function getPublicPlatformBanner() {
  return getPlatformBannerByKey(PUBLIC_SITE_BANNER_KEY)
}

export async function getPlatformBanners({ user }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can manage platform banners.')
  }

  const { data, error } = await supabase
    .from('platform_banners')
    .select(PLATFORM_BANNER_SELECT)
    .in('banner_key', PLATFORM_BANNER_KEYS)

  if (error) {
    console.error(error)
    throw error
  }

  return (Array.isArray(data) ? data : []).reduce(
    (banners, row) => ({
      ...banners,
      [row.banner_key]: normalizePlatformBanner(row, getDefaultPlatformBanner(row.banner_key)),
    }),
    { ...DEFAULT_PLATFORM_BANNERS },
  )
}

export async function getPlatformBanner({ user, bannerKey = PUBLIC_SITE_BANNER_KEY }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can manage platform banners.')
  }

  return getPlatformBannerByKey(bannerKey)
}

export async function updatePlatformBanner({ user, bannerKey = draft?.bannerKey, draft }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can manage platform banners.')
  }

  assertPlatformBannerKey(bannerKey)
  const validatedDraft = validatePlatformBannerDraft(draft)
  const { data, error } = await supabase
    .from('platform_banners')
    .update({
      enabled: validatedDraft.enabled,
      message: validatedDraft.message,
      background_color: validatedDraft.backgroundColor,
    })
    .eq('banner_key', bannerKey)
    .select(PLATFORM_BANNER_SELECT)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  const banner = normalizePlatformBanner(data, getDefaultPlatformBanner(bannerKey))

  await createAuditLog({
    user,
    action: 'platform_banner_updated',
    entityType: 'platform_banner',
    entityId: null,
    metadata: {
      bannerKey: banner.bannerKey,
      enabled: banner.enabled,
      backgroundColor: banner.backgroundColor,
    },
  })

  return banner
}
