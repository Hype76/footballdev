import { Link } from 'react-router-dom'
import { canManageUsers, canCreateEvaluation } from '../../lib/auth.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const statePanelClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-4 text-sm font-semibold leading-6 text-[#456653] shadow-sm shadow-[#067a46]/10'
const emptyPanelClass = 'space-y-4 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold leading-6 text-[#456653] shadow-sm shadow-[#067a46]/10'
const secondaryLinkClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] transition hover:border-[#20a464] hover:bg-[#f0fdf6]'
const primaryLinkClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#05603a]'

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
        description="Super admins oversee the platform. Development records must be created from a club user account."
      >
        <div className={`${statePanelClass} space-y-4`}>
          Use this account to manage clubs, users, and the wider workspace. Switch into a club-linked account to
          record player development.
        </div>
      </SectionCard>
    )
  }

  if (isLoadingFields) {
    return (
      <SectionCard title="Form" description="Loading the configured development fields for this club.">
        <div className={statePanelClass}>
          Loading form fields...
        </div>
      </SectionCard>
    )
  }

  if (isLoadingTeams) {
    return (
      <SectionCard title="Teams" description="Loading the available teams for this account.">
        <div className={statePanelClass}>
          Loading teams...
        </div>
      </SectionCard>
    )
  }

  if (teamsLoadErrorMessage) {
    return (
      <SectionCard title="Teams unavailable" description="The team list could not be loaded for this account just now.">
        <div className={statePanelClass}>
          <p>{teamsLoadErrorMessage}</p>
          {canManageUsers(user) ? (
            <div>
              <Link
                to="/teams"
                className={secondaryLinkClass}
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
        description="Development records use real club teams so staff can be routed and filtered correctly."
      >
        <div className={emptyPanelClass}>
          <p>{noTeamsMessage}</p>
          {canManageUsers(user) ? (
            <div>
              <Link
                to="/teams"
                className={primaryLinkClass}
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
