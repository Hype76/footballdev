import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
const require=createRequire(import.meta.url),{parse}=require('@babel/parser')
const source=new URL('../',import.meta.url),root=new URL('../',import.meta.url)
const read=path=>fs.readFileSync(path instanceof URL?path:new URL(path,import.meta.url),'utf8')
const load=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const phase=await load(fs.readFileSync(new URL('apps/mobile-core/src/coachPhase31FCore.js',source),'utf8'))
const phaseUrl='data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('apps/mobile-core/src/coachPhase31FCore.js',source),'utf8')).toString('base64')
const cache=await load(read('../apps/mobile-core/src/coachOfflineCore.js').replace("'./coachPhase31FCore.js'",JSON.stringify(phaseUrl)))
const draftCore=await load(fs.readFileSync(new URL('apps/mobile-core/src/developmentOfflineCore.js',source),'utf8'))
const status=await load(read('../apps/mobile-core/src/developmentSaveStatusCore.js'))
const context={id:'context',authorityId:'assignment',authoritySource:'team_staff',clubId:'club',role:'coach',teamId:'team'},user={id:'user'}
const authority=JSON.stringify(['id','authorityId','authoritySource','clubId','role','teamId'].map(k=>context[k]))
const key=draftCore.developmentDraftKey('player','form'),form={id:'form',version:1,fields:[]}
const initialDraft={id:'draft',playerId:'player',formId:'form',values:{rating:6},notes:'x'.repeat(1000),formFingerprint:draftCore.developmentFormFingerprint(form),revision:1,serverVersion:0,status:'pending',error:''}
const clone=value=>structuredClone(value)
function document(){return {userScope:'user',profile:{value:{id:'user',coachContexts:[context]}},contexts:{context:{resources:{calendar:{payload:''},'phase31e:development':{forms:[form]},players:[{id:'player'}],formation:{private:'keep'}},resourceMetadata:{calendar:{savedAt:'2026-09-01'}}}},developmentDrafts:{context:{authority,items:{[key]:clone(initialDraft)}}},matchDayOutboxes:{context:{fixture:{pending:[{id:'goal'}]}}},attendanceCommands:[{id:'attendance',status:'pending'}],formationDrafts:{context:{values:'private'}},outboxes:{context:[{id:'message'}]}}}
function nearLimit(){const doc=document();doc.contexts.context.resources.calendar.payload='c'.repeat(phase.COACH_PHASE_31F_MAX_CACHE_BYTES-phase.getCoachCacheByteLength(doc)-300);return doc}
function extracted(text,name){const ast=parse(text,{sourceType:'module',plugins:['jsx']});let found;const visit=node=>{if(!node||typeof node!=='object')return;if((node.type==='FunctionDeclaration'||node.type==='VariableDeclarator')&&node.id?.name===name)found=node.type==='FunctionDeclaration'?text.slice(node.start,node.end):`const ${name}=${text.slice(node.init.start,node.init.end)}`;Object.values(node).forEach(v=>Array.isArray(v)?v.forEach(visit):visit(v))};visit(ast);assert.ok(found,name);return found}
const bind=(text,name,deps)=>new Function(...Object.keys(deps),`${extracted(text,name)};return ${name}`)(...Object.values(deps))
function updater(initial,baseline=false){let doc=clone(initial),writes=0;const text=read(new URL(baseline?'tests/fixtures/v1-development/offline.fixture.txt':'apps/coach-mobile/src/offline.js',root));const deps={normalize:x=>String(x??'').trim(),store:{update:async(_user,change)=>{const next=change(clone(doc));doc=clone(next);writes++}},getCoachCacheByteLength:phase.getCoachCacheByteLength,COACH_PHASE_31F_MAX_CACHE_BYTES:phase.COACH_PHASE_31F_MAX_CACHE_BYTES,recoverCoachOfflineCacheSpace:cache.recoverCoachOfflineCacheSpace};deps.assertOutboxContext=bind(text,'assertOutboxContext',deps);deps.outboxAuthority=bind(text,'outboxAuthority',deps);return {update:bind(text,'updateCoachDevelopmentDraft',deps),read:()=>clone(doc),writes:()=>writes}}
function syncEngine(storage,{baseline=false,save=async()=>({clientSaveVersion:1,lastSavedAt:'2026-10-05'}),current=()=>true,workspace=async()=>({players:[{id:'player'}],forms:[form]})}={}){let calls=0;const text=read(new URL(baseline?'tests/fixtures/v1-development/coachDevelopmentSync.fixture.txt':'apps/coach-mobile/src/coachDevelopmentSync.js',root)).replace(/^import .+\r?\n/gm,'').replace(/^export /gm,'');const deps={applyCoachContext:x=>x,getCoachDevelopmentWorkspace:workspace,saveCoachDevelopmentDraft:async(...args)=>{calls++;return save(...args)},...draftCore,developmentSyncFailure:status.developmentSyncFailure,withMobileAsyncTimeout:callback=>callback(),readCoachDevelopmentDrafts:async()=>storage.read().developmentDrafts.context.items,updateCoachDevelopmentDraft:storage.update};const run=new Function(...Object.keys(deps),text+';return syncCoachDevelopmentDrafts')(...Object.values(deps));return {run:()=>run(user,context,current),calls:()=>calls}}

test('baseline reproduces durable draft plus misleading local-save error during sync preparation quota',async()=>{
 const storage=updater(nearLimit(),true),engine=syncEngine(storage,{baseline:true});await engine.run();const draft=storage.read().developmentDrafts.context.items[key]
 assert.equal(draft.values.rating,6);assert.equal(draft.status,'pending');assert.equal(engine.calls(),0)
 assert.equal(draft.error,'This change could not be saved on this phone. Reconnect and sync to free space.')
 const baseline=read(new URL('tests/fixtures/v1-development/DevelopmentOfflineEditor.fixture.txt',root)),start=baseline.indexOf("{!ready ? 'Opening saved work...'")+1,end=baseline.indexOf('}</Text>',start)
 const label=new Function('ready','saving','error','draft','return '+baseline.slice(start,end))(true,0,'',draft)
 assert.equal(label,'Saved on this phone. Waiting to sync.')
})
test('recovery evicts rebuildable cache and saves/syncs without touching protected work',async()=>{
 const before=nearLimit(),storage=updater(before),engine=syncEngine(storage);await engine.run();const after=storage.read()
 assert.equal(engine.calls(),1);assert.equal(after.developmentDrafts.context.items[key].status,'synced');assert.equal(after.developmentDrafts.context.items[key].values.rating,6)
 assert.equal(after.contexts.context.resources.calendar,undefined)
 for(const field of ['matchDayOutboxes','attendanceCommands','formationDrafts','outboxes'])assert.deepEqual(after[field],before[field])
 for(const resource of ['players','phase31e:development','formation'])assert.deepEqual(after.contexts.context.resources[resource],before.contexts.context.resources[resource])
 assert.ok(phase.getCoachCacheByteLength(after)<=phase.COACH_PHASE_31F_MAX_CACHE_BYTES)
})
test('unreclaimable quota failure preserves last durable data and never pretends latest edit was saved',async()=>{
 const doc=document();doc.formationDrafts.context.values='p'.repeat(phase.COACH_PHASE_31F_MAX_CACHE_BYTES);const storage=updater(doc),before=storage.read()
 await assert.rejects(storage.update('user',context,key,previous=>({...previous,values:{rating:7}})),error=>error.code==='offline_cache_payload_too_large')
 assert.deepEqual(storage.read(),before);assert.equal(storage.writes(),0)
 assert.match(status.developmentSaveStatus({ready:true,saving:0,draft:initialDraft,unsaved:true}),/not been saved/)
 assert.equal(status.developmentInputIsSaved({values:{rating:7},notes:initialDraft.notes},initialDraft),false)
})
test('pending workspaces in another context retain development/player cache while unrelated cache is reclaimed',()=>{
 const doc=nearLimit();doc.developmentDrafts.other={items:{saved:{status:'pending',values:{private:'keep'}}}};doc.contexts.other={resources:{players:[{id:'other'}],development:{forms:[{id:'other'}]}},resourceMetadata:{}}
 const next=cache.recoverCoachOfflineCacheSpace({...doc,extra:'x'.repeat(1000)})
 assert.deepEqual(next.contexts.other,doc.contexts.other);assert.deepEqual(next.developmentDrafts,doc.developmentDrafts)
})
test('authority mismatch fails before cache recovery or persistence',async()=>{
 const storage=updater(nearLimit()),before=storage.read()
 for(const [id,ctx]of [['other',context],['user',{...context,authorityId:'other'}]])await assert.rejects(storage.update(id,ctx,key,x=>x),/different workspace/)
 assert.deepEqual(storage.read(),before);assert.equal(storage.writes(),0)
})
test('unknown server failure retains original attempt for identical replay and gives sync-specific status',async()=>{
 const storage=updater(document());let count=0;const attempts=[];const engine=syncEngine(storage,{save:async(_user,input)=>{attempts.push(input);if(!count++)throw new Error('Synthetic timeout');return {clientSaveVersion:1,lastSavedAt:'2026-10-05'}}})
 await engine.run();const pending=storage.read().developmentDrafts.context.items[key]
 assert.ok(pending.attempt);assert.match(pending.error,/saved draft is kept/)
 assert.equal(status.developmentSaveStatus({ready:true,saving:0,draft:pending,unsaved:false}),'Saved on this phone. Sync needs a retry.')
 await engine.run();assert.deepEqual(attempts[1],attempts[0]);assert.equal(storage.read().developmentDrafts.context.items[key].status,'synced')
})

test('confirmed current durable sync supersedes an earlier transient sync error',()=>{
 assert.equal(status.developmentSaveStatus({ready:true,saving:0,draft:{...initialDraft,status:'synced'},unsaved:false,syncError:'Old connection failure'}),'Synced. Private draft saved to your account.')
 assert.match(status.developmentSaveStatus({ready:true,saving:0,draft:{...initialDraft,status:'synced'},unsaved:true,syncError:'Old connection failure'}),/not been saved/)
})

test('edit during network attempt remains durable pending and next scheduled pass sends newer version',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),storage=updater(document()),attempts=[]
 const engine=syncEngine(storage,{save:async(_user,input)=>{attempts.push(input);return attempts.length===1?gate:{clientSaveVersion:2,lastSavedAt:'2026-10-05'}}})
 const first=engine.run();for(let i=0;i<30;i++)await Promise.resolve()
 await storage.update('user',context,key,previous=>draftCore.editLocalDevelopmentDraft(previous,{...previous,values:{rating:7}}))
 resolve({clientSaveVersion:1,lastSavedAt:'2026-10-05'});await first
 const pending=storage.read().developmentDrafts.context.items[key];assert.equal(pending.status,'pending');assert.equal(pending.values.rating,7);assert.equal(pending.serverVersion,1)
 await engine.run();assert.equal(attempts[1].values.rating,7);assert.equal(attempts[1].clientSaveVersion,1);assert.equal(storage.read().developmentDrafts.context.items[key].status,'synced')
})
test('stale account after workspace read never prepares or sends a development attempt',async()=>{
 let current=true;const storage=updater(document()),before=storage.read(),engine=syncEngine(storage,{current:()=>current,workspace:async()=>{current=false;return {players:[{id:'player'}],forms:[form]}}})
 await engine.run();assert.equal(engine.calls(),0);assert.deepEqual(storage.read(),before)
})
function persistFixture(save){const changes=[],lifetime={current:{scope:'one',active:true,hydrated:true,edit:0}},deps={capture:()=>{const token=lifetime.current;return()=>token===lifetime.current&&token.active},lifetime,inputRef:{current:{}},setInput:()=>{},setSaving:()=>{},setError:x=>changes.push(['error',x]),setDraft:x=>changes.push(['draft',x]),saveLocalCoachDevelopmentDraft:save,user,context,player:{id:'player'},form,developmentFormFingerprint:draftCore.developmentFormFingerprint,notifyDevelopmentSync:()=>changes.push(['notify'])};return {changes,lifetime,run:bind(read('../apps/coach-mobile/src/DevelopmentOfflineEditor.js'),'persist',deps)}}
test('actual editor persistence returns no receipt on disk failure and never starts follow-up sync',async()=>{
 const f=persistFixture(async()=>{throw new Error('Synthetic disk failure')});const result=await f.run({values:{rating:7},notes:''})
 assert.equal(result,null);assert.ok(f.changes.some(([type])=>type==='error'));assert.ok(!f.changes.some(([type])=>type==='draft'||type==='notify'))
})
test('actual editor late successful persistence cannot publish into changed account/form',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),f=persistFixture(()=>gate),promise=f.run({values:{rating:7},notes:''})
 f.lifetime.current={scope:'two',active:true,hydrated:true,edit:0};resolve({...initialDraft,revision:2});assert.equal(await promise,null)
 assert.deepEqual(f.changes,[['error','']])
})

test('actual render-scoped capture refuses stale handlers before changing input or persisting',async()=>{
 const text=read('../apps/coach-mobile/src/DevelopmentOfflineEditor.js'),lifetime={current:{scope:'new',active:true,hydrated:true,edit:0}}
 const capture=bind(text,'capture',{lifetime,scope:'old'});assert.equal(capture()(),false)
 let calls=0;const run=bind(text,'persist',{capture,lifetime,saveLocalCoachDevelopmentDraft:async()=>{calls++}})
 assert.equal(await run({values:{rating:7}}),null);assert.equal(calls,0)
 lifetime.current={scope:'old',active:true,hydrated:true,edit:0};const pending=capture();lifetime.current={scope:'old',active:true,hydrated:true,edit:0};assert.equal(pending(),false)
})

test('older failed edit cannot overwrite a newer successful edit error state',async()=>{
 let reject;const first=new Promise((_r,j)=>reject=j);let calls=0
 const f=persistFixture(async()=>++calls===1?first:{...initialDraft,revision:3})
 const older=f.run({values:{rating:7},notes:''});await f.run({values:{rating:8},notes:''});reject(new Error('Older failure'));await older
 assert.ok(!f.changes.some(([type,value])=>type==='error'&&value==='Older failure'))
})
test('all five product files parse; storage failure and confirmed sync remain distinct',()=>{
 for(const path of ['../apps/coach-mobile/src/offline.js','../apps/coach-mobile/src/coachDevelopmentSync.js','../apps/coach-mobile/src/DevelopmentOfflineEditor.js','../apps/mobile-core/src/coachOfflineCore.js','../apps/mobile-core/src/developmentSaveStatusCore.js'])parse(read(path),{sourceType:'module',plugins:['jsx']})
 assert.match(status.developmentSyncFailure({code:'offline_cache_payload_too_large'},'acknowledging'),/server confirmed/)
})

test('actual encrypted store retains recovered development and protected queues across restart, disk failure and account change',async()=>{
 const {createEncryptedOfflineStore}=await load(fs.readFileSync(new URL('apps/mobile-core/src/offlineStorageCore.js',source),'utf8'))
 const {xchacha20poly1305}=createRequire(source+'apps/parent-mobile/package.json')('@noble/ciphers/chacha.js')
 const raw=new Map(),keys=new Map();let fail=false
 const storage={getItem:async k=>raw.get(k)||null,setItem:async(k,v)=>{if(fail)throw new Error('Synthetic disk failure');raw.set(k,v)},removeItem:async k=>raw.delete(k)}
 const keyStore={getItemAsync:async k=>keys.get(k)||null,setItemAsync:async(k,v)=>keys.set(k,v),deleteItemAsync:async k=>keys.delete(k)}
 const cryptoProvider={randomBytes:async n=>new Uint8Array(randomBytes(n)),seal:async({aad,key,nonce,plaintext})=>xchacha20poly1305(key,nonce,new TextEncoder().encode(aad)).encrypt(new TextEncoder().encode(plaintext)),open:async({aad,key,nonce,ciphertext})=>new TextDecoder().decode(xchacha20poly1305(key,nonce,new TextEncoder().encode(aad)).decrypt(ciphertext))}
 const options={appRole:'coach',environment:'test',projectRef:'syntheticdevelopmentaa',storage,keyStore,cryptoProvider}
 const store=createEncryptedOfflineStore(options);store.activate('user');const doc=cache.recoverCoachOfflineCacheSpace({...nearLimit(),extra:'x'.repeat(1500)})
 await store.write('user',doc);assert.ok([...raw.values()].every(v=>!v.includes('Scoring')&&!v.includes('"rating":6')))
 const restarted=createEncryptedOfflineStore(options);restarted.activate('user');const before=(await restarted.read('user')).document
 assert.equal(before.developmentDrafts.context.items[key].values.rating,6);assert.deepEqual(before.attendanceCommands,doc.attendanceCommands)
 fail=true;await assert.rejects(restarted.update('user',value=>({...value,developmentDrafts:{}})),/Synthetic disk failure/);fail=false
 assert.deepEqual((await restarted.read('user')).document,before)
 const guard=restarted.captureScopeGuard('user');restarted.activate('other');assert.throws(guard,/scope/)
 await assert.rejects(restarted.update('user',value=>value),/scope/)
})

test('actual editor commit lifecycle blocks A/B/A edits until fresh hydration and preserves abandoned renders', async () => {
 const source=read('../apps/coach-mobile/src/DevelopmentOfflineEditor.js'),start=source.indexOf('{',source.indexOf(') {',source.indexOf('export function DevelopmentOfflineEditor')))+1
 const prefix=source.slice(start,source.indexOf('  const persist =',start))
 const refs=[],states=[],effects=[];let cursor=0,pending=[],reads=[]
 const ref=value=>{const i=cursor++;return refs[i]??={current:value}}
 const state=value=>{const i=cursor++;states[i]??=value;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next}]}
 const effect=(kind,callback,deps)=>{const i=cursor++;pending.push({i,kind,callback,deps})}
 const gates=[]
 const renderFn=new Function('suppliedContext','form','player','serverDraft','styles','user','stale','onFinalised',
 'useMemo','useRef','useState','useLayoutEffect','useEffect','developmentDraftKey','developmentFormFingerprint','developmentInputIsSaved','readCoachDevelopmentDrafts','updateCoachDevelopmentDraft','subscribeDevelopmentSync',
 prefix+';return {capture,ready,lifetime,inputRef};')
 const render=scope=>{cursor=0;pending=[];return renderFn(context,form,{id:'player'},null,{}, {id:scope},false,()=>{},fn=>fn(),ref,state,
 (fn,deps)=>effect('layout',fn,deps),(fn,deps)=>effect('passive',fn,deps),draftCore.developmentDraftKey,draftCore.developmentFormFingerprint,status.developmentInputIsSaved,
 ()=>{let resolve;const promise=new Promise(r=>resolve=r);gates.push({resolve});reads.push(scope);return promise},async()=>{},()=>()=>{})}
 const commit=()=>{for(const kind of ['layout','passive'])for(const e of pending.filter(x=>x.kind===kind)){
 const previous=effects[e.i];if(previous&&e.deps.every((v,i)=>Object.is(v,previous.deps[i])))continue
 previous?.cleanup?.();effects[e.i]={...e,cleanup:e.callback()}
 }}
 const flush=()=>new Promise(resolve=>setImmediate(resolve))
 const initial=render('a');commit();assert.equal(initial.capture()(),false)
 gates[0].resolve({[key]:{...initialDraft,status:'synced'}});await flush();const oldReceipt=initial.capture();assert.equal(oldReceipt(),true)
 render('b'); // Abandon B: committed A stays usable.
 assert.equal(oldReceipt(),true)
 render('a');commit();assert.equal(oldReceipt(),true)
 render('b');commit();assert.equal(oldReceipt(),false)
 const returned=render('a');commit();assert.equal(returned.capture()(),false,'Returned A remains blocked during hydration')
 assert.equal(render('a').ready,false,'Layout commit clears readiness before paint')
 gates[1].resolve({[key]:{...initialDraft,notes:'other account'}});await flush();assert.equal(returned.capture()(),false)
 gates[2].resolve({[key]:{...initialDraft,notes:'fresh A'}});await flush();assert.equal(returned.capture()(),true);assert.equal(returned.inputRef.current.notes,'fresh A')
 effects.forEach(e=>e?.cleanup?.());assert.equal(returned.capture()(),false);assert.deepEqual(reads,['a','b','a'])
})
