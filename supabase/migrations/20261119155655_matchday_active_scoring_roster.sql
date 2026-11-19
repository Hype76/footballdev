-- Use the active team roster for goal and assist attribution independently of squad selection.
create or replace function private.match_day_event_participants(match_id uuid)
returns table(id uuid, player_name text, shirt_number text, team_id uuid)
language sql stable security definer set search_path = '' as $function$
  select p.id, p.player_name, coalesce(p.shirt_number, ''), p.team_id
  from public.match_days m
  join public.players p on p.club_id = m.club_id and p.team_id = m.team_id
  where m.id = match_id
    and m.deleted_at is null
    and p.archived_at is null
    and coalesce(p.status, 'active') = 'active'
    and nullif(trim(p.player_name), '') is not null
  order by coalesce(lower(trim(p.section)) = 'trial', false), lower(p.player_name), p.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_match_day_event_participants(match_day_id_value uuid, parent_link_id_value uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.match_days%rowtype;
begin
  select * into m from public.match_days where id=match_day_id_value;
  if auth.uid() is null or m.id is null or m.team_id is null or m.deleted_at is not null
    or m.concluded_at is not null or m.status in ('cancelled','postponed')
    or not coalesce(public.match_day_local_date_is_today(m.id),false)
    or not coalesce(public.can_use_plan_feature(m.club_id,'fixtures'),false) or not coalesce(public.can_use_plan_feature(m.club_id,'players'),false)
    then raise exception 'Current Match Day access is required.'; end if;
  if parent_link_id_value is not null then
    if not coalesce(public.current_user_is_match_day_scorer(m.id),false) or not exists(
      select 1 from public.match_day_role_assignments a join public.parent_player_links l on l.id=a.parent_link_id
      where a.match_day_id=m.id and a.role='scorer' and a.parent_link_id=parent_link_id_value
        and a.club_id=m.club_id and a.team_id=m.team_id and l.club_id=m.club_id and l.team_id=m.team_id
        and a.auth_user_id=auth.uid() and l.auth_user_id=a.auth_user_id and l.status='active')
    then raise exception 'Current selected Parent scorer access is required.'; end if;
  elsif not coalesce(public.can_manage_match_day(m.team_id),false) or public.current_user_club_id() is distinct from m.club_id then
    raise exception 'Current team staff access is required.';
  end if;
  return jsonb_build_object('matchId',m.id,'teamId',m.team_id,'players',
    (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('is_trial', roster.is_trial)
      order by roster.is_trial, lower(p.player_name), p.id), '[]'::jsonb)
      from private.match_day_event_participants(m.id) p
      join public.players player on player.id = p.id and player.team_id = m.team_id and player.club_id = m.club_id
      cross join lateral (values (coalesce(lower(trim(player.section)) = 'trial', false))) roster(is_trial)),
    'substitutionPlayers',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from private.match_day_substitution_participants(m.id) p),
    'eventIdentities',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,
      'scorer_player_id',e.scorer_player_id,'assist_player_id',e.assist_player_id,
      'participant_identity_version',e.participant_identity_version)),'[]'::jsonb)
      from public.match_day_events e where e.match_day_id=m.id and e.club_id=m.club_id and e.team_id=m.team_id));
end;
$function$;
