/* eslint-disable react-refresh/only-export-components */
import { Component, Suspense, lazy } from 'react'
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { Layout } from '../components/layout/Layout.jsx'
import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageEmailQueue,
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
  isSuperAdmin,
  isParentPortalUser,
  isTesterAccessExpired,
  useAuth,
} from '../lib/auth.js'
import { clearChunkRecoveryMarker, isDynamicImportError, recoverFromStaleChunk } from '../lib/chunkRecovery.js'
import { hasPlanFeature, isPlanAccessActive } from '../lib/plans.js'
import { getMainAppOrigin, isParentPortalHost } from '../lib/app-origins.js'

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
const AssessmentsMenuPage = lazyRoute(() => import('../pages/CoachActionMenuPages.jsx'), 'AssessmentsMenuPage')
const PlayersMenuPage = lazyRoute(() => import('../pages/CoachActionMenuPages.jsx'), 'PlayersMenuPage')
const SessionsMenuPage = lazyRoute(() => import('../pages/CoachActionMenuPages.jsx'), 'SessionsMenuPage')
const CreateEvaluationPage = lazyRoute(() => import('../pages/CreateEvaluationPage.jsx'), 'CreateEvaluationPage')
const EndSeasonStatsPage = lazyRoute(() => import('../pages/EndSeasonStatsPage.jsx'), 'EndSeasonStatsPage')
const EmailQueuePage = lazyRoute(() => import('../pages/EmailQueuePage.jsx'), 'EmailQueuePage')
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
const TermsPage = lazyRoute(() => import('../pages/TermsPage.jsx'), 'TermsPage')
const UserAccessPage = lazyRoute(() => import('../pages/UserAccessPage.jsx'), 'UserAccessPage')
const UserSettingsPage = lazyRoute(() => import('../pages/UserSettingsPage.jsx'), 'UserSettingsPage')

const primaryActionClassName =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60'

const secondaryActionClassName =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60'

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="rounded-md border border-slate-200 bg-white px-6 py-5 text-sm font-bold text-slate-600 shadow-sm">
        Loading...
      </div>
    </main>
  )
}

function ExternalRedirect({ to }) {
  window.location.replace(to)
  return <LoadingScreen />
}

function isParentHost() {
  return isParentPortalHost()
}

function NavigateToParentInvite() {
  return <Navigate to={window.location.pathname.replace(/^\/invite\//, '/parent-invite/')} replace />
}

function RouteContentSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-8 shadow-sm">
        <div className="h-4 w-28 rounded-md bg-slate-100" />
        <div className="mt-5 h-10 w-64 max-w-full rounded-md bg-slate-100" />
        <div className="mt-4 h-5 w-full max-w-xl rounded-md bg-slate-100" />
      </div>
      <div className="rounded-md border border-slate-200 bg-white px-5 py-8 shadow-sm">
        <div className="h-8 w-40 rounded-md bg-slate-100" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="h-28 rounded-md bg-slate-100" />
          <div className="h-28 rounded-md bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

function RouteGateState({ title, message, actions = null }) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-8 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Workspace</p>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-600">{message}</p>
        {actions ? <div className="mt-6 flex flex-col gap-3 sm:flex-row">{actions}</div> : null}
      </div>
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
      message={message || 'Your login session is active, but this staging workspace could not find a matching account profile. Retry once, or sign in again with a staging test account.'}
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
            Sign In Again
          </button>
        </>
      )}
    />
  )
}

function ClubSuspendedState() {
  return (
    <RouteGateState
      title="Club access suspended"
      message="This club workspace has been suspended by the platform admin. Contact platform support if this should be reactivated."
    />
  )
}

function AccountSuspendedState() {
  return (
    <RouteGateState
      title="Account access suspended"
      message="This account has been suspended. Contact your club admin or platform support if this should be reactivated."
    />
  )
}

function TesterAccessExpiredState() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-8 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Billing</p>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Tester access has ended</h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          Your temporary tester access has expired. Your club data is still safe. A paid plan is needed to continue using the workspace.
        </p>
        <a
          href="/billing"
          className={`mt-6 ${primaryActionClassName}`}
        >
          View Billing Options
        </a>
      </div>
    </div>
  )
}

function PlanAccessRequiredState() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-8 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Billing</p>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Plan access needs attention</h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          This workspace needs an active plan before staff can keep using club tools. Your existing club data remains safe.
        </p>
        <a
          href="/billing"
          className={`mt-6 ${primaryActionClassName}`}
        >
          View Billing Options
        </a>
      </div>
    </div>
  )
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
    return '/billing'
  }

  if (!isPlanAccessActive(user)) {
    return '/billing'
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
} = {}) {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return { element: <LoadingScreen />, user: null }
  }

  if (!session?.user) {
    return { element: <Navigate to={isParentHost() ? '/parent-login' : '/sign-in'} replace />, user: null }
  }

  if (!user && isProfileLoading) {
    return { element: <RouteContentSkeleton />, user: null }
  }

  if (!user) {
    return {
      element: <AccountDetailsUnavailableState message={authError} />,
      user: null,
    }
  }

  if (redirectSuperAdmin && isSuperAdmin(user)) {
    return { element: isParentHost() ? <ExternalRedirect to={getMainAppOrigin()} /> : <Navigate to="/platform-admin" replace />, user }
  }

  if (isParentHost() && !isParentPortalUser(user)) {
    return { element: <ExternalRedirect to={getMainAppOrigin()} />, user }
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
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-8 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">Page Error</p>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-600">{message}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={primaryActionClassName}
          >
            Refresh App
          </button>
          <a
            href="/"
            className={secondaryActionClassName}
          >
            Go To Workspace
          </a>
        </div>
      </div>
    </div>
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
      <Suspense fallback={<RouteContentSkeleton />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}

function WorkspaceHome() {
  const { authError, isProfileLoading, user } = useAuth()

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
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
    return <Navigate to="/billing" replace />
  }

  if (!isPlanAccessActive(user)) {
    return <Navigate to="/billing" replace />
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

  return (
    <PageSuspense>
      <WorkspaceHome />
    </PageSuspense>
  )
}

function RequireUser() {
  const { isLoading, session } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
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

  if (element) {
    return element
  }

  if (!canCreateEvaluation(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireParentPortalAccess() {
  const { element, user } = useWorkspaceRouteGate({
    redirectSuperAdmin: false,
    blockExpiredTester: false,
  })

  if (element) {
    return element
  }

  if (!isParentPortalUser(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireParentLinkingAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageParentLinks(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireEmailQueueAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageEmailQueue(user) || !hasPlanFeature(user, 'parentEmail')) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequirePollAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManagePolls(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireMatchDayAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageMatchDay(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function PublicOnly() {
  const { isLoading, session } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (session?.user) {
    return <Navigate to={isParentHost() ? '/parent-portal' : '/'} replace />
  }

  return <Outlet />
}

function RequireFormBuilderAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageFormFields(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  if (!hasPlanFeature(user, 'customFormFields')) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireParentEmailTemplatesAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageParentEmailTemplates(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  if (!hasPlanFeature(user, 'parentEmail')) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireClubSettingsAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageClubSettings(user)) {
    return <RedirectToWorkspaceHome user={user} />
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

  if (!canManageUsers(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireTeamSettingsAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canManageTeamSettings(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireEndSeasonStatsAccess() {
  const { element, user } = useWorkspaceRouteGate()

  if (element) {
    return element
  }

  if (!canViewEndSeasonStats(user)) {
    return <RedirectToWorkspaceHome user={user} />
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

  if (!isSuperAdmin(user) && !hasPlanFeature(user, 'auditLogs')) {
    return <RedirectToWorkspaceHome user={user} />
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
                  title: 'Parent Portal',
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
                  title: 'Club Home',
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
                          title: 'Polls',
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
