export function normalizePlatformClubRow(row) {
  return {
    id: row.id,
    name: String(row.name ?? '').trim() || 'Unnamed club',
    contactEmail: String(row.contact_email ?? '').trim(),
    contactPhone: String(row.contact_phone ?? '').trim(),
    planKey: String(row.plan_key ?? 'small_club').trim() || 'small_club',
    planStatus: String(row.plan_status ?? 'active').trim() || 'active',
    isPlanComped: Boolean(row.is_plan_comped ?? false),
    stripeCustomerId: String(row.stripe_customer_id ?? '').trim(),
    stripeSubscriptionId: String(row.stripe_subscription_id ?? '').trim(),
    stripePriceId: String(row.stripe_price_id ?? '').trim(),
    currentPeriodEnd: row.current_period_end ?? '',
    planUpdatedAt: row.plan_updated_at ?? '',
    status: String(row.status ?? 'active').trim() || 'active',
    suspendedAt: row.suspended_at ?? '',
    createdAt: row.created_at ?? '',
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function normalizeNumber(value) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

export function normalizePlatformStatsPayload(stats) {
  const sourceStats = stats && typeof stats === 'object' ? stats : {}
  const sourceTotals = sourceStats.totals && typeof sourceStats.totals === 'object' ? sourceStats.totals : {}
  const platformAdmins = normalizeArray(sourceStats.platformAdmins)
    .filter((admin) => String(admin.id ?? '').trim())
    .map((admin) => ({
      ...admin,
      id: String(admin.id ?? '').trim(),
      email: String(admin.email ?? '').trim(),
      name: String(admin.name ?? '').trim(),
      role: String(admin.role ?? 'super_admin').trim() || 'super_admin',
      roleLabel: String(admin.roleLabel ?? 'Super Admin').trim() || 'Super Admin',
      roleRank: normalizeNumber(admin.roleRank ?? 100),
      status: String(admin.status ?? 'active').trim() || 'active',
      suspendedAt: admin.suspendedAt ?? '',
    }))
  const clubs = normalizeArray(sourceStats.clubs)
    .filter((club) => String(club.id ?? '').trim())
    .map((club) => ({
      ...club,
      id: String(club.id ?? '').trim(),
      name: String(club.name ?? '').trim() || 'Unnamed club',
      contactEmail: String(club.contactEmail ?? '').trim(),
      contactPhone: String(club.contactPhone ?? '').trim(),
      planKey: String(club.planKey ?? 'small_club').trim() || 'small_club',
      planStatus: String(club.planStatus ?? 'active').trim() || 'active',
      isPlanComped: Boolean(club.isPlanComped),
      status: String(club.status ?? 'active').trim() || 'active',
      suspendedAt: club.suspendedAt ?? '',
      createdAt: club.createdAt ?? '',
      latestActivityAt: club.latestActivityAt ?? '',
      userCount: normalizeNumber(club.userCount),
      teamCount: normalizeNumber(club.teamCount),
      playerCount: normalizeNumber(club.playerCount),
      archivedPlayerCount: normalizeNumber(club.archivedPlayerCount),
      evaluationCount: normalizeNumber(club.evaluationCount),
      communicationCount: normalizeNumber(club.communicationCount),
      communicationRowCount: normalizeNumber(club.communicationRowCount),
      recentEvaluationCount: normalizeNumber(club.recentEvaluationCount),
      recentCommunicationCount: normalizeNumber(club.recentCommunicationCount),
      submittedCount: normalizeNumber(club.submittedCount),
      approvedCount: normalizeNumber(club.approvedCount),
      rejectedCount: normalizeNumber(club.rejectedCount),
      trialCount: normalizeNumber(club.trialCount),
      squadCount: normalizeNumber(club.squadCount),
      trialPlayerCount: normalizeNumber(club.trialPlayerCount),
      squadPlayerCount: normalizeNumber(club.squadPlayerCount),
      promotedPlayerCount: normalizeNumber(club.promotedPlayerCount),
      users: normalizeArray(club.users)
        .filter((member) => String(member.id ?? '').trim())
        .map((member) => ({
          ...member,
          id: String(member.id ?? '').trim(),
          email: String(member.email ?? '').trim(),
          name: String(member.name ?? '').trim(),
          role: String(member.role ?? '').trim(),
          roleLabel: String(member.roleLabel ?? '').trim() || 'User',
          roleRank: normalizeNumber(member.roleRank),
          status: String(member.status ?? 'active').trim() || 'active',
          suspendedAt: member.suspendedAt ?? '',
        })),
      teams: normalizeArray(club.teams)
        .filter((team) => String(team.id ?? '').trim())
        .map((team) => ({
          ...team,
          id: String(team.id ?? '').trim(),
          name: String(team.name ?? '').trim() || 'Unnamed team',
        })),
      roleCounts: normalizeArray(club.roleCounts)
        .filter((role) => String(role.label ?? '').trim())
        .map((role) => ({
          label: String(role.label ?? '').trim(),
          count: normalizeNumber(role.count),
        })),
    }))

  return {
    totals: {
      clubs: normalizeNumber(sourceTotals.clubs),
      users: normalizeNumber(sourceTotals.users),
      clubUsers: normalizeNumber(sourceTotals.clubUsers),
      platformAdmins: normalizeNumber(sourceTotals.platformAdmins),
      teams: normalizeNumber(sourceTotals.teams),
      players: normalizeNumber(sourceTotals.players),
      playerRecords: normalizeNumber(sourceTotals.playerRecords),
      archivedPlayers: normalizeNumber(sourceTotals.archivedPlayers),
      evaluations: normalizeNumber(sourceTotals.evaluations),
      communications: normalizeNumber(sourceTotals.communications),
      communicationRows: normalizeNumber(sourceTotals.communicationRows),
      auditEvents: normalizeNumber(sourceTotals.auditEvents),
      recentEvaluations: normalizeNumber(sourceTotals.recentEvaluations),
      recentCommunications: normalizeNumber(sourceTotals.recentCommunications),
    },
    platformAdmins,
    clubs,
  }
}

export function logPlatformStatsDiagnostic(reason, details = {}) {
  console.warn('[platform-stats]', {
    reason,
    invalidClubRows: normalizeNumber(details.invalidClubRows),
    invalidAdminRows: normalizeNumber(details.invalidAdminRows),
    source: String(details.source ?? 'unknown'),
  })
}
