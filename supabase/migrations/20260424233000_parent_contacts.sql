alter table public.players
  add column if not exists parent_contacts jsonb not null default '[]'::jsonb;

alter table public.evaluations
  add column if not exists parent_contacts jsonb not null default '[]'::jsonb;

alter table public.assessment_session_players
  add column if not exists parent_contacts jsonb not null default '[]'::jsonb;

update public.players
set parent_contacts = jsonb_build_array(
  jsonb_build_object(
    'name', coalesce(parent_name, ''),
    'email', coalesce(parent_email, '')
  )
)
where parent_contacts = '[]'::jsonb
  and (coalesce(parent_name, '') <> '' or coalesce(parent_email, '') <> '');

update public.evaluations
set parent_contacts = jsonb_build_array(
  jsonb_build_object(
    'name', coalesce(parent_name, ''),
    'email', coalesce(parent_email, '')
  )
)
where parent_contacts = '[]'::jsonb
  and (coalesce(parent_name, '') <> '' or coalesce(parent_email, '') <> '');

update public.assessment_session_players
set parent_contacts = jsonb_build_array(
  jsonb_build_object(
    'name', coalesce(parent_name, ''),
    'email', coalesce(parent_email, '')
  )
)
where parent_contacts = '[]'::jsonb
  and (coalesce(parent_name, '') <> '' or coalesce(parent_email, '') <> '');
