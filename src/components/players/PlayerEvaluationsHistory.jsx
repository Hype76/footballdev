import { canShareEvaluation } from '../../lib/auth.js'
import { isInviteEmailTemplate } from '../../lib/email-templates.js'
import { getSelectedEvaluationResponses } from '../../lib/evaluation-export-selection.js'
import { PROFILE_EVALUATION_PAGE_SIZE } from '../../hooks/players/playerProfileUtils.js'
import { EvaluationHistoryCard } from './EvaluationHistoryCard.jsx'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlayerEvaluationsHistory({
  availablePlayers,
  canDeleteEvaluations,
  emailSendingId,
  evaluations,
  getAvailableEmailTemplates,
  getEvaluationParentContacts,
  getExportResponseItems,
  getSelectedEmailTemplateKey,
  getSelectedInviteDate,
  isDeleting,
  isDeletingEvaluationId,
  isDemoAccount,
  isLoading,
  isReassigningId,
  onClearExportFields,
  onDeleteEvaluation,
  onEditEvaluation,
  onInviteDateChange,
  onPageChange,
  onReassignEvaluation,
  onReassignTargetChange,
  onRemovePlayer,
  onSelectAllExportFields,
  onSelectedEmailTemplateChange,
  onSendParentEmail,
  onToggleEvaluationParentContact,
  onToggleExportField,
  page,
  paginatedEvaluations,
  playerName,
  selectedExportLabels,
  selectedParentContacts,
  selectedReassignTargets,
  user,
}) {
  return (
    <SectionCard
      title="Past assessments"
      description="History is scoped by club and role, with sharing actions available on each assessment."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center text-sm font-medium text-[var(--text-muted)]">
          Loading player history...
        </div>
      ) : evaluations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Player History</p>
          <p className="mt-3 text-xl font-semibold text-[var(--text-primary)]">No history for this player yet</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            Once assessments are saved for this player, the full review trail will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedEvaluations.items.map((evaluation) => {
            const responseItems = getExportResponseItems(evaluation)
            const selectedResponseItems = getSelectedEvaluationResponses(responseItems, selectedExportLabels)
            const canShare = canShareEvaluation(user, evaluation)
            const evaluationParentContacts = getEvaluationParentContacts(evaluation)
            const selectedTemplateKey = getSelectedEmailTemplateKey(evaluation)
            const availableEmailTemplates = getAvailableEmailTemplates(evaluation)
            const shouldShowInviteDate = isInviteEmailTemplate(selectedTemplateKey)
            const hasSavedExportSelection = Array.isArray(selectedExportLabels)

            return (
              <EvaluationHistoryCard
                key={evaluation.id}
                availableEmailTemplates={availableEmailTemplates}
                availablePlayers={availablePlayers}
                canDeleteEvaluations={canDeleteEvaluations}
                canShare={canShare}
                emailSendingId={emailSendingId}
                evaluation={evaluation}
                evaluationParentContacts={evaluationParentContacts}
                hasSavedExportSelection={hasSavedExportSelection}
                isDeleting={isDeleting}
                isDeletingEvaluationId={isDeletingEvaluationId}
                isDemoAccount={isDemoAccount}
                isReassigningId={isReassigningId}
                onClearExportFields={onClearExportFields}
                onDeleteEvaluation={onDeleteEvaluation}
                onEditEvaluation={onEditEvaluation}
                onInviteDateChange={onInviteDateChange}
                onReassignEvaluation={onReassignEvaluation}
                onReassignTargetChange={onReassignTargetChange}
                onRemovePlayer={onRemovePlayer}
                onSelectAllExportFields={onSelectAllExportFields}
                onSelectedEmailTemplateChange={onSelectedEmailTemplateChange}
                onSendParentEmail={onSendParentEmail}
                onToggleEvaluationParentContact={onToggleEvaluationParentContact}
                onToggleExportField={onToggleExportField}
                playerName={playerName}
                responseItems={responseItems}
                selectedExportLabels={selectedExportLabels}
                selectedInviteDate={getSelectedInviteDate(evaluation)}
                selectedParentContacts={selectedParentContacts}
                selectedReassignTargets={selectedReassignTargets}
                selectedResponseItems={selectedResponseItems}
                selectedTemplateKey={selectedTemplateKey}
                shouldShowInviteDate={shouldShowInviteDate}
                user={user}
              />
            )
          })}
          <Pagination
            currentPage={page}
            onPageChange={onPageChange}
            pageSize={PROFILE_EVALUATION_PAGE_SIZE}
            totalItems={evaluations.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
