import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canViewActivityLog, useAuth } from '../lib/auth.js'
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

export function ActivityLogPage() {
  const { user } = useAuth()
  const [logs, setLogs] = useState([])
  const [backups, setBackups] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

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
          withRequestTimeout(() => getAuditLogs({ user, limit: 150 }), 'Could not load activity.'),
          withRequestTimeout(() => getRecordBackups({ user, limit: 50 }), 'Could not load backups.'),
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
  }, [user])

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
        description="Managers and above can see activity in their club. Platform admins can see platform-wide activity."
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
            {logs.map((log) => (
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
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Backup journal"
        description="Core record changes are copied automatically so managers can see when data changed and platform admins have a fallback trail."
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
            {backups.map((backup) => (
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
          </div>
        )}
      </SectionCard>
    </div>
  )
}
