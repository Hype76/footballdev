import { canDeletePlayer, canEditEvaluation } from '../../lib/auth.js'
import { hasPlanFeature } from '../../lib/plans.js'
import { buildEvaluationSummary } from '../../hooks/players/playerProfileUtils.js'

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
  const deleteAssessmentDisabledReason =
    isDeletingEvaluationId === evaluation.id ? 'Please wait while this assessment is being deleted.' : undefined
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
      ? 'You can only email assessments you are allowed to view or edit.'
      : !hasPlanFeature(user, 'parentEmail')
        ? 'Parent email is not included in this plan.'
        : availableEmailTemplates.length === 0
          ? 'Create an email template before emailing parents.'
          : undefined
  const testEmailDisabledReason = emailSendingId === `test:${evaluation.id}`
    ? 'Please wait while the test email is being sent.'
    : !canShare
      ? 'You can only send tests for assessments you are allowed to view or edit.'
      : !user?.email
        ? 'Your account email is not available, so the test cannot be sent.'
        : !hasPlanFeature(user, 'parentEmail')
          ? 'Parent and player email is not included in this plan.'
          : undefined
  const removePlayerDisabledReason = isDeleting ? 'Please wait while this player is being removed.' : undefined

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:p-5">
      <div>
        <div>
          <p className="text-lg font-semibold text-[var(--text-primary)]">{evaluation.date || 'No date entered'}</p>
          {evaluation.session ? <p className="mt-1 text-sm text-[var(--text-muted)]">Session: {evaluation.session}</p> : null}
          <p className="mt-1 text-sm text-[var(--text-muted)]">Section: {evaluation.section || 'Trial'}</p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Move report to another player</p>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              Use this if a report was saved against the wrong player.
            </p>
          </div>
          {canDeleteEvaluations ? (
            <button
              type="button"
              onClick={() => onDeleteEvaluation(evaluation)}
              disabled={isDeletingEvaluationId === evaluation.id}
              title={deleteAssessmentDisabledReason}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeletingEvaluationId === evaluation.id ? 'Deleting...' : 'Delete Assessment'}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
          Deleting an old assessment removes it from this player history and average score calculations.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Correct player</span>
            <select
              value={selectedReassignTargets[evaluation.id] || ''}
              onChange={(event) => onReassignTargetChange(evaluation.id, event.target.value)}
              disabled={availablePlayers.length === 0}
              title={reassignSelectDisabledReason}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {availablePlayers.length === 0 ? 'No other players available' : 'Select player'}
              </option>
              {availablePlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.playerName} | {player.section || 'Trial'} | {player.team || 'No team'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onReassignEvaluation(evaluation)}
            disabled={!selectedReassignTargets[evaluation.id] || isReassigningId === evaluation.id}
            title={reassignDisabledReason}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
          >
            {isReassigningId === evaluation.id ? 'Moving...' : 'Move Report'}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_minmax(220px,1fr)_auto_auto_auto_auto] xl:items-end">
        {availableEmailTemplates.length > 0 ? (
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email template</span>
            <select
              value={selectedTemplateKey}
              onChange={(event) => onSelectedEmailTemplateChange(evaluation.id, event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              {availableEmailTemplates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-muted)]">
            Create a club email template before sending emails.
          </div>
        )}
        {shouldShowInviteDate ? (
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Invite date</span>
            <input
              type="date"
              value={selectedInviteDate}
              onChange={(event) => onInviteDateChange(evaluation.id, event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {emailSendingId === `test:${evaluation.id}` ? 'Sending...' : 'Test Email'}
            </button>
            <button
              type="button"
              onClick={() => onSendParentEmail(evaluation)}
              disabled={emailSendingId === evaluation.id || !canShare || !hasPlanFeature(user, 'parentEmail') || availableEmailTemplates.length === 0}
              title={emailParentsDisabledReason || 'Email parents'}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {emailSendingId === evaluation.id ? 'Sending...' : 'Email Parents'}
            </button>
          </>
        ) : null}
        {canEditEvaluation(user, evaluation) ? (
          <button
            type="button"
            onClick={() => onEditEvaluation(evaluation)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Edit Assessment
          </button>
        ) : null}
      </div>

      {selectedTemplateKey === 'decline' && canDeletePlayer(user) ? (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/20 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">No place offered</p>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                If this player is no longer needed, you can remove them from the system after preparing the parent email.
              </p>
            </div>
            <button
              type="button"
              disabled={isDeleting}
              title={removePlayerDisabledReason}
              onClick={onRemovePlayer}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeleting ? 'Removing...' : 'Remove From System'}
            </button>
          </div>
        </div>
      ) : null}

      {evaluationParentContacts.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Parent details</p>
          <div className="mt-3 space-y-1">
            {evaluationParentContacts.map((contact, index) => (
              <p key={index} className="break-words text-sm leading-6 text-[var(--text-muted)]">
                {contact.name || 'Parent/Guardian'}{contact.email ? ` | ${contact.email}` : ''}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Summary</p>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">
          {buildEvaluationSummary(evaluation)}
        </p>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Responses</p>
        <div className="mt-3 space-y-2">
          {responseItems.length > 0 ? (
            responseItems.map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{item.label}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">{String(item.value)}</p>
              </div>
            ))
          ) : (
            <p className="text-sm leading-6 text-[var(--text-muted)]">No responses provided.</p>
          )}
        </div>
      </div>
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
      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email recipients</span>
      {contacts.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-3">
          {contacts.map((contact, index) => {
            const selectedIndexes = selectedParentContacts[evaluationId] ?? contacts.map((_, contactIndex) => contactIndex)

            return (
              <label key={`${contact.email || contact.name}-${index}`} className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={selectedIndexes.includes(index)}
                  onChange={() => onToggleEvaluationParentContact(evaluationId, index, contacts)}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{contact.name || 'Parent/Guardian'}</span>
                  <span className="block break-words text-xs text-[var(--text-muted)]">{contact.email || 'No email entered'}</span>
                </span>
              </label>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-muted)]">
          No parent contacts entered.
        </div>
      )}
    </div>
  )
}

function EvaluationExportFields({
  hasSavedExportSelection,
  onClearExportFields,
  onSelectAllExportFields,
  onToggleExportField,
  playerName,
  responseItems,
  selectedExportLabels,
  selectedResponseItems,
}) {
  return (
    <div className="xl:col-span-7">
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Assessment details to include</p>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              Choose what goes into the parent email. This choice is saved in this browser for {playerName}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSelectAllExportFields(responseItems)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={onClearExportFields}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Clear
            </button>
          </div>
        </div>

        {responseItems.length > 0 ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {responseItems.map((item) => {
              const isSelected = hasSavedExportSelection
                ? selectedExportLabels.includes(item.label)
                : true

              return (
                <label
                  key={item.label}
                  className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleExportField(item.label, responseItems)}
                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{item.label}</span>
                    <span className="line-clamp-2 block break-words text-xs leading-5 text-[var(--text-muted)]">
                      {String(item.value ?? '').trim() || 'No data entered'}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-muted)]">
            No assessment responses were entered for this assessment.
          </p>
        )}

        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
          {selectedResponseItems.length} of {responseItems.length} field{responseItems.length === 1 ? '' : 's'} selected.
        </p>
      </div>
    </div>
  )
}
