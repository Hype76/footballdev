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
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm leading-6 text-[var(--text-muted)]">
          Use this account to manage clubs, users, and the wider workspace. Switch into a club-linked account to
          assess players.
        </div>
      </SectionCard>
    )
  }

  if (isLoadingFields) {
    return (
      <SectionCard title="Form" description="Loading the configured assessment fields for this club.">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading form fields...
        </div>
      </SectionCard>
    )
  }

  if (isLoadingTeams) {
    return (
      <SectionCard title="Teams" description="Loading the available teams for this account.">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading teams...
        </div>
      </SectionCard>
    )
  }

  if (teamsLoadErrorMessage) {
    return (
      <SectionCard title="Teams unavailable" description="The team list could not be loaded for this account just now.">
        <div className="space-y-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm leading-6 text-[var(--text-muted)]">
          <p>{teamsLoadErrorMessage}</p>
          {canManageUsers(user) ? (
            <div>
              <Link
                to="/teams"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
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
        <div className="space-y-4 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm leading-6 text-[var(--text-muted)]">
          <p>{noTeamsMessage}</p>
          {canManageUsers(user) ? (
            <div>
              <Link
                to="/teams"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
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
