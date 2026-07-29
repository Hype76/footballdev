const CLUB_WIDE_ROLE_RANK = 50

export function normalizePdfText(value) {
  return String(value ?? '').trim()
}

export function pdfForbidden(code = 'PDF_SCOPE_DENIED') {
  throw Object.assign(new Error('This PDF report is not available.'), {
    code,
    statusCode: 403,
  })
}

export function pdfMissingResource() {
  throw Object.assign(new Error('This PDF report is not available.'), {
    code: 'PDF_REPORT_NOT_FOUND',
    statusCode: 404,
  })
}

export function assertPdfScope({
  profile,
  targetClubId,
  targetTeamId = '',
  teamExists = true,
  teamAssigned = false,
} = {}) {
  const actorId = normalizePdfText(profile?.id)
  const actorClubId = normalizePdfText(profile?.clubId)
  const actorRole = normalizePdfText(profile?.role)
  const actorRank = Number(profile?.roleRank ?? 0)
  const clubId = normalizePdfText(targetClubId)
  const teamId = normalizePdfText(targetTeamId)

  if (!actorId || !clubId) {
    pdfForbidden()
  }

  if (actorRole !== 'super_admin' && actorClubId !== clubId) {
    pdfForbidden('PDF_CROSS_CLUB_DENIED')
  }

  if (teamId && !teamExists) {
    pdfForbidden('PDF_CROSS_TEAM_DENIED')
  }

  if (actorRole === 'super_admin' || actorRank >= CLUB_WIDE_ROLE_RANK) {
    return true
  }

  if (!teamId || !teamAssigned) {
    pdfForbidden('PDF_CROSS_TEAM_DENIED')
  }

  return true
}

export async function loadAuthorisedPdfBrandingScope(supabaseAdmin, {
  profile,
  clubId,
  teamId = '',
} = {}) {
  const normalizedClubId = normalizePdfText(clubId)
  const normalizedTeamId = normalizePdfText(teamId)
  const { data: club, error: clubError } = await supabaseAdmin
    .from('clubs')
    .select('id, name, logo_url, theme_accent')
    .eq('id', normalizedClubId)
    .maybeSingle()

  if (clubError) {
    throw clubError
  }

  if (!club?.id) {
    pdfMissingResource()
  }

  if (!normalizedTeamId) {
    assertPdfScope({ profile, targetClubId: normalizedClubId })
    return {
      club,
      team: null,
      teamAssigned: false,
    }
  }

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, club_id, name')
    .eq('id', normalizedTeamId)
    .eq('club_id', normalizedClubId)
    .maybeSingle()

  if (teamError) {
    throw teamError
  }

  let teamAssigned = false

  if (
    team?.id &&
    normalizePdfText(profile?.role) !== 'super_admin' &&
    Number(profile?.roleRank ?? 0) < CLUB_WIDE_ROLE_RANK
  ) {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from('team_staff')
      .select('team_id')
      .eq('team_id', team.id)
      .eq('user_id', profile.id)
      .maybeSingle()

    if (assignmentError) {
      throw assignmentError
    }

    teamAssigned = Boolean(assignment?.team_id)
  }

  assertPdfScope({
    profile,
    targetClubId: normalizedClubId,
    targetTeamId: normalizedTeamId,
    teamExists: Boolean(team?.id),
    teamAssigned,
  })

  return {
    club,
    team,
    teamAssigned,
  }
}
