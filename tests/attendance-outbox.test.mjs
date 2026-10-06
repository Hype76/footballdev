import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'

const coreSource = fs.readFileSync(new URL('../apps/mobile-core/src/attendanceOutboxCore.js', import.meta.url), 'utf8')
const core = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`)
const clone = value => JSON.parse(JSON.stringify(value))
const prep = { route: 'parent_match', target: { parentLinkId: 'synthetic-parent', requestId: 'synthetic-request', eventId: 'synthetic-event', playerId: 'synthetic-player', clubId: 'synthetic-club', teamId: 'synthetic-team' }, baseline: { revision: '0', status: 'pending', respondedAt: null } }
const saved = { outcome: 'saved', current: { revision: '1', status: 'available', respondedAt: '2026-10-05T00:00:00Z' }, result: { changed: true, respondedAt: '2026-10-05T00:00:00Z' } }
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const flush = async () => { for (let i=0; i<20; i++) await Promise.resolve() }
function harness(options={}) {
  let commands = clone(options.commands || []), current=true, online=options.online ?? false, id=0
  const reactions=[], changes=[], calls=[]
  const engine=core.createAttendanceOutbox({ scope: options.scope || 'synthetic-user:synthetic-parent',
    read: async () => clone(commands), update: async change => { if (options.storageGate) await options.storageGate.promise; if (options.storageError) throw options.storageError; commands=clone(change(commands)); return clone(commands) },
    makeId: () => `synthetic-command-${++id}`, now: options.now || (() => 100), canSend: () => online, isCurrent: () => current,
    execute: async command => { calls.push(clone(command)); return options.execute ? options.execute(command) : clone(saved) },
    notify: options.notify, onReaction: command => reactions.push({ command, at: performance.now() }), onChange: value => changes.push(clone(value)) })
  return { engine, reactions, changes, calls, read: () => commands, offline: () => { online=false }, connect: () => { online=true }, invalidate: () => { current=false } }
}

test('visible pending callback <=1 second precedes blocked encrypted write and any network call', async () => {
  const gate=deferred(), f=harness({ storageGate: gate, online:true }), start=performance.now()
  let closed=false
  const acceptance=f.engine.enqueue(prep,'available','Synthetic fixture').then(() => { closed=true })
  assert.equal(f.reactions.length,1)
  const elapsed=f.reactions[0].at-start
  assert.ok(elapsed<=1000, `Synthetic callback ${elapsed} ms`)
  assert.equal(f.reactions[0].command.status,'persisting')
  assert.equal(closed,false)
  assert.equal(f.calls.length,0)
  gate.resolve()
  await acceptance
  assert.equal(closed,true)
  await f.engine.sync()
  assert.equal(f.read()[0].status,'saved')
})

test('safe closure does not wait for delayed network and remains visibly pending', async () => {
  const network=deferred(), f=harness({ online:true, execute:()=>network.promise })
  const command=await f.engine.enqueue(prep,'available')
  await flush()
  assert.equal(command.status,'pending')
  assert.equal(f.read()[0].status,'sending')
  const item=core.projectAttendanceChoice({attendancePreparation:prep,responseState:'pending',canChangeResponse:true},f.read(),'synthetic-user:synthetic-parent')
  assert.equal(item.responseState,'available'); assert.equal(item.attendancePending,true); assert.equal(item.canChangeResponse,true)
  network.resolve(saved)
  await f.engine.sync()
  assert.equal(f.read()[0].status,'saved')
})

test('storage failure has reaction but no durable receipt, closure or mutation', async () => {
  const f=harness({ online:true, storageError:new Error('Synthetic disk full') })
  await assert.rejects(f.engine.enqueue(prep,'available'),/disk full/)
  assert.equal(f.reactions.length,1); assert.equal(f.calls.length,0); assert.equal(f.read().length,0)
})

test('rapid repeated choices share one acceptance even before local persistence', async () => {
  const gate=deferred(), f=harness({storageGate:gate})
  const first=f.engine.enqueue(prep,'available')
  await assert.rejects(f.engine.enqueue(prep,'unavailable'),/being saved/)
  gate.resolve(); await first
  assert.equal(f.read().length,1)
  await assert.rejects(f.engine.enqueue(prep,'unavailable'),/already pending/)
})

test('distinct fixture/recurring targets can queue independently', async () => {
  const f=harness()
  await f.engine.enqueue(prep,'available')
  await f.engine.enqueue({...prep,target:{...prep.target,eventId:'another-event',requestId:'another-request'}},'unavailable')
  assert.equal(f.read().length,2)
  const one={route:'coach_player_training',target:{eventId:'event',playerId:'player',occurrenceDate:'2026-10-05',requestId:'first'},baseline:prep.baseline}
  const two={...one,target:{...one.target,occurrenceDate:'2026-10-12',requestId:'second'}}
  assert.notEqual(core.attendanceTargetKey(one),core.attendanceTargetKey(two))
})

test('offline durable queue survives restart and sends identical original command', async () => {
  const f=harness(); const command=await f.engine.enqueue(prep,'available')
  const restart=harness({commands:f.read(),online:true})
  await restart.engine.sync()
  assert.equal(restart.calls[0].id,command.id)
  assert.deepEqual(restart.calls[0].preparation,command.preparation)
  assert.equal(restart.read()[0].status,'saved')
})

test('restart during ambiguous sending replays original ID/baseline without a new choice', async () => {
  const entry=core.createAttendanceCommand({id:'synthetic-interrupted',scope:'synthetic-user:synthetic-parent',preparation:prep,response:'available'})
  const f=harness({commands:[{...entry,status:'sending',attempts:1}],online:true,execute:async()=>({...saved,duplicate:true})})
  await f.engine.sync({explicitRetry:true})
  assert.equal(f.calls.length,1); assert.equal(f.calls[0].id,entry.id); assert.deepEqual(f.calls[0].preparation.baseline,prep.baseline)
})

test('network error retains exact command and explicit retry cannot manufacture new baseline', async () => {
  let attempt=0
  const f=harness({online:true,execute:async()=>{ if (++attempt===1) throw new Error('Synthetic timeout after commit'); return {...saved,duplicate:true} }})
  await f.engine.enqueue(prep,'available'); await f.engine.sync()
  assert.equal(f.read()[0].status,'retryable')
  const before=clone(f.read()[0])
  await f.engine.sync({explicitRetry:true})
  assert.equal(f.calls.length,2); assert.equal(f.calls[1].id,before.id); assert.deepEqual(f.calls[1].preparation,before.preparation)
  assert.equal(f.read()[0].status,'saved')
})

test('server conflict retains reviewable intent without automatic overwrite or fresh command', async () => {
  const f=harness({online:true,execute:async()=>({outcome:'conflict',current:{revision:'9',status:'unavailable',respondedAt:'2026-10-05T01:00:00Z'}})})
  await f.engine.enqueue(prep,'available'); await f.engine.sync({explicitRetry:true})
  assert.equal(f.read()[0].status,'conflict'); assert.equal(f.calls.length,1)
  await f.engine.sync({explicitRetry:true}); assert.equal(f.calls.length,1)
  const original={attendancePreparation:prep,responseState:'unavailable'}
  const projected=core.projectAttendanceChoice(original,f.read(),'synthetic-user:synthetic-parent')
  assert.equal(projected.responseState,'unavailable'); assert.equal(projected.attendancePending,true)
  await assert.rejects(f.engine.enqueue(prep,'maybe'),/already pending/)
  await f.engine.review(f.read()[0].id); assert.equal(f.read().length,0)
})

test('new authoritative revision stays visible while an older queued intent awaits reconciliation', async () => {
  const f=harness(); await f.engine.enqueue(prep,'available')
  const item={attendancePreparation:{...prep,baseline:{revision:'2',status:'unavailable',respondedAt:'2026-10-05T01:00:00Z'}},responseState:'unavailable',status:'unavailable'}
  const projected=core.projectAttendanceChoice(item,f.read(),'synthetic-user:synthetic-parent')
  assert.equal(projected.responseState,'unavailable'); assert.equal(projected.attendancePending,true)
})

test('confirmed result remains visible before resource refresh and across restart, then yields to newer authority', async () => {
  const f=harness({online:true}); await f.engine.enqueue(prep,'available');await f.engine.sync()
  const item={attendancePreparation:prep,responseState:'pending'}
  const projected=core.projectAttendanceChoice(item,clone(f.read()),'synthetic-user:synthetic-parent')
  assert.equal(projected.responseState,'available'); assert.equal(projected.attendancePending,undefined)
  assert.equal(projected.attendancePreparation.baseline.revision,'1')
  const newer={...item,responseState:'unavailable',attendancePreparation:{...prep,baseline:{...prep.baseline,revision:'2',status:'unavailable'}}}
  const latest=core.projectAttendanceChoice(newer,f.read(),'synthetic-user:synthetic-parent')
  assert.equal(latest.responseState,'unavailable');assert.equal(latest.attendanceSaved,undefined)
})

test('current authority rejection remains visible and never retries mutation automatically', async () => {
  const f=harness({online:true,execute:async()=>{ throw Object.assign(new Error('Synthetic access revoked'),{code:'42501'}) }})
  await f.engine.enqueue(prep,'available'); await f.engine.sync()
  assert.equal(f.read()[0].status,'rejected')
  await f.engine.sync({explicitRetry:true}); assert.equal(f.calls.length,1)
})

test('account/link invalidation during submission cannot publish late success or change another scope', async () => {
  const network=deferred(),f=harness({online:true,execute:()=>network.promise})
  await f.engine.enqueue(prep,'available'); await flush()
  const length=f.changes.length
  f.invalidate(); network.resolve(saved); await f.engine.sync()
  assert.equal(f.changes.length,length)
  assert.equal(f.read()[0].status,'sending')
  assert.equal(core.projectAttendanceChoice({attendancePreparation:prep,responseState:'pending'},f.read(),'another-user:another-parent').attendancePending,undefined)
  const other=harness({scope:'another-user:another-parent',commands:f.read(),online:true})
  await other.engine.sync(); assert.equal(other.calls.length,0)
})

test('training notification failure retains confirmed response and durable delivery retry only', async () => {
  let notifications=0
  const f=harness({online:true,notify:async()=>++notifications>1})
  await f.engine.enqueue({...prep,route:'parent_training'},'available'); await f.engine.sync()
  assert.equal(f.read()[0].status,'saved'); assert.equal(f.read()[0].notifyPending,true)
  await f.engine.sync({explicitRetry:true})
  assert.equal(f.calls.length,1); assert.equal(notifications,2); assert.equal(f.read()[0].notifyPending,false)
})

test('same-answer confirmation does not produce duplicate notification work', async () => {
  let notifications=0
  const f=harness({online:true,execute:async()=>({...saved,result:{...saved.result,changed:false}}),notify:async()=>{notifications++;return true}})
  await f.engine.enqueue({...prep,route:'parent_training'},'available'); await f.engine.sync()
  assert.equal(f.read()[0].status,'saved'); assert.equal(notifications,0)
})

test('older saved notification retry never covers a newer pending or saved training choice', async () => {
  const preparation={...prep,route:'parent_training'},scope='synthetic-user:synthetic-parent'
  const first=core.createAttendanceCommand({id:'first',scope,preparation,response:'available'})
  const retained={...first,status:'saved',notifyPending:true,receipt:saved}
  const nextPreparation={...preparation,baseline:saved.current}
  const second=core.createAttendanceCommand({id:'second',scope,preparation:nextPreparation,response:'unavailable'})
  const item={attendancePreparation:nextPreparation,responseState:'available'}
  for(const status of ['persisting','pending','sending','retryable','conflict']) {
    const projected=core.projectAttendanceChoice(item,[retained,{...second,status}],scope)
    assert.equal(projected.attendanceCommandId,'second');assert.equal(projected.attendancePending,true)
    if(status!=='conflict')assert.equal(projected.responseState,'unavailable')
  }
  const latest={...second,status:'saved',receipt:{...saved,current:{...saved.current,revision:'2',status:'unavailable'}}}
  for(const commands of [[retained,latest],[latest,retained]]) {
    const projected=core.projectAttendanceChoice(item,commands,scope)
    assert.equal(projected.responseState,'unavailable');assert.equal(projected.attendancePreparation.baseline.revision,'2')
  }
})

test('malformed cached preparations fail closed before reaction/durable acceptance', async () => {
  for (const baseline of [{revision:null,status:'pending',respondedAt:null},{revision:'0',status:'pending'},{revision:'0',status:'available',respondedAt:'bad'}, {revision:'9007199254740993',status:'pending',respondedAt:null}]) {
    const f=harness(); await assert.rejects(f.engine.enqueue({...prep,baseline},'available'))
    assert.equal(f.reactions.length,0); assert.equal(f.read().length,0)
  }
})

test('authoritative preparation reconciles a response row read before an intervening save', () => {
  const scope='synthetic-user:synthetic-parent', baseline={revision:'2',status:'unavailable',respondedAt:'2026-10-05T00:01:00Z'}
  const item={attendancePreparation:{...prep,baseline},responseState:'available',status:'available',canChangeResponse:false}
  const command={...core.createAttendanceCommand({id:'saved',scope,preparation:prep,response:'available'}),status:'saved',receipt:saved}
  for(const commands of [[],[command],[{...command,receipt:{...saved,current:baseline}}]]) {
    const result=core.projectAttendanceChoice(item,commands,scope)
    assert.equal(result.responseState,'unavailable');assert.equal(result.status,'unavailable')
    assert.equal(result.respondedAt,baseline.respondedAt);assert.equal(result.canChangeResponse,false)
  }
})

test('actual encrypted offline store retains pending commands across restart and rejects stale account writes', async () => {
  const requireSource=createRequire(new URL('../apps/parent-mobile/package.json', import.meta.url))
  const {xchacha20poly1305}=requireSource('@noble/ciphers/chacha.js')
  const storageSource=fs.readFileSync('E:/FP-PARENT-NOTIFICATIONS-20261002/apps/mobile-core/src/offlineStorageCore.js','utf8')
  const {createEncryptedOfflineStore}=await import(`data:text/javascript;base64,${Buffer.from(storageSource).toString('base64')}`)
  const raw=new Map(), keys=new Map()
  const storage={getItem:async key=>raw.get(key)||null,setItem:async(key,value)=>raw.set(key,value),removeItem:async key=>raw.delete(key)}
  const keyStore={getItemAsync:async key=>keys.get(key)||null,setItemAsync:async(key,value)=>keys.set(key,value),deleteItemAsync:async key=>keys.delete(key)}
  const cryptoProvider={randomBytes:async size=>new Uint8Array(randomBytes(size)),seal:async({aad,ciphertext,key,nonce,plaintext})=>xchacha20poly1305(key,nonce,new TextEncoder().encode(aad)).encrypt(new TextEncoder().encode(plaintext)),open:async({aad,ciphertext,key,nonce})=>new TextDecoder().decode(xchacha20poly1305(key,nonce,new TextEncoder().encode(aad)).decrypt(ciphertext))}
  const options={appRole:'parent',environment:'test',projectRef:'syntheticattendanceaa',storage,keyStore,cryptoProvider}
  const store=createEncryptedOfflineStore(options); store.activate('synthetic-user')
  const command=core.createAttendanceCommand({id:'synthetic-secret-command',scope:'synthetic-user:synthetic-parent',preparation:prep,response:'available'})
  await store.write('synthetic-user',{documentSchemaVersion:1,userScope:'synthetic-user',attendanceCommands:[command]})
  assert.ok([...raw.values()].every(value=>!value.includes('synthetic-secret-command')))
  const restart=createEncryptedOfflineStore(options); restart.activate('synthetic-user')
  const read=await restart.read('synthetic-user')
  assert.deepEqual(read.document.attendanceCommands,[command])
  const guard=restart.captureScopeGuard('synthetic-user'); restart.activate('another-user')
  assert.throws(guard,/offline_/)
})
