import { createPublicSupabaseClient, supabaseAdmin } from './lib/_supabase.js'
import { getAuthenticatedPlanProfile } from './lib/_plan-gate.js'
import { getPlanLimit } from '../../src/lib/plans.js'
import { handler as sendStaffInvite } from './send-staff-invite.js'
import { createPhoneTeamAdministrationHandler } from './lib/_phone-team-administration.js'

export const handler = createPhoneTeamAdministrationHandler({
  client: supabaseAdmin, getPlanProfile: getAuthenticatedPlanProfile,
  getStaffLimit: profile => getPlanLimit(profile, 'staffLogins'),
  authenticatedClient: (event, token) => createPublicSupabaseClient(event, { global: { headers: { Authorization: `Bearer ${token}` } } }),
  sendInvite: sendStaffInvite,
})
