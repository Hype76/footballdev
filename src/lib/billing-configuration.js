import { validateBillingArrangement } from './billing-date.js'

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeArrangement(value, isPlanComped = false) {
  return String(value ?? '').trim().toLowerCase() || (isPlanComped ? 'complimentary' : 'immediate')
}

export function resolveBillingConfigurationUpdate({ request = {}, currentClub = {}, planKey = '', now = new Date() }) {
  const hasRequestedBillingArrangement = hasOwn(request, 'billingArrangement')
  const hasRequestedBillingStartDate = hasOwn(request, 'billingStartDate')
  const hasRequestedIsPlanComped = hasOwn(request, 'isPlanComped')
  const currentArrangement = normalizeArrangement(
    currentClub.billing_arrangement ?? currentClub.billingArrangement,
    Boolean(currentClub.is_plan_comped ?? currentClub.isPlanComped),
  )
  const requestedArrangement = hasRequestedBillingArrangement
    ? request.billingArrangement
    : hasRequestedIsPlanComped
      ? (request.isPlanComped ? 'complimentary' : 'immediate')
      : currentArrangement
  const normalizedRequestedArrangement = normalizeArrangement(requestedArrangement)
  const isSwitchingToDeferred = hasRequestedBillingArrangement
    && normalizedRequestedArrangement === 'deferred'
    && currentArrangement !== 'deferred'
  const currentBillingStartDate = String(
    currentClub.billing_start_at ?? currentClub.billingStartAt ?? '',
  ).slice(0, 10)

  return validateBillingArrangement({
    arrangement: requestedArrangement,
    startDate: hasRequestedBillingStartDate
      ? request.billingStartDate
      : isSwitchingToDeferred
        ? ''
        : currentBillingStartDate,
    now,
    planKey,
  })
}
