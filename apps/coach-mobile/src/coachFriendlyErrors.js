function normalize(value) {
  return String(value ?? '').trim()
}

export function getCoachFriendlyError(error, fallback = 'This could not be completed. Please try again.') {
  const raw = normalize(error?.message || error)
  const lower = raw.toLowerCase()
  if (!raw) return fallback
  if (lower.includes('network request failed') || lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('timed out')) {
    return 'We could not connect just now. Saved information is still available where possible.'
  }
  if (lower.includes('clock') || lower.includes('europe/london time does not exist')) {
    return 'That time falls during the clock change. Please choose another time.'
  }
  if (lower.includes('jwt') || lower.includes('token') || lower.includes('sign in')) {
    return 'Your sign-in needs refreshing before this can be completed.'
  }
  if (/\b(pgrst\d*|postgres|schema|column|relation|rpc|42501|42p01|22p\d*|55000)\b/i.test(raw) || /^[a-z0-9_]+$/.test(raw)) {
    return fallback
  }
  return raw
}
