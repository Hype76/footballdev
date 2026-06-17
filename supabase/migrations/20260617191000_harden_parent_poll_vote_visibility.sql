-- HIDDEN-FEATURE-RESURFACE-BATCH-28
-- Keep hidden parent poll totals out of parent RPC payloads until the parent has replied.

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
    poll.allow_own_child_votes,
    poll.allow_vote_changes,
    poll.hide_votes,
    poll.allow_comments,
    poll.created_at,
    own_votes.first_option_id as current_option_id,
    coalesce(own_votes.option_ids, '[]'::jsonb) as current_option_ids,
    case
      when poll.hide_votes is true and own_votes.poll_id is null then '[]'::jsonb
      else coalesce(
        jsonb_agg(
          jsonb_build_object('optionId', vote_counts.option_id, 'count', vote_counts.vote_count)
          order by vote_counts.option_id
        ) filter (where vote_counts.option_id is not null),
        '[]'::jsonb
      )
    end as votes
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
  group by poll.id, own_votes.poll_id, own_votes.first_option_id, own_votes.option_ids
  order by poll.created_at desc;
$$;

revoke all on function public.get_parent_portal_polls(uuid) from public;
revoke execute on function public.get_parent_portal_polls(uuid) from anon;
grant execute on function public.get_parent_portal_polls(uuid) to authenticated;
grant execute on function public.get_parent_portal_polls(uuid) to service_role;
