import { Link } from 'react-router-dom'

const coachActions = [
  {
    label: 'Sessions',
    path: '/sessions',
  },
  {
    label: 'Players',
    path: '/players',
  },
  {
    label: 'Assessments',
    path: '/assess-player',
  },
]

export function CoachHomePage() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        {coachActions.map((action) => (
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
