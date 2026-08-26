alter table public.resource_library_links
  add column if not exists calendar_occurrence_date date;

update public.resource_library_links link
set calendar_occurrence_date = (event.starts_at at time zone 'Europe/London')::date
from public.calendar_events event
where link.linked_type = 'calendar_event'
  and link.linked_id = event.id
  and link.calendar_occurrence_date is null;

alter table public.resource_library_links
  drop constraint if exists resource_library_links_calendar_occurrence_check;

alter table public.resource_library_links
  add constraint resource_library_links_calendar_occurrence_check
  check (
    linked_type = 'calendar_event'
    or calendar_occurrence_date is null
  );

drop index if exists public.resource_library_links_active_target_key;

create unique index if not exists resource_library_links_active_non_calendar_target_key
on public.resource_library_links (resource_id, linked_type, linked_id)
where removed_at is null and linked_type <> 'calendar_event';

create unique index if not exists resource_library_links_active_calendar_occurrence_key
on public.resource_library_links (resource_id, linked_type, linked_id, calendar_occurrence_date)
where removed_at is null and linked_type = 'calendar_event';

create index if not exists resource_library_links_calendar_occurrence_idx
on public.resource_library_links (club_id, team_id, linked_id, calendar_occurrence_date)
where linked_type = 'calendar_event' and removed_at is null;

create or replace function app_private.validate_calendar_resource_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_record public.calendar_events%rowtype;
  first_date date;
  month_offset integer;
  valid_occurrence boolean := false;
begin
  if new.linked_type <> 'calendar_event' then
    if new.calendar_occurrence_date is not null then
      raise exception using errcode = '23514', message = 'calendar_resource_occurrence_not_allowed';
    end if;
    return new;
  end if;

  if new.calendar_occurrence_date is null then
    raise exception using errcode = '23514', message = 'calendar_resource_occurrence_required';
  end if;

  select event.*
  into event_record
  from public.calendar_events event
  where event.id = new.linked_id
    and event.club_id = new.club_id
    and event.team_id = new.team_id
    and event.cancelled_at is null;

  if event_record.id is null then
    raise exception using errcode = '23514', message = 'calendar_resource_event_not_available';
  end if;

  first_date := (event_record.starts_at at time zone 'Europe/London')::date;

  if new.calendar_occurrence_date = first_date then
    valid_occurrence := true;
  elsif new.calendar_occurrence_date > first_date
    and new.calendar_occurrence_date <= coalesce(event_record.recurrence_until, first_date) then
    case lower(coalesce(event_record.recurrence_frequency, 'none'))
      when 'weekly' then
        valid_occurrence := ((new.calendar_occurrence_date - first_date) % 7) = 0;
      when 'fortnightly' then
        valid_occurrence := ((new.calendar_occurrence_date - first_date) % 14) = 0;
      when 'monthly' then
        month_offset := (
          (extract(year from new.calendar_occurrence_date)::integer - extract(year from first_date)::integer) * 12
          + extract(month from new.calendar_occurrence_date)::integer
          - extract(month from first_date)::integer
        );
        valid_occurrence := month_offset > 0
          and (first_date + make_interval(months => month_offset))::date = new.calendar_occurrence_date;
      else
        valid_occurrence := false;
    end case;
  end if;

  if not valid_occurrence then
    raise exception using errcode = '23514', message = 'calendar_resource_occurrence_invalid';
  end if;

  return new;
end;
$$;

alter function app_private.validate_calendar_resource_occurrence() owner to postgres;
revoke all on function app_private.validate_calendar_resource_occurrence()
from public, anon, authenticated, service_role;

drop trigger if exists validate_calendar_resource_occurrence
on public.resource_library_links;
create trigger validate_calendar_resource_occurrence
before insert or update of linked_type, linked_id, club_id, team_id, calendar_occurrence_date
on public.resource_library_links
for each row execute function app_private.validate_calendar_resource_occurrence();

comment on column public.resource_library_links.calendar_occurrence_date is
  'The one Europe/London calendar occurrence that receives this Resource. Required for calendar_event links and null for all other link types.';

comment on function app_private.validate_calendar_resource_occurrence() is
  'Rejects Calendar Resource links unless the selected date is a real occurrence of the linked event series.';
