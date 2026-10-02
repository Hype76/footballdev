import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {publisherInvocation,publisherTreeDigest,verifyPublisherInstallation} from '../apps/scripts/mobile-eas-publisher.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
function fixture(t) {
 const root=mkdtempSync(resolve(tmpdir(),'publisher-test-')); t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(resolve(root,'node_modules/eas-cli/bin'),{recursive:true})
 const lock={packages:{'':{dependencies:{'eas-cli':'24.8.0'}},'node_modules/eas-cli':{version:'24.8.0',integrity:'sha512-fixture'}}}
 const save=(path,value)=>writeFileSync(resolve(root,path),typeof value==='string'?value:JSON.stringify(value))
 save('package-lock.json',lock); save('node_modules/.package-lock.json',{packages:{'node_modules/eas-cli':lock.packages['node_modules/eas-cli']}})
 save('node_modules/eas-cli/package.json',{version:'24.8.0'}); save('node_modules/eas-cli/bin/run','reviewed fixture')
 const receipt={lockSha256:hash(readFileSync(resolve(root,'package-lock.json'))),artifactSha256:publisherTreeDigest(root),platform:process.platform,arch:process.arch,nodeVersion:process.version}
 save('.install-receipt.json',receipt)
 return {root,save,lock,receipt}
}
test('reviewed graph and artifact receipt validate',t=>{const f=fixture(t);assert.deepEqual(verifyPublisherInstallation(f.root),{lockSha256:f.receipt.lockSha256,artifactSha256:f.receipt.artifactSha256})})
test('modified installed executable fails closed',t=>{const f=fixture(t);f.save('node_modules/eas-cli/bin/run','changed');assert.throws(()=>verifyPublisherInstallation(f.root),/receipt mismatch/)})
test('unreviewed package/version or integrity fails closed',t=>{const f=fixture(t);f.save('node_modules/.package-lock.json',{packages:{'node_modules/eas-cli':{version:'24.8.0',integrity:'wrong'}}});assert.throws(()=>verifyPublisherInstallation(f.root),/graph differs/)})
test('changed committed lock and stale receipt fail closed',t=>{const f=fixture(t);f.lock.note='changed';f.save('package-lock.json',f.lock);assert.throws(()=>verifyPublisherInstallation(f.root),/receipt mismatch/)})
test('changed actual installed package version fails closed',t=>{const f=fixture(t);f.save('node_modules/eas-cli/package.json',{version:'24.9.0'});assert.throws(()=>verifyPublisherInstallation(f.root),/package differs/)})
test('wrong Node installation receipt fails closed',t=>{const f=fixture(t);f.receipt.nodeVersion='v0.0.0';f.save('.install-receipt.json',f.receipt);assert.throws(()=>verifyPublisherInstallation(f.root),/receipt mismatch/)})
test('adapter only permits the three reviewed command paths',()=>{for(const cmd of ['login','build','submit','credentials'])assert.throws(()=>publisherInvocation([cmd]),/permits only/)})
test('OTA guard binds auth/environment/update and retains release controls',()=>{
 const guard=readFileSync(new URL('../apps/scripts/mobile-update-guard.mjs',import.meta.url),'utf8')
 assert.ok(guard.includes("publisherInvocation(['env:exec'"));assert.ok(guard.includes("const updatePublisher = publisherInvocation(["));assert.ok(!guard.includes("execFileSync('npx'"))
 for(const token of ['MOBILE_OTA_UPDATE_CONFIRMED','MOBILE_OTA_UPDATE_MESSAGE','--porcelain','origin/main','assertEasLogin()','mobile:release-check','MOBILE_OTA_REVIEWED_MANIFEST_SHA256'])assert.ok(guard.includes(token),token)
})
