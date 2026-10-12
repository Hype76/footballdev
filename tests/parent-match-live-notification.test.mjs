import assert from 'node:assert/strict'
import { deliverCoachMatchReviewOnce } from '../netlify/functions/lib/_coach-match-review-delivery.js'
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

test('recorded match events remain visible separately and open only their own notification', () => {
  const rows = ['goal', 'half_time', 'full_time'].map((type, i) => ({
    id: String(i + 1), intent_type: 'matchday_update', body: type, title: 'Game',
    sent_at: `2026-09-02T12:0${i}:00Z`, data: { route: 'matchday', parentLinkId: 'parent', matchDayId: 'game', eventId: String(i) },
  }))
  rows.push({ ...rows[0], id: '4', data: { ...rows[0].data, matchDayId: 'other-game' } })
  const result = collapseParentNotificationRows(rows)
  assert.equal(result.length, 4)
  assert.equal(result[0].body, 'full_time')
  assert.deepEqual(result[0].notificationIds, ['3'])
  assert.equal(countUnreadNonChatNotifications(result), 4)
  assert.deepEqual(getParentOpenedNotificationIds(rows[0].data, result), ['1'])
  const raw = rows.map(r => ({ id: r.id, intentType: r.intent_type, data: r.data, sentAt: r.sent_at, body: r.body }))
  assert.equal(prepareParentNotificationInbox(raw)[0].body, 'full_time')
  rows[2].read_at = '2026-09-02T12:03:00Z'
  assert.equal(countUnreadNonChatNotifications(collapseParentNotificationRows(rows)), 3)
})

test('successive match events keep separate inbox rows and use the same phone and browser identity', async () => {
  const keys = ['live', 'goal', 'half_time', 'full_time'].map(type => getParentNotificationDedupeKey({ data: { matchDayId: 'game', type, eventId: type }, parentLinkId: 'parent', intentType: 'matchday_update' }))
  assert.equal(new Set(keys).size, 4)
  assert.equal(keys[1], getParentNotificationDedupeKey({ data: { matchDayId: 'game', type: 'goal', eventId: 'goal' }, parentLinkId: 'parent', intentType: 'matchday_update' }))
  assert.notEqual(keys[0], getParentNotificationDedupeKey({ data: { matchDayId: 'other' }, parentLinkId: 'parent', intentType: 'matchday_update' }))
  const calls = []
  const client = { from: () => ({ upsert: (rows, options) => { calls.push({ rows, options }); return { select: async () => ({ data: [{ id: 1 }] }) } } }) }
  await writeParentNotificationInbox({ client, intentType: 'matchday_update', data: { matchDayId: 'game', type: 'full_time' }, parentLinks: [{ id: 'parent', auth_user_id: 'user' }] })
  assert.equal(calls[0].options.ignoreDuplicates, false)
  assert.equal(calls[0].rows[0].read_at, null)
  assert.notEqual(buildParentMatchDayNotificationCopy({ match, type: 'goal', event: { id: 'goal' } }).tag, buildParentMatchDayNotificationCopy({ match, type: 'full_time' }).tag)
  const sender = await readFile(new URL('../netlify/functions/send-match-day-push.js', import.meta.url), 'utf8')
  assert.match(sender, /buildMatchDayNativeMessage/)
  const native = await readFile(new URL('../netlify/functions/lib/_match-day-native-message.js', import.meta.url), 'utf8')
  assert.doesNotMatch(native, /collapseId:/)
  assert.match(native, /priority: 'high'/)
  assert.match(sender, /if \(authorization.notificationType === 'coach_review'\)/)
  assert.ok(sender.indexOf('await deliverCoachMatchReviewOnce') < sender.indexOf('const delivery = await deliverMatchDayNotification'))
})

test('parent handover review alert only reaches currently authorised team coaches and links to the match', async () => {
  const profiles = [
    { id: 'coach', club_id: 'club', role: 'coach', role_rank: 20, status: 'active' },
    { id: 'wrong-team', club_id: 'club', role: 'coach', role_rank: 20, status: 'active' },
    { id: 'other-club', club_id: 'elsewhere', role: 'coach', role_rank: 20, status: 'active' },
    { id: 'parent', club_id: 'club', role: 'parent_portal', role_rank: 0, status: 'active' },
  ]
  const devices = profiles.map(p => ({ installation_id: p.id, auth_user_id: p.id, user_profile_id: p.id, expo_push_token: `ExpoPushToken[${p.id}]` }))
  const logged = []
  let pauseLog = false, finishLog
  const client = { from(table) {
    const filters = {}
    const q = { select: () => q, eq: (key, value) => { filters[key] = value; return q }, neq: () => q,
      contains: (key,value) => { filters[key]=value; return q },
      then: resolve => resolve({ data: table==='coach_mobile_notification_events' ? logged.filter(row=>row.status===filters.status&&row.data.reviewOperationKey===filters.data.reviewOperationKey) : devices }),
      insert: async rows => { if(pauseLog&&rows[0].installation_id==='coach-second')await new Promise(resolve=>{finishLog=resolve});logged.push(...rows); return {} },
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
  assert.match(sent[0].body, /Review the score and events, then conclude the match/)
  assert.equal(logged[0].intent_type, 'coach_update')
  assert.equal(sent[0].data.targetId, 'game')
  assert.equal(buildCoachMatchReviewPayload(match).title, 'Visitors v U17 Green: review required')
  assert.equal((await sendCoachMatchReviewPush({ match: { ...match, status: 'live' } })).skipped, true)
  assert.equal((await sendCoachMatchReviewPush({ match: { ...match, concluded_at: 'today' } })).skipped, true)
  devices.push({...devices[0],installation_id:'coach-second',expo_push_token:'ExpoPushToken[coach-second]'})
  const attempts=[]
  let failedSecond=false
  const retrySender=async messages=>{
    const token=messages[0].to; attempts.push(token)
    if(token==='ExpoPushToken[coach-second]'&&!failedSecond){failedSecond=true;return {sent:0,failed:1}}
    return {sent:1,failed:0}
  }
  const first=await sendCoachMatchReviewPush({match,adminClient:client,sendMessages:retrySender,operationKey:'review-once'})
  assert.equal(first.sent,1); assert.equal(first.failed,1)
  const retry=await sendCoachMatchReviewPush({match,adminClient:client,sendMessages:retrySender,operationKey:'review-once'})
  assert.equal(retry.sent,1); assert.equal(retry.failed,0)
  assert.equal(attempts.filter(token=>token==='ExpoPushToken[coach]').length,1)
  assert.equal(attempts.filter(token=>token==='ExpoPushToken[coach-second]').length,2)
  assert.equal((await sendCoachMatchReviewPush({match,adminClient:client,sendMessages:retrySender,operationKey:'review-once'})).skipped,true)
  pauseLog=true
  let released=false, settled=false
  client.rpc=async(name)=>{
    if(name==='claim_match_day_review_push_operation')return {data:{status:'claimed',operationKey:'deferred-review'}}
    assert.equal(name,'complete_match_day_push_operation');released=true;return {}
  }
  const pending=deliverCoachMatchReviewOnce({client,match,actorUserId:'parent',review:args=>sendCoachMatchReviewPush({...args,sendMessages:async messages=>{
    if(messages[0].to==='ExpoPushToken[coach]')throw new Error('Synthetic network failure')
    return {sent:1,failed:0}
  }})}).then(()=>{settled=true},error=>{settled=true;return error})
  for(let i=0;!finishLog&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,1))
  assert.equal(typeof finishLog,'function')
  assert.equal(settled,false,'A failed device must not release delivery while another accepted-device log is pending')
  assert.equal(released,false)
  finishLog()
  const failure=await pending
  assert.match(failure.message,/Synthetic network failure/)
  assert.equal(released,true)
  assert.ok(logged.some(row=>row.installation_id==='coach-second'&&row.status==='sent'&&row.data.reviewOperationKey==='deferred-review'))
})
