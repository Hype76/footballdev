import { SectionCard } from '../ui/SectionCard.jsx'

export function CreatePlatformFeedbackSection({
  isSaving,
  message,
  onMessageChange,
  onSubmit,
}) {
  return (
    <SectionCard title="Create feedback" description="Keep it short and practical. One idea per feedback item works best.">
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Feedback</span>
          <textarea
            required
            rows="5"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            className="min-h-36 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSaving ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>
    </SectionCard>
  )
}
