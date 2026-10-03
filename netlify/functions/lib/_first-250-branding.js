// Preparation library only. No route, signup hook, processor or live binding.
export const BRANDING_OFFER_RULES = Object.freeze({ capacity: 250, existingPlaces: 39,
  newPlaces: 211, playersWithAcceptedParent: 7, completedMatches: 10, calendarMonths: 3 })

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN
  return Date.parse(value)
}

function dayInZone(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

export function evaluateBrandingOfferProgress({ teamId, clubId, startedAt, deadlineAt,
  timezone, asOf, players = [], parentLinks = [], matches = [] }) {
  const start = instant(startedAt), deadline = instant(deadlineAt), now = instant(asOf)
  if (!teamId || !clubId || !timezone || !Number.isFinite(start) || !Number.isFinite(deadline)
    || !Number.isFinite(now) || deadline <= start || now < start) throw new Error('branding_progress_context_invalid')
  const cutoff = Math.min(now, deadline)
  const firstDay = dayInZone(start, timezone), lastDay = dayInZone(cutoff, timezone)
  const scoped = row => row.teamId === teamId && row.clubId === clubId
  const activePlayers = new Set(players.filter(player => scoped(player) && player.id
    && player.status === 'active' && !player.archivedAt).map(player => player.id))
  const linkedPlayers = new Set(parentLinks.filter(link => scoped(link)
    && activePlayers.has(link.playerId) && link.linkType === 'parent'
    && link.status === 'active' && link.authUserId && link.accountActive === true
    && Number.isFinite(instant(link.acceptedAt)) && instant(link.acceptedAt) <= cutoff)
    .map(link => link.playerId))
  const completed = new Set(matches.filter(match => scoped(match) && match.id
    && match.status === 'full_time' && !match.deletedAt && !match.isDemo
    && /^\d{4}-\d{2}-\d{2}$/.test(match.matchDate || '')
    && Number.isFinite(Date.parse(`${match.matchDate}T00:00:00Z`))
    && new Date(`${match.matchDate}T00:00:00Z`).toISOString().slice(0, 10) === match.matchDate
    && match.matchDate >= firstDay && match.matchDate <= lastDay
    && instant(match.concludedAt) >= start && instant(match.concludedAt) <= cutoff)
    .map(match => match.id))
  return Object.freeze({ playersWithAcceptedParent: linkedPlayers.size,
    completedMatches: completed.size,
    evaluatedAt: asOf,
    qualifies: now <= deadline && linkedPlayers.size >= 7 && completed.size >= 10 })
}

export function resolvePromotionalBranding({ baseLogoAllowed, baseColoursAllowed,
  releaseEnabled = false, authorityAllowed = false, teamId, clubId, entry, asOf }) {
  const now = instant(asOf)
  const scoped = Boolean(teamId && clubId && entry?.teamId === teamId && entry?.clubId === clubId)
  const grandfathered = entry?.cohort === 'existing_39' && entry?.state === 'grandfathered'
  const earned = entry?.cohort === 'new_211' && entry?.state === 'permanent'
  const provisional = entry?.cohort === 'new_211' && entry?.state === 'provisional'
    && Number.isFinite(now) && instant(entry.startedAt) <= now && instant(entry.deadlineAt) > now
  const promotionAllowed = Boolean(releaseEnabled && authorityAllowed && scoped
    && (grandfathered || earned || provisional))
  return Object.freeze({ logoAllowed: baseLogoAllowed === true || promotionAllowed,
    coloursAllowed: baseColoursAllowed === true || promotionAllowed, promotionAllowed })
}

export function resolveTeamBrandingDisplay({ teamId, clubId, authorityAllowed,
  paidClubBrandingEligible = false, clubBranding, teamBranding, entitlement }) {
  // Eligibility and authority must come from the server, never a submitted plan.
  if (!authorityAllowed) return { source: 'platform', logoUrl: '', accent: '' }
  if (paidClubBrandingEligible && clubBranding?.clubId === clubId) {
    return { source: 'paid_club', logoUrl: clubBranding.logoUrl || '', accent: clubBranding.accent || '' }
  }
  if (teamBranding?.teamId !== teamId || teamBranding?.clubId !== clubId) {
    return { source: 'platform', logoUrl: '', accent: '' }
  }
  return { source: entitlement?.logoAllowed || entitlement?.coloursAllowed ? 'team' : 'platform',
    logoUrl: entitlement?.logoAllowed ? teamBranding.logoUrl || '' : '',
    accent: entitlement?.coloursAllowed ? teamBranding.accent || '' : '' }
}

export function planBrandingOfferOutcome(entry, progress, asOf) {
  if (entry?.cohort === 'existing_39' && entry.state === 'grandfathered') return 'grandfathered'
  if (entry?.state === 'permanent' || entry?.state === 'failed') return entry.state
  const now = instant(asOf), start = instant(entry?.startedAt), deadline = instant(entry?.deadlineAt)
  if (entry?.cohort !== 'new_211' || entry.state !== 'provisional' || !Number.isFinite(now)
    || !Number.isFinite(start) || !Number.isFinite(deadline) || now < start) throw new Error('branding_outcome_invalid')
  // A current row set read after expiry is not proof of its historical state.
  const observed = instant(progress?.evaluatedAt)
  if (progress?.qualifies === true && observed >= start && observed <= deadline && observed <= now) return 'permanent'
  return now >= deadline ? 'failed' : 'provisional'
}

export async function readPublicBrandingOfferCounter(client) {
  const { data, error } = await client.rpc('read_branding_offer_counter')
  if (error) throw new Error('branding_counter_unavailable')
  if (data?.status !== 'active') return { status: 'not_active' }
  const valid = data.capacity === 250 && Number.isInteger(data.reserved)
    && Number.isInteger(data.remaining) && data.reserved >= 39 && data.reserved <= 250
    && data.remaining >= 0 && data.reserved + data.remaining === 250
  if (!valid) throw new Error('branding_counter_invalid')
  return { status: 'active', capacity: 250, reserved: data.reserved, remaining: data.remaining }
}
