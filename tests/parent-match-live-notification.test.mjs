import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { deliverCheckpointedTargets, deliverShootoutNotifications } from '../netlify/functions/lib/_match-day-shootout-notifications.js'

test('saved shootout kicks enqueue once, with restricted claims, retries and revoked kicks excluded', async () => {
  const db = new PGlite()
  const match = '00000000-0000-4000-8000-000000000001'
  const first = '00000000-0000-4000-8000-000000000002'
  const second = '00000000-0000-4000-8000-000000000003'
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))$$;
      create table public.match_days(id uuid primary key, status text, deleted_at timestamptz);
      create table public.match_day_shootout_kicks(id uuid primary key, match_day_id uuid references public.match_days(id), event_status text default 'active');
      create table private.parent_scorer_match_day_commands(kind text, event_id uuid, notification_type text default '');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261124094132_match_day_shootout_notification_intents.sql', import.meta.url), 'utf8'))
    await db.query("insert into public.match_days values($1,'penalties',null)",[match])
    await db.query('insert into public.match_day_shootout_kicks(id,match_day_id) values($1,$2),($3,$2)',[first,match,second])
    await db.query("insert into private.parent_scorer_match_day_commands(kind,event_id) values('shootout',$1)",[first])
    assert.equal((await db.query('select notification_type from private.parent_scorer_match_day_commands')).rows[0].notification_type,'shootout_kick')
    assert.equal((await db.query("select has_function_privilege('authenticated','public.claim_match_day_shootout_notifications(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false)
    assert.equal((await db.query('select * from public.claim_match_day_shootout_notifications(null,null)')).rows.length,0)
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    const claimed = (await db.query('select * from public.claim_match_day_shootout_notifications($1,$2)',[match,first])).rows
    assert.deepEqual(claimed,[{kick_id:first,match_day_id:match,attempt:1,delivered_channels:{}}])
    assert.equal((await db.query("select has_function_privilege('authenticated','public.checkpoint_match_day_shootout_notification(uuid,integer,text)','EXECUTE') allowed")).rows[0].allowed,false)
    assert.equal((await db.query("select public.checkpoint_match_day_shootout_notification($1,1,'mobile:device-one') saved",[first])).rows[0].saved,true)
    assert.equal((await db.query("select public.checkpoint_match_day_shootout_notification($1,1,'web:subscription-one') saved",[first])).rows[0].saved,true)
    assert.equal((await db.query("select public.checkpoint_match_day_shootout_notification($1,1,'wrong:recipient') saved",[first])).rows[0].saved,false)
    assert.equal((await db.query('select * from public.claim_match_day_shootout_notifications($1,$2)',[match,first])).rows.length,0)
    await db.query("select public.complete_match_day_shootout_notification($1,1,'retry')",[first])
    await db.query("update private.match_day_shootout_notification_intents set claimed_at=now()-interval '3 minutes' where kick_id=$1",[first])
    await db.query("update public.match_day_shootout_kicks set event_status='voided' where id=$1",[second])
    assert.deepEqual((await db.query('select * from public.claim_match_day_shootout_notifications(null,null)')).rows,[{kick_id:first,match_day_id:match,attempt:2,delivered_channels:{'mobile:device-one':true,'web:subscription-one':true}}])
    assert.equal((await db.query("select public.checkpoint_match_day_shootout_notification($1,1,'mobile:stale') saved",[first])).rows[0].saved,false)
    await db.query("select public.complete_match_day_shootout_notification($1,2,'')",[first])
    assert.equal((await db.query('select * from public.claim_match_day_shootout_notifications(null,null)')).rows.length,0)
  } finally { await db.close() }
})

test('shootout delivery uses the saved kick and current authorised parent recipients', async () => {
  const completed = [], delivered = []
  const match = { id: 'game', status: 'full_time', home_shootout_score: 3, away_shootout_score: 1 }
  const kick = { id: 'kick', match_day_id: 'game', event_status: 'active' }
  const client = {
    rpc: async (name, args) => {
      if (name === 'claim_match_day_shootout_notifications') return { data: [{ match_day_id: 'game', kick_id: 'kick', attempt: 1 }] }
      if (name === 'get_match_day_parent_notification_link_ids') return { data: ['parent', 'parent'] }
      completed.push(args); return { data: true }
    },
    from: table => ({ select() { return this }, eq() { return this }, is() { return this }, maybeSingle: async () => ({ data: table === 'match_days' ? match : kick }) }),
  }
  assert.deepEqual(await deliverShootoutNotifications({ client, deliver: async args => { delivered.push(args); return { mobileFailed: 0, webFailed: 0, fanFailed: 0 } } }), { completed: 1, failed: 0 })
  assert.deepEqual(delivered.map(({checkpoint,...args}) => args),[{ match, type: 'shootout_kick', eventId: 'kick', targetParentLinkIds: ['parent'] }])
  assert.equal(delivered[0].checkpoint.has('mobile:unsent'),false)
  assert.deepEqual(completed,[{ kick_id_value: 'kick', attempt_value: 1, error_value: '' }])
})

test('shootout partial retry sends only unaccepted recipient channels and preserves existing inbox rows', async () => {
  const persisted = new Set(), calls = []
  function checkpoint() {
    const snapshot = new Set(persisted)
    return { has: key => snapshot.has(key), save: async key => { persisted.add(key); snapshot.add(key) } }
  }
  const send = async (channel, shouldFail, saved) => deliverCheckpointedTargets(['one','two','one'], {
    channel, keyFor: target => target, checkpoint: saved,
    send: async target => {
      calls.push(channel + ':' + target)
      if (target === 'two' && shouldFail) throw new Error('Temporary failure')
      return { sent:true }
    }, isComplete: result => result.sent,
  })
  const first = checkpoint()
  assert.equal((await send('web', true, first)).filter(result => result.status === 'rejected').length,1)
  assert.equal((await send('mobile', true, first)).filter(result => result.status === 'rejected').length,1)
  assert.deepEqual([...persisted].sort(),['mobile:one','web:one'])
  const retry = checkpoint()
  assert.equal((await send('web', false, retry)).filter(result => result.status === 'rejected').length,0)
  assert.equal((await send('mobile', false, retry)).filter(result => result.status === 'rejected').length,0)
  assert.deepEqual(calls,['web:one','web:two','mobile:one','mobile:two','web:two','mobile:two'])
  const inbox = []
  const client = { from: () => ({ upsert: (rows, options) => { inbox.push({ rows, options }); return { select: async () => ({ data: [] }) } } }) }
  await writeParentNotificationInbox({client, intentType:'matchday_update', data:{matchDayId:'game',type:'shootout_kick',eventId:'kick'},parentLinks:[{id:'parent',auth_user_id:'user'}]})
  assert.equal(inbox[0].options.ignoreDuplicates,true)
})
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
        : table === 'user_club_memberships' ? profiles.filter(p => p.id === filters.auth_user_id && p.club_id === filters.club_id).map(p => ({ auth_user_id: p.id, role: p.role, role_rank: p.role_rank }))[0]
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
