export function PlatformFeedbackHero({ isLoading }) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
        <div className="px-5 py-6 sm:px-6 sm:py-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Product feedback</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            Share ideas, vote on priorities, and read platform admin responses.
          </h2>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-slate-600 sm:text-base">
            Feedback stays visible so clubs can see what has been requested, planned, and completed.
          </p>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-6 sm:px-6 xl:border-l xl:border-t-0">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-sm bg-emerald-600" />
            <p className="text-sm font-black text-slate-950">
              {isLoading ? 'Refreshing feedback' : 'Feedback board loaded'}
            </p>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            One practical idea per item keeps voting clean and useful.
          </p>
        </div>
      </div>
    </section>
  )
}
