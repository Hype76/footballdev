alter table public.form_fields
  drop constraint if exists form_fields_type_check;

alter table public.form_fields
  add constraint form_fields_type_check
  check (type in ('text', 'textarea', 'number', 'select', 'score_1_5', 'score_1_10'));

update public.form_fields
set type = 'score_1_5'
where type = 'number'
  and lower(label) in (
    'technical',
    'tactical',
    'physical',
    'mentality',
    'coachability'
  );

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
      ('Technical', 'score_1_5', '[]'::jsonb, true, 1),
      ('Tactical', 'score_1_5', '[]'::jsonb, true, 2),
      ('Physical', 'score_1_5', '[]'::jsonb, true, 3),
      ('Mentality', 'score_1_5', '[]'::jsonb, true, 4),
      ('Coachability', 'score_1_5', '[]'::jsonb, true, 5),
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
  public.current_user_role() = 'super_admin'
  or form_fields.club_id = public.current_user_club_id()
);

drop policy if exists form_fields_insert_scoped on public.form_fields;
create policy form_fields_insert_scoped
on public.form_fields
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'super_admin'
    and form_fields.club_id is not null
  )
  or (
    public.current_user_role_rank() >= 50
    and form_fields.club_id = public.current_user_club_id()
  )
);

drop policy if exists form_fields_update_scoped on public.form_fields;
create policy form_fields_update_scoped
on public.form_fields
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 50
    and form_fields.club_id = public.current_user_club_id()
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role_rank() >= 50
    and form_fields.club_id = public.current_user_club_id()
  )
);

drop policy if exists form_fields_delete_scoped on public.form_fields;
create policy form_fields_delete_scoped
on public.form_fields
for delete
to authenticated
using (
  form_fields.is_default = false
  and (
    public.current_user_role() = 'super_admin'
    or (
      public.current_user_role_rank() >= 50
      and form_fields.club_id = public.current_user_club_id()
    )
  )
);
