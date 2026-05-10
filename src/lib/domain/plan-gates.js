import { EVALUATION_SECTIONS, supabase } from '../supabase-client.js'
import {
  createFeatureUpgradeMessage,
  createLimitUpgradeMessage,
  getPlanLimit,
  hasPlanFeature,
} from '../plans.js'
import {
  isPastDate,
  normalizeWords,
} from './core-normalizers.js'
import { fetchClubDetails } from './club-data.js'

export function getPlanGateUser(user, club = null) {
  const testerAccessExpiresAt = user?.testerAccessExpiresAt ?? user?.tester_access_expires_at ?? club?.tester_access_expires_at ?? club?.testerAccessExpiresAt
  const testerAccessExpired = isPastDate(testerAccessExpiresAt)

  return {
    ...user,
    planKey: user?.planKey ?? user?.plan_key ?? club?.plan_key ?? club?.planKey,
    planStatus: user?.planStatus ?? user?.plan_status ?? club?.plan_status ?? club?.planStatus,
    isPlanComped: testerAccessExpired ? false : (user?.isPlanComped ?? user?.is_plan_comped ?? club?.is_plan_comped ?? club?.isPlanComped),
    testerAccessExpired,
  }
}

export async function getClubPlanGateUser({ user = null, clubId = '' } = {}) {
  if (user?.planKey || user?.plan_key || user?.role === 'super_admin') {
    return getPlanGateUser(user)
  }

  const normalizedClubId = String(clubId || user?.clubId || user?.club_id || '').trim()

  if (!normalizedClubId) {
    return getPlanGateUser(user)
  }

  const club = await fetchClubDetails(normalizedClubId)
  return getPlanGateUser(user, club)
}

export async function assertClubFeature({ user = null, clubId = '', featureName }) {
  const planUser = await getClubPlanGateUser({ user, clubId })

  if (!hasPlanFeature(planUser, featureName)) {
    throw new Error(createFeatureUpgradeMessage(featureName))
  }
}

export async function assertClubLimitAvailable({ user = null, clubId = '', limitName, label, currentCount }) {
  const planUser = await getClubPlanGateUser({ user, clubId })
  const limit = getPlanLimit(planUser, limitName)

  if (limit !== null && limit !== undefined && Number(currentCount ?? 0) >= Number(limit)) {
    throw new Error(createLimitUpgradeMessage(planUser, limitName, label))
  }
}

export async function getActivePlayerCount(clubId) {
  const { count, error } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .neq('status', 'archived')

  if (error) {
    console.error(error)
    throw error
  }

  return Number(count ?? 0)
}

export async function findExistingPlayer({ clubId, section, playerName, team = '' }) {
  const normalizedPlayerName = normalizeWords(playerName)
  const normalizedTeam = String(team ?? '').trim()
  const normalizedSection = EVALUATION_SECTIONS.includes(section) ? section : ''

  if (!clubId || !normalizedPlayerName) {
    return null
  }

  const { data, error } = await supabase
    .from('players')
    .select('id, status, section, team')
    .eq('club_id', clubId)
    .eq('player_name', normalizedPlayerName)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  const rows = data ?? []
  return (
    rows.find(
      (player) =>
        normalizedTeam &&
        normalizedSection &&
        String(player.team ?? '').trim() === normalizedTeam &&
        player.section === normalizedSection,
    ) ??
    rows.find((player) => normalizedTeam && String(player.team ?? '').trim() === normalizedTeam) ??
    rows.find((player) => normalizedSection && player.section === normalizedSection) ??
    rows[0] ??
    null
  )
}

export async function assertPlayerLimitForUpsert({ user = null, clubId, section, playerName, team = '' }) {
  const existingPlayer = await findExistingPlayer({ clubId, section, playerName, team })

  if (existingPlayer && String(existingPlayer.status ?? '').trim().toLowerCase() !== 'archived') {
    return existingPlayer
  }

  const activePlayerCount = await getActivePlayerCount(clubId)
  await assertClubLimitAvailable({
    user,
    clubId,
    limitName: 'players',
    label: 'Players',
    currentCount: activePlayerCount,
  })

  return existingPlayer
}

export async function getMonthlyEvaluationCount(clubId, referenceDate = new Date()) {
  const monthStart = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1)).toISOString()

  const { count, error } = await supabase
    .from('evaluations')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .gte('created_at', monthStart)

  if (error) {
    console.error(error)
    throw error
  }

  return Number(count ?? 0)
}

export async function getClubAccessEmails(clubId) {
  const [usersResult, invitesResult] = await Promise.all([
    supabase.from('users').select('email').eq('club_id', clubId),
    supabase.from('club_user_invites').select('email').eq('club_id', clubId).is('accepted_at', null),
  ])

  if (usersResult.error) {
    console.error(usersResult.error)
    throw usersResult.error
  }

  if (invitesResult.error) {
    console.error(invitesResult.error)
    throw invitesResult.error
  }

  return new Set(
    [
      ...(usersResult.data ?? []).map((row) => row.email),
      ...(invitesResult.data ?? []).map((row) => row.email),
    ]
      .map((email) => String(email ?? '').trim().toLowerCase())
      .filter(Boolean),
  )
}

export async function assertStaffLoginLimitForEmail({ user, email }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  const accessEmails = await getClubAccessEmails(user.clubId)

  if (accessEmails.has(normalizedEmail)) {
    return
  }

  await assertClubLimitAvailable({
    user,
    clubId: user.clubId,
    limitName: 'staffLogins',
    label: 'Staff logins',
    currentCount: accessEmails.size,
  })
}
