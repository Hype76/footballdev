alter table public.parent_email_templates
  add column if not exists section_availability jsonb not null default '["Trial", "Squad"]'::jsonb;

update public.parent_email_templates
set section_availability = case
  when template_key in ('decline', 'progress', 'offer') then '["Trial"]'::jsonb
  when template_key = 'assessment' then '["Squad"]'::jsonb
  else '["Trial", "Squad"]'::jsonb
end
where section_availability is null
  or section_availability = '[]'::jsonb
  or section_availability = '["Trial", "Squad"]'::jsonb;

alter table public.parent_email_templates
  drop constraint if exists parent_email_templates_section_availability_check;

alter table public.parent_email_templates
  add constraint parent_email_templates_section_availability_check
  check (
    jsonb_typeof(section_availability) = 'array'
    and jsonb_array_length(section_availability) > 0
    and section_availability <@ '["Trial", "Squad"]'::jsonb
  );
