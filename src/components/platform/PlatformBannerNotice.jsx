import { useEffect, useState } from 'react'
import { getPlatformBannerByKey } from '../../lib/supabase.js'
import {
  getDefaultPlatformBanner,
  getPlatformBannerTextColor,
} from '../../lib/platform-banner-config.js'

export function PlatformBannerNotice({
  ariaLabel = 'Platform announcement',
  bannerKey,
  className = '',
}) {
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    let isMounted = true

    const loadBanner = async () => {
      try {
        const nextBanner = await getPlatformBannerByKey(bannerKey)

        if (isMounted) {
          setBanner(nextBanner)
        }
      } catch (error) {
        console.error(`${ariaLabel} could not be loaded`, error)

        if (isMounted) {
          setBanner(getDefaultPlatformBanner(bannerKey))
        }
      }
    }

    void loadBanner()

    return () => {
      isMounted = false
    }
  }, [ariaLabel, bannerKey])

  if (!banner?.enabled) {
    return null
  }

  return (
    <aside
      role="status"
      aria-label={ariaLabel}
      className={`border-y border-black/10 px-4 py-3 shadow-sm shadow-black/15 sm:px-6 lg:px-8 ${className}`.trim()}
      style={{
        backgroundColor: banner.backgroundColor,
        color: getPlatformBannerTextColor(banner.backgroundColor),
      }}
    >
      <p className="mx-auto max-w-7xl text-center text-sm font-black leading-6 sm:text-base">
        {banner.message}
      </p>
    </aside>
  )
}
