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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 py-6">
      <div className="w-full max-w-xl rounded-lg border border-white/10 bg-[#0b130d] p-5 shadow-2xl shadow-black/50 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">Request Demo</p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-white">{demoPlan.name}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Send your details and we will contact you to arrange the demo.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Name *</span>
            <input
              type="text"
              name="name"
              value={demoFormData.name}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#d8ff2f]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Email *</span>
            <input
              type="email"
              name="email"
              value={demoFormData.email}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#d8ff2f]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Phone Number</span>
            <input
              type="tel"
              name="phone"
              value={demoFormData.phone}
              onChange={onChange}
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#d8ff2f]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Club/Team Name *</span>
            <input
              type="text"
              name="clubTeamName"
              value={demoFormData.clubTeamName}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition focus:border-[#d8ff2f]"
            />
          </label>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancel}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Sending...' : 'Request Demo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
