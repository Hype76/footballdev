-- Existing templates keep their team access. New private templates retain the
-- same club, team, role and plan policies, with an additional owner restriction.
alter table public.feedback_forms add column if not exists access_scope text not null default 'team'
  check (access_scope in ('creator', 'team') and (access_scope <> 'creator' or created_by is not null));

create policy feedback_forms_private_read on public.feedback_forms as restrictive
  for select to authenticated using (access_scope = 'team' or created_by = (select auth.uid()));
create policy feedback_forms_creator_insert on public.feedback_forms as restrictive
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy feedback_forms_private_update on public.feedback_forms as restrictive
  for update to authenticated
  using (access_scope = 'team' or created_by = (select auth.uid()))
  with check (access_scope = 'team' or created_by = (select auth.uid()));

create or replace function private.guard_feedback_template_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501', message = 'The template creator cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_feedback_template_owner() from public, anon, authenticated, service_role;
create trigger feedback_forms_preserve_creator before update on public.feedback_forms
  for each row execute function private.guard_feedback_template_owner();

-- Definer assessment finalisation must enforce private-template access too.
create or replace function private.guard_assessment_template_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_value jsonb := pg_catalog.to_jsonb(new);
  form_text text;
  actor uuid := auth.uid();
  template public.feedback_forms%rowtype;
begin
  if tg_table_name = 'evaluation_drafts' then
    form_text := row_value->'draft_data'->>'selectedFeedbackFormId';
    if actor is null then actor := nullif(row_value->>'created_by_user_id', '')::uuid; end if;
  else
    form_text := coalesce(nullif(row_value->>'feedback_form_id', ''), row_value->'feedback_form_snapshot'->>'id');
    if actor is null then actor := nullif(row_value->>'coach_id', '')::uuid; end if;
  end if;
  if form_text is null or form_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return new; end if;
  select * into template from public.feedback_forms where id = form_text::uuid;
  if template.id is not null and template.access_scope = 'creator' and template.created_by is distinct from actor then
    raise exception using errcode = '42501', message = 'This assessment template is private to its creator.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_assessment_template_access() from public, anon, authenticated, service_role;
create trigger evaluation_drafts_template_access before insert or update of draft_data on public.evaluation_drafts
  for each row execute function private.guard_assessment_template_access();
create trigger evaluations_template_access before insert or update of feedback_form_id, feedback_form_snapshot on public.evaluations
  for each row execute function private.guard_assessment_template_access();

-- Keep both existing authorised, idempotent RPC bodies and their grants intact.
-- Add notifications only when a goal edit actually changes the committed score.
do $migration$
declare
  signature regprocedure;
  definition text;
  needle text := 'select * into next_match from public.match_days where id = m.id;';
  addition text := E'\n  if kind_value in (''correct-goal'', ''void-goal'')\n    and (next_match.home_score is distinct from m.home_score or next_match.away_score is distinct from m.away_score) then\n    notification_type := ''score_correction'';\n    saved_event_id := target_event_id;\n  end if;';
begin
  foreach signature in array array[
    pg_catalog.to_regprocedure('public.apply_parent_match_day_command(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)'),
    pg_catalog.to_regprocedure('public.apply_parent_match_day_command_v2(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)')
  ] loop
    if signature is null then raise exception 'The authorised Parent scorer RPC is missing.'; end if;
    definition := pg_catalog.pg_get_functiondef(signature);
    if pg_catalog.array_length(pg_catalog.string_to_array(definition, needle), 1) <> 2
      or pg_catalog.strpos(definition, 'public.void_parent_match_day_goal') = 0 then
      raise exception 'The Parent scorer RPC changed. Review its current source before applying this migration.';
    end if;
    execute pg_catalog.replace(definition, needle, needle || addition);
  end loop;
end;
$migration$;
