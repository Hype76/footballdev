import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useAuth } from '../lib/auth.js'

function getFriendlyLoginError(error) {
  const rawMessage = String(error?.message ?? '').trim()
  const normalizedMessage = rawMessage.toLowerCase()

  if (normalizedMessage.includes('invalid login credentials')) {
    return 'Email or password is incorrect.'
  }

  if (normalizedMessage.includes('email not confirmed')) {
    return 'Confirm your email address first, then log in here.'
  }

  return rawMessage || 'Parent login failed.'
}

export function ParentLoginPage() {
  const { resetPassword, session, signInWithPassword, signOut } = useAuth()
  const submitLockRef = useRef(false)
  const [email, setEmail] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isSigningOutConfirmedSession, setIsSigningOutConfirmedSession] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [parentInviteToken, setParentInviteToken] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextParentInviteToken = String(params.get('parentInvite') ?? '').trim()
    const confirmed = params.get('confirmed') === '1'
    const created = params.get('created') === '1'

    setParentInviteToken(nextParentInviteToken)

    if (confirmed) {
      setMessage('Email confirmed. Log in to open parent access.')
    } else if (created) {
      setMessage('Parent account created. Check your email to confirm it before logging in.')
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const params = new URLSearchParams(window.location.search)
    const confirmed = params.get('confirmed') === '1'
    const created = params.get('created') === '1'

    const clearConfirmationSession = async () => {
      if ((!confirmed && !created) || !session?.user) {
        return
      }

      setIsSigningOutConfirmedSession(true)
      try {
        await signOut()
      } catch (error) {
        console.error(error)
      } finally {
        if (isMounted) {
          setIsSigningOutConfirmedSession(false)
        }
      }
    }

    void clearConfirmationSession()

    return () => {
      isMounted = false
    }
  }, [session?.user, signOut])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (submitLockRef.current) {
      return
    }

    submitLockRef.current = true
    setIsSubmitting(true)
    setErrorMessage('')
    setMessage('')

    try {
      await signInWithPassword({
        email: email.trim(),
        password,
      })

      if (parentInviteToken) {
        window.location.assign(`/parent-invite/${parentInviteToken}`)
      } else {
        window.location.assign('/parent-portal')
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(getFriendlyLoginError(error))
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    setIsSubmitting(true)
    setErrorMessage('')
    setMessage('')

    try {
      await resetPassword(email)
      setMessage('Password reset email sent if that account exists.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Password reset failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030603] px-4 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[#071008]" />
      <div className="relative w-full max-w-md rounded-lg border border-white/10 bg-[#0b130d]/95 p-5 shadow-2xl shadow-black/40 sm:p-6">
        <img src={fallbackLogo} alt="Player Feedback" className="h-16 w-16 rounded-lg border border-[#d8ff2f]/25 bg-black/40 object-contain p-1" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-[#d8ff2f]">Parent Portal</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Parent login</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Log in with the parent account you confirmed by email.
        </p>

        {isSigningOutConfirmedSession ? (
          <p className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            Preparing parent login...
          </p>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setErrorMessage('')
                setMessage('')
              }}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Password</span>
            <div className="flex rounded-lg border border-white/10 bg-[#101b12] focus-within:border-[#d8ff2f]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setErrorMessage('')
                  setMessage('')
                }}
                required
                autoComplete="current-password"
                placeholder="Enter password"
                className="min-h-12 min-w-0 flex-1 rounded-l-lg bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((current) => !current)}
                className="min-h-12 rounded-r-lg px-4 py-3 text-sm font-bold text-[#d8ff2f]"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {errorMessage ? <NoticeBanner title="Parent login not completed" message={errorMessage} /> : null}

          {message ? (
            <div className="rounded-lg border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-3 text-sm font-semibold text-[#d8ff2f]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || isSigningOutConfirmedSession}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Logging in...' : 'Login'}
          </button>

          <button
            type="button"
            disabled={isSubmitting || isSigningOutConfirmedSession}
            onClick={handlePasswordReset}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Forgot password
          </button>

          {parentInviteToken ? (
            <Link
              to={`/parent-invite/${parentInviteToken}`}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d8ff2f]/30 bg-[#d8ff2f]/10 px-5 py-3 text-sm font-bold text-[#d8ff2f] transition hover:bg-[#d8ff2f]/15"
            >
              Back to parent invite
            </Link>
          ) : null}
        </form>
      </div>
    </main>
  )
}
