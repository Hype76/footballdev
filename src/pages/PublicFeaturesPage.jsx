import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'

const featureGroups = [
  {
    title: 'Setup first',
    copy: 'Create the club, first team, staff access, players, and parent links before opening the wider workspace.',
    points: ['Club identity and logo', 'Team and staff access', 'Player and parent records'],
  },
  {
    title: 'Run the football week',
    copy: 'Keep availability, sessions, match day, and player development records connected to the right team.',
    points: ['Availability decisions', 'Training and match sessions', 'Live match day cards'],
  },
  {
    title: 'Develop players',
    copy: 'Use club-defined development forms so coaches record useful football feedback instead of scattered notes.',
    points: ['Custom forms', 'Trial and squad history', 'Development PDFs'],
  },
  {
    title: 'Keep parents informed',
    copy: 'Share the right updates through a controlled parent portal without staff losing control of records.',
    points: ['Messages and attachments', 'Parent polls', 'Linked child access'],
  },
]

const operatingRules = [
  ['Constraint first', 'The interface explains the rule before the action: who can edit, what data is needed, and what happens next.'],
  ['Football only', 'Every surface maps to club work: teams, players, fixtures, sessions, staff roles, and parent communication.'],
  ['Less admin drift', 'The product should reduce duplicate notes, repeated messages, and manual chasing across chats.'],
]

export function PublicFeaturesPage() {
  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <main className="min-h-screen bg-[#fbfdfb] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-[#101828] lg:pb-0">
      <LoginHeader logo={fallbackLogo} />
      <section className="relative overflow-hidden">
        <img src={landingHeroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-100" />
        <div className="absolute inset-0 bg-white/88" />
        <div className="absolute inset-0 bg-[#fbfdfb]/72" />
        <div className="relative mx-auto grid min-h-[48svh] w-full max-w-7xl items-end gap-8 px-4 py-12 sm:min-h-[54svh] sm:px-6 sm:py-16 lg:min-h-[62vh] lg:px-8">
          <div className="max-w-4xl rounded-lg border border-[#b7efce] bg-white/95 p-5 shadow-sm shadow-[#d7eadf]/80 backdrop-blur sm:p-6 lg:p-8">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Features</p>
            <h1 className="mt-4 text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-6xl">
              A football-only workspace for clubs that need less chaos.
            </h1>
            <p className="mt-5 text-base font-semibold leading-7 text-[#456653] sm:mt-6 sm:text-lg sm:leading-8">
              Build the operating layer clubs actually need: setup, staff roles, players, availability, match day, development records, and parent communication.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-8 sm:gap-5 sm:px-6 sm:py-12 md:grid-cols-2 lg:px-8">
        {featureGroups.map((feature) => (
          <article key={feature.title} className="rounded-lg border border-[#bfe8cd] bg-white p-5 shadow-sm shadow-[#d7eadf]/70 sm:p-6">
            <h2 className="text-xl font-black tracking-tight sm:text-2xl">{feature.title}</h2>
            <p className="mt-4 text-sm font-semibold leading-7 text-[#5f7468]">{feature.copy}</p>
            <ul className="mt-6 space-y-3">
              {feature.points.map((point) => (
                <li key={point} className="flex gap-3 text-sm font-bold text-[#456653]">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#067a46]" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="mb-5 grid gap-3 rounded-lg border border-[#b7efce] bg-[#f0fdf6] p-5 shadow-sm shadow-[#d7eadf]/60 sm:p-6 lg:grid-cols-3">
          {operatingRules.map(([title, copy]) => (
            <article key={title} className="rounded-lg border border-[#b7efce] bg-white p-4">
              <h2 className="text-sm font-black text-[#101828]">{title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{copy}</p>
            </article>
          ))}
        </div>

        <div className="grid gap-5 rounded-lg border border-[#b7efce] bg-[#f0fdf6] p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-xl font-black tracking-tight sm:text-2xl">Try it now, or contact us.</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">Open the demo account, ask a question, or choose a plan that matches your club size.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a]">
              Try Now
            </a>
            <button
              type="button"
              onClick={openContactModal}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:bg-[#f0fdf6]"
            >
              Contact Us
            </button>
            <a href="/pricing" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:bg-[#f0fdf6]">
              View Pricing
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
