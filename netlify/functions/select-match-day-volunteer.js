import { createFromAddress } from './lib/_email-provider.js'
import { json } from './lib/_stripe-billing.js'
import { createPublicSupabaseClient, createSupabaseAdminClient } from './lib/_supabase.js'

const ROLE_CONFIG = {
  scorer: {
    label: 'Scorer',
    responseField: 'volunteer_scorer_response',
  },
  linesman: {
    label: 'Linesman',
    responseField: 'volunteer_linesman_response',
  },
  referee: {
    label: 'Referee',
    responseField: 'volunteer_referee_response',
  },
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function escapeHtml(value) {
  return normalizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function createRequestSupabaseClient(event, token) {
  return createPublicSupabaseClient(event, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

async function getAuthenticatedProfile(event, supabase) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, email, name, display_name, role, role_label, role_rank, club_id')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile?.club_id || profile.role === 'parent_portal' || profile.role === 'super_admin' || Number(profile.role_rank ?? 0) < 20) {
    throw Object.assign(new Error('Coach or manager access is required.'), { statusCode: 403 })
  }

  return profile
}

function formatTime(value) {
  const normalizedValue = normalizeText(value)
  return normalizedValue ? normalizedValue.slice(0, 5) : 'Not set'
}

function formatDate(value) {
  return normalizeText(value) || 'Not set'
}

function getAssignmentParentEmail(assignment) {
  const parentLink = Array.isArray(assignment?.parent_player_links)
    ? assignment.parent_player_links[0]
    : assignment?.parent_player_links
  return normalizeEmail(parentLink?.email)
}

function getAssignmentParentLabel(assignment) {
  const parentLink = Array.isArray(assignment?.parent_player_links)
    ? assignment.parent_player_links[0]
    : assignment?.parent_player_links
  const player = Array.isArray(parentLink?.players) ? parentLink.players[0] : parentLink?.players
  return normalizeText(parentLink?.email || player?.player_name || 'Parent')
}

function buildRoleNotificationEmail({ match, profile, recipientEmail, recipientName, role, action }) {
  const roleLabel = ROLE_CONFIG[role]?.label || 'Volunteer'
  const teamName = normalizeText(match.teams?.name || match.team_name || 'the team')
  const opponent = normalizeText(match.opponent || 'Fixture')
  const selectedCopy = action === 'selected'
    ? `You have been selected as ${roleLabel.toLowerCase()} for this fixture.`
    : `You are no longer selected as ${roleLabel.toLowerCase()} for this fixture.`
  const subject = `${teamName} Match Day ${roleLabel.toLowerCase()} update`
  const details = [
    ['Opponent', opponent],
    ['Date', formatDate(match.match_date)],
    ['Kick off', formatTime(match.kickoff_time)],
    ['Venue', normalizeText(match.venue_name) || 'Not set'],
  ]
  const rows = details.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;color:#4b5f55;font-weight:700;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:#101828;font-weight:800;">${escapeHtml(value)}</td>
    </tr>
  `).join('')

  return {
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;">
        <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">Match Day volunteer</p>
        <h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;">${escapeHtml(roleLabel)} update</h1>
        <p style="margin:0 0 20px;color:#4b5f55;font-size:15px;line-height:1.6;">
          Hi ${escapeHtml(recipientName || 'there')}, ${escapeHtml(selectedCopy)}
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 22px;">${rows}</table>
        <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
          Updated by ${escapeHtml(profile.display_name || profile.name || profile.email || 'team staff')}.
        </p>
      </div>
    `,
    to: [recipientEmail],
  }
}

async function queueRoleNotification(adminSupabase, { match, profile, recipientEmail, recipientName, role, action, parentLinkId }) {
  const normalizedEmail = normalizeEmail(recipientEmail)

  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Selected parent does not have a valid email address.')
  }

  const email = buildRoleNotificationEmail({
    match,
    profile,
    recipientEmail: normalizedEmail,
    recipientName,
    role,
    action,
  })

  const payload = {
    resendPayload: {
      from: createFromAddress('Football Player'),
      to: email.to,
      subject: email.subject,
      html: email.html,
    },
    displayName: 'Football Player',
    teamName: normalizeText(match.teams?.name || match.team_name),
    clubName: '',
    playerName: '',
    parentName: normalizeText(recipientName),
    clubId: match.club_id,
    teamId: match.team_id || null,
    actorId: profile.id,
    actorEmail: normalizeEmail(profile.email),
    actorRole: profile.role || '',
    requiredFeature: 'parentEmails',
    matchDayRoleSelection: {
      matchDayId: match.id,
      role,
      action,
      parentLinkId,
    },
  }

  const { data, error } = await adminSupabase
    .from('scheduled_email_queue')
    .insert({
      club_id: match.club_id,
      team_id: match.team_id || null,
      created_by: profile.id,
      created_by_email: normalizeEmail(profile.email),
      to_email: normalizedEmail,
      subject: email.subject,
      status: 'scheduled',
      scheduled_at: new Date().toISOString(),
      payload,
    })
    .select('id')
    .single()

  if (error) {
    throw error
  }

  return data
}

async function resolveParentLink(adminSupabase, { match, request }) {
  const baseSelect = 'id, club_id, team_id, player_id, email, auth_user_id, status, players:player_id (player_name)'
  let parentLink = null

  if (request.parent_link_id) {
    const { data, error } = await adminSupabase
      .from('parent_player_links')
      .select(baseSelect)
      .eq('id', request.parent_link_id)
      .eq('club_id', match.club_id)
      .eq('status', 'active')
      .maybeSingle()

    if (error) {
      throw error
    }

    parentLink = data
  } else {
    const requestEmail = normalizeEmail(request.recipient_email)
    const { data, error } = await adminSupabase
      .from('parent_player_links')
      .select(baseSelect)
      .eq('club_id', match.club_id)
      .eq('player_id', request.player_id)
      .eq('status', 'active')

    if (error) {
      throw error
    }

    const matches = (data || []).filter((link) => normalizeEmail(link.email) === requestEmail)

    if (matches.length === 1) {
      parentLink = matches[0]
    } else if (matches.length > 1) {
      throw Object.assign(new Error('This volunteer could not be assigned because more than one linked parent matches that response.'), { statusCode: 409 })
    }
  }

  if (!parentLink?.id) {
    throw Object.assign(new Error('This volunteer could not be assigned because the linked parent account could not be resolved.'), { statusCode: 409 })
  }

  if (String(parentLink.player_id || '') !== String(request.player_id || '')) {
    throw Object.assign(new Error('This volunteer could not be assigned because the parent link does not match the response player.'), { statusCode: 409 })
  }

  if (match.team_id && parentLink.team_id && String(parentLink.team_id) !== String(match.team_id)) {
    throw Object.assign(new Error('This volunteer could not be assigned because the parent link is outside this team.'), { statusCode: 409 })
  }

  return parentLink
}

async function getCurrentAssignment(adminSupabase, matchDayId, role) {
  const { data, error } = await adminSupabase
    .from('match_day_role_assignments')
    .select('*, parent_player_links:parent_link_id (email, auth_user_id, players:player_id (player_name))')
    .eq('match_day_id', matchDayId)
    .eq('role', role)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function upsertRoleAssignment(adminSupabase, { match, parentLink, profile, role }) {
  const payload = {
    match_day_id: match.id,
    club_id: match.club_id,
    team_id: match.team_id || null,
    role,
    parent_link_id: parentLink.id,
    auth_user_id: parentLink.auth_user_id || null,
    assigned_by: profile.id,
    assigned_by_name: normalizeText(profile.display_name || profile.name || profile.email),
    updated_at: new Date().toISOString(),
  }
  const { error } = await adminSupabase
    .from('match_day_role_assignments')
    .upsert(payload, { onConflict: 'match_day_id,role' })

  if (error) {
    throw error
  }
}

async function syncLegacyScorerAssignment(adminSupabase, { match, parentLink, profile, selected }) {
  const { error: deleteError } = await adminSupabase
    .from('match_day_scorer_assignments')
    .delete()
    .eq('match_day_id', match.id)

  if (deleteError) {
    throw deleteError
  }

  if (selected === false) {
    return
  }

  const { error: insertError } = await adminSupabase
    .from('match_day_scorer_assignments')
    .insert({
      match_day_id: match.id,
      club_id: match.club_id,
      team_id: match.team_id || null,
      parent_link_id: parentLink.id,
      auth_user_id: parentLink.auth_user_id || null,
      assigned_by: profile.id,
      assigned_by_name: normalizeText(profile.display_name || profile.name || profile.email),
    })

  if (insertError) {
    throw insertError
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const token = getBearerToken(event)
    const supabase = createRequestSupabaseClient(event, token)
    const adminSupabase = createSupabaseAdminClient(event)
    const profile = await getAuthenticatedProfile(event, supabase)
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const requestId = normalizeText(body.requestId)
    const role = normalizeText(body.role).toLowerCase()
    const selected = body.selected !== false
    const roleConfig = ROLE_CONFIG[role]

    if (!matchDayId || !requestId) {
      throw Object.assign(new Error('Choose a volunteer response first.'), { statusCode: 400 })
    }

    if (!roleConfig) {
      throw Object.assign(new Error('Choose a valid volunteer role.'), { statusCode: 400 })
    }

    const { data: match, error: matchError } = await supabase
      .from('match_days')
      .select('*, teams:team_id (name)')
      .eq('id', matchDayId)
      .eq('club_id', profile.club_id)
      .maybeSingle()

    if (matchError) {
      throw matchError
    }

    if (!match?.id) {
      throw Object.assign(new Error('Fixture was not found.'), { statusCode: 404 })
    }

    const { data: request, error: requestError } = await adminSupabase
      .from('match_day_availability_requests')
      .select('id, match_day_id, club_id, team_id, player_id, player_name, recipient_email, recipient_name, parent_link_id, volunteer_scorer_response, volunteer_linesman_response, volunteer_referee_response')
      .eq('id', requestId)
      .eq('match_day_id', match.id)
      .eq('club_id', match.club_id)
      .maybeSingle()

    if (requestError) {
      throw requestError
    }

    if (!request?.id) {
      throw Object.assign(new Error('Volunteer response was not found.'), { statusCode: 404 })
    }

    if (match.team_id && request.team_id && String(request.team_id) !== String(match.team_id)) {
      throw Object.assign(new Error('Volunteer response is outside this team.'), { statusCode: 403 })
    }

    if (String(request[roleConfig.responseField] || '').toLowerCase() !== 'yes') {
      throw Object.assign(new Error('Only parents who replied Yes can be selected for this role.'), { statusCode: 400 })
    }

    const parentLink = await resolveParentLink(adminSupabase, { match, request })
    const previousAssignment = await getCurrentAssignment(adminSupabase, match.id, role)
    const previousParentLinkId = previousAssignment?.parent_link_id || ''
    const isSameSelection = String(previousParentLinkId || '') === String(parentLink.id)
    const queuedNotifications = []
    let notificationWarning = ''

    if (selected === false) {
      if (!isSameSelection) {
        throw Object.assign(new Error('This volunteer is not currently selected for that role.'), { statusCode: 409 })
      }

      const { error: deleteRoleError } = await adminSupabase
        .from('match_day_role_assignments')
        .delete()
        .eq('match_day_id', match.id)
        .eq('role', role)

      if (deleteRoleError) {
        throw deleteRoleError
      }

      if (role === 'scorer') {
        await syncLegacyScorerAssignment(adminSupabase, { match, parentLink, profile, selected: false })
      }
    } else {
      await upsertRoleAssignment(adminSupabase, { match, parentLink, profile, role })

      if (role === 'scorer') {
        await syncLegacyScorerAssignment(adminSupabase, { match, parentLink, profile, selected: true })
      }
    }

    try {
      if (selected && !isSameSelection) {
        const queued = await queueRoleNotification(adminSupabase, {
          match,
          profile,
          recipientEmail: parentLink.email || request.recipient_email,
          recipientName: request.recipient_name || parentLink.email,
          role,
          action: 'selected',
          parentLinkId: parentLink.id,
        })
        queuedNotifications.push(queued.id)
      }

      if (previousAssignment?.id && (!selected || !isSameSelection)) {
        const previousEmail = getAssignmentParentEmail(previousAssignment)
        const previousName = getAssignmentParentLabel(previousAssignment)
        if (previousEmail && previousEmail !== normalizeEmail(parentLink.email || request.recipient_email)) {
          const queued = await queueRoleNotification(adminSupabase, {
            match,
            profile,
            recipientEmail: previousEmail,
            recipientName: previousName,
            role,
            action: 'deselected',
            parentLinkId: previousParentLinkId,
          })
          queuedNotifications.push(queued.id)
        } else if (!selected) {
          const queued = await queueRoleNotification(adminSupabase, {
            match,
            profile,
            recipientEmail: previousEmail,
            recipientName: previousName,
            role,
            action: 'deselected',
            parentLinkId: previousParentLinkId,
          })
          queuedNotifications.push(queued.id)
        }
      }
    } catch (notificationError) {
      console.error('Match Day volunteer notification queue failed', notificationError)
      notificationWarning = 'Volunteer selection was saved, but notification email could not be queued.'
    }

    return json(200, {
      success: true,
      parentLinkId: parentLink.id,
      authUserId: parentLink.auth_user_id || '',
      notificationQueuedCount: queuedNotifications.length,
      notificationQueueIds: queuedNotifications,
      warning: notificationWarning,
    })
  } catch (error) {
    console.error(error)
    return json(error.statusCode || 400, {
      success: false,
      message: error.message || 'Volunteer selection could not be updated.',
    })
  }
}
