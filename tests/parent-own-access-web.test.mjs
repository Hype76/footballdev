import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { normalizeFanProfileLink } from '../src/lib/fans.js'
const source = (await readFile('src/lib/domain/parent-portal.js', 'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '').replace(/export /g, '')
function api(supabase) {
  return new Function('supabase', 'normalizePersonName', 'normalizeFanProfileLink', 'normalizeLegacyThemeButtonStyle', source + '; return {getParentPortalLinks,revokeOwnParentPlayerAccess,getOwnParentPortalFanLinks}')(
    supabase, value => value, normalizeFanProfileLink, value => value,
  )
}
test('Parent web lists owned active grants even when staff RLS permits other links', async () => {
  const steps = []
  const query = new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve) => resolve({ data: [{id:'own',auth_user_id:'auth',player_id:'child',players:{player_name:'Child'}}] })
    return (...args) => { steps.push([key,...args]); return query }
  } })
  const result = await api({ auth: {getUser:async()=>({data:{user:{id:'auth'}}})}, from:()=>query }).getParentPortalLinks()
  assert.equal(result[0].id,'own')
  assert.ok(steps.some(step=>step[0]==='eq'&&step[1]==='auth_user_id'&&step[2]==='auth'))
  assert.ok(steps.some(step=>step[0]==='eq'&&step[1]==='status'&&step[2]==='active'))
  await assert.rejects(()=>api({auth:{getUser:async()=>({error:Error('Signed out')})}}).getParentPortalLinks(),/Signed out/)
})
test('self-removal passes only the chosen player to authoritative RPC and verifies its result', async () => {
  const calls=[]
  const client=api({rpc:async(name,args)=>{calls.push({name,args});return {data:{player_id:'child',revoked_count:2}}}})
  assert.deepEqual(await client.revokeOwnParentPlayerAccess({playerId:'child'}),{playerId:'child',revokedCount:2})
  assert.deepEqual(calls,[{name:'revoke_own_parent_player_access',args:{target_player_id:'child'}}])
  for(const reply of [{error:Error('Denied')},{data:{player_id:'other',revoked_count:1}},{data:{player_id:'child',revoked_count:-1}}]) await assert.rejects(()=>api({rpc:async()=>reply}).revokeOwnParentPlayerAccess({playerId:'child'}))
  await assert.rejects(()=>client.revokeOwnParentPlayerAccess({playerId:''}),/Choose/)
})
test('post-removal Fan refresh retains canonical valid grants and rejects failed lookups', async () => {
  const result=await api({rpc:async()=>({data:[{id:'valid',status:'active',relationship_type:'fan'},{id:'revoked',status:'revoked',relationship_type:'fan'},{id:'owner',status:'active',relationship_type:'fan',is_owner:true}]})}).getOwnParentPortalFanLinks()
  assert.deepEqual(result.map(link=>link.id),['valid'])
  await assert.rejects(()=>api({rpc:async()=>({data:null})}).getOwnParentPortalFanLinks(),/refreshed/)
})


test('scoped AuthContext access update invalidates older profile loads and rejects account changes', async () => {
  const auth = await readFile('src/lib/auth.js','utf8')
  const operation = auth.slice(auth.indexOf('  const updateCurrentUserDetails ='), auth.indexOf('\n  const value = {',auth.indexOf('  const updateCurrentUserDetails =')))
  const userRef={current:{id:'auth',parentPortalLinks:[{id:'removed'},{id:'kept'}]}}, activeSyncIdRef={current:7}
  let current=userRef.current, loading=true
  const update = new Function('userRef','activeSyncIdRef','setUser','setIsProfileLoading',operation+';return updateCurrentUserDetails')(userRef,activeSyncIdRef,fn=>{current=fn(current)},value=>{loading=value})
  const inFlightSyncId=activeSyncIdRef.current
  assert.equal(update({parentPortalLinks:[{id:'kept'}]},{invalidateProfileSync:true,expectedAuthUserId:'auth'}),true)
  assert.notEqual(activeSyncIdRef.current,inFlightSyncId)
  assert.deepEqual(current.parentPortalLinks,[{id:'kept'}]);assert.equal(loading,false)
  userRef.current={id:'other',parentPortalLinks:[{id:'other-player'}]};current=userRef.current
  assert.equal(update({parentPortalLinks:[]},{invalidateProfileSync:true,expectedAuthUserId:'auth'}),false)
  assert.deepEqual(current.parentPortalLinks,[{id:'other-player'}])
  userRef.current=null;current=null
  assert.equal(update({parentPortalLinks:[]},{invalidateProfileSync:true,expectedAuthUserId:'auth'}),false)
  assert.equal(current,null)
})
test('late self-removal completion cannot change an unmounted or different account', async () => {
  const page = await readFile('src/pages/ParentPortalPage.jsx','utf8')
  const operation = page.slice(page.indexOf('  const handleRemoveOwnAccess ='),page.indexOf('  const handleAddGoal ='))
  for(const nextOwner of ['', 'other-auth']){
    let finish;const calls=[],accessOwnerRef={current:'auth'},removingAccessRef={current:false}
    const deps={accessOwnerRef,removingAccessRef,removeAccessTarget:{playerId:'child',playerName:'Child'},setIsRemovingAccess:()=>{},setRemoveAccessError:()=>{},revokeOwnParentPlayerAccess:()=>new Promise(resolve=>{finish=resolve}),getOwnParentPortalFanLinks:async()=>[],accessLinksRef:{current:[]},selectedLink:null,user:{role:'parent_portal'},updateCurrentUserDetails:()=>calls.push('profile'),setSearchParams:()=>calls.push('navigation'),showToast:()=>calls.push('toast'),onAccessRemoved:()=>calls.push('remount')}
    const remove=new Function(...Object.keys(deps),operation+';return handleRemoveOwnAccess')(...Object.values(deps))
    const pending=remove();accessOwnerRef.current=nextOwner;finish({playerId:'child',revokedCount:1});await pending
    assert.deepEqual(calls,[])
  }
})
