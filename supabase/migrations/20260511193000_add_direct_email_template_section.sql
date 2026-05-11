alter table public.parent_email_templates
  drop constraint if exists parent_email_templates_section_availability_check;

update public.parent_email_templates
set section_availability = section_availability || '["Direct Email"]'::jsonb
where jsonb_typeof(section_availability) = 'array'
  and not section_availability @> '["Direct Email"]'::jsonb;

alter table public.parent_email_templates
  alter column section_availability set default '["Trial", "Squad", "Direct Email"]'::jsonb;

alter table public.parent_email_templates
  add constraint parent_email_templates_section_availability_check
  check (
    jsonb_typeof(section_availability) = 'array'
    and jsonb_array_length(section_availability) > 0
    and section_availability <@ '["Trial", "Squad", "Direct Email"]'::jsonb
  );
