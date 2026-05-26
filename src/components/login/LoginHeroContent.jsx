export function LoginHeroContent() {
  const setupSteps = [
    ['1', 'Club workspace', 'Set the club name, logo, contact details, and the first admin account.'],
    ['2', 'First football group', 'Add one team, the staff who can manage it, and the players who belong there.'],
    ['3', 'Parent access', 'Link parent accounts to players before sending match day, polls, or development updates.'],
  ]

  const weeklyTools = [
    ['Availability', 'Know who can train or play before team choices are made.'],
    ['Match day', 'Keep squads, scorers, minutes, and parent updates attached to the fixture.'],
    ['Development', 'Record coach notes against real players, teams, and sessions.'],
  ]

  return (
    <section className="order-2 lg:order-1">
      <div className="grid max-w-6xl gap-6 lg:grid-cols-[1fr_23rem] lg:items-end">
        <div>
          <div className="inline-flex rounded-full border border-[#b7efce] bg-white/90 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-[#067a46] shadow-sm shadow-[#d7eadf]/70 backdrop-blur">
            Football club operations
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight text-[#101828] min-[420px]:text-5xl sm:text-6xl xl:text-7xl">
            The football week, rebuilt around real club work.
          </h1>
          <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-[#344054] sm:text-lg sm:leading-8">
            Set up the club, teams, players, staff access, parent links, availability, sessions, match day, and development records in one practical operating system.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="/sign-in"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#8be4ae]/70 transition hover:bg-[#05603a]"
            >
              Open workspace
            </a>
            <a
              href="/features"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white/95 px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#d7eadf]/70 transition hover:bg-[#f0fdf6]"
            >
              Explore features
            </a>
          </div>
        </div>

        <aside className="rounded-lg border border-[#b7efce] bg-white/94 p-4 shadow-lg shadow-[#cfeedd]/80 backdrop-blur sm:p-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Today board</p>
          <div className="mt-4 grid gap-3">
            {[
              ['Availability', '18 replies needed'],
              ['Match day', '2 squads to confirm'],
              ['Parents', '6 invites ready'],
              ['Players', '4 records due'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-[#cfeedd] bg-[#f8fdf9] px-3 py-3">
                <span className="text-sm font-black text-[#101828]">{label}</span>
                <span className="text-xs font-black text-[#067a46]">{value}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="mt-7 grid max-w-6xl gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-lg border border-[#b7efce] bg-[#f0fdf6]/95 p-5 shadow-sm shadow-[#d7eadf]/70 backdrop-blur sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">First run setup</p>
          <div className="mt-5 grid gap-3">
            {setupSteps.map(([number, title, copy]) => (
              <article key={title} className="grid grid-cols-[2.5rem_1fr] gap-3 rounded-lg border border-[#b7efce] bg-white p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#067a46] text-sm font-black text-white">{number}</span>
                <span>
                  <span className="block text-sm font-black text-[#101828]">{title}</span>
                  <span className="mt-1 block text-sm font-semibold leading-6 text-[#5f7468]">{copy}</span>
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-[#b7efce] bg-white/95 p-5 shadow-sm shadow-[#d7eadf]/70 backdrop-blur sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Run the week</p>
          <div className="mt-5 grid gap-3">
            {weeklyTools.map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] p-4">
                <p className="text-sm font-black text-[#101828]">{title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
