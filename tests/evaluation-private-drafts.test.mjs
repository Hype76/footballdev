import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  buildPrivateEvaluationDraftContext,
  clearPrivateEvaluationDraft,
  closeServerEvaluationDraft,
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
  const supabaseClient = createSupabaseDraftMock()

  assert.equal(
    await closeServerEvaluationDraft({
      draftId: 'draft-server-1',
      status: PRIVATE_EVALUATION_DRAFT_STATUSES.submitted,
      supabaseClient,
      user: staffUser,
    }),
    true,
  )

  assert.deepEqual(
    supabaseClient.calls[0].filters,
    [
      { column: 'id', value: 'draft-server-1' },
      { column: 'created_by_user_id', value: 'coach-1' },
      { column: 'status', value: 'draft' },
    ],
  )
  assert.equal(supabaseClient.calls[0].payload.status, 'submitted')
  assert.ok(supabaseClient.calls[0].payload.submitted_at)
})

test('server draft discard updates the active creator row without an insert path', async () => {
  const supabaseClient = createSupabaseDraftMock()

  assert.equal(
    await closeServerEvaluationDraft({
      draftId: 'draft-server-1',
      status: PRIVATE_EVALUATION_DRAFT_STATUSES.discarded,
      supabaseClient,
      user: staffUser,
    }),
    true,
  )

  assert.equal(supabaseClient.calls.length, 1)
  assert.equal(supabaseClient.calls[0].action, 'update')
  assert.equal(supabaseClient.calls[0].payload.status, 'discarded')
  assert.ok(supabaseClient.calls[0].payload.discarded_at)
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
    new URL('../supabase/migrations/20260616055708_private_assessment_drafts.sql', import.meta.url),
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
    new URL('../supabase/migrations/20260616085834_repair_evaluation_drafts_creator_rls.sql', import.meta.url),
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

test('draft database failure UI does not claim the server draft was saved', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(
    source,
    /void saveServerDraft\(\)\.catch\([\s\S]+setPrivateDraftStatus\('error'\)[\s\S]+}\)/,
  )
})

test('private draft banner exposes resume and discard actions', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /handleResumePrivateDraft/)
  assert.match(source, /Resume draft/)
  assert.match(source, /Discard draft/)
  assert.match(source, /findServerEvaluationDraft\([\s\S]+context: draftContext[\s\S]+user/)
  assert.match(source, /findPrivateEvaluationDraft\([\s\S]+context: draftContext[\s\S]+user/)
})

test('private draft resume restores saved payload values', () => {
  const source = readFileSync(
    new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /setFormData\(createInitialFormData\(user, \{[\s\S]+restoredFormData/)
  assert.match(source, /setResponseValues\([\s\S]+draft\.payload\.responseValues/)
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
    new URL('../supabase/migrations/20260616153314_repair_manual_review_eval_matchday.sql', import.meta.url),
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
