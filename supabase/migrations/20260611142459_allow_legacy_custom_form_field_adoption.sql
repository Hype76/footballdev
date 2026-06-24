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
    and coalesce(form_fields.is_default, false) = false
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    and (
      form_fields.team_id is null
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = form_fields.team_id
          and ts.user_id = auth.uid()
      )
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
