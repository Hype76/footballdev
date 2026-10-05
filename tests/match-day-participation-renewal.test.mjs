import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { hasMatchDayParticipationRenewal, isMatchDayParticipationRenewal } from '../netlify/functions/lib/_match-day-invitation-renewal.js'

// Execute the actual copied handlers with every external dependency replaced.
// No credentials, network client, live records, or Git access are used.
const sourceRoot = process.env.FP_RENEWAL_TEST_BASELINE === '1' ? '../../baseline/' : '../'
const senderSource = await readFile(new URL(`${sourceRoot}netlify/functions/send-match-day-availability-requests.js`, import.meta.url), 'utf8')
const wrapperSource = await readFile(new URL(`${sourceRoot}netlify/functions/send-event-player-invitation.js`, import.meta.url), 'utf8')
const digest = token => createHash('sha256').update(token).digest('hex')
const ids = { fixture: '11111111-1111-4111-8111-111111111111', player: '22222222-2222-4222-8222-222222222222', key: '33333333-3333-4333-8333-333333333333' }
const contains = (value, expected) => Object.entries(expected).every(([key, item]) => item && typeof item === 'object'
  ? contains(value?.[key], item) : value?.[key] === item)

function environment({ guardians = 2, response = true, reason = 'event_participation_removed', activeInvite = true } = {}) {
  const state = { writes: [], tokenCount: 0, denyFixture: false }
  const contacts = Array.from({ length: guardians }, (_, i) => ({ playerId: ids.player, email: `guardian${i}@example.invalid`, name: `Guardian ${i}`, type: 'parent', parentLinkId: `link-${i}` }))
  const oldToken = 'a'.repeat(64)
  state.contacts = contacts
  state.profile = { id: 'coach', club_id: 'club', role: 'coach', role_rank: 30, email: 'coach@example.invalid' }
  state.tables = {
    match_days: [{ id: ids.fixture, club_id: 'club', team_id: 'team', status: 'scorer_request', deleted_at: null, match_date: '2099-10-10' }],
    players: [{ id: ids.player, club_id: 'club', team_id: 'team', player_name: 'Synthetic player', status: 'active', archived_at: null }],
    player_team_memberships: [{ player_id: ids.player, club_id: 'club', team_id: 'team', status: 'active', ended_at: null }],
    calendar_event_invites: activeInvite ? [{ id: 'invite', match_day_id: ids.fixture, club_id: 'club', team_id: 'team', player_id: ids.player, invite_status: 'active', cancelled_at: null }] : [],
    match_day_availability_requests: contacts.map((contact, i) => ({ id: `request-${i}`, match_day_id: ids.fixture, club_id: 'club', team_id: 'team', player_id: ids.player, parent_link_id: contact.parentLinkId, channel: 'email', recipient_email: contact.email, recipient_type: contact.type, token_hash: digest(oldToken), token_revoked_at: '2099-08-31T12:00:00Z', token_revoked_reason: reason, token_version: 1, status: 'pending', expires_at: '2099-10-12T23:59:59Z', sent_at: '2099-08-31T11:00:00Z' })),
    match_day_player_availability: response ? [{ id: 'answer', match_day_id: ids.fixture, club_id: 'club', team_id: 'team', player_id: ids.player, status: 'available', selected_by_parent_link_id: null, source: 'staff_on_behalf' }] : [],
    match_day_player_availability_history: [{ id: 'history', source: 'staff_on_behalf', status: 'available' }],
    scheduled_email_queue: contacts.map((_, i) => ({ id: `old-queue-${i}`, club_id: 'club', status: 'sent', payload: { matchDayAvailability: { requestId: `request-${i}`, rawToken: oldToken } } })),
    event_player_invitation_actions: [], parent_email_templates: [], match_day_event_log: [], audit_logs: [],
  }
  function client(admin) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: state.profile.id } }, error: null }) },
      from(table) {
        let mode = 'select', body, one = false, maximum = Infinity
        const filters = []
        const query = {
          select() { return query },
          eq(key, value) { filters.push(row => row[key] === value); return query },
          neq(key, value) { filters.push(row => row[key] !== value); return query },
          is(key, value) { filters.push(row => (row[key] ?? null) === value); return query },
          in(key, values) { filters.push(row => values.includes(row[key])); return query },
          contains(key, value) { filters.push(row => contains(row[key], value)); return query },
          order() { return query }, limit(value) { maximum = value; return query },
          insert(value) { mode = 'insert'; body = value; return query },
          update(value) { mode = 'update'; body = value; return query },
          upsert(value) { mode = 'upsert'; body = value; return query },
          maybeSingle() { one = true; return query }, single() { one = true; return query },
          async then(resolve, reject) {
            try {
              if (mode === 'update' && table === 'match_day_availability_requests' && state.beforeRequestUpdate) await state.beforeRequestUpdate()
              const rows = state.tables[table] ||= []
              let matched = rows.filter(row => filters.every(filter => filter(row))).slice(0, maximum)
              if (!admin && table === 'match_days' && state.denyFixture) matched = []
              if (mode === 'insert' && table === 'event_player_invitation_actions' && rows.some(row => row.idempotency_key === body.idempotency_key)) return resolve({ data: null, error: { code: '23505' } })
              if (mode === 'insert' && table === 'scheduled_email_queue' && state.failReplacementQueueOnce) {
                state.failReplacementQueueOnce = false
                return resolve({ data: null, error: { code: 'synthetic_queue_failure', message: 'Synthetic replacement queue insert failed' } })
              }
              if (mode === 'update') {
                for (const row of matched) Object.assign(row, structuredClone(body))
                state.writes.push({ table, mode, body: structuredClone(body), ids: matched.map(row => row.id) })
              } else if (mode === 'insert' || mode === 'upsert') {
                const added = { id: `new-${table}-${rows.length}`, ...structuredClone(body) }
                rows.push(added); matched = [added]
                state.writes.push({ table, mode, body: structuredClone(body) })
              }
              resolve({ data: structuredClone(one ? matched[0] || null : matched), error: null })
            } catch (error) { reject(error) }
          },
        }
        return query
      },
      async rpc(name, args) {
        assert.equal(name, 'renew_match_day_participation_invitations')
        // Handler contract seam only; transaction correctness is tested by actual SQL in atomic-renewal.test.mjs.
        const prior = state.tables.event_player_invitation_actions.find(row => row.idempotency_key === args.idempotency_key_value)
        if (prior) return { data: { ...prior.result, duplicate: true }, error: null }
        if (state.failReplacementQueueOnce) {
          state.failReplacementQueueOnce = false
          return { data: null, error: { message: 'Synthetic replacement queue insert failed' } }
        }
        const units = args.recipient_units_value
        const requests = units.map(unit => state.tables.match_day_availability_requests.find(row => row.id === unit.requestId))
        if (requests.some((row,index) => !row?.token_revoked_at || row.token_version !== units[index].expectedTokenVersion)) {
          return { data: null, error: { message: 'Request authority changed. Preview again.' } }
        }
        units.forEach((unit,index) => {
          Object.assign(requests[index], { token_hash: unit.tokenHash, token_revoked_at: null, token_revoked_reason: null, token_version: requests[index].token_version + 1 })
          state.tables.scheduled_email_queue.push({id:`atomic-queue-${index}`,club_id:'club',to_email:requests[index].recipient_email,status:'scheduled',payload:structuredClone(unit.payload)})
        })
        const result = {success:true,renewalRequired:true,queuedCount:units.length,recipientCount:units.length,failedCount:0}
        state.tables.event_player_invitation_actions.push({ id:'atomic-command',idempotency_key:args.idempotency_key_value,actor_id:state.profile.id,club_id:'club',team_id:'team',source_type:'match-day',event_id:ids.fixture,player_id:ids.player,action:'resend',status:'completed',result })
        state.writes.push({table:'atomic_rpc',mode:'transaction',body:{recipientCount:units.length}})
        return {data:result,error:null}
      },
    }
  }
  const requestClient = client(false), adminClient = client(true)
  const dependencies = {
    process, createHash, console: { error() {}, warn() {} },
    createFromAddress: () => 'Synthetic sender',
    json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    loadActiveAuthorityProfile: async () => state.profile,
    createPublicSupabaseClient: () => requestClient, createSupabaseAdminClient: () => adminClient,
    assertWorkspaceBillingAction: async () => {},
    normalizeInvitationText: value => String(value ?? '').trim(),
    normalizeInvitationEmail: value => String(value ?? '').trim().toLowerCase(),
    isValidInvitationEmail: value => /@/.test(value),
    resolveEligibleMatchDayInvitationContacts: async () => state.contacts,
    resolveEligibleEventInvitationContacts: async () => state.contacts,
    createInvitationToken: () => { const token = (++state.tokenCount).toString(16).padStart(64, '0'); return { token, tokenHash: digest(token) } },
    buildMatchDayActionableInvitationEmail: () => ({ subject: 'Synthetic invite', html: '', text: '' }),
    resolveMatchDayNotificationTeamName: () => 'Synthetic team', resolveTeamNotificationDisplayName: () => 'Synthetic team',
    hasMatchDayParticipationRenewal, isMatchDayParticipationRenewal,
    normalizeAvailabilityFollowUp: value => value,
    queueAvailabilityFollowUp: () => { throw new Error('Out of scope') },
    buildOccurrences: () => { throw new Error('Out of scope') },
    queueTrainingInvitationRecipient: () => { throw new Error('Out of scope') },
  }
  function load(source, returned) {
    const executable = source.replace(/^import\s[\s\S]*?from\s+['"][^'"\n]+['"]\s*\r?\n/gm, '').replace(/^export /gm, '')
    return new Function(...Object.keys(dependencies), `${executable}\nreturn {${returned}};`)(...Object.values(dependencies))
  }
  const sender = load(senderSource, 'handler,getReusableMatchDayResponseToken')
  dependencies.sendMatchDayAvailabilityRequests = sender.handler
  const wrapper = load(wrapperSource, 'handler,loadRecipientPreview')
  const snapshot = () => state.tables.match_day_availability_requests.filter(request => state.contacts.some(contact => isMatchDayParticipationRenewal(request,contact)))
    .map(request => ({requestId:request.id,expectedTokenVersion:request.token_version,parentLinkId:request.parent_link_id || null}))
  const event = (action = 'resend', key = ids.key) => ({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ expectedRenewalRequests: snapshot(), invitationAction: action, idempotencyKey: key, matchDayId: ids.fixture, playerIds: [ids.player] }) })
  const wrapperEvent = (preview = false, key = ids.key) => ({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ expectedRenewalRequests: snapshot(), action: 'resend', idempotencyKey: key, eventId: ids.fixture, sourceType: 'match-day', playerId: ids.player, preview }) })
  return { state, sender, wrapper, event, wrapperEvent, oldToken }
}

test('explicit resend after re-add renews two current guardians and preserves staff answer/history', async () => {
  const env = environment()
  const answer = structuredClone(env.state.tables.match_day_player_availability)
  const history = structuredClone(env.state.tables.match_day_player_availability_history)
  const result = await env.sender.handler(env.event())
  assert.equal(result.statusCode, 200); assert.equal(JSON.parse(result.body).queuedCount, 2)
  assert.equal(env.state.tokenCount, 2)
  for (const request of env.state.tables.match_day_availability_requests) {
    assert.equal(request.token_revoked_at, null); assert.equal(request.token_version, 2)
    assert.notEqual(request.token_hash, digest(env.oldToken))
    assert.equal(request.status, 'pending')
  }
  assert.deepEqual(env.state.tables.match_day_player_availability, answer)
  assert.deepEqual(env.state.tables.match_day_player_availability_history, history)
  assert.equal(env.state.writes.some(write => /availability_history|player_availability/.test(write.table)), false)
  assert.equal(env.sender.getReusableMatchDayResponseToken({ token_hash: digest(env.oldToken), token_revoked_at: '2099-08-31' }, [{ payload: { matchDayAvailability: { rawToken: env.oldToken } } }]), '')
})

test('ordinary re-add sending reports unresolved authority and never rotates withdrawn tokens', async () => {
  const env = environment({ response: false })
  const result = await env.sender.handler(env.event(''))
  const body = JSON.parse(result.body)
  assert.equal(body.complete, false); assert.deepEqual(body.renewalRequiredPlayerIds, [ids.player])
  assert.equal(body.existingPlayerCount, 0); assert.equal(body.queuedCount, 0)
  assert.equal(env.state.tokenCount, 0); assert.equal(env.state.writes.length, 0)
})

test('revoked Parent authority and changed Parent link fail before writes', async () => {
  for (const response of [true, false]) for (const alter of [env => { env.state.tables.match_day_availability_requests[0].token_revoked_reason = 'recipient_authority_removed' }, env => { env.state.contacts[0].parentLinkId = 'different-link' }]) {
    const env = environment({ response }); alter(env)
    assert.equal((await env.sender.handler(env.event())).statusCode, 409)
    assert.equal(env.state.tokenCount, 0); assert.equal(env.state.writes.length, 0)
  }
})

test('a no-longer-eligible guardian is untouched and receives no replacement', async () => {
  const env = environment(); env.state.contacts = env.state.contacts.slice(1)
  const withdrawn = structuredClone(env.state.tables.match_day_availability_requests[0])
  const result = await env.sender.handler(env.event())
  assert.equal(result.statusCode, 200); assert.equal(JSON.parse(result.body).queuedCount, 1)
  assert.deepEqual(env.state.tables.match_day_availability_requests[0], withdrawn)
  const queued = env.state.tables.scheduled_email_queue.filter(queue => queue.status === 'scheduled')
  assert.equal(queued.length, 1); assert.equal(queued[0].to_email, 'guardian1@example.invalid')
})

test('without re-added event membership renewal fails, and Parent actors cannot resend', async () => {
  for (const options of [{ activeInvite: false }, {}]) {
    const env = environment({ response: false, ...options })
    if (options.activeInvite !== false) env.state.profile.role = 'parent_portal'
    assert.equal((await env.sender.handler(env.event())).statusCode, options.activeInvite === false ? 409 : 403)
    assert.equal(env.state.writes.length, 0)
  }
})

test('answered contacts with current authority remain suppressed while withdrawn guardian is renewed', async () => {
  const env = environment()
  env.state.tables.match_day_availability_requests[0].token_revoked_at = null
  const active = structuredClone(env.state.tables.match_day_availability_requests[0])
  const result = await env.sender.handler(env.event())
  assert.equal(JSON.parse(result.body).queuedCount, 1)
  assert.deepEqual(env.state.tables.match_day_availability_requests[0], active)
  assert.equal(env.state.tokenCount, 1)
})

test('send/retry cannot renew withdrawn authority and normal answered fixtures still reject resend', async () => {
  for (const action of ['send', 'retry']) {
    const env = environment(); assert.equal((await env.sender.handler(env.event(action))).statusCode, 409)
    assert.equal(env.state.writes.length, 0)
  }
  const env = environment()
  env.state.tables.match_day_availability_requests.forEach(request => { request.token_revoked_at = null })
  assert.equal((await env.sender.handler(env.event())).statusCode, 409)
  assert.equal(env.state.writes.length, 0)
})

test('preview lists only guardians whose withdrawn authority will be renewed, with no writes', async () => {
  for (const activeCount of [0, 1]) {
    const env = environment()
    if (activeCount) env.state.tables.match_day_availability_requests[0].token_revoked_at = null
    const result = await env.wrapper.handler(env.wrapperEvent(true))
    assert.equal(result.statusCode, 200); assert.equal(JSON.parse(result.body).recipientCount, 2 - activeCount)
    assert.equal(env.state.writes.length, 0); assert.equal(env.state.tokenCount, 0)
  }
})

test('full wrapper repeats completed command without another token, queue or mutation', async () => {
  const env = environment()
  const first = await env.wrapper.handler(env.wrapperEvent())
  assert.equal(first.statusCode, 200, first.body)
  const writeCount = env.state.writes.length, tokenCount = env.state.tokenCount
  const repeat = await env.wrapper.handler(env.wrapperEvent())
  assert.equal(repeat.statusCode, 200); assert.equal(JSON.parse(repeat.body).duplicate, true)
  assert.equal(env.state.writes.length, writeCount); assert.equal(env.state.tokenCount, tokenCount)
  assert.equal(env.state.tables.event_player_invitation_actions.length, 1)
  const freshAction = await env.wrapper.handler(env.wrapperEvent(false, '44444444-4444-4444-8444-444444444444'))
  assert.equal(freshAction.statusCode, 409)
})

test('completed replay cannot cross actor, team, player or fixture authority', async () => {
  for (const alter of [env => { env.state.profile.id = 'other-coach' }, env => { env.state.tables.match_days[0].team_id = 'other-team' }, env => { env.state.denyFixture = true }]) {
    const env = environment(); assert.equal((await env.wrapper.handler(env.wrapperEvent())).statusCode, 200)
    const writes = env.state.writes.length; alter(env)
    assert.notEqual((await env.wrapper.handler(env.wrapperEvent())).statusCode, 200)
    assert.equal(env.state.writes.length, writes)
  }
})

test('other fixture rows and active unanswered reusable links are preserved', async () => {
  const env = environment({ response: false })
  env.state.tables.match_day_availability_requests.forEach(request => { request.token_revoked_at = null })
  const originalHash = env.state.tables.match_day_availability_requests[0].token_hash
  const unrelated = { ...env.state.tables.match_day_availability_requests[0], id: 'other-request', match_day_id: 'other-fixture', token_revoked_at: '2099-08-31' }
  env.state.tables.match_day_availability_requests.push(unrelated)
  const before = structuredClone(unrelated)
  assert.equal((await env.sender.handler(env.event())).statusCode, 200)
  assert.equal(env.state.tokenCount, 0)
  assert.equal(env.state.tables.match_day_availability_requests[0].token_hash, originalHash)
  assert.deepEqual(unrelated, before)
})

test('no current eligible recipient grants no replacement authority', async () => {
  const env = environment(); env.state.contacts = []
  assert.equal((await env.wrapper.handler(env.wrapperEvent(true))).statusCode, 409)
  const direct = JSON.parse((await env.sender.handler(env.event())).body)
  assert.equal(direct.complete, false); assert.equal(direct.queuedCount, 0)
  assert.equal(env.state.writes.length, 0); assert.equal(env.state.tokenCount, 0)
})

test('closed fixture or missing active Team membership prevents renewal', async () => {
  for (const alter of [env => { env.state.tables.match_days[0].status = 'cancelled' }, env => { env.state.tables.match_days[0].concluded_at = '2099-10-01' }, env => { env.state.tables.player_team_memberships = [] }]) {
    const env = environment(); alter(env)
    const result = await env.sender.handler(env.event())
    assert.ok(result.statusCode >= 400 || JSON.parse(result.body).complete === false)
    assert.equal(env.state.writes.length, 0); assert.equal(env.state.tokenCount, 0)
  }
})

test('sequential replay at delegated sender suppresses another rotation and delivery', async () => {
  const env = environment(); assert.equal((await env.sender.handler(env.event())).statusCode, 200)
  const writes = env.state.writes.length
  const repeat = await env.sender.handler(env.event())
  assert.equal(repeat.statusCode, 200); assert.equal(JSON.parse(repeat.body).duplicate, true)
  assert.equal(env.state.writes.length, writes); assert.equal(env.state.tokenCount, 2)
})

test('completed action with another fixture or player cannot be replayed', async () => {
  for (const field of ['eventId', 'playerId']) {
    const env = environment(); assert.equal((await env.wrapper.handler(env.wrapperEvent())).statusCode, 200)
    const event = env.wrapperEvent(); const body = JSON.parse(event.body)
    body[field] = '55555555-5555-4555-8555-555555555555'; event.body = JSON.stringify(body)
    const writes = env.state.writes.length
    assert.notEqual((await env.wrapper.handler(event)).statusCode, 200)
    assert.equal(env.state.writes.length, writes)
  }
})

test('explicit resend also renews an unanswered re-added fixture without creating an answer', async () => {
  const env = environment({ response: false })
  const result = await env.sender.handler(env.event())
  assert.equal(result.statusCode, 200); assert.equal(JSON.parse(result.body).queuedCount, 2)
  assert.equal(env.state.tables.match_day_player_availability.length, 0)
  assert.equal(env.state.tables.match_day_player_availability_history.length, 1)
})

test('overlapping commands with the same key produce one completed action and one set of deliveries', async () => {
  const env = environment()
  const results = await Promise.all([env.wrapper.handler(env.wrapperEvent()), env.wrapper.handler(env.wrapperEvent())])
  assert.equal(results.filter(result => result.statusCode === 200).length, 2)
  assert.equal(env.state.tables.event_player_invitation_actions.length, 1)
  assert.equal(env.state.tables.event_player_invitation_actions[0].status, 'completed')
  assert.equal(env.state.tables.scheduled_email_queue.filter(row => row.status === 'scheduled').length, 2)
})

test('overlapping different keys cannot overwrite the same token version or create duplicate deliveries', async () => {
  const env = environment()
  const results = await Promise.all([
    env.wrapper.handler(env.wrapperEvent()),
    env.wrapper.handler(env.wrapperEvent(false, '44444444-4444-4444-8444-444444444444')),
  ])
  assert.equal(results.filter(result => result.statusCode === 200).length, 1)
  assert.equal(env.state.tables.event_player_invitation_actions.filter(row => row.status === 'completed').length, 1)
  assert.equal(env.state.tables.scheduled_email_queue.filter(row => row.status === 'scheduled').length, 2)
  assert.deepEqual(env.state.tables.match_day_availability_requests.map(row => row.token_version), [2, 2])
})

test('atomic queue failure leaves every guardian recoverable on same-key explicit retry', async () => {
  const env = environment(); env.state.failReplacementQueueOnce = true
  const failed = await env.wrapper.handler(env.wrapperEvent())
  assert.ok(failed.statusCode >= 400)
  assert.equal(env.state.tables.match_day_player_availability[0].status, 'available')
  assert.deepEqual(env.state.tables.match_day_availability_requests.map(row => row.token_version), [1, 1])
  assert.equal(env.state.tables.event_player_invitation_actions.length, 0)
  const retried = await env.wrapper.handler(env.wrapperEvent())
  assert.equal(retried.statusCode, 200, retried.body)
  for (const request of env.state.tables.match_day_availability_requests) {
    assert.ok(env.state.tables.scheduled_email_queue.some(queue => queue.payload?.matchDayAvailability?.requestId === request.id
      && queue.payload.matchDayAvailability.tokenHash === request.token_hash), `Current replacement delivery missing for ${request.id}`)
  }
})
