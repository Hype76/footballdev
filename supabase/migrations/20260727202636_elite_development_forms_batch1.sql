alter table public.feedback_forms
  add column if not exists starter_template_key text,
  add column if not exists starter_template_version integer;

create unique index if not exists feedback_forms_one_active_starter_per_team_idx
on public.feedback_forms (team_id, starter_template_key)
where status = 'active' and starter_template_key is not null;

create index if not exists feedback_forms_starter_provenance_idx
on public.feedback_forms (club_id, team_id, starter_template_key, starter_template_version);

create or replace function app_private.elite_form_fields_are_valid(fields_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  field_value jsonb;
  field_id text;
  metric_key text;
  category_key text;
  canonical_metric_keys constant text[] := array[
    'attacking.finishing',
    'attacking.composure',
    'attacking.movement',
    'attacking.one_v_one',
    'attacking.first_touch',
    'attacking.final_third_decision_making',
    'attacking.combination_play',
    'attacking.final_delivery',
    'attacking.weak_foot',
    'attacking.transition',
    'defensive.positioning',
    'defensive.one_v_one',
    'defensive.tackling',
    'defensive.marking',
    'defensive.anticipation',
    'defensive.aerial',
    'defensive.recovery',
    'defensive.communication',
    'defensive.decision_making',
    'defensive.transition',
    'midfield.scanning',
    'midfield.first_touch',
    'midfield.short_passing',
    'midfield.passing_range',
    'midfield.ball_retention',
    'midfield.press_resistance',
    'midfield.positioning',
    'midfield.tempo_control',
    'midfield.chance_creation',
    'midfield.transition',
    'goalkeeping.shot_stopping',
    'goalkeeping.handling',
    'goalkeeping.positioning',
    'goalkeeping.one_v_one',
    'goalkeeping.crosses',
    'goalkeeping.footwork',
    'goalkeeping.hand_distribution',
    'goalkeeping.foot_distribution',
    'goalkeeping.sweeper_decisions',
    'goalkeeping.communication',
    'conditioning.acceleration',
    'conditioning.maximum_speed',
    'conditioning.agility',
    'conditioning.endurance',
    'conditioning.strength',
    'conditioning.explosive_power',
    'conditioning.balance_coordination',
    'conditioning.mobility',
    'conditioning.movement_quality',
    'conditioning.training_intensity'
  ];
begin
  if jsonb_typeof(fields_value) <> 'array' then
    return false;
  end if;

  for field_value in select value from jsonb_array_elements(fields_value)
  loop
    metric_key := trim(coalesce(field_value ->> 'metricKey', ''));
    if metric_key = '' then
      continue;
    end if;

    field_id := trim(coalesce(field_value ->> 'id', ''));
    category_key := trim(coalesce(field_value ->> 'categoryKey', ''));

    if field_value ->> 'type' <> 'score_1_10'
      or coalesce((field_value ->> 'includeInProgressChart')::boolean, false) is not true
    then
      return false;
    end if;

    if metric_key = any(canonical_metric_keys) then
      if category_key <> split_part(metric_key, '.', 1) then
        return false;
      end if;
    elsif metric_key = 'custom.' || field_id then
      if field_id = '' or category_key <> 'custom' then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function app_private.elite_snapshot_scores_are_valid(snapshot_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  field_value jsonb;
  score_value numeric;
begin
  if snapshot_value is null or snapshot_value = '{}'::jsonb then
    return true;
  end if;

  if jsonb_typeof(snapshot_value -> 'fields') <> 'array' then
    return true;
  end if;

  for field_value in
    select value
    from jsonb_array_elements(snapshot_value -> 'fields')
    where trim(coalesce(value ->> 'metricKey', '')) <> ''
  loop
    if field_value ->> 'type' <> 'score_1_10' then
      return false;
    end if;

    if jsonb_typeof(field_value -> 'value') = 'string'
      and trim(coalesce(field_value ->> 'value', '')) = ''
    then
      continue;
    end if;

    if jsonb_typeof(field_value -> 'value') = 'null' then
      continue;
    end if;

    if jsonb_typeof(field_value -> 'value') <> 'number' then
      return false;
    end if;

    score_value := (field_value ->> 'value')::numeric;
    if score_value < 1 or score_value > 10 or trunc(score_value) <> score_value then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

alter table public.feedback_forms
  drop constraint if exists feedback_forms_elite_field_metadata_check;
alter table public.feedback_forms
  add constraint feedback_forms_elite_field_metadata_check
  check (app_private.elite_form_fields_are_valid(fields)) not valid;

alter table public.evaluations
  drop constraint if exists evaluations_elite_snapshot_scores_check;
alter table public.evaluations
  add constraint evaluations_elite_snapshot_scores_check
  check (app_private.elite_snapshot_scores_are_valid(feedback_form_snapshot)) not valid;

create or replace function app_private.build_elite_feedback_fields(
  metric_definitions jsonb,
  written_definitions jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with metric_fields as (
    select
      jsonb_build_object(
        'id', 'metric-' || replace(item.definition ->> 'metricKey', '.', '-'),
        'label', item.definition ->> 'label',
        'type', 'score_1_10',
        'options', '["1","2","3","4","5","6","7","8","9","10"]'::jsonb,
        'required', false,
        'orderIndex', item.ordinality,
        'isEnabled', true,
        'includeInProgressChart', true,
        'parentVisible', false,
        'metricKey', item.definition ->> 'metricKey',
        'categoryKey', item.definition ->> 'categoryKey',
        'categoryLabel', item.definition ->> 'categoryLabel'
      ) as field,
      item.ordinality as order_index
    from jsonb_array_elements(metric_definitions) with ordinality as item(definition, ordinality)
  ),
  written_fields as (
    select
      jsonb_build_object(
        'id', 'written-' || (item.definition ->> 'key'),
        'label', item.definition ->> 'label',
        'type', item.definition ->> 'type',
        'options', '[]'::jsonb,
        'required', false,
        'orderIndex', jsonb_array_length(metric_definitions) + item.ordinality,
        'isEnabled', true,
        'includeInProgressChart', false,
        'parentVisible', coalesce((item.definition ->> 'parentVisible')::boolean, false)
      ) as field,
      jsonb_array_length(metric_definitions) + item.ordinality as order_index
    from jsonb_array_elements(written_definitions) with ordinality as item(definition, ordinality)
  )
  select coalesce(jsonb_agg(field order by order_index), '[]'::jsonb)
  from (
    select field, order_index from metric_fields
    union all
    select field, order_index from written_fields
  ) combined;
$$;

with category_definitions(category_key, category_label, template_key, template_name, template_description, sort_order, metrics) as (
  values
  (
    'attacking',
    'Striking and Attacking',
    'elite-attacking-review',
    'Elite Attacking Review',
    'A focused review of striking, finishing, attacking movement and final-third decisions.',
    1,
    '[
      {"metricKey":"attacking.finishing","label":"Finishing"},
      {"metricKey":"attacking.composure","label":"Composure"},
      {"metricKey":"attacking.movement","label":"Attacking movement"},
      {"metricKey":"attacking.one_v_one","label":"One-versus-one attacking"},
      {"metricKey":"attacking.first_touch","label":"First touch"},
      {"metricKey":"attacking.final_third_decision_making","label":"Final-third decision-making"},
      {"metricKey":"attacking.combination_play","label":"Combination play"},
      {"metricKey":"attacking.final_delivery","label":"Crossing or final delivery"},
      {"metricKey":"attacking.weak_foot","label":"Weak-foot ability"},
      {"metricKey":"attacking.transition","label":"Attacking transition"}
    ]'::jsonb
  ),
  (
    'defensive',
    'Defensive',
    'elite-defensive-review',
    'Elite Defensive Review',
    'A focused review of defensive technique, positioning, communication and transitions.',
    2,
    '[
      {"metricKey":"defensive.positioning","label":"Defensive positioning"},
      {"metricKey":"defensive.one_v_one","label":"One-versus-one defending"},
      {"metricKey":"defensive.tackling","label":"Tackling technique"},
      {"metricKey":"defensive.marking","label":"Marking"},
      {"metricKey":"defensive.anticipation","label":"Anticipation"},
      {"metricKey":"defensive.aerial","label":"Aerial defending"},
      {"metricKey":"defensive.recovery","label":"Recovery defending"},
      {"metricKey":"defensive.communication","label":"Defensive communication"},
      {"metricKey":"defensive.decision_making","label":"Decision-making under pressure"},
      {"metricKey":"defensive.transition","label":"Defensive transition"}
    ]'::jsonb
  ),
  (
    'midfield',
    'Midfield',
    'elite-midfield-review',
    'Elite Midfield Review',
    'A focused review of midfield awareness, receiving, passing, retention and tempo.',
    3,
    '[
      {"metricKey":"midfield.scanning","label":"Scanning and awareness"},
      {"metricKey":"midfield.first_touch","label":"First touch"},
      {"metricKey":"midfield.short_passing","label":"Short passing"},
      {"metricKey":"midfield.passing_range","label":"Passing range"},
      {"metricKey":"midfield.ball_retention","label":"Ball retention"},
      {"metricKey":"midfield.press_resistance","label":"Press resistance"},
      {"metricKey":"midfield.positioning","label":"Positioning"},
      {"metricKey":"midfield.tempo_control","label":"Tempo control"},
      {"metricKey":"midfield.chance_creation","label":"Chance creation"},
      {"metricKey":"midfield.transition","label":"Transition work"}
    ]'::jsonb
  ),
  (
    'goalkeeping',
    'Goalkeeping',
    'elite-goalkeeper-review',
    'Elite Goalkeeper Review',
    'A focused review of goalkeeping technique, positioning, distribution and organisation.',
    4,
    '[
      {"metricKey":"goalkeeping.shot_stopping","label":"Shot stopping"},
      {"metricKey":"goalkeeping.handling","label":"Handling"},
      {"metricKey":"goalkeeping.positioning","label":"Goalkeeping position"},
      {"metricKey":"goalkeeping.one_v_one","label":"One-versus-one situations"},
      {"metricKey":"goalkeeping.crosses","label":"Dealing with crosses"},
      {"metricKey":"goalkeeping.footwork","label":"Footwork"},
      {"metricKey":"goalkeeping.hand_distribution","label":"Distribution by hand"},
      {"metricKey":"goalkeeping.foot_distribution","label":"Distribution by foot"},
      {"metricKey":"goalkeeping.sweeper_decisions","label":"Sweeper-keeper decisions"},
      {"metricKey":"goalkeeping.communication","label":"Communication and organisation"}
    ]'::jsonb
  ),
  (
    'conditioning',
    'Strength and Conditioning',
    'elite-strength-conditioning-review',
    'Elite Strength and Conditioning Review',
    'A focused development review of movement, speed, strength, endurance and training consistency.',
    5,
    '[
      {"metricKey":"conditioning.acceleration","label":"Acceleration"},
      {"metricKey":"conditioning.maximum_speed","label":"Maximum speed"},
      {"metricKey":"conditioning.agility","label":"Agility"},
      {"metricKey":"conditioning.endurance","label":"Endurance"},
      {"metricKey":"conditioning.strength","label":"Strength"},
      {"metricKey":"conditioning.explosive_power","label":"Explosive power"},
      {"metricKey":"conditioning.balance_coordination","label":"Balance and coordination"},
      {"metricKey":"conditioning.mobility","label":"Mobility"},
      {"metricKey":"conditioning.movement_quality","label":"Movement quality"},
      {"metricKey":"conditioning.training_intensity","label":"Training intensity and consistency"}
    ]'::jsonb
  )
),
metric_definitions as (
  select
    category_key,
    category_label,
    template_key,
    template_name,
    template_description,
    sort_order,
    (
      select jsonb_agg(
        metric || jsonb_build_object(
          'categoryKey', category.category_key,
          'categoryLabel', category.category_label
        )
        order by metric_order
      )
      from jsonb_array_elements(category.metrics) with ordinality as metric_item(metric, metric_order)
    ) as metrics
  from category_definitions category
),
common_written_fields as (
  select '[
    {"key":"key-strengths","label":"Key strengths","type":"textarea","parentVisible":true},
    {"key":"main-development-priority","label":"Main development priority","type":"textarea","parentVisible":true},
    {"key":"recommended-training-focus","label":"Recommended training focus","type":"textarea","parentVisible":true},
    {"key":"target-next-review","label":"Target before the next review","type":"textarea","parentVisible":true},
    {"key":"coach-comments","label":"Coach comments","type":"textarea","parentVisible":true},
    {"key":"player-comments","label":"Player comments","type":"textarea","parentVisible":true},
    {"key":"review-date","label":"Review date","type":"text","parentVisible":true},
    {"key":"next-review-date","label":"Next review date","type":"text","parentVisible":true},
    {"key":"parent-visible-summary","label":"Parent-visible summary","type":"textarea","parentVisible":true},
    {"key":"private-staff-notes","label":"Private staff notes","type":"textarea","parentVisible":false}
  ]'::jsonb as fields
),
template_source as (
  select
    template_key,
    template_name as name,
    template_description as description,
    sort_order,
    metrics
  from metric_definitions
  union all
  select
    'elite-complete-player-review',
    'Elite Complete Player Review',
    'A complete elite review that reuses all five specialist metric categories.',
    6,
    (
      select jsonb_agg(metric order by definition.sort_order, metric_order)
      from metric_definitions definition
      cross join lateral jsonb_array_elements(definition.metrics) with ordinality as metric_item(metric, metric_order)
    )
),
retire_older_versions as (
  update public.feedback_form_starter_templates target
  set is_current = false,
      updated_at = timezone('utc', now())
  from template_source source
  where target.template_key = source.template_key
    and target.version <> 1
    and target.is_current
  returning target.template_key
)
insert into public.feedback_form_starter_templates (
  template_key,
  version,
  age_band,
  age_min,
  age_max,
  name,
  description,
  fields,
  is_current
)
select
  source.template_key,
  1,
  'All ages',
  1,
  99,
  source.name,
  source.description,
  app_private.build_elite_feedback_fields(source.metrics, common.fields),
  true
from template_source source
cross join common_written_fields common
order by source.sort_order
on conflict (template_key, version) do update
set age_band = excluded.age_band,
    age_min = excluded.age_min,
    age_max = excluded.age_max,
    name = excluded.name,
    description = excluded.description,
    fields = excluded.fields,
    is_current = true,
    updated_at = timezone('utc', now());

drop function app_private.build_elite_feedback_fields(jsonb, jsonb);

comment on column public.feedback_forms.starter_template_key is
  'Platform starter provenance for duplicate-install protection. Team-owned fields remain editable.';

comment on constraint evaluations_elite_snapshot_scores_check on public.evaluations is
  'Elite metric snapshot values must be unanswered or whole-number scores from 1 to 10.';

-- Production application plan:
-- 1. Apply this migration before deploying the matching application commit.
-- 2. Verify six current elite templates and zero duplicate active installations per team.
-- 3. Submit one disposable scoped review only in an approved non-production environment.
--
-- Rollback plan:
-- 1. Mark the six elite template keys is_current = false.
-- 2. Drop the two NOT VALID checks and their app_private validation functions if required.
-- 3. Keep starter provenance columns and submitted snapshots so historical reviews remain readable.
