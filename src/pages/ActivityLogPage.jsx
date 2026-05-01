import { useEffect, useMemo, useState } from 'react'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canViewActivityLog, isSuperAdmin, useAuth } from '../lib/auth.js'
import { getAuditLogs, getRecordBackups, withRequestTimeout } from '../lib/supabase.js'

function formatDateTime(value) {
  if (!value) {
    return 'No date recorded'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'No date recorded'
  }

  return date.toLocaleString()
}

function formatAction(value) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return ''
  }

  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `${formatAction(key)}: ${String(value)}`)
    .join(' | ')
}

const LOG_PAGE_SIZE = 15
const BACKUP_PAGE_SIZE = 10

export function ActivityLogPage() {
  const { user } = useAuth()
  const [logs, setLogs] = useState([])
  const [backups, setBackups] = useState([])
  const [selectedActorId, setSelectedActorId] = useState('')
  const [selectedAction, setSelectedAction] = useState('')
  const [logPage, setLogPage] = useState(1)
  const [backupPage, setBackupPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const canViewSystemLogs = isSuperAdmin(user)

  useEffect(() => {
    let isMounted = true

    const loadLogs = async () => {
      if (!canViewActivityLog(user)) {
        setLogs([])
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      try {
        const [nextLogs, nextBackups] = await Promise.all([
          withRequestTimeout(() => getAuditLogs({ user, limit: 250 }), 'Could not load activity.'),
          canViewSystemLogs
            ? withRequestTimeout(() => getRecordBackups({ user, limit: 50 }), 'Could not load backups.')
            : Promise.resolve([]),
        ])

        if (!isMounted) {
          return
        }

        setLogs(nextLogs)
        setBackups(nextBackups)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Could not load activity.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadLogs()

    return () => {
      isMounted = false
    }
  }, [canViewSystemLogs, user])

  const actorOptions = useMemo(() => {
    const actors = new Map()

    logs.forEach((log) => {
      const actorId = String(log.actorId ?? '').trim()

      if (!actorId || actors.has(actorId)) {
        return
      }

      actors.set(actorId, {
        id: actorId,
        label: log.actorName || log.actorEmail || 'Unknown user',
        email: log.actorEmail || '',
        roleLabel: log.actorRoleLabel || '',
        roleRank: Number(log.actorRoleRank ?? 0),
      })
    })

    return Array.from(actors.values()).sort((left, right) =>
      left.label.localeCompare(right.label) || left.email.localeCompare(right.email),
    )
  }, [logs])

  const actionOptions = useMemo(
    () =>
      Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort((left, right) =>
        formatAction(left).localeCompare(formatAction(right)),
      ),
    [logs],
  )

  const filteredLogs = useMemo(
    () =>
      logs.filter((log) => {
        if (selectedActorId && String(log.actorId) !== selectedActorId) {
          return false
        }

        if (selectedAction && log.action !== selectedAction) {
          return false
        }

        return true
      }),
    [logs, selectedAction, selectedActorId],
  )
  const paginatedLogs = useMemo(
    () => getPaginatedItems(filteredLogs, logPage, LOG_PAGE_SIZE),
    [filteredLogs, logPage],
  )
  const paginatedBackups = useMemo(
    () => getPaginatedItems(backups, backupPage, BACKUP_PAGE_SIZE),
    [backupPage, backups],
  )

  if (!canViewActivityLog(user)) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Activity"
          title="Activity log"
          description="You do not have access to the activity log."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Activity"
        title="Activity log"
        description="Review page visits, key clicks, and important record changes for accountability."
      />

      {errorMessage ? (
        <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
          {errorMessage}
        </div>
      ) : null}

      <SectionCard
        title="Recent activity"
        description="Managers and above can see activity for users at their role level or below. Platform admins can see platform-wide activity."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading activity...
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No activity has been recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">User</span>
                <select
                  value={selectedActorId}
                  onChange={(event) => {
                    setSelectedActorId(event.target.value)
                    setLogPage(1)
                  }}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
                  onChange={(event) => {
                    setSelectedAction(event.target.value)
                    setLogPage(1)
                  }}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  <option value="">All events</option>
                  {actionOptions.map((action) => (
                    <option key={action} value={action}>
                      {formatAction(action)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
                No activity matches these filters.
              </div>
            ) : null}

            {paginatedLogs.items.map((log) => (
              <article
                key={log.id}
                className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{formatAction(log.action)}</p>
                    <p className="mt-1 break-words text-sm text-[var(--text-muted)]">
                      {log.actorName || log.actorEmail || 'Unknown user'}
                      {log.actorEmail && log.actorName ? ` | ${log.actorEmail}` : ''}
                      {log.actorRoleLabel ? ` | ${log.actorRoleLabel}` : ''}
                    </p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {log.entityType || 'record'}
                    </p>
                    {formatMetadata(log.metadata) ? (
                      <p className="mt-2 break-words text-sm text-[var(--text-muted)]">{formatMetadata(log.metadata)}</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-medium text-[var(--text-muted)]">{formatDateTime(log.createdAt)}</p>
                </div>
              </article>
            ))}
            <Pagination
              currentPage={logPage}
              onPageChange={setLogPage}
              pageSize={LOG_PAGE_SIZE}
              totalItems={filteredLogs.length}
            />
          </div>
        )}
      </SectionCard>

      {canViewSystemLogs ? (
        <SectionCard
          title="Backup journal"
          description="Core record changes are copied automatically so platform admins have a fallback trail."
        >
          {isLoading ? (
            <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
              Loading backups...
            </div>
          ) : backups.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
              No backup entries have been recorded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedBackups.items.map((backup) => (
                <article
                  key={backup.id}
                  className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {formatAction(backup.operation)} {formatAction(backup.tableName)}
                      </p>
                      <p className="mt-1 break-words text-sm text-[var(--text-muted)]">
                        Record: {backup.recordId || 'No record ID'}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-medium text-[var(--text-muted)]">{formatDateTime(backup.createdAt)}</p>
                  </div>
                </article>
              ))}
              <Pagination
                currentPage={backupPage}
                onPageChange={setBackupPage}
                pageSize={BACKUP_PAGE_SIZE}
                totalItems={backups.length}
              />
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  )
}
