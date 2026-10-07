import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { normalizeCoachDevelopmentRecord, splitCoachDevelopmentVisibility, validateCoachDevelopmentValues } from '../apps/mobile-core/src/coachPhase31ECore.js'

const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('export async function finalizeCoachDevelopmentRecord('), source.indexOf('\nexport async function getCoachResources(')).replace('export ', '')

test('parent report failure retries the original final record and preserves the audit and share effects', async () => {
  const calls = [], audits = [], guards = []
  let saved = null, failShare = true, countReads = 0
  const user = { id: 'coach', clubId: 'club', activeTeamId: 'team', roleRank: 30, hasActivePlanAccess: true }
  const form = { id: 'form', name: 'Passing', version: 1, fields: [{ id: 'passing', label: 'Passing', type: 'score_1_10', roleRank: 20 }] }
  const supabase = { from(table) {
    assert.equal(table, 'evaluations')
    let count = false
    const query = { select(_fields, options) { count = options?.count === 'exact'; return query }, eq() { return query }, gte() { return query }, maybeSingle() { return Promise.resolve({ data: saved ? { id: saved.id } : null }) }, then(resolve, reject) { countReads++; return Promise.resolve({ count: count ? 0 : null }).then(resolve, reject) } }
    return query
  } }
  const deps = {
    assertCanonicalMutation: actor => { guards.push('authority'); if (!actor.hasActivePlanAccess) throw new Error('Inactive authority') }, assertCoachCapability: actor => { guards.push('capability'); if (actor.roleRank < 20) throw new Error('Assessment capability denied') }, assertTeamEntity: (actor, player) => { guards.push('team'); if (actor.activeTeamId !== player.teamId) throw new Error('Different team') }, CAPABILITIES: { assessments: 'assessments' }, validateCoachDevelopmentValues,
    getAccessToken: async () => 'synthetic-token', joinApiPath: (base, path) => `${base}/${path}`, config: { apiBaseUrl: 'https://synthetic.invalid' }, normalize: value => String(value ?? '').trim(),
    fetchJsonWithTimeout: async (_url, options) => {
      const request = JSON.parse(options.body)
      calls.push(request)
      if (request.action === 'resolve_development_recipients') return { ok: true, result: { recipients: [{ linkId: 'parent-link' }] } }
      assert.equal(request.evaluationId, 'draft')
      if (failShare) { failShare = false; return { ok: false, response: { status: 503 }, result: { message: 'Parent snapshot unavailable' } } }
      return { ok: true, result: { eligibleRecipients: [{ linkId: 'parent-link' }] } }
    }, supabase, getPlanLimit: () => 1, getCoachEntryIdentity: () => ({}), splitCoachDevelopmentVisibility,
    rpc: async (name, args) => { assert.equal(name, 'finalise_coach_mobile_assessment'); assert.ok(['draft', 'private-draft'].includes(args.draft_id_value)); assert.equal(args.expected_save_version_value, 2); saved ||= { ...args.evaluation_value, id: args.draft_id_value }; return saved },
    recordCoachOperationalAudit: async row => audits.push(row), normalizeCoachDevelopmentRecord,
  }
  const finalise = new Function(...Object.keys(deps), `${body}; return finalizeCoachDevelopmentRecord;`)(...Object.values(deps))
  const request = { draftId: 'draft', clientSaveVersion: 2, form, player: { id: 'player', playerName: 'FP TEST Alex', teamId: 'team' }, values: { passing: 7 }, notes: 'Look up first', shareWithParent: true }
  await assert.rejects(finalise(user, request), /Parent snapshot unavailable/)
  assert.equal(saved.id, 'draft')
  assert.equal(audits.length, 0)
  const result = await finalise(user, request)
  assert.equal(result.id, 'draft')
  assert.equal(countReads, 1, 'A successful original insert must not consume another monthly allowance on retry')
  assert.equal(audits.length, 1)
  assert.equal(audits[0].metadata.parentShared, true)
  assert.equal(calls.filter(call => call.action === 'finalize_development_parent_report').length, 2)
  assert.deepEqual(guards.slice(0, 3), ['authority', 'capability', 'team'])
  saved = null
  const priorRequests = calls.length
  const privateResult = await finalise(user, { ...request, draftId: 'private-draft', shareWithParent: false })
  assert.equal(privateResult.id, 'private-draft')
  assert.equal(calls.length, priorRequests, 'Private completion must not resolve parents or create a shared snapshot')
  assert.equal(audits[1].metadata.parentShared, false)
  await assert.rejects(finalise({ ...user, roleRank: 0 }, { ...request, shareWithParent: false }), /capability denied/)
  await assert.rejects(finalise({ ...user, hasActivePlanAccess: false }, { ...request, shareWithParent: false }), /Inactive authority/)
  await assert.rejects(finalise(user, { ...request, player: { ...request.player, teamId: 'other' }, shareWithParent: false }), /Different team/)
  assert.equal(calls.length, priorRequests)
})
