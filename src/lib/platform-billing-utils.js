import { formatUkDate } from './date-format.js'

export const defaultCouponForm = {
  name: '',
  code: '',
  percentOff: '',
  amountOff: '',
  duration: 'once',
  durationInMonths: '3',
  expiresAt: '',
  firstTimeOnly: false,
}

export const defaultTesterCodeForm = {
  label: '',
  code: '',
  planKey: 'single_team',
  expiresInDays: '30',
  maxUses: '1',
  assignedEmail: '',
}

export const testerPlanOptions = [
  { key: 'individual', label: 'Individual' },
  { key: 'single_team', label: 'Single Team' },
  { key: 'small_club', label: 'Small Club' },
  { key: 'large_club', label: 'Large Club' },
]

export function formatDate(value) {
  if (!value) {
    return 'No date'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'No date'
  }

  return formatUkDate(parsedDate.toISOString().slice(0, 10), 'No date')
}

export function formatDiscount(coupon) {
  if (coupon.percentOff) {
    return `${coupon.percentOff}% off`
  }

  if (coupon.amountOff) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: coupon.currency || 'GBP',
    }).format(Number(coupon.amountOff) / 100)
  }

  return 'No discount'
}

export function formatExpiry(coupon) {
  if (coupon.expiresAt) {
    return `Ends ${formatDate(coupon.expiresAt)}`
  }

  if (coupon.redeemBy) {
    return `Ends ${formatDate(coupon.redeemBy)}`
  }

  return 'No end date'
}
