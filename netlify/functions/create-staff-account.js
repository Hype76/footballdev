import { supabaseAdmin } from './lib/_supabase.js'
import { assertPasswordPolicy } from '../../src/lib/password-policy.js'

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
  return String(email ?? '').split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'Staff User'
}

function isExistingUserError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('already registered') || message.includes('already exists') || message.includes('user already')
}

async function findAuthUserByEmail(email) {
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

async function getInvite(token) {
  const { data, error } = await supabaseAdmin
    .from('club_user_invites')
    .select('id, club_id, email, role_key, role_label, role_rank, team_id, expires_at, accepted_at, invite_token')
    .eq('invite_token', token)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('This staff invite could not be found.'), { statusCode: 404 })
  }

  if (data.accepted_at) {
    throw Object.assign(new Error('This staff invite has already been accepted.'), { statusCode: 409 })
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('This staff invite has expired. Ask the club to send a new staff invite.'), { statusCode: 410 })
  }

  return data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const token = String(body.token ?? '').trim()
    const email = normalizeEmail(body.email)
    const password = String(body.password ?? '')

    if (!token) {
      return failureResponse(400, 'Staff invite token is required.')
    }

    if (!isValidEmail(email)) {
      return failureResponse(400, 'Enter a valid email address.')
    }

    try {
      assertPasswordPolicy(password)
    } catch (error) {
      return failureResponse(400, error.message)
    }

    const invite = await getInvite(token)
    const inviteEmail = normalizeEmail(invite.email)

    if (inviteEmail !== email) {
      return failureResponse(403, 'This staff invite is for a different email address.')
    }

    const displayName = getDisplayName(email)
    let staffUserId = ''
    const existingAuthUser = await findAuthUserByEmail(email)

    if (existingAuthUser?.id) {
      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          ...(existingAuthUser.user_metadata || {}),
          username: existingAuthUser.user_metadata?.username || displayName,
          name: existingAuthUser.user_metadata?.name || displayName,
          display_name: existingAuthUser.user_metadata?.display_name || displayName,
        },
      })

      if (updateAuthError) {
        return failureResponse(400, updateAuthError.message)
      }

      staffUserId = existingAuthUser.id
    } else {
      const { data: createdAuthUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: displayName,
          name: displayName,
          display_name: displayName,
          account_type: 'staff',
        },
      })

      if (createAuthError) {
        if (!isExistingUserError(createAuthError)) {
          return failureResponse(400, createAuthError.message)
        }

        const foundAuthUser = await findAuthUserByEmail(email)

        if (!foundAuthUser?.id) {
          return failureResponse(400, 'This email already exists but could not be linked.')
        }

        staffUserId = foundAuthUser.id
      } else {
        staffUserId = createdAuthUser?.user?.id || ''
      }
    }

    if (!staffUserId) {
      return failureResponse(400, 'Could not create staff auth user.')
    }

    const { error: profileError } = await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: staffUserId,
          email,
          username: displayName,
          name: displayName,
          role: invite.role_key,
          role_label: invite.role_label,
          role_rank: invite.role_rank,
          club_id: invite.club_id,
          force_password_change: false,
        },
        {
          onConflict: 'id',
        },
      )

    if (profileError) {
      return failureResponse(400, profileError.message)
    }

    const { error: membershipError } = await supabaseAdmin
      .from('user_club_memberships')
      .upsert(
        {
          auth_user_id: staffUserId,
          email,
          username: displayName,
          name: displayName,
          role: invite.role_key,
          role_label: invite.role_label,
          role_rank: invite.role_rank,
          club_id: invite.club_id,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'auth_user_id,club_id',
        },
      )

    if (membershipError) {
      return failureResponse(400, membershipError.message)
    }

    if (invite.team_id) {
      const { error: teamStaffError } = await supabaseAdmin
        .from('team_staff')
        .upsert(
          {
            team_id: invite.team_id,
            user_id: staffUserId,
          },
          {
            onConflict: 'team_id,user_id',
          },
        )

      if (teamStaffError) {
        return failureResponse(400, teamStaffError.message)
      }
    }

    const { error: inviteUpdateError } = await supabaseAdmin
      .from('club_user_invites')
      .update({
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invite.id)

    if (inviteUpdateError) {
      return failureResponse(400, inviteUpdateError.message)
    }

    return jsonResponse(200, {
      success: true,
      email,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.statusCode ? error.message : 'Staff account could not be created.')
  }
}
