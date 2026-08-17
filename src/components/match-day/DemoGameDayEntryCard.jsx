const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#047857] focus-visible:ring-offset-2'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#047857] focus-visible:ring-offset-2'

export function DemoGameDayEntryCard({ hasTodayMatch = false, onOpen }) {
  return (
    <section
      aria-labelledby="demo-game-day-entry-title"
      className={`${hasTodayMatch ? 'border-[#d7e5dc] bg-[#f7faf8]' : 'border-[#86efac] bg-[#ecfdf5]'} rounded-lg border p-4 shadow-sm shadow-[#047857]/10 sm:p-5`}
      data-testid="demo-game-day-entry"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Private Demo</p>
          <h2 id="demo-game-day-entry-title" className="mt-1 text-xl font-black tracking-tight text-[#101828]">
            Demo Game Day
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
            Practise the same Game Day experience Coaches use for fixtures, Match states, goals, cards, substitutions, and timeline corrections. Synthetic session data is isolated and communication is blocked.
          </p>
          {hasTodayMatch ? (
            <p className="mt-2 text-xs font-bold text-[#4b5f55]">Today&apos;s real fixture remains the priority above.</p>
          ) : null}
        </div>
        <button type="button" onClick={onOpen} className={hasTodayMatch ? secondaryButtonClass : primaryButtonClass}>
          Open Demo Game Day
        </button>
      </div>
    </section>
  )
}
