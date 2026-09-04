alter table public.calendar_events
  add column if not exists pitch_type text not null default '';

alter table public.calendar_events
  drop constraint if exists calendar_events_pitch_type_check;

alter table public.calendar_events
  add constraint calendar_events_pitch_type_check
  check (pitch_type in ('', 'grass', '3g', '4g', 'indoor', 'other'));

comment on column public.calendar_events.pitch_type is
  'Optional pitch type selected from grass, 3g, 4g, indoor, or other.';

alter table public.match_days
  add column if not exists pitch_type text not null default '';

alter table public.match_days
  drop constraint if exists match_days_pitch_type_check;

alter table public.match_days
  add constraint match_days_pitch_type_check
  check (pitch_type in ('', 'grass', '3g', '4g', 'indoor', 'other'));

comment on column public.match_days.pitch_type is
  'Optional pitch type selected from grass, 3g, 4g, indoor, or other.';
