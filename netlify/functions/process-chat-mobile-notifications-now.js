import { createSupabaseAdminClient } from './lib/_supabase.js'
import { processChatMobileNotifications } from './process-chat-mobile-notifications.js'

function bearerToken(request) {
  const header = String(request.headers.get('authorization') || '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function safeCode(value, fallback = 'processor_error') {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, '_').slice(0, 100) || fallback
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return Response.json({ success: false, message: 'Method not allowed.' }, { status: 405 })
  }

  const token = bearerToken(request)
  if (!token) {
    return Response.json({ success: false, message: 'Login is required.' }, { status: 401 })
  }

  try {
    const client = createSupabaseAdminClient({
      headers: Object.fromEntries(request.headers.entries()),
    })
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user?.id) {
      return Response.json({ success: false, message: 'Login is required.' }, { status: 401 })
    }

    const result = await processChatMobileNotifications({ client })
    console.info('chat_mobile_notification_on_demand_complete', result)
    return Response.json({ success: true, ...result }, { status: 200 })
  } catch (error) {
    console.error('chat_mobile_notification_on_demand_failed', {
      code: safeCode(error?.code || error?.name),
    })
    return Response.json({ success: false, message: 'Chat notifications will be retried automatically.' }, { status: 503 })
  }
}
