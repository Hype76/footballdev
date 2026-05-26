import { useNavigate } from 'react-router-dom'
import { ConfirmModal } from '../ui/ConfirmModal.jsx'
import { ScheduleDateTimePicker } from '../ui/ScheduleDateTimePicker.jsx'

const optionPanelClass = 'rounded-lg border border-slate-200 bg-[#f9fafb] p-4 shadow-sm shadow-slate-200/60'
const choiceClass = 'flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[#101828] shadow-sm shadow-slate-200/50'
const checkboxClass = 'mt-1 h-4 w-4 rounded border-slate-200 accent-[#067a46]'
const titleClass = 'block text-sm font-black text-[#101828]'
const bodyClass = 'mt-1 block text-sm font-semibold leading-6 text-[#667085]'

export function PlayerProfileModals({
  emailSendMode,
  emailConfirmTarget,
  emailSendingId,
  evaluationDeleteTarget,
  evaluations,
  isDeleting,
  isDeletingEvaluationId,
  isMergeConfirmOpen,
  isMergingEvaluations,
  isAssessmentFieldsApproved,
  isPdfAttachmentApproved,
  isReassigningId,
  mergeSelectedEvaluations,
  noPlaceArchiveTarget,
  onArchiveAfterNoPlaceEmail,
  onCancelArchiveAfterNoPlaceEmail,
  onCancelDeleteEvaluation,
  onCancelDeletePlayer,
  onCancelEmail,
  onCancelMerge,
  onCancelReassign,
  onAssessmentFieldsApprovedChange,
  onConfirmDeleteEvaluation,
  onConfirmDeletePlayer,
  onConfirmEmail,
  onEmailSendModeChange,
  onConfirmMerge,
  onConfirmReassign,
  onPdfAttachmentApprovedChange,
  onScheduledEmailDateTimeChange,
  playerDeleteTarget,
  players,
  reassignConfirmTarget,
  routePlayerName,
  scheduledEmailDateTime,
}) {
  const navigate = useNavigate()
  const canAttachPdf = Boolean(emailConfirmTarget)
  const fieldCount = emailConfirmTarget?.responses?.length || 0
  const canAttachAssessmentFields = fieldCount > 0
  const isDefaultTemplateEmail = Boolean(emailConfirmTarget?.usesDefaultTemplate)

  return (
    <>
      <ConfirmModal
        isOpen={Boolean(evaluationDeleteTarget)}
        isBusy={Boolean(isDeletingEvaluationId)}
        title="Delete development record"
        message="This removes the development record from the player history and average score calculations."
        items={[
          `Player: ${evaluationDeleteTarget?.playerName || routePlayerName}`,
          `Date: ${evaluationDeleteTarget?.date || 'No date entered'}`,
          `Session: ${evaluationDeleteTarget?.session || 'No session entered'}`,
          `Team: ${evaluationDeleteTarget?.team || 'No team entered'}`,
        ]}
        confirmLabel="Delete record"
        onCancel={onCancelDeleteEvaluation}
        requirePassword
        onConfirm={onConfirmDeleteEvaluation}
      />

      <ConfirmModal
        isOpen={Boolean(reassignConfirmTarget)}
        isBusy={Boolean(isReassigningId)}
        title="Move development record"
        message="Use this when a report was saved against the wrong player."
        itemsTitle="This will change:"
        items={[
          `From player: ${routePlayerName}`,
          `To player: ${reassignConfirmTarget?.targetPlayer?.playerName || 'Selected player'}`,
          `Record date: ${reassignConfirmTarget?.evaluation?.date || 'No date entered'}`,
        ]}
        confirmLabel="Move record"
        onCancel={onCancelReassign}
        onConfirm={onConfirmReassign}
      />

      <ConfirmModal
        isOpen={isMergeConfirmOpen}
        isBusy={isMergingEvaluations}
        title="Create merged development record"
        message="This creates a new merged development record. Source reports stay in history."
        itemsTitle="This will create:"
        items={[
          `Player: ${routePlayerName}`,
          `${mergeSelectedEvaluations.length} selected records merged into one new development record`,
          'Original records will stay unchanged',
        ]}
        confirmLabel="Create merged record"
        onCancel={onCancelMerge}
        onConfirm={onConfirmMerge}
      />

      <ConfirmModal
        isOpen={Boolean(playerDeleteTarget)}
        isBusy={isDeleting}
        title="Delete player"
        message="This moves the player into archived players. Their saved development records stay available for record keeping."
        items={[
          `Player: ${playerDeleteTarget?.playerName || routePlayerName}`,
          `${playerDeleteTarget?.playerCount ?? players.length} player record entries moved to archive`,
          `${playerDeleteTarget?.evaluationCount ?? evaluations.length} saved development records kept in history`,
        ]}
        itemsTitle="This will archive:"
        confirmLabel="Archive Player"
        onCancel={onCancelDeletePlayer}
        requireReason
        reasonLabel="Archive reason"
        reasonPlaceholder="Explain why this player is being archived."
        requirePassword
        onConfirm={onConfirmDeletePlayer}
      />

      <ConfirmModal
        isOpen={Boolean(emailConfirmTarget)}
        isBusy={Boolean(emailConfirmTarget?.evaluation && emailSendingId === emailConfirmTarget.evaluation.id)}
        title={isDefaultTemplateEmail ? 'Default template' : emailConfirmTarget?.evaluation?.isDirectEmail ? 'Send email' : 'Email parents'}
        message={
          isDefaultTemplateEmail
            ? 'You are sending a default template. You can continue now, or open Templates to customise it first.'
            : 'Check the email details before sending.'
        }
        itemsTitle="This will send:"
        items={[
          `Player: ${routePlayerName}`,
          `Recipients: ${emailConfirmTarget?.recipientEmails || 'No recipients selected'}`,
          `Template: ${emailConfirmTarget?.templateName || 'Email template'}`,
          `Subject: ${emailConfirmTarget?.payloads?.[0]?.payload?.subject || 'Football Player Report'}`,
          `Team: ${emailConfirmTarget?.payloads?.[0]?.payload?.team || 'No team entered'}`,
          `Club: ${emailConfirmTarget?.payloads?.[0]?.payload?.club || 'No club entered'}`,
          `Attachment: ${canAttachPdf && isPdfAttachmentApproved ? 'PDF approved' : 'No PDF attached'}`,
          `Development fields: ${canAttachAssessmentFields && isAssessmentFieldsApproved ? `${fieldCount} attached` : 'Not attached'}`,
          emailConfirmTarget?.inviteDate ? `Invite date: ${emailConfirmTarget.inviteDate}` : 'Invite date: Not included',
        ]}
        confirmLabel={emailSendMode === 'scheduled' ? 'Schedule Email' : 'Send Now'}
        confirmDisabled={emailSendMode === 'scheduled' && !scheduledEmailDateTime}
        cancelLabel={isDefaultTemplateEmail ? 'Configure Email Templates' : 'Cancel'}
        onClose={onCancelEmail}
        onCancel={() => {
          if (isDefaultTemplateEmail) {
            navigate('/parent-email-templates')
            return
          }

          onCancelEmail()
        }}
        onConfirm={onConfirmEmail}
      >
        <div className={optionPanelClass}>
          <span className={titleClass}>Send timing</span>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className={choiceClass}>
              <input
                type="radio"
                name="email-send-mode"
                value="now"
                checked={emailSendMode !== 'scheduled'}
                onChange={() => onEmailSendModeChange('now')}
                className="h-4 w-4 accent-[#067a46]"
              />
              Send now
            </label>
            <label className={choiceClass}>
              <input
                type="radio"
                name="email-send-mode"
                value="scheduled"
                checked={emailSendMode === 'scheduled'}
                onChange={() => onEmailSendModeChange('scheduled')}
                className="h-4 w-4 accent-[#067a46]"
              />
              Schedule
            </label>
          </div>
          {emailSendMode === 'scheduled' ? (
            <div className="mt-3">
              <ScheduleDateTimePicker
                value={scheduledEmailDateTime}
                onChange={onScheduledEmailDateTimeChange}
              />
            </div>
          ) : null}
        </div>
        {canAttachAssessmentFields ? (
          <label className={`flex items-start gap-3 ${optionPanelClass}`}>
            <input
              type="checkbox"
              checked={Boolean(isAssessmentFieldsApproved)}
              onChange={(event) => onAssessmentFieldsApprovedChange(event.target.checked)}
              className={checkboxClass}
            />
            <span>
              <span className={titleClass}>Attach development fields</span>
              <span className={bodyClass}>
                Include the selected development fields in the email body.
              </span>
            </span>
          </label>
        ) : null}
        {canAttachPdf ? (
          <label className={`flex items-start gap-3 ${optionPanelClass}`}>
            <input
              type="checkbox"
              checked={Boolean(isPdfAttachmentApproved)}
              onChange={(event) => onPdfAttachmentApprovedChange(event.target.checked)}
              className={checkboxClass}
            />
            <span>
              <span className={titleClass}>Attach development PDF</span>
              <span className={bodyClass}>
                Include the selected development details as a PDF attachment.
              </span>
            </span>
          </label>
        ) : null}
      </ConfirmModal>

      <ConfirmModal
        isOpen={Boolean(noPlaceArchiveTarget)}
        isBusy={isDeleting}
        title="Archive player?"
        message="The No Place Offered email has been sent. Do you want to move this player to archived players now?"
        items={[
          `Player: ${noPlaceArchiveTarget?.playerName || routePlayerName}`,
          `${noPlaceArchiveTarget?.playerCount ?? players.length} player record entries moved to archive`,
          `${noPlaceArchiveTarget?.evaluationCount ?? evaluations.length} saved development records kept in history`,
        ]}
        itemsTitle="If you continue:"
        confirmLabel="Archive Player"
        onCancel={onCancelArchiveAfterNoPlaceEmail}
        requireReason
        reasonLabel="Archive reason"
        reasonPlaceholder="Explain why this player is being archived."
        onConfirm={onArchiveAfterNoPlaceEmail}
      />
    </>
  )
}
