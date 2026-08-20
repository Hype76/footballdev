import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('both mobile apps expose the shared secure password recovery action', () => {
  const coachApp = read('apps/coach-mobile/App.js')
  const parentApp = read('apps/parent-mobile/App.js')
  const sharedUi = read('apps/mobile-core/src/ui.js')
  const sharedAuth = read('apps/mobile-core/src/auth.js')

  for (const source of [coachApp, parentApp]) {
    assert.match(source, /requestPasswordReset/)
    assert.match(source, /requestPasswordReset=\{requestPasswordReset\}/)
  }

  assert.match(sharedUi, /Forgot password\?/)
  assert.match(sharedUi, /Check your email for a secure password reset link\./)
  assert.match(sharedAuth, /\.netlify\/functions\/send-password-reset/)
  assert.doesNotMatch(sharedAuth, /resetPasswordForEmail/)
  assert.doesNotMatch(sharedAuth, /\/auth\/v1\/recover/)
})
