import { SectionCard } from '../ui/SectionCard.jsx'

export function CreatePlatformFeedbackSection({
  isSaving,
  message,
  onMessageChange,
  onSubmit,
}) {
  return (
    <SectionCard title="Create feedback" description="Keep it short and practical. One idea per feedback item works best.">
      <form className="space-y-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-5 shadow-sm shadow-[#047857]/10" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#101828]">Feedback</span>
          <textarea
            required
            rows="5"
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            className="min-h-36 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while your feedback is being submitted.' : undefined}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSaving ? 'Submitting...' : 'Submit feedback'}
        </button>
      </form>
    </SectionCard>
  )
}
