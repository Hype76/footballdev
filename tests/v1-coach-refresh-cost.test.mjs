import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {readCoachReminderProjections,projectCoachReminderMatches} from '../src/lib/coach-reminder-read-model.js'

function section(file, start, end) {
  const source = readFileSync(file, 'utf8'), from = source.indexOf(start), to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return source.slice(from, to).replaceAll('export ', '')
}
test('instrumented live Coach refresh preserves the six-request authority and presentation path', async () => {
  const calls = []
  const match = { id: 'match', status: 'live' }
  const query = new Proxy({}, { get: (_target, name) => name === 'then'
    ? (resolve) => { calls.push('match_days'); resolve({ data: [match] }) }
    : () => query })
  const supabase = { from: () => query, rpc: async (name) => {
    calls.push(name)
    return { data: name === 'get_staff_match_day_detail' ? match : [] }
  } }
  const dependencies = {
    supabase, LIST_SELECT: 'fixture columns', scoped: (value) => value,
    assertCoachMatchDayAccess: () => {}, assertCoachOperationalRead: () => {},
    normalize: (value) => String(value || '').trim(), normalizeCoachMatchDay: (value) => value,
    normalizePlayerForUser: (value) => value,
    getMobileRuntimeConfig: () => ({ apiBaseUrl: 'https://fixture.invalid' }), getAccessToken: async () => 'synthetic',
    joinApiPath: (base, path) => `${base}/${path}`,
    fetchJsonWithTimeout: async () => { calls.push('volunteer eligibility'); return { ok: true, result: { success: true, eligibility: [] } } },
  }
  const code = [
    section('apps/mobile-core/src/coachMatchDayData.js', 'export async function getCoachMatchDayList(', 'async function sendCoachFixtureInvitations('),
    section('apps/mobile-core/src/coachMatchDayData.js', 'export async function getCoachMatchDayDetail(', 'async function prepareMutation('),
    section('apps/mobile-core/src/coachPlayersData.js', 'async function getCoachPlayerRows(', 'export async function getCoachPlayerDetail('),
  ].join('\n')
  const api = new Function(...Object.keys(dependencies), code + ';return {getCoachMatchDayList,getCoachMatchDayDetail,getCoachPlayerList}')(...Object.values(dependencies))
  const user = { id: 'coach', activeTeamId: 'team', clubId: 'club', roleRank: 40 }
  await Promise.all([api.getCoachMatchDayList(user), api.getCoachPlayerList(user)])
  const detail = await api.getCoachMatchDayDetail(user, 'match')
  assert.equal(detail.status, 'live')
  assert.deepEqual(calls.sort(), ['match_days','get_match_day_presentation_states','get_team_players','get_team_parent_app_installation_status','get_staff_match_day_detail','volunteer eligibility'].sort())
  assert.equal(calls.length * 4, 24, 'four 15-second refreshes use 24 reads per minute before retries')
})

test('Coach detail adds scoped reminder provenance only when enabled and preserves original authority data',async()=>{
  const calls=[],match={id:'match',status:'live',playerAvailability:[{playerId:'child',status:'pending'}],availabilityRequests:[{playerId:'child',status:'sent'}]}
  const supabase={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='get_staff_match_day_detail'?match:[{eventId:'match',playerId:'child',status:'unavailable',automatic:true,provenance:'coach_deadline_automation',planningExcluded:true}]}}}
  const runtime={env:{}},dependencies={process:runtime,supabase,assertCoachMatchDayAccess:()=>{},normalize:value=>String(value||'').trim(),normalizeCoachMatchDay:value=>value,readCoachReminderProjections,projectCoachReminderMatches}
  const code=section('apps/mobile-core/src/coachMatchDayData.js','export async function getCoachMatchDayDetail(','async function prepareMutation(')
  const load=new Function(...Object.keys(dependencies),code+';return getCoachMatchDayDetail')(...Object.values(dependencies))
  const user={id:'coach',activeTeamId:'team',clubId:'club',roleRank:40}
  const disabled=await load(user,'match',{includeVolunteerEligibility:false})
  assert.equal(disabled.playerAvailability[0].status,'pending');assert.equal(calls.length,1)
  runtime.env.EXPO_PUBLIC_ENABLE_COACH_REMINDER_AUTOMATION='true'
  const enabled=await load(user,'match',{includeVolunteerEligibility:false})
  const projected=enabled.playerAvailability[0]
  assert.equal(projected.status,'unavailable');assert.equal(projected.availabilityProvenance,'coach_deadline_automation');assert.equal(projected.planningExcluded,true)
  assert.equal(enabled.availabilityRequests[0].status,'sent');assert.equal(enabled.availabilityRequests[0].availabilityStatus,'unavailable')
  assert.deepEqual(calls.at(-1),{name:'get_team_coach_reminder_projections_v1',args:{kind_value:'MATCH',event_ids:['match'],parent_link_id_value:null}})
  assert.equal(match.playerAvailability[0].status,'pending');assert.equal(match.availabilityRequests[0].availabilityStatus,undefined)
})
