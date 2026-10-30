import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import path from 'node:path'
const root=process.cwd()
async function cacheHarness(entry, mocks) {
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'synthetic-services',setup(b){for(const [filter,contents]of mocks)b.onLoad({filter},()=>({contents,loader:'js'}))}}]})
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//'+Math.random()).toString('base64'))
}
test('kit metadata deduplicates mounts, persists across restarts, and remains available without a connection',async()=>{
 const state={disk:new Map(),reads:0,images:[],offline:false,teamReads:0};globalThis.__kitPerformanceTest=state
 const artworkMock=[/mobileKitImageStorage\.js$/,`export const mobileKitImageStorage={resolve:async uri=>{globalThis.__kitPerformanceTest.images.push(uri);return 'file:///phone/saved-kit.image'}};`]
 const mocks=[artworkMock,[/club-kits\.js$/,`export const KIT_TYPES=['home','away'];export const readClubKits=async()=>{const s=globalThis.__kitPerformanceTest;s.reads++;if(s.offline)throw Error('offline');return{home:{image_path:'club/kit.png'}}};export const kitImageUrl=()=> 'https://example.test/kit.png';`],[/[\\/]supabase\.js$/,`export const supabase={from(){let team;return{select(){return this},eq(key,value){if(key==='id')team=value;return this},async maybeSingle(){const s=globalThis.__kitPerformanceTest;s.teamReads++;if(s.offline)throw Error('offline');return{data:{home_kit_colour:team==='team-a'?'#123456':'#abcdef',away_kit_colour:'#ffffff'},error:null}}}}};`],[/[\\/]config\.js$/,`export const getMobileRuntimeConfig=()=>({supabaseUrl:'https://example.test'});`]]
 // Resolve native dependencies without loading any installed app service.
 const result=await build({entryPoints:['apps/mobile-core/src/mobileKitCache.js'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'services',setup(b){b.onResolve({filter:/^react-native$|^@react-native-async-storage\/async-storage$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react-native'?`export const Image={prefetch:async uri=>{globalThis.__kitPerformanceTest.images.push(uri)}};`:`export default{getItem:async k=>globalThis.__kitPerformanceTest.disk.get(k)||null,setItem:async(k,v)=>globalThis.__kitPerformanceTest.disk.set(k,v)};`,loader:'js'}));for(const[filter,contents]of mocks)b.onLoad({filter},()=>({contents,loader:'js'}))}}]})
 const load=()=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//'+Math.random()).toString('base64'))
 try{
  const first=await load();await Promise.all([first.loadMobileClubKits('club'),first.loadMobileClubKits('club')]);assert.equal(state.reads,1);assert.deepEqual(state.images,['https://example.test/kit.png'])
  const restarted=await load();state.offline=true;const cached=await restarted.loadMobileClubKits('club');assert.equal(cached.home.image_path,'club/kit.png');assert.equal(state.reads,1)
  for(const[k,v]of state.disk){const parsed=JSON.parse(v);parsed.checkedAt=Date.now()-360000;state.disk.set(k,JSON.stringify(parsed))}
  const old=await load();assert.equal((await old.loadMobileClubKits('club')).home.image_path,'club/kit.png');assert.equal(state.reads,2)
  state.offline=false
  const [teamA,duplicate]=await Promise.all([old.loadMobileTeamKits('club','team-a'),old.loadMobileTeamKits('club','team-a')])
  assert.equal(state.teamReads,1);assert.equal(teamA.home.colour,'#123456');assert.deepEqual(duplicate,teamA)
  const teamB=await old.loadMobileTeamKits('club','team-b');assert.equal(teamB.home.colour,'#abcdef');assert.equal(old.peekMobileTeamKits('club','team-a').home.colour,'#123456')
  state.offline=true
  const teamRestart=await load();assert.equal((await teamRestart.loadMobileTeamKits('club','team-a')).home.colour,'#123456');assert.equal(state.teamReads,2)
 }finally{delete globalThis.__kitPerformanceTest}
})
test('notification history publishes saved content before network and does not wait for background persistence',async()=>{
 const state={saved:[{id:'saved'}],writes:0,finish:null};globalThis.__notificationPerformanceTest=state
 const module=await cacheHarness(path.join(root,'apps/coach-mobile/src/coachNotificationCache.js'),[
  [/coachNotificationHistory\.js$/,`export const getCoachNotificationHistory=()=>new Promise(r=>{globalThis.__notificationPerformanceTest.finish=r});`],
  [/[\\/]offline\.js$/,`export const readCoachOfflineResources=async()=>({resources:{notifications:globalThis.__notificationPerformanceTest.saved}});export const saveCoachOfflineResources=()=>{globalThis.__notificationPerformanceTest.writes++;return new Promise(()=>{})};`],
 ])
 try{
  const published=[];const request=module.loadCoachNotificationHistory({id:'synthetic'}, {id:'context'}, {onSaved:items=>published.push(items)})
  await new Promise(resolve=>setImmediate(resolve));assert.equal(published[0][0].id,'saved');state.finish([{id:'fresh'}]);
  const result=await Promise.race([request,new Promise((_,reject)=>setTimeout(()=>reject(Error('blocked by persistence')),100))]);assert.equal(result.items[0].id,'fresh');assert.equal(state.writes,1)
 }finally{delete globalThis.__notificationPerformanceTest}
})

test('notification refresh shows expired scoped data, ignores late storage and clears denied content',async()=>{
 const state={cached:[{id:'expired'}],disk:null,finish:null,fail:null,reads:[],peekOptions:null,writes:0};globalThis.__notificationRefreshTest=state
 const module=await cacheHarness(path.join(root,'apps/coach-mobile/src/coachNotificationCache.js'),[
  [/coachNotificationHistory\.js$/,`export const getCoachNotificationHistory=()=>new Promise((resolve,reject)=>{globalThis.__notificationRefreshTest.finish=resolve;globalThis.__notificationRefreshTest.fail=reject});`],
  [/mobileResourceCache\.js$/,`export const mobileResourceKey=(u,k)=>u.id+':'+k;export const peekMobileResource=(_u,_k,options)=>{const s=globalThis.__notificationRefreshTest;s.peekOptions=options;return s.cached};export const readMobileResource=(_u,_k,loader,options)=>{globalThis.__notificationRefreshTest.reads.push(options);return loader()};export const invalidateMobileResource=()=>{globalThis.__notificationRefreshTest.cached=undefined};`],
  [/[\\/]offline\.js$/,`export const readCoachOfflineResources=()=>globalThis.__notificationRefreshTest.disk;export const saveCoachOfflineResources=async()=>{globalThis.__notificationRefreshTest.writes++};`],
 ])
 try{
  const published=[], user={id:'coach'}, context={id:'team'}
  let request=module.loadCoachNotificationHistory(user,context,{onSaved:items=>published.push(items)})
  assert.equal(published[0][0].id,'expired');assert.equal(state.peekOptions.allowStale,true)
  state.finish([]);assert.deepEqual((await request).items,[])
  state.cached=undefined;let finishDisk;state.disk=new Promise(resolve=>{finishDisk=resolve})
  request=module.loadCoachNotificationHistory(user,context,{onSaved:items=>published.push(items)})
  state.finish([{id:'live'}]);assert.equal((await request).items[0].id,'live')
  finishDisk({resources:{notifications:[{id:'old'}]}});await Promise.resolve()
  assert.equal(published.some(items=>items[0]?.id==='old'),false)
  state.cached=[{id:'protected'}];state.disk=Promise.resolve({resources:{notifications:[{id:'protected'}]}})
  request=module.loadCoachNotificationHistory(user,context,{onSaved:items=>published.push(items)})
  state.fail(Object.assign(new Error('permission denied'),{code:'42501'}));await assert.rejects(request)
  assert.deepEqual(published.at(-1),[])
  state.cached=[{id:'protected'}]
  request=module.loadCoachNotificationHistory(user,context,{onSaved:items=>published.push(items)})
  assert.equal(state.reads.at(-1).force,true);state.finish([]);assert.deepEqual((await request).items,[])
  assert.deepEqual(published.at(-1),[])
  state.cached=[{id:'protected'}];const writesBefore=state.writes
  const old=module.loadCoachNotificationHistory(user,context,{force:true,onSaved:items=>published.push(items)})
  const oldOutcome=old.catch(error=>error);const finishOld=state.finish
  const newer=module.loadCoachNotificationHistory(user,context,{force:true,onSaved:items=>published.push(items)})
  state.fail(Object.assign(new Error('restricted'),{status:403}));await assert.rejects(newer)
  assert.equal((await oldOutcome).status,403)
  finishOld([{id:'obsolete'}]);await Promise.resolve()
  assert.equal(state.writes,writesBefore);assert.deepEqual(published.at(-1),[])
  request=module.loadCoachNotificationHistory(user,context,{onSaved:items=>published.push(items)})
  assert.equal(state.reads.at(-1).force,true);state.finish([]);await request
 }finally{delete globalThis.__notificationRefreshTest}
})

test('open notification history follows a newer warmer result and receives its denial',async()=>{
 const state={pending:[],writes:0};globalThis.__notificationOverlapTest=state
 const module=await cacheHarness(path.join(root,'apps/coach-mobile/src/coachNotificationCache.js'),[
  [/coachNotificationHistory\.js$/,`export const getCoachNotificationHistory=()=>{const s=globalThis.__notificationOverlapTest;return s.immediate?Promise.resolve(s.immediate):new Promise((resolve,reject)=>s.pending.push({resolve,reject}))};`],
  [/mobileResourceCache\.js$/,`export const mobileResourceKey=(u,k)=>u.id+':'+k;export const peekMobileResource=()=>undefined;export const readMobileResource=(_u,_k,loader)=>loader();export const invalidateMobileResource=()=>{};`],
  [/[\\/]offline\.js$/,`export const readCoachOfflineResources=async()=>null;export const saveCoachOfflineResources=async()=>{globalThis.__notificationOverlapTest.writes++};`],
 ])
 try{
  const screen=[],user={id:'coach'},context={id:'team'}
  const open=module.loadCoachNotificationHistory(user,context,{force:true,onSaved:items=>screen.push(items)})
  const warmer=module.loadCoachNotificationHistory(user,context,{force:true})
  state.pending[1].resolve([{id:'latest'}])
  assert.equal((await warmer).items[0].id,'latest')
  assert.equal((await open).items[0].id,'latest')
  state.pending[0].resolve([{id:'old'}]);await Promise.resolve()
  assert.equal(state.writes,1)
  const olderFast=module.loadCoachNotificationHistory(user,context,{force:true})
  const oldFastTransport=state.pending.at(-1)
  state.immediate=[{id:'fast'}]
  const faster=module.loadCoachNotificationHistory(user,context,{force:true})
  assert.equal((await faster).items[0].id,'fast')
  assert.equal((await olderFast).items[0].id,'fast')
  oldFastTransport.resolve([{id:'obsolete'}]);await Promise.resolve()
  state.immediate=null
  assert.equal(state.writes,2)
  const screen2=[],warm2=[]
  const open2=module.loadCoachNotificationHistory(user,context,{force:true,onSaved:items=>screen2.push(items)})
  const oldDeniedTransport=state.pending.at(-1)
  const warmer2=module.loadCoachNotificationHistory(user,context,{force:true,onSaved:items=>warm2.push(items)})
  const denied=Object.assign(new Error('restricted'),{status:403})
  const openOutcome=open2.catch(error=>error),warmerOutcome=warmer2.catch(error=>error)
  state.pending.at(-1).reject(denied)
  assert.equal(await warmerOutcome,denied);assert.equal(await openOutcome,denied)
  assert.deepEqual(screen2.at(-1),[]);assert.deepEqual(warm2.at(-1),[])
  oldDeniedTransport.resolve([{id:'old'}]);await Promise.resolve()
  assert.equal(state.writes,2)
 }finally{delete globalThis.__notificationOverlapTest}
})
