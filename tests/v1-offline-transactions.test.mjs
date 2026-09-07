import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { xchacha20poly1305 } from '../apps/parent-mobile/node_modules/@noble/ciphers/chacha.js'
import { bytesToUtf8, utf8ToBytes } from '../apps/parent-mobile/node_modules/@noble/ciphers/utils.js'
import { createEncryptedOfflineStore } from '../apps/mobile-core/src/offlineStorageCore.js'
import * as coach from '../apps/mobile-core/src/coachOfflineCore.js'
import * as parent from '../apps/mobile-core/src/parentOfflineCore.js'
import * as links from '../apps/mobile-core/src/parentLinks.js'
import { applyParentNotificationAction } from '../apps/mobile-core/src/parentNotificationInboxCore.js'

const projectRef = 'ndohkecigwlwayghsopw'
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done }); return {promise,resolve} }
function fixture(role) {
  const values = new Map(), keys = new Map()
  const storage = { fail: false, async getItem(key) { return values.get(key) ?? null }, async removeItem(key) { values.delete(key) }, async setItem(key,value) { if (this.fail) throw new Error('synthetic_write_failure'); values.set(key,value) } }
  const keyStore = { async getItemAsync(key) { return keys.get(key) ?? null }, async setItemAsync(key,value) {keys.set(key,value)}, async deleteItemAsync(key) {keys.delete(key)} }
  const dependencies = { ...coach, ...parent, ...links, applyParentNotificationAction, createEncryptedOfflineStore,
    AsyncStorage: storage, SecureStore:keyStore, Crypto:{randomUUID, getRandomBytesAsync:async (n)=>new Uint8Array(randomBytes(n))}, xchacha20poly1305,bytesToUtf8,utf8ToBytes,
    getMobileRuntimeConfig:()=>({isUsable:true,isProduction:false,supabaseUrl:`https://${projectRef}.supabase.co`}),
    APPROVED_MOBILE_PRODUCTION:{supabaseRef:'production'}, APPROVED_MOBILE_TEST:{supabaseRef:projectRef},
    markParentMessageRead:async()=>{},submitParentPollVote:async()=>{} }
  const source = readFileSync(new URL(`../apps/${role}-mobile/src/offline.js`,import.meta.url),'utf8')
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\r?\n/gm,'').replace(/^export /gm,'')
  const exported = [...readFileSync(new URL(`../apps/${role}-mobile/src/offline.js`,import.meta.url),'utf8').matchAll(/^export (?:async function|function|const) (\w+)/gm)].map((m)=>m[1])
  const load = ()=>new Function(...Object.keys(dependencies),source+`\nreturn {${exported.join(',')}}`)(...Object.values(dependencies))
  const api = load()
  const profile = role==='coach' ? {id:'user',coachContexts:[{id:'context',clubId:'club',teamId:'team'}]} : {id:'user',parentPortalLinks:[{id:'context',clubId:'club',teamId:'team',playerId:'player'}],selectedParentLinkId:'context'}
  const profileStore = api[`${role}OfflineProfileStore`]
  const read = async (instance=api)=>role==='coach'?instance.readCoachOfflineResources('user','context'):(await instance.readParentOfflineView('user','context')).cache
  const save = (resources)=>role==='coach'?api.saveCoachOfflineResources('user','context',resources):api.saveParentOfflineResources(profile,'context',resources)
  return {api,profile,profileStore,read,save,storage,load,values}
}
for (const role of ['coach','parent']) {
  test(`${role}: actual adapter merges concurrent resources, overlapping updates, survives a failed write and restart`,async()=>{
    const f=fixture(role);await f.profileStore.read('user');await f.profileStore.write(f.profile)
    const batches=role==='coach'?[{players:[{id:'p'}]},{calendar:[{id:'c'}]},{matchDayList:[{id:'m'}]}]:[{calendar:[{id:'c'}]},{polls:[{id:'p'}]},{notifications:[{id:'n'}]}]
    await Promise.all(batches.map(f.save))
    for (const batch of batches) {const key=Object.keys(batch)[0];assert.equal((await f.read()).resources[key][0].id,batch[key][0].id)}
    await Promise.all([f.save({calendar:[{id:'first'}]}),f.save({calendar:[{id:'last'}]})])
    assert.equal((await f.read()).resources.calendar[0].id,'last')
    f.storage.fail=true;await assert.rejects(f.save({calendar:[{id:'lost'}]}),/synthetic_write_failure/);f.storage.fail=false
    assert.equal((await f.read(f.load())).resources.calendar[0].id,'last')
    await f.save({calendar:[{id:'recovered'}]});assert.equal((await f.read()).resources.calendar[0].id,'recovered')
    assert.ok([...f.values.values()].every((value)=>!value.includes('recovered')),'only ciphertext is persisted')
  })
  test(`${role}: revoked context and logout cannot be restored by old profile or resource work`,async()=>{
    const f=fixture(role);await f.profileStore.read('user');await f.profileStore.write(f.profile)
    await f.save({calendar:[{id:'old'}]})
    const revoked=role==='coach'?{...f.profile,coachContexts:[]}:{...f.profile,parentPortalLinks:[]}
    await Promise.allSettled([f.save({calendar:[{id:'inflight'}]}),f.profileStore.write(revoked),f.save({calendar:[{id:'stale-context'}]})])
    assert.equal(await f.read(),null)
    await f.profileStore.clear()
    await assert.rejects(f.save({calendar:[{id:'after-logout'}]}),/offline_scope_invalidated/)
    await assert.rejects(f.profileStore.write(f.profile),/offline_scope_invalidated/)
    await f.profileStore.read('different-user')
    await assert.rejects(f.save({calendar:[{id:'old-account'}]}),/offline_scope_invalidated/)
  })
}
test('Parent simultaneous queued reads are all retained and a sync completion preserves new actions and revocation',async()=>{
  const f=fixture('parent');await f.profileStore.read('user');await f.profileStore.write(f.profile)
  await Promise.all([1,2,3].map((id)=>f.api.queueParentMessageRead(f.profile,'context',{id:String(id),createdAt:'2026-09-01'})))
  let document=(await f.api.readParentOfflineView('user','context')).document
  assert.equal(document.journal.length,3)
  const gate=deferred(),started=deferred()
  const coordinator=parent.createParentSyncCoordinator({readDocument:async()=>document,updateDocument:async(_,change)=>{document=change(document);return document},execute:async()=>{started.resolve();await gate.promise}})
  const run=coordinator.sync({userScope:'user'});await started.promise
  document=parent.enqueueParentOfflineCommand(document,{actorScope:'user',childScope:'context',entityId:'four',type:'message_read',payload:{}},{commandId:'four'}).document
  document=parent.setParentOfflineProfile(document,{...document.profile.value,parentPortalLinks:[]})
  gate.resolve();await run
  assert.equal(document.journal.length,4)
  assert.ok(document.journal.every((command)=>command.status==='permanently_rejected'))
})
test('clear invalidates an update already inside its transaction',async()=>{
  const f=fixture('coach'), gate=deferred(),started=deferred()
  const store=createEncryptedOfflineStore({appRole:'coach',environment:'test',projectRef,storage:f.storage,keyStore:{getItemAsync:async()=>null,setItemAsync:async()=>{},deleteItemAsync:async()=>{}},cryptoProvider:{open:async()=>'',seal:async()=>new Uint8Array(),randomBytes:async()=>new Uint8Array(32)}})
  store.activate('user')
  const update=store.update('user',async()=>{started.resolve();await gate.promise;return {userScope:'user'}})
  await started.promise;const cleared=store.clear();gate.resolve()
  await assert.rejects(update,/offline_scope_invalidated/);await cleared
  assert.equal((await store.read('user')).document,null)
})
