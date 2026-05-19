import { useState } from 'react'
import { SectionCard } from '../ui/SectionCard.jsx'
import { formatActivityDate, getActivityLabel } from '../../hooks/players/playerProfileUtils.js'
import { formatRetentionDate, getRetentionCountdownLabel } from '../../lib/retention.js'
import { MicIcon } from '../icons/MicIcon.jsx'
import {
  canDownloadMessagePdf,
  getMessageAssessmentFields,
  getMessageBody,
  getMessageClubLabel,
  getMessagePdfHtml,
  getMessagePlayerLabel,
  getMessageSubject,
  getMessageTeamLabel,
  getMessageTemplateName,
  messageHasAttachment,
} from '../../lib/email-message-display.js'
import { exportPdfHtml } from '../../lib/pdf.js'

export function PlayerStaffActivity({
  activityLogs,
  deletingNoteId,
  isRecordingVoiceNote,
  isSavingNote,
  isSavingVoiceNote,
  noteDraft,
  onDeleteNote,
  onNoteChange,
  onSaveNote,
  onStartVoiceNote,
  onStopVoiceNote,
  primaryPlayer,
  staffNotes,
}) {
  const [openActivityId, setOpenActivityId] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [downloadingActivityId, setDownloadingActivityId] = useState('')
  const saveNoteDisabledReason = isSavingNote
    ? 'Please wait while this note is being saved.'
    : isSavingVoiceNote
      ? 'Please wait while the voice note is being saved.'
      : !primaryPlayer?.id
        ? 'Open a saved player before adding a note.'
        : !noteDraft.trim()
          ? 'Write a note before saving.'
          : undefined
  const voiceNoteDisabledReason = isSavingNote
    ? 'Please wait while this note is being saved.'
    : isSavingVoiceNote
      ? 'Please wait while the voice note is being saved.'
      : !primaryPlayer?.id
        ? 'Open a saved player before recording a voice note.'
        : undefined

  return (
    <SectionCard
      title="Staff notes and activity"
      description="Internal notes and staff actions stay inside the club workspace. They are not added to parent emails."
      defaultCollapsed
    >
      <div className="mb-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Staff notes and player activity</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {staffNotes.length} staff {staffNotes.length === 1 ? 'note' : 'notes'} | {activityLogs.length} activity{' '}
          {activityLogs.length === 1 ? 'item' : 'items'}
        </p>
      </div>

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
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onSaveNote}
                disabled={isSavingNote || isSavingVoiceNote || !noteDraft.trim() || !primaryPlayer?.id}
                title={saveNoteDisabledReason}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingNote ? 'Saving...' : 'Save Note'}
              </button>
              <button
                type="button"
                onClick={isRecordingVoiceNote ? onStopVoiceNote : onStartVoiceNote}
                disabled={isSavingNote || isSavingVoiceNote || !primaryPlayer?.id}
                aria-label={isRecordingVoiceNote ? 'Stop player voice note recording' : 'Record player voice note'}
                title={voiceNoteDisabledReason || (isRecordingVoiceNote ? 'Stop recording' : 'Voice note')}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  isRecordingVoiceNote
                    ? 'border-red-500/50 bg-red-600 text-white hover:bg-red-700'
                    : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
                }`}
              >
                <MicIcon />
                {isRecordingVoiceNote ? 'Stop Recording' : isSavingVoiceNote ? 'Saving Voice Note...' : 'Voice Note'}
              </button>
            </div>

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
                        title={deletingNoteId === note.id ? 'Please wait while this note is being deleted.' : undefined}
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
                  {note.audioPath || note.audioUrl ? (
                    <p className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">
                      Deletes {formatRetentionDate(note.audioExpiresAt)} | {getRetentionCountdownLabel(note.audioExpiresAt)}
                    </p>
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
                <ActivityCard
                  key={log.id}
                  downloadError={openActivityId === log.id ? downloadError : ''}
                  isDownloading={downloadingActivityId === log.id}
                  isOpen={openActivityId === log.id}
                  log={log}
                  onDownloadPdf={async () => {
                    setDownloadError('')
                    setDownloadingActivityId(log.id)

                    try {
                      await exportPdfHtml({
                        clubId: log.clubId,
                        filename: buildActivityPdfFilename(log),
                        html: getMessagePdfHtml(log),
                      })
                    } catch (error) {
                      console.error(error)
                      setDownloadError(error.message || 'PDF could not be downloaded.')
                    } finally {
                      setDownloadingActivityId('')
                    }
                  }}
                  onToggle={() => setOpenActivityId((currentId) => (currentId === log.id ? '' : log.id))}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function ActivityCard({ downloadError, isDownloading, isOpen, log, onDownloadPdf, onToggle }) {
  const isEmail = log.channel === 'email' && log.action === 'parent_email_sent'

  if (!isEmail) {
    return (
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{getActivityLabel(log)}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {log.userName || log.userEmail || 'Staff'} | {formatActivityDate(log.createdAt)}
        </p>
        {log.recipientEmail ? (
          <p className="mt-1 break-words text-xs text-[var(--text-muted)]">Recipient: {log.recipientEmail}</p>
        ) : null}
      </div>
    )
  }

  const assessmentFields = getMessageAssessmentFields(log)
  const body = getMessageBody(log)
  const canDownloadPdf = canDownloadMessagePdf(log)
  const clubLabel = getMessageClubLabel(log)
  const playerLabel = getMessagePlayerLabel(log)
  const subject = getMessageSubject(log)
  const teamLabel = getMessageTeamLabel(log)
  const templateName = getMessageTemplateName(log)

  return (
    <article className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="block w-full px-4 py-3 text-left transition hover:bg-[var(--panel-soft)]"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{subject}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {log.userName || log.userEmail || 'Staff'} | {formatActivityDate(log.createdAt)}
            </p>
            {log.recipientEmail ? (
              <p className="mt-1 break-words text-xs text-[var(--text-muted)]">Recipient: {log.recipientEmail}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {messageHasAttachment(log) ? (
              <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                PDF attached
              </span>
            ) : null}
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {isOpen ? 'Hide email' : 'View email'}
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="border-t border-[var(--border-color)] px-4 py-4">
          <div className="grid gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-2">
            {templateName ? <InfoLine label="Template" value={templateName} /> : null}
            {playerLabel ? <InfoLine label="Player" value={playerLabel} /> : null}
            {teamLabel ? <InfoLine label="Team" value={teamLabel} /> : null}
            {clubLabel ? <InfoLine label="Club" value={clubLabel} /> : null}
          </div>

          <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
            {body ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">{body}</p>
            ) : (
              <p className="text-sm leading-6 text-[var(--text-muted)]">No email body was recorded for this message.</p>
            )}
          </div>

          {assessmentFields.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Assessment details</p>
              {assessmentFields.map((field) => (
                <div key={field.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {field.label}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-muted)]">
                    {String(field.value ?? '')}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {messageHasAttachment(log) ? (
            <div className="mt-4">
              {canDownloadPdf ? (
                <button
                  type="button"
                  onClick={onDownloadPdf}
                  disabled={isDownloading}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDownloading ? 'Downloading...' : 'Download PDF'}
                </button>
              ) : (
                <p className="text-sm leading-6 text-[var(--text-muted)]">
                  A PDF was attached to this email, but the download source was not recorded for this older message.
                </p>
              )}
            </div>
          ) : null}

          {downloadError ? (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-100">
              {downloadError}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function buildActivityPdfFilename(log) {
  const playerName = getMessagePlayerLabel(log)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'player-feedback'

  return `${playerName}-sent-email.pdf`
}

function InfoLine({ label, value }) {
  return (
    <p className="break-words">
      <span className="font-semibold text-[var(--text-secondary)]">{label}: </span>
      {value}
    </p>
  )
}
