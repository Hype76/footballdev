alter table public.parent_email_templates
  add column if not exists team_id uuid references public.teams (id) on delete cascade;

update public.parent_email_templates pet
set team_id = assigned.team_id
from (
  select
    ts.user_id,
    min(ts.team_id::text)::uuid as team_id
  from public.team_staff ts
  group by ts.user_id
) assigned
where pet.team_id is null
  and pet.created_by = assigned.user_id;

drop index if exists public.parent_email_templates_club_audience_key;
drop index if exists public.parent_email_templates_default_club_audience_key;
drop index if exists public.parent_email_templates_custom_team_audience_key;

create unique index if not exists parent_email_templates_club_team_audience_key
on public.parent_email_templates (club_id, team_id, audience, template_key) nulls not distinct;

create index if not exists parent_email_templates_team_order_idx
on public.parent_email_templates (club_id, team_id, audience, order_index);

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
    and parent_email_templates.team_id is not null
    and exists (
      select 1
      from public.team_staff ts
      where ts.team_id = parent_email_templates.team_id
        and ts.user_id = auth.uid()
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
    from public.team_staff ts
    where ts.team_id = parent_email_templates.team_id
      and ts.user_id = auth.uid()
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
    from public.team_staff ts
    where ts.team_id = parent_email_templates.team_id
      and ts.user_id = auth.uid()
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
    from public.team_staff ts
    where ts.team_id = parent_email_templates.team_id
      and ts.user_id = auth.uid()
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
    from public.team_staff ts
    where ts.team_id = parent_email_templates.team_id
      and ts.user_id = auth.uid()
  )
);
