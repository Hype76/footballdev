import fallbackLogo from '../assets/player-feedback-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'

const parentCards = [
  ['One place for updates', 'Parents can see linked children, match day information, messages, and polls without searching through old chats.'],
  ['Controlled by the team', 'Team Admins set the appearance and the parent portal inherits it, so the experience feels like the club.'],
  ['Useful feedback', 'Reports focus on development, effort, and next steps instead of sending raw coach notes.'],
]

export function PublicParentsPage() {
  return (
    <main className="min-h-screen bg-[#061009] text-white">
      <LoginHeader logo={fallbackLogo} />
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1fr] lg:px-8 lg:py-16">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
          <img src={landingHeroImage} alt="Coach using Player Feedback beside a football pitch" className="h-full min-h-[420px] w-full object-cover" />
        </div>
        <div className="flex flex-col justify-center">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ff2f]">Parents portal</p>
          <h1 className="mt-5 text-4xl font-black leading-[1.03] tracking-tight sm:text-6xl">
            Better parent communication without extra coach admin.
          </h1>
          <p className="mt-6 text-base leading-8 text-slate-300 sm:text-lg">
            Parents need clear updates. Coaches need less admin. The parent portal gives clubs a controlled, branded way to share what matters.
          </p>
          <div className="mt-8 grid gap-4">
            {parentCards.map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-white/10 bg-white/[0.045] p-5">
                <h2 className="text-xl font-black">{title}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-300">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
