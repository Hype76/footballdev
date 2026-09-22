create table public.training_coach_attendance (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.training_availability_requests (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events (id) on delete cascade,
  occurrence_date date not null,
  occurrence_starts_at timestamptz not null,
  coach_user_id uuid not null references public.users (id) on delete cascade,
  coach_name text not null,
  status text not null default 'pending',
  responded_at timestamptz,
  notification_status text not null default 'pending',
  notification_sent_at timestamptz,
  notification_error text,
  notification_attempts integer not null default 0,
  notification_claimed_at timestamptz,
  notification_claimed_by uuid,
  next_notification_attempt_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint training_coach_attendance_status_check
    check (status in ('pending', 'available', 'unavailable')),
  constraint training_coach_attendance_notification_status_check
    check (notification_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  constraint training_coach_attendance_response_shape_check
    check ((status = 'pending' and responded_at is null) or (status <> 'pending' and responded_at is not null)),
  unique (request_id, coach_user_id)
);

create index training_coach_attendance_event_occurrence_idx
on public.training_coach_attendance (calendar_event_id, occurrence_date, team_id);

create index training_coach_attendance_notification_due_idx
on public.training_coach_attendance (notification_status, next_notification_attempt_at, created_at)
where notification_status in ('pending', 'failed', 'sending');

alter table public.training_coach_attendance enable row level security;
alter table public.training_coach_attendance force row level security;

revoke all on public.training_coach_attendance from public, anon, authenticated;
grant select on public.training_coach_attendance to authenticated;
grant select, insert, update, delete on public.training_coach_attendance to service_role;

create policy training_coach_attendance_staff_select
on public.training_coach_attendance
for select
to authenticated
using (public.training_availability_user_can_view(club_id, team_id));

create or replace function app_private.sync_training_coach_attendance(request_id_value uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.training_availability_requests%rowtype;
  inserted_count integer := 0;
begin
  select request.* into request_row
  from public.training_availability_requests request
  where request.id = request_id_value
    and request.status <> 'cancelled'
  limit 1;

  if request_row.id is null then
    return 0;
  end if;

  insert into public.training_coach_attendance (
    request_id, club_id, team_id, calendar_event_id, occurrence_date,
    occurrence_starts_at, coach_user_id, coach_name
  )
  select
    request_row.id,
    request_row.club_id,
    request_row.team_id,
    request_row.calendar_event_id,
    request_row.occurrence_date,
    request_row.occurrence_starts_at,
    app_user.id,
    coalesce(
      nullif(btrim(app_user.name), ''),
      nullif(btrim(app_user.username), ''),
      nullif(btrim(app_user.email), ''),
      'Coach'
    )
  from public.team_staff assignment
  join public.users app_user on app_user.id = assignment.user_id
  join public.calendar_events event
    on event.id = request_row.calendar_event_id
   and event.club_id = request_row.club_id
   and event.team_id = request_row.team_id
   and event.event_type = 'training'
   and event.cancelled_at is null
  where assignment.team_id = request_row.team_id
    and coalesce(assignment.role_rank, 0) >= 20
    and app_user.club_id = request_row.club_id
    and coalesce(app_user.status, 'active') = 'active'
    and app_user.role in ('assistant_coach', 'coach', 'manager', 'head_manager', 'admin')
  on conflict (request_id, coach_user_id) do update
  set coach_name = excluded.coach_name,
      updated_at = timezone('utc', now());

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function app_private.sync_training_coach_attendance(uuid)
from public, anon, authenticated;
grant execute on function app_private.sync_training_coach_attendance(uuid)
to service_role;

create or replace function app_private.sync_training_coach_attendance_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_training_coach_attendance(new.id);
  return new;
end;
$$;

revoke all on function app_private.sync_training_coach_attendance_trigger()
from public, anon, authenticated, service_role;

create trigger sync_training_coach_attendance_after_request
after insert on public.training_availability_requests
for each row execute function app_private.sync_training_coach_attendance_trigger();

create or replace function app_private.sync_training_coach_attendance_after_staff_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_request record;
begin
  for pending_request in
    select request.id
    from public.training_availability_requests request
    join public.calendar_events event on event.id = request.calendar_event_id
    where request.team_id = new.team_id
      and request.status <> 'cancelled'
      and request.occurrence_starts_at > timezone('utc', now())
      and event.event_type = 'training'
      and event.cancelled_at is null
  loop
    perform app_private.sync_training_coach_attendance(pending_request.id);
  end loop;
  return new;
end;
$$;

revoke all on function app_private.sync_training_coach_attendance_after_staff_change()
from public, anon, authenticated, service_role;

create trigger sync_training_coach_attendance_after_staff_change
after insert or update of team_id, user_id, role_key, role_rank on public.team_staff
for each row execute function app_private.sync_training_coach_attendance_after_staff_change();

select app_private.sync_training_coach_attendance(request.id)
from public.training_availability_requests request
where request.status <> 'cancelled'
  and request.occurrence_starts_at > timezone('utc', now());

create or replace function public.submit_own_training_coach_attendance(
  attendance_id_value uuid,
  status_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  attendance_row public.training_coach_attendance%rowtype;
  previous_status text;
  response_time timestamptz := timezone('utc', now());
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in to respond to this training invitation.';
  end if;
  if normalized_status not in ('available', 'unavailable') then
    raise exception 'Choose Attending or Not attending.';
  end if;

  select attendance.* into attendance_row
  from public.training_coach_attendance attendance
  where attendance.id = attendance_id_value
    and attendance.coach_user_id = actor_id
  for update;

  if attendance_row.id is null then
    raise exception using errcode = '42501', message = 'This training invitation is not assigned to your Coach account.';
  end if;
  if attendance_row.occurrence_starts_at <= response_time
    or not exists (
      select 1 from public.training_availability_requests request
      join public.calendar_events event on event.id = request.calendar_event_id
      where request.id = attendance_row.request_id
        and request.status <> 'cancelled'
        and event.event_type = 'training'
        and event.cancelled_at is null
    ) then
    raise exception 'This training invitation is no longer open.';
  end if;
  if not exists (
    select 1
    from public.users app_user
    join public.team_staff assignment
      on assignment.user_id = app_user.id
     and assignment.team_id = attendance_row.team_id
     and coalesce(assignment.role_rank, 0) >= 20
    where app_user.id = actor_id
      and app_user.club_id = attendance_row.club_id
      and coalesce(app_user.status, 'active') = 'active'
      and app_user.role in ('assistant_coach', 'coach', 'manager', 'head_manager', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Active Team Coach access is required.';
  end if;

  previous_status := attendance_row.status;
  if previous_status = normalized_status then
    return jsonb_build_object(
      'attendanceId', attendance_row.id,
      'changed', false,
      'previousStatus', previous_status,
      'respondedAt', attendance_row.responded_at,
      'status', normalized_status
    );
  end if;

  update public.training_coach_attendance
  set status = normalized_status,
      responded_at = response_time,
      updated_at = response_time
  where id = attendance_row.id;

  insert into public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, metadata, created_at
  ) values (
    attendance_row.club_id,
    actor_id,
    'training_coach_attendance_updated',
    'calendar_event',
    attendance_row.calendar_event_id,
    jsonb_build_object(
      'attendanceId', attendance_row.id,
      'occurrenceDate', attendance_row.occurrence_date,
      'previousStatus', previous_status,
      'newStatus', normalized_status,
      'teamId', attendance_row.team_id
    ),
    response_time
  );

  return jsonb_build_object(
    'attendanceId', attendance_row.id,
    'changed', true,
    'previousStatus', previous_status,
    'respondedAt', response_time,
    'status', normalized_status
  );
end;
$$;

revoke all on function public.submit_own_training_coach_attendance(uuid, text)
from public, anon;
grant execute on function public.submit_own_training_coach_attendance(uuid, text)
to authenticated;

create or replace function public.claim_training_coach_attendance_notifications(
  worker_id_value uuid,
  batch_size_value integer default 25,
  lease_seconds_value integer default 90
)
returns setof public.training_coach_attendance
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.training_coach_attendance attendance
  set notification_status = 'skipped',
      notification_error = 'Coach access or training occurrence is no longer active.',
      updated_at = timezone('utc', now())
  where attendance.notification_status in ('pending', 'failed', 'sending')
    and (
      attendance.occurrence_starts_at <= timezone('utc', now())
      or not exists (
        select 1 from public.users app_user
        join public.team_staff assignment
          on assignment.user_id = app_user.id
         and assignment.team_id = attendance.team_id
         and coalesce(assignment.role_rank, 0) >= 20
        where app_user.id = attendance.coach_user_id
          and app_user.club_id = attendance.club_id
          and coalesce(app_user.status, 'active') = 'active'
      )
    );

  return query
  with due as (
    select attendance.id
    from public.training_coach_attendance attendance
    where attendance.notification_attempts < 5
      and attendance.next_notification_attempt_at <= timezone('utc', now())
      and (
        attendance.notification_status in ('pending', 'failed')
        or (
          attendance.notification_status = 'sending'
          and attendance.notification_claimed_at < timezone('utc', now()) - make_interval(secs => greatest(30, lease_seconds_value))
        )
      )
    order by attendance.next_notification_attempt_at, attendance.created_at
    for update skip locked
    limit least(100, greatest(1, batch_size_value))
  )
  update public.training_coach_attendance attendance
  set notification_status = 'sending',
      notification_claimed_at = timezone('utc', now()),
      notification_claimed_by = worker_id_value,
      notification_attempts = attendance.notification_attempts + 1,
      updated_at = timezone('utc', now())
  from due
  where attendance.id = due.id
  returning attendance.*;
end;
$$;

revoke all on function public.claim_training_coach_attendance_notifications(uuid, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_training_coach_attendance_notifications(uuid, integer, integer)
to service_role;

create or replace function public.complete_training_coach_attendance_notification(
  attendance_id_value uuid,
  worker_id_value uuid,
  outcome_value text,
  error_value text default ''
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_outcome text := lower(btrim(coalesce(outcome_value, '')));
  affected integer := 0;
begin
  if normalized_outcome not in ('sent', 'failed', 'skipped') then
    raise exception 'Choose a valid notification outcome.';
  end if;

  update public.training_coach_attendance
  set notification_status = normalized_outcome,
      notification_sent_at = case when normalized_outcome = 'sent' then timezone('utc', now()) else notification_sent_at end,
      notification_error = nullif(btrim(coalesce(error_value, '')), ''),
      next_notification_attempt_at = case
        when normalized_outcome = 'failed' then timezone('utc', now()) + interval '5 minutes'
        else next_notification_attempt_at
      end,
      notification_claimed_at = null,
      notification_claimed_by = null,
      updated_at = timezone('utc', now())
  where id = attendance_id_value
    and notification_status = 'sending'
    and notification_claimed_by = worker_id_value;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.complete_training_coach_attendance_notification(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.complete_training_coach_attendance_notification(uuid, uuid, text, text)
to service_role;

comment on table public.training_coach_attendance is
  'One Team Coach attendance invitation per generated training occurrence. Coaches may update only their own response through the guarded RPC.';
