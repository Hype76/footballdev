import { SectionCard } from '../ui/SectionCard.jsx'

export function CreatePlatformFeedbackSection({
  isSaving,
  message,
  onMessageChange,
  onSubmit,
}) {
  return (
    <SectionCard title="Create feedback" description="Keep it short and practical. One idea per feedback item works best.">
      <form className="space-y-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-5 shadow-sm shadow-[#2563eb]/10" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#0f172a]">Feedback</span>
          <textarea
            required
            rows="5"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            className="min-h-36 w-full rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 text-sm font-bold text-[#0f172a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while your feedback is being submitted.' : undefined}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSaving ? 'Submitting...' : 'Submit feedback'}
        </button>
      </form>
    </SectionCard>
  )
}
