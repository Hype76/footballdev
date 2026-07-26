import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  buildPrivateEvaluationDraftContext,
  canRecoverPrivateEvaluationDraft,
  canAutosavePrivateEvaluationDraft,
  chooseLatestPrivateEvaluationDraft,
  clearPrivateEvaluationDraft,
  closeServerEvaluationDraft,
  createPrivateEvaluationDraftRequestCoordinator,
  createPrivateEvaluationDraftPayload,
  findPrivateEvaluationDraft,
  findServerEvaluationDraft,
  getEvaluationDraftContextKey,
  getPrivateEvaluationDraftPayloadFingerprint,
  getPrivateEvaluationDraftRecoveryDelay,
  getPrivateEvaluationDraftRequestIdentity,
  isPrivateEvaluationDraftOffline,
  PRIVATE_EVALUATION_DRAFT_LIFECYCLE,
  PRIVATE_EVALUATION_DRAFT_STATUSES,
  savePrivateEvaluationDraft,
  saveServerEvaluationDraft,
} from '../src/lib/evaluation-drafts.js'

function createStorage() {
  const values = new Map()

  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
  }
}

const staffUser = {
  id: 'coach-1',
  email: 'coach@example.com',
  clubId: 'club-1',
  activeTeamId: 'team-1',
  activeTeamName: 'U12',
}

function createSupabaseDraftMock({
  existingRow = null,
  insertRow = null,
  updateCount = 1,
  updateRow = null,
  errorByAction = {},
} = {}) {
  const calls = []

  return {
    calls,
    from(table) {
      const builder = {
        action: 'select',
        filters: [],
        orderValue: null,
        limitValue: null,
        payload: null,
        table,
        eq(column, value) {
          this.filters.push({ column, value })
          return this
        },
        in(column, value) {
          this.filters.push({ column, value, operator: 'in' })
          return this
        },
        is(column, value) {
          this.filters.push({ column, value, operator: 'is' })
          return this
        },
        lt(column, value) {
          this.filters.push({ column, value, operator: 'lt' })
          return this
        },
        insert(payload) {
          this.action = 'insert'
          this.payload = payload
          return this
        },
        limit(value) {
          this.limitValue = value
          return this
        },
        maybeSingle() {
          calls.push({
            action: this.action,
            columns: this.columns,
            filters: this.filters,
            options: this.options,
            order: this.orderValue,
            payload: this.payload,
            table,
          })

          if (errorByAction[this.action]) {
            return { data: null, error: errorByAction[this.action] }
          }

          if (this.action === 'update') {
            return {
              count: updateCount,
              data: updateCount === 0 ? null : updateRow || { ...existingRow, ...this.payload },
              error: null,
            }
          }

          return { data: existingRow, error: null }
        },
        order(column, options) {
          this.orderValue = { column, options }
          return this
        },
        select(columns) {
          this.columns = columns
          return this
        },
        single() {
          calls.push({
            action: this.action,
            columns: this.columns,
            filters: this.filters,
            options: this.options,
            payload: this.payload,
            table,
          })

          if (errorByAction[this.action]) {
            return { data: null, error: errorByAction[this.action] }
          }

          return { data: insertRow || { id: 'draft-server-1', ...this.payload }, error: null }
        },
        then(resolve, reject) {
          calls.push({
            action: this.action,
            columns: this.columns,
            filters: this.filters,
            options: this.options,
            payload: this.payload,
            table,
          })

          const response = errorByAction[this.action]
            ? { data: null, error: errorByAction[this.action] }
            : {
                count: this.action === 'update' ? updateCount : undefined,
                data: this.action === 'update' && updateCount === 0
                  ? null
                  : updateRow || { ...existingRow, ...this.payload },
                error: null,
              }

          return Promise.resolve(response).then(resolve, reject)
        },
        update(payload, options) {
          this.action = 'update'
          this.options = options
          this.payload = payload
          return this
        },
      }

      return builder
    },
  }
}

test('private evaluation draft is restored only for the creator and club context', () => {
  const storage = createStorage()
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerName: 'Sam Trialist',
      section: 'Trial',
      session: '2026-06-20',
      team: 'U12',
    },
    user: staffUser,
  })
  const savedDraft = savePrivateEvaluationDraft({
    context,
    payload: {
      formData: { playerName: 'Sam Trialist' },
      responseValues: { technical: '4' },
    },
    storage,
    user: staffUser,
  })

  assert.ok(savedDraft?.id)
  assert.equal(findPrivateEvaluationDraft({ context, storage, user: staffUser })?.id, savedDraft.id)
  assert.equal(findPrivateEvaluationDraft({ context, storage, user: { ...staffUser, id: 'coach-2' } }), null)
  assert.equal(findPrivateEvaluationDraft({ context, storage, user: { ...staffUser, clubId: 'club-2' } }), null)
})

test('submitted and discarded private drafts fail closed on later restore', () => {
  const storage = createStorage()
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerName: 'Sam Trialist',
      team: 'U12',
    },
    user: staffUser,
  })
  const savedDraft = savePrivateEvaluationDraft({
    context,
    payload: {
      formData: { playerName: 'Sam Trialist' },
      responseValues: { physical: '5' },
    },
    storage,
    user: staffUser,
  })

  clearPrivateEvaluationDraft({
    draftId: savedDraft.id,
    status: PRIVATE_EVALUATION_DRAFT_STATUSES.submitted,
    storage,
    user: staffUser,
  })

  assert.equal(findPrivateEvaluationDraft({ context, storage, user: staffUser }), null)

  const nextDraft = savePrivateEvaluationDraft({
    context,
    payload: {
      formData: { playerName: 'Sam Trialist' },
      responseValues: { tactical: '3' },
    },
    storage,
    user: staffUser,
  })

  clearPrivateEvaluationDraft({
    draftId: nextDraft.id,
    status: PRIVATE_EVALUATION_DRAFT_STATUSES.discarded,
    storage,
    user: staffUser,
  })

  assert.equal(findPrivateEvaluationDraft({ context, storage, user: staffUser }), null)
})

test('saving a private draft preserves other active user drafts in the same browser', () => {
  const storage = createStorage()
  const otherUser = { ...staffUser, id: 'coach-2' }
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerName: 'Sam Trialist',
      team: 'U12',
    },
    user: staffUser,
  })
  const otherContext = buildPrivateEvaluationDraftContext({
    formData: {
      playerName: 'Alex Striker',
      team: 'U12',
    },
    user: otherUser,
  })

  const otherDraft = savePrivateEvaluationDraft({
    context: otherContext,
    payload: {
      formData: { playerName: 'Alex Striker' },
      responseValues: { technical: '3' },
    },
    storage,
    user: otherUser,
  })

  savePrivateEvaluationDraft({
    context,
    payload: {
      formData: { playerName: 'Sam Trialist' },
      responseValues: { technical: '4' },
    },
    storage,
    user: staffUser,
  })

  assert.equal(findPrivateEvaluationDraft({ context: otherContext, storage, user: otherUser })?.id, otherDraft.id)
})

test('server draft context identity uses canonical player and form while ignoring mutable date fields', () => {
  const firstContext = buildPrivateEvaluationDraftContext({
    formId: 'form-a',
    formVersion: 3,
    formData: {
      playerId: 'player-1',
      playerName: 'Sam Trialist',
      section: 'Trial',
      session: '2026-06-20',
      team: 'U12',
    },
    user: staffUser,
  })
  const laterDateContext = buildPrivateEvaluationDraftContext({
    formId: 'form-a',
    formVersion: 3,
    formData: {
      playerId: 'player-1',
      playerName: 'Sam Trialist',
      section: 'Trial',
      session: '2026-06-21',
      team: 'U12',
    },
    user: staffUser,
  })
  const otherFormContext = {
    ...laterDateContext,
    formId: 'form-b',
  }

  assert.equal(getEvaluationDraftContextKey(firstContext), getEvaluationDraftContextKey(laterDateContext))
  assert.notEqual(getEvaluationDraftContextKey(firstContext), getEvaluationDraftContextKey(otherFormContext))
})

test('private draft payload includes assessment, output, and delivery settings', () => {
  const payload = createPrivateEvaluationDraftPayload({
    archiveAfterNoPlace: true,
    emailSendMode: 'scheduled',
    emailTemplateKey: 'invite-back',
    formData: {
      playerName: 'Sam Trialist',
      session: '2026-06-20',
    },
    includeAttendanceSummary: false,
    inviteDate: '2026-06-27',
    isPdfAttachmentApproved: true,
    lastUsedSession: '2026-06-20',
    offlineDraftId: 'offline-1',
    previewMode: 'email',
    responseValues: {
      technical: '8',
      comment: 'Sharper first touch',
    },
    saveVersion: 7,
    scheduledEmailDateTime: '2026-06-20T18:30',
    selectedFeedbackFormId: '__default_development_form__',
    selectedExportLabels: ['Technical', 'Comment'],
    selectedParentContactIndexes: [0, 1],
    savedAt: '2026-06-16T10:00:00.000Z',
  })

  assert.equal(payload.responseValues.technical, '8')
  assert.equal(payload.isPdfAttachmentApproved, true)
  assert.equal(payload.includeAttendanceSummary, false)
  assert.equal(payload.emailSendMode, 'scheduled')
  assert.equal(payload.scheduledEmailDateTime, '2026-06-20T18:30')
  assert.equal(payload.selectedFeedbackFormId, '__default_development_form__')
  assert.deepEqual(payload.selectedExportLabels, ['Technical', 'Comment'])
  assert.equal(payload.archiveAfterNoPlace, true)
  assert.equal(payload.draftMeta.clientSaveVersion, 7)
  assert.equal(payload.draftMeta.clientSavedAt, '2026-06-16T10:00:00.000Z')
})

test('latest private draft selection prefers the newest safe local or server draft', () => {
  const olderServerDraft = {
    id: 'server-draft',
    lastSavedAt: '2026-06-16T09:00:00.000Z',
    payload: createPrivateEvaluationDraftPayload({
      formData: { playerName: 'Sam Trialist' },
      responseValues: { technical: '7' },
      saveVersion: 2,
      savedAt: '2026-06-16T09:00:00.000Z',
    }),
    source: 'server',
  }
  const newerLocalDraft = {
    id: 'local-draft',
    payload: createPrivateEvaluationDraftPayload({
      formData: { playerName: 'Sam Trialist' },
      responseValues: { technical: '9' },
      saveVersion: 3,
      savedAt: '2026-06-16T09:05:00.000Z',
    }),
    source: 'local',
    updatedAt: '2026-06-16T09:05:00.000Z',
  }

  assert.equal(chooseLatestPrivateEvaluationDraft([olderServerDraft, newerLocalDraft])?.id, 'local-draft')
})

test('server draft lookup is scoped to creator, club, report type, context, and draft status', async () => {
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerName: 'Sam Trialist',
      section: 'Trial',
      session: '2026-06-20',
      team: 'U12',
    },
    user: staffUser,
  })
  const supabaseClient = createSupabaseDraftMock({
    existingRow: {
      id: 'draft-server-1',
      club_id: 'club-1',
      created_by_user_id: 'coach-1',
      report_type: 'development_record',
      context_key: getEvaluationDraftContextKey(context),
      draft_data: { formData: { playerName: 'Sam Trialist' } },
      status: 'draft',
    },
  })

  const draft = await findServerEvaluationDraft({ context, supabaseClient, user: staffUser })

  assert.equal(draft.id, 'draft-server-1')
  assert.deepEqual(
    supabaseClient.calls[0].filters,
    [
      { column: 'club_id', value: 'club-1' },
      { column: 'created_by_user_id', value: 'coach-1' },
      { column: 'report_type', value: 'development_record' },
      {
        column: 'context_key',
        value: [
          getEvaluationDraftContextKey(context),
          'development_record:team-1:sam_trialist:Trial:2026-06-20:new',
        ],
        operator: 'in',
      },
      { column: 'status', value: 'draft' },
    ],
  )
})

test('server draft save writes only creator-owned private draft rows', async () => {
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerId: 'player-1',
      playerName: 'Sam Trialist',
      section: 'Trial',
      session: '2026-06-20',
      team: 'U12',
    },
    user: staffUser,
  })
  const supabaseClient = createSupabaseDraftMock()

  const draft = await saveServerEvaluationDraft({
    context,
    payload: {
      formData: { playerName: 'Sam Trialist' },
      responseValues: { technical: '4' },
    },
    supabaseClient,
    user: staffUser,
  })
  const insertCall = supabaseClient.calls.find((call) => call.action === 'insert')

  assert.equal(draft.id, 'draft-server-1')
  assert.equal(insertCall.payload.club_id, 'club-1')
  assert.equal(insertCall.payload.created_by_user_id, 'coach-1')
  assert.equal(insertCall.payload.status, 'draft')
  assert.equal(insertCall.payload.context_key, getEvaluationDraftContextKey(context))
  assert.equal(insertCall.payload.draft_data.formData.playerName, 'Sam Trialist')
})

test('server draft save updates an existing creator draft instead of inserting another row', async () => {
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerId: 'player-1',
      playerName: 'Sam Trialist',
      team: 'U12',
    },
    user: staffUser,
  })
  const supabaseClient = createSupabaseDraftMock({
    existingRow: {
      id: 'draft-server-1',
      club_id: 'club-1',
      created_by_user_id: 'coach-1',
      status: 'draft',
    },
  })

  await saveServerEvaluationDraft({
    context,
    existingDraftId: 'draft-server-1',
    payload: {
      formData: { playerName: 'Sam Trialist' },
      responseValues: { tactical: '7' },
    },
    supabaseClient,
    user: staffUser,
  })

  const updateCall = supabaseClient.calls.find((call) => call.action === 'update')
  assert.ok(updateCall)
  assert.equal(supabaseClient.calls.some((call) => call.action === 'insert'), false)
  assert.deepEqual(
    updateCall.filters,
    [
      { column: 'id', value: 'draft-server-1' },
      { column: 'created_by_user_id', value: 'coach-1' },
      { column: 'status', value: 'draft' },
      { column: 'client_save_version', value: 1, operator: 'lt' },
    ],
  )
  assert.deepEqual(updateCall.options, { count: 'exact' })
  assert.equal(updateCall.payload.status, 'draft')
})

test('server draft close updates only the creator active draft row', async () => {
  const supabaseClient = createSupabaseDraftMock({
    existingRow: {
      id: 'draft-server-1',
      club_id: 'club-1',
      team_id: 'team-1',
      player_id: 'player-1',
      created_by_user_id: 'coach-1',
      status: 'draft',
    },
  })

  assert.equal(
    await closeServerEvaluationDraft({
      draftId: 'draft-server-1',
      status: PRIVATE_EVALUATION_DRAFT_STATUSES.submitted,
      supabaseClient,
      user: staffUser,
    }),
    true,
  )

  assert.equal(supabaseClient.calls[0].action, 'select')
  assert.equal(supabaseClient.calls[0].columns, 'id, club_id, team_id, player_id, created_by_user_id, status')
  assert.deepEqual(
    supabaseClient.calls[0].filters,
    [
      { column: 'id', value: 'draft-server-1' },
      { column: 'created_by_user_id', value: 'coach-1' },
      { column: 'status', value: 'draft' },
    ],
  )
  assert.equal(supabaseClient.calls[1].action, 'update')
  assert.equal(supabaseClient.calls[1].columns, undefined)
  assert.deepEqual(
    supabaseClient.calls[1].filters,
    [
      { column: 'id', value: 'draft-server-1' },
      { column: 'created_by_user_id', value: 'coach-1' },
      { column: 'status', value: 'draft' },
      { column: 'club_id', value: 'club-1' },
      { column: 'team_id', value: 'team-1' },
      { column: 'player_id', value: 'player-1' },
    ],
  )
  assert.equal(supabaseClient.calls[1].payload.status, 'submitted')
  assert.ok(supabaseClient.calls[1].payload.submitted_at)
  assert.equal(supabaseClient.calls.some((call) => call.action === 'insert'), false)
})

test('server draft discard updates the active creator row without an insert path', async () => {
  const supabaseClient = createSupabaseDraftMock({
    existingRow: {
      id: 'draft-server-1',
      club_id: 'club-1',
      team_id: null,
      player_id: null,
      created_by_user_id: 'coach-1',
      status: 'draft',
    },
  })

  assert.equal(
    await closeServerEvaluationDraft({
      draftId: 'draft-server-1',
      status: PRIVATE_EVALUATION_DRAFT_STATUSES.discarded,
      supabaseClient,
      user: staffUser,
    }),
    true,
  )

  assert.equal(supabaseClient.calls.length, 2)
  assert.equal(supabaseClient.calls[1].action, 'update')
  assert.deepEqual(
    supabaseClient.calls[1].filters,
    [
      { column: 'id', value: 'draft-server-1' },
      { column: 'created_by_user_id', value: 'coach-1' },
      { column: 'status', value: 'draft' },
      { column: 'club_id', value: 'club-1' },
      { column: 'team_id', value: null, operator: 'is' },
      { column: 'player_id', value: null, operator: 'is' },
    ],
  )
  assert.equal(supabaseClient.calls[1].payload.status, 'discarded')
  assert.ok(supabaseClient.calls[1].payload.discarded_at)
  assert.equal(supabaseClient.calls[1].columns, undefined)
  assert.equal(supabaseClient.calls.some((call) => call.action === 'insert'), false)
})

test('server draft close with a stale draft id fails gracefully without inserting', async () => {
  const supabaseClient = createSupabaseDraftMock()

  assert.equal(
    await closeServerEvaluationDraft({
      draftId: 'stale-draft-server-1',
      status: PRIVATE_EVALUATION_DRAFT_STATUSES.discarded,
      supabaseClient,
      user: staffUser,
    }),
    false,
  )

  assert.equal(supabaseClient.calls.length, 1)
  assert.equal(supabaseClient.calls[0].action, 'select')
  assert.equal(supabaseClient.calls.some((call) => call.action === 'update'), false)
  assert.equal(supabaseClient.calls.some((call) => call.action === 'insert'), false)
})

test('server draft helpers fail closed when the migration has not been applied', async () => {
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerName: 'Sam Trialist',
      team: 'U12',
    },
    user: staffUser,
  })
  const supabaseClient = createSupabaseDraftMock({
    errorByAction: {
      select: {
        code: '42P01',
        message: 'relation "public.evaluation_drafts" does not exist',
      },
    },
  })

  assert.equal(await findServerEvaluationDraft({ context, supabaseClient, user: staffUser }), null)
})

test('private assessment draft migration is additive and creator scoped', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260616062006_20260616055708_private_assessment_drafts.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /create table if not exists public\.evaluation_drafts/)
  assert.match(migration, /alter table public\.evaluation_drafts enable row level security/)
  assert.match(migration, /created_by_user_id = auth\.uid\(\)/)
  assert.match(migration, /status = 'draft'/)
  assert.match(migration, /player\.club_id = evaluation_drafts\.club_id/)
  assert.match(migration, /team\.club_id = evaluation_drafts\.club_id/)
  assert.doesNotMatch(migration, /\b(drop table|drop column|truncate|delete from)\b/i)
})

test('private assessment draft RLS repair keeps drafts creator-only and parent-denied', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260616091722_repair_evaluation_drafts_creator_rls.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /created_by_user_id = auth\.uid\(\)/)
  assert.match(migration, /status = 'draft'/)
  assert.match(migration, /status in \('draft', 'submitted', 'discarded'\)/)
  assert.match(migration, /public\.current_user_role\(\) <> 'parent_portal'/)
  assert.match(migration, /public\.current_user_role_rank\(\) >= 20/)
  assert.match(migration, /team\.club_id = evaluation_drafts\.club_id/)
  assert.match(migration, /player\.club_id = evaluation_drafts\.club_id/)
  assert.doesNotMatch(migration, /join public\.team_staff/i)
  assert.doesNotMatch(migration, /\b(drop table|drop column|truncate|delete from)\b/i)
})

test('draft lifecycle select policy allows creator close status transition only', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260616170649_allow_creator_evaluation_draft_lifecycle_select.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /drop policy if exists evaluation_drafts_select_own_active/)
  assert.match(migration, /for select/)
  assert.match(migration, /created_by_user_id = auth\.uid\(\)/)
  assert.match(migration, /status in \('draft', 'submitted', 'discarded'\)/)
  assert.match(migration, /club_id = public\.current_user_club_id\(\)/)
  assert.match(migration, /public\.current_user_role\(\) <> 'parent_portal'/)
  assert.match(migration, /public\.current_user_role_rank\(\) >= 20/)
  assert.doesNotMatch(migration, /\b(drop table|drop column|truncate|delete from)\b/i)
  assert.doesNotMatch(migration, /or true/i)
})

test('draft revision migration is additive and does not change access policy', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260726071421_development_draft_refresh_race_recovery_28.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /add column if not exists client_save_version bigint not null default 0/)
  assert.match(migration, /check \(client_save_version >= 0\)/)
  assert.doesNotMatch(migration, /\b(drop table|drop column|truncate|delete from)\b/i)
  assert.doesNotMatch(migration, /\b(create policy|drop policy|grant|revoke)\b/i)
})

test('draft lifecycle exposes truthful persistent, failed, offline, and retry states', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.deepEqual(Object.values(PRIVATE_EVALUATION_DRAFT_LIFECYCLE), [
    'initialising',
    'loading_existing_draft',
    'hydrated',
    'dirty',
    'saving',
    'saved',
    'save_failed',
    'offline',
    'retrying',
    'submitting',
    'submitted',
    'discarding',
    'discarded',
  ])
  assert.match(source, /title: 'Loading draft\.\.\.'/)
  assert.match(source, /title: 'Saving draft\.\.\.'/)
  assert.match(source, /title: 'Draft could not be saved'/)
  assert.match(source, /title: 'Working offline'/)
  assert.match(source, /title: 'Retrying\.\.\.'/)
  assert.match(source, /setPrivateDraftLifecycle\(PRIVATE_EVALUATION_DRAFT_LIFECYCLE\.saved\)/)
  assert.doesNotMatch(source, /setPrivateDraftStatus\('saved_local'\)/)
})

test('private draft autosave detects offline state before queueing one recoverable server save', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )
  const flushStart = source.indexOf('const flushPrivateDraftSave')
  const flushEnd = source.indexOf('useEffect(() => {', flushStart)
  const flushSource = source.slice(flushStart, flushEnd)
  const onlineHandlerStart = source.indexOf('const handleOnline = () => {')
  const onlineHandlerEnd = source.indexOf('const handleOffline = () => {', onlineHandlerStart)
  const onlineHandlerSource = source.slice(onlineHandlerStart, onlineHandlerEnd)

  assert.match(source, /privateDraftQueueRef/)
  assert.match(source, /latestPrivateDraftSaveRef/)
  assert.match(source, /privateDraftRequestCoordinatorRef\.current\.isCurrent\(request\)/)
  assert.match(source, /privateDraftHydrationBaselineFingerprintRef/)
  assert.ok(flushSource.indexOf('isPrivateEvaluationDraftOffline()') > -1)
  assert.ok(flushSource.indexOf('isPrivateEvaluationDraftOffline()') < flushSource.indexOf('enqueueServerDraftSave(currentSave)'))
  assert.doesNotMatch(source, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/)
  assert.match(source, /window\.addEventListener\('online', handleOnline\)/)
  assert.match(source, /window\.addEventListener\('offline', handleOffline\)/)
  assert.match(source, /privateDraftRecoveryInFlightRef/)
  assert.match(source, /getPrivateEvaluationDraftRecoveryDelay\(\{ attempt \}\)/)
  assert.equal(
    onlineHandlerSource.match(/flushPrivateDraftSave\(/g)?.length,
    1,
  )
  assert.match(onlineHandlerSource, /recoveryInFlight: privateDraftRecoveryInFlightRef\.current/)
  assert.match(onlineHandlerSource, /reason: 'online-retry'/)
})

test('offline detection and recovery gate permit one newest-revision recovery only', () => {
  assert.equal(isPrivateEvaluationDraftOffline({ onLine: false }), true)
  assert.equal(isPrivateEvaluationDraftOffline({ onLine: true }), false)
  assert.equal(
    canRecoverPrivateEvaluationDraft({
      hasPendingRevision: true,
      lifecycle: PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
      online: true,
      recoveryInFlight: false,
    }),
    true,
  )
  assert.equal(
    canRecoverPrivateEvaluationDraft({
      hasPendingRevision: true,
      lifecycle: PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
      online: true,
      recoveryInFlight: true,
    }),
    false,
  )
  assert.equal(
    canRecoverPrivateEvaluationDraft({
      hasPendingRevision: false,
      lifecycle: PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
      online: true,
      recoveryInFlight: false,
    }),
    false,
  )
})

test('failed recovery uses controlled backoff instead of rapid request churn', () => {
  assert.equal(getPrivateEvaluationDraftRecoveryDelay({ attempt: 1 }), 30_000)
  assert.equal(getPrivateEvaluationDraftRecoveryDelay({ attempt: 2 }), 60_000)
  assert.equal(getPrivateEvaluationDraftRecoveryDelay({ attempt: 3 }), 120_000)
  assert.equal(getPrivateEvaluationDraftRecoveryDelay({ attempt: 8 }), 120_000)
})

test('private draft submit and discard paths flush or close the active draft safely', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /await flushPrivateDraftSave\(\{ reason: 'submit' \}\)/)
  assert.match(source, /const closeActivePrivateDraftAfterSubmit = async/)
  assert.match(source, /await privateDraftQueueRef\.current\.catch\(\(\) => \{\}\)/)
  assert.match(source, /closeServerDraftForSnapshot\(closeSnapshot, PRIVATE_EVALUATION_DRAFT_STATUSES\.discarded\)/)
  assert.match(source, /closeServerDraftForSnapshot\(closeSnapshot, PRIVATE_EVALUATION_DRAFT_STATUSES\.submitted\)/)
  assert.match(source, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(source, /document\.addEventListener\('click', handleInternalDraftNavigation, true\)/)
})

test('private draft close cancels pending autosaves and uses a stable close snapshot', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /createPrivateEvaluationDraftRequestCoordinator\(\)/)
  assert.match(source, /const beginPrivateDraftClose = \(\) => \{/)
  assert.match(source, /privateDraftRequestCoordinatorRef\.current\.invalidate\(\)/)
  assert.match(source, /latestPrivateDraftSaveRef\.current = null/)
  assert.match(source, /const closeSnapshot = beginPrivateDraftClose\(\)/)
  assert.match(source, /const closeServerDraftForSnapshot = async/)
  assert.match(source, /await findServerEvaluationDraft\(/)
  assert.match(source, /const clearLocalDraftsForSnapshot =/)
})

test('private draft banner exposes resume and discard actions', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /handleResumePrivateDraft/)
  assert.match(source, /Resume draft/)
  assert.match(source, /Discard draft/)
  assert.match(source, /chooseLatestPrivateEvaluationDraft\(/)
  assert.match(source, /findServerEvaluationDraft\([\s\S]+context: draftContext[\s\S]+user/)
  assert.match(source, /findPrivateEvaluationDraft\([\s\S]+context: draftContext[\s\S]+user/)
})

test('private draft resume restores saved payload values', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /const restorePrivateDraftPayload = useCallback/)
  assert.match(source, /setFormData\(createInitialFormData\(user, \{[\s\S]+restoredFormData/)
  assert.match(source, /setResponseValues\(payload\.responseValues/)
  assert.match(source, /setSelectedFeedbackFormId\(String\(payload\.selectedFeedbackFormId/)
  assert.match(source, /restoredPrivateDraftExportLabelsRef/)
  assert.match(source, /privateDraftHydrationExpectedFingerprintRef\.current = getPrivateEvaluationDraftPayloadFingerprint\(payload\)/)
})

test('refresh hydration blocks blank autosave until dependencies resolve and establishes a clean baseline', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /!privateDraftHydrationReadyRef\.current/)
  assert.match(source, /isLoadingTeams \|\|[\s\S]*isLoadingPlayers \|\|[\s\S]*isLoadingFields \|\|[\s\S]*isLoadingFeedbackForms/)
  assert.match(source, /privateDraftHydrationBaselineFingerprintRef\.current =[\s\S]*getPrivateEvaluationDraftPayloadFingerprint\(payload\)/)
  assert.match(source, /privateDraftHydrationReadyRef\.current = true/)
  assert.match(source, /selectedFeedbackFormId &&[\s\S]*!isDefaultFeedbackFormSelected &&[\s\S]*!selectedFeedbackForm/)
  assert.doesNotMatch(source, /!hasInitializedRef\.current \|\| !draftStorageKey/)
})

test('delayed refresh hydration never makes the blank controlled snapshot eligible to save', () => {
  const populatedDraft = {
    formData: {
      playerName: 'FP TEST Player',
      session: '2026-07-26',
      team: 'FP TEST Team',
    },
    responseValues: {
      technical: 'Populated persistent answer',
    },
    selectedFeedbackFormId: 'form-a',
  }
  const blankControlledSnapshot = {
    formData: {
      playerName: '',
      session: '',
      team: '',
    },
    responseValues: {},
    selectedFeedbackFormId: '',
  }
  const blankFingerprint = getPrivateEvaluationDraftPayloadFingerprint(blankControlledSnapshot)
  const populatedFingerprint = getPrivateEvaluationDraftPayloadFingerprint(populatedDraft)

  assert.equal(
    canAutosavePrivateEvaluationDraft({
      baselineFingerprint: '',
      dependenciesResolved: false,
      fingerprint: blankFingerprint,
      hasContent: true,
      hydrationReady: false,
      lifecycle: PRIVATE_EVALUATION_DRAFT_LIFECYCLE.loadingExistingDraft,
    }),
    false,
  )
  assert.equal(
    canAutosavePrivateEvaluationDraft({
      baselineFingerprint: populatedFingerprint,
      dependenciesResolved: true,
      fingerprint: populatedFingerprint,
      hasContent: true,
      hydrationReady: true,
      lifecycle: PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated,
    }),
    false,
  )
  assert.equal(
    canAutosavePrivateEvaluationDraft({
      baselineFingerprint: populatedFingerprint,
      dependenciesResolved: true,
      fingerprint: getPrivateEvaluationDraftPayloadFingerprint({
        ...populatedDraft,
        responseValues: { technical: 'Newest user answer' },
      }),
      hasContent: true,
      hydrationReady: true,
      lifecycle: PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated,
    }),
    true,
  )
})

test('request coordinator rejects out-of-order, navigation, and form-change responses', () => {
  const coordinator = createPrivateEvaluationDraftRequestCoordinator()
  const playerAFormA = 'club:actor:team:player-a:form-a:1:new'
  const playerAFormB = 'club:actor:team:player-a:form-b:1:new'
  const playerBFormA = 'club:actor:team:player-b:form-a:1:new'

  coordinator.beginContext(playerAFormA, 7)
  const revision8 = coordinator.nextRequest(playerAFormA)
  const revision9 = coordinator.nextRequest(playerAFormA)

  assert.equal(revision8.revision, 8)
  assert.equal(revision9.revision, 9)
  assert.equal(coordinator.isCurrent(revision8), false)
  assert.equal(coordinator.isCurrent(revision9), true)

  const formBRevision = coordinator.nextRequest(playerAFormB)
  assert.equal(formBRevision.revision, 10)
  assert.equal(coordinator.isCurrent(revision9), false)
  assert.equal(coordinator.isCurrent(formBRevision), true)

  const playerBRevision = coordinator.nextRequest(playerBFormA)
  assert.equal(playerBRevision.revision, 11)
  assert.equal(coordinator.isCurrent(formBRevision), false)
  assert.equal(coordinator.isCurrent(playerBRevision), true)

  coordinator.invalidate()
  assert.equal(coordinator.isCurrent(playerBRevision), false)
})

test('draft fingerprint ignores revision metadata but distinguishes hydrated answers from blank state', () => {
  const populated = {
    draftMeta: { clientSaveVersion: 9, clientSavedAt: '2026-07-26T10:00:00.000Z' },
    formData: { playerName: 'FP TEST Player', session: '2026-07-26' },
    responseValues: { technical: 'Distinctive hydrated answer' },
    selectedFeedbackFormId: 'form-a',
  }
  const newerSameValues = {
    ...populated,
    draftMeta: { clientSaveVersion: 10, clientSavedAt: '2026-07-26T10:01:00.000Z' },
  }
  const blank = {
    ...populated,
    responseValues: {},
  }

  assert.equal(
    getPrivateEvaluationDraftPayloadFingerprint(populated),
    getPrivateEvaluationDraftPayloadFingerprint(newerSameValues),
  )
  assert.notEqual(
    getPrivateEvaluationDraftPayloadFingerprint(populated),
    getPrivateEvaluationDraftPayloadFingerprint(blank),
  )
})

test('draft request identity separates players and forms while remaining stable for answer edits', () => {
  const context = buildPrivateEvaluationDraftContext({
    formId: 'form-a',
    formVersion: 2,
    formData: {
      playerId: 'player-a',
      playerName: 'FP TEST Player A',
      team: 'FP TEST Team',
    },
    user: staffUser,
  })
  const identity = getPrivateEvaluationDraftRequestIdentity({
    context,
    payload: { responseValues: { technical: '5' }, selectedFeedbackFormId: 'form-a' },
  })

  assert.equal(
    identity,
    getPrivateEvaluationDraftRequestIdentity({
      context,
      payload: { responseValues: { technical: '9' }, selectedFeedbackFormId: 'form-a' },
    }),
  )
  assert.notEqual(
    identity,
    getPrivateEvaluationDraftRequestIdentity({
      context: { ...context, playerId: 'player-b' },
      payload: { selectedFeedbackFormId: 'form-a' },
    }),
  )
  assert.notEqual(
    identity,
    getPrivateEvaluationDraftRequestIdentity({
      context: { ...context, formId: 'form-b' },
      payload: { selectedFeedbackFormId: 'form-b' },
    }),
  )
})

test('multiple offline edits replace one scoped local draft with only the newest revision', () => {
  const storage = createStorage()
  const context = buildPrivateEvaluationDraftContext({
    formId: 'form-a',
    formVersion: 2,
    formData: {
      playerId: 'player-a',
      playerName: 'FP TEST Player A',
      team: 'FP TEST Team',
      teamId: 'team-1',
    },
    user: staffUser,
  })
  const revisionOne = savePrivateEvaluationDraft({
    context,
    payload: createPrivateEvaluationDraftPayload({
      formData: {
        playerId: 'player-a',
        playerName: 'FP TEST Player A',
        team: 'FP TEST Team',
        teamId: 'team-1',
      },
      responseValues: { technical: 'Offline revision one' },
      saveVersion: 11,
      selectedFeedbackFormId: 'form-a',
    }),
    storage,
    user: staffUser,
  })
  const revisionTwo = savePrivateEvaluationDraft({
    context,
    existingDraftId: revisionOne.id,
    payload: createPrivateEvaluationDraftPayload({
      formData: {
        playerId: 'player-a',
        playerName: 'FP TEST Player A',
        team: 'FP TEST Team',
        teamId: 'team-1',
      },
      responseValues: { technical: 'Newest offline revision' },
      saveVersion: 12,
      selectedFeedbackFormId: 'form-a',
    }),
    storage,
    user: staffUser,
  })
  const restored = findPrivateEvaluationDraft({
    context,
    storage,
    user: staffUser,
  })

  assert.equal(revisionTwo.id, revisionOne.id)
  assert.equal(restored.payload.draftMeta.clientSaveVersion, 12)
  assert.equal(restored.payload.responseValues.technical, 'Newest offline revision')
})

test('offline draft scope prevents player, form, team, club, and user leakage', () => {
  const storage = createStorage()
  const context = buildPrivateEvaluationDraftContext({
    formId: 'form-a',
    formVersion: 2,
    formData: {
      playerId: 'player-a',
      playerName: 'FP TEST Player A',
      team: 'FP TEST Team',
      teamId: 'team-1',
    },
    user: staffUser,
  })

  savePrivateEvaluationDraft({
    context,
    payload: createPrivateEvaluationDraftPayload({
      formData: {
        playerId: 'player-a',
        playerName: 'FP TEST Player A',
        team: 'FP TEST Team',
        teamId: 'team-1',
      },
      responseValues: { technical: 'Private offline answer' },
      saveVersion: 3,
      selectedFeedbackFormId: 'form-a',
    }),
    storage,
    user: staffUser,
  })

  assert.equal(findPrivateEvaluationDraft({
    context: { ...context, playerId: 'player-b', playerName: 'FP TEST Player B' },
    storage,
    user: staffUser,
  }), null)
  assert.equal(findPrivateEvaluationDraft({
    context: { ...context, formId: 'form-b' },
    storage,
    user: staffUser,
  }), null)
  assert.equal(findPrivateEvaluationDraft({
    context: { ...context, teamId: 'team-2', teamName: 'FP TEST Team 2' },
    storage,
    user: { ...staffUser, activeTeamId: 'team-2', activeTeamName: 'FP TEST Team 2' },
  }), null)
  assert.equal(findPrivateEvaluationDraft({
    context: { ...context, clubId: 'club-2' },
    storage,
    user: { ...staffUser, clubId: 'club-2' },
  }), null)
  assert.equal(findPrivateEvaluationDraft({
    context,
    storage,
    user: { ...staffUser, id: 'coach-2', email: 'coach-2@example.com' },
  }), null)
})

test('zero-row draft update is not reported as persistence success', async () => {
  const context = buildPrivateEvaluationDraftContext({
    formId: 'form-a',
    formVersion: 1,
    formData: {
      playerId: 'player-a',
      playerName: 'FP TEST Player A',
      team: 'FP TEST Team',
    },
    user: staffUser,
  })
  const supabaseClient = createSupabaseDraftMock({ updateCount: 0 })

  await assert.rejects(
    saveServerEvaluationDraft({
      context,
      existingDraftId: 'draft-server-1',
      payload: createPrivateEvaluationDraftPayload({
        formData: { playerName: 'FP TEST Player A' },
        responseValues: { technical: '9' },
        saveVersion: 4,
      }),
      supabaseClient,
      user: staffUser,
    }),
    (error) => error?.code === 'DRAFT_WRITE_ZERO_ROWS',
  )
})

test('older server revision cannot replace a newer populated draft', async () => {
  const context = buildPrivateEvaluationDraftContext({
    formId: 'form-a',
    formVersion: 1,
    formData: {
      playerId: 'player-a',
      playerName: 'FP TEST Player A',
      team: 'FP TEST Team',
    },
    user: staffUser,
  })
  const newerPayload = createPrivateEvaluationDraftPayload({
    formData: { playerName: 'FP TEST Player A' },
    responseValues: { technical: 'Newest populated answer' },
    saveVersion: 2,
  })
  const supabaseClient = createSupabaseDraftMock({
    existingRow: {
      id: 'draft-server-1',
      client_save_version: 2,
      club_id: staffUser.clubId,
      created_by_user_id: staffUser.id,
      draft_data: newerPayload,
      status: 'draft',
    },
    updateCount: 0,
  })

  const result = await saveServerEvaluationDraft({
    context,
    existingDraftId: 'draft-server-1',
    payload: createPrivateEvaluationDraftPayload({
      formData: { playerName: 'FP TEST Player A' },
      responseValues: {},
      saveVersion: 1,
    }),
    supabaseClient,
    user: staffUser,
  })

  assert.equal(result.staleWrite, true)
  assert.equal(result.clientSaveVersion, 2)
  assert.equal(result.payload.responseValues.technical, 'Newest populated answer')
  assert.equal(supabaseClient.calls.some((call) => call.action === 'insert'), false)
})

test('duplicate final submit is guarded before a second save starts', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /const submitLockRef = useRef\(false\)/)
  assert.match(source, /if \(submitLockRef\.current\) \{\s*return\s*\}/)
  assert.match(source, /submitLockRef\.current = true/)
  assert.match(source, /submitLockRef\.current = false/)
  assert.match(source, /getDevelopmentRecordCompletionCopy\(/)
})

test('development record form selector requires an explicit default or saved form choice', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /const DEFAULT_FEEDBACK_FORM_ID = '__default_development_form__'/)
  assert.match(source, /<option value=\{DEFAULT_FEEDBACK_FORM_ID\}>Default development form<\/option>/)
  assert.match(source, /if \(!editingEvaluation && !hasFeedbackFormSelection\)/)
  assert.match(source, /Choose the default development form or a saved feedback form/)
  assert.doesNotMatch(source, /feedbackForms\.length > 0 && !selectedFeedbackForm/)
})

test('unclear football detail readiness card is removed', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /label="Football detail"/)
  assert.doesNotMatch(source, /Nothing has been recorded yet\./)
})

test('manual review RLS repair keeps drafts creator-only while allowing same-club player context', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260616153836_repair_manual_review_eval_matchday.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /created_by_user_id = auth\.uid\(\)/)
  assert.match(migration, /public\.current_user_role\(\) <> 'parent_portal'/)
  assert.match(migration, /public\.current_user_role_rank\(\) >= 20/)
  assert.match(migration, /team\.club_id = evaluation_drafts\.club_id/)
  assert.match(migration, /player\.club_id = evaluation_drafts\.club_id/)
  assert.doesNotMatch(migration, /player\.team_id = evaluation_drafts\.team_id/)
  assert.doesNotMatch(migration, /\b(drop table|drop column|truncate|delete from)\b/i)
})

test('draft close lifecycle RLS permits creator close without weakening draft saves', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260616163613_harden_evaluation_draft_close_lifecycle.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /created_by_user_id = auth\.uid\(\)/)
  assert.match(migration, /status = 'draft'/)
  assert.match(migration, /status in \('submitted', 'discarded'\)/)
  assert.match(migration, /public\.current_user_role\(\) <> 'parent_portal'/)
  assert.match(migration, /public\.current_user_role_rank\(\) >= 20/)
  assert.match(migration, /team\.club_id = evaluation_drafts\.club_id/)
  assert.match(migration, /player\.club_id = evaluation_drafts\.club_id/)
  assert.match(migration, /revoke delete, truncate, references, trigger on public\.evaluation_drafts from authenticated;/i)
  assert.match(migration, /revoke all on public\.evaluation_drafts from anon;/i)
  assert.match(migration, /grant select, insert, update on public\.evaluation_drafts to authenticated;/i)
  assert.match(migration, /grant select, insert, update, delete on public\.evaluation_drafts to service_role;/i)
  const migrationWithoutSafeRevokes = migration.replace(
    /revoke delete, truncate, references, trigger on public\.evaluation_drafts from authenticated;/i,
    '',
  )
  assert.doesNotMatch(migrationWithoutSafeRevokes, /\b(drop table|drop column|truncate|delete from)\b/i)
})

test('draft close follow-up keeps creator-only close separate from active draft edits', () => {
  const migration = readFileSync(
    migrationSourceUrl('20260616165423_allow_creator_evaluation_draft_close.sql', 'active'),
    'utf8',
  )

  assert.match(migration, /create policy evaluation_drafts_close_own_active/)
  assert.match(migration, /for update/)
  assert.match(migration, /created_by_user_id = auth\.uid\(\)/)
  assert.match(migration, /status = 'draft'/)
  assert.match(migration, /status in \('submitted', 'discarded'\)/)
  assert.match(migration, /club_id = public\.current_user_club_id\(\)/)
  assert.match(migration, /public\.current_user_role\(\) <> 'parent_portal'/)
  assert.doesNotMatch(migration, /current_user_role_rank\(\) >= 20/)
  assert.doesNotMatch(migration, /\b(drop table|drop column|truncate|delete from)\b/i)
})

test('server draft close does not request a returned row after changing status', () => {
  const source = readFileSync(
    new URL('../src/lib/evaluation-drafts.js', import.meta.url),
    'utf8',
  )
  const closeSource = source.slice(source.indexOf('export async function closeServerEvaluationDraft'))

  assert.match(closeSource, /\.update\(\{[\s\S]+status: closingStatus/)
  assert.doesNotMatch(closeSource, /\.update\(\{[\s\S]+?\.select\('id'\)/)
})
