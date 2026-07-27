import { createSupabaseAdminClient } from './lib/_supabase.js'
import { ingestAuditAnalyticsEvents } from './lib/_platform-analytics.js'

export const config = {
  schedule: '*/15 * * * *',
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

async function resolveAuditStart(supabaseAdmin, now) {
  const { data, error } = await supabaseAdmin
    .from('analytics_events')
    .select('occurred_at')
    .eq('source_kind', 'audit')
    .order('occurred_at', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  const start = data?.[0]?.occurred_at
    ? new Date(data[0].occurred_at)
    : new Date(now)
  start.setUTCDate(start.getUTCDate() - (data?.[0]?.occurred_at ? 1 : 90))
  return start
}

export async function processPlatformAnalytics({
  supabaseAdmin,
  now = new Date(),
} = {}) {
  const endAt = now.toISOString()
  const start = await resolveAuditStart(supabaseAdmin, now)
  const startAt = start.toISOString()
  const ingest = await ingestAuditAnalyticsEvents({
    supabaseAdmin,
    startAt,
    endAt,
    environment: 'production',
  })
  const { error: refreshError } = await supabaseAdmin.rpc('refresh_platform_analytics_aggregates', {
    start_date_value: isoDate(start),
    end_date_value: isoDate(now),
  })

  if (refreshError) {
    throw refreshError
  }

  const { error: cleanupError } = await supabaseAdmin.rpc('cleanup_platform_analytics', {
    raw_retention_days_value: 90,
    aggregate_retention_days_value: 760,
  })

  if (cleanupError) {
    throw cleanupError
  }

  return {
    ...ingest,
    refreshedFrom: isoDate(start),
    refreshedTo: isoDate(now),
  }
}

export async function handler(event) {
  try {
    const supabaseAdmin = createSupabaseAdminClient(event)
    const result = await processPlatformAnalytics({ supabaseAdmin })

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
