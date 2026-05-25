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
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading activity...
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No activity has been recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">User</span>
              <select
                value={selectedActorId}
                onChange={(event) => onActorChange(event.target.value)}
                className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
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
              <span className="mb-2 block text-sm font-bold text-slate-950">Event</span>
              <select
                value={selectedAction}
                onChange={(event) => onActionChange(event.target.value)}
                className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
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
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              No activity matches these filters.
            </div>
          ) : null}

          {paginatedLogs.items.map((log) => {
            const metadata = formatActivityMetadata(log.metadata)

            return (
              <article
                key={log.id}
                className="rounded-md border border-slate-200 bg-white p-4 shadow-sm "
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-950">{formatActivityAction(log.action)}</p>
                    <p className="mt-1 break-words text-sm text-slate-600">
                      {log.actorName || log.actorEmail || 'Unknown user'}
                      {log.actorEmail && log.actorName ? ` | ${log.actorEmail}` : ''}
                      {log.actorRoleLabel ? ` | ${log.actorRoleLabel}` : ''}
                    </p>
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                      {log.entityType || 'record'}
                    </p>
                    {metadata ? (
                      <p className="mt-2 break-words text-sm text-slate-600">{metadata}</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-bold text-slate-500">{formatActivityDateTime(log.createdAt)}</p>
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
