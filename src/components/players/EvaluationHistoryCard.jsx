import { useState } from 'react'
import { canDeletePlayer, canEditEvaluation } from '../../lib/auth.js'
import { hasPlanFeature } from '../../lib/plans.js'
import { buildEvaluationSummary } from '../../hooks/players/playerProfileUtils.js'
import { EvaluationExportFieldsSelector } from '../evaluations/EvaluationExportFieldsSelector.jsx'

const panelClass = 'rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10'
const fieldClass = 'min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#475569]'
const secondaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 text-sm font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#2563eb] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60'
const smallButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-xs font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#2563eb] hover:bg-[#eff6ff]'

export function EvaluationHistoryCard({
  availableEmailTemplates,
  availablePlayers,
  canDeleteEvaluations,
  canShare,
  emailSendingId,
  evaluation,
  evaluationParentContacts,
  hasSavedExportSelection,
  isDeleting,
  isDeletingEvaluationId,
  isDemoAccount,
  isReassigningId,
  onClearExportFields,
  onDeleteEvaluation,
  onEditEvaluation,
  onInviteDateChange,
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
  playerName,
  responseItems,
  selectedExportLabels,
  selectedInviteDate,
  selectedParentContacts,
  selectedReassignTargets,
  selectedResponseItems,
  selectedTemplateKey,
  shouldShowInviteDate,
  user,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const deleteAssessmentDisabledReason =
    isDeletingEvaluationId === evaluation.id ? 'Please wait while this development record is being deleted.' : undefined
  const reassignSelectDisabledReason =
    availablePlayers.length === 0 ? 'Add another player before this report can be moved.' : undefined
  const reassignDisabledReason = isReassigningId === evaluation.id
    ? 'Please wait while this report is being moved.'
    : !selectedReassignTargets[evaluation.id]
      ? 'Choose the correct player before moving this report.'
      : undefined
  const emailParentsDisabledReason = emailSendingId === evaluation.id
    ? 'Please wait while the email is being sent.'
    : !canShare
      ? 'You can only email development records you are allowed to view or edit.'
      : !hasPlanFeature(user, 'parentEmail')
        ? 'Parent email is not included in this plan.'
        : availableEmailTemplates.length === 0
          ? 'Create an email template before emailing parents.'
          : undefined
  const testEmailDisabledReason = emailSendingId === `test:${evaluation.id}`
    ? 'Please wait while the test email is being sent.'
    : !canShare
      ? 'You can only send tests for development records you are allowed to view or edit.'
      : !user?.email
        ? 'Your account email is not available, so the test cannot be sent.'
        : !hasPlanFeature(user, 'parentEmail')
          ? 'Parent and player email is not included in this plan.'
          : undefined
  const removePlayerDisabledReason = isDeleting ? 'Please wait while this player is being removed.' : undefined

  return (
    <div className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10 sm:p-5">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="block w-full text-left"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-lg font-black text-[#0f172a]">{evaluation.date || 'No date entered'}</p>
            {evaluation.session ? <p className="mt-1 text-sm font-semibold text-[#475569]">Session: {evaluation.session}</p> : null}
            <p className="mt-1 text-sm font-semibold text-[#475569]">Section: {evaluation.section || 'Trial'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-9 items-center rounded-lg border border-[#cbd5e1] bg-[#eff6ff] px-3 py-2 text-sm font-black text-[#2563eb]">
              Score: {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}
            </span>
            <span className="inline-flex min-h-9 items-center rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-black text-[#0f172a]">
              {isOpen ? 'Close' : 'Open'}
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
      <>
      <div className={`mt-5 ${panelClass}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-black text-[#0f172a]">Move report to another player</p>
            <p className={`mt-1 ${bodyClass}`}>
              Use this if a report was saved against the wrong player.
            </p>
          </div>
          {canDeleteEvaluations ? (
            <button
              type="button"
              onClick={() => onDeleteEvaluation(evaluation)}
              disabled={isDeletingEvaluationId === evaluation.id}
              title={deleteAssessmentDisabledReason}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeletingEvaluationId === evaluation.id ? 'Deleting...' : 'Delete Record'}
            </button>
          ) : null}
        </div>
        <p className={`mt-1 ${bodyClass}`}>
          Deleting an old development record removes it from this player history and average score calculations.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block">
            <span className={labelClass}>Correct player</span>
            <select
              value={selectedReassignTargets[evaluation.id] || ''}
              onChange={(event) => onReassignTargetChange(evaluation.id, event.target.value)}
              disabled={availablePlayers.length === 0}
              title={reassignSelectDisabledReason}
              className={fieldClass}
            >
              <option value="">
                {availablePlayers.length === 0 ? 'No other players available' : 'Select player'}
              </option>
              {availablePlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.playerName}, Section: {player.section || 'Trial'}, Team: {player.team || 'No team assigned'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onReassignEvaluation(evaluation)}
            disabled={!selectedReassignTargets[evaluation.id] || isReassigningId === evaluation.id}
            title={reassignDisabledReason}
            className={`${secondaryButtonClass} md:w-auto`}
          >
            {isReassigningId === evaluation.id ? 'Moving...' : 'Move Report'}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_minmax(220px,1fr)_auto_auto_auto_auto] xl:items-end">
        {availableEmailTemplates.length > 0 ? (
          <label className="block">
            <span className={labelClass}>Email template</span>
            <select
              value={selectedTemplateKey}
              onChange={(event) => onSelectedEmailTemplateChange(evaluation.id, event.target.value)}
              className={fieldClass}
            >
              {availableEmailTemplates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-bold text-[#475569] shadow-sm shadow-[#2563eb]/10">
            Create a club email template before sending emails.
          </div>
        )}
        {shouldShowInviteDate ? (
          <label className="block">
            <span className={labelClass}>Invite date</span>
            <input
              type="date"
              value={selectedInviteDate}
              onChange={(event) => onInviteDateChange(evaluation.id, event.target.value)}
              className={fieldClass}
            />
          </label>
        ) : (
          <div className="hidden xl:block" />
        )}
        <EvaluationRecipients
          contacts={evaluationParentContacts}
          evaluationId={evaluation.id}
          onToggleEvaluationParentContact={onToggleEvaluationParentContact}
          selectedParentContacts={selectedParentContacts}
        />
        <EvaluationExportFields
          hasSavedExportSelection={hasSavedExportSelection}
          onClearExportFields={onClearExportFields}
          onReorderExportField={onReorderExportField}
          onSelectAllExportFields={onSelectAllExportFields}
          onToggleExportField={onToggleExportField}
          playerName={playerName}
          responseItems={responseItems}
          selectedExportLabels={selectedExportLabels}
          selectedResponseItems={selectedResponseItems}
        />
        {!isDemoAccount ? (
          <>
            <button
              type="button"
              onClick={() => onSendTestEmail(evaluation)}
              disabled={emailSendingId === `test:${evaluation.id}` || !canShare || !user?.email || !hasPlanFeature(user, 'parentEmail')}
              title={testEmailDisabledReason || 'Send a test copy to your email address'}
              className={secondaryButtonClass}
            >
              {emailSendingId === `test:${evaluation.id}` ? 'Sending...' : 'Test Email'}
            </button>
            <button
              type="button"
              onClick={() => onSendParentEmail(evaluation)}
              disabled={emailSendingId === evaluation.id || !canShare || !hasPlanFeature(user, 'parentEmail') || availableEmailTemplates.length === 0}
              title={emailParentsDisabledReason || 'Email parents'}
              className={secondaryButtonClass}
            >
              {emailSendingId === evaluation.id ? 'Sending...' : 'Email Parents'}
            </button>
          </>
        ) : null}
        {canEditEvaluation(user, evaluation) ? (
          <button
            type="button"
            onClick={() => onEditEvaluation(evaluation)}
            className={secondaryButtonClass}
          >
            Edit Record
          </button>
        ) : null}
      </div>

      {selectedTemplateKey === 'decline' && canDeletePlayer(user) ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm shadow-red-100/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black text-[#0f172a]">No place offered</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-red-700">
                If this player is no longer needed, you can remove them from the system after preparing the parent email.
              </p>
            </div>
            <button
              type="button"
              disabled={isDeleting}
              title={removePlayerDisabledReason}
              onClick={onRemovePlayer}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeleting ? 'Removing...' : 'Remove From System'}
            </button>
          </div>
        </div>
      ) : null}

      {evaluationParentContacts.length > 0 ? (
        <div className="mt-5">
          <p className={eyebrowClass}>Parent details</p>
          <div className="mt-3 space-y-1">
            {evaluationParentContacts.map((contact, index) => (
              <p key={index} className={bodyClass}>
                {contact.name || 'Parent/Guardian'}{contact.email ? ` | ${contact.email}` : ''}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className={eyebrowClass}>Summary</p>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#475569]">
          {buildEvaluationSummary(evaluation)}
        </p>
      </div>

      <div className="mt-5">
        <p className={eyebrowClass}>Responses</p>
        <div className="mt-3 space-y-2">
          {responseItems.length > 0 ? (
            responseItems.map((item) => (
              <div key={item.label} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 shadow-sm shadow-[#2563eb]/10">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">{item.label}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#475569]">{String(item.value)}</p>
              </div>
            ))
          ) : (
            <p className={bodyClass}>No responses provided.</p>
          )}
        </div>
      </div>
      </>
      ) : null}
    </div>
  )
}

function EvaluationRecipients({
  contacts,
  evaluationId,
  onToggleEvaluationParentContact,
  selectedParentContacts,
}) {
  return (
    <div>
      <span className={labelClass}>Email recipients</span>
      {contacts.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-3 shadow-sm shadow-[#2563eb]/10">
          {contacts.map((contact, index) => {
            const selectedIndexes = selectedParentContacts[evaluationId] ?? contacts.map((_, contactIndex) => contactIndex)

            return (
              <label key={`${contact.email || contact.name}-${index}`} className="flex items-start gap-2 text-sm font-black text-[#0f172a]">
                <input
                  type="checkbox"
                  checked={selectedIndexes.includes(index)}
                  onChange={() => onToggleEvaluationParentContact(evaluationId, index, contacts)}
                  className="mt-1 h-4 w-4 accent-[#2563eb]"
                />
                <span className="min-w-0">
                  <span className="block font-black">{contact.name || 'Parent/Guardian'}</span>
                  <span className="block break-words text-xs font-semibold text-[#475569]">{contact.email || 'No email entered'}</span>
                </span>
              </label>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-bold text-[#475569] shadow-sm shadow-[#2563eb]/10">
          No parent contacts entered.
        </div>
      )}
    </div>
  )
}

function EvaluationExportFields({
  hasSavedExportSelection,
  onClearExportFields,
  onReorderExportField,
  onSelectAllExportFields,
  onToggleExportField,
  playerName,
  responseItems,
  selectedExportLabels,
  selectedResponseItems,
}) {
  return (
    <div className="xl:col-span-7">
      <div className={panelClass}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-black text-[#0f172a]">Development details to include</p>
            <p className={`mt-1 ${bodyClass}`}>
              Choose what goes into the parent email. This choice is saved in this browser for {playerName}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSelectAllExportFields(responseItems)}
              className={smallButtonClass}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={onClearExportFields}
              className={smallButtonClass}
            >
              Clear
            </button>
          </div>
        </div>

        {responseItems.length > 0 ? (
          <EvaluationExportFieldsSelector
            gridClassName="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3"
            hasSavedExportSelection={hasSavedExportSelection}
            onReorderExportField={onReorderExportField}
            onToggleExportField={onToggleExportField}
            responseItems={responseItems}
            selectedExportLabels={selectedExportLabels}
          />
        ) : (
          <p className="mt-4 rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 text-sm font-bold text-[#475569] shadow-sm shadow-[#2563eb]/10">
            No development responses above zero were entered for this record.
          </p>
        )}

        <p className="mt-3 text-xs font-semibold leading-5 text-[#475569]">
          {selectedResponseItems.length} of {responseItems.length} field{responseItems.length === 1 ? '' : 's'} selected.
        </p>
      </div>
    </div>
  )
}
