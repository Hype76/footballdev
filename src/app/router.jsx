import { Component, Suspense, lazy } from 'react'
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { Layout } from '../components/layout/Layout.jsx'
import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageFormFields,
  canManageParentEmailTemplates,
  canManageTeamSettings,
  canManageUsers,
  canViewActivityLog,
  canViewBilling,
  isSuperAdmin,
  isTesterAccessExpired,
  useAuth,
} from '../lib/auth.js'
import { clearChunkRecoveryMarker, isDynamicImportError, recoverFromStaleChunk } from '../lib/chunkRecovery.js'

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
const CreateEvaluationPage = lazyRoute(() => import('../pages/CreateEvaluationPage.jsx'), 'CreateEvaluationPage')
const FormBuilderPage = lazyRoute(() => import('../pages/FormBuilderPage.jsx'), 'FormBuilderPage')
const InformationPage = lazyRoute(() => import('../pages/InformationPage.jsx'), 'InformationPage')
const LoginPage = lazyRoute(() => import('../pages/LoginPage.jsx'), 'LoginPage')
const NotFoundPage = lazyRoute(() => import('../pages/NotFoundPage.jsx'), 'NotFoundPage')
const ParentEmailTemplatesPage = lazyRoute(() => import('../pages/ParentEmailTemplatesPage.jsx'), 'ParentEmailTemplatesPage')
const PlayerProfile = lazyRoute(() => import('../pages/PlayerProfile.jsx'), 'PlayerProfile')
const PlayersPage = lazyRoute(() => import('../pages/PlayersPage.jsx'), 'PlayersPage')
const PlatformAdminPage = lazyRoute(() => import('../pages/PlatformAdminPage.jsx'), 'PlatformAdminPage')
const PlatformBillingOptionsPage = lazyRoute(() => import('../pages/PlatformBillingOptionsPage.jsx'), 'PlatformBillingOptionsPage')
const PlatformClubManagementPage = lazyRoute(() => import('../pages/PlatformClubManagementPage.jsx'), 'PlatformClubManagementPage')
const PlatformFeedbackPage = lazyRoute(() => import('../pages/PlatformFeedbackPage.jsx'), 'PlatformFeedbackPage')
const ResetPasswordPage = lazyRoute(() => import('../pages/ResetPasswordPage.jsx'), 'ResetPasswordPage')
const SessionsPage = lazyRoute(() => import('../pages/SessionsPage.jsx'), 'SessionsPage')
const TeamManagementPage = lazyRoute(() => import('../pages/TeamManagementPage.jsx'), 'TeamManagementPage')
const UserAccessPage = lazyRoute(() => import('../pages/UserAccessPage.jsx'), 'UserAccessPage')
const UserSettingsPage = lazyRoute(() => import('../pages/UserSettingsPage.jsx'), 'UserSettingsPage')

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 py-8">
      <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] px-6 py-5 text-sm font-medium text-[var(--text-muted)]">
        Loading...
      </div>
    </main>
  )
}

function RouteContentSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--shell-card)] px-5 py-8">
        <div className="h-4 w-28 rounded-full bg-[var(--panel-soft)]" />
        <div className="mt-5 h-10 w-64 rounded-2xl bg-[var(--panel-soft)]" />
        <div className="mt-4 h-5 w-full max-w-xl rounded-2xl bg-[var(--panel-soft)]" />
      </div>
      <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-8">
        <div className="h-8 w-40 rounded-2xl bg-[var(--panel-soft)]" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="h-28 rounded-[24px] bg-[var(--panel-soft)]" />
          <div className="h-28 rounded-[24px] bg-[var(--panel-soft)]" />
        </div>
      </div>
    </div>
  )
}

function RouteGateState({ title, message }) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--shell-card)] px-5 py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Workspace</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{message}</p>
      </div>
    </div>
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
      <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--shell-card)] px-5 py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Billing</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Tester access has ended</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
          Your temporary tester access has expired. Your club data is still safe, but a paid plan is needed to continue using the workspace.
        </p>
        <a
          href="/billing"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
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

  if (isAccountSuspended(user) || isClubSuspended(user)) {
    return '/'
  }

  if (isTesterAccessExpired(user)) {
    return '/billing'
  }

  if (canManageTeamSettings(user)) {
    return '/teams'
  }

  if (canManageUsers(user)) {
    return '/user-access'
  }

  return '/add-player'
}

function RedirectToWorkspaceHome({ user }) {
  return <Navigate to={getDefaultWorkspacePath(user)} replace />
}

function RouteErrorFallback({ error }) {
  const isChunkError = isDynamicImportError(error)
  const title = isChunkError ? 'App update needed' : 'This page could not load'
  const message = isChunkError
    ? 'A new version has been deployed and this browser still has an old page file. Refresh once to load the latest version.'
    : 'The page hit an unexpected error. Refresh the page or return to your workspace.'

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-[28px] border border-[var(--border-color)] bg-[var(--shell-card)] px-5 py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Page Error</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{message}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
          >
            Refresh App
          </button>
          <a
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
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
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
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

  return <RedirectToWorkspaceHome user={user} />
}

function RequireUser() {
  const { isLoading, session } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function RequireClubWorkspace() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  return <Outlet />
}

function RequirePlayerWorkflowAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  if (!canCreateEvaluation(user)) {
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
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

function RequireFormBuilderAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  if (!canManageFormFields(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireParentEmailTemplatesAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  if (!canManageParentEmailTemplates(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireClubSettingsAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  if (!canManageClubSettings(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireBillingAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (!canViewBilling(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireUserAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  if (!canManageUsers(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireTeamSettingsAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  if (!canManageTeamSettings(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequireActivityLogAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (isAccountSuspended(user)) {
    return <AccountSuspendedState />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (isTesterAccessExpired(user)) {
    return <TesterAccessExpiredState />
  }

  if (!canViewActivityLog(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

function RequirePlatformAdminAccess() {
  const { authError, isLoading, isProfileLoading, session, user } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (!session?.user) {
    return <Navigate to="/login" replace />
  }

  if (!user && isProfileLoading) {
    return <RouteContentSkeleton />
  }

  if (!user) {
    return (
      <RouteGateState
        title="Account details unavailable"
        message={authError || 'Your access profile could not be loaded yet. Try again in a moment.'}
      />
    )
  }

  if (!isSuperAdmin(user)) {
    return <RedirectToWorkspaceHome user={user} />
  }

  return <Outlet />
}

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      {
        path: '/login',
        element: (
          <PageSuspense>
            <LoginPage />
          </PageSuspense>
        ),
      },
    ],
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
            index: true,
            element: (
              <PageSuspense>
                <WorkspaceHome />
              </PageSuspense>
            ),
          },
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
            element: <RequireClubWorkspace />,
            children: [
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
                        <SessionsPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Sessions',
                    },
                  },
                  {
                    path: 'players',
                    element: (
                      <PageSuspense>
                        <PlayersPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Players',
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
                    path: 'create-evaluation',
                    element: (
                      <PageSuspense>
                        <CreateEvaluationPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Create Evaluation',
                    },
                  },
                  {
                    path: 'assess-player',
                    element: (
                      <PageSuspense>
                        <CreateEvaluationPage />
                      </PageSuspense>
                    ),
                    handle: {
                      title: 'Assess Player',
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
                      title: 'Create Evaluation',
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
                  title: 'Form Builder',
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
