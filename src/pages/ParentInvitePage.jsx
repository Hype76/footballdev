import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
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
    <main className="flex min-h-screen items-center justify-center bg-[#030603] px-4 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[#071008]" />
      <div className="relative w-full max-w-xl rounded-lg border border-white/10 bg-[#0b130d]/95 p-5 shadow-2xl shadow-black/40 sm:p-6">
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

  useEffect(() => {
    let isMounted = true

    const loadInvite = async () => {
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
  }, [token])

  useEffect(() => {
    let isMounted = true

    const clearExistingSession = async () => {
      if (
        shouldAcceptSignedInSession ||
        isLoading ||
        !session?.user ||
        signOutAttemptedRef.current
      ) {
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
  }, [isLoading, session?.user, shouldAcceptSignedInSession, signOut])

  useEffect(() => {
    let isMounted = true

    const acceptInvite = async () => {
      if (
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
          window.location.assign('/parent-portal')
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
  }, [invite, isInviteLoading, selectAccessMode, session?.user, shouldAcceptSignedInSession, token])

  const handleSubmit = async (event) => {
    event.preventDefault()

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
        window.location.assign(`/parent-login?parentInvite=${encodeURIComponent(token || '')}&created=1`)
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
      <img src={fallbackLogo} alt="Player Feedback" className="h-16 w-16 rounded-lg border border-[#d8ff2f]/25 bg-black/40 object-contain p-1" />
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-[#d8ff2f]">Parent Portal</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Create parent access</h1>

      {isInviteLoading || isLoading || isAccepting ? (
        <p className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          Opening parent invite...
        </p>
      ) : null}

      {invite && !session?.user && !acceptedLink ? (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm font-semibold text-white">{invite.playerName || 'Child access'}</p>
            <p className="mt-1 text-xs text-slate-400">{invite.teamName || 'Team'} | {invite.clubName || 'Club'}</p>
          </div>

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
              readOnly={Boolean(invite.email)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="min-h-12 w-full rounded-lg border border-white/10 bg-[#101b12] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#d8ff2f] read-only:text-slate-300 read-only:focus:border-white/10"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-200">Create password</span>
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
                minLength={6}
                autoComplete="new-password"
                placeholder="Create a password"
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

          {errorMessage ? <NoticeBanner title="Parent access not created" message={errorMessage} /> : null}

          {message ? (
            <div className="rounded-lg border border-[#d8ff2f]/20 bg-[#d8ff2f]/10 px-4 py-3 text-sm font-semibold text-[#d8ff2f]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !email.trim()}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#d8ff2f] px-5 py-3 text-sm font-black text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Creating account...' : 'Create Parent Account'}
          </button>

          <Link
            to={`/parent-login?parentInvite=${encodeURIComponent(token || '')}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/[0.08]"
          >
            Already have parent access?
          </Link>
        </form>
      ) : null}

      {errorMessage && (!invite || session?.user) ? <div className="mt-5"><NoticeBanner title="Parent access not opened" message={errorMessage} /></div> : null}

      {acceptedLink ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm font-semibold text-white">{acceptedLink.playerName}</p>
            <p className="mt-1 text-xs text-slate-400">{acceptedLink.teamName || 'No team'} | {acceptedLink.clubName || 'No club'}</p>
          </div>
          <Link
            to="/parent-portal"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#d8ff2f] px-4 py-3 text-sm font-semibold text-black"
          >
            Open Parent Portal
          </Link>
        </div>
      ) : null}
    </ParentShell>
  )
}
