const featureCards = [
  ['Trials', 'Build trial lists, record coach ratings, and keep decisions in one place.'],
  ['Players', 'Store player history, parent contacts, positions, and squad status clearly.'],
  ['Parents', 'Create clean reports and email templates without rewriting notes every time.'],
]

export function LoginHeroContent() {
  return (
    <section className="order-2 lg:order-1">
      <div className="inline-flex rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">
        Football club operations
      </div>

      <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.04] tracking-tight sm:text-5xl xl:text-6xl">
        Player feedback and club management software for grassroots football.
      </h1>

      <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
        Assess players, manage trials, organise sessions, and send professional feedback to parents from one simple club workspace.
      </p>

      <div className="mt-7 max-w-2xl space-y-4 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
        <span className="flex items-start gap-4">
          <span className="shrink-0 text-[#d8ff2f]">{"\u2713"}</span>
          <span>Run trials with clear notes and decisions.</span>
        </span>
        <span className="flex items-start gap-4">
          <span className="shrink-0 text-[#d8ff2f]">{"\u2713"}</span>
          <span>Keep trial and squad records organised.</span>
        </span>
        <span className="flex items-start gap-4">
          <span className="shrink-0 text-[#d8ff2f]">{"\u2713"}</span>
          <span>Give parents feedback they can understand.</span>
        </span>
      </div>

      <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        {featureCards.map(([title, copy]) => (
          <div key={title} className="rounded-lg border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
            <p className="text-sm font-bold text-white">{title}</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.05] p-5">
          <p className="text-3xl font-black">Role based</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Coaches, managers, and club admins only see the teams and tools they need.
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.05] p-5">
          <p className="text-3xl font-black">Club branded</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Use your club logo inside the app and on parent-facing feedback.
          </p>
        </div>
      </div>
    </section>
  )
}
