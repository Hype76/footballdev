begin;

create schema if not exists app_private;

create table if not exists public.parent_mobile_app_installations (
  installation_id uuid not null,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  app_version text not null default '',
  build_number text not null default '',
  first_seen_at timestamptz not null default pg_catalog.now(),
  last_seen_at timestamptz not null default pg_catalog.now(),
  primary key (installation_id, auth_user_id),
  constraint parent_mobile_app_installations_platform_check
    check (platform in ('android', 'ios')),
  constraint parent_mobile_app_installations_app_version_check
    check (pg_catalog.length(app_version) <= 40),
  constraint parent_mobile_app_installations_build_number_check
    check (pg_catalog.length(build_number) <= 40)
);

create index if not exists parent_mobile_app_installations_auth_user_id_idx
  on public.parent_mobile_app_installations (auth_user_id, last_seen_at desc);

alter table public.parent_mobile_app_installations enable row level security;
alter table public.parent_mobile_app_installations force row level security;

revoke all on table public.parent_mobile_app_installations
from public, anon, authenticated;
grant select, insert, update, delete on table public.parent_mobile_app_installations
to service_role;

insert into public.parent_mobile_app_installations (
  installation_id,
  auth_user_id,
  platform,
  app_version,
  build_number,
  first_seen_at,
  last_seen_at
)
select
  installation.installation_id,
  installation.auth_user_id,
  installation.platform,
  installation.app_version,
  installation.build_number,
  installation.created_at,
  installation.last_seen_at
from public.parent_mobile_push_installations installation
where installation.auth_user_id is not null
on conflict (installation_id, auth_user_id)
do update set
  platform = excluded.platform,
  app_version = excluded.app_version,
  build_number = excluded.build_number,
  first_seen_at = case
    when public.parent_mobile_app_installations.first_seen_at <= excluded.first_seen_at
      then public.parent_mobile_app_installations.first_seen_at
    else excluded.first_seen_at
  end,
  last_seen_at = case
    when public.parent_mobile_app_installations.last_seen_at >= excluded.last_seen_at
      then public.parent_mobile_app_installations.last_seen_at
    else excluded.last_seen_at
  end;

create or replace function public.register_parent_mobile_app_installation(
  p_installation_id uuid,
  p_platform text,
  p_app_version text default '',
  p_build_number text default ''
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_platform text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_platform, '')));
  normalized_app_version text := pg_catalog.left(pg_catalog.btrim(coalesce(p_app_version, '')), 40);
  normalized_build_number text := pg_catalog.left(pg_catalog.btrim(coalesce(p_build_number, '')), 40);
begin
  if actor_id is null then
    raise exception 'Sign in to register this Parent app installation.' using errcode = '42501';
  end if;

  if p_installation_id is null or normalized_platform not in ('android', 'ios') then
    raise exception 'The Parent app installation is not valid.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.parent_player_links link
    where link.auth_user_id = actor_id
      and link.link_type = 'parent'
      and link.status = 'active'
  ) then
    raise exception 'An active Parent link is required.' using errcode = '42501';
  end if;

  insert into public.parent_mobile_app_installations (
    installation_id,
    auth_user_id,
    platform,
    app_version,
    build_number,
    first_seen_at,
    last_seen_at
  )
  values (
    p_installation_id,
    actor_id,
    normalized_platform,
    normalized_app_version,
    normalized_build_number,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (installation_id, auth_user_id)
  do update set
    platform = excluded.platform,
    app_version = excluded.app_version,
    build_number = excluded.build_number,
    last_seen_at = excluded.last_seen_at;

  return true;
end;
$$;

revoke all on function public.register_parent_mobile_app_installation(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.register_parent_mobile_app_installation(uuid, text, text, text)
to authenticated, service_role;

create or replace function app_private.get_team_parent_app_installation_status_internal(team_id_value uuid)
returns table (
  player_id uuid,
  parent_contact_count integer,
  installed_contact_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select
      auth.uid() as user_id,
      public.current_user_club_id() as club_id,
      public.current_user_role() as role,
      public.current_user_role_rank() as role_rank
  ),
  authorized_players as (
    select
      player.id,
      player.club_id,
      player.parent_contacts,
      player.parent_email,
      player.contact_type
    from actor
    join public.teams team
      on team.id = team_id_value
     and team.club_id = actor.club_id
    join public.player_team_memberships membership
      on membership.team_id = team.id
     and membership.club_id = team.club_id
     and membership.status = 'active'
    join public.players player
      on player.id = membership.player_id
     and player.club_id = membership.club_id
     and coalesce(player.status, 'active') <> 'archived'
     and player.archived_at is null
    where actor.user_id is not null
      and actor.role <> 'super_admin'
      and actor.role_rank >= 20
      and (
        actor.role = 'admin'
        or exists (
          select 1
          from public.team_staff assignment
          where assignment.team_id = team.id
            and assignment.user_id = actor.user_id
        )
      )
  ),
  configured_contacts as (
    select
      player.id as player_id,
      player.club_id,
      pg_catalog.lower(pg_catalog.btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as email
    from authorized_players player
    cross join lateral pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(coalesce(player.parent_contacts, '[]'::jsonb)) = 'array'
          then coalesce(player.parent_contacts, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) contact(value)
    where pg_catalog.lower(pg_catalog.btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
      and pg_catalog.btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  fallback_contacts as (
    select
      player.id as player_id,
      player.club_id,
      pg_catalog.lower(pg_catalog.btrim(coalesce(player.parent_email, ''))) as email
    from authorized_players player
    where pg_catalog.lower(pg_catalog.btrim(coalesce(player.contact_type, 'parent'))) <> 'self'
      and pg_catalog.btrim(coalesce(player.parent_email, ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  contacts as (
    select distinct contact.player_id, contact.club_id, contact.email
    from (
      select * from configured_contacts
      union all
      select * from fallback_contacts
    ) contact
    where contact.email <> ''
  ),
  contact_installation as (
    select
      contact.player_id,
      contact.email,
      exists (
        select 1
        from public.parent_player_links link
        join public.parent_mobile_app_installations installation
          on installation.auth_user_id = link.auth_user_id
        where link.club_id = contact.club_id
          and link.team_id = team_id_value
          and link.player_id = contact.player_id
          and link.link_type = 'parent'
          and link.status = 'active'
          and link.auth_user_id is not null
          and pg_catalog.lower(pg_catalog.btrim(coalesce(link.email, ''))) = contact.email
      ) as installed
    from contacts contact
  )
  select
    player.id as player_id,
    pg_catalog.count(installation.email)::integer as parent_contact_count,
    pg_catalog.count(installation.email) filter (where installation.installed)::integer
      as installed_contact_count
  from authorized_players player
  left join contact_installation installation
    on installation.player_id = player.id
  group by player.id;
$$;

revoke all on function app_private.get_team_parent_app_installation_status_internal(uuid)
from public, anon, authenticated;
grant usage on schema app_private to authenticated, service_role;
grant execute on function app_private.get_team_parent_app_installation_status_internal(uuid)
to authenticated, service_role;

create or replace function public.get_team_parent_app_installation_status(team_id_value uuid)
returns table (
  player_id uuid,
  parent_contact_count integer,
  installed_contact_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    installation.player_id,
    installation.parent_contact_count,
    installation.installed_contact_count
  from app_private.get_team_parent_app_installation_status_internal(team_id_value) installation;
$$;

revoke all on function public.get_team_parent_app_installation_status(uuid)
from public, anon, authenticated;
grant execute on function public.get_team_parent_app_installation_status(uuid)
to authenticated, service_role;

comment on table public.parent_mobile_app_installations is
  'Private account-scoped evidence that the Parent mobile app has been opened on an installation. This is independent of notification permission.';
comment on function public.register_parent_mobile_app_installation(uuid, text, text, text) is
  'Registers privacy-safe Parent app installation presence for the signed-in Parent account.';
comment on function public.get_team_parent_app_installation_status(uuid) is
  'Returns team-scoped Parent contact and app-installed counts without exposing contact details or installation identifiers.';

commit;
