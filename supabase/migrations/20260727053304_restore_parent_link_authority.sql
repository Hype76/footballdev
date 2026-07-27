-- FP-V1-PARENT-ACCESS-SCREEN-REGRESSION-03A
-- Restore active Parent-link ownership as an authority source for Parent-only accounts.
-- This migration changes authority metadata only. It does not update Parent or player rows.

create or replace function public.current_user_can_access_parent_player(target_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and (
      not exists (
        select 1
        from public.users actor
        where actor.id = (select auth.uid())
      )
      or public.current_user_has_active_authority()
    )
    and exists (
      select 1
      from public.parent_player_links link
      join public.players player
        on player.id = link.player_id
       and player.club_id = link.club_id
      where link.auth_user_id = (select auth.uid())
        and link.status = 'active'
        and link.player_id = target_player_id
        and coalesce(player.status, 'active') <> 'archived'
    );
$$;

create or replace function public.current_user_can_access_parent_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and target_team_id is not null
    and (
      not exists (
        select 1
        from public.users actor
        where actor.id = (select auth.uid())
      )
      or public.current_user_has_active_authority()
    )
    and exists (
      select 1
      from public.parent_player_links link
      join public.players player
        on player.id = link.player_id
       and player.club_id = link.club_id
      where link.auth_user_id = (select auth.uid())
        and link.status = 'active'
        and coalesce(player.status, 'active') <> 'archived'
        and player.team_id = target_team_id
        and coalesce(link.team_id, player.team_id) = target_team_id
    );
$$;

create or replace function public.current_user_can_access_parent_link(
  target_parent_link_id uuid,
  target_player_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and (
      not exists (
        select 1
        from public.users actor
        where actor.id = (select auth.uid())
      )
      or public.current_user_has_active_authority()
    )
    and exists (
      select 1
      from public.parent_player_links parent_link
      join public.players player
        on player.id = parent_link.player_id
       and player.club_id = parent_link.club_id
      where parent_link.id = target_parent_link_id
        and parent_link.auth_user_id = (select auth.uid())
        and parent_link.status = 'active'
        and parent_link.player_id = target_player_id
        and coalesce(player.status, 'active') <> 'archived'
    );
$$;

create or replace function public.current_user_can_access_parent_club(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and target_club_id is not null
    and (
      not exists (
        select 1
        from public.users actor
        where actor.id = (select auth.uid())
      )
      or public.current_user_has_active_authority()
    )
    and exists (
      select 1
      from public.parent_player_links link
      join public.players player
        on player.id = link.player_id
       and player.club_id = link.club_id
      where link.auth_user_id = (select auth.uid())
        and link.status = 'active'
        and link.club_id = target_club_id
        and coalesce(player.status, 'active') <> 'archived'
    );
$$;

revoke all on function public.current_user_can_access_parent_player(uuid) from public, anon;
revoke all on function public.current_user_can_access_parent_team(uuid) from public, anon;
revoke all on function public.current_user_can_access_parent_link(uuid, uuid) from public, anon;
revoke all on function public.current_user_can_access_parent_club(uuid) from public, anon;

grant execute on function public.current_user_can_access_parent_player(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_parent_team(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_parent_link(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_parent_club(uuid) to authenticated, service_role;

drop policy if exists clubs_select_exact_authority on public.clubs;
create policy clubs_select_exact_authority
on public.clubs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or id = public.current_user_club_id()
  or public.current_user_can_access_parent_club(id)
);

comment on function public.current_user_can_access_parent_player(uuid) is
  'Allows an authenticated account to read only active, non-archived players linked directly to that account. Parent-only accounts do not require staff authority rows.';
comment on function public.current_user_can_access_parent_team(uuid) is
  'Allows an authenticated account to read only teams reached through its active, non-archived Parent links. Parent-only accounts do not require staff authority rows.';
comment on function public.current_user_can_access_parent_link(uuid, uuid) is
  'Allows an authenticated account to read only its own active Parent links for non-archived players. Parent-only accounts do not require staff authority rows.';
comment on function public.current_user_can_access_parent_club(uuid) is
  'Allows an authenticated account to read only clubs reached through its active, non-archived Parent links. Parent-only accounts do not require staff authority rows.';
