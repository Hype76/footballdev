import { PLAN_OPTIONS, getPlanName } from '../../lib/plans.js'
import { formatPlatformDate } from '../../lib/platform-admin-stats.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'
import { StatusPill } from '../ui/StatusPill.jsx'

export function PlatformAccountManagementSection({
  clubPage,
  isLoading,
  onAccountAction,
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
  return (
    <SectionCard
      title="Account management"
      description="Manage clubs, teams, and adult user access. Player names and child contact details are intentionally excluded."
    >
      <div className="mb-5 max-w-sm">
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-950">Club filter</span>
          <select
            value={selectedClubId}
            onChange={(event) => onSelectedClubChange(event.target.value)}
            className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          >
            <option value="All">All clubs</option>
            {(stats?.clubs ?? []).map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? (
        <div className="border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
          Loading platform stats...
        </div>
      ) : visibleClubs.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
          No clubs found yet.
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
    <div className="border border-slate-200 bg-white p-5">
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
        <p className="text-lg font-black text-slate-950">{club.name}</p>
        <StatusPill status={club.status} />
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Contact: {club.contactEmail || 'No email entered'}
        {club.contactPhone ? ` | ${club.contactPhone}` : ''}
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Latest activity: {formatPlatformDate(club.latestActivityAt)}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Plan</span>
          <select
            value={club.planKey || 'small_club'}
            disabled={updatingClubId === club.id}
            title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => void onClubPlanChange(club, 'planKey', event.target.value)}
            className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
          >
            {PLAN_OPTIONS.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Billing status</span>
          <select
            value={club.planStatus || 'active'}
            disabled={updatingClubId === club.id}
            title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => void onClubPlanChange(club, 'planStatus', event.target.value)}
            className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
          >
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-950 md:mt-7">
          <input
            type="checkbox"
            checked={Boolean(club.isPlanComped)}
            disabled={updatingClubId === club.id}
            title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
            onChange={(event) => void onClubPlanChange(club, 'isPlanComped', event.target.checked)}
            className="h-4 w-4"
          />
          <span>Free access</span>
        </label>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Current plan: {getPlanName(club)}{club.isPlanComped ? ' | Free access enabled' : ''}
      </p>
      {club.suspendedAt ? (
        <p className="mt-2 text-sm text-slate-600">Suspended: {formatPlatformDate(club.suspendedAt)}</p>
      ) : null}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={updatingClubId === club.id}
          title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void onToggleClubStatus(club)}
          className="inline-flex min-h-11 items-center justify-center border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {club.status === 'suspended' ? 'Reactivate' : 'Suspend'}
        </button>
        <button
          type="button"
          disabled={updatingClubId === club.id}
          title={updatingClubId === club.id ? 'Please wait while this club is being updated.' : undefined}
          onClick={() => void onDeleteClub(club)}
          className="inline-flex min-h-11 items-center justify-center border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
        <div key={label} className="border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-2 font-black text-slate-950">{value}</p>
        </div>
      ))}
    </div>
  )
}

function ClubUsersList({ club, onAccountAction, updatingUserId }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Adult user accounts</p>
      <div className="mt-3 space-y-2">
        {club.users.length === 0 ? (
          <p className="text-sm text-slate-600">No users found.</p>
        ) : (
          club.users.map((member) => (
            <div key={member.id} className="border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-slate-950">
                    {member.name || 'No name entered'}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-600">{member.email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-sm border border-slate-200 bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-600">
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
                    className="inline-flex min-h-11 items-center justify-center border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                  </button>
                  <button
                    type="button"
                    disabled={updatingUserId === member.id}
                    title={updatingUserId === member.id ? 'Please wait while this user is being updated.' : undefined}
                    onClick={() => void onAccountAction(club, member, 'delete')}
                    className="inline-flex min-h-11 items-center justify-center border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Teams</p>
      <div className="mt-3 space-y-2">
        {club.teams.length === 0 ? (
          <p className="text-sm text-slate-600">No teams found.</p>
        ) : (
          club.teams.map((team) => (
            <div
              key={team.id}
              className="flex flex-col gap-3 border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-black text-slate-950">{team.name}</span>
              <button
                type="button"
                disabled={updatingTeamId === team.id}
                title={updatingTeamId === team.id ? 'Please wait while this team is being deleted.' : undefined}
                onClick={() => void onDeleteTeam(club, team)}
                className="inline-flex min-h-11 items-center justify-center border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete Team
              </button>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {club.roleCounts.length === 0 ? (
          <p className="text-sm text-slate-600">No role data found.</p>
        ) : (
          club.roleCounts.map((role) => (
            <div key={role.label} className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-black text-slate-950">{role.label}</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                {role.count} users
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
