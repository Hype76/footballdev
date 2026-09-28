alter table public.calendar_events
  add column if not exists deleted_occurrence_dates date[] not null default '{}';

alter table public.evaluations
  add column if not exists calendar_hidden_at timestamptz;

comment on column public.calendar_events.deleted_occurrence_dates is
  'Dates removed from a repeating calendar series while retaining the series and other occurrences.';

create or replace function app_private.cancel_removed_calendar_occurrence_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.training_availability_requests request
  set status = 'cancelled', updated_at = now()
  where request.calendar_event_id = new.id
    and request.status <> 'cancelled'
    and (
      new.cancelled_at is not null
      or request.occurrence_date = any(new.deleted_occurrence_dates)
      or (new.recurrence_until is not null and request.occurrence_date > new.recurrence_until)
    );

  update public.training_availability_request_players player_request
  set status = 'cancelled', updated_at = now()
  from public.training_availability_requests request
  where player_request.request_id = request.id
    and request.calendar_event_id = new.id
    and request.status = 'cancelled'
    and player_request.status not in ('cancelled', 'responded');

  return new;
end;
$$;

revoke all on function app_private.cancel_removed_calendar_occurrence_requests() from public, anon, authenticated;

create trigger cancel_removed_calendar_occurrence_requests
after update of deleted_occurrence_dates, recurrence_until, cancelled_at on public.calendar_events
for each row
when (
  old.deleted_occurrence_dates is distinct from new.deleted_occurrence_dates
  or old.recurrence_until is distinct from new.recurrence_until
  or old.cancelled_at is distinct from new.cancelled_at
)
execute function app_private.cancel_removed_calendar_occurrence_requests();
