export function requiresWatchedMatch(poll) {
  if (poll?.requiresWatchedMatch === true || poll?.requires_watched_match === true) return true
  return (poll?.pollType || poll?.poll_type) === 'awards'
    && /^(player|man) of the match(?:\b|$)/i.test(String(poll?.title || '').trim())
}
