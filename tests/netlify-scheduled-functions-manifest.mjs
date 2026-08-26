import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const expectedSchedules = new Map([
  ['cleanup-expired-retention', '@daily'],
  ['process-billing-access-reminders', '*/15 * * * *'],
  ['process-chat-mobile-notifications', '* * * * *'],
  ['process-platform-analytics', '*/15 * * * *'],
  ['process-training-availability-requests', '* * * * *'],
  ['retry-failed-emails', '* * * * *'],
  ['security-audit-monitor', '*/15 * * * *'],
  ['send-poll-result-notifications', '* * * * *'],
  ['send-scheduled-emails', '* * * * *'],
])

const manifestPath = resolve(process.argv[2] ?? '.netlify/functions/manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const functions = Array.isArray(manifest.functions) ? manifest.functions : []
const scheduledFunctions = functions.filter((entry) => entry.schedule)
const discoveredSchedules = new Map(scheduledFunctions.map((entry) => [entry.name, entry.schedule]))

assert.equal(functions.length, 75, 'all 75 Netlify functions must remain packaged')
assert.equal(scheduledFunctions.length, 9, 'exactly nine scheduled functions must be generated')
assert.equal(discoveredSchedules.size, 9, 'scheduled function names must be unique')
assert.deepEqual(discoveredSchedules, expectedSchedules)
assert.equal(
  functions.filter((entry) => entry.name === 'cleanup-expired-retention').length,
  1,
  'cleanup-expired-retention must be packaged exactly once',
)

console.log(`Verified 75 packaged functions and 9 unique schedules in ${manifestPath}`)
