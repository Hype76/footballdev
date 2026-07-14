begin;

insert into auth.users (id, email)
values
  ('71000000-0000-4000-8000-000000000001', 'creator.batch1@example.test'),
  ('71000000-0000-4000-8000-000000000002', 'manager.batch1@example.test'),
  ('71000000-0000-4000-8000-000000000003', 'unrelated.batch1@example.test'),
  ('71000000-0000-4000-8000-000000000004', 'inactive.batch1@example.test'),
  ('71000000-0000-4000-8000-000000000005', 'guardian.one.batch1@example.test'),
  ('71000000-0000-4000-8000-000000000006', 'guardian.two.batch1@example.test'),
  ('71000000-0000-4000-8000-000000000007', 'guardian.removed.batch1@example.test');

insert into public.clubs (id, name)
values ('72000000-0000-4000-8000-000000000001', 'Batch One Club');

insert into public.teams (id, club_id, name)
values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Batch One Team'),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'Unrelated Team');

insert into public.users (id, email, name, display_name, role, role_label, role_rank, club_id, status)
values
  ('71000000-0000-4000-8000-000000000001', 'creator.batch1@example.test', 'Fixture Creator', 'Fixture Creator', 'coach', 'Coach', 30, '72000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000002', 'manager.batch1@example.test', 'Team Manager', 'Team Manager', 'admin', 'Team Admin', 50, '72000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000003', 'unrelated.batch1@example.test', 'Other Coach', 'Other Coach', 'coach', 'Coach', 30, '72000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000004', 'inactive.batch1@example.test', 'Inactive Coach', 'Inactive Coach', 'coach', 'Coach', 30, '72000000-0000-4000-8000-000000000001', 'suspended'),
  ('71000000-0000-4000-8000-000000000005', 'guardian.one.batch1@example.test', 'Guardian One', 'Guardian One', 'parent_portal', 'Parent', 0, '72000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000006', 'guardian.two.batch1@example.test', 'Guardian Two', 'Guardian Two', 'parent_portal', 'Parent', 0, '72000000-0000-4000-8000-000000000001', 'active'),
  ('71000000-0000-4000-8000-000000000007', 'guardian.removed.batch1@example.test', 'Removed Guardian', 'Removed Guardian', 'parent_portal', 'Parent', 0, '72000000-0000-4000-8000-000000000001', 'active');

insert into public.team_staff (team_id, user_id)
values
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001'),
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002'),
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004'),
  ('73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003');

insert into public.players (id, club_id, team_id, player_name, section, team, status)
values ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 'Selected Child', 'Squad', 'Batch One Team', 'active');

insert into public.parent_player_links (
  id, club_id, team_id, player_id, link_type, email, auth_user_id, status, accepted_at
)
values
  ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'parent', 'guardian.one.batch1@example.test', '71000000-0000-4000-8000-000000000005', 'active', timezone('utc', now())),
  ('75000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'parent', 'guardian.two.batch1@example.test', '71000000-0000-4000-8000-000000000006', 'active', timezone('utc', now())),
  ('75000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'parent', 'guardian.removed.batch1@example.test', '71000000-0000-4000-8000-000000000007', 'revoked', timezone('utc', now()));

insert into public.match_days (
  id, club_id, team_id, opponent, match_date, kickoff_time, arrival_time, venue_name,
  status, parent_visible, parent_audience, request_scorer, created_by, created_by_name
)
values (
  '76000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'Batch Opponent',
  current_date + 3,
  '10:30',
  '09:45',
  'Batch Stadium',
  'scheduled',
  true,
  'all_team_parents',
  true,
  '71000000-0000-4000-8000-000000000001',
  'Fixture Creator'
);

insert into public.match_day_availability_requests (
  id, match_day_id, club_id, team_id, player_id, player_name, recipient_email,
  recipient_name, token_hash, parent_link_id, volunteer_scorer_response, expires_at
)
values (
  '77000000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'Selected Child',
  'guardian.one.batch1@example.test',
  'Guardian One',
  'batch1-volunteer-token-hash',
  '75000000-0000-4000-8000-000000000001',
  'no_response',
  timezone('utc', now()) + interval '2 days'
);

update public.match_day_availability_requests
set volunteer_scorer_response = 'yes',
    volunteer_responded_at = timezone('utc', now())
where id = '77000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(*) from public.match_day_notification_events where event_type = 'volunteer_role_accepted_staff' and status = 'queued') <> 2 then
    raise exception 'Expected exactly two relevant active staff notifications.';
  end if;

  if (select count(*) from public.match_day_notification_events where recipient_email in ('unrelated.batch1@example.test', 'inactive.batch1@example.test', 'guardian.one.batch1@example.test')) <> 0 then
    raise exception 'Unrelated, inactive, or parent recipients were included in staff notifications.';
  end if;
end;
$$;

update public.match_day_availability_requests
set volunteer_scorer_response = 'yes'
where id = '77000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(*) from public.match_day_notification_events where event_type = 'volunteer_role_accepted_staff') <> 2 then
    raise exception 'Repeated accepted response created duplicate staff notifications.';
  end if;
end;
$$;

update public.match_day_availability_requests
set volunteer_scorer_response = 'no',
    volunteer_responded_at = timezone('utc', now()) + interval '1 second'
where id = '77000000-0000-4000-8000-000000000001';

update public.match_day_availability_requests
set volunteer_scorer_response = 'yes',
    volunteer_responded_at = timezone('utc', now()) + interval '2 seconds'
where id = '77000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(*) from public.match_day_notification_events where event_type = 'volunteer_role_accepted_staff') <> 4 then
    raise exception 'Declined to accepted did not create one new notification per relevant staff recipient.';
  end if;
end;
$$;

insert into public.match_day_player_availability (
  match_day_id, club_id, team_id, player_id, player_name, status
)
values (
  '76000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'Selected Child',
  'available'
);

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000001';

select count(*) from public.set_match_day_player_squad_decision(
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'selected'
);

reset role;

do $$
begin
  if (select count(*) from public.match_day_notification_events where event_type = 'player_selected_guardian' and status = 'queued') <> 2 then
    raise exception 'Expected one selection email for each current guardian.';
  end if;

  if exists (select 1 from public.match_day_notification_events where recipient_email = 'guardian.removed.batch1@example.test') then
    raise exception 'Revoked guardian received a selection notification.';
  end if;

  if not exists (
    select 1
    from public.parent_chat_rooms room
    join public.parent_chat_memberships membership on membership.room_id = room.id
    where room.match_day_id = '76000000-0000-4000-8000-000000000001'
      and membership.auth_user_id = '71000000-0000-4000-8000-000000000005'
      and membership.active is true
      and membership.left_at is null
  ) then
    raise exception 'Match Squad Chat reconciliation did not retain selected guardian membership.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000001';

select count(*) from public.set_match_day_player_squad_decision(
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'selected'
);

reset role;

do $$
begin
  if (select count(*) from public.match_day_notification_events where event_type = 'player_selected_guardian') <> 2 then
    raise exception 'Repeated selected save created duplicate guardian emails.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000001';

select count(*) from public.set_match_day_player_squad_decision(
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'not_selected'
);

select count(*) from public.set_match_day_player_squad_decision(
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'selected'
);

reset role;

do $$
begin
  if (select count(*) from public.match_day_notification_events where event_type = 'player_selected_guardian') <> 4 then
    raise exception 'Reselection did not create one new email per current guardian.';
  end if;
end;
$$;

create or replace function pg_temp.reject_batch1_queue_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Simulated queue failure';
end;
$$;

create trigger reject_batch1_queue_insert
before insert on public.scheduled_email_queue
for each row
execute function pg_temp.reject_batch1_queue_insert();

set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-4000-8000-000000000001';

select count(*) from public.set_match_day_player_squad_decision(
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'not_selected'
);

select count(*) from public.set_match_day_player_squad_decision(
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'selected'
);

reset role;

do $$
begin
  if (select status from public.match_day_player_squad_decisions where match_day_id = '76000000-0000-4000-8000-000000000001' and player_id = '74000000-0000-4000-8000-000000000001') <> 'selected' then
    raise exception 'Queue failure reversed the authoritative saved selection.';
  end if;

  if (select count(*) from public.match_day_notification_events where event_type = 'player_selected_guardian' and status = 'failed') <> 2 then
    raise exception 'Queue failure was not recorded once for each current guardian.';
  end if;
end;
$$;

rollback;
