import { createSupabaseAdminClient } from './lib/_supabase.js'

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

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient(event)
    const token = String(event.queryStringParameters?.token ?? '').trim()

    if (!token) {
      return failureResponse(400, 'Staff invite token is required.')
    }

    const { data, error } = await supabaseAdmin
      .from('club_user_invites')
      .select('id, club_id, email, role_label, team_id, expires_at, accepted_at, invite_token, status, cancelled_at, replaced_at, teams:team_id (name), clubs:club_id (name, logo_url)')
      .eq('invite_token', token)
      .maybeSingle()

    if (error || !data) {
      return failureResponse(404, 'This staff invite could not be found.')
    }

    if (data.accepted_at) {
      return failureResponse(409, 'This staff invite has already been accepted.')
    }

    if ((data.status && data.status !== 'pending') || data.cancelled_at || data.replaced_at) {
      return failureResponse(410, 'This staff invite is no longer active.')
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return failureResponse(410, 'This staff invite has expired. Ask the club to send a new staff invite.')
    }

    const club = Array.isArray(data.clubs) ? data.clubs[0] : data.clubs
    const team = Array.isArray(data.teams) ? data.teams[0] : data.teams
    const { data: inviteTeams, error: inviteTeamsError } = await supabaseAdmin
      .from('club_user_invite_teams')
      .select('team_id, teams:team_id(name)')
      .eq('invite_id', data.id)

    if (inviteTeamsError && inviteTeamsError.code !== '42P01') {
      throw inviteTeamsError
    }

    const teamNames = (inviteTeams || [])
      .map((row) => Array.isArray(row.teams) ? row.teams[0]?.name : row.teams?.name)
      .filter(Boolean)

    return jsonResponse(200, {
      success: true,
      invite: {
        token: data.invite_token,
        email: String(data.email ?? '').trim().toLowerCase(),
        roleLabel: String(data.role_label ?? '').trim(),
        clubName: String(club?.name ?? '').trim(),
        logoUrl: String(club?.logo_url ?? '').trim(),
        teamName: teamNames.join(', ') || String(team?.name ?? '').trim(),
        expiresAt: data.expires_at ?? '',
      },
    })
  } catch (error) {
    console.error(error)
    return failureResponse(500, 'Staff invite could not be loaded.')
  }
}
