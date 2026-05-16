import { useEffect, useRef, useState } from 'react'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { LoginAuthPanel } from '../components/login/LoginAuthPanel.jsx'
import { DemoRequestModal } from '../components/login/DemoRequestModal.jsx'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { LoginHeroContent } from '../components/login/LoginHeroContent.jsx'
import { LoginMarketingAndPricing } from '../components/login/LoginMarketingAndPricing.jsx'
import { useAuth } from '../lib/auth.js'
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail } from '../lib/demo.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
  accessCode: '',
}

const initialDemoFormData = {
  name: '',
  email: '',
  phone: '',
  clubTeamName: '',
}

function getFriendlyAuthErrorMessage(error, mode) {
  const rawMessage = String(error?.message ?? '').trim()
  const normalizedMessage = rawMessage.toLowerCase()

  if (normalizedMessage.includes('email rate limit') || normalizedMessage.includes('rate limit')) {
    return mode === 'signup'
      ? 'Too many sign-up emails have been sent. Please wait a few minutes, then try again, or log in if you already created the account.'
      : 'Too many emails have been sent. Please wait a few minutes, then try again.'
  }

  if (normalizedMessage.includes('already registered') || normalizedMessage.includes('already exists')) {
    return 'An account already exists for this email. Use Login, or use Forgot password if you need access.'
  }

  return rawMessage || 'Authentication failed.'
}

export function LoginPage() {
  const { authError, resetPassword, signInWithPassword, signUpParentAccount, signUpWithClub } = useAuth()
  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const signupBoxRef = useRef(null)
  const submitLockRef = useRef(false)
  const [mode, setMode] = useState('login')
  const [formData, setFormData] = useState(initialFormData)
  const [demoPlan, setDemoPlan] = useState(null)
  const [demoFormData, setDemoFormData] = useState(initialDemoFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [livePromotion, setLivePromotion] = useState(null)
  const [localMessage, setLocalMessage] = useState('')
  const [localError, setLocalError] = useState('')
  const [parentInviteToken, setParentInviteToken] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkoutStatus = params.get('checkout')
    const nextParentInviteToken = String(params.get('parentInvite') ?? '').trim()

    if (nextParentInviteToken) {
      setParentInviteToken(nextParentInviteToken)
      setLocalMessage('Log in or create a parent account to accept your child link.')
    }

    if (checkoutStatus === 'success') {
      setMode('signup')
      setLocalMessage('Checkout completed. Create your club account to continue.')
    }

    if (checkoutStatus === 'cancelled') {
      setLocalMessage('Checkout was cancelled. You can choose a plan again when ready.')
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadLivePromotion = async () => {
      try {
        const response = await fetch('/.netlify/functions/get-live-promotion')
        const result = await response.json().catch(() => ({}))

        if (isMounted && response.ok && result.success !== false) {
          setLivePromotion(result.promotion ?? null)
        }
      } catch (error) {
        console.error(error)
      }
    }

    void loadLivePromotion()

    return () => {
      isMounted = false
    }
  }, [])

  const handleChange = (event) => {
    const { name, value } = event.target
    setLocalError('')
    setLocalMessage('')
    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleModeChange = (nextMode) => {
    setMode(nextMode)
    setLocalError('')
    setLocalMessage('')
  }

  const handleDemoChange = (event) => {
    const { name, value } = event.target
    setLocalError('')
    setLocalMessage('')
    setDemoFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleDemoSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('')

    try {
      const response = await fetch('/.netlify/functions/send-demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...demoFormData,
          planName: demoPlan?.name || '',
          billingCycle,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Demo request could not be sent.')
      }

      setDemoPlan(null)
      setDemoFormData(initialDemoFormData)
      setLocalMessage('Demo request sent. We will be in touch shortly.')
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Demo request could not be sent.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChoosePlan = async (plan) => {
    setLocalError('')
    setLocalMessage('')

    if (plan.name === 'Individual') {
      setMode('signup')
      setLocalMessage('Create your free account to start.')
      window.setTimeout(() => {
        signupBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 0)
      return
    }

    if (plan.name === 'Large Club') {
      if (paymentsDisabled) {
        setMode('signup')
        setLocalMessage('Create a test club account. Payments are disabled on this test site.')
        window.setTimeout(() => {
          signupBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 0)
        return
      }

      setDemoPlan(plan)
      return
    }

    if (paymentsDisabled) {
      setMode('signup')
      setLocalMessage('Create a test club account. Payments are disabled on this test site.')
      window.setTimeout(() => {
        signupBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 0)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: plan.name,
          billingCycle,
          customerEmail: formData.email.trim() || undefined,
          clubName: formData.clubName.trim() || undefined,
          livePromotionCodeId: livePromotion?.promotionCodeId || undefined,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false || !result.url) {
        throw new Error(result.message || 'Checkout could not be started.')
      }

      window.location.assign(result.url)
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Checkout could not be started.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const prepareDemoAccount = async () => {
    const response = await fetch('/.netlify/functions/reset-demo-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'landing_page' }),
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok || result.success === false) {
      throw new Error(result.message || 'Demo account could not be opened.')
    }
  }

  const handleDemoLogin = async () => {
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('Preparing demo workspace...')

    try {
      await prepareDemoAccount()
      await signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      })
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Demo account could not be opened.')
      setLocalMessage('')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (submitLockRef.current) {
      return
    }

    submitLockRef.current = true
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('')

    try {
      if (mode === 'signup') {
        const signupResult = parentInviteToken
          ? await signUpParentAccount({
            email: formData.email.trim(),
            password: formData.password,
            inviteToken: parentInviteToken,
          })
          : await signUpWithClub({
            email: formData.email.trim(),
            password: formData.password,
            clubName: formData.clubName.trim(),
            accessCode: formData.accessCode.trim(),
          })

        if (signupResult?.needsEmailVerification) {
          setMode('login')
          setFormData((current) => ({
            ...current,
            password: '',
          }))
          setLocalMessage(parentInviteToken
            ? 'Parent account created. Please check your email to verify it, then open the parent invite link again.'
            : 'Account created. Please check your email to verify your account before logging in.')
        } else if (parentInviteToken) {
          window.location.assign(`/parent-invite/${parentInviteToken}`)
        }
      } else {
        if (isDemoEmail(formData.email)) {
          throw new Error('Use the Open Demo Account button for demo access.')
        }

        await signInWithPassword({
          email: formData.email.trim(),
          password: formData.password,
        })

        if (parentInviteToken) {
          window.location.assign(`/parent-invite/${parentInviteToken}`)
        }
      }
    } catch (error) {
      console.error(error)
      setLocalError(getFriendlyAuthErrorMessage(error, mode))
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('')

    try {
      await resetPassword(formData.email)
      setLocalMessage('Password reset email sent if that account exists.')
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Password reset failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#030603] text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-10%] top-[-20%] h-[560px] w-[560px] rounded-full bg-[#d8ff2f]/18 blur-[100px]" />
        <div className="absolute bottom-[-25%] right-[-10%] h-[600px] w-[600px] rounded-full bg-[#1f8a47]/22 blur-[110px]" />
        <div className="absolute inset-0 bg-[#071008]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <LoginHeader logo={fallbackLogo} />

        <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[1.08fr_0.92fr] lg:py-10">
          <LoginHeroContent />

          <LoginAuthPanel
            authError={authError}
            formData={formData}
            isPasswordVisible={isPasswordVisible}
            isSubmitting={isSubmitting}
            localError={localError}
            localMessage={localMessage}
            logo={fallbackLogo}
            mode={mode}
            onChange={handleChange}
            onDemoLogin={handleDemoLogin}
            onModeChange={handleModeChange}
            onPasswordReset={handlePasswordReset}
            onSubmit={handleSubmit}
            onTogglePasswordVisibility={() => setIsPasswordVisible((current) => !current)}
            parentInviteMode={Boolean(parentInviteToken)}
            signupBoxRef={signupBoxRef}
          />
        </div>

        <LoginMarketingAndPricing
          billingCycle={billingCycle}
          isSubmitting={isSubmitting}
          livePromotion={livePromotion}
          localError={localError}
          localMessage={localMessage}
          onBillingCycleChange={setBillingCycle}
          onChoosePlan={handleChoosePlan}
          onRequestDemo={setDemoPlan}
          paymentsDisabled={paymentsDisabled}
        />
      </div>

      <DemoRequestModal
        demoFormData={demoFormData}
        demoPlan={demoPlan}
        isSubmitting={isSubmitting}
        onCancel={() => {
          setDemoPlan(null)
          setDemoFormData(initialDemoFormData)
        }}
        onChange={handleDemoChange}
        onSubmit={handleDemoSubmit}
      />
    </main>
  )
}
