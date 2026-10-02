import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {normalizeCoachInvite,collapseCoachInvitesByPlayer,summarizeCoachInvites} from '../apps/mobile-core/src/coachPhase31ECore.js'
import {normalizeCoachCalendarFormDate} from '../apps/mobile-core/src/coachCalendarCore.js'
import {DEFAULT_COACH_REMINDER_POLICY,planAvailabilityAutomation} from '../src/lib/coach-reminder-policy.js'
import {authorizeProcessorRequest} from '../netlify/functions/lib/_processor-auth.js'
import {createCoachReminderTransport} from '../netlify/functions/lib/_coach-reminder-transport.js'
import processor from '../netlify/functions/process-team-coach-reminders.js'
import {runCoachReminderProcessor} from '../netlify/functions/lib/_coach-reminder-processor.js'
import {createCoachReminderDeadline} from '../netlify/functions/lib/_coach-reminder-deadline.js'
import {createClient} from '@supabase/supabase-js'
import {sendEmail} from '../netlify/functions/lib/_email-provider.js'
import {Resend} from 'resend'
import {sendExpoPushMessages} from '../netlify/functions/lib/_expo-push.js'
import {normalizeCoachReminderContext} from '../netlify/functions/lib/_coach-reminder-repository.js'
import {readCoachReminderProjections,projectCoachReminderMatches,applyCoachReminderProjection,findCoachReminderProjection,coachReminderInvitationOccurrence} from '../src/lib/coach-reminder-read-model.js'

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

test('reminder scheduler requires authenticated POST JSON and rejects native schedule payloads before client construction',async()=>{
 const previousFlag=process.env.ENABLE_COACH_REMINDER_AUTOMATION,previousSecret=process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET
 try{
   process.env.ENABLE_COACH_REMINDER_AUTOMATION='true';process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET='local-fixture-secret'
   const headers={'content-type':'application/json',authorization:'Bearer local-fixture-secret'}
   assert.equal(authorizeProcessorRequest({httpMethod:'POST',headers,body:'{}'}).ok,true)
   assert.equal((await processor(new Request('http://localhost/processor',{headers}))).status,405)
   assert.equal((await processor(new Request('http://localhost/processor',{method:'POST',headers:{'content-type':'application/json','x-netlify-event':'schedule'},body:JSON.stringify({next_run:'2026-10-04T00:00:00Z'})}))).status,401)
   for(const body of ['{"next_run":"2026-10-04T00:00:00Z"}','null','[]','"value"'])assert.equal((await processor(new Request('http://localhost/processor',{method:'POST',headers,body}))).status,400)
 }finally{
   if(previousFlag===undefined)delete process.env.ENABLE_COACH_REMINDER_AUTOMATION;else process.env.ENABLE_COACH_REMINDER_AUTOMATION=previousFlag
   if(previousSecret===undefined)delete process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET;else process.env.FOOTBALL_PLAYER_SCHEDULER_SECRET=previousSecret
 }
})
test('delivery obeys existing app/email preferences and removed links; secure keys do not expose contact data',async()=>{
 const app=channelFixture(),appOnly=notification();appOnly.deliveryContext.target.emailAllowed=false
 await app.transport.send(appOnly);assert.equal(app.calls.length,1);assert.ok(app.calls[0].inbox)
 const email=channelFixture(),emailOnly=notification();emailOnly.deliveryContext.target.appAllowed=false
 await email.transport.send(emailOnly);assert.equal(email.calls.length,1);assert.ok(email.calls[0].email)
 assert.equal(email.calls[0].email.emailAppRole,'parent')
 assert.doesNotMatch(email.calls[0].options.idempotencyKey,/parent@example|link/)
 const optedOut=channelFixture({optOut:true});assert.equal((await optedOut.transport.send(appOnly)).skipped,true);assert.equal(optedOut.calls.length,0)
 const removed=channelFixture({removed:true});assert.equal((await removed.transport.send(notification())).reason,'recipient_removed');assert.equal(removed.calls.length,0)
})
test('Coach delivery uses scoped durable inbox and existing push contract; no Coach email fallback',async()=>{
 const fixture=channelFixture({devices:[{expo_push_token:'ExpoPushToken[fixture]',detail_level:'minimal'}]})
 const coach=notification({target:{id:'coach',email:'coach@example.test',emailAllowed:true},job:{kind:'MATCH',action:'squad_reminder',eventId:'event',clubId:'club',teamId:'team'}});coach.audience='coach'
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
 assert.equal(result.interrupted,true);assert.equal(stores,1);assert.equal(queries.length,0,'No further stage queries after the budget is consumed')
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

function nativeLoader(file,start,end,dependencies){
 const source=readFileSync(file,'utf8'),from=source.indexOf(start),to=source.indexOf(end,from)
 assert.ok(from>=0 && to>from)
 const body=source.slice(from,to).replace('export ','')
 return new Function(...Object.keys(dependencies),body+`;return ${start.match(/function (\w+)/)[1]}`)(...Object.values(dependencies))
}

function processorProgressFixture({count=3,slowPlanning=false,slowScan=false,slowJobs=false,slowOutbox=false}={}){
 let elapsed=0,phase=0,cursor=0
 const jobs=new Map(),notifications=new Map(),planned=[],sent=[],limits=[],base=Date.parse('2026-10-04T00:00:00Z')
 const clock=()=>new Date(base+elapsed).toISOString()
 const context=id=>({policy:{id:'policy',revision:'1',clubId:'club',teamId:'team',optedIn:true,configuredAt:'2026-10-01T00:00:00Z',effectiveFrom:'2026-10-01T00:00:00Z',options:{...DEFAULT_COACH_REMINDER_POLICY,deadlineMode:'automatic_not_attending',deadlineAfterHours:2}},
   event:{id:`event-${id}`,revision:'1',clubId:'club',teamId:'team',kind:'MATCH',status:'scheduled',startsAt:'2026-10-10T12:00:00Z'},
   invitation:{id:`invite-${id}`,revision:'1',responseRevision:'1',clubId:'club',teamId:'team',eventId:`event-${id}`,playerId:`player-${id}`,createdAt:'2026-10-01T01:00:00Z',deliveredAt:'2026-10-01T02:00:00Z',memberActive:true,parentResponderActive:true,responseStatus:'pending'},
   recipients:[{id:`parent-${id}`,audience:'availability',clubId:'club',teamId:'team',playerId:`player-${id}`,active:true,authorized:true,notificationsEnabled:true}],authorityActive:true})
 const repository={
   nextPhase:async()=>{const result=phase;phase=(phase+1)%3;return result},
   discoverCandidates:async(limit=30)=>{limits.push(limit);if(slowScan)elapsed+=19;if(cursor>=count){cursor=0;return []}const rows=Array.from({length:Math.min(limit,count-cursor)},(_,i)=>({id:cursor+i}));cursor+=rows.length;return rows},
   planCandidate:async(candidate,now)=>{planned.push(candidate.id);if(slowPlanning)elapsed+=19;return planAvailabilityAutomation({...context(candidate.id),now}).map(job=>({...job,testCandidate:candidate.id}))},
   storeJobs:async(values)=>{for(const job of values)if(!jobs.has(job.key))jobs.set(job.key,{...job,state:'pending'})},
   pendingJobs:async limit=>{if(slowJobs)elapsed+=19;return [...jobs.values()].filter(job=>job.state==='pending').slice(0,limit).map(job=>({job_key:job.key}))},
   withLockedJob:async(key,run)=>{const job=jobs.get(key);return run({getJob:async()=>job,loadCurrentContext:async()=>context(job.testCandidate),insertEffectOnce:async()=>{},insertNotificationOnce:async notification=>{if(!notifications.has(notification.idempotencyKey))notifications.set(notification.idempotencyKey,{...notification,state:'pending'})},finish:async value=>{job.state=value.state}})},
   pendingNotifications:async()=>{if(slowOutbox)elapsed+=19;return [...notifications.entries()].filter(([,notification])=>notification.state==='pending').map(([key])=>({delivery_key:key}))},
   claimNotification:async key=>({notification:notifications.get(key),leaseToken:'lease'}),validateNotification:async()=>({valid:true}),
   acceptNotification:async key=>{notifications.get(key).state='accepted'},holdNotification:async()=>assert.fail('No provider error expected'),
 }
 const transport={send:async notification=>{sent.push(notification.idempotencyKey);return {accepted:true,providerId:`receipt-${sent.length}`}}}
 return {repository,transport,clock,jobs,notifications,planned,sent,limits,seed:async()=>repository.storeJobs(await repository.planCandidate({id:0},clock()))}
}

test('durable phase rotation delivers existing jobs despite discovery exhausting every budget',async()=>{
 const fixture=processorProgressFixture({slowScan:true})
 await fixture.seed()
 for(let run=0;run<3;run++)await runCoachReminderProcessor({...fixture,budgetMs:18})
 assert.equal(fixture.sent.length,1)
 assert.equal([...fixture.jobs.values()][0].state,'completed')
})

for(const slow of ['slowJobs','slowOutbox'])test(`priority phase progresses after a slow ${slow} list while hard-deadline reserve remains`,async()=>{
 const fixture=processorProgressFixture({[slow]:true})
 await fixture.seed()
 for(let run=0;run<9;run++)await runCoachReminderProcessor({...fixture,budgetMs:18,hardBudgetMs:25,itemReserveMs:5})
 assert.equal(fixture.sent.length,3);assert.equal(new Set(fixture.sent).size,3)
 assert.ok([...fixture.jobs.values()].every(job=>job.state==='completed'))
})

test('priority phase cannot start an item after its hard-deadline reserve is consumed',async()=>{
 const fixture=processorProgressFixture()
 await fixture.seed()
 fixture.repository.nextPhase=async()=>1
 fixture.repository.pendingJobs=async()=>{fixture.clock=()=>new Date('2026-10-04T00:00:00.021Z').toISOString();return [{job_key:[...fixture.jobs.keys()][0]}]}
 const result=await runCoachReminderProcessor({...fixture,clock:()=>fixture.clock(),budgetMs:18,hardBudgetMs:25,itemReserveMs:5})
 assert.equal(result.interrupted,true);assert.equal(result.processed,0);assert.equal(fixture.sent.length,0)
 assert.equal([...fixture.jobs.values()][0].state,'pending')
})

test('request hard deadline aborts actual Supabase SDK list reads without starting work',async()=>{
 let requested=0
 const deadline=createCoachReminderDeadline({timeoutMs:15,fetchImpl:async(url,init)=>{requested++;return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))}})
 try{
   const client=deadline.client(createClient('https://synthetic.invalid','synthetic-public-key',{auth:{persistSession:false},global:{fetch:deadline.fetch}}))
   const response=await client.from('team_coach_reminder_jobs').select('job_key')
   assert.ok(response.error);assert.equal(requested,1);assert.equal(deadline.signal.aborted,true)
   await assert.rejects(deadline.fetch('https://synthetic.invalid'),/hard deadline/)
   assert.equal(requested,1,'No request is started after cancellation')
 }finally{deadline.close()}
})

test('request hard deadline cancels SDK Retry-After backoff as well as fetch',async()=>{
 let requested=0
 const deadline=createCoachReminderDeadline({timeoutMs:15,fetchImpl:async()=>{requested++;return new Response('{}',{status:503,headers:{'Retry-After':'3600'}})}})
 const started=performance.now()
 try{
   const client=deadline.client(createClient('https://synthetic.invalid','synthetic-public-key',{auth:{persistSession:false},global:{fetch:deadline.fetch}}))
   const response=await client.from('team_coach_reminder_outbox').select('delivery_key')
   assert.ok(response.error);assert.equal(requested,1);assert.equal(deadline.signal.aborted,true)
   assert.ok(performance.now()-started<1000,'An hour-long SDK delay must be cancelled by the request deadline')
 }finally{deadline.close()}
})

test('Resend and Expo receive the same abort signal and uncertain delivery stays held',async()=>{
 const previousFetch=globalThis.fetch,controller=new AbortController(),seen=[]
 globalThis.fetch=async(url,init)=>{seen.push({url,signal:init.signal});controller.abort(new Error('fixture deadline'));init.signal.throwIfAborted()}
 try{
   await assert.rejects(sendEmail({from:'Football Player <feedback@footballplayer.online>',to:['parent@example.test'],subject:'Fixture',text:'Fixture'},
     {env:{RESEND_API_KEY:'re_synthetic',RESEND_FROM_EMAIL:'feedback@footballplayer.online'},resendClient:new Resend('re_synthetic'),telemetryClient:false,signal:controller.signal,idempotencyKey:'stable-fixture-key'}))
   await assert.rejects(sendExpoPushMessages([{to:'ExpoPushToken[synthetic]',title:'Fixture'}],{signal:controller.signal}),/fixture deadline/)
   assert.equal(seen.length,2);assert.ok(seen.every(call=>call.signal.aborted))
   const fixture=processorProgressFixture();await fixture.seed()
   await runCoachReminderProcessor(fixture)
   const key=[...fixture.notifications.keys()][0];fixture.notifications.get(key).state='pending'
   fixture.repository.nextPhase=async()=>2
   let holds=0;fixture.repository.holdNotification=async()=>{holds++;fixture.notifications.get(key).state='held'}
   const result=await runCoachReminderProcessor({...fixture,transport:{send:async()=>{throw new Error('aborted after unknown acceptance')}}})
   assert.equal(holds,1);assert.equal(result.held,1);assert.equal(result.delivered,0)
   await runCoachReminderProcessor(fixture);assert.equal(holds,1,'Held sends are not replayed')
 }finally{globalThis.fetch=previousFetch}
})

test('an interrupted planning invocation leaves the next durable priority for queued jobs and delivery',async()=>{
 const fixture=processorProgressFixture()
 await fixture.seed()
 const plan=fixture.repository.planCandidate
 let interrupt=true
 fixture.repository.planCandidate=async(...args)=>{if(interrupt){interrupt=false;throw new Error('Planning interrupted')}return plan(...args)}
 await assert.rejects(runCoachReminderProcessor(fixture),/Planning interrupted/)
 await runCoachReminderProcessor(fixture)
 assert.equal(fixture.sent.length,1)
 assert.equal([...fixture.jobs.values()][0].state,'completed')
})

test('slow planning advances one candidate at a time and eventually delivers every invitation without duplicates',async()=>{
 const fixture=processorProgressFixture({slowPlanning:true})
 for(let run=0;run<7;run++)await runCoachReminderProcessor({...fixture,budgetMs:18})
 assert.deepEqual([...new Set(fixture.planned)].sort(),[0,1,2])
 assert.equal(fixture.sent.length,3);assert.equal(new Set(fixture.sent).size,3)
 assert.ok([...fixture.jobs.values()].every(job=>job.state==='completed'))
})

test('a stable 900-candidate scan visits every source within 31 bounded runs and drains delivery',async()=>{
 const fixture=processorProgressFixture({count:900})
 for(let run=0;run<31;run++)await runCoachReminderProcessor({...fixture})
 assert.equal(new Set(fixture.planned).size,900)
 assert.ok(fixture.planned.length<=31*30,'Each invocation plans at most 30 candidates')
 for(let run=0;run<3;run++)await runCoachReminderProcessor({...fixture})
 assert.equal(fixture.sent.length,900);assert.equal(new Set(fixture.sent).size,900)
})

test('native training summaries retain default-off reads and scope enabled projections to the exact occurrence',async()=>{
 const occurrence='2099-03-03',rows=[{id:'invite',request_id:'request',calendar_event_id:'event',player_id:'child',player_name:'Child',status:'sent',email_sent_at:'2099-01-01T12:00:00Z',training_availability_requests:{occurrence_date:occurrence}}],calls=[]
 const supabase={from(table){const query={select(){return this},eq(){return this},in(){return this},then(resolve){resolve({data:table==='training_availability_request_players'?rows:[]})}};return query},rpc:async(name,args)=>{calls.push({name,args});return {data:[{eventId:'event',playerId:'child',occurrenceDate:occurrence,status:'unavailable',automatic:true,provenance:'coach_deadline_automation',planningExcluded:true}]}}}
 const runtime={env:{}},dependencies={process:runtime,supabase,normalize:value=>String(value||'').trim(),normalizeCoachInvite,normalizeCoachCalendarFormDate,collapseCoachInvitesByPlayer,summarizeCoachInvites,readCoachReminderProjections,applyCoachReminderProjection,findCoachReminderProjection}
 const load=nativeLoader('apps/mobile-core/src/coachCalendarData.js','async function getTrainingAvailabilityByEventId(','async function getInvolvedPlayerIdsByEventId(',dependencies)
 const disabled=await load({clubId:'club'},['event'])
 assert.equal(disabled[`event:${occurrence}`].awaiting,1);assert.equal(calls.length,0)
 runtime.env.EXPO_PUBLIC_ENABLE_COACH_REMINDER_AUTOMATION='true'
 const enabled=await load({clubId:'club'},['event'])
 assert.equal(enabled[`event:${occurrence}`].unavailable,1);assert.equal(enabled[`event:${occurrence}`].details[0].availabilityAutomatic,true)
 assert.deepEqual(calls[0].args,{kind_value:'TRAINING',event_ids:['event'],parent_link_id_value:null})
 rows[0].training_availability_requests.occurrence_date='2099-04-03'
 const later=await load({clubId:'club'},['event'])
 assert.equal(later['event:2099-04-03'].awaiting,1);assert.equal(later['event:2099-04-03'].details[0].availabilityAutomatic,undefined)
 assert.equal(rows[0].status,'sent')
})

test('native Parent invitations perform no default-off projection reads and scope enabled reads to the selected link',async()=>{
 const original={eventId:'event',childId:'child',responseState:'pending',invitationType:'match_attendance'},calls=[],runtime={env:{}}
 const supabase={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='get_parent_portal_invitation_summary'?[original]:name==='get_team_coach_reminder_projections_v1' && args.kind_value==='MATCH'?[{eventId:'event',playerId:'child',status:'unavailable',automatic:true,provenance:'coach_deadline_automation',planningExcluded:true}]:[]}}}
 const dependencies={process:runtime,supabase,requireSelectedLink:user=>user.link,normalizeText:value=>String(value||'').trim(),prepareParentInvitations:rows=>rows,readCoachReminderProjections,applyCoachReminderProjection,findCoachReminderProjection,coachReminderInvitationOccurrence}
 const load=nativeLoader('apps/parent-mobile/src/parentPortalData.js','export async function getParentInvitations(','export async function setParentMatchTransport(',dependencies)
 const user={link:{id:'selected-link'}}
 const [disabled]=await load(user)
 assert.equal(disabled.responseState,'pending');assert.equal(calls.length,3)
 runtime.env.EXPO_PUBLIC_ENABLE_COACH_REMINDER_AUTOMATION='true'
 const [enabled]=await load(user)
 assert.equal(enabled.responseState,'unavailable');assert.equal(enabled.availabilityProvenance,'coach_deadline_automation')
 const projections=calls.filter(call=>call.name==='get_team_coach_reminder_projections_v1')
 assert.deepEqual(projections.map(call=>call.args.kind_value),['MATCH','TRAINING']);assert.ok(projections.every(call=>call.args.parent_link_id_value==='selected-link'))
 assert.equal(original.responseState,'pending')
})
