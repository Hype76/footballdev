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
