import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isMatchDayParticipantRosterCurrent, mergeMatchDayParticipantEventIdentities, normalizeMatchDayParticipantRoster } from '../apps/mobile-core/src/matchDayParticipantRoster.js'

function section(file, start, end) {
  const source = readFileSync(file, 'utf8'), from = source.indexOf(start), to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return source.slice(from, to).replaceAll('export ', '')
}
test('instrumented live Coach refresh adds one authorised roster read to the authority and presentation path', async () => {
  const calls = []
  const match = { id: 'match', teamId: 'team', status: 'live', matchDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' }) }
  const query = new Proxy({}, { get: (_target, name) => name === 'then'
    ? (resolve) => { calls.push('match_days'); resolve({ data: [match] }) }
    : () => query })
  const supabase = { from: () => query, rpc: async (name) => {
    calls.push(name)
    return { data: name === 'get_staff_match_day_detail' ? match : name === 'get_match_day_event_participants' ? { matchId: 'match', teamId: 'team', players: [] } : [] }
  } }
  const dependencies = {
    supabase, LIST_SELECT: 'fixture columns', scoped: (value) => value,
    isMatchDayParticipantRosterCurrent, mergeMatchDayParticipantEventIdentities, normalizeMatchDayParticipantRoster,
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
  assert.deepEqual(detail.eventParticipants, [])
  assert.deepEqual(calls.sort(), ['match_days','get_match_day_presentation_states','get_team_players','get_team_parent_app_installation_status','get_staff_match_day_detail','get_match_day_event_participants','volunteer eligibility'].sort())
  assert.equal(calls.length * 4, 28, 'four 15-second refreshes use 28 reads per minute before retries')
  const original = supabase.rpc
  supabase.rpc = (name, args) => name === 'get_match_day_event_participants' ? { error: new Error('Roster unavailable') } : original(name,args)
  await assert.rejects(api.getCoachMatchDayDetail(user,'match'), /Roster unavailable/)
})
