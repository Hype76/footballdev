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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 shadow-2xl shadow-slate-950/20 sm:p-6"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          title={isSubmitting ? 'Please wait while your demo request is sent.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Request Demo</p>
        <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-slate-950">{demoPlan.name}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Send your details and we will contact you to arrange the demo.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Name *</span>
            <input
              type="text"
              name="name"
              value={demoFormData.name}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Email *</span>
            <input
              type="email"
              name="email"
              value={demoFormData.email}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Phone Number</span>
            <input
              type="tel"
              name="phone"
              value={demoFormData.phone}
              onChange={onChange}
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Club/Team Name *</span>
            <input
              type="text"
              name="clubTeamName"
              value={demoFormData.clubTeamName}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
            />
          </label>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your demo request is sent.' : undefined}
              onClick={onCancel}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              title={isSubmitting ? 'Please wait while your demo request is sent.' : undefined}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Sending...' : 'Request Demo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
