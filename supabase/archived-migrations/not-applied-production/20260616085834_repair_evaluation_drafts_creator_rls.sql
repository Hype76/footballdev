drop policy if exists evaluation_drafts_select_own_active on public.evaluation_drafts;
create policy evaluation_drafts_select_own_active
on public.evaluation_drafts
for select
to authenticated
using (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
);

drop policy if exists evaluation_drafts_insert_own_active on public.evaluation_drafts;
create policy evaluation_drafts_insert_own_active
on public.evaluation_drafts
for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    team_id is null
    or exists (
      select 1
      from public.teams team
      where team.id = evaluation_drafts.team_id
        and team.club_id = evaluation_drafts.club_id
    )
  )
  and (
    player_id is null
    or exists (
      select 1
      from public.players player
      where player.id = evaluation_drafts.player_id
        and player.club_id = evaluation_drafts.club_id
        and (
          evaluation_drafts.team_id is null
          or player.team_id = evaluation_drafts.team_id
        )
    )
  )
);

drop policy if exists evaluation_drafts_update_own_active on public.evaluation_drafts;
create policy evaluation_drafts_update_own_active
on public.evaluation_drafts
for update
to authenticated
using (
  created_by_user_id = auth.uid()
  and status = 'draft'
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
)
with check (
  created_by_user_id = auth.uid()
  and status in ('draft', 'submitted', 'discarded')
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    team_id is null
    or exists (
      select 1
      from public.teams team
      where team.id = evaluation_drafts.team_id
        and team.club_id = evaluation_drafts.club_id
    )
  )
  and (
    player_id is null
    or exists (
      select 1
      from public.players player
      where player.id = evaluation_drafts.player_id
        and player.club_id = evaluation_drafts.club_id
        and (
          evaluation_drafts.team_id is null
          or player.team_id = evaluation_drafts.team_id
        )
    )
  )
);
