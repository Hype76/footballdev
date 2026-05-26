import { BACKUP_PAGE_SIZE, formatActivityAction, formatActivityDateTime } from '../../lib/activity-log-utils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const emptyStateClass = 'rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-4 py-6 text-sm font-semibold text-[#5f7468]'
const loadingStateClass = 'rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-4 text-sm font-semibold text-[#5f7468]'

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
      description="Platform admins can inspect fallback records for core football data changes."
    >
      {isLoading ? (
        <div className={loadingStateClass}>
          Loading backups...
        </div>
      ) : backups.length === 0 ? (
        <div className={emptyStateClass}>
          No backup entries have been recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedBackups.items.map((backup) => (
            <article
              key={backup.id}
              className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-4 shadow-sm shadow-[#d7eadf]/60"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#101828]">
                    {formatActivityAction(backup.operation)} {formatActivityAction(backup.tableName)}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-[#5f7468]">
                    Record: {backup.recordId || 'No record ID'}
                  </p>
                </div>
                <p className="shrink-0 rounded-lg border border-[#bfe8cd] bg-white px-3 py-2 text-sm font-black text-[#456653]">{formatActivityDateTime(backup.createdAt)}</p>
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
