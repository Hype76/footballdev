import { useCallback, useEffect, useMemo, useState } from 'react'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { isSuperAdmin, useAuth } from '../lib/auth.js'

const defaultCouponForm = {
  name: '',
  code: '',
  percentOff: '',
  amountOff: '',
  duration: 'once',
  durationInMonths: '3',
  expiresAt: '',
  firstTimeOnly: false,
}

function formatDate(value) {
  if (!value) {
    return 'No date'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'No date'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsedDate)
}

function formatDiscount(coupon) {
  if (coupon.percentOff) {
    return `${coupon.percentOff}% off`
  }

  if (coupon.amountOff) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: coupon.currency || 'GBP',
    }).format(Number(coupon.amountOff) / 100)
  }

  return 'No discount'
}

function formatExpiry(coupon) {
  if (coupon.expiresAt) {
    return `Ends ${formatDate(coupon.expiresAt)}`
  }

  if (coupon.redeemBy) {
    return `Ends ${formatDate(coupon.redeemBy)}`
  }

  return 'No end date'
}

export function PlatformBillingOptionsPage() {
  const { session, user } = useAuth()
  const [coupons, setCoupons] = useState([])
  const [couponForm, setCouponForm] = useState(defaultCouponForm)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const sortedCoupons = useMemo(
    () => [...coupons].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))),
    [coupons],
  )

  const loadCoupons = useCallback(async () => {
    if (!session?.access_token || !isSuperAdmin(user)) {
      setIsLoading(false)
      return
    }

    setErrorMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-stripe-coupons', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Coupons could not be loaded')
      }

      setCoupons(Array.isArray(result.coupons) ? result.coupons : [])
    } catch (error) {
      console.error(error)
      setErrorMessage('Billing coupons could not be loaded right now.')
    } finally {
      setIsLoading(false)
    }
  }, [session?.access_token, user])

  useEffect(() => {
    void loadCoupons()
  }, [loadCoupons])

  const handleCouponChange = (fieldName, value) => {
    setCouponForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
  }

  const handleCreateCoupon = async (event) => {
    event.preventDefault()

    if (!session?.access_token) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-stripe-coupons', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(couponForm),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Coupon could not be created')
      }

      setCoupons(Array.isArray(result.coupons) ? result.coupons : [])
      setCouponForm(defaultCouponForm)
      setSuccessMessage('Coupon created.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Coupon could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!isSuperAdmin(user)) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Billing"
          title="Billing options"
          description="This area is only available to platform administrators."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Billing"
        title="Billing options"
        description="Create promotion codes and manage platform level billing options."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Billing action not completed"
          message={errorMessage}
        />
      ) : null}

      {successMessage ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      <SectionCard
        title="Create discount coupon"
        description="Create a billing discount and promotion code that can be used during checkout."
      >
        <form onSubmit={handleCreateCoupon} className="grid gap-4 xl:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Coupon name</span>
            <input
              required
              value={couponForm.name}
              onChange={(event) => handleCouponChange('name', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Promotion code</span>
            <input
              required
              value={couponForm.code}
              onChange={(event) => handleCouponChange('code', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm uppercase text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Percent off</span>
            <input
              type="number"
              min="0"
              max="100"
              value={couponForm.percentOff}
              onChange={(event) => handleCouponChange('percentOff', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Fixed amount off</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={couponForm.amountOff}
              onChange={(event) => handleCouponChange('amountOff', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Duration</span>
            <select
              value={couponForm.duration}
              onChange={(event) => handleCouponChange('duration', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="once">Once</option>
              <option value="repeating">Repeating</option>
              <option value="forever">Forever</option>
            </select>
          </label>
          {couponForm.duration === 'repeating' ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Months</span>
              <input
                type="number"
                min="1"
                value={couponForm.durationInMonths}
                onChange={(event) => handleCouponChange('durationInMonths', event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">End date</span>
            <input
              type="date"
              value={couponForm.expiresAt}
              onChange={(event) => handleCouponChange('expiresAt', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
            <span className="mt-2 block text-xs text-[var(--text-muted)]">
              Optional. This stops new redemptions after the selected date.
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 xl:self-end">
            <input
              type="checkbox"
              checked={couponForm.firstTimeOnly}
              onChange={(event) => handleCouponChange('firstTimeOnly', event.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-sm font-semibold text-[var(--text-primary)]">First purchase only</span>
          </label>
          <div className="xl:col-span-4">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Creating...' : 'Create Coupon'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Existing coupons"
        description="Use these promotion codes when applying discounts during checkout."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading coupons...
          </div>
        ) : sortedCoupons.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No coupons have been created yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedCoupons.map((coupon) => (
              <div key={coupon.id} className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">{coupon.name || coupon.id}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{formatDiscount(coupon)}</p>
                  </div>
                  <span className="rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {coupon.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="mt-4 text-sm font-semibold text-[var(--text-primary)]">{coupon.code || 'No code'}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {coupon.duration}{coupon.durationInMonths ? ` | ${coupon.durationInMonths} months` : ''} | {formatDate(coupon.createdAt)}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {formatExpiry(coupon)}
                </p>
                {coupon.firstTimeOnly ? (
                  <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    First purchase only
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
