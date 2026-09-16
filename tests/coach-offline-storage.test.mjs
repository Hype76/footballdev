import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const mocks = {
  '@react-native-async-storage/async-storage': `globalThis.offlineCiphertext=new Map();export default {getItem:async k=>globalThis.offlineCiphertext.get(k)||null,setItem:async(k,v)=>{if(globalThis.offlineNativeFailure==='data-write')throw new Error('Device storage unavailable');globalThis.offlineCiphertext.set(k,v)},removeItem:async k=>{globalThis.offlineCiphertext.delete(k)}}`,
  'expo-secure-store': `globalThis.offlineKeys=new Map();const keys=globalThis.offlineKeys;export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY='device';export const getItemAsync=async k=>keys.get(k)||null;export const setItemAsync=async(k,v)=>{if(globalThis.offlineNativeFailure==='key-write')throw new Error('SecureStore unavailable');keys.set(k,v)};export const deleteItemAsync=async k=>{keys.delete(k)};`,
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

const recoveryContext = { id: 'recovery-context', authorityId: 'recovery-authority', authoritySource: 'team_staff', clubId: 'recovery-club', teamId: 'recovery-team', role: 'head_manager' }
const liveProfile = { id: 'recovery-coach', coachContexts: [recoveryContext] }
const sessionResources = {
  sessions: Array.from({ length: 3 }, (_, id) => ({ id: `session-${id}`, title: 'Passing practice', notes: 'Caf\u00e9 \ud83c\udfc6' })),
  sessionPlayers: Array.from({ length: 23 }, (_, id) => ({ id: `player-${id}`, notes: 'Synthetic detail '.repeat(50) })),
  trainingEvents: [], trainingLocations: ['Training ground'],
}

async function freshRecoveryAccount() {
  globalThis.offlineNativeFailure = null
  await storage.clearCoachOfflineState()
  await storage.coachOfflineProfileStore.read(liveProfile.id)
}

for (const failure of ['key-write', 'data-write']) {
  test(`Sessions repairs a missing initial profile after a transient ${failure} failure`, async () => {
    await freshRecoveryAccount()
    globalThis.offlineNativeFailure = failure
    await assert.rejects(storage.coachOfflineProfileStore.write(liveProfile), /unavailable/)
    globalThis.offlineNativeFailure = null
    // Reproduce the old sticky path: resource-only retries cannot seed a profile.
    await assert.rejects(storage.saveCoachOfflineResources(liveProfile.id, recoveryContext, sessionResources), /offline_profile_scope_mismatch/)
    await assert.rejects(storage.saveCoachOfflineResources(liveProfile.id, recoveryContext, sessionResources), /offline_profile_scope_mismatch/)
    const save = storage.createCoachOfflineResourceSaver(liveProfile, recoveryContext)
    await save(sessionResources)
    const saved = await storage.readCoachOfflineResources(liveProfile.id, recoveryContext)
    assert.deepEqual(saved.resources, sessionResources)
    assert.equal((await storage.inspectCoachOfflineState(liveProfile.id)).status, 'ready')
    assert.ok(![...globalThis.offlineCiphertext.values()].join('').includes('Synthetic detail'))
  })
}

for (const damage of ['missing-generation', 'corrupt-generation', 'missing-key']) {
  test(`Sessions repairs the profile after ${damage} invalidates its offline copy`, async () => {
    await freshRecoveryAccount()
    await storage.coachOfflineProfileStore.write(liveProfile)
    await storage.saveCoachOfflineResources(liveProfile.id, recoveryContext, sessionResources)
    const save = storage.createCoachOfflineResourceSaver(liveProfile, recoveryContext)
    if (damage === 'missing-key') globalThis.offlineKeys.clear()
    else for (const key of globalThis.offlineCiphertext.keys()) {
      if (!key.includes('.g.')) continue
      if (damage === 'missing-generation') globalThis.offlineCiphertext.delete(key)
      else globalThis.offlineCiphertext.set(key, '{damaged')
    }
    await assert.rejects(storage.saveCoachOfflineResources(liveProfile.id, recoveryContext, sessionResources), /offline_profile_scope_mismatch/)
    await save(sessionResources)
    assert.deepEqual((await storage.readCoachOfflineResources(liveProfile.id, recoveryContext)).resources, sessionResources)
  })
}

test('a Sessions cache save preserves pending Match Day actions and Development drafts', async () => {
  await freshRecoveryAccount()
  await storage.coachOfflineProfileStore.write(liveProfile)
  await storage.updateCoachMatchDayOutbox(liveProfile.id, recoveryContext, 'match', () => ({
    baseMatch: { id: 'match', clubId: recoveryContext.clubId, teamId: recoveryContext.teamId },
    pending: [{ id: 'pending-goal', operation: 'goal' }], verifiedAt: new Date().toISOString(),
  }))
  await storage.saveLocalCoachDevelopmentDraft(liveProfile.id, recoveryContext, { playerId: 'player', formId: 'form', values: { score: 4 }, notes: 'Unsynced work' })
  const journal = await storage.readCoachMatchDayOutbox(liveProfile.id, recoveryContext, 'match')
  const drafts = await storage.readCoachDevelopmentDrafts(liveProfile.id, recoveryContext)
  await storage.createCoachOfflineResourceSaver(liveProfile, recoveryContext)(sessionResources)
  assert.deepEqual(await storage.readCoachMatchDayOutbox(liveProfile.id, recoveryContext, 'match'), journal)
  assert.deepEqual(await storage.readCoachDevelopmentDrafts(liveProfile.id, recoveryContext), drafts)
})

test('offline profiles, wrong contexts and revoked existing authority cannot reseed a Sessions cache', async () => {
  await freshRecoveryAccount()
  await assert.rejects(storage.createCoachOfflineResourceSaver({ ...liveProfile, isOfflineProfile: true }, recoveryContext)(sessionResources), /offline_profile_scope_mismatch/)
  await assert.rejects(storage.createCoachOfflineResourceSaver(liveProfile, { ...recoveryContext, teamId: 'other-team' })(sessionResources), /offline_context_scope_mismatch/)
  assert.equal((await storage.inspectCoachOfflineState(liveProfile.id)).hasDocument, false)
  const inFlightSave = storage.createCoachOfflineResourceSaver(liveProfile, recoveryContext)
  await storage.coachOfflineProfileStore.write({ ...liveProfile, coachContexts: [] })
  await assert.rejects(inFlightSave(sessionResources), /offline_context_scope_mismatch/)
  assert.deepEqual((await storage.coachOfflineProfileStore.read(liveProfile.id)).coachContexts, [])
})

test('a delayed Sessions response cannot revive cleared storage or another login, including the same account', async () => {
  for (const nextAccount of [null, 'other-coach', liveProfile.id]) {
    await freshRecoveryAccount()
    const save = storage.createCoachOfflineResourceSaver(liveProfile, recoveryContext)
    await storage.clearCoachOfflineState()
    if (nextAccount) await storage.coachOfflineProfileStore.read(nextAccount)
    await assert.rejects(save(sessionResources), /offline_scope_invalidated/)
    assert.equal(globalThis.offlineCiphertext.size, 0)
  }
})
