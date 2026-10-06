import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import pages from './reference-pages.json'
import { PlatformBannerNotice } from '../platform/PlatformBannerNotice.jsx'
import { PUBLIC_SITE_BANNER_KEY } from '../../lib/platform-banner-config.js'
import { PUBLIC_FREE_SIGNUP_PATH } from '../../lib/public-signup.js'
import { createReferenceScope } from './reference-scope.js'
import { MarketingContactDialog } from './MarketingContactDialog.jsx'
import { mountMarketingPricing } from './marketing-pricing.js'
import './marketing-reference.css'
import './marketing-inline-pages.css'
const modules = import.meta.glob(['./reference-*.js', '!./reference-scope.js'])
const paths = {"app.js":"./reference-app.js","development-builder.js":"./reference-development-builder.js","development.js":"./reference-development.js","footer-qr.js":"./reference-footer-qr.js","kit-preview.js":"./reference-kit-preview.js","offer-share.js":"./reference-offer-share.js","pricing-info.js":"./reference-pricing-info.js","tutorials.js":"./reference-tutorials.js"}
export function MarketingPage({ page = 'home' }) {
  const reference = pages[page] || pages.home, host = useRef(null)
  const [contactOpen, setContactOpen] = useState(false)
  useLayoutEffect(() => {
    const root = host.current; let active = true
    root.innerHTML = reference.html
    root.querySelectorAll('a[href="/sign-in?mode=signup&plan=matchday"]').forEach(link => { link.href = PUBLIC_FREE_SIGNUP_PATH })
    root.querySelectorAll('.signin-new a[href="/sign-in"]').forEach(link => { link.href = PUBLIC_FREE_SIGNUP_PATH })
    root.querySelectorAll('.main-nav a').forEach(link => {
      if (link.textContent.trim() === 'Contact') link.setAttribute('data-contact-open', '')
    })
    const scope = createReferenceScope(root), priorTitle = document.title
    document.title = reference.title
    const disposePricing = page === 'pricing' ? mountMarketingPricing(root) : () => {}
    void (async () => { for (const name of reference.scripts) { const module = await modules[paths[name]]?.(); if (!active) return; module?.default(scope) } })().catch(error => { if (active) console.error('Marketing interaction failed', error) })
    return () => { active = false; disposePricing(); scope.dispose(); root.innerHTML = ''; document.title = priorTitle }
  }, [reference, page])
  useEffect(() => { const open = () => setContactOpen(true); window.addEventListener('football-player:open-contact', open); return () => window.removeEventListener('football-player:open-contact', open) }, [])
  return <div className={`marketing-reference marketing-page-${page}`} onClick={event => { if (event.target.closest('[data-contact-open]')) { event.preventDefault(); setContactOpen(true) } }}>
    <PlatformBannerNotice ariaLabel="Platform announcement" bannerKey={PUBLIC_SITE_BANNER_KEY} />
    <div ref={host} />
    <MarketingContactDialog open={contactOpen} onClose={() => setContactOpen(false)} />
  </div>
}
