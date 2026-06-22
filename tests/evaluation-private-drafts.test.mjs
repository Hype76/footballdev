import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  buildPrivateEvaluationDraftContext,
  chooseLatestPrivateEvaluationDraft,
  clearPrivateEvaluationDraft,
  closeServerEvaluationDraft,
  createPrivateEvaluationDraftPayload,
  findPrivateEvaluationDraft,
  findServerEvaluationDraft,
  getEvaluationDraftContextKey,
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

function createSupabaseDraftMock({ existingRow = null, insertRow = null, updateRow = null, errorByAction = {} } = {}) {
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
        is(column, value) {
          this.filters.push({ column, value, operator: 'is' })
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
            order: this.orderValue,
            payload: this.payload,
            table,
          })

          if (errorByAction[this.action]) {
            return { data: null, error: errorByAction[this.action] }
          }

          if (this.action === 'update') {
            return { data: updateRow || { ...existingRow, ...this.payload }, error: null }
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
            payload: this.payload,
            table,
          })

          const response = errorByAction[this.action]
            ? { data: null, error: errorByAction[this.action] }
            : { data: updateRow || { ...existingRow, ...this.payload }, error: null }

          return Promise.resolve(response).then(resolve, reject)
        },
        update(payload) {
          this.action = 'update'
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

test('server draft context key stays stable when player id becomes available', () => {
  const contextWithoutId = buildPrivateEvaluationDraftContext({
    formData: {
      playerName: 'Sam Trialist',
      section: 'Trial',
      session: '2026-06-20',
      team: 'U12',
    },
    user: staffUser,
  })
  const contextWithId = buildPrivateEvaluationDraftContext({
    formData: {
      playerId: 'player-1',
      playerName: 'Sam Trialist',
      section: 'Trial',
      session: '2026-06-20',
      team: 'U12',
    },
    user: staffUser,
  })

  assert.equal(getEvaluationDraftContextKey(contextWithId), getEvaluationDraftContextKey(contextWithoutId))
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
    selectedExportLabels: ['Technical', 'Comment'],
    selectedParentContactIndexes: [0, 1],
    savedAt: '2026-06-16T10:00:00.000Z',
  })

  assert.equal(payload.responseValues.technical, '8')
  assert.equal(payload.isPdfAttachmentApproved, true)
  assert.equal(payload.includeAttendanceSummary, false)
  assert.equal(payload.emailSendMode, 'scheduled')
  assert.equal(payload.scheduledEmailDateTime, '2026-06-20T18:30')
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
      { column: 'context_key', value: getEvaluationDraftContextKey(context) },
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
    ],
  )
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
    new URL('../supabase/migrations/20260616062006_20260616055708_private_assessment_drafts.sql', import.meta.url),
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
    new URL('../supabase/migrations/20260616091722_repair_evaluation_drafts_creator_rls.sql', import.meta.url),
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
    new URL('../supabase/migrations/20260616170649_allow_creator_evaluation_draft_lifecycle_select.sql', import.meta.url),
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

test('draft database failure UI does not claim the server draft was saved', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /title: 'Private draft save failed'/)
  assert.match(source, /setPrivateDraftStatus\('saved_local'\)/)
  assert.match(source, /setPrivateDraftStatus\('error'\)/)
  assert.match(source, /if \(localDraft\?\.id\) \{[\s\S]+setPrivateDraftStatus\('saved_local'\)/)
})

test('private draft autosave queues latest server save and retries failures', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /privateDraftQueueRef/)
  assert.match(source, /latestPrivateDraftSaveRef/)
  assert.match(source, /version < \(latestPrivateDraftSaveRef\.current\?\.version \|\| 0\)/)
  assert.match(source, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/)
})

test('private draft submit and discard paths flush or close the active draft safely', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /await flushPrivateDraftSave\(\{ reason: 'submit' \}\)/)
  assert.match(source, /const closeActivePrivateDraftAfterSubmit = async/)
  assert.match(source, /await privateDraftQueueRef\.current\.catch\(\(\) => \{\}\)/)
  assert.match(source, /status: PRIVATE_EVALUATION_DRAFT_STATUSES\.discarded/)
  assert.match(source, /status: PRIVATE_EVALUATION_DRAFT_STATUSES\.submitted/)
  assert.match(source, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(source, /document\.addEventListener\('click', handleInternalDraftNavigation, true\)/)
})

test('private draft close cancels pending autosaves and uses a stable close snapshot', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /const privateDraftSaveEpochRef = useRef\(0\)/)
  assert.match(source, /const beginPrivateDraftClose = \(\) => \{/)
  assert.match(source, /privateDraftSaveEpochRef\.current \+= 1/)
  assert.match(source, /latestPrivateDraftSaveRef\.current = null/)
  assert.match(source, /saveEpoch !== privateDraftSaveEpochRef\.current/)
  assert.match(source, /const closeSnapshot = beginPrivateDraftClose\(\)/)
  assert.match(source, /closeSnapshot\.draftInfo\.source === 'server'/)
  assert.match(source, /if \(!didCloseServerDraft\) \{/)
  assert.doesNotMatch(source, /latestPrivateDraftSaveRef\.current\?\.localDraft\?\.id \|\| privateDraftInfo\?\.localDraftId/)
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
  assert.match(source, /restoredPrivateDraftExportLabelsRef/)
  assert.match(source, /setPrivateDraftStatus\('restored'\)/)
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
    new URL('../supabase/migrations/20260616153836_repair_manual_review_eval_matchday.sql', import.meta.url),
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
    new URL('../supabase/migrations/20260616163613_harden_evaluation_draft_close_lifecycle.sql', import.meta.url),
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
    new URL('../supabase/migrations/20260616165423_allow_creator_evaluation_draft_close.sql', import.meta.url),
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
