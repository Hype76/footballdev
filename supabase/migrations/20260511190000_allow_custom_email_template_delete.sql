grant delete on public.parent_email_templates to authenticated;

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
);
