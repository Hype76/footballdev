import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const processorUrl = new URL(
  `../netlify/functions/process-training-availability-requests.js?runtime-repair-05=${Date.now()}`,
  import.meta.url,
)

function createWorkClient(count) {
  const pending = Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    work_type: 'unknown',
    revision: 1,
  }))
  const claimed = []
  const completed = []

  return {
    claimed,
    completed,
    async rpc(name, args = {}) {
      if (name === 'get_training_availability_processor_backlog_v1') {
        return {
          data: [{
            active_claim_count: 0,
            candidate_due_count: pending.length,
            oldest_due_at: pending.length > 0 ? '2026-08-01T00:00:00.000Z' : null,
            remaining_due_count: pending.length,
          }],
          error: null,
        }
      }

      if (name === 'claim_training_availability_processor_work_v1') {
        const work = pending.shift()
        if (work) {
          claimed.push(work.id)
        }
        return { data: work ? [work] : [], error: null }
      }

      if (name === 'complete_training_availability_processor_work_v1') {
        completed.push({
          id: args.work_id_value,
          outcome: args.outcome_value,
          workerId: args.worker_id_value,
        })
        return { data: args.outcome_value, error: null }
      }

      throw new Error(`Unexpected RPC: ${name}`)
    },
  }
}

function createRecurrenceClient({ event, existingRequests, setting }) {
  const rows = [...existingRequests]

  function builder(table) {
    const filters = new Map()
    let inserted = null
    const query = {
      select() {
        return query
      },
      eq(column, value) {
        filters.set(column, value)
        return query
      },
      insert(value) {
        inserted = value
        return query
      },
      async maybeSingle() {
        if (table === 'training_availability_settings') {
          return {
            data: filters.get('id') === setting.id
              ? { ...setting, calendar_events: event }
              : null,
            error: null,
          }
        }
        return { data: null, error: null }
      },
      async single() {
        const created = {
          id: `request-${rows.length + 1}`,
          ...inserted,
        }
        rows.push(created)
        return { data: created, error: null }
      },
      then(resolve) {
        const data = table === 'training_availability_requests'
          ? rows.filter((row) => (
            !filters.has('calendar_event_id')
            || row.calendar_event_id === filters.get('calendar_event_id')
          ))
          : []
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return query
  }

  return {
    rows,
    from: builder,
  }
}

test('runtime budget helper keeps the safety margin before a new claim', async () => {
  const { hasTrainingAvailabilityRuntimeBudget } = await import(processorUrl.href)

  assert.equal(hasTrainingAvailabilityRuntimeBudget({
    startedAtMs: 0,
    nowMs: 18_000,
    runtimeBudgetMs: 20_000,
    minimumStartBudgetMs: 1_500,
  }), true)
  assert.equal(hasTrainingAvailabilityRuntimeBudget({
    startedAtMs: 0,
    nowMs: 18_500,
    runtimeBudgetMs: 20_000,
    minimumStartBudgetMs: 1_500,
  }), false)
})

test('one invocation respects the batch cap and emits aggregate counters', async () => {
  const { processTrainingAvailabilityRequests } = await import(processorUrl.href)
  const client = createWorkClient(5)
  let tick = 0
  const summary = await processTrainingAvailabilityRequests({
    batchSize: 3,
    now: () => new Date(Date.UTC(2026, 7, 1, 12, 0, tick++)),
    supabaseClient: client,
    workerId: '10000000-0000-4000-8000-000000000001',
  })

  assert.equal(summary.success, true)
  assert.equal(summary.candidateDueCount, 5)
  assert.equal(summary.claimedCount, 3)
  assert.equal(summary.processedCount, 3)
  assert.equal(summary.terminalCount, 3)
  assert.equal(summary.remainingDueCount, 2)
  assert.equal(summary.retryableFailureCount, 0)
  assert.equal(new Set(client.claimed).size, 3)
  assert.equal(client.completed.every((row) => row.outcome === 'terminal'), true)
})

test('ten sequential bounded invocations drain finite work without duplicate claims', async () => {
  const { processTrainingAvailabilityRequests } = await import(processorUrl.href)
  const client = createWorkClient(23)

  for (let invocation = 0; invocation < 10; invocation += 1) {
    let tick = 0
    await processTrainingAvailabilityRequests({
      batchSize: 3,
      now: () => new Date(Date.UTC(2026, 7, 1, 13, invocation, tick++)),
      supabaseClient: client,
      workerId: `20000000-0000-4000-8000-${String(invocation + 1).padStart(12, '0')}`,
    })
  }

  assert.equal(client.claimed.length, 23)
  assert.equal(new Set(client.claimed).size, 23)
  assert.equal(client.completed.length, 23)
})

test('runtime exhaustion stops before a claim and reports remaining work', async () => {
  const { processTrainingAvailabilityRequests } = await import(processorUrl.href)
  const client = createWorkClient(2)
  const times = [
    '2026-08-01T14:00:00.000Z',
    '2026-08-01T14:00:19.000Z',
    '2026-08-01T14:00:19.001Z',
  ]
  const summary = await processTrainingAvailabilityRequests({
    now: () => new Date(times.shift()),
    runtimeBudgetMs: 20_000,
    supabaseClient: client,
    workerId: '30000000-0000-4000-8000-000000000001',
  })

  assert.equal(summary.claimedCount, 0)
  assert.equal(summary.processedCount, 0)
  assert.equal(summary.remainingDueCount, 2)
  assert.equal(summary.budgetExhausted, true)
  assert.equal(summary.outcome, 'success_budget_exhausted')
})

test('the 15 of 23 starvation fixture is completed once and then becomes no-op work', async () => {
  const { buildOccurrences, processRecurrenceWork } = await import(processorUrl.href)
  const event = {
    id: '40000000-0000-4000-8000-000000000001',
    club_id: '50000000-0000-4000-8000-000000000001',
    team_id: '60000000-0000-4000-8000-000000000001',
    event_type: 'training',
    starts_at: '2026-08-02T09:00:00.000Z',
    ends_at: '2026-08-02T10:00:00.000Z',
    recurrence_frequency: 'weekly',
    recurrence_until: '2027-01-03',
    cancelled_at: null,
  }
  const setting = {
    id: '70000000-0000-4000-8000-000000000001',
    club_id: event.club_id,
    team_id: event.team_id,
    calendar_event_id: event.id,
    enabled: true,
    send_days_before: 0,
  }
  const occurrences = buildOccurrences(event)
  assert.equal(occurrences.length, 23)
  const existingRequests = occurrences.slice(0, 15).map((occurrence, index) => ({
    id: `existing-${index + 1}`,
    setting_id: setting.id,
    club_id: setting.club_id,
    team_id: setting.team_id,
    calendar_event_id: setting.calendar_event_id,
    occurrence_date: occurrence.occurrenceDate,
    occurrence_starts_at: occurrence.occurrenceStartsAt.toISOString(),
    occurrence_ends_at: occurrence.occurrenceEndsAt.toISOString(),
    send_at: occurrence.occurrenceStartsAt.toISOString(),
    status: 'pending',
  }))
  assert.equal(occurrences.length - existingRequests.length, 8)
  const client = createRecurrenceClient({ event, existingRequests, setting })
  const work = {
    id: '80000000-0000-4000-8000-000000000001',
    work_type: 'recurrence',
    setting_id: setting.id,
    club_id: setting.club_id,
    team_id: setting.team_id,
    cursor_date: null,
    revision: 1,
  }

  const repaired = await processRecurrenceWork({
    now: new Date('2026-08-01T12:00:00.000Z'),
    supabase: client,
    work,
  })
  assert.equal(repaired.created, 8)
  assert.equal(repaired.noOp, 15)
  assert.equal(repaired.outcome, 'completed')
  assert.equal(client.rows.length, 23)
  assert.equal(new Set(client.rows.map((row) => row.occurrence_date)).size, 23)

  const repeated = await processRecurrenceWork({
    now: new Date('2026-08-01T12:01:00.000Z'),
    supabase: client,
    work,
  })
  assert.equal(repeated.created, 0)
  assert.equal(repeated.updated, 0)
  assert.equal(repeated.noOp, 23)
  assert.equal(client.rows.length, 23)
})
