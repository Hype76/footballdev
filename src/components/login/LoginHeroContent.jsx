export function LoginHeroContent() {
  const setupSteps = [
    ['1', 'Create the club workspace', 'Set the club name, logo, contact details, and the first admin account.'],
    ['2', 'Build the first football group', 'Add one team, the staff who can manage it, and the players who belong there.'],
    ['3', 'Invite parents with control', 'Link parent accounts to players before sending match day, polls, or development updates.'],
  ]

  const weeklyTools = [
    ['Availability', 'Know who can train or play before match day decisions are made.'],
    ['Sessions', 'Record training and match notes against real players and teams.'],
    ['Parent updates', 'Send clear messages without sharing staff logins or loose spreadsheets.'],
  ]

  return (
    <section className="order-2 lg:order-1">
      <div className="max-w-5xl rounded-lg border border-slate-200 bg-white/95 p-5 shadow-sm shadow-slate-200/80 backdrop-blur sm:p-6 lg:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Football club operations</p>
        <h1 className="mt-4 max-w-4xl text-3xl font-black leading-[1.04] tracking-tight text-slate-950 min-[420px]:text-4xl sm:mt-5 sm:text-5xl xl:text-6xl">
          A football-only workspace that starts with the work clubs actually need.
        </h1>
        <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-slate-700 sm:mt-6 sm:text-lg sm:leading-8">
          Set up the club, teams, players, staff access, parent links, availability, sessions, match day, and development records in one practical operating system.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href="/sign-in"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800"
          >
            Open Workspace
          </a>
          <a
            href="/features"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50"
          >
            Explore Features
          </a>
        </div>
      </div>

      <div className="mt-5 grid max-w-5xl gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-lg border border-emerald-200 bg-[#f2fbf6] p-5 shadow-sm shadow-emerald-100/70 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">First run setup</p>
          <div className="mt-5 grid gap-3">
            {setupSteps.map(([number, title, copy]) => (
              <article key={title} className="grid grid-cols-[2.5rem_1fr] gap-3 rounded-lg border border-emerald-200 bg-white p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-700 text-sm font-black text-white">{number}</span>
                <span>
                  <span className="block text-sm font-black text-slate-950">{title}</span>
                  <span className="mt-1 block text-sm font-semibold leading-6 text-slate-600">{copy}</span>
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Run the week</p>
          <div className="mt-5 grid gap-3">
            {weeklyTools.map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-slate-200 bg-[#f8fafc] p-4">
                <p className="text-sm font-black text-slate-950">{title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
