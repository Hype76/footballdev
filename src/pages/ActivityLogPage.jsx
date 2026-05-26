import { useEffect, useMemo, useState } from 'react'
import { BackupJournalSection } from '../components/activity/BackupJournalSection.jsx'
import { RecentActivitySection } from '../components/activity/RecentActivitySection.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { canViewActivityLog, isSuperAdmin, useAuth } from '../lib/auth.js'
import { BACKUP_PAGE_SIZE, LOG_PAGE_SIZE, formatActivityAction } from '../lib/activity-log-utils.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import { getAuditLogs, getRecordBackups, withRequestTimeout } from '../lib/supabase.js'

const activityRules = [
  {
    label: 'Find the change',
    body: 'Start with the person, action, and record type before asking staff what happened.',
  },
  {
    label: 'Keep scope tight',
    body: 'Club staff see their allowed football workspace. Platform admins can inspect the wider trail.',
  },
  {
    label: 'Use facts first',
    body: 'Treat this as an operations record for parent updates, squad changes, and match records.',
  },
]

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
  const activitySummary = [
    {
      label: 'Events visible',
      value: filteredLogs.length,
      caption: selectedActorId || selectedAction ? 'After the current filters.' : 'Allowed by your role and plan.',
    },
    {
      label: 'Users found',
      value: actorOptions.length,
      caption: 'Actors with activity in the loaded window.',
    },
    {
      label: 'Event types',
      value: actionOptions.length,
      caption: 'Different actions recorded for this workspace.',
    },
  ]

  if (!canViewActivityLog(user)) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <ActivityAccessState
          title="Activity log unavailable"
          description="You do not have access to the activity log."
        />
      </div>
    )
  }

  if (!canUseAuditLogs) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <ActivityAccessState
          title="Activity log unavailable"
          description={createFeatureUpgradeMessage('auditLogs')}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Activity control</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight text-[#0f172a] sm:text-5xl">
              Review the club trail before a small issue becomes a phone call.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475569]">
              Filter the audit window by user or event, then use the record details to answer parent, coach, or admin questions quickly.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {activityRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-4 shadow-sm shadow-[#2563eb]/10">
                  <p className="text-sm font-black text-[#0f172a]">{rule.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-5 shadow-sm shadow-[#2563eb]/10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Loaded window</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#0f172a]">
                {isLoading ? 'Loading activity' : `${filteredLogs.length} events visible`}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
                {selectedActorId || selectedAction ? 'Filters are applied to the loaded audit window.' : 'Results follow your role and plan access.'}
              </p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {activitySummary.map((item) => (
                <ActivityMetric key={item.label} label={item.label} value={isLoading ? '...' : item.value} />
              ))}
              <ActivityMetric label="Backups" value={isLoading ? '...' : backups.length} />
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-4 py-3 text-sm font-black text-[#b42318]">
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

function ActivityAccessState({ title, description }) {
  return (
    <section className="rounded-lg border border-[#cbd5e1] bg-white px-5 py-6 shadow-sm shadow-[#2563eb]/10 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Activity control</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-[#0f172a]">{title}</h1>
      <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#475569]">{description}</p>
    </section>
  )
}

function ActivityMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#cbd5e1] bg-white px-4 py-4 shadow-sm shadow-[#2563eb]/10">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#2563eb]">{label}</p>
      <p className="mt-2 break-words text-2xl font-black text-[#0f172a]">{value}</p>
    </div>
  )
}
