import { Link } from 'react-router-dom'
import { canManageUsers, canCreateEvaluation } from '../../lib/auth.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function EvaluationAvailabilityState({
  availableTeams,
  children,
  isLoadingFields,
  isLoadingTeams,
  noTeamsMessage,
  teamsLoadErrorMessage,
  user,
}) {
  if (!canCreateEvaluation(user)) {
    return (
      <SectionCard
        title="Platform account"
        description="Super admins oversee the platform. Assessments must be created from a club user account."
      >
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
          Use this account to manage clubs, users, and the wider workspace. Switch into a club-linked account to
          assess players.
        </div>
      </SectionCard>
    )
  }

  if (isLoadingFields) {
    return (
      <SectionCard title="Form" description="Loading the configured assessment fields for this club.">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading form fields...
        </div>
      </SectionCard>
    )
  }

  if (isLoadingTeams) {
    return (
      <SectionCard title="Teams" description="Loading the available teams for this account.">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading teams...
        </div>
      </SectionCard>
    )
  }

  if (teamsLoadErrorMessage) {
    return (
      <SectionCard title="Teams unavailable" description="The team list could not be loaded for this account just now.">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
          <p>{teamsLoadErrorMessage}</p>
          {canManageUsers(user) ? (
            <div>
              <Link
                to="/teams"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-100"
              >
                Open Team Management
              </Link>
            </div>
          ) : null}
        </div>
      </SectionCard>
    )
  }

  if (availableTeams.length === 0) {
    return (
      <SectionCard
        title="No teams available"
        description="Assessments now use real club teams so staff can be routed and filtered correctly."
      >
        <div className="space-y-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
          <p>{noTeamsMessage}</p>
          {canManageUsers(user) ? (
            <div>
              <Link
                to="/teams"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800"
              >
                Open Team Management
              </Link>
            </div>
          ) : null}
        </div>
      </SectionCard>
    )
  }

  return children
}
