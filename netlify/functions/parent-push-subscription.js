import process from 'node:process'
import { supabaseAdmin } from './lib/_supabase.js'

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

async function getAuthUser(event) {
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

async function getParentLink(parentLinkId, authUserId) {
  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, auth_user_id, status')
    .eq('id', parentLinkId)
    .eq('auth_user_id', authUserId)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('This family portal link could not be opened.'), { statusCode: 403 })
  }

  return data
}

function normalizeSubscription(subscription) {
  const endpoint = String(subscription?.endpoint ?? '').trim()
  const p256dh = String(subscription?.keys?.p256dh ?? '').trim()
  const auth = String(subscription?.keys?.auth ?? '').trim()

  if (!endpoint || !p256dh || !auth) {
    throw Object.assign(new Error('Notification subscription details are incomplete.'), { statusCode: 400 })
  }

  return { endpoint, p256dh, auth }
}

export async function handler(event) {
  if (event.httpMethod === 'GET') {
    return jsonResponse(200, {
      success: true,
      publicKey: String(process.env.VITE_WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY || '').trim(),
    })
  }

  if (!['POST', 'DELETE'].includes(event.httpMethod)) {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(event)
    const body = JSON.parse(event.body || '{}')
    const parentLinkId = String(body.parentLinkId ?? '').trim()

    if (!parentLinkId) {
      return failureResponse(400, 'Parent link is required.')
    }

    const parentLink = await getParentLink(parentLinkId, authUser.id)

    if (event.httpMethod === 'DELETE') {
      const endpoint = String(body.endpoint ?? '').trim()

      if (!endpoint) {
        return failureResponse(400, 'Subscription endpoint is required.')
      }

      const { error } = await supabaseAdmin
        .from('parent_push_subscriptions')
        .update({
          status: 'revoked',
          updated_at: new Date().toISOString(),
        })
        .eq('endpoint', endpoint)
        .eq('auth_user_id', authUser.id)

      if (error) {
        throw error
      }

      return jsonResponse(200, { success: true })
    }

    const subscription = normalizeSubscription(body.subscription)
    const userAgent = String(event.headers['user-agent'] || event.headers['User-Agent'] || '').slice(0, 500)

    const { error } = await supabaseAdmin
      .from('parent_push_subscriptions')
      .upsert({
        club_id: parentLink.club_id,
        team_id: parentLink.team_id || null,
        parent_link_id: parentLink.id,
        auth_user_id: authUser.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        user_agent: userAgent,
        status: 'active',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'endpoint',
      })

    if (error) {
      throw error
    }

    return jsonResponse(200, { success: true })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Notification subscription could not be saved.')
  }
}
