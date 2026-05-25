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
  const assessAllDisabledReason = selectedSessionLocked
    ? 'This session is completed, so assessments cannot be started from here.'
    : undefined
  const clearSessionDisabledReason = isSaving
    ? 'Please wait while this session is being updated.'
    : selectedSessionLocked
      ? 'This session is completed, so the player list cannot be cleared.'
      : undefined

  return (
    <SectionCard
      title="Session players"
      tourId="session-players-section"
      description="Coaches can record quick notes during the game or training, then start every assessment in sequence."
    >
      {!selectedSessionId ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          Select a session to manage players.
        </div>
      ) : isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading session players...
        </div>
      ) : sessionPlayers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No players have been added to this session yet.
        </div>
      ) : (
        <div className="space-y-4">
          {selectedSessionCompleted ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              {canCompleteSessions
                ? 'This session has been completed. Managers can still correct notes or assessments if needed.'
                : 'This session has been completed. Notes and assessments are kept for review. The session is no longer editable.'}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black text-slate-950">
                {selectedSession?.title || selectedSession?.team || 'Session'}
              </p>
              <p className="mt-1 text-sm text-slate-600">
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
                title={assessAllDisabledReason}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {completedPlayerNames.length > 0 ? 'Continue Assessments' : 'Assess All'}
              </button>
              <button
                type="button"
                disabled={isSaving || selectedSessionLocked}
                title={clearSessionDisabledReason}
                onClick={() => void onClearSessionPlayers()}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-bold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
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
          ? 'border-rose-500 bg-rose-600 text-white hover:bg-rose-700'
          : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
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
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-slate-950">Team voice notes</p>
      {notes.map((note) => (
        <div key={note.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-sm font-bold text-slate-950">{note.note}</p>
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
              className="inline-flex min-h-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deletingVoiceNoteId === note.id ? 'Deleting...' : 'Delete'}
            </button>
          </div>
          {note.audioUrl ? (
            <audio controls src={note.audioUrl} className="mt-3 w-full">
              Voice note audio
            </audio>
          ) : null}
          <p className="mt-2 text-xs font-bold text-slate-500">
            Deletes {formatRetentionDate(note.audioExpiresAt)} | {getRetentionCountdownLabel(note.audioExpiresAt)}
          </p>
          <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
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
  const voiceNoteDisabledReason = selectedSessionLocked
    ? 'This session is completed, so player voice notes cannot be changed.'
    : isSavingVoiceNote
      ? 'Please wait while the current voice note is being saved.'
      : !player.playerId
        ? 'Save this player before recording a voice note.'
        : undefined
  const assessPlayerDisabledReason = selectedSessionLocked
    ? 'This session is completed, so this player cannot be assessed from here.'
    : undefined

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-base font-black text-slate-950">{player.playerName}</p>
          <p className="mt-1 text-sm text-slate-600">{player.section} | {player.team || 'No team'}</p>
          {completedPlayerNames.includes(normalizeProgressName(player.playerName)) ? (
            <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
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
            title={voiceNoteDisabledReason || (isRecording ? 'Stop recording' : 'Voice note')}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              isRecording
                ? 'border-rose-500 bg-rose-600 text-white hover:bg-rose-700'
                : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
            }`}
          >
            <MicIcon />
            <span className="sr-only">{isRecording ? 'Stop Recording' : 'Voice Note'}</span>
          </button>
          <button
            type="button"
            disabled={selectedSessionLocked}
            title={assessPlayerDisabledReason}
            onClick={() => onAssessPlayer(player)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Assess Player
          </button>
        </div>
      </div>
    </div>
  )
}
