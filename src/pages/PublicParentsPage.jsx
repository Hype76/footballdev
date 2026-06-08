import fallbackLogo from '../assets/football-player-logo.png'
import parentPortalGoalPhoneImage from '../assets/parent-portal-goal-phone.png'
import playersListImage from '../assets/marketing/players-list.png'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import {
  PublicFeatureCard,
  PublicFinalCta,
  PublicScreenshot,
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
  ['Clear updates', 'Simple messages from the club, connected to the right player.'],
  ['Availability requests', 'Parents can reply when coaches need to know who is available.'],
  ['Match and training information', 'Useful details are shared without digging through group chats.'],
  ['Player progress when shared', 'Coaches choose when development updates are ready for families.'],
]

const clubControls = [
  ['Staff tools', 'Parents never need access to coach and admin areas.'],
  ['Player records', 'The club keeps control of the full player history.'],
  ['Team access', 'Access stays linked to the children and teams the club connects.'],
  ['What gets shared', 'Coaches choose the updates parents receive.'],
]

const steps = [
  'Staff record the football activity',
  'Coach chooses what to share',
  'Parent receives the update',
  'Replies stay connected to the club',
]

export function PublicParentsPage() {
  usePublicThemeScope()

  return (
    <main className={publicPageClass}>
      <LoginHeader logo={fallbackLogo} />

      <section className={publicSectionClass}>
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className={publicEyebrowClass}>Parents</p>
            <h1 className={`mt-4 ${publicHeadingClass}`}>
              Parent updates without opening the staff workspace.
            </h1>
            <p className={`mt-5 max-w-2xl ${publicSubheadingClass}`}>
              Coaches choose what to share from saved club records. Parents get clear updates and replies without needing access to staff tools.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href="/sign-in" className={publicPrimaryButtonClass}>Parent login</a>
              <a href="/features" className={publicSecondaryButtonClass}>See features</a>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-lg border border-white/12 bg-[#102016] p-3 shadow-2xl shadow-black/35">
            <img src={parentPortalGoalPhoneImage} alt="Football Player parent mobile access" className="mx-auto max-h-[560px] w-full object-contain" />
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0b1a10]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <p className={publicEyebrowClass}>What parents get</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {parentGets.map(([title, copy]) => (
                <PublicFeatureCard key={title} title={title} copy={copy} />
              ))}
            </div>
          </div>

          <div>
            <p className={publicEyebrowClass}>What clubs keep control of</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {clubControls.map(([title, copy]) => (
                <PublicFeatureCard key={title} title={title} copy={copy} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={publicSectionClass}>
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className={publicEyebrowClass}>How it works</p>
            <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
              Clear for families, controlled by the club.
            </h2>
            <p className="mt-4 text-base font-semibold leading-7 text-white/70">
              Parent communication works best when it starts from the football record, not a blank message thread.
            </p>
          </div>
          <div className="grid gap-4">
            {steps.map((step, index) => (
              <article key={step} className={`${publicCardClass} grid gap-4 sm:grid-cols-[3rem_1fr]`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#c6ff1a] text-sm font-black text-[#06110a]">{index + 1}</span>
                <div>
                  <h3 className="text-lg font-black tracking-tight text-white">{step}</h3>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/66">
                    {index === 0 ? 'The player, team, session, and notes stay inside the club workspace.' : index === 1 ? 'The club decides what is useful and appropriate to send.' : index === 2 ? 'The family sees the update through parent access.' : 'Replies and availability stay connected to the right football context.'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={publicSectionClass}>
        <div className="grid gap-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <p className={publicEyebrowClass}>Club record first</p>
            <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">Parents get the update. Coaches keep the records.</h2>
            <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-white/70">
              The player register remains the source of truth for staff, while parent access receives the parts families need.
            </p>
          </div>
          <PublicScreenshot image={playersListImage} alt="Player register used by staff before parent updates" />
        </div>
      </section>

      <PublicFinalCta
        title="Keep families informed without opening staff tools."
        copy="Use parent access for updates and replies while the club keeps control of the football records."
      />
    </main>
  )
}
