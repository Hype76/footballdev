import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { createAttendanceOutbox, projectAttendanceChoice } from '../apps/mobile-core/src/attendanceOutboxCore.js'
import { createRequire } from 'node:module'
const {parse}=createRequire(import.meta.url)('@babel/parser')
function extracted(file,name) {
  const source=fs.readFileSync(new URL(file,import.meta.url),'utf8'), ast=parse(source,{sourceType:'module',plugins:['jsx']})
  let result
  const visit=node=>{ if(!node||typeof node!=='object')return; if(node.type==='FunctionDeclaration'&&node.id?.name===name)result=source.slice(node.start,node.end); if(node.type==='VariableDeclarator'&&node.id?.name===name)result=`const ${name} = ${source.slice(node.init.start,node.init.end)}`; Object.values(node).forEach(value=>Array.isArray(value)?value.forEach(visit):visit(value)) }
  visit(ast); assert.ok(result,`${name} exists`); return result
}
function bind(source,name,dependencies) { return new Function(...Object.keys(dependencies),`${source}; return ${name}`)(...Object.values(dependencies)) }
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}

test('actual attendance view guard rejects uncommitted, switched, returned and unmounted callback tokens', () => {
  const ref = { current: null }
  let nextEffect, cleanup
  const guard = bind(extracted('../apps/mobile-core/src/useAttendanceOutbox.js', 'useAttendanceUiGuard'), 'useAttendanceUiGuard', {
    useRef: () => ref,
    useLayoutEffect: effect => { nextEffect = effect },
    useCallback: callback => callback,
  })
  const commit = () => { cleanup?.(); cleanup = nextEffect() }
  const firstCapture = guard('parent-a:view-1')
  assert.equal(firstCapture()(), false, 'A callback cannot use an uncommitted view')
  commit()
  const oldReceipt = firstCapture()
  assert.equal(oldReceipt(), true)
  const secondCapture = guard('parent-b:view-2')
  commit()
  assert.equal(oldReceipt(), false)
  const secondReceipt = secondCapture()
  assert.equal(secondReceipt(), true)
  const returnedCapture = guard('parent-a:view-1')
  commit()
  assert.equal(oldReceipt(), false, 'Returning to the same scope cannot revive an older receipt')
  assert.equal(secondReceipt(), false)
  const returnedReceipt = returnedCapture()
  assert.equal(returnedReceipt(), true)
  cleanup()
  assert.equal(returnedReceipt(), false)
  cleanup = nextEffect()
  assert.equal(returnedReceipt(), false, 'Effect remount creates a fresh token')
  assert.equal(returnedCapture()(), true)
  cleanup()
})
const invitation={invitationId:'invite',invitationType:'match_attendance',parentLinkId:'parent',childId:'player',attendancePreparation:{route:'parent_match'}}
function parentFixture() {
  const gate=deferred(),scope={current:'user:parent'},generation={current:1},notices=[],calls=[]
  const dependencies={isOffline:false,activeActionId:'',selectedLink:{id:'parent',playerId:'player',linkType:'parent'},selectedMobileUser:{id:'user'},parentSyncScopeRef:scope,parentActionScopeRef:generation,
    attendanceOutbox:{enqueue:async(...args)=>{calls.push(args);return gate.promise}},isParentInvitationActionable:()=>true,setNotice:value=>notices.push(value),getParentFriendlyError:(_e,message)=>message,
    setActiveActionId:()=>{},respondToParentInvitation:async()=>{},loadParentData:async()=>{}}
  return {gate,scope,generation,notices,calls,run:bind(extracted('../apps/parent-mobile/App.js','handleInvitationResponse'),'handleInvitationResponse',dependencies)}
}
test('actual Parent handler returns closure receipt only after durable local acceptance',async()=>{
  const f=parentFixture();let closed=false;const response=f.run(invitation,'available').then(value=>{closed=Boolean(value?.durable)})
  assert.equal(closed,false);f.gate.resolve({});await response;assert.equal(closed,true);assert.equal(f.notices.length,0)
})
for(const field of ['scope','generation'])test(`actual Parent late durable result cannot close new ${field}`,async()=>{
  const f=parentFixture();const response=f.run(invitation,'available');f[field].current=field==='scope'?'other:parent':2;f.gate.resolve({})
  assert.equal(await response,false);assert.equal(f.notices.length,0)
})
test('actual Parent stale storage failure cannot show old error in new account',async()=>{
  const f=parentFixture();const response=f.run(invitation,'available');f.scope.current='other:parent';f.gate.reject(new Error('Synthetic disk failure'))
  assert.equal(await response,false);assert.equal(f.notices.length,0)
})
test('actual Parent identity guard prevents even local enqueue for another child',async()=>{
  const f=parentFixture();assert.equal(await f.run({...invitation,childId:'other'},'available'),false);assert.equal(f.calls.length,0)
})
test('actual Coach late durable write cannot close a newer confirmation',async()=>{
  const gate=deferred(), confirm={invite:{id:'invite',teamId:'team',clubId:'club',attendancePreparation:{}},status:'available'},ref={current:confirm},saving={current:false},closed=[],bulk=[]
  const run=bind(extracted('../apps/coach-mobile/src/CoachPhase31EScreens.js','recordAvailabilityOnBehalf'),'recordAvailabilityOnBehalf',{
    availabilityConfirm:confirm,bulkAction:'',availabilitySaving:saving,stale:false,captureAttendanceScope:()=>()=>true,confirmRef:ref,
    user:{roleRank:20,activeTeamId:'team',clubId:'club'},attendanceOutbox:{enqueue:()=>gate.promise},setAvailabilityError:()=>{},setBulkAction:value=>bulk.push(value),setAvailabilityConfirm:value=>closed.push(value),setSelectedPlayerIds:()=>{},getCoachFriendlyError:(_e,m)=>m,setNotice:()=>{},setCoachInviteAvailabilityOnBehalf:async()=>{},refreshAfterBulkAction:async()=>{}
  })
  const response=run('available');ref.current={invite:{id:'new-confirmation'}};gate.resolve({});await response
  assert.equal(closed.length,0);assert.equal(saving.current,false)
})
test('actual Coach scope change suppresses stale failure and final UI changes',async()=>{
  const gate=deferred();let current=true;const confirm={invite:{id:'invite',teamId:'team',clubId:'club',attendancePreparation:{}},status:'available'},notices=[],bulk=[]
  const run=bind(extracted('../apps/coach-mobile/src/CoachPhase31EScreens.js','recordAvailabilityOnBehalf'),'recordAvailabilityOnBehalf',{
    availabilityConfirm:confirm,bulkAction:'',availabilitySaving:{current:false},stale:false,captureAttendanceScope:()=>()=>current,confirmRef:{current:confirm},user:{roleRank:20,activeTeamId:'team',clubId:'club'},attendanceOutbox:{enqueue:()=>gate.promise},setAvailabilityError:()=>{},setBulkAction:value=>bulk.push(value),setAvailabilityConfirm:()=>{},setSelectedPlayerIds:()=>{},getCoachFriendlyError:(_e,m)=>m,setNotice:value=>notices.push(value),setCoachInviteAvailabilityOnBehalf:async()=>{},refreshAfterBulkAction:async()=>{}
  })
  const response=run('available');current=false;gate.reject(new Error('Synthetic storage error'));await response
  assert.equal(notices.length,0);assert.deepEqual(bulk,['available'])
})
test('actual own-Coach handler rejects known closed occurrence before local enqueue',async()=>{
  let calls=0
  const run=bind(extracted('../apps/coach-mobile/src/CoachPhase31EScreens.js','respondToTrainingAsCoach'),'respondToTrainingAsCoach',{
    user:{id:'coach',activeTeamId:'team'},captureAttendanceScope:()=>()=>true,attendanceOutbox:{enqueue:async()=>{calls++}},submitOwnTrainingCoachAttendance:async()=>{},load:async()=>{},reloadHome:async()=>{},setNotice:()=>{}
  })
  await assert.rejects(run({coachUserId:'coach',teamId:'team',attendancePreparation:{},cancelled:true,occurrenceStartsAt:'2099-01-01T12:00:00Z'},'available'),/closed/)
  assert.equal(calls,0)
})
test('actual own-Coach handler returns stale receipt after local completion in different authority',async()=>{
  const gate=deferred();let current=true
  const run=bind(extracted('../apps/coach-mobile/src/CoachPhase31EScreens.js','respondToTrainingAsCoach'),'respondToTrainingAsCoach',{
    user:{id:'coach',activeTeamId:'team'},captureAttendanceScope:()=>()=>current,attendanceOutbox:{enqueue:()=>gate.promise},submitOwnTrainingCoachAttendance:async()=>{},load:async()=>{},reloadHome:async()=>{},setNotice:()=>{}
  })
  const result=run({coachUserId:'coach',teamId:'team',attendancePreparation:{},occurrenceStartsAt:'2099-01-01T12:00:00Z'},'available');current=false;gate.resolve({});assert.deepEqual(await result,{stale:true})
})

function attendanceHookFixture() {
  const refs=[], states=[], effects=[], writes=[], networks=[]
  let cursor=0, pending=[], api, id=0
  const useRef=value=>{const i=cursor++;return refs[i]??= {current:value}}
  const useState=value=>{const i=cursor++;states[i]??=value;return [states[i], change=>{states[i]=typeof change==='function'?change(states[i]):change;writes.push(states[i])}]}
  const effect=(kind, callback,deps)=>{const i=cursor++;pending.push({i,kind,callback,deps})}
  const hook=bind(extracted('../apps/mobile-core/src/useAttendanceOutbox.js','useAttendanceOutbox'),'useAttendanceOutbox',{
    useRef,useState,useLayoutEffect:(callback,deps)=>effect('layout',callback,deps),useEffect:(callback,deps)=>effect('passive',callback,deps),
    createAttendanceOutbox,projectAttendanceChoice,Crypto:{randomUUID:()=>String(++id)},executeAttendanceCommand:async()=>{throw new Error('Unexpected network execution')},
    AppState:{currentState:'active',addEventListener:()=>({remove(){}})},NetInfo:{addEventListener:callback=>{networks.push(callback);return ()=>{}}},
    setInterval:()=>1,clearInterval:()=>{},
  })
  const render=options=>{cursor=0;pending=[];api=hook(options);return api}
  const commit=()=>{for(const kind of ['layout','passive'])for(const item of pending.filter(x=>x.kind===kind)){
    const old=effects[item.i];if(old&&item.deps.every((value,i)=>Object.is(value,old.deps[i])))continue
    old?.cleanup?.();effects[item.i]={...item,cleanup:item.callback()}
  }}
  const unmount=()=>effects.forEach(item=>item?.cleanup?.())
  return {render,commit,unmount,writes,networks,get api(){return api}}
}
const preparation={route:'parent_match',target:{invitationId:'hook-invite'},baseline:{revision:0,status:'pending',respondedAt:null}}
function hookScope(scope, storage={commands:[]}) {
  return {scope,read:async()=>storage.commands,update:async change=>(storage.commands=change(storage.commands))}
}
test('actual outbox abandoned scope render leaves committed engine able to durably save',async()=>{
 const f=attendanceHookFixture(),storage={commands:[]},a=hookScope('a',storage)
 const committed=f.render(a);f.commit();await Promise.resolve()
 f.render(hookScope('b')); // Deliberately abandon this render without running effects.
 f.render(a);f.commit()
 const result=await committed.enqueue(preparation,'available','Synthetic attendance')
 assert.equal(result.scope,'a');assert.equal(storage.commands.length,1);assert.equal(f.writes.at(-1).scope,'a')
 f.unmount()
})
test('actual outbox A/B/A and unmount reject late storage errors without overwriting new scope',async()=>{
 const f=attendanceHookFixture(),gate=deferred(),a=hookScope('a')
 const old=f.render({...a,update:()=>gate.promise});f.commit()
 const saving=old.enqueue(preparation,'available');const rejected=assert.rejects(saving,/Synthetic old storage failure/)
 f.render(hookScope('b'));f.commit();f.render(hookScope('a'));f.commit()
 await new Promise(resolve=>setImmediate(resolve));const before=f.writes.length
 gate.reject(new Error('Synthetic old storage failure'));await rejected
 assert.equal(f.writes.length,before);assert.equal(f.writes.at(-1).error,'')
 const second=deferred();const active=f.render({...hookScope('a'),update:()=>second.promise});f.commit()
 const pending=active.enqueue({...preparation,target:{invitationId:'second'}},'unavailable');const late=assert.rejects(pending,/Unmounted storage failure/)
 f.unmount();const count=f.writes.length;second.reject(new Error('Unmounted storage failure'));await late;assert.equal(f.writes.length,count)
})
test('actual outbox late durable acceptance and old network callback cannot mutate returned scope',async()=>{
 const f=attendanceHookFixture(),gate=deferred(),old=f.render({...hookScope('a'),update:()=>gate.promise});f.commit()
 const saving=old.enqueue(preparation,'available');const oldNetwork=f.networks[0]
 f.render(hookScope('b'));f.commit();f.render(hookScope('a'));f.commit();await new Promise(resolve=>setImmediate(resolve))
 const count=f.writes.length;oldNetwork({isConnected:true,isInternetReachable:true});gate.resolve([]);await saving;await new Promise(resolve=>setImmediate(resolve))
 assert.equal(f.writes.length,count);assert.equal(f.writes.at(-1).commands.length,0)
 f.unmount()
})
