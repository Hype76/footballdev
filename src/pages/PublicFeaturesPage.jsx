import fallbackLogo from '../assets/football-player-logo.png'
import coachHomeImage from '../assets/marketing/coach-home.png'
import playerProgressionImage from '../assets/marketing/player-progression.png'
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

const featureGroups = [
  {
    label: 'Plan',
    features: [
      ['Calendar', 'See training, fixtures, deadlines, and club events in one place.'],
      ['Sessions', 'Create sessions, add players, and save coach notes against the right team.'],
    ],
  },
  {
    label: 'Run',
    features: [
      ['Match day', 'Prepare squads, collect replies, record results, and keep follow-up visible.'],
      ['Parent updates', 'Send focused updates from saved records without opening staff tools to families.'],
    ],
  },
  {
    label: 'Record',
    features: [
      ['Players', 'Keep current, trial, and archived player records easy to find.'],
      ['Development records', 'Capture coach observations while they are still useful.'],
    ],
  },
  {
    label: 'Review',
    features: [
      ['Progression charts', 'Turn saved records into readable trends over time.'],
      ['Team access', 'Keep roles and team context clear as the club grows.'],
    ],
  },
]

const screenshotSections = [
  {
    label: 'Calendar and sessions',
    title: 'Plan the week before the messages start.',
    copy: 'Create training, fixtures, deadlines, and club events from the calendar so every team can see what is coming.',
    bullets: [
      'Click a date to add an event',
      'Keep sessions and fixtures tied to the right team',
      'See parent response cut-offs before match day',
    ],
    image: sessionsCalendarImage,
    alt: 'Football Player calendar and sessions view',
  },
  {
    label: 'Player records and development',
    title: 'Keep the player history with the player.',
    copy: "Every note, rating, session, and follow-up stays attached to the player, not buried in someone's messages.",
    bullets: [
      'Current, trial, and archived players',
      'Coach notes and development records',
      'Progression history over time',
    ],
    image: playerProgressionImage,
    alt: 'Football Player progression chart and development records',
  },
  {
    label: 'Parents and match day',
    title: 'Share the right update without opening the staff workspace.',
    copy: 'Staff keep control of the records. Parents get the updates, replies, and information the club chooses to share.',
    bullets: [
      'Availability and match day replies',
      'Parent updates from saved records',
      'Staff tools stay separate',
    ],
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
        <div className="grid gap-7 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <div className="max-w-4xl">
            <p className={publicEyebrowClass}>Features</p>
            <h1 className={`mt-4 ${publicHeadingClass}`}>
              The weekly tools your football club actually uses.
            </h1>
          </div>
          <div className="max-w-2xl lg:justify-self-end">
            <p className={publicSubheadingClass}>
              Bring training, fixtures, availability, parent updates, player records, and development history into one workspace your staff can actually use.
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
          {featureGroups.map((group) => (
            <section key={group.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-sm shadow-black/20">
              <p className={publicEyebrowClass}>{group.label}</p>
              <div className="mt-4 grid gap-3">
                {group.features.map(([title, copy]) => (
                  <article key={title} className="rounded-lg border border-white/10 bg-[#102016] p-4">
                    <span className="mb-3 block h-1.5 w-8 rounded-full bg-[#c6ff1a]" />
                    <h2 className="text-lg font-black tracking-tight text-white">{title}</h2>
                    <p className="mt-3 text-sm font-semibold leading-6 text-white/68">{copy}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className={publicSectionClass}>
        <div className="grid gap-6">
          {screenshotSections.map((section) => (
            <article key={section.title} className="grid gap-5 rounded-lg border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20 sm:p-4 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-6">
              <div className="px-2 py-2 lg:px-3">
                <p className={publicEyebrowClass}>{section.label}</p>
                <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">{section.title}</h2>
                <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-white/70">{section.copy}</p>
                <ul className="mt-5 grid gap-2">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="grid grid-cols-[auto_1fr] gap-3 text-sm font-black leading-6 text-white">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#c6ff1a]" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <PublicScreenshot image={section.image} alt={section.alt} />
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-lg border border-[#c6ff1a]/30 bg-gradient-to-br from-[#132719] via-[#102016] to-[#07130b] p-6 shadow-2xl shadow-black/35 sm:p-8 lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-8">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-[#c6ff1a]" />
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">See the club tools in action.</h2>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/70">
              Open the demo workspace or speak to us about setting up Football Player for your club.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:mt-0">
            <a href="/sign-in" className={publicPrimaryButtonClass}>Start free</a>
            <button type="button" onClick={openContactModal} className={publicSecondaryButtonClass}>Contact us</button>
          </div>
        </div>
      </section>
    </main>
  )
}
