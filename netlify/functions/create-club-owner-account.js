import { createSupabaseAdminClient } from './_supabase.js'

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

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function getDisplayName(email) {
  return String(email ?? '').split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'Club Admin'
}

function isExistingUserError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('already registered') || message.includes('already exists') || message.includes('user already')
}

async function findAuthUserByEmail(supabaseAdmin, email) {
  let page = 1

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })

    if (error) {
      throw error
    }

    const user = (data?.users || []).find((candidate) => normalizeEmail(candidate.email) === email)

    if (user) {
      return user
    }

    if ((data?.users || []).length < 1000) {
      return null
    }

    page += 1
  }

  return null
}

async function getInvite(supabaseAdmin, token) {
  const { data, error } = await supabaseAdmin
    .from('club_owner_invites')
    .select('id, club_id, invited_email, billing_mode, plan_key, expires_at, accepted_at, status, clubs:club_id (name, plan_status, is_plan_comped)')
    .eq('invite_token', token)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('This club invite could not be found.'), { statusCode: 404 })
  }

  if (data.accepted_at || data.status === 'accepted') {
    throw Object.assign(new Error('This club invite has already been accepted.'), { statusCode: 409 })
  }

  if (data.status === 'cancelled') {
    throw Object.assign(new Error('This club invite has been cancelled.'), { statusCode: 410 })
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('This club invite has expired. Ask Football Player to send a new invite.'), { statusCode: 410 })
  }

  return data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient(event)
    const body = JSON.parse(event.body || '{}')
    const token = String(body.token ?? '').trim()
    const email = normalizeEmail(body.email)
    const password = String(body.password ?? '')

    if (!token) {
      return failureResponse(400, 'Club invite token is required.')
    }

    if (!isValidEmail(email)) {
      return failureResponse(400, 'Enter a valid email address.')
    }

    if (password.length < 8) {
      return failureResponse(400, 'Create a password with at least 8 characters.')
    }

    const invite = await getInvite(supabaseAdmin, token)
    const displayName = getDisplayName(email)
    let ownerUserId = ''
    const existingAuthUser = await findAuthUserByEmail(supabaseAdmin, email)

    if (existingAuthUser?.id) {
      const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
        .from('users')
        .select('id, club_id, role')
        .eq('id', existingAuthUser.id)
        .maybeSingle()

      if (existingProfileError) {
        return failureResponse(400, existingProfileError.message)
      }

      if (existingProfile?.club_id && existingProfile.club_id !== invite.club_id && existingProfile.role !== 'super_admin') {
        return failureResponse(409, 'This email is already linked to another club workspace.')
      }

      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          ...(existingAuthUser.user_metadata || {}),
          username: existingAuthUser.user_metadata?.username || displayName,
          name: existingAuthUser.user_metadata?.name || displayName,
          display_name: existingAuthUser.user_metadata?.display_name || displayName,
          account_type: 'club_admin',
        },
      })

      if (updateAuthError) {
        return failureResponse(400, updateAuthError.message)
      }

      ownerUserId = existingAuthUser.id
    } else {
      const { data: createdAuthUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: displayName,
          name: displayName,
          display_name: displayName,
          account_type: 'club_admin',
        },
      })

      if (createAuthError) {
        if (!isExistingUserError(createAuthError)) {
          return failureResponse(400, createAuthError.message)
        }

        const foundAuthUser = await findAuthUserByEmail(supabaseAdmin, email)

        if (!foundAuthUser?.id) {
          return failureResponse(400, 'This email already exists but could not be linked.')
        }

        ownerUserId = foundAuthUser.id
      } else {
        ownerUserId = createdAuthUser?.user?.id || ''
      }
    }

    if (!ownerUserId) {
      return failureResponse(400, 'Could not create club admin auth user.')
    }

    const profile = {
      id: ownerUserId,
      email,
      username: displayName,
      name: displayName,
      role: 'admin',
      role_label: 'Club Admin',
      role_rank: 90,
      club_id: invite.club_id,
      force_password_change: false,
      status: 'active',
    }

    const { error: profileError } = await supabaseAdmin
      .from('users')
      .upsert(profile, { onConflict: 'id' })

    if (profileError) {
      return failureResponse(400, profileError.message)
    }

    const { error: membershipError } = await supabaseAdmin
      .from('user_club_memberships')
      .upsert(
        {
          auth_user_id: ownerUserId,
          email,
          username: displayName,
          name: displayName,
          role: 'admin',
          role_label: 'Club Admin',
          role_rank: 90,
          club_id: invite.club_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'auth_user_id,club_id' },
      )

    if (membershipError) {
      return failureResponse(400, membershipError.message)
    }

    const { error: inviteUpdateError } = await supabaseAdmin
      .from('club_owner_invites')
      .update({
        accepted_at: new Date().toISOString(),
        accepted_email: email,
        status: 'accepted',
      })
      .eq('id', invite.id)

    if (inviteUpdateError) {
      return failureResponse(400, inviteUpdateError.message)
    }

    await supabaseAdmin
      .from('audit_logs')
      .insert({
        club_id: invite.club_id,
        actor_id: ownerUserId,
        actor_name: displayName,
        actor_email: email,
        actor_role_label: 'Club Admin',
        actor_role_rank: 90,
        action: 'club_owner_invite_accepted',
        entity_type: 'club_owner_invite',
        entity_id: invite.id,
        metadata: {
          invitedEmail: normalizeEmail(invite.invited_email),
          acceptedEmail: email,
          billingMode: invite.billing_mode,
          planKey: invite.plan_key,
        },
      })

    return jsonResponse(200, {
      success: true,
      email,
      billingMode: invite.billing_mode === 'unpaid' ? 'unpaid' : 'paid',
      redirectPath: invite.billing_mode === 'paid' ? '/billing' : '/club-settings',
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.statusCode ? error.message : 'Club admin account could not be created.')
  }
}
