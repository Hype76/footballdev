-- FOOTBALL-PARENT-PORTAL-CLEANUP-07
-- Harden parent-facing RPC grants and require locked parent invite emails to match the signed-in user.
--
-- This migration is intentionally narrow:
-- - no table creation
-- - no data backfill
-- - no hidden parent modules exposed
-- - token-only availability confirmation remains public by design

revoke all on function public.current_user_can_access_parent_link(uuid, uuid) from public;
revoke execute on function public.current_user_can_access_parent_link(uuid, uuid) from anon;
grant execute on function public.current_user_can_access_parent_link(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_access_parent_link(uuid, uuid) to service_role;

revoke all on function public.current_user_can_access_parent_player(uuid) from public;
revoke execute on function public.current_user_can_access_parent_player(uuid) from anon;
grant execute on function public.current_user_can_access_parent_player(uuid) to authenticated;
grant execute on function public.current_user_can_access_parent_player(uuid) to service_role;

revoke all on function public.current_user_can_access_parent_team(uuid) from public;
revoke execute on function public.current_user_can_access_parent_team(uuid) from anon;
grant execute on function public.current_user_can_access_parent_team(uuid) to authenticated;
grant execute on function public.current_user_can_access_parent_team(uuid) to service_role;

revoke all on function public.accept_parent_player_link(uuid) from public;
revoke execute on function public.accept_parent_player_link(uuid) from anon;
grant execute on function public.accept_parent_player_link(uuid) to authenticated;
grant execute on function public.accept_parent_player_link(uuid) to service_role;

revoke all on function public.revoke_family_player_link(uuid) from public;
revoke execute on function public.revoke_family_player_link(uuid) from anon;
grant execute on function public.revoke_family_player_link(uuid) to authenticated;
grant execute on function public.revoke_family_player_link(uuid) to service_role;

revoke all on function public.get_parent_portal_email_messages(uuid) from public;
revoke execute on function public.get_parent_portal_email_messages(uuid) from anon;
grant execute on function public.get_parent_portal_email_messages(uuid) to authenticated;
grant execute on function public.get_parent_portal_email_messages(uuid) to service_role;

revoke all on function public.mark_parent_portal_message_read(uuid, uuid) from public;
revoke execute on function public.mark_parent_portal_message_read(uuid, uuid) from anon;
grant execute on function public.mark_parent_portal_message_read(uuid, uuid) to authenticated;
grant execute on function public.mark_parent_portal_message_read(uuid, uuid) to service_role;

revoke all on function public.get_parent_portal_polls(uuid) from public;
revoke execute on function public.get_parent_portal_polls(uuid) from anon;
grant execute on function public.get_parent_portal_polls(uuid) to authenticated;
grant execute on function public.get_parent_portal_polls(uuid) to service_role;

revoke all on function public.submit_parent_portal_poll_vote(uuid, uuid, text) from public;
revoke execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) from anon;
grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) to authenticated;
grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) to service_role;

revoke all on function public.get_parent_portal_match_day_players(uuid) from public;
revoke execute on function public.get_parent_portal_match_day_players(uuid) from anon;
grant execute on function public.get_parent_portal_match_day_players(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_day_players(uuid) to service_role;

revoke all on function public.express_match_day_scorer_interest(uuid, uuid, text) from public;
revoke execute on function public.express_match_day_scorer_interest(uuid, uuid, text) from anon;
grant execute on function public.express_match_day_scorer_interest(uuid, uuid, text) to authenticated;
grant execute on function public.express_match_day_scorer_interest(uuid, uuid, text) to service_role;

revoke all on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) from public;
revoke execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) from anon;
grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to authenticated;
grant execute on function public.update_match_day_score_as_scorer(uuid, uuid, integer, integer, text) to service_role;

revoke all on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) from public;
revoke execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) from anon;
grant execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.add_match_day_goal_as_scorer(uuid, uuid, text, text, text, text, text, integer, text) to service_role;

create or replace function public.accept_parent_player_link(invite_token_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  parent_link_id uuid,
  link_type text,
  email text,
  auth_user_id uuid,
  invite_token uuid,
  status text,
  invited_by uuid,
  invited_by_name text,
  accepted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_email text := lower(trim(coalesce((auth.jwt() ->> 'email'), '')));
  target_link public.parent_player_links%rowtype;
  target_email text;
begin
  if auth.uid() is null then
    raise exception 'Login is required before opening this parent link.';
  end if;

  if auth_email = '' then
    raise exception 'A verified parent email is required before opening this link.';
  end if;

  select link.*
  into target_link
  from public.parent_player_links link
  where link.invite_token = invite_token_value
    and link.status <> 'revoked'
    and (
      exists (
        select 1
        from public.players player
        where player.id = link.player_id
          and lower(trim(coalesce(player.section, ''))) = 'squad'
      )
      or (
        link.link_type = 'family'
        and exists (
          select 1
          from public.parent_player_links parent_link
          where parent_link.id = link.parent_link_id
            and parent_link.player_id = link.player_id
            and parent_link.status = 'active'
        )
      )
    )
  limit 1;

  if target_link.id is null then
    raise exception 'This parent link is only available after parent portal access is active for a Squad player.';
  end if;

  target_email := lower(trim(coalesce(target_link.email, '')));

  if target_link.expires_at is not null and target_link.expires_at <= timezone('utc', now()) then
    raise exception 'This parent link has expired. Ask the team to send a new parent portal link.';
  end if;

  -- Locked parent invites must be accepted by the intended signed-in email.
  -- Blank-email family links keep token-possession behavior so a parent can share one child safely.
  if target_email <> '' and target_email <> auth_email then
    raise exception 'This parent link is for a different email address.';
  end if;

  if target_link.status = 'active' then
    if target_link.auth_user_id is distinct from auth.uid() then
      raise exception 'This parent link is already connected to another account.';
    end if;

    return query
    select
      target_link.id,
      target_link.club_id,
      target_link.team_id,
      target_link.player_id,
      target_link.parent_link_id,
      target_link.link_type,
      target_link.email,
      target_link.auth_user_id,
      target_link.invite_token,
      target_link.status,
      target_link.invited_by,
      target_link.invited_by_name,
      target_link.accepted_at,
      target_link.created_at,
      target_link.updated_at;
    return;
  end if;

  return query
  with existing_link as (
    select existing.*
    from public.parent_player_links existing
    where existing.id <> target_link.id
      and existing.status = 'active'
      and existing.team_id is not distinct from target_link.team_id
      and existing.player_id = target_link.player_id
      and existing.link_type = target_link.link_type
      and existing.auth_user_id = auth.uid()
      and lower(trim(coalesce(existing.email, ''))) = auth_email
    order by existing.accepted_at desc nulls last, existing.created_at desc
    limit 1
  ),
  revoke_target as (
    update public.parent_player_links link
    set
      status = 'revoked',
      updated_at = timezone('utc', now())
    where link.id = target_link.id
      and exists (select 1 from existing_link)
    returning link.id
  ),
  accept_target as (
    update public.parent_player_links link
    set
      auth_user_id = auth.uid(),
      email = coalesce(nullif(link.email, ''), auth_email),
      status = 'active',
      accepted_at = coalesce(link.accepted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
    where link.id = target_link.id
      and not exists (select 1 from existing_link)
    returning link.*
  ),
  selected_link as (
    select * from existing_link
    union all
    select * from accept_target
    limit 1
  )
  select
    selected_link.id,
    selected_link.club_id,
    selected_link.team_id,
    selected_link.player_id,
    selected_link.parent_link_id,
    selected_link.link_type,
    selected_link.email,
    selected_link.auth_user_id,
    selected_link.invite_token,
    selected_link.status,
    selected_link.invited_by,
    selected_link.invited_by_name,
    selected_link.accepted_at,
    selected_link.created_at,
    selected_link.updated_at
  from selected_link;
end;
$$;

revoke all on function public.accept_parent_player_link(uuid) from public;
revoke execute on function public.accept_parent_player_link(uuid) from anon;
grant execute on function public.accept_parent_player_link(uuid) to authenticated;
grant execute on function public.accept_parent_player_link(uuid) to service_role;

comment on function public.accept_parent_player_link(uuid) is
  'Accepts a parent portal invite only for the signed-in user. Prefilled invite emails must match auth.jwt email; blank-email family links remain token-based and single-child scoped.';
