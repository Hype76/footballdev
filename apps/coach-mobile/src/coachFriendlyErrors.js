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
  if (lower.includes('only be started on the fixture date')) {
    return 'This match is not scheduled for today. If it has moved, edit the fixture date before starting it.'
  }
  if (lower.includes('match_day_fixture_already_started')) {
    return 'This fixture has changed and can no longer be cancelled. Refresh Match Day.'
  }
  if (lower.includes('match_day_fixture_not_permitted')) {
    return 'This fixture cannot be changed in the current Team context.'
  }
  if (/\b(pgrst\d*|postgres|schema|column|relation|rpc|42501|42p01|22p\d*|55000)\b/i.test(raw) || /^[a-z0-9_]+$/.test(raw)) {
    return fallback
  }
  return raw
}
