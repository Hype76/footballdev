import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@babel/parser'
import { readAllPages } from '../apps/mobile-core/src/coachAvailabilityData.js'
import { normalizeCoachChatRoom, normalizeCoachPoll } from '../apps/mobile-core/src/coachPhase31ECore.js'
import { buildCoachChatSummary } from '../apps/mobile-core/src/coachPhase31GCore.js'

const source=readFileSync('apps/mobile-core/src/coachPhase31EData.js','utf8')
const operational=readFileSync('apps/mobile-core/src/coachOperationalData.js','utf8')
function extract(text,names) {
  const nodes=parse(text,{sourceType:'module'}).program.body.map(node=>node.declaration || node)
  return names.map(name=>{const node=nodes.find(node=>node.id?.name===name);assert.ok(node,name);return text.slice(node.start,node.end)}).join('\n')
}
const body=extract(operational,['assertCoachOperationalRead'])+'\n'+extract(source,['rpc','canOpenStaffRoomInContext','canOpenStaffRoom','getCoachStaffChatRooms','getCoachParentChatRooms','getCoachParentChatUnread','getCoachChatRooms','getCoachHomeChatSummary','getCoachPolls','getCoachHomePollSummary'])
const user={id:'coach',clubId:'club',activeTeamId:'team',role:'coach',roleRank:30,workspaceScope:'team'}
const normalize=value=>String(value ?? '').trim()
function split(value) {
  let depth=0,start=0;const parts=[]
  for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===',' && depth===0){parts.push(value.slice(start,i));start=i+1}}
  return [...parts,value.slice(start)]
}
function matches(row,filter) {
  if(filter.startsWith('and('))return split(filter.slice(4,-1)).every(value=>matches(row,value))
  if(filter.startsWith('or('))return split(filter.slice(3,-1)).some(value=>matches(row,value))
  const [,field,operator,value]=filter.match(/^([a-z_]+)\.(eq|is|gt)\.(.*)$/) || []
  assert.ok(field,filter)
  return operator==='is' ? value==='null' && row[field]==null : operator==='gt' ? row[field]!=null && row[field]>value : row[field]===value
}
function harness({staff=[],rooms=[],parents=[],polls=[],error=null,metadataError=null,parentWait}={}) {
  const calls=[]
  const supabase={
    async rpc(name,args){
      calls.push({rpc:name,args})
      if (name.startsWith('get_coach_parent_chat_') && parentWait) await parentWait
      return {data:name==='get_staff_chat_unread_summary'?staff:parents,error}
    },
    from(table){const call={table,filters:[]};calls.push(call);return {
      select(fields){call.fields=fields;return this},eq(field,value){call.filters.push(row=>row[field]===value);return this},
      in(field,values){call.filters.push(row=>values.includes(row[field]));return this},
      or(filter){call.or=filter;call.filters.push(row=>split(filter).some(value=>matches(row,value)));return this},
      order(){return this},range(start,end){call.range=[start,end];return this},
      then(resolve,reject){let rows=(table==='polls'?polls:rooms).filter(row=>call.filters.every(filter=>filter(row)))
        if(call.range)rows=rows.slice(call.range[0],call.range[1]+1)
        if(call.fields!=='*,staff_chat_members(*)' && call.fields!=='*,teams:team_id(name),poll_votes(*)')rows=rows.map(row=>Object.fromEntries(call.fields.split(',').map(field=>[field,row[field]])))
        return Promise.resolve({data:rows,error:metadataError || error}).then(resolve,reject)},
    }},
  }
  const dependencies={supabase,normalize,normalizeCoachChatRoom,normalizeCoachPoll,readAllPages}
  const functions=new Function(...Object.keys(dependencies),body+';return {getCoachChatRooms,getCoachHomeChatSummary,getCoachPolls,getCoachHomePollSummary}')(...Object.values(dependencies))
  return {calls,...functions}
}

test('Home Chat equals full-screen authorized rooms/counts while excluding revoked/private memberships and tighter role scopes',async()=>{
  const rooms=[
    ['team','team_staff','team'],['player','player_staff','team'],['other-team','team_staff','other'],
    ['club','club_staff',null],['private','group',null],['direct','direct',null],['removed','group',null],['archived','group',null],['nonmember','group',null],
  ].map(([id,type,team_id])=>({id,type,team_id,club_id:'club',title:'Private title',staff_chat_members:[{user_id:'coach'}]}))
  // Canonical RPC omits removed, archived and nonmember rooms before either loader reads metadata.
  const staff=rooms.filter(room=>!['removed','archived','nonmember'].includes(room.id)).map((room,index)=>({id:room.id,unread_count:index+1}))
  const parents=[{id:'parent',team_id:'team',unread_count:4,latest_message:'Private text'},{id:'foreign-parent',team_id:'other',unread_count:100}]
  for(const profile of [user,{...user,role:'head_manager',roleRank:80,workspaceScope:'club'},{...user,role:'admin',roleRank:90,workspaceScope:'team'},{...user,role:'admin',roleRank:90,workspaceScope:'club'}]){
    const h=harness({staff,rooms,parents}),full=await h.getCoachChatRooms(profile)
    h.calls.length=0
    const lean=await h.getCoachHomeChatSummary(profile)
    assert.deepEqual(lean.staff.map(row=>row.id).sort(),full.staff.map(row=>row.id).sort())
    assert.deepEqual(lean.parent.map(row=>row.id),full.parent.map(row=>row.id))
    assert.equal(buildCoachChatSummary(lean).unreadChat,buildCoachChatSummary(full).unreadChat)
    assert.deepEqual(h.calls.map(call=>call.rpc || call.table),['get_staff_chat_unread_summary','get_coach_parent_chat_unread','staff_chat_conversations'])
    assert.equal(h.calls[2].fields,'id,type,team_id')
    assert.doesNotMatch(JSON.stringify(lean),/Private text|Private title|members|removed|archived|nonmember|foreign-parent|other-team/)
  }
})

test('empty and denied Home Chat preserve canonical errors without a metadata read or fallback',async()=>{
  const empty=harness();assert.deepEqual(await empty.getCoachHomeChatSummary(user),{staff:[],parent:[]});assert.equal(empty.calls.length,2)
  for(const error of [{code:'42501',message:'Membership removed'}, {status:403,message:'Plan denied'},new Error('Network unavailable')]){
    const h=harness({error});await assert.rejects(h.getCoachHomeChatSummary(user),value=>value===error);assert.equal(h.calls.length,2)
  }
  for(const profile of [{...user,roleRank:10},{...user,role:'super_admin'},{...user,activeTeamId:''}]){
    const h=harness();await assert.rejects(h.getCoachHomeChatSummary(profile));assert.equal(h.calls.length,0)
  }
  const stale=harness({staff:[{id:'revoked-between-reads',unread_count:8}]})
  assert.deepEqual(await stale.getCoachHomeChatSummary(user),{staff:[],parent:[]},'A current metadata/RLS read removing the room also removes its count')
  const denied={code:'42501',message:'Revoked between reads'}
  await assert.rejects(harness({staff:[{id:'room',unread_count:8}],metadataError:denied}).getCoachHomeChatSummary(user),value=>value===denied)
})

test('Home Chat starts the staff permission read while Parent rooms are still loading', async () => {
  let releaseParent
  const parentWait = new Promise(resolve => { releaseParent = resolve })
  const h = harness({
    parentWait,
    staff: [{ id: 'staff-room', unread_count: 2 }],
    rooms: [{ id: 'staff-room', club_id: 'club', team_id: 'team', type: 'team_staff' }],
  })
  const summary = h.getCoachHomeChatSummary(user)
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(h.calls.some(call => call.table === 'staff_chat_conversations'))
  } finally {
    releaseParent()
  }
  assert.deepEqual((await summary).staff.map(room => room.id), ['staff-room'])
})

test('Staff Chat is available before the active Parent list finishes, without requesting closed rooms', async () => {
  let releaseParent
  const parentWait = new Promise(resolve => { releaseParent = resolve })
  const h = harness({
    parentWait,
    staff: [{ id: 'staff-room', unread_count: 2 }],
    rooms: [{ id: 'staff-room', club_id: 'club', team_id: 'team', type: 'team_staff', staff_chat_members: [{ user_id: 'coach' }] }],
    parents: [{ id: 'active-room', status: 'active', team_id: 'team' }, { id: 'closed-room', status: 'closed', team_id: 'team' }],
  })
  const early = []
  const result = h.getCoachChatRooms(user, { onStaffRoomsReady: rooms => early.push(...rooms) })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(early.map(room => room.id), ['staff-room'])
    assert.deepEqual(h.calls.find(call => call.rpc === 'get_coach_parent_chat_rooms').args,
      { active_team_id_value: 'team', room_status_value: 'active', target_room_id_value: null })
  } finally {
    releaseParent()
  }
  assert.deepEqual((await result).parent.map(room => room.id), ['active-room'])
})

test('Home Polls count only current readable open polls without historical payloads, nested votes or truncation',async()=>{
  const polls=Array.from({length:505},(_,index)=>({id:String(index),club_id:'club',team_id:index%2?'team':null,status:'open',closes_at:index%2?'2099-01-01T00:00:00.000Z':null,options:['private'],poll_votes:[{voter_email:'private@example.test'}]}))
  polls.push({id:'closed',club_id:'club',team_id:'team',status:'closed'},{id:'expired',club_id:'club',team_id:'team',status:'open',closes_at:'2000-01-01T00:00:00Z'},
    {id:'foreign',club_id:'other',team_id:'team',status:'open'},{id:'other-team',club_id:'club',team_id:'other',status:'open'})
  const h=harness({polls}),lean=await h.getCoachHomePollSummary(user)
  assert.equal(lean.length,505)
  assert.deepEqual(h.calls.map(call=>call.range),[[0,249],[250,499],[500,749]])
  assert.ok(h.calls.every(call=>call.fields==='id,status,closes_at'))
  assert.ok(lean.every(row=>Object.keys(row).join(',')==='id,status,closesAt'))
  assert.doesNotMatch(JSON.stringify(lean),/closed|expired|foreign|other-team|private|options|votes/)
  const full=await h.getCoachPolls(user)
  assert.equal(full.find(row=>row.id==='0').votes.length,1,'Full-screen poll payload remains available')
  const active=full.filter(row=>row.status==='open' && (!row.closesAt || Date.parse(row.closesAt)>Date.now()))
  assert.equal(lean.length,active.length)
})

test('empty, role/plan denied and failed Home Poll reads do not become successful zero counts',async()=>{
  assert.deepEqual(await harness().getCoachHomePollSummary(user),[])
  for(const error of [{code:'42501',message:'Role denied'},{status:403,message:'Plan denied'},new Error('Network unavailable')]){
    await assert.rejects(harness({error}).getCoachHomePollSummary(user),value=>value===error)
  }
  const h=harness();await assert.rejects(h.getCoachHomePollSummary({...user,activeTeamId:''}));assert.equal(h.calls.length,0)
})
