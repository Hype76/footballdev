-- FP-MOBILE-NOTIFICATIONS-PROFILE-66
-- Parent notification inbox state and resource notification intent support.

alter table public.parent_mobile_notification_events
  add column if not exists read_at timestamptz;

alter table public.parent_mobile_notification_events
  drop constraint if exists parent_mobile_notification_events_intent_check;
alter table public.parent_mobile_notification_events
  add constraint parent_mobile_notification_events_intent_check
  check (intent_type in (
    'parent_message',
    'parent_poll',
    'matchday_update',
    'parent_chat',
    'resource_shared',
    'poll_results'
  ));

create index if not exists parent_mobile_notification_events_unread_idx
on public.parent_mobile_notification_events (auth_user_id, parent_link_id, created_at desc)
where status = 'sent' and read_at is null;

revoke all on public.parent_mobile_notification_events from public, anon, authenticated;
grant select, insert, update, delete on public.parent_mobile_notification_events to service_role;

