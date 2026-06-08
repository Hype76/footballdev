import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import coachHomeImage from '../assets/marketing/coach-home.png'
import playerProgressionImage from '../assets/marketing/player-progression.png'
import playersListImage from '../assets/marketing/players-list.png'
import sessionsCalendarImage from '../assets/marketing/sessions-calendar.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import {
  PublicScreenshot,
  publicEyebrowClass,
  publicHeadingClass,
  publicPageClass,
  publicPrimaryButtonClass,
  publicSecondaryButtonClass,
  publicSectionClass,
  publicSubheadingClass,
} from '../components/login/PublicSiteComponents.jsx'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'

const benefits = [
  ['Less chasing', 'Sessions, players, parents, and match day actions stay connected to the same team record.'],
  ['Clearer match days', 'Availability, fixtures, squads, and follow-up work are easier to see.'],
  ['Better player history', 'Development notes and progress stay with the player, not inside chat history.'],
]

const productSections = [
  {
    title: 'Plan the week',
    label: 'Calendar',
    copy: 'Keep training sessions, fixtures, parent response cut-offs, and club events visible before the week starts.',
    image: sessionsCalendarImage,
    alt: 'Football Player calendar showing training and fixture activity',
  },
  {
    title: 'Run training',
    label: 'Sessions',
    copy: 'Create sessions, add players, and save coach notes while the football is still fresh.',
    image: coachHomeImage,
    alt: 'Football Player coach home showing session actions',
  },
  {
    title: 'Keep parents updated',
    label: 'Parent updates',
    copy: 'Send clear updates from saved club records without giving parents access to staff tools.',
    image: playersListImage,
    alt: 'Football Player player register used for parent updates',
  },
  {
    title: 'Track player progression',
    label: 'Development',
    copy: 'Build development history from saved records so coaches can see how each player is changing over time.',
    image: playerProgressionImage,
    alt: 'Football Player player progression view',
  },
]

export function PublicLandingPage() {
  usePublicThemeScope()

  return (
    <main className={publicPageClass}>
      <section className="relative min-h-dvh overflow-hidden">
        <div className="absolute inset-0">
          <img src={landingHeroImage} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#06110a]/72" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#06110a]" />
        </div>

        <div className="relative flex min-h-dvh flex-col">
          <LoginHeader logo={fallbackLogo} />
          <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-4 py-10 pb-[max(5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12 lg:grid-cols-[1.03fr_0.97fr] lg:gap-12 lg:px-8">
            <div className="max-w-4xl">
              <p className={publicEyebrowClass}>Grassroots football software</p>
              <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.03] tracking-tight text-white sm:text-6xl lg:text-[4.35rem]">
                Run the football week from one club workspace.
              </h1>
              <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/80 sm:text-lg sm:leading-8">
                Football Player helps grassroots clubs manage training, fixtures, availability, parent updates, and player records from one simple workspace.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="/sign-in" className={publicPrimaryButtonClass}>Start free</a>
                <a href="/features" className={publicSecondaryButtonClass}>See features</a>
              </div>
            </div>

            <div className="lg:pl-4">
              <div className="rounded-[1.15rem] border border-white/16 bg-white/[0.07] p-2.5 shadow-2xl shadow-black/45 backdrop-blur">
                <div className="overflow-hidden rounded-lg border border-white/12 bg-[#102016]">
                  <img src={coachHomeImage} alt="Football Player club workspace dashboard" className="w-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0b1a10]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6 md:grid-cols-3 lg:px-8">
          {benefits.map(([title, copy]) => (
            <article key={title} className="rounded-lg border border-[#c6ff1a]/18 bg-white/[0.075] p-5 shadow-lg shadow-black/20">
              <span className="mb-4 block h-1.5 w-10 rounded-full bg-[#c6ff1a]" />
              <h2 className="text-xl font-black tracking-tight text-white">{title}</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-white/76">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={publicSectionClass}>
        <div className="grid gap-4 lg:grid-cols-[0.85fr_1fr] lg:items-end">
          <div className="max-w-3xl">
            <p className={publicEyebrowClass}>Built around the football week</p>
            <h2 className={publicHeadingClass}>One clear place for the work coaches repeat every week.</h2>
          </div>
          <p className={`max-w-2xl ${publicSubheadingClass}`}>
            Plan the week, record what happened, and keep the next action visible for every team.
          </p>
        </div>

        <div className="mt-10 grid gap-10 sm:mt-12">
          {productSections.map((section, index) => (
            <article key={section.title} className="grid gap-6 rounded-lg border border-white/10 bg-white/[0.035] p-4 sm:p-5 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-8">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <p className={publicEyebrowClass}>{section.label}</p>
                <h3 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">{section.title}</h3>
                <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-white/74">{section.copy}</p>
              </div>
              <PublicScreenshot image={section.image} alt={section.alt} />
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-lg border border-[#c6ff1a]/28 bg-[#102016] p-6 shadow-2xl shadow-black/30 sm:p-8 lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-8">
          <div className="absolute inset-x-0 top-0 h-1 bg-[#c6ff1a]" />
          <div>
            <p className={publicEyebrowClass}>Start simple</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
              Start with one team, then grow into the whole club.
            </h2>
            <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-white/76">
              Use Football Player with a small group first, then add more teams, staff, parents, and player records when the club is ready.
            </p>
          </div>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:mt-0">
            <a href="/sign-in" className={publicPrimaryButtonClass}>Start free</a>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('football-player:open-contact'))}
              className={publicSecondaryButtonClass}
            >
              Contact us
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
