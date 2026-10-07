import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { normalizeCoachDevelopmentField, normalizeCoachDevelopmentForm, normalizeCoachDevelopmentRecord } from '../apps/mobile-core/src/coachPhase31ECore.js'

const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('export async function getCoachDevelopmentWorkspace('), source.indexOf('\nexport async function saveCoachDevelopmentDraft(')).replace('export ', '')

function workspaceLoader({ failures = {}, finishHistory } = {}) {
  const scopes = []
  const rows = {
    players: [{ id: 'player', player_name: 'FP TEST Alex', team_id: 'team' }],
    feedback_forms: [{ id: 'form', name: 'Passing assessment', fields: [{ id: 'score', label: 'Passing', type: 'score_1_10' }] }],
    evaluation_drafts: [{ id: 'draft', player_id: 'player', draft_data: { selectedFeedbackFormId: 'form', responseValues: { score: 7 } }, client_save_version: 2 }],
  }
  const supabase = { from(table) {
    const query = { select() { return query }, eq(key, value) { scopes.push([table, key, value]); return query }, neq() { return query }, order() { return query }, limit() { return query }, is() { return query }, or() { return query }, maybeSingle() { return query },
      then(resolve, reject) {
        if (table === 'evaluations') return finishHistory.then(resolve, reject)
        return Promise.resolve(failures[table] ? { error: new Error(failures[table]) } : { data: table === 'teams' ? {} : rows[table] || [] }).then(resolve, reject)
      },
    }
    return query
  } }
  const load = new Function('assertCoachOperationalRead', 'supabase', 'normalizeCoachDevelopmentField', 'normalizeCoachDevelopmentForm', 'normalizeCoachDevelopmentRecord', 'normalize', 'getStarterSelectionId', `${body}; return getCoachDevelopmentWorkspace;`)(
    user => assert.equal(user.activeTeamId, 'team'), supabase, normalizeCoachDevelopmentField, normalizeCoachDevelopmentForm, normalizeCoachDevelopmentRecord, value => String(value ?? '').trim(), () => '',
  )
  return { load, scopes }
}

test('phone assessment editor becomes usable within one second while history remains unresolved', async () => {
  let finish
  const history = new Promise(resolve => { finish = resolve })
  const { load, scopes } = workspaceLoader({ finishHistory: history })
  let ready
  const started = performance.now()
  const pending = load({ id: 'coach', clubId: 'club', activeTeamId: 'team' }, { onWorkspaceReady(value) { ready = value } })
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(ready, 'History must not gate the assessment fields or saved draft')
  assert.ok(performance.now() - started < 1000)
  assert.equal(ready.historyLoading, true)
  assert.equal(ready.players[0].id, 'player')
  assert.equal(ready.forms[0].fields[0].label, 'Passing')
  assert.equal(ready.drafts[0].values.score, 7)
  assert.ok(scopes.some(([table, key, value]) => table === 'evaluation_drafts' && key === 'created_by_user_id' && value === 'coach'))
  finish({ data: [{ id: 'record', player_id: 'player', feedback_form_name: 'Passing assessment' }] })
  const complete = await pending
  assert.equal(complete.historyLoading, false)
  assert.equal(complete.records[0].id, 'record')
})

test('failed history leaves assessments usable and explicitly reports unavailable history', async () => {
  const { load } = workspaceLoader({ finishHistory: Promise.reject(new Error('Network unavailable')) })
  const result = await load({ id: 'coach', clubId: 'club', activeTeamId: 'team' })
  assert.equal(result.forms.length, 1)
  assert.match(result.historyError, /could not be refreshed/)
  assert.equal(result.historyLoading, false)
})

for (const table of ['players', 'evaluation_drafts']) test(`failed ${table} cannot open an unsafe empty assessment editor`, async () => {
  const { load } = workspaceLoader({ failures: { [table]: 'Permission changed' }, finishHistory: Promise.resolve({ data: [] }) })
  let published = false
  await assert.rejects(load({ id: 'coach', clubId: 'club', activeTeamId: 'team' }, { onWorkspaceReady() { published = true } }), /Permission changed/)
  assert.equal(published, false)
})
