import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAuthoritativeCalendarNotificationContext, prepareScheduledCalendarNotificationRow } from '../netlify/functions/lib/_calendar-notification-email.js'
import { buildPreparedScheduledEmail } from '../netlify/functions/lib/_scheduled-email-payload.js'

function fixture() {
  const row = { id:'queue',club_id:'club',team_id:'team',to_email:'adult@example.test',payload:{ communicationLog:{metadata:{source:'calendar_adult_event_notification'}} } }
  const tables = {
    calendar_event_notification_events:{id:'notification',email_queue_id:'queue',club_id:'club',team_id:'team',calendar_event_id:'event',player_id:'player',recipient_email:row.to_email,notification_type:'creation',parent_link_id:null,status:'queued'},
    calendar_events:{id:'event',club_id:'club',team_id:'team',event_type:'general',title:'Team meeting',starts_at:'2099-01-01T12:00:00Z',parent_visible:true,parent_audience:'involved_players',cancelled_at:null},
    calendar_event_invites:{id:'invite',club_id:'club',team_id:'team',calendar_event_id:'event',player_id:'player',recipient_type:'player',player_contact_email:row.to_email,invite_status:'active',cancelled_at:null},
    players:{id:'player',club_id:'club',team_id:'team',player_name:'Alex'},
    clubs:{id:'club',name:'Club'}, teams:{id:'team',club_id:'club',name:'Team'},
  }
  let current = true
  const client = { from(table) { let value=tables[table]; const q={select:()=>q,eq:(key,v)=>{if(value?.[key]!==v)value=null;return q},maybeSingle:async()=>({data:value,error:null})};return q },
    rpc:async name=>name==='is_adult_calendar_notification_current'?{data:current}:{data:{teamId:'team',clubId:'club',source:'paid_club',logoAllowed:true,coloursAllowed:true,logoUrl:'https://example.test/logo.png'}} }
  return { row,tables,client,revoke:()=>{current=false} }
}

test('authorized adult queue rechecks scope and builds Player Calendar action', async()=>{
  const f=fixture(); const context=await loadAuthoritativeCalendarNotificationContext(f.client,f.row)
  assert.equal(context.sendable,true); assert.equal(context.adultInvitation,true); assert.equal(context.portalUrl,'https://footballplayer.online/player')
  const prepared=await prepareScheduledCalendarNotificationRow(f.row,{supabaseClient:f.client,fetchImpl:async()=>new Response('',{status:200,headers:{'content-type':'image/png'}})})
  assert.equal(prepared.skipped,false); assert.match(prepared.row.payload.resendPayload.html,/Open Player Calendar/)
  assert.equal(prepared.row.payload.resendPayload.emailAppRole,'none')
  assert.equal(buildPreparedScheduledEmail(prepared.row,{}).emailPayload.emailAppRole,'none')
})
for(const change of ['revoked','wrong email','cancelled invite','hidden event','wrong recipient type']) test(`adult queue rejects ${change}`,async()=>{
  const f=fixture()
  if(change==='revoked')f.revoke()
  if(change==='wrong email')f.tables.calendar_event_invites.player_contact_email='different@example.test'
  if(change==='cancelled invite')f.tables.calendar_event_invites.invite_status='cancelled'
  if(change==='hidden event')f.tables.calendar_events.parent_visible=false
  if(change==='wrong recipient type')f.tables.calendar_event_invites.recipient_type='parent_guardian'
  assert.equal((await loadAuthoritativeCalendarNotificationContext(f.client,f.row)).sendable,false)
})

test('one shared Parent and Player address gets both authorized destinations',async()=>{
  const f=fixture()
  f.row.payload.communicationLog.metadata.source='calendar_event_notification'
  f.tables.calendar_event_notification_events.parent_link_id='parent'
  f.tables.parent_player_links={id:'parent',auth_user_id:'account',club_id:'club',team_id:'team',player_id:'player',email:f.row.to_email,status:'active'}
  f.tables.users={id:'account',club_id:'club',name:'Alex',status:'active'}
  f.tables.calendar_event_invites.recipient_type='parent_and_player'
  f.tables.players.status='active'
  const context=await loadAuthoritativeCalendarNotificationContext(f.client,f.row)
  assert.equal(context.sendable,true)
  assert.match(context.portalUrl,/parent-portal/)
  assert.equal(context.adultPortalUrl,'https://footballplayer.online/player')
  const prepared=await prepareScheduledCalendarNotificationRow(f.row,{supabaseClient:f.client,fetchImpl:async()=>new Response('',{status:200,headers:{'content-type':'image/png'}})})
  assert.match(prepared.row.payload.resendPayload.html,/open your Player Calendar/)
  delete f.tables.users
  f.client.auth={admin:{getUserById:async()=>({data:{user:{id:'account',email:f.row.to_email,email_confirmed_at:'2026-01-01T00:00:00Z'}}})}}
  const authOnly=await loadAuthoritativeCalendarNotificationContext(f.client,f.row)
  assert.equal(authOnly.sendable,true)
  assert.equal(authOnly.adultPortalUrl,'https://footballplayer.online/player')
  f.revoke()
  assert.equal((await loadAuthoritativeCalendarNotificationContext(f.client,f.row)).adultPortalUrl,'')
  f.client.rpc=async()=>({data:null,error:new Error('temporary authority lookup failure')})
  await assert.rejects(prepareScheduledCalendarNotificationRow(f.row,{supabaseClient:f.client}),/temporary authority lookup failure/)
})
