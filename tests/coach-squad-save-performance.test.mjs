import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../apps/mobile-core/src/coachMatchDayData.js', import.meta.url), 'utf8')
const start = source.indexOf('export async function setCoachMatchDaySquadDecision(')
const end = source.indexOf('export async function notifyCoachMatchDaySquadDecision(', start)
const body = source.slice(start, end).replaceAll('export ', '')
function setup({ status = 'scheduled', fail = false } = {}) {
  const calls = []
  const decisions = [{ playerId: 'player', status: 'selected', decisionRevision: 'server-revision' }]
  const save = new Function('prepareMutation', 'rpc', 'normalizeMatchDaySquadDecision', 'normalizeCoachMatchDay', 'getCoachMatchDayDetail', body + ';return setCoachMatchDaySquadDecision;')(
    async () => { calls.push('permission') },
    async (name, params) => { calls.push({ name, params }); if (fail) throw new Error('Decision changed'); return { id: 'fixture', status, squadDecisions: decisions, updatedAt: 'server-time' } },
    value => value, value => value,
    async () => { calls.push('full-refresh'); return { id: 'fixture', status } },
  )
  return { save, calls, decisions }
}
test('selection save reads authoritative revisions using two RPCs and preserves unchanged fixture context', async () => {
  const { save, calls, decisions } = setup()
  const match = { id: 'fixture', status: 'scheduled', squadNotificationContacts: [{ playerId: 'player', canNotify: true }], isToday: true }
  const saved = await save({ activeTeamId: 'team' }, match, 'player', 'selected', 'old-time')
  assert.equal(saved.squadDecisions, decisions)
  assert.equal(saved.squadNotificationContacts, match.squadNotificationContacts)
  assert.equal(saved.isToday, true)
  assert.deepEqual(calls, ['permission', { name: 'set_match_day_player_squad_decision_v2', params: { match_day_id_value: 'fixture', player_id_value: 'player', decision_value: 'selected', expected_decided_at_value: 'old-time' } }, { name: 'get_staff_match_day_detail', params: { active_team_id_value: 'team', target_match_day_id_value: 'fixture' } }])
})
test('a lifecycle change refreshes the full match instead of retaining old controls', async () => {
  const { save, calls } = setup({ status: 'live' })
  assert.equal((await save({ activeTeamId: 'team' }, { id: 'fixture', status: 'scheduled' }, 'player', 'selected')).status, 'live')
  assert.equal(calls.at(-1), 'full-refresh')
})
test('a decision conflict stops immediately without a refresh that could hide the failure', async () => {
  const { save, calls } = setup({ fail: true })
  await assert.rejects(save({ activeTeamId: 'team' }, { id: 'fixture', status: 'scheduled' }, 'player', 'selected'), /Decision changed/)
  assert.equal(calls.length, 2)
})

const batchBody = source.slice(source.indexOf('export async function setCoachMatchDaySquadDecisions('), end).replace('export ', '')
test('ten squad changes use one RPC and return authoritative revisions together', async () => {
  const calls = []
  const choices = Array.from({length:10}, (_, i) => ({player:{id:String(i),decidedAt:'old'},decision:'selected'}))
  const save = new Function('prepareMutation','rpc','normalizeMatchDaySquadDecision','normalizeCoachMatchDay','getCoachMatchDayDetail', batchBody+';return setCoachMatchDaySquadDecisions;')(
    async()=>{}, async(name,params)=>{calls.push({name,params});return {id:'fixture',status:'scheduled',squadDecisions:choices.map(({player})=>({playerId:player.id,decisionRevision:'new-'+player.id}))}},value=>value,value=>value,()=>assert.fail('No full refresh needed'))
  const saved = await save({activeTeamId:'team'},{id:'fixture',status:'scheduled'},choices)
  assert.equal(calls.length,1)
  assert.equal(calls[0].name,'set_match_day_squad_decisions_batch')
  assert.equal(calls[0].params.decisions_value.length,10)
  assert.equal(calls[0].params.decisions_value[9].expectedDecidedAt,'old')
  assert.equal(saved.squadDecisions.length,10)
})
