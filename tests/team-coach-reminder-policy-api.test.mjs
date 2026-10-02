import assert from 'node:assert/strict'
import test from 'node:test'
import { createTeamCoachReminderPolicyHandler } from '../netlify/functions/lib/_team-coach-reminder-policy.js'
import { handler as disabledHandler } from '../netlify/functions/team-coach-reminder-policy.js'
import { DEFAULT_COACH_REMINDER_POLICY } from '../src/lib/coach-reminder-policy.js'
import { createTeamCoachReminderSettingsStore } from '../src/lib/team-coach-reminder-settings-store.js'
import { resolveCoachAvailabilityReminderRecipients } from '../netlify/functions/lib/_coach-reminder-recipients.js'

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const club=id(1),team=id(2),coach=id(3),requestId=id(4)
function fixture() {
  const state={ enabled:true,calls:[],team:true,rank:20,error:null,profile:{ id:coach,club_id:club,role:'coach',role_rank:20 } }
  const row={ id:id(5),club_id:club,team_id:team,revision:1,options:{ ...DEFAULT_COACH_REMINDER_POLICY,reminderEnabled:true,reminderAfterHours:12 },opted_in:true,configured_at:'2026-10-02T00:00:00Z',effective_from:'2026-10-02T00:00:00Z' }
  const requestClient={ auth:{ getUser:async()=>({ data:{ user:{ id:coach } } }) },from(table){ return {
    select(){ return this },eq(){ return this },is(){ return this },maybeSingle:async()=>({ data:table==='teams' ? state.team ? { id:team,club_id:club } : null : table==='team_staff' ? { role_rank:state.rank } : null }),
  } },rpc:async(name,args)=>{ state.calls.push({ name,args }); return { data:{ policy:row,duplicate:false },error:state.error } } }
  const handler=createTeamCoachReminderPolicyHandler({ enabled:()=>state.enabled,createClients:async()=>{ state.calls.push('clients');return { requestClient,adminClient:{} } },loadAuthority:async()=>state.profile })
  const event=body=>({ httpMethod:'POST',headers:{ authorization:'Bearer fixture','content-type':'application/json' },body:JSON.stringify(body) })
  const save={ action:'save',teamId:team,expectedRevision:0,requestId,options:row.options,optedIn:true }
  return { state,row,handler,event,save }
}

test('default release gate blocks before constructing clients; read never creates a policy',async()=>{
  const f=fixture();f.state.enabled=false
  assert.equal((await f.handler(f.event(f.save))).statusCode,503);assert.deepEqual(f.state.calls,[])
  assert.equal((await disabledHandler(f.event(f.save))).statusCode,503)
  f.state.enabled=true
  const loaded=JSON.parse((await f.handler(f.event({ action:'get',teamId:team }))).body)
  assert.equal(loaded.policy.revision,0);assert.equal(loaded.policy.optedIn,false);assert.equal(loaded.policy.options.reminderAfterHours,null)
  assert.equal(loaded.deliveryEnabled,false);assert.equal(f.state.calls.filter(call=>call.name).length,0)
})
test('authenticated save uses the user-scoped RPC and rejects incomplete timing and unsupported scope',async()=>{
  const f=fixture();const result=await f.handler(f.event(f.save))
  assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).policy.teamId,team)
  assert.equal(f.state.calls[1].name,'save_team_coach_reminder_policy_v1')
  assert.equal(f.state.calls[1].args.target_club_id,club)
  for(const patch of [{ options:{ ...f.row.options,reminderAfterHours:null } },{ optedIn:'true' },{ expectedRevision:-1 },{ requestId:'' },{ clubId:id(99) }]) {
    assert.equal((await f.handler(f.event({ ...f.save,...patch }))).statusCode,400)
  }
  f.state.profile.role='parent_portal';assert.equal((await f.handler(f.event(f.save))).statusCode,403)
  f.state.profile.role='coach';f.state.rank=0;assert.equal((await f.handler(f.event(f.save))).statusCode,403)
  f.state.rank=20;f.state.team=false;assert.equal((await f.handler(f.event(f.save))).statusCode,403)
})
test('stale saves have an actionable conflict message, and database failures are not reported as success',async()=>{
  const f=fixture();f.state.error={ code:'40001' }
  const conflict=await f.handler(f.event(f.save));assert.equal(conflict.statusCode,409);assert.match(JSON.parse(conflict.body).message,/Reload/)
  f.state.error={ code:'database_error',message:'private details' }
  const failure=await f.handler(f.event(f.save));assert.equal(failure.statusCode,500);assert.doesNotMatch(failure.body,/private details/)
  const event=f.event(f.save);delete event.headers.authorization;assert.equal((await f.handler(event)).statusCode,401)
})
test('settings store coalesces repeat clicks, reuses retry identity, handles conflicts and isolates teams',async()=>{
  let writes=0, mode='wait',release
  const policy={ id:id(5),clubId:club,teamId:team,revision:0,options:DEFAULT_COACH_REMINDER_POLICY,optedIn:false }
  const commands=[]
  const request=async command=>{
    if(command.action==='get')return { policy,deliveryEnabled:false }
    commands.push(command);writes++
    if(mode==='wait')await new Promise(resolve=>{ release=resolve })
    if(mode==='failure')throw new Error('Connection interrupted')
    if(mode==='conflict')throw Object.assign(new Error('Another Coach changed settings. Reload.'),{ statusCode:409 })
    return { policy:{ ...policy,revision:1,options:command.options,optedIn:command.optedIn },deliveryEnabled:false }
  }
  const store=createTeamCoachReminderSettingsStore({ clubId:club,teamId:team,request,createRequestId:()=>requestId })
  await store.load();store.edit({ options:{ ...DEFAULT_COACH_REMINDER_POLICY,reminderEnabled:true,reminderAfterHours:12 },optedIn:true })
  const one=store.save(),two=store.save();assert.equal(one,two);assert.equal(writes,1)
  store.edit({ optedIn:false });assert.equal(store.getSnapshot().optedIn,true)
  release();await one;assert.equal(store.getSnapshot().policy.revision,1)
  mode='failure';await store.save();const retry=commands.at(-1)
  mode='success';await store.save();assert.deepEqual(commands.at(-1),retry)
  mode='conflict';await store.save();assert.equal(store.getSnapshot().needsReload,true)
  const before=writes;await store.save();assert.equal(writes,before)
  await store.load();assert.equal(store.getSnapshot().needsReload,false)
  const other=createTeamCoachReminderSettingsStore({ clubId:club,teamId:id(9),request,createRequestId:()=>requestId })
  assert.equal(await other.load(),false);assert.match(other.getSnapshot().error,/different team/)
})
test('existing eligibility and app/email/both preferences are reused; removed links and failed reads are suppressed',async()=>{
  for(const channel of ['app','email','both']) {
    let failure=false,removed=false
    const client={ rpc:async()=>({ data:[{ player_id:id(8),recipient_email:'parent@example.invalid',parent_link_id:id(7),recipient_type:'parent' }] }),from(table){return{
      select(){return this},eq(){return this},in(){return this},then(resolve,reject){return Promise.resolve({ error:failure ? Error('Read failed') : null,data:table==='parent_player_links' ? removed ? [] : [{ id:id(7),auth_user_id:id(6),player_id:id(8) }] : [{ auth_user_id:id(6),communication_channel:channel }] }).then(resolve,reject)},
    }} }
    const args={ clubId:club,teamId:team,playerId:id(8) }
    const [recipient]=await resolveCoachAvailabilityReminderRecipients(client,args)
    assert.equal(recipient.emailAllowed,channel!=='app');assert.equal(recipient.appAllowed,channel!=='email')
    removed=true;assert.deepEqual(await resolveCoachAvailabilityReminderRecipients(client,args),[])
    removed=false;failure=true;await assert.rejects(resolveCoachAvailabilityReminderRecipients(client,args),/Read failed/)
  }
})
