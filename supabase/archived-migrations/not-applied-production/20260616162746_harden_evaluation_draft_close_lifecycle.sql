revoke delete, truncate, references, trigger on public.evaluation_drafts from authenticated;
revoke all on public.evaluation_drafts from anon;
grant select, insert, update on public.evaluation_drafts to authenticated;
grant select, insert, update, delete on public.evaluation_drafts to service_role;

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
  and club_id = public.current_user_club_id()
  and public.current_user_role() <> 'parent_portal'
  and public.current_user_role_rank() >= 20
  and (
    status in ('submitted', 'discarded')
    or (
      status = 'draft'
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
        )
      )
    )
  )
);
