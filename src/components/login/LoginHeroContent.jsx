import coachHomeImage from '../../assets/marketing/coach-home.png'
import playerProgressionImage from '../../assets/marketing/player-progression.png'

const weeklyActions = [
  ['Plan the week', 'Sessions, fixtures, and parent response cut offs stay visible.'],
  ['Run training', 'Attach players and save notes while the session is fresh.'],
  ['Track progress', 'Development records stay with each player over time.'],
]

const proofStats = [
  ['2 teams', 'Demo club workspace'],
  ['4 players', 'Real records and notes'],
  ['3.8 average', 'Progression view'],
]

export function LoginHeroContent() {
  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
      <div className="max-w-3xl">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#c6ff1a]">Football club workspace</p>
        <h1 className="mt-5 text-4xl font-black leading-[1.02] tracking-tight text-white min-[420px]:text-5xl sm:text-6xl">
          Run training, match day, parents, and player development in one club workspace.
        </h1>
        <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/86 sm:text-lg sm:leading-8">
          Football Player helps grassroots clubs manage sessions, fixtures, availability, parent updates, and player records from one simple workspace.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href="/sign-in"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#c6ff1a] px-5 py-3 text-sm font-black text-[#06110a] shadow-sm shadow-[#c6ff1a]/20 transition hover:bg-[#dbff66]"
          >
            Start free
          </a>
          <a
            href="/features"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/24 bg-white/10 px-5 py-3 text-sm font-black text-white shadow-sm shadow-black/10 backdrop-blur transition hover:bg-white/18"
          >
            See features
          </a>
          <button
            type="button"
            onClick={openContactModal}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/24 bg-white/10 px-5 py-3 text-sm font-black text-white shadow-sm shadow-black/10 backdrop-blur transition hover:bg-white/18"
          >
            Contact us
          </button>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {proofStats.map(([value, label]) => (
            <div key={value} className="rounded-lg border border-white/18 bg-black/28 p-4 backdrop-blur">
              <p className="text-2xl font-black text-white">{value}</p>
              <p className="mt-1 text-sm font-bold text-white/72">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="relative min-h-[360px] lg:min-h-[560px]">
        <div className="overflow-hidden rounded-lg border border-white/18 bg-white shadow-2xl shadow-black/35">
          <img src={coachHomeImage} alt="Football Player club home showing training queue and player actions" className="w-full" />
        </div>
        <div className="mt-4 grid gap-3 rounded-lg border border-white/18 bg-black/34 p-4 backdrop-blur md:absolute md:-bottom-4 md:left-6 md:right-6 md:mt-0 md:grid-cols-3">
          {weeklyActions.map(([title, copy]) => (
            <article key={title}>
              <h2 className="text-sm font-black text-white">{title}</h2>
              <p className="mt-1 text-xs font-semibold leading-5 text-white/72">{copy}</p>
            </article>
          ))}
        </div>
        <div className="hidden overflow-hidden rounded-lg border border-white/18 bg-white shadow-2xl shadow-black/25 lg:absolute lg:-bottom-12 lg:-left-16 lg:block lg:w-[42%]">
          <img src={playerProgressionImage} alt="Player progression chart and development records" className="w-full" />
        </div>
      </div>
    </section>
  )
}
