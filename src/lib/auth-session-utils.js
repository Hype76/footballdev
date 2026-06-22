import { getMainAppOrigin } from './app-origins.js'
import { normalizePlanKey } from './plans.js'

export function getPasswordResetRedirectUrl() {
  return `${getMainAppOrigin()}/reset-password`
}

export async function claimStripeCheckoutForProfile(session, profile) {
  if (!session?.access_token || !profile?.clubId) {
    return profile
  }

  if (typeof window !== 'undefined') {
    const paymentsDisabled = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
    const searchParams = new URLSearchParams(window.location.search)
    const hasCheckoutReturn = searchParams.get('checkout') === 'success' || searchParams.has('session_id')

    if (paymentsDisabled && !hasCheckoutReturn) {
      return profile
    }

    const hostname = window.location.hostname
    const port = window.location.port
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

    if (isLoopback && port !== '8888') {
      return profile
    }
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
      planKey: normalizePlanKey(result.club.planKey ?? profile.planKey, { mapMissingToFree: true }),
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
    String(leftUser.themeButtonStyle ?? '') === String(rightUser.themeButtonStyle ?? '') &&
    String(leftUser.activeTeamId ?? '') === String(rightUser.activeTeamId ?? '') &&
    String(leftUser.activeTeamName ?? '') === String(rightUser.activeTeamName ?? '')
  )
}
