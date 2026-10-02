import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync} from 'node:fs'
import {resolve,relative,isAbsolute} from 'node:path'
import {inventory,sha256} from './mobile-security-inventory.mjs'

export const nativeTarget='parent-1.0.23'
const parentProject='7e0906f3-64f4-42d9-b45d-0ee68f599baa'
const baselineSource='461305128dcad533d856f8912878ede781d844c6'
const binaries={android:{id:'570a221d-2a65-456c-9656-cd3593c693d9',sha256:'2355b7ae2804106a14a1896a6204e4097d5a2f11961eb44f79f8409f6bdfd722'},ios:{id:'3ac2b600-1024-4d6d-a140-35cbfc45a7f8',sha256:'527eb62cc26f3bb36eb84669125e174e534672b820acb8d852f868c69833303f'}}
export function canonical(value) {
 const sort=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(sort):Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v
 return JSON.stringify(sort(value))
}
export function configValue(exp) {const {_internal,...value}=exp;void _internal;return value}
export function configHash(exp) {return sha256(Buffer.from(canonical(configValue(exp))))}
export function targetPaths(root,role,target,commit) {
 assert.ok(['coach','parent'].includes(role),'Unknown app role')
 assert.ok(target==='tracked'||(role==='parent'&&target===nativeTarget),'Target is not allowlisted for app role')
 assert.match(commit,/^[a-f0-9]{40}$/,'Expected exact source commit')
 const base=resolve(root,'output/mobile-ota',role,target,commit)
 return {base,projectRoot:resolve(base,'project'),appRoot:resolve(base,'project/apps',role+'-mobile'),exportRoot:resolve(base,'export'),manifestPath:resolve(base,'reviewed-export-manifest.json'),inventoryPath:resolve(base,'module-inventory.json')}
}
export function git(root,args) {return execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,...args],{cwd:root,encoding:'utf8'}).trim()}
export function sourceFiles(root,commit) {
 assert.equal(git(root,['rev-parse','HEAD']),commit,'Source commit drift')
 assert.equal(git(root,['status','--porcelain']),'','Source worktree must be clean')
 return git(root,['ls-files','-z']).split('\0').filter(Boolean).sort().map(path=>({path,sha256:sha256(readFileSync(resolve(root,path)))}))
}
export function sourceHash(files) {return sha256(Buffer.from(canonical(files)))}
export function regularFile(root,path) {
 assert.ok(typeof path==='string'&&path&&!isAbsolute(path)&&!path.split(/[\\/]/).includes('..'),'Unsafe artifact path')
 const file=resolve(root,path),rel=relative(realpathSync(root),realpathSync(file))
 assert.ok(!rel.startsWith('..')&&!isAbsolute(rel),'Artifact escapes root')
 const stat=lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'Artifact must be a regular file')
 return {path:path.replaceAll('\\','/'),bytes:stat.size,sha256:sha256(readFileSync(file))}
}
export function payloadFiles(root) {
 function walk(dir){return readdirSync(dir).sort().flatMap(name=>{const file=resolve(dir,name),stat=lstatSync(file);assert.ok(!stat.isSymbolicLink(),'Payload links are forbidden');return stat.isDirectory()?walk(file):[regularFile(root,relative(root,file).replaceAll('\\','/'))]})}
 return walk(root).sort((a,b)=>a.path.localeCompare(b.path))
}
export function assertPayloads(root,expected) {
 assert.ok(Array.isArray(expected)&&expected.length,'Complete payload hashes required')
 assert.equal(new Set(expected.map(x=>x.path)).size,expected.length,'Duplicate payload path')
 assert.equal(canonical(payloadFiles(root)),canonical(expected),'Payload file set, bytes or hash changed')
 const declared=new Set(expected.map(x=>x.path)),metadata=JSON.parse(readFileSync(resolve(root,'metadata.json')))
 for(const platform of ['ios','android']){
  const group=metadata.fileMetadata?.[platform];assert.ok(group,'Native metadata missing')
  assert.ok(declared.has(group.bundle.replaceAll('\\','/')),'Native bundle missing from payload hashes')
  for(const asset of group.assets||[]){const path=typeof asset==='string'?asset:asset.path;assert.ok(declared.has(path.replaceAll('\\','/')),'Metadata asset missing from payload hashes: '+path)}
 }
}
export function loadNativeDescriptor(root) {
 const path=resolve(root,'apps/mobile-targets/parent-1.0.23.json'),bytes=readFileSync(path),descriptor=JSON.parse(bytes)
 assert.equal(descriptor.schemaVersion,1);assert.equal(descriptor.targetId,nativeTarget);assert.equal(descriptor.role,'parent')
 assert.equal(descriptor.projectId,parentProject);assert.equal(descriptor.channel,'production');assert.equal(descriptor.environment,'production')
 assert.equal(descriptor.appVersion,'1.0.23');assert.equal(descriptor.runtimeVersion,'1.0.23');assert.equal(descriptor.runtimePolicy,'appVersion')
 assert.equal(sha256(Buffer.from(canonical(descriptor.nativeInputs))),'ba692d1a73da68c51860b1f4a4aeb955d3450749a756f16e9e09c3c7b4ec945e','Reviewed native baseline requirements changed');
 assert.equal(descriptor.packageName,'com.footballplayer.parents');assert.equal(descriptor.nativeBaselineSourceCommit,baselineSource)
 assert.equal(descriptor.builds.length,2)
 for(const platform of ['ios','android']){
  const build=descriptor.builds.find(b=>b.platform===platform)
  assert.ok(build);assert.equal(build.id,binaries[platform].id);assert.equal(build.projectId,parentProject);assert.equal(build.sourceCommit,baselineSource)
  assert.equal(build.appBuildVersion,platform==='ios'?'52':'45');assert.equal(build.status,'FINISHED');assert.equal(build.profile,'store-live');assert.equal(build.distribution,'STORE');assert.equal(build.appVersion,'1.0.23')
  assert.equal(build.artifact.file,platform+'-existing-native.archive');assert.equal(build.artifact.sha256,binaries[platform].sha256)
 }
 return {descriptor,sha256:sha256(bytes)}
}
export function assertNativeRequirements(root,descriptor) {
 const pkg=JSON.parse(readFileSync(resolve(root,'apps/parent-mobile/package.json'))),lock=JSON.parse(readFileSync(resolve(root,'apps/parent-mobile/package-lock.json')))
 assert.equal(pkg.version,'1.0.22','Tracked Parent version changed')
 for(const [name,range] of Object.entries(pkg.dependencies)){
  assert.equal(descriptor.nativeInputs.dependencies[name],range,'Native baseline requirement added or changed: '+name)
  assert.equal(lock.packages['node_modules/'+name]?.version,descriptor.nativeInputs.resolvedDirectVersions[name],'Native baseline resolved version changed: '+name)
 }
 assert.equal(sha256(Buffer.from(canonical(lock))),descriptor.nativeInputs.reviewedCandidateLockSha256,'Reviewed native/transitive lock graph changed')
 for(const [path,record] of Object.entries(descriptor.nativeInputs.files)){
  const bytes=readFileSync(resolve(root,path));assert.equal(sha256(record.textNormalised?Buffer.from(bytes.toString().replaceAll('\r\n','\n')):bytes),record.sha256,'Native input changed: '+path)
 }
 const config=readFileSync(resolve(root,'apps/parent-mobile/app.config.js'),'utf8').replaceAll('\r\n','\n').replace("version: '1.0.22'","version: '<approved-appVersion>'")
 assert.equal(sha256(Buffer.from(config)),descriptor.nativeInputs.normalisedAppConfigSha256,'Parent native app configuration changed')
}
export function assertNativeBinaries(root,descriptor) {
 const binaryRoot=resolve(root,'output/mobile-native-baselines/parent-1.0.23')
 for(const build of descriptor.builds){assert.deepEqual(regularFile(binaryRoot,build.artifact.file),{path:build.artifact.file,bytes:build.artifact.bytes,sha256:build.artifact.sha256},'Native binary differs from approved descriptor')}
 const parser=resolve(root,'apps/scripts/mobile-native-binary-provenance.py')
 const compiled=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[parser,binaryRoot],{encoding:'utf8'}))
 assert.equal(canonical(compiled),canonical(descriptor.compiledNativeEvidence),'Compiled binary runtime/project/channel/signing configuration differs')
}
export function selectTarget(root,role,target,sourceConfig) {
 targetPaths(root,role,target,'0'.repeat(40))
 const config=configValue(sourceConfig)
 assert.equal(config.runtimeVersion?.policy,'appVersion','Runtime policy changed')
 assert.equal(config.version,role==='coach'?'1.0.25':'1.0.22','Tracked app version changed')
 assert.equal(config.extra?.appRole,role,'App role mismatch')
 assert.equal(config.extra?.eas?.projectId,role==='coach'?'347965b1-f32f-47b1-8c86-7aa910fe2cb5':parentProject,'Project mismatch')
 assert.equal(config.updates?.url,'https://u.expo.dev/'+config.extra.eas.projectId,'Update URL mismatch')
 assert.ok(!config.updates?.codeSigningCertificate&&!config.updates?.codeSigningMetadata,'Unexpected signing config: this reviewed path is unsigned')
 let descriptorSha256=null
 if(target===nativeTarget){const loaded=loadNativeDescriptor(root);assertNativeRequirements(root,loaded.descriptor);assertNativeBinaries(root,loaded.descriptor);descriptorSha256=loaded.sha256;config.version='1.0.23';config.ios={...config.ios,buildNumber:'52'};config.android={...config.android,versionCode:45}}
 return {config,descriptorSha256,runtimeVersion:config.version,projectId:config.extra.eas.projectId}
}
export function generatedSource(root,role,target,config) {
 const files={[`apps/${role}-mobile/app.config.js`]:Buffer.from('module.exports = { expo: '+JSON.stringify(configValue(config),null,2)+' }\n')}
 const metroPath=`apps/${role}-mobile/metro.config.js`,dependencyRoots=[resolve(root,'node_modules'),resolve(root,'apps',role+'-mobile/node_modules')]
 files[metroPath]=Buffer.from(readFileSync(resolve(root,metroPath),'utf8')+'\n// The isolated copy watches only the linked installed dependency trees as additional roots.\nmodule.exports.watchFolders = [...module.exports.watchFolders, ...'+JSON.stringify(dependencyRoots)+']\n')
 if(target===nativeTarget){
  const pkg=JSON.parse(readFileSync(resolve(root,'apps/parent-mobile/package.json'))),lock=JSON.parse(readFileSync(resolve(root,'apps/parent-mobile/package-lock.json')))
  pkg.version='1.0.23';lock.version='1.0.23';lock.packages[''].version='1.0.23'
  files['apps/parent-mobile/package.json']=Buffer.from(JSON.stringify(pkg,null,2)+'\n');files['apps/parent-mobile/package-lock.json']=Buffer.from(JSON.stringify(lock,null,2)+'\n')
 }
 return files
}
export function assertPreparedSource(root,paths,manifest,config) {
 const generated=manifest.generatedSourceFiles||{},expected=new Set(manifest.sourceFiles.map(x=>x.path)),links=new Map([['node_modules',resolve(root,'node_modules')],[`apps/${manifest.role}-mobile/node_modules`,resolve(root,`apps/${manifest.role}-mobile/node_modules`)]])
 assert.equal(canonical(generated),canonical(Object.fromEntries(Object.entries(generatedSource(root,manifest.role,manifest.targetId,config)).map(([path,bytes])=>[path,sha256(bytes)]))),'Generated source is not the exact permitted metadata/config snapshot')
 for(const item of manifest.sourceFiles)assert.equal(regularFile(paths.projectRoot,item.path).sha256,generated[item.path]||item.sha256,'Prepared source changed: '+item.path)
 for(const path of Object.keys(generated))assert.ok(expected.has(path),'Unknown generated source path')
 function walk(dir){for(const name of readdirSync(dir)){const file=resolve(dir,name),path=relative(paths.projectRoot,file).replaceAll('\\','/'),stat=lstatSync(file)
  if(links.has(path)){assert.equal(realpathSync(file),realpathSync(links.get(path)),'Prepared dependency link mismatch');continue}
  if(path===`apps/${manifest.role}-mobile/.expo`&&stat.isDirectory())continue
  assert.ok(!stat.isSymbolicLink(),'Unexpected prepared source link')
  if(stat.isDirectory())walk(file);else assert.ok(expected.has(path),'Unexpected prepared source file: '+path)
 }}
 walk(paths.projectRoot)
}
export function verifyReviewedExport({root,role,target,commit,manifestSha256,sourceConfig}) {
 assert.match(manifestSha256||'',/^[a-f0-9]{64}$/,'Reviewed manifest SHA256 required')
 const paths=targetPaths(root,role,target,commit),bytes=readFileSync(paths.manifestPath)
 assert.equal(sha256(bytes),manifestSha256,'Reviewed manifest hash mismatch')
 const manifest=JSON.parse(bytes),files=sourceFiles(root,commit)
 assert.equal(manifest.role,role);assert.equal(manifest.targetId,target);assert.equal(manifest.channel,'production');assert.equal(manifest.environment,'production')
 assert.equal(manifest.sourceCommit,commit);assert.equal(manifest.sourceInputsSha256,sourceHash(files));assert.equal(canonical(manifest.sourceFiles),canonical(files))
 const selected=selectTarget(root,role,target,sourceConfig)
 assert.equal(manifest.descriptorSha256,selected.descriptorSha256);assert.equal(manifest.runtimeVersion,selected.runtimeVersion);assert.equal(manifest.appVersion,selected.config.version);assert.equal(manifest.runtimePolicy,'appVersion')
 assert.equal(manifest.projectId,selected.projectId);assert.equal(manifest.privateConfigSha256,configHash(selected.config),'Resolved production private config changed')
 assert.equal(manifest.codeSigningCertificatePresent,false);assert.equal(manifest.codeSigningMetadataPresent,false)
 assertPreparedSource(root,paths,manifest,selected.config);assertPayloads(paths.exportRoot,manifest.payloads)
 const artifacts=inventory(paths.exportRoot,{manifestPath:paths.manifestPath,manifestSha256,sourceCommit:commit,runtimeVersion:selected.runtimeVersion,appVersion:selected.config.version,runtimePolicy:'appVersion',platforms:['ios','android','web']})
 assert.ok(artifacts.every(a=>Object.values(a.roots).every(r=>!r.shipped)),'Audited root appears in reviewed export')
 return {paths,manifest,artifacts,config:selected.config}
}
export function reviewedUpdateArgs(paths,{platform,message}) {
 assert.ok(['ios','android','all'].includes(platform),'Unsupported update platform')
 assert.match(message,/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/,'Unsafe update message')
 assert.ok(existsSync(paths.exportRoot),'Reviewed export missing')
 return ['update','--channel','production','--environment','production','--message',message,'--platform',platform,'--input-dir',paths.exportRoot,'--skip-bundler','--clear-cache','--non-interactive','--json']
}
