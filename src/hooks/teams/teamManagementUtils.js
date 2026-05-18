export const initialCoachForm = {
  email: '',
  teamId: '',
  roleKey: 'coach',
  customRoleLabel: '',
}

export const TEAM_PAGE_SIZE = 8
export const STAFF_PAGE_SIZE = 8
export const PARTIAL_TEAM_DATA_MESSAGE =
  'Some team or staff records could not be refreshed. Missing items will appear once the data is entered or the connection settles.'

export function getStaffDisplayName(member) {
  return String(member?.name || member?.username || member?.email || 'Unnamed staff').trim()
}

export function normalizeStaffEmail(memberOrEmail) {
  const email = typeof memberOrEmail === 'string' ? memberOrEmail : memberOrEmail?.email
  return String(email ?? '').trim().toLowerCase()
}
