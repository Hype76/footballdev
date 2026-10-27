-- Preserve existing match alerts and add a separate, occurrence-scoped resource target.
alter table public.fan_notifications alter column match_id drop not null;
alter table public.fan_notifications
  add column calendar_event_id uuid references public.calendar_events(id) on delete cascade,
  add column resource_id uuid references public.resource_library_items(id) on delete cascade,
  add column occurrence_date date;
alter table public.fan_notifications add constraint fan_notifications_exact_target_check check (
  (match_id is not null and calendar_event_id is null and resource_id is null and occurrence_date is null)
  or (match_id is null and calendar_event_id is not null and resource_id is not null and occurrence_date is not null)
);
create index fan_notifications_calendar_resource_idx
  on public.fan_notifications(connection_id, calendar_event_id, occurrence_date)
  where calendar_event_id is not null;
-- Access continues through the authenticated, re-authorising Fans service only.
alter table public.fan_notifications enable row level security;
revoke all on public.fan_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.fan_notifications to service_role;
