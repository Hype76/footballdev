export const COACH_CLUB_PROMOTION_TERMS = 'New paid clubs only. 50% off the first 3 monthly payments, then the normal monthly price. Once per club. Cannot be combined with other discounts.'

export function normalizeCoachClubCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function clubSignupPath({ code = '', teamCapacity = 20, offerKey = 'club_20' } = {}) {
  const params = new URLSearchParams({ teams: String(teamCapacity), ...(offerKey ? { offer: offerKey } : {}) })
  const normalized = normalizeCoachClubCode(code)
  if (normalized) params.set('ref', normalized)
  return `/club-signup?${params}`
}

export function coachClubShareLink(code) {
  return `https://footballplayer.online${clubSignupPath({ code })}`
}
