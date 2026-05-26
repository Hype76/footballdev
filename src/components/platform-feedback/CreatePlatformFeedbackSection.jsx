import { SectionCard } from '../ui/SectionCard.jsx'

export function CreatePlatformFeedbackSection({
  isSaving,
  message,
  onMessageChange,
  onSubmit,
}) {
  return (
    <SectionCard title="Create feedback" description="Keep it short and practical. One idea per feedback item works best.">
      <form className="space-y-4 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-5 shadow-sm shadow-[#067a46]/10" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#10231a]">Feedback</span>
          <textarea
            required
            rows="5"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            className="min-h-36 w-full rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-bold text-[#10231a] outline-none transition placeholder:text-[#8da59a] focus:border-[#067a46] focus:ring-2 focus:ring-[#d7f8e5]"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while your feedback is being submitted.' : undefined}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSaving ? 'Submitting...' : 'Submit feedback'}
        </button>
      </form>
    </SectionCard>
  )
}
