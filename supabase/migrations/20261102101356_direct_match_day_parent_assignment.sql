begin;

create or replace function public.assign_match_day_parent_directly(
  match_day_id_value uuid, parent_link_id_value uuid, role_value text,
  assigned_by_value uuid, assigned_by_name_value text
) returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, app_private
as $$
declare
  match_row public.match_days%rowtype;
  link_row public.parent_player_links%rowtype;
  player_row public.players%rowtype;
  request_id uuid;
  previous_assignment jsonb;
begin
  if role_value not in ('scorer', 'linesman', 'referee') then
    raise exception 'Choose a valid volunteer role.';
  end if;
  select * into match_row from public.match_days where id = match_day_id_value for update;
  if match_row.id is null or match_row.deleted_at is not null or match_row.concluded_at is not null
    or match_row.status in ('cancelled', 'postponed', 'full_time') then
    raise exception 'This fixture is no longer available for assignment.';
  end if;
  select jsonb_build_object('id', assignment.id, 'parent_link_id', assignment.parent_link_id,
    'parent_player_links', jsonb_build_object('id', old_link.id, 'email', old_link.email,
      'players', jsonb_build_object('player_name', old_player.player_name))) into previous_assignment
  from public.match_day_role_assignments assignment
  left join public.parent_player_links old_link on old_link.id = assignment.parent_link_id
  left join public.players old_player on old_player.id = old_link.player_id
  where assignment.match_day_id = match_row.id and assignment.role = role_value;
  select link.* into link_row from public.parent_player_links link
    join public.players player on player.id = link.player_id
      and player.club_id = match_row.club_id and player.status = 'active'
      and player.team_id = match_row.team_id
    where link.id = parent_link_id_value and link.club_id = match_row.club_id and link.team_id = match_row.team_id
      and link.link_type = 'parent' and link.status = 'active' and link.auth_user_id is not null
      and nullif(trim(link.email), '') is not null
      and exists (select 1 from auth.users account where account.id = link.auth_user_id)
      and not exists (select 1 from public.users account where account.id = link.auth_user_id
        and account.status = 'suspended' and (account.role = 'parent_portal' or account.club_id = match_row.club_id))
    for update of link;
  if link_row.id is null then
    raise exception 'Choose an active linked parent for this team.';
  end if;
  select * into player_row from public.players where id = link_row.player_id;

  select id into request_id from public.match_day_availability_requests
    where match_day_id = match_row.id and club_id = match_row.club_id
      and player_id = player_row.id and parent_link_id = link_row.id
      and status <> 'expired' order by created_at desc limit 1 for update;
  if request_id is null then
    insert into public.match_day_availability_requests
      (match_day_id, club_id, team_id, player_id, player_name, recipient_email, recipient_name,
       recipient_type, channel, token_hash, parent_link_id, created_by, created_by_name)
    values (match_row.id, match_row.club_id, match_row.team_id, player_row.id, player_row.player_name,
      lower(trim(link_row.email)), lower(trim(link_row.email)), 'parent', 'push',
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      link_row.id, assigned_by_value, coalesce(assigned_by_name_value, ''))
    on conflict (match_day_id, player_id, recipient_email, recipient_type, channel)
    do update set parent_link_id = excluded.parent_link_id,
      status = case when match_day_availability_requests.status = 'expired' then 'pending' else match_day_availability_requests.status end,
      token_hash = case when match_day_availability_requests.status = 'expired' then excluded.token_hash else match_day_availability_requests.token_hash end,
      expires_at = case when match_day_availability_requests.status = 'expired' then timezone('utc', now()) + interval '21 days' else match_day_availability_requests.expires_at end
    where match_day_availability_requests.parent_link_id is null or match_day_availability_requests.parent_link_id = excluded.parent_link_id
    returning id into request_id;
    if request_id is null then
      raise exception 'This parent response is linked to another account.';
    end if;
  end if;
  update public.match_day_availability_requests set
    volunteer_scorer_response = case when role_value = 'scorer' then 'yes' else volunteer_scorer_response end,
    volunteer_linesman_response = case when role_value = 'linesman' then 'yes' else volunteer_linesman_response end,
    volunteer_referee_response = case when role_value = 'referee' then 'yes' else volunteer_referee_response end,
    volunteer_responded_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = request_id;
  if role_value = 'scorer' then
    perform public.sync_match_day_scorer_assignment(match_row.id, link_row.id, assigned_by_value, assigned_by_name_value, true);
  else
    insert into public.match_day_role_assignments
      (match_day_id, club_id, team_id, role, parent_link_id, auth_user_id, assigned_by, assigned_by_name, created_at, updated_at)
    values (match_row.id, match_row.club_id, match_row.team_id, role_value, link_row.id, link_row.auth_user_id,
      assigned_by_value, coalesce(assigned_by_name_value, ''), timezone('utc', now()), timezone('utc', now()))
    on conflict (match_day_id, role) do update set
      club_id = excluded.club_id, team_id = excluded.team_id, parent_link_id = excluded.parent_link_id,
      auth_user_id = excluded.auth_user_id, assigned_by = excluded.assigned_by,
      assigned_by_name = excluded.assigned_by_name, updated_at = excluded.updated_at;
  end if;
  return jsonb_build_object('requestId', request_id, 'previousAssignment', previous_assignment);
end;
$$;
revoke all on function public.assign_match_day_parent_directly(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.assign_match_day_parent_directly(uuid, uuid, text, uuid, text) to service_role;
commit;
