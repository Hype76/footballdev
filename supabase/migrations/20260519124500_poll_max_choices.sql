alter table public.polls
add column if not exists max_choices integer;

alter table public.polls
drop constraint if exists polls_max_choices_check;

alter table public.polls
add constraint polls_max_choices_check check (max_choices is null or max_choices >= 1);

drop function if exists public.get_parent_portal_polls(uuid);

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
set search_path = public
as $$
  with parent_link as (
    select *
    from public.parent_player_links
    where id = parent_link_id_value
      and auth_user_id = auth.uid()
      and status = 'active'
    limit 1
  ),
  own_votes as (
    select
      vote.poll_id,
      jsonb_agg(vote.option_id order by vote.option_id) as option_ids,
      min(vote.option_id) as first_option_id
    from public.poll_votes vote
    where vote.auth_user_id = auth.uid()
    group by vote.poll_id
  ),
  vote_counts as (
    select poll_id, option_id, count(*)::integer as vote_count
    from public.poll_votes
    group by poll_id, option_id
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
    poll.hide_votes,
    poll.allow_comments,
    poll.created_at,
    own_votes.first_option_id as current_option_id,
    coalesce(own_votes.option_ids, '[]'::jsonb) as current_option_ids,
    coalesce(
      jsonb_agg(
        jsonb_build_object('optionId', vote_counts.option_id, 'count', vote_counts.vote_count)
        order by vote_counts.option_id
      ) filter (where vote_counts.option_id is not null),
      '[]'::jsonb
    ) as votes
  from public.polls poll
  join parent_link link
    on link.club_id = poll.club_id
    and (poll.team_id is null or poll.team_id = link.team_id)
  left join own_votes
    on own_votes.poll_id = poll.id
  left join vote_counts
    on vote_counts.poll_id = poll.id
  where auth.uid() is not null
    and poll.audience = 'parents'
    and poll.status = 'open'
    and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
  group by poll.id, own_votes.first_option_id, own_votes.option_ids
  order by poll.created_at desc;
$$;

grant execute on function public.get_parent_portal_polls(uuid) to authenticated;

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

  if not exists (
    select 1
    from jsonb_array_elements(poll_row.options) option_row
    where option_row ->> 'id' = option_id_value
  ) then
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
