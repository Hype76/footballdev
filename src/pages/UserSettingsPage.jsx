import { useEffect, useState } from 'react'
import { AccountProfileSection } from '../components/user-settings/AccountProfileSection.jsx'
import { DisplaySettingsSection } from '../components/user-settings/DisplaySettingsSection.jsx'
import { LoginEmailSection } from '../components/user-settings/LoginEmailSection.jsx'
import { PasswordSettingsSection } from '../components/user-settings/PasswordSettingsSection.jsx'
import { WalkthroughSettingsSection } from '../components/user-settings/WalkthroughSettingsSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useWalkthrough } from '../components/walkthrough/walkthrough-context.js'
import { createInitialPasswordState } from '../hooks/user-settings/userSettingsUtils.js'
import { isClubAdmin, isDemoAccount, isParentPortalUser, useAuth } from '../lib/auth.js'
import {
  requestLoginEmailChange,
  updateOwnThemeSettings,
  updateOwnUserSettings,
  updateSignedInPassword,
} from '../lib/supabase.js'
import { canEditClubIdentity, createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  getStoredThemeAccent,
  getStoredThemeMode,
  saveThemePreferences,
} from '../lib/theme.js'
import { resetWalkthrough } from '../lib/walkthrough.js'

export function UserSettingsPage() {
  const { authUser, resetPassword, updateCurrentUserDetails, user } = useAuth()
  const walkthrough = useWalkthrough()
  const { showToast } = useToast()
  const isDemoSettings = isDemoAccount(user)
  const isParentSettings = isParentPortalUser(user)
  const isClubAdminSettings = isClubAdmin(user)
  const showSenderIdentity = Boolean(user?.clubId) && !isParentSettings && !isClubAdminSettings && user?.role !== 'super_admin'
  const showDisplaySettings = !isParentSettings
  const showWalkthroughSettings = !isParentSettings && !isClubAdminSettings
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
        clubName: canEditEmailClubName ? emailClubName : user?.emailClubName || user?.clubName || '',
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

  const handleRestartWalkthrough = () => {
    resetWalkthrough(user)
    showToast({ title: 'Walkthrough restarted', message: 'Open a sidebar page to see its walkthrough again.' })
  }

  const handleWalkthroughDisabledChange = (event) => {
    const disabled = event.target.checked
    walkthrough?.setDisabled(disabled)
    showToast({
      title: disabled ? 'Walkthrough disabled' : 'Walkthrough enabled',
      message: disabled ? 'Guided walkthroughs will not open automatically.' : 'Guided walkthroughs will open on eligible pages.',
    })
  }

  const senderPreview = `${displayName || 'Display Name'} (${emailTeamName || 'Team'} - ${emailClubName || 'Club'})`
  const canUseThemes = showDisplaySettings && hasPlanFeature(user, 'themes')
  const canEditEmailClubName = showSenderIdentity && canEditClubIdentity(user)
  const pageTitle = isParentSettings ? 'Parent account' : 'My account'
  const pageDescription = isParentSettings
    ? 'Manage your parent portal login and password.'
    : isClubAdminSettings
      ? 'Manage your personal account and sign-in details. Club details stay in Club Settings.'
      : 'Manage your username, password, and personal account details.'
  const workspaceLabel = isParentSettings
    ? 'Parent Portal'
    : user?.role === 'super_admin'
      ? 'Platform'
      : user?.clubName || 'No club assigned'

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="User Settings"
        title={pageTitle}
        description={pageDescription}
      />

      {successMessage ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <NoticeBanner title="Account settings could not be saved" message={errorMessage} />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1fr]">
        <AccountProfileSection
          authUser={authUser}
          canEditEmailClubName={canEditEmailClubName}
          displayName={displayName}
          emailClubName={emailClubName}
          emailTeamName={emailTeamName}
          isDemoSettings={isDemoSettings}
          isSavingProfile={isSavingProfile}
          onDisplayNameChange={setDisplayName}
          onEmailClubNameChange={setEmailClubName}
          onEmailTeamNameChange={setEmailTeamName}
          onReplyToEmailChange={setReplyToEmail}
          onSubmit={handleProfileSubmit}
          onUsernameChange={setUsername}
          replyToEmail={replyToEmail}
          senderPreview={senderPreview}
          showEmailIdentity={showSenderIdentity}
          user={user}
          username={username}
          workspaceLabel={workspaceLabel}
        />

        <div className="space-y-5">
          {showDisplaySettings ? (
            <DisplaySettingsSection
              canUseThemes={canUseThemes}
              onThemeAccentChange={handleThemeAccentChange}
              onThemeModeChange={handleThemeModeChange}
              themeAccent={themeAccent}
              themeMode={themeMode}
            />
          ) : null}

          {showWalkthroughSettings ? (
            <WalkthroughSettingsSection
              disabled={Boolean(walkthrough?.disabled)}
              onDisabledChange={handleWalkthroughDisabledChange}
              onRestart={handleRestartWalkthrough}
            />
          ) : null}

          <LoginEmailSection
            email={email}
            isDemoSettings={isDemoSettings}
            isSavingEmail={isSavingEmail}
            onEmailChange={setEmail}
            onSubmit={handleEmailSubmit}
          />

          <PasswordSettingsSection
            isDemoSettings={isDemoSettings}
            isSavingPassword={isSavingPassword}
            isSendingReset={isSendingReset}
            onPasswordDataChange={(fieldName, value) =>
              setPasswordData((current) => ({
                ...current,
                [fieldName]: value,
              }))
            }
            onResetPassword={() => void handleResetPassword()}
            onShowPasswordChange={setShowPassword}
            onSubmit={handlePasswordSubmit}
            passwordData={passwordData}
            showPassword={showPassword}
          />
        </div>
      </div>
    </div>
  )
}
