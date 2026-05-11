update public.assessment_sessions
set
  session_type = 'match',
  title = case
    when coalesce(nullif(trim(opponent), ''), '') <> '' then concat(team, ' vs ', opponent)
    else team
  end,
  updated_at = now()
where session_type = 'tournament';

alter table public.assessment_sessions
drop constraint if exists assessment_sessions_session_type_check;

alter table public.assessment_sessions
add constraint assessment_sessions_session_type_check
check (session_type in ('training', 'match'));
