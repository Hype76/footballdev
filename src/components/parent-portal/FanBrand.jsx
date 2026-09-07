import { useEffect, useState } from 'react'
import { fanBrandingLink, fanBrandWebStyle } from '../../lib/fan-branding.js'

export function FanBrandScope({ source, children, className = '' }) {
  const [mode, setMode] = useState(() => document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light')
  useEffect(() => {
    const update = () => setMode(document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light')
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return <div className={className} data-fan-club={fanBrandingLink(source).clubId} style={source ? fanBrandWebStyle(source, mode) : undefined}>{children}</div>
}

export function FanClubBrand({ source }) {
  const brand = fanBrandingLink(source)
  const [failedUrl, setFailedUrl] = useState('')
  if (!brand.clubName) return null
  return <div className="fans-club-brand">
    {brand.clubLogoUrl && failedUrl !== brand.clubLogoUrl ? <img src={brand.clubLogoUrl} alt={`${brand.clubName} logo`} onError={() => setFailedUrl(brand.clubLogoUrl)} /> : <span aria-hidden="true" className="fans-club-initial">{brand.clubName.slice(0, 1)}</span>}
    <strong>{brand.clubName}</strong>
  </div>
}
