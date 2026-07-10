alter table public.form_fields
  add column if not exists team_id uuid references public.teams (id) on delete cascade;

create index if not exists form_fields_team_id_idx on public.form_fields (team_id);
create index if not exists form_fields_club_team_order_idx on public.form_fields (club_id, team_id, order_index);

drop policy if exists form_fields_select_scoped on public.form_fields;
create policy form_fields_select_scoped
on public.form_fields
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    form_fields.club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
    and (
      form_fields.team_id is null
      or public.current_user_role() = 'admin'
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = form_fields.team_id
          and ts.user_id = auth.uid()
      )
    )
  )
);

drop policy if exists form_fields_insert_scoped on public.form_fields;
create policy form_fields_insert_scoped
on public.form_fields
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'admin'
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    and (
      (
        form_fields.team_id is null
        and coalesce(form_fields.is_default, false) = true
      )
      or (
        form_fields.team_id is not null
        and coalesce(form_fields.is_default, false) = false
        and exists (
          select 1
          from public.team_staff ts
          where ts.team_id = form_fields.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
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
    public.current_user_role() <> 'admin'
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and form_fields.team_id is not null
    and coalesce(form_fields.is_default, false) = false
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    and exists (
      select 1
      from public.team_staff ts
      where ts.team_id = form_fields.team_id
        and ts.user_id = auth.uid()
    )
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'admin'
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and form_fields.team_id is not null
    and coalesce(form_fields.is_default, false) = false
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    and exists (
      select 1
      from public.team_staff ts
      where ts.team_id = form_fields.team_id
        and ts.user_id = auth.uid()
    )
  )
);

drop policy if exists form_fields_delete_scoped on public.form_fields;
create policy form_fields_delete_scoped
on public.form_fields
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'admin'
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and form_fields.team_id is not null
    and coalesce(form_fields.is_default, false) = false
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    and exists (
      select 1
      from public.team_staff ts
      where ts.team_id = form_fields.team_id
        and ts.user_id = auth.uid()
    )
  )
);
