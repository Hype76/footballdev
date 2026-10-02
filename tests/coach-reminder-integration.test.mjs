import assert from 'node:assert/strict'
import test from 'node:test'
import {createCoachReminderTransport} from '../netlify/functions/lib/_coach-reminder-transport.js'
import processor from '../netlify/functions/process-team-coach-reminders.js'
import {runCoachReminderProcessor} from '../netlify/functions/lib/_coach-reminder-processor.js'
import {normalizeCoachReminderContext} from '../netlify/functions/lib/_coach-reminder-repository.js'
import {readCoachReminderProjections,projectCoachReminderMatches,findCoachReminderProjection,coachReminderInvitationOccurrence} from '../src/lib/coach-reminder-read-model.js'

const notification=(changes={})=>({idempotencyKey:'stable-key',audience:'availability',deliveryContext:{
 job:{action:'availability_reminder',kind:'MATCH',clubId:'club',teamId:'team',eventId:'event',playerId:'player'},
 target:{id:'recipient',parentLinkId:'link',email:'parent@example.test',emailAllowed:true,appAllowed:true},event:{startsAt:'2026-10-10T12:00:00Z'},...changes}})
function channelFixture({removed=false,optOut=false,devices=[]}={}){
 const calls=[],client={from(table){const query={select(){return this},eq(){return this},neq(){return this},maybeSingle(){return this},
  upsert(row,options){calls.push({table,row,options});return this},then(resolve){return Promise.resolve(resolve({error:null,data:table==='parent_player_links'?removed?null:{id:'link',auth_user_id:'parent'}:table==='mobile_notification_preferences'?{invites:!optOut}:table.endsWith('_push_installations')?devices:[]}))}};return query}}
 const transport=createCoachReminderTransport({client,assertPlan:async()=>{},inbox:async args=>{calls.push({inbox:args});return {available:1}},
  email:async(payload,options)=>{calls.push({email:payload,options});return {data:{id:'provider'}}},push:async messages=>{calls.push({push:messages});return {sent:messages.length,failed:0}}})
 return {calls,transport}
}
test('disabled processor fails closed before authentication, database or provider construction',async()=>{
 assert.equal((await processor(new Request('http://localhost/processor',{method:'POST'}))).status,503)
})
test('delivery obeys existing app/email preferences and removed links; secure keys do not expose contact data',async()=>{
 const app=channelFixture(),appOnly=notification();appOnly.deliveryContext.target.emailAllowed=false
 await app.transport.send(appOnly);assert.equal(app.calls.length,1);assert.ok(app.calls[0].inbox)
 const email=channelFixture(),emailOnly=notification();emailOnly.deliveryContext.target.appAllowed=false
 await email.transport.send(emailOnly);assert.equal(email.calls.length,1);assert.ok(email.calls[0].email)
 assert.doesNotMatch(email.calls[0].options.idempotencyKey,/parent@example|link/)
 const optedOut=channelFixture({optOut:true});assert.equal((await optedOut.transport.send(appOnly)).skipped,true);assert.equal(optedOut.calls.length,0)
 const removed=channelFixture({removed:true});assert.equal((await removed.transport.send(notification())).reason,'recipient_removed');assert.equal(removed.calls.length,0)
})
test('Coach delivery uses scoped durable inbox and existing push contract; no Coach email fallback',async()=>{
 const fixture=channelFixture({devices:[{expo_push_token:'ExpoPushToken[fixture]',detail_level:'minimal'}]})
 const coach=notification({target:{id:'coach'},job:{kind:'MATCH',action:'squad_reminder',eventId:'event',clubId:'club',teamId:'team'}});coach.audience='coach'
 await fixture.transport.send(coach)
 assert.equal(fixture.calls[0].table,'coach_mobile_notification_events');assert.equal(fixture.calls[0].row.intent_type,'coach_update')
 assert.equal(fixture.calls[0].options.ignoreDuplicates,true);assert.equal(fixture.calls[1].push[0].data.route,'matchday')
 assert.equal(fixture.calls.some(call=>call.email),false)
 const optedOut=channelFixture({optOut:true});assert.equal((await optedOut.transport.send(coach)).skipped,true)
})
test('missing delivery context and uncertain provider acceptance cannot claim successful delivery',async()=>{
 const fixture=channelFixture();await assert.rejects(fixture.transport.send({}),/freshly validated/)
 const transport=createCoachReminderTransport({client:{},assertPlan:async()=>{},email:async()=>({})})
 const emailOnly=notification({target:{emailAllowed:true,email:'adult@example.test',appAllowed:false}})
 await assert.rejects(transport.send(emailOnly),/uncertain/)
})
test('a late answer between accepted app delivery and email suppresses the later channel',async()=>{
 const fixture=channelFixture(),value=notification();let reads=0
 value.deliveryContext.refresh=async()=>({valid:++reads===1,target:value.deliveryContext.target})
 const receipt=await fixture.transport.send(value)
 assert.equal(receipt.accepted,true);assert.equal(fixture.calls.length,1);assert.ok(fixture.calls[0].inbox)
})
test('processor interruption leaves durable jobs for a later run and uses one explicit clock',async()=>{
 let clock=0,stores=0,queries=[]
 const repository={discoverCandidates:async()=>[1,2],planCandidate:async()=>{clock=20;return [{}]},storeJobs:async()=>{stores++},pendingJobs:async(limit,now)=>{queries.push([limit,now]);return []},pendingNotifications:async()=>[]}
 const result=await runCoachReminderProcessor({repository,transport:{},clock:()=>new Date(clock).toISOString(),budgetMs:10})
 assert.equal(result.interrupted,true);assert.equal(stores,1);assert.equal(queries[0][1],new Date(20).toISOString())
})
test('read projection preserves explicit/request records, scopes children and recurrence, and makes no RPC when off',async()=>{
 let calls=0;const client={rpc:async()=>{calls++;return {data:[],error:null}}}
 assert.deepEqual(await readCoachReminderProjections(client,'MATCH',['event']),[]);assert.equal(calls,0)
 await readCoachReminderProjections(client,'MATCH',Array.from({length:201},(_,i)=>String(i)),{enabled:true,parentLinkId:'child-link'});assert.equal(calls,3)
 const matches=[{id:'event',playerAvailability:[{playerId:'player',status:'pending'}],availabilityRequests:[{playerId:'player',status:'processing'}]}]
 const projections=[{eventId:'event',playerId:'player',status:'unavailable',automatic:true,provenance:'coach_deadline_automation',planningExcluded:true}]
 const result=projectCoachReminderMatches(matches,projections)
 assert.equal(result[0].playerAvailability[0].availabilityProvenance,'coach_deadline_automation');assert.equal(result[0].availabilityRequests[0].status,'processing')
 assert.equal(matches[0].playerAvailability[0].status,'pending');assert.equal(projectCoachReminderMatches(matches,[]),matches)
 assert.equal(findCoachReminderProjection(projections,{eventId:'event',playerId:'other'}),undefined)
 assert.equal(findCoachReminderProjection([{...projections[0],occurrenceDate:'2026-10-10'}],{eventId:'event',playerId:'player',occurrenceDate:'2026-10-17'}),undefined)
 assert.equal(coachReminderInvitationOccurrence({invitationType:'training_attendance',eventStart:'2026-10-24T23:30:00Z'}),'2026-10-25')
})
test('training canonical reschedules invalidate removed occurrences and ambiguous DST starts',()=>{
 const job={kind:'TRAINING',occurrenceDate:'2026-10-25'}
 const event={id:'event',club_id:'club',team_id:'team',event_type:'training',starts_at:'2026-10-18T00:30:00Z',ends_at:'2026-10-18T01:30:00Z',recurrence_frequency:'weekly',recurrence_until:'2026-11-01',deleted_occurrence_dates:[]}
 assert.equal(normalizeCoachReminderContext({event},job).event.startsAt,'')
 assert.equal(normalizeCoachReminderContext({event:{...event,starts_at:'2026-10-19T12:00:00Z',ends_at:'2026-10-19T13:00:00Z'}},job).event.startsAt,'')
 const revised=normalizeCoachReminderContext({event:{...event,starts_at:'2026-10-18T12:00:00Z',ends_at:'2026-10-18T13:00:00Z'}},job)
 assert.equal(revised.event.startsAt,'2026-10-25T13:00:00.000Z')
})
