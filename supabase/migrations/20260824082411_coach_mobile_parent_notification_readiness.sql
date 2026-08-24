begin;

create schema if not exists app_private;

do $migration$
begin
  if pg_catalog.to_regclass('public.parent_mobile_push_installations') is not null then
    execute $view$
      create or replace view app_private.parent_notification_ready_accounts
      with (security_invoker = true)
      as
      select distinct installation.auth_user_id
      from public.parent_mobile_push_installations installation
      where installation.auth_user_id is not null
        and installation.status = 'active'
        and installation.enabled
        and installation.detail_level in ('minimal', 'detailed')
        and installation.expo_push_token is not null
    $view$;
  elsif pg_catalog.to_regclass('public.mobile_test_parent_push_installations') is not null then
    execute $view$
      create or replace view app_private.parent_notification_ready_accounts
      with (security_invoker = true)
      as
      select distinct installation.auth_user_id
      from public.mobile_test_parent_push_installations installation
      where installation.auth_user_id is not null
        and installation.environment = 'test'
        and installation.status = 'active'
        and installation.enabled
        and installation.detail_level in ('minimal', 'detailed')
        and installation.expo_push_token is not null
    $view$;
  else
    raise exception 'Parent mobile installation authority is unavailable.';
  end if;
end;
$migration$;

revoke all on app_private.parent_notification_ready_accounts
from public, anon, authenticated;

create or replace function public.get_team_parent_notification_readiness(team_id_value uuid)
returns table (
  player_id uuid,
  parent_contact_count integer,
  notification_ready_contact_count integer
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
      lower(pg_catalog.btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as email
    from authorized_players player
    cross join lateral pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(coalesce(player.parent_contacts, '[]'::jsonb)) = 'array'
          then coalesce(player.parent_contacts, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) contact(value)
    where lower(pg_catalog.btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
      and pg_catalog.btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  fallback_contacts as (
    select
      player.id as player_id,
      player.club_id,
      lower(pg_catalog.btrim(coalesce(player.parent_email, ''))) as email
    from authorized_players player
    where lower(pg_catalog.btrim(coalesce(player.contact_type, 'parent'))) <> 'self'
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
  contact_readiness as (
    select
      contact.player_id,
      contact.email,
      exists (
        select 1
        from public.parent_player_links link
        join app_private.parent_notification_ready_accounts ready_account
          on ready_account.auth_user_id = link.auth_user_id
        where link.club_id = contact.club_id
          and link.team_id = team_id_value
          and link.player_id = contact.player_id
          and link.link_type = 'parent'
          and link.status = 'active'
          and link.auth_user_id is not null
          and lower(pg_catalog.btrim(coalesce(link.email, ''))) = contact.email
      ) as notification_ready
    from contacts contact
  )
  select
    player.id as player_id,
    pg_catalog.count(readiness.email)::integer as parent_contact_count,
    pg_catalog.count(readiness.email) filter (where readiness.notification_ready)::integer
      as notification_ready_contact_count
  from authorized_players player
  left join contact_readiness readiness
    on readiness.player_id = player.id
  group by player.id;
$$;

revoke all on function public.get_team_parent_notification_readiness(uuid)
from public, anon, authenticated;
grant execute on function public.get_team_parent_notification_readiness(uuid)
to authenticated, service_role;

comment on function public.get_team_parent_notification_readiness(uuid) is
  'Returns team-scoped Parent contact counts and notification-ready counts for authorised staff without exposing contact details, device identifiers, or push tokens.';

commit;
