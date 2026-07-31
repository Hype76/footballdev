do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'email_delivery_state_v1'
  ) then
    create type public.email_delivery_state_v1 as enum (
      'scheduled',
      'queued',
      'processing',
      'provider_accepted',
      'delivered',
      'deferred',
      'bounced',
      'complained',
      'failed',
      'retrying',
      'cancelled',
      'suppressed'
    );
  end if;
end
$$;

alter table public.scheduled_email_queue
  add column if not exists delivery_state public.email_delivery_state_v1 not null default 'scheduled',
  add column if not exists lease_owner text,
  add column if not exists leased_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists claim_attempt integer not null default 0,
  add column if not exists worker_invocation_id uuid,
  add column if not exists retry_policy_version integer,
  add column if not exists retry_enabled boolean not null default false,
  add column if not exists legacy_review_required boolean not null default true,
  add column if not exists next_retry_at timestamptz,
  add column if not exists failure_category text,
  add column if not exists safe_error_code text,
  add column if not exists provider_message_id text,
  add column if not exists provider_accepted_at timestamptz,
  add column if not exists provider_delivered_at timestamptz,
  add column if not exists terminal_at timestamptz;

alter table public.email_logs
  add column if not exists delivery_state public.email_delivery_state_v1 not null default 'queued',
  add column if not exists lease_owner text,
  add column if not exists leased_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists claim_attempt integer not null default 0,
  add column if not exists worker_invocation_id uuid,
  add column if not exists retry_policy_version integer,
  add column if not exists retry_enabled boolean not null default false,
  add column if not exists legacy_review_required boolean not null default true,
  add column if not exists failure_category text,
  add column if not exists safe_error_code text,
  add column if not exists provider_message_id text,
  add column if not exists provider_accepted_at timestamptz,
  add column if not exists provider_delivered_at timestamptz,
  add column if not exists terminal_at timestamptz;

update public.scheduled_email_queue
set
  delivery_state = case
    when status = 'sending' then 'processing'::public.email_delivery_state_v1
    when status = 'failed' then 'failed'::public.email_delivery_state_v1
    else 'scheduled'::public.email_delivery_state_v1
  end,
  retry_enabled = false,
  legacy_review_required = status = 'failed'
where retry_policy_version is null;

update public.email_logs
set
  delivery_state = case
    when status = 'sent' then 'provider_accepted'::public.email_delivery_state_v1
    when status = 'failed' then 'failed'::public.email_delivery_state_v1
    else 'queued'::public.email_delivery_state_v1
  end,
  retry_enabled = false,
  legacy_review_required = status = 'failed'
where retry_policy_version is null;

alter table public.scheduled_email_queue
  alter column retry_enabled set default true,
  alter column legacy_review_required set default false,
  alter column retry_policy_version set default 1;

alter table public.email_logs
  alter column retry_enabled set default true,
  alter column legacy_review_required set default false,
  alter column retry_policy_version set default 1;

create index if not exists scheduled_email_queue_lease_due_idx
  on public.scheduled_email_queue(status, retry_enabled, next_retry_at, lease_expires_at, scheduled_at);

create index if not exists scheduled_email_queue_provider_message_idx
  on public.scheduled_email_queue(provider_message_id)
  where provider_message_id is not null;

create index if not exists email_logs_lease_retry_idx
  on public.email_logs(status, retry_enabled, next_retry_at, lease_expires_at, attempts);

create index if not exists email_logs_provider_message_idx
  on public.email_logs(provider_message_id)
  where provider_message_id is not null;

create table if not exists public.email_provider_events (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id text not null unique,
  provider_message_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  payload_sha256 text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists email_provider_events_message_idx
  on public.email_provider_events(provider_message_id, occurred_at);

alter table public.email_provider_events enable row level security;
revoke all on public.email_provider_events from public, anon, authenticated;
grant select, insert on public.email_provider_events to service_role;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

create table if not exists app_private.email_provider_webhook_configuration (
  provider text primary key,
  webhook_id text not null,
  endpoint text not null,
  signing_secret text not null,
  configured_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

revoke all on app_private.email_provider_webhook_configuration
  from public, anon, authenticated;
grant select, insert, update on app_private.email_provider_webhook_configuration
  to service_role;

create or replace function public.claim_scheduled_email_job_v1(
  target_job_id uuid,
  target_worker_invocation_id uuid,
  lease_seconds integer default 120,
  allow_failed boolean default false
)
returns setof public.scheduled_email_queue
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.scheduled_email_queue;
  lease_now timestamptz := now();
begin
  update public.scheduled_email_queue as job
  set
    status = 'sending',
    delivery_state = 'processing',
    lease_owner = target_worker_invocation_id::text,
    leased_at = lease_now,
    lease_expires_at = lease_now + make_interval(secs => greatest(30, least(coalesce(lease_seconds, 120), 900))),
    claim_attempt = job.claim_attempt + 1,
    worker_invocation_id = target_worker_invocation_id,
    updated_at = lease_now
  where job.id = target_job_id
    and (
      (
        job.status = 'scheduled'
        and job.scheduled_at <= lease_now
      )
      or (
        allow_failed
        and job.status = 'failed'
        and job.retry_enabled
        and not job.legacy_review_required
        and job.attempts < 4
        and job.next_retry_at is not null
        and job.next_retry_at <= lease_now
      )
      or (
        job.status = 'sending'
        and job.retry_enabled
        and not job.legacy_review_required
        and job.lease_expires_at is not null
        and job.lease_expires_at <= lease_now
      )
    )
  returning job.* into claimed;

  if claimed.id is not null then
    return next claimed;
  end if;
end;
$$;

create or replace function public.claim_email_retry_jobs_v1(
  target_worker_invocation_id uuid,
  lease_seconds integer default 120,
  batch_limit integer default 25
)
returns setof public.email_logs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lease_now timestamptz := now();
begin
  return query
  with candidates as (
    select log.id
    from public.email_logs as log
    where log.status = 'failed'
      and log.retry_enabled
      and not log.legacy_review_required
      and log.attempts < 4
      and log.next_retry_at is not null
      and log.next_retry_at <= lease_now
      and (
        log.lease_expires_at is null
        or log.lease_expires_at <= lease_now
      )
    order by log.next_retry_at, log.created_at
    for update skip locked
    limit greatest(1, least(coalesce(batch_limit, 25), 100))
  )
  update public.email_logs as log
  set
    is_processing = true,
    delivery_state = 'processing',
    lease_owner = target_worker_invocation_id::text,
    leased_at = lease_now,
    lease_expires_at = lease_now + make_interval(secs => greatest(30, least(coalesce(lease_seconds, 120), 900))),
    claim_attempt = log.claim_attempt + 1,
    worker_invocation_id = target_worker_invocation_id,
    updated_at = lease_now
  from candidates
  where log.id = candidates.id
  returning log.*;
end;
$$;

create or replace function public.record_email_provider_event_v1(
  webhook_event_id_value text,
  provider_message_id_value text,
  event_type_value text,
  occurred_at_value timestamptz,
  payload_sha256_value text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  normalized_type text := lower(btrim(coalesce(event_type_value, '')));
  resolved_state public.email_delivery_state_v1;
begin
  if btrim(coalesce(webhook_event_id_value, '')) = ''
    or btrim(coalesce(provider_message_id_value, '')) = ''
    or normalized_type not in (
      'email.delivered',
      'email.bounced',
      'email.complained',
      'email.delivery_delayed',
      'email.failed',
      'email.suppressed'
    ) then
    raise exception using errcode = '22023', message = 'invalid_email_provider_event';
  end if;

  insert into public.email_provider_events(
    webhook_event_id,
    provider_message_id,
    event_type,
    occurred_at,
    payload_sha256
  )
  values (
    btrim(webhook_event_id_value),
    btrim(provider_message_id_value),
    normalized_type,
    coalesce(occurred_at_value, timezone('utc', now())),
    btrim(payload_sha256_value)
  )
  on conflict (webhook_event_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    return false;
  end if;

  resolved_state := case normalized_type
    when 'email.delivered' then 'delivered'::public.email_delivery_state_v1
    when 'email.delivery_delayed' then 'deferred'::public.email_delivery_state_v1
    when 'email.bounced' then 'bounced'::public.email_delivery_state_v1
    when 'email.complained' then 'complained'::public.email_delivery_state_v1
    when 'email.suppressed' then 'suppressed'::public.email_delivery_state_v1
    else 'failed'::public.email_delivery_state_v1
  end;

  update public.email_delivery_jobs
  set
    status = case when resolved_state = 'delivered' then 'delivered' else status end,
    provider_status = replace(normalized_type, 'email.', ''),
    provider_delivered_at = case when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now())) else provider_delivered_at end,
    failure_category = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then replace(normalized_type, 'email.', '') else failure_category end,
    updated_at = timezone('utc', now())
  where provider_message_id = btrim(provider_message_id_value);

  update public.email_delivery_attempts
  set
    provider_status = replace(normalized_type, 'email.', ''),
    provider_delivered_at = case
      when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now()))
      else provider_delivered_at
    end
  where provider_message_id = btrim(provider_message_id_value);

  update public.email_logs
  set
    delivery_state = resolved_state,
    provider_delivered_at = case when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now())) else provider_delivered_at end,
    failure_category = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then replace(normalized_type, 'email.', '') else failure_category end,
    terminal_at = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then coalesce(occurred_at_value, timezone('utc', now())) else terminal_at end,
    updated_at = timezone('utc', now())
  where provider_message_id = btrim(provider_message_id_value);

  update public.scheduled_email_queue
  set
    delivery_state = resolved_state,
    provider_delivered_at = case when resolved_state = 'delivered' then coalesce(occurred_at_value, timezone('utc', now())) else provider_delivered_at end,
    failure_category = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then replace(normalized_type, 'email.', '') else failure_category end,
    terminal_at = case when resolved_state in ('failed', 'suppressed', 'bounced', 'complained') then coalesce(occurred_at_value, timezone('utc', now())) else terminal_at end,
    updated_at = timezone('utc', now())
  where provider_message_id = btrim(provider_message_id_value);

  return true;
end;
$$;

create or replace function public.configure_email_provider_webhook_v1(
  provider_value text,
  webhook_id_value text,
  endpoint_value text,
  signing_secret_value text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if lower(btrim(coalesce(provider_value, ''))) <> 'resend'
    or btrim(coalesce(webhook_id_value, '')) = ''
    or btrim(coalesce(endpoint_value, '')) = ''
    or btrim(coalesce(signing_secret_value, '')) = '' then
    raise exception using errcode = '22023', message = 'invalid_email_provider_webhook_configuration';
  end if;

  insert into app_private.email_provider_webhook_configuration(
    provider,
    webhook_id,
    endpoint,
    signing_secret,
    configured_at,
    updated_at
  )
  values (
    'resend',
    btrim(webhook_id_value),
    btrim(endpoint_value),
    btrim(signing_secret_value),
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (provider)
  do update set
    webhook_id = excluded.webhook_id,
    endpoint = excluded.endpoint,
    signing_secret = excluded.signing_secret,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.get_email_provider_webhook_secret_v1(
  provider_value text
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select configuration.signing_secret
  from app_private.email_provider_webhook_configuration as configuration
  where configuration.provider = lower(btrim(coalesce(provider_value, '')))
  limit 1;
$$;

revoke all on function public.claim_scheduled_email_job_v1(uuid, uuid, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.claim_email_retry_jobs_v1(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.record_email_provider_event_v1(text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.configure_email_provider_webhook_v1(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_email_provider_webhook_secret_v1(text)
  from public, anon, authenticated;

grant execute on function public.claim_scheduled_email_job_v1(uuid, uuid, integer, boolean)
  to service_role;
grant execute on function public.claim_email_retry_jobs_v1(uuid, integer, integer)
  to service_role;
grant execute on function public.record_email_provider_event_v1(text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.configure_email_provider_webhook_v1(text, text, text, text)
  to service_role;
grant execute on function public.get_email_provider_webhook_secret_v1(text)
  to service_role;

comment on column public.scheduled_email_queue.legacy_review_required is
  'True for pre-cutover failures. These rows are excluded from automatic and manual retry until separately reviewed.';

comment on column public.email_logs.legacy_review_required is
  'True for pre-cutover failures. These rows are excluded from automatic retry until separately reviewed.';

comment on table public.email_provider_events is
  'Verified, idempotent Resend lifecycle evidence without message bodies, recipient addresses or raw provider payloads.';
