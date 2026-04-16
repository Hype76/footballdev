import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { Layout } from '../components/layout/Layout.jsx'
import { ApprovalsPage } from '../pages/ApprovalsPage.jsx'
import { ClubSettingsPage } from '../pages/ClubSettingsPage.jsx'
import { CreateEvaluationPage } from '../pages/CreateEvaluationPage.jsx'
import { DashboardPage } from '../pages/DashboardPage.jsx'
import { FormBuilderPage } from '../pages/FormBuilderPage.jsx'
import { LoginPage } from '../pages/LoginPage.jsx'
import { NotFoundPage } from '../pages/NotFoundPage.jsx'
import { PlayerProfile } from '../pages/PlayerProfile.jsx'
import { canAccessApprovals, canManageClubSettings, canManageFormFields, useAuth } from '../lib/auth.js'

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7f3] px-4 py-8">
      <div className="rounded-[24px] border border-[#dbe3d6] bg-white px-6 py-5 text-sm font-medium text-slate-600">
        Loading...
      </div>
    </main>
  )
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

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      {
        path: '/login',
        element: <LoginPage />,
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
            element: <DashboardPage />,
            handle: {
              title: 'Dashboard',
            },
          },
          {
            path: 'create-evaluation',
            element: <CreateEvaluationPage />,
            handle: {
              title: 'Create Evaluation',
            },
          },
          {
            path: 'assess-player',
            element: <CreateEvaluationPage />,
            handle: {
              title: 'Assess Player',
            },
          },
          {
            path: 'create',
            element: <CreateEvaluationPage />,
            handle: {
              title: 'Create Evaluation',
            },
          },
          {
            element: <RequireFormBuilderAccess />,
            children: [
              {
                path: 'form-builder',
                element: <FormBuilderPage />,
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
                element: <ClubSettingsPage />,
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
                element: <ApprovalsPage />,
                handle: {
                  title: 'Approvals',
                },
              },
            ],
          },
          {
            path: 'player/:id',
            element: <PlayerProfile />,
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
    element: <NotFoundPage />,
  },
])
