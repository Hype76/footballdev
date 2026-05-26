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
  onReorderExportField,
  onSelectAllExportFields,
  onSelectedEmailTemplateChange,
  onSendParentEmail,
  onSendTestEmail,
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
      title="Past development records"
      description="History is scoped by club and role, with sharing actions available on each record."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[#cfeedd] bg-[#f8fdf9] px-6 py-10 text-center text-sm font-bold text-[#5f7468] shadow-sm shadow-[#d7eadf]/60">
          Loading player history...
        </div>
      ) : evaluations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-6 py-10 text-center shadow-sm shadow-[#d7eadf]/60">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[#067a46]">Player History</p>
          <p className="mt-3 text-xl font-black text-[#101828]">No history for this player yet</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">
            Once development records are saved for this player, the full review trail will appear here.
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
                onReorderExportField={onReorderExportField}
                onSelectAllExportFields={onSelectAllExportFields}
                onSelectedEmailTemplateChange={onSelectedEmailTemplateChange}
                onSendParentEmail={onSendParentEmail}
                onSendTestEmail={onSendTestEmail}
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
