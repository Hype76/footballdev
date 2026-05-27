import { supabaseAdmin } from './_supabase.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function successResponse(payload = {}) {
  return jsonResponse(200, { success: true, ...payload })
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return failureResponse(405, 'Method Not Allowed')
  }

  const token = String(event.queryStringParameters?.token ?? '').trim()

  if (!token) {
    return failureResponse(400, 'Parent invite token is required.')
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('parent_player_links')
      .select('id, email, status, invite_token, accepted_at, expires_at, link_type, players:player_id (player_name), teams:team_id (name), clubs:club_id (name, logo_url)')
      .eq('invite_token', token)
      .maybeSingle()

    if (error || !data) {
      return failureResponse(404, 'This parent invite could not be found.')
    }

    if (data.status === 'revoked') {
      return failureResponse(403, 'This parent invite is no longer available.')
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return failureResponse(410, 'This parent invite has expired. Ask the team to send a new family portal link.')
    }

    const player = Array.isArray(data.players) ? data.players[0] : data.players
    const team = Array.isArray(data.teams) ? data.teams[0] : data.teams
    const club = Array.isArray(data.clubs) ? data.clubs[0] : data.clubs

    return successResponse({
      invite: {
        id: data.id,
        email: String(data.email ?? '').trim().toLowerCase(),
        status: String(data.status ?? 'pending').trim(),
        linkType: String(data.link_type ?? 'parent').trim(),
        acceptedAt: data.accepted_at ?? '',
        expiresAt: data.expires_at ?? '',
        playerName: String(player?.player_name ?? '').trim(),
        teamName: String(team?.name ?? '').trim(),
        clubName: String(club?.name ?? '').trim(),
        clubLogoUrl: String(club?.logo_url ?? '').trim(),
      },
    })
  } catch (error) {
    console.error(error)
    return failureResponse(500, 'Parent invite details could not be loaded.')
  }
}
