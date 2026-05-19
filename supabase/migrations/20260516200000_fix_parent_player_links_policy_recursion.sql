create or replace function public.current_user_can_access_parent_link(
  target_parent_link_id uuid,
  target_player_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.parent_player_links parent_link
    where parent_link.id = target_parent_link_id
      and parent_link.auth_user_id = auth.uid()
      and parent_link.status = 'active'
      and parent_link.player_id = target_player_id
  );
$$;

revoke all on function public.current_user_can_access_parent_link(uuid, uuid) from public;
grant execute on function public.current_user_can_access_parent_link(uuid, uuid) to authenticated;

drop policy if exists parent_player_links_select_scoped on public.parent_player_links;
create policy parent_player_links_select_scoped
on public.parent_player_links
for select
to authenticated
using (
  auth.uid() = auth_user_id
  or public.current_user_can_access_parent_link(parent_link_id, player_id)
  or public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_parent_link(team_id)
  )
);

drop policy if exists parent_player_links_insert_scoped on public.parent_player_links;
create policy parent_player_links_insert_scoped
on public.parent_player_links
for insert
to authenticated
with check (
  auth.uid() = auth_user_id
  or (
    link_type = 'family'
    and public.current_user_can_access_parent_link(parent_link_id, player_id)
  )
  or (
    club_id = public.current_user_club_id()
    and public.can_manage_parent_link(team_id)
    and exists (
      select 1
      from public.players p
      where p.id = parent_player_links.player_id
        and p.club_id = parent_player_links.club_id
        and (
          p.team_id = parent_player_links.team_id
          or parent_player_links.team_id is null
        )
    )
  )
);
