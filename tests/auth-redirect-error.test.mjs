import assert from 'node:assert/strict'
import test from 'node:test'
import { getAuthRedirectErrorMessage } from '../src/lib/auth-redirect-error.js'

test('expired confirmation links explain that the newest email is required', () => {
  assert.match(
    getAuthRedirectErrorMessage('', '#error=access_denied&error_code=otp_expired'),
    /newest Football Player confirmation email/,
  )
  assert.match(
    getAuthRedirectErrorMessage('?error=access_denied&error_code=otp_expired', ''),
    /Older emails from a previous signup will not work/,
  )
})

test('normal sign-in and unrelated query parameters show no confirmation error', () => {
  assert.equal(getAuthRedirectErrorMessage('?mode=signup', ''), '')
  assert.equal(getAuthRedirectErrorMessage('', '#access_token=example'), '')
})
