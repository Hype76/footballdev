import { CAPABILITIES, getFeatureAccess } from '../../../src/lib/paywall-access.js'
import { supabase } from './supabase'

function normalize(value) {
  return String(value ?? '').trim()
}

export function assertCoachOperationalRead(user, { requiresTeam = false } = {}) {
  if (!user?.id || !user?.clubId || Number(user?.roleRank || 0) < 20 || user?.role === 'super_admin') {
    throw new Error('An active operational Coach context is required.')
  }
  if (requiresTeam && !user?.activeTeamId) throw new Error('Choose an active Team context.')
}

export function assertCoachOperationalMutation(user, { minimumRank = 20, requiresTeam = false } = {}) {
  assertCoachOperationalRead(user, { requiresTeam })
  if (Number(user?.roleRank || 0) < minimumRank) throw new Error('This Coach role cannot make that change.')
  if (user?.hasActivePlanAccess !== true) throw new Error('Operational changes are blocked while payment is required.')
}

export function assertCoachCapability(user, capability) {
  const access = getFeatureAccess({
    ...user,
    teamId: user?.activeTeamId,
  }, capability)
  if (!access.allowed) throw new Error(`${access.label} is not available for this plan and Coach context.`)
  return access
}

export function getCoachCapabilityKeys() {
  return CAPABILITIES
}

export function getCoachEntryIdentity(user, prefix = 'created') {
  const lead = `${prefix}_`
  return {
    [`${lead}by_email`]: normalize(user?.email).toLowerCase(),
    [`${lead}by_name`]: normalize(user?.displayName || user?.name || user?.email),
  }
}

export async function recordCoachOperationalAudit({ user, action, entityType, entityId, metadata = {} }) {
  if (!action || !entityType || !user?.id) return
  const scopedMetadata = {
    ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
  }
  if (user.activeTeamId && !scopedMetadata.teamId) scopedMetadata.teamId = user.activeTeamId
  if (user.activeTeamName && !scopedMetadata.teamName) scopedMetadata.teamName = user.activeTeamName
  const { error } = await supabase.rpc('record_security_audit_event', {
    p_action: action,
    p_correlation_id: null,
    p_entity_id: entityId || null,
    p_entity_type: entityType,
    p_event_category: 'operational',
    p_metadata: { ...scopedMetadata, appSource: 'coach_mobile_test' },
    p_outcome: 'success',
    p_severity: 'info',
    p_source: 'application',
  })
  if (error) console.warn(error)
}

export function scopeCoachQuery(query, user, { includeClubWide = false, teamColumn = 'team_id' } = {}) {
  if (user?.activeTeamId) {
    return includeClubWide
      ? query.or(`${teamColumn}.eq.${user.activeTeamId},${teamColumn}.is.null`)
      : query.eq(teamColumn, user.activeTeamId)
  }
  return query.is(teamColumn, null)
}
