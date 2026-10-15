create table app_private.user_match_selection_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  auto_select_available_players boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  unique nulls not distinct (user_id, club_id, team_id)
);

alter table app_private.user_match_selection_preferences enable row level security;
revoke all on table app_private.user_match_selection_preferences from public, anon, authenticated, service_role;

create function public.get_own_match_selection_preference(club_id_value uuid, team_id_value uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  preference app_private.user_match_selection_preferences%rowtype;
begin
  if actor_id is null or app_private.actor_can_manage_team_resource(actor_id, club_id_value, team_id_value, 20) is not true then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this fixture scope.';
  end if;

  if team_id_value is not null and not exists (
    select 1 from public.teams team
    where team.id = team_id_value and team.club_id = club_id_value
      and team.archived_at is null and coalesce(team.status, 'active') = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this fixture scope.';
  end if;

  select stored.* into preference
  from app_private.user_match_selection_preferences stored
  where stored.user_id = actor_id and stored.club_id = club_id_value
    and stored.team_id is not distinct from team_id_value;

  return jsonb_build_object(
    'found', preference.id is not null,
    'autoSelectAvailablePlayers', coalesce(preference.auto_select_available_players, false),
    'updatedAt', preference.updated_at
  );
end;
$$;

alter function public.get_own_match_selection_preference(uuid, uuid) owner to postgres;
revoke all on function public.get_own_match_selection_preference(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_own_match_selection_preference(uuid, uuid) to authenticated;

create function app_private.remember_match_selection_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or app_private.actor_can_manage_team_resource(actor_id, new.club_id, new.team_id, 20) is not true then
    return new;
  end if;

  if new.team_id is not null and not exists (
    select 1 from public.teams team
    where team.id = new.team_id and team.club_id = new.club_id
      and team.archived_at is null and coalesce(team.status, 'active') = 'active'
  ) then
    return new;
  end if;

  insert into app_private.user_match_selection_preferences as preference (
    user_id, club_id, team_id, auto_select_available_players, updated_at
  ) values (
    actor_id, new.club_id, new.team_id, new.auto_select_available_players, clock_timestamp()
  )
  on conflict (user_id, club_id, team_id) do update
    set auto_select_available_players = excluded.auto_select_available_players,
        updated_at = excluded.updated_at;
  return new;
end;
$$;

alter function app_private.remember_match_selection_preference() owner to postgres;
revoke all on function app_private.remember_match_selection_preference() from public, anon, authenticated, service_role;

create trigger remember_match_selection_preference
after insert or update of auto_select_available_players on public.match_days
for each row execute function app_private.remember_match_selection_preference();

comment on table app_private.user_match_selection_preferences is
  'Private per-staff fixture selection defaults, committed atomically with successful fixture saves. Null team means club-wide.';
