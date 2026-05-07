create table if not exists public.parent_email_templates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  template_key text not null,
  label text not null,
  subject text not null,
  body text not null,
  is_enabled boolean not null default true,
  order_index integer not null default 0,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_email_templates_key_check
    check (template_key in ('decline', 'progress', 'offer', 'assessment'))
);

create unique index if not exists parent_email_templates_club_key
on public.parent_email_templates (club_id, template_key);

create index if not exists parent_email_templates_club_order_idx
on public.parent_email_templates (club_id, order_index);

create or replace function public.set_parent_email_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists parent_email_templates_set_updated_at on public.parent_email_templates;
create trigger parent_email_templates_set_updated_at
before update on public.parent_email_templates
for each row
execute function public.set_parent_email_templates_updated_at();

grant select, insert, update on public.parent_email_templates to authenticated;

alter table public.parent_email_templates enable row level security;

drop policy if exists parent_email_templates_select_scoped on public.parent_email_templates;
create policy parent_email_templates_select_scoped
on public.parent_email_templates
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    parent_email_templates.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(parent_email_templates.club_id, 'parent_email')
  )
);

drop policy if exists parent_email_templates_insert_scoped on public.parent_email_templates;
create policy parent_email_templates_insert_scoped
on public.parent_email_templates
for insert
to authenticated
with check (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parent_email')
);

drop policy if exists parent_email_templates_update_scoped on public.parent_email_templates;
create policy parent_email_templates_update_scoped
on public.parent_email_templates
for update
to authenticated
using (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parent_email')
)
with check (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parent_email')
);
