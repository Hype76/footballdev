import assert from 'node:assert/strict'
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import test from 'node:test'
import { createCoachEncryptedMediaStore } from '../apps/mobile-core/src/coachEncryptedMediaStore.js'

function fixture() {
  const files=new Map(), keys=new Map()
  const storage={async getItem(k){return files.get(k)||null},async setItem(k,v){files.set(k,v)},async hasPrefix(p){return [...files.keys()].some(k=>k.startsWith(p+'.'))},async removePrefix(p){for(const k of files.keys())if(k.startsWith(p+'.'))files.delete(k)}}
  const keyStore={async getItem(k){return keys.get(k)||null},async setItem(k,v){keys.set(k,v)},async removeItem(k){keys.delete(k)}}
  const crypto={async randomBytes(n){return new Uint8Array(randomBytes(n))},async seal({key,nonce,aad,plaintext}){const c=createCipheriv('aes-256-gcm',key,nonce.slice(0,12));c.setAAD(Buffer.from(aad));return new Uint8Array(Buffer.concat([c.update(plaintext),c.final(),c.getAuthTag()]))},async open({key,nonce,aad,ciphertext}){const b=Buffer.from(ciphertext),d=createDecipheriv('aes-256-gcm',key,nonce.slice(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(-16));return new Uint8Array(Buffer.concat([d.update(b.subarray(0,-16)),d.final()]))}}
  let remaining=1_000_000
  const store=createCoachEncryptedMediaStore({storage,keyStore,crypto,fingerprint:async value=>createHash('sha256').update(value).digest('hex'),availableBytes:async()=>remaining})
  const account='live:account-a',context={id:'team:t',clubId:'club',teamId:'t'}
  const resource={id:'r',clubId:'club',teamId:'t',updatedAt:'2026-01-01T00:00:00Z',type:'file',storageBucket:'private',storagePath:'club/team/secret.pdf',mimeType:'application/pdf',fileSizeBytes:6}
  store.activate(account)
  return {store,files,keys,account,context,resource,limit:value=>{remaining=value}}
}

test('encrypted media survives a cold read without storing resource identity or plaintext',async()=>{
 const f=fixture(), bytes=new TextEncoder().encode('secret')
 await f.store.prepare({...f,bytes})
 const disk=[...f.files].map(([k,v])=>k+v).join('')
 assert.equal(disk.includes('secret'),false);assert.equal(disk.includes('club/team'),false)
 assert.deepEqual(await f.store.open(f),bytes)
 assert.equal(await f.store.has(f),true)
})
test('scope, revisions, expiry, corrupted data and account switching fail closed',async()=>{
 const f=fixture();await f.store.prepare({...f,bytes:new TextEncoder().encode('secret')})
 await assert.rejects(f.store.open({...f,context:{...f.context,teamId:'other'}}),/scope_mismatch/)
 await assert.rejects(f.store.open({...f,resource:{...f.resource,updatedAt:'new'}}),/missing/)
 await assert.rejects(f.store.open({...f,resource:{...f.resource,expiresAt:'2000-01-01T00:00:00Z'}}),/expired/)
 const key=[...f.files.keys()][0],envelope=JSON.parse(f.files.get(key));envelope.ciphertext=(envelope.ciphertext[0]==='A'?'B':'A')+envelope.ciphertext.slice(1);f.files.set(key,JSON.stringify(envelope))
 await assert.rejects(f.store.open(f),/corrupt/)
 f.store.activate('live:account-b');await assert.rejects(f.store.open(f),/scope_invalidated/)
})
test('budget rejection and logout do not persist plaintext and missing keys do not overwrite data',async()=>{
 const f=fixture();f.limit(1)
 await assert.rejects(f.store.prepare({...f,bytes:new TextEncoder().encode('secret')}),/budget_exceeded/)
 assert.equal(f.files.size,0)
 f.limit(10000);await f.store.prepare({...f,bytes:new TextEncoder().encode('secret')})
 f.keys.clear();await assert.rejects(f.store.prepare({...f,bytes:new TextEncoder().encode('secret')}),/key_missing/)
 await f.store.clear(f.account);assert.equal(f.files.size,0)
})
test('a failed ciphertext readback is not reported as saved',async()=>{
 const f=fixture();const originalSet=f.files.set.bind(f.files)
 f.files.set=(key,value)=>originalSet(key,value.slice(0,-1))
 await assert.rejects(f.store.prepare({...f,bytes:new TextEncoder().encode('secret')}),/write_verification_failed/)
})
