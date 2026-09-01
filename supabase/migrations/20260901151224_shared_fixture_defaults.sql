create table if not exists app_private.user_team_fixture_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  arrival_preset text not null default '30',
  arrival_time time without time zone,
  duration_minutes integer not null default 90,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, team_id),
  constraint user_team_fixture_preferences_arrival_preset_check
    check (arrival_preset in ('15', '30', '45', '60', 'custom')),
  constraint user_team_fixture_preferences_custom_arrival_check
    check (arrival_preset <> 'custom' or arrival_time is not null),
  constraint user_team_fixture_preferences_duration_check
    check (duration_minutes between 20 and 140 and mod(duration_minutes, 2) = 0)
);

create index if not exists user_team_fixture_preferences_team_idx
  on app_private.user_team_fixture_preferences (team_id, user_id);

revoke all on table app_private.user_team_fixture_preferences from public, anon, authenticated, service_role;

comment on table app_private.user_team_fixture_preferences is
  'Private per-Coach, per-Team fixture defaults shared by the web and Coach mobile clients.';

create or replace function public.get_own_team_fixture_preferences(team_id_value uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_team public.teams%rowtype;
  preferences app_private.user_team_fixture_preferences%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select team.* into target_team
  from public.teams team
  where team.id = team_id_value
    and team.archived_at is null
  limit 1;

  if target_team.id is null
    or not app_private.actor_can_manage_team_resource(
      actor_id,
      target_team.club_id,
      target_team.id,
      20
    ) then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this Team.';
  end if;

  select stored.* into preferences
  from app_private.user_team_fixture_preferences stored
  where stored.user_id = actor_id
    and stored.team_id = target_team.id;

  if preferences.user_id is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'arrivalPreset', preferences.arrival_preset,
    'arrivalTime', case
      when preferences.arrival_time is null then ''
      else to_char(preferences.arrival_time, 'HH24:MI')
    end,
    'duration', preferences.duration_minutes,
    'updatedAt', preferences.updated_at
  );
end;
$$;

create or replace function public.set_own_team_fixture_preferences(
  team_id_value uuid,
  save_arrival_value boolean,
  arrival_preset_value text,
  arrival_time_value time without time zone,
  save_duration_value boolean,
  duration_minutes_value integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_team public.teams%rowtype;
  normalized_arrival_preset text := btrim(coalesce(arrival_preset_value, ''));
  saved app_private.user_team_fixture_preferences%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select team.* into target_team
  from public.teams team
  where team.id = team_id_value
    and team.archived_at is null
  for update;

  if target_team.id is null
    or not app_private.actor_can_manage_team_resource(
      actor_id,
      target_team.club_id,
      target_team.id,
      20
    ) then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this Team.';
  end if;

  if coalesce(save_arrival_value, false) = false
    and coalesce(save_duration_value, false) = false then
    raise exception using errcode = '22023', message = 'Choose at least one fixture default to save.';
  end if;

  if coalesce(save_arrival_value, false) then
    if normalized_arrival_preset not in ('15', '30', '45', '60', 'custom') then
      raise exception using errcode = '22023', message = 'Choose a supported arrival default.';
    end if;

    if normalized_arrival_preset = 'custom' and arrival_time_value is null then
      raise exception using errcode = '22023', message = 'Add the custom arrival time.';
    end if;
  end if;

  if coalesce(save_duration_value, false)
    and (
      duration_minutes_value is null
      or duration_minutes_value < 20
      or duration_minutes_value > 140
      or mod(duration_minutes_value, 2) <> 0
    ) then
    raise exception using errcode = '22023', message = 'Match duration must be an even number from 20 to 140 minutes.';
  end if;

  insert into app_private.user_team_fixture_preferences as preferences (
    user_id,
    club_id,
    team_id,
    arrival_preset,
    arrival_time,
    duration_minutes,
    updated_at
  )
  values (
    actor_id,
    target_team.club_id,
    target_team.id,
    case when coalesce(save_arrival_value, false) then normalized_arrival_preset else '30' end,
    case
      when coalesce(save_arrival_value, false) and normalized_arrival_preset = 'custom'
        then arrival_time_value
      else null
    end,
    case when coalesce(save_duration_value, false) then duration_minutes_value else 90 end,
    timezone('utc', now())
  )
  on conflict (user_id, team_id) do update
  set arrival_preset = case
        when coalesce(save_arrival_value, false) then excluded.arrival_preset
        else preferences.arrival_preset
      end,
      arrival_time = case
        when coalesce(save_arrival_value, false) then excluded.arrival_time
        else preferences.arrival_time
      end,
      duration_minutes = case
        when coalesce(save_duration_value, false) then excluded.duration_minutes
        else preferences.duration_minutes
      end,
      club_id = excluded.club_id,
      updated_at = timezone('utc', now())
  returning * into saved;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_team.club_id,
    actor_id,
    'own_team_fixture_preferences_updated',
    'team',
    target_team.id,
    jsonb_build_object(
      'arrivalSaved', coalesce(save_arrival_value, false),
      'arrivalPreset', saved.arrival_preset,
      'durationSaved', coalesce(save_duration_value, false),
      'durationMinutes', saved.duration_minutes
    )
  );

  return jsonb_build_object(
    'found', true,
    'arrivalPreset', saved.arrival_preset,
    'arrivalTime', case
      when saved.arrival_time is null then ''
      else to_char(saved.arrival_time, 'HH24:MI')
    end,
    'duration', saved.duration_minutes,
    'updatedAt', saved.updated_at
  );
end;
$$;

alter function public.get_own_team_fixture_preferences(uuid) owner to postgres;
alter function public.set_own_team_fixture_preferences(uuid, boolean, text, time without time zone, boolean, integer) owner to postgres;

revoke all on function public.get_own_team_fixture_preferences(uuid) from public, anon, service_role;
revoke all on function public.set_own_team_fixture_preferences(uuid, boolean, text, time without time zone, boolean, integer) from public, anon, service_role;
grant execute on function public.get_own_team_fixture_preferences(uuid) to authenticated;
grant execute on function public.set_own_team_fixture_preferences(uuid, boolean, text, time without time zone, boolean, integer) to authenticated;

comment on function public.get_own_team_fixture_preferences(uuid) is
  'Returns only the signed-in Coach fixture defaults for one authorised Team.';
comment on function public.set_own_team_fixture_preferences(uuid, boolean, text, time without time zone, boolean, integer) is
  'Validates and stores the signed-in Coach fixture defaults for one authorised Team.';
