import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.webp'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { buildParentAppUrl, getMainAppOrigin, isParentInviteHost } from '../lib/app-origins.js'
import { useAuth } from '../lib/auth.js'
import {
  buildParentInviteAcceptancePath,
  buildParentInviteLoginPath,
  buildParentInviteSuccessPath,
  isParentInviteAccountMismatch,
} from '../lib/parent-auth-intent.js'
import { acceptParentPortalInvite } from '../lib/supabase.js'
import { supabase } from '../lib/supabase-client.js'
import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_SUMMARY } from '../lib/password-policy.js'

const inputClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] read-only:text-[#4b5f55] read-only:focus:border-[#d7e5dc] read-only:focus:ring-0'
const primaryButtonClass = 'inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5]'
const SELECTED_ACCESS_MODE_STORAGE_KEY = 'selected-access-mode'

function buildCurrentParentFlowUrl(path, isParentHost) {
  return isParentHost ? buildParentAppUrl(path) : path
}

function getFriendlySignupError(error) {
  const rawMessage = String(error?.message ?? '').trim()
  const normalizedMessage = rawMessage.toLowerCase()

  if (normalizedMessage.includes('already registered') || normalizedMessage.includes('already exists')) {
    return 'An account already exists for this email. Use sign in to open the player link.'
  }

  if (normalizedMessage.includes('rate limit')) {
    return 'Too many confirmation emails have been sent. Please wait a few minutes, then try again.'
  }

  if (normalizedMessage.includes('staging') || normalizedMessage.includes('test workspace') || normalizedMessage.includes('platform admin')) {
    return 'This access link is not available. Please ask the club to send a new invite.'
  }

  return rawMessage || 'Account could not be created.'
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
    <main
      className="parent-portal-theme-scope flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-8 text-[#101828]"
      data-testid="parent-invite-shell"
    >
      <div className="w-full max-w-xl rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
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
  const directSessionCheckedRef = useRef(false)
  const submitLockRef = useRef(false)
  const [acceptedLink, setAcceptedLink] = useState(null)
  const [directSessionReady, setDirectSessionReady] = useState(false)
  const [directSessionEmail, setDirectSessionEmail] = useState('')
  const [switchAccountError, setSwitchAccountError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [invite, setInvite] = useState(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [isInviteLoading, setIsInviteLoading] = useState(true)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [isConfirmationState, setIsConfirmationState] = useState(false)
  const isParentHost = isParentInviteHost()
  const canRenderOnCurrentHost = isParentHost || getMainAppOrigin() === window.location.origin
  const canAcceptSignedInSession = Boolean(session?.user || directSessionReady)
  const signedInEmail = String(session?.user?.email || directSessionEmail || '').trim()

  useEffect(() => {
    if (canRenderOnCurrentHost) {
      return
    }

    window.location.replace(buildParentAppUrl(`${window.location.pathname}${window.location.search}`))
  }, [canRenderOnCurrentHost])

  useEffect(() => {
    if (!isConfirmationState) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      window.close()
    }, 30000)

    return () => window.clearTimeout(timeoutId)
  }, [isConfirmationState])

  useEffect(() => {
    let isMounted = true

    const loadInvite = async () => {
      if (!canRenderOnCurrentHost) {
        return
      }

      if (!token) {
        setErrorMessage('This access link is not available. Please ask the club to send a new invite.')
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
          throw new Error(result.message || 'This access link is not available. Please ask the club to send a new invite.')
        }

        if (isMounted) {
          setInvite(result.invite)
          setEmail(result.invite.email || '')
        }
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.name === 'AbortError'
            ? 'This access link took too long to load. Refresh the page and try again.'
            : getFriendlySignupError(error))
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
  }, [canRenderOnCurrentHost, token])

  useEffect(() => {
    const continueExistingSession = () => {
      if (
        !canRenderOnCurrentHost ||
        shouldAcceptSignedInSession ||
        isLoading ||
        !session?.user ||
        isInviteLoading ||
        !invite
      ) {
        return
      }

      window.location.replace(buildCurrentParentFlowUrl(buildParentInviteAcceptancePath(token), isParentHost))
    }

    continueExistingSession()
  }, [canRenderOnCurrentHost, invite, isInviteLoading, isLoading, isParentHost, session?.user, shouldAcceptSignedInSession, token])

  useEffect(() => {
    let isMounted = true

    const resolveSessionForAccept = async () => {
      if (
        !canRenderOnCurrentHost ||
        !shouldAcceptSignedInSession ||
        session?.user ||
        !token ||
        isInviteLoading ||
        !invite ||
        directSessionCheckedRef.current
      ) {
        return
      }

      directSessionCheckedRef.current = true

      try {
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          'Parent login session took too long to open. Log in again to continue.',
          8000,
        )
        const nextSession = sessionResult?.data?.session

        if (!isMounted) {
          return
        }

        if (nextSession?.user) {
          window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, 'parent')
          setDirectSessionEmail(String(nextSession.user.email || '').trim())
          setDirectSessionReady(true)
          return
        }

        window.location.assign(buildCurrentParentFlowUrl(`/parent-login?parentInvite=${encodeURIComponent(token || '')}&confirmed=1`, isParentHost))
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.message || 'Parent login session could not be opened. Log in again to continue.')
        }
      }
    }

    void resolveSessionForAccept()

    return () => {
      isMounted = false
    }
  }, [canRenderOnCurrentHost, invite, isInviteLoading, isParentHost, session?.user, shouldAcceptSignedInSession, token])

  useEffect(() => {
    let isMounted = true

    const acceptInvite = async () => {
      if (
        !canRenderOnCurrentHost ||
        !shouldAcceptSignedInSession ||
        !canAcceptSignedInSession ||
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
        const link = await acceptParentPortalInvite(token)

        if (session?.user) {
          await selectAccessMode('parent')
        } else {
          window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, 'parent')
        }

        if (isMounted) {
          setAcceptedLink(link)
          window.location.assign(buildCurrentParentFlowUrl(buildParentInviteSuccessPath(link.id), isParentHost))
        }
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(getFriendlySignupError(error) || 'This access link could not be opened.')
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
  }, [canAcceptSignedInSession, canRenderOnCurrentHost, directSessionReady, invite, isInviteLoading, isParentHost, selectAccessMode, session?.user, shouldAcceptSignedInSession, token])

  const handleSwitchAccount = async () => {
    if (submitLockRef.current) return
    submitLockRef.current = true
    setIsSubmitting(true)
    setSwitchAccountError('')
    try {
      await signOut()
      window.location.assign(buildCurrentParentFlowUrl(buildParentInviteLoginPath(token, isParentHost), isParentHost))
    } catch {
      setSwitchAccountError('This browser could not sign out. Please try again.')
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!canRenderOnCurrentHost) {
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

      if (result?.existingAccount) {
        setPassword('')
        window.location.assign(buildCurrentParentFlowUrl(`/parent-login?parentInvite=${encodeURIComponent(token || '')}&existing=1`, isParentHost))
      } else if (result?.needsEmailVerification) {
        setPassword('')
        setMessage('')
        setIsConfirmationState(true)
      } else {
        window.location.assign(buildCurrentParentFlowUrl(`/parent-login?parentInvite=${encodeURIComponent(token || '')}&created=1`, isParentHost))
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
      <img src={fallbackLogo} alt="Football Player" className="h-16 w-16 rounded-lg border border-[#d7e5dc] bg-white object-contain p-1 shadow-sm shadow-[#047857]/10" />
      <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Guardian access</p>
      <h1 className="mt-3 text-2xl font-black tracking-tight">Create your family portal login</h1>
      <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
        Use this login only for the player shown below. Family accounts do not open Coach tools or other club records.
      </p>

      {isConfirmationState ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4">
            <p className="text-2xl font-black tracking-tight text-[#101828]">Please confirm your email.</p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
              A confirmation email has been sent. Click the link in that email to finish account setup and open the sign-in page.
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
              This page will try to close after 30 seconds. You can close this tab after confirming your email.
            </p>
          </div>
        </div>
      ) : null}

      {isInviteLoading || isLoading || isAccepting ? (
        <p className="mt-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#4b5f55]">
          Opening family access...
        </p>
      ) : null}

      {invite && !session?.user && !acceptedLink && !isConfirmationState ? (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Player access</p>
            <p className="text-sm font-bold text-[#101828]">{invite.playerName || 'Player access'}</p>
            <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Team: {invite.teamName || 'Team'}, Club: {invite.clubName || 'Club'}</p>
          </div>

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
              readOnly={Boolean(invite.email)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-[#101828]">Create password</span>
            <div className="flex rounded-lg border border-[#d7e5dc] bg-[#f7faf8] focus-within:border-[#047857] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#d1fae5]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setErrorMessage('')
                  setMessage('')
                }}
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                placeholder="Create a password"
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

          <p className="text-sm font-semibold leading-6 text-[#4b5f55]">{PASSWORD_POLICY_SUMMARY}</p>

          {errorMessage ? <NoticeBanner title="Account not created" message={errorMessage} /> : null}

          {message ? (
            <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-sm font-semibold text-[#065f46]">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !email.trim()}
            className={primaryButtonClass}
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>

          <a
            href={buildCurrentParentFlowUrl(`/parent-login?parentInvite=${encodeURIComponent(token || '')}`, isParentHost)}
            className={secondaryButtonClass}
          >
            Already have an account?
          </a>
        </form>
      ) : null}

      {errorMessage && (!invite || canAcceptSignedInSession) ? <div className="mt-5 space-y-4">
        <NoticeBanner title="Family access not opened" message={errorMessage} />
        {invite?.email && canAcceptSignedInSession && isParentInviteAccountMismatch(errorMessage) ? <div className="space-y-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
          <h2 className="text-lg font-black">Use the invited email address</h2>
          <p className="text-sm leading-6">Invitation email: <strong className="break-all">{invite.email}</strong></p>
          {signedInEmail ? <p className="text-sm leading-6">Currently signed in as: <strong className="break-all">{signedInEmail}</strong></p> : null}
          <p className="text-sm leading-6 text-[#4b5f55]">If the email was forwarded to another inbox, use the invitation email above and the password you created. Switching accounts signs out this browser and keeps your player invitation ready.</p>
          {switchAccountError ? <p role="alert" className="text-sm font-semibold text-[#9b1c1c]">{switchAccountError}</p> : null}
          <button type="button" disabled={isSubmitting} onClick={handleSwitchAccount} className={primaryButtonClass}>
            {isSubmitting ? 'Signing out...' : 'Sign out and use invited account'}
          </button>
        </div> : null}
      </div> : null}

      {acceptedLink ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4">
            <p className="text-sm font-bold text-[#101828]">{acceptedLink.playerName}</p>
            <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Team: {acceptedLink.teamName || 'No team assigned'}, Club: {acceptedLink.clubName || 'No club assigned'}</p>
          </div>
          <a
            href={buildCurrentParentFlowUrl('/parent-portal', isParentHost)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46]"
          >
            Open family portal
          </a>
        </div>
      ) : null}
    </ParentShell>
  )
}
