import { formatSessionDate, formatSessionType } from '../../lib/session-page-utils.js'

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
      className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Saved sessions</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Open existing sessions</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Reopen any saved session to continue notes, add players, or carry on assessments.
        </p>
      </div>

      <div className="px-5 py-5 sm:px-6">
        {isLoading ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-600">
          Loading saved sessions...
          </div>
        ) : combinedSessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-bold text-slate-600">
          No saved sessions yet. Create a session below and it will appear here.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-black text-slate-950">
                    {selectedSession?.title || selectedSession?.team || 'Current session'}
                  </p>
                  <span className="rounded-md bg-emerald-700 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white">
                    {selectedSessionCompleted ? 'Completed' : 'Open'}
                  </span>
                </div>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-800">
                  {formatSessionType(selectedSession?.sessionType)} | {formatSessionDate(selectedSession?.sessionDate)}
                </p>
                <p className="mt-1 text-sm text-slate-600">{selectedSession?.team || 'No team entered'}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {canCompleteSessions && selectedSession && !selectedSessionCompleted ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    title={isSaving ? 'Please wait while the session is being updated.' : undefined}
                    onClick={() => void onCompleteSession()}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm font-black text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete session
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!selectedSession}
                  title={selectedSession ? 'Go to the selected session players and notes.' : 'Select a session first.'}
                  onClick={onCurrentSession}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Current session
                </button>
              </div>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Previous sessions</span>
            <select
              value=""
              onChange={(event) => onOpenSession(event.target.value)}
              disabled={previousSessions.length === 0}
              title={previousSessions.length === 0 ? 'There are no previous sessions to open yet.' : undefined}
              className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {previousSessions.length === 0 ? 'No previous sessions yet' : 'Choose previous session'}
              </option>
              {previousSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatSessionType(session.sessionType)} | {session.title || session.team} | {formatSessionDate(session.sessionDate)} | {session.status === 'completed' ? 'Completed' : 'Open'}
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
