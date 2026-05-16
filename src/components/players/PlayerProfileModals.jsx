import { useNavigate } from 'react-router-dom'
import { ConfirmModal } from '../ui/ConfirmModal.jsx'

export function PlayerProfileModals({
  emailConfirmTarget,
  emailSendingId,
  evaluationDeleteTarget,
  evaluations,
  isDeleting,
  isDeletingEvaluationId,
  isMergeConfirmOpen,
  isMergingEvaluations,
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
  onConfirmDeleteEvaluation,
  onConfirmDeletePlayer,
  onConfirmEmail,
  onConfirmMerge,
  onConfirmReassign,
  onPdfAttachmentApprovedChange,
  playerDeleteTarget,
  players,
  reassignConfirmTarget,
  routePlayerName,
}) {
  const navigate = useNavigate()
  const canAttachPdf = Boolean(emailConfirmTarget)
  const isDefaultTemplateEmail = Boolean(emailConfirmTarget?.usesDefaultTemplate)

  return (
    <>
      <ConfirmModal
        isOpen={Boolean(evaluationDeleteTarget)}
        isBusy={Boolean(isDeletingEvaluationId)}
        title="Delete assessment"
        message="This removes the assessment from the player history and average score calculations."
        items={[
          `Player: ${evaluationDeleteTarget?.playerName || routePlayerName}`,
          `Date: ${evaluationDeleteTarget?.date || 'No date entered'}`,
          `Session: ${evaluationDeleteTarget?.session || 'No session entered'}`,
          `Team: ${evaluationDeleteTarget?.team || 'No team entered'}`,
        ]}
        confirmLabel="Delete Assessment"
        onCancel={onCancelDeleteEvaluation}
        requirePassword
        onConfirm={onConfirmDeleteEvaluation}
      />

      <ConfirmModal
        isOpen={Boolean(reassignConfirmTarget)}
        isBusy={Boolean(isReassigningId)}
        title="Move assessment"
        message="Use this when a report was saved against the wrong player."
        itemsTitle="This will change:"
        items={[
          `From player: ${routePlayerName}`,
          `To player: ${reassignConfirmTarget?.targetPlayer?.playerName || 'Selected player'}`,
          `Assessment date: ${reassignConfirmTarget?.evaluation?.date || 'No date entered'}`,
        ]}
        confirmLabel="Move Assessment"
        onCancel={onCancelReassign}
        onConfirm={onConfirmReassign}
      />

      <ConfirmModal
        isOpen={isMergeConfirmOpen}
        isBusy={isMergingEvaluations}
        title="Create merged assessment"
        message="This creates a new merged assessment. Source reports stay in history."
        itemsTitle="This will create:"
        items={[
          `Player: ${routePlayerName}`,
          `${mergeSelectedEvaluations.length} selected assessments merged into one new assessment`,
          'Original assessments will stay unchanged',
        ]}
        confirmLabel="Create Merged Assessment"
        onCancel={onCancelMerge}
        onConfirm={onConfirmMerge}
      />

      <ConfirmModal
        isOpen={Boolean(playerDeleteTarget)}
        isBusy={isDeleting}
        title="Delete player"
        message="This moves the player into archived players. Their saved assessments stay available for record keeping."
        items={[
          `Player: ${playerDeleteTarget?.playerName || routePlayerName}`,
          `${playerDeleteTarget?.playerCount ?? players.length} player record entries moved to archive`,
          `${playerDeleteTarget?.evaluationCount ?? evaluations.length} saved assessments kept in history`,
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
          `Subject: ${emailConfirmTarget?.payloads?.[0]?.payload?.subject || 'Player Feedback Report'}`,
          `Team: ${emailConfirmTarget?.payloads?.[0]?.payload?.team || 'No team entered'}`,
          `Club: ${emailConfirmTarget?.payloads?.[0]?.payload?.club || 'No club entered'}`,
          `Attachment: ${canAttachPdf && isPdfAttachmentApproved ? 'PDF approved' : 'No PDF attached'}`,
          `Assessment fields: ${emailConfirmTarget?.responses?.length || 0} selected`,
          emailConfirmTarget?.inviteDate ? `Invite date: ${emailConfirmTarget.inviteDate}` : 'Invite date: Not included',
        ]}
        confirmLabel={isDefaultTemplateEmail ? 'Continue' : 'Send Now'}
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
        {canAttachPdf ? (
          <label className="flex items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <input
              type="checkbox"
              checked={Boolean(isPdfAttachmentApproved)}
              onChange={(event) => onPdfAttachmentApprovedChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[var(--border-color)] accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--text-primary)]">Attach assessment PDF</span>
              <span className="mt-1 block text-sm leading-6 text-[var(--text-muted)]">
                Include the selected assessment details as a PDF attachment.
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
          `${noPlaceArchiveTarget?.evaluationCount ?? evaluations.length} saved assessments kept in history`,
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
