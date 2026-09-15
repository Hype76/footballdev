// An app link selects a screen only. The server still authorises every invitation.
export function parseFanAppLink(value) {
  if (typeof value !== 'string' || value.length > 512) return null
  const match = /^footballplayerparents:\/\/(fans|fan-invite\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))\/?$/.exec(value)
  if (!match) return null
  return match[1] === 'fans' ? { kind: 'fans' } : { kind: 'invite', token: match[2] }
}
