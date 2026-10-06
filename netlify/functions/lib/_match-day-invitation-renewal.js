const text = value => String(value ?? '').trim()
const email = value => text(value).toLowerCase()

// Contacts must come from the current server-authoritative eligible-recipient RPC.
// A resend renews event participation only, never a withdrawn account/contact grant.
export function isMatchDayParticipationRenewal(request, contact) {
  return Boolean(request?.id && request.channel === 'email' && request.token_revoked_at && email(contact?.email)
    && ['parent', 'player'].includes(text(contact?.type))
    && request.token_revoked_reason === 'event_participation_removed'
    && email(request.recipient_email) === email(contact?.email)
    && text(request.recipient_type) === text(contact?.type)
    && text(request.parent_link_id) === text(contact?.parentLinkId))
}

export function hasMatchDayParticipationRenewal(action, requests = [], contacts = []) {
  return action === 'resend' && contacts.some(contact => {
    const matching = requests.filter(request => request.channel === 'email' && email(request.recipient_email) === email(contact.email)
      && text(request.recipient_type) === text(contact.type))
    return matching.length === 1 && isMatchDayParticipationRenewal(matching[0], contact)
  })
}
