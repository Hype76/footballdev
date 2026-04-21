import { Component, Suspense, lazy } from 'react'
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { Layout } from '../components/layout/Layout.jsx'
import {
  canAccessApprovals,
  canManageClubSettings,
  canManageFormFields,
  canManageUsers,
  isSuperAdmin,
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

const ApprovalsPage = lazyRoute(() => import('../pages/ApprovalsPage.jsx'), 'ApprovalsPage')
const AddPlayerPage = lazyRoute(() => import('../pages/AddPlayerPage.jsx'), 'AddPlayerPage')
const ClubSettingsPage = lazyRoute(() => import('../pages/ClubSettingsPage.jsx'), 'ClubSettingsPage')
const CreateEvaluationPage = lazyRoute(() => import('../pages/CreateEvaluationPage.jsx'), 'CreateEvaluationPage')
const DashboardPage = lazyRoute(() => import('../pages/DashboardPage.jsx'), 'DashboardPage')
const FormBuilderPage = lazyRoute(() => import('../pages/FormBuilderPage.jsx'), 'FormBuilderPage')
const LoginPage = lazyRoute(() => import('../pages/LoginPage.jsx'), 'LoginPage')
const NotFoundPage = lazyRoute(() => import('../pages/NotFoundPage.jsx'), 'NotFoundPage')
const PlayerProfile = lazyRoute(() => import('../pages/PlayerProfile.jsx'), 'PlayerProfile')
const PlatformAdminPage = lazyRoute(() => import('../pages/PlatformAdminPage.jsx'), 'PlatformAdminPage')
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

function isClubSuspended(user) {
  return user?.clubStatus === 'suspended'
}

function RouteErrorFallback({ error }) {
  const isChunkError = isDynamicImportError(error)
  const title = isChunkError ? 'App update needed' : 'This page could not load'
  const message = isChunkError
    ? 'A new version has been deployed and this browser still has an old page file. Refresh once to load the latest version.'
    : 'The page hit an unexpected error. Refresh the page or return to the dashboard.'

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
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
          >
            Go To Dashboard
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

function DashboardEntry() {
  const { user } = useAuth()

  if (!user) {
    return <RouteContentSkeleton />
  }

  if (isSuperAdmin(user)) {
    return <Navigate to="/platform-admin" replace />
  }

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  return <DashboardPage />
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

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  return <Outlet />
}

function PublicOnly() {
  const { isLoading, session } = useAuth()

  if (isLoading && !session?.user) {
    return <LoadingScreen />
  }

  if (session?.user) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function RequireManager() {
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

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (!canAccessApprovals(user)) {
    return <Navigate to="/dashboard" replace />
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

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (!canManageFormFields(user)) {
    return <Navigate to="/dashboard" replace />
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

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (!canManageClubSettings(user)) {
    return <Navigate to="/dashboard" replace />
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

  if (isClubSuspended(user)) {
    return <ClubSuspendedState />
  }

  if (!canManageUsers(user)) {
    return <Navigate to="/dashboard" replace />
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
        element: <Layout />,
        children: [
          {
            index: true,
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: 'dashboard',
            element: (
              <PageSuspense>
                <DashboardEntry />
              </PageSuspense>
            ),
            handle: {
              title: 'Dashboard',
            },
          },
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
          {
            element: <RequireUserAccess />,
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
            element: <RequireManager />,
            children: [
              {
                path: 'approvals',
                element: (
                  <PageSuspense>
                    <ApprovalsPage />
                  </PageSuspense>
                ),
                handle: {
                  title: 'Approvals',
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
