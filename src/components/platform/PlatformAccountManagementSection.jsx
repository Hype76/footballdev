import { PLAN_OPTIONS, getPlanName } from '../../lib/plans.js'
import { formatPlatformDate } from '../../lib/platform-admin-stats.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'
import { StatusPill } from '../ui/StatusPill.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10'

export function PlatformAccountManagementSection({
  clubPage,
  clubSearchTerm,
  isLoading,
  onAccountAction,
  onClubSearchChange,
  onClubPageChange,
  onClubPlanChange,
  onDeleteClub,
  onDeleteTeam,
  onSelectedClubChange,
  onToggleClubStatus,
  paginatedClubs,
  pageSize,
  selectedClubId,
  stats,
  updatingClubId,
  updatingTeamId,
  updatingUserId,
  visibleClubs,
}) {
  const searchValue = String(clubSearchTerm ?? '')
  const normalizedSearchValue = searchValue.trim().toLowerCase()
  const clubSuggestions = (stats?.clubs ?? [])
    .filter((club) => {
      if (!normalizedSearchValue) {
        return true
      }

      return String(club.name ?? '').toLowerCase().includes(normalizedSearchValue)
    })
    .slice(0, 12)

  return (
    <SectionCard
      title="Account management"
      description="Manage clubs, teams, and adult user access. Player names and child contact details are intentionally excluded."
    >
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(220px,360px)_minmax(260px,1fr)]">
        <label className="block">
          <span className={labelClass}>Club filter</span>
          <select
            value={selectedClubId}
            onChange={(event) => onSelectedClubChange(event.target.value)}
            className={fieldClass}
          >
            <option value="All">All clubs</option>
            {(stats?.clubs ?? []).map((club) => (
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
            list="platform-club-search-suggestions"
            value={searchValue}
            onChange={(event) => onClubSearchChange(event.target.value)}
            placeholder="Search by club, contact, team, user, plan, or status"
            className={fieldClass}
          />
          <datalist id="platform-club-search-suggestions">
            {clubSuggestions.map((club) => (
              <option key={club.id} value={club.name} />
            ))}
          </datalist>
        </label>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
          Loading platform stats...
        </div>
      ) : visibleClubs.length === 0 ? (
        <div className={emptyStateClass}>
          {searchValue.trim() ? 'No clubs match that search.' : 'No clubs found yet.'}
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedClubs.items.map((club) => (
            <ClubAccountCard
              key={club.id}
              club={club}
              onAccountAction={onAccountAction}
              onClubPlanChange={onClubPlanChange}
              onDeleteClub={onDeleteClub}
              onDeleteTeam={onDeleteTeam}
              onToggleClubStatus={onToggleClubStatus}
              updatingClubId={updatingClubId}
              updatingTeamId={updatingTeamId}
              updatingUserId={updatingUserId}
            />
          ))}
          <Pagination
            currentPage={clubPage}
            onPageChange={onClubPageChange}
            pageSize={pageSize}
            totalItems={visibleClubs.length}
          />
        </div>
      )}
    </SectionCard>
  )
}

function ClubAccountCard({
  club,
  onAccountAction,
  onClubPlanChange,
  onDeleteClub,
  onDeleteTeam,
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
          onDeleteClub={onDeleteClub}
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
          onDeleteTeam={onDeleteTeam}
          updatingTeamId={updatingTeamId}
        />
      </div>
    </div>
  )
}

function ClubSummary({
  club,
  onClubPlanChange,
  onDeleteClub,
  onToggleClubStatus,
  updatingClubId,
}) {
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
            value={club.planKey || 'small_club'}
            disabled={updatingClubId === club.id}
            title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => void onClubPlanChange(club, 'planKey', event.target.value)}
            className={fieldClass}
          >
            {PLAN_OPTIONS.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={eyebrowClass}>Billing status</span>
          <select
            value={club.planStatus || 'active'}
            disabled={updatingClubId === club.id}
            title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => void onClubPlanChange(club, 'planStatus', event.target.value)}
            className={fieldClass}
          >
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 md:mt-7">
          <input
            type="checkbox"
            checked={Boolean(club.isPlanComped)}
            disabled={updatingClubId === club.id}
            title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => void onClubPlanChange(club, 'isPlanComped', event.target.checked)}
            className="h-4 w-4 accent-[#047857]"
          />
          <span>Free access</span>
        </label>
      </div>
      <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
        Current plan: {getPlanName(club)}{club.isPlanComped ? ', Billing override: free access' : ''}
      </p>
      {club.suspendedAt ? (
        <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Suspended: {formatPlatformDate(club.suspendedAt)}</p>
      ) : null}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={updatingClubId === club.id}
          title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void onToggleClubStatus(club)}
          className={secondaryButtonClass}
        >
          {club.status === 'suspended' ? 'Reactivate' : 'Suspend'}
        </button>
        <button
          type="button"
          disabled={updatingClubId === club.id}
          title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void onDeleteClub(club)}
          className={dangerButtonClass}
        >
          Delete
        </button>
      </div>
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
  return (
    <div>
      <p className={eyebrowClass}>Adult user accounts</p>
      <div className="mt-3 space-y-2">
        {club.users.length === 0 ? (
          <p className={emptyStateClass}>No users found.</p>
        ) : (
          club.users.map((member) => (
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

function ClubTeamsList({ club, onDeleteTeam, updatingTeamId }) {
  return (
    <div>
      <p className={eyebrowClass}>Teams</p>
      <div className="mt-3 space-y-2">
        {club.teams.length === 0 ? (
          <p className={emptyStateClass}>No teams found.</p>
        ) : (
          club.teams.map((team) => (
            <div
              key={team.id}
              className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-black text-[#101828]">{team.name}</span>
              <button
                type="button"
                disabled={updatingTeamId === team.id}
                title={updatingTeamId === team.id ? 'Please wait while this team is being deleted.' : undefined}
                onClick={() => void onDeleteTeam(club, team)}
                className={dangerButtonClass}
              >
                Delete team
              </button>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {club.roleCounts.length === 0 ? (
          <p className={emptyStateClass}>No role data found.</p>
        ) : (
          club.roleCounts.map((role) => (
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
