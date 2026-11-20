import {createCoachAccountPreparationCoordinator,coachPreparationScopeKey} from '../apps/coach-mobile/src/coachAccountPreparationCoordinator.js'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {withMobileAsyncTimeout} from '../apps/mobile-core/src/http.js'
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
 const dependencies={withMobileAsyncTimeout,preparationCoordinator:createCoachAccountPreparationCoordinator(),coachPreparationScopeKey,captureCoachOfflineAccount,getMedia:()=>({}),startup:Promise.resolve(),prepareCoachAccountOffline,applyCoachContext:profile=>profile,
  createCoachOfflineResourceSaver:profile=>{const guard=captureCoachOfflineAccount(profile.id);return async()=>{guard();return{resourceMetadata:{}}}},
  saveCoachAccountPreparation:async()=>{},readCoachAccountPreparation:async()=>({}),readCoachOfflineResources:async()=>({}),saveCoachPreparedMatchDays:async(id,_context,matches)=>{captureCoachOfflineAccount(id)();writes.push(...matches)},
  captureAuthority:()=>()=>{},getScopedTeamBranding:()=>null,authorizeCoachOfflineMedia:()=>{},
  loadCoachOfflineContext:async(_user,_context,options)=>{loading.resolve();await release.promise;await options.onMatch({id:'old-session-match'});return{complete:true}},
 }
 const prepare=new Function(...Object.keys(dependencies),source.slice(start,end).replace('export ','')+';return prepareCoachAccount')(...Object.values(dependencies))
 const pending=prepare(user,[context],context.id)
 await loading.promise;invalidateCoachOfflineAccount();activateCoachOfflineAccount(user.id);release.resolve()
 const result=await pending
 assert.equal(result.cancelled,true);assert.deepEqual(writes,[])
})

test('preparation batches complete resources and fixture bases, and verifies every retained fingerprint before ready',async()=>{
 const context={id:'team',clubId:'club',teamId:'team'},user={id:'user'},matches=Array.from({length:21},(_,id)=>({id:'match'+id}))
 for(const evict of [false,true]) {
  const resourceBatches=[],matchBatches=[],cache={resourceMetadata:{},resources:{}}
  const result=await prepareCoachAccountOffline({user,contexts:[context],selectedContextId:context.id,
   createSaver:()=>async resources=>{resourceBatches.push(Object.keys(resources));for(const[key,value]of Object.entries(resources)){cache.resources[key]=value;cache.resourceMetadata[key]={fingerprint:key}}return cache},
   saveStatus:async()=>{},saveMatches:async(_user,_context,details)=>matchBatches.push(details),
   readBackResources:async()=>{if(evict)delete cache.resourceMetadata.detail0;return cache},
   loadContext:async(_user,_context,{onResource,onMatch})=>{for(let id=0;id<34;id++)await onResource({cacheKey:'detail'+id,value:{id},complete:true});for(const detail of matches)await onMatch(detail);return{complete:true}}})
  assert.deepEqual(resourceBatches.map(batch=>batch.length),[16,16,2,1])
  assert.deepEqual(matchBatches,[matches])
  assert.deepEqual(result.results[0].matchIds,matches.map(match=>match.id))
  assert.equal(result.results[0].state,evict?'partial':'ready')
  assert.equal(result.complete,!evict)
 }
})

test('actual readiness reader refuses missing or unverifiable physical media even with intact record fingerprints',async()=>{
 const source=readFileSync('apps/coach-mobile/src/offline.js','utf8')
 const start=source.indexOf('export async function readCoachAccountPreparation('),end=source.indexOf('export async function inspectCoachOfflineState(',start)
 const cache={resourceMetadata:{offlineMediaInventory:{fingerprint:'expected'}},resources:{offlineMediaInventory:[{id:'file',kind:'file'}]}}
 const document={profile:{value:{id:'user'}},accountPreparation:{team:{authority:'authority',status:{schemaVersion:1,state:'ready',savedAt:'2026-11-18',filesSaved:1,filesFailed:0,resources:{offlineMediaInventory:'expected'}}}}}
 const context={id:'team',clubId:'club',teamId:'team'}
 let verified=false,calls=0
 const dependencies={store:{readSnapshot:async()=>({document}),captureScopeGuard:()=>()=>{}},matchesOfflineContext:()=>true,outboxAuthority:()=> 'authority',getCoachOfflineResources:()=>cache,validateCoachAccountOfflineStatus,
  mediaHooks:{verifyInventory:async()=>{calls++;return verified}}}
 const read=new Function(...Object.keys(dependencies),source.slice(start,end).replace('export ','')+';return readCoachAccountPreparation')(...Object.values(dependencies))
 assert.equal((await read('user',[context])).team.state,'partial')
 verified=true;assert.equal((await read('user',[context])).team.state,'ready');assert.equal(calls,2)
 document.accountPreparation.team.status.matchIds=['old-fixture']
 assert.equal((await read('user',[context])).team.state,'partial')
 document.matchDayOutboxes={team:{'old-fixture':{authority:'authority',baseMatch:{id:'old-fixture',clubId:'club',teamId:'team'}}}}
 assert.equal((await read('user',[context])).team.state,'ready')
 document.matchDayOutboxes.team['old-fixture'].baseMatch.teamId='foreign'
 assert.equal((await read('user',[context])).team.state,'partial')
 document.matchDayOutboxes.team['old-fixture'].baseMatch.teamId='team'
 cache.resourceMetadata.offlineMediaInventory.fingerprint='new-fingerprint'
 assert.equal((await read('user',[context])).team.state,'partial')
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

test('actual account service waits for resumed authority before capturing generation and starting',async()=>{
 const source=readFileSync('apps/coach-mobile/src/coachAccountOfflineService.js','utf8')
 const start=source.indexOf('export async function prepareCoachAccount('),end=source.indexOf('async function savedResource(',start)
 const authority=deferred();let generation=1,started=0
 const user={id:'authority-user',getCoachAuthorityGeneration:()=>generation,waitForCoachAuthority:()=>authority.promise},context={id:'team',clubId:'club',teamId:'team'}
 activateCoachOfflineAccount(user.id)
 const dependencies={withMobileAsyncTimeout,preparationCoordinator:createCoachAccountPreparationCoordinator(),coachPreparationScopeKey,captureCoachOfflineAccount,getMedia:()=>({}),startup:Promise.resolve(),
  prepareCoachAccountOffline:async({isCurrent})=>{started++;return{complete:isCurrent()}},createCoachOfflineResourceSaver:()=>{},saveCoachAccountPreparation:()=>{},readCoachOfflineResources:()=>{},saveCoachPreparedMatchDays:()=>{}}
 const prepare=new Function(...Object.keys(dependencies),source.slice(start,end).replace('export ','')+';return prepareCoachAccount')(...Object.values(dependencies))
 const pending=prepare(user,[context],context.id);await Promise.resolve();assert.equal(started,0)
 generation=2;authority.resolve();assert.equal((await pending).complete,true);assert.equal(started,1)
 invalidateCoachOfflineAccount()
})

test('file progress is periodically durable without one full document status write per file',async()=>{
 const context={id:'team',clubId:'club',teamId:'team'},user={id:'user'},statuses=[],cache={resourceMetadata:{}}
 const result=await prepareCoachAccountOffline({user,contexts:[context],selectedContextId:context.id,
  createSaver:()=>async resources=>{for(const key of Object.keys(resources))cache.resourceMetadata[key]={fingerprint:key};return cache},
  saveStatus:async(_id,_context,status)=>statuses.push(structuredClone(status)),saveMatches:async()=>{},readBackResources:async()=>cache,
  prepareMedia:async()=>({bytes:6}),loadContext:async(_user,_context,{onMedia})=>{for(let i=0;i<24;i++)await onMedia({id:String(i)});return{complete:true}}})
 assert.deepEqual(statuses.map(item=>item.filesSaved),[0,0,8,16,24,24]);assert.equal(result.results[0].filesSaved,24);assert.equal(result.complete,true)
})


test('an interrupted five-team download resumes verified records and media without reopening completed teams', async () => {
  const targets = Array.from({ length: 5 }, (_, index) => ({ id: 'team-' + index, teamId: 'team-' + index, clubId: 'club-' + index }))
  const user = { id: 'coach' }
  const checkpoints = new Map(), caches = new Map(), files = new Set()
  const recordLoads = [], transfers = [], verified = [], progress = []
  let current = true, interrupt = true
  let time = '2026-11-19T18:00:00Z'

  const run = () => prepareCoachAccountOffline({
    user, contexts: [...targets, targets[4]], selectedContextId: targets[0].id,
    now: () => time, isCurrent: () => current,
    readPreviousStatus: async (_userId, team) => validateCoachAccountOfflineStatus(checkpoints.get(team.id), caches.get(team.id)),
    verifyCheckpoint: async (_user, team) => { verified.push(team.id) },
    createSaver: (_user, team) => async resources => {
      const cache = caches.get(team.id) || { resources: {}, resourceMetadata: {} }
      for (const [key, value] of Object.entries(resources)) {
        cache.resources[key] = value
        cache.resourceMetadata[key] = { fingerprint: JSON.stringify(value) }
      }
      caches.set(team.id, cache)
      return cache
    },
    readBackResources: async (_userId, team) => caches.get(team.id),
    saveStatus: async (_userId, team, status) => checkpoints.set(team.id, structuredClone(status)),
    saveMatches: async () => {},
    report: (team, status) => progress.push([team, status.phase, status.filesSaved]),
    loadContext: async (_user, team, callbacks) => {
      recordLoads.push(team.id)
      callbacks.onStage('players')
      await callbacks.onResource({ cacheKey: 'players', value: [{ id: team.id }], complete: true })
      await callbacks.onMatch({ id: 'fixture-' + team.id })
      for (let index = 1; index <= (team.id === 'team-1' ? 10 : 1); index++) {
        await callbacks.onMedia({ id: team.id + '/file-' + index, kind: 'file' })
      }
      return { complete: true }
    },
    hasMedia: async (_user, _team, resource) => files.has(resource.id),
    prepareMedia: async (_user, team, resource) => {
      assert.ok(caches.get(team.id).resources.players.length, 'Records are committed before downloading files')
      if (interrupt && resource.id === 'team-1/file-9') {
        current = false
        throw new Error('Foreground download stopped')
      }
      transfers.push(resource.id)
      files.add(resource.id)
      return { bytes: 12, resource }
    },
  })

  const paused = await run()
  assert.equal(paused.cancelled, true)
  assert.deepEqual(recordLoads, ['team-0', 'team-1'])
  assert.equal(checkpoints.get('team-0').state, 'ready')
  assert.equal(checkpoints.get('team-1').phase, 'files')
  assert.equal(checkpoints.get('team-1').filesSaved, 8)
  assert.equal(checkpoints.get('team-1').filesTotal, 10)
  assert.equal(checkpoints.has('team-2'), false)

  // A previously saved local copy goes missing before the fresh process resumes.
  files.delete('team-1/file-2')
  current = true
  interrupt = false
  time = '2026-11-19T18:06:00Z'
  const resumed = await run()
  assert.equal(resumed.complete, true)
  assert.deepEqual(verified, ['team-0', 'team-1'])
  assert.deepEqual(recordLoads, targets.map(team => team.id))
  assert.deepEqual(transfers.slice(9), [
    'team-1/file-2', 'team-1/file-9', 'team-1/file-10', 'team-2/file-1', 'team-3/file-1', 'team-4/file-1',
  ])
  assert.ok(progress.some(([id, phase, saved]) => id === 'team-1' && phase === 'files' && saved === 8))
  assert.ok(resumed.results.every(status => status.state === 'ready' && !status.checkpoint))
})

test('a failed team continues the account queue and a retry checks its scope before reusing records', async () => {
  const one = { id: 'one', clubId: 'club-one', teamId: 'one' }
  const two = { id: 'two', clubId: 'club-two', teamId: 'two' }
  const states = new Map()
  let denied = false, fetched = 0
  const options = {
    user: { id: 'coach' }, contexts: [one, two], selectedContextId: one.id,
    readPreviousStatus: async (_id, team) => states.get(team.id),
    verifyCheckpoint: async (_user, team) => {
      if (denied && team.id === one.id) throw Object.assign(new Error('Team access was removed.'), { code: '42501' })
    },
    createSaver: () => async values => ({ resourceMetadata: Object.fromEntries(Object.keys(values).map(key => [key, { fingerprint: key }])) }),
    saveStatus: async (_id, team, state) => states.set(team.id, structuredClone(state)),
    loadContext: async (_user, team, { onMedia }) => {
      fetched += 1
      if (team.id === one.id) await onMedia({ id: 'first-file' })
      return { complete: true }
    },
    prepareMedia: async () => { throw new Error('File failed temporarily.') },
  }
  const first = await prepareCoachAccountOffline(options)
  assert.equal(first.complete, false)
  assert.equal(first.retryNeeded, true)
  assert.deepEqual(first.results.map(item => item.state), ['partial', 'ready'])
  assert.equal(fetched, 2)

  denied = true
  const second = await prepareCoachAccountOffline(options)
  assert.deepEqual(second.results.map(item => item.state), ['partial', 'ready'])
  assert.equal(states.get(one.id).checkpoint, undefined)
  assert.equal(fetched, 2)
})


test('automatic preparation repairs missing teams and keeps completed downloads across sessions', async () => {
  const teams = ['first', 'missing', 'last'].map(id => ({ id, clubId: 'club', teamId: id }))
  const completed = { schemaVersion: 1, state: 'ready', savedAt: '2026-11-19T17:00:00Z',
    resources: { players: 'previous-players', offlineMediaInventory: 'saved-files' } }
  const saved = { resources: { players: [], offlineMediaInventory: [] },
    resourceMetadata: { players: { fingerprint: 'fresh-players' }, offlineMediaInventory: { fingerprint: 'saved-files' } } }
  const changed = validateCoachAccountOfflineStatus(completed, saved, { acceptUpdatedResources: true })
  assert.equal(changed.state, 'ready')
  assert.equal(validateCoachAccountOfflineStatus(completed, { ...saved, resources: { players: [] } },
    { acceptUpdatedResources: true }).state, 'partial')

  const gate = deferred(), reached = deferred(), checked = [], loads = []
  const pending = prepareCoachAccountOffline({
    user: { id: 'coach' },
    contexts: teams,
    selectedContextId: teams[0].id,
    reuseSaved: true,
    now: () => '2026-11-20T18:00:00Z',
    readPreviousStatus: async (_id, team) => team.id !== 'missing' ? changed : null,
    verifyCheckpoint: async (_user, team) => { checked.push(team.id) },
    yieldControl: async () => {
      if (checked.length === 1 && !loads.length) { reached.resolve(); await gate.promise }
    },
    createSaver: () => async () => saved,
    saveStatus: async () => {},
    loadContext: async (_user, team) => { loads.push(team.id); return { complete: true } },
  })
  await reached.promise
  assert.deepEqual(loads, [], 'A foreground wait holds the next team download')
  gate.resolve()
  assert.equal((await pending).complete, true)
  assert.deepEqual(loads, ['missing'])
  assert.deepEqual(checked, ['first', 'last'])
})
