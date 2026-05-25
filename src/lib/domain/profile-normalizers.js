import {
  getClubName,
  getClubValue,
  getDisplayName,
  getLegacyRoleDefaults,
  isPastDate,
  normalizeRoleKey,
  normalizeRoleLabel,
  normalizeRoleRank,
  normalizeWords,
} from './core-normalizers.js'

export function getSignupClubName(authUser) {
  const metadataClubName = String(
    authUser?.user_metadata?.club_name ??
      authUser?.user_metadata?.clubName ??
      authUser?.raw_user_meta_data?.club_name ??
      authUser?.raw_user_meta_data?.clubName ??
      '',
  ).trim()

  if (metadataClubName) {
    return metadataClubName
  }

  const emailDomain = String(authUser?.email ?? '').split('@')[1] ?? ''
  const domainName = emailDomain.split('.')[0] ?? ''
  const fallbackName = normalizeWords(domainName.replace(/[-_]+/g, ' '))

  return fallbackName || 'My Club'
}

export function normalizeClubMembershipRow(row) {
  const clubRow = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs
  const roleKey = normalizeRoleKey(row.role ?? row.roleKey)

  return {
    id: row.id,
    authUserId: row.auth_user_id ?? row.authUserId ?? '',
    email: String(row.email ?? '').trim().toLowerCase(),
    username: String(row.username ?? '').trim(),
    name: String(row.name ?? '').trim(),
    role: roleKey,
    roleLabel: normalizeRoleLabel(row.role_label ?? row.roleLabel, roleKey),
    roleRank: normalizeRoleRank(row.role_rank ?? row.roleRank, roleKey),
    clubId: row.club_id ?? row.clubId ?? '',
    clubName: String(clubRow?.name ?? row.clubName ?? '').trim(),
    clubLogoUrl: String(clubRow?.logo_url ?? row.clubLogoUrl ?? '').trim(),
    clubContactEmail: String(clubRow?.contact_email ?? row.clubContactEmail ?? '').trim(),
    clubContactPhone: String(clubRow?.contact_phone ?? row.clubContactPhone ?? '').trim(),
    clubStatus: String(clubRow?.status ?? row.clubStatus ?? 'active').trim() || 'active',
    clubSuspendedAt: clubRow?.suspended_at ?? row.clubSuspendedAt ?? '',
    planKey: String(clubRow?.plan_key ?? row.planKey ?? 'small_club').trim() || 'small_club',
    planStatus: String(clubRow?.plan_status ?? row.planStatus ?? 'active').trim() || 'active',
    isPlanComped: Boolean(clubRow?.is_plan_comped ?? row.isPlanComped ?? false),
    requireApproval: Boolean(clubRow?.require_approval ?? row.requireApproval ?? true),
    userOnboardingEnabled: Boolean(row.onboarding_enabled ?? row.userOnboardingEnabled ?? true),
    userOnboardingCompletedSteps: Array.isArray(row.onboarding_completed_steps) ? row.onboarding_completed_steps : [],
    userOnboardingDismissedAt: row.onboarding_dismissed_at ?? row.userOnboardingDismissedAt ?? '',
    userOnboardingResetAt: row.onboarding_reset_at ?? row.userOnboardingResetAt ?? '',
    workspaceOnboardingEnabled: Boolean(clubRow?.onboarding_enabled ?? row.workspaceOnboardingEnabled ?? true),
    workspaceOnboardingCompletedSteps: Array.isArray(clubRow?.onboarding_completed_steps)
      ? clubRow.onboarding_completed_steps
      : [],
    workspaceOnboardingDismissedAt: clubRow?.onboarding_dismissed_at ?? row.workspaceOnboardingDismissedAt ?? '',
    workspaceOnboardingResetAt: clubRow?.onboarding_reset_at ?? row.workspaceOnboardingResetAt ?? '',
  }
}

export function normalizeUserProfile(profile) {
  const baseRole = getLegacyRoleDefaults(profile.role)
  const roleKey = normalizeRoleKey(profile.role ?? baseRole.key)
  const roleLabel = normalizeRoleLabel(profile.role_label ?? profile.roleLabel, roleKey)
  const roleRank = normalizeRoleRank(profile.role_rank ?? profile.roleRank, roleKey)
  const clubName =
    getClubName(profile.clubs) ||
    String(profile.team ?? '').trim() ||
    (roleKey === 'super_admin' ? 'Platform' : 'Unassigned Club')
  const testerAccessExpiresAt = getClubValue(profile.clubs, 'tester_access_expires_at') ?? profile.testerAccessExpiresAt ?? ''
  const testerAccessExpired = isPastDate(testerAccessExpiresAt)
  const isPlanComped = Boolean(getClubValue(profile.clubs, 'is_plan_comped') ?? profile.isPlanComped ?? false)

  return {
    id: profile.id,
    email: String(profile.email ?? '').trim().toLowerCase(),
    username: String(profile.username ?? '').trim(),
    name: getDisplayName(profile),
    displayName: String(profile.display_name ?? profile.displayName ?? profile.username ?? profile.name ?? '').trim(),
    emailTeamName: String(profile.team_name ?? profile.teamName ?? '').trim(),
    emailClubName: String(profile.club_name ?? profile.emailClubName ?? '').trim(),
    replyToEmail: String(profile.reply_to_email ?? profile.replyToEmail ?? '').trim().toLowerCase(),
    role: roleKey,
    roleLabel,
    roleRank,
    accountStatus: String(profile.status ?? profile.accountStatus ?? 'active').trim() || 'active',
    accountSuspendedAt: profile.suspended_at ?? profile.accountSuspendedAt ?? '',
    clubId: profile.club_id ?? profile.clubId ?? '',
    clubName,
    team: clubName,
    clubLogoUrl: String(getClubValue(profile.clubs, 'logo_url') ?? profile.clubLogoUrl ?? '').trim(),
    clubContactEmail: String(getClubValue(profile.clubs, 'contact_email') ?? profile.clubContactEmail ?? '').trim(),
    clubContactPhone: String(getClubValue(profile.clubs, 'contact_phone') ?? profile.clubContactPhone ?? '').trim(),
    clubStatus: String(getClubValue(profile.clubs, 'status') ?? profile.clubStatus ?? 'active').trim() || 'active',
    clubSuspendedAt: getClubValue(profile.clubs, 'suspended_at') ?? profile.clubSuspendedAt ?? '',
    planKey: String(getClubValue(profile.clubs, 'plan_key') ?? profile.planKey ?? 'small_club').trim() || 'small_club',
    planStatus: String(getClubValue(profile.clubs, 'plan_status') ?? profile.planStatus ?? 'active').trim() || 'active',
    isPlanComped: testerAccessExpired ? false : isPlanComped,
    stripeCustomerId: String(getClubValue(profile.clubs, 'stripe_customer_id') ?? profile.stripeCustomerId ?? '').trim(),
    stripeSubscriptionId: String(getClubValue(profile.clubs, 'stripe_subscription_id') ?? profile.stripeSubscriptionId ?? '').trim(),
    stripePriceId: String(getClubValue(profile.clubs, 'stripe_price_id') ?? profile.stripePriceId ?? '').trim(),
    currentPeriodEnd: getClubValue(profile.clubs, 'current_period_end') ?? profile.currentPeriodEnd ?? '',
    planUpdatedAt: getClubValue(profile.clubs, 'plan_updated_at') ?? profile.planUpdatedAt ?? '',
    testerAccessCodeId: getClubValue(profile.clubs, 'tester_access_code_id') ?? profile.testerAccessCodeId ?? '',
    testerAccessCode: String(getClubValue(profile.clubs, 'tester_access_code') ?? profile.testerAccessCode ?? '').trim(),
    testerAccessEmail: String(getClubValue(profile.clubs, 'tester_access_email') ?? profile.testerAccessEmail ?? '').trim(),
    testerAccessRedeemedAt: getClubValue(profile.clubs, 'tester_access_redeemed_at') ?? profile.testerAccessRedeemedAt ?? '',
    testerAccessExpiresAt,
    testerAccessExpired,
    requireApproval: Boolean(getClubValue(profile.clubs, 'require_approval') ?? profile.requireApproval ?? true),
    userOnboardingEnabled: Boolean(profile.onboarding_enabled ?? profile.userOnboardingEnabled ?? true),
    userOnboardingCompletedSteps: Array.isArray(profile.onboarding_completed_steps) ? profile.onboarding_completed_steps : [],
    userOnboardingDismissedAt: profile.onboarding_dismissed_at ?? profile.userOnboardingDismissedAt ?? '',
    userOnboardingResetAt: profile.onboarding_reset_at ?? profile.userOnboardingResetAt ?? '',
    workspaceOnboardingEnabled: Boolean(getClubValue(profile.clubs, 'onboarding_enabled') ?? profile.workspaceOnboardingEnabled ?? true),
    workspaceOnboardingCompletedSteps: Array.isArray(getClubValue(profile.clubs, 'onboarding_completed_steps'))
      ? getClubValue(profile.clubs, 'onboarding_completed_steps')
      : [],
    workspaceOnboardingDismissedAt: getClubValue(profile.clubs, 'onboarding_dismissed_at') ?? profile.workspaceOnboardingDismissedAt ?? '',
    workspaceOnboardingResetAt: getClubValue(profile.clubs, 'onboarding_reset_at') ?? profile.workspaceOnboardingResetAt ?? '',
    themeMode: String(profile.theme_mode ?? profile.themeMode ?? '').trim(),
    themeAccent: String(profile.theme_accent ?? profile.themeAccent ?? '').trim(),
    themeButtonStyle: String(profile.theme_button_style ?? profile.themeButtonStyle ?? '').trim(),
    activeTeamId: String(profile.activeTeamId ?? '').trim(),
    activeTeamName: String(profile.activeTeamName ?? '').trim(),
    clubOptions: Array.isArray(profile.clubOptions) ? profile.clubOptions : [],
  }
}
