import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as core from '../apps/mobile-core/src/coachPhase31ECore.js'
const require = createRequire(import.meta.url)
const {parse} = require('@babel/parser')
const dataSource = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js',import.meta.url),'utf8')
const screenSource = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js',import.meta.url),'utf8')
const dataAst = parse(dataSource,{sourceType:'module',plugins:['jsx']})
const screenAst = parse(screenSource,{sourceType:'module',plugins:['jsx']})
function nodes(value, output=[]) {
  if (!value || typeof value !== 'object') return output
  if (value.type) output.push(value)
  for (const [key,child] of Object.entries(value)) if (!['loc','start','end'].includes(key)) {
    if (Array.isArray(child)) child.forEach(item=>nodes(item,output)); else if (child && typeof child === 'object') nodes(child,output)
  }
  return output
}
function dataFunction(name,deps) {
  const node=nodes(dataAst).find(node=>node.type==='FunctionDeclaration' && node.id?.name===name)
  return new Function(...Object.keys(deps),`${dataSource.slice(node.start,node.end)}; return ${name}`)(...Object.values(deps))
}
const invite = {kind:'match',eventId:'synthetic-fixture',playerId:'synthetic-player',teamId:'team',status:'available',participationRemoved:true}
test('only an actual participation withdrawal opens answered Match Day preview',()=>{
  for (const reason of ['event_participation_removed','parent_link_revoked','recipient_authority_removed','']) {
    const row=core.normalizeCoachInvite({id:'request',match_day_id:'fixture',player_id:'player',status:'pending',availability_status:'available',token_revoked_at:'2099-08-31',token_revoked_reason:reason},'match')
    assert.equal(row.status,'available')
    assert.equal(core.canResendSelectedCoachInvites([row]),reason==='event_participation_removed')
  }
  for (const patch of [{kind:'training'},{stale:true},{cancelled:true},{participationRemoved:false}]) assert.equal(core.canResendSelectedCoachInvites([{...invite,...patch}]),false)
  assert.equal(core.canResendSelectedCoachInvites([invite,{...invite,participationRemoved:false}]),false)
})
test('collapsing multiple guardians retains withdrawal eligibility and selected answer',()=>{
  const active={...invite,id:'active',participationRemoved:false,deliveryStatus:'sent'}
  const withdrawn={...invite,id:'withdrawn',deliveryStatus:'pending'}
  for (const rows of [[active,withdrawn],[withdrawn,active]]) {
    const collapsed=core.collapseCoachInvitesByPlayer(rows)
    assert.equal(collapsed.length,1);assert.equal(collapsed[0].status,'available');assert.equal(collapsed[0].participationRemoved,true)
  }
})
function dataHarness() {
  const calls=[],user={id:'coach',activeTeamId:'team'},deps={
    assertCanonicalMutation:(user,{minimumRank})=>{if (user.denied || user.rank < minimumRank) throw Error('Denied role')},
    assertTeamEntity:(user,invite)=>{if (user.activeTeamId!==invite.teamId) throw Error('Denied team')},
    normalize:value=>String(value??'').trim(),config:{isProduction:true,apiBaseUrl:'https://synthetic.invalid'},
    getAccessToken:async()=> 'synthetic-token',joinApiPath:(base,path)=>`${base}/${path}`,requestId:()=> 'synthetic-key',
    fetchJsonWithTimeout:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,response:{status:200},result:{success:true,recipientCount:2,renewalRequired:true,expectedRenewalRequests:[{requestId:'request',expectedTokenVersion:1,parentLinkId:'link'}]}}},
  }
  user.rank=50
  return {calls,user,deps,preview:dataFunction('previewCoachInviteResend',deps),record:dataFunction('recordCoachInviteIntent',deps)}
}
test('Coach preview is read-only; commit passes same key and exact preview snapshot',async()=>{
  const {calls,user,preview,record}=dataHarness()
  const plan=await preview(user,invite,{idempotencyKey:'stable-key'})
  assert.equal(calls[0].body.preview,true)
  await record(user,invite,'resend',{idempotencyKey:'stable-key',...plan})
  assert.equal(calls[1].body.preview,false);assert.equal(calls[1].body.idempotencyKey,'stable-key')
  assert.equal(calls[1].body.renewalOnly,true);assert.deepEqual(calls[1].body.expectedRenewalRequests,plan.expectedRenewalRequests)
})
test('Coach role, team, stale-target and no-key gates reject before network',async()=>{
  for (const alter of [h=>{h.user.rank=20},h=>{h.user.activeTeamId='other'},h=>{h.user.denied=true}]) {
    const h=dataHarness();alter(h);await assert.rejects(h.preview(h.user,invite,{idempotencyKey:'key'}));assert.equal(h.calls.length,0)
  }
  const h=dataHarness();await assert.rejects(h.preview(h.user,{...invite,stale:true},{idempotencyKey:'key'}));await assert.rejects(h.preview(h.user,invite,{}));assert.equal(h.calls.length,0)
})
function screenHarness() {
  const state={alerts:[],commits:[],previews:[],pending:null,notices:[],keyCount:0}
  const context='synthetic-context'
  const deps={bulkAction:'',stale:false,pendingResend:null,resendContext:context,currentResendContext:{current:context},resendAttempt:{current:null},
    config:{isProduction:true},setBulkAction:()=>{},setPendingResend:value=>{state.pending=value},setSelectedPlayerIds:()=>{},
    setNotice:value=>state.notices.push(value),getCoachFriendlyError:error=>error.message,
    refreshAfterBulkAction:async()=>{},user:{id:'coach'},createCoachFollowUpKey:()=>`key-${++state.keyCount}`,
    Alert:{alert:(title,body,buttons)=>state.alerts.push({title,body,buttons})},
    previewCoachInviteResend:async(user,invite,options)=>{state.previews.push(options);return state.completed?{alreadyCompleted:true}:{recipientCount:1,recipients:[{address:'g***@example.invalid'}],renewalRequired:true,expectedRenewalRequests:[{requestId:'request',expectedTokenVersion:1}]}},
    recordCoachInviteIntent:async(user,invite,action,options)=>{state.commits.push(options);if(state.fail) throw Error('Synthetic lost response');return {recipientCount:1}},
  }
  const wanted=['recordSelectedResends','resendInvites']
  const decls=nodes(screenAst).filter(node=>node.type==='VariableDeclarator' && wanted.includes(node.id?.name))
  const functions=new Function(...Object.keys(deps),decls.map(node=>`const ${screenSource.slice(node.start,node.end)};`).join('\n')+'return {recordSelectedResends,resendInvites}')(...Object.values(deps))
  return {state,deps,...functions}
}
test('actual screen handlers preview masked count, await confirmation and keep same key after unknown outcome',async()=>{
  const h=screenHarness();await h.resendInvites([invite])
  assert.equal(h.state.commits.length,0);assert.equal(h.state.previews.length,1)
  assert.match(h.state.alerts[0].body,/Queue 1 emails to g\*\*\*@example.invalid/)
  h.state.fail=true
  await h.recordSelectedResends(h.state.pending.units,'synthetic-context')
  assert.ok(h.state.pending);const key=h.state.pending.units[0].key
  await h.resendInvites([invite],h.state.pending.units)
  assert.equal(h.state.previews.at(-1).idempotencyKey,key)
  h.state.completed=true
  await h.resendInvites([invite],h.state.pending.units)
  assert.equal(h.state.pending,null);assert.equal(h.state.commits.length,1)
  assert.match(h.state.notices.at(-1),/No additional invitations/)
})
test('open confirmation cannot commit after active account/team changes',async()=>{
  const h=screenHarness();await h.resendInvites([invite]);const units=h.state.pending.units
  h.deps.currentResendContext.current='different-context'
  await h.recordSelectedResends(units,'synthetic-context')
  assert.equal(h.state.commits.length,0)
})
