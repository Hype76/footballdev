alter table public.event_player_notification_events
  drop constraint if exists event_player_notification_events_command_id_fkey;

alter table public.event_player_notification_events
  add constraint event_player_notification_events_command_id_fkey
  foreign key (command_id)
  references public.event_player_change_commands(id)
  on delete cascade;

create or replace function public.cancel_event_player_command_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.scheduled_email_queue queue
  using public.event_player_notification_events notification
  where notification.command_id = old.id
    and notification.email_queue_id = queue.id;

  return old;
end;
$$;

drop trigger if exists cancel_event_player_command_queue_on_delete
on public.event_player_change_commands;

create trigger cancel_event_player_command_queue_on_delete
before delete on public.event_player_change_commands
for each row
execute function public.cancel_event_player_command_queue();

revoke all on function public.cancel_event_player_command_queue()
from public, anon, authenticated;

grant execute on function public.cancel_event_player_command_queue()
to service_role;

comment on function public.cancel_event_player_command_queue() is
  'Cancels pending event-player communication rows before event deletion cascades through command history.';
