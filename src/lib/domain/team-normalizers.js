export function normalizeTeamRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    name: String(row.name ?? '').trim(),
    notificationDisplayName: String(row.notification_display_name ?? row.notificationDisplayName ?? '').trim(),
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
    assignmentId: row.assignment_id ?? row.assignmentId ?? '',
    assignmentRole: String(row.assignment_role ?? row.assignmentRole ?? row.role_key ?? '').trim(),
    assignmentRoleLabel: String(row.assignment_role_label ?? row.assignmentRoleLabel ?? row.role_label ?? '').trim(),
    assignmentRoleRank: Number(row.assignment_role_rank ?? row.assignmentRoleRank ?? row.role_rank ?? 0),
  }
}

export function normalizeTeamStaffRow(row) {
  return {
    id: row.id,
    teamId: row.team_id ?? row.teamId ?? '',
    userId: row.user_id ?? row.userId ?? '',
    roleKey: String(row.role_key ?? row.roleKey ?? '').trim(),
    roleLabel: String(row.role_label ?? row.roleLabel ?? '').trim(),
    roleRank: Number(row.role_rank ?? row.roleRank ?? 0),
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}
