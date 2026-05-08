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

const defaultTesterCodeForm = {
  label: '',
  code: '',
  planKey: 'single_team',
  expiresInDays: '30',
  maxUses: '1',
  assignedEmail: '',
}

const testerPlanOptions = [
  { key: 'individual', label: 'Individual' },
  { key: 'single_team', label: 'Single Team' },
  { key: 'small_club', label: 'Small Club' },
  { key: 'large_club', label: 'Large Club' },
]

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
  const [testerCodes, setTesterCodes] = useState([])
  const [couponForm, setCouponForm] = useState(defaultCouponForm)
  const [testerCodeForm, setTesterCodeForm] = useState(defaultTesterCodeForm)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingTesterCode, setIsSavingTesterCode] = useState(false)
  const [livePromotionId, setLivePromotionId] = useState('')
  const [deletingCouponId, setDeletingCouponId] = useState('')
  const [updatingTesterCodeId, setUpdatingTesterCodeId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const sortedCoupons = useMemo(
    () => [...coupons].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))),
    [coupons],
  )

  const sortedTesterCodes = useMemo(
    () => [...testerCodes].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))),
    [testerCodes],
  )
  const liveCouponCount = sortedCoupons.filter((coupon) => coupon.liveOnWebsite).length
  const activeCouponCount = sortedCoupons.filter((coupon) => coupon.active).length
  const activeTesterCodeCount = sortedTesterCodes.filter((code) => {
    const hasExpired = code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now()
    return code.isActive && !hasExpired
  }).length
  const testerRedemptionCount = sortedTesterCodes.reduce((total, code) => total + Number(code.redeemedCount ?? 0), 0)
  const billingStats = [
    {
      label: 'Coupons',
      value: sortedCoupons.length,
      caption: `${activeCouponCount} active`,
    },
    {
      label: 'Live website codes',
      value: liveCouponCount,
      caption: 'Visible on landing page',
    },
    {
      label: 'Tester codes',
      value: sortedTesterCodes.length,
      caption: `${activeTesterCodeCount} available`,
    },
    {
      label: 'Tester uses',
      value: testerRedemptionCount,
      caption: 'Redeemed access codes',
    },
  ]

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

  const loadTesterCodes = useCallback(async () => {
    if (!session?.access_token || !isSuperAdmin(user)) {
      return
    }

    try {
      const response = await fetch('/.netlify/functions/manage-tester-access-codes', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Tester access codes could not be loaded')
      }

      setTesterCodes(Array.isArray(result.codes) ? result.codes : [])
    } catch (error) {
      console.error(error)
      setErrorMessage('Tester access codes could not be loaded right now.')
    }
  }, [session?.access_token, user])

  useEffect(() => {
    void loadTesterCodes()
  }, [loadTesterCodes])

  const handleCouponChange = (fieldName, value) => {
    setCouponForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
  }

  const handleTesterCodeChange = (fieldName, value) => {
    setTesterCodeForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
  }

  const handleCreateTesterCode = async (event) => {
    event.preventDefault()

    if (!session?.access_token) {
      return
    }

    setIsSavingTesterCode(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-tester-access-codes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testerCodeForm),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Tester access code could not be created')
      }

      setTesterCodes(Array.isArray(result.codes) ? result.codes : [])
      setTesterCodeForm(defaultTesterCodeForm)
      setSuccessMessage('Tester access code created.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Tester access code could not be created.')
    } finally {
      setIsSavingTesterCode(false)
    }
  }

  const handleToggleTesterCode = async (code) => {
    if (!session?.access_token || !code.id) {
      return
    }

    setUpdatingTesterCodeId(code.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-tester-access-codes', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: code.id,
          isActive: !code.isActive,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Tester access code could not be updated')
      }

      setTesterCodes(Array.isArray(result.codes) ? result.codes : [])
      setSuccessMessage(!code.isActive ? 'Tester access code enabled.' : 'Tester access code disabled.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Tester access code could not be updated.')
    } finally {
      setUpdatingTesterCodeId('')
    }
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

  const handleDeleteCoupon = async (coupon) => {
    if (!session?.access_token || !coupon.id) {
      return
    }

    const confirmed = window.confirm(
      `Delete ${coupon.name || coupon.code || 'this coupon'}? This disables the promotion code and removes the coupon from Stripe where possible.`,
    )

    if (!confirmed) {
      return
    }

    setDeletingCouponId(coupon.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-stripe-coupons', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          couponId: coupon.id,
          promotionCodeId: coupon.promotionCodeId,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Coupon could not be deleted')
      }

      setCoupons(Array.isArray(result.coupons) ? result.coupons : [])
      setSuccessMessage('Coupon deleted.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Coupon could not be deleted.')
    } finally {
      setDeletingCouponId('')
    }
  }

  const handleSetLivePromotion = async (coupon) => {
    if (!session?.access_token || !coupon.promotionCodeId) {
      return
    }

    const shouldShowLive = !coupon.liveOnWebsite
    setLivePromotionId(coupon.promotionCodeId)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-stripe-coupons', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          promotionCodeId: coupon.promotionCodeId,
          showLive: shouldShowLive,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Live promotion could not be updated')
      }

      setCoupons(Array.isArray(result.coupons) ? result.coupons : [])
      setSuccessMessage(shouldShowLive ? 'Promotion is live on the website.' : 'Promotion is no longer live on the website.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Live promotion could not be updated.')
    } finally {
      setLivePromotionId('')
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
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      <section className="relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-8">
        <div className="pointer-events-none absolute -right-24 top-0 h-56 w-56 rounded-full bg-[var(--accent)] opacity-15 blur-3xl" />
        <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">Billing control centre</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
              Manage public promotions, tester access, and checkout discounts.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">
              Keep paid plans clean while giving testers temporary access without asking for a payment card.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]/80 p-5 backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-[var(--accent)] shadow-[0_0_24px_var(--accent)] animate-pulse" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {isLoading ? 'Refreshing billing data' : 'Billing data loaded'}
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
              Stripe coupons and tester access codes are managed from this page.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {billingStats.map((item) => (
          <div
            key={item.label}
            className="group relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[var(--accent)] opacity-70" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">{item.label}</p>
            <p className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">{item.value}</p>
            <p className="mt-3 text-sm text-[var(--text-muted)]">{item.caption}</p>
          </div>
        ))}
      </div>

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
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Promotion code</span>
            <input
              required
              value={couponForm.code}
              onChange={(event) => handleCouponChange('code', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm uppercase text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Duration</span>
            <select
              value={couponForm.duration}
              onChange={(event) => handleCouponChange('duration', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">End date</span>
            <input
              type="date"
              value={couponForm.expiresAt}
              onChange={(event) => handleCouponChange('expiresAt', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
            <span className="mt-2 block text-xs text-[var(--text-muted)]">
              Optional. This stops new redemptions after the selected date.
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 xl:self-end">
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
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Creating...' : 'Create Coupon'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Create tester access code"
        description="Give selected testers temporary plan access without asking for a payment card."
      >
        <form onSubmit={handleCreateTesterCode} className="grid gap-4 xl:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Label</span>
            <input
              value={testerCodeForm.label}
              onChange={(event) => handleTesterCodeChange('label', event.target.value)}
              placeholder="Cambourne tester"
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Access code</span>
            <input
              required
              value={testerCodeForm.code}
              onChange={(event) => handleTesterCodeChange('code', event.target.value)}
              placeholder="TESTER-30"
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm uppercase text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Plan level</span>
            <select
              value={testerCodeForm.planKey}
              onChange={(event) => handleTesterCodeChange('planKey', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              {testerPlanOptions.map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {plan.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Runs for days</span>
            <input
              required
              type="number"
              min="1"
              value={testerCodeForm.expiresInDays}
              onChange={(event) => handleTesterCodeChange('expiresInDays', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Max uses</span>
            <input
              required
              type="number"
              min="1"
              value={testerCodeForm.maxUses}
              onChange={(event) => handleTesterCodeChange('maxUses', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Assigned email</span>
            <input
              type="email"
              value={testerCodeForm.assignedEmail}
              onChange={(event) => handleTesterCodeChange('assignedEmail', event.target.value)}
              placeholder="Optional. Leave blank for any email."
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <div className="xl:col-span-4">
            <button
              type="submit"
              disabled={isSavingTesterCode}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSavingTesterCode ? 'Creating...' : 'Create Tester Code'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Tester access codes"
        description="These codes grant temporary access. Expired tester accounts keep their data but must choose a paid plan to continue."
      >
        {sortedTesterCodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No tester access codes have been created yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedTesterCodes.map((code) => {
              const planLabel = testerPlanOptions.find((plan) => plan.key === code.planKey)?.label || code.planKey
              const hasExpired = code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now()

              return (
                <div key={code.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--text-primary)]">{code.label || code.code}</p>
                      <p className="mt-1 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">{code.code}</p>
                    </div>
                    <span className="rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {hasExpired ? 'Expired' : code.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-[var(--text-muted)]">
                    <p><span className="font-semibold text-[var(--text-primary)]">Plan:</span> {planLabel}</p>
                    <p><span className="font-semibold text-[var(--text-primary)]">Email:</span> {code.assignedEmail || 'Any email'}</p>
                    <p><span className="font-semibold text-[var(--text-primary)]">Uses:</span> {code.redeemedCount} of {code.maxUses}</p>
                    <p><span className="font-semibold text-[var(--text-primary)]">Expires:</span> {formatDate(code.expiresAt)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={updatingTesterCodeId === code.id}
                    onClick={() => void handleToggleTesterCode(code)}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updatingTesterCodeId === code.id ? 'Saving...' : code.isActive ? 'Disable Code' : 'Enable Code'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Existing coupons"
        description="Use these promotion codes when applying discounts during checkout."
      >
        {isLoading ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading coupons...
          </div>
        ) : sortedCoupons.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No coupons have been created yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedCoupons.map((coupon) => (
              <div key={coupon.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">{coupon.name || coupon.id}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{formatDiscount(coupon)}</p>
                  </div>
                  <span className="rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {coupon.liveOnWebsite ? 'Live' : coupon.active ? 'Active' : 'Inactive'}
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
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={!coupon.promotionCodeId || livePromotionId === coupon.promotionCodeId}
                    onClick={() => void handleSetLivePromotion(coupon)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {livePromotionId === coupon.promotionCodeId ? 'Saving...' : coupon.liveOnWebsite ? 'Hide From Website' : 'Show Live'}
                  </button>
                  <button
                    type="button"
                    disabled={deletingCouponId === coupon.id}
                    onClick={() => void handleDeleteCoupon(coupon)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#7f1d1d] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[#fecaca] transition hover:bg-[#3f151a] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingCouponId === coupon.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
