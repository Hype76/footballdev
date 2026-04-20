import { Suspense, lazy } from 'react'
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { Layout } from '../components/layout/Layout.jsx'
import { canAccessApprovals, canManageClubSettings, canManageFormFields, canManageUsers, useAuth } from '../lib/auth.js'

const ApprovalsPage = lazy(() => import('../pages/ApprovalsPage.jsx').then((module) => ({ default: module.ApprovalsPage })))
const ClubSettingsPage = lazy(() =>
  import('../pages/ClubSettingsPage.jsx').then((module) => ({ default: module.ClubSettingsPage }))
)
const CreateEvaluationPage = lazy(() =>
  import('../pages/CreateEvaluationPage.jsx').then((module) => ({ default: module.CreateEvaluationPage }))
)
const DashboardPage = lazy(() => import('../pages/DashboardPage.jsx').then((module) => ({ default: module.DashboardPage })))
const FormBuilderPage = lazy(() =>
  import('../pages/FormBuilderPage.jsx').then((module) => ({ default: module.FormBuilderPage }))
)
const LoginPage = lazy(() => import('../pages/LoginPage.jsx').then((module) => ({ default: module.LoginPage })))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage.jsx').then((module) => ({ default: module.NotFoundPage })))
const PlayerProfile = lazy(() => import('../pages/PlayerProfile.jsx').then((module) => ({ default: module.PlayerProfile })))
const TeamManagementPage = lazy(() =>
  import('../pages/TeamManagementPage.jsx').then((module) => ({ default: module.TeamManagementPage }))
)
const UserAccessPage = lazy(() => import('../pages/UserAccessPage.jsx').then((module) => ({ default: module.UserAccessPage })))

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 py-8">
      <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] px-6 py-5 text-sm font-medium text-[var(--text-muted)]">
        Loading...
      </div>
    </main>
  )
}

function withPageLoader(element) {
  return <Suspense fallback={<LoadingScreen />}>{element}</Suspense>
}

function RequireUser() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function PublicOnly() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function RequireManager() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!canAccessApprovals(user)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function RequireFormBuilderAccess() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!canManageFormFields(user)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function RequireClubSettingsAccess() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!canManageClubSettings(user)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function RequireUserAccess() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <Navigate to="/login" replace />
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
        element: withPageLoader(<LoginPage />),
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
            element: withPageLoader(<DashboardPage />),
            handle: {
              title: 'Dashboard',
            },
          },
          {
            path: 'create-evaluation',
            element: withPageLoader(<CreateEvaluationPage />),
            handle: {
              title: 'Create Evaluation',
            },
          },
          {
            path: 'assess-player',
            element: withPageLoader(<CreateEvaluationPage />),
            handle: {
              title: 'Assess Player',
            },
          },
          {
            path: 'create',
            element: withPageLoader(<CreateEvaluationPage />),
            handle: {
              title: 'Create Evaluation',
            },
          },
          {
            element: <RequireUserAccess />,
            children: [
              {
                path: 'teams',
                element: withPageLoader(<TeamManagementPage />),
                handle: {
                  title: 'Teams',
                },
              },
              {
                path: 'user-access',
                element: withPageLoader(<UserAccessPage />),
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
                element: withPageLoader(<FormBuilderPage />),
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
                element: withPageLoader(<ClubSettingsPage />),
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
                element: withPageLoader(<ApprovalsPage />),
                handle: {
                  title: 'Approvals',
                },
              },
            ],
          },
          {
            path: 'player/:id',
            element: withPageLoader(<PlayerProfile />),
            handle: {
              title: 'Player Profile',
            },
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: withPageLoader(<NotFoundPage />),
  },
])
