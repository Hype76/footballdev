import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFanScope, loadFanInviteForOwner } from '../netlify/functions/lib/_fan-access.js'
import { sendFanMatchNotifications } from '../netlify/functions/lib/_fan-push.js'
import { sendPlayerResourceNotifications } from '../netlify/functions/lib/_player-resource-notifications.js'
import { canViewFanNotifications, fanNotificationTarget } from '../src/lib/fans.js'
import { MATCHDAY_DEFAULT_FLAGS } from '../src/lib/matchday-policy.js'
import { buildCompletedMatchEventPresentation } from '../src/lib/matchday-final-report.js'
process.env.VITE_SUPABASE_URL = 'https://synthetic.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key'
const { handleFans } = await import('../netlify/functions/fans.js')
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture() {
  const tables = {
    fan_connections: [{ id:id(1),auth_user_id:id(2),invited_by:id(3),parent_link_id:id(4),player_id:id(5),club_id:id(6),relationship_type:'fan',status:'active',permissions:{schedule:true,game_day:false,development:false,resources:false},notifications_enabled:true }],
    parent_player_links: [{id:id(4),auth_user_id:id(3),player_id:id(5),club_id:id(6),team_id:id(7),link_type:'parent',status:'active'}],
    players: [{id:id(5),club_id:id(6),team_id:id(7),status:'active'}],clubs:[{id:id(6),status:'active',plan_key:'club',plan_status:'active'}],users:[],
    match_days:[],match_day_events:[],match_day_availability_requests:[],calendar_event_invites:[],match_day_player_squad_decisions:[],calendar_events:[],training_availability_request_players:[],event_player_occurrence_exclusions:[],fan_notifications:[],fan_devices:[],
  }
  const read = []
  const selections = []
  const client = {
    auth:{getUser:async()=>({data:{user:{id:id(2)}}})},
    rpc: async (name) => name === 'get_matchday_plan_config'
      ? { data: { revision: 1, flags: MATCHDAY_DEFAULT_FLAGS }, error: null }
      : { data: null, error: { message: 'Unknown RPC' } },
    from(table) {
    read.push(table)
    let predicates = []
    let single = false
    let operation = ''
    let values
    let columns
    let maxRows = Infinity
    let ordering
    let upsertOptions
    const query = {
      select(value){columns=value;selections.push({table,columns:value});return query},eq(k,v){predicates.push(r=>r[k]===v);return query},neq(k,v){predicates.push(r=>r[k]!==v);return query},
      is(k,v){predicates.push(r=>(r[k]??null)===v);return query},in(k,v){predicates.push(r=>v.includes(r[k]));return query},gte(k,v){predicates.push(r=>r[k]>=v);return query},
      contains(k,v){predicates.push(r=>Object.entries(v).every(([key,value])=>r[k]?.[key]===value));return query},order(key, options){ordering={key,...options};return query},range(){return query},limit(count){maxRows=count;return query},
      maybeSingle(){single=true;return query},single(){single=true;return query},
      upsert(v,options){operation='upsert';values=v;upsertOptions=options;return query},update(v){operation='update';values=v;return query},delete(){operation='delete';return query},
      then(resolve,reject){try {
        let result = (tables[table] || []).filter(r=>predicates.every(p=>p(r)))
        if(operation==='upsert') {
          const keys=upsertOptions?.onConflict?.split(',')||[]
          const existing=keys.length?tables[table].find(row=>keys.every(key=>row[key]===values[key])):null
          if(existing){if(!upsertOptions.ignoreDuplicates)Object.assign(existing,values);result=upsertOptions.ignoreDuplicates?[]:[existing]}
          else{const record={id:id(90+tables[table].length),...values};tables[table].push(record);result=[record]}
        }
        if(operation==='update') result.forEach(r=>Object.assign(r,values))
        if(operation==='delete') tables[table]=tables[table].filter(r=>!result.includes(r))
        if(ordering)result.sort((a,b)=>String(a[ordering.key]??'').localeCompare(String(b[ordering.key]??''))*(ordering.ascending===false?-1:1))
        result=result.slice(0,maxRows)
        if(['match_days','match_day_events'].includes(table) && columns && columns!=='*') result=result.map(row=>Object.fromEntries(columns.split(',').map(key=>key.trim()).map(key=>[key,row[key]])))
        return Promise.resolve({data:single ? result[0] || null : result,error:null}).then(resolve,reject)
      } catch(e){return Promise.reject(e).then(resolve,reject)} },
    }
    return query
  } }
  return { tables, client, read, selections }
}

function playerResourceFixture() {
  const f = fixture(), date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  f.tables.fan_connections[0].relationship_type = 'player'
  f.tables.fan_connections[0].permissions = { schedule: true, resources: true, development: true, game_day: false }
  const event = { id: id(20), club_id: id(6), team_id: id(7), title: 'FP TEST Training', event_type: 'training',
    starts_at: `${date}T18:00:00Z`, ends_at: `${date}T19:00:00Z`, parent_visible: true,
    parent_audience: 'involved_players', recurrence_frequency: 'weekly', recurrence_until: date }
  const item = { id: id(21), club_id: id(6), team_id: id(7), title: 'FP TEST Training card',
    category: 'training', storage_bucket: 'resource-library', storage_path: `${id(6)}/${id(7)}/${id(21)}/card.pdf` }
  const link = { id: id(22), resource_id: item.id, club_id: id(6), team_id: id(7), linked_type: 'calendar_event',
    linked_id: event.id, calendar_occurrence_date: date, parent_visible: false, removed_at: null, resource_library_items: item }
  f.tables.calendar_events = [event]
  f.tables.calendar_event_invites = [{ calendar_event_id: event.id, player_id: id(5), club_id: id(6), invite_status: 'active' }]
  f.tables.resource_library_links = [link]
  f.tables.resource_library_items = [item]
  f.tables.resource_library_external_links = []
  f.tables.fan_devices = [{ auth_user_id: id(2), token: 'ExponentPushToken[synthetic]' }]
  f.client.storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://synthetic.test/card.pdf' }, error: null }) }) }
  const call = (action, extra = {}) => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' },
    body: JSON.stringify({ action, connectionId: id(1), ...extra }) }, { createClient: () => f.client })
  return { ...f, event, item, link, date, call }
}

test('player training attachment is listed on its exact occurrence, in resources, and opens with private access', async () => {
  const f = playerResourceFixture()
  const schedule = await f.call('schedule')
  assert.equal(schedule.statusCode, 200)
  const data = JSON.parse(schedule.body)
  assert.equal(data.schedule[0].resources[0].id, f.item.id)
  assert.equal(data.schedule[0].resources[0].occurrenceDate, f.date)
  const resources = await f.call('resources')
  assert.equal(resources.statusCode, 200)
  assert.equal(JSON.parse(resources.body).resources[0].id, f.item.id)
  assert.ok(!resources.body.includes('storage_path'))
  assert.ok(!resources.body.includes('/card.pdf'))
  const opened = await f.call('open_resource', { resourceId: f.item.id })
  assert.equal(opened.statusCode, 200)
  assert.equal(JSON.parse(opened.body).accessUrl, 'https://synthetic.test/card.pdf')
})

test('attendance retains its existing query boundary without loading resource attachments', async () => {
  const f = playerResourceFixture()
  const response = await f.call('attendance')
  assert.equal(response.statusCode, 200)
  assert.ok(!f.read.includes('resource_library_links'))
})

for (const deny of ['fan', 'resources', 'schedule', 'development', 'removed', 'other-date', 'other-team', 'archived', 'invitation', 'private-event', 'excluded', 'deleted-occurrence', 'unsafe-path']) {
  test(`player event attachment fails closed for ${deny}`, async () => {
    const f = playerResourceFixture()
    if (deny === 'fan') f.tables.fan_connections[0].relationship_type = 'fan'
    if (['resources', 'schedule', 'development'].includes(deny)) f.tables.fan_connections[0].permissions[deny] = false
    if (deny === 'removed') f.link.removed_at = new Date().toISOString()
    if (deny === 'other-date') f.link.calendar_occurrence_date = '2000-01-01'
    if (deny === 'other-team') f.link.team_id = id(99)
    if (deny === 'archived') f.item.archived_at = new Date().toISOString()
    if (deny === 'invitation') f.tables.calendar_event_invites[0].invite_status = 'cancelled'
    if (deny === 'private-event') f.event.parent_visible = false
    if (deny === 'excluded') f.tables.event_player_occurrence_exclusions.push({ club_id: id(6), player_id: id(5), calendar_event_id: f.event.id, scope: 'this_only', effective_from_date: f.date })
    if (deny === 'deleted-occurrence') f.event.deleted_occurrence_dates = [f.date]
    if (deny === 'unsafe-path') f.item.storage_path = 'another-team/private.pdf'
    const response = await f.call('open_resource', { resourceId: f.item.id })
    assert.equal(response.statusCode, 403)
  })
}

test('player resource notifications use the confirmed send, are idempotent and respect opt-outs', async () => {
  const f = playerResourceFixture(), sent = []
  const args = { client: f.client, preparation: { id: id(30), club_id: id(6), source_id: f.event.id,
    source_type: 'calendar', change_action: 'rescheduled', source_snapshot: { resource_links: [] } },
  source: { resource_links: [{ id: f.item.id, date: f.date }] }, parentLinkIds: [id(4)], title: 'Training resource added', body: 'A new card is available.',
  featureCheck: async () => () => true, sendPush: async messages => { sent.push(...messages); return { sent: messages.length, failed: 0 } } }
  const result = await sendPlayerResourceNotifications(args)
  assert.equal(result.playerSent, 1)
  assert.equal(f.tables.fan_notifications.length, 1)
  assert.equal(sent[0].data.route, 'fans')
  assert.equal(sent[0].data.type, 'resource_shared')
  assert.equal((await sendPlayerResourceNotifications(args)).playerSent, 0)
  assert.equal(sent.length, 1)
  const inbox = await f.call('notifications')
  assert.equal(inbox.statusCode, 200)
  assert.equal(JSON.parse(inbox.body).notifications.length, 1)
  f.link.removed_at = new Date().toISOString()
  assert.equal(JSON.parse((await f.call('notifications')).body).notifications.length, 0)
  for (const changed of ['fan', 'off', 'resource-permission', 'revoked-parent']) {
    const g = playerResourceFixture()
    if (changed === 'fan') g.tables.fan_connections[0].relationship_type = 'fan'
    if (changed === 'off') g.tables.fan_connections[0].notifications_enabled = false
    if (changed === 'resource-permission') g.tables.fan_connections[0].permissions.resources = false
    if (changed === 'revoked-parent') g.tables.parent_player_links[0].status = 'revoked'
    const outcome = await sendPlayerResourceNotifications({ ...args, client: g.client, sendPush: async () => { throw new Error('Must not dispatch') } })
    assert.equal(outcome.playerSent, 0)
    assert.equal(g.tables.fan_notifications.length, 0)
  }
})

test('player resource push opens resources while ordinary Fans retain match-only access', () => {
  const connection = { id: id(1), relationship_type: 'player', plan_key: 'team', permissions: { schedule: true, resources: true, development: true, game_day: false } }
  const data = { route: 'fans', fanConnectionId: id(1), type: 'resource_shared' }
  assert.deepEqual(fanNotificationTarget(connection, data), { action: 'resources' })
  assert.equal(canViewFanNotifications(connection), true)
  assert.equal(fanNotificationTarget({ ...connection, relationship_type: 'fan' }, data), null)
  assert.equal(fanNotificationTarget(undefined, data), null)
  assert.equal(fanNotificationTarget({ ...connection, permissions: { ...connection.permissions, resources: false } }, data), null)
})

test('player attachment delivery rechecks revocation, removal and plan before dispatch', async () => {
  for (const change of ['removed', 'revoked', 'muted', 'plan']) {
    const f = playerResourceFixture()
    const original = f.client.from
    let featuresRead = 0
    f.client.from = table => {
      if (table === 'fan_devices') {
        if (change === 'removed') f.link.removed_at = new Date().toISOString()
        if (change === 'revoked') f.tables.parent_player_links[0].status = 'revoked'
        if (change === 'muted') f.tables.fan_connections[0].notifications_enabled = false
      }
      return original(table)
    }
    const outcome = await sendPlayerResourceNotifications({ client: f.client,
      preparation: { id: id(30), club_id: id(6), source_id: f.event.id, source_type: 'calendar', change_action: 'rescheduled', source_snapshot: { resource_links: [] } },
      source: { resource_links: [{ id: f.item.id, date: f.date }] }, parentLinkIds: [id(4)], title: 'Resource', body: 'Card',
      featureCheck: async () => { featuresRead += 1; return feature => change !== 'plan' || featuresRead < 2 || feature !== 'resourceLibrary' },
      sendPush: async () => { throw new Error('Must not send after authority changed') } })
    assert.equal(outcome.playerSent, 0)
    assert.equal(outcome.playerFailed, 0)
  }
})

test('player push and inbox copy describe only the authorised occurrence resource', async () => {
  const f = playerResourceFixture(), sent = []
  await sendPlayerResourceNotifications({ client: f.client,
    preparation: { id: id(30), club_id: id(6), source_id: f.event.id, source_type: 'calendar', change_action: 'rescheduled', source_snapshot: { resource_links: [] } },
    source: { resource_links: [{ id: id(99), date: '2000-01-01', title: 'Private excluded resource' }, { id: f.item.id, date: f.date }] },
    parentLinkIds: [id(4)], title: 'Private excluded resource', body: 'Private excluded resource was attached.',
    featureCheck: async () => () => true, sendPush: async messages => { sent.push(...messages); return { sent: messages.length, failed: 0 } } })
  assert.equal(sent.length, 1)
  assert.ok(sent[0].body.includes(f.item.title))
  assert.ok(!JSON.stringify(sent).includes('Private excluded resource'))
  assert.ok(!JSON.stringify(f.tables.fan_notifications).includes('Private excluded resource'))
})

for (const direct of [false, true]) test(`formation attachment retains published viewer with direct share=${direct}`, async () => {
  const f = playerResourceFixture()
  f.tables.formation_board_publications = [{ resource_id: f.item.id, club_id: id(6), team_id: id(7), board_id: id(40), board_version_id: id(41), publication_number: 1, board_title_snapshot: 'FP TEST Formation' }]
  f.tables.formation_board_versions = [{ id: id(41), board_id: id(40), club_id: id(6), team_id: id(7), game_format: '7v7', placements: [], bench: [] }]
  if (direct) f.tables.resource_library_links.unshift({ ...f.link, id: id(42), linked_type: 'player', linked_id: id(5), calendar_occurrence_date: null, parent_visible: true })
  const response = await f.call('open_resource', { resourceId: f.item.id })
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(response.body).formationBoard.title, 'FP TEST Formation')
  if (direct) assert.equal(JSON.parse((await f.call('resources')).body).resources[0].eventId, undefined)
})

test('Fans receive authoritative clock state only for accessible Game Day fixtures', async () => {
  const { client, tables, selections } = fixture()
  tables.fan_connections[0].permissions.game_day = true
  const timing = { phase_started_at: '2026-10-04T09:00:00Z', timer_started_at: '2026-10-04T09:00:00Z',
    timer_paused_at: null, timer_elapsed_seconds: 2100, timer_status: 'running', match_duration_minutes: 70,
    match_clock_mode: 'fixed', current_match_phase: 'second_half', extra_time_half_minutes: 10, concluded_at: null }
  const match = { id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents',
    match_date: new Date().toISOString().slice(0, 10), status: 'second_half', ...timing }
  tables.match_days = [match, { ...match, id: id(10), club_id: id(99) }, { ...match, id: id(11), parent_visible: false },
    { ...match, id: id(12), team_id: id(99) }, { ...match, id: id(13), status: 'scheduled' }]
  const call = () => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer test' },
    body: JSON.stringify({ action: 'matches', connectionId: id(1) }) }, { createClient: () => client })
  const response = await call()
  assert.equal(response.statusCode, 200)
  const matches = JSON.parse(response.body).matches
  assert.deepEqual(matches.map(row => row.id), [id(9)])
  for (const [field, value] of Object.entries(timing)) assert.equal(matches[0][field], value, field)
  assert.ok(selections.some(row => row.table === 'match_days' && row.columns.includes('timer_started_at')))
  tables.fan_connections[0].permissions.game_day = false
  assert.equal((await call()).statusCode, 403)
})

test('Fan resources retain saved categories and dates without exposing private storage fields',async()=>{
  const {client,tables,selections}=fixture()
  tables.fan_connections[0].permissions={schedule:false,game_day:false,development:true,resources:true}
  const base={club_id:id(6),team_id:id(7),linked_type:'player',linked_id:id(5),parent_visible:true,removed_at:null}
  const item={id:id(20),title:'Match report',description:'Shared report',category:'match_day',created_at:'2026-09-17T10:00:00Z',updated_at:'2026-09-17T12:00:00Z',club_id:id(6),team_id:id(7),storage_path:'private.pdf'}
  tables.resource_library_links=[{...base,resource_library_items:item},{...base,linked_id:id(99),resource_library_items:{...item,id:id(21)}}]
  const response=await handleFans({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({action:'resources',connectionId:id(1)})},{createClient:()=>client})
  assert.equal(response.statusCode,200)
  assert.deepEqual(JSON.parse(response.body).resources,[{id:item.id,title:item.title,description:item.description,category:'match_day',createdAt:item.created_at,updatedAt:item.updated_at}])
  assert.match(selections.find(s=>s.table==='resource_library_links').columns,/category, created_at, updated_at/)
})
test('Player accounts read only their current attendance and cannot submit invitations', async () => {
  const {client,tables}=fixture()
  const call = action => handleFans({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({action,connectionId:id(1)})},{createClient:()=>client})
  assert.equal((await call('attendance')).statusCode,403)
  tables.fan_connections[0].relationship_type='player'
  tables.match_days.push({id:id(9),club_id:id(6),team_id:id(7),parent_visible:true,parent_audience:'all_team_parents',match_date:new Date().toISOString().slice(0,10),status:'live',opponent:'FP TEST Visitors'})
  tables.match_day_player_availability=[{match_day_id:id(9),club_id:id(6),player_id:id(5),status:'available'},{match_day_id:id(9),club_id:id(6),player_id:id(99),status:'unavailable'}]
  const result=await call('attendance')
  assert.equal(result.statusCode,200)
  assert.equal(JSON.parse(result.body).attendance[0].response,'available')
  for(const action of ['accept','decline','respond','attendance_response']) assert.equal((await call(action)).statusCode,400)
  tables.parent_player_links[0].status='revoked'
  assert.equal((await call('attendance')).statusCode,403)
})

test('Player squad names are restricted to selected players in authorised same-team fixtures',async()=>{
  const {client,tables}=fixture()
  tables.fan_connections[0].relationship_type='player'
  const match={id:id(9),club_id:id(6),team_id:id(7),parent_visible:true,parent_audience:'all_team_parents',match_date:new Date(Date.now()+86400000).toISOString().slice(0,10),opponent:'Visitors',status:'scheduled'}
  tables.match_days=[match,{...match,id:id(10),parent_visible:false}]
  tables.players.push({id:id(20),club_id:id(6),team_id:id(7),player_name:'Selected Player',status:'active',email:'private@example.test'}, {id:id(21),club_id:id(6),team_id:id(8),player_name:'Other team'}, {id:id(22),club_id:id(6),team_id:id(7),player_name:'Not selected'}, {id:id(23),club_id:id(6),team_id:id(7),player_name:'Archived',status:'archived'})
  tables.match_day_player_squad_decisions=[20,21,22,23].map(n=>({match_day_id:id(9),club_id:id(6),team_id:id(7),player_id:id(n),status:n===22?'not_selected':'selected'}))
  const call=()=>handleFans({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({action:'schedule',connectionId:id(1)})},{createClient:()=>client})
  let result=await call()
  assert.equal(result.statusCode,200)
  assert.deepEqual(JSON.parse(result.body).schedule.map(row=>row.selected_player_names),[['Selected Player']])
  assert.ok(!result.body.includes('private@example.test'))
  tables.fan_connections[0].relationship_type='fan'
  result=await call()
  assert.equal(JSON.parse(result.body).schedule[0].selected_player_names,undefined)
  tables.fan_connections[0].relationship_type='player'
  tables.fan_connections[0].permissions.schedule=false
  assert.equal((await call()).statusCode,403)
  tables.fan_connections[0].permissions.schedule=true
  tables.parent_player_links[0].status='revoked'
  assert.equal((await call()).statusCode,403)
})

test('Player match details include the shared fixture type and surface', async () => {
  const { client, tables, selections } = fixture()
  tables.fan_connections[0].relationship_type = 'player'
  tables.fan_connections[0].permissions.game_day = true
  const match = { id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), status: 'scheduled', fixture_type: 'league', pitch_type: '3g' }
  tables.match_days = [match, { ...match, id: id(10), parent_visible: false }]
  const call = (matchId) => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'matches', connectionId: id(1), matchId }) }, { createClient: () => client })
  const response = await call(id(9))
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(response.body).matches[0].fixture_type, 'league')
  assert.equal(JSON.parse(response.body).matches[0].pitch_type, '3g')
  assert.match(selections.find((selection) => selection.table === 'match_days').columns, /fixture_type/)
  assert.match(selections.find((selection) => selection.table === 'match_days').columns, /pitch_type/)
  assert.equal((await call(id(10))).statusCode, 403)
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

test('Fan match timeline shows recorded scorer and assist names without private event notes', async () => {
  const { client, tables } = fixture()
  tables.fan_connections[0].permissions.game_day = true
  tables.match_days.push({ id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: new Date().toISOString().slice(0, 10), status: 'full_time', home_away: 'away', home_score: 2, away_score: 3 })
  tables.match_day_events.push({ id: id(11), match_day_id: id(9), event_status: 'active', event_type: 'goal', team_side: 'club', minute: 70, scorer_name: 'St Neots Scorer', assist_name: 'St Neots Assister', home_score: 2, away_score: 3, notes: 'Private staff note' })
  const response = await handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'matches', connectionId: id(1), matchId: id(9) }) }, { createClient: () => client })
  assert.equal(response.statusCode, 200)
  const content = JSON.parse(response.body)
  assert.equal(buildCompletedMatchEventPresentation(content.events[0], content.matches[0], { includeNotes: false }).detail, 'St Neots Scorer, assisted by St Neots Assister')
  assert.equal(response.body.includes('Private staff note'), false)
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

test('Player Game Day exposes authorised scheduled fixtures for pre-match shared plans', async () => {
  const { client, tables } = fixture()
  tables.fan_connections[0].relationship_type = 'player'
  tables.fan_connections[0].permissions = { schedule: false, game_day: true, development: false, resources: false }
  tables.match_days.push({ id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: new Date().toISOString().slice(0, 10), status: 'scheduled', opponent: 'Visitors' })
  const response = await handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action: 'matches', connectionId: id(1) }) }, { createClient: () => client })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body).matches.map((match) => match.id), [id(9)])
})

test('Fans and Player accounts see scorer-request fixtures in their schedules', async () => {
  const { client, tables } = fixture()
  const match = { id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: '2099-09-15', status: 'scorer_request', opponent: 'Visitors' }
  tables.match_days.push(match)
  const call = (action) => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action, connectionId: id(1) }) }, { createClient: () => client })
  assert.deepEqual(JSON.parse((await call('schedule')).body).schedule.map((item) => item.id), [match.id])
  tables.fan_connections[0].relationship_type = 'player'
  tables.fan_connections[0].permissions.game_day = true
  assert.deepEqual(JSON.parse((await call('schedule')).body).schedule.map((item) => item.id), [match.id])
  assert.deepEqual(JSON.parse((await call('matches')).body).matches.map((item) => item.id), [match.id])
  tables.fan_connections[0].relationship_type = 'fan'
  assert.deepEqual(JSON.parse((await call('matches')).body).matches, [])
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
  const notificationCopy={title:'Goal update',detailedBody:"Goal: FP TEST Player at 12'. 1 - 0 v Visitors."}
  const send=()=>sendFanMatchNotifications({client,match,type:'goal',eventId:id(11),targetParentLinkIds:[id(4)],notificationCopy,sendPush:async(messages)=>{delivered.push(...messages);return {sent:messages.length,failed:0}}})
  assert.equal((await send()).fanSent,1)
  assert.equal((await send()).fanSent,0)
  assert.equal(delivered.length,1)
  assert.equal(delivered[0].data.fanConnectionId,id(1))
  assert.equal(delivered[0].body,notificationCopy.detailedBody)
  assert.equal(JSON.stringify(delivered).includes('Private match name'),false)
  match.parent_visible=false
  const response=await handleFans({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({action:'notifications',connectionId:id(1)})},{createClient:()=>client})
  assert.deepEqual(JSON.parse(response.body).notifications,[])
})

test('separate score corrections to the same goal reach Fans once each, with retries deduplicated',async()=>{
  const {client,tables}=fixture()
  tables.fan_connections[0].permissions.game_day=true
  const match={id:id(9),club_id:id(6),team_id:id(7),parent_visible:true,parent_audience:'all_team_parents',match_date:new Date().toISOString().slice(0,10),updated_at:new Date().toISOString(),status:'live'}
  tables.match_days.push(match);tables.fan_devices.push({token:'ExpoPushToken[synthetic]',auth_user_id:id(2)})
  const sent=[]
  const send=notificationId=>sendFanMatchNotifications({client,match,type:'score_correction',eventId:id(11),notificationId,targetParentLinkIds:[id(4)],notificationCopy:{title:'Score corrected',detailedBody:'Score 1 - 0.'},sendPush:async messages=>{sent.push(...messages);return{sent:messages.length,failed:0}}})
  assert.equal((await send(id(12))).fanSent,1)
  assert.equal((await send(id(12))).fanSent,0)
  assert.equal((await send(id(13))).fanSent,1)
  assert.equal(sent.length,2)
  assert.equal(tables.fan_notifications.length,2)
})

test('Game alerts reach opted-in Fan and Player accounts through their Fan connections', async () => {
  const { client, tables } = fixture()
  tables.fan_connections[0].permissions.game_day = true
  tables.fan_connections.push({ ...tables.fan_connections[0], id: id(12), auth_user_id: id(13), relationship_type: 'player' })
  const match = { id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: new Date().toISOString().slice(0, 10), status: 'live', updated_at: new Date().toISOString() }
  tables.match_days.push(match)
  tables.fan_devices.push({ token: 'ExpoPushToken[fan]', auth_user_id: id(2) }, { token: 'ExpoPushToken[player]', auth_user_id: id(13) })
  const delivered = []
  const result = await sendFanMatchNotifications({ client, match, type: 'goal', eventId: id(11), targetParentLinkIds: [id(4)], notificationCopy: { title: 'Goal update', detailedBody: 'A goal was scored.' }, sendPush: async (messages) => { delivered.push(...messages); return { sent: messages.length, failed: 0 } } })
  assert.equal(result.fanSent, 2)
  assert.deepEqual(delivered.map((message) => [message.to, message.data.route, message.data.fanConnectionId]), [
    ['ExpoPushToken[fan]', 'fans', id(1)],
    ['ExpoPushToken[player]', 'fans', id(12)],
  ])
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

test('Matchday Fan service reads enforce the selected player Club plan before privileged data access', async () => {
  const { client, tables, read } = fixture()
  tables.clubs[0].plan_key = 'matchday'
  tables.fan_connections[0].permissions = { schedule: true, game_day: true, development: true, resources: true }
  tables.match_days.push({ id: id(9), club_id: id(6), team_id: id(7), parent_visible: true, parent_audience: 'all_team_parents', match_date: '2099-12-31', status: 'scheduled' })
  tables.calendar_events.push(
    { id: id(20), club_id: id(6), team_id: id(7), event_type: 'training', title: 'Private training', starts_at: '2099-12-30T18:00:00Z', ends_at: '2099-12-30T19:00:00Z', recurrence_frequency: 'none' },
    { id: id(21), club_id: id(6), team_id: id(7), event_type: 'social', title: 'Private social', starts_at: '2099-12-29T18:00:00Z', ends_at: '2099-12-29T19:00:00Z', recurrence_frequency: 'none' },
  )
  const call = (action) => handleFans({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ action, connectionId: id(1) }) }, { createClient: () => client })

  const schedule = await call('schedule')
  assert.equal(schedule.statusCode, 200)
  assert.deepEqual(JSON.parse(schedule.body).schedule.map((item) => item.event_type), ['match_day'])
  assert.equal(read.includes('training_availability_request_players'), false)
  assert.equal(read.includes('assessment_sessions'), false)

  read.length = 0
  assert.equal((await call('development')).statusCode, 403)
  assert.equal(read.includes('evaluations'), false)

  read.length = 0
  assert.equal((await call('resources')).statusCode, 403)
  assert.equal(read.includes('resource_library_links'), false)
})
