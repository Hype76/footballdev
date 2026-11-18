import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {prepareCoachAccountOffline,validateCoachAccountOfflineStatus} from '../apps/coach-mobile/src/coachAccountOfflinePreparation.js'
import {activateCoachOfflineAccount,invalidateCoachOfflineAccount,captureCoachOfflineAccount} from '../apps/coach-mobile/src/coachOfflineAccountSession.js'
import {withCoachOfflineStorageLock} from '../apps/coach-mobile/src/coachOfflineStorageBudget.js'
import {createCoachFileStorage} from '../apps/mobile-core/src/coachFileStorage.js'
import {getCoachCacheByteLength} from '../apps/mobile-core/src/coachPhase31FCore.js'
import {buildCoachHomeOperationalSnapshot} from '../apps/mobile-core/src/coachPhase31GCore.js'
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}

test('actual account service fences a manual run across logout and same-account relogin',async()=>{
 const source=readFileSync('apps/coach-mobile/src/coachAccountOfflineService.js','utf8')
 const start=source.indexOf('export async function prepareCoachAccount('),end=source.indexOf('async function savedResource(',start)
 const loading=deferred(),release=deferred(),writes=[]
 const user={id:'same-user'},context={id:'team',clubId:'club',teamId:'team'}
 activateCoachOfflineAccount(user.id)
 const dependencies={captureCoachOfflineAccount,getMedia:()=>({}),startup:Promise.resolve(),prepareCoachAccountOffline,applyCoachContext:profile=>profile,
  createCoachOfflineResourceSaver:profile=>{const guard=captureCoachOfflineAccount(profile.id);return async()=>{guard();return{resourceMetadata:{}}}},
  saveCoachAccountPreparation:async()=>{},updateCoachMatchDayOutbox:async(id,_context,match,change)=>{captureCoachOfflineAccount(id)();const next=change(null);if(next)writes.push({id,match})},
  captureAuthority:()=>()=>{},getScopedTeamBranding:()=>null,authorizeCoachOfflineMedia:()=>{},
  loadCoachOfflineContext:async(_user,_context,options)=>{loading.resolve();await release.promise;await options.onMatch({id:'old-session-match'});return{complete:true}},
 }
 const prepare=new Function(...Object.keys(dependencies),source.slice(start,end).replace('export ','')+';return prepareCoachAccount')(...Object.values(dependencies))
 const pending=prepare(user,[context],context.id)
 await loading.promise;invalidateCoachOfflineAccount();activateCoachOfflineAccount(user.id);release.resolve()
 const result=await pending
 assert.equal(result.cancelled,true);assert.deepEqual(writes,[])
})

test('actual readiness reader refuses missing or unverifiable physical media even with intact record fingerprints',async()=>{
 const source=readFileSync('apps/coach-mobile/src/offline.js','utf8')
 const start=source.indexOf('export async function readCoachAccountPreparation('),end=source.indexOf('export async function inspectCoachOfflineState(',start)
 const cache={resourceMetadata:{offlineMediaInventory:{fingerprint:'expected'}},resources:{offlineMediaInventory:[{id:'file',kind:'file'}]}}
 const document={profile:{value:{id:'user'}},accountPreparation:{team:{authority:'authority',status:{schemaVersion:1,state:'ready',savedAt:'2026-11-18',filesSaved:1,filesFailed:0,resources:{offlineMediaInventory:'expected'}}}}}
 let verified=false,calls=0
 const dependencies={store:{readSnapshot:async()=>({document}),captureScopeGuard:()=>()=>{}},matchesOfflineContext:()=>true,outboxAuthority:()=> 'authority',getCoachOfflineResources:()=>cache,validateCoachAccountOfflineStatus,
  mediaHooks:{verifyInventory:async()=>{calls++;return verified}}}
 const read=new Function(...Object.keys(dependencies),source.slice(start,end).replace('export ','')+';return readCoachAccountPreparation')(...Object.values(dependencies))
 assert.equal((await read('user',[{id:'team'}])).team.state,'partial')
 verified=true;assert.equal((await read('user',[{id:'team'}])).team.state,'ready');assert.equal(calls,2)
 cache.resourceMetadata.offlineMediaInventory.fingerprint='new-fingerprint'
 assert.equal((await read('user',[{id:'team'}])).team.state,'partial')
})

test('actual record commit wrapper counts media, retained documents and staged envelope before accepting a write',async()=>{
 const source=readFileSync('apps/coach-mobile/src/offline.js','utf8')
 const start=source.indexOf('const updateRecords = store.update'),end=source.indexOf('const incompatibleTestStore',start)
 const original={matchDayOutboxes:{team:{match:{pending:[{id:'goal'}]}}}}
 let document=structuredClone(original),commits=0,mediaBytes=8000
 const store={update:async(_user,change)=>{const next=await change(document);document=next;commits++;return next}}
 const dependencies={store,withCoachOfflineStorageLock,coachStorage:{measureBytes:async()=>7000},mediaHooks:{measureBytes:async()=>mediaBytes},COACH_PHASE_31F_MAX_CACHE_BYTES:26_000,getCoachCacheByteLength}
 new Function(...Object.keys(dependencies),source.slice(start,end))(...Object.values(dependencies))
 const change=previous=>({...previous,contexts:{team:{resources:{players:{payload:'x'.repeat(5000)}}}}})
 await assert.rejects(store.update('user',change),/not enough offline storage/)
 assert.deepEqual(document,original);assert.equal(commits,0)
 mediaBytes=0;await store.update('user',change);assert.equal(commits,1);assert.deepEqual(document.matchDayOutboxes,original.matchDayOutboxes)
})

test('actual club aggregation waits for every team status and never marks an incomplete dependency ready',async()=>{
 const source=readFileSync('apps/coach-mobile/src/coachAccountOfflineService.js','utf8')
 const start=source.indexOf('async function prepareClubOverview('),end=source.indexOf('async function savedResource(',start)
 const club={id:'club',clubId:'club'},teams=[{id:'a',clubId:'club',teamId:'a'},{id:'b',clubId:'club',teamId:'b'}]
 for(const ready of [false,true]) {
  const requested=deferred(),released=deferred(),saved=[]
  const dependencies={readCoachOfflineResources:async()=>({resources:{home:{},matchDayList:[],sessions:[],calendar:[]}}),buildCoachHomeOperationalSnapshot,
   readCoachAccountPreparation:async()=>{requested.resolve();await released.promise;return Object.fromEntries(teams.map(team=>[team.id,{state:ready?'ready':'saving',savedAt:ready?'2026-11-18':'',filesFailed:0,error:'',onlineOnly:[]}]))},resolveCoachBranding:()=>({})}
  const load=new Function(...Object.keys(dependencies),source.slice(start,end)+';return prepareClubOverview')(...Object.values(dependencies))
  const pending=prepareCoachAccountOffline({user:{id:'user',coachContexts:teams},contexts:[club],selectedContextId:club.id,loadContext:load,
   createSaver:()=>async resources=>({resourceMetadata:Object.fromEntries(Object.keys(resources).map(key=>[key,{fingerprint:key}]))}),saveStatus:async(_id,_context,status)=>{saved.push(structuredClone(status))}})
  await requested.promise
  assert.equal(saved.some(status=>status.state==='ready'),false)
  released.resolve()
  const result=await pending
  assert.equal(result.results[0].state,ready?'ready':'partial')
  assert.equal(result.complete,ready)
 }
})

test('actual profile write cannot reactivate its old account after awaited storage finishes',async()=>{
 const source=readFileSync('apps/coach-mobile/src/offline.js','utf8')
 const start=source.indexOf('export const coachOfflineProfileStore ='),end=source.indexOf('export async function quarantineIncompatibleCoachOfflineState(',start)
 const requested=deferred(),released=deferred()
 const dependencies={clearCoachOfflineState:async()=>{},activateCoachOfflineAccount,captureCoachOfflineAccount,
  sanitizeCoachProfile:profile=>profile,reportRecoveryFailure:operation=>operation(),
  store:{update:async()=>{requested.resolve();return released.promise}},setCoachOfflineProfile:()=>{},createCoachOfflineDocument:()=>{},outboxAuthority:()=>'',getCoachOfflineProfile:document=>document}
 const profileStore=new Function(...Object.keys(dependencies),source.slice(start,end).replace('export ','')+';return coachOfflineProfileStore')(...Object.values(dependencies))
 activateCoachOfflineAccount('old')
 const pending=profileStore.write({id:'old',coachContexts:[]})
 await requested.promise;invalidateCoachOfflineAccount();activateCoachOfflineAccount('new')
 const newGuard=captureCoachOfflineAccount('new')
 released.resolve({id:'old'})
 await assert.rejects(pending,/offline_account_session_changed/)
 assert.doesNotThrow(newGuard)
 assert.throws(captureCoachOfflineAccount('old'),/offline_account_session_changed/)
})

test('native document byte measurement includes active, previous and staging files and refuses unknown sizes',async()=>{
 const sizes={'active.json':123,'older.json.previous':456,'write.json.pending':78}
 const fileSystem={documentDirectory:'file:///docs/',getInfoAsync:async path=>path.endsWith('fp-coach-offline-v1/')?{exists:true,isDirectory:true}:{exists:true,isDirectory:false,size:sizes[path.split('/').at(-1)]},readDirectoryAsync:async()=>Object.keys(sizes),makeDirectoryAsync(){},readAsStringAsync(){},writeAsStringAsync(){},moveAsync(){},deleteAsync(){}}
 const storage=createCoachFileStorage({fileSystem,legacyStorage:{getAllKeys:async()=>[],getItem:async()=>null}})
 assert.equal(await storage.measureBytes(),657)
 sizes['unknown.json']=undefined
 await assert.rejects(storage.measureBytes(),/size_unavailable/)
})
