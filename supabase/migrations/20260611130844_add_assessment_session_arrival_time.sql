alter table public.assessment_sessions
  add column if not exists arrival_time time;
