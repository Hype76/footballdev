import assert from 'node:assert/strict'
import test from 'node:test'
import { openCoachResource } from '../apps/mobile-core/src/coachResourceOpenCore.js'

function fixture() {
 let saved=false,signed=0,opened=0
 const input={user:{},context:{id:'team'},resource:{type:'file'},openSaved:async()=>saved,
   getAccessUrl:async()=>{signed++;return 'https://example.test/signed'},linking:{canOpenURL:async()=>true,openURL:async()=>{opened++}}}
 return {input,setSaved:value=>{saved=value},counts:()=>({signed,opened})}
}
test('saved Resource opens first even offline and never needs a signed URL',async()=>{
 const f=fixture();f.setSaved(true);f.input.user.isOfflineProfile=true
 assert.equal(await openCoachResource(f.input),true);assert.deepEqual(f.counts(),{signed:0,opened:0})
})
test('missing saved files explain offline limitation and try an online URL when available',async()=>{
 const f=fixture();f.input.user.isOfflineProfile=true
 await assert.rejects(openCoachResource(f.input),/not saved on this phone/)
 f.input.user.isOfflineProfile=false;assert.equal(await openCoachResource(f.input),true)
 assert.deepEqual(f.counts(),{signed:1,opened:1})
})
test('authority and integrity failures never fall back to the network',async()=>{
 const f=fixture();f.input.openSaved=async()=>{throw Error('offline_media_corrupt')}
 await assert.rejects(openCoachResource(f.input),/could not be verified/);assert.deepEqual(f.counts(),{signed:0,opened:0})
})
test('external links remain online only and scope changes prevent opening',async()=>{
 const f=fixture();f.input.resource.type='external_link';f.input.user.isOfflineProfile=true
 await assert.rejects(openCoachResource(f.input),/needs an internet connection/)
 f.input.user.isOfflineProfile=false;f.input.isCurrent=()=>false
 assert.equal(await openCoachResource(f.input),false);assert.deepEqual(f.counts(),{signed:1,opened:0})
})
