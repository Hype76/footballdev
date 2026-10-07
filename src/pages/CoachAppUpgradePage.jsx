import { useRef, useState } from 'react'
import { canViewBilling, useAuth } from '../lib/auth.js'
import { quoteSubscription } from '../lib/subscription-pricing.js'
import { COACH_BRANDING_RETURN_URL } from '../lib/team-branding-onboarding.js'

export function CoachAppUpgradePage() {
  const { session, user, isLoading, isProfileLoading } = useAuth()
  const [cycle, setCycle] = useState('monthly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const paymentReturn = new URLSearchParams(window.location.search).get('payment')
  const start = async planKey => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const response = await fetch('/.netlify/functions/create-workspace-checkout-session', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, billingCycle: cycle, teamCapacity: planKey === 'club' ? 20 : 1,
          offerKey: planKey === 'club' ? 'club_20' : '', fromCoach: true }),
      })
      const value = await response.json().catch(() => ({}))
      if (!response.ok || !value.success) throw new Error(value.message || 'Payment could not be started. Try again.')
      const target = new URL(value.url)
      if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com' || target.username || target.password) throw new Error('Payment returned an unexpected address.')
      window.location.assign(target.toString())
    } catch (failure) { setError(failure.message || 'Payment could not be started. Try again.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const action = 'min-h-12 px-3 py-3 font-bold underline disabled:opacity-50'
  if (isLoading || isProfileLoading) return <main className="p-5"><p role="status">Opening your plan...</p></main>
  if (!session || !user || !canViewBilling(user)) return <main className="p-5"><p role="alert">Return to Coach and open Upgrade plan with your Team or Club account owner.</p><a className={action} href={COACH_BRANDING_RETURN_URL}>Return to Coach</a></main>
  return <main className="mx-auto min-h-screen max-w-lg bg-white px-5 py-6 text-[#142a1d]">
    <h1 className="text-2xl font-bold">Upgrade your plan</h1>
    <p className="py-3">{user.clubName || 'Your workspace'} keeps its players and records when you upgrade. Payment is handled securely by Stripe.</p>
    {paymentReturn && <p role="status" className="py-3">{paymentReturn === 'cancelled' ? 'Payment was cancelled. Your current plan stays in place.' : 'Return to Coach to check your plan. Plan access updates after Stripe confirms payment.'}</p>}
    <div className="flex gap-4 border-y border-[#ccd8d0] py-2">
      {['monthly', 'annual'].map(value => <button key={value} className={action} disabled={busy} aria-pressed={cycle === value} onClick={() => setCycle(value)}>{value === 'annual' ? 'Annual' : 'Monthly'}</button>)}
    </div>
    {['team', 'club'].filter(planKey => user.planKey !== 'club' && (user.planKey !== 'team' || planKey === 'club')).map(planKey => {
      const quote = quoteSubscription({ planKey, teamCapacity: planKey === 'club' ? 20 : 1, billingCycle: cycle, offerKey: planKey === 'club' ? 'club_20' : '' })
      return <section key={planKey} className="border-b border-[#ccd8d0] py-4">
        <h2 className="text-xl font-bold">{planKey === 'club' ? 'Club: up to 20 teams' : 'Team: one team'}</h2>
        <p className="py-2 text-lg font-bold">£{(quote.chargePence / 100).toFixed(2)} per {cycle === 'annual' ? 'year' : 'month'}</p>
        <p>{planKey === 'club' ? 'Club management, shared oversight, branding and analytics across up to 20 teams.' : 'Training, development, polls, resources, chat and branding for one team.'}</p>
        <button className={action} disabled={busy} onClick={() => void start(planKey)}>Upgrade to {planKey === 'club' ? 'Club' : 'Team'}</button>
      </section>
    })}
    <p className="py-4">More than 20 teams? <a className="font-bold underline" href="mailto:support@footballplayer.online?subject=Club%20quote%20for%20more%20than%2020%20teams">Contact us for a quote</a>.</p>
    {error && <p role="alert" className="py-3 text-[#a11919]">{error} <a className="underline" href="/billing">View existing plan payments</a></p>}
    <a className={`inline-flex items-center ${action}`} href={COACH_BRANDING_RETURN_URL}>Return to Coach</a>
  </main>
}
