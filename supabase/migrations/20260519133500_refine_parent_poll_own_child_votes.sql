drop function if exists public.submit_parent_portal_poll_vote(uuid, uuid, text);

create or replace function public.submit_parent_portal_poll_vote(
  parent_link_id_value uuid,
  poll_id_value uuid,
  option_id_value text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links%rowtype;
  poll_row public.polls%rowtype;
  voter_email_value text;
  selected_option jsonb;
  selected_player_id_value text;
  existing_vote_id uuid;
  current_vote_count integer;
  vote_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Login is required before voting.';
  end if;

  select *
  into link_row
  from public.parent_player_links
  where id = parent_link_id_value
    and auth_user_id = auth.uid()
    and status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent poll could not be opened.';
  end if;

  select *
  into poll_row
  from public.polls
  where id = poll_id_value
    and club_id = link_row.club_id
    and audience = 'parents'
    and status = 'open'
    and (team_id is null or team_id = link_row.team_id)
    and (closes_at is null or closes_at > timezone('utc', now()))
  limit 1;

  if poll_row.id is null then
    raise exception 'This poll is no longer open.';
  end if;

  select option_row
  into selected_option
  from jsonb_array_elements(poll_row.options) option_row
  where option_row ->> 'id' = option_id_value
  limit 1;

  if selected_option is null then
    raise exception 'Choose a valid poll option.';
  end if;

  voter_email_value := lower(coalesce(nullif(link_row.email, ''), auth.jwt() ->> 'email', auth.uid()::text));

  select id
  into existing_vote_id
  from public.poll_votes
  where poll_id = poll_row.id
    and voter_email = voter_email_value
    and option_id = option_id_value
  limit 1;

  if existing_vote_id is not null then
    delete from public.poll_votes
    where id = existing_vote_id;

    return null;
  end if;

  selected_player_id_value := nullif(selected_option ->> 'playerId', '');

  if poll_row.allow_own_child_votes is false
    and selected_player_id_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and selected_player_id_value::uuid = link_row.player_id
  then
    raise exception 'You cannot vote for your own child in this poll.';
  end if;

  if poll_row.allow_multiple is false then
    delete from public.poll_votes
    where poll_id = poll_row.id
      and voter_email = voter_email_value;
  else
    select count(*)::integer
    into current_vote_count
    from public.poll_votes
    where poll_id = poll_row.id
      and voter_email = voter_email_value;

    if poll_row.max_choices is not null and current_vote_count >= poll_row.max_choices then
      raise exception 'You can only choose % option(s) for this poll.', poll_row.max_choices;
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
    auth.uid(),
    voter_email_value,
    coalesce(nullif(auth.jwt() ->> 'email', ''), voter_email_value),
    option_id_value,
    link_row.id
  )
  on conflict (poll_id, voter_email, option_id)
  do update set
    auth_user_id = excluded.auth_user_id,
    parent_link_id = excluded.parent_link_id,
    updated_at = timezone('utc', now())
  returning id into vote_id_value;

  return vote_id_value;
end;
$$;

grant execute on function public.submit_parent_portal_poll_vote(uuid, uuid, text) to authenticated;
