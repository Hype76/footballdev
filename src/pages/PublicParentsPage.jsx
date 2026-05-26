import fallbackLogo from '../assets/football-player-logo.png'
import parentPortalGoalPhoneImage from '../assets/parent-portal-goal-phone.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'

const parentCards = [
  ['Linked children', 'Parents only see children the club has connected to their email address.'],
  ['Match day ready', 'Live cards, scorer requests, and previous results sit beside messages and polls.'],
  ['Staff controlled', 'Coaches decide what gets shared, when parents can respond, and which reports are visible.'],
]

const parentRules = [
  ['No chat sprawl', 'Club updates live in one parent record instead of disappearing into group messages.'],
  ['Clear constraints', 'Polls, match access, and attachments explain what parents can do before they act.'],
  ['Football only', 'The portal is built around players, teams, fixtures, reports, and parent actions.'],
]

export function PublicParentsPage() {
  return (
    <main className="min-h-screen bg-[#f8fafc] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-[#0f172a] lg:pb-0">
      <LoginHeader logo={fallbackLogo} />
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12 lg:grid-cols-[0.85fr_1fr] lg:gap-8 lg:px-8 lg:py-16">
        <div className="order-2 flex items-start justify-center overflow-hidden rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10 sm:p-6 lg:sticky lg:top-28 lg:order-1 lg:max-h-[820px]">
          <img
            src={parentPortalGoalPhoneImage}
            alt="Mobile phone showing a Football Player goal celebration"
            className="max-h-[760px] min-h-[320px] w-full object-contain sm:min-h-[440px] lg:min-h-0"
          />
        </div>
        <div className="order-1 flex flex-col justify-center lg:order-2">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Parents portal</p>
          <h1 className="mt-4 text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-6xl">
            Parent communication built around the football week.
          </h1>
          <p className="mt-5 text-base font-semibold leading-7 text-[#475569] sm:mt-6 sm:text-lg sm:leading-8">
            Give parents a controlled place for club messages, match day cards, development PDFs, and polls without turning coaches into full-time admins.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href="/parents/portal"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1d4ed8]"
            >
              Parent Portal
            </a>
            <a
              href="/pricing"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-5 py-3 text-sm font-black text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc]"
            >
              View Pricing
            </a>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {parentCards.map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10 sm:p-5">
                <h2 className="text-lg font-black sm:text-xl">{title}</h2>
                <p className="mt-2 text-sm font-semibold leading-7 text-[#475569]">{copy}</p>
              </article>
            ))}
          </div>
          <section className="mt-5 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-5 shadow-sm shadow-[#2563eb]/10">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">How it should feel</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {parentRules.map(([title, copy]) => (
                <article key={title} className="rounded-lg border border-[#cbd5e1] bg-white p-4">
                  <h2 className="text-sm font-black text-[#0f172a]">{title}</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{copy}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
