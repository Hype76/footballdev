import process from 'node:process'
import { createHash, randomBytes } from 'node:crypto'
import { createFromAddress, getPublicEmailErrorMessage, sendEmail } from './lib/_email-provider.js'
import { json } from './lib/_stripe-billing.js'
import { createPublicSupabaseClient } from './lib/_supabase.js'

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

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function getAppOrigin(event) {
  const host = event.headers['x-forwarded-host'] || event.headers.host || 'footballplayer.online'
  const protocol = event.headers['x-forwarded-proto'] || 'https'
  const requestOrigin = `${protocol}://${host}`.replace(/\/$/, '')
  return requestOrigin || normalizeText(process.env.VITE_APP_URL || process.env.URL).replace(/\/$/, '')
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

function getPlayerContacts(player) {
  const contacts = Array.isArray(player.parent_contacts) ? player.parent_contacts : []
  const contactType = normalizeText(player.contact_type || 'parent')
  const fallbackContact = {
    name: normalizeText(player.parent_name),
    email: normalizeEmail(player.parent_email),
    type: contactType === 'self' ? 'self' : 'parent',
  }
  const normalizedContacts = contacts
    .map((contact) => ({
      name: normalizeText(contact?.name || contact?.parentName),
      email: normalizeEmail(contact?.email || contact?.parentEmail),
      type: normalizeText(contact?.type || contact?.contactType) === 'self' ? 'self' : 'parent',
    }))
    .filter((contact) => contact.email)

  const usableContacts = normalizedContacts.length > 0 ? normalizedContacts : [fallbackContact].filter((contact) => contact.email)

  if (contactType === 'self') {
    return usableContacts
      .filter((contact) => contact.type === 'self' || usableContacts.length === 1)
      .map((contact) => ({ ...contact, type: 'player' }))
  }

  if (contactType === 'both') {
    return usableContacts.map((contact) => ({
      ...contact,
      type: contact.type === 'self' ? 'player' : 'parent',
    }))
  }

  return usableContacts
    .filter((contact) => contact.type !== 'self')
    .map((contact) => ({ ...contact, type: 'parent' }))
}

function formatTime(value) {
  const normalizedValue = normalizeText(value)
  return normalizedValue ? normalizedValue.slice(0, 5) : 'Not set'
}

function getRequestedRoleLabels(match = {}) {
  return [
    match.request_scorer === true ? 'scorer' : '',
    match.request_linesman === true ? 'linesman' : '',
    match.request_referee === true ? 'referee' : '',
  ].filter(Boolean)
}

function findParentLinkForContact(parentLinks, player, contact) {
  if (contact.type !== 'parent') {
    return null
  }

  const contactEmail = normalizeEmail(contact.email)
  return parentLinks.find((link) =>
    String(link.player_id) === String(player.id) &&
    normalizeEmail(link.email) === contactEmail,
  ) || null
}

function buildAvailabilityEmail({ match, player, recipient, responseUrl }) {
  const teamName = normalizeText(match.teams?.name || match.team_name || 'the team')
  const subject = `${teamName} availability: ${match.opponent || 'Fixture'}`
  const requestedRoleLabels = getRequestedRoleLabels(match)
  const roleText = requestedRoleLabels.length > 0
    ? `This form also asks if you can help as ${requestedRoleLabels.join(', ')}.`
    : ''
  const details = [
    ['Opponent', match.opponent || 'Not set'],
    ['Date', match.match_date || 'Not set'],
    ['Kick off', formatTime(match.kickoff_time)],
    ['Arrival', formatTime(match.arrival_time)],
    ['Venue', match.venue_name || 'Not set'],
    ['Address', match.venue_address || 'Not set'],
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
        <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">Fixture availability</p>
        <h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;">Can ${escapeHtml(player.player_name)} play?</h1>
        <p style="margin:0 0 20px;color:#4b5f55;font-size:15px;line-height:1.6;">
          ${recipient.type === 'player' ? 'Please confirm your availability.' : 'Please confirm availability for this player.'} ${escapeHtml(roleText)}
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 22px;">${rows}</table>
        <div style="display:block;margin:22px 0;">
          <a href="${escapeHtml(responseUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">Open response form</a>
        </div>
        <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
          This link is unique to ${escapeHtml(recipient.email)}. Do not forward it.
        </p>
      </div>
    `,
  }
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

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const token = getBearerToken(event)
    const supabase = createRequestSupabaseClient(event, token)
    const profile = await getAuthenticatedProfile(event, supabase)
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const playerIds = Array.isArray(body.playerIds) ? body.playerIds.map(normalizeText).filter(Boolean) : []

    if (!matchDayId) {
      throw Object.assign(new Error('Match Day is required.'), { statusCode: 400 })
    }

    if (playerIds.length === 0) {
      throw Object.assign(new Error('Select at least one player.'), { statusCode: 400 })
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

    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('id, club_id, team_id, player_name, section, status, parent_name, parent_email, parent_contacts, contact_type')
      .eq('club_id', profile.club_id)
      .in('id', playerIds)

    if (playersError) {
      throw playersError
    }

    const appOrigin = getAppOrigin(event)
    const createdRequests = []
    const missingContacts = []
    let sentCount = 0
    const { data: parentLinks, error: parentLinksError } = await supabase
      .from('parent_player_links')
      .select('id, player_id, email, status')
      .eq('club_id', profile.club_id)
      .in('player_id', playerIds)
      .eq('status', 'active')

    if (parentLinksError) {
      throw parentLinksError
    }

    for (const player of players ?? []) {
      if (match.team_id && player.team_id && String(player.team_id) !== String(match.team_id)) {
        continue
      }

      const contacts = getPlayerContacts(player).filter((contact) => isValidEmail(contact.email))

      if (contacts.length === 0) {
        missingContacts.push({ playerId: player.id, playerName: player.player_name })
        continue
      }

      for (const contact of contacts) {
        const parentLink = findParentLinkForContact(parentLinks ?? [], player, contact)
        const token = randomBytes(32).toString('hex')
        const tokenHash = hashToken(token)
        const { data: request, error: requestError } = await supabase
          .from('match_day_availability_requests')
          .upsert({
            match_day_id: match.id,
            club_id: match.club_id,
            team_id: match.team_id || null,
            player_id: player.id,
            player_name: player.player_name,
            recipient_email: contact.email,
            recipient_name: contact.name,
            recipient_type: contact.type,
            parent_link_id: parentLink?.id || null,
            channel: 'email',
            token_hash: tokenHash,
            status: 'pending',
            volunteer_scorer_response: 'no_response',
            volunteer_linesman_response: 'no_response',
            volunteer_referee_response: 'no_response',
            volunteer_responded_at: null,
            created_by: profile.id,
            created_by_name: normalizeText(profile.display_name || profile.name || profile.email),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'match_day_id,player_id,recipient_email,recipient_type,channel',
          })
          .select('*')
          .single()

        if (requestError) {
          throw requestError
        }

        const responseUrl = `${appOrigin}/.netlify/functions/match-day-availability-confirm?token=${token}`
        const email = buildAvailabilityEmail({ match, player, recipient: contact, responseUrl })

        await sendEmail({
          from: createFromAddress('Football Player'),
          to: [contact.email],
          subject: email.subject,
          html: email.html,
        }, {
          context: {
            emailType: 'match_day_availability',
            userRole: profile.role,
            actorId: profile.id,
            actorEmail: profile.email,
            clubId: profile.club_id,
            teamId: match.team_id,
            targetEntityType: 'match_day_availability_request',
            targetEntityId: request.id,
          },
          publicMessage: 'Availability email could not be sent. Please try again in a moment.',
        })

        sentCount += 1
        await supabase
          .from('match_day_availability_requests')
          .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', request.id)

        createdRequests.push(request)
      }
    }

    return json(200, {
      success: true,
      requestCount: createdRequests.length,
      sentCount,
      missingContactCount: missingContacts.length,
      missingContacts,
      emailConfigured: true,
    })
  } catch (error) {
    console.error(error)
    return json(error.statusCode || 400, {
      success: false,
      message: error.publicMessage
        ? getPublicEmailErrorMessage(error, 'Availability requests could not be sent. Please try again in a moment.')
        : error.message || 'Availability requests could not be sent.',
    })
  }
}
