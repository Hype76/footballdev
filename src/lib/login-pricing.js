import { PLAN_KEYS, PLAN_PURCHASE_MODES } from './plans.js'

export const pricingPlans = [
  {
    planKey: PLAN_KEYS.individual,
    name: 'Individual Coach - Free',
    price: 'Free',
    priceLabel: 'No card needed',
    purchaseMode: PLAN_PURCHASE_MODES.free,
    description: 'For one coach testing basic player records with a small squad.',
    features: ['1 team', '1 staff login', 'Up to 5 players', 'Basic development records', 'Goals and notes', 'Limited history', 'Family portal preview only', 'Football Player branding'],
  },
  {
    planKey: PLAN_KEYS.singleTeam,
    name: 'Single Team',
    price: 12.99,
    purchaseMode: PLAN_PURCHASE_MODES.selfService,
    description: 'The complete Football Player product for one team.',
    features: ['1 team', 'Up to 5 staff', 'Up to 30 players', 'Full record history', 'Assessments, notes, and attachments', 'Parent portal, parent emails, and PDF reports', 'Parent communication history', 'Calendar, training events, fixtures, match day, and polls', 'Basic logo branding and activity visibility'],
  },
  {
    planKey: PLAN_KEYS.smallClub,
    name: 'Small Club',
    price: 34.99,
    purchaseMode: PLAN_PURCHASE_MODES.selfService,
    description: 'For clubs that need oversight across several teams.',
    features: ['Up to 5 teams', 'Club admin access', 'Club staff roles', 'Shared player oversight', 'Bulk invites and imports', 'Club-wide calendar and recurring events', 'Calendar export feed', 'Shared report templates', 'Custom colours and club branding', 'Full operational audit log', 'Basic club analytics'],
  },
  {
    planKey: PLAN_KEYS.developmentClub,
    name: 'Development Club',
    price: 59.99,
    purchaseMode: PLAN_PURCHASE_MODES.selfService,
    description: 'For clubs building mature development operations across teams.',
    features: ['Up to 10 teams', 'Advanced development analytics', 'Player pathways', 'Coach handovers', 'Scheduled review cycles', 'Approval workflows', 'Custom assessment and report templates', 'Club-wide operational exports', 'Scheduled parent reports', 'Priority support'],
  },
  {
    planKey: PLAN_KEYS.largeClub,
    name: 'Large Club',
    price: '\u00a399.99+',
    priceLabel: 'per month, contact sales',
    purchaseMode: PLAN_PURCHASE_MODES.contactSales,
    description: 'For larger clubs that need a negotiated rollout.',
    features: ['More than 10 teams', 'Negotiated limits', 'Assisted setup', 'Data migration', 'Custom onboarding', 'Bespoke branding', 'Integrations where available', 'Rollout planning', 'Dedicated support contact', 'Agreed service terms'],
  },
]

export function formatPrice(plan) {
  if (typeof plan.price !== 'number') {
    return plan.price
  }

  return `\u00a3${plan.price.toFixed(2)}`
}

export function formatPriceLabel(plan) {
  if (plan.priceLabel) {
    return plan.priceLabel
  }

  if (typeof plan.price !== 'number') {
    return 'No card needed'
  }

  return 'per month'
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
