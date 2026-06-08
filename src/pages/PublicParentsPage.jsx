import fallbackLogo from '../assets/football-player-logo.png'
import parentPortalGoalPhoneImage from '../assets/parent-portal-goal-phone.png'
import playerProgressionImage from '../assets/marketing/player-progression.png'
import playersListImage from '../assets/marketing/players-list.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'

const parentPromises = [
  ['Linked access', 'Parents only see children and updates their club has connected to their email address.'],
  ['Clear updates', 'Coaches can send focused development notes, reports, and match information from saved records.'],
  ['Less noise', 'Parent communication moves away from scattered group chats and back into the club workflow.'],
]

const parentFlow = [
  ['Club records the football work', 'Players, sessions, coach notes, and match day context are saved by staff.'],
  ['Coach chooses what to share', 'The club controls which updates parents receive and when replies are needed.'],
  ['Parents respond from their own access', 'Families use parent access for updates and replies without staff tools.'],
]

export function PublicParentsPage() {
  usePublicThemeScope()

  return (
    <main className="min-h-screen bg-[var(--app-bg)] pb-[max(5.5rem,env(safe-area-inset-bottom))] text-[var(--text-primary)] lg:pb-0">
      <LoginHeader logo={fallbackLogo} />

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--accent)]">Parents</p>
          <h1 className="mt-4 text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl">
            Parent updates without handing over the club workspace.
          </h1>
          <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-[var(--text-muted)] sm:text-lg sm:leading-8">
            Keep families informed from the same player and team records coaches already use, with parent access kept separate from staff tools.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a href="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-black text-[var(--accent-text)] transition hover:opacity-90">
              Parent login
            </a>
            <a href="/pricing" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-black text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)]">
              View pricing
            </a>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[0.72fr_1fr] sm:items-center">
          <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3 shadow-xl shadow-black/10">
            <img src={parentPortalGoalPhoneImage} alt="Football Player parent mobile access" className="mx-auto max-h-[560px] w-full object-contain" />
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-xl shadow-black/10">
            <img src={playerProgressionImage} alt="Player development records that can support parent updates" className="w-full" />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--border-color)] bg-[var(--panel-bg)]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-3 lg:px-8">
          {parentPromises.map(([title, copy]) => (
            <article key={title}>
              <h2 className="text-xl font-black tracking-tight">{title}</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-muted)]">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-start lg:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--accent)]">How it works</p>
          <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight sm:text-4xl">Club control first, parent clarity second.</h2>
          <p className="mt-4 text-base font-semibold leading-7 text-[var(--text-muted)]">
            Parent communication works best when it starts from the football record, not from a blank message thread.
          </p>
        </div>
        <div className="grid gap-4">
          {parentFlow.map(([title, copy], index) => (
            <article key={title} className="grid gap-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm sm:grid-cols-[3rem_1fr]">
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-black text-[var(--accent-text)]">{index + 1}</span>
              <span>
                <h3 className="text-lg font-black tracking-tight">{title}</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">{copy}</p>
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="grid gap-6 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm sm:p-6 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Parents get the update. Coaches keep the records.</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-muted)]">
              The player register remains the source of truth for staff, while parent access receives the parts families need.
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--app-bg)]">
            <img src={playersListImage} alt="Player register used by staff before parent updates" className="w-full" />
          </div>
        </div>
      </section>
    </main>
  )
}
