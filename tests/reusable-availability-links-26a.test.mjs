import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const matchRequestUrl = new URL(
  '../netlify/functions/send-match-day-availability-requests.js',
  import.meta.url,
)
const trainingProcessorUrl = new URL(
  '../netlify/functions/process-training-availability-requests.js',
  import.meta.url,
)
const matchResponseUrl = new URL(
  '../netlify/functions/match-day-availability-confirm.js',
  import.meta.url,
)
const trainingResponseUrl = new URL(
  '../netlify/functions/training-availability-response.js',
  import.meta.url,
)

const { getReusableMatchDayResponseToken } = await import(matchRequestUrl)
const { getReusableTrainingResponseToken } = await import(trainingProcessorUrl)

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

test('Match Day resends reuse the exact active token from protected queue payloads', () => {
  const rawToken = 'a'.repeat(64)
  const request = { token_hash: tokenHash(rawToken), token_revoked_at: null }

  assert.equal(
    getReusableMatchDayResponseToken(request, [{
      payload: { matchDayAvailability: { rawToken } },
    }]),
    rawToken,
  )
  assert.equal(
    getReusableMatchDayResponseToken(request, [{
      payload: {
        resendPayload: {
          html: `<a href="https://footballplayer.online/.netlify/functions/match-day-availability-confirm?token=${rawToken}&amp;status=available">Available</a>`,
        },
      },
    }]),
    rawToken,
  )
  assert.equal(
    getReusableMatchDayResponseToken(
      { ...request, token_revoked_at: '2026-08-02T18:00:00Z' },
      [{ payload: { matchDayAvailability: { rawToken } } }],
    ),
    '',
  )
  assert.equal(
    getReusableMatchDayResponseToken(request, [{
      payload: { matchDayAvailability: { rawToken: 'b'.repeat(64) } },
    }]),
    '',
  )
})

test('Training resends reuse the exact active token and fail closed on mismatch', () => {
  const rawToken = 'c'.repeat(64)
  const request = { token_hash: tokenHash(rawToken), token_revoked_at: null }
  const queue = { payload: { trainingInvitation: { rawToken } } }

  assert.equal(getReusableTrainingResponseToken(request, queue), rawToken)
  assert.equal(
    getReusableTrainingResponseToken(
      { ...request, token_revoked_at: '2026-08-02T18:00:00Z' },
      queue,
    ),
    '',
  )
  assert.equal(
    getReusableTrainingResponseToken(request, {
      payload: { trainingInvitation: { rawToken: 'd'.repeat(64) } },
    }),
    '',
  )
})

test('public response pages use privacy-safe current-state and inactive-link copy', async () => {
  const [matchResponse, trainingResponse] = await Promise.all([
    readFile(matchResponseUrl, 'utf8'),
    readFile(trainingResponseUrl, 'utf8'),
  ])

  for (const source of [matchResponse, trainingResponse]) {
    assert.match(source, /This response link is no longer active/)
    assert.doesNotMatch(source, /sign[ -]?in/i)
  }
  assert.match(matchResponse, /an authorised responder/)
  assert.doesNotMatch(matchResponse, /response\.current_availability_selected_by_email/)
  assert.match(trainingResponse, /Current availability/)
  assert.match(trainingResponse, /an authorised responder/)
  assert.doesNotMatch(trainingResponse, /response\.recipient_email/)
})
