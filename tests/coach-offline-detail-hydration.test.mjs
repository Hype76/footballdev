import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
const source=readFileSync('apps/coach-mobile/src/CoachOperationalScreens.js','utf8')
const start=source.indexOf('async function loadCoachOfflineDetail('),end=source.indexOf('function formatResourceCategory(',start)
assert.ok(start>=0&&end>start)
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
function harness({offline=false,denied=false,loader,cached=null}={}){
 let generation=1,current=true
 const state={value:null,stale:null,saves:[],reads:0,invalidations:[],errors:[],denied:0},events=[]
 const user={id:'coach',isOfflineProfile:offline,getCoachAuthorityGeneration:()=>generation}
 const deps={
  createCoachOfflineResourceSaver:(_user,_context,{isCurrent})=>{events.push('capture');return async value=>{assert.equal(isCurrent(),true);state.saves.push(value)}},
  readCoachOfflineResources:async()=>{state.reads++;return typeof cached==='function'?cached():cached},
  operationalAccessDenied:error=>error.code==='42501'||error.status===403,
  invalidateMobileResource:(_user,key)=>state.invalidations.push(key),
 }
 const load=new Function(...Object.keys(deps),source.slice(start,end)+';return loadCoachOfflineDetail')(...Object.values(deps))
 return{state,events,user,change:()=>{generation++},leave:()=>{current=false},run:()=>load({
  user,context:{id:'team',clubId:'club',teamId:'team'},resourceKey:'playerDetail:player',load:()=>{events.push('network');return loader()},
  validate:value=>value?.player?.id==='player',isCurrent:()=>current,allowOffline:!denied,
  onCurrent:value=>{state.value=value;state.stale=false},onOffline:value=>{state.value=value;state.stale=true},
  onDenied:()=>{state.value=null;state.stale=true;state.denied++},onSaveError:error=>state.errors.push(error),
 })}
}
const detail={player:{id:'player'},evaluations:Array.from({length:450},(_,id)=>({id})),sessions:Array.from({length:360},(_,id)=>({id}))}

test('offline detail reads hydrate complete stored DTOs and never start a network request',async()=>{
 const h=harness({offline:true,loader:()=>{throw new Error('Must stay offline')},cached:{resources:{'playerDetail:player':detail}}})
 await assert.rejects(h.run(),/Network request failed/)
 assert.deepEqual(h.state.value,detail);assert.equal(h.state.stale,true);assert.deepEqual(h.events,['capture']);assert.deepEqual(h.state.saves,[])
})

test('fresh detail is saved by the captured current scope and late disk data cannot replace it',async()=>{
 const disk=deferred(),h=harness({loader:async()=>detail,cached:()=>disk.promise})
 await h.run();assert.deepEqual(h.events,['capture','network']);assert.deepEqual(h.state.saves,[{'playerDetail:player':detail}])
 disk.resolve({resources:{'playerDetail:player':{player:{id:'player'},evaluations:[]}}});await Promise.resolve()
 assert.deepEqual(h.state.value,detail);assert.equal(h.state.stale,false)
})

for(const error of [Object.assign(new Error('permission denied'),{code:'42501'}),Object.assign(new Error('Sign in required'),{status:401})])test('denied authority clears displayed and persisted details without restoring stale data',async()=>{
 const h=harness({loader:async()=>{throw error},cached:{resources:{'playerDetail:player':detail}}})
 await assert.rejects(h.run(),error)
 assert.equal(h.state.value,null);assert.equal(h.state.denied,1);assert.deepEqual(h.state.saves,[{'playerDetail:player':null}])
 assert.deepEqual(h.state.invalidations,['coach:player-detail:player'])
 const retry=harness({denied:true,offline:true,loader:()=>{},cached:{resources:{'playerDetail:player':detail}}})
 await assert.rejects(retry.run(),/Network request failed/);assert.equal(retry.state.value,null);assert.equal(retry.state.reads,0)
})

for(const change of ['change','leave'])test('late detail cannot publish or save after '+change,async()=>{
 const network=deferred(),disk=deferred(),h=harness({loader:()=>network.promise,cached:()=>disk.promise})
 const pending=h.run();await Promise.resolve();h[change]();network.resolve(detail);disk.resolve({resources:{'playerDetail:player':detail}})
 await pending;assert.equal(h.state.value,null);assert.deepEqual(h.state.saves,[])
})

test('a cached DTO for another player cannot cross the selected detail boundary',async()=>{
 const h=harness({offline:true,cached:{resources:{'playerDetail:player':{player:{id:'another'}}}}})
 await assert.rejects(h.run(),/Network request failed/);assert.equal(h.state.value,null)
 assert.ok(source.includes('resourceKey = `playerDetail:${player.id}`'))
 assert.ok(source.includes('resourceKey = `sessionDetail:${session.id}`'))
 assert.match(source,/value\.player\.clubId === user\.clubId && value\.player\.teamId === user\.activeTeamId/)
 assert.match(source,/value\.session\.teamId === user\.activeTeamId/)
})

test('actual Session opener hydrates its exact authorized team DTO as read-only',async()=>{
 const sessionId='00000000-0000-4000-8000-000000000002'
 const saved={session:{id:sessionId,teamId:'team'},players:Array.from({length:420},(_,id)=>({id,notes:'Saved observation '+id}))}
 const state={value:null,stale:false},user={id:'coach',activeTeamId:'team',isOfflineProfile:true}
 const helpers={createCoachOfflineResourceSaver:()=>async()=>{},readCoachOfflineResources:async()=>({resources:{['sessionDetail:'+sessionId]:saved}}),operationalAccessDenied:()=>false,invalidateMobileResource(){}}
 const loadCoachOfflineDetail=new Function(...Object.keys(helpers),source.slice(start,end)+';return loadCoachOfflineDetail')(...Object.values(helpers))
 const callbackStart=source.indexOf('  const openSession = async (session) => {'),callbackEnd=source.indexOf('  const save = async',callbackStart)
 const deps={sessionDetailSequence:{current:0},setError(){},setDetail:value=>{state.value=value},setDetailStale:value=>{state.stale=value},user,context:{id:'team'},loadCoachOfflineDetail,deniedDetails:{current:new Set()},setCacheWarning(){},message:error=>error.message}
 const open=new Function(...Object.keys(deps),source.slice(callbackStart,callbackEnd)+';return openSession')(...Object.values(deps))
 await open({id:sessionId})
 assert.deepEqual(state.value,saved);assert.equal(state.value.players.length,420);assert.equal(state.stale,true)
})

test('actual Player opener hydrates complete history only for the current player and team',async()=>{
 const playerId='00000000-0000-4000-8000-000000000003'
 const saved={player:{id:playerId,clubId:'club',teamId:'team'},evaluations:Array.from({length:430},(_,id)=>({id})),sessions:[]}
 const state={value:null,stale:false},user={id:'coach',clubId:'club',activeTeamId:'team',isOfflineProfile:true}
 const helpers={createCoachOfflineResourceSaver:()=>async()=>{},readCoachOfflineResources:async()=>({resources:{['playerDetail:'+playerId]:saved}}),operationalAccessDenied:()=>false,invalidateMobileResource(){}}
 const loadCoachOfflineDetail=new Function(...Object.keys(helpers),source.slice(start,end)+';return loadCoachOfflineDetail')(...Object.values(helpers))
 const callbackStart=source.indexOf('  const openPlayer = async (player,'),callbackEnd=source.indexOf('  const closePlayer =',callbackStart)
 const deps={playerRequest:{current:0},evaluationScope:{clubId:'club',teamId:'team'},user,context:{id:'team'},loadCoachOfflineDetail,deniedDetails:{current:new Set()},onRequestScrollTop(){},message:error=>error.message}
 for(const name of ['setFocusedPlayer','setForm','setOpeningPlayerId','setError','setDevelopmentOpen','setOpenedEvaluation','setEvaluationDetailScope','setProfileSections','setContactNotice','setInviteResults','setRevokeTarget','setCacheWarning'])deps[name]=()=>{}
 deps.setDetail=value=>{state.value=value};deps.setDetailStale=value=>{state.stale=value}
 const open=new Function(...Object.keys(deps),source.slice(callbackStart,callbackEnd)+';return openPlayer')(...Object.values(deps))
 await open({id:playerId})
 assert.deepEqual(state.value,saved);assert.equal(state.value.evaluations.length,430);assert.equal(state.stale,true)
})
