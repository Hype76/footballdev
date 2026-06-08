import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import coachHomeImage from '../assets/marketing/coach-home.png'
import playerProgressionImage from '../assets/marketing/player-progression.png'
import playersListImage from '../assets/marketing/players-list.png'
import sessionsCalendarImage from '../assets/marketing/sessions-calendar.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import {
  PublicFeatureCard,
  PublicFinalCta,
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
  ['Less chasing', 'Sessions, players, parents, and match day work stay connected to the same team record.'],
  ['Clearer match days', 'Availability, fixtures, squads, and follow-up work are easier to see.'],
  ['Better player history', 'Development notes and progress stay with the player over time.'],
]

const productSections = [
  {
    title: 'Plan the week',
    copy: 'Keep training sessions, fixtures, parent response cut offs, and club events visible before the week starts.',
    image: sessionsCalendarImage,
    alt: 'Football Player calendar showing training and fixture activity',
  },
  {
    title: 'Run training',
    copy: "Create sessions, add players, and save coach notes while the football is still fresh in everyone's mind.",
    image: coachHomeImage,
    alt: 'Football Player coach home showing session actions',
  },
  {
    title: 'Keep parents updated',
    copy: 'Share clear updates from saved club records without giving parents access to staff tools.',
    image: playersListImage,
    alt: 'Football Player player register used for parent updates',
  },
  {
    title: 'Track player progression',
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
          <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 px-4 py-12 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div className="max-w-3xl">
              <p className={publicEyebrowClass}>Grassroots football software</p>
              <h1 className="mt-5 text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-6xl">
                Run training, match day, parents, and player development in one club workspace.
              </h1>
              <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/78 sm:text-lg sm:leading-8">
                Football Player helps grassroots clubs manage sessions, fixtures, availability, parent updates, and player records from one simple workspace.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="/sign-in" className={publicPrimaryButtonClass}>Start free</a>
                <a href="/features" className={publicSecondaryButtonClass}>See features</a>
              </div>
            </div>

            <div className="lg:pl-8">
              <PublicScreenshot image={coachHomeImage} alt="Football Player club workspace dashboard" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0b1a10]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6 md:grid-cols-3 lg:px-8">
          {benefits.map(([title, copy]) => (
            <PublicFeatureCard key={title} title={title} copy={copy} />
          ))}
        </div>
      </section>

      <section className={publicSectionClass}>
        <div className="max-w-3xl">
          <p className={publicEyebrowClass}>Built around the football week</p>
          <h2 className={publicHeadingClass}>One clear place for the work coaches repeat every week.</h2>
          <p className={`mt-4 ${publicSubheadingClass}`}>
            Short, practical tools for the things grassroots staff actually need to do.
          </p>
        </div>

        <div className="mt-10 grid gap-12">
          {productSections.map((section, index) => (
            <article key={section.title} className="grid gap-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <p className={publicEyebrowClass}>{section.title}</p>
                <h3 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">{section.title}</h3>
                <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-white/70">{section.copy}</p>
              </div>
              <PublicScreenshot image={section.image} alt={section.alt} />
            </article>
          ))}
        </div>
      </section>

      <PublicFinalCta
        title="Start with one team, then grow into the whole club."
        copy="Use Football Player with a small group first, then add more teams, staff, parents, and player records when the club is ready."
      />
    </main>
  )
}
