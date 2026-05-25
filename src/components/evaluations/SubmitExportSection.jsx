import { normalizeSessionValue } from '../../hooks/evaluations/evaluationFormUtils.js'
import { EvaluationExportFieldsSelector } from './EvaluationExportFieldsSelector.jsx'
import { NoticeBanner } from '../ui/NoticeBanner.jsx'
import { ScheduleDateTimePicker } from '../ui/ScheduleDateTimePicker.jsx'
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
  onEmailSendModeChange,
  onGoToPlayer,
  onInviteDateChange,
  onPdfAttachmentApprovedChange,
  onScheduledEmailDateTimeChange,
  onEmailAfterSaveChange,
  onPrintBlankForm,
  onReorderExportField,
  onSelectAllExportFields,
  onToggleExportField,
  previewMode,
  responseItems,
  selectedEmailTemplateKey,
  emailSendMode,
  scheduledEmailDateTime,
  selectedExportLabels,
  selectedResponseItems,
  shouldShowInviteDate,
}) {
  const isEmailEnabled = previewMode === 'email'
  const submitDisabledReason = isSubmitting
    ? 'Please wait while this development record is being saved.'
    : !canSubmitEvaluation
      ? 'Complete the required player details before saving.'
      : undefined

  return (
    <SectionCard
      storageKey="development-record-submit-v2"
      title="Submit and export"
      description="Save the record first. Parent email and PDF output are optional and should only include useful football detail."
    >
      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-900">
        Overall Score: {averageScore !== null ? averageScore.toFixed(1) : '-'}
      </div>

      {!isDemoAccount ? (
        <label className="mb-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <input
            type="checkbox"
            checked={isEmailEnabled}
            onChange={(event) => onEmailAfterSaveChange(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 accent-emerald-700"
          />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-950">Email parents after saving</span>
            <span className="mt-1 block text-sm font-semibold leading-6 text-slate-600">
              Leave this off to save the coach record only.
            </span>
          </span>
        </label>
      ) : null}

      {isEmailEnabled ? (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          {availableEmailTemplates.length > 0 ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">Email template</span>
              <select
                value={selectedEmailTemplateKey}
                onChange={(event) => onEmailTemplateChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
              <span className="mb-2 block text-sm font-bold text-slate-950">
                Invite date
              </span>
              <input
                type="date"
                value={inviteDate}
                onChange={(event) => onInviteDateChange(normalizeSessionValue(event.target.value))}
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                This is only used in invite email templates. The Session field above remains the saved current session date.
              </p>
            </label>
          ) : null}

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <input
              type="checkbox"
              checked={Boolean(isPdfAttachmentApproved)}
              onChange={(event) => onPdfAttachmentApprovedChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 accent-emerald-700"
            />
            <span>
              <span className="block text-sm font-bold text-slate-950">Attach development PDF</span>
              <span className="mt-1 block text-sm font-semibold leading-6 text-slate-600">
                Include the selected football details as a PDF attachment.
              </span>
            </span>
          </label>
          <div className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
            <span className="block text-sm font-bold text-slate-950">Send timing</span>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950">
                <input
                  type="radio"
                  name="assessment-email-send-mode"
                  checked={emailSendMode !== 'scheduled'}
                  onChange={() => onEmailSendModeChange('now')}
                  className="h-4 w-4 accent-emerald-700"
                />
                Send now
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950">
                <input
                  type="radio"
                  name="assessment-email-send-mode"
                  checked={emailSendMode === 'scheduled'}
                  onChange={() => onEmailSendModeChange('scheduled')}
                  className="h-4 w-4 accent-emerald-700"
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
        </div>
      ) : null}

      {isEmailEnabled || isPdfAttachmentApproved ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold text-slate-950">Football details to include</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                Choose what goes into the {contactNoun} email and PDF. This choice is saved in this browser for this player.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSelectAllExportFields}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-slate-50"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={onClearExportFields}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>

          {responseItems.length > 0 ? (
            <EvaluationExportFieldsSelector
              hasSavedExportSelection={hasSavedExportSelection}
              onReorderExportField={onReorderExportField}
              onToggleExportField={onToggleExportField}
              responseItems={responseItems}
              selectedExportLabels={selectedExportLabels}
            />
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
              No scored development responses have been entered yet.
            </p>
          )}

          <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">
            {selectedResponseItems.length} of {responseItems.length} field{responseItems.length === 1 ? '' : 's'} selected.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="submit"
          disabled={isSubmitting || !canSubmitEvaluation}
          title={submitDisabledReason}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-800 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting ? (isSendingParentEmail ? 'Saving and emailing...' : 'Saving...') : 'Save Development Record'}
        </button>
        <button
          type="button"
          onClick={onPrintBlankForm}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 sm:w-auto"
        >
          Print Blank Form
        </button>
        {isSaved && lastSavedPlayerName ? (
          <button
            type="button"
            onClick={onGoToPlayer}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 sm:w-auto"
          >
            Open Player Profile
          </button>
        ) : null}
      </div>
    </SectionCard>
  )
}
