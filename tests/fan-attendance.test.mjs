import assert from 'node:assert/strict'
import test from 'node:test'
import { fanAttendanceResponse, fanAttendanceStart, groupFanAttendance } from '../src/lib/fan-attendance.js'
import { loadPlayerAttendance } from '../netlify/functions/lib/_fan-schedule.js'

test('attendance separates past and upcoming with London times, TBC and ongoing events',()=>{
 const now=new Date('2026-09-17T12:00:00Z')
 const items=[{id:'tomorrow',date:'2026-09-18',time:'18:00'},{id:'past',date:'2026-09-16',time:'18:00'},{id:'ongoing',date:'2026-09-17',time:'12:00',end_time:'14:00'},{id:'earlier',starts_at:'2026-09-17T10:00:00Z'},{id:'tbc',date:'2026-09-17'},{id:'invalid',date:'bad'},{id:'cancelled',date:'2026-09-18',status:'cancelled'}]
 const groups=groupFanAttendance(items,now)
 assert.deepEqual(groups.upcoming.map(i=>i.id),['ongoing','tbc','tomorrow'])
 assert.deepEqual(groups.past.map(i=>i.id),['earlier','past'])
 assert.equal(fanAttendanceStart(items[0]),'2026-09-18T18:00')
 for(const value of ['available','accepted','attending'])assert.equal(fanAttendanceResponse(value).tone,'success')
 for(const value of ['unavailable','not_attending','declined'])assert.equal(fanAttendanceResponse(value).tone,'danger')
 assert.equal(fanAttendanceResponse('maybe').label,'Maybe')
 assert.equal(fanAttendanceResponse('pending').label,'Awaiting response')
})

test('attendance retains real times, Home/Away, scoped history and saved responses',async()=>{
 const tables={match_days:[{id:'match',title:'Custom fixture',club_id:'club',team_id:'team',parent_visible:true,parent_audience:'all_team_parents',match_date:'2026-09-16',kickoff_time:'18:00',home_away:'away',status:'full_time'}],match_day_player_availability:[{match_day_id:'match',status:'available'}],
 calendar_events:[{id:'training',title:'Training',starts_at:'2026-09-14T17:00:00Z',ends_at:'2026-09-14T18:00:00Z',event_type:'training',parent_visible:true,parent_audience:'all_team_parents',team_id:'team'}, {id:'hidden',title:'Private',starts_at:'2026-09-14T17:00:00Z',parent_visible:false,team_id:'team'}, {id:'old',title:'Too old',starts_at:'2026-01-01T12:00:00Z',parent_visible:true,parent_audience:'all_team_parents',team_id:'team'}],
 training_availability_request_players:[{request_id:'request',calendar_event_id:'training',status:'expired'}],training_availability_requests:[{id:'request',calendar_event_id:'training',occurrence_date:'2026-09-14',occurrence_starts_at:'2026-09-14T17:00:00Z',occurrence_ends_at:'2026-09-14T18:00:00Z'}],training_availability_responses:[{request_id:'request',status:'attending'}]}
 const client={from(table){let excluded=[];const query={then(resolve){return Promise.resolve({data:(tables[table]||[]).filter(r=>excluded.every(([k,v])=>r[k]!==v))}).then(resolve)},neq(k,v){excluded.push([k,v]);return query}};for(const method of ['select','eq','is','gte','order','limit','in'])query[method]=()=>query;return query}}
 const rows=await loadPlayerAttendance(client,{club:{name:'Club'},fan:{club_id:'club',permissions:{schedule:true}},parent:{club_id:'club',team_id:'team'},player:{id:'player',team_id:'team'}},new Date('2026-09-17T12:00:00Z'))
 assert.equal(rows.find(r=>r.id==='match').time,'18:00')
 assert.equal(rows.find(r=>r.id==='match').home_away,'away')
 assert.equal(rows.find(r=>r.id==='match').title,'Custom fixture')
 assert.equal(rows.find(r=>r.id==='match').response,'available')
 assert.equal(rows.find(r=>r.id==='training:2026-09-14').response,'attending')
 assert.ok(!rows.some(r=>r.id.startsWith('hidden')||r.id.startsWith('old')))
})
