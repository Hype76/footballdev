import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { AVAILABLE_PLAYER_PAGE_SIZE, formatSessionDate, formatSessionType } from '../../lib/session-page-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]'
const emptyClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-6 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#101828]/5'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'

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
          <p className="font-black text-[#101828]">No sessions have been created yet.</p>
          <p className="mt-2 leading-6">Create the first training or match block before adding a player queue.</p>
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
                    {formatSessionType(session.sessionType)}, Title: {session.title || session.team}, Date: {formatSessionDate(session.sessionDate)}, Status: {session.status === 'completed' ? 'Completed' : 'Open'}
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

          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#101828]/5">
            Adding players from {activePlayerSection || 'the selected list'} for {activePlayerTeam || 'this team'}.
            {selectedSessionAssessmentCount > 0 && canDeleteSessions ? (
              <span className="mt-2 block text-xs font-black text-[#065f46]">
                This session has {selectedSessionAssessmentCount} development records. Removing it keeps those records in player history.
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {paginatedPlayers.items.map((player) => (
              <label
                key={player.id}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5]"
              >
                <input
                  type="checkbox"
                  checked={selectedPlayerIds.includes(player.id)}
                  onChange={(event) => onPlayerSelection(player.id, event.target.checked)}
                  className="h-4 w-4"
                />
                <span>{player.playerName}, Team: {player.team || 'No team assigned'}</span>
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
              <p className="font-black text-[#101828]">No players match this session list.</p>
              <p className="mt-2 leading-6">
                No {String(activePlayerSection || 'selected').toLowerCase()} players are available for {activePlayerTeam || 'this team'}.
              </p>
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
