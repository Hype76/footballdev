import fallbackLogo from '../assets/football-player-logo.png'
import coachHomeImage from '../assets/marketing/coach-home.png'
import playerProgressionImage from '../assets/marketing/player-progression.png'
import playersListImage from '../assets/marketing/players-list.png'
import sessionsCalendarImage from '../assets/marketing/sessions-calendar.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'

const featureRows = [
  {
    eyebrow: 'Club home',
    title: 'Open the week and see the next useful action.',
    copy: 'Staff land on the team context, active session, player queue, development records, and the work that needs attention next.',
    image: coachHomeImage,
    alt: 'Football Player club home showing session queue and coach records',
  },
  {
    eyebrow: 'Calendar',
    title: 'Keep sessions, fixtures, and deadlines visible.',
    copy: 'Training, match days, parent response cut offs, and saved development activity sit in one football calendar.',
    image: sessionsCalendarImage,
    alt: 'Football Player calendar showing football activity',
  },
  {
    eyebrow: 'Player records',
    title: 'Find the right player and keep their history intact.',
    copy: 'The register separates current players, trial players, squad status, and saved records so coaches are not hunting through spreadsheets.',
    image: playersListImage,
    alt: 'Football Player player register showing squad and trial players',
  },
  {
    eyebrow: 'Progression',
    title: 'Turn coach notes into development history.',
    copy: 'Player profiles show records, scores, trend history, and coach comments in a way staff can review before the next session.',
    image: playerProgressionImage,
    alt: 'Football Player player progression page showing records and chart data',
  },
]

const capabilityGroups = [
  ['Training', 'Create sessions, add players, record notes, and keep work tied to the right team.'],
  ['Match day', 'Prepare squads, collect replies, save results, and keep follow-up work visible.'],
  ['Parents', 'Send focused updates from club records without giving parents staff access.'],
  ['Teams', 'Separate team context, staff access, and player lists so clubs can grow safely.'],
]

export function PublicFeaturesPage() {
  usePublicThemeScope()

  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-[var(--text-primary)] lg:pb-0">
      <LoginHeader logo={fallbackLogo} />

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--accent)]">Features</p>
            <h1 className="mt-4 text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl">
              The practical football tools clubs use every week.
            </h1>
          </div>
          <p className="text-base font-semibold leading-7 text-[var(--text-muted)] sm:text-lg sm:leading-8">
            Football Player connects the jobs that usually live in separate places: training, players, parent updates, match day, and development records.
          </p>
        </div>
      </section>

      <section className="border-y border-[var(--border-color)] bg-[var(--panel-bg)]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:px-8">
          {capabilityGroups.map(([title, copy]) => (
            <article key={title} className="py-2">
              <h2 className="text-lg font-black tracking-tight">{title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {featureRows.map((feature, index) => (
          <article key={feature.title} className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--accent)]">{feature.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight sm:text-4xl">{feature.title}</h2>
              <p className="mt-4 text-base font-semibold leading-7 text-[var(--text-muted)]">{feature.copy}</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-xl shadow-black/10">
              <img src={feature.image} alt={feature.alt} className="w-full" />
            </div>
          </article>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="grid gap-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">See the workspace with demo data.</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-muted)]">
              Open the demo account from sign in, or speak to us about a club setup.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-black text-[var(--accent-text)] transition hover:opacity-90">
              Open demo
            </a>
            <button type="button" onClick={openContactModal} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--app-bg)] px-5 py-3 text-sm font-black text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)]">
              Contact us
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
