import { Link, useNavigate } from 'react-router-dom'

const surfaceClass = 'overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#065f46]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-white'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-white'

function CoachActionMenuPage({ actions, description, primaryPath, title }) {
  const navigate = useNavigate()
  const primaryAction = actions.find((action) => action.primary) || actions[0]
  const secondaryActions = actions.filter((action) => action.path !== primaryAction?.path)

  return (
    <div className="space-y-5">
      <section className={surfaceClass}>
        <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-stretch">
          <div>
            <p className={eyebrowClass}>Coach tools</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">{description}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {actions.map((action) => (
                <Link
                  key={action.path}
                  to={action.path}
                  className={[
                    'rounded-lg border p-4 shadow-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#93c5fd]',
                    action.primary
                      ? 'border-[#047857] bg-[#047857] text-white shadow-[#047857]/20'
                      : 'border-[#d7e5dc] bg-[#ecfdf5] text-[#101828] shadow-[#047857]/10 hover:border-[#047857] hover:bg-white',
                  ].join(' ')}
                >
                  <span className="block text-sm font-black">{action.label}</span>
                  <span className={['mt-2 block text-sm font-semibold leading-6', action.primary ? 'text-[#ecfdf5]' : 'text-[#4b5f55]'].join(' ')}>
                    {action.description}
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <div className="grid content-between rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-5 shadow-inner shadow-[#047857]/10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Next action</p>
              <p className="mt-2 text-xl font-black tracking-tight text-[#101828]">
                {primaryAction?.label || 'Open tool'}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                Open the working screen and complete the next useful action for this team.
              </p>
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#4b5f55]">
              {secondaryActions.length > 0
                ? `${secondaryActions.length} supporting view${secondaryActions.length === 1 ? '' : 's'} available.`
                : 'This tool opens directly into the working screen.'}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                to={primaryPath}
                className={primaryButtonClass}
              >
                Open next action
              </Link>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className={secondaryButtonClass}
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
      description="Run the next session, reopen saved sessions, and keep attendance plus coach notes tied to real team activity."
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
      description="Capture practical coach feedback and turn training or match observations into player progress."
      primaryPath="/assess-player/new?choosePlayer=1"
      actions={[
        {
          label: 'New development note',
          description: 'Record one player observation with structured development fields.',
          path: '/assess-player/new?choosePlayer=1',
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
