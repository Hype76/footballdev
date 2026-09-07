import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { allowsMobileNotification, normalizeNotificationCategories } from '../apps/mobile-core/src/notificationCategories.js'
import { filterMobileNotificationMessages } from '../netlify/functions/lib/_mobile-notification-preferences.js'
import { sendExpoPushMessages } from '../netlify/functions/lib/_expo-push.js'

test('requested defaults and every Game Day level have independent category behaviour', () => {
  assert.deepEqual(normalizeNotificationCategories(), { gameDay: 'scores_cards', invites: true, chats: true, resources: true })
  const scoreTypes = ['goal','score_correction','yellow_card','red_card']
  const fullTypes = ['match_started','pause','resume','hydration','half_time','full_time','conclude','substitution','extra_time','penalty_shootout']
  for (const type of [...scoreTypes, ...fullTypes]) {
    const data = { route: 'matchday', type }
    assert.equal(allowsMobileNotification({ gameDay: 'off' }, data), false, type)
    assert.equal(allowsMobileNotification({ gameDay: 'full' }, data), true, type)
    assert.equal(allowsMobileNotification(undefined, data), scoreTypes.includes(type), type)
  }
  for (const [key, data] of [
    ['invites',{ route:'matchday',type:'scorer_request' }], ['invites',{route:'invites',type:'matchday_availability'}],
    ['invites',{route:'matchday',type:'scorer_selected'}], ['invites',{route:'matchday',type:'scorer_volunteer'}],
    ['invites',{route:'calendar',type:'calendar_change'}], ['invites',{route:'sessions',type:'training_availability_response'}],
    ['chats',{route:'chat',type:'staff_chat'}], ['chats',{route:'messages',type:'parent_message'}],
    ['chats',{route:'polls',type:'poll_results'}], ['resources',{route:'resources',type:'resource_shared'}],
  ]) {
    assert.equal(allowsMobileNotification({ gameDay:'off' },data),true)
    assert.equal(allowsMobileNotification({ [key]:false },data),false)
  }
})

function database(preferences = []) {
  const rows = {
    parent_mobile_push_installations: [
      { auth_user_id:'one',expo_push_token:'ExpoPushToken[one]',enabled:true,status:'active',detail_level:'minimal' },
      { auth_user_id:'two',expo_push_token:'ExpoPushToken[two]',enabled:true,status:'active',detail_level:'detailed' },
      { auth_user_id:'three',expo_push_token:'ExpoPushToken[three]',enabled:false,status:'active',detail_level:'minimal' },
    ],
    coach_mobile_push_installations: [{auth_user_id:'one',expo_push_token:'ExpoPushToken[coach]',enabled:true,status:'active',detail_level:'minimal'}],
    mobile_notification_preferences: preferences,
  }
  return { from(table) { let selected = rows[table]; return {
    select(){return this}, eq(key,value){ selected=selected.filter(row=>row[key]===value);return this },
    in(key,values){ selected=selected.filter(row=>values.includes(row[key]));return this },
    then(resolve){return Promise.resolve({data:selected,error:null}).then(resolve)},
  } } }
}

test('delivery rechecks account and app choices, including queued alerts, without sending suppressed pushes', async () => {
  const preferences = [{auth_user_id:'one',app:'parent',game_day:'full',chats:false,invites:true,resources:false}]
  const client = database(preferences)
  const message = (id,type='staff_chat',app='parent',route='chat') => ({to:`ExpoPushToken[${id}]`,data:{app,route,type}})
  const messages = [message('one'),message('two'),message('three'),message('coach','staff_chat','coach'),message('missing')]
  const allowed = await filterMobileNotificationMessages(messages,client)
  assert.deepEqual(allowed.map(row=>row.to),['ExpoPushToken[two]','ExpoPushToken[coach]'])
  assert.equal((await filterMobileNotificationMessages([message('one','substitution','parent','matchday')],client)).length,1)
  preferences[0].game_day='off'
  assert.equal((await filterMobileNotificationMessages([message('one','goal','parent','matchday')],client)).length,0)
  const originalFetch = globalThis.fetch
  const sent = []
  globalThis.fetch = async (url,options) => { sent.push(...JSON.parse(options.body)); return Response.json({data:[{status:'ok'},{status:'ok'}]}) }
  try {
    assert.deepEqual(await sendExpoPushMessages(messages,{client}),{skipped:3,sent:2,failed:0,invalidTokens:[]})
    assert.deepEqual(sent.map(row=>row.to),['ExpoPushToken[two]','ExpoPushToken[coach]'])
    sent.length=0
    assert.deepEqual(await sendExpoPushMessages([message('one')],{client}),{sent:0,failed:0,invalidTokens:[],skipped:1})
    assert.equal(sent.length,0)
    const broken = {from(){return {select(){return this},in(){return Promise.resolve({error:new Error('unavailable')})}}}}
    await assert.rejects(sendExpoPushMessages([message('two')],{client:broken}),/unavailable/)
    assert.equal(sent.length,0)
  } finally { globalThis.fetch=originalFetch }
})

test('database enforces account isolation, atomic field updates, defaults and strict inputs', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20260907124940_mobile_notification_categories.sql',import.meta.url),'utf8'))
    await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false)")
    const save=async(app,key,value)=>(await db.query('select public.set_mobile_notification_preference($1,$2,$3) as value',[app,key,JSON.stringify(value)])).rows[0].value
    assert.deepEqual(await save('parent','chats',false),{gameDay:'scores_cards',invites:true,chats:false,resources:true})
    assert.deepEqual(await save('parent','gameDay','full'),{gameDay:'full',invites:true,chats:false,resources:true})
    assert.deepEqual(await save('coach','resources',false),{gameDay:'scores_cards',invites:true,chats:true,resources:false})
    for(const args of [['web','chats',true],['parent','unknown',false],['parent','chats','false'],['coach','gameDay','detailed'],['coach','gameDay',null]]) await assert.rejects(save(...args),/Invalid/)
    await assert.rejects(db.exec("update public.mobile_notification_preferences set chats=true"),/permission denied/)
    await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false)")
    assert.equal((await db.query('select * from public.mobile_notification_preferences')).rows.length,0)
    assert.deepEqual(await save('parent','invites',false),{gameDay:'scores_cards',invites:false,chats:true,resources:true})
    await db.exec("select set_config('request.jwt.claim.sub','',false)")
    await assert.rejects(save('parent','chats',true),/Sign in/)
    await db.exec('reset role; set role anon')
    await assert.rejects(save('parent','chats',true),/permission denied/)
  } finally { await db.close() }
})
