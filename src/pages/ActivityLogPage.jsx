import { useEffect, useMemo, useState } from 'react'
import { BackupJournalSection } from '../components/activity/BackupJournalSection.jsx'
import { RecentActivitySection } from '../components/activity/RecentActivitySection.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { canViewActivityLog, isSuperAdmin, useAuth } from '../lib/auth.js'
import { BACKUP_PAGE_SIZE, LOG_PAGE_SIZE, formatActivityAction } from '../lib/activity-log-utils.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import { getAuditLogs, getRecordBackups, withRequestTimeout } from '../lib/supabase.js'

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
  const canUseAuditLogs = hasPlanFeature(user, 'auditLogs')

  useEffect(() => {
    let isMounted = true

    const loadLogs = async () => {
      if (!canViewActivityLog(user) || !canUseAuditLogs) {
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
  }, [canUseAuditLogs, canViewSystemLogs, user])

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
        formatActivityAction(left).localeCompare(formatActivityAction(right)),
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

  if (!canUseAuditLogs) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Activity"
          title="Activity log"
          description={createFeatureUpgradeMessage('auditLogs')}
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
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
          {errorMessage}
        </div>
      ) : null}

      <RecentActivitySection
        actionOptions={actionOptions}
        actorOptions={actorOptions}
        filteredLogs={filteredLogs}
        isLoading={isLoading}
        logPage={logPage}
        logs={logs}
        onActionChange={(nextAction) => {
          setSelectedAction(nextAction)
          setLogPage(1)
        }}
        onActorChange={(nextActorId) => {
          setSelectedActorId(nextActorId)
          setLogPage(1)
        }}
        onPageChange={setLogPage}
        paginatedLogs={paginatedLogs}
        selectedAction={selectedAction}
        selectedActorId={selectedActorId}
      />

      {canViewSystemLogs ? (
        <BackupJournalSection
          backupPage={backupPage}
          backups={backups}
          isLoading={isLoading}
          onPageChange={setBackupPage}
          paginatedBackups={paginatedBackups}
        />
      ) : null}
    </div>
  )
}
