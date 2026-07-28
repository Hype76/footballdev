create table if not exists public.feedback_form_starter_templates (
  template_key text not null,
  version integer not null,
  age_band text not null,
  age_min integer not null,
  age_max integer not null,
  name text not null,
  description text not null,
  fields jsonb not null default '[]'::jsonb,
  is_current boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (template_key, version),
  constraint feedback_form_starter_template_key_not_blank check (char_length(trim(template_key)) > 0),
  constraint feedback_form_starter_version_positive check (version > 0),
  constraint feedback_form_starter_age_range check (age_min >= 1 and age_max >= age_min),
  constraint feedback_form_starter_fields_array check (jsonb_typeof(fields) = 'array')
);

create unique index if not exists feedback_form_starter_templates_one_current_idx
on public.feedback_form_starter_templates (template_key)
where is_current;

create index if not exists feedback_form_starter_templates_age_idx
on public.feedback_form_starter_templates (is_current, age_min, age_max, name);

create table if not exists public.feedback_form_starter_preferences (
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  template_key text not null,
  hidden boolean not null default false,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (team_id, template_key),
  constraint feedback_form_starter_preference_key_not_blank check (char_length(trim(template_key)) > 0)
);

create index if not exists feedback_form_starter_preferences_scope_idx
on public.feedback_form_starter_preferences (club_id, team_id, hidden);

create or replace function app_private.build_starter_feedback_fields(
  observation_labels jsonb,
  observation_scale jsonb,
  written_fields jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with observations as (
    select
      jsonb_build_object(
        'id', 'observation-' || item.ordinality::text,
        'label', item.label,
        'type', 'select',
        'options', observation_scale,
        'required', false,
        'orderIndex', item.ordinality,
        'isEnabled', true,
        'includeInProgressChart', false,
        'parentVisible', false
      ) as field,
      item.ordinality as order_index
    from jsonb_array_elements_text(observation_labels) with ordinality as item(label, ordinality)
  ),
  written as (
    select
      jsonb_build_object(
        'id', 'written-' || item.ordinality::text,
        'label', item.definition ->> 'label',
        'type', 'textarea',
        'options', '[]'::jsonb,
        'required', false,
        'orderIndex', jsonb_array_length(observation_labels) + item.ordinality,
        'isEnabled', true,
        'includeInProgressChart', false,
        'parentVisible', coalesce((item.definition ->> 'parentVisible')::boolean, false)
      ) as field,
      jsonb_array_length(observation_labels) + item.ordinality as order_index
    from jsonb_array_elements(written_fields) with ordinality as item(definition, ordinality)
  )
  select coalesce(jsonb_agg(field order by order_index), '[]'::jsonb)
  from (
    select field, order_index from observations
    union all
    select field, order_index from written
  ) combined;
$$;

with template_source(
  template_key,
  age_band,
  age_min,
  age_max,
  name,
  description,
  observation_scale,
  observation_labels,
  written_fields
) as (
  values
  (
    'u7-u8-foundation-development-review',
    'U7-U8',
    7,
    8,
    'U7-U8 Foundation Development Review',
    'Enjoyment, confidence, movement, ball familiarity and simple game habits.',
    '["Not observed","Beginning","Developing","Consistent"]'::jsonb,
    '[
      "Enjoys taking part in training and matches",
      "Joins in confidently",
      "Listens and responds to simple instructions",
      "Tries new activities",
      "Tries again after making a mistake",
      "Comfortable moving with the ball",
      "Keeps the ball reasonably close when dribbling",
      "Changes direction with the ball",
      "Attempts to use both feet",
      "Can stop or receive a moving ball",
      "Looks for a teammate before passing",
      "Can pass towards a teammate",
      "Finds space away from other players",
      "Reacts when their team wins the ball",
      "Reacts when their team loses the ball",
      "Works positively with teammates"
    ]'::jsonb,
    '[
      {"label":"What the player is doing well","parentVisible":true},
      {"label":"One small development focus","parentVisible":true},
      {"label":"Suggested activity to practise","parentVisible":true},
      {"label":"Positive coach message","parentVisible":true},
      {"label":"Additional coaching observation","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u9-u10-skill-development-review',
    'U9-U10',
    9,
    10,
    'U9-U10 Skill Development Review',
    'Core football technique, confidence, simple decisions and teamwork.',
    '["Not observed","Beginning","Developing","Consistent"]'::jsonb,
    '[
      "Arrives ready and joins in positively",
      "Tries skills without fear of mistakes",
      "Controls the ball while moving",
      "Changes speed and direction with the ball",
      "Attempts to use both feet",
      "Receives and controls a pass",
      "Passes with suitable weight and direction",
      "Moves after passing",
      "Looks up before deciding",
      "Attempts to shoot when appropriate",
      "Finds useful space",
      "Supports the player with the ball",
      "Reacts when possession changes",
      "Communicates with teammates",
      "Works positively with teammates",
      "Responds to coaching and encouragement"
    ]'::jsonb,
    '[
      {"label":"Current strengths","parentVisible":true},
      {"label":"One achievable development focus","parentVisible":true},
      {"label":"Suggested practice","parentVisible":true},
      {"label":"Positive coach message","parentVisible":true},
      {"label":"Additional staff observation","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u11-u12-game-understanding-review',
    'U11-U12',
    11,
    12,
    'U11-U12 Game Understanding Review',
    'Technique under growing pressure, scanning, movement, decisions and simple positional understanding.',
    '["Not observed","Emerging","Developing","Consistent","Strong"]'::jsonb,
    '[
      "Scans before receiving",
      "First touch supports the next action",
      "Protects and retains the ball under pressure",
      "Chooses appropriately between passing, dribbling and shooting",
      "Uses both feet where appropriate",
      "Supports play with useful movement",
      "Finds and creates space",
      "Reacts quickly when possession is won",
      "Reacts quickly when possession is lost",
      "Understands their current positional responsibility",
      "Communicates useful information",
      "Competes positively in individual situations",
      "Shows awareness of teammates and opponents",
      "Maintains effort and concentration",
      "Responds constructively to feedback"
    ]'::jsonb,
    '[
      {"label":"Key strength","parentVisible":true},
      {"label":"Current development target","parentVisible":true},
      {"label":"Suggested practice or match focus","parentVisible":true},
      {"label":"Positive coach summary","parentVisible":true},
      {"label":"Private coaching note","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u13-u14-player-development-review',
    'U13-U14',
    13,
    14,
    'U13-U14 Player Development Review',
    'Technique under pressure, positional understanding, transition behaviour and personal responsibility.',
    '["Not observed","Emerging","Developing","Consistent","Strong"]'::jsonb,
    '[
      "Scans consistently before receiving",
      "Executes technique under pressure",
      "Makes effective passing decisions",
      "Carries the ball purposefully",
      "Uses movement to create or exploit space",
      "Understands positional responsibilities",
      "Supports the team in attacking transition",
      "Supports the team in defensive transition",
      "Recognises risk and reward",
      "Communicates clearly with teammates",
      "Maintains concentration and intensity",
      "Responds positively after mistakes",
      "Takes responsibility for personal development",
      "Applies coaching points in training and matches",
      "Shows reliable team behaviour"
    ]'::jsonb,
    '[
      {"label":"Current strengths","parentVisible":true},
      {"label":"Priority development objective","parentVisible":true},
      {"label":"Practical next step","parentVisible":true},
      {"label":"Positive coach summary","parentVisible":true},
      {"label":"Private staff observation","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u15-u16-performance-development-review',
    'U15-U16',
    15,
    16,
    'U15-U16 Performance Development Review',
    'Performance consistency, tactical execution, preparation, communication and ownership.',
    '["Not observed","Needs support","Developing","Consistent","High standard"]'::jsonb,
    '[
      "Prepares appropriately for training and matches",
      "Executes core techniques under pressure",
      "Makes effective decisions at match tempo",
      "Understands and performs positional responsibilities",
      "Adapts to changing match situations",
      "Contributes during attacking transitions",
      "Contributes during defensive transitions",
      "Communicates clearly and constructively",
      "Shows leadership where appropriate",
      "Maintains concentration and work rate",
      "Responds effectively to setbacks",
      "Takes ownership of development targets",
      "Applies feedback independently",
      "Performs consistently across sessions and matches",
      "Supports team standards and behaviour"
    ]'::jsonb,
    '[
      {"label":"Current performance strengths","parentVisible":true},
      {"label":"Priority short-term objective","parentVisible":true},
      {"label":"Suggested individual work","parentVisible":true},
      {"label":"Coach performance summary","parentVisible":true},
      {"label":"Private staff note","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u17-u18-progression-review',
    'U17-U18',
    17,
    18,
    'U17-U18 Progression Review',
    'Performance standards, tactical adaptability, leadership, self-analysis and next-step preparation.',
    '["Not observed","Needs support","Developing","Consistent","High standard"]'::jsonb,
    '[
      "Demonstrates strong preparation habits",
      "Maintains technical quality under pressure",
      "Makes effective decisions at senior match tempo",
      "Understands and adapts positional responsibilities",
      "Reads tactical changes during play",
      "Influences attacking and defensive transitions",
      "Communicates with clarity and purpose",
      "Demonstrates leadership and accountability",
      "Maintains physical and mental intensity",
      "Responds constructively to setbacks",
      "Analyses their own performance honestly",
      "Takes ownership of individual development work",
      "Supports team culture and standards",
      "Performs consistently in different match contexts",
      "Shows readiness for the next stage of development"
    ]'::jsonb,
    '[
      {"label":"Current performance strengths","parentVisible":true},
      {"label":"Priority development objective","parentVisible":true},
      {"label":"Next-step action plan","parentVisible":true},
      {"label":"Positive coach summary","parentVisible":true},
      {"label":"Private progression note","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u7-u10-goalkeeper-foundation-review',
    'U7-U10',
    7,
    10,
    'U7-U10 Goalkeeper Foundation Review',
    'Confidence, safe handling, movement, simple distribution and positive communication.',
    '["Not observed","Beginning","Developing","Consistent"]'::jsonb,
    '[
      "Enjoys and confidently attempts goalkeeping activities",
      "Uses a ready position",
      "Gets their body behind the ball",
      "Attempts safe basic handling",
      "Moves feet to reach the ball",
      "Shows bravery appropriate to the situation",
      "Restarts play with throws or simple passes",
      "Communicates simple information",
      "Recovers after a save or mistake",
      "Works positively with teammates"
    ]'::jsonb,
    '[
      {"label":"Strength","parentVisible":true},
      {"label":"One small focus","parentVisible":true},
      {"label":"Suggested practice","parentVisible":true},
      {"label":"Positive message","parentVisible":true},
      {"label":"Staff note","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u11-u14-goalkeeper-development-review',
    'U11-U14',
    11,
    14,
    'U11-U14 Goalkeeper Development Review',
    'Set position, movement, handling decisions, distribution and communication.',
    '["Not observed","Emerging","Developing","Consistent","Strong"]'::jsonb,
    '[
      "Uses an effective set position",
      "Moves efficiently before the save",
      "Handles securely where appropriate",
      "Makes suitable parrying decisions",
      "Manages one-versus-one situations",
      "Makes appropriate decisions on crosses",
      "Selects suitable distribution",
      "Supports build-up as an available passing option",
      "Uses an effective starting position",
      "Communicates with defenders",
      "Reacts effectively after possession changes",
      "Responds constructively after mistakes"
    ]'::jsonb,
    '[
      {"label":"Strength","parentVisible":true},
      {"label":"Priority focus","parentVisible":true},
      {"label":"Suggested practice","parentVisible":true},
      {"label":"Positive summary","parentVisible":true},
      {"label":"Private note","parentVisible":false}
    ]'::jsonb
  ),
  (
    'u15-u18-goalkeeper-performance-review',
    'U15-U18',
    15,
    18,
    'U15-U18 Goalkeeper Performance Review',
    'Performance preparation, tactical decisions, distribution, organisation and self-review.',
    '["Not observed","Needs support","Developing","Consistent","High standard"]'::jsonb,
    '[
      "Prepares effectively for performance",
      "Maintains an effective set position",
      "Shows reliable shot-stopping technique",
      "Makes strong handling and parrying decisions",
      "Manages one-versus-one situations",
      "Commands aerial situations appropriately",
      "Uses accurate and purposeful distribution",
      "Supports possession with effective positioning",
      "Sweeps behind the defensive line",
      "Organises and communicates clearly",
      "Controls restart tempo",
      "Makes effective tactical decisions",
      "Shows resilience and concentration",
      "Reviews their own performance constructively"
    ]'::jsonb,
    '[
      {"label":"Performance strengths","parentVisible":true},
      {"label":"Priority objective","parentVisible":true},
      {"label":"Individual action plan","parentVisible":true},
      {"label":"Coach summary","parentVisible":true},
      {"label":"Private progression note","parentVisible":false}
    ]'::jsonb
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
  source.age_band,
  source.age_min,
  source.age_max,
  source.name,
  source.description,
  app_private.build_starter_feedback_fields(
    source.observation_labels,
    source.observation_scale,
    source.written_fields
  ),
  true
from template_source source
on conflict (template_key, version) do update
set age_band = excluded.age_band,
    age_min = excluded.age_min,
    age_max = excluded.age_max,
    name = excluded.name,
    description = excluded.description,
    fields = excluded.fields,
    is_current = true,
    updated_at = timezone('utc', now());

drop function app_private.build_starter_feedback_fields(jsonb, jsonb, jsonb);

revoke all on public.feedback_form_starter_templates from public, anon, authenticated;
grant select on public.feedback_form_starter_templates to authenticated;

revoke all on public.feedback_form_starter_preferences from public, anon, authenticated;
grant select, insert, update on public.feedback_form_starter_preferences to authenticated;

alter table public.feedback_form_starter_templates enable row level security;
alter table public.feedback_form_starter_preferences enable row level security;

drop policy if exists feedback_form_starter_templates_staff_select on public.feedback_form_starter_templates;
create policy feedback_form_starter_templates_staff_select
on public.feedback_form_starter_templates
for select
to authenticated
using (
  public.current_user_club_id() is not null
  and public.current_user_role() not in ('parent_portal', 'super_admin')
  and public.can_use_plan_feature(public.current_user_club_id(), 'customDevelopmentFields')
);

drop policy if exists feedback_form_starter_preferences_team_select on public.feedback_form_starter_preferences;
create policy feedback_form_starter_preferences_team_select
on public.feedback_form_starter_preferences
for select
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() not in ('parent_portal', 'super_admin')
  and public.can_use_plan_feature(club_id, 'customDevelopmentFields')
  and exists (
    select 1
    from public.team_staff assignment
    where assignment.team_id = feedback_form_starter_preferences.team_id
      and assignment.user_id = auth.uid()
  )
);

drop policy if exists feedback_form_starter_preferences_manager_insert on public.feedback_form_starter_preferences;
create policy feedback_form_starter_preferences_manager_insert
on public.feedback_form_starter_preferences
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(club_id, 'customDevelopmentFields')
  and exists (
    select 1
    from public.teams team
    join public.team_staff assignment
      on assignment.team_id = team.id
     and assignment.user_id = auth.uid()
    where team.id = feedback_form_starter_preferences.team_id
      and team.club_id = feedback_form_starter_preferences.club_id
  )
  and exists (
    select 1
    from public.feedback_form_starter_templates template
    where template.template_key = feedback_form_starter_preferences.template_key
      and template.is_current
  )
);

drop policy if exists feedback_form_starter_preferences_manager_update on public.feedback_form_starter_preferences;
create policy feedback_form_starter_preferences_manager_update
on public.feedback_form_starter_preferences
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(club_id, 'customDevelopmentFields')
  and exists (
    select 1
    from public.team_staff assignment
    where assignment.team_id = feedback_form_starter_preferences.team_id
      and assignment.user_id = auth.uid()
  )
)
with check (
  club_id = public.current_user_club_id()
  and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(club_id, 'customDevelopmentFields')
  and exists (
    select 1
    from public.teams team
    join public.team_staff assignment
      on assignment.team_id = team.id
     and assignment.user_id = auth.uid()
    where team.id = feedback_form_starter_preferences.team_id
      and team.club_id = feedback_form_starter_preferences.club_id
  )
  and exists (
    select 1
    from public.feedback_form_starter_templates template
    where template.template_key = feedback_form_starter_preferences.template_key
      and template.is_current
  )
);

-- Repair procedure:
-- 1. Set any affected preference row hidden = false for the exact club and team.
-- 2. Set the intended version is_current = true and any other version of that key false.
-- 3. Re-run the seed insert after reviewing the exact template key and version.
-- Existing feedback_forms and evaluations rows require no repair because this migration does not modify them.
