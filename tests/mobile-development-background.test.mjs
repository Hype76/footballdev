import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const load = text => import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)
const core = await load(read('apps/mobile-core/src/developmentOfflineCore.js'))
const status = await load(read('apps/mobile-core/src/developmentSaveStatusCore.js'))
const form = { id: 'form', name: 'Review', version: 1, fields: [] }
const player = { id: 'player' }
const key = core.developmentDraftKey(player.id, form.id)
const context = { id: 'team', teamId: 'team', clubId: 'club', authorityId: 'assignment', role: 'coach' }
const user = { id: 'coach' }
const draft = () => ({ id: 'fixed-draft-id', playerId: player.id, formId: form.id, status: 'synced', revision: 4,
  serverVersion: 2, values: { score: 7 }, notes: 'Saved latest note', finalisation: {
    requestedAt: '2026-10-07T12:00:00Z', revision: 4, serverVersion: 2, form, player,
    values: { score: 7 }, notes: 'Saved latest note', shareWithParent: true,
  } })
function engine(initial, { finalise = async () => ({}), workspace = async () => ({ players: [player], forms: [form] }), current = () => true } = {}) {
  // JSON roundtrips model persisted storage, not component memory. Existing encrypted-store tests cover the actual writer.
  let disk = JSON.stringify(initial), writes = 0
  const events = [], calls = []
  const source = read('apps/coach-mobile/src/coachDevelopmentSync.js').replace(/^import .+\r?\n/gm, '').replace(/^export /gm, '')
  const deps = { ...core, developmentSyncFailure: status.developmentSyncFailure, applyCoachContext: value => value,
    withMobileAsyncTimeout: callback => callback(), getCoachDevelopmentWorkspace: workspace,
    saveCoachDevelopmentDraft: async () => { throw new Error('A queued synced record must not save again') },
    finalizeCoachDevelopmentRecord: async (who, request) => { calls.push({ who, request }); return finalise(who, request) },
    readCoachDevelopmentDrafts: async () => JSON.parse(disk), updateCoachDevelopmentDraft: async (_who, _context, id, change) => {
      const all = JSON.parse(disk), next = change(all[id] || null)
      if (next) all[id] = next
      else delete all[id]
      disk = JSON.stringify(all); writes++; return next
    },
  }
  const api = new Function(...Object.keys(deps), `${source};return {syncCoachDevelopmentDrafts,subscribeDevelopmentSync}`)(...Object.values(deps))
  api.subscribeDevelopmentSync(event => { if (event) events.push(event) })
  return { run: () => api.syncCoachDevelopmentDrafts(user, context, current), read: () => JSON.parse(disk),
    replace: value => { disk = JSON.stringify(value) }, calls, events, writes: () => writes }
}

test('queued exact record finishes without an editor and emits success only after durable removal', async () => {
  let resolve
  const delayed = new Promise(done => { resolve = done }), queued = draft()
  const service = engine({ [key]: queued }, { finalise: () => delayed })
  const first = service.run(), duplicate = service.run()
  assert.equal(first, duplicate, 'One active operation per authority scope')
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(service.calls.length, 1); assert.deepEqual(service.read()[key], queued); assert.deepEqual(service.events, [])
  resolve({ id: queued.id }); await first
  assert.deepEqual(service.read(), {})
  assert.equal(service.events[0].kind, 'finalised'); assert.equal(service.events[0].shared, true)
  assert.equal(service.calls[0].request.draftId, queued.id); assert.equal(service.calls[0].request.clientSaveVersion, 2)
})

test('lost final response keeps intent across restart and replays same ID/version/values once', async () => {
  const first = engine({ [key]: draft() }, { finalise: async () => { throw new Error('Lost response after commit') } })
  await first.run(); assert.equal(first.events.some(event => event.kind === 'finalised'), false)
  assert.equal(first.events[0].kind, 'finalisation_failed')
  const persisted = first.read()[key]
  assert.equal(persisted.status, 'synced'); assert.match(persisted.finalisationError, /Sending needs a retry/)
  const restarted = engine(first.read()); await restarted.run()
  for (const field of ['draftId', 'clientSaveVersion', 'values', 'notes', 'shareWithParent']) {
    assert.deepEqual(restarted.calls[0].request[field], first.calls[0].request[field])
  }
  assert.deepEqual(restarted.read(), {})
})

test('changed form or local revision retains the queue without sending stale content', async () => {
  const changed = { ...form, version: 2 }
  for (const service of [engine({ [key]: draft() }, { workspace: async () => ({ players: [player], forms: [changed] }) }),
    engine({ [key]: { ...draft(), revision: 5 } })]) {
    await service.run(); assert.equal(service.calls.length, 0); assert.ok(service.read()[key].finalisation)
    assert.ok(service.read()[key].finalisationError); assert.equal(service.events.some(event => event.kind === 'finalised'), false)
  }
})

test('account or authority changes suppress later requests and do not clear the previous saved record', async () => {
  let current = true, resolve
  const delayed = new Promise(done => { resolve = done })
  const service = engine({ [key]: draft() }, { current: () => current, finalise: () => delayed })
  const run = service.run()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  current = false; resolve({}); await run
  assert.ok(service.read()[key].finalisation); assert.equal(service.writes(), 0); assert.equal(service.events.length, 0)
  assert.equal(service.calls[0].request.isCurrent(), false)
})

test('queued status describes only local acknowledgement', () => {
  assert.equal(status.developmentSaveStatus({ ready: true, draft: draft(), saving: 0, unsaved: false }), 'Saved on this phone.')
})

test('late completion cannot delete a newer persisted record', async () => {
  let resolve
  const delayed = new Promise(done => { resolve = done })
  const service = engine({ [key]: draft() }, { finalise: () => delayed }), run = service.run()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  const newer = { ...draft(), id: 'newer-record', revision: 5, values: { score: 9 } }
  service.replace({ [key]: newer }); resolve({}); await run
  assert.deepEqual(service.read()[key], newer); assert.equal(service.events.length, 0)
})

test('actual local writer rejects stale edits after a finalisation has been queued', async () => {
  const source = read('apps/coach-mobile/src/offline.js')
  const start = source.indexOf('export function saveLocalCoachDevelopmentDraft'), end = source.indexOf('export async function countPendingCoachDevelopmentDrafts', start)
  let stored = draft()
  const deps = { ...core, Crypto: { randomUUID: () => 'unexpected' }, updateCoachDevelopmentDraft: async (_user, _context, _key, change) => {
    const next = change(structuredClone(stored)); stored = next; return next
  } }
  const save = new Function(...Object.keys(deps), `${source.slice(start, end).replace('export ', '')};return saveLocalCoachDevelopmentDraft`)(...Object.values(deps))
  await assert.rejects(save('coach', context, { playerId: player.id, formId: form.id, values: { score: 9 }, notes: 'late edit' }), /already queued/)
  assert.deepEqual(stored, draft())
})

test('offline workspace failure retains intent and exposes a retry instead of silent waiting', async () => {
  const service = engine({ [key]: draft() }, { workspace: async () => { throw new Error('Offline') } })
  await service.run()
  assert.equal(service.calls.length, 0); assert.ok(service.read()[key].finalisation)
  assert.match(service.read()[key].finalisationError, /Sending needs a retry. Offline/)
})

const data = read('apps/mobile-core/src/coachPhase31EData.js')
const finaliseSource = data.slice(data.indexOf('export async function finalizeCoachDevelopmentRecord'), data.indexOf('export async function getCoachResources')).replace('export ', '')
const stages = ['token', 'recipients', 'evaluation', 'limit', 'rpc', 'report', 'audit']
for (const switchAt of [...stages, null]) test(switchAt ? `actual finalisation stops after account switch at ${switchAt}` : 'successful finalisation explicitly requests parent notifications', async () => {
  let current = true
  const calls = []
  const stage = name => { calls.push(name); if (name === switchAt) current = false }
  const query = () => { let count = false; const q = { select: (_columns, options) => { count = !!options?.head; return q }, eq: () => q,
    gte: () => q, maybeSingle: async () => { stage('evaluation'); return { data: null } },
    then: (resolve, reject) => { stage(count ? 'limit' : 'evaluation'); return Promise.resolve({ count: 0 }).then(resolve, reject) } }; return q }
  const deps = { assertCanonicalMutation: () => {}, assertCoachCapability: () => {}, assertTeamEntity: () => {}, CAPABILITIES: { assessments: 'assessments' },
    validateCoachDevelopmentValues: () => ({ valid: true, values: {} }), getAccessToken: async () => { stage('token'); return 'synthetic-token' },
    config: { apiBaseUrl: 'https://example.test' }, joinApiPath: (...values) => values.join('/'), normalize: value => String(value ?? '').trim(),
    fetchJsonWithTimeout: async (_url, options) => { const body = JSON.parse(options.body); stage(body.action === 'resolve_development_recipients' ? 'recipients' : 'report');
      if (body.action === 'finalize_development_parent_report') assert.equal(body.notifyParents, true)
      return { ok: true, result: { recipients: [{ linkId: 'link' }], eligibleRecipients: [{ id: 'parent' }] } } },
    supabase: { from: query }, getPlanLimit: () => null, getCoachEntryIdentity: () => ({}),
    rpc: async () => { stage('rpc'); return { id: 'draft' } }, recordCoachOperationalAudit: async () => { stage('audit') }, normalizeCoachDevelopmentRecord: value => value,
  }
  const finalise = new Function(...Object.keys(deps), `${finaliseSource};return finalizeCoachDevelopmentRecord`)(...Object.values(deps))
  const request = finalise({ id: 'coach', roleRank: 30, clubId: 'club', activeTeamId: 'team' }, {
    draftId: 'draft', clientSaveVersion: 2, form, player, shareWithParent: true, isCurrent: () => current,
  })
  if (switchAt) {
    await assert.rejects(request, /selected account or team changed/)
    assert.deepEqual(calls, stages.slice(0, stages.indexOf(switchAt) + 1))
  } else {
    assert.equal((await request).sharedRecipientCount, 1); assert.deepEqual(calls, stages)
  }
})
