export function PlatformFeedbackHero({ isLoading }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#d7eadf] bg-white shadow-sm shadow-[#d7eadf]/70">
      <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-stretch">
        <div className="px-5 py-6 sm:px-6 sm:py-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Platform feedback</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black leading-[1.04] tracking-tight text-[#10231a] sm:text-5xl">
            Turn tester feedback into a clear product queue.
          </h1>
          <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4d6458]">
            Share one practical football platform improvement, vote on the ideas other clubs need, and use admin responses to see what is planned or complete.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {['One idea per item', 'Votes show demand', 'Admin replies stay visible'].map((rule) => (
              <div key={rule} className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
                <p className="text-sm font-black text-[#10231a]">{rule}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid content-between border-t border-[#d7eadf] bg-[#effbf3] px-5 py-6 sm:px-6 xl:border-l xl:border-t-0">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Board state</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-[#10231a]">
              {isLoading ? 'Refreshing feedback' : 'Feedback board loaded'}
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#4d6458]">
              Keep requests specific enough that clubs can vote for the same need without splitting demand.
            </p>
          </div>
          <div className="mt-5 rounded-lg border border-[#bfe8cd] bg-white px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
            <p className="text-sm font-black text-[#10231a]">Best feedback format</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">
              Describe the football job, the current friction, and the outcome the club needs.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
