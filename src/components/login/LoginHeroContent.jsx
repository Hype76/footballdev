export function LoginHeroContent() {
  return (
    <section className="order-2 lg:order-1">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Football club operations</p>
      <h1 className="mt-4 max-w-3xl text-3xl font-black leading-[1.04] tracking-tight text-slate-950 min-[420px]:text-4xl sm:mt-5 sm:text-5xl xl:text-6xl">
        The football admin platform built around player development.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 sm:mt-6 sm:text-lg sm:leading-8">
        Run trials, organise teams, assess players, share feedback with parents, and keep coaches working from one clean club workspace.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href="/features"
          className="inline-flex min-h-12 items-center justify-center bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800"
        >
          Explore Features
        </a>
        <a
          href="/sign-in"
          className="inline-flex min-h-12 items-center justify-center border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50"
        >
          Login
        </a>
      </div>
      <div className="mt-8 grid max-w-2xl gap-3 min-[520px]:grid-cols-3">
        <div className="border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xl font-black text-slate-950 sm:text-2xl">Trials</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">Keep trial notes, decisions, and outcomes in one place.</p>
        </div>
        <div className="border border-sky-200 bg-sky-50 p-4">
          <p className="text-xl font-black text-slate-950 sm:text-2xl">Teams</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">Give staff the right access and keep every team on brand.</p>
        </div>
        <div className="border border-amber-200 bg-amber-50 p-4">
          <p className="text-xl font-black text-slate-950 sm:text-2xl">Parents</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">Keep parents updated without adding more work for coaches.</p>
        </div>
      </div>
    </section>
  )
}
