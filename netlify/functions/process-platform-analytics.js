import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { ingestAuditAnalyticsEvents } from './lib/_platform-analytics.js'

export const config = {
  schedule: '*/15 * * * *',
}

const MAX_PROCESSING_ROWS = 20_000
const STALE_RUN_AFTER_MS = 30 * 60 * 1000

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

async function loadProcessorState(supabaseAdmin, now) {
  const { data, error } = await supabaseAdmin
    .from('analytics_processor_state')
    .select('watermark_received_at,watermark_event_id,audit_watermark_created_at')
    .eq('singleton', true)
    .maybeSingle()
  if (error) throw error
  const fallback = new Date(now)
  fallback.setUTCDate(fallback.getUTCDate() - 90)
  return {
    watermark: data?.watermark_received_at || fallback.toISOString(),
    auditWatermark: data?.audit_watermark_created_at || fallback.toISOString(),
    eventId: data?.watermark_event_id || null,
  }
}

async function claimRun(supabaseAdmin, invocationId, state, endAt) {
  const staleBefore = new Date(new Date(endAt).getTime() - STALE_RUN_AFTER_MS).toISOString()
  const { error: staleRunError } = await supabaseAdmin
    .from('analytics_processor_runs')
    .update({
      status: 'failed',
      finished_at: endAt,
      failure_category: 'stale_run_reclaimed',
    })
    .eq('status', 'running')
    .lt('started_at', staleBefore)
  if (staleRunError) throw staleRunError

  const { data, error } = await supabaseAdmin
    .from('analytics_processor_runs')
    .insert({
      invocation_id: invocationId,
      status: 'running',
      source_start_at: state.auditWatermark,
      source_end_at: endAt,
      watermark_before: state.watermark,
    })
    .select('id')
    .single()

  if (error?.code === '23505') return null
  if (error) throw error
  return data
}

async function pendingEvents(supabaseAdmin, endAt) {
  const { data, error } = await supabaseAdmin
    .from('analytics_events')
    .select('id,received_at,occurred_at,actor_role_family,club_id')
    .is('processed_at', null)
    .lte('received_at', endAt)
    .order('received_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAX_PROCESSING_ROWS)
  if (error) throw error
  return data || []
}

async function markProcessed(supabaseAdmin, events, runId, processedAt) {
  for (let index = 0; index < events.length; index += 500) {
    const ids = events.slice(index, index + 500).map((row) => row.id)
    const { error } = await supabaseAdmin
      .from('analytics_events')
      .update({ processed_at: processedAt, processor_run_id: runId })
      .in('id', ids)
      .is('processed_at', null)
    if (error) throw error
  }
}

async function finishRun(supabaseAdmin, runId, state, values) {
  const {
    audit_watermark_after: auditWatermarkAfter,
    ...runValues
  } = values
  const { error: runError } = await supabaseAdmin
    .from('analytics_processor_runs')
    .update({ ...runValues, finished_at: values.finished_at || new Date().toISOString() })
    .eq('id', runId)
  if (runError) throw runError

  const stateValues = {
    updated_at: new Date().toISOString(),
    ...(values.status === 'succeeded'
      ? {
          watermark_received_at: values.watermark_after || state.watermark,
          audit_watermark_created_at: auditWatermarkAfter || state.auditWatermark,
          last_successful_run_id: runId,
        }
      : { last_failed_run_id: runId }),
  }
  const { error: stateError } = await supabaseAdmin
    .from('analytics_processor_state')
    .update(stateValues)
    .eq('singleton', true)
  if (stateError) throw stateError
}

export async function processPlatformAnalytics({
  supabaseAdmin,
  now = new Date(),
  invocationId = randomUUID(),
} = {}) {
  const endAt = now.toISOString()
  const state = await loadProcessorState(supabaseAdmin, now)
  const run = await claimRun(supabaseAdmin, invocationId, state, endAt)

  if (!run) {
    return { skipped: true, reason: 'overlapping_invocation' }
  }

  try {
    const startAt = state.auditWatermark
    const ingest = await ingestAuditAnalyticsEvents({
      supabaseAdmin,
      startAt,
      endAt,
      environment: 'production',
      processorRunId: run.id,
    })
    const events = await pendingEvents(supabaseAdmin, endAt)
    const occurredDates = events.map((row) => row.occurred_at).filter(Boolean).sort()
    const refreshStart = occurredDates.length ? isoDate(occurredDates[0]) : isoDate(startAt)
    const refreshEnd = occurredDates.length ? isoDate(occurredDates.at(-1)) : isoDate(endAt)

    const { error: refreshError } = await supabaseAdmin.rpc('refresh_platform_analytics_aggregates', {
      start_date_value: refreshStart,
      end_date_value: refreshEnd,
    })
    if (refreshError) throw refreshError

    const processedAt = new Date().toISOString()
    await markProcessed(supabaseAdmin, events, run.id, processedAt)
    const last = events.at(-1)
    const watermarkAfter = last?.received_at || state.watermark
    const unattributed = events.filter((row) => (
      row.actor_role_family === 'unknown'
      || (row.actor_role_family !== 'platform_admin' && !row.club_id)
    )).length

    await finishRun(supabaseAdmin, run.id, state, {
      status: 'succeeded',
      rows_scanned: ingest.auditRowsRead,
      rows_accepted: ingest.analyticsRowsPrepared,
      rows_rejected: ingest.rowsRejected,
      rows_unattributed: unattributed,
      rows_aggregated: events.length,
      watermark_after: watermarkAfter,
      audit_watermark_after: ingest.lastAuditAt,
    })

    return {
      invocationId,
      processorRunId: run.id,
      ...ingest,
      rowsAggregated: events.length,
      rowsUnattributed: unattributed,
      watermarkBefore: state.watermark,
      watermarkAfter,
      refreshedFrom: refreshStart,
      refreshedTo: refreshEnd,
    }
  } catch (error) {
    await finishRun(supabaseAdmin, run.id, state, {
      status: 'failed',
      failure_category: String(error?.code || 'unknown').slice(0, 120),
    }).catch(() => {})
    throw error
  }
}

export async function handler(event) {
  try {
    const supabaseAdmin = createSupabaseAdminClient(event)
    const result = await processPlatformAnalytics({
      supabaseAdmin,
      invocationId: event?.headers?.['x-nf-request-id'] || randomUUID(),
    })

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ success: true, ...result }),
    }
  } catch (error) {
    console.error('process_platform_analytics_failed', {
      code: error?.code || 'unknown',
    })

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        success: false,
        message: 'Platform analytics aggregation failed.',
      }),
    }
  }
}
