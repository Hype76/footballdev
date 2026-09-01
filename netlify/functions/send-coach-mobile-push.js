import { sendExpoPushMessages } from './lib/_expo-push.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { getMatchDayDisplayName } from '../../src/lib/matchday-display.js'
import { assertWorkspaceBillingAction } from './lib/_billing-access.js'
import { buildCoachAvailabilityResponsePayload } from './lib/_coach-availability-push.js'
import { buildScopedNotificationTitle, hydrateNotificationScopeNames } from './lib/_notification-scope.js'
import { resolveMatchDayNotificationTeamName } from '../../src/lib/team-notification-display.js'

export { buildCoachAvailabilityResponsePayload } from './lib/_coach-availability-push.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

async function getAuthUser(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  return data.user
}

async function getProfile(authUser) {
  const email = normalizeText(authUser.email).toLowerCase()
  const userProfile = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, email, role, role_rank, club_id, status',
  })
  return {
    clubId: userProfile.club_id,
    email,
    id: userProfile.id,
    role: normalizeText(userProfile.role),
    roleRank: Number(userProfile.role_rank ?? 0),
  }
}

async function getMatch(matchDayId) {
  const { data, error } = await supabaseAdmin
    .from('match_days')
    .select('id, club_id, team_id, notification_team_name, opponent, teams:team_id (id, name, notification_display_name, status, archived_at), clubs:club_id (name)')
    .eq('id', matchDayId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Match Day could not be found.'), {
      statusCode: 404,
    })
  }

  return data
}

async function getParentTrainingAvailabilityResponse({ authUser, parentLinkId, requestPlayerId, respondedAt }) {
  if (!parentLinkId || !requestPlayerId || !respondedAt) {
    throw Object.assign(new Error('Training response details are required.'), { statusCode: 400 })
  }

  const { data: link, error: linkError } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, status')
    .eq('id', parentLinkId)
    .eq('auth_user_id', authUser.id)
    .eq('status', 'active')
    .maybeSingle()
  if (linkError) throw linkError
  if (!link?.id) throw Object.assign(new Error('This Parent link cannot notify Coaches.'), { statusCode: 403 })

  const { data: requestPlayer, error: requestPlayerError } = await supabaseAdmin
    .from('training_availability_request_players')
    .select('id, request_id, club_id, team_id, calendar_event_id, player_id, player_name, status')
    .eq('id', requestPlayerId)
    .eq('club_id', link.club_id)
    .eq('team_id', link.team_id)
    .eq('player_id', link.player_id)
    .maybeSingle()
  if (requestPlayerError) throw requestPlayerError
  if (!requestPlayer?.id || requestPlayer.status !== 'responded') {
    throw Object.assign(new Error('This Training response cannot notify Coaches.'), { statusCode: 403 })
  }

  const [{ data: response, error: responseError }, { data: calendarEvent, error: calendarError }] = await Promise.all([
    supabaseAdmin
      .from('training_availability_responses')
      .select('status, responded_at')
      .eq('request_id', requestPlayer.request_id)
      .eq('player_id', requestPlayer.player_id)
      .maybeSingle(),
    supabaseAdmin
      .from('calendar_events')
      .select('id, club_id, team_id, event_type, title, cancelled_at')
      .eq('id', requestPlayer.calendar_event_id)
      .eq('club_id', requestPlayer.club_id)
      .eq('team_id', requestPlayer.team_id)
      .eq('event_type', 'training')
      .is('cancelled_at', null)
      .maybeSingle(),
  ])
  if (responseError) throw responseError
  if (calendarError) throw calendarError
  if (!response?.status || normalizeText(response.responded_at) !== respondedAt || !calendarEvent?.id) {
    throw Object.assign(new Error('This Training response is no longer current.'), { statusCode: 409 })
  }

  return {
    calendarEvent,
    playerName: requestPlayer.player_name,
    status: response.status,
  }
}

async function canNotifyCoaches({ authUser, match, profile, type }) {
  if (type === 'scorer_volunteer' && profile.role === 'parent_portal') {
    const { data, error } = await supabaseAdmin
      .from('match_day_scorer_interest')
      .select('id')
      .eq('match_day_id', match.id)
      .eq('auth_user_id', authUser.id)
      .maybeSingle()

    if (error) {
      throw error
    }

    return Boolean(data?.id)
  }

  if (profile.clubId !== match.club_id || profile.role === 'parent_portal' || profile.role === 'super_admin') return false
  const team = Array.isArray(match.teams) ? match.teams[0] : match.teams
  if (!match.team_id) return profile.role === 'admin' && profile.roleRank >= 90
  if (!team?.id || normalizeText(team.status || 'active') !== 'active' || team.archived_at) return false
  if (profile.role === 'admin' && profile.roleRank >= 90) return true

  const { data: assignment, error } = await supabaseAdmin
    .from('team_staff')
    .select('id, role_rank')
    .eq('team_id', match.team_id)
    .eq('user_id', profile.id)
    .maybeSingle()
  if (error) throw error
  return Boolean(assignment?.id && Number(assignment.role_rank ?? 0) >= 20)
}

function getTeamName(match) {
  return resolveMatchDayNotificationTeamName(match) || 'Your team'
}

function buildPayload({ detailLevel, match, type }) {
  const teamName = getTeamName(match)
  const club = Array.isArray(match.clubs) ? match.clubs[0] : match.clubs
  const clubName = normalizeText(club?.name)
  const matchName = getMatchDayDisplayName({ ...match, teamName })
  const detailed = detailLevel === 'detailed'

  if (type === 'scorer_volunteer') {
    return {
      body: detailed
        ? `A scorer volunteer is ready to review for ${matchName}.`
        : 'A scorer volunteer is ready to review.',
      data: {
        app: 'coach',
        clubName,
        contextId: match.team_id ? `team:${match.team_id}` : `club:${match.club_id}`,
        matchDayId: match.id,
        route: 'matchday',
        teamId: match.team_id || '',
        teamName,
        type,
      },
      title: buildScopedNotificationTitle('Scorer volunteer', { clubName, teamName }),
      type,
    }
  }

  return {
    body: detailed ? matchName : 'You have a new Coach update.',
    data: {
      app: 'coach',
      clubName,
      contextId: match.team_id ? `team:${match.team_id}` : `club:${match.club_id}`,
      matchDayId: match.id,
      route: 'matchday',
      teamId: match.team_id || '',
      teamName,
      type,
    },
    title: buildScopedNotificationTitle('Coach update', { clubName, teamName }),
    type,
  }
}

async function getCoachDevices(match, client = supabaseAdmin) {
  const { data, error } = await client
    .from('coach_mobile_push_installations')
    .select(
      'installation_id, auth_user_id, user_profile_id, club_id, team_id, context_id, expo_push_token, detail_level',
    )
    .eq('status', 'active')
    .eq('enabled', true)
    .neq('detail_level', 'off')

  if (error) {
    throw error
  }

  const current = await Promise.all(
    (data ?? []).map(async (device) => {
      try {
        const profile = await loadActiveAuthorityProfile(
          client,
          { id: device.auth_user_id },
          {
            select: 'id, club_id, role, role_rank, status',
          },
        )
        const role = normalizeText(profile.role)
        const roleRank = Number(profile.role_rank ?? 0)
        if (
          profile.id !== device.user_profile_id ||
          profile.club_id !== match.club_id ||
          role === 'parent_portal' ||
          role === 'super_admin' ||
          roleRank < 20
        )
          return null

        if (!match.team_id) return role === 'admin' && roleRank >= 90 ? device : null

        const { data: team, error: teamError } = await client
          .from('teams')
          .select('id, club_id, status, archived_at')
          .eq('id', match.team_id)
          .eq('club_id', match.club_id)
          .maybeSingle()
        if (teamError) throw teamError
        if (!team?.id || normalizeText(team.status || 'active') !== 'active' || team.archived_at) return null
        if (role === 'admin' && roleRank >= 90) return device

        const { data: assignment, error: assignmentError } = await client
          .from('team_staff')
          .select('id, role_rank')
          .eq('team_id', team.id)
          .eq('user_id', profile.id)
          .maybeSingle()
        if (assignmentError) throw assignmentError
        return assignment?.id && Number(assignment.role_rank ?? 0) >= 20 ? device : null
      } catch (error) {
        console.warn('Coach mobile installation authority refresh failed', {
          errorName: normalizeText(error?.name || 'Error'),
          installationId: device.installation_id,
        })
        return null
      }
    }),
  )

  return current.filter(Boolean)
}

async function logNotificationEvents({ client = supabaseAdmin, deliveries, match, status }) {
  if (deliveries.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const { error } = await client.from('coach_mobile_notification_events').insert(
    deliveries.map(({ device, payload }) => ({
      installation_id: device.installation_id,
      auth_user_id: device.auth_user_id,
      user_profile_id: device.user_profile_id,
      club_id: match.club_id,
      data: payload.data,
      intent_type: payload.type,
      title: payload.title,
      body: payload.body,
      sent_at: status === 'sent' ? now : null,
      status,
      team_id: match.team_id || null,
    })),
  )

  if (error) {
    console.error('Coach notification event log failed', error)
  }
}

async function revokeMobileDeviceTokens(deviceTokens, client = supabaseAdmin) {
  const tokens = [...new Set(deviceTokens.map(normalizeText).filter(Boolean))]

  if (tokens.length === 0) {
    return
  }

  const { error } = await client
    .from('coach_mobile_push_installations')
    .update({
      expo_push_token: null,
      enabled: false,
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .in('expo_push_token', tokens)

  if (error) {
    console.error('Coach mobile push device revoke failed', error)
  }
}

export async function sendCoachAvailabilityResponsePush({
  adminClient = supabaseAdmin,
  clubId,
  contextLabel = '',
  playerName = '',
  route,
  status,
  targetId,
  teamId,
  type,
} = {}) {
  const normalizedStatus = normalizeText(status).toLowerCase()
  if (!clubId || !teamId || !targetId || !['available', 'unavailable', 'maybe'].includes(normalizedStatus)) {
    return { failed: 0, sent: 0, skipped: true }
  }

  const match = { club_id: clubId, id: targetId, team_id: teamId }
  const devices = await getCoachDevices(match, adminClient)
  const [scope] = await hydrateNotificationScopeNames(adminClient, [match])
  const deliveries = devices.map((device) => ({
    device,
    payload: buildCoachAvailabilityResponsePayload({ clubName: scope?.club_name, contextLabel, detailLevel: device.detail_level, playerName, route, status: normalizedStatus, targetId, teamId, teamName: scope?.team_name, type }),
  }))
  const pushResult = await sendExpoPushMessages(deliveries.map(({ device, payload }) => ({
    body: payload.body,
    data: payload.data,
    sound: 'default',
    title: payload.title,
    to: device.expo_push_token,
  })))
  await revokeMobileDeviceTokens(pushResult.invalidTokens || [], adminClient)
  await logNotificationEvents({
    client: adminClient,
    deliveries,
    match,
    status: pushResult.failed > 0 && pushResult.sent === 0 ? 'failed' : 'sent',
  })
  return { failed: pushResult.failed, sent: pushResult.sent, skipped: devices.length === 0 }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(event)
    const profile = await getProfile(authUser)
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const type = normalizeText(body.type) || 'coach_update'

    if (type === 'training_availability_response') {
      if (profile.role !== 'parent_portal') {
        return failureResponse(403, 'Only the responding Parent can send this Coach notification.')
      }
      const trainingResponse = await getParentTrainingAvailabilityResponse({
        authUser,
        parentLinkId: normalizeText(body.parentLinkId),
        requestPlayerId: normalizeText(body.requestPlayerId),
        respondedAt: normalizeText(body.respondedAt),
      })
      await assertWorkspaceBillingAction({ clubId: trainingResponse.calendarEvent.club_id, profile })
      const pushResult = await sendCoachAvailabilityResponsePush({
        clubId: trainingResponse.calendarEvent.club_id,
        contextLabel: normalizeText(trainingResponse.calendarEvent.title) || 'training',
        playerName: trainingResponse.playerName,
        route: 'sessions',
        status: trainingResponse.status,
        targetId: trainingResponse.calendarEvent.id,
        teamId: trainingResponse.calendarEvent.team_id,
        type,
      })
      return jsonResponse(200, { ...pushResult, success: true })
    }

    await assertWorkspaceBillingAction({ clubId: profile.club_id, profile })

    if (!matchDayId || !['coach_update', 'scorer_volunteer'].includes(type)) {
      return failureResponse(400, 'Match Day is required.')
    }

    const match = await getMatch(matchDayId)
    const isAllowed = await canNotifyCoaches({
      authUser,
      match,
      profile,
      type,
    })

    if (!isAllowed) {
      return failureResponse(403, 'You cannot send coach notifications for this match.')
    }

    const devices = await getCoachDevices(match)
    const deliveries = devices.map((device) => ({
      device,
      payload: buildPayload({ detailLevel: device.detail_level, match, type }),
    }))
    const pushResult = await sendExpoPushMessages(
      deliveries.map(({ device, payload }) => ({
        body: payload.body,
        data: payload.data,
        sound: 'default',
        title: payload.title,
        to: device.expo_push_token,
      })),
    )
    await revokeMobileDeviceTokens(pushResult.invalidTokens || [])

    await logNotificationEvents({
      deliveries,
      match,
      status: pushResult.failed > 0 && pushResult.sent === 0 ? 'failed' : 'sent',
    })

    return jsonResponse(200, {
      failed: pushResult.failed,
      sent: pushResult.sent,
      success: true,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Coach notifications could not be sent.')
  }
}
