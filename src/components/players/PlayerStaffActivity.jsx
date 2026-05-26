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

const panelClass = 'rounded-lg border border-slate-200 bg-[#f9fafb] shadow-sm shadow-slate-200/60'
const cardClass = 'rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/60'
const fieldClass = 'w-full rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-slate-400 focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.16em] text-[#067a46]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#667085]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60'

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
      <div className={`${panelClass} mb-5 px-4 py-4`}>
        <p className="text-sm font-black text-[#101828]">Staff notes and player activity</p>
        <p className={`mt-1 ${bodyClass}`}>
          {staffNotes.length} staff {staffNotes.length === 1 ? 'note' : 'notes'} | {activityLogs.length} activity{' '}
          {activityLogs.length === 1 ? 'item' : 'items'}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className="block">
              <span className={labelClass}>Add internal note</span>
              <textarea
                value={noteDraft}
                onChange={(event) => onNoteChange(event.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Add a staff-only note for this player"
              />
            </label>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onSaveNote}
                disabled={isSavingNote || isSavingVoiceNote || !noteDraft.trim() || !primaryPlayer?.id}
                title={saveNoteDisabledReason}
                className={primaryButtonClass}
              >
                {isSavingNote ? 'Saving...' : 'Save Note'}
              </button>
              <button
                type="button"
                onClick={isRecordingVoiceNote ? onStopVoiceNote : onStartVoiceNote}
                disabled={isSavingNote || isSavingVoiceNote || !primaryPlayer?.id}
                aria-label={isRecordingVoiceNote ? 'Stop player voice note recording' : 'Record player voice note'}
                title={voiceNoteDisabledReason || (isRecordingVoiceNote ? 'Stop recording' : 'Voice note')}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  isRecordingVoiceNote
                    ? 'border-red-500/50 bg-red-600 text-white hover:bg-red-700'
                    : 'border-slate-200 bg-white text-[#101828] hover:bg-slate-100'
                }`}
              >
                <MicIcon />
                {isRecordingVoiceNote ? 'Stop Recording' : isSavingVoiceNote ? 'Saving Voice Note...' : 'Voice Note'}
              </button>
            </div>

          <div className="mt-4 space-y-3">
            {staffNotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-[#f9fafb] px-4 py-4 text-sm font-bold text-[#667085]">
                No staff notes yet.
              </div>
            ) : (
              staffNotes.map((note) => (
                <div key={note.id} className={`${cardClass} px-4 py-3`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#101828]">{note.note}</p>
                    {note.audioPath || note.audioUrl ? (
                      <button
                        type="button"
                        disabled={deletingNoteId === note.id}
                        title={deletingNoteId === note.id ? 'Please wait while this note is being deleted.' : undefined}
                        onClick={() => onDeleteNote(note)}
                        className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                    <p className="mt-2 text-xs font-black text-[#067a46]">
                      Deletes {formatRetentionDate(note.audioExpiresAt)} | {getRetentionCountdownLabel(note.audioExpiresAt)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                    {note.userName || note.userEmail || 'Staff'} | {formatActivityDate(note.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <p className="text-sm font-black text-[#101828]">Player activity</p>
          <div className="mt-3 space-y-3">
            {activityLogs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-[#f9fafb] px-4 py-4 text-sm font-bold text-[#667085]">
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
      <div className={`${cardClass} px-4 py-3`}>
        <p className="text-sm font-black text-[#101828]">{getActivityLabel(log)}</p>
        <p className={`mt-1 ${bodyClass}`}>
          {log.userName || log.userEmail || 'Staff'} | {formatActivityDate(log.createdAt)}
        </p>
        {log.recipientEmail ? (
          <p className="mt-1 break-words text-xs font-semibold text-[#667085]">Recipient: {log.recipientEmail}</p>
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
    <article className={`${cardClass} overflow-hidden`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="block w-full px-4 py-3 text-left transition hover:bg-slate-100"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-[#101828]">{subject}</p>
            <p className={`mt-1 ${bodyClass}`}>
              {log.userName || log.userEmail || 'Staff'} | {formatActivityDate(log.createdAt)}
            </p>
            {log.recipientEmail ? (
              <p className="mt-1 break-words text-xs font-semibold text-[#667085]">Recipient: {log.recipientEmail}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {messageHasAttachment(log) ? (
              <span className="inline-flex w-fit rounded-lg border border-[#b7efce] bg-[#ecfdf3] px-3 py-1 text-xs font-black text-[#067a46]">
                PDF attached
              </span>
            ) : null}
            <span className="inline-flex w-fit rounded-lg border border-slate-200 bg-[#f9fafb] px-3 py-1 text-xs font-black text-[#067a46]">
              {isOpen ? 'Hide email' : 'View email'}
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="border-t border-slate-200 px-4 py-4">
          <div className="grid gap-2 text-xs font-semibold text-[#667085] sm:grid-cols-2">
            {templateName ? <InfoLine label="Template" value={templateName} /> : null}
            {playerLabel ? <InfoLine label="Player" value={playerLabel} /> : null}
            {teamLabel ? <InfoLine label="Team" value={teamLabel} /> : null}
            {clubLabel ? <InfoLine label="Club" value={clubLabel} /> : null}
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3">
            {body ? (
              <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#667085]">{body}</p>
            ) : (
              <p className={bodyClass}>No email body was recorded for this message.</p>
            )}
          </div>

          {assessmentFields.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className={eyebrowClass}>Development details</p>
              {assessmentFields.map((field) => (
                <div key={field.label} className="rounded-lg border border-slate-200 bg-[#f9fafb] px-3 py-2">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                    {field.label}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-[#667085]">
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
                  className={secondaryButtonClass}
                >
                  {isDownloading ? 'Downloading...' : 'Download PDF'}
                </button>
              ) : (
                <p className={bodyClass}>
                  A PDF was attached to this email, but the download source was not recorded for this older message.
                </p>
              )}
            </div>
          ) : null}

          {downloadError ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
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
      <span className="font-black text-[#067a46]">{label}: </span>
      {value}
    </p>
  )
}
