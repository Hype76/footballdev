import { useEffect, useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import { DemoRequestModal } from '../components/login/DemoRequestModal.jsx'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import {
  PublicScrollProgress,
  publicEyebrowClass,
  publicHeadingClass,
  publicPageClass,
  publicSecondaryButtonClass,
  publicSectionClass,
  publicSubheadingClass,
} from '../components/login/PublicSiteComponents.jsx'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'
import { formatPrice, formatPriceLabel, getPromotionSummary, pricingPlans } from '../lib/login-pricing.js'

const initialDemoFormData = {
  name: '',
  email: '',
  phone: '',
  clubTeamName: '',
}

const fitNotes = [
  ['Testing with one small squad?', 'Start with Individual Coach.'],
  ['Running one team?', 'Use Single Team.'],
  ['Managing several teams?', 'Use Small Club.'],
  ['Running development operations?', 'Use Development Club.'],
  ['Need rollout help?', 'Speak to us about Large Club.'],
]

export function PublicPricingPage() {
  usePublicThemeScope()

  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const billingCycle = 'monthly'
  const [demoPlan, setDemoPlan] = useState(null)
  const [demoFormData, setDemoFormData] = useState(initialDemoFormData)
  const [livePromotion, setLivePromotion] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const openContactModal = () => {
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  useEffect(() => {
    let isMounted = true

    async function loadLivePromotion() {
      try {
        const response = await fetch('/.netlify/functions/get-live-promotion')
        const result = await response.json().catch(() => ({}))

        if (isMounted && response.ok && result.success !== false) {
          setLivePromotion(result.promotion ?? null)
        }
      } catch (error) {
        console.error(error)
      }
    }

    void loadLivePromotion()

    return () => {
      isMounted = false
    }
  }, [])

  const handleDemoChange = (event) => {
    const { name, value } = event.target
    setDemoFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleDemoSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage('')
    setErrorMessage('')

    try {
      const response = await fetch('/.netlify/functions/send-demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...demoFormData,
          planName: demoPlan?.name || '',
          billingCycle,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Demo request could not be sent.')
      }

      setDemoPlan(null)
      setDemoFormData(initialDemoFormData)
      setMessage('Demo request sent. We will be in touch shortly.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Demo request could not be sent.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChoosePlan = async (plan) => {
    setMessage('')
    setErrorMessage('')

    if (paymentsDisabled) {
      window.location.assign(`/sign-in?plan=${encodeURIComponent(plan.name)}`)
      return
    }

    if (plan.purchaseMode === 'free') {
      window.location.assign(`/sign-in?plan=${encodeURIComponent(plan.name)}`)
      return
    }

    if (plan.purchaseMode === 'contact_sales') {
      setDemoPlan(plan)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: plan.name,
          planKey: plan.planKey,
          billingCycle,
          livePromotionCodeId: livePromotion?.promotionCodeId || undefined,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false || !result.url) {
        throw new Error(result.message || 'Checkout could not be started.')
      }

      window.location.assign(result.url)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Checkout could not be started.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getPlanLabel = (plan) => plan.displayName || plan.name

  const getPrimaryCtaLabel = (plan) => {
    if (paymentsDisabled) {
      return 'Start setup'
    }

    if (plan.purchaseMode === 'free') {
      return 'Start free'
    }

    if (plan.purchaseMode === 'contact_sales') {
      return 'Contact us'
    }

    return 'Choose plan'
  }

  const handlePrimaryCta = (plan) => {
    if (plan.purchaseMode === 'contact_sales' && !paymentsDisabled) {
      openContactModal()
      return
    }

    void handleChoosePlan(plan)
  }

  return (
    <main className={publicPageClass}>
      <PublicScrollProgress />
      <LoginHeader logo={fallbackLogo} />

      <section className={publicSectionClass}>
        <div className="grid gap-7 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <div className="max-w-4xl">
            <p className={publicEyebrowClass}>Pricing</p>
            <h1 className={`mt-4 ${publicHeadingClass}`}>
              Start small, then scale with the club.
            </h1>
          </div>
          <div className="max-w-2xl lg:justify-self-end">
            <p className={publicSubheadingClass}>
              Choose the workspace size that fits your current team setup. Start with one coach or one team, then add more teams, staff, players, and parent updates when the club is ready.
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-white/60">
              Prices shown monthly. Large Club is a contact-sales tier.
            </p>
          </div>
        </div>

        {errorMessage ? <div className="mt-6 rounded-lg border border-red-300/40 bg-red-950/50 px-4 py-3 text-sm font-semibold text-red-100">{errorMessage}</div> : null}
        {message ? <div className="mt-6 rounded-lg border border-[#c6ff1a]/30 bg-[#c6ff1a]/10 px-4 py-3 text-sm font-semibold text-white">{message}</div> : null}
        {livePromotion && !paymentsDisabled ? (
          <div className="mt-6 rounded-lg border border-[#c6ff1a]/30 bg-[#c6ff1a]/10 px-5 py-4 text-sm font-bold text-white">
            Live offer: use {livePromotion.code} for {getPromotionSummary(livePromotion)}. Applied automatically at checkout.
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {pricingPlans.map((plan) => {
            const priceLabel = formatPriceLabel(plan, billingCycle)
            const showPromotion = livePromotion && !paymentsDisabled && typeof plan.price === 'number'
            const planLabel = getPlanLabel(plan)

            return (
              <article
                key={plan.name}
                className={[
                  'relative flex min-h-full flex-col overflow-hidden rounded-lg border p-5 shadow-sm shadow-black/20',
                  'border-white/10 bg-white/[0.055]',
                ].join(' ')}
              >
                <div className="pr-6">
                  <h2 className="text-xl font-black text-white">{planLabel}</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/70">{plan.description}</p>
                </div>
                <div className="mt-5">
                  <span className="text-3xl font-black text-white sm:text-4xl">{formatPrice(plan, billingCycle)}</span>
                  {priceLabel ? <span className="ml-2 text-sm font-semibold text-white/58">{priceLabel}</span> : null}
                  {showPromotion ? <p className="mt-2 text-xs font-black text-[#c6ff1a]">{getPromotionSummary(livePromotion)}</p> : null}
                </div>
                <ul className="mt-6 grow space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-white/68">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-lg bg-[#c6ff1a]" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 grid gap-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handlePrimaryCta(plan)}
                    className={[publicSecondaryButtonClass, 'disabled:cursor-not-allowed disabled:opacity-60'].join(' ')}
                  >
                    {getPrimaryCtaLabel(plan)}
                  </button>
                  {plan.purchaseMode === 'contact_sales' && !paymentsDisabled ? (
                    <button
                      type="button"
                      onClick={() => setDemoPlan(plan)}
                      className={publicSecondaryButtonClass}
                    >
                      Request demo
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>

        <section className="mt-8 rounded-lg border border-[#c6ff1a]/24 bg-gradient-to-br from-[#132719] via-[#102016] to-[#07130b] p-5 shadow-2xl shadow-black/25 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className={publicEyebrowClass}>Which plan should I choose?</p>
              <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">Start small. Upgrade when the club is ready.</h2>
            </div>
            <p className="max-w-sm text-sm font-semibold leading-6 text-white/66">No card needed for the free plan.</p>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {fitNotes.map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-white/10 bg-white/[0.055] p-4">
                <h3 className="text-sm font-black text-white">{title}</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-white/68">{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </section>

      <DemoRequestModal
        demoFormData={demoFormData}
        demoPlan={demoPlan}
        isSubmitting={isSubmitting}
        onCancel={() => {
          setDemoPlan(null)
          setDemoFormData(initialDemoFormData)
        }}
        onChange={handleDemoChange}
        onSubmit={handleDemoSubmit}
      />
    </main>
  )
}
