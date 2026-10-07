import { mobileAccountRequest } from './mobileSignup'

export function assertTeamAdministrationScope(value, user) {
  if (!value || String(value.teamId) !== String(user.activeTeamId || user.teamId) || String(value.clubId) !== String(user.clubId)) {
    throw new Error('Team access changed. Refresh your account before continuing.')
  }
  return value
}

export async function readCoachTeamAdministration(user) {
  return assertTeamAdministrationScope(await mobileAccountRequest('coach', 'manage-phone-team-administration', {
    action: 'read', teamId: user.activeTeamId || user.teamId,
  }), user)
}

export async function saveCoachTeamReminders(user, policy) {
  return assertTeamAdministrationScope(await mobileAccountRequest('coach', 'manage-phone-team-administration', {
    action: 'save', teamId: user.activeTeamId || user.teamId,
    squadEnabled: policy.squadEnabled, squadHoursBefore: policy.squadHoursBefore,
    availabilityEnabled: policy.availabilityEnabled, availabilityHoursBefore: policy.availabilityHoursBefore,
  }), user)
}

export async function addCoachFromPhone(user, email, role) {
  return assertTeamAdministrationScope(await mobileAccountRequest('coach', 'manage-phone-team-administration', {
    action: 'invite', teamId: user.activeTeamId || user.teamId, email, role,
  }), user)
}
