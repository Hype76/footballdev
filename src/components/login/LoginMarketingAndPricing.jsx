import { formatPrice, formatPriceLabel, getPromotionSummary, pricingPlans } from '../../lib/login-pricing.js'

const panelClass = 'rounded-lg border border-[#bddcca] bg-white p-5 shadow-sm shadow-[#067a46]/10 sm:p-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#067a46]'
const titleClass = 'mt-3 text-3xl font-black tracking-tight text-[#10231a] sm:text-4xl'
const copyClass = 'mt-3 text-sm font-semibold leading-6 text-[#456653]'
const cardClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 shadow-sm shadow-[#067a46]/10'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-5 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#f0fdf6]'

const operatingSystemRows = [
  ['Club setup', 'Create the club, first team, staff access, and parent contact rules before inviting wider use.'],
  ['Match week', 'Track availability, build sessions, record match day notes, and keep actions tied to real players.'],
  ['Parent comms', 'Send controlled updates, polls, invites, and reports without sharing staff logins.'],
  ['Player memory', 'Keep development records, squad history, trial status, and assessment fields in one place.'],
]

const switchCards = [
  ['Less setup drag than Spond', 'Make the first useful action obvious: club, team, players, parents, then match week.'],
  ['Less website weight than Pitchero', 'Prioritise the operating workspace before public-site content, news, and broad sports tooling.'],
  ['Football-only decisions', 'Use football language, football roles, and football workflows everywhere in the product.'],
  ['Cleaner club control', 'Separate platform admin, club admin, team staff, and parent access from the start.'],
]

const onboardingRules = [
  'State is saved per account or workspace.',
  'Setup can be skipped, reset, or reopened later.',
  'Steps use real club data where the app can check it.',
  'Manual completion is only for choices the system cannot infer.',
]

export function LoginMarketingAndPricing({
  billingCycle,
  isSubmitting,
  livePromotion,
  localError,
  localMessage,
  onBillingCycleChange,
  onChoosePlan,
  onRequestDemo,
  paymentsDisabled,
}) {
  return (
    <section className="space-y-5 pb-8 text-[#10231a]">
      <div className={panelClass}>
        <p className={eyebrowClass}>Football-only club OS</p>
        <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div>
            <h2 className="max-w-4xl text-3xl font-black tracking-tight text-[#10231a] sm:text-4xl">
              Built to move clubs away from scattered chats, paper forms, and generic team apps.
            </h2>
            <p className="mt-4 max-w-4xl text-base font-semibold leading-8 text-[#456653]">
              Football Player should feel like the place a club opens first: who is available, who needs a parent reply, what coaches need to record, and what has to happen before match day.
            </p>
          </div>
          <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] p-4">
            <p className="text-sm font-black text-[#10231a]">First useful action</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">
              Create the first team, add players, link parent contacts, then run availability or match day from live club records.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className={panelClass}>
          <p className={eyebrowClass}>Operating system</p>
          <h2 className={titleClass}>The product should teach the club how to run the week.</h2>
          <div className="mt-6 grid gap-3">
            {operatingSystemRows.map(([title, copy], index) => (
              <article key={title} className="grid gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 sm:grid-cols-[2.5rem_1fr]">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#067a46] text-sm font-black text-white">
                  {index + 1}
                </span>
                <span>
                  <span className="block text-sm font-black text-[#10231a]">{title}</span>
                  <span className="mt-1 block text-sm font-semibold leading-6 text-[#456653]">{copy}</span>
                </span>
              </article>
            ))}
          </div>
        </div>

        <div className={panelClass}>
          <p className={eyebrowClass}>Why clubs switch</p>
          <h2 className={titleClass}>Sharper than generic sports tools, lighter than a full club website.</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {switchCards.map(([title, copy]) => (
              <article key={title} className={cardClass}>
                <p className="text-sm font-black text-[#10231a]">{title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className={panelClass}>
        <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <p className={eyebrowClass}>Onboarding that belongs in the product</p>
            <h2 className={titleClass}>No generic tour. A setup board that proves the workspace is ready.</h2>
            <p className={copyClass}>
              New clubs see short, practical setup checks inside the app. The flow explains constraints, records progress, and guides the first real workflow instead of showing welcome slides.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {onboardingRules.map((rule) => (
              <div key={rule} className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] p-4 text-sm font-black leading-6 text-[#065f3b]">
                {rule}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-[#bddcca] bg-white p-5 shadow-sm shadow-[#067a46]/10 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className={eyebrowClass}>Pricing</p>
          <h2 className={titleClass}>Start with one football group, then scale the club.</h2>
          <p className={copyClass}>
            Test the operating flow first. Paid plans add more structure as the club needs more teams, communication, and controlled access.
          </p>
        </div>
        <div className="grid w-full max-w-xs grid-cols-2 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-1">
          {[
            ['monthly', 'Monthly'],
            ['annual', 'Annual'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onBillingCycleChange(key)}
              className={[
                'min-h-11 rounded-lg px-4 py-3 text-sm font-black transition',
                billingCycle === key ? 'bg-[#067a46] text-white shadow-sm shadow-[#067a46]/20' : 'text-[#456653] hover:bg-white hover:text-[#10231a]',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {localError ? (
        <div className="rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
          {localError}
        </div>
      ) : null}

      {localMessage ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-3 text-sm font-black text-[#05603a]">
          {localMessage}
        </div>
      ) : null}

      {paymentsDisabled ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-5 py-4 text-sm font-black text-[#05603a]">
          Payments are disabled on this test site. New sign-ups create test club accounts without checkout.
        </div>
      ) : null}

      {livePromotion && !paymentsDisabled ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-5 py-4 text-sm font-black text-[#05603a]">
          Live offer: use {livePromotion.code} for {getPromotionSummary(livePromotion)}. Applied automatically at checkout.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {pricingPlans.map((plan) => {
          const priceLabel = formatPriceLabel(plan, billingCycle)
          const showPromotion = livePromotion && !paymentsDisabled && typeof plan.price === 'number'
          const isPopular = plan.name === 'Small Club'

          return (
            <div key={plan.name} className="relative flex flex-col rounded-lg border border-[#bddcca] bg-white p-5 shadow-sm shadow-[#067a46]/10">
              {isPopular ? (
                <span className="absolute right-5 top-5 whitespace-nowrap rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-3 py-1 text-xs font-black text-[#05603a]">
                  Popular
                </span>
              ) : null}
              {showPromotion ? (
                <div className="mb-4 rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-[#05603a]">
                  {getPromotionSummary(livePromotion)}
                </div>
              ) : null}
              <div className="min-h-[132px] pr-16">
                <p className="text-lg font-black text-[#10231a]">{plan.name}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{plan.description}</p>
              </div>
              <div className="min-h-[88px]">
                <span className={['whitespace-nowrap font-black text-[#10231a]', plan.price === 'Contact us' ? 'text-[2rem] leading-none 2xl:text-4xl' : 'text-4xl'].join(' ')}>
                  {formatPrice(plan, billingCycle)}
                </span>
                {priceLabel ? <span className="ml-2 text-sm font-semibold text-[#456653]">{priceLabel}</span> : null}
                {typeof plan.price === 'number' && billingCycle === 'annual' ? (
                  <p className="mt-2 text-xs font-black text-[#067a46]">2 months free compared with monthly</p>
                ) : null}
                {showPromotion ? (
                  <p className="mt-2 text-xs font-black text-[#067a46]">
                    Code {livePromotion.code} auto-applied at checkout
                  </p>
                ) : null}
              </div>
              <ul className="mt-6 grow space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-[#456653]">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#067a46]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 grid gap-3">
                <button
                  type="button"
                  disabled={isSubmitting}
                  title={isSubmitting ? 'Please wait while your plan request is being processed.' : undefined}
                  onClick={() => onChoosePlan(plan)}
                  className={[isPopular ? primaryButtonClass : secondaryButtonClass, isSubmitting ? 'cursor-not-allowed opacity-60' : ''].join(' ')}
                >
                  {paymentsDisabled ? 'Create test club' : plan.name === 'Individual' ? 'Start free' : plan.name === 'Large Club' ? 'Request demo' : 'Choose plan'}
                </button>
                {plan.name !== 'Individual' && !paymentsDisabled ? (
                  <button type="button" onClick={() => onRequestDemo(plan)} className={secondaryButtonClass}>
                    Request demo
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <footer className="flex flex-col gap-3 border-t border-[#bddcca] pt-6 text-sm font-semibold text-[#456653] sm:flex-row sm:items-center sm:justify-between">
        <p>Copyright 2026 Football Player. All rights reserved. Powered by <a href="https://pulseslabs.online" className="hover:text-[#10231a]" target="_blank" rel="noreferrer">pulseslabs.online</a>.</p>
        <div className="flex flex-wrap gap-4">
          <a href="/gdpr" className="hover:text-[#10231a]">GDPR</a>
          <a href="/terms" className="hover:text-[#10231a]">Terms of Service</a>
        </div>
      </footer>
    </section>
  )
}
