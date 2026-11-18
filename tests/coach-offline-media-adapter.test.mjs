import assert from 'node:assert/strict'
import { createHash,randomBytes,createCipheriv,createDecipheriv } from 'node:crypto'
import test from 'node:test'
import { createCoachOfflineMediaAdapter, requireCoachMediaFileSize } from '../apps/mobile-core/src/coachOfflineMediaAdapterCore.js'

function fixture() {
 const files=new Map(),keys=new Map(),temporary=new Map(),events={};let signed=0, limit=100000, releaseShare,modifiedAt=1,reads=0
 const storage={async getItem(k){reads++;return files.get(k)||null},async setItem(k,v){files.set(k,v);modifiedAt++},async getStat(k){return files.has(k)?{exists:true,size:files.get(k).length,modifiedAt}:{exists:false}},async hasPrefix(p){return [...files.keys()].some(k=>k.startsWith(p+'.'))},async removePrefix(p){for(const k of files.keys())if(k.startsWith(p+'.'))files.delete(k)},async measureBytes(){return [...files.values()].reduce((a,v)=>a+v.length,0)}}
 const keyStore={async getItem(k){return keys.get(k)||null},async setItem(k,v){keys.set(k,v)},async removeItem(k){keys.delete(k)}}
 const crypto={async randomBytes(n){return new Uint8Array(randomBytes(n))},async seal({key,nonce,aad,plaintext}){const c=createCipheriv('aes-256-gcm',key,nonce.slice(0,12));c.setAAD(Buffer.from(aad));return new Uint8Array(Buffer.concat([c.update(plaintext),c.final(),c.getAuthTag()]))},async open({key,nonce,aad,ciphertext}){const b=Buffer.from(ciphertext),d=createDecipheriv('aes-256-gcm',key,nonce.slice(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(-16));return new Uint8Array(Buffer.concat([d.update(b.subarray(0,-16)),d.final()]))}}
 const params={storage,keyStore,crypto,fingerprint:async v=>createHash('sha256').update(v).digest('hex'),remainingBudget:async media=>limit-media,fetchAuthorized:async({resource})=>{signed++;return {resource,signedUrl:'https://storage.example.test/storage/v1/object/sign/private/file?token=secret'}},fetchImpl:async()=>new Response('secret',{headers:{'content-length':'6'}}),tempFiles:{async clear(){temporary.clear()},async write(name,value){temporary.set(name,value);return 'file://private/'+name}},sharing:{isAvailableAsync:async()=>true,shareAsync:async()=>new Promise(resolve=>{releaseShare=resolve})},appState:{addEventListener(_name,fn){events.change=fn;return{remove(){}}}},allowedOrigin:'https://storage.example.test'}
 const make=()=>createCoachOfflineMediaAdapter(params),media=make();media.activate({environment:'live',projectRef:'storage',userId:'user-a'})
 const context={id:'team:t',clubId:'club',teamId:'t'},resource={id:'r',clubId:'club',teamId:'t',updatedAt:'revision',type:'file',storageBucket:'private',storagePath:'club/t/secret.pdf',mimeType:'application/pdf',fileSizeBytes:6}, guard=()=>{}
 return {media,make,context,resource,guard,files,keys,temporary,events,params,signed:()=>signed,limit:v=>{limit=v},finishShare:()=>releaseShare(),touch:()=>{modifiedAt++},reads:()=>reads}
}

test('private save uses authorized signed URL and encrypted storage across cold creation',async()=>{
 const f=fixture();await f.media.save(f);assert.equal(f.signed(),1);assert.equal(await f.media.has(f),true)
 assert.equal([...f.files.values()].join('').includes('secret'),false)
 const again=f.make();again.activate({environment:'live',projectRef:'storage',userId:'user-a'});assert.equal(await again.has(f),true)
 await again.save(f);assert.equal(f.signed(),2)
 again.activate({environment:'live',projectRef:'storage',userId:'user-b'});assert.equal(await again.has(f),false)
 assert.throws(()=>again.activate({environment:'live',projectRef:'other',userId:'user-a'}),/scope_invalidated/)
})
test('untrusted or unbounded downloads and external links never enter cache',async()=>{
 const f=fixture();f.params.fetchImpl=async()=>new Response('secret')
 const media=f.make();media.activate({environment:'live',projectRef:'storage',userId:'user-a'})
 await assert.rejects(media.save(f),/download_size_unverified/)
 await assert.rejects(media.save({...f,resource:{...f.resource,type:'external_link'}}),/external_online_only/)
 assert.equal(f.files.size,0)
})
test('a changed server-side resource cannot be cached under stale metadata',async()=>{
 const f=fixture();f.params.fetchAuthorized=async({resource})=>({signedUrl:'https://storage.example.test/storage/v1/object/sign/private/file?token=secret',resource:{...resource,updatedAt:'new-revision'}})
 const media=f.make();media.activate({environment:'live',projectRef:'storage',userId:'user-a'})
 await assert.rejects(media.save(f),/revision_mismatch/);assert.equal(f.files.size,0)
})
test('authorized first-party formation JSON can be cached and opened as a saved file',async()=>{
 const f=fixture(),resource={...f.resource,mimeType:'application/vnd.footballplayer.formation-board+json'}
 await f.media.save({...f,resource});assert.equal(await f.media.has({...f,resource}),true)
 const opening=f.media.open({...f,resource});while(!f.temporary.size)await new Promise(resolve=>setTimeout(resolve,0))
 assert.equal([...f.temporary.keys()][0],'resource.json');f.finishShare();await opening
})
test('sharing leases the temporary file while backgrounded and clears on completion and logout',async()=>{
 const f=fixture();await f.media.save(f);const opening=f.media.open(f)
 while(!f.temporary.size) await new Promise(resolve=>setTimeout(resolve,0))
 f.events.change('background');await Promise.resolve();assert.equal(f.temporary.size,1)
 f.finishShare();await opening;assert.equal(f.temporary.size,0)
 await f.media.clearAccount();assert.equal(f.files.size,0);assert.equal(f.keys.size,0)
})
test('logout clears a previously saved account even before cold-session activation',async()=>{
 const f=fixture();await f.media.save(f);f.temporary.set('leftover','plaintext')
 const cold=f.make()
 await cold.clearAccountScope({environment:'live',projectRef:'storage',userId:'user-a'})
 assert.equal(f.files.size,0);assert.equal(f.keys.size,0);assert.equal(f.temporary.size,0)
 assert.throws(()=>cold.clearAccountScope({environment:'live',projectRef:'other',userId:'user-a'}),/scope_invalidated/)
})
test('stale context fences block saving and opening',async()=>{
 const f=fixture();let valid=true;const guard=()=>{if(!valid)throw Error('stale authority')}
 await f.media.save({...f,guard});valid=false
 await assert.rejects(f.media.open({...f,guard}),/stale authority/)
 await assert.rejects(f.media.save({...f,guard}),/stale authority/)
})
test('account switch during a download cannot commit media to the old account',async()=>{
 const f=fixture();let resolveFetch
 f.params.fetchImpl=()=>new Promise(resolve=>{resolveFetch=resolve})
 const media=f.make();media.activate({environment:'live',projectRef:'storage',userId:'user-a'})
 const saving=media.save(f)
 while(!resolveFetch) await new Promise(resolve=>setTimeout(resolve,0))
 media.activate({environment:'live',projectRef:'storage',userId:'user-b'})
 resolveFetch(new Response('secret',{headers:{'content-length':'6'}}))
 await assert.rejects(saving,/scope_invalidated/)
 assert.equal(f.files.size,0)
})
test('a scoped badge is returned as an in-memory image only while its grant is current',async()=>{
 const f=fixture(),resource={...f.resource,id:'badge',kind:'badge',mimeType:'image/png'}
 await f.media.save({...f,resource})
 assert.equal(await f.media.getDisplayUri({...f,resource}),'data:image/png;base64,c2VjcmV0')
 await assert.rejects(f.media.getDisplayUri({...f,resource:{...resource,expiresAt:'2000-01-01T00:00:00Z'}}),/expired/)
})
test('readiness verifies cold media, caches unchanged stat, and detects removal or corruption',async()=>{
 const f=fixture();await f.media.save(f)
 const cold=f.make();cold.activate({environment:'live',projectRef:'storage',userId:'user-a'})
 assert.equal(await cold.verifyInventory({...f,resources:[f.resource]}),true)
 const first=f.reads();assert.equal(await cold.verifyInventory({...f,resources:[f.resource]}),true);assert.equal(f.reads(),first)
 const key=[...f.files.keys()][0],original=f.files.get(key);f.files.set(key,original.slice(0,-1));f.touch()
 await assert.rejects(cold.verifyInventory({...f,resources:[f.resource]}),/corrupt/)
 f.files.delete(key);assert.equal(await cold.verifyInventory({...f,resources:[f.resource]}),false)
})
test('readiness re-verifies ciphertext when modification time is unavailable',async()=>{
 const f=fixture();await f.media.save(f)
 f.params.storage.getStat=async key=>({exists:f.files.has(key),size:f.files.get(key)?.length})
 const cold=f.make();cold.activate({environment:'live',projectRef:'storage',userId:'user-a'})
 assert.equal(await cold.verifyInventory({...f,resources:[f.resource]}),true)
 const first=f.reads();assert.equal(await cold.verifyInventory({...f,resources:[f.resource]}),true);assert.ok(f.reads()>first)
})
test('media budget measurement fails closed for unknown or invalid file sizes',()=>{
 assert.equal(requireCoachMediaFileSize({exists:false}),0)
 assert.equal(requireCoachMediaFileSize({exists:true,isDirectory:false,size:12}),12)
 for(const size of [undefined,NaN,-1,1.5,Infinity]) assert.throws(()=>requireCoachMediaFileSize({exists:true,isDirectory:false,size}),/size_unavailable/)
 assert.throws(()=>requireCoachMediaFileSize({exists:true,isDirectory:true,size:0}),/size_unavailable/)
})

test('saved kit artwork is scoped to its board version and image path',async()=>{
 const f=fixture(),resource={...f.resource,id:'kit:version',sourceId:'version',kind:'kit',mimeType:'image/png',storageBucket:'club-kits',storagePath:'club/shirt.png',updatedAt:'club/shirt.png'}
 await f.media.save({...f,resource})
 assert.equal(await f.media.getDisplayUri({...f,resource}),'data:image/png;base64,c2VjcmV0')
 assert.equal(await f.media.has({...f,resource:{...resource,id:'kit:other',sourceId:'other'}}),false)
 assert.equal(await f.media.has({...f,resource:{...resource,storagePath:'club/other.png',updatedAt:'club/other.png'}}),false)
})

test('slow media download does not hold the document lock and commit checks fresh budget and account',async()=>{
 const {withCoachOfflineStorageLock}=await import('../apps/coach-mobile/src/coachOfflineStorageBudget.js')
 for(const mode of ['budget','account']) {
  const f=fixture();let release,started;const downloadStarted=new Promise(resolve=>{started=resolve}), gate=new Promise(resolve=>{release=resolve})
  f.params.withCommitLock=withCoachOfflineStorageLock
  f.params.fetchImpl=async()=>{started();await gate;return new Response('secret',{headers:{'content-length':'6'}})}
  const media=f.make();media.activate({environment:'live',projectRef:'storage',userId:'user-a'})
  const save=media.save(f);await downloadStarted
  let foreground=false;await withCoachOfflineStorageLock(async()=>{foreground=true;if(mode==='budget')f.limit(0);else media.activate({environment:'live',projectRef:'storage',userId:'user-b'})})
  assert.equal(foreground,true,'Foreground write completes before the stalled download')
  release();await assert.rejects(save,mode==='budget'?/budget_exceeded/:/scope_invalidated/);assert.equal(f.files.size,0)
 }
})
