import { formatSessionDate, formatSessionType } from '../../lib/session-page-utils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function OpenSessionsSection({
  canCompleteSessions,
  canDeleteSessions,
  combinedSessions,
  deleteSessionDisabledReason,
  isLoading,
  isSaving,
  onCompleteSession,
  onDeleteSession,
  onOpenSession,
  previousSessions,
  selectedSession,
  selectedSessionCompleted,
}) {
  return (
    <SectionCard
      title="Open existing sessions"
      tourId="open-sessions-section"
      description="Reopen any saved session to continue notes, add players, or carry on assessments."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading saved sessions...
        </div>
      ) : combinedSessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No saved sessions yet. Create a session below and it will appear here.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
          <div className="rounded-lg border border-[var(--accent)] bg-[var(--panel-soft)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {selectedSession?.title || selectedSession?.team || 'Current session'}
                  </p>
                  <span className="rounded-full bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-contrast)]">
                    {selectedSessionCompleted ? 'Completed' : 'Open'}
                  </span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {formatSessionType(selectedSession?.sessionType)} | {formatSessionDate(selectedSession?.sessionDate)}
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{selectedSession?.team || 'No team entered'}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {canCompleteSessions && selectedSession && !selectedSessionCompleted ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void onCompleteSession()}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Complete Session
                  </button>
                ) : null}
                {canDeleteSessions && selectedSession ? (
                  <button
                    type="button"
                    disabled={isSaving || Boolean(deleteSessionDisabledReason)}
                    title={deleteSessionDisabledReason}
                    onClick={() => onDeleteSession()}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600/20 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete Session
                  </button>
                ) : null}
                <span className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
                  Current Session
                </span>
              </div>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Previous sessions</span>
            <select
              value=""
              onChange={(event) => onOpenSession(event.target.value)}
              disabled={previousSessions.length === 0}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
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
    </SectionCard>
  )
}
