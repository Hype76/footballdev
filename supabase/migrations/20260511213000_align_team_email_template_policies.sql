drop policy if exists parent_email_templates_select_scoped on public.parent_email_templates;
create policy parent_email_templates_select_scoped
on public.parent_email_templates
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    parent_email_templates.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and public.can_use_plan_feature(parent_email_templates.club_id, 'parent_email')
    and parent_email_templates.team_id is not null
    and exists (
      select 1
      from public.teams t
      where t.id = parent_email_templates.team_id
        and t.club_id = public.current_user_club_id()
    )
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
  and parent_email_templates.team_id is not null
  and exists (
    select 1
    from public.teams t
    where t.id = parent_email_templates.team_id
      and t.club_id = public.current_user_club_id()
  )
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
  and parent_email_templates.team_id is not null
  and exists (
    select 1
    from public.teams t
    where t.id = parent_email_templates.team_id
      and t.club_id = public.current_user_club_id()
  )
)
with check (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parent_email')
  and parent_email_templates.team_id is not null
  and exists (
    select 1
    from public.teams t
    where t.id = parent_email_templates.team_id
      and t.club_id = public.current_user_club_id()
  )
);

drop policy if exists parent_email_templates_delete_custom_scoped on public.parent_email_templates;
create policy parent_email_templates_delete_custom_scoped
on public.parent_email_templates
for delete
to authenticated
using (
  public.current_user_role() <> 'super_admin'
  and parent_email_templates.club_id = public.current_user_club_id()
  and public.current_user_role_rank() >= 50
  and public.can_use_plan_feature(parent_email_templates.club_id, 'parent_email')
  and parent_email_templates.template_key not in ('decline', 'progress', 'offer', 'assessment')
  and parent_email_templates.team_id is not null
  and exists (
    select 1
    from public.teams t
    where t.id = parent_email_templates.team_id
      and t.club_id = public.current_user_club_id()
  )
);
