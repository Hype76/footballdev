import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const mocks = {
  '@react-native-async-storage/async-storage': `globalThis.offlineCiphertext=new Map();export default {getItem:async k=>globalThis.offlineCiphertext.get(k)||null,setItem:async(k,v)=>{globalThis.offlineCiphertext.set(k,v)},removeItem:async k=>{globalThis.offlineCiphertext.delete(k)}}`,
  'expo-secure-store': `const keys=new Map();export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY='device';export const getItemAsync=async k=>keys.get(k)||null;export const setItemAsync=async(k,v)=>{keys.set(k,v)};export const deleteItemAsync=async k=>{keys.delete(k)};`,
  'expo-crypto': `import {randomBytes as random,randomUUID as uuid} from 'node:crypto';export const getRandomBytesAsync=async n=>new Uint8Array(random(n));export const randomUUID=uuid;`,
  config: `export const getMobileRuntimeConfig=()=>({isUsable:true,isProduction:false,supabaseUrl:'https://ndohkecigwlwayghsopw.supabase.co'})`,
}
const bundle = await build({entryPoints:['apps/coach-mobile/src/offline.js'],bundle:true,write:false,format:'esm',platform:'node',nodePaths:[path.resolve('apps/coach-mobile/node_modules')],plugins:[{name:'synthetic-native-adapters',setup(b){b.onResolve({filter:/.*/},args=>{const key=args.path.endsWith('/config')?'config':args.path;return mocks[key]?{path:key,namespace:'mock'}:undefined});b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}))}}]})
await mkdir('output/feedback-tools',{recursive:true})
const file=path.resolve('output/feedback-tools/offline-storage-under-test.mjs')
await writeFile(file,bundle.outputFiles[0].text)
const storage=await import(pathToFileURL(file))

test('actual encrypted adapter retains eight fixtures and Development work with account and authority isolation',async()=>{
  const context={id:'context',authorityId:'authority',authoritySource:'team_staff',clubId:'club',teamId:'team',role:'coach'}
  await storage.coachOfflineProfileStore.read('coach')
  await storage.coachOfflineProfileStore.write({id:'coach',coachContexts:[context]})
  await storage.saveCoachOfflineResources('coach',context,{players:[{id:'player',playerName:'Private Player'}],'phase31e:development':{players:[{id:'player'}],forms:[{id:'form'}]}})
  for(let i=0;i<8;i++) await storage.updateCoachMatchDayOutbox('coach',context,'match'+i,()=>({baseMatch:{id:'match'+i,clubId:'club',teamId:'team',updatedAt:new Date().toISOString()},pending:[],verifiedAt:new Date(Date.now()+i).toISOString()}))
  const ready=await storage.readCoachOfflineReadiness('coach',context)
  assert.equal(ready.journals.length,8)
  assert.equal(ready.resources.players[0].playerName,'Private Player')
  await storage.saveLocalCoachDevelopmentDraft('coach',context,{playerId:'player',formId:'form',values:{score:4},notes:'Private assessment'})
  const reopened=await storage.readCoachDevelopmentDrafts('coach',context)
  assert.equal(Object.values(reopened)[0].notes,'Private assessment')
  assert.equal(await storage.countPendingCoachDevelopmentDrafts('coach'),1)
  assert.ok(![...globalThis.offlineCiphertext.values()].join('').includes('Private assessment'))
  await assert.rejects(storage.readCoachDevelopmentDrafts('other',context))
  await storage.coachOfflineProfileStore.read('coach')
  await assert.rejects(storage.readCoachDevelopmentDrafts('coach',{...context,teamId:'foreign'}))
  await storage.coachOfflineProfileStore.write({id:'coach',coachContexts:[{...context,role:'assistant_coach'}]})
  await assert.rejects(storage.readCoachDevelopmentDrafts('coach',{...context,role:'assistant_coach'}))
  await storage.clearCoachOfflineState()
  assert.equal(await storage.countPendingCoachDevelopmentDrafts('coach'),0)
})
