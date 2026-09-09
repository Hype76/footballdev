create table app_private.coach_squad_templates (
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  player_ids uuid[] not null check (cardinality(player_ids) between 1 and 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, team_id, name)
);
alter table app_private.coach_squad_templates enable row level security;
revoke all on app_private.coach_squad_templates from public, anon, authenticated, service_role;

create function public.own_coach_squad_templates(team_id_value uuid, action_value text default 'list', name_value text default '', player_ids_value uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_team public.teams%rowtype;
  clean_name text := btrim(name_value);
  clean_ids uuid[];
begin
  select * into target_team from public.teams where id = team_id_value and archived_at is null for update;
  if actor_id is null or target_team.id is null or not app_private.actor_can_manage_team_resource(actor_id, target_team.club_id, target_team.id, 20) then
    raise exception using errcode = '42501', message = 'Coach access to this team is required.';
  end if;
  if action_value not in ('list', 'save', 'delete') or action_value is null then
    raise exception 'Choose a valid template action.';
  end if;
  if action_value <> 'list' and (clean_name is null or length(clean_name) not between 1 and 60) then
    raise exception 'Enter a template name of 1 to 60 characters.';
  end if;
  if action_value = 'save' then
    select array_agg(distinct id order by id) into clean_ids from unnest(player_ids_value) id;
    if coalesce(cardinality(clean_ids), 0) not between 1 and 200 or exists (
      select 1 from unnest(clean_ids) candidate(player_id) where not exists (
        select 1 from public.players player where player.id = candidate.player_id and player.team_id = target_team.id
          and player.club_id = target_team.club_id and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
      )
    ) then raise exception 'Choose current players from this team.'; end if;
    if not exists(select 1 from app_private.coach_squad_templates where user_id = actor_id and team_id = target_team.id and name = clean_name)
      and (select count(*) from app_private.coach_squad_templates where user_id = actor_id and team_id = target_team.id) >= 30 then
      raise exception 'You can save up to 30 templates per team.';
    end if;
    insert into app_private.coach_squad_templates(user_id, team_id, name, player_ids)
    values(actor_id, target_team.id, clean_name, clean_ids)
    on conflict(user_id, team_id, name) do update set player_ids = excluded.player_ids, updated_at = now();
  elsif action_value = 'delete' then
    delete from app_private.coach_squad_templates where user_id = actor_id and team_id = target_team.id and name = clean_name;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', name, 'playerIds', player_ids, 'updatedAt', updated_at) order by lower(name), name)
    from app_private.coach_squad_templates where user_id = actor_id and team_id = target_team.id), '[]'::jsonb);
end;
$$;
revoke all on function public.own_coach_squad_templates(uuid, text, text, uuid[]) from public, anon, service_role;
grant execute on function public.own_coach_squad_templates(uuid, text, text, uuid[]) to authenticated;

alter table public.calendar_events add column notes_pinned boolean not null default false;
comment on column public.calendar_events.notes_pinned is 'Highlights the existing shared notes. Recurring dates share the same notes and pin state.';

create function public.get_parent_portal_calendar_event_details_v2(parent_link_id_value uuid)
returns table(id uuid, notes text, notes_pinned boolean)
language sql stable security definer set search_path = '' as $$
  select details.id, details.notes, event.notes_pinned
  from public.get_parent_portal_calendar_event_details(parent_link_id_value) details
  join public.calendar_events event on event.id = details.id;
$$;
revoke all on function public.get_parent_portal_calendar_event_details_v2(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_calendar_event_details_v2(uuid) to authenticated;

create function public.get_own_coach_notification_history(club_id_value uuid, team_id_value uuid default null)
returns table(id bigint, title text, body text, data jsonb, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app_private.actor_can_manage_team_resource(auth.uid(), club_id_value, team_id_value, 20)
    or (team_id_value is not null and not exists(select 1 from public.teams where teams.id = team_id_value and teams.club_id = club_id_value and teams.archived_at is null)) then
    raise exception using errcode = '42501', message = 'Active Coach access is required.';
  end if;
  return query select event.id, event.title, event.body, event.data, event.created_at
  from public.coach_mobile_notification_events event
  where event.auth_user_id = auth.uid() and event.club_id = club_id_value
    and event.team_id is not distinct from team_id_value
  order by event.created_at desc, event.id desc limit 150;
end;
$$;
revoke all on function public.get_own_coach_notification_history(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_own_coach_notification_history(uuid, uuid) to authenticated;
