function normalize(value) {
  return String(value ?? '').trim()
}

export function getMobileChatMessagesFingerprint(messages = []) {
  return (messages || [])
    .map((message) => [
      normalize(message?.id),
      normalize(message?.updatedAt ?? message?.updated_at ?? message?.createdAt ?? message?.created_at),
      normalize(message?.deletedAt ?? message?.deleted_at),
    ].join(':'))
    .join('|')
}
