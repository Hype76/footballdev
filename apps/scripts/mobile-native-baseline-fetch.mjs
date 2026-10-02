import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,createWriteStream,existsSync,unlinkSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {loadNativeDescriptor,regularFile,assertNativeBinaries} from './mobile-ota-provenance.mjs'
import {verifyPublisherInstallation} from './mobile-eas-publisher.mjs'
import {sha256} from './mobile-security-inventory.mjs'
assert.equal(process.argv.slice(2).length,0,'Only the fixed existing Parent1.0.23 baseline is supported')
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),publisher=resolve(root,'apps/mobile-publisher')
const {descriptor,sha256:descriptorSha256}=loadNativeDescriptor(root),binding=verifyPublisherInstallation(publisher)
const output=resolve(root,'output/mobile-native-baselines/parent-1.0.23');mkdirSync(output,{recursive:true})
const records=[]
for(const approved of descriptor.builds){
 const b=JSON.parse(execFileSync(process.execPath,[resolve(publisher,'node_modules/eas-cli/bin/run'),'build:view',approved.id,'--json'],{cwd:resolve(root,'apps/parent-mobile'),encoding:'utf8',stdio:['ignore','pipe','pipe']}))
 assert.equal(b.id,approved.id);assert.equal(b.status,'FINISHED');assert.equal(b.gitCommitHash,descriptor.nativeBaselineSourceCommit);assert.equal(b.appVersion,'1.0.23');assert.equal(b.appBuildVersion,approved.appBuildVersion);assert.equal(b.app?.id,descriptor.projectId);assert.equal(b.runtime?.version,'1.0.23');assert.equal(b.updateChannel?.name,'production');assert.equal(b.sdkVersion,'54.0.0');assert.equal(b.buildProfile,'store-live');assert.equal(b.distribution,'STORE')
 const path=resolve(output,approved.artifact.file)
 if(!existsSync(path)){
  const url=b.artifacts?.applicationArchiveUrl||b.artifacts?.buildUrl;assert.equal(new URL(url).protocol,'https:')
  const response=await fetch(url);assert.ok(response.ok&&response.body,'Existing binary retrieval failed')
  await pipeline(Readable.fromWeb(response.body),createWriteStream(path,{flags:'wx'}))
  if(sha256(readFileSync(path))!==approved.artifact.sha256){unlinkSync(path);throw Error('Existing binary SHA256 differs from approved descriptor')}
 }
 const checked=regularFile(output,approved.artifact.file);assert.equal(checked.sha256,approved.artifact.sha256);assert.equal(checked.bytes,approved.artifact.bytes)
 records.push({id:b.id,projectId:b.app.id,channel:b.updateChannel.name,runtimeVersion:b.runtime.version,appVersion:b.appVersion,appBuildVersion:b.appBuildVersion,sourceCommit:b.gitCommitHash,status:b.status,profile:b.buildProfile,artifact:checked})
}
assertNativeBinaries(root,descriptor)
const receipt={scope:'Existing build metadata/artifacts read only; no new build, credentials or update',descriptorSha256,publisher:binding,builds:records}
writeFileSync(resolve(output,'read-only-retrieval-receipt.json'),JSON.stringify(receipt,null,2)+'\n')
console.log(JSON.stringify(receipt,null,2))
