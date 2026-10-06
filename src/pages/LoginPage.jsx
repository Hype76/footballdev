import { useEffect, useRef, useState } from 'react'
import { LoginAuthPanel } from '../components/login/LoginAuthPanel.jsx'
import { WebsiteAuthHeader } from '../components/login/WebsiteAuthHeader.jsx'
import '../components/login/website-auth.css'
import { usePublicThemeScope } from '../components/login/PublicThemeScope.jsx'
import { useAuth } from '../lib/auth.js'
import { clearAuthRedirectError, readAuthRedirectError } from '../lib/auth-redirect-error.js'
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoEmail } from '../lib/demo.js'
import {
  buildParentInviteAcceptancePath,
  getParentInviteToken,
  rememberParentAccessIntent,
} from '../lib/parent-auth-intent.js'
import {
  getPublicFreeSignupPlanKey,
  PUBLIC_SIGNUP_ACCEPTED_MESSAGE,
} from '../lib/public-signup.js'
import { getWorkspaceScope } from '../lib/workspace-scope.js'

const initialFormData = {
  email: '',
  password: '',
  clubName: '',
  accessCode: '',
  planKey: 'matchday',
}

const testPlanByName = {
  Matchday: 'matchday',
  Team: 'team',
  Club: 'club',
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

  if (normalizedMessage.includes('email not confirmed')) {
    return 'Email not confirmed. Open the newest Football Player confirmation email for this account, then try again.'
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

export function LoginPage({ role = 'coach' }) {
  usePublicThemeScope()

  const { authError, resetPassword, session, signInWithPassword, signUpParentAccount, signUpWithClub } = useAuth()
  const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
  const signupBoxRef = useRef(null)
  const parentInviteRedirectStartedRef = useRef(false)
  const demoSubmitLockRef = useRef(false)
  const submitLockRef = useRef(false)
  const [mode, setMode] = useState(role === 'parent' ? 'parent-login' : 'login')
  const [formData, setFormData] = useState(initialFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [localMessage, setLocalMessage] = useState('')
  const [localError, setLocalError] = useState(readAuthRedirectError)
  const [parentInviteToken, setParentInviteToken] = useState(() => getParentInviteToken(window.location.search))

  useEffect(() => {
    clearAuthRedirectError()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkoutStatus = params.get('checkout')
    const nextParentInviteToken = getParentInviteToken(window.location.search)
    const requestedLoginMode = getRequestedLoginMode(params)
    const publicFreePlanKey = getPublicFreeSignupPlanKey(params.get('plan'))
    const selectedPlanName = String(params.get('plan') ?? '').trim()
    const selectedPlanKey = testPlanByName[selectedPlanName]

    if (requestedLoginMode === 'parent-login') {
      rememberParentAccessIntent()
    }

    if (nextParentInviteToken) {
      setParentInviteToken(nextParentInviteToken)
      setMode('parent-login')
      setLocalMessage('Log in or create a parent account to accept your player link.')

      if (session?.user && !parentInviteRedirectStartedRef.current) {
        parentInviteRedirectStartedRef.current = true
        window.location.replace(buildParentInviteAcceptancePath(nextParentInviteToken))
        return
      }
    } else if (requestedLoginMode) {
      setMode(requestedLoginMode)
    } else {
      setMode(role === 'parent' ? 'parent-login' : 'login')
    }

    if (publicFreePlanKey) {
      setMode('signup')
      setFormData((current) => ({
        ...current,
        planKey: publicFreePlanKey,
      }))
      setLocalMessage('Free Matchday selected. Create your team to continue.')
    }

    if (checkoutStatus === 'success') {
      setMode('signup')
      if (selectedPlanKey) {
        setFormData((current) => ({
          ...current,
          planKey: selectedPlanKey,
        }))
      }
      const selectedScope = getWorkspaceScope(selectedPlanKey)
      setLocalMessage(`Checkout completed. Create your ${selectedScope.workspaceLabel} to continue.`)
    }

    if (checkoutStatus === 'cancelled') {
      setLocalMessage('Checkout was cancelled. You can choose a plan again when ready.')
    }

    if (paymentsDisabled) {
      if (selectedPlanKey) {
        setMode('signup')
        setFormData((current) => ({
          ...current,
          planKey: selectedPlanKey,
        }))
        setLocalMessage(`${selectedPlanName} test access selected. Payments are disabled on staging.`)
      }
    }
  }, [paymentsDisabled, session?.user, role])

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

  const handleDemoLogin = async () => {
    if (demoSubmitLockRef.current) {
      return
    }

    demoSubmitLockRef.current = true
    setIsSubmitting(true)
    setLocalError('')
    setLocalMessage('Signing in to the read-only demo workspace...')

    try {
      await signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      })
      setLocalMessage('Demo workspace ready. Public maintenance is not available from the browser.')
      window.location.replace('/')
    } catch (error) {
      setLocalError(error.message || 'Demo account could not be opened.')
      setLocalMessage('')
    } finally {
      demoSubmitLockRef.current = false
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
            : PUBLIC_SIGNUP_ACCEPTED_MESSAGE)
        } else if (signupResult?.message) {
          setLocalMessage(signupResult.message)
        } else if (parentInviteToken) {
          parentInviteRedirectStartedRef.current = true
          window.location.assign(buildParentInviteAcceptancePath(parentInviteToken))
        }
      } else {
        if (isDemoEmail(formData.email)) {
          throw new Error('Demo access is not available from this sign-in form.')
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
      await resetPassword(formData.email, role === 'parent' || parentInviteToken || mode === 'parent-login' ? 'parent' : 'coach')
      setLocalMessage('Password reset email sent if that account exists.')
    } catch (error) {
      console.error(error)
      setLocalError(error.message || 'Password reset failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const parentAccess = role === 'parent' || Boolean(parentInviteToken) || mode === 'parent-login'
  return (
    <div className="website-auth">
      <WebsiteAuthHeader />
      <main className="website-auth-main">
        <section className="website-auth-intro">
          <p className="website-auth-eyebrow">{parentAccess ? 'Parent access' : mode === 'signup' ? 'Get started' : 'Coach and club access'}</p>
          <h1>{parentAccess ? 'Stay close to the game.' : mode === 'signup' ? 'Your team starts here.' : 'Back to your football.'}</h1>
          <p>{parentAccess ? 'Fixtures, availability and match updates for your linked player, all in one place.' : 'Manage your team, prepare for match day and keep everyone connected.'}</p>
          <figure className="website-auth-image">
            <img src={parentAccess ? '/marketing-v70/assets/parent-matchday.png' : '/marketing-v70/assets/coach-light.png'} alt={parentAccess ? 'Parent fixture and player availability preview' : 'Coach team overview preview'} />
            <figcaption>Football Player {parentAccess ? 'Parent' : 'Coach'} app</figcaption>
          </figure>
          <a href={parentAccess ? '/sign-in/coach' : '/sign-in/parent'}>{parentAccess ? 'Coach or club admin? Sign in here' : 'Parent? Sign in here'}</a>
        </section>
        <div className="website-auth-form-column">
            <LoginAuthPanel
              authError={authError}
              formData={formData}
              isPasswordVisible={isPasswordVisible}
              isSubmitting={isSubmitting}
              localError={localError}
              localMessage={localMessage}
              logo="/marketing-v70/assets/fp-logo.png"
              mode={mode}
              role={parentAccess ? 'parent' : 'coach'}
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
      </main>
      <footer className="website-auth-footer"><span>Football Player · Jeluma Labs</span><a href="/gdpr">Privacy and GDPR</a></footer>
    </div>
  )
}
