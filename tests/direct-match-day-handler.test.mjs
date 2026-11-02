import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('direct assignment handler authorises and delivers safely', () => {
  const fixture = fileURLToPath(new URL('./direct-match-day-handler.fixture.mjs', import.meta.url))
  const childEnv = { ...process.env }
  delete childEnv.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', fixture], { encoding: 'utf8', env: childEnv })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /# pass 3\b/)
})
