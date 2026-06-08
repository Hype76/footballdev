import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { LoginHeroContent } from '../components/login/LoginHeroContent.jsx'
import { publicImageBottomFadeStyle, publicImageOverlayStyle, usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'

export function PublicLandingPage() {
  usePublicThemeScope()

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      <div className="absolute inset-0">
        <img src={landingHeroImage} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0" style={publicImageOverlayStyle} />
        <div className="absolute inset-x-0 bottom-0 h-40" style={publicImageBottomFadeStyle} />
      </div>

      <div className="relative flex min-h-dvh w-full flex-col">
        <LoginHeader logo={fallbackLogo} />

        <div className="mx-auto grid w-full max-w-7xl flex-1 items-center px-4 py-8 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10 lg:px-8 lg:pb-10">
          <LoginHeroContent />
        </div>
      </div>
    </main>
  )
}
