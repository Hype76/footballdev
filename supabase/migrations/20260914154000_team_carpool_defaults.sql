alter table public.teams add column if not exists carpool_enabled boolean not null default true;
alter table public.match_days add column if not exists carpool_enabled boolean;
update public.match_days set carpool_enabled = true where carpool_enabled is null;

create or replace function public.get_team_carpool_default(team_id_value uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare team_row public.teams%rowtype;
begin
  select * into team_row from public.teams where id = team_id_value and archived_at is null;
  if auth.uid() is null or team_row.id is null or not app_private.actor_can_manage_team_resource(auth.uid(), team_row.club_id, team_row.id, 20) then
    raise exception using errcode = '42501', message = 'Coach access is required for this team.';
  end if;
  return team_row.carpool_enabled;
end;
$$;

create or replace function public.set_team_carpool_default(team_id_value uuid, enabled_value boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.get_team_carpool_default(team_id_value);
  if enabled_value is null then raise exception 'Choose whether Car pool is enabled.'; end if;
  update public.teams set carpool_enabled = enabled_value where id = team_id_value;
  return enabled_value;
end;
$$;
revoke all on function public.get_team_carpool_default(uuid), public.set_team_carpool_default(uuid,boolean) from public, anon;
grant execute on function public.get_team_carpool_default(uuid), public.set_team_carpool_default(uuid,boolean) to authenticated;

create or replace function app_private.inherit_match_carpool_default()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.carpool_enabled is null then
    select carpool_enabled into new.carpool_enabled from public.teams where id = new.team_id;
    new.carpool_enabled := coalesce(new.carpool_enabled, true);
  end if;
  return new;
end;
$$;
revoke all on function app_private.inherit_match_carpool_default() from public, anon, authenticated;
create trigger inherit_match_carpool_default before insert on public.match_days
for each row execute function app_private.inherit_match_carpool_default();
alter table public.match_days alter column carpool_enabled set not null;

-- Preserve existing request authorization and return shapes for installed clients.
create or replace function public.get_parent_portal_match_transport_states_v2(parent_link_id_value uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(state) || jsonb_build_object('carpool_enabled', fixture.carpool_enabled)), '[]'::jsonb)
  from public.get_parent_portal_match_transport_states(parent_link_id_value) state
  join public.match_days fixture on fixture.id = state.match_day_id;
$$;
revoke all on function public.get_parent_portal_match_transport_states_v2(uuid) from public, anon;
grant execute on function public.get_parent_portal_match_transport_states_v2(uuid) to authenticated;

do $$
declare definition text;
begin
  select pg_get_functiondef('public.update_match_day_fixture_for_team(uuid,uuid,jsonb)'::regprocedure) into definition;
  if position('set arrival_time = arrival_time_value,' in definition) = 0 then raise exception 'Fixture update marker missing'; end if;
  definition := replace(definition, 'set arrival_time = arrival_time_value,', 'set arrival_time = arrival_time_value,
      carpool_enabled = case when p_fixture ? ''carpoolEnabled'' then (p_fixture->>''carpoolEnabled'')::boolean else match_day.carpool_enabled end,');
  execute definition;
  select pg_get_functiondef('public.set_parent_portal_match_transport(uuid,uuid,text,integer)'::regprocedure) into definition;
  if position('if fixture_row.id is null' in definition) = 0 then raise exception 'Carpool authorization marker missing'; end if;
  definition := replace(definition, 'if fixture_row.id is null', 'if fixture_row.id is null or not fixture_row.carpool_enabled');
  execute definition;
end;
$$;
