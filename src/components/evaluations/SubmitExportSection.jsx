import { normalizeSessionValue } from '../../hooks/evaluations/evaluationFormUtils.js'
import { EvaluationExportFieldsSelector } from './EvaluationExportFieldsSelector.jsx'
import { NoticeBanner } from '../ui/NoticeBanner.jsx'
import { ScheduleDateTimePicker } from '../ui/ScheduleDateTimePicker.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'
const choiceCardClass = 'flex items-start gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10'
const optionCardClass = 'flex min-h-11 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10'
const secondaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] sm:w-auto'

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
      <div className="mb-4 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857] shadow-sm shadow-[#047857]/10">
        Overall Score: {averageScore !== null ? averageScore.toFixed(1) : '-'}
      </div>

      {!isDemoAccount ? (
        <label className={`mb-4 ${choiceCardClass}`}>
          <input
            type="checkbox"
            checked={isEmailEnabled}
            onChange={(event) => onEmailAfterSaveChange(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-[#d7e5dc] accent-[#047857]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-black text-[#101828]">Email parents after saving</span>
            <span className="mt-1 block text-sm font-semibold leading-6 text-[#4b5f55]">
              Leave this off to save the coach record only.
            </span>
          </span>
        </label>
      ) : null}

      {isEmailEnabled ? (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          {availableEmailTemplates.length > 0 ? (
            <label className="block">
              <span className={labelClass}>Email template</span>
              <select
                value={selectedEmailTemplateKey}
                onChange={(event) => onEmailTemplateChange(event.target.value)}
                className={inputClass}
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
              <span className={labelClass}>
                Invite date
              </span>
              <input
                type="date"
                value={inviteDate}
                onChange={(event) => onInviteDateChange(normalizeSessionValue(event.target.value))}
                className={inputClass}
              />
              <p className="mt-2 text-xs font-semibold leading-5 text-[#4b5f55]">
                This is only used in invite email templates. The Session field above remains the saved current session date.
              </p>
            </label>
          ) : null}

          <label className={choiceCardClass}>
            <input
              type="checkbox"
              checked={Boolean(isPdfAttachmentApproved)}
              onChange={(event) => onPdfAttachmentApprovedChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[#d7e5dc] accent-[#047857]"
            />
            <span>
              <span className="block text-sm font-black text-[#101828]">Attach development PDF</span>
              <span className="mt-1 block text-sm font-semibold leading-6 text-[#4b5f55]">
                Include the selected football details as a PDF attachment.
              </span>
            </span>
          </label>
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10 md:col-span-2">
            <span className="block text-sm font-black text-[#101828]">Send timing</span>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className={optionCardClass}>
                <input
                  type="radio"
                  name="assessment-email-send-mode"
                  checked={emailSendMode !== 'scheduled'}
                  onChange={() => onEmailSendModeChange('now')}
                  className="h-4 w-4 accent-[#047857]"
                />
                Send now
              </label>
              <label className={optionCardClass}>
                <input
                  type="radio"
                  name="assessment-email-send-mode"
                  checked={emailSendMode === 'scheduled'}
                  onChange={() => onEmailSendModeChange('scheduled')}
                  className="h-4 w-4 accent-[#047857]"
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
        <div className="mb-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-black text-[#101828]">Football details to include</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
                Choose what goes into the {contactNoun} email and PDF. This choice is saved in this browser for this player.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSelectAllExportFields}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onClearExportFields}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
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
            <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-semibold text-[#4b5f55]">
              No scored development responses have been entered yet.
            </p>
          )}

          <p className="mt-3 text-xs font-semibold leading-5 text-[#4b5f55]">
            {selectedResponseItems.length} of {responseItems.length} field{responseItems.length === 1 ? '' : 's'} selected.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="submit"
          disabled={isSubmitting || !canSubmitEvaluation}
          title={submitDisabledReason}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting ? (isSendingParentEmail ? 'Saving and emailing...' : 'Saving...') : 'Save development record'}
        </button>
        <button
          type="button"
          onClick={onPrintBlankForm}
          className={secondaryButtonClass}
        >
          Print blank form
        </button>
        {isSaved && lastSavedPlayerName ? (
          <button
            type="button"
            onClick={onGoToPlayer}
          className={secondaryButtonClass}
          >
            Open player profile
          </button>
        ) : null}
      </div>
    </SectionCard>
  )
}
