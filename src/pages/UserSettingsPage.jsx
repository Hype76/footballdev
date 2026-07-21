import { useEffect, useState } from 'react'
import { AccountProfileSection } from '../components/user-settings/AccountProfileSection.jsx'
import { DisplaySettingsSection } from '../components/user-settings/DisplaySettingsSection.jsx'
import { LoginEmailSection } from '../components/user-settings/LoginEmailSection.jsx'
import { PasswordSettingsSection } from '../components/user-settings/PasswordSettingsSection.jsx'
import { PrivilegedMfaSection } from '../components/user-settings/PrivilegedMfaSection.jsx'
import { SetupChecklistSettingsSection } from '../components/user-settings/SetupChecklistSettingsSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { createInitialPasswordState } from '../hooks/user-settings/userSettingsUtils.js'
import { canManageClubSettings, canManageTeamSettings, isClubAdmin, isDemoAccount, isParentPortalUser, useAuth } from '../lib/auth.js'
import {
  getTeams,
  requestLoginEmailChange,
  requestPasswordReauthentication,
  updateTeamSettings,
  updateOwnThemeSettings,
  updateOwnUserSettings,
  updateSignedInPassword,
} from '../lib/supabase.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature, createUiFeatureUnavailableMessage } from '../lib/paywall-ui.js'
import { canEditClubIdentity } from '../lib/plans.js'
import {
  getStoredThemeAccent,
  getStoredThemeButtonStyle,
  getStoredThemeMode,
  saveThemePreferences,
} from '../lib/theme.js'
import {
  buildOnboardingPlan,
  getOnboardingProgress,
  loadOnboardingSnapshot,
  openOnboarding,
} from '../lib/onboarding.js'

export function UserSettingsPage() {
  const { authUser, resetPassword, updateCurrentUserDetails, user } = useAuth()
  const { showToast } = useToast()
  const isDemoSettings = isDemoAccount(user)
  const isParentSettings = isParentPortalUser(user)
  const isClubAdminSettings = isClubAdmin(user)
  const isPlatformAdminSettings = user?.role === 'super_admin'
  const canEditEmailTeamName = Boolean(user?.clubId)
    && !isParentSettings
    && !isClubAdminSettings
    && user?.role !== 'super_admin'
    && Number(user?.roleRank ?? 0) >= 50
  const showSenderIdentity = canEditEmailTeamName
  const showDisplaySettings = Boolean(user?.id)
  const showSetupChecklistSettings = Boolean(user?.id) && user?.role !== 'super_admin'
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
  const [isSendingVerification, setIsSendingVerification] = useState(false)
  const [reauthenticationNonce, setReauthenticationNonce] = useState('')
  const [isOpeningOnboarding, setIsOpeningOnboarding] = useState(false)
  const [onboardingSnapshot, setOnboardingSnapshot] = useState(null)
  const [isLoadingOnboardingSnapshot, setIsLoadingOnboardingSnapshot] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [themeMode, setThemeMode] = useState(getStoredThemeMode)
  const [themeAccent, setThemeAccent] = useState(getStoredThemeAccent)
  const [themeButtonStyle, setThemeButtonStyle] = useState(getStoredThemeButtonStyle)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const currentLoginEmail = String(user?.email || authUser?.email || '').trim().toLowerCase()
  const requestedLoginEmail = String(email || '').trim().toLowerCase()
  const isLoginEmailUnchanged = Boolean(currentLoginEmail) && requestedLoginEmail === currentLoginEmail

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

  useEffect(() => {
    let isMounted = true

    async function loadSetupProgress() {
      if (!user?.id || !showSetupChecklistSettings) {
        setOnboardingSnapshot(null)
        return
      }

      setIsLoadingOnboardingSnapshot(true)

      try {
        const nextSnapshot = await loadOnboardingSnapshot(user)

        if (isMounted) {
          setOnboardingSnapshot(nextSnapshot)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setOnboardingSnapshot(null)
        }
      } finally {
        if (isMounted) {
          setIsLoadingOnboardingSnapshot(false)
        }
      }
    }

    void loadSetupProgress()

    return () => {
      isMounted = false
    }
  }, [showSetupChecklistSettings, user, user?.activeTeamId, user?.clubId, user?.id])

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
        teamName: canEditEmailTeamName ? emailTeamName : user?.emailTeamName || user?.activeTeamName || '',
        clubName: canEditEmailClubName ? emailClubName : user?.emailClubName || user?.clubName || '',
        replyToEmail: showSenderIdentity ? replyToEmail : user?.replyToEmail || user?.email || authUser?.email || '',
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
      if (isLoginEmailUnchanged) {
        throw new Error('No change made. Enter a different login email.')
      }

      const result = await requestLoginEmailChange({
        authUser,
        email,
      })

      if (result.pendingConfirmation) {
        setSuccessMessage('Email change requested. Confirm the change from your email inbox.')
        showToast({ title: 'Email change requested', message: 'Check your inbox to confirm the new login email.' })
      } else if (result.unchanged) {
        setErrorMessage('No change made. Enter a different login email.')
        showToast({ title: 'Email not changed', message: 'Enter a different login email.', tone: 'error' })
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

      await updateSignedInPassword(passwordData.password, { nonce: reauthenticationNonce })
      setPasswordData(createInitialPasswordState())
      setReauthenticationNonce('')
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

  const handleSendPasswordVerification = async () => {
    if (isDemoSettings) {
      return
    }

    setIsSendingVerification(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      await requestPasswordReauthentication()
      setSuccessMessage('Verification code sent. Enter it before updating your password.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Verification code could not be sent.')
    } finally {
      setIsSendingVerification(false)
    }
  }

  const persistUserThemePreference = async (nextThemeMode) => {
    if (isDemoSettings) {
      return
    }

    try {
      const updatedProfile = await updateOwnThemeSettings({
        authUser,
        mode: nextThemeMode,
      })
      updateCurrentUserDetails({
        themeMode: updatedProfile.themeMode,
      })
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Theme not saved',
        message: 'Your display preference could not be updated right now.',
        tone: 'error',
      })
    }
  }

  const persistBrandingPreferences = async (nextPreferences) => {
    if (isDemoSettings || !canEditClubBranding) {
      return
    }

    try {
      const teamIds = user.activeTeamId
        ? [user.activeTeamId]
        : (await getTeams(user)).map((team) => team.id).filter(Boolean)

      if (teamIds.length === 0) {
        throw new Error('Create a team before editing club branding.')
      }

      const updatedTeams = await Promise.all(teamIds.map((teamId) =>
        updateTeamSettings({
          teamId,
          user,
          data: {
            themeAccent: nextPreferences.accent,
            themeButtonStyle: nextPreferences.buttonStyle,
          },
        }),
      ))
      const updatedTeam = updatedTeams[0]
      updateCurrentUserDetails({
        themeAccent: updatedTeam.themeAccent,
        themeButtonStyle: updatedTeam.themeButtonStyle,
      })
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Club branding not saved',
        message: 'The club branding could not be updated right now.',
        tone: 'error',
      })
    }
  }

  const handleThemeModeChange = (nextThemeMode) => {
    const nextPreferences = saveThemePreferences({
      mode: nextThemeMode,
      accent: themeAccent,
      buttonStyle: themeButtonStyle,
    })
    setThemeMode(nextPreferences.mode)
    setThemeAccent(nextPreferences.accent)
    setThemeButtonStyle(nextPreferences.buttonStyle)
    showToast({ title: 'Theme updated', message: 'Your display preference has been saved.' })
    void persistUserThemePreference(nextPreferences.mode)
  }

  const handleThemeAccentChange = (nextThemeAccent) => {
    if (!canEditClubBranding) {
      showToast({ title: 'Branding not changed', message: brandingUnavailableMessage, tone: 'error' })
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
    showToast({ title: 'Club branding updated', message: 'The club accent colour has been saved.' })
    void persistBrandingPreferences(nextPreferences)
  }

  const handleThemeButtonStyleChange = (nextThemeButtonStyle) => {
    if (!canEditClubBranding) {
      showToast({ title: 'Branding not changed', message: brandingUnavailableMessage, tone: 'error' })
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
    showToast({ title: 'Club branding updated', message: 'The club button style has been saved.' })
    void persistBrandingPreferences(nextPreferences)
  }

  const getOnboardingScope = () => (canManageClubSettings(user) || canManageTeamSettings(user) ? 'workspace' : 'user')

  const handleOpenSetup = () => {
    setIsOpeningOnboarding(true)

    try {
      openOnboarding()
      showToast({ title: 'Setup opened', message: 'The setup checklist is available in Settings.' })
    } catch (error) {
      console.error(error)
      showToast({ title: 'Setup not opened', message: error.message || 'Could not open setup.', tone: 'error' })
    } finally {
      window.setTimeout(() => setIsOpeningOnboarding(false), 250)
    }
  }

  const senderPreview = `${displayName || 'Display Name'} (${emailTeamName || 'Team'} - ${emailClubName || 'Club'})`
  const canEditClubBranding = isClubAdminSettings && canUseUiFeature(user, CAPABILITIES.customColoursBranding)
  const brandingUnavailableMessage = !isClubAdminSettings
    ? 'Club branding is set by a Club Admin. You can still choose your own display mode.'
    : !canUseUiFeature(user, CAPABILITIES.customColoursBranding)
        ? createUiFeatureUnavailableMessage(user, CAPABILITIES.customColoursBranding)
        : ''
  const canEditEmailClubName = showSenderIdentity && canEditClubIdentity(user)
  const workspaceLabel = isParentSettings
    ? 'Family portal'
    : user?.role === 'super_admin'
      ? 'Platform'
      : user?.clubName || 'No club assigned'
  const onboardingScope = getOnboardingScope()
  const onboardingScopeLabel = onboardingScope === 'workspace' ? 'workspace' : 'account'
  const onboardingPlan = buildOnboardingPlan(user, onboardingSnapshot ?? {})
  const onboardingProgress = getOnboardingProgress(onboardingPlan)
  const onboardingNextStep = onboardingPlan?.steps?.find((step) => !step.complete) ?? onboardingPlan?.steps?.[0] ?? null

  return (
    <div className="space-y-5 sm:space-y-6">
      {successMessage ? (
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#065f46] shadow-sm shadow-[#047857]/10">
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
              canEditBranding={canEditClubBranding}
              brandingUnavailableMessage={brandingUnavailableMessage}
              onThemeAccentChange={handleThemeAccentChange}
              onThemeButtonStyleChange={handleThemeButtonStyleChange}
              onThemeModeChange={handleThemeModeChange}
              showBrandingControls={isClubAdminSettings}
              themeAccent={themeAccent}
              themeButtonStyle={themeButtonStyle}
              themeMode={themeMode}
            />
          ) : null}

          {showSetupChecklistSettings ? (
            <SetupChecklistSettingsSection
              isHidden={Boolean(onboardingPlan?.manualState?.dismissedAt)}
              isLoading={isLoadingOnboardingSnapshot}
              isOpening={isOpeningOnboarding}
              nextStep={onboardingNextStep}
              onOpen={handleOpenSetup}
              plan={onboardingPlan}
              progress={onboardingProgress}
              scopeLabel={onboardingScopeLabel}
            />
          ) : null}

          <LoginEmailSection
            currentEmail={currentLoginEmail}
            email={email}
            isEmailUnchanged={isLoginEmailUnchanged}
            isDemoSettings={isDemoSettings}
            isSavingEmail={isSavingEmail}
            onEmailChange={setEmail}
            onSubmit={handleEmailSubmit}
          />

          <PasswordSettingsSection
            isDemoSettings={isDemoSettings}
            isSavingPassword={isSavingPassword}
            isSendingReset={isSendingReset}
            isSendingVerification={isSendingVerification}
            onPasswordDataChange={(fieldName, value) =>
              setPasswordData((current) => ({
                ...current,
                [fieldName]: value,
              }))
            }
            onResetPassword={() => void handleResetPassword()}
            onReauthenticationNonceChange={setReauthenticationNonce}
            onSendVerification={() => void handleSendPasswordVerification()}
            onShowPasswordChange={setShowPassword}
            onSubmit={handlePasswordSubmit}
            passwordData={passwordData}
            reauthenticationNonce={reauthenticationNonce}
            showPassword={showPassword}
          />

          {isPlatformAdminSettings || isClubAdminSettings ? (
            <PrivilegedMfaSection isPlatformAdmin={isPlatformAdminSettings} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
