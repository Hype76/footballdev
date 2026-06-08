import { useEffect, useRef, useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginAuthPanel } from '../components/login/LoginAuthPanel.jsx'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { publicImageOverlayStyle, usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'
import { useAuth } from '../lib/auth.js'
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail } from '../lib/demo.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
  accessCode: '',
  planKey: 'small_club',
}

const testPlanByName = {
  Individual: 'individual',
  'Single Team': 'single_team',
  'Small Club': 'small_club',
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

export function LoginPage() {
  usePublicThemeScope()

  const { authError, resetPassword, signInWithPassword, signUpParentAccount, signUpWithClub } = useAuth()
  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const signupBoxRef = useRef(null)
  const submitLockRef = useRef(false)
  const [mode, setMode] = useState('login')
  const [formData, setFormData] = useState(initialFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
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
  }, [paymentsDisabled])

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
          window.location.assign(`/parent-invite/${parentInviteToken}`)
        }
      } else {
        if (isDemoEmail(formData.email)) {
          throw new Error('Use the Open demo account button for demo access.')
        }

        await signInWithPassword({
          email: formData.email.trim(),
          password: formData.password,
          preferredAccessMode: mode === 'parent-login' || parentInviteToken ? 'parent' : '',
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
    <main className="min-h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      <div className="fixed inset-0">
        <img src={landingHeroImage} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0" style={publicImageOverlayStyle} />
      </div>

      <div className="relative flex min-h-screen w-full flex-col">
        <LoginHeader logo={fallbackLogo} />

        <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-4 py-8 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:px-8 lg:py-10">
          <section>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Football club workspace</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black leading-[1.06] tracking-tight text-[#101828] sm:text-4xl xl:text-5xl">
              Run the football week from one practical club system.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55] sm:text-lg sm:leading-8">
              Manage players, teams, availability, match day, parent communication, and development records without scattering work across chats and spreadsheets.
            </p>

            <div className="mt-7 grid gap-3 md:grid-cols-3">
              {[
                ['Set up first', 'Create the club, first team, staff access, players, and parent links before inviting wider use.'],
                ['Use real records', 'Every workflow starts from football data the club already understands.'],
                ['Keep roles clear', 'Club admins, team staff, and parents only see the actions their access allows.'],
              ].map(([title, copy]) => (
                <article key={title} className="rounded-lg border border-[#d7e5dc] bg-white/95 p-4 shadow-sm shadow-[#047857]/10 backdrop-blur">
                  <p className="text-sm font-black text-[#101828]">{title}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{copy}</p>
                </article>
              ))}
            </div>

            <div className="mt-7 grid gap-3 rounded-lg border border-[#d7e5dc] bg-[#ecfdf5]/95 p-4 shadow-sm shadow-[#047857]/10 backdrop-blur sm:grid-cols-[0.9fr_1.1fr] sm:p-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">First useful action</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                  Log in, choose the club or parent route, then open the team, player, session, or parent workflow you need.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-black text-[#101828] sm:grid-cols-4">
                {['Club', 'Team', 'Players', 'Parents'].map((item) => (
                  <span key={item} className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-center">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </section>

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
    </main>
  )
}
