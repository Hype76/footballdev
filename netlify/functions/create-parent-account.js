import process from 'node:process'
import { Resend } from 'resend'
import { supabaseAdmin } from './_supabase.js'

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

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getDisplayName(email) {
  return String(email ?? '').split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'Parent'
}

function isExistingUserError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('already registered') || message.includes('already exists') || message.includes('user already')
}

function getBaseUrl(event) {
  const forwardedProto = event.headers['x-forwarded-proto'] || 'https'
  const forwardedHost = event.headers['x-forwarded-host'] || event.headers.host || 'staging.footballplayer.online'
  const normalizedHost = String(forwardedHost ?? '').trim().toLowerCase()

  if (normalizedHost === 'staging.footballplayer.online'
    || normalizedHost === 'parent-staging.footballplayer.online'
    || normalizedHost === 'staging.playerfeedback.online'
    || normalizedHost === 'parent-staging.playerfeedback.online') {
    return 'https://parent-staging.footballplayer.online'
  }

  if (normalizedHost === 'footballplayer.online'
    || normalizedHost === 'parent.footballplayer.online'
    || normalizedHost === 'playerfeedback.online'
    || normalizedHost === 'parent.playerfeedback.online') {
    return 'https://parent.footballplayer.online'
  }

  const configuredParentUrl = String(process.env.VITE_PARENT_APP_URL ?? '').trim().replace(/\/$/, '')

  if (configuredParentUrl) {
    return configuredParentUrl
  }

  return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '')
}

function buildConfirmationEmailHtml({ actionLink, invite, email }) {
  const childName = invite.playerName || 'your child'
  const teamCopy = [invite.teamName, invite.clubName].filter(Boolean).join(' | ') || 'Football Player'

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55; max-width: 680px; margin: 0 auto;">
      <div style="border: 1px solid #e5eadf; border-radius: 12px; overflow: hidden;">
        <div style="background: #101510; color: #ffffff; padding: 24px;">
          <p style="margin: 0 0 8px; color: #d8ff2f; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">Parent Portal</p>
          <h1 style="margin: 0; font-size: 24px;">Confirm parent access</h1>
        </div>
        <div style="padding: 24px;">
          <p style="margin: 0 0 16px;">Confirm ${escapeHtml(email)} to open parent portal access for ${escapeHtml(childName)}.</p>
          <div style="margin: 0 0 20px; padding: 14px 16px; border: 1px solid #e5eadf; border-radius: 10px; background: #f8faf5;">
            <p style="margin: 0; font-weight: 700;">${escapeHtml(childName)}</p>
            <p style="margin: 4px 0 0; color: #52645a; font-size: 14px;">${escapeHtml(teamCopy)}</p>
          </div>
          <p style="margin: 0 0 22px;">
            <a href="${escapeHtml(actionLink)}" style="display: inline-block; background: #d8ff2f; color: #050805; padding: 12px 18px; border-radius: 8px; font-weight: 800; text-decoration: none;">Confirm parent account</a>
          </p>
          <p style="margin: 0; color: #52645a; font-size: 13px;">This confirmation link is for this email address only.</p>
          <div style="border-top: 1px solid #e5eadf; margin-top: 20px; padding-top: 14px;">
            <p style="margin: 0; color: #7a8578; font-size: 11px; line-height: 1.45;">Powered by Football Player | footballplayer.online</p>
          </div>
        </div>
      </div>
    </div>
  `
}

async function getInvite(token) {
  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, email, status, expires_at, players:player_id (player_name), teams:team_id (name), clubs:club_id (name)')
    .eq('invite_token', token)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('This parent invite could not be found.'), { statusCode: 404 })
  }

  if (data.status === 'revoked') {
    throw Object.assign(new Error('This parent invite is no longer available.'), { statusCode: 403 })
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('This parent invite has expired. Ask the team to send a new parent portal link.'), { statusCode: 410 })
  }

  const player = Array.isArray(data.players) ? data.players[0] : data.players
  const team = Array.isArray(data.teams) ? data.teams[0] : data.teams
  const club = Array.isArray(data.clubs) ? data.clubs[0] : data.clubs

  return {
    email: String(data.email ?? '').trim().toLowerCase(),
    playerName: String(player?.player_name ?? '').trim(),
    teamName: String(team?.name ?? '').trim(),
    clubName: String(club?.name ?? '').trim(),
  }
}

async function findAuthUserByEmail(email) {
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
    const matchingUser = users.find((user) => String(user.email ?? '').trim().toLowerCase() === email)

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

async function deleteUnconfirmedAuthUser(email, user) {
  const authUser = user || await findAuthUserByEmail(email)

  if (!authUser?.id || authUser.email_confirmed_at || authUser.confirmed_at) {
    return false
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(authUser.id)

  if (error) {
    throw error
  }

  return true
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  if (!process.env.RESEND_API_KEY) {
    return failureResponse(500, 'Parent confirmation email is not configured.')
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const inviteToken = String(body.inviteToken ?? '').trim()

    if (!isValidEmail(email)) {
      return failureResponse(400, 'Enter a valid email address.')
    }

    if (password.length < 6) {
      return failureResponse(400, 'Create a password with at least 6 characters.')
    }

    if (!inviteToken) {
      return failureResponse(400, 'Parent invite token is required.')
    }

    const invite = await getInvite(inviteToken)
    const lockedEmail = String(invite.email ?? '').trim().toLowerCase()

    if (lockedEmail && lockedEmail !== email) {
      return failureResponse(403, 'This parent invite is for a different email address.')
    }

    const baseUrl = getBaseUrl(event)
    const redirectTo = `${baseUrl}/parent-login?parentInvite=${encodeURIComponent(inviteToken)}&confirmed=1`
    const displayName = getDisplayName(email)

    const createSignupLink = () => supabaseAdmin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: {
        redirectTo,
        data: {
          username: displayName,
          name: displayName,
          display_name: displayName,
          account_type: 'parent',
        },
      },
    })

    let { data, error } = await createSignupLink()

    if (error && isExistingUserError(error)) {
      const removedUnconfirmedUser = await deleteUnconfirmedAuthUser(email).catch((deleteError) => {
        console.error(deleteError)
        return false
      })

      if (removedUnconfirmedUser) {
        const retryResult = await createSignupLink()
        data = retryResult.data
        error = retryResult.error
      } else {
        return failureResponse(409, 'An account already exists for this email. Use parent login to open the child link.')
      }
    }

    if (error) {
      console.error(error)
      return failureResponse(400, error.message || 'Parent account could not be created.')
    }

    const actionLink = data?.properties?.action_link

    if (!actionLink) {
      return failureResponse(500, 'Parent confirmation link could not be created.')
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const sendResult = await resend.emails.send({
      from: 'Football Player <feedback@footballplayer.online>',
      to: [email],
      subject: 'Confirm your parent portal account',
      html: buildConfirmationEmailHtml({ actionLink, invite, email }),
    })

    if (sendResult.error) {
      console.error(sendResult.error)
      await deleteUnconfirmedAuthUser(email, data?.user).catch((deleteError) => console.error(deleteError))
      return failureResponse(502, sendResult.error.message || 'Parent confirmation email could not be sent.')
    }

    return jsonResponse(200, {
      success: true,
      needsEmailVerification: true,
      email,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Parent account could not be created.')
  }
}
