import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useAuth } from '../lib/auth.js'
import { acceptParentPortalInvite } from '../lib/supabase.js'

export function ParentInvitePage() {
  const { token } = useParams()
  const { isLoading, selectAccessMode, session } = useAuth()
  const [acceptedLink, setAcceptedLink] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isAccepting, setIsAccepting] = useState(false)

  useEffect(() => {
    let isMounted = true

    const acceptInvite = async () => {
      if (!session?.user || !token) {
        return
      }

      setIsAccepting(true)
      setErrorMessage('')

      try {
        const link = await acceptParentPortalInvite(token)
        await selectAccessMode('parent')
        if (isMounted) {
          setAcceptedLink(link)
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
  }, [selectAccessMode, session?.user, token])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 py-8 text-[var(--text-primary)]">
      <div className="w-full max-w-xl rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm shadow-black/20 sm:p-6">
        <img src={fallbackLogo} alt="Player Feedback" className="h-16 w-16 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] object-contain p-1" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Parent Portal</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Open parent access</h1>

        {!session?.user && !isLoading ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              Log in or create an account first, then open this link again to connect the child to your parent portal.
            </p>
            <Link
              to={`/login?parentInvite=${encodeURIComponent(token || '')}`}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)]"
            >
              Login or Sign Up
            </Link>
          </div>
        ) : null}

        {isLoading || isAccepting ? (
          <p className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-muted)]">
            Opening parent access...
          </p>
        ) : null}

        {errorMessage ? <div className="mt-5"><NoticeBanner title="Parent access not opened" message={errorMessage} /></div> : null}

        {acceptedLink ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{acceptedLink.playerName}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{acceptedLink.teamName || 'No team'} | {acceptedLink.clubName || 'No club'}</p>
            </div>
            <Link
              to="/parent-portal"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)]"
            >
              Open Parent Portal
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  )
}
