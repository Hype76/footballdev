import fallbackLogo from '../assets/football-player-logo.png'
import parentPortalGoalPhoneImage from '../assets/parent-portal-goal-phone.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { ParentPortalLoginBox } from '../components/login/ParentPortalLoginBox.jsx'

export function PublicParentPortalLoginPage() {
  return (
    <main className="min-h-screen bg-[#f7faf8] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-[#101828] lg:pb-0">
      <LoginHeader logo={fallbackLogo} />
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12 lg:grid-cols-[0.75fr_1fr] lg:gap-8 lg:px-8 lg:py-16">
        <div className="order-2 flex items-start justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-6 lg:order-1">
          <img
            src={parentPortalGoalPhoneImage}
            alt="Mobile phone showing a Football Player goal notification"
            className="max-h-[680px] min-h-[320px] w-full object-contain sm:min-h-[440px] lg:min-h-0"
          />
        </div>
        <div className="order-1 flex flex-col justify-center lg:order-2">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Family portal</p>
          <h1 className="mt-4 text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-5xl">
            Log in to your family portal.
          </h1>
          <p className="mt-5 text-base font-semibold leading-7 text-[#4b5f55] sm:mt-6 sm:text-lg sm:leading-8">
            Open the account you confirmed by email to view your linked child, club messages, reports, and polls.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ['Messages', 'Read club updates and development PDFs.'],
              ['Match day', 'Follow live cards when staff share them.'],
              ['Polls', 'Answer club questions with clear voting rules.'],
            ].map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
                <p className="text-sm font-black text-[#101828]">{title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{copy}</p>
              </article>
            ))}
          </div>
          <div className="mt-6">
            <ParentPortalLoginBox />
          </div>
        </div>
      </section>
    </main>
  )
}
