begin;

insert into public.clubs (id, name, plan_key, plan_status)
values ('91000000-0000-4000-8000-000000000001', 'Calendar Hotfix Club', 'small_club', 'active');

insert into public.teams (id, club_id, name)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Hotfix Team'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'Other Team');

insert into public.users (id, club_id, email, name, display_name, role, role_rank, status)
values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'manager@example.test', 'Manager', 'Manager', 'head_manager', 70, 'active'),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'parent@example.test', 'Parent', 'Parent', 'parent_portal', 0, 'active'),
  ('93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', 'other@example.test', 'Other Coach', 'Other Coach', 'coach', 30, 'active');

insert into public.team_staff (team_id, user_id)
values
  ('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003');

insert into public.players (id, club_id, team_id, player_name, section, status)
values
  ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'First Child', 'Squad', 'active'),
  ('94000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Second Child', 'Squad', 'active'),
  ('94000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'Other Child', 'Squad', 'active');

insert into public.parent_player_links (
  id, club_id, team_id, player_id, auth_user_id, email, status
)
values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 'parent@example.test', 'active'),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', null, 'not-an-email', 'active');

insert into public.match_days (
  id, club_id, team_id, opponent, match_date, kickoff_time, kickoff_time_tbc,
  arrival_time, home_away, venue_name, notes, status, parent_visible,
  parent_audience, created_by
)
values (
  '96000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'Hotfix Opponent', current_date + 7, '10:30', false, '09:45', 'home',
  'Original Venue', 'Originally saved without notification', 'scheduled', false,
  'none', '93000000-0000-4000-8000-000000000001'
);

do $$
begin
  if exists (select 1 from public.calendar_event_invites where match_day_id = '96000000-0000-4000-8000-000000000001') then
    raise exception 'Creation without Notify parents created Portal state.';
  end if;
  if exists (select 1 from public.scheduled_email_queue where subject like '%Hotfix Opponent%') then
    raise exception 'Creation without Notify parents queued email.';
  end if;
end;
$$;

update public.match_days
set parent_visible = true,
    parent_audience = 'involved_players'
where id = '96000000-0000-4000-8000-000000000001';

do $$
begin
  if (select notification_revision from public.match_days where id = '96000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Parent visibility edit did not advance Match Day notification revision.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000001';

select public.notify_calendar_event_parents(
  null,
  'update',
  '96000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  array[
    '94000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000002'::uuid
  ]
);

select public.notify_calendar_event_parents(
  null,
  'update',
  '96000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  array[
    '94000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000002'::uuid
  ]
);

reset role;

do $$
begin
  if (select count(*) from public.calendar_event_invites where match_day_id = '96000000-0000-4000-8000-000000000001' and response_requirement = 'informational') <> 2 then
    raise exception 'Later Match Day edit did not create informational Portal scope.';
  end if;
  if (select count(*) from public.calendar_event_notification_commands where match_day_id = '96000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Same command retry created a duplicate command.';
  end if;
  if (select count(*) from public.scheduled_email_queue where subject = 'Event details updated: Match vs Hotfix Opponent') <> 1 then
    raise exception 'Same command retry queued a duplicate email.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000001';

select public.notify_calendar_event_parents(
  null,
  'update',
  '96000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000002',
  '{}'::uuid[]
);

reset role;

do $$
begin
  if (select notification_revision from public.match_days where id = '96000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Unchanged explicit notification incorrectly changed the event revision.';
  end if;
  if (select count(*) from public.calendar_event_notification_commands where match_day_id = '96000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Later explicit unchanged-event command was not auditable.';
  end if;
  if (select count(*) from public.scheduled_email_queue where subject = 'Event details updated: Match vs Hotfix Opponent') <> 2 then
    raise exception 'Later explicit unchanged-event command did not queue once.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000002';

do $$
begin
  if not exists (
    select 1 from public.get_parent_portal_match_days('95000000-0000-4000-8000-000000000001')
    where id = '96000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Parent Calendar could not read the informational Match Day item.';
  end if;
end;
$$;

reset role;

set local role authenticated;
set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000003';

do $$
declare
  denied boolean := false;
begin
  begin
    perform public.notify_calendar_event_parents(
      null,
      'update',
      '96000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000003',
      '{}'::uuid[]
    );
  exception when others then
    denied := true;
  end;

  if not denied then
    raise exception 'Cross-team staff notification was not denied.';
  end if;
end;
$$;

reset role;

create function pg_temp.reject_calendar_hotfix_queue_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Simulated Calendar queue failure';
end;
$$;

create trigger reject_calendar_hotfix_queue_insert
before insert on public.scheduled_email_queue
for each row execute function pg_temp.reject_calendar_hotfix_queue_insert();

set local role authenticated;
set local request.jwt.claim.sub = '93000000-0000-4000-8000-000000000001';

select public.notify_calendar_event_parents(
  null,
  'update',
  '96000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000004',
  '{}'::uuid[]
);

reset role;

do $$
begin
  if (select count(*) from public.calendar_event_invites where match_day_id = '96000000-0000-4000-8000-000000000001' and invite_status = 'active') <> 2 then
    raise exception 'Queue failure removed valid Portal scope.';
  end if;
  if not exists (
    select 1 from public.calendar_event_notification_events
    where match_day_id = '96000000-0000-4000-8000-000000000001' and status = 'failed'
  ) then
    raise exception 'Queue failure was not recorded as partial success.';
  end if;
end;
$$;

rollback;
