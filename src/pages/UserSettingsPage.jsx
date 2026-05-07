import { useEffect, useState } from 'react'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { getRoleLabel, isDemoAccount, useAuth } from '../lib/auth.js'
import {
  requestLoginEmailChange,
  updateOwnThemeSettings,
  updateOwnUserSettings,
  updateSignedInPassword,
} from '../lib/supabase.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  getStoredThemeAccent,
  getStoredThemeMode,
  saveThemePreferences,
  themeAccentOptions,
  themeModeOptions,
} from '../lib/theme.js'

function createInitialPasswordState() {
  return {
    password: '',
    confirmPassword: '',
  }
}

export function UserSettingsPage() {
  const { authUser, resetPassword, updateCurrentUserDetails, user } = useAuth()
  const { showToast } = useToast()
  const isDemoSettings = isDemoAccount(user)
  const [username, setUsername] = useState(user?.username || user?.name || '')
  const [email, setEmail] = useState(user?.email || authUser?.email || '')
  const [displayName, setDisplayName] = useState(user?.displayName || user?.username || user?.name || '')
  const [emailTeamName, setEmailTeamName] = useState(user?.emailTeamName || user?.activeTeamName || '')
  const [emailClubName, setEmailClubName] = useState(user?.emailClubName || user?.clubName || '')
  const [replyToEmail, setReplyToEmail] = useState(user?.replyToEmail || user?.email || authUser?.email || '')
  const [passwordData, setPasswordData] = useState(createInitialPasswordState)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [themeMode, setThemeMode] = useState(getStoredThemeMode)
  const [themeAccent, setThemeAccent] = useState(getStoredThemeAccent)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setUsername(user?.username || user?.name || '')
    setEmail(user?.email || authUser?.email || '')
    setDisplayName(user?.displayName || user?.username || user?.name || '')
    setEmailTeamName(user?.emailTeamName || user?.activeTeamName || '')
    setEmailClubName(user?.emailClubName || user?.clubName || '')
    setReplyToEmail(user?.replyToEmail || user?.email || authUser?.email || '')
  }, [
    authUser?.email,
    user?.activeTeamName,
    user?.clubName,
    user?.displayName,
    user?.email,
    user?.emailClubName,
    user?.emailTeamName,
    user?.name,
    user?.replyToEmail,
    user?.username,
  ])

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

    if (isDemoSettings) {
      return
    }

    setIsSavingProfile(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      const updatedProfile = await updateOwnUserSettings({
        authUser,
        username,
        displayName,
        teamName: emailTeamName,
        clubName: emailClubName,
        replyToEmail,
      })

      updateCurrentUserDetails(updatedProfile)
      setUsername(updatedProfile.username || updatedProfile.name || '')
      setDisplayName(updatedProfile.displayName || updatedProfile.username || updatedProfile.name || '')
      setEmailTeamName(updatedProfile.emailTeamName || '')
      setEmailClubName(updatedProfile.emailClubName || '')
      setReplyToEmail(updatedProfile.replyToEmail || updatedProfile.email || '')
      setSuccessMessage('Account settings saved.')
      showToast({ title: 'Account saved', message: 'Your profile and email identity have been updated.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save account settings.')
      showToast({ title: 'Account not saved', message: error.message || 'Could not save account settings.', tone: 'error' })
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleEmailSubmit = async (event) => {
    event.preventDefault()

    if (isDemoSettings) {
      return
    }

    setIsSavingEmail(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      const result = await requestLoginEmailChange({
        authUser,
        email,
      })

      if (result.pendingConfirmation) {
        setSuccessMessage('Email change requested. Confirm the change from your email inbox.')
        showToast({ title: 'Email change requested', message: 'Check your inbox to confirm the new login email.' })
      } else {
        updateCurrentUserDetails({
          email: result.email,
        })
        setSuccessMessage('Login email updated.')
        showToast({ title: 'Login email updated', message: 'Your new email can now be used to sign in.' })
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update login email.')
      showToast({ title: 'Email not updated', message: error.message || 'Could not update login email.', tone: 'error' })
    } finally {
      setIsSavingEmail(false)
    }
  }

  const handlePasswordSubmit = async (event) => {
    event.preventDefault()

    if (isDemoSettings) {
      return
    }

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
      showToast({ title: 'Password updated', message: 'Your password has been changed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update password.')
      showToast({ title: 'Password not updated', message: error.message || 'Could not update password.', tone: 'error' })
    } finally {
      setIsSavingPassword(false)
    }
  }

  const handleResetPassword = async () => {
    if (isDemoSettings) {
      return
    }

    setIsSendingReset(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      await resetPassword(user?.email || authUser?.email)
      setSuccessMessage('Password reset email sent if that account exists.')
      showToast({ title: 'Reset email sent', message: 'Check your inbox for the password reset link.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not send password reset email.')
      showToast({ title: 'Reset email failed', message: error.message || 'Could not send password reset email.', tone: 'error' })
    } finally {
      setIsSendingReset(false)
    }
  }

  const persistThemePreferences = async (nextPreferences) => {
    if (isDemoSettings) {
      return
    }

    try {
      const updatedProfile = await updateOwnThemeSettings({
        authUser,
        mode: nextPreferences.mode,
        accent: nextPreferences.accent,
      })
      updateCurrentUserDetails(updatedProfile)
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Theme saved on this device',
        message: 'Your account theme could not be updated right now.',
        tone: 'error',
      })
    }
  }

  const handleThemeModeChange = (nextThemeMode) => {
    if (!hasPlanFeature(user, 'themes')) {
      showToast({ title: 'Theme not changed', message: createFeatureUpgradeMessage('themes'), tone: 'error' })
      return
    }

    const nextPreferences = saveThemePreferences({
      mode: nextThemeMode,
      accent: themeAccent,
    })
    setThemeMode(nextPreferences.mode)
    setThemeAccent(nextPreferences.accent)
    showToast({ title: 'Theme updated', message: 'Your display preference has been saved.' })
    void persistThemePreferences(nextPreferences)
  }

  const handleThemeAccentChange = (nextThemeAccent) => {
    if (!hasPlanFeature(user, 'themes')) {
      showToast({ title: 'Theme not changed', message: createFeatureUpgradeMessage('themes'), tone: 'error' })
      return
    }

    const nextPreferences = saveThemePreferences({
      mode: themeMode,
      accent: nextThemeAccent,
    })
    setThemeMode(nextPreferences.mode)
    setThemeAccent(nextPreferences.accent)
    showToast({ title: 'Theme updated', message: 'Your colour preference has been saved.' })
    void persistThemePreferences(nextPreferences)
  }

  const senderPreview = `${displayName || 'Display Name'} (${emailTeamName || 'Team'} - ${emailClubName || 'Club'})`
  const canUseThemes = hasPlanFeature(user, 'themes')

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

            <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Parent email identity</p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                Emails will be sent from feedback@playerfeedback.online. Parent replies will go to your reply-to email.
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Display Name</span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    autoComplete="name"
                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team Name</span>
                  <input
                    type="text"
                    value={emailTeamName}
                    onChange={(event) => setEmailTeamName(event.target.value)}
                    required
                    placeholder="U12"
                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club Name</span>
                  <input
                    type="text"
                    value={emailClubName}
                    onChange={(event) => setEmailClubName(event.target.value)}
                    required
                    placeholder="Cambourne FC"
                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Reply-to Email</span>
                  <input
                    type="email"
                    value={replyToEmail}
                    onChange={(event) => setReplyToEmail(event.target.value)}
                    required
                    autoComplete="email"
                    placeholder="coach@club.com"
                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Sender preview</p>
                <p className="mt-2 break-words text-sm font-medium text-[var(--text-primary)]">
                  {senderPreview} &lt;feedback@playerfeedback.online&gt;
                </p>
              </div>
            </div>

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
              disabled={isSavingProfile || isDemoSettings}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSavingProfile ? 'Saving...' : 'Save account'}
            </button>
          </form>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard
            title="Display"
            description="Choose the theme and accent colour for your workspace."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Theme</span>
                <select
                  value={themeMode}
                  onChange={(event) => handleThemeModeChange(event.target.value)}
                  disabled={!canUseThemes}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  {themeModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Accent colour</span>
                <select
                  value={themeAccent}
                  onChange={(event) => handleThemeAccentChange(event.target.value)}
                  disabled={!canUseThemes}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  {themeAccentOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!canUseThemes ? (
              <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{createFeatureUpgradeMessage('themes')}</p>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Login email"
            description="Change the email address used for signing in."
          >
            <form className="space-y-4" onSubmit={handleEmailSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">New login email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isDemoSettings}
                  required
                  autoComplete="email"
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <button
                type="submit"
                disabled={isSavingEmail || isDemoSettings}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingEmail ? 'Requesting...' : 'Update login email'}
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
                  disabled={isDemoSettings}
                  minLength={8}
                  autoComplete="new-password"
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
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
                  disabled={isDemoSettings}
                  minLength={8}
                  autoComplete="new-password"
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            </div>

            <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(event) => setShowPassword(event.target.checked)}
                disabled={isDemoSettings}
                className="h-4 w-4 rounded border-[var(--border-color)]"
              />
              <span>Show password</span>
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="submit"
                disabled={isSavingPassword || isDemoSettings || !passwordData.password || !passwordData.confirmPassword}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingPassword ? 'Updating...' : 'Update password'}
              </button>

              <button
                type="button"
                onClick={() => void handleResetPassword()}
                disabled={isSendingReset || isDemoSettings}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSendingReset ? 'Sending...' : 'Send reset email'}
              </button>
            </div>
          </form>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
