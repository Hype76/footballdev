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
          <span className="mb-2 block text-sm font-black text-slate-900">Feedback</span>
          <textarea
            required
            rows="5"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            className="min-h-36 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while your feedback is being submitted.' : undefined}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSaving ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>
    </SectionCard>
  )
}
