import { useEffect, useRef, useState } from 'react'
import fallbackLogo from '../assets/player-feedback-logo.png'
import landingHeroImage from '../assets/landing-hero-football-club.png'
import { LoginAuthPanel } from '../components/login/LoginAuthPanel.jsx'
import { LoginHeader } from '../components/login/LoginHeader.jsx'
import { LoginHeroContent } from '../components/login/LoginHeroContent.jsx'
import { useAuth } from '../lib/auth.js'
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail } from '../lib/demo.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
  accessCode: '',
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
    <main className="min-h-screen overflow-hidden bg-[#061009] text-white">
      <div className="fixed inset-0">
        <img src={landingHeroImage} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#061009] via-[#061009]/82 to-[#061009]/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#061009] via-transparent to-[#061009]/35" />
      </div>

      <div className="relative flex min-h-screen w-full flex-col">
        <LoginHeader logo={fallbackLogo} />

        <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:py-10">
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
      </div>
    </main>
  )
}
