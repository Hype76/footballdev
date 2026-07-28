-- FP-V1-DEVELOPMENT-SAVE-PERSISTENCE-RECOVERY-27
-- Keep Development Record writes inside the actor's current active authority.
-- This migration changes policies only and does not update business rows.

drop policy if exists evaluations_insert_scoped on public.evaluations;
create policy evaluations_insert_scoped
on public.evaluations
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'parent_portal'
    and public.current_user_can_access_team(evaluations.club_id, evaluations.team_id)
    and public.can_insert_evaluation_for_plan(evaluations.club_id)
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
);

drop policy if exists evaluations_update_scoped on public.evaluations;
create policy evaluations_update_scoped
on public.evaluations
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'parent_portal'
    and public.current_user_can_access_team(evaluations.club_id, evaluations.team_id)
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'parent_portal'
    and public.current_user_can_access_team(evaluations.club_id, evaluations.team_id)
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
    )
  )
);

drop policy if exists evaluations_delete_manager_only on public.evaluations;
create policy evaluations_delete_manager_only
on public.evaluations
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 50
    and public.current_user_can_access_team(evaluations.club_id, evaluations.team_id)
  )
);

drop policy if exists evaluation_drafts_select_own_active on public.evaluation_drafts;
create policy evaluation_drafts_select_own_active
on public.evaluation_drafts
for select
to authenticated
using (
  evaluation_drafts.created_by_user_id = auth.uid()
  and evaluation_drafts.status in ('draft', 'submitted', 'discarded')
  and evaluation_drafts.club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and public.current_user_can_access_team(
    evaluation_drafts.club_id,
    evaluation_drafts.team_id
  )
);

drop policy if exists evaluation_drafts_insert_own_active on public.evaluation_drafts;
create policy evaluation_drafts_insert_own_active
on public.evaluation_drafts
for insert
to authenticated
with check (
  evaluation_drafts.created_by_user_id = auth.uid()
  and evaluation_drafts.status = 'draft'
  and evaluation_drafts.club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and public.current_user_can_access_team(
    evaluation_drafts.club_id,
    evaluation_drafts.team_id
  )
  and (
    evaluation_drafts.player_id is null
    or exists (
      select 1
      from public.players player
      where player.id = evaluation_drafts.player_id
        and player.club_id = evaluation_drafts.club_id
        and player.team_id = evaluation_drafts.team_id
    )
  )
);

drop policy if exists evaluation_drafts_update_own_active on public.evaluation_drafts;
drop policy if exists evaluation_drafts_close_own_active on public.evaluation_drafts;
create policy evaluation_drafts_update_own_active
on public.evaluation_drafts
for update
to authenticated
using (
  evaluation_drafts.created_by_user_id = auth.uid()
  and evaluation_drafts.status = 'draft'
  and evaluation_drafts.club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and public.current_user_can_access_team(
    evaluation_drafts.club_id,
    evaluation_drafts.team_id
  )
)
with check (
  evaluation_drafts.created_by_user_id = auth.uid()
  and evaluation_drafts.status in ('draft', 'submitted', 'discarded')
  and evaluation_drafts.club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and public.current_user_can_access_team(
    evaluation_drafts.club_id,
    evaluation_drafts.team_id
  )
  and (
    evaluation_drafts.status <> 'draft'
    or evaluation_drafts.player_id is null
    or exists (
      select 1
      from public.players player
      where player.id = evaluation_drafts.player_id
        and player.club_id = evaluation_drafts.club_id
        and player.team_id = evaluation_drafts.team_id
    )
  )
);

revoke all on public.evaluations from anon;
revoke truncate, references, trigger on public.evaluations from authenticated;
grant select, insert, update, delete on public.evaluations to authenticated;
grant select, insert, update, delete on public.evaluations to service_role;

revoke delete, truncate, references, trigger on public.evaluation_drafts from authenticated;
revoke all on public.evaluation_drafts from anon;
grant select, insert, update on public.evaluation_drafts to authenticated;
grant select, insert, update, delete on public.evaluation_drafts to service_role;
