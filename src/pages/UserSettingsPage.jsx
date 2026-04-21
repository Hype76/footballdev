import { useEffect, useState } from 'react'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { getRoleLabel, useAuth } from '../lib/auth.js'
import { updateOwnUserSettings, updateSignedInPassword } from '../lib/supabase.js'

function createInitialPasswordState() {
  return {
    password: '',
    confirmPassword: '',
  }
}

export function UserSettingsPage() {
  const { authUser, resetPassword, updateCurrentUserDetails, user } = useAuth()
  const [username, setUsername] = useState(user?.username || user?.name || '')
  const [passwordData, setPasswordData] = useState(createInitialPasswordState)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setUsername(user?.username || user?.name || '')
  }, [user?.name, user?.username])

  useEffect(() => {
    if (!successMessage) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setSuccessMessage('')
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [successMessage])

  const handleProfileSubmit = async (event) => {
    event.preventDefault()
    setIsSavingProfile(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      const updatedProfile = await updateOwnUserSettings({
        authUser,
        username,
      })

      updateCurrentUserDetails(updatedProfile)
      setUsername(updatedProfile.username || updatedProfile.name || '')
      setSuccessMessage('Account settings saved.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save account settings.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()
    setIsSavingPassword(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      if (passwordData.password !== passwordData.confirmPassword) {
        throw new Error('Passwords do not match.')
      }

      await updateSignedInPassword(passwordData.password)
      setPasswordData(createInitialPasswordState())
      setSuccessMessage('Password updated.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update password.')
    } finally {
      setIsSavingPassword(false)
    }
  }

  const handleResetPassword = async () => {
    setIsSendingReset(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      await resetPassword(user?.email || authUser?.email)
      setSuccessMessage('Password reset email sent if that account exists.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not send password reset email.')
    } finally {
      setIsSendingReset(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="User Settings"
        title="My account"
        description="Manage your username, password, and personal account details."
      />

      {successMessage ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <NoticeBanner title="Account settings could not be saved" message={errorMessage} />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1fr]">
        <SectionCard
          title="Account profile"
          description="This is how your name appears inside assessments and the workspace."
        >
          <form className="space-y-4" onSubmit={handleProfileSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoComplete="nickname"
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Email</p>
                <p className="mt-2 break-words text-sm font-medium text-[var(--text-primary)]">
                  {user?.email || authUser?.email || 'No email found'}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Role</p>
                <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{getRoleLabel(user)}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Workspace</p>
              <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
                {user?.role === 'super_admin' ? 'Platform' : user?.clubName || 'No club assigned'}
              </p>
            </div>

            <button
              type="submit"
              disabled={isSavingProfile}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSavingProfile ? 'Saving...' : 'Save account'}
            </button>
          </form>
        </SectionCard>

        <SectionCard
          title="Password"
          description="Change your password while signed in, or send yourself a reset email."
        >
          <form className="space-y-4" onSubmit={handlePasswordSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">New password</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordData.password}
                  onChange={(event) =>
                    setPasswordData((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  minLength={8}
                  autoComplete="new-password"
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Confirm password</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordData.confirmPassword}
                  onChange={(event) =>
                    setPasswordData((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  minLength={8}
                  autoComplete="new-password"
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>
            </div>

            <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(event) => setShowPassword(event.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-color)]"
              />
              <span>Show password</span>
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={isSavingPassword || !passwordData.password || !passwordData.confirmPassword}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingPassword ? 'Updating...' : 'Update password'}
              </button>

              <button
                type="button"
                onClick={() => void handleResetPassword()}
                disabled={isSendingReset}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSendingReset ? 'Sending...' : 'Send reset email'}
              </button>
            </div>
          </form>
        </SectionCard>
      </div>
    </div>
  )
}
