import { useEffect, useRef, useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginAuthPanel } from '../components/login/LoginAuthPanel.jsx'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'
import { useAuth } from '../lib/auth.js'
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail } from '../lib/demo.js'
import {
  buildParentInviteAcceptancePath,
  getParentInviteToken,
  rememberParentAccessIntent,
} from '../lib/parent-auth-intent.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
  accessCode: '',
  planKey: 'small_club',
}

const testPlanByName = {
  Individual: 'individual',
  'Individual Coach - Free': 'individual',
  'Individual Coach': 'individual',
  'Single Team': 'single_team',
  'Small Club': 'small_club',
  'Development Club': 'development_club',
  'Large Club': 'large_club',
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

function getRequestedLoginMode(params) {
  const requestedMode = String(params.get('tab') ?? params.get('mode') ?? params.get('access') ?? '').trim().toLowerCase()

  if (requestedMode === 'parent' || requestedMode === 'parent-login') {
    return 'parent-login'
  }

  if (requestedMode === 'signup' || requestedMode === 'sign-up') {
    return 'signup'
  }

  if (requestedMode === 'club' || requestedMode === 'team' || requestedMode === 'login') {
    return 'login'
  }

  return ''
}

export function LoginPage() {
  usePublicThemeScope()

  const { authError, resetPassword, session, signInWithPassword, signUpParentAccount, signUpWithClub } = useAuth()
  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const signupBoxRef = useRef(null)
  const parentInviteRedirectStartedRef = useRef(false)
  const submitLockRef = useRef(false)
  const [mode, setMode] = useState('login')
  const [formData, setFormData] = useState(initialFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [localMessage, setLocalMessage] = useState('')
  const [localError, setLocalError] = useState('')
  const [parentInviteToken, setParentInviteToken] = useState(() => getParentInviteToken(window.location.search))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkoutStatus = params.get('checkout')
    const nextParentInviteToken = getParentInviteToken(window.location.search)
    const requestedLoginMode = getRequestedLoginMode(params)

    if (requestedLoginMode === 'parent-login') {
      rememberParentAccessIntent()
    }

    if (nextParentInviteToken) {
      setParentInviteToken(nextParentInviteToken)
      setMode('parent-login')
      setLocalMessage('Log in or create a parent account to accept your child link.')

      if (session?.user && !parentInviteRedirectStartedRef.current) {
        parentInviteRedirectStartedRef.current = true
        window.location.replace(buildParentInviteAcceptancePath(nextParentInviteToken))
        return
      }
    } else if (requestedLoginMode) {
      setMode(requestedLoginMode)
    }

    if (checkoutStatus === 'success') {
      setMode('signup')
      setLocalMessage('Checkout completed. Create your club account to continue.')
    }

    if (checkoutStatus === 'cancelled') {
      setLocalMessage('Checkout was cancelled. You can choose a plan again when ready.')
    }

    if (paymentsDisabled) {
      const selectedPlanName = String(params.get('plan') ?? '').trim()
      const selectedPlanKey = testPlanByName[selectedPlanName]

      if (selectedPlanKey) {
        setMode('signup')
        setFormData((current) => ({
          ...current,
          planKey: selectedPlanKey,
        }))
        setLocalMessage(`${selectedPlanName} test access selected. Payments are disabled on staging.`)
      }
    }
  }, [paymentsDisabled, session?.user])

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

  const prepareDemoAccount = async () => {
    const response = await fetch('/.netlify/functions/reset-demo-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'landing_page' }),
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok || result.success === false) {
      const isLocalPreview = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

      if (isLocalPreview && response.status === 404) {
        return
      }

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
            planKey: formData.planKey,
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
        } else if (signupResult?.message) {
          setLocalMessage(signupResult.message)
        } else if (parentInviteToken) {
          parentInviteRedirectStartedRef.current = true
          window.location.assign(buildParentInviteAcceptancePath(parentInviteToken))
        }
      } else {
        if (isDemoEmail(formData.email)) {
          throw new Error('Use the Open demo account button for demo access.')
        }

        await signInWithPassword({
          email: formData.email.trim(),
          password: formData.password,
          preferredAccessMode: mode === 'parent-login' || parentInviteToken ? 'parent' : 'team',
        })

        if (parentInviteToken) {
          if (!parentInviteRedirectStartedRef.current) {
            parentInviteRedirectStartedRef.current = true
            window.location.assign(buildParentInviteAcceptancePath(parentInviteToken))
          }
        } else if (mode === 'parent-login') {
          window.location.assign('/parent-portal')
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
    <main className="min-h-screen overflow-hidden bg-[#06110a] text-white">
      <div className="fixed inset-0">
        <img src={landingHeroImage} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[#06110a]/78" />
      </div>

      <div className="relative flex min-h-screen w-full flex-col">
        <LoginHeader logo={fallbackLogo} />

        <div className="mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 py-7 pb-[max(5rem,env(safe-area-inset-bottom))] sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] lg:items-center lg:px-8 lg:py-10">
          <section className="order-2 max-w-2xl lg:order-1">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#c6ff1a]">Sign in</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-5xl xl:text-6xl">
              Welcome back to Football Player.
            </h1>
            <p className="mt-5 max-w-xl text-base font-semibold leading-7 text-white/76 sm:text-lg sm:leading-8">
              Sign in to manage training, match day, parent updates, and player records from the right club or team workspace.
            </p>

            <div className="mt-7 grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                'Training and fixtures stay connected',
                'Parent updates come from saved records',
                'Player history stays with the player',
              ].map((item) => (
                <div key={item} className="border-t border-white/18 pt-3">
                  <span className="mb-3 block h-1.5 w-8 rounded-full bg-[#c6ff1a]" />
                  <p className="text-sm font-black leading-5 text-white">{item}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="order-1 lg:order-2">
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
              paymentsDisabled={paymentsDisabled}
              signupBoxRef={signupBoxRef}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
