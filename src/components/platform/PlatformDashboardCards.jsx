import { Link } from 'react-router-dom'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlatformPlanMixSection({ planBreakdown, platformTotals }) {
  return (
    <SectionCard
      title="Plan mix"
      description="How active club workspaces are currently distributed."
    >
      <div className="space-y-3">
        {Object.entries(planBreakdown).length > 0 ? (
          Object.entries(planBreakdown).map(([planName, count]) => (
            <div key={planName} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 shadow-sm shadow-black/10">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-black text-[var(--text-primary)]">{planName}</p>
                <p className="text-lg font-black text-[var(--accent)]">{count}</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-lg bg-[var(--accent-soft)]">
                <div
                  className="h-full rounded-lg bg-[var(--accent)] transition-all duration-700"
                  style={{
                    width: `${Math.max(8, Math.round((count / Math.max(1, platformTotals.clubs ?? 1)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm font-semibold text-[var(--text-muted)] shadow-sm shadow-black/10">
            No plan data is available yet.
          </p>
        )}
      </div>
    </SectionCard>
  )
}

export function PlatformDataHygieneSection({ platformTotals }) {
  return (
    <SectionCard
      title="Data hygiene"
      description="Separated live records from archived and internal platform records."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 shadow-sm shadow-black/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">Active players</p>
          <p className="mt-2 text-3xl font-black text-[var(--text-primary)]">{platformTotals.players ?? 0}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">{platformTotals.archivedPlayers ?? 0} archived records excluded</p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 shadow-sm shadow-black/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">Recent admin activity</p>
          <p className="mt-2 text-3xl font-black text-[var(--text-primary)]">{platformTotals.recentAdminActions ?? 0}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">Actions recorded in the last 7 days</p>
        </div>
      </div>
    </SectionCard>
  )
}

export function PlatformOperationalSummarySection({
  openIssueCount = 0,
  platformTotals = {},
}) {
  const roleBreakdown = Array.isArray(platformTotals.staffRoleBreakdown)
    ? platformTotals.staffRoleBreakdown
    : []

  return (
    <SectionCard
      title="Operational summary"
      description="Recent activity, account context, and unresolved platform work."
      storageKey="platform-operational-summary"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Recent admin actions</p>
          <p className="mt-2 text-3xl font-black text-[var(--text-primary)]">{platformTotals.recentAdminActions ?? 0}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">Recorded in the last 7 days.</p>
          <Link className="mt-3 inline-flex min-h-11 items-center font-black text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" to="/platform-data-hygiene#recent-activity">
            View data hygiene
          </Link>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Open platform issues</p>
          <p className="mt-2 text-3xl font-black text-[var(--text-primary)]">{openIssueCount}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">Product and production reports needing review.</p>
          <Link className="mt-3 inline-flex min-h-11 items-center font-black text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" to="/platform-feedback">
            View platform feedback
          </Link>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Coach role mix</p>
          <p className="mt-2 text-sm font-semibold text-[var(--text-muted)]">
            {platformTotals.staffAccounts ?? 0} Coach accounts, excluding {platformTotals.parentAccounts ?? 0} parent accounts.
          </p>
          <ul className="mt-3 space-y-1 text-sm font-bold text-[var(--text-primary)]">
            {roleBreakdown.slice(0, 4).map((role) => (
              <li key={role.label} className="flex justify-between gap-3">
                <span>{role.label}</span>
                <span>{role.count}</span>
              </li>
            ))}
          </ul>
          <Link className="mt-3 inline-flex min-h-11 items-center font-black text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" to="/platform-staff">
            View Platform Admins
          </Link>
        </div>
      </div>
    </SectionCard>
  )
}

export function PlatformStaffRoleSummarySection({ platformTotals = {} }) {
  const roleBreakdown = Array.isArray(platformTotals.staffRoleBreakdown)
    ? platformTotals.staffRoleBreakdown
    : []

  return (
    <SectionCard
      title="Coach access context"
      description="Coach account totals and role labels. Parent accounts remain separate."
      storageKey="platform-staff-role-context"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roleBreakdown.map((role) => (
          <div key={role.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <p className="text-sm font-black text-[var(--text-primary)]">{role.label}</p>
            <p className="mt-2 text-3xl font-black text-[var(--accent)]">{role.count}</p>
          </div>
        ))}
        {!roleBreakdown.length ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm font-semibold text-[var(--text-muted)]">
            No Coach role data is available.
          </p>
        ) : null}
      </div>
    </SectionCard>
  )
}
