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
    let columns
    let maxRows = Infinity
    let ordering
    const query = {
      select(value){columns=value;return query},eq(k,v){predicates.push(r=>r[k]===v);return query},neq(k,v){predicates.push(r=>r[k]!==v);return query},
      is(k,v){predicates.push(r=>(r[k]??null)===v);return query},in(k,v){predicates.push(r=>v.includes(r[k]));return query},gte(k,v){predicates.push(r=>r[k]>=v);return query},
      contains(k,v){predicates.push(r=>Object.entries(v).every(([key,value])=>r[k]?.[key]===value));return query},order(key, options){ordering={key,...options};return query},limit(count){maxRows=count;return query},
      maybeSingle(){single=true;return query},single(){single=true;return query},
      upsert(v){operation='upsert';values=v;return query},update(v){operation='update';values=v;return query},delete(){operation='delete';return query},
      then(resolve,reject){try {
        let result = (tables[table] || []).filter(r=>predicates.every(p=>p(r)))
        if(operation==='upsert') { const record={id:id(90),...values};tables[table].push(record);result=[record] }
        if(operation==='update') result.forEach(r=>Object.assign(r,values))
        if(operation==='delete') tables[table]=tables[table].filter(r=>!result.includes(r))
        if(ordering)result.sort((a,b)=>String(a[ordering.key]??'').localeCompare(String(b[ordering.key]??''))*(ordering.ascending===false?-1:1))
        result=result.slice(0,maxRows)
        if(table==='match_days' && columns && columns!=='*') result=result.map(row=>Object.fromEntries(columns.split(',').map(key=>key.trim()).map(key=>[key,row[key]])))
        return Promise.resolve({data:single ? result[0] || null : result,error:null}).then(resolve,reject)
      } catch(e){return Promise.reject(e).then(resolve,reject)} },
    }
    return query
  } }
  return { tables, client, read }
}
test('Player accounts read only their current attendance and cannot submit invitations', async () => {
  const {client,tables}=fixture()
  const call = action => handleFans({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({action,connectionId:id(1)})},{createClient:()=>client})
  assert.equal((await call('attendance')).statusCode,403)
  tables.fan_connections[0].relationship_type='player'
  tables.match_days.push({id:id(9),club_id:id(6),team_id:id(7),parent_visible:true,parent_audience:'all_team_parents',match_date:new Date().toISOString().slice(0,10),opponent:'FP TEST Visitors'})
  tables.match_day_player_availability=[{match_day_id:id(9),club_id:id(6),player_id:id(5),status:'available'},{match_day_id:id(9),club_id:id(6),player_id:id(99),status:'unavailable'}]
  const result=await call('attendance')
  assert.equal(result.statusCode,200)
  assert.equal(JSON.parse(result.body).attendance[0].response,'available')
  for(const action of ['accept','decline','respond','attendance_response']) assert.equal((await call(action)).statusCode,400)
  tables.parent_player_links[0].status='revoked'
  assert.equal((await call('attendance')).statusCode,403)
})

test('Server binds Fan identity, exact permissions and active parent ancestry before any child data read',async()=>{
  const {client,tables,read}=fixture()
  await loadFanScope(client,id(2),id(1),'schedule')
  await assert.rejects(loadFanScope(client,id(8),id(1),'schedule'),/no longer/)
  for(const permission of ['game_day','development','resources']) await assert.rejects(loadFanScope(client,id(2),id(1),permission),/no longer/)
  tables.parent_player_links[0].auth_user_id=id(8)
  await assert.rejects(loadFanScope(client,id(2),id(1),'schedule'),/no longer/)
  assert.equal(read.includes('assessment_records'),false)
})

test('Fan match details retain the selected kit and return artwork only for the authorised club', async () => {
  const {client,tables,read}=fixture()
  tables.fan_connections[0].permissions.game_day=true
  tables.match_days.push({id:id(9),club_id:id(6),team_id:id(7),parent_visible:true,parent_audience:'all_team_parents',match_date:new Date().toISOString().slice(0,10),status:'live',shirt_choice:'away'})
  tables.club_kits=[
    {club_id:id(6),kit_type:'home',colour:'#112233',image_path:`${id(6)}/home/custom.png`},
    {club_id:id(6),kit_type:'away',colour:'#445566',image_path:`${id(6)}/away/custom.png`},
    {club_id:id(8),kit_type:'away',colour:'#ffffff',image_path:`${id(8)}/away/private.png`},
  ]
  const call=(extra={})=>handleFans({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action:'matches',connectionId:id(1),matchId:id(9),clubId:id(8),...extra})},{createClient:()=>client})
  for(const choice of ['home','away','tbc']) {
    tables.match_days[0].shirt_choice=choice
    const response=await call()
    assert.equal(response.statusCode,200)
    const data=JSON.parse(response.body)
    assert.equal(data.matches[0].shirt_choice,choice)
    assert.deepEqual(data.clubKits,{home:{colour:'#112233',imagePath:`${id(6)}/home/custom.png`},away:{colour:'#445566',imagePath:`${id(6)}/away/custom.png`}})
    assert.equal(response.body.includes('private.png'),false)
  }
  tables.club_kits=[]
  assert.deepEqual(JSON.parse((await call()).body).clubKits,{})
  read.length=0
  assert.equal((await call({matchId:id(10)})).statusCode,403)
  assert.equal(read.includes('club_kits'),false)
  for(const change of [()=>{tables.fan_connections[0].permissions.game_day=false},()=>{tables.fan_connections[0].permissions.game_day=true;tables.fan_connections[0].status='revoked'}]) {
    change();read.length=0
    assert.equal((await call()).statusCode,403)
    assert.equal(read.includes('club_kits'),false)
  }
})
test('Schedule-only endpoint denies every other view and exposes no scoring or attendance actions',async()=>{
  const {client,read}=fixture()
  const call=action=>handleFans({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action,connectionId:id(1)})},{createClient:()=>client})
  assert.equal((await call('schedule')).statusCode,200)
  for(const action of ['matches','development','resources','open_resource','notifications']) assert.equal((await call(action)).statusCode,403)
  for(const action of ['respond','score','chat','invite']) assert.equal((await call(action)).statusCode,400)
  assert.equal(read.includes('resource_library_items'),false)
})

test('Game Day alone exposes shared matches without querying Schedule, then obeys current revocation and scope', async () => {
  const { client, tables, read } = fixture()
  tables.fan_connections[0].permissions = { schedule: false, game_day: true, development: false, resources: false }
  tables.clubs[0].name = 'FP TEST Club'
  tables.match_days.push({ id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: new Date().toISOString().slice(0, 10), status: 'live', home_away: 'away', opponent: 'Visitors' })
  const call = action => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action, connectionId: id(1), permissions: { schedule: true, game_day: true }, clubName: 'Forged club' }) }, { createClient: () => client })
  const response = await call('matches')
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(response.body).matches[0].club_name, 'FP TEST Club')
  assert.equal((await call('notifications')).statusCode, 200)
  for (const action of ['schedule', 'attendance', 'development', 'resources', 'open_resource']) assert.equal((await call(action)).statusCode, 403)
  for (const table of ['calendar_events', 'training_availability_request_players', 'training_availability_requests', 'assessment_sessions', 'event_player_occurrence_exclusions']) assert.equal(read.includes(table), false, `Game Day must not read ${table}`)
  const changes = [
    () => { tables.fan_connections[0].permissions.game_day = false },
    () => { tables.fan_connections[0].permissions.game_day = true; tables.fan_connections[0].status = 'removed' },
    () => { tables.fan_connections[0].status = 'active'; tables.parent_player_links[0].status = 'revoked' },
    () => { tables.parent_player_links[0].status = 'active'; tables.players[0].team_id = id(8) },
  ]
  for (const change of changes) {
    change(); read.length = 0
    assert.equal((await call('matches')).statusCode, 403)
    assert.equal(read.includes('match_days'), false, 'Stale client permissions cannot authorise a new match read')
  }
})

test('Fan calendar fixture titles use the authorised club name and home team first', async () => {
  const { client, tables } = fixture()
  tables.clubs[0].name = 'FP TEST Club'
  tables.match_days.push({ id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), opponent: 'Visitors', home_away: 'home' })
  const call = () => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'schedule', connectionId: id(1) }) }, { createClient: () => client })
  assert.equal(JSON.parse((await call()).body).schedule[0].title, 'FP TEST Club v Visitors')
  tables.match_days[0].home_away = 'away'
  assert.equal(JSON.parse((await call()).body).schedule[0].title, 'Visitors v FP TEST Club')
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
test('Visible Game Day delivers once with a scoped link; unsharing hides its saved notification',async()=>{
  const {client,tables}=fixture()
  tables.fan_connections[0].permissions.game_day=true
  const match={id:id(9),club_id:id(6),team_id:id(7),parent_visible:true,parent_audience:'all_team_parents',match_date:new Date().toISOString().slice(0,10),updated_at:new Date().toISOString(),status:'live',opponent:'Private match name'}
  tables.match_days.push(match)
  tables.fan_devices.push({token:'ExpoPushToken[synthetic]',auth_user_id:id(2)})
  const delivered=[]
  const send=()=>sendFanMatchNotifications({client,match,type:'goal',eventId:id(11),targetParentLinkIds:[id(4)],sendPush:async(messages)=>{delivered.push(...messages);return {sent:messages.length,failed:0}}})
  assert.equal((await send()).fanSent,1)
  assert.equal((await send()).fanSent,0)
  assert.equal(delivered.length,1)
  assert.equal(delivered[0].data.fanConnectionId,id(1))
  assert.equal(JSON.stringify(delivered).includes('Private match name'),false)
  match.parent_visible=false
  const response=await handleFans({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action:'notifications',connectionId:id(1)})},{createClient:()=>client})
  assert.deepEqual(JSON.parse(response.body).notifications,[])
})

test('renewed Fan email uses a new idempotency key and retries do not send again', async () => {
  const {client,tables}=fixture()
  client.auth.getUser=async()=>({data:{user:{id:id(3)}}})
  Object.assign(tables.fan_connections[0],{status:'pending',email:'fan@example.test',name:'FP TEST Fan',invite_token:id(10),expires_at:new Date(Date.now()+86400000).toISOString(),email_sent_at:new Date().toISOString()})
  const sent=[]
  const send=()=>handleFans({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action:'send_invitation',connectionId:id(1)})},{createClient:()=>client,deliverEmail:async(_message,options)=>sent.push(options.idempotencyKey)})
  assert.equal((await send()).statusCode,200)
  assert.equal(sent.length,0)
  Object.assign(tables.fan_connections[0],{invite_token:id(11),renewal_request_id:id(12),email_sent_at:null})
  assert.equal((await send()).statusCode,200)
  assert.deepEqual(sent,[`fan-invitation-${id(1)}-${id(12)}`])
  assert.equal((await send()).statusCode,200)
  assert.equal(sent.length,1)
})

test('Game Day never reveals unstarted fixtures, while Schedule is separately authorised', async () => {
  const { client, tables, read } = fixture()
  tables.fan_connections[0].permissions = { schedule: false, game_day: true }
  const match = { club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: '2099-09-15' }
  tables.match_days.push(...['scheduled', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'postponed', 'cancelled'].map((status, index) => ({ ...match, id: id(20 + index), status, opponent: status + ' opponent' })))
  tables.fan_notifications.push({ id: id(50), connection_id: id(1), match_id: id(20), title: 'Unstarted fixture notification' }, { id: id(51), connection_id: id(1), match_id: id(21), title: 'Live match notification' })
  const call = (action, extra = {}) => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action, connectionId: id(1), ...extra }) }, { createClient: () => client })
  assert.deepEqual(JSON.parse((await call('matches')).body).matches.map(item => item.status), ['live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time'])
  read.length = 0
  assert.equal((await call('matches', { matchId: id(20), permissions: { schedule: true } })).statusCode, 403)
  assert.equal(read.includes('match_day_events'), false)
  assert.equal(read.includes('club_kits'), false)
  assert.deepEqual(JSON.parse((await call('notifications')).body).notifications.map(item => item.id), [id(51)])
  assert.equal((await call('schedule')).statusCode, 403)
  tables.fan_connections[0].permissions.schedule = true
  assert.ok(JSON.parse((await call('schedule')).body).schedule.some(item => item.id === id(20)))
  assert.equal(JSON.parse((await call('matches')).body).matches.some(item => item.id === id(20)), false)
})

test('Device status is scoped to the signed-in account and errors never imply registration', async () => {
  const { client, tables } = fixture()
  const token = 'ExpoPushToken[device-test]'
  const call = extra => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'device_status', token, ...extra }) }, { createClient: () => client })
  assert.deepEqual(JSON.parse((await call()).body), { registered: false })
  tables.fan_devices.push({ token, auth_user_id: id(8) })
  assert.deepEqual(JSON.parse((await call({ auth_user_id: id(8) })).body), { registered: false })
  tables.fan_devices[0].auth_user_id = id(2)
  assert.deepEqual(JSON.parse((await call()).body), { registered: true })
  assert.equal((await call({ token: 'invalid' })).statusCode, 400)
})


test('Future fixture volume cannot displace live matches before the Game Day result limit', async () => {
  const { client, tables } = fixture()
  tables.fan_connections[0].permissions = { schedule: false, game_day: true }
  const match = { club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents' }
  tables.match_days.push(...Array.from({length: 110}, (_, index) => ({ ...match, id: id(100 + index), status: 'scheduled', match_date: '2099-12-31' })))
  tables.match_days.push({ ...match, id: id(400), status: 'live', match_date: new Date().toISOString().slice(0,10) })
  const response = await handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'matches', connectionId: id(1) }) }, { createClient: () => client })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body).matches.map(item => item.id), [id(400)])
})
