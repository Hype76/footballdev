create or replace view public.email_delivery_operational_metrics_v1
with (security_invoker = true)
as
select
  case
    when grouping(job.delivery_type) = 1 then 'all'
    else job.delivery_type
  end as delivery_type,
  count(*) filter (where job.status = 'pending')::bigint as pending_count,
  count(*) filter (
    where job.eligible_at <= timezone('utc', now())
      and job.status in ('pending', 'processing')
  )::bigint as eligible_count,
  count(*) filter (where job.status = 'processing')::bigint as processing_count,
  count(*) filter (
    where job.status = 'failed'
      and job.next_retry_at is not null
  )::bigint as retry_count,
  count(*) filter (where job.status = 'failed')::bigint as failed_count,
  coalesce(
    extract(epoch from (
      timezone('utc', now()) - min(job.eligible_at) filter (
        where job.eligible_at <= timezone('utc', now())
          and job.status in ('pending', 'processing')
      )
    )),
    0
  )::bigint as oldest_eligible_age_seconds,
  coalesce(
    percentile_cont(0.5) within group (
      order by extract(epoch from (job.claimed_at - job.eligible_at)) * 1000
    ) filter (
      where job.claimed_at is not null
        and job.eligible_at is not null
        and job.claimed_at >= job.eligible_at
    ),
    0
  )::bigint as eligibility_to_claim_p50_ms,
  coalesce(
    percentile_cont(0.95) within group (
      order by extract(epoch from (job.claimed_at - job.eligible_at)) * 1000
    ) filter (
      where job.claimed_at is not null
        and job.eligible_at is not null
        and job.claimed_at >= job.eligible_at
    ),
    0
  )::bigint as eligibility_to_claim_p95_ms,
  coalesce(
    percentile_cont(0.5) within group (
      order by job.provider_duration_ms
    ) filter (where job.provider_duration_ms is not null),
    0
  )::bigint as provider_acceptance_p50_ms,
  coalesce(
    percentile_cont(0.95) within group (
      order by job.provider_duration_ms
    ) filter (where job.provider_duration_ms is not null),
    0
  )::bigint as provider_acceptance_p95_ms,
  coalesce(
    percentile_cont(0.5) within group (
      order by job.pdf_duration_ms
    ) filter (where job.pdf_duration_ms is not null),
    0
  )::bigint as pdf_duration_p50_ms,
  coalesce(
    percentile_cont(0.95) within group (
      order by job.pdf_duration_ms
    ) filter (where job.pdf_duration_ms is not null),
    0
  )::bigint as pdf_duration_p95_ms,
  coalesce(
    percentile_cont(0.5) within group (
      order by extract(epoch from (job.provider_requested_at - job.claimed_at)) * 1000
    ) filter (
      where job.provider_requested_at is not null
        and job.claimed_at is not null
        and job.provider_requested_at >= job.claimed_at
    ),
    0
  )::bigint as claim_to_provider_p50_ms,
  coalesce(
    percentile_cont(0.95) within group (
      order by extract(epoch from (job.provider_requested_at - job.claimed_at)) * 1000
    ) filter (
      where job.provider_requested_at is not null
        and job.claimed_at is not null
        and job.provider_requested_at >= job.claimed_at
    ),
    0
  )::bigint as claim_to_provider_p95_ms
from public.email_delivery_jobs as job
where job.created_at >= timezone('utc', now()) - interval '30 days'
group by grouping sets ((job.delivery_type), ());

revoke all on public.email_delivery_operational_metrics_v1
  from public, anon, authenticated;
grant select on public.email_delivery_operational_metrics_v1
  to service_role;

comment on view public.email_delivery_operational_metrics_v1 is
  'Platform Admin operational metrics with counts and complete timing percentiles only.';
