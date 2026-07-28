import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const sharedBillingLoadRequests = new Map()

function getSharedBillingLoadRequest(key, load) {
  const existingRequest = sharedBillingLoadRequests.get(key)

  if (existingRequest) {
    return existingRequest
  }

  const request = Promise.resolve().then(load)
  sharedBillingLoadRequests.set(key, request)
  void request.finally(() => {
    if (sharedBillingLoadRequests.get(key) === request) {
      sharedBillingLoadRequests.delete(key)
    }
  }).catch(() => undefined)

  return request
}

function BillingSuccessBanner({ message }) {
  return (
    <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-4 shadow-sm shadow-[#047857]/10">
      <div className="flex gap-3">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-lg bg-[#047857]" />
        <div>
          <p className="text-sm font-black text-[#101828]">Billing change saved</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">{message}</p>
        </div>
      </div>
    </div>
  )
}

export function PlatformBillingOptionsPage() {
  const { session, user } = useAuth()
  const { showToast } = useToast()
  const [coupons, setCoupons] = useState([])
  const [testerCodes, setTesterCodes] = useState([])
  const [couponForm, setCouponForm] = useState(defaultCouponForm)
  const [testerCodeForm, setTesterCodeForm] = useState(defaultTesterCodeForm)
  const [isCouponLoading, setIsCouponLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingTesterCode, setIsSavingTesterCode] = useState(false)
  const [livePromotionId, setLivePromotionId] = useState('')
  const [deletingCouponId, setDeletingCouponId] = useState('')
  const [updatingTesterCodeId, setUpdatingTesterCodeId] = useState('')
  const [couponErrorMessage, setCouponErrorMessage] = useState('')
  const [testerCodeErrorMessage, setTesterCodeErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [currentTime] = useState(() => Date.now())
  const couponLoadRequestRef = useRef(null)
  const testerCodeLoadRequestRef = useRef(null)

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
      setIsCouponLoading(false)
      return
    }

    const requestKey = `${user?.id || user?.email || 'platform-admin'}:${session.access_token}`
    const existingRequest = couponLoadRequestRef.current

    if (existingRequest?.key === requestKey) {
      return existingRequest.promise.catch(() => undefined)
    }

    const request = getSharedBillingLoadRequest(`coupons:${requestKey}`, async () => {
      setCouponErrorMessage('')
      setIsCouponLoading(true)

      const response = await fetch('/.netlify/functions/manage-stripe-coupons', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Coupons could not be loaded')
      }

      return Array.isArray(result.coupons) ? result.coupons : []
    })

    couponLoadRequestRef.current = {
      key: requestKey,
      promise: request,
    }

    try {
      setCoupons(await request)
    } catch {
      console.warn('Billing coupons could not be loaded.')
      setCouponErrorMessage('Billing coupons could not be loaded right now.')
    } finally {
      if (couponLoadRequestRef.current?.promise === request) {
        couponLoadRequestRef.current = null
      }
      setIsCouponLoading(false)
    }
  }, [session?.access_token, user])

  useEffect(() => {
    void loadCoupons()
  }, [loadCoupons])

  const loadTesterCodes = useCallback(async () => {
    if (!session?.access_token || !isSuperAdmin(user)) {
      return
    }

    const requestKey = `${user?.id || user?.email || 'platform-admin'}:${session.access_token}`
    const existingRequest = testerCodeLoadRequestRef.current

    if (existingRequest?.key === requestKey) {
      return existingRequest.promise.catch(() => undefined)
    }

    const request = getSharedBillingLoadRequest(`tester-codes:${requestKey}`, async () => {
      setTesterCodeErrorMessage('')

      const response = await fetch('/.netlify/functions/manage-tester-access-codes', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Tester access codes could not be loaded')
      }

      return Array.isArray(result.codes) ? result.codes : []
    })

    testerCodeLoadRequestRef.current = {
      key: requestKey,
      promise: request,
    }

    try {
      setTesterCodes(await request)
    } catch {
      console.warn('Tester access codes could not be loaded.')
      setTesterCodeErrorMessage('Tester access codes could not be loaded right now.')
    } finally {
      if (testerCodeLoadRequestRef.current?.promise === request) {
        testerCodeLoadRequestRef.current = null
      }
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
    setTesterCodeErrorMessage('')
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
      console.warn('Tester access code creation failed.')
      setTesterCodeErrorMessage(error.message || 'Tester access code could not be created.')
    } finally {
      setIsSavingTesterCode(false)
    }
  }

  const handleToggleTesterCode = async (code) => {
    if (!session?.access_token || !code.id) {
      return
    }

    setUpdatingTesterCodeId(code.id)
    setTesterCodeErrorMessage('')
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
      console.warn('Tester access code update failed.')
      setTesterCodeErrorMessage(error.message || 'Tester access code could not be updated.')
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
    setCouponErrorMessage('')
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
      console.warn('Coupon creation failed.')
      setCouponErrorMessage(error.message || 'Coupon could not be created.')
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
    setCouponErrorMessage('')
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
      console.warn('Coupon deletion failed.')
      setCouponErrorMessage(error.message || 'Coupon could not be deleted.')
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
    setCouponErrorMessage('')
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
      console.warn('Live promotion update failed.')
      setCouponErrorMessage(error.message || 'Live promotion could not be updated.')
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
    <div className="platform-admin-theme space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Billing"
        title="Billing options"
        description="Create promotion codes and manage platform level billing options."
      />

      {couponErrorMessage ? (
        <NoticeBanner
          title="Stripe coupon data unavailable"
          message={couponErrorMessage}
        />
      ) : null}

      {testerCodeErrorMessage ? (
        <NoticeBanner
          title="Tester access data unavailable"
          message={testerCodeErrorMessage}
        />
      ) : null}

      {successMessage ? (
        <BillingSuccessBanner message={successMessage} />
      ) : null}

      <BillingHeroAndStats
        billingStats={billingStats}
        isLoading={isCouponLoading}
        hasStripeDataError={Boolean(couponErrorMessage)}
      />

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
        isLoading={isCouponLoading}
        livePromotionId={livePromotionId}
        onDeleteCoupon={(coupon) => void handleDeleteCoupon(coupon)}
        onSetLivePromotion={(coupon) => void handleSetLivePromotion(coupon)}
        sortedCoupons={sortedCoupons}
      />
    </div>
  )
}
