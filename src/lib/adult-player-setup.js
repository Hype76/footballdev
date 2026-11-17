export function getAdultPlayerSetupEmail(player) {
  if (player?.contactType !== 'self') return ''
  const emails = new Set((player.parentContacts || [])
    .filter(contact => contact.type === 'self')
    .map(contact => String(contact.email ?? '').trim().toLowerCase())
    .filter(email => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))
  return emails.size === 1 ? [...emails][0] : ''
}

export function isAdultPlayerBirthDate(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const birth = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== value) return false
  const age = today.getFullYear() - birth.getUTCFullYear()
  // PostgreSQL subtracts 18 calendar years from today, so 29 February matures on 1 March in a non-leap year.
  const birthdayPassed = today.getMonth() > birth.getUTCMonth()
    || (today.getMonth() === birth.getUTCMonth() && today.getDate() >= birth.getUTCDate())
  return age > 18 || (age === 18 && birthdayPassed)
}
export function adultPlayerLinkStatusLabel(state) {
  return ({
    linked: 'Player account linked',
    awaiting_acceptance: 'Invitation sent. Delivery is unconfirmed; waiting for the player to accept.',
    delivered: 'Invitation delivered. Waiting for the player to accept.',
    delivery_unknown: 'An invitation was previously sent, but delivery cannot be confirmed. Ask the player to check their email or contact support.',
    delivery_failed: 'Invitation could not be delivered. Check the Player email in their profile. If it is correct, contact support.',
    expired: 'Invitation expired. Save the player to send a new invitation.',
    previous_invite_used: 'The previous invitation was used, but no Player account is linked. Contact support for help.',
    not_invited: 'Player account not linked. Save the player to send an invitation.',
    parent_linked: 'Parent access is active. Review it before setting up separate Player access.',
    ineligible: 'Add one Player email and a date of birth confirming they are 18 or over.',
    unavailable: 'Player account status could not be checked. Refresh and try again.',
    loading: 'Checking Player account...',
  })[state] || 'Player account status could not be checked. Refresh and try again.'
}

export function canResendAdultPlayerSetupInvite(state) {
  return ['awaiting_acceptance', 'delivered', 'delivery_failed', 'delivery_unknown', 'expired', 'not_invited'].includes(state)
}
