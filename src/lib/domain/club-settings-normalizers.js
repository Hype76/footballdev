import { normalizePlanKey } from '../plans.js'
import { normalizeThemeAccent } from '../theme.js'

export function normalizeClubSettingsRow(row) {
  return {
    id: row.id,
    name: String(row.name ?? '').trim(),
    logoUrl: String(row.logo_url ?? '').trim(),
    contactEmail: String(row.contact_email ?? '').trim(),
    contactPhone: String(row.contact_phone ?? '').trim(),
    requireApproval: Boolean(row.require_approval ?? true),
    themeAccent: normalizeThemeAccent(row.theme_accent ?? row.themeAccent),
    planKey: normalizePlanKey(row.plan_key, { mapMissingToFree: true }),
    planStatus: String(row.plan_status ?? 'active').trim() || 'active',
    isPlanComped: Boolean(row.is_plan_comped ?? false),
  }
}
