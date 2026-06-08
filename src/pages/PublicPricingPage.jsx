import { useEffect, useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import { DemoRequestModal } from '../components/login/DemoRequestModal.jsx'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import {
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
import { formatPrice, formatPriceLabel, getPromotionSummary, pricingPlans } from '../lib/login-pricing.js'

const initialDemoFormData = {
  name: '',
  email: '',
  phone: '',
  clubTeamName: '',
}

const fitNotes = [
  ['Individual', 'For a coach testing the workflow with a small squad.'],
  ['Single Team', 'For one football group that needs records and parent updates.'],
  ['Small Club', 'For several teams with staff access and club oversight.'],
  ['Large Club', 'For rollout support, more teams, and agreed club limits.'],
]

export function PublicPricingPage() {
  usePublicThemeScope()

  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const [billingCycle, setBillingCycle] = useState('monthly')
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

    if (plan.name === 'Individual') {
      window.location.assign('/sign-in?plan=Individual')
      return
    }

    if (plan.name === 'Large Club') {
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

  return (
    <main className={publicPageClass}>
      <LoginHeader logo={fallbackLogo} />

      <section className={publicSectionClass}>
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <p className={publicEyebrowClass}>Pricing</p>
            <h1 className={`mt-4 ${publicHeadingClass}`}>
              Start small, then scale with the club.
            </h1>
          </div>
          <div>
            <p className={publicSubheadingClass}>
              Choose the workspace size that fits the number of teams, staff, players, and parent updates your club needs.
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-white/60">
              Early club pricing may change as the product develops.
            </p>
            <div className="mt-5 grid max-w-xs grid-cols-2 rounded-lg border border-white/12 bg-white/[0.055] p-1">
              {[
                ['monthly', 'Monthly'],
                ['annual', 'Annual'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBillingCycle(key)}
                  className={[
                    'min-h-11 rounded-lg px-4 py-3 text-sm font-black transition',
                    billingCycle === key ? 'bg-[#c6ff1a] text-[#06110a] shadow-sm' : 'text-white/64 hover:bg-white/[0.08] hover:text-white',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {errorMessage ? <div className="mt-6 rounded-lg border border-red-300/40 bg-red-950/50 px-4 py-3 text-sm font-semibold text-red-100">{errorMessage}</div> : null}
        {message ? <div className="mt-6 rounded-lg border border-[#c6ff1a]/30 bg-[#c6ff1a]/10 px-4 py-3 text-sm font-semibold text-white">{message}</div> : null}
        {livePromotion && !paymentsDisabled ? (
          <div className="mt-6 rounded-lg border border-[#c6ff1a]/30 bg-[#c6ff1a]/10 px-5 py-4 text-sm font-bold text-white">
            Live offer: use {livePromotion.code} for {getPromotionSummary(livePromotion)}. Applied automatically at checkout.
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan) => {
            const priceLabel = formatPriceLabel(plan, billingCycle)
            const showPromotion = livePromotion && !paymentsDisabled && typeof plan.price === 'number'
            const isPopular = plan.name === 'Small Club'

            return (
              <article key={plan.name} className={`${publicCardClass} relative flex min-h-full flex-col ${isPopular ? 'border-[#c6ff1a]/60 bg-[#c6ff1a]/[0.08]' : ''}`}>
                {isPopular ? (
                  <span className="absolute right-4 top-4 rounded-lg bg-[#c6ff1a] px-3 py-1 text-xs font-black text-[#06110a]">
                    Recommended
                  </span>
                ) : null}
                <div className="min-h-[132px] pr-16">
                  <h2 className="text-xl font-black text-white">{plan.name}</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/66">{plan.description}</p>
                </div>
                <div className="min-h-[92px]">
                  <span className="text-3xl font-black text-white sm:text-4xl">{formatPrice(plan, billingCycle)}</span>
                  {priceLabel ? <span className="ml-2 text-sm font-semibold text-white/58">{priceLabel}</span> : null}
                  {billingCycle === 'annual' && typeof plan.price === 'number' ? (
                    <p className="mt-2 text-xs font-black text-[#c6ff1a]">2 months free compared with monthly</p>
                  ) : null}
                  {showPromotion ? <p className="mt-2 text-xs font-black text-[#c6ff1a]">{getPromotionSummary(livePromotion)}</p> : null}
                </div>
                <ul className="mt-6 grow space-y-3">
                  {plan.features.slice(0, 5).map((feature) => (
                    <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-white/66">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-lg bg-[#c6ff1a]" />
                      <span>{feature}</span>
                    </li>
                  ))}
                  {plan.features.length > 5 ? (
                    <li className="text-sm font-black leading-6 text-[#c6ff1a]">
                      Plus {plan.features.length - 5} more plan benefits
                    </li>
                  ) : null}
                </ul>
                <div className="mt-6 grid gap-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleChoosePlan(plan)}
                    className={[
                      isPopular ? publicPrimaryButtonClass : publicSecondaryButtonClass,
                      'disabled:cursor-not-allowed disabled:opacity-60',
                    ].join(' ')}
                  >
                    {paymentsDisabled ? 'Create test club' : plan.name === 'Individual' ? 'Start free' : plan.name === 'Large Club' ? 'Request demo' : 'Choose plan'}
                  </button>
                  {plan.name !== 'Individual' && !paymentsDisabled ? (
                    <button
                      type="button"
                      onClick={plan.name === 'Large Club' ? openContactModal : () => setDemoPlan(plan)}
                      className={publicSecondaryButtonClass}
                    >
                      {plan.name === 'Large Club' ? 'Contact us' : 'Request demo'}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>

        <section className="mt-8 grid gap-4 rounded-lg border border-white/10 bg-[#0b1a10] p-5 sm:p-6 lg:grid-cols-4">
          {fitNotes.map(([title, copy]) => (
            <article key={title}>
              <h2 className="text-sm font-black text-white">{title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/66">{copy}</p>
            </article>
          ))}
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
