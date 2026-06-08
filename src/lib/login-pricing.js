export const pricingPlans = [
  {
    name: 'Individual',
    price: 'Free',
    priceLabel: 'No card needed',
    displayName: 'Individual Coach',
    description: 'For one coach testing the workflow with a small squad.',
    features: ['1 team', '1 staff login', '5 players', 'Basic development records', 'Family portal'],
  },
  {
    name: 'Single Team',
    price: 9.99,
    description: 'For one football group that needs records and parent updates.',
    features: ['Everything in Individual Coach', '3 staff logins', '20 players', 'Parent email sending', 'PDF reports and attachments', 'Basic logo branding'],
  },
  {
    name: 'Small Club',
    price: 24.99,
    description: 'For clubs running several teams with staff access and oversight.',
    features: ['Everything in Single Team', 'Up to 10 teams', 'Unlimited staff logins', 'Unlimited players', 'Custom branding and themes', 'Staff roles with coach access', 'Audit logs'],
  },
  {
    name: 'Large Club',
    price: 'Contact us',
    description: 'For larger clubs that need more teams, rollout help, or custom support.',
    features: ['Everything in Small Club', 'More than 10 teams', 'Custom setup', 'Custom rollout support', 'Club-wide staff setup', 'Priority support', 'Custom limits agreed with you'],
  },
]

export function formatPrice(plan, billingCycle) {
  if (typeof plan.price !== 'number') {
    return plan.price
  }

  const price = billingCycle === 'annual' ? plan.price * 10 : plan.price
  return `\u00a3${price.toFixed(2)}`
}

export function formatPriceLabel(plan, billingCycle) {
  if (plan.priceLabel) {
    return plan.priceLabel
  }

  if (plan.price === 'Contact us') {
    return ''
  }

  if (typeof plan.price !== 'number') {
    return 'No card needed'
  }

  return billingCycle === 'annual' ? 'per year' : 'per month'
}

function formatPromotionDiscount(promotion) {
  if (!promotion) {
    return ''
  }

  if (promotion.percentOff) {
    return `${promotion.percentOff}% off`
  }

  if (promotion.amountOff) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: promotion.currency || 'GBP',
    }).format(Number(promotion.amountOff) / 100)
  }

  return ''
}

function formatPromotionDuration(promotion) {
  if (!promotion) {
    return ''
  }

  if (promotion.duration === 'forever') {
    return 'forever'
  }

  if (promotion.duration === 'repeating') {
    const months = Number(promotion.durationInMonths ?? 0)
    return months === 1 ? 'for 1 month' : `for ${months || 1} months`
  }

  return 'once'
}

export function getPromotionSummary(promotion) {
  const discount = formatPromotionDiscount(promotion)
  const duration = formatPromotionDuration(promotion)

  if (!discount) {
    return ''
  }

  return [discount, duration, promotion?.firstTimeOnly ? 'first purchase only' : ''].filter(Boolean).join(' | ')
}
