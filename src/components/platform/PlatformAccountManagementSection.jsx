import { useState } from 'react'
import { getUkCalendarDate, validateBillingArrangement } from '../../lib/billing-date.js'
import { PLAN_KEYS, getAdminAssignablePlanOptions, getPlanDefaultLimit, getPlanLimit, getPlanName } from '../../lib/plans.js'
import { formatPlatformDate } from '../../lib/platform-admin-stats.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'
import { StatusPill } from '../ui/StatusPill.jsx'
import { ClubAccessManagement } from './ClubAccessManagement.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const viewButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10'
const adminAssignablePlanOptions = getAdminAssignablePlanOptions()

function formatLimit(value) {
  if (value === null || value === undefined) {
    return 'Unlimited'
  }

  return String(value)
}

export function PlatformAccountManagementSection({
  accessToken,
  archiveCount,
  clubPage,
  clubSearchTerm,
  isLoading,
  onAccountAction,
  onArchiveClub,
  onArchiveTeam,
  onClubSearchChange,
  onClubPageChange,
  onClubPlanChange,
  onDeleteClub,
  onDeleteTeam,
  onRecordViewChange,
  onRestoreClub,
  onRestoreTeam,
  onSelectedClubChange,
  onToggleClubStatus,
  paginatedClubs,
  pageSize,
  recordView,
  selectedClubId,
  stats,
  updatingClubId,
  updatingTeamId,
  updatingUserId,
  visibleClubs,
}) {
  const searchValue = String(clubSearchTerm ?? '')
  const statsClubs = Array.isArray(stats?.clubs) ? stats.clubs.filter((club) => club?.id) : []
  const safeVisibleClubs = Array.isArray(visibleClubs) ? visibleClubs.filter((club) => club?.id) : []
  const safePaginatedClubs = {
    ...paginatedClubs,
    items: Array.isArray(paginatedClubs?.items) ? paginatedClubs.items.filter((club) => club?.id) : [],
  }

  return (
    <SectionCard
      title="Account management"
      description="Manage clubs, teams, and adult user access. Player names and child contact details are intentionally excluded."
    >
      <div className="mb-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-3 shadow-sm shadow-[#047857]/10">
        <div className="flex flex-col gap-2 sm:flex-row" aria-label="Workspace record view">
          <button
            type="button"
            aria-pressed={recordView === 'active'}
            onClick={() => onRecordViewChange('active')}
            className={`${viewButtonClass} ${recordView === 'active' ? 'border-[#047857] bg-[#047857] text-white' : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857]'}`}
          >
            Active workspaces
          </button>
          <button
            type="button"
            aria-pressed={recordView === 'archived'}
            onClick={() => onRecordViewChange('archived')}
            className={`${viewButtonClass} ${recordView === 'archived' ? 'border-[#047857] bg-[#047857] text-white' : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857]'}`}
          >
            Archive ({archiveCount ?? 0})
          </button>
        </div>
        <p className="mt-3 text-sm font-semibold text-[#4b5f55]">
          {recordView === 'archived'
            ? 'Restore retained workspaces or permanently delete them after reviewing the archived record.'
            : 'To permanently delete a Club, archive it first. The app will then open the Archive view where the permanent delete button is available.'}
        </p>
      </div>
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(220px,360px)_minmax(260px,1fr)]">
        <label className="block">
          <span className={labelClass}>Club filter</span>
          <select
            value={selectedClubId}
            onChange={(event) => onSelectedClubChange(event.target.value)}
            className={fieldClass}
          >
            <option value="All">All clubs</option>
            {statsClubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Search clubs</span>
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onClubSearchChange(event.target.value)}
            placeholder="Search by club, contact, team, user, plan, or status"
            className={fieldClass}
          />
        </label>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
          Loading platform stats...
        </div>
      ) : safeVisibleClubs.length === 0 ? (
        <div className={emptyStateClass}>
          {searchValue.trim()
            ? 'No workspaces match that search.'
            : recordView === 'archived'
              ? 'No archived Clubs or Teams.'
              : 'No active Clubs found yet.'}
        </div>
      ) : (
        <div className="space-y-4">
          {safePaginatedClubs.items.map((club) => (
            recordView === 'archived' ? (
              <ArchivedWorkspaceCard
                key={club.id}
                club={club}
                onDeleteClub={onDeleteClub}
                onDeleteTeam={onDeleteTeam}
                onRestoreClub={onRestoreClub}
                onRestoreTeam={onRestoreTeam}
                updatingClubId={updatingClubId}
                updatingTeamId={updatingTeamId}
              />
            ) : (
              <ClubAccountCard
                accessToken={accessToken}
                key={club.id}
                club={club}
                onAccountAction={onAccountAction}
                onArchiveClub={onArchiveClub}
                onArchiveTeam={onArchiveTeam}
                onClubPlanChange={onClubPlanChange}
                onToggleClubStatus={onToggleClubStatus}
                updatingClubId={updatingClubId}
                updatingTeamId={updatingTeamId}
                updatingUserId={updatingUserId}
              />
            )
          ))}
          <Pagination
            currentPage={clubPage}
            onPageChange={onClubPageChange}
            pageSize={pageSize}
            totalItems={safeVisibleClubs.length}
          />
        </div>
      )}
    </SectionCard>
  )
}

function ClubAccountCard({
  accessToken,
  club,
  onAccountAction,
  onClubPlanChange,
  onArchiveClub,
  onArchiveTeam,
  onToggleClubStatus,
  updatingClubId,
  updatingTeamId,
  updatingUserId,
}) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <ClubSummary
          club={club}
          onClubPlanChange={onClubPlanChange}
          onArchiveClub={onArchiveClub}
          onToggleClubStatus={onToggleClubStatus}
          updatingClubId={updatingClubId}
        />
        <ClubMetricGrid club={club} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <ClubUsersList
          club={club}
          onAccountAction={onAccountAction}
          updatingUserId={updatingUserId}
        />
        <ClubTeamsList
          club={club}
          onArchiveTeam={onArchiveTeam}
          updatingTeamId={updatingTeamId}
        />
      </div>
      <ClubAccessManagement accessToken={accessToken} club={club} />
    </div>
  )
}

function ClubSummary({
  club,
  onArchiveClub,
  onClubPlanChange,
  onToggleClubStatus,
  updatingClubId,
}) {
  const clubId = String(club?.id ?? '')
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-lg font-black text-[#101828]">{club.name}</p>
        <StatusPill status={club.status} />
      </div>
      <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
        Contact: {club.contactEmail || 'No email entered'}
        {club.contactPhone ? `, Phone: ${club.contactPhone}` : ''}
      </p>
      <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
        Latest activity: {formatPlatformDate(club.latestActivityAt)}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className={eyebrowClass}>Plan</span>
          <select
            value={club.planKey || ''}
            disabled={updatingClubId === clubId}
            title={updatingClubId === clubId ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => void onClubPlanChange(club, 'planKey', event.target.value)}
            className={fieldClass}
          >
            {!club.planKey ? (
              <option value="" disabled>
                Unknown plan
              </option>
            ) : null}
            {adminAssignablePlanOptions.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <BillingConfigurationControl
          key={`${clubId}:${club.billingArrangement || (club.isPlanComped ? 'complimentary' : 'immediate')}:${String(club.billingStartAt || '').slice(0, 10)}`}
          club={club}
          clubId={clubId}
          onClubPlanChange={onClubPlanChange}
          updatingClubId={updatingClubId}
        />
      </div>
      <TeamAllowanceControl
        key={`${clubId}:${club.teamLimitOverride ?? 'default'}`}
        club={club}
        clubId={clubId}
        onClubPlanChange={onClubPlanChange}
        updatingClubId={updatingClubId}
      />
      <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
        Current plan: {getPlanName(club)}, provider status: {club.planStatus || 'unknown'}, access: {club.billingAccessState || 'pending calculation'}
      </p>
      {club.suspendedAt ? (
        <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Suspended: {formatPlatformDate(club.suspendedAt)}</p>
      ) : null}
      <div className="mt-4 rounded-lg border border-[#fecdca] bg-[#fff8f8] p-4">
        <p className="text-sm font-black text-[#101828]">Need to delete this Club?</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
          Archive it first. You will be taken straight to the archived record where you can review the totals and permanently delete it with password confirmation.
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={updatingClubId === clubId}
          title={updatingClubId === clubId ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void onToggleClubStatus(club)}
          className={secondaryButtonClass}
        >
          {club.status === 'suspended' ? 'Reactivate' : 'Suspend'}
        </button>
        <button
          type="button"
          disabled={updatingClubId === clubId}
          title={updatingClubId === clubId ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void onArchiveClub(club)}
          className={dangerButtonClass}
        >
          Archive Club to continue deletion
        </button>
      </div>
    </div>
  )
}

function BillingConfigurationControl({ club, clubId, onClubPlanChange, updatingClubId }) {
  const savedArrangement = club.billingArrangement || (club.isPlanComped ? 'complimentary' : 'immediate')
  const savedStartDate = String(club.billingStartAt || '').slice(0, 10)
  const [arrangementDraft, setArrangementDraft] = useState(savedArrangement)
  const [startDateDraft, setStartDateDraft] = useState(savedStartDate)
  const [validationMessage, setValidationMessage] = useState('')
  const isComplimentaryOnlyPlan = [PLAN_KEYS.individual, PLAN_KEYS.pilot].includes(club.planKey)
  const isUpdating = updatingClubId === clubId
  const hasChanges = arrangementDraft !== savedArrangement
    || (arrangementDraft === 'deferred' ? startDateDraft !== savedStartDate : Boolean(savedStartDate))

  const handleArrangementChange = (value) => {
    setArrangementDraft(value)
    setStartDateDraft('')
    setValidationMessage('')
  }

  const handleSave = async () => {
    if (arrangementDraft === 'deferred' && !startDateDraft) {
      setValidationMessage('Choose a billing start date before saving Deferred access.')
      return
    }

    try {
      validateBillingArrangement({
        arrangement: arrangementDraft,
        startDate: startDateDraft,
        planKey: club.planKey,
      })
    } catch (error) {
      setValidationMessage(error.message)
      return
    }

    setValidationMessage('')
    const outcome = await onClubPlanChange(club, 'billingConfiguration', {
      billingArrangement: arrangementDraft,
      billingStartDate: arrangementDraft === 'deferred' ? startDateDraft : null,
    })

    if (outcome?.success === false) {
      setValidationMessage(outcome.message)
    }
  }

  return (
    <div className="md:col-span-2">
      <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-end">
        <label className="block">
          <span className={eyebrowClass}>Billing arrangement</span>
          <select
            value={arrangementDraft}
            disabled={isUpdating}
            title={isUpdating ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => handleArrangementChange(event.target.value)}
            className={fieldClass}
          >
            <option value="immediate" disabled={isComplimentaryOnlyPlan}>Immediate</option>
            <option value="deferred" disabled={isComplimentaryOnlyPlan}>Deferred</option>
            <option value="complimentary">Complimentary</option>
          </select>
        </label>
        <label className="block">
          <span className={eyebrowClass}>Billing start date</span>
          <input
            required={arrangementDraft === 'deferred'}
            type="date"
            min={getUkCalendarDate()}
            value={startDateDraft}
            disabled={arrangementDraft !== 'deferred' || isUpdating}
            title={isUpdating ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => {
              setStartDateDraft(event.target.value)
              setValidationMessage('')
            }}
            className={fieldClass}
          />
        </label>
        <button
          type="button"
          disabled={!hasChanges || isUpdating}
          title={isUpdating ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void handleSave()}
          className={secondaryButtonClass}
        >
          Save billing access
        </button>
      </div>
      <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
        A start date is required only for Deferred access. Immediate and Complimentary access clear any saved date.
      </p>
      {club.planKey === PLAN_KEYS.pilot ? (
        <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Pilot access is always free.</p>
      ) : null}
      {validationMessage ? (
        <p role="alert" className="mt-2 text-sm font-bold text-[#b42318]">{validationMessage}</p>
      ) : null}
    </div>
  )
}

function TeamAllowanceControl({ club, clubId, onClubPlanChange, updatingClubId }) {
  const customTeamLimit = club.teamLimitOverride ?? null
  const [teamLimitDraft, setTeamLimitDraft] = useState(customTeamLimit === null ? '' : String(customTeamLimit))
  const planTeamLimit = getPlanDefaultLimit(club, 'teams')
  const effectiveTeamLimit = getPlanLimit(club, 'teams')
  const normalizedDraft = teamLimitDraft.trim()
  const savedDraft = customTeamLimit === null ? '' : String(customTeamLimit)
  const canSaveTeamLimit = normalizedDraft !== savedDraft && updatingClubId !== clubId

  return (
    <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10">
      <div className="grid gap-3 lg:grid-cols-[minmax(180px,260px)_auto] lg:items-end">
        <label className="block">
          <span className={eyebrowClass}>Team allowance</span>
          <input
            type="number"
            min="1"
            max="500"
            step="1"
            inputMode="numeric"
            value={teamLimitDraft}
            disabled={updatingClubId === clubId}
            title={updatingClubId === clubId ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => setTeamLimitDraft(event.target.value)}
            placeholder={formatLimit(planTeamLimit)}
            className={fieldClass}
          />
        </label>
        <button
          type="button"
          disabled={!canSaveTeamLimit}
          title={updatingClubId === clubId ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void onClubPlanChange(club, 'teamLimitOverride', normalizedDraft)}
          className={secondaryButtonClass}
        >
          Save allowance
        </button>
      </div>
      <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
        Leave blank to use the plan default.
      </p>
      <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
        Current teams: {club.teamCount}. Plan default: {formatLimit(planTeamLimit)}. Custom override: {customTeamLimit === null ? 'None' : customTeamLimit}. Effective allowance: {formatLimit(effectiveTeamLimit)}.
      </p>
    </div>
  )
}

function ClubMetricGrid({ club }) {
  const metrics = [
    ['Users', club.userCount],
    ['Teams', club.teamCount],
    ['Players', club.playerCount],
    ['Shares', club.communicationCount],
    ['Trial', club.trialPlayerCount],
    ['Squad', club.squadPlayerCount],
  ]

  return (
    <div className="grid w-full gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4 2xl:max-w-[620px]">
      {metrics.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">{label}</p>
          <p className="mt-2 font-black text-[#101828]">{value}</p>
        </div>
      ))}
    </div>
  )
}

function ClubUsersList({ club, onAccountAction, updatingUserId }) {
  const users = Array.isArray(club?.users) ? club.users.filter((member) => member?.id) : []
  const roles = Array.isArray(club?.roles) ? club.roles.filter((role) => role?.roleKey) : []
  return (
    <div>
      <p className={eyebrowClass}>Adult user accounts</p>
      <div className="mt-3 space-y-2">
        {users.length === 0 ? (
          <p className={emptyStateClass}>No users found.</p>
        ) : (
          users.map((member) => (
            <div key={member.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-[#101828]">
                    {member.name || 'No name entered'}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-[#4b5f55]">{member.email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55] shadow-sm shadow-[#047857]/10">
                      {member.roleLabel}
                    </span>
                    <StatusPill status={member.status} />
                  </div>
                  <RoleChangeControl
                    key={`${member.id}:${member.role}`}
                    club={club}
                    member={member}
                    onAccountAction={onAccountAction}
                    roles={roles}
                    updatingUserId={updatingUserId}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                  <button
                    type="button"
                    disabled={updatingUserId === member.id}
                    title={updatingUserId === member.id ? 'Please wait while this user is being updated.' : undefined}
                    onClick={() =>
                      void onAccountAction(
                        club,
                        member,
                        member.status === 'suspended' ? 'reactivate' : 'suspend',
                      )
                    }
                    className={secondaryButtonClass}
                  >
                    {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                  </button>
                  <button
                    type="button"
                    disabled={updatingUserId === member.id}
                    title={updatingUserId === member.id ? 'Please wait while this user is being updated.' : undefined}
                    onClick={() => void onAccountAction(club, member, 'delete')}
                    className={dangerButtonClass}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function RoleChangeControl({ club, member, onAccountAction, roles, updatingUserId }) {
  const [roleKey, setRoleKey] = useState(member.role || '')
  const selectedRole = roles.find((role) => role.roleKey === roleKey)
  const isUnchanged = roleKey === member.role
  const isBusy = updatingUserId === member.id
  const isUnavailable = !member.membershipId || roles.length === 0

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block">
        <span className={eyebrowClass}>Club role</span>
        <select
          aria-label={`Club role for ${member.name || member.email}`}
          value={roleKey}
          disabled={isBusy || isUnavailable}
          onChange={(event) => setRoleKey(event.target.value)}
          className={fieldClass}
        >
          {roles.map((role) => (
            <option key={role.roleKey} value={role.roleKey}>
              {role.roleLabel}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={isBusy || isUnavailable || isUnchanged || !selectedRole}
        title={
          isUnavailable
            ? 'This club assignment is not available for role management.'
            : isUnchanged
              ? 'Choose a different role before continuing.'
              : undefined
        }
        onClick={() => void onAccountAction(club, member, 'role', selectedRole)}
        className={secondaryButtonClass}
      >
        Review role change
      </button>
    </div>
  )
}

function ClubTeamsList({ club, onArchiveTeam, updatingTeamId }) {
  const teams = Array.isArray(club?.teams) ? club.teams.filter((team) => team?.id) : []
  const roleCounts = Array.isArray(club?.roleCounts) ? club.roleCounts.filter((role) => role?.label) : []
  return (
    <div>
      <p className={eyebrowClass}>Teams</p>
      <div className="mt-3 space-y-2">
        {teams.length === 0 ? (
          <p className={emptyStateClass}>No teams found.</p>
        ) : (
          teams.map((team) => (
            <div
              key={team.id}
              className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-black text-[#101828]">{team.name}</span>
              <button
                type="button"
                disabled={updatingTeamId === team.id}
                title={updatingTeamId === team.id ? 'Please wait while this Team is being archived.' : undefined}
                onClick={() => void onArchiveTeam(club, team)}
                className={secondaryButtonClass}
              >
                Archive Team
              </button>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {roleCounts.length === 0 ? (
          <p className={emptyStateClass}>No role data found.</p>
        ) : (
          roleCounts.map((role) => (
            <div key={role.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10">
              <p className="text-sm font-black text-[#101828]">{role.label}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                {role.count} users
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ArchivedWorkspaceCard({
  club,
  onDeleteClub,
  onDeleteTeam,
  onRestoreClub,
  onRestoreTeam,
  updatingClubId,
  updatingTeamId,
}) {
  const clubId = String(club?.id ?? '')
  const isClubArchived = Boolean(club?.archivedAt)
  const teams = Array.isArray(club?.teams) ? club.teams.filter((team) => team?.id) : []

  return (
    <div className="rounded-lg border border-[#fecdca] bg-white p-5 shadow-sm shadow-[#b42318]/10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-lg font-black text-[#101828]">{club.name}</p>
            <StatusPill status={isClubArchived ? 'archived' : club.status} />
          </div>
          <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
            {isClubArchived
              ? `Club archived: ${formatPlatformDate(club.archivedAt)}`
              : `${teams.length} archived Team${teams.length === 1 ? '' : 's'} retained under this Club.`}
          </p>
          {isClubArchived ? (
            <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
              {club.userCount ?? 0} adult users, {club.teamCount ?? 0} Teams, {club.playerCount ?? 0} player records retained.
            </p>
          ) : null}
        </div>

        {isClubArchived ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={updatingClubId === clubId}
              onClick={() => void onRestoreClub(club)}
              className={secondaryButtonClass}
            >
              Restore Club
            </button>
            <button
              type="button"
              disabled={updatingClubId === clubId}
              onClick={() => void onDeleteClub(club)}
              className={dangerButtonClass}
            >
              Permanently delete
            </button>
          </div>
        ) : null}
      </div>

      {!isClubArchived ? (
        <div className="mt-5 space-y-2">
          {teams.map((team) => (
            <div
              key={team.id}
              className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-black text-[#101828]">{team.name}</p>
                <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Archived: {formatPlatformDate(team.archivedAt)}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={updatingTeamId === team.id}
                  onClick={() => void onRestoreTeam(club, team)}
                  className={secondaryButtonClass}
                >
                  Restore Team
                </button>
                <button
                  type="button"
                  disabled={updatingTeamId === team.id}
                  onClick={() => void onDeleteTeam(club, team)}
                  className={dangerButtonClass}
                >
                  Permanently delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
