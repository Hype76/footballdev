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
      lower(btrim(coalesce(player.parent_email, ''))) as fallback_email,
      coalesce(nullif(btrim(player.parent_name), ''), player.player_name, 'Player contact') as fallback_name,
      coalesce(player.parent_contacts, '[]'::jsonb) as parent_contacts,
      lower(btrim(coalesce(player.contact_type, 'parent'))) as contact_type
    from public.players player
    where player.club_id = club_id_value
      and player.team_id = team_id_value
      and player.id = any(coalesce(player_ids_value, '{}'::uuid[]))
      and coalesce(player.status, 'active') <> 'archived'
  ),
  active_links as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(link.email)) as recipient_email,
      coalesce(
        nullif(btrim(parent_profile.display_name), ''),
        nullif(btrim(parent_profile.name), ''),
        nullif(btrim(player.fallback_name), ''),
        'Parent or guardian'
      ) as recipient_name,
      'parent_guardian'::text as recipient_type,
      link.id as parent_link_id,
      1 as priority
    from selected_players player
    join public.parent_player_links link
      on link.club_id = club_id_value
      and link.team_id = team_id_value
      and link.player_id = player.id
      and link.status = 'active'
    left join public.users parent_profile on parent_profile.id = link.auth_user_id
    where player.contact_type in ('parent', 'both')
      and btrim(coalesce(link.email, '')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  json_contacts as (
    select
      player.id as player_id,
      player.player_name,
      lower(btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as recipient_email,
      coalesce(
        nullif(btrim(coalesce(contact.value ->> 'name', contact.value ->> 'parentName', '')), ''),
        player.fallback_name
      ) as recipient_name,
      case
        when lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', ''))) = 'self'
          then 'player'
        else 'parent_guardian'
      end as recipient_type,
      null::uuid as parent_link_id,
      2 as priority
    from selected_players player
    cross join lateral jsonb_array_elements(player.parent_contacts) contact(value)
    where (
      player.contact_type = 'both'
      or (
        player.contact_type = 'self'
        and (
          lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', ''))) = 'self'
          or jsonb_array_length(player.parent_contacts) = 1
        )
      )
      or (
        player.contact_type = 'parent'
        and lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
      )
    )
      and btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  fallback_contacts as (
    select
      player.id as player_id,
      player.player_name,
      player.fallback_email as recipient_email,
      player.fallback_name as recipient_name,
      case
        when player.contact_type = 'self' then 'player'
        else 'parent_guardian'
      end as recipient_type,
      null::uuid as parent_link_id,
      3 as priority
    from selected_players player
    where player.fallback_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  candidates as (
    select * from active_links
    union all
    select * from json_contacts
    union all
    select * from fallback_contacts
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
  order by candidate.player_id, candidate.recipient_email, candidate.priority, candidate.parent_link_id nulls last;
$$;

revoke all on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
from public, anon, authenticated;

grant execute on function public.event_player_eligible_recipients(uuid, uuid, uuid[])
to service_role;

comment on function public.event_player_eligible_recipients(uuid, uuid, uuid[]) is
  'Resolves server-authoritative event contacts using the canonical Calendar invite recipient type values.';
