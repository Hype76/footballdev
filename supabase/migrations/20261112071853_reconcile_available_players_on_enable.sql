create function app_private.reconcile_available_players_on_enable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
begin
  if old.auto_select_available_players is true or new.auto_select_available_players is not true then
    return new;
  end if;

  if actor_id is null or app_private.actor_can_manage_team_resource(actor_id, new.club_id, new.team_id, 20) is not true then
    raise exception using errcode = '42501', message = 'Coach or manager access is required for this fixture scope.';
  end if;

  if new.deleted_at is not null or new.previous_hidden_at is not null
    or new.status not in ('scheduled', 'scorer_request') then
    return new;
  end if;

  select coalesce(nullif(btrim(profile.name), ''), 'Coach') into actor_name
  from public.users profile where profile.id = actor_id;
  actor_name := coalesce(actor_name, 'Coach');

  insert into public.match_day_player_squad_decisions as decision
    (match_day_id, club_id, team_id, player_id, status, decided_by, decided_by_name, decided_at, updated_at)
  select new.id, new.club_id, new.team_id, player.id, 'selected', actor_id, actor_name, now(), now()
  from public.match_day_player_availability availability
  join public.players player on player.id = availability.player_id
    and player.club_id = new.club_id and player.team_id = new.team_id
  where availability.match_day_id = new.id
    and availability.club_id = new.club_id and availability.team_id = new.team_id
    and availability.status = 'available'
    and private.player_type_allows_event(player.id, 'match-day', new.id)
    and (exists (
      select 1 from public.calendar_event_invites invite
      where invite.match_day_id = new.id and invite.club_id = new.club_id
        and invite.team_id = new.team_id and invite.player_id = player.id
        and invite.invite_status <> 'cancelled' and invite.cancelled_at is null
    ) or exists (
      select 1 from public.match_day_availability_requests request
      where request.match_day_id = new.id and request.club_id = new.club_id
        and request.team_id is not distinct from new.team_id and request.player_id = player.id
        and request.status <> 'expired'
    ))
  on conflict on constraint match_day_player_squad_decisions_match_player_key
  do update set status = 'selected', club_id = excluded.club_id, team_id = excluded.team_id,
    decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name,
    decided_at = excluded.decided_at, updated_at = excluded.updated_at
  where decision.status <> 'selected';

  return new;
end;
$$;

revoke all on function app_private.reconcile_available_players_on_enable() from public, anon, authenticated, service_role;

create trigger reconcile_available_players_on_enable
after update of auto_select_available_players on public.match_days
for each row execute function app_private.reconcile_available_players_on_enable();
