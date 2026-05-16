import { normalizeSessionValue } from '../../hooks/evaluations/evaluationFormUtils.js'
import { NoticeBanner } from '../ui/NoticeBanner.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function SubmitExportSection({
  availableEmailTemplates,
  averageScore,
  canSubmitEvaluation,
  contactNoun,
  hasSavedExportSelection,
  inviteDate,
  isDemoAccount,
  isLoadingEmailTemplates,
  isPdfAttachmentApproved,
  isSaved,
  isSendingParentEmail,
  isSubmitting,
  lastSavedPlayerName,
  onClearExportFields,
  onEmailTemplateChange,
  onGoToPlayer,
  onInviteDateChange,
  onPdfAttachmentApprovedChange,
  onPreviewModeChange,
  onPrintBlankForm,
  onSelectAllExportFields,
  onSubmitClick,
  onToggleExportField,
  previewMode,
  responseItems,
  selectedEmailTemplateKey,
  selectedExportLabels,
  selectedResponseItems,
  shouldShowInviteDate,
}) {
  return (
    <SectionCard
      title="Submit and export"
      description="Choose whether to save only or send the assessment email after saving."
    >
      <div className="mb-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
        Overall Score: {averageScore !== null ? averageScore.toFixed(1) : '-'}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        {[
          { key: 'scored', label: 'Save Only' },
          ...(isDemoAccount ? [] : [{ key: 'email', label: 'Save and Email' }]),
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onPreviewModeChange(option.key)}
            className={[
              'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition',
              previewMode === option.key
                ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>

      {previewMode === 'email' ? (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          {availableEmailTemplates.length > 0 ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email template</span>
              <select
                value={selectedEmailTemplateKey}
                onChange={(event) => onEmailTemplateChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {availableEmailTemplates.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <NoticeBanner
              title="Create an email template first"
              message={
                isLoadingEmailTemplates
                  ? `Loading ${contactNoun} email templates...`
                  : `Ask a manager to save a club ${contactNoun} email template before sending emails.`
              }
              tone="info"
            />
          )}

          {shouldShowInviteDate ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
                Invite date
              </span>
              <input
                type="date"
                value={inviteDate}
                onChange={(event) => onInviteDateChange(normalizeSessionValue(event.target.value))}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                This is only used in invite email templates. The Session field above remains the saved current session date.
              </p>
            </label>
          ) : null}

          <label className="flex items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
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
        </div>
      ) : null}

      <div className="mb-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Assessment details to include</p>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              Choose what goes into the {contactNoun} email. This choice is saved in this browser for this player.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSelectAllExportFields}
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
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {responseItems.map((item) => {
              const isSelected = hasSavedExportSelection ? selectedExportLabels.includes(item.label) : true

              return (
                <label
                  key={item.label}
                  className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleExportField(item.label)}
                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{item.label}</span>
                    <span className="block break-words text-xs leading-5 text-[var(--text-muted)]">
                      {String(item.value ?? '').trim() || 'No data entered'}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-muted)]">
            No assessment responses have been entered yet.
          </p>
        )}

        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
          {selectedResponseItems.length} of {responseItems.length} field{responseItems.length === 1 ? '' : 's'} selected.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={onSubmitClick}
          disabled={isSubmitting || !canSubmitEvaluation}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting
            ? (isSendingParentEmail ? 'Emailing Parents...' : 'Saving...')
            : previewMode === 'email'
              ? 'Save & Email Parents'
              : 'Submit Assessment'}
        </button>
        <button
          type="button"
          onClick={onPrintBlankForm}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
        >
          Print Blank Form
        </button>
        {isSaved && lastSavedPlayerName ? (
          <button
            type="button"
            onClick={onGoToPlayer}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
          >
            Save & Go to Player
          </button>
        ) : null}
      </div>
    </SectionCard>
  )
}
