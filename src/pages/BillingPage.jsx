import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageClubSettings, useAuth } from '../lib/auth.js'
import { getPlanName } from '../lib/plans.js'

function formatDate(value) {
  if (!value) {
    return 'Not available'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Not available'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
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

export function BillingPage() {
  const { session, user } = useAuth()
  const [billing, setBilling] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadBilling = async () => {
      if (!session?.access_token || !user?.clubId || !canManageClubSettings(user)) {
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

  if (!canManageClubSettings(user)) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Billing"
        title="Billing and plan"
        description="Review your current tier, subscription status, renewal date, and recent invoices."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Billing details are not fully available"
          message={errorMessage}
        />
      ) : null}

      <SectionCard
        title="Current plan"
        description="Your club access is controlled by the tier shown here."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading billing details...
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Tier</p>
              <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{getPlanName(visibleClub)}</p>
            </div>
            <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Status</p>
              <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
                {visibleClub?.isPlanComped ? 'Free access' : getBillingStatusLabel(visibleClub?.planStatus)}
              </p>
            </div>
            <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Next billing date</p>
              <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{formatDate(visibleClub?.currentPeriodEnd)}</p>
            </div>
            <div className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Last updated</p>
              <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{formatDate(visibleClub?.planUpdatedAt)}</p>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Invoices"
        description="Invoices appear here once billing has created them for this subscription."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading invoices...
          </div>
        ) : (billing?.invoices ?? []).length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No invoices are available yet.
          </div>
        ) : (
          <div className="space-y-3">
            {billing.invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="grid gap-3 rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 md:grid-cols-[1fr_auto_auto]"
              >
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">{invoice.number}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {formatDate(invoice.createdAt)} | {getBillingStatusLabel(invoice.status)}
                  </p>
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)] md:self-center">
                  {formatMoney(invoice.amountPaid || invoice.amountDue, invoice.currency)}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row md:self-center">
                  {invoice.hostedInvoiceUrl ? (
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                    >
                      View
                    </a>
                  ) : null}
                  {invoice.invoicePdf ? (
                    <a
                      href={invoice.invoicePdf}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
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
