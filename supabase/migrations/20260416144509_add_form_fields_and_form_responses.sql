create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  label text not null,
  type text not null,
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  order_index integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.evaluations
  add column if not exists form_responses jsonb not null default '{}'::jsonb;

create index if not exists form_fields_club_id_idx on public.form_fields (club_id);
create index if not exists form_fields_order_index_idx on public.form_fields (club_id, order_index);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'form_fields_type_check'
  ) then
    alter table public.form_fields
      add constraint form_fields_type_check
      check (type in ('text', 'textarea', 'number', 'select'));
  end if;
end $$;

update public.evaluations
set form_responses = coalesce(form_responses, '{}'::jsonb)
  || coalesce(scores, '{}'::jsonb)
  || jsonb_strip_nulls(
    jsonb_build_object(
      'Strengths', nullif(comments ->> 'strengths', ''),
      'Improvements', nullif(comments ->> 'improvements', ''),
      'Overall Comments', nullif(comments ->> 'overall', '')
    )
  )
where form_responses = '{}'::jsonb
   or form_responses is null;

grant select, insert, update, delete on public.form_fields to authenticated;

alter table public.form_fields enable row level security;

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
  public.current_user_role() in ('manager', 'super_admin')
  and (
    public.current_user_role() = 'super_admin'
    or form_fields.club_id = public.current_user_club_id()
  )
);

drop policy if exists form_fields_update_scoped on public.form_fields;
create policy form_fields_update_scoped
on public.form_fields
for update
to authenticated
using (
  public.current_user_role() in ('manager', 'super_admin')
  and (
    public.current_user_role() = 'super_admin'
    or form_fields.club_id = public.current_user_club_id()
  )
)
with check (
  public.current_user_role() in ('manager', 'super_admin')
  and (
    public.current_user_role() = 'super_admin'
    or form_fields.club_id = public.current_user_club_id()
  )
);

drop policy if exists form_fields_delete_scoped on public.form_fields;
create policy form_fields_delete_scoped
on public.form_fields
for delete
to authenticated
using (
  public.current_user_role() in ('manager', 'super_admin')
  and (
    public.current_user_role() = 'super_admin'
    or form_fields.club_id = public.current_user_club_id()
  )
);
