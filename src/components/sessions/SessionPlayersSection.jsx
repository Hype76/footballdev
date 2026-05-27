import { MicIcon } from '../icons/MicIcon.jsx'
import { formatRetentionDate, getRetentionCountdownLabel } from '../../lib/retention.js'
import { SESSION_PLAYER_PAGE_SIZE, formatSessionDate, formatSessionType, normalizeProgressName } from '../../lib/session-page-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SessionStatePanel } from './SessionStatePanel.jsx'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#065f46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-5 py-3 text-sm font-black text-[#b42318] transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const recordingButtonClass = 'border-[#f04438] bg-[#d92d20] text-white hover:bg-[#b42318]'

export function SessionPlayersSection({
  canCompleteSessions,
  completedPlayerNames,
  isLoading,
  isSaving,
  isSavingVoiceNote,
  onAssessAll,
  onAssessPlayer,
  onClearSessionPlayers,
  onDeleteVoiceNote,
  onPageChange,
  onStartVoiceNote,
  onStopVoiceNote,
  paginatedPlayers,
  page,
  recordingTarget,
  selectedSession,
  selectedSessionCompleted,
  selectedSessionId,
  selectedSessionLocked,
  sessionPlayers,
  sessionVoiceNotes,
  deletingVoiceNoteId,
}) {
  const assessAllDisabledReason = selectedSessionLocked
    ? 'This session is completed, so development records cannot be started from here.'
    : undefined
  const clearSessionDisabledReason = isSaving
    ? 'Please wait while this session is being updated.'
    : selectedSessionLocked
      ? 'This session is completed, so the player list cannot be cleared.'
      : undefined

  return (
    <section
      data-tour-id="session-players-section"
      className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#101828]/5"
    >
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className={eyebrowClass}>Session players</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Run the live player queue</h2>
            <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
              Coaches can record quick notes during the game or training, then complete each development record in sequence.
            </p>
          </div>
          {selectedSessionId ? (
            <span className="inline-flex min-h-10 w-fit items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-sm font-black text-[#065f46]">
              {sessionPlayers.length} players
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        {!selectedSessionId ? (
          <SessionStatePanel
            eyebrow="Select session"
            title="Open or create a session before managing players."
            body="The player queue depends on the selected training or match block, so notes and records stay attached to the right context."
            action="Choose a saved session above, or create a new one below."
          />
        ) : isLoading ? (
          <SessionStatePanel
            eyebrow="Loading queue"
            title="Checking the player list for this session."
            body="Player records, completion state, and voice notes are loaded together before the queue can be edited."
            action="This keeps coaches from recording against the wrong session."
          />
        ) : sessionPlayers.length === 0 ? (
          <SessionStatePanel
            eyebrow="Queue empty"
            title="Add players before recording notes."
            body="A session is ready, but it needs a player queue before coaches can record individual development work."
            action="Use the available player list to add the relevant squad."
          />
        ) : (
          <div className="space-y-4">
          {selectedSessionCompleted ? (
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm font-semibold text-[#4b5f55]">
              {canCompleteSessions
                ? 'This session has been completed. Managers can still correct notes or development records if needed.'
                : 'This session has been completed. Notes and development records are kept for review. The session is no longer editable.'}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black text-[#101828]">
                {selectedSession?.title || selectedSession?.team || 'Session'}
              </p>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                Type: {formatSessionType(selectedSession?.sessionType)}, Date: {formatSessionDate(selectedSession?.sessionDate)}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <TeamVoiceNoteButton
                isSavingVoiceNote={isSavingVoiceNote}
                onStartVoiceNote={onStartVoiceNote}
                onStopVoiceNote={onStopVoiceNote}
                recordingTarget={recordingTarget}
                selectedSessionId={selectedSessionId}
                selectedSessionLocked={selectedSessionLocked}
              />
              <button
                type="button"
                onClick={onAssessAll}
                disabled={selectedSessionLocked}
                title={assessAllDisabledReason}
                className={primaryButtonClass}
              >
                {completedPlayerNames.length > 0 ? 'Continue records' : 'Record all'}
              </button>
              <button
                type="button"
                disabled={isSaving || selectedSessionLocked}
                title={clearSessionDisabledReason}
                onClick={() => void onClearSessionPlayers()}
                className={dangerButtonClass}
              >
                Clear session
              </button>
            </div>
          </div>

          <SessionVoiceNotes
            deletingVoiceNoteId={deletingVoiceNoteId}
            notes={sessionVoiceNotes}
            onDeleteVoiceNote={onDeleteVoiceNote}
            selectedSessionLocked={selectedSessionLocked}
          />

          {paginatedPlayers.items.map((player) => (
            <SessionPlayerCard
              key={player.id}
              completedPlayerNames={completedPlayerNames}
              isSavingVoiceNote={isSavingVoiceNote}
              onAssessPlayer={onAssessPlayer}
              onStartVoiceNote={onStartVoiceNote}
              onStopVoiceNote={onStopVoiceNote}
              player={player}
              recordingTarget={recordingTarget}
              selectedSessionId={selectedSessionId}
              selectedSessionLocked={selectedSessionLocked}
            />
          ))}
          <Pagination
            currentPage={page}
            onPageChange={onPageChange}
            pageSize={SESSION_PLAYER_PAGE_SIZE}
            totalItems={sessionPlayers.length}
          />
          </div>
        )}
      </div>
    </section>
  )
}

function TeamVoiceNoteButton({
  isSavingVoiceNote,
  onStartVoiceNote,
  onStopVoiceNote,
  recordingTarget,
  selectedSessionId,
  selectedSessionLocked,
}) {
  const isRecording = recordingTarget?.type === 'session'
  const disabledReason = selectedSessionLocked
    ? 'This session is completed, so team voice notes cannot be changed.'
    : isSavingVoiceNote
      ? 'Please wait while the current voice note is being saved.'
      : !selectedSessionId
        ? 'Select a session before recording a team voice note.'
        : undefined

  return (
    <button
      type="button"
      onClick={() =>
        isRecording
          ? onStopVoiceNote()
          : void onStartVoiceNote({ type: 'session', sessionId: selectedSessionId })
      }
      disabled={selectedSessionLocked || isSavingVoiceNote || !selectedSessionId}
      aria-label={isRecording ? 'Stop team voice note recording' : isSavingVoiceNote ? 'Saving team voice note' : 'Record team voice note'}
      title={disabledReason || (isRecording ? 'Stop recording' : 'Team voice note')}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        isRecording
          ? recordingButtonClass
        : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857] hover:bg-[#ecfdf5]'
      }`}
    >
      <MicIcon />
      <span className="sr-only">
        {isRecording ? 'Stop recording' : isSavingVoiceNote ? 'Saving voice note...' : 'Team voice note'}
      </span>
    </button>
  )
}

function SessionVoiceNotes({ deletingVoiceNoteId, notes, onDeleteVoiceNote, selectedSessionLocked }) {
  if (notes.length === 0) {
    return null
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#101828]/5">
      <p className="text-sm font-black text-[#101828]">Team voice notes</p>
      {notes.map((note) => (
        <div key={note.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-sm font-black text-[#101828]">{note.note}</p>
            <button
              type="button"
              disabled={selectedSessionLocked || deletingVoiceNoteId === note.id}
              title={
                selectedSessionLocked
                  ? 'This session is completed, so voice notes cannot be deleted.'
                  : deletingVoiceNoteId === note.id
                    ? 'Please wait while this voice note is being deleted.'
                    : undefined
              }
              onClick={() => onDeleteVoiceNote(note)}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#b42318] transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletingVoiceNoteId === note.id ? 'Deleting...' : 'Delete'}
            </button>
          </div>
          {note.audioUrl ? (
            <audio controls src={note.audioUrl} className="mt-3 w-full">
              Voice note audio
            </audio>
          ) : null}
          <p className="mt-2 text-xs font-bold text-[#4b5f55]">
            Deletes: {formatRetentionDate(note.audioExpiresAt)}, Retention: {getRetentionCountdownLabel(note.audioExpiresAt)}
          </p>
          <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55]">
            Staff: {note.userName || note.userEmail || 'Staff'}, Created: {formatSessionDate(note.createdAt)}
          </p>
        </div>
      ))}
    </div>
  )
}

function SessionPlayerCard({
  completedPlayerNames,
  isSavingVoiceNote,
  onAssessPlayer,
  onStartVoiceNote,
  onStopVoiceNote,
  player,
  recordingTarget,
  selectedSessionId,
  selectedSessionLocked,
}) {
  const isRecording = recordingTarget?.type === 'player' && recordingTarget?.playerId === player.playerId
  const voiceNoteDisabledReason = selectedSessionLocked
    ? 'This session is completed, so player voice notes cannot be changed.'
    : isSavingVoiceNote
      ? 'Please wait while the current voice note is being saved.'
      : !player.playerId
        ? 'Save this player before recording a voice note.'
        : undefined
  const assessPlayerDisabledReason = selectedSessionLocked
    ? 'This session is completed, so this player cannot be recorded from here.'
    : undefined

  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#101828]/5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-base font-black text-[#101828]">{player.playerName}</p>
          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">Section: {player.section || 'Trial'}, Team: {player.team || 'No team assigned'}</p>
          {completedPlayerNames.includes(normalizeProgressName(player.playerName)) ? (
            <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[#065f46]">
              Development record completed
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() =>
              isRecording
                ? onStopVoiceNote()
                : void onStartVoiceNote({
                    type: 'player',
                    playerId: player.playerId,
                    playerName: player.playerName,
                    sessionId: selectedSessionId,
                  })
            }
            disabled={selectedSessionLocked || isSavingVoiceNote || !player.playerId}
            aria-label={isRecording ? `Stop voice note recording for ${player.playerName}` : `Record voice note for ${player.playerName}`}
            title={voiceNoteDisabledReason || (isRecording ? 'Stop recording' : 'Voice note')}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isRecording
                ? recordingButtonClass
                : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857] hover:bg-[#ecfdf5]'
            }`}
          >
            <MicIcon />
            <span className="sr-only">{isRecording ? 'Stop recording' : 'Voice note'}</span>
          </button>
          <button
            type="button"
            disabled={selectedSessionLocked}
            title={assessPlayerDisabledReason}
            onClick={() => onAssessPlayer(player)}
            className={secondaryButtonClass}
          >
            Record player
          </button>
        </div>
      </div>
    </div>
  )
}
