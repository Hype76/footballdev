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
      coalesce(nullif(btrim(player.parent_name), ''), player.player_name, 'Player contact') as configured_name,
      case
        when jsonb_typeof(coalesce(player.parent_contacts, '[]'::jsonb)) = 'array'
          then coalesce(player.parent_contacts, '[]'::jsonb)
        else '[]'::jsonb
      end as parent_contacts,
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
      and coalesce(player.status, 'active') <> 'archived'
      and player.archived_at is null
  ),
  configured_parent_contacts as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as recipient_email,
      coalesce(
        nullif(btrim(coalesce(contact.value ->> 'name', contact.value ->> 'parentName', '')), ''),
        player.configured_name,
        'Parent or guardian'
      ) as recipient_name,
      1 as priority
    from selected_players player
    cross join lateral jsonb_array_elements(player.parent_contacts) contact(value)
    where player.contact_type in ('parent', 'both')
      and lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
      and btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  fallback_parent_contacts as (
    select
      player.id as player_id,
      player.player_name,
      player.configured_email as recipient_email,
      player.configured_name as recipient_name,
      2 as priority
    from selected_players player
    where player.contact_type in ('parent', 'both')
      and player.configured_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  parent_email_candidates as (
    select * from configured_parent_contacts
    union all
    select * from fallback_parent_contacts
  ),
  resolved_parent_contacts as (
    select distinct on (candidate.player_id, candidate.recipient_email)
      candidate.player_id,
      candidate.player_name,
      candidate.recipient_email,
      coalesce(
        nullif(btrim(parent_authority.recipient_name), ''),
        nullif(btrim(candidate.recipient_name), ''),
        'Parent or guardian'
      ) as recipient_name,
      public.canonical_calendar_invite_recipient_type('parent') as recipient_type,
      parent_authority.parent_link_id,
      candidate.priority
    from parent_email_candidates candidate
    left join lateral (
      select
        link.id as parent_link_id,
        coalesce(
          nullif(btrim(parent_auth.raw_user_meta_data ->> 'display_name'), ''),
          nullif(btrim(parent_auth.raw_user_meta_data ->> 'name'), '')
        ) as recipient_name
      from public.parent_player_links link
      join auth.users parent_auth
        on parent_auth.id = link.auth_user_id
        and parent_auth.deleted_at is null
        and parent_auth.email_confirmed_at is not null
        and (parent_auth.banned_until is null or parent_auth.banned_until <= timezone('utc', now()))
        and lower(btrim(coalesce(parent_auth.email, ''))) = candidate.recipient_email
      where link.club_id = club_id_value
        and link.team_id = team_id_value
        and link.player_id = candidate.player_id
        and link.status = 'active'
        and link.auth_user_id is not null
        and lower(btrim(coalesce(link.email, ''))) = candidate.recipient_email
      order by link.id
      limit 1
    ) parent_authority on true
    where candidate.recipient_email <> ''
    order by candidate.player_id, candidate.recipient_email, candidate.priority
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
      3 as priority
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
    select
      parent_recipient.player_id,
      parent_recipient.player_name,
      parent_recipient.recipient_email,
      parent_recipient.recipient_name,
      parent_recipient.recipient_type,
      parent_recipient.parent_link_id,
      parent_recipient.priority
    from resolved_parent_contacts parent_recipient
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
  'Resolves canonical event recipients for nonarchived Players with an active Team membership, including promoted Squad Players.';
