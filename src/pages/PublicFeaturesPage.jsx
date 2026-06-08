import fallbackLogo from '../assets/football-player-logo.png'
import coachHomeImage from '../assets/marketing/coach-home.png'
import playerProgressionImage from '../assets/marketing/player-progression.png'
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

const featureCards = [
  ['Calendar', 'See training, fixtures, deadlines, and club events in one place.'],
  ['Sessions', 'Create sessions, add players, and record notes against the right team.'],
  ['Players', 'Keep current, trial, and archived player records easy to find.'],
  ['Match day', 'Prepare squads, collect replies, save results, and keep follow-up visible.'],
  ['Parent updates', 'Send focused updates from saved records without staff access.'],
  ['Development records', 'Capture coach observations while they are still useful.'],
  ['Progression charts', 'Turn saved records into readable trends over time.'],
  ['Team access', 'Keep roles and team context clear as the club grows.'],
]

const screenshotSections = [
  {
    title: 'Calendar and sessions',
    copy: 'Plan the football week, create sessions, and keep training or fixture details tied to the right team.',
    image: sessionsCalendarImage,
    alt: 'Football Player calendar and sessions view',
  },
  {
    title: 'Player records and development',
    copy: 'Keep player history, staff notes, development records, and progression together so the club remembers what happened.',
    image: playerProgressionImage,
    alt: 'Football Player progression chart and development records',
  },
  {
    title: 'Parent updates and match day',
    copy: 'Manage availability, match details, and parent communication without opening up staff tools to families.',
    image: coachHomeImage,
    alt: 'Football Player coach workspace with weekly actions',
  },
]

export function PublicFeaturesPage() {
  usePublicThemeScope()

  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <main className={publicPageClass}>
      <LoginHeader logo={fallbackLogo} />

      <section className={publicSectionClass}>
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <p className={publicEyebrowClass}>Features</p>
            <h1 className={`mt-4 ${publicHeadingClass}`}>
              The weekly tools a grassroots club actually needs.
            </h1>
          </div>
          <div>
            <p className={publicSubheadingClass}>
              Bring sessions, fixtures, availability, parent updates, and player records into one workspace your staff can actually use.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href="/sign-in" className={publicPrimaryButtonClass}>Start free</a>
              <button type="button" onClick={openContactModal} className={publicSecondaryButtonClass}>Contact us</button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0b1a10]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
          {featureCards.map(([title, copy]) => (
            <PublicFeatureCard key={title} title={title} copy={copy} />
          ))}
        </div>
      </section>

      <section className={publicSectionClass}>
        <div className="grid gap-12">
          {screenshotSections.map((section, index) => (
            <article key={section.title} className="grid gap-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <p className={publicEyebrowClass}>{section.title}</p>
                <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">{section.title}</h2>
                <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-white/70">{section.copy}</p>
              </div>
              <PublicScreenshot image={section.image} alt={section.alt} />
            </article>
          ))}
        </div>
      </section>

      <PublicFinalCta
        title="See the workspace with demo data."
        copy="Open the demo from sign in, or speak to us about setting up your club."
        primaryLabel="Open demo"
      />
    </main>
  )
}
