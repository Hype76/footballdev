function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

export async function enrichVolunteerEligibilityRecipients(adminSupabase, { eligibility = [], match } = {}) {
  const rows = Array.isArray(eligibility) ? eligibility : []
  const requestIds = [...new Set(rows.map((row) => normalizeText(row.request_id)).filter(Boolean))]
  if (!adminSupabase || !match?.id || requestIds.length === 0) return rows

  const { data: requests, error: requestError } = await adminSupabase
    .from('match_day_availability_requests')
    .select('id, player_id, player_name, parent_link_id, recipient_email, recipient_name')
    .eq('match_day_id', match.id)
    .eq('club_id', match.club_id)
    .in('id', requestIds)

  if (requestError) throw requestError

  const requestsById = new Map((requests || []).map((request) => [normalizeText(request.id), request]))
  const playerIds = [...new Set((requests || []).map((row) => normalizeText(row.player_id)).filter(Boolean))]
  const { data: links = [], error: linkError } = playerIds.length ? await adminSupabase
    .from('parent_player_links')
    .select('id, player_id, club_id, auth_user_id, guardian_id, email, status')
    .eq('club_id', match.club_id)
    .eq('status', 'active')
    .in('player_id', playerIds) : { data: [] }
  if (linkError) throw linkError
  const linksByRequest = new Map()
  for (const request of requests || []) {
    const candidates = (links || []).filter((link) => link.club_id === match.club_id
      && link.player_id === request.player_id && link.status === 'active'
      && (request.parent_link_id ? link.id === request.parent_link_id
        : normalizeEmail(request.recipient_email) && normalizeEmail(link.email) === normalizeEmail(request.recipient_email)))
    if (candidates.length === 1) linksByRequest.set(normalizeText(request.id), candidates[0])
  }
  const verifiedLinks = [...linksByRequest.values()]
  const authUserIds = [...new Set(verifiedLinks.map((link) => normalizeText(link.auth_user_id)).filter(Boolean))]
  const guardianIds = [...new Set(verifiedLinks.map((link) => normalizeText(link.guardian_id)).filter(Boolean))]
  let profilesById = new Map()
  let guardiansById = new Map()

  if (authUserIds.length > 0) {
    const { data: profiles, error: profileError } = await adminSupabase
      .from('users')
      .select('id, display_name, name, email')
      .in('id', authUserIds)

    if (profileError) throw profileError
    profilesById = new Map((profiles || []).map((profile) => [normalizeText(profile.id), profile]))
  }

  if (guardianIds.length > 0) {
    const { data: guardians, error } = await adminSupabase.from('guardians')
      .select('id, first_name, last_name, email').eq('club_id', match.club_id).eq('status', 'active').in('id', guardianIds)
    if (error) throw error
    guardiansById = new Map((guardians || []).map((guardian) => [normalizeText(guardian.id), guardian]))
  }

  return rows.map((row) => {
    const request = requestsById.get(normalizeText(row.request_id)) || {}
    const link = linksByRequest.get(normalizeText(row.request_id)) || {}
    const profile = profilesById.get(normalizeText(link.auth_user_id)) || {}
    const guardian = guardiansById.get(normalizeText(link.guardian_id)) || {}
    const recipientEmail = normalizeEmail(guardian.email || profile.email || request.recipient_email || link.email)
    const guardianName = [guardian.first_name, guardian.last_name].map(normalizeText).filter(Boolean).join(' ')
    const recipientName = normalizeText(guardianName || profile.display_name || profile.name || request.recipient_name || recipientEmail
      || (request.player_name ? `Parent or guardian of ${request.player_name}` : ''))
    // Display enrichment must not change scorer eligibility or assignment authority.
    return { ...row, recipient_email: recipientEmail, recipient_name: recipientName }
  })
}
