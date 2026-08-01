import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const expectedSchedules = new Map([
  ['cleanup-expired-retention', '@daily'],
  ['process-platform-analytics', '*/15 * * * *'],
  ['process-training-availability-requests', '* * * * *'],
  ['retry-failed-emails', '* * * * *'],
  ['security-audit-monitor', '*/15 * * * *'],
  ['send-scheduled-emails', '* * * * *'],
])

const netlifyConfig = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8')
const cleanupSource = await readFile(
  new URL('../netlify/functions/cleanup-expired-retention.js', import.meta.url),
  'utf8',
)

test('all six scheduled functions have the expected effective source schedule', async () => {
  const discoveredSchedules = new Map()

  for (const [functionName, expectedSchedule] of expectedSchedules) {
    const tomlPattern = new RegExp(
      `\\[functions\\."${functionName}"\\]\\s+schedule\\s*=\\s*"([^"]+)"`,
      'm',
    )
    const functionSource = await readFile(
      new URL(`../netlify/functions/${functionName}.js`, import.meta.url),
      'utf8',
    )
    const inlineMatch = functionSource.match(/export const config\s*=\s*\{[\s\S]*?schedule:\s*['"]([^'"]+)['"]/)
    const tomlMatch = netlifyConfig.match(tomlPattern)
    const effectiveSchedule = tomlMatch?.[1] ?? inlineMatch?.[1]

    assert.ok(effectiveSchedule, `${functionName} must have a schedule declaration`)
    assert.equal(effectiveSchedule, expectedSchedule, `${functionName} schedule must remain unchanged`)
    discoveredSchedules.set(functionName, effectiveSchedule)
  }

  assert.deepEqual(discoveredSchedules, expectedSchedules)
})

test('legacy retention handler uses netlify.toml scheduling without a dead inline config export', () => {
  assert.match(
    netlifyConfig,
    /\[functions\."cleanup-expired-retention"\]\s+schedule\s*=\s*"@daily"/m,
  )
  assert.doesNotMatch(cleanupSource, /export const config\s*=\s*\{/)
  assert.match(cleanupSource, /export async function handler\(\)/)
  assert.doesNotMatch(cleanupSource, /export default/)
})
