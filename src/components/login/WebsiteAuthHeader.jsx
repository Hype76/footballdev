import { useEffect, useState } from 'react'
import { MarketingContactDialog } from '../marketing/MarketingContactDialog.jsx'
import { PlatformBannerNotice } from '../platform/PlatformBannerNotice.jsx'
import { PUBLIC_SITE_BANNER_KEY } from '../../lib/platform-banner-config.js'

const links = [['/matchday/', 'Match Day'], ['/for-teams/', 'Teams'], ['/development/', 'Development'], ['/clubs/', 'Clubs'], ['/pricing/', 'Plans'], ['/how-to/', 'How to'], ['/articles/', 'Articles'], ['/about-us/', 'About us']]

export function WebsiteAuthHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  useEffect(() => {
    const openContact = () => setContactOpen(true)
    const closeMenu = event => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('football-player:open-contact', openContact)
    window.addEventListener('keydown', closeMenu)
    return () => {
      window.removeEventListener('football-player:open-contact', openContact)
      window.removeEventListener('keydown', closeMenu)
    }
  }, [])
  return <>
    <PlatformBannerNotice ariaLabel="Platform announcement" bannerKey={PUBLIC_SITE_BANNER_KEY} />
    <header className="website-auth-header">
      <div className="website-auth-nav-inner">
        <a className="website-auth-brand" href="/"><img src="/marketing-v70/assets/fp-logo.png" alt="" />Football Player</a>
        <button className="website-auth-menu" type="button" aria-expanded={menuOpen} aria-controls="website-auth-navigation" onClick={() => setMenuOpen(value => !value)}>Menu</button>
        <nav id="website-auth-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Main navigation">
          {links.map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
          <button type="button" onClick={() => { setMenuOpen(false); setContactOpen(true) }}>Contact</button>
          <a className="website-auth-nav-sign" href="/sign-in/choose" aria-current="page">Sign in</a>
        </nav>
      </div>
    </header>
    <MarketingContactDialog open={contactOpen} onClose={() => setContactOpen(false)} />
  </>
}
