import assert from 'node:assert/strict'
import test from 'node:test'
import {createCoachAccountPreparationCoordinator,coachPreparationScopeKey} from '../apps/coach-mobile/src/coachAccountPreparationCoordinator.js'
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const contexts=Array.from({length:5},(_,i)=>({id:`team${i}`,clubId:`club${i}`,teamId:`team${i}`,authorityId:`a${i}`,authoritySource:'staff',role:'coach'}))

test('manual caller joins five-team background preparation across rerender cancellation',async()=>{
 const coordinator=createCoachAccountPreparationCoordinator(),started=deferred(),badge=deferred(),saved=[];let auto=true,runs=0
 const key=coachPreparationScopeKey('user',1,contexts)
 const run=async current=>{runs++;for(const team of contexts){if(!current())return{cancelled:true};if(!saved.length){started.resolve();await badge.promise}if(!current())return{cancelled:true};saved.push(team.id)}return{complete:true}}
 const background=coordinator.run(key,()=>auto,run);await started.promise
 const manual=coordinator.run(key,()=>true,run);auto=false;badge.resolve()
 assert.equal((await manual).complete,true);await background;assert.equal(runs,1);assert.deepEqual(saved,contexts.map(c=>c.id))
})
test('cancelled old job drains before replacement and distinct authority never overlaps writes',async()=>{
 const coordinator=createCoachAccountPreparationCoordinator(),started=deferred(),release=deferred(),writes=[];let active=true
 const first=coordinator.run('old',()=>active,async current=>{started.resolve();await release.promise;if(current())writes.push('old');return{cancelled:!current()}})
 await started.promise;active=false
 const next=coordinator.run('new',()=>true,async()=>{writes.push('new');return{complete:true}})
 assert.deepEqual(writes,[]);release.resolve();assert.equal((await first).cancelled,true);assert.equal((await next).complete,true);assert.deepEqual(writes,['new'])
})
test('logout and same-account relogin never revive previous caller',async()=>{
 const coordinator=createCoachAccountPreparationCoordinator(),started=deferred(),release=deferred(),writes=[];let epoch=1
 const first=coordinator.run('same',()=>epoch===1,async current=>{started.resolve();await release.promise;if(current())writes.push('old');return{cancelled:!current()}})
 await started.promise;epoch=2
 const next=coordinator.run('same',()=>epoch===2,async()=>{writes.push('new');return{complete:true}})
 release.resolve();assert.equal((await first).cancelled,true);await next;assert.deepEqual(writes,['new'])
})
test('scope identity includes generation, role, assignment and all contexts regardless of order',()=>{
 const key=coachPreparationScopeKey('user',1,contexts)
 assert.equal(key,coachPreparationScopeKey('user',1,[...contexts].reverse()))
 for(const [user,generation,items] of [['other',1,contexts],['user',2,contexts],['user',1,contexts.slice(1)],['user',1,contexts.map((c,i)=>i?c:{...c,authorityId:'revoked'})]]) assert.notEqual(key,coachPreparationScopeKey(user,generation,items))
})
test('actual automatic hook keeps equivalent rerenders alive and cancels changed authority or logout',async()=>{
 const {readFileSync}=await import('node:fs')
 const source=readFileSync('apps/coach-mobile/src/useCoachOfflinePreparation.js','utf8')
 const body=source.slice(source.indexOf('export function useCoachOfflinePreparation('),source.indexOf('\nexport async function syncCoachOfflineNow')).replace('export ','')
 let slots=[],index=0,initial,runCount=0,saved=[],started=deferred(),release=deferred()
 const useRef=value=>{const i=index++;return slots[i] ||= {current:value}}
 const useMemo=fn=>{index++;return fn()}
 const useEffect=(fn,deps)=>{const i=index++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();slots[i]={deps,cleanup:fn()}}}
 const setTimeout=fn=>{initial=fn;return 1},clearTimeout=()=>{},setInterval=()=>1,clearInterval=()=>{}
 const createCoachPreparationRunner=({run})=>{let active=true;return{refresh:()=>run(()=>active),stop:()=>{active=false}}}
 const prepareCoachAccount=async(_user,items,_selected,current)=>{runCount++;for(const c of items){if(!saved.length){started.resolve();await release.promise}if(!current())return{cancelled:true};saved.push(c.id)}return{complete:true}}
 const hook=new Function('useMemo','useRef','useEffect','coachPreparationScopeKey','setTimeout','clearTimeout','setInterval','clearInterval','createCoachPreparationRunner','AppState','InteractionManager','prepareCoachAccount',body+';return useCoachOfflinePreparation')(
  useMemo,useRef,useEffect,coachPreparationScopeKey,setTimeout,clearTimeout,setInterval,clearInterval,createCoachPreparationRunner,{currentState:'active',addEventListener:()=>({remove(){}})},{runAfterInteractions:fn=>fn()},prepareCoachAccount)
 const render=(user,items)=>{index=0;hook({user,contexts:items,activeContext:items[0],enabled:true})}
 const user={id:'user'};render(user,contexts);const running=initial();await started.promise
 render({...user},contexts.map(c=>({...c})));release.resolve();await running
 assert.equal(runCount,1);assert.deepEqual(saved,contexts.map(c=>c.id))
 saved=[];started=deferred();release=deferred();render({...user},contexts);const changed=initial();await started.promise
 render({...user},contexts.map((c,i)=>i?c:{...c,authorityId:'new'}));release.resolve();await changed;assert.deepEqual(saved,[])
 saved=[];started=deferred();release=deferred();const logout=initial();await started.promise;render(null,contexts);release.resolve();await logout;assert.deepEqual(saved,[])
})
