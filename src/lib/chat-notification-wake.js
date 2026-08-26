const WAKE_TIMEOUT_MS = 4000

function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function wakeChatMobileNotificationProcessor({ accessToken, baseUrl = '' } = {}) {
  const token = normalizeText(accessToken)
  if (!token || typeof fetch !== 'function') return false

  const normalizedBaseUrl = normalizeText(baseUrl).replace(/\/$/, '')
  const url = `${normalizedBaseUrl}/.netlify/functions/process-chat-mobile-notifications-now`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function wakeChatMobileNotificationProcessorFromSession(supabase, options = {}) {
  try {
    const { data } = await supabase.auth.getSession()
    return wakeChatMobileNotificationProcessor({
      ...options,
      accessToken: data?.session?.access_token || '',
    })
  } catch {
    return false
  }
}
