alter table public.event_player_notification_events
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create or replace function public.set_event_player_notification_events_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_event_player_notification_events_updated_at()
from public, anon, authenticated;

drop trigger if exists event_player_notification_events_set_updated_at
on public.event_player_notification_events;

create trigger event_player_notification_events_set_updated_at
before update on public.event_player_notification_events
for each row
execute function public.set_event_player_notification_events_updated_at();

comment on column public.event_player_notification_events.updated_at is
  'UTC timestamp of the latest delivery-ledger state transition.';
