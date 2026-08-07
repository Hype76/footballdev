-- Platform Admin archive-first lifecycle for Club workspaces and Teams.

alter table public.clubs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id) on delete set null,
  add column if not exists archived_previous_status text;

alter table public.teams
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id) on delete set null,
  add column if not exists archived_previous_status text;

create index if not exists clubs_archived_at_idx
  on public.clubs (archived_at desc)
  where archived_at is not null;

create index if not exists teams_club_archived_at_idx
  on public.teams (club_id, archived_at desc)
  where archived_at is not null;

create or replace function public.set_platform_club_archive_state(
  p_club_id uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_club public.clubs%rowtype;
  restored_status text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'platform_admin_login_required';
  end if;

  if public.current_user_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  if p_club_id is null then
    raise exception using errcode = '22023', message = 'club_id_required';
  end if;

  select club.*
  into target_club
  from public.clubs club
  where club.id = p_club_id
  for update;

  if target_club.id is null then
    raise exception using errcode = 'P0001', message = 'club_not_found';
  end if;

  if coalesce(p_archived, false) then
    if target_club.archived_at is null then
      update public.clubs club
      set archived_previous_status = case
            when target_club.status in ('active', 'suspended') then target_club.status
            else 'active'
          end,
          archived_at = timezone('utc', now()),
          archived_by = (select auth.uid()),
          status = 'suspended',
          suspended_at = coalesce(target_club.suspended_at, timezone('utc', now()))
      where club.id = target_club.id
      returning club.* into target_club;

      perform public.record_security_audit_event(
        'club_archived',
        'club',
        target_club.id,
        jsonb_build_object(
          'clubName', target_club.name,
          'previousStatus', target_club.archived_previous_status
        ),
        null,
        'warning',
        'success',
        'data_change',
        'application'
      );
    end if;
  else
    if target_club.archived_at is null then
      raise exception using errcode = '55000', message = 'club_not_archived';
    end if;

    restored_status := case
      when target_club.archived_previous_status in ('active', 'suspended')
        then target_club.archived_previous_status
      else 'active'
    end;

    update public.clubs club
    set status = restored_status,
        suspended_at = case
          when restored_status = 'suspended' then coalesce(target_club.suspended_at, timezone('utc', now()))
          else null
        end,
        archived_at = null,
        archived_by = null,
        archived_previous_status = null
    where club.id = target_club.id
    returning club.* into target_club;

    perform public.record_security_audit_event(
      'club_restored',
      'club',
      target_club.id,
      jsonb_build_object(
        'clubName', target_club.name,
        'restoredStatus', restored_status
      ),
      null,
      'info',
      'success',
      'data_change',
      'application'
    );
  end if;

  return jsonb_build_object(
    'id', target_club.id,
    'name', target_club.name,
    'status', target_club.status,
    'archivedAt', target_club.archived_at,
    'archivedBy', target_club.archived_by,
    'archivedPreviousStatus', target_club.archived_previous_status
  );
end;
$$;

revoke all on function public.set_platform_club_archive_state(uuid, boolean) from public, anon;
grant execute on function public.set_platform_club_archive_state(uuid, boolean) to authenticated, service_role;

create or replace function public.set_platform_team_archive_state(
  p_team_id uuid,
  p_club_id uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_team public.teams%rowtype;
  restored_status text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'platform_admin_login_required';
  end if;

  if public.current_user_role() <> 'super_admin' then
    raise exception using errcode = '42501', message = 'platform_admin_required';
  end if;

  if p_team_id is null then
    raise exception using errcode = '22023', message = 'team_id_required';
  end if;

  if p_club_id is null then
    raise exception using errcode = '22023', message = 'club_id_required';
  end if;

  select team.*
  into target_team
  from public.teams team
  where team.id = p_team_id
  for update;

  if target_team.id is null then
    raise exception using errcode = 'P0001', message = 'team_not_found';
  end if;

  if target_team.club_id <> p_club_id then
    raise exception using errcode = 'P0001', message = 'team_club_mismatch';
  end if;

  if coalesce(p_archived, false) then
    if target_team.archived_at is null then
      update public.teams team
      set archived_previous_status = case
            when coalesce(nullif(target_team.status, ''), 'active') <> 'archived'
              then coalesce(nullif(target_team.status, ''), 'active')
            else 'active'
          end,
          archived_at = timezone('utc', now()),
          archived_by = (select auth.uid()),
          status = 'inactive',
          updated_at = timezone('utc', now())
      where team.id = target_team.id
      returning team.* into target_team;

      perform public.record_security_audit_event(
        'platform_team_archived',
        'team',
        target_team.id,
        jsonb_build_object(
          'teamName', target_team.name,
          'clubId', target_team.club_id,
          'previousStatus', target_team.archived_previous_status
        ),
        null,
        'warning',
        'success',
        'data_change',
        'application'
      );
    end if;
  else
    if target_team.archived_at is null then
      raise exception using errcode = '55000', message = 'team_not_archived';
    end if;

    restored_status := case
      when coalesce(nullif(target_team.archived_previous_status, ''), 'active') <> 'archived'
        then coalesce(nullif(target_team.archived_previous_status, ''), 'active')
      else 'active'
    end;

    update public.teams team
    set status = restored_status,
        archived_at = null,
        archived_by = null,
        archived_previous_status = null,
        updated_at = timezone('utc', now())
    where team.id = target_team.id
    returning team.* into target_team;

    perform public.record_security_audit_event(
      'platform_team_restored',
      'team',
      target_team.id,
      jsonb_build_object(
        'teamName', target_team.name,
        'clubId', target_team.club_id,
        'restoredStatus', restored_status
      ),
      null,
      'info',
      'success',
      'data_change',
      'application'
    );
  end if;

  return jsonb_build_object(
    'id', target_team.id,
    'name', target_team.name,
    'clubId', target_team.club_id,
    'status', target_team.status,
    'archivedAt', target_team.archived_at,
    'archivedBy', target_team.archived_by,
    'archivedPreviousStatus', target_team.archived_previous_status
  );
end;
$$;

revoke all on function public.set_platform_team_archive_state(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_platform_team_archive_state(uuid, uuid, boolean) to authenticated, service_role;

create or replace function app_private.require_archived_club_before_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.archived_at is null then
    raise exception using errcode = '55000', message = 'club_must_be_archived_before_delete';
  end if;

  return old;
end;
$$;

drop trigger if exists clubs_require_archive_before_delete on public.clubs;
create trigger clubs_require_archive_before_delete
before delete on public.clubs
for each row
execute function app_private.require_archived_club_before_delete();

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
    or (
      exists (
        select 1
        from public.teams team
        join public.clubs club on club.id = team.club_id
        where team.id = target_team_id
          and team.club_id = target_club_id
          and team.archived_at is null
          and coalesce(team.status, 'active') = 'active'
          and club.archived_at is null
          and coalesce(club.status, 'active') = 'active'
      )
      and (
        public.current_user_has_club_wide_authority(target_club_id)
        or public.current_user_has_active_team_assignment(target_club_id, target_team_id)
      )
    );
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

create or replace function public.current_user_can_access_parent_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null
    and target_team_id is not null
    and not exists (
      select 1
      from public.users actor
      where actor.id = (select auth.uid())
        and actor.status = 'suspended'
    )
    and exists (
      select 1
      from public.parent_player_links link
      join public.players player
        on player.id = link.player_id
       and player.club_id = link.club_id
      join public.teams team
        on team.id = target_team_id
       and team.club_id = link.club_id
      join public.clubs club
        on club.id = team.club_id
      where link.auth_user_id = (select auth.uid())
        and link.status = 'active'
        and coalesce(player.status, 'active') <> 'archived'
        and player.team_id = target_team_id
        and coalesce(link.team_id, player.team_id) = target_team_id
        and team.archived_at is null
        and coalesce(team.status, 'active') = 'active'
        and club.archived_at is null
        and coalesce(club.status, 'active') = 'active'
    );
$$;

create or replace function public.delete_platform_team_transaction(
  p_team_id uuid,
  p_club_id uuid,
  p_actor_id uuid,
  p_actor_email text default '',
  p_actor_name text default '',
  p_actor_role text default '',
  p_actor_role_label text default '',
  p_actor_role_rank integer default 0
)
returns table (
  deleted boolean,
  team_id uuid,
  club_id uuid,
  team_name text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_team record;
  deleted_count integer := 0;
  failure_sqlstate text;
  failure_message text;
  failure_constraint text;
begin
  if p_team_id is null then
    raise exception 'invalid_team_id' using errcode = '22023';
  end if;

  if p_club_id is null then
    raise exception 'invalid_club_id' using errcode = '22023';
  end if;

  select team.id, team.name, team.club_id, team.archived_at
  into target_team
  from public.teams team
  where team.id = p_team_id
  for update;

  if target_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0001';
  end if;

  if target_team.club_id <> p_club_id then
    raise exception 'team_club_mismatch' using errcode = 'P0001';
  end if;

  if target_team.archived_at is null then
    raise exception 'team_must_be_archived_before_delete' using errcode = '55000';
  end if;

  begin
    delete from public.teams team
    where team.id = target_team.id
      and team.club_id = p_club_id;

    get diagnostics deleted_count = row_count;
  exception
    when foreign_key_violation then
      get stacked diagnostics
        failure_message = message_text,
        failure_constraint = constraint_name;

      raise exception 'deletion_conflict'
        using errcode = '23503',
          detail = failure_message,
          hint = failure_constraint;
  end;

  if deleted_count <> 1 then
    raise exception 'team_not_deleted' using errcode = 'P0001';
  end if;

  begin
    insert into public.audit_logs (
      club_id,
      actor_id,
      actor_email,
      actor_name,
      actor_role_label,
      actor_role_rank,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      target_team.club_id,
      p_actor_id,
      nullif(p_actor_email, ''),
      nullif(p_actor_name, ''),
      nullif(p_actor_role_label, ''),
      coalesce(p_actor_role_rank, 0),
      'platform_team_deleted',
      'team',
      target_team.id,
      jsonb_build_object(
        'teamName', target_team.name,
        'clubId', target_team.club_id,
        'actorRole', nullif(p_actor_role, '')
      )
    );
  exception
    when others then
      get stacked diagnostics
        failure_sqlstate = returned_sqlstate,
        failure_message = message_text,
        failure_constraint = constraint_name;

      raise exception 'audit_failed'
        using errcode = 'P0001',
          detail = failure_sqlstate || ': ' || failure_message,
          hint = failure_constraint;
  end;

  return query select true, target_team.id, target_team.club_id, target_team.name;
end;
$$;

revoke all on function public.delete_platform_team_transaction(uuid, uuid, uuid, text, text, text, text, integer)
from public, anon, authenticated;

grant execute on function public.delete_platform_team_transaction(uuid, uuid, uuid, text, text, text, text, integer)
to service_role;
