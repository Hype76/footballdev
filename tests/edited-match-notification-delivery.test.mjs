import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { prepareScheduledCalendarNotificationRow } from '../netlify/functions/lib/_calendar-notification-email.js'
import { isCurrentMatchNotificationReference } from '../netlify/functions/lib/_parent-notification-validity.js'

function fixture() {
  const token = 'test-only-invitation-token'
  const row = {
    id: 'queue', club_id: 'club', team_id: 'team', created_by: 'coach', to_email: 'parent@example.test',
    payload: {
      communicationLog: { metadata: { source: 'calendar_event_notification' } },
      matchDayActionableInvitation: { prepared: true, notificationCommandId: 'command' },
      matchDayAvailability: { requestId: 'request', matchDayId: 'match', playerId: 'player', parentLinkId: 'link', rawToken: token },
      resendPayload: { html: '<a href="/respond">Respond to the match invitation</a>' },
    },
  }
  const tables = {
    match_day_availability_requests: [{ id: 'request', club_id: 'club', team_id: 'team', match_day_id: 'match', player_id: 'player',
      parent_link_id: 'link', recipient_email: row.to_email, recipient_type: 'parent', status: 'pending',
      expires_at: '2099-01-01T00:00:00Z', token_hash: createHash('sha256').update(token).digest('hex') }],
    match_days: [{ id: 'match', club_id: 'club', team_id: 'team', parent_visible: true, status: 'scheduled', match_date: '2098-12-01' }],
    calendar_event_notification_commands: [{ id: 'command', club_id: 'club', team_id: 'team', match_day_id: 'match', requested_by: 'coach', player_ids: ['player'] }],
    calendar_event_invites: [{ id: 'invite', club_id: 'club', team_id: 'team', match_day_id: 'match', player_id: 'player', invite_status: 'invited' }],
  }
  const contacts = [{ recipient_email: row.to_email, recipient_type: 'parent', parent_link_id: 'link', player_id: 'player' }]
  const client = {
    from(table) {
      const filters = []
      const query = {
        select() { return query },
        eq(key, value) { filters.push([key, value]); return query },
        async maybeSingle() { return { data: (tables[table] || []).find(item => filters.every(([key, value]) => item[key] === value)) || null, error: null } },
      }
      return query
    },
    async rpc(name, args) {
      assert.equal(name, 'event_player_eligible_recipients')
      assert.deepEqual(args, { club_id_value: 'club', team_id_value: 'team', player_ids_value: ['player'] })
      return { data: contacts, error: null }
    },
  }
  return { row, tables, contacts, client }
}

test('edited match invitation reaches eligible parent without a staff profile or legacy notification row', async () => {
  const { row, client } = fixture()
  const result = await prepareScheduledCalendarNotificationRow(row, { supabaseClient: client })
  assert.equal(result.skipped, false)
  assert.equal(result.row, row)
  assert.match(result.row.payload.resendPayload.html, /Respond to the match invitation/)
})

test('edited match invitation supports the authoritative player contact too', async () => {
  const { row, client, tables, contacts } = fixture()
  row.payload.matchDayAvailability.parentLinkId = null
  tables.match_day_availability_requests[0].parent_link_id = null
  tables.match_day_availability_requests[0].recipient_type = 'player'
  contacts[0].parent_link_id = null
  contacts[0].recipient_type = 'player'
  assert.equal((await prepareScheduledCalendarNotificationRow(row, { supabaseClient: client })).skipped, false)
})

for (const status of ['available', 'unavailable', 'maybe']) {
  test(`edited match preserves an existing ${status} response`, async () => {
    const { row, client, tables } = fixture()
    tables.match_day_availability_requests[0].status = status
    assert.equal((await prepareScheduledCalendarNotificationRow(row, { supabaseClient: client })).skipped, false)
    assert.equal(tables.match_day_availability_requests[0].status, status)
  })
}

const invalidCases = {
  'removed contact': f => { f.contacts.length = 0 },
  'recipient changed': f => { f.row.to_email = 'different@example.test' },
  'wrong parent link': f => { f.row.payload.matchDayAvailability.parentLinkId = 'other-link' },
  'revoked token': f => { f.tables.match_day_availability_requests[0].token_revoked_at = '2026-01-01' },
  'rotated token': f => { f.tables.match_day_availability_requests[0].token_hash = 'different' },
  'expired request': f => { f.tables.match_day_availability_requests[0].status = 'expired' },
  'elapsed deadline': f => { f.tables.match_day_availability_requests[0].expires_at = '2020-01-01' },
  'deleted fixture': f => { f.tables.match_days[0].deleted_at = '2026-01-01' },
  'completed fixture': f => { f.tables.match_days[0].status = 'full_time' },
  'private fixture': f => { f.tables.match_days[0].parent_visible = false },
  'removed invitation': f => { f.tables.calendar_event_invites[0].invite_status = 'cancelled' },
  'other command actor': f => { f.tables.calendar_event_notification_commands[0].requested_by = 'other-coach' },
  'player outside command': f => { f.tables.calendar_event_notification_commands[0].player_ids = [] },
  'different team': f => { f.tables.match_days[0].team_id = 'other-team' },
}
for (const [name, mutate] of Object.entries(invalidCases)) {
  test(`edited match rejects ${name}`, async () => {
    const f = fixture()
    mutate(f)
    const result = await prepareScheduledCalendarNotificationRow(f.row, { supabaseClient: f.client })
    assert.equal(result.skipped, true)
    assert.equal(result.skipReason, 'match_invitation_scope_invalid')
  })
}

test('answered invitations remain excluded from response reminders but can receive explicit match updates', () => {
  const row = { parent_link_id: 'link', status: 'available', expires_at: '2099-01-01', match_days: { status: 'scheduled', match_date: '2098-12-01' } }
  assert.equal(isCurrentMatchNotificationReference(row, 'link'), false)
  assert.equal(isCurrentMatchNotificationReference(row, 'link', Date.now(), '', { allowAnswered: true }), true)
  for (const status of ['expired', 'cancelled']) {
    assert.equal(isCurrentMatchNotificationReference({ ...row, status }, 'link', Date.now(), '', { allowAnswered: true }), false)
  }
})
