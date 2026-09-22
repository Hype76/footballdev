alter table public.training_coach_attendance
  add column notification_eligible boolean not null default false;

update public.training_coach_attendance
set notification_status = 'skipped',
    notification_error = 'Existing training occurrence. No Coach push notification sent.',
    notification_claimed_at = null,
    notification_claimed_by = null,
    updated_at = timezone('utc', now())
where notification_status in ('pending', 'failed', 'sending');

create or replace function app_private.sync_training_coach_attendance(
  request_id_value uuid,
  notifications_enabled boolean
)
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
    occurrence_starts_at, coach_user_id, coach_name, notification_eligible,
    notification_status, notification_error
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
    ),
    notifications_enabled,
    case when notifications_enabled then 'pending' else 'skipped' end,
    case when notifications_enabled then null else 'Coach assigned after the training invitation was created.' end
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

revoke all on function app_private.sync_training_coach_attendance(uuid, boolean)
from public, anon, authenticated, service_role;

create or replace function app_private.sync_training_coach_attendance(request_id_value uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select app_private.sync_training_coach_attendance(request_id_value, false)
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
  perform app_private.sync_training_coach_attendance(new.id, true);
  return new;
end;
$$;

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
    perform app_private.sync_training_coach_attendance(pending_request.id, false);
  end loop;
  return new;
end;
$$;

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
  where attendance.notification_eligible
    and attendance.notification_status in ('pending', 'failed', 'sending')
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
    where attendance.notification_eligible
      and attendance.notification_attempts < 5
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

comment on column public.training_coach_attendance.notification_eligible is
  'True only when the training occurrence is newly generated after Coach attendance notifications are enabled. Existing occurrences and later staff assignments remain silent.';
