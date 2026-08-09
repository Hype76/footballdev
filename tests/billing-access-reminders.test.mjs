import test from 'node:test'
import assert from 'node:assert/strict'
import { getBillingReminderType } from '../src/lib/billing-reminders.js'

test('billing reminders use UK calendar days and only the three required offsets', () => {
  const due = '2026-10-25T00:00:00.000Z'
  assert.equal(getBillingReminderType(due, new Date('2026-10-18T12:00:00Z')), '7_day')
  assert.equal(getBillingReminderType(due, new Date('2026-10-24T12:00:00Z')), '1_day')
  assert.equal(getBillingReminderType(due, new Date('2026-10-25T12:00:00Z')), 'due_day')
  assert.equal(getBillingReminderType(due, new Date('2026-10-26T12:00:00Z')), '')
})
