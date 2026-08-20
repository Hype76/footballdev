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
        'optionId', normalized_option_id
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
      'optionId', normalized_option_id
    )
  );

  return vote_id_value;
end;
$$;

alter function public.submit_parent_portal_poll_vote(uuid, uuid, text) owner to postgres;
revoke all on function public.submit_parent_portal_poll_vote(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) to authenticated;

comment on function public.submit_parent_portal_poll_vote(uuid, uuid, text) is
  'Saves Parent poll responses while keeping multiple-choice selection and vote-change rules independent.';

create or replace function public.submit_staff_poll_vote(
  p_poll_id uuid,
  p_option_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
  poll_row public.polls%rowtype;
  normalized_option_id text := btrim(coalesce(p_option_id, ''));
  voter_email_value text;
  existing_vote_id uuid;
  current_vote_count integer;
  vote_id_value uuid;
begin
  if p_poll_id is null or normalized_option_id = '' or length(normalized_option_id) > 80 then
    raise exception using errcode = '22023', message = 'poll_vote_invalid';
  end if;

  select app_user.*
  into actor
  from public.users app_user
  where app_user.id = (select auth.uid())
  for key share;

  select poll.*
  into poll_row
  from public.polls poll
  where poll.id = p_poll_id
  for update;

  if actor.id is null
    or poll_row.id is null
    or poll_row.status <> 'open'
    or (poll_row.closes_at is not null and poll_row.closes_at <= timezone('utc', now()))
    or not app_private.actor_can_manage_team_resource(actor.id, poll_row.club_id, poll_row.team_id, 20) then
    raise exception using errcode = '42501', message = 'poll_vote_not_permitted';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(poll_row.options) option_row
    where option_row ->> 'id' = normalized_option_id
  ) then
    raise exception using errcode = '22023', message = 'poll_vote_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(poll_row.id::text || ':' || actor.id::text, 0));
  voter_email_value := lower(actor.email);

  select vote.id
  into existing_vote_id
  from public.poll_votes vote
  where vote.poll_id = poll_row.id
    and vote.auth_user_id = actor.id
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
      actor.id,
      'poll_vote_removed',
      'poll',
      poll_row.id,
      jsonb_build_object('teamId', poll_row.team_id, 'optionId', normalized_option_id)
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
      where vote.poll_id = poll_row.id and vote.auth_user_id = actor.id
    ) then
    raise exception using errcode = '55000', message = 'poll_vote_locked';
  end if;

  if poll_row.allow_multiple is false then
    delete from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor.id;
  else
    select count(*)::integer
    into current_vote_count
    from public.poll_votes vote
    where vote.poll_id = poll_row.id and vote.auth_user_id = actor.id;

    if poll_row.max_choices is not null and current_vote_count >= poll_row.max_choices then
      raise exception using errcode = '55000', message = 'poll_vote_limit_reached';
    end if;
  end if;

  insert into public.poll_votes (
    poll_id,
    club_id,
    team_id,
    auth_user_id,
    voter_email,
    voter_name,
    option_id
  )
  values (
    poll_row.id,
    poll_row.club_id,
    poll_row.team_id,
    actor.id,
    voter_email_value,
    coalesce(actor.name, actor.display_name, actor.username, actor.email),
    normalized_option_id
  )
  on conflict (poll_id, voter_email, option_id) do update
  set auth_user_id = excluded.auth_user_id,
      voter_name = excluded.voter_name,
      updated_at = timezone('utc', now())
  returning id into vote_id_value;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    poll_row.club_id,
    actor.id,
    'poll_vote_submitted',
    'poll',
    poll_row.id,
    jsonb_build_object('teamId', poll_row.team_id, 'optionId', normalized_option_id)
  );

  return vote_id_value;
end;
$$;

alter function public.submit_staff_poll_vote(uuid, text) owner to postgres;
revoke all on function public.submit_staff_poll_vote(uuid, text) from public, anon, service_role;
grant execute on function public.submit_staff_poll_vote(uuid, text) to authenticated;

comment on function public.submit_staff_poll_vote(uuid, text) is
  'Saves Coach poll responses while keeping multiple-choice selection and vote-change rules independent.';
