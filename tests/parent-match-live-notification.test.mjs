import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { prepareParentNotificationInbox, countUnreadNonChatNotifications, getParentOpenedNotificationIds } from '../apps/mobile-core/src/parentNotificationInboxCore.js'
import { getParentNotificationDedupeKey, writeParentNotificationInbox } from '../netlify/functions/lib/_parent-notification-inbox.js'
import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'
import { buildCoachMatchReviewPayload } from '../netlify/functions/lib/_coach-match-review-push.js'
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-key'
const { collapseParentNotificationRows } = await import('../netlify/functions/parent-mobile-notifications.js')
const { sendCoachMatchReviewPush } = await import('../netlify/functions/send-coach-mobile-push.js')

const match = { id: 'game', club_id: 'club', team_id: 'team', status: 'full_time', home_away: 'away', opponent: 'Visitors', teams: { name: 'U17 Green' } }

test('one latest notification per match preserves separate games and marks every underlying event read', () => {
  const rows = ['goal', 'half_time', 'full_time'].map((type, i) => ({
    id: String(i + 1), intent_type: 'matchday_update', body: type, title: 'Game',
    sent_at: `2026-09-02T12:0${i}:00Z`, data: { route: 'matchday', parentLinkId: 'parent', matchDayId: 'game', eventId: String(i) },
  }))
  rows.push({ ...rows[0], id: '4', data: { ...rows[0].data, matchDayId: 'other-game' } })
  const result = collapseParentNotificationRows(rows)
  assert.equal(result.length, 2)
  assert.equal(result[0].body, 'full_time')
  assert.deepEqual(result[0].notificationIds, ['3', '2', '1'])
  assert.equal(countUnreadNonChatNotifications(result), 2)
  assert.deepEqual(getParentOpenedNotificationIds(rows[0].data, result), ['3', '2', '1'])
  const raw = rows.map(r => ({ id: r.id, intentType: r.intent_type, data: r.data, sentAt: r.sent_at, body: r.body }))
  assert.equal(prepareParentNotificationInbox(raw)[0].body, 'full_time')
  rows[2].read_at = '2026-09-02T12:03:00Z'
  assert.equal(countUnreadNonChatNotifications(collapseParentNotificationRows(rows)), 1)
})

test('successive match updates replace the inbox row and use the same phone and browser identity', async () => {
  const keys = ['live', 'goal', 'half_time', 'full_time'].map(type => getParentNotificationDedupeKey({ data: { matchDayId: 'game', type, eventId: type }, parentLinkId: 'parent', intentType: 'matchday_update' }))
  assert.equal(new Set(keys).size, 1)
  assert.notEqual(keys[0], getParentNotificationDedupeKey({ data: { matchDayId: 'other' }, parentLinkId: 'parent', intentType: 'matchday_update' }))
  const calls = []
  const client = { from: () => ({ upsert: (rows, options) => { calls.push({ rows, options }); return { select: async () => ({ data: [{ id: 1 }] }) } } }) }
  await writeParentNotificationInbox({ client, intentType: 'matchday_update', data: { matchDayId: 'game', type: 'full_time' }, parentLinks: [{ id: 'parent', auth_user_id: 'user' }] })
  assert.equal(calls[0].options.ignoreDuplicates, false)
  assert.equal(calls[0].rows[0].read_at, null)
  assert.equal(buildParentMatchDayNotificationCopy({ match, type: 'goal', event: { id: 'goal' } }).tag, buildParentMatchDayNotificationCopy({ match, type: 'full_time' }).tag)
  const sender = await readFile(new URL('../netlify/functions/send-match-day-push.js', import.meta.url), 'utf8')
  assert.match(sender, /collapseId: notificationCopy.tag/)
  assert.match(sender, /tag: notificationCopy.tag/)
  assert.match(sender, /type === 'full_time' && profile.role === 'parent_portal'/)
  assert.ok(sender.indexOf('if (!claimed)') < sender.indexOf('await sendCoachMatchReviewPush'))
})

test('parent full-time review alert only reaches currently authorised team coaches and links to the match', async () => {
  const profiles = [
    { id: 'coach', club_id: 'club', role: 'coach', role_rank: 20, status: 'active' },
    { id: 'wrong-team', club_id: 'club', role: 'coach', role_rank: 20, status: 'active' },
    { id: 'other-club', club_id: 'elsewhere', role: 'coach', role_rank: 20, status: 'active' },
    { id: 'parent', club_id: 'club', role: 'parent_portal', role_rank: 0, status: 'active' },
  ]
  const devices = profiles.map(p => ({ installation_id: p.id, auth_user_id: p.id, user_profile_id: p.id, expo_push_token: `ExpoPushToken[${p.id}]` }))
  const logged = []
  const client = { from(table) {
    const filters = {}
    const q = { select: () => q, eq: (key, value) => { filters[key] = value; return q }, neq: () => q,
      then: resolve => resolve({ data: devices }),
      insert: async rows => { logged.push(...rows); return {} },
      maybeSingle: async () => ({ data: table === 'users' ? profiles.find(p => p.id === filters.id)
        : table === 'user_club_memberships' ? { auth_user_id: filters.auth_user_id }
          : table === 'clubs' ? { id: filters.id, status: 'active' }
            : table === 'teams' ? { id: 'team', club_id: 'club', status: 'active' }
              : table === 'team_staff' && filters.user_id === 'coach' ? { id: 'assignment', role_rank: 20 } : null }) }
    return q
  } }
  let sent = []
  const result = await sendCoachMatchReviewPush({ match, adminClient: client, sendMessages: async messages => { sent = messages; return { sent: messages.length, failed: 0 } } })
  assert.equal(result.sent, 1)
  assert.equal(sent[0].to, 'ExpoPushToken[coach]')
  assert.equal(sent[0].data.matchDayId, 'game')
  assert.equal(sent[0].data.contextId, 'team:team')
  assert.match(sent[0].body, /review the report and conclude the game/)
  assert.equal(logged[0].intent_type, 'coach_update')
  assert.equal(sent[0].data.targetId, 'game')
  assert.equal(buildCoachMatchReviewPayload(match).title, 'Visitors v U17 G: review required')
  assert.equal((await sendCoachMatchReviewPush({ match: { ...match, status: 'live' } })).skipped, true)
  assert.equal((await sendCoachMatchReviewPush({ match: { ...match, concluded_at: 'today' } })).skipped, true)
})
