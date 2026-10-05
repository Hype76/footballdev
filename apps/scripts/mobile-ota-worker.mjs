import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {existsSync,mkdirSync,readFileSync,writeFileSync,cpSync,symlinkSync,readdirSync,statSync} from 'node:fs'
import {dirname,resolve,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {publishReviewedBytes} from './mobile-ota-publish.mjs'
import {assertEasLogin} from './mobile-eas-auth.mjs'
import {publisherInvocation,verifyPublisherInstallation} from './mobile-eas-publisher.mjs'
import {inventory,sha256} from './mobile-security-inventory.mjs'
import {sourceFiles,sourceHash,targetPaths,git,selectTarget,configValue,configHash,generatedSource,payloadFiles,verifyReviewedExport,reviewedUpdateArgs} from './mobile-ota-provenance.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const [mode,role,target,commit,expectedManifestSha,platform,message]=process.argv.slice(2)
assert.ok(['prepare','verify','publish'].includes(mode),'Unknown operation')
assert.equal(process.argv.slice(2).length,mode==='prepare'?4:mode==='verify'?5:7,'Unexpected worker arguments')
const paths=targetPaths(root,role,target,commit),sourceApp=resolve(root,'apps',role+'-mobile')
assert.equal(process.env.EXPO_PUBLIC_BUILD_PROFILE,'store-live','Production profile required')
execFileSync(process.execPath,[resolve(root,'apps/scripts/mobile-resolved-environment-check.mjs'),role,'store-live'],{stdio:'inherit'})
verifyPublisherInstallation(resolve(root,'apps/mobile-publisher'))
function privateConfig(project){return configValue(createRequire(resolve(project,'package.json'))('expo/config').getConfig(project,{isPublicConfig:false}).exp)}
async function runtimeCheck(project,runtime){
 const require=createRequire(resolve(project,'package.json')),resolveRuntime=require('expo-updates/utils/build/resolveRuntimeVersionAsync.js').resolveRuntimeVersionAsync,result={}
 for(const p of ['ios','android']){result[p]=(await resolveRuntime(project,p,{}, {workflowOverride:'managed'})).runtimeVersion;assert.equal(result[p],runtime,'SDK runtime mismatch')}
 return result
}
if(mode==='prepare'){
 const files=sourceFiles(root,commit),selected=selectTarget(root,role,target,privateConfig(sourceApp))
 assert.ok(!existsSync(paths.base),'Use a new exact source commit; preparation never reuses stale output')
 mkdirSync(paths.projectRoot,{recursive:true})
 for(const file of files){const dest=resolve(paths.projectRoot,file.path);mkdirSync(dirname(dest),{recursive:true});cpSync(resolve(root,file.path),dest)}
 const generated=generatedSource(root,role,target,selected.config)
 for(const [path,bytes] of Object.entries(generated))writeFileSync(resolve(paths.projectRoot,path),bytes)
 for(const [from,to] of [[resolve(root,'node_modules'),resolve(paths.projectRoot,'node_modules')],[resolve(sourceApp,'node_modules'),resolve(paths.appRoot,'node_modules')]])symlinkSync(from,to,process.platform==='win32'?'junction':'dir')
 assert.equal(configHash(privateConfig(paths.appRoot)),configHash(selected.config),'Frozen target config differs')
 const resolvedRuntimeVersions=await runtimeCheck(paths.appRoot,selected.runtimeVersion)
 const command={executable:process.execPath,args:[resolve(sourceApp,'node_modules/expo/bin/cli'),'export','--platform','all','--source-maps','--max-workers','2','--output-dir',paths.exportRoot,'--clear']}
 execFileSync(command.executable,command.args,{cwd:paths.appRoot,env:{...process.env,CI:'1',EXPO_NO_TELEMETRY:'1'},stdio:'inherit'})
 assert.equal(sourceHash(sourceFiles(root,commit)),sourceHash(files),'Source changed during preparation')
 const metadataBytes=readFileSync(resolve(paths.exportRoot,'metadata.json')),metadata=JSON.parse(metadataBytes)
 function walk(dir){return readdirSync(dir).flatMap(name=>{const path=resolve(dir,name);return statSync(path).isDirectory()?walk(path):[path]})}
 const web=walk(resolve(paths.exportRoot,'_expo/static/js/web')).filter(path=>path.endsWith('.js'));assert.equal(web.length,1)
 const artifacts=['ios','android','web'].map(p=>{const bundle=p==='web'?relative(paths.exportRoot,web[0]).replaceAll('\\','/'):metadata.fileMetadata[p].bundle,sourceMap=bundle+'.map';return {platform:p,bundle,sourceMap,bundleSha256:sha256(readFileSync(resolve(paths.exportRoot,bundle))),sourceMapSha256:sha256(readFileSync(resolve(paths.exportRoot,sourceMap)))}})
 const manifest={schemaVersion:1,role,targetId:target,sourceCommit:commit,sourceFiles:files,sourceInputsSha256:sourceHash(files),generatedSourceFiles:Object.fromEntries(Object.entries(generated).map(([path,bytes])=>[path,sha256(bytes)])),descriptorSha256:selected.descriptorSha256,channel:'production',environment:'production',projectId:selected.projectId,privateConfigSha256:configHash(selected.config),codeSigningCertificatePresent:false,codeSigningMetadataPresent:false,appVersion:selected.config.version,runtimeVersion:selected.runtimeVersion,runtimePolicy:'appVersion',resolvedRuntimeVersions,metadataSha256:sha256(metadataBytes),command,payloads:payloadFiles(paths.exportRoot),artifacts,scope:'Reviewed payload/source/configuration provenance only; no executed publication, advisory acceptance, OS trust or device acceptance'}
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');writeFileSync(paths.manifestPath,bytes)
 const manifestSha256=sha256(bytes),checked=verifyReviewedExport({root,role,target,commit,manifestSha256,sourceConfig:privateConfig(sourceApp)})
 writeFileSync(paths.inventoryPath,JSON.stringify({manifestSha256,artifacts:checked.artifacts},null,2)+'\n')
 console.log(JSON.stringify({role,target,commit,runtimeVersion:manifest.runtimeVersion,manifestSha256,payloadFiles:manifest.payloads.length,totalPayloadBytes:manifest.payloads.reduce((n,p)=>n+p.bytes,0),artifacts:checked.artifacts.map(a=>({platform:a.platform,moduleCount:a.moduleCount,roots:a.roots}))},null,2))
}else{
 function verify(){
  const checked=verifyReviewedExport({root,role,target,commit,manifestSha256:expectedManifestSha,sourceConfig:privateConfig(sourceApp)})
  assert.equal(configHash(privateConfig(paths.appRoot)),checked.manifest.privateConfigSha256,'Prepared private config changed')
  return checked
 }
 if(mode==='publish'){
  await publishReviewedBytes({commit,manifestSha256:expectedManifestSha,platform,message,environment:process.env},{
   assertMain(fetch){if(fetch)git(root,['fetch','origin','--prune']);assert.equal(git(root,['rev-parse','origin/main']),commit,'Publication requires exact origin/main');sourceFiles(root,commit)},
   authenticate:assertEasLogin,
   verify,
   runtime:checked=>runtimeCheck(paths.appRoot,checked.manifest.runtimeVersion),
   releaseCheck(){execFileSync('npm',['run','mobile:release-check'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'})},
   publisher:publisherInvocation,
   execute:execFileSync,
  })
 }else{
  const checked=verify();await runtimeCheck(paths.appRoot,checked.manifest.runtimeVersion)
  console.log(JSON.stringify({verified:true,sourceCommit:commit,targetId:target,runtimeVersion:checked.manifest.runtimeVersion,payloadFiles:checked.manifest.payloads.length,manifestSha256:expectedManifestSha}))
 }
}
