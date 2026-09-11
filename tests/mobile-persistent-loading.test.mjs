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
 const state={disk:new Map(),reads:0,images:[],offline:false};globalThis.__kitPerformanceTest=state
 const mocks=[[/club-kits\.js$/,`export const readClubKits=async()=>{const s=globalThis.__kitPerformanceTest;s.reads++;if(s.offline)throw Error('offline');return{home:{image_path:'club/kit.png'}}};export const kitImageUrl=()=> 'https://example.test/kit.png';`],[/[\\/]supabase\.js$/,`export const supabase={};`],[/[\\/]config\.js$/,`export const getMobileRuntimeConfig=()=>({supabaseUrl:'https://example.test'});`]]
 // Resolve native dependencies without loading any installed app service.
 const result=await build({entryPoints:['apps/mobile-core/src/mobileKitCache.js'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'services',setup(b){b.onResolve({filter:/^react-native$|^@react-native-async-storage\/async-storage$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react-native'?`export const Image={prefetch:async uri=>{globalThis.__kitPerformanceTest.images.push(uri)}};`:`export default{getItem:async k=>globalThis.__kitPerformanceTest.disk.get(k)||null,setItem:async(k,v)=>globalThis.__kitPerformanceTest.disk.set(k,v)};`,loader:'js'}));for(const[filter,contents]of mocks)b.onLoad({filter},()=>({contents,loader:'js'}))}}]})
 const load=()=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//'+Math.random()).toString('base64'))
 try{
  const first=await load();await Promise.all([first.loadMobileClubKits('club'),first.loadMobileClubKits('club')]);assert.equal(state.reads,1);assert.equal(state.images.length,1)
  const restarted=await load();state.offline=true;const cached=await restarted.loadMobileClubKits('club');assert.equal(cached.home.image_path,'club/kit.png');assert.equal(state.reads,1)
  for(const[k,v]of state.disk){const parsed=JSON.parse(v);parsed.checkedAt=Date.now()-360000;state.disk.set(k,JSON.stringify(parsed))}
  const old=await load();assert.equal((await old.loadMobileClubKits('club')).home.image_path,'club/kit.png');assert.equal(state.reads,2)
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
