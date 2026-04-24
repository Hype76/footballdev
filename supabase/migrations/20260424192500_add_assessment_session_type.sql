alter table public.assessment_sessions
add column if not exists session_type text not null default 'training';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assessment_sessions_session_type_check'
  ) then
    alter table public.assessment_sessions
      add constraint assessment_sessions_session_type_check
      check (session_type in ('training', 'match'));
  end if;
end $$;
