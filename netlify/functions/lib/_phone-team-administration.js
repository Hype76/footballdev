const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const response = (statusCode, value) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(value) })

export function createPhoneTeamAdministrationHandler({ client, getPlanProfile, getStaffLimit, authenticatedClient, sendInvite }) {
  return async event => {
    try {
      if (event.httpMethod !== 'POST') return response(405, { message: 'Method not allowed.' })
      if (String(event.body || '').length > 4096) return response(413, { message: 'The request is too large.' })
      let body
      try { body = JSON.parse(event.body || '{}') } catch { return response(400, { message: 'Enter the details again.' }) }
      if (!body || Array.isArray(body) || !UUID.test(body.teamId || '') || !['read', 'save', 'invite', 'roster', 'remove'].includes(body.action)
        || Object.keys(body).some(key => !['action', 'teamId', 'squadEnabled', 'squadHoursBefore', 'availabilityEnabled', 'availabilityHoursBefore', 'email', 'role', 'assignmentId'].includes(key))
        || (body.action === 'remove' && !UUID.test(body.assignmentId || ''))
        || (body.action !== 'remove' && body.assignmentId !== undefined)) {
        return response(400, { message: 'Invalid team request.' })
      }
      if (body.action === 'save' && (typeof body.squadEnabled !== 'boolean' || typeof body.availabilityEnabled !== 'boolean'
        || ![body.squadHoursBefore, body.availabilityHoursBefore].every(value => Number.isInteger(value) && value >= 1 && value <= 168))) {
        return response(400, { message: 'Choose reminder times from 1 to 168 hours.' })
      }
      if (body.action === 'invite' && (!['coach', 'assistant_coach'].includes(body.role || 'coach')
        || typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.email.trim()))) {
        return response(400, { message: 'Enter a valid coach email and role.' })
      }
      const token = String(event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer (.+)$/i)?.[1]
      if (!token) return response(401, { message: 'Sign in again to continue.' })
      const auth = await client.auth.getUser(token)
      if (auth.error || !auth.data?.user?.id || !auth.data.user.email_confirmed_at
        || (auth.data.user.banned_until && Date.parse(auth.data.user.banned_until) > Date.now())) {
        return response(401, { message: 'Sign in again to continue.' })
      }
      const actorId = auth.data.user.id
      const policy = await client.rpc('manage_team_reminder_policy', {
        actor_value: actorId, team_value: body.teamId, action_value: body.action === 'save' ? 'save' : 'read',
        ...(body.action === 'save' ? {
          squad_enabled_value: body.squadEnabled, squad_hours_value: body.squadHoursBefore,
          availability_enabled_value: body.availabilityEnabled, availability_hours_value: body.availabilityHoursBefore,
        } : {}),
      })
      if (policy.error) throw policy.error
      if (body.action === 'roster' || body.action === 'remove') {
        if (!policy.data?.canManage) {
          if (body.action === 'roster') return response(200, { ...policy.data, coaches: [] })
          return response(403, { message: 'Only the team admin can manage coaches.' })
        }
        const roster = await client.rpc('manage_phone_team_coaches', {
          actor_value: actorId, team_value: body.teamId,
          action_value: body.action === 'remove' ? 'remove' : 'read',
          assignment_value: body.action === 'remove' ? body.assignmentId : null,
        })
        if (roster.error) throw roster.error
        return response(200, { ...policy.data, ...roster.data,
          ...(body.action === 'remove' ? { message: roster.data.removed ? 'Coach access removed from this team.' : 'Coach access was already removed from this team.' } : {}),
        })
      }
      if (body.action !== 'invite') return response(200, policy.data)
      if (!policy.data?.canManage) return response(403, { message: 'Only the team admin can add coaches.' })
      const profile = await getPlanProfile(event, { clubId: policy.data.clubId, teamId: body.teamId })
      const reserved = await client.rpc('create_phone_team_coach_invite', {
        actor_value: actorId, team_value: body.teamId, email_value: String(body.email || '').trim().toLowerCase(),
        role_value: body.role || 'coach', limit_value: getStaffLimit(profile),
      })
      if (reserved.error) throw reserved.error
      const invitation = reserved.data
      if (invitation.kind === 'existing') {
        const assigned = await authenticatedClient(event, token).rpc('assign_team_staff_role', {
          p_target_user_id: invitation.userId, p_team_id: body.teamId,
          p_target_role_key: invitation.role, p_request_source: 'staff_invitation',
        })
        if (assigned.error) throw assigned.error
        if (!assigned.data?.success) return response(403, { message: assigned.data?.message || 'Coach access could not be assigned.' })
        return response(200, { kind: 'user', message: 'Coach access updated.', teamId: body.teamId, clubId: policy.data.clubId })
      }
      if (!invitation.alreadySent) {
        const link = `https://footballplayer.online/staff-invite?token=${encodeURIComponent(invitation.inviteToken)}`
        const sent = await sendInvite({ ...event, body: JSON.stringify({ inviteId: invitation.inviteId, phoneTeamCommand: true,
          html: `<h2>Join ${escape(invitation.teamName)}</h2><p>You have been invited as ${escape(invitation.roleLabel)}.</p><p><a href="${escape(link)}">Accept your coach invitation</a></p><p>This invitation expires in seven days.</p>`,
        }) })
        if (sent.statusCode >= 400) return response(sent.statusCode, { message: 'The invitation is saved but its email was not sent. Retry to send it.' })
      }
      return response(200, { kind: 'invite', message: invitation.alreadySent ? 'This coach already has an invitation for this team.' : 'Coach invitation sent.', teamId: body.teamId, clubId: policy.data.clubId })
    } catch (error) {
      const denied = error.code === '42501'
      const invalid = ['22023', '23514'].includes(error.code)
      return response(denied ? 403 : invalid ? 400 : error.statusCode || 503,
        { message: denied || invalid ? error.message : 'Team administration is temporarily unavailable. Your existing settings were kept.' })
    }
  }
}
