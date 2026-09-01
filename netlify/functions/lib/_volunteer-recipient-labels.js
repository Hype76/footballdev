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
    .select('id, recipient_email, recipient_name')
    .eq('match_day_id', match.id)
    .eq('club_id', match.club_id)
    .in('id', requestIds)

  if (requestError) throw requestError

  const requestsById = new Map((requests || []).map((request) => [normalizeText(request.id), request]))
  const authUserIds = [...new Set(rows.map((row) => normalizeText(row.auth_user_id)).filter(Boolean))]
  let profilesById = new Map()

  if (authUserIds.length > 0) {
    const { data: profiles, error: profileError } = await adminSupabase
      .from('users')
      .select('id, display_name, name, email')
      .eq('club_id', match.club_id)
      .in('id', authUserIds)

    if (profileError) throw profileError
    profilesById = new Map((profiles || []).map((profile) => [normalizeText(profile.id), profile]))
  }

  return rows.map((row) => {
    const request = requestsById.get(normalizeText(row.request_id)) || {}
    const profile = profilesById.get(normalizeText(row.auth_user_id)) || {}
    const recipientEmail = normalizeEmail(request.recipient_email || profile.email)
    const recipientName = normalizeText(request.recipient_name || profile.display_name || profile.name || recipientEmail)
    return { ...row, recipient_email: recipientEmail, recipient_name: recipientName }
  })
}
