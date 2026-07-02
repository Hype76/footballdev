alter table public.calendar_events
  drop constraint if exists calendar_events_event_type_check;

alter table public.calendar_events
  add constraint calendar_events_event_type_check
  check (
    event_type in ('general', 'availability_deadline', 'parent_cutoff', 'training', 'match')
  );
