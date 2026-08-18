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
    end
  from public.polls poll
  join parent_link link
    on link.club_id = poll.club_id
   and (poll.team_id is null or poll.team_id = link.team_id)
  left join own_votes on own_votes.poll_id = poll.id
  left join vote_counts on vote_counts.poll_id = poll.id
  where poll.audience = 'parents'
  group by poll.id, own_votes.poll_id, own_votes.first_option_id, own_votes.option_ids
  order by
    case when poll.status = 'open' and (poll.closes_at is null or poll.closes_at > timezone('utc', now())) then 0 else 1 end,
    poll.created_at desc;
$$;

alter function public.get_parent_portal_polls(uuid) owner to postgres;
revoke all on function public.get_parent_portal_polls(uuid) from public, anon, service_role;
grant execute on function public.get_parent_portal_polls(uuid) to authenticated;

comment on function public.get_parent_portal_polls(uuid) is
  'Returns child-scoped open Parent Polls and retained closed results so notification deep links remain valid.';
