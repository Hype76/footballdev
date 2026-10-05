import { PUBLIC_PLAN_OPTIONS } from '../../lib/plans.js'
import { getPromotionSummary } from '../../lib/login-pricing.js'
import { PUBLIC_FREE_SIGNUP_PATH } from '../../lib/public-signup.js'

export function mountMarketingPricing(root) {
  let active = true, busy = false, promotion = null
  const plans = root.querySelectorAll('.plan-card')
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  status.className = 'marketing-form-message'
  root.querySelector('.plan-grid')?.after(status)
  const offer = document.createElement('p')
  offer.hidden = true
  offer.className = 'marketing-live-promotion'
  root.querySelector('.plan-grid')?.before(offer)
  PUBLIC_PLAN_OPTIONS.forEach((plan, index) => {
    const card = plans[index]
    if (!card) return
    const price = card.querySelector('.plan-price')
    if (price) {
      price.textContent = plan.isFree ? 'Free' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(plan.monthlyPricePence / 100)
      if (!plan.isFree) {
        const cycle = document.createElement('small')
        cycle.textContent = ' / month'
        price.append(cycle)
      }
    }
    if (plan.isFree) card.querySelector('.button').href = PUBLIC_FREE_SIGNUP_PATH
  })
  const controller = new AbortController()
  void fetch('/.netlify/functions/get-live-promotion', { signal: controller.signal }).then(async response => {
    const result = await response.json()
    if (!active || !response.ok || result.success === false) return
    promotion = result.promotion || null
    if (promotion && String(import.meta.env.VITE_PAYMENTS_DISABLED).toLowerCase() !== 'true') {
      offer.textContent = `Live offer: use ${promotion.code} for ${getPromotionSummary(promotion)}. Applied automatically at checkout.`
      offer.hidden = false
    }
  }).catch(() => {})
  const choose = async event => {
    const link = event.target.closest('[data-marketing-checkout]')
    if (!link) return
    event.preventDefault()
    if (busy) return
    const plan = PUBLIC_PLAN_OPTIONS.find(item => item.key === link.dataset.marketingCheckout)
    if (!plan || !plan.isPaid) return
    if (String(import.meta.env.VITE_PAYMENTS_DISABLED).toLowerCase() === 'true') {
      window.location.assign(`/sign-in?mode=login&plan=${encodeURIComponent(plan.key)}`)
      return
    }
    busy = true
    link.setAttribute('aria-disabled', 'true')
    status.textContent = 'Opening secure checkout...'
    try {
      const response = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ planName: plan.name, planKey: plan.key, billingCycle: 'monthly', teamCapacity: plan.limits.teams, livePromotionCodeId: promotion?.promotionCodeId || undefined }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success === false || !result.url) throw new Error(result.message || 'Checkout could not be started. Please try again.')
      if (active) window.location.assign(result.url)
    } catch (error) {
      if (active) status.textContent = error.message || 'Checkout could not be started. Please try again.'
    } finally {
      busy = false
      if (active) link.removeAttribute('aria-disabled')
    }
  }
  root.addEventListener('click', choose)
  return () => { active = false; controller.abort(); root.removeEventListener('click', choose) }
}
