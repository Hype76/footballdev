create or replace function public.get_parent_portal_polls(parent_link_id_value uuid)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  title text,
  description text,
  audience text,
  poll_type text,
  options jsonb,
  status text,
  closes_at timestamptz,
  allow_multiple boolean,
  max_choices integer,
  allow_own_child_votes boolean,
  allow_vote_changes boolean,
  hide_votes boolean,
  allow_comments boolean,
  created_at timestamptz,
  current_option_id text,
  current_option_ids jsonb,
  votes jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
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
      when poll.hide_votes and own_votes.poll_id is null then '[]'::jsonb
      else coalesce(
        jsonb_agg(
          jsonb_build_object('optionId', vote_counts.option_id, 'count', vote_counts.vote_count)
          order by vote_counts.option_id
        ) filter (where vote_counts.option_id is not null),
        '[]'::jsonb
      )
    end
  from public.polls poll
  join parent_link link
    on link.club_id = poll.club_id
   and (poll.team_id is null or poll.team_id = link.team_id)
  left join own_votes on own_votes.poll_id = poll.id
  left join vote_counts on vote_counts.poll_id = poll.id
  where poll.audience = 'parents'
    and poll.status = 'open'
    and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
  group by poll.id, own_votes.poll_id, own_votes.first_option_id, own_votes.option_ids
  order by poll.created_at desc;
$$;

alter function public.get_parent_portal_polls(uuid) owner to postgres;
revoke all on function public.get_parent_portal_polls(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_polls(uuid) to authenticated;

create or replace function public.submit_parent_portal_poll_vote(
  parent_link_id_value uuid,
  poll_id_value uuid,
  option_id_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
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
  if actor_id is null
    or parent_link_id_value is null
    or poll_id_value is null
    or normalized_option_id = ''
    or length(normalized_option_id) > 80 then
    raise exception using errcode = '42501', message = 'parent_poll_unavailable';
  end if;

  select link.*
  into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = actor_id
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

  select option_row
  into selected_option
  from jsonb_array_elements(poll_row.options) option_row
  where option_row ->> 'id' = normalized_option_id
  limit 1;

  if selected_option is null then
    raise exception using errcode = '22023', message = 'parent_poll_option_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(poll_row.id::text || ':' || actor_id::text, 0));

  select
    lower(coalesce(
      (select nullif(app_user.email, '') from public.users app_user where app_user.id = actor_id),
      nullif(link_row.email, ''),
      nullif(auth.jwt() ->> 'email', ''),
      actor_id::text
    )),
    coalesce(
      (select coalesce(app_user.name, app_user.display_name, app_user.username, app_user.email) from public.users app_user where app_user.id = actor_id),
      nullif(auth.jwt() ->> 'email', ''),
      'Parent'
    )
  into voter_email_value, voter_name_value;

  select vote.id
  into existing_vote_id
  from public.poll_votes vote
  where vote.poll_id = poll_row.id
    and vote.auth_user_id = actor_id
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
      actor_id,
      'parent_poll_vote_removed',
      'poll',
      poll_row.id,
      jsonb_build_object('teamId', poll_row.team_id, 'parentLinkId', link_row.id, 'optionId', normalized_option_id)
    );

    return existing_vote_id;
  end if;

  if existing_vote_id is not null then
    return existing_vote_id;
  end if;

  if poll_row.allow_vote_changes is false and exists (
    select 1 from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_id
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
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_id;
  else
    select count(*)::integer
    into current_vote_count
    from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor_id;

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
    actor_id,
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
    actor_id,
    'parent_poll_vote_submitted',
    'poll',
    poll_row.id,
    jsonb_build_object('teamId', poll_row.team_id, 'parentLinkId', link_row.id, 'optionId', normalized_option_id)
  );

  return vote_id_value;
end;
$$;

alter function public.submit_parent_portal_poll_vote(uuid, uuid, text) owner to postgres;
revoke all on function public.submit_parent_portal_poll_vote(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) to authenticated;

create or replace function public.express_match_day_scorer_interest(
  parent_link_id_value uuid,
  match_day_id_value uuid,
  message_value text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.parent_player_links%rowtype;
  match_row public.match_days%rowtype;
  interest_id_value uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Login is required before volunteering.';
  end if;

  select link.*
  into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = (select auth.uid())
    and link.status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link could not be opened.';
  end if;

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = match_day_id_value
    and match_day.club_id = link_row.club_id
    and match_day.status in ('scheduled', 'scorer_request', 'live')
    and (match_day.match_date is null or match_day.match_date >= timezone('Europe/London', now())::date)
    and (match_day.team_id is null or match_day.team_id = link_row.team_id)
  limit 1;

  if match_row.id is null then
    raise exception 'This Match Day request is no longer available.';
  end if;

  insert into public.match_day_scorer_interest (
    match_day_id,
    club_id,
    team_id,
    parent_link_id,
    auth_user_id,
    parent_name,
    parent_email,
    message
  )
  values (
    match_row.id,
    match_row.club_id,
    match_row.team_id,
    link_row.id,
    (select auth.uid()),
    coalesce(nullif(auth.jwt() ->> 'email', ''), link_row.email, ''),
    lower(coalesce(nullif(link_row.email, ''), auth.jwt() ->> 'email', (select auth.uid())::text)),
    trim(coalesce(message_value, ''))
  )
  on conflict (match_day_id, parent_link_id)
  do update set
    message = excluded.message,
    status = 'interested',
    auth_user_id = excluded.auth_user_id,
    parent_email = excluded.parent_email,
    updated_at = timezone('utc', now())
  returning id into interest_id_value;

  return interest_id_value;
end;
$$;

alter function public.express_match_day_scorer_interest(uuid, uuid, text) owner to postgres;
revoke all on function public.express_match_day_scorer_interest(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.express_match_day_scorer_interest(uuid, uuid, text) to authenticated;
