const PRODUCTION_APP_ORIGIN = 'https://playerfeedback.online'

export function getPasswordResetRedirectUrl() {
  const configuredOrigin = String(import.meta.env.VITE_APP_URL ?? import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim()
  const currentOrigin = window.location.origin
  const resolvedOrigin = configuredOrigin || (window.location.hostname === 'localhost' ? PRODUCTION_APP_ORIGIN : currentOrigin)

  return `${resolvedOrigin.replace(/\/$/, '')}/reset-password`
}

export async function claimStripeCheckoutForProfile(session, profile) {
  if (!session?.access_token || !profile?.clubId) {
    return profile
  }

  try {
    const response = await fetch('/.netlify/functions/claim-stripe-checkout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clubId: profile.clubId }),
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok || result.success === false || !result.claimed || !result.club) {
      return profile
    }

    return {
      ...profile,
      planKey: String(result.club.planKey ?? profile.planKey ?? 'small_club').trim(),
      planStatus: String(result.club.planStatus ?? profile.planStatus ?? 'active').trim(),
      isPlanComped: Boolean(result.club.isPlanComped ?? profile.isPlanComped ?? false),
      role: result.user?.role ?? profile.role,
      roleLabel: result.user?.roleLabel ?? profile.roleLabel,
      roleRank: Number(result.user?.roleRank ?? profile.roleRank ?? 0),
    }
  } catch (error) {
    console.error(error)
    return profile
  }
}

export function areUsersEquivalent(leftUser, rightUser) {
  if (!leftUser || !rightUser) {
    return false
  }

  return (
    String(leftUser.id ?? '') === String(rightUser.id ?? '') &&
    String(leftUser.email ?? '') === String(rightUser.email ?? '') &&
    String(leftUser.username ?? '') === String(rightUser.username ?? '') &&
    String(leftUser.name ?? '') === String(rightUser.name ?? '') &&
    String(leftUser.displayName ?? '') === String(rightUser.displayName ?? '') &&
    String(leftUser.emailTeamName ?? '') === String(rightUser.emailTeamName ?? '') &&
    String(leftUser.emailClubName ?? '') === String(rightUser.emailClubName ?? '') &&
    String(leftUser.replyToEmail ?? '') === String(rightUser.replyToEmail ?? '') &&
    String(leftUser.role ?? '') === String(rightUser.role ?? '') &&
    String(leftUser.roleLabel ?? '') === String(rightUser.roleLabel ?? '') &&
    Number(leftUser.roleRank ?? 0) === Number(rightUser.roleRank ?? 0) &&
    String(leftUser.accountStatus ?? '') === String(rightUser.accountStatus ?? '') &&
    String(leftUser.accountSuspendedAt ?? '') === String(rightUser.accountSuspendedAt ?? '') &&
    String(leftUser.clubId ?? '') === String(rightUser.clubId ?? '') &&
    String(leftUser.clubName ?? '') === String(rightUser.clubName ?? '') &&
    String(leftUser.team ?? '') === String(rightUser.team ?? '') &&
    String(leftUser.clubLogoUrl ?? '') === String(rightUser.clubLogoUrl ?? '') &&
    String(leftUser.clubContactEmail ?? '') === String(rightUser.clubContactEmail ?? '') &&
    String(leftUser.clubContactPhone ?? '') === String(rightUser.clubContactPhone ?? '') &&
    String(leftUser.clubStatus ?? '') === String(rightUser.clubStatus ?? '') &&
    String(leftUser.clubSuspendedAt ?? '') === String(rightUser.clubSuspendedAt ?? '') &&
    String(leftUser.planKey ?? '') === String(rightUser.planKey ?? '') &&
    String(leftUser.planStatus ?? '') === String(rightUser.planStatus ?? '') &&
    Boolean(leftUser.isPlanComped) === Boolean(rightUser.isPlanComped) &&
    String(leftUser.stripeCustomerId ?? '') === String(rightUser.stripeCustomerId ?? '') &&
    String(leftUser.stripeSubscriptionId ?? '') === String(rightUser.stripeSubscriptionId ?? '') &&
    String(leftUser.stripePriceId ?? '') === String(rightUser.stripePriceId ?? '') &&
    String(leftUser.currentPeriodEnd ?? '') === String(rightUser.currentPeriodEnd ?? '') &&
    String(leftUser.planUpdatedAt ?? '') === String(rightUser.planUpdatedAt ?? '') &&
    String(leftUser.testerAccessCodeId ?? '') === String(rightUser.testerAccessCodeId ?? '') &&
    String(leftUser.testerAccessCode ?? '') === String(rightUser.testerAccessCode ?? '') &&
    String(leftUser.testerAccessEmail ?? '') === String(rightUser.testerAccessEmail ?? '') &&
    String(leftUser.testerAccessRedeemedAt ?? '') === String(rightUser.testerAccessRedeemedAt ?? '') &&
    String(leftUser.testerAccessExpiresAt ?? '') === String(rightUser.testerAccessExpiresAt ?? '') &&
    Boolean(leftUser.testerAccessExpired) === Boolean(rightUser.testerAccessExpired) &&
    Boolean(leftUser.requireApproval) === Boolean(rightUser.requireApproval) &&
    String(leftUser.themeMode ?? '') === String(rightUser.themeMode ?? '') &&
    String(leftUser.themeAccent ?? '') === String(rightUser.themeAccent ?? '') &&
    String(leftUser.activeTeamId ?? '') === String(rightUser.activeTeamId ?? '') &&
    String(leftUser.activeTeamName ?? '') === String(rightUser.activeTeamName ?? '')
  )
}
