import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import { normalizeAvailabilityFollowUp, queueAvailabilityFollowUp, prepareScheduledAvailabilityFollowUpRow } from '../netlify/functions/lib/_availability-follow-up.js'
import { canFollowUpSelectedCoachInvites, canResendSelectedCoachInvites } from '../apps/mobile-core/src/coachPhase31ECore.js'

function fixture() {
  const profile = { id: 'coach', club_id: 'club', role: 'coach', role_rank: 20, status: 'active', email: 'coach@example.invalid' }
  const event = { id: 'event', club_id: 'club', team_id: 'team', status: 'scheduled', match_date: '2099-01-01', opponent: 'Visitors' }
  const state = { rows: new Map(), writes: [], revoked: false, teamAccess: true, error: null, excluded: false }
  const client = {
    from(table) {
      const filters = []
      const query = {
        select() { return this }, eq(key, value) { filters.push([key, value]); return this }, neq() { return this }, is() { return this },
        async maybeSingle() {
          if (state.error) return { error: state.error }
          const rows = { match_days: event, calendar_events: event, calendar_event_invites: { id: 'invite' }, users: profile, user_club_memberships: { auth_user_id: profile.id, club_id: profile.club_id, role: profile.role, role_rank: profile.role_rank }, clubs: { id: 'club', status: 'active' }, team_staff: state.teamAccess ? { team_id: 'team', user_id: 'coach' } : null }
          const row = rows[table]
          return { data: row && filters.every(([key, value]) => row[key] === undefined || row[key] === value) ? row : null }
        },
        async upsert(rows, options) {
          assert.equal(table, 'scheduled_email_queue')
          assert.equal(options.ignoreDuplicates, true)
          for (const row of rows) { state.writes.push(table); if (!state.rows.has(row.id)) state.rows.set(row.id, row) }
          return {}
        },
        then(resolve, reject) { return Promise.resolve({ data: state.excluded ? [{ scope: 'occurrence', effective_from_date: '2099-01-01' }] : [] }).then(resolve, reject) },
      }
      return query
    },
    async rpc(name, args) {
      assert.equal(name, 'event_player_eligible_recipients')
      assert.deepEqual(args, { club_id_value: 'club', team_id_value: 'team', player_ids_value: ['player'] })
      return { data: state.revoked ? [] : [{ recipient_email: 'parent@example.invalid', player_id: 'player', parent_link_id: 'link', recipient_type: 'parent' }] }
    },
  }
  const options = { client, profile, scopedEvent: event, sourceType: 'match-day', playerId: 'player', message: 'Please confirm <today> & tomorrow', idempotencyKey: 'unique-command' }
  return { client, state, profile, event, options }
}
test('Maybe follow-ups are allowed while ordinary resend remains unavailable', () => {
  const maybe = { kind: 'match', status: 'maybe' }
  assert.equal(canFollowUpSelectedCoachInvites([maybe]), true)
  assert.equal(canResendSelectedCoachInvites([maybe]), false)
  for (const invite of [{ ...maybe, stale: true }, { ...maybe, cancelled: true }, { ...maybe, status: 'available' }]) assert.equal(canFollowUpSelectedCoachInvites([invite]), false)
  assert.equal(canFollowUpSelectedCoachInvites([]), false)
})
test('follow-up queues a targeted staff message without modifying any availability response; retry is idempotent', async () => {
  const { options, state } = fixture()
  const result = await queueAvailabilityFollowUp(options)
  await queueAvailabilityFollowUp(options)
  assert.equal(result.queuedCount, 1)
  assert.equal(state.rows.size, 1)
  const row = [...state.rows.values()][0]
  assert.deepEqual([...new Set(state.writes)], ['scheduled_email_queue'])
  assert.equal(row.payload.communicationLog.metadata.body, options.message)
  assert.equal(row.payload.communicationLog.metadata.recipientLinkId, 'link')
  assert.equal(row.payload.communicationLog.metadata.source, 'club_announcement')
  assert.deepEqual(row.payload.resendPayload.to, ['parent@example.invalid'])
  assert.match(row.payload.resendPayload.html, /&lt;today&gt; &amp;/)
  assert.match(row.payload.resendPayload.html, /existing availability response has not changed/)
})
test('queued follow-ups recheck actor, event, team and recipient access before delivery', async () => {
  for (const change of [f => { f.state.revoked = true }, f => { f.event.status = 'cancelled' }, f => { f.profile.status = 'disabled' }, f => { f.state.teamAccess = false }]) {
    const f = fixture()
    await queueAvailabilityFollowUp(f.options)
    const row = [...f.state.rows.values()][0]
    assert.equal((await prepareScheduledAvailabilityFollowUpRow(row, f.client)).skipped, false)
    change(f)
    assert.equal((await prepareScheduledAvailabilityFollowUpRow(row, f.client)).skipped, true)
  }
})
test('training occurrence exclusions and queue scope mismatches block delivery; database failures remain retryable', async () => {
  const f = fixture()
  Object.assign(f.event, { event_type: 'training', title: 'Session', starts_at: '2099-01-01T12:00:00Z', ends_at: '2099-01-01T13:00:00Z' })
  Object.assign(f.options, { sourceType: 'calendar', occurrenceDate: '2099-01-01' })
  await queueAvailabilityFollowUp(f.options)
  const row = [...f.state.rows.values()][0]
  assert.equal((await prepareScheduledAvailabilityFollowUpRow({ ...row, team_id: 'another' }, f.client)).skipped, true)
  f.state.excluded = true
  assert.equal((await prepareScheduledAvailabilityFollowUpRow(row, f.client)).skipped, true)
  f.state.excluded = false; f.state.error = Error('temporary database failure')
  await assert.rejects(prepareScheduledAvailabilityFollowUpRow(row, f.client), /temporary/)
})
test('empty or excessive content is rejected before queuing', () => {
  for (const value of ['', ' ', 'x'.repeat(501)]) assert.throws(() => normalizeAvailabilityFollowUp(value), /1 to 500/)
  assert.equal(normalizeAvailabilityFollowUp(' Please reply '), 'Please reply')
})

test('a failed follow-up resumes its original command, but changed content or scope cannot reuse the key', async () => {
  const source = await readFile('netlify/functions/send-event-player-invitation.js', 'utf8')
  const node = parse(source, { sourceType: 'module' }).program.body.find(node => node.id?.name === 'beginAction')
  const begin = vm.runInNewContext(`(${source.slice(node.start, node.end)})`)
  const previous = { id: 'command', action: 'resend', actor_id: 'coach', club_id: 'club', team_id: 'team', source_type: 'match-day', event_id: 'event', player_id: 'player', status: 'failed', result: { followUpFingerprint: 'same-message' } }
  let resumed = 0
  const adminSupabase = { from() { let updating = false; return {
    insert() { return this }, select() { return this }, eq() { return this },
    single: async () => ({ error: { code: '23505' } }),
    update() { updating = true; resumed++; return this },
    maybeSingle: async () => ({ data: updating ? { id: previous.id } : previous }),
  } } }
  const args = { adminSupabase, action: 'resend', eventId: 'event', playerId: 'player', sourceType: 'match-day', idempotencyKey: 'key', profile: { id: 'coach' }, scopedEvent: { club_id: 'club', team_id: 'team' }, followUpFingerprint: 'same-message' }
  assert.equal((await begin(args)).duplicate, false)
  assert.equal(resumed, 1)
  await assert.rejects(begin({ ...args, followUpFingerprint: 'different' }), /different invitation action/)
  await assert.rejects(begin({ ...args, playerId: 'other' }), /different invitation action/)
  previous.status = 'processing'
  await assert.rejects(begin(args), /already processing/)
  previous.status = 'completed'
  assert.equal((await begin(args)).duplicate, true)
  assert.equal(resumed, 1)
})
