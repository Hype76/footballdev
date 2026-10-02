import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {assertEasLogin} from './mobile-eas-auth.mjs'
import {publisherInvocation} from './mobile-eas-publisher.mjs'
import {sourceFiles,targetPaths} from './mobile-ota-provenance.mjs'
import {loadMobileLocalEnv} from './mobile-local-env.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const [role,target='tracked',commit]=process.argv.slice(2)
targetPaths(root,role,target,commit);sourceFiles(root,commit)
assert.equal(process.argv.slice(2).length,3,'Expected app role, allowlisted target and exact source commit')
assertEasLogin()
const command=`node ../scripts/mobile-ota-worker.mjs prepare ${role} ${target} ${commit}`
const publisher=publisherInvocation(['env:exec','production',command,'--non-interactive'])
execFileSync(publisher.command,publisher.args,{cwd:resolve(root,'apps',role+'-mobile'),env:{...process.env,...loadMobileLocalEnv(root,'apps/'+role+'-mobile'),EXPO_PUBLIC_BUILD_PROFILE:'store-live'},stdio:'inherit',shell:false})
