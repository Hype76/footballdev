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
