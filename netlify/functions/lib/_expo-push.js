const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_PUSH_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/

function chunkMessages(messages, size = 100) {
  const chunks = []

  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size))
  }

  return chunks
}

export async function sendExpoPushMessages(messages, { client } = {}) {
  let eligibleMessages = messages
  if (messages.some(message => ['parent', 'coach'].includes(message.data?.app))) {
    const { filterMobileNotificationMessages } = await import('./_mobile-notification-preferences.js')
    const database = client || (await import('./_supabase.js')).supabaseAdmin
    eligibleMessages = await filterMobileNotificationMessages(messages, database)
  }
  const skipped = messages.length - eligibleMessages.length
  const validMessages = eligibleMessages
    .filter((message) => EXPO_PUSH_TOKEN_PATTERN.test(String(message.to || '')))
    .map((message) => ({
      ...message,
      badge: Number.isFinite(Number(message.badge)) ? Math.max(0, Math.floor(Number(message.badge))) : 1,
    }))

  if (validMessages.length === 0) {
    return {
      sent: 0,
      failed: 0,
      invalidTokens: [],
      ...(skipped ? { skipped } : {}),
    }
  }

  const results = await Promise.all(chunkMessages(validMessages).map(async (chunk) => {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok) {
      return {
        sent: 0,
        failed: chunk.length,
        invalidTokens: [],
        result,
      }
    }

    const tickets = Array.isArray(result.data) ? result.data : []
    const sent = chunk.filter((_, index) => tickets[index]?.status === 'ok').length
    const failed = chunk.length - sent
    const invalidTokens = tickets
      .map((ticket, index) => ticket.details?.error === 'DeviceNotRegistered' ? chunk[index]?.to : '')
      .filter(Boolean)

    return {
      sent,
      failed,
      invalidTokens,
      result,
    }
  }))

  return results.reduce(
    (summary, result) => ({
      ...(summary.skipped ? { skipped: summary.skipped } : {}),
      sent: summary.sent + result.sent,
      failed: summary.failed + result.failed,
      invalidTokens: [...summary.invalidTokens, ...(result.invalidTokens || [])],
    }),
    { sent: 0, failed: 0, invalidTokens: [], ...(skipped ? { skipped } : {}) },
  )
}
