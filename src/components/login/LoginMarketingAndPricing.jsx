import { formatPrice, formatPriceLabel, getPromotionSummary, pricingPlans } from '../../lib/login-pricing.js'

const capabilityCards = [
  ['Create player assessments', 'Score technical, tactical, physical, and attitude areas using your own club form.'],
  ['Send parent reports', 'Turn coach notes into professional parent-ready feedback, with or without scores.'],
  ['Manage trialists and squad players', 'Keep trial players separate from squad players while retaining full history.'],
  ['Organise sessions', 'Create training and match sessions, then assess players from the session list.'],
  ['Manage teams and staff', 'Assign coaches to teams and keep access controlled by role.'],
  ['Use it on mobile', 'Coaches can open it on phones, tablets, and desktops, with installable app support.'],
]

const workflowCards = [
  ['Trial nights', 'Add trialists, collect coach ratings, choose invite back, no place offered, or offer place, then send the right parent message.'],
  ['Training sessions', 'Build a session list, add players during the session, and complete assessments when coaches are ready.'],
  ['Squad reviews', 'Review previous assessments, track progress over time, and keep private staff notes away from parent emails.'],
  ['Match days', 'Keep match feedback linked to the correct session and player history.'],
]

const trustCards = [
  ['Club accounts', 'Each club has its own workspace, teams, staff roles, player records, and settings.'],
  ['Professional output', 'Reports and emails use clean wording, club branding, and selected assessment fields.'],
  ['No more lost notes', 'Player history, actions, and activity logs stay connected to the right club and team.'],
  ['Easy onboarding', 'Start small with one team, then add more staff, teams, and custom forms when needed.'],
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
    <section className="space-y-5 pb-8">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">Why it exists</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Better feedback for players. Less admin for coaches.</h2>
        <p className="mt-4 max-w-4xl text-base leading-8 text-slate-300">
          Grassroots clubs work hard to give players a fair chance. Trial notes, parent messages, emails, and paper forms can quickly become messy. Football Player helps clubs keep development records organised, communicate properly with parents, and save coaches time after every session.
        </p>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">What you can do</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Built to support the daily work of running football teams.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilityCards.map(([title, copy]) => (
            <div key={title} className="rounded-lg border border-white/10 bg-[#0b130d]/80 p-5">
              <p className="text-lg font-black text-white">{title}</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">{copy}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">Real club workflows</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Built around how football clubs actually work.</h2>
          <div className="mt-6 space-y-4">
            {workflowCards.map(([title, copy]) => (
              <div key={title} className="rounded-lg border border-white/10 bg-[#0b130d]/80 p-4">
                <p className="font-black text-white">{title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">Simple and trusted</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Clear for coaches. Useful for parents.</h2>
          <div className="mt-6 space-y-4">
            {trustCards.map(([title, copy]) => (
              <div key={title} className="rounded-lg border border-white/10 bg-[#0b130d]/80 p-4">
                <p className="font-black text-white">{title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d8ff2f]">Pricing</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Simple plans for growing clubs</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Start small, then move to a paid plan when your club needs more structure. Annual billing for paid plans is charged at 10 months.
          </p>
        </div>
        <div className="grid w-full max-w-xs grid-cols-2 rounded-lg border border-white/10 bg-black/20 p-1">
          {[
            ['monthly', 'Monthly'],
            ['annual', 'Annual'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onBillingCycleChange(key)}
              className={[
                'min-h-11 rounded-lg px-4 py-3 text-sm font-bold transition',
                billingCycle === key ? 'bg-[#d8ff2f] text-black' : 'text-slate-300 hover:text-white',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {localError ? (
        <div className="mt-4 rounded-lg border border-[#7d2639] bg-[#35101c] px-4 py-3 text-sm font-semibold text-[#ffc2cf]">
          {localError}
        </div>
      ) : null}

      {localMessage ? (
        <div className="mt-4 rounded-lg border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-3 text-sm font-semibold text-[#d8ff2f]">
          {localMessage}
        </div>
      ) : null}

      {paymentsDisabled ? (
        <div className="mt-4 rounded-lg border border-[#d8ff2f]/25 bg-[#d8ff2f]/10 px-5 py-4 text-sm font-bold text-[#d8ff2f]">
          Payments are disabled on this test site. New sign-ups create test club accounts without checkout.
        </div>
      ) : null}

      {livePromotion && !paymentsDisabled ? (
        <div className="mt-4 rounded-lg border border-[#d8ff2f]/25 bg-[#d8ff2f]/10 px-5 py-4 text-sm font-bold text-[#d8ff2f]">
          Live offer: use {livePromotion.code} for {getPromotionSummary(livePromotion)}. Applied automatically at checkout.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {pricingPlans.map((plan) => {
          const priceLabel = formatPriceLabel(plan, billingCycle)
          const showPromotion = livePromotion && !paymentsDisabled && typeof plan.price === 'number'

          return (
            <div
              key={plan.name}
              className="relative flex flex-col rounded-lg border border-white/10 bg-[#0b130d]/90 p-5 shadow-xl shadow-black/20 backdrop-blur"
            >
              {plan.name === 'Small Club' ? (
                <span className="absolute right-5 top-5 whitespace-nowrap rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-3 py-1 text-xs font-bold text-[#d8ff2f]">
                  Popular
                </span>
              ) : null}
              {showPromotion ? (
                <div className="mb-4 rounded-lg border border-[#d8ff2f]/25 bg-[#d8ff2f]/10 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-[#d8ff2f]">
                  {getPromotionSummary(livePromotion)}
                </div>
              ) : null}
              <div className="min-h-[132px] pr-16">
                <p className="text-lg font-black text-white">{plan.name}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{plan.description}</p>
              </div>
              <div className="min-h-[88px]">
                <span
                  className={[
                    'whitespace-nowrap font-black text-white',
                    plan.price === 'Contact us' ? 'text-[2rem] leading-none 2xl:text-4xl' : 'text-4xl',
                  ].join(' ')}
                >
                  {formatPrice(plan, billingCycle)}
                </span>
                {priceLabel ? <span className="ml-2 text-sm font-semibold text-slate-400">{priceLabel}</span> : null}
                {typeof plan.price === 'number' && billingCycle === 'annual' ? (
                  <p className="mt-2 text-xs font-semibold text-[#d8ff2f]">2 months free compared with monthly</p>
                ) : null}
                {showPromotion ? (
                  <p className="mt-2 text-xs font-semibold text-[#d8ff2f]">
                    Code {livePromotion.code} auto-applied at checkout
                  </p>
                ) : null}
              </div>
              <ul className="mt-6 grow space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm leading-6 text-slate-300">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#d8ff2f]" />
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
                  className={[
                    'inline-flex min-h-12 items-center justify-center rounded-lg px-5 py-3 text-sm font-black transition',
                    plan.name === 'Small Club'
                      ? 'bg-[#d8ff2f] text-black hover:opacity-90'
                      : 'border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]',
                    isSubmitting ? 'cursor-not-allowed opacity-60' : '',
                  ].join(' ')}
                >
                  {paymentsDisabled ? 'Create Test Club' : plan.name === 'Individual' ? 'Start Free' : plan.name === 'Large Club' ? 'Request Demo' : 'Choose Plan'}
                </button>
                {plan.name !== 'Individual' && !paymentsDisabled ? (
                  <button
                    type="button"
                    onClick={() => onRequestDemo(plan)}
                    className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-black text-white transition hover:bg-white/[0.08]"
                  >
                    Request Demo
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <footer className="flex flex-col gap-3 border-t border-white/10 pt-6 text-sm font-semibold text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p>Copyright 2026 Football Player. All rights reserved. Powered by <a href="https://pulseslabs.online" className="hover:text-white" target="_blank" rel="noreferrer">pulseslabs.online</a>.</p>
        <div className="flex flex-wrap gap-4">
          <a href="/gdpr" className="hover:text-white">GDPR</a>
          <a href="/terms" className="hover:text-white">Terms of Service</a>
        </div>
      </footer>
    </section>
  )
}
