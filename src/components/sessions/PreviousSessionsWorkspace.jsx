import { Link } from 'react-router-dom'
import { formatSessionDate, formatSessionType } from '../../lib/session-page-utils.js'
import { SessionStatePanel } from './SessionStatePanel.jsx'

const surfaceClass = 'overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#101828]/5'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#065f46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-white'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2 focus:ring-offset-white'
const inputClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]'

function HistoryMetric({ label, value }) {
  return (
    <article className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-center shadow-sm shadow-[#101828]/5 sm:px-4">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#065f46] sm:text-xs">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828] sm:text-3xl">{value}</p>
    </article>
  )
}

export function PreviousSessionsWorkspace({
  assessmentCount,
  isLoading,
  onOpenSession,
  selectedPlayerCount,
  selectedSession,
  sessions,
  workspaceHref,
}) {
  const completedCount = sessions.filter((session) => session.status === 'completed').length
  const openCount = sessions.length - completedCount

  return (
    <div className="space-y-5">
      <section className={surfaceClass}>
        <div className="grid gap-5 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className={eyebrowClass}>Session history</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">Previous sessions</h1>
            <p className={`mt-3 max-w-3xl ${bodyTextClass}`}>
              Find a saved training or match block, then open its full player queue and development records only when you need them.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[22rem]">
            <Link to="/sessions/start?action=create-session" className={primaryButtonClass}>
              Create session
            </Link>
            <Link to="/sessions" className={secondaryButtonClass}>
              Sessions menu
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="Session history summary" className="grid grid-cols-3 gap-2 sm:gap-3">
        <HistoryMetric label="Saved" value={isLoading ? '...' : sessions.length} />
        <HistoryMetric label="Completed" value={isLoading ? '...' : completedCount} />
        <HistoryMetric label="Open" value={isLoading ? '...' : openCount} />
      </section>

      <section className={surfaceClass}>
        <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
          <p className={eyebrowClass}>Saved sessions</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Choose a session to review</h2>
          <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
            The selector keeps this page short. The full working view still contains attendance, coach notes, player records, completion, and session controls.
          </p>
        </div>

        <div className="px-5 py-5 sm:px-6">
          {isLoading ? (
            <SessionStatePanel
              eyebrow="Loading sessions"
              title="Checking saved training and match blocks."
              body="Session history is loading with the latest status and team details."
              action="Keep this page open while the workspace refreshes."
            />
          ) : sessions.length === 0 ? (
            <SessionStatePanel
              eyebrow="No sessions yet"
              title="Create the first training or match block."
              body="New sessions will appear here after they are created."
              action="Use Create session to start the first player queue."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)] lg:items-start">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Saved session</span>
                <select
                  value={selectedSession?.id || ''}
                  onChange={(event) => onOpenSession(event.target.value)}
                  className={inputClass}
                >
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {formatSessionDate(session.sessionDate)}, {session.title || session.team || formatSessionType(session.sessionType)}, {session.status === 'completed' ? 'Completed' : 'Open'}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs font-semibold leading-5 text-[#4b5f55]">
                  Each choice is reflected in the URL so direct links and browser navigation remain reliable.
                </p>
              </label>

              <article className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4 shadow-sm shadow-[#065f46]/10 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={eyebrowClass}>Selected session</p>
                    <h3 className="mt-2 break-words text-xl font-black tracking-tight text-[#101828] sm:text-2xl">
                      {selectedSession?.title || selectedSession?.team || 'Saved session'}
                    </h3>
                  </div>
                  <span className="rounded-lg border border-[#bbf7d0] bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#065f46]">
                    {selectedSession?.status === 'completed' ? 'Completed' : 'Open'}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="font-black text-[#4b5f55]">Type</dt>
                    <dd className="mt-1 font-semibold text-[#101828]">{formatSessionType(selectedSession?.sessionType)}</dd>
                  </div>
                  <div>
                    <dt className="font-black text-[#4b5f55]">Date</dt>
                    <dd className="mt-1 font-semibold text-[#101828]">{formatSessionDate(selectedSession?.sessionDate)}</dd>
                  </div>
                  <div>
                    <dt className="font-black text-[#4b5f55]">Players</dt>
                    <dd className="mt-1 font-semibold text-[#101828]">{selectedPlayerCount}</dd>
                  </div>
                  <div>
                    <dt className="font-black text-[#4b5f55]">Records</dt>
                    <dd className="mt-1 font-semibold text-[#101828]">{assessmentCount}</dd>
                  </div>
                </dl>

                <Link to={workspaceHref} className={`${primaryButtonClass} mt-5 w-full sm:w-auto`}>
                  Open session workspace
                </Link>
              </article>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
