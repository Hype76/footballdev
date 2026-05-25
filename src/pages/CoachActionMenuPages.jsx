import { Link, useNavigate } from 'react-router-dom'

function CoachActionMenuPage({ actions, description, primaryPath, title }) {
  const navigate = useNavigate()
  const primaryAction = actions.find((action) => action.primary) || actions[0]
  const secondaryActions = actions.filter((action) => action.path !== primaryAction?.path)

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/80">
        <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Football workflow</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-700">{description}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {actions.map((action) => (
                <Link
                  key={action.path}
                  to={action.path}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <span className="block text-sm font-black text-slate-950">{action.label}</span>
                  <span className="mt-2 block text-sm leading-6 text-slate-600">{action.description}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="grid content-between rounded-lg border border-slate-200 bg-slate-50 p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Next action</p>
              <p className="mt-2 text-xl font-black tracking-tight text-slate-950">
                {primaryAction?.label || 'Open workflow'}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                Open the working screen and complete the real step that moves the football week forward.
              </p>
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">
              {secondaryActions.length > 0
                ? `${secondaryActions.length} supporting view${secondaryActions.length === 1 ? '' : 's'} available.`
                : 'This workflow opens directly into the working screen.'}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                to={primaryPath}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Open next action
              </Link>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      </section>
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
