-- Upgrade only the built-in development scoring fields from 1-5 to 1-10.
-- Preflight count before applying:
-- select
--   count(*) filter (where default_score_scale_version is null or default_score_scale_version < 2) as candidate_evaluations,
--   sum((
--     select count(*)
--     from jsonb_each(coalesce(e.form_responses, '{}'::jsonb)) response(label, value)
--     where lower(response.label) in ('technical', 'tactical', 'physical', 'mentality', 'coachability')
--       and jsonb_typeof(response.value) in ('number', 'string')
--       and (response.value #>> '{}') ~ '^[1-5](\.0+)?$'
--   )) as candidate_form_response_values,
--   sum((
--     select count(*)
--     from jsonb_each(coalesce(e.scores, '{}'::jsonb)) score(label, value)
--     where lower(score.label) in ('technical', 'tactical', 'physical', 'mentality', 'coachability')
--       and jsonb_typeof(score.value) in ('number', 'string')
--       and (score.value #>> '{}') ~ '^[1-5](\.0+)?$'
--   )) as candidate_score_values
-- from public.evaluations e;

alter table public.evaluations
  add column if not exists default_score_scale_version integer not null default 1;

alter table public.evaluations
  add column if not exists default_score_scale_migrated_at timestamptz;

update public.form_fields
set
  type = 'score_1_10',
  options = '[1,2,3,4,5,6,7,8,9,10]'::jsonb,
  include_in_progress_chart = true
where coalesce(is_default, false) = true
  and lower(label) in (
    'technical',
    'tactical',
    'physical',
    'mentality',
    'coachability'
  );

create or replace function pg_temp.convert_default_assessment_scores_to_10(source jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := coalesce(source, '{}'::jsonb);
  score_label text;
  raw_value jsonb;
  numeric_score numeric;
begin
  if jsonb_typeof(result) <> 'object' then
    return result;
  end if;

  foreach score_label in array array['Technical', 'Tactical', 'Physical', 'Mentality', 'Coachability']
  loop
    raw_value := result -> score_label;

    if raw_value is null then
      continue;
    end if;

    if jsonb_typeof(raw_value) not in ('number', 'string') then
      continue;
    end if;

    if (raw_value #>> '{}') !~ '^[1-5](\.0+)?$' then
      continue;
    end if;

    numeric_score := (raw_value #>> '{}')::numeric;

    result := jsonb_set(
      result,
      array[score_label],
      to_jsonb((numeric_score * 2)::integer),
      true
    );
  end loop;

  return result;
end;
$$;

create or replace function pg_temp.average_numeric_jsonb_values(source jsonb)
returns numeric
language sql
immutable
as $$
  select avg((entry.value #>> '{}')::numeric)
  from jsonb_each(
    case
      when jsonb_typeof(coalesce(source, '{}'::jsonb)) = 'object' then coalesce(source, '{}'::jsonb)
      else '{}'::jsonb
    end
  ) entry
  where jsonb_typeof(entry.value) in ('number', 'string')
    and (entry.value #>> '{}') ~ '^\d+(\.\d+)?$';
$$;

with converted as (
  select
    e.id,
    pg_temp.convert_default_assessment_scores_to_10(e.form_responses) as next_form_responses,
    pg_temp.convert_default_assessment_scores_to_10(e.scores) as next_scores
  from public.evaluations e
  where coalesce(e.default_score_scale_version, 1) < 2
)
update public.evaluations e
set
  form_responses = converted.next_form_responses,
  scores = converted.next_scores,
  average_score = coalesce(pg_temp.average_numeric_jsonb_values(converted.next_scores), e.average_score),
  default_score_scale_version = 2,
  default_score_scale_migrated_at = coalesce(e.default_score_scale_migrated_at, timezone('utc', now()))
from converted
where e.id = converted.id
  and coalesce(e.default_score_scale_version, 1) < 2;

alter table public.evaluations
  alter column default_score_scale_version set default 2;

create or replace function public.seed_default_form_fields()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid := public.current_user_club_id();
begin
  if target_club_id is null then
    return;
  end if;

  insert into public.form_fields (
    club_id,
    label,
    type,
    options,
    required,
    order_index,
    is_default,
    is_enabled,
    include_in_progress_chart
  )
  select
    target_club_id,
    default_fields.label,
    default_fields.type,
    default_fields.options,
    default_fields.required,
    default_fields.order_index,
    true,
    true,
    default_fields.include_in_progress_chart
  from (
    values
      ('Technical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 1, true),
      ('Tactical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 2, true),
      ('Physical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 3, true),
      ('Mentality', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 4, true),
      ('Coachability', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 5, true),
      ('Strengths', 'textarea', '[]'::jsonb, false, 6, false),
      ('Improvements', 'textarea', '[]'::jsonb, false, 7, false),
      ('Overall Comments', 'textarea', '[]'::jsonb, true, 8, false)
  ) as default_fields(label, type, options, required, order_index, include_in_progress_chart)
  where not exists (
    select 1
    from public.form_fields existing_fields
    where existing_fields.club_id = target_club_id
      and lower(existing_fields.label) = lower(default_fields.label)
  );
end;
$$;

grant execute on function public.seed_default_form_fields() to authenticated;

-- Post-check after applying:
-- select count(*) as unmigrated_evaluations
-- from public.evaluations
-- where coalesce(default_score_scale_version, 1) < 2;
