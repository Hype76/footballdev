import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { buildParentAppUrl, isParentPortalHost } from '../lib/app-origins.js'
import { useAuth } from '../lib/auth.js'
import { acceptParentPortalInvite } from '../lib/supabase.js'

function getFriendlySignupError(error) {
  const rawMessage = String(error?.message ?? '').trim()
  const normalizedMessage = rawMessage.toLowerCase()

  if (normalizedMessage.includes('already registered') || normalizedMessage.includes('already exists')) {
    return 'An account already exists for this email. Use parent login to open the child link.'
  }

  if (normalizedMessage.includes('rate limit')) {
    return 'Too many confirmation emails have been sent. Please wait a few minutes, then try again.'
  }

  return rawMessage || 'Parent account could not be created.'
}

async function withTimeout(promise, message, timeoutMs = 15000) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function ParentShell({ children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-950">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_100%)]" />
      <div className="relative w-full max-w-xl rounded-md border border-slate-200 bg-white p-5 shadow-lg shadow-slate-950/10 sm:p-6">
        {children}
      </div>
    </main>
  )
}

export function ParentInvitePage() {
  const { token } = useParams()
  const [searchParams] = useSearchParams()
  const shouldAcceptSignedInSession = searchParams.get('accept') === '1'
  const { isLoading, selectAccessMode, session, signOut, signUpParentAccount } = useAuth()
  const acceptAttemptedRef = useRef(false)
  const signOutAttemptedRef = useRef(false)
  const submitLockRef = useRef(false)
  const [acceptedLink, setAcceptedLink] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [invite, setInvite] = useState(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [isInviteLoading, setIsInviteLoading] = useState(true)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const isParentHost = isParentPortalHost()

  useEffect(() => {
    if (isParentHost) {
      return
    }

    window.location.replace(buildParentAppUrl(`${window.location.pathname}${window.location.search}`))
  }, [isParentHost])

  useEffect(() => {
    let isMounted = true

    const loadInvite = async () => {
      if (!isParentHost) {
        return
      }

      if (!token) {
        setErrorMessage('Parent invite token is missing.')
        setIsInviteLoading(false)
        return
      }

      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), 15000)
        const response = await fetch(`/.netlify/functions/get-parent-invite?token=${encodeURIComponent(token)}`, {
          signal: controller.signal,
        })
        window.clearTimeout(timeoutId)
        const result = await response.json().catch(() => ({}))

        if (!response.ok || result.success === false || !result.invite) {
          throw new Error(result.message || 'Parent invite details could not be loaded.')
        }

        if (isMounted) {
          setInvite(result.invite)
          setEmail(result.invite.email || '')
        }
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.name === 'AbortError'
            ? 'Parent invite details took too long to load. Refresh the page and try again.'
            : error.message || 'Parent invite details could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsInviteLoading(false)
        }
      }
    }

    void loadInvite()

    return () => {
      isMounted = false
    }
  }, [isParentHost, token])

  useEffect(() => {
    let isMounted = true

    const clearExistingSession = async () => {
      if (
        !isParentHost ||
        shouldAcceptSignedInSession ||
        isLoading ||
        !session?.user ||
        isInviteLoading ||
        !invite ||
        signOutAttemptedRef.current
      ) {
        return
      }

      const sessionEmail = String(session.user.email ?? '').trim().toLowerCase()
      const inviteEmail = String(invite.email ?? '').trim().toLowerCase()

      if (sessionEmail && inviteEmail && sessionEmail === inviteEmail) {
        window.location.assign(buildParentAppUrl(`/parent-login?parentInvite=${encodeURIComponent(token || '')}&confirmed=1`))
        return
      }

      signOutAttemptedRef.current = true
      setIsAccepting(true)
      setErrorMessage('')

      try {
        await signOut()
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.message || 'Could not reset this browser session. Sign out and try this invite again.')
        }
      } finally {
        if (isMounted) {
          setIsAccepting(false)
        }
      }
    }

    void clearExistingSession()

    return () => {
      isMounted = false
    }
  }, [invite, isInviteLoading, isLoading, isParentHost, session?.user, shouldAcceptSignedInSession, signOut, token])

  useEffect(() => {
    let isMounted = true

    const acceptInvite = async () => {
      if (
        !isParentHost ||
        !shouldAcceptSignedInSession ||
        !session?.user ||
        !token ||
        isInviteLoading ||
        !invite ||
        acceptAttemptedRef.current
      ) {
        return
      }

      acceptAttemptedRef.current = true
      setIsAccepting(true)
      setErrorMessage('')

      try {
        const link = await withTimeout(
          acceptParentPortalInvite(token),
          'Parent access took too long to open. Refresh the page and try again.',
        )
        await withTimeout(
          selectAccessMode('parent'),
          'Parent workspace took too long to open. Refresh the page and try again.',
        )
        if (isMounted) {
          setAcceptedLink(link)
          window.location.assign(buildParentAppUrl('/parent-portal'))
        }
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.message || 'This parent link could not be opened.')
        }
      } finally {
        if (isMounted) {
          setIsAccepting(false)
        }
      }
    }

    void acceptInvite()

    return () => {
      isMounted = false
    }
  }, [invite, isInviteLoading, isParentHost, selectAccessMode, session?.user, shouldAcceptSignedInSession, token])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!isParentHost) {
      window.location.replace(buildParentAppUrl(`${window.location.pathname}${window.location.search}`))
      return
    }

    const normalizedEmail = email.trim().toLowerCase()

    if (submitLockRef.current || !normalizedEmail) {
      return
    }

    submitLockRef.current = true
    setIsSubmitting(true)
    setErrorMessage('')
    setMessage('')

    try {
      const result = await signUpParentAccount({
        email: normalizedEmail,
        password,
        inviteToken: token,
      })

      if (result?.needsEmailVerification) {
        setPassword('')
        setMessage('Parent account created. Check your email, confirm the account, then log in on the parent login page.')
      } else {
        window.location.assign(buildParentAppUrl(`/parent-login?parentInvite=${encodeURIComponent(token || '')}&created=1`))
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(getFriendlySignupError(error))
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <ParentShell>
      <img src={fallbackLogo} alt="Football Player" className="h-16 w-16 rounded-md border border-slate-200 bg-slate-950 object-contain p-1" />
      <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Parent Portal</p>
      <h1 className="mt-3 text-2xl font-black tracking-tight">Create parent access</h1>

      {isInviteLoading || isLoading || isAccepting ? (
        <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
          Opening parent invite...
        </p>
      ) : null}

      {invite && !session?.user && !acceptedLink ? (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-bold text-slate-950">{invite.playerName || 'Child access'}</p>
            <p className="mt-1 text-xs font-semibold text-slate-600">{invite.teamName || 'Team'} | {invite.clubName || 'Club'}</p>
          </div>

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
              readOnly={Boolean(invite.email)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="min-h-12 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100 read-only:text-slate-500 read-only:focus:border-slate-200 read-only:focus:ring-0"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Create password</span>
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
                minLength={6}
                autoComplete="new-password"
                placeholder="Create a password"
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

          {errorMessage ? <NoticeBanner title="Parent access not created" message={errorMessage} /> : null}

          {message ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !email.trim()}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Creating account...' : 'Create Parent Account'}
          </button>

          <a
            href={buildParentAppUrl(`/parent-login?parentInvite=${encodeURIComponent(token || '')}`)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50"
          >
            Already have parent access?
          </a>
        </form>
      ) : null}

      {errorMessage && (!invite || session?.user) ? <div className="mt-5"><NoticeBanner title="Parent access not opened" message={errorMessage} /></div> : null}

      {acceptedLink ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-bold text-slate-950">{acceptedLink.playerName}</p>
            <p className="mt-1 text-xs font-semibold text-slate-600">{acceptedLink.teamName || 'No team'} | {acceptedLink.clubName || 'No club'}</p>
          </div>
          <a
            href={buildParentAppUrl('/parent-portal')}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
          >
            Open Parent Portal
          </a>
        </div>
      ) : null}
    </ParentShell>
  )
}
