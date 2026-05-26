import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { AVAILABLE_PLAYER_PAGE_SIZE, formatSessionDate, formatSessionType } from '../../lib/session-page-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const emptyClass = 'rounded-lg border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-4 py-6 text-sm font-semibold text-[#667085]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60'

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
  const addAllDisabledReason = isSaving
    ? 'Please wait while the session is being updated.'
    : selectedSessionLocked
      ? 'This session is completed, so players cannot be added.'
      : filteredPlayers.length === 0
        ? 'There are no players available to add from this list.'
        : undefined
  const addSelectedDisabledReason = isSaving
    ? 'Please wait while the session is being updated.'
    : selectedSessionLocked
      ? 'This session is completed, so players cannot be added.'
      : selectedPlayerIds.length === 0
        ? 'Select at least one player before adding selected players.'
        : undefined

  return (
    <SectionCard
      title="Coach options"
      description="Select any saved session and add more players to its list when needed."
    >
      {sessions.length === 0 ? (
        <div className={emptyClass}>
          No sessions created yet.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="block">
              <span className={labelClass}>Active session</span>
              <select
                value={selectedSessionId}
                onChange={(event) => onOpenSession(event.target.value)}
                className={inputClass}
              >
                {combinedSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatSessionType(session.sessionType)} / {session.title || session.team} / {formatSessionDate(session.sessionDate)} / {session.status === 'completed' ? 'Completed' : 'Open'}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Player list</span>
              <select
                name="section"
                value={activePlayerSection}
                onChange={onSectionChange}
                className={inputClass}
              >
                {EVALUATION_SECTIONS.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-4 text-sm font-semibold text-[#667085] shadow-sm shadow-slate-200/60">
            Adding players from {activePlayerSection || 'the selected list'} for {activePlayerTeam || 'this team'}.
            {selectedSessionAssessmentCount > 0 && canDeleteSessions ? (
              <span className="mt-2 block text-xs font-black text-[#067a46]">
                This session has {selectedSessionAssessmentCount} development records, so it cannot be deleted.
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {paginatedPlayers.items.map((player) => (
              <label
                key={player.id}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-slate-200/50"
              >
                <input
                  type="checkbox"
                  checked={selectedPlayerIds.includes(player.id)}
                  onChange={(event) => onPlayerSelection(player.id, event.target.checked)}
                  className="h-4 w-4"
                />
                <span>{player.playerName} / {player.team || 'No team'}</span>
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
            <div className={emptyClass}>
              No {String(activePlayerSection || 'selected').toLowerCase()} players are available for {activePlayerTeam || 'this team'}.
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={isSaving || filteredPlayers.length === 0 || selectedSessionLocked}
              title={addAllDisabledReason}
              onClick={() => void onImportPlayers('all')}
              className={primaryButtonClass}
            >
              Add all {activePlayerSection} players
            </button>
            <button
              type="button"
              disabled={isSaving || selectedPlayerIds.length === 0 || selectedSessionLocked}
              title={addSelectedDisabledReason}
              onClick={() => void onImportPlayers('selected')}
              className={secondaryButtonClass}
            >
              Add selected players
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
