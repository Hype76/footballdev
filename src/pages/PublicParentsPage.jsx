import fallbackLogo from '../assets/football-player-logo.png'
import parentPortalGoalPhoneImage from '../assets/parent-portal-goal-phone.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'

const parentCards = [
  ['One place for updates', 'Parents can see linked children, match day information, messages, and polls without searching through old chats.'],
  ['Controlled by the team', 'Team Admins set the appearance and the parent portal inherits it, so the experience feels like the club.'],
  ['Useful feedback', 'Reports focus on development, effort, and next steps instead of sending raw coach notes.'],
]

export function PublicParentsPage() {
  return (
    <main className="min-h-screen bg-[#061009] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-white lg:pb-0">
      <LoginHeader logo={fallbackLogo} />
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12 lg:grid-cols-[0.85fr_1fr] lg:gap-8 lg:px-8 lg:py-16">
        <div className="order-2 flex items-start justify-center overflow-hidden rounded-lg border border-white/10 bg-[#07120a] p-4 sm:p-6 lg:sticky lg:top-28 lg:order-1 lg:max-h-[820px]">
          <img
            src={parentPortalGoalPhoneImage}
            alt="Mobile phone showing a Football Player goal celebration"
            className="max-h-[760px] min-h-[320px] w-full object-contain sm:min-h-[440px] lg:min-h-0"
          />
        </div>
        <div className="order-1 flex flex-col justify-center lg:order-2">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ff2f]">Parents portal</p>
          <h1 className="mt-4 text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-6xl">
            Better parent communication without extra coach admin.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:mt-6 sm:text-lg sm:leading-8">
            Parents need clear updates. Coaches need less admin. The parent portal gives clubs a controlled, branded way to share what matters.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href="/parents/portal"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90"
            >
              Parent Portal
            </a>
            <a
              href="/pricing"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-black text-white transition hover:bg-white/[0.1]"
            >
              View Pricing
            </a>
          </div>
          <div className="mt-8 grid gap-4">
            {parentCards.map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-white/10 bg-white/[0.045] p-4 sm:p-5">
                <h2 className="text-lg font-black sm:text-xl">{title}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-300">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
