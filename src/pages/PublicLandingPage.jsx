import fallbackLogo from '../assets/player-feedback-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { LoginHeroContent } from '../components/login/LoginHeroContent.jsx'

export function PublicLandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#061009] text-white">
      <div className="fixed inset-0">
        <img src={landingHeroImage} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#061009] via-[#061009]/82 to-[#061009]/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#061009] via-transparent to-[#061009]/35" />
      </div>

      <div className="relative flex min-h-screen w-full flex-col">
        <LoginHeader logo={fallbackLogo} />

        <div className="mx-auto grid w-full max-w-7xl flex-1 items-center px-4 py-10 sm:px-6 lg:px-8">
          <LoginHeroContent />
        </div>
      </div>
    </main>
  )
}
