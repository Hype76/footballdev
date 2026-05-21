const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

function chunkMessages(messages, size = 100) {
  const chunks = []

  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size))
  }

  return chunks
}

export async function sendExpoPushMessages(messages) {
  const validMessages = messages.filter((message) => String(message.to || '').startsWith('ExponentPushToken['))

  if (validMessages.length === 0) {
    return {
      sent: 0,
      failed: 0,
      invalidTokens: [],
    }
  }

  const results = await Promise.all(chunkMessages(validMessages).map(async (chunk) => {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
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
    const failed = tickets.filter((ticket) => ticket.status === 'error').length
    const invalidTokens = tickets
      .map((ticket, index) => ticket.details?.error === 'DeviceNotRegistered' ? chunk[index]?.to : '')
      .filter(Boolean)

    return {
      sent: Math.max(chunk.length - failed, 0),
      failed,
      invalidTokens,
      result,
    }
  }))

  return results.reduce(
    (summary, result) => ({
      sent: summary.sent + result.sent,
      failed: summary.failed + result.failed,
      invalidTokens: [...summary.invalidTokens, ...(result.invalidTokens || [])],
    }),
    { sent: 0, failed: 0, invalidTokens: [] },
  )
}
