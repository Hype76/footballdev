import {
  deriveTeamNotificationDisplayName,
  normalizeTeamNotificationDisplayName,
  resolveTeamNotificationDisplayName,
} from '../../../src/lib/team-notification-display.js'
import { assertCoachOperationalMutation, assertCoachOperationalRead } from './coachOperationalData'
import { supabase } from './supabase'

function normalize(value) {
  return String(value ?? '').trim()
}

export async function getCoachTeamNotificationDisplayName(user, teamId = user?.activeTeamId) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const normalizedTeamId = normalize(teamId)

  if (!normalizedTeamId) return ''

  const { data, error } = await supabase
    .from('teams')
    .select('name,notification_display_name')
    .eq('id', normalizedTeamId)
    .eq('club_id', user.clubId)
    .single()

  if (error) throw error

  return resolveTeamNotificationDisplayName(data, user.activeTeamName || '')
}

export async function saveCoachTeamNotificationDisplayName(user, teamId, displayName) {
  assertCoachOperationalMutation(user, { minimumRank: 20, requiresTeam: true })
  const normalizedTeamId = normalize(teamId)
  const normalizedDisplayName = normalizeTeamNotificationDisplayName(displayName)
    || deriveTeamNotificationDisplayName(user.activeTeamName || '')

  if (!normalizedTeamId || !normalizedDisplayName) {
    throw new Error('Add a notification Team name.')
  }

  const { data, error } = await supabase.rpc('set_team_notification_display_name', {
    display_name_value: normalizedDisplayName,
    team_id_value: normalizedTeamId,
  })

  if (error) throw error

  return resolveTeamNotificationDisplayName(data, user.activeTeamName || '')
}
