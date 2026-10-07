import assert from 'node:assert/strict'
import test from 'node:test'
import { createPhoneTeamAdministrationHandler } from '../netlify/functions/lib/_phone-team-administration.js'
import { processTeamReminders } from '../netlify/functions/lib/_team-reminder-processor.js'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const event = body => ({ httpMethod: 'POST', headers: { authorization: 'Bearer verified-session' }, body: JSON.stringify(body) })
const base = { action: 'save', teamId: id(2), squadEnabled: true, squadHoursBefore: 48, availabilityEnabled: false, availabilityHoursBefore: 48 }
function harness({ editable = true, authError = null, invite = { kind: 'invite', inviteId: id(5), teamId: id(2), clubId: id(3), inviteToken: id(6), roleLabel: 'Coach', email: 'coach@example.com', teamName: '<Team>', alreadySent: false } } = {}) {
  const calls = []; const mails = []; const assignments = []
  const handler = createPhoneTeamAdministrationHandler({
    client: { auth: { getUser: async () => ({ data: { user: { id: id(1), email_confirmed_at: '2026-01-01' } }, error: authError }) }, rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'manage_team_reminder_policy') {
        if (args.action_value === 'save' && !editable) return { error: { code: '42501', message: 'Only the team admin can change reminders.' } }
        return { data: { teamId: id(2), clubId: id(3), canManage: editable } }
      }
      return { data: invite }
    } },
    getPlanProfile: async () => ({ planKey: 'team' }), getStaffLimit: () => 5,
    authenticatedClient: () => ({ rpc: async (name, args) => { assignments.push({ name, args }); return { data: { success: true } } } }),
    sendInvite: async value => { mails.push(JSON.parse(value.body)); return { statusCode: 200 } },
  })
  return { handler, calls, mails, assignments }
}
test('reminder endpoint rejects null, fractional and out-of-range timing before touching auth or SQL', async () => {
  const h = harness()
  for (const value of [null, '', 0, 169, 1.5, '48']) assert.equal((await h.handler(event({ ...base, squadHoursBefore: value }))).statusCode, 400)
  assert.equal((await h.handler(event({ ...base, availabilityEnabled: 'true' }))).statusCode, 400)
  assert.equal(h.calls.length, 0)
})
test('coaches can read policy but cannot save reminders or invite staff', async () => {
  const h = harness({ editable: false })
  assert.equal((await h.handler(event({ action: 'read', teamId: id(2) }))).statusCode, 200)
  assert.equal((await h.handler(event(base))).statusCode, 403)
  assert.equal((await h.handler(event({ action: 'invite', teamId: id(2), email: 'new@example.com' }))).statusCode, 403)
  assert.equal(h.mails.length, 0)
})
test('authorised invite uses canonical existing email transport and escapes team labels', async () => {
  const h = harness()
  assert.equal((await h.handler(event({ action: 'invite', teamId: id(2), email: 'COACH@example.com', role: 'coach' }))).statusCode, 200)
  assert.equal(h.calls[1].args.email_value, 'coach@example.com')
  assert.equal(h.calls[1].args.limit_value, 5)
  assert.match(h.mails[0].html, /&lt;Team&gt;/)
  assert.equal(h.mails[0].inviteId, id(5))
  const sent = harness({ invite: { kind: 'invite', alreadySent: true } })
  await sent.handler(event({ action: 'invite', teamId: id(2), email: 'coach@example.com' }))
  assert.equal(sent.mails.length, 0, 'A retry does not resend an already delivered invitation')
})
test('existing users are assigned through the authenticated canonical RPC, never admin table writes', async () => {
  const h = harness({ invite: { kind: 'existing', userId: id(7), role: 'coach' } })
  const result = await h.handler(event({ action: 'invite', teamId: id(2), email: 'coach@example.com' }))
  assert.equal(result.statusCode, 200)
  assert.deepEqual(h.assignments, [{ name: 'assign_team_staff_role', args: { p_target_user_id: id(7), p_team_id: id(2), p_target_role_key: 'coach', p_request_source: 'staff_invitation' } }])
  assert.equal(h.mails.length, 0)
})
test('suspended sessions, privileged roles, unknown fields and unscoped teams are rejected', async () => {
  const h = harness({ authError: { message: 'Revoked' } })
  assert.equal((await h.handler(event(base))).statusCode, 401)
  for (const body of [{ ...base, actorId: id(8) }, { ...base, teamId: 'unscoped' }, { action: 'invite', teamId: id(2), email: 'coach@example.com', role: 'admin' }]) {
    assert.equal((await harness().handler(event(body))).statusCode, 400)
  }
})
test('reminder worker skips revoked policies, retries failures, and queues outstanding responses with stable identities', async () => {
  const jobs = [
    { deliveryKey: 'revoked', leaseId: id(1), kind: 'squad' },
    { deliveryKey: 'follow-up', leaseId: id(2), kind: 'availability', actorId: id(3), clubId: id(4), teamId: id(5), eventId: id(6), playerId: id(7), sourceType: 'match-day' },
    { deliveryKey: 'failure', leaseId: id(8), kind: 'availability', actorId: id(3) },
  ]; const finished = []; const queued = []
  const client = { rpc: async (name, args) => {
    if (name === 'claim_due_team_reminders') return { data: jobs }
    if (name === 'team_reminder_is_current') return { data: args.delivery_key_value !== 'revoked' }
    finished.push(args); return { data: true }
  } }
  const result = await processTeamReminders({ client, sendSquad: () => assert.fail('Revoked policy must not send'),
    loadProfile: async (_, { id: actor }) => ({ id: actor }), queueFollowUp: async value => { if (value.idempotencyKey === 'failure') throw new Error('Network failed'); queued.push(value) },
  })
  assert.deepEqual(result, { completed: 1, skipped: 1, failed: 1 })
  assert.equal(queued[0].idempotencyKey, 'follow-up')
  assert.equal(queued[0].automaticReminderKey, 'follow-up')
  assert.equal(finished[2].error_value, 'Reminder delivery will retry.')
})
