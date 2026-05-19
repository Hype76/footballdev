export function LoginHeroContent() {
  return (
    <section className="order-2 lg:order-1">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ff2f]">Football club operations</p>
      <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl xl:text-6xl">
        The football admin platform built around player development.
      </h1>
      <p className="mt-6 max-w-2xl text-base leading-8 text-slate-200 sm:text-lg">
        Run trials, organise teams, assess players, share parent feedback, and keep coaches working from one clean club workspace.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href="/features"
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90"
        >
          Explore Features
        </a>
        <a
          href="/pricing"
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-black text-white transition hover:bg-white/[0.1]"
        >
          See Plans
        </a>
      </div>
      <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-black/25 p-4 backdrop-blur">
          <p className="text-2xl font-black">Trials</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Decisions, notes, and invite outcomes stay organised.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-4 backdrop-blur">
          <p className="text-2xl font-black">Teams</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Staff access and team branding stay controlled.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-4 backdrop-blur">
          <p className="text-2xl font-black">Parents</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Parents get clear updates without coach admin overload.</p>
        </div>
      </div>
    </section>
  )
}
