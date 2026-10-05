import assert from 'node:assert/strict'
import {reviewedUpdateArgs} from './mobile-ota-provenance.mjs'

// Dependencies are supplied by the production worker. Tests replace effects, never run EAS update.
export async function publishReviewedBytes(context,effects) {
 const {commit,manifestSha256,platform,message,environment}=context
 assert.match(commit,/^[a-f0-9]{40}$/);assert.match(manifestSha256,/^[a-f0-9]{64}$/)
 assert.equal(String(environment.MOBILE_OTA_UPDATE_CONFIRMED||'').trim().toLowerCase(),'true','Explicit update confirmation required')
 assert.equal(String(environment.MOBILE_OTA_UPDATE_MESSAGE||'').trim(),message,'Confirmed update message mismatch')
 assert.equal(String(environment.MOBILE_OTA_REVIEWED_MANIFEST_SHA256||'').trim().toLowerCase(),manifestSha256,'Confirmed reviewed manifest mismatch')
 assert.ok(['ios','android','all'].includes(platform),'Unsupported publication platform')
 assert.match(message,/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/,'Unsafe publication message')
 effects.assertMain(true)
 effects.authenticate()
 let reviewed=effects.verify()
 await effects.runtime(reviewed)
 const args=reviewedUpdateArgs(reviewed.paths,{platform,message})
 effects.releaseCheck()
 const publisher=effects.publisher(args)
 effects.assertMain(false)
 // This complete byte/config/source verification follows both gates and installed publisher hashing.
 reviewed=effects.verify()
 assert.deepEqual(reviewedUpdateArgs(reviewed.paths,{platform,message}),args,'Publication binding changed')
 effects.execute(publisher.command,publisher.args,{cwd:reviewed.paths.appRoot,env:environment,stdio:'inherit',shell:false})
}
