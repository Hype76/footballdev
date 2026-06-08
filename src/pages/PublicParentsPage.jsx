import fallbackLogo from '../assets/football-player-logo.png'
import parentPortalGoalPhoneImage from '../assets/parent-portal-goal-phone.png'
import playersListImage from '../assets/marketing/players-list.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import {
  PublicScreenshot,
  PublicScrollProgress,
  publicCardClass,
  publicEyebrowClass,
  publicHeadingClass,
  publicPageClass,
  publicPrimaryButtonClass,
  publicSecondaryButtonClass,
  publicSectionClass,
  publicSubheadingClass,
} from '../components/login/PublicSiteComponents.jsx'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'

const parentGets = [
  ['Clear updates', 'Simple club messages connected to the right player.'],
  ['Availability replies', 'Parents can reply when coaches need to know who is available.'],
  ['Match and training information', 'Useful details are shared without digging through group chats.'],
  ['Player progress when shared', 'Coaches choose when development updates are ready for families.'],
]

const clubControls = [
  ['Staff tools', 'Parents never need access to coach or admin areas.'],
  ['Player records', 'The club keeps control of the full player history.'],
  ['Team access', 'Access stays linked to the children and teams the club connects.'],
  ['What gets shared', 'Coaches choose the updates parents receive.'],
]

const steps = [
  {
    title: 'Coaches record the session, match, or player note.',
    copy: 'The football activity stays inside the club workspace.',
  },
  {
    title: 'The club chooses what parents should receive.',
    copy: 'Staff decide which updates are useful and appropriate to send.',
  },
  {
    title: 'Parents get a clear update linked to their child.',
    copy: 'Families see the information they need without entering staff tools.',
  },
  {
    title: 'Replies stay connected to the right team and player.',
    copy: 'Availability and responses stay attached to the right football context.',
  },
]

const phoneLabels = [
  'Availability request',
  'Training update',
  'Match day details',
  'Player progress when shared',
]

export function PublicParentsPage() {
  usePublicThemeScope()

  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return (
    <main className={publicPageClass}>
      <PublicScrollProgress />
      <LoginHeader logo={fallbackLogo} />

      <section className={publicSectionClass}>
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="max-w-3xl">
            <p className={publicEyebrowClass}>Parents</p>
            <h1 className={`mt-4 ${publicHeadingClass}`}>
              Clear parent updates, controlled by the club.
            </h1>
            <p className={`mt-5 max-w-2xl ${publicSubheadingClass}`}>
              Coaches share updates from the records they already keep. Parents get clear information about training, match day, availability, and player progress without needing access to staff tools.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href="/sign-in" className={publicPrimaryButtonClass}>Parent login</a>
              <a href="/features" className={publicSecondaryButtonClass}>See features</a>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md rounded-lg border border-[#c6ff1a]/22 bg-gradient-to-br from-[#132719] via-[#102016] to-[#07130b] p-4 shadow-2xl shadow-black/40">
            <div className="grid gap-4 sm:grid-cols-[0.95fr_1.05fr] sm:items-center">
              <div className="overflow-hidden rounded-lg border border-white/12 bg-[#06110a] p-3">
                <img src={parentPortalGoalPhoneImage} alt="Football Player parent mobile access" className="mx-auto max-h-[520px] w-full object-contain" />
              </div>
              <div className="grid gap-3">
                <p className={publicEyebrowClass}>Parent access</p>
                <p className="text-sm font-semibold leading-6 text-white/76">
                  Families see clear updates linked to the right player and team. The club decides what is shared.
                </p>
                <div className="grid gap-2">
                  {phoneLabels.map((label) => (
                    <div key={label} className="rounded-lg border border-white/10 bg-white/[0.055] px-3 py-2 text-sm font-black text-white">
                      <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#c6ff1a]" />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0b1a10]">
        <div className="mx-auto grid max-w-7xl gap-5 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:px-8">
          {[
            ['What parents get', parentGets],
            ['What clubs keep control of', clubControls],
          ].map(([label, cards]) => (
            <section key={label} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-sm shadow-black/20 sm:p-5">
              <p className={publicEyebrowClass}>{label}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {cards.map(([title, copy]) => (
                  <article key={title} className="rounded-lg border border-white/10 bg-[#102016] p-4">
                    <span className="mb-3 block h-1.5 w-8 rounded-full bg-[#c6ff1a]" />
                    <h2 className="text-lg font-black tracking-tight text-white">{title}</h2>
                    <p className="mt-3 text-sm font-semibold leading-6 text-white/70">{copy}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className={publicSectionClass}>
        <div className="grid gap-8 lg:grid-cols-[0.76fr_1.24fr] lg:items-start">
          <div>
            <p className={publicEyebrowClass}>How it works</p>
            <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
              Clear for families, controlled by the club.
            </h2>
            <p className="mt-4 text-base font-semibold leading-7 text-white/70">
              Parent communication works best when it starts from the football record, not from another scattered message thread.
            </p>
          </div>
          <div className="grid gap-4">
            {steps.map((step, index) => (
              <article key={step.title} className={`${publicCardClass} grid gap-4 sm:grid-cols-[3rem_1fr]`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#c6ff1a] text-sm font-black text-[#06110a]">{index + 1}</span>
                <div>
                  <h3 className="text-lg font-black tracking-tight text-white">{step.title}</h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/66">
                    {step.copy}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={publicSectionClass}>
        <article className="grid gap-5 rounded-lg border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/20 sm:p-4 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-6">
          <div className="px-2 py-2 lg:px-3">
            <p className={publicEyebrowClass}>Club record first</p>
            <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">Parents get the update. Coaches keep the records.</h2>
            <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-white/70">
              The player record remains the source of truth for staff, while parent access receives only the parts families need.
            </p>
            <ul className="mt-5 grid gap-2">
              {['Updates come from saved records', 'Staff keep the full history', 'Parents only see what the club shares'].map((bullet) => (
                <li key={bullet} className="grid grid-cols-[auto_1fr] gap-3 text-sm font-black leading-6 text-white">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#c6ff1a]" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
          <PublicScreenshot image={playersListImage} alt="Player register used by staff before parent updates" />
        </article>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-lg border border-[#c6ff1a]/30 bg-gradient-to-br from-[#132719] via-[#102016] to-[#07130b] p-6 shadow-2xl shadow-black/35 sm:p-8 lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-8">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-[#c6ff1a]" />
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Keep families informed while the club stays in control.</h2>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/70">
              Use parent access for updates and replies while Football Player keeps the full records with the club.
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
