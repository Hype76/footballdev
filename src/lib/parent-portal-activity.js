export const PARENT_PORTAL_ACTIVITY_SCOPES = Object.freeze({
  child: 'child',
  parentGlobal: 'parent_global',
})

export const PARENT_PORTAL_ACTIVITY_REGISTRY = Object.freeze([
  Object.freeze({
    key: 'calendar',
    route: '/parent-portal?section=calendar',
    scope: PARENT_PORTAL_ACTIVITY_SCOPES.child,
    source: 'Parent-visible calendar events, invitations and match cards',
    eligibility: 'Active Parent link for the selected child and current Parent-visible event scope',
    markViewedAfter: 'Calendar data loads successfully for the selected child',
  }),
  Object.freeze({
    key: 'invites',
    route: '/parent-portal?section=invites',
    scope: PARENT_PORTAL_ACTIVITY_SCOPES.child,
    source: 'Active calendar and Match Day invitations for the selected child',
    eligibility: 'Active Parent link and non-cancelled invitation for the selected child',
    markViewedAfter: 'Invitation data loads successfully for the selected child',
  }),
  Object.freeze({
    key: 'matches',
    route: '/parent-portal?section=matches',
    scope: PARENT_PORTAL_ACTIVITY_SCOPES.child,
    source: 'Parent-visible current and upcoming match cards',
    eligibility: 'Active Parent link and current Parent-visible Match Day scope',
    markViewedAfter: 'Current match-card data loads successfully for the selected child',
  }),
  Object.freeze({
    key: 'results',
    route: '/parent-portal?section=results',
    scope: PARENT_PORTAL_ACTIVITY_SCOPES.child,
    source: 'Parent-visible completed and previous match cards',
    eligibility: 'Active Parent link and previous Parent-visible Match Day scope',
    markViewedAfter: 'Results data loads successfully for the selected child',
  }),
  Object.freeze({
    key: 'resources',
    route: '/parent-portal?section=resources',
    scope: PARENT_PORTAL_ACTIVITY_SCOPES.child,
    source: 'Active Team Resource assignments shared with the selected child',
    eligibility: 'Active Parent link, active Player, active assignment and Parent-visible resource',
    markViewedAfter: 'Resource data loads successfully for the selected child',
  }),
  Object.freeze({
    key: 'chat',
    route: '/parent-chat',
    scope: PARENT_PORTAL_ACTIVITY_SCOPES.parentGlobal,
    source: 'Messages from other participants in authorised Parent Chat rooms',
    eligibility: 'Active Parent Chat membership derived from current Parent authority',
    markViewedAfter: 'The authorised Parent Chat room list loads successfully',
  }),
  Object.freeze({
    key: 'polls',
    route: '/parent-polls',
    scope: PARENT_PORTAL_ACTIVITY_SCOPES.child,
    source: 'Open Parent polls available to the selected child link',
    eligibility: 'Active Parent link and current open Parent poll scope',
    markViewedAfter: 'Poll data loads successfully for the selected child',
  }),
])

export const PARENT_PORTAL_ACTIVITY_CATEGORY_KEYS = Object.freeze(
  PARENT_PORTAL_ACTIVITY_REGISTRY.map((category) => category.key),
)

const categoryKeySet = new Set(PARENT_PORTAL_ACTIVITY_CATEGORY_KEYS)

export function isParentPortalActivityCategory(value) {
  return categoryKeySet.has(String(value ?? '').trim())
}

export function normalizeParentPortalActivityState(row = {}) {
  const categoryKey = String(row.category_key ?? row.categoryKey ?? '').trim()

  if (!isParentPortalActivityCategory(categoryKey)) {
    return null
  }

  return {
    categoryKey,
    scopeType: String(row.scope_type ?? row.scopeType ?? '').trim(),
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    latestActivityAt: row.latest_activity_at ?? row.latestActivityAt ?? '',
    lastViewedAt: row.last_viewed_at ?? row.lastViewedAt ?? '',
    isNew: Boolean(row.is_new ?? row.isNew),
  }
}

export function toParentPortalActivityMap(rows = []) {
  return Object.fromEntries(
    (Array.isArray(rows) ? rows : [])
      .map(normalizeParentPortalActivityState)
      .filter(Boolean)
      .map((row) => [row.categoryKey, row]),
  )
}
export function toParentPortalNewStateMap(activityByCategory = {}) {
  return Object.fromEntries(
    PARENT_PORTAL_ACTIVITY_CATEGORY_KEYS.map((categoryKey) => [
      categoryKey,
      Boolean(activityByCategory?.[categoryKey]?.isNew),
    ]),
  )
}
