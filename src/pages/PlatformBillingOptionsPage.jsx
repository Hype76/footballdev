import { useCallback, useEffect, useMemo, useState } from 'react'
import { BillingHeroAndStats } from '../components/platform-billing/BillingHeroAndStats.jsx'
import { CreateCouponSection } from '../components/platform-billing/CreateCouponSection.jsx'
import { CreateTesterCodeSection } from '../components/platform-billing/CreateTesterCodeSection.jsx'
import { ExistingCouponsSection } from '../components/platform-billing/ExistingCouponsSection.jsx'
import { TesterAccessCodesSection } from '../components/platform-billing/TesterAccessCodesSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  defaultCouponForm,
  defaultTesterCodeForm,
} from '../lib/platform-billing-utils.js'

export function PlatformBillingOptionsPage() {
  const { session, user } = useAuth()
  const { showToast } = useToast()
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
  const [currentTime] = useState(() => Date.now())

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
    const hasExpired = code.expiresAt && new Date(code.expiresAt).getTime() <= currentTime
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
      showToast({ title: 'Tester code saved', message: 'Tester access code has been created.' })
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
      showToast({ title: 'Tester code saved', message: !code.isActive ? 'Tester access code has been enabled.' : 'Tester access code has been disabled.' })
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
      showToast({ title: 'Coupon saved', message: 'Coupon has been created.' })
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
      showToast({ title: 'Coupon deleted', message: 'Coupon has been removed.' })
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
      showToast({ title: 'Promotion saved', message: shouldShowLive ? 'Promotion is live on the website.' : 'Promotion is no longer live on the website.' })
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

      <BillingHeroAndStats billingStats={billingStats} isLoading={isLoading} />

      <CreateCouponSection
        couponForm={couponForm}
        isSaving={isSaving}
        onCouponChange={handleCouponChange}
        onCreateCoupon={handleCreateCoupon}
      />

      <CreateTesterCodeSection
        isSavingTesterCode={isSavingTesterCode}
        onCreateTesterCode={handleCreateTesterCode}
        onTesterCodeChange={handleTesterCodeChange}
        testerCodeForm={testerCodeForm}
      />

      <TesterAccessCodesSection
        currentTime={currentTime}
        onToggleTesterCode={(code) => void handleToggleTesterCode(code)}
        sortedTesterCodes={sortedTesterCodes}
        updatingTesterCodeId={updatingTesterCodeId}
      />

      <ExistingCouponsSection
        deletingCouponId={deletingCouponId}
        isLoading={isLoading}
        livePromotionId={livePromotionId}
        onDeleteCoupon={(coupon) => void handleDeleteCoupon(coupon)}
        onSetLivePromotion={(coupon) => void handleSetLivePromotion(coupon)}
        sortedCoupons={sortedCoupons}
      />
    </div>
  )
}
