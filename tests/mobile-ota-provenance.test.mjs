import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,dirname,relative} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {sha256} from '../apps/scripts/mobile-security-inventory.mjs'
import {targetPaths,payloadFiles,assertPayloads,loadNativeDescriptor,assertNativeRequirements,assertNativeBinaries,configHash,generatedSource,sourceFiles,sourceHash,verifyReviewedExport,canonical} from '../apps/scripts/mobile-ota-provenance.mjs'
import {publishReviewedBytes} from '../apps/scripts/mobile-ota-publish.mjs'
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const makeTemp=t=>{const root=mkdtempSync(resolve(tmpdir(),'mobile-ota-test-'));t.after(()=>{assert.ok(!relative(resolve(tmpdir()),root).startsWith('..'));rmSync(root,{recursive:true,force:true})});return root}
const save=(root,path,value)=>{mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n')}
function payload(t){const root=makeTemp(t);for(const p of ['ios','android','web'])save(root,`_expo/static/js/${p}/index.${p==='web'?'js':'hbc'}`,'reviewed '+p);save(root,'assets/image.bin','reviewed image');save(root,'assets/font.bin','reviewed font');save(root,'metadata.json',{fileMetadata:Object.fromEntries(['ios','android'].map(p=>[p,{bundle:`_expo/static/js/${p}/index.hbc`,assets:[{path:'assets/image.bin'},{path:'assets/font.bin'}]}]))});return root}
test('only tracked roles and the named Parent1.0.23 target derive canonical directories',()=>{
 const commit='a'.repeat(40);assert.ok(targetPaths(repo,'parent','parent-1.0.23',commit).exportRoot.includes('parent-1.0.23'))
 for(const [role,target,c] of [['coach','parent-1.0.23',commit],['parent','1.0.24',commit],['parent','../../evil',commit],['parent','tracked','../../evil'],['unknown','tracked',commit]])assert.throws(()=>targetPaths(repo,role,target,c))
})
test('complete asset bytes and exact file set are verified',t=>{const root=payload(t),files=payloadFiles(root);assertPayloads(root,files);save(root,'assets/image.bin','tampered image');assert.throws(()=>assertPayloads(root,files),/Payload/)})
test('missing, additional and duplicate assets fail closed',t=>{
 const root=payload(t),files=payloadFiles(root);rmSync(resolve(root,'assets/font.bin'));assert.throws(()=>assertPayloads(root,files),/Payload/)
 save(root,'assets/font.bin','reviewed font');save(root,'assets/extra.bin','unknown');assert.throws(()=>assertPayloads(root,files),/Payload/);assert.throws(()=>assertPayloads(root,[...files,files[0]]),/Duplicate/)
})
test('metadata cannot reference an absent or traversal asset',t=>{const root=payload(t);save(root,'metadata.json',{fileMetadata:{ios:{bundle:'_expo/static/js/ios/index.hbc',assets:[{path:'../outside'}]},android:{bundle:'_expo/static/js/android/index.hbc',assets:[]}}});assert.throws(()=>assertPayloads(root,payloadFiles(root)),/Metadata asset/)})
test('descriptor fixes exact existing build identities, project, channel and runtime',t=>{
 const root=makeTemp(t),d=JSON.parse(readFileSync(resolve(repo,'apps/mobile-targets/parent-1.0.23.json')))
 const write=()=>save(root,'apps/mobile-targets/parent-1.0.23.json',d);write();loadNativeDescriptor(root)
 for(const [key,value] of [['projectId','wrong'],['channel','preview'],['runtimeVersion','1.0.24'],['runtimePolicy','fingerprint'],['nativeBaselineSourceCommit','0'.repeat(40)]]){const old=d[key];d[key]=value;write();assert.throws(()=>loadNativeDescriptor(root));d[key]=old}
 d.builds[0].id='unknown';write();assert.throws(()=>loadNativeDescriptor(root))
})
function nativeFixture(t){const root=makeTemp(t),d=loadNativeDescriptor(repo).descriptor;for(const path of ['apps/parent-mobile/package.json','apps/parent-mobile/package-lock.json','apps/parent-mobile/app.config.js',...Object.keys(d.nativeInputs.files)]){mkdirSync(dirname(resolve(root,path)),{recursive:true});cpSync(resolve(repo,path),resolve(root,path))}return {root,d}}
test('actual tracked Parent requirements fit the reviewed binary-only Calendar/Clipboard superset',()=>{const {descriptor}=loadNativeDescriptor(repo);assertNativeRequirements(repo,descriptor);assert.deepEqual(descriptor.nativeInputs.binaryOnlySuperset.modules,['expo-calendar','expo-clipboard'])})
test('native additions, changed versions, config/plugins and assets reject',t=>{
 const {root,d}=nativeFixture(t);assertNativeRequirements(root,d)
 const path='apps/parent-mobile/package.json',original=readFileSync(resolve(root,path));const pkg=JSON.parse(original);pkg.dependencies['new-native-module']='1.0.0';save(root,path,pkg);assert.throws(()=>assertNativeRequirements(root,d),/added or changed/);writeFileSync(resolve(root,path),original)
 const lockPath='apps/parent-mobile/package-lock.json',lockBytes=readFileSync(resolve(root,lockPath)),lock=JSON.parse(lockBytes);lock.packages['node_modules/react-native'].version='0.82.0';save(root,lockPath,lock);assert.throws(()=>assertNativeRequirements(root,d),/resolved version/);writeFileSync(resolve(root,lockPath),lockBytes)
 save(root,'apps/parent-mobile/app.config.js',readFileSync(resolve(root,'apps/parent-mobile/app.config.js'),'utf8')+'\nconfig.expo.plugins.push("new-native-plugin")\n');assert.throws(()=>assertNativeRequirements(root,d),/configuration changed/)
})
test('native binary byte drift is rejected before parsing or any upload',t=>{const root=makeTemp(t),{descriptor}=loadNativeDescriptor(repo);for(const b of descriptor.builds)save(root,'output/mobile-native-baselines/parent-1.0.23/'+b.artifact.file,'wrong binary');assert.throws(()=>assertNativeBinaries(root,descriptor),/Native binary differs/)})
test('native icon byte drift rejects the target',t=>{const {root,d}=nativeFixture(t);save(root,'apps/parent-mobile/assets/icon.png','changed native icon');assert.throws(()=>assertNativeRequirements(root,d),/Native input changed/)})
function reviewedFixture(t){
 const root=makeTemp(t),role='parent',target='tracked',config={version:'1.0.22',runtimeVersion:{policy:'appVersion'},updates:{url:'https://u.expo.dev/7e0906f3-64f4-42d9-b45d-0ee68f599baa'},extra:{appRole:role,eas:{projectId:'7e0906f3-64f4-42d9-b45d-0ee68f599baa'}}}
 save(root,'.gitignore','output/\nnode_modules/\n');save(root,'apps/parent-mobile/package.json',{version:'1.0.22'});save(root,'apps/parent-mobile/app.config.js','tracked config');save(root,'apps/parent-mobile/metro.config.js','module.exports={watchFolders:[]}');mkdirSync(resolve(root,'node_modules'));mkdirSync(resolve(root,'apps/parent-mobile/node_modules'))
 const git=args=>execFileSync('git',['-c',`safe.directory=${root}`,...args],{cwd:root,encoding:'utf8'}).trim();git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);const commit=git(['rev-parse','HEAD']),files=sourceFiles(root,commit),paths=targetPaths(root,role,target,commit)
 mkdirSync(paths.projectRoot,{recursive:true});for(const f of files){mkdirSync(dirname(resolve(paths.projectRoot,f.path)),{recursive:true});cpSync(resolve(root,f.path),resolve(paths.projectRoot,f.path))}
 const generated=generatedSource(root,role,target,config);for(const [path,bytes]of Object.entries(generated))writeFileSync(resolve(paths.projectRoot,path),bytes)
 for(const [from,to]of [[resolve(root,'node_modules'),resolve(paths.projectRoot,'node_modules')],[resolve(root,'apps/parent-mobile/node_modules'),resolve(paths.appRoot,'node_modules')]])symlinkSync(from,to,process.platform==='win32'?'junction':'dir')
 const artifacts=['ios','android','web'].map(p=>{const bundle=`_expo/static/js/${p}/index.${p==='web'?'js':'hbc'}`,sourceMap=bundle+'.map';save(paths.exportRoot,bundle,'reviewed '+p);save(paths.exportRoot,sourceMap,{version:3,file:bundle.split('/').at(-1),sources:['/node_modules/react/index.js'],names:[],mappings:''});return {platform:p,bundle,sourceMap,bundleSha256:sha256(readFileSync(resolve(paths.exportRoot,bundle))),sourceMapSha256:sha256(readFileSync(resolve(paths.exportRoot,sourceMap)))}})
 save(paths.exportRoot,'assets/image.bin','reviewed image');save(paths.exportRoot,'metadata.json',{fileMetadata:Object.fromEntries(['ios','android'].map(p=>[p,{bundle:artifacts.find(a=>a.platform===p).bundle,assets:[{path:'assets/image.bin'}]}]))})
 const manifest={schemaVersion:1,role,targetId:target,sourceCommit:commit,sourceFiles:files,sourceInputsSha256:sourceHash(files),generatedSourceFiles:Object.fromEntries(Object.entries(generated).map(([p,b])=>[p,sha256(b)])),descriptorSha256:null,channel:'production',environment:'production',projectId:config.extra.eas.projectId,privateConfigSha256:configHash(config),codeSigningCertificatePresent:false,codeSigningMetadataPresent:false,appVersion:config.version,runtimeVersion:config.version,runtimePolicy:'appVersion',resolvedRuntimeVersions:{ios:config.version,android:config.version},metadataSha256:sha256(readFileSync(resolve(paths.exportRoot,'metadata.json'))),artifacts,payloads:payloadFiles(paths.exportRoot)}
 save(paths.manifestPath,'',manifest)
 const args={root,role,target,commit,manifestSha256:sha256(readFileSync(paths.manifestPath)),sourceConfig:config}
 return {root,config,paths,manifest,args}
}
test('exact complete source/config/runtime/payload provenance validates',t=>{const f=reviewedFixture(t);assert.equal(verifyReviewedExport(f.args).artifacts.length,3)})
test('changed private config/signing, appVersion, project or manifest anchor rejects',t=>{
 const f=reviewedFixture(t);for(const changed of [{...f.config,version:'1.0.23'},{...f.config,updates:{...f.config.updates,codeSigningCertificate:'certificate'}},{...f.config,extra:{...f.config.extra,eas:{projectId:'wrong'}}},{...f.config,extra:{...f.config.extra,unreviewed:'value'}}])assert.throws(()=>verifyReviewedExport({...f.args,sourceConfig:changed}))
 assert.throws(()=>verifyReviewedExport({...f.args,manifestSha256:'0'.repeat(64)}),/manifest hash/)
})
test('tracked source and staged source drift cannot publish reviewed bytes',t=>{const f=reviewedFixture(t);save(f.paths.projectRoot,'apps/parent-mobile/metro.config.js','changed');assert.throws(()=>verifyReviewedExport(f.args),/Prepared source changed/);save(f.root,'apps/parent-mobile/app.config.js','changed tracked');assert.throws(()=>verifyReviewedExport(f.args),/clean/)})
test('even re-anchored tampered manifests cannot change role/target/source/project/channel/runtime bindings',t=>{
 const f=reviewedFixture(t)
 for(const [key,value] of [['role','coach'],['targetId','parent-1.0.23'],['sourceCommit','0'.repeat(40)],['projectId','wrong'],['channel','preview'],['environment','preview'],['runtimePolicy','explicit'],['appVersion','1.0.23'],['runtimeVersion','1.0.23']]){const changed={...f.manifest,[key]:value};save(f.paths.manifestPath,'',changed);assert.throws(()=>verifyReviewedExport({...f.args,manifestSha256:sha256(readFileSync(f.paths.manifestPath))}))}
})
test('generated config overrides remain exact even when a changed manifest is re-anchored',t=>{const f=reviewedFixture(t),changed={...f.manifest,generatedSourceFiles:{...f.manifest.generatedSourceFiles,'apps/parent-mobile/package.json':'0'.repeat(64)}};save(f.paths.manifestPath,'',changed);assert.throws(()=>verifyReviewedExport({...f.args,manifestSha256:sha256(readFileSync(f.paths.manifestPath))}),/exact permitted/)})
function publishFixture(t){const exportRoot=payload(t),calls=[],paths={exportRoot,appRoot:resolve(exportRoot,'frozen-project')},context={commit:'a'.repeat(40),manifestSha256:'b'.repeat(64),platform:'all',message:'Reviewed release',environment:{MOBILE_OTA_UPDATE_CONFIRMED:'true',MOBILE_OTA_UPDATE_MESSAGE:'Reviewed release',MOBILE_OTA_REVIEWED_MANIFEST_SHA256:'b'.repeat(64)}},effects={assertMain:fetch=>calls.push(fetch?'main-fetch':'main-recheck'),authenticate:()=>calls.push('auth'),verify:()=>{calls.push('verify');return {paths}},runtime:async()=>calls.push('runtime'),releaseCheck:()=>calls.push('release-gate'),publisher:args=>{calls.push('publisher-digest');return {command:'mock-node',args:['mock-eas',...args]}},execute:(command,args,options)=>calls.push({command,args,options})};return {context,effects,calls,paths}}
test('mocked publication retains gates and uploads exactly the reviewed payload directory',async t=>{const f=publishFixture(t);await publishReviewedBytes(f.context,f.effects);assert.deepEqual(f.calls.slice(0,-1),['main-fetch','auth','verify','runtime','release-gate','publisher-digest','main-recheck','verify']);const invocation=f.calls.at(-1);assert.equal(invocation.args[invocation.args.indexOf('--input-dir')+1],f.paths.exportRoot);assert.ok(invocation.args.includes('--skip-bundler'));assert.ok(!invocation.args.includes('--private-key-path'));assert.equal(invocation.options.cwd,f.paths.appRoot);assert.equal(invocation.options.shell,false)})
test('missing confirmation, wrong reviewed hash and unsafe arguments stop before effects',async t=>{
 for(const change of [{environment:{}},{manifestSha256:'c'.repeat(64)},{platform:'--branch evil'},{message:'release; dangerous'},{message:'release\nextra'}]){const f=publishFixture(t);await assert.rejects(()=>publishReviewedBytes({...f.context,...change},f.effects));assert.deepEqual(f.calls,[])}
})
test('asset or config drift after release gate/publisher digest prevents mocked upload',async t=>{const f=publishFixture(t);let verified=0;f.effects.verify=()=>{f.calls.push('verify');if(++verified===2)throw Error('Payload asset/config drift');return {paths:f.paths}};await assert.rejects(()=>publishReviewedBytes(f.context,f.effects),/drift/);assert.ok(!f.calls.some(x=>typeof x==='object'))})
test('real asset/private-config tampering during mocked gates is caught by the final verifier',async t=>{
 for(const kind of ['asset-after-release','asset-after-publisher','private-config']){
  const f=reviewedFixture(t),uploaded=[]
  const context={commit:f.args.commit,manifestSha256:f.args.manifestSha256,platform:'all',message:'Reviewed release',environment:{MOBILE_OTA_UPDATE_CONFIRMED:'true',MOBILE_OTA_UPDATE_MESSAGE:'Reviewed release',MOBILE_OTA_REVIEWED_MANIFEST_SHA256:f.args.manifestSha256}}
  const tamper=()=>{if(kind==='private-config')f.config.extra.changed='unreviewed';else save(f.paths.exportRoot,'assets/image.bin','tampered asset')}
  const effects={assertMain(){},authenticate(){},verify:()=>verifyReviewedExport(f.args),runtime:async()=>{},releaseCheck(){if(kind!=='asset-after-publisher')tamper()},publisher:args=>{if(kind==='asset-after-publisher')tamper();return {command:'mock',args}},execute:()=>uploaded.push(true)}
  await assert.rejects(()=>publishReviewedBytes(context,effects));assert.deepEqual(uploaded,[])
 }
})
test('failed main/auth/runtime/release/publisher gates never reach mocked upload',async t=>{for(const name of ['assertMain','authenticate','runtime','releaseCheck','publisher']){const f=publishFixture(t);f.effects[name]=()=>{throw Error('failed '+name)};await assert.rejects(()=>publishReviewedBytes(f.context,f.effects));assert.ok(!f.calls.some(x=>typeof x==='object'))}})
test('config hashing ignores internal filesystem locations but binds all actual private settings',()=>{const exp={version:'1.0.23',updates:{url:'expected'}};assert.equal(configHash(exp),configHash({...exp,_internal:{path:'machine'}}));assert.notEqual(configHash(exp),configHash({...exp,updates:{url:'changed'}}));assert.equal(canonical({b:undefined,a:1}),' {"a":1}'.trim())})

test('Windows metadata asset separators bind the same complete payload bytes',t=>{const f=reviewedFixture(t),metadataPath=resolve(f.paths.exportRoot,'metadata.json'),metadata=JSON.parse(readFileSync(metadataPath));for(const p of ['ios','android'])metadata.fileMetadata[p].assets[0].path='assets\\image.bin';save(f.paths.exportRoot,'metadata.json',metadata);assertPayloads(f.paths.exportRoot,payloadFiles(f.paths.exportRoot));save(f.paths.exportRoot,'assets/image.bin','changed');assert.throws(()=>assertPayloads(f.paths.exportRoot,f.manifest.payloads),/Payload/);metadata.fileMetadata.ios.assets[0].path='..\\outside.bin';save(f.paths.exportRoot,'metadata.json',metadata);assert.throws(()=>assertPayloads(f.paths.exportRoot,payloadFiles(f.paths.exportRoot)),/asset missing/)})
