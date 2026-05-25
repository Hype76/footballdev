import { Link, useNavigate } from 'react-router-dom'

function CoachActionMenuPage({ actions, description, primaryPath, title }) {
  const navigate = useNavigate()

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Football workflow</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{description}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-sm shadow-black/10 transition hover:bg-[var(--panel-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              Back
            </button>
            <Link
              to={primaryPath}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              Open next action
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.path}
            to={action.path}
            className={`rounded-lg border p-4 transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
              action.primary
                ? 'border-[var(--accent)] bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--panel-soft)]'
            }`}
          >
            <span className="block text-base font-semibold">{action.label}</span>
            <span className={`mt-2 block text-sm leading-6 ${action.primary ? 'text-black/70' : 'text-[var(--text-muted)]'}`}>
              {action.description}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function SessionsMenuPage() {
  return (
    <CoachActionMenuPage
      title="Sessions"
      description="Plan training, reopen saved sessions, and keep attendance plus coach notes tied to a real football activity."
      primaryPath="/sessions/start"
      actions={[
        {
          label: 'Run training',
          description: 'Open the live session queue, add players, record notes, and start development actions.',
          path: '/sessions/start',
          primary: true,
        },
        {
          label: 'Session history',
          description: 'Review previous training or match sessions when preparing the next coach action.',
          path: '/sessions/previous',
        },
      ]}
    />
  )
}

export function PlayersMenuPage() {
  return (
    <CoachActionMenuPage
      title="Players"
      description="Use player records as the source for parents, teams, attendance, match day, and development history."
      primaryPath="/players/current"
      actions={[
        {
          label: 'Current Players',
          description: 'Player history, contacts, scores, profile links, and development actions.',
          path: '/players/current',
          primary: true,
        },
        {
          label: 'Add Player',
          description: 'Create a player record with team, section, positions, and parent contacts.',
          path: '/add-player',
        },
      ]}
    />
  )
}

export function AssessmentsMenuPage() {
  return (
    <CoachActionMenuPage
      title="Development"
      description="Capture practical football feedback and turn training or match observations into player progress."
      primaryPath="/assess-player/new"
      actions={[
        {
          label: 'New development note',
          description: 'Assess one player or add a structured coaching observation.',
          path: '/assess-player/new',
          primary: true,
        },
        {
          label: 'Development history',
          description: 'Review completed assessments, coach notes, scores, and progress over time.',
          path: '/assess-player/completed',
        },
      ]}
    />
  )
}
