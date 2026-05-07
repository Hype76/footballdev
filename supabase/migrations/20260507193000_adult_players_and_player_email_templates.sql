alter table public.players
  add column if not exists contact_type text not null default 'parent';

alter table public.evaluations
  add column if not exists contact_type text not null default 'parent';

alter table public.players
  drop constraint if exists players_contact_type_check;

alter table public.players
  add constraint players_contact_type_check
  check (contact_type in ('parent', 'self', 'both'));

alter table public.evaluations
  drop constraint if exists evaluations_contact_type_check;

alter table public.evaluations
  add constraint evaluations_contact_type_check
  check (contact_type in ('parent', 'self', 'both'));

alter table public.parent_email_templates
  add column if not exists audience text not null default 'parent';

alter table public.parent_email_templates
  drop constraint if exists parent_email_templates_audience_check;

alter table public.parent_email_templates
  add constraint parent_email_templates_audience_check
  check (audience in ('parent', 'player'));

drop index if exists public.parent_email_templates_club_key;

create unique index if not exists parent_email_templates_club_audience_key
on public.parent_email_templates (club_id, audience, template_key);

create index if not exists parent_email_templates_club_audience_order_idx
on public.parent_email_templates (club_id, audience, order_index);
