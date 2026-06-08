import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import sessionsCalendarImage from '../assets/marketing/sessions-calendar.png'
import playersListImage from '../assets/marketing/players-list.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { LoginHeroContent } from '../components/login/LoginHeroContent.jsx'
import { publicImageBottomFadeStyle, publicImageOverlayStyle, usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'

const weeklySections = [
  {
    title: 'Plan the week in one place',
    copy: 'Training sessions, fixtures, parent response cut offs, and saved development activity sit together so staff know what is coming next.',
    image: sessionsCalendarImage,
    alt: 'Football Player calendar showing training and match activity',
  },
  {
    title: 'Keep player records attached to the player',
    copy: 'Coaches can find the current squad, trial players, previous records, and development notes without hunting through messages.',
    image: playersListImage,
    alt: 'Football Player player register showing squad and trial records',
  },
]

const outcomes = [
  ['Less chasing', 'Parents, players, sessions, and match day actions are connected to the same team record.'],
  ['Faster coaching', 'Common weekly jobs are surfaced early so staff can act from a phone or laptop.'],
  ['Better memory', "Development notes and progression stay with the player, not in someone else's chat history."],
]

export function PublicLandingPage() {
  usePublicThemeScope()

  return (
    <main className="bg-[var(--app-bg)] text-[var(--text-primary)]">
      <section className="relative min-h-dvh overflow-hidden">
        <div className="absolute inset-0">
          <img src={landingHeroImage} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0" style={publicImageOverlayStyle} />
          <div className="absolute inset-x-0 bottom-0 h-40" style={publicImageBottomFadeStyle} />
        </div>

        <div className="relative flex min-h-dvh w-full flex-col">
          <LoginHeader logo={fallbackLogo} />

          <div className="mx-auto grid w-full max-w-7xl flex-1 items-center px-4 py-8 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10 lg:px-8 lg:pb-16">
            <LoginHeroContent />
          </div>
        </div>
      </section>

      <section className="border-y border-[color-mix(in_srgb,var(--border-color)_72%,transparent)] bg-[var(--panel-bg)]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-3 lg:px-8">
          {outcomes.map(([title, copy]) => (
            <article key={title} className="py-2">
              <h2 className="text-xl font-black tracking-tight text-[var(--text-primary)]">{title}</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-secondary)]">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--accent)]">What clubs do with it</p>
          <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-[var(--text-primary)] sm:text-4xl">
            A quieter way to run training, match day, parents, and player development.
          </h2>
          <p className="mt-4 text-base font-semibold leading-7 text-[var(--text-secondary)]">
            Football Player keeps the weekly rhythm visible, then lets staff open the exact workflow they need.
          </p>
        </div>

        {weeklySections.map((section, index) => (
          <article key={section.title} className="grid gap-6 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
            <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
              <h3 className="text-2xl font-black tracking-tight text-[var(--text-primary)] sm:text-3xl">{section.title}</h3>
              <p className="mt-4 text-base font-semibold leading-7 text-[var(--text-secondary)]">{section.copy}</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a href="/features" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-black text-[var(--accent-text)] transition hover:opacity-90">
                  Explore features
                </a>
                <a href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-black text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)]">
                  Open workspace
                </a>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-xl shadow-black/10">
              <img src={section.image} alt={section.alt} className="w-full" />
            </div>
          </article>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="grid gap-6 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--accent)]">Ready when the club is</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)] sm:text-3xl">Start with one team, then grow into the whole club.</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-secondary)]">
              Use the demo, create an account, or speak to us about the right setup for your coaches and parents.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-black text-[var(--accent-text)] transition hover:opacity-90">
              Start free
            </a>
            <a href="/pricing" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--app-bg)] px-5 py-3 text-sm font-black text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)]">
              View pricing
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
