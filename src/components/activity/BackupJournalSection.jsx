import { BACKUP_PAGE_SIZE, formatActivityAction, formatActivityDateTime } from '../../lib/activity-log-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function BackupJournalSection({
  backupPage,
  backups,
  isLoading,
  onPageChange,
  paginatedBackups,
}) {
  return (
    <SectionCard
      title="Backup journal"
      description="Core record changes are copied automatically so platform admins have a fallback trail."
    >
      {isLoading ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading backups...
        </div>
      ) : backups.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No backup entries have been recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedBackups.items.map((backup) => (
            <article
              key={backup.id}
              className="rounded-md border border-slate-200 bg-white p-4 shadow-sm "
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-950">
                    {formatActivityAction(backup.operation)} {formatActivityAction(backup.tableName)}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-600">
                    Record: {backup.recordId || 'No record ID'}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-slate-500">{formatActivityDateTime(backup.createdAt)}</p>
              </div>
            </article>
          ))}
          <Pagination
            currentPage={backupPage}
            onPageChange={onPageChange}
            pageSize={BACKUP_PAGE_SIZE}
            totalItems={backups.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
