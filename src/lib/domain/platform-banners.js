import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { blockDemoMutation } from './demo-guards.js'
import {
  DEFAULT_PUBLIC_SITE_BANNER,
  PUBLIC_SITE_BANNER_KEY,
  normalizePlatformBanner,
  validatePlatformBannerDraft,
} from '../platform-banner-config.js'

const PLATFORM_BANNER_SELECT = 'banner_key, enabled, message, background_color, updated_at'

export async function getPublicPlatformBanner() {
  const { data, error } = await supabase
    .from('platform_banners')
    .select(PLATFORM_BANNER_SELECT)
    .eq('banner_key', PUBLIC_SITE_BANNER_KEY)
    .maybeSingle()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizePlatformBanner(data, DEFAULT_PUBLIC_SITE_BANNER)
}

export async function getPlatformBanner({ user }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can manage public banners.')
  }

  return getPublicPlatformBanner()
}

export async function updatePlatformBanner({ user, draft }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can manage public banners.')
  }

  const validatedDraft = validatePlatformBannerDraft(draft)
  const { data, error } = await supabase
    .from('platform_banners')
    .update({
      enabled: validatedDraft.enabled,
      message: validatedDraft.message,
      background_color: validatedDraft.backgroundColor,
    })
    .eq('banner_key', PUBLIC_SITE_BANNER_KEY)
    .select(PLATFORM_BANNER_SELECT)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  const banner = normalizePlatformBanner(data, DEFAULT_PUBLIC_SITE_BANNER)

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
