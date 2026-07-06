import { createFromAddress } from './lib/_email-provider.js'
import { json } from './lib/_stripe-billing.js'
import { createPublicSupabaseClient, createSupabaseAdminClient } from './lib/_supabase.js'
import { buildEmailLogoMarkup, buildEventMapLinksMarkup } from '../../src/lib/email-branding.js'
import { getMatchDayDisplayName } from '../../src/lib/matchday-display.js'

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

function normalizeHexColor(value) {
  const normalizedValue = normalizeText(value)
  return /^#[0-9a-f]{6}$/i.test(normalizedValue) ? normalizedValue : '#047857'
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

function getAppOrigin(event) {
  const host = event.headers['x-forwarded-host'] || event.headers.host || 'footballplayer.online'
  const protocol = event.headers['x-forwarded-proto'] || 'https'
  return `${protocol}://${host}`.replace(/\/$/, '')
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
  const normalizedValue = normalizeText(value)
  const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`
  }

  return normalizedValue || 'Not set'
}

function getGoogleDatePart(dateValue) {
  const match = normalizeText(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}${match[2]}${match[3]}` : ''
}

function getNextGoogleDatePart(dateValue) {
  const match = normalizeText(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!match) {
    return ''
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function addMinutesToTime(value, minutesToAdd) {
  const normalizedValue = normalizeText(value)

  if (!/^\d{2}:\d{2}/.test(normalizedValue)) {
    return ''
  }

  const [hours, minutes] = normalizedValue.slice(0, 5).split(':').map(Number)
  const totalMinutes = (hours * 60) + minutes + Number(minutesToAdd || 0)
  const wrappedMinutes = ((totalMinutes % 1440) + 1440) % 1440
  const nextHours = Math.floor(wrappedMinutes / 60)
  const nextMinutes = wrappedMinutes % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

function buildGoogleCalendarLink({ match, matchName, roleLabel, teamName, opponent, portalUrl }) {
  const datePart = getGoogleDatePart(match.match_date)

  if (!datePart) {
    return ''
  }

  const startTime = normalizeText(match.arrival_time || match.kickoff_time).slice(0, 5)
  const endTime = normalizeText(match.kickoff_time).slice(0, 5)
    ? addMinutesToTime(match.kickoff_time, 120)
    : addMinutesToTime(startTime, 120)
  const dates = startTime
    ? `${datePart}T${startTime.replace(':', '')}00/${datePart}T${(endTime || addMinutesToTime(startTime, 120)).replace(':', '')}00`
    : `${datePart}/${getNextGoogleDatePart(match.match_date) || datePart}`
  const description = [
    `Selected Match Day role: ${roleLabel}`,
    `Team: ${teamName}`,
    `Opponent: ${opponent}`,
    `Kick-off: ${formatTime(match.kickoff_time)}`,
    match.arrival_time ? `Arrival: ${formatTime(match.arrival_time)}` : '',
    match.venue_name ? `Venue: ${match.venue_name}` : '',
    portalUrl ? `Parent Portal: ${portalUrl}` : '',
  ].filter(Boolean).join('\n')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${roleLabel}: ${matchName}`,
    dates,
    details: description,
    location: normalizeText(match.venue_name || match.venue_address),
    ctz: 'Europe/London',
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
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

function buildRoleNotificationEmail({ appOrigin, match, profile, recipientEmail, recipientName, role, action }) {
  const roleLabel = ROLE_CONFIG[role]?.label || 'Volunteer'
  const teamName = normalizeText(match.teams?.name || match.team_name || 'the team')
  const opponent = normalizeText(match.opponent || 'Fixture')
  const matchName = getMatchDayDisplayName({ ...match, teamName })
  const clubName = normalizeText(match.clubs?.name || match.club_name || 'Football Player')
  const clubLogoUrl = normalizeText(match.clubs?.logo_url)
  const logoMarkup = buildEmailLogoMarkup({
    altText: clubName,
    clubLogoUrl,
    origin: appOrigin,
  })
  const accentColor = normalizeHexColor(match.teams?.theme_accent || match.clubs?.theme_accent || '#047857')
  const portalUrl = `${appOrigin}/parent-portal`
  const calendarUrl = buildGoogleCalendarLink({ match, matchName, roleLabel, teamName, opponent, portalUrl })
  const mapLinksMarkup = buildEventMapLinksMarkup(normalizeText(match.venue_address || match.venue_name))
  const selectedCopy = action === 'selected'
    ? `You have been selected as ${roleLabel.toLowerCase()} for this fixture.`
    : `You are no longer selected as ${roleLabel.toLowerCase()} for this fixture.`
  const subject = `${matchName} Match Day ${roleLabel.toLowerCase()} update`
  const details = [
    ['Fixture', matchName],
    ['Date', formatDate(match.match_date)],
    ['Kick off', formatTime(match.kickoff_time)],
    ['Arrival', formatTime(match.arrival_time)],
    ['Venue', normalizeText(match.venue_name) || 'Not set'],
    ['Address', normalizeText(match.venue_address) || 'Not set'],
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
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;background:#f7faf8;">
        <div style="border:1px solid #d7e5dc;border-radius:12px;background:#ffffff;overflow:hidden;">
          <div style="padding:20px 22px;background:${escapeHtml(accentColor)};color:#ffffff;">
            ${logoMarkup}
            <p style="margin:0;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">${escapeHtml(clubName)}</p>
            <h1 style="margin:8px 0 0;font-size:26px;line-height:1.15;">${escapeHtml(roleLabel)} update</h1>
          </div>
          <div style="padding:22px;">
        <p style="margin:0 0 20px;color:#4b5f55;font-size:15px;line-height:1.6;">
          Hi ${escapeHtml(recipientName || 'there')}, ${escapeHtml(selectedCopy)}
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 22px;">${rows}</table>
        ${mapLinksMarkup}
        <div style="display:block;margin:22px 0;">
          <a href="${escapeHtml(portalUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;background:${escapeHtml(accentColor)};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">View in Parent Portal</a>
          ${calendarUrl ? `<a href="${escapeHtml(calendarUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;background:#101828;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">Add to calendar</a>` : ''}
        </div>
        <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
          Updated by ${escapeHtml(profile.display_name || profile.name || profile.email || 'team staff')}.
        </p>
          </div>
        </div>
      </div>
    `,
    to: [recipientEmail],
  }
}

async function queueRoleNotification(adminSupabase, { appOrigin, match, profile, recipientEmail, recipientName, role, action, parentLinkId }) {
  const normalizedEmail = normalizeEmail(recipientEmail)

  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Selected parent does not have a valid email address.')
  }

  const email = buildRoleNotificationEmail({
    appOrigin,
    match,
    profile,
    recipientEmail: normalizedEmail,
    recipientName,
    role,
    action,
  })

  const payload = {
    visibleInEmailQueue: false,
    resendPayload: {
      from: createFromAddress('Football Player'),
      to: email.to,
      subject: email.subject,
      html: email.html,
    },
    displayName: 'Football Player',
    teamName: normalizeText(match.teams?.name || match.team_name),
    clubName: normalizeText(match.clubs?.name),
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
      purpose: 'role_selection_notification',
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
  }

  if (!parentLink?.id) {
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
    const requestEmail = normalizeEmail(request.recipient_email)
    const requestPlayerName = normalizeText(request.player_name).toLowerCase()
    const { data, error } = await adminSupabase
      .from('parent_player_links')
      .select(baseSelect)
      .eq('club_id', match.club_id)
      .eq('status', 'active')

    if (error) {
      throw error
    }

    const matches = (data || []).filter((link) => {
      const player = Array.isArray(link.players) ? link.players[0] : link.players
      const sameTeam = !match.team_id || !link.team_id || String(link.team_id) === String(match.team_id)
      return sameTeam
        && normalizeEmail(link.email) === requestEmail
        && normalizeText(player?.player_name).toLowerCase() === requestPlayerName
    })

    if (matches.length === 1) {
      parentLink = matches[0]
    } else if (matches.length > 1) {
      throw Object.assign(new Error('This volunteer could not be assigned because more than one linked parent matches that response.'), { statusCode: 409 })
    }
  }

  if (!parentLink?.id) {
    parentLink = await resolveRequestScopedParentLink(adminSupabase, { baseSelect, match, request })
  }

  if (!parentLink?.id) {
    throw Object.assign(new Error('This volunteer could not be assigned because the linked parent account could not be resolved.'), { statusCode: 409 })
  }

  assertParentLinkMatchesVolunteerResponse({ match, parentLink, request })

  return parentLink
}

async function resolveRequestScopedParentLink(adminSupabase, { baseSelect, match, request }) {
  const requestEmail = normalizeEmail(request.recipient_email)
  const requestParentLinkId = normalizeText(request.parent_link_id)

  if (requestParentLinkId) {
    const { data, error } = await adminSupabase
      .from('parent_player_links')
      .select(baseSelect)
      .eq('id', requestParentLinkId)
      .eq('club_id', match.club_id)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (data?.id) {
      assertParentLinkMatchesVolunteerResponse({ match, parentLink: data, request })
      return data
    }
  }

  if (!requestEmail || !request.player_id) {
    return null
  }

  const { data, error } = await adminSupabase
    .from('parent_player_links')
    .select(baseSelect)
    .eq('club_id', match.club_id)
    .eq('player_id', request.player_id)

  if (error) {
    throw error
  }

  const matches = (data || []).filter((link) => {
    try {
      assertParentLinkMatchesVolunteerResponse({ match, parentLink: link, request })
      return true
    } catch {
      return false
    }
  })

  if (matches.length === 1) {
    return matches[0]
  }

  if (matches.length > 1) {
    throw Object.assign(new Error('This volunteer could not be assigned because more than one linked parent matches that response.'), { statusCode: 409 })
  }

  return null
}

function assertParentLinkMatchesVolunteerResponse({ match, parentLink, request }) {
  if (!parentLink?.id) {
    throw Object.assign(new Error('This volunteer could not be assigned because the linked parent account could not be resolved.'), { statusCode: 409 })
  }

  if (String(parentLink.club_id || '') !== String(match.club_id || '')) {
    throw Object.assign(new Error('This volunteer could not be assigned because the parent link is outside this club.'), { statusCode: 403 })
  }

  if (request.player_id && parentLink.player_id && String(parentLink.player_id) !== String(request.player_id)) {
    throw Object.assign(new Error('This volunteer could not be assigned because the parent link does not match the response player.'), { statusCode: 409 })
  }

  if (match.team_id && parentLink.team_id && String(parentLink.team_id) !== String(match.team_id)) {
    throw Object.assign(new Error('This volunteer could not be assigned because the parent link is outside this team.'), { statusCode: 409 })
  }

  const requestEmail = normalizeEmail(request.recipient_email)
  const parentEmail = normalizeEmail(parentLink.email)

  if (requestEmail && parentEmail && requestEmail !== parentEmail) {
    throw Object.assign(new Error('This volunteer could not be assigned because the parent link does not match the response contact.'), { statusCode: 409 })
  }
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
    const appOrigin = getAppOrigin(event)
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
      .select('*, teams:team_id (name, theme_accent), clubs:club_id (name, logo_url)')
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
      .select('id, match_day_id, club_id, team_id, player_id, player_name, recipient_email, recipient_name, parent_link_id, status, volunteer_scorer_response, volunteer_linesman_response, volunteer_referee_response')
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

    if (String(request.status || '').toLowerCase() === 'expired') {
      throw Object.assign(new Error('This volunteer response has expired. Ask the parent to submit a fresh Match Day response.'), { statusCode: 409 })
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
          appOrigin,
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
            appOrigin,
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
            appOrigin,
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
