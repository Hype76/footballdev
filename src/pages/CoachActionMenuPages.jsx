import { Link, useNavigate } from 'react-router-dom'

function CoachActionMenuPage({ actions, description, primaryPath, title }) {
  const navigate = useNavigate()

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm shadow-slate-200/80">
        <div className="bg-[radial-gradient(circle_at_top_right,#bbf7d0,transparent_34%),linear-gradient(135deg,#ffffff,#f0fdf4)] p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Football workflow</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-700">{description}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-sm shadow-slate-200 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              Back
            </button>
            <Link
              to={primaryPath}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              Open next action
            </Link>
          </div>
        </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.path}
            to={action.path}
            className={`rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              action.primary
                ? 'border-slate-950 bg-slate-950 text-white shadow-slate-300'
                : 'border-[var(--border-color)] bg-white text-slate-950 shadow-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
            }`}
          >
            <span className="block text-lg font-black">{action.label}</span>
            <span className={`mt-2 block text-sm leading-6 ${action.primary ? 'text-slate-200' : 'text-slate-600'}`}>
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
