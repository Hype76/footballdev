begin;

insert into auth.users (id, email)
values
  ('81000000-0000-4000-8000-000000000001', 'calendar.staff@example.test'),
  ('81000000-0000-4000-8000-000000000002', 'calendar.other@example.test'),
  ('81000000-0000-4000-8000-000000000003', 'calendar.guardian@example.test'),
  ('81000000-0000-4000-8000-000000000004', 'calendar.outsider@example.test'),
  ('81000000-0000-4000-8000-000000000005', 'calendar.suspended@example.test');

insert into public.clubs (id, name, plan_key, plan_status)
values ('82000000-0000-4000-8000-000000000001', 'Calendar Notify Club', 'small_club', 'active');

insert into public.teams (id, club_id, name)
values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'Calendar Team'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'Other Team');

insert into public.users (id, email, name, display_name, role, role_label, role_rank, club_id, status)
values
  ('81000000-0000-4000-8000-000000000001', 'calendar.staff@example.test', 'Calendar Coach', 'Calendar Coach', 'coach', 'Coach', 30, '82000000-0000-4000-8000-000000000001', 'active'),
  ('81000000-0000-4000-8000-000000000002', 'calendar.other@example.test', 'Other Coach', 'Other Coach', 'coach', 'Coach', 30, '82000000-0000-4000-8000-000000000001', 'active'),
  ('81000000-0000-4000-8000-000000000003', 'calendar.guardian@example.test', 'Current Guardian', 'Current Guardian', 'parent_portal', 'Parent', 0, '82000000-0000-4000-8000-000000000001', 'active'),
  ('81000000-0000-4000-8000-000000000004', 'calendar.outsider@example.test', 'Outside Parent', 'Outside Parent', 'parent_portal', 'Parent', 0, '82000000-0000-4000-8000-000000000001', 'active'),
  ('81000000-0000-4000-8000-000000000005', 'calendar.suspended@example.test', 'Suspended Coach', 'Suspended Coach', 'coach', 'Coach', 30, '82000000-0000-4000-8000-000000000001', 'suspended');

insert into public.team_staff (team_id, user_id)
values
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002'),
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005');

insert into public.players (id, club_id, team_id, player_name, section, team, status)
values
  ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'First Child', 'Squad', 'Calendar Team', 'active'),
  ('84000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'Second Child', 'Squad', 'Calendar Team', 'active'),
  ('84000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002', 'Other Team Child', 'Squad', 'Other Team', 'active');

insert into public.parent_player_links (
  id, club_id, team_id, player_id, link_type, email, auth_user_id, status, accepted_at
)
values
  ('85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'parent', 'calendar.guardian@example.test', '81000000-0000-4000-8000-000000000003', 'active', timezone('utc', now())),
  ('85000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000002', 'parent', 'calendar.guardian@example.test', '81000000-0000-4000-8000-000000000003', 'active', timezone('utc', now())),
  ('85000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'parent', 'calendar.revoked@example.test', null, 'revoked', timezone('utc', now()));

insert into public.calendar_events (
  id, club_id, team_id, event_type, title, starts_at, ends_at, location, notes,
  parent_visible, parent_audience, created_by, updated_by
)
values
  (
    '86000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    'general',
    'Creation Notify Event',
    timezone('utc', now()) + interval '7 days',
    timezone('utc', now()) + interval '7 days 1 hour',
    'First Venue',
    'Creation details',
    true,
    'involved_players',
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  ),
  (
    '86000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    'general',
    'Edit Notify Event',
    timezone('utc', now()) + interval '8 days',
    timezone('utc', now()) + interval '8 days 1 hour',
    'Original Venue',
    'Originally saved without notification',
    true,
    'involved_players',
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  );

do $$
begin
  if exists (
    select 1
    from public.calendar_event_invites
    where calendar_event_id = '86000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Edit fixture unexpectedly started with Parent Portal state.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';

select public.sync_calendar_event_parent_scope(
  '86000000-0000-4000-8000-000000000001',
  null,
  array[
    '84000000-0000-4000-8000-000000000001'::uuid,
    '84000000-0000-4000-8000-000000000002'::uuid
  ]
);

select public.notify_calendar_event_parents(
  '86000000-0000-4000-8000-000000000001',
  'creation',
  null,
  '87000000-0000-4000-8000-000000000001',
  '{}'::uuid[]
);

reset role;

do $$
begin
  if (select count(*) from public.calendar_event_invites where calendar_event_id = '86000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Creation notify did not create one Portal record per event child.';
  end if;

  if (select count(*) from public.calendar_event_notification_events where calendar_event_id = '86000000-0000-4000-8000-000000000001' and status = 'queued') <> 1 then
    raise exception 'Duplicate guardian relationships created more than one creation email.';
  end if;

  if (select count(*) from public.scheduled_email_queue where subject = 'New event added: Creation Notify Event') <> 1 then
    raise exception 'Creation email subject or queue count was incorrect.';
  end if;
end;
$$;

update public.calendar_events
set notes = 'Latest edit details'
where id = '86000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';

select public.sync_calendar_event_parent_scope(
  '86000000-0000-4000-8000-000000000002',
  null,
  array[
    '84000000-0000-4000-8000-000000000001'::uuid,
    '84000000-0000-4000-8000-000000000002'::uuid
  ]
);

select public.notify_calendar_event_parents(
  '86000000-0000-4000-8000-000000000002',
  'update',
  null,
  '87000000-0000-4000-8000-000000000002',
  '{}'::uuid[]
);

select public.notify_calendar_event_parents(
  '86000000-0000-4000-8000-000000000002',
  'update',
  null,
  '87000000-0000-4000-8000-000000000002',
  '{}'::uuid[]
);

reset role;

do $$
begin
  if (select count(*) from public.calendar_event_invites where calendar_event_id = '86000000-0000-4000-8000-000000000002') <> 2 then
    raise exception 'Edit notify did not create missing Portal state.';
  end if;

  if (select count(*) from public.calendar_event_notification_events where calendar_event_id = '86000000-0000-4000-8000-000000000002' and notification_type = 'update') <> 1 then
    raise exception 'Same saved edit revision created a duplicate notification ledger row.';
  end if;

  if (select count(*) from public.scheduled_email_queue where subject = 'Event details updated: Edit Notify Event') <> 1 then
    raise exception 'Same saved edit revision created a duplicate update email.';
  end if;
end;
$$;

update public.calendar_event_invites
set invite_status = 'responded',
    responded_at = timezone('utc', now())
where calendar_event_id = '86000000-0000-4000-8000-000000000002'
  and player_id = '84000000-0000-4000-8000-000000000001';

update public.calendar_events
set location = 'Updated Venue'
where id = '86000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';

select public.notify_calendar_event_parents(
  '86000000-0000-4000-8000-000000000002',
  'update',
  null,
  '87000000-0000-4000-8000-000000000003',
  '{}'::uuid[]
);

reset role;

do $$
begin
  if not exists (
    select 1
    from public.calendar_event_invites
    where calendar_event_id = '86000000-0000-4000-8000-000000000002'
      and player_id = '84000000-0000-4000-8000-000000000001'
      and invite_status = 'responded'
      and responded_at is not null
  ) then
    raise exception 'A cosmetic edit destroyed an existing response.';
  end if;

  if (select count(*) from public.calendar_event_notification_events where calendar_event_id = '86000000-0000-4000-8000-000000000002' and notification_type = 'update') <> 2 then
    raise exception 'A genuine later event revision did not create one new update notification.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';

do $$
declare
  denied boolean := false;
begin
  begin
    perform public.sync_calendar_event_parent_scope(
      '86000000-0000-4000-8000-000000000002',
      null,
      array['84000000-0000-4000-8000-000000000003'::uuid]
    );
  exception when others then
    denied := true;
  end;

  if not denied then
    raise exception 'Cross-team player injection was not denied.';
  end if;
end;
$$;

reset role;

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000002';

do $$
declare
  denied boolean := false;
begin
  begin
    perform public.notify_calendar_event_parents(
      '86000000-0000-4000-8000-000000000002',
      'update',
      null,
      '87000000-0000-4000-8000-000000000005',
      '{}'::uuid[]
    );
  exception when others then
    denied := true;
  end;

  if not denied then
    raise exception 'Cross-team staff access was not denied.';
  end if;
end;
$$;

reset role;

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000005';

do $$
declare
  denied boolean := false;
begin
  begin
    perform public.notify_calendar_event_parents(
      '86000000-0000-4000-8000-000000000002',
      'update',
      null,
      '87000000-0000-4000-8000-000000000006',
      '{}'::uuid[]
    );
  exception when others then
    denied := true;
  end;

  if not denied then
    raise exception 'Suspended staff access was not denied.';
  end if;
end;
$$;

reset role;

create or replace function pg_temp.reject_calendar_notify_queue_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Simulated Calendar queue failure';
end;
$$;

create trigger reject_calendar_notify_queue_insert
before insert on public.scheduled_email_queue
for each row
execute function pg_temp.reject_calendar_notify_queue_insert();

update public.calendar_events
set notes = 'Portal should survive email queue failure'
where id = '86000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';

select public.notify_calendar_event_parents(
  '86000000-0000-4000-8000-000000000002',
  'update',
  null,
  '87000000-0000-4000-8000-000000000007',
  '{}'::uuid[]
);

reset role;

do $$
begin
  if (select count(*) from public.calendar_event_invites where calendar_event_id = '86000000-0000-4000-8000-000000000002' and invite_status <> 'cancelled') <> 2 then
    raise exception 'Queue failure removed authoritative Portal state.';
  end if;

  if (select count(*) from public.calendar_event_notification_events where calendar_event_id = '86000000-0000-4000-8000-000000000002' and status = 'failed') <> 1 then
    raise exception 'Queue failure was not recorded for controlled retry.';
  end if;
end;
$$;

drop trigger reject_calendar_notify_queue_insert on public.scheduled_email_queue;

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';

select public.notify_calendar_event_parents(
  '86000000-0000-4000-8000-000000000002',
  'update',
  null,
  '87000000-0000-4000-8000-000000000008',
  '{}'::uuid[]
);

reset role;

do $$
begin
  if (select count(*) from public.calendar_event_notification_events where calendar_event_id = '86000000-0000-4000-8000-000000000002' and status = 'failed') <> 1 then
    raise exception 'A later command did not preserve the failed command audit row.';
  end if;

  if (select count(*) from public.calendar_event_notification_events where calendar_event_id = '86000000-0000-4000-8000-000000000002' and status = 'queued') <> 3 then
    raise exception 'A later explicit command did not queue one new update.';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000003';

do $$
begin
  if (select count(*) from public.get_parent_portal_invitation_summary('85000000-0000-4000-8000-000000000001') where invitation_type = 'calendar_attendance' and is_pending is false) < 2 then
    raise exception 'Informational Calendar events were not visible without inflating Pending.';
  end if;
end;
$$;

reset role;

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000004';

do $$
begin
  if exists (
    select 1
    from public.get_parent_portal_invitation_summary('85000000-0000-4000-8000-000000000001')
  ) then
    raise exception 'Another parent could read the Calendar invitation.';
  end if;
end;
$$;

reset role;

update public.calendar_events
set cancelled_at = timezone('utc', now())
where id = '86000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000003';

do $$
begin
  if not exists (
    select 1
    from public.get_parent_portal_invitation_summary('85000000-0000-4000-8000-000000000001')
    where event_id = '86000000-0000-4000-8000-000000000002'
      and invitation_state = 'cancelled'
      and is_pending is false
  ) then
    raise exception 'Cancellation did not leave Pending as a historical state.';
  end if;
end;
$$;

reset role;

delete from public.calendar_events
where id = '86000000-0000-4000-8000-000000000002';

do $$
begin
  if exists (
    select 1
    from public.calendar_event_invites
    where calendar_event_id = '86000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Deletion left an actionable orphaned Portal invite.';
  end if;

  if not exists (
    select 1
    from public.audit_logs
    where action = 'calendar_event_parent_notification_requested'
      and entity_type = 'calendar_event'
      and entity_id = '86000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Deletion removed notification audit history.';
  end if;
end;
$$;

rollback;
