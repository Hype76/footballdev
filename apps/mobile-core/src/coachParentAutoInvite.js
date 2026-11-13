import { getFeatureAccess, CAPABILITIES } from '../../../src/lib/paywall-access.js'
import { getPlayerParentInviteContacts, normalizeParentPortalInviteEmail, isParentPortalInviteEligiblePlayer } from '../../../src/lib/parent-portal-invite-actions.js'

export async function sendNewMatchdayParentInvites({ user, player, previousPlayer, sendInvite, onSending = () => {}, existingLinks }) {
  if (user?.hasActivePlanAccess !== true || !user.activeTeamId || !isParentPortalInviteEligiblePlayer(player)) return {}
  if (!existingLinks && user.planKey !== 'matchday') return {}
  if (!getFeatureAccess({ ...user, teamId: user.activeTeamId }, CAPABILITIES.parentInvitations).allowed) return {}
  const previousEmails = new Set(getPlayerParentInviteContacts(previousPlayer).map(contact => contact.email))
  const sentEmails = new Set((existingLinks || [])
    .filter(link => link.status === 'active' || (link.status === 'pending' && link.invite_sent_at
      && (!link.expires_at || Date.parse(link.expires_at) > Date.now())))
    .map(link => normalizeParentPortalInviteEmail(link.email)))
  const results = {}
  for (const contact of getPlayerParentInviteContacts(player)) {
    const { email } = contact
    if (sentEmails.has(email) || (!existingLinks && previousEmails.has(email))) continue
    onSending(email)
    try {
      const result = await sendInvite(user, player.id, { ...contact, email })
      results[email] = { status: result?.alreadyLinked ? 'accepted' : 'sent', confirmedByServer: true }
    } catch {
      results[email] = { status: 'failed', message: 'Save the player again to retry.' }
    }
  }
  onSending('')
  return results
}
