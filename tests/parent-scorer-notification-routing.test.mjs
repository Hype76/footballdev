import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { deliverParentScorerCommands } from '../netlify/functions/lib/_parent-scorer-command-notifications.js'
import { deliverCoachMatchReviewOnce } from '../netlify/functions/lib/_coach-match-review-delivery.js'
import { getParentNotificationDedupeKey } from '../netlify/functions/lib/_parent-notification-inbox.js'
import { parse } from '@babel/parser'
import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'
import { buildMatchDayNativeMessage } from '../netlify/functions/lib/_match-day-native-message.js'
import { resolveMatchDayNotificationTeamName } from '../src/lib/team-notification-display.js'

test('durable handover claims route only to Coach and retain actor filters, leases and completion', async () => {
  const db = new PGlite()
  const sql = await readFile(new URL('../supabase/migrations/20261012142553_matchday_substitution_and_handover_notifications.sql', import.meta.url),'utf8')
  const claim = sql.slice(sql.indexOf('create or replace function public.claim_parent_scorer_command_notifications'),sql.indexOf('create or replace function public.authorize_match_day_push'))
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema private;
      create table private.parent_scorer_match_day_commands(id uuid primary key, actor_user_id uuid, kind text,notification_type text,
        result jsonb,event_id uuid,notification_completed_at timestamptz,notification_claimed_at timestamptz,
        notification_attempts integer default 0,created_at timestamptz default now());`)
    await db.exec(claim)
    for (const [n,kind] of [[1,'timer'],[2,'request-review']]) await db.query(`insert into private.parent_scorer_match_day_commands(id,actor_user_id,kind,notification_type,result) values($1,$2,$3,'full_time','{"match":{"id":"fixture"}}')`,[id(n),id(3),kind])
    assert.deepEqual((await db.query('select claim_parent_scorer_command_notifications(null,$1) as commands',[id(4)])).rows[0].commands,[])
    const commands = (await db.query('select claim_parent_scorer_command_notifications(null,$1) as commands',[id(3)])).rows[0].commands
    assert.deepEqual(commands.map(c=>[c.kind,c.type]),[['timer','full_time'],['request-review','coach_review']])
    assert.deepEqual((await db.query('select claim_parent_scorer_command_notifications() as commands')).rows[0].commands,[])
    await db.exec("update private.parent_scorer_match_day_commands set notification_claimed_at=now()-interval '3 minutes'")
    assert.equal((await db.query('select claim_parent_scorer_command_notifications($1,null) as commands',[id(2)])).rows[0].commands.length,1)
    await db.exec("update private.parent_scorer_match_day_commands set notification_completed_at=now()")
    assert.deepEqual((await db.query('select claim_parent_scorer_command_notifications() as commands')).rows[0].commands,[])
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select claim_parent_scorer_command_notifications()'),/permission denied/)
  } finally { await db.close() }
})

function harness(commands, { reviewFails = false, deleted = false, status = 'full_time', concludedAt = null } = {}) {
  const calls = [], audience = []
  const client = {
    async rpc(name,args) {
      calls.push([name,args])
      return {data:name==='claim_parent_scorer_command_notifications'?commands:name==='get_match_day_parent_notification_link_ids'?['parent','parent']:name==='claim_match_day_review_push_operation'?{status:status!=='full_time'||concludedAt?'obsolete':'claimed',operationKey:'review-key'}:null}
    },
    from(name) {
      assert.equal(name,'match_days')
      const query={select:()=>query,eq:()=>query,is:()=>query,maybeSingle:async()=>({data:deleted?null:{status,concluded_at:concludedAt,teams:{name:'FP TEST'},clubs:{name:'FP TEST',status:'active'}}})}
      return query
    },
  }
  return { calls, audience, client,
    deliver:async payload=>{audience.push(['family',payload]);return {mobileFailed:0,webFailed:0,fanFailed:0}},
    review:async payload=>{audience.push(['coach',payload]);return {sent:reviewFails?0:1,failed:reviewFails?1:0}},
  }
}

test('Full time sends once to families and handover sends only Coach review, including old pending commands', async()=>{
  const commands=[{id:'full',kind:'timer',type:'full_time',match:{id:'fixture',team_id:'team',status:'full_time'}},
    {id:'review',kind:'request-review',type:'full_time',match:{id:'fixture',team_id:'team',status:'full_time'}}]
  const mock=harness(commands)
  assert.deepEqual(await deliverParentScorerCommands(null,null,mock),{completed:2,failed:0})
  assert.deepEqual(mock.audience.map(([name])=>name),['family','coach'])
  assert.equal(mock.audience[0][1].type,'full_time')
  assert.deepEqual(mock.audience[0][1].targetParentLinkIds,['parent'])
  assert.equal(mock.calls.filter(([name])=>name==='get_match_day_parent_notification_link_ids').length,1)
  assert.equal(mock.calls.filter(([name,args])=>name==='complete_parent_scorer_command_notification'&&!args.error_value).length,2)
})

test('different committed corrections to the same goal retain separate notification identities, and retries retain the same identity',async()=>{
  const commands=['correct','remove'].map(id=>({id,kind:id==='correct'?'correct-goal':'void-goal',type:'score_correction',eventId:'same-goal',match:{id:'fixture',home_score:id==='correct'?1:0,away_score:0}}))
  const mock=harness(commands)
  assert.deepEqual(await deliverParentScorerCommands(null,null,mock),{completed:2,failed:0})
  assert.deepEqual(mock.audience.map(([,payload])=>payload.notificationId),['correct','remove'])
  const key=id=>getParentNotificationDedupeKey({intentType:'matchday_update',parentLinkId:'parent',data:{eventId:'same-goal',matchDayId:'fixture',type:'score_correction',notificationId:id}})
  assert.notEqual(key('correct'),key('remove'))
  assert.equal(key('correct'),key('correct'))
})

test('actual correction dispatch carries the corrected score and command identity through web, native, inbox and Fan delivery',async()=>{
  const source=await readFile(new URL('../netlify/functions/send-match-day-push.js',import.meta.url),'utf8')
  const declaration=parse(source,{sourceType:'module'}).program.body.map(node=>node.declaration||node).find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='deliverMatchDayNotification')
  const web=[],native=[],inbox=[],fans=[]
  const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:'goal',event_type:'goal',team_side:'club'}})}
  const dependencies={supabaseAdmin:{from:()=>query},configureWebPush:()=>true,getAppNotificationParentLinks:async()=>[{id:'parent',auth_user_id:'account'}],getSubscriptions:async()=>[{}],getMobileDevices:async()=>[{expo_push_token:'ExpoPushToken[fixture]',parent_link_id:'parent',detail_level:'detailed'}],sendToSubscription:async(_subscription,payload)=>{web.push(payload);return{sent:true}},buildParentMatchDayNotificationCopy,resolveMatchDayNotificationTeamName,normalizeText:value=>String(value||'').trim(),writeParentNotificationInbox:async payload=>{inbox.push(payload);return{available:1}},sendExpoPushMessages:async messages=>{native.push(...messages);return{sent:messages.length,failed:0}},revokeMobileDeviceTokens:async()=>{},sendFanMatchNotifications:async payload=>{fans.push(payload);return{fanSent:0,fanFailed:0}},buildMatchDayNativeMessage}
  const deliver=new Function(...Object.keys(dependencies),`${source.slice(declaration.start,declaration.end)};return deliverMatchDayNotification`)(...Object.values(dependencies))
  const match={id:'fixture',team_id:'team',club_id:'club',home_score:1,away_score:0,home_away:'home',opponent:'Visitors',teams:{name:'FP TEST'},clubs:{name:'FP TEST Club'}}
  for(const notificationId of ['correct','remove','correct'])await deliver({match,type:'score_correction',eventId:'goal',notificationId,targetParentLinkIds:['parent']})
  assert.notEqual(web[0].tag,web[1].tag)
  assert.equal(web[0].tag,web[2].tag)
  assert.equal(native[0].title,'FP TEST v Visitors')
  assert.match(native[0].body,/score was corrected/)
  assert.match(native[0].body,/1 - 0/)
  assert.equal(native[0].data.notificationId,'correct')
  assert.equal(native[1].data.notificationId,'remove')
  assert.equal(inbox[0].data.notificationId,'correct')
  assert.equal(fans[1].notificationId,'remove')
})

test('delayed handover alerts finish quietly after a Coach resumes or concludes the match',async()=>{
  for (const options of [{status:'live'},{concludedAt:'2026-10-12T15:00:00Z'}]) {
    const mock=harness([{id:'review',kind:'request-review',type:'coach_review',match:{id:'fixture',status:'full_time',concluded_at:null}}],options)
    assert.deepEqual(await deliverParentScorerCommands(null,null,mock),{completed:1,failed:0})
    assert.deepEqual(mock.audience,[])
  }
})

test('failed Coach review stays pending and never falls back to another full-time broadcast',async()=>{
  const command={id:'review',kind:'request-review',type:'coach_review',match:{id:'fixture'}}
  for (const options of [{reviewFails:true},{deleted:true}]) {
    const mock=harness([command],options)
    assert.deepEqual(await deliverParentScorerCommands(null,null,mock),{completed:0,failed:1})
    assert.equal(mock.audience.filter(([name])=>name==='family').length,0)
    assert.equal(mock.calls.filter(([name])=>name==='get_match_day_parent_notification_link_ids').length,0)
    assert.ok(mock.calls.find(([name])=>name==='complete_parent_scorer_command_notification')[1].error_value)
  }
})

test('durable and legacy review routes share completion and keep active delivery pending',async()=>{
  let state='claimed',sends=0
  const client={rpc:async name=>{
    if(name==='claim_match_day_review_push_operation')return {data:{status:state,operationKey:'same-handover'}}
    assert.equal(name,'complete_match_day_push_operation');state='completed';return {}
  }}
  const params={client,match:{id:'fixture'},actorUserId:'actor',review:async()=>{sends++;return {sent:1,failed:0}}}
  assert.equal((await deliverCoachMatchReviewOnce(params)).sent,1)
  assert.equal((await deliverCoachMatchReviewOnce(params)).skipped,true)
  assert.equal(sends,1)
  state='processing'
  await assert.rejects(deliverCoachMatchReviewOnce(params),/still being confirmed/)
  assert.equal(sends,1)
})
