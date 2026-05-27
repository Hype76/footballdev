import { useEffect, useRef, useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { buildParentAppUrl, getParentAppOrigin, isParentPortalHost } from '../lib/app-origins.js'
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
  const parentAppOrigin = getParentAppOrigin()
  const canRenderOnCurrentHost = parentAppOrigin === window.location.origin

  useEffect(() => {
    if (!isParentHost && !canRenderOnCurrentHost) {
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
      setMessage('Opening family portal...')
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
  }, [canRenderOnCurrentHost, isParentHost])

  useEffect(() => {
    if (isParentHost || canRenderOnCurrentHost) {
      return
    }

    window.location.replace(buildParentAppUrl(`${window.location.pathname}${window.location.search}`))
  }, [canRenderOnCurrentHost, isParentHost])

  useEffect(() => {
    let isMounted = true

    const clearConfirmationSession = async () => {
      if ((!isParentHost && !canRenderOnCurrentHost) || !shouldClearExistingSession || !session?.user || clearSessionAttemptedRef.current) {
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
  }, [canRenderOnCurrentHost, isParentHost, session?.user, shouldClearExistingSession, signOut])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!isParentHost && !canRenderOnCurrentHost) {
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
    if (!isParentHost && !canRenderOnCurrentHost) {
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
    <main className="min-h-screen bg-[#f7faf8] px-4 py-6 text-[#101828] sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_27rem] lg:items-center">
        <div className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6 lg:p-8">
          <img src={fallbackLogo} alt="Football Player" className="h-16 w-16 rounded-lg border border-[#d7e5dc] bg-white object-contain p-1 shadow-sm shadow-[#047857]/10" />
          <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Family portal</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-black leading-[1.04] tracking-tight text-[#101828] sm:text-4xl">
            Open the football updates linked to your child.
          </h1>
          <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-[#4b5f55]">
            Use the parent account confirmed by email. This view only shows club-shared messages, polls, match cards, and development reports for linked children.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ['Linked child first', 'Your account opens the children the club has linked to this email.'],
              ['Club controlled', 'Staff decide what is shared and when parent actions are available.'],
              ['Match ready', 'Use this on the device you want for live match day notifications.'],
            ].map(([title, copy]) => (
              <article key={title} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
                <p className="text-sm font-black text-[#101828]">{title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{copy}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Secure access</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-[#101828]">Parent login</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Log in with the same email that received the club invite.
          </p>

        {isSigningOutConfirmedSession || (shouldClearExistingSession && session?.user) ? (
          <p className="mt-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#4b5f55]">
            Preparing parent login...
          </p>
        ) : null}

        {isSigningOutConfirmedSession || (shouldClearExistingSession && session?.user) ? null : (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#101828]">Email</span>
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
              className="min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#101828]">Password</span>
            <div className="flex overflow-hidden rounded-lg border border-[#d7e5dc] bg-[#f7faf8] focus-within:border-[#047857] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#bbf7d0]">
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
                className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#101828] outline-none placeholder:text-[#94a3b8]"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((current) => !current)}
                className="min-h-12 border-l border-[#d7e5dc] px-4 py-3 text-sm font-bold text-[#047857] transition hover:bg-[#ecfdf5]"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {errorMessage ? <NoticeBanner title="Parent login not completed" message={errorMessage} /> : null}

          {message ? (
            <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-sm font-semibold text-[#065f46]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || isSigningOutConfirmedSession}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Logging in...' : 'Login'}
          </button>

          <button
            type="button"
            disabled={isSubmitting || isSigningOutConfirmedSession}
            onClick={handlePasswordReset}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Forgot password
          </button>

          {parentInviteToken ? (
            <a
              href={buildParentAppUrl(`/parent-invite/${parentInviteToken}`)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-5 py-3 text-sm font-bold text-[#065f46] transition hover:bg-[#bbf7d0]"
            >
              Back to parent invite
            </a>
          ) : null}
        </form>
        )}
        </div>
      </section>
    </main>
  )
}
