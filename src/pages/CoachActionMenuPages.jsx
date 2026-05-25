import { Link, useNavigate } from 'react-router-dom'

function CoachActionMenuPage({ actions, description, primaryPath, title }) {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm shadow-emerald-900/5">
        <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Football workflow</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <div className="rounded-lg border border-lime-200 bg-lime-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">Next action</p>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-950">
              Pick the football job, open the working screen, and complete the real step that moves the week forward.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                to={primaryPath}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Open next action
              </Link>
            <button
              type="button"
              onClick={() => navigate(-1)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-200 bg-white px-5 py-3 text-sm font-black text-emerald-900 transition hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              Back
            </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.path}
            to={action.path}
              className={`rounded-lg border p-5 shadow-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              action.primary
                ? 'border-emerald-800 bg-emerald-800 text-white'
                : 'border-slate-200 bg-white text-slate-950 hover:border-emerald-300 hover:bg-lime-50'
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
      description="Run the next session from the queue, reopen saved sessions, and keep attendance plus coach notes tied to a real football activity."
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
          description: 'Record one player observation with structured football fields.',
          path: '/assess-player/new',
          primary: true,
        },
        {
          label: 'Development history',
          description: 'Review completed development records, coach notes, scores, and progress over time.',
          path: '/assess-player/completed',
        },
      ]}
    />
  )
}
