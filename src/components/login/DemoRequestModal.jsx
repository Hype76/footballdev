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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0f172a]/45 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl overflow-hidden rounded-lg border border-[#cbd5e1] bg-white text-[#0f172a] shadow-xl shadow-[#0f172a]/15"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          title={isSubmitting ? 'Please wait while your demo request is sent.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#cbd5e1] bg-white text-sm font-black text-[#475569] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <div className="border-b border-[#bfdbfe] bg-[#eff6ff] px-5 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Request demo</p>
          <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#0f172a]">{demoPlan.name}</h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#475569]">
            Tell us how your football club works now. We will show the setup flow, roles, parent access, and match week tools against that real context.
          </p>
        </div>

        <form className="grid gap-4 px-5 py-5 sm:px-6" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#0f172a]">Name *</span>
            <input
              type="text"
              name="name"
              value={demoFormData.name}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#bfdbfe]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#0f172a]">Email *</span>
            <input
              type="email"
              name="email"
              value={demoFormData.email}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#bfdbfe]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#0f172a]">Phone number</span>
            <input
              type="tel"
              name="phone"
              value={demoFormData.phone}
              onChange={onChange}
              className="min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#bfdbfe]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#0f172a]">Club or team name *</span>
            <input
              type="text"
              name="clubTeamName"
              value={demoFormData.clubTeamName}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#bfdbfe]"
            />
          </label>

          <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3">
            <p className="text-sm font-black text-[#1d4ed8]">Demo focus</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#475569]">
              We will cover first-run setup, staff roles, player records, parent links, availability, and match day.
            </p>
          </div>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your demo request is sent.' : undefined}
              onClick={onCancel}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-5 py-3 text-sm font-black text-[#0f172a] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your demo request is sent.' : undefined}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Sending...' : 'Request demo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
