import { Link } from 'react-router-dom'
import { BILLING_ACCESS_STATES, resolveBillingAccess } from '../../lib/billing-access.js'

export function BillingAccessNotice({ user }) {
  if (!user?.id) return null

  const decision = resolveBillingAccess(user)
  if (![BILLING_ACCESS_STATES.paymentDueSoon, BILLING_ACCESS_STATES.paymentRequired].includes(decision.accessState)) {
    return null
  }

  const paymentRequired = decision.accessState === BILLING_ACCESS_STATES.paymentRequired
  return (
    <section className="border-b border-[#f3c98b] bg-[#fff8e8] px-4 py-3 text-[#5b3a00] sm:px-6 md:px-8 xl:px-10" aria-label="Billing access notice">
      <div className="mx-auto flex w-full max-w-[108rem] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black">{paymentRequired ? 'Payment required' : 'Payment starts soon'}</p>
          <p className="mt-1 text-sm font-semibold leading-6">
            {paymentRequired
              ? 'Staff editing and management are paused. Your information remains available to view and export.'
              : `Staff access remains active until ${new Date(decision.billingStartAt).toLocaleDateString('en-GB')}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/data-transfer" className="inline-flex min-h-10 items-center rounded-lg border border-[#c58a2b] bg-white px-4 py-2 text-sm font-black text-[#5b3a00]">
            Export data
          </Link>
          {decision.payerAuthorized ? (
            <Link to="/billing" className="inline-flex min-h-10 items-center rounded-lg bg-[#7a4a00] px-4 py-2 text-sm font-black text-white">
              Continue with Stripe
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
