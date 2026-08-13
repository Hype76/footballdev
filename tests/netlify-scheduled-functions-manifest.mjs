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
  ['send-scheduled-emails', '* * * * *'],
])

const manifestPath = resolve(process.argv[2] ?? '.netlify/functions/manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const functions = Array.isArray(manifest.functions) ? manifest.functions : []
const scheduledFunctions = functions.filter((entry) => entry.schedule)
const discoveredSchedules = new Map(scheduledFunctions.map((entry) => [entry.name, entry.schedule]))

assert.equal(functions.length, 71, 'all 71 Netlify functions must remain packaged')
assert.equal(scheduledFunctions.length, 8, 'exactly eight scheduled functions must be generated')
assert.equal(discoveredSchedules.size, 8, 'scheduled function names must be unique')
assert.deepEqual(discoveredSchedules, expectedSchedules)
assert.equal(
  functions.filter((entry) => entry.name === 'cleanup-expired-retention').length,
  1,
  'cleanup-expired-retention must be packaged exactly once',
)

console.log(`Verified 71 packaged functions and 8 unique schedules in ${manifestPath}`)
