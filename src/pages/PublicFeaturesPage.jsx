import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'

const featureGroups = [
  {
    title: 'Player development records',
    copy: 'Keep trial notes, squad history, positions, development scores, and coach decisions tied to the player profile.',
    points: ['Custom development forms', 'Trial and squad status', 'Previous development history'],
  },
  {
    title: 'Team and staff control',
    copy: 'Give coaches access to the teams they work with, then let Team Admins enforce appearance and settings for that team.',
    points: ['Role based access', 'Team branding controls', 'Staff allocation by team'],
  },
  {
    title: 'Sessions and match days',
    copy: 'Build session lists, record from the pitch, track match day scoring, and keep updates attached to the correct team.',
    points: ['Training session workflows', 'Match day live updates', 'Coach friendly mobile views'],
  },
  {
    title: 'Parent communication',
    copy: 'Turn coach input into clear parent messages without asking staff to rewrite the same feedback every week.',
    points: ['Parent portal access', 'Email templates', 'Polls and messages'],
  },
]

export function PublicFeaturesPage() {
  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-[max(5.5rem,env(safe-area-inset-bottom))] text-slate-950 lg:pb-0">
      <LoginHeader logo={fallbackLogo} />
      <section className="relative overflow-hidden">
        <img src={landingHeroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-100" />
        <div className="absolute inset-0 bg-white/82" />
        <div className="absolute inset-0 bg-white/70" />
        <div className="relative mx-auto grid min-h-[48svh] w-full max-w-7xl items-end gap-8 px-4 py-12 sm:min-h-[54svh] sm:px-6 sm:py-16 lg:min-h-[62vh] lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Features</p>
            <h1 className="mt-4 text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-6xl">
              Academy standards, built for grassroots football.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-700 sm:mt-6 sm:text-lg sm:leading-8">
              Bring professional structure to trials, player development, staff access, match days, and parent communication without making club admin harder.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-8 sm:gap-5 sm:px-6 sm:py-12 md:grid-cols-2 lg:px-8">
        {featureGroups.map((feature) => (
          <article key={feature.title} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-black tracking-tight sm:text-2xl">{feature.title}</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">{feature.copy}</p>
            <ul className="mt-6 space-y-3">
              {feature.points.map((point) => (
                <li key={point} className="flex gap-3 text-sm font-bold text-slate-800">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-sm bg-emerald-600" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="grid gap-5 rounded-lg border border-emerald-200 bg-emerald-50 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-xl font-black tracking-tight sm:text-2xl">Try it now, or contact us.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Open the demo account, ask a question, or choose a plan that matches your club size.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800">
              Try Now
            </a>
            <button
              type="button"
              onClick={openContactModal}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50"
            >
              Contact Us
            </button>
            <a href="/pricing" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50">
              View Pricing
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
