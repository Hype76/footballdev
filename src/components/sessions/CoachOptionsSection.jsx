import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { AVAILABLE_PLAYER_PAGE_SIZE, formatSessionDate, formatSessionType } from '../../lib/session-page-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function CoachOptionsSection({
  activePlayerSection,
  activePlayerTeam,
  canDeleteSessions,
  combinedSessions,
  filteredPlayers,
  isSaving,
  onImportPlayers,
  onOpenSession,
  onPlayerPageChange,
  onPlayerSelection,
  onSectionChange,
  paginatedPlayers,
  playerPage,
  selectedPlayerIds,
  selectedSessionAssessmentCount,
  selectedSessionId,
  selectedSessionLocked,
  sessions,
}) {
  return (
    <SectionCard
      title="Coach options"
      description="Select any saved session and add more players to its list when needed."
    >
      {sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No sessions created yet.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Active session</span>
              <select
                value={selectedSessionId}
                onChange={(event) => onOpenSession(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {combinedSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatSessionType(session.sessionType)} | {session.title || session.team} | {formatSessionDate(session.sessionDate)} | {session.status === 'completed' ? 'Completed' : 'Open'}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player list</span>
              <select
                name="section"
                value={activePlayerSection}
                onChange={onSectionChange}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {EVALUATION_SECTIONS.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Adding players from {activePlayerSection || 'the selected list'} for {activePlayerTeam || 'this team'}.
            {selectedSessionAssessmentCount > 0 && canDeleteSessions ? (
              <span className="mt-2 block text-xs text-[var(--text-secondary)]">
                This session has {selectedSessionAssessmentCount} assessments, so it cannot be deleted.
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {paginatedPlayers.items.map((player) => (
              <label
                key={player.id}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)]"
              >
                <input
                  type="checkbox"
                  checked={selectedPlayerIds.includes(player.id)}
                  onChange={(event) => onPlayerSelection(player.id, event.target.checked)}
                  className="h-4 w-4"
                />
                <span>{player.playerName} | {player.team || 'No team'}</span>
              </label>
            ))}
          </div>
          <Pagination
            currentPage={playerPage}
            onPageChange={onPlayerPageChange}
            pageSize={AVAILABLE_PLAYER_PAGE_SIZE}
            totalItems={filteredPlayers.length}
          />

          {filteredPlayers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
              No {String(activePlayerSection || 'selected').toLowerCase()} players are available for {activePlayerTeam || 'this team'}.
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={isSaving || filteredPlayers.length === 0 || selectedSessionLocked}
              onClick={() => void onImportPlayers('all')}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add All {activePlayerSection} Players
            </button>
            <button
              type="button"
              disabled={isSaving || selectedPlayerIds.length === 0 || selectedSessionLocked}
              onClick={() => void onImportPlayers('selected')}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add Selected Players
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
