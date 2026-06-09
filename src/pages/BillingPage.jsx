import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canViewBilling, useAuth } from '../lib/auth.js'
import { formatUkDate } from '../lib/date-format.js'
import { getPlanName } from '../lib/plans.js'

function formatDate(value) {
  if (!value) {
    return 'Not available'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Not available'
  }

  return formatUkDate(parsedDate.toISOString().slice(0, 10), 'Not available')
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(Number(amount ?? 0) / 100)
}

function getBillingStatusLabel(status) {
  const normalizedStatus = String(status ?? '').trim()

  if (normalizedStatus === 'trialing') {
    return 'Trialing'
  }

  if (normalizedStatus === 'active') {
    return 'Active'
  }

  if (normalizedStatus === 'past_due') {
    return 'Past due'
  }

  if (normalizedStatus === 'cancelled') {
    return 'Cancelled'
  }

  return normalizedStatus || 'Not available'
}

const billingRules = [
    {
      label: 'Club access changes here',
      body: 'Plan changes affect every coach, team, player, and parent tool in this club.',
    },
  {
    label: 'Tester access is temporary',
    body: 'Staging can use tester codes. Paid checkout is only needed when the club is ready to keep using the workspace.',
  },
  {
    label: 'Invoices prove billing state',
    body: 'Use invoices to confirm payment history after Stripe has created records for the subscription.',
  },
]

export function BillingPage() {
  const { session, user } = useAuth()
  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const [billing, setBilling] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCheckoutLoading, setIsCheckoutLoading] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadBilling = async () => {
      if (!session?.access_token || !user?.clubId || !canViewBilling(user)) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const response = await fetch('/.netlify/functions/get-billing-summary', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
        const result = await response.json().catch(() => ({}))

        if (!response.ok || result.success === false) {
          throw new Error(result.message || 'Billing details could not be loaded')
        }

        if (isMounted) {
          setBilling(result.billing)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Billing details could not be refreshed right now.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadBilling()

    return () => {
      isMounted = false
    }
  }, [session?.access_token, user])

  const clubBilling = billing?.club
  const fallbackClub = useMemo(
    () => ({
      planKey: user?.planKey,
      planStatus: user?.planStatus,
      isPlanComped: user?.isPlanComped,
      currentPeriodEnd: user?.currentPeriodEnd,
      planUpdatedAt: user?.planUpdatedAt,
    }),
    [user],
  )
  const visibleClub = clubBilling || fallbackClub
  const testerAccessExpired = Boolean(user?.testerAccessExpired)
  const planSummary = [
    {
      label: 'Current tier',
      value: getPlanName(visibleClub),
      caption: 'Controls limits and available workspace tools.',
    },
    {
      label: 'Plan state',
      value: testerAccessExpired ? 'Tester access ended' : visibleClub?.isPlanComped ? 'Free access' : getBillingStatusLabel(visibleClub?.planStatus),
      caption: 'This is the access state enforced for the club.',
    },
    {
      label: 'Next billing date',
      value: formatDate(visibleClub?.currentPeriodEnd),
      caption: 'Shown when subscription data is available.',
    },
  ]

  const handleChoosePlan = async (planName) => {
    setIsCheckoutLoading(planName)
    setErrorMessage('')

    if (paymentsDisabled) {
      setErrorMessage('Payments are disabled on this test site.')
      setIsCheckoutLoading('')
      return
    }

    try {
      const response = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName,
          billingCycle: 'monthly',
          customerEmail: user?.email || undefined,
          clubName: user?.clubName || undefined,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false || !result.url) {
        throw new Error(result.message || 'Checkout could not be started.')
      }

      window.location.assign(result.url)
    } catch (error) {
      console.error(error)
      setErrorMessage('Checkout could not be started right now.')
    } finally {
      setIsCheckoutLoading('')
    }
  }

  if (!canViewBilling(user)) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Club access</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-4xl">
              Keep the club plan clear before coaches and parents rely on it.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
              Review the current tier, subscription state, tester access, renewal date, and invoices that control this football workspace.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {billingRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 shadow-sm shadow-[#047857]/10">
                  <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-5 shadow-sm shadow-[#047857]/10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Access state</p>
              <p className="mt-2 break-words text-2xl font-black tracking-tight text-[#101828]">
                {isLoading ? 'Loading plan' : getPlanName(visibleClub)}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                {testerAccessExpired ? 'Tester access has ended for this club.' : 'This is the access currently enforced for the club.'}
              </p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {planSummary.map((item) => (
                <BillingMetric key={item.label} label={item.label} value={isLoading ? 'Loading...' : item.value} />
              ))}
              <BillingMetric label="Invoices" value={isLoading ? 'Loading...' : (billing?.invoices ?? []).length} />
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <NoticeBanner
          title="Billing details are not fully available"
          message={errorMessage}
        />
      ) : null}

      {testerAccessExpired ? (
        <NoticeBanner
          title="Tester access has ended"
          message={paymentsDisabled ? 'Your club data is still safe. Use tester access codes on staging because payment checkout is disabled here.' : 'Your club data is still safe. Choose a paid plan below to continue using the workspace.'}
        />
      ) : null}

      <SectionCard
        title="Current plan"
        tourId="current-plan-section"
        description="Your club access is controlled by the tier shown here."
      >
        {isLoading ? (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55]">
            Loading billing details...
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Tier</p>
              <p className="mt-3 text-2xl font-black text-[#101828]">{getPlanName(visibleClub)}</p>
            </div>
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Status</p>
              <p className="mt-3 text-2xl font-black text-[#101828]">
                {testerAccessExpired ? 'Tester access ended' : visibleClub?.isPlanComped ? 'Free access' : getBillingStatusLabel(visibleClub?.planStatus)}
              </p>
            </div>
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Next billing date</p>
              <p className="mt-3 text-2xl font-black text-[#101828]">{formatDate(visibleClub?.currentPeriodEnd)}</p>
            </div>
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Last updated</p>
              <p className="mt-3 text-2xl font-black text-[#101828]">{formatDate(visibleClub?.planUpdatedAt)}</p>
            </div>
          </div>
        )}
      </SectionCard>

      {testerAccessExpired && !paymentsDisabled ? (
        <SectionCard
          title="Choose a paid plan"
          description="Start paid access for this club so the workspace can be used again."
        >
          <div className="grid gap-4 md:grid-cols-2">
            {['Single Team', 'Small Club'].map((planName) => (
              <button
                key={planName}
                type="button"
                disabled={Boolean(isCheckoutLoading)}
                title={isCheckoutLoading ? 'Please wait while checkout opens.' : undefined}
                onClick={() => void handleChoosePlan(planName)}
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCheckoutLoading === planName ? 'Opening checkout...' : `Choose ${planName}`}
              </button>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Invoices"
        tourId="invoices-section"
        description="Invoices appear here once billing has created them for this subscription."
      >
        {isLoading ? (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55]">
            Loading invoices...
          </div>
        ) : (billing?.invoices ?? []).length === 0 ? (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55]">
            No invoices are available yet.
          </div>
        ) : (
          <div className="space-y-3">
            {billing.invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="grid gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10 md:grid-cols-[1fr_auto_auto]"
              >
                <div>
                  <p className="font-black text-[#101828]">{invoice.number}</p>
                  <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                    {formatDate(invoice.createdAt)}, {getBillingStatusLabel(invoice.status)}
                  </p>
                </div>
                <p className="text-sm font-black text-[#101828] md:self-center">
                  {formatMoney(invoice.amountPaid || invoice.amountDue, invoice.currency)}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row md:self-center">
                  {invoice.hostedInvoiceUrl ? (
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
                    >
                      View
                    </a>
                  ) : null}
                  {invoice.invoicePdf ? (
                    <a
                      href={invoice.invoicePdf}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46]"
                    >
                      Download
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function BillingMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{label}</p>
      <p className="mt-2 break-words text-2xl font-black text-[#101828]">{value}</p>
    </div>
  )
}
