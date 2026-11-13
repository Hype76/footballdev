import { createFromAddress, getPublicEmailErrorMessage, sendEmail } from './lib/_email-provider.js'
import { assertPlanFeature, getAuthenticatedPlanProfile, getAuthenticatedRequestUser } from './lib/_plan-gate.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { assertPasswordPolicy } from '../../src/lib/password-policy.js'
import { isDemoEmail } from '../../src/lib/demo.js'

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

function reply(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload),
  }
}

function fail(statusCode, message) {
  return reply(statusCode, { success: false, message })
}

function inviteFailure(state) {
  if (state === 'denied') return fail(403, 'You need access to this team to invite the player.')
  if (state === 'ineligible') return fail(422, 'Add one Player email and a date of birth confirming the player is 18 or over.')
  if (state === 'parent_linked') return fail(409, 'This player already has active Parent access. Review it with the club before setting up separate Player access.')
  if (state === 'wrong_account' || state === 'account_conflict') {
    return fail(409, 'Use the invited email address and a separate Player account. Ask your club for help if this email already has another role.')
  }
  return fail(410, 'This invitation is unavailable or has expired. Ask your club to invite you again.')
}

export function createAdultPlayerSetupHandler({
  client = supabaseAdmin,
  getActor = getAuthenticatedRequestUser,
  getProfile = getAuthenticatedPlanProfile,
  assertFeature = assertPlanFeature,
  deliver = sendEmail,
} = {}) {
  async function rpc(name, params) {
    const { data, error } = await client.rpc(name, params)
    if (error) throw error
    return data
  }

  async function sendInvite(event, playerId) {
    const actor = await getActor(event)
    if (isDemoEmail(actor.email)) return inviteFailure('denied')
    const { data: player, error } = await client.from('players').select('id,club_id,team_id').eq('id', playerId).maybeSingle()
    if (error) throw error
    if (!player) return inviteFailure('denied')
    const profile = await getProfile(event, { clubId: player.club_id, teamId: player.team_id, playerId })
    if (profile.clubId !== player.club_id || profile.roleRank < 20 || profile.role === 'super_admin') return inviteFailure('denied')
    assertFeature(profile, 'players')
    const invite = await rpc('reserve_adult_player_setup_invite', { actor_id: actor.id, target_player_id: playerId })
    if (['sent', 'linked'].includes(invite?.state)) return reply(200, { success: true, state: invite.state })
    if (invite?.state !== 'pending') return inviteFailure(invite?.state)

    const link = `https://footballplayer.online/player-invite#invite=${invite.token}`
    await deliver({
      emailAppRole: 'none',
      from: createFromAddress('Football Player'),
      to: [invite.email],
      subject: 'Set up your Football Player access',
      html: `<p>Your club has invited you to set up your own Player login.</p><p><a href="${link}">Set up Player access</a></p><p>This invitation expires in seven days. Once signed in, you can respond to fixtures and training on the website.</p>`,
      text: `Your club has invited you to set up your own Player login.\n\n${link}\n\nThis invitation expires in seven days.`,
    }, {
      idempotencyKey: `adult-player-setup:${invite.token}`,
      context: {
        emailType: 'adult_player_setup_invite',
        actorId: actor.id,
        clubId: player.club_id,
        teamId: player.team_id,
        targetEntityType: 'player',
        targetEntityId: playerId,
      },
      publicMessage: 'Player invitation could not be sent. Save again to retry.',
    })
    await rpc('confirm_adult_player_setup_email', { invite_token: invite.token })
    return reply(200, { success: true, state: 'sent' })
  }

  async function redeemInvite(event, body) {
    const params = { invite_token: body.token }
    if (body.action === 'accept') {
      const actor = await getActor(event)
      const result = await rpc('redeem_adult_player_setup_invite', { ...params, account_id: actor.id })
      return result?.state === 'accepted' ? reply(200, { success: true }) : inviteFailure(result?.state)
    }

    if (typeof body.password !== 'string' || body.password.length > 72) {
      return fail(400, 'Enter a valid password up to 72 characters.')
    }
    try {
      assertPasswordPolicy(body.password)
    } catch (error) {
      return fail(400, error.message)
    }
    const invite = await rpc('redeem_adult_player_setup_invite', params)
    if (invite?.state !== 'pending') return inviteFailure(invite?.state)
    if (String(body.email ?? '').trim().toLowerCase() !== invite.email) return inviteFailure('wrong_account')

    // The invitation token was delivered to this email. Existing accounts must sign in with their own credentials.
    const { data, error } = await client.auth.admin.createUser({
      email: invite.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { account_type: 'adult_player' },
    })
    if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
      return fail(409, 'This email already has an account. Sign in below to accept the invitation.')
    }
    if (error) throw error

    const result = await rpc('redeem_adult_player_setup_invite', { ...params, account_id: data.user.id })
    return result?.state === 'accepted' ? reply(200, { success: true }) : inviteFailure(result?.state)
  }

  return async function handler(event) {
    if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed.')
    let body
    try {
      body = JSON.parse(event.body || '{}')
    } catch {
      return fail(400, 'Invalid request.')
    }
    try {
      if (body?.action === 'send' && typeof body.playerId === 'string' && uuid.test(body.playerId)) {
        return await sendInvite(event, body.playerId)
      }
      if (['create', 'accept'].includes(body?.action) && typeof body.token === 'string' && uuid.test(body.token)) {
        return await redeemInvite(event, body)
      }
      return fail(400, 'Player invitation details are required.')
    } catch (error) {
      if (error.statusCode && error.statusCode < 500) return fail(error.statusCode, error.message)
      console.error('Player invitation failed', { action: body?.action, code: error.code ?? error.name })
      return fail(503, getPublicEmailErrorMessage(error, 'Player invitation could not be completed. Please try again.'))
    }
  }
}

export const handler = createAdultPlayerSetupHandler()
