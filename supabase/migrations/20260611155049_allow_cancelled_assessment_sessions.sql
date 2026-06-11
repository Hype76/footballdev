alter table public.assessment_sessions
drop constraint if exists assessment_sessions_status_check;

alter table public.assessment_sessions
add constraint assessment_sessions_status_check
check (status in ('open', 'completed', 'cancelled'));
