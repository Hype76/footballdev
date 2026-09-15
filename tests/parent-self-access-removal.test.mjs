import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildParentProfileAfterAccessRemoval, canRemoveOwnParentAccess, pruneRemovedParentOfflineScopes, validateParentAccessRemovalResult } from '../apps/mobile-core/src/parentAccessRemovalCore.js'
import { createParentOfflineDocument, setParentOfflineProfile, sanitizeParentOfflineProfile, createParentSyncCoordinator } from '../apps/mobile-core/src/parentOfflineCore.js'

const first={id:'link-one',playerId:'player-one',playerName:'First player',clubId:'club-one',teamId:'team-one',linkType:'parent'}
const duplicate={...first,id:'link-duplicate',linkType:'family'}
const other={id:'link-two',playerId:'player-two',playerName:'Second player',clubId:'club-two',teamId:'team-two',linkType:'parent'}
const fan={...first,id:'fan-one',linkType:'fan'}
const adult={...first,id:'adult-one',linkType:'player'}
const profile={id:'account',email:'parent@example.test',selectedParentLinkId:first.id,parentPortalLinks:[first,duplicate,other,fan,adult],hasParentAccess:true}

test('removal prunes all parent/family grants for one player, preserves fan/player and other club access',()=>{
 const result=buildParentProfileAfterAccessRemoval(profile,first.playerId)
 assert.deepEqual(result.removedLinkIds,[first.id,duplicate.id])
 assert.deepEqual(result.profile.parentPortalLinks,[other,fan,adult])
 assert.equal(result.profile.selectedParentLinkId,other.id)
 assert.equal(result.profile.selectedPlayerId,other.playerId)
 assert.equal(result.profile.clubId,other.clubId)
 assert.equal(result.profile.email,profile.email)
 assert.equal(profile.parentPortalLinks.length,5)
 assert.equal(canRemoveOwnParentAccess(fan),false);assert.equal(canRemoveOwnParentAccess(adult),false)
 assert.throws(()=>buildParentProfileAfterAccessRemoval({...profile,parentPortalLinks:[fan,adult]},first.playerId),/Choose a player/)
})
test('last parent removal retains Fan-only account or reaches a safe empty profile',()=>{
 const fans=buildParentProfileAfterAccessRemoval({...profile,parentPortalLinks:[first,fan]},first.playerId).profile
 assert.deepEqual(fans.parentPortalLinks,[fan]);assert.equal(fans.selectedParentLinkId,fan.id)
 const empty=buildParentProfileAfterAccessRemoval({...profile,parentPortalLinks:[first]},first.playerId).profile
 assert.equal(empty.id,profile.id);assert.equal(empty.parentPortalLinks.length,0)
 assert.equal(empty.selectedParentLinkId,'');assert.equal(empty.selectedPlayerId,'');assert.equal(empty.hasParentAccess,false)
 assert.equal(sanitizeParentOfflineProfile(fans).parentPortalLinks.length,0)
})
test('zero revoked grants is idempotent success but malformed or different-player results are rejected',()=>{
 assert.equal(validateParentAccessRemovalResult({player_id:first.playerId,revoked_count:0},first.playerId).revoked_count,0)
 for(const value of [null,{player_id:'other',revoked_count:1},{player_id:first.playerId,revoked_count:-1},{player_id:first.playerId,revoked_count:'1'}])assert.throws(()=>validateParentAccessRemovalResult(value,first.playerId),/could not be confirmed/)
})
test('encrypted profile replacement and pruning remove only revoked scopes and queued payloads',()=>{
 const {profile:next,removedLinkIds}=buildParentProfileAfterAccessRemoval(profile,first.playerId)
 let doc=createParentOfflineDocument({profile,userScope:profile.id,selectedLinkId:first.id})
 doc.resources={[first.id]:{secret:'first'},[other.id]:{secret:'second'}}
 doc.journal=[{childScope:first.id,status:'pending',payload:{private:'first'}},{childScope:duplicate.id,status:'succeeded',payload:{private:'duplicate'}},{childScope:other.id,status:'pending',payload:{private:'other'}}]
 doc=pruneRemovedParentOfflineScopes(setParentOfflineProfile(doc,sanitizeParentOfflineProfile(next)),removedLinkIds)
 assert.deepEqual(Object.keys(doc.resources),[other.id])
 assert.deepEqual(doc.journal,[{childScope:other.id,status:'pending',payload:{private:'other'}}])
 assert.equal(doc.selectedLinkId,other.id)
 assert.ok(!JSON.stringify(doc).includes('link-one'))
})
test('a queued request finishing after scope removal cannot restore its deleted journal entry',async()=>{
 let finish,started
 const began=new Promise(resolve=>started=resolve)
 let doc=createParentOfflineDocument({profile,userScope:profile.id,selectedLinkId:first.id})
 doc.journal=[{commandId:'pending-one',childScope:first.id,status:'pending',localSequence:1,attemptCount:0,type:'message_read'}]
 const sync=createParentSyncCoordinator({readDocument:async()=>doc,updateDocument:async(scope,update)=>(doc=update(doc)),execute:async()=>{started();await new Promise(resolve=>finish=resolve)}})
 const pending=sync.sync({userScope:profile.id})
 await began
 doc=pruneRemovedParentOfflineScopes(setParentOfflineProfile(doc,sanitizeParentOfflineProfile(buildParentProfileAfterAccessRemoval(profile,first.playerId).profile)),[first.id])
 finish();await pending
 assert.deepEqual(doc.journal,[])
})

function makeAuthHarness(source,{cached=profile,fetchProfile,persist,clear=async()=>{}}={}){
 const load=source.slice(source.indexOf('  const loadProfile = useCallback('),source.indexOf('\n  useEffect(',source.indexOf('  const loadProfile = useCallback(')))
 const replace=source.slice(source.indexOf('  const replaceCurrentUserProfile = useCallback('),source.indexOf('\n  const value =',source.indexOf('  const replaceCurrentUserProfile = useCallback(')))
 const state={user:profile,generation:{current:0},cacheClears:0,writes:[]}
 const hooks={useCallback:fn=>fn,profileGenerationRef:state.generation,currentUserRef:{current:profile},sessionUserIdRef:{current:profile.id},appRole:'parent',offlineProfileStore:{read:async()=>cached,write:async value=>{state.writes.push(value);await persist?.(value);return value},clear},setUser:value=>state.user=value,setIsProfileLoading:()=>{},setAuthError:()=>{},withStartupTimeout:fn=>fn(),DEFAULT_MOBILE_STARTUP_TIMEOUT_MS:1000,getMobileStartupDiagnosticPrefix:()=> 'PARENT',fetchMobileProfile:fetchProfile,isAuthoritativeProfileFailure:()=>false,mobileResourceCache:{clear:()=>state.cacheClears++}}
 const api=new Function(...Object.keys(hooks),load+'\n'+replace+'\nreturn {loadProfile,replaceCurrentUserProfile}')( ...Object.values(hooks))
 return {...api,state}
}
test('actual AuthProvider replacement invalidates pending reads before they can restore old access',async()=>{
 const source=await readFile('apps/mobile-core/src/auth.js','utf8')
 let finish,started
 const began=new Promise(resolve=>started=resolve)
 const harness=makeAuthHarness(source,{fetchProfile:async()=>{started();return new Promise(resolve=>finish=resolve)}})
 await harness.loadProfile({user:{id:profile.id}})
 await began
 const next=buildParentProfileAfterAccessRemoval(profile,first.playerId).profile
 await harness.replaceCurrentUserProfile(next)
 finish(profile)
 await new Promise(resolve=>setTimeout(resolve,0))
 assert.deepEqual(harness.state.user.parentPortalLinks,next.parentPortalLinks)
 assert.deepEqual(harness.state.writes,[next]);assert.equal(harness.state.cacheClears,1)
 await assert.rejects(()=>harness.replaceCurrentUserProfile({...next,id:'different-account'}),/signed-in account changed/)
})
test('actual profile replacement clears stale offline storage if persistence fails',async()=>{
 const source=await readFile('apps/mobile-core/src/auth.js','utf8')
 let cleared=0
 const harness=makeAuthHarness(source,{persist:async()=>{throw new Error('disk failed')},clear:async()=>cleared++})
 const next=buildParentProfileAfterAccessRemoval({...profile,parentPortalLinks:[first]},first.playerId).profile
 await assert.rejects(()=>harness.replaceCurrentUserProfile(next),/disk failed/)
 assert.equal(cleared,1)
 assert.equal(harness.state.user.parentPortalLinks.length,0)
})
test('actual mobile RPC call rejects Fan/player access and wrong acknowledgement, accepts idempotent success',async()=>{
 const source=await readFile('apps/parent-mobile/src/parentPortalData.js','utf8')
 const fn=source.slice(source.indexOf('export async function revokeOwnParentPlayerAccess'),source.indexOf('\nfunction normalizeText')).replace('export ','')
 let result={data:{player_id:first.playerId,revoked_count:0},error:null}
 const calls=[]
 const revoke=new Function('supabase','canRemoveOwnParentAccess','validateParentAccessRemovalResult',fn+';return revokeOwnParentPlayerAccess')({rpc:async(...args)=>{calls.push(args);return result}},canRemoveOwnParentAccess,validateParentAccessRemovalResult)
 await revoke(profile,first)
 assert.deepEqual(calls,[['revoke_own_parent_player_access',{target_player_id:first.playerId}]])
 await assert.rejects(()=>revoke(profile,fan),/choose a player/)
 await assert.rejects(()=>revoke(profile,adult),/choose a player/)
 await assert.rejects(()=>revoke({...profile,isOfflineProfile:true},first),/Connect/)
 result={data:{player_id:'other',revoked_count:1},error:null};await assert.rejects(()=>revoke(profile,first),/could not be confirmed/)
})

test('unmounted Parent screen ignores a late RPC success before clearing account or local state',async()=>{
 const source=await readFile('apps/parent-mobile/App.js','utf8')
 const handler=source.slice(source.indexOf('  async function handleRemoveOwnPlayerAccess('),source.indexOf('\n  async function handleOpenMessage(',source.indexOf('  async function handleRemoveOwnPlayerAccess(')))
 let finish,cleared=0,replaced=0
 const currentAccountRef={current:profile.id}
 const dependencies={removalInFlightRef:{current:false},activeActionId:'',isOffline:false,isSyncing:false,user:profile,selectedLink:first,selectedMobileUser:profile,buildParentProfileAfterAccessRemoval,currentAccountRef,revokeOwnParentPlayerAccess:()=>new Promise(resolve=>finish=resolve),replaceCurrentUserProfile:async()=>replaced++,parentOfflineProfileStore:{clear:async()=>cleared++}}
 const handle=new Function(...Object.keys(dependencies),handler+';return handleRemoveOwnPlayerAccess')(...Object.values(dependencies))
 const pending=handle(first)
 currentAccountRef.current=null
 finish({player_id:first.playerId,revoked_count:1})
 await pending
 assert.equal(replaced,0);assert.equal(cleared,0)
 assert.match(source,/currentAccountRef\.current = null/)
})

test('actual removal handler builds replacement from full canonical grants, preserving same-player Fan and Player grants',async()=>{
 const source=await readFile('apps/parent-mobile/App.js','utf8')
 const handler=source.slice(source.indexOf('  async function handleRemoveOwnPlayerAccess('),source.indexOf('\n  async function handleOpenMessage(',source.indexOf('  async function handleRemoveOwnPlayerAccess(')))
 let replaced,pruned
 const canonical={...profile,parentPortalLinks:[first,duplicate,fan,adult]}
 const dependencies={removalInFlightRef:{current:false},activeActionId:'',isOffline:false,isSyncing:false,user:canonical,selectedLink:first,selectedMobileUser:{...profile,parentPortalLinks:[first]},buildParentProfileAfterAccessRemoval,currentAccountRef:{current:profile.id},revokeOwnParentPlayerAccess:async()=>({player_id:first.playerId,revoked_count:2}),replaceCurrentUserProfile:async value=>replaced=value,parentOfflineProfileStore:{clear:async()=>{throw Error('Should not clear unrelated cache')}},removeParentOfflineAccessScopes:async(u,ids)=>pruned=ids,requestIdRef:{current:0},parentSyncScopeRef:{current:'scope'},hydratedScopeRef:{current:'scope'},resourceNames:['matches'],setResources:()=>{},setChatMessages:()=>{},setMatchDayPlayers:()=>{},setSelectedResourcePreview:()=>{},AsyncStorage:{multiRemove:async()=>{}},onAccessRemoved:()=>{},refreshUserProfile:async()=>{}}
 const handle=new Function(...Object.keys(dependencies),handler+';return handleRemoveOwnPlayerAccess')(...Object.values(dependencies))
 await handle(first)
 assert.deepEqual(replaced.parentPortalLinks,[fan,adult]);assert.deepEqual(pruned,[first.id,duplicate.id])
 assert.equal(replaced.selectedParentLinkId,fan.id)
})
