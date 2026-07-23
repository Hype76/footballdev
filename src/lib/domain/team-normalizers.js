export function normalizeTeamRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    name: String(row.name ?? '').trim(),
    ageGroup: String(row.age_group ?? row.ageGroup ?? '').trim(),
    requireApproval: Boolean(row.require_approval ?? row.requireApproval ?? true),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    themeMode: String(row.theme_mode ?? row.themeMode ?? '').trim(),
    themeAccent: String(row.theme_accent ?? row.themeAccent ?? '').trim(),
    themeButtonStyle: String(row.theme_button_style ?? row.themeButtonStyle ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

export function normalizeTeamStaffRow(row) {
  return {
    id: row.id,
    teamId: row.team_id ?? row.teamId ?? '',
    userId: row.user_id ?? row.userId ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}
