import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFanScope, loadFanInviteForOwner } from '../netlify/functions/lib/_fan-access.js'
import { sendFanMatchNotifications } from '../netlify/functions/lib/_fan-push.js'
process.env.VITE_SUPABASE_URL = 'https://synthetic.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key'
const { handleFans } = await import('../netlify/functions/fans.js')
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture() {
  const tables = {
    fan_connections: [{ id:id(1),auth_user_id:id(2),invited_by:id(3),parent_link_id:id(4),player_id:id(5),club_id:id(6),relationship_type:'fan',status:'active',permissions:{schedule:true,game_day:false,development:false,resources:false},notifications_enabled:true }],
    parent_player_links: [{id:id(4),auth_user_id:id(3),player_id:id(5),club_id:id(6),team_id:id(7),link_type:'parent',status:'active'}],
    players: [{id:id(5),club_id:id(6),team_id:id(7),status:'active'}],clubs:[{id:id(6),status:'active'}],users:[],
    match_days:[],match_day_availability_requests:[],calendar_event_invites:[],match_day_player_squad_decisions:[],calendar_events:[],training_availability_request_players:[],event_player_occurrence_exclusions:[],fan_notifications:[],fan_devices:[],
  }
  const read = []
  const client = { auth:{getUser:async()=>({data:{user:{id:id(2)}}})}, from(table) {
    read.push(table)
    let predicates = []
    let single = false
    let operation = ''
    let values
    const query = {
      select(){return query},eq(k,v){predicates.push(r=>r[k]===v);return query},neq(k,v){predicates.push(r=>r[k]!==v);return query},
      is(k,v){predicates.push(r=>(r[k]??null)===v);return query},in(k,v){predicates.push(r=>v.includes(r[k]));return query},gte(k,v){predicates.push(r=>r[k]>=v);return query},
      contains(k,v){predicates.push(r=>Object.entries(v).every(([key,value])=>r[k]?.[key]===value));return query},order(){return query},limit(){return query},
      maybeSingle(){single=true;return query},single(){single=true;return query},
      upsert(v){operation='upsert';values=v;return query},update(v){operation='update';values=v;return query},delete(){operation='delete';return query},
      then(resolve,reject){try {
        let result = (tables[table] || []).filter(r=>predicates.every(p=>p(r)))
        if(operation==='upsert') { const record={id:id(90),...values};tables[table].push(record);result=[record] }
        if(operation==='update') result.forEach(r=>Object.assign(r,values))
        if(operation==='delete') tables[table]=tables[table].filter(r=>!result.includes(r))
        return Promise.resolve({data:single ? result[0] || null : result,error:null}).then(resolve,reject)
      } catch(e){return Promise.reject(e).then(resolve,reject)} },
    }
    return query
  } }
  return { tables, client, read }
}
test('Server binds Fan identity, exact permissions and active parent ancestry before any child data read',async()=>{
  const {client,tables,read}=fixture()
  await loadFanScope(client,id(2),id(1),'schedule')
  await assert.rejects(loadFanScope(client,id(8),id(1),'schedule'),/no longer/)
  for(const permission of ['game_day','development','resources']) await assert.rejects(loadFanScope(client,id(2),id(1),permission),/no longer/)
  tables.parent_player_links[0].auth_user_id=id(8)
  await assert.rejects(loadFanScope(client,id(2),id(1),'schedule'),/no longer/)
  assert.equal(read.includes('assessment_records'),false)
})
test('Schedule-only endpoint denies every other view and exposes no scoring or attendance actions',async()=>{
  const {client,read}=fixture()
  const call=action=>handleFans({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action,connectionId:id(1)})},{createClient:()=>client})
  assert.equal((await call('schedule')).statusCode,200)
  for(const action of ['matches','development','resources','open_resource','notifications']) assert.equal((await call(action)).statusCode,403)
  for(const action of ['respond','score','chat','invite']) assert.equal((await call(action)).statusCode,400)
  assert.equal(read.includes('resource_library_items'),false)
})
test('Archived children and suspended inviting parents cannot send existing invitations',async()=>{
  const {client,tables}=fixture()
  Object.assign(tables.fan_connections[0],{status:'pending',expires_at:new Date(Date.now()+100000).toISOString()})
  tables.players[0].archived_at=new Date().toISOString()
  await assert.rejects(loadFanInviteForOwner(client,id(3),id(1)),/no longer/)
  tables.players[0].archived_at=null
  tables.users.push({id:id(3),status:'suspended',role:'parent_portal'})
  await assert.rejects(loadFanInviteForOwner(client,id(3),id(1)),/no longer/)
})
test('Game Day notifications stop after permission loss, opt-out or Fan self removal',async()=>{
  const {client,tables}=fixture()
  let sends=0
  const call=()=>sendFanMatchNotifications({client,match:{id:id(9),club_id:id(6)},type:'goal',targetParentLinkIds:[id(4)],sendPush:async()=>{sends++;return {sent:1,failed:0}}})
  await call()
  tables.fan_connections[0].permissions.game_day=true
  tables.fan_connections[0].notifications_enabled=false
  await call()
  tables.fan_connections[0].notifications_enabled=true
  tables.fan_connections[0].status='removed'
  await call()
  assert.equal(sends,0)
  assert.equal(tables.fan_notifications.length,0)
})
