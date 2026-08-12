import { supabaseAdmin } from './lib/_supabase.js'
import { normalizeParentCommunicationChannel } from './lib/_parent-communication-preferences.js'

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function bearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

async function getParentUser(event) {
  const token = bearerToken(event)
  if (!token) throw Object.assign(new Error('Sign in before changing communication settings.'), { statusCode: 401 })

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Sign in before changing communication settings.'), { statusCode: 401 })

  const { data: link, error: linkError } = await supabaseAdmin
    .from('parent_player_links')
    .select('id')
    .eq('auth_user_id', data.user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (linkError || !link) {
    throw Object.assign(new Error('An active Parent link is required.'), { statusCode: 403 })
  }

  return data.user
}

async function readPreference(authUserId) {
  const { data, error } = await supabaseAdmin
    .from('parent_communication_preferences')
    .select('communication_channel, updated_at')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error && !['42P01', 'PGRST205'].includes(String(error.code || ''))) throw error

  return {
    communicationChannel: normalizeParentCommunicationChannel(data?.communication_channel),
    updatedAt: data?.updated_at || null,
  }
}

export async function handler(event) {
  if (!['GET', 'PUT'].includes(event.httpMethod)) return response(405, { success: false, message: 'Method Not Allowed' })

  try {
    const authUser = await getParentUser(event)

    if (event.httpMethod === 'GET') {
      return response(200, { success: true, preference: await readPreference(authUser.id) })
    }

    const body = JSON.parse(event.body || '{}')
    const communicationChannel = String(body.communicationChannel || '').trim().toLowerCase()
    if (!['app', 'email', 'both'].includes(communicationChannel)) {
      return response(400, { success: false, message: 'Choose App notifications, Email, or Both.' })
    }

    const now = new Date().toISOString()
    const { error } = await supabaseAdmin.from('parent_communication_preferences').upsert({
      auth_user_id: authUser.id,
      communication_channel: communicationChannel,
      updated_at: now,
    }, { onConflict: 'auth_user_id' })

    if (error) throw error

    return response(200, {
      success: true,
      preference: { communicationChannel, updatedAt: now },
    })
  } catch (error) {
    console.error('Parent communication preference failed', {
      code: String(error?.code || error?.name || 'unknown').slice(0, 100),
    })
    return response(error.statusCode || 500, {
      success: false,
      message: error.message || 'Communication settings could not be saved.',
    })
  }
}
