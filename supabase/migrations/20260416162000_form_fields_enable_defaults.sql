alter table public.form_fields
  add column if not exists is_enabled boolean not null default true;

update public.form_fields
set is_enabled = true
where is_enabled is null;

with default_fields(label, type, options, required, order_index) as (
  values
    ('Technical', 'number', '[]'::jsonb, true, 1),
    ('Tactical', 'number', '[]'::jsonb, true, 2),
    ('Physical', 'number', '[]'::jsonb, true, 3),
    ('Mentality', 'number', '[]'::jsonb, true, 4),
    ('Coachability', 'number', '[]'::jsonb, true, 5),
    ('Strengths', 'textarea', '[]'::jsonb, false, 6),
    ('Improvements', 'textarea', '[]'::jsonb, false, 7),
    ('Overall Comments', 'textarea', '[]'::jsonb, true, 8)
)
update public.form_fields as form_fields
set is_default = true,
    is_enabled = true,
    order_index = case
      when form_fields.order_index is null or form_fields.order_index = 0 then default_fields.order_index
      else form_fields.order_index
    end
from default_fields
where lower(form_fields.label) = lower(default_fields.label);

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
    is_enabled
  )
  select
    target_club_id,
    default_fields.label,
    default_fields.type,
    default_fields.options,
    default_fields.required,
    default_fields.order_index,
    true,
    true
  from (
    values
      ('Technical', 'number', '[]'::jsonb, true, 1),
      ('Tactical', 'number', '[]'::jsonb, true, 2),
      ('Physical', 'number', '[]'::jsonb, true, 3),
      ('Mentality', 'number', '[]'::jsonb, true, 4),
      ('Coachability', 'number', '[]'::jsonb, true, 5),
      ('Strengths', 'textarea', '[]'::jsonb, false, 6),
      ('Improvements', 'textarea', '[]'::jsonb, false, 7),
      ('Overall Comments', 'textarea', '[]'::jsonb, true, 8)
  ) as default_fields(label, type, options, required, order_index)
  where not exists (
    select 1
    from public.form_fields existing_fields
    where existing_fields.club_id = target_club_id
      and lower(existing_fields.label) = lower(default_fields.label)
  );
end;
$$;

grant execute on function public.seed_default_form_fields() to authenticated;

drop policy if exists form_fields_select_scoped on public.form_fields;
create policy form_fields_select_scoped
on public.form_fields
for select
to authenticated
using (
  form_fields.club_id = public.current_user_club_id()
);

drop policy if exists form_fields_insert_scoped on public.form_fields;
create policy form_fields_insert_scoped
on public.form_fields
for insert
to authenticated
with check (
  public.current_user_role() = 'manager'
  and form_fields.club_id = public.current_user_club_id()
);

drop policy if exists form_fields_update_scoped on public.form_fields;
create policy form_fields_update_scoped
on public.form_fields
for update
to authenticated
using (
  public.current_user_role() = 'manager'
  and form_fields.club_id = public.current_user_club_id()
)
with check (
  public.current_user_role() = 'manager'
  and form_fields.club_id = public.current_user_club_id()
);

drop policy if exists form_fields_delete_scoped on public.form_fields;
create policy form_fields_delete_scoped
on public.form_fields
for delete
to authenticated
using (
  public.current_user_role() = 'manager'
  and form_fields.club_id = public.current_user_club_id()
  and form_fields.is_default = false
);
