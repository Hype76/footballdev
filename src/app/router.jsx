/* eslint-disable react-refresh/only-export-components */
import { Component, Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom'
import { Layout } from '../components/layout/Layout.jsx'
import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageEmailQueue,
  canManageFeedbackForms,
  canManageFormFields,
  canManageMatchDay,
  canManageParentEmailTemplates,
  canManageParentLinks,
  canManagePolls,
  canManageTeamSettings,
  canManageUsers,
  canViewActivityLog,
  canViewBilling,
  canViewEndSeasonStats,
  hasTeamWorkflowContext,
  isClubAdmin,
  isSuperAdmin,
  isParentPortalUser,
  isTesterAccessExpired,
  needsTeamWorkflowContext,
  useAuth,
} from '../lib/auth.js'
import { clearChunkRecoveryMarker, isDynamicImportError, recoverFromStaleChunk } from '../lib/chunkRecovery.js'
import { isPlanAccessActive } from '../lib/plans.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature, createUiFeatureUnavailableMessage, getRouteCapability } from '../lib/paywall-ui.js'
import { buildParentAppUrl, getMainAppOrigin, isParentPortalHost } from '../lib/app-origins.js'
import {
  canOpenParentPortal,
  getSignedInAccountEmail,
  hasActiveParentPortalLink,
  isParentIntentPath,
  rememberParentAccessIntent,
} from '../lib/parent-auth-intent.js'
import { CURRENT_RECOVERY_PHASE, isRecoveryModuleVisible, isRecoveryPathVisible } from '../lib/recovery-phase.js'

function lazyRoute(importer, exportName) {
  return lazy(async () => {
    try {
      const module = await importer()
      clearChunkRecoveryMarker()
      return { default: module[exportName] }
    } catch (error) {
      if (recoverFromStaleChunk(error)) {
        return new Promise(() => {})
      }

      throw error
    }
  })
}

const AddPlayerPage = lazyRoute(() => import('../pages/AddPlayerPage.jsx'), 'AddPlayerPage')
const ActivityLogPage = lazyRoute(() => import('../pages/ActivityLogPage.jsx'), 'ActivityLogPage')
const ArchivedPlayersPage = lazyRoute(() => import('../pages/ArchivedPlayersPage.jsx'), 'ArchivedPlayersPage')
const BillingPage = lazyRoute(() => import('../pages/BillingPage.jsx'), 'BillingPage')
const ClubSettingsPage = lazyRoute(() => import('../pages/ClubSettingsPage.jsx'), 'ClubSettingsPage')
const CoachHomePage = lazyRoute(() => import('../pages/CoachHomePage.jsx'), 'CoachHomePage')
const ClubOwnerInvitePage = lazyRoute(() => import('../pages/ClubOwnerInvitePage.jsx'), 'ClubOwnerInvitePage')
const AssessmentsMenuPage = lazyRoute(() => import('../pages/CoachActionMenuPages.jsx'), 'AssessmentsMenuPage')
const PlayersMenuPage = lazyRoute(() => import('../pages/CoachActionMenuPages.jsx'), 'PlayersMenuPage')
const SessionsMenuPage = lazyRoute(() => import('../pages/CoachActionMenuPages.jsx'), 'SessionsMenuPage')
const CreateEvaluationPage = lazyRoute(() => import('../pages/CreateEvaluationPage.jsx'), 'CreateEvaluationPage')
const EndSeasonStatsPage = lazyRoute(() => import('../pages/EndSeasonStatsPage.jsx'), 'EndSeasonStatsPage')
const EmailQueuePage = lazyRoute(() => import('../pages/EmailQueuePage.jsx'), 'EmailQueuePage')
const FeedbackFormsPage = lazyRoute(() => import('../pages/FeedbackFormsPage.jsx'), 'FeedbackFormsPage')
const FormBuilderPage = lazyRoute(() => import('../pages/FormBuilderPage.jsx'), 'FormBuilderPage')
const GdprPage = lazyRoute(() => import('../pages/GdprPage.jsx'), 'GdprPage')
const InformationPage = lazyRoute(() => import('../pages/InformationPage.jsx'), 'InformationPage')
const LoginPage = lazyRoute(() => import('../pages/LoginPage.jsx'), 'LoginPage')
const MatchDayPage = lazyRoute(() => import('../pages/MatchDayPage.jsx'), 'MatchDayPage')
const NotFoundPage = lazyRoute(() => import('../pages/NotFoundPage.jsx'), 'NotFoundPage')
const ParentEmailTemplatesPage = lazyRoute(() => import('../pages/ParentEmailTemplatesPage.jsx'), 'ParentEmailTemplatesPage')
const ParentInvitePage = lazyRoute(() => import('../pages/ParentInvitePage.jsx'), 'ParentInvitePage')
const ParentLoginPage = lazyRoute(() => import('../pages/ParentLoginPage.jsx'), 'ParentLoginPage')
const ParentLinkingPage = lazyRoute(() => import('../pages/ParentLinkingPage.jsx'), 'ParentLinkingPage')
const ParentMessagesPage = lazyRoute(() => import('../pages/ParentMessagesPage.jsx'), 'ParentMessagesPage')
const ParentPollsPage = lazyRoute(() => import('../pages/ParentPollsPage.jsx'), 'ParentPollsPage')
const ParentPortalPage = lazyRoute(() => import('../pages/ParentPortalPage.jsx'), 'ParentPortalPage')
const FriendsFamilyPage = lazyRoute(() => import('../pages/FriendsFamilyPage.jsx'), 'FriendsFamilyPage')
const PlayerProfile = lazyRoute(() => import('../pages/PlayerProfile.jsx'), 'PlayerProfile')
const PlayersPage = lazyRoute(() => import('../pages/PlayersPage.jsx'), 'PlayersPage')
const PlatformAdminPage = lazyRoute(() => import('../pages/PlatformAdminPage.jsx'), 'PlatformAdminPage')
const PlatformBillingOptionsPage = lazyRoute(() => import('../pages/PlatformBillingOptionsPage.jsx'), 'PlatformBillingOptionsPage')
const PlatformClubManagementPage = lazyRoute(() => import('../pages/PlatformClubManagementPage.jsx'), 'PlatformClubManagementPage')
const PlatformFeedbackPage = lazyRoute(() => import('../pages/PlatformFeedbackPage.jsx'), 'PlatformFeedbackPage')
const PollsPage = lazyRoute(() => import('../pages/PollsPage.jsx'), 'PollsPage')
const PublicFeaturesPage = lazyRoute(() => import('../pages/PublicFeaturesPage.jsx'), 'PublicFeaturesPage')
const PublicLandingPage = lazyRoute(() => import('../pages/PublicLandingPage.jsx'), 'PublicLandingPage')
const PublicParentPortalLoginPage = lazyRoute(() => import('../pages/PublicParentPortalLoginPage.jsx'), 'PublicParentPortalLoginPage')
const PublicParentsPage = lazyRoute(() => import('../pages/PublicParentsPage.jsx'), 'PublicParentsPage')
const PublicPricingPage = lazyRoute(() => import('../pages/PublicPricingPage.jsx'), 'PublicPricingPage')
const ResetPasswordPage = lazyRoute(() => import('../pages/ResetPasswordPage.jsx'), 'ResetPasswordPage')
const SessionsPage = lazyRoute(() => import('../pages/SessionsPage.jsx'), 'SessionsPage')
const StaffInvitePage = lazyRoute(() => import('../pages/StaffInvitePage.jsx'), 'StaffInvitePage')
const TeamManagementPage = lazyRoute(() => import('../pages/TeamManagementPage.jsx'), 'TeamManagementPage')
const TesterFeedbackPage = lazyRoute(() => import('../pages/TesterFeedbackPage.jsx'), 'TesterFeedbackPage')
const TermsPage = lazyRoute(() => import('../pages/TermsPage.jsx'), 'TermsPage')
const UserAccessPage = lazyRoute(() => import('../pages/UserAccessPage.jsx'), 'UserAccessPage')
const UserSettingsPage = lazyRoute(() => import('../pages/UserSettingsPage.jsx'), 'UserSettingsPage')

const primaryActionClassName =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#0f9f6e] focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60'

const secondaryActionClassName =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#0f9f6e] focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60'

const supportEmail = 'support@footballplayer.online'

function LoadingScreen() {
  const showLoader = useDelayedLoader()

  if (!showLoader) {
    return <main className="min-h-screen bg-[var(--app-bg)]" aria-hidden="true" />
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 py-8 text-[var(--text-primary)]">
      <div className="route-loading-panel rounded-lg px-6 py-5 text-sm font-bold">
        Loading...
      </div>
    </main>
  )
}

function useDelayedLoader(delay = 350) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setIsVisible(true), delay)

    return () => window.clearTimeout(timer)
  }, [delay])

  return isVisible
}

function DelayedRouteFallback() {
  const showLoader = useDelayedLoader()

  if (!showLoader) {
    return null
  }

  return (
    <div className="route-minimal-loader px-4 py-6 text-sm font-bold text-[var(--text-muted)]" role="status" aria-live="polite">
      Loading...
    </div>
  )
}

function ExternalRedirect({ to }) {
  window.location.replace(to)
  return <LoadingScreen />
}

function isParentHost() {
  return isParentPortalHost()
}

function getParentLoginTarget() {
  return isParentHost() ? '/parent-login' : buildParentAppUrl('/parent-login')
}

function ParentLoginRedirect() {
  if (isParentHost()) {
    return <Navigate to="/parent-login" replace />
  }

  return <ExternalRedirect to={buildParentAppUrl('/parent-login')} />
}

function NavigateToParentInvite() {
  return <Navigate to={window.location.pathname.replace(/^\/invite\//, '/parent-invite/')} replace />
}

const accountRecoveryRules = [
  {
    title: 'Session is active',
    body: 'This browser is signed in, but the account still needs a matching profile or parent portal link.',
  },
  {
    title: 'Parent link is missing',
    body: 'We could not find an active parent portal link for this account.',
  },
  {
    title: 'Use the invite email',
    body: 'Make sure you are using the same email address that received the parent portal invite.',
  },
]

function RouteGateState({ title, message, eyebrow = 'Workspace', actions = null, rules = [] }) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="px-5 py-6 sm:px-6 lg:px-8">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.05] tracking-tight text-[#101828] sm:text-4xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">{message}</p>
            {actions ? <div className="mt-6 flex flex-col gap-3 sm:flex-row">{actions}</div> : null}
          </div>

          {rules.length > 0 ? (
            <aside className="border-t border-[#d1fae5] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">What this means</p>
              <div className="mt-4 space-y-2">
                {rules.map((rule) => (
                  <article key={rule.title} className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
                    <p className="text-sm font-black text-[#101828]">{rule.title}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{rule.body}</p>
                  </article>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function AccountDetailsUnavailableState({ message }) {
  const { signOut } = useAuth()

  const handleSignInAgain = async () => {
    try {
      await signOut()
    } finally {
      window.sessionStorage.clear()
      window.location.assign(isParentHost() ? '/parent-login' : '/sign-in')
    }
  }

  return (
    <RouteGateState
      title="Account details unavailable"
      message={message || 'Your login session is active, but this account is not linked to an active parent portal profile. Ask your club or team contact to resend your parent portal invite, then sign in with the same email address that received it.'}
      rules={accountRecoveryRules}
      actions={(
        <>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={primaryActionClassName}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={handleSignInAgain}
            className={secondaryActionClassName}
          >
            Sign in again
          </button>
        </>
      )}
    />
  )
}

function ParentAccountIntentState({ session, type = 'mismatch', user }) {
  const { signOut } = useAuth()
  const email = getSignedInAccountEmail({ user, session })
  const isNoLink = type === 'no-link'

  const handleSwitchToParentLogin = async () => {
    try {
      await signOut()
    } finally {
      rememberParentAccessIntent()
      window.location.assign(getParentLoginTarget())
    }
  }

  return (
    <RouteGateState
      eyebrow="Parent portal"
      title={isNoLink ? 'Parent access is not linked yet' : 'Use a parent account for the Parent Portal'}
      message={isNoLink
        ? 'This signed-in parent account is not linked to a child yet. Ask the club to send or refresh your parent invite, or sign out and continue with the linked parent account.'
        : `You are currently signed in${email ? ` as ${email}` : ''}. To use the Parent Portal, sign out and continue with a parent account.`}
      rules={[
        { title: 'Parent access only', body: 'The Parent Portal opens only for accounts with an active parent-child link.' },
        { title: 'Main session protected', body: 'A staff or main-platform session cannot silently open the Parent Portal or reroute this parent action.' },
      ]}
      actions={(
        <>
          <button
            type="button"
            onClick={handleSwitchToParentLogin}
            className={primaryActionClassName}
          >
            Sign out and continue to Parent Login
          </button>
          <a href={getMainAppOrigin()} className={secondaryActionClassName}>
            Go to main platform
          </a>
        </>
      )}
    />
  )
}

function ClubSuspendedState() {
  return (
    <RouteGateState
      eyebrow="Club access"
      title="Club access suspended"
      message="This club workspace has been suspended by the platform admin. Contact platform support if this should be reactivated."
      rules={[
        { title: 'Data is retained', body: 'Suspension blocks access without removing club records.' },
        { title: 'Platform controlled', body: 'Only a platform admin can reactivate this workspace.' },
      ]}
    />
  )
}

function AccountSuspendedState() {
  return (
    <RouteGateState
      eyebrow="Account access"
      title="Account access suspended"
      message="This account has been suspended. Contact your club admin or platform support if this should be reactivated."
      rules={[
        { title: 'Access is blocked', body: 'This login cannot open club tools while suspended.' },
        { title: 'Ask an admin', body: 'A club admin or platform admin needs to review the account.' },
      ]}
    />
  )
}

function TesterAccessExpiredState() {
  return (
    <RouteGateState
      eyebrow="Billing"
      title="Workspace access needs review"
      message="This workspace needs plan access reviewed before staff can continue using club tools. Your existing club data remains safe."
      rules={[
        { title: 'Club records stay safe', body: 'Plan access gates tools without deleting saved football data.' },
        { title: 'Ask your Club Admin', body: 'A Club Admin or support can review billing and plan access for this workspace.' },
      ]}
      actions={(
        <a
          href={`mailto:${supportEmail}`}
          className={primaryActionClassName}
        >
          Contact support
        </a>
      )}
    />
  )
}

function PlanAccessRequiredState() {
  return (
    <RouteGateState
      eyebrow="Billing"
      title="Plan access needs attention"
      message="This workspace needs an active plan before staff can keep using club tools. Your existing club data remains safe."
      rules={[
        { title: 'Club records stay safe', body: 'Billing gates access to tools without deleting saved football data.' },
        { title: 'Plan required', body: 'An active plan is needed before staff can continue daily operations.' },
      ]}
      actions={(
        <a
          href={`mailto:${supportEmail}`}
          className={primaryActionClassName}
        >
          Contact support
        </a>
      )}
    />
  )
}

function RecoveryPhaseBlockedState() {
  return (
    <RouteGateState
      eyebrow="Recovery"
      title="This area is hidden during Phase 1"
      message={`Football Player is in Phase ${CURRENT_RECOVERY_PHASE} recovery. This module is not part of the current test surface, so it is hidden until the core tools are trusted.`}
      rules={[
        { title: 'Core tools first', body: 'Phase 1 is limited to setup, teams, players, sessions, and development records.' },
        { title: 'No data changed', body: 'This block only prevents access to an unfinished recovery surface.' },
      ]}
      actions={(
        <a href="/coach" className={primaryActionClassName}>
          Return to workspace
        </a>
      )}
    />
  )
}

function FormBuilderUnavailableState() {
  return (
    <RouteGateState
      eyebrow="Development fields"
      title="Development fields are managed from team-level access."
      message="Choose a team-level coach, manager, or team admin account to manage custom development fields for that team."
      actions={(
        <a href="/coach" className={secondaryActionClassName}>
          Return to workspace
        </a>
      )}
    />
  )
}

function FeedbackFormsUnavailableState() {
  return (
    <RouteGateState
      eyebrow="Feedback forms"
      title="Feedback forms are managed by Managers and Team Admins."
      message="Coaches can complete active feedback forms, but reusable form structure is managed by the team leads."
      actions={(
        <a href="/coach" className={secondaryActionClassName}>
          Return to workspace
        </a>
      )}
    />
  )
}

function EmailTemplatesUnavailableState() {
  return (
    <RouteGateState
      eyebrow="Email templates"
      title="Email templates are managed by your club admin."
      message="This area is not available for your current role or plan. Parent email templates stay managed by the club admin so staff use approved parent updates."
      actions={(
        <a href="/coach" className={secondaryActionClassName}>
          Return to workspace
        </a>
      )}
    />
  )
}

function TeamContextRequiredState() {
  const { isProfileLoading, selectTeam, teamOptions, user } = useAuth()

  const handleTeamSelect = async (teamId) => {
    try {
      await selectTeam(teamId)
    } catch (error) {
      console.error(error)
    }
  }

  const hasTeams = teamOptions.length > 0

  useEffect(() => {
    if (teamOptions.length !== 1 || isProfileLoading || isClubAdmin(user)) {
      return
    }

    void handleTeamSelect(teamOptions[0].id)
  // Auto-select applies only while this blocked route is mounted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfileLoading, teamOptions])

  if (!hasTeams) {
    return (
      <RouteGateState
        eyebrow="Team access"
        title="Choose your team"
        message="This account is not linked to a team yet. Ask a club admin to add this account to a team before using team tools."
        actions={(
          <a href="/coach" className={secondaryActionClassName}>
            Return to club home
          </a>
        )}
      />
    )
  }

  return (
    <section className="mx-auto max-w-4xl rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-7">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Team access</p>
      <h1 className="mt-3 text-3xl font-black leading-[1.05] tracking-tight text-[#101828] sm:text-4xl">Choose your team</h1>
      <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-[#4b5f55]">
        You are linked to more than one team. Select the team you want to work with.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {teamOptions.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => void handleTeamSelect(team.id)}
            disabled={isProfileLoading}
            className="group flex min-h-24 w-full items-center justify-between gap-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-left shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block truncate text-base font-black text-[#101828]">{team.name || 'Unnamed team'}</span>
              <span className="mt-1 block text-sm font-semibold text-[#4b5f55]">{team.roleLabel || team.role || team.accessLabel || 'Team access'}</span>
            </span>
            <span className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 text-sm font-black text-[#047857] transition group-hover:border-[#047857] group-hover:bg-[#047857] group-hover:text-white">
              {isProfileLoading ? 'Opening...' : 'Open team'}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function FeatureUnavailableState({ capability, user }) {
  const title = capability ? 'This feature is not available' : 'This area is not available'
  const message = createUiFeatureUnavailableMessage(user, capability)

  return (
    <RouteGateState
      eyebrow="Plan access"
      title={title}
      message={message}
      rules={[
        { title: 'No data changed', body: 'This block only prevents access to a feature that is not available for this workspace.' },
        { title: 'Existing records stay safe', body: 'Saved club, team, player, and parent records are not removed by plan access checks.' },
      ]}
      actions={(
        <a href="/coach" className={secondaryActionClassName}>
          Return to workspace
        </a>
      )}
    />
  )
}

function RouteFeatureUnavailableState({ path, user }) {
  return <FeatureUnavailableState capability={getRouteCapability(path)} user={user} />
}

function isClubSuspended(user) {
  return user?.clubStatus === 'suspended'
}

function isAccountSuspended(user) {
  return user?.accountStatus === 'suspended'
}

function getDefaultWorkspacePath(user) {
  if (!user) {
    return '/'
  }

  if (isSuperAdmin(user)) {
    return '/platform-admin'
  }

  if (isParentPortalUser(user)) {
    return '/parent-portal'
  }

  if (isAccountSuspended(user) || isClubSuspended(user)) {
    return '/'
  }

  if (isTesterAccessExpired(user)) {
    return canViewBilling(user) ? '/billing' : '/coach'
  }

  if (!isPlanAccessActive(user)) {
    return canViewBilling(user) ? '/billing' : '/coach'
  }

  if (canManageTeamSettings(user)) {
    return '/coach'
  }

  if (canCreateEvaluation(user)) {
    return '/coach'
  }

  if (canManageUsers(user)) {
    return '/user-access'
  }

  return '/information'
}

function RedirectToWorkspaceHome({ user }) {
  if (isParentHost() && user && !isParentPortalUser(user)) {
    return <ExternalRedirect to={getMainAppOrigin()} />
  }

  return <Navigate to={getDefaultWorkspacePath(user)} replace />
}

function useWorkspaceRouteGate({
  redirectSuperAdmin = true,
  blockExpiredTester = true,
  requireActivePlan = false,
  showPlanAccessState = false,
  parentIntent = false,
} = {}) {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return { element: <LoadingScreen />, user: null }
  }

  if (!session?.user) {
    if (parentIntent) {
      return { element: <ParentLoginRedirect />, user: null }
    }

    return { element: <Navigate to={isParentHost() ? '/parent-login' : '/sign-in'} replace />, user: null }
  }

  if (!user && isProfileLoading) {
    return { element: <DelayedRouteFallback />, user: null }
  }

  if (!user) {
    return {
      element: <AccountDetailsUnavailableState message={authError} />,
      user: null,
    }
  }

  if (parentIntent) {
    if (!isParentPortalUser(user)) {
      return { element: <ParentAccountIntentState session={session} user={user} />, user }
    }

    if (!hasActiveParentPortalLink(user)) {
      return { element: <ParentAccountIntentState session={session} type="no-link" user={user} />, user }
    }

    return { element: null, user }
  }

  if (redirectSuperAdmin && isSuperAdmin(user)) {
    return { element: isParentHost() ? <ExternalRedirect to={getMainAppOrigin()} /> : <Navigate to="/platform-admin" replace />, user }
  }

  if (isParentHost() && !isParentPortalUser(user)) {
    return { element: <ExternalRedirect to={getMainAppOrigin()} />, user }
  }

  if (isParentHost() && isParentPortalUser(user)) {
    return { element: <Navigate to="/parent-portal" replace />, user }
  }

  if (!redirectSuperAdmin && isParentPortalUser(user)) {
    return { element: null, user }
  }

  if (isAccountSuspended(user)) {
    return { element: <AccountSuspendedState />, user }
  }

  if (isClubSuspended(user)) {
    return { element: <ClubSuspendedState />, user }
  }

  if (blockExpiredTester && isTesterAccessExpired(user)) {
    return { element: <TesterAccessExpiredState />, user }
  }

  if (requireActivePlan && !isPlanAccessActive(user)) {
    return {
      element: showPlanAccessState ? <PlanAccessRequiredState /> : <RedirectToWorkspaceHome user={user} />,
      user,
    }
  }

  return { element: null, user }
}

function RouteErrorFallback({ error }) {
  const isChunkError = isDynamicImportError(error)
  const title = isChunkError ? 'App update needed' : 'This page could not load'
  const message = isChunkError
    ? 'A new version has been deployed and this browser still has an old page file. Refresh once to load the latest version.'
    : 'The page hit an unexpected error. Refresh the page or return to your workspace.'

  return (
    <RouteGateState
      eyebrow="Page error"
      title={title}
      message={message}
      rules={[
        {
          title: isChunkError ? 'Old app file' : 'Route failed',
          body: isChunkError
            ? 'The browser kept an older JavaScript file after a new build.'
            : 'The current route stopped before the workspace could finish loading.',
        },
        {
          title: 'No data changed',
          body: 'Refreshing the app does not remove club, player, parent, or match records.',
        },
      ]}
      actions={(
        <>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={primaryActionClassName}
          >
            Refresh app
          </button>
          <a
            href="/"
            className={secondaryActionClassName}
          >
            Go to workspace
          </a>
        </>
      )}
    />
  )
}

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      error: null,
    }
  }

  static getDerivedStateFromError(error) {
    return {
      error,
    }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (this.state.error) {
      return <RouteErrorFallback error={this.state.error} />
    }

    return this.props.children
  }
}

function PageSuspense({ children }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<DelayedRouteFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}

function WorkspaceHome() {
  const { authError, isProfileLoading, user } = useAuth()

  if (!user && isProfileLoading) {
    return <DelayedRouteFallback />
  }

  if (!user) {
    return <AccountDetailsUnavailableState message={authError} />
  }

  if (isSuperAdmin(user)) {
    return isParentHost() ? <ExternalRedirect to={getMainAppOrigin()} /> : <Navigate to="/platform-admin" replace />
  }

  if (isParentHost() && !isParentPortalUser(user)) {
    return <ExternalRedirect to={getMainAppOrigin()} />
  }

  if (isParentPortalUser(user)) {
    return <Navigate to="/parent-portal" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return canViewBilling(user) ? <Navigate to="/billing" replace /> : <TesterAccessExpiredState />
  }

  if (!isPlanAccessActive(user)) {
    return canViewBilling(user) ? <Navigate to="/billing" replace /> : <PlanAccessRequiredState />
  }

  return <RedirectToWorkspaceHome user={user} />
}

function PublicLandingOrWorkspaceHome() {
  const { isLoading, session } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return isParentHost() ? (
      <Navigate to="/parent-login" replace />
    ) : (
      <PageSuspense>
        <PublicLandingPage />
      </PageSuspense>
    )
  }

  if (isParentHost()) {
    return <Navigate to="/parent-portal" replace />
  }

  return (
    <PageSuspense>
      <WorkspaceHome />
    </PageSuspense>
  )
}

function RequireUser() {
  const location = useLocation()
  const { isLoading, session } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    if (isParentIntentPath(location.pathname)) {
      return <ParentLoginRedirect />
    }

    return <Navigate to={isParentHost() ? '/parent-login' : '/sign-in'} replace />
  }

  return <Outlet />
}

function RequireClubWorkspace() {
  const { element } = useWorkspaceRouteGate({
    requireActivePlan: true,
    showPlanAccessState: true,
  })

  if (element) {
    return element
  }

  return <Outlet />
}

function RequirePlayerWorkflowAccess() {
  const { element, user } = useWorkspaceRouteGate()
  const location = useLocation()
  const routeCapability = getRouteCapability(location.pathname)

  if (element) {
    return element
  }

  if (!isRecoveryPathVisible(location.pathname, { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if ((location.pathname === '/calendar' || location.pathname.startsWith('/calendar/')) && isClubAdmin(user)) {
    if (canUseUiFeature(user, CAPABILITIES.clubWideCalendar)) {
      return <Outlet />
    }

    return <FeatureUnavailableState capability={CAPABILITIES.clubWideCalendar} user={user} />
  }

  if (needsTeamWorkflowContext(user) || !hasTeamWorkflowContext(user)) {
    return <TeamContextRequiredState />
  }

  if (!canCreateEvaluation(user) || !canUseUiFeature(user, routeCapability)) {
    if (routeCapability) {
      return <FeatureUnavailableState capability={routeCapability} user={user} />
    }

    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireParentPortalAccess() {
  const location = useLocation()
  const { element, user } = useWorkspaceRouteGate({
    redirectSuperAdmin: false,
    blockExpiredTester: false,
    parentIntent: true,
  })

  if (element) {
    return element
  }

  if (!canOpenParentPortal(user)) {
    return <ParentAccountIntentState type={isParentPortalUser(user) ? 'no-link' : 'mismatch'} user={user} />
  }

  if (!isRecoveryPathVisible(location.pathname, { user })) {
    return <RecoveryPhaseBlockedState />
  }

  return <Outlet />
}

function RequireParentLinkingAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('parentInvites', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (needsTeamWorkflowContext(user)) {
    return <TeamContextRequiredState />
  }

  if (!canManageParentLinks(user) || !canUseUiFeature(user, CAPABILITIES.parentInvitations)) {
    return <FeatureUnavailableState capability={CAPABILITIES.parentInvitations} user={user} />
  }

  return <Outlet />
}

function RequireEmailQueueAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('emailMessages', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (needsTeamWorkflowContext(user)) {
    return <TeamContextRequiredState />
  }

  if (!canManageEmailQueue(user) || !canUseUiFeature(user, CAPABILITIES.parentEmails)) {
    return <FeatureUnavailableState capability={CAPABILITIES.parentEmails} user={user} />
  }

  return <Outlet />
}

function RequirePollAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('pollsAvailability', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (!canManagePolls(user) || !canUseUiFeature(user, CAPABILITIES.teamPolls)) {
    return <FeatureUnavailableState capability={CAPABILITIES.teamPolls} user={user} />
  }

  return <Outlet />
}

function RequireMatchDayAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('matchDay', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (needsTeamWorkflowContext(user)) {
    return <TeamContextRequiredState />
  }

  if (!canManageMatchDay(user) || !canUseUiFeature(user, CAPABILITIES.matchDay)) {
    return <FeatureUnavailableState capability={CAPABILITIES.matchDay} user={user} />
  }

  return <Outlet />
}

function PublicOnly() {
  const location = useLocation()
  const { isLoading, session } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (session?.user) {
    if (isParentIntentPath(location.pathname)) {
      return <Outlet />
    }

    return <Navigate to={isParentHost() ? '/parent-portal' : '/'} replace />
  }

  return <Outlet />
}

function RequireFormBuilderAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('formBuilder', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (!canManageFormFields(user)) {
    return <FormBuilderUnavailableState />
  }

  if (!canUseUiFeature(user, CAPABILITIES.customDevelopmentFields)) {
    return <FeatureUnavailableState capability={CAPABILITIES.customDevelopmentFields} user={user} />
  }

  return <Outlet />
}

function RequireFeedbackFormsAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('formBuilder', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (!canManageFeedbackForms(user)) {
    return <FeedbackFormsUnavailableState />
  }

  if (!canUseUiFeature(user, CAPABILITIES.customDevelopmentFields)) {
    return <FeatureUnavailableState capability={CAPABILITIES.customDevelopmentFields} user={user} />
  }

  return <Outlet />
}

function RequireParentEmailTemplatesAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageParentEmailTemplates(user)) {
    return <EmailTemplatesUnavailableState />
  }

  if (!isRecoveryModuleVisible('emailMessages', { user })) {
    return <EmailTemplatesUnavailableState />
  }

  if (!canUseUiFeature(user, CAPABILITIES.parentEmails)) {
    return <FeatureUnavailableState capability={CAPABILITIES.parentEmails} user={user} />
  }

  return <Outlet />
}

function RequireClubSettingsAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageClubSettings(user) || !canUseUiFeature(user, CAPABILITIES.basicLogoBranding)) {
    return <FeatureUnavailableState capability={CAPABILITIES.basicLogoBranding} user={user} />
  }

  return <Outlet />
}

function RequireBillingAccess() {
  const { element, user } = useWorkspaceRouteGate({
    blockExpiredTester: false,
  })

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('billing', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (!canViewBilling(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireUserAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageUsers(user) || !canUseUiFeature(user, CAPABILITIES.teamStaffRoles)) {
    return <FeatureUnavailableState capability={CAPABILITIES.teamStaffRoles} user={user} />
  }

  return <Outlet />
}

function RequireTeamSettingsAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageTeamSettings(user) || !canUseUiFeature(user, CAPABILITIES.teamStaffRoles)) {
    return <FeatureUnavailableState capability={CAPABILITIES.teamStaffRoles} user={user} />
  }

  return <Outlet />
}

function RequireEndSeasonStatsAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canViewEndSeasonStats(user) || !canUseUiFeature(user, CAPABILITIES.basicClubAnalytics)) {
    return <FeatureUnavailableState capability={CAPABILITIES.basicClubAnalytics} user={user} />
  }

  if (!isRecoveryModuleVisible('reports', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  return <Outlet />
}

function RequireActivityLogAccess() {
  const { element, user } = useWorkspaceRouteGate({
    redirectSuperAdmin: false,
  })

  if (element) {
    return element
  }

  if (!canViewActivityLog(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  if (!isRecoveryModuleVisible('activityLog', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  if (!isSuperAdmin(user) && !canUseUiFeature(user, CAPABILITIES.fullOperationalAuditLog)) {
    return <FeatureUnavailableState capability={CAPABILITIES.fullOperationalAuditLog} user={user} />
  }

  return <Outlet />
}

function RequirePlatformFeedbackAccess() {
  const { element, user } = useWorkspaceRouteGate({
    redirectSuperAdmin: false,
    blockExpiredTester: false,
  })

  if (element) {
    return element
  }

  if (!isRecoveryModuleVisible('platformFeedback', { user })) {
    return <RecoveryPhaseBlockedState />
  }

  return <Outlet />
}

function RequireTesterFeedbackAccess() {
  const { element } = useWorkspaceRouteGate({
    redirectSuperAdmin: false,
    blockExpiredTester: false,
  })

  if (element) {
    return element
  }

  return <Outlet />
}

function RequirePlatformAdminAccess() {
  const { element, user } = useWorkspaceRouteGate({
    redirectSuperAdmin: false,
    blockExpiredTester: false,
  })

  if (element) {
    return element
  }

  if (!isSuperAdmin(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

export const router = createBrowserRouter([
  {
    index: true,
    element: <PublicLandingOrWorkspaceHome />,
  },
  {
    path: '/invite/:token',
    element: <NavigateToParentInvite />,
  },
  {
    path: '/staff-invite/:token',
    element: (
      <Suspense fallback={null}>
        <StaffInvitePage />
      </Suspense>
    ),
  },
  {
    path: '/club-invite/:token',
    element: (
      <Suspense fallback={null}>
        <ClubOwnerInvitePage />
      </Suspense>
    ),
  },
  {
    path: '/portal',
    element: <Navigate to="/parent-portal" replace />,
  },
  {
    path: '/login',
    element: isParentHost() ? (
      <Navigate to="/parent-login" replace />
    ) : (
      <PublicOnly />
    ),
    children: isParentHost()
      ? []
      : [
          {
            index: true,
            element: (
              <PageSuspense>
                <PublicLandingPage />
              </PageSuspense>
            ),
          },
        ],
  },
  {
    path: '/sign-in',
    element: <PublicOnly />,
    children: [
      {
        index: true,
        element: (
          <PageSuspense>
            <LoginPage />
          </PageSuspense>
        ),
      },
    ],
  },
  {
    path: '/home',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/landing',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/features',
    element: <PublicOnly />,
    children: [
      {
        index: true,
        element: (
          <PageSuspense>
            <PublicFeaturesPage />
          </PageSuspense>
        ),
      },
    ],
  },
  {
    path: '/parents',
    element: <PublicOnly />,
    children: [
      {
        index: true,
        element: (
          <PageSuspense>
            <PublicParentsPage />
          </PageSuspense>
        ),
      },
      {
        path: 'portal',
        element: (
          <PageSuspense>
            <PublicParentPortalLoginPage />
          </PageSuspense>
        ),
      },
    ],
  },
  {
    path: '/pricing',
    element: <PublicOnly />,
    children: [
      {
        index: true,
        element: (
          <PageSuspense>
            <PublicPricingPage />
          </PageSuspense>
        ),
      },
    ],
  },
  {
    path: '/gdpr',
    element: (
      <PageSuspense>
        <GdprPage />
      </PageSuspense>
    ),
  },
  {
    path: '/terms',
    element: (
      <PageSuspense>
        <TermsPage />
      </PageSuspense>
    ),
  },
  {
    path: '/parent-invite/:token',
    element: (
      <PageSuspense>
        <ParentInvitePage />
      </PageSuspense>
    ),
  },
  {
    path: '/parent-login',
    element: (
      <PageSuspense>
        <ParentLoginPage />
      </PageSuspense>
    ),
  },
  {
    element: <RequireUser />,
    children: [
      {
        path: '/reset-password',
        element: (
          <PageSuspense>
            <ResetPasswordPage />
          </PageSuspense>
        ),
      },
      {
        element: <Layout />,
        children: [
          {
            path: 'dashboard',
            element: <Navigate to="/" replace />,
          },
          {
            element: <RequirePlatformAdminAccess />,
            children: [
              {
                path: 'platform-admin',
                element: (
                  <PageSuspense>
                    <PlatformAdminPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Platform Admin',
                },
              },
              {
                path: 'platform-clubs',
                element: (
                  <PageSuspense>
                    <PlatformClubManagementPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Club and Team Management',
                },
              },
              {
                path: 'platform-billing-options',
                element: (
                  <PageSuspense>
                    <PlatformBillingOptionsPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Billing Options',
                },
              },
            ],
          },
          {
            element: <RequirePlatformFeedbackAccess />,
            children: [
              {
                path: 'platform-feedback',
                element: (
                  <PageSuspense>
                    <PlatformFeedbackPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Platform Feedback',
                },
              },
            ],
          },
          {
            element: <RequireTesterFeedbackAccess />,
            children: [
              {
                path: 'feedback/new',
                element: (
                  <PageSuspense>
                    <TesterFeedbackPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Report Tester Feedback',
                },
              },
            ],
          },
          {
            element: <RequireActivityLogAccess />,
            children: [
              {
                path: 'activity-log',
                element: (
                  <PageSuspense>
                    <ActivityLogPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Activity Log',
                },
              },
            ],
          },
          {
            path: 'information',
            element: (
              <PageSuspense>
                <InformationPage />
              </PageSuspense>
            ),
            handle: {
              title: 'Information',
            },
          },
          {
            path: 'user-settings',
            element: (
              <PageSuspense>
                <UserSettingsPage />
              </PageSuspense>
            ),
            handle: {
              title: 'User Settings',
            },
          },
          {
            element: <RequireParentPortalAccess />,
            children: [
              {
                path: 'parent-portal',
                element: (
                  <PageSuspense>
                    <ParentPortalPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Family portal',
                },
              },
              {
                path: 'parent-messages',
                element: (
                  <PageSuspense>
                    <ParentMessagesPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Messages',
                },
              },
              {
                path: 'parent-polls',
                element: (
                  <PageSuspense>
                    <ParentPollsPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Polls',
                },
              },
              {
                path: 'friends-family',
                element: (
                  <PageSuspense>
                    <FriendsFamilyPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Friends and Family',
                },
              },
            ],
          },
          {
            element: <RequireClubWorkspace />,
            children: [
              {
                path: 'coach',
                element: (
                  <PageSuspense>
                    <CoachHomePage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Home',
                },
              },
              {
                element: <RequirePlayerWorkflowAccess />,
                children: [
                  {
                    path: 'add-player',
                    element: (
                      <PageSuspense>
                        <AddPlayerPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Add Player',
                    },
                  },
                  {
                    path: 'calendar',
                    element: (
                      <PageSuspense>
                        <SessionsPage calendarOnly />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Calendar',
                    },
                  },
                  {
                    path: 'sessions',
                    element: (
                      <PageSuspense>
                        <SessionsMenuPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Sessions',
                    },
                  },
                  {
                    path: 'sessions/start',
                    element: (
                      <PageSuspense>
                        <SessionsPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Start Session',
                    },
                  },
                  {
                    path: 'sessions/previous',
                    element: (
                      <PageSuspense>
                        <SessionsPage setupOpen />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Previous Sessions',
                    },
                  },
                  {
                    path: 'players',
                    element: (
                      <PageSuspense>
                        <PlayersMenuPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Players',
                    },
                  },
                  {
                    path: 'players/current',
                    element: (
                      <PageSuspense>
                        <PlayersPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Current Players',
                    },
                  },
                  {
                    path: 'archived-players',
                    element: (
                      <PageSuspense>
                        <ArchivedPlayersPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Archived Players',
                    },
                  },
                  {
                    element: <RequireParentLinkingAccess />,
                    children: [
                      {
                        path: 'parent-linking',
                        element: (
                          <PageSuspense>
                            <ParentLinkingPage />
                          </PageSuspense>
                        ),
                        handle: {
                          title: 'Parent Linking',
                        },
                      },
                    ],
                  },
                  {
                    element: <RequireEmailQueueAccess />,
                    children: [
                      {
                        path: 'email-queue',
                        element: (
                          <PageSuspense>
                            <EmailQueuePage />
                          </PageSuspense>
                        ),
                        handle: {
                          title: 'Email Queue',
                        },
                      },
                    ],
                  },
                  {
                    element: <RequirePollAccess />,
                    children: [
                      {
                        path: 'polls',
                        element: (
                          <PageSuspense>
                            <PollsPage />
                          </PageSuspense>
                        ),
                        handle: {
                          title: 'Availability',
                        },
                      },
                    ],
                  },
                  {
                    path: 'create-evaluation',
                    element: (
                      <PageSuspense>
                        <CreateEvaluationPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Create Development Record',
                    },
                  },
                  {
                    path: 'assess-player',
                    element: (
                      <PageSuspense>
                        <AssessmentsMenuPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Development',
                    },
                  },
                  {
                    path: 'assess-player/new',
                    element: (
                      <PageSuspense>
                        <CreateEvaluationPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'New Development Record',
                    },
                  },
                  {
                    path: 'assess-player/completed',
                    element: (
                      <PageSuspense>
                        <PlayersPage
                          defaultView="evaluated"
                          headerDescription="Review players who already have completed development records, then open a profile for the full history."
                          headerEyebrow="Development"
                          headerTitle="Completed development records"
                        />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Completed Development Records',
                    },
                  },
                  {
                    path: 'create',
                    element: (
                      <PageSuspense>
                        <CreateEvaluationPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Create Development Record',
                    },
                  },
                  {
                    path: 'player/:id',
                    element: (
                      <PageSuspense>
                        <PlayerProfile />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Player Profile',
                    },
                  },
                ],
              },
            ],
          },
          {
            element: <RequireMatchDayAccess />,
            children: [
              {
                path: 'match-day',
                element: (
                  <PageSuspense>
                    <MatchDayPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Match Day',
                },
              },
            ],
          },
          {
            element: <RequireTeamSettingsAccess />,
            children: [
              {
                path: 'teams',
                element: (
                  <PageSuspense>
                    <TeamManagementPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Teams',
                },
              },
            ],
          },
          {
            element: <RequireEndSeasonStatsAccess />,
            children: [
              {
                path: 'end-season-stats',
                element: (
                  <PageSuspense>
                    <EndSeasonStatsPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'End of Season Stats',
                },
              },
            ],
          },
          {
            element: <RequireUserAccess />,
            children: [
              {
                path: 'user-access',
                element: (
                  <PageSuspense>
                    <UserAccessPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'User Access',
                },
              },
            ],
          },
          {
            element: <RequireFeedbackFormsAccess />,
            children: [
              {
                path: 'feedback-forms',
                element: (
                  <PageSuspense>
                    <FeedbackFormsPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Feedback Forms',
                },
              },
            ],
          },
          {
            element: <RequireFormBuilderAccess />,
            children: [
              {
                path: 'form-builder',
                element: (
                  <PageSuspense>
                    <FormBuilderPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Development Fields',
                },
              },
            ],
          },
          {
            element: <RequireParentEmailTemplatesAccess />,
            children: [
              {
                path: 'parent-email-templates',
                element: (
                  <PageSuspense>
                    <ParentEmailTemplatesPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Email Templates',
                },
              },
            ],
          },
          {
            element: <RequireClubSettingsAccess />,
            children: [
              {
                path: 'club-settings',
                element: (
                  <PageSuspense>
                    <ClubSettingsPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Club Settings',
                },
              },
            ],
          },
          {
            element: <RequireBillingAccess />,
            children: [
              {
                path: 'billing',
                element: (
                  <PageSuspense>
                    <BillingPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Billing',
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: (
      <PageSuspense>
        <NotFoundPage />
      </PageSuspense>
    ),
  },
])
