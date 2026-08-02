-- Keep the internal compatibility trigger private, stabilize new RLS lookups,
-- and add covering indexes for the immutable Team membership ledgers.

revoke all on function public.sync_player_team_membership()
from public, anon, authenticated;
grant execute on function public.sync_player_team_membership()
to service_role;

drop policy if exists player_team_memberships_select_scoped
on public.player_team_memberships;

create policy player_team_memberships_select_scoped
on public.player_team_memberships
for select
to authenticated
using (
  club_id = (select public.current_user_club_id())
  and (
    (select public.current_user_role()) = 'admin'
    or exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = player_team_memberships.team_id
        and assignment.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.parent_player_links link
      where link.player_id = player_team_memberships.player_id
        and link.team_id = player_team_memberships.team_id
        and link.auth_user_id = (select auth.uid())
        and link.status = 'active'
    )
    or exists (
      select 1 from public.adult_player_account_links link
      where link.player_id = player_team_memberships.player_id
        and link.team_id = player_team_memberships.team_id
        and link.user_id = (select auth.uid())
        and link.status = 'active'
        and link.revoked_at is null
    )
  )
);

drop policy if exists player_team_removal_commands_select_scoped
on public.player_team_removal_commands;

create policy player_team_removal_commands_select_scoped
on public.player_team_removal_commands
for select
to authenticated
using (
  club_id = (select public.current_user_club_id())
  and (select public.current_user_role_rank()) >= 50
  and (select public.current_user_role()) <> 'super_admin'
  and (
    (select public.current_user_role()) = 'admin'
    or exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = player_team_removal_commands.team_id
        and assignment.user_id = (select auth.uid())
    )
  )
);

create index if not exists player_team_memberships_team_fk_idx
on public.player_team_memberships (team_id);

create index if not exists player_team_memberships_ended_by_fk_idx
on public.player_team_memberships (ended_by)
where ended_by is not null;

create index if not exists player_team_removal_commands_team_fk_idx
on public.player_team_removal_commands (team_id);

create index if not exists player_team_removal_commands_player_fk_idx
on public.player_team_removal_commands (player_id);

create index if not exists player_team_removal_commands_membership_fk_idx
on public.player_team_removal_commands (membership_id);
