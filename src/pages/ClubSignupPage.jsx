import { useEffect, useRef, useState } from 'react'
import { canViewBilling, useAuth } from '../lib/auth.js'
import { COACH_CLUB_PROMOTION_TERMS, normalizeCoachClubCode } from '../lib/coach-club-promotion.js'
import { quoteSubscription } from '../lib/subscription-pricing.js'
import { LoginPage } from './LoginPage.jsx'

export function ClubSignupPage() {
  const { session, user, isLoading, isProfileLoading } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const intent = session?.user?.user_metadata?.club_signup_intent
  const [code, setCode] = useState(() => normalizeCoachClubCode(params.get('ref') ?? intent?.code))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const codeEdited = useRef(false)
  const initialSessionId = useRef(session?.user?.id || '')
  const explicitReferral = useRef(params.has('ref'))
  useEffect(() => {
    if (session?.user?.id && !initialSessionId.current) {
      initialSessionId.current = session.user.id
      const submittedCode = session.user.user_metadata?.club_signup_intent?.code
      if (submittedCode !== undefined && !codeEdited.current && !explicitReferral.current) setCode(normalizeCoachClubCode(submittedCode))
    }
  }, [session?.user])
  const teamCapacity = Number(params.get('teams') || intent?.teamCapacity || 20)
  const offerKey = params.get('offer') ?? intent?.offerKey ?? 'club_20'
  let quote
  try { quote = quoteSubscription({ planKey: 'club', teamCapacity, offerKey, billingCycle: 'monthly' }) } catch { /* Invalid links cannot start payment. */ }
  const start = async () => {
    if (inFlight.current || !quote) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const response = await fetch('/.netlify/functions/create-workspace-checkout-session', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: 'club', billingCycle: 'monthly', teamCapacity, offerKey, clubSignup: true, referralCode: normalizeCoachClubCode(code) || undefined }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success || !result.url) throw new Error(result.message || 'Checkout could not be started. Please try again.')
      const target = new URL(result.url)
      if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com' || target.username || target.password) throw new Error('Checkout returned an unexpected address.')
      window.location.assign(target.toString())
    } catch (failure) { setError(failure.message || 'Checkout could not be started. Please try again.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  if (isLoading || (session && isProfileLoading)) return <main className="p-5"><p role="status">Opening club sign-up...</p></main>
  if (!session) return <LoginPage clubSignup onPromotionCodeChange={value => { codeEdited.current = true; setCode(value) }} />
  const action = 'inline-flex min-h-12 items-center px-3 py-3 font-bold underline disabled:opacity-50'
  return <main className="mx-auto min-h-screen max-w-xl bg-white px-5 py-6 text-[#142a1d]">
    <h1 className="text-2xl font-bold">Complete your Club sign-up</h1>
    <p className="py-3">{user?.clubName || 'Your club'}. Confirm your monthly Club plan and any promotion code before continuing to secure checkout.</p>
    {params.get('payment') === 'returned' ? <p role="status" className="py-3">Checkout returned. Your Club access updates after Stripe confirms your subscription. <a className={action} href="/billing">Check subscription status</a></p> : null}
    {params.get('payment') === 'cancelled' ? <p role="status" className="py-3">Checkout was cancelled. You can resume it below.</p> : null}
    {quote ? <><h2 className="border-t border-[#ccd8d0] pt-4 text-xl font-bold">Club: up to {teamCapacity} teams</h2>
      <p className="py-3">14-day trial, then £{(quote.chargePence / 100).toFixed(2)} per month. A valid Coach code gives 50% off the first 3 monthly payments.</p></> : <p role="alert">This Club plan link is invalid. <a href="/pricing">Choose a Club plan</a>.</p>}
    <label className="block border-t border-[#ccd8d0] pt-4 font-bold" htmlFor="club-promotion-code">Promotion code (optional)</label>
    <input id="club-promotion-code" value={code} onChange={event => { codeEdited.current = true; setCode(event.target.value); setError('') }} disabled={busy} maxLength={40} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="Code from your Coach" className="my-2 min-h-12 w-full border-b border-[#ccd8d0] bg-transparent px-2 py-3 uppercase" />
    <p className="py-3">{COACH_CLUB_PROMOTION_TERMS}</p>
    {error ? <p role="alert" className="py-3 text-[#a11919]">{error}</p> : null}
    {!user || !canViewBilling(user) ? <p role="alert">Sign in with the account that owns this club to start its subscription.</p> : null}
    <button className={action} disabled={busy || !quote || !user || !canViewBilling(user)} onClick={() => void start()}>{busy ? 'Opening checkout...' : 'Continue to secure checkout'}</button>
    <a className={action} href="/">Return to Football Player</a>
  </main>
}
