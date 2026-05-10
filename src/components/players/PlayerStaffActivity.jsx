import { SectionCard } from '../ui/SectionCard.jsx'
import { formatActivityDate, getActivityLabel } from '../../hooks/players/playerProfileUtils.js'

export function PlayerStaffActivity({
  activityLogs,
  deletingNoteId,
  isSavingNote,
  noteDraft,
  onDeleteNote,
  onNoteChange,
  onSaveNote,
  primaryPlayer,
  staffNotes,
}) {
  return (
    <SectionCard
      title="Staff notes and activity"
      description="Internal notes and staff actions stay inside the club workspace. They are not added to parent emails."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Add internal note</span>
            <textarea
              value={noteDraft}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              placeholder="Add a staff-only note for this player"
            />
          </label>
          <button
            type="button"
            onClick={onSaveNote}
            disabled={isSavingNote || !noteDraft.trim() || !primaryPlayer?.id}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingNote ? 'Saving...' : 'Save Note'}
          </button>

          <div className="mt-4 space-y-3">
            {staffNotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
                No staff notes yet.
              </div>
            ) : (
              staffNotes.map((note) => (
                <div key={note.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{note.note}</p>
                    {note.audioPath || note.audioUrl ? (
                      <button
                        type="button"
                        disabled={deletingNoteId === note.id}
                        onClick={() => onDeleteNote(note)}
                        className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingNoteId === note.id ? 'Deleting...' : 'Delete'}
                      </button>
                    ) : null}
                  </div>
                  {note.audioUrl ? (
                    <audio controls src={note.audioUrl} className="mt-3 w-full">
                      Voice note audio
                    </audio>
                  ) : null}
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {note.userName || note.userEmail || 'Staff'} | {formatActivityDate(note.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Player activity</p>
          <div className="mt-3 space-y-3">
            {activityLogs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
                No player activity logged yet.
              </div>
            ) : (
              activityLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{getActivityLabel(log)}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {log.userName || log.userEmail || 'Staff'} | {formatActivityDate(log.createdAt)}
                  </p>
                  {log.recipientEmail ? (
                    <p className="mt-1 break-words text-xs text-[var(--text-muted)]">Recipient: {log.recipientEmail}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
