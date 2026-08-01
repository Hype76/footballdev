create table if not exists public.training_availability_processor_work (
  id uuid primary key default gen_random_uuid(),
  work_key text not null unique,
  work_type text not null,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  setting_id uuid references public.training_availability_settings(id) on delete cascade,
  request_id uuid references public.training_availability_requests(id) on delete cascade,
  due_at timestamptz not null default now(),
  state text not null default 'pending',
  cursor_date date,
  revision bigint not null default 1,
  claim_owner uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  attempt_count integer not null default 0,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_availability_processor_work_type_check
    check (work_type in ('recurrence', 'request')),
  constraint training_availability_processor_work_state_check
    check (state in ('pending', 'claimed', 'retryable', 'completed', 'terminal')),
  constraint training_availability_processor_work_attempt_check
    check (attempt_count >= 0),
  constraint training_availability_processor_work_target_check
    check (
      (work_type = 'recurrence' and setting_id is not null and request_id is null)
      or
      (work_type = 'request' and request_id is not null)
    ),
  constraint training_availability_processor_work_claim_check
    check (
      (state = 'claimed' and claim_owner is not null and claimed_at is not null and claim_expires_at is not null)
      or
      (state <> 'claimed')
    )
);

create index if not exists training_availability_processor_work_due_idx
on public.training_availability_processor_work(state, due_at, claim_expires_at, id);

create index if not exists training_availability_processor_work_tenant_idx
on public.training_availability_processor_work(club_id, team_id, work_type, state);

alter table public.training_availability_processor_work enable row level security;
alter table public.training_availability_processor_work force row level security;

revoke all on table public.training_availability_processor_work from public, anon, authenticated;
grant select, insert, update, delete on table public.training_availability_processor_work to service_role;

create or replace function public.set_training_availability_processor_work_updated_at_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_training_availability_processor_work_updated_at_v1()
from public, anon, authenticated;

drop trigger if exists set_training_availability_processor_work_updated_at_v1
on public.training_availability_processor_work;

create trigger set_training_availability_processor_work_updated_at_v1
before update on public.training_availability_processor_work
for each row execute function public.set_training_availability_processor_work_updated_at_v1();

create or replace function public.queue_training_availability_recurrence_work_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  setting_record public.training_availability_settings%rowtype;
begin
  if tg_table_name = 'training_availability_settings' then
    setting_record := new;
  else
    select setting.*
    into setting_record
    from public.training_availability_settings setting
    where setting.calendar_event_id = new.id
    limit 1;
  end if;

  if setting_record.id is null then
    return new;
  end if;

  insert into public.training_availability_processor_work (
    work_key,
    work_type,
    club_id,
    team_id,
    setting_id,
    request_id,
    due_at,
    state,
    cursor_date,
    revision,
    completed_at,
    last_error_code
  )
  values (
    'recurrence:' || setting_record.id::text,
    'recurrence',
    setting_record.club_id,
    setting_record.team_id,
    setting_record.id,
    null,
    now(),
    'pending',
    null,
    1,
    null,
    null
  )
  on conflict (work_key)
  do update set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    setting_id = excluded.setting_id,
    due_at = excluded.due_at,
    state = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then 'claimed'
      else 'pending'
    end,
    cursor_date = null,
    revision = public.training_availability_processor_work.revision + 1,
    claim_owner = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then public.training_availability_processor_work.claim_owner
      else null
    end,
    claimed_at = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then public.training_availability_processor_work.claimed_at
      else null
    end,
    claim_expires_at = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then public.training_availability_processor_work.claim_expires_at
      else null
    end,
    completed_at = null,
    last_error_code = null;

  return new;
end;
$$;

revoke all on function public.queue_training_availability_recurrence_work_v1()
from public, anon, authenticated;

drop trigger if exists queue_training_availability_setting_work_v1
on public.training_availability_settings;

create trigger queue_training_availability_setting_work_v1
after insert or update of enabled, send_days_before, calendar_event_id, club_id, team_id
on public.training_availability_settings
for each row execute function public.queue_training_availability_recurrence_work_v1();

drop trigger if exists queue_training_availability_event_work_v1
on public.calendar_events;

create trigger queue_training_availability_event_work_v1
after update of club_id, team_id, event_type, starts_at, ends_at, recurrence_frequency, recurrence_until, cancelled_at
on public.calendar_events
for each row
when (old.event_type = 'training' or new.event_type = 'training')
execute function public.queue_training_availability_recurrence_work_v1();

create or replace function public.queue_training_availability_request_work_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_queue boolean := false;
  target_due_at timestamptz;
begin
  if new.status in ('sent', 'cancelled') then
    update public.training_availability_processor_work work
    set
      state = 'terminal',
      revision = work.revision + 1,
      claim_owner = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = now(),
      last_error_code = 'REQUEST_' || upper(new.status)
    where work.work_key = 'request:' || new.id::text;

    return new;
  end if;

  if tg_op = 'INSERT' then
    should_queue := new.status = 'pending';
    target_due_at := new.send_at;
  else
    should_queue := new.status in ('pending', 'queued', 'partial_failed')
      and (
        new.send_at is distinct from old.send_at
        or new.occurrence_starts_at is distinct from old.occurrence_starts_at
        or new.occurrence_ends_at is distinct from old.occurrence_ends_at
        or new.club_id is distinct from old.club_id
        or new.team_id is distinct from old.team_id
        or new.calendar_event_id is distinct from old.calendar_event_id
        or new.setting_id is distinct from old.setting_id
      );
    target_due_at := least(new.send_at, now());
  end if;

  if not should_queue then
    return new;
  end if;

  insert into public.training_availability_processor_work (
    work_key,
    work_type,
    club_id,
    team_id,
    setting_id,
    request_id,
    due_at,
    state,
    revision,
    completed_at,
    last_error_code
  )
  values (
    'request:' || new.id::text,
    'request',
    new.club_id,
    new.team_id,
    new.setting_id,
    new.id,
    target_due_at,
    'pending',
    1,
    null,
    null
  )
  on conflict (work_key)
  do update set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    setting_id = excluded.setting_id,
    request_id = excluded.request_id,
    due_at = excluded.due_at,
    state = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then 'claimed'
      else 'pending'
    end,
    revision = public.training_availability_processor_work.revision + 1,
    claim_owner = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then public.training_availability_processor_work.claim_owner
      else null
    end,
    claimed_at = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then public.training_availability_processor_work.claimed_at
      else null
    end,
    claim_expires_at = case
      when public.training_availability_processor_work.state = 'claimed'
        and public.training_availability_processor_work.claim_expires_at > now()
      then public.training_availability_processor_work.claim_expires_at
      else null
    end,
    completed_at = null,
    last_error_code = null;

  return new;
end;
$$;

revoke all on function public.queue_training_availability_request_work_v1()
from public, anon, authenticated;

drop trigger if exists queue_training_availability_request_work_v1
on public.training_availability_requests;

create trigger queue_training_availability_request_work_v1
after insert or update of status, send_at, occurrence_starts_at, occurrence_ends_at, club_id, team_id, calendar_event_id, setting_id
on public.training_availability_requests
for each row execute function public.queue_training_availability_request_work_v1();

create or replace function public.claim_training_availability_processor_work_v1(
  worker_id_value uuid,
  batch_size_value integer default 1,
  lease_seconds_value integer default 45
)
returns setof public.training_availability_processor_work
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_batch_size integer := least(10, greatest(1, coalesce(batch_size_value, 1)));
  normalized_lease_seconds integer := least(120, greatest(15, coalesce(lease_seconds_value, 45)));
begin
  if worker_id_value is null then
    raise exception using errcode = '22023', message = 'worker_id_required';
  end if;

  return query
  with candidates as (
    select work.id
    from public.training_availability_processor_work work
    where work.due_at <= now()
      and (
        work.state in ('pending', 'retryable')
        or (
          work.state = 'claimed'
          and work.claim_expires_at <= now()
        )
      )
    order by work.due_at, work.id
    for update skip locked
    limit normalized_batch_size
  ), claimed as (
    update public.training_availability_processor_work work
    set
      state = 'claimed',
      claim_owner = worker_id_value,
      claimed_at = now(),
      claim_expires_at = now() + make_interval(secs => normalized_lease_seconds),
      attempt_count = work.attempt_count + 1,
      last_error_code = null
    from candidates
    where work.id = candidates.id
    returning work.*
  )
  select claimed.*
  from claimed
  order by claimed.due_at, claimed.id;
end;
$$;

revoke all on function public.claim_training_availability_processor_work_v1(uuid, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_training_availability_processor_work_v1(uuid, integer, integer)
to service_role;

create or replace function public.complete_training_availability_processor_work_v1(
  work_id_value uuid,
  worker_id_value uuid,
  revision_value bigint,
  outcome_value text,
  cursor_date_value date default null,
  next_due_at_value timestamptz default null,
  error_code_value text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  work_record public.training_availability_processor_work%rowtype;
  normalized_outcome text := lower(btrim(coalesce(outcome_value, '')));
begin
  if normalized_outcome not in ('completed', 'pending', 'retryable', 'terminal') then
    raise exception using errcode = '22023', message = 'invalid_processor_work_outcome';
  end if;

  select work.*
  into work_record
  from public.training_availability_processor_work work
  where work.id = work_id_value
    and work.state = 'claimed'
    and work.claim_owner = worker_id_value
    and work.claim_expires_at > now()
  for update;

  if not found then
    return 'claim_lost';
  end if;

  if work_record.revision <> revision_value then
    update public.training_availability_processor_work work
    set
      state = 'pending',
      due_at = now(),
      cursor_date = null,
      claim_owner = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = null,
      last_error_code = 'WORK_SUPERSEDED'
    where work.id = work_record.id;

    return 'superseded';
  end if;

  update public.training_availability_processor_work work
  set
    state = normalized_outcome,
    due_at = case
      when normalized_outcome in ('pending', 'retryable')
      then coalesce(next_due_at_value, now())
      else work.due_at
    end,
    cursor_date = coalesce(cursor_date_value, work.cursor_date),
    claim_owner = null,
    claimed_at = null,
    claim_expires_at = null,
    completed_at = case
      when normalized_outcome in ('completed', 'terminal') then now()
      else null
    end,
    last_error_code = nullif(left(btrim(coalesce(error_code_value, '')), 120), '')
  where work.id = work_record.id;

  return normalized_outcome;
end;
$$;

revoke all on function public.complete_training_availability_processor_work_v1(uuid, uuid, bigint, text, date, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.complete_training_availability_processor_work_v1(uuid, uuid, bigint, text, date, timestamptz, text)
to service_role;

create or replace function public.get_training_availability_processor_backlog_v1()
returns table (
  candidate_due_count bigint,
  remaining_due_count bigint,
  active_claim_count bigint,
  oldest_due_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (
      where work.due_at <= now()
        and work.state in ('pending', 'retryable')
    ) as candidate_due_count,
    count(*) filter (
      where work.due_at <= now()
        and (
          work.state in ('pending', 'retryable')
          or (work.state = 'claimed' and work.claim_expires_at <= now())
        )
    ) as remaining_due_count,
    count(*) filter (
      where work.state = 'claimed'
        and work.claim_expires_at > now()
    ) as active_claim_count,
    min(work.due_at) filter (
      where work.due_at <= now()
        and (
          work.state in ('pending', 'retryable')
          or (work.state = 'claimed' and work.claim_expires_at <= now())
        )
    ) as oldest_due_at
  from public.training_availability_processor_work work;
$$;

revoke all on function public.get_training_availability_processor_backlog_v1()
from public, anon, authenticated;
grant execute on function public.get_training_availability_processor_backlog_v1()
to service_role;

insert into public.training_availability_processor_work (
  work_key,
  work_type,
  club_id,
  team_id,
  setting_id,
  request_id,
  due_at,
  state,
  cursor_date
)
select
  'recurrence:' || setting.id::text,
  'recurrence',
  setting.club_id,
  setting.team_id,
  setting.id,
  null,
  now(),
  'pending',
  null
from public.training_availability_settings setting
where setting.enabled = true
on conflict (work_key) do nothing;

insert into public.training_availability_processor_work (
  work_key,
  work_type,
  club_id,
  team_id,
  setting_id,
  request_id,
  due_at,
  state
)
select
  'request:' || request.id::text,
  'request',
  request.club_id,
  request.team_id,
  request.setting_id,
  request.id,
  request.send_at,
  'pending'
from public.training_availability_requests request
where request.status = 'pending'
on conflict (work_key) do nothing;

comment on table public.training_availability_processor_work is
  'Service-only durable coordination for bounded Training Availability recurrence and due request work.';

comment on function public.claim_training_availability_processor_work_v1(uuid, integer, integer) is
  'Atomically claims only due Training Availability processor work with SKIP LOCKED and a recoverable lease.';

comment on function public.complete_training_availability_processor_work_v1(uuid, uuid, bigint, text, date, timestamptz, text) is
  'Completes, retries, terminals, or checkpoints one owned Training Availability work item without stealing a newer revision.';
