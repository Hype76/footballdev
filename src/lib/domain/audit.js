import { supabase } from '../supabase-client.js'
import { isDemoEmail } from '../demo.js'
import { CAPABILITIES } from '../paywall-access.js'
import { isParentPortalUser } from '../auth-permissions.js'
import { assertClubFeature } from './plan-gates.js'

function getEntryUserName(user) {
  return String(user?.username ?? user?.name ?? user?.email ?? '').trim()
}

function getEntryUserEmail(user) {
  return String(user?.email ?? '').trim().toLowerCase()
}

function isDemoAccountValue(account) {
  return Boolean(account?.isDemoAccount) || isDemoEmail(account?.email)
}

async function isCurrentSessionDemoUser() {
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    console.error(error)
    return false
  }

  return isDemoEmail(data?.user?.email)
}

function normalizeAuditLogRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    actorId: row.actor_id ?? row.actorId ?? '',
    actorName: String(row.actor_name ?? row.actorName ?? '').trim(),
    actorEmail: String(row.actor_email ?? row.actorEmail ?? '').trim(),
    actorRoleLabel: String(row.actor_role_label ?? row.actorRoleLabel ?? '').trim(),
    actorRoleRank: Number(row.actor_role_rank ?? row.actorRoleRank ?? 0),
    action: String(row.action ?? '').trim(),
    entityType: String(row.entity_type ?? row.entityType ?? '').trim(),
    entityId: row.entity_id ?? row.entityId ?? '',
    metadata: row.metadata ?? {},
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function normalizeRecordBackupRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    tableName: String(row.table_name ?? row.tableName ?? '').trim(),
    recordId: row.record_id ?? row.recordId ?? '',
    operation: String(row.operation ?? '').trim(),
    actorId: row.actor_id ?? row.actorId ?? '',
    actorRoleLabel: String(row.actor_role_label ?? row.actorRoleLabel ?? '').trim(),
    actorRoleRank: Number(row.actor_role_rank ?? row.actorRoleRank ?? 0),
    oldData: row.old_data ?? row.oldData ?? null,
    newData: row.new_data ?? row.newData ?? null,
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

async function getVisibleActorIdsForActiveTeam(user) {
  const activeTeamId = String(user?.activeTeamId ?? '').trim()

  if (!user?.clubId || !activeTeamId) {
    return new Set([String(user?.id ?? '')].filter(Boolean))
  }

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from('team_staff')
    .select('user_id')
    .eq('team_id', activeTeamId)

  if (assignmentError) {
    console.error(assignmentError)
    throw assignmentError
  }

  return new Set([
    String(user.id),
    ...(assignmentRows ?? []).map((row) => String(row.user_id ?? '').trim()).filter(Boolean),
  ])
}

export async function createAuditLog({ user, action, entityType, entityId, metadata = {} }) {
  if (isDemoAccountValue(user) || (!user && await isCurrentSessionDemoUser())) {
    return
  }

  if (isParentPortalUser(user)) {
    return
  }

  if (!action || !entityType) {
    return
  }

  const normalizedMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...metadata }
      : {}

  if (user?.activeTeamId && !normalizedMetadata.teamId) {
    normalizedMetadata.teamId = user.activeTeamId
  }

  if (user?.activeTeamName && !normalizedMetadata.teamName) {
    normalizedMetadata.teamName = user.activeTeamName
  }

  const { error } = await supabase.from('audit_logs').insert({
    club_id: user?.clubId || null,
    actor_id: user?.id || null,
    actor_name: user ? getEntryUserName(user) : '',
    actor_email: user ? getEntryUserEmail(user) : '',
    actor_role_label: user?.roleLabel || user?.role || '',
    actor_role_rank: Number(user?.roleRank ?? 0),
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata: normalizedMetadata,
  })

  if (error) {
    console.error(error)
  }
}

export async function getAuditLogs({ user, limit = 100 } = {}) {
  if (!user?.id) {
    return []
  }

  if (user.role !== 'super_admin' && Number(user.roleRank ?? 0) < 50) {
    return []
  }

  if (user.role !== 'super_admin') {
    try {
      await assertClubFeature({
        user,
        clubId: user.clubId,
        featureName: CAPABILITIES.fullOperationalAuditLog,
      })
    } catch {
      return []
    }
  }

  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 250))

  if (user.role !== 'super_admin') {
    query = query.eq('club_id', user.clubId)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  const normalizedLogs = (data ?? []).map(normalizeAuditLogRow)

  if (user.role === 'super_admin') {
    return normalizedLogs
  }

  const currentRank = Number(user.roleRank ?? 0)
  const rankFilteredLogs = normalizedLogs.filter(
    (log) => String(log.actorId) === String(user.id) || Number(log.actorRoleRank ?? 0) <= currentRank,
  )

  if (user.role === 'admin') {
    return rankFilteredLogs
  }

  const activeTeamId = String(user.activeTeamId ?? '').trim()

  if (!activeTeamId) {
    return rankFilteredLogs.filter((log) => String(log.actorId) === String(user.id))
  }

  const visibleActorIds = await getVisibleActorIdsForActiveTeam(user)

  return rankFilteredLogs.filter((log) => {
    const logTeamId = String(log.metadata?.teamId ?? log.metadata?.team_id ?? '').trim()

    if (logTeamId) {
      return logTeamId === activeTeamId
    }

    return visibleActorIds.has(String(log.actorId))
  })
}

export async function getRecordBackups({ user, limit = 50 } = {}) {
  if (!user?.id) {
    return []
  }

  if (user.role !== 'super_admin') {
    return []
  }

  const { data, error } = await supabase
    .from('record_backups')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeRecordBackupRow)
}
