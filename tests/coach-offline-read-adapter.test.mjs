import assert from 'node:assert/strict'
import test from 'node:test'
import { readCoachOfflineFamily, loadCoachOfflineContext, authorizeCoachOfflineMedia, COACH_OFFLINE_RESOURCE_KEYS } from '../apps/mobile-core/src/coachOfflineReadData.js'
import { buildCoachCalendarEvents } from '../apps/mobile-core/src/coachCalendarCore.js'

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const context={id:`team:${id(3)}`,clubId:id(2),teamId:id(3),clubName:'Secondary',teamName:'Secondary team'}
const user={id:id(1),clubId:id(2),activeTeamId:id(3),role:'coach',roleRank:30,coachContexts:[context]}
const envelope=(key,items,extra={})=>({schemaVersion:1,userId:user.id,clubId:context.clubId,teamId:context.teamId,resourceKey:key,revision:'revision',totalCount:items.length,complete:true,nextCursor:null,items,...extra})
const item=(kind,n,data)=>({kind,id:id(n),data:{id:id(n),club_id:context.clubId,team_id:context.teamId,...data}})

test('account preparation keeps the complete Calendar cache while deriving current Home occurrences',async()=>{
  const now=new Date(),year=now.getUTCFullYear(),emitted={}
  const series=item('calendarEvents',22,{title:'Long-running training',event_type:'training',
    starts_at:`${year-2}-01-03T18:00:00Z`,ends_at:`${year-2}-01-03T19:00:00Z`,
    recurrence_frequency:'weekly',recurrence_until:`${year+1}-12-31`})
  await loadCoachOfflineContext(user,context,{
    rpc:async(_name,params)=>({data:envelope(params.resource_key,params.resource_key==='calendar'?[series]:[])}),
    onResource:async entry=>{emitted[entry.cacheKey]=entry.value},
  })
  assert.ok(Date.parse(emitted.home.nextCalendar.endsAt)>=now.getTime())
  assert.ok(Date.parse(emitted.home.nextSession.endsAt)>=now.getTime())
  assert.deepEqual(emitted.calendar,buildCoachCalendarEvents({calendarEvents:[{...series.data,canEdit:true,isInheritedClubEvent:false,involvedPlayerIds:[]}],matches:[],sessions:[],availabilityByEventId:{}}))
})

test('actual family adapter follows every page and rejects incomplete, repeated or wrong-context responses',async()=>{
  const records=Array.from({length:405},(_,n)=>item('players',100+n,{player_name:`Player ${n}`}))
  let calls=0
  const rows=await readCoachOfflineFamily(user,context,'players',{rpc:async(name,params)=>{
    assert.equal(name,'get_own_coach_offline_resource')
    const page=calls++,last=page===2
    assert.equal(params.cursor_value,page ? `cursor${page}` : null)
    return {data:envelope('players',records.slice(page*200,page*200+200),{totalCount:405,complete:last,nextCursor:last ? null : `cursor${page+1}`})}
  }})
  assert.equal(rows.length,405)
  assert.equal(calls,3)
  for(const change of [{teamId:id(999)},{totalCount:2},{complete:false,nextCursor:null}]) {
    await assert.rejects(readCoachOfflineFamily(user,context,'players',{rpc:async()=>({data:envelope('players',[records[0]],change)})}),/invalid|incomplete/)
  }
  await assert.rejects(readCoachOfflineFamily({...user,activeTeamId:id(9)},context,'players'),/context_invalid/)
  await assert.rejects(readCoachOfflineFamily({...user,coachContexts:[]},context,'players'),/context_invalid/)
})

test('full adapter emits real existing DTOs, every fixture and detail with awaited persistence, resource metadata and derived Home',async()=>{
  const player=item('players',10,{player_name:'Adult Player',section:'Squad',status:'active',parent_contacts:[{type:'self',email:'adult@example.test'}]})
  const session=item('sessions',20,{title:'Assessment',session_date:'2026-11-19',session_type:'training',status:'open'})
  const match=item('matches',30,{opponent:'Opponent',match_date:'2026-11-20',kickoff_time:'15:00',status:'scheduled'})
  const resource=item('resources',40,{title:'Team video',mime_type:'video/mp4',file_size_bytes:100,storage_bucket:'resource-library',storage_path:`${context.clubId}/${context.teamId}/video.mp4`,updated_at:'revision',resource_type:'file'})
  const external=item('resources',41,{title:'External',resource_type:'external_link'})
  const families={
    players:[player,item('playerTypes',12,{name:'Squad',can_training:true,can_league:true,can_cup:false,can_friendly:true})],development:[item('evaluations',11,{player_id:player.id,date:'2026-11-01',feedback_form_name:'Form',form_responses:{a:'yes'}})],
    sessions:[session,item('sessionPlayers',21,{session_id:session.id,player_id:player.id,player_name:'Adult Player'})],
    calendar:[item('calendarEvents',22,{title:'Training',event_type:'training',starts_at:'2026-11-19T18:00:00Z',recurrence_frequency:'none'})],
    matches:[match,item('events',31,{match_day_id:match.id,event_type:'goal',scorer_name:'Adult Player',home_score:1}),item('availability',32,{match_day_id:match.id,player_id:player.id,status:'available'})],
    resources:[resource,external,item('resourceExternalLinks',42,{resource_id:external.id,external_url:'https://example.test/video'})],
    chat:[item('staffRooms',50,{type:'team_staff',title:'Coaches'}),item('staffMembers',51,{conversation_id:id(50),user_id:user.id}),item('staffMessages',52,{conversation_id:id(50),body:'Message',created_at:'2026-11-18T10:00:00Z'})],
    messages:[],polls:[],invites:[item('trainingPlayers',60,{request_id:id(61),calendar_event_id:id(22),player_id:player.id,player_name:'Adult Player',status:'sent'}),item('trainingRequests',61,{calendar_event_id:id(22),occurrence_date:'2026-11-19',occurrence_starts_at:'2026-11-19T18:00:00Z'})],formations:[],notifications:[],
  }
  const saved=new Map(),fixtures=[],media=[],keys=[]
  let saving=false
  const result=await loadCoachOfflineContext(user,context,{rpc:async(_name,params)=>{keys.push(params.resource_key);return {data:envelope(params.resource_key,families[params.resource_key])}},
    onResource:async entry=>{assert.equal(saving,false);saving=true;await Promise.resolve();assert.equal(entry.complete,true);saved.set(entry.cacheKey,entry.value);saving=false},
    onMatch:async value=>fixtures.push(value),onMedia:async value=>media.push(value)})
  assert.deepEqual(keys,COACH_OFFLINE_RESOURCE_KEYS)
  assert.equal(result.complete,true)
  assert.equal(saved.get('players')[0].playerName,'Adult Player')
  assert.equal(saved.get('players')[0].playerTypeRules.canLeague,true)
  assert.equal(saved.get(`sessionDetail:${session.id}`).players[0].playerName,'Adult Player')
  assert.equal(saved.get(`playerDetail:${player.id}`).evaluations[0].formName,'Form')
  assert.equal(saved.get(`chatMessages:staff:${id(50)}`)[0].body,'Message')
  assert.equal(fixtures.length,1)
  assert.equal(fixtures[0].events[0].scorerName,'Adult Player')
  assert.equal(saved.get('calendarResourceOptions')[0].mimeType,'video/mp4')
  assert.equal(media[0].fileSizeBytes,100)
  assert.deepEqual(result.onlineOnly,[{kind:'external_link',id:external.id,title:'External'}])
  assert.equal(saved.get('home').errors.length,0)
  assert.ok(saved.get('calendar').some(value=>value.sourceId===match.id))
})

test('failures and account cancellation never report a complete context or save later resources',async()=>{
  const saved=[]
  await assert.rejects(loadCoachOfflineContext(user,context,{rpc:async(_name,params)=>params.resource_key==='sessions' ? {error:new Error('network failed')} : {data:envelope(params.resource_key,[])},onResource:async value=>saved.push(value.cacheKey)}),/network failed/)
  assert.ok(saved.includes('players'))
  assert.ok(!saved.includes('home'))
  let current=true
  await assert.rejects(loadCoachOfflineContext(user,context,{isCurrent:()=>current,rpc:async(_name,params)=>({data:envelope(params.resource_key,[])}),onResource:async()=>{current=false}}),/cancelled/)
})

test('media authorization sends only target identity and returns canonical metadata for the current context',async()=>{
  let body
  const result=await authorizeCoachOfflineMedia(user,context,{kind:'badge'},{apiBaseUrl:'https://footballplayer.test',getToken:async()=> 'fixture',request:async(_url,options)=>{
    body=JSON.parse(options.body)
    return {ok:true,result:{success:true,signedUrl:'https://fixture.supabase.co/storage/v1/object/sign/club-logos/badge.png?token=fixture',resource:{id:`badge:${context.teamId}`,clubId:context.clubId,teamId:context.teamId,fileSizeBytes:100,mimeType:'image/png',updatedAt:'revision'}}}
  }})
  assert.deepEqual(body,{clubId:context.clubId,teamId:context.teamId,kind:'badge'})
  assert.equal(result.resource.kind,'badge')
  assert.equal(result.resource.fileSizeBytes,100)
})

test('saved formation kit preflight supplies canonical verified metadata before media persistence',async()=>{
  const version=id(88),path=`${context.clubId}/home/kit.png`,seen=[]
  const formation=item('formations',80,{board:{id:id(80),club_id:context.clubId,team_id:context.teamId,title:'Saved'},currentVersion:{id:version,shirt_kit:{type:'home',colour:'#112233',imagePath:path}}})
  const result=await loadCoachOfflineContext(user,context,{rpc:async(_name,params)=>({data:envelope(params.resource_key,params.resource_key==='formations' ? [formation] : [])}),
    authorizeMedia:async(_user,_context,resource)=>{assert.equal(resource.kind,'kit');assert.equal(resource.sourceId,version);return {resource:{...resource,storageBucket:'club-kits',storagePath:path,updatedAt:path,mimeType:'image/png',fileSizeBytes:100}}},
    onMedia:async resource=>seen.push(resource)})
  assert.equal(result.complete,true)
  assert.equal(seen.length,1)
  assert.equal(seen[0].kind,'kit')
  assert.equal(seen[0].fileSizeBytes,100)
  assert.equal(seen[0].storagePath,path)
})


test('a stalled records request expires without marking its team ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let started = false
  const pending = assert.rejects(readCoachOfflineFamily(user, context, 'players', {
    rpc: () => {
      started = true
      return new Promise(() => {})
    },
  }), /Team records took too long/)
  await Promise.resolve()
  assert.equal(started, true)
  t.mock.timers.tick(20000)
  await pending
})
