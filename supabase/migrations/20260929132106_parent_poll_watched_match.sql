-- Require an explicit match-viewing confirmation without changing poll permissions.
begin;
drop function public.submit_parent_portal_poll_vote(uuid, uuid, text);
drop function public.get_parent_portal_polls(uuid);
CREATE OR REPLACE FUNCTION public.submit_parent_portal_poll_vote(parent_link_id_value uuid, poll_id_value uuid, option_id_value text, watched_match_value boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_auth_id uuid := (select auth.uid());
  audit_actor_id uuid;
  link_row public.parent_player_links%rowtype;
  poll_row public.polls%rowtype;
  normalized_option_id text := btrim(coalesce(option_id_value, ''));
  selected_option jsonb;
  selected_player_id_value text;
  voter_email_value text;
  voter_name_value text;
  existing_vote_id uuid;
  current_vote_count integer;
  vote_id_value uuid;
begin
  if actor_auth_id is null
    or parent_link_id_value is null
    or poll_id_value is null
    or normalized_option_id = ''
    or length(normalized_option_id) > 80 then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  select profile.id
  into audit_actor_id
  from public.users profile
  where profile.id = actor_auth_id
  limit 1;

  select link.*
  into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = actor_auth_id
    and link.status = 'active'
  for key share;

  if link_row.id is null then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  select poll.*
  into poll_row
  from public.polls poll
  where poll.id = poll_id_value
    and poll.club_id = link_row.club_id
    and poll.audience = 'parents'
    and poll.status = 'open'
    and (poll.team_id is null or poll.team_id = link_row.team_id)
    and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
  for update;

  if poll_row.id is null then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  if (exists (select 1 from public.match_days match where match.motm_poll_id = poll_row.id) or (poll_row.poll_type = 'awards' and btrim(poll_row.title) ~* '^(player|man) of the match([ :]|$)')) and watched_match_value is distinct from true then
    raise exception using errcode = '22023', message = 'Confirm "I watched the match" before voting.';
  end if;

  select option_row
  into selected_option
  from jsonb_array_elements(poll_row.options) option_row
  where option_row ->> 'id' = normalized_option_id
  limit 1;

  if selected_option is null then
    raise exception using errcode = '22023', message = 'parent_poll_option_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(poll_row.id::text || ':' || actor_auth_id::text, 0));

  select
    lower(coalesce(
      (select nullif(app_user.email, '') from public.users app_user where app_user.id = actor_auth_id),
      nullif(link_row.email, ''),
      nullif(auth.jwt() ->> 'email', ''),
      actor_auth_id::text
    )),
    coalesce(
      (select coalesce(app_user.name, app_user.display_name, app_user.username, app_user.email) from public.users app_user where app_user.id = actor_auth_id),
      nullif(auth.jwt() ->> 'email', ''),
      'Parent'
    )
  into voter_email_value, voter_name_value;

  select vote.id
  into existing_vote_id
  from public.poll_votes vote
  where vote.poll_id = poll_row.id
    and vote.auth_user_id = actor_auth_id
    and vote.option_id = normalized_option_id
  for update;

  if existing_vote_id is not null
    and poll_row.allow_multiple is true
    and poll_row.allow_vote_changes is true then
    delete from public.poll_votes vote
    where vote.id = existing_vote_id;

    insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      poll_row.club_id,
      audit_actor_id,
      'parent_poll_vote_removed',
      'poll',
      poll_row.id,
      jsonb_build_object(
        'actorAuthUserId', actor_auth_id,
        'teamId', poll_row.team_id,
        'parentLinkId', link_row.id,
        'optionId', normalized_option_id,
        'watchedMatch', watched_match_value is true
      )
    );

    return existing_vote_id;
  end if;

  if existing_vote_id is not null then
    return existing_vote_id;
  end if;

  if poll_row.allow_multiple is false
    and poll_row.allow_vote_changes is false
    and exists (
      select 1 from public.poll_votes vote
      where vote.poll_id = poll_row.id and vote.auth_user_id = actor_auth_id
    ) then
    raise exception using errcode = '55000', message = 'parent_poll_vote_locked';
  end if;

  selected_player_id_value := nullif(selected_option ->> 'playerId', '');

  if poll_row.allow_own_child_votes is false
    and selected_player_id_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and selected_player_id_value::uuid = link_row.player_id then
    raise exception using errcode = '42501', message = 'parent_poll_vote_not_permitted';
  end if;

  if poll_row.allow_multiple is false then
    delete from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_auth_id;
  else
    select count(*)::integer
    into current_vote_count
    from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_auth_id;

    if poll_row.max_choices is not null and current_vote_count >= poll_row.max_choices then
      raise exception using errcode = '55000', message = 'parent_poll_vote_limit_reached';
    end if;
  end if;

  insert into public.poll_votes (
    poll_id,
    club_id,
    team_id,
    auth_user_id,
    voter_email,
    voter_name,
    option_id,
    parent_link_id
  )
  values (
    poll_row.id,
    poll_row.club_id,
    poll_row.team_id,
    actor_auth_id,
    voter_email_value,
    voter_name_value,
    normalized_option_id,
    link_row.id
  )
  on conflict (poll_id, voter_email, option_id) do update
  set auth_user_id = excluded.auth_user_id,
      parent_link_id = excluded.parent_link_id,
      voter_name = excluded.voter_name,
      updated_at = timezone('utc', now())
  returning id into vote_id_value;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    poll_row.club_id,
    audit_actor_id,
    'parent_poll_vote_submitted',
    'poll',
    poll_row.id,
    jsonb_build_object(
      'actorAuthUserId', actor_auth_id,
      'teamId', poll_row.team_id,
      'parentLinkId', link_row.id,
      'optionId', normalized_option_id,
        'watchedMatch', watched_match_value is true
    )
  );

  return vote_id_value;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_parent_portal_polls(parent_link_id_value uuid)
 RETURNS TABLE(id uuid, club_id uuid, team_id uuid, title text, description text, audience text, poll_type text, options jsonb, status text, closes_at timestamp with time zone, allow_multiple boolean, max_choices integer, allow_own_child_votes boolean, allow_vote_changes boolean, hide_votes boolean, allow_comments boolean, created_at timestamp with time zone, current_option_id text, current_option_ids jsonb, votes jsonb, requires_watched_match boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with parent_link as (
    select link.*
    from public.parent_player_links link
    where link.id = parent_link_id_value
      and link.auth_user_id = (select auth.uid())
      and link.status = 'active'
    limit 1
  ),
  own_votes as (
    select
      vote.poll_id,
      jsonb_agg(vote.option_id order by vote.option_id) as option_ids,
      min(vote.option_id) as first_option_id
    from public.poll_votes vote
    where vote.auth_user_id = (select auth.uid())
    group by vote.poll_id
  ),
  vote_counts as (
    select vote.poll_id, vote.option_id, count(*)::integer as vote_count
    from public.poll_votes vote
    group by vote.poll_id, vote.option_id
  )
  select
    poll.id,
    poll.club_id,
    poll.team_id,
    poll.title,
    poll.description,
    poll.audience,
    poll.poll_type,
    poll.options,
    poll.status,
    poll.closes_at,
    poll.allow_multiple,
    poll.max_choices,
    poll.allow_own_child_votes,
    poll.allow_vote_changes,
    poll.hide_votes,
    poll.allow_comments,
    poll.created_at,
    own_votes.first_option_id,
    coalesce(own_votes.option_ids, '[]'::jsonb),
    case
      when poll.hide_votes
        and poll.status = 'open'
        and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
        and own_votes.poll_id is null then '[]'::jsonb
      else coalesce(
        jsonb_agg(
          jsonb_build_object('optionId', vote_counts.option_id, 'count', vote_counts.vote_count)
          order by vote_counts.option_id
        ) filter (where vote_counts.option_id is not null),
        '[]'::jsonb
      )
    end,
    (exists (select 1 from public.match_days match where match.motm_poll_id = poll.id) or (poll.poll_type = 'awards' and btrim(poll.title) ~* '^(player|man) of the match([ :]|$)'))
  from public.polls poll
  join parent_link link
    on link.club_id = poll.club_id
   and (poll.team_id is null or poll.team_id = link.team_id)
  left join own_votes on own_votes.poll_id = poll.id
  left join vote_counts on vote_counts.poll_id = poll.id
  where poll.audience = 'parents'
    and poll.created_at >= date_trunc('day', link.created_at)
  group by poll.id, own_votes.poll_id, own_votes.first_option_id, own_votes.option_ids
  order by
    case when poll.status = 'open' and (poll.closes_at is null or poll.closes_at > timezone('utc', now())) then 0 else 1 end,
    poll.created_at desc;
$function$;


alter function public.submit_parent_portal_poll_vote(uuid,uuid,text,boolean) owner to postgres;
revoke all on function public.submit_parent_portal_poll_vote(uuid,uuid,text,boolean) from public, anon, service_role;
grant execute on function public.submit_parent_portal_poll_vote(uuid,uuid,text,boolean) to authenticated;
alter function public.get_parent_portal_polls(uuid) owner to postgres;
revoke all on function public.get_parent_portal_polls(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_polls(uuid) to authenticated;
commit;
