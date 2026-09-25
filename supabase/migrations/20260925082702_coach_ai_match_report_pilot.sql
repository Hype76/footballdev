alter table public.match_day_final_reports
  add column if not exists ai_narrative text not null default '',
  add column if not exists ai_answers jsonb not null default '{}'::jsonb,
  add column if not exists ai_generated_at timestamptz,
  add column if not exists ai_saved_at timestamptz,
  add column if not exists ai_generated_by uuid references auth.users (id) on delete set null;

alter table public.match_day_final_reports
  add constraint match_day_final_reports_ai_narrative_length_check
  check (char_length(ai_narrative) <= 5000);

create or replace function public.save_match_day_ai_report(
  match_day_id_value uuid,
  narrative_value text,
  answers_value jsonb default '{}'::jsonb
)
returns public.match_day_final_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_days%rowtype;
  report_row public.match_day_final_reports%rowtype;
  narrative text := btrim(coalesce(narrative_value, ''));
begin
  select * into match_row from public.match_days where id = match_day_id_value for update;
  if not found then raise exception 'Match Day could not be found.'; end if;
  if match_row.club_id <> 'f747d2cc-a5e5-4960-8ad3-dcfe85b49279'::uuid
    or match_row.status <> 'full_time'
    or match_row.concluded_at is null
    or match_row.concluded_by is distinct from auth.uid()
    or match_row.deleted_at is not null
    or public.current_user_club_id() is distinct from match_row.club_id
    or coalesce(public.current_user_role(), '') in ('admin', 'parent_portal', 'adult_player', 'super_admin')
    or coalesce(public.current_user_role_rank(), 0) < 20
    or not coalesce(public.can_read_match_day(match_row.team_id), false)
  then
    raise exception 'Only the person who concluded this pilot match can save its AI report.';
  end if;
  if narrative = '' or char_length(narrative) > 5000 then
    raise exception 'The report must be between 1 and 5000 characters.';
  end if;
  if coalesce(jsonb_typeof(answers_value), '') <> 'object'
    or octet_length(answers_value::text) > 7000
  then
    raise exception 'Invalid report answers.';
  end if;

  insert into public.match_day_final_reports (
    match_day_id, club_id, team_id, staff_notes, created_by, updated_by,
    ai_narrative, ai_answers, ai_generated_by, ai_generated_at, ai_saved_at
  ) values (
    match_row.id, match_row.club_id, match_row.team_id, '', auth.uid(), auth.uid(),
    narrative, answers_value, auth.uid(), timezone('utc', now()), timezone('utc', now())
  ) on conflict (match_day_id) do update set
    ai_narrative = excluded.ai_narrative,
    ai_answers = excluded.ai_answers,
    ai_generated_by = excluded.ai_generated_by,
    ai_generated_at = excluded.ai_generated_at,
    ai_saved_at = excluded.ai_saved_at
  returning * into report_row;
  return report_row;
end;
$$;

revoke all on function public.save_match_day_ai_report(uuid, text, jsonb) from public;
revoke execute on function public.save_match_day_ai_report(uuid, text, jsonb) from anon;
grant execute on function public.save_match_day_ai_report(uuid, text, jsonb) to authenticated;
