import { useEffect, useState } from 'react'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { DemoRequestModal } from '../components/login/DemoRequestModal.jsx'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { formatPrice, formatPriceLabel, getPromotionSummary, pricingPlans } from '../lib/login-pricing.js'

const initialDemoFormData = {
  name: '',
  email: '',
  phone: '',
  clubTeamName: '',
}

export function PublicPricingPage() {
  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [demoPlan, setDemoPlan] = useState(null)
  const [demoFormData, setDemoFormData] = useState(initialDemoFormData)
  const [livePromotion, setLivePromotion] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

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

    if (plan.name === 'Individual' || paymentsDisabled) {
      window.location.assign('/login')
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
    <main className="min-h-screen bg-[#061009] text-white">
      <LoginHeader logo={fallbackLogo} />
      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ff2f]">Pricing</p>
            <h1 className="mt-5 text-4xl font-black leading-[1.03] tracking-tight sm:text-6xl">Simple plans for teams and clubs.</h1>
            <p className="mt-5 text-base leading-8 text-slate-300">
              Start with one team, then scale into a full club workspace with staff roles, branding, parent communication, and audit logs.
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
                onClick={() => setBillingCycle(key)}
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

        {errorMessage ? <div className="mt-6 rounded-lg border border-[#7d2639] bg-[#35101c] px-4 py-3 text-sm font-semibold text-[#ffc2cf]">{errorMessage}</div> : null}
        {message ? <div className="mt-6 rounded-lg border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-3 text-sm font-semibold text-[#d8ff2f]">{message}</div> : null}
        {livePromotion && !paymentsDisabled ? (
          <div className="mt-6 rounded-lg border border-[#d8ff2f]/25 bg-[#d8ff2f]/10 px-5 py-4 text-sm font-bold text-[#d8ff2f]">
            Live offer: use {livePromotion.code} for {getPromotionSummary(livePromotion)}. Applied automatically at checkout.
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan) => {
            const priceLabel = formatPriceLabel(plan, billingCycle)
            const showPromotion = livePromotion && !paymentsDisabled && typeof plan.price === 'number'

            return (
              <article key={plan.name} className="relative flex flex-col rounded-lg border border-white/10 bg-white/[0.045] p-5 shadow-xl shadow-black/20">
                {plan.name === 'Small Club' ? (
                  <span className="absolute right-5 top-5 rounded-full border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-3 py-1 text-xs font-bold text-[#d8ff2f]">
                    Popular
                  </span>
                ) : null}
                <div className="min-h-[128px] pr-16">
                  <h2 className="text-lg font-black">{plan.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{plan.description}</p>
                </div>
                <div className="min-h-[92px]">
                  <span className="text-4xl font-black">{formatPrice(plan, billingCycle)}</span>
                  {priceLabel ? <span className="ml-2 text-sm font-semibold text-slate-400">{priceLabel}</span> : null}
                  {showPromotion ? <p className="mt-2 text-xs font-semibold text-[#d8ff2f]">{getPromotionSummary(livePromotion)}</p> : null}
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
                    onClick={() => void handleChoosePlan(plan)}
                    className={[
                      'inline-flex min-h-12 items-center justify-center rounded-lg px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60',
                      plan.name === 'Small Club' ? 'bg-[#d8ff2f] text-black hover:opacity-90' : 'border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]',
                    ].join(' ')}
                  >
                    {paymentsDisabled ? 'Create Test Club' : plan.name === 'Individual' ? 'Start Free' : plan.name === 'Large Club' ? 'Request Demo' : 'Choose Plan'}
                  </button>
                  {plan.name !== 'Individual' && !paymentsDisabled ? (
                    <button
                      type="button"
                      onClick={() => setDemoPlan(plan)}
                      className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-black text-white transition hover:bg-white/[0.1]"
                    >
                      Request Demo
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
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
