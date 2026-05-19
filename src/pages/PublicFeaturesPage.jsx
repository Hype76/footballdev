import fallbackLogo from '../assets/player-feedback-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'

const featureGroups = [
  {
    title: 'Player development records',
    copy: 'Keep trial notes, squad history, positions, assessment scores, and coach decisions tied to the player profile.',
    points: ['Custom assessment forms', 'Trial and squad status', 'Previous assessment history'],
  },
  {
    title: 'Team and staff control',
    copy: 'Give coaches access to the teams they work with, then let Team Admins enforce appearance and settings for that team.',
    points: ['Role based access', 'Team branding controls', 'Staff allocation by team'],
  },
  {
    title: 'Sessions and match days',
    copy: 'Build session lists, assess from the pitch, track match day scoring, and keep updates attached to the correct team.',
    points: ['Training session workflows', 'Match day live updates', 'Coach friendly mobile views'],
  },
  {
    title: 'Parent communication',
    copy: 'Turn coach input into clear parent messages without asking staff to rewrite the same feedback every week.',
    points: ['Parent portal access', 'Email templates', 'Polls and messages'],
  },
]

export function PublicFeaturesPage() {
  return (
    <main className="min-h-screen bg-[#061009] text-white">
      <LoginHeader logo={fallbackLogo} />
      <section className="relative overflow-hidden">
        <img src={landingHeroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#061009] via-[#061009]/88 to-[#061009]/58" />
        <div className="relative mx-auto grid min-h-[62vh] w-full max-w-7xl items-end gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_0.85fr] lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ff2f]">Features</p>
            <h1 className="mt-5 text-4xl font-black leading-[1.03] tracking-tight sm:text-6xl">
              Built for the actual week of a football club.
            </h1>
            <p className="mt-6 text-base leading-8 text-slate-200 sm:text-lg">
              Player Feedback focuses on the work that normally gets split across paper forms, spreadsheets, WhatsApp messages, and memory.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-12 sm:px-6 md:grid-cols-2 lg:px-8">
        {featureGroups.map((feature) => (
          <article key={feature.title} className="rounded-lg border border-white/10 bg-white/[0.045] p-6 shadow-xl shadow-black/20">
            <h2 className="text-2xl font-black tracking-tight">{feature.title}</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">{feature.copy}</p>
            <ul className="mt-6 space-y-3">
              {feature.points.map((point) => (
                <li key={point} className="flex gap-3 text-sm font-bold text-slate-100">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#d8ff2f]" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
        <div className="grid gap-5 rounded-lg border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-2xl font-black tracking-tight">Ready to see the workspace?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-200">Open the demo account or choose a plan that matches your club size.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90">
              Login
            </a>
            <a href="/pricing" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-black text-white transition hover:bg-white/[0.1]">
              View Pricing
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
