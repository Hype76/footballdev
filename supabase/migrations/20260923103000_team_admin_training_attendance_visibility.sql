alter table public.team_staff
  add column if not exists show_in_training_attendance boolean not null default true;

alter table public.training_coach_attendance
  add column if not exists is_visible boolean not null default true;

comment on column public.team_staff.show_in_training_attendance is
  'Controls whether this Team Admin is included in upcoming Training Coach attendance lists and prompts.';

comment on column public.training_coach_attendance.is_visible is
  'False when the assigned Team Admin has opted out of upcoming Training Coach attendance.';

drop policy if exists training_coach_attendance_staff_select
on public.training_coach_attendance;

create policy training_coach_attendance_staff_select
on public.training_coach_attendance
for select
to authenticated
using (
  is_visible
  and public.training_availability_user_can_view(club_id, team_id)
);

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
    notification_status, notification_error, is_visible
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
    case when notifications_enabled then null else 'Coach assigned after the training invitation was created.' end,
    true
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
    and coalesce(assignment.show_in_training_attendance, true)
    and app_user.club_id = request_row.club_id
    and coalesce(app_user.status, 'active') = 'active'
    and app_user.role in ('assistant_coach', 'coach', 'manager', 'head_manager', 'admin')
  on conflict (request_id, coach_user_id) do update
  set coach_name = excluded.coach_name,
      is_visible = true,
      updated_at = timezone('utc', now());

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function app_private.sync_training_coach_attendance(uuid, boolean)
from public, anon, authenticated, service_role;

create or replace function public.get_own_training_attendance_visibility(
  team_id_value uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  visibility_value boolean;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in to view this Training attendance setting.';
  end if;

  select assignment.show_in_training_attendance
  into visibility_value
  from public.team_staff assignment
  join public.teams team on team.id = assignment.team_id
  join public.users app_user on app_user.id = assignment.user_id
  where assignment.team_id = team_id_value
    and assignment.user_id = actor_id
    and assignment.role_key = 'head_manager'
    and coalesce(assignment.role_rank, 0) >= 70
    and team.club_id = app_user.club_id
    and coalesce(app_user.status, 'active') = 'active'
  limit 1;

  if visibility_value is null then
    raise exception using errcode = '42501', message = 'Team Admin access is required to view this Training attendance setting.';
  end if;

  return visibility_value;
end;
$$;

revoke all on function public.get_own_training_attendance_visibility(uuid)
from public, anon;
grant execute on function public.get_own_training_attendance_visibility(uuid)
to authenticated;

create or replace function public.set_own_training_attendance_visibility(
  team_id_value uuid,
  visible_value boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  assignment_row public.team_staff%rowtype;
  assignment_club_id uuid;
  pending_request record;
  changed_at timestamptz := timezone('utc', now());
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in to change this Training attendance setting.';
  end if;

  select assignment.* into assignment_row
  from public.team_staff assignment
  join public.teams team on team.id = assignment.team_id
  join public.users app_user on app_user.id = assignment.user_id
  where assignment.team_id = team_id_value
    and assignment.user_id = actor_id
    and assignment.role_key = 'head_manager'
    and coalesce(assignment.role_rank, 0) >= 70
    and team.club_id = app_user.club_id
    and coalesce(app_user.status, 'active') = 'active'
  for update of assignment;

  if assignment_row.id is null then
    raise exception using errcode = '42501', message = 'Team Admin access is required to change this Training attendance setting.';
  end if;

  select team.club_id into assignment_club_id
  from public.teams team
  where team.id = assignment_row.team_id;

  update public.team_staff
  set show_in_training_attendance = coalesce(visible_value, true)
  where id = assignment_row.id;

  if coalesce(visible_value, true) then
    for pending_request in
      select request.id
      from public.training_availability_requests request
      join public.calendar_events event on event.id = request.calendar_event_id
      where request.team_id = team_id_value
        and request.status <> 'cancelled'
        and request.occurrence_starts_at > changed_at
        and event.event_type = 'training'
        and event.cancelled_at is null
    loop
      perform app_private.sync_training_coach_attendance(pending_request.id, false);
    end loop;
  else
    update public.training_coach_attendance attendance
    set is_visible = false,
        notification_eligible = false,
        notification_status = case
          when attendance.notification_status in ('pending', 'failed', 'sending') then 'skipped'
          else attendance.notification_status
        end,
        notification_error = case
          when attendance.notification_status in ('pending', 'failed', 'sending')
            then 'Team Admin disabled Training attendance visibility.'
          else attendance.notification_error
        end,
        notification_claimed_at = null,
        notification_claimed_by = null,
        updated_at = changed_at
    where attendance.team_id = team_id_value
      and attendance.coach_user_id = actor_id
      and attendance.occurrence_starts_at > changed_at;
  end if;

  insert into public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, metadata, created_at
  ) values (
    assignment_club_id,
    actor_id,
    'team_admin_training_attendance_visibility_updated',
    'team_staff',
    assignment_row.id,
    jsonb_build_object(
      'teamId', team_id_value,
      'visible', coalesce(visible_value, true)
    ),
    changed_at
  );

  return coalesce(visible_value, true);
end;
$$;

revoke all on function public.set_own_training_attendance_visibility(uuid, boolean)
from public, anon;
grant execute on function public.set_own_training_attendance_visibility(uuid, boolean)
to authenticated;
