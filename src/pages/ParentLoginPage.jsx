import { useEffect, useRef, useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { buildParentAppUrl, isParentPortalHost } from '../lib/app-origins.js'
import { useAuth } from '../lib/auth.js'
import { supabase } from '../lib/supabase-client.js'

const SELECTED_ACCESS_MODE_STORAGE_KEY = 'selected-access-mode'

function getFriendlyLoginError(error) {
  const rawMessage = String(error?.message ?? '').trim()
  const normalizedMessage = rawMessage.toLowerCase()

  if (normalizedMessage.includes('invalid login credentials')) {
    return 'Email or password is incorrect.'
  }

  if (normalizedMessage.includes('email not confirmed')) {
    return 'Confirm your email address first, then log in here.'
  }

  if (normalizedMessage.includes('auth session missing') || normalizedMessage.includes('session')) {
    return 'Email or password is incorrect.'
  }

  return 'Parent login could not be completed. Check your details and try again.'
}

export function ParentLoginPage() {
  const { resetPassword, session, signInWithPassword, signOut } = useAuth()
  const [initialParams] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      parentInviteToken: String(params.get('parentInvite') ?? '').trim(),
      confirmed: params.get('confirmed') === '1',
      created: params.get('created') === '1',
    }
  })
  const clearSessionAttemptedRef = useRef(false)
  const submitLockRef = useRef(false)
  const [email, setEmail] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isSigningOutConfirmedSession, setIsSigningOutConfirmedSession] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState(() => {
    if (initialParams.confirmed) {
      return 'Email confirmed. Log in to open parent access.'
    }

    if (initialParams.created) {
      return 'Parent account created. Check your email to confirm it before logging in.'
    }

    return ''
  })
  const [parentInviteToken] = useState(initialParams.parentInviteToken)
  const [password, setPassword] = useState('')
  const shouldClearExistingSession = initialParams.confirmed || initialParams.created
  const isParentHost = isParentPortalHost()

  useEffect(() => {
    if (!isParentHost) {
      return undefined
    }

    const rawHash = String(window.location.hash ?? '').replace(/^#/, '')

    if (!rawHash) {
      return undefined
    }

    const hashParams = new URLSearchParams(rawHash)

    if (hashParams.get('type') !== 'parent_portal_login') {
      return undefined
    }

    const accessToken = hashParams.get('access_token') || ''
    const refreshToken = hashParams.get('refresh_token') || ''
    let isMounted = true

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

    if (!accessToken || !refreshToken) {
      setErrorMessage('Parent login session was missing. Log in again.')
      return undefined
    }

    const openParentSession = async () => {
      setIsSubmitting(true)
      setErrorMessage('')
      setMessage('Opening parent portal...')
      window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, 'parent')

      try {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (error) {
          throw error
        }

        window.location.assign(buildParentAppUrl('/parent-portal'))
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(getFriendlyLoginError(error))
          setMessage('')
        }
      } finally {
        if (isMounted) {
          setIsSubmitting(false)
        }
      }
    }

    void openParentSession()

    return () => {
      isMounted = false
    }
  }, [isParentHost])

  useEffect(() => {
    if (isParentHost) {
      return
    }

    window.location.replace(buildParentAppUrl(`${window.location.pathname}${window.location.search}`))
  }, [isParentHost])

  useEffect(() => {
    let isMounted = true

    const clearConfirmationSession = async () => {
      if (!isParentHost || !shouldClearExistingSession || !session?.user || clearSessionAttemptedRef.current) {
        return
      }

      clearSessionAttemptedRef.current = true
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
  }, [isParentHost, session?.user, shouldClearExistingSession, signOut])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!isParentHost) {
      window.location.replace(buildParentAppUrl(`${window.location.pathname}${window.location.search}`))
      return
    }

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
        preferredAccessMode: 'parent',
      })

      if (parentInviteToken) {
        window.location.assign(buildParentAppUrl(`/parent-invite/${parentInviteToken}?accept=1`))
      } else {
        window.location.assign(buildParentAppUrl('/parent-portal'))
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
    if (!isParentHost) {
      window.location.replace(buildParentAppUrl(`${window.location.pathname}${window.location.search}`))
      return
    }

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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-950">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]" />
      <div className="relative w-full max-w-md rounded-md border border-slate-200 bg-white p-5 shadow-lg shadow-slate-950/10 sm:p-6">
        <img src={fallbackLogo} alt="Football Player" className="h-16 w-16 rounded-md border border-slate-200 bg-slate-950 object-contain p-1" />
        <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Parent Portal</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight">Parent login</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          Log in with the parent account you confirmed by email.
        </p>

        {isSigningOutConfirmedSession || (shouldClearExistingSession && session?.user) ? (
          <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            Preparing parent login...
          </p>
        ) : null}

        {isSigningOutConfirmedSession || (shouldClearExistingSession && session?.user) ? null : (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Email</span>
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
              className="min-h-12 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Password</span>
            <div className="flex rounded-md border border-slate-200 bg-slate-50 focus-within:border-emerald-600 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100">
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
                className="min-h-12 min-w-0 flex-1 rounded-l-md bg-transparent px-4 py-3 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((current) => !current)}
                className="min-h-12 rounded-r-md px-4 py-3 text-sm font-bold text-emerald-700"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {errorMessage ? <NoticeBanner title="Parent login not completed" message={errorMessage} /> : null}

          {message ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || isSigningOutConfirmedSession}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Logging in...' : 'Login'}
          </button>

          <button
            type="button"
            disabled={isSubmitting || isSigningOutConfirmedSession}
            onClick={handlePasswordReset}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Forgot password
          </button>

          {parentInviteToken ? (
            <a
              href={buildParentAppUrl(`/parent-invite/${parentInviteToken}`)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100"
            >
              Back to parent invite
            </a>
          ) : null}
        </form>
        )}
      </div>
    </main>
  )
}
