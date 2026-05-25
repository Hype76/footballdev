import { useEffect, useState } from 'react'
import { AccountProfileSection } from '../components/user-settings/AccountProfileSection.jsx'
import { DisplaySettingsSection } from '../components/user-settings/DisplaySettingsSection.jsx'
import { LoginEmailSection } from '../components/user-settings/LoginEmailSection.jsx'
import { PasswordSettingsSection } from '../components/user-settings/PasswordSettingsSection.jsx'
import { WalkthroughSettingsSection } from '../components/user-settings/WalkthroughSettingsSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { createInitialPasswordState } from '../hooks/user-settings/userSettingsUtils.js'
import { canManageClubSettings, canManageTeamAppearance, canManageTeamSettings, isClubAdmin, isDemoAccount, isParentPortalUser, useAuth } from '../lib/auth.js'
import {
  requestLoginEmailChange,
  updateTeamSettings,
  updateOwnUserSettings,
  updateSignedInPassword,
} from '../lib/supabase.js'
import { canEditClubIdentity, createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  getStoredThemeAccent,
  getStoredThemeButtonStyle,
  getStoredThemeMode,
  saveThemePreferences,
} from '../lib/theme.js'
import { resetOnboarding } from '../lib/onboarding.js'

export function UserSettingsPage() {
  const { authUser, resetPassword, updateCurrentUserDetails, user } = useAuth()
  const { showToast } = useToast()
  const isDemoSettings = isDemoAccount(user)
  const isParentSettings = isParentPortalUser(user)
  const isClubAdminSettings = isClubAdmin(user)
  const showSenderIdentity = Boolean(user?.clubId) && !isParentSettings && !isClubAdminSettings && user?.role !== 'super_admin'
  const showDisplaySettings = canManageTeamAppearance(user) && Boolean(user?.activeTeamId)
  const showWalkthroughSettings = Boolean(user?.id) && user?.role !== 'super_admin'
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
  const [isRestartingOnboarding, setIsRestartingOnboarding] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [themeMode, setThemeMode] = useState(getStoredThemeMode)
  const [themeAccent, setThemeAccent] = useState(getStoredThemeAccent)
  const [themeButtonStyle, setThemeButtonStyle] = useState(getStoredThemeButtonStyle)
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
    if (!user?.id) {
      return
    }

    setThemeMode(user.themeMode || getStoredThemeMode())
    setThemeAccent(user.themeAccent || getStoredThemeAccent())
    setThemeButtonStyle(user.themeButtonStyle || getStoredThemeButtonStyle())
  }, [user?.id, user?.themeAccent, user?.themeButtonStyle, user?.themeMode])

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
      const updatedTeam = await updateTeamSettings({
        teamId: user.activeTeamId,
        user,
        data: {
          themeMode: nextPreferences.mode,
          themeAccent: nextPreferences.accent,
          themeButtonStyle: nextPreferences.buttonStyle,
        },
      })
      updateCurrentUserDetails({
        themeMode: updatedTeam.themeMode,
        themeAccent: updatedTeam.themeAccent,
        themeButtonStyle: updatedTeam.themeButtonStyle,
      })
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Team theme not saved',
        message: 'Your team appearance could not be updated right now.',
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
      buttonStyle: themeButtonStyle,
    })
    setThemeMode(nextPreferences.mode)
    setThemeAccent(nextPreferences.accent)
    setThemeButtonStyle(nextPreferences.buttonStyle)
    showToast({ title: 'Team theme updated', message: 'The active team display preference has been saved.' })
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
      buttonStyle: themeButtonStyle,
    })
    setThemeMode(nextPreferences.mode)
    setThemeAccent(nextPreferences.accent)
    setThemeButtonStyle(nextPreferences.buttonStyle)
    showToast({ title: 'Team theme updated', message: 'The active team colour preference has been saved.' })
    void persistThemePreferences(nextPreferences)
  }

  const handleThemeButtonStyleChange = (nextThemeButtonStyle) => {
    if (!hasPlanFeature(user, 'themes')) {
      showToast({ title: 'Theme not changed', message: createFeatureUpgradeMessage('themes'), tone: 'error' })
      return
    }

    const nextPreferences = saveThemePreferences({
      mode: themeMode,
      accent: themeAccent,
      buttonStyle: nextThemeButtonStyle,
    })
    setThemeMode(nextPreferences.mode)
    setThemeAccent(nextPreferences.accent)
    setThemeButtonStyle(nextPreferences.buttonStyle)
    showToast({ title: 'Team theme updated', message: 'The active team button style has been saved.' })
    void persistThemePreferences(nextPreferences)
  }

  const getOnboardingScope = () => (canManageClubSettings(user) || canManageTeamSettings(user) ? 'workspace' : 'user')

  const handleRestartWalkthrough = async () => {
    const scope = getOnboardingScope()
    setIsRestartingOnboarding(true)

    try {
      await resetOnboarding({ scope, user })
      if (scope === 'workspace') {
        updateCurrentUserDetails({
          workspaceOnboardingCompletedSteps: [],
          workspaceOnboardingDismissedAt: null,
          workspaceOnboardingEnabled: true,
          workspaceOnboardingResetAt: new Date().toISOString(),
        })
      } else {
        updateCurrentUserDetails({
          userOnboardingCompletedSteps: [],
          userOnboardingDismissedAt: null,
          userOnboardingEnabled: true,
          userOnboardingResetAt: new Date().toISOString(),
        })
      }
      showToast({ title: 'Onboarding restarted', message: 'The setup checklist will open again.' })
    } catch (error) {
      console.error(error)
      showToast({ title: 'Onboarding not restarted', message: error.message || 'Could not reset onboarding.', tone: 'error' })
    } finally {
      setIsRestartingOnboarding(false)
    }
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
  const onboardingScope = getOnboardingScope()
  const onboardingScopeLabel = onboardingScope === 'workspace' ? 'workspace' : 'account'
  const accountSummary = [
    {
      label: 'Workspace',
      value: workspaceLabel,
      caption: isParentSettings ? 'Parent portal access.' : 'The account context currently in use.',
    },
    {
      label: 'Role',
      value: user?.roleLabel || user?.role || 'Not assigned',
      caption: 'Controls which tools and records you can use.',
    },
    {
      label: 'Onboarding scope',
      value: onboardingScopeLabel,
      caption: 'Restart setup guidance for the correct level.',
    },
  ]

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="User Settings"
        title={pageTitle}
        description={pageDescription}
      />

      <section className="grid gap-4 lg:grid-cols-3">
        {accountSummary.map((item) => (
          <article key={item.label} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm ">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p className="mt-3 break-words text-2xl font-black tracking-tight text-slate-950">{item.value || 'Not set'}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-5 shadow-sm ">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Account rule</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Keep login details separate from club settings. Use this page for your identity, password, display preferences, and restarting setup help.
        </p>
      </section>

      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
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
              onThemeButtonStyleChange={handleThemeButtonStyleChange}
              onThemeModeChange={handleThemeModeChange}
              themeAccent={themeAccent}
              themeButtonStyle={themeButtonStyle}
              themeMode={themeMode}
            />
          ) : null}

          {showWalkthroughSettings ? (
            <WalkthroughSettingsSection
              isRestarting={isRestartingOnboarding}
              onRestart={handleRestartWalkthrough}
              scopeLabel={onboardingScopeLabel}
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
