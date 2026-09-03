alter table public.parent_mobile_notification_events
  add column if not exists dismissed_at timestamptz;

-- Clearing a notification hides its current version. A fresh update for the
-- same match must reappear even when the delivery code reuses the event row.
create or replace function private.reset_parent_notification_dismissal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.sent_at is distinct from old.sent_at
    or new.title is distinct from old.title or new.body is distinct from old.body then
    new.dismissed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.reset_parent_notification_dismissal() from public, anon, authenticated;
drop trigger if exists reset_parent_notification_dismissal on public.parent_mobile_notification_events;
create trigger reset_parent_notification_dismissal
before update on public.parent_mobile_notification_events
for each row execute function private.reset_parent_notification_dismissal();

-- Inbox writes continue through the service endpoint after verifying the
-- signed-in parent owns the active child link. No direct client grants.
