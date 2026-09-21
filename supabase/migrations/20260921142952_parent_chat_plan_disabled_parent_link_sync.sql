create or replace function public.parent_chat_sync_parent_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_record public.parent_player_links%rowtype;
  resolved_team_id uuid;
  room_record record;
begin
  if current_setting('app.demo_reset_skip_communication_sync', true) = 'on' then
    return coalesce(new, old);
  end if;

  link_record := case when tg_op = 'DELETE' then old else new end;

  -- Parent Portal links remain independently usable when Parent Chat is not
  -- included in the club plan. Authoritative room access checks still read the
  -- current link, so a skipped reconciliation cannot preserve chat access.
  if public.can_use_plan_feature(link_record.club_id, 'parentChat') is not true then
    return coalesce(new, old);
  end if;

  select coalesce(link_record.team_id, player.team_id)
  into resolved_team_id
  from public.players player
  where player.id = link_record.player_id;

  if tg_op <> 'DELETE'
    and new.status = 'active'
    and new.auth_user_id is not null
    and resolved_team_id is not null then
    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      player_id,
      room_type,
      title
    ) values (
      new.club_id,
      resolved_team_id,
      new.player_id,
      'parent_staff',
      'Chat with Staff'
    )
    on conflict (club_id, team_id, player_id) where room_type = 'parent_staff'
    do nothing;

    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      room_type,
      title
    )
    select
      team.club_id,
      team.id,
      'team',
      team.name || ' Team Chat'
    from public.teams team
    where team.id = resolved_team_id
      and team.club_id = new.club_id
    on conflict (club_id, team_id) where room_type = 'team'
    do nothing;
  end if;

  for room_record in
    select room.id
    from public.parent_chat_rooms room
    where room.club_id = link_record.club_id
      and room.team_id = resolved_team_id
      and (
        room.room_type <> 'parent_staff'
        or room.player_id = link_record.player_id
      )
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;

  return coalesce(new, old);
end;
$$;

revoke all on function public.parent_chat_sync_parent_link() from public;
revoke execute on function public.parent_chat_sync_parent_link() from anon, authenticated;
grant execute on function public.parent_chat_sync_parent_link() to service_role;
