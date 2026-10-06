import { resolveEligibleEventInvitationContacts } from './_match-day-actionable-invitation.js'
import { getParentCommunicationChannels, allowsParentEmail, allowsParentAppNotifications } from './_parent-communication-preferences.js'

// The existing eligibility RPC remains the authority for active event contacts.
// Existing channel preferences are reused; a query failure never opts someone in.
// This resolves targets only. It neither queues nor sends any communication.
export async function resolveCoachAvailabilityReminderRecipients(client, { clubId, teamId, playerId }) {
  const contacts = await resolveEligibleEventInvitationContacts(client, { clubId, teamId, playerIds: [playerId] })
  const linkIds = [...new Set(contacts.map(contact => contact.parentLinkId).filter(Boolean))]
  let links = []
  if (linkIds.length) {
    const result = await client.from('parent_player_links').select('id,auth_user_id,player_id').eq('club_id',clubId).eq('status','active').in('id',linkIds)
    if (result.error) throw result.error
    links = result.data || []
  }
  const channels = await getParentCommunicationChannels(client, links.map(link => link.auth_user_id))
  return contacts.flatMap(contact => {
    const link = links.find(item => item.id === contact.parentLinkId && item.player_id === playerId)
    if (contact.type === 'parent' && !link) return []
    const channel = channels.get(link?.auth_user_id) || 'both'
    return [{ id: JSON.stringify([contact.parentLinkId || '', contact.email]), clubId, teamId, playerId,
      audience: 'availability', active: true, authorized: true, notificationsEnabled: true,
      communicationChannel: channel, emailAllowed: allowsParentEmail(channel), appAllowed: allowsParentAppNotifications(channel),
      parentLinkId: contact.parentLinkId, email: contact.email, recipientType: contact.type }]
  })
}
