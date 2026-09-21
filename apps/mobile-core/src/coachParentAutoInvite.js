import { getFeatureAccess, CAPABILITIES } from '../../../src/lib/paywall-access.js'
import { normalizeParentPortalInviteEmail, isParentPortalInviteEligiblePlayer } from '../../../src/lib/parent-portal-invite-actions.js'

export async function sendNewMatchdayParentInvites({ user, player, previousPlayer, sendInvite, onSending = () => {} }) {
  if (user?.planKey !== 'matchday' || user.hasActivePlanAccess !== true || !user.activeTeamId || !isParentPortalInviteEligiblePlayer(player)) return {}
  if (!getFeatureAccess({ ...user, teamId: user.activeTeamId }, CAPABILITIES.parentInvitations).allowed) return {}
  const previousEmails = new Set((previousPlayer?.parentContacts || []).map(contact => normalizeParentPortalInviteEmail(contact.email)))
  const results = {}
  for (const contact of player.parentContacts || []) {
    const email = normalizeParentPortalInviteEmail(contact.email)
    if (!email || previousEmails.has(email) || results[email] || (contact.type || player.contactType || 'parent') !== 'parent') continue
    onSending(email)
    try {
      const result = await sendInvite(user, player.id, { ...contact, email })
      results[email] = { status: result?.alreadyLinked ? 'accepted' : 'sent', confirmedByServer: true }
    } catch {
      results[email] = { status: 'failed', message: 'Use the send button to try again.' }
    }
  }
  onSending('')
  return results
}
