import { useEffect, useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
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

    if (plan.name === 'Individual' || paymentsDisabled) {
      window.location.assign('/sign-in')
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
    <main className="min-h-screen bg-slate-50 pb-[max(5.5rem,env(safe-area-inset-bottom))] text-slate-950 lg:pb-0">
      <LoginHeader logo={fallbackLogo} />
      <section className="mx-auto w-full max-w-7xl px-4 py-8 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12 lg:px-8 lg:py-16">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Pricing</p>
            <h1 className="mt-4 text-3xl font-black leading-[1.04] tracking-tight min-[420px]:text-4xl sm:mt-5 sm:text-6xl">Simple plans for teams and clubs.</h1>
            <p className="mt-5 text-base leading-7 text-slate-700 sm:leading-8">
              Start with one team, then scale into a full club workspace with staff roles, branding, parent communication, and audit logs.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 rounded-lg border border-slate-200 bg-white p-1 sm:max-w-xs">
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
                  billingCycle === key ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {errorMessage ? <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{errorMessage}</div> : null}
        {message ? <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div> : null}
        {livePromotion && !paymentsDisabled ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-800">
            Live offer: use {livePromotion.code} for {getPromotionSummary(livePromotion)}. Applied automatically at checkout.
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pricingPlans.map((plan) => {
            const priceLabel = formatPriceLabel(plan, billingCycle)
            const showPromotion = livePromotion && !paymentsDisabled && typeof plan.price === 'number'

            return (
              <article key={plan.name} className="relative flex flex-col rounded-lg border border-slate-200 bg-white p-5">
                {plan.name === 'Small Club' ? (
                  <span className="absolute right-4 top-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 sm:right-5 sm:top-5">
                    Popular
                  </span>
                ) : null}
                <div className="min-h-[116px] pr-14 sm:min-h-[128px] sm:pr-16">
                  <h2 className="text-lg font-black">{plan.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{plan.description}</p>
                </div>
                <div className="min-h-[84px] sm:min-h-[92px]">
                  <span className="text-3xl font-black sm:text-4xl">{formatPrice(plan, billingCycle)}</span>
                  {priceLabel ? <span className="ml-2 text-sm font-semibold text-slate-500">{priceLabel}</span> : null}
                  {showPromotion ? <p className="mt-2 text-xs font-semibold text-emerald-700">{getPromotionSummary(livePromotion)}</p> : null}
                </div>
                <ul className="mt-6 grow space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-3 text-sm leading-6 text-slate-700">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-sm bg-emerald-600" />
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
                      plan.name === 'Small Club' ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {paymentsDisabled ? 'Create Test Club' : plan.name === 'Individual' ? 'Start Free' : plan.name === 'Large Club' ? 'Request Demo' : 'Choose Plan'}
                  </button>
                  {plan.name !== 'Individual' && !paymentsDisabled ? (
                    <button
                      type="button"
                      onClick={plan.name === 'Large Club' ? openContactModal : () => setDemoPlan(plan)}
                      className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50"
                    >
                      {plan.name === 'Large Club' ? 'Contact Us' : 'Request Demo'}
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
