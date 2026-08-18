create or replace function public.event_player_eligible_recipients(
  club_id_value uuid,
  team_id_value uuid,
  player_ids_value uuid[]
)
returns table (
  player_id uuid,
  player_name text,
  recipient_email text,
  recipient_name text,
  recipient_type text,
  parent_link_id uuid
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_players as (
    select
      player.id,
      coalesce(nullif(btrim(player.player_name), ''), 'Player') as player_name,
      lower(btrim(coalesce(player.parent_email, ''))) as configured_email,
      lower(btrim(coalesce(player.contact_type, 'parent'))) as contact_type
    from public.player_team_memberships membership
    join public.players player
      on player.id = membership.player_id
      and player.club_id = membership.club_id
    where membership.club_id = club_id_value
      and membership.team_id = team_id_value
      and membership.status = 'active'
      and membership.ended_at is null
      and player.id = any(coalesce(player_ids_value, '{}'::uuid[]))
      and coalesce(player.status, 'active') = 'active'
      and player.archived_at is null
  ),
  active_parent_links as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(link.email)) as recipient_email,
      coalesce(
        nullif(btrim(parent_profile.display_name), ''),
        nullif(btrim(parent_profile.name), ''),
        'Parent or guardian'
      ) as recipient_name,
      public.canonical_calendar_invite_recipient_type('parent') as recipient_type,
      link.id as parent_link_id,
      1 as priority
    from selected_players player
    join public.parent_player_links link
      on link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = player.id
      and link.status = 'active'
      and link.auth_user_id is not null
    join public.users parent_profile
      on parent_profile.id = link.auth_user_id
      and parent_profile.club_id = club_id_value
      and coalesce(parent_profile.status, 'active') = 'active'
      and lower(btrim(coalesce(parent_profile.email, ''))) = lower(btrim(coalesce(link.email, '')))
    where player.contact_type in ('parent', 'both')
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  active_adult_players as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(adult_auth.email)) as recipient_email,
      coalesce(
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(adult_auth.raw_user_meta_data ->> 'name'), ''),
        player.player_name
      ) as recipient_name,
      public.canonical_calendar_invite_recipient_type('adult_player') as recipient_type,
      null::uuid as parent_link_id,
      2 as priority
    from selected_players player
    join public.adult_player_account_links adult_link
      on adult_link.club_id = club_id_value
      and adult_link.team_id = team_id_value
      and adult_link.player_id = player.id
      and adult_link.status = 'active'
      and adult_link.verified_at is not null
      and adult_link.revoked_at is null
    join auth.users adult_auth
      on adult_auth.id = adult_link.user_id
      and adult_auth.deleted_at is null
      and adult_auth.email_confirmed_at is not null
      and (adult_auth.banned_until is null or adult_auth.banned_until <= timezone('utc', now()))
    where player.contact_type in ('self', 'both')
      and lower(btrim(coalesce(adult_auth.email, ''))) = player.configured_email
      and btrim(coalesce(adult_auth.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  candidates as (
    select * from active_parent_links
    union all
    select * from active_adult_players
  )
  select distinct on (candidate.player_id, candidate.recipient_email)
    candidate.player_id,
    candidate.player_name,
    candidate.recipient_email,
    candidate.recipient_name,
    candidate.recipient_type,
    candidate.parent_link_id
  from candidates candidate
  where candidate.recipient_email <> ''
    and candidate.recipient_type is not null
  order by candidate.player_id, candidate.recipient_email, candidate.priority, candidate.parent_link_id nulls last;
$$;

revoke all on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
to service_role;

comment on function public.event_player_eligible_recipients(uuid, uuid, uuid[]) is
  'Resolves authorised Parent, guardian, and Adult Player recipients from active canonical Team memberships.';
