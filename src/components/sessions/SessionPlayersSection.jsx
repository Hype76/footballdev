import { MicIcon } from '../icons/MicIcon.jsx'
import { formatRetentionDate, getRetentionCountdownLabel } from '../../lib/retention.js'
import { SESSION_PLAYER_PAGE_SIZE, formatSessionDate, formatSessionType, normalizeProgressName } from '../../lib/session-page-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

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
  return (
    <SectionCard
      title="Session players"
      tourId="session-players-section"
      description="Coaches can record quick notes during the game or training, then start every assessment in sequence."
    >
      {!selectedSessionId ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          Select a session to manage players.
        </div>
      ) : isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading session players...
        </div>
      ) : sessionPlayers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No players have been added to this session yet.
        </div>
      ) : (
        <div className="space-y-4">
          {selectedSessionCompleted ? (
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
              {canCompleteSessions
                ? 'This session has been completed. Managers can still correct notes or assessments if needed.'
                : 'This session has been completed. Notes and assessments are kept for review. The session is no longer editable.'}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {selectedSession?.title || selectedSession?.team || 'Session'}
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {formatSessionType(selectedSession?.sessionType)} | {formatSessionDate(selectedSession?.sessionDate)}
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
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {completedPlayerNames.length > 0 ? 'Continue Assessments' : 'Assess All'}
              </button>
              <button
                type="button"
                disabled={isSaving || selectedSessionLocked}
                onClick={() => void onClearSessionPlayers()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Clear Session
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
    </SectionCard>
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
      title={isRecording ? 'Stop recording' : isSavingVoiceNote ? 'Saving voice note' : 'Team voice note'}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        isRecording
          ? 'border-red-500/50 bg-red-600 text-white hover:bg-red-700'
          : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
      }`}
    >
      <MicIcon />
      <span className="sr-only">
        {isRecording ? 'Stop Recording' : isSavingVoiceNote ? 'Saving Voice Note...' : 'Team Voice Note'}
      </span>
    </button>
  )
}

function SessionVoiceNotes({ deletingVoiceNoteId, notes, onDeleteVoiceNote, selectedSessionLocked }) {
  if (notes.length === 0) {
    return null
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)]">Team voice notes</p>
      {notes.map((note) => (
        <div key={note.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{note.note}</p>
            <button
              type="button"
              disabled={selectedSessionLocked || deletingVoiceNoteId === note.id}
              onClick={() => onDeleteVoiceNote(note)}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletingVoiceNoteId === note.id ? 'Deleting...' : 'Delete'}
            </button>
          </div>
          {note.audioUrl ? (
            <audio controls src={note.audioUrl} className="mt-3 w-full">
              Voice note audio
            </audio>
          ) : null}
          <p className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">
            Deletes {formatRetentionDate(note.audioExpiresAt)} | {getRetentionCountdownLabel(note.audioExpiresAt)}
          </p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            {note.userName || note.userEmail || 'Staff'} | {formatSessionDate(note.createdAt)}
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

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{player.section} | {player.team || 'No team'}</p>
          {completedPlayerNames.includes(normalizeProgressName(player.playerName)) ? (
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
              Assessment completed
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
            title={isRecording ? 'Stop recording' : 'Voice note'}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isRecording
                ? 'border-red-500/50 bg-red-600 text-white hover:bg-red-700'
                : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
            }`}
          >
            <MicIcon />
            <span className="sr-only">{isRecording ? 'Stop Recording' : 'Voice Note'}</span>
          </button>
          <button
            type="button"
            disabled={selectedSessionLocked}
            onClick={() => onAssessPlayer(player)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Assess Player
          </button>
        </div>
      </div>
    </div>
  )
}
