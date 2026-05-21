export function LoginHeroContent() {
  return (
    <section className="order-2 lg:order-1">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ff2f]">Football club operations</p>
      <h1 className="mt-4 max-w-3xl text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-5xl xl:text-6xl">
        The football admin platform built around player development.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-slate-200 sm:mt-6 sm:text-lg sm:leading-8">
        Run trials, organise teams, assess players, share feedback with parents, and keep coaches working from one clean club workspace.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href="/features"
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90"
        >
          Explore Features
        </a>
        <a
          href="/sign-in"
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-black text-white transition hover:bg-white/[0.1]"
        >
          Login
        </a>
      </div>
      <div className="mt-8 grid max-w-2xl gap-3 min-[520px]:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-black/25 p-4 backdrop-blur">
          <p className="text-xl font-black sm:text-2xl">Trials</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Keep trial notes, decisions, and outcomes in one place.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-4 backdrop-blur">
          <p className="text-xl font-black sm:text-2xl">Teams</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Give staff the right access and keep every team on brand.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-4 backdrop-blur">
          <p className="text-xl font-black sm:text-2xl">Parents</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Keep parents updated without adding more work for coaches.</p>
        </div>
      </div>
    </section>
  )
}
