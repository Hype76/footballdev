create function public.cancel_match_day_fixture_for_team(p_match_day_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  match_row public.match_days%rowtype;
  updated_row public.match_days%rowtype;
begin
  if actor_id is null or p_match_day_id is null or p_team_id is null then
    raise exception using errcode = '42501', message = 'match_day_fixture_not_permitted';
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  join public.teams team
    on team.id = match_day.team_id
   and team.id = p_team_id
   and coalesce(team.status, 'active') = 'active'
  join public.clubs club
    on club.id = match_day.club_id
   and club.id = team.club_id
   and coalesce(club.status, 'active') = 'active'
  where match_day.id = p_match_day_id
    and match_day.deleted_at is null
  for update of match_day;

  if match_row.id is null
    or not app_private.actor_can_manage_team_resource(actor_id, match_row.club_id, p_team_id, 20) then
    raise exception using errcode = '42501', message = 'match_day_fixture_not_permitted';
  end if;

  if match_row.concluded_at is not null
    or match_row.status not in ('scheduled', 'scorer_request', 'postponed') then
    raise exception using errcode = '22023', message = 'match_day_fixture_already_started';
  end if;

  update public.match_days match_day
  set status = 'cancelled',
      updated_at = timezone('utc', now())
  where match_day.id = match_row.id
  returning match_day.* into updated_row;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    match_row.club_id,
    actor_id,
    'match_day_fixture_cancelled',
    'match_day',
    match_row.id,
    jsonb_build_object('teamId', p_team_id, 'previousStatus', match_row.status)
  );

  return to_jsonb(updated_row);
end;
$$;

revoke all on function public.cancel_match_day_fixture_for_team(uuid, uuid) from public, anon;
grant execute on function public.cancel_match_day_fixture_for_team(uuid, uuid) to authenticated, service_role;
