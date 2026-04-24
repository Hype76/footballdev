import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Staff creation is not configured.' }, 500)
    }

    const authorization = request.headers.get('Authorization') ?? ''
    const accessToken = authorization.replace('Bearer ', '').trim()

    if (!accessToken) {
      return jsonResponse({ error: 'Signed in manager is required.' }, 401)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    })
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const {
      data: { user: authUser },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !authUser) {
      return jsonResponse({ error: 'Signed in manager is required.' }, 401)
    }

    const { data: requester, error: requesterError } = await adminClient
      .from('users')
      .select('id, club_id, role_rank, role')
      .eq('id', authUser.id)
      .single()

    if (requesterError || !requester) {
      return jsonResponse({ error: 'Requester profile was not found.' }, 403)
    }

    const payload = await request.json()
    const email = normalizeEmail(payload.email)
    const password = String(payload.password ?? '')
    const clubId = String(payload.clubId ?? '')
    const roleKey = String(payload.roleKey ?? '').trim()
    const roleLabel = String(payload.roleLabel ?? '').trim()
    const roleRank = Number(payload.roleRank ?? 0)

    if (!email || password.length < 8 || !clubId || !roleKey || !roleLabel) {
      return jsonResponse({ error: 'Email, password, club, and role are required.' }, 400)
    }

    if (String(requester.club_id ?? '') !== clubId || Number(requester.role_rank ?? 0) < 50) {
      return jsonResponse({ error: 'You cannot create staff for this club.' }, 403)
    }

    if (roleRank > Number(requester.role_rank ?? 0)) {
      return jsonResponse({ error: 'You cannot assign a role above your own level.' }, 403)
    }

    const { data: existingProfile } = await adminClient
      .from('users')
      .select('id')
      .eq('club_id', clubId)
      .eq('email', email)
      .maybeSingle()

    let staffUserId = existingProfile?.id ?? ''

    if (staffUserId) {
      const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(staffUserId, {
        email,
        password,
        email_confirm: true,
      })

      if (updateAuthError) {
        return jsonResponse({ error: updateAuthError.message }, 400)
      }
    } else {
      const { data: createdAuthUser, error: createAuthError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          created_by_manager: authUser.id,
        },
      })

      if (createAuthError || !createdAuthUser.user) {
        return jsonResponse({ error: createAuthError?.message ?? 'Could not create staff auth user.' }, 400)
      }

      staffUserId = createdAuthUser.user.id
    }

    const displayName = email.split('@')[0] || 'Staff User'
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .upsert(
        {
          id: staffUserId,
          email,
          username: displayName,
          name: displayName,
          role: roleKey,
          role_label: roleLabel,
          role_rank: roleRank,
          club_id: clubId,
          force_password_change: true,
        },
        {
          onConflict: 'id',
        },
      )
      .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
      .single()

    if (profileError) {
      return jsonResponse({ error: profileError.message }, 400)
    }

    await adminClient.from('club_user_invites').delete().eq('club_id', clubId).eq('email', email)

    return jsonResponse({ profile })
  } catch (error) {
    console.error(error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Could not create staff user.' }, 500)
  }
})
