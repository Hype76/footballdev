export function DemoRequestModal({
  demoFormData,
  demoPlan,
  isSubmitting,
  onCancel,
  onChange,
  onSubmit,
}) {
  if (!demoPlan) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#10231a]/45 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl overflow-hidden rounded-lg border border-[#bddcca] bg-white text-[#10231a] shadow-xl shadow-[#10231a]/15"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          title={isSubmitting ? 'Please wait while your demo request is sent.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#bddcca] bg-white text-sm font-black text-[#456653] shadow-sm transition hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <div className="border-b border-[#d7eadf] bg-[#f6fbf8] px-5 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Request demo</p>
          <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#10231a]">{demoPlan.name}</h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#456653]">
            Tell us how your football club works now. We will show the setup flow, roles, parent access, and match week tools against that real context.
          </p>
        </div>

        <form className="grid gap-4 px-5 py-5 sm:px-6" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#10231a]">Name *</span>
            <input
              type="text"
              name="name"
              value={demoFormData.name}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#10231a]">Email *</span>
            <input
              type="email"
              name="email"
              value={demoFormData.email}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#10231a]">Phone number</span>
            <input
              type="tel"
              name="phone"
              value={demoFormData.phone}
              onChange={onChange}
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#10231a]">Club or team name *</span>
            <input
              type="text"
              name="clubTeamName"
              value={demoFormData.clubTeamName}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
            />
          </label>

          <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-3">
            <p className="text-sm font-black text-[#065f3b]">Demo focus</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#456653]">
              We will cover first-run setup, staff roles, player records, parent links, availability, and match day.
            </p>
          </div>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your demo request is sent.' : undefined}
              onClick={onCancel}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-5 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your demo request is sent.' : undefined}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Sending...' : 'Request demo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
