export function canRemoveCoachCancelledFixture({ context, fixture, stale = false } = {}) {
  return !stale && context?.paymentAccess?.canMutate === true && Number(context?.roleRank || 0) >= 50
    && !['admin', 'super_admin', 'parent_portal', 'adult_player'].includes(context?.role)
    && Boolean(context?.teamId) && fixture?.teamId === context.teamId && fixture?.status === 'cancelled'
    && fixture?.sourceType === 'match_day' && Boolean(fixture?.sourceId)
}

export function canEditCoachFixture({ context, fixture, stale = false } = {}) {
  return !stale
    && context?.paymentAccess?.canMutate === true
    && Number(context?.roleRank || 0) >= 20
    && !['admin', 'super_admin', 'parent_portal', 'adult_player'].includes(context?.role)
    && Boolean(context?.teamId)
    && fixture?.teamId === context.teamId
    && Boolean(fixture?.id)
    && !fixture.deletedAt && !fixture.previousHiddenAt && !fixture.concludedAt
    && ['scheduled', 'scorer_request', 'postponed'].includes(fixture.status)
}
