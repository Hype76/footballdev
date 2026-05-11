alter table public.parent_email_templates
  drop constraint if exists parent_email_templates_key_check;

alter table public.parent_email_templates
  add constraint parent_email_templates_key_check
  check (template_key ~ '^[a-z0-9][a-z0-9_-]{1,60}$');
