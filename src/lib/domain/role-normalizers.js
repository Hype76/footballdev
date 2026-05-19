import {
  normalizeRoleKey,
  normalizeRoleLabel,
  normalizeRoleRank,
} from './core-normalizers.js'

export function normalizeClubRoleRow(row) {
  const roleKey = normalizeRoleKey(row.role_key ?? row.roleKey)

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    roleKey,
    roleLabel: normalizeRoleLabel(row.role_label ?? row.roleLabel, roleKey),
    roleRank: normalizeRoleRank(row.role_rank ?? row.roleRank, roleKey),
    isSystem: Boolean(row.is_system ?? row.isSystem),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

export function normalizeClubInviteRow(row) {
  const roleKey = normalizeRoleKey(row.role_key ?? row.roleKey)

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    email: String(row.email ?? '').trim().toLowerCase(),
    roleKey,
    roleLabel: normalizeRoleLabel(row.role_label ?? row.roleLabel, roleKey),
    roleRank: normalizeRoleRank(row.role_rank ?? row.roleRank, roleKey),
    teamId: row.team_id ?? row.teamId ?? '',
    inviteToken: row.invite_token ?? row.inviteToken ?? '',
    expiresAt: row.expires_at ?? row.expiresAt ?? '',
    inviteSentAt: row.invite_sent_at ?? row.inviteSentAt ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}
