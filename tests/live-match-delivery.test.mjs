import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { deliverCoachMatchDayCommands } from '../netlify/functions/lib/_coach-match-day-command-notifications.js'
import { deliverParentScorerCommands } from '../netlify/functions/lib/_parent-scorer-command-notifications.js'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { deliverLiveMatchChange } from '../netlify/functions/lib/_deliver-live-match-changes.js'

const matchId = '22222222-2222-4222-8222-222222222222'
const match = { id: matchId, status: 'live', current_match_phase: 'first_half', home_score: 2, away_score: 1,
  timer_status: 'running', timer_elapsed_seconds: 600, timer_started_at: '2026-11-03T08:30:00Z',
  teams: { name: 'Rovers' }, opponent: 'City' }
const privateKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'pem', type: 'pkcs8' })
const provider = { teamId: 'ABCDEFGHIJ', keyId: '1234567890', privateKey, production: false }

function clientFor(followers, fixture = match) {
  return {
    from(table) { return { select() { return { eq() { return table === 'match_day_events'
      ? Promise.resolve({ data: [], error: null })
      : { async maybeSingle() { return { data: fixture, error: null } } } } } } } },
    async rpc() { return { data: followers, error: null } },
  }
}

test('revoked iPhone access receives only a neutral end state', async () => {
  const requests = []
  const result = await deliverLiveMatchChange(matchId, {
    client: clientFor([{ app_role: 'parent', platform: 'ios', activity_token: 'ab'.repeat(32), access_allowed: false }]),
    provider, now: () => Date.parse('2026-11-03T08:40:00Z'),
    send: async request => { requests.push(request); return { accepted: true } },
  })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  const payload = JSON.parse(requests[0].body).aps
  assert.equal(payload.event, 'end')
  assert.equal(payload['content-state'].phase, 'Access ended')
  assert.equal(requests[0].body.includes('Rovers'), false)
  assert.equal(requests[0].body.includes('City'), false)
  assert.equal(requests[0].body.includes('"homeScore":2'), false)
})

test('Android refresh sends only a scoped match identifier and stop flag', async () => {
  const sent = []
  const result = await deliverLiveMatchChange(matchId, {
    client: clientFor([{ app_role: 'coach', platform: 'android', activity_token: 'ExpoPushToken[abcdefghijklmnop]', follow_id: 'follow', access_allowed: true }]),
    now: () => Date.parse('2026-11-03T08:40:00Z'),
    sendAndroid: async (...args) => { sent.push(args); return true },
  })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  assert.equal(sent[0][1], matchId)
  assert.equal(sent[0][2], false)
  assert.equal(sent[0][3], false)
})

test('hydration refresh freezes the iPhone clock at the saved match time', async () => {
  const requests = []
  const pausedMatch = { ...match, timer_status: 'hydration', timer_started_at: null,
    timer_elapsed_seconds: 259 }
  const result = await deliverLiveMatchChange(matchId, {
    client: clientFor([{ app_role: 'parent', platform: 'ios', activity_token: 'ab'.repeat(32), access_allowed: true }], pausedMatch),
    provider, now: () => Date.parse('2026-11-03T08:40:00Z'),
    send: async request => { requests.push(request); return { accepted: true } },
  })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  const state = JSON.parse(requests[0].body).aps['content-state']
  assert.equal(state.running, false)
  assert.equal(state.elapsedSeconds, 259)
})

test('full time keeps a final Android score but revoked access clears it', async () => {
  const sent = []
  await deliverLiveMatchChange(matchId, {
    client: clientFor([
      { app_role: 'coach', platform: 'android', access_allowed: true },
      { app_role: 'parent', platform: 'android', access_allowed: false },
    ], { ...match, status: 'full_time', timer_status: 'full_time', current_match_phase: 'full_time', concluded_at: '2026-11-03T08:40:00Z' }),
    now: () => Date.parse('2026-11-03T08:40:00Z'),
    sendAndroid: async (...args) => { sent.push(args); return true },
  })
  assert.deepEqual(sent.map(args => args.slice(2)), [[true, true], [true, false]])
})

test('a quiet match remains current while its clock runs locally', async () => {
  const requests = []
  await deliverLiveMatchChange(matchId, {
    client: clientFor([{ app_role: 'coach', platform: 'ios', activity_token: 'ab'.repeat(32), access_allowed: true }]),
    provider, now: () => Date.parse('2026-11-03T08:40:00Z'),
    send: async request => { requests.push(request); return { accepted: true } },
  })
  const payload = JSON.parse(requests[0].body).aps
  assert.equal(payload['stale-date'] - payload.timestamp, 4 * 60)
  assert.equal(payload['content-state'].running, true)
  assert.equal(payload['content-state'].homeScore, 2)
})

test('a prepared iPhone follow starts once after kick-off and is then left for token attachment', async () => {
  const requests = []
  const marked = []
  const follower = { follow_id: '66666666-6666-4666-8666-666666666666', app_role: 'parent', platform: 'ios',
    activity_token: null, start_token: 'cd'.repeat(32), remote_start_sent_at: null, remote_start_attempted_at: null,
    badge_data: null, club_is_home: true, access_allowed: true }
  const client = clientFor([follower])
  client.rpc = async (name, args) => {
    if (name === 'reserve_live_match_remote_start') { follower.remote_start_attempted_at = new Date().toISOString(); return { data: true, error: null } }
    if (name === 'mark_live_match_remote_started') { marked.push(args); return { data: true, error: null } }
    return { data: [follower], error: null }
  }
  const result = await deliverLiveMatchChange(matchId, { client, provider,
    now: () => Date.parse('2026-11-03T08:40:00Z'),
    send: async request => { requests.push(request); return { accepted: true } } })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  assert.equal(JSON.parse(requests[0].body).aps.event, 'start')
  assert.equal(JSON.parse(requests[0].body).aps['input-push-token'], 1)
  assert.match(JSON.parse(requests[0].body).aps.attributes.handoffToken, /^[0-9a-f]{64}$/)
  assert.equal(marked[0].follow_id_value, follower.follow_id)
  follower.remote_start_sent_at = '2026-11-03T08:40:00Z'
  await deliverLiveMatchChange(matchId, { client, provider, now: () => Date.parse('2026-11-03T08:41:00Z'),
    send: async request => { requests.push(request); return { accepted: true } } })
  assert.equal(requests.length, 1)
})

test('simultaneous queue rows reserve one remote start before sending', async () => {
  const follower = { follow_id: '66666666-6666-4666-8666-666666666666', app_role: 'parent', platform: 'ios',
    activity_token: null, start_token: 'cd'.repeat(32), remote_start_attempted_at: null,
    badge_data: null, club_is_home: true, access_allowed: true }
  const client = clientFor([follower])
  let reserved = false
  client.rpc = async name => {
    if (name === 'reserve_live_match_remote_start') {
      if (reserved) return { data: false, error: null }
      reserved = true
      return { data: true, error: null }
    }
    if (name === 'mark_live_match_remote_started') return { data: true, error: null }
    return { data: [follower], error: null }
  }
  const requests = []
  const options = { client, provider, now: () => Date.parse('2026-11-03T08:40:00Z'),
    send: async request => { requests.push(request); return { accepted: true } } }
  await Promise.all([deliverLiveMatchChange(matchId, options), deliverLiveMatchChange(matchId, options)])
  assert.equal(requests.length, 1)
})

test('an explicit APNs rejection is recorded for safe retry with a new token', async () => {
  const follower = { follow_id: '66666666-6666-4666-8666-666666666666', app_role: 'parent', platform: 'ios',
    activity_token: null, start_token: 'cd'.repeat(32), remote_start_attempted_at: null,
    badge_data: null, club_is_home: true, access_allowed: true }
  const client = clientFor([follower])
  const calls = []
  client.rpc = async (name, args) => {
    calls.push([name, args])
    if (name === 'reserve_live_match_remote_start' || name === 'reject_live_match_remote_start') {
      return { data: true, error: null }
    }
    return { data: [follower], error: null }
  }
  const result = await deliverLiveMatchChange(matchId, { client, provider,
    now: () => Date.parse('2026-11-03T08:40:00Z'),
    send: async () => ({ accepted: false, status: 410 }) })
  assert.equal(result.failed, 1)
  assert.equal(calls.find(([name]) => name === 'reject_live_match_remote_start')[1].retryable_value, false)
})

test('a prepared follow with revoked access never receives match details', async () => {
  const requests = []
  const result = await deliverLiveMatchChange(matchId, { client: clientFor([{ app_role: 'parent', platform: 'ios',
    start_token: 'cd'.repeat(32), activity_token: null, access_allowed: false }]), provider,
    send: async request => { requests.push(request); return { accepted: true } } })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  assert.equal(requests.length, 0)
})

test('concluded iPhone match sends the final score and stops its clock', async () => {
  const requests = []
  const result = await deliverLiveMatchChange(matchId, {
    client: clientFor([{ app_role: 'parent', platform: 'ios', activity_token: 'ab'.repeat(32), access_allowed: true }], {
      ...match, home_score: 1, away_score: 0, status: 'full_time', timer_status: 'full_time',
      current_match_phase: 'full_time', concluded_at: '2026-11-03T08:40:00Z',
    }),
    provider, now: () => Date.parse('2026-11-03T08:41:00Z'),
    send: async request => { requests.push(request); return { accepted: true } },
  })
  assert.deepEqual(result, { delivered: 1, failed: 0 })
  const { aps } = JSON.parse(requests[0].body)
  assert.equal(aps.event, 'end')
  assert.equal(aps['content-state'].phase, 'Full time')
  assert.equal(aps['content-state'].running, false)
  assert.equal(aps['content-state'].homeScore, 1)
  assert.equal(aps['content-state'].awayScore, 0)
})

test('saved hydration and resume commands refresh both platforms without a later event or an alert', async () => {
  const db = new PGlite()
  const migration = await readFile(new URL('../supabase/migrations/20261125123206_wake_live_clock_for_saved_scorer_commands.sql', import.meta.url), 'utf8')
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const owner = id(9)
  const followers = [
    { app_role: 'parent', platform: 'ios', activity_token: 'ab'.repeat(32), access_allowed: true },
    { app_role: 'coach', platform: 'ios', start_token: 'cd'.repeat(32), access_allowed: true },
    { app_role: 'coach', platform: 'android', access_allowed: true },
  ]
  const cases = [
    ['coach_match_day', 'coach_match_day_commands', deliverCoachMatchDayCommands, { id: matchId }],
    ['parent_scorer', 'parent_scorer_match_day_commands', deliverParentScorerCommands, { match: { id: matchId } }],
  ]
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema private;')
    for (const [, table] of cases) {
      await db.exec(`create table private.${table} (
        id uuid primary key, actor_user_id uuid, kind text, payload jsonb, result jsonb, event_id uuid,
        notification_type text default '', notification_completed_at timestamptz,
        notification_claimed_at timestamptz, notification_attempts integer default 0,
        created_at timestamptz default now()
      );`)
    }
    await db.exec(migration)
    await db.exec('set role authenticated')
    for (const [prefix] of cases) await assert.rejects(db.query(`select public.claim_${prefix}_command_notifications()`), /permission denied/)
    await db.exec('reset role')
    for (const [prefix, table, dispatch, commandResult] of cases) {
      const claim = `claim_${prefix}_command_notifications`
      const complete = `complete_${prefix}_command_notification`
      const requests = [], android = []
      let fixture
      const client = {
        from(tableName) { return clientFor(followers, fixture).from(tableName) },
        async rpc(name, args) {
          if (name === claim) {
            const { rows } = await db.query(`select public.${claim}($1,$2) as value`, [args.command_id_value, args.actor_user_id_value])
            return { data: rows[0].value }
          }
          if (name === complete) {
            assert.equal(args.error_value, '')
            await db.query(`update private.${table} set notification_completed_at=now() where id=$1`, [args.command_id_value])
            return {}
          }
          assert.equal(name, 'get_live_match_follows_for_delivery')
          return { data: followers }
        },
      }
      const refreshClock = async (targetId, sameClient) => {
        assert.equal(sameClient, client)
        const delivery = await deliverLiveMatchChange(targetId, {
          client, provider, startActivities: false, now: () => Date.parse('2026-11-03T08:40:00Z'),
          send: async request => { requests.push(JSON.parse(request.body).aps); return { accepted: true } },
          sendAndroid: async (_follower, target, stop) => { android.push({ target, stop }); return true },
        })
        assert.equal(delivery.failed, 0)
      }
      const dispatchOptions = { client, refreshClock, deliver: async () => assert.fail('Unexpected regular notification') }
      for (const [index, action] of ['hydration', 'resume'].entries()) {
        const commandId = id(index + 1)
        fixture = { ...match, timer_elapsed_seconds: 259, timer_status: index ? 'running' : 'hydration',
          timer_started_at: index ? '2026-11-03T08:39:50Z' : null }
        await db.query(`insert into private.${table}(id,actor_user_id,kind,payload,result) values($1,$2,'timer',$3,$4)`,
          [commandId, owner, { action }, commandResult])
        assert.deepEqual(await dispatch(null, null, dispatchOptions), { completed: 0, failed: 0 })
        assert.deepEqual(await dispatch(commandId, id(8), dispatchOptions), { completed: 0, failed: 0 })
        assert.deepEqual(await dispatch(commandId, owner, dispatchOptions), { completed: 1, failed: 0 })
        assert.deepEqual(await dispatch(commandId, owner, dispatchOptions), { completed: 0, failed: 0 })
      }
      assert.deepEqual(requests.map(aps => [aps.event, aps['content-state'].running, aps['content-state'].elapsedSeconds, aps.alert]),
        [['update', false, 259, undefined], ['update', true, 269, undefined]])
      assert.deepEqual(android, [{ target: matchId, stop: false }, { target: matchId, stop: false }])
    }
  } finally { await db.close() }
})
