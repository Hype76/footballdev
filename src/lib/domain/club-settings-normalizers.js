export function normalizeClubSettingsRow(row) {
  return {
    id: row.id,
    name: String(row.name ?? '').trim(),
    logoUrl: String(row.logo_url ?? '').trim(),
    contactEmail: String(row.contact_email ?? '').trim(),
    contactPhone: String(row.contact_phone ?? '').trim(),
    requireApproval: Boolean(row.require_approval ?? true),
    planKey: String(row.plan_key ?? 'small_club').trim() || 'small_club',
    planStatus: String(row.plan_status ?? 'active').trim() || 'active',
    isPlanComped: Boolean(row.is_plan_comped ?? false),
  }
}
