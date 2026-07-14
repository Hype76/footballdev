begin;

insert into auth.users (id)
values
  ('71000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002'),
  ('71000000-0000-4000-8000-000000000003'),
  ('71000000-0000-4000-8000-000000000004'),
  ('71000000-0000-4000-8000-000000000005'),
  ('71000000-0000-4000-8000-000000000006'),
  ('71000000-0000-4000-8000-000000000007');

insert into public.clubs (id, name)
values
  ('72000000-0000-4000-8000-000000000001', 'Parent Chat Test Club One'),
  ('72000000-0000-4000-8000-000000000002', 'Parent Chat Test Club Two');

insert into public.teams (id, club_id, name)
values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Parent Chat Team One'),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'Parent Chat Team Two'),
  ('73000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000002', 'Parent Chat Team Three');

insert into public.users (id, email, name, display_name, role, role_label, role_rank, club_id, status)
values
  ('71000000-0000-4000-8000-000000000005', 'chat.coach@example.test', 'Chat Coach', 'Chat Coach', 'coach', 'Coach', 30, '72000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000006', 'removed.coach@example.test', 'Removed Coach', 'Removed Coach', 'coach', 'Coach', 30, '72000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000007', 'other.club.parent@example.test', 'Other Club Parent', 'Other Club Parent', 'parent', 'Parent', 0, '72000000-0000-4000-8000-000000000002', 'active');

insert into public.team_staff (team_id, user_id)
values
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000005'),
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000006');

insert into public.players (id, club_id, team_id, player_name, section, team, status)
values
  ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 'Selected Child', 'Squad', 'Parent Chat Team One', 'active'),
  ('74000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 'Unselected Child', 'Squad', 'Parent Chat Team One', 'active'),
  ('74000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000002', 'Other Team Child', 'Squad', 'Parent Chat Team Two', 'active'),
  ('74000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000003', 'Other Club Child', 'Squad', 'Parent Chat Team Three', 'active');

insert into public.parent_player_links (
  id,
  club_id,
  team_id,
  player_id,
  link_type,
  email,
  auth_user_id,
  status
)
values
  ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'parent', 'shared.family@example.test', '71000000-0000-4000-8000-000000000001', 'active'),
  ('75000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'parent', 'guardian.family@example.test', '71000000-0000-4000-8000-000000000002', 'active'),
  ('75000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002', 'parent', 'shared.family@example.test', '71000000-0000-4000-8000-000000000003', 'active'),
  ('75000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000003', 'parent', 'other.team@example.test', '71000000-0000-4000-8000-000000000004', 'active'),
  ('75000000-0000-4000-8000-000000000005', '72000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000003', '74000000-0000-4000-8000-000000000004', 'parent', 'other.club@example.test', '71000000-0000-4000-8000-000000000007', 'active');

insert into public.match_days (
  id,
  club_id,
  team_id,
  opponent,
  match_date,
  kickoff_time,
  arrival_time,
  venue_name,
  status
)
values (
  '76000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'Chat Opponent',
  current_date + 2,
  '10:30',
  '09:45',
  'Chat Ground',
  'scheduled'
);

insert into public.match_day_player_squad_decisions (
  match_day_id,
  club_id,
  team_id,
  player_id,
  status
)
values
  ('76000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'selected'),
  ('76000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000002', 'not_selected');

select set_config(
  'test.chat.parent_staff_selected',
  (
    select id::text
    from public.parent_chat_rooms
    where room_type = 'parent_staff'
      and player_id = '74000000-0000-4000-8000-000000000001'
  ),
  false
);
select set_config(
  'test.chat.parent_staff_unselected',
  (
    select id::text
    from public.parent_chat_rooms
    where room_type = 'parent_staff'
      and player_id = '74000000-0000-4000-8000-000000000002'
  ),
  false
);
select set_config(
  'test.chat.team_one',
  (
    select id::text
    from public.parent_chat_rooms
    where room_type = 'team'
      and team_id = '73000000-0000-4000-8000-000000000001'
  ),
  false
);
select set_config(
  'test.chat.team_two',
  (
    select id::text
    from public.parent_chat_rooms
    where room_type = 'team'
      and team_id = '73000000-0000-4000-8000-000000000002'
  ),
  false
);
select set_config(
  'test.chat.match_one',
  (
    select id::text
    from public.parent_chat_rooms
    where room_type = 'match_squad'
      and match_day_id = '76000000-0000-4000-8000-000000000001'
  ),
  false
);

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","user_metadata":{"display_name":"Selected Parent"}}';

do $$
declare
  room_count integer;
begin
  select count(*) into room_count
  from public.get_parent_chat_rooms();

  if room_count <> 3 then
    raise exception 'Selected parent expected exactly three rooms, found %.', room_count;
  end if;

  if not public.parent_chat_user_can_access_room(
    current_setting('test.chat.parent_staff_selected')::uuid,
    auth.uid()
  ) then
    raise exception 'Parent could not access their child staff room.';
  end if;

  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.parent_staff_unselected')::uuid,
    auth.uid()
  ) then
    raise exception 'Parent accessed another child staff room.';
  end if;

  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.team_two')::uuid,
    auth.uid()
  ) then
    raise exception 'Parent accessed another team room.';
  end if;

  perform public.send_parent_chat_message(
    current_setting('test.chat.parent_staff_selected')::uuid,
    'Shared guardian message'
  );
  perform public.send_parent_chat_message(
    current_setting('test.chat.match_one')::uuid,
    'Selected squad message'
  );

  begin
    perform public.send_parent_chat_message(
      current_setting('test.chat.parent_staff_unselected')::uuid,
      'Attempted cross-child message'
    );
    raise exception 'Expected cross-child send denial.';
  exception
    when others then
      if sqlerrm not like '%not available for new messages%' then
        raise;
      end if;
  end;

  begin
    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      room_type,
      title
    ) values (
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      'team',
      'Parent-created room'
    );
    raise exception 'Expected parent room creation denial.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.parent_chat_memberships (
      room_id,
      club_id,
      auth_user_id,
      member_kind
    ) values (
      current_setting('test.chat.team_one')::uuid,
      '72000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000004',
      'parent'
    );
    raise exception 'Expected participant management denial.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.parent_chat_messages (
      room_id,
      club_id,
      sender_id,
      sender_kind,
      sender_name,
      sender_role,
      body
    ) values (
      current_setting('test.chat.team_one')::uuid,
      '72000000-0000-4000-8000-000000000001',
      auth.uid(),
      'staff',
      'Impersonated Coach',
      'Coach',
      'Attempted impersonation'
    );
    raise exception 'Expected direct message and staff impersonation denial.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000002';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000002","user_metadata":{"display_name":"Linked Guardian"}}';

do $$
declare
  message_count integer;
begin
  select count(*) into message_count
  from public.get_parent_chat_messages(
    current_setting('test.chat.parent_staff_selected')::uuid
  );

  if message_count <> 1 then
    raise exception 'Linked guardian did not receive the shared child staff conversation.';
  end if;
end;
$$;

set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000003';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000003","user_metadata":{"display_name":"Unselected Parent"}}';

do $$
begin
  if not public.parent_chat_user_can_access_room(
    current_setting('test.chat.team_one')::uuid,
    auth.uid()
  ) then
    raise exception 'Same-team parent could not access Team Chat.';
  end if;

  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.parent_staff_selected')::uuid,
    auth.uid()
  ) then
    raise exception 'Shared parent email merged unrelated child staff rooms.';
  end if;

  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.match_one')::uuid,
    auth.uid()
  ) then
    raise exception 'Unselected family discovered Match Squad Chat.';
  end if;

  begin
    perform public.get_parent_chat_messages(
      current_setting('test.chat.match_one')::uuid
    );
    raise exception 'Expected unselected fixture room denial.';
  exception
    when others then
      if sqlerrm not like '%not available%' then
        raise;
      end if;
  end;
end;
$$;

set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000004';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000004","user_metadata":{"display_name":"Other Team Parent"}}';

do $$
begin
  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.team_one')::uuid,
    auth.uid()
  ) then
    raise exception 'Other-team parent accessed Team Chat.';
  end if;
end;
$$;

set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000007';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000007"}';

do $$
begin
  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.team_one')::uuid,
    auth.uid()
  ) then
    raise exception 'Cross-club parent accessed Team Chat.';
  end if;
end;
$$;

set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000006';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000006"}';

do $$
begin
  perform public.send_parent_chat_message(
    current_setting('test.chat.team_one')::uuid,
    'Staff message before assignment removal'
  );
end;
$$;

reset role;

delete from public.team_staff
where team_id = '73000000-0000-4000-8000-000000000001'
  and user_id = '71000000-0000-4000-8000-000000000006';

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000006';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000006"}';

do $$
begin
  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.team_one')::uuid,
    auth.uid()
  ) then
    raise exception 'Removed staff retained previous team room access.';
  end if;

  begin
    perform public.get_parent_chat_messages(
      current_setting('test.chat.team_one')::uuid
    );
    raise exception 'Expected removed staff room denial.';
  exception
    when others then
      if sqlerrm not like '%not available%' then
        raise;
      end if;
  end;
end;
$$;

reset role;

update public.match_day_player_squad_decisions
set status = 'not_selected'
where match_day_id = '76000000-0000-4000-8000-000000000001'
  and player_id = '74000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","user_metadata":{"display_name":"Selected Parent"}}';

do $$
begin
  if public.parent_chat_user_can_access_room(
    current_setting('test.chat.match_one')::uuid,
    auth.uid()
  ) then
    raise exception 'Deselected family retained Match Squad Chat access.';
  end if;

  begin
    perform public.get_parent_chat_messages(
      current_setting('test.chat.match_one')::uuid
    );
    raise exception 'Expected old Match Squad Chat URL denial.';
  exception
    when others then
      if sqlerrm not like '%not available%' then
        raise;
      end if;
  end;
end;
$$;

reset role;

update public.match_days
set status = 'full_time'
where id = '76000000-0000-4000-8000-000000000001';

do $$
declare
  room_status text;
begin
  select status into room_status
  from public.parent_chat_rooms
  where id = current_setting('test.chat.match_one')::uuid;

  if room_status <> 'closed' then
    raise exception 'Match Day completion trigger expected a closed room, found %.', room_status;
  end if;
end;
$$;

do $$
declare
  retained_count integer;
  removed_audit_count integer;
  queued_email_count integer;
begin
  select count(*) into retained_count
  from public.parent_chat_messages
  where room_id = current_setting('test.chat.match_one')::uuid;

  if retained_count <> 1 then
    raise exception 'Deselection changed retained Match Squad Chat history.';
  end if;

  select count(*) into removed_audit_count
  from public.parent_chat_membership_audit
  where room_id = current_setting('test.chat.match_one')::uuid
    and auth_user_id = '71000000-0000-4000-8000-000000000001'
    and action = 'removed';

  if removed_audit_count < 1 then
    raise exception 'Deselection did not retain safe membership removal evidence.';
  end if;

  select count(*) into queued_email_count
  from public.scheduled_email_queue;

  if queued_email_count <> 0 then
    raise exception 'Chat test unexpectedly queued an email.';
  end if;
end;
$$;

rollback;
