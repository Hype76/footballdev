import { createSupabaseAdminClient } from './_supabase.js'
import { classifyParentEmailChange, isValidEmail, normalizeEmail } from './_parent-email-change-rules.js'

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

function normalizeContactEmails(player) {
  const contacts = Array.isArray(player?.parent_contacts) ? player.parent_contacts : []
  return [...new Set([
    player?.parent_email,
    ...contacts.flatMap((contact) => [
      contact?.email,
      contact?.parentEmail,
      contact?.parent_email,
    ]),
  ].map(normalizeEmail).filter(Boolean))]
}

function normalizeParentLink(row) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players

  return {
    id: row.id,
    clubId: row.club_id,
    teamId: row.team_id,
    playerId: row.player_id,
    parentLinkId: row.parent_link_id ?? '',
    linkType: String(row.link_type ?? 'parent').trim(),
    email: normalizeEmail(row.email),
    authUserId: row.auth_user_id ?? '',
    status: String(row.status ?? '').trim(),
    contactEmails: normalizeContactEmails(player),
  }
}

async function getAuthUser(supabaseAdmin, event) {
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

async function findAuthUserByEmail(supabaseAdmin, email) {
  let page = 1

  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })

    if (error) {
      throw error
    }

    const users = data?.users || []
    const matchingUser = users.find((user) => normalizeEmail(user.email) === email)

    if (matchingUser) {
      return matchingUser
    }

    if (users.length < 1000) {
      return null
    }

    page += 1
  }

  return null
}

async function getCurrentParentLinks(supabaseAdmin, authUserId) {
  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, parent_link_id, link_type, email, auth_user_id, status, players:player_id (parent_email, parent_contacts)')
    .eq('auth_user_id', authUserId)
    .eq('status', 'active')

  if (error) {
    throw error
  }

  return (data ?? []).map(normalizeParentLink)
}

async function getTargetParentLinks(supabaseAdmin, email, targetAuthUserId) {
  const clauses = [`email.eq.${email}`]

  if (targetAuthUserId) {
    clauses.push(`auth_user_id.eq.${targetAuthUserId}`)
  }

  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, parent_link_id, link_type, email, auth_user_id, status, players:player_id (parent_email, parent_contacts)')
    .or(clauses.join(','))
    .eq('status', 'active')

  if (error) {
    throw error
  }

  return (data ?? []).map(normalizeParentLink)
}

async function transferParentLinks(supabaseAdmin, { linkIds, targetAuthUserId, email }) {
  if (!linkIds.length) {
    return []
  }

  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .update({
      auth_user_id: targetAuthUserId,
      email,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .in('id', linkIds)
    .select('id')

  if (error) {
    throw error
  }

  return (data ?? []).map((row) => row.id)
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient(event)
    const authUser = await getAuthUser(supabaseAdmin, event)
    const body = JSON.parse(event.body || '{}')
    const email = normalizeEmail(body.email)

    if (!isValidEmail(email)) {
      return failureResponse(400, 'Enter a valid email address.')
    }

    const [currentLinks, targetAuthUser] = await Promise.all([
      getCurrentParentLinks(supabaseAdmin, authUser.id),
      findAuthUserByEmail(supabaseAdmin, email),
    ])
    const targetLinks = await getTargetParentLinks(supabaseAdmin, email, targetAuthUser?.id)
    const decision = classifyParentEmailChange({
      authUser,
      requestedEmail: email,
      currentLinks,
      targetAuthUser,
      targetLinks,
    })

    if (!decision.ok) {
      return failureResponse(decision.statusCode || 400, decision.message)
    }

    let transferredLinkIds = []

    if (decision.action === 'link-existing-parent') {
      transferredLinkIds = await transferParentLinks(supabaseAdmin, {
        linkIds: decision.transferLinkIds,
        targetAuthUserId: targetAuthUser.id,
        email,
      })
    }

    return jsonResponse(200, {
      success: true,
      action: decision.action,
      email,
      message: decision.message,
      transferredLinkIds,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Email could not be updated.')
  }
}
