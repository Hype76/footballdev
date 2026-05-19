import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'

export function StaffInvitePage() {
  const { token } = useParams()
  const [invite, setInvite] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let isCurrent = true

    async function loadInvite() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const response = await fetch(`/.netlify/functions/get-staff-invite?token=${encodeURIComponent(token || '')}`)
        const result = await response.json().catch(() => ({}))

        if (!response.ok || result.success === false) {
          throw new Error(result.message || 'Staff invite could not be loaded.')
        }

        if (isCurrent) {
          setInvite(result.invite)
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          setInvite(null)
          setErrorMessage(error.message || 'Staff invite could not be loaded.')
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false)
        }
      }
    }

    void loadInvite()

    return () => {
      isCurrent = false
    }
  }, [token])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (!invite?.email) {
      setErrorMessage('Staff invite could not be loaded.')
      return
    }

    if (password.length < 8) {
      setErrorMessage('Create a password with at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch('/.netlify/functions/create-staff-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email: invite.email,
          password,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Staff account could not be created.')
      }

      setSuccessMessage('Staff access created. You can now sign in.')
      setPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Staff account could not be created.')
    } finally {
      setIsSaving(false)
    }
  }

  const logoUrl = invite?.logoUrl || fallbackLogo

  return (
    <main className="min-h-screen bg-[var(--page-bg)] px-4 py-10 text-[var(--text-primary)]">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <img
          src={logoUrl}
          alt=""
          className="mb-6 h-16 w-16 rounded-lg border border-[var(--border-color)] object-contain"
        />
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Staff invite</p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Create staff access</h1>

        {isLoading ? (
          <p className="mt-6 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Opening staff invite...
          </p>
        ) : errorMessage && !invite ? (
          <div className="mt-6">
            <NoticeBanner title="Staff invite not opened" message={errorMessage} />
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{invite.clubName || 'Player Feedback'}</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{invite.teamName || 'Team access'} | {invite.roleLabel || 'Staff'}</p>
              <p className="mt-3 break-words text-sm text-[var(--text-secondary)]">{invite.email}</p>
            </div>

            {errorMessage ? <NoticeBanner title="Staff access not created" message={errorMessage} /> : null}
            {successMessage ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100">
                {successMessage}
              </div>
            ) : null}

            {!successMessage ? (
              <>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Create password</span>
                  <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] focus-within:border-[var(--accent)]">
                    <input
                      type={isPasswordVisible ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="min-h-11 min-w-0 flex-1 rounded-l-lg bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
                      placeholder="Create a password"
                    />
                    <button
                      type="button"
                      onClick={() => setIsPasswordVisible((value) => !value)}
                      className="min-h-11 rounded-r-lg px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]"
                    >
                      {isPasswordVisible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Confirm password</span>
                  <input
                    type={isPasswordVisible ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    placeholder="Confirm password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Creating access...' : 'Create Staff Access'}
                </button>
              </>
            ) : (
              <Link
                to="/sign-in"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
              >
                Go to sign in
              </Link>
            )}
          </form>
        )}
      </div>
    </main>
  )
}

export default StaffInvitePage
