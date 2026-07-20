import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildClubOwnerInviteUrl,
  digestInvitationValue,
  generateInvitationValue,
} from '../netlify/functions/lib/_club-owner-invitation.js'
import { authorizeProcessorRequest } from '../netlify/functions/lib/_processor-auth.js'

const migrationPath = new URL('../supabase/migrations/20260720150008_p2_club_owner_invitation_processor_authority.sql', import.meta.url)
const createAccountPath = new URL('../netlify/functions/create-club-owner-account.js', import.meta.url)
const getInvitePath = new URL('../netlify/functions/get-club-owner-invite.js', import.meta.url)
const platformCreatePath = new URL('../netlify/functions/platform-create-club.js', import.meta.url)
const processScheduledPath = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)
const retryFailedPath = new URL('../netlify/functions/retry-failed-emails.js', import.meta.url)
const scheduledWrapperPath = new URL('../netlify/functions/send-scheduled-emails.js', import.meta.url)
const trainingProcessorPath = new URL('../netlify/functions/process-training-availability-requests.js', import.meta.url)
const netlifyConfigPath = new URL('../netlify.toml', import.meta.url)
const scheduledDomainPath = new URL('../src/lib/domain/scheduled-emails.js', import.meta.url)

function parseBody(response) {
  return JSON.parse(response.body)
}

function processorEvent({
  authorization = '',
  body = '{}',
  contentType = 'application/json',
  method = 'POST',
} = {}) {
  return {
    httpMethod: method,
    headers: {
      authorization,
      'content-type': contentType,
    },
    body,
  }
}

test('club-owner invitation values are random, digest-only at rest and fragment-delivered', () => {
  const firstValue = generateInvitationValue()
  const secondValue = generateInvitationValue()
  const digest = digestInvitationValue(firstValue)
  const url = buildClubOwnerInviteUrl('https://footballplayer.online/', firstValue)

  assert.notEqual(firstValue, secondValue)
  assert.equal(firstValue.length, 43)
  assert.match(firstValue, /^[A-Za-z0-9_-]+$/)
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.notEqual(digest, firstValue)
  assert.equal(url, `https://footballplayer.online/club-invite#token=${encodeURIComponent(firstValue)}`)
  assert.doesNotMatch(url, /\?token=/)
})

test('club-owner migration transforms legacy values and removes plaintext authority', async () => {
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /token_digest text/)
  assert.match(migration, /encode\(digest\(invite_token, 'sha256'\), 'hex'\)/)
  assert.match(migration, /drop column if exists invite_token/)
  assert.match(migration, /club_owner_invites_one_active_identity_key/)
  assert.match(migration, /status = 'replaced'/)
  assert.match(migration, /for update/)
  assert.match(migration, /accepted_user_id = p_auth_user_id/)
  assert.match(migration, /au\.email[\s\S]*invite\.invited_email/)
  assert.match(migration, /on conflict \(auth_user_id, club_id\) do update/)
  assert.match(migration, /revoke all on function public\.accept_club_owner_invite_v2[\s\S]*grant execute[\s\S]*to service_role/)
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/)
})

test('club-owner application authority is server-derived and never resets an existing account', async () => {
  const [createAccount, getInvite, platformCreate] = await Promise.all([
    readFile(createAccountPath, 'utf8'),
    readFile(getInvitePath, 'utf8'),
    readFile(platformCreatePath, 'utf8'),
  ])

  assert.doesNotMatch(createAccount, /body\.email/)
  assert.doesNotMatch(createAccount, /updateUserById/)
  assert.match(createAccount, /existing_account_authentication_required/)
  assert.match(createAccount, /supabaseAdmin\.auth\.getUser\(bearerToken\)/)
  assert.match(createAccount, /rpc\('accept_club_owner_invite_v2'/)
  assert.match(createAccount, /isDefinitiveDatabaseRejection/)
  assert.match(createAccount, /auth\.admin\.deleteUser\(createdAuthUserId\)/)
  assert.match(getInvite, /event\.httpMethod !== 'POST'/)
  assert.match(getInvite, /\.eq\('token_digest', digestInvitationValue\(token\)\)/)
  assert.doesNotMatch(getInvite, /queryStringParameters/)
  assert.doesNotMatch(getInvite, /token: data\./)
  assert.match(platformCreate, /generateInvitationValue\(\)/)
  assert.match(platformCreate, /p_token_digest: inviteTokenDigest/)
  assert.match(platformCreate, /targetEntityId: inviteId/)
  assert.doesNotMatch(platformCreate, /inviteUrl,\s*inviteEmailSent/)
})

test('server scheduler secret rejects missing, invalid and browser credentials before processing', () => {
  const previousSecret = process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET
  process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET = 'synthetic-scheduler-secret-for-tests'

  try {
    for (const authorization of [
      '',
      'Bearer wrong-synthetic-secret',
      'Bearer browser-user-jwt',
      'Bearer platform-admin-browser-jwt',
    ]) {
      const result = authorizeProcessorRequest(processorEvent({ authorization }))
      assert.equal(result.ok, false)
      assert.equal(result.response.statusCode, 401)
      assert.deepEqual(parseBody(result.response), { success: false, message: 'Unauthorized' })
    }
  } finally {
    if (previousSecret === undefined) {
      delete process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET
    } else {
      process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET = previousSecret
    }
  }
})

test('server scheduler secret fails closed when configuration is missing', () => {
  const previousSecret = process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET
  delete process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET

  try {
    const result = authorizeProcessorRequest(processorEvent({ authorization: 'Bearer synthetic-value' }))
    assert.equal(result.ok, false)
    assert.equal(result.response.statusCode, 503)
    assert.deepEqual(parseBody(result.response), { success: false, message: 'Processor unavailable.' })
  } finally {
    if (previousSecret !== undefined) {
      process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET = previousSecret
    }
  }
})

test('server scheduler boundary requires POST JSON with no caller-controlled scope', () => {
  const previousSecret = process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET
  process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET = 'synthetic-scheduler-secret-for-tests'
  const authorization = 'Bearer synthetic-scheduler-secret-for-tests'

  try {
    assert.equal(authorizeProcessorRequest(processorEvent({ authorization })).ok, true)
    assert.equal(authorizeProcessorRequest(processorEvent({ authorization, method: 'GET' })).response.statusCode, 405)
    assert.equal(authorizeProcessorRequest(processorEvent({ authorization, contentType: 'text/plain' })).response.statusCode, 415)
    assert.equal(authorizeProcessorRequest(processorEvent({ authorization, body: '{' })).response.statusCode, 400)
    assert.equal(authorizeProcessorRequest(processorEvent({ authorization, body: '{"batchSize":1000}' })).response.statusCode, 400)
    assert.equal(authorizeProcessorRequest(processorEvent({ authorization, body: '{"recipient":"x@example.test"}' })).response.statusCode, 400)
    assert.equal(authorizeProcessorRequest(processorEvent({ authorization, body: '{"dueDate":"2099-01-01"}' })).response.statusCode, 400)
  } finally {
    if (previousSecret === undefined) {
      delete process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET
    } else {
      process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET = previousSecret
    }
  }
})

test('all equivalent processor paths have a server boundary before work begins', async () => {
  const [scheduled, retry, wrapper, training, netlifyConfig, scheduledDomain] = await Promise.all([
    readFile(processScheduledPath, 'utf8'),
    readFile(retryFailedPath, 'utf8'),
    readFile(scheduledWrapperPath, 'utf8'),
    readFile(trainingProcessorPath, 'utf8'),
    readFile(netlifyConfigPath, 'utf8'),
    readFile(scheduledDomainPath, 'utf8'),
  ])

  const scheduledHandler = scheduled.slice(scheduled.indexOf('export async function handler'))
  const retryHandler = retry.slice(retry.indexOf('export async function handler'))
  const wrapperHandler = wrapper.slice(wrapper.indexOf('export async function handler'))
  const trainingHandler = training.slice(training.indexOf('export async function handler'))

  assert.ok(scheduledHandler.indexOf('authorizeProcessorRequest(event)') < scheduledHandler.indexOf('processScheduledEmails()'))
  assert.ok(retryHandler.indexOf('authorizeProcessorRequest(event)') < retryHandler.indexOf('getMissingEnvVars()'))
  assert.ok(wrapperHandler.indexOf('processScheduledEmails()') >= 0)
  assert.ok(trainingHandler.indexOf('processTrainingAvailabilityRequests(event)') >= 0)
  assert.doesNotMatch(wrapperHandler, /authorizeProcessorRequest|rejectDirectScheduledFunctionRequest/)
  assert.doesNotMatch(trainingHandler, /authorizeProcessorRequest|rejectDirectScheduledFunctionRequest/)
  assert.match(scheduled, /\.limit\(25\)/)
  assert.match(netlifyConfig, /\[functions\."send-scheduled-emails"\][\s\S]*schedule = "\* \* \* \* \*"/)
  assert.match(netlifyConfig, /\[functions\."process-training-availability-requests"\][\s\S]*schedule = "\*\/15 \* \* \* \*"/)
  assert.doesNotMatch(scheduledDomain, /process-scheduled-emails/)
  assert.match(scheduledDomain, /action: 'sendNow'/)
})
