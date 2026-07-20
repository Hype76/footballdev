-- FP-V1-SECURITY P1 tenant, parent, player, staff and feedback isolation.
-- This migration changes authority metadata only. It does not update business rows.

-- Focused authority helpers -------------------------------------------------

create or replace function public.current_user_has_club_wide_authority(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_has_active_authority()
    and public.current_user_role() = 'admin'
    and public.current_user_club_id() = target_club_id;
$$;

create or replace function public.current_user_has_active_team_assignment(
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_has_active_authority()
    and public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
    and public.current_user_role_rank() >= 20
    and public.current_user_club_id() = target_club_id
    and target_team_id is not null
    and exists (
      select 1
      from public.teams team
      join public.team_staff assignment
        on assignment.team_id = team.id
       and assignment.user_id = (select auth.uid())
      where team.id = target_team_id
        and team.club_id = target_club_id
        and coalesce(team.status, 'active') = 'active'
    );
$$;

create or replace function public.current_user_can_access_team(
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_role() = 'super_admin'
    or public.current_user_has_club_wide_authority(target_club_id)
    or public.current_user_has_active_team_assignment(target_club_id, target_team_id);
$$;

create or replace function public.current_user_can_access_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.teams team
    where team.id = target_team_id
      and public.current_user_can_access_team(team.club_id, team.id)
  );
$$;

create or replace function public.current_user_can_access_staff_player(
  target_player_id uuid,
  target_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.players player
    where player.id = target_player_id
      and player.club_id = target_club_id
      and public.current_user_can_access_team(player.club_id, player.team_id)
  );
$$;

create or replace function public.current_user_can_access_parent_player(target_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_has_active_authority()
    and public.current_user_role() = 'parent_portal'
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
  select public.current_user_has_active_authority()
    and public.current_user_role() = 'parent_portal'
    and target_team_id is not null
    and exists (
      select 1
      from public.parent_player_links link
      join public.players player
        on player.id = link.player_id
       and player.club_id = link.club_id
      where link.auth_user_id = (select auth.uid())
        and link.status = 'active'
        and coalesce(player.status, 'active') <> 'archived'
        and coalesce(link.team_id, player.team_id) = target_team_id
        and player.team_id = target_team_id
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
  select public.current_user_has_active_authority()
    and public.current_user_role() = 'parent_portal'
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

create or replace function public.can_manage_parent_link(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_can_access_team(team.club_id, team.id)
    and public.current_user_role() <> 'parent_portal'
  from public.teams team
  where team.id = target_team_id;
$$;

create or replace function public.can_read_match_day(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_can_access_team(team.club_id, team.id)
  from public.teams team
  where team.id = target_team_id;
$$;

create or replace function public.can_manage_match_day(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_can_access_team(team.club_id, team.id)
    and public.current_user_role() <> 'parent_portal'
    and (
      public.current_user_role() in ('admin', 'super_admin')
      or public.current_user_role_rank() >= 20
    )
  from public.teams team
  where team.id = target_team_id;
$$;

create or replace function public.current_user_is_match_day_scorer(target_match_day_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_has_active_authority()
    and public.current_user_role() = 'parent_portal'
    and exists (
      select 1
      from public.match_day_scorer_assignments assignment
      join public.parent_player_links link
        on link.id = assignment.parent_link_id
       and link.auth_user_id = assignment.auth_user_id
       and link.status = 'active'
      where assignment.match_day_id = target_match_day_id
        and assignment.auth_user_id = (select auth.uid())
    );
$$;

create or replace function public.training_availability_user_can_view(
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_can_access_team(target_club_id, target_team_id);
$$;

create or replace function public.training_availability_user_can_manage(
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_can_access_team(target_club_id, target_team_id)
    and public.current_user_role() <> 'parent_portal'
    and (
      public.current_user_role() in ('admin', 'super_admin')
      or public.current_user_role_rank() >= 20
    );
$$;

revoke all on function public.current_user_has_club_wide_authority(uuid) from public, anon;
revoke all on function public.current_user_has_active_team_assignment(uuid, uuid) from public, anon;
revoke all on function public.current_user_can_access_team(uuid, uuid) from public, anon;
revoke all on function public.current_user_can_access_team(uuid) from public, anon;
revoke all on function public.current_user_can_access_staff_player(uuid, uuid) from public, anon;
revoke all on function public.current_user_can_access_parent_player(uuid) from public, anon;
revoke all on function public.current_user_can_access_parent_team(uuid) from public, anon;
revoke all on function public.current_user_can_access_parent_link(uuid, uuid) from public, anon;
revoke all on function public.can_manage_parent_link(uuid) from public, anon;
revoke all on function public.can_read_match_day(uuid) from public, anon;
revoke all on function public.can_manage_match_day(uuid) from public, anon;
revoke all on function public.current_user_is_match_day_scorer(uuid) from public, anon;
revoke all on function public.training_availability_user_can_view(uuid, uuid) from public, anon;
revoke all on function public.training_availability_user_can_manage(uuid, uuid) from public, anon;

grant execute on function public.current_user_has_club_wide_authority(uuid) to authenticated, service_role;
grant execute on function public.current_user_has_active_team_assignment(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_team(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_team(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_staff_player(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_parent_player(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_parent_team(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_access_parent_link(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_manage_parent_link(uuid) to authenticated, service_role;
grant execute on function public.can_read_match_day(uuid) to authenticated, service_role;
grant execute on function public.can_manage_match_day(uuid) to authenticated, service_role;
grant execute on function public.current_user_is_match_day_scorer(uuid) to authenticated, service_role;
grant execute on function public.training_availability_user_can_view(uuid, uuid) to authenticated, service_role;
grant execute on function public.training_availability_user_can_manage(uuid, uuid) to authenticated, service_role;

-- Club base records and a deliberate minimal directory ----------------------

revoke all on table public.clubs from anon;

drop policy if exists clubs_select_authenticated on public.clubs;
create policy clubs_select_exact_authority
on public.clubs
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or id = public.current_user_club_id()
);

create or replace function public.list_club_directory()
returns table (
  club_name text,
  logo_url text,
  website text,
  town_city text,
  country text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    club.name as club_name,
    club.logo_url,
    club.website,
    club.town_city,
    club.country
  from public.clubs club
  where public.current_user_has_active_authority()
    and coalesce(club.status, 'active') = 'active'
  order by club.name;
$$;

revoke all on function public.list_club_directory() from public, anon;
grant execute on function public.list_club_directory() to authenticated, service_role;

-- Team, player and parent relationship policies ----------------------------

drop policy if exists teams_select_scoped on public.teams;
drop policy if exists teams_select_parent_portal_linked on public.teams;
create policy teams_select_exact_authority
on public.teams
for select
to authenticated
using (
  public.current_user_can_access_team(club_id, id)
  or public.current_user_can_access_parent_team(id)
);

drop policy if exists teams_insert_scoped on public.teams;
create policy teams_insert_exact_authority
on public.teams
for insert
to authenticated
with check (
  (
    public.current_user_role() = 'super_admin'
    or public.current_user_has_club_wide_authority(club_id)
  )
  and public.can_insert_team_for_plan(club_id)
);

drop policy if exists teams_update_scoped on public.teams;
create policy teams_update_exact_authority
on public.teams
for update
to authenticated
using (
  public.current_user_can_access_team(club_id, id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_role_rank() >= 50
  )
)
with check (
  public.current_user_can_access_team(club_id, id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_role_rank() >= 50
  )
);

drop policy if exists teams_delete_scoped on public.teams;
create policy teams_delete_exact_authority
on public.teams
for delete
to authenticated
using (
  public.current_user_can_access_team(club_id, id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_role_rank() >= 50
  )
);

drop policy if exists team_staff_select_scoped on public.team_staff;
create policy team_staff_select_exact_authority
on public.team_staff
for select
to authenticated
using (public.current_user_can_access_team(team_id));

drop policy if exists team_staff_insert_scoped on public.team_staff;
create policy team_staff_insert_exact_authority
on public.team_staff
for insert
to authenticated
with check (
  public.current_user_can_access_team(team_id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_role_rank() >= 50
  )
  and public.user_belongs_to_current_club(user_id)
);

drop policy if exists team_staff_delete_scoped on public.team_staff;
create policy team_staff_delete_exact_authority
on public.team_staff
for delete
to authenticated
using (
  public.current_user_can_access_team(team_id)
  and (
    public.current_user_role() in ('admin', 'super_admin')
    or public.current_user_role_rank() >= 50
  )
);

drop policy if exists players_select_scoped on public.players;
drop policy if exists players_select_parent_portal_linked on public.players;
create policy players_select_exact_authority
on public.players
for select
to authenticated
using (
  public.current_user_can_access_team(club_id, team_id)
  or public.current_user_can_access_parent_player(id)
);

drop policy if exists players_insert_scoped on public.players;
create policy players_insert_exact_authority
on public.players
for insert
to authenticated
with check (
  public.current_user_role() <> 'super_admin'
  and public.current_user_can_access_team(club_id, team_id)
  and public.can_insert_player_for_plan(club_id, section, player_name)
);

drop policy if exists players_update_scoped on public.players;
create policy players_update_exact_authority
on public.players
for update
to authenticated
using (
  public.current_user_role() <> 'super_admin'
  and public.current_user_can_access_team(club_id, team_id)
)
with check (
  public.current_user_role() <> 'super_admin'
  and public.current_user_can_access_team(club_id, team_id)
);

drop policy if exists players_delete_scoped on public.players;
create policy players_delete_exact_authority
on public.players
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'parent_portal'
    and public.current_user_can_access_team(club_id, team_id)
  )
);

drop policy if exists parent_player_links_select_scoped on public.parent_player_links;
create policy parent_player_links_select_exact_authority
on public.parent_player_links
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or public.current_user_can_access_parent_link(id, player_id)
  or public.current_user_can_access_staff_player(player_id, club_id)
);

drop policy if exists parent_player_links_insert_scoped on public.parent_player_links;
create policy parent_player_links_insert_exact_authority
on public.parent_player_links
for insert
to authenticated
with check (
  public.current_user_role() <> 'parent_portal'
  and public.can_manage_parent_link(team_id)
  and public.can_use_plan_feature(club_id, 'parentInvitations')
  and exists (
    select 1
    from public.players player
    where player.id = parent_player_links.player_id
      and player.club_id = parent_player_links.club_id
      and player.team_id = parent_player_links.team_id
  )
);

drop policy if exists parent_player_links_update_scoped on public.parent_player_links;
create policy parent_player_links_update_exact_authority
on public.parent_player_links
for update
to authenticated
using (
  public.current_user_role() <> 'parent_portal'
  and public.can_manage_parent_link(team_id)
)
with check (
  public.current_user_role() <> 'parent_portal'
  and public.can_manage_parent_link(team_id)
);

drop policy if exists parent_player_links_delete_scoped on public.parent_player_links;
create policy parent_player_links_delete_exact_authority
on public.parent_player_links
for delete
to authenticated
using (
  public.current_user_role() <> 'parent_portal'
  and public.can_manage_parent_link(team_id)
);

-- Parent self-service actions use narrow RPCs instead of broad row updates.

create or replace function public.update_own_parent_link_email(new_email text)
returns setof public.parent_player_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_email text := lower(btrim(coalesce(new_email, '')));
begin
  if not public.current_user_has_active_authority()
    or public.current_user_role() <> 'parent_portal'
    or normalized_email = ''
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception using errcode = '42501', message = 'parent_link_email_update_not_permitted';
  end if;

  return query
  update public.parent_player_links link
  set email = normalized_email,
      updated_at = timezone('utc', now())
  where link.auth_user_id = (select auth.uid())
    and link.status = 'active'
  returning link.*;
end;
$$;

create or replace function public.create_own_family_share_link(target_parent_link_id uuid)
returns public.parent_player_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  parent_link public.parent_player_links%rowtype;
  created_link public.parent_player_links%rowtype;
begin
  if not public.current_user_has_active_authority()
    or public.current_user_role() <> 'parent_portal' then
    raise exception using errcode = '42501', message = 'family_link_create_not_permitted';
  end if;

  select link.*
  into parent_link
  from public.parent_player_links link
  where link.id = target_parent_link_id
    and link.auth_user_id = (select auth.uid())
    and link.status = 'active'
  for update;

  if parent_link.id is null then
    raise exception using errcode = '42501', message = 'family_link_create_not_permitted';
  end if;

  update public.parent_player_links link
  set status = 'revoked',
      updated_at = timezone('utc', now())
  where link.parent_link_id = parent_link.id
    and link.link_type = 'family'
    and link.status = 'pending';

  insert into public.parent_player_links (
    club_id,
    team_id,
    player_id,
    parent_link_id,
    link_type,
    status,
    expires_at
  )
  values (
    parent_link.club_id,
    parent_link.team_id,
    parent_link.player_id,
    parent_link.id,
    'family',
    'pending',
    timezone('utc', now()) + interval '1 day'
  )
  returning * into created_link;

  return created_link;
end;
$$;

revoke all on function public.update_own_parent_link_email(text) from public, anon;
revoke all on function public.create_own_family_share_link(uuid) from public, anon;
grant execute on function public.update_own_parent_link_email(text) to authenticated, service_role;
grant execute on function public.create_own_family_share_link(uuid) to authenticated, service_role;

-- Staff notes, availability and scorer records -----------------------------

drop policy if exists player_staff_notes_select_scoped on public.player_staff_notes;
create policy player_staff_notes_select_exact_team
on public.player_staff_notes
for select
to authenticated
using (public.current_user_can_access_staff_player(player_id, club_id));

drop policy if exists player_staff_notes_insert_scoped on public.player_staff_notes;
create policy player_staff_notes_insert_exact_team
on public.player_staff_notes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and public.current_user_role_rank() >= 20
  and public.current_user_can_access_staff_player(player_id, club_id)
);

drop policy if exists player_staff_notes_update_assignment_scoped on public.player_staff_notes;
create policy player_staff_notes_update_exact_team
on public.player_staff_notes
for update
to authenticated
using (
  public.current_user_can_access_staff_player(player_id, club_id)
  and (
    user_id = (select auth.uid())
    or public.current_user_role() = 'admin'
    or public.current_user_role_rank() >= 50
  )
)
with check (
  public.current_user_can_access_staff_player(player_id, club_id)
  and (
    user_id = (select auth.uid())
    or public.current_user_role() = 'admin'
    or public.current_user_role_rank() >= 50
  )
);

drop policy if exists match_day_availability_staff_select_scoped on public.match_day_availability_requests;
create policy match_day_availability_staff_select_exact_team
on public.match_day_availability_requests
for select
to authenticated
using (public.current_user_can_access_team(club_id, team_id));

drop policy if exists match_day_player_availability_staff_select_scoped on public.match_day_player_availability;
create policy match_day_player_availability_staff_select_exact_team
on public.match_day_player_availability
for select
to authenticated
using (public.current_user_can_access_team(club_id, team_id));

drop policy if exists match_day_player_availability_history_staff_select_scoped on public.match_day_player_availability_history;
create policy match_day_player_availability_history_staff_select_exact_team
on public.match_day_player_availability_history
for select
to authenticated
using (public.current_user_can_access_team(club_id, team_id));

drop policy if exists match_day_interest_staff_select_scoped on public.match_day_scorer_interest;
create policy match_day_interest_staff_select_exact_team
on public.match_day_scorer_interest
for select
to authenticated
using (public.current_user_can_access_team(club_id, team_id));

drop policy if exists match_day_assignments_staff_scoped on public.match_day_scorer_assignments;
create policy match_day_assignments_staff_exact_team
on public.match_day_scorer_assignments
for all
to authenticated
using (public.current_user_can_access_team(club_id, team_id))
with check (
  public.current_user_can_access_team(club_id, team_id)
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_day_role_assignments_staff_scoped on public.match_day_role_assignments;
create policy match_day_role_assignments_staff_exact_team
on public.match_day_role_assignments
for all
to authenticated
using (public.current_user_can_access_team(club_id, team_id))
with check (
  public.current_user_can_access_team(club_id, team_id)
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_day_events_staff_select_scoped on public.match_day_events;
create policy match_day_events_staff_select_exact_team
on public.match_day_events
for select
to authenticated
using (public.current_user_can_access_team(club_id, team_id));

-- Feedback ownership, board access and child-record inheritance ------------

create or replace function public.current_user_can_read_feedback(target_feedback_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_role() = 'super_admin'
    or (
      public.current_user_has_active_authority()
      and exists (
        select 1
        from public.platform_feedback feedback
        where feedback.id = target_feedback_id
          and feedback.created_by = (select auth.uid())
          and feedback.club_id = public.current_user_club_id()
          and feedback.status not in ('hidden', 'deleted', 'withdrawn')
      )
    );
$$;

create or replace function public.current_user_can_view_feedback_board_item(target_feedback_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_user_role() = 'super_admin'
    or (
      public.current_user_has_active_authority()
      and exists (
        select 1
        from public.platform_feedback feedback
        where feedback.id = target_feedback_id
          and feedback.club_id = public.current_user_club_id()
          and feedback.status not in ('hidden', 'deleted', 'withdrawn')
      )
    );
$$;

drop policy if exists platform_feedback_select_authenticated on public.platform_feedback;
create policy platform_feedback_select_owner_or_platform
on public.platform_feedback
for select
to authenticated
using (public.current_user_can_read_feedback(id));

drop policy if exists platform_feedback_insert_authenticated on public.platform_feedback;
create policy platform_feedback_insert_active_author
on public.platform_feedback
for insert
to authenticated
with check (
  public.current_user_has_active_authority()
  and public.current_user_role() <> 'super_admin'
  and created_by = (select auth.uid())
  and club_id = public.current_user_club_id()
  and status = 'open'
);

drop policy if exists platform_feedback_update_admin on public.platform_feedback;
create policy platform_feedback_update_platform_admin
on public.platform_feedback
for update
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists platform_feedback_delete_admin on public.platform_feedback;
create policy platform_feedback_delete_platform_admin
on public.platform_feedback
for delete
to authenticated
using (public.current_user_role() = 'super_admin');

drop policy if exists platform_feedback_comments_select_authenticated on public.platform_feedback_comments;
create policy platform_feedback_comments_select_inherited
on public.platform_feedback_comments
for select
to authenticated
using (public.current_user_can_read_feedback(feedback_id));

drop policy if exists platform_feedback_comments_insert_admin on public.platform_feedback_comments;
create policy platform_feedback_comments_insert_platform_admin
on public.platform_feedback_comments
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  and created_by = (select auth.uid())
  and public.current_user_can_read_feedback(feedback_id)
);

drop policy if exists platform_feedback_comments_update_admin on public.platform_feedback_comments;
create policy platform_feedback_comments_update_platform_admin
on public.platform_feedback_comments
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.current_user_can_read_feedback(feedback_id)
)
with check (
  public.current_user_role() = 'super_admin'
  and public.current_user_can_read_feedback(feedback_id)
);

drop policy if exists platform_feedback_comments_delete_admin on public.platform_feedback_comments;
create policy platform_feedback_comments_delete_platform_admin
on public.platform_feedback_comments
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  and public.current_user_can_read_feedback(feedback_id)
);

drop policy if exists platform_feedback_votes_select_authenticated on public.platform_feedback_votes;
create policy platform_feedback_votes_select_owner_or_platform
on public.platform_feedback_votes
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    user_id = (select auth.uid())
    and public.current_user_can_view_feedback_board_item(feedback_id)
  )
);

drop policy if exists platform_feedback_votes_insert_authenticated on public.platform_feedback_votes;
create policy platform_feedback_votes_insert_inherited
on public.platform_feedback_votes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and public.current_user_can_view_feedback_board_item(feedback_id)
);

drop policy if exists platform_feedback_votes_delete_owner_or_admin on public.platform_feedback_votes;
create policy platform_feedback_votes_delete_owner_or_platform
on public.platform_feedback_votes
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    user_id = (select auth.uid())
    and public.current_user_can_view_feedback_board_item(feedback_id)
  )
);

create or replace function public.list_platform_feedback()
returns table (
  id uuid,
  club_id uuid,
  club_name text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  message text,
  status text,
  admin_note text,
  created_at timestamptz,
  updated_at timestamptz,
  vote_count bigint,
  has_voted boolean,
  comments jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    feedback.id,
    feedback.club_id,
    club.name as club_name,
    case when public.current_user_role() = 'super_admin' then feedback.created_by else null end,
    case when public.current_user_role() = 'super_admin' then feedback.created_by_name else '' end,
    case when public.current_user_role() = 'super_admin' then feedback.created_by_email else '' end,
    case when public.current_user_role() = 'super_admin' then feedback.updated_by else null end,
    case when public.current_user_role() = 'super_admin' then feedback.updated_by_name else '' end,
    case when public.current_user_role() = 'super_admin' then feedback.updated_by_email else '' end,
    feedback.message,
    feedback.status,
    case when public.current_user_role() = 'super_admin' then feedback.admin_note else '' end,
    feedback.created_at,
    feedback.updated_at,
    (
      select count(*)
      from public.platform_feedback_votes vote
      where vote.feedback_id = feedback.id
    ) as vote_count,
    exists (
      select 1
      from public.platform_feedback_votes own_vote
      where own_vote.feedback_id = feedback.id
        and own_vote.user_id = (select auth.uid())
    ) as has_voted,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', comment.id,
          'feedback_id', comment.feedback_id,
          'created_by', case when public.current_user_role() = 'super_admin' then comment.created_by else null end,
          'created_by_name', case when public.current_user_role() = 'super_admin' then comment.created_by_name else '' end,
          'created_by_email', case when public.current_user_role() = 'super_admin' then comment.created_by_email else '' end,
          'message', comment.message,
          'created_at', comment.created_at
        )
        order by comment.created_at
      )
      from public.platform_feedback_comments comment
      where comment.feedback_id = feedback.id
    ), '[]'::jsonb) as comments
  from public.platform_feedback feedback
  left join public.clubs club on club.id = feedback.club_id
  where public.current_user_has_active_authority()
    and (
      public.current_user_role() = 'super_admin'
      or (
        feedback.club_id = public.current_user_club_id()
        and feedback.status not in ('hidden', 'deleted', 'withdrawn')
      )
    )
  order by feedback.created_at desc;
$$;

revoke all on function public.current_user_can_read_feedback(uuid) from public, anon;
revoke all on function public.current_user_can_view_feedback_board_item(uuid) from public, anon;
revoke all on function public.list_platform_feedback() from public, anon;
grant execute on function public.current_user_can_read_feedback(uuid) to authenticated, service_role;
grant execute on function public.current_user_can_view_feedback_board_item(uuid) to authenticated, service_role;
grant execute on function public.list_platform_feedback() to authenticated, service_role;

comment on function public.current_user_has_active_team_assignment(uuid, uuid) is
  'Requires current active database authority and an exact team_staff assignment for team-scoped roles.';
comment on function public.list_club_directory() is
  'Minimal authenticated directory. Excludes identifiers, contacts, billing, ownership, subscription and internal configuration.';
comment on function public.list_platform_feedback() is
  'Lists same-club visible feedback with aggregated votes and minimised creator metadata, or the global moderation view for an active Platform Admin.';
