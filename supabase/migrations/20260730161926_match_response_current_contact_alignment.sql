create or replace function public.is_match_day_action_token_current_internal(token_hash_value text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.match_day_availability_requests request
    join public.match_days match_day
      on match_day.id = request.match_day_id
      and match_day.club_id = request.club_id
      and match_day.team_id = request.team_id
    join public.players player
      on player.id = request.player_id
      and player.club_id = request.club_id
      and player.team_id = request.team_id
    left join public.parent_player_links parent_link
      on parent_link.id = request.parent_link_id
      and parent_link.club_id = request.club_id
      and parent_link.team_id = request.team_id
      and parent_link.player_id = request.player_id
      and lower(btrim(parent_link.email)) = lower(btrim(request.recipient_email))
    left join lateral (
      select
        count(*) filter (
          where btrim(coalesce(
            contact ->> 'email',
            contact ->> 'parentEmail',
            ''
          )) <> ''
        )::integer as usable_count,
        coalesce(bool_or(
          lower(btrim(coalesce(
            contact ->> 'email',
            contact ->> 'parentEmail',
            ''
          ))) = lower(btrim(request.recipient_email))
        ), false) as any_match,
        coalesce(bool_or(
          lower(btrim(coalesce(
            contact ->> 'email',
            contact ->> 'parentEmail',
            ''
          ))) = lower(btrim(request.recipient_email))
          and lower(btrim(coalesce(
            contact ->> 'type',
            contact ->> 'contactType',
            'parent'
          ))) = 'self'
        ), false) as self_match,
        coalesce(bool_or(
          lower(btrim(coalesce(
            contact ->> 'email',
            contact ->> 'parentEmail',
            ''
          ))) = lower(btrim(request.recipient_email))
          and lower(btrim(coalesce(
            contact ->> 'type',
            contact ->> 'contactType',
            'parent'
          ))) <> 'self'
        ), false) as parent_match
      from jsonb_array_elements(coalesce(player.parent_contacts, '[]'::jsonb)) contact
    ) current_contacts on true
    where request.token_hash = lower(btrim(coalesce(token_hash_value, '')))
      and lower(btrim(coalesce(token_hash_value, ''))) ~ '^[a-f0-9]{64}$'
      and request.status <> 'expired'
      and request.expires_at >= timezone('utc', now())
      and match_day.deleted_at is null
      and coalesce(match_day.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
      and coalesce(player.status, 'active') <> 'archived'
      and (
        (
          request.parent_link_id is null
          and request.recipient_type = 'player'
          and (
            (
              lower(btrim(coalesce(player.contact_type, 'parent'))) = 'self'
              and (
                (
                  current_contacts.usable_count = 0
                  and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))
                )
                or (
                  current_contacts.usable_count = 1
                  and current_contacts.any_match
                )
                or current_contacts.self_match
              )
            )
            or (
              lower(btrim(coalesce(player.contact_type, 'parent'))) = 'both'
              and current_contacts.self_match
            )
          )
        )
        or (parent_link.id is not null and parent_link.status = 'active')
        or (
          request.parent_link_id is null
          and request.recipient_type = 'parent'
          and lower(btrim(coalesce(player.contact_type, 'parent'))) in ('parent', 'both')
          and (
            (
              current_contacts.usable_count = 0
              and lower(btrim(coalesce(player.parent_email, ''))) = lower(btrim(request.recipient_email))
            )
            or current_contacts.parent_match
          )
        )
      )
  );
$$;

revoke all on function public.is_match_day_action_token_current_internal(text)
from public, anon, authenticated;

grant execute on function public.is_match_day_action_token_current_internal(text)
to service_role;

comment on function public.is_match_day_action_token_current_internal(text) is
  'Validates Match Day response tokens against the exact current server-resolved parent or adult-player contact scope.';
