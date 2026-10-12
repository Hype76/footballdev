// Results remain in the inbox. A time-sensitive push should expire instead of
// arriving days later after a phone reconnects to its notification provider.
export function pollResultPushDelivery(pollId) {
  return { priority: 'high', ttl: 3600, collapseId: `poll-result:${String(pollId)}` }
}
