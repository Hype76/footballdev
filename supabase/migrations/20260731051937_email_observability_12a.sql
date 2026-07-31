create table if not exists public.email_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  logical_key text,
  source_type text not null default 'direct',
  source_id text,
  email_log_id uuid references public.email_logs(id) on delete set null,
  delivery_type text not null default 'unknown',
  club_id uuid references public.clubs(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'processing',
      'provider_accepted',
      'delivered',
      'failed',
      'cancelled',
      'suppressed'
    )),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  has_pdf boolean not null default false,
  origin_action_at timestamptz,
  eligible_at timestamptz,
  enqueued_at timestamptz,
  scheduled_at timestamptz,
  claimed_at timestamptz,
  processing_started_at timestamptz,
  pdf_started_at timestamptz,
  pdf_finished_at timestamptz,
  provider_requested_at timestamptz,
  provider_accepted_at timestamptz,
  provider_delivered_at timestamptz,
  provider_failed_at timestamptz,
  processing_finished_at timestamptz,
  next_retry_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text,
  provider_status text,
  failure_category text,
  safe_error_code text,
  worker_invocation_id uuid,
  processing_duration_ms bigint,
  pdf_duration_ms bigint,
  provider_duration_ms bigint,
  total_eligible_to_accept_ms bigint,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists email_delivery_jobs_logical_key_uidx
  on public.email_delivery_jobs(logical_key)
  where logical_key is not null;

create index if not exists email_delivery_jobs_status_eligible_idx
  on public.email_delivery_jobs(status, eligible_at, created_at);

create index if not exists email_delivery_jobs_delivery_type_created_idx
  on public.email_delivery_jobs(delivery_type, created_at desc);

create index if not exists email_delivery_jobs_provider_message_idx
  on public.email_delivery_jobs(provider_message_id)
  where provider_message_id is not null;

create index if not exists email_delivery_jobs_email_log_idx
  on public.email_delivery_jobs(email_log_id)
  where email_log_id is not null;

create index if not exists email_delivery_jobs_club_idx
  on public.email_delivery_jobs(club_id)
  where club_id is not null;

create index if not exists email_delivery_jobs_team_idx
  on public.email_delivery_jobs(team_id)
  where team_id is not null;

create table if not exists public.email_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.email_delivery_jobs(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  worker_invocation_id uuid not null,
  claimed_at timestamptz,
  processing_started_at timestamptz not null,
  pdf_started_at timestamptz,
  pdf_finished_at timestamptz,
  provider_requested_at timestamptz,
  provider_accepted_at timestamptz,
  provider_delivered_at timestamptz,
  provider_failed_at timestamptz,
  processing_finished_at timestamptz,
  provider_message_id text,
  provider_status text,
  failure_category text,
  safe_error_code text,
  processing_duration_ms bigint,
  pdf_duration_ms bigint,
  provider_duration_ms bigint,
  total_eligible_to_accept_ms bigint,
  created_at timestamptz not null default timezone('utc', now()),
  unique(job_id, attempt_number)
);

create index if not exists email_delivery_attempts_provider_message_idx
  on public.email_delivery_attempts(provider_message_id)
  where provider_message_id is not null;

create index if not exists email_delivery_attempts_job_created_idx
  on public.email_delivery_attempts(job_id, created_at desc);

alter table public.email_delivery_jobs enable row level security;
alter table public.email_delivery_attempts enable row level security;

revoke all on public.email_delivery_jobs from public, anon, authenticated;
revoke all on public.email_delivery_attempts from public, anon, authenticated;

grant select, insert, update on public.email_delivery_jobs to service_role;
grant select, insert, update on public.email_delivery_attempts to service_role;

create or replace function public.begin_email_delivery_attempt_v1(telemetry_input jsonb)
returns table (
  job_id uuid,
  attempt_id uuid,
  attempt_number integer,
  worker_invocation_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_logical_key text := nullif(btrim(coalesce(telemetry_input ->> 'logicalKey', '')), '');
  normalized_source_type text := coalesce(
    nullif(btrim(coalesce(telemetry_input ->> 'sourceType', '')), ''),
    'direct'
  );
  normalized_delivery_type text := coalesce(
    nullif(btrim(coalesce(telemetry_input ->> 'deliveryType', '')), ''),
    'unknown'
  );
  normalized_worker_id uuid := coalesce(
    nullif(btrim(coalesce(telemetry_input ->> 'workerInvocationId', '')), '')::uuid,
    gen_random_uuid()
  );
  started_at timestamptz := coalesce(
    nullif(btrim(coalesce(telemetry_input ->> 'processingStartedAt', '')), '')::timestamptz,
    timezone('utc', now())
  );
  provider_will_be_requested boolean := coalesce(
    (telemetry_input ->> 'providerRequested')::boolean,
    true
  );
  requested_at timestamptz := case
    when provider_will_be_requested then coalesce(
      nullif(btrim(coalesce(telemetry_input ->> 'providerRequestedAt', '')), '')::timestamptz,
      timezone('utc', now())
    )
    else null
  end;
  resolved_job_id uuid;
  resolved_attempt_id uuid;
  resolved_attempt_number integer;
begin
  if normalized_logical_key is null then
    insert into public.email_delivery_jobs (
      logical_key,
      source_type,
      source_id,
      email_log_id,
      delivery_type,
      club_id,
      team_id,
      recipient_count,
      has_pdf,
      origin_action_at,
      eligible_at,
      enqueued_at,
      scheduled_at,
      claimed_at,
      processing_started_at,
      pdf_started_at,
      pdf_finished_at,
      provider_requested_at,
      provider_status,
      worker_invocation_id,
      status
    )
    values (
      null,
      normalized_source_type,
      nullif(btrim(coalesce(telemetry_input ->> 'sourceId', '')), ''),
      nullif(btrim(coalesce(telemetry_input ->> 'emailLogId', '')), '')::uuid,
      normalized_delivery_type,
      nullif(btrim(coalesce(telemetry_input ->> 'clubId', '')), '')::uuid,
      nullif(btrim(coalesce(telemetry_input ->> 'teamId', '')), '')::uuid,
      greatest(coalesce((telemetry_input ->> 'recipientCount')::integer, 0), 0),
      coalesce((telemetry_input ->> 'hasPdf')::boolean, false),
      nullif(btrim(coalesce(telemetry_input ->> 'originActionAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'eligibleAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'enqueuedAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'scheduledAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'claimedAt', '')), '')::timestamptz,
      started_at,
      nullif(btrim(coalesce(telemetry_input ->> 'pdfStartedAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'pdfFinishedAt', '')), '')::timestamptz,
      requested_at,
      case when provider_will_be_requested then 'requesting' else 'not_requested' end,
      normalized_worker_id,
      'processing'
    )
    returning id into resolved_job_id;
  else
    insert into public.email_delivery_jobs (
      logical_key,
      source_type,
      source_id,
      email_log_id,
      delivery_type,
      club_id,
      team_id,
      recipient_count,
      has_pdf,
      origin_action_at,
      eligible_at,
      enqueued_at,
      scheduled_at,
      claimed_at,
      processing_started_at,
      pdf_started_at,
      pdf_finished_at,
      provider_requested_at,
      provider_status,
      worker_invocation_id,
      status
    )
    values (
      normalized_logical_key,
      normalized_source_type,
      nullif(btrim(coalesce(telemetry_input ->> 'sourceId', '')), ''),
      nullif(btrim(coalesce(telemetry_input ->> 'emailLogId', '')), '')::uuid,
      normalized_delivery_type,
      nullif(btrim(coalesce(telemetry_input ->> 'clubId', '')), '')::uuid,
      nullif(btrim(coalesce(telemetry_input ->> 'teamId', '')), '')::uuid,
      greatest(coalesce((telemetry_input ->> 'recipientCount')::integer, 0), 0),
      coalesce((telemetry_input ->> 'hasPdf')::boolean, false),
      nullif(btrim(coalesce(telemetry_input ->> 'originActionAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'eligibleAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'enqueuedAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'scheduledAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'claimedAt', '')), '')::timestamptz,
      started_at,
      nullif(btrim(coalesce(telemetry_input ->> 'pdfStartedAt', '')), '')::timestamptz,
      nullif(btrim(coalesce(telemetry_input ->> 'pdfFinishedAt', '')), '')::timestamptz,
      requested_at,
      case when provider_will_be_requested then 'requesting' else 'not_requested' end,
      normalized_worker_id,
      'processing'
    )
    on conflict (logical_key) where logical_key is not null
    do update set
      source_type = excluded.source_type,
      source_id = coalesce(public.email_delivery_jobs.source_id, excluded.source_id),
      email_log_id = coalesce(public.email_delivery_jobs.email_log_id, excluded.email_log_id),
      delivery_type = excluded.delivery_type,
      club_id = coalesce(public.email_delivery_jobs.club_id, excluded.club_id),
      team_id = coalesce(public.email_delivery_jobs.team_id, excluded.team_id),
      recipient_count = excluded.recipient_count,
      has_pdf = public.email_delivery_jobs.has_pdf or excluded.has_pdf,
      origin_action_at = coalesce(public.email_delivery_jobs.origin_action_at, excluded.origin_action_at),
      eligible_at = coalesce(public.email_delivery_jobs.eligible_at, excluded.eligible_at),
      enqueued_at = coalesce(public.email_delivery_jobs.enqueued_at, excluded.enqueued_at),
      scheduled_at = coalesce(public.email_delivery_jobs.scheduled_at, excluded.scheduled_at),
      claimed_at = coalesce(excluded.claimed_at, public.email_delivery_jobs.claimed_at),
      processing_started_at = excluded.processing_started_at,
      pdf_started_at = coalesce(excluded.pdf_started_at, public.email_delivery_jobs.pdf_started_at),
      pdf_finished_at = coalesce(excluded.pdf_finished_at, public.email_delivery_jobs.pdf_finished_at),
      provider_requested_at = excluded.provider_requested_at,
      provider_status = excluded.provider_status,
      worker_invocation_id = excluded.worker_invocation_id,
      status = 'processing',
      updated_at = timezone('utc', now())
    returning id into resolved_job_id;
  end if;

  update public.email_delivery_jobs
  set
    attempt_count = attempt_count + 1,
    claimed_at = coalesce(
      nullif(btrim(coalesce(telemetry_input ->> 'claimedAt', '')), '')::timestamptz,
      claimed_at,
      started_at
    ),
    processing_started_at = started_at,
    provider_requested_at = requested_at,
    provider_status = case when provider_will_be_requested then 'requesting' else 'not_requested' end,
    worker_invocation_id = normalized_worker_id,
    status = 'processing',
    updated_at = timezone('utc', now())
  where id = resolved_job_id
  returning email_delivery_jobs.attempt_count into resolved_attempt_number;

  insert into public.email_delivery_attempts (
    job_id,
    attempt_number,
    worker_invocation_id,
    claimed_at,
    processing_started_at,
    pdf_started_at,
    pdf_finished_at,
    provider_requested_at,
    provider_status
  )
  values (
    resolved_job_id,
    resolved_attempt_number,
    normalized_worker_id,
    coalesce(
      nullif(btrim(coalesce(telemetry_input ->> 'claimedAt', '')), '')::timestamptz,
      started_at
    ),
    started_at,
    nullif(btrim(coalesce(telemetry_input ->> 'pdfStartedAt', '')), '')::timestamptz,
    nullif(btrim(coalesce(telemetry_input ->> 'pdfFinishedAt', '')), '')::timestamptz,
    requested_at,
    case when provider_will_be_requested then 'requesting' else 'not_requested' end
  )
  returning id into resolved_attempt_id;

  job_id := resolved_job_id;
  attempt_id := resolved_attempt_id;
  attempt_number := resolved_attempt_number;
  worker_invocation_id := normalized_worker_id;
  return next;
end;
$$;

create or replace function public.complete_email_delivery_attempt_v1(
  target_job_id uuid,
  target_attempt_id uuid,
  outcome text,
  provider_message_id_value text default null,
  provider_status_value text default null,
  failure_category_value text default null,
  safe_error_code_value text default null,
  finished_at_value timestamptz default timezone('utc', now())
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_outcome text := lower(btrim(coalesce(outcome, '')));
begin
  if normalized_outcome not in ('accepted', 'failed', 'preparation_failed') then
    raise exception 'Unsupported email delivery outcome';
  end if;

  update public.email_delivery_attempts as attempt
  set
    provider_accepted_at = case when normalized_outcome = 'accepted' then finished_at_value else attempt.provider_accepted_at end,
    provider_failed_at = case when normalized_outcome = 'failed' then finished_at_value else attempt.provider_failed_at end,
    processing_finished_at = finished_at_value,
    provider_message_id = nullif(btrim(coalesce(provider_message_id_value, '')), ''),
    provider_status = coalesce(
      nullif(btrim(coalesce(provider_status_value, '')), ''),
      case
        when normalized_outcome = 'accepted' then 'accepted'
        when normalized_outcome = 'preparation_failed' then 'not_requested'
        else 'failed'
      end
    ),
    failure_category = nullif(btrim(coalesce(failure_category_value, '')), ''),
    safe_error_code = nullif(btrim(coalesce(safe_error_code_value, '')), ''),
    processing_duration_ms = greatest(
      round(extract(epoch from (finished_at_value - attempt.processing_started_at)) * 1000),
      0
    )::bigint,
    pdf_duration_ms = case
      when attempt.pdf_started_at is not null and attempt.pdf_finished_at is not null
        then greatest(round(extract(epoch from (attempt.pdf_finished_at - attempt.pdf_started_at)) * 1000), 0)::bigint
      else null
    end,
    provider_duration_ms = case
      when attempt.provider_requested_at is not null
        then greatest(
          round(extract(epoch from (finished_at_value - attempt.provider_requested_at)) * 1000),
          0
        )::bigint
      else null
    end,
    total_eligible_to_accept_ms = case
      when normalized_outcome = 'accepted' and job.eligible_at is not null
        then greatest(round(extract(epoch from (finished_at_value - job.eligible_at)) * 1000), 0)::bigint
      else null
    end
  from public.email_delivery_jobs as job
  where attempt.id = target_attempt_id
    and attempt.job_id = target_job_id
    and job.id = target_job_id;

  update public.email_delivery_jobs as job
  set
    status = case when normalized_outcome = 'accepted' then 'provider_accepted' else 'failed' end,
    provider_accepted_at = case when normalized_outcome = 'accepted' then finished_at_value else job.provider_accepted_at end,
    provider_failed_at = case when normalized_outcome = 'failed' then finished_at_value else job.provider_failed_at end,
    processing_finished_at = finished_at_value,
    provider_message_id = nullif(btrim(coalesce(provider_message_id_value, '')), ''),
    provider_status = coalesce(
      nullif(btrim(coalesce(provider_status_value, '')), ''),
      case
        when normalized_outcome = 'accepted' then 'accepted'
        when normalized_outcome = 'preparation_failed' then 'not_requested'
        else 'failed'
      end
    ),
    failure_category = nullif(btrim(coalesce(failure_category_value, '')), ''),
    safe_error_code = nullif(btrim(coalesce(safe_error_code_value, '')), ''),
    processing_duration_ms = greatest(
      round(extract(epoch from (finished_at_value - job.processing_started_at)) * 1000),
      0
    )::bigint,
    pdf_duration_ms = case
      when job.pdf_started_at is not null and job.pdf_finished_at is not null
        then greatest(round(extract(epoch from (job.pdf_finished_at - job.pdf_started_at)) * 1000), 0)::bigint
      else null
    end,
    provider_duration_ms = case
      when job.provider_requested_at is not null
        then greatest(
          round(extract(epoch from (finished_at_value - job.provider_requested_at)) * 1000),
          0
        )::bigint
      else null
    end,
    total_eligible_to_accept_ms = case
      when normalized_outcome = 'accepted' and job.eligible_at is not null
        then greatest(round(extract(epoch from (finished_at_value - job.eligible_at)) * 1000), 0)::bigint
      else null
    end,
    updated_at = timezone('utc', now())
  where job.id = target_job_id;
end;
$$;

revoke all on function public.begin_email_delivery_attempt_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_email_delivery_attempt_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.begin_email_delivery_attempt_v1(jsonb)
  to service_role;
grant execute on function public.complete_email_delivery_attempt_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;

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
  )::bigint as pdf_duration_p95_ms
from public.email_delivery_jobs as job
where job.created_at >= timezone('utc', now()) - interval '30 days'
group by grouping sets ((job.delivery_type), ());

revoke all on public.email_delivery_operational_metrics_v1
  from public, anon, authenticated;
grant select on public.email_delivery_operational_metrics_v1
  to service_role;

comment on table public.email_delivery_jobs is
  'Privacy-safe logical email delivery timing and provider evidence. Message bodies, raw tokens, and provider credentials are intentionally excluded.';

comment on table public.email_delivery_attempts is
  'Append-only timing and provider evidence for each email delivery attempt.';

comment on view public.email_delivery_operational_metrics_v1 is
  'Platform Admin operational metrics with counts and timing percentiles only.';
