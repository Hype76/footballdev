create table if not exists public.feedback_forms (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  fields jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  version integer not null default 1,
  duplicated_from_id uuid references public.feedback_forms (id) on delete set null,
  archived_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_by_name text not null default '',
  created_by_email text not null default '',
  updated_by uuid references public.users (id) on delete set null,
  updated_by_name text not null default '',
  updated_by_email text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'form_fields_type_check') then
    alter table public.form_fields
      drop constraint form_fields_type_check;
  end if;

  alter table public.form_fields
    add constraint form_fields_type_check
    check (type in ('text', 'textarea', 'number', 'select', 'score_1_5', 'score_1_10', 'yes_no', 'traffic_light'));

  if not exists (select 1 from pg_constraint where conname = 'feedback_forms_name_not_blank') then
    alter table public.feedback_forms
      add constraint feedback_forms_name_not_blank
      check (char_length(trim(name)) > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'feedback_forms_status_check') then
    alter table public.feedback_forms
      add constraint feedback_forms_status_check
      check (status in ('active', 'archived'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'feedback_forms_fields_array_check') then
    alter table public.feedback_forms
      add constraint feedback_forms_fields_array_check
      check (jsonb_typeof(fields) = 'array');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'feedback_forms_version_positive_check') then
    alter table public.feedback_forms
      add constraint feedback_forms_version_positive_check
      check (version > 0);
  end if;
end $$;

alter table public.evaluations
  add column if not exists feedback_form_id uuid references public.feedback_forms (id) on delete set null,
  add column if not exists feedback_form_name text,
  add column if not exists feedback_form_version integer,
  add column if not exists feedback_form_snapshot jsonb not null default '{}'::jsonb;

create index if not exists feedback_forms_club_team_status_idx
on public.feedback_forms (club_id, team_id, status, updated_at desc);

create index if not exists feedback_forms_team_name_idx
on public.feedback_forms (team_id, lower(name));

create index if not exists evaluations_feedback_form_id_idx
on public.evaluations (feedback_form_id);

revoke all on public.feedback_forms from anon;
revoke all on public.feedback_forms from authenticated;
grant select, insert, update on public.feedback_forms to authenticated;

alter table public.feedback_forms enable row level security;

drop policy if exists feedback_forms_select_team_scoped on public.feedback_forms;
create policy feedback_forms_select_team_scoped
on public.feedback_forms
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    feedback_forms.club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and public.can_use_plan_feature(feedback_forms.club_id, 'customDevelopmentFields')
    and (
      public.current_user_role() = 'admin'
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = feedback_forms.team_id
          and ts.user_id = auth.uid()
      )
    )
  )
);

drop policy if exists feedback_forms_insert_manager_scoped on public.feedback_forms;
create policy feedback_forms_insert_manager_scoped
on public.feedback_forms
for insert
to authenticated
with check (
  feedback_forms.club_id = public.current_user_club_id()
  and feedback_forms.team_id is not null
  and exists (
    select 1
    from public.teams team
    where team.id = feedback_forms.team_id
      and team.club_id = feedback_forms.club_id
  )
  and public.can_use_plan_feature(feedback_forms.club_id, 'customDevelopmentFields')
  and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
  and public.current_user_role_rank() >= 50
  and exists (
    select 1
    from public.team_staff ts
    where ts.team_id = feedback_forms.team_id
      and ts.user_id = auth.uid()
  )
);

drop policy if exists feedback_forms_update_manager_scoped on public.feedback_forms;
create policy feedback_forms_update_manager_scoped
on public.feedback_forms
for update
to authenticated
using (
  feedback_forms.club_id = public.current_user_club_id()
  and feedback_forms.team_id is not null
  and exists (
    select 1
    from public.teams team
    where team.id = feedback_forms.team_id
      and team.club_id = feedback_forms.club_id
  )
  and public.can_use_plan_feature(feedback_forms.club_id, 'customDevelopmentFields')
  and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
  and public.current_user_role_rank() >= 50
  and exists (
    select 1
    from public.team_staff ts
    where ts.team_id = feedback_forms.team_id
      and ts.user_id = auth.uid()
  )
)
with check (
  feedback_forms.club_id = public.current_user_club_id()
  and feedback_forms.team_id is not null
  and exists (
    select 1
    from public.teams team
    where team.id = feedback_forms.team_id
      and team.club_id = feedback_forms.club_id
  )
  and public.can_use_plan_feature(feedback_forms.club_id, 'customDevelopmentFields')
  and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
  and public.current_user_role_rank() >= 50
  and exists (
    select 1
    from public.team_staff ts
    where ts.team_id = feedback_forms.team_id
      and ts.user_id = auth.uid()
  )
);

-- Rollback notes:
-- Drop the feedback_forms table and the four evaluation feedback_form_* columns
-- only after confirming no submitted development record depends on named form snapshots.
