import { formatSessionDate, formatSessionType } from '../../lib/session-page-utils.js'
import { SessionStatePanel } from './SessionStatePanel.jsx'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#1d4ed8]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#475569]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d8e3ee] bg-white px-4 py-3 text-sm font-black text-[#0f172a] shadow-sm shadow-[#0f172a]/5 transition hover:border-[#2563eb] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const inputClass = 'min-h-12 w-full rounded-lg border border-[#d8e3ee] bg-white px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe] disabled:cursor-not-allowed disabled:opacity-60'

export function OpenSessionsSection({
  canCompleteSessions,
  canDeleteSessions,
  combinedSessions,
  deleteSessionDisabledReason,
  isLoading,
  isSaving,
  onCompleteSession,
  onCurrentSession,
  onDeleteSession,
  onOpenSession,
  previousSessions,
  selectedSession,
  selectedSessionCompleted,
}) {
  return (
    <section
      data-tour-id="open-sessions-section"
      className="overflow-hidden rounded-lg border border-[#d8e3ee] bg-white shadow-sm shadow-[#0f172a]/5"
    >
      <div className="border-b border-[#d8e3ee] bg-[#f8fbfd] px-5 py-5 sm:px-6">
        <p className={eyebrowClass}>Saved sessions</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#0f172a]">Open existing sessions</h2>
        <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
          Reopen any saved session to continue notes, add players, or carry on development records.
        </p>
      </div>

      <div className="px-5 py-5 sm:px-6">
        {isLoading ? (
          <SessionStatePanel
            eyebrow="Loading sessions"
            title="Checking saved training and match blocks."
            body="Saved sessions are loaded with their status so coaches can reopen the right player queue."
            action="Keep this page open while the workspace refreshes."
          />
        ) : combinedSessions.length === 0 ? (
          <SessionStatePanel
            eyebrow="No sessions yet"
            title="Create the first training or match block."
            body="A session gives the team one shared queue for players, voice notes, and development records."
            action="Use Create session below, then add the relevant players."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
          <div className="rounded-lg border border-[#d8e3ee] bg-[#f8fbfd] px-4 py-4 shadow-sm shadow-[#0f172a]/5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-black text-[#0f172a]">
                    {selectedSession?.title || selectedSession?.team || 'Current session'}
                  </p>
                  <span className={[
                    'rounded-lg border px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em]',
                    selectedSessionCompleted
                      ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
                      : 'border-[#bbf7d0] bg-[#dcfce7] text-[#166534]',
                  ].join(' ')}>
                    {selectedSessionCompleted ? 'Completed' : 'Open'}
                  </span>
                </div>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[#1d4ed8]">
                  {formatSessionType(selectedSession?.sessionType)} / {formatSessionDate(selectedSession?.sessionDate)}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#475569]">{selectedSession?.team || 'No team entered'}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {canCompleteSessions && selectedSession && !selectedSessionCompleted ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    title={isSaving ? 'Please wait while the session is being updated.' : undefined}
                    onClick={() => void onCompleteSession()}
                    className={secondaryButtonClass}
                  >
                    Complete session
                  </button>
                ) : null}
                {canDeleteSessions && selectedSession ? (
                  <button
                    type="button"
                    disabled={isSaving || Boolean(deleteSessionDisabledReason)}
                    title={deleteSessionDisabledReason}
                    onClick={() => onDeleteSession()}
                    className={dangerButtonClass}
                  >
                    Delete session
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!selectedSession}
                  title={selectedSession ? 'Go to the selected session players and notes.' : 'Select a session first.'}
                  onClick={onCurrentSession}
                  className={secondaryButtonClass}
                >
                  Current session
                </button>
              </div>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#0f172a]">Previous sessions</span>
            <select
              value=""
              onChange={(event) => onOpenSession(event.target.value)}
              disabled={previousSessions.length === 0}
              title={previousSessions.length === 0 ? 'There are no previous sessions to open yet.' : undefined}
              className={inputClass}
            >
              <option value="">
                {previousSessions.length === 0 ? 'No previous sessions yet' : 'Choose previous session'}
              </option>
              {previousSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatSessionType(session.sessionType)} / {session.title || session.team} / {formatSessionDate(session.sessionDate)} / {session.status === 'completed' ? 'Completed' : 'Open'}
                </option>
              ))}
            </select>
          </label>
          </div>
        )}
      </div>
    </section>
  )
}
