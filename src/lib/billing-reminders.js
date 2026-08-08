import { getUkCalendarDate } from './billing-date.js'

const REMINDER_BY_DAYS = new Map([[7, '7_day'], [1, '1_day'], [0, 'due_day']])

function calendarDayNumber(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86400000
}

export function getBillingReminderType(billingStartAt, now = new Date()) {
  const dueDate = getUkCalendarDate(new Date(billingStartAt))
  const today = getUkCalendarDate(now)
  return REMINDER_BY_DAYS.get(calendarDayNumber(dueDate) - calendarDayNumber(today)) || ''
}
