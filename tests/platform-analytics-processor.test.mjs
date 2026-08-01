import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-only-service-role-key'

const { processPlatformAnalytics } = await import('../netlify/functions/process-platform-analytics.js')

const runId = '11111111-1111-4111-8111-111111111111'
const watermark = '2026-07-30T12:00:00.000Z'
const now = new Date('2026-07-31T12:00:00.000Z')

function processorClient({
  conflict = false,
  events = [],
  refreshError = null,
} = {}) {
  const evidence = {
    staleRunUpdates: [],
    runUpdates: [],
    stateUpdates: [],
    eventUpdates: [],
    rpcCalls: [],
    limits: [],
    ranges: [],
  }

  const client = {
    evidence,
    from(table) {
      if (table === 'analytics_processor_state') {
        return {
          select() { return this },
          eq() { return this },
          maybeSingle: async () => ({
            data: {
              watermark_received_at: watermark,
              watermark_event_id: null,
              audit_watermark_created_at: watermark,
            },
            error: null,
          }),
          update(values) {
            return {
              eq: async () => {
                evidence.stateUpdates.push(values)
                return { error: null }
              },
            }
          },
        }
      }

      if (table === 'analytics_processor_runs') {
        return {
          insert() {
            return {
              select() { return this },
              single: async () => conflict
                ? { data: null, error: { code: '23505' } }
                : { data: { id: runId }, error: null },
            }
          },
          update(values) {
            const query = {
              eq(key, value) {
                if (key === 'status' && value === 'running') {
                  return {
                    async lt(column, cutoff) {
                      evidence.staleRunUpdates.push({ values, column, cutoff })
                      return { error: null }
                    },
                  }
                }
                evidence.runUpdates.push(values)
                return Promise.resolve({ error: null })
              },
            }
            return query
          },
        }
      }

      if (table === 'audit_logs') {
        const query = {
          select() { return query },
          gte() { return query },
          gt() { return query },
          lte() { return query },
          order() { return query },
          async range(start, end) {
            evidence.ranges.push({ table, start, end })
            return { data: [], error: null }
          },
          async limit(value) {
            evidence.limits.push({ table, value })
            return { data: [], error: null }
          },
        }
        return query
      }

      if (table === 'analytics_events') {
        return {
          select() {
            const query = {
              is() { return query },
              lte() { return query },
              order() { return query },
              async range(start, end) {
                evidence.ranges.push({ table, start, end })
                return { data: events.slice(start, end + 1), error: null }
              },
              async limit(value) {
                evidence.limits.push({ table, value })
                return { data: events, error: null }
              },
            }
            return query
          },
          update(values) {
            const query = {
              in(key, ids) {
                evidence.eventUpdates.push({ values, key, ids })
                return query
              },
              async is() { return { error: null } },
            }
            return query
          },
        }
      }

      throw new Error(`Unexpected table ${table}`)
    },
    async rpc(name, args) {
      evidence.rpcCalls.push({ name, args })
      return { data: null, error: refreshError }
    },
  }
  return client
}

test('processor is safe with no events and persists a successful measurable run', async () => {
  const client = processorClient()
  const result = await processPlatformAnalytics({
    supabaseAdmin: client,
    now,
    invocationId: 'invocation:no-events',
  })
  assert.equal(result.rowsAggregated, 0)
  assert.equal(result.watermarkBefore, watermark)
  assert.equal(result.watermarkAfter, watermark)
  assert.equal(client.evidence.rpcCalls[0].name, 'refresh_platform_analytics_aggregates')
  assert.equal(client.evidence.rpcCalls[1].name, 'complete_platform_analytics_processor_run')
  assert.equal(client.evidence.rpcCalls[1].args.rows_aggregated_value, 0)
  assert.equal(client.evidence.rpcCalls[1].args.watermark_after_value, watermark)
  assert.equal(client.evidence.rpcCalls[1].args.audit_watermark_after_value, watermark)
})

test('processor skips overlapping invocation before scanning source rows', async () => {
  const client = processorClient({ conflict: true })
  const result = await processPlatformAnalytics({
    supabaseAdmin: client,
    now,
    invocationId: 'invocation:overlap',
  })
  assert.deepEqual(result, { skipped: true, reason: 'overlapping_invocation' })
  assert.equal(client.evidence.limits.length, 0)
})

test('processor reclaims a stale running invocation before claiming new work', async () => {
  const client = processorClient()
  await processPlatformAnalytics({
    supabaseAdmin: client,
    now,
    invocationId: 'invocation:after-stale-run',
  })
  assert.equal(client.evidence.staleRunUpdates.length, 1)
  assert.equal(client.evidence.staleRunUpdates[0].values.status, 'failed')
  assert.equal(client.evidence.staleRunUpdates[0].values.failure_category, 'stale_run_reclaimed')
  assert.equal(client.evidence.staleRunUpdates[0].column, 'started_at')
  assert.equal(client.evidence.staleRunUpdates[0].cutoff, '2026-07-31T11:30:00.000Z')
})

test('processor advances a deterministic watermark, marks rows once, and bounds the batch', async () => {
  const event = {
    id: '22222222-2222-4222-8222-222222222222',
    received_at: '2026-07-31T11:59:00.000Z',
    occurred_at: '2026-07-31T11:58:00.000Z',
    actor_role_family: 'staff',
    club_id: '33333333-3333-4333-8333-333333333333',
  }
  const client = processorClient({ events: [event] })
  const result = await processPlatformAnalytics({
    supabaseAdmin: client,
    now,
    invocationId: 'invocation:one-event',
  })
  assert.equal(result.rowsAggregated, 1)
  assert.equal(result.watermarkAfter, event.received_at)
  assert.equal(client.evidence.eventUpdates.length, 0)
  const completion = client.evidence.rpcCalls.at(-1)
  const { finished_at_value: finishedAt, ...completionArgs } = completion.args
  assert.match(finishedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(completion.name, 'complete_platform_analytics_processor_run')
  assert.deepEqual(completionArgs, {
      run_id_value: runId,
      event_ids_value: [event.id],
      rows_scanned_value: 0,
      rows_accepted_value: 0,
      rows_rejected_value: 0,
      rows_unattributed_value: 0,
      rows_aggregated_value: 1,
      watermark_after_value: event.received_at,
      audit_watermark_after_value: watermark,
  })
  assert.ok(client.evidence.ranges.some((item) => (
    item.table === 'analytics_events' && item.start === 0 && item.end === 999
  )))
})

test('processor paginates beyond the provider row cap without exceeding its bounded batch', async () => {
  const events = Array.from({ length: 1_001 }, (_, index) => ({
    id: `event-${index}`,
    received_at: new Date(now.getTime() - (1_001 - index) * 1000).toISOString(),
    occurred_at: new Date(now.getTime() - (1_001 - index) * 1000).toISOString(),
    actor_role_family: 'staff',
    club_id: '33333333-3333-4333-8333-333333333333',
  }))
  const client = processorClient({ events })
  const result = await processPlatformAnalytics({
    supabaseAdmin: client,
    now,
    invocationId: 'invocation:paginated-events',
  })

  assert.equal(result.rowsAggregated, 1_001)
  assert.ok(client.evidence.ranges.some((item) => (
    item.table === 'analytics_events' && item.start === 1_000 && item.end === 1_999
  )))
  assert.equal(client.evidence.rpcCalls.at(-1).args.event_ids_value.length, 1_001)
})

test('failed processing records a safe failure and a later run can resume', async () => {
  const failed = processorClient({ refreshError: { code: 'refresh_failed' } })
  await assert.rejects(
    processPlatformAnalytics({
      supabaseAdmin: failed,
      now,
      invocationId: 'invocation:failed',
    }),
  )
  assert.equal(failed.evidence.runUpdates.at(-1).status, 'failed')
  assert.equal(failed.evidence.runUpdates.at(-1).failure_category, 'refresh_failed')
  assert.equal(failed.evidence.stateUpdates.at(-1).last_failed_run_id, runId)

  const resumed = processorClient()
  const result = await processPlatformAnalytics({
    supabaseAdmin: resumed,
    now,
    invocationId: 'invocation:resumed',
  })
  assert.equal(result.rowsAggregated, 0)
  assert.equal(resumed.evidence.rpcCalls.at(-1).name, 'complete_platform_analytics_processor_run')
})
