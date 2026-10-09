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
function engine(initial, { finalise = async () => ({}), workspace = async () => ({ players: [player], forms: [form] }), current = () => true, offline = false, save = async () => { throw new Error('A queued synced record must not save again') }, discard = async () => {}, beforeRead = async () => {} } = {}) {
  // JSON roundtrips model persisted storage, not component memory. Existing encrypted-store tests cover the actual writer.
  let disk = JSON.stringify(initial), writes = 0
  const events = [], calls = [], saves = [], discards = []
  const source = read('apps/coach-mobile/src/coachDevelopmentSync.js').replace(/^import .+\r?\n/gm, '').replace(/^export /gm, '')
  const deps = { invalidateMobileResource: () => {}, ...core, developmentSyncFailure: status.developmentSyncFailure, applyCoachContext: value => value,
    withMobileAsyncTimeout: callback => callback(), getCoachDevelopmentWorkspace: (who, options) => {
      assert.equal(options?.includeHistory, false, 'Draft sync must not wait for history')
      return workspace(who, options)
    },
    saveCoachDevelopmentDraft: async (who, request) => { saves.push(request); return save(who, request) },
    discardCoachDevelopmentDraft: async (who, request) => { discards.push(request); return discard(who, request) },
    finalizeCoachDevelopmentRecord: async (who, request) => { calls.push({ who, request }); return finalise(who, request) },
    readCoachDevelopmentDrafts: async () => { await beforeRead(); return JSON.parse(disk) }, updateCoachDevelopmentDraft: async (_who, _context, id, change) => {
      const all = JSON.parse(disk), next = change(all[id] || null)
      if (next) all[id] = next
      else delete all[id]
      disk = JSON.stringify(all); writes++; return next
    },
  }
  const api = new Function(...Object.keys(deps), `${source};return {syncCoachDevelopmentDrafts,subscribeDevelopmentSync}`)(...Object.values(deps))
  api.subscribeDevelopmentSync(event => { if (event) events.push(event) })
  return { run: () => api.syncCoachDevelopmentDrafts({...user, isOfflineProfile: offline}, context, current), read: () => JSON.parse(disk),
    replace: value => { disk = JSON.stringify(value) }, calls, events, saves, discards, writes: () => writes }
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
  const deps = { invalidateMobileResource: () => {}, ...core, Crypto: { randomUUID: () => 'unexpected' }, updateCoachDevelopmentDraft: async (_user, _context, _key, change) => {
    const next = change(structuredClone(stored)); stored = next; return next
  } }
  const save = new Function(...Object.keys(deps), `${source.slice(start, end).replace('export ', '')};return saveLocalCoachDevelopmentDraft`)(...Object.values(deps))
  await assert.rejects(save('coach', context, { playerId: player.id, formId: form.id, values: { score: 9 }, notes: 'late edit' }), /already queued/)
  assert.deepEqual(stored, draft())
})

test('unchanged Save preserves a synced draft revision and keeps sharing available', () => {
  const saved = { ...draft(), finalisation: null, formFingerprint: core.developmentFormFingerprint(form) }
  const same = core.editLocalDevelopmentDraft(saved, { ...saved, values: { score: 7 } })
  assert.equal(same, saved)
  assert.equal(same.status, 'synced')
  assert.equal(same.revision, 4)
  const edited = core.editLocalDevelopmentDraft(saved, { ...saved, values: { score: 8 } })
  assert.equal(edited.status, 'pending')
  assert.equal(edited.revision, 5)
  const updatedForm = core.editLocalDevelopmentDraft(saved, { ...saved, formFingerprint: 'changed-form' })
  assert.equal(updatedForm.status, 'pending')
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


test('cancellation persists offline and discards the exact draft after reconnecting', async () => {
  const saved = { ...draft(), finalisation: null, discardRequested: true, status: 'pending' }
  const offline = engine({ [key]: saved }, { offline: true })
  await offline.run(); assert.equal(offline.discards.length, 0); assert.deepEqual(offline.read()[key], saved)
  const online = engine(offline.read()); await online.run()
  assert.equal(online.discards.length, 1); assert.equal(online.discards[0].draftId, saved.id)
  assert.equal(online.saves.length, 0); assert.equal(online.calls.length, 0)
  assert.deepEqual(online.read(), {}); assert.equal(online.events[0].kind, 'discarded')
})

test('cancelling during an in-flight save discards afterwards and cannot resurrect the draft', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const saved = { ...draft(), finalisation: null, status: 'pending' }
  const service = engine({ [key]: saved }, { save: () => pending })
  const run = service.run()
  for (let i = 0; i < 40; i++) await Promise.resolve()
  assert.equal(service.saves.length, 1)
  service.replace({ [key]: { ...service.read()[key], discardRequested: true, status: 'pending' } })
  resolve({ clientSaveVersion: 3, lastSavedAt: '2026-10-07T16:00:00Z' }); await run
  assert.equal(service.discards.length, 1); assert.deepEqual(service.read(), {})
  assert.equal(service.calls.length, 0); assert.equal(service.events.filter(e => e.kind === 'discarded').length, 1)
})

test('failed cancellation retains its durable intent and retries without saving or finalising', async () => {
  const saved = { ...draft(), finalisation: null, discardRequested: true, status: 'pending' }
  const failed = engine({ [key]: saved }, { discard: async () => { throw Error('Connection lost') } })
  await failed.run(); assert.ok(failed.read()[key].discardRequested); assert.equal(failed.read()[key].status, 'pending')
  assert.equal(failed.events.some(e => e.kind === 'discarded'), false)
  const retry = engine(failed.read()); await retry.run(); assert.deepEqual(retry.read(), {})
  assert.equal(retry.saves.length, 0); assert.equal(retry.calls.length, 0)
})

test('cancellation completes even when the workspace cannot load', async () => {
  const saved = { ...draft(), finalisation: null, discardRequested: true, status: 'pending' }
  const service = engine({ [key]: saved }, { workspace: async () => { throw Error('Workspace unavailable') } })
  await service.run()
  assert.deepEqual(service.read(), {})
  assert.equal(service.events[0].kind, 'discarded')
  assert.equal(service.discards[0].draftId, saved.id)
})

test('a failed initial local read emits scoped recovery and releases the sync lock', async () => {
  const saved = { ...draft(), finalisation: null, discardRequested: true, status: 'pending' }
  let failed = false
  const service = engine({ [key]: saved }, { beforeRead: async () => {
    if (!failed) { failed = true; throw Error('Storage read timed out') }
  } })
  await assert.rejects(service.run(), /Storage read timed out/)
  assert.deepEqual(service.read()[key], saved)
  assert.deepEqual(service.events.map(event => event.kind), ['sync_failed'])
  assert.equal(service.events[0].userId, user.id)
  assert.equal(service.events[0].contextId, context.id)
  await service.run()
  assert.deepEqual(service.read(), {})
  assert.equal(service.events.at(-1).kind, 'discarded')
})

test('a failed follow-up local read records failure without silently abandoning a queued record', async () => {
  let reads = 0
  const service = engine({ [key]: draft() }, { beforeRead: async () => {
    if (++reads === 2) throw Error('Follow-up read timed out')
  } })
  await service.run()
  assert.equal(service.calls.length, 0)
  assert.ok(service.read()[key].finalisation)
  assert.equal(service.events[0].kind, 'finalisation_failed')
  await service.run()
  assert.deepEqual(service.read(), {})
})

function cancellationRetry({ sync = async () => {}, readSaved = async () => ({}) } = {}) {
  const scope = 'authority', selectedKey = key, queueKey = `${scope}:${key}`
  const entry = { kind: 'discard', state: 'pending', draftId: 'cancelled-id' }
  const token = { active: true, scope, queued: { [queueKey]: entry }, load: () => { loads++ } }
  const lifetime = { current: token }
  let closed = queueKey, loads = 0
  const screen = read('apps/coach-mobile/src/CoachPhase31EScreens.js')
  const body = screen.slice(screen.indexOf('  const retryCancellation ='), screen.indexOf('  const selectPlayer ='))
  const deps = { lifetime, scope, selectedKey, selectedQueued: entry, user, context,
    setRetryingCancellation: () => {}, setQueued: change => { token.queued = change(token.queued) },
    setClosedEditor: change => { closed = change(closed) },
    syncCoachDevelopmentDrafts: sync, readCoachDevelopmentDrafts: readSaved }
  const run = new Function(...Object.keys(deps), `${body};return retryCancellation`)(...Object.values(deps))
  return { run, entry: () => token.queued[queueKey], closed: () => closed, loads: () => loads,
    replace: next => { token.queued[queueKey] = next }, leave: () => { token.active = false } }
}

test('actual cancellation retry reconciles durable removal when its completion event was missed', async () => {
  const retry = cancellationRetry()
  await retry.run()
  assert.equal(retry.entry().state, 'complete')
  assert.equal(retry.closed(), '')
  assert.equal(retry.loads(), 1)
})

test('actual cancellation retry never restores failed state over a completed event', async () => {
  let retry
  retry = cancellationRetry({ sync: async () => retry.replace({ ...retry.entry(), kind: 'discarded', state: 'complete' }),
    readSaved: async () => { throw Error('Late local read failure') } })
  await retry.run()
  assert.equal(retry.entry().state, 'complete')
  assert.equal(retry.entry().kind, 'discarded')
})

test('actual cancellation retry cannot overwrite a new queued assessment at the same selection', async () => {
  let retry
  const fresh = { kind: 'finalisation', state: 'pending', draftId: 'fresh-id' }
  retry = cancellationRetry({ sync: async () => retry.replace(fresh), readSaved: async () => { throw Error('Late failure') } })
  await retry.run()
  assert.deepEqual(retry.entry(), fresh)
})

test('actual cancellation retry treats a replacement local draft as fresh work and preserves it', async () => {
  const fresh = { id: 'fresh-id', values: { score: 9 } }
  const retry = cancellationRetry({ readSaved: async () => ({ [key]: fresh }) })
  await retry.run()
  assert.equal(retry.entry().state, 'complete')
  assert.equal(retry.closed(), '')
  assert.deepEqual(fresh.values, { score: 9 })
})

test('actual cancellation retry ignores a departed account scope', async () => {
  let retry
  retry = cancellationRetry({ sync: async () => retry.leave() })
  await retry.run()
  assert.equal(retry.entry().state, 'pending')
  assert.equal(retry.loads(), 0)
})
