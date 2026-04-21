import { Suspense, lazy } from 'react'
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

const ApprovalsPage = lazy(() => import('../pages/ApprovalsPage.jsx').then((module) => ({ default: module.ApprovalsPage })))
const ClubSettingsPage = lazy(() =>
  import('../pages/ClubSettingsPage.jsx').then((module) => ({ default: module.ClubSettingsPage })),
)
const CreateEvaluationPage = lazy(() =>
  import('../pages/CreateEvaluationPage.jsx').then((module) => ({ default: module.CreateEvaluationPage })),
)
const DashboardPage = lazy(() => import('../pages/DashboardPage.jsx').then((module) => ({ default: module.DashboardPage })))
const FormBuilderPage = lazy(() =>
  import('../pages/FormBuilderPage.jsx').then((module) => ({ default: module.FormBuilderPage })),
)
const LoginPage = lazy(() => import('../pages/LoginPage.jsx').then((module) => ({ default: module.LoginPage })))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage.jsx').then((module) => ({ default: module.NotFoundPage })))
const PlayerProfile = lazy(() => import('../pages/PlayerProfile.jsx').then((module) => ({ default: module.PlayerProfile })))
const PlatformAdminPage = lazy(() =>
  import('../pages/PlatformAdminPage.jsx').then((module) => ({ default: module.PlatformAdminPage })),
)
const TeamManagementPage = lazy(() =>
  import('../pages/TeamManagementPage.jsx').then((module) => ({ default: module.TeamManagementPage })),
)
const UserAccessPage = lazy(() => import('../pages/UserAccessPage.jsx').then((module) => ({ default: module.UserAccessPage })))
const UserSettingsPage = lazy(() =>
  import('../pages/UserSettingsPage.jsx').then((module) => ({ default: module.UserSettingsPage })),
)

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

function PageSuspense({ children }) {
  return <Suspense fallback={<RouteContentSkeleton />}>{children}</Suspense>
}

function DashboardEntry() {
  const { user } = useAuth()

  if (!user) {
    return <RouteContentSkeleton />
  }

  return isSuperAdmin(user) ? <PlatformAdminPage /> : <DashboardPage />
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
