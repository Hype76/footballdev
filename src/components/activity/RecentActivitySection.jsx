import { LOG_PAGE_SIZE, formatActivityAction, formatActivityDateTime, formatActivityMetadata } from '../../lib/activity-log-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function RecentActivitySection({
  actionOptions,
  actorOptions,
  filteredLogs,
  isLoading,
  logPage,
  logs,
  onActionChange,
  onActorChange,
  onPageChange,
  paginatedLogs,
  selectedAction,
  selectedActorId,
}) {
  return (
    <SectionCard
      title="Recent activity"
      description="Managers and above can see activity for users at their role level or below. Platform admins can see platform-wide activity."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading activity...
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No activity has been recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">User</span>
              <select
                value={selectedActorId}
                onChange={(event) => onActorChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="">All allowed users</option>
                {actorOptions.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.label}{actor.email ? ` | ${actor.email}` : ''}{actor.roleLabel ? ` | ${actor.roleLabel}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Event</span>
              <select
                value={selectedAction}
                onChange={(event) => onActionChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="">All events</option>
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {formatActivityAction(action)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
              No activity matches these filters.
            </div>
          ) : null}

          {paginatedLogs.items.map((log) => {
            const metadata = formatActivityMetadata(log.metadata)

            return (
              <article
                key={log.id}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{formatActivityAction(log.action)}</p>
                    <p className="mt-1 break-words text-sm text-[var(--text-muted)]">
                      {log.actorName || log.actorEmail || 'Unknown user'}
                      {log.actorEmail && log.actorName ? ` | ${log.actorEmail}` : ''}
                      {log.actorRoleLabel ? ` | ${log.actorRoleLabel}` : ''}
                    </p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {log.entityType || 'record'}
                    </p>
                    {metadata ? (
                      <p className="mt-2 break-words text-sm text-[var(--text-muted)]">{metadata}</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-medium text-[var(--text-muted)]">{formatActivityDateTime(log.createdAt)}</p>
                </div>
              </article>
            )
          })}
          <Pagination
            currentPage={logPage}
            onPageChange={onPageChange}
            pageSize={LOG_PAGE_SIZE}
            totalItems={filteredLogs.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
