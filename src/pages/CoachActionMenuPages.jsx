import { Link, useNavigate } from 'react-router-dom'

function CoachActionMenuPage({ actions }) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col justify-center gap-5 px-4">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-sm shadow-black/10 transition hover:bg-[var(--panel-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--app-bg)]"
        >
          Back
        </button>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-sm shadow-black/10 transition hover:bg-[var(--panel-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--app-bg)] lg:hidden"
        >
          Home
        </Link>
      </div>
      <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.path}
            to={action.path}
            className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--button-primary)] px-6 py-8 text-center text-2xl font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--app-bg)] sm:min-h-56"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

export function SessionsMenuPage() {
  return (
    <CoachActionMenuPage
      actions={[
        {
          label: 'Start Session',
          path: '/sessions/start',
        },
        {
          label: 'Previous Sessions',
          path: '/sessions/previous',
        },
      ]}
    />
  )
}

export function PlayersMenuPage() {
  return (
    <CoachActionMenuPage
      actions={[
        {
          label: 'Add Player',
          path: '/add-player',
        },
        {
          label: 'Current Players',
          path: '/players/current',
        },
      ]}
    />
  )
}

export function AssessmentsMenuPage() {
  return (
    <CoachActionMenuPage
      actions={[
        {
          label: 'New Assessment',
          path: '/assess-player/new',
        },
        {
          label: 'Completed Assessments',
          path: '/assess-player/completed',
        },
      ]}
    />
  )
}
