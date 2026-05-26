import { LOG_PAGE_SIZE, formatActivityAction, formatActivityDateTime, formatActivityMetadata } from '../../lib/activity-log-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const fieldLabelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const selectClass = 'min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#dbeafe]'
const emptyStateClass = 'rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-6 text-sm font-semibold text-[#475569]'
const loadingStateClass = 'rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-4 text-sm font-semibold text-[#475569]'

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
      description="Choose a staff member or event type, then inspect the exact record context before replying."
    >
      {isLoading ? (
        <div className={loadingStateClass}>
          Loading activity...
        </div>
      ) : logs.length === 0 ? (
        <div className={emptyStateClass}>
          No activity has been recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className={fieldLabelClass}>User</span>
              <select
                value={selectedActorId}
                onChange={(event) => onActorChange(event.target.value)}
                className={selectClass}
              >
                <option value="">All allowed users</option>
                {actorOptions.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.label}{actor.email ? `, ${actor.email}` : ''}{actor.roleLabel ? `, ${actor.roleLabel}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Event</span>
              <select
                value={selectedAction}
                onChange={(event) => onActionChange(event.target.value)}
                className={selectClass}
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
            <div className={emptyStateClass}>
              No activity matches these filters.
            </div>
          ) : null}

          {paginatedLogs.items.map((log) => {
            const metadata = formatActivityMetadata(log.metadata)

            return (
              <article
                key={log.id}
                className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[#10231a]">{formatActivityAction(log.action)}</p>
                    <p className="mt-1 break-words text-sm font-semibold text-[#475569]">
                      {log.actorName || log.actorEmail || 'Unknown user'}
                      {log.actorEmail && log.actorName ? `, ${log.actorEmail}` : ''}
                      {log.actorRoleLabel ? `, ${log.actorRoleLabel}` : ''}
                    </p>
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#2563eb]">
                      {log.entityType || 'record'}
                    </p>
                    {metadata ? (
                      <p className="mt-2 break-words text-sm font-semibold text-[#475569]">{metadata}</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-black text-[#475569]">{formatActivityDateTime(log.createdAt)}</p>
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
