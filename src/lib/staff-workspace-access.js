const ACTIVE_STATUS = 'active'

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isActiveStaffAccount(profile) {
  return Boolean(profile?.id) && normalizeStatus(profile?.status ?? profile?.accountStatus) === ACTIVE_STATUS
}

export function isActiveStaffMembership(membership) {
  const roleRank = Number(membership?.roleRank ?? membership?.role_rank ?? 0)
  const clubStatus = normalizeStatus(membership?.clubStatus ?? membership?.club_status)

  return Boolean(membership?.clubId ?? membership?.club_id)
    && roleRank >= 20
    && clubStatus === ACTIVE_STATUS
}

export function getActiveStaffMemberships(memberships = []) {
  return Array.isArray(memberships) ? memberships.filter(isActiveStaffMembership) : []
}

export function canSwitchParentToStaff({ memberships = [], profile } = {}) {
  return isActiveStaffAccount(profile) && getActiveStaffMemberships(memberships).length > 0
}
