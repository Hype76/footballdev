import { getDateInTimeZone } from './parentCalendarCore.js'

export function canRemoveCoachCancelledFixture({ context, fixture, stale = false } = {}) {
  return !stale && context?.paymentAccess?.canMutate === true && Number(context?.roleRank || 0) >= 50
    && !['admin', 'super_admin', 'parent_portal', 'adult_player'].includes(context?.role)
    && Boolean(context?.teamId) && fixture?.teamId === context.teamId && fixture?.status === 'cancelled'
    && fixture?.sourceType === 'match_day' && Boolean(fixture?.sourceId)
}

function canManageFixture(context, fixture, stale, minimumRank) {
  return !stale
    && context?.paymentAccess?.canMutate === true
    && Number(context?.roleRank || 0) >= minimumRank
    && !['admin', 'super_admin', 'parent_portal', 'adult_player'].includes(context?.role)
    && Boolean(context?.teamId)
    && fixture?.teamId === context.teamId
    && Boolean(fixture?.id)
    && !fixture.deletedAt && !fixture.previousHiddenAt
}

export function isCoachFixtureEditable(fixture = {}) {
  return Boolean(fixture.concludedAt)
    || ['scheduled', 'scorer_request', 'postponed'].includes(fixture.status)
}

export function canEditCoachFixture({ context, fixture, stale = false } = {}) {
  return canManageFixture(context, fixture, stale, 20) && isCoachFixtureEditable(fixture)
}

export function canDeleteCoachFixture({ context, fixture, stale = false, today = getDateInTimeZone() } = {}) {
  if (!canManageFixture(context, fixture, stale, 30)) return false
  const active = ['live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(fixture.status)
    || ['running', 'paused', 'half_time', 'hydration'].includes(fixture.timerStatus)
  return !active || Boolean(fixture.matchDate && fixture.matchDate < today)
}
